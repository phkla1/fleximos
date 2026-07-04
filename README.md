# fleximos

Fleximotion app-suite planning and implementation workspace.

## Developer Portal

The first implemented slice is a static developer documentation portal plus versioned OpenAPI contract skeletons for the five planned API domains.

Run the portal locally:

```bash
node scripts/serve-developer-portal.mjs
```

Open:

```text
http://localhost:4173/apps/developer-portal/
```

The first admin frontend is available at:

```text
http://localhost:4173/apps/admin-console/
```

Validate the OpenAPI contract files:

```bash
npm run validate:openapi
```

Run the foundation API locally:

```bash
npm run dev:api
```

Development service-token requests can use:

```text
Authorization: Bearer flexi-dev-service-token
```

The local API currently uses PGlite, an embedded PostgreSQL-compatible database, persisted under `.data/local-foundation-pglite`.

Run the Ops API:

```bash
npm run dev:ops-api
```

The Ops console is available at:

```text
http://localhost:4173/apps/ops-console/
```

The Ops admin console and operator PWA are available at:

```text
http://localhost:4173/apps/ops-admin-console/
http://localhost:4173/apps/operator-pwa/
```

The admin Data Health view exposes the Scheduled Job Registry, freshness/finality state, queue depth, run ledger, and scoped replay controls.

Run the development scheduler and worker in separate terminals:

```bash
npm run dev:ops-scheduler
npm run dev:ops-worker
```

The scheduler uses Africa/Lagos calendar time and creates deduplicated durable runs. The worker executes connector ingestion, alert evaluation, notification dispatch, and daily report generation.

Seed the realistic local roster and operator login accounts with:

```bash
npm run seed:ops-demo
```

Validate a historical daily CSV before importing:

```bash
npm run migrate:ops-daily -- --input ./daily.csv
```

## Current Contract Files

- `api-contracts/openapi/identity.v1.json`
- `api-contracts/openapi/amoeba.v1.json`
- `api-contracts/openapi/ops.v1.json`
- `api-contracts/openapi/hr.v1.json`
- `api-contracts/openapi/tms.v1.json`
