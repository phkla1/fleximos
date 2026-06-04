# Uber Connector — Design Specification

**For:** The party building the Fleximotion alert engine  
**Author:** Replit investigation (Fleximotion, April 2026)  
**Status:** Final — ready for implementation  
**Companion document:** `uber-alert-feasibility-report.md` (live API evidence)  
**System spec:** `Fleximotion_Rider_Alert_System_Spec_v1.1_*.md` (overall engine design)

---

## 1. Purpose

This document specifies exactly how to implement the `UberConnector` module so that the existing Fleximotion alert engine can monitor Uber drivers alongside Bolt drivers. It covers:

- Authentication and token management
- The two different org ID formats Uber requires
- Exact API calls with request/response shapes (live-confirmed)
- State machine: how to map Uber events → the standard `StateLogEntry[]` format
- Per-alert computation recipes (what to query, what to compute, edge cases)
- Error handling and rate limit guidance
- Environment variables required
- Implementation checklist

The connector must implement the `PlatformConnector` interface defined in the system spec (Section 10.2). The alert engine, deduplication logic, and notification layer need **no changes**.

---

## 2. Environment Variables

The following secrets must be present in the runtime environment before the connector runs. They already exist in the Fleximotion production environment.

| Variable | Format | Used by |
|----------|--------|---------|
| `UBER_CLIENT_ID` | String | OAuth token request |
| `UBER_CLIENT_SECRET` | String | OAuth token request |
| `UBER_ORG_ID_ENCRYPTED` | 132-char base64-like string | Legacy endpoints (drivers list, reports, transactions) |
| `UBER_ORG_UUID` | Standard UUID v4 | New endpoints (Timeline, Live Location) |

**Critical:** These two org ID variables must not be confused. Using the wrong format will produce `HTTP 400 "Invalid Organization Id"`. See Section 4 for the rule.

---

## 3. Authentication

### 3.1 Token Endpoint

```
POST https://auth.uber.com/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={UBER_CLIENT_ID}
&client_secret={UBER_CLIENT_SECRET}
&scope=solutions.suppliers.drivers.status.read supplier.driver.activity.read supplier.fleet.drivers.live_location.read solutions.suppliers.metrics.read solutions.suppliers.reports supplier.partner.payments vehicle_suppliers.organizations.read
```

### 3.2 Token Response

```json
{
  "access_token": "...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "solutions.suppliers.drivers.status.read supplier.driver.activity.read ..."
}
```

### 3.3 Caching Rule

Cache the token in memory. Refresh it when fewer than 60 seconds remain before expiry (i.e. at `expires_at - 60s`). All seven scopes were confirmed granted on the live Fleximotion Uber account.

### 3.4 Request Header

All API calls:
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

---

## 4. The Two Org ID Formats

Uber's Fleet API was built in two generations, and they use incompatible org ID formats:

| Format | Value shape | Variable | Endpoints that require it |
|--------|------------|----------|--------------------------|
| Encrypted | 132-character base64-like string | `UBER_ORG_ID_ENCRYPTED` | `/drivers/actions`, `/suppliers/{org}/reports/*`, `/transactions` |
| Plain UUID | Standard UUID v4 (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) | `UBER_ORG_UUID` | `/driver/timeline-info`, `/drivers/live-location` |

The plain UUID (`UBER_ORG_UUID`) is the fleet account's `driverUuid` as returned by the `/drivers/actions` endpoint — it is the UUID of the organisational account in Uber's driver UUID space.

**Rule:** Use `UBER_ORG_ID_ENCRYPTED` for all path parameters in URLs. Use `UBER_ORG_UUID` in the JSON body of Timeline and Live Location requests.

---

## 5. API Endpoints

### 5.1 Driver Status Snapshot — `/drivers/actions`

**Purpose:** Get the current online/offline status of every driver in the fleet, plus the timestamp of when they entered that status.

```
GET https://api.uber.com/v1/vehicle-suppliers/drivers/actions?org_id={UBER_ORG_ID_ENCRYPTED}
```

