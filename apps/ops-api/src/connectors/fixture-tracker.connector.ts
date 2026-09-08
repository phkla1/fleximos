import fs from "node:fs/promises";
import type { TrackerConnector, TrackerDailyDistance, TrackerDevice } from "./tracker.types.js";

// File-backed tracker for tests and demos, mirroring the platform
// connectors' fixture mode. The JSON shape:
//   { "devices": [{ "device_id": "...", "name": "..." }],
//     "distances": { "<device_id>": { "<YYYY-MM-DD>": 42.7 } } }

export class FixtureTrackerConnector implements TrackerConnector {
  readonly provider = "fixture";

  constructor(private readonly file: string) {}

  private async load() {
    return JSON.parse(await fs.readFile(this.file, "utf8"));
  }

  async listDevices(): Promise<TrackerDevice[]> {
    const data = await this.load();
    return (data.devices || []).map((item: any) => ({
      device_id: String(item.device_id),
      name: String(item.name || item.device_id),
      online: item.online ?? null,
      group: item.group ?? null,
      last_seen_at: item.last_seen_at ?? null,
      raw: item
    }));
  }

  async dailyDistance(deviceId: string, date: string): Promise<TrackerDailyDistance> {
    const data = await this.load();
    const value = data.distances?.[deviceId]?.[date];
    return {
      device_id: deviceId,
      record_date: date,
      distance_km: value === undefined || value === null ? null : Number(value),
      raw: { fixture: this.file }
    };
  }
}
