import { expect, test } from "@playwright/test";

const url = "/apps/ops-admin-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

test.describe("ops-admin bulk import", () => {
  test("previews then commits an operator CSV", async ({ page }) => {
    await page.goto(`${url}#imports`);
    await expect(page.locator("#notice")).toContainText("Connected to Fleximotion Ops.");
    await expect(page.locator("#imports")).toHaveClass(/view-active/);

    // Unique phone so a reused dev server doesn't turn this into a skip.
    const phone = `0803${Date.now().toString().slice(-7)}`;
    const csv = [
      "full_name,phone,operator_type,amoeba,site",
      `E2E Import Rider,${phone},rider,Island,Lekki Awudu Ekpegha`
    ].join("\n");

    const panel = page.locator("#operatorImportPanel");
    await panel.locator('input[type="file"]').setInputFiles({
      name: "operators.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv)
    });

    // Preview (dry-run) — nothing written, Commit unlocks.
    const commit = panel.locator('[data-mode="commit"]');
    await expect(commit).toBeDisabled();
    await panel.locator('[data-mode="preview"]').click();
    await expect(page.locator("#operatorImportResult")).toContainText("Dry-run");
    await expect(page.locator("#operatorImportReport")).toContainText("E2E Import Rider");
    await expect(commit).toBeEnabled();

    // Commit — row is created and a PIN is shown.
    await commit.click();
    await expect(page.locator("#operatorImportResult")).toContainText("Committed");
    const createdRow = page.locator("#operatorImportReport tr", { hasText: "E2E Import Rider" });
    await expect(createdRow).toContainText("create");
    await expect(page.locator("#operatorImportReport")).toContainText("Sign-in PIN");
    // Commit re-locks until the next preview.
    await expect(commit).toBeDisabled();
  });
});
