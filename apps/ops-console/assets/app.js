const state = {
  people: [],
  operators: [],
  alerts: [],
  teamBoard: [],
  dailyPerformance: [],
  fuelIssues: [],
  mileageReconciliations: [],
  incidents: [],
  inspections: [],
  compliance: null,
  maintenance: [],
  vehicles: [],
  closeouts: [],
  deliveryBatches: [],
  deliveryAssignments: [],
  deliveryExceptions: [],
  deliveryCustomers: [],
  deliverySummary: null,
  operatingDate: null,
  dateFrom: null,
  dateTo: null
};

const el = Object.fromEntries([
  "notice", "connectionText", "teamBoard", "boardUpdated", "performanceList",
  "dateFrom", "dateTo", "actionDialog", "dialogTitle", "dialogContext",
  "dialogNotes", "confirmActionButton", "fuelIssueForm", "mileageList",
  "incidentList", "inspectionForm", "inspectionList", "inspectionComplianceLabel",
  "maintenanceForm", "maintenanceList", "alertList", "alertFilter",
  "topActions", "conditionGrid", "carRevenueChip", "bikeRevenueChip",
  "deliveryList", "deliveryBatchForm", "deliverySummaryLabel",
  "teamCountChip", "closeoutList", "alertDockBadge", "scopeLabel",
  "operatorDialog", "operatorDialogTitle", "operatorDialogBody"
].map((id) => [id, document.getElementById(id)]));

const query = new URLSearchParams(location.search);
const opsApiBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const foundationApiBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const token = window.flexiServiceToken();
let actorPersonId = query.get("actorPersonId") || "person_founder_wole";
let openOperatorId = null;
const todayLagos = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.dateFrom.value = todayLagos;
el.dateTo.value = todayLagos;

/* ---------- helpers ---------- */

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
const personPhone = (id) => state.people.find((person) => person.person_id === id)?.phone || null;
const money = (value) => `₦${Number(value || 0).toLocaleString()}`;
const timeOf = (value) => new Date(value).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

/* ---------- camera photo evidence ---------- */

// Captured photos staged per form until submit. The input uses
// capture="environment" so phones open the camera directly (not the
// gallery); captured_at is stamped at capture time and the server can
// enforce a freshness window via MEDIA_STRICT_CAPTURE.
const stagedPhotos = { inspection: null, maintenance: null, dexception: null };

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxEdge = 1280;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    image.onerror = () => reject(new Error("Could not read the captured photo."));
    image.src = URL.createObjectURL(file);
  });
}

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 }
    );
  });
}

async function stagePhoto(kind, file) {
  const statusEl = document.querySelector(`[data-photo-status="${kind}"]`);
  statusEl.textContent = "Processing…";
  try {
    const base64 = await compressPhoto(file);
    stagedPhotos[kind] = { base64, capturedAt: new Date().toISOString() };
    statusEl.textContent = `Photo attached ${timeOf(stagedPhotos[kind].capturedAt)} ✓`;
  } catch (error) {
    stagedPhotos[kind] = null;
    statusEl.textContent = error.message;
  }
}

async function uploadStagedPhoto(kind, mediaKind) {
  const staged = stagedPhotos[kind];
  if (!staged) return [];
  const gps = await currentPosition();
  const media = await ops("/ops/v1/media", {
    method: "POST",
    headers: { "Idempotency-Key": key("media") },
    body: JSON.stringify({
      kind: mediaKind,
      content_type: "image/jpeg",
      content_base64: staged.base64,
      captured_at: staged.capturedAt,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null
    })
  });
  stagedPhotos[kind] = null;
  const statusEl = document.querySelector(`[data-photo-status="${kind}"]`);
  if (statusEl) statusEl.textContent = "";
  return [media.media_id];
}

