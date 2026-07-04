const state = {
  people: [],
  operators: [],
  alerts: [],
  teamBoard: [],
  dailyPerformance: [],
  fuelIssues: [],
  mileageReconciliations: [],
  operatingDate: null
};

const el = Object.fromEntries([
  "notice", "connectionText", "activeOperatorCount", "liveOperatorCount",
  "openAlertCount", "carRevenueTotal", "bikeRevenueTotal", "alertList", "alertFilter", "teamBoard",
  "boardUpdated", "performanceList", "operatingDate", "actionDialog",
  "dialogTitle", "dialogContext", "dialogNotes", "confirmActionButton",
  "fuelIssueForm", "mileageList"
].map((id) => [id, document.getElementById(id)]));

const query = new URLSearchParams(location.search);
const opsApiBase = query.get("opsApiBase") || "http://127.0.0.1:4030";
const foundationApiBase = query.get("foundationApiBase") || "http://127.0.0.1:4010";
const token = query.get("token") || "flexi-dev-service-token";
let actorPersonId = query.get("actorPersonId") || "person_founder_wole";
const todayLagos = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.operatingDate.value = todayLagos;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || `Request failed: ${response.status}`);
  return body;
}

const ops = (path, options) => request(opsApiBase, path, options);
const foundation = (path) => request(foundationApiBase, path);
const personName = (id) => state.people.find((person) => person.person_id === id)?.display_name || id;

