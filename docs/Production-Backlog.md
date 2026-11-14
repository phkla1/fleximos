# FlexiMOS — Production Backlog

Improvements captured from real use, starting with the first onboarding sessions (Nov 2026). Append new items at the bottom; keep each one concrete enough to act on later. Status: `open` → `in progress` → `done`.

| # | Title | Raised | Status |
|---|---|---|---|
| 1 | Batch upload for personnel (staff) | 2026-11-14 | open |
| 2 | Warn in "new user" dialog when the person already has a login | 2026-11-14 | open |
| 3 | Sites lat/lng reject high-precision coords from Google Maps | 2026-11-14 | open |
| 4 | Fold hospital geocoding into the importer (background) | 2026-11-14 | open |

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

## 3. Sites lat/lng reject high-precision coordinates (Google Maps paste)
**Raised:** 2026-11-14 (first onboarding session) · **Status:** open

Pasting a coordinate copied from Google Maps (e.g. `3.4780440520406373`) into the **Sites** latitude/longitude fields is rejected, instead of being accepted and rounded.

**Cause:** frontend only. hr-admin-console `index.html` lines 234-235 use `<input type="number" step="0.000001">`; the browser's native step validation (`stepMismatch`) rejects any value that isn't an exact multiple of 0.000001, so a 16-decimal paste fails. The backend accepts any in-range number (`gps_lat`/`gps_lng` are `DOUBLE PRECISION`; validation only checks −90..90 / −180..180 + NaN), so nothing server-side needs changing.

**Fix:** change the inputs to `step="any"` and round/truncate to ~6 decimal places (≈0.11 m — ample) on input or before submit, so a long paste is silently normalised rather than blocked. Quick one-liner; still goes QA → prod per the no-straight-to-prod rule.

## 4. Fold hospital geocoding into the importer (background)
**Raised:** 2026-11-14 (first onboarding session) · **Status:** open

Today HR must run a separate CLI (`tools/geocode-hospitals/geocode.mts`) on the raw facilities sheet to add `lat`/`lng`/`coords_quality` before the hospital importer will plot them. That's friction for a non-technical HR flow.

**Why it's separate now:** the geocoder uses OSM **Nominatim** (free, no key) which caps at **1 request/second** and wants a descriptive User-Agent. Doing that inside the upload request would hang for minutes / time out and risk the server IP being throttled. Coordinates are therefore geocoded once, offline, and baked into the data so the ops-api never geocodes at runtime. Quality is tagged `street` / `lga_centroid` / `failed`.

**Improvement:** let HR upload the **raw** sheet (no coords). The importer persists facilities immediately with coords blank, then a **background worker** geocodes them at ≤1/sec (reusing the existing cache + street→LGA-centroid fallback + quality tagging) and fills them in; they appear on the map as they resolve. No CLI, no separate file.

**Notes for implementation:**
- Reuse the logic in `tools/geocode-hospitals/geocode.mts` (Nominatim call, Lagos viewbox bias, 1.1s throttle, JSON cache, centroal fallback, quality tags) — lift it into an ops-api service + a queued job rather than duplicating.
- Persist the cache in the DB (or the doc store) so it survives restarts and is shared across monthly sheets.
- Import stays idempotent; re-running a sheet should only geocode genuinely new addresses.
- Surface per-facility `coords_quality` in the ops-admin hospitals view so `lga_centroid`/`failed` rows can be eyeballed/corrected (the sites lat/lng paste fix, item 3, helps here).
- Keep the CLI as a fallback/bulk path.