**Response shape (key fields):**
```json
{
  "driverStatusOverviews": [
    {
      "driverInfo": {
        "driverUuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "firstName": "...",
        "lastName": "..."
      },
      "onboardingStatus": "ONBOARDING_STATUS_ACTIVE",
      "statusEntries": [
        {
          "status": "DRIVER_STATUS_ONLINE",
          "timestamp": "2026-04-16T18:43:20.528Z"
        }
      ]
    }
  ]
}
```

**Notes:**
- Returns all 15 drivers (the full fleet) in one call — no pagination needed for fleets of this size
- `statusEntries` is an array but only the first entry (`[0]`) is the current status in practice
- `statusEntries` may be `null` for drivers who have never come online in the tracking window
- `DRIVER_STATUS_ONLINE` or `DRIVER_STATUS_OFFLINE` are the two status values observed live
- `timestamp` is ISO 8601 UTC

**Used by alerts:** 3 (quick not-seen check), 4 (current offline duration)

---

### 5.2 Driver Timeline — `/driver/timeline-info`

**Purpose:** Get the full chronological event history for a single driver for a given day. This is the primary data source for most alerts.

```
POST https://api.uber.com/v1/vehicle-suppliers/driver/timeline-info
```

**Request body:**
```json
{
  "org_id": "{UBER_ORG_UUID}",
  "driver_uuid": "{driver_uuid}",
  "start_time": "{unix_ms_start_of_day_WAT}",
  "end_time": "{unix_ms_end_of_day_WAT}"
}
```

- `start_time` and `end_time` are Unix timestamps in **milliseconds**
- For "today in WAT", `start_time` = midnight WAT as Unix ms, `end_time` = 23:59:59 WAT as Unix ms (or current time for real-time checks)

**Response shape:**
```json
{
  "driverUuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "eventsAndStatus": [
    {
      "event": "JOB_OFFERED",
      "status": "STATUS_ONLINE",
      "eventTime": "1776279600000",
      "location": {
        "latitude": 6.5,
        "longitude": 3.3
      }
    }
  ]
}
```

- `eventTime` is a string containing a Unix ms timestamp
- `location` is always present in live data for active drivers; may be null/absent for offline-only entries
- Returns 90–110 events per active driver per 24-hour window (confirmed live)

**Event types confirmed in live data:**

| Event | Status at that moment | Meaning |
|-------|-----------------------|---------|
| `JOB_OFFERED` | `STATUS_ONLINE` | Driver was offered a trip (in waiting state) |
| `JOB_ASSIGNED` | `STATUS_ENROUTE` | Driver accepted and heading to pickup |
| `PICKUP_ARRIVED` | `STATUS_ARRIVED` | Driver at pickup location |
| `PICKUP_COMPLETED` | `STATUS_ONTRIP` | Passenger on board |
| `JOB_COMPLETED` | `STATUS_DROPPED_OFF` | Trip finished |
| `SESSION_PAUSED` | `STATUS_OFFLINE` | Driver paused / went offline |
| `JOB_REJECTED` | `STATUS_ONLINE` | Driver declined a trip (API-documented; see Alert 7 note) |

**Status values:**

| Status | Standard state | Notes |
|--------|---------------|-------|
| `STATUS_ONLINE` | `waiting` | Available, no active order |
| `STATUS_ENROUTE` | `active` | Heading to pickup |
| `STATUS_ARRIVED` | `active` | At pickup |
| `STATUS_ONTRIP` | `active` | Passenger on board |
| `STATUS_DROPPED_OFF` | `active` | Just completed trip |
| `STATUS_OFFLINE` | `inactive` | Not active |
| `STATUS_UNASSIGNABLE` | `inactive` | Temporarily unavailable |

**Used by alerts:** 1, 2, 5, 6, 7 (heuristic), 8 (fallback)

---

### 5.3 Live Driver Location — `/drivers/live-location`

**Purpose:** Get the current GPS position of multiple drivers in a single batch call.

