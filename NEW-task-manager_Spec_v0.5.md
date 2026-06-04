# Fleximotion Management Operating System — Spec v1

**Status:** Working draft.
**Audience:** Founders, management team, and the engineers or vendors who will scope the build.
**Last updated:** 23 May 2026 (v0.2 — scope tightened to tasks/learning/points/amoebas; daily operations, P&L, operators, vehicles, platforms, HR data, and recruitment funnel explicitly owned elsewhere. WhatsApp ingestion removed. Learning loop closure made concrete via SubstrateRevision. Value-estimation friction reduced with preset bands.)

---

## 1. Purpose and Scope

Fleximotion is a fleet partner to Uber, Bolt, and Chowdeck operating in Lagos, currently running ~20 vehicles across two geographic clusters (Island and Mainland) and targeting ~1,000 vehicles in the next twelve months.

### 1.1 What This System Is

The Task Management System (the "TMS") is the **management layer** of Fleximotion's software stack. It owns three concerns and three concerns only:

1. **Tasks** — backlog, prioritisation, pull, completion, and the friction-via-transfer-pricing mechanic for cross-amoeba work.
2. **Learning** — capturing insights and tracing them to verifiable changes in registered substrates.
3. **Points** — accruing individual and team contribution units that management can later redeem.


### 1.2 What This System Is Not

The TMS does **not** own and is **not** the source of truth for any of the following:

- **Daily operations data** (deliveries, trips, revenue, cash receipts, platform metrics) — owned by the **Daily Operations system** (referred to as "Ops" from here). Ops is also where Uber/Bolt/Chowdeck integrations live.
- **P&L per amoeba** — computed and owned by Ops. The TMS reads HE from Ops; it does not compute it.
- **Operators** (riders/drivers) — owned by Ops.
- **Vehicles and platforms** — owned by Ops.
- **HR data on staff and operators** (contracts, personal details, payroll) — owned by the **HR system**.
- **Recruitment funnel** — owned by the **Recruitment system**.
- **Amoebas** — owned by the **HR system**.

This separation is non-negotiable. **Single source of truth for every data element** — see §2 and §8.


### 1.3 Inter-system Stance

Every Fleximotion system is API-first. The TMS is one client among many. The TMS reads from Ops, HR, and Recruitment via their APIs; it writes back to Ops when its work generates events that affect Ops's data (most importantly, Transfer Price Events that adjust amoeba P&Ls — see §5.3 and §8.7).

This document captures the operating philosophy, the KPI framework as it pertains to this system, the domain model the TMS itself owns, the core workflows, the (much-reduced) initial-setup approach, the inter-system architecture, and the open decisions still to be made.

---

## 2. Operating Principles

The TMS is shaped by two management philosophies, three execution principles, and one architectural commitment. Every entity and workflow in the spec exists to make at least one of these principles enforceable in software.

**Amoeba Management** (Inamori). The company is organised as small accountable teams ("amoebas") of 3–7 admin personnel, each running its own P&L (computed in Ops, displayed here) and held to a single primary metric of Hourly Efficiency (HE — defined in §3). Amoebas trade work with each other at internal transfer prices, creating an internal market that surfaces unproductive work and shared-services value.

**Continuous Digital** (Allan Kelly). Teams are stable and own outcomes, not projects. Backlogs are pulled by the team from a prioritised list, not pushed at people by management. Where management does originate work, that work is visibly tagged and carries a transfer-price cost.

**Fast Execution.** Tasks are scored by Cost of Delay (CoD) and Job Size, and the highest-scoring item is pulled next. CoD captures decay of value over time. Filing a task is fast (preset value/duration bands by default; precise numbers only when needed) so the system itself doesn't become friction.

**Tangible Learning.** Every insight must trace to a durable change in a registered substrate — a software backlog, an HR policy, a training manual, a pricing rule. If an insight does not produce a SubstrateRevision, it did not happen. The TMS makes the trace auditable end-to-end.

**Friction in Allocation.** Any task originated outside the receiving amoeba carries a transfer-price charge against the requesting amoeba's HE. This creates discipline without bureaucracy: most low-value asks evaporate when they cost something measurable.

**Single Source of Truth.** Every data element has exactly one owning system. The TMS owns tasks, learning, points. Ops owns everything operational (operators, vehicles, platforms, daily operations, P&L). HR owns staff records and amoeba definitions. Recruitment owns the funnel. The TMS displays data from other systems by reading their APIs; it never duplicates ownership. This is the architectural commitment that lets the stack grow without descending into reconciliation chaos.

---

## 3. KPI Framework

The TMS does not **compute** the operational KPIs (HE, Utilisation, Revenue). These are computed by Ops, which owns the underlying data. The TMS **reads** them via Ops's API and stores periodic snapshots (see §4.3 AmoebaPerformanceSnapshot) for trajectory analysis, points calculations, and display in management contexts. Where the TMS adds value is in *derivative* metrics: Trajectory, Theoretical HE, and the management interpretation that drives backlog and learning decisions.

### 3.1 RUG (Company Level)

The company-level dashboard tracks three numbers: **Revenue**, **Asset Utilisation**, **Growth**. RUG lives at the company level only. Below the company level, RUG is *not* used directly — amoebas are measured by HE and Trajectory, which together drive RUG. All three RUG numbers are read from Ops via API.

### 3.2 Hourly Efficiency (HE) — Primary Amoeba Metric (Read from Ops)

Computed by Ops:

```
HE = (Revenue − Non-Labour Operating Expenses) ÷ Total Admin Hours Worked
```

The TMS reads HE from Ops at a configurable refresh cadence (default hourly). It is stored as an AmoebaPerformanceSnapshot (§4.3) for each amoeba and time window. The TMS does not maintain its own definition of HE — if Ops's definition changes, the TMS picks up the change automatically.

### 3.3 Trajectory — Growth-of-HE Metric (Computed Here)

Trajectory is computed by the TMS from the HE snapshots it stores:

```
Trajectory = (HE rolling N-week mean) ÷ (HE rolling N-week mean, N weeks prior) − 1
```

The window `N` is a system configuration parameter, default 4 weeks, set in the admin dashboard. Trajectory is reported as a percentage. It must be positive for operating amoebas under normal circumstances; sustained negative Trajectory triggers a review and gates pool-points eligibility (§5.7).

### 3.4 Utilisation (Read from Ops)

Defined and computed by Ops as `Actual Operator Hours Worked ÷ Expected Operational Hours`. The TMS reads Utilisation from Ops for context and display. It is a leading indicator of HE.


### 3.5 Theoretical HE (Computed Here)

A diagnostic metric. Each amoeba has a Theoretical HE — what HE would be at 100% utilisation given current operator headcount and typical revenue per unit. The TMS computes this by pulling operator counts and per-operator revenue rates from Ops, then applying the HE formula.

```
Theoretical HE = (Active Operators × Typical Revenue per Operator − Non-Labour Operating Expenses) ÷ Admin Hours
```

The gap between Theoretical HE and actual HE is a powerful conversation piece in amoeba reviews. If Mainland's Theoretical HE is +NGN 800/hr and actual is −NGN 1,500/hr, the entire discussion is about why the utilisation gap exists.

### 3.6 Investment Amoeba Metrics

