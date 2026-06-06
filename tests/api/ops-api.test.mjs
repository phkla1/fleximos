import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4430;
const baseUrl = `http://127.0.0.1:${port}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-api-test-${Date.now()}`);
let server;

async function startServer() {
  server = spawn("npx", ["tsx", "apps/ops-api/src/main.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", FLEXI_OPS_DB_DIR: dbDir },
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
test.after(() => server?.kill());

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "ops-api");
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
