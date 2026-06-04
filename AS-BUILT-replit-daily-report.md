Flexi Report Automate — As-Built Specification

Document version: 1.0 Last updated: 2026-05-19 System name: Fleet Performance Reporting Automation Deployment URL: https://flexi-report-automate.replit.app Source repo: this Replit project (Mastra automation stack)

1. Purpose

A headless, time-based automation that runs every day at 01:00 UTC (02:00 GMT+1), pulls driver-level performance data from Bolt Fleet and two Uber Fleet organizations, normalizes it, and writes it into a single Google Sheet that fleet supervisors use to track operations, payouts, and amoeba-level P&L.

The system has no UI of its own. Supervisors interact with it through:

The Google Sheet (read + supervisor-added columns like Notes, Expected cash).
A small tsx script (tests/triggerProductionBackfill.ts) for re-running specific historical dates against the live deployment.
2. High-level architecture

                         ┌────────────────────────────┐
   01:00 UTC daily ─────►│  In-process setTimeout     │
                         │  scheduler (Reserved VM)   │
                         └──────────────┬─────────────┘
                                        │  POST /api/workflows/.../start-async
                                        ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  Mastra workflow: bolt-fleet-daily-report (6 sequential steps)    │
   │   1. determine-date-range                                         │
   │   2. authenticate-and-get-company   (Bolt OAuth)                  │
   │   3. fetch-orders-and-aggregate     (Bolt orders + state logs)    │
   │   4. fetch-uber-data                (Uber acct 1 + acct 2)        │
   │   5. write-to-sheets                ("Rider Daily Data" tab)      │
   │   6. write-rider-info-and-amoeba    ("Rider_info" + "Amoeba…")    │
   └──────────────┬───────────────────────────────┬────────────────────┘
                  │                               │
                  ▼                               ▼
   ┌─────────────────────────┐       ┌────────────────────────────────┐
   │  Run log (Postgres via  │       │  Google Sheet (3 tabs)         │
   │  Mastra storage)        │       │   - Rider Daily Data           │
   │  - status, dateRange    │       │   - Rider_info                 │
   │  - alerts[] (dedup keys)│       │   - Amoeba_Daily_Summary       │
   └────────┬────────────────┘       └────────────────────────────────┘
            │
            ▼
   ┌─────────────────────────┐
   │  Alert webhook (optional)│
   │  Slack / Discord / JSON  │
   │  Triggered by:           │
   │   - markRunFailed()      │
   │   - watchdog (T+10 min)  │
   └─────────────────────────┘

Triggers (in priority order):

Headless backfill — POST /api/workflows/bolt-fleet-daily-report/start-async with {"inputData":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}} and Authorization: Bearer $BACKFILL_AUTH_TOKEN.
Local-dev backfill — RUN_START_DATE / RUN_END_DATE env vars + Playground trigger.
Daily cron — no inputs; defaults to yesterday's date.
No public HTTP surface beyond standard Mastra endpoints. Inngest cron registration is dev-only; production uses an in-process setTimeout to call the local workflow endpoint.

3. External integrations

System	Purpose	Auth	Notes
Bolt Fleet API	Companies, orders, driver state logs	OAuth 2.0 client credentials	BOLT_CLIENT_ID, BOLT_CLIENT_SECRET. Single company (id 168098).
Uber Fleet API — Acct 1	Drivers, timeline, transactions, DRIVER_QUALITY CSV	OAuth 2.0	UBER_CLIENT_ID_1, UBER_CLIENT_SECRET_1, UBER_ORG_ID_ENCRYPTED_1. Main Car fleet. Currently missing in env — see §10.
Uber Fleet API — Acct 2	Drivers, timeline, DRIVER_QUALITY CSV (no transactions endpoint)	OAuth 2.0	UBER_CLIENT_ID_2, UBER_CLIENT_SECRET_2, UBER_ORG_ID_ENCRYPTED_2, UBER_ORG_UUID_2. FleximotionCourier FleetOne, motorbike-only.
Google Sheets API	Read + write the 3-tab spreadsheet	Service account JSON	GOOGLE_SERVICE_ACCOUNT_JSON. Sheet ID: 1BkjJbQu3cb2T9l0umiu9ZVSg4oD4yAiiJEiz1c6qDmM.
PostgreSQL (Replit-managed)	Mastra storage (workflow runs, run log, alerts)	DATABASE_URL	Provisioned via Replit.
Alert webhook (optional)	Out-of-band failure / missed-run notification	None	ALERT_WEBHOOK_URL or SLACK_WEBHOOK_URL. JSON POST compatible with Slack, Discord, custom.
Quirks discovered and handled:

