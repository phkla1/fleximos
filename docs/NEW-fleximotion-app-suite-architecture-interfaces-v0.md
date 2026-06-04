# Fleximotion App Suite Architecture and Interfaces

**Version:** v0 working draft  
**Status:** Architecture guide for developer alignment  
**Last updated:** 28 May 2026  
**Audience:** Founders, product owners, engineers, vendors, and future integration builders

---

## 1. Purpose

Fleximotion is migrating from Google-Sheets-oriented operating tools into an API-first app suite. This document defines the boundaries between the major product surfaces and backend domains so that each development team can build without duplicating functionality or creating circular dependencies.

The immediate product vision has **three user-facing systems**:

1. **HR / Recruitment System**
2. **Ops App**
3. **Work Management System**, also called the **TMS**

These are three frontends or product surfaces, not necessarily three monolithic backends. The backend architecture should be split into small domain APIs where that improves clarity, ownership, and delivery speed.

This document exists to answer:

- Which system owns each data element?
- Which systems are allowed to read or write it?
- What events and APIs connect the systems?
- What dependency loops must be avoided?
- What should be built first?

---

## 2. Core Architectural Principles

### 2.1 API First

Every backend capability must be available through a documented API. A frontend is just one API client, not a privileged bypass path.

Each API should expose:

- Versioned endpoints, starting at `/v1`.
- OpenAPI documentation.
- Service-to-service authentication.
- Human-user authentication where applicable.
- Idempotency support for mutations.
- Structured error responses.
- Audit history for important state changes.
- Webhooks or an event feed for important domain events.

### 2.2 Single Source of Truth

Every important entity has exactly one owning domain. Other systems may cache projections for display or reporting, but cached fields are not canonical.

Example: Ops may display a person's name, phone number, and hiring/onboarding status, but Identity remains canonical for the basic person record and HR remains canonical for the recruitment/personnel lifecycle. Ops is canonical only for the operator's operational status, vehicle assignment, platform accounts, daily activity, alerts, cash, and P&L.

### 2.3 Frontends Compose; Backends Own

A frontend may call multiple APIs to render a complete workflow. That is expected.

Backend services should not blur ownership. A backend may read from another domain, subscribe to its events, or store a local projection, but it should not mutate another domain's data except through that domain's public API.

### 2.4 Avoid Runtime Circular Dependencies

A dependency is acceptable if System A can continue to perform its own canonical write without waiting on System B to do a reciprocal write.

Bad loop:

> HR cannot mark a person ready for Ops until Ops has created the operator, but Ops cannot create the operator until HR marks the person ready.

Good handoff:

> HR approves the person and emits `personnel.ready_for_ops_onboarding`. Ops consumes that event, creates the operator, and later emits `operator.activated`.

### 2.5 Events Are Notifications, APIs Are Authority

Events tell other systems that something happened. APIs remain the authoritative way to fetch current state.

Webhook delivery should be at least once. Consumers must handle duplicates using event IDs and idempotency keys.

---

## 3. Product Surfaces

The app suite has three main user-facing frontends.

### 3.1 HR / Recruitment Frontend

Primary users:

- HR staff
- Admins
- Managers
- Verification officers
- Prospects, for minimal training/test flows

Primary jobs:

- Manage the prospect funnel.
- Import and create prospects.
- Run presentation, preverification, platform-check, verification, training, test, approval, contract, and special-request workflows.
- Produce recruitment and funnel reports.
- Hand approved personnel to Ops for onboarding.

### 3.2 Ops Frontend

Primary users:

- Managers
- Supervisors
- Operators
- Operations admins

Primary jobs:

- Replace the current daily report and operator monitoring Google-Sheets-oriented systems.
- Monitor live operator behavior.
- Manage daily operator activity, alerts, acknowledgements, escalations, cash, vehicle return, platform activity, and P&L.
- Own the operational record after a person becomes an operator.

### 3.3 TMS Frontend

Primary users:

- Founders and management
- Team coordinators
- Admin personnel
- Amoeba members

Primary jobs:

