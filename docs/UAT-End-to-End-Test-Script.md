# FlexiMOS — End-to-End UAT Test Script

**Purpose:** a single, sequenced walk-through to verify the whole system before
personnel testing. Ordered so each stage builds on the last (you define a thing
before you use it). Tick each `[ ]` as you go; note anything that fails.

**Time:** ~60–90 min for a full pass.

---

## How to access

Each console is a web app at `https://fleximos.hyve.com.ng/apps/<name>/`. On first
open, append `?token=<SERVICE_TOKEN>` once — it is remembered in the browser.

| Console | Path | What it's for |
|---|---|---|
| Identity & Org (HR) | `/apps/hr-admin-console/` | people, users, roles, amoebas, sites, service accounts |
| Administrator (Ops) | `/apps/ops-admin-console/` | roster, vehicles, policies, delivery pricing, onboarding, accommodation, reports, data health, manual entry |
| Supervisor | `/apps/ops-console/` | cockpit, board, alerts, deliver, fuel, field, close, check-in approvals |
| Operator (PWA) | `/apps/operator-pwa/` | rider's own earnings, dispatch, check-in, alerts, rank, report |
| Manager | `/apps/manager-console/` | roll-ups + integration status |
| Analytics | `/apps/analytics-console/` | net-earnings signals, review periods |
| Finance | `/apps/finance-console/` | cash, Monnify, reconciliation, period close |

**Navigation note (admin consoles):** hr-admin and ops-admin now use a **left
sidebar** and show **one section at a time** — click a sidebar item to switch, or
use the search box at the top of the sidebar. There is a cross-link at the bottom
of the sidebar to jump between the two.

**Viewing as a specific person:** append `&actorPersonId=<person_id>` to a console
URL to see it as that supervisor/manager (data scoping). Otherwise the shared token
acts as a system administrator.

**Starting state (after a clean reset):** the database starts **empty of
operational data** — no amoebas, sites, operators, vehicles or performance. What
*is* pre-seeded is the founder login (**Wole**, system admin) and **config
defaults** (pace profiles, platform accounts for Bolt/Uber, efficiency/fleet
policy, leaderboard weights, the onboarding ramp, scheduled jobs). So Stage 1
genuinely starts from scratch; in Stage 3 you *confirm/adjust* the defaults rather
than create them. *(If you see demo amoebas or a demo operator on first login, the
box was reset with `FLEXI_SEED_DEMO=true` — that's the training baseline, not the
clean one.)* Note: the **Targets & policy → Vehicle trackers** panel will still
list GPS devices (e.g. "15 devices at cartracker · 0 mapped to vehicles") even on
a clean database — those come live from the tracker vendor, not our DB. They map
to vehicles as you create them in Stage 2.

**Smoke check first:** open each of the seven consoles and confirm the footer/
header shows **Connected** (not a connection error). `[ ]`

---

## Stage 1 — Identity & Organisation (HR console)
*Everything else references these records, so do this first.*

1. `[ ]` **Amoebas** → create at least two amoebas (e.g. *Mainland*, *Island*).
2. `[ ]` **Sites** → add a site to each amoeba with GPS + radius; mark one primary.
3. `[ ]` **People** → create 3–4 people (a supervisor, 2 riders, 1 driver). Give
   real names/phones. Confirm each shows **active**.
4. `[ ]` **Users & roles** → create a login for the supervisor person and tick the
   **Supervisor** role; create one **Manager** and one **Finance** user.
5. `[ ]` **Access** → grant the Manager an amoeba-scoped access grant; confirm it
   lists with the scope and can be **deactivated**.
6. `[ ]` **Service accounts** → confirm one exists and a token can be **issued**.
7. `[ ]` Edit a person (change phone/email) and **deactivate then reactivate** one —
   confirm status updates in the table.

---

## Stage 2 — Fleet & roster (Administrator console)
*Needs the people, amoebas and sites from Stage 1.*

1. `[ ]` **Vehicles** → *Manage fleet assets* → add 2–3 vehicles (a car and bikes)
   to your amoebas, with plates and (optionally) a tracker device ID.
2. `[ ]` **Roster** → *Manage operator roster* → add each rider/driver person as an
   operator: set type, amoeba, site, **supervisor**, daily target, vehicle.
3. `[ ]` Register a platform account for an operator (**Add platform**) so it can
   receive performance data.
