# Fleximotion Revised Build Plan

**Status date:** 4 July 2026

This short roadmap mirrors Section 14 of `NEW-fleximotion-app-suite-architecture-interfaces-v0.md`.

| Phase | Status | Focus |
|---|---|---|
| 1 | Complete | Contract foundation and developer portal |
| 2 | Complete | Identity and Amoeba foundation |
| 3 | Complete for local review | Ops MVP |
| 4 | In progress | Scoped roles, Manager and Finance experiences, Monnify, cash operations, analytics and remaining operational depth |
| 5 | Planned | HR system |
| 6 | Planned | TMS |
| 7 | Planned | Cross-suite analytics and automation |

## Phase 4 Order

1. Scoped business access foundation: role assignments plus independent scopes.
2. Manager and Finance product surfaces. Initial scoped consoles are implemented and Finance is connected to the local Payments Integration service.
3. Monnify setup/test guide, contracts, local simulated provider service, Ops cash ledger, Finance sandbox test surface, transaction verification, failure replay and reconciliation state transitions are complete for local review. Monnify sandbox credentials and public webhook testing can now be run without changing the MOS-side design.
4. Cash operations and closeout are complete for local review. The 4D slice includes platform-expected versus Monnify-received variance, Finance adjustments/reversals, supervisor daily closeout records, settlement, finance approval, accounting-period close records, and grouped Finance console exposure summaries. Production Monnify sandbox credentials and public webhook testing remain an external validation step, not a MOS design blocker.
5. Finance and analytics dashboard design is captured in `Finance-Analytics-Dashboard-Design-Brief.md` and implemented for local review in the Analytics Console. The 4E slice includes mobile-first Net Earnings control signals, day/week/month periods, prior-week overlays, hourly efficiency versus labour cost, utilisation, breakeven, platform and vehicle mix, amoeba-owner portfolio drilldowns, grouped operator signals, sortable operator leaderboard, leakage watch and data-quality impact drilldowns.
6. Remaining operational depth after 4E: deviations, inspections, incidents, media, tracker-backed mileage, fuel-control production workflows, P&L, broader exports, executive/board-ready views and production connector hardening.

## Phase 4 Local Review Surfaces

- Admin console: role assignments, roster/fleet management, target/economics controls and data-health operations.
- Manager console: scoped multi-amoeba oversight and escalations.
- Finance console: Monnify/reserved-account status, cash variance, adjustments, closeout review, settlement, finance approval, period locks and CSV exports.
- Analytics console: founder/GM/finance operational control room for Net Earnings, efficiency, utilisation, breakeven, amoeba comparison, operator signals and leakage.
- Operator PWA: operator-facing performance prompts and alert acknowledgement surface.
- Developer portal: OpenAPI contracts and integration guides for scoped access, Monnify, cash closeout, economics policies, scheduled jobs, ingestion and analytics.

## Phase 4 Production Hardening Items

- Replace simulated Monnify mode with sandbox and then live credentials after external KYC/approval.
- Expose public webhook URLs and verify Monnify signatures end to end.
- Add real car tracker ingestion for mileage and retain platform-mileage fallback for bikes.
- Add durable file/evidence storage for finance adjustments, incidents and inspections.
- Expand exports beyond current Finance and Analytics CSVs into richer report CSVs and board-ready views.
- Add deployment, observability, queue monitoring and operational runbooks around scheduled jobs and workers.