function render() {
  const live = state.teamBoard.filter((item) => !["offline", "not_seen_today"].includes(item.current_status)).length;
  const revenueByVehicleType = state.dailyPerformance.reduce((totals, record) => {
    const vehicleType = record.platform_vehicle_type || record.vehicle_type;
    if (vehicleType === "car") totals.car += Number(record.ride_revenue_ngn || 0);
    if (vehicleType === "motorbike") totals.motorbike += Number(record.ride_revenue_ngn || 0);
    return totals;
  }, { car: 0, motorbike: 0 });
  el.activeOperatorCount.textContent = state.teamBoard.length;
  el.liveOperatorCount.textContent = live;
  el.openAlertCount.textContent = state.alerts.filter((item) => item.resolution_status === "open").length;
  el.carRevenueTotal.textContent = `₦${revenueByVehicleType.car.toLocaleString()}`;
  el.bikeRevenueTotal.textContent = `₦${revenueByVehicleType.motorbike.toLocaleString()}`;
  el.boardUpdated.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;

  el.teamBoard.innerHTML = state.teamBoard.length ? state.teamBoard.map((item) => {
    const target = Number(item.daily_revenue_target_ngn || 0);
    const itemRevenue = Number(item.ride_revenue_ngn || 0);
    const progress = target ? Math.min(100, Math.round(itemRevenue / target * 100)) : 0;
    const risk = Number(item.open_alerts) > 0 || item.pace_status === "at_risk"
      ? "alert"
      : ["offline", "not_seen_today"].includes(item.current_status) || item.pace_status === "behind" ? "watch" : "clear";
    const expected = Number(item.expected_revenue_ngn || 0);
    const paceLabel = String(item.pace_status || "not_available").replaceAll("_", " ");
    const expectedLabel = state.operatingDate < todayLagos ? "Expected by close" : "Expected now";
    return `
      <article class="operator-tile risk-${risk}">
        <div class="tile-heading">
          <div><strong>${escapeHtml(personName(item.person_id))}</strong><small>${escapeHtml(item.vehicle_plate || "No vehicle")}</small></div>
          <span class="risk-badge">${risk}</span>
        </div>
        <div class="tile-status"><span class="status-dot ${escapeHtml(item.current_status)}"></span>${escapeHtml(item.current_status.replaceAll("_", " "))}<small>${item.last_seen_at ? `Last seen ${new Date(item.last_seen_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}` : "No platform activity"}</small></div>
        <div class="pace-line">
          <span class="pace-status ${escapeHtml(item.pace_status)}">${escapeHtml(paceLabel)}</span>
          <small>${expectedLabel} ₦${expected.toLocaleString()} · ${item.pace_variance_pct === null ? "No variance" : `${Number(item.pace_variance_pct) > 0 ? "+" : ""}${Number(item.pace_variance_pct).toFixed(1)}%`}</small>
        </div>
        <div class="progress-label"><span>Actual ₦${itemRevenue.toLocaleString()} · Target ₦${target.toLocaleString()}</span><strong>${progress}%</strong></div>
        <div class="progress-track"><span style="width:${progress}%"></span></div>
        <div class="tile-stats"><span><strong>${Number(item.trips_total)}</strong> trips</span><span><strong>${Number(item.hours_online).toFixed(1)}</strong> hours</span><span><strong>${Number(item.open_alerts)}</strong> alerts</span></div>
        <div class="platform-line">${item.platforms.map((platform) => `<span class="${platform.vehicle_type === "car" ? "car" : "bike"}">${escapeHtml(platform.vehicle_type === "car" ? "Car" : "Bike")} · ${escapeHtml(platform.display_name)}</span>`).join("") || "<span>No feed</span>"}</div>
      </article>`;
  }).join("") : `<div class="empty">No assigned operators match this view.</div>`;

  const filter = el.alertFilter.value;
  const alerts = filter ? state.alerts.filter((alert) => alert.resolution_status === filter) : state.alerts;
  el.alertList.innerHTML = alerts.length ? alerts.map((alert) => `
    <article class="alert-row tier-${escapeHtml(alert.tier)}">
      <div><strong>${escapeHtml(alert.alert_type.replaceAll("_", " "))}</strong><small>${escapeHtml(personName(alert.person_id))}</small></div>
      <div><span class="row-label">Platform</span><strong>${escapeHtml(alert.platform_display_name || "General")}</strong><small>Tier ${escapeHtml(alert.tier)}</small></div>
      <div><span class="row-label">Fired</span><strong>${new Date(alert.fired_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</strong></div>
      <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(alert.resolution_status)}</span></div>
      <div class="row-actions">
        ${alert.resolution_status === "open" ? `<button type="button" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>` : ""}
        ${alert.resolution_status !== "resolved" ? `<button type="button" class="secondary" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.alert_id)}">Resolve</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="empty">No alerts match this view.</div>`;

  el.performanceList.innerHTML = state.dailyPerformance.length ? state.dailyPerformance.map((record) => `
    <article class="performance-row">
      <div class="performance-person"><strong>${escapeHtml(personName(record.person_id))}</strong><small>${escapeHtml(record.platform_vehicle_type === "car" ? "Car" : "Bike")} · ${escapeHtml(record.platform_display_name)}</small></div>
      <dl>
        <div><dt>Trips</dt><dd>${escapeHtml(record.trips_total)}</dd></div>
        <div><dt>Revenue</dt><dd>₦${Number(record.ride_revenue_ngn).toLocaleString()}</dd></div>
        <div><dt>Hours</dt><dd>${Number(record.hours_online).toFixed(1)}</dd></div>
        <div><dt>Acceptance</dt><dd>${Number(record.acceptance_pct || 0).toFixed(0)}%</dd></div>
      </dl>
      <span class="pill">${escapeHtml(record.current_status.replaceAll("_", " "))}</span>
    </article>
  `).join("") : `<div class="empty">No performance records for this date.</div>`;

  const fuelOperators = state.operators.filter((operator) => operator.vehicle_id);
  el.fuelIssueForm.elements.operator_id.innerHTML = fuelOperators.map((operator) =>
    `<option value="${escapeHtml(operator.operator_id)}">${escapeHtml(personName(operator.person_id))} · ${escapeHtml(operator.vehicle_plate)}</option>`
  ).join("");
  el.mileageList.innerHTML = state.mileageReconciliations.length ? state.mileageReconciliations.map((record) => `
    <article class="mileage-row">
      <div><strong>${escapeHtml(personName(record.person_id))}</strong><small>${escapeHtml(record.plate)} · ${escapeHtml(record.vehicle_type)}</small></div>
      <dl>
        <div><dt>Fuel issued</dt><dd>${record.fuel_quantity === null ? "Not confirmed" : `${Number(record.fuel_quantity)} ${escapeHtml(record.fuel_unit)}`}</dd></div>
        <div><dt>Expected</dt><dd>${record.expected_distance_km === null ? "Unavailable" : `${Number(record.expected_distance_km)} km`}</dd></div>
        <div><dt>Official</dt><dd>${record.official_distance_km === null ? "No platform data" : `${Number(record.official_distance_km)} km`}</dd></div>
        <div><dt>Tracker</dt><dd>${record.tracker_distance_km === null ? escapeHtml(record.tracker_variance_status.replaceAll("_", " ")) : `${Number(record.tracker_distance_km)} km`}</dd></div>
      </dl>
      <div class="mileage-status">
        <span class="pill ${escapeHtml(record.official_distance_status)}">${escapeHtml(record.official_distance_status.replaceAll("_", " "))}</span>
        <span class="pill ${escapeHtml(record.tracker_variance_status)}">${escapeHtml(record.tracker_variance_status.replaceAll("_", " "))}</span>
      </div>
    </article>
  `).join("") : `<div class="empty">No assigned vehicles available for reconciliation.</div>`;
}

