import { expect, test } from "@playwright/test";

test.describe("developer portal", () => {
  test("loads the overview and renders OpenAPI endpoints", async ({ page }) => {
    await page.goto("/apps/developer-portal/");

    await expect(page).toHaveTitle("Fleximotion Developer Portal");
    await expect(page.getByRole("heading", { name: "Build against stable Fleximotion contracts." })).toBeVisible();
    await expect(page.getByText("One portal for every future API consumer.")).toBeVisible();
    await expect.poll(async () => page.locator(".endpoint-button").count()).toBeGreaterThanOrEqual(50);
    await expect(page.locator("#apiTitle")).toHaveText("Ops API");
    await expect(page.getByRole("button", { name: "POST /daily-closeouts" })).toBeVisible();
    await page.locator("#apiSelect").selectOption("payments");
    await expect(page.getByRole("button", { name: "POST /accounting-period-closes" })).toBeVisible();
  });

  test("switches between API contracts in the explorer", async ({ page }) => {
    await page.goto("/apps/developer-portal/#api-ops");

    await page.locator("#apiSelect").selectOption("hr");
    await expect(page.locator("#apiTitle")).toHaveText("HR / Recruitment API");
    await expect(page.locator(".endpoint-button")).toHaveCount(8);

    await page.locator("#apiSelect").selectOption("identity");
    await expect(page.locator("#apiTitle")).toHaveText("Identity API");
    await expect(page.locator("#endpointTitle")).toContainText("/");

    await page.locator("#apiSelect").selectOption("payments");
    await expect(page.locator("#apiTitle")).toHaveText("Payments Integration API");
    await expect(page.locator(".endpoint-button")).toHaveCount(15);
    await expect(page.getByRole("button", { name: "POST /accounting-period-closes" })).toBeVisible();
    await expect(page.locator("#endpointTitle")).toContainText("/");
  });

  test("keeps primary content usable on mobile", async ({ page }) => {
    await page.goto("/apps/developer-portal/");

    await expect(page.getByRole("heading", { name: "Build against stable Fleximotion contracts." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore APIs" })).toBeVisible();
    await expect(page.locator(".system-map")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });
    expect(overflow).toBe(false);
  });
});
