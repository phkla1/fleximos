import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { OpsService } from "./ops.service.js";

const serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

@Controller()
export class OpsController {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  private auth(req: Request) {
    if (req.headers.authorization !== `Bearer ${serviceToken}`) throw new UnauthorizedException("Missing or invalid bearer token.");
    return String(req.headers["x-actor-person-id"] || "person_founder_wole");
  }

  private key(value?: string) {
    if (!value || value.length < 8) throw new UnauthorizedException("Mutating requests require an Idempotency-Key header.");
    return value;
  }

  private async mutate(key: string, status: number, factory: () => Promise<any>) {
    const cached = await this.ops.cached(key);
    if (cached) return cached.body;
    const body = await factory();
    await this.ops.remember(key, status, body);
    return body;
  }

  @Get()
  root() {
    return {
      name: "Fleximotion Ops API",
      version: "v1",
      status: "ok",
      database: "PGlite/PostgreSQL",
      links: {
        health: "/health",
        operators: "/ops/v1/operators",
        vehicles: "/ops/v1/vehicles",
        platform_accounts: "/ops/v1/platform-accounts",
        alerts: "/ops/v1/alerts",
        audit: "/ops/v1/audit"
      }
    };
  }

  @Get("health")
  health() {
    return { status: "ok", service: "ops-api", database: "PGlite/PostgreSQL" };
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Get("ops/v1/operators")
  async listOperators(@Req() req: Request, @Query("status") status?: string, @Query("amoeba_id") amoebaId?: string) {
    this.auth(req);
    return { data: await this.ops.listOperators({ status, amoeba_id: amoebaId }), next_cursor: null };
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Get("ops/v1/operators/:operatorId")
  async getOperator(@Req() req: Request, @Param("operatorId") operatorId: string) {
    this.auth(req);
    return this.ops.getOperator(operatorId);
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Post("ops/v1/operators")
  @ApiOperation({ summary: "Create an operational actor linked to Identity person_id" })
  async createOperator(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    this.auth(req);
    const key = this.key(rawKey);
    return this.mutate(key, HttpStatus.CREATED, () => this.ops.createOperator(body));
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Patch("ops/v1/operators/:operatorId")
  async updateOperator(
    @Req() req: Request,
    @Param("operatorId") operatorId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.updateOperator(operatorId, body));
  }

  @ApiTags("Platform Accounts")
  @ApiBearerAuth()
  @Post("ops/v1/operators/:operatorId/platform-registrations")
  async registerPlatform(
    @Req() req: Request,
    @Param("operatorId") operatorId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.registerPlatform(operatorId, body));
  }

  @ApiTags("Vehicles")
  @ApiBearerAuth()
  @Get("ops/v1/vehicles")
  async listVehicles(@Req() req: Request) {
    this.auth(req);
    return { data: await this.ops.listVehicles(), next_cursor: null };
  }

  @ApiTags("Vehicles")
  @ApiBearerAuth()
  @Post("ops/v1/vehicles")
  async createVehicle(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createVehicle(body));
  }

  @ApiTags("Platform Accounts")
  @ApiBearerAuth()
  @Get("ops/v1/platform-accounts")
  async listPlatformAccounts(@Req() req: Request) {
    this.auth(req);
    return { data: await this.ops.listPlatformAccounts(), next_cursor: null };
  }

  @ApiTags("Platform Accounts")
  @ApiBearerAuth()
  @Post("ops/v1/platform-accounts")
  async createPlatformAccount(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createPlatformAccount(body));
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Get("ops/v1/alerts")
  async listAlerts(
    @Req() req: Request,
    @Query("resolution_status") resolutionStatus?: string,
    @Query("operator_id") operatorId?: string
  ) {
    this.auth(req);
    return { data: await this.ops.listAlerts({ resolution_status: resolutionStatus, operator_id: operatorId }), next_cursor: null };
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Post("ops/v1/alerts/:alertId/acknowledge")
  @HttpCode(HttpStatus.OK)
  async acknowledgeAlert(
    @Req() req: Request,
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.acknowledgeAlert(alertId, body, actor));
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Post("ops/v1/alerts/:alertId/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveAlert(
    @Req() req: Request,
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.resolveAlert(alertId, body, actor));
  }

  @ApiTags("Audit")
  @ApiBearerAuth()
  @Get("ops/v1/audit")
  async listAudit(@Req() req: Request) {
    this.auth(req);
    return { data: await this.ops.listAudit(), next_cursor: null };
  }
}
