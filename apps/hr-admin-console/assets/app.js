const KNOWN_ROLES = ["owner", "admin", "manager", "finance", "supervisor", "operator"];

const state = {
  people: [], users: [], roleAssignments: [], amoebas: [], sites: [], serviceAccounts: []
};
// Which row (by id) is currently in edit mode, per section.
const editing = { people: null, users: null, access: null, amoebas: null, sites: null };
// Staged, unsaved edits for the row being edited (roles for users).
let roleDraft = null;
// Search + status filters per section.
const filters = {
  people: { q: "", status: "" }, users: { q: "", status: "" }, access: { q: "", status: "" },
  amoebas: { q: "", status: "" }, sites: { q: "", status: "" }
};

const els = Object.fromEntries([
  "apiBase", "apiToken", "notice", "connDot", "connText",
  "peopleCount", "usersCount", "roleAssignmentsCount", "amoebasCount", "sitesCount", "serviceAccountsCount",
  "peopleRows", "userRows", "roleAssignmentRows", "amoebaRows", "siteRows", "serviceAccountRows",
  "personForm", "userForm", "roleAssignmentForm", "amoebaForm", "siteForm", "serviceAccountForm",
  "confirmDialog", "confirmTitle", "confirmBody", "confirmButton"
].map((id) => [id, document.querySelector(`#${id}`)]));

const params = new URLSearchParams(window.location.search);
els.apiBase.value = params.get("apiBase") || window.flexiServiceBase("foundation", 4010);
els.apiToken.value = window.flexiServiceToken();

const apiBase = () => els.apiBase.value.replace(/\/$/, "");
const token = () => els.apiToken.value;
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const idempotencyKey = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cleanOptional = (value) => (value === "" ? null : value);

function setNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle("error", isError);
}
function setConnection(ok, text) {
  els.connDot.classList.toggle("ok", ok === true);
  els.connDot.classList.toggle("bad", ok === false);
  els.connText.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || body.message || `Request failed: ${response.status}`);
  return body;
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());

/* ---------- lookups ---------- */
const personName = (id) => state.people.find((p) => p.person_id === id)?.display_name || id || "";
const amoebaName = (id) => state.amoebas.find((a) => a.amoeba_id === id)?.name || id || "";
const siteName = (id) => state.sites.find((s) => s.site_id === id)?.name || id || "";
function scopeName(a) {
  if (a.scope_type === "company") return "Whole company";
  if (a.scope_type === "amoeba") return amoebaName(a.scope_id);
  if (a.scope_type === "site") return siteName(a.scope_id);
  if (a.scope_type === "team") return `${personName(a.scope_id)}'s team`;
  return a.scope_id || "";
}
const dateTimeInput = (v) => (v ? new Date(v).toISOString().slice(0, 16) : "");
const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function statusPill(status) {
  const tone = { active: "ok", inactive: "muted", suspended: "bad", archived: "muted" }[status] || "muted";
  return `<span class="pill ${tone}">${escapeHtml(status)}</span>`;
}
function idChip(id) {
  return `<button type="button" class="id-chip" data-copy-id="${escapeHtml(id)}" title="Copy ${escapeHtml(id)}">⧉ ID</button>`;
}
function statusOptions(kind, current) {
  const values = { person: ["active", "inactive", "suspended"], user: ["active", "inactive", "suspended"], amoeba: ["active", "archived"], site: ["active", "inactive"] }[kind];
  return values.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${v}</option>`).join("");
}
function optionList(items, getValue, getLabel, selected = "", emptyLabel = "") {
  const empty = emptyLabel ? `<option value="">${emptyLabel}</option>` : "";
  return empty + items.map((item) => {
    const value = getValue(item);
    return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(getLabel(item))}</option>`;
  }).join("");
}