Uber Acct 2's /transactions endpoint returns 404 (plan-tier limitation). Revenue for those rows falls back to the analytics TotalEarnings field; per-trip cash/card split is not available.
Uber Acct 2's DRIVER_QUALITY CSV 500s intermittently. Driver rows are still written using approximate acceptance/completion rates derived from timeline data; the run does not fail.
Bolt's /orders and /state-logs are fetched in parallel within step 3 to reduce wall-clock time.
4. The Google Sheet (data contract)

Spreadsheet: 1BkjJbQu3cb2T9l0umiu9ZVSg4oD4yAiiJEiz1c6qDmM — "Fleet Performance Reporting".

Tab 1: Rider Daily Data

One row per (date, driver, platform, vehicle type).

Col	Header	Source	Notes
A	Date	Step 1	YYYY-MM-DD
B	Driver Name	Bolt drivers / Uber drivers	
C	Phone	Bolt only	Uber phone usually blank
D	License Plate	Bolt only	Uber plate usually blank
E	Total Trips	Both	
F	Completed	Both	
G	Cancelled	Both	
H	No Response	Bolt direct / Uber heuristic	
I	Ride Revenue	Both	
J	Net Earnings	Both	
K	Booking Fees	Both	
L	Cash Trips	Both	Uber acct 2 always 0 (no /transactions)
M	Card Trips	Both	Uber acct 2 always 0
N	Acceptance %	Both	Uber from DRIVER_QUALITY CSV
O	Cancellation %	Both	
P	Completion %	Both	
Q	Hours Worked	Bolt state logs / Uber timeline state machine	
R	Cash Remitted	Supervisor-entered	Preserved on re-runs
S	Overage/Shortage	Formula =I{row}-R{row}	
T	Notes	Supervisor-entered	Preserved on re-runs
U	Platform	Workflow	"Bolt" or "Uber"
V	Vehicle Type	Workflow	"Motorbike" or "Car" (see §5)
W	Expected cash	Supervisor-entered	Preserved on re-runs
X	Actual cash	Supervisor-entered	Preserved on re-runs
Y	shortage/overage	Supervisor-entered	Preserved on re-runs
Z	monie point acc	Supervisor-entered	Preserved on re-runs
Re-run behaviour: Re-running for a date that already exists in the sheet replaces those rows in place. Supervisor-added columns (R, T, W–Z, and any future columns added by the operator) are preserved by matching the freshly-fetched row to the existing row using the key defined in §6.

Tab 2: Rider_info

Columns: Rider Name, Phone, Amoeba, Notes.

New drivers discovered in a run are appended automatically with Amoeba = "" (user assigns later).
This tab is the source of truth for the Driver → Amoeba mapping consumed by tab 3.
The workflow never overwrites existing rows here — only appends.
Tab 3: Amoeba_Daily_Summary

One row per (date, amoeba). Aggregated metrics across all drivers in that amoeba for that date: Date, Amoeba, Active Riders, Total Trips, Completed, Cancelled, Total Ride Revenue, Total Net Earnings, Total Hours Worked, Expected Hours, Efficiency, Total Cash Remitted, Total Overage/Shortage, Avg Acceptance %, Avg Completion %, Total Expense, Profit/Loss, Hourly P/L.

