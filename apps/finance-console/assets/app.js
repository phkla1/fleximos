const state = {
  people: [],
  amoebas: [],
  operators: [],
  performance: [],
  cashStatus: [],
  cashAdjustments: [],
  closeouts: [],
  mileage: [],
  reservedAccounts: [],
  webhookEvents: [],
  transactions: [],
  reconciliationRuns: [],
  periodCloses: [],
  actorProfile: null,
  paymentsHealth: null,
  paymentsAvailable: false,
  lastSandboxMessage: "",
  operatingDate: null
};
const ids = [
  "connectionText", "dateFrom", "dateTo", "operatorCount", "exceptionCount", "notice",
  "revenueContext", "carRevenue", "bikeRevenue", "onlineHours", "operatorAccountList",
  "exceptionList", "operatorDialog", "operatorDialogTitle", "operatorDialogSummary",
  "operatorDialogList", "paymentsContext", "providerMode", "reservedAccountCount",
  "accessMode", "webhookEventCount", "reconciliationRunCount", "periodCloseCount", "lastWebhookAt", "runSandboxTest", "closePeriod",
  "reservedAccountMetric", "reservedAccountMetricNote", "depositMetric", "depositMetricNote",
  "cashExposureMetric", "cashExposureMetricNote", "periodCloseBanner", "cashSummaryList", "cashExceptionList",
  "periodCloseList", "exportCashCsv", "exportAccountsCsv", "adjustmentDialog", "adjustmentForm", "adjustmentDialogTitle",
  "adjustmentDialogSummary", "adjustmentOperatorId", "adjustmentType", "adjustmentAmount",
  "adjustmentReason", "adjustmentEvidence", "adjustmentNotes"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const query = new URLSearchParams(location.search);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const paymentsBase = query.get("paymentsApiBase") || window.flexiServiceBase("payments", 4040);
const token = window.flexiServiceToken();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
el.dateFrom.value = today;
el.dateTo.value = today;

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (value) => `₦${Number(value || 0).toLocaleString()}`;
const personName = (id) => state.people.find((item) => item.person_id === id)?.display_name || id;
const amoebaName = (id) => state.amoebas.find((item) => item.amoeba_id === id)?.name || id;
const expectedCashBasis = (basis) => basis === "cash_trip_revenue_share"
  ? "Derived from platform cash-trip share"
  : String(basis || "Platform cash amount");
const adjustmentKey = (item) => `${item.operator_id}:${String(item.adjustment_date).slice(0, 10)}`;
const lagosDateString = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date(value));
const csvEscape = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Request failed: ${response.status}`);
  return body;
}
const ops = (path) => request(opsBase, path);
const foundation = (path) => request(foundationBase, path);
const payments = (path, options) => request(paymentsBase, path, options);

function connection(status, text) {
  const root = document.querySelector(".connection-status");
  root.classList.remove("connected", "error");
  if (status) root.classList.add(status);
  el.connectionText.textContent = text;
}

function currentPeriodClose() {
  return state.periodCloses.find((close) => lagosDateString(close.period_start) === state.operatingDate)
    || state.periodCloses.find((close) => String(close.period_start).slice(0, 10) === state.operatingDate);
}

function hasSystemAccess() {
  const roles = state.actorProfile?.roles || [];
  return state.actorProfile?.actor_type === "service" || roles.includes("owner") || roles.includes("admin");
}

function hasAssignedRole(role) {
  return (state.actorProfile?.role_assignments || []).some((assignment) =>
    assignment.role === role && assignment.status === "active"
  );
}

function canFinanceMutate() {
  return hasSystemAccess() || hasAssignedRole("finance");
}

function accessModeLabel() {
  if (hasSystemAccess()) return "System admin";
  if (hasAssignedRole("finance")) return "Finance actions";
  if (hasAssignedRole("manager")) return "Manager view-only";
  return "View-only";
}

function render() {
  const activeOperators = state.operators.filter((operator) => operator.operator_status === "active");
  const netEarnings = state.performance.reduce((totals, record) => {
    const type = record.platform_vehicle_type || record.vehicle_type;
    if (type === "car") totals.car += Number(record.net_earnings_ngn || 0);
    if (type === "motorbike") totals.bike += Number(record.net_earnings_ngn || 0);
    totals.hours += Number(record.hours_online || 0);
    return totals;
  }, { car: 0, bike: 0, hours: 0 });
  const exceptions = state.mileage.filter((item) =>
    ["outside_tolerance", "review_required"].includes(item.official_distance_status)
    || ["outside_tolerance", "review_required"].includes(item.tracker_variance_status)
  );
  el.operatorCount.textContent = activeOperators.length;
  el.exceptionCount.textContent = exceptions.length;
  el.carRevenue.textContent = money(netEarnings.car);
  el.bikeRevenue.textContent = money(netEarnings.bike);
  el.onlineHours.textContent = netEarnings.hours.toFixed(1);
  el.revenueContext.textContent = `Scoped platform activity ${state.dateFrom === state.dateTo ? `for ${state.operatingDate}` : `from ${state.dateFrom} to ${state.dateTo}`}. This is operational Net Earnings, not accounting revenue or a bank-reconciled cash balance.`;
  const accountByOperator = new Map(state.reservedAccounts.map((account) => [account.operator_id, account]));
  const provisionedOperators = activeOperators.filter((operator) => accountByOperator.has(operator.operator_id));
  const reservedAccountBalance = state.reservedAccounts.reduce((sum, account) => sum + Number(account.current_balance_ngn || 0), 0);
  el.providerMode.textContent = state.paymentsHealth?.provider_mode || "Unavailable";
  el.reservedAccountCount.textContent = state.reservedAccounts.length;
  const financeCanMutate = canFinanceMutate();
  el.accessMode.textContent = accessModeLabel();
  el.webhookEventCount.textContent = state.webhookEvents.length;
  el.reconciliationRunCount.textContent = state.reconciliationRuns.length;
  el.periodCloseCount.textContent = state.periodCloses.length;
  const selectedPeriodClose = currentPeriodClose();
  const periodIsClosed = Boolean(selectedPeriodClose);
  const receivedDeposits = state.transactions.filter((transaction) =>
    ["delivered_to_ops", "reconciled", "settled", "finance_approved"].includes(transaction.status)
  ).length;
  const settledDeposits = state.transactions.filter((transaction) => ["settled", "finance_approved"].includes(transaction.status)).length;
  const approvedDeposits = state.transactions.filter((transaction) => transaction.status === "finance_approved").length;
  const cashTotals = state.cashStatus.reduce((totals, row) => {
    totals.expected += Number(row.expected_cash_ngn || 0);
    totals.remitted += Number(row.remitted_cash_ngn || 0);
    totals.adjustments += Number(row.adjustment_ngn || 0);
    totals.net += Number(row.net_position_ngn || 0);
    totals.shortfalls += row.cash_status === "shortfall" ? 1 : 0;
    totals.credits += row.cash_status === "in_credit" ? 1 : 0;
    return totals;
  }, { expected: 0, remitted: 0, adjustments: 0, net: 0, shortfalls: 0, credits: 0 });
  const opsExceptionCount = cashTotals.shortfalls + cashTotals.credits;
  el.reservedAccountMetric.textContent = state.paymentsAvailable ? money(reservedAccountBalance) : "Offline";
  el.reservedAccountMetricNote.textContent = state.paymentsAvailable
    ? `${state.reservedAccounts.length} reserved accounts · ${provisionedOperators.length} of ${activeOperators.length} active scoped`
    : "Payments Integration unreachable";
  el.depositMetric.textContent = state.paymentsAvailable ? receivedDeposits : "Offline";
  el.depositMetricNote.textContent = state.paymentsAvailable ? `${settledDeposits} settled, ${approvedDeposits} finance-approved` : "Payments ledger unavailable";
  el.cashExposureMetric.textContent = money(cashTotals.net);
  el.cashExposureMetricNote.textContent = `${money(cashTotals.expected)} platform expected, ${money(cashTotals.remitted)} Monnify received`;
  el.lastWebhookAt.textContent = state.paymentsHealth?.last_webhook_at ? new Date(state.paymentsHealth.last_webhook_at).toLocaleString() : "None";
  el.paymentsContext.textContent = state.paymentsAvailable
    ? `Payments Integration is online in ${state.paymentsHealth.provider_mode} mode. ${provisionedOperators.length} of ${activeOperators.length} active scoped operators have reserved accounts.`
    : "Payments Integration is offline or not configured. Finance can still review operational context, but collections tests are unavailable.";
  el.runSandboxTest.disabled = !financeCanMutate || !state.paymentsAvailable || state.paymentsHealth?.provider_mode !== "simulated" || !activeOperators.length;
  el.runSandboxTest.title = financeCanMutate ? "" : "Requires an active Finance role assignment.";
  el.closePeriod.disabled = !financeCanMutate || !state.paymentsAvailable || !state.transactions.length || periodIsClosed;
  el.closePeriod.textContent = periodIsClosed ? "Period closed" : "Close selected period";
  el.closePeriod.title = financeCanMutate ? "" : "Requires an active Finance role assignment.";
  el.periodCloseBanner.className = `period-banner ${periodIsClosed ? "closed" : cashTotals.shortfalls ? "warning" : ""}`;
  el.periodCloseBanner.innerHTML = periodIsClosed ? `
    <div><strong>Accounting period locked</strong><small>${escapeHtml(selectedPeriodClose.status.replaceAll("_", " "))} · ${new Date(selectedPeriodClose.created_at).toLocaleString()}</small></div>
    <div><span>Deposits</span><strong>${selectedPeriodClose.deposit_count}</strong></div>
    <div><span>Approved</span><strong>${selectedPeriodClose.finance_approved_count}</strong></div>
    <div><span>Exceptions</span><strong>${selectedPeriodClose.exception_count}</strong><small>${Number(selectedPeriodClose.ops_exception_count || 0)} cash</small></div>
    <div><span>Total received</span><strong>${money(selectedPeriodClose.total_amount_ngn)}</strong></div>
  ` : `
    <div><strong>Open for Finance review</strong><small>Adjustments and evidence can still be recorded for ${escapeHtml(state.operatingDate)}${state.dateFrom !== state.dateTo ? ` (period close acts on the To date; totals cover ${escapeHtml(state.dateFrom)} to ${escapeHtml(state.dateTo)})` : ""}.</small></div>
    <div><span>Expected</span><strong>${money(cashTotals.expected)}</strong></div>
    <div><span>Received</span><strong>${money(cashTotals.remitted)}</strong></div>
    <div><span>Adjustments</span><strong>${money(cashTotals.adjustments)}</strong></div>
    <div><span>Exceptions</span><strong>${opsExceptionCount}</strong><small>${money(cashTotals.net)} variance</small></div>
  `;

  const cashGroups = [...state.cashStatus.reduce((groups, row) => {
    if (!groups.has(row.amoeba_id)) groups.set(row.amoeba_id, []);
    groups.get(row.amoeba_id).push(row);
    return groups;
  }, new Map()).entries()].sort((a, b) => amoebaName(a[0]).localeCompare(amoebaName(b[0])));
  const closeoutKey = (row) => `${String(row.record_date).slice(0, 10)}:${row.amoeba_id}`;
  const closeouts = new Map(state.closeouts.map((item) => [closeoutKey(item), item]));
  el.cashSummaryList.innerHTML = cashGroups.length ? cashGroups.map(([amoebaId, rows]) => {
    const totals = rows.reduce((memo, row) => {
      memo.expected += Number(row.expected_cash_ngn || 0);
      memo.remitted += Number(row.remitted_cash_ngn || 0);
      memo.net += Number(row.net_position_ngn || 0);
      memo.shortfalls += row.cash_status === "shortfall" ? 1 : 0;
      memo.credits += row.cash_status === "in_credit" ? 1 : 0;
      return memo;
    }, { expected: 0, remitted: 0, net: 0, shortfalls: 0, credits: 0 });
    const closeout = closeouts.get(`${state.operatingDate}:${amoebaId}`);
    const statusClass = totals.shortfalls ? "critical" : totals.credits ? "attention" : "";
    return `
      <article class="summary-card ${statusClass}">
        <div class="card-heading"><div><strong>${escapeHtml(amoebaName(amoebaId))}</strong><small>${rows.length} scoped operators</small></div><span class="pill ${closeout ? "" : "pending"}">${escapeHtml(closeout?.status || "pending closeout")}</span></div>
        <div class="card-kpis">
          <span><strong>${money(totals.expected)}</strong> platform expected</span>
          <span><strong>${money(totals.remitted)}</strong> Monnify received</span>
          <span><strong>${money(totals.net)}</strong> variance</span>
          <span><strong>${totals.shortfalls}</strong> shortfalls</span>
        </div>
      </article>`;
  }).join("") : '<div class="empty">No cash exposure is visible for this operating date.</div>';

  const cashExceptions = state.cashStatus.filter((row) => ["shortfall", "in_credit"].includes(row.cash_status));
  const adjustmentsByRow = state.cashAdjustments.reduce((groups, item) => {
    const key = adjustmentKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return groups;
  }, new Map());
  const adjustmentSummary = (row) => {
    const latest = adjustmentsByRow.get(adjustmentKey(row))?.[0];
    if (!latest) return row.cash_status.replaceAll("_", " ");
    return latest.evidence_reference
      ? `${latest.reason} · Evidence: ${latest.evidence_reference}`
      : latest.reason;
  };
  el.cashExceptionList.innerHTML = cashExceptions.length ? cashExceptions.map((row) => `
    <article class="data-row alert ${row.cash_status === "shortfall" ? "critical" : ""}">
      <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(amoebaName(row.amoeba_id))} · ${escapeHtml(row.vehicle_plate || "No vehicle")}</small></div>
      <div><span class="row-label">Platform expected</span><strong>${money(row.expected_cash_ngn)}</strong><small>${escapeHtml(expectedCashBasis(row.expected_cash_basis))}</small></div>
      <div><span class="row-label">Monnify received</span><strong>${money(row.remitted_cash_ngn)}</strong><small>${row.transaction_count} deposits</small></div>
      <div><span class="row-label">Variance</span><strong>${money(row.net_position_ngn)}</strong><small>${row.adjustment_count || 0} adjustments · ${escapeHtml(adjustmentSummary(row))}</small></div>
      <div class="row-actions"><span class="pill ${row.cash_status === "shortfall" ? "open" : "pending"}">${escapeHtml(row.cash_status.replaceAll("_", " "))}</span><button type="button" class="secondary" ${periodIsClosed || !financeCanMutate ? "disabled" : ""} data-adjust-operator="${escapeHtml(row.operator_id)}">${periodIsClosed ? "Locked" : financeCanMutate ? "Adjust" : "View-only"}</button></div>
    </article>`).join("") : '<div class="empty">No cash shortfalls or credits require Finance review.</div>';

  el.periodCloseList.innerHTML = state.periodCloses.length ? state.periodCloses
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 12)
    .map((close) => {
      const providerExceptions = Number(close.provider_exception_count || 0);
      const opsExceptions = Number(close.ops_exception_count || 0);
      const statusClass = close.status === "closed" ? "" : "open";
      return `
        <article class="data-row ${close.status === "closed" ? "" : "alert"}">
          <div><strong>${escapeHtml(lagosDateString(close.period_start))}</strong><small>Closed ${new Date(close.created_at).toLocaleString()} by ${escapeHtml(close.closed_by_person_id || "unknown")}</small></div>
          <div><span class="row-label">Deposits</span><strong>${close.deposit_count}</strong><small>${close.finance_approved_count} finance-approved</small></div>
          <div><span class="row-label">Received</span><strong>${money(close.total_amount_ngn)}</strong><small>Settlement ${money(close.settlement_amount_ngn)}</small></div>
          <div><span class="row-label">Exceptions</span><strong>${close.exception_count}</strong><small>${providerExceptions} provider · ${opsExceptions} cash</small></div>
          <div><span class="pill ${statusClass}">${escapeHtml(close.status.replaceAll("_", " "))}</span></div>
        </article>`;
    }).join("") : '<div class="empty">No accounting periods have been closed yet.</div>';

  const accountGroups = [...activeOperators.reduce((groups, operator) => {
    if (!groups.has(operator.amoeba_id)) groups.set(operator.amoeba_id, []);
    groups.get(operator.amoeba_id).push(operator);
    return groups;
  }, new Map()).entries()].sort((a, b) => amoebaName(a[0]).localeCompare(amoebaName(b[0])));
  el.operatorAccountList.innerHTML = accountGroups.length ? accountGroups.map(([amoebaId, operators]) => `
    <article class="summary-card attention">
      <div class="card-heading"><div><strong>${escapeHtml(amoebaName(amoebaId))}</strong><small>Reserved-account provisioning</small></div><span class="pill ${state.paymentsAvailable ? "pending" : "unavailable"}">${state.paymentsAvailable ? "Active" : "Offline"}</span></div>
      <div class="card-kpis">
        <span><strong>${operators.length}</strong> active operators</span>
        <span><strong>${operators.filter((operator) => accountByOperator.has(operator.operator_id)).length}</strong> provisioned</span>
        <span><strong>${money(operators.reduce((sum, operator) => sum + Number(accountByOperator.get(operator.operator_id)?.current_balance_ngn || 0), 0))}</strong> balance</span>
        <span><strong>${operators.filter((operator) => !accountByOperator.has(operator.operator_id)).length}</strong> pending</span>
      </div>
      <button type="button" class="secondary" data-open-amoeba="${escapeHtml(amoebaId)}">View operators</button>
    </article>`).join("") : '<div class="empty">No active operators are visible in this Finance scope.</div>';

  el.exceptionList.innerHTML = exceptions.length ? exceptions.map((record) => `
    <article class="data-row alert">
      <div><strong>${escapeHtml(personName(record.person_id))}</strong><small>${escapeHtml(record.plate)} · ${escapeHtml(record.vehicle_type)}</small></div>
      <div><span class="row-label">Fuel</span><strong>${record.fuel_quantity === null ? "Not confirmed" : `${Number(record.fuel_quantity)} ${escapeHtml(record.fuel_unit)}`}</strong><small>Expected ${record.expected_distance_km === null ? "unavailable" : `${Number(record.expected_distance_km)} km`}</small></div>
      <div><span class="row-label">Official distance</span><strong>${record.official_distance_km === null ? "Unavailable" : `${Number(record.official_distance_km)} km`}</strong><small>${escapeHtml(String(record.official_distance_status).replaceAll("_", " "))}</small></div>
      <div><span class="row-label">Tracker</span><strong>${record.tracker_distance_km === null ? "Unavailable" : `${Number(record.tracker_distance_km)} km`}</strong><small>${escapeHtml(String(record.tracker_variance_status).replaceAll("_", " "))}</small></div>
      <div><span class="pill pending">Review</span></div>
    </article>`).join("") : '<div class="empty">No fuel or mileage exceptions currently require Finance review.</div>';
}

document.addEventListener("click", (event) => {
  const adjustButton = event.target.closest("[data-adjust-operator]");
  if (adjustButton) {
    openAdjustmentDialog(adjustButton.dataset.adjustOperator);
    return;
  }
  const button = event.target.closest("[data-open-amoeba]");
  if (!button) return;
  const amoebaId = button.dataset.openAmoeba;
  const operators = state.operators.filter((operator) => operator.operator_status === "active" && operator.amoeba_id === amoebaId);
  const accountByOperator = new Map(state.reservedAccounts.map((account) => [account.operator_id, account]));
  el.operatorDialogTitle.textContent = `${amoebaName(amoebaId)} operators`;
  el.operatorDialogSummary.textContent = `${operators.length} active operators, ${operators.filter((operator) => accountByOperator.has(operator.operator_id)).length} provisioned.`;
  el.operatorDialogList.innerHTML = operators.map((operator) => `
    <article class="data-row">
      <div><strong>${escapeHtml(personName(operator.person_id))}</strong><small>${escapeHtml(operator.vehicle_plate || "No vehicle")}</small></div>
      <div><span class="row-label">Reserved account</span><strong>${escapeHtml(accountByOperator.get(operator.operator_id)?.account_number || "Not provisioned")}</strong><small>${escapeHtml(accountByOperator.get(operator.operator_id)?.bank_name || "")}</small></div>
      <div><span class="row-label">Balance</span><strong>${money(accountByOperator.get(operator.operator_id)?.current_balance_ngn || 0)}</strong><small>Total deposits ${money(accountByOperator.get(operator.operator_id)?.total_deposits_ngn || 0)}</small></div>
      <div><span class="pill ${accountByOperator.has(operator.operator_id) ? "" : "unavailable"}">${accountByOperator.has(operator.operator_id) ? "Provisioned" : "Pending"}</span></div>
      <div></div>
    </article>`).join("");
  el.operatorDialog.showModal();
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-adjustment]")) el.adjustmentDialog.close();
});

function openAdjustmentDialog(operatorId) {
  const row = state.cashStatus.find((item) => item.operator_id === operatorId);
  if (!row) return;
  if (currentPeriodClose()) {
    el.notice.classList.remove("error");
    el.notice.textContent = `Accounting period ${state.operatingDate} is closed. Adjustments are locked.`;
    return;
  }
  if (!canFinanceMutate()) {
    el.notice.classList.remove("error");
    el.notice.textContent = "This workspace is view-only. Adjustments require an active Finance role assignment.";
    return;
  }
  const isShortfall = row.cash_status === "shortfall";
  el.adjustmentOperatorId.value = operatorId;
  el.adjustmentDialogTitle.textContent = `Adjust ${personName(row.person_id)}`;
  el.adjustmentDialogSummary.textContent = `${amoebaName(row.amoeba_id)} · Current variance ${money(row.net_position_ngn)}. Evidence should point to the receipt, bank statement, or approved correction source.`;
  el.adjustmentType.value = isShortfall ? "credit" : "debit";
  el.adjustmentAmount.value = Math.abs(Number(row.net_position_ngn || 0)).toFixed(2);
  el.adjustmentReason.value = isShortfall ? "Monnify/bank evidence covers shortfall" : "Credit correction reviewed";
  el.adjustmentEvidence.value = "";
  el.adjustmentNotes.value = "";
  el.adjustmentDialog.showModal();
}

async function refresh() {
  connection("", "Connecting");
  el.notice.textContent = "Loading scoped Finance data...";
  const [actorProfile, people, amoebas, operators, allPerformance] = await Promise.all([
    foundation("/identity/v1/me").catch(() => ({ actor_type: "service", person_id: "person_system", scopes: [] })),
    foundation("/identity/v1/people"), foundation("/amoeba/v1/amoebas"), ops("/ops/v1/operators"), ops("/ops/v1/daily-performance")
  ]);
  const dates = [...new Set(allPerformance.data.map((item) => String(item.record_date).slice(0, 10)))].sort().reverse();
  let dateFrom = el.dateFrom.value || el.dateTo.value || today;
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const rangeHasData = dates.some((date) => date >= dateFrom && date <= dateTo);
  if (!rangeHasData && dates.length) {
    dateFrom = dates[0];
    dateTo = dates[0];
  }
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const operatingDate = dateTo;
  const [performance, mileage, cashStatus, cashAdjustments, closeouts] = await Promise.all([
    ops(`/ops/v1/daily-performance?${range}`),
    ops(`/ops/v1/mileage-reconciliations?${range}`),
    ops(`/ops/v1/cash/status?${range}`),
    ops(`/ops/v1/cash/adjustments?${range}`),
    ops(`/ops/v1/daily-closeouts?${range}`)
  ]);
  let paymentsState = {
    paymentsHealth: null,
    reservedAccounts: [],
    webhookEvents: [],
    transactions: [],
    reconciliationRuns: [],
    periodCloses: [],
    paymentsAvailable: false
  };
  try {
    const [paymentsHealth, reservedAccounts, webhookEvents, transactions, reconciliationRuns, periodCloses] = await Promise.all([
      request(paymentsBase, "/health"),
      payments("/payments/v1/reserved-accounts"),
      payments("/payments/v1/webhook-events"),
      payments("/payments/v1/transactions"),
      payments("/payments/v1/reconciliation-runs"),
      payments("/payments/v1/accounting-period-closes")
    ]);
    paymentsState = {
      paymentsHealth,
      reservedAccounts: reservedAccounts.data || [],
      webhookEvents: webhookEvents.data || [],
      transactions: transactions.data || [],
      reconciliationRuns: reconciliationRuns.data || [],
      periodCloses: periodCloses.data || [],
      paymentsAvailable: true
    };
  } catch {
    paymentsState.paymentsAvailable = false;
  }
  Object.assign(state, {
    people: people.data,
    amoebas: amoebas.data,
    operators: operators.data,
    performance: performance.data,
    mileage: mileage.data,
    cashStatus: cashStatus.data,
    cashAdjustments: cashAdjustments.data,
    closeouts: closeouts.data,
    actorProfile,
    operatingDate,
    dateFrom,
    dateTo,
    ...paymentsState
  });
  render();
  connection("connected", "Scoped APIs connected");
  el.notice.textContent = state.lastSandboxMessage || (state.paymentsAvailable
    ? `Finance visibility follows active role assignments. ${accessModeLabel()} access is active. Payments Integration is connected for Phase 4D cash closeout testing.`
    : `Finance visibility follows active role assignments. ${accessModeLabel()} access is active. Payments Integration is not currently reachable.`);
}

document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
el.runSandboxTest.addEventListener("click", () => runSandboxTest().catch(showError));
el.closePeriod.addEventListener("click", () => closeSelectedPeriod().catch(showError));
el.exportCashCsv.addEventListener("click", exportCashCsv);
el.exportAccountsCsv.addEventListener("click", exportAccountsCsv);
el.adjustmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAdjustment().catch(showError);
});
el.dateFrom.addEventListener("change", () => refresh().catch(showError));
el.dateTo.addEventListener("change", () => refresh().catch(showError));
function showError(error) { connection("error", "API error"); el.notice.textContent = error.message; el.notice.classList.add("error"); }

function exportCashCsv() {
  const closeoutKey = (row) => `${String(row.record_date).slice(0, 10)}:${row.amoeba_id}`;
  const closeouts = new Map(state.closeouts.map((item) => [closeoutKey(item), item]));
  const adjustmentsByRow = state.cashAdjustments.reduce((groups, item) => {
    const key = adjustmentKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return groups;
  }, new Map());
  const headers = [
    "operating_date", "amoeba", "operator", "vehicle_plate", "platform_expected_ngn",
    "monnify_received_ngn", "finance_adjustment_ngn", "net_position_ngn", "cash_status",
    "expected_cash_basis", "deposit_count", "latest_paid_at", "adjustment_count",
    "latest_adjustment_reason", "latest_evidence_reference", "closeout_status"
  ];
  const rows = state.cashStatus
    .slice()
    .sort((a, b) => amoebaName(a.amoeba_id).localeCompare(amoebaName(b.amoeba_id)) || personName(a.person_id).localeCompare(personName(b.person_id)))
    .map((row) => [
      String(row.record_date).slice(0, 10),
      amoebaName(row.amoeba_id),
      personName(row.person_id),
      row.vehicle_plate || "",
      row.expected_cash_ngn || 0,
      row.remitted_cash_ngn || 0,
      row.adjustment_ngn || 0,
      row.net_position_ngn || 0,
      row.cash_status || "",
      expectedCashBasis(row.expected_cash_basis),
      row.transaction_count || 0,
      row.latest_paid_at || "",
      row.adjustment_count || 0,
      adjustmentsByRow.get(adjustmentKey(row))?.[0]?.reason || "",
      adjustmentsByRow.get(adjustmentKey(row))?.[0]?.evidence_reference || "",
      closeouts.get(`${String(row.record_date).slice(0, 10)}:${row.amoeba_id}`)?.status || "pending_closeout"
    ]);
  downloadCsv(`fleximotion-cash-closeout-${state.operatingDate || today}.csv`, headers, rows);
}

function exportAccountsCsv() {
  const activeOperators = state.operators.filter((operator) => operator.operator_status === "active");
  const accountByOperator = new Map(state.reservedAccounts.map((account) => [account.operator_id, account]));
  const headers = [
    "amoeba", "operator", "operator_id", "vehicle_plate", "provisioning_status",
    "account_number", "account_name", "bank_name", "provider", "current_balance_ngn",
    "total_deposits_ngn", "last_deposit_at"
  ];
  const rows = activeOperators
    .slice()
    .sort((a, b) => amoebaName(a.amoeba_id).localeCompare(amoebaName(b.amoeba_id)) || personName(a.person_id).localeCompare(personName(b.person_id)))
    .map((operator) => {
      const account = accountByOperator.get(operator.operator_id);
      return [
        amoebaName(operator.amoeba_id),
        personName(operator.person_id),
        operator.operator_id,
        operator.vehicle_plate || "",
        account ? "provisioned" : "pending",
        account?.account_number || "",
        account?.account_name || "",
        account?.bank_name || "",
        account?.provider || "",
        account?.current_balance_ngn || 0,
        account?.total_deposits_ngn || 0,
        account?.last_deposit_at || ""
      ];
    });
  downloadCsv(`fleximotion-reserved-accounts-${state.operatingDate || today}.csv`, headers, rows);
}

async function submitAdjustment() {
  if (!canFinanceMutate()) throw new Error("This action requires an active Finance role assignment.");
  if (currentPeriodClose()) throw new Error("This accounting period is closed. Adjustments are locked.");
  const operatorId = el.adjustmentOperatorId.value;
  const row = state.cashStatus.find((item) => item.operator_id === operatorId);
  if (!row) throw new Error("Cash row is no longer available. Refresh and try again.");
  const type = el.adjustmentType.value;
  const rawAmount = Number(el.adjustmentAmount.value || 0);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error("Adjustment amount must be greater than zero.");
  const signedAmount = type === "debit" ? -rawAmount : rawAmount;
  el.notice.classList.remove("error");
  el.notice.textContent = `Saving finance adjustment for ${personName(row.person_id)}...`;
  await request(opsBase, "/ops/v1/cash/adjustments", {
    method: "POST",
    idempotencyKey: `finance-adjustment-${operatorId}-${state.operatingDate || today}-${Date.now()}`,
    body: {
      operator_id: operatorId,
      adjustment_date: state.operatingDate || today,
      amount_ngn: signedAmount,
      adjustment_type: type,
      reason: el.adjustmentReason.value,
      evidence_reference: el.adjustmentEvidence.value || null,
      notes: el.adjustmentNotes.value || null
    }
  });
  el.adjustmentDialog.close();
  state.lastSandboxMessage = `Finance adjustment saved for ${personName(row.person_id)}.`;
  await refresh();
}

async function runSandboxTest() {
  if (!canFinanceMutate()) throw new Error("This action requires an active Finance role assignment.");
  const activeOperators = state.operators.filter((operator) => operator.operator_status === "active");
  const operator = activeOperators.find((item) => !state.reservedAccounts.some((account) => account.operator_id === item.operator_id)) || activeOperators[0];
  if (!operator) throw new Error("No active operator is available for a sandbox test.");
  el.notice.classList.remove("error");
  el.notice.textContent = `Running sandbox deposit test for ${personName(operator.person_id)}...`;
  const account = await payments(`/payments/v1/operators/${operator.operator_id}/reserved-account`, {
    method: "POST",
    idempotencyKey: `finance-console-provision-${operator.operator_id}`,
    body: {
      customer_name: personName(operator.person_id),
      customer_email: `${operator.operator_id}@sandbox.fleximotion.example`,
      amoeba_id: operator.amoeba_id
    }
  });
  const reference = `finance-console-${operator.operator_id}-${Date.now()}`;
  await payments("/payments/v1/test/simulate-deposit", {
    method: "POST",
    idempotencyKey: reference,
    body: {
      operator_id: operator.operator_id,
      amount_ngn: 5000,
      transaction_reference: reference,
      paid_at: new Date().toISOString()
    }
  });
  await payments("/payments/v1/reconciliation-runs", {
    method: "POST",
    idempotencyKey: `finance-console-reconcile-${reference}`,
    body: {
      period_start: `${state.operatingDate || today}T00:00:00+01:00`,
      period_end: `${state.operatingDate || today}T23:59:59+01:00`
    }
  });
  state.lastSandboxMessage = `Sandbox deposit delivered through ${account.bank_name || "Monnify Sandbox Bank"} account ${account.account_number}.`;
  el.notice.textContent = state.lastSandboxMessage;
  await refresh();
}

async function closeSelectedPeriod() {
  if (!canFinanceMutate()) throw new Error("This action requires an active Finance role assignment.");
  if (currentPeriodClose()) {
    state.lastSandboxMessage = `Accounting period ${state.operatingDate} is already closed.`;
    await refresh();
    return;
  }
  const periodStart = `${state.operatingDate || today}T00:00:00+01:00`;
  const periodEnd = `${state.operatingDate || today}T23:59:59+01:00`;
  const opsExceptionCount = state.cashStatus.filter((row) => ["shortfall", "in_credit"].includes(row.cash_status)).length;
  el.notice.classList.remove("error");
  el.notice.textContent = opsExceptionCount
    ? `Running reconciliation and closing with ${opsExceptionCount} cash exceptions...`
    : "Running reconciliation and closing the selected period...";
  await payments("/payments/v1/reconciliation-runs", {
    method: "POST",
    idempotencyKey: `finance-console-reconcile-period-${state.operatingDate || today}`,
    body: { period_start: periodStart, period_end: periodEnd }
  });
  const latestTransactions = await payments("/payments/v1/transactions");
  const periodTransactions = (latestTransactions.data || []).filter((transaction) => {
    const paidAt = new Date(transaction.paid_at).getTime();
    return paidAt >= new Date(periodStart).getTime() && paidAt <= new Date(periodEnd).getTime();
  });
  for (const transaction of periodTransactions.filter((item) => item.status === "reconciled")) {
    await payments(`/payments/v1/transactions/${encodeURIComponent(transaction.transaction_reference)}/settle`, {
      method: "POST",
      idempotencyKey: `finance-console-settle-${transaction.transaction_reference}`,
      body: { notes: "Finance console period close." }
    });
  }
  const afterSettlement = await payments("/payments/v1/transactions");
  const approvalTransactions = (afterSettlement.data || []).filter((transaction) => {
    const paidAt = new Date(transaction.paid_at).getTime();
    return paidAt >= new Date(periodStart).getTime() && paidAt <= new Date(periodEnd).getTime()
      && transaction.status === "settled";
  });
  for (const transaction of approvalTransactions) {
    await payments(`/payments/v1/transactions/${encodeURIComponent(transaction.transaction_reference)}/finance-approve`, {
      method: "POST",
      idempotencyKey: `finance-console-approve-${transaction.transaction_reference}`,
      body: { notes: "Finance console period close." }
    });
  }
  const close = await payments("/payments/v1/accounting-period-closes", {
    method: "POST",
    idempotencyKey: `finance-console-period-close-${state.operatingDate || today}`,
    body: {
      period_start: periodStart,
      period_end: periodEnd,
      ops_exception_count: opsExceptionCount,
      notes: opsExceptionCount
        ? `Closed from Finance console with ${opsExceptionCount} Ops cash exceptions still visible.`
        : "Closed from Finance console."
    }
  });
  state.lastSandboxMessage = `Accounting period ${close.status.replaceAll("_", " ")} with ${close.deposit_count} deposits and ${close.exception_count} exceptions.`;
  await refresh();
}

refresh().catch(showError);
