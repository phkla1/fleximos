import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4440;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4441;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-depth-test-${Date.now()}`);
const mediaDir = path.join(tmpdir(), `fleximos-ops-depth-media-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-depth-auth-test-${Date.now()}`);
let server;
let foundationServer;

async function startServer() {
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

test("registers a camera capture and serves its content back", async () => {
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const { response, body } = await post("/ops/v1/media", "depth-media-001", {
    kind: "incident_evidence",
    content_type: "image/png",
    content_base64: pixel,
    captured_at: new Date().toISOString(),
    gps_lat: 6.5244,
    gps_lng: 3.3792
  });
  assert.equal(response.status, 201);
  assert.ok(body.media_id.startsWith("media_"));
  assert.equal(body.byte_size, 70);

  const content = await fetch(`${baseUrl}/ops/v1/media/${body.media_id}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.equal((await content.arrayBuffer()).byteLength, 70);

  const rejected = await post("/ops/v1/media", "depth-media-002", {
    content_type: "application/pdf",
    content_base64: pixel,
    captured_at: new Date().toISOString()
  });
  assert.equal(rejected.response.status, 400);
});

test("runs the structured deviation-reason workflow on an alert", async () => {
  const alerts = await request("/ops/v1/alerts");
  const alert = alerts.body.data.find((item) => item.alert_id === "alert_demo_offline");
  assert.ok(alert, "expected the seeded demo alert");

  const badCode = await post(`/ops/v1/alerts/${alert.alert_id}/deviation-reason`, "depth-deviation-bad", {
    reason_code: "dog_ate_my_phone"
  });
  assert.equal(badCode.response.status, 400);

  const submitted = await post(`/ops/v1/alerts/${alert.alert_id}/deviation-reason`, "depth-deviation-001", {
    reason_code: "network_app_issue",
    note: "App kept logging me out."
  });
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.deviation_review_status, "pending");

  const reviewed = await post(`/ops/v1/alerts/${alert.alert_id}/deviation-reason/review`, "depth-deviation-review-001", {
    decision: "accepted",
    note: "Confirmed platform outage window."
  });
  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.body.deviation_review_status, "accepted");

  const escalated = await post(`/ops/v1/alerts/${alert.alert_id}/escalate`, "depth-escalate-001", {
    note: "Recurring issue this week."
  });
  assert.equal(escalated.response.status, 200);
  assert.equal(escalated.body.resolution_status, "escalated");

  const queue = await request("/ops/v1/escalations");
  assert.equal(queue.response.status, 200);
  assert.ok(queue.body.escalated_alerts.some((item) => item.alert_id === alert.alert_id));
});

