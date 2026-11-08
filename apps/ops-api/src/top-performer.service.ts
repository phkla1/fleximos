import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { PacingService } from "./pacing.service.js";

type Body = Record<string, unknown>;

export type TopPerformerSettings = {
  enabled: boolean;
  amount_ngn: number;
  threshold_ngn: number;
  updated_at?: string | null;
  updated_by_person_id?: string | null;
};

// Daily amoeba top-performer bonus. On any given day the single highest
// net-revenue earner in an amoeba earns a flat cash bonus, but only if their net
// revenue clears a floor (the accommodated steady target, ₦28k by default). It is
// a tracked payable — one row per (amoeba, day) that finance can total and mark
// paid — kept entirely separate from net revenue and Flexi Points.
@Injectable()
export class TopPerformerService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PacingService) private readonly pacing: PacingService
  ) {}

  private now() {
    return new Date().toISOString();
  }

  private num(value: unknown, field: string) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be a non-negative number.`);
    return n;
  }

  async getSettings(): Promise<TopPerformerSettings> {
    const row = await this.db.one<any>(
      "SELECT enabled, amount_ngn, threshold_ngn, updated_at::text AS updated_at, updated_by_person_id FROM ops_top_performer_bonus_settings WHERE id=1"
    );
    if (!row) return { enabled: true, amount_ngn: 2000, threshold_ngn: 28000 };
    return {
      enabled: row.enabled === true || row.enabled === "t" || row.enabled === 1,
      amount_ngn: Number(row.amount_ngn || 0),
      threshold_ngn: Number(row.threshold_ngn || 0),
      updated_at: row.updated_at || null,
      updated_by_person_id: row.updated_by_person_id || null
    };
  }

  async updateSettings(body: Body, actor: string): Promise<TopPerformerSettings> {
    const current = await this.getSettings();
    const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
    const amount = body.amount_ngn === undefined ? current.amount_ngn : this.num(body.amount_ngn, "amount_ngn");
    const threshold = body.threshold_ngn === undefined ? current.threshold_ngn : this.num(body.threshold_ngn, "threshold_ngn");
    await this.db.exec(
      `UPDATE ops_top_performer_bonus_settings
         SET enabled=$1, amount_ngn=$2, threshold_ngn=$3, updated_by_person_id=$4, updated_at=$5 WHERE id=1`,
      [enabled, amount, threshold, actor, this.now()]
    );
    await this.db.exec(
      `INSERT INTO ops_audit_entries
        (audit_id, actor_person_id, actor_type, action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1,$2,'human','top_performer_bonus.settings_updated','top_performer_bonus_settings','1',$3,$4,$5)`,
      [`audit_${randomUUID().replaceAll("-", "").slice(0, 26)}`, actor, current, { enabled, amount_ngn: amount, threshold_ngn: threshold }, this.now()]
    );
    return { enabled, amount_ngn: amount, threshold_ngn: threshold };
  }

  // Compute and persist the winner for every amoeba on `date`. Idempotent: the row
  // is upserted per (date, amoeba), and an amoeba whose best no longer clears the
  // floor has its award removed — unless it was already marked paid, which is left
  // untouched so a settled payable is never silently rewritten.
  async settleAwards(date: string): Promise<{ received: number; upserted: number; rejected: number }> {
    const day = this.ops.dateRange({ record_date: date }).to;
    const settings = await this.getSettings();
    if (!settings.enabled) return { received: 0, upserted: 0, rejected: 0 };

    const board = await this.pacing.pacingBoard({ record_date: day }, {});
    // Tiebreak needs registration order + the row's supervisor, which the pace
    // board doesn't carry. One cheap lookup keyed by operator.
    const meta = new Map<string, { activated_at: string; supervisor_person_id: string | null }>();
    const operators = await this.db.many<any>(
      "SELECT operator_id, activated_at::text AS activated_at, supervisor_person_id FROM ops_operators"
    );
    for (const op of operators) meta.set(op.operator_id, { activated_at: op.activated_at || "", supervisor_person_id: op.supervisor_person_id || null });

    const byAmoeba = new Map<string, any[]>();
    for (const row of board) {
      const amoeba = row.amoeba_id;
      if (!amoeba) continue;
      if (!byAmoeba.has(amoeba)) byAmoeba.set(amoeba, []);
      byAmoeba.get(amoeba)!.push(row);
    }

    let upserted = 0;
    let rejected = 0;
    for (const [amoebaId, rows] of byAmoeba) {
      const candidates = rows.filter((r) => Number(r.combined_earned_ngn || 0) > settings.threshold_ngn);
      if (!candidates.length) {
        // Nobody cleared the floor — drop any stale (unpaid) award for the day.
        await this.db.exec(
          "DELETE FROM ops_top_performer_awards WHERE record_date=$1 AND amoeba_id=$2 AND status <> 'paid'",
          [day, amoebaId]
        );
        rejected++;
        continue;
      }
      candidates.sort((a, b) => {
        const rev = Number(b.combined_earned_ngn || 0) - Number(a.combined_earned_ngn || 0);
        if (rev !== 0) return rev;
        const parcels = Number(b.scheduled_delivered || 0) - Number(a.scheduled_delivered || 0);
        if (parcels !== 0) return parcels;
        const aMeta = meta.get(a.operator_id)?.activated_at || "";
        const bMeta = meta.get(b.operator_id)?.activated_at || "";
        if (aMeta !== bMeta) return aMeta < bMeta ? -1 : 1; // earliest-registered wins
        return String(a.operator_id).localeCompare(String(b.operator_id));
      });
      const winner = candidates[0];
      const supervisor = meta.get(winner.operator_id)?.supervisor_person_id || null;
      const timestamp = this.now();
      await this.db.exec(
        `INSERT INTO ops_top_performer_awards
          (award_id, record_date, amoeba_id, operator_id, person_id, supervisor_person_id,
           net_revenue_ngn, amount_ngn, threshold_ngn, status, computed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'awarded',$10,$10,$10)
         ON CONFLICT (record_date, amoeba_id) DO UPDATE SET
           operator_id=EXCLUDED.operator_id,
           person_id=EXCLUDED.person_id,
           supervisor_person_id=EXCLUDED.supervisor_person_id,
           net_revenue_ngn=EXCLUDED.net_revenue_ngn,
           amount_ngn=EXCLUDED.amount_ngn,
           threshold_ngn=EXCLUDED.threshold_ngn,
           computed_at=EXCLUDED.computed_at,
           updated_at=EXCLUDED.updated_at
         WHERE ops_top_performer_awards.status <> 'paid'`,
        [`award_${randomUUID().replaceAll("-", "").slice(0, 26)}`, day, amoebaId, winner.operator_id,
         winner.person_id || null, supervisor, Math.round(Number(winner.combined_earned_ngn || 0) * 100) / 100,
         settings.amount_ngn, settings.threshold_ngn, timestamp]
      );
      upserted++;
    }
    return { received: byAmoeba.size, upserted, rejected };
  }

  private scopeClause(clauses: string[], params: unknown[], scope: OpsDataScope) {
    const visible: string[] = [];
    if (scope.supervisor_person_id) {
      params.push(scope.supervisor_person_id);
      visible.push(`supervisor_person_id = $${params.length}`);
    }
    if (scope.amoeba_ids?.length) {
      const placeholders = scope.amoeba_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`amoeba_id IN (${placeholders.join(", ")})`);
    }
    if (scope.supervisor_person_ids?.length) {
      const placeholders = scope.supervisor_person_ids.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      visible.push(`supervisor_person_id IN (${placeholders.join(", ")})`);
    }
    if (visible.length) clauses.push(`(${visible.join(" OR ")})`);
  }

  async listAwards(
    filters: { record_date?: string; date_from?: string; date_to?: string; amoeba_id?: string; operator_id?: string },
    scope: OpsDataScope = {}
  ) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.record_date || filters.date_from || filters.date_to) {
      const { from, to } = this.ops.dateRange(filters);
      params.push(from); clauses.push(`record_date >= $${params.length}`);
      params.push(to); clauses.push(`record_date <= $${params.length}`);
    } else {
      params.push(this.ops.dateRange({}).to); clauses.push(`record_date = $${params.length}`);
    }
    if (filters.amoeba_id) { params.push(filters.amoeba_id); clauses.push(`amoeba_id = $${params.length}`); }
    if (filters.operator_id) { params.push(filters.operator_id); clauses.push(`operator_id = $${params.length}`); }
    this.scopeClause(clauses, params, scope);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.many<any>(
      `SELECT award_id, record_date::text AS record_date, amoeba_id, operator_id, person_id,
        supervisor_person_id, net_revenue_ngn, amount_ngn, threshold_ngn, status,
        computed_at::text AS computed_at, updated_at::text AS updated_at
       FROM ops_top_performer_awards ${where} ORDER BY record_date DESC, amoeba_id ASC`,
      params
    );
    const total = rows.reduce((sum, r) => sum + (r.status !== "void" ? Number(r.amount_ngn || 0) : 0), 0);
    return { data: rows, total_payable_ngn: total };
  }

  async markPaid(awardId: string, actor: string) {
    const current = await this.db.one<any>("SELECT * FROM ops_top_performer_awards WHERE award_id=$1", [awardId]);
    if (!current) throw new NotFoundException("Award not found.");
    if (current.status === "paid") return current;
    if (current.status === "void") throw new BadRequestException("A void award cannot be marked paid.");
    await this.db.exec(
      "UPDATE ops_top_performer_awards SET status='paid', updated_at=$2 WHERE award_id=$1",
      [awardId, this.now()]
    );
    await this.db.exec(
      `INSERT INTO ops_audit_entries
        (audit_id, actor_person_id, actor_type, action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1,$2,'human','top_performer_bonus.paid','top_performer_award',$3,$4,$5,$6)`,
      [`audit_${randomUUID().replaceAll("-", "").slice(0, 26)}`, actor, awardId, { status: current.status }, { status: "paid" }, this.now()]
    );
    return { ...current, status: "paid" };
  }
}