/* ---------- create-form option population ---------- */
function renderOptions() {
  const people = optionList(state.people, (p) => p.person_id, (p) => p.display_name);
  const coordinator = optionList(state.people, (p) => p.person_id, (p) => p.display_name, "", "Unassigned");
  els.userForm.elements.person_id.innerHTML = people;
  els.roleAssignmentForm.elements.person_id.innerHTML = people;
  els.amoebaForm.elements.coordinator_person_id.innerHTML = coordinator;
  els.siteForm.elements.amoeba_id.innerHTML = optionList(state.amoebas, (a) => a.amoeba_id, (a) => a.name);
  renderAssignmentScopeOptions();
}
function renderAssignmentScopeOptions() {
  const type = els.roleAssignmentForm.elements.scope_type.value;
  const control = els.roleAssignmentForm.elements.scope_id;
  if (type === "company") { control.innerHTML = '<option value="">Whole company</option>'; control.disabled = true; control.required = false; return; }
  control.disabled = false; control.required = true;
  if (type === "amoeba") control.innerHTML = optionList(state.amoebas, (i) => i.amoeba_id, (i) => i.name);
  else if (type === "site") control.innerHTML = optionList(state.sites, (i) => i.site_id, (i) => `${i.name} (${amoebaName(i.amoeba_id)})`);
  else control.innerHTML = optionList(state.people, (i) => i.person_id, (i) => `${i.display_name}'s team`);
}

/* ---------- filtering ---------- */
function applyFilter(section, rows, textOf) {
  const { q, status } = filters[section];
  const needle = q.trim().toLowerCase();
  return rows.filter((row) => {
    if (status && row.__status !== status) return false;
    if (needle && !textOf(row).toLowerCase().includes(needle)) return false;
    return true;
  });
}
function setCount(section, shown, total) {
  const el = document.querySelector(`[data-count="${section}"]`);
  if (el) el.textContent = shown === total ? `${total}` : `${shown} of ${total}`;
}

/* ---------- row renderers (view vs edit) ---------- */
function actionsCell(section, id, status, { archive = false } = {}) {
  const isEditing = editing[section] === id;
  if (isEditing) {
    return `<td class="actions"><button type="button" class="primary" data-save="${section}" data-id="${escapeHtml(id)}">Save</button>
      <button type="button" class="ghost" data-cancel="${section}">Cancel</button></td>`;
  }
  const dead = status === "inactive" || status === "suspended" || status === "archived";
  const verb = archive ? (dead ? "Restore" : "Archive") : (dead ? "Reactivate" : "Deactivate");
  const danger = dead ? "" : "danger-text";
  return `<td class="actions"><button type="button" class="ghost" data-edit="${section}" data-id="${escapeHtml(id)}">Edit</button>
    <button type="button" class="linklike ${danger}" data-lifecycle="${section}" data-id="${escapeHtml(id)}" data-next="${dead ? "active" : (archive ? "archived" : "inactive")}">${verb}</button>
    ${idChip(id)}</td>`;
}

