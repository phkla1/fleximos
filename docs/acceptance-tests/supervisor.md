# Supervisor acceptance tests — Supervisor console

**Who this is for:** supervisors / amoeba owners running a team day to day.
**Where:** `https://<host>/apps/ops-console/`

The Supervisor console is your live operating picture: the team board, your
alert inbox, field operations (incidents, inspections, maintenance), the daily
performance report and fuel/mileage control. You only see operators assigned
to you.

## Tests

### SU-1 · Open the workspace
1. Open the console URL.

**Expected:** header shows "Supervisor workspace", the status dot turns green
("Team data connected"), and the five summary tiles fill in: active operators,
live operators, open alerts, car revenue, bike revenue.

### SU-2 · Read the team board
1. Scroll through **Team board**.

**Expected:** one tile per operator with name, plate, live status, a pace
label (Ahead / On track / Behind / At risk), expected-by-now revenue, progress
bar toward target, trips/hours/alerts and platform badges (e.g. "Car · Uber
Ride-Hailing"). Risk is colour-coded on the tile's left edge.

### SU-3 · Acknowledge an alert
1. Go to **Alerts**, find an open alert, tap **Acknowledge**.
2. Add a note in the dialog and confirm.

**Expected:** notice reads "Alert acknowledged", status pill changes.

### SU-4 · Review an operator's explanation
1. Find an alert with an "Operator reason" line (ask an operator tester to run
   test OP-5 first, or use one already submitted).
2. Tap **Accept** (or **Reject**).

**Expected:** the reason line shows the decision and the accept/reject buttons
disappear. Both outcomes are recorded in the audit trail.

### SU-5 · Escalate an alert
1. Pick an unresolved alert and tap **Escalate**, add a note, confirm.

**Expected:** notice reads "Alert escalated to manager", status becomes
"escalated". It now appears in the Manager console's escalation queue.

### SU-6 · Handle an incident
1. Go to **Field ops → Incidents** (ask an operator tester to send a
   breakdown via OP-8, or check the seeded list).
2. Tap **Acknowledge**, then **Resolve** with a short resolution note.

**Expected:** the incident moves open → acknowledged → resolved with a
confirmation each time. High-severity incidents (accident, police) are marked
red.

### SU-7 · Submit a vehicle inspection
1. Go to **Field ops → Vehicle inspections**. Note the compliance line
   ("% of vehicles inspected in the last 48h").
2. Pick a vehicle (overdue ones are marked), enter an odometer reading and
   fuel level, choose a condition, submit.

**Expected:** "Inspection submitted", the inspection appears in the list
below. A "needs repair" inspection requires notes or categories and is flagged
for manager review.

### SU-8 · Run the maintenance queue
1. Go to **Field ops → Maintenance queue**.
2. Report an issue with the form (category + description).
3. On the new row, tap **Start repair**, then **Resolve** and enter a repair
   cost when prompted.

**Expected:** the report moves open → in repair → resolved; the cost is shown
on the row. Resolved costs feed the amoeba P&L that managers see.

### SU-9 · Check the daily performance report
1. Go to **Performance**.

**Expected:** one row per operator/platform with trips, revenue, hours,
acceptance and status — your amoeba only.

### SU-10 · Confirm fuel and check mileage
1. Go to **Fuel & mileage**.
2. Choose an operator with a vehicle, enter litres issued, confirm.

**Expected:** "Fuel issue confirmed", and the reconciliation list shows fuel
issued, expected distance, official platform distance, tracker distance where
available (bikes typically show "Tracker unavailable" — that is expected) and
exception pills.

### SU-11 · Look at an earlier operating day
1. Change **Operating date** to a date with seeded history.

**Expected:** the board, alerts and performance update to that day.

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

Tester: ____________  Date: ____________  Device/browser: ____________
