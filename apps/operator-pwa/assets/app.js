const query = new URLSearchParams(location.search);
const foundationBase = query.get("foundationApiBase") || window.flexiServiceBase("foundation", 4010);
const opsBase = query.get("opsApiBase") || window.flexiServiceBase("ops", 4030);
const storageKey = "fleximotion_operator_access_token";
const ids = [
  "loginView", "appView", "loginForm", "loginNotice", "appNotice", "operatorName",
  "logoutButton", "dateFrom", "dateTo", "connectionStatus", "liveStatus", "revenueTotal",
  "paceLabel", "paceContext", "tripCount", "hoursOnline", "targetTotal", "assignment",
  "alertCount", "alerts", "mileage", "leaderboard", "myRank", "maintenanceForm",
  "supportButton", "supportDialog", "incidentNote", "explainDialog", "explainContext",
  "explainReason", "explainNote"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let token = localStorage.getItem(storageKey);
let currentOperator = null;
let currentAlerts = [];

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

function money(value) {
  return `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function showLogin(message = "") {
  token = null;
  localStorage.removeItem(storageKey);
  el.appView.hidden = true;
  el.loginView.hidden = false;
  el.loginNotice.textContent = message;
}

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
  const [boardPage, performancePage, alertPage, mileagePage, leaderboardPage] = await Promise.all([
    api(opsBase, `/ops/v1/team-board?${range}`),
    api(opsBase, `/ops/v1/daily-performance?${range}`),
    api(opsBase, `/ops/v1/alerts?operator_id=${encodeURIComponent(operator.operator_id)}`),
    api(opsBase, `/ops/v1/mileage-reconciliations?${range}`),
    api(opsBase, `/ops/v1/leaderboard?period_start=${weekStart}&period_end=${date}&amoeba_id=${encodeURIComponent(operator.amoeba_id)}`).catch(() => null)
  ]);
  const board = boardPage.data[0] || {};
  const performance = performancePage.data;
  const alerts = alertPage.data.filter((alert) => alert.resolution_status !== "resolved");
  currentAlerts = alerts;
  const mileage = mileagePage.data[0];
  const revenue = performance.reduce((sum, row) => sum + Number(row.ride_revenue_ngn || 0), 0);
  const trips = performance.reduce((sum, row) => sum + Number(row.trips_total || 0), 0);
  const hours = performance.reduce((sum, row) => sum + Number(row.hours_online || 0), 0);
  const pace = String(board.pace_status || "not_available").replaceAll("_", " ");

  el.operatorName.textContent = profile.person?.display_name || "Driver";
  el.liveStatus.textContent = String(board.current_status || "not_seen_today").replaceAll("_", " ");
  el.revenueTotal.textContent = money(revenue);
  el.tripCount.textContent = trips;
  el.hoursOnline.textContent = `${hours.toFixed(1)}h`;
  el.targetTotal.textContent = money(board.daily_revenue_target_ngn);
  el.paceLabel.textContent = pace;
  el.paceContext.textContent = board.expected_revenue_ngn
    ? `${money(board.expected_revenue_ngn)} expected by now · ${Number(board.pace_variance_pct || 0).toFixed(1)}% variance`
    : "Waiting for a configured target and platform activity";
  el.assignment.innerHTML = `
    <div class="assignment-row"><strong>${escapeHtml(operator.vehicle_plate || "No vehicle assigned")}</strong>
    <span>${escapeHtml(operator.site_id)} · ${escapeHtml(operator.amoeba_id)}</span></div>
    ${(operator.platform_registrations || []).map((item) => `<div class="assignment-row"><strong>${escapeHtml(item.platform_display_name)}</strong><span>${escapeHtml(item.registration_status)} · ${escapeHtml(item.platform_operator_id)}</span></div>`).join("")}`;
  el.alertCount.textContent = alerts.length;
  el.alerts.innerHTML = alerts.length ? alerts.map((alert) => `
    <div class="alert-row"><strong>${escapeHtml(alert.alert_type.replaceAll("_", " "))}</strong>
    <span>${escapeHtml(alert.platform_display_name || "General")} · Tier ${escapeHtml(alert.tier)} · ${escapeHtml(alert.resolution_status.replaceAll("_", " "))}</span>
    ${alert.deviation_reason_code
      ? `<span class="explain-status">Reason sent: ${escapeHtml(String(alert.deviation_reason_code).replaceAll("_", " "))} (${escapeHtml(alert.deviation_review_status || "pending")})</span>`
      : `<button type="button" class="explain-button" data-explain-alert="${escapeHtml(alert.alert_id)}">Explain what happened</button>`}
    </div>
  `).join("") : `<div class="empty">No open alerts.</div>`;

  const leaderboard = leaderboardPage?.entries || [];
  const mine = leaderboard.find((entry) => entry.operator_id === operator.operator_id);
  el.myRank.textContent = mine ? `#${mine.rank}` : "—";
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
    <div class="mileage-row"><strong>${mileage.fuel_quantity === null ? "Fuel not yet confirmed" : `${Number(mileage.fuel_quantity)} ${escapeHtml(mileage.fuel_unit)} issued`}</strong>
    <span>Official: ${mileage.official_distance_km === null ? "awaiting data" : `${Number(mileage.official_distance_km)} km`} · Tracker: ${mileage.tracker_distance_km === null ? "unavailable" : `${Number(mileage.tracker_distance_km)} km`}</span></div>
  ` : `<div class="empty">No mileage record is available.</div>`;

  el.loginView.hidden = true;
  el.appView.hidden = false;
  el.connectionStatus.textContent = "Connected";
  el.appNotice.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}`;
}

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.loginNotice.textContent = "Signing in...";
  try {
    const values = Object.fromEntries(new FormData(el.loginForm));
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
el.dateFrom.addEventListener("change", () => load().catch((error) => {
  setNotice(error.message, true);
}));
el.dateTo.addEventListener("change", () => load().catch((error) => {
  el.appNotice.textContent = error.message;
  el.appNotice.classList.add("error");
}));

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appMessage(message, error = false) {
  el.appNotice.textContent = message;
  el.appNotice.classList.toggle("error", error);
}

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ gps_lat: position.coords.latitude, gps_lng: position.coords.longitude }),
      () => resolve({}),
      { timeout: 4000, maximumAge: 60000 }
    );
  });
}