- Manage internal work, backlog, learning, substrates, points, transfer pricing, and governance rituals.
- Track management work and continuous learning.
- Read operational performance from Ops, but not compute the canonical operational metrics.

---

## 4. Domain APIs

The three frontends should be backed by five domain APIs. These may be implemented as separate services, modules inside a shared backend, or a hybrid. The important rule is that the domain ownership boundary remains clear.

### 4.1 Identity API

**Owns:**

- Canonical `person_id`
- Human user accounts
- Authentication identities
- Basic contact profile
- Global account status
- Service accounts and API tokens
- System-level roles needed across products

**Does not own:**

- Recruitment funnel status
- Operator status
- Vehicle assignment
- Amoeba definition
- TMS membership rules
- Payroll or detailed contract records, unless explicitly merged into HR later

**Consumed by:**

- HR / Recruitment
- Ops
- TMS
- All frontends

The Identity API may begin as part of the HR backend, but its contract should be treated as a platform-level contract because every app will depend on stable person and user identity.

### 4.2 Amoeba API

**Owner domain:** TMS

**Owns:**

- Amoeba definitions
- Amoeba classification: operating, shared-services, investment
- Amoeba hierarchy and parentage
- Team coordinator assignment
- Amoeba lifecycle and reclassification history

**Does not own:**

- Operator assignment to amoeba for daily operations
- HR employment records
- Operational P&L calculation
- Recruitment funnel counts

**Consumed by:**

- Ops, to label operators, vehicles, alerts, daily performance, and P&L
- HR / Recruitment, to route prospects/personnel and report hiring pipeline by amoeba
- TMS, as the native owner and management surface

The Amoeba API can be implemented inside the TMS backend but should have a clean public API because Ops and HR both need it.

### 4.3 HR / Recruitment API

**Owns:**

- Prospects
- Prospect lifecycle states and funnel stages
- Prospect biodata before conversion to personnel/person
- Recruitment and onboarding lifecycle for candidates/personnel
- Recruitment sources
- File imports and possible prospects
- Duplicate detection and duplicate resolution
- Presentation sessions
- HR preverification
- Manual platform checks during recruitment
- Physical verification cases
- Training sessions and tests
- Hiring approvals
- Special requests during recruitment or personnel onboarding
- Contract templates and generated contracts
- Signed contract upload records
- Recruitment reporting

**Does not own:**

- Operators after handoff to Ops
- Vehicles
- Platform accounts used in live operations
- Daily revenue, trips, online time, alerts, cash, P&L
- Amoeba definitions
- TMS tasks, learning, or points

### 4.4 Ops API

**Owns:**

- Operators as operational actors
- Operator operational status
- Operator-to-amoeba assignment for daily operations
- Supervisory assignment for field operations
- Vehicles
- Vehicle assignment and return
- Platform accounts and external platform IDs
- Bolt, Uber, Chowdeck, and future operational integrations
- Daily activity: trips, hours, revenue, cancellations, acceptance, completion, wait time
- Live and historical alerts
- Alert acknowledgement, resolution, escalation, and notes
- Cash expectation, remittance, receipts, shortage, overage
- Operational notes
- Tracker reconciliation
- Daily, weekly, and monthly operational reporting
- P&L by amoeba
- HE, utilisation, RUG inputs, and other operational KPIs

**Does not own:**

- Candidate funnel
- HR documents and contracts
- Canonical person identity
- Amoeba definition
- TMS backlog, learning, points, or transfer-price rules

Ops is the replacement for the current daily report automation and operator monitoring system.

### 4.5 TMS API

**Owns:**

- Backlog items
- Learning entries
- Substrates
- Substrate revisions
- Points
- Transfer price rules
- Transfer price events
- Governance views
- Amoeba definitions, via the Amoeba API
- Amoeba management classification and coordinator assignments

**Does not own:**

- Operators
- Vehicles
- Platform accounts
- Daily operational activity
- HR records
- Recruitment funnel
- Contracts
- Canonical P&L or HE calculation

