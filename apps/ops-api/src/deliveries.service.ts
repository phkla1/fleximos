import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";

type RecordBody = Record<string, unknown>;

// Sources for every recorded count — typed numbers must never be mistaken
// for scan truth (Scheduled-Deliveries-Spec-v0.2).
const countSources = new Set(["customer_app_manual", "customer_app_import", "customer_api", "operator_manual", "fleximos_scan"]);
const exceptionCategories = new Set(["shortage", "damaged", "customer_dispute", "failed_delivery", "return_pending", "other"]);
const assignmentStatuses = new Set(["assigned", "out_for_delivery", "completed"]);
const stopStatuses = new Set(["pending", "en_route", "arrived", "delivered", "failed"]);
// Mandatory failure taxonomy (rider review, 11 Aug 2026).
const failedReasons = new Set([
  "customer_unavailable", "wrong_address", "customer_refused", "reschedule_requested",
  "phone_unreachable", "security_restriction", "road_inaccessible", "payment_issue",
  "package_damaged", "vehicle_issue", "other"
]);

@Injectable()
export class DeliveriesService {
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

  // DATE columns come back as strings from node-postgres (parser override)
  // but as local-midnight Date objects from PGlite; normalise using local
  // components so the day never shifts across timezones.
  private dayKey(value: unknown): string {
    if (value instanceof Date) {
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return String(value).slice(0, 10);
  }

  private date(value: unknown, field = "batch_date") {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date.`);
    }
    return text;
  }

  private count(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException(`${field} must be a non-negative whole number.`);
    return parsed;
  }

  private source(value: unknown) {
    const source = String(value || "customer_app_manual");
    if (!countSources.has(source)) throw new BadRequestException(`counts_source must be one of: ${[...countSources].join(", ")}.`);
    return source;
  }

  private async audit(eventType: string, entityType: string, entityId: string, before: unknown, after: unknown, actor?: string) {
    await this.ops.audit(eventType, entityType, entityId, before, after, actor || "person_system");
  }

  // Batches are visible when the actor's scope reaches the batch's amoeba:
  // managers/finance via amoeba scope lists, supervisors via their team's
  // amoebas, operators only through their own assignments.
  private scopeClause(clauses: string[], params: unknown[], scope: OpsDataScope, alias = "b") {
    if (scope.unrestricted) return;
    const visible: string[] = [];
    if (scope.amoeba_ids?.length) {
      const placeholders = scope.amoeba_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`${alias}.amoeba_id IN (${placeholders.join(", ")})`);
    }
    if (scope.supervisor_person_id) {
      params.push(scope.supervisor_person_id);
      visible.push(`EXISTS (SELECT 1 FROM ops_operators so WHERE so.amoeba_id = ${alias}.amoeba_id AND so.supervisor_person_id = $${params.length})`);
    }
    if (scope.person_id) {
      params.push(scope.person_id);
      visible.push(`EXISTS (
        SELECT 1 FROM ops_delivery_assignments sa
        JOIN ops_operators sao ON sao.operator_id = sa.operator_id
        WHERE sa.batch_id = ${alias}.batch_id AND sao.person_id = $${params.length})`);
    }
    clauses.push(visible.length ? `(${visible.join(" OR ")})` : "FALSE");
  }

  /* ---------------- allocated price (class-aware) ---------------- */

  // Riders and drivers earn on different allocated rates (drivers carry the
  // bigger parcels). A class-specific row wins for its effective window; the
  // global 'all' row is the fallback so pre-class data keeps its price.
  // Resolution, most specific first: (customer, class) → (customer, all) →
  // (any, class) → (any, all). So ₦/parcel is configurable per class AND per
  // client without hard-coding a value.
  async allocatedRateFor(date: string, operatorClass = "all", customerId: string | null = null): Promise<{ price_ngn: number; daily_basic_ngn: number }> {
    const row = await this.db.one<any>(
      `SELECT price_ngn, daily_basic_ngn FROM ops_delivery_allocated_prices
       WHERE effective_from <= $1 AND (effective_to IS NULL OR effective_to >= $1)
         AND operator_class IN ($2, 'all')
         AND (delivery_customer_id IS NULL OR delivery_customer_id = $3)
       ORDER BY COALESCE(delivery_customer_id = $3, FALSE) DESC, (operator_class = $2) DESC, effective_from DESC
       LIMIT 1`,
      [date, operatorClass, customerId]
    );
    return { price_ngn: Number(row?.price_ngn || 0), daily_basic_ngn: Number(row?.daily_basic_ngn || 0) };
  }

  // Backward-compatible per-parcel rate (existing callers pass no class).
  async allocatedPriceFor(date: string, operatorClass = "all", customerId: string | null = null): Promise<number> {
    return (await this.allocatedRateFor(date, operatorClass, customerId)).price_ngn;
  }

  async listAllocatedPrices() {
    return this.db.many("SELECT * FROM ops_delivery_allocated_prices ORDER BY effective_from DESC, operator_class ASC");
  }

  async createAllocatedPrice(body: RecordBody, actorPersonId: string) {
    const price = Number(body.price_ngn);
    if (!(price > 0)) throw new BadRequestException("price_ngn must be a positive amount.");
    const operatorClass = String(body.operator_class || "all");
    if (!["all", "rider", "driver"].includes(operatorClass)) {
      throw new BadRequestException("operator_class must be one of: all, rider, driver.");
    }
    const dailyBasic = body.daily_basic_ngn === undefined ? 0 : Number(body.daily_basic_ngn);
    if (!(dailyBasic >= 0)) throw new BadRequestException("daily_basic_ngn must be zero or a positive amount.");
    let customerId: string | null = null;
    if (body.delivery_customer_id) {
      const customer = await this.db.one<any>("SELECT delivery_customer_id FROM ops_delivery_customers WHERE delivery_customer_id=$1", [String(body.delivery_customer_id)]);
      if (!customer) throw new BadRequestException("delivery_customer_id does not match a customer.");
      customerId = customer.delivery_customer_id;
    }
    const record = {
      allocated_price_id: this.id("allocated"),
      price_ngn: price,
      operator_class: operatorClass,
      daily_basic_ngn: dailyBasic,
      delivery_customer_id: customerId,
      effective_from: this.date(body.effective_from || this.now().slice(0, 10), "effective_from"),
      effective_to: body.effective_to ? this.date(body.effective_to, "effective_to") : null,
      created_by_person_id: actorPersonId,
      created_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_allocated_prices
        (allocated_price_id, price_ngn, operator_class, daily_basic_ngn, delivery_customer_id, effective_from, effective_to, created_by_person_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      Object.values(record)
    );
    await this.audit("delivery_allocated_price.created", "delivery_allocated_price", record.allocated_price_id, null, record, actorPersonId);
    return record;
  }

  // Delete an allocated-price version (config; e.g. clearing a stale seed).
  // Refuse to delete the last remaining price so operators always resolve a
  // rate — set a replacement first.
  async deleteAllocatedPrice(priceId: string, actorPersonId: string) {
    const existing = await this.db.one<any>("SELECT * FROM ops_delivery_allocated_prices WHERE allocated_price_id=$1", [priceId]);
    if (!existing) throw new NotFoundException("Allocated price not found.");
    const remaining = await this.db.one<any>("SELECT COUNT(*)::int AS n FROM ops_delivery_allocated_prices");
    if (Number(remaining?.n) <= 1) throw new ConflictException("This is the only allocated price; set a replacement before deleting it.");
    await this.db.exec("DELETE FROM ops_delivery_allocated_prices WHERE allocated_price_id=$1", [priceId]);
    await this.audit("delivery_allocated_price.deleted", "delivery_allocated_price", priceId, existing, null, actorPersonId);
    return { allocated_price_id: priceId, deleted: true };
  }

  /* ---------------- customers ---------------- */

  async listCustomers() {
    return this.db.many("SELECT * FROM ops_delivery_customers ORDER BY name ASC");
  }

  async createCustomer(body: RecordBody, actorPersonId: string) {
    if (!body.name) throw new BadRequestException("name is required.");
    const contractPrice = Number(body.contract_price_ngn);
    if (!(contractPrice > 0)) throw new BadRequestException("contract_price_ngn must be a positive amount.");
    const timestamp = this.now();
    const customer = {
      delivery_customer_id: this.id("dcustomer"),
      name: String(body.name).trim(),
      contact: body.contact ? String(body.contact) : null,
      notes: body.notes ? String(body.notes) : null,
      contract_price_ngn: contractPrice,
      status: "active",
      created_at: timestamp,
      updated_at: timestamp
    };
    try {
      await this.db.exec(
        `INSERT INTO ops_delivery_customers
          (delivery_customer_id, name, contact, notes, contract_price_ngn, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        Object.values(customer)
      );
    } catch {
      throw new ConflictException("A delivery customer with this name already exists.");
    }
    await this.audit("delivery_customer.created", "delivery_customer", customer.delivery_customer_id, null, customer, actorPersonId);
    return customer;
  }

