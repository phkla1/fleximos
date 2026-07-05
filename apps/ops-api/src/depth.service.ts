import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";

type RecordBody = Record<string, unknown>;

const deviationReasonCodes = [
  "network_app_issue",
  "vehicle_fault",
  "fuel_charging_problem",
  "platform_account_blocked",
  "personal_emergency",
  "other"
];

const incidentTypes: Record<string, string> = {
  accident: "high",
  police: "high",
  breakdown: "normal",
  fuel_funds: "normal",
  low_battery: "normal",
  other: "normal"
};

const maintenanceCategories = ["tyres", "brakes", "engine", "electrical", "body_damage", "other"];
const expenseCategories = ["fuel", "maintenance", "rent", "salaries", "utilities", "overhead", "other"];
const mediaContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);

@Injectable()
export class DepthService {
  private readonly mediaDir =
    process.env.FLEXI_OPS_MEDIA_DIR || `${process.env.FLEXI_OPS_DB_DIR || ".data/ops-pglite"}-media`;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService
  ) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }

  private now() {
    return new Date().toISOString();
  }

  private date(value: unknown, field = "record_date") {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date.`);
    }
    return text;
  }

  private amount(value: unknown, field: string) {
    const result = Number(value ?? NaN);
    if (!Number.isFinite(result) || result < 0) throw new BadRequestException(`${field} must be a non-negative number.`);
    return result;
  }

  private operatorScopeClause(clauses: string[], params: unknown[], scope: OpsDataScope, alias = "o") {
    if (scope.unrestricted) return;
    const visible: string[] = [];
    if (scope.person_id) {
      params.push(scope.person_id);
      visible.push(`${alias}.person_id = $${params.length}`);
    }
    if (scope.supervisor_person_id) {
      params.push(scope.supervisor_person_id);
      visible.push(`${alias}.supervisor_person_id = $${params.length}`);
    }
    for (const [field, values] of [
      ["amoeba_id", scope.amoeba_ids],
      ["site_id", scope.site_ids],
      ["supervisor_person_id", scope.supervisor_person_ids]
    ] as const) {
      if (values?.length) {
        const placeholders = values.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        visible.push(`${alias}.${field} IN (${placeholders.join(", ")})`);
      }
    }
    clauses.push(visible.length ? `(${visible.join(" OR ")})` : "FALSE");
  }

  private amoebaScopeClause(clauses: string[], params: unknown[], scope: OpsDataScope, column: string) {
    if (scope.unrestricted) return;
    if (scope.amoeba_ids?.length) {
      const placeholders = scope.amoeba_ids.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      clauses.push(`${column} IN (${placeholders.join(", ")})`);
      return;
    }
    if (scope.supervisor_person_id || scope.supervisor_person_ids?.length || scope.site_ids?.length || scope.person_id) {
      const inner: string[] = [];
      this.operatorScopeClause(inner, params, scope, "so");
      clauses.push(`${column} IN (SELECT so.amoeba_id FROM ops_operators so WHERE ${inner.join(" AND ") || "TRUE"})`);
      return;
    }
    clauses.push("FALSE");
  }

  // ---------------------------------------------------------------- media

  async createMedia(body: RecordBody, actorPersonId: string) {
    const contentType = String(body.content_type || "");
    if (!mediaContentTypes.has(contentType)) {
      throw new BadRequestException(`content_type must be one of: ${[...mediaContentTypes].join(", ")}.`);
    }
    const base64 = String(body.content_base64 || "");
    if (!base64) throw new BadRequestException("content_base64 is required.");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      throw new BadRequestException("content_base64 is not valid base64.");
    }
    if (!bytes.length) throw new BadRequestException("content_base64 decodes to an empty file.");
    if (bytes.length > 3 * 1024 * 1024) throw new BadRequestException("Media files are limited to 3MB after compression.");

    const capturedAt = new Date(String(body.captured_at || ""));
    if (Number.isNaN(capturedAt.getTime())) throw new BadRequestException("captured_at must be a valid timestamp.");
    const toleranceMinutes = Number(process.env.MEDIA_CAPTURE_TOLERANCE_MINUTES || 5);
    const driftMinutes = Math.abs(Date.now() - capturedAt.getTime()) / 60000;
    if (process.env.MEDIA_STRICT_CAPTURE === "true" && driftMinutes > toleranceMinutes) {
      throw new BadRequestException(
        `captured_at is ${Math.round(driftMinutes)} minutes from server time; camera captures must be uploaded within ${toleranceMinutes} minutes.`
      );
    }

    const gpsLat = body.gps_lat === undefined || body.gps_lat === null || body.gps_lat === "" ? null : Number(body.gps_lat);
    const gpsLng = body.gps_lng === undefined || body.gps_lng === null || body.gps_lng === "" ? null : Number(body.gps_lng);
    if (process.env.MEDIA_REQUIRE_GPS === "true" && (gpsLat === null || gpsLng === null)) {
      throw new BadRequestException("GPS coordinates are required for camera captures.");
    }

    const mediaId = this.id("media");
    const extension = contentType === "video/mp4" ? "mp4" : contentType.split("/")[1];
    const storagePath = `${mediaId}.${extension}`;
    mkdirSync(this.mediaDir, { recursive: true });
    writeFileSync(join(this.mediaDir, storagePath), bytes);

    const record = {
      media_id: mediaId,
      kind: String(body.kind || "evidence"),
      content_type: contentType,
      byte_size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      captured_at: capturedAt.toISOString(),
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      storage_path: storagePath,
      uploaded_by_person_id: actorPersonId,
      created_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_media_files
       (media_id, kind, content_type, byte_size, sha256, captured_at, gps_lat, gps_lng,
        storage_path, uploaded_by_person_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      Object.values(record)
    );
    await this.ops.audit("media.uploaded", "media", mediaId, null, { ...record, storage_path: undefined }, actorPersonId);
    const { storage_path: _path, ...visible } = record;
    return visible;
  }

  async getMedia(mediaId: string) {
    const media = await this.db.one<any>("SELECT * FROM ops_media_files WHERE media_id = $1", [mediaId]);
    if (!media) throw new NotFoundException("Media file not found.");
    return media;
  }

  async readMediaContent(mediaId: string) {
    const media = await this.getMedia(mediaId);
    try {
      return { media, bytes: readFileSync(join(this.mediaDir, media.storage_path)) };
    } catch {
      throw new NotFoundException("Media content is missing from storage.");
    }
  }

  private async mediaIds(value: unknown) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException("media_ids must be an array of media IDs.");
    for (const mediaId of value) await this.getMedia(String(mediaId));
    return value.map(String);
  }

  // ------------------------------------------------- deviation workflows

  deviationReasonCodes() {
    return deviationReasonCodes;
  }

  async submitDeviationReason(alertId: string, body: RecordBody, actorPersonId: string) {
    const alert = await this.ops.getAlert(alertId);
    if (alert.resolution_status === "resolved") {
      throw new ConflictException("A resolved alert can no longer receive a deviation reason.");
    }
    const code = String(body.reason_code || "");
    if (!deviationReasonCodes.includes(code)) {
      throw new BadRequestException(`reason_code must be one of: ${deviationReasonCodes.join(", ")}.`);
    }
    const note = body.note ? String(body.note).slice(0, 140) : null;
    if (code === "other" && !note) throw new BadRequestException("A short note is required when reason_code is 'other'.");
    await this.db.exec(
      `UPDATE ops_alerts SET
         deviation_reason_code = $2, deviation_reason_note = $3,
         deviation_submitted_at = $4, deviation_submitted_by_person_id = $5,
         deviation_review_status = 'pending',
         deviation_reviewed_at = NULL, deviation_reviewed_by_person_id = NULL, deviation_review_note = NULL
       WHERE alert_id = $1`,
      [alertId, code, note, this.now(), actorPersonId]
    );
    const updated = await this.ops.getAlert(alertId);
    await this.ops.audit("alert.deviation_reason_submitted", "alert", alertId, alert, updated, actorPersonId);
    return updated;
  }

  async reviewDeviationReason(alertId: string, body: RecordBody, actorPersonId: string) {
    const alert = await this.ops.getAlert(alertId);
    if (!alert.deviation_reason_code || alert.deviation_review_status !== "pending") {
      throw new ConflictException("This alert has no pending deviation reason to review.");
    }
    const decision = String(body.decision || "");
    if (!["accepted", "rejected"].includes(decision)) {
      throw new BadRequestException("decision must be 'accepted' or 'rejected'.");
    }
    await this.db.exec(
      `UPDATE ops_alerts SET deviation_review_status = $2,
         deviation_reviewed_at = $3, deviation_reviewed_by_person_id = $4, deviation_review_note = $5
       WHERE alert_id = $1`,
      [alertId, decision, this.now(), actorPersonId, body.note ? String(body.note) : null]
    );
    const updated = await this.ops.getAlert(alertId);
    await this.ops.audit(`alert.deviation_reason_${decision}`, "alert", alertId, alert, updated, actorPersonId);
    return updated;
  }

  async escalateAlert(alertId: string, body: RecordBody, actorPersonId: string) {
    const alert = await this.ops.getAlert(alertId);
    if (alert.resolution_status === "resolved") throw new ConflictException("A resolved alert cannot be escalated.");
    await this.db.exec(
      `UPDATE ops_alerts SET resolution_status = 'escalated',
         escalated_at = $2, escalated_by_person_id = $3, escalation_note = $4
       WHERE alert_id = $1`,
      [alertId, this.now(), actorPersonId, body.note ? String(body.note) : null]
    );
    const updated = await this.ops.getAlert(alertId);
    await this.ops.audit("alert.escalated", "alert", alertId, alert, updated, actorPersonId);
    return updated;
  }

  // ------------------------------------------------------------ incidents

  async listIncidents(filters: { status?: string; operator_id?: string; incident_type?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.push(value);
      clauses.push(`i.${key} = $${params.length}`);
    }
    this.operatorScopeClause(clauses, params, scope);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT i.*, o.person_id, o.amoeba_id, o.site_id, o.supervisor_person_id, v.plate AS vehicle_plate
       FROM ops_incidents i
       JOIN ops_operators o ON o.operator_id = i.operator_id
       LEFT JOIN ops_vehicles v ON v.vehicle_id = i.vehicle_id
       ${where}
       ORDER BY i.occurred_at DESC
       LIMIT 300`,
      params
    );
  }

  async createIncident(body: RecordBody, actorPersonId: string, scope: OpsDataScope = {}) {
    const operator: any = await this.ops.getOperator(String(body.operator_id || ""), scope);
    const incidentType = String(body.incident_type || "");
    if (!(incidentType in incidentTypes)) {
      throw new BadRequestException(`incident_type must be one of: ${Object.keys(incidentTypes).join(", ")}.`);
    }
    const mediaIds = await this.mediaIds(body.media_ids);
    if (incidentType === "accident" && !mediaIds.length && process.env.MEDIA_STRICT_CAPTURE === "true") {
      throw new BadRequestException("Accident reports require at least one camera capture.");
    }
    const timestamp = this.now();
    const incident = {
      incident_id: this.id("incident"),
      operator_id: operator.operator_id,
      vehicle_id: body.vehicle_id ? String(body.vehicle_id) : operator.vehicle_id || null,
      incident_type: incidentType,
      severity: incidentTypes[incidentType],
      description: body.description ? String(body.description).slice(0, 500) : null,
      gps_lat: body.gps_lat === undefined || body.gps_lat === null || body.gps_lat === "" ? null : Number(body.gps_lat),
      gps_lng: body.gps_lng === undefined || body.gps_lng === null || body.gps_lng === "" ? null : Number(body.gps_lng),
      media_ids: mediaIds,
      status: "open",
      reported_by_person_id: actorPersonId,
      occurred_at: body.occurred_at ? new Date(String(body.occurred_at)).toISOString() : timestamp,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_incidents
       (incident_id, operator_id, vehicle_id, incident_type, severity, description,
        gps_lat, gps_lng, media_ids, status, reported_by_person_id, occurred_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      Object.values(incident)
    );
    if (operator.supervisor_person_id) {
      await this.db.exec(
        `INSERT INTO ops_notification_deliveries
         (notification_delivery_id, alert_id, recipient_person_id, channel, payload, status, attempt, created_at, updated_at)
         VALUES ($1, NULL, $2, 'in_app', $3, 'pending', 0, $4, $4)`,
        [
          this.id("notification"),
          operator.supervisor_person_id,
          {
            event_type: "ops.incident.created",
            incident_id: incident.incident_id,
            operator_id: incident.operator_id,
            incident_type: incident.incident_type,
            severity: incident.severity
          },
          timestamp
        ]
      );
    }
    await this.ops.audit("incident.created", "incident", incident.incident_id, null, incident, actorPersonId);
    return incident;
  }

  private async getIncident(incidentId: string) {
    const incident = await this.db.one<any>("SELECT * FROM ops_incidents WHERE incident_id = $1", [incidentId]);
    if (!incident) throw new NotFoundException("Incident not found.");
    return incident;
  }

  async acknowledgeIncident(incidentId: string, actorPersonId: string) {
    const incident = await this.getIncident(incidentId);
    if (incident.status !== "open") throw new ConflictException("Only an open incident can be acknowledged.");
    await this.db.exec(
      `UPDATE ops_incidents SET status = 'acknowledged',
         acknowledged_at = $2, acknowledged_by_person_id = $3, updated_at = $2
       WHERE incident_id = $1`,
      [incidentId, this.now(), actorPersonId]
    );
    const updated = await this.getIncident(incidentId);
    await this.ops.audit("incident.acknowledged", "incident", incidentId, incident, updated, actorPersonId);
    return updated;
  }

  async resolveIncident(incidentId: string, body: RecordBody, actorPersonId: string) {
    if (!body.resolution_notes) throw new BadRequestException("resolution_notes is required.");
    const incident = await this.getIncident(incidentId);
    if (incident.status === "resolved") throw new ConflictException("Incident is already resolved.");
    await this.db.exec(
      `UPDATE ops_incidents SET status = 'resolved',
         resolved_at = $2, resolved_by_person_id = $3, resolution_notes = $4, updated_at = $2
       WHERE incident_id = $1`,
      [incidentId, this.now(), actorPersonId, String(body.resolution_notes)]
    );
    const updated = await this.getIncident(incidentId);
    await this.ops.audit("incident.resolved", "incident", incidentId, incident, updated, actorPersonId);
    return updated;
  }

  // ---------------------------------------------------------- inspections

  async listInspections(filters: { vehicle_id?: string; review_status?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.push(value);
      clauses.push(`n.${key} = $${params.length}`);
    }
    this.amoebaScopeClause(clauses, params, scope, "n.amoeba_id");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT n.*, v.plate AS vehicle_plate, v.vehicle_type
       FROM ops_vehicle_inspections n
       JOIN ops_vehicles v ON v.vehicle_id = n.vehicle_id
       ${where}
       ORDER BY n.inspected_at DESC
       LIMIT 300`,
      params
    );
  }

  async createInspection(body: RecordBody, actorPersonId: string) {
    const vehicle = await this.db.one<any>("SELECT * FROM ops_vehicles WHERE vehicle_id = $1", [String(body.vehicle_id || "")]);
    if (!vehicle) throw new NotFoundException("Vehicle not found.");
    const condition = String(body.condition || "");
    if (!["ok", "minor_issues", "needs_repair"].includes(condition)) {
      throw new BadRequestException("condition must be 'ok', 'minor_issues', or 'needs_repair'.");
    }
    if (condition === "needs_repair" && !body.notes && !Array.isArray(body.issue_categories)) {
      throw new BadRequestException("A needs_repair inspection requires issue_categories or notes.");
    }
    const timestamp = this.now();
    const inspection = {
      inspection_id: this.id("inspection"),
      vehicle_id: vehicle.vehicle_id,
      amoeba_id: vehicle.amoeba_id,
      inspected_by_person_id: actorPersonId,
      odometer_km: body.odometer_km === undefined || body.odometer_km === null || body.odometer_km === "" ? null : this.amount(body.odometer_km, "odometer_km"),
      fuel_level_pct: body.fuel_level_pct === undefined || body.fuel_level_pct === null || body.fuel_level_pct === "" ? null : this.amount(body.fuel_level_pct, "fuel_level_pct"),
      condition,
      issue_categories: Array.isArray(body.issue_categories) ? body.issue_categories.map(String) : [],
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
      media_ids: await this.mediaIds(body.media_ids),
      review_status: condition === "ok" ? "not_required" : "pending",
      inspected_at: timestamp,
      created_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_vehicle_inspections
       (inspection_id, vehicle_id, amoeba_id, inspected_by_person_id, odometer_km, fuel_level_pct,
        condition, issue_categories, notes, media_ids, review_status, inspected_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      Object.values(inspection)
    );
    await this.ops.audit("inspection.submitted", "inspection", inspection.inspection_id, null, inspection, actorPersonId);
    return inspection;
  }

  async reviewInspection(inspectionId: string, body: RecordBody, actorPersonId: string) {
    const inspection = await this.db.one<any>(
      "SELECT * FROM ops_vehicle_inspections WHERE inspection_id = $1",
      [inspectionId]
    );
    if (!inspection) throw new NotFoundException("Inspection not found.");
    if (inspection.review_status !== "pending") throw new ConflictException("This inspection has no pending review.");
    const decision = String(body.decision || "");
    if (!["approved", "follow_up"].includes(decision)) {
      throw new BadRequestException("decision must be 'approved' or 'follow_up'.");
    }
    await this.db.exec(
      `UPDATE ops_vehicle_inspections SET review_status = $2,
         reviewed_at = $3, reviewed_by_person_id = $4, review_note = $5
       WHERE inspection_id = $1`,
      [inspectionId, decision, this.now(), actorPersonId, body.note ? String(body.note) : null]
    );
    const updated = await this.db.one<any>("SELECT * FROM ops_vehicle_inspections WHERE inspection_id = $1", [inspectionId]);
    await this.ops.audit(`inspection.${decision}`, "inspection", inspectionId, inspection, updated, actorPersonId);
    return updated;
  }

  async inspectionCompliance(scope: OpsDataScope = {}) {
    const clauses: string[] = ["v.status = 'active'"];
    const params: unknown[] = [];
    this.amoebaScopeClause(clauses, params, scope, "v.amoeba_id");
    const rows = await this.db.many<any>(
      `SELECT v.vehicle_id, v.plate, v.vehicle_type, v.amoeba_id, v.assigned_operator_id,
              MAX(n.inspected_at) AS last_inspected_at
       FROM ops_vehicles v
       LEFT JOIN ops_vehicle_inspections n ON n.vehicle_id = v.vehicle_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY v.vehicle_id, v.plate, v.vehicle_type, v.amoeba_id, v.assigned_operator_id
       ORDER BY MAX(n.inspected_at) ASC NULLS FIRST`,
      params
    );
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const vehicles = rows.map((row) => ({
      ...row,
      inspection_status: !row.last_inspected_at
        ? "never_inspected"
        : new Date(row.last_inspected_at).getTime() < cutoff
          ? "overdue"
          : "current"
    }));
    const current = vehicles.filter((row) => row.inspection_status === "current").length;
    return {
      total_active_vehicles: vehicles.length,
      current,
      overdue: vehicles.length - current,
      compliance_pct: vehicles.length ? Math.round((current / vehicles.length) * 1000) / 10 : null,
      vehicles
    };
  }

  // ---------------------------------------------------------- maintenance

  async listMaintenanceReports(filters: { status?: string; vehicle_id?: string; operator_id?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.push(value);
      clauses.push(`m.${key} = $${params.length}`);
    }
    this.amoebaScopeClause(clauses, params, scope, "v.amoeba_id");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT m.*, v.plate AS vehicle_plate, v.amoeba_id, o.person_id
       FROM ops_maintenance_reports m
       JOIN ops_vehicles v ON v.vehicle_id = m.vehicle_id
       LEFT JOIN ops_operators o ON o.operator_id = m.operator_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT 300`,
      params
    );
  }

  async createMaintenanceReport(body: RecordBody, actorPersonId: string) {
    const vehicle = await this.db.one<any>("SELECT * FROM ops_vehicles WHERE vehicle_id = $1", [String(body.vehicle_id || "")]);
    if (!vehicle) throw new NotFoundException("Vehicle not found.");
    const category = String(body.category || "");
    if (!maintenanceCategories.includes(category)) {
      throw new BadRequestException(`category must be one of: ${maintenanceCategories.join(", ")}.`);
    }
    const timestamp = this.now();
    const report = {
      maintenance_id: this.id("maintenance"),
      operator_id: body.operator_id ? String(body.operator_id) : vehicle.assigned_operator_id || null,
      vehicle_id: vehicle.vehicle_id,
      category,
      description: body.description ? String(body.description).slice(0, 200) : null,
      media_ids: await this.mediaIds(body.media_ids),
      status: "open",
      cost_ngn: null,
      resolution_notes: null,
      reported_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_maintenance_reports
       (maintenance_id, operator_id, vehicle_id, category, description, media_ids, status,
        cost_ngn, resolution_notes, reported_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        report.maintenance_id, report.operator_id, report.vehicle_id, report.category,
        report.description, report.media_ids, report.status, report.cost_ngn,
        report.resolution_notes, report.reported_by_person_id, report.created_at, report.updated_at
      ]
    );
    await this.ops.audit("maintenance.reported", "maintenance", report.maintenance_id, null, report, actorPersonId);
    return report;
  }

  async updateMaintenanceStatus(maintenanceId: string, body: RecordBody, actorPersonId: string) {
    const report = await this.db.one<any>("SELECT * FROM ops_maintenance_reports WHERE maintenance_id = $1", [maintenanceId]);
    if (!report) throw new NotFoundException("Maintenance report not found.");
    const status = String(body.status || "");
    if (!["open", "in_repair", "resolved"].includes(status)) {
      throw new BadRequestException("status must be 'open', 'in_repair', or 'resolved'.");
    }
    const timestamp = this.now();
    const cost = body.cost_ngn === undefined || body.cost_ngn === null || body.cost_ngn === ""
      ? report.cost_ngn
      : this.amount(body.cost_ngn, "cost_ngn");
    await this.db.exec(
      `UPDATE ops_maintenance_reports SET status = $2, cost_ngn = $3,
         resolution_notes = COALESCE($4, resolution_notes),
         resolved_at = CASE WHEN $2 = 'resolved' THEN $5::timestamptz ELSE resolved_at END,
         resolved_by_person_id = CASE WHEN $2 = 'resolved' THEN $6 ELSE resolved_by_person_id END,
         updated_at = $5
       WHERE maintenance_id = $1`,
      [maintenanceId, status, cost, body.resolution_notes ? String(body.resolution_notes) : null, timestamp, actorPersonId]
    );
    const updated = await this.db.one<any>("SELECT * FROM ops_maintenance_reports WHERE maintenance_id = $1", [maintenanceId]);
    await this.ops.audit("maintenance.status_changed", "maintenance", maintenanceId, report, updated, actorPersonId);
    return updated;
  }

  // ------------------------------------------------------------- expenses

  async listExpenses(filters: { period_start?: string; period_end?: string; amoeba_id?: string; category?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.period_start) {
      params.push(this.date(filters.period_start, "period_start"));
      clauses.push(`e.expense_date >= $${params.length}`);
    }
    if (filters.period_end) {
      params.push(this.date(filters.period_end, "period_end"));
      clauses.push(`e.expense_date <= $${params.length}`);
    }
    if (filters.category) {
      params.push(filters.category);
      clauses.push(`e.category = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`e.amoeba_id = $${params.length}`);
    }
    if (!scope.unrestricted) {
      const inner: string[] = [];
      this.amoebaScopeClause(inner, params, scope, "e.amoeba_id");
      clauses.push(`(e.amoeba_id IS NULL OR ${inner.join(" AND ") || "TRUE"})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT e.* FROM ops_expenses e ${where} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 500`,
      params
    );
  }

  async createExpense(body: RecordBody, actorPersonId: string) {
    const category = String(body.category || "");
    if (!expenseCategories.includes(category)) {
      throw new BadRequestException(`category must be one of: ${expenseCategories.join(", ")}.`);
    }
    const allocation = String(body.allocation || (body.amoeba_id ? "direct" : "central"));
    if (!["direct", "central"].includes(allocation)) throw new BadRequestException("allocation must be 'direct' or 'central'.");
    if (allocation === "direct" && !body.amoeba_id) throw new BadRequestException("A direct expense requires amoeba_id.");
    const timestamp = this.now();
    const expense = {
      expense_id: this.id("expense"),
      expense_date: this.date(body.expense_date, "expense_date"),
      amoeba_id: allocation === "central" ? null : String(body.amoeba_id),
      category,
      description: body.description ? String(body.description).slice(0, 300) : null,
      amount_ngn: this.amount(body.amount_ngn, "amount_ngn"),
      allocation,
      evidence_reference: body.evidence_reference ? String(body.evidence_reference) : null,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_expenses
       (expense_id, expense_date, amoeba_id, category, description, amount_ngn, allocation,
        evidence_reference, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      Object.values(expense)
    );
    await this.ops.audit("expense.recorded", "expense", expense.expense_id, null, expense, actorPersonId);
    return expense;
  }

  // ------------------------------------------------ transfer price events

  async listTransferPriceEvents(filters: { period_start?: string; period_end?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.period_start) {
      params.push(this.date(filters.period_start, "period_start"));
      clauses.push(`t.event_date >= $${params.length}`);
    }
    if (filters.period_end) {
      params.push(this.date(filters.period_end, "period_end"));
      clauses.push(`t.event_date <= $${params.length}`);
    }
    if (!scope.unrestricted) {
      const inner: string[] = [];
      this.amoebaScopeClause(inner, params, scope, "t.from_amoeba_id");
      const fromClause = inner.pop();
      const inner2: string[] = [];
      this.amoebaScopeClause(inner2, params, scope, "t.to_amoeba_id");
      const toClause = inner2.pop();
      clauses.push(`(${fromClause || "FALSE"} OR ${toClause || "FALSE"})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(`SELECT t.* FROM ops_transfer_price_events t ${where} ORDER BY t.event_date DESC LIMIT 500`, params);
  }

  async createTransferPriceEvent(body: RecordBody, actorPersonId: string) {
    for (const field of ["event_date", "from_amoeba_id", "to_amoeba_id", "amount_ngn"]) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        throw new BadRequestException(`${field} is required.`);
      }
    }
    if (body.from_amoeba_id === body.to_amoeba_id) {
      throw new BadRequestException("from_amoeba_id and to_amoeba_id must differ.");
    }
    if (body.external_event_id) {
      const existing = await this.db.one<any>(
        "SELECT * FROM ops_transfer_price_events WHERE external_event_id = $1",
        [String(body.external_event_id)]
      );
      if (existing) return existing;
    }
    const event = {
      transfer_price_event_id: this.id("transfer"),
      external_event_id: body.external_event_id ? String(body.external_event_id) : null,
      event_date: this.date(body.event_date, "event_date"),
      from_amoeba_id: String(body.from_amoeba_id),
      to_amoeba_id: String(body.to_amoeba_id),
      amount_ngn: this.amount(body.amount_ngn, "amount_ngn"),
      description: body.description ? String(body.description).slice(0, 300) : null,
      source_system: String(body.source_system || "tms"),
      recorded_by_person_id: actorPersonId,
      created_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_transfer_price_events
       (transfer_price_event_id, external_event_id, event_date, from_amoeba_id, to_amoeba_id,
        amount_ngn, description, source_system, recorded_by_person_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      Object.values(event)
    );
    await this.ops.audit("transfer_price_event.recorded", "transfer_price_event", event.transfer_price_event_id, null, event, actorPersonId);
    return event;
  }

  // ------------------------------------------------------------------ P&L

  async profitAndLoss(filters: { period_start?: string; period_end?: string; amoeba_id?: string }, scope: OpsDataScope = {}) {
    const periodEnd = filters.period_end ? this.date(filters.period_end, "period_end") : this.ops.lagosDate();
    const periodStart = filters.period_start ? this.date(filters.period_start, "period_start") : periodEnd;
    if (periodStart > periodEnd) throw new BadRequestException("period_start must not be after period_end.");

    const perfClauses: string[] = ["r.record_date BETWEEN $1 AND $2"];
    const perfParams: unknown[] = [periodStart, periodEnd];
    if (filters.amoeba_id) {
      perfParams.push(filters.amoeba_id);
      perfClauses.push(`o.amoeba_id = $${perfParams.length}`);
    }
    this.operatorScopeClause(perfClauses, perfParams, scope);
    const performance = await this.db.many<any>(
      `SELECT o.amoeba_id,
              SUM(r.net_earnings_ngn) AS net_earnings_ngn,
              SUM(r.ride_revenue_ngn) AS ride_revenue_ngn,
              SUM(r.hours_online) AS hours_online,
              SUM(r.trips_completed) AS trips_completed,
              COUNT(DISTINCT r.operator_id) AS operators_with_activity,
              COUNT(DISTINCT r.record_date) AS active_days
       FROM ops_platform_daily_records r
       JOIN ops_operators o ON o.operator_id = r.operator_id
       WHERE ${perfClauses.join(" AND ")}
       GROUP BY o.amoeba_id`,
      perfParams
    );

    const headcount = await this.db.many<any>(
      `SELECT amoeba_id, COUNT(*) AS active_operators
       FROM ops_operators WHERE operator_status = 'active' GROUP BY amoeba_id`
    );

    const targetRows = await this.db.many<any>(
      `SELECT o.amoeba_id, SUM(o.daily_revenue_target_ngn) AS daily_target_ngn
       FROM ops_operators o WHERE o.operator_status = 'active' GROUP BY o.amoeba_id`
    );

    const directExpenses = await this.db.many<any>(
      `SELECT amoeba_id, category, SUM(amount_ngn) AS amount_ngn
       FROM ops_expenses
       WHERE expense_date BETWEEN $1 AND $2 AND amoeba_id IS NOT NULL
       GROUP BY amoeba_id, category`,
      [periodStart, periodEnd]
    );

    const centralExpense = await this.db.one<any>(
      `SELECT COALESCE(SUM(amount_ngn), 0) AS amount_ngn
       FROM ops_expenses
       WHERE expense_date BETWEEN $1 AND $2 AND (amoeba_id IS NULL OR allocation = 'central')`,
      [periodStart, periodEnd]
    );

    const maintenanceCosts = await this.db.many<any>(
      `SELECT v.amoeba_id, SUM(m.cost_ngn) AS amount_ngn
       FROM ops_maintenance_reports m
       JOIN ops_vehicles v ON v.vehicle_id = m.vehicle_id
       WHERE m.status = 'resolved' AND m.cost_ngn IS NOT NULL
         AND m.resolved_at::date BETWEEN $1 AND $2
       GROUP BY v.amoeba_id`,
      [periodStart, periodEnd]
    );

    const transferEvents = await this.db.many<any>(
      `SELECT from_amoeba_id, to_amoeba_id, SUM(amount_ngn) AS amount_ngn
       FROM ops_transfer_price_events
       WHERE event_date BETWEEN $1 AND $2
       GROUP BY from_amoeba_id, to_amoeba_id`,
      [periodStart, periodEnd]
    );

    const totalHeadcount = headcount.reduce((sum, row) => sum + Number(row.active_operators), 0);
    const centralTotal = Number(centralExpense?.amount_ngn || 0);

    const amoebaIds = new Set<string>([
      ...performance.map((row) => row.amoeba_id),
      ...headcount.map((row) => row.amoeba_id)
    ]);
    if (filters.amoeba_id) {
      for (const id of [...amoebaIds]) if (id !== filters.amoeba_id) amoebaIds.delete(id);
    }

    const dayCount = Math.round((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000) + 1;

    const rows = [...amoebaIds].sort().map((amoebaId) => {
      const perf = performance.find((row) => row.amoeba_id === amoebaId);
      const operators = Number(headcount.find((row) => row.amoeba_id === amoebaId)?.active_operators || 0);
      const netEarnings = Number(perf?.net_earnings_ngn || 0);
      const hours = Number(perf?.hours_online || 0);
      const expenseBreakdown = directExpenses
        .filter((row) => row.amoeba_id === amoebaId)
        .map((row) => ({ category: row.category, amount_ngn: Number(row.amount_ngn) }));
      const directTotal = expenseBreakdown.reduce((sum, row) => sum + row.amount_ngn, 0);
      const maintenance = Number(maintenanceCosts.find((row) => row.amoeba_id === amoebaId)?.amount_ngn || 0);
      const centralAllocation = totalHeadcount ? (centralTotal * operators) / totalHeadcount : 0;
      const transferCredits = transferEvents
        .filter((row) => row.from_amoeba_id === amoebaId)
        .reduce((sum, row) => sum + Number(row.amount_ngn), 0);
      const transferCharges = transferEvents
        .filter((row) => row.to_amoeba_id === amoebaId)
        .reduce((sum, row) => sum + Number(row.amount_ngn), 0);
      const grossPnl = netEarnings - directTotal - maintenance - centralAllocation + transferCredits - transferCharges;
      const dailyTarget = Number(targetRows.find((row) => row.amoeba_id === amoebaId)?.daily_target_ngn || 0);
      const periodTarget = dailyTarget * dayCount;
      return {
        amoeba_id: amoebaId,
        period_start: periodStart,
        period_end: periodEnd,
        active_operators: operators,
        operators_with_activity: Number(perf?.operators_with_activity || 0),
        trips_completed: Number(perf?.trips_completed || 0),
        hours_online: Math.round(hours * 100) / 100,
        ride_revenue_ngn: Math.round(Number(perf?.ride_revenue_ngn || 0) * 100) / 100,
        net_earnings_ngn: Math.round(netEarnings * 100) / 100,
        direct_expenses_ngn: Math.round(directTotal * 100) / 100,
        expense_breakdown: expenseBreakdown,
        maintenance_costs_ngn: Math.round(maintenance * 100) / 100,
        central_allocation_ngn: Math.round(centralAllocation * 100) / 100,
        transfer_price_credits_ngn: Math.round(transferCredits * 100) / 100,
        transfer_price_charges_ngn: Math.round(transferCharges * 100) / 100,
        gross_pnl_ngn: Math.round(grossPnl * 100) / 100,
        hourly_pnl_ngn: hours ? Math.round((grossPnl / hours) * 100) / 100 : null,
        period_target_ngn: Math.round(periodTarget * 100) / 100,
        target_attainment_pct: periodTarget ? Math.round((netEarnings / periodTarget) * 1000) / 10 : null
      };
    });

    const totals = rows.reduce(
      (accumulator, row) => ({
        net_earnings_ngn: accumulator.net_earnings_ngn + row.net_earnings_ngn,
        direct_expenses_ngn: accumulator.direct_expenses_ngn + row.direct_expenses_ngn,
        maintenance_costs_ngn: accumulator.maintenance_costs_ngn + row.maintenance_costs_ngn,
        central_allocation_ngn: accumulator.central_allocation_ngn + row.central_allocation_ngn,
        gross_pnl_ngn: accumulator.gross_pnl_ngn + row.gross_pnl_ngn,
        hours_online: accumulator.hours_online + row.hours_online
      }),
      { net_earnings_ngn: 0, direct_expenses_ngn: 0, maintenance_costs_ngn: 0, central_allocation_ngn: 0, gross_pnl_ngn: 0, hours_online: 0 }
    );

    return {
      period_start: periodStart,
      period_end: periodEnd,
      central_expenses_ngn: Math.round(centralTotal * 100) / 100,
      allocation_basis: "active_operator_headcount",
      totals: {
        ...totals,
        net_earnings_ngn: Math.round(totals.net_earnings_ngn * 100) / 100,
        gross_pnl_ngn: Math.round(totals.gross_pnl_ngn * 100) / 100,
        hourly_pnl_ngn: totals.hours_online ? Math.round((totals.gross_pnl_ngn / totals.hours_online) * 100) / 100 : null
      },
      amoebas: rows
    };
  }

  // ------------------------------------------------------------ leaderboard

  async leaderboardConfig() {
    return this.db.one<any>("SELECT * FROM ops_leaderboard_config ORDER BY updated_at DESC LIMIT 1");
  }

  async updateLeaderboardConfig(body: RecordBody, actorPersonId: string) {
    const current = await this.leaderboardConfig();
    const weights = {
      acceptance_weight: Number(body.acceptance_weight ?? current.acceptance_weight),
      online_weight: Number(body.online_weight ?? current.online_weight),
      cash_weight: Number(body.cash_weight ?? current.cash_weight),
      revenue_weight: Number(body.revenue_weight ?? current.revenue_weight)
    };
    for (const [field, value] of Object.entries(weights)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new BadRequestException(`${field} must be between 0 and 1.`);
    }
    const sum = Object.values(weights).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 0.001) throw new BadRequestException("Leaderboard weights must sum to 1.0.");
    await this.db.exec(
      `UPDATE ops_leaderboard_config SET
         acceptance_weight = $2, online_weight = $3, cash_weight = $4, revenue_weight = $5,
         default_timeline = $6, company_wide_visible = $7, updated_by_person_id = $8, updated_at = $9
       WHERE config_id = $1`,
      [
        current.config_id,
        weights.acceptance_weight,
        weights.online_weight,
        weights.cash_weight,
        weights.revenue_weight,
        String(body.default_timeline ?? current.default_timeline),
        body.company_wide_visible === undefined ? current.company_wide_visible : Boolean(body.company_wide_visible),
        actorPersonId,
        this.now()
      ]
    );
    const updated = await this.leaderboardConfig();
    await this.ops.audit("leaderboard_config.updated", "leaderboard_config", current.config_id, current, updated, actorPersonId);
    return updated;
  }

  async leaderboard(
    filters: { period_start?: string; period_end?: string; amoeba_id?: string; sort?: string },
    scope: OpsDataScope = {},
    options: { hideRevenueComponent?: boolean } = {}
  ) {
    const periodEnd = filters.period_end ? this.date(filters.period_end, "period_end") : this.ops.lagosDate();
    const periodStart = filters.period_start ? this.date(filters.period_start, "period_start") : periodEnd;
    if (periodStart > periodEnd) throw new BadRequestException("period_start must not be after period_end.");

    const config = await this.leaderboardConfig();
    const policy = await this.db.one<any>(
      `SELECT expected_hours_per_operator FROM ops_economics_policies
       WHERE effective_from <= $1 AND (effective_to IS NULL OR effective_to >= $1)
       ORDER BY effective_from DESC LIMIT 1`,
      [periodEnd]
    );
    const expectedHours = Number(policy?.expected_hours_per_operator || 10);

    const clauses: string[] = ["r.record_date BETWEEN $1 AND $2"];
    const params: unknown[] = [periodStart, periodEnd];
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`o.amoeba_id = $${params.length}`);
    }
    const visibilityScope = config?.company_wide_visible ? { unrestricted: true } : scope;
    this.operatorScopeClause(clauses, params, visibilityScope);

    const rows = await this.db.many<any>(
      `SELECT o.operator_id, o.person_id, o.amoeba_id, o.operator_type, o.daily_revenue_target_ngn,
              v.plate AS vehicle_plate,
              COUNT(DISTINCT r.record_date) FILTER (WHERE r.trips_total > 0 OR r.hours_online > 0) AS days_worked,
              SUM(r.net_earnings_ngn) AS net_earnings_ngn,
              SUM(r.trips_completed) AS trips_completed,
              SUM(r.hours_online) AS hours_online,
              AVG(NULLIF(r.acceptance_pct, 0)) AS acceptance_pct,
              SUM(CASE WHEN r.trips_completed > 0
                    THEN r.ride_revenue_ngn * r.cash_trips / GREATEST(r.trips_completed, 1)
                    ELSE 0 END) AS expected_cash_ngn
       FROM ops_platform_daily_records r
       JOIN ops_operators o ON o.operator_id = r.operator_id
       LEFT JOIN ops_vehicles v ON v.vehicle_id = o.vehicle_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY o.operator_id, o.person_id, o.amoeba_id, o.operator_type, o.daily_revenue_target_ngn, v.plate
       HAVING COUNT(DISTINCT r.record_date) FILTER (WHERE r.trips_total > 0 OR r.hours_online > 0) > 0`,
      params
    );

    const remittances = await this.db.many<any>(
      `SELECT operator_id, SUM(amount_ngn) AS remitted_ngn
       FROM ops_cash_transactions
       WHERE paid_at::date BETWEEN $1 AND $2
       GROUP BY operator_id`,
      [periodStart, periodEnd]
    );

    const entries = rows.map((row) => {
      const daysWorked = Number(row.days_worked);
      const acceptanceScore = Math.min(100, Math.max(0, Number(row.acceptance_pct || 0)));
      const onlineScore = Math.min(100, (Number(row.hours_online || 0) / Math.max(1, expectedHours * daysWorked)) * 100);
      const expectedCash = Number(row.expected_cash_ngn || 0);
      const remitted = Number(remittances.find((item) => item.operator_id === row.operator_id)?.remitted_ngn || 0);
      const shortfall = Math.max(0, expectedCash - remitted);
      const cashScore = expectedCash > 0 ? Math.max(0, 100 * (1 - shortfall / expectedCash)) : 100;
      const dailyTarget = Number(row.daily_revenue_target_ngn || 0);
      const revenueScore = dailyTarget > 0
        ? Math.min(100, (Number(row.net_earnings_ngn || 0) / (dailyTarget * daysWorked)) * 100)
        : 0;
      const performanceScore =
        Number(config.acceptance_weight) * acceptanceScore
        + Number(config.online_weight) * onlineScore
        + Number(config.cash_weight) * cashScore
        + Number(config.revenue_weight) * revenueScore;
      return {
        operator_id: row.operator_id,
        person_id: row.person_id,
        amoeba_id: row.amoeba_id,
        operator_type: row.operator_type,
        vehicle_plate: row.vehicle_plate,
        days_worked: daysWorked,
        net_earnings_ngn: Math.round(Number(row.net_earnings_ngn || 0) * 100) / 100,
        trips_completed: Number(row.trips_completed || 0),
        hours_online: Math.round(Number(row.hours_online || 0) * 100) / 100,
        acceptance_pct: Math.round(acceptanceScore * 10) / 10,
        expected_cash_ngn: Math.round(expectedCash * 100) / 100,
        remitted_ngn: Math.round(remitted * 100) / 100,
        cash_shortfall_ngn: Math.round(shortfall * 100) / 100,
        performance_score: Math.round(performanceScore * 10) / 10,
        components: {
          acceptance_score: Math.round(acceptanceScore * 10) / 10,
          time_online_score: Math.round(onlineScore * 10) / 10,
          cash_receipt_score: Math.round(cashScore * 10) / 10,
          revenue_score: options.hideRevenueComponent ? null : Math.round(revenueScore * 10) / 10
        }
      };
    });

    const sortKeys: Record<string, (entry: any) => number> = {
      score: (entry) => entry.performance_score,
      net_earnings: (entry) => entry.net_earnings_ngn,
      acceptance: (entry) => entry.acceptance_pct,
      trips: (entry) => entry.trips_completed,
      online: (entry) => entry.hours_online,
      cash: (entry) => entry.components.cash_receipt_score
    };
    const sortKey = sortKeys[filters.sort || "score"] ? filters.sort || "score" : "score";
    entries.sort((a, b) => sortKeys[sortKey](b) - sortKeys[sortKey](a));
    const badges = ["gold", "silver", "bronze"];
    entries.forEach((entry: any, index) => {
      entry.rank = index + 1;
      entry.badge = index < 3 ? badges[index] : null;
    });

    return {
      period_start: periodStart,
      period_end: periodEnd,
      sort: sortKey,
      expected_hours_per_operator: expectedHours,
      weights: {
        acceptance_weight: Number(config.acceptance_weight),
        online_weight: Number(config.online_weight),
        cash_weight: Number(config.cash_weight),
        revenue_weight: Number(config.revenue_weight)
      },
      company_wide_visible: Boolean(config.company_wide_visible),
      entries
    };
  }

  // ------------------------------------------------------------ escalations

  async escalationQueue(scope: OpsDataScope = {}) {
    const alertClauses: string[] = [
      "a.resolution_status IN ('open', 'acknowledged', 'snoozed', 'escalated')",
      "(a.tier >= 2 OR a.escalated_at IS NOT NULL)"
    ];
    const alertParams: unknown[] = [];
    this.operatorScopeClause(alertClauses, alertParams, scope);
    const alerts = await this.db.many<any>(
      `SELECT a.alert_id, a.alert_type, a.tier, a.fired_at, a.resolution_status, a.escalated_at,
              a.escalation_note, a.deviation_reason_code, a.deviation_review_status,
              o.operator_id, o.person_id, o.amoeba_id, o.supervisor_person_id
       FROM ops_alerts a
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE ${alertClauses.join(" AND ")}
       ORDER BY a.fired_at DESC LIMIT 100`,
      alertParams
    );

    const incidentClauses: string[] = ["i.status = 'open'"];
    const incidentParams: unknown[] = [];
    this.operatorScopeClause(incidentClauses, incidentParams, scope);
    const incidents = await this.db.many<any>(
      `SELECT i.incident_id, i.incident_type, i.severity, i.status, i.occurred_at,
              o.operator_id, o.person_id, o.amoeba_id, o.supervisor_person_id
       FROM ops_incidents i
       JOIN ops_operators o ON o.operator_id = i.operator_id
       WHERE ${incidentClauses.join(" AND ")}
       ORDER BY i.occurred_at DESC LIMIT 100`,
      incidentParams
    );
    const escalationMinutes = Number(process.env.INCIDENT_ESCALATION_MINUTES || 30);
    const overdueIncidents = incidents.filter((incident) =>
      incident.severity === "high"
      && Date.now() - new Date(incident.occurred_at).getTime() > escalationMinutes * 60000
    );

    const compliance = await this.inspectionCompliance(scope);
    const overdueInspections = compliance.vehicles.filter((vehicle: any) => vehicle.inspection_status !== "current");

    const today = this.ops.lagosDate();
    const closeoutClauses: string[] = ["o.operator_status = 'active'"];
    const closeoutParams: unknown[] = [today];
    this.operatorScopeClause(closeoutClauses, closeoutParams, scope);
    const missingCloseouts = await this.db.many<any>(
      `SELECT o.amoeba_id, COUNT(*) AS active_operators
       FROM ops_operators o
       WHERE ${closeoutClauses.join(" AND ")}
         AND o.amoeba_id NOT IN (
           SELECT amoeba_id FROM ops_daily_closeouts WHERE record_date = $1
         )
       GROUP BY o.amoeba_id`,
      closeoutParams
    );

    const maintenanceClauses: string[] = ["m.status = 'open'"];
    const maintenanceParams: unknown[] = [];
    this.amoebaScopeClause(maintenanceClauses, maintenanceParams, scope, "v.amoeba_id");
    const openMaintenance = await this.db.many<any>(
      `SELECT m.maintenance_id, m.category, m.created_at, v.plate AS vehicle_plate, v.amoeba_id
       FROM ops_maintenance_reports m
       JOIN ops_vehicles v ON v.vehicle_id = m.vehicle_id
       WHERE ${maintenanceClauses.join(" AND ")}
       ORDER BY m.created_at ASC LIMIT 100`,
      maintenanceParams
    );

    return {
      generated_at: this.now(),
      escalated_alerts: alerts,
      high_severity_incidents_unacknowledged: overdueIncidents,
      open_incidents: incidents,
      overdue_inspections: overdueInspections,
      missing_closeouts_today: missingCloseouts,
      open_maintenance_reports: openMaintenance,
      counts: {
        escalated_alerts: alerts.length,
        high_severity_incidents_unacknowledged: overdueIncidents.length,
        open_incidents: incidents.length,
        overdue_inspections: overdueInspections.length,
        missing_closeouts_today: missingCloseouts.length,
        open_maintenance_reports: openMaintenance.length
      }
    };
  }
}
