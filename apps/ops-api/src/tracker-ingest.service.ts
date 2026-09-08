import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { createTrackerConnector } from "./connectors/tracker.factory.js";
import type { TrackerConnector, TrackerDevice } from "./connectors/tracker.types.js";

// Captures tracker distances into ops_tracker_daily_records EVERY DAY.
// The vendor cannot be trusted to serve past days at all (users cannot
// see history in its frontend), so FlexiMOS must become the system of
// record through SAME-DAY capture: hourly upserts 07:00-22:00 keep
// today's figure fresh (a partial-day failure still leaves the latest
// snapshot), 23:30 finalises the day, and 00:10 re-reads yesterday once
// while it is still within reach. The nightly backfill sweep is a
// best-effort bonus only — nothing depends on the vendor serving
// history.

const normalizePlate = (value: string) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const recordId = () => `trackrec_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
const isoDate = (value: unknown) => {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException("record_date must be YYYY-MM-DD.");
  return text;
};

@Injectable()
export class TrackerIngestService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService
  ) {}

  connector(): TrackerConnector | null {
    return createTrackerConnector();
  }

  private matchVehicle(device: TrackerDevice, vehicles: any[]) {
    const byDeviceId = vehicles.find((vehicle) => String(vehicle.tracker_device_id || "") === device.device_id);
    if (byDeviceId) return { vehicle: byDeviceId, matched_by: "device_id" };
    const deviceName = normalizePlate(device.name);
    const byPlate = vehicles.find((vehicle) => {
      const plate = normalizePlate(vehicle.plate);
      return plate && deviceName.includes(plate);
    });
    if (byPlate) return { vehicle: byPlate, matched_by: "plate" };
    return null;
  }

  async deviceInventory() {
    const connector = this.connector();
    if (!connector) {
      return { configured: false, provider: null, device_count: 0, mapped_count: 0, devices: [] };
    }
    const [devices, vehicles] = await Promise.all([
      connector.listDevices(),
      this.db.many<any>("SELECT vehicle_id, plate, vehicle_type, status, tracker_device_id FROM ops_vehicles")
    ]);
    const rows = devices.map((device) => {
      const match = this.matchVehicle(device, vehicles);
      return {
        device_id: device.device_id,
        name: device.name,
        online: device.online,
        group: device.group,
        last_seen_at: device.last_seen_at,
        vehicle_id: match?.vehicle.vehicle_id || null,
        vehicle_plate: match?.vehicle.plate || null,
        matched_by: match?.matched_by || null
      };
    });
    return {
      configured: true,
      provider: connector.provider,
      device_count: rows.length,
      mapped_count: rows.filter((row) => row.vehicle_id).length,
      devices: rows
    };
  }

  // Plate matches become durable device-id mappings so renames at the
  // vendor cannot silently unhook a vehicle later.
  private async persistMapping(vehicle: any, deviceId: string) {
    if (String(vehicle.tracker_device_id || "") === deviceId) return;
    await this.db.exec(
      "UPDATE ops_vehicles SET tracker_device_id=$2, updated_at=$3 WHERE vehicle_id=$1",
      [vehicle.vehicle_id, deviceId, new Date().toISOString()]
    );
    await this.ops.audit("vehicle.tracker_mapped", "vehicle", vehicle.vehicle_id,
      { tracker_device_id: vehicle.tracker_device_id || null },
      { tracker_device_id: deviceId, matched_by: "plate" });
  }

  private async upsertRecord(vehicleId: string, deviceId: string, date: string, distanceKm: number, raw: unknown, source: string) {
    await this.db.exec(
      `INSERT INTO ops_tracker_daily_records
        (tracker_record_id, vehicle_id, tracker_account_id, record_date, actual_distance_km,
         data_quality, raw_payload, source, ingested_at)
       VALUES ($1,$2,$3,$4,$5,'authoritative',$6,$7,$8)
       ON CONFLICT (vehicle_id, record_date) DO UPDATE SET
        actual_distance_km = EXCLUDED.actual_distance_km,
        tracker_account_id = EXCLUDED.tracker_account_id,
        raw_payload = EXCLUDED.raw_payload,
        source = EXCLUDED.source,
        ingested_at = EXCLUDED.ingested_at`,
      [recordId(), vehicleId, deviceId, date, distanceKm, raw, source, new Date().toISOString()]
    );
  }

  /** Capture the given day for every mapped device (upsert — reruns refresh the figure). */
  async ingestDaily(date: string) {
    const connector = this.connector();
    if (!connector) throw new Error("No tracker connector is configured (set CARTRACKER_EMAIL / CARTRACKER_PASSWORD).");
    const inventory = await this.deviceInventory();
    const vehicles = await this.db.many<any>("SELECT vehicle_id, plate, tracker_device_id FROM ops_vehicles");
    let received = 0, upserted = 0, rejected = 0;
    for (const device of inventory.devices) {
      if (!device.vehicle_id) { rejected++; continue; }
      if (device.matched_by === "plate") {
        const vehicle = vehicles.find((row) => row.vehicle_id === device.vehicle_id);
        if (vehicle) await this.persistMapping(vehicle, device.device_id);
      }
      received++;
      const reading = await connector.dailyDistance(device.device_id, date);
      if (reading.distance_km === null) { rejected++; continue; }
      await this.upsertRecord(device.vehicle_id, device.device_id, date, reading.distance_km, reading.raw, `live:${connector.provider}`);
      upserted++;
    }
    await this.ops.audit("tracker.daily_ingested", "tracker_daily_record", date, null,
      { date, provider: connector.provider, devices: inventory.device_count, mapped: inventory.mapped_count, upserted, rejected });
    return { received, upserted, rejected };
  }

  /** Fill any missing vehicle-day over the trailing window — the safety
      net that guarantees history survives even if a day's runs failed. */
  async backfillMissing(endDate: string, days = 7) {
    const connector = this.connector();
    if (!connector) throw new Error("No tracker connector is configured (set CARTRACKER_EMAIL / CARTRACKER_PASSWORD).");
    const inventory = await this.deviceInventory();
    const mapped = inventory.devices.filter((device) => device.vehicle_id);
    let received = 0, upserted = 0, rejected = 0;
    for (let offset = 1; offset <= days; offset++) {
      const day = new Date(`${endDate}T00:00:00`);
      day.setDate(day.getDate() - offset);
      const date = day.toISOString().slice(0, 10);
      const existing = await this.db.many<any>(
        "SELECT vehicle_id FROM ops_tracker_daily_records WHERE record_date=$1", [date]
      );
      const have = new Set(existing.map((row) => row.vehicle_id));
      for (const device of mapped) {
        if (have.has(device.vehicle_id)) continue;
        received++;
        const reading = await connector.dailyDistance(device.device_id, date);
        if (reading.distance_km === null) { rejected++; continue; }
        await this.upsertRecord(device.vehicle_id!, device.device_id, date, reading.distance_km, reading.raw, `backfill:${connector.provider}`);
        upserted++;
      }
    }
    return { received, upserted, rejected };
  }

  async listRecords(filters: { date_from?: string; date_to?: string }) {
    const { from, to } = this.ops.dateRange(filters);
    return this.db.many(
      `SELECT t.*, v.plate, v.vehicle_type
       FROM ops_tracker_daily_records t JOIN ops_vehicles v ON v.vehicle_id = t.vehicle_id
       WHERE t.record_date BETWEEN $1 AND $2
       ORDER BY t.record_date DESC, v.plate ASC`,
      [from, to]
    );
  }

  async manualRecord(body: Record<string, unknown>, actorPersonId: string) {
    for (const field of ["vehicle_id", "record_date", "actual_distance_km"]) {
      if (body[field] === undefined || body[field] === "") throw new BadRequestException(`${field} is required.`);
    }
    const distance = Number(body.actual_distance_km);
    if (!(distance >= 0)) throw new BadRequestException("actual_distance_km must be zero or positive.");
    await this.upsertRecord(
      String(body.vehicle_id),
      String(body.tracker_account_id || ""),
      isoDate(body.record_date),
      Math.round(distance * 100) / 100,
      { manual: true, notes: body.notes || null },
      "manual"
    );
    const saved = await this.db.one<any>(
      "SELECT * FROM ops_tracker_daily_records WHERE vehicle_id=$1 AND record_date=$2",
      [String(body.vehicle_id), isoDate(body.record_date)]
    );
    await this.ops.audit("tracker.manual_record", "tracker_daily_record", saved.tracker_record_id, null, saved, actorPersonId);
    return saved;
  }
}
