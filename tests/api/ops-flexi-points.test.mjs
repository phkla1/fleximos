import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4450;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4451;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-points-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-points-auth-test-${Date.now()}`);
let server;
let foundationServer;

async function startServer() {
  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      FLEXI_SEED_DEMO: "true",
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
      FLEXI_SEED_DEMO: "true",
      PORT: String(port),
      HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir,
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

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
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

const post = (url, key, payload) =>
  request(url, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(payload) });

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

test.before(startServer);
test.after(() => {
  server?.kill();
  foundationServer?.kill();
});

test("serves and updates the Flexi Points configuration", async () => {
  const read = await request("/ops/v1/flexi-points/config");
  assert.equal(read.response.status, 200);
  assert.equal(Number(read.body.standard_threshold_ngn), 32000);
  assert.equal(Number(read.body.accommodated_threshold_ngn), 35000);
  assert.equal(Number(read.body.accelerator_step_ngn), 6000);
  assert.equal(Number(read.body.points_target), 624);
  assert.equal(read.body.daily_cap, null);
  assert.equal(read.body.enrollment, "automatic");

  // A non-automatic enrollment is rejected (all riders are enrolled in Phase 1).
  const badEnrollment = await post("/ops/v1/flexi-points/config", "points-config-bad-enroll", { enrollment: "opt_in" });
  assert.equal(badEnrollment.response.status, 400);

  // A milestone above the target is rejected.
  const badMilestone = await post("/ops/v1/flexi-points/config", "points-config-bad-milestone", { take_home_points: 999 });
  assert.equal(badMilestone.response.status, 400);

  // A valid change persists.
  const updated = await post("/ops/v1/flexi-points/config", "points-config-ok", {
    accelerator_step_ngn: 5000,
    daily_cap: 10
  });
  assert.equal(updated.response.status, 200);
  assert.equal(Number(updated.body.accelerator_step_ngn), 5000);
  assert.equal(Number(updated.body.daily_cap), 10);

  // Restore the default step/cap for the points-maths test below.
  const restored = await post("/ops/v1/flexi-points/config", "points-config-restore", {
    accelerator_step_ngn: 6000,
    daily_cap: null
  });
  assert.equal(Number(restored.body.accelerator_step_ngn), 6000);
  assert.equal(restored.body.daily_cap, null);
});

test("computes points from a rider's verified combined revenue", async () => {
  // Authoritative (live) ride revenue of ₦44,000 for the standard demo rider:
  //   1 point at ₦32,000 + floor((44000-32000)/6000)=2 steps = 3 points.
  await post("/ops/v1/ingestion-runs", "points-ingest-live", {
    platform_account_id: "platform_bolt_lagos",
    record_date: today,
    source: "live",
    records: [{
      platform_operator_id: "bolt-demo-driver",
      trips_total: 22,
      trips_completed: 20,
      ride_revenue_ngn: 50000,
      net_earnings_ngn: 44000,
      cash_trips: 8,
      card_trips: 12,
      acceptance_pct: 95,
      hours_online: 10,
      current_status: "online"
    }]
  });

  const summary = await request("/ops/v1/flexi-points/summary?operator_id=operator_demo_wole");
  assert.equal(summary.response.status, 200);
  assert.equal(Number(summary.body.threshold_ngn), 32000);
  assert.equal(summary.body.balance, 3);
  assert.equal(summary.body.points_target, 624);
  assert.equal(summary.body.points_remaining, 621);
  assert.equal(summary.body.today.points, 3);
  assert.equal(summary.body.today.base_point, 1);
  assert.equal(summary.body.today.step_points, 2);
  assert.equal(Number(summary.body.today.verified_revenue_ngn), 44000);
  // Guardrail copy uses "owns", never the word "ownership".
  assert.ok(/owns the bike/i.test(summary.body.bike_note));
  assert.ok(!/ownership/i.test(JSON.stringify(summary.body)));

  // The ledger carries the day and the week rolls it up.
  const day = summary.body.ledger.find((row) => row.record_date === today);
  assert.ok(day, "today is in the ledger");
  assert.equal(day.points, 3);
  assert.equal(summary.body.this_week.points, 3);

  // Milestones are display-only standings, none reached yet at 3 points.
  const transfer = summary.body.milestones.find((m) => m.key === "transfer");
  assert.equal(transfer.points, 624);
  assert.equal(transfer.reached, false);
});

test("does not count unverified (manual) revenue toward points", async () => {
  // A manual correction is 'derived', not authoritative — it is not verified
  // revenue and must not earn points. Override the live record downward via a
  // manual entry and confirm the ledger ignores it (points stay from the live
  // figure only, which this manual entry overwrites → day drops out).
  const manual = await post("/ops/v1/ingestion-runs", "points-ingest-manual", {
    platform_account_id: "platform_bolt_lagos",
    record_date: today,
    source: "manual_correction",
    override: true,
    override_reason: "Rider-reported correction pending feed confirmation.",
    records: [{
      platform_operator_id: "bolt-demo-driver",
      net_earnings_ngn: 90000
    }]
  });
  assert.equal(manual.response.status, 201);

  const summary = await request("/ops/v1/flexi-points/summary?operator_id=operator_demo_wole");
  assert.equal(summary.response.status, 200);
  // The authoritative row is gone (overwritten by a derived one), so no verified
  // revenue remains for today → 0 points, despite the larger manual figure.
  assert.equal(summary.body.balance, 0);
  assert.equal(summary.body.today.points, 0);
});

test("rejects /me for a non-operator account and requires operator_id for summary", async () => {
  // The service token is person_system — not an operator profile.
  const me = await request("/ops/v1/flexi-points/me");
  assert.equal(me.response.status, 404);

  const missing = await request("/ops/v1/flexi-points/summary");
  assert.equal(missing.response.status, 401);
});
