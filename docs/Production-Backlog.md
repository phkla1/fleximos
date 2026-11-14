# FlexiMOS — Production Backlog

Improvements captured from real use, starting with the first onboarding sessions (Nov 2026). Append new items at the bottom; keep each one concrete enough to act on later. Status: `open` → `in progress` → `done`.

| # | Title | Raised | Status |
|---|---|---|---|
| 1 | Batch upload for personnel (staff) | 2026-11-14 | open |
| 2 | Warn in "new user" dialog when the person already has a login | 2026-11-14 | open |
| 3 | Sites lat/lng reject high-precision coords from Google Maps | 2026-11-14 | open |
| 4 | Fold hospital geocoding into the importer (background) | 2026-11-14 | open |
| 5 | Speedaf pull crash takes down ops-api (unhandled rejection) | 2026-11-14 | open |
| 6 | Inventory management (batteries, chargers, parts) | 2026-11-14 | open |
| 7 | Align DestinyO email to the username convention (deferred) | 2026-11-14 | open |
| 8 | No obvious way to move an amoeba from one site to another | 2026-11-14 | open |
| 9 | Staff users carry an unneeded `operator` role | 2026-11-14 | open |

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

## 5. Speedaf pull crash takes down ops-api (unhandled rejection)
**Raised:** 2026-11-14 (noticed while deploying operator changes) · **Status:** open

On **prod**, the scheduled Speedaf delivery pull threw an uncaught error on 2026-11-12 that crashed the whole ops-api process (pm2 restarted it several times; stable afterwards). A single connector failure should never take down the API.

**Observed stack:**
```
browserContext.waitForEvent: Target page, context or browser has been closed
  at SpeedafConnector.pullTodayRows (apps/ops-api/src/connectors/speedaf.connector.ts:115)
  at async DeliveriesImportService.pullSpeedaf (apps/ops-api/src/deliveries-import.service.ts:462)
  at async JobRunnerService.execute (apps/ops-api/src/job-runner.service.ts:92)
  at async JobRunnerService.runNext (apps/ops-api/src/job-runner.service.ts:66)
  at async Timeout._onTimeout (apps/ops-api/src/main.ts:50)
```
It surfaced as a `triggerUncaughtException` (an unhandled promise rejection escaping the job timer), so Node exited.

**Fixes to consider:**
- Harden the Speedaf connector: wrap `pullTodayRows` so a closed/crashed Playwright context is caught and the run is marked failed (not thrown past the job runner); always close the browser in a `finally`.
- Defensive: the job runner's timer callback (`main.ts:50` / `runNext`) should never let a job's rejection become an uncaught exception — catch at the scheduler boundary and record a failed run.
- Add a process-level `unhandledRejection` handler that logs and keeps serving, as a last resort.
- Playwright/Chromium headless on the box can be flaky under memory/zombie conditions — consider a retry with a fresh context (the connector already has a retry helper for the ride connectors).

**Impact:** medium-high — a delivery-connector hiccup shouldn't interrupt the whole ops API (dashboards, ingest, alerts). Not a blocker today (it recovered), but should be hardened before heavy production reliance.

## 6. Inventory management (batteries, chargers, parts)
**Raised:** 2026-11-14 (vehicle import) · **Status:** open

The fleet sheets carry more than bikes. The Tankvolt workbook's `EV BIKE TANKVOLT` tab stacks, under one `Type` column: **Motorcycle** rows (the bikes), **Battery** rows (serials like `BT207205015HYCY260225123`), and **Charger** rows (serials like `22016050005`). The vehicle importer now imports only the Motorcycle rows and **skips** Battery/Charger as "not a vehicle (inventory)". We need a proper home for that inventory.

**Scope to design:**
- **Batteries**: serial, model, state (in service / spare / damaged), and association to a bike. Per [[tankvolt-battery-vehicle-association]], Tankvolt auto-links a battery to a bike and we track/control by VIN — so battery↔bike likely comes from the Tankvolt side, with the sheet as a cross-check/seed.
- **Chargers**: serial, location/site, state.
- **Spares/parts** generally (helmets, boxes, tyres…) — same pattern, lower priority.
- An importer for these (same engine: multi-sheet, header detection, dedupe by serial), and an ops-admin/inventory surface to view/assign.
- Decide whether inventory lives in ops-api beside vehicles or its own module.

