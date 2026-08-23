# Finance acceptance tests — Finance console

**Who this is for:** finance leads and accountants.
**Where:** `https://<host>/apps/finance-console/`

The Finance console covers the money side: Monnify reserved accounts and
deposits, platform-expected cash vs Monnify-received variance, finance
adjustments with evidence, accounting-period close, and CSV exports. During
UAT the Monnify provider runs in **simulated** mode — the flows are real, the
bank is not.

## Tests

### FI-1 · Open the console
1. Open the console URL.

**Expected:** "Collections and reconciliation status" loads, connection turns
green, and the metric tiles show reserved accounts, deposits and provider
mode ("simulated"). Access mode shows how your visibility is scoped.

### FI-2 · Monnify service readiness
1. Read the **Monnify service readiness** panel.

**Expected:** a checklist of integration states (webhook, verification,
reconciliation) with counts — nothing shows "Not connected" while the
Payments service is up.

### FI-3 · Run the sandbox deposit test
1. Press **Run sandbox test**.

**Expected:** notice reads "Sandbox deposit delivered…", webhook event and
reconciliation run counts increase. This simulates a signed operator deposit
end to end: webhook → verification → matching → Ops ledger.

### FI-4 · Review cash vs remittance
1. Go to **Platform cash vs Monnify remittance**.

**Expected:** a period banner ("Open for Finance review" while unlocked),
summary cards per amoeba, and operator exception rows only where there is a
shortfall or credit — balanced operators stay out of the way.

### FI-5 · Record a finance adjustment
1. On an exception row, open the adjustment action.
2. Record a **credit** with an amount, a reason and an evidence reference
   (e.g. "Bank stmt 2026-07-05 line 14"), save.

**Expected:** confirmation; the operator's variance updates. Supervisors can
explain shortfalls but only Finance can record adjustments — this dialog is
the control point.

### FI-6 · Close an accounting period
1. Set **To** to a past date, press **Close selected period** (the close always acts on the To date).

**Expected:** the period close is recorded and appears under **Recent period
closes** with its exception counts. Once closed, cash records for that date
are locked — try recording another adjustment for the closed date and confirm
it is refused with a clear message.

### FI-7 · Reserved account provisioning
1. Go to **Operator reserved accounts**.
2. Open **View operators** on a card.

**Expected:** every scoped operator with their reserved-account number and
provisioning state (simulated accounts are labelled as such). The intro
states plainly that live bank balances and per-platform fund locations
arrive with the Monnify sandbox/live phase — their absence here is
intentional, not a defect.

### FI-8 · Export the CSVs
1. Press **Export cash CSV**, then **Export accounts CSV**.

**Expected:** `…cash-closeout…csv` and `…reserved-accounts…csv` download and
open cleanly in a spreadsheet.

### FI-8b · Uber dual-source reconciliation
1. Export the **Payment Transactions** report from the Uber fleet portal
   (Reports → Payment Transactions) as CSV.
2. Under **Platform cash vs Monnify remittance**, open **Import / record
   Uber cash sources** and choose the file.
3. If a driver has no Uber UUID on file and their roster name doesn't match
   the Uber name, they are listed as unmatched — use the manual form below
   the import to record their daily total instead.
4. Now the **performance CSV** (first source): note that its file picker is
   locked. Enter the period the export covers (**required — this file has
   no dates in it, so the figures are only valid for the range you
   declare**), then choose the file. Drivers are matched by phone number
   first, then by name.

**Expected:** the import reads the "Cash collected" column, totals it per
driver per day (Uber's bracketed amounts like `(3,700.00)` are handled),
matches drivers by Uber UUID and then by name, and reports "✓ Imported N
daily totals for D drivers" plus any unmatched names. For each imported
day, the operator's expected cash uses the HIGHER of the performance cash
earnings and the payment-report total; the row shows both figures and flags
"sources disagree by ₦X" when they differ by more than ₦100 — rows with a
source disagreement appear for review even when the cash itself is
balanced. Re-importing the same file (or re-saving a corrected manual
amount) replaces the figures — no duplicates.

For the performance import: each driver's "Cash Collected" total is saved
against exactly the declared period. When the cash review range fully
contains that period, the performance side of the comparison uses the
HIGHER of the ingested cash-trip share and the imported report figure, and
the row notes "(report import)" when the import is what set it. Outside
the declared period the imported figure does not apply. Re-importing over
the same period replaces the figures.

### FI-9 · Fuel and mileage exceptions
1. Review **Fuel and mileage exceptions**.

**Expected:** operational exceptions (fuel-efficiency variance, unexplained
mileage) that affect cost review, with dates and operators.

### FI-10 · Review a date range
1. Set **From** to three days ago and **To** to today, then refresh.

**Expected:** cash summaries and exceptions aggregate across the range (both
dates equal means a single day); the period banner reflects the To date, and
closed dates show the locked banner state.

## Results

| Test | Pass/Fail | Notes |
|---|---|---|
| FI-1 | | |
| FI-2 | | |
| FI-3 | | |
| FI-4 | | |
| FI-5 | | |
| FI-6 | | |
| FI-7 | | |
| FI-8 | | |
| FI-8b | | |
| FI-9 | | |
| FI-10 | | |

Tester: ____________  Date: ____________  Device/browser: ____________