el.supportButton.addEventListener("click", () => {
  el.incidentNote.value = "";
  el.supportDialog.showModal();
});

el.supportDialog.addEventListener("close", async () => {
  const incidentType = el.supportDialog.returnValue;
  if (!incidentType || incidentType === "cancel" || !currentOperator) return;
  appMessage("Sending support request...");
  try {
    const gps = await currentPosition();
    await api(opsBase, "/ops/v1/incidents", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("pwa-incident") },
      body: JSON.stringify({
        operator_id: currentOperator.operator_id,
        incident_type: incidentType,
        description: el.incidentNote.value.trim() || null,
        ...gps
      })
    });
    appMessage("Your supervisor has been notified.");
  } catch (error) {
    appMessage(error.message, true);
  }
});

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

el.maintenanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentOperator?.vehicle_id) return appMessage("No vehicle is assigned to your account.", true);
  const values = Object.fromEntries(new FormData(el.maintenanceForm));
  appMessage("Reporting the issue...");
  try {
    await api(opsBase, "/ops/v1/maintenance-reports", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("pwa-maintenance") },
      body: JSON.stringify({
        vehicle_id: currentOperator.vehicle_id,
        operator_id: currentOperator.operator_id,
        category: values.category,
        description: values.description || null
      })
    });
    el.maintenanceForm.reset();
    appMessage("Maintenance issue sent to your supervisor.");
  } catch (error) {
    appMessage(error.message, true);
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
load().catch((error) => showLogin(error.message));
