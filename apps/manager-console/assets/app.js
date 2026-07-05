const state = {
  people: [], amoebas: [], operators: [], board: [], alerts: [], reports: [],
  escalations: null, pnl: null, expenses: [], leaderboard: null, leaderboardSort: "score",
  operatingDate: null
};
const ids = [
  "connectionText", "operatingDate", "activeCount", "liveCount", "liveContext", "revenueTotal", "expectedContext",
  "grossPnl", "pnlContext", "escalationCount", "escalationContext", "notice", "updatedLabel", "teamPortfolio",
  "escalationSummary", "escalationList", "incidentList", "fleetFollowups",
  "pnlStart", "pnlEnd", "pnlTotals", "pnlList", "expenseForm", "expenseList",
  "leaderboardList", "leaderboardIntro", "reportList", "actionDialog", "dialogTitle", "dialogContext", "dialogNotes"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const query = new URLSearchParams(location.search);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const token = query.get("token") || "flexi-dev-service-token";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
el.operatingDate.value = today;

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (value) => `₦${Math.round(Number(value || 0)).toLocaleString()}`;
const personName = (id) => state.people.find((item) => item.person_id === id)?.display_name || id || "Unassigned";
const amoebaName = (id) => state.amoebas.find((item) => item.amoeba_id === id)?.name || id || "Unassigned";
const operatorName = (id) => {
  const operator = state.operators.find((item) => item.operator_id === id);
  return operator ? personName(operator.person_id) : id;
};
const key = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const label = (value) => String(value ?? "").replaceAll("_", " ");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Request failed: ${response.status}`);
  return body;
}
const ops = (path, options) => request(opsBase, path, options);
const foundation = (path) => request(foundationBase, path);

function connection(status, text) {
  const root = document.querySelector(".connection-status");
  root.classList.remove("connected", "error");
  if (status) root.classList.add(status);
  el.connectionText.textContent = text;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => {
    const text = String(cell ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderPortfolio() {
  const live = state.board.filter((item) => !["offline", "not_seen_today"].includes(item.current_status)).length;
  const revenue = state.board.reduce((sum, item) => sum + Number(item.net_earnings_ngn || 0), 0);
  const expected = state.board.reduce((sum, item) => sum + Number(item.expected_revenue_ngn || 0), 0);
  el.activeCount.textContent = state.board.length;
  el.liveCount.textContent = live;
  el.revenueTotal.textContent = money(revenue);
  el.expectedContext.textContent = expected ? `vs ${money(expected)} expected` : "";
  el.updatedLabel.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

  const teams = [...state.board.reduce((groups, row) => {
    const operator = state.operators.find((item) => item.operator_id === row.operator_id);
    const supervisor = operator?.supervisor_person_id || "unassigned";
    const amoeba = operator?.amoeba_id || row.amoeba_id || "unassigned";
    const id = `${supervisor}:${amoeba}`;
    if (!groups.has(id)) groups.set(id, { supervisor, amoeba, rows: [] });
    groups.get(id).rows.push(row);
    return groups;
  }, new Map()).values()].map((team) => team.rows.reduce((result, row) => {
    const type = row.vehicle_type || row.platforms?.find((item) => item.vehicle_type)?.vehicle_type;
    const rowRevenue = Number(row.net_earnings_ngn || 0);
    result.revenue += rowRevenue;
    result.expected += Number(row.expected_revenue_ngn || 0);
    result.alerts += Number(row.open_alerts || 0);
    result.live += ["offline", "not_seen_today"].includes(row.current_status) ? 0 : 1;
    result.atRisk += row.pace_status === "at_risk" || row.pace_status === "behind" || Number(row.open_alerts) ? 1 : 0;
    if (type === "car") result.cars += rowRevenue;
    if (type === "motorbike") result.bikes += rowRevenue;
    return result;
  }, { ...team, revenue: 0, expected: 0, alerts: 0, live: 0, atRisk: 0, cars: 0, bikes: 0 }))
    .sort((a, b) => b.atRisk - a.atRisk || b.alerts - a.alerts);

  el.teamPortfolio.innerHTML = teams.length ? teams.map((team) => {
    const progress = team.expected ? Math.round(team.revenue / team.expected * 100) : 0;
    return `<article class="summary-card ${team.atRisk ? "attention" : ""}">
      <div class="card-heading"><div><strong>${escapeHtml(personName(team.supervisor))}</strong><small>${escapeHtml(amoebaName(team.amoeba))}</small></div><span class="pill ${team.atRisk ? "pending" : ""}">${team.atRisk ? `${team.atRisk} at risk` : "On track"}</span></div>
      <div class="card-kpis"><span><strong>${team.live}/${team.rows.length}</strong> live</span><span><strong>${money(team.cars)}</strong> cars</span><span><strong>${money(team.bikes)}</strong> bikes</span><span><strong>${team.alerts}</strong> alerts</span></div>
      <div class="progress-label"><span>${money(team.revenue)} vs ${money(team.expected)} target</span><strong>${progress}%</strong></div>
      <div class="progress-track"><span style="width:${Math.min(100, progress)}%"></span></div>
    </article>`;
  }).join("") : '<div class="empty">No teams are visible in this Manager scope.</div>';
}

function renderEscalations() {
  const queue = state.escalations;
  if (!queue) return;
  const totalActionable = queue.counts.escalated_alerts + queue.counts.open_incidents
    + queue.counts.overdue_inspections + queue.counts.missing_closeouts_today + queue.counts.open_maintenance_reports;
  el.escalationCount.textContent = totalActionable;
  el.escalationContext.textContent = `${queue.counts.escalated_alerts} alerts · ${queue.counts.open_incidents} incidents`;

  const summaryTiles = [
    ["Escalated alerts", queue.counts.escalated_alerts, queue.counts.escalated_alerts ? "metric-risk" : "metric-good"],
    ["Open incidents", queue.counts.open_incidents, queue.counts.high_severity_incidents_unacknowledged ? "metric-risk" : queue.counts.open_incidents ? "metric-unconfigured" : "metric-good"],
    ["Overdue inspections", queue.counts.overdue_inspections, queue.counts.overdue_inspections ? "metric-unconfigured" : "metric-good"],
    ["Missing closeouts", queue.counts.missing_closeouts_today, queue.counts.missing_closeouts_today ? "metric-unconfigured" : "metric-good"],
    ["Open maintenance", queue.counts.open_maintenance_reports, queue.counts.open_maintenance_reports ? "metric-unconfigured" : "metric-good"]
  ];
  el.escalationSummary.innerHTML = summaryTiles.map(([name, value, cls]) =>
    `<article class="${cls}"><span>${name}</span><strong>${value}</strong></article>`).join("");

  el.escalationList.innerHTML = queue.escalated_alerts.length ? queue.escalated_alerts.map((alert) => `
    <article class="data-row alert ${Number(alert.tier) >= 3 || alert.escalated_at ? "critical" : ""}">
      <div><strong>${escapeHtml(label(alert.alert_type))}</strong><small>${escapeHtml(personName(alert.person_id))} · ${escapeHtml(amoebaName(alert.amoeba_id))}</small></div>
      <div><span class="row-label">Tier</span><strong>Tier ${escapeHtml(alert.tier)}</strong><small>${alert.escalated_at ? "Escalated by supervisor" : "Auto tier escalation"}</small></div>
      <div><span class="row-label">Context</span><strong>${new Date(alert.fired_at).toLocaleString("en-NG")}</strong><small>${alert.deviation_reason_code ? `Reason: ${escapeHtml(label(alert.deviation_reason_code))} (${escapeHtml(alert.deviation_review_status || "pending")})` : "No operator reason yet"}</small></div>
      <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(label(alert.resolution_status))}</span></div>
      <div class="row-actions">
        ${["open", "escalated"].includes(alert.resolution_status) ? `<button data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>` : ""}
        <button class="secondary" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.alert_id)}">Resolve</button>
      </div>
    </article>`).join("") : '<div class="empty">No alerts currently require Manager attention.</div>';

  el.incidentList.innerHTML = queue.open_incidents.length ? queue.open_incidents.map((incident) => `
    <article class="data-row alert ${incident.severity === "high" ? "critical" : ""}">
      <div><strong>${escapeHtml(label(incident.incident_type))}</strong><small>${escapeHtml(personName(incident.person_id))} · ${escapeHtml(amoebaName(incident.amoeba_id))}</small></div>
      <div><span class="row-label">Severity</span><span class="pill ${incident.severity === "high" ? "pending" : ""}">${escapeHtml(incident.severity)}</span></div>
      <div><span class="row-label">Reported</span><strong>${new Date(incident.occurred_at).toLocaleString("en-NG")}</strong></div>
      <div><span class="pill ${escapeHtml(incident.status)}">${escapeHtml(label(incident.status))}</span></div>
      <div class="row-actions">
        <button data-incident-action="acknowledge" data-incident-id="${escapeHtml(incident.incident_id)}">Acknowledge</button>
        <button class="secondary" data-incident-action="resolve" data-incident-id="${escapeHtml(incident.incident_id)}">Resolve</button>
      </div>
    </article>`).join("") : '<div class="empty">No open incidents in scope.</div>';

  const followups = [
    ...queue.overdue_inspections.map((vehicle) => ({
      title: `${vehicle.plate} inspection ${vehicle.inspection_status === "never_inspected" ? "never done" : "overdue"}`,
      context: `${amoebaName(vehicle.amoeba_id)} · ${vehicle.vehicle_type}`,
      when: vehicle.last_inspected_at ? `Last ${new Date(vehicle.last_inspected_at).toLocaleDateString("en-NG")}` : "No inspection on record",
      pill: "pending", pillText: "Inspection"
    })),
    ...queue.missing_closeouts_today.map((row) => ({
      title: `${amoebaName(row.amoeba_id)} closeout missing`,
      context: `${row.active_operators} active operators`,
      when: "Due 19:00 WAT",
      pill: "pending", pillText: "Closeout"
    })),
    ...queue.open_maintenance_reports.map((report) => ({
      title: `${report.vehicle_plate} · ${label(report.category)}`,
      context: amoebaName(report.amoeba_id),
      when: `Reported ${new Date(report.created_at).toLocaleDateString("en-NG")}`,
      pill: "open", pillText: "Maintenance"
    }))
  ];
  el.fleetFollowups.innerHTML = followups.length ? followups.map((item) => `
    <article class="data-row">
      <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.context)}</small></div>
      <div><span class="row-label">Status</span><span class="pill ${item.pill}">${escapeHtml(item.pillText)}</span></div>
      <div><small>${escapeHtml(item.when)}</small></div>
      <div></div><div></div>
    </article>`).join("") : '<div class="empty">No fleet follow-ups outstanding.</div>';
}

function renderPnl() {
  const pnl = state.pnl;
  if (!pnl) return;
  el.grossPnl.textContent = money(pnl.totals.gross_pnl_ngn);
  el.pnlContext.textContent = `${pnl.period_start} → ${pnl.period_end}`;
  el.grossPnl.parentElement.classList.toggle("metric-risk", Number(pnl.totals.gross_pnl_ngn) < 0);
  el.grossPnl.parentElement.classList.toggle("metric-good", Number(pnl.totals.gross_pnl_ngn) >= 0);

  el.pnlTotals.innerHTML = [
    ["Net Earnings", money(pnl.totals.net_earnings_ngn), ""],
    ["Direct expenses", money(pnl.totals.direct_expenses_ngn), ""],
    ["Maintenance", money(pnl.totals.maintenance_costs_ngn), ""],
    ["Central costs", money(pnl.central_expenses_ngn), ""],
    ["Hourly P&L", pnl.totals.hourly_pnl_ngn === null ? "—" : `${money(pnl.totals.hourly_pnl_ngn)}/h`, Number(pnl.totals.hourly_pnl_ngn) < 0 ? "metric-risk" : "metric-good"]
  ].map(([name, value, cls]) => `<article class="${cls}"><span>${name}</span><strong>${value}</strong></article>`).join("");

  el.pnlList.innerHTML = pnl.amoebas.length ? pnl.amoebas.map((row) => {
    const negative = Number(row.gross_pnl_ngn) < 0;
    return `<article class="summary-card ${negative ? "critical" : "strong"}">
      <div class="card-heading"><div><strong>${escapeHtml(amoebaName(row.amoeba_id))}</strong><small>${row.operators_with_activity}/${row.active_operators} operators active · ${row.trips_completed} trips</small></div>
      <span class="pill ${negative ? "pending" : ""}">${negative ? "Loss-making" : "Profitable"}</span></div>
      <div class="card-kpis">
        <span><strong>${money(row.net_earnings_ngn)}</strong> Net Earnings</span>
        <span><strong>${money(row.direct_expenses_ngn + row.maintenance_costs_ngn)}</strong> direct costs</span>
        <span><strong>${money(row.central_allocation_ngn)}</strong> central share</span>
        <span><strong>${money(row.gross_pnl_ngn)}</strong> gross P&L</span>
      </div>
      <div class="progress-label"><span>${row.hourly_pnl_ngn === null ? "No hours recorded" : `${money(row.hourly_pnl_ngn)}/hour over ${row.hours_online}h`}</span><strong>${row.target_attainment_pct === null ? "—" : `${row.target_attainment_pct}% of target`}</strong></div>
      <div class="progress-track"><span style="width:${Math.min(100, Math.max(0, Number(row.target_attainment_pct || 0)))}%"></span></div>
    </article>`;
  }).join("") : '<div class="empty">No P&L rows for the selected period.</div>';

  el.expenseList.innerHTML = state.expenses.length ? state.expenses.slice(0, 12).map((expense) => `
    <article class="data-row">
      <div><strong>${escapeHtml(label(expense.category))}</strong><small>${escapeHtml(expense.description || "No description")}</small></div>
      <div><span class="row-label">Scope</span><strong>${expense.amoeba_id ? escapeHtml(amoebaName(expense.amoeba_id)) : "Central"}</strong></div>
      <div><span class="row-label">Date</span><strong>${escapeHtml(String(expense.expense_date).slice(0, 10))}</strong></div>
      <div><span class="row-label">Amount</span><strong>${money(expense.amount_ngn)}</strong></div>
      <div><span class="pill ${expense.allocation === "central" ? "acknowledged" : ""}">${escapeHtml(expense.allocation)}</span></div>
    </article>`).join("") : '<div class="empty">No expenses recorded for this period yet.</div>';
}

function renderLeaderboard() {
  const board = state.leaderboard;
  if (!board) return;
  el.leaderboardIntro.textContent = `Performance Score weights — acceptance ${Math.round(board.weights.acceptance_weight * 100)}%, time online ${Math.round(board.weights.online_weight * 100)}%, cash ${Math.round(board.weights.cash_weight * 100)}%, Net Earnings ${Math.round(board.weights.revenue_weight * 100)}%. Period ${board.period_start} → ${board.period_end}.`;
  const medals = { gold: "🥇", silver: "🥈", bronze: "🥉" };
  el.leaderboardList.innerHTML = board.entries.length ? board.entries.map((entry) => `
    <article class="data-row ${entry.rank <= 3 ? "alert" : ""}" style="${entry.rank <= 3 ? "border-left-color: var(--green);" : ""}">
      <div><strong>${entry.badge ? `${medals[entry.badge]} ` : `${entry.rank}. `}${escapeHtml(operatorName(entry.operator_id))}</strong><small>${escapeHtml(amoebaName(entry.amoeba_id))}${entry.vehicle_plate ? ` · ${escapeHtml(entry.vehicle_plate)}` : ""} · ${entry.days_worked} day${entry.days_worked === 1 ? "" : "s"} worked</small></div>
      <div><span class="row-label">Score</span><strong>${entry.performance_score}</strong><small>acceptance ${entry.components.acceptance_score} · online ${entry.components.time_online_score} · cash ${entry.components.cash_receipt_score}</small></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(entry.net_earnings_ngn)}</strong><small>${entry.trips_completed} trips · ${entry.hours_online}h online</small></div>
      <div><span class="row-label">Cash</span><strong>${money(entry.remitted_ngn)}</strong><small>${Number(entry.cash_shortfall_ngn) > 0 ? `${money(entry.cash_shortfall_ngn)} short` : "No shortfall"}</small></div>
      <div></div>
    </article>`).join("") : '<div class="empty">No operators had activity in the selected period.</div>';
}

function renderReports() {
  el.reportList.innerHTML = state.reports.length ? state.reports.map((report) => `
    <article class="data-row">
      <div><strong>${escapeHtml(String(report.record_date).slice(0, 10))}</strong><small>${escapeHtml(report.amoeba_id ? amoebaName(report.amoeba_id) : "Whole company")} · revision ${escapeHtml(report.revision)}</small></div>
      <div><span class="row-label">Operators</span><strong>${escapeHtml(report.summary?.live_operators || 0)} / ${escapeHtml(report.summary?.active_operators || 0)} live</strong></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(report.summary?.net_earnings_total_ngn ?? report.summary?.revenue_total_ngn)}</strong><small>Cars ${money(report.summary?.car_net_earnings_ngn ?? report.summary?.car_revenue_ngn)} · Bikes ${money(report.summary?.motorbike_net_earnings_ngn ?? report.summary?.motorbike_revenue_ngn)}</small></div>
      <div><span class="pill">${escapeHtml(report.status)}</span></div><div></div>
    </article>`).join("") : '<div class="empty">No scoped report snapshots exist for this date.</div>';
}

function render() {
  renderPortfolio();
  renderEscalations();
  renderPnl();
  renderLeaderboard();
  renderReports();
}

async function loadPnlAndLeaderboard() {
  const start = el.pnlStart.value || state.operatingDate;
  const end = el.pnlEnd.value || state.operatingDate;
  const [pnl, expenses, leaderboard] = await Promise.all([
    ops(`/ops/v1/pnl?period_start=${start}&period_end=${end}`),
    ops(`/ops/v1/expenses?period_start=${start}&period_end=${end}`),
    ops(`/ops/v1/leaderboard?period_start=${start}&period_end=${end}&sort=${state.leaderboardSort}`)
  ]);
  state.pnl = pnl;
  state.expenses = expenses.data;
  state.leaderboard = leaderboard;
}

async function refresh() {
  connection("", "Connecting");
  el.notice.classList.remove("error");
  el.notice.textContent = "Loading scoped Manager data...";
  const [people, amoebas, operators, allPerformance] = await Promise.all([
    foundation("/identity/v1/people"), foundation("/amoeba/v1/amoebas"), ops("/ops/v1/operators"), ops("/ops/v1/daily-performance")
  ]);
  const dates = [...new Set(allPerformance.data.map((item) => String(item.record_date).slice(0, 10)))].sort().reverse();
  const operatingDate = dates.includes(el.operatingDate.value) ? el.operatingDate.value : (dates[0] || el.operatingDate.value || today);
  el.operatingDate.value = operatingDate;
  state.operatingDate = operatingDate;
  if (!el.pnlStart.value) el.pnlStart.value = dates.length ? dates[Math.min(dates.length - 1, 6)] : operatingDate;
  if (!el.pnlEnd.value) el.pnlEnd.value = operatingDate;
  const expenseDate = el.expenseForm.querySelector('input[name="expense_date"]');
  if (!expenseDate.value) expenseDate.value = today;
  Object.assign(state, { people: people.data, amoebas: amoebas.data, operators: operators.data });
  el.expenseForm.querySelector('select[name="amoeba_id"]').innerHTML =
    state.amoebas.map((amoeba) => `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`).join("");

  const [board, alerts, reports, escalations] = await Promise.all([
    ops(`/ops/v1/team-board?record_date=${operatingDate}`), ops("/ops/v1/alerts"),
    ops(`/ops/v1/daily-reports?record_date=${operatingDate}`), ops("/ops/v1/escalations")
  ]);
  Object.assign(state, { board: board.data, alerts: alerts.data, reports: reports.data, escalations });
  await loadPnlAndLeaderboard();
  render();
  connection("connected", "Scoped APIs connected");
  el.notice.textContent = "Manager view is limited to active role assignments.";
}

let pendingAction = null;
document.addEventListener("click", (event) => {
  const alertButton = event.target.closest("[data-alert-action]");
  if (alertButton) {
    const alert = state.escalations?.escalated_alerts.find((item) => item.alert_id === alertButton.dataset.alertId)
      || state.alerts.find((item) => item.alert_id === alertButton.dataset.alertId);
    pendingAction = { kind: "alert", type: alertButton.dataset.alertAction, id: alert.alert_id };
    el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge escalation" : "Resolve escalation";
    el.dialogContext.textContent = `${label(alert.alert_type)} · ${personName(alert.person_id)}`;
    el.dialogNotes.value = "";
    el.actionDialog.showModal();
    return;
  }
  const incidentButton = event.target.closest("[data-incident-action]");
  if (incidentButton) {
    const incident = state.escalations?.open_incidents.find((item) => item.incident_id === incidentButton.dataset.incidentId);
    pendingAction = { kind: "incident", type: incidentButton.dataset.incidentAction, id: incident.incident_id };
    el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge incident" : "Resolve incident";
    el.dialogContext.textContent = `${label(incident.incident_type)} · ${personName(incident.person_id)}`;
    el.dialogNotes.value = "";
    el.actionDialog.showModal();
  }
});

el.actionDialog.addEventListener("close", async () => {
  if (el.actionDialog.returnValue !== "default" || !pendingAction) return;
  try {
    const notes = el.dialogNotes.value.trim();
    const path = pendingAction.kind === "alert"
      ? `/ops/v1/alerts/${pendingAction.id}/${pendingAction.type}`
      : `/ops/v1/incidents/${pendingAction.id}/${pendingAction.type}`;
    const payload = pendingAction.type === "resolve"
      ? { resolution_notes: notes || "Resolved by Manager." }
      : { note: notes };
    await ops(path, { method: "POST", headers: { "Idempotency-Key": key(`manager-${pendingAction.kind}-${pendingAction.type}`) }, body: JSON.stringify(payload) });
    await refresh();
  } catch (error) {
    showError(error);
  }
  pendingAction = null;
});

el.expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(el.expenseForm).entries());
  try {
    await ops("/ops/v1/expenses", {
      method: "POST",
      headers: { "Idempotency-Key": key("manager-expense") },
      body: JSON.stringify({
        expense_date: data.expense_date,
        allocation: data.allocation,
        amoeba_id: data.allocation === "central" ? null : data.amoeba_id,
        category: data.category,
        amount_ngn: Number(data.amount_ngn),
        description: data.description || null,
        evidence_reference: data.evidence_reference || null
      })
    });
    el.expenseForm.querySelector('input[name="amount_ngn"]').value = "";
    el.expenseForm.querySelector('input[name="description"]').value = "";
    await loadPnlAndLeaderboard();
    render();
    el.notice.textContent = "Expense saved and P&L recalculated.";
  } catch (error) {
    showError(error);
  }
});

document.getElementById("leaderboardSort").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button) return;
  state.leaderboardSort = button.dataset.sort;
  document.querySelectorAll("#leaderboardSort button").forEach((item) => item.classList.toggle("active", item === button));
  try {
    await loadPnlAndLeaderboard();
    renderLeaderboard();
  } catch (error) {
    showError(error);
  }
});

document.getElementById("loadPnl").addEventListener("click", async () => {
  try {
    await loadPnlAndLeaderboard();
    render();
    el.notice.textContent = "P&L recalculated for the selected period.";
  } catch (error) {
    showError(error);
  }
});

document.getElementById("exportPnlCsv").addEventListener("click", () => {
  if (!state.pnl) return;
  downloadCsv(`fleximotion-pnl-${state.pnl.period_start}-to-${state.pnl.period_end}.csv`, [
    ["amoeba", "active_operators", "trips_completed", "hours_online", "net_earnings_ngn", "direct_expenses_ngn",
      "maintenance_costs_ngn", "central_allocation_ngn", "transfer_credits_ngn", "transfer_charges_ngn",
      "gross_pnl_ngn", "hourly_pnl_ngn", "target_attainment_pct"],
    ...state.pnl.amoebas.map((row) => [
      amoebaName(row.amoeba_id), row.active_operators, row.trips_completed, row.hours_online,
      row.net_earnings_ngn, row.direct_expenses_ngn, row.maintenance_costs_ngn, row.central_allocation_ngn,
      row.transfer_price_credits_ngn, row.transfer_price_charges_ngn, row.gross_pnl_ngn,
      row.hourly_pnl_ngn ?? "", row.target_attainment_pct ?? ""
    ])
  ]);
});

document.getElementById("exportLeaderboardCsv").addEventListener("click", () => {
  if (!state.leaderboard) return;
  downloadCsv(`fleximotion-leaderboard-${state.leaderboard.period_start}-to-${state.leaderboard.period_end}.csv`, [
    ["rank", "operator", "amoeba", "vehicle_plate", "days_worked", "performance_score", "acceptance_score",
      "time_online_score", "cash_receipt_score", "revenue_score", "net_earnings_ngn", "trips_completed",
      "hours_online", "remitted_ngn", "cash_shortfall_ngn"],
    ...state.leaderboard.entries.map((entry) => [
      entry.rank, operatorName(entry.operator_id), amoebaName(entry.amoeba_id), entry.vehicle_plate || "",
      entry.days_worked, entry.performance_score, entry.components.acceptance_score, entry.components.time_online_score,
      entry.components.cash_receipt_score, entry.components.revenue_score ?? "", entry.net_earnings_ngn,
      entry.trips_completed, entry.hours_online, entry.remitted_ngn, entry.cash_shortfall_ngn
    ])
  ]);
});

document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
el.operatingDate.addEventListener("change", () => refresh().catch(showError));
function showError(error) { connection("error", "API error"); el.notice.textContent = error.message; el.notice.classList.add("error"); }
refresh().catch(showError);
