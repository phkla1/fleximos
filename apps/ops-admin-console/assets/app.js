const state = {
  people: [],
  amoebas: [],
  sites: [],
  operators: [],
  vehicles: [],
  platformAccounts: [],
  alerts: [],
  teamBoard: [],
  dailyPerformance: [],
  ingestionRuns: [],
  paceProfiles: [],
  economicsPolicies: [],
  efficiencyPolicies: [],
  scheduledJobs: [],
  scheduledJobRuns: [],
  dailyReports: [],
  notificationDeliveries: [],
  teams: [],
  alertGroups: [],
  serviceHealth: null,
  operatingDate: null,
  jobFilter: ""
};

const el = Object.fromEntries(
  [
    "notice", "connectionText", "activeOperatorCount", "openAlertCount",
    "activeVehicleCount", "activePlatformCount", "alertList", "operatorList",
    "vehicleList", "operatorForm", "vehicleForm", "alertFilter", "opsApiBase",
    "foundationApiBase", "apiToken", "actionDialog", "dialogTitle",
    "dialogContext", "dialogNotes", "confirmActionButton", "teamBoard",
    "boardUpdated", "ingestionForm", "performanceRows", "ingestionRuns",
    "paceProfileForm", "paceProfileList", "efficiencyPolicyForm", "efficiencyPolicyList",
    "economicsPolicyForm", "economicsPolicyList",
    "leaderboardConfigForm", "leaderboardConfigSummary",
    "inspectionComplianceSummary", "inspectionComplianceList",
    "jobHealthSummary", "jobHealthMetrics", "scheduledJobList", "scheduledJobRuns",
    "jobFilterSummary", "rosterGapList",
    "dateFrom", "dateTo",
    "teamDialog", "teamDialogTitle", "teamDialogSummary", "teamOperatorList",
    "operatorSummaryCount", "vehicleSummaryCount", "performanceTeamFilter",
    "performanceOperatorFilter", "alertGroupDialog", "alertGroupDialogTitle",
    "alertGroupDialogSummary", "alertGroupList", "vehicleTeamFilter",
    "vehicleAmoebaFilter", "vehicleSearch", "vehicleFilterSummary",
    "operatorTeamFilter", "operatorAmoebaFilter", "operatorSearch",
    "operatorFilterSummary", "reportForm", "reportList", "reportDialog",
    "reportDialogTitle", "reportDialogSummary", "reportDialogRows"
  ].map((id) => [id, document.getElementById(id)])
);

const query = new URLSearchParams(location.search);
el.opsApiBase.value = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
el.foundationApiBase.value = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
el.apiToken.value = window.flexiServiceToken();

