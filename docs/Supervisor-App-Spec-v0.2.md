# Supervisor App — Spec v0.2

**Surface:** `apps/ops-console/` — "Fleximotion Supervisor App"
**Audience:** supervisors running one team's operating day.
**Supersedes:** Supervisor-App-Spec-v0.1 and the supervisor sections of
`docs/Supervisor-App-Frontend-Brief.md`.
**Related:** `docs/Scheduled-Deliveries-Spec-v0.2.md`,
`docs/Operator-App-Spec-v0.1.md`, `docs/acceptance-tests/supervisor.md`.

---

## 1. What the app is

A mobile-first field-operations cockpit for running one team's day:
operators, vehicles, fuel/charge, cash, mileage, deliveries, incidents,
closeout. It opens on "what needs my action now", moves with the operating
rhythm (readiness → live pace → alerts → fuel → field issues → closeout),
and carries state upward automatically — the supervisor never compiles a
report for the manager; escalations, closeouts and exceptions do that.

Principles: action-first landing; grouped before detailed; red/yellow/green
and gauge visual grammar; plain field language, no internal IDs or
connector jargon; large touch targets; usable at 320px; installable to the
home screen.

**Scoping.** Supervision is team-based: each operator points at a
supervisor, and the app shows only that supervisor's operators. An amoeba
can host multiple teams; where one supervisor owns a whole amoeba the
experience is identical. Access scopes are enforced server-side and are
separate from reporting lines.

**Money visibility.** The supervisor sees every money figure and ratio
that affects his own team: Net Earnings and pace vs target, fuel cost ₦
(litres × the price-per-litre on the efficiency policy), fuel cost/KM,
Net Earnings/KM, km/L, earnings-to-fuel ratio, maintenance and repair
costs, and team contribution (Net Earnings − fuel − maintenance). The one
exclusion: delivery **contract prices** are finance/manager-only —
supervisors see allocated values everywhere.

## 2. Screens

Navigation is a seven-tab dock: **Cockpit · Board · Alerts · Deliver ·
Fuel · Field · Close**. Every screen honours the From/To date range in the
top bar (defaults to today = today; targets scale by day count).

### 2.1 Cockpit (landing)
- Three gauges: Net Earnings pace vs range target, utilisation
  (live/active), closeout readiness — each coloured by state.
- **Do these first**: up to three ranked actions (high-tier alerts,
  incidents to acknowledge, operator explanations to review, overdue
  inspections, unconfirmed fuel), each with a button that jumps straight
  to the work. "All clear" on a clean day.
- Team-condition cards (red/yellow/green): not seen today, offline after
  coming online, open alerts, behind pace, fuel/mileage risk, vehicle
  issues, closeout blockers, scheduled-delivery progress. Tapping a card
  jumps to the tab where the work happens.

### 2.2 Board
- Operators grouped by state — risky groups open first: not seen today ·
  late resumption · behind pace · offline after online · on delivery ·
  open alert · fuel/battery risk · vehicle issue · on track. Tiles show
  name, plate, live status, pace pill, progress vs target, trips, hours,
  alerts, platform badges.
- Attendance grouping: scheduled / present / late / approved absence /
  unauthorised absence. "Late" comes from the team's expected resumption
  time; "approved absence" from mark-unavailable; "unauthorised" is not
  seen today with no approval.
- **Driver comparison table**: one sortable row per driver — Net
  Earnings, target %, trips, KM, ₦/KM, fuel ₦, fuel cost/KM, km/L,
  attendance, incidents — with CSV export.
- **Vehicle comparison table**: one row per vehicle — assigned driver,
  status, Net Earnings, trips, KM, fuel ₦, idle days, maintenance state
  and cost — with CSV export. A vehicle-day with an assigned operator and
  zero trips counts as an idle day (day-level only; there is no
  hour-level telemetry and none is promised).

### 2.3 Operator detail
One sheet per operator: today's figures vs target, platform accounts,
vehicle with inspection and maintenance status, fuel/charge and mileage
since last issue, active alerts with deviation reasons, incidents, and a
day timeline built from recorded events (status changes, alerts, fuel
confirms, inspections, incidents).

Actions: call, nudge (message to the operator app), note, acknowledge or
resolve an alert, accept/reject a deviation reason, escalate to manager,
mark unavailable, request Fleximos suspension.

### 2.4 Alerts
Grouped conditions first ("3 operators · behind pace"), then individuals.
Actions: acknowledge, resolve, escalate, snooze. Snoozing requires a
reason and an auto-unsnooze time capped at end of the operating day;
snoozed counts stay visible to the manager. Open incidents and alerts show
their age ("open 3 days"); each has an owner (defaulting to whoever
acknowledged it) and an optional required-action note.

The alert catalogue: behind pace · not seen today · offline after online ·
mileage outside expected range · fuel consumption above benchmark ·
vehicle inactive beyond threshold · absent without approval · service due
or overdue · odometer reading not submitted · repeated underperformance ·
ghost activity on a de-assigned platform account.

### 2.5 Deliver (scheduled deliveries)
- Batches per delivery customer and date with the count ladder: expected →
  received → sorted → assigned → delivered / failed / returned / left.
  Every figure carries its source label (customer app manual / import /
  API / operator manual / Fleximos scan).
- Assign or adjust per-driver package targets at any time; paste-import a
  stop manifest (`customer, address, phone, parcels` lines) so stops
  appear in the rider's Dispatch screen.
