# FlexiMOS — Production Backlog

Improvements captured from real use, starting with the first onboarding sessions (Nov 2026). Append new items at the bottom; keep each one concrete enough to act on later. Status: `open` → `in progress` → `done`.

| # | Title | Raised | Status |
|---|---|---|---|
| 1 | Batch upload for personnel (staff) | 2026-11-14 | open |
| 2 | Warn in "new user" dialog when the person already has a login | 2026-11-14 | open |

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

## 2. Warn in "new user" dialog when the person already has a login
**Raised:** 2026-11-14 (first onboarding session) · **Status:** open

The duplicate-login guard is backend-only: `POST /identity/v1/users` returns `409 duplicate_user` ("This person already has an active user account — edit that account instead of creating another.") — so it only fires **after** you fill the form and click **Create user**. There's no selection-time cue.

**Improvement:** surface it in the hr-admin → Users & roles dialog *before* submit — e.g. flag/grey out (or filter) people who already have an active login in the person picker, and/or show an inline notice the moment such a person is selected, pointing to "edit that account instead."

**Notes for implementation:**
- Data is already available: the users list exposes `person_id` per active login, so the dialog can cross-reference the person picker without a new endpoint.
- Keep the backend 409 as the hard guard; this is purely a UX pre-warning.
