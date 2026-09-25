# FlexiMOS — Operations Go-Live, Phase 3 Spec (onboarding ramps + cohorts)

**Status:** BUILT (2026-09-25). Ramp engine (`OnboardingService`), the
`/ops/v1/onboarding/*` and `/ops/v1/supervisor-onboardings/*` endpoints, the
teamBoard/pacing ramp override, the admin console Onboarding section, the
war-room "ramping · Day N" chip, and the operator-PWA onboarding label are all
shipped and covered by API + Playwright tests. D1–D7 closed 2026-09-25. Grounded
in `~/…/Fleximotion/HR/Training/onboarding-thoughts.pdf` (reviewed 2026-09-25).
**Builds on:** Phase 2 (pacing engine, war-room, per-vehicle/per-customer config).
The ramp overrides the *daily target* the Phase-2 engine already consumes; it does
not rebuild pacing.

## 0. Source policy (verbatim from the onboarding doc)

### Riders — 12-day (2-week) onboarding
Day 1 is induction/training. Daily revenue targets (₦):

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|-----|---|---|---|---|---|---|---|---|---|----|----|----|
| Target | 0 | 2,500 | 5,000 | 7,500 | 10,000 | 13,000 | 16,000 | 19,000 | 22,000 | 25,000 | 28,000 | 30,000 |

