# FlexiMOS — Operations Go-Live, Phase 1 Spec (v2, no open questions)

**Status:** BUILT (Sept 2026). Delivered onto the existing deliveries module rather
than a new one — the batch/assignment/two-price model already existed, so Phase 1
added only the four gaps: Speedaf import, courier→operator mapping, class-aware
allocated price (rider/driver + daily basic), and the operator GPS check-in +
supervisor approval; plus the scheduled headless pull (in-process, env-gated).
API tests + e2e cover them; the headless pull's portal click-path needs one
live-credentials confirmation run (sign-in is done by a person, not automated blind).
**Date:** 2026-09-23
**Author:** Wole + Claude
**Rule:** Per project convention, this spec is reviewed and approved before implementation.
**v2 change:** all open questions resolved (see §9 Decisions); adds dual revenue model,
rider-vs-driver classes, and automated headless Speedaf pull.

---

## 1. Why this phase exists

We are moving FlexiMOS to live. On-demand cash reconciliation waits on Monnify, but
**scheduled delivery (Speedaf) and rider/supervisor monitoring do not depend on Monnify**
and are suffering for lack of a live ops system. Phase 1 ships the **go-live core** that:

- turns the Speedaf delivery export into per-rider scheduled progress **without manual typing**,
- gives the afternoon call a screen that assembles itself,
- makes the daily report **generate from the system** rather than be hand-written,
- enforces resumption discipline via a **GPS + supervisor-confirmed operator check-in**.

Design test for every screen: **it must reduce work, not add a data-entry chore.**
The lazy path must still produce the data (e.g. the daily report is empty unless the
capture/check-ins exist — so keeping them current is the path of least resistance).

Governance note: the owner rejected adding an on-ground ops-manager layer. Therefore the
**system** plays that role — it holds the time-boxed checklist and quietly flags non-adherence.

## 2. Scope

**In scope (Phase 1):**
1. Speedaf data capture — automated headless pull (primary) + manual import (fallback)
2. Courier-name → rider mapping (amoeba resolved via the identity system)
3. Operator daily check-in (GPS + supervisor approval)
4. Dual revenue model (earned vs operator-attributed) with rider/driver classes
5. Call-time briefing
6. Auto daily report

