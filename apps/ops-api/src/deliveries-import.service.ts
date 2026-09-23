import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { parseDeliveryExport } from "./xlsx-lite.js";
import { SpeedafConnector, speedafConfigFromEnv } from "./connectors/speedaf.connector.js";

type RecordBody = Record<string, unknown>;

// Speedaf's Delivery Waybill export has no API behind it, but the columns are
// stable. We ingest the parsed rows (the browser / headless connector does the
// xlsx→rows step) and fold them onto the EXISTING batch/assignment model with
// counts_source = customer_app_import. No parallel data model — the import is
// just another writer of the same counts the supervisor sees.
export type SpeedafRow = {
  waybill_no?: string;
  waybill_status?: string;
  last_scan?: string;
  last_scan_time?: string;
  site_of_last_scan?: string;
  delivery_type?: string;
  courier?: string;
  attempts?: number | string;
};

// Map Speedaf's status vocabulary onto our four count buckets. "Signed" is the
// only POD-closed state; everything still moving is "out" (not yet counted).
function classifyStatus(waybillStatus: string, lastScan: string): "delivered" | "returned" | "exception" | "out" {
  const value = `${waybillStatus} ${lastScan}`.toLowerCase();
  if (value.includes("signed") && !value.includes("abnormal")) return "delivered";
  if (value.includes("return")) return "returned";
  if (value.includes("abnormal") || value.includes("duplicate") || value.includes("self-pickup") || value.includes("self pickup")) {
    return "exception";
  }
  return "out"; // Delivering, To Deliver, In Transit, Picked Up …
}

function normaliseCourier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

@Injectable()
export class DeliveriesImportService {
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

