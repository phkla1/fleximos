# Fleximotion Operator Alert System
## PRD + Technical Specification
**Version:** 1.1  
**Date:** 2026-03-24  
**Status:** Draft — Pending Final Approval Before Build

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-24 | Initial draft |
| 1.1 | 2026-03-24 | Multi-platform connector architecture; Alert 8 (vehicle return); Manager layer; terminology "operator"; testing section; SMS provider abstracted; multiple open questions resolved |

---

## 1. Executive Summary

Fleximotion supervisors currently have no real-time visibility into operator behaviour during the working day. Issues such as late resumptions, excessive offline time, poor wait-time management, trip rejections, and vehicles not returning to base are only discovered after the fact — at daily report review time.

This system delivers an **automated hourly alert engine** that monitors each operator's live activity via platform APIs (initially Bolt; other platforms to follow) and proactively notifies supervisors when specific behavioural thresholds are crossed. Alerts are sent via SMS (brief, actionable) and email (contextual detail).

The system runs automatically every hour from **07:00 to 21:00 WAT (GMT+1)** and is designed to surface only **new, actionable information** — not repetitive notifications that will be ignored.

The architecture uses a **pluggable connector model**: platform-specific API logic (Bolt, Uber, Chowdeck, etc.) is isolated in independent connector modules. New platforms can be added without touching the alert engine or notification layer.

---

## 2. Objectives

### 2.1 Primary Objective
Give supervisors and managers real-time visibility into operator behaviour throughout the working day, enabling timely intervention rather than end-of-day discovery.

### 2.2 Secondary Objectives
- Reduce supervisor workload by automating monitoring
- Avoid alert fatigue through strict deduplication rules
- Provide configurable operator/supervisor/manager/office mappings via Google Sheets
- Support multiple fleet platforms (Bolt initially; Uber, Chowdeck, others to follow)
- Build a foundation for future alerting rules as operational needs evolve

---

## 3. Scope