**Deferred (later phases, noted so we don't build them now):**
- Phase 2 — daily-target **pacing engine** (resumption deadline, online target, 5-deliveries/hr line), live leaderboard.
- Phase 3 — **onboarding ramps** (rider 12-day curve, supervisor 4-week rotation) + HR cohort surface.
- **Penalty/incentive scoring** — waits on Tunji's fault→owner→penalty scheme. We capture raw fields now, score later.
- **RED/AMBER/GREEN issue-scan reasons** — capture the field in Phase 1, no scoring yet.
- **Full driver remuneration policy** — the *mechanism* is built in Phase 1 (see §5, §9-D); the driver-specific
  rate values are a config entry finance sets once the driver policy is agreed. Not a blocker.

## 3. Architecture placement

| Concern | App | API |
|---|---|---|
| Operator check-in button, "today" glance | `operator-pwa` | ops-api :4030 |
| Manual import, courier mapping, check-in approvals, briefing, report | `ops-console` (supervisor) | ops-api :4030 |
| Cross-amoeba briefing roll-up, daily reports, earned-revenue view | `manager-console` | ops-api :4030 |
| Approved locations (Sites w/ GPS + radius) | `admin-console` (identity) | api-foundation :4510 |
| Attribution-rate config (₦/parcel per customer × class) | `manager-console` / finance | ops-api :4030 |

New tables live in **ops-api**. Approved check-in locations reuse **Sites** (which already carry
`gps_lat`, `gps_lng`, `alert_radius_m`) from the identity/foundation service; ops-api reads them to
geofence check-ins. The **Speedaf connector** is a self-contained module under
`apps/ops-api/src/connectors/` — same modular pattern as the tracker connectors (isolated,
health-checked, swappable if Speedaf changes their portal), never folded into a monolith.

## 4. Data model (ops-api, CREATE/ALTER IF NOT EXISTS on boot)

### 4.1 `ops_scheduled_imports` — one row per capture (auto or manual)
- `import_id` PK, `amoeba_id` (nullable for a whole-branch capture), `file_name`, `date_from`, `date_to`,
  `row_count`, `unmapped_count`, `capture_source` ∈ {auto_pull, manual_upload},
  `imported_by_person_id` (or 'system' for auto), `imported_at`, `source` = 'speedaf'.

### 4.2 `ops_scheduled_waybills` — per-waybill snapshot
- `waybill_no`, `import_id` FK, `amoeba_id` (resolved via courier→rider→identity), `capture_at`,
- `waybill_status_raw`, `status_class` ∈ {delivered, out, returned, exception, unknown},
- `last_scan`, `last_scan_at` (Excel serial → datetime, GMT+1), `site_of_last_scan`,
- `delivery_type`, `courier_name_raw`, `courier_norm`, `person_id` (nullable), `attempts`.
- Latest snapshot per `(waybill_no, capture day)` wins; re-capture is idempotent.
- Status map: Signed→delivered(+POD); Delivering/To Deliver/In Transit→out; Return Collection→returned;
  Abnormal signed/Duplicate Waybill/Self-pickup Putaway→exception.
- POD gap = delivered-but-not-signed (the portal's "Delivery But Not signed").

### 4.3 `ops_courier_aliases` — free-text Speedaf name → rider/driver
- `alias_id` PK, `courier_norm` (unique), `display_seen`, `person_id`,
  `created_by_person_id`, `created_at`.
- **Amoeba is NOT stored here** — it is derived at read time from the mapped person via the identity
  system (person → active roster/role assignment → amoeba). One source of truth for org placement.
- Unmapped = distinct `courier_norm` with no alias → "assign" queue.

### 4.4 `ops_operator_checkins` — daily attendance/resumption
- `checkin_id` PK, `person_id`, `amoeba_id`, `check_in_date`,
- `requested_at`, `gps_lat`, `gps_lng`, `matched_site_id`, `distance_m`, `geofence_ok`,
- `status` ∈ {pending, approved, rejected}, `decided_by_person_id`, `decided_at`, `decision_note`,
- `source` ∈ {operator_self, supervisor_manual}.
- **Resumption time** for reporting = `decided_at` when approved (fallback `requested_at`).
- One active check-in per (person, date); re-request replaces the pending one (idempotent).

### 4.5 `ops_attribution_rates` — operator-attributed revenue config  *(NEW)*
Standardised revenue we credit the operator toward their daily target — deliberately **not** the
customer/earned revenue, so incentives stay balanced across scheduled customers and on-demand.
- `rate_id` PK, `customer` (e.g. 'speedaf', 'bolt', future customers), `operator_class` ∈ {rider, driver},
  `per_parcel_ngn` (e.g. speedaf×rider = 700), `daily_basic_ngn` (default 0; used for drivers),
  `effective_from`, `active`, `created_by_person_id`, `created_at`.
- On-demand (bolt) attributed revenue = **actual platform earnings** from the existing performance
  import, not a per-parcel rate (so `per_parcel_ngn` may be null for bolt; it's the "everyone is
  measured against real fares" baseline that scheduled is standardised down to).
- Seed values: `speedaf × rider = ₦700/parcel`. `speedaf × driver = daily_basic + per_parcel`
  (values finance sets when the driver policy lands — the row exists, the numbers are editable).

### 4.6 `ops_operators` — add operator class
- `ALTER … ADD COLUMN operator_class TEXT` ∈ {rider, driver}. Defaulted from the assigned vehicle
  type (motorbike → rider; car/Qute → driver) but explicitly settable. Qute cars now join the
  delivery fleet as **driver**-crewed vehicles carrying bigger parcels.

All mutations: Idempotency-Key + `ops.audit()` per suite convention.

## 5. Revenue model (earned vs attributed) — the core rule

Two numbers, never conflated:

| | **Earned / customer revenue** | **Operator-attributed revenue** |
|---|---|---|
| Meaning | what the customer pays us | what we credit the operator toward the ₦30k target |
| Speedaf, per parcel | ≈ **₦1,300** (varies by customer/contract) | **₦700** (rider) · driver = basic + per-parcel fee |
| On-demand (Bolt) | actual fare | actual fare (same figure) |
| Source | finance contract price | `ops_attribution_rates` (+ actual on-demand earnings) |
| **Who sees it** | **finance / manager only** (it's a contract price) | **supervisor + operator** (their incentive figure) |

- The **operator's daily target and all ops-facing screens use attributed revenue.** A rider who
  Signs 20 Speedaf parcels has generated **₦14,000** (20 × ₦700) toward ₦30k — matching the owner's
  own worked examples.
- **Earned revenue (₦1,300) is finance/manager-only** and appears only in the manager/finance views,
  consistent with the standing rule that contract prices are not shown to supervisors.
- **Drivers** (Qute cars): attributed = `daily_basic_ngn` + (parcels × driver `per_parcel_ngn`),
  the per-parcel fee higher than the bike ₦700 (bigger parcels). Rider vs driver is `operator_class`.

## 6. Feature specs

### 6.1 Speedaf data capture  *(primary: automated; fallback: manual)*
**(A) Automated headless pull — the target design.** A modular **Speedaf connector** (headless
Chromium via Playwright — already our stack; "puppeteer or whatever" → we use Playwright for
consistency) that, on a schedule:
  1. logs in with stored credentials (env: `SPEEDAF_ACCOUNT`, `SPEEDAF_PASSWORD`; no OTP/captcha on
     this portal, so automation is viable),
  2. opens Delivery Waybill Inquiry, sets the date range (today), runs **Export** with our fixed
     8-column set, polls the Download Center, downloads the `.xlsx`,
  3. feeds it through the **same ingest pipeline** as the manual path (§6.1-C).
- **Cadence:** frequent during ops hours (hourly, mirroring the tracker daily-capture pattern) so we
  **own the history** as system-of-record — the portal is not guaranteed to retain past days, and we
  need the per-rider time-series regardless. `healthCheck()` feeds the integration status monitor.
- **Resilience:** if the portal UI shifts and the pull fails, it degrades to "down" in the status
  monitor and the manual path (B) is always available as backstop. Credentials in env only, never
  committed; the shared portal password is rotated once automation is confirmed.

**(B) Manual import — always available.** In `ops-console`, an "Import Speedaf export" panel: drag the
`.xlsx`, see a parse preview (rows, date range, #mapped/#unmapped couriers), Confirm. Supervisors may
import **as often as is realistically possible**; each import is a snapshot. This is the day-one path
(ships first) and the permanent fallback when the auto-pull can't run.

**(C) Shared ingest.** Parse the 8 validated columns (Excel-serial dates, status map, tolerant to
column order/extras) → `ops_scheduled_waybills`; attribute couriers via the alias table; unmapped
names go to the queue (they never block ingest). `POST /ops/v1/scheduled/imports`, audited, idempotent.

### 6.2 Courier-name → rider mapping  *(Supervisor; Admin/HR too)*
- **UI:** "Unknown couriers" list — raw name (e.g. `ODEH`) + a person picker with a first-name
  suggestion. Assigning creates an alias; future captures auto-resolve; the person's **amoeba is read
  from identity**, not typed here.
- **Endpoints:** `GET /ops/v1/scheduled/couriers?status=unmapped`, `POST /ops/v1/scheduled/courier-aliases`.

### 6.3 Operator daily check-in  *(Operator PWA + Supervisor approval)*
Purpose: enforce resumption and produce the resumption time the report/pacing need — while stopping
office-resident operators checking in from bed.
- **Operator (operator-pwa):** a **Check in** button captures device GPS; server finds the nearest
  approved **Site** in the operator's amoeba, computes `distance_m` and
  `geofence_ok = distance_m ≤ site.alert_radius_m`, files a **pending** check-in. Operator sees:
  *Pending confirmation → Checked in ✓ / Rejected*. `POST /ops/v1/checkins`.
- **Supervisor (ops-console):** an approvals **popup/queue**; each request shows name, time, and a GPS
  badge (*Inside <site> · 40 m* green / *Outside · 1.2 km* red / *No GPS* amber). Supervisor
  **Approves/Rejects** — the digital "attendance register with supervisor signature".
  `POST /ops/v1/checkins/:id/decision`.
- **Approval is mandatory even when GPS is green:** a resident operator passes GPS from their bed, so
  GPS is necessary-but-not-sufficient; the supervisor confirms actual presence/readiness. Supervisor
  can also raise a manual check-in (source = supervisor_manual).
- **Approved locations:** reuse amoeba **Sites** (already have GPS + `alert_radius_m`); no new admin
  data model in Phase 1.

### 6.4 Call-time briefing  *(Manager/owner + Supervisor)*
- One screen, generated from the latest capture + check-ins + trackers. Per operator: assigned,
  delivered (Signed), still-out, returned/exception, attempts, **delivery rate %**, **POD gap**,
  **attributed revenue so far** (₦700×signed for Speedaf riders; class-aware for drivers), resumption
  status, and — where GPS-tracked — moving/idle.
- **Amoeba roll-up:** received vs delivered, overall %, behind-schedule flag list.
- `GET /ops/v1/scheduled/briefing?amoeba_id=&date=` (scoped). Supervisor/operator see **attributed**
  revenue; manager view additionally shows **earned** revenue.

### 6.5 Auto daily report  *(Supervisor → Manager)*
- The 8pm report **is** the briefing + on-demand revenue (existing performance import) + closeout/POD
  gaps + open incidents, rendered. Supervisor reviews and **submits with one click**; no typed numbers.
- `GET /ops/v1/scheduled/daily-report?amoeba_id=&date=`, plus a submit/acknowledge action.
- Manager/owner see submitted reports across amoebas, with earned-revenue columns where authorised.

## 7. Role summary

| Role | Phase 1 gets |
|---|---|
| **Operator** | Check-in button (GPS); "today: assigned / delivered / attributed ₦ / target" |
| **Supervisor** | Manual import, courier mapping, check-in approvals popup, call-time briefing (attributed ₦), one-click daily report |
| **Manager / owner** | Cross-amoeba briefing + submitted reports, **earned (₦1,300) revenue view**, attribution-rate config |
| **Admin / HR** | Approved locations (Sites); courier aliases; operator_class |
| **System** | Automated hourly Speedaf pull; status-monitor health |

## 8. Acceptance criteria
1. The automated pull logs in, exports, downloads and ingests today's data unattended; a UI-shift failure shows "down" in the status monitor and does not corrupt existing data.
2. Manual import of the real export attributes mapped couriers to riders; unmapped names appear in the queue and don't block import.
3. Re-capturing the same data changes nothing (idempotent); a later same-day capture updates each waybill to its newest status.
4. Excel-serial scan times render as correct GMT+1 datetimes.
5. A rider who Signs 20 Speedaf parcels shows **₦14,000 attributed** revenue; the same parcels show **₦26,000 earned** (20 × ₦1,300) in the manager view only.
6. A driver on a Qute shows attributed = daily basic + (parcels × driver per-parcel fee) using `ops_attribution_rates`.
7. An operator check-in outside all amoeba sites is flagged red, inside a site's radius green; both still require supervisor approval before counting as "checked in".
8. The call-time briefing matches hand-computed assigned/delivered/rate for a spot-checked rider.
9. The daily report renders with zero free-typed numbers and reflects the day's capture + check-ins + on-demand revenue.

## 9. Decisions (resolved — no open questions)
- **A. Two revenue figures.** Earned/customer (Speedaf ≈ ₦1,300/parcel, varies by contract) is
  finance/manager-only. Operator-attributed (rider = ₦700/parcel, standardised across platforms to
  keep incentives balanced) is what supervisors/operators see and what drives the ₦30k target.
- **B. Rider vs driver.** `operator_class` splits them. Riders (bikes) = ₦700/parcel. Drivers (Qute
  cars, now moved from passenger ride-hailing into delivery for bigger parcels) = fixed daily basic +
  a higher per-parcel fee. The mechanism (`ops_attribution_rates` with `daily_basic_ngn`) is built now;
  the exact driver numbers are a config row finance sets when the driver policy is finalised.
- **C. Import cadence & method.** Supervisors can import manually as often as realistically possible,
  AND FlexiMOS runs an **automated headless login + export pull** (Playwright) on a schedule as the
  primary path — no Speedaf API required. Manual stays as day-one path and permanent fallback.
- **D. One Speedaf login → many amoebas.** The single branch account's waybills are split to amoebas
  via **courier → mapped person → identity system → amoeba**. Amoeba placement is owned by identity,
  never stored on the alias.