**Why now:** staff are uploading fleet sheets today that contain this data; for the moment it's silently skipped on vehicle import (surfaced as skip rows), so nothing is lost but nothing is captured either.

## 7. Align DestinyO email to the username convention (deferred)
**Raised:** 2026-11-14 (FemiM login ticket) · **Status:** open

The staff login username is the email's local part, and the convention is email = display-name lowercased (`femia`, `kennedya`, `nikeo`…). Two staff were created with **first-name-only** emails:
- **FemiM → `femi@`** — FIXED 14 Nov (people row updated to `femim@fleximotion.online` after he couldn't log in as "femim").
- **DestinyO → `destiny@`** — NOT changed, intentionally deferred: he has **already logged in successfully** as `destiny`, so flipping the email to `destinyo@` now would break his working login.

**To do (coordinated):** change DestinyO's email `destiny@` → `destinyo@fleximotion.online` at a point where it won't disrupt him (tell him the new username first, or do it when he's not mid-shift). `UPDATE people SET email='destinyo@fleximotion.online' WHERE display_name='DestinyO';` (foundation DB) — or via the HR console once the service-token/API path is sorted.

**Root cause / prevention:** manual staff creation lets the email drift from the username people expect. The **personnel batch importer (backlog #1)** auto-generates `display_name` and should generate the email from the same rule, eliminating this class of ticket. Consider also auto-deriving/validating email ↔ display-name on manual create. (Minor related note from this ticket: the foundation `/identity` API rejected an ad-hoc service-token call during debugging while the app's own internal calls worked — worth a quick check that the service token path is consistent, though it isn't affecting users.)

## 8. No obvious way to move an amoeba from one site to another
**Raised:** 2026-11-14 (HR) · **Status:** open

HR wanted to move the **Kainji** amoeba to the **Egbeda** site and found no obvious route. Site↔amoeba is M:N and the Sites page lets you *share* a site with additional amoebas and *unshare* non-primary links — but there's no clear "move this amoeba to a different site" action, and an amoeba's **primary** site link can't be removed at all (hard-guarded), so you can't move an amoeba off its primary site.

**Improvement:** an amoeba-centric way to manage its site(s) — e.g. on the Amoebas page (or the amoeba row), show its site(s) and allow "move to / set primary site" (swap the primary link) and add/remove shared sites, mirroring how operators are placed into amoebas. Decide what "primary site" means operationally (geofence/accommodation anchor) and allow it to change, not just add.

## 9. Staff users carry an unneeded `operator` role
**Raised:** 2026-11-14 (roster UI questions) · **Status:** open

Staff created in the HR console came through with `operator` in their roles alongside their real role (e.g. `["supervisor","operator"]`, `["admin","operator"]`, `["manager","finance","operator"]`). Consequence: those staff appear in ops-admin's **Add-operator → Person** dropdown (which lists people who have the `operator` role but no operator record yet), cluttering it with supervisors/admins who shouldn't be turned into operators. It's otherwise harmless — the supervisor data-scope fallback still works because it keys on the `supervisor` role.

**To do:**
- Remove the `operator` role from staff users who aren't actually operators (keep `supervisor`/`admin`/`manager`/`finance`). On prod the affected users are the `@fleximotion.online` staff (DestinyO, NikeO, FemiM, TunjiA, FemiA, SanusiT, MuyiwaO, …) — verify each before stripping, in case any genuinely also rides.
- Prevent recurrence at the source: don't default-add `operator` when creating a staff user in the HR console (and/or the personnel importer, backlog #1, should only set the roles given).

**Note:** low priority / cosmetic (dropdown hygiene); do it when convenient, ideally alongside #1 and #7 as one identity-cleanup pass.
