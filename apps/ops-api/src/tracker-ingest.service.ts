import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { createTrackerConnectors } from "./connectors/tracker.factory.js";
import type { TrackerConnector, TrackerDevice } from "./connectors/tracker.types.js";

// Captures tracker distances into ops_tracker_daily_records EVERY DAY.
// The vendors cannot be trusted to serve past days at all (users cannot
// see history in their frontends), so FlexiMOS must become the system of
// record through SAME-DAY capture: hourly upserts 07:00-22:00 keep
// today's figure fresh (a partial-day failure still leaves the latest
// snapshot), 23:30 finalises the day, and 00:10 re-reads yesterday once
// while it is still within reach. The nightly backfill sweep is a
// best-effort bonus only — nothing depends on a vendor serving history.
//
// Several connectors run side by side (Qutes on Car Tracker Nigeria,
// EV bikes on Tankvolt). Vendors that can enumerate devices are mapped
// automatically by plate; registered-only vendors (Tankvolt) take their
// device list FROM the roster (vehicles carrying that provider's ids).

const normalizePlate = (value: string) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const recordId = (prefix = "trackrec") => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
const isoDate = (value: unknown) => {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException("record_date must be YYYY-MM-DD.");
  return text;
};

type InventoryDevice = {
  provider: string;
  device_id: string;
  name: string;
  online: string | null;
  group: string | null;
  last_seen_at: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  matched_by: string | null;
};

