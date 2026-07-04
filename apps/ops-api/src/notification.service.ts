import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

type Delivery = {
  notification_delivery_id: string;
  recipient_person_id: string;
  channel: string;
  payload: Record<string, unknown>;
  attempt: number;
};

@Injectable()
export class NotificationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async deliverBatch(limit = 50) {
    const results = [];
    for (let index = 0; index < limit; index++) {
      const delivery = await this.claimNext();
      if (!delivery) break;
      results.push(await this.deliver(delivery));
    }
    return results;
  }

  private async claimNext(): Promise<Delivery | null> {
    const queued = await this.db.one<Delivery>(
      `SELECT notification_delivery_id, recipient_person_id, channel, payload, attempt
       FROM ops_notification_deliveries
       WHERE status IN ('pending','retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY created_at ASC LIMIT 1`
    );
    if (!queued) return null;
    return this.db.one<Delivery>(
      `UPDATE ops_notification_deliveries
       SET status='sending', attempt=attempt+1, updated_at=NOW()
       WHERE notification_delivery_id=$1 AND status IN ('pending','retrying')
       RETURNING notification_delivery_id, recipient_person_id, channel, payload, attempt`,
      [queued.notification_delivery_id]
    );
  }

  private async deliver(delivery: Delivery) {
    try {
      const providerMessageId = await this.send(delivery);
      await this.db.exec(
        `UPDATE ops_notification_deliveries
         SET status='delivered', provider_message_id=$2, delivered_at=NOW(),
             updated_at=NOW(), error_summary=NULL, next_attempt_at=NULL
         WHERE notification_delivery_id=$1`,
        [delivery.notification_delivery_id, providerMessageId]
      );
      return { ...delivery, status: "delivered", provider_message_id: providerMessageId };
    } catch (error: any) {
      const retry = Number(delivery.attempt) < 5;
      const delaySeconds = Math.min(3600, 60 * (2 ** Math.max(0, Number(delivery.attempt) - 1)));
      await this.db.exec(
        `UPDATE ops_notification_deliveries
         SET status=$2, error_summary=$3, next_attempt_at=$4, updated_at=NOW()
         WHERE notification_delivery_id=$1`,
        [
          delivery.notification_delivery_id,
          retry ? "retrying" : "failed",
          error?.message || "Notification delivery failed.",
          retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : null
        ]
      );
      return { ...delivery, status: retry ? "retrying" : "failed", error_summary: error?.message };
    }
  }

  private async send(delivery: Delivery) {
    const webhook = process.env.OPS_NOTIFICATION_WEBHOOK_URL;
    if (!webhook) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("OPS_NOTIFICATION_WEBHOOK_URL is not configured.");
      }
      console.log("[ops-notification]", JSON.stringify(delivery));
      return `development_${delivery.notification_delivery_id}`;
    }
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPS_NOTIFICATION_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.OPS_NOTIFICATION_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify(delivery),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Notification webhook failed (${response.status}).`);
    const body: any = await response.json().catch(() => ({}));
    return String(body.message_id || body.id || delivery.notification_delivery_id);
  }
}