The TMS may read HE, utilisation, revenue, expenses, active operator count, and other operational KPIs from Ops. It may publish transfer-price events to Ops. Ops remains the canonical calculator of P&L and HE.

---

## 5. Canonical Entity Ownership

| Entity or Data Element | Canonical Owner | Notes |
|---|---|---|
| Person identity | Identity API | Stable human identity across systems. |
| User login account | Identity API | Human login, service accounts, auth. |
| Prospect | HR / Recruitment API | Candidate before operational onboarding. |
| Prospect funnel state | HR / Recruitment API | Includes stage history and recruitment lifecycle events. |
| Candidate documents | HR / Recruitment API | Licenses, IDs, guarantor forms, request letters, verification documents. |
| Recruitment duplicate status | HR / Recruitment API | Duplicate handling before onboarding. |
| Physical verification case | HR / Recruitment API | Verification of candidate/personnel during recruitment. |
| Hiring approval | HR / Recruitment API | Manager approval for hire. |
| Contract template and generated contract | HR / Recruitment API | Contract generation and signed-copy record. |
| Operator | Ops API | Operational actor linked to `person_id`. |
| Operator status | Ops API | Active, inactive, terminated for operational monitoring purposes. |
| Vehicle | Ops API | Vehicle identity, assignment, return, tracker linkage. |
| Platform account | Ops API | Bolt/Uber/Chowdeck account identifiers and operational integration metadata. |
| Daily trips, revenue, hours | Ops API | Pulled from platform APIs and operational records. |
| Alert | Ops API | Operational alert and action workflow. |
| Cash remittance | Ops API | Expected cash, actual cash, shortage/overage, receipts. |
| Operational P&L | Ops API | Includes transfer-price events received from TMS. |
| HE and utilisation | Ops API | TMS reads these; Ops computes them. |
| Amoeba definition | TMS / Amoeba API | Used by HR and Ops as a reference. |
| Team coordinator | TMS / Amoeba API | Management role for amoeba governance. |
| Operator-to-amoeba assignment | Ops API | Operational assignment to an amoeba. References Amoeba API. |
| Staff/person-to-amoeba association | HR projection | HR may store employment/team metadata, but canonical amoeba definition remains TMS-owned. |
| TMS member | TMS API | Lightweight management-system participant linked to `person_id`. |
| Backlog item | TMS API | Management work item. |
| Learning entry | TMS API | Insight and learning workflow. |
| Substrate | TMS API | Durable artifact where learning lands. |
| Points award | TMS API | Contribution ledger. |
| Transfer price rule | TMS API | Rule for internal charges. |
| Transfer price event | TMS API creates; Ops consumes | TMS owns event creation; Ops owns P&L impact. |

---

## 6. Identity Model

The suite should distinguish related but different identities.

### 6.1 Person

Canonical human identity.

Owned by Identity API.

Typical fields:

- `person_id`
- legal name
- display name
- phone
- email
- date of birth, if needed
- global account status
- created timestamp
- updated timestamp

### 6.2 Prospect

Candidate in the recruitment funnel.

Owned by HR / Recruitment API.

Typical fields:

- `prospect_id`
- optional `person_id`, once linked or converted
- prospect type
- source
- current recruitment stage
- duplicate status
- HR owner
- recruitment metadata

### 6.3 Operator

Operational actor in the fleet.

Owned by Ops API.

Typical fields:

- `operator_id`
- `person_id`
- operator type: driver, rider, courier, future categories
- operational status
- assigned amoeba ID
- assigned supervisor person ID
- platform account references
- vehicle assignment
- daily target metadata

### 6.4 TMS Member

Participant in the work management system.

Owned by TMS API.

Typical fields:

- `member_id`
- `person_id`
- amoeba ID
- TMS role
- coordinator status, if applicable
- points visibility rules

---

## 7. Core Inter-System Flows

### 7.1 Recruitment to Operations Handoff

This flow prevents HR/Ops circular dependency.

