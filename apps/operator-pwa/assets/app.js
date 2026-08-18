const query = new URLSearchParams(location.search);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const storageKey = "fleximotion_operator_access_token";
const ids = [
  "loginView", "appView", "loginForm", "loginNotice", "appNotice", "operatorName",
  "logoutButton", "dateFrom", "dateTo", "connectionStatus", "liveStatus", "liveDot",
  "lastSeen", "revenueTotal", "paceLabel", "paceContext", "tripCount", "hoursOnline",
  "acceptancePct", "targetTotal", "assignment", "alertCount", "alertList", "mileage",
  "timeline", "leaderboard", "myRank", "myScore", "maintenanceForm", "supportButton",
  "supportDialog", "incidentNote", "explainDialog", "explainContext", "explainReason",
  "explainNote", "alertDockBadge", "deliveryCard", "dispatchList", "dispatchSummary",
  "dispatchDockBadge", "podDialog", "podContext", "podSignature", "podSignatureClear",
  "failDialog", "failContext", "failReason", "failNote"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let token = localStorage.getItem(storageKey);
let currentOperator = null;
let currentAlerts = [];
let currentIncidents = [];
let currentFuel = [];
let currentAssignments = [];
let currentStops = [];
let activeStopId = null;

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.dateFrom.value = today;
el.dateTo.value = today;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function api(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: token ? `Bearer ${token}` : undefined,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error?.message || "Request failed.");
  return body;
}

