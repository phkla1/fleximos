const foundationBase = "http://127.0.0.1:4010";
const opsBase = "http://127.0.0.1:4030";
const storageKey = "fleximotion_operator_access_token";
const ids = [
  "loginView", "appView", "loginForm", "loginNotice", "appNotice", "operatorName",
  "logoutButton", "operatingDate", "connectionStatus", "liveStatus", "revenueTotal",
  "paceLabel", "paceContext", "tripCount", "hoursOnline", "targetTotal", "assignment",
  "alertCount", "alerts", "mileage"
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let token = localStorage.getItem(storageKey);

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
el.operatingDate.value = today;

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

  const date = el.operatingDate.value || today;
  const [boardPage, performancePage, alertPage, mileagePage] = await Promise.all([
    api(opsBase, `/ops/v1/team-board?record_date=${date}`),
    api(opsBase, `/ops/v1/daily-performance?record_date=${date}`),
    api(opsBase, `/ops/v1/alerts?operator_id=${encodeURIComponent(operator.operator_id)}`),
    api(opsBase, `/ops/v1/mileage-reconciliations?record_date=${date}`)
  ]);
  const board = boardPage.data[0] || {};
  const performance = performancePage.data;
  const alerts = alertPage.data.filter((alert) => alert.resolution_status !== "resolved");
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
    <span>${escapeHtml(alert.platform_display_name || "General")} · Tier ${escapeHtml(alert.tier)} · ${escapeHtml(alert.resolution_status)}</span></div>
  `).join("") : `<div class="empty">No open alerts.</div>`;
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
el.operatingDate.addEventListener("change", () => load().catch((error) => {
  el.appNotice.textContent = error.message;
  el.appNotice.classList.add("error");
}));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
load().catch((error) => showLogin(error.message));
