const apiFiles = {
  identity: "../../api-contracts/openapi/identity.v1.json",
  amoeba: "../../api-contracts/openapi/amoeba.v1.json",
  ops: "../../api-contracts/openapi/ops.v1.json",
  hr: "../../api-contracts/openapi/hr.v1.json",
  tms: "../../api-contracts/openapi/tms.v1.json"
};

const examples = {
  GET: {
    request: `curl -H "Authorization: Bearer $FLEXI_TOKEN" \\
  "$BASE_URL{path}"`,
    response: `{
  "data": [],
  "next_cursor": null
}`
  },
  POST: {
    request: `curl -X POST "$BASE_URL{path}" \\
  -H "Authorization: Bearer $FLEXI_TOKEN" \\
  -H "Idempotency-Key: demo-2026-06-04-001" \\
  -H "Content-Type: application/json" \\
  -d '{ "example": true }'`,
    response: `{
  "status": "accepted",
  "request_id": "req_01JZ7RQF2H9G79YJ8QQ6PAV2VG"
}`
  },
  PATCH: {
    request: `curl -X PATCH "$BASE_URL{path}" \\
  -H "Authorization: Bearer $FLEXI_TOKEN" \\
  -H "Idempotency-Key: demo-2026-06-04-002" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "active" }'`,
    response: `{
  "status": "updated",
  "request_id": "req_01JZ7RQF2H9G79YJ8QQ6PAV2VG"
}`
  }
};

const state = {
  contracts: new Map(),
  currentApi: "ops",
  currentEndpoint: null
};

const apiSelect = document.querySelector("#apiSelect");
const apiTitle = document.querySelector("#apiTitle");
const apiVersion = document.querySelector("#apiVersion");
const endpointList = document.querySelector("#endpointList");
const methodBadge = document.querySelector("#methodBadge");
const endpointTitle = document.querySelector("#endpointTitle");
const endpointDescription = document.querySelector("#endpointDescription");
const authText = document.querySelector("#authText");
const notesText = document.querySelector("#notesText");
const requestExample = document.querySelector("#requestExample");
const responseExample = document.querySelector("#responseExample");

function methodClass(method) {
  return method.toLowerCase();
}

function operationRows(contract) {
  const rows = [];
  Object.entries(contract.paths || {}).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, operation]) => {
      if (!["get", "post", "patch", "delete", "put"].includes(method)) return;
      rows.push({
        path,
        method: method.toUpperCase(),
        summary: operation.summary || path,
        description: operation.description || operation.summary || "",
        operation
      });
    });
  });
  return rows.sort((a, b) => `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`));
}

async function loadContract(key) {
  if (state.contracts.has(key)) return state.contracts.get(key);
  const response = await fetch(apiFiles[key]);
  if (!response.ok) {
    throw new Error(`Unable to load ${key} contract`);
  }
  const contract = await response.json();
  state.contracts.set(key, contract);
  return contract;
}

function renderEndpoint(row) {
  state.currentEndpoint = row;
  methodBadge.textContent = row.method;
  methodBadge.className = `method ${methodClass(row.method)}`;
  endpointTitle.textContent = row.path;
  endpointDescription.textContent = row.description || row.summary;
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(row.method);
  authText.textContent =
    row.operation.security && row.operation.security.length === 0
      ? "Public endpoint by explicit contract exception."
      : "Bearer JWT for humans or scoped service token for integrations.";
  notesText.textContent = isMutation
    ? "Mutation endpoint. Send Idempotency-Key and persist the returned request_id."
    : "Read endpoint. Use cursor pagination where supported and avoid local copies as source of truth.";
  const template = examples[row.method] || examples.GET;
  requestExample.textContent = template.request.replace("{path}", row.path);
  responseExample.textContent = template.response;

  document.querySelectorAll(".endpoint-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.endpointKey === `${row.method}:${row.path}`);
  });
}

async function renderApi(key) {
  state.currentApi = key;
  apiSelect.value = key;
  const contract = await loadContract(key);
  const rows = operationRows(contract);
  apiTitle.textContent = contract.info.title.replace("Fleximotion ", "");
  apiVersion.textContent = contract.info.version;
  endpointList.innerHTML = "";
  rows.forEach((row) => {
    const button = document.createElement("button");
    button.className = "endpoint-button";
    button.type = "button";
    button.dataset.endpointKey = `${row.method}:${row.path}`;
    button.innerHTML = `
      <span class="method ${methodClass(row.method)}">${row.method}</span>
      <strong>${row.path}</strong>
    `;
    button.addEventListener("click", () => renderEndpoint(row));
    endpointList.appendChild(button);
  });
  renderEndpoint(rows.find((row) => row.method === "POST") || rows[0]);
}

function activateNav() {
  const hash = window.location.hash || "#overview";
  document.querySelectorAll(".nav-groups a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === hash);
  });
  const apiLink = document.querySelector(`.nav-groups a[href="${hash}"][data-api]`);
  if (apiLink) {
    renderApi(apiLink.dataset.api);
    document.querySelector("#api-explorer")?.scrollIntoView({ block: "start" });
  }
}

apiSelect.addEventListener("change", (event) => {
  renderApi(event.target.value);
});

window.addEventListener("hashchange", activateNav);

renderApi("ops").then(activateNav).catch((error) => {
  endpointList.innerHTML = `<p class="load-error">${error.message}</p>`;
});
