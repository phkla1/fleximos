import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsController } from "./ops.controller.js";
import { OpsService } from "./ops.service.js";

@Module({
  controllers: [OpsController],
  providers: [DatabaseService, OpsService]
})
export class AppModule {}
