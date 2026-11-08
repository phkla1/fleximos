import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const port = 4486;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4487;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-unmatched-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-unmatched-auth-test-${Date.now()}`);
const repoRoot = new URL("../..", import.meta.url).pathname;

let server, foundationServer;

async function startServer() {
  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(foundationPort), HOST: "127.0.0.1", FLEXI_DB_DIR: foundationDbDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  foundationServer.stderr.on("data", (c) => process.stderr.write(c));
  let out = "";
  while (!out.includes("Foundation API:")) { const [c] = await once(foundationServer.stdout, "data"); out += String(c); }

  server = spawn("npx", ["tsx", "apps/ops-api/src/main.ts"], {
    cwd: repoRoot,
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1", FLEXI_OPS_DB_DIR: dbDir, FOUNDATION_API_BASE: foundationBaseUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (c) => process.stderr.write(c));
  let o = "";
  while (!o.includes("Ops API:")) { const [c] = await once(server.stdout, "data"); o += String(c); }
}

function as(bearer) {
  return async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(token);
const anon = as(null);

test.before(startServer);
test.after(() => { server?.kill(); foundationServer?.kill(); });

test("an unmapped driver's record is quarantined, not discarded, and surfaced", async () => {
  const accounts = await admin("/ops/v1/platform-accounts");
  const account = (accounts.body.data || [])[0];
  assert.ok(account, "a seeded platform account is required");

  const uuid = `unmapped-e2e-${randomUUID().slice(0, 8)}`;
  const run = await admin("/ops/v1/ingestion-runs", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      platform_account_id: account.platform_account_id,
      record_date: "2026-11-07",
      source: "live",
      records: [{ platform_operator_id: uuid, driver_name: "Quarantine Test Driver", driver_phone: "+2340000000000", net_earnings_ngn: 50000 }]
    })
  });
  assert.equal(run.response.status, 201);
  // The record was rejected from daily records...
  assert.equal(Number(run.body.records_upserted), 0);
  assert.equal(Number(run.body.records_rejected), 1);

  // ...but retained in the unmatched-driver queue with its identity hints.
  const queue = await admin("/ops/v1/unmatched-drivers");
  assert.equal(queue.response.status, 200);
  const row = (queue.body.data || []).find((r) => r.platform_operator_id === uuid);
  assert.ok(row, "the unmapped driver should appear in the quarantine queue");
  assert.equal(row.driver_name, "Quarantine Test Driver");
  assert.ok(Number(row.occurrences) >= 1);
});

test("re-ingesting the same unmapped driver is idempotent (bumps occurrences, no duplicate)", async () => {
  const account = (await admin("/ops/v1/platform-accounts")).body.data[0];
  const uuid = `unmapped-dup-${randomUUID().slice(0, 8)}`;
  const post = () => admin("/ops/v1/ingestion-runs", {
    method: "POST", headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ platform_account_id: account.platform_account_id, record_date: "2026-11-07", source: "live", records: [{ platform_operator_id: uuid, net_earnings_ngn: 1000 }] })
  });
  await post();
  await post();
  const queue = await admin("/ops/v1/unmatched-drivers");
  const rows = (queue.body.data || []).filter((r) => r.platform_operator_id === uuid);
  assert.equal(rows.length, 1, "same driver/day must not duplicate");
  assert.ok(Number(rows[0].occurrences) >= 2, "occurrences should bump on re-ingest");
});

test("the quarantine queue requires authentication", async () => {
  const res = await anon("/ops/v1/unmatched-drivers");
  assert.equal(res.response.status, 401);
});

const adminF = (url, options = {}) => fetch(`${foundationBaseUrl}${url}`, {
  ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
}).then(async (response) => ({ response, body: await response.json() }));

test("resolving a quarantined driver maps them and replays the retained revenue", async () => {
  const account = (await admin("/ops/v1/platform-accounts")).body.data[0];
  const amoeba = ((await adminF("/amoeba/v1/amoebas")).body.data || [])[0];
  assert.ok(amoeba, "need a seeded amoeba");
  // A fresh operator with no prior platform registration.
  const person = await adminF("/identity/v1/people", {
    method: "POST", headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ display_name: "Resolve Target", phone: "+234701" + String(Date.now()).slice(-7) })
  });
  const operator = await admin("/ops/v1/operators", {
    method: "POST", headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ person_id: person.body.person_id, operator_type: "rider", operator_status: "active", amoeba_id: amoeba.amoeba_id, site_id: "site_resolve_test" })
  });
  const operatorId = operator.body.operator_id;
  assert.ok(operatorId);

  const uuid = `unmapped-resolve-${randomUUID().slice(0, 8)}`;
  const date = "2026-11-05";
  await admin("/ops/v1/ingestion-runs", {
    method: "POST", headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ platform_account_id: account.platform_account_id, record_date: date, source: "live", records: [{ platform_operator_id: uuid, driver_name: "Replay Me", net_earnings_ngn: 50000, trips_total: 10, trips_completed: 9 }] })
  });
  assert.ok(((await admin("/ops/v1/unmatched-drivers")).body.data || []).some((r) => r.platform_operator_id === uuid), "driver should be quarantined first");

  const res = await admin("/ops/v1/unmatched-drivers/resolve", {
    method: "POST", headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ platform_account_id: account.platform_account_id, platform_operator_id: uuid, operator_id: operatorId })
  });
  assert.equal(res.response.status, 200);
  assert.ok(res.body.replayed >= 1, "should replay at least one record");
  assert.ok(res.body.dates.includes(date));

  // No longer pending, and the revenue now attributes to the operator.
  assert.ok(!((await admin("/ops/v1/unmatched-drivers")).body.data || []).some((r) => r.platform_operator_id === uuid), "resolved driver leaves the queue");
  const perf = await admin(`/ops/v1/daily-performance?record_date=${date}`);
  const row = (perf.body.data || []).find((r) => r.operator_id === operatorId && Number(r.net_earnings_ngn) >= 50000);
  assert.ok(row, "the replayed record should be attributed to the operator");
});
