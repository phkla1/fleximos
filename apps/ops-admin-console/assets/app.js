const state = {
  people: [],
  users: [],
  roleAssignments: [],
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
  trackerInventory: null,
  integrationStatus: [],
  vehiclePositions: { positions: [], no_feed: [] },
  scheduledJobs: [],
  scheduledJobRuns: [],
  dailyReports: [],
  notificationDeliveries: [],
  teams: [],
  alertGroups: [],
  serviceHealth: null,
  deliveryCustomers: [],
  allocatedPrices: [],
  onboardingRampProfiles: [],
  cohorts: [],
  onboardingSettings: { cohort_anchor_dow: 3 },
  cohortBoard: [],
  supervisorOnboardings: [],
  accommodation: [],
  people: [],
  operatingDate: null,
  jobFilter: ""
};

// Row currently in inline-edit mode in the delivery-customer list.
let editingCustomerId = null;

const el = Object.fromEntries(
  [
    "notice", "connectionText", "activeOperatorCount", "openAlertCount",
    "activeVehicleCount", "activePlatformCount", "alertList", "operatorList",
    "vehicleList", "operatorForm", "vehicleForm", "alertFilter", "opsApiBase",
    "vehicleTrackerProvider", "vehicleTrackerFieldLabel", "vehicleTrackerDeviceId", "vehicleTrackerHint",
    "foundationApiBase", "apiToken", "actionDialog", "dialogTitle",
    "dialogContext", "dialogNotes", "confirmActionButton", "teamBoard",
    "boardUpdated", "ingestionForm", "performanceRows", "ingestionRuns",
    "paceProfileForm", "paceProfileList", "efficiencyPolicyForm", "efficiencyPolicyList",
    "economicsPolicyForm", "economicsPolicyList",
    "leaderboardConfigForm", "leaderboardConfigSummary",
    "deliveryCustomerList", "deliveryCustomerForm", "allocatedPriceList", "allocatedPriceForm",
    "fleetPolicyForm", "fleetPolicySummary",
    "inspectionComplianceSummary", "inspectionComplianceList",
    "jobHealthSummary", "jobHealthMetrics", "scheduledJobList", "scheduledJobRuns",
    "jobFilterSummary", "rosterGapList",
    "dateFrom", "dateTo",
    "teamDialog", "teamDialogTitle", "teamDialogSummary", "teamOperatorList",
    "operatorSummaryCount", "vehicleSummaryCount", "performanceAmoebaFilter",
    "performanceOperatorFilter", "alertGroupDialog", "alertGroupDialogTitle",
    "alertGroupDialogSummary", "alertGroupList",
    "vehicleAmoebaFilter", "vehicleSearch", "vehicleFilterSummary",
    "operatorAmoebaFilter", "operatorSearch",
    "operatorFilterSummary", "reportForm", "reportList", "reportDialog",
    "reportDialogTitle", "reportDialogSummary", "reportDialogRows",
    "onboardingRampList", "onboardingRampForm", "cohortList", "onboardingSettingsForm",
    "cohortMemberForm", "supervisorOnboardingList", "supervisorOnboardingForm",
    "cohortBoard", "cohortBoardUpdated",
    "accommodationList", "accommodationBedsSummary",
    "platformDialog", "platformForm", "platformDialogContext", "platformDialogResult"
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
el.allocatedPriceForm.elements.effective_from.value = todayLagos;
el.onboardingRampForm.elements.effective_from.value = todayLagos;
el.supervisorOnboardingForm.elements.start_date.value = todayLagos;

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
  // Connection status now lives in the sidebar rail foot (conn-dot + text).
  const state = status === "connected" ? "ok" : status === "error" ? "bad" : "";
  const dot = document.getElementById("connectionDot");
  if (window.AdminKit) AdminKit.setConnection(dot, el.connectionText, state, text);
  else { if (dot) dot.className = "conn-dot" + (state ? " " + state : ""); el.connectionText.textContent = text; }
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

// The active operator currently holding a vehicle (the one-holder guard keeps this to one).
function operatorForVehicle(vehicleId) {
  return state.operators.find((operator) => operator.vehicle_id === vehicleId && operator.operator_status === "active") || null;
}

function optionHtml(items, valueKey, labelKey, selected = "", empty = "") {
  const blank = empty ? `<option value="">${empty}</option>` : "";
  return blank + items.map((item) =>
    `<option value="${escapeHtml(item[valueKey])}" ${item[valueKey] === selected ? "selected" : ""}>${escapeHtml(item[labelKey])}</option>`
  ).join("");
}

// Roles a person holds in Identity = their user's system roles + any active
// scoped role-assignment. Used to gate the roster dropdowns.
function rolesByPerson() {
  const map = new Map();
  const add = (pid, role) => {
    if (!pid || !role) return;
    if (!map.has(pid)) map.set(pid, new Set());
    map.get(pid).add(role);
  };
  for (const u of state.users || []) for (const r of (u.roles || [])) add(u.person_id, r);
  for (const a of state.roleAssignments || []) if (!a.status || a.status === "active") add(a.person_id, a.role);
  return map;
}

function renderOptions() {
  const amoebas = optionHtml(state.amoebas, "amoeba_id", "name");
  const roles = rolesByPerson();
  const hasRole = (pid, role) => roles.get(pid)?.has(role);
  const alreadyOperator = new Set(state.operators.map((o) => o.person_id));

  // Person: only people who hold the Operator role in Identity and aren't
  // already on the roster (a person can only be one operator).
  const operatorPeople = state.people.filter((p) => hasRole(p.person_id, "operator") && !alreadyOperator.has(p.person_id));
  el.operatorForm.elements.person_id.innerHTML = operatorPeople.length
    ? optionHtml(operatorPeople, "person_id", "display_name")
    : `<option value="" disabled selected>No eligible people — grant the Operator role in the Identity console</option>`;

  el.operatorForm.elements.amoeba_id.innerHTML = amoebas;
  // A vehicle may be registered into the warehouse first and allocated later.
  el.vehicleForm.elements.amoeba_id.innerHTML = `<option value="">Unassigned (warehouse)</option>${amoebas}`;
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

// Inline roster-row reassignment: the site option list for a given amoeba. Keeps
// the operator's current value selectable even if it is no longer active, so
// saving the row never silently drops an assignment. (Supervisor is derived from
// the amoeba and shown read-only; it is not chosen per operator.)
function rowSiteOptions(amoebaId, selectedId) {
  const sites = state.sites.filter((s) => s.amoeba_id === amoebaId && s.status === "active");
  if (selectedId && !sites.some((s) => s.site_id === selectedId)) {
    sites.unshift({ site_id: selectedId, name: nameForSite(selectedId) });
  }
  return optionHtml(sites, "site_id", "name", selectedId);
}

// Active vehicles in the amoeba that aren't already held by another active
// operator. The operator's own current vehicle is always kept selectable (even
// if it sits in another amoeba or is inactive) so a save never silently drops it.
function rowVehicleOptions(amoebaId, selectedId) {
  const takenByOthers = new Set(
    state.operators
      .filter((o) => o.operator_status === "active" && o.vehicle_id && o.vehicle_id !== selectedId)
      .map((o) => o.vehicle_id)
  );
  const vehicles = state.vehicles.filter((v) =>
    v.amoeba_id === amoebaId && v.status === "active" && !takenByOthers.has(v.vehicle_id)
  );
  if (selectedId && !vehicles.some((v) => v.vehicle_id === selectedId)) {
    const own = state.vehicles.find((v) => v.vehicle_id === selectedId);
    vehicles.unshift({ vehicle_id: selectedId, plate: own?.plate || selectedId });
  }
  return optionHtml(vehicles, "vehicle_id", "plate", selectedId, "No vehicle");
}

function updateRegistrationOptions() {
  const operator = state.operators.find((item) => item.operator_id === el.ingestionForm.elements.operator_id.value);
  const registrations = operator?.platform_registrations || [];
  el.ingestionForm.elements.registration_id.innerHTML = registrations.map((item) =>
    `<option value="${escapeHtml(item.registration_id)}">${escapeHtml(item.platform_display_name)} · ${escapeHtml(item.platform_operator_id)}</option>`
  ).join("");
}

function updatePerformanceFilters() {
  const previousAmoeba = el.performanceAmoebaFilter.value;
  const previousOperator = el.performanceOperatorFilter.value;
  el.performanceAmoebaFilter.innerHTML = `<option value="">Select an amoeba</option>` + state.amoebas.map((amoeba) =>
    `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`
  ).join("");
  if (state.amoebas.some((amoeba) => amoeba.amoeba_id === previousAmoeba)) el.performanceAmoebaFilter.value = previousAmoeba;

  const selectedAmoeba = el.performanceAmoebaFilter.value;
  const operators = selectedAmoeba
    ? state.operators.filter((operator) => operator.amoeba_id === selectedAmoeba && operator.operator_status === "active")
    : [];
  el.performanceOperatorFilter.innerHTML = operatorOptions(operators, selectedAmoeba ? "All operators in amoeba" : "Select an amoeba first");
  if (operators.some((operator) => operator.operator_id === previousOperator)) el.performanceOperatorFilter.value = previousOperator;
}

function updateVehicleFilters() {
  const previousAmoeba = el.vehicleAmoebaFilter.value;
  el.vehicleAmoebaFilter.innerHTML = `<option value="">Select an amoeba</option>` + state.amoebas.map((amoeba) =>
    `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`
  ).join("") + `<option value="__unassigned">Unassigned (warehouse)</option><option value="__all">All operating units</option>`;
  if (["__all", "__unassigned"].includes(previousAmoeba) || state.amoebas.some((amoeba) => amoeba.amoeba_id === previousAmoeba)) el.vehicleAmoebaFilter.value = previousAmoeba;
}

function updateOperatorFilters() {
  const previousAmoeba = el.operatorAmoebaFilter.value;
  el.operatorAmoebaFilter.innerHTML = `<option value="">Select an amoeba</option>` + state.amoebas.map((amoeba) =>
    `<option value="${escapeHtml(amoeba.amoeba_id)}">${escapeHtml(amoeba.name)}</option>`
  ).join("") + `<option value="__all">All operating units</option>`;
  if (previousAmoeba === "__all" || state.amoebas.some((amoeba) => amoeba.amoeba_id === previousAmoeba)) el.operatorAmoebaFilter.value = previousAmoeba;
}

// Versioned-policy forms (pace, efficiency, economics) share one behaviour:
// the form always targets one effective date. If that date already exists it
// CORRECTS that version; a new date creates a NEW version. This makes that
// explicit via the mode line + the submit-button label, so you always know
// whether you are editing or adding.
function versionedFormUi(form, modeId, submitId, existingDates) {
  const date = form.elements.effective_from.value;
  const known = Boolean(date) && existingDates.has(date);
  const submit = document.getElementById(submitId);
  const mode = document.getElementById(modeId);
  if (submit) submit.textContent = known ? "Save correction" : "Save as new version";
  if (mode) {
    mode.textContent = !date ? ""
      : known ? `Correcting the version effective ${date} — overwrites it.`
      : `New version effective ${date} — supersedes the current one.`;
    mode.className = `form-mode${date && !known ? " is-new" : ""}`;
  }
}

function paceVersions(type) {
  return state.paceProfiles.filter((item) => item.vehicle_type === type && item.day_type === "all");
}
function currentPaceProfile(type) {
  return paceVersions(type).slice().sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
}
function refreshPaceFormUi() {
  const type = el.paceProfileForm.elements.vehicle_type.value;
  versionedFormUi(el.paceProfileForm, "paceFormMode", "paceSubmit",
    new Set(paceVersions(type).map((p) => String(p.effective_from).slice(0, 10))));
}
function fillPaceForm(profile) {
  if (!profile) return;
  const f = el.paceProfileForm.elements;
  const checkpoints = Object.fromEntries(profile.checkpoints.map((point) => [point.time, point.expected_pct]));
  f.vehicle_type.value = profile.vehicle_type;
  f.daily_target_ngn.value = Number(profile.daily_target_ngn);
  if (f.daily_target_accommodated_ngn) {
    f.daily_target_accommodated_ngn.value = profile.daily_target_accommodated_ngn != null ? Number(profile.daily_target_accommodated_ngn) : "";
  }
  f.noon_pct.value = Number(checkpoints["12:00"] ?? 0);
  f.afternoon_pct.value = Number(checkpoints["16:00"] ?? 0);
  f.evening_pct.value = Number(checkpoints["19:00"] ?? 0);
  f.warning_tolerance_pct.value = Number(profile.warning_tolerance_pct);
  f.critical_tolerance_pct.value = Number(profile.critical_tolerance_pct);
  if (f.delivery_parcels_per_hour) {
    f.delivery_parcels_per_hour.value = Number(profile.delivery_parcels_per_hour ?? 5);
    f.delivery_journey_buffer_hours.value = Number(profile.delivery_journey_buffer_hours ?? 1);
  }
  f.effective_from.value = String(profile.effective_from).slice(0, 10);
  refreshPaceFormUi();
}
function syncPaceProfileForm() { fillPaceForm(currentPaceProfile(el.paceProfileForm.elements.vehicle_type.value)); }

function policyStatus(policy, peers) {
  // Judge against the real calendar day — the data-snapped operating
  // date can lag a day behind and mislabel today's policy "scheduled".
  const today = todayLagos;
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

function refreshEfficiencyFormUi() {
  const type = el.efficiencyPolicyForm.elements.vehicle_type.value;
  versionedFormUi(el.efficiencyPolicyForm, "efficiencyFormMode", "efficiencySubmit",
    new Set(state.efficiencyPolicies.filter((p) => p.vehicle_type === type).map((p) => String(p.effective_from).slice(0, 10))));
}
function fillEfficiencyForm(policy) {
  if (!policy) return;
  const form = el.efficiencyPolicyForm.elements;
  form.vehicle_type.value = policy.vehicle_type;
  form.make_model.value = policy.make_model || "";
  form.standard_daily_fuel_quantity.value = Number(policy.standard_daily_fuel_quantity);
  form.expected_distance_km.value = Number(policy.expected_distance_km);
  form.allowed_variance_pct.value = Number(policy.allowed_variance_pct);
  form.price_per_unit_ngn.value = policy.price_per_unit_ngn === null || policy.price_per_unit_ngn === undefined
    ? "" : Number(policy.price_per_unit_ngn);
  form.effective_from.value = String(policy.effective_from).slice(0, 10);
  refreshEfficiencyFormUi();
}
function syncEfficiencyPolicyForm() { fillEfficiencyForm(currentEfficiencyPolicy(el.efficiencyPolicyForm.elements.vehicle_type.value)); }

function currentEconomicsPolicy() {
  return state.economicsPolicies
    .filter((item) => String(item.effective_from).slice(0, 10) <= (state.operatingDate || todayLagos))
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
}
function refreshEconomicsFormUi() {
  versionedFormUi(el.economicsPolicyForm, "economicsFormMode", "economicsSubmit",
    new Set(state.economicsPolicies.map((p) => String(p.effective_from).slice(0, 10))));
}
function fillEconomicsForm(policy) {
  if (!policy) return;
  const form = el.economicsPolicyForm.elements;
  form.policy_name.value = policy.policy_name;
  form.admin_staff_daily_cost_ngn.value = Number(policy.admin_staff_daily_cost_ngn);
  form.operator_labour_share_pct.value = Number(policy.operator_labour_share_pct);
  form.daily_overhead_ngn.value = Number(policy.daily_overhead_ngn);
  form.expected_hours_per_operator.value = Number(policy.expected_hours_per_operator);
  form.effective_from.value = String(policy.effective_from).slice(0, 10);
  refreshEconomicsFormUi();
}
function syncEconomicsPolicyForm() { fillEconomicsForm(currentEconomicsPolicy()); }


/* ---------- double-submit guard ----------
   The moment any form submits, its save button goes inactive and reads
   "Saving…" so the user knows the click landed; buttons unlock on the
   next successful render or on an error notice. */
document.addEventListener("submit", (event) => {
  const button = event.target.querySelector('button[type="submit"], button:not([type])');
  if (!button || button.disabled) return;
  button.disabled = true;
  button.dataset.lockedLabel = button.textContent;
  button.textContent = "Saving…";
  setTimeout(() => {
    if (button.dataset.lockedLabel !== undefined) {
      button.disabled = false;
      button.textContent = button.dataset.lockedLabel;
      delete button.dataset.lockedLabel;
    }
  }, 15000);
}, true);
function unlockSubmitButtons() {
  for (const button of document.querySelectorAll("button[data-locked-label]")) {
    button.disabled = false;
    button.textContent = button.dataset.lockedLabel;
    delete button.dataset.lockedLabel;
  }
}

function render() {
  unlockSubmitButtons();
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
        <button type="button" class="secondary team-open" data-open-team="${escapeHtml(team.teamKey)}">Open amoeba</button>
      </article>`;
  }).join("") : `<div class="empty">No active amoebas match this view.</div>`;
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
      <div><strong>${escapeHtml(humanize(group.key))}</strong><small>${group.teams.size} affected ${group.teams.size === 1 ? "amoeba" : "amoebas"} · highest tier ${group.highestTier}</small></div>
      <div class="alert-group-count"><strong>${group.people.size}/${activeOperatorTotal}</strong><small>active operators affected</small></div>
      <div><strong>${group.alerts.length}</strong><small>${filter || "matching"} alerts</small></div>
      <button type="button" class="secondary" data-open-alert-group="${escapeHtml(group.key)}">View affected operators</button>
    </article>
  `).join("") : `<div class="empty">No alerts match this view.</div>`;

  const selectedOperatorAmoeba = el.operatorAmoebaFilter.value;
  const operatorQuery = el.operatorSearch.value.trim().toLowerCase();
  const hasOperatorScope = Boolean(selectedOperatorAmoeba || operatorQuery);
  const currentOperators = hasOperatorScope ? state.operators.filter((operator) => {
    if (["inactive", "suspended"].includes(operator.operator_status)) return false;
    if (selectedOperatorAmoeba && selectedOperatorAmoeba !== "__all" && operator.amoeba_id !== selectedOperatorAmoeba) return false;
    const platforms = operator.platform_registrations?.map((item) => item.platform_display_name).join(" ") || "";
    const searchable = `${nameForPerson(operator.person_id)} ${operator.vehicle_plate || ""} ${platforms}`.toLowerCase();
    if (operatorQuery && !searchable.includes(operatorQuery)) return false;
    return true;
  }) : [];
  el.operatorFilterSummary.textContent = hasOperatorScope
    ? `${currentOperators.length} matching active ${currentOperators.length === 1 ? "operator" : "operators"}`
    : "Select an amoeba, or search by name or vehicle.";
  el.operatorList.innerHTML = currentOperators.length ? currentOperators.map((operator) => `
    <article class="data-row" data-operator-id="${escapeHtml(operator.operator_id)}">
      <div><strong>${escapeHtml(nameForPerson(operator.person_id))}</strong><small>${escapeHtml(operator.operator_id)}</small>${operator.accommodated ? `<span class="pill ${operator.operator_status === "active" ? "" : "open"}" title="${operator.operator_status === "active" ? "Housed — holding a bed" : "Bed reserved until activation"}">🏠 ${operator.operator_status === "active" ? "Housed" : "Reserved"}</span>` : ""}</div>
      <div><span class="row-label">Assignment</span>
        <select class="row-field" aria-label="Amoeba" data-operator-amoeba>${optionHtml(state.amoebas, "amoeba_id", "name", operator.amoeba_id)}</select>
        <select class="row-field" aria-label="Site" data-operator-site>${rowSiteOptions(operator.amoeba_id, operator.site_id || "")}</select>
        <small class="row-note" data-operator-supervisor-note>Supervisor: ${operator.supervisor_person_id ? escapeHtml(nameForPerson(operator.supervisor_person_id)) : "set on the amoeba (HR console)"}</small>
      </div>
      <div><span class="row-label">Vehicle</span>
        <select class="row-field" aria-label="Vehicle" data-operator-vehicle>${rowVehicleOptions(operator.amoeba_id, operator.vehicle_id || "")}</select>
        <label class="row-target">Target ₦<input type="number" min="0" step="any" aria-label="Daily target override (NGN)" title="Blank = company default for this rider's housing status" placeholder="default" data-operator-target value="${operator.daily_revenue_target_ngn != null ? Number(operator.daily_revenue_target_ngn) : ""}" /></label></div>
      <div><span class="row-label">Platforms</span><strong>${operator.platform_registrations.length}</strong><small>${operator.platform_registrations.map((item) => item.platform_display_name).join(", ") || "Not registered"}</small></div>
      <div class="row-actions">
        <select aria-label="Operator status" data-operator-status>
          ${["pending_activation", "active", "inactive", "suspended"].map((value) => `<option value="${value}" ${value === operator.operator_status ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <label class="row-check" title="${escapeHtml(accommodationHint(operator))}"><input type="checkbox" data-operator-accommodated ${operator.accommodated ? "checked" : ""} ${accommodationDisabled(operator) ? "disabled" : ""} /> Accommodated</label>
        <button type="button" data-save-operator="${escapeHtml(operator.operator_id)}">Save</button>
        <button type="button" class="secondary" data-register-operator="${escapeHtml(operator.operator_id)}">Add platform</button>
      </div>
    </article>
  `).join("") : `<div class="empty">${hasOperatorScope ? "No operators match this scope." : "Choose a roster scope to view operators."}</div>`;

  const selectedVehicleAmoeba = el.vehicleAmoebaFilter.value;
  const vehicleQuery = el.vehicleSearch.value.trim().toLowerCase();
  const hasVehicleScope = Boolean(selectedVehicleAmoeba || vehicleQuery);
  const currentVehicles = hasVehicleScope ? state.vehicles.filter((vehicle) => {
    if (vehicle.status !== "active") return false;
    if (selectedVehicleAmoeba === "__unassigned") { if (vehicle.amoeba_id) return false; }
    else if (selectedVehicleAmoeba && selectedVehicleAmoeba !== "__all" && vehicle.amoeba_id !== selectedVehicleAmoeba) return false;
    if (vehicleQuery && !`${vehicle.plate} ${vehicle.make_model || ""}`.toLowerCase().includes(vehicleQuery)) return false;
    return true;
  }) : [];
  el.vehicleFilterSummary.textContent = hasVehicleScope
    ? `${currentVehicles.length} matching active ${currentVehicles.length === 1 ? "vehicle" : "vehicles"}`
    : "Select an amoeba, or search by plate or model.";
  el.vehicleList.innerHTML = currentVehicles.length ? currentVehicles.map((vehicle) => `
    <article class="data-row">
      <div><strong>${escapeHtml(vehicle.plate)}</strong><small>${escapeHtml(vehicle.vehicle_id)}</small></div>
      <div><span class="row-label">Type</span><strong>${escapeHtml(vehicle.vehicle_type)}</strong><small>${escapeHtml(vehicle.make_model || "Model not set")}</small></div>
      <div><span class="row-label">Amoeba</span>${vehicle.amoeba_id
        ? `<strong>${escapeHtml(nameForAmoeba(vehicle.amoeba_id))}</strong>`
        : `<strong class="muted">Unassigned (warehouse)</strong>`}<small>${escapeHtml(vehicle.color || "Colour not set")}</small></div>
      <div><span class="row-label">Operator</span>${(() => {
        const holder = operatorForVehicle(vehicle.vehicle_id);
        return holder
          ? `<strong>${escapeHtml(nameForPerson(holder.person_id))}</strong><small>${escapeHtml(nameForSite(holder.site_id) || nameForAmoeba(holder.amoeba_id))}</small>`
          : `<strong class="muted">Unassigned</strong>`;
      })()}</div>
      <div><span class="row-label">Tracker</span>${(() => {
        const t = vehicleTracking(vehicle);
        const head = vehicle.tracker_provider || vehicle.tracker_device_id
          ? `<strong>${escapeHtml(TRACKER_LABEL[vehicle.tracker_provider] || vehicle.tracker_provider || "tracker")}</strong><small>${escapeHtml(vehicle.tracker_device_id || "auto by plate")}</small>`
          : "";
        return `${head}<span class="pill ${t.cls}">${escapeHtml(t.text)}</span>`;
      })()}</div>
      <div><span class="pill">${escapeHtml(vehicle.status)}</span></div>
    </article>
  `).join("") : `<div class="empty">${hasVehicleScope ? "No vehicles match this scope." : "Choose a fleet scope to view vehicles."}</div>`;

  const selectedAmoeba = el.performanceAmoebaFilter.value;
  const selectedOperator = el.performanceOperatorFilter.value;
  const amoebaOperatorIds = new Set(
    selectedAmoeba ? state.operators.filter((operator) => operator.amoeba_id === selectedAmoeba).map((operator) => operator.operator_id) : []
  );
  const performance = selectedAmoeba ? state.dailyPerformance.filter((record) =>
    amoebaOperatorIds.has(record.operator_id) &&
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
  const missingRows = selectedAmoeba
    ? state.operators
        .filter((operator) => amoebaOperatorIds.has(operator.operator_id) && operator.operator_status === "active")
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
    : `<tr><td colspan="7" class="empty">${selectedAmoeba ? "No active operators in this amoeba." : "Choose an amoeba to view its record coverage, then an operator for detail."}</td></tr>`;

  el.ingestionRuns.innerHTML = state.ingestionRuns.length ? state.ingestionRuns.slice(0, 6).map((run) => `
    <article class="data-row run-row">
      <div><strong>${escapeHtml(run.platform_display_name)}</strong><small>${escapeHtml(run.ingestion_run_id)}</small></div>
      <div><span class="row-label">Date</span><strong>${escapeHtml(run.record_date)}</strong><small>${escapeHtml(run.source)}</small></div>
      <div><span class="row-label">Records</span><strong>${escapeHtml(run.records_upserted)} accepted</strong><small>${escapeHtml(run.records_rejected)} rejected</small></div>
      <div><span class="pill ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></div>
    </article>
  `).join("") : `<div class="empty">No ingestion runs yet.</div>`;

  el.paceProfileList.innerHTML = state.paceProfiles.map((profile) => {
    const status = policyStatus(profile, paceVersions(profile.vehicle_type));
    const accommodated = profile.daily_target_accommodated_ngn != null
      ? ` · accommodated ₦${Number(profile.daily_target_accommodated_ngn).toLocaleString()}`
      : " · accommodated = same";
    return `
    <article class="policy-row ${status}">
      <div><strong>${escapeHtml(profile.vehicle_type)}</strong><small>Target ₦${Number(profile.daily_target_ngn).toLocaleString()}${accommodated}</small><span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><strong>${profile.checkpoints.map((point) => `${point.time} ${point.expected_pct}%`).join(" · ")}</strong><small>Warn ${profile.warning_tolerance_pct}% · Critical ${profile.critical_tolerance_pct}% · Effective ${escapeHtml(effectiveWindow(profile))}</small>
        <span class="row-actions"><button type="button" class="linklike" data-edit-pace="${escapeHtml(profile.pace_profile_id)}">Edit</button></span></div>
    </article>`;
  }).join("") || `<div class="empty">No pace profiles configured.</div>`;

  const inventory = state.trackerInventory;
  const trackerSummary = document.getElementById("trackerSummary");
  const trackerList = document.getElementById("trackerDeviceList");
  if (trackerSummary && trackerList) {
    const devices = (inventory && inventory.devices) || [];
    const connected = (inventory && inventory.connected_providers) || [];
    if (!inventory || (!connected.length && devices.length === 0)) {
      trackerSummary.textContent = "No tracker connector configured and no tracked vehicles registered. Set CARTRACKER_* / TANKVOLT_* on the server, or register vehicles with their device id / VIN.";
      trackerList.innerHTML = `<div class="empty">Distances fall back to platform-reported KM until a tracker connects.</div>`;
    } else {
      // Live pull needs a configured connector; registered-only mappings show
      // from the roster regardless, so only offer the pull when one is connected.
      const pullAffordance = connected.length
        ? `distances stored daily (hourly capture + 23:30 final). <button type="button" class="linklike" data-tracker-pull>Pull today now</button>`
        : `no live connector configured — mappings are shown from the roster, but no GPS can be pulled until a tracker key is set on the server.`;
      // Make the active credential environment unmistakable.
      const env = inventory.environment === "production" ? "PRODUCTION" : "TEST";
      const envBadge = `<span class="pill ${inventory.environment === "production" ? "" : "open"}" title="Integration credentials in use (FLEXI_INTEGRATIONS_ENV)">${env} credentials</span> `;
      trackerSummary.innerHTML = `${envBadge}${inventory.device_count} device${inventory.device_count === 1 ? "" : "s"} across ${escapeHtml((inventory.providers || []).map((p) => TRACKER_LABEL[p] || p).join(", ") || "—")} · ${inventory.mapped_count} mapped to vehicles · ${pullAffordance}`;
      // Group the inventory by provider so Car Tracker vs Tankvolt is obvious.
      // Every provider that is either configured OR has registered vehicles gets a
      // heading (even with zero devices) so an empty list explains itself.
      const deviceRow = (device) => `
        <article class="policy-row">
          <div><strong>${escapeHtml(device.name)}</strong><small>Device ${escapeHtml(device.device_id)}${device.group ? ` · folder: ${escapeHtml(device.group)}` : ""}</small></div>
          <div>${device.vehicle_id
            ? `<strong>${escapeHtml(device.vehicle_plate)}</strong><small>mapped by ${escapeHtml(String(device.matched_by).replaceAll("_", " "))}</small>`
            : `<strong>Unmapped</strong><small>Set the device ID on a vehicle, or rename the device to include the plate</small>`}
          <span class="pill ${device.vehicle_id ? "" : "open"}">${device.vehicle_id ? "mapped" : "unmapped"}</span>${device.connector_configured === false ? `<span class="pill open" title="This vehicle is registered, but its tracker provider has no live connector configured on the server, so no GPS can be pulled yet.">live pull pending</span>` : ""}</div>
        </article>`;
      const emptyFor = (provider) => provider === "tankvolt"
        ? `<div class="empty">No Tankvolt bikes registered yet. Add each bike under Vehicles with its VIN — Tankvolt has no device directory, so the roster is the only source.</div>`
        : `<div class="empty">The ${escapeHtml(TRACKER_LABEL[provider] || provider)} account returned no devices.</div>`;
      // Connector health per provider, so "did the pull work?" is answerable here.
      const HEALTH = { ok: "🟢", degraded: "🟡", down: "🔴", not_configured: "⚪" };
      const healthFor = (provider) => {
        const row = (state.integrationStatus || []).find((item) => item.key === `tracker:${provider}`);
        if (!row) return "";
        const when = row.last_checked_at ? ` · checked ${new Date(row.last_checked_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}` : "";
        const lastOk = row.status !== "ok" && row.last_ok_at
          ? ` · last ok ${new Date(row.last_ok_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
        return `<p class="tracker-health status-${escapeHtml(row.status)}">${HEALTH[row.status] || "⚪"} ${escapeHtml(String(row.status).replace("_", " "))} — ${escapeHtml(row.detail || "")}${when}${lastOk}</p>`;
      };
      const headingProviders = [...new Set([...connected, ...devices.map((device) => device.provider)])];
      trackerList.innerHTML = headingProviders.map((provider) => {
        const rows = devices.filter((device) => device.provider === provider);
        return `<p class="tracker-provider">${escapeHtml(TRACKER_LABEL[provider] || provider)}</p>`
          + healthFor(provider)
          + (rows.length ? rows.map(deviceRow).join("") : emptyFor(provider));
      }).join("") || `<div class="empty">No tracker providers are configured.</div>`;
    }
  }

  el.efficiencyPolicyList.innerHTML = state.efficiencyPolicies.map((policy) => {
    const peers = state.efficiencyPolicies.filter((peer) => peer.vehicle_type === policy.vehicle_type);
    const status = policyStatus(policy, peers);
    return `
    <article class="policy-row ${status}">
      <div><strong>${escapeHtml(policy.vehicle_type)}</strong><small>${escapeHtml(policy.make_model || "All models")}</small><span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><strong>${Number(policy.standard_daily_fuel_quantity)} ${escapeHtml(policy.fuel_unit)} → ${Number(policy.expected_distance_km)} km</strong><small>Allowed variance ±${Number(policy.allowed_variance_pct)}%${policy.price_per_unit_ngn ? ` · ₦${Number(policy.price_per_unit_ngn).toLocaleString()}/${policy.fuel_unit === "kWh" ? "kWh" : "litre"}` : " · No unit price set"} · Effective ${escapeHtml(effectiveWindow(policy))}</small>
        <span class="row-actions"><button type="button" class="linklike" data-edit-efficiency="${escapeHtml(policy.efficiency_policy_id)}">Edit</button></span></div>
    </article>`;
  }).join("") || `<div class="empty">No efficiency policies configured.</div>`;

  el.economicsPolicyList.innerHTML = state.economicsPolicies.map((policy) => {
    const status = policyStatus(policy, state.economicsPolicies);
    return `
    <article class="policy-row ${status}">
      <div><strong>${escapeHtml(policy.policy_name)}</strong><small>Effective ${escapeHtml(effectiveWindow(policy))}</small><span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><strong>₦${Number(policy.admin_staff_daily_cost_ngn).toLocaleString()} fixed + ${Number(policy.operator_labour_share_pct)}% operators</strong><small>Overhead ₦${Number(policy.daily_overhead_ngn).toLocaleString()} · ${Number(policy.expected_hours_per_operator)}h/operator</small>
        <span class="row-actions"><button type="button" class="linklike" data-edit-economics="${escapeHtml(policy.economics_policy_id)}">Edit</button></span></div>
    </article>`;
  }).join("") || `<div class="empty">No economics policies configured.</div>`;

  el.deliveryCustomerList.innerHTML = state.deliveryCustomers.length ? state.deliveryCustomers.map((customer) => {
    if (editingCustomerId === customer.delivery_customer_id) {
      return `
    <article class="policy-row" data-customer-row="${escapeHtml(customer.delivery_customer_id)}">
      <div><strong>${escapeHtml(customer.name)}</strong></div>
      <div class="inline-edit">
        <label>Contract ₦/pkg<input type="number" min="1" step="any" value="${Number(customer.contract_price_ngn)}" data-field="contract_price_ngn" /></label>
        <label>Contact<input value="${escapeHtml(customer.contact || "")}" data-field="contact" placeholder="Optional" /></label>
        <label>Status<select data-field="status"><option value="active"${customer.status === "active" ? " selected" : ""}>active</option><option value="inactive"${customer.status !== "active" ? " selected" : ""}>inactive</option></select></label>
        <button type="button" class="primary" data-save-customer="${escapeHtml(customer.delivery_customer_id)}">Save</button>
        <button type="button" class="linklike" data-cancel-customer>Cancel</button>
      </div>
    </article>`;
    }
    return `
    <article class="policy-row ${customer.status === "active" ? "" : "superseded"}">
      <div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.contact || "No contact")}</small><span class="pill ${customer.status === "active" ? "" : "superseded"}">${escapeHtml(customer.status)}</span></div>
      <div><strong>₦${Number(customer.contract_price_ngn).toLocaleString()}/package contract</strong><small>Finance-facing; operators see the allocated price only</small>
        <span class="row-actions"><button type="button" class="linklike" data-edit-customer="${escapeHtml(customer.delivery_customer_id)}">Edit</button>
        <button type="button" class="linklike danger" data-delete-customer="${escapeHtml(customer.delivery_customer_id)}" data-customer-name="${escapeHtml(customer.name)}">Delete</button></span></div>
    </article>`;
  }).join("") : `<div class="empty">No delivery customers defined yet.</div>`;

  // Keep the allocated-price form's customer selector in sync with the roster.
  const customerName = new Map(state.deliveryCustomers.map((c) => [c.delivery_customer_id, c.name]));
  const customerSelect = el.allocatedPriceForm.elements.delivery_customer_id;
  if (customerSelect) {
    const current = customerSelect.value;
    customerSelect.innerHTML = `<option value="">Any customer (default)</option>`
      + state.deliveryCustomers.map((c) =>
        `<option value="${escapeHtml(c.delivery_customer_id)}">${escapeHtml(c.name)}</option>`).join("");
    customerSelect.value = current;
  }

  const hasClassRate = { rider: false, driver: false };
  for (const row of state.allocatedPrices) {
    if ((row.operator_class || "all") === "rider") hasClassRate.rider = true;
    if ((row.operator_class || "all") === "driver") hasClassRate.driver = true;
  }
  el.allocatedPriceList.innerHTML = state.allocatedPrices.map((price) => {
    const operatorClass = price.operator_class || "all";
    const sameClass = state.allocatedPrices.filter((row) => (row.operator_class || "all") === operatorClass);
    const status = policyStatus({ effective_from: price.effective_from, effective_to: price.effective_to }, sameClass);
    const classLabel = operatorClass === "all" ? "All" : operatorClass === "driver" ? "Drivers" : "Riders";
    const customerLabel = price.delivery_customer_id ? (customerName.get(price.delivery_customer_id) || "customer") : null;
    const basic = Number(price.daily_basic_ngn || 0);
    // Make the override relationship explicit so "All" + "Riders" doesn't look
    // like a conflict: All is the fallback for classes without their own rate.
    const covered = ["rider", "driver"].filter((cls) => !hasClassRate[cls]);
    const scopeNote = operatorClass === "all"
      ? (covered.length ? `Fallback for ${covered.map((c) => c === "rider" ? "riders" : "drivers").join(" & ")} (no own rate)` : "Fallback (overridden for every class)")
      : `Overrides the global rate for ${classLabel.toLowerCase()}`;
    return `
    <article class="policy-row ${status}">
      <div><strong>₦${Number(price.price_ngn).toLocaleString()}/package allocated</strong><span class="pill ${operatorClass === "driver" ? "open" : ""}">${classLabel}</span>${customerLabel ? `<span class="pill">${escapeHtml(customerLabel)}</span>` : ""}<span class="pill ${status === "active" ? "" : status}">${status}</span></div>
      <div><small>${escapeHtml(scopeNote)} · effective ${escapeHtml(effectiveWindow(price))}${basic ? ` · ₦${basic.toLocaleString()} daily basic` : ""}</small>
        <button type="button" class="linklike danger" data-delete-allocated="${escapeHtml(price.allocated_price_id)}" data-price-label="${escapeHtml(classLabel)} ₦${Number(price.price_ngn).toLocaleString()}">Delete</button></div>
    </article>`;
  }).join("") || `<div class="empty">No allocated price configured.</div>`;

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
      : `${compliance.compliance_pct}% compliant on the ${Number(compliance.inspection_interval_hours || 48)}h cadence · ${compliance.current} current · ${compliance.overdue} overdue of ${compliance.total_active_vehicles} active vehicles.`;
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

  renderOnboarding();
  renderAccommodation();
  // Keep the live/active version front and centre; fold superseded history away.
  ["efficiencyPolicyList", "economicsPolicyList", "allocatedPriceList", "paceProfileList", "onboardingRampList", "accommodationList"]
    .forEach((id) => collapseHistory(el[id]));
}

// Move superseded policy versions into a collapsed "N earlier versions" details,
// so a config list shows the active value first, not a wall of history.
function collapseHistory(container) {
  if (!container) return;
  const superseded = [...container.querySelectorAll(":scope > .policy-row.superseded, :scope > .superseded")];
  if (!superseded.length) return;
  const details = document.createElement("details");
  details.className = "config-history";
  const summary = document.createElement("summary");
  summary.textContent = `${superseded.length} earlier version${superseded.length === 1 ? "" : "s"}`;
  details.appendChild(summary);
  superseded.forEach((row) => details.appendChild(row));
  container.appendChild(details);
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TRACKER_LABEL = { cartracker: "Car Tracker", tankvolt: "Tankvolt", orbit: "Orbit" };
// Which providers suit which vehicle types. Tankvolt is electric-bike only, so it
// must not be selectable for a car or van (the provider list filters by type).
const TRACKER_PROVIDERS = [
  { value: "", label: "Auto — Car Tracker (match by plate)", types: ["car", "motorbike", "van"] },
  { value: "cartracker", label: "Car Tracker Nigeria", types: ["car", "motorbike", "van"] },
  { value: "tankvolt", label: "Tankvolt EV (bike)", types: ["motorbike"] },
  { value: "orbit", label: "Orbit Fleet", types: ["car", "motorbike", "van"] }
];

// Keep the tracker fields honest: filter providers by vehicle type, and make the
// device-id/VIN field explain itself for the chosen provider.
function updateVehicleTrackerUi() {
  if (!el.vehicleTrackerProvider) return;
  const type = el.vehicleForm.elements.vehicle_type.value;
  const sel = el.vehicleTrackerProvider;
  const current = sel.value;
  const opts = TRACKER_PROVIDERS.filter((p) => p.types.includes(type));
  sel.innerHTML = opts.map((p) => `<option value="${p.value}">${escapeHtml(p.label)}</option>`).join("");
  sel.value = opts.some((p) => p.value === current) ? current : "";
  const provider = sel.value;
  const input = el.vehicleTrackerDeviceId;
  const label = el.vehicleTrackerFieldLabel;
  const hint = el.vehicleTrackerHint;
  if (provider === "tankvolt") {
    label.textContent = "Bike VIN";
    input.disabled = false; input.required = true;
    input.placeholder = "e.g. LB7FP210XSF000155";
    hint.textContent = "Electric bike — Tankvolt tracks by VIN. Enter the exact VIN; tracking starts on the next pull.";
  } else if (provider === "cartracker") {
    label.textContent = "Tracker device ID (optional)";
    input.disabled = false; input.required = false;
    input.placeholder = "Leave blank to auto-map by plate";
    hint.textContent = "Car Tracker lists its own devices — leave blank to auto-map to this plate, or enter a specific device id to pin it.";
  } else if (provider === "orbit") {
    label.textContent = "Tracker device ID";
    input.disabled = false; input.required = false;
    input.placeholder = "Orbit device id";
    hint.textContent = "Orbit Fleet device id.";
  } else {
    label.textContent = "Tracker device ID";
    input.disabled = true; input.required = false; input.value = "";
    input.placeholder = "Not needed — auto-maps by plate";
    hint.textContent = "Auto: a Car Tracker device is matched to this vehicle by its plate. Nothing to enter.";
  }
}

// Live tracking status for a vehicle row (built from vehicle-positions + the
// device inventory), so you confirm tracking in place rather than elsewhere.
function vehicleTracking(vehicle) {
  const feed = state.vehiclePositions || { positions: [], no_feed: [] };
  const pos = (feed.positions || []).find((p) => p.vehicle_id === vehicle.vehicle_id);
  if (pos) {
    const age = pos.position_age_minutes === null || pos.position_age_minutes === undefined
      ? "" : pos.position_age_minutes === 0 ? " · just now" : ` · ${pos.position_age_minutes} min ago`;
    const unverified = pos.fix_valid === false ? " · unverified" : "";
    return { cls: "ok", text: `✓ tracked${age}${unverified}` };
  }
  const nf = (feed.no_feed || []).find((p) => p.vehicle_id === vehicle.vehicle_id);
  if (!vehicle.tracker_provider && !vehicle.tracker_device_id) return { cls: "muted", text: "No tracker fitted" };
  if (nf && /feed error/i.test(nf.reason || "")) return { cls: "bad", text: "⚠ feed error" };
  return { cls: "warn", text: "registered · awaiting fix" };
}

function renderOnboarding() {
  // Ramp profiles.
  el.onboardingRampList.innerHTML = state.onboardingRampProfiles.length
    ? state.onboardingRampProfiles.map((profile) => {
        const targets = Array.isArray(profile.daily_targets_ngn)
          ? profile.daily_targets_ngn
          : JSON.parse(profile.daily_targets_ngn || "[]");
        const grad = targets[targets.length - 1] || 0;
        const active = !profile.effective_to;
        return `
      <article class="policy-row ${active ? "" : "superseded"}">
        <div><strong>${escapeHtml(profile.operator_class === "driver" ? "Drivers" : "Riders")} · ${targets.length}-day ramp</strong>
          <small>Scheduled from day ${profile.scheduled_from_day} · rest ${DOW[Number(profile.rest_day_of_week) || 0]} · graduates to ₦${Number(grad).toLocaleString()}</small>
          <span class="pill ${active ? "" : "superseded"}">${active ? "active" : "superseded"}</span></div>
        <div><small>Targets ₦: ${targets.map((t) => Number(t).toLocaleString()).join(" · ")}</small>
          <small>Completion bonus ₦${Number(profile.completion_bonus_ngn || 0).toLocaleString()} · −${Number(profile.missed_day_reduction_pct || 0)}%/missed day · effective ${escapeHtml(effectiveWindow(profile))}</small></div>
      </article>`;
      }).join("")
    : `<div class="empty">No ramp profile configured.</div>`;

  // Cohorts (auto-created per week). Keep the Day-1 weekday selector in sync.
  if (el.onboardingSettingsForm && state.onboardingSettings) {
    el.onboardingSettingsForm.elements.cohort_anchor_dow.value = String(state.onboardingSettings.cohort_anchor_dow ?? 3);
  }
  el.cohortList.innerHTML = state.cohorts.length
    ? state.cohorts.map((c) => `
      <article class="policy-row ${c.status === "active" ? "" : "superseded"}">
        <div><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.operator_class === "driver" ? "Drivers" : "Riders")}${c.amoeba_id ? ` · ${escapeHtml(nameForAmoeba(c.amoeba_id))}` : ""} · Day 1 = ${escapeHtml(String(c.start_date).slice(0, 10))}</small>
          <span class="pill">${Number(c.member_count || 0)} member${Number(c.member_count) === 1 ? "" : "s"}</span></div>
      </article>`).join("")
    : `<div class="empty">No cohorts yet — they appear automatically as riders go active with a vehicle.</div>`;

  // Supervisor onboarding.
  el.supervisorOnboardingList.innerHTML = state.supervisorOnboardings.length
    ? state.supervisorOnboardings.map((s) => {
        const graduated = s.status === "graduated";
        return `
      <article class="policy-row ${graduated ? "superseded" : ""}">
        <div><strong>${escapeHtml(nameForPerson(s.supervisor_person_id))}</strong>
          <small>Host ${escapeHtml(nameForAmoeba(s.host_amoeba_id))}${s.mentor_person_id ? ` · mentor ${escapeHtml(nameForPerson(s.mentor_person_id))}` : ""} · from ${escapeHtml(String(s.start_date).slice(0, 10))}</small>
          <span class="pill ${graduated ? "" : "open"}">${escapeHtml(String(s.phase).replaceAll("_", " "))}</span></div>
        <div class="row-actions">
          ${graduated
            ? `<small>Graduated${s.target_amoeba_id ? ` → ${escapeHtml(nameForAmoeba(s.target_amoeba_id))}` : ""} (${escapeHtml(s.graduation_route || "reassign")})</small>`
            : `<button type="button" class="linklike" data-advance-supervisor="${escapeHtml(s.supervisor_onboarding_id)}" data-phase="${s.phase === "scheduled_assist" ? "on_demand_assist" : "scheduled_assist"}">${s.phase === "scheduled_assist" ? "→ On-demand phase" : "→ Scheduled phase"}</button>
               <button type="button" class="linklike" data-graduate-supervisor="${escapeHtml(s.supervisor_onboarding_id)}" data-supervisor-name="${escapeHtml(nameForPerson(s.supervisor_person_id))}">Graduate</button>`}
        </div>
      </article>`;
      }).join("")
    : `<div class="empty">No supervisor onboarding in progress.</div>`;

  // Populate selects.
  const riders = state.operators.filter((o) => o.operator_status === "active");
  el.cohortMemberForm.elements.cohort_id.innerHTML = optionHtml(state.cohorts.filter((c) => c.status === "active"), "cohort_id", "name");
  el.cohortMemberForm.elements.operator_id.innerHTML = operatorOptions(riders);
  el.supervisorOnboardingForm.elements.supervisor_person_id.innerHTML = optionHtml(state.people, "person_id", "display_name");
  el.supervisorOnboardingForm.elements.mentor_person_id.innerHTML = optionHtml(state.people, "person_id", "display_name", "", "No mentor");
  el.supervisorOnboardingForm.elements.host_amoeba_id.innerHTML = optionHtml(state.amoebas, "amoeba_id", "name");

  renderCohortBoard();
}

const RAMP_PHASE_LABEL = { on_demand_only: "on-demand", scheduled_and_on_demand: "scheduled + on-demand" };

function renderCohortBoard() {
  if (!el.cohortBoard) return;
  const cohorts = (state.cohortBoard || []).filter((c) => (c.members || []).length);
  el.cohortBoardUpdated.textContent = state.operatingDate ? `As at ${state.operatingDate}` : "";
  if (!cohorts.length) {
    el.cohortBoard.innerHTML = `<div class="empty">No riders are in an onboarding ramp on this date. Start a cohort under Onboarding.</div>`;
    return;
  }
  // Top-of-page rollup across every cohort in view, so the page opens on a
  // scannable summary no matter how many weekly cohorts have accrued.
  const sum = (key) => cohorts.reduce((total, c) => total + Number(c[key] || 0), 0);
  const totalOps = sum("operator_count");
  const totalRev = sum("revenue_total_ngn");
  const totalTarget = sum("target_total_ngn");
  const overview = `
    <div class="cohort-summary">
      <div><span>Cohorts</span><strong>${cohorts.length}</strong></div>
      <div><span>Riders onboarding</span><strong>${totalOps}</strong></div>
      <div><span>Revenue today</span><strong>₦${totalRev.toLocaleString()}</strong><small>${totalTarget > 0 ? `${Math.round((totalRev / totalTarget) * 100)}% of target` : ""}</small></div>
      <div><span>Avg / operator</span><strong>₦${totalOps ? Math.round(totalRev / totalOps).toLocaleString() : 0}</strong></div>
    </div>`;

  // Each cohort is a collapsible summary row; expand to drill into its riders.
  const cards = cohorts.map((cohort) => {
    const rows = (cohort.members || []).map((m) => {
      const earned = `Earned today ₦${Number(m.earned_today_ngn || 0).toLocaleString()}`;
      if (!m.in_ramp) {
        return `<div class="policy-row"><div><strong>${escapeHtml(nameForPerson(m.person_id))}</strong><small>Not in a ramp window</small></div><div><small>${earned}</small></div></div>`;
      }
      const hitPct = m.scoreable_days ? Math.round((m.targets_hit / m.scoreable_days) * 100) : 0;
      return `
      <div class="policy-row">
        <div><strong>${escapeHtml(nameForPerson(m.person_id))}</strong>
          <small>Day ${m.day_n}/${m.total_days} · ${escapeHtml(RAMP_PHASE_LABEL[m.phase] || m.phase)}</small>
          <span class="pill">₦${Number(m.daily_target_ngn || 0).toLocaleString()} target</span></div>
        <div><small>${earned} · targets hit ${m.targets_hit}/${m.scoreable_days} (${hitPct}%) · projected bonus ₦${Number(m.projected_bonus_ngn || 0).toLocaleString()}</small></div>
      </div>`;
    }).join("");
    const revenue = Number(cohort.revenue_total_ngn || 0);
    const target = Number(cohort.target_total_ngn || 0);
    const attainmentPct = target > 0 ? Math.round((revenue / target) * 100) : 0;
    return `
      <details class="cohort-card">
        <summary>
          <div class="cohort-head">
            <div><strong>${escapeHtml(cohort.name)}</strong><small>Day 1 ${escapeHtml(String(cohort.start_date).slice(0, 10))} · ${Number(cohort.operator_count || 0)} operator${Number(cohort.operator_count) === 1 ? "" : "s"}</small></div>
            <div class="cohort-metrics">
              <span><strong>₦${revenue.toLocaleString()}</strong> today</span>
              <span><strong>₦${Number(cohort.avg_revenue_ngn || 0).toLocaleString()}</strong> avg/op</span>
              <span><strong>${attainmentPct}%</strong> of target</span>
            </div>
          </div>
        </summary>
        <div class="data-list compact-list">${rows}</div>
      </details>`;
  }).join("");

  el.cohortBoard.innerHTML = overview + cards;
}

// Beds at a site (capacity + live occupancy), from the site-based monitor feed.
function siteBeds(siteId) {
  return state.accommodation.find((s) => s.site_id === siteId) || null;
}
function accommodationHint(operator) {
  const beds = siteBeds(operator.site_id);
  if (!beds) return operator.site_id ? "This site has no beds configured (set them in the HR console)." : "Assign a site first.";
  const held = `${beds.occupied}/${beds.capacity} beds held`;
  const split = `${Number(beds.used || 0)} in use, ${Number(beds.reserved || 0)} reserved`;
  const note = operator.operator_status === "active" ? "" : " · reserves a bed until this rider is activated";
  return `${beds.name}: ${held} (${split})${note}`;
}
// Only block the toggle when the site is full and this operator isn't already housed.
function accommodationDisabled(operator) {
  if (operator.accommodated) return false;
  const beds = siteBeds(operator.site_id);
  return !beds || Number(beds.available) <= 0;
}

// Read-only housing monitor: beds per site vs who's housed there. Capacity is set
// on the site in the HR console; this view shows live occupancy.
function renderAccommodation() {
  const sites = state.accommodation;
  el.accommodationBedsSummary.textContent = sites.reduce((sum, s) => sum + Number(s.capacity || 0), 0);
  el.accommodationList.innerHTML = sites.length ? sites.map((s) => {
    const full = Number(s.available) <= 0;
    const reserved = Number(s.reserved || 0);
    return `
    <article class="policy-row ${s.over_capacity ? "superseded" : ""}">
      <div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(nameForAmoeba(s.amoeba_id))}</small>
        <span class="pill ${full ? "open" : ""}">${Number(s.occupied)}/${Number(s.capacity)} beds</span>${s.over_capacity ? `<span class="pill superseded">over capacity</span>` : ""}</div>
      <div><small>${Number(s.used || 0)} in use${reserved ? ` · ${reserved} reserved (pending)` : ""} · ${Number(s.available)} free</small></div>
    </article>`;
  }).join("") : `<div class="empty">No site has beds yet. Set accommodation beds on a site in the HR console.</div>`;
}

async function refresh(message = "Connected to Fleximotion Ops.") {
  setConnection("", "Connecting");
  setNotice("Loading operational data...");
  const [people, amoebas, sites, users, roleAssignments, operators, vehicles, platformAccounts, alerts, allDailyPerformance, paceProfiles, economicsPolicies, efficiencyPolicies, scheduledJobs, scheduledJobRuns, notificationDeliveries, serviceHealth, trackerInventory, vehiclePositions] = await Promise.all([
    foundation("/identity/v1/people"),
    foundation("/amoeba/v1/amoebas"),
    foundation("/amoeba/v1/sites"),
    foundation("/identity/v1/users").catch(() => ({ data: [] })),
    foundation("/identity/v1/role-assignments").catch(() => ({ data: [] })),
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
  ,
    ops("/ops/v1/tracker/devices").catch(() => ({ configured: false, provider: null, device_count: 0, mapped_count: 0, devices: [] })),
    ops("/ops/v1/vehicle-positions").catch(() => ({ positions: [], no_feed: [] }))]);
  const [leaderboardConfig, inspectionCompliance, fleetPolicy, deliveryCustomers, allocatedPrices, rampProfiles, cohorts, supervisorOnboardings, accommodation, integrationStatus, onboardingSettings] = await Promise.all([
    ops("/ops/v1/leaderboard-config").catch(() => null),
    ops("/ops/v1/inspections/compliance").catch(() => null),
    ops("/ops/v1/fleet-policy").catch(() => null),
    ops("/ops/v1/delivery-customers").catch(() => ({ data: [] })),
    ops("/ops/v1/delivery-allocated-prices").catch(() => ({ data: [] })),
    ops("/ops/v1/onboarding/ramp-profiles").catch(() => ({ data: [] })),
    ops("/ops/v1/onboarding/cohorts").catch(() => ({ data: [] })),
    ops("/ops/v1/supervisor-onboardings").catch(() => ({ data: [] })),
    ops("/ops/v1/accommodation").catch(() => ({ data: [] })),
    ops("/ops/v1/integration-status").catch(() => ({ integrations: [] })),
    ops("/ops/v1/onboarding/settings").catch(() => ({ cohort_anchor_dow: 3 }))
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
  const [teamBoard, dailyPerformance, ingestionRuns, dailyReports, rangedAlerts, cohortBoard] = await Promise.all([
    ops(`/ops/v1/team-board?${range}`),
    ops(`/ops/v1/daily-performance?${range}`),
    ops(`/ops/v1/ingestion-runs?${range}`),
    ops(`/ops/v1/daily-reports?${range}`),
    ops(`/ops/v1/alerts?${range}`),
    ops(`/ops/v1/onboarding/cohort-board?record_date=${operatingDate}`).catch(() => ({ data: [] }))
  ]);
  Object.assign(state, {
    people: people.data,
    users: users.data || [],
    roleAssignments: roleAssignments.data || [],
    amoebas: amoebas.data,
    sites: sites.data,
    operators: operators.data,
    vehicles: vehicles.data,
    platformAccounts: platformAccounts.data,
    alerts: rangedAlerts.data,
    teamBoard: teamBoard.data,
    cohortBoard: cohortBoard.data,
    dailyPerformance: dailyPerformance.data,
    ingestionRuns: ingestionRuns.data,
    paceProfiles: paceProfiles.data,
    economicsPolicies: economicsPolicies.data,
    efficiencyPolicies: efficiencyPolicies.data,
    trackerInventory,
    integrationStatus: (integrationStatus?.integrations || []).filter((row) => row.category === "tracker"),
    vehiclePositions: vehiclePositions || { positions: [], no_feed: [] },
    scheduledJobs: scheduledJobs.data,
    scheduledJobRuns: scheduledJobRuns.data,
    notificationDeliveries: notificationDeliveries.data,
    dailyReports: dailyReports.data,
    serviceHealth,
    leaderboardConfig,
    inspectionCompliance,
    deliveryCustomers: deliveryCustomers.data,
    allocatedPrices: allocatedPrices.data,
    onboardingRampProfiles: rampProfiles.data,
    cohorts: cohorts.data,
    onboardingSettings: onboardingSettings || { cohort_anchor_dow: 3 },
    supervisorOnboardings: supervisorOnboardings.data,
    accommodation: accommodation.data,
    fleetPolicy,
    operatingDate,
    dateFrom,
    dateTo
  });
  if (fleetPolicy) {
    el.fleetPolicySummary.innerHTML = `
      <article class="policy-row">
        <div><strong>Inspection cadence</strong><small>Drives compliance and overdue flags</small></div>
        <div><strong>Every ${Number(fleetPolicy.inspection_interval_hours)}h</strong><small>Preventive service every ${Number(fleetPolicy.service_interval_days)} days</small></div>
      </article>`;
    el.fleetPolicyForm.elements.inspection_interval_hours.value = Number(fleetPolicy.inspection_interval_hours);
    el.fleetPolicyForm.elements.service_interval_days.value = Number(fleetPolicy.service_interval_days);
  }
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

el.vehicleForm.elements.vehicle_type.addEventListener("change", updateVehicleTrackerUi);
el.vehicleTrackerProvider.addEventListener("change", updateVehicleTrackerUi);
updateVehicleTrackerUi();
el.operatorForm.elements.amoeba_id.addEventListener("change", updateSiteOptions);
// Reassignment: changing a roster row's amoeba re-scopes its site and vehicle, and
// updates the derived supervisor note (supervisor follows the amoeba).
el.operatorList.addEventListener("change", (event) => {
  const amoebaSelect = event.target.closest("[data-operator-amoeba]");
  if (!amoebaSelect) return;
  const row = amoebaSelect.closest("[data-operator-id]");
  const amoebaId = amoebaSelect.value;
  row.querySelector("[data-operator-site]").innerHTML = rowSiteOptions(amoebaId, "");
  row.querySelector("[data-operator-vehicle]").innerHTML = rowVehicleOptions(amoebaId, "");
  const note = row.querySelector("[data-operator-supervisor-note]");
  if (note) {
    const amoeba = state.amoebas.find((a) => a.amoeba_id === amoebaId);
    note.textContent = `Supervisor: ${amoeba?.supervisor_person_id ? nameForPerson(amoeba.supervisor_person_id) : "set on the amoeba (HR console)"}`;
  }
});
el.ingestionForm.elements.operator_id.addEventListener("change", updateRegistrationOptions);
el.alertFilter.addEventListener("change", render);
el.performanceAmoebaFilter.addEventListener("change", () => {
  el.performanceOperatorFilter.value = "";
  render();
});
el.performanceOperatorFilter.addEventListener("change", render);
el.vehicleAmoebaFilter.addEventListener("change", render);
el.vehicleSearch.addEventListener("input", render);
el.operatorAmoebaFilter.addEventListener("change", render);
el.operatorSearch.addEventListener("input", render);
el.paceProfileForm.elements.vehicle_type.addEventListener("change", syncPaceProfileForm);
el.efficiencyPolicyForm.elements.vehicle_type.addEventListener("change", syncEfficiencyPolicyForm);
// Changing the effective date flips the form between "correct this version" and
// "new version", so keep the mode line + submit label in step as it is typed.
el.paceProfileForm.elements.effective_from.addEventListener("input", refreshPaceFormUi);
el.efficiencyPolicyForm.elements.effective_from.addEventListener("input", refreshEfficiencyFormUi);
el.economicsPolicyForm.elements.effective_from.addEventListener("input", refreshEconomicsFormUi);
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
      if (!el.operatorAmoebaFilter.value) el.operatorAmoebaFilter.value = "__all";
    }
    if (target === "vehicles") {
      document.getElementById("vehiclePanel").open = true;
      if (!el.vehicleAmoebaFilter.value) el.vehicleAmoebaFilter.value = "__all";
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
  // Tankvolt has no device list — the VIN must be entered to track/control it.
  if (body.tracker_provider === "tankvolt" && !String(body.tracker_device_id || "").trim()) {
    showError(new Error("Electric (Tankvolt) bikes need the bike VIN entered."));
    return;
  }
  if (!body.tracker_provider) delete body.tracker_provider;
  if (!String(body.tracker_device_id || "").trim()) delete body.tracker_device_id;
  try {
    await ops("/ops/v1/vehicles", {
      method: "POST",
      headers: { "Idempotency-Key": key("vehicle") },
      body: JSON.stringify(body)
    });
    el.vehicleForm.reset();
    updateVehicleTrackerUi();
    await refresh("Vehicle added — check the Tracker column for its tracking status.");
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
        daily_target_accommodated_ngn: values.daily_target_accommodated_ngn === "" ? null : Number(values.daily_target_accommodated_ngn),
        checkpoints: [
          { time: "12:00", expected_pct: Number(values.noon_pct) },
          { time: "16:00", expected_pct: Number(values.afternoon_pct) },
          { time: "19:00", expected_pct: Number(values.evening_pct) },
          { time: "21:00", expected_pct: 100 }
        ],
        warning_tolerance_pct: Number(values.warning_tolerance_pct),
        critical_tolerance_pct: Number(values.critical_tolerance_pct),
        delivery_parcels_per_hour: Number(values.delivery_parcels_per_hour),
        delivery_journey_buffer_hours: Number(values.delivery_journey_buffer_hours),
        effective_from: values.effective_from
      })
    });
    el.paceProfileForm.closest("details").open = false;
    await refresh("Revenue pace profile saved — the list shows the current version per vehicle type.");
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
        price_per_unit_ngn: values.price_per_unit_ngn === "" ? null : Number(values.price_per_unit_ngn),
        effective_from: values.effective_from
      })
    });
    el.efficiencyPolicyForm.closest("details").open = false;
    await refresh("Vehicle efficiency policy saved — same effective date updates that version in place.");
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

el.fleetPolicyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.fleetPolicyForm));
  try {
    await ops("/ops/v1/fleet-policy", {
      method: "POST",
      headers: { "Idempotency-Key": key("fleet-policy") },
      body: JSON.stringify({
        inspection_interval_hours: Number(values.inspection_interval_hours),
        service_interval_days: Number(values.service_interval_days)
      })
    });
    await refresh("Fleet policy saved.");
  } catch (error) { showError(error); }
});

