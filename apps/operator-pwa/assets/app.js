const query = new URLSearchParams(location.search);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const storageKey = "fleximotion_operator_access_token";
const refreshKey = "fleximotion_operator_refresh_token";
const ids = [
  "loginView", "appView", "loginForm", "loginNotice", "appNotice", "operatorName",
  "logoutButton", "dateFrom", "dateTo", "connectionStatus", "liveStatus", "liveDot",
  "lastSeen", "revenueTotal", "paceLabel", "paceContext", "tripCount", "hoursOnline",
  "acceptancePct", "targetTotal", "assignment", "alertCount", "alertList", "mileage",
  "timeline", "leaderboard", "myRank", "myScore", "maintenanceForm", "supportButton",
  "supportDialog", "incidentNote", "explainDialog", "explainContext", "explainReason",
  "explainNote", "alertDockBadge", "deliveryCard", "dispatchList", "dispatchSummary",
  "dispatchDockBadge", "podDialog", "podContext", "podSignature", "podSignatureClear",
  "failDialog", "failContext", "failReason", "failNote", "checkinCard",
  "pointsBalanceChip", "pointsBalance", "pointsRemaining", "pointsToday",
  "pointsBikeNote", "pointsMilestones", "pointsWeek", "pointsDispute"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let token = localStorage.getItem(storageKey);
let refreshToken = localStorage.getItem(refreshKey);
let currentOperator = null;
let currentAlerts = [];
let currentIncidents = [];
let currentFuel = [];
let currentAssignments = [];
let currentStops = [];
let activeStopId = null;

// Current date in Lagos (WAT). A function, not a load-time constant, so a PWA
// left open across midnight still checks in for the real "today", not yesterday.
const lagosToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.dateFrom.value = lagosToday();
el.dateTo.value = lagosToday();

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/* ---------- plain-language copy ----------
   Everything a rider reads should sound like a person talking, not a system.
   Alert/status codes are translated to short everyday sentences here; anything
   not in a map falls back to the words with underscores removed. */
const ALERT_COPY = {
  revenue_pace_at_risk: "You're behind on today's earnings target",
  not_seen_today: "We haven't seen you working yet today",
  currently_offline: "Your app looks offline — go back online to get jobs",
  high_usage_low_earnings: "You've driven a lot but earned little today",
  fuel_without_activity: "You got fuel but haven't started working",
  delivery_behind_schedule: "You're running behind on your deliveries",
  inspection_overdue: "Your bike is due for its safety check"
};
const PACE_LABELS = {
  at_risk: "Behind target",
  behind: "Slightly behind",
  on_track: "On track",
  ahead: "Ahead",
  not_available: "Not started yet"
};
const LIVE_LABELS = {
  not_seen_today: "Not working yet",
  offline: "Offline",
  checked_in: "Working",
  checked_out: "Finished for today"
};
const plainWords = (value) => String(value ?? "").replaceAll("_", " ");
const alertTitle = (type) => ALERT_COPY[type] || plainWords(type);
const paceLabel = (status) => PACE_LABELS[status] || plainWords(status);
const liveLabel = (status) => LIVE_LABELS[status] || plainWords(status);
const alertWaitLabel = (status) =>
  status === "acknowledged" || status === "in_progress" || status === "snoozed"
    ? "Your supervisor has seen this"
    : "Waiting for your supervisor";

// Exchange the stored refresh token for a fresh access token. Returns true on
// success (tokens updated in place), false if the refresh is gone/expired.
async function tryRefresh() {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${foundationBase}/identity/v1/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!response.ok) return false;
    const session = await response.json();
    token = session.access_token;
    refreshToken = session.refresh_token;
    try { localStorage.setItem(storageKey, token); localStorage.setItem(refreshKey, refreshToken); } catch { /* private mode */ }
    return true;
  } catch { return false; }
}

async function api(base, path, options = {}, _retried = false) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: token ? `Bearer ${token}` : undefined,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  // Access token expired → transparently refresh once and retry.
  if (response.status === 401 && !_retried && token && !path.includes("/auth/")) {
    if (await tryRefresh()) return api(base, path, options, true);
  }
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
  refreshToken = null;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(refreshKey);
  el.appView.hidden = true;
  el.loginView.hidden = false;
  el.loginNotice.textContent = message;
}

/* ---------- tabs ---------- */

const TABS = ["dispatch", "today", "alerts", "rank", "points", "report"];
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
    events.push({ at: alert.fired_at, label: alertTitle(alert.alert_type), tone: "red" });
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

/* ---------- daily check-in (GPS + supervisor confirmation) ---------- */
let currentCheckin = null;

