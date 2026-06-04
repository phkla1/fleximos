Fleximotion Operator Monitoring System — As-Built Spec

Last updated: 24 May 2026 · Reflects merged state through Task #16

1. Purpose

Continuously monitor the on-duty behaviour of Bolt and Uber drivers operating under Fleximotion's fleet, detect operational issues within minutes of occurrence, and notify the right human (driver's supervisor, escalation manager) via SMS and/or email so the issue can be acted on the same day.

Secondary purpose: produce a daily audit trail of driver behaviour and notification activity for fleet management reporting.

2. Scope

In scope today:

Hourly automated monitoring 07:00–21:00 WAT
9 distinct alert types across Bolt and Uber driver populations
Tiered escalation (supervisor → manager) for slow-burn alerts
SMS (Twilio) and email (Brevo) dispatch with per-alert-type kill switches
Operations dashboard for live monitoring, drill-down, and SMS toggling
CarTracker reconciliation against platform GPS for coverage auditing
Out of scope:

Driver-facing app or notifications (system notifies internal staff only)
Live demand / surge guidance to drivers
Trip-level pricing or revenue reconciliation beyond the midday revenue alert
Web push or in-app notifications
3. Architecture

┌──────────────────────┐     ┌──────────────────────┐
│ Google Sheets (config│     │  External Cron       │
│  source of truth)    │     │ (cron-job.org, hourly)│
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           │                            ▼
           │              POST /api/alerts/run
           │                            │
┌──────────▼────────────────────────────▼──────────────────┐
│             artifacts/api-server (Express 5)             │
│  ┌────────────────┐  ┌────────────────────────────────┐  │
│  │ config-reader  │  │       alert-engine             │  │
│  │ (Sheets cache) │──▶│  - 9 alert evaluators         │  │
│  └────────────────┘  │  - tier escalation             │  │
│  ┌────────────────┐  │  - dedup via alert_log         │  │
│  │ bolt-connector │──▶│  - dispatch-mode safety gate  │  │
│  │ uber-connector │  └──────────────┬─────────────────┘  │
│  │ cartracker     │                 │                    │
│  └────────────────┘     ┌───────────▼──────────────┐     │
│                         │ notifier (Twilio + Brevo)│     │
│                         └──────────────────────────┘     │
└──────────────────────────┬───────────────────────────────┘
                           │
                  ┌────────▼─────────┐
                  │  PostgreSQL      │
                  │  (Drizzle ORM)   │
                  │  - alert_log     │
                  │  - alert_run_log │
                  │  - alert_sms_    │
                  │    settings      │
                  └──────────────────┘
┌────────────────────────────────────────┐
│  artifacts/dashboard (React + Vite)    │
│  - KPI tiles                            │
│  - Today's Alerts by Type (clickable)   │
│  - Drill-down modal (AlertDetailModal)  │
│  - SMS settings toggles                 │
│  - Tracker coverage                     │
│  - Recent runs                          │
└────────────────────────────────────────┘

4. Data sources

Source	Purpose	Auth	Key files
Google Sheets (GOOGLE_SHEET_ID_ALERTS)	Fleet config — operators, supervisors, managers, amoebas, metadata	Service account (GOOGLE_SERVICE_ACCOUNT_JSON)	config-reader.ts
Bolt Fleet API	Driver state logs, orders, driver list	OAuth2 client credentials (BOLT_CLIENT_ID/SECRET), company ID 168098	bolt-connector.ts
Uber Fleet API	Timeline, live location, transactions, daily quality reports	OAuth2 30-day token, UBER_ORG_ID (encrypted, for reports/actions) + UBER_ORG_UUID (plain UUID, for timeline/live-location)	uber-connector.ts
CarTracker	Secondary GPS for reconciliation against platform GPS	Email/password session (CARTRACKER_EMAIL/PASSWORD)	cartracker connector
Twilio	SMS dispatch	TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER	notifier.ts
Brevo	Email dispatch	BREVO_API_KEY, sender alerts@fleximotion.online	notifier.ts
Africa's Talking	Reserved (legacy SMS path, currently unused in alert engine)	AT_API_KEY/USERNAME	—
Google Sheet tabs (config schema)

Operators — one row per driver. Columns include: STATUS (only active is monitored), PLATFORM (bolt|uber), PLATFORM ID, supervisor reference, amoeba reference, daily revenue target.
Supervisors — name, phone, email, list of operators they own.
Managers — name, phone, email; receive tier-2+ escalations and the always-escalate alerts.
Amoebas (Offices) — name, GPS centroid, alertDistanceM (radius for "far from amoeba").
Metadata — global settings including catchallEmail for archive copies.
Config is read once per alert cycle and cached in-process for the duration of that cycle.

