import { Inject, Injectable } from "@nestjs/common";
import { DeliveriesService } from "./deliveries.service.js";
import { OpsService } from "./ops.service.js";
import { integrationsMode, integrationVar } from "./integration-env.js";

// A "revenue source" unifies the two kinds of external partner we pull money and
// data from: ride platforms (operators earn on them — Bolt, Uber, inDrive) and
// delivery customers (they pay us per package — Speedaf, Konga). They share one
// shell — name, status, an integration mode, a connector binding and health —
// and differ only in their kind-specific fields (pricing for a customer,
// vehicle class for a platform). This service projects both underlying tables
// into that shell for a single admin "Revenue sources" home.
//
// Integration mode is orthogonal to kind — it is HOW the daily data arrives:
//   api      — automated pull via a real API (credentials on the server)
//   headless — automated pull by driving the partner's web portal (no API)
//   file     — a human uploads the partner's periodic Excel/CSV
//   manual   — typed in by hand
// Manual entry is ALWAYS available as a fallback, because any pull can fail.

// Known connectors and the env vars that configure them. Secrets never leave the
// server; this only reports which NAMES to set and whether they currently
// resolve for the active test/production mode.
const CONNECTOR_REGISTRY: Record<string, { label: string; required_env: string[] }> = {
  speedaf: { label: "Speedaf portal (headless)", required_env: ["SPEEDAF_ACCOUNT", "SPEEDAF_PASSWORD"] },
  bolt: { label: "Bolt Fleet API", required_env: ["BOLT_CLIENT_ID", "BOLT_CLIENT_SECRET"] }
};

export type ConnectorState = {
  provider: string;
  label: string;
  env_mode: "test" | "production";
  required_env: string[];
  configured: boolean;
};

@Injectable()
export class RevenueSourcesService {
  constructor(
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
    @Inject(OpsService) private readonly ops: OpsService
  ) {}

  // A connector only applies to the automated modes. Its "configured" flag is
  // derived live from the environment — it reports whether the named secrets
  // resolve, never their values.
  private connectorState(provider: string | null | undefined, mode: string | null | undefined): ConnectorState | null {
    if (!provider || (mode !== "api" && mode !== "headless")) return null;
    const registered = CONNECTOR_REGISTRY[provider];
    const required = registered?.required_env ?? [];
    return {
      provider,
      label: registered?.label ?? provider,
      env_mode: integrationsMode(process.env),
      required_env: required,
      configured: required.length > 0 && required.every((name) => integrationVar(process.env, name) !== undefined)
    };
  }

  async list() {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());

    const platforms = (await this.ops.listPlatformAccounts()) as any[];
    const customers = (await this.deliveries.listCustomers()) as any[];

    const platformRows = platforms.map((p) => {
      const mode = p.integration_mode || "api";
      return {
        revenue_source_id: p.platform_account_id,
        kind: "ride_platform" as const,
        name: p.display_name,
        status: p.is_active ? "active" : "inactive",
        integration_mode: mode,
        vehicle_type: p.vehicle_type,
        account_subtype: p.account_subtype,
        connector: this.connectorState(p.platform, mode),
        pricing: null,
        manual_entry_available: true
      };
    });

    const customerRows = await Promise.all(customers.map(async (c) => {
      const mode = c.integration_mode || "manual";
      return {
        revenue_source_id: c.delivery_customer_id,
        kind: "delivery_customer" as const,
        name: c.name,
        status: c.status,
        integration_mode: mode,
        vehicle_type: null,
        account_subtype: null,
        connector: this.connectorState(c.connector_provider, mode),
        // contract_price_ngn may be stripped upstream for actors without
        // business oversight; allocated is the operator-facing figure.
        pricing: {
          contract_price_ngn: c.contract_price_ngn === undefined ? null : Number(c.contract_price_ngn),
          allocated_price_ngn: await this.deliveries.allocatedPriceFor(today, "all", c.delivery_customer_id)
        },
        manual_entry_available: true
      };
    }));

    return [...platformRows, ...customerRows].sort((a, b) => a.name.localeCompare(b.name));
  }
}
