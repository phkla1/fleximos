# Supervisor App — Revised Spec v0.1 (Amoeba Control Room)

**Status:** Draft for stakeholder review
**Supersedes:** the supervisor sections of the current ops-console, guided by
`docs/Supervisor-App-Frontend-Brief.md`
**Related:** `docs/NEW-Fleximotion-Ops-Spec-v0.4.md`, `docs/Fleximotion-Revised-Build-Plan.md`

This spec merges the frontend brief with what is already built. Every
capability is tagged:

- **EXISTS** — already live in the Ops API and/or supervisor console.
- **EXTEND** — exists but needs surface, copy, or model extension.
- **NEW** — new domain work (API + UI).

Flagged decisions for the product owner are marked **⚑ DECIDE**.

---

## 1. Positioning and principles

The supervisor app is a mobile-first field-operations cockpit for running
one team's operating day: operators, vehicles, fuel/charge, cash, incidents,
deliveries. Managers and finance have their own consoles; the supervisor
does not report upward manually — the system carries state upward
(escalations, closeouts, exceptions).

Adopted unchanged from the brief: action-first landing, operating rhythm
(readiness → pace checks → closeout), grouped-before-detailed, no internal
IDs, plain field language, red/yellow/green + gauge visual grammar, large
touch targets, 320px-safe.

**⚑ DECIDE — scoping model.** The brief says "supervisor equals amoeba
owner". The built model is deliberately looser: operators point at a
`supervisor_person_id` (team-based), an amoeba can host multiple teams, and
access scopes are separate from reporting lines (phase 4A). Recommendation:
keep **team-based scoping** as the truth — the app shows "my operators";
when one supervisor owns a whole amoeba the experience is identical to the
brief. Hard-coding supervisor=amoeba would break multi-team amoebas.

## 2. Screens

### 2.1 Today Cockpit (default) — EXTEND
Replaces the current summary-tile header with a cockpit:

- Gauges: Net Earnings pace vs range target (EXISTS: `pace_status`,
  `expected_revenue_ngn`), utilisation (live/active — EXISTS), readiness
  compliance (NEW, see 2.5), closeout readiness (EXTEND, see 2.9).
- Cards (RYG): not seen today / offline after online (EXISTS via
  `current_status`), open critical alerts (EXISTS), fuel-battery-mileage
  risk (EXISTS: mileage exceptions), overdue inspections (EXISTS:
  compliance), scheduled-delivery progress (NEW).
- "Top 3 actions now" strip (EXTEND): ranked from open alerts tier,
  unacknowledged incidents, overdue inspections, missing fuel confirms,
  closeout blockers. Pure frontend ranking over existing data.

### 2.2 Operator Board — EXTEND
Regroup the existing team board tiles by state instead of a flat list:
not seen today · late resumption (NEW, needs config, see 3.4) · on track ·
behind pace · offline after online · on delivery (NEW) · open alert ·
fuel/battery risk · vehicle issue. Tile contents already exist (name,
plate, vehicle type, pace, hours, trips, alerts); add acceptance signal
(EXISTS in performance rows).

### 2.3 Operator Detail — EXTEND
One sheet per operator: today's figures vs target (EXISTS), platform
accounts (EXISTS), vehicle + inspection + maintenance status (EXISTS),
fuel/charge + mileage since last issue (EXTEND), active alerts + deviation
reasons (EXISTS), incidents (EXISTS), day timeline (EXTEND — v1 timeline is
derived from recorded events: status changes, alerts, fuel confirms,
inspections, incidents. Minute-level platform telemetry does not exist in
the daily-aggregate connectors and is NOT promised).

Actions: call (tel: link — EXISTS data), nudge (EXTEND: reuse notification
outbox → operator PWA), note (EXISTS), ack/resolve alert (EXISTS),
accept/reject deviation (EXISTS), escalate (EXISTS), mark unavailable
(NEW — field-action workflow, see 4), suspend Fleximos access (NEW,
restricted, see 4).

### 2.4 Alert Queue — EXTEND
Grouped conditions first (pattern EXISTS in admin console; port to
supervisor with actions). Add **snooze** (NEW):

**⚑ DECIDE — snooze guardrails.** Recommend snooze requires a reason and an
auto-unsnooze time (max: end of operating day), and snoozed counts remain
visible to the manager. Silent indefinite snooze hides risk.

### 2.5 Readiness Checks — NEW
Two-sided model per the brief. Phasing:
- **v1 (supervisor-only):** supervisor records spot-checks (vehicle
  condition, fuel/battery, phone, network, safety kit, handsfree; photo
  optional) against each operator; compliance gauge = checked-and-passed /
  active. New API: readiness check records (operator_id, date, items[],
  result, media refs, actor).
- **v2 (operator self-check):** operator app submits the same items;
  supervisor reviews exceptions only. Same data model, different actor —
  design the record with `submitted_by` = operator|supervisor from day one.

### 2.6 Fuel, Battery, Mileage — EXTEND
Everything listed exists for fuel (issues, expected vs official vs tracker
distance, variance, tracker-unavailable states). Extensions: (a) "charge"
as a first-class issue type — efficiency policy already carries
`fuel_type`/`fuel_unit`, so add `electric`/`kWh` policy rows and label the
UI "fuel/charge"; (b) "mileage since last issue" derived view.

### 2.7 Scheduled Deliveries — NEW (largest new domain)
Adopt the brief's three-mode model wholesale; it matches the suite's
provenance/data-quality ethos.

