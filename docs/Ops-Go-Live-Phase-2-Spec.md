# FlexiMOS — Operations Go-Live, Phase 2 Spec (pacing engine + war-room)

**Status:** BUILT (2026-09-24). Pacing engine, `GET /ops/v1/pacing`, the
`delivery_behind_schedule` alert, the supervisor war-room "Pace" board, the
operator PWA online-target line, and the admin config forms (parcels/hour on the
pace profile; per-customer allocated rate) are all shipped and covered by API +
Playwright tests — see §6 for how to test. (Originally: DRAFT for build, owner
approved "spec then build", 2026-09-24.)
**Builds on:** Phase 1 (Speedaf import, courier→operator mapping, GPS check-in,
class-aware allocated pricing). Rides on the EXISTING target/pace/leaderboard
engines — this phase fills the resumption/online-target gap and adds a live
supervisor board; it does not rebuild what's there.

## 0. What already exists (do not rebuild)
- Per-operator `daily_revenue_target_ngn` + per-vehicle-type **revenue pace
  profiles** (car ₦60k, bike ₦27k), CRUD, override-then-profile fallback.
- **Intraday pace engine** (`teamBoard()` / `expectedPct` / `paceStatus`):
  Lagos wall-clock interpolation of expected revenue by checkpoints
  (12:00→40 %, 16:00→65 %, 19:00→90 %, 21:00→100 %) → ahead/on_track/behind/at_risk.
- **Leaderboard** (weighted acceptance/online/cash/revenue) with delivery
  earnings folded in; editable weights.
- `alert-watchdog` raises `revenue_pace_at_risk` every 15 min.
- Operator GPS **check-in** with supervisor approval; approved time is
  `ops_operator_checkins.decided_at` (currently written but unused downstream).

## 1. The gaps this phase closes
1. Resumption-aware **online target** (the check-in time is never consumed).
2. **Delivery pacing** — a per-hour parcel rate + "behind schedule" flag.
3. Intraday pace **ignores scheduled-delivery earnings** — a rider doing
   Speedaf all morning looks "behind" on ride revenue alone.
4. No live per-rider **war-room board** in the supervisor app (`ops-console`).

## 2. Config additions (owner decisions, 2026-09-24)

### 2.1 Delivery rate per vehicle type
- `ALTER ops_revenue_pace_profiles ADD COLUMN delivery_parcels_per_hour NUMERIC DEFAULT 5`
  and `ADD COLUMN delivery_journey_buffer_hours NUMERIC DEFAULT 1`.
- Resolved per vehicle_type (bikes vs Qute cars can differ), effective-dated
  like the rest of the profile. Admin console form gains the two fields.

### 2.2 Attributed (allocated) rate configurable per vehicle AND per client
- Today `ops_delivery_allocated_prices` keys on `operator_class` only. Add
  `ALTER … ADD COLUMN delivery_customer_id TEXT NULL` so a rate can be set for a
  specific customer as well as class.
- **Resolution order** (most specific wins): (customer, class) → (customer, all)
  → (null, class) → (null, all). So ₦700 is never hard-coded — it is whatever
  the effective rate resolves to for that rider's class and that delivery's
  customer. `allocatedRateFor(date, operatorClass, customerId?)`.
- Admin "Set an allocated price" form gains an optional customer selector.

## 3. Pacing engine (ops-api) — new `PacingService`

For an operator on a date, compute a **pacing snapshot** (read-time, cached):

- **daily_target** — operator override → vehicle-type pace profile (later, the
  Phase-3 onboarding ramp overrides this for new riders).
- **scheduled_attributed_earned** — Σ over today's delivery assignments of
  `delivered × allocatedRate(date, class, customer)` (+ driver daily basic once).
  Reuses the delivery module's allocated-value logic (now customer-aware).
