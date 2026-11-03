import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsActor, OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { DeliveriesService } from "./deliveries.service.js";
import { OpsService } from "./ops.service.js";

type RecordBody = Record<string, unknown>;

// Flexi Points — Phase 1.
//
// Points are a performance record, earned from a rider's VERIFIED combined daily
// revenue (ride-hailing net earnings + attributed delivery earnings). They sit on
// top of the pay scheme and change nothing about it. They are NOT a share of
// ownership: Fleximotion owns the bike 100% until the full points target is
// reached and a transfer is completed.
//
// Phase 1 is a derived read-model, like the leaderboard — a day's points are
// computed from the same source revenue every other surface reads, so the ledger
// is always reproducible from (source revenue + config). Writable adjustments,
// disputes, pauses, and the transfer workflow come in later phases.
@Injectable()
export class FlexiPointsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService
  ) {}

  private now() {
    return new Date().toISOString();
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  // Normalise a DB date (Date or string) to a YYYY-MM-DD key.
  private dayKey(value: unknown): string {
    if (value instanceof Date) {
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return String(value).slice(0, 10);
  }

  // Monday (Lagos week start) of the given YYYY-MM-DD date.
  private weekStart(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    const dow = parsed.getUTCDay(); // 0 = Sunday
    const back = dow === 0 ? 6 : dow - 1;
    parsed.setUTCDate(parsed.getUTCDate() - back);
    return parsed.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- config

  async config() {
    return this.db.one<any>("SELECT * FROM ops_flexi_points_config ORDER BY updated_at DESC LIMIT 1");
  }

  async updateConfig(body: RecordBody, actorPersonId: string) {
    const current = await this.config();
    if (!current) throw new NotFoundException("Flexi Points configuration is not initialised.");

    // Money fields: positive numbers. daily_cap is the one nullable field
    // (null = no cap, the configured default).
    const money = (field: string) => {
      if (body[field] === undefined) return Number(current[field]);
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value <= 0) throw new BadRequestException(`${field} must be a positive number.`);
      return value;
    };
    const count = (field: string) => {
      if (body[field] === undefined) return Number(current[field]);
      const value = Number(body[field]);
      if (!Number.isInteger(value) || value <= 0) throw new BadRequestException(`${field} must be a positive whole number.`);
      return value;
    };
    const cap = body.daily_cap === undefined
      ? (current.daily_cap == null ? null : Number(current.daily_cap))
      : (body.daily_cap === null || body.daily_cap === "" ? null : (() => {
          const value = Number(body.daily_cap);
          if (!Number.isInteger(value) || value <= 0) throw new BadRequestException("daily_cap must be a positive whole number, or null for no cap.");
          return value;
        })());

    const next = {
      standard_threshold_ngn: money("standard_threshold_ngn"),
      accommodated_threshold_ngn: money("accommodated_threshold_ngn"),
      accelerator_step_ngn: money("accelerator_step_ngn"),
      points_target: count("points_target"),
      daily_cap: cap,
      take_home_points: count("take_home_points"),
      cadence_points: count("cadence_points"),
      cadence_days: count("cadence_days"),
      audit_points: count("audit_points"),
      transfer_window_days: count("transfer_window_days"),
      enrollment: String(body.enrollment ?? current.enrollment)
    };
    if (next.enrollment !== "automatic") {
      // Locked decision: all active riders are enrolled automatically.
      throw new BadRequestException("enrollment is 'automatic' in Phase 1 — all active riders are enrolled.");
    }
    if (next.take_home_points > next.points_target || next.audit_points > next.points_target) {
      throw new BadRequestException("Milestone points cannot exceed the points target.");
    }

    await this.db.exec(
      `UPDATE ops_flexi_points_config SET
         standard_threshold_ngn = $2, accommodated_threshold_ngn = $3, accelerator_step_ngn = $4,
         points_target = $5, daily_cap = $6, take_home_points = $7, cadence_points = $8,
         cadence_days = $9, audit_points = $10, transfer_window_days = $11, enrollment = $12,
         updated_by_person_id = $13, updated_at = $14
       WHERE config_id = $1`,
      [
        current.config_id,
        next.standard_threshold_ngn, next.accommodated_threshold_ngn, next.accelerator_step_ngn,
        next.points_target, next.daily_cap, next.take_home_points, next.cadence_points,
        next.cadence_days, next.audit_points, next.transfer_window_days, next.enrollment,
        actorPersonId, this.now()
      ]
    );
    const updated = await this.config();
    await this.ops.audit("flexi_points_config.updated", "flexi_points_config", current.config_id, current, updated, actorPersonId);
    return updated;
  }

  // ---------------------------------------------------------- computation

  // Points for one day's verified revenue: nothing below the threshold, one
  // point at the threshold, then one more for every full accelerator step above
  // it. No cap unless one is configured. This is the whole earning rule.
  private pointsForDay(revenue: number, threshold: number, step: number, cap: number | null): number {
    if (revenue < threshold) return 0;
    const raw = 1 + Math.floor((revenue - threshold) / step);
    return cap && cap > 0 ? Math.min(cap, raw) : raw;
  }

  // Per-day verified revenue and points for one operator over a window.
  private async dailyLedger(operator: any, periodStart: string, periodEnd: string, cfg: any) {
    const accommodated = Boolean(operator.accommodated);
    const threshold = Number(accommodated ? cfg.accommodated_threshold_ngn : cfg.standard_threshold_ngn);
    const step = Number(cfg.accelerator_step_ngn);
    const cap = cfg.daily_cap == null ? null : Number(cfg.daily_cap);

    // Ride half of the day's revenue — AUTHORITATIVE records only. A point must
    // reward verified revenue; a manual/derived figure is not verified and does
    // not earn points until it is confirmed by the feed.
    const rideRows = await this.db.many<any>(
      `SELECT record_date, SUM(net_earnings_ngn) AS ride_ngn
       FROM ops_platform_daily_records
       WHERE operator_id = $1 AND record_date BETWEEN $2 AND $3 AND data_quality = 'authoritative'
       GROUP BY record_date`,
      [operator.operator_id, periodStart, periodEnd]
    );
    const rideByDay = new Map<string, number>(rideRows.map((row) => [this.dayKey(row.record_date), Number(row.ride_ngn || 0)]));

    // Delivery half — attributed (allocated) earnings from imported batches.
    const deliveryAll = await this.deliveries.operatorAllocatedByDay(periodStart, periodEnd);
    const deliveryByDay = deliveryAll.get(operator.operator_id) || new Map<string, number>();

    const days = new Set<string>([...rideByDay.keys(), ...deliveryByDay.keys()]);
    const ledger = [...days].sort().map((day) => {
      const ride = rideByDay.get(day) || 0;
      const delivery = deliveryByDay.get(day) || 0;
      const verified = this.round2(ride + delivery);
      const basePoint = verified >= threshold ? 1 : 0;
      const stepPoints = verified >= threshold ? Math.floor((verified - threshold) / step) : 0;
      const points = this.pointsForDay(verified, threshold, step, cap);
      return {
        record_date: day,
        ride_revenue_ngn: this.round2(ride),
        delivery_earned_ngn: this.round2(delivery),
        verified_revenue_ngn: verified,
        threshold_ngn: threshold,
        base_point: basePoint,
        step_points: stepPoints,
        points
      };
    });
    return { accommodated, threshold, step, cap, ledger };
  }

  // The rider's whole history, from activation to today. Phase 1 reads it live
  // on every request; the window is bounded by the operator's own tenure.
  private async lifetime(operator: any, cfg: any) {
    const today = this.ops.lagosDate();
    const anchor = this.dayKey(operator.activated_at || operator.created_at || today);
    const start = anchor <= today ? anchor : today;
    return this.dailyLedger(operator, start, today, cfg);
  }

  private milestones(cfg: any, balance: number) {
    return [
      {
        key: "take_home",
        label: "Take your bike home",
        points: Number(cfg.take_home_points),
        reached: balance >= Number(cfg.take_home_points)
      },
      {
        key: "audit",
        label: "Final check",
        points: Number(cfg.audit_points),
        reached: balance >= Number(cfg.audit_points)
      },
      {
        key: "transfer",
        label: "Bike transfer",
        points: Number(cfg.points_target),
        reached: balance >= Number(cfg.points_target)
      }
    ];
  }

  // Plain-language explanation of today's points — straight numbers, no jargon.
  private todayMessage(row: any | null, threshold: number, step: number): string {
    const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
    if (!row || row.verified_revenue_ngn <= 0) {
      return "No confirmed earnings yet today. Points show up here once your earnings are confirmed.";
    }
    if (row.points === 0) {
      const toGo = Math.max(0, threshold - row.verified_revenue_ngn);
      return `${naira(row.verified_revenue_ngn)} confirmed so far today. Earn ${naira(toGo)} more to get your first point.`;
    }
    const base = `${naira(row.verified_revenue_ngn)} confirmed today — that passed ${naira(threshold)}, so you earned 1 point`;
    if (row.step_points > 0) {
      const stepWord = row.step_points === 1 ? `one more ${naira(step)}` : `${row.step_points} more ${naira(step)} steps`;
      return `${base}, and ${stepWord} on top adds ${row.step_points}. ${row.points} points today.`;
    }
    return `${base}. ${row.points} point${row.points === 1 ? "" : "s"} today.`;
  }

  // Full rider-facing summary — balance, today, this week, milestones, and the
  // config echo the screens render. Also the supervisor/HR per-rider view.
  async summaryForOperator(operator: any) {
    const cfg = await this.config();
    if (!cfg) throw new NotFoundException("Flexi Points configuration is not initialised.");
    const { accommodated, threshold, step, cap, ledger } = await this.lifetime(operator, cfg);
    const balance = ledger.reduce((sum, day) => sum + day.points, 0);
    const today = this.ops.lagosDate();
    const todayRow = ledger.find((day) => day.record_date === today) || null;
    const weekStart = this.weekStart(today);
    const thisWeek = ledger.filter((day) => day.record_date >= weekStart);
    const weekPoints = thisWeek.reduce((sum, day) => sum + day.points, 0);
    const pointsTarget = Number(cfg.points_target);

    return {
      operator_id: operator.operator_id,
      person_id: operator.person_id,
      amoeba_id: operator.amoeba_id,
      vehicle_plate: operator.vehicle_plate || null,
      accommodated,
      enrolled: operator.operator_status === "active",
      balance,
      points_target: pointsTarget,
      points_remaining: Math.max(0, pointsTarget - balance),
      progress_pct: pointsTarget ? Math.min(100, Math.round((balance / pointsTarget) * 1000) / 10) : 0,
      threshold_ngn: threshold,
      accelerator_step_ngn: step,
      daily_cap: cap,
      today: {
        record_date: today,
        verified_revenue_ngn: todayRow?.verified_revenue_ngn || 0,
        points: todayRow?.points || 0,
        base_point: todayRow?.base_point || 0,
        step_points: todayRow?.step_points || 0,
        message: this.todayMessage(todayRow, threshold, step)
      },
      this_week: { week_start: weekStart, points: weekPoints, days: thisWeek },
      milestones: this.milestones(cfg, balance),
      ledger,
      // The programme's own guardrail, shown verbatim to the rider.
      bike_note: "Points show your performance. Fleximotion owns the bike until you reach the full points target and a transfer is completed."
    };
  }

  // Resolve the operator profile for the signed-in rider.
  async summaryForActor(actor: OpsActor) {
    const operators = await this.ops.listOperators({}, { person_id: actor.person_id });
    const operator = operators.find((item: any) => item.person_id === actor.person_id);
    if (!operator) throw new NotFoundException("No operator profile is linked to this account.");
    return this.summaryForOperator(operator);
  }

  // Supervisor/HR view of one rider's ledger — scope-checked via getOperator.
  async summaryById(operatorId: string, scope: OpsDataScope) {
    const operator = await this.ops.getOperator(operatorId, scope);
    return this.summaryForOperator(operator);
  }
}
