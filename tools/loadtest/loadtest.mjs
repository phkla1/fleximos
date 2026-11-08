// FlexiMOS load/response harness.
//
// Models the DOMINANT production load: supervisor/admin dashboards, each firing
// the ops-console refresh() fan-out (~26 endpoints) every 20s. It ramps the
// number of concurrent dashboards, and for each step reports per-endpoint
// p50/p95/p99 latency, throughput, error rate, and (when it can see the server
// process) its RSS + CPU. The latency knee across steps is what sizes the box.
//
// Against an already-running, already-seeded stack:
//   OPS_BASE=https://box OPS_PID=<pid> node tools/loadtest/loadtest.mjs
// Fully local (boots a seeded PGlite stack, runs, tears down):
//   node tools/loadtest/loadtest.mjs --local
//
// Knobs: LOAD_STEPS=1,2,4,6,8  LOAD_STEP_SECONDS=45  LOAD_REFRESH_MS=20000
//        LOAD_OPERATORS=100 LOAD_DAYS=90 (local seed)

import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { seedLoad } from "./seed-load.mjs";

const execFileP = promisify(execFile);
const LOCAL = process.argv.includes("--local");

const cfg = {
  ops: process.env.OPS_BASE || "http://127.0.0.1:4030",
  foundation: process.env.FOUNDATION_BASE || "http://127.0.0.1:4010",
  token: process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token",
  steps: (process.env.LOAD_STEPS || "1,2,4,6,8").split(",").map((n) => Number(n.trim())).filter(Boolean),
  stepSeconds: Number(process.env.LOAD_STEP_SECONDS || 45),
  refreshMs: Number(process.env.LOAD_REFRESH_MS || 20000),
  pid: process.env.OPS_PID ? Number(process.env.OPS_PID) : null
};

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const range = `date_from=${today}&date_to=${today}`;

