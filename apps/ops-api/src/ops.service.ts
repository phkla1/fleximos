import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";

type RecordBody = Record<string, unknown>;

@Injectable()
export class OpsService {
  private readonly paymentsBase = process.env.PAYMENTS_API_BASE || "http://127.0.0.1:4040";
  private readonly serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }

  private now() {
    return new Date().toISOString();
  }

  lagosDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  private date(value: unknown) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new BadRequestException("record_date must be a valid YYYY-MM-DD date.");
    }
    return text;
  }

  private number(value: unknown, field: string, nullable = false) {
    if ((value === null || value === undefined || value === "") && nullable) return null;
    const result = Number(value ?? 0);
    if (!Number.isFinite(result) || result < 0) throw new BadRequestException(`${field} must be a non-negative number.`);
    return result;
  }

  private signedNumber(value: unknown, field: string) {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result)) throw new BadRequestException(`${field} must be a number.`);
    return result;
  }

  private checkpoints(value: unknown) {
    if (!Array.isArray(value) || value.length < 2) throw new BadRequestException("checkpoints must contain at least two entries.");
    return value.map((item: any) => {
      if (!/^\d{2}:\d{2}$/.test(String(item?.time || ""))) throw new BadRequestException("Each checkpoint requires time in HH:MM format.");
      const expectedPct = Number(this.number(item.expected_pct, "expected_pct"));
      if (expectedPct > 100) throw new BadRequestException("expected_pct cannot exceed 100.");
      return { time: item.time, expected_pct: expectedPct };
    }).sort((a, b) => a.time.localeCompare(b.time));
  }

  private expectedPct(checkpoints: any[], recordDate: string) {
    const today = this.lagosDate();
    if (recordDate < today) return 100;
    if (recordDate > today) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date());
    const currentMinutes = Number(parts.find((part) => part.type === "hour")?.value) * 60
      + Number(parts.find((part) => part.type === "minute")?.value);
    const points = checkpoints.map((item) => {
      const [hour, minute] = item.time.split(":").map(Number);
      return { minutes: hour * 60 + minute, pct: Number(item.expected_pct) };
    });
    if (currentMinutes <= points[0].minutes) return points[0].pct * currentMinutes / Math.max(1, points[0].minutes);
    for (let index = 1; index < points.length; index++) {
      if (currentMinutes <= points[index].minutes) {
        const previous = points[index - 1];
        const current = points[index];
        const ratio = (currentMinutes - previous.minutes) / (current.minutes - previous.minutes);
        return previous.pct + ((current.pct - previous.pct) * ratio);
      }
    }
    return 100;
  }

  private paceStatus(actual: number, expected: number, target: number, warning: number, critical: number) {
    if (!target || expected <= 0) return { pace_status: "not_available", pace_variance_pct: null };
    const variance = ((actual - expected) / expected) * 100;
    const status = variance >= 5 ? "ahead" : variance >= -warning ? "on_track" : variance >= -critical ? "behind" : "at_risk";
    return { pace_status: status, pace_variance_pct: Math.round(variance * 10) / 10 };
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

  private async isAccountingPeriodClosed(recordDate: string) {
    try {
      const response = await fetch(`${this.paymentsBase}/payments/v1/accounting-period-closes`, {
        headers: { Authorization: `Bearer ${this.serviceToken}` },
        signal: AbortSignal.timeout(1200)
      });
      if (!response.ok) return false;
      const body: any = await response.json();
      return (body.data || []).some((close: any) => {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Lagos",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date(close.period_start));
        return parts === recordDate;
      });
    } catch {
      return false;
    }
  }

  private addScope(clauses: string[], params: unknown[], scope: OpsDataScope, alias = "o") {
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
    if (scope.amoeba_ids?.length) {
      const placeholders = scope.amoeba_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`${alias}.amoeba_id IN (${placeholders.join(", ")})`);
    }
    if (scope.site_ids?.length) {
      const placeholders = scope.site_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`${alias}.site_id IN (${placeholders.join(", ")})`);
    }
    if (scope.supervisor_person_ids?.length) {
      const placeholders = scope.supervisor_person_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`${alias}.supervisor_person_id IN (${placeholders.join(", ")})`);
    }
    if (visible.length) clauses.push(`(${visible.join(" OR ")})`);
  }

  async listOperators(filters: { status?: string; amoeba_id?: string }, scope: OpsDataScope = {}) {
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
    this.addScope(clauses, params, scope);
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

  async getOperator(operatorId: string, scope: OpsDataScope = {}) {
    const rows = await this.listOperators({}, scope);
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

  async assignMonnifyAccount(operatorId: string, body: RecordBody) {
    const accountNumber = String(body.monnify_account_number || "").trim();
    if (!accountNumber) throw new BadRequestException("monnify_account_number is required.");
    const current: any = await this.getOperator(operatorId);
    const existing = await this.db.one<any>(
      "SELECT operator_id FROM ops_operators WHERE monnify_reserved_account = $1 AND operator_id <> $2",
      [accountNumber, operatorId]
    );
    if (existing) throw new ConflictException("This Monnify account is already assigned to another operator.");
    await this.db.exec(
      "UPDATE ops_operators SET monnify_reserved_account = $2, updated_at = $3 WHERE operator_id = $1",
      [operatorId, accountNumber, this.now()]
    );
    const updated = await this.getOperator(operatorId);
    await this.audit("operator.monnify_account_assigned", "operator", operatorId, current, updated);
    return updated;
  }

  async createCashTransaction(body: RecordBody) {
    for (const field of ["operator_id", "amount_ngn", "transaction_ref", "paid_at", "monnify_account_number"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    const amount = Number(this.number(body.amount_ngn, "amount_ngn"));
    if (amount <= 0) throw new BadRequestException("amount_ngn must be greater than zero.");
    const operator: any = await this.getOperator(String(body.operator_id));
    if (operator.monnify_reserved_account !== body.monnify_account_number) {
      throw new ConflictException("Monnify account does not match the operator account mapping.");
    }
    const existing = await this.db.one<any>(
      "SELECT * FROM ops_cash_transactions WHERE transaction_ref = $1",
      [body.transaction_ref]
    );
    if (existing) return existing;
    const paidAt = new Date(String(body.paid_at));
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException("paid_at must be a valid date-time.");
    const transaction = {
      cash_transaction_id: this.id("cash"),
      operator_id: body.operator_id,
      amount_ngn: amount,
      transaction_ref: body.transaction_ref,
      paid_at: paidAt.toISOString(),
      monnify_account_number: body.monnify_account_number,
      reconciliation_status: body.reconciliation_status || "matched",
      provider_payload: body.provider_payload || null,
      created_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_cash_transactions
       (cash_transaction_id, operator_id, amount_ngn, transaction_ref, paid_at,
        monnify_account_number, reconciliation_status, provider_payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      Object.values(transaction)
    );
    await this.audit("cash_transaction.recorded", "cash_transaction", transaction.cash_transaction_id, null, transaction);
    return transaction;
  }

  async listCashTransactions(
    filters: { operator_id?: string; date?: string },
    scope: OpsDataScope = {}
  ) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.operator_id) {
      params.push(filters.operator_id);
      clauses.push(`c.operator_id = $${params.length}`);
    }
    if (filters.date) {
      params.push(filters.date);
      clauses.push(`(c.paid_at AT TIME ZONE 'Africa/Lagos')::date = $${params.length}::date`);
    }
    this.addScope(clauses, params, scope, "o");
    return this.db.many(
      `SELECT c.*, o.amoeba_id, o.site_id, o.person_id, o.supervisor_person_id
       FROM ops_cash_transactions c
       JOIN ops_operators o ON o.operator_id = c.operator_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY c.paid_at DESC`,
      params
    );
  }

  async operatorCashPosition(operatorId: string, scope: OpsDataScope = {}) {
    await this.getOperator(operatorId, scope);
    const transactions: any[] = await this.listCashTransactions({ operator_id: operatorId }, scope);
    const total = transactions.reduce((sum: number, item: any) => sum + Number(item.amount_ngn), 0);
    return {
      operator_id: operatorId,
      total_remitted_ngn: Math.round(total * 100) / 100,
      transaction_count: transactions.length,
      latest_paid_at: transactions[0]?.paid_at || null,
      transactions
    };
  }

  async listCashAdjustments(
    filters: { operator_id?: string; adjustment_date?: string },
    scope: OpsDataScope = {}
  ) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.operator_id) {
      params.push(filters.operator_id);
      clauses.push(`a.operator_id = $${params.length}`);
    }
    if (filters.adjustment_date) {
      params.push(this.date(filters.adjustment_date));
      clauses.push(`a.adjustment_date = $${params.length}::date`);
    }
    this.addScope(clauses, params, scope, "o");
    return this.db.many(
      `SELECT a.*, o.person_id, o.amoeba_id, o.site_id, o.supervisor_person_id
       FROM ops_cash_adjustments a
       JOIN ops_operators o ON o.operator_id = a.operator_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY a.adjustment_date DESC, a.created_at DESC`,
      params
    );
  }

  async cashStatus(
    filters: { record_date?: string; operator_id?: string; amoeba_id?: string },
    scope: OpsDataScope = {}
  ) {
    const recordDate = this.date(filters.record_date || this.lagosDate());
    const params: unknown[] = [recordDate];
    const clauses = ["o.operator_status = 'active'"];
    if (filters.operator_id) {
      params.push(filters.operator_id);
      clauses.push(`o.operator_id = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`o.amoeba_id = $${params.length}`);
    }
    this.addScope(clauses, params, scope);
    const rows = await this.db.many<any>(
      `SELECT o.operator_id, o.person_id, o.amoeba_id, o.site_id, o.supervisor_person_id,
        v.plate AS vehicle_plate, v.vehicle_type,
        COALESCE(d.trips_completed, 0) AS trips_completed,
        COALESCE(d.cash_trips, 0) AS cash_trips,
        COALESCE(d.ride_revenue_ngn, 0) AS ride_revenue_ngn,
        COALESCE(d.expected_cash_ngn, 0) AS expected_cash_ngn,
        COALESCE(t.remitted_cash_ngn, 0) AS remitted_cash_ngn,
        COALESCE(t.transaction_count, 0) AS transaction_count,
        t.latest_paid_at,
        COALESCE(a.adjustment_ngn, 0) AS adjustment_ngn,
        COALESCE(a.adjustment_count, 0) AS adjustment_count
       FROM ops_operators o
       LEFT JOIN ops_vehicles v ON v.vehicle_id = o.vehicle_id
       LEFT JOIN (
         SELECT operator_id,
          SUM(trips_completed) AS trips_completed,
          SUM(cash_trips) AS cash_trips,
          SUM(ride_revenue_ngn) AS ride_revenue_ngn,
          SUM(
            CASE
              WHEN cash_trips > 0 AND trips_completed > 0
                THEN ride_revenue_ngn * cash_trips / trips_completed
              ELSE 0
            END
          ) AS expected_cash_ngn
         FROM ops_platform_daily_records
         WHERE record_date = $1
         GROUP BY operator_id
       ) d ON d.operator_id = o.operator_id
       LEFT JOIN (
         SELECT operator_id, SUM(amount_ngn) AS remitted_cash_ngn,
          COUNT(*) AS transaction_count, MAX(paid_at) AS latest_paid_at
         FROM ops_cash_transactions
         WHERE (paid_at AT TIME ZONE 'Africa/Lagos')::date = $1::date
         GROUP BY operator_id
       ) t ON t.operator_id = o.operator_id
       LEFT JOIN (
         SELECT operator_id, SUM(amount_ngn) AS adjustment_ngn, COUNT(*) AS adjustment_count
         FROM ops_cash_adjustments
         WHERE adjustment_date = $1
         GROUP BY operator_id
       ) a ON a.operator_id = o.operator_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(d.expected_cash_ngn, 0) - COALESCE(t.remitted_cash_ngn, 0) - COALESCE(a.adjustment_ngn, 0) DESC,
        o.created_at ASC`,
      params
    );
    return rows.map((row) => {
      const expected = Number(row.expected_cash_ngn || 0);
      const remitted = Number(row.remitted_cash_ngn || 0);
      const adjustment = Number(row.adjustment_ngn || 0);
      const net = remitted + adjustment - expected;
      const status = expected === 0 && remitted === 0 && adjustment === 0
        ? "no_expected_cash"
        : Math.abs(net) <= 100 ? "balanced" : net > 0 ? "in_credit" : "shortfall";
      return {
        ...row,
        record_date: recordDate,
        expected_cash_ngn: Math.round(expected * 100) / 100,
        remitted_cash_ngn: Math.round(remitted * 100) / 100,
        adjustment_ngn: Math.round(adjustment * 100) / 100,
        net_position_ngn: Math.round(net * 100) / 100,
        cash_status: status,
        expected_cash_basis: "cash_trip_revenue_share"
      };
    });
  }

  async createCashAdjustment(body: RecordBody, actorPersonId: string, scope: OpsDataScope = {}) {
    for (const field of ["operator_id", "adjustment_date", "amount_ngn", "adjustment_type", "reason"]) {
      if (body[field] === undefined || body[field] === "") throw new BadRequestException(`${field} is required.`);
    }
    if (!["credit", "debit", "reversal"].includes(String(body.adjustment_type))) {
      throw new BadRequestException("adjustment_type must be credit, debit, or reversal.");
    }
    await this.getOperator(String(body.operator_id), scope);
    const adjustmentDate = this.date(body.adjustment_date);
    if (await this.isAccountingPeriodClosed(adjustmentDate)) {
      throw new ForbiddenException("This accounting period is closed. Cash adjustments are locked.");
    }
    const timestamp = this.now();
    const adjustment = {
      cash_adjustment_id: this.id("cashadj"),
      operator_id: body.operator_id,
      adjustment_date: adjustmentDate,
      amount_ngn: this.signedNumber(body.amount_ngn, "amount_ngn"),
      adjustment_type: body.adjustment_type,
      reason: String(body.reason),
      related_transaction_ref: body.related_transaction_ref || null,
      notes: body.notes || null,
      evidence_reference: body.evidence_reference || null,
      created_by_person_id: actorPersonId,
      created_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_cash_adjustments
       (cash_adjustment_id, operator_id, adjustment_date, amount_ngn, adjustment_type,
        reason, related_transaction_ref, notes, evidence_reference, created_by_person_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      Object.values(adjustment)
    );
    await this.audit("cash_adjustment.created", "cash_adjustment", adjustment.cash_adjustment_id, null, adjustment, actorPersonId);
    return adjustment;
  }

  async listDailyCloseouts(filters: { record_date?: string; amoeba_id?: string }, scope: OpsDataScope = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.record_date) {
      params.push(this.date(filters.record_date));
      clauses.push(`c.record_date = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`c.amoeba_id = $${params.length}`);
    }
    if (!scope.unrestricted) {
      const scoped: string[] = [];
      if (scope.supervisor_person_id) {
        params.push(scope.supervisor_person_id);
        scoped.push(`c.supervisor_person_id = $${params.length}`);
      }
      if (scope.amoeba_ids?.length) {
        const placeholders = scope.amoeba_ids.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        scoped.push(`c.amoeba_id IN (${placeholders.join(", ")})`);
      }
      if (scope.supervisor_person_ids?.length) {
        const placeholders = scope.supervisor_person_ids.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        scoped.push(`c.supervisor_person_id IN (${placeholders.join(", ")})`);
      }
      if (scoped.length) clauses.push(`(${scoped.join(" OR ")})`);
      else clauses.push("FALSE");
    }
    return this.db.many(
      `SELECT c.* FROM ops_daily_closeouts c
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY c.record_date DESC, c.submitted_at DESC`,
      params
    );
  }

  async createDailyCloseout(body: RecordBody, actorPersonId: string, scope: OpsDataScope = {}) {
    for (const field of ["record_date", "amoeba_id"]) {
      if (!body[field]) throw new BadRequestException(`${field} is required.`);
    }
    const recordDate = this.date(body.record_date);
    const amoebaId = String(body.amoeba_id);
    const supervisorPersonId = String(body.supervisor_person_id || actorPersonId);
    const cashRows = await this.cashStatus({ record_date: recordDate, amoeba_id: amoebaId }, scope);
    const summary = cashRows.reduce((totals: any, row: any) => {
      totals.operator_count++;
      totals.expected_cash_ngn += Number(row.expected_cash_ngn || 0);
      totals.remitted_cash_ngn += Number(row.remitted_cash_ngn || 0);
      totals.adjustment_ngn += Number(row.adjustment_ngn || 0);
      totals.shortfall_count += row.cash_status === "shortfall" ? 1 : 0;
      totals.in_credit_count += row.cash_status === "in_credit" ? 1 : 0;
      return totals;
    }, { operator_count: 0, expected_cash_ngn: 0, remitted_cash_ngn: 0, adjustment_ngn: 0, shortfall_count: 0, in_credit_count: 0 });
    summary.net_position_ngn = summary.remitted_cash_ngn + summary.adjustment_ngn - summary.expected_cash_ngn;
    for (const key of ["expected_cash_ngn", "remitted_cash_ngn", "adjustment_ngn", "net_position_ngn"]) {
      summary[key] = Math.round(summary[key] * 100) / 100;
    }
    const timestamp = this.now();
    const closeout = {
      closeout_id: this.id("closeout"),
      record_date: recordDate,
      amoeba_id: amoebaId,
      supervisor_person_id: supervisorPersonId,
      status: body.status || (summary.shortfall_count ? "submitted_with_exceptions" : "submitted"),
      unresolved_alert_count: Number(this.number(body.unresolved_alert_count ?? 0, "unresolved_alert_count")),
      cash_summary: summary,
      notes: body.notes || null,
      submitted_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_daily_closeouts
       (closeout_id, record_date, amoeba_id, supervisor_person_id, status,
        unresolved_alert_count, cash_summary, notes, submitted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(record_date, amoeba_id, supervisor_person_id) DO UPDATE SET
        status=EXCLUDED.status, unresolved_alert_count=EXCLUDED.unresolved_alert_count,
        cash_summary=EXCLUDED.cash_summary, notes=EXCLUDED.notes,
        submitted_at=EXCLUDED.submitted_at, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      Object.values(closeout)
    );
    const saved = await this.db.one<any>(
      "SELECT * FROM ops_daily_closeouts WHERE record_date=$1 AND amoeba_id=$2 AND supervisor_person_id=$3",
      [recordDate, amoebaId, supervisorPersonId]
    );
    await this.audit("daily_closeout.submitted", "daily_closeout", saved.closeout_id, null, saved, actorPersonId);
    return saved;
  }

  async listVehicles(scope: OpsDataScope = {}) {
    if (scope.unrestricted) return this.db.many("SELECT * FROM ops_vehicles ORDER BY created_at ASC");
    const clauses: string[] = [];
    const params: unknown[] = [];
    const visible: string[] = [];
    if (scope.amoeba_ids?.length) {
      const placeholders = scope.amoeba_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`v.amoeba_id IN (${placeholders.join(", ")})`);
    }
    const operatorScope: OpsDataScope = {
      person_id: scope.person_id,
      supervisor_person_id: scope.supervisor_person_id,
      site_ids: scope.site_ids,
      supervisor_person_ids: scope.supervisor_person_ids
    };
    const operatorClauses: string[] = [];
    this.addScope(operatorClauses, params, operatorScope, "o");
    if (operatorClauses.length) {
      visible.push(`EXISTS (
        SELECT 1 FROM ops_operators o
        WHERE (o.vehicle_id = v.vehicle_id OR o.operator_id = v.assigned_operator_id)
          AND ${operatorClauses.join(" AND ")}
      )`);
    }
    if (visible.length) clauses.push(`(${visible.join(" OR ")})`);
    return this.db.many(
      `SELECT v.* FROM ops_vehicles v
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE FALSE"}
       ORDER BY v.created_at ASC`,
      params
    );
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

  async updateVehicle(vehicleId: string, body: RecordBody) {
    const current = await this.db.one<any>("SELECT * FROM ops_vehicles WHERE vehicle_id = $1", [vehicleId]);
    if (!current) throw new NotFoundException("Vehicle not found.");
    const allowed = ["plate", "vehicle_type", "amoeba_id", "make_model", "color", "status", "assigned_operator_id"];
    const updated = { ...current };
    for (const key of allowed) if (key in body) updated[key] = body[key];
    updated.updated_at = this.now();
    await this.db.exec(
      `UPDATE ops_vehicles SET plate = $2, vehicle_type = $3, amoeba_id = $4,
       make_model = $5, color = $6, status = $7, assigned_operator_id = $8,
       updated_at = $9 WHERE vehicle_id = $1`,
      [vehicleId, updated.plate, updated.vehicle_type, updated.amoeba_id, updated.make_model,
       updated.color, updated.status, updated.assigned_operator_id, updated.updated_at]
    );
    await this.audit("vehicle.updated", "vehicle", vehicleId, current, updated);
    return updated;
  }

  async listPlatformAccounts() {
    return this.db.many("SELECT * FROM ops_platform_accounts ORDER BY created_at ASC");
  }

  async listRevenuePaceProfiles() {
    return this.db.many("SELECT * FROM ops_revenue_pace_profiles ORDER BY vehicle_type, effective_from DESC");
  }

  async createRevenuePaceProfile(body: RecordBody, actorPersonId: string) {
    if (!["car", "motorbike", "other"].includes(String(body.vehicle_type))) throw new BadRequestException("vehicle_type is invalid.");
    const timestamp = this.now();
    const profile = {
      pace_profile_id: this.id("pace"),
      vehicle_type: body.vehicle_type,
      day_type: body.day_type || "all",
      daily_target_ngn: this.number(body.daily_target_ngn, "daily_target_ngn"),
      checkpoints: this.checkpoints(body.checkpoints),
      warning_tolerance_pct: this.number(body.warning_tolerance_pct ?? 10, "warning_tolerance_pct"),
      critical_tolerance_pct: this.number(body.critical_tolerance_pct ?? 20, "critical_tolerance_pct"),
      effective_from: this.date(body.effective_from || this.lagosDate()),
      effective_to: body.effective_to ? this.date(body.effective_to) : null,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_revenue_pace_profiles
       (pace_profile_id, vehicle_type, day_type, daily_target_ngn, checkpoints,
        warning_tolerance_pct, critical_tolerance_pct, effective_from, effective_to,
        created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      Object.values(profile)
    );
    await this.audit("revenue_pace_profile.created", "revenue_pace_profile", profile.pace_profile_id, null, profile, actorPersonId);
    return profile;
  }

  async updateRevenuePaceProfile(profileId: string, body: RecordBody, actorPersonId: string) {
    const current = await this.db.one<any>("SELECT * FROM ops_revenue_pace_profiles WHERE pace_profile_id = $1", [profileId]);
    if (!current) throw new NotFoundException("Revenue pace profile not found.");
    const updated = {
      ...current,
      daily_target_ngn: body.daily_target_ngn === undefined ? current.daily_target_ngn : this.number(body.daily_target_ngn, "daily_target_ngn"),
      checkpoints: body.checkpoints === undefined ? current.checkpoints : this.checkpoints(body.checkpoints),
      warning_tolerance_pct: body.warning_tolerance_pct === undefined ? current.warning_tolerance_pct : this.number(body.warning_tolerance_pct, "warning_tolerance_pct"),
      critical_tolerance_pct: body.critical_tolerance_pct === undefined ? current.critical_tolerance_pct : this.number(body.critical_tolerance_pct, "critical_tolerance_pct"),
      effective_to: body.effective_to === undefined ? current.effective_to : (body.effective_to ? this.date(body.effective_to) : null),
      updated_at: this.now()
    };
    await this.db.exec(
      `UPDATE ops_revenue_pace_profiles SET daily_target_ngn=$2, checkpoints=$3,
       warning_tolerance_pct=$4, critical_tolerance_pct=$5, effective_to=$6, updated_at=$7
       WHERE pace_profile_id=$1`,
      [profileId, updated.daily_target_ngn, updated.checkpoints, updated.warning_tolerance_pct,
       updated.critical_tolerance_pct, updated.effective_to, updated.updated_at]
    );
    await this.audit("revenue_pace_profile.updated", "revenue_pace_profile", profileId, current, updated, actorPersonId);
    return updated;
  }

  async listEconomicsPolicies() {
    return this.db.many("SELECT * FROM ops_economics_policies ORDER BY effective_from DESC, created_at DESC");
  }

  async createEconomicsPolicy(body: RecordBody, actorPersonId: string) {
    const timestamp = this.now();
    const policy = {
      economics_policy_id: this.id("economics"),
      policy_name: body.policy_name || "Default economics policy",
      admin_staff_daily_cost_ngn: this.number(body.admin_staff_daily_cost_ngn ?? 0, "admin_staff_daily_cost_ngn"),
      operator_labour_share_pct: this.number(body.operator_labour_share_pct ?? 0, "operator_labour_share_pct"),
      daily_overhead_ngn: this.number(body.daily_overhead_ngn ?? 0, "daily_overhead_ngn"),
      expected_hours_per_operator: this.number(body.expected_hours_per_operator ?? 10, "expected_hours_per_operator"),
      effective_from: this.date(body.effective_from || this.lagosDate()),
      effective_to: body.effective_to ? this.date(body.effective_to) : null,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    if (Number(policy.operator_labour_share_pct) > 100) throw new BadRequestException("operator_labour_share_pct cannot exceed 100.");
    await this.db.exec(
      `INSERT INTO ops_economics_policies
       (economics_policy_id, policy_name, admin_staff_daily_cost_ngn,
        operator_labour_share_pct, daily_overhead_ngn, expected_hours_per_operator,
        effective_from, effective_to, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      Object.values(policy)
    );
    await this.audit("economics_policy.created", "economics_policy", policy.economics_policy_id, null, policy, actorPersonId);
    return policy;
  }

  async listEfficiencyPolicies() {
    return this.db.many("SELECT * FROM ops_vehicle_efficiency_policies ORDER BY vehicle_type, effective_from DESC");
  }

  async createEfficiencyPolicy(body: RecordBody, actorPersonId: string) {
    if (!body.vehicle_type) throw new BadRequestException("vehicle_type is required.");
    const timestamp = this.now();
    const policy = {
      efficiency_policy_id: this.id("efficiency"),
      vehicle_type: body.vehicle_type,
      make_model: body.make_model || null,
      fuel_type: body.fuel_type || "petrol",
      standard_daily_fuel_quantity: this.number(body.standard_daily_fuel_quantity, "standard_daily_fuel_quantity"),
      fuel_unit: body.fuel_unit || "litres",
      expected_distance_km: this.number(body.expected_distance_km, "expected_distance_km"),
      allowed_variance_pct: this.number(body.allowed_variance_pct ?? 10, "allowed_variance_pct"),
      effective_from: this.date(body.effective_from || this.lagosDate()),
      effective_to: body.effective_to ? this.date(body.effective_to) : null,
      created_by_person_id: actorPersonId,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_vehicle_efficiency_policies
       (efficiency_policy_id, vehicle_type, make_model, fuel_type,
        standard_daily_fuel_quantity, fuel_unit, expected_distance_km,
        allowed_variance_pct, effective_from, effective_to, created_by_person_id,
        created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      Object.values(policy)
    );
    await this.audit("vehicle_efficiency_policy.created", "vehicle_efficiency_policy", policy.efficiency_policy_id, null, policy, actorPersonId);
    return policy;
  }

  async listFuelIssues(filters: { operating_date?: string; operator_id?: string }, scope: OpsDataScope = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.operating_date) { params.push(this.date(filters.operating_date)); clauses.push(`f.operating_date = $${params.length}`); }
    if (filters.operator_id) { params.push(filters.operator_id); clauses.push(`f.operator_id = $${params.length}`); }
    this.addScope(clauses, params, scope);
    return this.db.many(
      `SELECT f.*, o.person_id, v.plate, v.vehicle_type
       FROM ops_fuel_issues f JOIN ops_operators o ON o.operator_id=f.operator_id
       JOIN ops_vehicles v ON v.vehicle_id=f.vehicle_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY f.operating_date DESC, f.issued_at DESC`,
      params
    );
  }

  async createFuelIssue(body: RecordBody, actorPersonId: string) {
    for (const field of ["operator_id", "vehicle_id", "operating_date", "quantity", "unit"]) {
      if (body[field] === undefined || body[field] === "") throw new BadRequestException(`${field} is required.`);
    }
    const timestamp = this.now();
    const issue = {
      fuel_issue_id: this.id("fuel"),
      operator_id: body.operator_id,
      vehicle_id: body.vehicle_id,
      operating_date: this.date(body.operating_date),
      quantity: this.number(body.quantity, "quantity"),
      unit: body.unit,
      issued_at: body.issued_at || timestamp,
      confirmed_by_person_id: actorPersonId,
      notes: body.notes || null,
      created_at: timestamp,
      updated_at: timestamp
    };
    try {
      await this.db.exec(
        `INSERT INTO ops_fuel_issues
         (fuel_issue_id, operator_id, vehicle_id, operating_date, quantity, unit,
          issued_at, confirmed_by_person_id, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        Object.values(issue)
      );
    } catch {
      throw new ConflictException("Fuel has already been confirmed for this operator, vehicle, and date.");
    }
    await this.audit("fuel_issue.created", "fuel_issue", issue.fuel_issue_id, null, issue, actorPersonId);
    return issue;
  }

  async mileageReconciliations(recordDate?: string, scope: OpsDataScope = {}) {
    const date = this.date(recordDate || this.lagosDate());
    const params: unknown[] = [date];
    const clauses = ["o.operator_status='active'"];
    this.addScope(clauses, params, scope);
    const rows = await this.db.many<any>(
      `SELECT o.operator_id, o.person_id, v.vehicle_id, v.plate, v.vehicle_type, v.make_model,
        f.fuel_issue_id, f.quantity AS fuel_quantity, f.unit AS fuel_unit,
        d.official_distance_km,
        t.actual_distance_km AS tracker_distance_km,
        p.standard_daily_fuel_quantity, p.expected_distance_km, p.allowed_variance_pct
       FROM ops_operators o JOIN ops_vehicles v ON v.vehicle_id=o.vehicle_id
       LEFT JOIN ops_fuel_issues f ON f.operator_id=o.operator_id AND f.vehicle_id=v.vehicle_id AND f.operating_date=$1
       LEFT JOIN (
         SELECT operator_id, SUM(official_distance_km) AS official_distance_km
         FROM ops_platform_daily_records WHERE record_date=$1 GROUP BY operator_id
       ) d ON d.operator_id=o.operator_id
       LEFT JOIN ops_tracker_daily_records t ON t.vehicle_id=v.vehicle_id AND t.record_date=$1
       LEFT JOIN LATERAL (
         SELECT * FROM ops_vehicle_efficiency_policies p
         WHERE p.vehicle_type=v.vehicle_type AND (p.make_model IS NULL OR p.make_model=v.make_model)
           AND p.effective_from <= $1 AND (p.effective_to IS NULL OR p.effective_to >= $1)
         ORDER BY (p.make_model IS NOT NULL) DESC, p.effective_from DESC LIMIT 1
       ) p ON TRUE
       WHERE ${clauses.join(" AND ")}`,
      params
    );
    return rows.map((row) => {
      const expected = row.fuel_quantity && row.standard_daily_fuel_quantity
        ? Number(row.expected_distance_km) * Number(row.fuel_quantity) / Number(row.standard_daily_fuel_quantity)
        : null;
      const official = row.official_distance_km === null ? null : Number(row.official_distance_km);
      const tracker = row.tracker_distance_km === null ? null : Number(row.tracker_distance_km);
      const tolerance = Number(row.allowed_variance_pct || 10);
      const fuelVariance = expected && official !== null ? ((official - expected) / expected) * 100 : null;
      const trackerVariance = official !== null && official > 0 && tracker !== null ? ((tracker - official) / official) * 100 : null;
      return {
        ...row,
        record_date: date,
        expected_distance_km: expected === null ? null : Math.round(expected * 10) / 10,
        fuel_efficiency_variance_pct: fuelVariance === null ? null : Math.round(fuelVariance * 10) / 10,
        official_distance_status: expected === null || official === null ? "not_available" : Math.abs(fuelVariance!) <= tolerance ? "acceptable" : "exception",
        unexplained_distance_km: tracker === null || official === null ? null : Math.round((tracker - official) * 10) / 10,
        unexplained_distance_pct: trackerVariance === null ? null : Math.round(trackerVariance * 10) / 10,
        tracker_variance_status: row.vehicle_type === "motorbike" && tracker === null
          ? "tracker_unavailable"
          : tracker === null ? "no_tracker_data" : Math.abs(trackerVariance!) <= tolerance ? "acceptable" : "exception"
      };
    });
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

  async listIngestionRuns(recordDate?: string) {
    return this.db.many(
      `SELECT r.*, pa.platform, pa.display_name AS platform_display_name
       FROM ops_ingestion_runs r
       JOIN ops_platform_accounts pa ON pa.platform_account_id = r.platform_account_id
       ${recordDate ? "WHERE r.record_date = $1" : ""}
       ORDER BY r.started_at DESC
       LIMIT 100`,
      recordDate ? [this.date(recordDate)] : []
    );
  }

  async ingestDailyRecords(body: RecordBody, actorPersonId: string) {
    const platformAccountId = String(body.platform_account_id || "");
    if (!platformAccountId) throw new BadRequestException("platform_account_id is required.");
    const account = await this.db.one<any>(
      "SELECT * FROM ops_platform_accounts WHERE platform_account_id = $1 AND is_active = TRUE",
      [platformAccountId]
    );
    if (!account) throw new BadRequestException("platform_account_id does not identify an active platform account.");

    const recordDate = this.date(body.record_date || this.lagosDate());
    const records = Array.isArray(body.records) ? body.records as RecordBody[] : null;
    if (!records?.length) throw new BadRequestException("records must be a non-empty array.");
    const source = String(body.source || "live");
    if (!["live", "migration", "manual_correction", "connector_test"].includes(source)) {
      throw new BadRequestException("source must be live, migration, manual_correction, or connector_test.");
    }

    const timestamp = this.now();
    const runId = this.id("ingestion");
    await this.db.exec(
      `INSERT INTO ops_ingestion_runs
       (ingestion_run_id, platform_account_id, record_date, source, status,
        records_received, started_at, requested_by_person_id)
       VALUES ($1,$2,$3,$4,'running',$5,$6,$7)`,
      [runId, platformAccountId, recordDate, source, records.length, timestamp, actorPersonId]
    );

    const errors: Array<Record<string, unknown>> = [];
    let upserted = 0;
    for (const [index, record] of records.entries()) {
      try {
        const platformOperatorId = String(record.platform_operator_id || "");
        if (!platformOperatorId) throw new Error("platform_operator_id is required.");
        const registration = await this.db.one<any>(
          `SELECT r.operator_id, r.registration_id
           FROM ops_operator_platform_accounts r
           WHERE r.platform_account_id = $1 AND r.platform_operator_id = $2
             AND r.registration_status IN ('registered', 'active')`,
          [platformAccountId, platformOperatorId]
        );
        if (!registration) throw new Error("No active or registered operator mapping exists for this platform_operator_id.");

        const total = this.number(record.trips_total, "trips_total");
        const completed = this.number(record.trips_completed, "trips_completed");
        const cancelled = this.number(record.trips_cancelled, "trips_cancelled");
        const noResponse = this.number(record.trips_no_response, "trips_no_response");
        const rejected = this.number(record.trips_rejected, "trips_rejected");
        const acceptance = this.number(record.acceptance_pct, "acceptance_pct", true);
        const cancellation = this.number(record.cancellation_pct, "cancellation_pct", true);
        const completion = this.number(record.completion_pct, "completion_pct", true);
        for (const [field, value] of [["acceptance_pct", acceptance], ["cancellation_pct", cancellation], ["completion_pct", completion]] as const) {
          if (value !== null && value > 100) throw new Error(`${field} cannot exceed 100.`);
        }
        const status = String(record.current_status || "unknown");
        if (!["online", "offline", "not_seen_today", "checked_out", "unknown"].includes(status)) {
          throw new Error("current_status is invalid.");
        }
        const quality = String(record.data_quality || "authoritative");
        if (!["authoritative", "derived", "heuristic", "degraded"].includes(quality)) {
          throw new Error("data_quality is invalid.");
        }
        const values = [
          this.id("daily"), registration.operator_id, platformAccountId, runId, recordDate,
          total, completed, cancelled, noResponse, rejected,
          this.number(record.ride_revenue_ngn, "ride_revenue_ngn"),
          this.number(record.net_earnings_ngn, "net_earnings_ngn"),
          this.number(record.booking_fees_ngn, "booking_fees_ngn"),
          this.number(record.cash_trips, "cash_trips"),
          this.number(record.card_trips, "card_trips"),
          acceptance, cancellation, completion,
          this.number(record.hours_online, "hours_online"),
          this.number(record.official_distance_km, "official_distance_km", true),
          record.last_seen_at || null, status, source, quality,
          record.provenance || {}, record.raw_payload || record, timestamp, timestamp
        ];
        await this.db.exec(
          `INSERT INTO ops_platform_daily_records
           (daily_record_id, operator_id, platform_account_id, ingestion_run_id, record_date,
            trips_total, trips_completed, trips_cancelled, trips_no_response, trips_rejected,
            ride_revenue_ngn, net_earnings_ngn, booking_fees_ngn, cash_trips, card_trips,
            acceptance_pct, cancellation_pct, completion_pct, hours_online, official_distance_km, last_seen_at,
            current_status, source, data_quality, provenance, raw_payload, ingested_at, updated_at)
           VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
           ON CONFLICT (operator_id, platform_account_id, record_date) DO UPDATE SET
            ingestion_run_id = EXCLUDED.ingestion_run_id,
            trips_total = EXCLUDED.trips_total, trips_completed = EXCLUDED.trips_completed,
            trips_cancelled = EXCLUDED.trips_cancelled, trips_no_response = EXCLUDED.trips_no_response,
            trips_rejected = EXCLUDED.trips_rejected, ride_revenue_ngn = EXCLUDED.ride_revenue_ngn,
            net_earnings_ngn = EXCLUDED.net_earnings_ngn, booking_fees_ngn = EXCLUDED.booking_fees_ngn,
            cash_trips = EXCLUDED.cash_trips, card_trips = EXCLUDED.card_trips,
            acceptance_pct = EXCLUDED.acceptance_pct, cancellation_pct = EXCLUDED.cancellation_pct,
            completion_pct = EXCLUDED.completion_pct, hours_online = EXCLUDED.hours_online,
            official_distance_km = EXCLUDED.official_distance_km,
            last_seen_at = EXCLUDED.last_seen_at, current_status = EXCLUDED.current_status,
            source = EXCLUDED.source, data_quality = EXCLUDED.data_quality,
            provenance = EXCLUDED.provenance, raw_payload = EXCLUDED.raw_payload,
            ingested_at = EXCLUDED.ingested_at, updated_at = EXCLUDED.updated_at`,
          values
        );
        upserted++;
      } catch (error: any) {
        errors.push({
          index,
          platform_operator_id: record.platform_operator_id || null,
          message: error?.message || "Record rejected."
        });
      }
    }

    const completedAt = this.now();
    const status = upserted === records.length ? "completed" : upserted ? "completed_with_errors" : "failed";
    await this.db.exec(
      `UPDATE ops_ingestion_runs SET status = $2, records_upserted = $3,
       records_rejected = $4, errors = $5, completed_at = $6
       WHERE ingestion_run_id = $1`,
      [runId, status, upserted, errors.length, errors, completedAt]
    );
    const result = await this.db.one<any>("SELECT * FROM ops_ingestion_runs WHERE ingestion_run_id = $1", [runId]);
    await this.audit("ingestion.completed", "ingestion_run", runId, null, result, actorPersonId);
    return result;
  }

  async listDailyPerformance(
    filters: { record_date?: string; operator_id?: string; amoeba_id?: string },
    scope: OpsDataScope = {}
  ) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.record_date) {
      params.push(this.date(filters.record_date));
      clauses.push(`d.record_date = $${params.length}`);
    }
    if (filters.operator_id) {
      params.push(filters.operator_id);
      clauses.push(`d.operator_id = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`o.amoeba_id = $${params.length}`);
    }
    this.addScope(clauses, params, scope);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.many(
      `SELECT d.*, o.person_id, o.amoeba_id, o.site_id, o.daily_revenue_target_ngn,
        v.plate AS vehicle_plate, v.vehicle_type,
        pa.platform, pa.display_name AS platform_display_name,
        pa.vehicle_type AS platform_vehicle_type,
        pa.account_subtype AS platform_account_subtype
       FROM ops_platform_daily_records d
       JOIN ops_operators o ON o.operator_id = d.operator_id
       LEFT JOIN ops_vehicles v ON v.vehicle_id = o.vehicle_id
       JOIN ops_platform_accounts pa ON pa.platform_account_id = d.platform_account_id
       ${where}
       ORDER BY d.record_date DESC, d.ride_revenue_ngn DESC`,
      params
    );
  }

  async teamBoard(filters: { record_date?: string; amoeba_id?: string }, scope: OpsDataScope = {}) {
    const recordDate = this.date(filters.record_date || this.lagosDate());
    const params: unknown[] = [recordDate];
    const clauses = ["o.operator_status = 'active'"];
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`o.amoeba_id = $${params.length}`);
    }
    this.addScope(clauses, params, scope);
    const rows = await this.db.many<any>(
      `SELECT o.operator_id, o.person_id, o.amoeba_id, o.site_id, o.operator_status,
        o.daily_revenue_target_ngn, v.plate AS vehicle_plate, v.vehicle_type,
        COALESCE(d.trips_total, 0) AS trips_total,
        COALESCE(d.trips_completed, 0) AS trips_completed,
        COALESCE(d.ride_revenue_ngn, 0) AS ride_revenue_ngn,
        COALESCE(d.net_earnings_ngn, 0) AS net_earnings_ngn,
        COALESCE(d.hours_online, 0) AS hours_online,
        d.last_seen_at,
        COALESCE(d.current_status, 'not_seen_today') AS current_status,
        COALESCE(d.platforms, '[]') AS platforms,
        COALESCE(a.open_alerts, 0) AS open_alerts
       FROM ops_operators o
       LEFT JOIN ops_vehicles v ON v.vehicle_id = o.vehicle_id
       LEFT JOIN (
         SELECT records.operator_id,
          SUM(records.trips_total) AS trips_total,
          SUM(records.trips_completed) AS trips_completed,
          SUM(records.ride_revenue_ngn) AS ride_revenue_ngn,
          SUM(records.net_earnings_ngn) AS net_earnings_ngn,
          SUM(records.hours_online) AS hours_online,
          MAX(records.last_seen_at) AS last_seen_at,
          (ARRAY_AGG(records.current_status ORDER BY records.last_seen_at DESC NULLS LAST))[1] AS current_status,
          json_agg(jsonb_build_object(
            'platform_account_id', pa.platform_account_id,
            'platform', pa.platform,
            'display_name', pa.display_name,
            'vehicle_type', pa.vehicle_type,
            'account_subtype', pa.account_subtype,
            'data_quality', records.data_quality
          )) AS platforms
         FROM ops_platform_daily_records records
         JOIN ops_platform_accounts pa ON pa.platform_account_id = records.platform_account_id
         WHERE records.record_date = $1
         GROUP BY records.operator_id
       ) d ON d.operator_id = o.operator_id
       LEFT JOIN (
         SELECT operator_id, COUNT(*) AS open_alerts
         FROM ops_alerts
         WHERE alert_date = $1 AND resolution_status IN ('open', 'escalated')
         GROUP BY operator_id
       ) a ON a.operator_id = o.operator_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(a.open_alerts, 0) DESC, COALESCE(d.ride_revenue_ngn, 0) ASC`,
      params
    );
    const profiles = await this.listRevenuePaceProfiles();
    return rows.map((row) => {
      const platformVehicleType = row.platforms.find((item: any) => item.vehicle_type)?.vehicle_type;
      const vehicleType = platformVehicleType || row.vehicle_type;
      const profile: any = profiles.find((item: any) =>
        item.vehicle_type === vehicleType
        && item.effective_from <= recordDate
        && (!item.effective_to || item.effective_to >= recordDate)
      );
      const target = Number(row.daily_revenue_target_ngn || profile?.daily_target_ngn || 0);
      const expectedPct = profile ? this.expectedPct(profile.checkpoints, recordDate) : 100;
      const expectedRevenue = target * expectedPct / 100;
      return {
        ...row,
        vehicle_type: vehicleType,
        expected_revenue_pct: Math.round(expectedPct * 10) / 10,
        expected_revenue_ngn: Math.round(expectedRevenue * 100) / 100,
        ...this.paceStatus(Number(row.ride_revenue_ngn), expectedRevenue, target,
          Number(profile?.warning_tolerance_pct || 10), Number(profile?.critical_tolerance_pct || 20))
      };
    });
  }

  async listAlerts(filters: { resolution_status?: string; operator_id?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.push(value);
      clauses.push(`a.${key} = $${params.length}`);
    }
    this.addScope(clauses, params, scope);
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

  async ensureAlert(body: RecordBody) {
    const existing = await this.db.one<any>(
      `SELECT alert_id FROM ops_alerts
       WHERE operator_id=$1 AND alert_type=$2 AND alert_date=$3
         AND COALESCE(episode_key, '')=COALESCE($4, '') AND tier=$5`,
      [body.operator_id, body.alert_type, body.alert_date, body.episode_key || null, Number(body.tier || 0)]
    );
    if (existing) return null;
    const alert = {
      alert_id: this.id("alert"),
      operator_id: String(body.operator_id),
      platform_account_id: body.platform_account_id || null,
      alert_type: String(body.alert_type),
      alert_date: this.date(body.alert_date),
      tier: Number(body.tier || 0),
      episode_key: body.episode_key || null,
      fired_at: this.now(),
      resolution_status: "open",
      metadata: body.metadata || {}
    };
    await this.db.exec(
      `INSERT INTO ops_alerts
       (alert_id, operator_id, platform_account_id, alert_type, alert_date, tier,
        episode_key, fired_at, resolution_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      Object.values(alert)
    );
    const operator = await this.db.one<any>(
      "SELECT person_id, supervisor_person_id FROM ops_operators WHERE operator_id=$1",
      [alert.operator_id]
    );
    const recipientPersonId = operator?.supervisor_person_id || operator?.person_id;
    if (recipientPersonId) {
      const timestamp = this.now();
      await this.db.exec(
        `INSERT INTO ops_notification_deliveries
         (notification_delivery_id, alert_id, recipient_person_id, channel, payload,
          status, attempt, created_at, updated_at)
         VALUES ($1,$2,$3,'in_app',$4,'pending',0,$5,$5)
         ON CONFLICT (alert_id, recipient_person_id, channel) DO NOTHING`,
        [
          this.id("notification"),
          alert.alert_id,
          recipientPersonId,
          {
            event_type: "ops.alert.created",
            alert_id: alert.alert_id,
            operator_id: alert.operator_id,
            alert_type: alert.alert_type,
            tier: alert.tier,
            alert_date: alert.alert_date,
            metadata: alert.metadata
          },
          timestamp
        ]
      );
    }
    await this.audit("alert.created", "alert", alert.alert_id, null, alert);
    return alert;
  }

  async listNotificationDeliveries() {
    return this.db.many(
      `SELECT * FROM ops_notification_deliveries
       ORDER BY created_at DESC LIMIT 200`
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

  async listDailyReports(filters: { record_date?: string; amoeba_id?: string }, scope: OpsDataScope = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.record_date) {
      params.push(this.date(filters.record_date));
      clauses.push(`r.record_date = $${params.length}`);
    }
    if (filters.amoeba_id) {
      params.push(filters.amoeba_id);
      clauses.push(`r.amoeba_id = $${params.length}`);
    }
    if (!scope.unrestricted) {
      const visible: string[] = [];
      if (scope.amoeba_ids?.length) {
        const placeholders = scope.amoeba_ids.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        visible.push(`r.amoeba_id IN (${placeholders.join(", ")})`);
      }
      const operatorScope: OpsDataScope = {
        person_id: scope.person_id,
        supervisor_person_id: scope.supervisor_person_id,
        site_ids: scope.site_ids,
        supervisor_person_ids: scope.supervisor_person_ids
      };
      const operatorClauses: string[] = [];
      this.addScope(operatorClauses, params, operatorScope, "o");
      if (operatorClauses.length) {
        visible.push(`EXISTS (
          SELECT 1 FROM ops_operators o
          WHERE o.amoeba_id = r.amoeba_id AND ${operatorClauses.join(" AND ")}
        )`);
      }
      clauses.push(visible.length ? `(r.amoeba_id IS NOT NULL AND (${visible.join(" OR ")}))` : "FALSE");
    }
    return this.db.many(
      `SELECT report_id, record_date, amoeba_id, revision, status, summary,
        generated_by_person_id, generated_at
       FROM ops_daily_report_snapshots r
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY record_date DESC, revision DESC`,
      params
    );
  }

  async getDailyReport(reportId: string, scope: OpsDataScope = {}) {
    const report = await this.db.one<any>("SELECT * FROM ops_daily_report_snapshots WHERE report_id = $1", [reportId]);
    if (!report) throw new NotFoundException("Daily report not found.");
    if (Object.keys(scope).length) {
      const visible = await this.listDailyReports({}, scope);
      if (!visible.some((item: any) => item.report_id === reportId)) throw new NotFoundException("Daily report not found.");
    }
    return report;
  }

  async generateDailyReport(body: RecordBody, actorPersonId: string) {
    const recordDate = this.date(body.record_date || this.lagosDate());
    const amoebaId = body.amoeba_id ? String(body.amoeba_id) : null;
    const rows = await this.listDailyPerformance({ record_date: recordDate, amoeba_id: amoebaId || undefined });
    const board = await this.teamBoard({ record_date: recordDate, amoeba_id: amoebaId || undefined });
    const alerts = await this.listAlerts({});
    const relevantAlerts = alerts.filter((alert: any) =>
      String(alert.alert_date).slice(0, 10) === recordDate && (!amoebaId || alert.amoeba_id === amoebaId)
    );
    const revenue = (rows as any[]).reduce<{ total: number; car: number; motorbike: number }>((totals, row) => {
      const type = row.platform_vehicle_type || row.vehicle_type || "unknown";
      totals.total += Number(row.ride_revenue_ngn || 0);
      if (type === "car") totals.car += Number(row.ride_revenue_ngn || 0);
      if (type === "motorbike") totals.motorbike += Number(row.ride_revenue_ngn || 0);
      return totals;
    }, { total: 0, car: 0, motorbike: 0 });
    const summary = {
      active_operators: board.length,
      live_operators: board.filter((item: any) => !["offline", "not_seen_today"].includes(item.current_status)).length,
      trips_total: rows.reduce((sum: number, row: any) => sum + Number(row.trips_total || 0), 0),
      hours_online: Math.round(rows.reduce((sum: number, row: any) => sum + Number(row.hours_online || 0), 0) * 100) / 100,
      revenue_total_ngn: Math.round(revenue.total * 100) / 100,
      car_revenue_ngn: Math.round(revenue.car * 100) / 100,
      motorbike_revenue_ngn: Math.round(revenue.motorbike * 100) / 100,
      open_alerts: relevantAlerts.filter((alert: any) => alert.resolution_status !== "resolved").length,
      source_rows: rows.length
    };
    const previous = await this.db.one<any>(
      `SELECT COALESCE(MAX(revision), 0) AS revision
       FROM ops_daily_report_snapshots
       WHERE record_date = $1 AND amoeba_id IS NOT DISTINCT FROM $2`,
      [recordDate, amoebaId]
    );
    const report = {
      report_id: this.id("report"),
      record_date: recordDate,
      amoeba_id: amoebaId,
      revision: Number(previous?.revision || 0) + 1,
      status: "generated",
      summary,
      rows,
      generated_by_person_id: actorPersonId,
      generated_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_daily_report_snapshots
       (report_id, record_date, amoeba_id, revision, status, summary, rows,
        generated_by_person_id, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      Object.values(report)
    );
    await this.audit("daily_report.generated", "daily_report", report.report_id, null, {
      ...report,
      rows: { count: rows.length }
    }, actorPersonId);
    return report;
  }

  async scheduledJobHealth() {
    const jobs = await this.db.many<any>(
      `SELECT j.*,
        success.completed_at AS last_success_at,
        failure.completed_at AS last_failure_at,
        latest.status AS latest_status,
        latest.attempt AS latest_attempt,
        latest.next_retry_at,
        latest.error_summary,
        latest.created_at AS latest_created_at
       FROM ops_scheduled_jobs j
       LEFT JOIN LATERAL (
         SELECT completed_at FROM ops_scheduled_job_runs r
         WHERE r.job_name=j.job_name AND r.status='completed'
         ORDER BY completed_at DESC NULLS LAST LIMIT 1
       ) success ON TRUE
       LEFT JOIN LATERAL (
         SELECT completed_at FROM ops_scheduled_job_runs r
         WHERE r.job_name=j.job_name AND r.status='failed'
         ORDER BY completed_at DESC NULLS LAST LIMIT 1
       ) failure ON TRUE
       LEFT JOIN LATERAL (
         SELECT status, attempt, next_retry_at, error_summary, created_at
         FROM ops_scheduled_job_runs r WHERE r.job_name=j.job_name
         ORDER BY created_at DESC LIMIT 1
       ) latest ON TRUE
       WHERE j.is_active=TRUE
       ORDER BY j.job_name ASC`
    );
    const now = Date.now();
    return jobs.map((job) => {
      const lastSuccess = job.last_success_at ? new Date(job.last_success_at).getTime() : null;
      const lagMinutes = lastSuccess === null ? null : Math.max(0, Math.round((now - lastSuccess) / 60000));
      let freshness_status = job.source_finality === "pending_source" ? "pending_source" : "stale";
      if (job.latest_status === "failed") freshness_status = "failed";
      else if (lastSuccess !== null && lagMinutes! <= Number(job.freshness_sla_minutes)) {
        freshness_status = job.source_finality;
      }
      return {
        ...job,
        freshness_status,
        current_lag_minutes: lagMinutes,
        next_expected_at: lastSuccess === null
          ? null
          : new Date(lastSuccess + Number(job.freshness_sla_minutes) * 60000).toISOString()
      };
    });
  }

  async listScheduledJobRuns(jobName?: string) {
    return this.db.many(
      `SELECT * FROM ops_scheduled_job_runs
       ${jobName ? "WHERE job_name=$1" : ""}
       ORDER BY created_at DESC LIMIT 200`,
      jobName ? [jobName] : []
    );
  }

  async enqueueScheduledJob(jobName: string, body: RecordBody, actorPersonId: string) {
    const job = await this.db.one<any>("SELECT * FROM ops_scheduled_jobs WHERE job_name=$1 AND is_active=TRUE", [jobName]);
    if (!job) throw new NotFoundException("Scheduled job is not registered.");
    const schedulerTriggerId = String(body.scheduler_trigger_id || `manual_${actorPersonId}_${Date.now()}`);
    const existing = await this.db.one<any>(
      `SELECT * FROM ops_scheduled_job_runs
       WHERE job_name=$1 AND scheduler_trigger_id=$2
       ORDER BY created_at DESC LIMIT 1`,
      [jobName, schedulerTriggerId]
    );
    if (existing) return existing;
    const timestamp = this.now();
    const windowStart = body.requested_window_start || null;
    const windowEnd = body.requested_window_end || null;
    const run = {
      scheduled_job_run_id: this.id("jobrun"),
      job_name: jobName,
      requested_window_start: windowStart,
      requested_window_end: windowEnd,
      scheduler_trigger_id: schedulerTriggerId,
      queue_job_id: this.id("queue"),
      status: "queued",
      attempt: 1,
      records_received: 0,
      records_upserted: 0,
      records_rejected: 0,
      requested_by_person_id: actorPersonId,
      started_at: null,
      completed_at: null,
      error_summary: null,
      next_retry_at: null,
      created_at: timestamp
    };
    await this.db.exec(
      `INSERT INTO ops_scheduled_job_runs
       (scheduled_job_run_id, job_name, requested_window_start, requested_window_end,
        scheduler_trigger_id, queue_job_id, status, attempt, records_received,
        records_upserted, records_rejected, requested_by_person_id, started_at,
        completed_at, error_summary, next_retry_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      Object.values(run)
    );
    await this.audit("scheduled_job.enqueued", "scheduled_job_run", run.scheduled_job_run_id, null, run, actorPersonId);
    return run;
  }

  async completeScheduledJobRun(runId: string, body: RecordBody, actorPersonId: string) {
    const current = await this.db.one<any>(
      `SELECT r.*, j.max_attempts, j.backoff_seconds
       FROM ops_scheduled_job_runs r
       JOIN ops_scheduled_jobs j ON j.job_name=r.job_name
       WHERE r.scheduled_job_run_id=$1`,
      [runId]
    );
    if (!current) throw new NotFoundException("Scheduled job run not found.");
    const requestedStatus = String(body.status || "");
    if (!["completed", "failed"].includes(requestedStatus)) throw new BadRequestException("status must be completed or failed.");
    const completedAt = this.now();
    const shouldRetry = requestedStatus === "failed" && Number(current.attempt) < Number(current.max_attempts);
    const status = shouldRetry ? "retrying" : requestedStatus;
    const nextRetryAt = shouldRetry
      ? new Date(Date.now() + Number(body.backoff_seconds || current.backoff_seconds) * 1000).toISOString()
      : null;
    await this.db.exec(
      `UPDATE ops_scheduled_job_runs SET status=$2, started_at=COALESCE(started_at,$3),
       completed_at=$3, records_received=$4, records_upserted=$5, records_rejected=$6,
       error_summary=$7, next_retry_at=$8, attempt=$9 WHERE scheduled_job_run_id=$1`,
      [
        runId, status, completedAt, Number(body.records_received || 0),
        Number(body.records_upserted || 0), Number(body.records_rejected || 0),
        body.error_summary || null, nextRetryAt,
        shouldRetry ? Number(current.attempt) + 1 : Number(current.attempt)
      ]
    );
    const updated = await this.db.one<any>("SELECT * FROM ops_scheduled_job_runs WHERE scheduled_job_run_id=$1", [runId]);
    await this.audit(`scheduled_job.${status}`, "scheduled_job_run", runId, current, updated, actorPersonId);
    return updated;
  }

  async serviceHealth() {
    const jobs = await this.scheduledJobHealth();
    const queueDepths = await this.db.many<any>(
      `SELECT j.queue_name, COUNT(r.*)::int AS depth
       FROM ops_scheduled_jobs j
       LEFT JOIN ops_scheduled_job_runs r ON r.job_name=j.job_name AND r.status IN ('queued','running','retrying')
       GROUP BY j.queue_name ORDER BY j.queue_name`
    );
    const lastIngest = await this.db.one<any>(
      "SELECT MAX(completed_at) AS completed_at FROM ops_ingestion_runs WHERE status IN ('completed','completed_with_errors')"
    );
    const failing = jobs.filter((job) => ["failed", "stale"].includes(job.freshness_status)).length;
    return {
      status: failing ? "degraded" : "ok",
      service: "ops-api",
      database: "ok",
      queue_backend: process.env.REDIS_URL ? "configured" : "development_database_queue",
      queue_depths: Object.fromEntries(queueDepths.map((item) => [item.queue_name, Number(item.depth)])),
      last_ingest_at: lastIngest?.completed_at || null,
      scheduled_jobs: {
        total: jobs.length,
        healthy: jobs.length - failing,
        attention_required: failing
      }
    };
  }

  async listAudit() {
    return this.db.many("SELECT * FROM ops_audit_entries ORDER BY occurred_at DESC LIMIT 200");
  }
}
