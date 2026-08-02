import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";

type RecordBody = Record<string, unknown>;

// Sources for every recorded count — typed numbers must never be mistaken
// for scan truth (Scheduled-Deliveries-Spec-v0.2).
const countSources = new Set(["customer_app_manual", "customer_app_import", "customer_api", "fleximos_scan"]);
const exceptionCategories = new Set(["shortage", "damaged", "customer_dispute", "failed_delivery", "return_pending", "other"]);
const assignmentStatuses = new Set(["assigned", "out_for_delivery", "completed"]);

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

  /* ---------------- allocated price ---------------- */

  async allocatedPriceFor(date: string): Promise<number> {
    const row = await this.db.one<any>(
      `SELECT price_ngn FROM ops_delivery_allocated_prices
       WHERE effective_from <= $1 AND (effective_to IS NULL OR effective_to >= $1)
       ORDER BY effective_from DESC LIMIT 1`,
      [date]
    );
    return Number(row?.price_ngn || 0);
  }

  async listAllocatedPrices() {
    return this.db.many("SELECT * FROM ops_delivery_allocated_prices ORDER BY effective_from DESC");
  }

  async createAllocatedPrice(body: RecordBody, actorPersonId: string) {
    const price = Number(body.price_ngn);
    if (!(price > 0)) throw new BadRequestException("price_ngn must be a positive amount.");
    const record = {
      allocated_price_id: this.id("allocated"),
      price_ngn: price,
      effective_from: this.date(body.effective_from || this.now().slice(0, 10), "effective_from"),
      effective_to: body.effective_to ? this.date(body.effective_to, "effective_to") : null,
      created_by_person_id: actorPersonId,
      created_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_allocated_prices
        (allocated_price_id, price_ngn, effective_from, effective_to, created_by_person_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      Object.values(record)
    );
    await this.audit("delivery_allocated_price.created", "delivery_allocated_price", record.allocated_price_id, null, record, actorPersonId);
    return record;
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
      `SELECT a.*, b.batch_date, b.status AS batch_status, b.amoeba_id, c.name AS customer_name,
        o.person_id
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
      const allocated = await this.allocatedPriceFor(this.dayKey(row.batch_date));
      enriched.push({
        ...row,
        allocated_price_ngn: allocated,
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
      `SELECT a.operator_id, b.batch_date,
        SUM(a.assigned_count) AS assigned_count,
        SUM(a.delivered_count) AS delivered_count,
        COUNT(DISTINCT b.batch_date) AS delivery_days
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       WHERE b.batch_date BETWEEN $1 AND $2
       GROUP BY a.operator_id, b.batch_date`,
      [periodStart, periodEnd]
    );
    const totals = new Map<string, { earned: number; target: number; days: Set<string> }>();
    for (const row of rows) {
      const date = this.dayKey(row.batch_date);
      const allocated = await this.allocatedPriceFor(date);
      const entry = totals.get(row.operator_id) || { earned: 0, target: 0, days: new Set<string>() };
      entry.earned += Number(row.delivered_count) * allocated;
      entry.target += Number(row.assigned_count) * allocated;
      entry.days.add(date);
      totals.set(row.operator_id, entry);
    }
    return totals;
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
