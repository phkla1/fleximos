import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeliveriesService } from "./deliveries.service.js";
import { DeliveriesImportService } from "./deliveries-import.service.js";
import { AttendanceService } from "./attendance.service.js";
import { DepthController } from "./depth.controller.js";
import { DepthService } from "./depth.service.js";
import { DocumentStoreService } from "./document-store.js";
import { FlexiPointsController } from "./flexi-points.controller.js";
import { FlexiPointsService } from "./flexi-points.service.js";
import { JobRunnerService } from "./job-runner.service.js";
import { AccommodationService } from "./accommodation.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { OpsController } from "./ops.controller.js";
import { OpsService } from "./ops.service.js";
import { BatchImportService } from "./batch-import.service.js";
import { BackfillService } from "./backfill.service.js";
import { PacingService } from "./pacing.service.js";
import { PlatformConnectorsService } from "./platform-connectors.service.js";
import { SchedulerService } from "./scheduler.service.js";
import { NotificationService } from "./notification.service.js";
import { TrackerIngestService } from "./tracker-ingest.service.js";
import { IntegrationStatusService } from "./integration-status.service.js";
import { RevenueSourcesService } from "./revenue-sources.service.js";

@Module({
  controllers: [OpsController, DepthController, DeliveriesController, FlexiPointsController],
  providers: [
    AuthService,
    DatabaseService,
    AccommodationService,
    OnboardingService,
    OpsService,
    BatchImportService,
    BackfillService,
    PacingService,
    DepthService,
    DocumentStoreService,
    FlexiPointsService,
    DeliveriesService,
    DeliveriesImportService,
    AttendanceService,
    PlatformConnectorsService,
    NotificationService,
    TrackerIngestService,
    IntegrationStatusService,
    RevenueSourcesService,
    JobRunnerService,
    SchedulerService
  ]
})
export class AppModule {}
