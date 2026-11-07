import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4468;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4469;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-fuel-test-${Date.now()}`);
const mediaDir = path.join(tmpdir(), `fleximos-ops-fuel-media-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-fuel-auth-test-${Date.now()}`);
const repoRoot = new URL("../..", import.meta.url).pathname;
// 1x1 PNG — a stand-in receipt image.
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

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
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1", FLEXI_OPS_DB_DIR: dbDir, FLEXI_OPS_MEDIA_DIR: mediaDir, FOUNDATION_API_BASE: foundationBaseUrl },
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
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(token);
let idemSeq = 0;
const post = (url, payload) => admin(url, { method: "POST", headers: { "Idempotency-Key": `fuel-test-${Date.now()}-${idemSeq++}` }, body: JSON.stringify(payload) });
const patch = (url, payload) => admin(url, { method: "PATCH", headers: { "Idempotency-Key": `fuel-test-${Date.now()}-${idemSeq++}` }, body: JSON.stringify(payload) });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const ctx = { vehicleId: null, operatorId: null, fuelIssueId: null };

test.before(async () => {
  await startServer();
  // A motorbike + an ICE efficiency policy with a known price + 10% overspend threshold.
  // A warehouse motorbike supplies the vehicle_type/powertrain the policy matches;
  // the fuel-issue API takes a vehicle_id directly, so no amoeba assignment needed.
  ctx.vehicleId = (await post("/ops/v1/vehicles", { plate: "FUEL-TEST-01", vehicle_type: "motorbike", powertrain: "ice", amoeba_id: null })).body.vehicle_id;
  await post("/ops/v1/vehicle-efficiency-policies", {
    vehicle_type: "motorbike", powertrain: "ice", fuel_type: "petrol",
    standard_daily_fuel_quantity: 5, fuel_unit: "litres", expected_distance_km: 100,
    allowed_variance_pct: 10, price_per_unit_ngn: 900, fuel_price_variance_pct: 10, effective_from: "2026-01-01"
  });
  // A rider holding that bike (via the operator importer).
  const imported = await post("/ops/v1/imports/operators", {
    dry_run: false,
    rows: [{ display_name: "Fuel Rider", phone: "08050000001", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha" }]
  });
  ctx.operatorId = imported.body.rows[0].operator_id;
});
test.after(() => { server?.kill(); foundationServer?.kill(); });

test("a fuel issue derives price-per-unit from the total and compares to policy (within threshold)", async () => {
  const created = await post("/ops/v1/fuel-issues", {
    operator_id: ctx.operatorId, vehicle_id: ctx.vehicleId, operating_date: today,
    quantity: 10, unit: "litres", total_cost_ngn: 9200
  });
  assert.equal(created.response.status, 201);
  ctx.fuelIssueId = created.body.fuel_issue_id;
  assert.equal(Number(created.body.price_per_unit_ngn), 920, "₦9,200 / 10 L = ₦920/L");

  const list = (await admin(`/ops/v1/fuel-issues?operating_date=${today}`)).body.data;
  const row = list.find((r) => r.fuel_issue_id === ctx.fuelIssueId);
  assert.equal(Number(row.price_comparison.policy_price_per_unit_ngn), 900);
  assert.equal(row.price_comparison.status, "within", "+2.2% is within the 10% threshold");

  // No overspend alert for a within-threshold price.
  const alerts = (await admin(`/ops/v1/alerts?operator_id=${ctx.operatorId}&date_from=${today}&date_to=${today}`)).body.data;
  assert.ok(!alerts.some((a) => a.alert_type === "fuel_price_overspend"), "within threshold raises no overspend flag");
});

test("revising the price via PATCH derives the total and flags an overspend", async () => {
  const updated = await patch(`/ops/v1/fuel-issues/${ctx.fuelIssueId}`, { price_per_unit_ngn: 1100 });
  assert.equal(updated.response.status, 200);
  assert.equal(Number(updated.body.total_cost_ngn), 11000, "₦1,100 × 10 L = ₦11,000");
  assert.equal(updated.body.price_comparison.status, "over", "+22% exceeds the 10% threshold");

  // A soft (tier 0) overspend alert is raised for the operator.
  const alerts = (await admin(`/ops/v1/alerts?operator_id=${ctx.operatorId}&date_from=${today}&date_to=${today}`)).body.data;
  const flag = alerts.find((a) => a.alert_type === "fuel_price_overspend");
  assert.ok(flag, "an overspend flag is raised");
  assert.equal(Number(flag.tier), 0, "the flag is soft (tier 0), not blocking");
});

test("a fuel receipt attaches to the fuel issue (owner_type fuel_issue)", async () => {
  const attached = await post("/ops/v1/documents", {
    owner_type: "fuel_issue", owner_id: ctx.fuelIssueId, doc_type: "fuel_receipt",
    label: "Pump receipt", content_type: "image/png", content_base64: pngBase64
  });
  assert.equal(attached.response.status, 201);
  const listed = (await admin(`/ops/v1/documents?owner_type=fuel_issue&owner_id=${ctx.fuelIssueId}`)).body.data;
  assert.ok(listed.some((d) => d.link_id === attached.body.link_id && d.doc_type === "fuel_receipt"));
});

test("recording a fuel cost requires a supervisor", async () => {
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "fuel-person-op" },
    body: JSON.stringify({ display_name: "Plain Op", phone: "08050000050" })
  }).then((r) => r.json());
  const user = await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "fuel-user-op" },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  }).then((r) => r.json());
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "08050000050", pin: user.initial_pin })
  }).then((r) => r.json());
  const denied = await as(login.access_token)(`/ops/v1/fuel-issues/${ctx.fuelIssueId}`, {
    method: "PATCH", headers: { "Idempotency-Key": "fuel-denied-1" }, body: JSON.stringify({ price_per_unit_ngn: 950 })
  });
  assert.equal(denied.response.status, 403);
});
