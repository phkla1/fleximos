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
import { AuthService } from "./auth.service.js";
import { OpsService } from "./ops.service.js";

@Controller()
export class OpsController {
  constructor(
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(AuthService) private readonly identity: AuthService
  ) {}

  private auth(req: Request) {
    return this.identity.authenticate(req);
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
        revenue_pace_profiles: "/ops/v1/revenue-pace-profiles",
        economics_policies: "/ops/v1/economics-policies",
        vehicle_efficiency_policies: "/ops/v1/vehicle-efficiency-policies",
        fuel_issues: "/ops/v1/fuel-issues",
        mileage_reconciliations: "/ops/v1/mileage-reconciliations",
        cash_status: "/ops/v1/cash/status",
        cash_transactions: "/ops/v1/cash/transactions",
        cash_adjustments: "/ops/v1/cash/adjustments",
        daily_closeouts: "/ops/v1/daily-closeouts",
        ingestion_runs: "/ops/v1/ingestion-runs",
        daily_performance: "/ops/v1/daily-performance",
        team_board: "/ops/v1/team-board",
        daily_reports: "/ops/v1/daily-reports",
        scheduled_jobs: "/ops/v1/scheduled-jobs",
        alerts: "/ops/v1/alerts",
        audit: "/ops/v1/audit"
      }
    };
  }

  @Get("health")
  health() {
    return this.ops.serviceHealth();
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Get("ops/v1/operators")
  async listOperators(@Req() req: Request, @Query("status") status?: string, @Query("amoeba_id") amoebaId?: string) {
    const actor = await this.auth(req);
    return { data: await this.ops.listOperators({ status, amoeba_id: amoebaId }, this.identity.dataScope(actor)), next_cursor: null };
  }

  @ApiTags("Operators")
  @ApiBearerAuth()
  @Get("ops/v1/operators/:operatorId")
  async getOperator(@Req() req: Request, @Param("operatorId") operatorId: string) {
    const actor = await this.auth(req);
    return this.ops.getOperator(operatorId, this.identity.dataScope(actor));
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
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
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
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.updateOperator(operatorId, body));
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Patch("ops/v1/operators/:operatorId/monnify-account")
  async assignMonnifyAccount(
    @Req() req: Request,
    @Param("operatorId") operatorId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireService(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.assignMonnifyAccount(operatorId, body));
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Get("ops/v1/operators/:operatorId/cash")
  async operatorCashPosition(@Req() req: Request, @Param("operatorId") operatorId: string) {
    const actor = await this.auth(req);
    return this.ops.operatorCashPosition(operatorId, this.identity.dataScope(actor));
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Get("ops/v1/cash/status")
  async cashStatus(
    @Req() req: Request,
    @Query("record_date") recordDate?: string,
    @Query("operator_id") operatorId?: string,
    @Query("amoeba_id") amoebaId?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return {
      data: await this.ops.cashStatus(
        { record_date: recordDate, operator_id: operatorId, amoeba_id: amoebaId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Get("ops/v1/cash/transactions")
  async listCashTransactions(
    @Req() req: Request,
    @Query("operator_id") operatorId?: string,
    @Query("date") date?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.ops.listCashTransactions(
        { operator_id: operatorId, date },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Get("ops/v1/cash/adjustments")
  async listCashAdjustments(
    @Req() req: Request,
    @Query("operator_id") operatorId?: string,
    @Query("adjustment_date") adjustmentDate?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return {
      data: await this.ops.listCashAdjustments(
        { operator_id: operatorId, adjustment_date: adjustmentDate },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Post("ops/v1/cash/adjustments")
  async createCashAdjustment(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireFinanceMutation(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () =>
      this.ops.createCashAdjustment(body, actor.person_id, this.identity.dataScope(actor))
    );
  }

  @ApiTags("Closeouts")
  @ApiBearerAuth()
  @Get("ops/v1/daily-closeouts")
  async listDailyCloseouts(@Req() req: Request, @Query("record_date") recordDate?: string, @Query("amoeba_id") amoebaId?: string) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return {
      data: await this.ops.listDailyCloseouts(
        { record_date: recordDate, amoeba_id: amoebaId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Closeouts")
  @ApiBearerAuth()
  @Post("ops/v1/daily-closeouts")
  async createDailyCloseout(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createDailyCloseout(body, actor.person_id, this.identity.dataScope(actor)));
  }

  @ApiTags("Cash")
  @ApiBearerAuth()
  @Post("ops/v1/cash/transactions")
  async createCashTransaction(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireService(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createCashTransaction(body));
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
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.registerPlatform(operatorId, body));
  }

  @ApiTags("Vehicles")
  @ApiBearerAuth()
  @Get("ops/v1/vehicles")
  async listVehicles(@Req() req: Request) {
    const actor = await this.auth(req);
    return { data: await this.ops.listVehicles(this.identity.dataScope(actor)), next_cursor: null };
  }

  @ApiTags("Vehicles")
  @ApiBearerAuth()
  @Post("ops/v1/vehicles")
  async createVehicle(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createVehicle(body));
  }

  @ApiTags("Vehicles")
  @ApiBearerAuth()
  @Patch("ops/v1/vehicles/:vehicleId")
  async updateVehicle(
    @Req() req: Request,
    @Param("vehicleId") vehicleId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.updateVehicle(vehicleId, body));
  }

  @ApiTags("Platform Accounts")
  @ApiBearerAuth()
  @Get("ops/v1/platform-accounts")
  async listPlatformAccounts(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
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
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createPlatformAccount(body));
  }

  @ApiTags("Performance")
  @ApiBearerAuth()
  @Get("ops/v1/revenue-pace-profiles")
  async listRevenuePaceProfiles(@Req() req: Request) {
    await this.auth(req);
    return { data: await this.ops.listRevenuePaceProfiles(), next_cursor: null };
  }

  @ApiTags("Performance")
  @ApiBearerAuth()
  @Post("ops/v1/revenue-pace-profiles")
  async createRevenuePaceProfile(@Req() req: Request, @Headers("idempotency-key") rawKey: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createRevenuePaceProfile(body, actor.person_id));
  }

  @ApiTags("Performance")
  @ApiBearerAuth()
  @Patch("ops/v1/revenue-pace-profiles/:profileId")
  async updateRevenuePaceProfile(@Req() req: Request, @Param("profileId") profileId: string, @Headers("idempotency-key") rawKey: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.updateRevenuePaceProfile(profileId, body, actor.person_id));
  }

  @ApiTags("Performance")
  @ApiBearerAuth()
  @Get("ops/v1/economics-policies")
  async listEconomicsPolicies(@Req() req: Request) {
    await this.auth(req);
    return { data: await this.ops.listEconomicsPolicies(), next_cursor: null };
  }

  @ApiTags("Performance")
  @ApiBearerAuth()
  @Post("ops/v1/economics-policies")
  async createEconomicsPolicy(@Req() req: Request, @Headers("idempotency-key") rawKey: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createEconomicsPolicy(body, actor.person_id));
  }

  @ApiTags("Fuel and Mileage")
  @ApiBearerAuth()
  @Get("ops/v1/vehicle-efficiency-policies")
  async listEfficiencyPolicies(@Req() req: Request) {
    await this.auth(req);
    return { data: await this.ops.listEfficiencyPolicies(), next_cursor: null };
  }

  @ApiTags("Fuel and Mileage")
  @ApiBearerAuth()
  @Post("ops/v1/vehicle-efficiency-policies")
  async createEfficiencyPolicy(@Req() req: Request, @Headers("idempotency-key") rawKey: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createEfficiencyPolicy(body, actor.person_id));
  }

  @ApiTags("Fuel and Mileage")
  @ApiBearerAuth()
  @Get("ops/v1/fuel-issues")
  async listFuelIssues(@Req() req: Request, @Query("operating_date") operatingDate?: string, @Query("operator_id") operatorId?: string) {
    const actor = await this.auth(req);
    return {
      data: await this.ops.listFuelIssues(
        { operating_date: operatingDate, operator_id: operatorId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Fuel and Mileage")
  @ApiBearerAuth()
  @Post("ops/v1/fuel-issues")
  async createFuelIssue(@Req() req: Request, @Headers("idempotency-key") rawKey: string | undefined, @Body() body: Record<string, unknown>) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    await this.ops.getOperator(String(body.operator_id || ""), this.identity.dataScope(actor));
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.createFuelIssue(body, actor.person_id));
  }

  @ApiTags("Fuel and Mileage")
  @ApiBearerAuth()
  @Get("ops/v1/mileage-reconciliations")
  async mileageReconciliations(@Req() req: Request, @Query("record_date") recordDate?: string) {
    const actor = await this.auth(req);
    return {
      record_date: recordDate || this.ops.lagosDate(),
      data: await this.ops.mileageReconciliations(recordDate, this.identity.dataScope(actor))
    };
  }

  @ApiTags("Ingestion")
  @ApiBearerAuth()
  @Get("ops/v1/ingestion-runs")
  async listIngestionRuns(@Req() req: Request, @Query("record_date") recordDate?: string) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return { data: await this.ops.listIngestionRuns(recordDate), next_cursor: null };
  }

  @ApiTags("Ingestion")
  @ApiBearerAuth()
  @Post("ops/v1/ingestion-runs")
  async ingestDailyRecords(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.ingestDailyRecords(body, actor.person_id));
  }

  @ApiTags("Reporting")
  @ApiBearerAuth()
  @Get("ops/v1/daily-performance")
  async listDailyPerformance(
    @Req() req: Request,
    @Query("record_date") recordDate?: string,
    @Query("operator_id") operatorId?: string,
    @Query("amoeba_id") amoebaId?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.ops.listDailyPerformance(
        { record_date: recordDate, operator_id: operatorId, amoeba_id: amoebaId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Reporting")
  @ApiBearerAuth()
  @Get("ops/v1/team-board")
  async teamBoard(@Req() req: Request, @Query("record_date") recordDate?: string, @Query("amoeba_id") amoebaId?: string) {
    const actor = await this.auth(req);
    return {
      record_date: recordDate || this.ops.lagosDate(),
      data: await this.ops.teamBoard(
        { record_date: recordDate, amoeba_id: amoebaId },
        this.identity.dataScope(actor)
      )
    };
  }

  @ApiTags("Reporting")
  @ApiBearerAuth()
  @Get("ops/v1/daily-reports")
  async listDailyReports(@Req() req: Request, @Query("record_date") recordDate?: string, @Query("amoeba_id") amoebaId?: string) {
    const actor = await this.auth(req);
    return {
      data: await this.ops.listDailyReports(
        { record_date: recordDate, amoeba_id: amoebaId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Reporting")
  @ApiBearerAuth()
  @Get("ops/v1/daily-reports/:reportId")
  async getDailyReport(@Req() req: Request, @Param("reportId") reportId: string) {
    const actor = await this.auth(req);
    return this.ops.getDailyReport(reportId, this.identity.dataScope(actor));
  }

  @ApiTags("Reporting")
  @ApiBearerAuth()
  @Post("ops/v1/daily-reports")
  async generateDailyReport(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    if (actor.roles.includes("supervisor") && body.amoeba_id) {
      const scopedOperators = await this.ops.listOperators({ amoeba_id: String(body.amoeba_id) }, this.identity.dataScope(actor));
      if (!scopedOperators.length) throw new UnauthorizedException("Amoeba is outside your Ops scope.");
    }
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.generateDailyReport(body, actor.person_id));
  }

  @ApiTags("Data Health")
  @ApiBearerAuth()
  @Get("ops/v1/scheduled-jobs")
  async scheduledJobs(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return { data: await this.ops.scheduledJobHealth(), next_cursor: null };
  }

  @ApiTags("Data Health")
  @ApiBearerAuth()
  @Get("ops/v1/scheduled-job-runs")
  async scheduledJobRuns(@Req() req: Request, @Query("job_name") jobName?: string) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return { data: await this.ops.listScheduledJobRuns(jobName), next_cursor: null };
  }

  @ApiTags("Data Health")
  @ApiBearerAuth()
  @Get("ops/v1/notification-deliveries")
  async notificationDeliveries(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return { data: await this.ops.listNotificationDeliveries(), next_cursor: null };
  }

  @ApiTags("Data Health")
  @ApiBearerAuth()
  @Post("ops/v1/scheduled-jobs/:jobName/runs")
  async enqueueScheduledJob(
    @Req() req: Request,
    @Param("jobName") jobName: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.ops.enqueueScheduledJob(jobName, body, actor.person_id));
  }

  @ApiTags("Data Health")
  @ApiBearerAuth()
  @Post("ops/v1/scheduled-job-runs/:runId/complete")
  async completeScheduledJobRun(
    @Req() req: Request,
    @Param("runId") runId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.completeScheduledJobRun(runId, body, actor.person_id));
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Get("ops/v1/alerts")
  async listAlerts(
    @Req() req: Request,
    @Query("resolution_status") resolutionStatus?: string,
    @Query("operator_id") operatorId?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.ops.listAlerts(
        { resolution_status: resolutionStatus, operator_id: operatorId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
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
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    const visible = await this.ops.listAlerts({}, this.identity.dataScope(actor));
    if (!visible.some((alert: any) => alert.alert_id === alertId)) throw new UnauthorizedException("Alert is outside your Ops scope.");
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.acknowledgeAlert(alertId, body, actor.person_id));
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
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    const visible = await this.ops.listAlerts({}, this.identity.dataScope(actor));
    if (!visible.some((alert: any) => alert.alert_id === alertId)) throw new UnauthorizedException("Alert is outside your Ops scope.");
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.ops.resolveAlert(alertId, body, actor.person_id));
  }

  @ApiTags("Audit")
  @ApiBearerAuth()
  @Get("ops/v1/audit")
  async listAudit(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return { data: await this.ops.listAudit(), next_cursor: null };
  }
}
