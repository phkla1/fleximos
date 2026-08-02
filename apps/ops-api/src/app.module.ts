import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeliveriesService } from "./deliveries.service.js";
import { DepthController } from "./depth.controller.js";
import { DepthService } from "./depth.service.js";
import { JobRunnerService } from "./job-runner.service.js";
import { OpsController } from "./ops.controller.js";
import { OpsService } from "./ops.service.js";
import { PlatformConnectorsService } from "./platform-connectors.service.js";
import { SchedulerService } from "./scheduler.service.js";
import { NotificationService } from "./notification.service.js";

@Module({
  controllers: [OpsController, DepthController, DeliveriesController],
  providers: [
    AuthService,
    DatabaseService,
    OpsService,
    DepthService,
    DeliveriesService,
    PlatformConnectorsService,
    NotificationService,
    JobRunnerService,
    SchedulerService
  ]
})
export class AppModule {}
