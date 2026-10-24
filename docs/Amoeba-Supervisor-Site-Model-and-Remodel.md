# Amoeba / Supervisor / Site — Canonical Model & Remodel Map

**Status:** proposed — supersedes the conflicting definitions in `NEW-Fleximotion-Ops-Spec-v0.4.md` and `Fleximotion-Ops-DB-Schema-v1.0.sql`.
**Date:** 2026-10-23.
**Why this exists:** v0.4 is internally inconsistent about the amoeba↔supervisor relationship. Its prose mostly treats an amoeba as *one supervisor's* unit ("the supervisor's amoeba", "sees own team/amoeba", supervisor closeout finalises "the amoeba's" daily summary), but a single line — "groups operators **and supervisors**" — and the schema comment say otherwise. What's built followed the inconsistent reading, so `supervisor_person_id` lives on the operator independently of the amoeba. This document fixes the definition and maps the work to bring the build in line.

---

## Part A — Canonical definitions (source of truth)

### Amoeba
A **group of operators managed by exactly one supervisor**. It is the unit of **cost and P&L accountability** and the unit of **performance measurement**. An amoeba is *not* a physical location; it operates from one or more sites.

- Exactly **one** supervisor.
- Holds **all costs / P&L**. (Sites hold none.)
- Performance is reported **per amoeba** and never merged with another amoeba — even when two amoebas share the same supervisor.

### Supervisor
The person who runs an amoeba. A supervisor may run **one or more amoebas**. Each of their amoebas is measured **separately and distinctly** — their figures are never summed into a single "supervisor" total.

### Site
A **real GPS location** (name, coordinates, alert radius, and likely more attributes over time). A site is **first-class and shareable**: the same physical site can host **multiple amoebas**. A site holds **no costs** — cost always belongs to an amoeba.

### Operator
A rider or driver. Belongs to **exactly one amoeba** (and therefore has exactly one supervisor, *derived from the amoeba*). Is physically based at a **site** that the operator's amoeba operates from.

### Team
**Not a separate concept — "team" *is* an amoeba.** Because an amoeba has exactly one supervisor, a supervisor's "team" and their amoeba are the same thing. The word "team" should be retired from the product in favour of "amoeba" (or kept only as a synonym in copy).

### Amoeba-fixed roles (beyond supervisor and operator)
An amoeba has one **supervisor** (its accountable leader for revenue and cost) and its **operators**. It will also, over time, have **other roles fixed to the amoeba** — the first known example is a **customer-service person in every amoeba**. The "team coordinator" idea is dropped; the general pattern of amoeba-attached staff roles beyond supervisor/operator stays. These additional roles are **not** modelled in this remodel, but the design must not bake in a supervisor-only assumption. Likely home: amoeba-scoped **Identity role-assignments** (role = e.g. `customer_service`, `scope_type = amoeba`), which already exist and also give those people amoeba-scoped visibility; staff roles that carry salary feed the amoeba's cost/P&L. To be specced separately.

### Cardinalities

| Relationship | Cardinality | Notes |
|---|---|---|
| Supervisor → Amoeba | **1 : N** | one supervisor runs ≥1 amoeba; each amoeba has exactly one supervisor |
| Amoeba → Supervisor | **N : 1** | the amoeba's one supervisor |
| Amoeba ↔ Site | **M : N** | an amoeba spans ≥1 site; a site hosts ≥1 amoeba |
| Amoeba → Operator | **1 : N** | an operator belongs to exactly one amoeba |
| Operator → Site | **N : 1** | operator based at one site, which must be a site its amoeba operates from |
| Costs / P&L | **Amoeba only** | sites carry none |
| Performance | **Per amoeba** | never merged across a supervisor's amoebas |

### What this corrects

| Claim in v0.4 / schema | Corrected |
|---|---|
| "amoeba groups operators **and supervisors**" (v0.4:281, schema:112) | An amoeba has **exactly one** supervisor. |
| AmoebaSite = "within an amoeba"; a site belongs to one amoeba (FK `amoeba_sites.amoeba_id`) | A **site is shareable**; amoeba↔site is **many-to-many**. |
| `operator.supervisor_person_id` set independently of the amoeba | Operator's supervisor is **derived from its amoeba**. |
| "team" as a distinct grouping (`supervisor × amoeba`) | **team = amoeba**; retire the separate term. |

