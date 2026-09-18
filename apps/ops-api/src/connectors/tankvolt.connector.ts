import type { TrackerConnector, TrackerControlResult, TrackerDailyDistance, TrackerDevice, TrackerPosition } from "./tracker.types.js";

// Tankvolt EV bikes (GPS protocol v1.0 + device control protocol v1.1).
// Auth is a static api-key header; the host:port is assigned per partner.
// Tankvolt has NO device-list endpoint — the devices are the VINs we
// registered with them, i.e. the fleet roster (registeredOnly = true).
// GPS is a history query (max 10 VINs, max 10 days per call), so:
//   - daily distance = haversine over the day's valid GPS points
//   - "current" position = newest point in a short trailing window

type TankvoltConfig = {
  baseUrl: string;
  apiKey: string;
};

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

const WORK_STATES: Record<number, string> = {
  0: "idle", 1: "charging", 2: "discharging", 3: "regenerating", 4: "storage", 5: "maintenance"
};

function signed(value: number, hemisphere: string | undefined, negativeWhen: string) {
  return String(hemisphere || "").toUpperCase() === negativeWhen ? -Math.abs(value) : value;
}

export class TankvoltConnector implements TrackerConnector {
  readonly provider = "tankvolt";
  readonly registeredOnly = true;

  constructor(private readonly config: TankvoltConfig) {}

  private async post(path: string, body: unknown) {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: { "api-key": this.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Tankvolt ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    if (Number(data.code) !== 0) throw new Error(`Tankvolt ${path} rejected: ${data.message || `code ${data.code}`}`);
    return data;
  }

  // Registered-only: the ingest service supplies devices from the roster.
  async listDevices(): Promise<TrackerDevice[]> {
    return [];
  }

  private async gpsPoints(vin: string, startTime: string, endTime: string) {
    const data = await this.post("/iot-service/api/query-vehicle-gps", [
      { vin, startTime, endTime }
    ]);
    const entry = (data.data || []).find((item: any) => item.vin === vin);
    // Vendor returns newest-first; chronological order suits distance math.
    return ((entry?.gpsDataList || []) as any[]).slice().reverse();
  }

  async dailyDistance(vin: string, date: string): Promise<TrackerDailyDistance> {
    const points = await this.gpsPoints(vin, `${date} 00:00:00`, `${date} 23:59:59`);
    const valid = points.filter((point) => point.locationState === "A"
      && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)));
    let distance = 0;
    for (let index = 1; index < valid.length; index++) {
      const previous = valid[index - 1];
      const current = valid[index];
      const leg = haversineKm(
        signed(Number(previous.latitude), previous.latHem, "S"), signed(Number(previous.longitude), previous.lonHem, "W"),
        signed(Number(current.latitude), current.latHem, "S"), signed(Number(current.longitude), current.lonHem, "W")
      );
      // Skip implausible jumps between consecutive samples (GPS noise).
      if (leg <= 2) distance += leg;
    }
    const latest = points[points.length - 1];
    return {
      device_id: vin,
      record_date: date,
      distance_km: valid.length < 2 ? (points.length ? 0 : null) : Math.round(distance * 100) / 100,
      raw: {
        derived: "haversine_over_gps_trace",
        points: points.length,
        valid_points: valid.length,
        battery_sn: latest?.batterySn ?? null,
        work_state: latest?.workState === undefined ? null : WORK_STATES[Number(latest.workState)] ?? String(latest.workState)
      }
    };
  }

  async latestPositions(vins: string[]): Promise<TrackerPosition[]> {
    if (!vins.length) return [];
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60_000);
    const format = (value: Date) => value.toISOString().slice(0, 19).replace("T", " ");
    const positions: TrackerPosition[] = [];
    // The API caps 10 vehicles per call — batch accordingly.
    for (let offset = 0; offset < vins.length; offset += 10) {
      const batch = vins.slice(offset, offset + 10).map((vin) => ({
        vin, startTime: format(start), endTime: format(now)
      }));
      const data = await this.post("/iot-service/api/query-vehicle-gps", batch);
      for (const entry of data.data || []) {
        const point = (entry.gpsDataList || [])[0]; // newest first
        if (!point) continue;
        positions.push({
          device_id: String(entry.vin),
          lat: signed(Number(point.latitude), point.latHem, "S"),
          lng: signed(Number(point.longitude), point.lonHem, "W"),
          speed_kmh: point.speed === undefined ? null : Number(point.speed),
          heading: point.azimuth === undefined ? null : Number(point.azimuth),
          at: point.dataTime ? String(point.dataTime) : null,
          battery_sn: point.batterySn ? String(point.batterySn) : null,
          battery_state: point.workState === undefined ? null : WORK_STATES[Number(point.workState)] ?? String(point.workState),
          raw: point
        });
      }
    }
    return positions;
  }

  async controlBattery(vin: string, command: 0 | 1): Promise<TrackerControlResult> {
    const data = await this.post("/iot-service/api/control-battery", [
      { vehicleVinOrPlate: vin, command }
    ]);
    const result = (data.data || [])[0] || {};
    const resultCode = result.resultCode === undefined ? null : Number(result.resultCode);
    return {
      ok: resultCode === 100,
      result_code: resultCode,
      result_detail: String(result.resultDetail || data.message || "No result returned."),
      command_results: result.commandResDtos ?? null
    };
  }
}
