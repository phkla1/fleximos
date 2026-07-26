# Supervisor App Frontend Brief

**Status:** Draft for developer review  
**Related spec:** `docs/NEW-Fleximotion-Ops-Spec-v0.4.md`  
**Audience:** Fleximos frontend/backend developers building the next supervisor experience

## Summary

Build the Supervisor app as an **Amoeba Control Room**: a mobile-first field-operations cockpit for the amoeba owner. The supervisor's job is not to manually report upward; Fleximos already gives managers and finance their own dashboards. The supervisor's job is to keep operators, vehicles, fuel, batteries, cash, incidents, and deliveries moving during the operating day.

The visual language should carry the same vehicle/traffic design ethos planned for the operator app: red/yellow/green status logic, circular gauges, battery-style counters, speedometer/fuel-gauge metaphors, alert-light treatment, and large touch targets.

## Product Principles

- **Action first:** The first screen should answer: "What needs my action now?"
- **Operating rhythm:** Morning readiness, midday pace, 4pm pace, 7pm pace, closeout.
- **Grouped before detailed:** Show condition groups first, then drill down to operator, vehicle, package, or alert detail.
- **No developer jargon:** Do not show API IDs, ingestion IDs, or connector internals to supervisors.
- **Supervisor equals Amoeba owner:** The app is scoped to the supervisor's assigned amoeba/team.
- **Generic scheduled-delivery support:** Support customer package-delivery operations without assuming one customer, one scanning app, or one integration pattern.

## Core Screens

### 1. Today Cockpit

The default landing screen.

Show:

- Active operators.
- Live operators.
- Operators not seen today.
- Operators offline after already coming online.
- Net Earnings pace, split by cars and bikes.
- Scheduled-delivery progress.
- Open critical alerts.
- Fuel, battery, and mileage risk.
- Overdue inspections.
- Closeout readiness.

Design:

- Use red/yellow/green cockpit cards.
- Use gauges for Net Earnings pace, utilisation, fuel/battery, and closeout readiness.
- Surface the top 3 supervisor actions prominently.

### 2. Operator Board

Default view should be grouped by state, not a flat list.

Groups:

- Not seen today.
- Late resumption.
- Online and on track.
- Online but behind pace.
- Offline after coming online.
- On delivery.
- Open alert.
- Fuel or battery risk.
- Inspection/vehicle issue.

Operator row/tile should show:

- Name.
- Vehicle.
- Vehicle type: car or bike.
- Current work state.
- Net Earnings pace.
- Online time.
- Trips/orders.
- Acceptance/rejection signal where available.
- Open alert count.
- Tap to open operator detail.

### 3. Operator Detail

Show:

- Today's timeline.
- Net Earnings against target.
- Online/resumption history.
- Current platform/account.
- Vehicle and inspection status.
- Fuel/battery issue status.
- Mileage since last fuel/charge issue.
- Active alerts and deviation reasons.
- Recent incidents and maintenance reports.

Actions:

- Call operator.
- Send nudge/message.
- Record note.
- Acknowledge or resolve alert.
- Accept or reject deviation reason.
- Escalate to manager.
- Mark operator unavailable.
- Suspend Fleximos operator access, where policy allows.

### 4. Alert Queue

Show grouped alert conditions first.

Examples:

- 5 of 18 operators not seen today.
- 3 operators behind Net Earnings pace.
- 2 vehicles have overdue inspections.
- 1 suspected fuel/mileage exception.
- 1 operator offline during delivery.

Each group opens to affected operators and individual alert records.

Actions:

- Acknowledge.
- Comment.
- Snooze.
- Resolve.
- Escalate to manager.
- Quick dial.
- Accept/reject operator explanation.

### 5. Readiness Checks

Use a combined operator + supervisor model.

Operator submits self-check from the operator app:

- Vehicle condition.
- Battery/fuel level.
- Phone charged.
- Network/data/airtime available.
- Helmet and safety kit available.
- Handsfree set available.
- Photo proof where required.

Supervisor app shows:

- Who has submitted.
- Who has not submitted.
- Failed readiness items.
- Items needing supervisor spot-check.
- Readiness compliance gauge.

Supervisor should review exceptions rather than manually entering every check.

### 6. Fuel, Battery, and Mileage

Show:

- Fuel or charge issued today.
- Mileage since last fuel/charge issue.
- Expected distance.
- Platform official distance.
- Tracker distance where available.
- Fuel-efficiency variance.
- Unexplained mileage variance.
- Tracker unavailable status, especially for bikes.

Actions:

- Confirm fuel/charge issue.
- Add note.
- Accept explanation.
- Escalate suspicious variance.

### 7. Scheduled Deliveries

Support customer delivery operations generically:

`Customer drop-off -> manifest/count -> sort -> scan/manual record -> assign -> dispatch -> deliver -> proof/exception -> returns`

Show:

- Customer/batch.
- Expected package count.
- Received package count.
- Sorted count.
- Assigned count.
- Out-for-delivery count.
- Delivered count.
- Failed/exception count.
- Returned count.
- Operators assigned.
- Packages or stops still open.

Actions:

- Create delivery batch.
- Import/upload manifest where available.
- Manually enter received/scanned counts.
- Assign package group or route to operator.
- Record exception.
- View proof of delivery.
- Mark returns received.

### 8. Inspections and Maintenance

Show:

- 48-hour vehicle inspection compliance.
- Vehicles overdue.
- Recent inspection submissions.
- Maintenance queue.
- Repairs in progress.
- Vehicles not available for work.

Actions:

- Submit inspection.
- Add photo evidence.
- Report maintenance issue.
- Update issue status.
- Escalate serious vehicle risk.

