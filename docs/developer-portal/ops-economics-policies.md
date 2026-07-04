# Ops Economics Policies

Finance economics policies let Ops and Analytics calculate breakeven, labour cost, and hourly efficiency without hard-coded URL assumptions.

## Policy model

`GET /ops/v1/economics-policies`

Returns effective-dated policy rows:

- `admin_staff_daily_cost_ngn`: fixed daily staff cost for admin/management labour.
- `operator_labour_share_pct`: operator labour cost as a percentage of Net Earnings.
- `daily_overhead_ngn`: non-labour daily overhead used for breakeven checks.
- `expected_hours_per_operator`: expected labour hours per active operator.
- `effective_from` / `effective_to`: date range for historical correctness.

Analytics selects the latest policy effective on the selected operating date. URL parameters can still override values for local testing, but saved policies are the normal integration path.

## Create a policy

`POST /ops/v1/economics-policies`

Requires `Authorization: Bearer ...` and `Idempotency-Key`.

```json
{
  "policy_name": "Daily economics policy",
  "admin_staff_daily_cost_ngn": 50000,
  "operator_labour_share_pct": 25,
  "daily_overhead_ngn": 75000,
  "expected_hours_per_operator": 10,
  "effective_from": "2026-06-01"
}
```

## Dashboard usage

The Analytics console uses these fields as follows:

- Operator labour cost = `Net Earnings * operator_labour_share_pct / 100`.
- Total labour cost = `admin_staff_daily_cost_ngn + operator labour cost`.
- Effective hourly labour cost = `total labour cost / expected labour hours`.
- Hourly efficiency = `Net Earnings / expected labour hours`.
- Breakeven surplus or shortfall = `Net Earnings - total labour cost - daily_overhead_ngn`.

These are operational control metrics, not accounting revenue.