1. HR creates and manages a `prospect`.
2. HR completes presentation, preverification, platform checks, physical verification, training/test, management approval, and contract workflow as configured.
3. HR links or creates a canonical `person_id`.
4. HR emits `personnel.ready_for_ops_onboarding`.
5. Ops consumes the event or receives a direct API call.
6. Ops creates an `operator` linked to `person_id`.
7. Ops assigns amoeba, supervisor, vehicle, and platform accounts.
8. Ops emits `operator.created`.
9. When operationally active, Ops emits `operator.activated`.
10. HR may display the Ops activation status, but HR does not own it.

### 7.2 Operations Performance to TMS

1. Ops computes canonical operational KPIs: revenue, utilisation, HE, active operators, expenses, P&L.
2. TMS periodically reads performance snapshots from Ops.
3. TMS stores refreshable snapshots for trajectory, dashboards, and points calculations.
4. TMS does not recompute canonical HE or P&L.

### 7.3 Transfer Pricing from TMS to Ops

This flow prevents TMS/Ops P&L divergence.

1. TMS owns transfer price rules.
2. TMS creates `transfer_price_event` when cross-amoeba work or recurring service charges occur.
3. TMS publishes the event to Ops through `POST /v1/transfer-price-events`.
4. Ops records the event as an input to P&L.
5. Ops computes P&L and HE including transfer-price effects.
6. TMS later reads HE/P&L from Ops.

Important rule: TMS must be able to create and queue a transfer-price event even if Ops is temporarily unavailable. Publication retries are required.

### 7.4 Operational Learning to TMS

1. Ops records supervisor notes, incidents, alert resolutions, and operational exceptions.
2. A manager or supervisor decides that an operational event produced a learning.
3. The TMS creates a `learning_entry`, optionally linking to the Ops event URL or ID in free-form metadata.
4. The TMS owns the learning workflow through backlog item, substrate revision, approval, and closure.
5. Ops does not own learning closure.

### 7.5 Amoeba Reference Usage

1. TMS / Amoeba API owns amoeba definitions.
2. HR reads amoebas to route prospects and report funnel counts.
3. Ops reads amoebas to assign operators, vehicles, alerts, cash, and P&L.
4. TMS reads/writes amoebas natively.
5. If an amoeba is renamed or reclassified, downstream systems update display projections through API refresh or event subscription.

---

## 8. API Interface Sketch

This is not a final OpenAPI spec. It defines the minimum interfaces each system should expect.

### 8.1 Identity API

```http
GET    /v1/people
POST   /v1/people
GET    /v1/people/{person_id}
PATCH  /v1/people/{person_id}

GET    /v1/users
POST   /v1/users
GET    /v1/users/{user_id}
PATCH  /v1/users/{user_id}

POST   /v1/auth/login
POST   /v1/auth/logout
POST   /v1/auth/refresh
GET    /v1/me

GET    /v1/service-accounts
POST   /v1/service-accounts
POST   /v1/service-accounts/{id}/tokens
DELETE /v1/service-accounts/{id}/tokens/{token_id}
```

### 8.2 Amoeba API

```http
GET    /v1/amoebas
POST   /v1/amoebas
GET    /v1/amoebas/{amoeba_id}
PATCH  /v1/amoebas/{amoeba_id}
GET    /v1/amoebas/{amoeba_id}/history

POST   /v1/amoebas/{amoeba_id}/classify
POST   /v1/amoebas/{amoeba_id}/assign-coordinator
GET    /v1/amoebas/{amoeba_id}/performance-sources
```

### 8.3 HR / Recruitment API

Core interfaces are already sketched in the HR funnel spec. Minimum cross-system interfaces:

```http
GET    /v1/prospects
POST   /v1/prospects
GET    /v1/prospects/{prospect_id}
PATCH  /v1/prospects/{prospect_id}
GET    /v1/prospects/{prospect_id}/timeline
POST   /v1/prospects/{prospect_id}/transition

POST   /v1/referrals
GET    /v1/referrals

GET    /v1/approvals/hiring
POST   /v1/approvals/hiring/{approval_id}/approve
POST   /v1/approvals/hiring/{approval_id}/reject
POST   /v1/approvals/hiring/{approval_id}/hold

POST   /v1/prospects/{prospect_id}/create-or-link-person
POST   /v1/prospects/{prospect_id}/ready-for-ops-onboarding
GET    /v1/personnel/{person_id}/recruitment-summary
```