```
POST https://api.uber.com/v1/vehicle-suppliers/drivers/live-location
```

**Request body:**
```json
{
  "org_id": {
    "uuid": {
      "value": "{UBER_ORG_UUID}"
    }
  },
  "driver_ids": [
    { "value": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    { "value": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" }
  ]
}
```

Note: `org_id` has a nested structure here, different from the Timeline endpoint.

**Response shape:**
```json
{
  "driverLocations": [
    {
      "driverId": { "value": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      "driverStatus": "MONITORING_SUPPLY_STATUS_EN_ROUTE",
      "latitude": 6.5,
      "longitude": 3.3,
      "locationUpdatedTime": { "value": "1776366081529" }
    },
    {
      "driverId": { "value": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" },
      "driverStatus": "MONITORING_SUPPLY_STATUS_OFFLINE",
      "latitude": null,
      "longitude": null,
      "locationUpdatedTime": { "value": "1776364273155" }
    }
  ]
}
```

- `locationUpdatedTime.value` is a string Unix ms timestamp
- Offline drivers return `null` for lat/lng but still appear in the response
- Tested live with 14 drivers simultaneously — batch works
- `driverStatus` values observed: `MONITORING_SUPPLY_STATUS_OFFLINE`, `MONITORING_SUPPLY_STATUS_EN_ROUTE` (expected also: `MONITORING_SUPPLY_STATUS_ONLINE`, `MONITORING_SUPPLY_STATUS_ON_TRIP`)

**Used by alerts:** 8 (primary), 4 (supplementary location)

---

### 5.4 Driver Quality Reports — `/suppliers/{org}/reports`

**Purpose:** Daily CSV reports containing trip completion, rejection, and cancellation counts per driver.

**Step 1 — List available reports:**
```
GET https://api.uber.com/v1/vehicle-suppliers/suppliers/{UBER_ORG_ID_ENCRYPTED}/reports
  ?report_type=DRIVER_QUALITY
  &start_date=YYYY-MM-DD
  &end_date=YYYY-MM-DD
```

Response: Array of report objects, each with a `report_id` and `date`.

**Step 2 — Get download link:**
```
POST https://api.uber.com/v1/vehicle-suppliers/suppliers/{UBER_ORG_ID_ENCRYPTED}/reports/{report_id}/link
```

Response: `{ "url": "https://..." }` — a pre-signed S3 URL valid for a short window.

**Step 3 — Download and parse CSV:**
`GET {url}` — returns a CSV file.

**Confirmed CSV columns (relevant subset):**

| Column | Type | Notes |
|--------|------|-------|
| `Driver UUID` | string | Matches `driverUuid` from other endpoints |
| `Trips completed` | integer | Total completed trips |
| `Trips accepted` | integer | Accepted (may or may not complete) |
| `Trips rejected` | integer | Driver explicitly declined |
| `Trips cancelled` | integer | Driver cancelled after accepting |
| `Trips cancelled - Driver at fault` | integer | Subset of cancelled |
| `Confirmation rate` | decimal | Accept / offered |
| `Cancellation rate` | decimal | Cancelled / accepted |
| `Completion rate` | decimal | Completed / accepted |

**Notes:**
- Reports are generated once daily (typically available from early morning)
- 7 daily reports were found in the live test (one per day)
- For Alert 7: compare today's `Trips rejected + Trips cancelled` against yesterday's totals to get the day's incremental count

**Used by alerts:** 7 (daily summary version)

---

### 5.5 Transactions — `/transactions`

**Purpose:** Retrieve trip financial records for completed trips. Confirmed working in live tests — returns `driverInfo`, `transactionInfo.tripUuid`, `processedAt`, fare breakdown, and description per completed trip.

```
POST https://api.uber.com/v1/vehicle-suppliers/transactions
```

**Request body:**
```json
{
  "org_id": "{UBER_ORG_ID_ENCRYPTED}",
  "from_time": "{unix_ms}",
  "to_time": "{unix_ms}"
}
```