// The real supervisor refresh() fan-out, as ops-console/assets/app.js fires it.
function fanout() {
  const o = (p) => [cfg.ops, p];
  return [
    [cfg.foundation, "/identity/v1/people"],
    o("/ops/v1/operators"),
    o("/ops/v1/daily-performance"),                 // NB: no date filter — returns the whole table
    o(`/ops/v1/checkins?check_in_date=${today}`),
    o(`/ops/v1/team-board?${range}`),
    o(`/ops/v1/pacing?record_date=${today}`),
    o(`/ops/v1/alerts?${range}`),
    o(`/ops/v1/fuel-issues?${range}`),
    o(`/ops/v1/mileage-reconciliations?${range}`),
    o("/ops/v1/incidents"),
    o("/ops/v1/inspections"),
    o("/ops/v1/inspections/compliance"),
    o("/ops/v1/maintenance-reports"),
    o("/ops/v1/vehicles"),
    o(`/ops/v1/daily-closeouts?record_date=${today}`),
    o(`/ops/v1/delivery-batches?${range}`),
    o(`/ops/v1/delivery-assignments?${range}`),
    o("/ops/v1/delivery-exceptions"),
    o("/ops/v1/delivery-customers"),
    o("/ops/v1/revenue-sources"),
    o(`/ops/v1/delivery-stops?${range}`),
    o(`/ops/v1/delivery-summary?${range}`),
    o("/ops/v1/vehicle-positions"),
    o("/ops/v1/integration-status"),
    o(`/ops/v1/checkins?${range}`),
    o(`/ops/v1/leaderboard?period_start=${today}&period_end=${today}`)
  ];
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const mean = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

async function hit(base, p, stats) {
  const key = p.split("?")[0];
  const t0 = performance.now();
  let ok = false;
  try {
    const res = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    await res.text();
    ok = res.ok;
  } catch { ok = false; }
  const dt = performance.now() - t0;
  const e = stats.get(key) || { lat: [], ok: 0, err: 0 };
  e.lat.push(dt); ok ? e.ok++ : e.err++;
  stats.set(key, e);
}

async function dashboardLoop(deadline, stats) {
  while (performance.now() < deadline) {
    const cycleStart = performance.now();
    await Promise.all(fanout().map(([b, p]) => hit(b, p, stats)));
    const elapsed = performance.now() - cycleStart;
    const wait = Math.max(0, cfg.refreshMs - elapsed);
    if (performance.now() + wait >= deadline) break;
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function sampleServer(deadline, samples) {
  if (!cfg.pid) return;
  while (performance.now() < deadline) {
    try {
      const { stdout } = await execFileP("ps", ["-o", "%cpu=", "-o", "rss=", "-p", String(cfg.pid)]);
      const [cpu, rss] = stdout.trim().split(/\s+/).map(Number);
      if (Number.isFinite(cpu) && Number.isFinite(rss)) samples.push({ cpu, rssMb: Math.round(rss / 1024) });
    } catch { /* process may be busy */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function runStep(dashboards) {
  const stats = new Map();
  const samples = [];
  const deadline = performance.now() + cfg.stepSeconds * 1000;
  const vus = Array.from({ length: dashboards }, () => dashboardLoop(deadline, stats));
  await Promise.all([...vus, sampleServer(deadline, samples)]);

  let total = 0, errs = 0, allLat = [];
  for (const e of stats.values()) { total += e.lat.length; errs += e.err; allLat.push(...e.lat); }
  const perEndpoint = [...stats.entries()].map(([pth, e]) => ({
    endpoint: pth, n: e.lat.length, p50: pct(e.lat, 50), p95: pct(e.lat, 95), p99: pct(e.lat, 99), errs: e.err
  })).sort((a, b) => b.p95 - a.p95);

  return {
    dashboards,
    reqs: total,
    rps: +(total / cfg.stepSeconds).toFixed(1),
    errPct: total ? +((errs / total) * 100).toFixed(1) : 0,
    p50: pct(allLat, 50), p95: pct(allLat, 95), p99: pct(allLat, 99),
    cpuMean: samples.length ? mean(samples.map((s) => s.cpu)) : null,
    cpuPeak: samples.length ? Math.max(...samples.map((s) => s.cpu)) : null,
    rssPeakMb: samples.length ? Math.max(...samples.map((s) => s.rssMb)) : null,
    perEndpoint
  };
}

function printReport(results) {
  console.log("\n================ LOAD TEST REPORT ================");
  console.log(`target=${cfg.ops}  step=${cfg.stepSeconds}s  refresh=${cfg.refreshMs}ms  fan-out=${fanout().length} endpoints/dashboard/cycle\n`);
  console.log("dashboards |  req/s | err% | p50ms | p95ms | p99ms |  CPU% (mean/peak) | RSS MB");
  console.log("-----------+--------+------+-------+-------+-------+-------------------+-------");
  for (const r of results) {
    const cpu = r.cpuMean === null ? "    —    " : `${String(r.cpuMean).padStart(3)}/${String(r.cpuPeak).padStart(4)}`;
    const rss = r.rssPeakMb === null ? "  —" : String(r.rssPeakMb);
    console.log(
      `${String(r.dashboards).padStart(9)} | ${String(r.rps).padStart(6)} | ${String(r.errPct).padStart(4)} | ${String(r.p50).padStart(5)} | ${String(r.p95).padStart(5)} | ${String(r.p99).padStart(5)} | ${cpu.padStart(17)} | ${rss}`
    );
  }
  const top = results[results.length - 1];
  console.log(`\nSlowest endpoints at ${top.dashboards} dashboards (by p95):`);
  console.log("  p95ms   p99ms    n   errs  endpoint");
  for (const e of top.perEndpoint.slice(0, 12)) {
    console.log(`  ${String(e.p95).padStart(5)}   ${String(e.p99).padStart(5)}  ${String(e.n).padStart(4)}  ${String(e.errs).padStart(4)}  ${e.endpoint}`);
  }
  console.log("==================================================\n");
}

async function waitFor(child, marker) {
  let out = "";
  while (!out.includes(marker)) { const [c] = await once(child.stdout, "data"); out += String(c); }
}

async function main() {
  let foundation, ops;
  try {
    if (LOCAL) {
      const repo = new URL("../..", import.meta.url).pathname;
      const fPort = 4610, oPort = 4630;
      cfg.foundation = `http://127.0.0.1:${fPort}`;
      cfg.ops = `http://127.0.0.1:${oPort}`;
      const fDb = path.join(tmpdir(), `loadtest-foundation-${Date.now()}`);
      const oDb = path.join(tmpdir(), `loadtest-ops-${Date.now()}`);
      console.log("local: booting seeded PGlite stack…");
      foundation = spawn("node", ["apps/api-foundation/server.mjs"], { cwd: repo, env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(fPort), HOST: "127.0.0.1", FLEXI_DB_DIR: fDb }, stdio: ["ignore", "pipe", "pipe"] });
      foundation.stderr.on("data", () => {});
      await waitFor(foundation, "Foundation API:");
      // `node --import tsx` keeps ops-api a SINGLE process whose pid we can sample
      // (npx/tsx-bin wrappers fork a child, so sampling them reads ~0% CPU).
      ops = spawn("node", ["--import", "tsx", "apps/ops-api/src/main.ts"], { cwd: repo, env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(oPort), HOST: "127.0.0.1", FLEXI_OPS_DB_DIR: oDb, FLEXI_OPS_MEDIA_DIR: `${oDb}-media`, FOUNDATION_API_BASE: cfg.foundation }, stdio: ["ignore", "pipe", "pipe"] });
      ops.stderr.on("data", () => {});
      await waitFor(ops, "Ops API:");
      cfg.pid = ops.pid;
      await seedLoad({ opsBase: cfg.ops, foundationBase: cfg.foundation, token: cfg.token, operators: Number(process.env.LOAD_OPERATORS || 100), days: Number(process.env.LOAD_DAYS || 90) });
    }

    console.log(`\nramping dashboards: ${cfg.steps.join(" → ")} (each ${cfg.stepSeconds}s)`);
    const results = [];
    for (const n of cfg.steps) {
      process.stdout.write(`  running ${n} dashboard(s)… `);
      const r = await runStep(n);
      console.log(`${r.rps} req/s · p95 ${r.p95}ms · err ${r.errPct}%`);
      results.push(r);
    }
    printReport(results);
  } finally {
    ops?.kill();
    foundation?.kill();
  }
}

main().catch((e) => { console.error("loadtest failed:", e.message); process.exit(1); });
