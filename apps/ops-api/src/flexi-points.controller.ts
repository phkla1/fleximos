import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { FlexiPointsService } from "./flexi-points.service.js";
import { OpsService } from "./ops.service.js";

@ApiTags("Flexi Points")
@Controller()
export class FlexiPointsController {
  constructor(
    @Inject(FlexiPointsService) private readonly points: FlexiPointsService,
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
  @Get("ops/v1/flexi-points/me")
  @ApiOperation({ summary: "Signed-in rider's own Flexi Points progress (balance, today, this week, milestones)" })
  async me(@Req() req: Request) {
    const actor = await this.auth(req);
    return this.points.summaryForActor(actor);
  }

  @ApiBearerAuth()
  @Get("ops/v1/flexi-points/summary")
  @ApiOperation({ summary: "A rider's Flexi Points ledger and standing (supervisor/HR)" })
  async summary(@Req() req: Request, @Query("operator_id") operatorId?: string) {
    const actor = await this.auth(req);
    this.identity.requireSupervisor(actor);
    if (!operatorId) throw new UnauthorizedException("operator_id is required.");
    return this.points.summaryById(operatorId, this.identity.dataScope(actor));
  }

  @ApiBearerAuth()
  @Get("ops/v1/flexi-points/config")
  @ApiOperation({ summary: "Current Flexi Points programme configuration" })
  async config(@Req() req: Request) {
    await this.auth(req);
    return this.points.config();
  }

  @ApiBearerAuth()
  @Post("ops/v1/flexi-points/config")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update the Flexi Points programme configuration (system admin only)" })
  async updateConfig(
    @Req() req: Request,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const actor = await this.auth(req);
    this.identity.requireSystemAdmin(actor);
    return this.mutate(this.key(rawKey), HttpStatus.OK, () => this.points.updateConfig(body, actor.person_id));
  }
}
