# Ops MVP runtime topology

## Processes

Run these as independent supervised processes:

1. Foundation API: `npm run dev:api`
2. Ops API: `npm run dev:ops-api`
3. Ops scheduler trigger: system cron executes `npm run ops:scheduler:once` every minute
4. Ops worker: `npm run dev:ops-worker`
5. Static frontend/developer portal host

The API must remain stateless with respect to scheduling. Restarting it must not erase queued runs.

## Production infrastructure gate

The checked-in PGlite configuration is for local previews and automated tests only. Production activation requires:

- PostgreSQL with daily compressed `pg_dump` backups and a tested restore
- Redis with AOF enabled
- BullMQ execution replacing the development database queue
- TLS termination and private network access to PostgreSQL and Redis
- secrets supplied by the deployment environment, never committed
- notification webhook credentials
- Bolt and both Uber account credentials

Until these are configured and a live connector trial succeeds, the Ops MVP is deployable for review but not production-approved.

## Cron entry

Example:

```cron
* * * * * cd /srv/fleximos && /usr/bin/npm run ops:scheduler:once >> /var/log/fleximos-ops-scheduler.log 2>&1
```

Scheduler trigger IDs are deterministic per job and Lagos-time slot, so duplicate cron invocations return the existing run.

## Acceptance run

Before production approval:

1. Run a Bolt ingestion and both Uber account ingestions.
2. Confirm canonical rows and source provenance.
3. Confirm alert creation, supervisor acknowledgement, and notification delivery.
4. Generate and download the daily report.
5. Stop and restart API and worker processes with a queued run present.
6. Confirm retry, freshness, queue depth, audit, backup, and restore behavior.