**Query window:** Each request covers a maximum of 15 minutes. To retrieve a full day's transactions, make multiple sequential calls (e.g. 96 × 15-minute windows). In practice, for alert purposes a single 15-minute window covering the last check interval is sufficient.

**What it returns:** Completed and paid trips only. A trip that was rejected or went unanswered does not produce a transaction record — those events appear in the Timeline (as `JOB_REJECTED`) and the DRIVER_QUALITY CSV (as cumulative counts).

**Alert 7 note:** For rejection detection, use the DRIVER_QUALITY CSV (daily counts) and the Timeline `JOB_REJECTED` event (hourly heuristic) as described in Section 6.3. The Transactions endpoint is the right source if the engine is ever extended to track earnings, completed-trip counts, or fare anomalies per driver.

**Used by alerts:** Not required for the current 8 alerts. Available for future financial or trip-volume features.

---

## 6. Connector Implementation

### 6.1 Interface to Implement

The connector must implement this interface (from the system spec, Section 10.2):

```typescript
interface PlatformConnector {
  platform: 'uber';

  getStateLogs(operatorId: string, dateWAT: string): Promise<StateLogEntry[]>;
  getOrders(operatorId: string, fromTs: number, toTs: number): Promise<OrderEntry[]>;
}
```

Where:
```typescript
interface StateLogEntry {
  timestamp: number;   // Unix UTC ms
  state: 'inactive' | 'waiting' | 'active';
  lat: number | null;
  lng: number | null;
}

interface OrderEntry {
  orderId: string;
  createdAt: number;   // Unix UTC ms
  status: OrderStatus;
  cancellationSide: 'driver' | 'client' | 'system' | null;
}
```

---

### 6.2 `getStateLogs()` — Implementation Recipe

**Input:** `operatorId` (Uber driver UUID), `dateWAT` (e.g. `"2026-04-16"`)

**Steps:**

1. Convert `dateWAT` to a UTC timestamp range:
   - `startTs` = midnight WAT (UTC+1) in Unix ms
   - `endTs` = 23:59:59.999 WAT in Unix ms (or `Date.now()` if today)

2. Call `POST /v1/vehicle-suppliers/driver/timeline-info`:
   ```json
   {
     "org_id": "{UBER_ORG_UUID}",
     "driver_uuid": "{operatorId}",
     "start_time": "{startTs}",
     "end_time": "{endTs}"
   }
   ```

3. Sort the returned `eventsAndStatus` array by `eventTime` ascending (they should already be ordered, but sort defensively).

4. Map each event to a `StateLogEntry`:
   ```
   STATUS_ONLINE        → state: 'waiting'
   STATUS_ENROUTE       → state: 'active'
   STATUS_ARRIVED       → state: 'active'
   STATUS_ONTRIP        → state: 'active'
   STATUS_DROPPED_OFF   → state: 'active'
   STATUS_OFFLINE       → state: 'inactive'
   STATUS_UNASSIGNABLE  → state: 'inactive'
   ```
   - `timestamp` = `parseInt(event.eventTime)`
   - `lat` = `event.location?.latitude ?? null`
   - `lng` = `event.location?.longitude ?? null`

5. Deduplicate consecutive identical states: if two adjacent entries have the same `state` value, keep only the first (the state transition already happened; a second event with the same state is an update, not a new transition).

6. Return the sorted, deduplicated `StateLogEntry[]`.

**Empty result:** If `eventsAndStatus` is empty or missing, the driver had no activity today. Return `[]`.

---

### 6.3 `getOrders()` — Implementation Recipe

**Input:** `operatorId`, `fromTs` (Unix ms), `toTs` (Unix ms)

**Alert 7 daily version (DRIVER_QUALITY CSV):**

1. Fetch today's and yesterday's DRIVER_QUALITY report for all drivers (see Section 5.4).
2. For the given `operatorId`, extract:
   - `Trips rejected` (today) − `Trips rejected` (yesterday) = new rejections
   - `Trips cancelled` (today) − `Trips cancelled` (yesterday) = new cancellations