- Riders record their own stop progress with POD (photo, GPS, timestamp,
  signature); rider-entered figures show a chip and require supervisor
  confirmation, normally at closeout.
- Exceptions with category, note and optional camera photo; resolving and
  closing locks the batch. Supervisors see allocated values only.

### 2.6 Fuel
Record and confirm fuel/charge issues (litres or kWh). The reconciliation
list shows, per issue: issued quantity, fuel cost ₦, expected distance,
official platform distance, tracker distance where available (bikes
typically show "tracker unavailable" — by design), variance pills, km/L
and fuel cost/KM.

### 2.7 Field
- Readiness spot-checks per operator (vehicle condition, fuel/battery,
  phone, network, safety kit; optional camera photo). Operator
  self-checks arrive later and use the same records with a different
  submitter.
- Vehicle inspections on the policy interval (default 48h) with odometer,
  fuel level, condition and optional camera-only photo; needs-repair
  results flag for manager review.
- Maintenance queue: report → in repair → resolved with cost; costs feed
  the amoeba P&L and the team contribution figure.
- Incidents from operators (breakdown, accident, police, other) with
  severity, photos, acknowledge → resolve workflow, age and owner.

### 2.8 Close
- One card per operating unit with an auto-filled checklist: unresolved
  alerts, open incidents, overdue inspections, fuel not confirmed,
  mileage exceptions, delivery exceptions and unconfirmed rider figures,
  maintenance blockers — each Clear (✓) or flagged (!) with a Review link.
  Optional note; "Submit with exceptions" when blockers remain. Submitting
  timestamps the closeout and clears it from the manager's missing list.
- **Weekly team summary**: the week's Net Earnings vs target, trips, KM,
  fuel litres and ₦, maintenance ₦, team contribution, attendance
  signals, incidents and exceptions — with CSV export. Monthly and
  management reporting live in the Manager console, not here.

## 3. Assignment controls and operator acknowledgement

- Supervisors change their own team's working assignments **at any time**
  — assign or return a vehicle, activate or deactivate a platform
  registration, set delivery targets, mark unavailable. Every change is
  audited (actor, reason, timestamp) and scoped to the supervisor's team;
  the admin roster keeps full powers.
- Every assignment or de-assignment creates a **blocking acknowledgement**
  in the operator app: a full-screen notice the operator must confirm
  before the app is usable again. The confirmation is recorded (timestamp,
  GPS where granted); unacknowledged changes stay visible to the
  supervisor with elapsed time.
- **Ghost activity:** if platform records keep arriving for a deactivated
  registration or de-assigned operator, a high-tier alert goes to the
  supervisor, manager and finance simultaneously, and stays open until
  resolved — someone is earning on an account we believe is closed.

## 4. Operator inputs the app depends on

- **Odometer self-report:** operators submit opening and closing odometer
  readings in the operator app (a readiness item in the morning, a
  closeout item at night). Daily KM is derived from the pair; missing
  readings raise a supervisor exception. This is the primary mileage
  source for bikes without trackers.
- Stop-level delivery recording with POD (see 2.5).
- Deviation reasons on pace alerts; incident reports with photos.

## 5. Restricted field actions

Mark-unavailable, Fleximos suspension, platform-suspension request and
immobilisation request are field-action requests with true states:
requested → pending → succeeded / failed / unavailable. Each is a
manager-visible event with full audit (actor, reason, GPS, timestamps).
The UI always states the true third-party state — it never implies a
platform suspension succeeded unless it did.

## 6. Boundaries

- Deliveries, alerts, incidents, inspections, maintenance and closeouts
  are Ops API domains; suite rules apply everywhere (idempotency keys on
  mutations, audit entries, scoped access, OpenAPI contracts).
- The manager, finance, analytics and administrator consoles are separate
  surfaces. User management, permissions, policies and system
  configuration live in the Administrator Console only.
- Minute-level platform telemetry does not exist in the daily-aggregate
  connectors; nothing in this app pretends otherwise.

## 7. Build plan

**Live today:** cockpit with gauges and Do-these-first; grouped board;
operator detail with timeline; grouped alert queue with ack / resolve /
escalate; deliveries incl. stops, manifests, POD and confirmations; fuel
reconciliation; inspections and maintenance with photo evidence;
incidents; closeout checklist; date ranges.

**Building now (this slice):** driver and vehicle comparison tables with
CSV export; weekly team summary with contribution; incident ageing and
ownership; day-level idle tracking; price-per-litre on the efficiency
policy feeding fuel ₦, cost/KM and the money ratios.

**Next (S2):** readiness checks with odometer self-report; attendance
grouping (late-resumption config, mark-unavailable); snooze with
guardrails; nudges; any-time assignment controls with blocking operator
acknowledgement; ghost-activity alerts; field-action requests.

**Later (S3):** operator self-checks, package-level scanning and
reconciliation, offline write queue, immobiliser/platform integrations
when third-party access exists.

## 8. Acceptance standard

Every slice ships with OpenAPI + docs + API tests + Playwright
mobile/desktop coverage and an updated
`docs/acceptance-tests/supervisor.md`. Checks that must always hold:

- Closeout completes end-to-end on a phone in under 2 minutes on a clean
  day.
- Every delivery figure shows its source label; contract prices never
  render in this app.
- A snoozed alert resurfaces automatically and is visible to the manager
  while snoozed.
- Field-action requests always show true third-party state.
- Money figures shown to a supervisor cover only his own team.
