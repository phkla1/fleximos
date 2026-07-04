import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4430;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4431;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const paymentsPort = 4432;
const paymentsBaseUrl = `http://127.0.0.1:${paymentsPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-api-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-auth-test-${Date.now()}`);
const closedPaymentDates = new Set();
let server;
let foundationServer;
let paymentsServer;

async function startServer() {
  paymentsServer = http.createServer((req, res) => {
    if (req.url === "/payments/v1/accounting-period-closes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [...closedPaymentDates].map((date) => ({
          accounting_period_close_id: `period_close_${date.replaceAll("-", "")}`,
          period_start: `${date}T00:00:00+01:00`,
          period_end: `${date}T23:59:59+01:00`,
          status: "closed",
          deposit_count: 0,
          reconciled_count: 0,
          settled_count: 0,
          finance_approved_count: 0,
          provider_exception_count: 0,
          ops_exception_count: 0,
          exception_count: 0,
          total_amount_ngn: 0,
          settlement_amount_ngn: 0,
          closed_by_person_id: "person_finance",
          created_at: `${date}T23:59:59+01:00`
        })),
        next_cursor: null
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => paymentsServer.listen(paymentsPort, "127.0.0.1", resolve));

  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(foundationPort),
      HOST: "127.0.0.1",
      FLEXI_DB_DIR: foundationDbDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  foundationServer.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let foundationOutput = "";
  while (!foundationOutput.includes("Foundation API:")) {
    const [chunk] = await once(foundationServer.stdout, "data");
    foundationOutput += String(chunk);
  }

  server = spawn("npx", ["tsx", "apps/ops-api/src/main.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir,
      FOUNDATION_API_BASE: foundationBaseUrl,
      PAYMENTS_API_BASE: paymentsBaseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let output = "";
  while (!output.includes("Ops API:")) {
    const [chunk] = await once(server.stdout, "data");
    output += String(chunk);
  }
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

test.before(startServer);
test.after(() => {
  server?.kill();
  foundationServer?.kill();
  paymentsServer?.close();
});

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "ops-api");
});

test("accepts Identity sessions and enforces management roles", async () => {
  const ownerLogin = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "+2347033550173", pin: "000000" })
  });
  const ownerTokens = await ownerLogin.json();
  const ownerAudit = await fetch(`${baseUrl}/ops/v1/audit`, {
    headers: { Authorization: `Bearer ${ownerTokens.access_token}` }
  });
  assert.equal(ownerAudit.status, 200);

  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-auth-person-001"
    },
    body: JSON.stringify({
      display_name: "Restricted Operator",
      phone: "+2347000000099"
    })
  }).then((response) => response.json());
  await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-auth-user-001"
    },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  });
  const operatorLogin = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "+2347000000099", pin: "000000" })
  }).then((response) => response.json());
  const forbidden = await fetch(`${baseUrl}/ops/v1/vehicles`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${operatorLogin.access_token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-auth-forbidden-001"
    },
    body: JSON.stringify({ plate: "NOACCESS", vehicle_type: "car", amoeba_id: "amoeba_mainland" })
  });
  assert.equal(forbidden.status, 403);
});

