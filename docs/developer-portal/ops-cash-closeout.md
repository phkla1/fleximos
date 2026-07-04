# Ops Cash Status and Closeout

Phase 4D adds the operational cash closeout surface around Monnify deposits.

## Cash Status

`GET /ops/v1/cash/status?record_date=YYYY-MM-DD`

Returns one scoped row per active operator with the variance between platform-expected cash and Monnify-received remittance:

- `expected_cash_ngn`: platform cash expected for the operating date.
- `remitted_cash_ngn`: Monnify deposits received and delivered to Ops for that operator and date.
- `adjustment_ngn`: Finance-approved credits, debits, or reversals.
- `net_position_ngn`: variance, calculated as `remitted_cash_ngn + adjustment_ngn - expected_cash_ngn`.
- `cash_status`: `balanced`, `shortfall`, `in_credit`, or `no_expected_cash`.
- `expected_cash_basis`: currently `cash_trip_revenue_share` where exact connector cash value is unavailable.

When a connector supplies exact cash-trip amount, the implementation should prefer that exact value. Until then, expected cash is derived as `ride_revenue_ngn * cash_trips / trips_completed`.

## Finance Adjustments

`GET /ops/v1/cash/adjustments?adjustment_date=YYYY-MM-DD`

Returns scoped adjustment rows for Finance review and export. Use `operator_id` to drill into one operator.

`POST /ops/v1/cash/adjustments`

Finance roles can create audited adjustments. Managers can view cash status and adjustment history, but cannot create cash adjustments unless they also hold a Finance assignment or system-admin role. Credits increase the operator's remitted position; debits should be sent as a negative `amount_ngn` by API clients.

```json
{
  "operator_id": "operator_123",
  "adjustment_date": "2026-06-12",
  "amount_ngn": -2500,
  "adjustment_type": "debit",
  "reason": "Confirmed cash shortfall",
  "evidence_reference": "bank-statement-2026-06-12-line-17",
  "notes": "Supervisor note reviewed"
}
```

Supervisors can explain shortfalls during closeout, but they do not approve financial adjustments. Evidence references should point to a bank statement, receipt, uploaded file, or other auditable source. Full evidence-file upload/storage is still a production hardening item.

The Ops API rejects new cash adjustments when Payments has already closed the selected accounting period. This keeps the Finance console's locked-period behavior aligned with the backend contract.

## Daily Closeout

`POST /ops/v1/daily-closeouts`

Supervisors submit one closeout per amoeba/date. The API snapshots the current cash summary and unresolved alert count for manager and finance review.

## Settlement and Period Close

The Payments Integration service owns deposit state transitions after Ops receives remittance data:

```text
POST /payments/v1/reconciliation-runs
POST /payments/v1/transactions/{transaction_reference}/settle
POST /payments/v1/transactions/{transaction_reference}/finance-approve
POST /payments/v1/accounting-period-closes
```

The mutation endpoints in this workflow require a service token, global owner/admin role, or an active scoped Finance assignment. A Manager assignment alone can read scoped cash and closeout information but cannot settle deposits, finance-approve deposits, simulate sandbox deposits, close accounting periods, or create Ops cash adjustments.

The Finance console can run the local period-close workflow for a selected operating date. Production use still requires Monnify sandbox/live credentials and public webhook testing, but the MOS-side API contract and review flow are complete for local validation.

When closing a period, the Finance console sends the current unresolved Ops cash exception count to Payments as `ops_exception_count`. Payments combines provider/deposit exceptions and Ops cash exceptions into `exception_count`, so a period with unresolved shortfalls closes as `closed_with_exceptions`.

Once a Payments accounting period close exists for a selected operating date, the Finance console treats that period as locked: cash variance rows remain visible for audit/review, CSV exports still work, but new Finance adjustments are disabled from the UI. The Ops API also enforces the same lock rule server-side before accepting new cash adjustments.
