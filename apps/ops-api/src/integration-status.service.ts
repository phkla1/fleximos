import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { PlatformConnectorsService } from "./platform-connectors.service.js";
import { createTrackerConnectors } from "./connectors/tracker.factory.js";

// The integration status monitor. One place answers "which of our
// external dependencies are up right now?" for every console — so a
// provider outage (e.g. Orbit's backend being down) is a visible,
// explained state instead of a silent gap. Every check is cheap and the
// whole aggregate is cached; status transitions are persisted so the UI
// can say "down for 3 days", not just "down now".

type Probe = { status: "ok" | "degraded" | "down"; detail: string; latency_ms: number | null };

type IntegrationRow = {
  key: string;
  label: string;
  category: "tracker" | "platform" | "payments" | "core";
  configured: boolean;
  status: "ok" | "degraded" | "down" | "not_configured";
  detail: string;
  latency_ms: number | null;
  last_ok_at: string | null;
  status_since: string | null;
  last_checked_at: string;
};

@Injectable()
export class IntegrationStatusService {
  private cache: { at: number; rows: IntegrationRow[] } | null = null;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PlatformConnectorsService) private readonly platforms: PlatformConnectorsService
  ) {}

  private async paymentsProbe(): Promise<Probe> {
    const started = Date.now();
    const base = process.env.PAYMENTS_API_BASE || "http://127.0.0.1:4040";
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
      const latency = Date.now() - started;
      if (!response.ok) return { status: "degraded", detail: `Payments health HTTP ${response.status}.`, latency_ms: latency };
      const data = await response.json().catch(() => ({}));
      return { status: "ok", detail: `Payments integration ${data.provider_mode || "reachable"}.`, latency_ms: latency };
    } catch (error: any) {
      return { status: "down", detail: `Payments integration unreachable: ${String(error?.message).slice(0, 100)}`, latency_ms: Date.now() - started };
    }
  }

  private async foundationProbe(): Promise<Probe> {
    const started = Date.now();
    const base = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
      return response.ok
        ? { status: "ok", detail: "Identity/Amoeba foundation reachable.", latency_ms: Date.now() - started }
        : { status: "degraded", detail: `Foundation health HTTP ${response.status}.`, latency_ms: Date.now() - started };
    } catch (error: any) {
      return { status: "down", detail: `Foundation unreachable: ${String(error?.message).slice(0, 100)}`, latency_ms: Date.now() - started };
    }
  }

  // Persist the probe, tracking last_ok_at and how long the current status
  // has held (status_since only moves when the status label changes).
  private async persist(key: string, probe: Probe): Promise<{ last_ok_at: string | null; status_since: string | null }> {
    const now = new Date().toISOString();
    const previous = await this.db.one<any>("SELECT * FROM ops_integration_health WHERE integration_key=$1", [key]);
    const statusSince = previous && previous.status === probe.status ? previous.status_since : now;
    const lastOkAt = probe.status === "ok" ? now : (previous?.last_ok_at || null);
    await this.db.exec(
      `INSERT INTO ops_integration_health
        (integration_key, status, detail, last_ok_at, status_since, last_checked_at, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (integration_key) DO UPDATE SET
        status=EXCLUDED.status, detail=EXCLUDED.detail, last_ok_at=EXCLUDED.last_ok_at,
        status_since=EXCLUDED.status_since, last_checked_at=EXCLUDED.last_checked_at, latency_ms=EXCLUDED.latency_ms`,
      [key, probe.status, probe.detail, lastOkAt, statusSince, now, probe.latency_ms]
    );
    return { last_ok_at: lastOkAt, status_since: statusSince };
  }

  async snapshot(force = false): Promise<{ generated_at: string; integrations: IntegrationRow[] }> {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) {
      return { generated_at: new Date(this.cache.at).toISOString(), integrations: this.cache.rows };
    }
    const rows: IntegrationRow[] = [];
    const record = async (key: string, label: string, category: IntegrationRow["category"], probe: Probe) => {
      const { last_ok_at, status_since } = await this.persist(key, probe);
      rows.push({
        key, label, category, configured: true,
        status: probe.status, detail: probe.detail, latency_ms: probe.latency_ms,
        last_ok_at, status_since, last_checked_at: new Date().toISOString()
      });
    };

    // Trackers (each configured connector).
    const trackers = createTrackerConnectors();
    for (const connector of trackers) {
      const probe: Probe = connector.healthCheck
        ? await connector.healthCheck()
        : { status: "degraded", detail: "No health probe implemented.", latency_ms: null };
      await record(`tracker:${connector.provider}`, connector.label || connector.provider, "tracker", probe);
    }
    // Trackers that exist in the codebase but aren't configured — shown so
    // the monitor lists the whole fleet-tracking surface, not just what's on.
    const configuredProviders = new Set(trackers.map((connector) => connector.provider));
    for (const [key, label] of [["cartracker", "Car Tracker Nigeria"], ["tankvolt", "Tankvolt EV"], ["orbit", "Orbit Fleet"]] as const) {
      if (!configuredProviders.has(key) && !process.env.TRACKER_FIXTURE_FILE) {
        rows.push({
          key: `tracker:${key}`, label, category: "tracker", configured: false,
          status: "not_configured", detail: "Connector built; credentials not configured yet.",
          latency_ms: null, last_ok_at: null, status_since: null, last_checked_at: new Date().toISOString()
        });
      }
    }

    // Platforms (active accounts).
    try {
      const accounts = (await this.ops.listPlatformAccounts() as any[]).filter((account) => account.is_active);
      for (const account of accounts) {
        if (account.platform === "uber") continue; // Uber left the market
        const probe = await this.platforms.platformHealth(account);
        await record(`platform:${account.credentials_key}`, account.display_name || account.platform, "platform", probe);
      }
    } catch {
      // platform account listing failed — non-fatal for the monitor
    }

    // Payments + foundation.
    await record("payments", "Payments / Monnify", "payments", await this.paymentsProbe());
    await record("foundation", "Identity & Amoeba", "core", await this.foundationProbe());

    this.cache = { at: Date.now(), rows };
    return { generated_at: new Date().toISOString(), integrations: rows };
  }
}