  async updateCustomer(customerId: string, body: RecordBody, actorPersonId: string) {
    const existing = await this.db.one<any>("SELECT * FROM ops_delivery_customers WHERE delivery_customer_id=$1", [customerId]);
    if (!existing) throw new NotFoundException("Delivery customer not found.");
    const updated = {
      ...existing,
      contact: body.contact !== undefined ? (body.contact ? String(body.contact) : null) : existing.contact,
      notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : existing.notes,
      contract_price_ngn: body.contract_price_ngn !== undefined ? Number(body.contract_price_ngn) : Number(existing.contract_price_ngn),
      status: body.status !== undefined ? String(body.status) : existing.status,
      updated_at: this.now()
    };
    if (!(updated.contract_price_ngn > 0)) throw new BadRequestException("contract_price_ngn must be a positive amount.");
    if (!["active", "inactive"].includes(updated.status)) throw new BadRequestException("status must be active or inactive.");
    await this.db.exec(
      `UPDATE ops_delivery_customers SET contact=$2, notes=$3, contract_price_ngn=$4, status=$5, updated_at=$6
       WHERE delivery_customer_id=$1`,
      [customerId, updated.contact, updated.notes, updated.contract_price_ngn, updated.status, updated.updated_at]
    );
    await this.audit("delivery_customer.updated", "delivery_customer", customerId, existing, updated, actorPersonId);
    return updated;
  }

