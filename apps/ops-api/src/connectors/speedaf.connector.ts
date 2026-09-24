import { parseDeliveryExport, type ParsedDeliveryRow } from "../xlsx-lite.js";

// Speedaf has no API, so the "connector" drives their portal headlessly:
// log in, run the Delivery Waybill export for today, download it from the
// Download Center, and parse it with the same reader the manual upload uses.
// It is fully env-gated (off unless SPEEDAF_ACCOUNT + SPEEDAF_PASSWORD are
// set) and loads Playwright lazily, so an unconfigured server never touches a
// browser. The click-path mirrors the flow verified by hand in the portal; it
// needs one live-credentials run to confirm selectors, because signing in is
// done by a person, never automated blind in CI.

export type SpeedafConfig = {
  baseUrl: string;
  account: string;
  password: string;
  channel?: string;
};

export type SpeedafHealth = { status: "ok" | "degraded" | "down" | "not_configured"; detail: string; latency_ms?: number };

// The 8 columns we ingest, by their portal labels (matched case-insensitively
// in the export dialog).
const EXPORT_COLUMNS = [
  "Waybill No.", "Waybill Status", "Last Scan Time", "Site of Last Scan",
  "Delivery Type", "Delivery Courier", "Numbers of Attemp Delivery", "Last Scan"
];

export function speedafConfigFromEnv(env = process.env): SpeedafConfig | null {
  if (!env.SPEEDAF_ACCOUNT || !env.SPEEDAF_PASSWORD) return null;
  return {
    baseUrl: (env.SPEEDAF_BASE_URL || "https://ope.speedaf.com").replace(/\/$/, ""),
    account: env.SPEEDAF_ACCOUNT,
    password: env.SPEEDAF_PASSWORD,
    channel: env.SPEEDAF_CHANNEL || "Default"
  };
}

export class SpeedafConnector {
  readonly provider = "speedaf";
  readonly label = "Speedaf portal";

  constructor(private readonly config: SpeedafConfig) {}

  async healthCheck(): Promise<SpeedafHealth> {
    const started = Date.now();
    try {
      const response = await fetch(this.config.baseUrl, { signal: AbortSignal.timeout(4000) });
      const latency = Date.now() - started;
      if (!response.ok) return { status: "degraded", detail: `Portal returned HTTP ${response.status}.`, latency_ms: latency };
      return { status: "ok", detail: "Portal reachable; scheduled pull is armed.", latency_ms: latency };
    } catch (error: any) {
      return { status: "down", detail: `Portal unreachable: ${String(error?.message).slice(0, 120)}`, latency_ms: Date.now() - started };
    }
  }

  // Pull today's delivery export. Returns the parsed rows; the caller feeds
  // them to DeliveriesImportService.importSpeedaf (capture_source auto_pull).
  async pullTodayRows(): Promise<{ rows: ParsedDeliveryRow[]; file_name: string }> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // --- Sign in ---
      await page.getByPlaceholder(/Account/i).first().fill(this.config.account);
      await page.getByPlaceholder(/Password/i).first().fill(this.config.password);
      await page.getByRole("button", { name: /login/i }).click();
      await page.waitForLoadState("networkidle", { timeout: 30000 });

      // --- Open Delivery Waybill Inquiry (⋯ → Waybill Manage → …) ---
      await this.openModule(page, "Waybill Manage");
      const inquiry = page.getByText("Delivery Waybill Inquiry", { exact: false }).first();
      await inquiry.waitFor({ state: "visible", timeout: 10000 });
      await inquiry.click();
      // Date range defaults to today, which is exactly what we pull.
      await page.getByRole("button", { name: /^Search$/ }).first().click();
      await page.waitForLoadState("networkidle", { timeout: 20000 });

      // --- Export the chosen columns ---
      await page.getByRole("button", { name: /^Export$/ }).first().click();
      const dialog = page.getByText("Select Column to Export").first();
      await dialog.waitFor({ timeout: 15000 });
      for (const column of EXPORT_COLUMNS) {
        const checkbox = page.getByText(column, { exact: false }).first();
        if (await checkbox.count()) await checkbox.click().catch(() => undefined);
      }
      await page.getByRole("button", { name: /New/ }).first().click().catch(() => undefined);
      await page.getByRole("button", { name: /^Export$/ }).last().click();

      // --- Download from the Download Center ---
      // System Setup module → the left sidebar's "Download Center" group (a
      // collapsible el-sub-menu) → its "Download Center" page (a level-3 item).
      await this.openModule(page, "System Setup");
      await page.locator(".el-sub-menu__title").filter({ hasText: /^Download Center$/ }).first().click().catch(() => undefined);
      const downloadCenterPage = page.locator(".el-menu-item").filter({ hasText: /^Download Center$/ }).first();
      await downloadCenterPage.waitFor({ state: "visible", timeout: 10000 });
      await downloadCenterPage.click();
      // Newest export is the top row; its Operate cell holds a Download button.
      const downloadButton = page.locator('button[title="Download"]').first();
      await downloadButton.waitFor({ state: "visible", timeout: 15000 });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        downloadButton.click()
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      const rows = parseDeliveryExport(buffer);
      return { rows, file_name: download.suggestedFilename() || "speedaf-auto.xlsx" };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  // Open a top-level module (Waybill Manage, System Setup, …) from the "⋯"
  // menu. Confirmed against the live portal: the ⋯ is an Element-Plus sub-menu
  // (.el-sub-menu__hide-arrow) whose popup opens on mouseenter. A real hover
  // does not fire that in headless Chromium, so we dispatch the events
  // directly — mouseenter to open, then click the .el-menu--popup item.
  private async openModule(page: any, label: string) {
    const trigger = page.locator(".el-sub-menu__hide-arrow").first();
    const item = page.locator(".el-menu--popup .el-menu-item").filter({ hasText: label }).first();
    await trigger.waitFor({ state: "attached", timeout: 15000 });
    for (let attempt = 0; attempt < 5; attempt++) {
      await trigger.dispatchEvent("mouseenter").catch(() => undefined);
      await page.waitForTimeout(350);
      if (await item.count().catch(() => 0)) {
        await item.dispatchEvent("click");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
        return;
      }
      await page.waitForTimeout(350);
    }
    throw new Error(`Could not open module "${label}" from the ⋯ menu.`);
  }
}