5. Business rules

Vehicle Type rule (until further notice)

Source	Platform	Vehicle Type
Bolt operators (all)	Bolt	Motorbike
Uber Acct 1	Uber	Car
Uber Acct 2 (FleximotionCourier)	Uber	Motorbike
No per-driver overrides. If this ever changes:

Update the Bolt enrichment default in src/mastra/workflows/workflow.ts (search for vehicleType: 'Motorbike').
Update the platform-aware fallback in the write-to-sheets step (search for the comment "Platform-aware default").
Update driverRowKey in src/mastra/workflows/workflow.ts — it currently force-normalizes Bolt to Motorbike so legacy Bolt+Car rows still match.
Run a historical correction with a script modelled on tests/backfillBoltMotorbike.ts.
Update replit.md User Preferences and the row-matching test (tests/driverRowKey.test.ts).
Date-range resolution (step 1)

The determine-date-range step resolves the target window from three sources, in this order, validating each:

inputData.startDate / inputData.endDate (production headless backfill).
RUN_START_DATE / RUN_END_DATE env vars (local-dev backfill).
Yesterday (default daily-cron behaviour).
Validation aborts the run before any external call if format is bad, the calendar date is invalid, endDate < startDate, or endDate is set without startDate. Locked in by tests/dateRange.test.ts (12 cases).

Row-matching rule for re-runs

Key: (driverName.lower(), platform.lower(), vehicleType.lower()). Normalization for legacy / blank values:

Blank Platform → Bolt.
For Bolt rows: vehicleType is always forced to Motorbike, regardless of the stored value. This ensures a fresh Bolt+Motorbike row matches both blank-Platform legacy rows AND any pre-backfill Bolt+Car row.
For Uber rows: blank vehicleType → Car. Uber+Car and Uber+Motorbike for the same human name stay distinct (FleximotionCourier may share a driver name with Acct 1).
Locked in by tests/driverRowKey.test.ts (9 cases). Exported as driverRowKey from src/mastra/workflows/workflow.ts so the test cannot drift from production.

6. Workflow steps (in detail)

All steps are defined in src/mastra/workflows/workflow.ts and registered through src/mastra/index.ts.

Step 1 — determine-date-range (lines 121–231)

Pure input validation; no external calls.
Output: { startDate, endDate, dateLabel, isCustomRange }.
Step 2 — authenticate-and-get-company (lines 232–284)

OAuth client_credentials exchange with Bolt.
Fetches the Bolt company list and picks company 168098.
On error: markRunFailed() → fires failure alert.
Step 3 — fetch-orders-and-aggregate (lines 285–441)

Parallel fetch of Bolt /orders and /state-logs for the date window.
Aggregates per-driver: total/completed/cancelled/no-response trips, ride revenue, net earnings, booking fees, cash vs card trip counts, acceptance/cancellation/completion %, hours worked (derived from state log online/offline transitions).
Output row default: platform: 'Bolt', vehicleType: 'Motorbike'.
On error: markRunFailed().
Step 4 — fetch-uber-data (lines 442–525)

Iterates Uber Acct 1 and Acct 2 (skips gracefully if credentials missing).
Per account: drivers list → for each driver: timeline (state machine → hours worked, trip counts), /transactions (acct 1 only — cash/card split), DRIVER_QUALITY CSV (acceptance/completion %).
Output row tags: platform: 'Uber', vehicleType: 'Car' (acct 1) or 'Motorbike' (acct 2).
Step 5 — write-to-sheets (lines 526–786)

Merges Bolt + Uber rows into a single list.
Reads existing rows for the target date(s) from the sheet.
For each fresh row, looks up the corresponding existing row using driverRowKey (§5) and preserves all supervisor-added columns by building each output row from a merged header set (buildRowFromMergedHeaders).
Writes via values.update (full row replacement for the date window only). Untouched dates are left exactly as they were.
On error: markRunFailed().
Step 6 — write-rider-info-and-amoeba-summary (lines 787–1015)