### 9. Daily Closeout

Closeout should be a structured checklist, not a free-form report.

Supervisor reviews:

- Unresolved alerts.
- Cash/remittance issues.
- Fuel/mileage exceptions.
- Incidents.
- Scheduled-delivery exceptions.
- Vehicle return status.
- Maintenance blockers.
- Amoeba summary.

Submit:

- Optional supervisor note.
- Timestamped supervisor submission.
- Manager sees missing/incomplete closeouts separately in the manager console.

## Customer-Driven Scanning Recommendation

Fleximos should not depend on every customer having a usable API. Scheduled-delivery scanning should support three modes.

### Mode 1: Customer App Mode

Use when the customer requires their own scanning app.

Fleximos records batch-level control data:

- Customer.
- Manifest/date.
- Expected package count.
- Received count.
- Assigned operators.
- Delivered count.
- Failed count.
- Returned count.
- Exception notes.

If the customer has no API, the supervisor manually enters counts or uploads a CSV/export from the customer system.

Source labels:

- `customer_app_manual`
- `customer_app_import`
- `customer_api`

Important UI rule: clearly label this as customer-source or manually reconciled data so nobody mistakes it for Fleximos scan truth.

### Mode 2: Fleximos Scan Mode

Use when Fleximos controls scanning.

The operator app should later include barcode/QR scanning with offline queueing.

Scan events:

- Received at depot.
- Sorted.
- Loaded to operator.
- Delivery attempted.
- Delivered.
- Failed.
- Returned.

Each scan event should capture:

- Package ID.
- Batch ID.
- Customer ID.
- Operator ID where assigned.
- Event type.
- Timestamp.
- GPS where available.
- Source app.
- Proof media where relevant.

Source label:

- `fleximos_scan`

### Mode 3: Hybrid/Reconciliation Mode

Use when both customer app data and Fleximos scan data exist.

Fleximos compares:

- Expected versus received.
- Received versus sorted.
- Sorted versus assigned.
- Assigned versus delivered.
- Delivered/failed/returned versus customer records.

Differences become supervisor exceptions.

Recommendation:

- Build v1 so manual/customer counts work immediately.
- Design the data model so Fleximos scan events can be added later without changing the supervisor workflow.
- Treat customer API integration as an accelerator, not a dependency.

## Field Control Policy

Supervisors should have strong field controls, but dangerous or third-party-dependent actions need guardrails.

Immediate supervisor actions:

- Call operator.
- Send nudge/message.
- Record note.
- Confirm readiness.
- Confirm fuel or charging support.
- Acknowledge, snooze, resolve, or escalate alerts.
- Assign scheduled-delivery work.
- Mark delivery exception.
- Submit inspection.
- Report maintenance issue.

Restricted actions:

- Suspend operator access to Fleximos.
- Mark operator unavailable.
- Request platform suspension.
- Request vehicle immobilisation.

Emergency action:

- If theft, serious safety risk, or suspected asset loss is reported, supervisor can trigger an urgent immobilisation/deactivation request.
- The action must create a critical manager-visible event with timestamp, actor, reason, GPS/context where available, and audit trail.
- Where actual immobilisation depends on a third-party API, the UI must show the true state: requested, pending, succeeded, failed, or unavailable.

Important copy rule:

- Do not imply Fleximos can suspend Uber/Bolt work unless that platform action has actually succeeded.
- Use labels such as "Fleximos access suspended", "Platform suspension pending", or "Immobiliser request sent".

## Design Requirements

- Mobile-first.
- Must work at 320px without horizontal scrolling.
- Large touch targets.
- Red/yellow/green status language:
  - Green: clear, safe, on track.
  - Yellow: watch, pending, approaching threshold.
  - Red: action required, unsafe, leaking, overdue.
- Use circular gauges for pace, readiness, utilisation, fuel/battery, and closeout readiness.
- Use digital percentage counters for battery/fuel-style readings.
- Prefer visual grouping over long text-heavy lists.
- Use plain supervisor-facing language:
  - "Call rider"
  - "Behind pace"
  - "Fuel risk"
  - "Packages left"
  - "Closeout blocked"
  - "Needs inspection"

## Data and API Notes

The frontend should consume existing Ops APIs where possible:

- Operators and assignments.
- Team board.
- Alerts.
- Daily performance.
- Fuel issues.
- Mileage reconciliations.
- Incidents.
- Inspections.
- Maintenance reports.
- Closeouts.
- Leaderboard/operator performance where supervisor-visible.

Likely new or extended APIs for scheduled deliveries:

- Delivery customers.
- Delivery batches/manifests.
- Package records.
- Scan/manual count events.
- Route/operator assignments.
- Delivery exceptions.
- Proof of delivery records.

All mutation APIs must follow Fleximos suite rules:

- Bearer auth.
- Scoped role access.
- `Idempotency-Key` on mutations.
- Audit trail for state changes.
- Offline-safe queueing where the supervisor or operator app may lose connectivity.

## Acceptance Checks

- A supervisor can open the app and understand the top 3 required actions within 10 seconds.
- The first screen is useful without scrolling on a modern phone.
- The app does not default to raw operator, alert, vehicle, or package tables.
- Morning readiness, live operations, scheduled deliveries, fuel/mileage, alerts, inspections, and closeout are represented as one operating day.
- Scheduled delivery works when the customer has no API.
- Customer-driven scan data is clearly labelled as manual/imported/customer-source.
- Fleximos-owned scan events can be added later without redesigning the whole workflow.
- Critical actions such as immobilisation are audited and stateful.
- No API/connector/internal IDs are visible to supervisors by default.