3. For each rejection or cancellation delta, synthesize an `OrderEntry`:
   ```typescript
   {
     orderId: `daily-reject-{driverUuid}-{date}`,  // synthetic ID
     createdAt: toTs,  // approximate — exact per-order time unavailable
     status: 'driver_rejected',  // or 'driver_cancelled_after_accept'
     cancellationSide: 'driver'
   }
   ```
4. Return the synthesized array.

**Alert 7 heuristic version (Timeline, best-effort):**

As a supplementary signal (fire alongside the daily version if supported):

1. Fetch the Timeline for the driver for the window `fromTs` → `toTs`.
2. Scan for `JOB_REJECTED` events. Each one maps to:
   ```typescript
   {
     orderId: `timeline-reject-{eventTime}`,  // synthetic
     createdAt: parseInt(event.eventTime),
     status: 'driver_rejected',
     cancellationSide: 'driver'
   }
   ```
3. Also detect heuristic no-response: a `JOB_OFFERED` event followed by another `JOB_OFFERED` event with no `JOB_ASSIGNED` in between, and the gap is ≥ 30 seconds:
   ```typescript
   {
     orderId: `heuristic-noresponse-{eventTime}`,
     createdAt: parseInt(firstOffer.eventTime),
     status: 'driver_no_response',
     cancellationSide: 'driver'
   }
   ```
4. Return combined results.

**Note:** The daily CSV version fires once (morning run). The heuristic Timeline version can be called every hour but has lower confidence — see the Partial verdict in the feasibility report.

---

## 7. Per-Alert Computation Recipes

These recipes assume the alert engine has called `getStateLogs()` and received a `StateLogEntry[]`. The engine computes the following from that data:

---

### Alert 1 — Late Resumption

**Data needed:** `StateLogEntry[]` for today

**Logic:**
1. Find the first entry where `state !== 'inactive'` (i.e. first `waiting` or `active` entry).
2. Convert its `timestamp` from UTC to WAT (+1h).
3. Compare to 08:30 WAT.
4. If after 08:30 WAT → trigger alert.

**Dedup key:** `{operatorId}:late_resumption:{dateWAT}` — fires once per day.

**Alert payload:** First-online time (WAT), delta from 08:30, lat/lng of that entry.

---

### Alert 2 — Resumed Far from Office

**Data needed:** First non-inactive `StateLogEntry` (from Alert 1 logic above)

**Logic:**
1. Take `lat` and `lng` from the first non-inactive entry.
2. If `lat` or `lng` is null → skip (cannot check; do not alert).
3. Apply Haversine formula against the operator's assigned office `lat`/`lng`.
4. If distance > `office.alert_distance_m` (default 500 m) → trigger alert.

**Haversine (reference):**
```
R = 6371000  // Earth radius in metres
φ1, φ2 = lat1, lat2 in radians
Δφ = (lat2 - lat1) in radians
Δλ = (lng2 - lng1) in radians
a = sin²(Δφ/2) + cos(φ1)·cos(φ2)·sin²(Δλ/2)
d = 2R·arcsin(√a)
```

**Dedup key:** `{operatorId}:far_resumption:{dateWAT}` — fires once per day.

**Alert payload:** First-online coords, office name, computed distance (m), threshold (m).

**SMS also to manager:** Yes.

---

### Alert 3 — Operator Not Seen Today

**Data needed:** `StateLogEntry[]` for today

**Logic:**
1. Only evaluate from the 11:00 WAT run onward.
2. Check whether any entry has `state !== 'inactive'`.
3. If none found → trigger alert.

**Dedup key:** `{operatorId}:not_seen:{dateWAT}` — fires once per day.

**Optimisation:** Can pre-screen using `/drivers/actions`. If `statusEntries` is null or the driver has never been `DRIVER_STATUS_ONLINE` today, skip the Timeline call and flag immediately.