Seeds new drivers into Rider_info (never overwrites existing rows).
Reads the Driver → Amoeba mapping back from Rider_info.
Aggregates the day's Rider Daily Data rows by Amoeba and writes them to Amoeba_Daily_Summary.
7. Scheduler (production)

Defined in src/mastra/index.ts via startProductionScheduler().

Algorithm: in-process setTimeout chain. On startup, computes the next 01:00 UTC fire, sets a timer; on fire, POSTs to the local /api/workflows/bolt-fleet-daily-report/start-async with no inputData, then schedules the next 24h timer.
Per-fire internal header: the scheduler stamps each request with a per-process internal header so it always passes the production auth check, even when BACKFILL_AUTH_TOKEN is set.
Schedule string: hardcoded "0 1 * * *" in src/mastra/index.ts. Not env-driven. To change it, edit the string and redeploy.
Optional opt-in catch-up at deploy time: gated behind ENABLE_CRON_CATCHUP=true (off by default).
Required deployment type

⚠️ The deployment MUST be vm (Reserved VM), not autoscale / cloudrun. Autoscale sends SIGTERM to idle processes, which kills the in-process timer and causes the daily fire to be silently missed. This actually happened on 2026-04-29.

Current state of .replit shows deploymentTarget = "cloudrun" — this is inconsistent with the documented requirement and should be reviewed. (See §10.)
8. Failure & missed-run alerting

Implementation: src/mastra/tools/alerts.ts + src/mastra/tools/runLog.ts + watchdog in startProductionScheduler.

Alert types

Kind	Trigger	Fired by
failure (workflow-side)	markRunFailed() called from steps 2/3/5 catch-blocks	Workflow
failure (scheduler-side)	HTTP non-OK or fetch throw when POSTing the trigger	Scheduler tick
missed	No run for the scheduled target date was attempted within the watchdog window	Watchdog
stuck	A run for the target date is still status=running at watchdog time	Watchdog
Watchdog

Runs SCHEDULER_WATCHDOG_DELAY_MS (default 10 minutes) after each scheduled fire.
Keys off dateRange set by markRunStarted(targetDate) — so a manual same-day backfill for a different date will NOT mask a true missed scheduled run.
Startup-time safety net handles all three boot cases: (a) before scheduled fire — relies on next timer, (b) in the gap between fire and deadline — schedules watchdog for the remaining time, (c) after the deadline — fires the check immediately.
Dedup

Keyed by (targetDate, kind), stored in the run-log's alerts[] array.
An alert is marked deduped only after at least one channel delivered. If a configured webhook fails, the alert stays un-marked so the next watchdog tick or process restart can retry.
With no webhook configured, the Mastra logger counts as a successful channel.
Configuration

ALERT_WEBHOOK_URL (or SLACK_WEBHOOK_URL) — generic JSON POST. Supports Slack (text), Discord (content), custom. Strongly recommended in production.
SCHEDULER_WATCHDOG_DELAY_MS — override 10-minute default.
Operator copy-paste guidance

Every alert message includes the target date and a single line telling the operator how to recover: set RUN_START_DATE (and optionally RUN_END_DATE), restart Mastra, trigger from Playground. For production, the same effect is achieved via tests/triggerProductionBackfill.ts.

9. Operational runbooks

A. Run a production backfill (no redeploy)

npx tsx tests/triggerProductionBackfill.ts \
  --url   https://flexi-report-automate.replit.app \
  --token "$BACKFILL_AUTH_TOKEN" \
  --start 2026-05-12 \
  [--end  2026-05-16]

Watch deployment logs for 📅 [DateRange] Using custom backfill date range from inputData: … to confirm.

B. Rotate the production backfill token

