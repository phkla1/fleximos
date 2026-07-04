# Ops Daily Performance Ingestion

Platform connectors do not write vendor-specific responses directly into reporting tables. They normalize each operator's daily metrics and submit one batch to:

`POST /ops/v1/ingestion-runs`

The request identifies one `platform_account_id`, one Africa/Lagos `record_date`, and one or more records keyed by the platform's operator ID. Ops resolves each ID through `operator_platform_accounts`.

## Processing rules

- A valid record is upserted by `(operator_id, platform_account_id, record_date)`.
- A replay updates the canonical row instead of creating a duplicate.
- Invalid or unmapped records are rejected independently; valid records in the same batch still commit.
- `data_quality` must state whether the metric set is authoritative, derived, heuristic, or degraded.
- `provenance` identifies the connector endpoints or fallback source used.
- `raw_payload` may retain the vendor response needed for audit or reprocessing.
- The `Idempotency-Key` header protects callers from duplicate request delivery.

## Example

```json
{
  "platform_account_id": "platform_bolt_lagos",
  "record_date": "2026-06-06",
  "source": "live",
  "records": [
    {
      "platform_operator_id": "bolt-driver-123",
      "trips_total": 12,
      "trips_completed": 10,
      "trips_cancelled": 1,
      "trips_no_response": 1,
      "ride_revenue_ngn": 22000,
      "net_earnings_ngn": 18500,
      "hours_online": 7.5,
      "current_status": "online",
      "data_quality": "authoritative",
      "provenance": {
        "connector": "bolt",
        "orders_endpoint": "getFleetOrders",
        "state_endpoint": "getFleetStateLogs"
      }
    }
  ]
}
```

Use `GET /ops/v1/ingestion-runs` to inspect run outcomes, `GET /ops/v1/daily-performance` for canonical platform rows, and `GET /ops/v1/team-board` for the cross-platform operator summary.
