import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type OpsActor = {
  actor_type: "human" | "service";
  person_id: string;
  roles: string[];
  scopes: string[];
  role_assignments: RoleAssignment[];
};

export type RoleAssignment = {
  role_assignment_id: string;
  person_id: string;
  role: "manager" | "finance" | "supervisor" | "operator";
  scope_type: "company" | "amoeba" | "site" | "team";
  scope_id: string | null;
  status: "active" | "inactive";
  valid_from: string;
  valid_to: string | null;
};

export type OpsDataScope = {
  unrestricted?: boolean;
  person_id?: string;
  supervisor_person_id?: string;
  amoeba_ids?: string[];
  site_ids?: string[];
  supervisor_person_ids?: string[];
};

const systemAdminRoles = new Set(["owner", "admin"]);

@Injectable()
export class AuthService {
  private readonly foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
  private readonly developmentToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

  async authenticate(req: Request): Promise<OpsActor> {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid bearer token.");
    }

    if (authorization === `Bearer ${this.developmentToken}`) {
      return {
        actor_type: "service",
        person_id: "person_system",
        roles: [],
        scopes: ["ops:*"],
        role_assignments: []
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.foundationBase}/identity/v1/me`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(3000)
      });
    } catch {
      throw new ServiceUnavailableException("Identity service is unavailable.");
    }

    if (response.status === 401) throw new UnauthorizedException("Missing or invalid bearer token.");
    if (!response.ok) throw new ServiceUnavailableException("Identity token validation failed.");

    const profile: any = await response.json();
    if (profile.actor_type === "service") {
      const scopes = Array.isArray(profile.scopes) ? profile.scopes : [];
      if (!scopes.some((scope: string) => scope === "ops:*" || scope.startsWith("ops:"))) {
        throw new ForbiddenException("Service account does not have an Ops scope.");
      }
      return {
        actor_type: "service",
        person_id: profile.person_id || "person_system",
        roles: [],
        scopes,
        role_assignments: []
      };
    }

    if (profile.status !== "active") throw new ForbiddenException("User account is not active.");
    return {
      actor_type: "human",
      person_id: profile.person_id,
      roles: Array.isArray(profile.roles) ? profile.roles : [],
      scopes: [],
      role_assignments: Array.isArray(profile.role_assignments) ? profile.role_assignments : []
    };
  }

  isSystemAdmin(actor: OpsActor) {
    return actor.actor_type === "service" || actor.roles.some((role) => systemAdminRoles.has(role));
  }

  hasAssignedRole(actor: OpsActor, role: RoleAssignment["role"]) {
    return actor.role_assignments.some((assignment) => assignment.role === role);
  }

  requireSystemAdmin(actor: OpsActor) {
    if (this.isSystemAdmin(actor)) return;
    throw new ForbiddenException("This action requires a system administrator.");
  }

  requireService(actor: OpsActor) {
    if (actor.actor_type === "service") return;
    throw new ForbiddenException("This endpoint is restricted to an authenticated service account.");
  }

  requireBusinessOversight(actor: OpsActor) {
    if (
      this.isSystemAdmin(actor)
      || this.hasAssignedRole(actor, "manager")
      || this.hasAssignedRole(actor, "finance")
    ) return;
    throw new ForbiddenException("This action requires an assigned Manager or Finance role.");
  }

  requireFinanceMutation(actor: OpsActor) {
    if (this.isSystemAdmin(actor) || this.hasAssignedRole(actor, "finance")) return;
    throw new ForbiddenException("This action requires an assigned Finance role.");
  }

  requireSupervisor(actor: OpsActor) {
    if (
      this.isSystemAdmin(actor)
      || this.hasAssignedRole(actor, "manager")
      || this.hasAssignedRole(actor, "supervisor")
      || actor.roles.includes("supervisor")
    ) return;
    throw new ForbiddenException("This action requires a Supervisor or assigned Manager role.");
  }

  dataScope(actor: OpsActor): OpsDataScope {
    if (this.isSystemAdmin(actor)) return { unrestricted: true };

    const oversightAssignments = actor.role_assignments.filter((assignment) =>
      assignment.role === "manager"
      || assignment.role === "finance"
      || assignment.role === "supervisor"
      || assignment.role === "operator"
    );
    if (oversightAssignments.some((assignment) => assignment.scope_type === "company")) {
      return { unrestricted: true };
    }

    const scope: OpsDataScope = {};
    const amoebaIds = new Set<string>();
    const siteIds = new Set<string>();
    const supervisorPersonIds = new Set<string>();
    for (const assignment of oversightAssignments) {
      if (!assignment.scope_id) continue;
      if (assignment.scope_type === "amoeba") amoebaIds.add(assignment.scope_id);
      if (assignment.scope_type === "site") siteIds.add(assignment.scope_id);
      if (assignment.scope_type === "team") supervisorPersonIds.add(assignment.scope_id);
    }
    if (amoebaIds.size) scope.amoeba_ids = [...amoebaIds];
    if (siteIds.size) scope.site_ids = [...siteIds];
    if (supervisorPersonIds.size) scope.supervisor_person_ids = [...supervisorPersonIds];

    if (Object.keys(scope).length) return scope;
    if (actor.roles.includes("supervisor")) return { supervisor_person_id: actor.person_id };
    if (actor.roles.includes("operator")) return { person_id: actor.person_id };
    throw new ForbiddenException("User does not have an active Ops scope assignment.");
  }
}
