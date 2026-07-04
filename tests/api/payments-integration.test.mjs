import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const paymentsPort = 4541;
const opsPort = 4540;
const foundationPort = 4543;
const paymentsBase = `http://127.0.0.1:${paymentsPort}`;
const token = "flexi-dev-service-token";
const webhookSecret = "flexi-monnify-sandbox-secret";
const dbDir = path.join(tmpdir(), `fleximos-payments-test-${Date.now()}`);
const opsState = {
  accounts: new Map(),
  cashTransactions: new Map()
};
let paymentsServer;
let opsServer;
let foundationServer;

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

test.before(async () => {
  opsServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { message: "unauthorized" });
    const accountMatch = req.url.match(/^\/ops\/v1\/operators\/([^/]+)\/monnify-account$/);
    if (req.method === "PATCH" && accountMatch) {
      const body = await readJson(req);
      opsState.accounts.set(accountMatch[1], body.monnify_account_number);
      return send(res, 200, { operator_id: accountMatch[1], monnify_reserved_account: body.monnify_account_number });
    }
    if (req.method === "POST" && req.url === "/ops/v1/cash/transactions") {
      const body = await readJson(req);
      if (!opsState.cashTransactions.has(body.transaction_ref)) {
        opsState.cashTransactions.set(body.transaction_ref, body);
      }
      return send(res, 201, body);
    }
    return send(res, 404, { message: "not found" });
  });
  await new Promise((resolve) => opsServer.listen(opsPort, "127.0.0.1", resolve));

  foundationServer = http.createServer((req, res) => {
    if (req.url !== "/identity/v1/me") return send(res, 404, { message: "not found" });
    if (req.headers.authorization === "Bearer dev_access_finance") {
      return send(res, 200, {
        actor_type: "human",
        person_id: "person_finance_human",
        user_id: "finance",
        roles: [],
        role_assignments: [{ role: "finance", scope_type: "amoeba", scope_id: "amoeba_mainland", status: "active" }]
      });
    }
    if (req.headers.authorization === "Bearer dev_access_manager") {
      return send(res, 200, {
        actor_type: "human",
        person_id: "person_manager_human",
        user_id: "manager",
        roles: [],
        role_assignments: [{ role: "manager", scope_type: "amoeba", scope_id: "amoeba_mainland", status: "active" }]
      });
    }
    return send(res, 401, { message: "unauthorized" });
  });
  await new Promise((resolve) => foundationServer.listen(foundationPort, "127.0.0.1", resolve));

  paymentsServer = spawn("node", ["apps/payments-integration/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(paymentsPort),
      HOST: "127.0.0.1",
      FLEXI_PAYMENTS_DB_DIR: dbDir,
      OPS_API_BASE: `http://127.0.0.1:${opsPort}`,
      FOUNDATION_API_BASE: `http://127.0.0.1:${foundationPort}`,
      MONNIFY_PROVIDER_MODE: "simulated"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  paymentsServer.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let output = "";
  while (!output.includes("Payments Integration API:")) {
    const [chunk] = await once(paymentsServer.stdout, "data");
    output += String(chunk);
  }
});

test.after(() => {
  paymentsServer?.kill();
  opsServer?.close();
  foundationServer?.close();
});

async function request(url, options = {}) {
  const response = await fetch(`${paymentsBase}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

function monnifySignature(payload) {
  return createHmac("sha512", webhookSecret).update(Buffer.from(JSON.stringify(payload))).digest("hex");
}

test("health exposes simulated Monnify mode", async () => {
  const response = await fetch(`${paymentsBase}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, "payments-integration");
  assert.equal(body.provider_mode, "simulated");
});