---

## Part B — Remodel map

### B0. As-built today (the starting point)

- **Foundation** owns the org model: `amoebas (amoeba_id, name, classification, status, parent_amoeba_id, coordinator_person_id)` — **no supervisor field** — and `amoeba_sites (site_id, amoeba_id NOT NULL, gps, radius, is_primary, status, UNIQUE(amoeba_id,name))` — **site belongs to one amoeba**.
- **Ops** `ops_operators` carries `amoeba_id`, `site_id` (NOT NULL, single), and an **independent** `supervisor_person_id`.
- **Scoping** (`auth.service.dataScope`) treats `amoeba`, `site`, and `team` (= a supervisor's operators) as three separate scope types.
- **Daily closeout** keyed `(record_date, amoeba_id, supervisor_person_id)`.
- `supervisor_person_id` referenced across **8 ops-api files** (~31 in `ops.service.ts`); "team" vocabulary across **5 consoles**.

### B1. Target data model

**Foundation**
1. **Amoeba gains its supervisor — by repurposing the coordinator slot.** The "team coordinator" concept is dropped (see Q1 resolution). The amoeba's single accountable person is the **supervisor** (owns revenue *and* cost/P&L). **Rename `amoebas.coordinator_person_id` → `supervisor_person_id`** (and `POST /amoebas/{id}/assign-coordinator` → `assign-supervisor`; the hr-admin "Coordinator" dropdown → "Supervisor"). Nothing scopes or computes off the current coordinator field, so this is a rename, not a new field. *Other* amoeba-fixed roles (customer-service, etc.) are a known future need — see "Amoeba-fixed roles" below — but are **not** built in this remodel.
2. **Site becomes first-class.** Split `amoeba_sites` into:
   - `sites (site_id, name, address, gps_lat, gps_lng, alert_radius_m, parking_capacity, battery_charge_capacity, accommodation_capacity, status, …)` — a real location, **no `amoeba_id`, no costs**. Capacities are counts (`accommodation_capacity` may be `0` = no accommodation).
   - `amoeba_sites (amoeba_id, site_id, is_primary)` — the **M:N** join; `is_primary` (one primary site per amoeba) moves here.
3. Migration: every existing `amoeba_sites` row → one `sites` row + one `amoeba_sites` link, `is_primary` carried onto the link. No data loss. (Optional later: dedupe co-located sites that were duplicated per amoeba.)

**Ops**
4. **Operator supervisor becomes derived (resolved — Q2).** **Drop `ops_operators.supervisor_person_id`**; resolve supervisor by joining operator → amoeba → `amoebas.supervisor_person_id` at read time. The operator's supervisor is, by definition, the supervisor of their amoeba.
5. **Operator.site must belong to the operator's amoeba (one site — resolved Q5).** Operator keeps a **single** `site_id`; validate `site_id ∈ sites linked to amoeba_id` on create/update (today there's no such check).
6. **Closeout key** `(record_date, amoeba_id, supervisor_person_id)` → `(record_date, amoeba_id)` — supervisor is implied by the amoeba. Per-amoeba measurement is already what the amoeba-keyed closeout does, so the "separate per amoeba for the same supervisor" rule (point A) is satisfied for free.

### B2. Service / API layer
7. **Scoping.** Collapse `team` scope into amoeba: a supervisor's reach = the amoebas where `amoebas.supervisor_person_id = them` (1:N). `dataScope` returns amoeba ids for a supervisor instead of `supervisor_person_ids`. Keep `site` scope only if a real use exists; otherwise drop it.
8. **Every `supervisor_person_id` read path** (attendance, deliveries, depth, tracker-ingest, onboarding, ops) switches to "the amoeba's supervisor." With Q2(b) the field stays and little changes; with Q2(a) these join through the amoeba.
9. **Supervisor onboarding** ("graduate to a target amoeba") already assumes supervisor⇄amoeba — align it so graduation **sets `amoebas.supervisor_person_id`**.