test("scopes supervisor and operator reads inside the Ops API", async () => {
  async function createIdentity(displayName, phone, roles, suffix) {
    const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ops-scope-person-${suffix}`
      },
      body: JSON.stringify({ display_name: displayName, phone })
    }).then((response) => response.json());
    await fetch(`${foundationBaseUrl}/identity/v1/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ops-scope-user-${suffix}`
      },
      body: JSON.stringify({ person_id: person.person_id, roles, status: "active" })
    });
    return person;
  }

  const supervisor = await createIdentity("Scope Supervisor", "+2347000000081", ["supervisor"], "supervisor");
  const ownPerson = await createIdentity("Assigned Operator", "+2347000000082", ["operator"], "assigned");
  const otherPerson = await createIdentity("Other Operator", "+2347000000083", ["operator"], "other");

  const ownOperator = await request("/ops/v1/operators", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-scope-operator-assigned" },
    body: JSON.stringify({
      person_id: ownPerson.person_id,
      operator_type: "driver",
      operator_status: "active",
      amoeba_id: "amoeba_mainland",
      site_id: "site_mainland_1",
      supervisor_person_id: supervisor.person_id
    })
  });
  await request("/ops/v1/operators", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-scope-operator-other" },
    body: JSON.stringify({
      person_id: otherPerson.person_id,
      operator_type: "driver",
      operator_status: "active",
      amoeba_id: "amoeba_island",
      site_id: "site_island_1",
      supervisor_person_id: "person_founder_wole"
    })
  });

  const supervisorToken = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: supervisor.phone, pin: "000000" })
  }).then((response) => response.json());
  const supervisorRoster = await fetch(`${baseUrl}/ops/v1/operators`, {
    headers: { Authorization: `Bearer ${supervisorToken.access_token}` }
  }).then((response) => response.json());
  assert.deepEqual(supervisorRoster.data.map((operator) => operator.person_id), [ownPerson.person_id]);

  const operatorToken = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: ownPerson.phone, pin: "000000" })
  }).then((response) => response.json());
  const operatorRoster = await fetch(`${baseUrl}/ops/v1/operators`, {
    headers: { Authorization: `Bearer ${operatorToken.access_token}` }
  }).then((response) => response.json());
  assert.equal(operatorRoster.data.length, 1);
  assert.equal(operatorRoster.data[0].operator_id, ownOperator.body.operator_id);
});

test("unions Manager and Finance assignments without granting system administration", async () => {
  async function createScopedUser(displayName, phone, role, scopeId, suffix) {
    const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ops-business-person-${suffix}`
      },
      body: JSON.stringify({ display_name: displayName, phone })
    }).then((response) => response.json());
    await fetch(`${foundationBaseUrl}/identity/v1/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ops-business-user-${suffix}`
      },
      body: JSON.stringify({ person_id: person.person_id, roles: [role], status: "active" })
    });
    await fetch(`${foundationBaseUrl}/identity/v1/role-assignments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `ops-business-assignment-${suffix}`
      },
      body: JSON.stringify({
        person_id: person.person_id,
        role,
        scope_type: "amoeba",
        scope_id: scopeId
      })
    });
    const session = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_or_email: phone, pin: "000000" })
    }).then((response) => response.json());
    return { person, token: session.access_token };
  }

  const manager = await createScopedUser("Mainland Manager", "+2347000000071", "manager", "amoeba_mainland", "manager");
  const managerRosterResponse = await fetch(`${baseUrl}/ops/v1/operators`, {
    headers: { Authorization: `Bearer ${manager.token}` }
  });
  assert.equal(managerRosterResponse.status, 200);
  const managerRoster = await managerRosterResponse.json();
  assert.ok(managerRoster.data.length > 0);
  assert.ok(managerRoster.data.every((operator) => operator.amoeba_id === "amoeba_mainland"));

  const forbiddenMutation = await fetch(`${baseUrl}/ops/v1/vehicles`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${manager.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-manager-system-admin-denied"
    },
    body: JSON.stringify({ plate: "MANAGER1", vehicle_type: "car", amoeba_id: "amoeba_mainland" })
  });
  assert.equal(forbiddenMutation.status, 403);

  const managerAdjustment = await fetch(`${baseUrl}/ops/v1/cash/adjustments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${manager.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-manager-cash-adjustment-denied"
    },
    body: JSON.stringify({
      operator_id: managerRoster.data[0].operator_id,
      adjustment_date: "2026-06-11",
      amount_ngn: 1000,
      adjustment_type: "credit",
      reason: "Manager should not be able to adjust cash"
    })
  });
  assert.equal(managerAdjustment.status, 403);

  const finance = await createScopedUser("Island Finance", "+2347000000072", "finance", "amoeba_island", "finance");
  const financeRosterResponse = await fetch(`${baseUrl}/ops/v1/operators`, {
    headers: { Authorization: `Bearer ${finance.token}` }
  });
  assert.equal(financeRosterResponse.status, 200);
  const financeRoster = await financeRosterResponse.json();
  assert.ok(financeRoster.data.length > 0);
  assert.ok(financeRoster.data.every((operator) => operator.amoeba_id === "amoeba_island"));

  const financeAdjustment = await fetch(`${baseUrl}/ops/v1/cash/adjustments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${finance.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-finance-cash-adjustment-allowed"
    },
    body: JSON.stringify({
      operator_id: financeRoster.data[0].operator_id,
      adjustment_date: "2026-06-11",
      amount_ngn: 1000,
      adjustment_type: "credit",
      reason: "Finance scoped cash correction"
    })
  });
  assert.equal(financeAdjustment.status, 201);

  const secondAssignment = await fetch(`${foundationBaseUrl}/identity/v1/role-assignments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "ops-manager-assignment-union"
    },
    body: JSON.stringify({
      person_id: manager.person.person_id,
      role: "manager",
      scope_type: "amoeba",
      scope_id: "amoeba_island"
    })
  });
  assert.equal(secondAssignment.status, 201);
  const unionRoster = await fetch(`${baseUrl}/ops/v1/operators`, {
    headers: { Authorization: `Bearer ${manager.token}` }
  }).then((response) => response.json());
  assert.ok(unionRoster.data.some((operator) => operator.amoeba_id === "amoeba_mainland"));
  assert.ok(unionRoster.data.some((operator) => operator.amoeba_id === "amoeba_island"));
});