test("provisions one reserved account and pushes the mapping to Ops", async () => {
  const result = await request("/payments/v1/operators/operator_test/reserved-account", {
    method: "POST",
    headers: { "Idempotency-Key": "provision-operator-test" },
    body: JSON.stringify({
      customer_name: "Test Operator",
      customer_email: "operator@example.com",
      amoeba_id: "amoeba_mainland"
    })
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.operator_id, "operator_test");
  assert.equal(result.body.status, "active");
  assert.equal(opsState.accounts.get("operator_test"), result.body.account_number);

  const replay = await request("/payments/v1/operators/operator_test/reserved-account", {
    method: "POST",
    headers: { "Idempotency-Key": "provision-operator-test" },
    body: JSON.stringify({
      customer_name: "Test Operator",
      customer_email: "operator@example.com"
    })
  });
  assert.equal(replay.body.reserved_account_id, result.body.reserved_account_id);
});

test("requires a Finance assignment for Payments mutations made by human users", async () => {
  const denied = await request("/payments/v1/test/simulate-deposit", {
    method: "POST",
    headers: {
      Authorization: "Bearer dev_access_manager",
      "Idempotency-Key": "manager-simulate-denied"
    },
    body: JSON.stringify({
      operator_id: "operator_test",
      amount_ngn: 5000,
      transaction_reference: "txn_manager_denied",
      paid_at: "2026-06-12T10:00:00+01:00"
    })
  });
  assert.equal(denied.response.status, 403);

  const allowed = await request("/payments/v1/test/simulate-deposit", {
    method: "POST",
    headers: {
      Authorization: "Bearer dev_access_finance",
      "Idempotency-Key": "finance-simulate-allowed"
    },
    body: JSON.stringify({
      operator_id: "operator_test",
      amount_ngn: 2500,
      transaction_reference: "txn_finance_allowed",
      paid_at: "2026-06-14T11:00:00+01:00"
    })
  });
  assert.equal(allowed.response.status, 202);
});

test("simulates a signed deposit and delivers it to Ops exactly once", async () => {
  const initialDeliveryCount = opsState.cashTransactions.size;
  const deposit = await request("/payments/v1/test/simulate-deposit", {
    method: "POST",
    headers: { "Idempotency-Key": "simulate-deposit-test-001" },
    body: JSON.stringify({
      operator_id: "operator_test",
      amount_ngn: 12500,
      transaction_reference: "txn_sandbox_001",
      paid_at: "2026-06-12T12:00:00+01:00"
    })
  });
  assert.equal(deposit.response.status, 202);
  assert.equal(deposit.body.status, "delivered");
  assert.equal(opsState.cashTransactions.size, initialDeliveryCount + 1);
  assert.equal(opsState.cashTransactions.get("txn_sandbox_001").amount_ngn, 12500);

  const duplicateProviderEvent = await request("/payments/v1/test/simulate-deposit", {
    method: "POST",
    headers: { "Idempotency-Key": "simulate-deposit-test-002" },
    body: JSON.stringify({
      operator_id: "operator_test",
      amount_ngn: 12500,
      transaction_reference: "txn_sandbox_001"
    })
  });
  assert.equal(duplicateProviderEvent.response.status, 202);
  assert.equal(duplicateProviderEvent.body.duplicate, true);
  assert.equal(opsState.cashTransactions.size, initialDeliveryCount + 1);

  const verified = await request("/payments/v1/transactions/txn_sandbox_001/verify", {
    method: "POST",
    headers: { "Idempotency-Key": "verify-transaction-test-001" }
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.status, "delivered_to_ops");

  const transactions = await request("/payments/v1/transactions");
  const transaction = transactions.body.data.find((item) => item.transaction_reference === "txn_sandbox_001");
  assert.equal(transaction.status, "delivered_to_ops");
});

test("rejects invalid webhook signatures and quarantines unknown accounts", async () => {
  const invalidPayload = {
    eventId: "event-invalid-signature",
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      transactionReference: "txn_invalid_signature",
      amountPaid: 5000,
      accountNumber: opsState.accounts.get("operator_test")
    }
  };
  const invalid = await fetch(`${paymentsBase}/payments/v1/webhooks/monnify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "monnify-signature": "bad-signature" },
    body: JSON.stringify(invalidPayload)
  });
  assert.equal(invalid.status, 401);

  const unknownPayload = {
    eventId: "event-unknown-account",
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: {
      transactionReference: "txn_unknown_account",
      amountPaid: 7000,
      paidOn: "2026-06-12T13:00:00+01:00",
      accountNumber: "9999999999"
    }
  };
  const unknown = await fetch(`${paymentsBase}/payments/v1/webhooks/monnify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "monnify-signature": monnifySignature(unknownPayload) },
    body: JSON.stringify(unknownPayload)
  });
  assert.equal(unknown.status, 202);
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.status, "quarantined");

  const evidence = await request("/payments/v1/webhook-events");
  assert.ok(evidence.body.data.some((event) => event.status === "rejected"));
  assert.ok(evidence.body.data.some((event) => event.status === "quarantined"));
});

