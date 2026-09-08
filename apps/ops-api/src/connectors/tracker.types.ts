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

export interface TrackerConnector {
  /** Human label used in provenance and admin surfaces. */
  readonly provider: string;
  listDevices(): Promise<TrackerDevice[]>;
  dailyDistance(deviceId: string, date: string): Promise<TrackerDailyDistance>;
}
