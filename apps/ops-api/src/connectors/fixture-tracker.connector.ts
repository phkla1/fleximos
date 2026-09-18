import fs from "node:fs/promises";
import type { TrackerConnector, TrackerControlResult, TrackerDailyDistance, TrackerDevice, TrackerPosition } from "./tracker.types.js";

// File-backed tracker for tests and demos, mirroring the platform
// connectors' fixture mode. The JSON shape:
//   { "devices": [{ "device_id": "...", "name": "..." }],
//     "distances": { "<device_id>": { "<YYYY-MM-DD>": 42.7 } },
//     "positions": [{ "device_id": "...", "lat": 6.5, "lng": 3.3,
//                     "speed_kmh": 0, "battery_state": "idle" }],
//     "control": { "supported": true } }

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

  async latestPositions(): Promise<TrackerPosition[]> {
    const data = await this.load();
    return (data.positions || []).map((point: any) => ({
      device_id: String(point.device_id),
      lat: Number(point.lat),
      lng: Number(point.lng),
      speed_kmh: point.speed_kmh === undefined ? null : Number(point.speed_kmh),
      heading: point.heading === undefined ? null : Number(point.heading),
      at: point.at ?? new Date().toISOString(),
      battery_sn: point.battery_sn ?? null,
      battery_state: point.battery_state ?? null,
      raw: point
    }));
  }

  async controlBattery(deviceId: string, command: 0 | 1): Promise<TrackerControlResult> {
    const data = await this.load();
    if (!data.control?.supported) {
      return { ok: false, result_code: 102, result_detail: "Fixture control disabled.", command_results: null };
    }
    return {
      ok: true,
      result_code: 100,
      result_detail: "success.",
      command_results: [{ res: 1, desc: "Command Succeeded", sn: `fixture-${deviceId}`, command }]
    };
  }
}
