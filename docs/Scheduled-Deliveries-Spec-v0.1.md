# Scheduled Deliveries — Spec v0.1 (batch-level v1)

**Status:** Draft for product-owner review — nothing built yet
**Derived from:** `docs/Supervisor-App-Frontend-Brief.md` §7 + owner
clarifications (2 Aug 2026): supervisors manually scan/record and assign
daily targets today; customers (Speedaf, Konga, …) have no API yet but are
expected to provide them later.

## 1. What v1 is (and is not)

v1 is **batch-level control with manual entry** — it works with zero
customer integration, matching today's reality. Package-level scanning
(`fleximos_scan` events, offline queue in the operator app) is v2; hybrid
reconciliation against customer records is v3. The v1 data model is designed
so v2/v3 bolt on without changing the supervisor's workflow.

Every recorded count carries a **source label** shown wherever the number
appears: `customer_app_manual` (typed by supervisor), `customer_app_import`
(CSV/export upload), `customer_api` (future Speedaf/Konga feeds),
`fleximos_scan` (future). Nobody ever mistakes typed counts for scan truth.

## 2. Domain model (Ops API owns it)

- **delivery_customer** — customer_id, name, contact, notes, status.
- **delivery_batch** — batch_id, customer_id, amoeba_id, batch_date,
  manifest_ref (free text), status `open → in_progress → closed`,
  batch-stage counts: `expected`, `received`, `sorted` (pre-assignment
  stages, entered by supervisor), notes, created_by, audit trail.
  Assigned/out/delivered/failed/returned totals are **derived** from
  assignments so they can never disagree with the driver rows.
- **delivery_assignment** — assignment_id, batch_id, operator_id,
  `assigned_count` (the driver's daily target from the supervisor),
  `delivered_count`, `failed_count`, `returned_count`, status
  `assigned → out_for_delivery → completed`, count source label, updated_by,
  timestamps.
- **delivery_exception** — exception_id, batch_id, optional assignment_id,
  category (`shortage`, `damaged`, `customer_dispute`, `failed_delivery`,
  `return_pending`, `other`), note, optional camera-only photo
  (`media_ids`, same credibility chain as inspections), status
  `open → resolved`.

## 3. API surface (all with Idempotency-Key, audit, scoped access)

```http
GET/POST   /ops/v1/delivery-customers
GET/POST   /ops/v1/delivery-batches            ?date_from&date_to&customer_id&status
PATCH      /ops/v1/delivery-batches/{id}/counts       (expected/received/sorted + source)
POST       /ops/v1/delivery-batches/{id}/assignments  (operator + assigned_count)
PATCH      /ops/v1/delivery-assignments/{id}          (progress counts + status + source)
POST       /ops/v1/delivery-batches/{id}/exceptions
POST       /ops/v1/delivery-exceptions/{id}/resolve
POST       /ops/v1/delivery-batches/{id}/close
```

Scoping: batches belong to an amoeba; supervisors see/manage batches whose
amoeba hosts their team; managers see their scope; admin sees all. Closing a
batch locks its counts (finance-style period discipline, lightweight).

CSV import (`customer_app_import`) is a v1.1 fast-follow using the existing
ingestion-run pattern; the manual path must not depend on it.

## 4. Surfaces

### Supervisor app (new **Deliveries** dock tab)
- Batch cards: customer, date, manifest ref, the count ladder
  (expected → received → sorted → assigned → delivered / failed / returned)
  as a progress strip with source chips, open-exception count.
- Create batch, update stage counts, assign drivers (operator + target
  count), update per-driver progress, record/resolve exceptions
  (camera-only photo optional), close batch.
- Cockpit: "Scheduled deliveries" condition card (packages left,
  exceptions); operator board gains the **On delivery** group — an operator
  with an active assignment is judged on delivery progress, not on-demand
  pace, for that day.
- Closeout checklist: the existing "Scheduled-delivery exceptions" line
  becomes live (open exceptions + unclosed batches block-with-explanation).

### Operator app (Today tab addition)
- A **Deliveries today** card when the operator has an assignment:
  "31 of 40 delivered · 2 failed" with a progress bar, batch/customer name,
  and the supervisor's target — sitting beside the platform-earnings gauge,
  each mode labelled. No self-entry in v1 (see ⚑ D1).

### Manager console
- Portfolio cards show a delivery line (batches open, packages left,
  exceptions) per team; escalation queue picks up delivery exceptions open
  past end-of-day.

## 5. Flagged decisions

- **⚑ D1 — who updates driver progress in v1?** Recommendation: supervisor
  only (matches "supervisor will have to manually enter"); operators view.
  Alternative: let operators submit their own delivered/failed counts
  (labelled `operator_manual`) with supervisor confirmation at closeout —
  faster data, small inflation risk until scanning exists.
- **⚑ D2 — leaderboard treatment of delivery days.** v1 recommendation:
  delivery assignments mark the day "on delivery" (no on-demand pace
  penalty) but delivery counts do **not** enter the Performance Score yet —
  scoring rules for mixed days deserve real data first.
- **⚑ D3 — payment linkage.** v1 records counts only; delivery earnings /
  per-package rates are out of scope until the commercial model with each
  customer is confirmed.

## 6. Future integration (Speedaf, Konga, …)

Customer APIs/webhooks become adapters that write the same count mutations
with `source=customer_api` — same batches, same screens, no workflow change.
Discrepancies between customer data and Fleximos records become supervisor
exceptions (v3 reconciliation).

## 7. Acceptance sketch

- Supervisor creates a Konga batch of 120 expected, records 118 received /
  115 sorted, assigns three drivers 40/40/35, updates progress through the
  day, records one damaged-package exception with photo, closes the batch;
  every figure shows its source chip; the operator sees their target and
  progress; the manager sees the team's delivery line; closeout reflects
  the open exception until resolved.
- All suite standards: OpenAPI, API tests, Playwright coverage both
  viewports, acceptance-script updates for supervisor + operator + manager.