async function openEvidence(mediaId) {
  try {
    const response = await fetch(`${opsApiBase}/ops/v1/media/${mediaId}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Could not load the photo.");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) { showError(error); }
}

function evidenceChips(mediaIds) {
  const ids = Array.isArray(mediaIds) ? mediaIds : [];
  return ids.map((id, index) =>
    `<button type="button" class="evidence-chip" data-open-evidence="${escapeHtml(id)}">📷 Photo ${ids.length > 1 ? index + 1 : ""}</button>`
  ).join("");
}

/* ---------- tab navigation ---------- */

const TABS = ["cockpit", "board", "alerts", "deliveries", "fuel", "field", "closeout"];
function activateTab(name) {
  const tab = TABS.includes(name) ? name : "cockpit";
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.tab === tab));
  document.querySelectorAll("[data-tab-link]").forEach((link) => link.classList.toggle("active", link.dataset.tabLink === tab));
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", () => activateTab(location.hash.slice(1)));
activateTab(location.hash.slice(1));

/* ---------- derived team analysis ---------- */

function vehicleIssueIds() {
  const overdue = new Set((state.compliance?.vehicles || [])
    .filter((vehicle) => vehicle.inspection_status !== "current")
    .map((vehicle) => vehicle.vehicle_id));
  const inRepair = new Set(state.maintenance
    .filter((report) => report.status !== "resolved")
    .map((report) => report.vehicle_id));
  return { overdue, inRepair };
}

function analyseTeam() {
  const issues = vehicleIssueIds();
  const fuelConfirmed = new Set(state.fuelIssues.map((issue) => issue.operator_id));
  const mileageExceptions = state.mileageReconciliations.filter((row) =>
    ["over_variance", "under_variance", "unexplained_distance", "no_fuel_issue"].includes(row.official_distance_status)
    || row.tracker_variance_status === "over_variance");
  const exceptionOperatorIds = new Set(mileageExceptions.map((row) => row.operator_id));

  const rows = state.teamBoard.map((item) => {
    const operator = state.operators.find((candidate) => candidate.operator_id === item.operator_id);
    const alerts = state.alerts.filter((alert) => alert.operator_id === item.operator_id && alert.resolution_status !== "resolved");
    const openIncidents = state.incidents.filter((incident) => incident.operator_id === item.operator_id && incident.status !== "resolved");
    const vehicleIssue = operator?.vehicle_id && (issues.overdue.has(operator.vehicle_id) || issues.inRepair.has(operator.vehicle_id));
    const fuelRisk = exceptionOperatorIds.has(item.operator_id)
      || (operator?.vehicle_id && !fuelConfirmed.has(item.operator_id) && state.dateTo === todayLagos);
    const offlineAfterOnline = item.current_status === "offline" && Number(item.hours_online) > 0;
    return { ...item, operator, alerts, openIncidents, vehicleIssue, fuelRisk, offlineAfterOnline };
  });

  const onDeliveryIds = new Set(state.deliveryAssignments
    .filter((assignment) => assignment.batch_status !== "closed" && assignment.status !== "completed")
    .map((assignment) => assignment.operator_id));
  const groups = [
    { id: "on_delivery", label: "On delivery", tone: "green", rows: rows.filter((row) => onDeliveryIds.has(row.operator_id)) },
    { id: "not_seen", label: "Not seen today", tone: "red", rows: rows.filter((row) => row.current_status === "not_seen_today" && !onDeliveryIds.has(row.operator_id)) },
    { id: "offline_after_online", label: "Offline after coming online", tone: "red", rows: rows.filter((row) => row.offlineAfterOnline) },
    { id: "open_alert", label: "Open alert", tone: "red", rows: rows.filter((row) => row.alerts.length || row.openIncidents.length) },
    { id: "behind", label: "Behind pace", tone: "yellow", rows: rows.filter((row) => ["behind", "at_risk"].includes(row.pace_status) && row.current_status !== "not_seen_today") },
    { id: "fuel_risk", label: "Fuel or mileage risk", tone: "yellow", rows: rows.filter((row) => row.fuelRisk) },
    { id: "vehicle_issue", label: "Vehicle issue", tone: "yellow", rows: rows.filter((row) => row.vehicleIssue) },
    { id: "on_track", label: "Online and on track", tone: "green", rows: rows.filter((row) => !["not_seen_today", "offline"].includes(row.current_status) && !["behind", "at_risk"].includes(row.pace_status) && !row.alerts.length) }
  ];
  
  return { rows, groups, mileageExceptions, fuelConfirmed, issues };
}

function closeoutChecklist(analysis) {
  const openAlerts = state.alerts.filter((alert) => ["open", "escalated"].includes(alert.resolution_status));
  const openIncidents = state.incidents.filter((incident) => incident.status !== "resolved");
  const overdueInspections = (state.compliance?.vehicles || []).filter((vehicle) => vehicle.inspection_status !== "current");
  const openMaintenance = state.maintenance.filter((report) => report.status !== "resolved");
  const unconfirmedFuel = state.operators.filter((operator) =>
    operator.vehicle_id && !analysis.fuelConfirmed.has(operator.operator_id));
  const openDeliveryExceptions = state.deliveryExceptions.filter((exception) => exception.status === "open").length;
  const unclosedBatches = state.deliveryBatches.filter((batch) => batch.status !== "closed").length;
  return [
    { id: "alerts", label: "Unresolved alerts", count: openAlerts.length, tab: "alerts" },
    { id: "deliveries", label: "Delivery exceptions / open batches", count: openDeliveryExceptions + unclosedBatches, tab: "deliveries" },
    { id: "incidents", label: "Open incidents", count: openIncidents.length, tab: "field" },
    { id: "inspections", label: "Overdue inspections", count: overdueInspections.length, tab: "field" },
    { id: "fuel", label: "Fuel not confirmed", count: unconfirmedFuel.length, tab: "fuel" },
    { id: "mileage", label: "Mileage exceptions", count: analysis.mileageExceptions.length, tab: "fuel" },
    { id: "maintenance", label: "Maintenance blockers", count: openMaintenance.length, tab: "field" }
  ];
}

function topActionCandidates(analysis) {
  const actions = [];
  for (const alert of state.alerts.filter((item) => item.resolution_status === "open").sort((a, b) => b.tier - a.tier).slice(0, 3)) {
    actions.push({
      weight: 100 + Number(alert.tier) * 10,
      tone: "red",
      label: `Acknowledge ${String(alert.alert_type).replaceAll("_", " ")} — ${personName(alert.person_id)}`,
      button: `<button type="button" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>`
    });
  }
  for (const incident of state.incidents.filter((item) => item.status === "open").slice(0, 2)) {
    actions.push({
      weight: incident.severity === "high" ? 140 : 90,
      tone: "red",
      label: `Respond to ${String(incident.incident_type).replaceAll("_", " ")} — ${personName(incident.person_id)}`,
      button: `<button type="button" data-incident-action="acknowledge" data-incident-id="${escapeHtml(incident.incident_id)}">Acknowledge</button>`
    });
  }
  const pendingDeviations = state.alerts.filter((alert) => alert.deviation_reason_code && alert.deviation_review_status === "pending");
  if (pendingDeviations.length) {
    actions.push({
      weight: 70,
      tone: "yellow",
      label: `${pendingDeviations.length} operator explanation${pendingDeviations.length === 1 ? "" : "s"} waiting for your decision`,
      button: `<button type="button" data-goto-tab="alerts">Review</button>`
    });
  }
  const checklist = closeoutChecklist(analysis);
  const overdue = checklist.find((item) => item.id === "inspections");
  if (overdue?.count) {
    actions.push({
      weight: 60,
      tone: "yellow",
      label: `${overdue.count} vehicle${overdue.count === 1 ? "" : "s"} overdue for 48h inspection`,
      button: `<button type="button" data-goto-tab="field">Inspect</button>`
    });
  }
  const fuel = checklist.find((item) => item.id === "fuel");
  if (fuel?.count && state.dateTo === todayLagos) {
    actions.push({
      weight: 50,
      tone: "yellow",
      label: `Confirm fuel/charge for ${fuel.count} operator${fuel.count === 1 ? "" : "s"}`,
      button: `<button type="button" data-goto-tab="fuel">Confirm fuel</button>`
    });
  }
  return actions.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

/* ---------- renderers ---------- */

function renderGauge(id, pct, valueText, subText, tone) {
  const gauge = document.getElementById(id);
  const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const circumference = 2 * Math.PI * 50;
  const value = gauge.querySelector(".gauge-value");
  value.style.strokeDasharray = `${circumference}`;
  value.style.strokeDashoffset = `${circumference * (1 - clamped / 100)}`;
  gauge.dataset.tone = tone;
  gauge.querySelector("figcaption strong").textContent = valueText;
  gauge.querySelector("figcaption small").textContent = subText;
}

function operatorTile(row, compact = false) {
  const target = Number(row.range_revenue_target_ngn ?? row.daily_revenue_target_ngn ?? 0);
  const revenue = Number(row.ride_revenue_ngn || 0);
  const progress = target ? Math.min(100, Math.round(revenue / target * 100)) : 0;
  const paceLabel = String(row.pace_status || "not_available").replaceAll("_", " ");
  const expected = Number(row.expected_revenue_ngn || 0);
  const expectedLabel = state.operatingDate < todayLagos ? "Expected by close" : "Expected now";
  return `
    <button type="button" class="operator-tile pace-${escapeHtml(row.pace_status || "none")}" data-open-operator="${escapeHtml(row.operator_id)}">
      <div class="tile-heading">
        <div><strong>${escapeHtml(personName(row.person_id))}</strong><small>${escapeHtml(row.vehicle_plate || "No vehicle")}</small></div>
        <span class="pace-status ${escapeHtml(row.pace_status || "none")}">${escapeHtml(paceLabel)}</span>
      </div>
      <div class="tile-status"><span class="status-dot ${escapeHtml(row.current_status)}"></span>${escapeHtml(String(row.current_status).replaceAll("_", " "))}<small>${row.last_seen_at ? `Last seen ${timeOf(row.last_seen_at)}` : "No platform activity"}</small></div>
      <div class="progress-label"><span>${money(revenue)} of ${money(target)}</span><strong>${progress}%</strong></div>
      <div class="progress-track"><span style="width:${progress}%"></span></div>
      <div class="tile-stats"><span><strong>${Number(row.trips_total)}</strong> trips</span><span><strong>${Number(row.hours_online).toFixed(1)}</strong> hrs</span><span><strong>${row.alerts ? row.alerts.length : Number(row.open_alerts)}</strong> alerts</span></div>
      <div class="platform-line">${(row.platforms || []).map((platform) => `<span class="${platform.vehicle_type === "car" ? "car" : "bike"}">${escapeHtml(platform.vehicle_type === "car" ? "Car" : "Bike")} · ${escapeHtml(platform.display_name)}</span>`).join("") || "<span>No feed</span>"}${compact ? "" : `<small>${escapeHtml(expectedLabel)} ${money(expected)}</small>`}</div>
    </button>`;
}

function alertRow(alert) {
  const deviation = alert.deviation_reason_code
    ? `<div class="deviation-line ${escapeHtml(alert.deviation_review_status || "pending")}">
        <span>Operator reason: <strong>${escapeHtml(String(alert.deviation_reason_code).replaceAll("_", " "))}</strong>${alert.deviation_reason_note ? ` — “${escapeHtml(alert.deviation_reason_note)}”` : ""}</span>
        ${alert.deviation_review_status === "pending"
          ? `<span class="row-actions">
              <button type="button" data-deviation-decision="accepted" data-alert-id="${escapeHtml(alert.alert_id)}">Accept</button>
              <button type="button" class="secondary" data-deviation-decision="rejected" data-alert-id="${escapeHtml(alert.alert_id)}">Reject</button>
            </span>`
          : `<span class="pill ${escapeHtml(alert.deviation_review_status)}">${escapeHtml(alert.deviation_review_status)}</span>`}
      </div>`
    : "";
  return `
    <article class="alert-row tier-${escapeHtml(alert.tier)}">
      <div><strong>${escapeHtml(String(alert.alert_type).replaceAll("_", " "))}</strong><small>${escapeHtml(personName(alert.person_id))} · ${escapeHtml(alert.platform_display_name || "General")} · Tier ${escapeHtml(alert.tier)} · ${timeOf(alert.fired_at)}</small></div>
      <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(String(alert.resolution_status).replaceAll("_", " "))}</span></div>
      <div class="row-actions">
        ${alert.resolution_status === "open" ? `<button type="button" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>` : ""}
        ${alert.resolution_status !== "resolved" ? `<button type="button" class="secondary" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.alert_id)}">Resolve</button>` : ""}
        ${!["resolved", "escalated"].includes(alert.resolution_status) ? `<button type="button" class="secondary" data-alert-action="escalate" data-alert-id="${escapeHtml(alert.alert_id)}">Escalate</button>` : ""}
      </div>
      ${deviation}
    </article>`;
}

function renderCockpit(analysis) {
  const live = analysis.rows.filter((row) => !["offline", "not_seen_today"].includes(row.current_status)).length;
  const totals = analysis.rows.reduce((sum, row) => {
    sum.revenue += Number(row.ride_revenue_ngn || 0);
    sum.expected += Number(row.expected_revenue_ngn || 0);
    return sum;
  }, { revenue: 0, expected: 0 });
  const revenueByType = state.dailyPerformance.reduce((sum, record) => {
    const type = record.platform_vehicle_type || record.vehicle_type;
    if (type === "car") sum.car += Number(record.ride_revenue_ngn || 0);
    if (type === "motorbike") sum.bike += Number(record.ride_revenue_ngn || 0);
    return sum;
  }, { car: 0, bike: 0 });

  const pacePct = totals.expected ? totals.revenue / totals.expected * 100 : 0;
  renderGauge("paceGauge", pacePct, `${Math.round(pacePct)}%`,
    `${money(totals.revenue)} of ${money(totals.expected)} expected`,
    pacePct >= 95 ? "green" : pacePct >= 75 ? "yellow" : "red");

  const utilisationPct = analysis.rows.length ? live / analysis.rows.length * 100 : 0;
  renderGauge("utilisationGauge", utilisationPct, `${live}/${analysis.rows.length}`,
    "operators live now", utilisationPct >= 80 ? "green" : utilisationPct >= 60 ? "yellow" : "red");

  const checklist = closeoutChecklist(analysis);
  const clearItems = checklist.filter((item) => !item.count).length;
  const readinessPct = checklist.length ? clearItems / checklist.length * 100 : 100;
  renderGauge("closeoutGauge", readinessPct, `${clearItems}/${checklist.length}`,
    "checklist lines clear", readinessPct === 100 ? "green" : readinessPct >= 60 ? "yellow" : "red");

  el.carRevenueChip.textContent = `Cars ${money(revenueByType.car)}`;
  el.bikeRevenueChip.textContent = `Bikes ${money(revenueByType.bike)}`;
  el.teamCountChip.textContent = `${analysis.rows.length} active · ${live} live`;

  const actions = topActionCandidates(analysis);
  el.topActions.innerHTML = actions.length ? actions.map((action) => `
    <article class="top-action tone-${action.tone}">
      <span>${escapeHtml(action.label)}</span>
      <span class="row-actions">${action.button}</span>
    </article>`).join("") : `<div class="empty all-clear">All clear — nothing needs your action right now. 🏁</div>`;

  const conditions = [
    ...analysis.groups.filter((group) => group.id !== "on_track").map((group) => ({
      label: group.label, count: group.rows.length, tone: group.rows.length ? group.tone : "green", tab: "board"
    })),
    { label: "Open alerts", count: state.alerts.filter((alert) => alert.resolution_status === "open").length, tone: state.alerts.some((alert) => alert.resolution_status === "open") ? "red" : "green", tab: "alerts" },
    { label: "Packages left", count: Number(state.deliverySummary?.packages_outstanding || 0), tone: Number(state.deliverySummary?.packages_outstanding) ? "yellow" : "green", tab: "deliveries" },
    { label: "Closeout blockers", count: checklist.reduce((sum, item) => sum + (item.count ? 1 : 0), 0), tone: checklist.some((item) => item.count) ? "yellow" : "green", tab: "closeout" }
  ];
  el.conditionGrid.innerHTML = conditions.map((condition) => `
    <button type="button" class="condition-card tone-${condition.tone}" data-goto-tab="${escapeHtml(condition.tab)}">
      <strong>${condition.count}</strong><span>${escapeHtml(condition.label)}</span>
    </button>`).join("");

  const openAlertCount = state.alerts.filter((alert) => alert.resolution_status === "open").length;
  el.alertDockBadge.hidden = !openAlertCount;
  el.alertDockBadge.textContent = openAlertCount;
}

function renderBoard(analysis) {
  el.teamBoard.innerHTML = analysis.rows.length ? analysis.groups
    .filter((group) => group.rows.length)
    .map((group) => `
      <details class="board-group tone-${group.tone}" ${group.tone === "red" ? "open" : ""}>
        <summary><span class="group-count">${group.rows.length}</span>${escapeHtml(group.label)}</summary>
        <div class="team-board">${group.rows.map((row) => operatorTile(row)).join("")}</div>
      </details>`).join("")
    : `<div class="empty">No assigned operators match this view.</div>`;

  el.performanceList.innerHTML = state.dailyPerformance.length ? state.dailyPerformance.map((record) => `
    <article class="performance-row">
      <div class="performance-person"><strong>${escapeHtml(personName(record.person_id))}</strong><small>${escapeHtml(record.platform_vehicle_type === "car" ? "Car" : "Bike")} · ${escapeHtml(record.platform_display_name)}${state.dateFrom !== state.dateTo ? ` · ${escapeHtml(String(record.record_date).slice(0, 10))}` : ""}</small></div>
      <dl>
        <div><dt>Trips</dt><dd>${escapeHtml(record.trips_total)}</dd></div>
        <div><dt>Revenue</dt><dd>${money(record.ride_revenue_ngn)}</dd></div>
        <div><dt>Hours</dt><dd>${Number(record.hours_online).toFixed(1)}</dd></div>
        <div><dt>Acceptance</dt><dd>${Number(record.acceptance_pct || 0).toFixed(0)}%</dd></div>
      </dl>
      <span class="pill">${escapeHtml(String(record.current_status).replaceAll("_", " "))}</span>
    </article>
  `).join("") : `<div class="empty">No performance records for this range.</div>`;
}

function renderAlerts() {
  const filter = el.alertFilter.value;
  const alerts = filter ? state.alerts.filter((alert) => alert.resolution_status === filter) : state.alerts;
  const groups = [...alerts.reduce((map, alert) => {
    const groupKey = alert.alert_type;
    if (!map.has(groupKey)) map.set(groupKey, []);
    map.get(groupKey).push(alert);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1].length - a[1].length);

  el.alertList.innerHTML = groups.length ? groups.map(([type, groupAlerts]) => {
    const people = new Set(groupAlerts.map((alert) => alert.person_id));
    const maxTier = Math.max(...groupAlerts.map((alert) => Number(alert.tier)));
    return `
      <details class="board-group tone-${maxTier >= 2 ? "red" : "yellow"}" open>
        <summary><span class="group-count">${people.size}</span>${escapeHtml(String(type).replaceAll("_", " "))}<small>${groupAlerts.length} alert${groupAlerts.length === 1 ? "" : "s"} · highest tier ${maxTier}</small></summary>
        <div class="alert-list">${groupAlerts.map((alert) => alertRow(alert)).join("")}</div>
      </details>`;
  }).join("") : `<div class="empty">No alerts match this view.</div>`;
}

function renderField() {
  el.incidentList.innerHTML = state.incidents.length ? state.incidents.map((incident) => `
    <article class="alert-row ${incident.severity === "high" ? "tier-3" : "tier-1"}">
      <div><strong>${escapeHtml(String(incident.incident_type).replaceAll("_", " "))}</strong><small>${escapeHtml(personName(incident.person_id))}${incident.vehicle_plate ? ` · ${escapeHtml(incident.vehicle_plate)}` : ""} · ${timeOf(incident.occurred_at)}</small></div>
      <div><span class="row-label">Details</span><strong>${escapeHtml(incident.description || "No notes")}</strong><small>${incident.gps_lat ? `GPS ${Number(incident.gps_lat).toFixed(3)}, ${Number(incident.gps_lng).toFixed(3)}` : "No GPS"}</small></div>
      <div><span class="pill ${escapeHtml(incident.status)}">${escapeHtml(incident.status)}</span></div>
      <div class="row-actions">
        ${incident.status === "open" ? `<button type="button" data-incident-action="acknowledge" data-incident-id="${escapeHtml(incident.incident_id)}">Acknowledge</button>` : ""}
        ${incident.status !== "resolved" ? `<button type="button" class="secondary" data-incident-action="resolve" data-incident-id="${escapeHtml(incident.incident_id)}">Resolve</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="empty">No incidents reported by your team.</div>`;

  if (state.compliance) {
    const scoped = state.compliance.vehicles;
    const current = scoped.filter((vehicle) => vehicle.inspection_status === "current").length;
    const intervalHours = Number(state.compliance.inspection_interval_hours || 48);
    el.inspectionComplianceLabel.textContent = !scoped.length
      ? "No active vehicles in scope"
      : `${Math.round(current / scoped.length * 100)}% of vehicles inspected in the last ${intervalHours}h · ${scoped.length - current} overdue`;
  }
  const complianceByVehicle = new Map((state.compliance?.vehicles || []).map((item) => [item.vehicle_id, item]));
  el.inspectionForm.elements.vehicle_id.innerHTML = state.vehicles.map((vehicle) => {
    const status = complianceByVehicle.get(vehicle.vehicle_id)?.inspection_status;
    const suffix = status === "current" ? "" : status === "overdue" ? " — OVERDUE" : " — never inspected";
    return `<option value="${escapeHtml(vehicle.vehicle_id)}">${escapeHtml(vehicle.plate)}${suffix}</option>`;
  }).join("");
  el.maintenanceForm.elements.vehicle_id.innerHTML = state.vehicles.map((vehicle) =>
    `<option value="${escapeHtml(vehicle.vehicle_id)}">${escapeHtml(vehicle.plate)}</option>`).join("");

  el.inspectionList.innerHTML = state.inspections.length ? state.inspections.slice(0, 8).map((inspection) => `
    <article class="mileage-row">
      <div><strong>${escapeHtml(inspection.vehicle_plate)}</strong><small>${new Date(inspection.inspected_at).toLocaleString("en-NG")}</small></div>
      <dl>
        <div><dt>Condition</dt><dd>${escapeHtml(String(inspection.condition).replaceAll("_", " "))}</dd></div>
        <div><dt>Odometer</dt><dd>${inspection.odometer_km === null ? "—" : `${Number(inspection.odometer_km)} km`}</dd></div>
        <div><dt>Fuel</dt><dd>${inspection.fuel_level_pct === null ? "—" : `${Number(inspection.fuel_level_pct)}%`}</dd></div>
        <div><dt>Review</dt><dd>${escapeHtml(String(inspection.review_status).replaceAll("_", " "))}</dd></div>
      </dl>
      <div class="mileage-status"><span class="pill ${inspection.condition === "ok" ? "" : "open"}">${escapeHtml(String(inspection.condition).replaceAll("_", " "))}</span>${evidenceChips(inspection.media_ids)}</div>
    </article>
  `).join("") : `<div class="empty">No inspections submitted yet.</div>`;

  el.maintenanceList.innerHTML = state.maintenance.length ? state.maintenance.map((report) => `
    <article class="alert-row ${report.status === "open" ? "tier-2" : "tier-0"}">
      <div><strong>${escapeHtml(report.vehicle_plate)} · ${escapeHtml(String(report.category).replaceAll("_", " "))}</strong><small>${escapeHtml(report.description || "No description")}</small></div>
      <div><span class="row-label">Reported</span><strong>${new Date(report.created_at).toLocaleDateString("en-NG")}</strong></div>
      <div><span class="row-label">Cost</span><strong>${report.cost_ngn === null ? "—" : money(report.cost_ngn)}</strong></div>
      <div><span class="pill ${escapeHtml(report.status)}">${escapeHtml(String(report.status).replaceAll("_", " "))}</span>${evidenceChips(report.media_ids)}</div>
      <div class="row-actions">
        ${report.status === "open" ? `<button type="button" data-maintenance-status="in_repair" data-maintenance-id="${escapeHtml(report.maintenance_id)}">Start repair</button>` : ""}
        ${report.status !== "resolved" ? `<button type="button" class="secondary" data-maintenance-status="resolved" data-maintenance-id="${escapeHtml(report.maintenance_id)}">Resolve</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="empty">No maintenance reports for your fleet.</div>`;
}

function renderFuel() {
  const fuelOperators = state.operators.filter((operator) => operator.vehicle_id);
  el.fuelIssueForm.elements.operator_id.innerHTML = fuelOperators.map((operator) =>
    `<option value="${escapeHtml(operator.operator_id)}">${escapeHtml(personName(operator.person_id))} · ${escapeHtml(operator.vehicle_plate)}</option>`
  ).join("");
  el.mileageList.innerHTML = state.mileageReconciliations.length ? state.mileageReconciliations.map((record) => `
    <article class="mileage-row">
      <div><strong>${escapeHtml(personName(record.person_id))}</strong><small>${escapeHtml(record.plate)} · ${escapeHtml(record.vehicle_type)}${state.dateFrom !== state.dateTo ? ` · ${escapeHtml(record.operating_date)}` : ""}</small></div>
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

function renderCloseout(analysis) {
  const checklist = closeoutChecklist(analysis);
  const amoebaIds = [...new Set(state.operators.map((operator) => operator.amoeba_id))];
  const closeoutFor = (amoebaId) => state.closeouts.find((closeout) =>
    closeout.amoeba_id === amoebaId && String(closeout.record_date).slice(0, 10) === state.dateTo);

  el.closeoutList.innerHTML = amoebaIds.length ? amoebaIds.map((amoebaId) => {
    const operatorIds = new Set(state.operators.filter((operator) => operator.amoeba_id === amoebaId).map((operator) => operator.operator_id));
    const scopedChecklist = checklist.map((item) => ({ ...item }));
    // Scope operator-linked counts to the amoeba where the data allows it.
    scopedChecklist.find((item) => item.id === "alerts").count =
      state.alerts.filter((alert) => ["open", "escalated"].includes(alert.resolution_status) && operatorIds.has(alert.operator_id)).length;
    scopedChecklist.find((item) => item.id === "incidents").count =
      state.incidents.filter((incident) => incident.status !== "resolved" && operatorIds.has(incident.operator_id)).length;
    const existing = closeoutFor(amoebaId);
    const blockers = scopedChecklist.filter((item) => item.count);
    return `
      <article class="closeout-card ${existing ? "submitted" : blockers.length ? "blocked" : "ready"}">
        <div class="closeout-head">
          <div><strong>${escapeHtml(amoebaId.replace("amoeba_", "").replace(/^\w/, (char) => char.toUpperCase()))}</strong><small>Closeout for ${escapeHtml(state.dateTo)}</small></div>
          ${existing
            ? `<span class="pill ${existing.status === "submitted" ? "resolved" : "open"}">${escapeHtml(String(existing.status).replaceAll("_", " "))} · ${timeOf(existing.submitted_at)}</span>`
            : `<span class="pill ${blockers.length ? "open" : "resolved"}">${blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "Ready"}</span>`}
        </div>
        <ul class="closeout-checklist">
          ${scopedChecklist.map((item) => `
            <li class="${item.count ? "flagged" : "clear"}">
              <span class="check-mark">${item.count ? "!" : "✓"}</span>
              <span>${escapeHtml(item.label)}</span>
              <span class="check-count">${item.count || "Clear"}</span>
              ${item.count ? `<button type="button" class="linklike" data-goto-tab="${escapeHtml(item.tab)}">Review</button>` : ""}
            </li>`).join("")}
        </ul>
        ${existing ? existing.notes ? `<p class="subtle">Note: ${escapeHtml(existing.notes)}</p>` : "" : `
          <label class="closeout-note">Supervisor note (optional — explain anything still open)
            <textarea rows="2" data-closeout-note="${escapeHtml(amoebaId)}"></textarea>
          </label>
          <button type="button" data-submit-closeout="${escapeHtml(amoebaId)}">${blockers.length ? "Submit with exceptions" : "Submit closeout"}</button>`}
      </article>`;
  }).join("") : `<div class="empty">No operating units in scope.</div>`;
}

function renderDeliveries() {
  const summary = state.deliverySummary;
  el.deliverySummaryLabel.textContent = summary
    ? `${summary.batches} batch${summary.batches === 1 ? "" : "es"} · ${summary.delivered} delivered · ${summary.packages_outstanding} left · ${summary.open_exceptions} exception${summary.open_exceptions === 1 ? "" : "s"}`
    : "";

  const customerOptions = state.deliveryCustomers.filter((customer) => customer.status === "active");
  el.deliveryBatchForm.elements.delivery_customer_id.innerHTML = customerOptions.map((customer) =>
    `<option value="${escapeHtml(customer.delivery_customer_id)}">${escapeHtml(customer.name)}</option>`).join("");
  const amoebas = [...new Set(state.operators.map((operator) => operator.amoeba_id))];
  el.deliveryBatchForm.elements.amoeba_id.innerHTML = amoebas.map((amoebaId) =>
    `<option value="${escapeHtml(amoebaId)}">${escapeHtml(amoebaId.replace("amoeba_", ""))}</option>`).join("");

  const exceptionsByBatch = new Map();
  for (const exception of state.deliveryExceptions) {
    if (!exceptionsByBatch.has(exception.batch_id)) exceptionsByBatch.set(exception.batch_id, []);
    exceptionsByBatch.get(exception.batch_id).push(exception);
  }
  const assignmentsByBatch = new Map();
  for (const assignment of state.deliveryAssignments) {
    if (!assignmentsByBatch.has(assignment.batch_id)) assignmentsByBatch.set(assignment.batch_id, []);
    assignmentsByBatch.get(assignment.batch_id).push(assignment);
  }

  el.deliveryList.innerHTML = state.deliveryBatches.length ? state.deliveryBatches.map((batch) => {
    const closed = batch.status === "closed";
    const assignments = assignmentsByBatch.get(batch.batch_id) || [];
    const exceptions = exceptionsByBatch.get(batch.batch_id) || [];
    const assignableOperators = state.operators.filter((operator) =>
      operator.amoeba_id === batch.amoeba_id && !assignments.some((assignment) => assignment.operator_id === operator.operator_id));
    return `
    <details class="board-group tone-${closed ? "green" : Number(batch.open_exceptions) ? "red" : "yellow"}" ${closed ? "" : "open"}>
      <summary><span class="group-count">${Number(batch.delivered_count)}/${Number(batch.received_count)}</span>
        ${escapeHtml(batch.customer_name)} · ${escapeHtml(String(batch.batch_date).slice(0, 10))}
        <small>${escapeHtml(batch.manifest_ref || "No manifest ref")} · <span class="pill ${closed ? "resolved" : "pending"}">${escapeHtml(batch.status.replaceAll("_", " "))}</span></small>
      </summary>
      <div>
        <div class="count-ladder">
          <span>expected<strong>${Number(batch.expected_count)}</strong></span>
          <span>received<strong>${Number(batch.received_count)}</strong></span>
          <span>sorted<strong>${Number(batch.sorted_count)}</strong></span>
          <span>assigned<strong>${Number(batch.assigned_count)}</strong></span>
          <span>delivered<strong>${Number(batch.delivered_count)}</strong></span>
          <span class="${Number(batch.failed_count) ? "flag" : ""}">failed<strong>${Number(batch.failed_count)}</strong></span>
          <span>returned<strong>${Number(batch.returned_count)}</strong></span>
          <span class="${Number(batch.packages_outstanding) ? "flag" : ""}">left<strong>${Number(batch.packages_outstanding)}</strong></span>
        </div>
        <div class="split-chips"><span class="source-chip">${escapeHtml(String(batch.counts_source).replaceAll("_", " "))}</span>
          <span>₦${Number(batch.delivered_value_allocated_ngn || 0).toLocaleString()} allocated value</span></div>

        <div class="card-list" style="margin-top:8px">
          ${assignments.map((assignment) => `
            <div class="assignment-row">
              <strong>${escapeHtml(personName(assignment.person_id))}</strong>
              <span class="pill ${escapeHtml(assignment.status)}">${escapeHtml(assignment.status.replaceAll("_", " "))}</span>
              <small>target ${Number(assignment.assigned_count)} · ₦${Number(assignment.earned_value_allocated_ngn).toLocaleString()} earned</small>
              ${closed ? `<small>${Number(assignment.delivered_count)} delivered · ${Number(assignment.failed_count)} failed · ${Number(assignment.returned_count)} returned</small>` : `
              <span class="progress-inputs" data-assignment-inputs="${escapeHtml(assignment.assignment_id)}">
                <label>del.<input type="number" min="0" value="${Number(assignment.delivered_count)}" data-field="delivered_count" /></label>
                <label>fail<input type="number" min="0" value="${Number(assignment.failed_count)}" data-field="failed_count" /></label>
                <label>ret.<input type="number" min="0" value="${Number(assignment.returned_count)}" data-field="returned_count" /></label>
                <button type="button" data-save-assignment="${escapeHtml(assignment.assignment_id)}">Save</button>
              </span>`}
            </div>`).join("")}
        </div>

        ${closed ? "" : `
        <div class="assign-panel">
          <strong class="assign-title">➕ Assign a driver</strong>
          ${assignableOperators.length ? `
          <div class="delivery-actions">
            <label class="assign-field">Driver
              <select data-assign-operator-select="${escapeHtml(batch.batch_id)}">
                ${assignableOperators.map((operator) => `<option value="${escapeHtml(operator.operator_id)}">${escapeHtml(personName(operator.person_id))}</option>`).join("")}
              </select>
            </label>
            <label class="assign-field">Packages
              <input type="number" min="1" value="20" data-assign-count="${escapeHtml(batch.batch_id)}" />
            </label>
            <button type="button" data-assign-driver="${escapeHtml(batch.batch_id)}">Assign driver</button>
          </div>` : `<small>Every driver in this unit is already on the batch — adjust their targets on the rows above.</small>`}
        </div>`}

        ${exceptions.length ? `<div class="card-list" style="margin-top:8px">${exceptions.map((exception) => `
          <div class="assignment-row">
            <span class="pill ${exception.status === "open" ? "open" : "resolved"}">${escapeHtml(exception.category.replaceAll("_", " "))}</span>
            <small>${escapeHtml(exception.note || "No note")}</small>
            ${(exception.media_ids || []).length ? evidenceChips(exception.media_ids) : ""}
            ${exception.status === "open" ? `<button type="button" class="linklike" data-resolve-dexception="${escapeHtml(exception.exception_id)}">Resolve</button>` : ""}
          </div>`).join("")}</div>` : ""}

        ${closed ? "" : `
        <div class="delivery-actions">
          <select data-exception-category="${escapeHtml(batch.batch_id)}">
            ${["shortage", "damaged", "customer_dispute", "failed_delivery", "return_pending", "other"].map((category) => `<option value="${category}">${category.replaceAll("_", " ")}</option>`).join("")}
          </select>
          <input data-exception-note="${escapeHtml(batch.batch_id)}" placeholder="Exception note" />
          <label class="photo-field" style="margin:0"><input type="file" accept="image/*" capture="environment" data-photo-input="dexception" /><span class="photo-status" data-photo-status="dexception"></span></label>
          <button type="button" data-add-dexception="${escapeHtml(batch.batch_id)}">Record exception</button>
          <button type="button" data-close-batch="${escapeHtml(batch.batch_id)}">Close batch</button>
        </div>`}
      </div>
    </details>`;
  }).join("") : `<div class="empty">No delivery batches in this range. Create one when a customer drop-off arrives.</div>`;
}

let latestAnalysis = null;
function render() {
  latestAnalysis = analyseTeam();
  el.boardUpdated.textContent = `Updated ${timeOf(new Date())}`;
  renderCockpit(latestAnalysis);
  renderBoard(latestAnalysis);
  renderAlerts();
  renderField();
  renderFuel();
  renderCloseout(latestAnalysis);
  renderDeliveries();
  if (openOperatorId) renderOperatorDialog(openOperatorId);
}

/* ---------- operator detail sheet ---------- */

function operatorTimeline(operatorId, vehicleId) {
  const events = [];
  for (const alert of state.alerts.filter((item) => item.operator_id === operatorId)) {
    events.push({ at: alert.fired_at, label: `${String(alert.alert_type).replaceAll("_", " ")} alert fired (tier ${alert.tier})`, tone: "red" });
    if (alert.acknowledged_at) events.push({ at: alert.acknowledged_at, label: "Alert acknowledged", tone: "yellow" });
    if (alert.resolved_at) events.push({ at: alert.resolved_at, label: "Alert resolved", tone: "green" });
  }
  for (const incident of state.incidents.filter((item) => item.operator_id === operatorId)) {
    events.push({ at: incident.occurred_at, label: `${String(incident.incident_type).replaceAll("_", " ")} incident reported`, tone: incident.severity === "high" ? "red" : "yellow" });
  }
  for (const issue of state.fuelIssues.filter((item) => item.operator_id === operatorId)) {
    events.push({ at: issue.issued_at, label: `Fuel/charge confirmed: ${Number(issue.quantity)} ${issue.unit}`, tone: "green" });
  }
  for (const inspection of state.inspections.filter((item) => item.vehicle_id === vehicleId)) {
    events.push({ at: inspection.inspected_at, label: `Vehicle inspected — ${String(inspection.condition).replaceAll("_", " ")}`, tone: inspection.condition === "ok" ? "green" : "yellow" });
  }
  for (const report of state.maintenance.filter((item) => item.vehicle_id === vehicleId)) {
    events.push({ at: report.created_at, label: `Maintenance: ${String(report.category).replaceAll("_", " ")} (${String(report.status).replaceAll("_", " ")})`, tone: report.status === "resolved" ? "green" : "yellow" });
  }
  return events
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 12);
}

function renderOperatorDialog(operatorId) {
  const row = latestAnalysis?.rows.find((item) => item.operator_id === operatorId);
  if (!row) { el.operatorDialog.close(); openOperatorId = null; return; }
  const operator = row.operator;
  const phone = personPhone(row.person_id);
  const performance = state.dailyPerformance.filter((record) => record.operator_id === operatorId);
  const acceptance = performance.length
    ? performance.reduce((sum, record) => sum + Number(record.acceptance_pct || 0), 0) / performance.length
    : null;
  const mileage = state.mileageReconciliations.filter((record) => record.operator_id === operatorId);
  const timeline = operatorTimeline(operatorId, operator?.vehicle_id);
  const target = Number(row.range_revenue_target_ngn ?? row.daily_revenue_target_ngn ?? 0);
  const revenue = Number(row.ride_revenue_ngn || 0);
  const progress = target ? Math.min(100, Math.round(revenue / target * 100)) : 0;

  el.operatorDialogTitle.textContent = personName(row.person_id);
  el.operatorDialogBody.innerHTML = `
    <div class="sheet-status">
      <span class="status-dot ${escapeHtml(row.current_status)}"></span>${escapeHtml(String(row.current_status).replaceAll("_", " "))}
      <span class="pace-status ${escapeHtml(row.pace_status || "none")}">${escapeHtml(String(row.pace_status || "not available").replaceAll("_", " "))}</span>
      <small>${escapeHtml(row.vehicle_plate || "No vehicle")} · ${escapeHtml(row.vehicle_type || "unassigned")}</small>
    </div>
    <div class="progress-label"><span>${money(revenue)} of ${money(target)} target</span><strong>${progress}%</strong></div>
    <div class="progress-track"><span style="width:${progress}%"></span></div>
    <dl class="sheet-stats">
      <div><dt>Trips</dt><dd>${Number(row.trips_total)}</dd></div>
      <div><dt>Hours</dt><dd>${Number(row.hours_online).toFixed(1)}</dd></div>
      <div><dt>Acceptance</dt><dd>${acceptance === null ? "—" : `${acceptance.toFixed(0)}%`}</dd></div>
      <div><dt>Net Earnings</dt><dd>${money(row.net_earnings_ngn)}</dd></div>
    </dl>
    <div class="platform-line">${(row.platforms || []).map((platform) => `<span class="${platform.vehicle_type === "car" ? "car" : "bike"}">${escapeHtml(platform.display_name)}</span>`).join("") || "<span>No platform feed</span>"}</div>
    <div class="sheet-actions row-actions">
      ${phone ? `<a class="call-button" href="tel:${escapeHtml(phone)}">📞 Call</a>` : ""}
      ${row.alerts.filter((alert) => alert.resolution_status !== "resolved").length ? "" : `<span class="pill resolved">No open alerts</span>`}
    </div>
    ${row.alerts.length ? `<h3>Alerts</h3><div class="alert-list">${row.alerts.map((alert) => alertRow(alert)).join("")}</div>` : ""}
    ${row.openIncidents.length ? `<h3>Open incidents</h3><div class="alert-list">${row.openIncidents.map((incident) => `
      <article class="alert-row tier-2">
        <div><strong>${escapeHtml(String(incident.incident_type).replaceAll("_", " "))}</strong><small>${timeOf(incident.occurred_at)}</small></div>
        <div><span class="pill ${escapeHtml(incident.status)}">${escapeHtml(incident.status)}</span></div>
      </article>`).join("")}</div>` : ""}
    ${mileage.length ? `<h3>Fuel &amp; mileage</h3><div class="mileage-list">${mileage.map((record) => `
      <article class="mileage-row">
        <div><strong>${escapeHtml(record.operating_date || state.dateTo)}</strong></div>
        <dl>
          <div><dt>Issued</dt><dd>${record.fuel_quantity === null ? "Not confirmed" : `${Number(record.fuel_quantity)} ${escapeHtml(record.fuel_unit)}`}</dd></div>
          <div><dt>Expected</dt><dd>${record.expected_distance_km === null ? "—" : `${Number(record.expected_distance_km)} km`}</dd></div>
          <div><dt>Official</dt><dd>${record.official_distance_km === null ? "—" : `${Number(record.official_distance_km)} km`}</dd></div>
        </dl>
      </article>`).join("")}</div>` : ""}
    <h3>Today's timeline</h3>
    <ol class="timeline">
      ${timeline.length ? timeline.map((event) => `
        <li class="tone-${event.tone}"><span>${timeOf(event.at)}</span>${escapeHtml(event.label)}</li>`).join("")
        : `<li class="tone-green"><span>—</span>No recorded events in this range yet.</li>`}
    </ol>`;
  if (!el.operatorDialog.open) el.operatorDialog.showModal();
}

/* ---------- data refresh ---------- */

async function refresh(message = "Connected to Fleximotion Ops.") {
  setConnection("", "Connecting");
  setNotice("Loading team data...");
  const [people, operators, allPerformance] = await Promise.all([
    foundation("/identity/v1/people"),
    ops("/ops/v1/operators"),
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
  let dateFrom = el.dateFrom.value || el.dateTo.value || todayLagos;
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const rangeHasData = availableDates.some((date) => date >= dateFrom && date <= dateTo);
  if (!rangeHasData && availableDates.length) {
    dateFrom = availableDates[0];
    dateTo = availableDates[0];
  }
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const operatingDate = dateTo;
  const [teamBoard, alerts, fuelIssues, mileageReconciliations, incidents, inspections, compliance, maintenance, vehicles, closeouts, deliveryBatches, deliveryAssignments, deliveryExceptions, deliveryCustomers, deliverySummary] = await Promise.all([
    ops(`/ops/v1/team-board?${range}`),
    ops(`/ops/v1/alerts?${range}`),
    ops(`/ops/v1/fuel-issues?${range}`),
    ops(`/ops/v1/mileage-reconciliations?${range}`),
    ops("/ops/v1/incidents"),
    ops("/ops/v1/inspections"),
    ops("/ops/v1/inspections/compliance"),
    ops("/ops/v1/maintenance-reports"),
    ops("/ops/v1/vehicles"),
    ops(`/ops/v1/daily-closeouts?record_date=${dateTo}`).catch(() => ({ data: [] })),
    ops(`/ops/v1/delivery-batches?${range}`).catch(() => ({ data: [] })),
    ops(`/ops/v1/delivery-assignments?${range}`).catch(() => ({ data: [] })),
    ops("/ops/v1/delivery-exceptions").catch(() => ({ data: [] })),
    ops("/ops/v1/delivery-customers").catch(() => ({ data: [] })),
    ops(`/ops/v1/delivery-summary?${range}`).catch(() => null)
  ]);
  const assignedAmoebas = new Set(assigned.map((operator) => operator.amoeba_id));
  const scopedVehicles = vehicles.data.filter((vehicle) => vehicle.status === "active" && assignedAmoebas.has(vehicle.amoeba_id));
  const scopedVehicleIds = new Set(scopedVehicles.map((vehicle) => vehicle.vehicle_id));
  Object.assign(state, {
    people: people.data,
    operators: assigned,
    alerts: alerts.data.filter((alert) => assignedIds.has(alert.operator_id)),
    teamBoard: teamBoard.data.filter((item) => assignedIds.has(item.operator_id)),
    dailyPerformance: allPerformance.data.filter((record) => {
      const recordDate = String(record.record_date).slice(0, 10);
      return assignedIds.has(record.operator_id) && recordDate >= dateFrom && recordDate <= dateTo;
    }),
    fuelIssues: fuelIssues.data.filter((record) => assignedIds.has(record.operator_id)),
    mileageReconciliations: mileageReconciliations.data.filter((record) => assignedIds.has(record.operator_id)),
    incidents: incidents.data.filter((incident) => assignedIds.has(incident.operator_id)),
    inspections: inspections.data.filter((inspection) => scopedVehicleIds.has(inspection.vehicle_id)),
    compliance: {
      ...compliance,
      vehicles: compliance.vehicles.filter((vehicle) => scopedVehicleIds.has(vehicle.vehicle_id))
    },
    maintenance: maintenance.data.filter((report) => scopedVehicleIds.has(report.vehicle_id)),
    vehicles: scopedVehicles,
    closeouts: closeouts.data.filter((closeout) => closeout.supervisor_person_id === actorPersonId || assignedAmoebas.has(closeout.amoeba_id)),
    deliveryBatches: deliveryBatches.data.filter((batch) => assignedAmoebas.has(batch.amoeba_id)),
    deliveryAssignments: deliveryAssignments.data.filter((assignment) => assignedIds.has(assignment.operator_id)),
    deliveryExceptions: deliveryExceptions.data.filter((exception) => assignedAmoebas.has(exception.amoeba_id)),
    deliveryCustomers: deliveryCustomers.data,
    deliverySummary,
    operatingDate,
    dateFrom,
    dateTo
  });
  render();
  setConnection("connected", "Team data connected");
  setNotice(message);
}

/* ---------- events ---------- */

for (const kind of ["inspection", "maintenance"]) {
  const form = kind === "inspection" ? el.inspectionForm : el.maintenanceForm;
  const input = form.querySelector('input[name="photo"]');
  document.querySelector(`[data-photo-for="${kind}"]`).addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) stagePhoto(kind, input.files[0]); });
}

el.alertFilter.addEventListener("change", renderAlerts);
document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));
const describeRange = () => el.dateFrom.value === el.dateTo.value
  ? `Showing team activity for ${el.dateTo.value}.`
  : `Showing team activity from ${el.dateFrom.value} to ${el.dateTo.value}.`;