document.getElementById("todayLabel").textContent = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "full",
  timeZone: "Africa/Lagos"
}).format(new Date());
const todayLagos = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.ingestionForm.elements.record_date.value = todayLagos;
el.dateFrom.value = todayLagos;
el.dateTo.value = todayLagos;
el.paceProfileForm.elements.effective_from.value = todayLagos;
el.efficiencyPolicyForm.elements.effective_from.value = todayLagos;
el.economicsPolicyForm.elements.effective_from.value = todayLagos;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanize(value) {
  const text = String(value || "").replaceAll("_", " ");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function setNotice(message, error = false) {
  el.notice.textContent = message;
  el.notice.classList.toggle("error", error);
}

function setConnection(status, text) {
  const root = document.querySelector(".connection-status");
  root.classList.remove("connected", "error");
  if (status) root.classList.add(status);
  el.connectionText.textContent = text;
}

function key(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base.value.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${el.apiToken.value}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Request failed: ${response.status}`);
  return body;
}

const ops = (path, options) => request(el.opsApiBase, path, options);
const foundation = (path, options) => request(el.foundationApiBase, path, options);

function nameForPerson(id) {
  if (id === "unassigned") return "Unassigned supervisor";
  return state.people.find((person) => person.person_id === id)?.display_name || id || "Unassigned";
}

function nameForAmoeba(id) {
  if (id === "unassigned") return "Unassigned operating unit";
  return state.amoebas.find((amoeba) => amoeba.amoeba_id === id)?.name || id;
}

function nameForSite(id) {
  return state.sites.find((site) => site.site_id === id)?.name || id;
}

function optionHtml(items, valueKey, labelKey, selected = "", empty = "") {
  const blank = empty ? `<option value="">${empty}</option>` : "";
  return blank + items.map((item) =>
    `<option value="${escapeHtml(item[valueKey])}" ${item[valueKey] === selected ? "selected" : ""}>${escapeHtml(item[labelKey])}</option>`
  ).join("");
}

function renderOptions() {
  const people = optionHtml(state.people, "person_id", "display_name");
  const amoebas = optionHtml(state.amoebas, "amoeba_id", "name");
  el.operatorForm.elements.person_id.innerHTML = people;
  el.operatorForm.elements.supervisor_person_id.innerHTML = optionHtml(state.people, "person_id", "display_name", "", "Unassigned");
  el.operatorForm.elements.amoeba_id.innerHTML = amoebas;
  el.vehicleForm.elements.amoeba_id.innerHTML = amoebas;
  el.reportForm.elements.amoeba_id.innerHTML = `<option value="">Whole company</option>${amoebas}`;
  el.ingestionForm.elements.operator_id.innerHTML = operatorOptions(state.operators);
  updateSiteOptions();
  updateRegistrationOptions();
}

function operatorOptions(operators, empty = "") {
  const blank = empty ? `<option value="">${empty}</option>` : "";
  return blank + operators.map((operator) => {
    const platforms = operator.platform_registrations?.map((item) => item.platform_display_name).join(", ") || "No platform";
    return `<option value="${escapeHtml(operator.operator_id)}">${escapeHtml(nameForPerson(operator.person_id))} · ${escapeHtml(platforms)}</option>`;
  }).join("");
}

function updateSiteOptions() {
  const amoebaId = el.operatorForm.elements.amoeba_id.value;
  const sites = state.sites.filter((site) => site.amoeba_id === amoebaId && site.status === "active");
  el.operatorForm.elements.site_id.innerHTML = optionHtml(sites, "site_id", "name");
}

function updateRegistrationOptions() {
  const operator = state.operators.find((item) => item.operator_id === el.ingestionForm.elements.operator_id.value);
  const registrations = operator?.platform_registrations || [];
  el.ingestionForm.elements.registration_id.innerHTML = registrations.map((item) =>
    `<option value="${escapeHtml(item.registration_id)}">${escapeHtml(item.platform_display_name)} · ${escapeHtml(item.platform_operator_id)}</option>`
  ).join("");
}

function updatePerformanceFilters() {
  const previousTeam = el.performanceTeamFilter.value;
  const previousOperator = el.performanceOperatorFilter.value;
  el.performanceTeamFilter.innerHTML = `<option value="">Select a team</option>` + state.teams.map((team) =>
    `<option value="${escapeHtml(team.teamKey)}">${escapeHtml(nameForPerson(team.supervisorId))} · ${escapeHtml(nameForAmoeba(team.amoebaId))} (${team.operators.length})</option>`
  ).join("");
  if (state.teams.some((team) => team.teamKey === previousTeam)) el.performanceTeamFilter.value = previousTeam;

  const selectedTeam = state.teams.find((team) => team.teamKey === el.performanceTeamFilter.value);
  const operatorIds = new Set(selectedTeam?.operators.map((item) => item.operator_id) || []);
  const operators = selectedTeam ? state.operators.filter((operator) => operatorIds.has(operator.operator_id)) : [];
  el.performanceOperatorFilter.innerHTML = operatorOptions(operators, selectedTeam ? "All operators in team" : "Select a team first");
  if (operators.some((operator) => operator.operator_id === previousOperator)) el.performanceOperatorFilter.value = previousOperator;
}

function updateVehicleFilters() {
  const previousTeam = el.vehicleTeamFilter.value;
  const previousAmoeba = el.vehicleAmoebaFilter.value;
  el.vehicleTeamFilter.innerHTML = `<option value="">Select a team</option>` + state.teams.map((team) =>
    `<option value="${escapeHtml(team.teamKey)}">${escapeHtml(nameForPerson(team.supervisorId))} · ${escapeHtml(nameForAmoeba(team.amoebaId))}</option>`
  ).join("");
  if (state.teams.some((team) => team.teamKey === previousTeam)) el.vehicleTeamFilter.value = previousTeam;

  el.vehicleAmoebaFilter.innerHTML = `<option value="">Select an amoeba</option>` + state.amoebas.map((amoeba) =>
    `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`
  ).join("") + `<option value="__all">All operating units</option>`;
  if (previousAmoeba === "__all" || state.amoebas.some((amoeba) => amoeba.amoeba_id === previousAmoeba)) el.vehicleAmoebaFilter.value = previousAmoeba;
}

function updateOperatorFilters() {
  const previousTeam = el.operatorTeamFilter.value;
  const previousAmoeba = el.operatorAmoebaFilter.value;
  el.operatorTeamFilter.innerHTML = `<option value="">Select a team</option>` + state.teams.map((team) =>
    `<option value="${escapeHtml(team.teamKey)}">${escapeHtml(nameForPerson(team.supervisorId))} · ${escapeHtml(nameForAmoeba(team.amoebaId))}</option>`
  ).join("");
  if (state.teams.some((team) => team.teamKey === previousTeam)) el.operatorTeamFilter.value = previousTeam;

  el.operatorAmoebaFilter.innerHTML = `<option value="">Select an amoeba</option>` + state.amoebas.map((amoeba) =>
    `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`
  ).join("") + `<option value="__all">All operating units</option>`;
  if (previousAmoeba === "__all" || state.amoebas.some((amoeba) => amoeba.amoeba_id === previousAmoeba)) el.operatorAmoebaFilter.value = previousAmoeba;
}

function syncPaceProfileForm() {
  const type = el.paceProfileForm.elements.vehicle_type.value;
  const profile = state.paceProfiles
    .filter((item) => item.vehicle_type === type && item.day_type === "all")
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  if (!profile) return;
  const checkpoints = Object.fromEntries(profile.checkpoints.map((point) => [point.time, point.expected_pct]));
  el.paceProfileForm.elements.daily_target_ngn.value = Number(profile.daily_target_ngn);
  el.paceProfileForm.elements.noon_pct.value = Number(checkpoints["12:00"] ?? 0);
  el.paceProfileForm.elements.afternoon_pct.value = Number(checkpoints["16:00"] ?? 0);
  el.paceProfileForm.elements.evening_pct.value = Number(checkpoints["19:00"] ?? 0);
  el.paceProfileForm.elements.warning_tolerance_pct.value = Number(profile.warning_tolerance_pct);
  el.paceProfileForm.elements.critical_tolerance_pct.value = Number(profile.critical_tolerance_pct);
  el.paceProfileForm.elements.effective_from.value = String(profile.effective_from).slice(0, 10);
}

function policyStatus(policy, peers) {
  const today = state.operatingDate || todayLagos;
  const from = String(policy.effective_from).slice(0, 10);
  const to = policy.effective_to ? String(policy.effective_to).slice(0, 10) : null;
  if (from > today) return "scheduled";
  if (to && to < today) return "superseded";
  const newer = peers.some((peer) => peer !== policy &&
    String(peer.effective_from).slice(0, 10) > from &&
    String(peer.effective_from).slice(0, 10) <= today);
  return newer ? "superseded" : "active";
}

function effectiveWindow(policy) {
  const from = String(policy.effective_from).slice(0, 10);
  return policy.effective_to ? `${from} → ${String(policy.effective_to).slice(0, 10)}` : `from ${from}`;
}

function currentEfficiencyPolicy(vehicleType) {
  return state.efficiencyPolicies
    .filter((policy) => policy.vehicle_type === vehicleType && String(policy.effective_from).slice(0, 10) <= (state.operatingDate || todayLagos))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
}

function syncEfficiencyPolicyForm() {
  const form = el.efficiencyPolicyForm.elements;
  const policy = currentEfficiencyPolicy(form.vehicle_type.value);
  if (!policy) return;
  form.make_model.value = policy.make_model || "";
  form.standard_daily_fuel_quantity.value = Number(policy.standard_daily_fuel_quantity);
  form.expected_distance_km.value = Number(policy.expected_distance_km);
  form.allowed_variance_pct.value = Number(policy.allowed_variance_pct);
}

function syncEconomicsPolicyForm() {
  const policy = state.economicsPolicies
    .filter((item) => String(item.effective_from).slice(0, 10) <= (state.operatingDate || todayLagos))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  if (!policy) return;
  const form = el.economicsPolicyForm.elements;
  form.policy_name.value = policy.policy_name;
  form.admin_staff_daily_cost_ngn.value = Number(policy.admin_staff_daily_cost_ngn);
  form.operator_labour_share_pct.value = Number(policy.operator_labour_share_pct);
  form.daily_overhead_ngn.value = Number(policy.daily_overhead_ngn);
  form.expected_hours_per_operator.value = Number(policy.expected_hours_per_operator);
}

function render() {
  el.activeOperatorCount.textContent = state.operators.filter((item) => item.operator_status === "active").length;
  el.openAlertCount.textContent = state.alerts.filter((item) => item.resolution_status === "open").length;
  el.activeVehicleCount.textContent = state.vehicles.filter((item) => item.status === "active").length;
  el.activePlatformCount.textContent = state.platformAccounts.filter((item) => item.is_active).length;
  el.operatorSummaryCount.textContent = state.operators.filter((item) => item.operator_status === "active").length;
  el.vehicleSummaryCount.textContent = state.vehicles.filter((item) => item.status === "active").length;
  renderOptions();
  el.boardUpdated.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

  const teams = [...state.teamBoard.reduce((groups, item) => {
    const assignment = state.operators.find((operator) => operator.operator_id === item.operator_id);
    const supervisorId = assignment?.supervisor_person_id || "unassigned";
    const amoebaId = assignment?.amoeba_id || item.amoeba_id || "unassigned";
    const teamKey = `${supervisorId}:${amoebaId}`;
    if (!groups.has(teamKey)) groups.set(teamKey, { teamKey, supervisorId, amoebaId, operators: [] });
    groups.get(teamKey).operators.push(item);
    return groups;
  }, new Map()).values()].map((team) => {
    const totals = team.operators.reduce((sum, operator) => {
      const type = operator.vehicle_type || operator.platforms.find((platform) => platform.vehicle_type)?.vehicle_type;
      const revenue = Number(operator.ride_revenue_ngn || 0);
      sum.revenue += revenue;
      sum.target += Number(operator.daily_revenue_target_ngn || 0);
      sum.expected += Number(operator.expected_revenue_ngn || 0);
      sum.alerts += Number(operator.open_alerts || 0);
      sum.live += ["offline", "not_seen_today"].includes(operator.current_status) ? 0 : 1;
      sum.atRisk += ["behind", "at_risk"].includes(operator.pace_status) || Number(operator.open_alerts) > 0 ? 1 : 0;
      if (type === "car") sum.carRevenue += revenue;
      if (type === "motorbike") sum.bikeRevenue += revenue;
      return sum;
    }, { revenue: 0, carRevenue: 0, bikeRevenue: 0, target: 0, expected: 0, alerts: 0, live: 0, atRisk: 0 });
    return { ...team, ...totals };
  }).sort((a, b) => b.atRisk - a.atRisk || b.alerts - a.alerts || a.supervisorId.localeCompare(b.supervisorId));

  el.teamBoard.innerHTML = teams.length ? teams.map((team) => {
    const progress = team.expected ? Math.min(130, Math.round(team.revenue / team.expected * 100)) : 0;
    const status = team.alerts || team.atRisk ? "attention" : "on-track";
    return `
      <article class="team-summary status-${status}">
        <div class="team-heading">
          <div><strong>${escapeHtml(nameForPerson(team.supervisorId))}</strong><small>${escapeHtml(nameForAmoeba(team.amoebaId))}</small></div>
          <span class="risk-badge">${team.atRisk ? `${team.atRisk} at risk` : "on track"}</span>
        </div>
        <div class="team-kpis">
          <span><strong>${team.live}/${team.operators.length}</strong> live</span>
          <span><strong>₦${team.carRevenue.toLocaleString()}</strong> cars</span>
          <span><strong>₦${team.bikeRevenue.toLocaleString()}</strong> bikes</span>
          <span><strong>${team.alerts}</strong> alerts</span>
        </div>
        <div class="progress-label"><span>Revenue ₦${team.revenue.toLocaleString()} · Expected ₦${team.expected.toLocaleString()}</span><strong>${progress}%</strong></div>
        <div class="progress-track"><span style="width:${Math.min(100, progress)}%"></span></div>
        <button type="button" class="secondary team-open" data-open-team="${escapeHtml(team.teamKey)}">Open team</button>
      </article>`;
  }).join("") : `<div class="empty">No active teams match this view.</div>`;
  state.teams = teams;
  updatePerformanceFilters();
  updateVehicleFilters();
  updateOperatorFilters();

  const filter = el.alertFilter.value;
  const alerts = filter ? state.alerts.filter((alert) => alert.resolution_status === filter) : state.alerts;
  const activeOperatorTotal = state.operators.filter((operator) => operator.operator_status === "active").length;
  const alertGroups = [...alerts.reduce((groups, alert) => {
    const key = alert.alert_type;
    if (!groups.has(key)) groups.set(key, { key, alerts: [], people: new Set(), teams: new Set(), highestTier: 0 });
    const group = groups.get(key);
    const assignment = state.operators.find((operator) => operator.operator_id === alert.operator_id);
    group.alerts.push(alert);
    group.people.add(alert.person_id);
    group.teams.add(`${assignment?.supervisor_person_id || "unassigned"}:${assignment?.amoeba_id || alert.amoeba_id || "unassigned"}`);
    group.highestTier = Math.max(group.highestTier, Number(alert.tier || 0));
    return groups;
  }, new Map()).values()].sort((a, b) => b.highestTier - a.highestTier || b.people.size - a.people.size);
  state.alertGroups = alertGroups;
  el.alertList.innerHTML = alertGroups.length ? alertGroups.map((group) => `
    <article class="alert-group tier-${escapeHtml(group.highestTier)}">
      <div><strong>${escapeHtml(humanize(group.key))}</strong><small>${group.teams.size} affected ${group.teams.size === 1 ? "team" : "teams"} · highest tier ${group.highestTier}</small></div>
      <div class="alert-group-count"><strong>${group.people.size}/${activeOperatorTotal}</strong><small>active operators affected</small></div>
      <div><strong>${group.alerts.length}</strong><small>${filter || "matching"} alerts</small></div>
      <button type="button" class="secondary" data-open-alert-group="${escapeHtml(group.key)}">View affected operators</button>
    </article>
  `).join("") : `<div class="empty">No alerts match this view.</div>`;

  const selectedOperatorTeam = state.teams.find((team) => team.teamKey === el.operatorTeamFilter.value);
  const selectedOperatorAmoeba = el.operatorAmoebaFilter.value;
  const operatorQuery = el.operatorSearch.value.trim().toLowerCase();
  const rosterOperatorIds = new Set(selectedOperatorTeam?.operators.map((item) => item.operator_id) || []);
  const hasOperatorScope = Boolean(selectedOperatorTeam || selectedOperatorAmoeba || operatorQuery);
  const currentOperators = hasOperatorScope ? state.operators.filter((operator) => {
    if (["inactive", "suspended"].includes(operator.operator_status)) return false;
    if (selectedOperatorTeam && !rosterOperatorIds.has(operator.operator_id)) return false;
    if (!selectedOperatorTeam && selectedOperatorAmoeba && selectedOperatorAmoeba !== "__all" && operator.amoeba_id !== selectedOperatorAmoeba) return false;
    const platforms = operator.platform_registrations?.map((item) => item.platform_display_name).join(" ") || "";
    const searchable = `${nameForPerson(operator.person_id)} ${operator.vehicle_plate || ""} ${platforms}`.toLowerCase();
    if (operatorQuery && !searchable.includes(operatorQuery)) return false;
    return true;
  }) : [];
  el.operatorFilterSummary.textContent = hasOperatorScope
    ? `${currentOperators.length} matching active ${currentOperators.length === 1 ? "operator" : "operators"}`
    : "Select a team or amoeba, or search by name or vehicle.";
  el.operatorList.innerHTML = currentOperators.length ? currentOperators.map((operator) => `
    <article class="data-row" data-operator-id="${escapeHtml(operator.operator_id)}">
      <div><strong>${escapeHtml(nameForPerson(operator.person_id))}</strong><small>${escapeHtml(operator.operator_id)}</small></div>
      <div><span class="row-label">Assignment</span><strong>${escapeHtml(nameForAmoeba(operator.amoeba_id))}</strong><small>${escapeHtml(nameForSite(operator.site_id))}</small></div>
      <div><span class="row-label">Vehicle</span><strong>${escapeHtml(operator.vehicle_plate || "No vehicle")}</strong><small>Target ₦${Number(operator.daily_revenue_target_ngn || 0).toLocaleString()}</small></div>
      <div><span class="row-label">Platforms</span><strong>${operator.platform_registrations.length}</strong><small>${operator.platform_registrations.map((item) => item.platform_display_name).join(", ") || "Not registered"}</small></div>
      <div class="row-actions">
        <select aria-label="Operator status" data-operator-status>
          ${["pending_activation", "active", "inactive", "suspended"].map((value) => `<option value="${value}" ${value === operator.operator_status ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <button type="button" data-save-operator="${escapeHtml(operator.operator_id)}">Save</button>
        <button type="button" class="secondary" data-register-operator="${escapeHtml(operator.operator_id)}">Add platform</button>
      </div>
    </article>
  `).join("") : `<div class="empty">${hasOperatorScope ? "No operators match this scope." : "Choose a roster scope to view operators."}</div>`;

  const selectedVehicleTeam = state.teams.find((team) => team.teamKey === el.vehicleTeamFilter.value);
  const selectedVehicleAmoeba = el.vehicleAmoebaFilter.value;
  const vehicleQuery = el.vehicleSearch.value.trim().toLowerCase();
  const teamVehicleIds = new Set();
  const teamVehiclePlates = new Set();
  if (selectedVehicleTeam) {
    const teamOperatorIds = new Set(selectedVehicleTeam.operators.map((item) => item.operator_id));
    state.operators.filter((operator) => teamOperatorIds.has(operator.operator_id)).forEach((operator) => {
      if (operator.vehicle_id) teamVehicleIds.add(operator.vehicle_id);
      if (operator.vehicle_plate) teamVehiclePlates.add(operator.vehicle_plate);
    });
  }
  const hasVehicleScope = Boolean(selectedVehicleTeam || selectedVehicleAmoeba || vehicleQuery);
  const currentVehicles = hasVehicleScope ? state.vehicles.filter((vehicle) => {
    if (vehicle.status !== "active") return false;
    if (selectedVehicleTeam && !teamVehicleIds.has(vehicle.vehicle_id) && !teamVehiclePlates.has(vehicle.plate)) return false;
    if (!selectedVehicleTeam && selectedVehicleAmoeba && selectedVehicleAmoeba !== "__all" && vehicle.amoeba_id !== selectedVehicleAmoeba) return false;
    if (vehicleQuery && !`${vehicle.plate} ${vehicle.make_model || ""}`.toLowerCase().includes(vehicleQuery)) return false;
    return true;
  }) : [];
  el.vehicleFilterSummary.textContent = hasVehicleScope
    ? `${currentVehicles.length} matching active ${currentVehicles.length === 1 ? "vehicle" : "vehicles"}`
    : "Select a team or amoeba, or search by plate or model.";
  el.vehicleList.innerHTML = currentVehicles.length ? currentVehicles.map((vehicle) => `
    <article class="data-row">
      <div><strong>${escapeHtml(vehicle.plate)}</strong><small>${escapeHtml(vehicle.vehicle_id)}</small></div>
      <div><span class="row-label">Type</span><strong>${escapeHtml(vehicle.vehicle_type)}</strong><small>${escapeHtml(vehicle.make_model || "Model not set")}</small></div>
      <div><span class="row-label">Amoeba</span><strong>${escapeHtml(nameForAmoeba(vehicle.amoeba_id))}</strong><small>${escapeHtml(vehicle.color || "Colour not set")}</small></div>
      <div><span class="pill">${escapeHtml(vehicle.status)}</span></div>
      <div></div>
    </article>
  `).join("") : `<div class="empty">${hasVehicleScope ? "No vehicles match this scope." : "Choose a fleet scope to view vehicles."}</div>`;

  const selectedTeam = el.performanceTeamFilter.value;
  const selectedOperator = el.performanceOperatorFilter.value;
  const team = state.teams.find((item) => item.teamKey === selectedTeam);
  const teamOperatorIds = new Set(team?.operators.map((item) => item.operator_id) || []);
  const performance = selectedTeam ? state.dailyPerformance.filter((record) =>
    teamOperatorIds.has(record.operator_id) &&
    (!selectedOperator || record.operator_id === selectedOperator)
  ) : [];
  const recordRows = performance.map((record) => `
    <tr>
      <td>${escapeHtml(nameForPerson(record.person_id))}</td>
      <td>${escapeHtml(record.platform_display_name)}</td>
      <td>${escapeHtml(record.trips_completed)} / ${escapeHtml(record.trips_total)}</td>
      <td>₦${Number(record.ride_revenue_ngn).toLocaleString()}</td>
      <td>${Number(record.hours_online).toFixed(1)}</td>
      <td><span class="pill">${escapeHtml(record.current_status)}</span></td>
      <td><span class="quality ${escapeHtml(record.data_quality)}">${escapeHtml(record.data_quality)}</span></td>
    </tr>
  `);
  // Operators in the selected scope with no record for the operating date are
  // listed explicitly so a short table is never mistaken for full coverage.
  const coveredIds = new Set(performance.map((record) => record.operator_id));
  const missingRows = selectedTeam
    ? state.operators
        .filter((operator) => teamOperatorIds.has(operator.operator_id) && operator.operator_status === "active")
        .filter((operator) => (!selectedOperator || operator.operator_id === selectedOperator) && !coveredIds.has(operator.operator_id))
        .map((operator) => `
          <tr class="missing-record">
            <td>${escapeHtml(nameForPerson(operator.person_id))}</td>
            <td colspan="6">No performance record ${state.dateFrom === state.dateTo ? `for ${escapeHtml(state.dateTo)}` : `between ${escapeHtml(state.dateFrom)} and ${escapeHtml(state.dateTo)}`} — not reported by any platform feed or manual entry.</td>
          </tr>
        `)
    : [];
  el.performanceRows.innerHTML = recordRows.length || missingRows.length
    ? recordRows.join("") + missingRows.join("")
    : `<tr><td colspan="7" class="empty">${selectedTeam ? "No active operators in this team." : "Choose a team to view its record coverage, then an operator for detail."}</td></tr>`;

  el.ingestionRuns.innerHTML = state.ingestionRuns.length ? state.ingestionRuns.slice(0, 6).map((run) => `
    <article class="data-row run-row">
      <div><strong>${escapeHtml(run.platform_display_name)}</strong><small>${escapeHtml(run.ingestion_run_id)}</small></div>
      <div><span class="row-label">Date</span><strong>${escapeHtml(run.record_date)}</strong><small>${escapeHtml(run.source)}</small></div>
      <div><span class="row-label">Records</span><strong>${escapeHtml(run.records_upserted)} accepted</strong><small>${escapeHtml(run.records_rejected)} rejected</small></div>
      <div><span class="pill ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></div>
    </article>
  `).join("") : `<div class="empty">No ingestion runs yet.</div>`;

  el.paceProfileList.innerHTML = state.paceProfiles.map((profile) => `
    <article class="policy-row">
      <div><strong>${escapeHtml(profile.vehicle_type)}</strong><small>Target ₦${Number(profile.daily_target_ngn).toLocaleString()}</small></div>
      <div><strong>${profile.checkpoints.map((point) => `${point.time} ${point.expected_pct}%`).join(" · ")}</strong><small>Warn ${profile.warning_tolerance_pct}% · Critical ${profile.critical_tolerance_pct}%</small></div>
    </article>
  `).join("") || `<div class="empty">No pace profiles configured.</div>`;

  el.efficiencyPolicyList.innerHTML = state.efficiencyPolicies.map((policy) => {
    const peers = state.efficiencyPolicies.filter((peer) => peer.vehicle_type === policy.vehicle_type);
    const status = policyStatus(policy, peers);
    return `
    <article class="policy-row ${status}">
      <div><strong>${escapeHtml(policy.vehicle_type)}</strong><small>${escapeHtml(policy.make_model || "All models")}</small><span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><strong>${Number(policy.standard_daily_fuel_quantity)} ${escapeHtml(policy.fuel_unit)} → ${Number(policy.expected_distance_km)} km</strong><small>Allowed variance ±${Number(policy.allowed_variance_pct)}% · Effective ${escapeHtml(effectiveWindow(policy))}</small></div>
    </article>`;
  }).join("") || `<div class="empty">No efficiency policies configured.</div>`;

  el.economicsPolicyList.innerHTML = state.economicsPolicies.map((policy) => {
    const status = policyStatus(policy, state.economicsPolicies);
    return `
    <article class="policy-row ${status}">
      <div><strong>${escapeHtml(policy.policy_name)}</strong><small>Effective ${escapeHtml(effectiveWindow(policy))}</small><span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><strong>₦${Number(policy.admin_staff_daily_cost_ngn).toLocaleString()} fixed + ${Number(policy.operator_labour_share_pct)}% operators</strong><small>Overhead ₦${Number(policy.daily_overhead_ngn).toLocaleString()} · ${Number(policy.expected_hours_per_operator)}h/operator</small></div>
    </article>`;
  }).join("") || `<div class="empty">No economics policies configured.</div>`;

  const config = state.leaderboardConfig;
  el.leaderboardConfigSummary.innerHTML = config ? `
    <article class="policy-row">
      <div><strong>Performance Score weights</strong><small>Default timeline: ${escapeHtml(String(config.default_timeline).replaceAll("_", " "))}</small></div>
      <div><strong>Acceptance ${Math.round(config.acceptance_weight * 100)}% · Online ${Math.round(config.online_weight * 100)}% · Cash ${Math.round(config.cash_weight * 100)}% · Earnings ${Math.round(config.revenue_weight * 100)}%</strong><small>${config.company_wide_visible ? "Company-wide board visible to operators" : "Operators see within-amoeba board only"}</small></div>
    </article>` : `<div class="empty">Leaderboard configuration unavailable.</div>`;

  const compliance = state.inspectionCompliance;
  if (compliance) {
    el.inspectionComplianceSummary.textContent = compliance.compliance_pct === null
      ? "No active vehicles registered."
      : `${compliance.compliance_pct}% compliant · ${compliance.current} current · ${compliance.overdue} overdue of ${compliance.total_active_vehicles} active vehicles.`;
    el.inspectionComplianceList.innerHTML = compliance.vehicles.length ? compliance.vehicles.map((vehicle) => `
      <article class="data-row run-row">
        <div><strong>${escapeHtml(vehicle.plate)}</strong><small>${escapeHtml(nameForAmoeba(vehicle.amoeba_id))} · ${escapeHtml(vehicle.vehicle_type)}</small></div>
        <div><span class="row-label">Last inspected</span><strong>${vehicle.last_inspected_at ? new Date(vehicle.last_inspected_at).toLocaleString("en-NG") : "Never"}</strong></div>
        <div><span class="pill ${vehicle.inspection_status === "current" ? "" : "open"}">${escapeHtml(vehicle.inspection_status.replaceAll("_", " "))}</span></div>
        <div></div>
      </article>
    `).join("") : `<div class="empty">No active vehicles registered.</div>`;
  }

  const attention = state.scheduledJobs.filter((job) => ["failed", "stale"].includes(job.freshness_status)).length;
  const pending = state.scheduledJobs.filter((job) => job.freshness_status === "pending_source").length;
  const queued = state.scheduledJobRuns.filter((run) => ["queued", "running", "retrying"].includes(run.status)).length;
  const operatorsWithoutVehicle = state.operators.filter((operator) =>
    operator.operator_status === "active" && !operator.vehicle_id && !operator.vehicle_plate);
  el.jobHealthSummary.textContent = `${state.scheduledJobs.length} registered jobs`;
  el.jobHealthMetrics.innerHTML = `
    <button type="button" data-job-filter="healthy" title="Show these jobs"><span>Healthy / provisional</span><strong>${state.scheduledJobs.length - attention - pending}</strong></button>
    <button type="button" data-job-filter="attention" title="Show these jobs"><span>Attention required</span><strong>${attention}</strong></button>
    <button type="button" data-job-filter="pending" title="Show these jobs"><span>Pending source</span><strong>${pending}</strong></button>
    <button type="button" data-job-filter="__runs" title="Show recent runs"><span>Queued or running</span><strong>${queued}</strong></button>
    <button type="button" data-job-filter="__gaps" title="Show operators without a vehicle" class="${operatorsWithoutVehicle.length ? "attention" : ""}"><span>Ops without vehicle</span><strong>${operatorsWithoutVehicle.length}</strong></button>`;

  el.rosterGapList.innerHTML = operatorsWithoutVehicle.length ? operatorsWithoutVehicle.map((operator) => `
    <article class="data-row run-row">
      <div><strong>${escapeHtml(nameForPerson(operator.person_id))}</strong><small>${escapeHtml(operator.operator_type)}</small></div>
      <div><span class="row-label">Assignment</span><strong>${escapeHtml(nameForAmoeba(operator.amoeba_id))}</strong><small>${escapeHtml(nameForSite(operator.site_id))}</small></div>
      <div><span class="row-label">Supervisor</span><strong>${escapeHtml(nameForPerson(operator.supervisor_person_id))}</strong></div>
      <div><span class="pill open">No vehicle</span></div>
    </article>
  `).join("") : `<div class="empty">Every active operator has an assigned vehicle.</div>`;

  const jobMatchesFilter = (job) => {
    if (state.jobFilter === "attention") return ["failed", "stale"].includes(job.freshness_status);
    if (state.jobFilter === "pending") return job.freshness_status === "pending_source";
    if (state.jobFilter === "healthy") return !["failed", "stale", "pending_source"].includes(job.freshness_status);
    return true;
  };
  const visibleJobs = state.scheduledJobs.filter(jobMatchesFilter);
  el.jobFilterSummary.innerHTML = state.jobFilter && !state.jobFilter.startsWith("__")
    ? `Showing ${visibleJobs.length} of ${state.scheduledJobs.length} jobs (${escapeHtml(state.jobFilter)}). <button type="button" class="linklike" data-job-filter="">Show all</button>`
    : "";
  el.scheduledJobList.innerHTML = visibleJobs.map((job) => `
    <article class="job-row">
      <div><strong>${escapeHtml(job.job_name)}</strong><small>${escapeHtml(job.owning_module)} · ${escapeHtml(job.queue_name)}</small></div>
      <div><span class="row-label">Schedule</span><strong>${escapeHtml(job.schedule_wat)}</strong><small>SLA ${escapeHtml(job.freshness_sla_minutes)} min</small></div>
      <div><span class="row-label">Last success</span><strong>${job.last_success_at ? new Date(job.last_success_at).toLocaleString("en-NG") : "No successful run"}</strong><small>${job.current_lag_minutes === null ? "Lag unavailable" : `${escapeHtml(job.current_lag_minutes)} min lag`}</small></div>
      <div><span class="pill ${escapeHtml(job.freshness_status)}">${escapeHtml(job.freshness_status.replaceAll("_", " "))}</span><small>${escapeHtml(job.source_finality.replaceAll("_", " "))} source</small></div>
      <div class="row-actions"><button type="button" data-replay-job="${escapeHtml(job.job_name)}">Replay</button></div>
    </article>
  `).join("") || `<div class="empty">${state.jobFilter ? "No jobs match this state." : "No jobs registered."}</div>`;
  el.scheduledJobRuns.innerHTML = state.scheduledJobRuns.slice(0, 12).map((run) => `
    <article class="data-row run-row">
      <div><strong>${escapeHtml(run.job_name)}</strong><small>${escapeHtml(run.scheduled_job_run_id)}</small></div>
      <div><span class="row-label">Requested</span><strong>${new Date(run.created_at).toLocaleString("en-NG")}</strong><small>${escapeHtml(run.scheduler_trigger_id || "No trigger ID")}</small></div>
      <div><span class="row-label">Records</span><strong>${escapeHtml(run.records_upserted)} upserted</strong><small>${escapeHtml(run.records_rejected)} rejected</small></div>
      <div><span class="pill ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></div>
    </article>
  `).join("") || `<div class="empty">No scheduled job runs recorded.</div>`;

  el.reportList.innerHTML = state.dailyReports.length ? state.dailyReports.map((report) => {
    const summary = report.summary || {};
    return `
      <article class="report-row">
        <div><strong>${escapeHtml(String(report.record_date).slice(0, 10))}</strong><small>${escapeHtml(report.amoeba_id ? nameForAmoeba(report.amoeba_id) : "Whole company")} · revision ${escapeHtml(report.revision)}</small></div>
        <div><span class="row-label">Operators</span><strong>${escapeHtml(summary.live_operators || 0)} / ${escapeHtml(summary.active_operators || 0)} live</strong><small>${escapeHtml(summary.open_alerts || 0)} open alerts</small></div>
        <div><span class="row-label">Revenue</span><strong>₦${Number(summary.revenue_total_ngn || 0).toLocaleString()}</strong><small>Cars ₦${Number(summary.car_revenue_ngn || 0).toLocaleString()} · Bikes ₦${Number(summary.motorbike_revenue_ngn || 0).toLocaleString()}</small></div>
        <div><span class="pill">${escapeHtml(report.status)}</span><small>${new Date(report.generated_at).toLocaleString("en-NG")}</small></div>
        <div class="row-actions">
          <button type="button" class="secondary" data-open-report="${escapeHtml(report.report_id)}">Open report</button>
          <button type="button" class="secondary danger" data-delete-report="${escapeHtml(report.report_id)}">Delete</button>
        </div>
      </article>`;
  }).join("") : `<div class="empty">No report snapshot exists ${state.dateFrom === state.dateTo ? `for ${escapeHtml(state.dateTo)}` : `between ${escapeHtml(state.dateFrom)} and ${escapeHtml(state.dateTo)}`}.</div>`;
}

async function refresh(message = "Connected to Fleximotion Ops.") {
  setConnection("", "Connecting");
  setNotice("Loading operational data...");
  const [people, amoebas, sites, operators, vehicles, platformAccounts, alerts, allDailyPerformance, paceProfiles, economicsPolicies, efficiencyPolicies, scheduledJobs, scheduledJobRuns, notificationDeliveries, serviceHealth] = await Promise.all([
    foundation("/identity/v1/people"),
    foundation("/amoeba/v1/amoebas"),
    foundation("/amoeba/v1/sites"),
    ops("/ops/v1/operators"),
    ops("/ops/v1/vehicles"),
    ops("/ops/v1/platform-accounts"),
    ops("/ops/v1/alerts"),
    ops("/ops/v1/daily-performance"),
    ops("/ops/v1/revenue-pace-profiles"),
    ops("/ops/v1/economics-policies"),
    ops("/ops/v1/vehicle-efficiency-policies"),
    ops("/ops/v1/scheduled-jobs"),
    ops("/ops/v1/scheduled-job-runs"),
    ops("/ops/v1/notification-deliveries"),
    fetch(`${el.opsApiBase.value.replace(/\/$/, "")}/health`).then((response) => response.json())
  ]);
  const [leaderboardConfig, inspectionCompliance] = await Promise.all([
    ops("/ops/v1/leaderboard-config").catch(() => null),
    ops("/ops/v1/inspections/compliance").catch(() => null)
  ]);
  const availableDates = [...new Set(allDailyPerformance.data.map((record) => String(record.record_date).slice(0, 10)))].sort().reverse();
  let dateFrom = el.dateFrom.value || el.dateTo.value || todayLagos;
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  // If the chosen range has no performance data at all, snap to the most
  // recent day that does, so a fresh console never opens onto emptiness.
  const rangeHasData = availableDates.some((date) => date >= dateFrom && date <= dateTo);
  if (!rangeHasData && availableDates.length) {
    dateFrom = availableDates[0];
    dateTo = availableDates[0];
  }
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const operatingDate = dateTo;
  el.ingestionForm.elements.record_date.value = operatingDate;
  const [teamBoard, dailyPerformance, ingestionRuns, dailyReports, rangedAlerts] = await Promise.all([
    ops(`/ops/v1/team-board?${range}`),
    ops(`/ops/v1/daily-performance?${range}`),
    ops(`/ops/v1/ingestion-runs?${range}`),
    ops(`/ops/v1/daily-reports?${range}`),
    ops(`/ops/v1/alerts?${range}`)
  ]);
  Object.assign(state, {
    people: people.data,
    amoebas: amoebas.data,
    sites: sites.data,
    operators: operators.data,
    vehicles: vehicles.data,
    platformAccounts: platformAccounts.data,
    alerts: rangedAlerts.data,
    teamBoard: teamBoard.data,
    dailyPerformance: dailyPerformance.data,
    ingestionRuns: ingestionRuns.data,
    paceProfiles: paceProfiles.data,
    economicsPolicies: economicsPolicies.data,
    efficiencyPolicies: efficiencyPolicies.data,
    scheduledJobs: scheduledJobs.data,
    scheduledJobRuns: scheduledJobRuns.data,
    notificationDeliveries: notificationDeliveries.data,
    dailyReports: dailyReports.data,
    serviceHealth,
    leaderboardConfig,
    inspectionCompliance,
    operatingDate,
    dateFrom,
    dateTo
  });
  if (leaderboardConfig) {
    for (const field of ["acceptance_weight", "online_weight", "cash_weight", "revenue_weight"]) {
      el.leaderboardConfigForm.elements[field].value = Number(leaderboardConfig[field]);
    }
    el.leaderboardConfigForm.elements.default_timeline.value = leaderboardConfig.default_timeline;
    el.leaderboardConfigForm.elements.company_wide_visible.value = String(Boolean(leaderboardConfig.company_wide_visible));
  }
  syncPaceProfileForm();
  syncEfficiencyPolicyForm();
  syncEconomicsPolicyForm();
  render();
  setConnection("connected", "Live APIs connected");
  setNotice(message);
}

el.operatorForm.elements.amoeba_id.addEventListener("change", updateSiteOptions);
el.ingestionForm.elements.operator_id.addEventListener("change", updateRegistrationOptions);
el.alertFilter.addEventListener("change", render);
el.performanceTeamFilter.addEventListener("change", () => {
  el.performanceOperatorFilter.value = "";
  render();
});
el.performanceOperatorFilter.addEventListener("change", render);
el.vehicleTeamFilter.addEventListener("change", () => {
  if (el.vehicleTeamFilter.value) el.vehicleAmoebaFilter.value = "";
  render();
});
el.vehicleAmoebaFilter.addEventListener("change", () => {
  if (el.vehicleAmoebaFilter.value) el.vehicleTeamFilter.value = "";
  render();
});
el.vehicleSearch.addEventListener("input", render);
el.operatorTeamFilter.addEventListener("change", () => {
  if (el.operatorTeamFilter.value) el.operatorAmoebaFilter.value = "";
  render();
});
el.operatorAmoebaFilter.addEventListener("change", () => {
  if (el.operatorAmoebaFilter.value) el.operatorTeamFilter.value = "";
  render();
});
el.operatorSearch.addEventListener("input", render);
el.paceProfileForm.elements.vehicle_type.addEventListener("change", syncPaceProfileForm);
el.efficiencyPolicyForm.elements.vehicle_type.addEventListener("change", syncEfficiencyPolicyForm);
document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));