- **v1 = batch-level control** (works with zero customer integration):
  delivery customers, batches (customer, date, manifest ref, expected /
  received / sorted / assigned / out / delivered / failed / returned
  counts), operator assignments, exceptions, notes. Counts entered
  manually or via CSV import. Source labels `customer_app_manual`,
  `customer_app_import`, `customer_api` shown on every figure.
- **v2 = package-level Fleximos scanning** (operator app barcode/QR with
  offline queue): design the package/scan-event tables now (package id,
  batch, customer, operator, event type, timestamp, GPS, source, proof
  media) but build later. `fleximos_scan` source label.
- **v3 = hybrid reconciliation:** stage-by-stage comparison
  (expected↔received↔sorted↔assigned↔delivered↔customer records);
  differences become supervisor exceptions.

Ownership: Ops API (operational activity). New endpoints:
`/ops/v1/delivery-customers`, `/ops/v1/delivery-batches` (+ counts,
assignments, exceptions, imports). Suite rules apply (idempotency, audit,
scoped access).

### 2.8 Inspections & Maintenance — EXISTS (photo evidence now live)
Built: policy-driven compliance (interval configurable in the admin
Controls fleet policy; default 48h), overdue list, submissions, maintenance
queue with repair states and costs. Photo evidence is live: supervisors
capture an optional camera-only photo (input `capture=environment`, app
timestamps `captured_at`, GPS attached when granted, server enforces a
freshness window when `MEDIA_STRICT_CAPTURE=true`) on inspections and
maintenance reports; managers see the evidence on needs-review inspections
and open maintenance in their escalation queue. Remaining EXTEND:
"vehicles not available for work" derived group.

#### Photo-evidence survey (where optional camera capture belongs)
| Surface | Status |
|---|---|
| Vehicle inspections (supervisor) | **Live** |
| Maintenance reports (supervisor) | **Live** |
| Incidents (operator PWA report + supervisor view) | Operator-app slice — model ready (`media_ids` exists; accidents can require photos via strict mode) |
| Readiness self-checks | S2 with readiness (photo proof items) |
| Delivery proof-of-delivery, exceptions, returns | S2/S3 deliveries |
| Vehicle handover/return condition | S2 field-action requests |
| Fuel receipts/gauges | **Deliberately excluded** — replaced by the card-based petrol-chain partnership |
| Cash | Excluded — Monnify provides the digital trail |

### 2.9 Daily Closeout — EXTEND (API exists, UI missing)
`POST /ops/v1/daily-closeouts` exists; the supervisor console has no UI.
Build the structured checklist exactly as briefed: unresolved alerts,
cash issues, fuel/mileage exceptions, incidents, delivery exceptions,
vehicle returns, maintenance blockers, summary — each auto-populated,
each requiring review or explanation; optional note; timestamped submit.
Manager console already surfaces missing closeouts.

## 3. Cross-cutting model changes

- **3.1 Field-action requests (NEW):** one entity for restricted actions —
  mark-unavailable, Fleximos suspension, platform-suspension request,
  immobilisation request. States: requested → pending → succeeded / failed /
  unavailable. Critical manager-visible event + audit (actor, reason, GPS,
  timestamps). UI copy must state the true state; never imply a platform
  suspension succeeded unless it did. Third-party immobiliser/platform APIs
  are integration stubs until those integrations exist.
- **3.2 Nudges (EXTEND):** supervisor→operator message rides the existing
  notification outbox; appears in operator PWA.
- **3.3 Battery/charge (EXTEND):** as 2.6.
- **3.4 Resumption config (NEW):** "late resumption" needs an expected
  resumption time (per amoeba or per operator). Add to pace-profile or a
  small shift-config; until configured the group is hidden.
- **3.5 Offline-safe writes (EXTEND, phased):** the PWA shell exists;
  add a queued-mutation layer (idempotency keys make replays safe) for
  ack/resolve, readiness, fuel confirms, delivery counts. Phase after the
  core screens.

## 4. What this spec deliberately does NOT change

- Team-based supervision and the 4A scoped-access model (see ⚑ 1).
- Ops API ownership boundaries; deliveries live in Ops.
- The manager/finance/admin consoles.
- Existing alert/deviation/incident/inspection/maintenance/closeout logic.
- The From/To range model (cockpit defaults to today; history views accept
  ranges).

## 5. Phasing

- **S1 — Cockpit & rhythm (no new APIs):** cockpit landing with gauges +
  top-3 actions, grouped operator board, operator detail sheet, ported
  grouped alert queue, closeout checklist UI, fuel/charge relabel.
  Mobile-first redesign of ops-console in the gauge/RYG language.
- **S2 — New domains v1:** readiness spot-checks (new API), scheduled
  deliveries batch-level (new APIs + CSV import), snooze with guardrails,
  nudges, field-action requests (Fleximos-side states only), late-resumption
  config.
- **S3 — Deeper field truth:** operator-app self-checks, package-level
  scanning + reconciliation, offline write queue, immobiliser/platform
  integration when third-party access exists.

Each slice keeps the suite acceptance standards: OpenAPI + docs + API tests
+ Playwright mobile/desktop coverage + acceptance-script updates.

## 6. Acceptance checks (carried from the brief, plus)

All brief checks adopted, plus:
- Closeout can be completed end-to-end on a phone in under 2 minutes on a
  clean day.
- Every delivery figure shows its source label.
- A snoozed alert resurfaces automatically and is visible to the manager
  while snoozed.
- Field-action requests always show true third-party state.
- The existing e2e suite still passes; new screens get mobile-viewport
  specs.
