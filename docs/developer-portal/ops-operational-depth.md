# Ops Operational Depth (Phase 4F)

This guide covers the Phase 4F Ops API surfaces: structured deviation workflows, incidents, vehicle inspections, maintenance, camera media, expenses, amoeba P&L with central-cost allocation, transfer-price events, the operator leaderboard, and the manager escalation queue.

All endpoints live under the Ops API (`http://127.0.0.1:4030` locally) and follow the suite standards: bearer authentication, `Idempotency-Key` on every mutation, scoped visibility from role assignments, and audit entries on every state change. Full request/response schemas are in `api-contracts/openapi/ops.v1.json` and the live Swagger at `/ops/developer`.

## Deviation reasons and alert escalation

Operators explain alerts with standardised reasons instead of ad-hoc WhatsApp messages. Supervisors accept or reject the explanation; either outcome is audited.

```http
GET  /ops/v1/deviation-reason-codes
POST /ops/v1/alerts/{alert_id}/deviation-reason          { "reason_code": "vehicle_fault", "note": "..." }
POST /ops/v1/alerts/{alert_id}/deviation-reason/review   { "decision": "accepted", "note": "..." }
POST /ops/v1/alerts/{alert_id}/escalate                  { "note": "..." }
```

- Reason codes: `network_app_issue`, `vehicle_fault`, `fuel_charging_problem`, `platform_account_blocked`, `personal_emergency`, `other` (note required, max 140 chars).
- Submitting a reason sets `deviation_review_status = pending`; review moves it to `accepted` or `rejected`.
- Escalating sets `resolution_status = escalated` and surfaces the alert in `GET /ops/v1/escalations`.
- Alert visibility is scope-checked: operators can only explain their own alerts; supervisors review alerts on their team.

## Incidents

The operator support button creates incidents. Accident and police incidents are `high` severity and enter the manager escalation queue when unacknowledged past the configured window (`INCIDENT_ESCALATION_MINUTES`, default 30).

```http
GET  /ops/v1/incidents?status=open
POST /ops/v1/incidents                       { "operator_id": "...", "incident_type": "breakdown", "description": "...", "gps_lat": 6.5, "gps_lng": 3.4, "media_ids": [] }
POST /ops/v1/incidents/{incident_id}/acknowledge
POST /ops/v1/incidents/{incident_id}/resolve { "resolution_notes": "..." }
```

Incident types: `accident`, `police` (high severity), `breakdown`, `fuel_funds`, `low_battery`, `other` (normal). Creation notifies the operator's supervisor through the notification outbox.

## Vehicle inspections

Supervisors inspect each vehicle at least every 48 hours. Compliance is tracked per vehicle and exposed to the data-health and escalation surfaces.

```http
GET  /ops/v1/inspections
GET  /ops/v1/inspections/compliance
POST /ops/v1/inspections                              { "vehicle_id": "...", "odometer_km": 45210, "fuel_level_pct": 60, "condition": "needs_repair", "issue_categories": ["brakes"], "notes": "...", "media_ids": [] }
POST /ops/v1/inspections/{inspection_id}/review        { "decision": "follow_up", "note": "..." }
```

- Conditions: `ok` (no review needed), `minor_issues`, `needs_repair` (both flagged for manager review).
- `GET /ops/v1/inspections/compliance` returns `never_inspected` / `overdue` / `current` per active vehicle plus a compliance percentage.

## Maintenance reports

Operators or supervisors report vehicle issues; supervisors and managers move them through `open → in_repair → resolved`. A resolved report can carry `cost_ngn`, which feeds the amoeba P&L as a variable maintenance cost.

```http
GET  /ops/v1/maintenance-reports?status=open
POST /ops/v1/maintenance-reports                              { "vehicle_id": "...", "category": "brakes", "description": "...", "media_ids": [] }
POST /ops/v1/maintenance-reports/{maintenance_id}/status       { "status": "resolved", "cost_ngn": 18500, "resolution_notes": "..." }
```

Categories: `tyres`, `brakes`, `engine`, `electrical`, `body_damage`, `other`.

## Camera media

Media is registered as base64 camera captures with GPS and capture time. Production policy (camera-only, EXIF capture-time tolerance) is enforced when `MEDIA_STRICT_CAPTURE=true`; local review mode accepts simulated captures.

