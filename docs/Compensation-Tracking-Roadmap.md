# Compensation Tracking Roadmap (post-beta)

Source of truth: the Rider Compensation & Performance Framework (10 Oct 2026),
`…/Fleximotion/HR/Final_Rider_pay_Fleximotion_Rider_Compensation_Proposal-7[2050701].odt`.

The framework implies tracking that FlexiMOS does **not** yet do. Owner decision
(24 Oct 2026): **log these to the roadmap; build none into the current beta** —
the beta stays focused on the ops-monitoring core plus the amoeba/site remodel
and the differentiated daily targets. Each item below is its own module.

## Wired into the beta now (not roadmap)
- **Daily revenue target**: ₦25,000 standard / ₦28,000 accommodated, as editable,
  accommodation-derived defaults (default + optional per-operator override).
- **Onboarding ramp** rescaled to graduate to each rider's steady-state (25k/28k),
  not a flat ₦30,000.

## Roadmap (deferred, each its own module)
1. **Attendance KPI** — present/absent per working day, verified vs unverified
   (verified = medical / bereavement / approved leave), monthly absence count,
   ≤3-unverified rule. Builds on existing GPS check-in + supervisor approval.
2. **Accident / safety record** — at-fault accidents + routine safety checks per
   rider; monthly 90%-accident-free rollup. Not tracked today.
3. **Daily cash-bonus engine + register** — compute ₦2,000 at threshold
   (₦32k standard / ₦35k accommodated) + ₦1,000 per full ₦5,000 above, from net
   revenue; signed daily register, supervisor cash float, weekly reconciliation,
   monthly statement.
4. **Monthly KPI rollup + pay statement** — days-at-target / 26, absences,
   accident status → which ₦20,000 portions earned; per-rider monthly statement
   (₦80k basic + 3 × ₦20k + daily bonuses paid).
5. **Net-revenue definition** — the bonus is measured on *net* revenue; confirm
   net-vs-gross and the deduction basis against what we store (`ride_revenue_ngn`).
6. **Per-rider fuel/maintenance rollup** — monthly cost-to-revenue per rider
   (we have `ops_fuel_issues`; need the rollup; maintenance not yet captured).
7. **Payroll / basic salary** (₦80k/month) — HR/Finance scope.
8. **Optional (framework §11)** — 14-day resignation notice, 90-day loyalty bonus,
   Rider-of-the-Month, quarterly retention/cost review.

See memory `fleximos-rider-compensation` for the full numbers.