function fenceText(checkin) {
  if (checkin.geofence_ok === true) return `At ${escapeHtml(checkin.matched_site_name || "an approved site")}`;
  if (checkin.geofence_ok === false) return `Outside the office${checkin.distance_m ? ` · ${Math.round(checkin.distance_m)}m away` : ""}`;
  return "Location recorded";
}

function renderCheckin() {
  const checkin = currentCheckin;
  if (checkin && checkin.status === "approved") {
    el.checkinCard.className = "checkin-card approved";
    el.checkinCard.innerHTML = `<div class="checkin-status"><strong>✓ Checked in</strong>
      <span>Approved${checkin.matched_site_name ? ` · ${escapeHtml(checkin.matched_site_name)}` : ""} · ${timeOf(checkin.decided_at || checkin.requested_at)}</span></div>`;
    return;
  }
  if (checkin && checkin.status === "pending") {
    el.checkinCard.className = "checkin-card pending";
    el.checkinCard.innerHTML = `<div class="checkin-status"><strong>⏳ Waiting for supervisor</strong><span>${fenceText(checkin)}</span></div>
      <button type="button" id="checkinButton" class="checkin-button ghost">Re-send location</button>`;
    return;
  }
  if (checkin && checkin.status === "rejected") {
    el.checkinCard.className = "checkin-card rejected";
    el.checkinCard.innerHTML = `<div class="checkin-status"><strong>✕ Check-in rejected</strong><span>${escapeHtml(checkin.decision_note || "Speak to your supervisor")}</span></div>
      <button type="button" id="checkinButton" class="checkin-button">Check in again</button>`;
    return;
  }
  el.checkinCard.className = "checkin-card";
  el.checkinCard.innerHTML = `<div class="checkin-status"><strong>Start your day</strong><span>Check in at the office to resume</span></div>
    <button type="button" id="checkinButton" class="checkin-button">Check in</button>`;
}

async function refreshCheckin() {
  if (!currentOperator) return;
  try {
    const result = await api(opsBase, `/ops/v1/checkins?check_in_date=${lagosToday()}`);
    currentCheckin = (result.data || []).find((row) => row.operator_id === currentOperator.operator_id) || null;
  } catch {
    currentCheckin = null;
  }
  renderCheckin();
}

// The supervisor's approve/reject needs to surface on the rider's screen without
// a manual reload. Poll while waiting on a decision, and refetch when the rider
// returns to the tab. Started once, after sign-in.
let checkinPoll = null;
function startCheckinPolling() {
  if (checkinPoll) return;
  checkinPoll = setInterval(() => {
    if (currentOperator && currentCheckin && currentCheckin.status === "pending") refreshCheckin();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentOperator) refreshCheckin();
  });
}

async function doCheckin() {
  const button = el.checkinCard.querySelector("#checkinButton");
  if (button) button.disabled = true;
  appMessage("Getting your location…");
  const coords = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
  try {
    await api(opsBase, "/ops/v1/checkins", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("checkin") },
      body: JSON.stringify({ check_in_date: lagosToday(), gps_lat: coords?.lat ?? null, gps_lng: coords?.lng ?? null })
    });
    appMessage(coords ? "Checked in — waiting for your supervisor to confirm." : "Checked in without GPS — waiting for your supervisor.");
  } catch (error) {
    appMessage(error.message, true);
  }
  await refreshCheckin();
}

el.checkinCard.addEventListener("click", (event) => {
  if (event.target.closest("#checkinButton")) doCheckin();
});

