import { Inject, Injectable } from "@nestjs/common";
import { OpsService } from "./ops.service.js";

type DueJob = {
  jobName: string;
  triggerId: string;
  recordDate: string;
};

@Injectable()
export class SchedulerService {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  dueJobs(now = new Date()): DueJob[] {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
    const recordDate = `${value("year")}-${value("month")}-${value("day")}`;
    const hour = Number(value("hour"));
    const minute = Number(value("minute"));
    const slot = `${recordDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:WAT`;
    const jobs: DueJob[] = [];
    const add = (jobName: string) => jobs.push({
      jobName,
      triggerId: `scheduler:${jobName}:${slot}`,
      recordDate
    });

    if (minute === 0 && hour >= 7 && hour <= 21) {
      add("bolt-operational-ingest");
      add("uber-operational-ingest");
    }
    if (minute % 15 === 0 && hour >= 7 && hour <= 22) add("alert-watchdog");
    if (minute % 5 === 0) add("notification-dispatch");
    if (hour === 19 && minute === 15) add("daily-report-generate");
    if (hour === 4 && minute === 0) add("uber-token-refresh");
    return jobs;
  }

  async tick(now = new Date()) {
    const runs = [];
    for (const due of this.dueJobs(now)) {
      runs.push(await this.ops.enqueueScheduledJob(due.jobName, {
        requested_window_start: `${due.recordDate}T00:00:00+01:00`,
        requested_window_end: `${due.recordDate}T23:59:59+01:00`,
        scheduler_trigger_id: due.triggerId
      }, "person_system"));
    }
    return runs;
  }
}