test("reports, acknowledges, and resolves a field incident", async () => {
  const created = await post("/ops/v1/incidents", "depth-incident-001", {
    operator_id: "operator_demo_wole",
    incident_type: "breakdown",
    description: "Engine cut out on Third Mainland Bridge.",
    gps_lat: 6.501,
    gps_lng: 3.396
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.severity, "normal");
  assert.equal(created.body.status, "open");

  const badType = await post("/ops/v1/incidents", "depth-incident-002", {
    operator_id: "operator_demo_wole",
    incident_type: "alien_abduction"
  });
  assert.equal(badType.response.status, 400);

  const acknowledged = await post(`/ops/v1/incidents/${created.body.incident_id}/acknowledge`, "depth-incident-ack-001", {});
  assert.equal(acknowledged.body.status, "acknowledged");

  const resolved = await post(`/ops/v1/incidents/${created.body.incident_id}/resolve`, "depth-incident-resolve-001", {
    resolution_notes: "Mechanic dispatched, vehicle recovered."
  });
  assert.equal(resolved.body.status, "resolved");

  const list = await request("/ops/v1/incidents?status=resolved");
  assert.ok(list.body.data.some((item) => item.incident_id === created.body.incident_id));
});

test("tracks vehicle inspections and 48-hour compliance", async () => {
  const inspection = await post("/ops/v1/inspections", "depth-inspection-001", {
    vehicle_id: "vehicle_demo_001",
    odometer_km: 45210,
    fuel_level_pct: 60,
    condition: "needs_repair",
    issue_categories: ["brakes"],
    notes: "Rear brake pads are worn through."
  });
  assert.equal(inspection.response.status, 201);
  assert.equal(inspection.body.review_status, "pending");

  const compliance = await request("/ops/v1/inspections/compliance");
  assert.equal(compliance.response.status, 200);
  const vehicle = compliance.body.vehicles.find((item) => item.vehicle_id === "vehicle_demo_001");
  assert.equal(vehicle.inspection_status, "current");

  const reviewed = await post(`/ops/v1/inspections/${inspection.body.inspection_id}/review`, "depth-inspection-review-001", {
    decision: "follow_up",
    note: "Book the brake replacement this week."
  });
  assert.equal(reviewed.body.review_status, "follow_up");
});

test("moves a maintenance report through repair with a cost that lands in P&L", async () => {
  const report = await post("/ops/v1/maintenance-reports", "depth-maintenance-001", {
    vehicle_id: "vehicle_demo_001",
    category: "brakes",
    description: "Brake pads replacement from inspection."
  });
  assert.equal(report.response.status, 201);
  assert.equal(report.body.status, "open");

  const inRepair = await post(`/ops/v1/maintenance-reports/${report.body.maintenance_id}/status`, "depth-maintenance-002", {
    status: "in_repair"
  });
  assert.equal(inRepair.body.status, "in_repair");

  const resolved = await post(`/ops/v1/maintenance-reports/${report.body.maintenance_id}/status`, "depth-maintenance-003", {
    status: "resolved",
    cost_ngn: 18500,
    resolution_notes: "Pads and discs replaced."
  });
  assert.equal(resolved.body.status, "resolved");
  assert.equal(Number(resolved.body.cost_ngn), 18500);
});

test("computes amoeba P&L with expenses, transfer pricing and central allocation", async () => {
  await post("/ops/v1/ingestion-runs", "depth-pnl-ingest-001", {
    platform_account_id: "platform_bolt_lagos",
    record_date: today,
    source: "manual_correction",
    records: [{
      platform_operator_id: "bolt-demo-driver",
      trips_total: 20,
      trips_completed: 18,
      ride_revenue_ngn: 42000,
      net_earnings_ngn: 36500,
      cash_trips: 10,
      card_trips: 8,
      acceptance_pct: 92,
      hours_online: 9,
      current_status: "online"
    }]
  });

  const direct = await post("/ops/v1/expenses", "depth-expense-001", {
    expense_date: today,
    amoeba_id: "amoeba_island",
    category: "fuel",
    description: "Fuel float for island fleet",
    amount_ngn: 6000
  });
  assert.equal(direct.response.status, 201);

  const central = await post("/ops/v1/expenses", "depth-expense-002", {
    expense_date: today,
    category: "overhead",
    allocation: "central",
    description: "Head-office internet",
    amount_ngn: 4000
  });
  assert.equal(central.body.amoeba_id, null);

  const transfer = await post("/ops/v1/transfer-price-events", "depth-transfer-001", {
    external_event_id: "tms-event-0001",
    event_date: today,
    from_amoeba_id: "amoeba_island",
    to_amoeba_id: "amoeba_mainland",
    amount_ngn: 2500,
    description: "Shared dispatcher time"
  });
  assert.equal(transfer.response.status, 201);
  const replay = await post("/ops/v1/transfer-price-events", "depth-transfer-001b", {
    external_event_id: "tms-event-0001",
    event_date: today,
    from_amoeba_id: "amoeba_island",
    to_amoeba_id: "amoeba_mainland",
    amount_ngn: 2500
  });
  assert.equal(replay.body.transfer_price_event_id, transfer.body.transfer_price_event_id);

  const pnl = await request(`/ops/v1/pnl?period_start=${today}&period_end=${today}`);
  assert.equal(pnl.response.status, 200);
  const island = pnl.body.amoebas.find((row) => row.amoeba_id === "amoeba_island");
  assert.ok(island, "expected island amoeba in P&L");
  assert.equal(island.net_earnings_ngn, 36500);
  assert.equal(island.direct_expenses_ngn, 6000);
  assert.equal(island.maintenance_costs_ngn, 18500);
  assert.equal(island.transfer_price_credits_ngn, 2500);
  // Only the demo operator is active, so the island bears the full central cost.
  assert.equal(island.central_allocation_ngn, 4000);
  assert.equal(
    island.gross_pnl_ngn,
    36500 - 6000 - 18500 - 4000 + 2500
  );
  assert.ok(island.hourly_pnl_ngn > 0);
});

test("ranks operators on the leaderboard and validates config weights", async () => {
  const leaderboard = await request(`/ops/v1/leaderboard?period_start=${today}&period_end=${today}`);
  assert.equal(leaderboard.response.status, 200);
  assert.ok(leaderboard.body.entries.length >= 1);
  const top = leaderboard.body.entries[0];
  assert.equal(top.rank, 1);
  assert.equal(top.badge, "gold");
  assert.ok(top.performance_score > 0 && top.performance_score <= 100);
  assert.ok(top.components.acceptance_score > 0);

  const sorted = await request(`/ops/v1/leaderboard?period_start=${today}&period_end=${today}&sort=trips`);
  assert.equal(sorted.body.sort, "trips");

  const badWeights = await post("/ops/v1/leaderboard-config", "depth-leaderboard-bad", {
    acceptance_weight: 0.9,
    online_weight: 0.9,
    cash_weight: 0.1,
    revenue_weight: 0.1
  });
  assert.equal(badWeights.response.status, 400);

  const updated = await post("/ops/v1/leaderboard-config", "depth-leaderboard-001", {
    acceptance_weight: 0.25,
    online_weight: 0.25,
    cash_weight: 0.25,
    revenue_weight: 0.25,
    default_timeline: "today"
  });
  assert.equal(updated.response.status, 200);
  assert.equal(Number(updated.body.acceptance_weight), 0.25);
  assert.equal(updated.body.default_timeline, "today");
});

test("keeps depth mutations behind role authorization", async () => {
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "depth-auth-person-001"
    },
    body: JSON.stringify({ display_name: "Depth Operator", phone: "+2347000000441" })
  }).then((response) => response.json());
  await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "depth-auth-user-001"
    },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  });
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "+2347000000441", pin: "000000" })
  }).then((response) => response.json());

  const forbiddenExpense = await fetch(`${baseUrl}/ops/v1/expenses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${login.access_token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "depth-auth-expense-001"
    },
    body: JSON.stringify({ expense_date: today, category: "fuel", amoeba_id: "amoeba_island", amount_ngn: 100 })
  });
  assert.equal(forbiddenExpense.status, 403);

  const forbiddenReview = await fetch(`${baseUrl}/ops/v1/inspections/none/review`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${login.access_token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "depth-auth-review-001"
    },
    body: JSON.stringify({ decision: "approved" })
  });
  assert.equal(forbiddenReview.status, 403);
});