document.addEventListener("click", (event) => {
  const jobTile = event.target.closest("[data-job-filter]");
  if (!jobTile) return;
  const filter = jobTile.dataset.jobFilter;
  if (filter === "__runs") {
    document.getElementById("runsPanel").open = true;
    document.getElementById("runsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (filter === "__gaps") {
    document.getElementById("rosterGapsPanel").open = true;
    document.getElementById("rosterGapsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  state.jobFilter = filter;
  document.getElementById("jobsPanel").open = true;
  render();
  document.getElementById("jobsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});

for (const tile of document.querySelectorAll(".metrics a[data-jump]")) {
  tile.addEventListener("click", () => {
    const target = tile.dataset.jump;
    if (target === "operators") {
      document.getElementById("rosterPanel").open = true;
      if (!el.operatorTeamFilter.value && !el.operatorAmoebaFilter.value) el.operatorAmoebaFilter.value = "__all";
    }
    if (target === "vehicles") {
      document.getElementById("vehiclePanel").open = true;
      if (!el.vehicleTeamFilter.value && !el.vehicleAmoebaFilter.value) el.vehicleAmoebaFilter.value = "__all";
    }
    render();
  });
}
const describeRange = () => el.dateFrom.value === el.dateTo.value
  ? `Showing operations for ${el.dateTo.value}.`
  : `Showing operations from ${el.dateFrom.value} to ${el.dateTo.value}.`;
el.dateFrom.addEventListener("change", () => refresh(describeRange()).catch(showError));
el.dateTo.addEventListener("change", () => refresh(describeRange()).catch(showError));

el.operatorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(el.operatorForm));
  body.daily_revenue_target_ngn = body.daily_revenue_target_ngn ? Number(body.daily_revenue_target_ngn) : null;
  if (!body.supervisor_person_id) delete body.supervisor_person_id;
  try {
    await ops("/ops/v1/operators", {
      method: "POST",
      headers: { "Idempotency-Key": key("operator") },
      body: JSON.stringify(body)
    });
    el.operatorForm.reset();
    await refresh("Operator added to the Ops roster.");
  } catch (error) { showError(error); }
});

el.vehicleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(el.vehicleForm));
  try {
    await ops("/ops/v1/vehicles", {
      method: "POST",
      headers: { "Idempotency-Key": key("vehicle") },
      body: JSON.stringify(body)
    });
    el.vehicleForm.reset();
    await refresh("Vehicle added to the fleet.");
  } catch (error) { showError(error); }
});

