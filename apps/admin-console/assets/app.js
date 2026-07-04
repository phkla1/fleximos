const state = {
  people: [],
  users: [],
  roleAssignments: [],
  amoebas: [],
  sites: [],
  serviceAccounts: []
};

const els = {
  apiBase: document.querySelector("#apiBase"),
  apiToken: document.querySelector("#apiToken"),
  notice: document.querySelector("#notice"),
  peopleCount: document.querySelector("#peopleCount"),
  usersCount: document.querySelector("#usersCount"),
  roleAssignmentsCount: document.querySelector("#roleAssignmentsCount"),
  amoebasCount: document.querySelector("#amoebasCount"),
  sitesCount: document.querySelector("#sitesCount"),
  serviceAccountsCount: document.querySelector("#serviceAccountsCount"),
  peopleRows: document.querySelector("#peopleRows"),
  userRows: document.querySelector("#userRows"),
  roleAssignmentRows: document.querySelector("#roleAssignmentRows"),
  amoebaRows: document.querySelector("#amoebaRows"),
  siteRows: document.querySelector("#siteRows"),
  serviceAccountRows: document.querySelector("#serviceAccountRows"),
  personForm: document.querySelector("#personForm"),
  userForm: document.querySelector("#userForm"),
  roleAssignmentForm: document.querySelector("#roleAssignmentForm"),
  amoebaForm: document.querySelector("#amoebaForm"),
  siteForm: document.querySelector("#siteForm"),
  serviceAccountForm: document.querySelector("#serviceAccountForm")
};

const params = new URLSearchParams(window.location.search);
if (params.get("apiBase")) els.apiBase.value = params.get("apiBase");
if (params.get("token")) els.apiToken.value = params.get("token");

function apiBase() {
  return els.apiBase.value.replace(/\/$/, "");
}

function token() {
  return els.apiToken.value;
}

function setNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle("error", isError);
}

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Request failed: ${response.status}`);
  return body;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function personName(personId) {
  return state.people.find((person) => person.person_id === personId)?.display_name || personId || "";
}

function amoebaName(amoebaId) {
  return state.amoebas.find((amoeba) => amoeba.amoeba_id === amoebaId)?.name || amoebaId || "";
}

function siteName(siteId) {
  return state.sites.find((site) => site.site_id === siteId)?.name || siteId || "";
}

function scopeName(assignment) {
  if (assignment.scope_type === "company") return "Whole company";
  if (assignment.scope_type === "amoeba") return amoebaName(assignment.scope_id);
  if (assignment.scope_type === "site") return siteName(assignment.scope_id);
  if (assignment.scope_type === "team") return `${personName(assignment.scope_id)}'s team`;
  return assignment.scope_id || "";
}

function dateTimeInput(value) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

function optionList(items, getValue, getLabel, selectedValue = "", emptyLabel = "") {
  const empty = emptyLabel ? `<option value="">${emptyLabel}</option>` : "";
  return `${empty}${items
    .map((item) => {
      const value = getValue(item);
      const selected = value === selectedValue ? "selected" : "";
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(getLabel(item))}</option>`;
    })
    .join("")}`;
}

function renderOptions() {
  const peopleOptions = optionList(state.people, (person) => person.person_id, (person) => person.display_name);
  const coordinatorOptions = optionList(state.people, (person) => person.person_id, (person) => person.display_name, "", "Unassigned");
  const amoebaOptions = optionList(state.amoebas, (amoeba) => amoeba.amoeba_id, (amoeba) => amoeba.name);
  els.userForm.elements.person_id.innerHTML = peopleOptions;
  els.roleAssignmentForm.elements.person_id.innerHTML = peopleOptions;
  els.amoebaForm.elements.coordinator_person_id.innerHTML = coordinatorOptions;
  els.siteForm.elements.amoeba_id.innerHTML = amoebaOptions;
  renderAssignmentScopeOptions();
}

function renderAssignmentScopeOptions() {
  const scopeType = els.roleAssignmentForm.elements.scope_type.value;
  const scopeControl = els.roleAssignmentForm.elements.scope_id;
  if (scopeType === "company") {
    scopeControl.innerHTML = '<option value="">Whole company</option>';
    scopeControl.disabled = true;
    scopeControl.required = false;
    return;
  }
  scopeControl.disabled = false;
  scopeControl.required = true;
  if (scopeType === "amoeba") {
    scopeControl.innerHTML = optionList(state.amoebas, (item) => item.amoeba_id, (item) => item.name);
  } else if (scopeType === "site") {
    scopeControl.innerHTML = optionList(state.sites, (item) => item.site_id, (item) => `${item.name} (${amoebaName(item.amoeba_id)})`);
  } else {
    scopeControl.innerHTML = optionList(state.people, (item) => item.person_id, (item) => `${item.display_name}'s team`);
  }
}