async function load() {
  if (!token) return showLogin();
  el.connectionStatus.textContent = "Loading";
  const profile = await api(foundationBase, "/identity/v1/me");
  // Resolve THIS person's own operator record (works even if they're also a
  // supervisor, whose data scope would otherwise return the people they oversee).
  const operator = (await api(opsBase, "/ops/v1/operators/me")).data;
  if (!operator) throw new Error("No active Ops assignment is linked to this account.");

  currentOperator = operator;
  void refreshCheckin();
  startCheckinPolling();
  setupSosPush();
  let dateFrom = el.dateFrom.value || el.dateTo.value || lagosToday();
  let dateTo = el.dateTo.value || dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  el.dateFrom.value = dateFrom;
  el.dateTo.value = dateTo;
  const range = `date_from=${dateFrom}&date_to=${dateTo}`;
  const date = dateTo;
  const weekStart = new Date(Date.parse(`${date}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const [boardPage, performancePage, alertPage, mileagePage, fuelPage, incidentPage, leaderboardPage, deliveryPage, stopsPage, pacingPage] = await Promise.all([
    api(opsBase, `/ops/v1/team-board?${range}`),
    api(opsBase, `/ops/v1/daily-performance?${range}`),
    api(opsBase, `/ops/v1/alerts?operator_id=${encodeURIComponent(operator.operator_id)}&${range}`),
    api(opsBase, `/ops/v1/mileage-reconciliations?${range}`),
    api(opsBase, `/ops/v1/fuel-issues?${range}`).catch(() => ({ data: [] })),
    api(opsBase, "/ops/v1/incidents").catch(() => ({ data: [] })),
    api(opsBase, `/ops/v1/leaderboard?period_start=${weekStart}&period_end=${date}&amoeba_id=${encodeURIComponent(operator.amoeba_id)}`).catch(() => null),
    api(opsBase, `/ops/v1/delivery-assignments?${range}`).catch(() => ({ data: [] })),
    api(opsBase, `/ops/v1/delivery-stops?${range}`).catch(() => ({ data: [] })),
    api(opsBase, `/ops/v1/pacing?record_date=${date}`).catch(() => ({ data: [] }))
  ]);
  const pointsSummary = await api(opsBase, "/ops/v1/flexi-points/me").catch(() => null);
  const board = boardPage.data[0] || {};
  const pace = (pacingPage.data || []).find((row) => row.operator_id === operator.operator_id) || null;
  const performance = performancePage.data;
  currentAlerts = alertPage.data.filter((alert) => alert.resolution_status !== "resolved");
  currentIncidents = incidentPage.data.filter((incident) => incident.operator_id === operator.operator_id);
  currentFuel = fuelPage.data.filter((issue) => issue.operator_id === operator.operator_id);
  const mileage = mileagePage.data.find((row) => row.operator_id === operator.operator_id);
  const rideEarned = performance.reduce((sum, row) => sum + Number(row.net_earnings_ngn || 0), 0);
  const trips = performance.reduce((sum, row) => sum + Number(row.trips_total || 0), 0);
  const hours = performance.reduce((sum, row) => sum + Number(row.hours_online || 0), 0);
  const acceptanceRows = performance.filter((row) => Number(row.acceptance_pct));
  const acceptance = acceptanceRows.length
    ? acceptanceRows.reduce((sum, row) => sum + Number(row.acceptance_pct), 0) / acceptanceRows.length
    : null;
  // The gauge shows COMBINED earnings (rides + scheduled deliveries) against the
  // day's target — the same pace the alert engine uses — so a rider doing
  // deliveries is never shown "behind" on ride revenue alone. Falls back to the
  // ride-only figure only when today's pacing isn't available.
  const earnedToday = pace ? Number(pace.combined_earned_ngn || 0) : rideEarned;
  const paceStatus = String(pace?.combined_pace_status || board.pace_status || "not_available");
  const target = Number(pace?.daily_revenue_target_ngn ?? board.range_revenue_target_ngn ?? board.daily_revenue_target_ngn ?? 0);
  const pacePct = target ? earnedToday / target * 100 : 0;

  el.operatorName.textContent = profile.person?.display_name || "Driver";
  // Onboarding ramp: the gauge target is already the ramped (fair) target; label
  // it as a training-day target so a new rider understands the lower number.
  const onboardingRamp = pace?.onboarding_ramp || board.onboarding_ramp || null;
  const targetLabel = onboardingRamp
    ? `Onboarding Day ${onboardingRamp.day_n}/${onboardingRamp.total_days} · target ${money(target)}`
    : (target ? `${Math.round(pacePct)}% of ${money(target)} target` : "No target set yet");
  renderGauge("earningsGauge", pacePct, money(earnedToday), null, targetLabel,
    ["ahead", "on_track"].includes(paceStatus) ? "green" : paceStatus === "behind" ? "yellow" : paceStatus === "at_risk" ? "red" : "green");
  el.paceLabel.textContent = paceLabel(paceStatus);
  el.paceLabel.className = `pace-status ${paceStatus}`;
  if (pace && Number(pace.scheduled_assigned || 0) > 0) {
    // Resumption-aware: after scheduled deliveries, show what's left to earn
    // online and by when the rider should be back on the apps.
    const deadline = pace.resumption_deadline ? ` · online by ${pace.resumption_deadline}` : "";
    el.paceContext.textContent =
      `Online target ${money(pace.online_target_ngn)} · earned ${money(pace.online_earned_ngn)}${deadline}`;
  } else {
    el.paceContext.textContent = board.expected_revenue_ngn
      ? `${money(board.expected_revenue_ngn)} expected by now`
      : "Waiting for you to start work";
  }

  const status = String(board.current_status || "not_seen_today");
  el.liveStatus.textContent = liveLabel(status);
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
    <div class="card-row alert-card tier-${escapeHtml(alert.tier)}"><strong>${escapeHtml(alertTitle(alert.alert_type))}</strong>
    <span>${escapeHtml(alertWaitLabel(alert.resolution_status))}</span>
    ${alert.deviation_reason_code
      ? `<span class="explain-status">You said: ${escapeHtml(plainWords(alert.deviation_reason_code))} — your supervisor is reviewing it.</span>`
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
  // Each component carries a state. A measured value or a real gap (0) shows its
  // number; a component held out of the score (not applicable, or on-demand data
  // not yet confirmed) shows a word, never a misleading 0 or 100.
  const comp = (value, stateVal) => {
    if (stateVal === "data_gap") return `${value ?? 0}⚠`;
    if (stateVal === "unconfirmed") return "pending";
    if (stateVal === "not_applicable" || value === null || value === undefined) return "—";
    return value;
  };
  const line = (entry) => {
    const st = entry.component_states || {};
    return `Acceptance ${comp(entry.components.acceptance_score, st.acceptance)} · Online ${comp(entry.components.time_online_score, st.time_online)} · Cash ${comp(entry.components.cash_receipt_score, st.cash_receipt)}`;
  };
  el.leaderboard.innerHTML = leaderboard.length ? leaderboard.slice(0, 5).map((entry) => `
    <div class="leader-row ${entry.operator_id === operator.operator_id ? "me" : ""}">
      <span class="leader-rank">${entry.badge ? medals[entry.badge] : entry.rank}</span>
      <div><strong>${entry.operator_id === operator.operator_id ? "You" : `Driver ${entry.rank}`}</strong>
      <span>${line(entry)}</span></div>
      <strong class="leader-score">${Math.round(entry.performance_score)}</strong>
    </div>
  `).join("") + (mine && mine.rank > 5 ? `
    <div class="leader-row me">
      <span class="leader-rank">${mine.rank}</span>
      <div><strong>You</strong><span>${line(mine)}</span></div>
      <strong class="leader-score">${Math.round(mine.performance_score)}</strong>
    </div>` : "") : `<div class="empty">Your team has no activity in the last 7 days.</div>`;
  // Tell the rider honestly when their own score is running on incomplete data.
  if (mine && mine.data_quality && mine.data_quality.confidence !== "ok") {
    el.leaderboard.insertAdjacentHTML("beforeend",
      `<div class="leader-note">⚠ Some of your score is missing today's data, so it may not be complete. Your supervisor can sort this out.</div>`);
  }

  const distanceKm = mileage && (mileage.official_distance_km ?? mileage.tracker_distance_km);
  el.mileage.innerHTML = mileage ? `
    <div class="card-row"><strong>${mileage.fuel_quantity === null ? "Fuel not confirmed yet" : `${Number(mileage.fuel_quantity)} ${escapeHtml(mileage.fuel_unit)} given`}</strong>
    <span>${distanceKm === null || distanceKm === undefined ? "Distance not in yet" : `${Number(distanceKm)} km so far today`}</span></div>
  ` : `<div class="empty">Nothing to show here yet.</div>`;

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
  renderPoints(pointsSummary);

  el.loginView.hidden = true;
  el.loginNotice.textContent = "";
  el.appView.hidden = false;
  el.connectionStatus.textContent = "Connected";
  appMessage(`Updated ${timeOf(new Date())}`);
}

/* ---------- MY PROGRESS (Flexi Points) ---------- */

function renderPoints(summary) {
  if (!summary) {
    el.pointsBalanceChip.hidden = true;
    renderGauge("pointsGauge", 0, "—", null, "Points aren't available right now", "green");
    el.pointsToday.innerHTML = "";
    el.pointsBikeNote.textContent = "";
    el.pointsMilestones.innerHTML = `<div class="empty">Check back soon.</div>`;
    el.pointsWeek.innerHTML = "";
    return;
  }

  const balance = Number(summary.balance || 0);
  const target = Number(summary.points_target || 0);
  const remaining = Number(summary.points_remaining || 0);

  el.pointsBalanceChip.hidden = false;
  el.pointsBalanceChip.textContent = `${balance} of ${target}`;
  renderGauge("pointsGauge", Number(summary.progress_pct || 0), String(balance), null,
    remaining > 0 ? `${remaining} more to earn a bike` : "You've reached the bike target", "green");

  // Today's points, explained in plain numbers.
  const today = summary.today || {};
  const earnedToday = Number(today.points || 0);
  el.pointsToday.className = `points-today ${earnedToday > 0 ? "earned" : ""}`;
  el.pointsToday.innerHTML = `
    <div class="points-today-head"><strong>Today</strong><span>${earnedToday > 0 ? `+${earnedToday} point${earnedToday === 1 ? "" : "s"}` : "0 points"}</span></div>
    <p>${escapeHtml(today.message || "")}</p>`;

  // The programme's guardrail, shown word for word.
  el.pointsBikeNote.textContent = summary.bike_note || "";

  // Milestones are standings only for now (display-only in this phase).
  const milestones = summary.milestones || [];
  el.pointsMilestones.innerHTML = milestones.length ? milestones.map((m) => `
    <div class="points-milestone ${m.reached ? "reached" : ""}">
      <span class="points-milestone-mark">${m.reached ? "✓" : ""}</span>
      <div><strong>${escapeHtml(m.label)}</strong><span>${Number(m.points)} points</span></div>
    </div>`).join("") : `<div class="empty">No milestones set.</div>`;

  // This week, most recent day first.
  const days = [...(summary.this_week?.days || [])].sort((a, b) => b.record_date.localeCompare(a.record_date));
  el.pointsWeek.innerHTML = days.length ? days.map((day) => `
    <div class="card-row">
      <strong>${dayLabel(day.record_date)} · ${day.points} point${day.points === 1 ? "" : "s"}</strong>
      <span>${money(day.verified_revenue_ngn)} confirmed</span>
    </div>`).join("") : `<div class="empty">No confirmed earnings yet this week.</div>`;
}

// Short friendly day label, e.g. "Mon 3 Nov".
function dayLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-NG", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC"
  });
}

