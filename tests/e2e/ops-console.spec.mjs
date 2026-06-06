import { expect, test } from "@playwright/test";

test.describe("Ops console", () => {
  const url = "/apps/ops-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

  test("loads cross-domain operational data", async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle("Fleximotion Ops");
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.locator("#activeOperatorCount")).not.toHaveText("0");
    await expect(page.locator("#activePlatformCount")).toHaveText("3");
    await expect(page.getByRole("heading", { name: "Alert inbox" })).toBeVisible();
    await expect(page.locator("#alertList .alert-row")).not.toHaveCount(0);
  });

  test("creates a vehicle through the Ops API", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    const suffix = String(Date.now()).slice(-6);
    const plate = `QA-${suffix}`;
    await page.locator('#vehicleForm input[name="plate"]').fill(plate);
    await page.locator('#vehicleForm select[name="vehicle_type"]').selectOption("motorbike");
    await page.locator('#vehicleForm select[name="amoeba_id"]').selectOption("amoeba_island");
    await page.locator("#vehicleForm").getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.locator("#notice")).toContainText("Vehicle added");
    await expect(page.getByText(plate, { exact: true })).toBeVisible();
  });

  test("acknowledges an alert from the inbox", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    const acknowledgeButtons = page.getByRole("button", { name: "Acknowledge" });
    const count = await acknowledgeButtons.count();
    if (count === 0) test.skip(true, "Persistent test DB already acknowledged seeded alerts.");
    await acknowledgeButtons.first().click();
    await expect(page.getByRole("heading", { name: "Acknowledge alert" })).toBeVisible();
    await page.locator("#dialogNotes").fill("Checked by Playwright.");
    await page.locator("#confirmActionButton").click();
    await expect(page.locator("#notice")).toContainText("acknowledged");
  });

  test("has no page-level horizontal overflow on mobile", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
