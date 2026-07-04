import { Injectable } from "@nestjs/common";
import fs from "node:fs/promises";

type PlatformAccount = {
  platform_account_id: string;
  platform: string;
  credentials_key: string;
  external_account_id?: string | null;
};

export type NormalizedDailyRecord = {
  platform_operator_id: string;
  trips_total: number;
  trips_completed: number;
  trips_cancelled: number;
  trips_no_response: number;
  trips_rejected: number;
  ride_revenue_ngn: number;
  net_earnings_ngn: number;
  booking_fees_ngn: number;
  cash_trips: number;
  card_trips: number;
  acceptance_pct: number | null;
  cancellation_pct: number | null;
  completion_pct: number | null;
  hours_online: number;
  last_seen_at: string | null;
  current_status: string;
  data_quality: string;
  provenance: Record<string, unknown>;
  raw_payload: unknown;
};

const boltTokenCache = new Map<string, { token: string; expiresAt: number }>();
const uberTokenCache = new Map<string, { token: string; expiresAt: number }>();

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function dateWindow(date: string, zone = "+01:00") {
  const start = new Date(`${date}T00:00:00.000${zone}`);
  const end = new Date(`${date}T23:59:59.999${zone}`);
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

async function responseJson(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function retry<T>(factory: () => Promise<T>, attempts = 4) {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await factory(); } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
    }
  }
  throw last;
}

@Injectable()
export class PlatformConnectorsService {
  private env(account: PlatformAccount, suffix: string, fallback?: string) {
    return process.env[`${account.credentials_key}_${suffix}`] || (fallback ? process.env[fallback] : undefined);
  }

