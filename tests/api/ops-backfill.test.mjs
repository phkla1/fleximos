import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4466;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4467;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-backfill-test-${Date.now()}`);
const mediaDir = path.join(tmpdir(), `fleximos-ops-backfill-media-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-backfill-auth-test-${Date.now()}`);
const repoRoot = new URL("../..", import.meta.url).pathname;

// A Bolt fixture: the connector reads <credentials_key>_FIXTURE_FILE and returns
// the array keyed by the pulled date — so backfill can loop it with no network.
const boltFixturePath = path.join(tmpdir(), `bolt-fixture-${Date.now()}.json`);
const boltRecord = (id, overrides = {}) => ({
  platform_operator_id: id, trips_total: 5, trips_completed: 5, trips_cancelled: 0,
  trips_no_response: 0, trips_rejected: 0, ride_revenue_ngn: 20000, net_earnings_ngn: 18000,
  booking_fees_ngn: 500, cash_trips: 2, card_trips: 3, acceptance_pct: 100, cancellation_pct: 0,
  completion_pct: 100, hours_online: 8, last_seen_at: null, current_status: "checked_out",
  data_quality: "authoritative", provenance: { connector: "bolt" }, raw_payload: {}, ...overrides
});
writeFileSync(boltFixturePath, JSON.stringify({
  "2026-02-01": [boltRecord("bolt-d1"), boltRecord("bolt-d2", { ride_revenue_ngn: 9000, net_earnings_ngn: 8000 })],
  "2026-02-02": [boltRecord("bolt-d1", { ride_revenue_ngn: 22000, net_earnings_ngn: 19500 })]
}));

const indriveB64 = readFileSync(path.join(repoRoot, "tests/fixtures/indrive-sample.xlsx")).toString("base64");

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
    env: {
      ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir, FLEXI_OPS_MEDIA_DIR: mediaDir, FOUNDATION_API_BASE: foundationBaseUrl,
      BOLTTEST_FIXTURE_FILE: boltFixturePath
    },
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
// Some routes (platform-accounts, registrations) go through the idempotency
// wrapper and require a key; sending one always is harmless for routes that ignore it.
let idemSeq = 0;
const post = (url, payload) => admin(url, {
  method: "POST",
  headers: { "Idempotency-Key": `bf-test-${Date.now()}-${idemSeq++}` },
  body: JSON.stringify(payload)
});

// Context created once and reused across tests.
const ctx = { opA: null, opB: null, indrive: null, bolt: null };

test.before(async () => {
  await startServer();

  // Two operators via the (proven) operator importer, so we get real operator ids.
  const imported = await post("/ops/v1/imports/operators", {
    dry_run: false,
    rows: [
      { display_name: "Backfill Rider A", phone: "08040000001", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha" },
      { display_name: "Backfill Rider B", phone: "08040000002", operator_type: "rider", amoeba: "Island", site: "Lekki Awudu Ekpegha" }
    ]
  });
  ctx.opA = imported.body.rows.find((r) => r.label === "Backfill Rider A").operator_id;
  ctx.opB = imported.body.rows.find((r) => r.label === "Backfill Rider B").operator_id;

  // A file-mode inDrive platform and an api-mode Bolt platform (fixture-backed).
  ctx.indrive = (await post("/ops/v1/platform-accounts", {
    platform: "indrive", display_name: "inDrive Couriers", vehicle_type: "motorbike",
    account_subtype: "delivery", integration_mode: "file"
  })).body.platform_account_id;
  ctx.bolt = (await post("/ops/v1/platform-accounts", {
    platform: "bolt", display_name: "Bolt Fleet", vehicle_type: "motorbike",
    account_subtype: "ride", integration_mode: "api", credentials_key: "BOLTTEST"
  })).body.platform_account_id;

  // Map two inDrive drivers (235144545, 999999999) and one Bolt driver (bolt-d1).
  // 777777777 (inDrive) and bolt-d2 are left UNMAPPED on purpose.
  await post(`/ops/v1/operators/${ctx.opA}/platform-registrations`, { platform_account_id: ctx.indrive, platform_operator_id: "235144545" });
  await post(`/ops/v1/operators/${ctx.opB}/platform-registrations`, { platform_account_id: ctx.indrive, platform_operator_id: "999999999" });
  await post(`/ops/v1/operators/${ctx.opA}/platform-registrations`, { platform_account_id: ctx.bolt, platform_operator_id: "bolt-d1" });
});

test.after(() => { server?.kill(); foundationServer?.kill(); });

test("discover flags unmapped platform ids (inDrive file + Bolt day)", async () => {
  const indrive = await post("/ops/v1/backfill/discover", { platform_account_id: ctx.indrive, file_base64: indriveB64 });
  assert.equal(indrive.response.status, 200);
  assert.equal(indrive.body.mode, "file");
  const byId = new Map(indrive.body.ids.map((r) => [r.platform_operator_id, r]));
  assert.equal(byId.get("235144545").mapped, true, "a registered driver is mapped");
  assert.equal(byId.get("777777777").mapped, false, "an unregistered driver is unmapped");
  assert.equal(indrive.body.unmapped_count, 1);

  const bolt = await post("/ops/v1/backfill/discover", { platform_account_id: ctx.bolt, record_date: "2026-02-01" });
  const boltIds = new Map(bolt.body.ids.map((r) => [r.platform_operator_id, r]));
  assert.equal(boltIds.get("bolt-d1").mapped, true);
  assert.equal(boltIds.get("bolt-d2").mapped, false);
  assert.equal(bolt.body.unmapped_count, 1);
});

test("inDrive dry-run reports weeks→days and writes nothing", async () => {
  const dry = await post("/ops/v1/backfill/indrive", { platform_account_id: ctx.indrive, file_base64: indriveB64 });
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.summary.drivers, 3);
  assert.equal(dry.body.summary.unmapped_drivers, 1);
  // D1 has orders on Jan 1 + Jan 5, D2 on Jan 2, unmapped 777 on Jan 3 → 4 dates.
  const dates = dry.body.dates.map((d) => d.record_date);
  assert.deepEqual(dates, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05"]);
  const none = await admin("/ops/v1/daily-performance?date_from=2026-01-01&date_to=2026-01-31");
  assert.equal(none.body.data.length, 0, "dry-run must not write");
});

test("inDrive commit allocates weekly money across order-days by done-share", async () => {
  const commit = await post("/ops/v1/backfill/indrive", { platform_account_id: ctx.indrive, file_base64: indriveB64, dry_run: false });
  assert.equal(commit.body.dry_run, false);
  assert.ok(commit.body.summary.upserted >= 3, "mapped driver-days land");

  const rows = (await admin(`/ops/v1/daily-performance?operator_id=${ctx.opA}&date_from=2026-01-01&date_to=2026-01-07`)).body.data;
  const jan1 = rows.find((r) => String(r.record_date).slice(0, 10) === "2026-01-01");
  const jan5 = rows.find((r) => String(r.record_date).slice(0, 10) === "2026-01-05");
  // Week gmv 43400 over 10 dones: Jan 1 (4) → 17360, Jan 5 (6) → 26040.
  assert.equal(Math.round(Number(jan1.ride_revenue_ngn)), 17360);
  assert.equal(Math.round(Number(jan5.ride_revenue_ngn)), 26040);
  // income_courier is gmv × 0.87 → Jan 1 net = 15103.2.
  assert.ok(Math.abs(Number(jan1.net_earnings_ngn) - 15103.2) < 0.5);
  assert.equal(jan1.data_quality, "estimated", "allocated money is flagged estimated");
  assert.equal(jan1.provenance.connector, "indrive");
  // reward is informational only — never folded into revenue.
  assert.equal(jan1.provenance.reward_ngn, 434);
});

test("inDrive commit rejects an unmapped driver's days", async () => {
  // 777777777 has no registration, so its Jan-3 day cannot land.
  const jan3 = (await admin("/ops/v1/daily-performance?date_from=2026-01-03&date_to=2026-01-03")).body.data;
  assert.equal(jan3.length, 0, "the unmapped driver's day is not attributed to anyone");
});

test("Bolt range backfill: dry-run then commit, source migration", async () => {
  const dry = await post("/ops/v1/backfill/platform", { platform_account_id: ctx.bolt, date_from: "2026-02-01", date_to: "2026-02-02" });
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.summary.days, 2);
  assert.equal(dry.body.summary.received, 3, "2 drivers day one + 1 day two");
  assert.equal(dry.body.summary.upserted, 0, "dry-run writes nothing");

  const commit = await post("/ops/v1/backfill/platform", { platform_account_id: ctx.bolt, date_from: "2026-02-01", date_to: "2026-02-02", dry_run: false });
  assert.equal(commit.body.summary.upserted, 2, "only the mapped bolt-d1 lands (both days)");
  const rows = (await admin(`/ops/v1/daily-performance?operator_id=${ctx.opA}&date_from=2026-02-01&date_to=2026-02-02`)).body.data;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.source === "migration"), "historical rows are tagged migration");
});

test("backfill range is capped to one month per run", async () => {
  const tooWide = await post("/ops/v1/backfill/platform", { platform_account_id: ctx.bolt, date_from: "2026-02-01", date_to: "2026-06-01" });
  assert.equal(tooWide.response.status, 400);
  assert.match(tooWide.body.message, /at most 31 days/);
});

test("backfill requires a system admin", async () => {
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "bf-person-op" },
    body: JSON.stringify({ display_name: "Plain Op", phone: "08040000050" })
  }).then((r) => r.json());
  const user = await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "bf-user-op" },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  }).then((r) => r.json());
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "08040000050", pin: user.initial_pin })
  }).then((r) => r.json());
  const denied = await as(login.access_token)("/ops/v1/backfill/discover", { method: "POST", body: JSON.stringify({ platform_account_id: ctx.bolt, record_date: "2026-02-01" }) });
  assert.equal(denied.response.status, 403);
});
