import { PGlite } from "@electric-sql/pglite";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4040);
const serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";
const opsBase = process.env.OPS_API_BASE || "http://127.0.0.1:4030";
const foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
const providerMode = process.env.MONNIFY_PROVIDER_MODE || "simulated";
const monnifyBase = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";
const webhookSecret = process.env.MONNIFY_WEBHOOK_SECRET || process.env.MONNIFY_SECRET_KEY || "flexi-monnify-sandbox-secret";
const db = new PGlite(`file://${process.env.FLEXI_PAYMENTS_DB_DIR || ".data/payments-pglite"}`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS payment_reserved_accounts (
    reserved_account_id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL UNIQUE,
    amoeba_id TEXT,
    provider TEXT NOT NULL,
    account_reference TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    bank_name TEXT,
    account_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    provider_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_webhook_events (
    webhook_event_id TEXT PRIMARY KEY,
    provider_event_reference TEXT UNIQUE,
    transaction_reference TEXT,
    operator_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    raw_payload JSONB NOT NULL,
    error_summary TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS payment_deposit_transactions (
    deposit_transaction_id TEXT PRIMARY KEY,
    transaction_reference TEXT NOT NULL UNIQUE,
    operator_id TEXT,
    account_number TEXT,
    amount_ngn NUMERIC(12, 2) NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    provider_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS settlement_amount_ngn NUMERIC(12, 2);
  ALTER TABLE payment_deposit_transactions
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook';

  ALTER TABLE payment_reserved_accounts
    ADD COLUMN IF NOT EXISTS current_balance_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0;
  ALTER TABLE payment_reserved_accounts
    ADD COLUMN IF NOT EXISTS total_deposits_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0;
  ALTER TABLE payment_reserved_accounts
    ADD COLUMN IF NOT EXISTS last_deposit_at TIMESTAMPTZ;

  CREATE TABLE IF NOT EXISTS payment_reconciliation_runs (
    reconciliation_run_id TEXT PRIMARY KEY,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    provider_transactions INTEGER NOT NULL DEFAULT 0,
    matched_transactions INTEGER NOT NULL DEFAULT 0,
    exceptions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS payment_accounting_period_closes (
    accounting_period_close_id TEXT PRIMARY KEY,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    deposit_count INTEGER NOT NULL DEFAULT 0,
    reconciled_count INTEGER NOT NULL DEFAULT 0,
    settled_count INTEGER NOT NULL DEFAULT 0,
    finance_approved_count INTEGER NOT NULL DEFAULT 0,
    provider_exception_count INTEGER NOT NULL DEFAULT 0,
    ops_exception_count INTEGER NOT NULL DEFAULT 0,
    exception_count INTEGER NOT NULL DEFAULT 0,
    total_amount_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
    settlement_amount_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    closed_by_person_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  ALTER TABLE payment_accounting_period_closes
    ADD COLUMN IF NOT EXISTS provider_exception_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payment_accounting_period_closes
    ADD COLUMN IF NOT EXISTS ops_exception_count INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS payment_idempotency_records (
    idempotency_key TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
`);

await db.query(`
  UPDATE payment_reserved_accounts account
  SET current_balance_ngn = COALESCE(summary.total_amount_ngn, 0),
      total_deposits_ngn = COALESCE(summary.total_amount_ngn, 0),
      last_deposit_at = summary.last_deposit_at,
      updated_at = GREATEST(account.updated_at, COALESCE(summary.last_deposit_at, account.updated_at))
  FROM (
    SELECT account_number, SUM(amount_ngn) AS total_amount_ngn, MAX(paid_at) AS last_deposit_at
    FROM payment_deposit_transactions
    GROUP BY account_number
  ) summary
  WHERE account.account_number = summary.account_number
`);

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

function now() {
  return new Date().toISOString();
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, monnify-signature",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

function error(res, status, code, message, details = []) {
  json(res, status, {
    error: {
      code,
      message,
      request_id: id("req"),
      details
    }
  });
}

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function authenticate(req) {
  const authorization = req.headers.authorization || "";
  if (authorization === `Bearer ${serviceToken}`) {
    return { actor_type: "service", person_id: "person_system", roles: [], role_assignments: [] };
  }
  if (!authorization.startsWith("Bearer ")) return null;
  try {
    const response = await fetch(`${foundationBase}/identity/v1/me`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function requireIdempotency(req) {
  const key = String(req.headers["idempotency-key"] || "");
  if (key.length < 8) throw new Error("Mutating requests require an Idempotency-Key header.");
  return key;
}

function actorPersonId(req, auth) {
  if (auth?.actor_type === "human") return String(auth.person_id);
  return String(req.headers["x-actor-person-id"] || auth?.person_id || "person_system");
}

function isFinanceActor(auth) {
  if (auth?.actor_type === "service") return true;
  const roles = auth?.roles || [];
  if (roles.includes("owner") || roles.includes("admin")) return true;
  return (auth?.role_assignments || []).some((assignment) =>
    assignment.role === "finance" && assignment.status === "active"
  );
}

function requireFinanceActor(res, auth) {
  if (isFinanceActor(auth)) return true;
  error(res, 403, "forbidden", "This action requires an active Finance role assignment.");
  return false;
}

async function cached(key) {
  return (await db.query("SELECT status, body FROM payment_idempotency_records WHERE idempotency_key = $1", [key])).rows[0] || null;
}

async function remember(key, status, body) {
  await db.query(
    "INSERT INTO payment_idempotency_records (idempotency_key, status, body, created_at) VALUES ($1,$2,$3,$4)",
    [key, status, body, now()]
  );
}

async function mutate(req, res, status, factory) {
  let key;
  try {
    key = requireIdempotency(req);
  } catch (cause) {
    return error(res, 400, "idempotency_key_required", cause.message);
  }
  const previous = await cached(key);
  if (previous) return json(res, Number(previous.status), previous.body);
  const body = await factory();
  await remember(key, status, body);
  return json(res, status, body);
}

async function opsRequest(path, method, body, idempotencyKey) {
  const response = await fetch(`${opsBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Ops returned ${response.status}.`);
  return payload;
}

async function monnifyAccessToken() {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Monnify credentials are not configured.");
  const response = await fetch(`${monnifyBase}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`
    },
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json();
  if (!response.ok || !payload?.responseBody?.accessToken) throw new Error("Monnify authentication failed.");
  return payload.responseBody.accessToken;
}

async function providerReservedAccount(operatorId, body) {
  const accountReference = `fleximos-${operatorId}`;
  if (providerMode === "simulated") {
    return {
      account_reference: accountReference,
      account_name: String(body.customer_name),
      bank_name: "Monnify Sandbox Bank",
      account_number: String(randomInt(1000000000, 1999999999)),
      provider_payload: { simulated: true }
    };
  }
  const accessToken = await monnifyAccessToken();
  const response = await fetch(`${monnifyBase}/api/v2/bank-transfer/reserved-accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      accountReference,
      accountName: body.customer_name,
      currencyCode: "NGN",
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      customerEmail: body.customer_email,
      customerName: body.customer_name
    }),
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json();
  const account = payload?.responseBody?.accounts?.[0];
  if (!response.ok || !account?.accountNumber) throw new Error(payload?.responseMessage || "Reserved account provisioning failed.");
  return {
    account_reference: accountReference,
    account_name: payload.responseBody.accountName || body.customer_name,
    bank_name: account.bankName,
    account_number: account.accountNumber,
    provider_payload: payload.responseBody
  };
}

function signatureFor(raw) {
  return createHmac("sha512", webhookSecret).update(raw).digest("hex");
}

function validSignature(raw, provided) {
  const expected = Buffer.from(signatureFor(raw));
  const received = Buffer.from(String(provided || ""));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function statusIsPaid(value) {
  return ["PAID", "OVERPAID"].includes(String(value || "").toUpperCase());
}

function normalizeProviderTransaction(payload, fallback = {}) {
  const body = payload?.responseBody || payload?.eventData || payload?.data || payload || {};
  const transactionReference = String(
    body.transactionReference
      || body.paymentReference
      || body.transaction_ref
      || fallback.transaction_reference
      || ""
  );
  const amount = Number(body.amountPaid ?? body.amount ?? body.amount_ngn ?? fallback.amount_ngn);
  const paidAt = new Date(body.paidOn || body.paid_at || body.paymentDate || payload?.eventTime || fallback.paid_at || now());
  const accountNumber = String(
    body.accountNumber
      || body.destinationAccountInformation?.accountNumber
      || body.destinationAccountNumber
      || body.product?.reference
      || fallback.account_number
      || ""
  );
  return {
    transaction_reference: transactionReference,
    amount_ngn: amount,
    paid_at: paidAt,
    account_number: accountNumber,
    payment_status: body.paymentStatus || body.status || fallback.payment_status || "PAID",
    settlement_amount_ngn: Number(body.settlementAmount ?? body.settlement_amount_ngn ?? amount),
    raw_payload: payload
  };
}

async function providerVerifyTransaction(transactionReference, fallback = {}) {
  if (providerMode === "simulated") {
    const local = (await db.query(
      "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
      [transactionReference]
    )).rows[0];
    if (local) {
      return {
        transaction_reference: local.transaction_reference,
        amount_ngn: Number(local.amount_ngn),
        paid_at: new Date(local.paid_at),
        account_number: local.account_number,
        payment_status: "PAID",
        settlement_amount_ngn: Number(local.settlement_amount_ngn || local.amount_ngn),
        raw_payload: local.provider_payload
      };
    }
    return {
      transaction_reference: transactionReference,
      amount_ngn: Number(fallback.amount_ngn),
      paid_at: new Date(fallback.paid_at || now()),
      account_number: fallback.account_number,
      payment_status: fallback.payment_status || "PAID",
      settlement_amount_ngn: Number(fallback.settlement_amount_ngn || fallback.amount_ngn),
      raw_payload: fallback.raw_payload || { simulated: true }
    };
  }
  const accessToken = await monnifyAccessToken();
  const response = await fetch(
    `${monnifyBase}/api/v2/merchant/transactions/query?transactionReference=${encodeURIComponent(transactionReference)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000)
    }
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.responseMessage || "Transaction verification failed.");
  return normalizeProviderTransaction(payload, fallback);
}

async function deliverToOps(deposit, account, payload) {
  await opsRequest(
    "/ops/v1/cash/transactions",
    "POST",
    {
      operator_id: account.operator_id,
      amount_ngn: Number(deposit.amount_ngn),
      transaction_ref: deposit.transaction_reference,
      paid_at: new Date(deposit.paid_at).toISOString(),
      monnify_account_number: account.account_number,
      reconciliation_status: "matched",
      provider_payload: payload
    },
    `monnify-cash-${deposit.transaction_reference}`
  );
  await db.query(
    "UPDATE payment_deposit_transactions SET status='delivered_to_ops', delivered_at=COALESCE(delivered_at,$2) WHERE transaction_reference=$1",
    [deposit.transaction_reference, now()]
  );
}

async function applyDepositToReservedAccount(account, deposit) {
  const alreadyCounted = deposit.provider_payload?.fleximos_balance?.counted_at;
  if (alreadyCounted) return;
  const timestamp = now();
  await db.query(
    `UPDATE payment_reserved_accounts
     SET current_balance_ngn = current_balance_ngn + $2,
         total_deposits_ngn = total_deposits_ngn + $2,
         last_deposit_at = GREATEST(COALESCE(last_deposit_at, $3::timestamptz), $3::timestamptz),
         updated_at = $4
     WHERE reserved_account_id = $1`,
    [account.reserved_account_id, Number(deposit.amount_ngn), new Date(deposit.paid_at).toISOString(), timestamp]
  );
  await db.query(
    `UPDATE payment_deposit_transactions
     SET provider_payload = provider_payload || $2::jsonb
     WHERE transaction_reference = $1`,
    [
      deposit.transaction_reference,
      JSON.stringify({ fleximos_balance: { counted_at: timestamp, reserved_account_id: account.reserved_account_id } })
    ]
  );
}

async function verifyMatchAndDeliver(transactionReference, fallback = {}, source = "manual") {
  const verified = await providerVerifyTransaction(transactionReference, fallback);
  if (!verified.transaction_reference || !Number.isFinite(verified.amount_ngn) || verified.amount_ngn <= 0 || Number.isNaN(verified.paid_at.getTime())) {
    throw new Error("Verified transaction payload is incomplete.");
  }
  if (!statusIsPaid(verified.payment_status)) {
    throw new Error(`Transaction status is ${verified.payment_status}; only paid transactions can be delivered.`);
  }
  const account = (await db.query(
    "SELECT * FROM payment_reserved_accounts WHERE account_number = $1",
    [verified.account_number]
  )).rows[0];
  if (!account) throw new Error("Reserved account is not mapped to an operator.");

  let deposit = (await db.query(
    "SELECT * FROM payment_deposit_transactions WHERE transaction_reference = $1",
    [verified.transaction_reference]
  )).rows[0];
  if (!deposit) {
    const timestamp = now();
    await db.query(
      `INSERT INTO payment_deposit_transactions
       (deposit_transaction_id, transaction_reference, operator_id, account_number, amount_ngn,
        paid_at, status, provider_payload, created_at, verified_at, matched_at,
        settlement_amount_ngn, source)
       VALUES ($1,$2,$3,$4,$5,$6,'matched',$7,$8,$8,$8,$9,$10)`,
      [
        id("deposit"),
        verified.transaction_reference,
        account.operator_id,
        verified.account_number,
        verified.amount_ngn,
        verified.paid_at.toISOString(),
        verified.raw_payload,
        timestamp,
        verified.settlement_amount_ngn,
        source
      ]
    );
    deposit = (await db.query(
      "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
      [verified.transaction_reference]
    )).rows[0];
  } else {
    await db.query(
      `UPDATE payment_deposit_transactions
       SET operator_id=$2, account_number=$3, amount_ngn=$4, paid_at=$5,
           status=CASE WHEN status IN ('received','verified') THEN 'matched' ELSE status END,
           provider_payload=$6, verified_at=COALESCE(verified_at,$7),
           matched_at=COALESCE(matched_at,$7), settlement_amount_ngn=$8
       WHERE transaction_reference=$1`,
      [
        verified.transaction_reference,
        account.operator_id,
        verified.account_number,
        verified.amount_ngn,
        verified.paid_at.toISOString(),
        verified.raw_payload,
        now(),
        verified.settlement_amount_ngn
      ]
    );
    deposit = (await db.query(
      "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
      [verified.transaction_reference]
    )).rows[0];
  }
  await applyDepositToReservedAccount(account, deposit);
  if (!["delivered_to_ops", "reconciled", "settled", "finance_approved"].includes(deposit.status)) {
    await deliverToOps(deposit, account, verified.raw_payload);
  }
  return (await db.query(
    "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
    [verified.transaction_reference]
  )).rows[0];
}

async function transitionDeposit(transactionReference, nextStatus, actor, notes) {
  const deposit = (await db.query(
    "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
    [transactionReference]
  )).rows[0];
  if (!deposit) throw new Error("Transaction not found.");
  const current = String(deposit.status);
  const allowed = {
    settled: ["reconciled", "settled", "finance_approved"],
    finance_approved: ["settled", "finance_approved"]
  };
  if (!allowed[nextStatus]?.includes(current)) {
    throw new Error(`Transaction must be ${nextStatus === "settled" ? "reconciled" : "settled"} before it can be ${nextStatus}.`);
  }
  if (current !== nextStatus && current !== "finance_approved") {
    const column = nextStatus === "settled" ? "settled_at" : "finance_approved_at";
    await db.query(
      `UPDATE payment_deposit_transactions
       SET status=$2, ${column}=COALESCE(${column},$3), provider_payload = provider_payload || $4::jsonb
       WHERE transaction_reference=$1`,
      [
        transactionReference,
        nextStatus,
        now(),
        JSON.stringify({
          fleximos_workflow: {
            ...(deposit.provider_payload?.fleximos_workflow || {}),
            [nextStatus]: { actor_person_id: actor, notes: notes || null, at: now() }
          }
        })
      ]
    );
  }
  return (await db.query(
    "SELECT * FROM payment_deposit_transactions WHERE transaction_reference=$1",
    [transactionReference]
  )).rows[0];
}

async function processWebhook(raw, signature) {
  const payload = JSON.parse(raw.toString("utf8"));
  const signatureValid = validSignature(raw, signature);
  const eventData = payload.eventData || payload.data || payload;
  const transactionReference = String(
    eventData.transactionReference || eventData.paymentReference || eventData.transaction_ref || ""
  );
  const providerEventReference = String(payload.eventId || payload.event_id || transactionReference || id("provider_event"));
  const existingEvent = (await db.query(
    "SELECT * FROM payment_webhook_events WHERE provider_event_reference = $1",
    [providerEventReference]
  )).rows[0];
  if (existingEvent) return { duplicate: true, event: existingEvent };

  const webhookEventId = id("webhook_event");
  await db.query(
    `INSERT INTO payment_webhook_events
     (webhook_event_id, provider_event_reference, transaction_reference, event_type,
      status, signature_valid, raw_payload, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      webhookEventId,
      providerEventReference,
      transactionReference || null,
      payload.eventType || payload.event_type || "SUCCESSFUL_TRANSACTION",
      signatureValid ? "received" : "rejected",
      signatureValid,
      payload,
      now()
    ]
  );
  if (!signatureValid) throw new Error("Invalid Monnify signature.");

  const accountNumber = String(
    eventData.accountNumber
      || eventData.destinationAccountInformation?.accountNumber
      || eventData.destinationAccountNumber
      || ""
  );
  const account = (await db.query(
    "SELECT * FROM payment_reserved_accounts WHERE account_number = $1",
    [accountNumber]
  )).rows[0];
  if (!account) {
    await db.query(
      "UPDATE payment_webhook_events SET status='quarantined', error_summary=$2, processed_at=$3 WHERE webhook_event_id=$1",
      [webhookEventId, "Reserved account is not mapped to an operator.", now()]
    );
    return { duplicate: false, status: "quarantined", webhook_event_id: webhookEventId };
  }

  const amount = Number(eventData.amountPaid || eventData.amount || eventData.amount_ngn);
  const paidAt = new Date(eventData.paidOn || eventData.paid_at || payload.eventTime || now());
  if (!transactionReference || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(paidAt.getTime())) {
    await db.query(
      "UPDATE payment_webhook_events SET status='quarantined', operator_id=$2, error_summary=$3, processed_at=$4 WHERE webhook_event_id=$1",
      [webhookEventId, account.operator_id, "Transaction payload is incomplete.", now()]
    );
    return { duplicate: false, status: "quarantined", webhook_event_id: webhookEventId };
  }

  const existingDeposit = (await db.query(
    "SELECT * FROM payment_deposit_transactions WHERE transaction_reference = $1",
    [transactionReference]
  )).rows[0];
  await verifyMatchAndDeliver(transactionReference, {
    transaction_reference: transactionReference,
    amount_ngn: amount,
    paid_at: paidAt.toISOString(),
    account_number: accountNumber,
    payment_status: "PAID",
    raw_payload: payload
  }, "webhook");
  await db.query(
    "UPDATE payment_webhook_events SET status='delivered', operator_id=$2, processed_at=$3 WHERE webhook_event_id=$1",
    [webhookEventId, account.operator_id, now()]
  );
  return {
    duplicate: Boolean(existingDeposit),
    status: "delivered",
    webhook_event_id: webhookEventId,
    operator_id: account.operator_id,
    transaction_reference: transactionReference
  };
}

async function routes(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, {
      name: "Fleximotion Payments Integration API",
      version: "v1",
      provider_mode: providerMode,
      links: {
        health: "/health",
        reserved_accounts: "/payments/v1/reserved-accounts",
        webhook_events: "/payments/v1/webhook-events",
        reconciliation_runs: "/payments/v1/reconciliation-runs"
      }
    });
  }
  if (req.method === "GET" && url.pathname === "/health") {
    const lastWebhook = (await db.query("SELECT MAX(received_at) AS value FROM payment_webhook_events")).rows[0]?.value || null;
    const counts = (await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM payment_reserved_accounts) AS reserved_accounts,
        (SELECT COUNT(*)::int FROM payment_webhook_events) AS webhook_events,
        (SELECT COUNT(*)::int FROM payment_deposit_transactions) AS deposits,
        (SELECT COALESCE(SUM(current_balance_ngn),0) FROM payment_reserved_accounts) AS reserved_account_balance_ngn,
        (SELECT COALESCE(SUM(total_deposits_ngn),0) FROM payment_reserved_accounts) AS total_reserved_account_deposits_ngn,
        (SELECT COUNT(*)::int FROM payment_deposit_transactions WHERE status IN ('received','verified','matched')) AS undelivered_deposits,
        (SELECT COUNT(*)::int FROM payment_webhook_events WHERE status IN ('rejected','quarantined')) AS unmatched_events`
    )).rows[0];
    return json(res, 200, {
      status: "ok",
      service: "payments-integration",
      provider: "monnify",
      provider_mode: providerMode,
      monnify_configured: providerMode === "simulated" || Boolean(process.env.MONNIFY_API_KEY && process.env.MONNIFY_SECRET_KEY && process.env.MONNIFY_CONTRACT_CODE),
      last_webhook_at: lastWebhook,
      counts
    });
  }

  if (req.method === "POST" && url.pathname === "/payments/v1/webhooks/monnify") {
    const raw = await rawBody(req);
    try {
      const result = await processWebhook(raw, req.headers["monnify-signature"]);
      return json(res, 202, result);
    } catch (cause) {
      return error(res, cause.message === "Invalid Monnify signature." ? 401 : 400, "webhook_rejected", cause.message);
    }
  }

  const auth = await authenticate(req);
  if (!auth) return error(res, 401, "unauthorized", "Missing or invalid bearer token.");

  const operatorMatch = url.pathname.match(/^\/payments\/v1\/operators\/([^/]+)\/reserved-account$/);
  if (operatorMatch && req.method === "GET") {
    const account = (await db.query(
      "SELECT reserved_account_id, operator_id, amoeba_id, provider, account_reference, account_name, bank_name, account_number, status, current_balance_ngn, total_deposits_ngn, last_deposit_at, created_at FROM payment_reserved_accounts WHERE operator_id=$1",
      [operatorMatch[1]]
    )).rows[0];
    return account ? json(res, 200, account) : error(res, 404, "not_found", "Reserved account not found.");
  }
  if (operatorMatch && req.method === "POST") {
    if (!requireFinanceActor(res, auth)) return;
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    if (!body.customer_name || !body.customer_email) {
      return error(res, 400, "validation_failed", "customer_name and customer_email are required.");
    }
    try {
      return await mutate(req, res, 201, async () => {
        const existing = (await db.query("SELECT * FROM payment_reserved_accounts WHERE operator_id=$1", [operatorMatch[1]])).rows[0];
        if (existing) return existing;
        const provider = await providerReservedAccount(operatorMatch[1], body);
        const timestamp = now();
        const account = {
          reserved_account_id: id("reserved_account"),
          operator_id: operatorMatch[1],
          amoeba_id: body.amoeba_id || null,
          provider: "monnify",
          ...provider,
          customer_email: body.customer_email,
          status: "active",
          created_at: timestamp,
          updated_at: timestamp
        };
        await db.query(
          `INSERT INTO payment_reserved_accounts
           (reserved_account_id, operator_id, amoeba_id, provider, account_reference,
            account_name, customer_email, bank_name, account_number, status,
            provider_payload, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            account.reserved_account_id, account.operator_id, account.amoeba_id, account.provider,
            account.account_reference, account.account_name, account.customer_email, account.bank_name,
            account.account_number, account.status, account.provider_payload, account.created_at, account.updated_at
          ]
        );
        await opsRequest(
          `/ops/v1/operators/${account.operator_id}/monnify-account`,
          "PATCH",
          { monnify_account_number: account.account_number },
          `monnify-account-${account.operator_id}`
        );
        return account;
      });
    } catch (cause) {
      return error(res, 502, "provisioning_failed", cause.message);
    }
  }

  if (req.method === "GET" && url.pathname === "/payments/v1/reserved-accounts") {
    const rows = (await db.query(
      "SELECT reserved_account_id, operator_id, amoeba_id, provider, account_reference, account_name, bank_name, account_number, status, current_balance_ngn, total_deposits_ngn, last_deposit_at, created_at FROM payment_reserved_accounts ORDER BY created_at DESC"
    )).rows;
    return json(res, 200, { data: rows, next_cursor: null });
  }
  if (req.method === "GET" && url.pathname === "/payments/v1/webhook-events") {
    const rows = (await db.query("SELECT * FROM payment_webhook_events ORDER BY received_at DESC LIMIT 200")).rows;
    return json(res, 200, { data: rows, next_cursor: null });
  }
  if (req.method === "GET" && url.pathname === "/payments/v1/transactions") {
    const rows = (await db.query("SELECT * FROM payment_deposit_transactions ORDER BY paid_at DESC LIMIT 200")).rows;
    return json(res, 200, { data: rows, next_cursor: null });
  }
  const settleMatch = url.pathname.match(/^\/payments\/v1\/transactions\/([^/]+)\/settle$/);
  if (settleMatch && req.method === "POST") {
    if (!requireFinanceActor(res, auth)) return;
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    return mutate(req, res, 200, async () =>
      transitionDeposit(decodeURIComponent(settleMatch[1]), "settled", actorPersonId(req, auth), body.notes)
    );
  }
  const approveMatch = url.pathname.match(/^\/payments\/v1\/transactions\/([^/]+)\/finance-approve$/);
  if (approveMatch && req.method === "POST") {
    if (!requireFinanceActor(res, auth)) return;
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    return mutate(req, res, 200, async () =>
      transitionDeposit(decodeURIComponent(approveMatch[1]), "finance_approved", actorPersonId(req, auth), body.notes)
    );
  }
  const verifyMatch = url.pathname.match(/^\/payments\/v1\/transactions\/([^/]+)\/verify$/);
  if (verifyMatch && req.method === "POST") {
    return mutate(req, res, 200, async () => {
      try {
        return await verifyMatchAndDeliver(decodeURIComponent(verifyMatch[1]), {}, "manual_verify");
      } catch (cause) {
        throw new Error(cause.message);
      }
    });
  }
  if (req.method === "POST" && url.pathname === "/payments/v1/test/simulate-deposit") {
    if (!requireFinanceActor(res, auth)) return;
    if (providerMode !== "simulated") return error(res, 404, "not_found", "Sandbox simulator is disabled.");
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    const account = (await db.query(
      "SELECT * FROM payment_reserved_accounts WHERE operator_id=$1",
      [body.operator_id]
    )).rows[0];
    if (!account) return error(res, 404, "not_found", "Provision a reserved account first.");
    return mutate(req, res, 202, async () => {
      const transactionReference = String(body.transaction_reference || `sim-${Date.now()}`);
      const payload = {
        eventId: `event-${transactionReference}`,
        eventType: "SUCCESSFUL_TRANSACTION",
        eventTime: now(),
        eventData: {
          transactionReference,
          amountPaid: Number(body.amount_ngn),
          paidOn: body.paid_at || now(),
          accountNumber: account.account_number
        }
      };
      const raw = Buffer.from(JSON.stringify(payload));
      return processWebhook(raw, signatureFor(raw));
    });
  }
  if (req.method === "GET" && url.pathname === "/payments/v1/reconciliation-runs") {
    const rows = (await db.query("SELECT * FROM payment_reconciliation_runs ORDER BY created_at DESC")).rows;
    return json(res, 200, { data: rows, next_cursor: null });
  }
  if (req.method === "GET" && url.pathname === "/payments/v1/accounting-period-closes") {
    const rows = (await db.query("SELECT * FROM payment_accounting_period_closes ORDER BY created_at DESC LIMIT 100")).rows;
    return json(res, 200, { data: rows, next_cursor: null });
  }
  if (req.method === "POST" && url.pathname === "/payments/v1/reconciliation-runs") {
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    if (!body.period_start || !body.period_end) return error(res, 400, "validation_failed", "period_start and period_end are required.");
    return mutate(req, res, 202, async () => {
      await db.query(
        `UPDATE payment_deposit_transactions
         SET status='reconciled', reconciled_at=COALESCE(reconciled_at,$3)
         WHERE paid_at BETWEEN $1 AND $2
           AND status='delivered_to_ops'`,
        [body.period_start, body.period_end, now()]
      );
      const deposits = (await db.query(
        "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('reconciled','settled','finance_approved'))::int AS matched FROM payment_deposit_transactions WHERE paid_at BETWEEN $1 AND $2",
        [body.period_start, body.period_end]
      )).rows[0];
      const run = {
        reconciliation_run_id: id("reconciliation"),
        period_start: body.period_start,
        period_end: body.period_end,
        status: Number(deposits.total) === Number(deposits.matched) ? "completed" : "completed_with_exceptions",
        provider_transactions: Number(deposits.total),
        matched_transactions: Number(deposits.matched),
        exceptions: Number(deposits.total) - Number(deposits.matched),
        created_at: now(),
        completed_at: now()
      };
      await db.query(
        `INSERT INTO payment_reconciliation_runs
         (reconciliation_run_id, period_start, period_end, status, provider_transactions,
          matched_transactions, exceptions, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        Object.values(run)
      );
      return run;
    });
  }
  if (req.method === "POST" && url.pathname === "/payments/v1/accounting-period-closes") {
    if (!requireFinanceActor(res, auth)) return;
    const body = JSON.parse((await rawBody(req)).toString("utf8") || "{}");
    if (!body.period_start || !body.period_end) return error(res, 400, "validation_failed", "period_start and period_end are required.");
    return mutate(req, res, 201, async () => {
      const summary = (await db.query(
        `SELECT
          COUNT(*)::int AS deposit_count,
          COUNT(*) FILTER (WHERE status IN ('reconciled','settled','finance_approved'))::int AS reconciled_count,
          COUNT(*) FILTER (WHERE status IN ('settled','finance_approved'))::int AS settled_count,
          COUNT(*) FILTER (WHERE status='finance_approved')::int AS finance_approved_count,
          COUNT(*) FILTER (WHERE status NOT IN ('reconciled','settled','finance_approved'))::int AS exception_count,
          COALESCE(SUM(amount_ngn),0) AS total_amount_ngn,
          COALESCE(SUM(settlement_amount_ngn),0) AS settlement_amount_ngn
         FROM payment_deposit_transactions
         WHERE paid_at BETWEEN $1 AND $2`,
        [body.period_start, body.period_end]
      )).rows[0];
      const providerExceptionCount = Number(summary.exception_count);
      const opsExceptionCount = Math.max(0, Number(body.ops_exception_count || 0));
      const exceptionCount = providerExceptionCount + opsExceptionCount;
      const close = {
        accounting_period_close_id: id("period_close"),
        period_start: body.period_start,
        period_end: body.period_end,
        status: exceptionCount === 0 ? "closed" : "closed_with_exceptions",
        deposit_count: Number(summary.deposit_count),
        reconciled_count: Number(summary.reconciled_count),
        settled_count: Number(summary.settled_count),
        finance_approved_count: Number(summary.finance_approved_count),
        provider_exception_count: providerExceptionCount,
        ops_exception_count: opsExceptionCount,
        exception_count: exceptionCount,
        total_amount_ngn: Number(summary.total_amount_ngn),
        settlement_amount_ngn: Number(summary.settlement_amount_ngn),
        notes: body.notes || null,
        closed_by_person_id: actorPersonId(req, auth),
        created_at: now()
      };
      await db.query(
        `INSERT INTO payment_accounting_period_closes
         (accounting_period_close_id, period_start, period_end, status, deposit_count,
          reconciled_count, settled_count, finance_approved_count, provider_exception_count,
          ops_exception_count, exception_count, total_amount_ngn, settlement_amount_ngn,
          notes, closed_by_person_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        Object.values(close)
      );
      return close;
    });
  }

  return error(res, 404, "not_found", "Route not found.");
}

const server = http.createServer((req, res) => {
  routes(req, res).catch((cause) => error(res, 500, "internal_error", cause.message));
});

await new Promise((resolve) => server.listen(port, host, resolve));
console.log(`Payments Integration API: http://${host}:${port}`);

async function shutdown() {
  await db.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
