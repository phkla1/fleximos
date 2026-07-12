# Manager acceptance tests — Manager console

**Who this is for:** managers and GMs overseeing multiple supervisors/amoebas.
**Where:** `https://<host>/apps/manager-console/`

The Manager console is the layer above the supervisor inbox: the team
portfolio, everything that has escalated beyond a supervisor, amoeba P&L with
expenses, the operator leaderboard and daily report snapshots. Visibility
follows your Manager role assignments.

## Tests

### MA-1 · Open the console
1. Open the console URL.

**Expected:** "Operations across your teams" with green connection status,
the From/To range control (defaulting to today), and five KPI tiles: active operators, live operators, Net Earnings, Gross P&L for
the selected period, and the escalation queue count.

### MA-2 · Read the team portfolio
1. Review the **Team portfolio** cards.

**Expected:** one card per supervisor/amoeba with live count, car vs bike Net
Earnings, alerts, an at-risk pill and a progress bar against target. Cards
needing attention sort first.

### MA-3 · Understand the escalation queue
1. Go to **Escalations**.

**Expected:** five count tiles (escalated alerts, open incidents, overdue
inspections, missing closeouts, open maintenance), then three lists: alerts
needing manager action, open incidents and fleet follow-ups. Nothing here is
routine supervisor work — it is only what outgrew the supervisor inbox.

### MA-4 · Action an escalated alert
1. In "Alerts needing manager action", acknowledge or resolve one (a
   supervisor tester can create one via SU-5).

**Expected:** the dialog captures a note; the alert updates and the queue
counts change on refresh.

### MA-5 · Action an incident
1. In "Open incidents", acknowledge then resolve one with a note.

**Expected:** confirmations, and the incident leaves the queue.

### MA-6 · Read the P&L
1. Go to **P&L**. The period follows the From/To range at the top of the
   page — set it to cover the last few days.

**Expected:** company totals (Net Earnings, direct expenses, maintenance,
central costs, hourly P&L) and one card per amoeba showing Net Earnings,
direct costs, its share of central costs, gross P&L, per-hour P&L and target
attainment. Loss-making amoebas are marked red.

### MA-7 · Record a direct expense
1. In **Record an expense**, pick a date in your P&L window, allocation
   "Direct to amoeba", choose an amoeba and category, enter an amount and a
   description, save.

**Expected:** "Expense saved and P&L recalculated" — the amoeba's direct
costs and gross P&L change accordingly, and the expense appears in "Recent
expenses".

### MA-8 · Record a central cost and check allocation
1. Record another expense with allocation "Central (allocated)".

**Expected:** the "Central costs" total rises and every amoeba's "central
share" changes in proportion to its active-operator headcount.

### MA-9 · Use the leaderboard
1. Go to **Leaderboard**. Read the weights line at the top.
2. Switch sorting between Score, Net Earnings, Acceptance, Trips, Online, Cash.

**Expected:** ranked rows with gold/silver/bronze for the top three, each row
showing the score components, Net Earnings, trips, hours and cash position.
Sorting reorders instantly.

### MA-10 · Export CSVs
1. Press **Download CSV** in the P&L section, then in the Leaderboard section.

**Expected:** two files download (`fleximotion-pnl-…csv`,
`fleximotion-leaderboard-…csv`) and open cleanly in a spreadsheet.

### MA-11 · Daily report snapshots
1. Go to **Daily reports** (generate one from the Ops admin console if empty).

**Expected:** snapshot rows with operators live/active and Net Earnings split
by cars and bikes.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| MA-1 | | |
| MA-2 | | |
| MA-3 | | |
| MA-4 | | |
| MA-5 | | |
| MA-6 | | |
| MA-7 | | |
| MA-8 | | |
| MA-9 | | |
| MA-10 | | |
| MA-11 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
