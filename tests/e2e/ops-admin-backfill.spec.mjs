import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const url = "/apps/ops-admin-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";
const opsBase = "http://127.0.0.1:4530";
const token = "flexi-dev-service-token";
const fixture = readFileSync(new URL("../fixtures/indrive-sample.xlsx", import.meta.url));
const missingOrders = readFileSync(new URL("../fixtures/indrive-missing-orders.xlsx", import.meta.url));

// Ensure a file-mode inDrive platform exists (idempotent against the persistent
// e2e DB), so the Backfill panel has a file source to drive.
test.beforeAll(async ({ request }) => {
  const list = await (await request.get(`${opsBase}/ops/v1/platform-accounts`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if ((list.data || []).some((a) => a.platform === "indrive")) return;
  await request.post(`${opsBase}/ops/v1/platform-accounts`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `e2e-indrive-${Date.now()}` },
    data: { platform: "indrive", display_name: "inDrive Couriers", vehicle_type: "motorbike", account_subtype: "delivery", integration_mode: "file" }
  });
});

test.describe("ops-admin revenue backfill", () => {
  test("discovers inDrive ids and previews the weekly→daily split", async ({ page }) => {
    await page.goto(`${url}#data-health`);
    await expect(page.locator("#notice")).toContainText("Connected to Fleximotion Ops.");

    // Open the Backfill panel and pick the file-mode (inDrive) source.
    await page.locator("#backfillPanel > summary").click();
    const fileOption = page.locator('#backfillSource option[data-mode="file"]').first();
    const value = await fileOption.getAttribute("value");
    await page.locator("#backfillSource").selectOption(value);

    // File mode reveals the workbook input; the date-range inputs stay hidden.
    await expect(page.locator("#backfillFileInputs")).toBeVisible();
    await expect(page.locator("#backfillApiInputs")).toBeHidden();
    await page.locator("#backfillFile").setInputFiles({ name: "Fleet_Fleximotion.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixture });

    // Discover lists the driver ids from the file (3 in the fixture).
    await page.locator("#backfillDiscoverBtn").click();
    await expect(page.locator("#backfillResult")).toContainText("unmapped");
    await expect(page.locator("#backfillIds")).toContainText("235144545");

    // Preview (dry-run) splits each week into days and writes nothing.
    const commit = page.locator('#backfillPanel [data-backfill="commit"]');
    await page.locator('#backfillPanel [data-backfill="preview"]').click();
    await expect(page.locator("#backfillResult")).toContainText("Dry-run");
    await expect(page.locator("#backfillReport")).toContainText("2026-01-01");
    // Commit unlocks only if the dry-run found a mapped driver to land; with none
    // mapped in this fresh run it stays locked, which is the correct guard.
    await expect(commit).toBeDisabled();
  });

  test("schema guard holds a format-changed file and shows why", async ({ page }) => {
    await page.goto(`${url}#data-health`);
    await expect(page.locator("#notice")).toContainText("Connected to Fleximotion Ops.");
    await page.locator("#backfillPanel > summary").click();
    const value = await page.locator('#backfillSource option[data-mode="file"]').first().getAttribute("value");
    await page.locator("#backfillSource").selectOption(value);
    await page.locator("#backfillFile").setInputFiles({ name: "no-orders.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: missingOrders });

    await page.locator('#backfillPanel [data-backfill="preview"]').click();
    // The missing orders sheet is a BLOCK: import held, descriptive finding shown,
    // commit stays disabled.
    await expect(page.locator("#backfillResult")).toContainText("import held");
    await expect(page.locator("#backfillReport")).toContainText("orders_list");
    await expect(page.locator('#backfillPanel [data-backfill="commit"]')).toBeDisabled();
  });
});
