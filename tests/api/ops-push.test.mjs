import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import webpush from "web-push";

const port = 4474;
const baseUrl = `http://127.0.0.1:${port}`;
const foundationPort = 4475;
const foundationBaseUrl = `http://127.0.0.1:${foundationPort}`;
const token = "flexi-dev-service-token";
const dbDir = path.join(tmpdir(), `fleximos-ops-push-test-${Date.now()}`);
const foundationDbDir = path.join(tmpdir(), `fleximos-ops-push-auth-test-${Date.now()}`);
const repoRoot = new URL("../..", import.meta.url).pathname;

// Known VAPID keys injected into the server so the GET returns something we can assert.
const VAPID = webpush.generateVAPIDKeys();

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
    env: {
      ...process.env,
      FLEXI_SEED_DEMO: "true", PORT: String(port), HOST: "127.0.0.1",
      FLEXI_OPS_DB_DIR: dbDir, FOUNDATION_API_BASE: foundationBaseUrl,
      WEB_PUSH_VAPID_PUBLIC_KEY: VAPID.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: VAPID.privateKey,
      WEB_PUSH_VAPID_SUBJECT: "mailto:test@fleximotion.online"
    },
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
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  };
}
const admin = as(token);
const anon = as(null);

test.before(startServer);
test.after(() => { server?.kill(); foundationServer?.kill(); });

const sampleSub = { endpoint: "https://push.example/endpoint-1", keys: { p256dh: "BPc0987fakeKey", auth: "fakeAuth123" } };

test("the VAPID public key is served to an authenticated caller", async () => {
  const res = await admin("/ops/v1/push/vapid-public-key");
  assert.equal(res.response.status, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.public_key, VAPID.publicKey);
});

test("subscribing requires authentication", async () => {
  const res = await anon("/ops/v1/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: sampleSub }) });
  assert.equal(res.response.status, 401);
});

test("a device can subscribe and then unsubscribe", async () => {
  const sub = await admin("/ops/v1/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: sampleSub }) });
  assert.equal(sub.response.status, 200);
  assert.equal(sub.body.subscribed, true);

  // Re-posting the same endpoint is idempotent (no Idempotency-Key needed).
  const again = await admin("/ops/v1/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: sampleSub }) });
  assert.equal(again.body.subscribed, true);

  const off = await admin("/ops/v1/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: sampleSub.endpoint }) });
  assert.equal(off.response.status, 200);
  assert.equal(off.body.subscribed, false);
});

test("a subscription without keys is rejected", async () => {
  const res = await admin("/ops/v1/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: { endpoint: "https://push.example/no-keys" } }) });
  assert.equal(res.response.status, 400);
});
