import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { parseWorkbook, parseDelimited } from "./xlsx-lite.js";

// Batch importers for go-live roster migration: operators (person → user →
// operator, with ramp maturity from start_date) and vehicles (plate/VIN, optional
// amoeba + operator link). Both run as a dry-run report first (per-row
// create/skip/error, nothing written) and then commit the same parse. ops-api
// orchestrates the foundation person/user creation server-side with its service
// token, so one upload lands across both services. Idempotent: re-running a
// partially-applied sheet skips rows that already exist.

type Body = Record<string, unknown>;
type Verdict = "create" | "skip" | "error";
type RowReport = {
  row: number;
  status: Verdict;
  reason?: string;
  // populated on a committed create
  person_id?: string;
  operator_id?: string;
  vehicle_id?: string;
  initial_pin?: string;
  label?: string;
};
type ImportReport = {
  dry_run: boolean;
  summary: { total: number; create: number; skip: number; error: number };
  rows: RowReport[];
};

@Injectable()
export class BatchImportService {
  private readonly foundationBase = process.env.FOUNDATION_API_BASE || "http://127.0.0.1:4010";
  private readonly serviceToken = process.env.FLEXI_SERVICE_TOKEN || "flexi-dev-service-token";

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService
  ) {}

  /* ------------------------------ sheet reading ------------------------------ */

  // Decode an uploaded sheet into a raw string grid. Accepts an .xlsx
  // (file_base64, detected by the ZIP magic bytes), a CSV/TSV (file_base64 or
  // file_text), or pre-parsed rows (array of objects — used by tests).
  private readGrid(body: Body): { header: string[]; rows: string[][] } | { records: Body[] } {
    if (Array.isArray(body.rows)) return { records: body.rows as Body[] };
    let grid: string[][] | null = null;
    if (typeof body.file_text === "string" && body.file_text.length) {
      grid = parseDelimited(body.file_text);
    } else if (body.file_base64 !== undefined) {
      const buffer = Buffer.from(String(body.file_base64), "base64");
      const isXlsx = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
      try {
        grid = isXlsx ? parseWorkbook(buffer) : parseDelimited(buffer.toString("utf8"));
      } catch (error: any) {
        throw new BadRequestException(`Could not read the file: ${String(error?.message).slice(0, 160)}`);
      }
    }
    if (!grid) throw new BadRequestException("Provide a sheet (file_base64 or file_text) or rows.");
    grid = grid.filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
    if (grid.length < 1) throw new BadRequestException("The sheet is empty.");
    return { header: grid[0].map((h) => String(h ?? "")), rows: grid.slice(1) };
  }

  private norm(value: string): string {
    return String(value || "").toLowerCase().replace(/[\s_]+/g, " ").trim();
  }

  // Map a header row to canonical field names via a spec of accepted substrings,
  // then turn each data row into a { _row, <field>: value } record. Tolerant to
  // wording/casing, like the Speedaf parser.
  private toRecords(header: string[], rows: string[][], spec: Record<string, string[]>): Body[] {
    const fieldByColumn = header.map((h) => {
      const n = this.norm(h);
      for (const [field, needles] of Object.entries(spec)) {
        if (needles.some((needle) => n === needle || n.includes(needle))) return field;
      }
      return null;
    });
    const records: Body[] = [];
    rows.forEach((cells, index) => {
      const record: Body = { _row: index + 2 }; // +2: 1-based, past the header
      fieldByColumn.forEach((field, col) => {
        if (field && cells[col] !== undefined) {
          const value = String(cells[col]).trim();
          if (value !== "") record[field] = value;
        }
      });
      records.push(record);
    });
    return records;
  }

  /* --------------------------- foundation helpers --------------------------- */

  private async foundationGet(path: string): Promise<any[]> {
    const response = await fetch(`${this.foundationBase}${path}`, {
      headers: { Authorization: `Bearer ${this.serviceToken}` }
    });
    if (!response.ok) throw new BadRequestException(`Could not reach the identity service (${path} → ${response.status}).`);
    const body: any = await response.json();
    return body.data || body || [];
  }

  private async foundationPost(path: string, idemKey: string, payload: Body): Promise<any> {
    const response = await fetch(`${this.foundationBase}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idemKey
      },
      body: JSON.stringify(payload)
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.message || body?.error || `status ${response.status}`;
      throw new Error(String(detail));
    }
    return body;
  }

  private idemKey(scope: string): string {
    return `import-${scope}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  // name → id for amoebas and sites (both live in foundation). Case-insensitive
  // on the display name; an id passed straight through also resolves.
  private async resolveMaps() {
    const [amoebas, sites] = await Promise.all([
      this.foundationGet("/amoeba/v1/amoebas"),
      this.foundationGet("/amoeba/v1/sites")
    ]);
    const amoebaByName = new Map<string, string>();
    const amoebaIds = new Set<string>();
    for (const a of amoebas) {
      amoebaIds.add(a.amoeba_id);
      if (a.name) amoebaByName.set(this.norm(a.name), a.amoeba_id);
      amoebaByName.set(this.norm(a.amoeba_id), a.amoeba_id);
    }
    const siteByName = new Map<string, string>();
    const siteIds = new Set<string>();
    for (const s of sites) {
      siteIds.add(s.site_id);
      if (s.name) siteByName.set(this.norm(s.name), s.site_id);
      siteByName.set(this.norm(s.site_id), s.site_id);
    }
    return { amoebaByName, amoebaIds, siteByName, siteIds };
  }

  /* ------------------------------- operators -------------------------------- */

  private static readonly OPERATOR_SPEC: Record<string, string[]> = {
    display_name: ["full name", "name", "display name", "legal name", "operator name", "rider name"],
    phone: ["phone", "msisdn", "mobile", "phone number", "contact"],
    nin: ["nin", "national id"],
    email: ["email", "e mail"],
    operator_type: ["operator type", "type", "role"],
    amoeba: ["amoeba", "team"],
    site: ["site", "location", "accommodation"],
    operator_class: ["operator class", "class", "pay class"],
    start_date: ["start date", "employment date", "hire date", "joined", "date joined", "ramp start"],
    daily_revenue_target_ngn: ["target", "daily target", "revenue target"],
    vehicle_plate: ["vehicle plate", "plate", "bike plate", "assigned vehicle"],
    status: ["status", "operator status"]
  };

  async importOperators(body: Body, actorPersonId: string): Promise<ImportReport> {
    const dryRun = body.dry_run !== false; // default to a dry-run unless explicitly committed
    const parsed = this.readGrid(body);
    const records = "records" in parsed
      ? parsed.records.map((r, i) => ({ _row: i + 2, ...r }))
      : this.toRecords(parsed.header, parsed.rows, BatchImportService.OPERATOR_SPEC);

    const { amoebaByName, siteByName } = await this.resolveMaps();
    const people = await this.foundationGet("/identity/v1/people");
    const users = await this.foundationGet("/identity/v1/users");
    const existingOperators = await this.db.many<any>("SELECT operator_id, person_id, vehicle_id FROM ops_operators");
    const operatorByPerson = new Map(existingOperators.map((o) => [o.person_id, o]));
    const vehicles = await this.ops.listVehicles({ unrestricted: true });
    const vehicleByPlate = new Map(vehicles.map((v: any) => [this.norm(v.plate), v]));

    const findPerson = (phone?: string, nin?: string) =>
      people.find((p: any) => (phone && p.phone === phone) || (nin && p.nin && String(p.nin) === String(nin)));

    const rows: RowReport[] = [];
    for (const rec of records) {
      const rowNo = Number(rec._row);
      const label = String(rec.display_name || rec.phone || "—");
      const fail = (reason: string) => rows.push({ row: rowNo, status: "error" as Verdict, reason, label });

      const displayName = String(rec.display_name || "").trim();
      if (!displayName) { fail("missing name"); continue; }
      const phone = rec.phone ? String(rec.phone).trim() : undefined;
      const nin = rec.nin ? String(rec.nin).trim() : undefined;
      if (nin && !/^\d{11}$/.test(nin)) { fail("NIN must be 11 digits"); continue; }
      const email = rec.email ? String(rec.email).trim() : undefined;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail("invalid email"); continue; }
      const operatorType = String(rec.operator_type || "rider").trim().toLowerCase();
      if (!rec.amoeba) { fail("missing amoeba"); continue; }
      const amoebaId = amoebaByName.get(this.norm(String(rec.amoeba)));
      if (!amoebaId) { fail(`unknown amoeba '${rec.amoeba}'`); continue; }
      if (!rec.site) { fail("missing site"); continue; }
      const siteId = siteByName.get(this.norm(String(rec.site)));
      if (!siteId) { fail(`unknown site '${rec.site}'`); continue; }
      const startDate = rec.start_date ? String(rec.start_date).trim() : undefined;
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { fail("start_date must be YYYY-MM-DD"); continue; }

      let vehicleId: string | undefined;
      if (rec.vehicle_plate) {
        const vehicle = vehicleByPlate.get(this.norm(String(rec.vehicle_plate)));
        if (!vehicle) { fail(`unknown vehicle plate '${rec.vehicle_plate}'`); continue; }
        vehicleId = vehicle.vehicle_id;
      }

      const existingPerson = findPerson(phone, nin);
      if (existingPerson && operatorByPerson.has(existingPerson.person_id)) {
        rows.push({ row: rowNo, status: "skip", reason: "person already has an operator record", label, person_id: existingPerson.person_id });
        continue;
      }

      if (dryRun) {
        rows.push({ row: rowNo, status: "create", reason: existingPerson ? "existing person — will attach operator" : undefined, label });
        continue;
      }

      // ---- commit ----
      try {
        let personId = existingPerson?.person_id;
        if (!personId) {
          const person = await this.foundationPost("/identity/v1/people", this.idemKey("person"), {
            display_name: displayName, legal_name: displayName, phone, email, nin, global_status: "active"
          });
          personId = person.person_id;
          people.push(person);
        }
        let initialPin: string | undefined;
        const hasUser = users.some((u: any) => u.person_id === personId && u.status === "active");
        if (!hasUser) {
          const user = await this.foundationPost("/identity/v1/users", this.idemKey("user"), {
            person_id: personId, roles: ["operator"], status: "active"
          });
          initialPin = user.initial_pin;
          users.push(user);
        }
        const operator: any = await this.ops.createOperator({
          person_id: personId,
          operator_type: operatorType,
          operator_class: rec.operator_class ? String(rec.operator_class).toLowerCase() : undefined,
          operator_status: rec.status ? String(rec.status).toLowerCase() : "active",
          amoeba_id: amoebaId,
          site_id: siteId,
          vehicle_id: vehicleId || null,
          daily_revenue_target_ngn: rec.daily_revenue_target_ngn ? Number(rec.daily_revenue_target_ngn) : null
        });
        operatorByPerson.set(personId, operator);

        // Ramp maturity: anchor a (backdated) cohort to start_date. If the date is
        // older than the ramp window, the ramp engine simply reports no ramp and
        // the operator is judged against the veteran target — no branch needed.
        if (startDate) {
          const cohort: any = await this.onboarding.createCohort(
            { start_date: startDate, operator_class: operator.operator_class, amoeba_id: amoebaId },
            actorPersonId
          );
          await this.onboarding.addCohortMembers(cohort.cohort_id, [operator.operator_id], actorPersonId);
        }

        rows.push({
          row: rowNo, status: "create", label,
          person_id: personId, operator_id: operator.operator_id, initial_pin: initialPin
        });
      } catch (error: any) {
        rows.push({ row: rowNo, status: "error", reason: String(error?.message || error).slice(0, 200), label });
      }
    }

    return this.report(dryRun, rows);
  }

  /* -------------------------------- vehicles -------------------------------- */

  private static readonly VEHICLE_SPEC: Record<string, string[]> = {
    plate: ["plate", "plate number", "reg", "registration"],
    vehicle_type: ["vehicle type", "type"],
    make_model: ["make model", "make", "model"],
    color: ["color", "colour"],
    powertrain: ["powertrain", "fuel", "drive", "engine"],
    tracker_provider: ["tracker provider", "tracker", "provider"],
    vin: ["vin", "chassis", "tracker id", "device id", "tracker device"],
    amoeba: ["amoeba", "team"],
    assigned_operator: ["assigned operator", "operator", "rider", "holder", "driver"],
    status: ["status"]
  };

  async importVehicles(body: Body, actorPersonId: string): Promise<ImportReport> {
    const dryRun = body.dry_run !== false;
    const parsed = this.readGrid(body);
    const records = "records" in parsed
      ? parsed.records.map((r, i) => ({ _row: i + 2, ...r }))
      : this.toRecords(parsed.header, parsed.rows, BatchImportService.VEHICLE_SPEC);

    const { amoebaByName } = await this.resolveMaps();
    const vehicles = await this.ops.listVehicles({ unrestricted: true });
    const plateSet = new Set(vehicles.map((v: any) => this.norm(v.plate)));
    const operators = await this.ops.listOperators({}, {});
    const people = await this.foundationGet("/identity/v1/people");

    const resolveOperator = (value: string): any | undefined => {
      const n = this.norm(value);
      const person = people.find((p: any) =>
        p.phone === value || (p.nin && String(p.nin) === value) || this.norm(p.display_name) === n);
      if (person) return operators.find((o: any) => o.person_id === person.person_id);
      return operators.find((o: any) => o.operator_id === value);
    };

    const rows: RowReport[] = [];
    for (const rec of records) {
      const rowNo = Number(rec._row);
      const label = String(rec.plate || "—");
      const fail = (reason: string) => rows.push({ row: rowNo, status: "error" as Verdict, reason, label });

      const plate = String(rec.plate || "").trim();
      if (!plate) { fail("missing plate"); continue; }
      if (!rec.vehicle_type) { fail("missing vehicle_type"); continue; }
      if (plateSet.has(this.norm(plate))) {
        rows.push({ row: rowNo, status: "skip", reason: "plate already exists", label });
        continue;
      }
      let amoebaId: string | null = null;
      if (rec.amoeba) {
        amoebaId = amoebaByName.get(this.norm(String(rec.amoeba))) || null;
        if (!amoebaId) { fail(`unknown amoeba '${rec.amoeba}'`); continue; }
      }
      let operator: any;
      if (rec.assigned_operator) {
        operator = resolveOperator(String(rec.assigned_operator));
        if (!operator) { fail(`unknown operator '${rec.assigned_operator}'`); continue; }
      }

      if (dryRun) {
        rows.push({ row: rowNo, status: "create", reason: amoebaId ? undefined : "warehouse (unassigned)", label });
        continue;
      }

      try {
        const vehicle: any = await this.ops.createVehicle({
          plate,
          vehicle_type: String(rec.vehicle_type).toLowerCase(),
          make_model: rec.make_model || null,
          color: rec.color || null,
          // ice/ev is the stored vocabulary; accept friendly synonyms. A blank
          // value falls through to the provider/make heuristic in createVehicle.
          powertrain: this.powertrainWord(rec.powertrain),
          tracker_provider: rec.tracker_provider || null,
          tracker_device_id: rec.vin || null, // VIN is the tracker identity; no separate column
          amoeba_id: amoebaId,
          status: rec.status ? String(rec.status).toLowerCase() : "active"
        });
        plateSet.add(this.norm(plate));
        // Link via the operator side so the one-active-holder guard applies.
        if (operator) {
          await this.ops.updateOperator(operator.operator_id, { vehicle_id: vehicle.vehicle_id });
        }
        rows.push({ row: rowNo, status: "create", label, vehicle_id: vehicle.vehicle_id });
      } catch (error: any) {
        rows.push({ row: rowNo, status: "error", reason: String(error?.message || error).slice(0, 200), label });
      }
    }

    return this.report(dryRun, rows);
  }

  // Map a human powertrain word to the stored ice/ev vocabulary; undefined lets
  // createVehicle fall back to its provider/make heuristic (e.g. tankvolt → ev).
  private powertrainWord(value: unknown): string | undefined {
    const n = this.norm(String(value || ""));
    if (!n) return undefined;
    if (["ev", "electric", "battery", "bev"].includes(n)) return "ev";
    if (["ice", "petrol", "fuel", "gasoline", "diesel", "combustion"].includes(n)) return "ice";
    return n; // pass through anything else; createVehicle validates
  }

  private report(dryRun: boolean, rows: RowReport[]): ImportReport {
    return {
      dry_run: dryRun,
      summary: {
        total: rows.length,
        create: rows.filter((r) => r.status === "create").length,
        skip: rows.filter((r) => r.status === "skip").length,
        error: rows.filter((r) => r.status === "error").length
      },
      rows
    };
  }
}
