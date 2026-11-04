import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4464;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4465;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-imports-test-${Date.now()}`);
const mediaDir = path.join(tmpdir(), `fleximos-ops-imports-media-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-imports-auth-test-${Date.now()}`);
let server;
let foundationServer;

async function startServer() {
  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(foundationPort), HOST: "127.0.0.1", FLEXI_DB_DIR: foundationDbDir },
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
      FLEXI_SEED_DEMO: "true",
      PORT: String(port),
      HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir,
      FLEXI_OPS_MEDIA_DIR: mediaDir,
      FOUNDATION_API_BASE: foundationBaseUrl
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
const post = (url, payload) => admin(url, { method: "POST", body: JSON.stringify(payload) });

async function rosterCount() {
  const r = await admin("/ops/v1/operators");
  return r.body.data.length;
}

test.before(startServer);
test.after(() => { server?.kill(); foundationServer?.kill(); });

test("operator import: dry-run reports per row and writes nothing, then commit creates", async () => {
  const before = await rosterCount();
  const rows = [
    { display_name: "Import Rider One", phone: "08030000001", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha" },
    { display_name: "Bad Amoeba", phone: "08030000002", operator_type: "rider", amoeba: "Nowhere", site: "Lekki Awudu Ekpegha" },
    { display_name: "No Site", phone: "08030000003", operator_type: "rider", amoeba: "Island" }
  ];

  const dry = await post("/ops/v1/imports/operators", { rows });
  assert.equal(dry.response.status, 200);
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.summary.create, 1);
  assert.equal(dry.body.summary.error, 2);
  assert.equal(await rosterCount(), before, "dry-run must not write");
  const badAmoeba = dry.body.rows.find((r) => r.label === "Bad Amoeba");
  assert.match(badAmoeba.reason, /unknown amoeba/);

  const commit = await post("/ops/v1/imports/operators", { rows, dry_run: false });
  assert.equal(commit.body.dry_run, false);
  assert.equal(commit.body.summary.create, 1);
  const created = commit.body.rows.find((r) => r.label === "Import Rider One");
  assert.equal(created.status, "create");
  assert.ok(created.operator_id?.startsWith("operator_"), "returns the new operator id");
  assert.ok(created.person_id?.startsWith("person_"));
  assert.ok(created.initial_pin, "issues and reports a sign-in PIN");
  assert.equal(await rosterCount(), before + 1);
});

test("operator import is idempotent: a committed row skips on re-run", async () => {
  const rows = [{ display_name: "Import Rider One", phone: "08030000001", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha" }];
  const again = await post("/ops/v1/imports/operators", { rows, dry_run: false });
  assert.equal(again.body.summary.create, 0);
  assert.equal(again.body.summary.skip, 1);
  assert.match(again.body.rows[0].reason, /already has an operator/);
});

test("operator import: ramp maturity from a backdated start_date lands the rider mid-ramp", async () => {
  const d = new Date();
  d.setDate(d.getDate() - 5);
  const startDate = d.toISOString().slice(0, 10);
  const rows = [{ display_name: "Ramp Rider", phone: "08030000009", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha", start_date: startDate }];
  const commit = await post("/ops/v1/imports/operators", { rows, dry_run: false });
  assert.equal(commit.body.summary.create, 1);
  // The import created (or reused) a cohort anchored to the backdated start_date
  // and added the rider to it, so the ramp engine judges them mid-ramp.
  const cohorts = (await admin("/ops/v1/onboarding/cohorts")).body.data;
  const backdated = cohorts.find((c) => String(c.start_date).slice(0, 10) === startDate);
  assert.ok(backdated, "a cohort anchored to the backdated start_date exists");
  assert.ok(Number(backdated.member_count) >= 1, "the imported rider is a member of it");
});

test("operator import accepts a CSV upload (file_text) and maps tolerant headers", async () => {
  const csv = [
    "Full Name,Phone,Type,Amoeba,Site",
    "CSV Rider,08030000021,rider,Island,Lekki Awudu Ekpegha"
  ].join("\n");
  const dry = await post("/ops/v1/imports/operators", { file_text: csv });
  assert.equal(dry.response.status, 200);
  assert.equal(dry.body.summary.create, 1);
  assert.equal(dry.body.rows[0].label, "CSV Rider");
});

test("vehicle import: VIN maps to the tracker device id, blank amoeba is warehouse, dup plate skips", async () => {
  const rows = [
    { plate: "IMP-001-AA", vehicle_type: "motorbike", vin: "VINTANKVOLT0001", tracker_provider: "tankvolt" },
    { plate: "IMP-002-AA", vehicle_type: "motorbike", amoeba: "Island" }
  ];
  const dry = await post("/ops/v1/imports/vehicles", { rows });
  assert.equal(dry.body.summary.create, 2);
  const warehouse = dry.body.rows.find((r) => r.label === "IMP-001-AA");
  assert.match(warehouse.reason, /warehouse/);

  const commit = await post("/ops/v1/imports/vehicles", { rows, dry_run: false });
  assert.equal(commit.body.summary.create, 2);

  const vehicles = (await admin("/ops/v1/vehicles")).body.data;
  const imported = vehicles.find((v) => v.plate === "IMP-001-AA");
  assert.ok(imported, "vehicle was created");
  assert.equal(imported.tracker_device_id, "VINTANKVOLT0001", "VIN stored as the tracker device id");
  assert.equal(imported.powertrain, "ev", "tankvolt provider derives an EV powertrain");

  // Re-run: both plates now exist, so both skip.
  const again = await post("/ops/v1/imports/vehicles", { rows, dry_run: false });
  assert.equal(again.body.summary.skip, 2);
  assert.equal(again.body.summary.create, 0);
});

test("imports require a system admin", async () => {
  // Make an operator-role login and confirm it cannot import.
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "imp-person-op" },
    body: JSON.stringify({ display_name: "Plain Operator", phone: "08030000050" })
  }).then((r) => r.json());
  const user = await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "imp-user-op" },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  }).then((r) => r.json());
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "08030000050", pin: user.initial_pin })
  }).then((r) => r.json());

  const asOperator = as(login.access_token);
  const denied = await asOperator("/ops/v1/imports/operators", { method: "POST", body: JSON.stringify({ rows: [] }) });
  assert.equal(denied.response.status, 403);
});
