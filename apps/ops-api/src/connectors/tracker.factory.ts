import { CartrackerConnector } from "./cartracker.connector.js";
import { FixtureTrackerConnector } from "./fixture-tracker.connector.js";
import { OrbitConnector } from "./orbit.connector.js";
import { TankvoltConnector } from "./tankvolt.connector.js";
import type { TrackerConnector } from "./tracker.types.js";
import { integrationsMode, integrationVar } from "../integration-env.js";

// Orbit's Supabase project URL, as shipped in the portal frontend
// (orbitconnect.ng, read 18 Sep 2026). Overridable if Orbit issues a new
// project. The anon key is a publishable frontend token (not a secret)
// but is long, so it stays in env and is documented in the deploy README.
const ORBIT_DEFAULT_URL = "https://kwpjggqnjycyylwzbcot.supabase.co";

// One place decides which trackers back the suite — several can run at
// once (Qutes on Car Tracker Nigeria, EV bikes on Tankvolt):
//   - TRACKER_FIXTURE_FILE — deterministic file (tests, demos); when set
//     it is the ONLY connector so tests stay hermetic.
//   - CARTRACKER_EMAIL + CARTRACKER_PASSWORD — Car Tracker Nigeria.
//   - TANKVOLT_API_BASE + TANKVOLT_API_KEY — Tankvolt EV bikes
//     (host:port and key assigned by Tankvolt per partner).
// Nothing configured → empty list; ingestion and the map report "not
// configured" honestly instead of inventing data.
// Adding a vendor = one connector class + one branch here.

// Tankvolt's confirmed TEST host (working 30 Sep 2026): the partner test API
// answers at devweb.tankvolt.net/iot-service/api/* with the static api-key
// header. It is used ONLY in test mode — production must set an explicit host.
const TANKVOLT_TEST_HOST = "https://devweb.tankvolt.net";

export function createTrackerConnectors(env: NodeJS.ProcessEnv = process.env): TrackerConnector[] {
  if (env.TRACKER_FIXTURE_FILE) return [new FixtureTrackerConnector(env.TRACKER_FIXTURE_FILE)];
  const mode = integrationsMode(env);
  const v = (name: string) => integrationVar(env, name);
  const connectors: TrackerConnector[] = [];
  if (v("CARTRACKER_EMAIL") && v("CARTRACKER_PASSWORD")) {
    connectors.push(new CartrackerConnector({
      baseUrl: v("CARTRACKER_API_BASE") || "https://app.cartracker.com.ng/api",
      email: v("CARTRACKER_EMAIL")!,
      password: v("CARTRACKER_PASSWORD")!
    }));
  }
  if (v("TANKVOLT_API_KEY")) {
    // The test host is assumed only in test mode; in production the host must be
    // set explicitly (TANKVOLT_PROD_API_BASE / TANKVOLT_API_BASE), so a prod key
    // can never silently talk to the Tankvolt test environment.
    const baseUrl = v("TANKVOLT_API_BASE") || (mode === "test" ? TANKVOLT_TEST_HOST : undefined);
    if (!baseUrl) {
      console.warn("[integrations] TANKVOLT_API_KEY is set for production but no TANKVOLT_PROD_API_BASE/TANKVOLT_API_BASE — Tankvolt disabled until a production host is provided.");
    } else {
      connectors.push(new TankvoltConnector({ baseUrl: baseUrl.replace(/\/$/, ""), apiKey: v("TANKVOLT_API_KEY")! }));
    }
  }
  if (v("ORBIT_EMAIL") && v("ORBIT_PASSWORD") && v("ORBIT_SUPABASE_ANON_KEY")) {
    connectors.push(new OrbitConnector({
      supabaseUrl: (v("ORBIT_SUPABASE_URL") || ORBIT_DEFAULT_URL).replace(/\/$/, ""),
      anonKey: v("ORBIT_SUPABASE_ANON_KEY")!,
      email: v("ORBIT_EMAIL")!,
      password: v("ORBIT_PASSWORD")!
    }));
  }
  return connectors;
}

/** Backwards-compatible single-connector view (first configured). */
export function createTrackerConnector(env: NodeJS.ProcessEnv = process.env): TrackerConnector | null {
  return createTrackerConnectors(env)[0] || null;
}