async function refresh(message = "Connected to Fleximotion Ops.") {
  setConnection("", "Connecting");
  setNotice("Loading team data...");
  const [people, operators, alerts, allPerformance] = await Promise.all([
    foundation("/identity/v1/people"),
    ops("/ops/v1/operators"),
    ops("/ops/v1/alerts"),
    ops("/ops/v1/daily-performance")
  ]);
  if (!query.get("actorPersonId")) {
    actorPersonId = people.data.find((person) => person.display_name.toLowerCase() === "tunde")?.person_id
      || operators.data.find((operator) => operator.supervisor_person_id)?.supervisor_person_id
      || actorPersonId;
  }
  const assigned = operators.data.filter((operator) => operator.supervisor_person_id === actorPersonId);
  const assignedIds = new Set(assigned.map((operator) => operator.operator_id));
  const availableDates = [...new Set(allPerformance.data
    .filter((record) => assignedIds.has(record.operator_id))
    .map((record) => String(record.record_date).slice(0, 10)))].sort().reverse();
  const requestedDate = el.operatingDate.value;
  const operatingDate = availableDates.includes(requestedDate) ? requestedDate : (availableDates[0] || requestedDate || todayLagos);
  el.operatingDate.value = operatingDate;
  const [teamBoard, fuelIssues, mileageReconciliations] = await Promise.all([
    ops(`/ops/v1/team-board?record_date=${operatingDate}`),
    ops(`/ops/v1/fuel-issues?operating_date=${operatingDate}`),
    ops(`/ops/v1/mileage-reconciliations?record_date=${operatingDate}`)
  ]);
  Object.assign(state, {
    people: people.data,
    operators: assigned,
    alerts: alerts.data.filter((alert) => assignedIds.has(alert.operator_id)),
    teamBoard: teamBoard.data.filter((item) => assignedIds.has(item.operator_id)),
    dailyPerformance: allPerformance.data.filter((record) => assignedIds.has(record.operator_id) && String(record.record_date).slice(0, 10) === operatingDate),
    fuelIssues: fuelIssues.data.filter((record) => assignedIds.has(record.operator_id)),
    mileageReconciliations: mileageReconciliations.data.filter((record) => assignedIds.has(record.operator_id)),
    operatingDate
  });
  render();
  setConnection("connected", "Team data connected");
  setNotice(message);
}

el.alertFilter.addEventListener("change", render);
document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
el.operatingDate.addEventListener("change", () => refresh(`Showing team activity for ${el.operatingDate.value}.`).catch(showError));

el.fuelIssueForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.fuelIssueForm));
  const operator = state.operators.find((item) => item.operator_id === values.operator_id);
  if (!operator?.vehicle_id) return showError(new Error("Select an operator with an assigned vehicle."));
  try {
    await ops("/ops/v1/fuel-issues", {
      method: "POST",
      headers: { "Idempotency-Key": key("fuel-issue") },
      body: JSON.stringify({
        operator_id: operator.operator_id,
        vehicle_id: operator.vehicle_id,
        operating_date: state.operatingDate,
        quantity: Number(values.quantity),
        unit: "litres",
        notes: values.notes || null
      })
    });
    el.fuelIssueForm.reset();
    await refresh("Fuel issue confirmed.");
  } catch (error) { showError(error); }
});

let pendingAction = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alert-action]");
  if (!button) return;
  const alert = state.alerts.find((item) => item.alert_id === button.dataset.alertId);
  pendingAction = { type: button.dataset.alertAction, alert };
  el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge alert" : "Resolve alert";
  el.dialogContext.textContent = `${alert.alert_type.replaceAll("_", " ")} · ${personName(alert.person_id)}`;
  el.dialogNotes.value = "";
  el.actionDialog.showModal();
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
refresh().catch(showError);
