# FlexiMOS — Production Backlog

Improvements captured from real use, starting with the first onboarding sessions (Nov 2026). Append new items at the bottom; keep each one concrete enough to act on later. Status: `open` → `in progress` → `done`.

| # | Title | Raised | Status |
|---|---|---|---|
| 1 | Batch upload for personnel (staff) | 2026-11-14 | open |

---

## 1. Batch upload for personnel (staff)
**Raised:** 2026-11-14 (first onboarding session) · **Status:** open

Today staff are created one at a time in hr-admin → People; only operators/vehicles/hospitals have a batch importer (`apps/ops-api/src/batch-import.service.ts`). Add a **personnel/staff batch importer** so a whole intake can be loaded from a sheet.

**Columns:** `Name` · `phone number` · `NIN` · `email`.

**Auto-generated display name:** full first name + the first letter of the surname, capitalised — e.g. **Nike Omese → `NikeO`**. (So the importer derives `display_name` from `Name`; the operator never types it.)

**Notes for implementation:**
- Mirror the existing importer conventions: header-alias mapping, dry-run by default, idempotent, strong-key (NIN/phone) de-dupe so re-runs don't duplicate people.
- Creating the *person* is step one; whether the same sheet also provisions a *login + role* (or that stays manual) is an open design question — decide when building.
- Settle the display-name edge cases at build time (single-word name, multiple surnames, duplicate generated names).
