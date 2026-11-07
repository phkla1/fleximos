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

  test("previews then commits an HMO facility CSV", async ({ page }) => {
    await page.goto(`${url}#imports`);
    await expect(page.locator("#notice")).toContainText("Connected to Fleximotion Ops.");

    // Unique name so a reused dev server doesn't turn this into an upsert-skip.
    const name = `E2E Facility ${Date.now().toString().slice(-7)}`;
    const csv = [
      "name,provider_type,address,state,lga,lat,lng,coords_quality",
      `${name},Hospital,1 Test Road Ikeja,Lagos,Ikeja,6.6018,3.3515,street`
    ].join("\n");

    const panel = page.locator("#hospitalImportPanel");
    await panel.locator("summary").click();
    await panel.locator('input[type="file"]').setInputFiles({
      name: "hospitals.csv", mimeType: "text/csv", buffer: Buffer.from(csv)
    });

    const commit = panel.locator('[data-mode="commit"]');
    await expect(commit).toBeDisabled();
    await panel.locator('[data-mode="preview"]').click();
    await expect(page.locator("#hospitalImportResult")).toContainText("Dry-run");
    await expect(page.locator("#hospitalImportReport")).toContainText(name);
    await expect(commit).toBeEnabled();

    await commit.click();
    await expect(page.locator("#hospitalImportResult")).toContainText("Committed");
    await expect(page.locator("#hospitalImportReport tr", { hasText: name })).toContainText("create");
    await expect(commit).toBeDisabled();
  });
});
