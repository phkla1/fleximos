export type ScheduledJobDefinition = {
  job_name: string;
  owning_module: string;
  trigger_mechanism: string;
  schedule_wat: string;
  queue_name: string;
  timeout_seconds: number;
  max_attempts: number;
  backoff_seconds: number;
  idempotency_strategy: string;
  freshness_sla_minutes: number;
  dependencies: string[];
  alert_recipients: string[];
  source_finality: "pending_source" | "provisional" | "final";
};

function job(
  job_name: string, owning_module: string, trigger_mechanism: string,
  schedule_wat: string, queue_name: string, timeout_seconds: number,
  max_attempts: number, backoff_seconds: number, idempotency_strategy: string,
  freshness_sla_minutes: number, dependencies: string[], alert_recipients: string[],
  source_finality: ScheduledJobDefinition["source_finality"]
): ScheduledJobDefinition {
  return {
  job_name,
  owning_module,
  trigger_mechanism,
  schedule_wat,
  queue_name,
  timeout_seconds,
  max_attempts,
  backoff_seconds,
  idempotency_strategy,
  freshness_sla_minutes,
  dependencies,
  alert_recipients,
  source_finality
  };
}

export const scheduledJobs: ScheduledJobDefinition[] = [
  job("bolt-operational-ingest", "IngestModule", "external_cron", "Hourly 07:00-21:00", "platform-ingest", 900, 4, 300, "job/date/hour/account", 75, [], ["admin"], "provisional"),
  job("uber-operational-ingest", "IngestModule", "external_cron", "Hourly 07:00-21:00", "platform-ingest", 900, 4, 300, "job/date/hour/account", 75, [], ["admin"], "provisional"),
  job("cartracker-daily-ingest", "MileageModule", "external_cron", "Hourly 07:00-22:00; 23:30 final", "distance-ingest", 900, 4, 300, "job/date/hour/account", 75, [], ["admin"], "provisional"),
  job("distance-daily-retry", "MileageModule", "external_cron", "Daily 02:00; previous 7 days", "distance-ingest", 1800, 4, 900, "job/window", 1440, ["platform-ingest"], ["admin"], "pending_source"),
  job("uber-distance-report-backfill", "MileageModule", "external_cron", "Monday 03:00; previous week", "distance-ingest", 3600, 4, 1800, "job/window/account", 10080, [], ["admin"], "pending_source"),
  job("mileage-reconcile-provisional", "MileageModule", "event_trigger", "After distance or fuel update", "mileage-reconcile", 600, 3, 120, "job/date/operator", 120, ["distance-ingest"], ["admin"], "provisional"),
  job("mileage-reconcile-final", "MileageModule", "external_cron", "Daily 23:45 cars; Monday 04:00 Uber", "mileage-reconcile", 1800, 4, 600, "job/window/vehicle-class", 1440, ["distance-ingest"], ["admin"], "final"),
  job("alert-watchdog", "AlertsModule", "external_cron", "Every 15 min 07:00-22:00", "alerts", 300, 3, 60, "job/date/quarter-hour", 30, [], ["admin"], "final"),
  job("notification-dispatch", "NotificationsModule", "external_cron", "Every 5 minutes", "notifications", 300, 5, 60, "job/date/five-minute", 10, [], ["admin"], "final"),
  job("closeout-reminder", "CloseoutModule", "external_cron", "Daily 18:30", "notifications", 600, 3, 120, "job/date/supervisor", 30, [], ["supervisor"], "final"),
  job("closeout-escalation", "CloseoutModule", "external_cron", "Daily 19:05 and 20:05", "notifications", 600, 3, 120, "job/date/amoeba/tier", 30, ["closeout-reminder"], ["manager", "admin"], "final"),
  job("daily-report-generate", "ReportingModule", "external_cron", "Daily 19:15 and on demand", "reports", 1800, 3, 300, "job/date/amoeba/revision", 60, [], ["manager", "admin"], "final"),
  job("uber-token-refresh", "IngestModule", "external_cron", "Daily; before expiry margin", "credentials", 600, 4, 300, "job/date/account", 1440, [], ["admin"], "final"),
  job("backup-postgres", "PlatformModule", "system_cron", "Daily 01:00", "backups", 3600, 3, 1800, "job/date", 1560, [], ["admin"], "final"),
  job("retention-housekeeping", "PlatformModule", "external_cron", "Daily 04:30", "housekeeping", 1800, 3, 600, "job/date", 1560, [], ["admin"], "final")
];