- **online_earned** — ride revenue so far (`ride_revenue_ngn`, already in the
  board's daily performance).
- **online_target** = `max(0, daily_target − scheduled_attributed_earned)` — what
  the rider must still make online for the day (owner's worked example: 20
  parcels ≈ ₦14k earned → ₦16k online target against a ₦30k day).
- **online_pace** — from the **resumption time** (`decided_at` of today's
  approved check-in; fallback = a configured default resume hour) to close
  (20:00), interpolate the expected online earnings by now → ahead/on_track/
  behind/at_risk against `online_target`.
- **resumption_deadline** ("online by") = day_start + journey_buffer +
  `ceil(assigned_parcels / delivery_parcels_per_hour)` — when scheduled should
  be done and the rider should be online.
- **delivery pacing** — expected_delivered_by_now =
  `clamp((now − day_start − journey_buffer) × parcels_per_hour, 0, assigned)`;
  `behind_schedule = delivered < expected_delivered_by_now − tolerance`.
  day_start = approved check-in time, else a configured dispatch default.
- **combined pace** — the intraday pace judged on
  `online_earned + scheduled_attributed_earned` vs the day's expected-by-now, so
  scheduled work counts (fixes gap #3). This becomes the operator's headline
  pace; the ride-only pace stays available.

Endpoint: `GET /ops/v1/pacing?date=&amoeba_id=` (scoped, supervisor+), returning
one row per in-scope operator with the fields above. `alert-watchdog` gains a
`delivery_behind_schedule` alert when `behind_schedule` and past a threshold hour.

## 4. Surfaces
- **Supervisor app (`ops-console`) — new "Pace" / war-room board.** Per rider,
  live and sortable: resumption (✓ time / not in), scheduled `X/Y ·%` + behind
  flag, online ₦ vs online_target ·%, **combined vs ₦30k** with the pace pill.
  This is the call-time briefing made live + ranked. Lives on the Board tab
  (List | Map | **Pace** toggle) or the Cockpit.
- **Operator PWA** — the operator's own card gains "online target ₦X · earned ₦Y"
  and the resumption deadline, so the rider sees the same number.
- **Manager console** — the combined pace rolls into the existing at-risk view.
- **Admin (`ops-admin-console`)** — the two config additions (parcels/hour on the
  pace profile; per-customer allocated rate).

## 5. Acceptance criteria
1. Setting `delivery_parcels_per_hour = 5` and journey buffer 1h: a rider
   assigned 20 parcels who checked in at 08:00 has a resumption deadline of
   ~13:00.
2. A rider who has delivered 20 Speedaf parcels (customer Speedaf, rider rate
   ₦700) shows `scheduled_attributed_earned = ₦14,000` and `online_target =
   ₦16,000` against a ₦30k day.
3. A per-customer allocated rate overrides the class rate for that customer only;
   other customers keep the class rate.
4. At 12:00 a rider assigned 20 who has delivered 4 (expected ~10) shows
   `behind_schedule = true`; one who delivered 12 does not.
5. The combined pace treats a rider doing only scheduled deliveries as on_track,
   not "behind" (which the ride-only pace would show).
6. The supervisor war-room board lists in-scope riders with the live fields and
   sorts by combined-vs-target.
7. Suite standards: OpenAPI, API tests, Playwright both viewports.

## 6. How to test these changes

### Automated gates (run before every deploy)
```
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run validate:openapi     # /pacing path documented, 6 contracts valid
npm run test:api             # 59 tests — incl. "pacing snapshot: …" (§5 #1,#2,#3,#5)
npm run test:e2e             # 99 pass / 2 skip — incl. "resumption-aware pace war-room board"
```
The pacing API test seeds a ₦30k rider, imports 20 Speedaf parcels at ₦700, and
asserts `scheduled_attributed_earned = ₦14,000`, `online_target = ₦16,000`, a
`13:00` resumption deadline, the combined pace folding in scheduled earnings, and
a ₦900 per-customer rate overriding the ₦700 class rate for that customer only.

### Manual walkthrough (server or local)
1. **Admin (ops-admin-console → Deliveries & pricing):** set an allocated price —
   pick a class, optionally a **Customer**, e.g. rider ₦700 for "Any customer" and
   rider ₦900 pinned to Konga. On a **pace profile**, set *Delivery parcels/hour*
   (5) and *Delivery journey buffer* (1h). Both version by effective date.
2. **Supervisor (ops-console → Deliver):** run the Speedaf import (or the headless
   pull) for today so riders have assigned/delivered parcels.
3. **Supervisor (ops-console → Board → Pace):** the war-room lists each rider,
   sorted worst-first by combined pace — resumption ✓/not in, scheduled `X/Y ·%`
   with a *behind* flag, online ₦ vs online-target ·%, and combined vs the day's
   target with a pace pill.
4. **Operator PWA:** for a rider with scheduled work, the earnings card reads
   "Online target ₦X · earned ₦Y · online by HH:MM".
5. **Alert (ops-console → Alerts):** once a rider trails the parcel pace past the
   grace, `delivery_behind_schedule` appears after the 15-min `alert-watchdog` run.

Note: the two new columns (`delivery_customer_id` on allocated prices;
`delivery_parcels_per_hour` + `delivery_journey_buffer_hours` on pace profiles)
auto-migrate via `ADD COLUMN IF NOT EXISTS` on API boot — no manual SQL.

## 7. Out of scope (later phases)
- The **onboarding ramp** target curve (Phase 3) — Phase 2 uses the flat profile
  target; the ramp will override `daily_target` without changing this engine.
- Penalty/incentive scoring (waits on the Tunji policy).