5. Alert catalog (the 9 alerts)

All alerts use Lagos local time (todayWAT() exported from alert-engine.ts). All write to alert_log with deduplication keyed on (operator_id, platform, alert_type, alert_date, episode_key, tier).

#	Alert type	Trigger	Tiers	Always notifies manager?	Episode key	Window
1	late_resumption	First online of the day after 08:30 WAT	0	No	—	Anytime after 08:30
2	far_from_amoeba	First GPS of the day farther than amoeba.alertDistanceM	0	Yes	—	First GPS event
3	not_seen_today	No online activity by 11:00 WAT	0	No	—	From 11:00
4	currently_offline	Driver inactive >15 min during 08:30–19:00 WAT	0	No	offline-period start timestamp	08:30–19:00
5	excess_offline	Total offline today >90 / >120 / >150 min	1 / 2 / 3	T2+ → manager	—	Whole day
6	high_wait_ratio	Wait time / online time >20% / >30% / >40%	1 / 2 / 3	T2+ → manager	—	Whole day
7	trip_rejection	Order in last hour with state driver_rejected / no_respond / cancel	0	No	order ID	Hourly window
8	vehicle_not_returned	At 20:00 WAT, live GPS >10km from assigned amoeba	0	Yes	—	20:00 only
9	below_target_midday	At 14:00 WAT, day's revenue <50% of daily target	0	No	—	14:00 only
Notes:

Tiers 1/2/3 on alerts 5 & 6 fire separately and dedup independently — a driver can receive a T1 in the morning and a T3 in the afternoon for the same metric without one suppressing the other.
Episode-keyed alerts (4 & 7) allow multiple alerts per day for distinct events without retriggering on the same event.
Manager escalation rule: alert config flag notifyManager: true (alerts 2, 8) OR alert tier ≥ 2.
6. Database schema

lib/db/src/schema/alerts.ts

alert_log — durable record of every alert fired.

id PK
operator_id text
platform text (bolt | uber)
alert_type text
alert_date date (Lagos-day aligned via todayWAT())
episode_key text nullable
tier int (0 for single-tier alerts; 1/2/3 for escalating)
fired_at timestamptz
sms_sent boolean
email_sent boolean
sms_skip_reason text nullable (e.g. disabled_by_toggle, no_phone, dispatch_suppressed)
metadata JSONB (alert-type-specific payload — offline minutes, wait ratio, GPS coords, order details, etc.)
Unique constraint: (operator_id, platform, alert_type, alert_date, episode_key, tier)
alert_run_log — one row per cycle execution.

id PK
run_at timestamptz
operators_checked int
alerts_fired int
errors JSONB (array of {operator, alert_type, error_message})
duration_ms int
alert_sms_settings — per-alert-type SMS kill switch.

alert_type text PK
sms_enabled boolean (default true)
updated_at timestamptz
7. API endpoints

All under /api/alerts in artifacts/api-server/src/routes/alerts.ts.

Method	Path	Purpose	Auth
POST	/api/alerts/run	Trigger a full alert cycle immediately (used by external cron and by the dashboard manual trigger)	None (internal)
GET	/api/alerts/status	System health, today's alert counts, recent runs (Lagos-day aligned)	None
GET	/api/alerts/today?alertType=X	Detail list of today's alerts; optional alertType filter; joined with operator name/amoeba from cached config; capped at 500 rows	None
GET	/api/alerts/config	Inspect the current cached config loaded from Google Sheets	None
GET	/api/alerts/sms-settings	List per-alert-type SMS toggle states	None
PUT	/api/alerts/sms-settings/:alertType	Toggle SMS on/off for a given alert type	None
GET	/api/alerts/coverage	CarTracker-vs-platform matching statistics	None
POST	/api/alerts/reconciliation/run	Manually trigger tracker reconciliation	None
GET	/api/alerts/bolt/company	Resolve / refresh the Bolt company ID	None
The API has no authentication today — it is reachable on the internal Replit domain. Hardening this is a known gap (see §13).

8. Notifications

Both channels go through notifier.ts. Dispatch is gated by dispatch-mode.ts, which enforces three modes:

live — actually sends. Only when NODE_ENV=production or ENABLE_ALERT_DISPATCH=1.
redirected — sends to a fixed test number/email instead of the real recipients. For staging.
suppressed (default in dev) — logs intent but sends nothing.
This is a deliberate safety gate so that running the engine in dev cannot spam real supervisors.

SMS (Twilio)

One SMS per recipient per alert (supervisor; optionally manager)
Per-alert-type kill switch via alert_sms_settings
Skip reasons stored on alert_log.sms_skip_reason for audit
Email (Brevo)