4. `[ ]` Set each operator's status to **active** (Roster row → status → Save).
   *(Activation is what starts onboarding/pace clocks.)*
5. `[ ]` Confirm the roster **scope filters** (team/amoeba/search) narrow the list,
   and the **Overview** KPI "Active operators" count matches.

---

## Stage 3 — Operating policy & config (Administrator console → Configure)
*Defines targets, pricing and rules the later stages are judged against.*

1. `[ ]` **Targets & policy** → confirm/adjust a **revenue pace profile** per
   vehicle type (e.g. bike ₦30k, car ₦60k) and the checkpoint %s. Save a new
   version and confirm older versions fold into **"N earlier versions"**.
2. `[ ]` Same view → **efficiency policy** (fuel→distance) and **fleet policy**
   (inspection cadence) — edit and confirm the active value updates.
3. `[ ]` **Delivery customers & pricing** → create a customer (e.g. *Speedaf*,
   contract ₦1,300). Edit it to confirm edit works.
4. `[ ]` **Allocated price** → set a **rider** rate (e.g. ₦700) and, optionally, a
   **per-customer** override; confirm class + customer chips show and the resolver
   note reads sensibly.
5. `[ ]` **Onboarding** → confirm the **rider 12-day ramp** curve; set a
   **completion bonus** and per-missed-day reduction %. Save and confirm it lists.
6. `[ ]` **Leaderboard** weights → adjust and save.

---

## Stage 4 — Accommodation (Administrator console → Manage → Accommodation)
*Finite housing; assignment happens from the Roster.*

1. `[ ]` **Accommodation** → add a unit with a small **capacity** (e.g. 1–2 beds);
   confirm the "beds" summary and the unit shows **0/N**.
2. `[ ]` **Roster** → on an **active** rider's row, pick the unit in the
   **Accommodation** select → Save. Confirm a 🏠 chip appears on the row and the
   unit now reads **1/N**.
3. `[ ]` Fill the unit to capacity, then try to assign one more → **refused** (unit
   shown full / error). *(Hard capacity block.)*
4. `[ ]` **Deactivate** a housed rider (Roster → status inactive → Save) → confirm
   the unit's occupancy **drops** and a bed frees.
5. `[ ]` Try to **delete** an occupied unit → refused; delete an empty one → works.

---

## Stage 5 — Onboarding cohorts & supervisor onboarding (Administrator console)

1. `[ ]` **Onboarding** → *Start a cohort* (name + Day-1 start date), then add a
   rider to it. Confirm the member count.
2. `[ ]` **Onboarding** → start a **supervisor onboarding** (new supervisor + host
   amoeba + mentor); advance the phase (scheduled → on-demand); **graduate** them
   with a target amoeba. Confirm the status/phase updates.
3. `[ ]` **Cohorts** view → confirm each cohort rider shows **Day N of the curve**,
   today's **ramped target**, targets hit, and projected **bonus** (empty message
   if no ramp-active riders today — that's fine).

---

## Stage 6 — Daily performance data (Administrator console → Manual entry)
*Feeds the board, pace and reports. Needs operators + platform registrations.*

1. `[ ]` **Manual entry** → *Enter a performance record* → pick an operator +
   platform, set trips/revenue/hours/status → Save → "1 record accepted".
2. `[ ]` Add a few records across operators (mix online/offline, high/low revenue)
   so the board and reports have something to show.
3. `[ ]` *View performance records* → filter by team/operator and confirm rows.

---

## Stage 7 — Supervisor daily flow (Supervisor console)
*Needs active operators + some performance data + (for check-in) an operator app.*

1. `[ ]` **Cockpit** → confirm the gauges (pace, utilisation, closeout) render and
   "Do these first" lists conditions.
2. `[ ]` **Check-in approvals** (cockpit) → when an operator requests a check-in
   (Stage 9), it appears here → **approve** it; confirm approval sticks. Try a
   far-GPS one and confirm it's flagged outside the fence.
3. `[ ]` **Board → List** → operators grouped by state; open a tile → operator
   detail with today's timeline/progress.
4. `[ ]` **Board → Map** → vehicle positions render; test **remote power off/on**
   on a moving bike (with the stolen-vehicle override) and confirm the notice.
5. `[ ]` **Board → Pace** (war-room) → each rider shows resumption (✓ time / not in),
   scheduled X/Y, online target, and the **combined pace pill**; a rider in their
   ramp window shows a **"ramping · Day N"** chip.
