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

## Current Contract Files

- `api-contracts/openapi/identity.v1.json`
- `api-contracts/openapi/amoeba.v1.json`
- `api-contracts/openapi/ops.v1.json`
- `api-contracts/openapi/hr.v1.json`
- `api-contracts/openapi/tms.v1.json`