test("lists seeded roster, connector accounts, and alerts", async () => {
  const operators = await request("/ops/v1/operators");
  assert.equal(operators.response.status, 200);
  assert.equal(operators.body.data[0].operator_id, "operator_demo_wole");
  assert.equal(operators.body.data[0].platform_registrations.length, 1);

  const platforms = await request("/ops/v1/platform-accounts");
  assert.equal(platforms.body.data.length, 3);

  const alerts = await request("/ops/v1/alerts?resolution_status=open");
  assert.equal(alerts.body.data.length, 2);
});

test("creates operators idempotently and records audit", async () => {
  const payload = {
    person_id: "person_test_operator",
    operator_type: "driver",
    amoeba_id: "amoeba_mainland",
    site_id: "site_mainland_1",
    daily_revenue_target_ngn: 30000
  };
  const options = {
    method: "POST",
    headers: { "Idempotency-Key": "ops-create-operator-001" },
    body: JSON.stringify(payload)
  };
  const first = await request("/ops/v1/operators", options);
  const second = await request("/ops/v1/operators", options);

  assert.equal(first.response.status, 201);
  assert.equal(first.body.operator_id, second.body.operator_id);

  const audit = await request("/ops/v1/audit");
  assert.ok(audit.body.data.some((entry) => entry.action === "operator.created"));
});