el.leaderboardConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.leaderboardConfigForm));
  // The four weights define shares of one score, so they must add up to 1.
  const weightSum = ["acceptance_weight", "online_weight", "cash_weight", "revenue_weight"]
    .reduce((total, field) => total + Number(values[field] || 0), 0);
  if (Math.abs(weightSum - 1) > 0.001) {
    showError(new Error(`The four weights must add up to 1.00 — they currently total ${weightSum.toFixed(2)}.`));
    return;
  }
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

el.deliveryCustomerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.deliveryCustomerForm));
  try {
    await ops("/ops/v1/delivery-customers", {
      method: "POST",
      headers: { "Idempotency-Key": key("dcustomer") },
      body: JSON.stringify({ name: values.name, contract_price_ngn: Number(values.contract_price_ngn), contact: values.contact || null })
    });
    el.deliveryCustomerForm.reset();
    await refresh("Delivery customer added.");
  } catch (error) { showError(error); }
});

// Delete an allocated-price version (e.g. clearing the stale seed).
el.allocatedPriceList.addEventListener("click", async (event) => {
  const del = event.target.closest("[data-delete-allocated]");
  if (!del) return;
  if (!window.confirm(`Delete the ${del.dataset.priceLabel} allocated price? (You can't delete the last remaining price.)`)) return;
  try {
    await ops(`/ops/v1/delivery-allocated-prices/${del.dataset.deleteAllocated}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": key("allocated-del") }
    });
    await refresh("Allocated price deleted.");
  } catch (error) { showError(error); }
});

// Edit a specific policy version: load that exact row into its form, open the
// panel, and let the mode line / submit label show "correct" vs "new version".
function openPolicyPanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.open = true;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
document.addEventListener("click", (event) => {
  const editPace = event.target.closest("[data-edit-pace]");
  const editEff = event.target.closest("[data-edit-efficiency]");
  const editEcon = event.target.closest("[data-edit-economics]");
  if (editPace) {
    const profile = state.paceProfiles.find((x) => x.pace_profile_id === editPace.dataset.editPace);
    if (profile) { fillPaceForm(profile); openPolicyPanel("paceProfilePanel"); }
  } else if (editEff) {
    const policy = state.efficiencyPolicies.find((x) => x.efficiency_policy_id === editEff.dataset.editEfficiency);
    if (policy) { fillEfficiencyForm(policy); openPolicyPanel("efficiencyPolicyPanel"); }
  } else if (editEcon) {
    const policy = state.economicsPolicies.find((x) => x.economics_policy_id === editEcon.dataset.editEconomics);
    if (policy) { fillEconomicsForm(policy); openPolicyPanel("economicsPolicyPanel"); }
  }
});

// Inline edit for delivery customers (contract price / contact / status).
el.deliveryCustomerList.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-customer]");
  const cancel = event.target.closest("[data-cancel-customer]");
  const save = event.target.closest("[data-save-customer]");
  const del = event.target.closest("[data-delete-customer]");
  if (edit) { editingCustomerId = edit.dataset.editCustomer; render(); return; }
  if (cancel) { editingCustomerId = null; render(); return; }
  if (del) {
    const name = del.dataset.customerName || "this customer";
    if (!window.confirm(`Delete "${name}"? This cannot be undone. (Customers with delivery batches or import history can't be deleted — set them inactive instead.)`)) return;
    try {
      await ops(`/ops/v1/delivery-customers/${del.dataset.deleteCustomer}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": key("dcustomer-del") }
      });
      await refresh(`Deleted "${name}".`);
    } catch (error) { showError(error); }
    return;
  }
  if (save) {
    const row = save.closest("[data-customer-row]");
    const field = (name) => row.querySelector(`[data-field="${name}"]`);
    const body = {
      contract_price_ngn: Number(field("contract_price_ngn").value),
      contact: field("contact").value.trim() || null,
      status: field("status").value
    };
    try {
      await ops(`/ops/v1/delivery-customers/${save.dataset.saveCustomer}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": key("dcustomer-edit") },
        body: JSON.stringify(body)
      });
      editingCustomerId = null;
      await refresh("Delivery customer updated.");
    } catch (error) { showError(error); }
  }
});

el.allocatedPriceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.allocatedPriceForm));
  try {
    await ops("/ops/v1/delivery-allocated-prices", {
      method: "POST",
      headers: { "Idempotency-Key": key("allocated") },
      body: JSON.stringify({
        price_ngn: Number(values.price_ngn),
        operator_class: values.operator_class || "all",
        daily_basic_ngn: Number(values.daily_basic_ngn || 0),
        delivery_customer_id: values.delivery_customer_id || null,
        effective_from: values.effective_from
      })
    });
    el.allocatedPriceForm.reset();
    el.allocatedPriceForm.elements.effective_from.value = todayLagos;
    await refresh("Allocated price saved.");
  } catch (error) { showError(error); }
});