  private async fixture(account: PlatformAccount, date: string) {
    const file = this.env(account, "FIXTURE_FILE");
    if (!file) return null;
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed[date] || parsed.records || []);
    return rows as NormalizedDailyRecord[];
  }

  async fetchDaily(account: PlatformAccount, date: string): Promise<NormalizedDailyRecord[]> {
    const fixture = await this.fixture(account, date);
    if (fixture) return fixture;
    if (account.platform === "bolt") return this.fetchBolt(account, date);
    if (account.platform === "uber") return this.fetchUber(account, date);
    throw new Error(`No connector is registered for platform ${account.platform}.`);
  }

  private async boltToken(account: PlatformAccount) {
    const cache = boltTokenCache.get(account.credentials_key);
    if (cache && cache.expiresAt > Date.now() + 30_000) return cache.token;
    const clientId = this.env(account, "CLIENT_ID", "BOLT_CLIENT_ID");
    const clientSecret = this.env(account, "CLIENT_SECRET", "BOLT_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error(`${account.credentials_key} Bolt credentials are not configured.`);
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "fleet-integration:api"
    });
    const data = await responseJson(await fetch("https://oidc.bolt.eu/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }), "Bolt OAuth");
    boltTokenCache.set(account.credentials_key, {
      token: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 600) * 1000
    });
    return data.access_token as string;
  }

  private async boltPost(account: PlatformAccount, path: string, body: Record<string, unknown>) {
    return retry(async () => responseJson(await fetch(`https://node.bolt.eu/fleet-integration-gateway${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.boltToken(account)}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    }), `Bolt ${path}`));
  }

  private async boltPages(account: PlatformAccount, path: string, key: string, body: Record<string, unknown>) {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const data = await this.boltPost(account, path, { ...body, limit: 1000, offset });
      const page = data.data?.[key] || [];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }

  private onlineHours(logs: any[], endTs: number) {
    const byDriver = new Map<string, any[]>();
    for (const log of logs) {
      if (!log.driver_uuid) continue;
      if (!byDriver.has(log.driver_uuid)) byDriver.set(log.driver_uuid, []);
      byDriver.get(log.driver_uuid)!.push(log);
    }
    const result = new Map<string, number>();
    for (const [driver, entries] of byDriver) {
      entries.sort((a, b) => Number(a.created) - Number(b.created));
      let seconds = 0;
      entries.forEach((entry, index) => {
        if (entry.state === "inactive") return;
        const next = entries[index + 1]?.created || endTs;
        seconds += Math.max(0, Number(next) - Number(entry.created));
      });
      result.set(driver, round(seconds / 3600));
    }
    return result;
  }

  private async fetchBolt(account: PlatformAccount, date: string) {
    const { start, end } = dateWindow(date);
    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);
    const companyId = Number(account.external_account_id || this.env(account, "COMPANY_ID", "BOLT_COMPANY_ID"));
    if (!companyId) throw new Error(`${account.credentials_key} company ID is not configured.`);
    const base = { company_id: companyId, start_ts: startTs, end_ts: endTs };
    const [orders, stateLogs] = await Promise.all([
      this.boltPages(account, "/fleetIntegration/v1/getFleetOrders", "orders", { ...base, company_ids: [companyId] }),
      this.boltPages(account, "/fleetIntegration/v1/getFleetStateLogs", "state_logs", base)
    ]);
    const hours = this.onlineHours(stateLogs, endTs);
    const aggregate = new Map<string, any>();
    for (const order of orders) {
      const id = String(order.driver_uuid || "");
      if (!id) continue;
      if (!aggregate.has(id)) aggregate.set(id, {
        total: 0, completed: 0, cancelled: 0, noResponse: 0, revenue: 0,
        earnings: 0, fees: 0, cash: 0, card: 0, lastSeen: null
      });
      const row = aggregate.get(id);
      row.total++;
      const status = String(order.order_status || "").toLowerCase();
      if (["finished", "completed"].includes(status)) row.completed++;
      else if (status.includes("cancel")) row.cancelled++;
      else if (status === "driver_did_not_respond") row.noResponse++;
      const payment = String(order.payment_method || "").toLowerCase();
      if (payment === "cash") row.cash++;
      else if (payment) row.card++;
      row.revenue += Number(order.order_price?.ride_price || 0);
      row.earnings += Number(order.order_price?.net_earnings || 0);
      row.fees += Number(order.order_price?.booking_fee || 0);
      row.lastSeen = order.finished_at || order.created_at || row.lastSeen;
    }
    return [...aggregate.entries()].map(([id, row]) => ({
      platform_operator_id: id,
      trips_total: row.total,
      trips_completed: row.completed,
      trips_cancelled: row.cancelled,
      trips_no_response: row.noResponse,
      trips_rejected: 0,
      ride_revenue_ngn: round(row.revenue),
      net_earnings_ngn: round(row.earnings),
      booking_fees_ngn: round(row.fees),
      cash_trips: row.cash,
      card_trips: row.card,
      acceptance_pct: row.total ? round(((row.completed + row.cancelled) / row.total) * 100) : 0,
      cancellation_pct: row.total ? round((row.cancelled / row.total) * 100) : 0,
      completion_pct: row.total ? round((row.completed / row.total) * 100) : 0,
      hours_online: hours.get(id) || 0,
      last_seen_at: row.lastSeen,
      current_status: (hours.get(id) || 0) > 0 ? "checked_out" : "not_seen_today",
      data_quality: "authoritative",
      provenance: { connector: "bolt", orders: row.total, state_logs: stateLogs.length },
      raw_payload: { aggregate: row }
    }));
  }

  private uberSuffix(account: PlatformAccount) {
    if (account.credentials_key === "UBER_CARS") return "1";
    if (account.credentials_key === "UBER_COURIER") return "2";
    return "";
  }

  private uberEnv(account: PlatformAccount, name: string) {
    const suffix = this.uberSuffix(account);
    return this.env(account, name) || process.env[`UBER_${name}${suffix ? `_${suffix}` : ""}`];
  }

  private async uberToken(account: PlatformAccount) {
    const cache = uberTokenCache.get(account.credentials_key);
    if (cache && cache.expiresAt > Date.now() + 60_000) return cache.token;
    const clientId = this.uberEnv(account, "CLIENT_ID");
    const clientSecret = this.uberEnv(account, "CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error(`${account.credentials_key} Uber credentials are not configured.`);
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: [
        "solutions.suppliers.drivers.status.read", "supplier.driver.activity.read",
        "solutions.suppliers.metrics.read", "supplier.partner.payments",
        "vehicle_suppliers.organizations.read"
      ].join(" ")
    });
    const data = await responseJson(await fetch("https://auth.uber.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }), "Uber OAuth");
    uberTokenCache.set(account.credentials_key, {
      token: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    });
    return data.access_token as string;
  }

  private async uberRequest(account: PlatformAccount, path: string, options: RequestInit = {}) {
    return retry(async () => responseJson(await fetch(`https://api.uber.com/v1/vehicle-suppliers${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${await this.uberToken(account)}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }), `Uber ${path}`));
  }

  private async fetchUber(account: PlatformAccount, date: string) {
    const encryptedOrg = this.uberEnv(account, "ORG_ID_ENCRYPTED") || this.uberEnv(account, "ORG_ID");
    if (!encryptedOrg) throw new Error(`${account.credentials_key} encrypted Uber org ID is not configured.`);
    const driverData = await this.uberRequest(account, `/drivers/actions?org_id=${encodeURIComponent(encryptedOrg)}`);
    const drivers = (driverData.driverStatusOverviews || [])
      .filter((item: any) => item.onboardingStatus === "ONBOARDING_STATUS_ACTIVE")
      .map((item: any) => item.driverInfo)
      .filter((item: any) => item?.driverUuid);
    const { startMs, endMs } = dateWindow(date);
    const analytics = await this.uberRequest(account, "/analytics-data/query", {
      method: "POST",
      body: JSON.stringify({
        reportRequests: [{
          timeRanges: [{ startsAt: startMs, endsAt: endMs }],
          dimensions: [{ name: "vs:driver" }],
          metrics: [
            { expression: "vs:TotalTrips" },
            { expression: "vs:HoursOnline" },
            { expression: "vs:HoursOnTrip" },
            { expression: "vs:TotalEarnings" }
          ],
          pagination_options: { pageSize: 100 }
        }],
        orgId: { orgUuid: encryptedOrg }
      })
    }).catch(() => ({ reports: [] }));
    const report = (analytics.reports || analytics.body?.reports || [])[0] || {};
    const headers = report.columnHeader || {};
    const dimNames = (headers.dimensionHeaderEntries || []).map((item: any) => String(item.name || "").toLowerCase());
    const metricNames = (headers.metricHeaderEntries || []).map((item: any) => String(item.name || "").replace(/^vs:/, ""));
    const rows = report.data?.timeRangeData?.[0]?.rows || [];
    const byName = new Map<string, string>(drivers.map((driver: any) => [
      `${driver.firstName || ""} ${driver.lastName || ""}`.trim().toLowerCase(), driver.driverUuid
    ] as [string, string]));
    const metricsByDriver = new Map<string, any>();
    for (const row of rows) {
      const dimensions = row.dimensionValues || [];
      const first = dimensions[dimNames.indexOf("firstname")]?.value || "";
      const last = dimensions[dimNames.indexOf("lastname")]?.value || "";
      const id = byName.get(`${first} ${last}`.trim().toLowerCase());
      if (!id) continue;
      const values = row.metrics?.[0]?.values || [];
      const metric = (name: string) => Number(values[metricNames.indexOf(name)]?.value || values[metricNames.indexOf(name)] || 0);
      metricsByDriver.set(id, {
        total: Math.round(metric("TotalTrips")),
        hours: metric("HoursOnline"),
        earnings: metric("TotalEarnings")
      });
    }
    return drivers.map((driver: any) => {
      const metric = metricsByDriver.get(driver.driverUuid) || { total: 0, hours: 0, earnings: 0 };
      return {
        platform_operator_id: driver.driverUuid,
        trips_total: metric.total,
        trips_completed: metric.total,
        trips_cancelled: 0,
        trips_no_response: 0,
        trips_rejected: 0,
        ride_revenue_ngn: round(metric.earnings),
        net_earnings_ngn: round(metric.earnings),
        booking_fees_ngn: 0,
        cash_trips: 0,
        card_trips: 0,
        acceptance_pct: null,
        cancellation_pct: metric.total ? 0 : null,
        completion_pct: metric.total ? 100 : null,
        hours_online: round(metric.hours),
        last_seen_at: null,
        current_status: metric.hours > 0 ? "checked_out" : "not_seen_today",
        data_quality: "derived",
        provenance: { connector: "uber", revenue_source: "analytics", account: account.credentials_key },
        raw_payload: { analytics: metric }
      };
    });
  }
}