const money = (value) => `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const timeOf = (value) => new Date(value).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appMessage(message, error = false) {
  el.appNotice.textContent = message;
  el.appNotice.classList.toggle("error", error);
}

function showLogin(message = "") {
  token = null;
  localStorage.removeItem(storageKey);
  el.appView.hidden = true;
  el.loginView.hidden = false;
  el.loginNotice.textContent = message;
}

/* ---------- tabs ---------- */

const TABS = ["dispatch", "today", "alerts", "rank", "report"];
function activateTab(name) {
  const tab = TABS.includes(name) ? name : "today";
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.tab === tab));
  document.querySelectorAll("[data-tab-link]").forEach((link) => link.classList.toggle("active", link.dataset.tabLink === tab));
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", () => activateTab(location.hash.slice(1)));
activateTab(location.hash.slice(1));

/* ---------- gauges ---------- */

function renderGauge(id, pct, valueText, labelText, subText, tone) {
  const gauge = document.getElementById(id);
  const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const circumference = 2 * Math.PI * 50;
  const value = gauge.querySelector(".gauge-value");
  value.style.strokeDasharray = `${circumference}`;
  value.style.strokeDashoffset = `${circumference * (1 - clamped / 100)}`;
  gauge.dataset.tone = tone;
  gauge.querySelector("figcaption strong").textContent = valueText;
  if (labelText !== null) gauge.querySelector("figcaption span").textContent = labelText;
  gauge.querySelector("figcaption small").textContent = subText;
}

/* ---------- camera photo evidence (mirrors the supervisor app) ---------- */

const stagedPhotos = { incident: null, maintenance: null, pod: null, fail: null };

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
  const media = await api(opsBase, "/ops/v1/media", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("pwa-media") },
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

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-photo-input]");
  if (input?.files?.[0]) stagePhoto(input.dataset.photoInput, input.files[0]);
});

/* ---------- derived timeline ---------- */

function renderTimeline() {
  const events = [];
  for (const alert of currentAlerts) {
    events.push({ at: alert.fired_at, label: `${String(alert.alert_type).replaceAll("_", " ")} alert`, tone: "red" });
    if (alert.deviation_submitted_at) events.push({ at: alert.deviation_submitted_at, label: "You sent an explanation", tone: "yellow" });
    if (alert.resolved_at) events.push({ at: alert.resolved_at, label: "Alert resolved", tone: "green" });
  }
  for (const incident of currentIncidents) {
    events.push({ at: incident.occurred_at, label: `You reported ${String(incident.incident_type).replaceAll("_", " ")}`, tone: incident.severity === "high" ? "red" : "yellow" });
  }
  for (const issue of currentFuel) {
    events.push({ at: issue.issued_at, label: `Fuel/charge confirmed: ${Number(issue.quantity)} ${issue.unit}`, tone: "green" });
  }
  const rows = events.filter((event) => event.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);
  el.timeline.innerHTML = rows.length ? rows.map((event) => `
    <li class="tone-${event.tone}"><span>${timeOf(event.at)}</span>${escapeHtml(event.label)}</li>`).join("")
    : `<li class="tone-green"><span>—</span>Nothing recorded yet today. Stay safe out there.</li>`;
}

/* ---------- main load ---------- */

async function load() {
  if (!token) return showLogin();
  el.connectionStatus.textContent = "Loading";
  const profile = await api(foundationBase, "/identity/v1/me");
  const roster = await api(opsBase, "/ops/v1/operators");
  const operator = roster.data[0];
  if (!operator) throw new Error("No active Ops assignment is linked to this account.");

  currentOperator = operator;
  let dateFrom = el.dateFrom.value || el.dateTo.value || today;
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const date = dateTo;
  const weekStart = new Date(Date.parse(`${date}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const [boardPage, performancePage, alertPage, mileagePage, fuelPage, incidentPage, leaderboardPage, deliveryPage, stopsPage] = await Promise.all([
    api(opsBase, `/ops/v1/team-board?${range}`),
    api(opsBase, `/ops/v1/daily-performance?${range}`),
    api(opsBase, `/ops/v1/alerts?operator_id=${encodeURIComponent(operator.operator_id)}&${range}`),
    api(opsBase, `/ops/v1/mileage-reconciliations?${range}`),
    api(opsBase, `/ops/v1/fuel-issues?${range}`).catch(() => ({ data: [] })),
    api(opsBase, "/ops/v1/incidents").catch(() => ({ data: [] })),
    api(opsBase, `/ops/v1/leaderboard?period_start=${weekStart}&period_end=${date}&amoeba_id=${encodeURIComponent(operator.amoeba_id)}`).catch(() => null),
    api(opsBase, `/ops/v1/delivery-assignments?${range}`).catch(() => ({ data: [] })),
    api(opsBase, `/ops/v1/delivery-stops?${range}`).catch(() => ({ data: [] }))
  ]);
  const board = boardPage.data[0] || {};
  const performance = performancePage.data;
  currentAlerts = alertPage.data.filter((alert) => alert.resolution_status !== "resolved");
  currentIncidents = incidentPage.data.filter((incident) => incident.operator_id === operator.operator_id);
  currentFuel = fuelPage.data.filter((issue) => issue.operator_id === operator.operator_id);
  const mileage = mileagePage.data.find((row) => row.operator_id === operator.operator_id);
  const revenue = performance.reduce((sum, row) => sum + Number(row.ride_revenue_ngn || 0), 0);
  const trips = performance.reduce((sum, row) => sum + Number(row.trips_total || 0), 0);
  const hours = performance.reduce((sum, row) => sum + Number(row.hours_online || 0), 0);
  const acceptanceRows = performance.filter((row) => Number(row.acceptance_pct));
  const acceptance = acceptanceRows.length
    ? acceptanceRows.reduce((sum, row) => sum + Number(row.acceptance_pct), 0) / acceptanceRows.length
    : null;
  const paceStatus = String(board.pace_status || "not_available");
  const target = Number(board.range_revenue_target_ngn ?? board.daily_revenue_target_ngn ?? 0);
  const pacePct = target ? revenue / target * 100 : 0;

  el.operatorName.textContent = profile.person?.display_name || "Driver";
  renderGauge("earningsGauge", pacePct, money(revenue), null,
    target ? `${Math.round(pacePct)}% of ${money(target)} target` : "No target configured",
    ["ahead", "on_track"].includes(paceStatus) ? "green" : paceStatus === "behind" ? "yellow" : paceStatus === "at_risk" ? "red" : "green");
  el.paceLabel.textContent = paceStatus.replaceAll("_", " ");
  el.paceLabel.className = `pace-status ${paceStatus}`;
  el.paceContext.textContent = board.expected_revenue_ngn
    ? `${money(board.expected_revenue_ngn)} expected by now`
    : "Waiting for platform activity";

  const status = String(board.current_status || "not_seen_today");
  el.liveStatus.textContent = status.replaceAll("_", " ");
  el.liveDot.className = `status-dot ${status}`;
  el.lastSeen.textContent = board.last_seen_at ? `Last seen ${timeOf(board.last_seen_at)}` : "";

  el.tripCount.textContent = trips;
  el.hoursOnline.textContent = `${hours.toFixed(1)}h`;
  el.acceptancePct.textContent = acceptance === null ? "—" : `${acceptance.toFixed(0)}%`;
  el.targetTotal.textContent = money(target);

  el.assignment.innerHTML = `
    <div class="card-row"><strong>${escapeHtml(operator.vehicle_plate || "No vehicle assigned")}</strong>
    <span>${escapeHtml(operator.site_id)} · ${escapeHtml(operator.amoeba_id)}</span></div>
    ${(operator.platform_registrations || []).map((item) => `<div class="card-row"><strong>${escapeHtml(item.platform_display_name)}</strong><span>${escapeHtml(item.registration_status)}</span></div>`).join("")}`;

  el.alertCount.textContent = currentAlerts.length;
  el.alertDockBadge.hidden = !currentAlerts.length;
  el.alertDockBadge.textContent = currentAlerts.length;
  el.alertList.innerHTML = currentAlerts.length ? currentAlerts.map((alert) => `
    <div class="card-row alert-card tier-${escapeHtml(alert.tier)}"><strong>${escapeHtml(alert.alert_type.replaceAll("_", " "))}</strong>
    <span>${escapeHtml(alert.platform_display_name || "General")} · Tier ${escapeHtml(alert.tier)} · ${escapeHtml(alert.resolution_status.replaceAll("_", " "))}</span>
    ${alert.deviation_reason_code
      ? `<span class="explain-status">Reason sent: ${escapeHtml(String(alert.deviation_reason_code).replaceAll("_", " "))} (${escapeHtml(alert.deviation_review_status || "pending")})</span>`
      : `<button type="button" class="explain-button" data-explain-alert="${escapeHtml(alert.alert_id)}">Explain what happened</button>`}
    </div>
  `).join("") : `<div class="empty all-clear">No open alerts. Clean sheet. ✅</div>`;

  const leaderboard = leaderboardPage?.entries || [];
  const mine = leaderboard.find((entry) => entry.operator_id === operator.operator_id);
  renderGauge("rankGauge", mine ? mine.performance_score : 0,
    mine ? `#${mine.rank}` : "—", null,
    mine ? `Score ${Math.round(mine.performance_score)}/100` : "No activity yet this week",
    mine ? (mine.performance_score >= 75 ? "green" : mine.performance_score >= 50 ? "yellow" : "red") : "green");
  el.myScore.textContent = mine ? `Score ${Math.round(mine.performance_score)}/100` : "";
  const medals = { gold: "🥇", silver: "🥈", bronze: "🥉" };
  el.leaderboard.innerHTML = leaderboard.length ? leaderboard.slice(0, 5).map((entry) => `
    <div class="leader-row ${entry.operator_id === operator.operator_id ? "me" : ""}">
      <span class="leader-rank">${entry.badge ? medals[entry.badge] : entry.rank}</span>
      <div><strong>${entry.operator_id === operator.operator_id ? "You" : `Driver ${entry.rank}`}</strong>
      <span>Acceptance ${entry.components.acceptance_score} · Online ${entry.components.time_online_score} · Cash ${entry.components.cash_receipt_score}</span></div>
      <strong class="leader-score">${Math.round(entry.performance_score)}</strong>
    </div>
  `).join("") + (mine && mine.rank > 5 ? `
    <div class="leader-row me">
      <span class="leader-rank">${mine.rank}</span>
      <div><strong>You</strong><span>Acceptance ${mine.components.acceptance_score} · Online ${mine.components.time_online_score} · Cash ${mine.components.cash_receipt_score}</span></div>
      <strong class="leader-score">${Math.round(mine.performance_score)}</strong>
    </div>` : "") : `<div class="empty">No team activity in the last 7 days.</div>`;

  el.mileage.innerHTML = mileage ? `
    <div class="card-row"><strong>${mileage.fuel_quantity === null ? "Fuel not yet confirmed" : `${Number(mileage.fuel_quantity)} ${escapeHtml(mileage.fuel_unit)} issued`}</strong>
    <span>Official: ${mileage.official_distance_km === null ? "awaiting data" : `${Number(mileage.official_distance_km)} km`} · Tracker: ${mileage.tracker_distance_km === null ? "unavailable" : `${Number(mileage.tracker_distance_km)} km`}</span></div>
  ` : `<div class="empty">No mileage record is available.</div>`;

  const myDeliveries = deliveryPage.data.filter((assignment) => assignment.operator_id === operator.operator_id);
  currentAssignments = myDeliveries;
  currentStops = stopsPage.data.filter((stop) => myDeliveries.some((assignment) => assignment.assignment_id === stop.assignment_id));
  renderDispatch();
  if (myDeliveries.some((assignment) => assignment.batch_status !== "closed") && !location.hash) activateTab("dispatch");
  el.deliveryCard.innerHTML = myDeliveries.length ? `
    <div class="section-heading"><h2>Deliveries today</h2></div>
    <div class="card-list">${myDeliveries.map((assignment) => {
      const progress = Number(assignment.assigned_count) ? Math.min(100, Math.round(Number(assignment.delivered_count) / Number(assignment.assigned_count) * 100)) : 0;
      return `
      <div class="card-row">
        <strong>${escapeHtml(assignment.customer_name)} · ${Number(assignment.delivered_count)} of ${Number(assignment.assigned_count)} delivered</strong>
        <span>${Number(assignment.failed_count)} failed · ${money(assignment.earned_value_allocated_ngn)} earned of ${money(assignment.target_value_allocated_ngn)} target</span>
        <div class="progress-track" style="height:8px;border-radius:999px;background:#e6ede9;overflow:hidden"><span style="display:block;height:100%;width:${progress}%;background:linear-gradient(90deg,#157a5c,#2c9e6f)"></span></div>
      </div>`;
    }).join("")}</div>` : "";

  renderTimeline();

  el.loginView.hidden = true;
  el.loginNotice.textContent = "";
  el.appView.hidden = false;
  el.connectionStatus.textContent = "Connected";
  appMessage(`Updated ${timeOf(new Date())}`);
}

