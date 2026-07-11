# System Admin acceptance tests — Ops Admin + Identity Admin consoles

**Who this is for:** system administrators and data-operations staff.
**Where:**
- Ops admin: `https://<host>/apps/ops-admin-console/`
- Identity/Amoeba admin: `https://<host>/apps/admin-console/`

Admin surfaces are for configuration, roster, policies and data health — not
day-to-day operations (that lives with supervisors and managers).

## Part A — Ops admin console

### AD-1 · Open the console
1. Open the Ops admin URL.

**Expected:** "Today's operating picture" with green connection and summary
tiles (active operators, open alerts, vehicles ready, platform feeds).
Clicking a tile jumps to the matching section — Active operators opens the
full roster, Open alerts the inbox, Vehicles ready the fleet list.

### AD-2 · Team summary drilldown
1. Go to **Team board**, open a team.

**Expected:** teams are summarised first (no individual operators until you
open one); the dialog lists the team's operators with status and revenue.

### AD-3 · Grouped alert inbox
1. Go to **Alerts**, set the status filter to "All alerts".
2. Open a condition's **View affected operators**.

**Expected:** alerts group by condition with an "active operators affected"
count before you see individuals. This view is observational: acknowledging
and resolving happens in the supervisor console (managers handle
escalations), so there are no action buttons here.

### AD-4 · Manual performance entry
1. Go to **Manual entry → Enter a performance record**.
2. Pick an operator, adjust revenue, save.

**Expected:** "1 record accepted". Manual entry exists for feed outages and
corrections only — the notice text should make that clear.

### AD-5 · Roster scoping
1. Go to **Roster → Manage operator roster**.
2. Choose an amoeba scope, then search for a non-existent name.

**Expected:** the list stays empty until a scope is chosen ("Choose a roster
scope"), fills when scoped, and reports "No operators match this scope" for
the failed search. Same behaviour under **Vehicles**.

### AD-6 · Revenue pace profile
1. Go to **Controls → Revenue pace profile → Add or change a pace profile**.
2. Switch vehicle type between car and motorbike.

**Expected:** the form preloads the active profile for the type (car target
₦60,000; bike ₦27,000 with 40/65/90 checkpoints in the seeded config).

### AD-7 · Vehicle efficiency and economics policies
1. Review both panels under **Controls**; add a new economics policy with an
   effective date of today.

**Expected:** choosing a vehicle type in the efficiency form loads that
type's current values; saving creates a new version for that type only. Both
lists show each version's effective window with an active / scheduled /
superseded pill. The newly saved economics policy becomes the one Analytics
and the leaderboard use for expected hours.

### AD-8 · Leaderboard weights
1. Go to **Controls → Leaderboard weights → Adjust Performance Score weights**.
2. First try weights that do not sum to 1.0 (e.g. all 0.9) and save.
3. Then save a valid set (e.g. 0.25 each).

**Expected:** the invalid set is rejected with "weights must sum to 1.0"; the
valid set saves and the summary line updates.

### AD-9 · Data health
1. Go to **Data health**. Review the job tiles, then **View scheduled jobs**
   and replay `daily-report-generate`.

**Expected:** 15 registered jobs with freshness states; the replay queues a
run that appears under recent job runs.

### AD-10 · Inspection compliance
1. Open **Data health → View inspection compliance**.

**Expected:** a compliance percentage plus one row per active vehicle with its
last-inspected time and a current/overdue/never-inspected pill.

### AD-11 · Generate and download a daily report
1. Go to **Reports**, generate a report for the whole company.
2. Open it and press **Download CSV**.

**Expected:** the button shows "Generating…" while it works, then a new
revision appears, opens with summary and rows, and downloads as
`fleximotion-ops-….csv`. Deleting a stale revision (Delete, then confirm)
removes it from the list; deletions are audited.

## Part B — Identity/Amoeba admin console

### AD-12 · Manage people and users
1. Open the Identity admin URL.
2. Create a person (name + phone), then create a user for them with the
   operator role.

**Expected:** both records save and appear in the tables; counts at the top
update.

### AD-13 · Scoped role assignments
1. Under **Access Assignments**, give a person a Manager role scoped to one
   amoeba.

**Expected:** the assignment saves with role + scope + validity. This is what
drives what managers and finance users can see in their consoles.

### AD-14 · Amoebas and sites
1. Review **Amoebas** and **Sites**; add a site to an amoeba with GPS
   coordinates and an alert radius.

**Expected:** the site saves and is available when assigning operators.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| AD-1 | | |
| AD-2 | | |
| AD-3 | | |
| AD-4 | | |
| AD-5 | | |
| AD-6 | | |
| AD-7 | | |
| AD-8 | | |
| AD-9 | | |
| AD-10 | | |
| AD-11 | | |
| AD-12 | | |
| AD-13 | | |
| AD-14 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
