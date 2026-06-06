import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";

const port = 4410;
const baseUrl = `http://127.0.0.1:${port}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-foundation-api-test-${Date.now()}`);

let server;

async function startServer() {
  if (server) return;
  server = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", FLEXI_DB_DIR: dbDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const [chunk] = await once(server.stdout, "data");
  assert.match(String(chunk), /Foundation API/);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  await startServer();
});

test.after(() => {
  server?.kill();
});

test("health endpoint is public", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("lists seeded people and amoebas", async () => {
  const people = await request("/identity/v1/people");
  assert.equal(people.response.status, 200);
  assert.ok(people.body.data.some((person) => person.person_id === "person_founder_wole"));

  const amoebas = await request("/amoeba/v1/amoebas");
  assert.equal(amoebas.response.status, 200);
  assert.deepEqual(
    amoebas.body.data.map((amoeba) => amoeba.amoeba_id).sort(),
    ["amoeba_central", "amoeba_island", "amoeba_mainland"]
  );

  const sites = await request("/amoeba/v1/sites");
  assert.equal(sites.response.status, 200);
  assert.deepEqual(
    sites.body.data.map((site) => site.site_id).sort(),
    ["site_island_1", "site_island_2", "site_mainland_1", "site_mainland_2"]
  );
});

test("creates people idempotently", async () => {
  const headers = { "Idempotency-Key": "test-create-person-001" };
  const payload = {
    display_name: "Test Operator",
    phone: "+2347000000000"
  };

  const first = await request("/identity/v1/people", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const second = await request("/identity/v1/people", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(first.body.person_id, second.body.person_id);
});

test("rejects duplicate person contact details", async () => {
  const duplicate = await request("/identity/v1/people", {
    method: "POST",
    headers: { "Idempotency-Key": "test-duplicate-person-001" },
    body: JSON.stringify({
      display_name: "Duplicate Founder",
      phone: "+2347033550173"
    })
  });

  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, "duplicate_person");
});

test("assigns amoeba coordinator and records history", async () => {
  const assign = await request("/amoeba/v1/amoebas/amoeba_island/assign-coordinator", {
    method: "POST",
    headers: { "Idempotency-Key": "test-assign-coordinator-001" },
    body: JSON.stringify({ coordinator_person_id: "person_founder_wole" })
  });

  assert.equal(assign.response.status, 200);
  assert.equal(assign.body.coordinator_person_id, "person_founder_wole");

  const history = await request("/amoeba/v1/amoebas/amoeba_island/history");
  assert.equal(history.response.status, 200);
  assert.ok(history.body.data.some((entry) => entry.change_type === "coordinator_assigned"));
});

test("creates and updates physical sites with history", async () => {
  const create = await request("/amoeba/v1/sites", {
    method: "POST",
    headers: { "Idempotency-Key": "test-create-site-001" },
    body: JSON.stringify({
      amoeba_id: "amoeba_island",
      name: "QA Yard",
      gps_lat: 6.45,
      gps_lng: 3.48,
      alert_radius_m: 750,
      is_primary: false
    })
  });

  assert.equal(create.response.status, 201);
  assert.equal(create.body.name, "QA Yard");
  assert.equal(create.body.alert_radius_m, 750);

  const update = await request(`/amoeba/v1/sites/${create.body.site_id}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": "test-update-site-001" },
    body: JSON.stringify({
      alert_radius_m: 900,
      status: "inactive"
    })
  });

  assert.equal(update.response.status, 200);
  assert.equal(update.body.alert_radius_m, 900);
  assert.equal(update.body.status, "inactive");

  const filtered = await request("/amoeba/v1/sites?amoeba_id=amoeba_island");
  assert.equal(filtered.response.status, 200);
  assert.ok(filtered.body.data.every((site) => site.amoeba_id === "amoeba_island"));

  const history = await request(`/amoeba/v1/sites/${create.body.site_id}/history`);
  assert.equal(history.response.status, 200);
  assert.ok(history.body.data.some((entry) => entry.change_type === "updated"));
});

test("creates service account token and authenticates with it", async () => {
  const account = await request("/identity/v1/service-accounts", {
    method: "POST",
    headers: { "Idempotency-Key": "test-service-account-001" },
    body: JSON.stringify({
      name: "Ops Integration Test",
      scopes: ["identity:read", "amoeba:read"]
    })
  });

  assert.equal(account.response.status, 201);

  const issued = await request(`/identity/v1/service-accounts/${account.body.service_account_id}/tokens`, {
    method: "POST",
    headers: { "Idempotency-Key": "test-service-token-001" },
    body: JSON.stringify({})
  });

  assert.equal(issued.response.status, 201);
  assert.match(issued.body.token, /^flexi_sa_/);

  const response = await fetch(`${baseUrl}/identity/v1/me`, {
    headers: { Authorization: `Bearer ${issued.body.token}` }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service_account, account.body.service_account_id);
});

test("validates amoeba classification changes", async () => {
  const invalid = await request("/amoeba/v1/amoebas/amoeba_island/classify", {
    method: "POST",
    headers: { "Idempotency-Key": "test-invalid-classification-001" },
    body: JSON.stringify({
      classification: "random",
      reason: "testing validation"
    })
  });

  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "validation_failed");
});
