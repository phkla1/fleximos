import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { DatabaseService } from "./database.service.js";

type StoredSubscription = {
  push_subscription_id: string;
  person_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

// A browser PushSubscription as the client serialises it.
type ClientSubscription = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

// Friendly words for the operator-chosen incident category.
const INCIDENT_LABEL: Record<string, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  police: "Police",
  fuel: "Fuel",
  battery: "Battery"
};

function incidentLabel(type: unknown): string {
  const key = String(type || "");
  return INCIDENT_LABEL[key] || (key ? key.replace(/_/g, " ") : "Support");
}

// Turn a queued notification payload into a browser-ready notification. Payloads
// carry only the event type, ids and the incident category/severity — never a
// person's name — so nothing sensitive rides in a push the OS may cache.
function toNotification(payload: Record<string, unknown>): {
  title: string;
  body: string;
  data: Record<string, unknown>;
} {
  const label = incidentLabel(payload.incident_type);
  if (payload.event_type === "ops.incident.acknowledged") {
    return {
      title: "✅ Help is on the way",
      body: `Your ${label.toLowerCase()} report was acknowledged by your supervisor.`,
      data: { url: "/apps/operator-pwa/", ...payload }
    };
  }
  // Default: an operator has raised an SOS.
  return {
    title: `🆘 ${label} — an operator needs support`,
    body: "Tap to open the incident in the console.",
    data: { url: "/apps/ops-console/#field", ...payload }
  };
}

@Injectable()
export class PushService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private vapid(): { publicKey: string; privateKey: string; subject: string } | null {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return null;
    // A subject is required by the spec; default to a mailto so a mis-set env
    // still yields a valid (if generic) contact rather than a hard failure.
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:ops@fleximotion.online";
    return { publicKey, privateKey, subject };
  }

  // Whether the server can send web push at all (keys present).
  enabled(): boolean {
    return this.vapid() !== null;
  }

  // The public key the browser needs to create a subscription; null when push
  // is not configured, so the client can show "unavailable" rather than fail.
  vapidPublicKey(): string | null {
    return this.vapid()?.publicKey ?? null;
  }

  private id() {
    return `pushsub_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  }

  // Save (or reactivate) this device's subscription for a person. Keyed by the
  // endpoint, which is globally unique per browser install; if the same endpoint
  // reappears for a different person (shared device, re-login) it is reassigned.
  async saveSubscription(personId: string, sub: ClientSubscription, userAgent: string | null) {
    const endpoint = String(sub?.endpoint || "");
    const p256dh = String(sub?.keys?.p256dh || "");
    const auth = String(sub?.keys?.auth || "");
    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException("A push subscription needs endpoint and keys (p256dh, auth).");
    }
    const now = new Date().toISOString();
    await this.db.exec(
      `INSERT INTO ops_push_subscriptions
         (push_subscription_id, person_id, endpoint, p256dh, auth, user_agent, active, created_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$7)
       ON CONFLICT (endpoint) DO UPDATE SET
         person_id = EXCLUDED.person_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         active = TRUE,
         last_seen_at = EXCLUDED.last_seen_at`,
      [this.id(), personId, endpoint, p256dh, auth, userAgent, now]
    );
    return { subscribed: true };
  }

  // This device opts out. Scoped to the caller so one person can't drop another's.
  async removeSubscription(personId: string, endpoint: string) {
    await this.db.exec(
      `UPDATE ops_push_subscriptions SET active = FALSE, last_seen_at = $3
       WHERE person_id = $1 AND endpoint = $2`,
      [personId, String(endpoint || ""), new Date().toISOString()]
    );
    return { subscribed: false };
  }

  async listActive(personId: string): Promise<StoredSubscription[]> {
    return this.db.many<StoredSubscription>(
      `SELECT push_subscription_id, person_id, endpoint, p256dh, auth
       FROM ops_push_subscriptions WHERE person_id = $1 AND active = TRUE`,
      [personId]
    );
  }

  private async deactivateEndpoint(endpoint: string) {
    await this.db.exec(
      `UPDATE ops_push_subscriptions SET active = FALSE, last_seen_at = $2 WHERE endpoint = $1`,
      [endpoint, new Date().toISOString()]
    );
  }

  // Fan a notification out to every active device a person has registered.
  // Returns the number of successful sends. A gone endpoint (404/410) is pruned
  // and does NOT count as a failure. If there are live endpoints and every one
  // failed for a transient reason, this throws so the delivery queue retries.
  async pushToPerson(personId: string, payload: Record<string, unknown>): Promise<number> {
    const config = this.vapid();
    if (!config) return 0; // push not configured — nothing to deliver, no retry.
    const subs = await this.listActive(personId);
    if (!subs.length) return 0;

    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    const body = JSON.stringify(toNotification(payload));

    let sent = 0;
    let liveFailures = 0;
    let lastError: unknown = null;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 600, urgency: "high" }
        );
        sent++;
      } catch (error: any) {
        const status = Number(error?.statusCode);
        if (status === 404 || status === 410) {
          await this.deactivateEndpoint(sub.endpoint); // subscription is gone; prune it.
        } else {
          liveFailures++;
          lastError = error;
        }
      }
    }
    if (sent === 0 && liveFailures > 0) {
      throw new Error(`Web push failed for ${liveFailures} endpoint(s): ${(lastError as any)?.message || "unknown"}`);
    }
    return sent;
  }
}