  private date(value: unknown, field = "batch_date") {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date.`);
    }
    return text;
  }

  /* ---------------- courier aliases ---------------- */

  async listAliases(customerId?: string) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (customerId) {
      params.push(customerId);
      clauses.push(`al.delivery_customer_id = $${params.length}`);
    }
    return this.db.many(
      `SELECT al.*, o.person_id, o.amoeba_id, o.operator_class
       FROM ops_delivery_courier_aliases al
       JOIN ops_operators o ON o.operator_id = al.operator_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY al.display_seen ASC`,
      params
    );
  }

  async upsertAlias(body: RecordBody, actorPersonId: string) {
    const courierName = String(body.courier_name || body.display_seen || "").trim();
    if (!courierName) throw new BadRequestException("courier_name is required.");
    if (!body.operator_id) throw new BadRequestException("operator_id is required.");
    const operator = await this.db.one<any>(
      "SELECT operator_id FROM ops_operators WHERE operator_id=$1",
      [String(body.operator_id)]
    );
    if (!operator) throw new NotFoundException("Operator not found.");
    const customerId = body.delivery_customer_id ? String(body.delivery_customer_id) : null;
    const courierNorm = normaliseCourier(courierName);
    const timestamp = this.now();
    const existing = await this.db.one<any>(
      `SELECT * FROM ops_delivery_courier_aliases
       WHERE courier_norm=$1 AND ((delivery_customer_id IS NULL AND $2::text IS NULL) OR delivery_customer_id=$2)`,
      [courierNorm, customerId]
    );
    if (existing) {
      await this.db.exec(
        "UPDATE ops_delivery_courier_aliases SET operator_id=$2, display_seen=$3, updated_at=$4 WHERE alias_id=$1",
        [existing.alias_id, operator.operator_id, courierName, timestamp]
      );
      const updated = { ...existing, operator_id: operator.operator_id, display_seen: courierName, updated_at: timestamp };
      await this.ops.audit("delivery_courier_alias.updated", "delivery_courier_alias", existing.alias_id, existing, updated, actorPersonId);
      return updated;
    }
    const record = {
      alias_id: this.id("calias"),
      delivery_customer_id: customerId,
      courier_norm: courierNorm,
      display_seen: courierName,
      operator_id: operator.operator_id,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_courier_aliases
        (alias_id, delivery_customer_id, courier_norm, display_seen, operator_id, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      Object.values(record)
    );
    await this.ops.audit("delivery_courier_alias.created", "delivery_courier_alias", record.alias_id, null, record, actorPersonId);
    return record;
  }

  private async resolveOperator(customerId: string, courierNorm: string) {
    // Prefer a customer-specific alias, then a global (customer-null) one.
    const row = await this.db.one<any>(
      `SELECT al.operator_id, o.amoeba_id, o.operator_class
       FROM ops_delivery_courier_aliases al
       JOIN ops_operators o ON o.operator_id = al.operator_id
       WHERE al.courier_norm=$1 AND (al.delivery_customer_id=$2 OR al.delivery_customer_id IS NULL)
       ORDER BY (al.delivery_customer_id = $2) DESC LIMIT 1`,
      [courierNorm, customerId]
    );
    return row || null;
  }

  /* ---------------- import ingest ---------------- */

  async listImports(filters: { date_from?: string; date_to?: string } = {}) {
    const to = this.date(filters.date_to || this.now().slice(0, 10), "date_to");
    const from = this.date(filters.date_from || to, "date_from");
    return this.db.many(
      `SELECT im.*, c.name AS customer_name
       FROM ops_delivery_imports im
       JOIN ops_delivery_customers c ON c.delivery_customer_id = im.delivery_customer_id
       WHERE im.batch_date BETWEEN $1 AND $2
       ORDER BY im.imported_at DESC`,
      [from, to]
    );
  }

  // Find (or make) the import-owned batch for a customer/amoeba/day. Import
  // batches are tagged manifest_ref='speedaf-import' so re-imports reuse them
  // and never collide with a supervisor's manual batch.
  private async importBatchFor(customerId: string, amoebaId: string, batchDate: string, actorPersonId: string) {
    const existing = await this.db.one<any>(
      `SELECT * FROM ops_delivery_batches
       WHERE delivery_customer_id=$1 AND amoeba_id=$2 AND batch_date=$3 AND manifest_ref='speedaf-import'
       LIMIT 1`,
      [customerId, amoebaId, batchDate]
    );
    if (existing) return existing;
    const timestamp = this.now();
    const batch = {
      batch_id: this.id("dbatch"),
      delivery_customer_id: customerId,
      amoeba_id: amoebaId,
      batch_date: batchDate,
      manifest_ref: "speedaf-import",
      status: "in_progress",
      expected_count: 0,
      received_count: 0,
      sorted_count: 0,
      counts_source: "customer_app_import",
      notes: null,
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
    await this.ops.audit("delivery_batch.created", "delivery_batch", batch.batch_id, null, batch, actorPersonId);
    return batch;
  }

  private async upsertAssignment(
    batchId: string,
    operatorId: string,
    counts: { assigned: number; delivered: number; failed: number; returned: number },
    actorPersonId: string
  ) {
    const timestamp = this.now();
    // Import is authoritative for its own batch: it sets the full count set,
    // overwriting a prior import of the same day (idempotent re-capture).
    await this.db.exec(
      `INSERT INTO ops_delivery_assignments
        (assignment_id, batch_id, operator_id, assigned_count, delivered_count, failed_count,
         returned_count, status, counts_source, updated_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'customer_app_import',$9,$10,$10)
       ON CONFLICT (batch_id, operator_id) DO UPDATE SET
        assigned_count = GREATEST(EXCLUDED.assigned_count, ops_delivery_assignments.assigned_count),
        delivered_count = EXCLUDED.delivered_count,
        failed_count = EXCLUDED.failed_count,
        returned_count = EXCLUDED.returned_count,
        status = EXCLUDED.status,
        counts_source = 'customer_app_import',
        updated_by_person_id = EXCLUDED.updated_by_person_id,
        updated_at = EXCLUDED.updated_at`,
      [
        this.id("dassign"), batchId, operatorId,
        Math.max(counts.assigned, counts.delivered + counts.failed + counts.returned),
        counts.delivered, counts.failed, counts.returned,
        counts.delivered + counts.failed + counts.returned >= counts.assigned ? "completed" : "out_for_delivery",
        actorPersonId, timestamp
      ]
    );
  }

  private parseAttempts(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  // Speedaf's "Last Scan Time" is an Excel serial (e.g. 46287.43, GMT+1). Turn
  // it into an ISO timestamp; fall back to Date.parse for real date strings.
  private excelToIso(value: unknown): string | null {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const serial = Number(text);
    if (Number.isFinite(serial) && serial > 1) {
      const ms = Math.round((serial - 25569) * 86400 * 1000); // Excel epoch 1899-12-30 -> Unix
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  private async upsertRawWaybill(raw: {
    customerId: string; batchDate: string; importId: string; capturedAt: string;
    waybillNo: string; waybillStatus: string | null; statusClass: string;
    courierNorm: string | null; courierDisplay: string | null; attempts: number | null;
    lastScan: string | null; lastScanAt: string | null; siteOfLastScan: string | null;
  }) {
    await this.db.exec(
      `INSERT INTO ops_speedaf_waybills
        (waybill_row_id, delivery_customer_id, batch_date, waybill_no, waybill_status, status_class,
         courier_norm, courier_display, attempts, last_scan, last_scan_at, site_of_last_scan, import_id, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (delivery_customer_id, batch_date, waybill_no) DO UPDATE SET
        waybill_status = EXCLUDED.waybill_status, status_class = EXCLUDED.status_class,
        courier_norm = EXCLUDED.courier_norm, courier_display = EXCLUDED.courier_display,
        attempts = EXCLUDED.attempts, last_scan = EXCLUDED.last_scan, last_scan_at = EXCLUDED.last_scan_at,
        site_of_last_scan = EXCLUDED.site_of_last_scan, import_id = EXCLUDED.import_id, captured_at = EXCLUDED.captured_at`,
      [
        this.id("wb"), raw.customerId, raw.batchDate, raw.waybillNo, raw.waybillStatus, raw.statusClass,
        raw.courierNorm, raw.courierDisplay, raw.attempts, raw.lastScan, raw.lastScanAt, raw.siteOfLastScan,
        raw.importId, raw.capturedAt
      ]
    );
  }

  // Per-courier reporting straight from the raw store — works with ZERO
  // mappings. Shows every courier's delivered/attempted counts and, where a
  // mapping exists, the operator it attributes to.
  async courierSummary(filters: { date_from?: string; date_to?: string; customer_id?: string } = {}) {
    const to = this.date(filters.date_to || this.now().slice(0, 10), "date_to");
    const from = this.date(filters.date_from || to, "date_from");
    const params: unknown[] = [from, to];
    const clauses = ["w.batch_date BETWEEN $1 AND $2"];
    if (filters.customer_id) { params.push(filters.customer_id); clauses.push(`w.delivery_customer_id = $${params.length}`); }
    return this.db.many(
      `SELECT w.courier_norm, MAX(w.courier_display) AS courier_display,
        COUNT(*) AS waybills,
        SUM(CASE WHEN w.status_class='delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN w.status_class='exception' THEN 1 ELSE 0 END) AS exceptions,
        SUM(CASE WHEN w.status_class='returned' THEN 1 ELSE 0 END) AS returned,
        SUM(CASE WHEN w.status_class='out' THEN 1 ELSE 0 END) AS out_for_delivery,
        al.operator_id, o.person_id, o.amoeba_id
       FROM ops_speedaf_waybills w
       LEFT JOIN ops_delivery_courier_aliases al
         ON al.courier_norm = w.courier_norm
         AND (al.delivery_customer_id = w.delivery_customer_id OR al.delivery_customer_id IS NULL)
       LEFT JOIN ops_operators o ON o.operator_id = al.operator_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY w.courier_norm, al.operator_id, o.person_id, o.amoeba_id
       ORDER BY delivered DESC, waybills DESC`,
      params
    );
  }

  async importSpeedaf(body: RecordBody, actorPersonId: string, scope: OpsDataScope = {}) {
    if (!body.delivery_customer_id) throw new BadRequestException("delivery_customer_id is required.");
    const customer = await this.db.one<any>(
      "SELECT delivery_customer_id, name FROM ops_delivery_customers WHERE delivery_customer_id=$1 AND status='active'",
      [String(body.delivery_customer_id)]
    );
    if (!customer) throw new BadRequestException("Choose an active delivery customer.");
    const batchDate = this.date(body.batch_date || this.now().slice(0, 10));
    // Accept already-parsed rows, or an .xlsx as base64 (manual upload / pull).
    let rows: SpeedafRow[] = Array.isArray(body.rows) ? (body.rows as SpeedafRow[]) : [];
    if (!rows.length && body.file_base64) {
      try {
        rows = parseDeliveryExport(Buffer.from(String(body.file_base64), "base64")) as SpeedafRow[];
      } catch (error: any) {
        throw new BadRequestException(`Could not read the export file: ${String(error?.message).slice(0, 160)}`);
      }
    }
    if (!rows.length) throw new BadRequestException("Provide export rows or an .xlsx file (file_base64).");
    const captureSource = String(body.capture_source || "manual_upload");
    const importId = this.id("dimport");
    const capturedAt = this.now();

    // STORAGE (always): persist every waybill raw — the system of record —
    // and build per-courier tallies. This does NOT depend on any courier being
    // mapped to an operator; ingestion is separate from attribution.
    type Tally = { assigned: number; delivered: number; failed: number; returned: number; display: string };
    const byCourier = new Map<string, Tally>();
    let deliveredTotal = 0;
    for (const row of rows) {
      const display = String(row.courier ?? "").trim();
      const norm = normaliseCourier(display);
      const bucket = classifyStatus(String(row.waybill_status ?? ""), String(row.last_scan ?? ""));
      if (bucket === "delivered") deliveredTotal += 1;
      const waybillNo = String(row.waybill_no ?? "").trim();
      if (waybillNo) {
        await this.upsertRawWaybill({
          customerId: customer.delivery_customer_id, batchDate, importId, capturedAt,
          waybillNo, waybillStatus: String(row.waybill_status ?? "") || null, statusClass: bucket,
          courierNorm: norm || null, courierDisplay: display || null,
          attempts: this.parseAttempts(row.attempts), lastScan: String(row.last_scan ?? "") || null,
          lastScanAt: this.excelToIso(row.last_scan_time), siteOfLastScan: String(row.site_of_last_scan ?? "") || null
        });
      }
      if (!norm) continue;
      const tally = byCourier.get(norm) || { assigned: 0, delivered: 0, failed: 0, returned: 0, display };
      tally.assigned += 1;
      if (bucket === "delivered") tally.delivered += 1;
      else if (bucket === "exception") tally.failed += 1;
      else if (bucket === "returned") tally.returned += 1;
      byCourier.set(norm, tally);
    }

    // ATTRIBUTION (optional): only couriers already mapped to an operator flow
    // into the operator batch/assignment model (for pay/performance). Unmapped
    // couriers are listed for later mapping — their raw data is already stored.
    let matched = 0;
    const unmapped: { courier: string; waybills: number }[] = [];
    const amoebaReceived = new Map<string, number>();
    const amoebaBatch = new Map<string, string>();

    for (const [norm, tally] of byCourier) {
      const resolved = await this.resolveOperator(customer.delivery_customer_id, norm);
      if (!resolved) {
        unmapped.push({ courier: tally.display, waybills: tally.assigned });
        continue;
      }
      const amoebaId = String(resolved.amoeba_id);
      let batchId = amoebaBatch.get(amoebaId);
      if (!batchId) {
        const batch = await this.importBatchFor(customer.delivery_customer_id, amoebaId, batchDate, actorPersonId);
        batchId = batch.batch_id;
        amoebaBatch.set(amoebaId, batchId);
      }
      await this.upsertAssignment(batchId, String(resolved.operator_id), tally, actorPersonId);
      amoebaReceived.set(amoebaId, (amoebaReceived.get(amoebaId) || 0) + tally.assigned);
      matched += 1;
    }

    // Roll the received/sorted counts up onto each import batch.
    for (const [amoebaId, batchId] of amoebaBatch) {
      const received = amoebaReceived.get(amoebaId) || 0;
      await this.db.exec(
        `UPDATE ops_delivery_batches
         SET expected_count = GREATEST(expected_count, $2), received_count = GREATEST(received_count, $2),
             sorted_count = GREATEST(sorted_count, $2), updated_at = $3
         WHERE batch_id = $1`,
        [batchId, received, this.now()]
      );
    }

    const importRecord = {
      import_id: importId,
      delivery_customer_id: customer.delivery_customer_id,
      batch_date: batchDate,
      capture_source: captureSource,
      file_name: body.file_name ? String(body.file_name) : null,
      row_count: rows.length,
      matched_count: matched,
      unmapped_count: unmapped.length,
      delivered_count: deliveredTotal,
      unmapped_couriers: unmapped,
      imported_by_person_id: actorPersonId,
      imported_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_delivery_imports
        (import_id, delivery_customer_id, batch_date, capture_source, file_name, row_count,
         matched_count, unmapped_count, delivered_count, unmapped_couriers, imported_by_person_id, imported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      Object.values(importRecord)
    );
    await this.ops.audit("delivery_import.speedaf", "delivery_import", importRecord.import_id, null, importRecord, actorPersonId);

    void scope; // scope is enforced at the controller (supervisor+); import writes are amoeba-derived
    return {
      ...importRecord,
      customer_name: customer.name,
      batches: [...amoebaBatch.entries()].map(([amoeba_id, batch_id]) => ({ amoeba_id, batch_id }))
    };
  }

  // Whether the scheduled headless pull is configured (env-gated, off by default).
  speedafConfigured() {
    return Boolean(speedafConfigFromEnv());
  }

  async speedafHealth() {
    const config = speedafConfigFromEnv();
    if (!config) return { status: "not_configured" as const, detail: "Set SPEEDAF_ACCOUNT/SPEEDAF_PASSWORD to arm the scheduled pull." };
    return new SpeedafConnector(config).healthCheck();
  }

  private async speedafCustomerId(): Promise<string | null> {
    if (process.env.SPEEDAF_CUSTOMER_ID) return process.env.SPEEDAF_CUSTOMER_ID;
    const row = await this.db.one<any>(
      "SELECT delivery_customer_id FROM ops_delivery_customers WHERE LOWER(name) LIKE '%speedaf%' AND status='active' ORDER BY created_at ASC LIMIT 1"
    );
    return row?.delivery_customer_id || null;
  }

  // Drives the portal headlessly and ingests today's export. Reuses the exact
  // importSpeedaf pipeline the manual upload uses (capture_source auto_pull).
  async pullSpeedaf(actorPersonId = "person_system", date?: string) {
    const config = speedafConfigFromEnv();
    if (!config) throw new BadRequestException("Speedaf pull is not configured (SPEEDAF_ACCOUNT/SPEEDAF_PASSWORD).");
    const customerId = await this.speedafCustomerId();
    if (!customerId) throw new BadRequestException("No active 'Speedaf' delivery customer found (set SPEEDAF_CUSTOMER_ID or create the customer).");
    const { rows, file_name } = await new SpeedafConnector(config).pullTodayRows();
    return this.importSpeedaf(
      { delivery_customer_id: customerId, batch_date: date || this.now().slice(0, 10), file_name, capture_source: "auto_pull", rows },
      actorPersonId
    );
  }
}
