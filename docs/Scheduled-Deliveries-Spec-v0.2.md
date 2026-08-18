# Scheduled Deliveries — Spec v0.3

**Status:** Approved model (owner decisions 2 Aug 2026 folded in); build pending final go
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

- **delivery_customer** — customer_id, name, contact, notes, status,
  **contract_price_ngn** (per delivered package; differs per contract, e.g.
  Speedaf ₦1,400 — finance/manager visibility only, never shown to
  operators). Defined alongside the Uber/Bolt platform definitions in the
  admin surface, because a prescheduled customer is a revenue source of the
  same rank as a platform.
- **delivery allocated price** — a single **global** ₦ value (e.g. ₦1,000
  per delivered package) used for performance calculations and operator
  fees, versioned like the economics policies (effective-dated, admin
  Controls). This is the only delivery price operators ever see.
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
  "31 of 40 delivered · 2 failed · ₦31,000 earned" (allocated price ×
  delivered) with a progress bar and the day's delivery target value
  (allocated × assigned). Mixed days show both cards; the gauge and the
  delivery card each carry their own mode label. No self-entry in v1 (D1).

### Manager console
- Portfolio cards show a delivery line (batches open, packages left,
  exceptions) per team; escalation queue picks up delivery exceptions open
  past end-of-day.

### Admin + Finance surfaces
- **Admin (Controls / platform definitions):** delivery customers are
  created and maintained here — beside Uber/Bolt platform accounts — with
  their contract price; the global allocated price is an effective-dated
  policy under Controls, like pace/economics policies.
- **Finance console + P&L:** delivery revenue at contract price per
  customer, allocated cost line, and the contract-vs-allocated margin per
  customer; delivery revenue joins amoeba P&L.

## 5. Pricing and performance model (owner decisions, 2 Aug 2026)

- **D1 (revised, 11 Aug 2026 — rider review):** **riders record their own
  progress** (per-stop or count-level: picked up, en route, arrived,
  delivered, failed-with-mandatory-reason, POD) labelled
  `operator_manual`; the **supervisor confirms at closeout**. Supervisors
  can still enter/correct directly; customer APIs supersede both.
- **Stops (11 Aug 2026):** stop-level detail (customer, address, phone,
  parcels) is **optional per batch** — imported from a CSV/Excel manifest
  where the customer can provide one ("mixed by customer"); counts-only
  batches keep working unchanged.
- **POD (11 Aug 2026):** photo + GPS + timestamp (existing media chain)
  plus **on-screen signature capture**; no OTP in this phase.
- **Two prices per delivery:**
  - **Contract price** (per customer, e.g. Speedaf ₦1,400/package): company
    revenue = contract price × delivered. Lives on the customer record;
    finance and manager surfaces only; feeds P&L and analytics revenue.
  - **Allocated price** (global, e.g. ₦1,000/package): operator-facing
    value = allocated × delivered. Feeds the operator's earnings gauge,
    daily target (assigned × allocated), the leaderboard earnings
    component, and operator fee calculations. Operators never see contract
    prices; the spread is company margin and is visible in P&L as
    contract-vs-allocated variance.
- **D2 (resolved by the allocated price):** delivery days score like
  on-demand days — earnings (allocated × delivered) vs target
  (allocated × assigned). No leaderboard special-casing; the "on delivery"
  board state only suspends *intraday on-demand pace* judgement, not
  scoring.
- **Fee payout mechanics** (how much of the allocated value the operator is
  actually paid, payroll timing) remain out of scope for this slice — the
  slice exposes the allocated earnings figures those calculations will use.

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
