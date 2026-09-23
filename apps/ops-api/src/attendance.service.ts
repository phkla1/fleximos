import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { OpsDataScope } from "./auth.service.js";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";

type RecordBody = Record<string, unknown>;

const EARTH_RADIUS_M = 6_371_000;

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

type ApprovedSite = { site_id: string; amoeba_id: string; name: string; gps_lat: number | null; gps_lng: number | null; alert_radius_m: number };

// Operator daily check-in with GPS geofencing + mandatory supervisor approval
// (resumption discipline, Tunji's attendance register). Approved locations are
// the amoeba's Sites (owned by identity/foundation); we read them there rather
// than duplicate them. Approval is required even when GPS passes because an
// office-resident operator would pass the geofence from their bed.
@Injectable()
export class AttendanceService {
  private readonly foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
  private readonly serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";
  private siteCache: { at: number; sites: ApprovedSite[] } | null = null;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService
  ) {}

  private id(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  }

  private now() {
    return new Date().toISOString();
  }

  private date(value: unknown, field = "check_in_date") {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date.`);
    return text;
  }

  // Approved locations come from the amoeba service; cached 60s and tolerant of
  // an outage (geofence then reports "unknown" and approval still gates).
  private async approvedSites(): Promise<ApprovedSite[]> {
    if (this.siteCache && Date.now() - this.siteCache.at < 60_000) return this.siteCache.sites;
    try {
      const response = await fetch(`${this.foundationBase}/amoeba/v1/sites`, {
        headers: { Authorization: `Bearer ${this.serviceToken}` },
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) throw new Error(`sites ${response.status}`);
      const payload: any = await response.json();
      const sites: ApprovedSite[] = (payload.data || payload || []).map((site: any) => ({
        site_id: site.site_id,
        amoeba_id: site.amoeba_id,
        name: site.name,
        gps_lat: site.gps_lat ?? null,
        gps_lng: site.gps_lng ?? null,
        alert_radius_m: Number(site.alert_radius_m ?? 1000)
      }));
      this.siteCache = { at: Date.now(), sites };
      return sites;
    } catch {
      return this.siteCache?.sites || [];
    }
  }

  private geofence(amoebaId: string, lat: number | null, lng: number | null, sites: ApprovedSite[]) {
    if (lat === null || lng === null) return { matched_site_id: null, matched_site_name: null, distance_m: null, geofence_ok: null };
    let best: { site: ApprovedSite; distance: number } | null = null;
    for (const site of sites) {
      if (site.amoeba_id !== amoebaId || site.gps_lat === null || site.gps_lng === null) continue;
      const distance = haversineMetres(lat, lng, site.gps_lat, site.gps_lng);
      if (!best || distance < best.distance) best = { site, distance };
    }
    if (!best) return { matched_site_id: null, matched_site_name: null, distance_m: null, geofence_ok: null };
    return {
      matched_site_id: best.site.site_id,
      matched_site_name: best.site.name,
      distance_m: Math.round(best.distance * 10) / 10,
      geofence_ok: best.distance <= best.site.alert_radius_m
    };
  }

  private async operatorForPerson(personId: string) {
    return this.db.one<any>(
      "SELECT * FROM ops_operators WHERE person_id=$1 AND operator_status='active'",
      [personId]
    );
  }

  async requestCheckin(body: RecordBody, actorPersonId: string, isSupervisor: boolean) {
    // Self check-in resolves the operator from the token; a supervisor may file
    // one for a named operator (source supervisor_manual).
    let operator: any;
    let source = "operator_self";
    if (body.operator_id) {
      if (!isSupervisor) throw new ForbiddenException("Only a supervisor may check in on behalf of an operator.");
      operator = await this.db.one<any>("SELECT * FROM ops_operators WHERE operator_id=$1", [String(body.operator_id)]);
      source = "supervisor_manual";
    } else {
      operator = await this.operatorForPerson(actorPersonId);
    }
    if (!operator) throw new NotFoundException("No active operator record is linked to this request.");

    const checkInDate = this.date(body.check_in_date || this.ops.lagosDate());
    const lat = body.gps_lat === undefined || body.gps_lat === null ? null : Number(body.gps_lat);
    const lng = body.gps_lng === undefined || body.gps_lng === null ? null : Number(body.gps_lng);
    if ((lat === null) !== (lng === null)) throw new BadRequestException("Provide both gps_lat and gps_lng, or neither.");
    if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng as number) > 180)) throw new BadRequestException("gps_lat/gps_lng are out of range.");

    const fence = this.geofence(operator.amoeba_id, lat, lng, await this.approvedSites());
    const timestamp = this.now();
    const record = {
      checkin_id: this.id("checkin"),
      operator_id: operator.operator_id,
      person_id: operator.person_id,
      amoeba_id: operator.amoeba_id,
      check_in_date: checkInDate,
      requested_at: timestamp,
      gps_lat: lat,
      gps_lng: lng,
      matched_site_id: fence.matched_site_id,
      matched_site_name: fence.matched_site_name,
      distance_m: fence.distance_m,
      geofence_ok: fence.geofence_ok,
      status: "pending",
      decided_by_person_id: null,
      decided_at: null,
      decision_note: null,
      source,
      created_at: timestamp,
      updated_at: timestamp
    };
    // Re-requesting replaces the day's pending row; a decided one is preserved
    // so an approval can't be silently reset by a stray retap.
    await this.db.exec(
      `INSERT INTO ops_operator_checkins
        (checkin_id, operator_id, person_id, amoeba_id, check_in_date, requested_at, gps_lat, gps_lng,
         matched_site_id, matched_site_name, distance_m, geofence_ok, status, decided_by_person_id,
         decided_at, decision_note, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (operator_id, check_in_date) DO UPDATE SET
         requested_at = EXCLUDED.requested_at,
         gps_lat = EXCLUDED.gps_lat, gps_lng = EXCLUDED.gps_lng,
         matched_site_id = EXCLUDED.matched_site_id, matched_site_name = EXCLUDED.matched_site_name,
         distance_m = EXCLUDED.distance_m, geofence_ok = EXCLUDED.geofence_ok,
         source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
       WHERE ops_operator_checkins.status = 'pending'`,
      Object.values(record)
    );
    const saved = await this.db.one<any>(
      "SELECT * FROM ops_operator_checkins WHERE operator_id=$1 AND check_in_date=$2",
      [operator.operator_id, checkInDate]
    );
    await this.ops.audit("operator_checkin.requested", "operator_checkin", saved.checkin_id, null, saved, actorPersonId);
    return saved;
  }

  async listCheckins(filters: { check_in_date?: string; status?: string }, scope: OpsDataScope = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filters.check_in_date) { params.push(this.date(filters.check_in_date)); clauses.push(`ck.check_in_date = $${params.length}`); }
    if (filters.status) { params.push(String(filters.status)); clauses.push(`ck.status = $${params.length}`); }
    if (!scope.unrestricted) {
      if (scope.person_id) {
        params.push(scope.person_id);
        clauses.push(`ck.person_id = $${params.length}`);
      } else if (scope.supervisor_person_id) {
        params.push(scope.supervisor_person_id);
        clauses.push(`o.supervisor_person_id = $${params.length}`);
      } else if (scope.amoeba_ids?.length) {
        const placeholders = scope.amoeba_ids.map((amoebaId) => { params.push(amoebaId); return `$${params.length}`; });
        clauses.push(`ck.amoeba_id IN (${placeholders.join(", ")})`);
      } else {
        clauses.push("FALSE");
      }
    }
    return this.db.many(
      `SELECT ck.*, o.operator_type, o.operator_class, o.site_id
       FROM ops_operator_checkins ck
       JOIN ops_operators o ON o.operator_id = ck.operator_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY ck.check_in_date DESC, ck.requested_at DESC`,
      params
    );
  }

  async decideCheckin(checkinId: string, body: RecordBody, actorPersonId: string) {
    const checkin = await this.db.one<any>("SELECT * FROM ops_operator_checkins WHERE checkin_id=$1", [checkinId]);
    if (!checkin) throw new NotFoundException("Check-in not found.");
    const decision = String(body.decision || "");
    if (!["approve", "reject"].includes(decision)) throw new BadRequestException("decision must be approve or reject.");
    const status = decision === "approve" ? "approved" : "rejected";
    const timestamp = this.now();
    await this.db.exec(
      "UPDATE ops_operator_checkins SET status=$2, decided_by_person_id=$3, decided_at=$4, decision_note=$5, updated_at=$4 WHERE checkin_id=$1",
      [checkinId, status, actorPersonId, timestamp, body.decision_note ? String(body.decision_note) : null]
    );
    await this.ops.audit(`operator_checkin.${status}`, "operator_checkin", checkinId, checkin, { status, decided_by_person_id: actorPersonId }, actorPersonId);
    return { ...checkin, status, decided_by_person_id: actorPersonId, decided_at: timestamp };
  }
}