el.onboardingRampForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.onboardingRampForm));
  const targets = String(values.daily_targets_ngn).split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  try {
    await ops("/ops/v1/onboarding/ramp-profiles", {
      method: "POST",
      headers: { "Idempotency-Key": key("ramp") },
      body: JSON.stringify({
        operator_class: values.operator_class,
        daily_targets_ngn: targets,
        scheduled_from_day: Number(values.scheduled_from_day),
        rest_day_of_week: Number(values.rest_day_of_week),
        completion_bonus_ngn: Number(values.completion_bonus_ngn || 0),
        missed_day_reduction_pct: Number(values.missed_day_reduction_pct || 0),
        effective_from: values.effective_from
      })
    });
    el.onboardingRampForm.closest("details").open = false;
    await refresh("Onboarding ramp profile saved.");
  } catch (error) { showError(error); }
});

el.onboardingSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.onboardingSettingsForm));
  try {
    await ops("/ops/v1/onboarding/settings", {
      method: "POST",
      headers: { "Idempotency-Key": key("onboarding-settings") },
      body: JSON.stringify({ cohort_anchor_dow: Number(values.cohort_anchor_dow) })
    });
    await refresh("Cohort Day-1 weekday saved — applies to cohorts created from now on.");
  } catch (error) { showError(error); }
});