el.paceProfileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.paceProfileForm));
  try {
    await ops("/ops/v1/revenue-pace-profiles", {
      method: "POST",
      headers: { "Idempotency-Key": key("pace-profile") },
      body: JSON.stringify({
        vehicle_type: values.vehicle_type,
        day_type: "all",
        daily_target_ngn: Number(values.daily_target_ngn),
        checkpoints: [
          { time: "12:00", expected_pct: Number(values.noon_pct) },
          { time: "16:00", expected_pct: Number(values.afternoon_pct) },
          { time: "19:00", expected_pct: Number(values.evening_pct) },
          { time: "21:00", expected_pct: 100 }
        ],
        warning_tolerance_pct: Number(values.warning_tolerance_pct),
        critical_tolerance_pct: Number(values.critical_tolerance_pct),
        effective_from: values.effective_from
      })
    });
    await refresh("Revenue pace profile added.");
  } catch (error) { showError(error); }
});

el.efficiencyPolicyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.efficiencyPolicyForm));
  try {
    await ops("/ops/v1/vehicle-efficiency-policies", {
      method: "POST",
      headers: { "Idempotency-Key": key("efficiency-policy") },
      body: JSON.stringify({
        vehicle_type: values.vehicle_type,
        make_model: values.make_model || null,
        fuel_type: "petrol",
        fuel_unit: "litres",
        standard_daily_fuel_quantity: Number(values.standard_daily_fuel_quantity),
        expected_distance_km: Number(values.expected_distance_km),
        allowed_variance_pct: Number(values.allowed_variance_pct),
        effective_from: values.effective_from
      })
    });
    await refresh("Vehicle efficiency policy added.");
  } catch (error) { showError(error); }
});

