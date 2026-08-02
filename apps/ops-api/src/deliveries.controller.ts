import {
  Body,
  Controller,
  Get,
  Headers,
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
import { DeliveriesService } from "./deliveries.service.js";
import { OpsService } from "./ops.service.js";

@Controller()
export class DeliveriesController {
  constructor(
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
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

  // Contract prices are finance/manager-facing (spec v0.2): strip them for
  // actors without business oversight (supervisors still see allocated).
  private canSeeContract(actor: any) {
    try {
      this.identity.requireBusinessOversight(actor);
      return true;
    } catch {
      return false;
    }
  }

  private async mutate(key: string, status: number, factory: () => Promise<any>) {
    const cached = await this.ops.cached(key);
    if (cached) return cached.body;
    const body = await factory();
    await this.ops.remember(key, status, body);
    return body;
  }

  /* ---------- customers + allocated price (admin-defined, like platforms) ---------- */

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-customers")
  async listCustomers(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    const customers = await this.deliveries.listCustomers();
    return {
      data: this.canSeeContract(actor) ? customers : customers.map(({ contract_price_ngn, ...row }: any) => row),
      next_cursor: null
    };
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Define a prescheduled-delivery customer with its contract price" })
  @Post("ops/v1/delivery-customers")
  async createCustomer(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.deliveries.createCustomer(body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Patch("ops/v1/delivery-customers/:customerId")
  async updateCustomer(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("customerId") customerId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.deliveries.updateCustomer(customerId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-allocated-prices")
  async listAllocatedPrices(@Req() req: Request) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return { data: await this.deliveries.listAllocatedPrices(), next_cursor: null };
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set the global allocated price per delivered package (effective-dated)" })
  @Post("ops/v1/delivery-allocated-prices")
  async createAllocatedPrice(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.deliveries.createAllocatedPrice(body, actor.person_id));
  }

  /* ---------- batches ---------- */

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-batches")
  async listBatches(
    @Req() req: Request,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("record_date") recordDate?: string,
    @Query("customer_id") customerId?: string,
    @Query("status") status?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    const rows = await this.deliveries.listBatches(
      { date_from: dateFrom, date_to: dateTo, record_date: recordDate, customer_id: customerId, status },
      this.identity.dataScope(actor)
    );
    const showContract = this.canSeeContract(actor);
    return {
      data: showContract ? rows : rows.map(({ contract_price_ngn, delivered_value_contract_ngn, ...row }: any) => row),
      next_cursor: null
    };
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Post("ops/v1/delivery-batches")
  async createBatch(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () =>
      this.deliveries.createBatch(body, actor.person_id, this.identity.dataScope(actor)));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Patch("ops/v1/delivery-batches/:batchId/counts")
  async updateCounts(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("batchId") batchId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.deliveries.updateBatchCounts(batchId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Post("ops/v1/delivery-batches/:batchId/close")
  async closeBatch(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("batchId") batchId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.deliveries.closeBatch(batchId, body, actor.person_id));
  }

  /* ---------- assignments ---------- */

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Post("ops/v1/delivery-batches/:batchId/assignments")
  async assignOperator(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("batchId") batchId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.deliveries.assignOperator(batchId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a driver's delivery progress (supervisor entry where no customer API exists)" })
  @Patch("ops/v1/delivery-assignments/:assignmentId")
  async updateAssignment(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("assignmentId") assignmentId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.deliveries.updateAssignment(assignmentId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-assignments")
  async listAssignments(
    @Req() req: Request,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("operator_id") operatorId?: string
  ) {
    const actor = await this.auth(req);
    return {
      data: await this.deliveries.listAssignments(
        { date_from: dateFrom, date_to: dateTo, operator_id: operatorId },
        this.identity.dataScope(actor)
      ),
      next_cursor: null
    };
  }

  /* ---------- exceptions + summary ---------- */

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Post("ops/v1/delivery-batches/:batchId/exceptions")
  async createException(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("batchId") batchId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.CREATED, () => this.deliveries.createException(batchId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Post("ops/v1/delivery-exceptions/:exceptionId/resolve")
  async resolveException(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Param("exceptionId") exceptionId: string,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.deliveries.resolveException(exceptionId, body, actor.person_id));
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-exceptions")
  async listExceptions(
    @Req() req: Request,
    @Query("batch_id") batchId?: string,
    @Query("status") status?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return {
      data: await this.deliveries.listExceptions({ batch_id: batchId, status }, this.identity.dataScope(actor)),
      next_cursor: null
    };
  }

  @ApiTags("Deliveries")
  @ApiBearerAuth()
  @Get("ops/v1/delivery-summary")
  async deliverySummary(
    @Req() req: Request,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    const summary: any = await this.deliveries.deliverySummary({ date_from: dateFrom, date_to: dateTo }, this.identity.dataScope(actor));
    if (!this.canSeeContract(actor)) {
      delete summary.delivered_value_contract_ngn;
      delete summary.margin_ngn;
    }
    return summary;
  }
}