function statusSelect(kind, current) {
  const values = {
    person: ["active", "inactive", "suspended"],
    user: ["active", "inactive", "suspended"],
    amoeba: ["active", "archived"],
    site: ["active", "inactive"]
  }[kind];
  return `<select class="row-edit" data-field="status">${values
    .map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${value}</option>`)
    .join("")}</select>`;
}

function render() {
  els.peopleCount.textContent = state.people.length;
  els.usersCount.textContent = state.users.length;
  els.roleAssignmentsCount.textContent = state.roleAssignments.filter((assignment) => assignment.status === "active").length;
  els.amoebasCount.textContent = state.amoebas.length;
  els.sitesCount.textContent = state.sites.length;
  els.serviceAccountsCount.textContent = state.serviceAccounts.length;

  renderOptions();

  els.peopleRows.innerHTML = state.people
    .map(
      (person) => `
      <tr data-person-row="${escapeHtml(person.person_id)}">
        <td><input class="row-edit" data-field="display_name" value="${escapeHtml(person.display_name)}" /></td>
        <td><input class="row-edit" data-field="phone" value="${escapeHtml(person.phone || "")}" /></td>
        <td><input class="row-edit" data-field="email" type="email" value="${escapeHtml(person.email || "")}" /></td>
        <td>${statusSelect("person", person.global_status)}</td>
        <td><button type="button" data-save-person="${escapeHtml(person.person_id)}">Save</button></td>
        <td class="id-cell">${escapeHtml(person.person_id)}</td>
      </tr>
    `
    )
    .join("");

  els.userRows.innerHTML = state.users
    .map(
      (user) => `
      <tr data-user-row="${escapeHtml(user.user_id)}">
        <td class="id-cell">${escapeHtml(user.user_id)}</td>
        <td>${escapeHtml(personName(user.person_id))}</td>
        <td><input class="row-edit" data-field="roles" value="${escapeHtml((user.roles || []).join(", "))}" /></td>
        <td>${statusSelect("user", user.status)}</td>
        <td><button type="button" data-save-user="${escapeHtml(user.user_id)}">Save</button></td>
      </tr>
    `
    )
    .join("");

  els.roleAssignmentRows.innerHTML = state.roleAssignments
    .map(
      (assignment) => `
      <tr data-role-assignment-row="${escapeHtml(assignment.role_assignment_id)}">
        <td>${escapeHtml(assignment.display_name || personName(assignment.person_id))}</td>
        <td>${escapeHtml(assignment.role)}</td>
        <td>${escapeHtml(scopeName(assignment))}</td>
        <td>${escapeHtml(new Date(assignment.valid_from).toLocaleString())}</td>
        <td><input class="row-edit" data-field="valid_to" type="datetime-local" value="${escapeHtml(dateTimeInput(assignment.valid_to))}" /></td>
        <td>
          <select class="row-edit" data-field="status">
            <option value="active" ${assignment.status === "active" ? "selected" : ""}>active</option>
            <option value="inactive" ${assignment.status === "inactive" ? "selected" : ""}>inactive</option>
          </select>
        </td>
        <td><button type="button" data-save-role-assignment="${escapeHtml(assignment.role_assignment_id)}">Save</button></td>
      </tr>
    `
    )
    .join("");

  els.amoebaRows.innerHTML = state.amoebas
    .map(
      (amoeba) => `
      <tr data-amoeba-row="${escapeHtml(amoeba.amoeba_id)}">
        <td><input class="row-edit" data-field="name" value="${escapeHtml(amoeba.name)}" /></td>
        <td>
          <select class="row-edit" data-field="classification">
            ${["operating", "shared_services", "investment"]
              .map((value) => `<option value="${value}" ${value === amoeba.classification ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </td>
        <td>
          <select class="row-edit" data-field="coordinator_person_id">
            ${optionList(state.people, (person) => person.person_id, (person) => person.display_name, amoeba.coordinator_person_id || "", "Unassigned")}
          </select>
        </td>
        <td>${statusSelect("amoeba", amoeba.status)}</td>
        <td><button type="button" data-save-amoeba="${escapeHtml(amoeba.amoeba_id)}">Save</button></td>
        <td class="id-cell">${escapeHtml(amoeba.amoeba_id)}</td>
      </tr>
    `
    )
    .join("");

  els.siteRows.innerHTML = state.sites
    .map(
      (site) => `
      <tr data-site-row="${escapeHtml(site.site_id)}">
        <td><input class="row-edit" data-field="name" value="${escapeHtml(site.name)}" /></td>
        <td>
          <select class="row-edit" data-field="amoeba_id">
            ${optionList(state.amoebas, (amoeba) => amoeba.amoeba_id, (amoeba) => amoeba.name, site.amoeba_id)}
          </select>
        </td>
        <td>
          <input class="number-edit" data-field="gps_lat" type="number" step="0.000001" value="${escapeHtml(site.gps_lat ?? "")}" />
          <input class="number-edit" data-field="gps_lng" type="number" step="0.000001" value="${escapeHtml(site.gps_lng ?? "")}" />
        </td>
        <td><input class="number-edit" data-field="alert_radius_m" type="number" min="1" value="${escapeHtml(site.alert_radius_m)}" /></td>
        <td><input class="row-checkbox" data-field="is_primary" type="checkbox" ${site.is_primary ? "checked" : ""} /></td>
        <td>${statusSelect("site", site.status)}</td>
        <td><button type="button" data-save-site="${escapeHtml(site.site_id)}">Save</button></td>
        <td class="id-cell">${escapeHtml(site.site_id)}</td>
      </tr>
    `
    )
    .join("");

  els.serviceAccountRows.innerHTML = state.serviceAccounts
    .map(
      (account) => `
      <tr>
        <td>${escapeHtml(account.name)}</td>
        <td>${escapeHtml((account.scopes || []).join(", "))}</td>
        <td>${escapeHtml(account.status)}</td>
        <td>
          <div class="inline-actions">
            <button type="button" data-issue-token="${escapeHtml(account.service_account_id)}">Issue token</button>
          </div>
          <div class="token-output" data-token-output="${escapeHtml(account.service_account_id)}"></div>
        </td>
      </tr>
    `
    )
    .join("");
}

