# Ops scheduled jobs and data health

## Scheduling model

The API process does not own the production clock. A separate scheduler process creates durable job runs, while a separate worker executes them. Production should invoke `npm run ops:scheduler:once` every minute from system cron or a managed scheduler. This prevents API restarts from silently dropping recurring work.

Job definitions are version-controlled in `apps/ops-api/src/scheduled-jobs.ts` and synchronized into the Scheduled Job Registry at startup.

## Inspect job health

Use:

```http
GET /ops/v1/scheduled-jobs
Authorization: Bearer <management-token>
```

Each record includes schedule, queue, timeout, retry policy, idempotency strategy, freshness SLA, latest run state, current lag, next expected time, and source finality.

Freshness states:

- `provisional`: operational data arrived within SLA but may receive later corrections.
- `final`: the source window is complete.
- `pending_source`: the source is not expected to be final yet, such as the weekly Uber distance report.
- `failed`: the latest run failed.
- `stale`: no successful run exists or the latest success exceeded its freshness SLA.

`GET /health` provides a public machine-readable summary: database state, queue backend, queue depths, last successful ingestion, and scheduled-job attention counts.

## Enqueue and replay

Schedulers and authorized administrators enqueue the same endpoint:

```http
POST /ops/v1/scheduled-jobs/{job_name}/runs
Authorization: Bearer <management-or-service-token>
Idempotency-Key: <stable-trigger-key>
Content-Type: application/json

{
  "requested_window_start": "2026-06-10T00:00:00+01:00",
  "requested_window_end": "2026-06-10T23:59:59+01:00",
  "scheduler_trigger_id": "production-cron-20260610"
}
```

Manual recovery uses this same contract and must preserve the affected date or report window. It must not bypass validation or write directly to domain tables.

The local worker can be run continuously with:

```bash
npm run dev:ops-worker
```

For a one-shot queue drain:

```bash
npm run ops:worker:once
```

Workers record completion through:

```http
POST /ops/v1/scheduled-job-runs/{run_id}/complete
```

Run history is available from `GET /ops/v1/scheduled-job-runs`.

The local build stores queued runs in PGlite for reviewable previews. The production target remains PostgreSQL plus Redis/BullMQ, retaining these contracts and the durable run ledger.

## Notification delivery

Alert evaluation writes a deduplicated notification outbox record for the operator's supervisor. `notification-dispatch` drains that outbox every five minutes and retries failures with exponential backoff.

Development logs deliveries locally. Production must configure:

```text
OPS_NOTIFICATION_WEBHOOK_URL=https://notifications.example/internal/ops
OPS_NOTIFICATION_WEBHOOK_TOKEN=<secret>
```

The webhook receives the recipient person ID, channel, and event payload. This keeps provider-specific SMS, WhatsApp, push, or in-app routing outside the alert transaction.

Management users can inspect delivery state with:

```http
GET /ops/v1/notification-deliveries
```
