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
      // Wait until the session token is persisted and the SPA's permission menu
      // has registered its dynamic routes (the ⋯ appears when the top nav loads).
      await page.waitForFunction(() => !!window.localStorage.getItem("ACCESS_TOKEN"), undefined, { timeout: 25000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await page.locator(".el-sub-menu__hide-arrow").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => undefined);

      // --- Delivery Waybill Inquiry (client-side route via the SPA router — a
      // hard reload of an inner route redirects to Home before the dynamic
      // routes load, so we push through the Vue router instead of the ⋯ menu) ---
      await this.spaNavigate(page, "/waybillManage/deliveryWaybillQuery");
      const searchButton = page.getByRole("button", { name: /^Search$/ }).first();
      await searchButton.waitFor({ state: "visible", timeout: 20000 });
      // Date range defaults to today, which is exactly what we pull.
      await searchButton.click();
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

      // --- Download Center (client-side route) ---
      await this.spaNavigate(page, "/systemSetting/download/downloadCenter");
      // The export runs server-side for several seconds; the list auto-refreshes,
      // so poll the top row until it reads "Export completed" (clicking a row
      // that is still exporting does nothing). Then download that newest export.
      const topRow = page.locator("tbody tr").first();
      await topRow.waitFor({ state: "visible", timeout: 20000 });
      let ready = false;
      for (let i = 0; i < 24 && !ready; i++) {
        const status = await topRow.innerText().catch(() => "");
        if (/completed/i.test(status)) ready = true;
        else await page.waitForTimeout(1500);
      }
      const downloadButton = topRow.locator('button[title="Download"]').first();
      await downloadButton.waitFor({ state: "visible", timeout: 10000 });
      // Capture the download at the context level (covers popup/target variance).
      const downloadPromise = context.waitForEvent("download", { timeout: 45000 });
      await downloadButton.click();
      const download = await downloadPromise;
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

  // Navigate within the SPA using its Vue-Router instance (client-side), which
  // — unlike a hard page load of an inner route — keeps the dynamically
  // registered routes and does not bounce to Home. Retries until the route
  // sticks (the permission routes may still be loading just after login).
  private async spaNavigate(page: any, path: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const landed = await page.evaluate(async (target: string) => {
        const router = (document.querySelector("#app") as any)?.__vue_app__?.config?.globalProperties?.$router;
        if (!router) return null;
        try { await router.push(target); } catch { /* route not ready yet */ }
        await new Promise((r) => setTimeout(r, 500));
        return router.currentRoute?.value ? router.currentRoute.value.path : (router.currentRoute?.path || null);
      }, path);
      if (landed === path) {
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
        return;
      }
      await page.waitForTimeout(1000);
    }
    throw new Error(`SPA navigation to ${path} did not stick (ended at ${page.url()}).`);
  }
}