el.economicsPolicyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.economicsPolicyForm));
  try {
    await ops("/ops/v1/economics-policies", {
      method: "POST",
      headers: { "Idempotency-Key": key("economics-policy") },
      body: JSON.stringify({
        policy_name: values.policy_name,
        admin_staff_daily_cost_ngn: Number(values.admin_staff_daily_cost_ngn),
        operator_labour_share_pct: Number(values.operator_labour_share_pct),
        daily_overhead_ngn: Number(values.daily_overhead_ngn),
        expected_hours_per_operator: Number(values.expected_hours_per_operator),
        effective_from: values.effective_from
      })
    });
    await refresh("Finance economics policy added.");
  } catch (error) { showError(error); }
});

el.leaderboardConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.leaderboardConfigForm));
  try {
    await ops("/ops/v1/leaderboard-config", {
      method: "POST",
      headers: { "Idempotency-Key": key("leaderboard-config") },
      body: JSON.stringify({
        acceptance_weight: Number(values.acceptance_weight),
        online_weight: Number(values.online_weight),
        cash_weight: Number(values.cash_weight),
        revenue_weight: Number(values.revenue_weight),
        default_timeline: values.default_timeline,
        company_wide_visible: values.company_wide_visible === "true"
      })
    });
    await refresh("Leaderboard weights saved.");
  } catch (error) { showError(error); }
});