Investment amoebas (see §5.1) are not held to HE. They are held to dated milestones in a written thesis. The TMS tracks milestone status, days-to-next-milestone, and parent-amoeba funding draw-down.

### 3.7 Central (Shared-Services) Amoeba Metrics

Central is held to two numbers: **Cost-as-Share** (Central's total cost ÷ aggregate operating-amoeba revenue — computed here from Ops data) and **Internal NPS** (survey of operating amoebas: "would you recommend Central to a peer startup, 0–10"). Both must trend in the right direction. Cost-as-Share trending up without Internal NPS rising is a structural problem.

Survey cadence is configurable in the admin dashboard, default quarterly. Surveys are accessible only to logged-in users, but are anonymous. Internal NPS scores are **advisory** at v1 — visible to management and to the rated amoeba, surfaced in the governance forum, but do not automatically adjust Central's transfer-price rates or funding. A future configuration option will allow scores to feed into rate-setting; that mechanism is deferred until the team has a few quarters of baseline data.

---

## 4. Domain Model

All entities below are owned by the TMS and persisted in its database (PostgreSQL recommended). Entities that look like they belong here but aren't (Operator, Vehicle, Platform, OperationsDay, daily P&L, expense lines, recruitment funnel, amoeba) are owned by Ops, HR, or Recruitment — see §8.7. Field types are illustrative; engineering will refine.

### 4.1 Amoeba

[deleted]


### 4.2 Member

A lightweight projection of a staff record. The HR system is the source of truth for identity, contract, payroll, contact details, and role-in-the-company. The TMS stores only what it needs to do its job.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Local TMS id |
| `hr_user_id` | text | Foreign key into the HR system. Null if the member is set up here before being registered in HR (provisional). |
| `display_name` | text | Cached from HR for display. May be edited locally if HR data is missing. |
| `email` | text | Cached from HR for display and login. |
| `amoeba_id` | uuid → Amoeba | TMS-owned — which amoeba the member belongs to from the management perspective. |
| `os_role` | enum | `member` \| `team_coordinator` \| `management` \| `observer` \| `service_integration`. TMS-internal authorisation level. A management user can elevate any member to `management` (the superadmin path — see §9.1 #5). |
| `created_at` | timestamp | |
| `removed_at` | timestamp | Null unless removed from the TMS. Removal here does not affect HR record. |

The TMS does not store hire date, termination date, contracts, salary, role-in-the-company, or any other HR-system data. When such fields are needed for display (e.g. tenure on an amoeba review), the TMS reads them from HR's API.

Multi-amoeba membership is **not allowed at v1** given the three-amoeba topology; revisit when amoeba count grows.

### 4.3 AmoebaPerformanceSnapshot

A cached read of operational and financial KPIs from Ops, scoped to an amoeba and time window. The TMS pulls these snapshots from Ops on a configurable cadence (default hourly) and uses them for Trajectory, Theoretical HE, Points calculations, and dashboards. The snapshot is not a source of truth — it is a refreshable cache. Ops's record is canonical.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `amoeba_id` | uuid → Amoeba | |
| `window` | enum | `day` \| `week` \| `month` \| `quarter` |
| `period_start` | date | |
| `period_end` | date | |
| `he_ngn_per_hour` | numeric | Read from Ops |
| `theoretical_he_ngn_per_hour` | numeric | Computed by the TMS using inputs from Ops |
| `utilisation_pct` | numeric | Read from Ops |
| `revenue_ngn` | numeric | Read from Ops |
| `admin_hours_worked` | numeric | Read from Ops (or from HR if hours live there) |
| `active_operators_count` | int | Read from Ops |
| `fetched_at` | timestamp | When this snapshot was pulled |
| `source_etag` | text | Etag/version returned by Ops, for cache freshness checks |

Snapshots are append-only; an older snapshot for the same `(amoeba_id, window, period_start)` is superseded by a newer one but not deleted (audit history).

### 4.4 BacklogItem

The core work-tracking entity. Owned by the TMS.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `title` | text | |
| `description` | text | |
| `owning_amoeba_id` | uuid → Amoeba | The amoeba accountable for delivery |
| `originating_amoeba_id` | uuid → Amoeba | Where the item was filed from. If ≠ owning_amoeba_id, this is allocated work and triggers a transfer-price charge on acceptance. |
| `originating_member_id` | uuid → Member | Person who filed it |
| `assignee_member_id` | uuid → Member | Null until pulled or pushed (see §5.2). |
| `contributor_member_ids` | uuid[] → Member | Multi-person work is encouraged. Either the assignee can add a contributor, or a contributor can add themselves — Coordinator validates at completion. |
| `value_band` | enum | `small` \| `medium` \| `large` — preset bands (see §5.2). The system maps these to NGN/week defaults configurable in admin dashboard. |
| `value_estimate_ngn_per_week` | numeric | Materialised from `value_band` default, but may be overridden by the Coordinator to a specific number on acceptance. |
| `duration_band` | enum | `week` \| `month` \| `quarter` — how long until the value evaporates. Preset bands (see §5.2). |
| `zero_value_date` | date | Computed from `duration_band` (or set explicitly if the Coordinator overrides). |
| `is_hard_deadline` | bool | If true, value drops to a large negative after `zero_value_date` instead of zero. Tagged at filing time. |
| `size_band` | enum | `hours` \| `days` \| `week_plus` — preset bands. |
| `size_estimate_days` | numeric | Materialised from `size_band`. |
| `wsjf_score` | numeric | Computed silently. Not user-editable. |
| `linked_learning_entry_id` | uuid → LearningEntry | Optional. Set when this BacklogItem exists to produce a SubstrateRevision for a LearningEntry. Closes the loop (see §4.7 and §5.4). |
| `status` | enum | `proposed` \| `accepted` \| `pulled` \| `pushed` \| `in_progress` \| `done` \| `killed`. `pushed` indicates management assigned the item to a specific member after unpulled aging (see §5.2). |
| `unpulled_since` | timestamp | For aging — see §5.2 |
| `created_at` | timestamp | |
| `done_at` | timestamp | |

The user-facing filing form shows: `title`, `description`, three radio-button bands (`value_band`, `duration_band`, `size_band`), and an optional `is_hard_deadline` checkbox. Filing should take ~10 seconds. The Coordinator can override band defaults to specific numbers on acceptance if needed. Most items never need override.

### 4.5 Substrate

A registered durable artefact that learning lands in. Examples relevant to Fleximotion today: a software backlog (currently a Google Doc somewhere, becoming a proper system later), an HR policy document, a supervisor training manual (migrating to a software system), an operator training manual (migrating to a software system).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `name` | text | |
| `type` | enum | `software_backlog` \| `policy_document` \| `training_manual` \| `runbook` \| `playbook` \| `pricing_rule` \| `contract_template` \| `other`. Editable enum — admin can add types. |
| `location_url` | text | Where the live version lives (Google Doc, Notion page, GitHub repo, future software system). |
| `owner_amoeba_id` | uuid → Amoeba | An amoeba owns the substrate and is responsible for keeping it current. |
| `change_approver_member_id` | uuid → Member | Single approver for changes to this substrate. Must hold `management` role. |
| `is_shared` | bool | True if all amoebas use the substrate; false if amoeba-local. |
| `created_at` | timestamp | |
| `retired_at` | timestamp | |

### 4.6 SubstrateRevision

The artefact that closes the learning loop. A SubstrateRevision is a recorded change to a Substrate — what changed, when, by whom, with a link to the actual revision in the substrate's home system. A LearningEntry is only `landed` once it points at one or more SubstrateRevisions.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `substrate_id` | uuid → Substrate | |
| `revision_label` | text | Human-readable label, e.g. "v3 — added battery-fault escalation step", "HR Policy 2026-05-12" |
| `change_description` | text | Plain language: what changed, why. |
| `change_url` | text | Authoritative link to the change — Google Doc revision URL, GitHub PR, Notion page version, etc. **Required**; without it, the loop is not closed. |
| `landed_at` | timestamp | When the change went live in its home system. |
| `landed_by_member_id` | uuid → Member | Who landed it. |
| `approved_by_member_id` | uuid → Member | The Substrate's `change_approver_member_id` at time of approval. |
| `produced_by_backlog_item_id` | uuid → BacklogItem | Nullable but recommended — if a BacklogItem produced this revision, link it. Lets us trace LearningEntry → BacklogItem → SubstrateRevision end-to-end. |

### 4.7 LearningEntry

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `insight` | text | What was learned. |
| `triggering_event` | text | What surfaced the insight (incident, customer feedback, observation, supervisor note). Free text — the TMS does not reference Ops's OperationsDay rows; if a supervisor note in Ops surfaced the learning, paste or link it here. |
| `originating_member_id` | uuid → Member | |
| `originating_amoeba_id` | uuid → Amoeba | |
| `affected_substrate_ids` | uuid[] → Substrate | Required — must be ≥ 1. No substrate = no learning. If no existing substrate fits, create one first. |
| `produced_substrate_revision_ids` | uuid[] → SubstrateRevision | Populated as revisions land. The LearningEntry is `landed` once this list is non-empty and the approver has confirmed each revision genuinely addresses the insight. |
| `status` | enum | `proposed` (filed, no work yet) \| `change_in_progress` (a BacklogItem is open to produce the revision) \| `landed` (one or more SubstrateRevisions linked and confirmed) \| `abandoned` (closed without a change, with reason). |
| `landed_at` | timestamp | When status became `landed`. |
| `abandoned_reason` | text | Required when status = `abandoned`. |

The simplified status flow (no `refinement` vs `structural` distinction) reflects the current reality that only Central has software-building capability and that substrate changes today flow through a single approver. The flow can be elaborated when the company has distributed change capability.

### 4.8 Thesis

Used only for investment amoebas. The amoeba type is defined in the HR system but the Thesis is defined in TMS. Parent is Central by convention (§4.1).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `amoeba_id` | uuid → Amoeba | The investment amoeba this thesis governs. |
| `statement` | text | "We believe that..." |
| `parent_amoeba_id` | uuid → Amoeba | Always Central in v1. |
| `funding_cap_ngn` | numeric | |
| `current_drawdown_ngn` | numeric | Updated from Ops's expense feed. |
| `status` | enum | `active` \| `converted_to_operating` \| `wound_down` |

### 4.9 ThesisMilestone

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `thesis_id` | uuid → Thesis | |
| `description` | text | |
| `target_date` | date | |
| `achieved_date` | date | Null until achieved |
| `status` | enum | `pending` \| `achieved` \| `missed` \| `cancelled` |

### 4.10 TransferPriceRule

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `provider_amoeba_id` | uuid → Amoeba | |
| `consumer_amoeba_id` | uuid → Amoeba | |
| `service_description` | text | |
| `rate_basis` | enum | `per_operator_per_day` \| `per_hour` \| `per_event` \| `fixed_daily` |
| `rate_ngn` | numeric | Set in admin dashboard. Default methodology: **cost recovery** — provider's relevant cost ÷ projected consumption. See §6.3. |
| `effective_from` | date | |
| `effective_to` | date | |

### 4.11 TransferPriceEvent

Logged each time work crosses an amoeba boundary (either an allocated BacklogItem accepted, or a recurring service-charge tick). Each event is **published to Ops** via the inter-system API so Ops can incorporate it into amoeba P&L. Without this publication, HE will diverge between the two systems — see §5.3 and §8.7.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `date` | date | |
| `provider_amoeba_id` | uuid → Amoeba | |
| `consumer_amoeba_id` | uuid → Amoeba | |
| `triggering_backlog_item_id` | uuid → BacklogItem | Nullable — some are recurring service charges. |
| `triggering_rule_id` | uuid → TransferPriceRule | The rule that produced the rate. |
| `amount_ngn` | numeric | |
| `published_to_ops_at` | timestamp | When the TMS successfully posted this event to Ops's API. Null until published. Retries are automatic; failed publication is surfaced to admin. |

### 4.12 InternalNPSSurvey

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `period_label` | text | e.g. "2026-Q3" (configurable cadence — see §3.7) |
| `respondent_amoeba_id` | uuid → Amoeba | |
| `target_amoeba_id` | uuid → Amoeba | The amoeba being rated (usually Central) |
| `score` | int | 0–10 |
| `comment` | text | |
| `submitted_at` | timestamp | |

### 4.13 PointsAward

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `member_id` | uuid → Member | Recipient |
| `amoeba_id` | uuid → Amoeba | The amoeba context at time of award |
| `award_type` | enum | `task` \| `pool` |
| `points` | int | Whole-number points (always positive) |
| `source_backlog_item_id` | uuid → BacklogItem | Set when `award_type = task`; null for pool awards |
| `scoring_period_label` | text | Set when `award_type = pool` (e.g. "2026-M07" for monthly); null for task awards |
| `awarded_at` | timestamp | |
| `basis_snapshot` | jsonb | Frozen snapshot of the inputs that produced this award (WSJF, share %, pool multiplier, etc.) — for audit and dispute |

---

## 5. Core Workflows

### 5.1 Amoeba Classification

Every amoeba is one of:

- **Operating amoeba.** Held to HE + Trajectory (both read from Ops, the latter computed here). Has its own P&L computed in Ops. Examples at current scale: Island, Mainland.
- **Investment amoeba.** Loss-making by design. Held to Thesis milestones, not HE. Funded by **Central** (always — investment amoebas are parented by Central, not by operating amoebas). Has a funding cap and a drawdown tracked from Ops's expense feed. Example: a new-city pilot.
- **Shared-services amoeba.** Provides internal services. Held to Cost-as-Share and Internal NPS. Costs are charged back to operating amoebas via Transfer Price rules. Example at current scale: Central.

Reclassification is a tracked event and requires management approval. An investment amoeba becomes eligible to convert to operating once it sustains positive HE over a configurable window (default 30 days). Conversion still requires management sign-off — the window is the eligibility trigger, not an automatic switch.

### 5.2 Backlog and Pull

The single most important UX constraint here is that filing a task must be fast. If the form takes more than ten seconds to fill, the system itself becomes friction and people will route around it.

**Filing.** Anyone — member of any amoeba, or an outside stakeholder via a structured form — can propose a BacklogItem against any amoeba. The filing form asks for:

- `title` (one line)
- `description` (optional, a few sentences)
- `value_band` — radio buttons: **Small / Medium / Large**. Each band maps to a default NGN-per-week value set in the admin dashboard.
- `duration_band` — radio buttons: **Week / Month / Quarter**. How long until this stops mattering.
- `size_band` — radio buttons: **Hours / Days / Week+**. Rough size.
- `is_hard_deadline` — single checkbox, with optional date picker if ticked.

Filing should take ~10 seconds. The Coordinator can refine to specific numbers later if needed; most items never get refined. The bands are the workable defaults — the system is usable without ever touching a precise number.

The item enters the owning amoeba's inbox in `proposed` state.

**Acceptance.** Only the **Team Coordinator** can move an item from `proposed` to `accepted`. On acceptance, three things happen:

1. If `originating_amoeba_id ≠ owning_amoeba_id`, a TransferPriceEvent (§4.11) is created against the originating amoeba per the applicable Transfer Price Rule, and the event is published to Ops so its P&L reflects the charge (§5.3).
2. The Coordinator may override band defaults with specific numbers if the bands feel wrong for this item.
3. WSJF is computed silently:

```
WSJF = value_estimate_ngn_per_week ÷ size_estimate_days
```

Items can also be rejected with a reason. Hard-deadline items get a large WSJF boost as `zero_value_date` approaches. The user never sees the formula — the backlog UI just shows items sorted top-to-bottom.

**Pulling.** Any member of the owning amoeba can pull the top item from the accepted backlog. The item moves to `pulled` and `assignee_member_id` is set.

**Contributors.** A member who needs help with their pulled item can add another member as a contributor. A member who has helped with someone else's item can add themselves as a contributor. Both routes are open; the Coordinator validates the contributor list at completion to catch abuse (see §5.7 anti-gaming).

**Unpulled aging.** Any accepted item that goes longer than the configured aging threshold (default 7 days) without being pulled is auto-flagged. It then surfaces in the weekly governance forum with four options:

- Pull it with a reason.
- Kill it.
- Declare a capability gap (triggers a hiring or training conversation).
- **Push it.** Management may assign the item to a specific member, setting `status = pushed` and `assignee_member_id`. Push is recorded distinctly from pull so the system can later analyse how much work is genuinely pulled vs management-pushed — a health signal for whether the team is value-seeking or order-taking.

**Completion.** The member marks the item `done`. The system snapshots WSJF, time-in-backlog, and contributors. Done items are immutable and feed downstream Points calculations (§5.7) and the amoeba's velocity dashboard.

### 5.3 Transfer Pricing

Transfer prices create honest friction in cross-amoeba work *and* make sure HE in Ops reflects the management OS's allocation rules. Three flows:

- **Allocated work.** When a BacklogItem's `originating_amoeba_id ≠ owning_amoeba_id`, the originator is charged at the rate specified in the relevant TransferPriceRule on the day the item is **accepted** (not when it's pulled — acceptance is the commitment).
- **Recurring services.** Central's HR and accounting work, for example, are charged as `fixed_daily` or `per_operator_per_day` flows on a daily cron, not tied to individual BacklogItems.
- **Disputes.** If a consumer amoeba believes a charge is unfair, the dispute is raised in the weekly governance forum and the TransferPriceRule (§4.10) may be revised. Past events are not retroactively adjusted unless management explicitly authorises it.

**Publication to Ops.** Every TransferPriceEvent (§4.11) is published to Ops via API as soon as it's recorded. Ops uses these events to adjust each amoeba's P&L — adding inbound charges as expenses, outbound charges as revenue — so the HE Ops reports back to the TMS already reflects the transfer-price effects. If publication fails, the TMS retries automatically and surfaces the failure to admin; this is a critical path because divergence between the TMS and Ops on transfer prices makes both systems' numbers wrong.

### 5.4 Learning Capture — Closing the Loop

The previous draft was vague about *how* the learning loop closes. This section is concrete: the loop is closed when a LearningEntry points at a SubstrateRevision with a verifiable `change_url`. Without that, the learning didn't happen.

The full flow:

1. **Trigger.** Something surfaces — an incident, a customer complaint, an observation, a supervisor's free-text note in Ops, a recurring pattern in a weekly review.
2. **File a LearningEntry** (§4.7). The originator describes the insight and selects one or more affected Substrates. If no existing Substrate fits, they create one first. Status: `proposed`.
3. **Open a BacklogItem to make the change.** A BacklogItem is filed against the Substrate's owner amoeba, with `linked_learning_entry_id` pointing at the LearningEntry. The LearningEntry status moves to `change_in_progress`. (For very small refinements, this step can be skipped if the change is made directly and recorded as a SubstrateRevision in step 5 — but recording the BacklogItem is preferred because it generates Points and creates audit trail.)
4. **Land the change in the Substrate's home system.** Edit the Google Doc, push the GitHub PR, update the Notion page, revise the training manual. The work happens *where the Substrate lives*, not in the TMS.
5. **Create the SubstrateRevision** (§4.6). The person who made the change records the SubstrateRevision in the TMS, with the **required** `change_url` linking to the actual change (Google Doc revision URL, PR URL, Notion page version, etc.). Without this URL, the form does not submit.
6. **Approve.** The Substrate's `change_approver_member_id` (a management user) clicks approve. The SubstrateRevision is now official.
7. **Link back.** The SubstrateRevision id is added to the LearningEntry's `produced_substrate_revision_ids`. The LearningEntry's status moves to `landed`. Loop closed.

**Why this design.** Reality at Fleximotion today: only Central has software-building capability. Most substrate changes are document edits (HR policy, training manuals) rather than code. The system does not assume distributed change-making capability — every change goes through the same simple flow with a single approver per substrate. This can be elaborated later when more amoebas can ship code or own runbooks.

**What "the loop is closed" gives you.** At any time, management can:

- Open any LearningEntry and see exactly which SubstrateRevision(s) it produced, with clickable links to the actual changes.
- Open any Substrate and see all SubstrateRevisions over time, each tagged with the LearningEntry that drove it.
- Audit a quarter's LearningEntries and confirm each `landed` one corresponds to a real, externally verifiable artefact — not just a checkbox in the TMS.

**Abandoned learnings.** A LearningEntry can be moved to `abandoned` if the team decides it doesn't warrant a change after all. Reason is required. This is honest closure; the alternative is `proposed` items rotting forever.

### 5.5 Rituals — What This System Contributes

The TMS doesn't run the rituals; the Coordinators and management do. The TMS contributes specific views and data to each ritual so the conversation is grounded in current data rather than memory. This system is **not just for info**; it actively drives certain conversations (unpulled-item aging, capability gaps, learning closure rate).

| Ritual | Frequency | This TMS Contributes | Other Inputs |
|---|---|---|---|
| Amoeba huddle | Daily | Backlog snapshot for the amoeba — top items, unpulled count, items aging. Member contributions today. | Ops's daily ops dashboard (separate). |
| Amoeba review | Weekly | HE/Trajectory chart (snapshot data from Ops), Theoretical HE gap, learning entries landed this week, backlog re-score view, Points awarded snapshot. | None — this is the TMS-centric review. |
| Governance forum | Weekly | Unpulled-aging items across all amoebas, capability gaps flagged, transfer-price disputes, push-vs-pull ratio per amoeba. | None. |
| Company review | Monthly | Backlog throughput per amoeba, LearningEntries landed per amoeba, SubstrateRevisions audit, Points awarded summary, Investment amoeba milestone status. | Ops contributes RUG dashboard and P&L; HR contributes headcount. |
| Strategy re-cut | Quarterly | Amoeba portfolio (operating / investment / shared-services), Internal NPS results, promotion eligibility (Coordinators meeting three-period HE+Trajectory bars), Substrate registry health (gaps, churn). | Management strategic input; Ops's revenue and growth view. |

Frequencies are conventions, not enforced by the system. The system tracks no calendar; it just serves the data when asked.

### 5.6 Promotion and Graduation

Team Coordinators who hit HE + Trajectory targets for three consecutive scoring periods (default monthly — see §5.7) become eligible to (a) start a new investment amoeba with a defined funding cap, (b) take over a struggling operating amoeba, or (c) move up to manage a cluster of amoebas (a future organisational layer once the company exceeds ~8 amoebas). This is the retention mechanism — autonomy and structural career path rather than salary competition.

The TMS surfaces eligibility automatically in the strategy re-cut view; promotion decisions are management's, the TMS just makes them legible.

### 5.7 Points

Points are the abstract unit the TMS uses to record individual contribution to value creation. The *generation* logic lives in the TMS; what points eventually *redeem for* (cash, options, recognition, holiday — or a mixture) is a separate management decision deferred to a later document. Treating points as currency-agnostic lets the TMS run the accrual mechanic now and lets the redemption mechanic evolve.

Points come from two sources.

**Task points** are awarded when a BacklogItem moves to `done`:

```
Task Points = round(WSJF × task_points_multiplier)
```

Split:
- Assignee receives `assignee_share_pct` (default 50%).
- Remaining share is split equally among declared contributors at the time of completion. If no contributors are declared, the assignee receives 100%.

This connects points to value (via WSJF, which is value-per-week ÷ size). A small task that creates a lot of value awards more than a large task that creates little.

**Pool points** are awarded at the end of each scoring period (default **monthly**, configurable to `monthly` / `quarterly` / `annually`) to every member of an operating amoeba that finished the period with positive HE *and* positive Trajectory:

```
Amoeba Pool = max(0, HE × admin_hours_in_period × pool_multiplier)
```

The pool is distributed proportionally to `admin_hours_worked` by each member in the period. The pool is zero if the amoeba didn't hit both gates; partial credit is not awarded in v1.

Both flows write to the same PointsAward (§4.13) ledger.

**Configuration** (admin dashboard; all required non-null before any points are awarded):

- `task_points_multiplier` — scales task awards.
- `assignee_share_pct` — default 50.
- `pool_multiplier` — scales pool awards.
- `scoring_period` — default `monthly`; allowed `monthly`, `quarterly`, `annually`.
- `value_band_defaults_ngn` — the three default NGN values mapping Small / Medium / Large bands to numbers.
- `duration_band_defaults_days` — default days for Week / Month / Quarter bands.
- `size_band_defaults_days` — default days for Hours / Days / Week+ bands.
- `points_enabled` — global on/off switch. **v1 ships with this off.** Management turns it on once the multipliers are tuned against observed task and HE distributions (probably 30+ days post-cutover).

**Anti-gaming controls.**

- Coordinator validates band selections and contributor list at acceptance and again at completion.
- Contributor lists can only be modified before the item moves to `done`. Backdating onto completed tasks is forbidden.
- Disputes raised at completion go to the weekly governance forum.
- All Points awards have a `basis_snapshot` of the inputs that produced them — for audit and dispute resolution.

**Visibility.** Members see only their own Points history (with per-event breakdown). Team Coordinators see their amoeba's awards. Management sees everything.

---

## 6. Fleximotion Topology at Initial Setup

### 6.1 Three Amoebas

The TMS launches with a **three-amoeba** topology:

- **Island.** Operating amoeba. Geographic scope: Lagos Island.
- **Mainland.** Operating amoeba. Geographic scope: Lagos Mainland.
- **Central.** Shared-services amoeba. Scope: HR-adjacent work the TMS sees (only the management bits — staff HR data is owned by the HR system), accounting-adjacent management activity, recruitment management coordination, and ownership of cross-cutting Substrates (training manuals, policy documents, software backlogs).

Live operational counts (active operators, vehicles, revenue, utilisation, HE) are not specified in this document. They are owned by Ops and read into the TMS via AmoebaPerformanceSnapshot (§4.3). At any given time, what the TMS reports for these amoebas comes from Ops's current data, not from any pre-baked figures here.

### 6.2 Roles: Supervisor vs Team Coordinator

Two role designations matter for the TMS, both held on the Member entity:

- **Supervisor** — supervises operators (riders/drivers) in the field. This role is also recognised in Ops and HR; for the TMS, it's primarily a display tag that indicates the member is the on-the-ground operations contact.
- **Team Coordinator** — the amoeba's accountable leader for management purposes: owns HE outcomes for the amoeba, prioritises the backlog, can accept or reject incoming BacklogItems, oversees LearningEntries, validates contributor lists on completion.

A single member can hold both designations, and at initial setup probably will for Island and Mainland — the current designated supervisors will likely also be designated Team Coordinators. The two are conceptually separate so they can be re-assigned independently.

**De-facto leadership.** Founder observation: the current accountant is showing more Coordinator-like behaviour than the official supervisors. The TMS does not lock the formal Coordinator role to the current supervisor. Two paths:

1. **Designate the accountant directly.** Setting `Mainland.coordinator_member_id` (or `Central.coordinator_member_id`) to the accountant is a single configuration change. The accountant remains the Accountant in HR; they additionally take on the OS's Team Coordinator authority.
2. **Let the data surface reality first.** If formal designation lags, the TMS will accumulate evidence (contributor frequency on completed BacklogItems, LearningEntries filed, transfer-request authorship, governance-forum participation) so the eventual change is data-supported rather than a hunch.

Initial Coordinator assignments for all three amoebas are TBD at setup — see §9.2.

### 6.3 Transfer Pricing — Methodology

Transfer Price rates are entered and maintained in the admin dashboard. The agreed methodology is **cost recovery** (per §9.1 #2):

```
Rate = Provider's relevant cost in the period ÷ Projected consumption in the period
```

For Central → Island and Central → Mainland, this means Central's total cost (as reported by Ops's expense feed) divided by some projection of the consumption metric — most likely `per_operator_per_day` weighted by active operator count, but the exact basis is a management decision finalised at setup.

For ad-hoc cross-amoeba work (Island ↔ Mainland), rates are typically `per_event` and set in the governance forum.

Initial rates are entered in the admin dashboard at setup. They are re-evaluated quarterly using Central's actual cost from Ops and observed consumption. The TransferPriceRule (§4.10) effective-dated history captures these revisions automatically.

---

## 7. Initial Setup (Not Migration)

The TMS is mostly **greenfield**. It does not replace the Fleximotion Daily Report — that data belongs to Ops, which is being built separately. There is no operator data, vehicle data, platform data, expense data, or daily operations data to import here. Those entities live in Ops and HR.

What the TMS needs at setup is small and self-contained.

### 7.1 What to Populate at Setup

1. **The three Amoebas.** Island, Mainland, Central. Classifications, geographic scopes, parent (for Central this is null; if/when investment amoebas are spun up, they'll be parented by Central).
2. **A starting roster of Members.** The admin staff who will use the TMS. Each Member is a lightweight projection — `hr_user_id` is the link to the HR system (set when HR's API is online; otherwise create with `hr_user_id = null` provisionally), plus `display_name`, `email`, `amoeba_id`, `os_role`.
3. **Initial Team Coordinator designations** for each amoeba (Island, Mainland, Central). These are management decisions taken at setup — TBD per §9.2.
4. **Starting Substrate registry.** Concretely:
   - **Software backlog substrate.** Wherever it currently lives — Google Doc, Notion, anywhere. Type `software_backlog`, owned by Central. The "future software system" replacing the doc becomes the new `location_url` when ready; SubstrateRevisions trace the change.
   - **HR policy document.** Type `policy_document`, owned by Central. `location_url` points at the current document wherever it lives.
   - **Supervisor training manual.** Type `training_manual`, owned by Central (transitions to its dedicated system later — same substrate, updated `location_url`).
   - **Operator training manual.** Type `training_manual`, owned by Central (same pattern).
   - Add others as the team identifies them. Substrates can be added any time; the registry grows organically.
5. **Initial TransferPriceRules.** Cost-recovery rates for Central → Island, Central → Mainland, and a default `per_event` rule for Island ↔ Mainland. Effective from setup date.
6. **System configuration.** Trajectory window (4 weeks), unpulled aging (7 days), investment-conversion window (30 days), Internal NPS cadence (quarterly), scoring period (monthly), reporting refresh cadence (hourly), value/duration/size band defaults, points multipliers (with `points_enabled = false`).

### 7.2 What Does *Not* Happen at Setup

- No import of historical operational data. That history lives wherever the current Daily Report sheet lives, or in Ops when it's built. The TMS doesn't need it.
- No import of the current sheet's supervisor notes. Those notes belong to Ops (or remain in the sheet for archival). LearningEntries filed in the TMS from cutover onward stand on their own merits.
- No import of operator, vehicle, or platform records. These are Ops/HR concerns.
- No import of expense lines or daily P&L. These flow from Ops to the TMS via the AmoebaPerformanceSnapshot mechanism (§4.3) once Ops is online.

### 7.3 Dependency on Ops

Some TMS functionality depends on Ops being online and serving HE/Utilisation/operator-count data via its API:

- AmoebaPerformanceSnapshot is empty until Ops's feed is wired up.
- Trajectory and Theoretical HE are not computed until enough snapshots accumulate.
- Pool Points cannot be awarded until HE is available — but `points_enabled = false` at v1, so this isn't blocking.

The TMS is usable for tasks, learning, points (task points only), and substrate management from day one, even if Ops is not yet online. Pool points and HE/Trajectory views activate when Ops comes online.

---

## 8. Technical Architecture

### 8.1 API-First Architecture

The TMS is **API-first**. Every domain capability — reading, writing, querying — is exposed through a public, versioned API. The TMS web UI is the first consumer of that API, not a special case with privileged backdoor access. This is a hard architectural constraint, not an aspiration: the future operator-facing app, the Ops system that reads transfer-price events, accounting/payroll integrations, and any plugin or extension Fleximotion builds in future will all be clients of the same API surface.

This matters because the TMS will not be the only system in Fleximotion's stack — by founder direction, the operator-facing app is a separate system, and more domain-specific systems will follow. If those systems can integrate cleanly from day one, the TMS becomes the company's operational backbone. If they can't, the TMS becomes another silo.

**API contract.**

- **Style:** REST over HTTPS with JSON payloads. (GraphQL is acceptable as an alternative if engineering prefers; the principles below carry over.) Every resource in §4 is exposed as a collection endpoint with standard CRUD verbs.
- **Versioning:** Path-based, `/v1/`, `/v2/`, etc. Breaking changes require a new major version. Backwards-compatibility commitment: a major version stays supported for at least 12 months after the next major version ships.
- **OpenAPI spec:** Auto-generated from the codebase. Served at `/v1/openapi.json` and rendered as interactive docs at `/v1/docs`. The spec is the contract; if it's not in the spec, it's not in the API.
- **Authentication:** OAuth 2.0 for human users (via Google Workspace SSO — see §8.3). For service-to-service, long-lived API tokens issued per integration, scoped to specific resources and verbs. All tokens revocable from the admin dashboard.
- **Authorisation:** Role-based access (`member`, `team_coordinator`, `management`, `observer`, `service_integration`) plus per-amoeba scoping where relevant. Authorisation rules are enforced at the API layer, not in the UI.
- **Idempotency:** All mutation endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) accept an `Idempotency-Key` header. The server records keys for 24 hours and returns the original response on retry — safe to retry on network failure.
- **Pagination, filtering, sorting:** Standardised across all collection endpoints. Cursor-based pagination (not offset) for stable iteration over large sets. Query params: `?limit=`, `?cursor=`, `?filter[field]=value`, `?sort=field,-other_field`.
- **Errors:** Structured JSON error responses with `code` (machine-readable), `message` (human-readable), `details` (optional context). HTTP status codes used semantically.
- **Rate limiting:** Per-token, with documented limits surfaced in response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).
- **Webhooks:** The TMS publishes domain events (BacklogItem completed, LearningEntry landed, SubstrateRevision created, PointsAward issued, TransferPriceEvent created, Amoeba classification changed, etc.) to registered webhook endpoints. Webhook receivers register URLs and event subscriptions through the API. Delivery is at-least-once with exponential-backoff retry. Payloads are signed (HMAC) so receivers can verify origin.
- **Webhook → polling fallback:** Every webhook event is also queryable via an `/events` endpoint, so receivers that miss webhooks can catch up by polling.

**Why this matters for the build.** The web UI is a thin React (or Svelte) client that calls the API. It has no business logic — all business logic, validation, and authorisation lives behind the API. This means a future mobile app, an operator app, or a third-party integration cannot accidentally bypass a business rule, because there's no other path to the data.

**SDK note.** A thin client SDK (TypeScript first; Python optional) wrapping the API saves time for downstream system builders. v1 ships with TypeScript SDK auto-generated from the OpenAPI spec.

### 8.2 Data Model and Storage

- **Database:** PostgreSQL. Relational fit is strong; the entity model is highly normalised and reporting depends on consistent joins. JSONB columns used sparingly for `basis_snapshot` and free-form metadata.
- **Schema migrations:** Managed via a standard tool (e.g. Flyway, Alembic, Prisma Migrate). All schema changes versioned in the repo.
- **Hosting:** Cloud-managed (AWS RDS, Render, or Fly.io). Host outside Nigeria given power reliability concerns. Add read replicas later if latency bites.

### 8.3 Auth and Identity

- **Human users:** SSO via Google Workspace — the team is already on Google. New members are provisioned in the admin dashboard and matched to Google identities.
- **Service tokens:** Long-lived bearer tokens for service-to-service. Issued by management, scoped to specific resources/verbs, listed and revocable in the admin dashboard.
- **Roles:** `member`, `team_coordinator`, `management`, `observer` (read-only audit access), `service_integration` (programmatic). Per-amoeba scoping applied to `member` and `team_coordinator`.

### 8.4 Frontend

A single web application, mobile-responsive. Supervisors and operators-of-the-TMS use phones in the field; this is non-negotiable. React or Svelte; PWA-installable on Android. The web app is a pure API client — see §8.1.

### 8.5 Reporting Layer

Beyond the application UI, the TMS must support ad-hoc analysis:
- Expose a read-only Postgres replica for direct SQL access by analysts.
- Provide Metabase (or similar) connected to the replica for non-engineer dashboards.
- API exports of every collection as CSV/Sheets for the period when the team is still spreadsheet-oriented.

### 8.6 Performance Targets at Scale

The TMS owns far less data than a daily-operations system would. At the 1,000-vehicle target state:

- BacklogItems: low thousands open at any time, ~15k completed per year.
- LearningEntries and SubstrateRevisions: low hundreds per quarter.
- PointsAwards: ~2 per completed BacklogItem + N per scoring period per active Member. Low six figures per year.
- AmoebaPerformanceSnapshots: ~25 amoebas × 24 hourly snapshots = 600/day = ~220k/year. Small.
- Members: low hundreds at steady state.

These are small for Postgres. Don't over-engineer.

### 8.7 Inter-System Integrations

**System landscape.** Fleximotion's stack is composed of several specialised systems, each API-first and each owning one slice of the data model:

| System | Owns | Examples of Data |
|---|---|---|
| **This TMS** (Management) | Tasks, learning, points, amoebas | BacklogItem, Substrate, LearningEntry, SubstrateRevision, PointsAward, Amoeba, TransferPriceRule, TransferPriceEvent |
| **Ops** | Daily operations and P&L | Operators, vehicles, platforms, daily operations (deliveries, trips, revenue), expenses, AmoebaDay-equivalent P&L, Uber/Bolt/Chowdeck integrations |
| **HR** | Staff records | Person identity, contracts, payroll, contact details, role-in-the-company |
| **Recruitment** | Operator recruitment funnel | Funnel stages, candidate records, training status, onboarding |

Each system is the sole source of truth for its own data. Other systems read via API. There is no duplication.

**What the TMS reads from other systems.**

- From **Ops**:
  - `GET /v1/amoebas/{id}/performance?window=...&period=...` — HE, Utilisation, Revenue, admin hours, active operators count → populates AmoebaPerformanceSnapshot.
  - `GET /v1/amoebas/{id}/expenses?period=...` — for Investment amoeba drawdown tracking.
  - Refresh cadence: configurable, default hourly.
- From **HR**:
  - `GET /v1/users/{hr_user_id}` — display name, email, employment status → caches into Member.
  - On Member-display views the TMS may fetch additional fields (hire date, role) on demand.
- From **Recruitment** (for context display only):
  - `GET /v1/funnel?amoeba_id=...` — current funnel counts for the Coordinator's dashboard.

**What the TMS writes to other systems.**

- To **Ops**:
  - `POST /v1/transfer-price-events` — every TransferPriceEvent the TMS creates is published to Ops so Ops can incorporate it into its amoeba P&L computation. Critical path; retried on failure with admin visibility.
  - Webhook subscription: Ops may also subscribe to the OS's `transfer_price_event.created` webhook for push delivery instead of polling.

**What the TMS exposes for other systems to consume.**

- The OS's full API surface (BacklogItem, Amoeba, LearningEntry, etc.). Any other Fleximotion system can integrate.
- Webhook events: `backlog_item.completed`, `learning_entry.landed`, `substrate_revision.created`, `points_award.issued`, `transfer_price_event.created`, `amoeba.created`, `amoeba.classification_changed`. Other systems subscribe to what they need.
- A read-only listing of Amoebas — Ops and HR consume this to label their own records.

**No bypass paths.** Even the OS's own web UI uses the same public API. There is no internal-only shortcut. This enforces the constraint over time.

### 8.8 Audit and History

Every mutable record (BacklogItem, LearningEntry, SubstrateRevision, TransferPriceRule, AmoebaPerformanceSnapshot, Member designation, PointsAward dispute resolution, Amoeba classification) has full history retained. Standard pattern: an `_history` table per entity, or an event-sourced design for the most-mutated entities. Engineering call. All history is queryable through the API (`/v1/<resource>/<id>/history`).

### 8.9 Observability

- Structured logging with request IDs propagated across services.
- Metrics on API latency, error rates, webhook delivery success, idempotency-key reuse, rate-limit hits.
- An admin-dashboard "system health" view exposes these to management.

---

## 9. Open Decisions

### 9.1 Decisions Made (cumulative through v0.2)

1. **HE name.** ✅ Adopted as "Hourly Efficiency". (In Ops, the equivalent column from the legacy sheet is renamed `Utilisation`.)
2. **Transfer price methodology.** ✅ Cost recovery — provider's relevant cost ÷ projected consumption. Rates entered in admin dashboard.
3. **Trajectory window.** ✅ 4 weeks default, configurable in admin dashboard.
4. **Unpulled aging threshold.** ✅ 7 days default, configurable.
5. **Investment-to-operating conversion.** ✅ 30 days of sustained positive HE as eligibility trigger, configurable. Management sign-off still required.
6. **Internal NPS cadence.** ✅ Quarterly default, configurable. Advisory at v1.
7. **Substrate approval gate.** ✅ Single approver per Substrate; must hold `management` role. One-click approval. Refinement-vs-Structural distinction dropped — single flow.
8. **Supervisor vs Team Coordinator.** ✅ Both roles preserved as distinct member designations. A member can hold both.
9. **Operator-level access.** ✅ No. Operator-facing concerns belong to a separate system.
10. **WhatsApp ingestion.** ✅ Not included. Bloat risk too high for current value. Can be revisited later as a separate optional service writing to the TMS via the public API.
11. **Bonus mechanism.** ✅ Abstracted to a Points system (§5.7). Generation specified. Redemption semantics deferred to a separate management document.
12. **Multi-amoeba membership.** ✅ Not allowed at v1 given three-amoeba topology.
13. **Scope of this system.** ✅ The TMS owns tasks, learning, points, and amoebas. It does NOT own daily operations, P&L, operators, vehicles, platforms, HR data, or recruitment funnel. Single source of truth for every data element. Other systems (Ops, HR, Recruitment) are API-first peers.
14. **Investment amoeba parent.** ✅ Always Central. Investment amoebas are funded by Central, not by operating amoebas.
15. **Value / duration / size estimation.** ✅ Preset bands (Small/Medium/Large for value; Week/Month/Quarter for duration; Hours/Days/Week+ for size). The bands map to configurable NGN/days defaults. Coordinator can override to specific numbers on acceptance. Filing should take ~10 seconds.
16. **Management push.** ✅ Unpulled items can be pushed to a specific member by management in the governance forum. Push events are recorded distinctly from pull so the system can analyse push-vs-pull ratio per amoeba.
17. **Contributor add semantics.** ✅ Either the assignee adds the contributor, or the contributor adds themselves. Coordinator validates at completion.
18. **Learning loop closure.** ✅ Concrete: LearningEntry → BacklogItem (with `linked_learning_entry_id`) → SubstrateRevision (with required `change_url`) → LearningEntry status `landed`. Without `change_url`, the SubstrateRevision form does not submit.
19. **Scoring period.** ✅ Monthly default (configurable to monthly/quarterly/annually).
20. **Curated designations list.** ✅ Members are given admin rights by superadmin. Designation list curated via that same admin path; no separate approval process.
21. **Coordinator for Central.** ✅ Configurable in admin, like every other Coordinator slot. Initial assignment is TBD per §9.2.
22. **Tagging taxonomy.** ✅ Ship with starter defaults, allow to grow organically as supervisors use the system.
23. **API rate limits.** ✅ Engineer's call; start conservative.
24. **Webhook event catalogue.** ✅ Starter set published; other systems read the API spec and propose new events as needed. Drives the upgrade path.
25. **Reporting refresh cadence.** ✅ Hourly.

### 9.2 Open Decisions

Items still requiring management decisions before or at v1 cutover.

1. **Initial Team Coordinator assignments.** Who is the Coordinator for Island, Mainland, and Central at launch? The data-supported recommendation (per §6.2) may favour the accountant for one of the operating amoebas or for Central. Pick at setup.
2. **Cost-recovery basis units.** `per_operator_per_day` is the proposed basis for Central → operating-amoeba transfer pricing, but the exact unit (operators? operator-hours? something else?) is for management to finalise.
3. **Initial NGN values for the band defaults.** Small/Medium/Large value bands, and the days-equivalent for Hours/Days/Week+ size bands. Sensible starting numbers needed for the filing form to be usable on day one.
4. **Initial Points multipliers.** `task_points_multiplier`, `pool_multiplier`, `assignee_share_pct`. v1 ships with `points_enabled = false`; multipliers are finalised before turning the system on (probably 30+ days post-launch once task and HE distributions are observed).
5. **Points redemption semantics.** Separate management document, not blocking this spec.
6. **Substrate registry — final starter list.** Confirmed: software backlog, HR policy document, supervisor training manual, operator training manual. Any others to add at launch?
7. **Inter-system API contract finalisation.** This spec assumes Ops, HR, and Recruitment will all be API-first and serve specific endpoints (§8.7). Those specs need to be drafted and aligned, possibly in parallel.
8. **Sequencing.** If Ops is not online at TMS launch, the TMS runs in "tasks/learning/points-task-only" mode. Confirm sequencing — does TMS launch before, after, or alongside Ops? Affects scope at v1.
9. **`os_role` elevation flow.** A management user can elevate another member to `management` (superadmin path). Define whether this requires a second-approver check, audit notification, or is simply one-click.
10. **Substrate `change_approver_member_id` defaults.** A single management user per substrate. At launch, who approves changes to each starter substrate (HR policy, training manuals, software backlog)? Likely the substrate's domain owner (HR officer for HR policy, etc.), elevated to `management` role.

---

## 10. Glossary

- **Amoeba.** A small accountable team (3–7 admin) classified as operating, investment, or shared-services. P&L is computed by Ops; the TMS owns the amoeba structure and the management workflows on top.
- **AmoebaPerformanceSnapshot.** A cached read of an amoeba's HE, Utilisation, Revenue, and headcount from Ops at a point in time. The TMS pulls these on a configurable cadence (default hourly) and uses them for Trajectory, Theoretical HE, Points, and dashboards.
- **API-First.** The TMS exposes every domain capability via a versioned public API; the web UI is one consumer among many. No business logic lives outside the API. Every Fleximotion system follows the same principle.
- **Band (Value / Duration / Size).** Preset radio-button selections on the BacklogItem filing form. Map to configurable NGN/days defaults so filing is fast. Coordinator can override to specific numbers on acceptance.
- **CoD (Cost of Delay).** The value lost by not doing a task this week. Used in the silent WSJF calculation.
- **HE (Hourly Efficiency).** Primary amoeba metric. Defined and computed by Ops; read into the TMS via AmoebaPerformanceSnapshot.
- **Internal NPS.** Periodic survey of operating amoebas rating shared-services amoebas 0–10. Default quarterly. Advisory at v1.
- **Investment Amoeba.** Loss-making by design, funded by Central, held to dated Thesis milestones rather than HE.
- **Learning Entry.** A recorded insight. Reaches `landed` status only when one or more SubstrateRevisions are linked with verifiable `change_url`s.
- **Operating Amoeba.** Held to HE + Trajectory. P&L computed in Ops.
- **Points.** Abstract unit recording contribution to value creation. Generated from completed BacklogItems (task points) and end-of-period amoeba performance (pool points). Redemption semantics deferred.
- **Pool Points.** Points awarded to all members of an operating amoeba at end of scoring period (default monthly) if the amoeba had positive HE and positive Trajectory. Distributed proportionally to hours worked.
- **Pulled / Pushed / Allocated.** A BacklogItem is **pulled** when a member of the owning amoeba self-selects it; **pushed** when management assigns it to a specific member after unpulled aging; **allocated** when filed by a different amoeba (which triggers a transfer-price charge regardless of how it's eventually worked).
- **RUG.** Company-level KPI bundle: Revenue, Asset Utilisation, Growth. Read from Ops.
- **Shared-Services Amoeba.** Provides internal services (Central in v1). Held to Cost-as-Share and Internal NPS. Charges back via Transfer Price rules.
- **Single Source of Truth.** Every data element has exactly one owning system in the Fleximotion stack. No duplication.
- **Substrate.** A registered durable artefact where learning lands. Examples at Fleximotion: the software backlog, the HR policy document, the supervisor training manual, the operator training manual.
- **SubstrateRevision.** A recorded change to a Substrate, with a required `change_url` linking to the actual revision in the substrate's home system. The artefact that closes the learning loop.
- **Supervisor.** Member designation for the role that supervises operators in the field. Distinct from Team Coordinator. A member can hold both.
- **Task Points.** Points awarded on completion of a BacklogItem, derived from its WSJF score. Split between assignee (default 50%) and declared contributors.
- **Team Coordinator.** The amoeba's accountable management lead — owns HE outcomes, prioritises the backlog, accepts or rejects incoming BacklogItems, validates contributor lists. One per amoeba.
- **Theoretical HE.** What an amoeba's HE would be at 100% utilisation given current operator headcount and typical revenue per unit. The gap between Theoretical and actual HE is a diagnostic conversation piece.
- **Trajectory.** Growth-of-HE metric, computed by the TMS from HE snapshots. (HE rolling N-week mean) ÷ (HE rolling N-week mean, N weeks prior) − 1. N configurable, default 4.
- **Transfer Price.** Internal rate charged when one amoeba does work for another. Cost-recovery basis. Rates entered in admin dashboard. Events are published to Ops so amoeba P&L reflects them.
- **Utilisation.** Operator hours worked ÷ expected operational hours. Owned by Ops.
- **WSJF.** Weighted Shortest Job First. Backlog-prioritisation score: value_per_week ÷ size. Computed silently; never shown directly to users.

---

*End of v0.2. Next iteration after Wole's review of the rescoped §1–§8 and management decisions on §9.2.*