  // Hard-delete a delivery customer — only when nothing references it (a
  // mis-named or duplicate entry). If batches or imports exist, the history
  // must be preserved, so we refuse and point the admin at "set inactive".
  async deleteCustomer(customerId: string, actorPersonId: string) {
    const existing = await this.db.one<any>("SELECT * FROM ops_delivery_customers WHERE delivery_customer_id=$1", [customerId]);
    if (!existing) throw new NotFoundException("Delivery customer not found.");
    const batch = await this.db.one<any>("SELECT batch_id FROM ops_delivery_batches WHERE delivery_customer_id=$1 LIMIT 1", [customerId]);
    if (batch) throw new ConflictException("This customer has delivery batches; set it inactive instead of deleting.");
    const imported = await this.db.one<any>("SELECT import_id FROM ops_delivery_imports WHERE delivery_customer_id=$1 LIMIT 1", [customerId]);
    if (imported) throw new ConflictException("This customer has import history; set it inactive instead of deleting.");
    // Courier aliases point at the customer optionally — clear them first.
    await this.db.exec("DELETE FROM ops_delivery_courier_aliases WHERE delivery_customer_id=$1", [customerId]);
    await this.db.exec("DELETE FROM ops_delivery_customers WHERE delivery_customer_id=$1", [customerId]);
    await this.audit("delivery_customer.deleted", "delivery_customer", customerId, existing, null, actorPersonId);
    return { delivery_customer_id: customerId, deleted: true };
  }

  /* ---------------- batches ---------------- */

  private async loadBatch(batchId: string) {
    const batch = await this.db.one<any>("SELECT * FROM ops_delivery_batches WHERE batch_id=$1", [batchId]);
    if (!batch) throw new NotFoundException("Delivery batch not found.");
    return batch;
  }

  private assertOpen(batch: any) {
    if (batch.status === "closed") throw new ConflictException("This batch is closed; its counts are locked.");
  }

