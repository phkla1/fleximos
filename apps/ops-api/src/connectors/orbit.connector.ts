import type {
  TrackerConnector, TrackerControlResult, TrackerDailyDistance, TrackerDevice, TrackerHealth, TrackerPosition
} from "./tracker.types.js";

// Orbit e-bikes — the "Fleet Manager Portal" at orbitconnect.ng, a
// Supabase-backed app (JBD IoT devices). Mapped from the portal bundle
// (18 Sep 2026); NOT yet verified against live data because Orbit's
// backend project was unreachable at build time (DNS did not resolve).
// Built to the documented schema so it is ready the moment Orbit
// restores service; until then the status monitor reports it "down".
//
// Model (the good case for battery-swapping): the GPS device is paired
// to the VEHICLE (jbd_devices.vehicle_id), not the battery — so a bike's
// location follows the bike, not whichever battery is aboard.
//
// Data (Supabase PostgREST):
//   vehicles(id, registration_number, vehicle_model, assigned_rider_id)
//   jbd_devices(imei, name, status, lock_status, last_seen_at, vehicle_id)
//   jbd_gps_readings(imei, latitude, longitude, reading_time)   newest-first
//   jbd_bms_readings(rsoc, pack_voltage, discharge_switch, reading_time)
// Auth: Supabase password grant -> JWT; anon key is public (shipped in
// the portal frontend).

type OrbitConfig = {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
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

export class OrbitConnector implements TrackerConnector {
  readonly provider = "orbit";
  readonly label = "Orbit Fleet";
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: OrbitConfig) {}

  private async login() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.config.email, password: this.config.password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(`Orbit sign-in failed (${response.status}): ${data.error_description || data.msg || data.error || "no token"}`);
    }
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    return this.token.value;
  }

  private async rest(path: string) {
    const token = await this.login();
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: this.config.anonKey, Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Orbit REST ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    return response.json();
  }

  // Orbit is enumerable: devices resolve to our plate via the vehicles
  // table's registration_number, so plate-matching hooks them to the
  // roster like Car Tracker Nigeria.
  async listDevices(): Promise<TrackerDevice[]> {
    const [devices, vehicles] = await Promise.all([
      this.rest("jbd_devices?select=imei,name,status,lock_status,last_seen_at,vehicle_id"),
      this.rest("vehicles?select=id,registration_number,vehicle_model")
    ]);
    const plateByVehicle = new Map<string, string>(
      (vehicles as any[]).map((vehicle) => [String(vehicle.id), String(vehicle.registration_number || "")]));
    return (devices as any[])
      .filter((device) => device.imei)
      .map((device) => {
        const plate = plateByVehicle.get(String(device.vehicle_id)) || "";
        return {
          device_id: String(device.imei),
          // Name carries the plate so roster plate-matching finds it.
          name: plate ? `${plate} (${device.name || device.imei})` : String(device.name || device.imei),
          online: device.status ? String(device.status) : null,
          group: null,
          last_seen_at: device.last_seen_at ? String(device.last_seen_at) : null,
          raw: device
        };
      });
  }

  async dailyDistance(imei: string, date: string): Promise<TrackerDailyDistance> {
    const rows = await this.rest(
      `jbd_gps_readings?imei=eq.${encodeURIComponent(imei)}`
      + `&reading_time=gte.${date}T00:00:00&reading_time=lte.${date}T23:59:59`
      + `&select=latitude,longitude,reading_time&order=reading_time.asc`);
    const valid = (rows as any[]).filter((point) =>
      Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)));
    let distance = 0;
    for (let index = 1; index < valid.length; index++) {
      const leg = haversineKm(
        Number(valid[index - 1].latitude), Number(valid[index - 1].longitude),
        Number(valid[index].latitude), Number(valid[index].longitude));
      if (leg <= 2) distance += leg; // skip GPS-noise jumps
    }
    return {
      device_id: imei,
      record_date: date,
      distance_km: valid.length < 2 ? (rows.length ? 0 : null) : Math.round(distance * 100) / 100,
      raw: { derived: "haversine_over_gps_trace", points: (rows as any[]).length, valid_points: valid.length }
    };
  }

  async latestPositions(imeis: string[]): Promise<TrackerPosition[]> {
    if (!imeis.length) return [];
    const inList = imeis.map((imei) => encodeURIComponent(imei)).join(",");
    // Newest reading per imei; PostgREST returns them ordered, we keep the
    // first seen per imei.
    const [gps, bms] = await Promise.all([
      this.rest(`jbd_gps_readings?imei=in.(${inList})&select=imei,latitude,longitude,reading_time&order=reading_time.desc`),
      this.rest(`jbd_bms_readings?imei=in.(${inList})&select=imei,rsoc,discharge_switch,reading_time&order=reading_time.desc`).catch(() => [])
    ]);
    const latestBms = new Map<string, any>();
    for (const row of bms as any[]) if (!latestBms.has(String(row.imei))) latestBms.set(String(row.imei), row);
    const seen = new Set<string>();
    const positions: TrackerPosition[] = [];
    for (const point of gps as any[]) {
      const imei = String(point.imei);
      if (seen.has(imei)) continue;
      seen.add(imei);
      const battery = latestBms.get(imei);
      positions.push({
        device_id: imei,
        lat: Number(point.latitude),
        lng: Number(point.longitude),
        speed_kmh: null, // Orbit GPS readings carry no speed; movement inferred elsewhere
        heading: null,
        at: point.reading_time ? String(point.reading_time) : null,
        battery_sn: null,
        battery_state: battery
          ? (Number(battery.discharge_switch) === 0 ? "locked" : `charge ${Math.round(Number(battery.rsoc))}%`)
          : null,
        raw: { gps: point, bms: battery || null }
      });
    }
    return positions;
  }

  // Remote lock via the portal's JBD gateway (charge/discharge). command
  // 0 = cut discharge (lock), 1 = allow discharge (unlock).
  async controlBattery(imei: string, command: 0 | 1): Promise<TrackerControlResult> {
    const token = await this.login();
    const response = await fetch(`${this.config.supabaseUrl}/functions/v1/jbd-api-gateway?endpoint=execute`, {
      method: "POST",
      headers: { apikey: this.config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: 17, imei, sn: "", charge: 1, discharge: command, content: "STATUS#" })
    });
    const data = await response.json().catch(() => ({}));
    const ok = response.ok && Number(data.code) === 200;
    return {
      ok,
      result_code: data.code ?? response.status,
      result_detail: String(data.message || data.error || (ok ? "success" : "command failed")),
      command_results: data.data ?? null
    };
  }

  async healthCheck(): Promise<TrackerHealth> {
    const started = Date.now();
    try {
      await this.login();
      // A trivial authenticated read confirms the data plane too.
      await this.rest("jbd_devices?select=imei&limit=1");
      return { status: "ok", detail: "Signed in; device data reachable.", latency_ms: Date.now() - started };
    } catch (error: any) {
      const message = String(error?.message || error);
      // Distinguish "provider down" (DNS/connection) from "auth rejected".
      const down = /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network|timed out/i.test(message);
      return {
        status: down ? "down" : "degraded",
        detail: down ? "Orbit backend unreachable (provider outage)." : `Reachable but sign-in failed: ${message.slice(0, 120)}`,
        latency_ms: Date.now() - started
      };
    }
  }
}
