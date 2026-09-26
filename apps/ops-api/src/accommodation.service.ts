import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "./database.service.js";

type Body = Record<string, unknown>;

// Company accommodation (finite housing). Kept dependency-light (DatabaseService
// only) so OpsService can call the capacity check from updateOperator without a
// circular import.
@Injectable()
export class AccommodationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }
  private now() {
    return new Date().toISOString();
  }
  private capacity(value: unknown) {
    const n = Math.round(Number(value ?? 0));
    if (!Number.isInteger(n) || n < 0) throw new BadRequestException("capacity must be a whole number of beds (0 or more).");
    return n;
  }

  private async audit(action: string, entityId: string, before: unknown, after: unknown, actor: string) {
    await this.db.exec(
      `INSERT INTO ops_audit_entries
        (audit_id, actor_person_id, actor_type, action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1,$2,$3,$4,'accommodation_unit',$5,$6,$7,$8)`,
      [this.id("audit"), actor, actor === "person_system" ? "service" : "human", action, entityId, before, after, this.now()]
    );
  }

  // Units with live occupancy (only active operators hold a bed) + availability.
  async listUnits() {
    return this.db.many<any>(
      `SELECT u.*,
        COALESCE(o.occupied, 0) AS occupied,
        GREATEST(u.capacity - COALESCE(o.occupied, 0), 0) AS available
       FROM ops_accommodation_units u
       LEFT JOIN (
         SELECT accommodation_unit_id, COUNT(*) AS occupied
         FROM ops_operators
         WHERE accommodation_unit_id IS NOT NULL AND operator_status = 'active'
         GROUP BY accommodation_unit_id
       ) o ON o.accommodation_unit_id = u.accommodation_unit_id
       ORDER BY u.status ASC, u.name ASC`
    );
  }

  async getUnit(unitId: string) {
    const unit = await this.db.one<any>("SELECT * FROM ops_accommodation_units WHERE accommodation_unit_id=$1", [unitId]);
    if (!unit) throw new NotFoundException("Accommodation unit not found.");
    return unit;
  }

  private async occupancy(unitId: string, excludeOperatorId: string | null = null) {
    const row = await this.db.one<{ occupied: number }>(
      `SELECT COUNT(*)::int AS occupied FROM ops_operators
       WHERE accommodation_unit_id=$1 AND operator_status='active' AND ($2::text IS NULL OR operator_id <> $2)`,
      [unitId, excludeOperatorId]
    );
    return Number(row?.occupied || 0);
  }

  async createUnit(body: Body, actor: string) {
    const name = String(body.name || "").trim();
    if (!name) throw new BadRequestException("name is required.");
    const unit = {
      accommodation_unit_id: this.id("accom"),
      name,
      location: body.location ? String(body.location) : null,
      capacity: this.capacity(body.capacity),
      status: "active",
      created_by_person_id: actor,
      created_at: this.now(),
      updated_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_accommodation_units
        (accommodation_unit_id, name, location, capacity, status, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      Object.values(unit)
    );
    await this.audit("accommodation_unit.created", unit.accommodation_unit_id, null, unit, actor);
    return { ...unit, occupied: 0, available: unit.capacity };
  }

  async updateUnit(unitId: string, body: Body, actor: string) {
    const current = await this.getUnit(unitId);
    const occupied = await this.occupancy(unitId);
    const updated = {
      name: body.name === undefined ? current.name : String(body.name).trim() || current.name,
      location: body.location === undefined ? current.location : (body.location ? String(body.location) : null),
      capacity: body.capacity === undefined ? current.capacity : this.capacity(body.capacity),
      status: body.status === undefined ? current.status : String(body.status),
      updated_at: this.now()
    };
    if (!["active", "inactive"].includes(updated.status)) throw new BadRequestException("status must be active or inactive.");
    // The finite space cannot shrink below who is already housed there.
    if (updated.capacity < occupied) {
      throw new ConflictException(`capacity cannot be below the current occupancy (${occupied}).`);
    }
    await this.db.exec(
      "UPDATE ops_accommodation_units SET name=$2, location=$3, capacity=$4, status=$5, updated_at=$6 WHERE accommodation_unit_id=$1",
      [unitId, updated.name, updated.location, updated.capacity, updated.status, updated.updated_at]
    );
    await this.audit("accommodation_unit.updated", unitId, current, updated, actor);
    return { ...current, ...updated, occupied, available: Math.max(updated.capacity - occupied, 0) };
  }

  async deleteUnit(unitId: string, actor: string) {
    const current = await this.getUnit(unitId);
    const occupied = await this.occupancy(unitId);
    if (occupied > 0) throw new ConflictException(`Cannot delete a unit with ${occupied} operator(s) housed. Reassign them first, or mark it inactive.`);
    await this.db.exec("DELETE FROM ops_accommodation_units WHERE accommodation_unit_id=$1", [unitId]);
    await this.audit("accommodation_unit.deleted", unitId, current, null, actor);
    return { accommodation_unit_id: unitId, deleted: true };
  }

  // Enforce the hard capacity block for an operator being assigned to a unit.
  // Called by OpsService.updateOperator. Returns the resolved unit id (or null).
  async assertCanAssign(unitId: unknown, operatorId: string): Promise<string | null> {
    if (unitId === null || unitId === undefined || unitId === "") return null;
    const id = String(unitId);
    const unit = await this.db.one<any>("SELECT * FROM ops_accommodation_units WHERE accommodation_unit_id=$1", [id]);
    if (!unit) throw new BadRequestException("accommodation_unit_id does not match a unit.");
    if (unit.status !== "active") throw new BadRequestException("Cannot house an operator in an inactive unit.");
    const occupied = await this.occupancy(id, operatorId);
    if (occupied >= Number(unit.capacity)) {
      throw new ConflictException(`${unit.name} is full (${occupied}/${unit.capacity}). Free a bed or pick another unit.`);
    }
    return id;
  }
}
