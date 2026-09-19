// Vendor-neutral tracker contract. Anything that can list devices and
// report a day's distance per device can back FlexiMOS mileage — swap
// implementations in tracker.factory.ts without touching ingestion,
// reconciliation, or the consoles.

export type TrackerDevice = {
  device_id: string;
  name: string;
  online: string | null;
  group: string | null;
  last_seen_at: string | null;
  raw: unknown;
};

export type TrackerDailyDistance = {
  device_id: string;
  record_date: string;
  distance_km: number | null;
  raw: unknown;
};

export type TrackerPosition = {
  device_id: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  heading: number | null;
  at: string | null;
  battery_sn: string | null;
  battery_state: string | null;
  raw: unknown;
};

export type TrackerControlResult = {
  ok: boolean;
  result_code: number | null;
  result_detail: string;
  command_results: unknown;
};

export type TrackerHealth = {
  // ok = reachable and authenticated; degraded = reachable but the
  // credentials/service aren't fully provisioned (e.g. key not enabled);
  // down = unreachable.
  status: "ok" | "degraded" | "down";
  detail: string;
  latency_ms: number | null;
};

export interface TrackerConnector {
  /** Human label used in provenance and admin surfaces. */
  readonly provider: string;
  /** Display label for status surfaces (defaults to provider). */
  readonly label?: string;
  /** True when the vendor cannot enumerate devices — the fleet roster
      (vehicles with this provider's tracker ids) IS the device list. */
  readonly registeredOnly?: boolean;
  listDevices(): Promise<TrackerDevice[]>;
  dailyDistance(deviceId: string, date: string): Promise<TrackerDailyDistance>;
  /** Latest known position per device, where the vendor provides it.
      deviceIds is a hint for vendors that must be asked per device. */
  latestPositions?(deviceIds: string[]): Promise<TrackerPosition[]>;
  /** Remote battery power control (0 = off, 1 = on), where supported. */
  controlBattery?(deviceId: string, command: 0 | 1): Promise<TrackerControlResult>;
  /** Cheap reachability + auth probe for the status monitor. */
  healthCheck?(): Promise<TrackerHealth>;
}