test("updates operator status", async () => {
  const update = await request("/ops/v1/operators/operator_demo_wole", {
    method: "PATCH",
    headers: { "Idempotency-Key": "ops-update-operator-001" },
    body: JSON.stringify({ operator_status: "suspended" })
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.operator_status, "suspended");
});

test("accepts idempotent Monnify account and cash updates from a service account", async () => {
  await request("/ops/v1/operators/operator_demo_wole", {
    method: "PATCH",
    headers: { "Idempotency-Key": "ops-cash-reactivate-operator-001" },
    body: JSON.stringify({ operator_status: "active" })
  });
  const operatorResponse = await request("/ops/v1/operators/operator_demo_wole");
  const operator = operatorResponse.body;
  assert.ok(operator?.operator_id);

  const account = await request(`/ops/v1/operators/${operator.operator_id}/monnify-account`, {
    method: "PATCH",
    headers: { "Idempotency-Key": "ops-monnify-account-001" },
    body: JSON.stringify({ monnify_account_number: "9900000001" })
  });
  assert.equal(account.response.status, 200);
  assert.equal(account.body.monnify_reserved_account, "9900000001");

  const transactionBody = {
    operator_id: operator.operator_id,
    amount_ngn: 12500,
    transaction_ref: "ops-monnify-transaction-001",
    paid_at: "2026-06-12T12:00:00+01:00",
    monnify_account_number: "9900000001",
    reconciliation_status: "matched"
  };
  const transaction = await request("/ops/v1/cash/transactions", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-monnify-cash-001" },
    body: JSON.stringify(transactionBody)
  });
  assert.equal(transaction.response.status, 201);
  assert.equal(Number(transaction.body.amount_ngn), 12500);

  const providerReplay = await request("/ops/v1/cash/transactions", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-monnify-cash-002" },
    body: JSON.stringify(transactionBody)
  });
  assert.equal(providerReplay.body.cash_transaction_id, transaction.body.cash_transaction_id);

  const position = await request(`/ops/v1/operators/${operator.operator_id}/cash`);
  assert.equal(position.response.status, 200);
  assert.equal(position.body.transaction_count, 1);
  assert.equal(position.body.total_remitted_ngn, 12500);

  const cashDate = "2026-06-12";
  const ingestion = await request("/ops/v1/ingestion-runs", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-cash-closeout-ingestion-001" },
    body: JSON.stringify({
      platform_account_id: "platform_bolt_lagos",
      record_date: cashDate,
      source: "connector_test",
      records: [{
        platform_operator_id: "bolt-demo-driver",
        trips_total: 5,
        trips_completed: 4,
        trips_cancelled: 1,
        trips_no_response: 0,
        trips_rejected: 0,
        ride_revenue_ngn: 25000,
        net_earnings_ngn: 21000,
        booking_fees_ngn: 1500,
        cash_trips: 2,
        card_trips: 2,
        acceptance_pct: 100,
        cancellation_pct: 20,
        completion_pct: 80,
        hours_online: 6,
        current_status: "online"
      }]
    })
  });
  assert.equal(ingestion.response.status, 201);

  const status = await request(`/ops/v1/cash/status?record_date=${cashDate}&operator_id=${operator.operator_id}`);
  assert.equal(status.response.status, 200);
  assert.equal(status.body.data[0].expected_cash_ngn, 12500);
  assert.equal(status.body.data[0].remitted_cash_ngn, 12500);
  assert.equal(status.body.data[0].cash_status, "balanced");

  const adjustment = await request("/ops/v1/cash/adjustments", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-cash-adjustment-001" },
    body: JSON.stringify({
      operator_id: operator.operator_id,
      adjustment_date: cashDate,
      amount_ngn: -2500,
      adjustment_type: "debit",
      reason: "Finance test debit",
      evidence_reference: "bank-statement-test-line-01"
    })
  });
  assert.equal(adjustment.response.status, 201);
  assert.equal(adjustment.body.evidence_reference, "bank-statement-test-line-01");

  const adjustments = await request(`/ops/v1/cash/adjustments?adjustment_date=${cashDate}&operator_id=${operator.operator_id}`);
  assert.equal(adjustments.response.status, 200);
  assert.equal(adjustments.body.data.length, 1);
  assert.equal(adjustments.body.data[0].reason, "Finance test debit");
  assert.equal(adjustments.body.data[0].evidence_reference, "bank-statement-test-line-01");

  const adjusted = await request(`/ops/v1/cash/status?record_date=${cashDate}&operator_id=${operator.operator_id}`);
  assert.equal(adjusted.body.data[0].net_position_ngn, -2500);
  assert.equal(adjusted.body.data[0].cash_status, "shortfall");

  closedPaymentDates.add("2026-06-14");
  const lockedAdjustment = await request("/ops/v1/cash/adjustments", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-cash-adjustment-locked-period" },
    body: JSON.stringify({
      operator_id: operator.operator_id,
      adjustment_date: "2026-06-14",
      amount_ngn: 500,
      adjustment_type: "credit",
      reason: "Should be blocked after accounting close"
    })
  });
  assert.equal(lockedAdjustment.response.status, 403);

  const closeout = await request("/ops/v1/daily-closeouts", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-daily-closeout-001" },
    body: JSON.stringify({
      record_date: cashDate,
      amoeba_id: operator.amoeba_id,
      unresolved_alert_count: 1,
      notes: "Supervisor confirmed cash review for test run."
    })
  });
  assert.equal(closeout.response.status, 201);
  assert.equal(closeout.body.cash_summary.shortfall_count, 1);

  const closeouts = await request(`/ops/v1/daily-closeouts?record_date=${cashDate}`);
  assert.ok(closeouts.body.data.some((item) => item.closeout_id === closeout.body.closeout_id));
});