test("records a bounded reconciliation run", async () => {
  const result = await request("/payments/v1/reconciliation-runs", {
    method: "POST",
    headers: { "Idempotency-Key": "reconcile-sandbox-20260612" },
    body: JSON.stringify({
      period_start: "2026-06-12T00:00:00+01:00",
      period_end: "2026-06-12T23:59:59+01:00"
    })
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.body.status, "completed");
  assert.equal(result.body.provider_transactions, 1);
  assert.equal(result.body.matched_transactions, 1);

  const transactions = await request("/payments/v1/transactions");
  const transaction = transactions.body.data.find((item) => item.transaction_reference === "txn_sandbox_001");
  assert.equal(transaction.status, "reconciled");
});

test("settles, finance-approves, and closes an accounting period", async () => {
  const settled = await request("/payments/v1/transactions/txn_sandbox_001/settle", {
    method: "POST",
    headers: { "Idempotency-Key": "settle-sandbox-001", "X-Actor-Person-Id": "person_finance" },
    body: JSON.stringify({ notes: "Bank settlement confirmed." })
  });
  assert.equal(settled.response.status, 200);
  assert.equal(settled.body.status, "settled");

  const approved = await request("/payments/v1/transactions/txn_sandbox_001/finance-approve", {
    method: "POST",
    headers: { "Idempotency-Key": "approve-sandbox-001", "X-Actor-Person-Id": "person_finance" },
    body: JSON.stringify({ notes: "Finance approved for period close." })
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "finance_approved");

  const close = await request("/payments/v1/accounting-period-closes", {
    method: "POST",
    headers: { "Idempotency-Key": "period-close-20260612", "X-Actor-Person-Id": "person_finance" },
    body: JSON.stringify({
      period_start: "2026-06-12T00:00:00+01:00",
      period_end: "2026-06-12T23:59:59+01:00",
      notes: "Phase 4D closeout test."
    })
  });
  assert.equal(close.response.status, 201);
  assert.equal(close.body.status, "closed");
  assert.equal(close.body.deposit_count, 1);
  assert.equal(close.body.finance_approved_count, 1);
  assert.equal(close.body.provider_exception_count, 0);
  assert.equal(close.body.ops_exception_count, 0);

  const closes = await request("/payments/v1/accounting-period-closes");
  assert.ok(closes.body.data.some((item) => item.accounting_period_close_id === close.body.accounting_period_close_id));
});

test("includes Ops cash exceptions when closing an accounting period", async () => {
  const close = await request("/payments/v1/accounting-period-closes", {
    method: "POST",
    headers: { "Idempotency-Key": "period-close-20260613", "X-Actor-Person-Id": "person_finance" },
    body: JSON.stringify({
      period_start: "2026-06-13T00:00:00+01:00",
      period_end: "2026-06-13T23:59:59+01:00",
      ops_exception_count: 2,
      notes: "Ops cash exceptions remain visible."
    })
  });
  assert.equal(close.response.status, 201);
  assert.equal(close.body.status, "closed_with_exceptions");
  assert.equal(close.body.provider_exception_count, 0);
  assert.equal(close.body.ops_exception_count, 2);
  assert.equal(close.body.exception_count, 2);
});
