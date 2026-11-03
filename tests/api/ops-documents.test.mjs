import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4460;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4461;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-documents-test-${Date.now()}`);
const mediaDir = path.join(tmpdir(), `fleximos-ops-documents-media-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-documents-auth-test-${Date.now()}`);
let server;
let foundationServer;

// A tiny but non-trivial PDF, so documents exercise the real content-type.
const pdfBase64 = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");

async function startServer() {
  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      FLEXI_SEED_DEMO: "true",
      PORT: String(foundationPort),
      HOST: "127.0.0.1",
      FLEXI_DB_DIR: foundationDbDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  foundationServer.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let foundationOutput = "";
  while (!foundationOutput.includes("Foundation API:")) {
    const [chunk] = await once(foundationServer.stdout, "data");
    foundationOutput += String(chunk);
  }

  server = spawn("npx", ["tsx", "apps/ops-api/src/main.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      FLEXI_SEED_DEMO: "true",
      PORT: String(port),
      HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir,
      FLEXI_OPS_MEDIA_DIR: mediaDir,
      FOUNDATION_API_BASE: foundationBaseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let output = "";
  while (!output.includes("Ops API:")) {
    const [chunk] = await once(server.stdout, "data");
    output += String(chunk);
  }
}

function as(bearer) {
  return async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}

const admin = as(token);
const adminPost = (url, key, payload) =>
  admin(url, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(payload) });

// Create a person + operator-role login in foundation and return its access token.
async function operatorLogin(phone, suffix) {
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `doc-person-${suffix}` },
    body: JSON.stringify({ display_name: `Doc ${suffix}`, phone })
  }).then((r) => r.json());
  const user = await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `doc-user-${suffix}` },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  }).then((r) => r.json());
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: phone, pin: user.initial_pin })
  }).then((r) => r.json());
  return { person_id: person.person_id, access_token: login.access_token };
}

test.before(startServer);
test.after(() => {
  server?.kill();
  foundationServer?.kill();
});

test("HR/admin can attach, list, read and remove an operator document", async () => {
  const created = await adminPost("/ops/v1/documents", "doc-create-001", {
    owner_type: "operator",
    owner_id: "operator_demo_wole",
    doc_type: "employment_contract",
    label: "Signed contract",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.link_id.startsWith("doclink_"));
  assert.ok(created.body.media.media_id.startsWith("media_"));
  assert.equal(created.body.media.storage_backend, "local");

  const listed = await admin("/ops/v1/documents?owner_type=operator&owner_id=operator_demo_wole");
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.can_edit, true);
  assert.ok(listed.body.data.some((row) => row.link_id === created.body.link_id && row.doc_type === "employment_contract"));

  const content = await fetch(`${baseUrl}/ops/v1/documents/${created.body.link_id}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "application/pdf");

  const removed = await admin(`/ops/v1/documents/${created.body.link_id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  const afterDelete = await admin("/ops/v1/documents?owner_type=operator&owner_id=operator_demo_wole");
  assert.ok(!afterDelete.body.data.some((row) => row.link_id === created.body.link_id));
});

test("document kinds are kept off the raw media route", async () => {
  // A document uploaded via the documents route cannot be read back through the
  // unscoped /media/:id/content route.
  const created = await adminPost("/ops/v1/documents", "doc-guard-001", {
    owner_type: "operator",
    owner_id: "operator_demo_wole",
    doc_type: "drivers_license",
    content_type: "image/png",
    content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  });
  assert.equal(created.response.status, 201);
  const raw = await fetch(`${baseUrl}/ops/v1/media/${created.body.media.media_id}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(raw.status, 403);

  // And a document kind cannot be smuggled in through the raw media upload route.
  const smuggled = await adminPost("/ops/v1/media", "doc-guard-002", {
    kind: "operator_document",
    content_type: "application/pdf",
    content_base64: pdfBase64,
    captured_at: new Date().toISOString()
  });
  assert.equal(smuggled.response.status, 400);
});