Doc notes:
- Riders onboarded in **weekly batches** on a fixed weekday (e.g. every Monday =
  Day 1 for that week's batch), for structured induction.
- A well-defined daily target surfaces struggling riders early and keeps
  supervisor + rider focused on a concrete daily plan.
- Phase split shown on the ramp: **On-demand only → Scheduled + On-demand**.
- **Completion incentive:** define a standard amount every newbie earns for hitting
  all 12 daily targets; reduce it by a set % for each day the target was missed.

### Supervisors — 1-month onboarding
Weeks 1–4, split **Scheduled only (wk 1–2) → On-demand only (wk 3–4)**.
- One supervisor must be able to run a whole amoeba across *both* scheduled and
  on-demand ops, so training must cover both.
- A new supervisor is assigned to an **existing amoeba to assist an active
  supervisor**: first 2 weeks as assistant on **scheduled delivery**, next 2 weeks
  assisting **on-demand**. Afterwards assigned their own team.
- Multiple amoebas can share one site (e.g. Surulere ≥ 2 amoebas).

## 1. Rider onboarding ramp

- **Ramp profile** (new, editable, effective-dated, per vehicle type / operator
  class — same pattern as pace/efficiency profiles). Stores the 12 absolute daily
  targets above plus the phase-split day. Seeded from the doc; tunable in admin.
  Drivers get their own profile later (curve TBD) — the mechanism is class-keyed
  so it drops in with no code change.
- **Day-N resolver:** Day N is counted in **working days = calendar days minus a
  fixed rest day** (configurable working week) from the rider's **cohort start
  date** (the batch's Day-1 weekday). Weekly batches are the norm, but an
  **off-cycle individual** is supported, anchored on their own `activated_at`
  (D5 ✓). Beyond Day 12 the rider uses the steady-state vehicle-type pace-profile
  target — which is being **raised to ₦30,000 for bikes** so Day 12 hands off with
  no step (D3 ✓).
- **Phase-split day = Day 7** (D1 ✓): Days 1–6 on-demand only, Days 7–12
  scheduled + on-demand — aligned with the 6-day working week.
- **Feeds Phase 2 directly:** the resolved ramp target replaces
  `daily_revenue_target_ngn` for that operator-day, so `online_target`, combined
  pace, and `revenue_pace_at_risk` all treat the newbie fairly — no pacing-engine
  change (as promised in Phase-2 spec §7).
- **On-demand vs scheduled phase:** during the on-demand-only phase (Days 1–6) the
  rider is not assigned scheduled deliveries, so the whole ramp target is an online
  target. In the scheduled+on-demand phase (Days 7–12), Phase-2 logic subtracts
  scheduled attributed earnings as usual.
- **Delivery-pace ramp — parcels/hour is NOT flat (D2 ✓).** The **working day is
  fixed length** for everyone (a newbie works a full day too); what ramps is the
  **parcel throughput**. A newbie clears fewer parcels across that same full day, so
  their expected `delivery_parcels_per_hour` is **lower and ramps up** to the
  vehicle-type profile value by graduation. Default: scale parcels/hour by the same
  fraction as the revenue target (`ramp_target(day) ÷ graduation_target`), so a
  Day-7 rider is judged at ~53% (16k/30k) of veteran throughput, reaching 100% at
  Day 12. Keeping it flat would let a newbie finish scheduled work early and idle —
  wrong; the ramp keeps the day full at a gentler pace. The parcels/hour curve is
  configurable on the ramp profile (a multiplier column or explicit per-day values).

## 2. Onboarding completion incentive

- **Configurable parameters (D4 ✓)** — never hardcoded: a **standard completion
  bonus** (₦) and a **per-missed-day reduction %**, held on the onboarding config
  (ramp profile / a settings row) and edited in the admin console. The **Phase-4
  redesign must give these an obvious home** (an "Onboarding" settings card). Seed
  with clearly-marked placeholder defaults until the owner sets real values.
- Per rider, over their 12-day window: count days where actual ≥ that day's ramp
  target; `bonus = standard × (1 − reduction% × days_missed)`, floored at 0.
- Surfaced on the cohort view and the rider's PWA (progress: N/12 targets hit,
  projected bonus). Payout/settlement integration is out of scope for now — this
  phase computes and displays the figure.

## 3. Supervisor onboarding (assignment, not a numeric ramp)

- A **supervisor onboarding record**: the onboarding supervisor (person), the
  **host amoeba**, the **mentor** (active supervisor), a start date, and a 4-week
  two-phase plan: **wk 1–2 scheduled-assist → wk 3–4 on-demand-assist → graduate**.
- The onboarding supervisor gets **read/assist scope** on the host amoeba (sees the
  board, no destructive actions / no team of their own) until graduation.
- No revenue/pace target attaches to the supervisor themselves; their team (the
  host's) keeps its own targets — consistent with "a new supervisor can run a
  veteran team." Phase/label drives what the onboarding UI emphasises (scheduled
  vs on-demand) and can gate alert escalations to the mentor during onboarding.
- **No auto-graduation (D6 ✓).** The 4-week phase plan is guidance, not a timer.
  **HR graduates the supervisor by an explicit action** when a target amoeba is
  ready, by one of two routes:
  1. **Reassign** the supervisor to a ready/new amoeba (they take over that team).
  2. **Split the host cell into two amoebas** ("cell division") — carve a subset of
     the host amoeba's operators/sites into a new amoeba and assign the graduating
     supervisor to it.
  On graduation the onboarding record closes (`graduated_at`, target amoeba) and the
  supervisor gets normal scope on their new team.
- **No bespoke split tooling (D7 ✓).** Both routes reuse what already exists: HR
  creates an amoeba in the hr-admin-console (`+ New amoeba`; foundation `amoebas`
  even carries `parent_amoeba_id` for a future hierarchy view), and operators/the
  supervisor are moved between amoebas from the Ops roster (operator update already
  accepts `amoeba_id` + `supervisor_person_id`). Phase 3 adds only the onboarding
  record and its graduation action; a dedicated one-click cell-split is a later
  org-management feature.

## 4. Cohort / ramp surfaces

- **Rider cohort view** (manager + HR console): each active onboarding cohort, its
  Day N, per-rider ramped target vs actual, targets-hit count, projected bonus,
  days to full pace.
- **War-room chip** (ops-console Pace board): a "ramping · Day N/12" chip on a
  new rider's tile so a lower bar reads as expected, not a red flag.
- **Supervisor onboarding view:** who's onboarding, host amoeba + mentor, week N/4,
  current phase, graduation date.

## 5. Data model (indicative)
- `ops_onboarding_ramp_profiles` — vehicle_type/operator_class, ordered daily
  revenue targets, **parcels/hour ramp** (multiplier or per-day values), phase-split
  day, **completion-bonus ₦ + per-missed-day reduction %**, effective_from/to.
- `ops_onboarding_cohorts` — cohort start date, amoeba, working-week, members.
- Rider link to a cohort (or `activated_at` fallback); completion-bonus config on
  the ramp profile.
- `ops_supervisor_onboardings` — supervisor person, host amoeba, mentor person,
  start date, phase, `graduated_at`, target/new amoeba, graduation route
  (reassign | cell-split).

## 6. Decisions
Resolved (2026-09-25):
- **D1 — Phase-split day = Day 7.** Days 1–6 on-demand only; 7–12 scheduled+on-demand.
- **D3 — Steady-state = ₦30,000**, raise the bike pace profile so Day 12 hands off
  cleanly.
- **D5 — Weekly batch is normal; off-cycle individuals allowed** (anchor on
  `activated_at`).
- **D6 — No auto-graduation.** Record host amoeba + mentor + phase with assist
  scope; **HR graduates manually** by reassigning to a ready/new amoeba or by
  **splitting the host cell into two amoebas**.

- **D2 — Delivery-pace ramps too.** Working day is fixed-length; parcel throughput
  ramps, so `delivery_parcels_per_hour` scales with the revenue ramp (default
  `ramp_target ÷ graduation_target`), configurable on the profile. Not flat.
- **D4 — Completion bonus is configurable**, not hardcoded; obvious frontend home by
  the Phase-4 redesign. Seed placeholders until the owner sets ₦/reduction%.
- **D7 — No special cell-split tool.** Graduation reuses existing HR amoeba-create +
  Ops roster reassignment; a one-click split is a later org feature.

All decisions closed — spec is ready for a build-approval pass.

## 7. Out of scope (later)
- The HR **prospect funnel** (applications → verification → hire) — separate HR App,
  `docs/NEW-hr-funnel-spec-v0.docx`. Phase 3 only touches already-activated people.
- **Driver** ramp curve (undefined) — mechanism is built ready; curve added later.
- Bonus **payout/settlement** — Phase 3 computes and displays, does not pay.