### 8.4 Ops API

```http
GET    /v1/operators
POST   /v1/operators
GET    /v1/operators/{operator_id}
PATCH  /v1/operators/{operator_id}
POST   /v1/operators/{operator_id}/activate
POST   /v1/operators/{operator_id}/deactivate

GET    /v1/vehicles
POST   /v1/vehicles
GET    /v1/vehicles/{vehicle_id}
PATCH  /v1/vehicles/{vehicle_id}
POST   /v1/vehicles/{vehicle_id}/assign
POST   /v1/vehicles/{vehicle_id}/return

GET    /v1/operators/{operator_id}/daily-activity
GET    /v1/amoebas/{amoeba_id}/performance
GET    /v1/amoebas/{amoeba_id}/pnl
GET    /v1/company/rug

GET    /v1/alerts
GET    /v1/alerts/{alert_id}
POST   /v1/alerts/{alert_id}/acknowledge
POST   /v1/alerts/{alert_id}/resolve
POST   /v1/alerts/{alert_id}/escalate

GET    /v1/cash-remittances
POST   /v1/cash-remittances
PATCH  /v1/cash-remittances/{remittance_id}

POST   /v1/transfer-price-events
GET    /v1/transfer-price-events
```

### 8.5 TMS API

Core interfaces are already sketched in the TMS spec. Minimum cross-system interfaces:

```http
GET    /v1/backlog-items
POST   /v1/backlog-items
GET    /v1/backlog-items/{id}
PATCH  /v1/backlog-items/{id}
POST   /v1/backlog-items/{id}/accept
POST   /v1/backlog-items/{id}/pull
POST   /v1/backlog-items/{id}/complete

GET    /v1/learning-entries
POST   /v1/learning-entries
POST   /v1/learning-entries/{id}/land

GET    /v1/substrates
POST   /v1/substrates
POST   /v1/substrate-revisions
POST   /v1/substrate-revisions/{id}/approve

GET    /v1/transfer-price-rules
POST   /v1/transfer-price-rules
GET    /v1/transfer-price-events
POST   /v1/transfer-price-events
POST   /v1/transfer-price-events/{id}/publish-to-ops

GET    /v1/points-awards
GET    /v1/members
POST   /v1/members
```

---

## 9. Event Catalog

Events should include:

- `event_id`
- `event_type`
- `occurred_at`
- `source_system`
- `schema_version`
- `idempotency_key`, where relevant
- `data`

### 9.1 Identity Events

- `person.created`
- `person.updated`
- `user.created`
- `user.deactivated`
- `service_account.token_revoked`

### 9.2 Amoeba Events

- `amoeba.created`
- `amoeba.updated`
- `amoeba.classification_changed`
- `amoeba.coordinator_assigned`
- `amoeba.archived`

### 9.3 HR / Recruitment Events

- `prospect.created`
- `prospect.stage_changed`
- `prospect.duplicate_flagged`
- `prospect.duplicate_resolved`
- `verification_case.created`
- `verification_case.completed`
- `training_test.passed`
- `hiring_approval.approved`
- `hiring_approval.rejected`
- `contract.generated`
- `contract.signed_copy_uploaded`
- `personnel.ready_for_ops_onboarding`

### 9.4 Ops Events

- `operator.created`
- `operator.activated`
- `operator.deactivated`
- `operator.amoeba_assigned`
- `operator.supervisor_assigned`
- `vehicle.created`
- `vehicle.assigned`
- `vehicle.returned`
- `daily_activity.recorded`
- `alert.created`
- `alert.acknowledged`
- `alert.resolved`
- `alert.escalated`
- `cash_remittance.recorded`
- `cash_remittance.approved`
- `amoeba_performance.updated`

### 9.5 TMS Events