test("ingests normalized platform data with per-record rejection and safe replay", async () => {
  await request("/ops/v1/operators/operator_demo_wole", {
    method: "PATCH",
    headers: { "Idempotency-Key": "ops-reactivate-operator-001" },
    body: JSON.stringify({ operator_status: "active" })
  });
  const recordDate = "2026-06-06";
  const payload = {
    platform_account_id: "platform_bolt_lagos",
    record_date: recordDate,
    source: "connector_test",
    records: [
      {
        platform_operator_id: "bolt-demo-driver",
        trips_total: 12,
        trips_completed: 10,
        trips_cancelled: 1,
        trips_no_response: 1,
        ride_revenue_ngn: 22000,
        net_earnings_ngn: 18500,
        booking_fees_ngn: 1500,
        cash_trips: 4,
        card_trips: 6,
        acceptance_pct: 91.67,
        cancellation_pct: 8.33,
        completion_pct: 83.33,
        hours_online: 7.5,
        official_distance_km: 82.5,
        current_status: "online",
        last_seen_at: "2026-06-06T13:30:00.000Z",
        data_quality: "authoritative",
        provenance: { connector: "bolt", fixture: true }
      },
      {
        platform_operator_id: "missing-driver",
        trips_total: 1
      }
    ]
  };
  const first = await request("/ops/v1/ingestion-runs", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-ingestion-001" },
    body: JSON.stringify(payload)
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.status, "completed_with_errors");
  assert.equal(first.body.records_upserted, 1);
  assert.equal(first.body.records_rejected, 1);

  payload.records = [{ ...payload.records[0], ride_revenue_ngn: 25000 }];
  const replay = await request("/ops/v1/ingestion-runs", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-ingestion-002" },
    body: JSON.stringify(payload)
  });
  assert.equal(replay.body.status, "completed");

  const daily = await request(`/ops/v1/daily-performance?record_date=${recordDate}`);
  assert.equal(daily.body.data.length, 1);
  assert.equal(Number(daily.body.data[0].ride_revenue_ngn), 25000);
  assert.equal(daily.body.data[0].data_quality, "authoritative");

  const board = await request(`/ops/v1/team-board?record_date=${recordDate}`);
  const demoBoard = board.body.data.find((item) => item.operator_id === "operator_demo_wole");
  assert.equal(demoBoard.current_status, "online");
  assert.equal(Number(demoBoard.ride_revenue_ngn), 25000);
  assert.equal(demoBoard.pace_status, "on_track");
  assert.equal(Number(demoBoard.expected_revenue_ngn), 25000);
});

test("configures revenue pace and fuel efficiency controls", async () => {
  const profiles = await request("/ops/v1/revenue-pace-profiles");
  assert.equal(profiles.response.status, 200);
  assert.equal(profiles.body.data.length, 2);

  const pace = await request("/ops/v1/revenue-pace-profiles", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-pace-profile-001" },
    body: JSON.stringify({
      vehicle_type: "motorbike",
      day_type: "weekend",
      daily_target_ngn: 30000,
      checkpoints: [
        { time: "12:00", expected_pct: 35 },
        { time: "16:00", expected_pct: 60 },
        { time: "19:00", expected_pct: 88 },
        { time: "21:00", expected_pct: 100 }
      ],
      warning_tolerance_pct: 10,
      critical_tolerance_pct: 20,
      effective_from: "2026-06-07"
    })
  });
  assert.equal(pace.response.status, 201);
  assert.equal(pace.body.vehicle_type, "motorbike");

  const policies = await request("/ops/v1/vehicle-efficiency-policies");
  assert.equal(policies.body.data.length, 2);

  const fuel = await request("/ops/v1/fuel-issues", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-fuel-issue-001" },
    body: JSON.stringify({
      operator_id: "operator_demo_wole",
      vehicle_id: "vehicle_demo_001",
      operating_date: "2026-06-06",
      quantity: 5,
      unit: "litres"
    })
  });
  assert.equal(fuel.response.status, 201);
  assert.equal(Number(fuel.body.quantity), 5);

  const reconciliation = await request("/ops/v1/mileage-reconciliations?record_date=2026-06-06");
  assert.equal(reconciliation.response.status, 200);
  assert.equal(reconciliation.body.data[0].tracker_variance_status, "tracker_unavailable");
  assert.equal(reconciliation.body.data[0].official_distance_status, "exception");
});

