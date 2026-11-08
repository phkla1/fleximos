import {
  Body,
  Controller,
  Delete,
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
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { DepthService } from "./depth.service.js";
import { OpsService } from "./ops.service.js";
import { PushService } from "./push.service.js";

@Controller()
export class DepthController {
  constructor(
    @Inject(DepthService) private readonly depth: DepthService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(AuthService) private readonly identity: AuthService,
    @Inject(PushService) private readonly push: PushService
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

  private async requireVisibleAlert(alertId: string, scope: any) {
    const visible = await this.ops.listAlerts({}, scope);
    if (!visible.some((alert: any) => alert.alert_id === alertId)) {
      throw new UnauthorizedException("Alert is outside your Ops scope.");
    }
  }

  // ------------------------------------------------------------ web push (SOS)

  @ApiTags("Push")
  @ApiBearerAuth()
  @Get("ops/v1/push/vapid-public-key")
  @ApiOperation({ summary: "The VAPID public key a browser needs to subscribe to SOS push" })
  async vapidPublicKey(@Req() req: Request) {
    await this.auth(req); // any authenticated person may read it
    return { public_key: this.push.vapidPublicKey(), enabled: this.push.enabled() };
  }

  @ApiTags("Push")
  @ApiBearerAuth()
  @Post("ops/v1/push/subscriptions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Register this device for SOS push (supervisor or operator)" })
  async subscribePush(
    @Req() req: Request,
    @Headers("user-agent") userAgent: string | undefined,
    @Body() body: Record<string, any>
  ) {
    const actor = await this.auth(req);
    // The subscription is keyed by its own endpoint, so re-posting is idempotent
    // without an Idempotency-Key header (the client toggle just POSTs on enable).
    return this.push.saveSubscription(actor.person_id, body?.subscription ?? body, userAgent ?? null);
  }

  @ApiTags("Push")
  @ApiBearerAuth()
  @Delete("ops/v1/push/subscriptions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Stop SOS push on this device" })
  async unsubscribePush(@Req() req: Request, @Body() body: Record<string, any>) {
    const actor = await this.auth(req);
    const endpoint = String(body?.endpoint ?? body?.subscription?.endpoint ?? "");
    return this.push.removeSubscription(actor.person_id, endpoint);
  }

  // ---------------------------------------------------------------- media

  @ApiTags("Media")
  @ApiBearerAuth()
  @Post("ops/v1/media")
  @ApiOperation({ summary: "Register a camera capture with GPS and capture-time validation" })
  async createMedia(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createMedia(body, actor.person_id));
  }

  @ApiTags("Media")
  @ApiBearerAuth()
  @Get("ops/v1/media/:mediaId")
  async getMedia(@Req() req: Request, @Param("mediaId") mediaId: string) {
    await this.auth(req);
    const { storage_path: _path, ...media } = await this.depth.getMedia(mediaId);
    return media;
  }

  @ApiTags("Media")
  @ApiBearerAuth()
  @Get("ops/v1/media/:mediaId/content")
  async mediaContent(@Req() req: Request, @Param("mediaId") mediaId: string, @Res() res: Response) {
    await this.auth(req);
    const { media, bytes } = await this.depth.readMediaContent(mediaId);
    res.setHeader("Content-Type", media.content_type);
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  }

  // ------------------------------------------------------------ documents

  @ApiTags("Documents")
  @ApiBearerAuth()
  @Post("ops/v1/documents")
  @ApiOperation({ summary: "Attach a document (employment file, vehicle paper, fuel receipt) to a record" })
  async createDocument(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createDocument(body, actor));
  }

  @ApiTags("Documents")
  @ApiBearerAuth()
  @Get("ops/v1/documents")
  async listDocuments(
    @Req() req: Request,
    @Query("owner_type") ownerType: string,
    @Query("owner_id") ownerId: string
  ) {
    const actor = await this.auth(req);
    return this.depth.listDocuments(String(ownerType || ""), String(ownerId || ""), actor);
  }

  @ApiTags("Documents")
  @ApiBearerAuth()
  @Get("ops/v1/documents/:linkId/content")
  async documentContent(@Req() req: Request, @Param("linkId") linkId: string, @Res() res: Response) {
    const actor = await this.auth(req);
    const { media, bytes } = await this.depth.readDocumentContent(linkId, actor);
    res.setHeader("Content-Type", media.content_type);
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  }

  @ApiTags("Documents")
  @ApiBearerAuth()
  @Delete("ops/v1/documents/:linkId")
  @HttpCode(HttpStatus.OK)
  async deleteDocument(@Req() req: Request, @Param("linkId") linkId: string) {
    const actor = await this.auth(req);
    return this.depth.deleteDocument(linkId, actor);
  }

  // ------------------------------------------------- deviation workflows

  @ApiTags("Alerts")
  @Get("ops/v1/deviation-reason-codes")
  deviationReasonCodes() {
    return { data: this.depth.deviationReasonCodes() };
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Post("ops/v1/alerts/:alertId/deviation-reason")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Operator submits a structured deviation reason for an alert" })
  async submitDeviationReason(
    @Req() req: Request,
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    await this.requireVisibleAlert(alertId, this.identity.dataScope(actor));
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.submitDeviationReason(alertId, body, actor.person_id));
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Post("ops/v1/alerts/:alertId/deviation-reason/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Supervisor accepts or rejects an operator deviation reason" })
  async reviewDeviationReason(
    @Req() req: Request,
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    await this.requireVisibleAlert(alertId, this.identity.dataScope(actor));
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.reviewDeviationReason(alertId, body, actor.person_id));
  }

  @ApiTags("Alerts")
  @ApiBearerAuth()
  @Post("ops/v1/alerts/:alertId/escalate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Escalate an alert into the manager escalation queue" })
  async escalateAlert(
    @Req() req: Request,
    @Param("alertId") alertId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    await this.requireVisibleAlert(alertId, this.identity.dataScope(actor));
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.escalateAlert(alertId, body, actor.person_id));
  }

  // ------------------------------------------------------------ incidents

  @ApiTags("Incidents")
  @ApiBearerAuth()
  @Get("ops/v1/incidents")
  async listIncidents(
    @Req() req: Request,
    @Query("status") status?: string,
    @Query("operator_id") operatorId?: string,
    @Query("incident_type") incidentType?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.depth.listIncidents(
        { status, operator_id: operatorId, incident_type: incidentType },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Incidents")
  @ApiBearerAuth()
  @Post("ops/v1/incidents")
  @ApiOperation({ summary: "Report a field incident (accident, breakdown, police, fuel, battery)" })
  async createIncident(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    const scope = this.identity.dataScope(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createIncident(body, actor.person_id, scope));
  }

  @ApiTags("Incidents")
  @ApiBearerAuth()
  @Post("ops/v1/incidents/:incidentId/acknowledge")
  @HttpCode(HttpStatus.OK)
  async acknowledgeIncident(
    @Req() req: Request,
    @Param("incidentId") incidentId: string,
    @Headers("idempotency-key") rawKey: string | undefined
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.acknowledgeIncident(incidentId, actor.person_id));
  }

  @ApiTags("Incidents")
  @ApiBearerAuth()
  @Patch("ops/v1/incidents/:incidentId")
  @ApiOperation({ summary: "Set incident ownership, required action, or cost implication" })
  async updateIncidentDetails(
    @Req() req: Request,
    @Param("incidentId") incidentId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.updateIncidentDetails(incidentId, body, actor.person_id));
  }

  @ApiTags("Incidents")
  @ApiBearerAuth()
  @Post("ops/v1/incidents/:incidentId/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveIncident(
    @Req() req: Request,
    @Param("incidentId") incidentId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.resolveIncident(incidentId, body, actor.person_id));
  }

  // ---------------------------------------------------------- inspections

  @ApiTags("Inspections")
  @ApiBearerAuth()
  @Get("ops/v1/inspections")
  async listInspections(
    @Req() req: Request,
    @Query("vehicle_id") vehicleId?: string,
    @Query("review_status") reviewStatus?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.depth.listInspections({ vehicle_id: vehicleId, review_status: reviewStatus }, this.identity.dataScope(actor)),
      next_cursor: null
    };
  }

  @ApiTags("Inspections")
  @ApiBearerAuth()
  @Get("ops/v1/inspections/compliance")
  @ApiOperation({ summary: "48-hour vehicle inspection compliance summary" })
  async inspectionCompliance(@Req() req: Request) {
    const actor = await this.auth(req);
    return this.depth.inspectionCompliance(this.identity.dataScope(actor));
  }

  @ApiTags("Inspections")
  @ApiBearerAuth()
  @Post("ops/v1/inspections")
  @ApiOperation({ summary: "Submit a supervisor vehicle inspection" })
  async createInspection(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createInspection(body, actor.person_id));
  }

  @ApiTags("Inspections")
  @ApiBearerAuth()
  @Post("ops/v1/inspections/:inspectionId/review")
  @HttpCode(HttpStatus.OK)
  async reviewInspection(
    @Req() req: Request,
    @Param("inspectionId") inspectionId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.reviewInspection(inspectionId, body, actor.person_id));
  }

  // ---------------------------------------------------------- maintenance

  @ApiTags("Maintenance")
  @ApiBearerAuth()
  @Get("ops/v1/maintenance-reports")
  async listMaintenanceReports(
    @Req() req: Request,
    @Query("status") status?: string,
    @Query("vehicle_id") vehicleId?: string,
    @Query("operator_id") operatorId?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.depth.listMaintenanceReports(
        { status, vehicle_id: vehicleId, operator_id: operatorId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("Maintenance")
  @ApiBearerAuth()
  @Post("ops/v1/maintenance-reports")
  @ApiOperation({ summary: "Report a vehicle maintenance issue" })
  async createMaintenanceReport(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createMaintenanceReport(body, actor.person_id));
  }

  @ApiTags("Maintenance")
  @ApiBearerAuth()
  @Post("ops/v1/maintenance-reports/:maintenanceId/status")
  @HttpCode(HttpStatus.OK)
  async updateMaintenanceStatus(
    @Req() req: Request,
    @Param("maintenanceId") maintenanceId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.updateMaintenanceStatus(maintenanceId, body, actor.person_id));
  }

  // ------------------------------------------------------------- expenses

  @ApiTags("P&L")
  @ApiBearerAuth()
  @Get("ops/v1/expenses")
  async listExpenses(
    @Req() req: Request,
    @Query("period_start") periodStart?: string,
    @Query("period_end") periodEnd?: string,
    @Query("amoeba_id") amoebaId?: string,
    @Query("category") category?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return {
      data: await this.depth.listExpenses(
        { period_start: periodStart, period_end: periodEnd, amoeba_id: amoebaId, category },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  @ApiTags("P&L")
  @ApiBearerAuth()
  @Post("ops/v1/expenses")
  @ApiOperation({ summary: "Record a direct amoeba expense or a central cost" })
  async createExpense(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createExpense(body, actor.person_id));
  }

  // ------------------------------------------------ transfer price events

  @ApiTags("P&L")
  @ApiBearerAuth()
  @Get("ops/v1/transfer-price-events")
  async listTransferPriceEvents(
    @Req() req: Request,
    @Query("period_start") periodStart?: string,
    @Query("period_end") periodEnd?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return {
      data: await this.depth.listTransferPriceEvents({ period_start: periodStart, period_end: periodEnd }, this.identity.dataScope(actor)),
      next_cursor: null
    };
  }

  @ApiTags("P&L")
  @ApiBearerAuth()
  @Post("ops/v1/transfer-price-events")
  @ApiOperation({ summary: "Accept a TMS transfer-price event as a P&L input" })
  async createTransferPriceEvent(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    if (actor.actor_type !== "service") this.identity.requireBusinessOversight(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.depth.createTransferPriceEvent(body, actor.person_id));
  }

  // ------------------------------------------------------------------ P&L

  @ApiTags("P&L")
  @ApiBearerAuth()
  @Get("ops/v1/pnl")
  @ApiOperation({ summary: "Amoeba P&L with expenses, maintenance, transfer pricing and central-cost allocation" })
  async profitAndLoss(
    @Req() req: Request,
    @Query("period_start") periodStart?: string,
    @Query("period_end") periodEnd?: string,
    @Query("amoeba_id") amoebaId?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return this.depth.profitAndLoss(
      { period_start: periodStart, period_end: periodEnd, amoeba_id: amoebaId },
      this.identity.dataScope(actor)
    );
  }

  // ------------------------------------------------------------ leaderboard

  @ApiTags("Leaderboard")
  @ApiBearerAuth()
  @Get("ops/v1/leaderboard")
  @ApiOperation({ summary: "Sortable operator leaderboard with weighted Performance Score" })
  async leaderboard(
    @Req() req: Request,
    @Query("period_start") periodStart?: string,
    @Query("period_end") periodEnd?: string,
    @Query("amoeba_id") amoebaId?: string,
    @Query("sort") sort?: string
  ) {
    const actor = await this.auth(req);
    const scope = this.identity.dataScope(actor);
    const isOperatorOnly = actor.actor_type === "human"
      && !this.identity.isSystemAdmin(actor)
      && !this.identity.hasAssignedRole(actor, "manager")
      && !this.identity.hasAssignedRole(actor, "finance")
      && !this.identity.hasAssignedRole(actor, "supervisor")
      && !actor.roles.includes("supervisor");
    return this.depth.leaderboard(
      { period_start: periodStart, period_end: periodEnd, amoeba_id: amoebaId, sort },
      scope,
      { hideRevenueComponent: isOperatorOnly }
    );
  }

  @ApiTags("Fleet")
  @ApiBearerAuth()
  @Get("ops/v1/fleet-policy")
  async fleetPolicy(@Req() req: Request) {
    await this.auth(req);
    return this.depth.fleetPolicy();
  }

  @ApiTags("Fleet")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update inspection cadence and preventive service interval (system admin only)" })
  @Post("ops/v1/fleet-policy")
  async updateFleetPolicy(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.updateFleetPolicy(body, actor.person_id));
  }

  @ApiTags("Leaderboard")
  @ApiBearerAuth()
  @Get("ops/v1/leaderboard-config")
  async leaderboardConfig(@Req() req: Request) {
    await this.auth(req);
    return this.depth.leaderboardConfig();
  }

  @ApiTags("Leaderboard")
  @ApiBearerAuth()
  @Post("ops/v1/leaderboard-config")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Adjust Performance Score weights and leaderboard visibility" })
  async updateLeaderboardConfig(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.updateLeaderboardConfig(body, actor.person_id));
  }

  @ApiTags("Leaderboard")
  @ApiBearerAuth()
  @Post("ops/v1/on-demand-confirmations")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Supervisor confirms an operator had no on-demand (ride-hailing) work on a date, clearing the leaderboard's unconfirmed-data flag" })
  async confirmNoOnDemand(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.depth.confirmNoOnDemand(body, actor.person_id));
  }

  // ------------------------------------------------------------ escalations

  @ApiTags("Escalations")
  @ApiBearerAuth()
  @Get("ops/v1/escalations")
  @ApiOperation({ summary: "Manager escalation queue across alerts, incidents, inspections, closeouts and maintenance" })
  async escalations(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return this.depth.escalationQueue(this.identity.dataScope(actor));
  }
}
