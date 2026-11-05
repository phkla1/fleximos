import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { OpsService } from "./ops.service.js";
import { PlatformConnectorsService, NormalizedDailyRecord } from "./platform-connectors.service.js";
import { parseWorkbookSheets, excelSerialToISODate } from "./xlsx-lite.js";

// Phase D — revenue-history backfill for the ride-platform-shaped sources
// (operators earn on them), plus the inDrive file connector. It rides the
// existing pull → ingest pipeline: the connectors already fetch a day, and
// ingestDailyRecords already upserts by (operator, account, record_date) and
// accepts source "migration" for historical writes. Nothing new is persisted —
// this adds (1) an unmapped-id resolver so backfilled rows actually land, (2) a
// date-range loop over the Bolt API, and (3) a parser that turns inDrive's
// weekly Excel into daily records.
//
// Speedaf is deliberately NOT here: it has no historical API (its live pull is
// today-only), and its past-dated upload + courier→rider mapping + unmapped
// surface already exist in the Deliver tab. This panel covers platform-
// registration sources (Bolt driver_uuid, inDrive driver_id) only.

type Body = Record<string, unknown>;

const BACKFILL_MAX_DAYS = 31; // one run; a wider history is several runs

type DiscoverId = {
  platform_operator_id: string;
  label: string;
  activity: string;      // human hint for identifying the id (trips / deliveries)
  mapped: boolean;
  operator_id: string | null;
};

