# Analytics Console Integration Guide

Phase 4E ships the Analytics Console as the founder/GM/finance control room for local review. It is not a new data-owning service. It composes canonical data from Foundation, Ops and Payments APIs.

Local preview:

```text
http://127.0.0.1:4173/apps/analytics-console/
```

Recommended local URL with explicit API bases:

```text
http://127.0.0.1:4173/apps/analytics-console/?opsApiBase=http://127.0.0.1:4030&foundationApiBase=http://127.0.0.1:4010&paymentsApiBase=http://127.0.0.1:4040
```

## Audience

- Founder: anomalies, growth, investment and pullback decisions.
- GM: operational learning, amoeba-owner performance and changes to make.
- Finance lead: leakage, accountability, cash position and debt readiness.

Supervisors are treated as amoeba owners in the current Ops model. They use the supervisor/team views for real-time task management; the Analytics Console summarizes and compares the wider portfolio.

## Source APIs

Foundation:

- `GET /identity/v1/people`
- `GET /amoeba/v1/amoebas`

Ops:

- `GET /ops/v1/operators`
- `GET /ops/v1/team-board?record_date=YYYY-MM-DD`
- `GET /ops/v1/daily-performance`
- `GET /ops/v1/daily-performance?record_date=YYYY-MM-DD`
- `GET /ops/v1/alerts`
- `GET /ops/v1/cash/status?record_date=YYYY-MM-DD`
- `GET /ops/v1/economics-policies`

Payments:

- `GET /payments/v1/reserved-accounts`
- `GET /payments/v1/transactions`

The dashboard can still render when Payments is unavailable. Cash-on-hand and reserved-account details are then labelled unavailable rather than silently estimated.

## Canonical KPI Definitions

- **Net Earnings:** Platform-derived earnings used for operational control. Do not relabel this as generic revenue.
- **Accounting revenue:** Not defined yet. Do not expose it as a dashboard KPI until Finance defines the accounting treatment.
- **Utilisation:** `active assets / total available assets`.
- **Expected labour hours:** `available asset count * expected_hours_per_operator * selected_period_days`.
- **Hourly efficiency:** `Net Earnings / Expected labour hours`.
- **Operator labour cost:** `Net Earnings * operator_labour_share_pct / 100`.
- **Total labour cost:** `admin_staff_daily_cost_ngn + operator labour cost`, or fallback `expected labour hours * labourCostPerHour` for local URL testing.
- **Breakeven surplus/shortfall:** `Net Earnings - total labour cost - daily_overhead_ngn`.
- **Cash variance:** `Monnify received + Finance adjustments - platform expected cash`.

## Period Handling

Default view is the selected operating day. The console also supports:

- Day: selected operating date only.
- Week: seven available performance dates ending on the operating date.
- Month: thirty available performance dates ending on the operating date.

For week/month views:

- Net Earnings, targets, expected labour hours, operator metrics and amoeba metrics aggregate over the selected dates.
- Live status, cash status and alerts still use the selected operating date because those are operational-state signals.
- Prior-period comparison uses the previous same-length available window.
- Prior-week overlay compares each trend point to the same weekday from the prior week when that data exists.

Custom date ranges are intentionally deferred until reporting/export requirements settle.

## Dashboard Sections

First screen:

- Net Earnings and growth.
- Hourly efficiency versus labour cost.
- Utilisation with numerator and denominator.
- Cash variance.
- Grouped alerts.

Control panels:

- Net Earnings pace and vehicle mix.
- Data-quality impact.
- Attention map.
- Net Earnings trend with prior-week overlay.
- Breakeven and platform mix.
- Amoeba comparison bars.
- Amoeba portfolio drilldowns.
- Grouped operator signals.
- Sortable operator leaderboard.
- Leakage watch.
- CSV export for selected-period amoeba, operator and performance rows.

## Drilldown Pattern

The intended path is:

```text
Company -> Amoeba owner/Amoeba -> Operator -> Platform/Vehicle detail
```

Cards and chart rows should prefer grouped summaries first. Raw operator-level rows appear after the user drills into an amoeba, signal group, leaderboard row or alert group.

## Data Quality Rules

Rows are grouped into:

- Authoritative: source data is direct from the owning platform/provider.
- Derived: value is calculated from partial data.
- Stale/missing: value is not current or is absent.

The dashboard shows both row count and Net Earnings impact. Missing/stale rows must remain visible so users do not mistake missing data for healthy performance.

## Role And Scope Rules

The console must respect scoped access:

- Owner/admin/service sees all data.
- Manager sees assigned amoebas or company scope.
- Finance sees assigned amoebas or company scope plus finance-specific cash context.
- Multiple manager or finance assignments can overlap; effective visibility is the union of active assignments.

Mutation authority remains in the relevant owning surfaces. The Analytics Console is primarily read-only for Phase 4E.

## Local Review Checks

Run:

```bash
npm run validate:openapi
npm run test:api
npx playwright test tests/e2e/role-consoles.spec.mjs
```

The role-console Playwright suite verifies manager, finance and analytics surfaces across desktop and mobile, including Analytics day/week/month period switching and horizontal overflow checks.

## Known Limitations

- Custom date ranges are not yet implemented.
- Board-ready printable views are not yet designed.
- Real tracker-backed mileage is not yet integrated.
- Bikes still rely on platform mileage or configured expected-kilometre controls until trackers exist.
- Production Monnify/live webhook verification remains an external credential and KYC step.
