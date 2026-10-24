// Phase 1 migration (Amoeba model): set each amoeba's supervisor from the
// dominant supervisor among its current active operators.
//
// Background: historically the supervisor lived on the operator
// (ops_operators.supervisor_person_id), independently of the amoeba. The
// corrected model is "an amoeba has exactly one supervisor", so this derives and
// writes amoebas.supervisor_person_id (Foundation) from the operators (Ops).
//
// Safe to re-run. By default it only fills amoebas that have no supervisor yet;
// pass FORCE=1 to overwrite every amoeba with the current dominant supervisor.
//
//   FOUNDATION_API_BASE=... OPS_API_BASE=... FLEXI_SERVICE_TOKEN=... \
//     node scripts/backfill-amoeba-supervisors.mjs [--dry-run]

const foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
const opsBase = process.env.OPS_API_BASE || "http://127.0.0.1:4030";
const token = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";
const force = process.env.FORCE === "1" || process.env.FORCE === "true";
const dryRun = process.argv.includes("--dry-run");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body.message || body.error?.message || response.status}`);
  return body;
}

const amoebas = (await request(foundationBase, "/amoeba/v1/amoebas")).data;
const operators = (await request(opsBase, "/ops/v1/operators")).data;

// Dominant active-operator supervisor per amoeba.
const dominant = new Map();
for (const amoeba of amoebas) {
  const counts = new Map();
  for (const op of operators) {
    if (op.amoeba_id !== amoeba.amoeba_id) continue;
    if (op.operator_status !== "active") continue;
    if (!op.supervisor_person_id) continue;
    counts.set(op.supervisor_person_id, (counts.get(op.supervisor_person_id) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [person, count] of counts) if (count > bestCount) { best = person; bestCount = count; }
  if (best) dominant.set(amoeba.amoeba_id, { person: best, count: bestCount, total: [...counts.values()].reduce((a, b) => a + b, 0) });
}

let set = 0;
let skipped = 0;
for (const amoeba of amoebas) {
  const derived = dominant.get(amoeba.amoeba_id);
  if (!derived) { console.log(`- ${amoeba.name}: no active operator with a supervisor — left unset`); skipped++; continue; }
  if (amoeba.supervisor_person_id && !force) {
    console.log(`- ${amoeba.name}: already has a supervisor (${amoeba.supervisor_person_id}) — skipped (FORCE=1 to overwrite)`);
    skipped++;
    continue;
  }
  const note = derived.count < derived.total ? ` (${derived.count}/${derived.total} operators — not unanimous)` : "";
  if (dryRun) { console.log(`- ${amoeba.name}: would set supervisor ${derived.person}${note}`); continue; }
  await request(foundationBase, `/amoeba/v1/amoebas/${amoeba.amoeba_id}/assign-supervisor`, {
    method: "POST",
    headers: { "Idempotency-Key": `backfill-supervisor-${amoeba.amoeba_id}-${derived.person}` },
    body: JSON.stringify({ supervisor_person_id: derived.person })
  });
  console.log(`- ${amoeba.name}: set supervisor ${derived.person}${note}`);
  set++;
}

console.log(`\nDone. ${dryRun ? "(dry run) " : ""}${set} set, ${skipped} skipped, ${amoebas.length} amoebas total.`);
