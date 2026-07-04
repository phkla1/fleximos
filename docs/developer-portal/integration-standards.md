# Fleximotion Integration Standards

## Ownership

Each domain API owns one canonical slice of the business:

- Identity owns canonical people, users, auth, service accounts, and suite-wide roles.
- Amoeba owns amoeba definitions, hierarchy, classification, and coordinator assignment.
- HR owns prospects, recruitment lifecycle, verification, approvals, contracts, and Ops handoff.
- Ops owns operators, vehicles, platform accounts, daily operations, alerts, cash, P&L, and transfer-price impacts.
- TMS owns backlog, learning, substrates, transfer-price event creation, points, and management snapshots.

Other systems may cache projections for display, but they must refresh from the owning API and must not treat local copies as canonical.

## Authentication

Human users authenticate through Identity. Service-to-service consumers use scoped service accounts issued by Identity.

All protected requests use:

```http
Authorization: Bearer <token>
```

Service tokens should be scoped to the minimum API, resource, and verb set required for the integration.

## Idempotency

All important mutations require:

```http
Idempotency-Key: <client-generated-key>
```

Required uses include HR to Ops onboarding, TMS to Ops transfer-price publication, cash/remittance writes, alert acknowledgements and resolutions, contract generation, and prospect imports.

## Errors

All APIs use this error shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "target_amoeba_id is required",
    "request_id": "req_01JZ7RQF2H9G79YJ8QQ6PAV2VG",
    "details": [
      { "field": "target_amoeba_id", "reason": "required" }
    ]
  }
}
```

Consumers should log `request_id` and include it when reporting integration issues.

## Events

Events are notifications. APIs are authority.

Webhook delivery is at least once. Consumers must deduplicate by `event_id` or `idempotency_key`.

```json
{
  "event_id": "evt_01JZ7QAJ5V6VGZB1WTP3NQ9JGN",
  "event_type": "personnel.ready_for_ops_onboarding",
  "source_system": "hr",
  "schema_version": "1.0",
  "occurred_at": "2026-06-04T09:00:00Z",
  "idempotency_key": "ready_for_ops:prospect_01JZ7Q...",
  "data": {
    "prospect_id": "prospect_01JZ7Q...",
    "person_id": "person_01JZ7M...",
    "target_amoeba_id": "amoeba_mainland"
  }
}
```

## Frontend Review

Every frontend build should have a visible preview URL and automated browser checks. Use Playwright or the in-app browser to validate:

- Desktop and mobile layout.
- Text overflow and navigation.
- Core user workflows.
- Loading and empty states.
- Screenshots suitable for stakeholder review.
