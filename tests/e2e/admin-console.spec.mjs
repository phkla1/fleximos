import { expect, test } from "@playwright/test";

test.describe("admin console", () => {
  const adminUrl = "/apps/admin-console/?apiBase=http://127.0.0.1:4510";

  test("loads foundation data from the API", async ({ page }) => {
    await page.goto(adminUrl);

    await expect(page).toHaveTitle("Fleximotion Admin Console");
    await expect(page.getByRole("heading", { name: "Manage identity and amoeba reference data." })).toBeVisible();
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.locator("#peopleCount")).not.toHaveText("0");
    await expect(page.locator("#roleAssignmentsCount")).toBeVisible();
    await expect(page.locator("#amoebasCount")).toHaveText("3");
    await expect(page.locator("#sitesCount")).not.toHaveText("0");
    await expect(page.locator('#amoebaRows input[data-field="name"][value="Island"]')).toBeVisible();
    await expect(page.locator('#siteRows input[data-field="name"][value*="Lekki"]').first()).toBeVisible();
  });

  test("creates and deactivates a scoped business-role assignment", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const unique = Date.now();
    const displayName = `Scope Test ${unique}`;
    await page.locator('#personForm input[name="display_name"]').fill(displayName);
    await page.locator('#personForm input[name="phone"]').fill(`+23481${String(unique).slice(-8)}`);
    await page.locator("#personForm").getByRole("button", { name: "Create person" }).click();
    await expect(page.locator("#notice")).toContainText("Person created.");

    await page.locator('#roleAssignmentForm select[name="person_id"]').selectOption({ label: displayName });
    await page.locator('#roleAssignmentForm select[name="role"]').selectOption("manager");
    await page.locator('#roleAssignmentForm select[name="scope_type"]').selectOption("amoeba");
    await page.locator('#roleAssignmentForm select[name="scope_id"]').selectOption("amoeba_mainland");
    await page.locator("#roleAssignmentForm").getByRole("button", { name: "Assign access" }).click();

    await expect(page.locator("#notice")).toContainText("Access assignment created.");
    const row = page.locator("#roleAssignmentRows tr").filter({ hasText: displayName });
    await expect(row).toContainText("Mainland");
    await row.locator('[data-field="status"]').selectOption("inactive");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Access assignment updated.");
    await expect(page.locator("#roleAssignmentRows tr").filter({ hasText: displayName }).locator('[data-field="status"]')).toHaveValue("inactive");
  });

  test("creates and updates a person through the Identity API", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const unique = Date.now();
    await page.locator('#personForm input[name="display_name"]').fill(`Console Test ${unique}`);
    await page.locator('#personForm input[name="phone"]').fill(`+23480${String(unique).slice(-8)}`);
    await page.locator("#personForm").getByRole("button", { name: "Create person" }).click();

    await expect(page.locator("#notice")).toContainText("Person created.");
    const row = page.locator(`#peopleRows input[data-field="display_name"][value="Console Test ${unique}"]`).locator("xpath=ancestor::tr");
    await expect(row).toBeVisible();
    await row.locator('[data-field="status"]').selectOption("inactive");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Person updated.");
    await expect(page.locator(`#peopleRows input[data-field="display_name"][value="Console Test ${unique}"]`).locator("xpath=ancestor::tr").locator('[data-field="status"]')).toHaveValue("inactive");
  });

  test("creates and updates an amoeba site through the Amoeba API", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const unique = Date.now();
    await page.locator('#siteForm select[name="amoeba_id"]').selectOption("amoeba_island");
    await page.locator('#siteForm input[name="name"]').fill(`Console Site ${unique}`);
    await page.locator('#siteForm input[name="gps_lat"]').fill("6.44");
    await page.locator('#siteForm input[name="gps_lng"]').fill("3.47");
    await page.locator('#siteForm input[name="alert_radius_m"]').fill("650");
    await page.locator("#siteForm").getByRole("button", { name: "Create site" }).click();

    await expect(page.locator("#notice")).toContainText("Site created.");
    const row = page.locator(`#siteRows input[data-field="name"][value="Console Site ${unique}"]`).locator("xpath=ancestor::tr");
    await expect(row).toBeVisible();
    await row.locator('[data-field="alert_radius_m"]').fill("700");
    await row.locator('[data-field="status"]').selectOption("inactive");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Site updated.");
    await expect(page.locator(`#siteRows input[data-field="name"][value="Console Site ${unique}"]`).locator("xpath=ancestor::tr").locator('[data-field="alert_radius_m"]')).toHaveValue("700");
  });

  test("mobile layout has no horizontal page overflow", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
