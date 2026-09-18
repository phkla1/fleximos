import { CartrackerConnector } from "./cartracker.connector.js";
import { FixtureTrackerConnector } from "./fixture-tracker.connector.js";
import { TankvoltConnector } from "./tankvolt.connector.js";
import type { TrackerConnector } from "./tracker.types.js";

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

export function createTrackerConnectors(env: NodeJS.ProcessEnv = process.env): TrackerConnector[] {
  if (env.TRACKER_FIXTURE_FILE) return [new FixtureTrackerConnector(env.TRACKER_FIXTURE_FILE)];
  const connectors: TrackerConnector[] = [];
  if (env.CARTRACKER_EMAIL && env.CARTRACKER_PASSWORD) {
    connectors.push(new CartrackerConnector({
      baseUrl: env.CARTRACKER_API_BASE || "https://app.cartracker.com.ng/api",
      email: env.CARTRACKER_EMAIL,
      password: env.CARTRACKER_PASSWORD
    }));
  }
  if (env.TANKVOLT_API_KEY) {
    // Probed 18 Sep 2026: the partner API answers at web.tankvolt.net
    // (the docs' {ip:port} placeholder resolves to the same host as the
    // dashboard), so only the key is mandatory.
    connectors.push(new TankvoltConnector({
      baseUrl: (env.TANKVOLT_API_BASE || "https://web.tankvolt.net").replace(/\/$/, ""),
      apiKey: env.TANKVOLT_API_KEY
    }));
  }
  return connectors;
}

/** Backwards-compatible single-connector view (first configured). */
export function createTrackerConnector(env: NodeJS.ProcessEnv = process.env): TrackerConnector | null {
  return createTrackerConnectors(env)[0] || null;
}
