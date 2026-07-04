# Ops reports and historical migration

## Daily report snapshots

`POST /ops/v1/daily-reports` generates an immutable snapshot from canonical daily performance rows. Re-generating the same date and amoeba creates a new revision; previous revisions remain available.

Required headers:

- `Authorization: Bearer <token>`
- `Idempotency-Key: <unique key>`

The response contains summary totals and the exact source rows used. Use `GET /ops/v1/daily-reports` to list revisions and `GET /ops/v1/daily-reports/{report_id}` to retrieve one.

The Ops admin console exposes this workflow under **Daily reports**. Administrators can generate company-wide or amoeba-specific snapshots, inspect the source rows, and download JSON or CSV copies.

## CSV migration

Run a validation pass first:

```bash
npm run migrate:ops-daily -- --input ./daily.csv
```

The normalized CSV requires `record_date`, `platform_account_id`, and `platform_operator_id`. Other supported columns mirror the daily ingestion payload.

Where source files identify people by name, provide a reviewed JSON mapping:

```json
{
  "Source Operator Name": {
    "platform_account_id": "platform_bolt_lagos",
    "platform_operator_id": "external-driver-id"
  }
}
```

Execute only after the dry run has no rejected rows:

```bash
npm run migrate:ops-daily -- --input ./daily.csv --mapping ./mapping.json --execute
```

Execution uses the normal ingestion API with `source: migration`, preserving validation, audit, and upsert behavior.
