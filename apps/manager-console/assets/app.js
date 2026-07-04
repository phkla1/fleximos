const state = { people: [], amoebas: [], operators: [], board: [], alerts: [], reports: [], operatingDate: null };
const ids = ["connectionText", "operatingDate", "activeCount", "liveCount", "revenueTotal", "expectedTotal", "escalationCount", "notice", "updatedLabel", "teamPortfolio", "escalationList", "reportList", "actionDialog", "dialogTitle", "dialogContext", "dialogNotes"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const query = new URLSearchParams(location.search);
const opsBase = query.get("opsApiBase") || "http://127.0.0.1:4030";
const foundationBase = query.get("foundationApiBase") || "http://127.0.0.1:4010";
const token = query.get("token") || "flexi-dev-service-token";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
el.operatingDate.value = today;

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (value) => `₦${Number(value || 0).toLocaleString()}`;
const personName = (id) => state.people.find((item) => item.person_id === id)?.display_name || id || "Unassigned";
const amoebaName = (id) => state.amoebas.find((item) => item.amoeba_id === id)?.name || id || "Unassigned";
const key = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

function render() {
  const live = state.board.filter((item) => !["offline", "not_seen_today"].includes(item.current_status)).length;
  const revenue = state.board.reduce((sum, item) => sum + Number(item.net_earnings_ngn || 0), 0);
  const expected = state.board.reduce((sum, item) => sum + Number(item.expected_revenue_ngn || 0), 0);
  const escalations = state.alerts.filter((item) => item.resolution_status !== "resolved" && Number(item.tier || 0) >= 2);
  el.activeCount.textContent = state.board.length;
  el.liveCount.textContent = live;
  el.revenueTotal.textContent = money(revenue);
  el.expectedTotal.textContent = money(expected);
  el.escalationCount.textContent = escalations.length;
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

  el.escalationList.innerHTML = escalations.length ? escalations.map((alert) => `
    <article class="data-row alert ${Number(alert.tier) >= 3 ? "critical" : ""}">
      <div><strong>${escapeHtml(String(alert.alert_type).replaceAll("_", " "))}</strong><small>${escapeHtml(personName(alert.person_id))} · ${escapeHtml(amoebaName(alert.amoeba_id))}</small></div>
      <div><span class="row-label">Tier</span><strong>Tier ${escapeHtml(alert.tier)}</strong><small>${escapeHtml(alert.platform_display_name || "General")}</small></div>
      <div><span class="row-label">Fired</span><strong>${new Date(alert.fired_at).toLocaleString("en-NG")}</strong></div>
      <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(alert.resolution_status)}</span></div>
      <div class="row-actions">${alert.resolution_status === "open" ? `<button data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>` : ""}<button class="secondary" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.alert_id)}">Resolve</button></div>
    </article>`).join("") : '<div class="empty">No tier 2+ escalations currently require Manager attention.</div>';

  el.reportList.innerHTML = state.reports.length ? state.reports.map((report) => `
    <article class="data-row">
      <div><strong>${escapeHtml(String(report.record_date).slice(0, 10))}</strong><small>${escapeHtml(report.amoeba_id ? amoebaName(report.amoeba_id) : "Whole company")} · revision ${escapeHtml(report.revision)}</small></div>
      <div><span class="row-label">Operators</span><strong>${escapeHtml(report.summary?.live_operators || 0)} / ${escapeHtml(report.summary?.active_operators || 0)} live</strong></div>
      <div><span class="row-label">Net Earnings</span><strong>${money(report.summary?.net_earnings_total_ngn ?? report.summary?.revenue_total_ngn)}</strong><small>Cars ${money(report.summary?.car_net_earnings_ngn ?? report.summary?.car_revenue_ngn)} · Bikes ${money(report.summary?.motorbike_net_earnings_ngn ?? report.summary?.motorbike_revenue_ngn)}</small></div>
      <div><span class="pill">${escapeHtml(report.status)}</span></div><div></div>
    </article>`).join("") : '<div class="empty">No scoped report snapshots exist for this date.</div>';
}

async function refresh() {
  connection("", "Connecting");
  el.notice.textContent = "Loading scoped Manager data...";
  const [people, amoebas, operators, allPerformance] = await Promise.all([
    foundation("/identity/v1/people"), foundation("/amoeba/v1/amoebas"), ops("/ops/v1/operators"), ops("/ops/v1/daily-performance")
  ]);
  const dates = [...new Set(allPerformance.data.map((item) => String(item.record_date).slice(0, 10)))].sort().reverse();
  const operatingDate = dates.includes(el.operatingDate.value) ? el.operatingDate.value : (dates[0] || el.operatingDate.value || today);
  el.operatingDate.value = operatingDate;
  const [board, alerts, reports] = await Promise.all([
    ops(`/ops/v1/team-board?record_date=${operatingDate}`), ops("/ops/v1/alerts"), ops(`/ops/v1/daily-reports?record_date=${operatingDate}`)
  ]);
  Object.assign(state, { people: people.data, amoebas: amoebas.data, operators: operators.data, board: board.data, alerts: alerts.data, reports: reports.data, operatingDate });
  render();
  connection("connected", "Scoped APIs connected");
  el.notice.textContent = "Manager view is limited to active role assignments.";
}

let pendingAction = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alert-action]");
  if (!button) return;
  const alert = state.alerts.find((item) => item.alert_id === button.dataset.alertId);
  pendingAction = { type: button.dataset.alertAction, alert };
  el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge escalation" : "Resolve escalation";
  el.dialogContext.textContent = `${String(alert.alert_type).replaceAll("_", " ")} · ${personName(alert.person_id)}`;
  el.dialogNotes.value = "";
  el.actionDialog.showModal();
});
el.actionDialog.addEventListener("close", async () => {
  if (el.actionDialog.returnValue !== "default" || !pendingAction) return;
  try {
    const notes = el.dialogNotes.value.trim();
    await ops(`/ops/v1/alerts/${pendingAction.alert.alert_id}/${pendingAction.type}`, {
      method: "POST",
      headers: { "Idempotency-Key": key(`manager-${pendingAction.type}`) },
      body: JSON.stringify(pendingAction.type === "resolve" ? { resolution_notes: notes || "Resolved by Manager." } : { note: notes })
    });
    await refresh();
  } catch (error) {
    connection("error", "API error");
    el.notice.textContent = error.message;
    el.notice.classList.add("error");
  }
  pendingAction = null;
});
document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
el.operatingDate.addEventListener("change", () => refresh().catch(showError));
function showError(error) { connection("error", "API error"); el.notice.textContent = error.message; el.notice.classList.add("error"); }
refresh().catch(showError);
