# Supervisor acceptance tests — Amoeba Control Room

**Who this is for:** supervisors / amoeba owners running a team day to day.
**Where:** `https://<host>/apps/ops-console/` (mobile-first — test on a phone
if you can; add it to your home screen and it installs like an app).

The supervisor app is a field-operations cockpit. It opens on "What needs my
action now?" and moves with your operating rhythm: readiness → live pace →
alerts → fuel → field issues → closeout. You only see operators assigned to
you. Navigation is the six-tab dock at the bottom (phone) or top (desktop):
Cockpit · Board · Alerts · Fuel · Field · Close.

## Tests

### SU-1 · Open the cockpit
1. Open the app URL.

**Expected:** the status dot turns green ("Team data connected") and the
Cockpit shows three gauges — Net Earnings pace, operators live now, and
closeout readiness — coloured green/yellow/red by state, plus Cars/Bikes
Net Earnings chips. No API IDs or connector jargon anywhere.

### SU-2 · Read "Do these first"
1. Look at the **Do these first** strip under the gauges.

**Expected:** up to three ranked actions (acknowledge a high-tier alert,
respond to an incident, review operator explanations, inspect overdue
vehicles, confirm fuel) — each with a button that takes you straight to the
work. On a clean day it says "All clear".

### SU-3 · Scan team conditions
1. Review the **Team conditions** cards; tap one.

**Expected:** red/yellow/green cards for: not seen today, offline after
coming online, open alert, behind pace, fuel/mileage risk, vehicle issue,
open alerts, closeout blockers. Tapping a card jumps to the tab where you
act on it.

### SU-4 · Work the operator board
1. Open **Board**. 2. Tap an operator tile.

**Expected:** operators are grouped by state (risky groups open first, "on
track" collapsed), each tile showing name, plate, live status, pace pill,
progress toward target, trips/hours/alerts and platform badges. Tapping a
tile opens the operator detail sheet: figures vs target, platform accounts,
a 📞 Call button when a phone number exists, any open alerts with action
buttons, fuel/mileage rows, and **Today's timeline** — the operator's day
as recorded events (alerts, fuel confirms, inspections, incidents).

### SU-5 · Acknowledge an alert
1. Open **Alerts** (note the red badge count on the dock icon).
2. Open a condition group, tap **Acknowledge** on an alert, add a note,
   confirm.

**Expected:** alerts group by condition ("3 operators · behind pace") before
individuals. The notice confirms the acknowledgement and the pill updates.

### SU-6 · Review an operator's explanation
1. Find an alert with an "Operator reason" line (ask an operator tester to
   run test OP-5 first, or use one already submitted).
2. Tap **Accept** (or **Reject**).

**Expected:** the reason line shows the decision; both outcomes are audited.

### SU-7 · Escalate an alert
1. Pick an unresolved alert, tap **Escalate**, add a note, confirm.

**Expected:** "Alert escalated to manager" — it now appears in the Manager
console's escalation queue.

### SU-8 · Handle an incident
1. Open **Field** (ask an operator tester to send a breakdown via OP-8, or
   use the seeded list). 2. **Acknowledge**, then **Resolve** with a note.

**Expected:** the incident moves open → acknowledged → resolved.
High-severity incidents (accident, police) are marked red.

### SU-9 · Submit a vehicle inspection
1. In **Field**, note the 48-hour compliance line; overdue vehicles are
   marked in the vehicle picker. 2. Submit an inspection (odometer, fuel
   level, condition).

**Expected:** "Inspection submitted"; a "needs repair" inspection requires
notes and is flagged for manager review. The **📷 Take photo** button opens
the phone camera directly (not the gallery — that is deliberate, so the
capture time is credible); the photo is optional, timestamped at capture,
and appears as a "📷 Photo" chip on the inspection row that opens the image.

### SU-10 · Run the maintenance queue
1. In **Field**, report an issue (category + description).
2. On the new row: **Start repair**, then **Resolve** with a cost.

**Expected:** open → in repair → resolved; the cost feeds the amoeba P&L.
An optional camera photo can be attached when reporting, exactly as in SU-9.

### SU-11 · Confirm fuel or charge
1. Open **Fuel**. 2. Pick an operator, enter a quantity, choose litres
   (fuel) or kWh (charge), confirm.

**Expected:** "Fuel issue confirmed", and the reconciliation list shows
issued quantity, expected distance, official platform distance, tracker
distance where available (bikes typically show "Tracker unavailable" — by
design) and variance pills.

### SU-12 · Submit the daily closeout
1. Open **Close**.

**Expected:** one card per operating unit with an auto-filled checklist:
unresolved alerts, open incidents, overdue inspections, fuel not confirmed,
mileage exceptions, maintenance blockers — each Clear (✓) or flagged (!)
with a Review link that jumps to the right tab. Add an optional note and
submit ("Submit with exceptions" when blockers remain). The card flips to a
timestamped submitted state, the closeout-readiness gauge updates, and the
manager console stops listing your closeout as missing.

### SU-13 · Review a date range
1. Set **From** to two days ago and **To** to today in the top bar.

**Expected:** gauges, board groups, alerts and mileage cover the whole range
(targets scale by day count; mileage rows show their day). From = To returns
to a single-day view.

### SU-14 · Phone check
1. Do SU-1 through SU-5 on a phone (or a 320px-wide window).

**Expected:** no sideways scrolling, the dock stays reachable at the bottom,
and every button is comfortably tappable.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| SU-1 | | |
| SU-2 | | |
| SU-3 | | |
| SU-4 | | |
| SU-5 | | |
| SU-6 | | |
| SU-7 | | |
| SU-8 | | |
| SU-9 | | |
| SU-10 | | |
| SU-11 | | |
| SU-12 | | |
| SU-13 | | |
| SU-14 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
