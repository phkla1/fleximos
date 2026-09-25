import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";

type Body = Record<string, unknown>;

// Onboarding ramps (Phase 3). Kept dependency-light (DatabaseService only) so
// OpsService.teamBoard can resolve the ramp target without a circular import.
@Injectable()
export class OnboardingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }
  private now() {
    return new Date().toISOString();
  }
  private dateStr(value: unknown, field = "date") {
    const text = String(value || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
      throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date.`);
    }
    return text;
  }
  private num(value: unknown, field: string) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field} must be a non-negative number.`);
    return n;
  }
  private targets(value: unknown): number[] {
    const arr = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value || "[]") : [];
    if (!Array.isArray(arr) || !arr.length) throw new BadRequestException("daily_targets_ngn must be a non-empty array.");
    return arr.map((v) => Number(v) || 0);
  }

  private async audit(action: string, entityType: string, entityId: string, before: unknown, after: unknown, actor = "person_system") {
    await this.db.exec(
      `INSERT INTO ops_audit_entries
        (audit_id, actor_person_id, actor_type, action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [this.id("audit"), actor, actor === "person_system" ? "service" : "human", action, entityType, entityId, before, after, this.now()]
    );
  }

  /* ---------------- working-day counting ---------------- */

  // Day 1 = the anchor date itself. Counts calendar days in [anchor, date] that
  // are NOT the fixed weekly rest day. 0 = not started (date before anchor).
  workingDayN(anchor: string, date: string, restDow: number): number {
    const a = Date.parse(`${anchor}T00:00:00Z`);
    const d = Date.parse(`${date}T00:00:00Z`);
    if (d < a) return 0;
    const calDays = Math.round((d - a) / 86400000);
    if (calDays > 60) return calDays; // far past any ramp — skip the loop
    let n = 0;
    for (let i = 0; i <= calDays; i++) {
      const dow = new Date(a + i * 86400000).getUTCDay();
      if (dow !== restDow) n++;
    }
    return n;
  }

  /* ---------------- ramp profiles ---------------- */

  async listRampProfiles() {
    return this.db.many("SELECT * FROM ops_onboarding_ramp_profiles ORDER BY operator_class, effective_from DESC");
  }

  private async rampProfileFor(operatorClass: string, date: string): Promise<any | null> {
    return this.db.one<any>(
      `SELECT * FROM ops_onboarding_ramp_profiles
       WHERE operator_class = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)
       ORDER BY effective_from DESC LIMIT 1`,
      [operatorClass, date]
    );
  }

  async createRampProfile(body: Body, actor: string) {
    const operatorClass = String(body.operator_class || "rider");
    if (!["rider", "driver"].includes(operatorClass)) throw new BadRequestException("operator_class must be rider or driver.");
    const dailyTargets = this.targets(body.daily_targets_ngn);
    const profile = {
      ramp_profile_id: this.id("ramp"),
      operator_class: operatorClass,
      daily_targets_ngn: dailyTargets,
      parcels_per_hour_mode: String(body.parcels_per_hour_mode || "proportional"),
      parcels_per_hour_by_day: body.parcels_per_hour_by_day ?? null,
      scheduled_from_day: Math.max(1, Math.round(this.num(body.scheduled_from_day ?? 7, "scheduled_from_day"))),
      rest_day_of_week: Math.min(6, Math.round(this.num(body.rest_day_of_week ?? 0, "rest_day_of_week"))),
      completion_bonus_ngn: this.num(body.completion_bonus_ngn ?? 0, "completion_bonus_ngn"),
      missed_day_reduction_pct: this.num(body.missed_day_reduction_pct ?? 0, "missed_day_reduction_pct"),
      effective_from: this.dateStr(body.effective_from || this.now(), "effective_from"),
      created_by_person_id: actor,
      created_at: this.now(),
      updated_at: this.now()
    };
    // Close the prior open version for this class so lookups resolve one row.
    await this.db.exec(
      `UPDATE ops_onboarding_ramp_profiles SET effective_to = $2::date - 1, updated_at = $3
       WHERE operator_class = $1 AND effective_to IS NULL AND effective_from < $2`,
      [operatorClass, profile.effective_from, this.now()]
    );
    await this.db.exec(
      `INSERT INTO ops_onboarding_ramp_profiles
        (ramp_profile_id, operator_class, daily_targets_ngn, parcels_per_hour_mode, parcels_per_hour_by_day,
         scheduled_from_day, rest_day_of_week, completion_bonus_ngn, missed_day_reduction_pct,
         effective_from, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [profile.ramp_profile_id, profile.operator_class, profile.daily_targets_ngn, profile.parcels_per_hour_mode,
       profile.parcels_per_hour_by_day, profile.scheduled_from_day, profile.rest_day_of_week,
       profile.completion_bonus_ngn, profile.missed_day_reduction_pct, profile.effective_from,
       profile.created_by_person_id, profile.created_at, profile.updated_at]
    );
    await this.audit("onboarding_ramp.created", "onboarding_ramp_profile", profile.ramp_profile_id, null, profile, actor);
    return profile;
  }

  async updateRampProfile(id: string, body: Body, actor: string) {
    const current = await this.db.one<any>("SELECT * FROM ops_onboarding_ramp_profiles WHERE ramp_profile_id=$1", [id]);
    if (!current) throw new NotFoundException("Ramp profile not found.");
    const updated = {
      daily_targets_ngn: body.daily_targets_ngn === undefined ? this.targets(current.daily_targets_ngn) : this.targets(body.daily_targets_ngn),
      parcels_per_hour_mode: body.parcels_per_hour_mode === undefined ? current.parcels_per_hour_mode : String(body.parcels_per_hour_mode),
      parcels_per_hour_by_day: body.parcels_per_hour_by_day === undefined ? current.parcels_per_hour_by_day : body.parcels_per_hour_by_day,
      scheduled_from_day: body.scheduled_from_day === undefined ? current.scheduled_from_day : Math.max(1, Math.round(this.num(body.scheduled_from_day, "scheduled_from_day"))),
      rest_day_of_week: body.rest_day_of_week === undefined ? current.rest_day_of_week : Math.min(6, Math.round(this.num(body.rest_day_of_week, "rest_day_of_week"))),
      completion_bonus_ngn: body.completion_bonus_ngn === undefined ? current.completion_bonus_ngn : this.num(body.completion_bonus_ngn, "completion_bonus_ngn"),
      missed_day_reduction_pct: body.missed_day_reduction_pct === undefined ? current.missed_day_reduction_pct : this.num(body.missed_day_reduction_pct, "missed_day_reduction_pct"),
      updated_at: this.now()
    };
    await this.db.exec(
      `UPDATE ops_onboarding_ramp_profiles SET daily_targets_ngn=$2, parcels_per_hour_mode=$3,
        parcels_per_hour_by_day=$4, scheduled_from_day=$5, rest_day_of_week=$6, completion_bonus_ngn=$7,
        missed_day_reduction_pct=$8, updated_at=$9 WHERE ramp_profile_id=$1`,
      [id, updated.daily_targets_ngn, updated.parcels_per_hour_mode, updated.parcels_per_hour_by_day,
       updated.scheduled_from_day, updated.rest_day_of_week, updated.completion_bonus_ngn,
       updated.missed_day_reduction_pct, updated.updated_at]
    );
    await this.audit("onboarding_ramp.updated", "onboarding_ramp_profile", id, current, updated, actor);
    return { ...current, ...updated };
  }

  // The ramp snapshot for one operator on a date, or null if not in a ramp.
  private rampInfo(profile: any, anchor: string, date: string) {
    const targets = this.targets(profile.daily_targets_ngn);
    const restDow = Number(profile.rest_day_of_week || 0);
    const n = this.workingDayN(anchor, date, restDow);
    if (n < 1 || n > targets.length) return null; // not started, or graduated
    const dailyTarget = targets[n - 1];
    const graduation = targets[targets.length - 1];
    const scheduledFrom = Number(profile.scheduled_from_day || 7);
    let multiplier = graduation > 0 ? dailyTarget / graduation : 1;
    if (profile.parcels_per_hour_mode === "explicit") {
      const byDay = Array.isArray(profile.parcels_per_hour_by_day) ? profile.parcels_per_hour_by_day : null;
      if (byDay && byDay[n - 1] != null) multiplier = Number(byDay[n - 1]);
    }
    return {
      ramp_profile_id: profile.ramp_profile_id,
      day_n: n,
      total_days: targets.length,
      daily_target_ngn: dailyTarget,
      graduation_target_ngn: graduation,
      parcels_per_hour_multiplier: Math.round(multiplier * 1000) / 1000,
      phase: n >= scheduledFrom ? "scheduled_and_on_demand" : "on_demand_only",
      scheduled_from_day: scheduledFrom
    };
  }

  // Every active operator in a ramp window on `date`, keyed by operator_id.
  // Consumed by OpsService.teamBoard to override the daily target fairly.
  async rampTargetsForDate(date: string): Promise<Map<string, any>> {
    const day = this.dateStr(date, "record_date");
    const profiles = await this.db.many<any>(
      `SELECT * FROM ops_onboarding_ramp_profiles
       WHERE effective_from <= $1 AND (effective_to IS NULL OR effective_to >= $1)`,
      [day]
    );
    if (!profiles.length) return new Map();
    const byClass = new Map<string, any>();
    for (const p of profiles) if (!byClass.has(p.operator_class)) byClass.set(p.operator_class, p);
    const operators = await this.db.many<any>(
      `SELECT o.operator_id, o.operator_class, o.activated_at::text AS activated_at, c.start_date::text AS cohort_start
       FROM ops_operators o
       LEFT JOIN ops_onboarding_cohorts c ON c.cohort_id = o.onboarding_cohort_id
       WHERE o.operator_status = 'active'`
    );
    const out = new Map<string, any>();
    for (const op of operators) {
      const profile = byClass.get(op.operator_class || "rider");
      if (!profile) continue;
      const anchorRaw = op.cohort_start || op.activated_at;
      if (!anchorRaw) continue;
      const anchor = String(anchorRaw).slice(0, 10);
      const info = this.rampInfo(profile, anchor, day);
      if (info) out.set(op.operator_id, { ...info, anchor });
    }
    return out;
  }

  /* ---------------- cohorts ---------------- */

  async listCohorts() {
    return this.db.many(
      `SELECT c.*, (SELECT COUNT(*) FROM ops_operators o WHERE o.onboarding_cohort_id = c.cohort_id) AS member_count
       FROM ops_onboarding_cohorts c ORDER BY c.start_date DESC`
    );
  }

  async createCohort(body: Body, actor: string) {
    const cohort = {
      cohort_id: this.id("cohort"),
      name: String(body.name || "").trim() || `Cohort ${this.dateStr(body.start_date || this.now(), "start_date")}`,
      operator_class: String(body.operator_class || "rider"),
      amoeba_id: body.amoeba_id ? String(body.amoeba_id) : null,
      start_date: this.dateStr(body.start_date || this.now(), "start_date"),
      status: "active",
      created_by_person_id: actor,
      created_at: this.now(),
      updated_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_onboarding_cohorts
        (cohort_id, name, operator_class, amoeba_id, start_date, status, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      Object.values(cohort)
    );
    await this.audit("onboarding_cohort.created", "onboarding_cohort", cohort.cohort_id, null, cohort, actor);
    return cohort;
  }

  async addCohortMembers(cohortId: string, operatorIds: string[], actor: string) {
    const cohort = await this.db.one<any>("SELECT * FROM ops_onboarding_cohorts WHERE cohort_id=$1", [cohortId]);
    if (!cohort) throw new NotFoundException("Cohort not found.");
    const ids = (operatorIds || []).map(String).filter(Boolean);
    if (!ids.length) throw new BadRequestException("operator_ids must be a non-empty array.");
    let assigned = 0;
    for (const operatorId of ids) {
      const op = await this.db.one<any>("SELECT operator_id FROM ops_operators WHERE operator_id=$1", [operatorId]);
      if (!op) continue;
      await this.db.exec("UPDATE ops_operators SET onboarding_cohort_id=$2, updated_at=$3 WHERE operator_id=$1", [operatorId, cohortId, this.now()]);
      assigned++;
    }
    await this.audit("onboarding_cohort.members_added", "onboarding_cohort", cohortId, null, { operator_ids: ids }, actor);
    return { cohort_id: cohortId, assigned };
  }

  /* ---------------- completion status + cohort board ---------------- */

  // Combined earned per day = ride revenue + delivery allocated value. The
  // delivery side uses the class rate (per-customer overrides and the driver
  // daily basic are ignored here — this is the completion count, not payroll).
  private async dailyCombined(operatorId: string, from: string, to: string): Promise<Map<string, number>> {
    const combined = new Map<string, number>();
    const rides = await this.db.many<any>(
      `SELECT record_date::text AS record_date, SUM(ride_revenue_ngn) AS revenue
       FROM ops_platform_daily_records WHERE operator_id=$1 AND record_date BETWEEN $2 AND $3
       GROUP BY record_date`,
      [operatorId, from, to]
    );
    for (const r of rides) combined.set(String(r.record_date).slice(0, 10), Number(r.revenue || 0));
    const deliveries = await this.db.many<any>(
      `SELECT b.batch_date::text AS batch_date, SUM(a.delivered_count) AS delivered,
        (SELECT ap.price_ngn FROM ops_delivery_allocated_prices ap
          WHERE ap.effective_from <= b.batch_date AND (ap.effective_to IS NULL OR ap.effective_to >= b.batch_date)
            AND ap.operator_class IN (o.operator_class, 'all') AND ap.delivery_customer_id IS NULL
          ORDER BY (ap.operator_class = o.operator_class) DESC, ap.effective_from DESC LIMIT 1) AS rate
       FROM ops_delivery_assignments a
       JOIN ops_delivery_batches b ON b.batch_id = a.batch_id
       JOIN ops_operators o ON o.operator_id = a.operator_id
       WHERE a.operator_id=$1 AND b.batch_date BETWEEN $2 AND $3
       GROUP BY b.batch_date, o.operator_class`,
      [operatorId, from, to]
    );
    for (const d of deliveries) {
      const key = String(d.batch_date).slice(0, 10);
      const earned = Number(d.delivered || 0) * Number(d.rate || 0);
      combined.set(key, (combined.get(key) || 0) + earned);
    }
    return combined;
  }

  // Ramp + completion snapshot for one operator (PWA + cohort board).
  async operatorOnboardingStatus(operatorId: string, date: string) {
    const day = this.dateStr(date, "record_date");
    const op = await this.db.one<any>(
      `SELECT o.operator_id, o.operator_class, o.activated_at::text AS activated_at,
        c.start_date::text AS cohort_start FROM ops_operators o
       LEFT JOIN ops_onboarding_cohorts c ON c.cohort_id = o.onboarding_cohort_id
       WHERE o.operator_id=$1`,
      [operatorId]
    );
    if (!op) throw new NotFoundException("Operator not found.");
    const profile = await this.rampProfileFor(op.operator_class || "rider", day);
    if (!profile) return { operator_id: operatorId, in_ramp: false };
    const anchorRaw = op.cohort_start || op.activated_at;
    if (!anchorRaw) return { operator_id: operatorId, in_ramp: false };
    const anchor = String(anchorRaw).slice(0, 10);
    const info = this.rampInfo(profile, anchor, day);
    const targets = this.targets(profile.daily_targets_ngn);
    // Completion so far: how many elapsed ramp days met their target.
    const elapsed = Math.min(info ? info.day_n : this.workingDayN(anchor, day, Number(profile.rest_day_of_week || 0)), targets.length);
    let targetsHit = 0;
    if (elapsed >= 1) {
      const combined = await this.dailyCombined(operatorId, anchor, day);
      // Walk working days from the anchor, matching each to its ramp-day target.
      let wd = 0;
      const a = Date.parse(`${anchor}T00:00:00Z`);
      const dEnd = Date.parse(`${day}T00:00:00Z`);
      for (let t = a; t <= dEnd; t += 86400000) {
        if (new Date(t).getUTCDay() === Number(profile.rest_day_of_week || 0)) continue;
        wd++;
        if (wd > targets.length) break;
        const target = targets[wd - 1];
        const key = new Date(t).toISOString().slice(0, 10);
        if (target > 0 && (combined.get(key) || 0) >= target) targetsHit++;
      }
    }
    const bonus = Number(profile.completion_bonus_ngn || 0);
    const reduction = Number(profile.missed_day_reduction_pct || 0);
    // Scoreable days = days with a non-zero target (induction day excluded).
    const scoreableDays = targets.filter((t) => t > 0).length;
    const missed = Math.max(0, Math.min(elapsed, targets.length) - targetsHit
      - targets.slice(0, Math.min(elapsed, targets.length)).filter((t) => t === 0).length);
    const projectedBonus = Math.max(0, Math.round(bonus * (1 - (reduction / 100) * missed)));
    return {
      operator_id: operatorId,
      in_ramp: !!info,
      ...(info || {}),
      anchor,
      elapsed_ramp_days: elapsed,
      targets_hit: targetsHit,
      scoreable_days: scoreableDays,
      completion_bonus_ngn: bonus,
      projected_bonus_ngn: projectedBonus
    };
  }

  async cohortBoard(date: string) {
    const day = this.dateStr(date, "record_date");
    const cohorts = await this.db.many<any>("SELECT * FROM ops_onboarding_cohorts WHERE status='active' ORDER BY start_date DESC");
    const result = [];
    for (const cohort of cohorts) {
      const members = await this.db.many<any>(
        "SELECT operator_id, person_id, operator_class, amoeba_id FROM ops_operators WHERE onboarding_cohort_id=$1",
        [cohort.cohort_id]
      );
      const rows = [];
      for (const m of members) {
        const status = await this.operatorOnboardingStatus(m.operator_id, day);
        rows.push({ ...m, ...status });
      }
      result.push({ ...cohort, members: rows });
    }
    return result;
  }

  /* ---------------- supervisor onboarding ---------------- */

  async listSupervisorOnboardings(filters: { status?: string } = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.status) { params.push(filters.status); clauses.push(`status = $${params.length}`); }
    return this.db.many(
      `SELECT * FROM ops_supervisor_onboardings ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY start_date DESC`,
      params
    );
  }

  async createSupervisorOnboarding(body: Body, actor: string) {
    if (!body.supervisor_person_id) throw new BadRequestException("supervisor_person_id is required.");
    if (!body.host_amoeba_id) throw new BadRequestException("host_amoeba_id is required.");
    const record = {
      supervisor_onboarding_id: this.id("supon"),
      supervisor_person_id: String(body.supervisor_person_id),
      host_amoeba_id: String(body.host_amoeba_id),
      mentor_person_id: body.mentor_person_id ? String(body.mentor_person_id) : null,
      start_date: this.dateStr(body.start_date || this.now(), "start_date"),
      phase: "scheduled_assist",
      status: "active",
      graduated_at: null,
      target_amoeba_id: null,
      graduation_route: null,
      created_by_person_id: actor,
      created_at: this.now(),
      updated_at: this.now()
    };
    await this.db.exec(
      `INSERT INTO ops_supervisor_onboardings
        (supervisor_onboarding_id, supervisor_person_id, host_amoeba_id, mentor_person_id, start_date,
         phase, status, graduated_at, target_amoeba_id, graduation_route, created_by_person_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      Object.values(record)
    );
    await this.audit("supervisor_onboarding.created", "supervisor_onboarding", record.supervisor_onboarding_id, null, record, actor);
    return record;
  }

  async advanceSupervisorPhase(id: string, body: Body, actor: string) {
    const current = await this.db.one<any>("SELECT * FROM ops_supervisor_onboardings WHERE supervisor_onboarding_id=$1", [id]);
    if (!current) throw new NotFoundException("Supervisor onboarding not found.");
    const phase = String(body.phase || "");
    if (!["scheduled_assist", "on_demand_assist"].includes(phase)) {
      throw new BadRequestException("phase must be scheduled_assist or on_demand_assist.");
    }
    if (current.status !== "active") throw new BadRequestException("Only an active onboarding can change phase.");
    await this.db.exec(
      "UPDATE ops_supervisor_onboardings SET phase=$2, updated_at=$3 WHERE supervisor_onboarding_id=$1",
      [id, phase, this.now()]
    );
    await this.audit("supervisor_onboarding.phase", "supervisor_onboarding", id, { phase: current.phase }, { phase }, actor);
    return { ...current, phase };
  }

  // Graduation is an explicit HR action (no auto-timer). Route is either a plain
  // reassignment to a ready amoeba or a later cell-split; both just reference the
  // target amoeba here — the actual amoeba/roster moves happen via existing tools.
  async graduateSupervisor(id: string, body: Body, actor: string) {
    const current = await this.db.one<any>("SELECT * FROM ops_supervisor_onboardings WHERE supervisor_onboarding_id=$1", [id]);
    if (!current) throw new NotFoundException("Supervisor onboarding not found.");
    if (current.status === "graduated") return current;
    const route = String(body.graduation_route || "reassign");
    if (!["reassign", "cell_split"].includes(route)) throw new BadRequestException("graduation_route must be reassign or cell_split.");
    const targetAmoeba = body.target_amoeba_id ? String(body.target_amoeba_id) : null;
    const timestamp = this.now();
    await this.db.exec(
      `UPDATE ops_supervisor_onboardings SET status='graduated', phase='graduated', graduated_at=$2,
        target_amoeba_id=$3, graduation_route=$4, updated_at=$2 WHERE supervisor_onboarding_id=$1`,
      [id, timestamp, targetAmoeba, route]
    );
    await this.audit("supervisor_onboarding.graduated", "supervisor_onboarding", id, current,
      { status: "graduated", target_amoeba_id: targetAmoeba, graduation_route: route }, actor);
    return { ...current, status: "graduated", phase: "graduated", graduated_at: timestamp, target_amoeba_id: targetAmoeba, graduation_route: route };
  }
}
