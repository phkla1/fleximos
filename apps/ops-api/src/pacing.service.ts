import { Inject, Injectable } from "@nestjs/common";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { DeliveriesService } from "./deliveries.service.js";
import { OpsService } from "./ops.service.js";

// Day-shape constants (Lagos wall clock, minutes since midnight).
const CLOSE_MINUTES = 20 * 60; // 20:00 — end of the earning day for online pace.
const DEFAULT_DISPATCH_MINUTES = 8 * 60; // fallback resumption when there is no check-in.
const DELIVERY_TOLERANCE_PARCELS = 2; // grace before a rider counts as behind on parcels.

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function clockLabel(minutes: number) {
  const m = clamp(Math.round(minutes), 0, 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Resumption-aware pacing snapshot. Layers scheduled-delivery earnings and the
// check-in time onto the existing ride-only pace board so a rider on Speedaf all
// morning is judged on total attributed value, not ride revenue alone.
@Injectable()
export class PacingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService
  ) {}

  private lagosMinutesOf(timestamp: string | null): number | null {
    if (!timestamp) return null;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    return this.ops.lagosClock(parsed).minutes;
  }

  async pacingBoard(
    filters: { record_date?: string; amoeba_id?: string },
    scope: OpsDataScope = {}
  ) {
    const range = this.ops.dateRange({ record_date: filters.record_date });
    const date = range.to;
    const board = await this.ops.teamBoard(
      { record_date: date, amoeba_id: filters.amoeba_id },
      scope
    );
    const schedule = await this.deliveries.operatorScheduleForDate(date);
    const profiles = await this.ops.listRevenuePaceProfiles();

    // Approved check-ins for the day → resumption (day start) per operator.
    const checkinRows = await this.db.many<any>(
      `SELECT operator_id, decided_at FROM ops_operator_checkins
       WHERE check_in_date = $1 AND status = 'approved'`,
      [date]
    );
    const resumption = new Map<string, number | null>();
    for (const row of checkinRows) resumption.set(row.operator_id, this.lagosMinutesOf(row.decided_at));

    // Where the day sits on the Lagos clock. A past date is fully elapsed; a
    // future one has not started.
    const clock = this.ops.lagosClock();
    const nowMinutes = date < clock.today ? 24 * 60 : date > clock.today ? 0 : clock.minutes;

    return board.map((row: any) => {
      const vehicleType = row.vehicle_type;
      const profile: any = profiles.find((item: any) =>
        item.vehicle_type === vehicleType
        && item.effective_from <= date
        && (!item.effective_to || item.effective_to >= date)
      );
      const warning = Number(profile?.warning_tolerance_pct || 10);
      const critical = Number(profile?.critical_tolerance_pct || 20);
      const parcelsPerHour = Math.max(0.1, Number(profile?.delivery_parcels_per_hour || 5));
      const bufferMinutes = Math.max(0, Number(profile?.delivery_journey_buffer_hours || 1)) * 60;

      const sched = schedule.get(row.operator_id) || { assigned: 0, delivered: 0, earned: 0 };
      const scheduledEarned = Math.round(sched.earned * 100) / 100;
      const onlineEarned = Number(row.ride_revenue_ngn || 0);
      const dailyTarget = Number(row.daily_revenue_target_ngn || 0);
      const onlineTarget = Math.max(0, Math.round((dailyTarget - scheduledEarned) * 100) / 100);

      const resumedAt = resumption.has(row.operator_id) ? resumption.get(row.operator_id)! : null;
      const dayStart = resumedAt ?? DEFAULT_DISPATCH_MINUTES;
      const checkedIn = resumption.has(row.operator_id) && resumedAt !== null;

      // Delivery pacing — how far through the assigned parcels the rider should
      // be by now, and whether they trail it beyond the grace.
      const assigned = sched.assigned;
      const delivered = sched.delivered;
      const deliveryElapsedHours = Math.max(0, (nowMinutes - dayStart - bufferMinutes) / 60);
      const expectedDelivered = assigned > 0
        ? clamp(Math.floor(deliveryElapsedHours * parcelsPerHour), 0, assigned)
        : 0;
      const behindSchedule = assigned > 0 && delivered < expectedDelivered - DELIVERY_TOLERANCE_PARCELS;
      // "Online by" — when the assigned parcels should be cleared and the rider
      // should switch to on-demand.
      const resumptionDeadlineMinutes = assigned > 0
        ? dayStart + bufferMinutes + Math.ceil(assigned / parcelsPerHour) * 60
        : null;

      // Online pace — expected online earnings from resumption to close (20:00)
      // against what still has to come online after scheduled work.
      const onlineWindow = Math.max(1, CLOSE_MINUTES - dayStart);
      const onlineElapsed = clamp(nowMinutes - dayStart, 0, onlineWindow);
      const expectedOnline = Math.round(onlineTarget * (onlineElapsed / onlineWindow) * 100) / 100;
      const onlinePace = this.ops.paceStatus(onlineEarned, expectedOnline, onlineTarget, warning, critical);

      // Combined pace — the headline. Judges total attributed value (online +
      // scheduled) against the day's expected-by-now, so scheduled work counts.
      const combinedActual = Math.round((onlineEarned + scheduledEarned) * 100) / 100;
      const combinedPace = this.ops.paceStatus(
        combinedActual,
        Number(row.expected_revenue_ngn || 0),
        Number(row.range_revenue_target_ngn || 0),
        warning,
        critical
      );

      return {
        operator_id: row.operator_id,
        person_id: row.person_id,
        amoeba_id: row.amoeba_id,
        vehicle_type: vehicleType,
        vehicle_plate: row.vehicle_plate,
        record_date: date,
        current_status: row.current_status,
        daily_revenue_target_ngn: dailyTarget,
        // Resumption / check-in
        checked_in: checkedIn,
        resumption_minute: checkedIn ? dayStart : null,
        resumption_time: checkedIn ? clockLabel(dayStart) : null,
        day_start_minute: dayStart,
        day_start_source: checkedIn ? "check_in" : "default_dispatch",
        resumption_deadline_minute: resumptionDeadlineMinutes,
        resumption_deadline: resumptionDeadlineMinutes === null ? null : clockLabel(resumptionDeadlineMinutes),
        // Scheduled delivery
        scheduled_assigned: assigned,
        scheduled_delivered: delivered,
        scheduled_expected_delivered: expectedDelivered,
        scheduled_attributed_earned_ngn: scheduledEarned,
        behind_schedule: behindSchedule,
        // Online
        online_earned_ngn: onlineEarned,
        online_target_ngn: onlineTarget,
        online_expected_ngn: expectedOnline,
        online_pace_status: onlinePace.pace_status,
        online_pace_variance_pct: onlinePace.pace_variance_pct,
        // Combined headline
        combined_earned_ngn: combinedActual,
        combined_expected_ngn: Number(row.expected_revenue_ngn || 0),
        combined_pace_status: combinedPace.pace_status,
        combined_pace_variance_pct: combinedPace.pace_variance_pct,
        // Ride-only pace stays available (from teamBoard).
        ride_pace_status: row.pace_status,
        open_alerts: row.open_alerts
      };
    });
  }
}