test("rejects bad input and unknown owners", async () => {
  const noOwner = await adminPost("/ops/v1/documents", "doc-bad-001", {
    owner_type: "operator",
    doc_type: "x",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(noOwner.response.status, 400);

  const badType = await adminPost("/ops/v1/documents", "doc-bad-002", {
    owner_type: "spaceship",
    owner_id: "operator_demo_wole",
    doc_type: "x",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(badType.response.status, 400);

  const unknown = await adminPost("/ops/v1/documents", "doc-bad-003", {
    owner_type: "operator",
    owner_id: "operator_does_not_exist",
    doc_type: "x",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(unknown.response.status, 404);

  // Video is not a valid document content type.
  const badContent = await adminPost("/ops/v1/documents", "doc-bad-004", {
    owner_type: "operator",
    owner_id: "operator_demo_wole",
    doc_type: "x",
    content_type: "video/mp4",
    content_base64: pdfBase64
  });
  assert.equal(badContent.response.status, 400);
});

test("scopes sensitive reads to HR/admin and the owning rider", async () => {
  // Attach a document to the seeded operator as admin.
  const attached = await adminPost("/ops/v1/documents", "doc-scope-001", {
    owner_type: "operator",
    owner_id: "operator_demo_wole",
    doc_type: "employment_contract",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(attached.response.status, 201);

  // An unrelated operator-role user cannot read it or list that operator's docs.
  const stranger = await operatorLogin("+2347000000461", "stranger");
  const strangerApi = as(stranger.access_token);
  const strangerRead = await fetch(`${baseUrl}/ops/v1/documents/${attached.body.link_id}/content`, {
    headers: { Authorization: `Bearer ${stranger.access_token}` }
  });
  assert.equal(strangerRead.status, 403);
  const strangerList = await strangerApi("/ops/v1/documents?owner_type=operator&owner_id=operator_demo_wole");
  assert.equal(strangerList.response.status, 403);

  // The owning rider can read their own document, but cannot attach or remove it.
  const wole = await admin("/ops/v1/operators/operator_demo_wole");
  const rider = await operatorLogin("+2347000000462", "owner");
  const riderOperator = await adminPost("/ops/v1/operators", "doc-scope-operator", {
    person_id: rider.person_id,
    operator_type: wole.body.operator_type || "rider",
    amoeba_id: wole.body.amoeba_id,
    site_id: wole.body.site_id
  });
  assert.equal(riderOperator.response.status, 201);
  const riderDoc = await adminPost("/ops/v1/documents", "doc-scope-owner", {
    owner_type: "operator",
    owner_id: riderOperator.body.operator_id,
    doc_type: "employment_contract",
    content_type: "application/pdf",
    content_base64: pdfBase64
  });
  assert.equal(riderDoc.response.status, 201);

  const riderApi = as(rider.access_token);
  const ownRead = await fetch(`${baseUrl}/ops/v1/documents/${riderDoc.body.link_id}/content`, {
    headers: { Authorization: `Bearer ${rider.access_token}` }
  });
  assert.equal(ownRead.status, 200);
  const ownList = await riderApi(`/ops/v1/documents?owner_type=operator&owner_id=${riderOperator.body.operator_id}`);
  assert.equal(ownList.response.status, 200);
  assert.equal(ownList.body.can_edit, false);
  const ownDelete = await riderApi(`/ops/v1/documents/${riderDoc.body.link_id}`, { method: "DELETE" });
  assert.equal(ownDelete.response.status, 403);
  const ownAttach = await riderApi("/ops/v1/documents", {
    method: "POST",
    headers: { "Idempotency-Key": "doc-scope-owner-attach" },
    body: JSON.stringify({
      owner_type: "operator",
      owner_id: riderOperator.body.operator_id,
      doc_type: "extra",
      content_type: "application/pdf",
      content_base64: pdfBase64
    })
  });
  assert.equal(ownAttach.response.status, 403);
});