function renderPeople() {
  const rows = state.people.map((p) => ({ ...p, __status: p.global_status }));
  const shown = applyFilter("people", rows, (p) => `${p.display_name} ${p.phone || ""} ${p.email || ""}`);
  setCount("people", shown.length, rows.length);
  els.peopleRows.innerHTML = shown.length ? shown.map((p) => {
    const id = p.person_id;
    if (editing.people === id) {
      return `<tr data-row="people:${escapeHtml(id)}">
        <td><input data-field="display_name" value="${escapeHtml(p.display_name)}" /></td>
        <td><input data-field="phone" value="${escapeHtml(p.phone || "")}" /></td>
        <td><input data-field="email" type="email" value="${escapeHtml(p.email || "")}" /></td>
        <td><input data-field="nin" maxlength="11" inputmode="numeric" value="${escapeHtml(p.nin || "")}" placeholder="Not set" /></td>
        <td><select data-field="status">${statusOptions("person", p.global_status)}</select></td>
        ${actionsCell("people", id, p.global_status)}</tr>`;
    }
    return `<tr data-row="people:${escapeHtml(id)}">
      <td><strong>${escapeHtml(p.display_name)}</strong>${p.legal_name && p.legal_name !== p.display_name ? `<small>${escapeHtml(p.legal_name)}</small>` : ""}</td>
      <td>${escapeHtml(p.phone || "—")}</td>
      <td>${escapeHtml(p.email || "—")}</td>
      <td>${escapeHtml(p.nin || "—")}</td>
      <td>${statusPill(p.global_status)}</td>
      ${actionsCell("people", id, p.global_status)}</tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">No people match this view.</td></tr>`;
}

function renderUsers() {
  const rows = state.users.map((u) => ({ ...u, __status: u.status }));
  const shown = applyFilter("users", rows, (u) => `${personName(u.person_id)} ${(u.roles || []).join(" ")}`);
  setCount("users", shown.length, rows.length);
  els.userRows.innerHTML = shown.length ? shown.map((u) => {
    const id = u.user_id;
    if (editing.users === id) {
      const roles = roleDraft || u.roles || [];
      const remaining = KNOWN_ROLES.filter((r) => !roles.includes(r));
      return `<tr data-row="users:${escapeHtml(id)}">
        <td><strong>${escapeHtml(personName(u.person_id))}</strong>${idChip(id)}</td>
        <td><div class="role-chip-list">
          ${roles.map((r) => `<span class="role-chip">${escapeHtml(r)}<button type="button" data-remove-role="${escapeHtml(r)}" aria-label="Remove ${escapeHtml(r)}">×</button></span>`).join("") || '<span class="role-chip empty-chip">no roles</span>'}
          </div>${remaining.length ? `<div class="role-add-row"><select data-role-pick>${remaining.map((r) => `<option value="${r}">${r}</option>`).join("")}</select><button type="button" class="ghost" data-add-role>Add</button></div>` : ""}</td>
        <td><select data-field="status">${statusOptions("user", u.status)}</select></td>
        ${actionsCell("users", id, u.status)}</tr>`;
    }
    return `<tr data-row="users:${escapeHtml(id)}">
      <td><strong>${escapeHtml(personName(u.person_id))}</strong></td>
      <td>${(u.roles || []).map((r) => `<span class="role-chip static">${escapeHtml(r)}</span>`).join(" ") || "<small>no roles</small>"}</td>
      <td>${statusPill(u.status)}</td>
      ${actionsCell("users", id, u.status)}</tr>`;
  }).join("") : `<tr><td colspan="4" class="empty">No users match this view.</td></tr>`;
}

function renderAccess() {
  const rows = state.roleAssignments.map((a) => ({ ...a, __status: a.status }));
  const shown = applyFilter("access", rows, (a) => `${a.display_name || personName(a.person_id)} ${a.role} ${scopeName(a)}`);
  setCount("access", shown.length, rows.length);
  els.roleAssignmentRows.innerHTML = shown.length ? shown.map((a) => {
    const id = a.role_assignment_id;
    if (editing.access === id) {
      return `<tr data-row="access:${escapeHtml(id)}">
        <td>${escapeHtml(a.display_name || personName(a.person_id))}</td>
        <td>${escapeHtml(a.role)}</td>
        <td>${escapeHtml(scopeName(a))}</td>
        <td>${fmtDate(a.valid_from)}</td>
        <td><input data-field="valid_to" type="datetime-local" value="${escapeHtml(dateTimeInput(a.valid_to))}" /></td>
        <td><select data-field="status"><option value="active" ${a.status === "active" ? "selected" : ""}>active</option><option value="inactive" ${a.status === "inactive" ? "selected" : ""}>inactive</option></select></td>
        ${actionsCell("access", id, a.status)}</tr>`;
    }
    return `<tr data-row="access:${escapeHtml(id)}">
      <td><strong>${escapeHtml(a.display_name || personName(a.person_id))}</strong></td>
      <td>${escapeHtml(a.role)}</td>
      <td>${escapeHtml(scopeName(a))}</td>
      <td>${fmtDate(a.valid_from)}</td>
      <td>${a.valid_to ? fmtDate(a.valid_to) : "—"}</td>
      <td>${statusPill(a.status)}</td>
      ${actionsCell("access", id, a.status)}</tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No access grants match this view.</td></tr>`;
}

function renderAmoebas() {
  const rows = state.amoebas.map((a) => ({ ...a, __status: a.status }));
  const shown = applyFilter("amoebas", rows, (a) => `${a.name} ${a.classification}`);
  setCount("amoebas", shown.length, rows.length);
  els.amoebaRows.innerHTML = shown.length ? shown.map((a) => {
    const id = a.amoeba_id;
    if (editing.amoebas === id) {
      return `<tr data-row="amoebas:${escapeHtml(id)}">
        <td><input data-field="name" value="${escapeHtml(a.name)}" /></td>
        <td><select data-field="classification">${["operating", "shared_services", "investment"].map((v) => `<option value="${v}" ${v === a.classification ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td><select data-field="coordinator_person_id">${optionList(state.people, (p) => p.person_id, (p) => p.display_name, a.coordinator_person_id || "", "Unassigned")}</select></td>
        <td><select data-field="status">${statusOptions("amoeba", a.status)}</select></td>
        ${actionsCell("amoebas", id, a.status, { archive: true })}</tr>`;
    }
    return `<tr data-row="amoebas:${escapeHtml(id)}">
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(String(a.classification).replaceAll("_", " "))}</td>
      <td>${escapeHtml(a.coordinator_person_id ? personName(a.coordinator_person_id) : "Unassigned")}</td>
      <td>${statusPill(a.status)}</td>
      ${actionsCell("amoebas", id, a.status, { archive: true })}</tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">No amoebas match this view.</td></tr>`;
}

function renderSites() {
  const rows = state.sites.map((s) => ({ ...s, __status: s.status }));
  const shown = applyFilter("sites", rows, (s) => `${s.name} ${amoebaName(s.amoeba_id)}`);
  setCount("sites", shown.length, rows.length);
  els.siteRows.innerHTML = shown.length ? shown.map((s) => {
    const id = s.site_id;
    if (editing.sites === id) {
      return `<tr data-row="sites:${escapeHtml(id)}">
        <td><input data-field="name" value="${escapeHtml(s.name)}" /></td>
        <td><select data-field="amoeba_id">${optionList(state.amoebas, (a) => a.amoeba_id, (a) => a.name, s.amoeba_id)}</select></td>
        <td class="gps-edit"><input data-field="gps_lat" type="number" step="0.000001" value="${escapeHtml(s.gps_lat ?? "")}" placeholder="lat" /><input data-field="gps_lng" type="number" step="0.000001" value="${escapeHtml(s.gps_lng ?? "")}" placeholder="lng" /></td>
        <td><input data-field="alert_radius_m" type="number" min="1" value="${escapeHtml(s.alert_radius_m)}" /></td>
        <td><input data-field="is_primary" type="checkbox" ${s.is_primary ? "checked" : ""} /></td>
        <td><select data-field="status">${statusOptions("site", s.status)}</select></td>
        ${actionsCell("sites", id, s.status)}</tr>`;
    }
    return `<tr data-row="sites:${escapeHtml(id)}">
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(amoebaName(s.amoeba_id))}</td>
      <td>${s.gps_lat != null && s.gps_lng != null ? `${Number(s.gps_lat).toFixed(4)}, ${Number(s.gps_lng).toFixed(4)}` : "—"}</td>
      <td>${escapeHtml(s.alert_radius_m)} m</td>
      <td>${s.is_primary ? "★" : "—"}</td>
      <td>${statusPill(s.status)}</td>
      ${actionsCell("sites", id, s.status)}</tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No sites match this view.</td></tr>`;
}

function renderServiceAccounts() {
  els.serviceAccountRows.innerHTML = state.serviceAccounts.length ? state.serviceAccounts.map((account) => `
    <tr>
      <td><strong>${escapeHtml(account.name)}</strong></td>
      <td><small>${escapeHtml((account.scopes || []).join(", "))}</small></td>
      <td>${statusPill(account.status)}</td>
      <td class="actions"><button type="button" class="ghost" data-issue-token="${escapeHtml(account.service_account_id)}">Issue token</button>
        <div class="token-output" data-token-output="${escapeHtml(account.service_account_id)}"></div></td>
    </tr>`).join("") : `<tr><td colspan="4" class="empty">No service accounts yet.</td></tr>`;
}

function render() {
  els.peopleCount.textContent = state.people.length;
  els.usersCount.textContent = state.users.length;
  els.roleAssignmentsCount.textContent = state.roleAssignments.filter((a) => a.status === "active").length;
  els.amoebasCount.textContent = state.amoebas.length;
  els.sitesCount.textContent = state.sites.length;
  els.serviceAccountsCount.textContent = state.serviceAccounts.length;
  renderOptions();
  renderPeople();
  renderUsers();
  renderAccess();
  renderAmoebas();
  renderSites();
  renderServiceAccounts();
}

async function refresh() {
  setConnection(null, "Connecting…");
  setNotice("Loading…");
  try {
    const [people, users, roleAssignments, amoebas, sites, serviceAccounts] = await Promise.all([
      api("/identity/v1/people"), api("/identity/v1/users"), api("/identity/v1/role-assignments"),
      api("/amoeba/v1/amoebas"), api("/amoeba/v1/sites"), api("/identity/v1/service-accounts")
    ]);
    state.people = people.data; state.users = users.data; state.roleAssignments = roleAssignments.data;
    state.amoebas = amoebas.data; state.sites = sites.data; state.serviceAccounts = serviceAccounts.data;
    render();
    setConnection(true, "Connected");
    setNotice("Connected to Identity / Organisation API.");
  } catch (error) {
    setConnection(false, "Connection issue");
    setNotice(error.message, true);
  }
}

/* ---------- create forms ---------- */
function bindCreate(form, path, prefix, transform, label) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const body = transform(formData(form), form);
      await api(path, { method: "POST", headers: { "Idempotency-Key": idempotencyKey(prefix) }, body: JSON.stringify(body) });
      form.reset();
      const panel = form.closest(".create"); if (panel) panel.open = false;
      await refresh();
      setNotice(`${label} created.`);
    } catch (error) { setNotice(error.message, true); }
    finally { button.disabled = false; }
  });
}
bindCreate(els.personForm, "/identity/v1/people", "person", (b) => b, "Person");
bindCreate(els.userForm, "/identity/v1/users", "user", (b, form) => {
  b.roles = [...form.querySelectorAll('input[name="roles"]:checked')].map((box) => box.value);
  if (!b.roles.length) throw new Error("Select at least one system role.");
  return b;
}, "User");
bindCreate(els.roleAssignmentForm, "/identity/v1/role-assignments", "role-assignment", (b) => {
  if (b.scope_type === "company") b.scope_id = null;
  if (b.valid_from) b.valid_from = new Date(b.valid_from).toISOString(); else delete b.valid_from;
  if (b.valid_to) b.valid_to = new Date(b.valid_to).toISOString(); else delete b.valid_to;
  return b;
}, "Access grant");
bindCreate(els.amoebaForm, "/amoeba/v1/amoebas", "amoeba", (b) => { if (!b.coordinator_person_id) delete b.coordinator_person_id; return b; }, "Amoeba");
bindCreate(els.siteForm, "/amoeba/v1/sites", "site", (b, form) => {
  b.is_primary = form.elements.is_primary.checked;
  b.gps_lat = cleanOptional(b.gps_lat); b.gps_lng = cleanOptional(b.gps_lng); b.alert_radius_m = Number(b.alert_radius_m);
  return b;
}, "Site");
bindCreate(els.serviceAccountForm, "/identity/v1/service-accounts", "service-account", (b) => {
  b.scopes = b.scopes.split(",").map((s) => s.trim()).filter(Boolean); return b;
}, "Service account");
els.roleAssignmentForm.elements.scope_type.addEventListener("change", renderAssignmentScopeOptions);

/* ---------- toolbars ---------- */
document.querySelectorAll("[data-search]").forEach((input) => {
  input.addEventListener("input", () => { filters[input.dataset.search].q = input.value; renderSection(input.dataset.search); });
});
document.querySelectorAll("[data-status-filter]").forEach((select) => {
  select.addEventListener("change", () => { filters[select.dataset.statusFilter].status = select.value; renderSection(select.dataset.statusFilter); });
});
function renderSection(section) {
  ({ people: renderPeople, users: renderUsers, access: renderAccess, amoebas: renderAmoebas, sites: renderSites })[section]?.();
}

/* ---------- row edit / save / lifecycle ---------- */
function rowBody(row, fields) {
  const body = {};
  for (const field of fields) {
    const control = row.querySelector(`[data-field="${field}"]`);
    if (!control) continue;
    body[field] = control.type === "checkbox" ? control.checked : control.value;
  }
  return body;
}

const SAVE = {
  people: async (id, row) => {
    const b = rowBody(row, ["display_name", "phone", "email", "nin", "status"]);
    b.global_status = b.status; delete b.status;
    b.phone = cleanOptional(b.phone); b.email = cleanOptional(b.email); b.nin = cleanOptional(b.nin);
    await api(`/identity/v1/people/${id}`, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey("person-update") }, body: JSON.stringify(b) });
    return "Person updated.";
  },
  users: async (id, row) => {
    const b = rowBody(row, ["status"]);
    b.roles = roleDraft || state.users.find((u) => u.user_id === id)?.roles || [];
    if (!b.roles.length) throw new Error("A user needs at least one role.");
    await api(`/identity/v1/users/${id}`, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey("user-update") }, body: JSON.stringify(b) });
    return "User updated.";
  },
  access: async (id, row) => {
    const b = rowBody(row, ["valid_to", "status"]);
    b.valid_to = b.valid_to ? new Date(b.valid_to).toISOString() : null;
    await api(`/identity/v1/role-assignments/${id}`, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey("ra-update") }, body: JSON.stringify(b) });
    return "Access grant updated.";
  },
  amoebas: async (id, row) => {
    const b = rowBody(row, ["name", "classification", "coordinator_person_id", "status"]);
    b.coordinator_person_id = cleanOptional(b.coordinator_person_id);
    await api(`/amoeba/v1/amoebas/${id}`, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey("amoeba-update") }, body: JSON.stringify(b) });
    return "Amoeba updated.";
  },
  sites: async (id, row) => {
    const b = rowBody(row, ["name", "amoeba_id", "gps_lat", "gps_lng", "alert_radius_m", "is_primary", "status"]);
    b.gps_lat = cleanOptional(b.gps_lat); b.gps_lng = cleanOptional(b.gps_lng); b.alert_radius_m = Number(b.alert_radius_m);
    await api(`/amoeba/v1/sites/${id}`, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey("site-update") }, body: JSON.stringify(b) });
    return "Site updated.";
  }
};