- `backlog_item.created`
- `backlog_item.accepted`
- `backlog_item.completed`
- `learning_entry.created`
- `learning_entry.landed`
- `substrate_revision.created`
- `substrate_revision.approved`
- `points_award.issued`
- `transfer_price_event.created`
- `transfer_price_event.published_to_ops`

---

## 10. Dependency Rules

### 10.1 Allowed Dependencies

| Caller | May Read From | May Write To | Notes |
|---|---|---|---|
| HR / Recruitment | Identity, Amoeba, limited Ops status | Identity for person creation/linking; Ops onboarding handoff | HR writes Ops only through explicit handoff endpoint/event. |
| Ops | Identity, Amoeba, HR onboarding summary | Ops only; accepts TMS transfer price events | Ops should not mutate HR contracts or TMS tasks. |
| TMS | Identity, Amoeba, Ops performance | TMS; Ops transfer-price event endpoint | TMS does not compute canonical Ops metrics. |
| Identity | None required | Identity | Should be foundational and low-dependency. |
| Amoeba | Identity for coordinator person display | Amoeba | Avoid dependence on Ops performance for core amoeba writes. |

### 10.2 Forbidden or Discouraged Dependencies

- HR must not own operator daily activity, platform accounts, cash, alerts, or vehicle assignment.
- Ops must not own candidate funnel states, contracts, physical verification records, or HR approval rules.
- TMS must not own operators, vehicles, platform integrations, cash, or canonical P&L.
- Ops must not require TMS to compute P&L. Ops can consume transfer-price events, but Ops owns the final P&L calculation.
- HR must not wait for Ops activation before completing HR approval. HR can show Ops activation as downstream status.
- TMS must not require current Ops HE before creating a transfer-price event.
- Frontends must not write directly to another system's database.
- No system should rely on Google Sheets as the operational source of truth after cutover. Sheets may remain generated reporting exports.

---

## 11. Circular Dependency Breakers

### 11.1 HR to Ops Onboarding

**Risk:** HR needs Ops to mark someone active; Ops needs HR to approve them.

**Breaker:** HR emits `personnel.ready_for_ops_onboarding`. Ops independently creates and activates the operator. HR displays Ops activation but does not own it.

### 11.2 TMS to Ops Transfer Pricing

**Risk:** TMS needs Ops P&L; Ops needs TMS transfer events.

**Breaker:** TMS creates transfer events without requiring Ops P&L. Ops consumes them and computes P&L. TMS reads computed P&L later.

### 11.3 Amoeba Data

**Risk:** HR, Ops, and TMS all need amoebas, causing duplicate definitions.

**Breaker:** TMS / Amoeba API owns definitions. HR and Ops reference amoeba IDs.

### 11.4 Supervisor and Coordinator Roles

**Risk:** HR, Ops, and TMS all define leadership differently.

**Breaker:**

- HR owns employment role: supervisor, manager, accountant, HR officer.
- Ops owns field supervision assignment: operator to supervisor.
- TMS owns management coordinator assignment: amoeba to team coordinator.

### 11.5 Candidate Platform Checks vs Operational Platform Accounts

**Risk:** HR checks Uber/Bolt during recruitment; Ops owns platform integrations.

**Breaker:** HR owns manual recruitment checks and their evidence. Ops owns live platform accounts and API integrations after onboarding. HR checks do not create operational platform accounts.

---

## 12. Reporting Boundaries

Each system owns its own reporting domain.

### 12.1 HR / Recruitment Reports

- Funnel counts
- Stage conversion
- Stage aging
- Source quality
- Duplicate rate
- Verification turnaround
- Training/test performance
- Hiring approvals
- Contract completion

### 12.2 Ops Reports

- Daily operator performance
- Trips, revenue, cancellations, acceptance, completion
- Online/offline behavior
- Alerts and resolutions
- Cash remittance and shortages
- Vehicle return and tracker coverage
- Amoeba P&L
- HE and utilisation
- RUG operational inputs

### 12.3 TMS Reports

- Backlog throughput
- Pull vs push ratio
- Learning entries landed
- Substrate revisions
- Points awards
- Transfer price events
- Governance exceptions
- Trajectory from Ops snapshots