HTML body with alert detail
Sent to supervisor (always), manager (when escalation conditions met), and the catchallEmail from the Metadata tab for archive
Email is not toggled per alert type (always on when SMS is on or off)
9. Schedule and execution model

External cron (cron-job.org) calls POST /api/alerts/run hourly. The api-server itself does not own the cron.
The internal scheduler.ts runs a startup catch-up on boot if the current hour hasn't yet been covered today (production only).
Operating window: 07:00–21:00 WAT. Outside this window, the engine no-ops.
Alert-specific time gates inside the engine:
Alert 1: only after 08:30
Alert 3: only after 11:00
Alert 4: only 08:30–19:00
Alert 8: only at the 20:00 cycle
Alert 9: only at the 14:00 cycle
The Uber DRIVER_QUALITY report is rate-limited to one fetch per day; the engine fetches it once at the 07:00 cycle and caches it for 6h.
Uber live-location endpoint is only called at the 20:00 cycle (for Alert 8) to conserve quota.
10. Dashboard (artifacts/dashboard)

Single page (Dashboard.tsx) backed by TanStack Query. All visible UI:

KPI tiles: Today's Alerts, Cycles Run today, Last Run duration / status
Today's Alerts by Type: clickable pills, one per alert type, badge shows count. Empty state always rendered. Click opens AlertDetailModal.
AlertDetailModal: per-row details — operator name, amoeba, platform badge, tier badge (1=Supervisor / 2=Manager / 3=Escalation), SMS status with skip reason if any, JSONB metadata for that alert.
SMS Settings: one toggle per alert type, writes to alert_sms_settings.
Tracker Coverage: how many active operators match CarTracker records vs platform GPS.
Recent Runs: last N alert_run_log rows with error excerpts.
Manual trigger button: POST /api/alerts/run.
Dashboard has no authentication today.

11. Configuration model

Type	Lives in	Examples
Fleet structure	Google Sheets	operators, supervisors, managers, amoebas, daily revenue targets
Runtime toggles	Postgres (alert_sms_settings)	per-alert SMS on/off
Secrets	Replit env vars	Twilio, Brevo, Uber, Bolt, Google service account
Code-level constants	Source (alert-types.ts)	tier thresholds (90/120/150 min), wait-ratio brackets (20/30/40 %), 15-min offline grace, 10km vehicle-return radius
Dispatch safety	Env (NODE_ENV, ENABLE_ALERT_DISPATCH)	live / redirected / suppressed
Changing a tier threshold requires a code deploy. Changing fleet structure (new driver, new supervisor, new amoeba) is a sheet edit only — no deploy.

12. Timezone handling

All day-keyed logic uses Africa/Lagos (UTC+1, no DST) via todayWAT() exported from alert-engine.ts. This is the canonical helper — /api/alerts/today and /api/alerts/status both use it. Database alert_date is the Lagos calendar date at fire time, not the UTC date.

13. Known gaps / not-yet-built

These are present-state gaps, recorded honestly so the spec doesn't lie about coverage:

No auth on api-server or dashboard. Both are reachable by anyone who knows the URL.
BOLT_COMPANY_ID not yet captured as an env var — currently hardcoded as 168098 in source. Should move to env.
Uber Org UUID activation incomplete. UBER_ORG_UUID may not be set in production yet; until it is, Uber timeline and live-location endpoints don't work.
No historical reporting. Dashboard only shows "today". Yesterday / week / month views don't exist.
No driver-facing surface. Drivers are not notified of their own alerts.
No alert acknowledgement workflow. Supervisors can't mark an alert as resolved / acted upon from the dashboard.
Africa's Talking integration is configured but unused — secrets are present (AT_API_KEY/USERNAME) but no code path uses them.
/api/alerts/coverage and tracker reconciliation are partial — the data flow works but the dashboard surface for reconciliation discrepancies is minimal.
14. Repository layout (current)

artifacts/
  api-server/          # Express 5 + Drizzle; the alert engine lives here
    src/alerts/        # alert-engine.ts, alert-types.ts, dispatch-mode.ts,
                       # config-reader.ts, bolt-connector.ts, uber-connector.ts,
                       # notifier.ts, scheduler.ts, sms-settings.ts
    src/routes/        # alerts.ts and other route modules
  dashboard/           # React + Vite + TanStack Query + Radix Dialog
  mockup-sandbox/      # Component preview server (used for UI prototyping)
lib/
  db/                  # Drizzle schema (alerts.ts) + DB connection
  api-spec/            # OpenAPI 3.1 spec; orval codegen entry
  api-zod/             # Generated Zod schemas
  api-client-react/    # Generated React Query hooks
scripts/               # One-off TypeScript utilities