el.reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.reportForm));
  const submitButton = el.reportForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "Generating…";
  try {
    await ops("/ops/v1/daily-reports", {
      method: "POST",
      headers: { "Idempotency-Key": key("daily-report") },
      body: JSON.stringify({
        record_date: state.operatingDate,
        ...(values.amoeba_id ? { amoeba_id: values.amoeba_id } : {})
      })
    });
    await refresh(`Daily report generated for ${state.operatingDate}.`);
  } catch (error) { showError(error); } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate report";
  }
});

el.ingestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(el.ingestionForm));
  const operator = state.operators.find((item) => item.operator_id === body.operator_id);
  const registration = operator?.platform_registrations.find((item) => item.registration_id === body.registration_id);
  if (!registration) return showError(new Error("Select an operator with a platform registration."));
  const tripsTotal = Number(body.trips_total);
  const completed = Number(body.trips_completed);
  const record = {
    platform_operator_id: registration.platform_operator_id,
    trips_total: tripsTotal,
    trips_completed: completed,
    trips_cancelled: Math.max(0, tripsTotal - completed),
    trips_no_response: 0,
    trips_rejected: 0,
    ride_revenue_ngn: Number(body.ride_revenue_ngn),
    net_earnings_ngn: Number(body.net_earnings_ngn),
    booking_fees_ngn: 0,
    cash_trips: 0,
    card_trips: completed,
    acceptance_pct: tripsTotal ? Math.round(completed / tripsTotal * 10000) / 100 : 0,
    cancellation_pct: tripsTotal ? Math.round((tripsTotal - completed) / tripsTotal * 10000) / 100 : 0,
    completion_pct: tripsTotal ? Math.round(completed / tripsTotal * 10000) / 100 : 0,
    hours_online: Number(body.hours_online),
    current_status: body.current_status,
    last_seen_at: new Date().toISOString(),
    data_quality: body.data_quality,
    provenance: { submitted_via: "ops_admin_manual_entry" }
  };
  try {
    const run = await ops("/ops/v1/ingestion-runs", {
      method: "POST",
      headers: { "Idempotency-Key": key("ingestion") },
      body: JSON.stringify({
        platform_account_id: registration.platform_account_id,
        record_date: body.record_date,
        source: "manual_correction",
        records: [record]
      })
    });
    await refresh(`Performance record saved: ${run.records_upserted} record accepted.`);
  } catch (error) { showError(error); }
});

