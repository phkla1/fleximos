# Finance and Analytics Dashboard Design Brief

**Phase:** 4E
**Status:** Implemented for local review in the Analytics Console. Remaining items are production hardening, deeper exports, tracker integration and board-ready reporting.

## Canonical Definitions

- **Net Earnings:** The platform-derived earnings metric used by this dashboard. Do not label it generically as "Revenue" in dashboard UI.
- **Accounting revenue:** Not yet defined. Do not use as a canonical KPI until the accounting treatment is agreed.
- **Utilisation:** `Active assets / Total available assets`.
- **Hourly efficiency:** `Net Earnings / Expected Labour Hours`.
- **Supervisor:** Equivalent to **Amoeba owner** in the current Ops operating model.

## 1. Product Intent

The dashboard should feel like an operational control room: mobile-first, visual, and decision-oriented. It should help leaders spot averages, anomalies, trends and correlations without digging through spreadsheets, WhatsApp threads or platform portals.

The dashboard should answer:

- What unexpected or anomalous thing happened today?
- What did we learn operationally?
- Where is money leaking, who is responsible, and what must be done?
- Where should we increase investment or pull back?
- Which amoeba owners/operators should be supported, rewarded, coached or removed?
- Are we on track to pay debts and fund new investments?

## 2. Primary Users

- **Founder:** growth, anomalies, investment allocation, strategic pullback/increase decisions.
- **GM:** operational learning, changes to make, top performers, laggards, amoeba-owner effectiveness.
- **Finance lead:** leakage, accountability, cash on hand, debt readiness and financial controls.

In the Ops operating model, **Supervisor = Amoeba owner**. Amoeba owners remain real-time operators of their own amoeba/team views, but this dashboard is not primarily an amoeba-owner task board.

## 3. Default View and Periods

- Default view: **Today**.
- Operating day cutoff: **midnight WAT**.
- Refresh cadence: **hourly**.
- Managers need both intraday live performance and closed-day results.
- Reports should become locked after period close.
- Analytics Console currently supports day, week and month period selection. Custom range remains a later reporting/export enhancement.

## 4. Scope and Drilldown

Default drilldown:

`Company -> Amoeba owner/Amoeba -> Operator -> Platform/Vehicle/Trip detail`

Notes:

- Amoeba owner and amoeba are effectively the same performance level in the current operating model.
- Operator performance is the foundation of all analysis.
- Car and bike performance must always be separable.
- Start with consolidated platform views, but every metric should drill down by platform, vehicle type, amoeba and operator.
- Managers and finance users see whatever amoebas are assigned to them through scoped role assignments.

## 5. First-Screen KPIs

The first screen should show key KPIs without scrolling on desktop and remain usable on mobile.

Required KPIs:

- Net Earnings.
- Net Earnings growth.
- Per-amoeba hourly efficiency.
- Hourly efficiency versus average labour hourly cost.
- Asset utilisation.
- Breakeven indicator: total overheads versus sum of net contributions per operator.
- Platform expected cash versus Monnify received variance.
- Cash on hand versus upcoming payments, especially debt.

Net Earnings definition:

- The dashboard should consistently name this metric **Net Earnings**, not generic "Revenue".
- Accounting revenue is not yet defined and should not be used as a dashboard label until the accounting treatment is agreed.
- Platform/card payouts and operator cash remittances should be separated in the Net Earnings breakdown.

## 6. Targets and Alert Thresholds

Vehicle Net Earnings targets:

- Car minimum: **NGN 50,000/day**.
- Car historical high: about **NGN 85,000/day**.
- Bike minimum: **NGN 25,000/day**.
- Bike historical high: about **NGN 35,000/day**.

Intraday Net Earnings target curve:

- Noon: 30%.
- 4pm: 60%.
- 7pm: 80%.
- End of day: 100%.

Variance rules:

- Default alert threshold: **15% variance**.
- Thresholds do not differ by vehicle type, platform or location for now.
- The model must allow thresholds to differ later as platforms/geographies expand.

## 7. Hourly Efficiency and Utilisation

Utilisation:

- `active_assets / total_available_assets`
- "Active assets" means assets currently active/online in the operating day.
- "Total available assets" excludes unavailable assets such as vehicles under maintenance, inactive assets, or assets deliberately removed from service.
- The dashboard should show both numerator and denominator clearly.

Hourly efficiency:

- `Net Earnings / Expected Labour Hours`
- Use expected minimum working hours, not actual hours, so performance does not look better when people work less.
- Larger amoebas should carry larger expected-hour obligations than smaller amoebas.

## 8. Cash and Finance Workflow

Finance morning view should show:

- Missing cash.
- Whether daily Net Earnings targets were hit.
- Whether hourly efficiency exceeded average labour cost.
- Whether sum of operator net contributions exceeds breakeven.
- Cash on hand versus upcoming payments/debt.
- Accounting revenue is not yet defined; do not show it as a canonical KPI until accounting treatment is agreed.

Closeout view should show:

- Cash received across all platforms.
- Platform expected cash versus Monnify received.
- Shortfalls by amount and age.
- Finance adjustments with evidence.

Unresolved cash issue:

- Discrepancy between platform cash-to-operator and Monnify remittance after trigger threshold.
- Operators should remit once cash held passes a configurable amount, regardless of time of day.

Shortfall severity:

- 1% discrepancy may be acceptable.
- 10% discrepancy is not acceptable.
- A few hours of timing lag can be acceptable.
- More than one day unresolved is not acceptable.

