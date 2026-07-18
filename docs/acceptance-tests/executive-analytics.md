# Executive analytics acceptance tests — Analytics console

**Who this is for:** founder, GM and finance lead.
**Where:** `https://<host>/apps/analytics-console/`

The Analytics console is the shared Net Earnings control room: anomalies,
growth, efficiency versus labour cost, utilisation, breakeven, cash variance
and leakage, with drilldown from company → amoeba → operator → platform and
vehicle detail. It reads from the other services and is deliberately
read-mostly — actions live in the Manager, Finance and Admin consoles.

## Tests

### AN-1 · First screen without scrolling
1. Open the console URL on a desktop.

**Expected:** the five control KPIs are visible without scrolling: Net
Earnings (with growth vs the previous comparable day), Hourly Efficiency vs
labour cost, Utilisation (active/available assets shown as the actual
fraction), Cash variance (expected vs Monnify received) and Grouped alerts.
Every KPI is clickable: Net Earnings jumps to the trend, Hourly Efficiency
to breakeven economics, Utilisation to operator signals, Cash variance opens
the operators behind the variance, Grouped alerts opens the attention map.

### AN-2 · Net Earnings language
1. Scan the page labels.

**Expected:** the metric is consistently called **Net Earnings** — never
generic "Revenue" — and there is no "accounting revenue" figure anywhere
(intentional until the accounting treatment is agreed).

### AN-3 · Day / week / month periods
1. Switch the period control: **Day → Week → Month → Day**.

**Expected:** the pace line updates ("7 days ending…", "30 days ending…"),
growth compares to the previous same-length window, and the trend chart
re-renders. Where no prior data exists it says so instead of showing a
misleading zero.

### AN-4 · Trend drilldown
1. In **Net Earnings trend**, click a bar.

**Expected:** a "What changed?" dialog for that day: movement vs prior day,
car/bike split and contributing amoebas.

### AN-5 · Breakeven and platform mix
1. Review **Breakeven and platform mix**.

**Expected:** a breakeven verdict against configured overheads and labour
assumptions (from the Admin economics policy), platform mix bars and the
car/bike split — vehicle economics never blended together.

### AN-6 · Amoeba portfolio drilldown
1. In **Amoeba portfolio**, open a card.
2. Inside the dialog, click an operator row.

**Expected:** the card dialog shows a decision cue, prior-period movement,
platform mix and vehicle mix; the operator row opens that operator's signal
(status, Net Earnings, alerts, cash position).

### AN-7 · Performance comparison bars
1. In **Performance bars**, switch the metric between Score, target pace, HE,
   utilisation and cash.

**Expected:** amoebas re-rank per metric with colour-coded bars.

### AN-8 · Operator signals and leaderboard
1. Review **Operator signals** (grouped: missing, offline, cash shortfall,
   active performers).
2. In **Operator leaderboard**, change the sort (e.g. Acceptance) and open an
   operator row.

**Expected:** groups before individuals; the leaderboard re-sorts; the row
dialog shows the operator's detail.

### AN-9 · Leakage watch and data quality
1. In **Leakage watch**, click a bar (e.g. cash shortfalls).
2. Open **data quality impact** from the KPI area.

**Expected:** each leakage group drills into the operators behind it; the
data-quality dialog splits Net Earnings by authoritative / derived /
stale-missing sources so estimated values are never hidden.

### AN-10 · Export the analytics CSV
1. Press **Export CSV**.

**Expected:** `fleximotion-analytics-….csv` downloads with amoeba, operator
and performance rows for the selected period.

### AN-11 · Mobile check
1. Open the console on a phone.

**Expected:** everything remains readable and usable with no sideways
scrolling.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| AN-1 | | |
| AN-2 | | |
| AN-3 | | |
| AN-4 | | |
| AN-5 | | |
| AN-6 | | |
| AN-7 | | |
| AN-8 | | |
| AN-9 | | |
| AN-10 | | |
| AN-11 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