6. `[ ]` **Alerts** → acknowledge and resolve an alert; confirm it moves state.
7. `[ ]` **Fuel** → log a fuel/charge issue with a unit.
8. `[ ]` **Field** → log an incident (with category/action/cost), an inspection,
   and a maintenance report.
9. `[ ]` **Close** → submit a structured daily closeout.

---

## Stage 8 — Deliveries & Speedaf (Supervisor **Deliver** + Admin pricing)
*Needs a delivery customer + allocated price (Stage 3) and operators.*

1. `[ ]` **Deliver** tab → confirm the delivery customer(s) list.
2. `[ ]` **Speedaf import** → either upload a real waybill **xlsx** export, or run
   the **headless pull**. Confirm raw waybills import even before mapping.
3. `[ ]` **Courier mapping** → map a Speedaf courier name to one of your operators;
   re-check the import so their parcels attribute to that rider.
4. `[ ]` Confirm a **batch** appears with counts, an **assignment** per rider with
   delivered/target, and **allocated vs contract** values / margin look right.
5. `[ ]` Raise and resolve a delivery **exception**; close a batch and confirm its
   counts lock.

---

## Stage 9 — Operator app (Operator PWA)
*Open as one of your riders: `/apps/operator-pwa/?token=…&actorPersonId=<rider>`.*

1. `[ ]` **Today** → check-in card → **Check in** (allow location). Confirm it goes
   **pending**, then flips to **checked in** once the supervisor approves (Stage 7).
2. `[ ]` **Today** → earnings gauge shows revenue vs **target**; if the rider is in
   their onboarding ramp, the label reads **"Onboarding Day N · target ₦…"**; if
   they have scheduled deliveries, an **online-target** line appears.
3. `[ ]` **Dispatch** → assigned delivery stops show with progress.
4. `[ ]` **Alerts** → an alert can be opened and **explained** (deviation reason).
5. `[ ]` **Rank** → leaderboard position renders. **Report** → daily summary renders.

---

## Stage 10 — Pacing & alert integrity (cross-console)
*Best checked after Stages 6–9 have produced data.*

1. `[ ]` A rider doing **only scheduled deliveries** (low ride revenue) is **not**
   wrongly "at risk" on the **combined** pace (Board → Pace).
2. `[ ]` A rider well behind the parcel rate raises a **delivery_behind_schedule**
   alert after the watchdog runs (Alerts).
3. `[ ]` A **new-hire** in the ramp is judged against the **ramped** (lower) target,
   not the veteran ₦30k — check the Pace board and Cohorts view agree.
4. `[ ]` **Online target** = day target − scheduled earned (rider with parcels).

---

## Stage 11 — Reporting & analytics

1. `[ ]` **Administrator → Reports** → *Generate report* for a date → open it →
   operator rows show, each with an **accommodation** indicator (🏠 / "no acc.").
   Download **CSV** and **JSON**.
2. `[ ]` Generating again creates a **new revision**; an old snapshot can be deleted
   (recorded in audit).
3. `[ ]` **Manager console** → roll-ups render and the **integration status** grid
   shows each dependency.
4. `[ ]` **Analytics console** → switch **day / week / month** review periods and
   confirm the net-earnings signals update.
5. `[ ]` **Finance console** → confirm cash status/adjustments; run the **Monnify
   sandbox** test flow; import the **Uber Payment Transactions CSV**; run a
   **reconciliation**; **finance-approve and close** an accounting period.

---

## Stage 12 — Data health & scheduled jobs (Administrator → Data health)

1. `[ ]` **Data health** → job health metrics render; the registered scheduled-job
   count looks right.
2. `[ ]` *View scheduled jobs* → **replay** a scoped job (e.g. daily-report-generate)
   → confirm it queues and appears in recent runs.
3. `[ ]` *View roster gaps* → active operators with no vehicle are listed.
4. `[ ]` *View platform import runs* → accepted/rejected counts per run.
5. `[ ]` *View inspection compliance* → overdue vehicles flagged against the cadence.

---

## Sign-off
- `[ ]` All stages passed, or issues logged below.
- Tester: ________________  Date: __________

**Issues found**

| Stage / step | What happened | Expected | Severity |
|---|---|---|---|
| | | | |
