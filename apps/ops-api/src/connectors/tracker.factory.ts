import { CartrackerConnector } from "./cartracker.connector.js";
import { FixtureTrackerConnector } from "./fixture-tracker.connector.js";
import type { TrackerConnector } from "./tracker.types.js";

// One place decides which tracker backs the suite. Order:
//   1. TRACKER_FIXTURE_FILE — deterministic file (tests, demos).
//   2. CARTRACKER_EMAIL + CARTRACKER_PASSWORD — live Car Tracker Nigeria.
//   3. Nothing configured — null; ingestion reports "not configured"
//      honestly instead of inventing data.
// Adding a vendor = one connector class + one branch here.

export function createTrackerConnector(env: NodeJS.ProcessEnv = process.env): TrackerConnector | null {
  if (env.TRACKER_FIXTURE_FILE) return new FixtureTrackerConnector(env.TRACKER_FIXTURE_FILE);
  if (env.CARTRACKER_EMAIL && env.CARTRACKER_PASSWORD) {
    return new CartrackerConnector({
      baseUrl: env.CARTRACKER_API_BASE || "https://app.cartracker.com.ng/api",
      email: env.CARTRACKER_EMAIL,
      password: env.CARTRACKER_PASSWORD
    });
  }
  return null;
}