/* ---------- MY DISPATCH ---------- */

function renderDispatch() {
  const open = currentAssignments.filter((assignment) => assignment.batch_status !== "closed");
  const pendingStops = currentStops.filter((stop) => !["delivered", "failed"].includes(stop.status)).length;
  el.dispatchDockBadge.hidden = !pendingStops;
  el.dispatchDockBadge.textContent = pendingStops;
  const totals = currentAssignments.reduce((sum, item) => {
    sum.assigned += Number(item.assigned_count); sum.delivered += Number(item.delivered_count);
    sum.failed += Number(item.failed_count); return sum;
  }, { assigned: 0, delivered: 0, failed: 0 });
  el.dispatchSummary.textContent = currentAssignments.length
    ? `${totals.delivered} of ${totals.assigned} delivered · ${totals.failed} failed · ${Math.max(0, totals.assigned - totals.delivered - totals.failed)} pending`
    : "";

  el.dispatchList.innerHTML = currentAssignments.length ? currentAssignments.map((assignment) => {
    const stops = currentStops
      .filter((stop) => stop.assignment_id === assignment.assignment_id)
      .sort((a, b) => a.sequence - b.sequence);
    const closed = assignment.batch_status === "closed";
    const nextStop = stops.find((stop) => !["delivered", "failed"].includes(stop.status));
    const progress = Number(assignment.assigned_count)
      ? Math.min(100, Math.round(Number(assignment.delivered_count) / Number(assignment.assigned_count) * 100)) : 0;
    return `
    <div class="card-row">
      <strong>${escapeHtml(assignment.customer_name)} · ${Number(assignment.delivered_count)}/${Number(assignment.assigned_count)} delivered</strong>
      <span>${Number(assignment.failed_count)} failed · ${money(assignment.earned_value_allocated_ngn)} earned of ${money(assignment.target_value_allocated_ngn)} target${closed ? " · batch closed" : ""}</span>
      <div class="progress-track" style="height:8px;border-radius:999px;background:#e6ede9;overflow:hidden"><span style="display:block;height:100%;width:${progress}%;background:linear-gradient(90deg,#157a5c,#2c9e6f)"></span></div>
      ${closed ? "" : assignment.status === "assigned"
        ? `<button type="button" class="start-route" data-start-route="${escapeHtml(assignment.assignment_id)}">🚀 START ROUTE</button>` : ""}
      ${stops.length ? stops.map((stop) => {
        const active = !closed && nextStop && stop.stop_id === nextStop.stop_id && assignment.status !== "assigned";
        return `
        <div class="stop-row status-${escapeHtml(stop.status)}">
          <div class="stop-head"><span class="stop-seq">${stop.sequence}</span>
            <div><strong>${escapeHtml(stop.customer_name)}</strong><span> · ${stop.parcel_count} parcel${stop.parcel_count === 1 ? "" : "s"} · ${escapeHtml(String(stop.status).replaceAll("_", " "))}${stop.failed_reason ? ` (${escapeHtml(String(stop.failed_reason).replaceAll("_", " "))})` : ""}</span>
            ${stop.address ? `<span>${escapeHtml(stop.address)}</span>` : ""}</div>
          </div>
          ${active ? `
          <div class="stop-actions">
            ${stop.address ? `<a class="secondary" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(stop.address)}">🗺 Navigate</a>` : ""}
            ${stop.phone ? `<a class="secondary" href="tel:${escapeHtml(stop.phone)}">📞 Call</a>` : ""}
            ${stop.status !== "arrived" ? `<button type="button" data-stop-arrived="${escapeHtml(stop.stop_id)}">📍 Arrived</button>` : ""}
            <button type="button" data-stop-deliver="${escapeHtml(stop.stop_id)}">✅ Delivered</button>
            <button type="button" class="danger" data-stop-fail="${escapeHtml(stop.stop_id)}">✖ Failed</button>
          </div>` : ""}
        </div>`;
      }).join("") : closed ? "" : `
      <div class="count-steppers" data-assignment-steppers="${escapeHtml(assignment.assignment_id)}">
        <label>Delivered<input type="number" min="0" value="${Number(assignment.delivered_count)}" data-field="delivered_count" /></label>
        <label>Failed<input type="number" min="0" value="${Number(assignment.failed_count)}" data-field="failed_count" /></label>
        <button type="button" class="explain-button" data-save-progress="${escapeHtml(assignment.assignment_id)}">Save progress</button>
      </div>`}
    </div>`;
  }).join("") : `<div class="empty">No delivery work assigned for this range. Your supervisor assigns dispatch batches.</div>`;
}

async function stopStatus(stopId, payload, message) {
  await api(opsBase, `/ops/v1/delivery-stops/${stopId}/status`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("stop") },
    body: JSON.stringify(payload)
  });
  await load();
  appMessage(message);
}

/* signature pad */
const signature = { drawing: false, used: false };
function signatureContext() {
  const canvas = el.podSignature;
  const context = canvas.getContext("2d");
  context.lineWidth = 2.4; context.lineCap = "round"; context.strokeStyle = "#17231f";
  return context;
}
function signaturePoint(event) {
  const rect = el.podSignature.getBoundingClientRect();
  const source = event.touches ? event.touches[0] : event;
  return {
    x: (source.clientX - rect.left) * (el.podSignature.width / rect.width),
    y: (source.clientY - rect.top) * (el.podSignature.height / rect.height)
  };
}
for (const [start, move, end] of [["mousedown", "mousemove", "mouseup"], ["touchstart", "touchmove", "touchend"]]) {
  el.podSignature.addEventListener(start, (event) => {
    event.preventDefault();
    signature.drawing = true; signature.used = true;
    const point = signaturePoint(event);
    const context = signatureContext();
    context.beginPath(); context.moveTo(point.x, point.y);
  });
  el.podSignature.addEventListener(move, (event) => {
    if (!signature.drawing) return;
    event.preventDefault();
    const point = signaturePoint(event);
    const context = el.podSignature.getContext("2d");
    context.lineTo(point.x, point.y); context.stroke();
  });
  el.podSignature.addEventListener(end, () => { signature.drawing = false; });
}
function clearSignature() {
  el.podSignature.getContext("2d").clearRect(0, 0, el.podSignature.width, el.podSignature.height);
  signature.used = false;
}
el.podSignatureClear.addEventListener("click", clearSignature);

async function uploadSignature() {
  if (!signature.used) return [];
  const base64 = el.podSignature.toDataURL("image/png").split(",")[1];
  const gps = await currentPosition();
  const media = await api(opsBase, "/ops/v1/media", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("pod-sig") },
    body: JSON.stringify({
      kind: "delivery_pod_signature", content_type: "image/png", content_base64: base64,
      captured_at: new Date().toISOString(), gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null
    })
  });
  return [media.media_id];
}

document.addEventListener("click", async (event) => {
  const startRoute = event.target.closest("[data-start-route]");
  if (startRoute) {
    try {
      await api(opsBase, `/ops/v1/delivery-assignments/${startRoute.dataset.startRoute}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("route") },
        body: JSON.stringify({ status: "out_for_delivery" })
      });
      await load();
      appMessage("Route started — safe riding. 🏍");
    } catch (error) { appMessage(error.message, true); }
    return;
  }
  const arrived = event.target.closest("[data-stop-arrived]");
  if (arrived) {
    try { await stopStatus(arrived.dataset.stopArrived, { status: "arrived" }, "Arrival recorded."); }
    catch (error) { appMessage(error.message, true); }
    return;
  }
  const deliver = event.target.closest("[data-stop-deliver]");
  if (deliver) {
    activeStopId = deliver.dataset.stopDeliver;
    const stop = currentStops.find((item) => item.stop_id === activeStopId);
    el.podContext.textContent = `${stop.customer_name} · ${stop.parcel_count} parcel${stop.parcel_count === 1 ? "" : "s"}. Photo and signature are optional but make the delivery defensible.`;
    stagedPhotos.pod = null;
    const status = document.querySelector('[data-photo-status="pod"]');
    if (status) status.textContent = "";
    clearSignature();
    el.podDialog.showModal();
    return;
  }
  const fail = event.target.closest("[data-stop-fail]");
  if (fail) {
    activeStopId = fail.dataset.stopFail;
    const stop = currentStops.find((item) => item.stop_id === activeStopId);
    el.failContext.textContent = `${stop.customer_name} · ${stop.parcel_count} parcel${stop.parcel_count === 1 ? "" : "s"}.`;
    el.failNote.value = "";
    stagedPhotos.fail = null;
    el.failDialog.showModal();
    return;
  }
  const saveProgress = event.target.closest("[data-save-progress]");
  if (saveProgress) {
    const wrap = document.querySelector(`[data-assignment-steppers="${saveProgress.dataset.saveProgress}"]`);
    const payload = {};
    for (const input of wrap.querySelectorAll("input[data-field]")) payload[input.dataset.field] = Number(input.value || 0);
    try {
      await api(opsBase, `/ops/v1/delivery-assignments/${saveProgress.dataset.saveProgress}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("self-progress") },
        body: JSON.stringify({ ...payload, status: "out_for_delivery" })
      });
      await load();
      appMessage("Progress saved — your supervisor confirms at closeout.");
    } catch (error) { appMessage(error.message, true); }
  }
});

el.podDialog.addEventListener("close", async () => {
  if (el.podDialog.returnValue !== "deliver" || !activeStopId) return;
  appMessage("Recording delivery...");
  try {
    const photoIds = await uploadStagedPhoto("pod", "delivery_pod_photo");
    const signatureIds = await uploadSignature();
    await stopStatus(activeStopId, { status: "delivered", media_ids: [...photoIds, ...signatureIds] }, "Delivered — proof attached. ✅");
  } catch (error) { appMessage(error.message, true); }
  activeStopId = null;
});

el.failDialog.addEventListener("close", async () => {
  if (el.failDialog.returnValue !== "fail" || !activeStopId) return;
  if (el.failReason.value === "other" && !el.failNote.value.trim()) {
    appMessage("Add a note when choosing Other.", true);
    return;
  }
  appMessage("Recording failed delivery...");
  try {
    const photoIds = await uploadStagedPhoto("fail", "delivery_fail_evidence");
    await stopStatus(activeStopId, {
      status: "failed", failed_reason: el.failReason.value,
      notes: el.failNote.value.trim() || null, media_ids: photoIds
    }, "Failure recorded — your supervisor can see the reason.");
  } catch (error) { appMessage(error.message, true); }
  activeStopId = null;
});

/* ---------- auth ---------- */

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.loginNotice.textContent = "Signing in...";
  el.loginNotice.classList.remove("error");
  try {
    const values = Object.fromEntries(new FormData(el.loginForm));
    values.phone_or_email = String(values.phone_or_email || "").replace(/[\s\-()]/g, "");
    values.pin = String(values.pin || "").trim();
    const session = await api(foundationBase, "/identity/v1/auth/login", {
      method: "POST", body: JSON.stringify(values)
    });
    token = session.access_token;
    localStorage.setItem(storageKey, token);
    await load();
  } catch (error) {
    showLogin(error.message);
    el.loginNotice.classList.add("error");
  }
});
el.logoutButton.addEventListener("click", () => showLogin("Signed out."));
el.dateFrom.addEventListener("change", () => load().catch((error) => appMessage(error.message, true)));
el.dateTo.addEventListener("change", () => load().catch((error) => appMessage(error.message, true)));

/* ---------- support (incidents, with optional photo) ---------- */

function openSupportDialog() {
  el.incidentNote.value = "";
  stagedPhotos.incident = null;
  const statusEl = document.querySelector('[data-photo-status="incident"]');
  if (statusEl) statusEl.textContent = "";
  el.supportDialog.showModal();
}
el.supportButton.addEventListener("click", openSupportDialog);
document.getElementById("sosFab").addEventListener("click", openSupportDialog);

el.supportDialog.addEventListener("close", async () => {
  const incidentType = el.supportDialog.returnValue;
  if (!incidentType || incidentType === "cancel" || !currentOperator) return;
  appMessage("Sending support request...");
  try {
    const gps = await currentPosition();
    const mediaIds = await uploadStagedPhoto("incident", "incident_evidence");
    await api(opsBase, "/ops/v1/incidents", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("pwa-incident") },
      body: JSON.stringify({
        operator_id: currentOperator.operator_id,
        incident_type: incidentType,
        description: el.incidentNote.value.trim() || null,
        media_ids: mediaIds,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null
      })
    });
    await load();
    appMessage(mediaIds.length ? "Your supervisor has been notified — photo attached." : "Your supervisor has been notified.");
  } catch (error) {
    appMessage(error.message, true);
  }
});

/* ---------- explain (deviation reasons) ---------- */

let explainingAlertId = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-explain-alert]");
  if (!button) return;
  explainingAlertId = button.dataset.explainAlert;
  const alert = currentAlerts.find((item) => item.alert_id === explainingAlertId);
  el.explainContext.textContent = `Your supervisor has been notified about “${String(alert.alert_type).replaceAll("_", " ")}”. Tell them what happened.`;
  el.explainNote.value = "";
  el.explainDialog.showModal();
});

el.explainDialog.addEventListener("close", async () => {
  if (el.explainDialog.returnValue !== "send" || !explainingAlertId) return;
  appMessage("Sending your explanation...");
  try {
    await api(opsBase, `/ops/v1/alerts/${explainingAlertId}/deviation-reason`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("pwa-deviation") },
      body: JSON.stringify({
        reason_code: el.explainReason.value,
        note: el.explainNote.value.trim() || null
      })
    });
    explainingAlertId = null;
    await load();
    appMessage("Explanation sent to your supervisor.");
  } catch (error) {
    appMessage(error.message, true);
  }
});

/* ---------- maintenance (with optional photo) ---------- */

el.maintenanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentOperator?.vehicle_id) return appMessage("No vehicle is assigned to your account.", true);
  const values = Object.fromEntries(new FormData(el.maintenanceForm));
  appMessage("Reporting the issue...");
  try {
    const mediaIds = await uploadStagedPhoto("maintenance", "maintenance_evidence");
    await api(opsBase, "/ops/v1/maintenance-reports", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("pwa-maintenance") },
      body: JSON.stringify({
        vehicle_id: currentOperator.vehicle_id,
        operator_id: currentOperator.operator_id,
        category: values.category,
        description: values.description || null,
        media_ids: mediaIds
      })
    });
    el.maintenanceForm.reset();
    appMessage(mediaIds.length ? "Maintenance issue sent — photo attached." : "Maintenance issue sent to your supervisor.");
  } catch (error) {
    appMessage(error.message, true);
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
load().catch((error) => showLogin(error.message));
