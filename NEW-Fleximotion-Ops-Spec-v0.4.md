# Fleximotion Ops App
## System Specification — v0.4 DRAFT
**Date:** 2026-05-28  
**Status:** Draft — all major open questions resolved; ready for schema design and Phase 1 kickoff

> **Naming note:** "MOS" (Management & Operations Suite) is the umbrella name for the full Fleximotion software platform, which includes the Ops App, the HR App, the Monnify Service, a Task Management app, and others. This document covers the **Ops App** only — the daily fleet operations application. Do not use "MOS" to refer to this app specifically.

**Author:** Generated from stakeholder sessions  

---

## Table of Contents

1. [Purpose & Background](#1-purpose--background)
2. [Architectural Principles](#2-architectural-principles)
3. [System Architecture](#3-system-architecture)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Core Data Model](#5-core-data-model)
6. [Feature Specifications](#6-feature-specifications)
   - 6.1 [Cross-Role Features](#61-cross-role-features)
   - 6.2 [Operator Features](#62-operator-features)
   - 6.3 [Supervisor Features](#63-supervisor-features)
   - 6.4 [Manager Features](#64-manager-features)
   - 6.5 [Admin Features](#65-admin-features)
7. [Integration Specifications](#7-integration-specifications)
8. [Notification System](#8-notification-system)
9. [Offline & Low-Data Strategy](#9-offline--low-data-strategy)
10. [Security & Authentication](#10-security--authentication)
11. [API Design](#11-api-design)
12. [Infrastructure](#12-infrastructure)
13. [Data Migration & Historical Import](#13-data-migration--historical-import)
14. [Phase Plan](#14-phase-plan)
15. [Resolved Design Decisions](#15-resolved-design-decisions)
16. [Resolved Decisions (Round 2)](#16-resolved-decisions-round-2)
17. [Resolved Decisions (Round 3)](#17-resolved-decisions-round-3)
18. [Open Questions](#18-open-questions)

---

## 1. Purpose & Background

### 1.1 What This Document Is

This specification defines the **Fleximotion Ops App** — a Progressive Web App (PWA) backed by a REST API, designed to manage the daily operating workflows of Fleximotion's ride-hailing fleet at a professional standard. It is one component of the broader MOS (Management & Operations Suite).

It replaces two existing Replit-hosted tools:
- **Flexi Report Automate** — a headless nightly job writing driver performance data to Google Sheets
- **Operator Monitoring System** — an hourly alert engine sending SMS/email to supervisors

These tools are referenced for migration and data model context only. The Ops App is a fresh design.

### 1.2 Problem Statement

The current tooling has several structural limitations:
- Outputs live in Google Sheets, which are not mobile-optimised, have no audit trail, and are prone to accidental edits
- Supervisors receive alerts by SMS with no way to acknowledge, comment, or resolve them in-place
- Drivers have no visibility into their own performance or alerts
- Configuration (thresholds, escalation rules, fleet roster) requires Google Sheet edits or code deploys
- Cash remittance is manually typed into a spreadsheet — error-prone and unauditable
- No historical trend views beyond the current day's dashboard
- No authentication on either system

### 1.3 Scope of v1

Ops App v1 covers the full lifecycle of a Fleximotion operating day:
- Fleet roster and configuration management
- Driver check-in/check-out and shift state tracking
- Automated performance data ingestion from Bolt and Uber APIs
- Real-time cash balance ingestion from Monnify
- Alert generation, tiered escalation, and full acknowledgement workflows
- Incident reporting by operators
- Vehicle inspection by supervisors
- Executive, supervisor, and operator dashboards
- Leaderboards
- Push notifications with SMS fallback
- Historical trend reporting
- Data export (PDF, CSV, WhatsApp share)
- Full audit trail
- Historical data migration from Google Sheets

---

## 2. Architectural Principles

These principles take precedence over all detailed feature decisions.

### 2.1 API-First
The backend exposes a fully-documented REST API. The PWA is one client of that API; future clients (native apps, third-party integrations, management BI tools) must be able to consume the same API without changes to the server. The API spec (OpenAPI 3.1) is the source of truth for all contracts.

### 2.2 Mobile-First
All UI is designed for a 375px-wide portrait screen. Desktop layouts are enhancements, not the baseline. Tap targets are minimum 44×44px. Text is legible without zoom.

### 2.3 Offline-First / Low-Data
The app must be usable — for all critical operator workflows — with no internet connection. Data syncs when connectivity returns. All heavy-media features (photo, video) are designed around queued, resumable, compressed uploads. No feature should silently fail because of poor connectivity; all failures must be surfaced clearly with a retry path.

### 2.4 Low-Spec Hardware
The PWA must perform on Android devices with 2GB RAM, a slow CPU, and Android 9+. Heavy JavaScript frameworks and large bundles are avoided. Critical views must render in under 2 seconds on a 3G connection. Animated transitions are minimal and can be disabled.

### 2.5 Supervisor/Manager Primary
The primary design audience is supervisors and managers. Operator-facing features are important but secondary. When there is a trade-off between operational depth for supervisors vs. convenience for operators, operational depth wins.

### 2.6 Extensible Platform Integration
Bolt and Uber are the current platforms. The data ingestion layer must be architected as a generic "platform connector" interface so that adding inDrive, Rida, or any future platform requires only a new connector implementation, not architecture changes.

### 2.7 Auditability by Default
Every state-changing action in the system is persisted with an actor, a timestamp, and a diff. This is not optional and cannot be disabled by configuration. The audit log is append-only.

### 2.8 Minimal Input
All data entry paths are designed for one-thumb use on a phone. Prefer taps over typing. Use smart defaults, pre-populated fields, and reason dropdowns instead of free-text wherever possible. Forms have the fewest possible required fields.

---

## 3. System Architecture

### 3.1 High-Level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                             │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │   Ops App PWA    │   │   Future clients             │   │
│  │   (React/Vite)   │   │   (native app, BI, webhooks) │   │
│  │   Service Worker │   │                              │   │
│  │   IndexedDB      │   │                              │   │
│  └────────┬─────────┘   └──────────────┬───────────────┘   │
└───────────┼──────────────────────────  ┼───────────────────┘
            │  HTTPS / REST + SSE         │
┌───────────▼─────────────────────────── ▼───────────────────┐
│                    Ops API Server                           │
│              (NestJS, Node.js, OpenAPI 3.1)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Auth     │ │ Fleet    │ │ Alerts   │ │ Reporting    │  │
│  │ Module   │ │ Module   │ │ Module   │ │ Module       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Ingest   │ │ Media    │ │ Notif.   │ │ Audit        │  │
│  │ Module   │ │ Module   │ │ Module   │ │ Module       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│                        ┌──────────────────┐               │
│                        │  BullMQ Workers  │               │
│                        │  (job queues)    │               │
│                        └──────────────────┘               │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼──────────────────────┐
        ▼                ▼                       ▼
┌──────────────┐ ┌──────────────┐  ┌──────────────────────────┐
│  PostgreSQL  │ │   Redis      │  │  Object Storage          │
│  (primary DB)│ │  (cache +    │  │  (media files: photos,   │
│              │ │   queues)    │  │   videos, documents)     │
└──────────────┘ └──────────────┘  └──────────────────────────┘
                         │
        ┌────────────────┼──────────────────────┐
        ▼                ▼                       ▼
┌──────────────┐ ┌──────────────┐  ┌─────────────────────────┐
│  Bolt API    │ │  Uber API    │  │  Monnify Service        │
│  (connector) │ │  (connector) │  │  (cash transactions)    │
└──────────────┘ └──────────────┘  └─────────────────────────┘
        │                │
        ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  FCM (Firebase) — push delivery to PWA                       │
│  Africa's Talking — SMS fallback                             │
│  Brevo — email archive                                       │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Backend: NestJS

The Ops API backend is a NestJS application with the following module structure:

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | JWT issuance, refresh, revocation, role guards |
| `UsersModule` | User profiles, roles, assignments |
| `FleetModule` | Operators, supervisors, managers, amoebas, vehicles |
| `IngestModule` | Platform connectors (Bolt, Uber), daily ingestion workflow |
| `AlertsModule` | Alert engine, evaluation, dedup, tier escalation |
| `IncidentsModule` | Operator-reported incidents, status workflow |
| `InspectionsModule` | Vehicle inspection submissions and review |
| `ShiftModule` | Check-in / check-out state machine |
| `CashModule` | Monnify Service receiver, reconciliation |
| `MediaModule` | Secure upload, compression, GPS tagging, camera-only enforcement |
| `NotificationsModule` | FCM push, SMS fallback, email archive, policy controls |
| `ReportingModule` | Daily reports, trends, P&L, leaderboards, exports |
| `AuditModule` | Append-only audit log, accessible to authorised users |
| `AdminModule` | User management, config, data health, import |

### 3.3 PWA Client: React + Vite

The Ops App PWA is a single-page React application served by the same Ubuntu server. It communicates with the Ops API only — no direct database or external service access. It uses:
- **Service Worker** for offline caching and background sync
- **IndexedDB** (via Dexie.js) for offline data storage
- **Server-Sent Events (SSE)** or WebSocket for live alert feeds to supervisors on active sessions
- Lightweight component library (Radix UI primitives + Tailwind CSS)

### 3.4 Developer API Portal

The Ops API spec (OpenAPI 3.1) is hosted at `/developer` on the same Ubuntu server, served via **Redocly** as a clean read-only portal. The spec is auto-generated from NestJS decorators and always reflects the running code. Authentication for the portal is controlled by IP allowlist in Nginx.

### 3.5 Background Jobs

BullMQ (backed by Redis) handles all async work:

| Queue | Jobs |
|-------|------|
| `platform-ingest` | Hourly Bolt/Uber data pull, triggered by cron (07:00–21:00 WAT) |
| `alert-engine` | Alert evaluation after each ingest cycle |
| `notification-dispatch` | Push/SMS/email delivery with retry |
| `media-process` | Compress and store uploaded photos/videos |
| `report-generate` | On-demand and scheduled report generation |
| `export` | PDF/CSV export jobs |

---

## 4. User Roles & Permissions

### 4.1 Role Hierarchy

```
Owner (superuser)
  └── Admin (can be assigned by Owner only; only Owner can revoke)
        └── Manager (sees region/company)
              └── Supervisor (sees own team/amoeba)
                    └── Operator (sees self only)
```

### 4.2 Permission Matrix

| Capability | Operator | Supervisor | Manager | Admin | Owner |
|-----------|----------|------------|---------|-------|-------|
| View own performance | ✓ | ✓ | ✓ | ✓ | ✓ |
| View team performance | — | ✓ (own amoeba) | ✓ (all) | ✓ | ✓ |
| Check in / check out | ✓ | — | — | — | — |
| Report incident | ✓ | ✓ | — | — | — |
| Submit inspection | — | ✓ | — | — | — |
| Review inspection | — | — | ✓ | ✓ | ✓ |
| Acknowledge alert | — | ✓ | ✓ | ✓ | ✓ |
| Escalate alert | — | ✓ | — | ✓ | ✓ |
| Accept/reject operator excuse | — | ✓ | ✓ | ✓ | ✓ |
| View live team board | — | ✓ (own) | ✓ (all) | ✓ | ✓ |
| View daily report | — | ✓ (own amoeba) | ✓ (all) | ✓ | ✓ |
| View P&L / executive dashboard | — | — | ✓ | ✓ | ✓ |
| Configure alert thresholds | — | — | ✓ | ✓ | ✓ |
| Manage fleet roster | — | — | — | ✓ | ✓ |
| Manage users | — | — | — | ✓ | ✓ |
| Assign Admin role | — | — | — | — | ✓ |
| Revoke Admin role | — | — | — | — | ✓ |
| View audit trail | — | — | ✓ (own amoeba) | ✓ | ✓ |
| Configure notification policies | — | — | — | ✓ | ✓ |
| View data health dashboard | — | — | — | ✓ | ✓ |
| Import historical data | — | — | — | ✓ | ✓ |

### 4.3 Data Scoping Rules

- **Operator:** All API responses are scoped to `operator_id = current_user.id`.
- **Supervisor:** All responses are scoped to operators whose `supervisor_id = current_user.id`. If a supervisor is reassigned, they lose visibility of their former team immediately.
- **Manager:** All responses are unscoped by default (all amoebas). Future multi-region support will add region scoping.
- **Admin / Owner:** No data scoping. All data visible.

---

## 5. Core Data Model

The following describes the key entities and their relationships. This is not an exhaustive column listing — the detailed database schema is a separate deliverable.

### 5.1 Entities

**User**  
Unified user record. Fields: id, name, phone, email, role, status (active/inactive/suspended), fcm_token, created_at, updated_at. One user may play multiple roles (e.g., a manager who also acts as a supervisor for a specific amoeba) — handled by role being an array or separate assignment table.

**Amoeba** (Office/Base)  
An organisational unit grouping operators and supervisors under shared P&L accountability. An amoeba is **not** a single location — it may span multiple physical sites. Fields: id, name, created_at, is_central (boolean — see FixedCost note below). The alert radius and GPS centroid used for location-based alerts are configured per `AmoebaSite`, not per amoeba.

**AmoebaSite** (Physical location within an amoeba)  
One amoeba has one or more sites. Fields: id, amoeba_id (FK), name (e.g. "Lekki Garage", "VI Drop-off"), gps_lat, gps_lng, alert_radius_m, is_primary (boolean). When evaluating location-based alerts (far_from_amoeba, vehicle_not_returned), the system checks against the operator's assigned `AmoebaSite`. Every operator **must** be assigned to a specific site — there is no amoeba-level-only assignment. Admin is required to select a site when creating or editing an operator record; if only one site exists for the amoeba, it is pre-selected automatically. If a new site is added to an amoeba later, existing operators are not moved automatically — Admin must reassign.

**Vehicle**  
Fields: id, plate, type (car/motorbike), assigned_operator_id (nullable), status (active/inactive/in_repair), created_at. A vehicle belongs to an amoeba operationally.

**Operator** (extends User)  
Fields: user_id (FK), amoeba_id (FK), site_id (FK — mandatory; assigned AmoebaSite), supervisor_id (FK), daily_revenue_target (single combined target across all platforms — not per-platform), vehicle_id (FK, nullable), monnify_reserved_account (unique — populated automatically by the Monnify Service on operator activation; see §7.4), status (active/inactive/pending_activation).

An operator's platform registrations are held in a separate `OperatorPlatformAccount` table — there is no single `platform` field on the operator. This supports operators registered on multiple platforms simultaneously.

**OperatorPlatformAccount**  
One row per (operator, platform account) registration. Fields: id, operator_id (FK), platform_account_id (FK — references PlatformAccount), platform_operator_id (the ID assigned by the platform, e.g. Bolt driver ID), registration_status (registered / active / inactive / suspended), activated_at, deactivated_at.

An operator may be registered on both Bolt and both Uber accounts but only active on one at a given time. The alert engine uses `registration_status = 'active'` rows to determine which platforms to query for a given operator. Daily performance is stored per `(operator_id, platform_account_id, date)`, not collapsed across platforms.

**PlatformAccount** (Configuration entity — managed by Admin)  
One row per platform data source (e.g., "Bolt Lagos", "Uber Cars – Acct 1", "Uber Courier – Acct 2"). Fields: id, platform (bolt / uber / indrive / …), display_name, vehicle_type (car / motorbike / any), account_subtype (ride_hailing / courier / general), credentials_key (reference to env var prefix or secrets vault key), is_active, created_at.

This model allows an unlimited number of accounts per platform. Adding a new Uber account (e.g., a third city) requires a new `PlatformAccount` row and credential set — no code change.

**PlatformDailyRecord**  
The normalised daily performance row ingested from a platform data source. One row per (operator_id, platform_account_id, date). Keyed this way — not on `platform` string — so that if an operator has registrations on two Uber accounts, their records are stored and displayed separately. Fields: operator_id (FK), platform_account_id (FK), date, trips_total, trips_completed, trips_cancelled, trips_no_response, ride_revenue, net_earnings, booking_fees, cash_trips, card_trips, acceptance_pct, cancellation_pct, completion_pct, hours_worked, raw_payload (JSONB), source (live / migration).

Reporting views that show "total revenue" across all platforms for an operator aggregate across all `platform_account_id` rows for that operator and date.

**ShiftEvent**  
One row per state transition in an operator's shift. Fields: id, operator_id, event_type (check_in / check_out / platform_online / platform_offline), occurred_at, gps_lat, gps_lng, source (app / platform_api), notes.

**Alert**  
Fields: id, operator_id, platform, alert_type, alert_date, tier, episode_key, fired_at, acknowledged_at, acknowledged_by, resolution_status (open/acknowledged/resolved/snoozed/escalated), resolution_notes, snoozed_until, escalated_at, escalated_to, metadata (JSONB).

**Incident**  
Operator-submitted support request. Fields: id, operator_id, incident_type (accident/breakdown/police/petrol/low_battery), status (open/acknowledged/resolved), submitted_at, gps_lat, gps_lng, operator_notes, supervisor_notes, resolved_at, resolved_by, media_refs (array of media IDs).

**Inspection**  
Supervisor vehicle inspection. Fields: id, vehicle_id, inspector_id (supervisor), submitted_at, gps_lat, gps_lng, odometer_reading, fuel_level_pct, condition (ok/minor_issues/needs_repair), issues_description, media_refs (array), reviewed_at, reviewed_by, review_outcome.

**MediaItem**  
One row per photo/video/document. Fields: id, uploader_id, context_type (inspection/incident/odometer/fuel/damage/cash_receipt/return_confirmation), context_id, captured_at, gps_lat, gps_lng, file_key (object storage), mime_type, file_size_bytes, duration_seconds (video only), upload_status (pending/processing/stored/failed).

**CashTransaction**  
Ingested from Monnify Service. Fields: id, operator_id (resolved via monnify_reserved_account), amount_ngn, transaction_ref, paid_at, raw_payload (JSONB), reconciliation_status, matched_record_id.

**DeviationReason**  
Operator-supplied reason when an alert fires. Fields: id, alert_id, operator_id, reason_code (network/vehicle_fault/fuel/platform_blocked/personal_emergency/other), free_text (optional), submitted_at, supervisor_review (accepted/rejected/pending), reviewed_at, reviewed_by.

**AmoebaDailySummary**  
Aggregate row per (amoeba_id, date). Pre-computed or on-demand. Fields: active_riders, trips_total, trips_completed, ride_revenue, net_earnings, hours_worked, expected_hours, efficiency_pct, cash_remitted, overage_shortage, avg_acceptance_pct, avg_completion_pct, total_expense (manager-entered), profit_loss, hourly_pl, target_revenue, target_attainment_pct.

**FixedCost**  
Admin/manager-entered cost items per amoeba per calendar month. Fields: id, amoeba_id (FK), cost_category (see below), cost_label (free-text for detail), amount_ngn, month (YYYY-MM), entered_by (FK), created_at, updated_at.

Fixed costs are reviewed and entered monthly. The standard cost categories are:

| Category | Notes |
|----------|-------|
| `rent` | Office or garage rent. Use `vehicle_parking` subcategory where costs are per-vehicle parking fees rather than a single lease. |
| `salaries` | Staff salaries directly carried by the amoeba (supervisor, garage attendant, etc.). |
| `electricity` | Utility costs. |
| `communication` | Airtime/data packages for supervisors and operators covered by the company. |
| `maintenance_budget` | Allocated monthly maintenance/repair fund. |
| `other` | Catch-all; requires a `cost_label`. |

**Central Amoeba:** One amoeba is flagged `is_central = true`. This amoeba carries shared-service costs — management salaries, HQ office rent, HR/accounting/finance salaries, central IT, and shared infrastructure costs. The Central amoeba does not have operators or vehicles. Its P&L represents the company's overhead burden.

**Central cost distribution formula:** Each month, the Central amoeba's total fixed costs are distributed proportionally across operational amoebas by **active operator headcount** — i.e., the number of operators with `status = active` at month-end for each amoeba.

```
Amoeba X allocation = Central monthly cost × (active operators in X / total active operators across all non-central amoebas)
```

This allocation varies month to month as headcount changes. It is computed at report generation time, not pre-stored, so it always reflects the current roster. The management P&L view shows each operational amoeba's own fixed costs plus its Central allocation as a separate line, summing to a total cost that supports a true company-level P&L.

**AuditEntry**  
Append-only log. Fields: id, actor_id, actor_role, action, entity_type, entity_id, before_state (JSONB), after_state (JSONB), ip_address, occurred_at. Never deleted or updated.

**NotificationLog**  
One row per notification attempt. Fields: id, recipient_id, channel (push/sms/email), alert_or_incident_id, template_key, status (sent/delivered/failed), attempt_count, sent_at, error_message.

---

## 6. Feature Specifications

### 6.1 Cross-Role Features

#### 6.1.1 Authentication
- **Login:** Phone number + PIN (6-digit). Phone-based login avoids email literacy barriers on low-spec devices.
- **PIN reset:** OTP sent via SMS to registered phone. No email required.
- **Session:** JWT access token (15-minute expiry) + refresh token (30-day expiry, stored in HttpOnly cookie). Refresh is transparent to the user.
- **Force logout:** Admin can invalidate all sessions for a user.
- **Biometric:** PWA supports device biometric (fingerprint/face) via WebAuthn for returning users on supported devices.

#### 6.1.2 Notifications
Full specification in Section 8.

#### 6.1.3 Media Capture (Camera-Only)
**Policy:** The app must not allow upload of photos or videos from device storage. All media must be captured in real-time through the device camera at the moment of submission.

**Enforcement:**
- All file input elements use `capture="environment"` attribute, which on Android and iOS forces the camera picker rather than the gallery.
- On capture, the client records the GPS coordinates at the time of capture and embeds them in the upload request. If GPS is unavailable, upload is blocked with a clear message.
- The server validates that the uploaded file's EXIF `DateTimeOriginal` is within a configurable tolerance (default: 5 minutes) of the server receipt time. Files failing this check are rejected.

**Upload design for low-bandwidth:**
- Images are compressed client-side to a maximum of 1MB (configurable) before upload using the Canvas API.
- Videos are limited to a maximum duration (default: 60 seconds, configurable by Admin) and resolution (720p max).
- Uploads use the TUS resumable upload protocol. If the connection drops mid-upload, the next sync attempt resumes from where it stopped.
- Upload queue is stored in IndexedDB. Items in the queue are visible to the user with status indicators (queued / uploading / done / failed).
- Failed uploads retry automatically with exponential backoff.

#### 6.1.4 Leaderboards

Leaderboards are globally visible to all authenticated users (read access is not role-gated). They are a motivational tool.

##### Performance Score

Every operator is assigned a **Performance Score** (0–100) that drives the leaderboard ranking. The score is a weighted average of four normalised components:

```
Performance Score =
  W_acceptance  × acceptance_score
+ W_online      × time_online_score
+ W_cash        × cash_receipt_score
+ W_revenue     × revenue_score
```

Weights must sum to 1.0. **Default weights (Admin-configurable):**

| Component | Default weight | What it measures |
|-----------|---------------|-----------------|
| `acceptance_score` | **0.30** | Platform acceptance rate (0–100%) |
| `time_online_score` | **0.30** | Hours online as % of target hours, capped at 100 |
| `cash_receipt_score` | **0.30** | Cash remittance accuracy (no shortfall = 100, decreases with shortfall size) |
| `revenue_score` | **0.10** | Combined revenue as % of daily target, capped at 100 |

The revenue component carries a lower default weight because it is partially outside the operator's control (platform demand, amoeba location, vehicle type). The other three components reflect effort, discipline, and financial trustworthiness — things the operator directly controls.

**Component calculations:**

`acceptance_score` = operator's acceptance rate % for the period (from `PlatformDailyRecord.acceptance_pct`, averaged across days worked and across all active platform accounts).

`time_online_score` = min(100, `hours_online` / `target_hours` × 100), averaged across days worked. If no `target_hours` is set for the operator, the amoeba average is used as denominator.

`cash_receipt_score` = average daily cash receipt score over the period.  
For each day: `day_score = max(0, 100 × (1 − shortfall_ngn / max(expected_cash_ngn, 1)))`.  
Overage (operator remitted more than expected): score = 100.  
Days with no Monnify data and no expected cash: score = 100 (not penalised).  
Days with no Monnify data but non-zero expected cash: score = 0 (treated as unremitted).

`revenue_score` = min(100, combined_revenue / `daily_revenue_target` × 100), averaged across days worked.

**Visibility by role:**

| Component shown to... | Operator | Supervisor | Manager/Admin |
|-----------------------|----------|------------|---------------|
| Total Performance Score | ✓ | ✓ | ✓ |
| Acceptance component | ✓ | ✓ | ✓ |
| Time online component | ✓ | ✓ | ✓ |
| Cash receipt component | ✓ | ✓ | ✓ |
| Revenue component | ✗ hidden | ✓ | ✓ |

Operators see their score and the three components they control. The revenue contribution is used in the score calculation (they benefit from high revenue) but is not displayed to them, removing the temptation to focus on absolute revenue rather than operational behaviour. Supervisors and managers see the full breakdown.

##### Leaderboard Timeline

Default period: **current week (Mon–Sun WAT)**. Users can switch to:
- Today
- This week (default)
- Last week
- This month
- Last month
- Custom date range (date picker)

Admin sets the default timeline. The selected timeline persists per user in localStorage.

##### Leaderboard Views

- **Within-amoeba (default on operator home screen):** Operators ranked against colleagues in the same amoeba. Fairest comparison — same vehicle pool, same location conditions.
- **Company-wide (secondary tab):** All operators ranked, amoeba shown alongside each name.
- **Amoeba comparison:** Amoeba-level average Performance Score ranked against each other. Visible to all users — operators can see how their base rates vs others.

##### Eligibility

Only operators who have **checked in at least once** during the selected period appear on the leaderboard. Operators absent (illness, repair, suspension) are simply absent — not ranked last. This prevents a legitimate absence from becoming a public performance indictment.

##### Visual Design

- Top 3 operators: gold / silver / bronze badge. No other rank styling.
- No "bottom of the board" highlighting. Ranks below 3rd are displayed neutrally.
- Score shown as a number (e.g., "83") with a thin radial progress arc for visual appeal on mobile.

##### Admin Controls

- Adjust the four component weights (must sum to 1.0). Validation prevents invalid saves.
- Set the default timeline.
- Toggle company-wide visibility on/off (restricts operators to within-amoeba view only, while supervisors/managers retain all views).

**Refresh:** Updated on each platform data ingest cycle (hourly). Score is pre-computed and cached per operator per period — not recalculated on every page load.

#### 6.1.5 Announcements & Policy Acknowledgements (In-App)
Following the hybrid messaging decision: WhatsApp remains the channel for free-form group chat and informal communication. The app handles structured, auditable communications only.

**Announcement types:**
- **General announcement:** Admin/Manager posts a message visible to all or a filtered group (by amoeba, by role). No acknowledgement required.
- **Policy acknowledgement:** Admin/Manager posts a notice (e.g. a new rule, a policy update) that requires each recipient to tap "I have read and understood this." The system records who acknowledged and when. Unacknowledged notices are shown as a banner until actioned. Manager/Admin can see who has and has not acknowledged.

**Not in scope for v1:** 1-to-1 chat, group chat, read receipts on general announcements, voice notes. These are WhatsApp's domain for now.

#### 6.1.6 Role-Based Data Scoping
As defined in Section 4.3. Every API endpoint enforces scoping at the query level, not the application level. There is no "admin mode toggle" for supervisors.

---

### 6.2 Operator Features

#### 6.2.1 Home Screen / Dashboard
The operator's primary view. Designed for a single screen, glanceable, no scrolling required for the critical information.

Components:
- **Shift status badge:** Large, prominent. One of: NOT CHECKED IN / ON SHIFT / CHECKED OUT. Tap to check in or check out.
- **Revenue meter:** Visual progress bar showing current revenue vs daily target. Colour-coded: green (on track), amber (behind), red (at risk). Shows "₦X of ₦Y target".
- **Time online meter:** Hours online vs target hours.
- **Midday warning:** If it is 11:00–14:00 and revenue is below 40% of target, a banner appears with the smart nudge (see 6.2.5).
- **Active alert badge:** If there are open alerts for this operator, a badge with count is shown. Tap to open alert details.
- **Support button:** Large, easy to reach, always visible (see 6.2.4).

#### 6.2.2 Check-In / Check-Out
**Check-in:**
1. Operator taps "Start Shift" button.
2. App requests GPS location. If unavailable, operator is prompted to enable location.
3. App captures GPS and timestamp. If operator is beyond their site's configured radius, a warning is shown ("You appear to be far from your base — are you sure?") but check-in is not blocked.
4. A `ShiftEvent` record (type: `check_in`) is created.
5. If a daily self-inspection is configured (optional), the operator is prompted to complete it before the check-in is confirmed.

**Check-out / Vehicle Return Confirmation:**
1. Operator taps "End Shift" button.
2. App prompts operator to photograph the vehicle (mandatory). Camera opens directly — no gallery option. GPS is recorded.
3. Operator taps confirm. A `ShiftEvent` record (type: `check_out`) is created with the vehicle photo attached.
4. If GPS indicates operator is more than `alert_radius_m` from their assigned site, a vehicle-not-returned warning is generated automatically and sent to the supervisor.
5. Check-out is confirmed with a summary: total time online, total trips (from last platform ingest), estimated revenue.

**Offline behaviour:** Check-in/out events are written to IndexedDB immediately and synced when connectivity returns. The timestamp used is the local device time at the moment of the action, not the server time. The server records both.

#### 6.2.3 Target Progress View
Accessible from the home screen. Shows:
- **Revenue progress:** Graphical day-progress bar (time axis) with current revenue overlaid. Target line marked. Operator can see if they are "ahead of pace" or "behind pace" based on time elapsed.
- **Midday check (14:00):** Highlights whether the operator was above/below 50% at midday.
- **End of day:** Final revenue vs target, overage or shortage.
- **Time online today:** Hours logged vs target hours.
- **This week / this month:** Cumulative revenue and target attainment, shown as summary tiles.

#### 6.2.4 Support / Escalation Button
A clearly labelled, prominent button always present on the operator's home screen. Tapping opens a bottom sheet with incident type selection:

| Incident Type | Icon | Supervisor notified? | Manager notified? |
|---------------|------|----------------------|-------------------|
| Accident | ⚠️ | Immediately (push + SMS) | After 30 min if unacknowledged |
| Breakdown | 🔧 | Immediately (push + SMS) | After 30 min if unacknowledged |
| Police issue | 🚨 | Immediately (push + SMS) | After 30 min if unacknowledged |
| Waiting for petrol funds | ⛽ | Immediately (push) | — |
| Low battery (EV) | 🔋 | Immediately (push) | — |

After selecting incident type:
1. Operator can add a short optional free-text note.
2. Photo/video capture is offered (optional for most types; mandatory for Accident).
3. GPS is recorded automatically.
4. Incident is submitted and appears in the supervisor's alert inbox immediately.
5. Operator sees a confirmation with "Your supervisor has been notified."

**Escalation if supervisor does not respond:** For high-severity incidents (Accident, Police), if the supervisor has not acknowledged within 30 minutes, the system automatically notifies the manager.

#### 6.2.5 Smart Nudges (Proactive Alerts to Operator)
Unlike the current system which only notifies supervisors, smart nudges go to the operator first. The goal is to let operators self-correct before a supervisor alert fires.

| Nudge | Trigger | Timing |
|-------|---------|--------|
| Revenue pace warning | On track to miss daily target | At 12:00 if < 40% of target earned |
| Offline duration warning | Approaching offline threshold | At 75 min offline (threshold is 90 min before alert fires) |
| Vehicle return reminder | End of day approaching | At 19:30 WAT if vehicle GPS > site radius |
| Midday target reminder | Approaching midday check | At 13:45 WAT if below 50% of target |
| Late resumption warning | Not online by 08:15 | If no platform activity by 08:15 WAT |

Nudges are push notifications. If push is not available, they are shown as in-app banners on next app open.

Nudge thresholds are configurable by Admin/Manager.

#### 6.2.6 Deviation Reason Capture
When an alert fires for an operator (late resumption, offline, below target, etc.), the operator receives the alert in-app with a prompt: "Your supervisor has been notified about [alert type]. Would you like to explain?"

The reason form presents a dropdown of standardised reasons:
- Network / app issue
- Vehicle fault
- Fuel / charging problem
- Platform account blocked
- Personal emergency
- Other (short free-text, max 140 characters)

The submitted reason is attached to the alert record and visible to the supervisor in their alert inbox. The supervisor can accept or reject the explanation. This creates a structured excuse workflow replacing ad-hoc WhatsApp messages.

#### 6.2.7 Cash / Earnings View
Shows the operator's financial picture. This view is driven by Monnify transaction data ingested via the Monnify Service.

- **Expected cash today:** Sum of cash trips (from platform data). This is what the system expects the operator to have in hand.
- **Amount remitted:** Total of Monnify transactions matched to this operator for today.
- **Status:** In credit (operator has remitted more than expected) / Balanced / Shortfall (operator owes).
- **Transaction history:** List of remittances by date, with Monnify reference.

_Note: Manual entry of cash remittance is NOT in scope for Ops App v1. Monnify is the source of truth for remittance data. If a cash payment is made outside of Monnify, it must be reconciled by Admin._

#### 6.2.8 Maintenance Issue Reporting
Operator can submit a maintenance report at any time. Form fields:
- Issue category: Tyres / Brakes / Engine / Electrical / Body damage / Other
- Description (optional free-text, max 200 characters)
- Photos (mandatory, minimum 1, maximum 5): Camera-only, GPS-tagged.

Submitted reports appear in the supervisor's maintenance queue and are visible to managers. Vehicles with open maintenance reports are flagged in the live team board.

---

### 6.3 Supervisor Features

#### 6.3.1 Live Team Board
The supervisor's primary screen. Shows all operators in their amoeba at a glance.

Each operator tile shows:
- Name and vehicle plate
- Platform badge (Bolt / Uber)
- Current status: Online / Offline / Not seen today / Checked out
- Last seen timestamp
- Revenue progress bar (today vs target), colour-coded
- Risk indicator: None / Watch / Alert (based on active unacknowledged alerts)
- Cash status indicator: OK / Shortfall / Unknown

Tiles are sorted by risk (highest risk first) by default, with option to sort by name or revenue.

Tapping a tile opens the operator detail view (full today's performance, alert history, recent incidents, active maintenance issues).

Auto-refreshes every 60 seconds. On poor connectivity, shows a "Last updated X minutes ago" banner.

#### 6.3.2 Alert Inbox
The supervisor's operational to-do list. All alerts relevant to their team, in reverse chronological order.

Each alert shows:
- Operator name and alert type
- Time fired and tier level
- Deviation reason (if submitted by operator)
- Current status badge

**Actions available per alert:**
- **Acknowledge:** Mark as seen. Records actor and timestamp.
- **Comment:** Add a note to the alert (visible in audit trail and to managers).
- **Resolve:** Mark as actioned. Optional resolution note.
- **Snooze:** Dismiss for a set period (15 min, 30 min, 1 hr, until end of day). Alert reappears after snooze.
- **Escalate to Manager:** Sends alert to manager's escalation queue with optional escalation note.
- **Quick dial:** Tap to call operator directly from the alert.
- **Accept / Reject operator deviation reason:** If the operator submitted a reason, supervisor can accept or reject it. Both outcomes are recorded in audit.

Filter controls: by alert type, by operator, by status (open/snoozed/resolved).

#### 6.3.3 Daily Closeout Workflow
Supervisors are required to submit their daily closeout by **19:00 WAT**. A push notification reminder is sent at 18:30. The closeout is a structured form that replaces ad-hoc Google Sheet entries.

Steps:
1. **Review cash status:** For each operator, the Monnify-derived remittance status is shown. Supervisor can add a note against any operator with a shortfall.
2. **Review open alerts:** List of unresolved alerts. Supervisor must either resolve or escalate each one before closeout can be submitted.
3. **Amoeba summary review:** Today's aggregate stats for the amoeba (trips, revenue, hours, cash). Supervisor adds an optional overall note for the day.
4. **Submit:** Closeout is stamped with supervisor's ID and timestamp. This triggers finalisation of the amoeba's daily summary record.

If closeout is not submitted by 19:00 WAT, the manager receives an alert. If still missing by 20:00 WAT, it escalates to Admin.

**Management report availability:** The manager's daily report (Section 6.4.7) is available at any time, not gated on supervisor closeout. However, any amoeba whose supervisor has not yet submitted closeout is clearly flagged as "Pending closeout — figures incomplete." Managers can therefore see partial data during the day for their own monitoring; the complete consolidated view is expected by 19:00 WAT.

#### 6.3.4 Vehicle Inspection
Supervisor submits a vehicle inspection. Required at least once every 48 hours per vehicle.

**System tracking:** The system tracks the timestamp of the last inspection per vehicle. If a vehicle has not been inspected within 48 hours, it is flagged on the live team board and on the manager's dashboard as "overdue inspection."

**Inspection form:**
1. Select vehicle (from supervisor's amoeba vehicle list, sorted by last-inspected date — longest overdue first).
2. Capture photos (mandatory): front, rear, driver side, odometer, fuel gauge. Each requires a separate camera capture. Minimum 3 photos required.
3. Enter odometer reading.
4. Enter fuel level (percentage slider, or "full/half/quarter/empty").
5. Condition assessment: OK / Minor issues noted / Needs repair.
6. If "needs repair": description field (dropdown of issue categories + optional free-text), and additional photos.

**After submission:** The inspection is flagged for Manager review. Managers can approve or request a follow-up.

#### 6.3.5 Amoeba Performance View
Shows today's and historical performance for the supervisor's amoeba.

- **Today's summary tiles:** Active riders, total trips, ride revenue vs target, hours worked, efficiency %, total cash remitted, net shortage/overage.
- **Timeline selector:** Today / This week / This month / Custom range. When a range is selected, metrics aggregate and trend charts render.
- **Trend charts:** Revenue per day (bar chart with target line), trips per day, hours online per day, alert count per day. All charts are simple, low-data, SVG-rendered.
- **Individual operator performance:** Ranked table showing each operator's trips, revenue, target attainment, acceptance rate, hours. Tap any row for operator detail.

#### 6.3.6 Daily Report View (Amoeba)
A tabular view equivalent to the current Google Sheet "Rider Daily Data" tab, but scoped to the supervisor's amoeba. Shows one row per (operator, platform account, date). Columns include all PlatformDailyRecord fields plus cash status from Monnify. Filterable by date and operator. Exportable to CSV or PDF. Shareable via WhatsApp.

#### 6.3.7 Weekly Operator Profile (AI-Generated)
Accessible by tapping any operator in the live team board or the daily report. Shows a snapshot of the operator's performance over the past 7 days.

**Structured data shown:**
- Revenue trend (7-day sparkline)
- Average check-in time
- Average revenue per hour
- Average acceptance rate
- Alert frequency (by type)
- Cash shortfall history
- Incident history (incidents submitted this month)

**AI narrative:** Below the structured data, a short AI-generated summary in plain English. Examples:
> "Typically starts between 8:30 and 9:15. Revenue is strongest on weekday evenings (18:00–21:00). Acceptance rate has improved over the past two weeks. Had two cash shortfalls this month. One maintenance report pending."

The narrative is generated on demand (tap to generate) via an OpenAI API call. It is not preloaded, to minimise cost and latency. The prompt is constructed from the structured data fields — no free-text or sensitive data is sent to the LLM.

#### 6.3.8 Operator Quick Dial
From any operator detail view, a tap-to-call button is always visible. The operator's registered phone number is used. No VoIP — this is a standard `tel:` link that hands off to the device dialler.

---

### 6.4 Manager Features

#### 6.4.1 Executive Dashboard
The manager's primary screen. A high-level view of the fleet's state right now.

**KPI tiles (today):**
- Total active operators (online now)
- Total revenue (vs daily target for all amoebas)
- Net earnings
- Cash exposure (total expected cash - total remitted; i.e., how much cash is unaccounted for)
- Open alerts (count, with severity breakdown)
- Unused assets: vehicles not active today (number and list on tap)

**Amoeba summary table:** One row per amoeba. Columns: active riders, trips, revenue, target attainment %, net P/L, open alerts, inspection overdue count.

**Timeline controls:** Today / This week / This month / Custom. Charts update with the selected range.

**Revenue profile chart:** A key analytical view — average revenue by hour of day, across all operators, over the selected period. This answers "when do we make the most money?" and "when are there low-revenue windows?" Displayed as a 24-hour bar chart (WAT time). Useful for planning where to inject additional revenue sources.

**Alert trend chart:** Alert count per day, split by alert type. Shows whether alert frequency is improving or worsening.

#### 6.4.2 P&L View
Per amoeba, per period. Shows:
- Revenue (from platform data)
- Net earnings (post-platform fees)
- Fixed costs (entered by Admin/Manager per period — rent, staff salaries, utilities, maintenance budget)
- Variable costs (fuel, repair costs from resolved maintenance reports — where amounts have been entered)
- Central amoeba allocation (computed by headcount proportion — see §5.1)
- Gross P/L
- Hourly P/L (gross P/L / total hours worked)
- Target attainment

#### 6.4.3 Escalation Queue
A dedicated view for issues requiring manager attention. Distinct from the supervisor's alert inbox.

Items in the escalation queue:
- Alerts at tier 2+ that have not been resolved by the supervisor
- Alerts manually escalated by a supervisor
- High-severity incidents (Accident, Police) not acknowledged by supervisor within 30 minutes
- Vehicle-not-returned alerts (always manager-notified)
- Unsubmitted closeouts (supervisor missed the deadline)
- Inspection overdue vehicles

Each item shows the originating alert/incident, the supervisor responsible, and time elapsed since it entered the queue.

Actions: Acknowledge, comment, resolve, reassign to another supervisor, call operator (quick dial).

#### 6.4.4 Configurable Alert Thresholds
Manager or Admin can adjust alert thresholds without a code deploy.

| Alert | Parameter | Default |
|-------|-----------|---------|
| Excess offline | Tier 1 threshold (minutes) | 90 |
| Excess offline | Tier 2 threshold (minutes) | 120 |
| Excess offline | Tier 3 threshold (minutes) | 150 |
| High wait ratio | Tier 1 threshold (% wait/online) | 20% |
| High wait ratio | Tier 2 threshold (%) | 30% |
| High wait ratio | Tier 3 threshold (%) | 40% |
| Currently offline | Grace period (minutes) | 15 |
| Vehicle not returned | Distance from site (km) | 10 |
| Below target midday | Target % at 14:00 | 50% |
| Smart nudge — offline | Warn before threshold (minutes) | 15 |
| Smart nudge — vehicle return | Hours before close | 0.5 (19:30) |
| Media capture time tolerance | Max delta between capture and upload (minutes) | 5 |

Changes are applied on the next alert evaluation cycle. All threshold changes are written to the audit log.

#### 6.4.5 Fleet Roster Management
Manager (and Admin) can manage the fleet roster in-app, replacing the Google Sheet config tabs.

**Operators:**
- View, search, filter (by amoeba, status, platform)
- Edit operator: Ops App fields (site, supervisor, vehicle, target, platform registrations). Changes are audit-logged.
- Deactivate / reactivate operator
- Transfer operator between amoebas/sites (with effective date)

**Vehicles:**
- View, filter by amoeba and status
- Add vehicle: plate, type, amoeba, site
- Assign/unassign to operator
- Mark in-repair / reactivate

**Amoebas and Sites:**
- View all amoebas with operator count and current P/L
- Add/edit amoeba: name
- Add/edit site within an amoeba: name, GPS, alert radius, set as primary
- (Cannot delete a site with assigned operators)

**Supervisors:**
- View supervisor assignments
- Reassign operators between supervisors

All roster changes are audit-logged with before/after state.

#### 6.4.6 Leaderboards & Risk Lists
In addition to the global leaderboard (visible to all), managers see enriched versions:

**Best operators:** Top 10 by Performance Score, this week and this month.
**Chronic issues:** Operators with more than N alerts of a given type in the past 30 days (N configurable). Listed with alert breakdown.
**High cash exposure:** Operators with the largest running shortfall.
**Amoeba comparison:** Side-by-side table of all amoebas: efficiency, hourly P/L, target attainment, alert density (alerts per operator per day), inspection compliance rate.

#### 6.4.7 Daily Report (Manager View)
A richer version of the supervisor daily report, aggregated across all amoebas. Designed to support the daily operations meeting.

**Sections:**
1. **Quantitative summary:** Total operators active today, total trips, total revenue vs target, total cash expected vs remitted, net P/L vs target. Compared to yesterday and same day last week.
2. **Amoeba breakdown:** Table with one row per amoeba showing all key metrics.
3. **Alerts summary:** Total alerts today by type, compared to yesterday and 7-day average.
4. **Unresolved issues:** Open incidents, unacknowledged high-tier alerts, missed closeouts, overdue inspections.
5. **Anomalies:** Automatically flagged unusual events — e.g., an operator with unusually high trip count, an amoeba with revenue 30% below its 7-day average, a vehicle with two maintenance reports this week.
6. **Cash exposure detail:** List of operators with open shortfalls.

The report is generated on demand (one tap) and can be exported as PDF or shared as a formatted WhatsApp message with key metrics and a link to the full report.

#### 6.4.8 Export & Sharing
Available on most data views:
- **PDF export:** Full report with Fleximotion branding. Generated server-side.
- **CSV export:** Raw data for spreadsheet analysis.
- **WhatsApp share:** A pre-formatted text summary of key metrics, plus a deep link to the full report in the app. Opens WhatsApp with the message pre-composed.
- **Email:** Send report to one or more email addresses.

---

### 6.5 Admin Features

#### 6.5.1 User Management

**Operator onboarding is owned by the HR App, not the Ops App.** The Ops App receives a webhook event from the HR App when a user has been approved and activated. The Ops App does not have its own operator invite or hire flow.

**HR App → Ops App activation flow:**
1. HR App POSTs to `POST /api/v1/integrations/hr/user-activated` with user details: name, phone, role, amoeba_id, site_id, supervisor_id, platform registrations, daily_revenue_target.
2. Ops App creates the user record, sets status to `active`, and sends an SMS to the user's phone with a one-time PIN setup link.
3. User sets their 6-digit PIN and gains access to the Ops App PWA.
4. Simultaneously, the Ops App fires the `operator.activated` webhook to the Monnify Service for reserved account provisioning (operators only).

This flow applies to **all user roles** — operators, supervisors, managers. The HR App is the system of record for identity; the Ops App is the system of record for operational access and permissions.

**What Admin can do in the Ops App after a user is activated:**
- **Edit Ops-App-specific fields:** role, supervisor assignment, amoeba/site assignment, vehicle assignment, daily revenue target, platform account registrations, notification preferences.
- **Suspend / reactivate:** Suspended users cannot log in to the Ops App. Their data is not deleted. Suspension in the Ops App is independent of HR App status.
- **Force PIN reset:** Sends a new setup SMS to the user.
- **Assign Admin role:** Owner only. Triggers audit entry and confirmation step.
- **Revoke Admin role:** Owner only.
- **View all users:** Searchable, filterable list with status, role, amoeba, and last-login.

**Admin cannot:** create users from scratch in the Ops App, or edit fields that live in the HR App (legal name, employment status, contract type, salary). Those edits are made in the HR App and re-synced via webhook if needed.

#### 6.5.2 Notification Policy Controls
- **Per-alert-type push toggle:** Enable/disable push notifications for each alert type.
- **Per-alert-type SMS fallback toggle:** Enable/disable SMS for each alert type (SMS costs money — Admin controls this).
- **Escalation timing:** Configure how long before an unacknowledged alert escalates to manager (per incident type for incidents, per tier for operational alerts).
- **Supervisor recipients:** Alert assignment follows the operator's `supervisor_id`. If a supervisor is changed, new alerts go to the new supervisor.
- **Manager recipients:** Configure which managers receive which alert types. Supports multiple managers.
- **Catchall email:** Configure an email address that receives a copy of all alerts (for archive).
- **Quiet hours:** Configure a window during which push notifications are suppressed (e.g., 21:00–07:00 WAT). Alerts fired during quiet hours are queued for delivery at the start of the next window.

#### 6.5.3 Data Health Dashboard
The Admin's visibility into the system's own health.

Panels:
- **Platform ingestion:** Last run time for each platform connector, status (success/failure), operators fetched, next scheduled run.
- **Monnify Service:** Last received transaction timestamp, total transactions today, unmatched transaction count.
- **Job queue:** BullMQ queue depths and failure counts for each queue.
- **Failed alert dispatches:** Notifications that failed to deliver, with error detail and manual retry button.
- **Missing credentials:** Flags if any platform credentials are missing or expired.
- **Stale records:** Operators with no platform data for N days despite being active.
- **Inspection compliance:** % of vehicles with a current inspection (< 48 hours old).
- **Pending Monnify provisioning:** Operators with null `monnify_reserved_account` (provisioning failed or pending).

#### 6.5.4 Data Import
Historical data must be importable before go-live.

**Sources:**
- Google Sheets "Rider Daily Data" tab (CSV or XLSX export)
- Google Sheets "Rider_info" tab (operator names, amoebas, phones)
- Alert log export from the existing monitoring system (JSON or CSV)

**Import workflow:**
1. Admin uploads file via the import UI.
2. System parses and previews the rows: count, date range, identified operators, unmatched operators (i.e., operators in the file not in the Ops App roster).
3. Admin can map unmatched operator names to existing Ops App operators or mark as "skip."
4. Admin confirms import. System ingests rows as `PlatformDailyRecord` entries with a flag `source: "migration"`.
5. Import job runs in the background. Admin receives a push notification when complete, with a summary of rows imported, skipped, and failed.
6. Import is idempotent: re-importing the same file will not create duplicate records (keyed on operator_id + platform_account_id + date + source).

**Operator name matching:** During import, the system fuzzy-matches operator names from the sheet to existing User records (accounting for name variations, typos). Matches below a confidence threshold are flagged for manual review.

---

## 7. Integration Specifications

### 7.1 Platform Connector Interface

All platform integrations implement a common `PlatformConnector` interface:

```typescript
interface PlatformConnector {
  platformAccountId: string;            // references PlatformAccount.id
  authenticate(): Promise<void>;
  getOperators(): Promise<PlatformOperator[]>;
  getDailyPerformance(
    operatorIds: string[],
    date: string                        // YYYY-MM-DD, Lagos-day
  ): Promise<PlatformDailyRecord[]>;
  getShiftEvents(
    operatorIds: string[],
    date: string
  ): Promise<PlatformShiftEvent[]>;
  getLiveLocation(
    operatorIds: string[]
  ): Promise<PlatformLocation[]>;
}
```

Adding a new platform (e.g., inDrive) requires implementing this interface and registering it. No changes to the alert engine, ingestion scheduler, or report generator.

### 7.2 Bolt Connector
Implements `PlatformConnector` for the Bolt Fleet API. One `PlatformAccount` row per Bolt fleet account (currently one: company ID 168098 — to be stored in env config, not hardcoded). Authentication: OAuth2 client credentials. Key calls: `/orders`, `/state-logs`, `/drivers`. Rate limits respected with exponential backoff.

### 7.3 Uber Connector
Implements `PlatformConnector` for the Uber Fleet API. Supports **multiple `PlatformAccount` configurations** — currently two, with the architecture supporting more without code changes:

| PlatformAccount | display_name | vehicle_type | account_subtype | Notes |
|----------------|-------------|-------------|----------------|-------|
| uber-cars | Uber Ride-Hailing | car | ride_hailing | Acct 1. Org ID encrypted. Transactions endpoint available. |
| uber-courier | Uber Courier (Bikes) | motorbike | courier | Acct 2. FleximotionCourier. No /transactions (404). |

Authentication per account: OAuth2 30-day token. Credentials stored as env vars keyed by `credentials_key` field on `PlatformAccount` (e.g., `UBER_CARS_CLIENT_ID`, `UBER_COURIER_CLIENT_ID`). All Uber account credentials are available in Replit secrets and must be migrated to the Ubuntu server's env vars before go-live.

Key calls per account: timeline (hours worked, trip state machine), transactions (ride-hailing only), DRIVER_QUALITY CSV (acceptance/completion rates), live-location (20:00 WAT only, for vehicle-return alert).

Known quirks (to be carried forward):
- Uber Courier `/transactions` returns 404; revenue falls back to analytics TotalEarnings field. Cash/card split unavailable for this account.
- Uber Courier DRIVER_QUALITY CSV may 500 intermittently; driver rows still written with approximate rates from timeline data.
- DRIVER_QUALITY report is rate-limited; fetched once per day at the 07:00 cycle and cached.
- Live-location endpoint is quota-sensitive; called only at the 20:00 WAT cycle.

### 7.4 Monnify Integration (via dedicated Monnify Service)

The Ops App does **not** integrate directly with Monnify. A separate, dedicated **Monnify Service** (a distinct application within the suite) owns all Monnify interactions. The Ops App is a downstream consumer of that service.

**Architecture:**

```
Monnify ──webhook──► Monnify Service ──POST /api/v1/cash/transactions──► Ops API
                            │
                            │ (account provisioning)
                            ▼
                     Monnify API (reserved account creation)
                            │
                            └──callback──► Ops API (PATCH /api/v1/operators/:id/monnify-account)
```

**Responsibilities of the Monnify Service (out of Ops App scope):**
- Receives and validates Monnify webhooks (HMAC-SHA512 signature verification)
- Maintains the reserved account registry (account number → operator mapping)
- Calls Monnify API to provision new reserved accounts
- Forwards normalised transaction events to the Ops App

**Responsibilities of the Ops App with respect to cash:**
- Exposes `POST /api/v1/cash/transactions` — an authenticated internal endpoint the Monnify Service calls for each confirmed transaction. Payload: `{ operator_id, amount_ngn, transaction_ref, paid_at, monnify_account_number }`.
- Writes the `CashTransaction` record.
- Triggers cash reconciliation: compares total cash expected (from today's `PlatformDailyRecord` cash_trips across all active platform accounts for that operator) against total matched transactions for today.
- Sends push notification to the operator's supervisor with updated cash status.
- Exposes `PATCH /api/v1/operators/:id/monnify-account` — called by the Monnify Service once an account is provisioned, to write the `monnify_reserved_account` value onto the operator record.

**Operator activation flow (automated):**

When an operator is activated in the Ops App (status transitions from `pending_activation` to `active`), the Ops App fires an outbound webhook event to the Monnify Service:
```json
{ "event": "operator.activated", "operator_id": "...", "name": "...", "phone": "..." }
```
The Monnify Service receives this, calls the Monnify API to create a reserved virtual account, and calls back to the Ops App with the account number. From the Admin's perspective: approve the operator in the Ops App → reserved account appears on the operator profile automatically within seconds. No manual entry required.

**If the Monnify Service callback fails:** The Ops App retries the activation webhook on a schedule. The operator's `monnify_reserved_account` remains null and is flagged on the Admin data health dashboard until resolved.

_Note: The Monnify Service is a separate engineering workstream. The Ops API contract for the two endpoints above must be agreed with the Monnify Service team before either system is built._

### 7.5 HR App Integration

The HR App is a separate component of the MOS suite. It is the source of truth for user identity and employment records. The Ops App integrates with it via two mechanisms:

**Inbound (HR App → Ops App):**

| Event | Endpoint | Payload |
|-------|----------|---------|
| User activated | `POST /api/v1/integrations/hr/user-activated` | name, phone, role, amoeba_id, site_id, supervisor_id, platform_registrations[], daily_revenue_target |
| User deactivated | `POST /api/v1/integrations/hr/user-deactivated` | user_id, effective_date |
| User profile updated | `POST /api/v1/integrations/hr/user-updated` | user_id + changed fields |

All inbound HR App calls are authenticated via a shared secret (HMAC-signed header), not a user JWT. The shared secret is set in Ops App env vars.

**Outbound (Ops App → HR App):**  
The Ops App does not push data back to the HR App in v1. If HR App needs operational data (performance summaries for performance reviews, attendance from check-in/out), it should consume the Ops API directly with appropriate credentials.

**API contract:** The exact payload schemas for the three inbound events above must be agreed between the Ops App and HR App teams before either side builds their respective endpoints. These are the only cross-app contracts in v1.

### 7.6 CarTracker
The existing CarTracker GPS reconciliation remains in scope for v1. It is used to cross-check vehicle GPS against platform GPS. Implementation via the existing session-based (email/password) connector — this is what CarTracker supports. Results are surfaced on the Admin data health dashboard and on the manager's vehicle tracking view.

### 7.7 Firebase Cloud Messaging (FCM)
FCM is the recommended push notification delivery infrastructure. Reasons: free at this scale, excellent reliability on low-spec Android, supports PWA web push, handles offline queuing (messages are delivered when the device comes online). Each user's FCM token is stored on the `User` record and refreshed on each app login.

Push notification payloads are structured JSON, not plain text. The PWA service worker handles them and renders rich notifications with action buttons (e.g., "View alert", "Acknowledge").

### 7.8 SMS Fallback: Africa's Talking
Africa's Talking (credentials already configured in the existing system) is the SMS fallback channel. SMS is sent when:
- The user has no FCM token (not yet registered for push, or token expired)
- The push notification fails after N retries
- The Admin has configured SMS as required for a specific alert type

SMS is more expensive per message. The goal is to minimise SMS volume as more users adopt push.

### 7.9 Email Archive: Brevo
Email remains the archive channel for all significant operational notifications. Sent to the supervisor, manager (when applicable), and the Admin-configured catchall address. Not a primary notification channel — used for record-keeping.

---

## 8. Notification System

### 8.1 Notification Delivery Pipeline

```
Alert/Incident fires
      │
      ▼
NotificationsModule receives event
      │
      ├── Check recipient's push token → FCM dispatch
      │         │
      │         ├── Delivered → log success
      │         └── Failed → enqueue SMS fallback
      │
      ├── (If configured): Africa's Talking SMS
      │
      └── (For significant alerts): Brevo email (always async)
```

### 8.2 Alert Type → Recipient Mapping

| Alert Type | Tier 0 recipient | Tier 1 recipient | Tier 2+ recipient | Notes |
|-----------|-----------------|-----------------|-------------------|-------|
| Late resumption | Supervisor | — | — | Also notify operator (nudge at 08:15, alert at 08:30) |
| Far from amoeba | Supervisor + Manager | — | — | Always manager |
| Not seen today | Supervisor | — | — | |
| Currently offline | Supervisor | — | — | Also notify operator (nudge at 75 min) |
| Excess offline | Supervisor | Supervisor | Manager | Operator nudge before T1 |
| High wait ratio | Supervisor | Supervisor | Manager | |
| Trip rejection | Supervisor | — | — | |
| Vehicle not returned | Supervisor + Manager | — | — | Always manager |
| Below target midday | Supervisor | — | — | Operator nudge at 13:45 |
| Incident (high severity) | Supervisor | — | Manager (if supervisor doesn't ack in 30 min) | |
| Incident (low severity) | Supervisor | — | — | |

### 8.3 Notification Templates
All notifications are template-driven. Each template has:
- A short title (used as push notification title)
- A body with variable substitution (operator name, metric value, threshold)
- An action: deep link into the app at the relevant screen

Templates are stored in the database and editable by Admin. This allows message wording to be adjusted without a code deploy.

### 8.4 In-App Notification Centre
All notifications (push or otherwise) are also stored in the database and appear in an in-app notification bell icon. Unread count is shown as a badge. Tapping any notification navigates to the relevant alert, incident, or report.

Notifications are retained for 90 days in the database.

---

## 9. Offline & Low-Data Strategy

### 9.1 Core Principle

The app must remain usable for critical workflows with zero connectivity. "Usable" means:
- Operator can check in and check out
- Operator can submit an incident report
- Operator can view today's performance data (last known)
- Supervisor can view their team board (last known)
- Supervisor can acknowledge an alert (queued for sync)

### 9.2 What is Cached Offline

The PWA service worker caches:
- The app shell (HTML, CSS, JS bundles) — indefinitely, updated on app version deploy
- The current user's profile and role
- Today's shift state for the operator
- The last-fetched team board data for the supervisor (refreshed on each connect)
- The last-fetched daily performance data for the operator (refreshed on each connect)
- Alert inbox (last 48 hours)

### 9.3 Offline Write Queue

Actions taken while offline are written to IndexedDB with a queue status of `pending`. When connectivity returns, the queue drains in order. Each item records:
- Action type
- Payload
- Local timestamp
- GPS coordinates (if applicable)

If a queued item fails to sync (server-side error), it is flagged and the user is notified.

### 9.4 Conflict Resolution

If the server state has changed while the client was offline (e.g., a supervisor acknowledged an alert on another device), the server's state wins. The client refreshes on sync. No automatic merge — server is always the authority.

### 9.5 Data Volume Management

- API responses are paginated. Default page size: 20 records.
- Images served in responsive sizes: thumbnail (120px), preview (480px), full (original). The PWA requests the appropriate size.
- Charts use pre-aggregated data from the server — no raw row streaming.
- The app does not auto-play video. Video is downloaded on user tap, with a warning showing the file size.
- Text content loads before media. Media is lazy-loaded.

### 9.6 Upload Queue
See Section 6.1.3 (Media Capture) for the TUS resumable upload protocol. The upload queue is visible to users and persists across app restarts.

---

## 10. Security & Authentication

### 10.1 Authentication
- Phone number + 6-digit PIN (bcrypt-hashed, minimum cost factor 12)
- JWT access tokens (15-minute expiry, signed RS256)
- Refresh tokens (30-day expiry, stored HttpOnly, SameSite=Strict)
- Token rotation on every refresh
- Brute-force protection: 5 failed PIN attempts → 15-minute lockout → SMS alert to user

### 10.2 Authorisation
- Role-based access control enforced via NestJS Guards on every endpoint
- Data scoping enforced at query level (not application layer)
- No endpoint bypasses role checks

### 10.3 Transport Security
- HTTPS only (TLS 1.2+). HTTP redirects to HTTPS.
- HSTS header with minimum 1-year max-age.
- All API responses include `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

### 10.4 API Security
- Rate limiting: 100 requests/minute per authenticated user; 10 requests/minute for auth endpoints.
- Input validation on all endpoints using class-validator (NestJS).
- SQL injection prevention via parameterised queries only (no string interpolation in queries).
- Inter-service calls (HR App, Monnify Service) authenticated via HMAC-signed shared secrets.

### 10.5 Media Security
- Media items are stored with access-controlled URLs. A signed URL (valid for 1 hour) is required to access any media item. URLs are generated on demand per-request.
- Direct-access URLs (without signed token) return 403.

### 10.6 Infrastructure Security
- The API is not publicly exposed beyond HTTPS on the standard port. Admin and developer portal endpoints are IP-restricted at the Nginx level.
- Database is not accessible from the public network.
- Environment secrets are stored in system environment variables, not in source code or config files.
- Backups are encrypted at rest.

---

## 11. API Design

### 11.1 Design Principles
- RESTful, resource-oriented URLs
- All dates and times in ISO 8601 UTC; Lagos-local conversions happen in the presentation layer
- Consistent error response schema: `{ error: { code, message, details? } }`
- Pagination via cursor-based approach for time-series data; offset-based for roster/list views
- API versioning via URL prefix: `/api/v1/...`
- All responses include a `request_id` header for support tracing
- Internal service-to-service endpoints (HR App, Monnify Service) use HMAC-signed shared secrets, not user JWTs

### 11.2 Authentication Endpoints
```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/pin-reset/request    (sends OTP via SMS)
POST /api/v1/auth/pin-reset/confirm
POST /api/v1/auth/webauthn/register
POST /api/v1/auth/webauthn/authenticate
```

### 11.3 Core Resource Endpoints (representative — full spec in OpenAPI doc)

```
# Users / Roster
GET    /api/v1/users                   (Admin/Manager)
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id               (soft-delete / deactivate)

# Operators
GET    /api/v1/operators               (scoped by role)
GET    /api/v1/operators/:id
GET    /api/v1/operators/:id/performance   ?date=YYYY-MM-DD&range=day|week|month
GET    /api/v1/operators/:id/alerts
GET    /api/v1/operators/:id/profile   (AI narrative + structured stats)
GET    /api/v1/operators/:id/cash      (Monnify-derived cash status)

# Shifts
POST   /api/v1/shifts/check-in
POST   /api/v1/shifts/check-out
GET    /api/v1/shifts/:operatorId/today

# Alerts
GET    /api/v1/alerts                  (inbox, scoped)
GET    /api/v1/alerts/:id
PATCH  /api/v1/alerts/:id/acknowledge
PATCH  /api/v1/alerts/:id/resolve
PATCH  /api/v1/alerts/:id/snooze
PATCH  /api/v1/alerts/:id/escalate
POST   /api/v1/alerts/:id/comment

# Incidents
POST   /api/v1/incidents               (operator submits)
GET    /api/v1/incidents               (scoped)
GET    /api/v1/incidents/:id
PATCH  /api/v1/incidents/:id/acknowledge
PATCH  /api/v1/incidents/:id/resolve

# Deviation reasons
POST   /api/v1/deviations              (operator submits against alert_id)
PATCH  /api/v1/deviations/:id/review   (supervisor accept/reject)

# Inspections
POST   /api/v1/inspections             (supervisor submits)
GET    /api/v1/inspections             (scoped)
PATCH  /api/v1/inspections/:id/review  (manager)

# Media
POST   /api/v1/media/upload-url        (get signed TUS upload URL)
POST   /api/v1/media                   (confirm upload complete)
GET    /api/v1/media/:id/url           (get signed access URL)

# Performance / Reporting
GET    /api/v1/reports/daily           ?date=&amoeba_id=
GET    /api/v1/reports/amoeba-summary  ?from=&to=&amoeba_id=
GET    /api/v1/reports/executive       ?from=&to=
GET    /api/v1/reports/revenue-profile ?from=&to=   (revenue by hour of day)
GET    /api/v1/reports/leaderboard     ?scope=company|amoeba&from=&to=  (revenue component hidden based on caller role)

# Cash (data pushed from Monnify Service)
GET    /api/v1/cash/operator/:id/today
GET    /api/v1/cash/operator/:id/history
POST   /api/v1/cash/transactions              (internal — called by Monnify Service, HMAC-auth)
PATCH  /api/v1/operators/:id/monnify-account  (internal — called by Monnify Service on provisioning)

# Inter-app integrations (all HMAC-authenticated, not user-facing)
POST   /api/v1/integrations/hr/user-activated
POST   /api/v1/integrations/hr/user-deactivated
POST   /api/v1/integrations/hr/user-updated

# Notifications
GET    /api/v1/notifications           (inbox)
PATCH  /api/v1/notifications/:id/read
GET    /api/v1/notifications/settings  (policy)
PATCH  /api/v1/notifications/settings  (Admin only)

# Admin
GET    /api/v1/admin/health
GET    /api/v1/admin/audit-log         ?from=&to=&actor_id=&entity_type=
POST   /api/v1/admin/import/upload
POST   /api/v1/admin/import/:jobId/confirm
GET    /api/v1/admin/import/:jobId/status
```

### 11.4 Real-Time: Server-Sent Events
The live team board and alert inbox use SSE for real-time updates:
```
GET /api/v1/stream/supervisor/:supervisorId   (scoped: team board + alert events)
GET /api/v1/stream/admin                      (system health events)
```

SSE is preferred over WebSocket for simplicity. If the SSE connection drops (low connectivity), the client falls back to polling every 60 seconds.

### 11.5 API Documentation
The OpenAPI 3.1 spec is auto-generated from NestJS decorators. It is served via Redocly at `https://<server>/developer`. Access is restricted by Nginx IP allowlist. The spec file is also exportable as JSON/YAML from the developer portal.

---

## 12. Infrastructure

### 12.1 Ubuntu Server Deployment

The Ops App runs entirely on a single Ubuntu 22.04 LTS server (initially). Components:

| Component | Process manager | Port |
|-----------|----------------|------|
| NestJS API | PM2 | 3000 (internal) |
| React PWA | Served as static files by Nginx | — |
| Redocly developer portal | Nginx static | — |
| BullMQ workers | PM2 (separate process) | — |
| PostgreSQL | systemd | 5432 (internal only) |
| Redis | systemd | 6379 (internal only) |
| Nginx | systemd | 80, 443 (public) |

Nginx is the public-facing reverse proxy. It handles TLS termination, static file serving, and proxies `/api/` to the NestJS process.

### 12.2 Object Storage
Media files (photos, videos) are stored in object storage rather than local disk, for durability and scalability. Recommended: Cloudflare R2 (S3-compatible, no egress fees) or AWS S3. Local disk is used as a TUS upload staging area only; files are moved to object storage after upload completion.

### 12.3 Cron Schedule
External cron (cron-job.org or system cron) triggers the platform ingestion job via `POST /api/v1/ingest/run`. Runs hourly 07:00–21:00 WAT. The BullMQ scheduler handles job retry and the API server itself does not own the cron clock (lesson from the existing system's missed-run incident of 2026-04-29).

A watchdog worker checks that an ingest has run within the expected window and fires an alert to Admin via push/email if a run is missed.

### 12.4 Backups
- PostgreSQL: daily `pg_dump`, compressed, uploaded to object storage. Retain 30 days.
- Redis: AOF persistence enabled. Regular RDB snapshots.
- Media files: stored in object storage with versioning enabled.

### 12.5 Monitoring
- PM2 process monitoring for uptime.
- Application-level health endpoint: `GET /api/v1/health` (returns DB connection, Redis connection, queue depths, last ingest time).
- Admin data health dashboard reads from this endpoint.
- For production-grade uptime monitoring: use UptimeRobot or similar to ping the health endpoint and alert Admin via SMS/email if the server is unreachable.

---

## 13. Data Migration & Historical Import

### 13.1 Pre-Launch Requirement
Migration of historical data from the Google Sheets is a hard go-live requirement. The target is to have at minimum 3 months of `PlatformDailyRecord` history imported before the app goes live, so that trend charts and operator profiles are meaningful from day one.

### 13.2 Migration Sources
1. **"Rider Daily Data" tab** — maps to `PlatformDailyRecord`. Columns A–Z per the current schema.
2. **"Rider_info" tab** — maps to operator user records + amoeba assignments.
3. **"Amoeba_Daily_Summary" tab** — maps to `AmoebaDailySummary` historical records.
4. **Alert log** (from existing monitoring system PostgreSQL) — maps to `Alert` records with `source: "migration"`.

### 13.3 Migration Tooling
A standalone Node.js migration script (`scripts/migrate-sheets.ts`) will be built as part of the v1 delivery. It:
- Accepts a CSV export of the Rider Daily Data tab
- Reads the Ops App operator roster (API call with Admin credentials)
- Fuzzy-matches operator names between the sheet and the Ops App roster
- Outputs a mapping file (CSV) showing match results and confidence scores
- An Admin reviews and corrects the mapping file
- The confirmed mapping file is fed back to the script to execute the import via the Admin import API

### 13.4 Idempotency
All import operations are idempotent. Re-running the import for the same data will not create duplicates. Records are keyed on `(operator_id, platform_account_id, date, source)`.

---

## 14. Phase Plan

### Phase 1 — Foundation (MVP)
**Goal:** Replace the existing Replit tools with a production-quality backend and basic PWA. All current functionality plus authentication, mobile UI, and alert acknowledgement.

Deliverables:
- NestJS API with Auth, Fleet, Ingest (Bolt + Uber), Alerts, Notifications modules
- PWA with Operator home screen (check-in/out, target progress, alerts) and Supervisor live team board + alert inbox with acknowledgement
- PostgreSQL schema and migrations
- BullMQ workers for ingestion and notification dispatch
- FCM push + Africa's Talking SMS fallback
- Historical data migration tooling and execution
- OpenAPI spec + Redocly developer portal
- Ubuntu server deployment with Nginx + PM2
- Admin user management and fleet roster
- HR App integration endpoints

**Explicitly deferred to Phase 2:** Monnify integration, AI operator profile, vehicle inspection UI, P&L with fixed costs, export features, leaderboards

### Phase 2 — Operational Depth
Deliverables:
- Monnify Service integration endpoints + cash status views
- Vehicle inspection workflow (supervisor + manager review)
- Daily closeout workflow
- Operator deviation reason capture
- Smart nudges to operators
- Supervisor amoeba performance view with trend charts
- Manager executive dashboard + P&L view
- Leaderboards with Performance Score
- Export (PDF, CSV, WhatsApp share)
- AI operator weekly profile (on-demand OpenAI call)

### Phase 3 — Advanced & Extensibility
Deliverables:
- In-app announcements and policy acknowledgements
- Revenue profile / hourly trend analysis
- Escalation queue (manager)
- Daily report (manager view, meeting-ready)
- Third platform connector (inDrive or other)
- CarTracker reconciliation surface (admin health dashboard)
- Multi-amoeba performance comparison

---

## 15. Resolved Design Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Amoeba structure | An amoeba is an organisational unit that can span **multiple physical sites** (`AmoebaSite`). Operators are assigned to a single amoeba and a mandatory specific site. Location-based alerts use the site's GPS centroid and radius. |
| 2 | Fixed costs | Reviewed and entered **monthly**. Standard categories: rent, salaries, electricity, communication. A **Central amoeba** holds shared-service costs distributed by operator headcount. |
| 3 | Closeout deadline | Supervisors must submit daily closeout by **19:00 WAT**. Management report available at all times but flags amoebas with pending closeout. |
| 4 | Multi-platform operators | Operators can be registered on multiple platforms. Each registration is a separate `OperatorPlatformAccount` row. Daily performance stored per platform account, not aggregated. Alert engine queries only `active` registrations. |
| 5 | Language | English only. |
| 6 | Monnify mapping | Each operator has their own **Monnify reserved virtual account**. Account number is the lookup key, populated automatically by the Monnify Service on activation. |
| 7 | LLM provider | **OpenAI** (GPT-4o or equivalent). Used only for on-demand AI operator profile narratives. |
| 8 | CarTracker auth | Email/password session auth — that is what CarTracker supports. |
| 9 | Video length cap | **60 seconds** maximum. Configurable by Admin. |
| 10 | Uber credentials | Credentials for both Uber accounts present in Replit secrets; to be migrated to Ubuntu env vars before go-live. |

## 16. Resolved Decisions (Round 2)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Operator site assignment | **Mandatory.** Every operator assigned to a specific `AmoebaSite`. No amoeba-level-only assignment. |
| 2 | Central amoeba cost distribution | Proportional by **active operator headcount**. Formula: `Central cost × (amoeba headcount / total headcount)`. Computed at report-generation time. |
| 3 | Multi-platform daily target | **Combined.** `daily_revenue_target` is a single figure across all platforms. |
| 4 | Leaderboard privacy | **Full visibility, ranked by Performance Score.** Revenue component hidden from operators, visible to supervisors and managers. Admin can restrict to within-amoeba only if policy changes. |
| 5 | Monnify provisioning | Handled by **dedicated Monnify Service**. Ops App fires `operator.activated` webhook; Monnify Service provisions and callbacks with account number. Fully automated. |

## 17. Resolved Decisions (Round 3)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Operator onboarding ownership | **HR App owns onboarding.** Ops App exposes three HMAC-authenticated endpoints for HR App lifecycle events. No hire/invite flow in the Ops App. |
| 2 | Leaderboard scoring | Weighted **Performance Score** (0–100): acceptance rate 30%, time online 30%, cash receipt accuracy 30%, revenue attainment 10% (default, Admin-configurable, weights must sum to 1.0). Revenue hidden from operators. Timeline default is weekly but user-selectable. |
| 3 | App naming | This application is the **Ops App** / **Ops API**. "MOS" refers to the full Fleximotion Management & Operations Suite. Never use "MOS" to mean this app specifically. |

## 18. Open Questions

There are no blocking open questions. The spec is ready for database schema design and Phase 1 engineering kickoff.

Items to confirm during sprint planning (not blocking):
- Exact Monnify Service → Ops API payload schemas (to be agreed with Monnify Service team)
- HR App → Ops App event payload schemas (to be agreed jointly)
- Ubuntu server specs (CPU/RAM/disk) for initial deployment sizing
- Object storage provider selection (Cloudflare R2 vs AWS S3)

---

*End of Fleximotion Ops App System Specification v0.4*  
*Status: Ready for database schema design and Phase 1 engineering kickoff.*
