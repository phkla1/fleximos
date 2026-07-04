import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { JobRunnerService } from "./job-runner.service.js";
import { OpsController } from "./ops.controller.js";
import { OpsService } from "./ops.service.js";
import { PlatformConnectorsService } from "./platform-connectors.service.js";
import { SchedulerService } from "./scheduler.service.js";
import { NotificationService } from "./notification.service.js";

@Module({
  controllers: [OpsController],
  providers: [
    AuthService,
    DatabaseService,
    OpsService,
    PlatformConnectorsService,
    NotificationService,
    JobRunnerService,
    SchedulerService
  ]
})
export class AppModule {}