### 3.1 In Scope
- Hourly automated execution (07:00–21:00 WAT)
- Eight distinct alert conditions (see Section 6)
- Per-alert deduplication tracked in PostgreSQL
- SMS notifications via SMS provider (Africa's Talking preferred; Twilio as fallback)
- Email notifications via Brevo
- Operator/supervisor/manager/office config via Google Sheets
- Pluggable platform connector architecture (Bolt connector built in Phase 1)
- Audit log of all alerts sent

### 3.2 Out of Scope (Phase 1)
- Uber, Chowdeck, or any other platform connector (architecture ready, connector not built)
- Web dashboard or UI for alert history
- Operator self-service or acknowledgement of alerts
- Automated escalation if supervisor does not respond
- WhatsApp/Telegram notifications

---

## 4. Terminology

Throughout this document, **"operator"** refers to any field worker monitored by the system — whether a motorcycle rider, car driver, or delivery operative — on any platform. The term replaces "rider" or "driver" to remain neutral across current and future platform types.

---

## 5. Users & Usage

### 5.1 User Personas

- **Supervisor (Primary Alert Recipient):** Receives SMS and email alerts. Acts by calling or messaging the relevant operator.
- **Manager (Secondary Recipient):** Receives CC on all emails and SMS on selected high-priority alerts. Each supervisor is assigned to a manager.
- **Owner/Manager Catch-All Email:** A single email address that receives a copy of every alert email, regardless of which supervisor or manager is involved. This ensures full oversight at the ownership level.
- **Operations Admin:** Maintains the Google Sheets config (adding/removing operators, updating contacts, adjusting office coordinates).

### 5.2 Workflow

**Automated hourly flow:**
1. Scheduler triggers at the top of each hour (07:00, 08:00, … 21:00 WAT)
2. System reads the latest config from Google Sheets (operators, supervisors, managers, offices)
3. For each operator, system selects the correct **platform connector** based on the operator's assigned platform
4. Connector fetches today's activity from the relevant platform API
5. Alert engine evaluates all 8 conditions against current data
6. Deduplication engine suppresses already-sent alerts using the database log
7. Notification dispatcher sends new alerts:
   - SMS: supervisor + manager (manager only on alerts 2 and 8)
   - Email: supervisor (with CC to assigned manager and the catch-all address)
8. Audit logger records all dispatched alerts

**Config update flow:**
- Ops admin edits the Google Sheet at any time
- Changes take effect on the next hourly run automatically (no restart required)

---

## 6. Business Rules

### 6.1 Operating Window
- **Scheduler window:** 07:00 – 21:00 WAT (every hour on the hour)
- **Expected online window:** 08:30 – 19:00 WAT (operator working hours)
- **Late resumption deadline:** 08:30 WAT
- **"Not seen" deadline:** 11:00 WAT
- **Vehicle return deadline:** 20:00 WAT

### 6.2 Timezone
All times are **WAT (West Africa Time, UTC+1)**. All platform API timestamps are Unix UTC; the system must convert to WAT for all display and threshold evaluation.

### 6.3 Deduplication Principle
The system must send **new information only**. If a condition was already flagged in a prior run today, suppress it unless the situation has materially changed (e.g., offline time has worsened to a new tier). See Section 8 for per-alert deduplication rules.

### 6.4 Alert Targeting
Each operator is assigned to one supervisor in the config. Each supervisor is assigned to one manager.

**SMS routing:**
- All alerts → supervisor
- Alerts 2 and 8 only → manager also

**Email routing:**
- All alerts → supervisor (To)
- Assigned manager → CC
- Catch-all management email address → BCC (always)

Each email is a per-supervisor digest: one email per supervisor per hourly run, grouping all new alerts across their operators. Managers do not receive a separate digest; they receive the CC.

### 6.5 Alert Content
Every alert (SMS and email) must include:
- Operator name
- Supervisor name
- Platform (Bolt, Uber, etc.)

This ensures context is preserved when alerts are forwarded or reviewed out of the immediate reporting chain.

### 6.6 Operator Inclusion
All operators listed in the config file are monitored. To exclude an operator, remove them from the config file. No in-file exclusion flag is supported.

---

## 7. Alert Specifications

### Alert 1 — Late Resumption

**Trigger:** An operator's first transition to any online/active state occurs **after 08:30 WAT** on a working day.

**Platform data:** First state-change event with an active/online status for today (see Section 10 for connector specifics).

**Deduplication:** Fire **once per operator per day**.

**SMS example:**
> `[ALERT] Emeka Okafor (Bolt) came online late at 09:14 (exp. 08:30). Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, actual resumption time, delta from 08:30, supervisor name, first online GPS location.

---

### Alert 2 — Resumed Far from Office

**Trigger:** The operator's first online GPS coordinate is more than the configured threshold distance from their assigned office location.

**Interpretation:** Operator likely did not return the vehicle to the office the previous night.

**Distance threshold:** Configurable per office in the Google Sheets config (`alert_distance_m` column). Default if blank: **500 metres**.

**Distance calculation:** Haversine formula applied to operator first-online coordinates vs office coordinates.

**Deduplication:** Fire **once per operator per day**.

**Manager SMS:** Yes (in addition to supervisor).

**SMS example:**
> `[ALERT] Aondoyima Akighir (Bolt) resumed 2.4km from Lekki Office. Possible overnight parking issue. Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, first-online coordinates, office name, computed distance, configured threshold, supervisor name, manager name.

---

### Alert 3 — Operator Not Seen Today

**Trigger:** It is **11:00 WAT or later** and the operator has had **zero online/active events** for today.

**Rationale:** By 11:00 there is no plausible excuse for not having come online. This is a "no-show" flag.

**Deduplication:** Fire **once per operator per day**. Only evaluated from the **11:00 run onward**.

**SMS example:**
> `[ALERT] Chukwuemeka Dike (Bolt) has NOT come online today (11:00 check). Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, date, supervisor name, suggested action (call operator, verify vehicle status).

---

### Alert 4 — Operator Currently Offline (Mid-Day)

**Trigger:** At the time of the hourly check:
- Operator's most recent state is offline/inactive, AND
- Current time is within **08:30–19:00 WAT**, AND
- The operator has been in this offline episode for **more than 15 minutes**, AND
- This specific offline episode has not been alerted previously

**Deduplication:** Fire **once per offline episode**. Each episode is identified by its start timestamp. A new episode (went offline, returned online, went offline again) generates a new alert.

**SMS example:**
> `[ALERT] Fatima Bello (Bolt) offline since 14:22 (1h 12m). Supervisor: Ngozi Eze. -FlexiFleet`

**Email content:** Operator name, platform, offline start time, duration so far, total offline episodes today, cumulative offline time today, supervisor name.

---

### Alert 5 — Excess Total Offline Time Today

**Trigger:** The operator's cumulative offline/inactive time **after first coming online today** exceeds **1.5 hours (90 minutes)**.

**Calculation:** Sum of all offline/inactive durations after the first online event. Pre-resumption overnight offline time is excluded.

**Deduplication:** Tiered — fire **once per tier crossed per day**:
- Tier 1: ≥ 90 min (1h 30m)
- Tier 2: ≥ 120 min (2h 00m)
- Tier 3: ≥ 150 min (2h 30m)

**SMS example:**
> `[ALERT] Aondoyima Akighir (Bolt) total offline today: 1h 48m (limit: 1h 30m). Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, total offline time, breakdown by episode, current state, supervisor name, tier reached.

---

### Alert 6 — High Wait-Time Ratio

**Trigger:** The operator's cumulative waiting time today, as a percentage of total online time, exceeds **20%**.

**Calculation:**
```
wait_ratio = sum(waiting durations) / sum(all active/online durations)
```

**Deduplication:** Tiered — fire **once per tier crossed per day**:
- Tier 1: ≥ 20%
- Tier 2: ≥ 30%
- Tier 3: ≥ 40%

**SMS example:**
> `[ALERT] Emeka Okafor (Bolt) wait-time ratio: 28% (target <20%). Suggest relocating. Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, wait ratio, absolute wait time vs online time, last known location, suggested action, supervisor name.

---

### Alert 7 — New Trip Rejections / Cancellations

**Trigger:** Since the last hourly check, one or more trips attributed to this operator have a status indicating driver-side rejection or cancellation.

**Bolt statuses that trigger this alert:**
- `driver_rejected` — explicit decline of a trip offer
- `driver_did_not_respond` — timeout / no response within acceptance window
- `driver_cancelled_after_accept` — accepted then cancelled before pickup

**Other platforms:** Equivalent statuses to be mapped in each connector.

**Deduplication:** Fire **every hour that new rejections/cancellations appear**. This alert is inherently incremental (covers the new hour only); repetition is expected and appropriate.

**SMS example:**
> `[ALERT] Aondoyima Akighir (Bolt): 2 trip rejections/cancellations in last hour. Supervisor: Ade Lawal. -FlexiFleet`

**Email content:** Operator name, platform, count by rejection type (rejected, no response, cancelled after accept), order timestamps if available, supervisor name.

---

### Alert 8 — Vehicle Not Returned to Office

**Trigger:** At the **20:00 WAT run**, the operator's last known GPS location is more than **10 km** from their assigned office.

**Rationale:** By 20:00 WAT the working day has ended. Vehicles should be returning to or parked at the office. If an operator's last recorded position is far from the office, this may indicate the vehicle will not be returned overnight.

**Distance threshold:** Fixed at **10 km** (not per-office configurable in Phase 1, but can be added to the Offices sheet later).

**Deduplication:** Fire **once per operator per day**. Only evaluated at the **20:00 run**.

**Manager SMS:** Yes (in addition to supervisor).

**SMS example:**
> `[ALERT] Fatima Bello (Bolt) last location 14.2km from Lekki Office at 20:00. Vehicle may not return tonight. Supervisor: Ngozi Eze. -FlexiFleet`

**Email content:** Operator name, platform, last known coordinates, office name, computed distance, timestamp of last known position, supervisor name, manager name.

---

## 8. Deduplication Summary Table

| Alert | Fires | Suppressed After |
|-------|-------|-----------------|
| 1 — Late Resumption | Once per day | After first fire |
| 2 — Resumed Far from Office | Once per day | After first fire |
| 3 — Not Seen Today | Once per day | After first fire (from 11:00 only) |
| 4 — Currently Offline | Once per offline episode | After episode is alerted |
| 5 — Excess Offline Total | Once per tier (90m / 120m / 150m) | After each tier is alerted |
| 6 — High Wait Ratio | Once per tier (20% / 30% / 40%) | After each tier is alerted |
| 7 — Rejections/Cancellations | Every run with new events | Never suppressed (new data) |
| 8 — Vehicle Not Returned | Once per day (20:00 run only) | After first fire |

---

## 9. Config File (Google Sheets)

The config is a dedicated Google Sheet (separate from the Flexi Report Automate sheet) shared with the Replit integration service account. The system reads it fresh at the start of every hourly run so changes take effect without any restart.

**Sheet: Operators**

| Column | Type | Description |
|--------|------|-------------|
| `operator_id` | string | Platform-assigned driver UUID (e.g. Bolt `driver_uuid`) |
| `operator_name` | string | Display name |
| `platform` | string | Platform identifier: `bolt`, `uber`, `chowdeck`, etc. |
| `supervisor_id` | string | Foreign key to Supervisors sheet |
| `office_id` | string | Foreign key to Offices sheet |

**Sheet: Supervisors**

| Column | Type | Description |
|--------|------|-------------|
| `supervisor_id` | string | Unique ID |
| `name` | string | Display name |
| `phone` | string | E.164 format e.g. `+2348012345678` (multiple numbers: comma-separated) |
| `email` | string | Alert email address (multiple: comma-separated) |
| `manager_id` | string | Foreign key to Managers sheet |

**Sheet: Managers**

| Column | Type | Description |
|--------|------|-------------|
| `manager_id` | string | Unique ID |
| `name` | string | Display name |
| `phone` | string | E.164 format (multiple: comma-separated). Receives SMS only for Alerts 2 and 8. |
| `email` | string | CC'd on all alert emails for their supervisors (multiple: comma-separated) |

**Sheet: Offices**

| Column | Type | Description |
|--------|------|-------------|
| `office_id` | string | Unique ID |
| `office_name` | string | Display name e.g. "Lekki Office" |
| `lat` | number | Office latitude |
| `lng` | number | Office longitude |
| `alert_distance_m` | number | Distance threshold for Alerts 1 & 2, in metres (default: 500) |

**Global config (single-row metadata sheet or environment variable):**

| Key | Value |
|-----|-------|
| `catchall_email` | Email address that receives BCC of every alert email |

---

## 10. Platform Connector Architecture

The alert engine is fully platform-agnostic. It consumes a **standardised operator activity object** produced by platform connectors. Each connector is responsible for authenticating with its platform API and transforming the raw response into this standard format.

### 10.1 Standard Operator Activity Object

```typescript
interface OperatorActivity {
  operatorId: string;           // Platform driver UUID
  platform: string;             // 'bolt' | 'uber' | 'chowdeck' | ...
  date: string;                 // YYYY-MM-DD in WAT

  stateLogs: StateLogEntry[];   // Chronological state changes
  orders: OrderEntry[];         // Trips/orders for the hour being checked
}

interface StateLogEntry {
  timestamp: number;            // Unix UTC
  state: 'inactive' | 'waiting' | 'active';
                                // inactive = offline
                                // waiting  = online, no order
                                // active   = has or is on an order
  lat: number | null;           // GPS latitude (null if unavailable)
  lng: number | null;           // GPS longitude (null if unavailable)
}

interface OrderEntry {
  orderId: string;
  createdAt: number;            // Unix UTC
  status: OrderStatus;
  cancellationSide: 'driver' | 'client' | 'system' | null;
}

type OrderStatus =
  | 'completed'
  | 'driver_rejected'
  | 'driver_no_response'
  | 'driver_cancelled_after_accept'
  | 'client_cancelled'
  | 'other';
```

### 10.2 Connector Interface

Each connector implements:

```typescript
interface PlatformConnector {
  platform: string;

  // Fetch all state logs for an operator for today (WAT)
  getStateLogs(operatorId: string, dateWAT: string): Promise<StateLogEntry[]>;

  // Fetch orders for an operator within a time range (for Alert 7)
  getOrders(operatorId: string, fromTs: number, toTs: number): Promise<OrderEntry[]>;
}
```

### 10.3 Bolt Connector (Phase 1)

**API base URL:** `https://node.bolt.eu/fleet-integration-gateway`

**Authentication:** Bearer token via client credentials flow using `BOLT_CLIENT_ID` / `BOLT_CLIENT_SECRET`. Token cached until expiry.

**Endpoints used:**

| Endpoint | Purpose | Maps To |
|----------|---------|---------|
| `POST /fleetIntegration/v1/getFleetStateLogs` | State change log | `getStateLogs()` |
| `POST /fleetIntegration/v1/getFleetOrders` | Orders by time range | `getOrders()` |

**Bolt state mapping:**

| Bolt state | Standard state |
|-----------|---------------|
| `inactive` | `inactive` |
| `waiting_orders` | `waiting` |
| `has_order` | `active` |
| `busy` | `active` |

**Bolt order status mapping:**

| Bolt status | Standard status |
|------------|----------------|
| `driver_rejected` | `driver_rejected` |
| `driver_did_not_respond` | `driver_no_response` |
| `driver_cancelled_after_accept` | `driver_cancelled_after_accept` |
| `finished` | `completed` |
| `client_cancelled` / `client_did_not_show` | `client_cancelled` |
| All others | `other` |

**State log field used:**

```
DriverStateLogRow:
  driver_uuid   string    operator identifier
  created       number    Unix UTC timestamp of state change
  state         enum      inactive | waiting_orders | has_order | busy
  lat           number    GPS latitude at state change (confirmed available)
  lng           number    GPS longitude at state change (confirmed available)
```

GPS coordinates are confirmed available in every state change event. Approximate accuracy is acceptable for distance calculations.

### 10.4 Adding Future Connectors (Uber, Chowdeck, etc.)

To add a new platform:
1. Create a new connector file implementing the `PlatformConnector` interface
2. Add the relevant API credentials as environment secrets
3. Register the connector in the connector registry (keyed by platform string)
4. Add the platform operators to the Google Sheets config

**No changes are needed** to the alert engine, deduplication logic, or notification layer.

---

## 11. Notification Channels

### 11.1 SMS

**Provider:** Africa's Talking (preferred). Twilio as fallback if Africa's Talking is unavailable. The SMS sending layer is abstracted behind a common interface so the provider can be switched without touching alert logic.

**Format:** ≤ 160 characters per message. Prefix: `[ALERT]`. Suffix: `-FlexiFleet`. Always includes operator name, platform, and supervisor name.

**Timing:** Sent per operator as new alerts are detected.

**Recipients:**
- All alerts → supervisor phone(s)
- Alerts 2 and 8 only → manager phone(s)

### 11.2 Email (Brevo / Sendinblue)

**Format:** Per-supervisor digest — one email per supervisor per hourly run, grouping all new alerts for their operators. No email sent if there are no new alerts.

**Recipients:**
- **To:** Supervisor email(s)
- **CC:** Manager email(s) (assigned to that supervisor)
- **BCC:** Catch-all management email address (every email, always)

**Content:** Full contextual detail per alert — timestamps, distances, durations, GPS references, and recommended action.

**From address:** Configured via `BREVO_FROM_EMAIL` environment variable.

---

## 12. System Architecture

```
[Scheduler: cron 07:00–21:00 WAT, hourly]
         |
         v
[Config Reader] ← Google Sheets (Operators, Supervisors, Managers, Offices)
         |
         v
[Connector Registry]
   ├── BoltConnector      → Bolt Fleet API
   ├── UberConnector      → (Phase 2)
   └── ChowdeckConnector  → (Phase 2)
         |
         v
[Alert Engine] — evaluates 8 conditions per operator
         |
         v
[Deduplication Engine] ← PostgreSQL (alert_log)
         |
         v
[Notification Dispatcher]
    ├── SMS Provider (Africa's Talking / Twilio)
    │     ├── Supervisor (all alerts)
    │     └── Manager (Alerts 2 & 8 only)
    └── Email (Brevo)
          ├── To: Supervisor
          ├── CC: Manager
          └── BCC: Catch-all address
         |
         v
[Audit Logger] → PostgreSQL (alert_log, alert_run_log)
```

### Core Modules

| Module | Responsibility |
|--------|---------------|
| `scheduler` | node-cron job, triggers hourly within 07:00–21:00 window |
| `config-reader` | Reads and validates Google Sheets config |
| `connector-registry` | Routes to correct connector by platform string |
| `bolt-connector` | Authenticates + queries Bolt Fleet API; normalises to standard format |
| `alert-engine` | Runs all 8 alert conditions per operator |
| `deduplication` | Queries and updates alert_log to suppress duplicates |
| `notifier` | Dispatches SMS (Africa's Talking/Twilio) and email (Brevo) |
| `logger` | Structured pino logging of every run and alert |

---

## 13. Database Schema

### `alert_log` table

```sql
CREATE TABLE alert_log (
  id              SERIAL PRIMARY KEY,
  operator_id     TEXT NOT NULL,          -- Platform driver UUID
  platform        TEXT NOT NULL,          -- 'bolt', 'uber', etc.
  alert_type      TEXT NOT NULL,          -- e.g. 'late_resumption', 'offline_excess_t1'
  alert_date      DATE NOT NULL,          -- Date in WAT
  episode_key     TEXT,                   -- For episode-keyed alerts (offline episode start ts)
  tier            INTEGER,                -- For tiered alerts (1, 2, 3)
  fired_at        TIMESTAMPTZ NOT NULL,
  sms_sent        BOOLEAN DEFAULT FALSE,
  email_sent      BOOLEAN DEFAULT FALSE,
  metadata        JSONB
);

CREATE UNIQUE INDEX alert_log_dedup_idx
  ON alert_log (operator_id, platform, alert_type, alert_date,
                COALESCE(episode_key, ''), COALESCE(tier, 0));
```

### `alert_run_log` table

```sql
CREATE TABLE alert_run_log (
  id               SERIAL PRIMARY KEY,
  run_at           TIMESTAMPTZ NOT NULL,
  operators_checked INTEGER,
  alerts_fired     INTEGER,
  errors           JSONB,
  duration_ms      INTEGER
);
```

---

## 14. Functional Requirements

**Scheduling:**
- Runs hourly: 07:00, 08:00, … 21:00 WAT
- Alert 3 (not seen) evaluated only from 11:00 run onward
- Alert 8 (vehicle return) evaluated only at the 20:00 run
- Alert 4 (currently offline) evaluated only during 08:30–19:00 WAT

**Resilience:**
- If the platform API fails for one operator, log the error and continue with others
- If Google Sheets is unreachable, abort the run and log — no config, no safe operation
- If SMS or email dispatch fails, retry once; log failure; do not block other notifications
- If a connector is unknown for a given platform string, log and skip that operator

**Idempotency:**
- Re-running the same hour (e.g. after a crash) must not send duplicate notifications — the `alert_log` unique index ensures this

**Pagination:**
- Platform API responses are typically paginated. Each connector must fetch all pages.

**Concurrent execution:**
- Operator checks within a single run may execute concurrently where API rate limits allow

---

## 15. Testing Approach

### 15.1 Strategy

The primary testing method is **historical replay testing** using real Bolt data from previous days. The Bolt Fleet API allows date-range queries, so we can run the alert engine against known historical dates and verify that the alerts it would have fired match what actually happened on those days.

### 15.2 Test Cases

For each of the 8 alert types, we will identify at least one historical date per alert where the condition was known to be true, and confirm the engine detects it correctly.

| Alert | How to verify historically |
|-------|--------------------------|
| 1 — Late Resumption | Run against a date where a specific operator's first state log is after 08:30 |
| 2 — Far from Office | Run against a date where first-online coordinates are far from office |
| 3 — Not Seen Today | Run against a date where an operator had zero state logs |
| 4 — Currently Offline | Check a date with known offline episodes during working hours |
| 5 — Excess Offline | Check a date with known high cumulative offline time |
| 6 — High Wait Ratio | Check a date with long waiting periods |
| 7 — Rejections | Check a date with known rejected/cancelled orders (confirmed visible in API) |
| 8 — Vehicle Return | Requires last state log position for the day vs office — check historical evening data |

### 15.3 Deduplication Testing

Run the same historical date through the engine **twice in sequence**. After the first run, the second run must fire zero alerts for conditions already logged in the first run.

### 15.4 Multi-tier Alert Testing

For Alerts 5 and 6, verify that:
- Only Tier 1 fires when the lower threshold is crossed
- Tier 2 fires (Tier 1 suppressed) when the second threshold is crossed
- Tier 3 fires (Tiers 1 & 2 suppressed) when the third threshold is crossed

### 15.5 Notification Testing

Use test phone numbers and a test email inbox during development to verify:
- SMS message format (character count, all required fields)
- Email digest format and CC/BCC routing
- Manager SMS fires only for Alerts 2 and 8

---

## 16. Non-Functional Requirements

**Security:**
- All credentials stored in Replit Secrets (env vars); never in code or logs
- Google Sheets access via OAuth (Replit integration)

**Reliability:**
- Exponential backoff on platform API errors (max 3 retries)
- Alert run log retained for 90 days

**Performance:**
- Full hourly run (all operators) completes within 2 minutes
- Platform API calls executed concurrently per operator

**Auditability:**
- Every dispatched alert stored in `alert_log` with full metadata
- Every run logged in `alert_run_log`

---

## 17. Credentials Required

| Secret Key | Source | Notes |
|-----------|--------|-------|
| `BOLT_CLIENT_ID` | Bolt Fleet Portal | Shared with Flexi Report Automate — transfer from that project |
| `BOLT_CLIENT_SECRET` | Bolt Fleet Portal | Shared with Flexi Report Automate — transfer from that project |
| `BOLT_COMPANY_ID` | Bolt Fleet Portal → Settings/API | Confirmed used in Flexi Report Automate; transfer value |
| `GOOGLE_SHEET_ID_ALERTS` | Google Sheets URL | ID of the alerts config sheet (separate from daily report sheet) |
| `GOOGLE_CATCHALL_EMAIL` | Agreed management address | BCC on all alert emails |
| `AT_API_KEY` | Africa's Talking dashboard | SMS dispatch (primary) |
| `AT_USERNAME` | Africa's Talking dashboard | SMS sender username |
| `TWILIO_ACCOUNT_SID` | Twilio console | SMS dispatch (fallback) |
| `TWILIO_AUTH_TOKEN` | Twilio console | SMS auth token |
| `TWILIO_FROM_NUMBER` | Twilio console | Verified sender number |
| `BREVO_API_KEY` | Brevo dashboard | Email dispatch |
| `BREVO_FROM_EMAIL` | Agreed sender address | e.g. `alerts@fleximotion.com` |

---

## 18. Deployment

**Environment:** Replit (same project as Flexi Report Automate / API Server)

**Execution:** The scheduler runs as a long-lived background process within the existing API Server. It initialises on server startup using `node-cron`.

No separate deployment is required.

---

## 19. Open Questions

| # | Question | Resolution |
|---|----------|-----------|
| OQ1 | Bolt `company_id` | Used in Flexi Report Automate project — needs to be transferred to this project's secrets |
| OQ2 | SMS provider | Africa's Talking preferred; Twilio as fallback. Both supported via abstracted SMS layer. |
| OQ3 | Manager CC scope | All emails CC manager; manager SMS only for Alerts 2 and 8. Catch-all email BCC on every alert. |
| OQ4 | Alert 4 window | Confirmed: fires only during 08:30–19:00 WAT |
| OQ5 | Operator exclusions | No in-file exclusion flag. Delete from config to stop monitoring. |
| OQ6 | GPS accuracy | Approximate GPS from Bolt confirmed acceptable |
| OQ7 | Alert 8 distance | Fixed at 10 km for Phase 1 |
| OQ8 | Africa's Talking sender ID | Branded sender ID (e.g. "FlexiFleet") vs numeric — needs to be registered with AT |
| OQ9 | Brevo from-name and from-email | To be confirmed (e.g. `FlexiFleet Alerts <alerts@fleximotion.com>`) |

---

## 20. Implementation Milestones

| Milestone | Description |
|-----------|-------------|
| M1 | Database schema, config reader (Google Sheets), project scaffolding |
| M2 | Bolt connector (state logs + orders) |
| M3 | Alert engine: Alerts 1–6 |
| M4 | Alert engine: Alerts 7–8 |
| M5 | Deduplication engine |
| M6 | Notification dispatcher (SMS + email) |
| M7 | Scheduler wiring + end-to-end run |
| M8 | Historical replay testing (all 8 alerts) |
| M9 | Credential handover + production deployment |

---

## 21. Acceptance Criteria

The system is accepted when:

1. Scheduler runs reliably every hour from 07:00–21:00 WAT without manual intervention
2. All 8 alert conditions are detected correctly against historical test scenarios
3. Deduplication prevents repeated alerts exactly as specified in Section 8
4. SMS messages are delivered to supervisor phones within 2 minutes of detection
5. Manager SMS fires only for Alerts 2 and 8; catch-all email is BCC'd on all emails
6. Email digests contain correct operator name, platform, and supervisor name in all alerts
7. Google Sheets config changes take effect on the next hourly run without restart
8. All alerts and run summaries are logged to the database
9. Adding a new platform connector requires no changes to the alert engine or notification layer
10. System runs 7 consecutive days without unhandled errors

---

## 22. External interfaces
An external HTTP call was necessary to wake the process hourly

Go to https://cron-job.org → sign up free → click Create cronjob
Title: Fleximotion Alert Trigger
URL: https://operator-monitoring-system.replit.app/api/alerts/run
(replace with your actual deployed URL — check the dashboard address bar)
Request method: POST
Schedule: Custom — set it to run every hour, every day (the server itself ignores calls outside 07:00–21:00 WAT automatically)
Save 

*Document prepared by Replit Agent on behalf of Fleximotion Operations*  
*v1.1 — 2026-03-24*