el.pointsDispute.addEventListener("click", () => {
  appMessage("To question a day's points, tell your supervisor for now. You'll be able to do it here soon.");
});

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
    ? `${totals.delivered} of ${totals.assigned} delivered · ${totals.failed} failed · ${Math.max(0, totals.assigned - totals.delivered - totals.failed)} left`
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
  }).join("") : `<div class="empty">No deliveries assigned for these dates. Your supervisor adds them.</div>`;
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
    el.podContext.textContent = `${stop.customer_name} · ${stop.parcel_count} parcel${stop.parcel_count === 1 ? "" : "s"}. Photo and signature are optional, but they prove you delivered it.`;
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
      appMessage("Saved — your supervisor will confirm at the end of the day.");
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
    refreshToken = session.refresh_token;
    localStorage.setItem(storageKey, token);
    try { localStorage.setItem(refreshKey, refreshToken); } catch { /* private mode */ }
    await load();
  } catch (error) {
    showLogin(error.message);
    el.loginNotice.classList.add("error");
  }
});
el.logoutButton.addEventListener("click", async () => {
  // Best-effort server-side revocation so the session can't be reused.
  try {
    await fetch(`${foundationBase}/identity/v1/auth/logout`, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
  } catch { /* offline — local clear still signs out this device */ }
  showLogin("Signed out.");
});
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
  el.explainContext.textContent = `This is about: “${alertTitle(alert.alert_type)}”. Tell your supervisor what happened.`;
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

/* ---------- SOS push opt-in (so your supervisor's "on my way" reaches you) ---------- */
let sosPushWired = false;
function setupSosPush() {
  const control = document.getElementById("sosPushControl");
  const button = document.getElementById("sosPushBtn");
  const status = document.getElementById("sosPushStatus");
  const push = window.flexiPush;
  if (!control || !button || !push) return;
  control.hidden = false;

  async function paint() {
    if (!push.supported()) {
      button.hidden = true;
      status.textContent = "To get alerts on iPhone, add this app to your Home Screen first.";
      return;
    }
    if (push.permission() === "denied") {
      button.hidden = true;
      status.textContent = "Alerts are blocked. Turn them on for this app in your phone settings.";
      return;
    }
    const on = await push.isSubscribed();
    button.hidden = false;
    button.textContent = on ? "Turn off alerts" : "Turn on alerts";
    button.dataset.on = on ? "1" : "";
    status.textContent = on ? "On — we'll tell you when your supervisor is on the way." : "";
  }

  if (!sosPushWired) {
    sosPushWired = true;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const wasOn = button.dataset.on === "1";
      try {
        if (wasOn) await push.disable(opsBase, token);
        else await push.enable(opsBase, token);
      } catch (error) {
        status.textContent = error.message || "Could not change alerts.";
      } finally {
        button.disabled = false;
        await paint();
      }
    });
  }
  void paint();
}

load().catch((error) => showLogin(error.message));