async function refresh() {
  setNotice("Loading...");
  const [people, users, roleAssignments, amoebas, sites, serviceAccounts] = await Promise.all([
    api("/identity/v1/people"),
    api("/identity/v1/users"),
    api("/identity/v1/role-assignments"),
    api("/amoeba/v1/amoebas"),
    api("/amoeba/v1/sites"),
    api("/identity/v1/service-accounts")
  ]);
  state.people = people.data;
  state.users = users.data;
  state.roleAssignments = roleAssignments.data;
  state.amoebas = amoebas.data;
  state.sites = sites.data;
  state.serviceAccounts = serviceAccounts.data;
  render();
  setNotice("Connected to Identity/Amoeba API.");
}

function cleanOptional(value) {
  return value === "" ? null : value;
}

els.personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.personForm);
  try {
    await api("/identity/v1/people", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("person") },
      body: JSON.stringify(body)
    });
    els.personForm.reset();
    await refresh();
    setNotice("Person created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

els.userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.userForm);
  body.roles = body.roles.split(",").map((role) => role.trim()).filter(Boolean);
  try {
    await api("/identity/v1/users", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("user") },
      body: JSON.stringify(body)
    });
    els.userForm.reset();
    await refresh();
    setNotice("User created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

els.roleAssignmentForm.elements.scope_type.addEventListener("change", renderAssignmentScopeOptions);

els.roleAssignmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.roleAssignmentForm);
  if (body.scope_type === "company") body.scope_id = null;
  if (body.valid_from) body.valid_from = new Date(body.valid_from).toISOString();
  else delete body.valid_from;
  if (body.valid_to) body.valid_to = new Date(body.valid_to).toISOString();
  else delete body.valid_to;
  try {
    await api("/identity/v1/role-assignments", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("role-assignment") },
      body: JSON.stringify(body)
    });
    els.roleAssignmentForm.reset();
    renderAssignmentScopeOptions();
    await refresh();
    setNotice("Access assignment created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

els.amoebaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.amoebaForm);
  if (!body.coordinator_person_id) delete body.coordinator_person_id;
  try {
    await api("/amoeba/v1/amoebas", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("amoeba") },
      body: JSON.stringify(body)
    });
    els.amoebaForm.reset();
    await refresh();
    setNotice("Amoeba created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

els.siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.siteForm);
  body.is_primary = els.siteForm.elements.is_primary.checked;
  body.gps_lat = cleanOptional(body.gps_lat);
  body.gps_lng = cleanOptional(body.gps_lng);
  body.alert_radius_m = Number(body.alert_radius_m);
  try {
    await api("/amoeba/v1/sites", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("site") },
      body: JSON.stringify(body)
    });
    els.siteForm.reset();
    els.siteForm.elements.alert_radius_m.value = "1000";
    await refresh();
    setNotice("Site created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

els.serviceAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = formData(els.serviceAccountForm);
  body.scopes = body.scopes.split(",").map((scope) => scope.trim()).filter(Boolean);
  try {
    await api("/identity/v1/service-accounts", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("service-account") },
      body: JSON.stringify(body)
    });
    els.serviceAccountForm.reset();
    await refresh();
    setNotice("Service account created.");
  } catch (error) {
    setNotice(error.message, true);
  }
});

