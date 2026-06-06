import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "./database.service.js";

type RecordBody = Record<string, unknown>;

@Injectable()
export class OpsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }

  private now() {
    return new Date().toISOString();
  }

  async cached(key: string) {
    return this.db.one<{ status: number; body: RecordBody }>(
      "SELECT status, body FROM ops_idempotency_records WHERE idempotency_key = $1",
      [key]
    );
  }

  async remember(key: string, status: number, body: RecordBody) {
    await this.db.exec(
      "INSERT INTO ops_idempotency_records (idempotency_key, status, body, created_at) VALUES ($1, $2, $3, $4)",
      [key, status, body, this.now()]
    );
  }

  async audit(action: string, entityType: string, entityId: string, before: unknown, after: unknown, actorPersonId = "person_system") {
    await this.db.exec(
      `INSERT INTO ops_audit_entries
        (audit_id, actor_person_id, actor_type, action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [this.id("audit"), actorPersonId, actorPersonId === "person_system" ? "service" : "human", action, entityType, entityId, before, after, this.now()]
    );
  }

  async listOperators(filters: { status?: string; amoeba_id?: string }) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`o.operator_status = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`o.amoeba_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT o.*, v.plate AS vehicle_plate,
        COALESCE(json_agg(json_build_object(
          'registration_id', r.registration_id,
          'platform_account_id', r.platform_account_id,
          'platform', pa.platform,
          'platform_display_name', pa.display_name,
          'platform_operator_id', r.platform_operator_id,
          'registration_status', r.registration_status
        )) FILTER (WHERE r.registration_id IS NOT NULL), '[]') AS platform_registrations
       FROM ops_operators o
       LEFT JOIN ops_vehicles v ON v.vehicle_id = o.vehicle_id
       LEFT JOIN ops_operator_platform_accounts r ON r.operator_id = o.operator_id
       LEFT JOIN ops_platform_accounts pa ON pa.platform_account_id = r.platform_account_id
       ${where}
       GROUP BY o.operator_id, v.plate
       ORDER BY o.created_at ASC`,
      params
    );
  }

  async getOperator(operatorId: string) {
    const rows = await this.listOperators({});
    const operator = rows.find((item: any) => item.operator_id === operatorId);
    if (!operator) throw new NotFoundException("Operator not found.");
    return operator;
  }

  async createOperator(body: RecordBody) {
    for (const field of ["person_id", "operator_type", "amoeba_id", "site_id"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    if (await this.db.one("SELECT operator_id FROM ops_operators WHERE person_id = $1", [body.person_id])) {
      throw new ConflictException("This person already has an Ops operator record.");
    }
    const timestamp = this.now();
    const operator = {
      operator_id: this.id("operator"),
      person_id: body.person_id,
      operator_type: body.operator_type,
      operator_status: body.operator_status || "pending_activation",
      amoeba_id: body.amoeba_id,
      site_id: body.site_id,
      supervisor_person_id: body.supervisor_person_id || null,
      vehicle_id: body.vehicle_id || null,
      daily_revenue_target_ngn: body.daily_revenue_target_ngn ?? null,
      activated_at: null,
      deactivated_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_operators
        (operator_id, person_id, operator_type, operator_status, amoeba_id, site_id,
         supervisor_person_id, vehicle_id, daily_revenue_target_ngn, activated_at,
         deactivated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      Object.values(operator)
    );
    await this.audit("operator.created", "operator", operator.operator_id, null, operator);
    return operator;
  }

  async updateOperator(operatorId: string, body: RecordBody) {
    const current: any = await this.getOperator(operatorId);
    const allowed = ["operator_type", "operator_status", "amoeba_id", "site_id", "supervisor_person_id", "vehicle_id", "daily_revenue_target_ngn"];
    const updated: any = { ...current };
    for (const key of allowed) if (key in body) updated[key] = body[key];
    updated.updated_at = this.now();
    if (updated.operator_status === "active" && current.operator_status !== "active") updated.activated_at = updated.updated_at;
    if (["inactive", "suspended"].includes(updated.operator_status) && !["inactive", "suspended"].includes(current.operator_status)) {
      updated.deactivated_at = updated.updated_at;
    }
    await this.db.exec(
      `UPDATE ops_operators SET
        operator_type = $2, operator_status = $3, amoeba_id = $4, site_id = $5,
        supervisor_person_id = $6, vehicle_id = $7, daily_revenue_target_ngn = $8,
        activated_at = $9, deactivated_at = $10, updated_at = $11
       WHERE operator_id = $1`,
      [
        operatorId,
        updated.operator_type,
        updated.operator_status,
        updated.amoeba_id,
        updated.site_id,
        updated.supervisor_person_id,
        updated.vehicle_id,
        updated.daily_revenue_target_ngn,
        updated.activated_at,
        updated.deactivated_at,
        updated.updated_at
      ]
    );
    await this.audit("operator.updated", "operator", operatorId, current, body);
    return this.getOperator(operatorId);
  }

  async listVehicles() {
    return this.db.many("SELECT * FROM ops_vehicles ORDER BY created_at ASC");
  }

  async createVehicle(body: RecordBody) {
    for (const field of ["plate", "vehicle_type", "amoeba_id"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    if (await this.db.one("SELECT vehicle_id FROM ops_vehicles WHERE lower(plate) = lower($1)", [body.plate])) {
      throw new ConflictException("Vehicle plate already exists.");
    }
    const timestamp = this.now();
    const vehicle = {
      vehicle_id: this.id("vehicle"),
      plate: String(body.plate).toUpperCase(),
      vehicle_type: body.vehicle_type,
      amoeba_id: body.amoeba_id,
      make_model: body.make_model || null,
      color: body.color || null,
      status: body.status || "active",
      assigned_operator_id: body.assigned_operator_id || null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_vehicles
        (vehicle_id, plate, vehicle_type, amoeba_id, make_model, color, status,
         assigned_operator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      Object.values(vehicle)
    );
    await this.audit("vehicle.created", "vehicle", vehicle.vehicle_id, null, vehicle);
    return vehicle;
  }

  async listPlatformAccounts() {
    return this.db.many("SELECT * FROM ops_platform_accounts ORDER BY created_at ASC");
  }

  async createPlatformAccount(body: RecordBody) {
    for (const field of ["platform", "display_name", "vehicle_type", "account_subtype", "credentials_key"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    const timestamp = this.now();
    const account = {
      platform_account_id: this.id("platform"),
      platform: body.platform,
      display_name: body.display_name,
      vehicle_type: body.vehicle_type,
      account_subtype: body.account_subtype,
      credentials_key: body.credentials_key,
      external_account_id: body.external_account_id || null,
      is_active: body.is_active ?? true,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_platform_accounts
        (platform_account_id, platform, display_name, vehicle_type, account_subtype,
         credentials_key, external_account_id, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      Object.values(account)
    );
    await this.audit("platform_account.created", "platform_account", account.platform_account_id, null, account);
    return account;
  }

  async registerPlatform(operatorId: string, body: RecordBody) {
    await this.getOperator(operatorId);
    if (!body.platform_account_id || !body.platform_operator_id) {
      throw new BadRequestException("platform_account_id and platform_operator_id are required.");
    }
    if (!(await this.db.one("SELECT platform_account_id FROM ops_platform_accounts WHERE platform_account_id = $1", [body.platform_account_id]))) {
      throw new BadRequestException("platform_account_id does not exist.");
    }
    const timestamp = this.now();
    const registration = {
      registration_id: this.id("registration"),
      operator_id: operatorId,
      platform_account_id: body.platform_account_id,
      platform_operator_id: body.platform_operator_id,
      registration_status: body.registration_status || "registered",
      activated_at: body.registration_status === "active" ? timestamp : null,
      deactivated_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    try {
      await this.db.exec(
        `INSERT INTO ops_operator_platform_accounts
          (registration_id, operator_id, platform_account_id, platform_operator_id,
           registration_status, activated_at, deactivated_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        Object.values(registration)
      );
    } catch {
      throw new ConflictException("Operator already has a registration for this platform account.");
    }
    await this.audit("operator.platform_registered", "operator", operatorId, null, registration);
    return registration;
  }

  async listAlerts(filters: { resolution_status?: string; operator_id?: string }) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.push(value);
      clauses.push(`a.${key} = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT a.*, o.person_id, o.amoeba_id, o.site_id, pa.platform, pa.display_name AS platform_display_name
       FROM ops_alerts a
       JOIN ops_operators o ON o.operator_id = a.operator_id
       LEFT JOIN ops_platform_accounts pa ON pa.platform_account_id = a.platform_account_id
       ${where}
       ORDER BY a.fired_at DESC`,
      params
    );
  }

  async getAlert(alertId: string) {
    const alert = await this.db.one<any>("SELECT * FROM ops_alerts WHERE alert_id = $1", [alertId]);
    if (!alert) throw new NotFoundException("Alert not found.");
    return alert;
  }

  async acknowledgeAlert(alertId: string, body: RecordBody, actorPersonId: string) {
    const current = await this.getAlert(alertId);
    if (!["open", "snoozed", "escalated"].includes(current.resolution_status)) {
      throw new ConflictException("Only an open, snoozed, or escalated alert can be acknowledged.");
    }
    const timestamp = this.now();
    await this.db.exec(
      `UPDATE ops_alerts SET resolution_status = 'acknowledged',
       acknowledged_at = $2, acknowledged_by_person_id = $3,
       resolution_notes = COALESCE($4, resolution_notes)
       WHERE alert_id = $1`,
      [alertId, timestamp, actorPersonId, body.note || null]
    );
    const updated = await this.getAlert(alertId);
    await this.audit("alert.acknowledged", "alert", alertId, current, updated, actorPersonId);
    return updated;
  }

  async resolveAlert(alertId: string, body: RecordBody, actorPersonId: string) {
    if (!body.resolution_notes) throw new BadRequestException("resolution_notes is required.");
    const current = await this.getAlert(alertId);
    const timestamp = this.now();
    await this.db.exec(
      `UPDATE ops_alerts SET resolution_status = 'resolved',
       resolved_at = $2, resolved_by_person_id = $3, resolution_notes = $4
       WHERE alert_id = $1`,
      [alertId, timestamp, actorPersonId, body.resolution_notes]
    );
    const updated = await this.getAlert(alertId);
    await this.audit("alert.resolved", "alert", alertId, current, updated, actorPersonId);
    return updated;
  }

  async listAudit() {
    return this.db.many("SELECT * FROM ops_audit_entries ORDER BY occurred_at DESC LIMIT 200");
  }
}
