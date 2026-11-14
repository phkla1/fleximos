import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { parseWorkbookSheets, parseDelimited } from "./xlsx-lite.js";

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
  hospital_id?: string;
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
  private readGrid(body: Body, spec?: Record<string, string[]>): { header: string[]; rows: string[][]; firstDataRow: number } | { records: Body[] } {
    if (Array.isArray(body.rows)) return { records: body.rows as Body[] };
    let grid: string[][] | null = null;
    if (typeof body.file_text === "string" && body.file_text.length) {
      grid = parseDelimited(body.file_text);
    } else if (body.file_base64 !== undefined) {
      const buffer = Buffer.from(String(body.file_base64), "base64");
      const isXlsx = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
      try {
        grid = isXlsx ? this.pickSheet(parseWorkbookSheets(buffer), spec) : parseDelimited(buffer.toString("utf8"));
      } catch (error: any) {
        throw new BadRequestException(`Could not read the file: ${String(error?.message).slice(0, 160)}`);
      }
    }
    if (!grid) throw new BadRequestException("Provide a sheet (file_base64 or file_text) or rows.");
    grid = grid.filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
    if (grid.length < 1) throw new BadRequestException("The sheet is empty.");
    // Real spreadsheets often carry a title/logo/blank row above the header (and
    // the xlsx template ships with a title row). Find the row that actually looks
    // like the header — the one matching the most known column names — instead of
    // assuming row 1. Falls back to row 1 when nothing matches (e.g. no spec).
    let headerIdx = 0;
    if (spec) {
      let best = 0;
      const scan = Math.min(grid.length, 10);
      for (let i = 0; i < scan; i++) {
        const matches = this.headerMatchCount(grid[i], spec);
        if (matches > best) { best = matches; headerIdx = i; }
      }
    }
    return {
      header: grid[headerIdx].map((h) => String(h ?? "")),
      rows: grid.slice(headerIdx + 1),
      firstDataRow: headerIdx + 2 // 1-based row number of the first data row, for error reporting
    };
  }

  // Choose which worksheet to import from a multi-tab workbook. Excel files often
  // carry a hidden cover/template tab as the first physical sheet while the data
  // the user sees is on a visible named tab. So: ignore hidden tabs (unless there
  // is nothing else), and among the visible ones pick the tab whose rows best
  // match the expected columns, tie-breaking on how much data it has.
  private pickSheet(sheets: Array<{ name: string; grid: string[][]; hidden: boolean }>, spec?: Record<string, string[]>): string[][] {
    const candidates = sheets
      .map((s) => ({ ...s, rows: s.grid.filter((r) => r.some((c) => String(c ?? "").trim() !== "")) }))
      .filter((s) => s.rows.length > 0);
    if (!candidates.length) return [];
    const visible = candidates.filter((s) => !s.hidden);
    const pool = visible.length ? visible : candidates;
    const score = (rows: string[][]) => {
      if (!spec) return 0;
      let best = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i++) best = Math.max(best, this.headerMatchCount(rows[i], spec));
      return best;
    };
    let chosen = pool[0], bestScore = -1, bestRows = -1;
    for (const s of pool) {
      const sc = score(s.rows);
      if (sc > bestScore || (sc === bestScore && s.rows.length > bestRows)) { chosen = s; bestScore = sc; bestRows = s.rows.length; }
    }
    return chosen.grid;
  }

  // How many columns in this row match a known field alias — used to locate the
  // real header row when title/blank rows sit above it.
  private headerMatchCount(row: string[], spec: Record<string, string[]>): number {
    let count = 0;
    for (const cell of row) {
      const n = this.norm(String(cell ?? ""));
      if (!n) continue;
      if (Object.values(spec).some((needles) => needles.some((needle) => n === needle || n.includes(needle)))) count++;
    }
    return count;
  }

  private norm(value: string): string {
    return String(value || "").toLowerCase().replace(/[\s_]+/g, " ").trim();
  }

  // Accept the date shapes staff sheets actually contain and emit YYYY-MM-DD:
  // unpadded ISO (2026-8-28, 2026/9/1), day-first (28/08/2026 — the NG norm), and
  // Excel date serials. Rejects anything that isn't a real calendar date.
  private normalizeDate(raw: string): { date?: string; error?: string } {
    const s = String(raw ?? "").trim();
    if (!s) return {};
    let y: number | undefined, m: number | undefined, d: number | undefined, mt: RegExpMatchArray | null;
    if ((mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
    else if (/^\d{3,6}(\.0+)?$/.test(s)) {
      const serial = Math.round(Number(s)); // Excel serial: days since 1899-12-30
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    } else return { error: `start_date '${raw}' isn't a date (use YYYY-MM-DD)` };
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${y}-${pad(m!)}-${pad(d!)}`;
    const check = new Date(`${iso}T00:00:00Z`);
    if (isNaN(check.getTime()) || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) {
      return { error: `start_date '${raw}' isn't a valid calendar date` };
    }
    return { date: iso };
  }

  // Canonicalise a Nigerian phone to +234XXXXXXXXXX. Tolerant to how staff sheets
  // actually arrive: +234…, 234…, local 0-prefixed (0803…), and — crucially —
  // Excel silently stripping the leading 0 so an 11-digit number arrives as 10
  // (8031234567). NG mobile national numbers are 10 digits starting 7/8/9.
  private normalizePhone(raw: string): { phone?: string; error?: string } {
    const digits = String(raw || "").replace(/\D/g, "");
    let national: string | undefined;
    if (digits.length === 10) national = digits;                                  // 8031234567 (Excel stripped the 0)
    else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1); // 08031234567
    else if (digits.length === 13 && digits.startsWith("234")) national = digits.slice(3); // 234…/+234…
    if (!national || !/^[789]\d{9}$/.test(national)) {
      return { error: `phone '${raw}' is not a valid Nigerian mobile number` };
    }
    return { phone: `+234${national}` };
  }

  // Map a header row to canonical field names via a spec of accepted substrings,
  // then turn each data row into a { _row, <field>: value } record. Tolerant to
  // wording/casing, like the Speedaf parser.
  private toRecords(header: string[], rows: string[][], spec: Record<string, string[]>, baseRow = 2): Body[] {
    const fieldByColumn = header.map((h) => {
      const n = this.norm(h);
      for (const [field, needles] of Object.entries(spec)) {
        if (needles.some((needle) => n === needle || n.includes(needle))) return field;
      }
      return null;
    });
    const records: Body[] = [];
    rows.forEach((cells, index) => {
      const record: Body = { _row: index + baseRow }; // 1-based spreadsheet row, past the header
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
    const parsed = this.readGrid(body, BatchImportService.OPERATOR_SPEC);
    const records = "records" in parsed
      ? parsed.records.map((r, i) => ({ _row: i + 2, ...r }))
      : this.toRecords(parsed.header, parsed.rows, BatchImportService.OPERATOR_SPEC, parsed.firstDataRow);

    const { amoebaByName, siteByName } = await this.resolveMaps();
    const people = await this.foundationGet("/identity/v1/people");
    const users = await this.foundationGet("/identity/v1/users");
    const existingOperators = await this.db.many<any>("SELECT operator_id, person_id, vehicle_id FROM ops_operators");
    const operatorByPerson = new Map(existingOperators.map((o) => [o.person_id, o]));
    // Vehicle assignment is deliberately NOT part of operator import — any vehicle
    // column in the sheet is ignored; bikes are assigned later from the roster.

    const findPerson = (phone?: string, nin?: string) =>
      people.find((p: any) => (phone && p.phone === phone) || (nin && p.nin && String(p.nin) === String(nin)));

    const rows: RowReport[] = [];
    for (const rec of records) {
      const rowNo = Number(rec._row);
      const label = String(rec.display_name || rec.phone || "—");
      const fail = (reason: string) => rows.push({ row: rowNo, status: "error" as Verdict, reason, label });

      const displayName = String(rec.display_name || "").trim();
      if (!displayName) { fail("missing name"); continue; }
      let phone: string | undefined;
      if (rec.phone != null && String(rec.phone).trim() !== "") {
        const normalized = this.normalizePhone(String(rec.phone));
        if (normalized.error) { fail(normalized.error); continue; }
        phone = normalized.phone;
      }
      const nin = rec.nin ? String(rec.nin).trim() : undefined;
      if (nin && !/^\d{11}$/.test(nin)) { fail("NIN must be 11 digits"); continue; }
      const email = rec.email ? String(rec.email).trim() : undefined;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail("invalid email"); continue; }
      const operatorType = String(rec.operator_type || "rider").trim().toLowerCase();
      // amoeba + site are optional: a row with neither imports unassigned, to be
      // placed into an amoeba later from the ops-admin roster. A value that IS
      // given must resolve; a site still needs its amoeba alongside it.
      let amoebaId: string | undefined;
      if (rec.amoeba) {
        amoebaId = amoebaByName.get(this.norm(String(rec.amoeba)));
        if (!amoebaId) { fail(`unknown amoeba '${rec.amoeba}'`); continue; }
      }
      let siteId: string | undefined;
      if (rec.site) {
        if (!amoebaId) { fail("site needs an amoeba too"); continue; }
        siteId = siteByName.get(this.norm(String(rec.site)));
        if (!siteId) { fail(`unknown site '${rec.site}'`); continue; }
      }
      let startDate: string | undefined;
      if (rec.start_date != null && String(rec.start_date).trim() !== "") {
        const nd = this.normalizeDate(String(rec.start_date));
        if (nd.error) { fail(nd.error); continue; }
        startDate = nd.date;
      }


      const existingPerson = findPerson(phone, nin);
      if (existingPerson && operatorByPerson.has(existingPerson.person_id)) {
        rows.push({ row: rowNo, status: "skip", reason: "person already has an operator record", label, person_id: existingPerson.person_id });
        continue;
      }

      if (dryRun) {
        const notes = [
          existingPerson ? "existing person — will attach operator" : undefined,
          amoebaId ? undefined : "no amoeba — will import unassigned"
        ].filter(Boolean);
        rows.push({ row: rowNo, status: "create", reason: notes.join("; ") || undefined, label });
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
          vehicle_id: null, // never assigned at import — set later from the roster
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
    make_model: ["make model", "make", "model", "vehicle model"],
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
    const parsed = this.readGrid(body, BatchImportService.VEHICLE_SPEC);
    const records = "records" in parsed
      ? parsed.records.map((r, i) => ({ _row: i + 2, ...r }))
      : this.toRecords(parsed.header, parsed.rows, BatchImportService.VEHICLE_SPEC, parsed.firstDataRow);

    const { amoebaByName } = await this.resolveMaps();
    const vehicles = await this.ops.listVehicles({ unrestricted: true });
    // Bikes are identified by VIN (stored as tracker_device_id); plate is optional
    // and not used as the key.
    const vinSet = new Set(vehicles.map((v: any) => this.norm(v.tracker_device_id)).filter(Boolean));
    // Fleet sheets often mix battery/charger inventory lines under the same Type
    // column — those are not vehicles and are skipped (inventory lives elsewhere).
    const NON_VEHICLE_TYPES = new Set(["battery", "charger", "charging station", "swap station"]);
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
      const vin = String(rec.vin || "").trim();
      const vehicleType = String(rec.vehicle_type || "").trim().toLowerCase();
      const label = vin || String(rec.vehicle_type || "—");
      const fail = (reason: string) => rows.push({ row: rowNo, status: "error" as Verdict, reason, label });

      if (!vehicleType) { fail("missing vehicle_type"); continue; }
      if (NON_VEHICLE_TYPES.has(vehicleType)) {
        rows.push({ row: rowNo, status: "skip", reason: `${vehicleType} — not a vehicle (inventory)`, label });
        continue;
      }
      if (!vin) { fail("missing VIN"); continue; }
      if (vinSet.has(this.norm(vin))) {
        rows.push({ row: rowNo, status: "skip", reason: "VIN already imported", label });
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
          plate: null, // identified by VIN; plate assigned later from the roster
          vehicle_type: vehicleType,
          make_model: rec.make_model || null,
          color: rec.color || null,
          // ice/ev is the stored vocabulary; accept friendly synonyms. A blank
          // value falls through to the provider/make heuristic in createVehicle.
          powertrain: this.powertrainWord(rec.powertrain),
          tracker_provider: rec.tracker_provider || null,
          tracker_device_id: vin, // VIN is the tracker + the vehicle's identity
          amoeba_id: amoebaId,
          status: rec.status ? String(rec.status).toLowerCase() : "active"
        });
        vinSet.add(this.norm(vin));
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

  /* ------------------------------- hospitals -------------------------------- */

  // Accepts both the enriched geocoded sheet (with lat/lng/coords_quality) and
  // the raw HR sheet (Provider / Provider's Address / Provider Type / State /
  // City). Without coordinates a facility still imports — it just won't plot
  // until geocoded or hand-corrected. Upserts by name+LGA, so a refreshed sheet
  // updates in place.
  // Order matters: toRecords assigns the FIRST field whose needle matches, and
  // the broad "provider" needle for the name would otherwise swallow the
  // "Provider Type" and "Provider's Address" columns. So the specific columns are
  // listed first and the catch-all name is last.
  private static readonly HOSPITAL_SPEC: Record<string, string[]> = {
    provider_type: ["provider type", "facility type", "type", "category"],
    address: ["address"],
    state: ["state"],
    lga: ["city", "lga", "local government", "area"],
    phone: ["phone", "telephone", "mobile", "contact"],
    lat: ["latitude", "lat"],
    lng: ["longitude", "lng", "lon", "long"],
    coords_quality: ["coords quality", "coord quality", "geocode quality", "quality"],
    hmo_coverage: ["coverage", "hmo", "plan"],
    name: ["provider", "facility", "hospital", "name"]
  };

  async importHospitals(body: Body, actorPersonId: string): Promise<ImportReport> {
    const dryRun = body.dry_run !== false;
    const parsed = this.readGrid(body, BatchImportService.HOSPITAL_SPEC);
    const records: Body[] = "records" in parsed
      ? parsed.records.map((r, i) => ({ _row: i + 2, ...r }))
      : this.toRecords(parsed.header, parsed.rows, BatchImportService.HOSPITAL_SPEC, parsed.firstDataRow);

    const rows: RowReport[] = [];
    for (const rec of records) {
      const rowNo = Number(rec._row);
      const name = String(rec.name || "").trim();
      const label = name || "—";
      if (!name) { rows.push({ row: rowNo, status: "error", reason: "missing facility name", label }); continue; }

      const hasCoords = rec.lat !== undefined && rec.lat !== "" && rec.lng !== undefined && rec.lng !== "";
      if (dryRun) {
        rows.push({
          row: rowNo,
          status: "create",
          reason: hasCoords ? undefined : "no coordinates — will not plot until geocoded",
          label
        });
        continue;
      }
      try {
        const result = await this.ops.upsertHospital(rec);
        rows.push({
          row: rowNo,
          status: result.verdict === "create" ? "create" : "skip",
          reason: result.verdict === "update" ? "updated existing" : (hasCoords ? undefined : "imported without coordinates"),
          label,
          hospital_id: result.hospital_id
        });
      } catch (error: any) {
        rows.push({ row: rowNo, status: "error", reason: String(error?.message || error).slice(0, 200), label });
      }
    }
    return this.report(dryRun, rows);
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
