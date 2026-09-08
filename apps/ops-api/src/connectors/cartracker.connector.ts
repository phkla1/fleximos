import type { TrackerConnector, TrackerDailyDistance, TrackerDevice } from "./tracker.types.js";

// Car Tracker Nigeria (cartracker.com.ng — a GPSWOX-style platform).
// Auth: POST /login (form fields email/password) → user_api_hash, which
// every subsequent call carries as a query parameter. The hash is cached
// and refreshed once on an auth failure.

type CartrackerConfig = {
  baseUrl: string;
  email: string;
  password: string;
};

async function responseJson(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function retry<T>(factory: () => Promise<T>, attempts = 3) {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await factory(); } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** (attempt - 1))));
    }
  }
  throw last;
}

export class CartrackerConnector implements TrackerConnector {
  readonly provider = "cartracker";
  private hash: string | null = null;

  constructor(private readonly config: CartrackerConfig) {}

  private async login() {
    const body = new FormData();
    body.set("email", this.config.email);
    body.set("password", this.config.password);
    const data = await responseJson(
      await fetch(`${this.config.baseUrl}/login`, { method: "POST", body }),
      "Cartracker login"
    );
    if (Number(data.status) !== 1 || !data.user_api_hash) {
      throw new Error("Cartracker login rejected the configured credentials.");
    }
    this.hash = String(data.user_api_hash);
    return this.hash;
  }

  private async get(path: string, params: Record<string, string>) {
    const call = async () => {
      const hash = this.hash || await this.login();
      const query = new URLSearchParams({ lang: "en", user_api_hash: hash, ...params });
      const response = await fetch(`${this.config.baseUrl}${path}?${query}`);
      // An expired hash comes back as 401 — drop it and let the retry
      // wrapper log in again.
      if (response.status === 401) {
        this.hash = null;
        throw new Error(`Cartracker ${path} auth expired.`);
      }
      return responseJson(response, `Cartracker ${path}`);
    };
    return retry(call);
  }

  async listDevices(): Promise<TrackerDevice[]> {
    const groups = await this.get("/get_devices", {});
    const devices: TrackerDevice[] = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const item of group.items || []) {
        devices.push({
          device_id: String(item.id),
          name: String(item.name || item.id),
          online: item.online === undefined ? null : String(item.online),
          group: group.title ? String(group.title) : null,
          last_seen_at: item.time ? String(item.time) : null,
          raw: item
        });
      }
    }
    return devices;
  }

  async dailyDistance(deviceId: string, date: string): Promise<TrackerDailyDistance> {
    const history = await this.get("/get_history", {
      device_id: deviceId,
      from_date: date,
      from_time: "00:00",
      to_date: date,
      to_time: "23:59"
    });
    // distance_sum arrives as a string such as "42.7" (km).
    const distance = Number(String(history.distance_sum ?? "").replace(/[^\d.]/g, ""));
    return {
      device_id: deviceId,
      record_date: date,
      distance_km: Number.isFinite(distance) ? Math.round(distance * 100) / 100 : null,
      raw: {
        distance_sum: history.distance_sum ?? null,
        move_duration: history.move_duration ?? null,
        stop_duration: history.stop_duration ?? null,
        top_speed: history.top_speed ?? null
      }
    };
  }
}