let pendingAction = null;
document.addEventListener("click", async (event) => {
  const alertButton = event.target.closest("[data-alert-action]");
  const saveOperator = event.target.closest("[data-save-operator]");
  const registerOperator = event.target.closest("[data-register-operator]");
  const replayJob = event.target.closest("[data-replay-job]");
  const openTeam = event.target.closest("[data-open-team]");
  const closeTeam = event.target.closest("[data-close-team]");
  const openAlertGroup = event.target.closest("[data-open-alert-group]");
  const closeAlertGroup = event.target.closest("[data-close-alert-group]");
  const openReport = event.target.closest("[data-open-report]");
  const closeReport = event.target.closest("[data-close-report]");
  const downloadReport = event.target.closest("[data-download-report]");
  const deleteReport = event.target.closest("[data-delete-report]");

  if (deleteReport) {
    if (!window.confirm("Delete this report snapshot? The deletion is recorded in the audit log.")) return;
    try {
      await ops(`/ops/v1/daily-reports/${encodeURIComponent(deleteReport.dataset.deleteReport)}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": key("report-delete") }
      });
      await refresh("Report snapshot deleted.");
    } catch (error) { showError(error); }
    return;
  }

  if (closeReport) {
    el.reportDialog.close();
    return;
  }

  if (downloadReport) {
    const report = el.reportDialog.currentReport;
    if (report) downloadReportFile(report, downloadReport.dataset.downloadReport);
    return;
  }

  if (openReport) {
    try {
      const report = await ops(`/ops/v1/daily-reports/${encodeURIComponent(openReport.dataset.openReport)}`);
      el.reportDialog.currentReport = report;
      el.reportDialogTitle.textContent = `${String(report.record_date).slice(0, 10)} · revision ${report.revision}`;
      const summary = report.summary || {};
      el.reportDialogSummary.innerHTML = `
        <span><strong>${escapeHtml(summary.live_operators || 0)} / ${escapeHtml(summary.active_operators || 0)}</strong> live operators</span>
        <span><strong>₦${Number(summary.revenue_total_ngn || 0).toLocaleString()}</strong> total revenue</span>
        <span><strong>${escapeHtml(summary.trips_total || 0)}</strong> trips</span>
        <span><strong>${escapeHtml(summary.open_alerts || 0)}</strong> open alerts</span>`;
      el.reportDialogRows.innerHTML = (report.rows || []).map((row) => `
        <tr>
          <td>${escapeHtml(nameForPerson(row.person_id))}</td>
          <td>${escapeHtml(row.platform_display_name)}</td>
          <td>${escapeHtml(row.trips_completed)} / ${escapeHtml(row.trips_total)}</td>
          <td>₦${Number(row.ride_revenue_ngn || 0).toLocaleString()}</td>
          <td>${Number(row.hours_online || 0).toFixed(1)}</td>
          <td><span class="pill">${escapeHtml(row.current_status)}</span></td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty">No operator rows in this report.</td></tr>`;
      el.reportDialog.showModal();
    } catch (error) { showError(error); }
    return;
  }

  if (closeAlertGroup) {
    el.alertGroupDialog.close();
    return;
  }

  if (openAlertGroup) {
    const group = state.alertGroups.find((item) => item.key === openAlertGroup.dataset.openAlertGroup);
    if (!group) return;
    el.alertGroupDialogTitle.textContent = humanize(group.key);
    el.alertGroupDialogSummary.textContent = `${group.people.size} of ${state.operators.filter((operator) => operator.operator_status === "active").length} active operators affected across ${group.teams.size} ${group.teams.size === 1 ? "team" : "teams"}. Supervisors acknowledge and resolve these from their console; escalations go to managers.`;
    el.alertGroupList.innerHTML = group.alerts.map((alert) => `
      <article class="alert-detail-row">
        <div><strong>${escapeHtml(nameForPerson(alert.person_id))}</strong><small>${escapeHtml(nameForAmoeba(alert.amoeba_id))} · ${escapeHtml(alert.platform_display_name || "General")}</small></div>
        <div><strong>Tier ${escapeHtml(alert.tier)}</strong><small>${new Date(alert.fired_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</small></div>
        <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(alert.resolution_status)}</span></div>
        <div></div>
      </article>
    `).join("");
    el.alertGroupDialog.showModal();
    return;
  }

  if (closeTeam) {
    el.teamDialog.close();
    return;
  }

  if (openTeam) {
    const team = state.teams.find((item) => item.teamKey === openTeam.dataset.openTeam);
    if (!team) return;
    el.teamDialogTitle.textContent = `${nameForPerson(team.supervisorId)} · ${nameForAmoeba(team.amoebaId)}`;
    el.teamDialogSummary.textContent = `${team.live} of ${team.operators.length} live · ₦${team.revenue.toLocaleString()} revenue · ${team.alerts} open alerts`;
    el.teamOperatorList.innerHTML = team.operators.map((item) => `
      <article class="team-operator-row">
        <div><strong>${escapeHtml(nameForPerson(item.person_id))}</strong><small>${escapeHtml(item.vehicle_plate || "No vehicle")} · ${escapeHtml(item.current_status.replaceAll("_", " "))}</small></div>
        <div><strong>₦${Number(item.ride_revenue_ngn || 0).toLocaleString()}</strong><small>${escapeHtml(String(item.pace_status || "not available").replaceAll("_", " "))}</small></div>
        <div><strong>${Number(item.hours_online || 0).toFixed(1)}h</strong><small>${Number(item.open_alerts || 0)} alerts</small></div>
      </article>
    `).join("");
    el.teamDialog.showModal();
    return;
  }

  if (replayJob) {
    try {
      await ops(`/ops/v1/scheduled-jobs/${encodeURIComponent(replayJob.dataset.replayJob)}/runs`, {
        method: "POST",
        headers: { "Idempotency-Key": key(`job-replay-${replayJob.dataset.replayJob}`) },
        body: JSON.stringify({
          requested_window_start: `${state.operatingDate}T00:00:00+01:00`,
          requested_window_end: `${state.operatingDate}T23:59:59+01:00`
        })
      });
      await refresh(`${replayJob.dataset.replayJob} queued for ${state.operatingDate}.`);
    } catch (error) { showError(error); }
    return;
  }

  if (alertButton) {
    const alert = state.alerts.find((item) => item.alert_id === alertButton.dataset.alertId);
    if (el.alertGroupDialog.open) el.alertGroupDialog.close();
    pendingAction = { type: alertButton.dataset.alertAction, alert };
    el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge alert" : "Resolve alert";
    el.dialogContext.textContent = `${alert.alert_type.replaceAll("_", " ")} · ${nameForPerson(alert.person_id)}`;
    el.dialogNotes.value = "";
    el.actionDialog.showModal();
    return;
  }

  if (saveOperator) {
    const row = saveOperator.closest("[data-operator-id]");
    try {
      await ops(`/ops/v1/operators/${saveOperator.dataset.saveOperator}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": key("operator-status") },
        body: JSON.stringify({ operator_status: row.querySelector("[data-operator-status]").value })
      });
      await refresh("Operator status updated.");
    } catch (error) { showError(error); }
    return;
  }

  if (registerOperator) {
    const options = state.platformAccounts.map((item) => `${item.platform_account_id}: ${item.display_name}`).join("\n");
    const accountId = window.prompt(`Enter platform account ID:\n${options}`, state.platformAccounts[0]?.platform_account_id || "");
    if (!accountId) return;
    const externalId = window.prompt("Enter the operator ID used by that platform:");
    if (!externalId) return;
    try {
      await ops(`/ops/v1/operators/${registerOperator.dataset.registerOperator}/platform-registrations`, {
        method: "POST",
        headers: { "Idempotency-Key": key("platform-registration") },
        body: JSON.stringify({ platform_account_id: accountId, platform_operator_id: externalId, registration_status: "active" })
      });
      await refresh("Platform registration added.");
    } catch (error) { showError(error); }
  }
});

el.actionDialog.addEventListener("close", async () => {
  if (el.actionDialog.returnValue !== "default" || !pendingAction) return;
  const { type, alert } = pendingAction;
  const notes = el.dialogNotes.value.trim();
  try {
    await ops(`/ops/v1/alerts/${alert.alert_id}/${type}`, {
      method: "POST",
      headers: { "Idempotency-Key": key(`alert-${type}`) },
      body: JSON.stringify(type === "resolve" ? { resolution_notes: notes || "Action completed." } : { note: notes })
    });
    await refresh(type === "resolve" ? "Alert resolved." : "Alert acknowledged.");
  } catch (error) { showError(error); }
  pendingAction = null;
});

function showError(error) {
  setConnection("error", "Connection issue");
  setNotice(error.message, true);
}

function downloadReportFile(report, format) {
  let content;
  let type;
  if (format === "csv") {
    const fields = ["person_id", "platform_display_name", "trips_total", "trips_completed", "ride_revenue_ngn", "hours_online", "current_status", "data_quality"];
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    content = [fields.join(","), ...(report.rows || []).map((row) => fields.map((field) => quote(row[field])).join(","))].join("\n");
    type = "text/csv";
  } else {
    content = JSON.stringify(report, null, 2);
    type = "application/json";
  }
  const blob = new Blob([content], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `fleximotion-ops-${String(report.record_date).slice(0, 10)}-r${report.revision}.${format}`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
refresh().catch(showError);