// Lifecycle (deactivate / archive / reactivate) via the status endpoints.
const LIFECYCLE = {
  people: (id, next) => ({ path: `/identity/v1/people/${id}`, body: { global_status: next }, prefix: "person-life" }),
  users: (id, next) => ({ path: `/identity/v1/users/${id}`, body: { status: next, roles: state.users.find((u) => u.user_id === id)?.roles || [] }, prefix: "user-life" }),
  access: (id, next) => ({ path: `/identity/v1/role-assignments/${id}`, body: { status: next }, prefix: "ra-life" }),
  amoebas: (id, next) => ({ path: `/amoeba/v1/amoebas/${id}`, body: { status: next }, prefix: "amoeba-life" }),
  sites: (id, next) => ({ path: `/amoeba/v1/sites/${id}`, body: { status: next }, prefix: "site-life" })
};
const LABEL = { people: personName, users: (id) => personName(state.users.find((u) => u.user_id === id)?.person_id), access: (id) => (state.roleAssignments.find((a) => a.role_assignment_id === id)?.role || "grant"), amoebas: amoebaName, sites: siteName };

let pendingLifecycle = null;
function askConfirm(title, body, confirmLabel, onConfirm) {
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmButton.textContent = confirmLabel;
  pendingLifecycle = onConfirm;
  els.confirmDialog.showModal();
}
els.confirmDialog.addEventListener("close", async () => {
  if (els.confirmDialog.returnValue === "default" && pendingLifecycle) { const fn = pendingLifecycle; pendingLifecycle = null; await fn(); }
  pendingLifecycle = null;
});