test("generates immutable daily report revisions", async () => {
  const first = await request("/ops/v1/daily-reports", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-daily-report-001" },
    body: JSON.stringify({ record_date: "2026-06-06" })
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.revision, 1);
  assert.ok(first.body.summary.revenue_total_ngn > 0);
  assert.ok(first.body.rows.length > 0);

  const second = await request("/ops/v1/daily-reports", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-daily-report-002" },
    body: JSON.stringify({ record_date: "2026-06-06" })
  });
  assert.equal(second.body.revision, 2);

  const reports = await request("/ops/v1/daily-reports?record_date=2026-06-06");
  assert.equal(reports.body.data.length, 2);
  assert.equal(reports.body.data[0].revision, 2);
});

test("registers scheduled jobs and records replay lifecycle", async () => {
  const jobs = await request("/ops/v1/scheduled-jobs");
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.body.data.length, 15);
  assert.ok(jobs.body.data.some((job) => job.job_name === "uber-distance-report-backfill"
    && job.freshness_status === "pending_source"));

  const queued = await request("/ops/v1/scheduled-jobs/daily-report-generate/runs", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-job-enqueue-001" },
    body: JSON.stringify({
      requested_window_start: "2026-06-06T00:00:00+01:00",
      requested_window_end: "2026-06-06T23:59:59+01:00"
    })
  });
  assert.equal(queued.response.status, 201);
  assert.equal(queued.body.status, "queued");

  const duplicate = await request("/ops/v1/scheduled-jobs/daily-report-generate/runs", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-job-enqueue-duplicate-001" },
    body: JSON.stringify({
      requested_window_start: "2026-06-06T00:00:00+01:00",
      requested_window_end: "2026-06-06T23:59:59+01:00",
      scheduler_trigger_id: queued.body.scheduler_trigger_id
    })
  });
  assert.equal(duplicate.body.scheduled_job_run_id, queued.body.scheduled_job_run_id);

  const completed = await request(`/ops/v1/scheduled-job-runs/${queued.body.scheduled_job_run_id}/complete`, {
    method: "POST",
    headers: { "Idempotency-Key": "ops-job-complete-001" },
    body: JSON.stringify({ status: "completed", records_received: 1, records_upserted: 1 })
  });
  assert.equal(completed.body.status, "completed");

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.database, "ok");
  assert.equal(health.scheduled_jobs.total, 15);
  assert.equal(health.queue_depths.reports, 0);
});

test("acknowledges and resolves an alert with audit history", async () => {
  const acknowledge = await request("/ops/v1/alerts/alert_demo_offline/acknowledge", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-alert-ack-001" },
    body: JSON.stringify({ note: "Supervisor called operator." })
  });
  assert.equal(acknowledge.response.status, 200);
  assert.equal(acknowledge.body.resolution_status, "acknowledged");

  const resolve = await request("/ops/v1/alerts/alert_demo_offline/resolve", {
    method: "POST",
    headers: { "Idempotency-Key": "ops-alert-resolve-001" },
    body: JSON.stringify({ resolution_notes: "Operator resumed work." })
  });
  assert.equal(resolve.response.status, 200);
  assert.equal(resolve.body.resolution_status, "resolved");
});
