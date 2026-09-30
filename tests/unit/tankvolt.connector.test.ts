import assert from "node:assert/strict";
import { test } from "node:test";
import { TankvoltConnector } from "../../apps/ops-api/src/connectors/tankvolt.connector.js";

// Drive the connector with a stubbed fetch so we validate the exact parsing of
// Tankvolt's confirmed response shape (query-vehicle-gps, 30 Sep 2026) without
// touching the network.
function withFetch(handler: (url: string, init: any) => any, run: () => Promise<void>) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    const body = handler(String(url), init);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return run().finally(() => { (globalThis as any).fetch = original; });
}

const connector = new TankvoltConnector({ baseUrl: "https://devweb.tankvolt.net", apiKey: "test-key" });

test("latestPositions parses the confirmed GPS payload (hemisphere signing, fix validity, battery state)", async () => {
  await withFetch(
    () => ({
      code: 0, message: "success.", data: [{
        vin: "LB7FP210XSF000155", gpsDataList: [{
          batterySn: "03NPE03KCY001GE9E0000009", dataTime: "2026-09-18 05:43:30",
          lonHem: "E", longitude: 112.988269, latHem: "N", latitude: 22.592370,
          speed: 0, azimuth: 65.52, accuracy: 5, locationState: "V", workState: 2, satelliteNum: 0
        }]
      }]
    }),
    async () => {
      const [pos] = await connector.latestPositions!(["LB7FP210XSF000155"]);
      assert.equal(pos.device_id, "LB7FP210XSF000155");
      assert.equal(pos.lat, 22.592370);   // N -> positive
      assert.equal(pos.lng, 112.988269);  // E -> positive
      assert.equal(pos.battery_state, "discharging"); // workState 2
      assert.equal(pos.fix_valid, false);             // locationState "V"
      assert.equal(pos.battery_sn, "03NPE03KCY001GE9E0000009");
    }
  );
});

test("southern/western hemispheres flip the sign", async () => {
  await withFetch(
    () => ({ code: 0, data: [{ vin: "V", gpsDataList: [{ latHem: "S", latitude: 1.5, lonHem: "W", longitude: 3.2, locationState: "A", workState: 0 }] }] }),
    async () => {
      const [pos] = await connector.latestPositions!(["V"]);
      assert.equal(pos.lat, -1.5);
      assert.equal(pos.lng, -3.2);
      assert.equal(pos.fix_valid, true);
    }
  );
});

test("dailyDistance sums valid (A) fixes and ignores void (V) ones", async () => {
  // Two close valid fixes ~157 m apart; distance > 0.
  await withFetch(
    () => ({ code: 0, data: [{ vin: "V", gpsDataList: [
      { latHem: "N", latitude: 6.4520, lonHem: "E", longitude: 3.4720, locationState: "A", dataTime: "2026-09-18 09:00:00" },
      { latHem: "N", latitude: 6.4534, lonHem: "E", longitude: 3.4720, locationState: "A", dataTime: "2026-09-18 09:05:00" }
    ] }] }),
    async () => {
      const reading = await connector.dailyDistance("V", "2026-09-18");
      assert.ok(reading.distance_km !== null && reading.distance_km > 0, "valid trace has distance");
      assert.equal((reading.raw as any).valid_points, 2);
    }
  );
  // All void -> zero distance (invalid fixes excluded), not null.
  await withFetch(
    () => ({ code: 0, data: [{ vin: "V", gpsDataList: [
      { latHem: "N", latitude: 6.45, lonHem: "E", longitude: 3.47, locationState: "V" },
      { latHem: "N", latitude: 6.46, lonHem: "E", longitude: 3.47, locationState: "V" }
    ] }] }),
    async () => {
      const reading = await connector.dailyDistance("V", "2026-09-18");
      assert.equal(reading.distance_km, 0);
      assert.equal((reading.raw as any).valid_points, 0);
    }
  );
});

test("an application-level auth failure (code 1) is surfaced as an error", async () => {
  await withFetch(
    () => ({ code: 1, message: "Authentication failed.", data: null }),
    async () => {
      await assert.rejects(() => connector.latestPositions!(["V"]), /Authentication failed|rejected/);
    }
  );
});