@Injectable()
export class TrackerIngestService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService
  ) {}

  connectors(): TrackerConnector[] {
    return createTrackerConnectors();
  }

  private matchVehicle(device: TrackerDevice, vehicles: any[], provider: string) {
    const byDeviceId = vehicles.find((vehicle) =>
      String(vehicle.tracker_device_id || "") === device.device_id
      && (!vehicle.tracker_provider || vehicle.tracker_provider === provider));
    if (byDeviceId) return { vehicle: byDeviceId, matched_by: "device_id" };
    const deviceName = normalizePlate(device.name);
    const byPlate = vehicles.find((vehicle) => {
      const plate = normalizePlate(vehicle.plate);
      return plate && deviceName.includes(plate) && !vehicle.tracker_device_id;
    });
    if (byPlate) return { vehicle: byPlate, matched_by: "plate" };
    return null;
  }

  private async connectorDevices(connector: TrackerConnector, vehicles: any[]): Promise<InventoryDevice[]> {
    if (connector.registeredOnly) {
      // The roster IS the device list for this vendor.
      return vehicles
        .filter((vehicle) => vehicle.tracker_provider === connector.provider && vehicle.tracker_device_id)
        .map((vehicle) => ({
          provider: connector.provider,
          device_id: String(vehicle.tracker_device_id),
          name: `${vehicle.plate} (${vehicle.tracker_device_id})`,
          online: null,
          group: null,
          last_seen_at: null,
          vehicle_id: vehicle.vehicle_id,
          vehicle_plate: vehicle.plate,
          matched_by: "registered"
        }));
    }
    const devices = await connector.listDevices();
    return devices.map((device) => {
      const match = this.matchVehicle(device, vehicles, connector.provider);
      return {
        provider: connector.provider,
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
  }

  async deviceInventory() {
    const connectors = this.connectors();
    if (!connectors.length) {
      return { configured: false, provider: null, providers: [], device_count: 0, mapped_count: 0, devices: [] };
    }
    const vehicles = await this.db.many<any>(
      "SELECT vehicle_id, plate, vehicle_type, status, tracker_device_id, tracker_provider FROM ops_vehicles");
    const devices: InventoryDevice[] = [];
    for (const connector of connectors) {
      devices.push(...await this.connectorDevices(connector, vehicles));
    }
    return {
      configured: true,
      provider: connectors.map((connector) => connector.provider).join(" + "),
      providers: connectors.map((connector) => connector.provider),
      device_count: devices.length,
      mapped_count: devices.filter((device) => device.vehicle_id).length,
      devices
    };
  }

  // Plate matches become durable device-id mappings so renames at the
  // vendor cannot silently unhook a vehicle later.
  private async persistMapping(vehicle: any, deviceId: string, provider: string) {
    if (String(vehicle.tracker_device_id || "") === deviceId && vehicle.tracker_provider === provider) return;
    await this.db.exec(
      "UPDATE ops_vehicles SET tracker_device_id=$2, tracker_provider=$3, updated_at=$4 WHERE vehicle_id=$1",
      [vehicle.vehicle_id, deviceId, provider, new Date().toISOString()]
    );
    await this.ops.audit("vehicle.tracker_mapped", "vehicle", vehicle.vehicle_id,
      { tracker_device_id: vehicle.tracker_device_id || null },
      { tracker_device_id: deviceId, tracker_provider: provider, matched_by: "plate" });
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

  private requireConnectors() {
    const connectors = this.connectors();
    if (!connectors.length) {
      throw new Error("No tracker connector is configured (set CARTRACKER_* / TANKVOLT_* environment variables).");
    }
    return connectors;
  }

  /** Capture the given day for every mapped device on every connector
      (upsert — reruns refresh the figure). */
  async ingestDaily(date: string) {
    const connectors = this.requireConnectors();
    const vehicles = await this.db.many<any>(
      "SELECT vehicle_id, plate, vehicle_type, status, tracker_device_id, tracker_provider FROM ops_vehicles");
    let received = 0, upserted = 0, rejected = 0;
    for (const connector of connectors) {
      const devices = await this.connectorDevices(connector, vehicles);
      for (const device of devices) {
        if (!device.vehicle_id) { rejected++; continue; }
        if (device.matched_by === "plate") {
          const vehicle = vehicles.find((row) => row.vehicle_id === device.vehicle_id);
          if (vehicle) await this.persistMapping(vehicle, device.device_id, connector.provider);
        }
        received++;
        const reading = await connector.dailyDistance(device.device_id, date);
        if (reading.distance_km === null) { rejected++; continue; }
        await this.upsertRecord(device.vehicle_id, device.device_id, date, reading.distance_km, reading.raw, `live:${connector.provider}`);
        upserted++;
      }
    }
    await this.ops.audit("tracker.daily_ingested", "tracker_daily_record", date, null,
      { date, providers: connectors.map((connector) => connector.provider), upserted, rejected });
    return { received, upserted, rejected };
  }

  /** Fill any missing vehicle-day over the trailing window — best-effort
      only; vendors may refuse history, and nothing depends on this. */
  async backfillMissing(endDate: string, days = 7) {
    const connectors = this.requireConnectors();
    const vehicles = await this.db.many<any>(
      "SELECT vehicle_id, plate, vehicle_type, status, tracker_device_id, tracker_provider FROM ops_vehicles");
    let received = 0, upserted = 0, rejected = 0;
    for (const connector of connectors) {
      const mapped = (await this.connectorDevices(connector, vehicles)).filter((device) => device.vehicle_id);
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
    }
    return { received, upserted, rejected };
  }

  /* ---------- live positions (map view) ---------- */

  private positionsCache: { at: number; rows: any[] } | null = null;

  /** Latest position per mapped vehicle across every connector that can
      report positions. Cached for 60s to protect vendor rate limits. */
  async vehiclePositions(scope: OpsDataScope = {}) {
    const rowsOut = await this.allVehiclePositions();
    if (scope.unrestricted || (!scope.supervisor_person_id && !scope.amoeba_ids?.length)) return rowsOut;
    const allowed = (row: any) =>
      (scope.supervisor_person_id && row.supervisor_person_id === scope.supervisor_person_id)
      || (scope.amoeba_ids?.length && scope.amoeba_ids.includes(row.amoeba_id));
    const [payload] = rowsOut;
    return [{
      positions: payload.positions.filter(allowed),
      no_feed: payload.no_feed.filter(allowed)
    }];
  }

  private async allVehiclePositions() {
    if (this.positionsCache && Date.now() - this.positionsCache.at < 60_000) {
      return this.positionsCache.rows;
    }
    const connectors = this.connectors();
    const vehicles = await this.db.many<any>(
      `SELECT v.vehicle_id, v.plate, v.vehicle_type, v.status, v.tracker_device_id, v.tracker_provider,
              v.amoeba_id, o.operator_id, o.person_id, o.supervisor_person_id
       FROM ops_vehicles v
       LEFT JOIN ops_operators o ON o.vehicle_id = v.vehicle_id AND o.operator_status = 'active'`);
    const rows: any[] = [];
    const positioned = new Set<string>();
    for (const connector of connectors) {
      if (!connector.latestPositions) continue;
      const devices = await this.connectorDevices(connector, vehicles);
      const mapped = new Map(devices.filter((device) => device.vehicle_id)
        .map((device) => [device.device_id, device]));
      const positions = await connector.latestPositions([...mapped.keys()]);
      for (const position of positions) {
        const device = mapped.get(position.device_id);
        if (!device) continue;
        const vehicle = vehicles.find((row) => row.vehicle_id === device.vehicle_id);
        if (!vehicle || positioned.has(vehicle.vehicle_id)) continue;
        positioned.add(vehicle.vehicle_id);
        const ageMinutes = position.at ? Math.round((Date.now() - new Date(position.at.replace(" ", "T")).getTime()) / 60000) : null;
        rows.push({
          vehicle_id: vehicle.vehicle_id,
          plate: vehicle.plate,
          vehicle_type: vehicle.vehicle_type,
          amoeba_id: vehicle.amoeba_id,
          operator_id: vehicle.operator_id || null,
          person_id: vehicle.person_id || null,
          supervisor_person_id: vehicle.supervisor_person_id || null,
          provider: connector.provider,
          lat: position.lat,
          lng: position.lng,
          speed_kmh: position.speed_kmh,
          heading: position.heading,
          position_at: position.at,
          position_age_minutes: ageMinutes !== null && ageMinutes >= 0 ? ageMinutes : null,
          battery_sn: position.battery_sn,
          battery_state: position.battery_state,
          movement: position.speed_kmh !== null && position.speed_kmh > 3 ? "moving"
            : ageMinutes !== null && ageMinutes > 60 ? "stale" : "idle",
          controllable: Boolean(connector.controlBattery)
        });
      }
    }
    // Honesty list: active vehicles with no position feed.
    const noFeed = vehicles
      .filter((vehicle) => vehicle.status === "active" && !positioned.has(vehicle.vehicle_id))
      .map((vehicle) => ({
        vehicle_id: vehicle.vehicle_id,
        plate: vehicle.plate,
        vehicle_type: vehicle.vehicle_type,
        amoeba_id: vehicle.amoeba_id,
        operator_id: vehicle.operator_id || null,
        person_id: vehicle.person_id || null,
        supervisor_person_id: vehicle.supervisor_person_id || null,
        provider: vehicle.tracker_provider || null,
        reason: vehicle.tracker_device_id ? "no recent position from the tracker" : "no tracker fitted"
      }));
    const result = [{ positions: rows, no_feed: noFeed }];
    this.positionsCache = { at: Date.now(), rows: result };
    return result;
  }

  /* ---------- remote battery control (Tankvolt v1) ---------- */

  async controlBattery(vehicleId: string, body: Record<string, unknown>, actorPersonId: string, scope: OpsDataScope = {}) {
    const command = Number(body.command);
    if (![0, 1].includes(command)) throw new BadRequestException("command must be 0 (power off) or 1 (power on).");
    const reason = String(body.reason || "").trim();
    if (!reason) throw new BadRequestException("reason is required — every remote power command is audited.");
    const vehicle = await this.db.one<any>("SELECT * FROM ops_vehicles WHERE vehicle_id=$1", [vehicleId]);
    if (!vehicle) throw new NotFoundException("Vehicle not found.");
    if (!scope.unrestricted) {
      // A supervisor can only command vehicles inside their own team.
      const operator = await this.db.one<any>(
        "SELECT supervisor_person_id, amoeba_id FROM ops_operators WHERE vehicle_id=$1 AND operator_status='active'", [vehicleId]);
      const inTeam = (scope.supervisor_person_id && operator?.supervisor_person_id === scope.supervisor_person_id)
        || (scope.amoeba_ids?.length && scope.amoeba_ids.includes(operator?.amoeba_id || vehicle.amoeba_id));
      if (!inTeam) throw new ForbiddenException("This vehicle is outside your team scope.");
    }
    // Resolve the device the same way the map does (persisted id or
    // plate match), so control works as soon as the vehicle is visible.
    const allVehicles = await this.db.many<any>(
      "SELECT vehicle_id, plate, vehicle_type, status, tracker_device_id, tracker_provider FROM ops_vehicles");
    let connector = null as TrackerConnector | null;
    let deviceId: string | null = null;
    for (const candidate of this.connectors()) {
      if (!candidate.controlBattery) continue;
      const devices = await this.connectorDevices(candidate, allVehicles);
      const device = devices.find((item) => item.vehicle_id === vehicleId);
      if (device) { connector = candidate; deviceId = device.device_id; break; }
    }
    if (!connector || !deviceId) throw new BadRequestException("This vehicle has no controllable tracker.");

    const stolenOverride = body.stolen_override === true;
    if (command === 0 && !stolenOverride && connector.latestPositions) {
      // Safety interlock: never cut power under a moving rider unless the
      // vehicle is explicitly declared stolen (override, still audited).
      const positions = await connector.latestPositions([deviceId]);
      const latest = positions.find((position) => position.device_id === deviceId);
      const ageMinutes = latest?.at ? (Date.now() - new Date(latest.at.replace(" ", "T")).getTime()) / 60000 : null;
      if (latest && latest.speed_kmh !== null && latest.speed_kmh > 5 && ageMinutes !== null && ageMinutes <= 10) {
        throw new ConflictException(
          `Blocked: ${vehicle.plate} is moving (${latest.speed_kmh} km/h ${Math.round(ageMinutes)} min ago). ` +
          "Cutting power under a rider is dangerous. Tick the stolen-vehicle override only if the bike is genuinely stolen."
        );
      }
    }

    const result = await connector.controlBattery!(deviceId, command as 0 | 1);
    const action = {
      control_action_id: recordId("vctrl"),
      vehicle_id: vehicleId,
      provider: connector.provider,
      command: command === 0 ? "power_off" : "power_on",
      reason,
      stolen_override: stolenOverride,
      requested_by_person_id: actorPersonId,
      result_code: result.result_code,
      result_detail: result.result_detail,
      command_results: result.command_results,
      succeeded: result.ok,
      created_at: new Date().toISOString()
    };
    await this.db.exec(
      `INSERT INTO ops_vehicle_control_actions
        (control_action_id, vehicle_id, provider, command, reason, stolen_override,
         requested_by_person_id, result_code, result_detail, command_results, succeeded, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      Object.values(action)
    );
    await this.ops.audit(`vehicle.${action.command}`, "vehicle_control_action", action.control_action_id, null, action, actorPersonId);
    return action;
  }

  async listControlActions() {
    return this.db.many(
      `SELECT a.*, v.plate, v.vehicle_type
       FROM ops_vehicle_control_actions a JOIN ops_vehicles v ON v.vehicle_id = a.vehicle_id
       ORDER BY a.created_at DESC LIMIT 100`);
  }

  /* ---------- stored records ---------- */

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