### 12.4 Cross-Suite Reporting

Cross-suite dashboards may exist, but they should read from APIs or an analytics warehouse. They should not become hidden sources of truth.

Recommended future pattern:

- Domain APIs publish data/events.
- Analytics warehouse ingests read-only copies.
- Metabase or another BI layer reads the warehouse.
- Operational writes still go back through the owning API.

---

## 13. Migration from Google Sheets

The current Google Sheets-oriented systems should be treated as legacy operational surfaces.

### 13.1 Current Sources

- Daily report workbook/sheet: operator daily data, rider info, amoeba summary, and some funnel-like data.
- Operator alert config workbook/sheet: operators, supervisors, managers, amoebas/offices, metadata.

### 13.2 Migration Strategy

1. Freeze the canonical ownership model in this document.
2. Build importers that read the current sheets into the owning APIs.
3. Do not preserve sheet tab structure as application structure.
4. Preserve legacy IDs or row references in `legacy_source` metadata fields where useful.
5. Keep Google Sheets as generated exports during transition.
6. Stop allowing direct Google Sheet edits once equivalent app workflows are live.

### 13.3 Sheet-to-Domain Mapping

| Legacy Sheet Area | New Owner |
|---|---|
| Rider Daily Data | Ops |
| Operator Info | Split: Identity for person basics, Ops for operator records, Amoeba API for amoeba references |
| Amoeba Daily Summary | Ops |
| Alert Operators tab | Ops |
| Alert Supervisors/Managers tabs | Identity for person basics, Ops for field routing |
| Alert Amoebas/Offices tab | Amoeba API for amoeba, Ops for office GPS/alert radius if operational |
| Funnel tab | HR / Recruitment |

---

## 14. Build Sequence

The sequencing should minimize dependency loops while replacing the highest-pain operational systems early.

### Phase 0: Contract Foundation

Deliver:

- This architecture document agreed and versioned.
- Shared ID conventions.
- Initial OpenAPI skeletons.
- Auth/service-token strategy.
- Event envelope standard.
- Decision on deployment topology.

### Phase 1: Identity and Amoeba Foundation

Deliver:

- Minimal Identity API: people, users, auth/service tokens.
- Minimal Amoeba API: amoeba definitions, classifications, coordinator assignment.
- Seed initial amoebas: Island, Mainland, Central.
- Seed initial personnel/users required for Ops and TMS.

This phase can be implemented inside one backend if necessary, but the public contracts should remain distinct.

### Phase 2: Ops App

Deliver:

- Operator registry.
- Vehicle registry.
- Platform account registry.
- Bolt/Uber connector consolidation.
- Daily activity ingestion and reporting.
- Alert engine and alert resolution workflow.
- Cash/remittance workflow.
- Amoeba P&L and HE.
- Replacement of current daily report and operator monitoring Google Sheets as operational inputs.

Ops should be prioritized because it replaces live operational systems and becomes the source of performance data required by TMS.

### Phase 3: HR / Recruitment System

Deliver:

- Prospect database.
- Intake/import/referral flow.
- Duplicate handling.
- Presentation and preverification.
- Platform checks as recruitment evidence.
- Physical verification.
- Training/test.
- Hiring approval.
- Contract generation.
- `personnel.ready_for_ops_onboarding` handoff.

If recruitment pressure is high, a thin HR onboarding handoff can be built earlier, before the full funnel dashboard.

### Phase 4: TMS

Deliver:

- Backlog, learning, substrates, substrate revisions.
- TMS members.
- Transfer price rules/events.
- Publication of transfer-price events to Ops.
- Performance snapshots from Ops.
- Points ledger, initially disabled until management tunes multipliers.
- Governance views.

TMS can start earlier in standalone mode for tasks and learning, but its HE, trajectory, pool points, and transfer-pricing value depend on Ops being available.

### Phase 5: Cross-Suite Analytics and Automation

Deliver:

- Unified reporting/warehouse.
- More automation around platform checks, outreach, OCR, notifications, and recommendations.
- Stronger mobile/PWA capabilities.
- Advanced event-driven workflows.