### B3. UI layer (5 consoles)
10. **Retire "team" → "amoeba."** Remove the derived `supervisor × amoeba` grouping and the **Team** filters (ops-admin roster/vehicles/performance); amoeba filters already exist and become the single lens. The "Team summary / team board" becomes the **amoeba** summary.
11. **Operator roster form.** The **Supervisor** dropdown is **removed** — picking the amoeba sets the supervisor. (This retires the amoeba-scoped-supervisor filter and the inline supervisor reassignment we just built; reassigning an operator's supervisor becomes "move the operator to a different amoeba," and changing an amoeba's supervisor is an amoeba-level edit.)
12. **Amoeba admin** (hr/TMS console) gains: set the amoeba's supervisor; manage the amoeba's **sites** as an M:N picklist (attach existing shared sites, mark one primary).
13. **Supervisor (ops) console** already frames everything as "their amoeba(s)"; adjust copy from "team" and support a supervisor who owns **several** amoebas (amoeba switcher / per-amoeba sections), each measured separately.

### B4. Reports / P&L
14. P&L is already amoeba-keyed (costs on the amoeba) — consistent with the model; confirm no report sums across a supervisor's amoebas.
15. Any report grouped by "supervisor" must group by **amoeba** (and may *list* the supervisor), never merge a supervisor's amoebas.

### B5. Tests & docs
16. Update seeds/fixtures (amoeba gains a supervisor; sites become shared), e2e that assert team filters / the supervisor dropdown (several we just added), and the onboarding flow.
17. Rewrite the amoeba/site/supervisor sections of v0.4 and the v1.0 schema to match Part A; link them here.

### Suggested sequencing
- **Phase 1 — Foundation model:** `amoebas.supervisor_person_id`, split sites to `sites` + `amoeba_sites` join, migrate. (Backend + migration only; UI unaffected if ops keeps reading the same ids.)
- **Phase 2 — Ops derivation & scoping:** operator supervisor derives from amoeba (Q2), site∈amoeba validation, closeout key, `dataScope` collapse of team→amoeba.
- **Phase 3 — UI fold:** retire "team," drop the operator Supervisor dropdown, amoeba-site management UI, supervisor-with-many-amoebas UX.
- **Phase 4 — Docs/tests/reports** cleanup.

Each phase is independently shippable and leaves the system working.

---

## Decisions

- **Q1 — Supervisor vs coordinator — RESOLVED (no coordinator; supervisor is the one accountable role):** the old spec's "team coordinator" (a separate TMS management leader) is **dropped**. The amoeba's single accountable person is the **Supervisor**, who owns **revenue *and* cost/P&L**. Implementation: **rename the existing `coordinator_person_id` → `supervisor_person_id`** (repurpose the slot; it's lightly used and nothing computes off it). The general idea of **amoeba-fixed roles beyond supervisor/operator remains valid** (e.g. a customer-service person per amoeba) — modelled later, not here; see "Amoeba-fixed roles" in Part A.
- **Q2 — Operator supervisor storage — RESOLVED:** derive by join (operator → amoeba → supervisor); drop the independent column.
- **Q4 — Site attributes — RESOLVED:** site carries `address`, `parking_capacity` (vehicles it can park), `battery_charge_capacity` (swap-station slots), `accommodation_capacity` (operators it can house, `0` = none), plus name/GPS/`alert_radius_m`. **Q4a — RESOLVED:** `accommodation_capacity` is a **plain standalone number** on the site for now, even though it overlaps the existing `ops_accommodation_units` model (finite beds with hard capacity/occupancy); reconcile the two in a later pass. Likewise `parking_capacity`/`battery_charge_capacity` are site facts now and may tie into the vehicle/battery subsystems later.
- **Q5 — Operator ↔ site — RESOLVED:** strictly **one** site per operator.

- **Q3 — Shared-site de-duplication on migration — RESOLVED:** **no merge.** Migrate every existing `amoeba_sites` row 1:1 into its own `sites` row; share only going forward via the new M:N join. Dedupe by hand later if real duplicates surface.

**All open decisions are now resolved. Phase 1 is ready to start on Wole's go-ahead.**