function rowBody(row, fields) {
  const body = {};
  for (const field of fields) {
    const control = row.querySelector(`[data-field="${field}"]`);
    if (!control) continue;
    if (control.type === "checkbox") body[field] = control.checked;
    else body[field] = control.value;
  }
  return body;
}

document.addEventListener("click", async (event) => {
  const issueButton = event.target.closest("[data-issue-token]");
  const personButton = event.target.closest("[data-save-person]");
  const userButton = event.target.closest("[data-save-user]");
  const roleAssignmentButton = event.target.closest("[data-save-role-assignment]");
  const amoebaButton = event.target.closest("[data-save-amoeba]");
  const siteButton = event.target.closest("[data-save-site]");

  try {
    if (issueButton) {
      const serviceAccountId = issueButton.dataset.issueToken;
      const issued = await api(`/identity/v1/service-accounts/${serviceAccountId}/tokens`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("service-token") },
        body: JSON.stringify({})
      });
      document.querySelector(`[data-token-output="${serviceAccountId}"]`).textContent = issued.token;
      setNotice("Token issued. Copy it now; the API stores only a hash.");
      return;
    }

    if (personButton) {
      const id = personButton.dataset.savePerson;
      const row = document.querySelector(`[data-person-row="${id}"]`);
      const body = rowBody(row, ["display_name", "phone", "email", "status"]);
      body.global_status = body.status;
      delete body.status;
      body.phone = cleanOptional(body.phone);
      body.email = cleanOptional(body.email);
      await api(`/identity/v1/people/${id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("person-update") },
        body: JSON.stringify(body)
      });
      await refresh();
      setNotice("Person updated.");
      return;
    }

    if (userButton) {
      const id = userButton.dataset.saveUser;
      const row = document.querySelector(`[data-user-row="${id}"]`);
      const body = rowBody(row, ["roles", "status"]);
      body.roles = body.roles.split(",").map((role) => role.trim()).filter(Boolean);
      await api(`/identity/v1/users/${id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("user-update") },
        body: JSON.stringify(body)
      });
      await refresh();
      setNotice("User updated.");
      return;
    }

    if (roleAssignmentButton) {
      const id = roleAssignmentButton.dataset.saveRoleAssignment;
      const row = document.querySelector(`[data-role-assignment-row="${id}"]`);
      const body = rowBody(row, ["valid_to", "status"]);
      body.valid_to = body.valid_to ? new Date(body.valid_to).toISOString() : null;
      await api(`/identity/v1/role-assignments/${id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("role-assignment-update") },
        body: JSON.stringify(body)
      });
      await refresh();
      setNotice("Access assignment updated.");
      return;
    }

    if (amoebaButton) {
      const id = amoebaButton.dataset.saveAmoeba;
      const row = document.querySelector(`[data-amoeba-row="${id}"]`);
      const body = rowBody(row, ["name", "classification", "coordinator_person_id", "status"]);
      body.coordinator_person_id = cleanOptional(body.coordinator_person_id);
      await api(`/amoeba/v1/amoebas/${id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("amoeba-update") },
        body: JSON.stringify(body)
      });
      await refresh();
      setNotice("Amoeba updated.");
      return;
    }

    if (siteButton) {
      const id = siteButton.dataset.saveSite;
      const row = document.querySelector(`[data-site-row="${id}"]`);
      const body = rowBody(row, ["name", "amoeba_id", "gps_lat", "gps_lng", "alert_radius_m", "is_primary", "status"]);
      body.gps_lat = cleanOptional(body.gps_lat);
      body.gps_lng = cleanOptional(body.gps_lng);
      body.alert_radius_m = Number(body.alert_radius_m);
      await api(`/amoeba/v1/sites/${id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey("site-update") },
        body: JSON.stringify(body)
      });
      await refresh();
      setNotice("Site updated.");
    }
  } catch (error) {
    setNotice(error.message, true);
  }
});

document.querySelector("#refreshButton").addEventListener("click", () => {
  refresh().catch((error) => setNotice(error.message, true));
});

refresh().catch((error) => setNotice(error.message, true));
