import { expect, test } from "@playwright/test";

const url = "/apps/operator-pwa/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

async function signIn(page) {
  await page.goto(url);
  if (await page.locator("#loginView").isVisible()) {
    await page.locator('input[name="phone_or_email"]').fill("0705 059 9554");
    await page.locator('input[name="pin"]').fill("000000");
    await page.locator("#loginForm button[type=submit]").click();
  }
  await expect(page.locator("#appView")).toBeVisible();
  await expect(page.locator("#connectionStatus")).toHaveText("Connected");
}

test.describe("Operator PWA cockpit", () => {
  test("signs in and shows the personal earnings gauge", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("#operatorName")).not.toHaveText("Driver");
    await expect(page.locator("#earningsGauge")).toBeVisible();
    await expect(page.locator("#revenueTotal")).not.toHaveText("₦0");
    await expect(page.locator(".gauge-source")).toContainText("Uber/Bolt platform accounts");
    await expect(page.locator(".stat-chips span")).toHaveCount(4);
    await expect(page.locator("#assignment .card-row").first()).toBeVisible();
    await expect(page.locator("#timeline li").first()).toBeVisible();
  });

  test("dock tabs switch between cockpit sections", async ({ page }) => {
    await signIn(page);
    await page.locator("[data-tab-link='rank']").click();
    await expect(page.locator("#rankGauge")).toBeVisible();
    await expect(page.locator("#leaderboard .leader-row").first()).toBeVisible();
    await expect(page.locator("#myRank")).not.toHaveText("—");

    await page.locator("[data-tab-link='alerts']").click();
    await expect(page.locator("#alertList")).toBeVisible();

    await page.locator("[data-tab-link='report']").click();
    await expect(page.locator("#supportButton")).toBeVisible();
    await expect(page.locator('[data-photo-input="maintenance"]')).toHaveAttribute("capture", "environment");
  });

  test("reports a maintenance issue to the supervisor", async ({ page }) => {
    await signIn(page);
    await page.locator("[data-tab-link='report']").click();
    await page.locator('#maintenanceForm select[name="category"]').selectOption("brakes");
    await page.locator('#maintenanceForm input[name="description"]').fill("Brakes feel soft on the left side.");
    await page.locator("#maintenanceForm button[type=submit]").click();
    await expect(page.locator("#appNotice")).toContainText("Maintenance issue sent");
  });

  test("keeps the SOS button visible on every tab", async ({ page }) => {
    await signIn(page);
    for (const tab of ["today", "alerts", "rank", "report"]) {
      await page.locator(`[data-tab-link='${tab}']`).click();
      await expect(page.locator("#sosFab")).toBeVisible();
    }
    await page.locator("[data-tab-link='today']").click();
    await page.locator("#sosFab").click();
    await expect(page.locator("#supportDialog")).toBeVisible();
    await page.locator("#supportDialog button[value='cancel']").click();
  });

  test("sends a support request", async ({ page }) => {
    await signIn(page);
    await page.locator("[data-tab-link='report']").click();
    await page.locator("#supportButton").click();
    await expect(page.locator("#supportDialog")).toBeVisible();
    await page.locator("#incidentNote").fill("Bike will not start.");
    await page.locator('#supportDialog button[value="breakdown"]').click();
    await expect(page.locator("#appNotice")).toContainText("supervisor has been notified");
  });

  test("has no horizontal overflow on mobile", async ({ page }) => {
    await signIn(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
