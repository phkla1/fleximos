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
      await page.getByText("Delivery Waybill Inquiry", { exact: false }).first().click();
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
      await this.openModule(page, "System Setup");
      await page.getByText("Download Center", { exact: false }).first().click();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        page.locator("a,button,[class*=download],[class*=operate] i, .anticon-download").last().click()
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
  // menu. Items carry class "topmenu--text" but sit in a dropdown that the ⋯
  // trigger toggles; open the menu, wait for the item to be visible, retry.
  private async openModule(page: any, label: string) {
    const item = page.locator(".topmenu--text", { hasText: label }).first();
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await item.isVisible().catch(() => false)) {
        try { await item.click({ timeout: 5000 }); return; } catch (error) { lastError = error; }
      }
      await this.triggerModuleMenu(page);
      await page.waitForTimeout(500);
    }
    // One last forced attempt so the caller sees a precise failure.
    await item.click({ force: true, timeout: 5000 }).catch((error: unknown) => { lastError = error; });
    if (await item.isVisible().catch(() => false)) return;
    throw new Error(`Could not open module "${label}" from the ⋯ menu: ${String((lastError as any)?.message || lastError).slice(0, 160)}`);
  }

  // Toggle the "⋯" module dropdown. Its exact handle isn't documented, so try a
  // few element candidates (hover + click), then a viewport-relative click on
  // the header where the ⋯ sits.
  private async triggerModuleMenu(page: any) {
    for (const selector of [".topmenu__more", ".topmenu-more", ".topmenu .anticon", "header [class*='more']", "header [class*='topmenu']", "[class*='top-menu']"]) {
      const handle = page.locator(selector).first();
      if (await handle.count().catch(() => 0)) {
        await handle.hover().catch(() => undefined);
        await handle.click({ force: true }).catch(() => undefined);
        if (await page.locator(".topmenu--text").first().isVisible().catch(() => false)) return;
      }
    }
    const viewport = page.viewportSize() || { width: 1366, height: 900 };
    // The ⋯ sits just right of the brand in the header (~21% across, ~30px down).
    await page.mouse.click(Math.round(viewport.width * 0.21), 30).catch(() => undefined);
  }
}
