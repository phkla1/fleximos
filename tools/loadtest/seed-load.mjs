// Production-scale seed for load testing. Adds N operators (default 100) across
// the existing amoebas and D days (default 90) of daily platform records, on top
// of whatever demo seed already created the amoebas/site/platform accounts. It is
// HTTP-driven (so it works against local, staging or prod identically) and
// idempotent on re-run (operators dedup by phone; records upsert by date).
//
// It does NOT touch scripts/seed-ops-demo.mjs — that stays the small demo the e2e
// relies on. Run this after the demo seed to reach go-live scale.
//
//   OPS_BASE=http://127.0.0.1:4030 FOUNDATION_BASE=http://127.0.0.1:4010 \
//   LOAD_OPERATORS=100 LOAD_DAYS=90 node tools/loadtest/seed-load.mjs

const DEFAULTS = {
  opsBase: process.env.OPS_BASE || "http://127.0.0.1:4030",
  foundationBase: process.env.FOUNDATION_BASE || "http://127.0.0.1:4010",
  token: process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token",
  operators: Number(process.env.LOAD_OPERATORS || 100),
  days: Number(process.env.LOAD_DAYS || 90)
};

let idem = 0;
const key = () => `loadseed-${Date.now()}-${idem++}`;

async function api(base, path, { method = "GET", body, token } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (method !== "GET") headers["Idempotency-Key"] = key();
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(json && (json.message || json.error)) || text.slice(0, 160)}`);
  return json;
}

function lagosDate(offset = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Deterministic pseudo-random so a re-seed produces the same shape.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

export async function seedLoad(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const log = cfg.log || ((...a) => console.log(...a));
  const { opsBase, foundationBase, token, operators: N, days: D } = cfg;

  // 1) Resolve amoebas + a site + the Bolt-style platform account from what the
  //    demo seed created. Spread operators across all amoebas; share one site.
  const amoebas = (await api(foundationBase, "/amoeba/v1/amoebas", { token })).data || [];
  const sites = (await api(foundationBase, "/amoeba/v1/sites", { token })).data || [];
  if (!amoebas.length || !sites.length) throw new Error("No amoebas/sites found — run the demo seed first (FLEXI_SEED_DEMO=true).");
  const amoebaNames = amoebas.map((a) => a.name).filter(Boolean);
  const siteName = sites[0].name;

  const platforms = (await api(opsBase, "/ops/v1/platform-accounts", { token })).data || [];
  const platform = platforms.find((p) => p.platform === "bolt" && p.is_active) || platforms.find((p) => p.is_active) || platforms[0];
  if (!platform) throw new Error("No platform account found — run the demo seed first.");
  log(`seed: ${N} operators × ${D} days · amoebas=${amoebaNames.length} · platform=${platform.display_name}`);

  // 2) Bulk-create operators via the batch importer (person+user+operator in one
  //    call per row). Idempotent: existing phones are skipped.
  const rows = Array.from({ length: N }, (_, i) => ({
    display_name: `Load Rider ${String(i + 1).padStart(3, "0")}`,
    phone: `0700${String(i + 1).padStart(7, "0")}`,
    operator_type: "rider",
    amoeba: amoebaNames[i % amoebaNames.length],
    site: siteName
  }));
  const imported = await api(opsBase, "/ops/v1/imports/operators", { method: "POST", token, body: { dry_run: false, rows } });
  const created = imported.rows.filter((r) => r.status === "create").length;
  log(`seed: operators imported (${created} new, ${imported.summary.skip} existing)`);

  // 3) Map each load operator to a platform_operator_id (load-<n>), so daily
  //    records can be ingested against them. Reuse by phone → operator.
  const roster = (await api(opsBase, "/ops/v1/operators", { token })).data || [];
  // Match our load riders by the phone we assigned (names live in foundation).
  const people = (await api(foundationBase, "/identity/v1/people", { token })).data || [];
  const personByPhone = new Map(people.map((p) => [p.phone, p.person_id]));
  const opByPerson = new Map(roster.map((o) => [o.person_id, o]));

  const mapping = []; // { operator_id, platform_operator_id }
  for (let i = 0; i < N; i++) {
    const personId = personByPhone.get(`0700${String(i + 1).padStart(7, "0")}`);
    const op = personId && opByPerson.get(personId);
    if (!op) continue;
    const platformOperatorId = `load-${String(i + 1).padStart(3, "0")}`;
    mapping.push({ operator_id: op.operator_id, platform_operator_id: platformOperatorId });
    try {
      await api(opsBase, `/ops/v1/operators/${op.operator_id}/platform-registrations`, {
        method: "POST", token, body: { platform_account_id: platform.platform_account_id, platform_operator_id: platformOperatorId, registration_status: "active" }
      });
    } catch (e) {
      if (!/already has a registration/i.test(String(e.message))) throw e; // re-run is fine
    }
  }
  log(`seed: ${mapping.length} platform registrations ready`);

  // 4) D days of daily records, one ingestion run per day (all operators at once).
  const rand = rng(12345);
  for (let d = 0; d < D; d++) {
    const recordDate = lagosDate(-d);
    const records = mapping.map((m) => {
      const trips = 6 + Math.floor(rand() * 20);
      const revenue = Math.round((18000 + rand() * 20000) / 100) * 100;
      return {
        platform_operator_id: m.platform_operator_id,
        trips_total: trips, trips_completed: trips, trips_cancelled: 0, trips_no_response: 0, trips_rejected: 0,
        ride_revenue_ngn: revenue, net_earnings_ngn: Math.round(revenue * 0.82), booking_fees_ngn: 0,
        cash_trips: Math.floor(trips * 0.4), card_trips: Math.ceil(trips * 0.6),
        acceptance_pct: 90, cancellation_pct: 3, completion_pct: 97,
        hours_online: 6 + Math.round(rand() * 4), current_status: "checked_out", data_quality: "authoritative"
      };
    });
    await api(opsBase, "/ops/v1/ingestion-runs", { method: "POST", token, body: { platform_account_id: platform.platform_account_id, record_date: recordDate, source: "migration", records } });
    if (d % 15 === 0 || d === D - 1) log(`seed: records ${d + 1}/${D} days (${recordDate})`);
  }
  log(`seed: done — ${mapping.length} operators × ${D} days = ${mapping.length * D} daily records`);
  return { operators: mapping.length, days: D, records: mapping.length * D };
}

// Run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedLoad().catch((e) => { console.error("seed-load failed:", e.message); process.exit(1); });
}
