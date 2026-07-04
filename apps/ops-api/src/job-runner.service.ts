import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { PlatformConnectorsService } from "./platform-connectors.service.js";
import { NotificationService } from "./notification.service.js";

type JobRun = {
  scheduled_job_run_id: string;
  job_name: string;
  requested_window_start?: string | Date | null;
  requested_window_end?: string | Date | null;
  attempt: number;
};

@Injectable()
export class JobRunnerService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PlatformConnectorsService) private readonly connectors: PlatformConnectorsService,
    @Inject(NotificationService) private readonly notifications: NotificationService
  ) {}

  private recordDate(run: JobRun) {
    const requested = run.requested_window_start || run.requested_window_end;
    if (!requested) return this.ops.lagosDate();
    const isoDate = String(requested).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (isoDate && !(requested instanceof Date)) return isoDate;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(requested));
  }

  async claimNext(): Promise<JobRun | null> {
    const queued = await this.db.one<JobRun>(
      `SELECT scheduled_job_run_id, job_name, requested_window_start, requested_window_end, attempt
       FROM ops_scheduled_job_runs
       WHERE status IN ('queued', 'retrying') AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC LIMIT 1`
    );
    if (!queued) return null;
    const claimed = await this.db.one<JobRun>(
      `UPDATE ops_scheduled_job_runs SET status='running', started_at=NOW()
       WHERE scheduled_job_run_id=$1 AND status IN ('queued', 'retrying')
       RETURNING scheduled_job_run_id, job_name, requested_window_start, requested_window_end, attempt`,
      [queued.scheduled_job_run_id]
    );
    return claimed;
  }

  async runNext() {
    const run = await this.claimNext();
    if (!run) return null;
    try {
      const result = await this.execute(run);
      return this.ops.completeScheduledJobRun(run.scheduled_job_run_id, {
        status: "completed",
        records_received: result.received,
        records_upserted: result.upserted,
        records_rejected: result.rejected
      }, "person_system");
    } catch (error: any) {
      return this.ops.completeScheduledJobRun(run.scheduled_job_run_id, {
        status: "failed",
        error_summary: error?.message || "Scheduled job failed."
      }, "person_system");
    }
  }

  private async execute(run: JobRun) {
    const date = this.recordDate(run);
    if (run.job_name === "bolt-operational-ingest") return this.ingestPlatform("bolt", date);
    if (run.job_name === "uber-operational-ingest") return this.ingestPlatform("uber", date);
    if (run.job_name === "daily-report-generate") {
      const report = await this.ops.generateDailyReport({ record_date: date }, "person_system");
      return { received: report.rows.length, upserted: 1, rejected: 0 };
    }
    if (run.job_name === "alert-watchdog") return this.evaluateAlerts(date);
    if (run.job_name === "notification-dispatch") {
      const deliveries = await this.notifications.deliverBatch();
      const failed = deliveries.filter((delivery) => delivery.status !== "delivered").length;
      return { received: deliveries.length, upserted: deliveries.length - failed, rejected: failed };
    }
    if (run.job_name === "uber-token-refresh") {
      const accounts = (await this.ops.listPlatformAccounts() as any[]).filter((account: any) => account.platform === "uber" && account.is_active);
      for (const account of accounts) await this.connectors.fetchDaily(account, date);
      return { received: accounts.length, upserted: accounts.length, rejected: 0 };
    }
    throw new Error(`${run.job_name} has no executable worker handler yet.`);
  }

  private async ingestPlatform(platform: string, date: string) {
    const accounts = (await this.ops.listPlatformAccounts() as any[])
      .filter((account: any) => account.platform === platform && account.is_active);
    if (!accounts.length) throw new Error(`No active ${platform} platform accounts are configured.`);
    let received = 0;
    let upserted = 0;
    let rejected = 0;
    for (const account of accounts) {
      const records = await this.connectors.fetchDaily(account, date);
      received += records.length;
      if (!records.length) continue;
      const result: any = await this.ops.ingestDailyRecords({
        platform_account_id: account.platform_account_id,
        record_date: date,
        source: "live",
        records
      }, "person_system");
      upserted += Number(result.records_upserted || 0);
      rejected += Number(result.records_rejected || 0);
    }
    return { received, upserted, rejected };
  }

  private async evaluateAlerts(date: string) {
    const board = await this.ops.teamBoard({ record_date: date });
    let created = 0;
    for (const operator of board as any[]) {
      if (operator.current_status === "not_seen_today") {
        created += await this.ops.ensureAlert({
          operator_id: operator.operator_id,
          platform_account_id: operator.platforms?.[0]?.platform_account_id || null,
          alert_type: "not_seen_today",
          alert_date: date,
          tier: 1,
          episode_key: date,
          metadata: { generated_by: "alert-watchdog" }
        }) ? 1 : 0;
      } else if (operator.current_status === "offline") {
        created += await this.ops.ensureAlert({
          operator_id: operator.operator_id,
          platform_account_id: operator.platforms?.[0]?.platform_account_id || null,
          alert_type: "currently_offline",
          alert_date: date,
          tier: 0,
          episode_key: `${date}:offline`,
          metadata: { generated_by: "alert-watchdog" }
        }) ? 1 : 0;
      }
      if (operator.pace_status === "at_risk") {
        created += await this.ops.ensureAlert({
          operator_id: operator.operator_id,
          platform_account_id: operator.platforms?.[0]?.platform_account_id || null,
          alert_type: "revenue_pace_at_risk",
          alert_date: date,
          tier: 1,
          episode_key: date,
          metadata: {
            generated_by: "alert-watchdog",
            revenue_ngn: operator.ride_revenue_ngn,
            expected_revenue_ngn: operator.expected_revenue_ngn
          }
        }) ? 1 : 0;
      }
    }
    return { received: board.length, upserted: created, rejected: 0 };
  }
}
