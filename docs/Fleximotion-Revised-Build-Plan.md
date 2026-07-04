# Fleximotion Revised Build Plan

**Status date:** 19 June 2026

This short roadmap mirrors Section 14 of `NEW-fleximotion-app-suite-architecture-interfaces-v0.md`.

| Phase | Status | Focus |
|---|---|---|
| 1 | Complete | Contract foundation and developer portal |
| 2 | Complete | Identity and Amoeba foundation |
| 3 | Complete for local review | Ops MVP |
| 4 | In progress | Scoped roles, Manager and Finance experiences, Monnify, cash operations and operational depth |
| 5 | Planned | HR system |
| 6 | Planned | TMS |
| 7 | Planned | Cross-suite analytics and automation |

## Phase 4 Order

1. Scoped business access foundation: role assignments plus independent scopes.
2. Manager and Finance product surfaces. Initial scoped consoles are implemented and Finance is connected to the local Payments Integration service.
3. Monnify setup/test guide, contracts, local simulated provider service, Ops cash ledger, Finance sandbox test surface, transaction verification, failure replay and reconciliation state transitions are complete for local review. Monnify sandbox credentials and public webhook testing can now be run without changing the MOS-side design.
4. Cash operations and closeout are complete for local review. The 4D slice includes platform-expected versus Monnify-received variance, Finance adjustments/reversals, supervisor daily closeout records, settlement, finance approval, accounting-period close records, and grouped Finance console exposure summaries. Production Monnify sandbox credentials and public webhook testing remain an external validation step, not a MOS design blocker.
5. Stakeholder-led finance and analytics dashboard design is captured in `Finance-Analytics-Dashboard-Design-Brief.md`. The first Phase 4E implementation slice is the Analytics Console: mobile-first Net Earnings, hourly efficiency, utilisation, amoeba-owner portfolio, operator signals and leakage watch.
6. Remaining operational depth: deviations, inspections, incidents, media, mileage, P&L, exports, leaderboards and executive views.

Detailed analytics dashboard design is intentionally deferred until the dedicated design discussion.
