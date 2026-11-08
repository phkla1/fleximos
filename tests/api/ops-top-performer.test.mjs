import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const port = 4480;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4481;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-topperf-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-topperf-auth-test-${Date.now()}`);
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
    env: {
      ...process.env,
      FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir, FOUNDATION_API_BASE: foundationBaseUrl
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
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(token);
const anon = as(null);
const key = () => ({ "Idempotency-Key": randomUUID() });

test.before(startServer);
test.after(() => { server?.kill(); foundationServer?.kill(); });

test("the bonus settings default to ₦2k above a ₦28k floor", async () => {
  const res = await admin("/ops/v1/top-performer/settings");
  assert.equal(res.response.status, 200);
  assert.equal(Number(res.body.amount_ngn), 2000);
  assert.equal(Number(res.body.threshold_ngn), 28000);
  assert.equal(res.body.enabled, true);
});

test("settings can be reconfigured by an admin and are rejected without a key", async () => {
  const noKey = await admin("/ops/v1/top-performer/settings", { method: "POST", body: JSON.stringify({ amount_ngn: 2500 }) });
  assert.equal(noKey.response.status, 401);

  const res = await admin("/ops/v1/top-performer/settings", {
    method: "POST", headers: key(), body: JSON.stringify({ amount_ngn: 2500, threshold_ngn: 28000, enabled: true })
  });
  assert.equal(res.response.status, 200);
  assert.equal(Number(res.body.amount_ngn), 2500);

  // Restore the default so the figure is not surprising elsewhere.
  await admin("/ops/v1/top-performer/settings", {
    method: "POST", headers: key(), body: JSON.stringify({ amount_ngn: 2000 })
  });
});

test("listing awards requires authentication and returns a payable total", async () => {
  const unauth = await anon("/ops/v1/top-performer/awards");
  assert.equal(unauth.response.status, 401);

  const res = await admin("/ops/v1/top-performer/awards?record_date=2026-11-07");
  assert.equal(res.response.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok("total_payable_ngn" in res.body);
});

test("recompute settles the day idempotently and returns a tally", async () => {
  const first = await admin("/ops/v1/top-performer/awards/recompute", {
    method: "POST", headers: key(), body: JSON.stringify({ record_date: "2026-11-07" })
  });
  assert.equal(first.response.status, 200);
  for (const field of ["received", "upserted", "rejected"]) assert.ok(field in first.body, `missing ${field}`);

  // A fresh key recomputes the same day — must not throw or duplicate.
  const second = await admin("/ops/v1/top-performer/awards/recompute", {
    method: "POST", headers: key(), body: JSON.stringify({ record_date: "2026-11-07" })
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.received, first.body.received);
});

// Onboarding mode-deviation flag (same Phase-3 server, so reuse this boot).
test("onboarding mode-deviations needs auth and returns a dated list", async () => {
  const unauth = await anon("/ops/v1/onboarding/mode-deviations");
  assert.equal(unauth.response.status, 401);

  const res = await admin("/ops/v1/onboarding/mode-deviations?record_date=2026-11-07");
  assert.equal(res.response.status, 200);
  assert.equal(res.body.record_date, "2026-11-07");
  assert.ok(Array.isArray(res.body.data));
  // Every row, when present, must name both the expected and the actual mode.
  for (const d of res.body.data) {
    assert.ok(d.expected_mode && d.actual_mode && d.deviation, "deviation row is fully described");
    assert.ok(d.operator_id && d.amoeba_id);
  }
});
