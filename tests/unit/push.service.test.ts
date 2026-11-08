import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import webpush from "web-push";
import { PushService } from "../../apps/ops-api/src/push.service.js";

// A minimal in-memory stand-in for DatabaseService — just the two methods
// pushToPerson touches: many() (list a person's active subs) and exec() (prune a
// gone endpoint). Rows carry `active` so we can assert pruning.
function fakeDb(rows: any[]) {
  return {
    rows,
    async many(_sql: string, params: unknown[]) {
      const personId = params[0];
      return rows.filter((r) => r.person_id === personId && r.active);
    },
    async exec(sql: string, params: unknown[]) {
      // deactivateEndpoint: "... SET active = FALSE ... WHERE endpoint = $1"
      if (sql.includes("WHERE endpoint = $1")) {
        const endpoint = params[0];
        for (const r of rows) if (r.endpoint === endpoint) r.active = false;
      }
    }
  };
}

const VAPID = webpush.generateVAPIDKeys();
function withPushEnv(on: boolean, run: () => Promise<void>) {
  const prev = { ...process.env };
  if (on) {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = VAPID.publicKey;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = VAPID.privateKey;
    process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:test@fleximotion.online";
  } else {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  }
  return run().finally(() => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = prev.WEB_PUSH_VAPID_PUBLIC_KEY;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = prev.WEB_PUSH_VAPID_PRIVATE_KEY;
    process.env.WEB_PUSH_VAPID_SUBJECT = prev.WEB_PUSH_VAPID_SUBJECT;
  });
}

// Stub the one web-push call PushService makes. statusByEndpoint maps an endpoint
// to an HTTP status to throw (so we can simulate a gone 410 or a transient 500);
// anything absent "succeeds".
const originalSend = webpush.sendNotification;
let sentCalls: string[] = [];
function stubSend(statusByEndpoint: Record<string, number> = {}) {
  sentCalls = [];
  (webpush as any).sendNotification = async (sub: any) => {
    sentCalls.push(sub.endpoint);
    const status = statusByEndpoint[sub.endpoint];
    if (status) {
      const err: any = new Error(`push endpoint returned ${status}`);
      err.statusCode = status;
      throw err;
    }
    return { statusCode: 201 };
  };
}
afterEach(() => { (webpush as any).sendNotification = originalSend; });

const payload = { event_type: "ops.incident.created", incident_type: "accident", severity: "high" };
const sub = (person: string, endpoint: string) => ({
  person_id: person, endpoint, p256dh: "k", auth: "a", active: true
});

test("fans a push out to every active device a person has", async () => {
  await withPushEnv(true, async () => {
    const db = fakeDb([sub("p1", "https://push/a"), sub("p1", "https://push/b"), sub("p2", "https://push/c")]);
    stubSend();
    const service = new PushService(db as any);
    const sent = await service.pushToPerson("p1", payload);
    assert.equal(sent, 2, "both of p1's devices were pushed");
    assert.deepEqual(sentCalls.sort(), ["https://push/a", "https://push/b"]);
  });
});

test("prunes a gone endpoint (410) without counting it as a failure", async () => {
  await withPushEnv(true, async () => {
    const db = fakeDb([sub("p1", "https://push/live"), sub("p1", "https://push/gone")]);
    stubSend({ "https://push/gone": 410 });
    const service = new PushService(db as any);
    const sent = await service.pushToPerson("p1", payload);
    assert.equal(sent, 1, "only the live endpoint counts");
    assert.equal(db.rows.find((r) => r.endpoint === "https://push/gone").active, false, "gone endpoint is deactivated");
    assert.equal(db.rows.find((r) => r.endpoint === "https://push/live").active, true, "live endpoint is untouched");
  });
});

test("throws when every live endpoint fails transiently (so the queue retries)", async () => {
  await withPushEnv(true, async () => {
    const db = fakeDb([sub("p1", "https://push/x")]);
    stubSend({ "https://push/x": 500 });
    const service = new PushService(db as any);
    await assert.rejects(() => service.pushToPerson("p1", payload), /Web push failed/);
    assert.equal(db.rows[0].active, true, "a transient failure does NOT prune the endpoint");
  });
});

test("is a no-op (no send) when the person has no subscriptions", async () => {
  await withPushEnv(true, async () => {
    const db = fakeDb([sub("other", "https://push/z")]);
    stubSend();
    const service = new PushService(db as any);
    const sent = await service.pushToPerson("p1", payload);
    assert.equal(sent, 0);
    assert.equal(sentCalls.length, 0, "nothing was sent");
  });
});

test("is a no-op when web push is not configured, even with subscriptions", async () => {
  await withPushEnv(false, async () => {
    const db = fakeDb([sub("p1", "https://push/a")]);
    stubSend();
    const service = new PushService(db as any);
    assert.equal(service.enabled(), false);
    assert.equal(service.vapidPublicKey(), null);
    const sent = await service.pushToPerson("p1", payload);
    assert.equal(sent, 0);
    assert.equal(sentCalls.length, 0, "no VAPID keys -> never attempts a send");
  });
});
