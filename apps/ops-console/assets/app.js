const state = {
  people: [],
  amoebas: [],
  sites: [],
  operators: [],
  vehicles: [],
  platformAccounts: [],
  alerts: []
};

const el = Object.fromEntries(
  [
    "notice", "connectionText", "activeOperatorCount", "openAlertCount",
    "activeVehicleCount", "activePlatformCount", "alertList", "operatorList",
    "vehicleList", "operatorForm", "vehicleForm", "alertFilter", "opsApiBase",
    "foundationApiBase", "apiToken", "actionDialog", "dialogTitle",
    "dialogContext", "dialogNotes", "confirmActionButton"
  ].map((id) => [id, document.getElementById(id)])
);

const query = new URLSearchParams(location.search);
if (query.get("opsApiBase")) el.opsApiBase.value = query.get("opsApiBase");
if (query.get("foundationApiBase")) el.foundationApiBase.value = query.get("foundationApiBase");

document.getElementById("todayLabel").textContent = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "full",
  timeZone: "Africa/Lagos"
}).format(new Date());

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
  const domainHeaders = base === el.opsApiBase ? { "X-Actor-Person-Id": "person_founder_wole" } : {};
  const response = await fetch(`${base.value.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${el.apiToken.value}`,
      "Content-Type": "application/json",
      ...domainHeaders,
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
  return state.people.find((person) => person.person_id === id)?.display_name || id || "Unassigned";
}

function nameForAmoeba(id) {
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
  updateSiteOptions();
}

function updateSiteOptions() {
  const amoebaId = el.operatorForm.elements.amoeba_id.value;
  const sites = state.sites.filter((site) => site.amoeba_id === amoebaId && site.status === "active");
  el.operatorForm.elements.site_id.innerHTML = optionHtml(sites, "site_id", "name");
}

function render() {
  el.activeOperatorCount.textContent = state.operators.filter((item) => item.operator_status === "active").length;
  el.openAlertCount.textContent = state.alerts.filter((item) => item.resolution_status === "open").length;
  el.activeVehicleCount.textContent = state.vehicles.filter((item) => item.status === "active").length;
  el.activePlatformCount.textContent = state.platformAccounts.filter((item) => item.is_active).length;
  renderOptions();

  const filter = el.alertFilter.value;
  const alerts = filter ? state.alerts.filter((alert) => alert.resolution_status === filter) : state.alerts;
  el.alertList.innerHTML = alerts.length ? alerts.map((alert) => `
    <article class="alert-row tier-${escapeHtml(alert.tier)}">
      <div><strong>${escapeHtml(alert.alert_type.replaceAll("_", " "))}</strong><small>${escapeHtml(nameForPerson(alert.person_id))} · ${escapeHtml(nameForAmoeba(alert.amoeba_id))}</small></div>
      <div><span class="row-label">Platform</span><strong>${escapeHtml(alert.platform_display_name || "General")}</strong><small>Tier ${escapeHtml(alert.tier)}</small></div>
      <div><span class="row-label">Fired</span><strong>${new Date(alert.fired_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</strong><small>${escapeHtml(JSON.stringify(alert.metadata))}</small></div>
      <div><span class="pill ${escapeHtml(alert.resolution_status)}">${escapeHtml(alert.resolution_status)}</span></div>
      <div class="row-actions">
        ${alert.resolution_status === "open" ? `<button type="button" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.alert_id)}">Acknowledge</button>` : ""}
        ${alert.resolution_status !== "resolved" ? `<button type="button" class="secondary" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.alert_id)}">Resolve</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="empty">No alerts match this view.</div>`;

  el.operatorList.innerHTML = state.operators.length ? state.operators.map((operator) => `
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
  `).join("") : `<div class="empty">No operators yet.</div>`;

  el.vehicleList.innerHTML = state.vehicles.length ? state.vehicles.map((vehicle) => `
    <article class="data-row">
      <div><strong>${escapeHtml(vehicle.plate)}</strong><small>${escapeHtml(vehicle.vehicle_id)}</small></div>
      <div><span class="row-label">Type</span><strong>${escapeHtml(vehicle.vehicle_type)}</strong><small>${escapeHtml(vehicle.make_model || "Model not set")}</small></div>
      <div><span class="row-label">Amoeba</span><strong>${escapeHtml(nameForAmoeba(vehicle.amoeba_id))}</strong><small>${escapeHtml(vehicle.color || "Colour not set")}</small></div>
      <div><span class="pill">${escapeHtml(vehicle.status)}</span></div>
      <div></div>
    </article>
  `).join("") : `<div class="empty">No vehicles yet.</div>`;
}

async function refresh(message = "Connected to Fleximotion Ops.") {
  setConnection("", "Connecting");
  setNotice("Loading operational data...");
  const [people, amoebas, sites, operators, vehicles, platformAccounts, alerts] = await Promise.all([
    foundation("/identity/v1/people"),
    foundation("/amoeba/v1/amoebas"),
    foundation("/amoeba/v1/sites"),
    ops("/ops/v1/operators"),
    ops("/ops/v1/vehicles"),
    ops("/ops/v1/platform-accounts"),
    ops("/ops/v1/alerts")
  ]);
  Object.assign(state, {
    people: people.data,
    amoebas: amoebas.data,
    sites: sites.data,
    operators: operators.data,
    vehicles: vehicles.data,
    platformAccounts: platformAccounts.data,
    alerts: alerts.data
  });
  render();
  setConnection("connected", "Live APIs connected");
  setNotice(message);
}

el.operatorForm.elements.amoeba_id.addEventListener("change", updateSiteOptions);
el.alertFilter.addEventListener("change", render);
document.getElementById("refreshButton").addEventListener("click", () => refresh().catch(showError));

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

let pendingAction = null;
document.addEventListener("click", async (event) => {
  const alertButton = event.target.closest("[data-alert-action]");
  const saveOperator = event.target.closest("[data-save-operator]");
  const registerOperator = event.target.closest("[data-register-operator]");

  if (alertButton) {
    const alert = state.alerts.find((item) => item.alert_id === alertButton.dataset.alertId);
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
refresh().catch(showError);
