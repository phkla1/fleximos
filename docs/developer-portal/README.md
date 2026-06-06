# Fleximotion Developer Portal

This portal is the first implementation slice for the API-first app suite. It gives future consumers a stable place to find REST contracts, integration rules, webhook conventions, idempotency requirements, and frontend review expectations.

## Local Preview

From the repository root:

```bash
node scripts/serve-developer-portal.mjs
```

Then open:

```text
http://localhost:4173/apps/developer-portal/
```

## Contract Sources

The portal reads the versioned OpenAPI JSON files in `api-contracts/openapi/`:

- `identity.v1.json`
- `amoeba.v1.json`
- `ops.v1.json`
- `hr.v1.json`
- `tms.v1.json`

These contracts are intentionally skeletal but enforce the suite boundaries from the architecture documents. As implementation begins, each backend service should expand its contract before or alongside the code that implements it.

During local Ops development:

- Static suite portal: `http://127.0.0.1:4173/apps/developer-portal/`
- Live NestJS Ops Swagger: `http://127.0.0.1:4030/ops/developer`
- Ops PWA preview: `http://127.0.0.1:4173/apps/ops-console/`

## Acceptance Gate for API Changes

Every public endpoint should include:

- A versioned path.
- Bearer auth or an explicit public-security exception.
- Request and response schemas.
- Error responses using the standard error envelope.
- `Idempotency-Key` on cross-system or user-facing mutations.
- Examples for important integration flows.

## Frontend Review Loop

Every frontend phase should expose a local preview URL, run browser checks at mobile and desktop sizes, and keep screenshots available for stakeholder feedback. The portal itself is a lightweight static frontend so it can be reviewed immediately while backend services are still being planned.