Adjustment evidence:

- Bank statement or receipt showing adjustment amount.

Approval authority:

- Founder/GM approve corrections, reversals, write-offs and settlement.

## 9. Fuel, Mileage and Leakage

Finance needs per-kilometre Net Earnings and cost control.

Rules:

- Installed vehicle tracker is authoritative for car mileage where available.
- Platform mileage is authoritative where tracker data is unavailable.
- Bikes currently lack tracker coverage; use expected-kilometre targets configured in Admin until trackers exist.
- Fuel expectation is tied to expected kilometre performance.
- Dead mileage acceptable threshold: **40%**.

Fuel control workflow:

- Accountant logs fuel-station payment, litres and price per litre.
- Dashboard compares fuel purchased against mileage since last purchase.
- Driver fuel requests should be reviewed against mileage completed since prior purchase.

## 10. Alerts and Escalation

Dashboard alerts should group issues first, then drill down.

Alert categories:

- Big leakages.
- Missing assets.
- Missing operators.
- Net Earnings dips.
- Net Earnings surges.
- Asset tracker failure.
- Long offline period after coming online.
- Offline during delivery.

Escalation:

- Amoeba owner gets first action window.
- If the amoeba owner does not act within configurable time, alert escalates to manager.
- Founder/admin is not primarily a realtime escalation role; founder can receive via manager assignment where desired.
- Retain all alerts for a configurable period.

## 11. Leaderboards

Use sortable metrics rather than one composite score.

Initial sortable dimensions:

- Net Earnings.
- Acceptance rate.
- Trips/deliveries.
- Utilisation/online asset contribution.
- Cash receipt performance.
- Mileage/fuel exception rate.

## 12. Data Quality

Authoritative sources:

- Mileage: installed tracker where available.
- Net Earnings: platform source such as Bolt, Uber, inDrive.
- Cash: Monnify or integrated bank provider.

Derived or estimated values:

- Should be clearly labelled.
- Use a visual status treatment such as colour or badge.
- Examples: exact, derived, stale, missing.

Missing/stale data:

- Must be visible rather than silently excluded.
- Dashboard should show stale-data warnings at source and metric level.

## 13. Exports and Reports

- CSV export is required generally.
- Daily reports should exist for Amoeba owner and Manager.
- Any view should support period selection, so weekly/monthly reporting can be generated from the same dashboard.
- Audit-ready and board-ready views remain open design questions.

## 14. As-Built Phase 4E Local Review

The Analytics Console is available locally at:

```text
http://127.0.0.1:4173/apps/analytics-console/
```

It consumes:

- Foundation Identity people and Amoeba definitions.
- Ops operators, team board, daily performance, alerts, cash status and economics policies.
- Payments reserved accounts and transactions when the Payments Integration service is available.

Implemented control-room surfaces:

- First-screen KPIs for Net Earnings, Net Earnings growth, hourly efficiency, utilisation, cash variance and grouped alerts.
- Day, week and month period controls. Longer periods aggregate Net Earnings, targets, expected labour hours and operator/amoeba performance over the selected period.
- Net Earnings trend with prior-week overlay where historical data exists.
- Hourly efficiency compared against configured labour cost. The dashboard labels whether HE is above or below the labour floor.
- Breakeven and platform mix, including admin fixed labour cost, operator labour share and daily overhead assumptions.
- Car/bike split and platform mix so vehicle economics do not get blended.
- Amoeba comparison bars for score, target pace, HE, utilisation and cash.
- Amoeba portfolio cards that drill into decision cue, prior-period movement, platform mix, vehicle mix and operator rows.
- Grouped operator signals for missing, offline, cash shortfall and active performers.
- Sortable operator leaderboard by Net Earnings, acceptance, trips, online time and cash performance.
- Leakage watch grouped by cash shortfalls, missing/offline operators, stale data and open alerts.
- Data-quality impact drilldown showing authoritative, derived and stale/missing Net Earnings impact.
- CSV export for amoeba, operator and performance rows in the selected day/week/month period.

Implementation notes:

- Supervisor and amoeba owner are treated as the same operational level.
- Net Earnings is the canonical dashboard term. Accounting revenue is intentionally absent until accounting treatment is defined.
- Utilisation uses `active assets / total available assets`.
- Hourly efficiency uses `Net Earnings / Expected Labour Hours`, not actual hours worked.
- The selected operating date still supplies live status, cash status and alert context. Week/month views aggregate performance rows over the period while preserving current operational status context.
- Payments and Monnify cash-on-hand displays degrade gracefully when the Payments Integration service is unavailable.

## 15. Remaining 4E Hardening

- Add custom date ranges after day/week/month review is accepted.
- Add board-ready printable views once the board-meeting format is agreed.
- Add production data freshness badges per source after connector SLAs are finalized.
- Add real tracker-backed mileage into analytics once the tracker connector is implemented.
- Add richer correlation views for early resumption, utilisation, demand trend and Net Earnings growth.

## 16. Open Questions

- Which KPIs are vanity metrics and should be de-emphasized?
- How much raw detail should be visible before drilldown?
- What current reporting mistakes must the dashboard prevent?
- Which reports must be audit-ready?
- Which views must be printable or board-meeting ready?
- What exact cash-held trigger should force an operator remittance?
- What should the default production labour-hour expectation be per operator/amoeba after more real operating data is available?
- What average labour hourly cost should be the default breakeven comparator if no saved economics policy exists?