@Injectable()
export class BackfillService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(PlatformConnectorsService) private readonly connectors: PlatformConnectorsService
  ) {}

  /* --------------------------------- shared --------------------------------- */

  private async account(platformAccountId: string) {
    if (!platformAccountId) throw new BadRequestException("platform_account_id is required.");
    const row = await this.db.one<any>(
      "SELECT * FROM ops_platform_accounts WHERE platform_account_id = $1 AND is_active = TRUE",
      [platformAccountId]
    );
    if (!row) throw new BadRequestException("platform_account_id does not identify an active platform account.");
    return row;
  }

  private isoDate(value: unknown, field: string): string {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException(`${field} must be YYYY-MM-DD.`);
    return text;
  }

  private dateRange(from: string, to: string): string[] {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException("Invalid date range.");
    if (end < start) throw new BadRequestException("date_to must not be before date_from.");
    const days: string[] = [];
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
      days.push(d.toISOString().slice(0, 10));
      if (days.length > BACKFILL_MAX_DAYS) {
        throw new BadRequestException(`A backfill run covers at most ${BACKFILL_MAX_DAYS} days — split a wider history into several runs.`);
      }
    }
    return days;
  }

  // Every platform_operator_id already mapped on this account → its operator.
  private async registrations(platformAccountId: string): Promise<Map<string, string>> {
    const rows = await this.db.many<any>(
      `SELECT platform_operator_id, operator_id FROM ops_operator_platform_accounts
       WHERE platform_account_id = $1 AND registration_status IN ('registered', 'active')`,
      [platformAccountId]
    );
    return new Map(rows.map((r) => [String(r.platform_operator_id), String(r.operator_id)]));
  }

  /* ------------------------------- discover --------------------------------- */

  // Dry pull one day (api/headless) or parse the file (file mode) and list every
  // platform id the source reports, flagged mapped/unmapped against the
  // registrations. The admin maps the unmapped ones (via the existing
  // platform-registrations endpoint) before committing a backfill, or their rows
  // are rejected on ingest.
  async discover(body: Body): Promise<{ platform: string; mode: string; record_date: string | null; ids: DiscoverId[]; unmapped_count: number }> {
    const account = await this.account(String(body.platform_account_id || ""));
    const mode = String(account.integration_mode || "api");
    const mapped = await this.registrations(account.platform_account_id);

    let ids: Array<{ platform_operator_id: string; activity: string }> = [];
    let recordDate: string | null = null;

    if (mode === "file") {
      const parsed = this.parseInDrive(body);
      const byDriver = new Map<string, number>();
      for (const row of parsed.weekly) byDriver.set(row.driver_id, (byDriver.get(row.driver_id) || 0) + row.dones);
      ids = [...byDriver.entries()].map(([id, dones]) => ({ platform_operator_id: id, activity: `${dones} deliveries in file` }));
    } else {
      recordDate = this.isoDate(body.record_date || this.lagosToday(), "record_date");
      const records = await this.connectors.fetchDaily(account as any, recordDate);
      ids = records.map((r) => ({
        platform_operator_id: String(r.platform_operator_id),
        activity: `${r.trips_completed}/${r.trips_total} trips`
      }));
    }

    const list: DiscoverId[] = ids
      .filter((r) => r.platform_operator_id)
      .map((r) => ({
        platform_operator_id: r.platform_operator_id,
        label: r.platform_operator_id,
        activity: r.activity,
        mapped: mapped.has(r.platform_operator_id),
        operator_id: mapped.get(r.platform_operator_id) || null
      }))
      .sort((a, b) => Number(a.mapped) - Number(b.mapped) || a.platform_operator_id.localeCompare(b.platform_operator_id));

    return {
      platform: account.platform,
      mode,
      record_date: recordDate,
      ids: list,
      unmapped_count: list.filter((r) => !r.mapped).length
    };
  }

  private lagosToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  /* ----------------------------- Bolt backfill ------------------------------ */

  // Loop the existing connector over a date range and ingest each day with
  // source "migration". Dry-run reports per-day what the connector returned and
  // how many rows would land vs. be rejected for want of a mapping; commit does
  // the ingest. Synchronous on purpose — the async worker only runs when
  // FLEXI_EMBED_JOBS is set, so a queued backfill could sit dead.
  async backfillPlatform(body: Body, actorPersonId: string) {
    const account = await this.account(String(body.platform_account_id || ""));
    if ((account.integration_mode || "api") === "file") {
      throw new BadRequestException("This is a file-based source — use the inDrive import, not the range backfill.");
    }
    const from = this.isoDate(body.date_from, "date_from");
    const to = this.isoDate(body.date_to, "date_to");
    const days = this.dateRange(from, to);
    const dryRun = body.dry_run !== false;
    const mapped = await this.registrations(account.platform_account_id);

    const perDay: Array<{ record_date: string; received: number; mapped: number; unmapped: number; upserted: number; rejected: number; error?: string }> = [];
    for (const date of days) {
      try {
        const records = await this.connectors.fetchDaily(account as any, date);
        const mappedCount = records.filter((r) => mapped.has(String(r.platform_operator_id))).length;
        if (dryRun) {
          perDay.push({ record_date: date, received: records.length, mapped: mappedCount, unmapped: records.length - mappedCount, upserted: 0, rejected: 0 });
          continue;
        }
        if (!records.length) {
          perDay.push({ record_date: date, received: 0, mapped: 0, unmapped: 0, upserted: 0, rejected: 0 });
          continue;
        }
        const result: any = await this.ops.ingestDailyRecords(
          { platform_account_id: account.platform_account_id, record_date: date, source: "migration", records },
          actorPersonId
        );
        perDay.push({
          record_date: date,
          received: records.length,
          mapped: mappedCount,
          unmapped: records.length - mappedCount,
          upserted: Number(result.records_upserted || 0),
          rejected: Number(result.records_rejected || 0)
        });
      } catch (error: any) {
        perDay.push({ record_date: date, received: 0, mapped: 0, unmapped: 0, upserted: 0, rejected: 0, error: String(error?.message || error).slice(0, 200) });
      }
    }

    return this.rangeReport(dryRun, account, from, to, perDay);
  }

  private rangeReport(dryRun: boolean, account: any, from: string, to: string, perDay: any[]) {
    const sum = (k: string) => perDay.reduce((n, d) => n + Number(d[k] || 0), 0);
    return {
      dry_run: dryRun,
      platform: account.platform,
      platform_account_id: account.platform_account_id,
      date_from: from,
      date_to: to,
      summary: {
        days: perDay.length,
        received: sum("received"),
        mapped: sum("mapped"),
        unmapped: sum("unmapped"),
        upserted: sum("upserted"),
        rejected: sum("rejected")
      },
      days: perDay
    };
  }

  /* ---------------------------- inDrive connector --------------------------- */

  // inDrive's export is weekly (driver × week) with money only at week level, but
  // it always ships the underlying order rows. So daily deliveries + distance are
  // read EXACTLY from order timestamps, and the week's gmv/income is ALLOCATED
  // across its order-days in proportion to each day's deliveries (data_quality
  // "estimated"). income_courier is a flat gmv × 0.87. reward_ngn is a whole-week
  // tier bonus with no honest daily value — it is kept in provenance only, never
  // folded into daily revenue (a comp decision, not a parsing one).
  //
  // (A daily delta — today's week-to-date minus yesterday's — would give exact
  // per-day money once inDrive sends files daily; it is deferred until that live
  // feed exists and two consecutive real files can be tested. Allocation is
  // self-correcting: re-ingesting the growing week each day converges on the
  // final split.)
  async importInDrive(body: Body, actorPersonId: string) {
    const account = await this.account(String(body.platform_account_id || ""));
    if ((account.integration_mode || "api") !== "file") {
      throw new BadRequestException("inDrive import expects a file-mode platform account (integration_mode 'file').");
    }
    const dryRun = body.dry_run !== false;
    const parsed = this.parseInDrive(body);
    const mapped = await this.registrations(account.platform_account_id);

    // Exact per-(driver, date) deliveries + distance from the order rows.
    const dayAgg = new Map<string, { dones: number; distance: number }>();
    for (const o of parsed.orders) {
      const key = `${o.driver_id}|${o.date}`;
      const cur = dayAgg.get(key) || { dones: 0, distance: 0 };
      cur.dones += 1;
      cur.distance += o.distance_km;
      dayAgg.set(key, cur);
    }

    // Allocate each weekly bucket's money across its order-days.
    const byDate = new Map<string, NormalizedDailyRecord[]>();
    let driversSeen = new Set<string>();
    for (const wk of parsed.weekly) {
      driversSeen.add(wk.driver_id);
      const days: Array<{ date: string; dones: number; distance: number }> = [];
      for (let d = new Date(`${wk.week_start}T00:00:00Z`); d <= new Date(`${wk.week_end}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
        const date = d.toISOString().slice(0, 10);
        const agg = dayAgg.get(`${wk.driver_id}|${date}`);
        if (agg && agg.dones > 0) days.push({ date, dones: agg.dones, distance: agg.distance });
      }
      const totalDones = days.reduce((n, d) => n + d.dones, 0);
      if (!totalDones) continue; // a week with no order rows contributes no daily money
      for (const day of days) {
        const share = day.dones / totalDones;
        const dayGmv = this.round2(wk.gmv * share);
        const dayIncome = this.round2(wk.income_courier * share);
        const record: NormalizedDailyRecord = {
          platform_operator_id: wk.driver_id,
          trips_total: day.dones,
          trips_completed: day.dones,
          trips_cancelled: 0,
          trips_no_response: 0,
          trips_rejected: 0,
          ride_revenue_ngn: dayGmv,
          net_earnings_ngn: dayIncome,
          booking_fees_ngn: 0,
          cash_trips: 0,
          card_trips: 0,
          acceptance_pct: null,
          cancellation_pct: null,
          completion_pct: day.dones ? 100 : null,
          hours_online: 0, // supply_hours is weekly; not daily-ised (kept in provenance)
          last_seen_at: null,
          current_status: "checked_out",
          data_quality: "estimated", // money is allocated from the weekly total
          provenance: {
            connector: "indrive",
            grain: "weekly_allocated",
            allocation: "by_daily_done_share",
            week_start: wk.week_start,
            week_end: wk.week_end,
            week_gmv: wk.gmv,
            week_income_courier: wk.income_courier,
            week_dones: wk.dones,
            day_distance_km: this.round2(day.distance),
            // informational only — NOT counted toward revenue or Flexi Points
            reward_ngn: wk.reward_ngn,
            reward_perc: wk.reward_perc,
            supply_hours: wk.supply_hours,
            bids: wk.bids,
            accepts: wk.accepts,
            cancelled_by_client: wk.cancelled_by_client,
            cancelled_by_driver: wk.cancelled_by_driver
          },
          raw_payload: { driver_id: wk.driver_id, week: { start: wk.week_start, end: wk.week_end }, day: { date: day.date, dones: day.dones, distance_km: this.round2(day.distance) } }
        };
        if (!byDate.has(day.date)) byDate.set(day.date, []);
        byDate.get(day.date)!.push(record);
      }
    }

    const dates = [...byDate.keys()].sort();
    const unmappedDrivers = [...driversSeen].filter((d) => !mapped.has(d));
    const perDate: Array<{ record_date: string; records: number; mapped: number; unmapped: number; upserted: number; rejected: number; error?: string }> = [];

    for (const date of dates) {
      const records = byDate.get(date)!;
      const mappedCount = records.filter((r) => mapped.has(r.platform_operator_id)).length;
      if (dryRun) {
        perDate.push({ record_date: date, records: records.length, mapped: mappedCount, unmapped: records.length - mappedCount, upserted: 0, rejected: 0 });
        continue;
      }
      try {
        const result: any = await this.ops.ingestDailyRecords(
          { platform_account_id: account.platform_account_id, record_date: date, source: "migration", records },
          actorPersonId
        );
        perDate.push({ record_date: date, records: records.length, mapped: mappedCount, unmapped: records.length - mappedCount, upserted: Number(result.records_upserted || 0), rejected: Number(result.records_rejected || 0) });
      } catch (error: any) {
        perDate.push({ record_date: date, records: records.length, mapped: mappedCount, unmapped: records.length - mappedCount, upserted: 0, rejected: 0, error: String(error?.message || error).slice(0, 200) });
      }
    }

    const sum = (k: string) => perDate.reduce((n, d) => n + Number((d as any)[k] || 0), 0);
    return {
      dry_run: dryRun,
      platform: account.platform,
      platform_account_id: account.platform_account_id,
      summary: {
        drivers: driversSeen.size,
        unmapped_drivers: unmappedDrivers.length,
        dates: perDate.length,
        date_from: dates[0] || null,
        date_to: dates[dates.length - 1] || null,
        records: sum("records"),
        mapped: sum("mapped"),
        upserted: sum("upserted"),
        rejected: sum("rejected")
      },
      unmapped_driver_ids: unmappedDrivers,
      dates: perDate
    };
  }

  /* ------------------------------ inDrive parse ----------------------------- */

  private parseInDrive(body: Body): { weekly: WeeklyRow[]; orders: OrderRow[] } {
    if (body.file_base64 === undefined) throw new BadRequestException("Provide the inDrive workbook as file_base64 (.xlsx).");
    const buffer = Buffer.from(String(body.file_base64), "base64");
    if (!(buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      throw new BadRequestException("The inDrive file must be an .xlsx workbook.");
    }
    let sheets: Array<{ name: string; grid: string[][] }>;
    try {
      sheets = parseWorkbookSheets(buffer);
    } catch (error: any) {
      throw new BadRequestException(`Could not read the workbook: ${String(error?.message).slice(0, 160)}`);
    }

    // Classify by header signature, not tab name (tab names/order are not stable,
    // and the populated tabs sit behind a template at sheet1).
    const weeklyCandidates: Array<{ header: Map<string, number>; rows: string[][] }> = [];
    const orderCandidates: Array<{ header: Map<string, number>; rows: string[][] }> = [];
    for (const sheet of sheets) {
      const located = this.locateHeader(sheet.grid);
      if (!located) continue;
      const { header, rows } = located;
      const has = (needle: string) => [...header.keys()].some((k) => k.includes(needle));
      if (has("driver id") && has("gmv") && has("dones")) weeklyCandidates.push({ header, rows });
      else if (has("driver id") && has("order timestamp")) orderCandidates.push({ header, rows });
    }
    const weeklyPick = weeklyCandidates.sort((a, b) => b.rows.length - a.rows.length)[0];
    const orderPick = orderCandidates.sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!weeklyPick) throw new BadRequestException("No inDrive report sheet found (needs driver_id, gmv, dones columns).");
    if (!orderPick) throw new BadRequestException("No inDrive orders sheet found (needs driver_id, order_timestamp columns) — the order rows are required for daily attribution.");

    const weekly = this.readWeekly(weeklyPick.header, weeklyPick.rows);
    const orders = this.readOrders(orderPick.header, orderPick.rows);
    if (!weekly.length) throw new BadRequestException("The inDrive report sheet has no data rows.");
    return { weekly, orders };
  }

  // Find the header row (the export puts a SQL blob in row 1 of some tabs) and
  // return a normalised-name → column-index map plus the rows after it.
  private locateHeader(grid: string[][]): { header: Map<string, number>; rows: string[][] } | null {
    for (let r = 0; r < Math.min(grid.length, 5); r++) {
      const cells = grid[r] || [];
      const norm = cells.map((c) => this.norm(c));
      if (norm.some((c) => c === "driver id")) {
        const header = new Map<string, number>();
        norm.forEach((name, i) => { if (name && !header.has(name)) header.set(name, i); });
        return { header, rows: grid.slice(r + 1) };
      }
    }
    return null;
  }

  private norm(value: unknown): string {
    return String(value ?? "").toLowerCase().replace(/[\s_]+/g, " ").trim();
  }

  private col(header: Map<string, number>, ...needles: string[]): number {
    for (const needle of needles) {
      for (const [name, idx] of header) if (name === needle || name.includes(needle)) return idx;
    }
    return -1;
  }

  // driver_id arrives as a number, sometimes in scientific notation
  // (2.35144545E8). Normalise to its plain integer string so it matches the
  // platform_operator_id the admin maps.
  private driverId(value: unknown): string {
    const n = Number(String(value ?? "").trim());
    if (Number.isFinite(n)) return String(Math.round(n));
    return String(value ?? "").trim();
  }

  private num(value: unknown): number {
    const n = Number(String(value ?? "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private readWeekly(header: Map<string, number>, rows: string[][]): WeeklyRow[] {
    const c = {
      driver: this.col(header, "driver id"),
      ws: this.col(header, "week start"),
      we: this.col(header, "week end"),
      dones: this.col(header, "dones", "completed orders", "dones within period"),
      gmv: this.col(header, "gmv", "gmv within period"),
      income: this.col(header, "income courier", "income courier minus our commision"),
      reward_ngn: this.col(header, "reward ngn"),
      reward_perc: this.col(header, "reward"),
      supply: this.col(header, "supply hours", "supple hours"),
      bids: this.col(header, "bids"),
      accepts: this.col(header, "accepts", "accepted orders"),
      cxc: this.col(header, "calceled by client", "cancelled by client"),
      cxd: this.col(header, "calceled by driver", "cancelled by courier")
    };
    const out: WeeklyRow[] = [];
    for (const cells of rows) {
      const driver = this.driverId(cells[c.driver]);
      const weekStart = excelSerialToISODate(cells[c.ws]);
      const weekEnd = excelSerialToISODate(cells[c.we]);
      if (!driver || !weekStart || !weekEnd) continue;
      const gmv = this.num(cells[c.gmv]);
      const income = c.income >= 0 ? this.num(cells[c.income]) : this.round2(gmv * 0.87);
      out.push({
        driver_id: driver,
        week_start: weekStart,
        week_end: weekEnd,
        dones: Math.round(this.num(cells[c.dones])),
        gmv,
        income_courier: income,
        reward_ngn: c.reward_ngn >= 0 ? this.num(cells[c.reward_ngn]) : 0,
        reward_perc: c.reward_perc >= 0 ? this.num(cells[c.reward_perc]) : 0,
        supply_hours: c.supply >= 0 ? this.round2(this.num(cells[c.supply])) : 0,
        bids: c.bids >= 0 ? Math.round(this.num(cells[c.bids])) : 0,
        accepts: c.accepts >= 0 ? Math.round(this.num(cells[c.accepts])) : 0,
        cancelled_by_client: c.cxc >= 0 ? Math.round(this.num(cells[c.cxc])) : 0,
        cancelled_by_driver: c.cxd >= 0 ? Math.round(this.num(cells[c.cxd])) : 0
      });
    }
    return out;
  }

  private readOrders(header: Map<string, number>, rows: string[][]): OrderRow[] {
    const c = {
      driver: this.col(header, "driver id"),
      ts: this.col(header, "order timestamp"),
      dist: this.col(header, "distance km", "distance")
    };
    const out: OrderRow[] = [];
    for (const cells of rows) {
      const driver = this.driverId(cells[c.driver]);
      const date = excelSerialToISODate(cells[c.ts]);
      if (!driver || !date) continue;
      out.push({ driver_id: driver, date, distance_km: this.round2(this.num(cells[c.dist])) });
    }
    return out;
  }
}

type WeeklyRow = {
  driver_id: string;
  week_start: string;
  week_end: string;
  dones: number;
  gmv: number;
  income_courier: number;
  reward_ngn: number;
  reward_perc: number;
  supply_hours: number;
  bids: number;
  accepts: number;
  cancelled_by_client: number;
  cancelled_by_driver: number;
};

type OrderRow = { driver_id: string; date: string; distance_km: number };