```http
POST /ops/v1/media                       { "kind": "incident_evidence", "content_type": "image/jpeg", "content_base64": "...", "captured_at": "...", "gps_lat": 6.52, "gps_lng": 3.37 }
GET  /ops/v1/media/{media_id}
GET  /ops/v1/media/{media_id}/content
```

- Allowed types: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`; max 3MB decoded.
- Binary content is stored on disk under `FLEXI_OPS_MEDIA_DIR` (defaults next to the Ops database directory); metadata and SHA-256 live in the database.
- Environment flags: `MEDIA_STRICT_CAPTURE`, `MEDIA_CAPTURE_TOLERANCE_MINUTES` (default 5), `MEDIA_REQUIRE_GPS`.

## Expenses and central-cost allocation

Manager/Finance users record direct amoeba expenses and central costs. Central costs (`allocation = central`, no `amoeba_id`) are allocated across amoebas by active-operator headcount when P&L is computed.

```http
GET  /ops/v1/expenses?period_start=2026-07-01&period_end=2026-07-05
POST /ops/v1/expenses    { "expense_date": "2026-07-05", "amoeba_id": "amoeba_island", "category": "fuel", "amount_ngn": 6000, "description": "...", "evidence_reference": "..." }
POST /ops/v1/expenses    { "expense_date": "2026-07-05", "category": "overhead", "allocation": "central", "amount_ngn": 4000 }
```

Categories: `fuel`, `maintenance`, `rent`, `salaries`, `utilities`, `overhead`, `other`.

## Transfer-price events

TMS publishes transfer-price events to Ops; Ops records them as P&L inputs (credits to the providing amoeba, charges to the receiving amoeba). The endpoint is idempotent on `external_event_id`, so TMS can retry safely.

```http
GET  /ops/v1/transfer-price-events
POST /ops/v1/transfer-price-events   { "external_event_id": "tms-event-0001", "event_date": "2026-07-05", "from_amoeba_id": "amoeba_island", "to_amoeba_id": "amoeba_mainland", "amount_ngn": 2500, "description": "Shared dispatcher time" }
```

Service tokens and Manager/Finance users can publish. Ops remains the canonical P&L calculator per the suite architecture.

## Amoeba P&L

```http
GET /ops/v1/pnl?period_start=2026-07-01&period_end=2026-07-05&amoeba_id=amoeba_island
```

Per amoeba the response includes Net Earnings, direct expense breakdown, resolved maintenance costs, headcount-allocated central costs, transfer-price credits/charges, gross P&L, hourly P&L (gross ÷ hours online) and target attainment. Company totals are included. Access requires an assigned Manager or Finance role (or system admin); rows respect the caller's scope.

## Operator leaderboard

```http
GET  /ops/v1/leaderboard?period_start=...&period_end=...&sort=score
GET  /ops/v1/leaderboard-config
POST /ops/v1/leaderboard-config   { "acceptance_weight": 0.30, "online_weight": 0.30, "cash_weight": 0.30, "revenue_weight": 0.10, "default_timeline": "this_week", "company_wide_visible": true }
```

- Performance Score (0–100) = weighted acceptance, time-online (vs expected hours from the economics policy), cash receipt, and revenue components. Weights must sum to 1.0 and are admin-configurable.
- Sort dimensions: `score`, `net_earnings`, `acceptance`, `trips`, `online`, `cash`.
- Top three entries carry `gold` / `silver` / `bronze` badges; only operators with activity in the period appear.
- Operator-role callers receive `components.revenue_score = null` (per spec, operators see the three components they control).
- `company_wide_visible = false` restricts operator callers to their own scope while managers retain all views.

## Manager escalation queue

```http
GET /ops/v1/escalations
```

Returns, for the caller's scope: escalated or tier-2+ unresolved alerts, unacknowledged high-severity incidents past the escalation window, open incidents, overdue vehicle inspections, amoebas missing today's closeout, and open maintenance reports — plus per-category counts for dashboard badges.

## Local review surfaces

- Operator PWA: support/incident button, deviation reason capture, maintenance reporting and leaderboard.
- Supervisor console: incident inbox, deviation review, escalation, inspections and maintenance queue.
- Manager console: executive KPIs, escalation queue, P&L, expenses and leaderboard with CSV exports.

Run `npm run test:api` (covers `tests/api/ops-depth.test.mjs`) and `npm run test:e2e` for regression coverage.