el.cohortMemberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.cohortMemberForm));
  try {
    await ops(`/ops/v1/onboarding/cohorts/${values.cohort_id}/members`, {
      method: "POST",
      headers: { "Idempotency-Key": key("cohortmember") },
      body: JSON.stringify({ operator_ids: [values.operator_id] })
    });
    await refresh("Rider added to cohort.");
  } catch (error) { showError(error); }
});

el.supervisorOnboardingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.supervisorOnboardingForm));
  try {
    await ops("/ops/v1/supervisor-onboardings", {
      method: "POST",
      headers: { "Idempotency-Key": key("supon") },
      body: JSON.stringify({
        supervisor_person_id: values.supervisor_person_id,
        host_amoeba_id: values.host_amoeba_id,
        mentor_person_id: values.mentor_person_id || null,
        start_date: values.start_date
      })
    });
    el.supervisorOnboardingForm.closest("details").open = false;
    await refresh("Supervisor onboarding started.");
  } catch (error) { showError(error); }
});

el.supervisorOnboardingList.addEventListener("click", async (event) => {
  const advance = event.target.closest("[data-advance-supervisor]");
  const graduate = event.target.closest("[data-graduate-supervisor]");
  try {
    if (advance) {
      await ops(`/ops/v1/supervisor-onboardings/${advance.dataset.advanceSupervisor}/phase`, {
        method: "POST",
        headers: { "Idempotency-Key": key("supphase") },
        body: JSON.stringify({ phase: advance.dataset.phase })
      });
      await refresh("Supervisor phase updated.");
    } else if (graduate) {
      const route = window.prompt(`Graduate ${graduate.dataset.supervisorName}. Type the target amoeba_id they will run (leave blank to record without one):`, "");
      if (route === null) return;
      await ops(`/ops/v1/supervisor-onboardings/${graduate.dataset.graduateSupervisor}/graduate`, {
        method: "POST",
        headers: { "Idempotency-Key": key("supgrad") },
        body: JSON.stringify({ graduation_route: "reassign", target_amoeba_id: route.trim() || null })
      });
      await refresh("Supervisor graduated. Reassign their team from the Roster.");
    }
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
  const trackerPull = event.target.closest("[data-tracker-pull]");
  if (trackerPull) {
    trackerPull.disabled = true;
    trackerPull.textContent = "Pulling…";
    try {
      const result = await ops("/ops/v1/tracker/ingest", {
        method: "POST",
        headers: { "Idempotency-Key": key("tracker-pull") },
        body: JSON.stringify({})
      });
      await refresh(`Tracker pull complete — ${result.upserted} distance${result.upserted === 1 ? "" : "s"} stored, ${result.rejected} skipped.`);
    } catch (error) { showError(error); }
    return;
  }

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
          <td>${escapeHtml(nameForPerson(row.person_id))}${row.accommodated ? ` <span class="pill" title="${escapeHtml(row.accommodation_name || "Company accommodation")}">🏠</span>` : ` <span class="pill superseded" title="Not accommodated">no acc.</span>`}</td>
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
        <div><strong>${escapeHtml(nameForPerson(item.person_id))}</strong><small>${escapeHtml(item.vehicle_plate || "No vehicle")} · ${escapeHtml(item.current_status.replaceAll("_", " "))}</small>${item.accommodated ? `<span class="pill" title="${escapeHtml(item.accommodation_name || "Company accommodation")}">🏠 accommodated</span>` : `<span class="pill superseded">not accommodated</span>`}</div>
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
    const accommodatedBox = row.querySelector("[data-operator-accommodated]");
    const siteId = row.querySelector("[data-operator-site]").value;
    const target = row.querySelector("[data-operator-target]").value;
    if (!siteId) { showError("Pick a site for the selected amoeba before saving."); return; }
    try {
      await ops(`/ops/v1/operators/${saveOperator.dataset.saveOperator}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": key("operator-update") },
        body: JSON.stringify({
          operator_status: row.querySelector("[data-operator-status]").value,
          accommodated: accommodatedBox ? accommodatedBox.checked : undefined,
          amoeba_id: row.querySelector("[data-operator-amoeba]").value,
          site_id: siteId,
          vehicle_id: row.querySelector("[data-operator-vehicle]").value || null,
          daily_revenue_target_ngn: target === "" ? null : Number(target)
        })
      });
      await refresh("Operator updated.");
    } catch (error) { showError(error); }
    return;
  }

  if (registerOperator) {
    openPlatformDialog(registerOperator.dataset.registerOperator);
  }
});

// Platform registration: a proper dialog (dropdown of platform accounts + the
// operator's ID on that platform), with inline feedback, replacing the old
// browser prompts. Stays open after a successful add so a rider on several
// platforms can be registered in one sitting.
function openPlatformDialog(operatorId) {
  if (!state.platformAccounts.length) { showError(new Error("No platform accounts are configured yet.")); return; }
  el.platformDialog.dataset.operatorId = operatorId;
  el.platformDialogContext.textContent = `Registering ${nameForPerson(state.operators.find((o) => o.operator_id === operatorId)?.person_id)} — add one entry per platform the rider works on.`;
  el.platformForm.elements.platform_account_id.innerHTML = state.platformAccounts
    .map((item) => `<option value="${escapeHtml(item.platform_account_id)}">${escapeHtml(item.display_name)}</option>`).join("");
  el.platformForm.elements.platform_operator_id.value = "";
  el.platformDialogResult.textContent = "";
  el.platformDialogResult.className = "dialog-note";
  el.platformDialog.showModal();
  el.platformForm.elements.platform_operator_id.focus();
}

el.platformForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const operatorId = el.platformDialog.dataset.operatorId;
  const accountId = el.platformForm.elements.platform_account_id.value;
  const externalId = el.platformForm.elements.platform_operator_id.value.trim();
  if (!externalId) return;
  const accountName = state.platformAccounts.find((item) => item.platform_account_id === accountId)?.display_name || accountId;
  const submitButton = el.platformForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await ops(`/ops/v1/operators/${operatorId}/platform-registrations`, {
      method: "POST",
      headers: { "Idempotency-Key": key("platform-registration") },
      body: JSON.stringify({ platform_account_id: accountId, platform_operator_id: externalId, registration_status: "active" })
    });
    el.platformDialogResult.textContent = `✓ Added on ${accountName}.`;
    el.platformDialogResult.className = "dialog-note ok";
    el.platformForm.elements.platform_operator_id.value = "";
    el.platformForm.elements.platform_operator_id.focus();
    await refresh("Platform registration added.");
  } catch (error) {
    el.platformDialogResult.textContent = `✕ ${error.message}`;
    el.platformDialogResult.className = "dialog-note err";
  } finally {
    submitButton.disabled = false;
  }
});

el.platformDialog.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-platform]")) el.platformDialog.close();
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
  unlockSubmitButtons();
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

if (window.AdminKit) {
  AdminKit.mountViews({ defaultView: "overview" });
  AdminKit.wireNavSearch(document.getElementById("navSearch"));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
refresh().catch(showError);