Generate: openssl rand -hex 32.
Set the BACKFILL_AUTH_TOKEN deployment secret to the new value.
Republish so the new value takes effect.
Old token is rejected immediately after redeploy.
C. Local-dev backfill

Set RUN_START_DATE (and optionally RUN_END_DATE) in .env.
Restart Mastra dev server.
Trigger workflow from Playground.
Unset / restart afterwards.
D. Recover a missed daily run

Same as A — the workflow doesn't care whether it was triggered by cron or manually; the date range argument fully determines what gets processed.

E. Repair the sheet after a data-loss incident

Two one-shot scripts exist as templates:

tests/backfillBoltMotorbike.ts — corrects a single column (Vehicle Type) across all matching rows via values.batchUpdate. Idempotent.
tests/restoreNotesMay12_16.ts — restores a single column (Notes) from an old xlsx export by matching on (Date, Driver Name). Idempotent; prints unmatched drivers without writing them.
Both follow the same pattern: read the live sheet, plan a column-scoped write, dry-run first, then --apply.

F. Run the test suite

npx tsx tests/dateRange.test.ts       # 12 cases, date-range validation
npx tsx tests/driverRowKey.test.ts    # 9 cases, row-matching rule

Both exit non-zero on regression. They import the real exported functions from src/mastra/workflows/workflow.ts and cannot drift from production.

10. Known issues and follow-up tasks

Tracked in project tasks

Show Uber trip breakdown even when quality report is unavailable — currently Uber Acct 2 rows can show 0% acceptance/cancellation when DRIVER_QUALITY 500s.
Cover all step failures with the failure alert, not just the three patched ones — only steps 2/3/5 currently call markRunFailed.
Show alert history and resend controls on the dashboard.
Let the alert webhook be configured from the dashboard instead of env vars.
Show backfill run progress in the CLI after triggering.
Discrepancies / risks found while authoring this spec

⚠️ .replit deploymentTarget = "cloudrun" but replit.md and this spec require "vm". If the live deployment is actually on cloudrun-style autoscaling, the daily cron is at risk. Action: verify the live deployment type in the Replit UI and either fix .replit or update the docs to reflect reality.
⚠️ Uber Acct 1 secrets (UBER_CLIENT_ID_1, UBER_CLIENT_SECRET_1, UBER_ORG_ID_ENCRYPTED_1) are listed as missing in the dev environment. The workflow skips Uber Acct 1 gracefully when these are missing — meaning if the deployment is also missing them, daily runs would silently produce no Acct 1 Car rows.
Drive API is disabled at the GCP project level for the service account, so Sheet revision history can't be queried programmatically. If a data-loss incident occurs, the only recovery path is the Sheets UI version history (or an external backup like the xlsx used in the May 12–16 Notes restoration).
Recent incident history

2026-04-29 — Daily run silently missed. Root cause: deployment had been switched to autoscale, killing the in-process scheduler. Fixed by switching back to Reserved VM and documenting the requirement.
2026-05-17 — Bug discovered: the write-to-sheets step was wiping supervisor-added columns (Notes, Expected cash, etc.) on re-runs because the row-replacement logic was a blind overwrite. Fixed by introducing driverRowKey and buildRowFromMergedHeaders.
2026-05-19 — Two follow-on corrections:
All 154 historical Bolt-or-blank-Platform rows had Vehicle Type = Car corrected to Motorbike (tests/backfillBoltMotorbike.ts --apply).
The hardcoded Bolt default was flipped from 'Car' to 'Motorbike' in the workflow, and the driverRowKey and sheet-writer fallback were made platform-aware.
Notes for May 12–16 (71 cells) were restored from an old xlsx export (tests/restoreNotesMay12_16.ts --apply). May 17 notes were not in the source file and remain unrecovered.
11. File map (where things live)