  async listBatches(
    filters: { date_from?: string; date_to?: string; customer_id?: string; status?: string; record_date?: string },
    scope: OpsDataScope = {}
  ) {
    const from = this.date(filters.date_from || filters.record_date || this.now().slice(0, 10), "date_from");
    const to = this.date(filters.date_to || filters.record_date || from, "date_to");
    const params: unknown[] = [from, to];
    const clauses = ["b.batch_date BETWEEN $1 AND $2"];
    if (filters.customer_id) {
      params.push(filters.customer_id);
      clauses.push(`b.delivery_customer_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`b.status = $${params.length}`);
    }
    this.scopeClause(clauses, params, scope);
    const rows = await this.db.many<any>(
      `SELECT b.*, c.name AS customer_name, c.contract_price_ngn,
        COALESCE(a.assigned_count, 0) AS assigned_count,
        COALESCE(a.delivered_count, 0) AS delivered_count,
        COALESCE(a.failed_count, 0) AS failed_count,
        COALESCE(a.returned_count, 0) AS returned_count,
        COALESCE(a.driver_count, 0) AS driver_count,
        COALESCE(e.open_exceptions, 0) AS open_exceptions
       FROM ops_delivery_batches b
       JOIN ops_delivery_customers c ON c.delivery_customer_id = b.delivery_customer_id
       LEFT JOIN (
         SELECT batch_id, SUM(assigned_count) AS assigned_count, SUM(delivered_count) AS delivered_count,
           SUM(failed_count) AS failed_count, SUM(returned_count) AS returned_count, COUNT(*) AS driver_count
         FROM ops_delivery_assignments GROUP BY batch_id
       ) a ON a.batch_id = b.batch_id
       LEFT JOIN (
         SELECT batch_id, COUNT(*) AS open_exceptions FROM ops_delivery_exceptions WHERE status='open' GROUP BY batch_id
       ) e ON e.batch_id = b.batch_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY b.batch_date DESC, b.created_at DESC`,
      params
    );
    const enriched = [];
    for (const row of rows) {
      const batchDate = this.dayKey(row.batch_date);
      const allocated = await this.allocatedPriceFor(batchDate);
      const delivered = Number(row.delivered_count);
      enriched.push({
        ...row,
        allocated_price_ngn: allocated,
        delivered_value_allocated_ngn: Math.round(delivered * allocated * 100) / 100,
        delivered_value_contract_ngn: Math.round(delivered * Number(row.contract_price_ngn) * 100) / 100,
        packages_outstanding: Math.max(0, Number(row.received_count) - delivered - Number(row.failed_count) - Number(row.returned_count))
      });
    }
    return enriched;
  }

  async createBatch(body: RecordBody, actorPersonId: string, scope: OpsDataScope = {}) {
    for (const field of ["delivery_customer_id", "amoeba_id", "batch_date"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    const customer = await this.db.one<any>(
      "SELECT * FROM ops_delivery_customers WHERE delivery_customer_id=$1 AND status='active'",
      [String(body.delivery_customer_id)]
    );
    if (!customer) throw new BadRequestException("Choose an active delivery customer.");
    const timestamp = this.now();
    const batch = {
      batch_id: this.id("dbatch"),
      delivery_customer_id: customer.delivery_customer_id,
      amoeba_id: String(body.amoeba_id),
      batch_date: this.date(body.batch_date),
      manifest_ref: body.manifest_ref ? String(body.manifest_ref) : null,
      status: "open",
      expected_count: this.count(body.expected_count ?? 0, "expected_count"),
      received_count: this.count(body.received_count ?? 0, "received_count"),
      sorted_count: this.count(body.sorted_count ?? 0, "sorted_count"),
      counts_source: this.source(body.counts_source),
      notes: body.notes ? String(body.notes) : null,
      created_by_person_id: actorPersonId,
      closed_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_batches
        (batch_id, delivery_customer_id, amoeba_id, batch_date, manifest_ref, status,
         expected_count, received_count, sorted_count, counts_source, notes,
         created_by_person_id, closed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      Object.values(batch)
    );
    await this.audit("delivery_batch.created", "delivery_batch", batch.batch_id, null, batch, actorPersonId);
    return { ...batch, customer_name: customer.name };
  }

  async updateBatchCounts(batchId: string, body: RecordBody, actorPersonId: string) {
    const batch = await this.loadBatch(batchId);
    this.assertOpen(batch);
    const updated = {
      expected_count: body.expected_count !== undefined ? this.count(body.expected_count, "expected_count") : Number(batch.expected_count),
      received_count: body.received_count !== undefined ? this.count(body.received_count, "received_count") : Number(batch.received_count),
      sorted_count: body.sorted_count !== undefined ? this.count(body.sorted_count, "sorted_count") : Number(batch.sorted_count),
      counts_source: this.source(body.counts_source ?? batch.counts_source),
      notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : batch.notes,
      status: batch.status === "open" ? "in_progress" : batch.status
    };
    await this.db.exec(
      `UPDATE ops_delivery_batches SET expected_count=$2, received_count=$3, sorted_count=$4,
        counts_source=$5, notes=$6, status=$7, updated_at=$8 WHERE batch_id=$1`,
      [batchId, updated.expected_count, updated.received_count, updated.sorted_count,
        updated.counts_source, updated.notes, updated.status, this.now()]
    );
    await this.audit("delivery_batch.counts_updated", "delivery_batch", batchId, batch, updated, actorPersonId);
    return { ...batch, ...updated };
  }

  async closeBatch(batchId: string, body: RecordBody, actorPersonId: string) {
    const batch = await this.loadBatch(batchId);
    if (batch.status === "closed") return batch;
    const timestamp = this.now();
    await this.db.exec(
      "UPDATE ops_delivery_batches SET status='closed', closed_at=$2, notes=COALESCE($3, notes), updated_at=$2 WHERE batch_id=$1",
      [batchId, timestamp, body.notes ? String(body.notes) : null]
    );
    await this.audit("delivery_batch.closed", "delivery_batch", batchId, batch, { status: "closed", closed_at: timestamp }, actorPersonId);
    return { ...batch, status: "closed", closed_at: timestamp };
  }

  /* ---------------- assignments ---------------- */

  async assignOperator(batchId: string, body: RecordBody, actorPersonId: string) {
    const batch = await this.loadBatch(batchId);
    this.assertOpen(batch);
    if (!body.operator_id) throw new BadRequestException("operator_id is required.");
    const operator = await this.db.one<any>(
      "SELECT operator_id FROM ops_operators WHERE operator_id=$1 AND operator_status='active'",
      [String(body.operator_id)]
    );
    if (!operator) throw new BadRequestException("Choose an active operator.");
    const assignedCount = this.count(body.assigned_count, "assigned_count");
    if (assignedCount === 0) throw new BadRequestException("assigned_count must be at least 1.");
    const timestamp = this.now();
    const assignment = {
      assignment_id: this.id("dassign"),
      batch_id: batchId,
      operator_id: operator.operator_id,
      assigned_count: assignedCount,
      delivered_count: 0,
      failed_count: 0,
      returned_count: 0,
      status: "assigned",
      counts_source: this.source(body.counts_source),
      updated_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_assignments
        (assignment_id, batch_id, operator_id, assigned_count, delivered_count, failed_count,
         returned_count, status, counts_source, updated_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (batch_id, operator_id) DO UPDATE SET
        assigned_count = EXCLUDED.assigned_count,
        counts_source = EXCLUDED.counts_source,
        updated_by_person_id = EXCLUDED.updated_by_person_id,
        updated_at = EXCLUDED.updated_at`,
      Object.values(assignment)
    );
    const saved = await this.db.one<any>(
      "SELECT * FROM ops_delivery_assignments WHERE batch_id=$1 AND operator_id=$2",
      [batchId, operator.operator_id]
    );
    await this.audit("delivery_assignment.saved", "delivery_assignment", saved.assignment_id, null, saved, actorPersonId);
    return saved;
  }

  // Riders may record their own progress (D1 revised): resolves whether the
  // actor person owns the assignment.
  async assignmentOwnedBy(assignmentId: string, personId: string) {
    const row = await this.db.one<any>(
      `SELECT a.assignment_id FROM ops_delivery_assignments a
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE a.assignment_id = $1 AND o.person_id = $2`,
      [assignmentId, personId]
    );
    return Boolean(row);
  }

  async confirmAssignment(assignmentId: string, actorPersonId: string) {
    const assignment = await this.db.one<any>("SELECT * FROM ops_delivery_assignments WHERE assignment_id=$1", [assignmentId]);
    if (!assignment) throw new NotFoundException("Delivery assignment not found.");
    const timestamp = this.now();
    await this.db.exec(
      "UPDATE ops_delivery_assignments SET supervisor_confirmed_at=$2, updated_at=$2 WHERE assignment_id=$1",
      [assignmentId, timestamp]
    );
    await this.audit("delivery_assignment.confirmed", "delivery_assignment", assignmentId, assignment, { supervisor_confirmed_at: timestamp }, actorPersonId);
    return { ...assignment, supervisor_confirmed_at: timestamp };
  }

  /* ---------------- stops (optional per batch) ---------------- */

  async createStops(batchId: string, body: RecordBody, actorPersonId: string) {
    const batch = await this.loadBatch(batchId);
    this.assertOpen(batch);
    const rows = Array.isArray(body.stops) ? body.stops : [body];
    if (!rows.length) throw new BadRequestException("Provide at least one stop.");
    const timestamp = this.now();
    const created = [];
    for (const [index, row] of (rows as RecordBody[]).entries()) {
      if (!row.customer_name) throw new BadRequestException(`stops[${index}].customer_name is required.`);
      let assignmentId: string | null = null;
      if (row.assignment_id) {
        const assignment = await this.db.one<any>(
          "SELECT assignment_id FROM ops_delivery_assignments WHERE assignment_id=$1 AND batch_id=$2",
          [String(row.assignment_id), batchId]
        );
        if (!assignment) throw new BadRequestException(`stops[${index}].assignment_id does not belong to this batch.`);
        assignmentId = assignment.assignment_id;
      }
      const stop = {
        stop_id: this.id("dstop"),
        batch_id: batchId,
        assignment_id: assignmentId,
        sequence: this.count(row.sequence ?? index + 1, "sequence"),
        customer_name: String(row.customer_name).trim(),
        address: row.address ? String(row.address) : null,
        phone: row.phone ? String(row.phone).replace(/\s+/g, "") : null,
        parcel_count: Math.max(1, this.count(row.parcel_count ?? 1, "parcel_count")),
        status: "pending",
        failed_reason: null,
        notes: row.notes ? String(row.notes) : null,
        media_ids: [] as string[],
        arrival_at: null,
        completed_at: null,
        recorded_by_person_id: actorPersonId,
        created_at: timestamp,
        updated_at: timestamp
      };
      await this.db.exec(
        `INSERT INTO ops_delivery_stops
          (stop_id, batch_id, assignment_id, sequence, customer_name, address, phone, parcel_count,
           status, failed_reason, notes, media_ids, arrival_at, completed_at, recorded_by_person_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        Object.values(stop)
      );
      created.push(stop);
    }
    await this.audit("delivery_stops.created", "delivery_batch", batchId, null, { count: created.length }, actorPersonId);
    return created;
  }

  async listStops(filters: { batch_id?: string; assignment_id?: string; date_from?: string; date_to?: string }, scope: OpsDataScope = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.batch_id) { params.push(filters.batch_id); clauses.push(`s.batch_id = $${params.length}`); }
    if (filters.assignment_id) { params.push(filters.assignment_id); clauses.push(`s.assignment_id = $${params.length}`); }
    if (filters.date_from || filters.date_to) {
      const from = this.date(filters.date_from || this.now().slice(0, 10), "date_from");
      const to = this.date(filters.date_to || from, "date_to");
      params.push(from, to);
      clauses.push(`b.batch_date BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    if (!scope.unrestricted && scope.person_id) {
      params.push(scope.person_id);
      clauses.push(`o.person_id = $${params.length}`);
    } else {
      this.scopeClause(clauses, params, scope, "b");
    }
    return this.db.many(
      `SELECT s.*, b.batch_date, c.name AS delivery_customer_name, a.operator_id
       FROM ops_delivery_stops s
       JOIN ops_delivery_batches b ON b.batch_id = s.batch_id
       JOIN ops_delivery_customers c ON c.delivery_customer_id = b.delivery_customer_id
       LEFT JOIN ops_delivery_assignments a ON a.assignment_id = s.assignment_id
       LEFT JOIN ops_operators o ON o.operator_id = a.operator_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY b.batch_date DESC, s.sequence ASC`,
      params
    );
  }

  // Stop transitions drive the assignment counts, keeping one derivation
  // chain: stop -> assignment -> batch totals.
  async updateStopStatus(stopId: string, body: RecordBody, actorPersonId: string, asOperator: boolean) {
    const stop = await this.db.one<any>("SELECT * FROM ops_delivery_stops WHERE stop_id=$1", [stopId]);
    if (!stop) throw new NotFoundException("Delivery stop not found.");
    const batch = await this.loadBatch(stop.batch_id);
    this.assertOpen(batch);
    const status = String(body.status || "");
    if (!stopStatuses.has(status)) throw new BadRequestException(`status must be one of: ${[...stopStatuses].join(", ")}.`);
    if (["delivered", "failed"].includes(stop.status)) throw new ConflictException("This stop is already completed.");
    const failedReason = status === "failed" ? String(body.failed_reason || "") : null;
    if (status === "failed" && !failedReasons.has(failedReason as string)) {
      throw new BadRequestException(`failed_reason is required and must be one of: ${[...failedReasons].join(", ")}.`);
    }
    const mediaIds = Array.isArray(body.media_ids) ? body.media_ids.map(String) : [];
    const timestamp = this.now();
    await this.db.exec(
      `UPDATE ops_delivery_stops SET status=$2, failed_reason=$3,
        notes=COALESCE($4, notes),
        media_ids=(media_ids || $5::jsonb),
        arrival_at=CASE WHEN $2='arrived' AND arrival_at IS NULL THEN $6::timestamptz ELSE arrival_at END,
        completed_at=CASE WHEN $2 IN ('delivered','failed') THEN $6::timestamptz ELSE completed_at END,
        recorded_by_person_id=$7, updated_at=$6 WHERE stop_id=$1`,
      [stopId, status, failedReason, body.notes ? String(body.notes) : null,
       JSON.stringify(mediaIds), timestamp, actorPersonId]
    );
    if (["delivered", "failed"].includes(status) && stop.assignment_id) {
      const column = status === "delivered" ? "delivered_count" : "failed_count";
      await this.db.exec(
        `UPDATE ops_delivery_assignments SET ${column} = ${column} + $2,
          counts_source = $3, status = 'out_for_delivery', updated_by_person_id = $4, updated_at = $5
         WHERE assignment_id = $1`,
        [stop.assignment_id, Number(stop.parcel_count), asOperator ? "operator_manual" : "customer_app_manual", actorPersonId, timestamp]
      );
    }
    await this.audit(`delivery_stop.${status}`, "delivery_stop", stopId, stop, { status, failed_reason: failedReason }, actorPersonId);
    return this.db.one("SELECT * FROM ops_delivery_stops WHERE stop_id=$1", [stopId]);
  }

  async updateAssignment(assignmentId: string, body: RecordBody, actorPersonId: string) {
    const assignment = await this.db.one<any>("SELECT * FROM ops_delivery_assignments WHERE assignment_id=$1", [assignmentId]);
    if (!assignment) throw new NotFoundException("Delivery assignment not found.");
    const batch = await this.loadBatch(assignment.batch_id);
    this.assertOpen(batch);
    const updated = {
      delivered_count: body.delivered_count !== undefined ? this.count(body.delivered_count, "delivered_count") : Number(assignment.delivered_count),
      failed_count: body.failed_count !== undefined ? this.count(body.failed_count, "failed_count") : Number(assignment.failed_count),
      returned_count: body.returned_count !== undefined ? this.count(body.returned_count, "returned_count") : Number(assignment.returned_count),
      status: body.status !== undefined ? String(body.status) : assignment.status,
      counts_source: this.source(body.counts_source ?? assignment.counts_source)
    };
    if (!assignmentStatuses.has(updated.status)) {
      throw new BadRequestException(`status must be one of: ${[...assignmentStatuses].join(", ")}.`);
    }
    if (updated.delivered_count + updated.failed_count > Number(assignment.assigned_count)) {
      throw new BadRequestException("delivered + failed cannot exceed the assigned count.");
    }
    await this.db.exec(
      `UPDATE ops_delivery_assignments SET delivered_count=$2, failed_count=$3, returned_count=$4,
        status=$5, counts_source=$6, updated_by_person_id=$7, updated_at=$8 WHERE assignment_id=$1`,
      [assignmentId, updated.delivered_count, updated.failed_count, updated.returned_count,
        updated.status, updated.counts_source, actorPersonId, this.now()]
    );
    await this.audit("delivery_assignment.updated", "delivery_assignment", assignmentId, assignment, updated, actorPersonId);
    return { ...assignment, ...updated };
  }

  async listAssignments(
    filters: { date_from?: string; date_to?: string; operator_id?: string },
    scope: OpsDataScope = {}
  ) {
    const from = this.date(filters.date_from || this.now().slice(0, 10), "date_from");
    const to = this.date(filters.date_to || from, "date_to");
    const params: unknown[] = [from, to];
    const clauses = ["b.batch_date BETWEEN $1 AND $2"];
    if (filters.operator_id) {
      params.push(filters.operator_id);
      clauses.push(`a.operator_id = $${params.length}`);
    }
    if (!scope.unrestricted) {
      if (scope.person_id) {
        params.push(scope.person_id);
        clauses.push(`o.person_id = $${params.length}`);
      } else if (scope.supervisor_person_id) {
        params.push(scope.supervisor_person_id);
        clauses.push(`o.supervisor_person_id = $${params.length}`);
      } else if (scope.amoeba_ids?.length) {
        const placeholders = scope.amoeba_ids.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        clauses.push(`b.amoeba_id IN (${placeholders.join(", ")})`);
      } else {
        clauses.push("FALSE");
      }
    }
    const rows = await this.db.many<any>(
      `SELECT a.*, b.batch_date, b.status AS batch_status, b.amoeba_id, b.delivery_customer_id, c.name AS customer_name,
        o.person_id, o.operator_class
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       JOIN ops_delivery_customers c ON c.delivery_customer_id = b.delivery_customer_id
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY b.batch_date DESC, a.created_at ASC`,
      params
    );
    const enriched = [];
    for (const row of rows) {
      const operatorClass = String(row.operator_class || "rider");
      const { price_ngn: allocated, daily_basic_ngn: basic } = await this.allocatedRateFor(this.dayKey(row.batch_date), operatorClass, row.delivery_customer_id);
      enriched.push({
        ...row,
        allocated_price_ngn: allocated,
        // Exposed for display; the fixed basic is applied once per operator-day
        // in the rollups (operatorAllocatedTotals), not per-assignment, so a
        // driver on two batches is not paid the basic twice.
        daily_basic_ngn: basic,
        target_value_allocated_ngn: Math.round(Number(row.assigned_count) * allocated * 100) / 100,
        earned_value_allocated_ngn: Math.round(Number(row.delivered_count) * allocated * 100) / 100
      });
    }
    return enriched;
  }

  /* ---------------- exceptions ---------------- */

  async createException(batchId: string, body: RecordBody, actorPersonId: string) {
    const batch = await this.loadBatch(batchId);
    const category = String(body.category || "");
    if (!exceptionCategories.has(category)) {
      throw new BadRequestException(`category must be one of: ${[...exceptionCategories].join(", ")}.`);
    }
    if (body.assignment_id) {
      const assignment = await this.db.one<any>(
        "SELECT assignment_id FROM ops_delivery_assignments WHERE assignment_id=$1 AND batch_id=$2",
        [String(body.assignment_id), batchId]
      );
      if (!assignment) throw new BadRequestException("assignment_id does not belong to this batch.");
    }
    const mediaIds = Array.isArray(body.media_ids) ? body.media_ids.map(String) : [];
    const timestamp = this.now();
    const exception = {
      exception_id: this.id("dexception"),
      batch_id: batchId,
      assignment_id: body.assignment_id ? String(body.assignment_id) : null,
      category,
      note: body.note ? String(body.note) : null,
      media_ids: mediaIds,
      status: "open",
      resolution_notes: null,
      resolved_at: null,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_exceptions
        (exception_id, batch_id, assignment_id, category, note, media_ids, status,
         resolution_notes, resolved_at, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      Object.values(exception)
    );
    await this.audit("delivery_exception.created", "delivery_exception", exception.exception_id, null, exception, actorPersonId);
    return exception;
  }

  async resolveException(exceptionId: string, body: RecordBody, actorPersonId: string) {
    const exception = await this.db.one<any>("SELECT * FROM ops_delivery_exceptions WHERE exception_id=$1", [exceptionId]);
    if (!exception) throw new NotFoundException("Delivery exception not found.");
    if (exception.status === "resolved") return exception;
    const timestamp = this.now();
    await this.db.exec(
      "UPDATE ops_delivery_exceptions SET status='resolved', resolution_notes=$2, resolved_at=$3, updated_at=$3 WHERE exception_id=$1",
      [exceptionId, body.resolution_notes ? String(body.resolution_notes) : null, timestamp]
    );
    await this.audit("delivery_exception.resolved", "delivery_exception", exceptionId, exception, { status: "resolved" }, actorPersonId);
    return { ...exception, status: "resolved", resolved_at: timestamp };
  }

  async listExceptions(filters: { batch_id?: string; status?: string }, scope: OpsDataScope = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.batch_id) {
      params.push(filters.batch_id);
      clauses.push(`x.batch_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`x.status = $${params.length}`);
    }
    this.scopeClause(clauses, params, scope, "b");
    return this.db.many(
      `SELECT x.*, b.batch_date, b.amoeba_id, c.name AS customer_name
       FROM ops_delivery_exceptions x
       JOIN ops_delivery_batches b ON b.batch_id = x.batch_id
       JOIN ops_delivery_customers c ON c.delivery_customer_id = b.delivery_customer_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY x.created_at DESC`,
      params
    );
  }

  /* ---------------- rollups for other surfaces ---------------- */

  // Per-operator allocated earnings/targets over a period — consumed by the
  // leaderboard so delivery days score like on-demand days (spec §5 D2).
  async operatorAllocatedTotals(periodStart: string, periodEnd: string) {
    const rows = await this.db.many<any>(
      `SELECT a.operator_id, o.operator_class, b.batch_date, b.delivery_customer_id,
        SUM(a.assigned_count) AS assigned_count,
        SUM(a.delivered_count) AS delivered_count
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE b.batch_date BETWEEN $1 AND $2
       GROUP BY a.operator_id, o.operator_class, b.batch_date, b.delivery_customer_id`,
      [periodStart, periodEnd]
    );
    const totals = new Map<string, { earned: number; target: number; days: Set<string> }>();
    for (const row of rows) {
      const date = this.dayKey(row.batch_date);
      const operatorClass = String(row.operator_class || "rider");
      const { price_ngn: allocated, daily_basic_ngn: basic } = await this.allocatedRateFor(date, operatorClass, row.delivery_customer_id);
      const entry = totals.get(row.operator_id) || { earned: 0, target: 0, days: new Set<string>() };
      // Fixed daily basic (drivers) is added once per delivery-day.
      const firstBatchOfDay = !entry.days.has(date);
      entry.earned += Number(row.delivered_count) * allocated + (firstBatchOfDay ? basic : 0);
      entry.target += Number(row.assigned_count) * allocated + (firstBatchOfDay ? basic : 0);
      entry.days.add(date);
      totals.set(row.operator_id, entry);
    }
    return totals;
  }

  // Per-operator schedule for a single day — assigned/delivered parcel counts
  // and attributed earnings (daily basic applied once). Feeds the pacing engine
  // (online target, delivery pacing) without the leaderboard's range rollup.
  async operatorScheduleForDate(date: string) {
    const rows = await this.db.many<any>(
      `SELECT a.operator_id, o.operator_class, b.delivery_customer_id,
        SUM(a.assigned_count) AS assigned_count,
        SUM(a.delivered_count) AS delivered_count
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE b.batch_date BETWEEN $1 AND $1
       GROUP BY a.operator_id, o.operator_class, b.delivery_customer_id`,
      [date]
    );
    const out = new Map<string, { assigned: number; delivered: number; earned: number }>();
    const basicApplied = new Set<string>();
    for (const row of rows) {
      const operatorClass = String(row.operator_class || "rider");
      const { price_ngn: allocated, daily_basic_ngn: basic } =
        await this.allocatedRateFor(this.dayKey(date), operatorClass, row.delivery_customer_id);
      const entry = out.get(row.operator_id) || { assigned: 0, delivered: 0, earned: 0 };
      const firstBatchOfDay = !basicApplied.has(row.operator_id);
      entry.assigned += Number(row.assigned_count);
      entry.delivered += Number(row.delivered_count);
      entry.earned += Number(row.delivered_count) * allocated + (firstBatchOfDay ? basic : 0);
      basicApplied.add(row.operator_id);
      out.set(row.operator_id, entry);
    }
    return out;
  }

  // Per-amoeba contract/allocated rollup for P&L and manager/analytics.
  async amoebaDeliveryTotals(periodStart: string, periodEnd: string) {
    const rows = await this.db.many<any>(
      `SELECT b.amoeba_id, b.batch_date, c.contract_price_ngn,
        SUM(a.delivered_count) AS delivered_count
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       JOIN ops_delivery_customers c ON c.delivery_customer_id = b.delivery_customer_id
       WHERE b.batch_date BETWEEN $1 AND $2
       GROUP BY b.amoeba_id, b.batch_date, c.contract_price_ngn`,
      [periodStart, periodEnd]
    );
    const totals = new Map<string, { contract: number; allocated: number; delivered: number }>();
    for (const row of rows) {
      const date = this.dayKey(row.batch_date);
      const allocated = await this.allocatedPriceFor(date);
      const delivered = Number(row.delivered_count);
      const entry = totals.get(row.amoeba_id) || { contract: 0, allocated: 0, delivered: 0 };
      entry.contract += delivered * Number(row.contract_price_ngn);
      entry.allocated += delivered * allocated;
      entry.delivered += delivered;
      totals.set(row.amoeba_id, entry);
    }
    return totals;
  }

  async deliverySummary(filters: { date_from?: string; date_to?: string }, scope: OpsDataScope = {}) {
    const batches = await this.listBatches(filters, scope);
    const summary = batches.reduce(
      (totals: any, batch: any) => {
        totals.batches += 1;
        totals.open_batches += batch.status === "closed" ? 0 : 1;
        totals.expected += Number(batch.expected_count);
        totals.received += Number(batch.received_count);
        totals.delivered += Number(batch.delivered_count);
        totals.failed += Number(batch.failed_count);
        totals.returned += Number(batch.returned_count);
        totals.packages_outstanding += Number(batch.packages_outstanding);
        totals.open_exceptions += Number(batch.open_exceptions);
        totals.delivered_value_allocated_ngn += Number(batch.delivered_value_allocated_ngn);
        totals.delivered_value_contract_ngn += Number(batch.delivered_value_contract_ngn);
        return totals;
      },
      {
        batches: 0, open_batches: 0, expected: 0, received: 0, delivered: 0, failed: 0,
        returned: 0, packages_outstanding: 0, open_exceptions: 0,
        delivered_value_allocated_ngn: 0, delivered_value_contract_ngn: 0
      }
    );
    summary.margin_ngn = Math.round((summary.delivered_value_contract_ngn - summary.delivered_value_allocated_ngn) * 100) / 100;
    return summary;
  }
}
