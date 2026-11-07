import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const port = 4472;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4473;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-hosp-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-hosp-auth-test-${Date.now()}`);
const repoRoot = new URL("../..", import.meta.url).pathname;

let server, foundationServer;

async function startServer() {
  foundationServer = spawn("node", ["apps/api-foundation/server.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(foundationPort), HOST: "127.0.0.1", FLEXI_DB_DIR: foundationDbDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  foundationServer.stderr.on("data", (c) => process.stderr.write(c));
  let out = "";
  while (!out.includes("Foundation API:")) { const [c] = await once(foundationServer.stdout, "data"); out += String(c); }

  server = spawn("npx", ["tsx", "apps/ops-api/src/main.ts"], {
    cwd: repoRoot,
    env: { ...process.env, FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1", FLEXI_OPS_DB_DIR: dbDir, FOUNDATION_API_BASE: foundationBaseUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (c) => process.stderr.write(c));
  let o = "";
  while (!o.includes("Ops API:")) { const [c] = await once(server.stdout, "data"); o += String(c); }
}

function as(bearer) {
  return async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(token);
let idemSeq = 0;
const post = (url, payload) => admin(url, { method: "POST", headers: { "Idempotency-Key": `hosp-test-${Date.now()}-${idemSeq++}` }, body: JSON.stringify(payload) });
const patch = (url, payload) => admin(url, { method: "PATCH", headers: { "Idempotency-Key": `hosp-test-${Date.now()}-${idemSeq++}` }, body: JSON.stringify(payload) });

test.before(startServer);
test.after(() => { server?.kill(); foundationServer?.kill(); });

// The enriched sheet shape (pre-parsed rows, as the geocoder would emit): one
// street-level facility, one LGA-centroid fallback, one with no coordinates.
const rows = [
  { name: "Divine Medical Centre", provider_type: "Hospital", address: "53 Norman Williams St, Ikoyi", state: "Lagos", lga: "Eti-Osa", lat: "6.4520", lng: "3.4350", coords_quality: "street" },
  { name: "Havillah Hospital", provider_type: "Hospital", address: "2 Emmanuel Ibitolu St, Aja", state: "Lagos", lga: "Ibeju/Lekki", lat: "6.4698", lng: "3.5852", coords_quality: "lga_centroid" },
  { name: "Ocuville Eye Centre", provider_type: "Optical / Ophthalmology", address: "95 Ogudu Road", state: "Lagos", lga: "Kosofe" }
];

test("a dry-run reports every facility and flags the one with no coordinates", async () => {
  const dry = await post("/ops/v1/imports/hospitals", { dry_run: true, rows });
  assert.equal(dry.response.status, 200);
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.summary.total, 3);
  assert.equal(dry.body.summary.create, 3);
  const noCoords = dry.body.rows.find((r) => r.label === "Ocuville Eye Centre");
  assert.match(noCoords.reason || "", /no coordinates/i, "a coordinate-less row is flagged in the preview");

  // Nothing was written during the dry-run.
  const listed = (await admin("/ops/v1/hospitals")).body.data;
  assert.equal(listed.length, 0, "dry-run writes nothing");
});

test("committing imports the facilities and the list filters by type and mapped_only", async () => {
  const commit = await post("/ops/v1/imports/hospitals", { dry_run: false, rows });
  assert.equal(commit.body.dry_run, false);
  assert.equal(commit.body.summary.create, 3);

  const all = (await admin("/ops/v1/hospitals")).body.data;
  assert.equal(all.length, 3);

  const hospitalsOnly = (await admin("/ops/v1/hospitals?provider_type=Hospital")).body.data;
  assert.equal(hospitalsOnly.length, 2, "provider_type filter narrows to hospitals");

  const mapped = (await admin("/ops/v1/hospitals?mapped_only=true")).body.data;
  assert.equal(mapped.length, 2, "only the two with coordinates are map-plottable");
  assert.ok(mapped.every((h) => h.lat !== null && h.lng !== null));
});

test("re-importing a refreshed sheet upserts by name+LGA instead of duplicating", async () => {
  const again = await post("/ops/v1/imports/hospitals", {
    dry_run: false,
    rows: [{ ...rows[0], address: "53 Norman Williams Street, Ikoyi (updated)" }]
  });
  assert.equal(again.body.summary.create, 0, "an existing facility is not re-created");
  assert.equal(again.body.summary.skip, 1);
  const divine = (await admin("/ops/v1/hospitals?provider_type=Hospital")).body.data
    .find((h) => h.name === "Divine Medical Centre");
  assert.match(divine.address, /updated/, "the existing row was updated in place");
  const all = (await admin("/ops/v1/hospitals")).body.data;
  assert.equal(all.length, 3, "no duplicate was created");
});

test("a hand-entered coordinate correction is tagged authoritative", async () => {
  const ocuville = (await admin("/ops/v1/hospitals")).body.data.find((h) => h.name === "Ocuville Eye Centre");
  assert.equal(ocuville.coords_quality, "failed", "it imported without coordinates");
  const fixed = await patch(`/ops/v1/hospitals/${ocuville.hospital_id}`, { lat: 6.5833, lng: 3.3915 });
  assert.equal(fixed.response.status, 200);
  assert.equal(fixed.body.coords_quality, "authoritative", "a manual coordinate fix is authoritative");
  assert.equal(Number(fixed.body.lat), 6.5833);

  const mapped = (await admin("/ops/v1/hospitals?mapped_only=true")).body.data;
  assert.equal(mapped.length, 3, "the corrected facility now plots");
});

test("deactivating a facility drops it from the active list", async () => {
  const havillah = (await admin("/ops/v1/hospitals")).body.data.find((h) => h.name === "Havillah Hospital");
  await patch(`/ops/v1/hospitals/${havillah.hospital_id}`, { active: false });
  const active = (await admin("/ops/v1/hospitals?active=true")).body.data;
  assert.ok(!active.some((h) => h.name === "Havillah Hospital"), "inactive facility is filtered out");
});

test("importing hospitals requires a system admin", async () => {
  const person = await fetch(`${foundationBaseUrl}/identity/v1/people`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "hosp-person-op" },
    body: JSON.stringify({ display_name: "Plain Op", phone: "08050000090" })
  }).then((r) => r.json());
  const user = await fetch(`${foundationBaseUrl}/identity/v1/users`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "hosp-user-op" },
    body: JSON.stringify({ person_id: person.person_id, roles: ["operator"], status: "active" })
  }).then((r) => r.json());
  const login = await fetch(`${foundationBaseUrl}/identity/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_or_email: "08050000090", pin: user.initial_pin })
  }).then((r) => r.json());
  const denied = await as(login.access_token)("/ops/v1/imports/hospitals", {
    method: "POST", headers: { "Idempotency-Key": "hosp-denied-1" }, body: JSON.stringify({ dry_run: true, rows })
  });
  assert.equal(denied.response.status, 403);
});