src/
  mastra/
    index.ts                    Mastra instance, scheduler, auth middleware
    agents/agent.ts             (Unused operationally — placeholder)
    workflows/
      workflow.ts               6-step workflow; exports driverRowKey
    tools/
      boltApiClient.ts          Bolt OAuth + REST calls
      boltTools.ts              (Tool wrappers)
      uberApiClient.ts          Uber OAuth, CSV parsing, timeline state machine
      googleSheetsClient.ts     Sheets auth, tab management, header merging
      googleSheetsTool.ts       (Tool wrappers)
      runLog.ts                 markRunStarted / markRunFailed, alerts[]
      alerts.ts                 Webhook dispatch + dedup
      exampleTool.ts            (Template, unused)
scripts/
  build.sh                      Production build
  inngest.sh                    Local dev: starts Inngest CLI
  post-merge.sh                 Auto-runs after task agent merges (npm install)
tests/
  dateRange.test.ts             Locks date-range branching (12 cases)
  driverRowKey.test.ts          Locks row-matching rule (9 cases)
  backfillBoltMotorbike.ts      One-shot: legacy Car→Motorbike correction
  restoreNotesMay12_16.ts       One-shot: Notes restoration from xlsx
  triggerProductionBackfill.ts  CLI to fire a backfill against deployment
  testCronAutomation.ts         Local cron test
  testWebhookAutomation.ts      Webhook integration test
replit.md                       Project README + User Preferences
.replit                         Deployment config (see §10 issue 1)

12. Environment variables (complete reference)

Variable	Required	Purpose
DATABASE_URL	Yes	Postgres for Mastra storage
GOOGLE_SERVICE_ACCOUNT_JSON	Yes	Sheets write access
BOLT_CLIENT_ID / BOLT_CLIENT_SECRET	Yes	Bolt OAuth
UBER_CLIENT_ID_1 / UBER_CLIENT_SECRET_1 / UBER_ORG_ID_ENCRYPTED_1 / UBER_ORG_UUID_1	For Uber Acct 1 data	Otherwise Acct 1 silently skipped
UBER_CLIENT_ID_2 / UBER_CLIENT_SECRET_2 / UBER_ORG_ID_ENCRYPTED_2 / UBER_ORG_UUID_2	For Uber Acct 2 data	Otherwise Acct 2 silently skipped
BACKFILL_AUTH_TOKEN	Yes (production)	Required to call workflow trigger endpoints in production
ALERT_WEBHOOK_URL or SLACK_WEBHOOK_URL	Strongly recommended	Failure / missed-run notifications
SCHEDULER_WATCHDOG_DELAY_MS	No	Default 600000 (10 min)
ENABLE_CRON_CATCHUP	No	If true, attempts a catch-up run at deploy time
RUN_START_DATE / RUN_END_DATE	No (dev only)	Local-dev backfill override
SESSION_SECRET	Yes	Mastra session signing
AI_INTEGRATIONS_OPENAI_API_KEY / AI_INTEGRATIONS_OPENAI_BASE_URL	No	Available for LLM calls; not currently used by the daily workflow
13. Acceptance criteria for "the system is working"

The Reserved-VM deployment is up at https://flexi-report-automate.replit.app.
Every morning by ~01:15 UTC, "Rider Daily Data" contains ~15–20 fresh rows dated yesterday, split across Bolt (Motorbike) and Uber (Car + Motorbike).
Re-running any past date via tests/triggerProductionBackfill.ts replaces only that date's rows and preserves all supervisor-added columns (R, T, W, X, Y, Z).
Vehicle Type distribution remains: all Bolt rows = Motorbike, Uber Acct 1 = Car, Uber Acct 2 = Motorbike.
Rider_info grows monotonically (new drivers appended, never removed by the workflow).
Amoeba_Daily_Summary has one row per (date, amoeba) for every date in Rider Daily Data.
npx tsx tests/dateRange.test.ts and npx tsx tests/driverRowKey.test.ts both pass.
A configured alert webhook receives a message within 10 minutes of any failed or missed run.