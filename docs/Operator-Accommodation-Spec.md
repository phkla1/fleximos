# FlexiMOS — Operator Accommodation Spec

**Status:** APPROVED for build (2026-09-26). Small, self-contained feature.
**Owner decisions:** finite capacity is the point; deactivation frees a slot;
report **indicator only** (no target/pace change); units **not** amoeba-scoped
(v1); assigning to a full unit is a **hard block**.

## 1. Problem
The company houses some riders. Housing is **finite**, so we must know how much
space exists and how much is used. Accommodation also carries an expectation:
the ₦30k daily target assumes accommodation; ~₦25k is acceptable from a
non-accommodated rider. We do **not** encode that in the pace engine — we simply
make accommodation status **visible** on performance surfaces so a human reads the
numbers fairly.

## 2. Model (ops-api — one service)
- **`ops_accommodation_units`** — a place with beds:
  `accommodation_unit_id, name, location (free-text), capacity (int ≥ 0),
  status ('active'|'inactive'), created_by_person_id, created_at, updated_at`.
  No amoeba reference (untied, per decision).
- **`ops_operators.accommodation_unit_id`** (nullable) — the unit a rider occupies.
- **Occupancy** of a unit = count of operators currently assigned to it. Because
  assignment is cleared when an operator leaves active status, the bed reopens on
  its own.
- **Capacity is hard:** assigning an operator to a unit whose occupancy is already
  at `capacity` is refused (409). Occupancy can never exceed beds.
- **Deactivation frees the slot:** when an operator moves to `inactive` or
  `suspended`, `accommodation_unit_id` is set null. Re-activation does not
  auto-restore it (re-assign explicitly).
- **Delete a unit only when empty** (no occupants); otherwise mark it `inactive`.

## 3. Endpoints (ops-api, system-admin for mutations)
- `GET /ops/v1/accommodation-units` — units with `occupied` + `available` counts.
- `POST /ops/v1/accommodation-units` — create.
- `PATCH /ops/v1/accommodation-units/:id` — edit name/location/capacity/status
  (cannot set capacity below current occupancy).
- `DELETE /ops/v1/accommodation-units/:id` — only when empty.
- Assignment reuses `PATCH /ops/v1/operators/:id` with `accommodation_unit_id`
  (allowed field) — enforces the hard capacity block and clears on deactivation.

## 4. Surfaces (ops-admin-console)
- **Accommodation** view (Manage group, beside Roster/Vehicles): each unit as
  `occupied / capacity` with a create/edit form; full units are visible as full.
- **Roster** operator form + inline edit gain an **Accommodation** picker (unit or
  "None"); units at capacity are shown disabled.
- **Indicator only:** an "Accommodated · <unit>" vs "Not accommodated" chip on
  **team-board operator tiles** and on **performance / daily-report operator rows**.
  No target math changes.

## 5. Out of scope
- No accommodation-based targets or pace logic (the ₦30k stays ₦30k).
- No Finance/rent/payroll/deduction.
- No amoeba scoping, no bed-level or room-level detail, no request/approval flow.
- No hr-admin surface (accommodation is an ops/roster concern for v1).

## 6. Acceptance
1. Create a unit with capacity 2; assign two active operators → third assignment
   is refused (409, hard block).
2. Deactivate an assigned operator → the unit's occupancy drops and the slot is
   free for a new assignment.
3. The team board and performance rows show an accommodation chip; no target or
   pace value changes because of accommodation.
4. A unit cannot be deleted while occupied, and its capacity cannot be set below
   current occupancy.
5. Suite standards: OpenAPI, API tests, Playwright.
