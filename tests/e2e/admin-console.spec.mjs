import { expect, test } from "@playwright/test";

test.describe("admin console", () => {
  const adminUrl = "/apps/admin-console/?apiBase=http://127.0.0.1:4510";

  test("loads foundation data and reads cleanly (no raw IDs, no dev chrome)", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page).toHaveTitle("Fleximotion Admin Console");
    await expect(page.getByRole("heading", { name: "Identity & organisation" })).toBeVisible();
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.locator("#peopleCount")).not.toHaveText("0");
    await expect(page.locator("#amoebasCount")).toHaveText("3");
    await expect(page.locator("#sitesCount")).not.toHaveText("0");

    // Amoeba rows are read-only cards by default (not a wall of inputs).
    await expect(page.locator("#amoebaRows")).toContainText("Island");
    await expect(page.locator("#amoebaRows tr").first().locator("input")).toHaveCount(0);
    // The connection chrome is tucked away, not in the header.
    await expect(page.locator(".rail-foot .advanced")).toBeAttached();
    await expect(page.locator("#apiBase")).not.toBeVisible();
  });

  test("creates, edits and deactivates a person", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const unique = Date.now();
    const name = `Console Test ${unique}`;
    await page.locator("#people .create > summary").click({ force: true });
    await page.locator('#personForm input[name="display_name"]').fill(name);
    await page.locator('#personForm input[name="phone"]').fill(`+23480${String(unique).slice(-8)}`);
    await page.locator("#personForm").getByRole("button", { name: "Create person" }).click();
    await expect(page.locator("#notice")).toContainText("Person created.");

    // Row shows read-only; Edit opens inputs.
    const row = page.locator("#peopleRows tr").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit" }).click();
    // In edit mode the name becomes an input value, so re-locate the row by it.
    const editRow = page.locator("#peopleRows tr").filter({ has: page.locator(`input[data-field="display_name"][value="${name}"]`) });
    await editRow.locator('input[data-field="email"]').fill(`console${unique}@fleximotion.online`);
    await editRow.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Person updated.");
    await expect(page.locator("#peopleRows tr").filter({ hasText: name })).toContainText(`console${unique}@fleximotion.online`);

    // Deactivate goes through the confirm dialog.
    await page.locator("#peopleRows tr").filter({ hasText: name }).getByRole("button", { name: "Deactivate" }).click();
    await expect(page.locator("#confirmDialog")).toBeVisible();
    await page.locator("#confirmButton").click();
    await expect(page.locator("#notice")).toContainText("deactivated");
    await expect(page.locator("#peopleRows tr").filter({ hasText: name })).toContainText("inactive");
  });

  test("filters people by search and status", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    const total = await page.locator("#peopleRows tr").count();
    await page.locator('[data-search="people"]').fill("zzz-no-such-person");
    await expect(page.locator("#peopleRows")).toContainText("No people match this view.");
    await page.locator('[data-search="people"]').fill("");
    await expect(page.locator("#peopleRows tr")).toHaveCount(total);
  });

  test("creates and deactivates a scoped access grant", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");

    const unique = Date.now();
    const name = `Scope Test ${unique}`;
    await page.locator("#people .create > summary").click({ force: true });
    await page.locator('#personForm input[name="display_name"]').fill(name);
    await page.locator('#personForm input[name="phone"]').fill(`+23481${String(unique).slice(-8)}`);
    await page.locator("#personForm").getByRole("button", { name: "Create person" }).click();
    await expect(page.locator("#notice")).toContainText("Person created.");

    await page.locator("#access-assignments .create > summary").click({ force: true });
    await page.locator('#roleAssignmentForm select[name="person_id"]').selectOption({ label: name });
    await page.locator('#roleAssignmentForm select[name="role"]').selectOption("manager");
    await page.locator('#roleAssignmentForm select[name="scope_type"]').selectOption("amoeba");
    await page.locator('#roleAssignmentForm select[name="scope_id"]').selectOption("amoeba_mainland");
    await page.locator("#roleAssignmentForm").getByRole("button", { name: "Assign access" }).click();
    await expect(page.locator("#notice")).toContainText("Access grant created.");

    const row = page.locator("#roleAssignmentRows tr").filter({ hasText: name });
    await expect(row).toContainText("Mainland");
    await row.getByRole("button", { name: "Deactivate" }).click();
    await page.locator("#confirmButton").click();
    await expect(page.locator("#notice")).toContainText("deactivated");
  });

  test("mobile layout has no horizontal page overflow", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
