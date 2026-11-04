# FlexiMOS Pre-Production Build Plan

_Status: approved to start Phase A. Last updated 2026-11-03._

This is the sequenced build plan for the remaining pre-production / go-live work,
derived from the production-readiness gate. It is a living document — each phase
is specced in detail in chat before building (per the team's spec-review habit),
and this file tracks scope, dependencies and status.

## Framing

UAT is a 12-stage process; as of 31 Oct 2026 we are on **stage 7 of 12**. This
plan is the go-live gate, not a signal to run a readiness review mid-UAT.

## Dependency spine

```
A ─ Document storage (adapter + Seafile + PDF + body limit + link table + scoped reads)
│     ├─ B ─ Operator & vehicle papers UI
│     ├─ E ─ Fuel/charge receipts
│     └─ (C attaches docs via A, but import itself is independent)
C ─ Batch importers (operators, vehicles, VIN) ── independent of A
D ─ Revenue-history importer (Speedaf + Bolt) ──── independent
F ─ HMO hospitals + Leaflet layer ──────────────── independent
G ─ Web Push for SOS ───────────────────────────── independent
```

A is the keystone (B, C, E hang off it). After A, C/D/F/G can reorder freely.

## What already exists (verified 2026-11-03)

- **A working media pipeline** in `apps/ops-api/src/depth.service.ts`: `POST /ops/v1/media`
  (base64 → disk + `ops_media_files` row), `GET /ops/v1/media/:id` (metadata),
  `GET /ops/v1/media/:id/content` (bytes). Attached via `media_ids` JSONB on
  incidents / inspections / maintenance. Client upload proven from the PWA camera
  and a file-picker in `apps/ops-console/assets/app.js`.
- **A dependency-free `.xlsx` reader** (`apps/ops-api/src/xlsx-lite.ts`) and a proven
  `file_base64` → parse → fold importer (`apps/ops-api/src/deliveries-import.service.ts`).
- **Create routes**: `POST /ops/v1/operators`, `/vehicles`, `/fuel-issues`; foundation
  `POST /identity/v1/people`, `/users`, `/role-assignments`.
- **ops-api already writes to foundation with a service token** (e.g. PIN reset via
  `POST /identity/v1/users/:id/reset-pin`), so the operator importer needs no new
  cross-service plumbing.
- **Roles**: HR = `owner`/`admin` (`systemAdminRoles` in `auth.service.ts`); supervisor
  scoping and owner=operator person_id already resolved there.
- **Leaflet 1.9.4** is the map in ops-console and manager-console.
- **Both the rider PWA and the supervisor app already ship `service-worker.js`.**

## Verified rework risks (all resolved / planned)

- **Body size limit** is unset in `apps/ops-api/src/main.ts` (Nest 11 default ≈100kb).
  Documents would 413 → Phase A sets it explicitly (~16MB).
- **Role scoping** maps cleanly (HR = owner/admin; owner = the rider).
- **Operator importer cross-service writes** use the existing service-token pattern.

---

## Storage architecture — Seafile from the start, cleanly separated

**Decision (2026-11-03):** implement Seafile as the production document backend now,
behind a storage-adapter interface, with its admin/staff side kept fully separate
from FlexiMOS.

- **`DocumentStore` interface** with `put` / `get` / `delete`; `ops_media_files` gains
  `storage_backend` so each file records where it lives.
- **`LocalDiskStore`** — wraps the existing `fs` calls. Remains the **test/dev/CI
  default** (hermetic; no external dependency in unit/e2e).
- **`SeafileStore`** — the **production** backend. Talks to Seafile's Web API using
  **one FlexiMOS service account + one private library**, via a config flag
  (`FLEXI_DOC_STORE=local|seafile`). No schema or API change to switch — `storage_path`
  is opaque and never leaves the server.
- **Per-kind routing:** operational camera media (incident / inspection / POD photos —
  high volume, latency-sensitive, tied to SOS) stays on local disk; the **document
  kinds** (employment files, vehicle papers, receipts) go to the configured store
  (Seafile in production). SOS photo capture never depends on Seafile uptime.
- **Separation of concerns:** Seafile runs standalone with its own admin for the staff
  Drive replacement. FlexiMOS owns exactly one private library through a service
  account, never calls Seafile admin/user APIs, and never surfaces Seafile
  administration. If the FlexiMOS token leaks it reaches only that one library.
- **Access stays in FlexiMOS:** the FlexiMOS library is **not** shared to staff inside
  Seafile — exposing it there would bypass the HR/admin+owner scoping. All reads of
  FlexiMOS documents go through FlexiMOS, which enforces scope and streams the bytes.

### Seafile API shape (for `SeafileStore`)

- Auth: service-account API token (`/api2/auth-token/` or a provisioned token).
- Upload: `GET /api2/repos/{repo}/upload-link/` → `POST` multipart to the returned URL.
- Download: `GET /api2/repos/{repo}/file/?p={path}` → `GET` the returned link.
- Delete: `DELETE /api2/repos/{repo}/file/?p={path}`.
- Path convention: `/{owner_type}/{owner_id}/{doc_type}/{media_id}.{ext}`.
- Config: `FLEXI_DOC_STORE`, `SEAFILE_BASE_URL`, `SEAFILE_API_TOKEN`, `SEAFILE_REPO_ID`
  (resolved through the test/prod suffix convention like other integrations).

### Open provisioning items (do not block writing Phase A code)

- A running Seafile instance (host: same Linode vs separate), edition (Community is
  adequate for API storage use), and who provisions the service account + private
  library. Until the instance is reachable, production can run on `local` and flip to
  `seafile` by env with no code change.

---

## Phase A — Document storage foundation · size M · **SHIPPED (backend)**

Done (commit pending server pull):
1. `DocumentStore` interface + `LocalDiskStore` + `SeafileStore` + `DocumentStoreService`
   (`apps/ops-api/src/document-store.ts`); `storage_backend` column on `ops_media_files`.
2. `application/pdf` added; per-kind size caps (camera 3MB, document 10MB).
3. Express body limit set explicitly in `main.ts` (16MB) — was unset (~100kb default).
4. Document upload mode: `captured_at` / GPS optional for document kinds.
5. `ops_document_links` table — typed slots, reusable across owners.
6. Routes: `POST /ops/v1/documents`, `GET /ops/v1/documents?owner_type&owner_id`,
   scoped `GET /ops/v1/documents/:linkId/content`, `DELETE /ops/v1/documents/:linkId`.
   Document kinds are blocked from the raw `/media` route (upload + read).
7. Scoped reads: system-admin (HR/owner/admin) read+write all; an operator's own docs
   also readable by that rider (not writable); vehicle papers + fuel receipts read/write
   by the amoeba's supervisor. Operational media unchanged.
8. Tests: `tests/api/ops-documents.test.mjs` (4 tests — attach/list/read/remove, raw-route
   guard, validation/unknown-owner, scoping). Full suite green; OpenAPI validates.

Seafile config (production, when the instance is up): `FLEXI_DOC_STORE=seafile`,
`SEAFILE_BASE_URL`, `SEAFILE_API_TOKEN`, `SEAFILE_REPO_ID` (test/prod suffix supported).
Until then it runs on `local` automatically.

Still to do for Phase A's surface: Phase B is the UI (no further backend needed).

## Phase B — Operator & vehicle papers UI · size S · **SHIPPED**

A "Documents" button on each operator and vehicle row in **ops-admin-console**
(both entities are managed there; hr-admin is foundation-only and has no operator
list) opens a dialog that lists, uploads (file-picker → base64 → `/ops/v1/documents`),
views (authenticated blob), and removes documents. Typed slots: licence / contract /
guarantor / id_card / medical (operator); registration / insurance / proof_of_purchase /
roadworthiness / inspection_report (vehicle). No backend change.
e2e: `tests/e2e/ops-admin-documents.spec.mjs` (attach → list → remove, desktop + mobile).

## Phase C — Batch importers · size L · **SHIPPED**

**Two importers, both in ops-admin-console** as one **Bulk import** surface (`#imports`,
Operators + Vehicles panels). The old "operators in hr-admin" line was corrected:
operators are managed only in ops-admin (hr-admin is foundation-identity-only, no
operator list), and the importer needs amoeba/site (ops concepts). The import
endpoints live in ops-api and orchestrate the foundation person+user creation
server-side via the existing service token — one upload lands across both services.

- **Operators** (`POST /ops/v1/imports/operators`): each row → foundation person →
  user (`roles:["operator"]`, **PIN issued automatically**, `initial_pin` returned
  once and shown in the report for HR to hand out) → `createOperator`. Amoeba + site
  matched **by name** against foundation `/amoeba/v1/amoebas` + `/amoeba/v1/sites`.
  `start_date` → `createCohort(start_date)` + `addCohortMembers` (lands the rider at
  the right ramp day; an older date simply yields no ramp window → veteran target).
  Dedup by phone then NIN, plus the existing operator-record guard → **skip-duplicate**.
  Optional `vehicle_plate` links a bike (the operator-side one-active-holder guard
  applies; conflicts become row errors).
- **Vehicles + VIN (one importer)** (`POST /ops/v1/imports/vehicles`): `createVehicle`
  (`plate`+`vehicle_type` req). **VIN → `tracker_device_id`** (no `vin` column — VIN is
  the tracker identity). `amoeba` blank → warehouse. `assigned_operator` (phone/NIN/name)
  links via the operator side (guard applies). Powertrain words (petrol/electric) mapped
  to the stored `ice`/`ev`. **Batteries never modelled.** Idempotent by plate.
- **Dry-run by default** (`dry_run:false` to commit): per-row report (create /
  skip-duplicate / error with row number + reason). Previewing writes nothing; the UI
  unlocks **Commit** only after a dry-run that found rows, and re-locks after committing.
- **Reader:** exported a generic `parseWorkbook()` from `xlsx-lite.ts` (its ZIP+sheet
  primitives already existed); added `parseDelimited()` so the importer also accepts
  the CSV template it hands out (no xlsx-writer needed). Speedaf parser untouched.
- Tests: `tests/api/ops-imports.test.mjs` (6 — dry-run/commit, idempotency, ramp from
  backdated start_date, CSV upload, VIN→tracker mapping + warehouse + dup-skip,
  admin-only). e2e `tests/e2e/ops-admin-imports.spec.mjs` (preview→commit, desktop +
  mobile). Full API suite (89) + OpenAPI green.
- Note: imported operators default to `operator_status:'active'` (go-live roster is
  live); a `status` column overrides. Bed/accommodation behaviour on create is
  unchanged from the single-create roster path.

## Phase D — Revenue-history importer (≥ last month) · size M

Lands per operator per day in `ops_platform_daily_records` / delivery equivalent.
- **Speedaf:** reuse the waybill parser; import past-dated batches + courier→rider map.
- **Bolt:** map export rows → ingestion endpoint (`source:'migration'`,
  `data_quality:'authoritative'`).
- Open (blocks Bolt half only): Bolt export mechanism (API vs CSV statement).

## Phase E — Fuel/charge receipts · size S

Attach a receipt to a fuel-issue via the link table (`owner_type='fuel_issue'`) to
validate `price_per_unit_ngn`; optional display-only comparison vs policy price.

## Phase F — HMO hospitals + map layer · size M

`ops_hospitals` (name, address, lat, lng, hmo/coverage, phone, active) + xlsx importer
+ `GET /ops/v1/hospitals` + a Leaflet marker layer on the ops-console Map board and
manager-console Fleet map.
- Open (blocks F): does the sheet carry lat/lng or must we geocode? Does coverage vary
  by HMO plan?

## Phase G — Web Push for SOS · size L

Builds on the existing `service-worker.js` in both the rider PWA and supervisor app:
push subscription + VAPID keys (env) + subscriptions table + permission UX; fire a push
to the amoeba's supervisor(s) when an operator raises "Get support now".

---

## Build order

**A → B → C** (all shipped), then **D**, **E**, **F**, **G** by priority. A→B→C delivers
the go-live migration capability (papers + bulk data).

## Decisions locked (2026-11-03)

- Storage-adapter approach; **Seafile as production backend from the start**, kept
  architecturally separate from staff Seafile admin; FlexiMOS-mediated access only
  (library not shared to staff in Seafile).
- Typed link table (`ops_document_links`).
- HR/admin+owner scoping for sensitive document reads.
- Explicit body-limit fix in Phase A.

## Decisions deferred to their phase

- Bolt export format (D); hospital geocoding + per-plan coverage (F); Seafile instance
  host/edition and service-account/library provisioning (storage, non-blocking).