---

### Alert 4 — Operator Currently Offline Mid-Day

**Data needed:** `StateLogEntry[]` for today, current time

**Logic:**
1. Only evaluate between 08:30 WAT and 19:00 WAT.
2. Find the last entry in the log (most recent state).
3. If `state === 'inactive'`:
   - Episode start time = `last_entry.timestamp`
   - Episode duration = `now - episode_start`
   - If duration > 15 minutes (900,000 ms) → trigger alert
4. Episode key = episode start timestamp (ISO string or unix ms).

**Dedup key:** `{operatorId}:offline_episode:{episodeStartTimestamp}` — fires once per offline episode.

**Alert payload:** Offline start time (WAT), duration so far.

**Optimisation:** `/drivers/actions` gives the current status and timestamp cheaply. Use it as the first check; only fetch Timeline if you need episode history or deduplication clarity.

---

### Alert 5 — Excess Total Offline Time Today

**Data needed:** `StateLogEntry[]` for today

**Logic:**
1. Find the first non-inactive entry (start of working day). If none, offline time = 0.
2. Iterate the state log from that entry onward.
3. For each consecutive pair of entries where the first is `inactive`:
   - Gap = `next_entry.timestamp - inactive_entry.timestamp`
   - Accumulate into `totalOfflineMs`
4. If the last entry is `inactive`, add `now - last_entry.timestamp` to `totalOfflineMs`.
5. Convert to minutes. Compare against tiers: 90, 120, 150.

**Dedup keys (one per tier):**
- `{operatorId}:excess_offline_t1:{dateWAT}`
- `{operatorId}:excess_offline_t2:{dateWAT}`
- `{operatorId}:excess_offline_t3:{dateWAT}`

Each fires once per day when its threshold is first crossed.

**Alert payload:** Total offline minutes, tier reached, breakdown by episode (optional — include if extractable from the log).

---

### Alert 6 — High Wait-Time Ratio

**Data needed:** `StateLogEntry[]` for today

**Logic:**
1. Find the first non-inactive entry (start of working day).
2. Iterate from that entry onward. Accumulate two totals:
   - `waitMs`: time spent in `waiting` state
   - `onlineMs`: total time in any non-inactive state (including `waiting`)
3. For each consecutive pair: `duration = next.timestamp - current.timestamp`. Add to the correct bucket based on `current.state`.
4. If `current` is the last entry, use `now - current.timestamp` as duration.
5. `waitRatio = waitMs / onlineMs`
6. Compare against tiers: 0.20, 0.30, 0.40

**Dedup keys (one per tier):**
- `{operatorId}:wait_ratio_t1:{dateWAT}`
- `{operatorId}:wait_ratio_t2:{dateWAT}`
- `{operatorId}:wait_ratio_t3:{dateWAT}`

**Alert payload:** Wait ratio (%), absolute wait time (minutes), total online time (minutes).

---

### Alert 7 — Trip Rejections / Cancellations

**Feasibility:** Partial (daily CSV confirmed; real-time unconfirmed). See full analysis in `uber-alert-feasibility-report.md`.

**Recommended implementation: daily morning version**