---

## 15. Implementation Standards

### 15.1 IDs

Use stable UUIDs for all canonical IDs.

Recommended convention:

- `person_id`
- `prospect_id`
- `operator_id`
- `vehicle_id`
- `amoeba_id`
- `member_id`
- `backlog_item_id`
- `event_id`

Store external IDs separately:

- Bolt driver ID
- Uber driver UUID
- vehicle plate number
- Google Sheet row reference
- legacy workbook reference

### 15.2 Idempotency

All mutation endpoints should accept:

```http
Idempotency-Key: <client-generated-key>
```

Required for:

- HR to Ops onboarding handoff
- TMS to Ops transfer-price event publication
- cash remittance writes
- alert acknowledgements/resolutions
- contract generation
- prospect import confirmation

### 15.3 Audit

Audit history is required for:

- Prospect lifecycle transitions
- Duplicate resolution
- Hiring approvals
- Contract generation/signature upload
- Operator activation/deactivation
- Vehicle assignment/return
- Alert acknowledgement/resolution/escalation
- Cash remittance approval
- Amoeba changes
- Transfer price events
- Backlog completion
- Points awards
- Role and permission changes

### 15.4 Permissions

Permissions should be enforced at API layer, not only in the frontend.

Minimum cross-suite role families:

- superuser
- admin
- manager
- supervisor
- HR staff
- verification officer
- operator
- TMS member
- team coordinator
- observer
- service integration

Exact permission names may differ by domain, but cross-suite roles should map back to Identity where possible.

### 15.5 Local Projections

Systems may store local projections for performance and display:

- display name
- phone
- email
- amoeba name
- supervisor name
- platform label

Projection records should include:

- source system
- source ID
- fetched/synced timestamp
- optional source version or ETag

The projection must not become canonical.

---

## 16. Open Decisions

These decisions should be settled before implementation begins or during Phase 0.

1. **Identity API location.** Does Identity launch as a standalone service or as a module inside HR with a separate public contract?
2. **Amoeba API location.** Does the Amoeba API launch inside TMS or as a small standalone backend owned by the TMS domain?
3. **Initial auth provider.** Google Workspace SSO, email/password, magic link, or hybrid?
4. **Deployment style.** One repo/many services, monorepo with modules, or separate repos?
5. **Event transport.** Webhooks only for v1, or also a durable event table/polling API from the start?
6. **Ops-first scope.** What minimum Ops scope is required before turning off Google Sheet operational edits?
7. **HR handoff timing.** Does HR create/link `person_id` at prospect creation, approval, or ready-for-Ops handoff?
8. **Operator activation rule.** What exact Ops conditions move an operator to `active`?
9. **Amoeba office GPS ownership.** Amoeba definitions are TMS-owned, but operational office coordinates and alert radii may belong in Ops. Confirm split.
10. **Cross-suite analytics.** Do we introduce a warehouse early, or wait until all three systems are live?

---

## 17. Developer Checklist

Before building any feature, answer:

- What domain owns this data?
- Is this a frontend composition problem or a backend ownership problem?
- Does the feature mutate another system's canonical data?
- If yes, is it using that system's public API?
- Can this write succeed without waiting on a reciprocal write?
- Is the event/API idempotent?
- Is there an audit trail?
- Are we caching a projection or creating a duplicate source of truth?
- Does the OpenAPI spec document the contract?
- Have we avoided using Google Sheets as an operational input?

---

## 18. Guiding Summary

The Fleximotion app suite should be understood as:

> **Three product surfaces over five domain APIs.**

The product surfaces are:

- HR / Recruitment
- Ops
- TMS

The domain APIs are:

- Identity
- Amoeba
- HR / Recruitment
- Ops
- TMS

This structure lets each team build a coherent app while preserving clean ownership underneath. HR gets the person into the company. Ops turns the person into an operator and runs the fleet day to day. TMS manages the work and learning system around the business. Identity and Amoeba provide the small shared foundation that keeps the suite from splitting into incompatible silos.