el.dateFrom.addEventListener("change", () => refresh(describeRange()).catch(showError));
el.dateTo.addEventListener("change", () => refresh(describeRange()).catch(showError));

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
        unit: values.unit || "litres",
        notes: values.notes || null
      })
    });
    el.fuelIssueForm.reset();
    await refresh("Fuel issue confirmed.");
  } catch (error) { showError(error); }
});

el.deliveryBatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.deliveryBatchForm));
  try {
    await ops("/ops/v1/delivery-batches", {
      method: "POST",
      headers: { "Idempotency-Key": key("dbatch") },
      body: JSON.stringify({
        delivery_customer_id: values.delivery_customer_id,
        amoeba_id: values.amoeba_id,
        batch_date: state.dateTo,
        manifest_ref: values.manifest_ref || null,
        expected_count: Number(values.expected_count || 0),
        received_count: Number(values.received_count || 0),
        sorted_count: Number(values.sorted_count || 0)
      })
    });
    el.deliveryBatchForm.reset();
    await refresh("Delivery batch created.");
  } catch (error) { showError(error); }
});

let pendingAction = null;
const dialogTitles = {
  acknowledge: "Acknowledge alert",
  resolve: "Resolve alert",
  escalate: "Escalate to manager"
};
document.addEventListener("click", async (event) => {
  const evidenceButton = event.target.closest("[data-open-evidence]");
  if (evidenceButton) {
    openEvidence(evidenceButton.dataset.openEvidence);
    return;
  }
  const tabButton = event.target.closest("[data-goto-tab]");
  if (tabButton) {
    if (el.operatorDialog.open) { el.operatorDialog.close(); openOperatorId = null; }
    location.hash = `#${tabButton.dataset.gotoTab}`;
    return;
  }
  const operatorButton = event.target.closest("[data-open-operator]");
  if (operatorButton) {
    openOperatorId = operatorButton.dataset.openOperator;
    renderOperatorDialog(openOperatorId);
    return;
  }
  const closeOperator = event.target.closest("[data-close-operator]");
  if (closeOperator) {
    el.operatorDialog.close();
    openOperatorId = null;
    return;
  }
  const alertButton = event.target.closest("[data-alert-action]");
  if (alertButton) {
    const alert = state.alerts.find((item) => item.alert_id === alertButton.dataset.alertId);
    pendingAction = { kind: "alert", type: alertButton.dataset.alertAction, alert };
    el.dialogTitle.textContent = dialogTitles[pendingAction.type];
    el.dialogContext.textContent = `${alert.alert_type.replaceAll("_", " ")} · ${personName(alert.person_id)}`;
    el.dialogNotes.value = "";
    el.actionDialog.showModal();
    return;
  }
  const incidentButton = event.target.closest("[data-incident-action]");
  if (incidentButton) {
    const incident = state.incidents.find((item) => item.incident_id === incidentButton.dataset.incidentId);
    pendingAction = { kind: "incident", type: incidentButton.dataset.incidentAction, incident };
    el.dialogTitle.textContent = pendingAction.type === "acknowledge" ? "Acknowledge incident" : "Resolve incident";
    el.dialogContext.textContent = `${incident.incident_type.replaceAll("_", " ")} · ${personName(incident.person_id)}`;
    el.dialogNotes.value = "";
    el.actionDialog.showModal();
    return;
  }
  const deviationButton = event.target.closest("[data-deviation-decision]");
  if (deviationButton) {
    try {
      await ops(`/ops/v1/alerts/${deviationButton.dataset.alertId}/deviation-reason/review`, {
        method: "POST",
        headers: { "Idempotency-Key": key("deviation-review") },
        body: JSON.stringify({ decision: deviationButton.dataset.deviationDecision })
      });
      await refresh(`Operator reason ${deviationButton.dataset.deviationDecision}.`);
    } catch (error) { showError(error); }
    return;
  }
  const maintenanceButton = event.target.closest("[data-maintenance-status]");
  if (maintenanceButton) {
    const status = maintenanceButton.dataset.maintenanceStatus;
    const costInput = status === "resolved" ? prompt("Repair cost in ₦ (leave blank if none):", "") : null;
    try {
      await ops(`/ops/v1/maintenance-reports/${maintenanceButton.dataset.maintenanceId}/status`, {
        method: "POST",
        headers: { "Idempotency-Key": key("maintenance-status") },
        body: JSON.stringify({
          status,
          cost_ngn: costInput ? Number(costInput) : null,
          resolution_notes: status === "resolved" ? "Resolved from supervisor console." : null
        })
      });
      await refresh(status === "resolved" ? "Maintenance resolved." : "Repair started.");
    } catch (error) { showError(error); }
    return;
  }
  const assignDriver = event.target.closest("[data-assign-driver]");
  if (assignDriver) {
    const batchId = assignDriver.dataset.assignDriver;
    const operatorId = document.querySelector(`[data-assign-operator-select="${batchId}"]`)?.value;
    const count = Number(document.querySelector(`[data-assign-count="${batchId}"]`)?.value || 0);
    try {
      await ops(`/ops/v1/delivery-batches/${batchId}/assignments`, {
        method: "POST",
        headers: { "Idempotency-Key": key("dassign") },
        body: JSON.stringify({ operator_id: operatorId, assigned_count: count })
      });
      await refresh("Driver assigned.");
    } catch (error) { showError(error); }
    return;
  }
  const saveAssignment = event.target.closest("[data-save-assignment]");
  if (saveAssignment) {
    const assignmentId = saveAssignment.dataset.saveAssignment;
    const wrap = document.querySelector(`[data-assignment-inputs="${assignmentId}"]`);
    const payload = {};
    for (const input of wrap.querySelectorAll("input[data-field]")) payload[input.dataset.field] = Number(input.value || 0);
    try {
      await ops(`/ops/v1/delivery-assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": key("dprogress") },
        body: JSON.stringify({ ...payload, status: "out_for_delivery" })
      });
      await refresh("Delivery progress saved.");
    } catch (error) { showError(error); }
    return;
  }
  const addException = event.target.closest("[data-add-dexception]");
  if (addException) {
    const batchId = addException.dataset.addDexception;
    try {
      const mediaIds = await uploadStagedPhoto("dexception", "delivery_exception_evidence");
      await ops(`/ops/v1/delivery-batches/${batchId}/exceptions`, {
        method: "POST",
        headers: { "Idempotency-Key": key("dexception") },
        body: JSON.stringify({
          category: document.querySelector(`[data-exception-category="${batchId}"]`)?.value,
          note: document.querySelector(`[data-exception-note="${batchId}"]`)?.value || null,
          media_ids: mediaIds
        })
      });
      await refresh("Delivery exception recorded.");
    } catch (error) { showError(error); }
    return;
  }
  const resolveDexception = event.target.closest("[data-resolve-dexception]");
  if (resolveDexception) {
    try {
      await ops(`/ops/v1/delivery-exceptions/${resolveDexception.dataset.resolveDexception}/resolve`, {
        method: "POST",
        headers: { "Idempotency-Key": key("dresolve") },
        body: JSON.stringify({ resolution_notes: "Resolved from supervisor console." })
      });
      await refresh("Delivery exception resolved.");
    } catch (error) { showError(error); }
    return;
  }
  const closeBatch = event.target.closest("[data-close-batch]");
  if (closeBatch) {
    if (!window.confirm("Close this batch? Its counts will be locked.")) return;
    try {
      await ops(`/ops/v1/delivery-batches/${closeBatch.dataset.closeBatch}/close`, {
        method: "POST",
        headers: { "Idempotency-Key": key("dclose") },
        body: JSON.stringify({})
      });
      await refresh("Batch closed and locked.");
    } catch (error) { showError(error); }
    return;
  }
  const closeoutButton = event.target.closest("[data-submit-closeout]");
  if (closeoutButton) {
    const amoebaId = closeoutButton.dataset.submitCloseout;
    const note = document.querySelector(`[data-closeout-note="${amoebaId}"]`)?.value.trim() || null;
    closeoutButton.disabled = true;
    closeoutButton.textContent = "Submitting…";
    try {
      const openCount = state.alerts.filter((alert) =>
        ["open", "escalated"].includes(alert.resolution_status)).length;
      await ops("/ops/v1/daily-closeouts", {
        method: "POST",
        headers: { "Idempotency-Key": key("closeout") },
        body: JSON.stringify({
          record_date: state.dateTo,
          amoeba_id: amoebaId,
          unresolved_alert_count: openCount,
          notes: note
        })
      });
      await refresh("Closeout submitted.");
    } catch (error) {
      closeoutButton.disabled = false;
      closeoutButton.textContent = "Submit closeout";
      showError(error);
    }
  }
});

el.actionDialog.addEventListener("close", async () => {
  if (el.actionDialog.returnValue !== "default" || !pendingAction) return;
  const notes = el.dialogNotes.value.trim();
  try {
    if (pendingAction.kind === "alert") {
      const { type, alert } = pendingAction;
      await ops(`/ops/v1/alerts/${alert.alert_id}/${type}`, {
        method: "POST",
        headers: { "Idempotency-Key": key(`alert-${type}`) },
        body: JSON.stringify(type === "resolve" ? { resolution_notes: notes || "Action completed." } : { note: notes })
      });
      await refresh(type === "resolve" ? "Alert resolved." : type === "escalate" ? "Alert escalated to manager." : "Alert acknowledged.");
    } else {
      const { type, incident } = pendingAction;
      await ops(`/ops/v1/incidents/${incident.incident_id}/${type}`, {
        method: "POST",
        headers: { "Idempotency-Key": key(`incident-${type}`) },
        body: JSON.stringify(type === "resolve" ? { resolution_notes: notes || "Handled in the field." } : {})
      });
      await refresh(type === "resolve" ? "Incident resolved." : "Incident acknowledged.");
    }
  } catch (error) { showError(error); }
  pendingAction = null;
});

el.inspectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.inspectionForm));
  try {
    const mediaIds = await uploadStagedPhoto("inspection", "inspection_evidence");
    await ops("/ops/v1/inspections", {
      method: "POST",
      headers: { "Idempotency-Key": key("inspection") },
      body: JSON.stringify({
        vehicle_id: values.vehicle_id,
        odometer_km: values.odometer_km || null,
        fuel_level_pct: values.fuel_level_pct || null,
        condition: values.condition,
        notes: values.notes || null,
        media_ids: mediaIds
      })
    });
    el.inspectionForm.reset();
    await refresh("Inspection submitted.");
  } catch (error) { showError(error); }
});

el.maintenanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(el.maintenanceForm));
  try {
    const mediaIds = await uploadStagedPhoto("maintenance", "maintenance_evidence");
    await ops("/ops/v1/maintenance-reports", {
      method: "POST",
      headers: { "Idempotency-Key": key("maintenance") },
      body: JSON.stringify({
        vehicle_id: values.vehicle_id,
        category: values.category,
        description: values.description || null,
        media_ids: mediaIds
      })
    });
    el.maintenanceForm.reset();
    await refresh("Maintenance issue reported.");
  } catch (error) { showError(error); }
});

function showError(error) {
  setConnection("error", "Connection issue");
  setNotice(error.message, true);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
refresh().catch(showError);