1. Run only on the first hourly check each day (e.g. 07:00 WAT run, after yesterday's CSV is available).
2. Download today's DRIVER_QUALITY CSV and yesterday's (or use the most recent available if today's isn't yet generated).
3. For each driver: `delta_rejected = today.Trips_rejected - yesterday.Trips_rejected`
4. If `delta_rejected > 0` and not already alerted today → trigger.

**Supplementary: heuristic real-time version**

1. Each hourly run: scan the Timeline for `JOB_REJECTED` events in the past hour.
2. Scan for double-`JOB_OFFERED` patterns (no-response proxy) in the past hour.
3. If found and not already alerted → trigger.

**Dedup key:** `{operatorId}:rejection:{dateWAT}:{hourWAT}` — fires per hour that has new events (not suppressed between hours).

**Alert payload:** Count of rejections, count of no-responses, count of cancellations (by type), time range covered.

---

### Alert 8 — Vehicle Not Returned to Office

**Data needed:** Live Location at 20:00 WAT run

**Logic:**
1. Only evaluate at the 20:00 WAT run.
2. Call `POST /v1/vehicle-suppliers/drivers/live-location` for all Uber drivers.
3. For each driver: if `latitude` is non-null, use that position. If null (offline), fall back to the last `lat`/`lng` from their Timeline log for today.
4. Apply Haversine against the operator's assigned office coordinates.
5. If distance > 10,000 m → trigger alert.

**Dedup key:** `{operatorId}:vehicle_not_returned:{dateWAT}` — fires once per day.

**Alert payload:** Last known coordinates, office name, distance (km), timestamp of last known position.

**SMS also to manager:** Yes.

---

## 8. Hourly Run Plan

This is the recommended sequence of API calls per hourly run for the Uber connector, designed to minimise total API requests while satisfying all 8 alerts.

```
Step 1 — Fleet status snapshot (one call, all drivers)
  GET /v1/vehicle-suppliers/drivers/actions
  → Use for: Alert 3 (pre-screen), Alert 4 (current status + episode start)
  → Produces: currentStatus[driverUuid] map

Step 2 — Timeline calls (one call per driver, run in parallel)
  POST /v1/vehicle-suppliers/driver/timeline-info
  Body: { org_id: UBER_ORG_UUID, driver_uuid, start_time: midnightWAT, end_time: now }
  → Use for: Alert 1 (first online time), Alert 2 (first online GPS),
             Alert 3 (confirm no events), Alert 5 (offline total),
             Alert 6 (wait ratio), Alert 7 (heuristic rejections)
  → Produces: stateLogs[driverUuid] map

Step 3 — Live Location batch (one call, all drivers — 20:00 run only)
  POST /v1/vehicle-suppliers/drivers/live-location
  → Use for: Alert 8 (last known GPS)
  → Skip on all other hourly runs

Step 4 — Driver Quality CSV (morning run only, e.g. 07:00 WAT)
  GET /suppliers/{org}/reports?report_type=DRIVER_QUALITY
  POST /suppliers/{org}/reports/{id}/link → download CSV
  → Use for: Alert 7 (daily rejection delta)
  → Skip on all hourly runs except the first of the day
```

**Estimated API calls per hourly run (15-driver fleet):**
- Normal run: 1 (status) + 15 (timelines) = **16 calls**
- 20:00 run: 1 + 15 + 1 (live location) = **17 calls**
- 07:00 run: 1 + 15 + 2 (reports list + link) + 1 CSV download = **19 calls**

---

## 9. Error Handling

| Error | Likely cause | Action |
|-------|-------------|--------|
| `HTTP 401` on any call | Token expired | Re-fetch token and retry once |
| `HTTP 400 "Invalid Organization Id"` | Wrong org ID format | Check which endpoint is being called and which variable is being used (see Section 4) |
| `HTTP 404` on Timeline | Driver not in org | Log and skip driver for this run |
| `HTTP 429` | Rate limit | Retry with exponential backoff (start at 5s); Uber has not published rate limits but was not rate-limited in testing |
| Timeline returns `eventsAndStatus: []` | Driver not online today | Treat as zero activity; proceed to Alert 3 evaluation |
| Live Location returns `latitude: null` | Driver offline | Fall back to last Timeline event GPS |
| DRIVER_QUALITY CSV not yet available | Report generation delay | Retry on the 08:00 WAT run; do not suppress the daily alert indefinitely |

---

## 10. Config Requirements

The following must be present in the Operators sheet (Google Sheets config) for Uber operators:

| Column | Value for Uber drivers |
|--------|----------------------|
| `operator_id` | Uber driver UUID (the `driverUuid` from `/drivers/actions`) |
| `platform` | `uber` |
| `supervisor_id` | As normal |
| `office_id` | As normal |

The Uber driver UUIDs can be obtained by running the existing `uber-confirm-all-alerts.ts` script which calls `/drivers/actions` and lists all 15 drivers' UUIDs.

---

## 11. API Behaviour Notes

These are known characteristics of Uber's Fleet API that the builder should understand in order to implement correctly. Each point includes the recommended approach.

**Rejection data is split across two sources by granularity.**
The DRIVER_QUALITY CSV provides reliable daily counts (`Trips rejected`, `Trips cancelled`) per driver. The Timeline endpoint provides per-event `JOB_REJECTED` records in real time. For Alert 7, use both: the CSV for the morning daily-count version, and the Timeline scan for the hourly heuristic version. See Section 6.3 for the exact recipes.

**Trip-level financial data uses 15-minute query windows.**
The Transactions endpoint returns confirmed trip financial records but is queried in up to 15-minute windows per call. To cover an hourly run, one 15-minute window is sufficient for recent activity. For a full-day financial summary, chain 96 consecutive windows. Rejected or unanswered trips do not produce transaction records — they appear only in the Timeline and the DRIVER_QUALITY CSV.

**Per-trip order IDs are available for completed trips; not for rejections.**
`transactionInfo.tripUuid` in the Transactions response gives a unique ID per completed trip. Rejected trips do not have an equivalent persistent ID in the API — the DRIVER_QUALITY CSV reports their count only. If per-rejection audit trails are needed in future, the Timeline `JOB_REJECTED` event timestamp can serve as a proxy identifier.

**GPS is delivered via polled snapshots, not a stream.**
Both the Live Location endpoint (batch, current position) and the Timeline endpoint (GPS at each event) provide GPS data on demand. The connector polls these on the hourly schedule. For Alert 8 (vehicle return), the Live Location batch call at 20:00 is sufficient. For all other GPS needs (Alerts 1, 2, and the Timeline-based fallback for Alert 8), Timeline event coordinates are used.

**All data is pull-based — there are no push webhooks.**
The Uber Fleet API is a polling API. The connector is responsible for calling each endpoint on the hourly schedule. No inbound webhook infrastructure is needed.

---

## 12. Implementation Checklist

- [ ] Create `uber-connector.ts` (or equivalent in project structure)
- [ ] Implement `getToken()` with in-memory caching and auto-refresh
- [ ] Implement `getStateLogs(operatorId, dateWAT)` using Timeline endpoint
- [ ] Implement `getOrders(operatorId, fromTs, toTs)` using DRIVER_QUALITY CSV + heuristic Timeline scan
- [ ] Implement `getFleetStatus()` helper using `/drivers/actions` (for Alert 3/4 optimisation)
- [ ] Implement `getLiveLocations(driverUuids[])` helper using Live Location batch endpoint (for Alert 8)
- [ ] Register `UberConnector` in the connector registry keyed by `'uber'`
- [ ] Add the `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_ORG_ID_ENCRYPTED`, `UBER_ORG_UUID` secrets to the production environment
- [ ] Populate the Operators sheet with Uber driver UUIDs and `platform: 'uber'`
- [ ] Test Alert 3/4/8 optimisation paths (skip Timeline when quick check suffices)
- [ ] Test empty Timeline response (driver never came online)
- [ ] Test DRIVER_QUALITY CSV download and delta calculation for Alert 7
- [ ] Confirm `JOB_REJECTED` events appear for a driver with a known poor acceptance rate (to validate Alert 7 heuristic)

---

## 13. Key Reference Files

| File | Contents |
|------|----------|
| `scripts/src/uber-alert-feasibility-report.md` | Live API evidence, endpoint confirmations, per-alert verdicts |
| `scripts/src/uber-confirm-all-alerts.ts` | Canonical test script demonstrating all live API calls |
| `attached_assets/Fleximotion_Rider_Alert_System_Spec_v1.1_*.md` | Full system PRD including connector interface, deduplication rules, notification specs |
| `attached_assets/UBER-API-REFERENCE_*.md` | Full Uber API reference as provided |
