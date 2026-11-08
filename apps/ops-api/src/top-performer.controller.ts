import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { OpsService } from "./ops.service.js";
import { TopPerformerService } from "./top-performer.service.js";

@ApiTags("Top Performer Bonus")
@Controller()
export class TopPerformerController {
  constructor(
    @Inject(TopPerformerService) private readonly bonus: TopPerformerService,
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

  @ApiBearerAuth()
  @Get("ops/v1/top-performer/awards")
  @ApiOperation({ summary: "Daily amoeba top-performer bonus awards (supervisor sees own amoebas; manager/finance all)" })
  async awards(
    @Req() req: Request,
    @Query("record_date") recordDate?: string,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("amoeba_id") amoebaId?: string,
    @Query("operator_id") operatorId?: string
  ) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    return this.bonus.listAwards(
      { record_date: recordDate, date_from: dateFrom, date_to: dateTo, amoeba_id: amoebaId, operator_id: operatorId },
      this.identity.dataScope(actor)
    );
  }

  @ApiBearerAuth()
  @Get("ops/v1/top-performer/settings")
  @ApiOperation({ summary: "Current daily top-performer bonus configuration (amount + floor)" })
  async settings(@Req() req: Request) {
    await this.auth(req);
    return this.bonus.getSettings();
  }

  @ApiBearerAuth()
  @Post("ops/v1/top-performer/settings")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update the top-performer bonus configuration (system admin only)" })
  async updateSettings(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.bonus.updateSettings(body, actor.person_id));
  }

  @ApiBearerAuth()
  @Post("ops/v1/top-performer/awards/recompute")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Recompute the day's amoeba top-performer awards (manager/finance)" })
  async recompute(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    const date = String(body.record_date || this.ops.lagosDate());
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.bonus.settleAwards(date));
  }

  @ApiBearerAuth()
  @Post("ops/v1/top-performer/awards/:awardId/pay")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark a top-performer award as paid (manager/finance)" })
  async pay(
    @Req() req: Request,
    @Param("awardId") awardId: string,
    @Headers("idempotency-key") rawKey: string | undefined
  ) {
    const actor = await this.auth(req);
    this.identity.requireBusinessOversight(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.bonus.markPaid(awardId, actor.person_id));
  }
}