document.addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy-id]");
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copyId).then(() => setNotice(`Copied ${copy.dataset.copyId}`)).catch(() => {}); return; }

  const edit = event.target.closest("[data-edit]");
  if (edit) { editing[edit.dataset.edit] = edit.dataset.id; roleDraft = null; if (edit.dataset.edit === "users") roleDraft = [...(state.users.find((u) => u.user_id === edit.dataset.id)?.roles || [])]; renderSection(edit.dataset.edit); return; }

  const cancel = event.target.closest("[data-cancel]");
  if (cancel) { editing[cancel.dataset.cancel] = null; roleDraft = null; renderSection(cancel.dataset.cancel); return; }

  const addRole = event.target.closest("[data-add-role]");
  if (addRole) { const pick = addRole.closest(".role-chip-list, td").querySelector("[data-role-pick]"); if (pick?.value && roleDraft && !roleDraft.includes(pick.value)) { roleDraft.push(pick.value); renderSection("users"); } return; }
  const removeRole = event.target.closest("[data-remove-role]");
  if (removeRole) { roleDraft = (roleDraft || []).filter((r) => r !== removeRole.dataset.removeRole); renderSection("users"); return; }

  const save = event.target.closest("[data-save]");
  if (save) {
    const section = save.dataset.save; const id = save.dataset.id;
    const row = document.querySelector(`[data-row="${section}:${CSS.escape(id)}"]`);
    save.disabled = true;
    try { const msg = await SAVE[section](id, row); editing[section] = null; roleDraft = null; await refresh(); setNotice(msg); }
    catch (error) { save.disabled = false; setNotice(error.message, true); }
    return;
  }

  const life = event.target.closest("[data-lifecycle]");
  if (life) {
    const section = life.dataset.lifecycle; const id = life.dataset.id; const next = life.dataset.next;
    const name = LABEL[section](id) || id;
    const reactivating = next === "active";
    const verb = reactivating ? "Reactivate" : (section === "amoebas" ? "Archive" : "Deactivate");
    const consequence = reactivating ? "They regain access." : (section === "access" ? "This grant stops applying immediately." : "Access is removed, but the record and its history are kept.");
    askConfirm(`${verb} ${name}?`, `${consequence} You can change this again at any time.`, verb, async () => {
      try {
        const spec = LIFECYCLE[section](id, next);
        await api(spec.path, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey(spec.prefix) }, body: JSON.stringify(spec.body) });
        await refresh();
        setNotice(`${name} ${reactivating ? "reactivated" : (section === "amoebas" ? "archived" : "deactivated")}.`);
      } catch (error) { setNotice(error.message, true); }
    });
    return;
  }

  const issue = event.target.closest("[data-issue-token]");
  if (issue) {
    try {
      const issued = await api(`/identity/v1/service-accounts/${issue.dataset.issueToken}/tokens`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey("service-token") }, body: JSON.stringify({}) });
      document.querySelector(`[data-token-output="${issue.dataset.issueToken}"]`).textContent = issued.token;
      setNotice("Token issued. Copy it now; the API stores only a hash.");
    } catch (error) { setNotice(error.message, true); }
  }
});

if (window.AdminKit) {
  AdminKit.mountViews({ defaultView: "people" });
  AdminKit.wireNavSearch(document.getElementById("navSearch"));
}
document.querySelector("#refreshButton").addEventListener("click", () => refresh());
refresh();
