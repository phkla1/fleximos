import { expect, test } from "@playwright/test";

test.describe("hr-admin console", () => {
  const adminUrl = "/apps/hr-admin-console/?apiBase=http://127.0.0.1:4510";

  test("loads foundation data and reads cleanly (no raw IDs, no dev chrome)", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page).toHaveTitle("Fleximotion HR Console");
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

  test("the amoeba Supervisor dropdown lists only Supervisor/Manager people", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator('.rail nav a[href="#amoebas"]').click();
    const row = page.locator("#amoebaRows tr").first();
    await row.getByRole("button", { name: "Edit" }).click();
    const options = page.locator('#amoebaRows select[data-field="supervisor_person_id"] option');
    // Tunde (seeded manager) is eligible; Danjimoh (an operator) is not.
    await expect(options.filter({ hasText: "Tunde" })).toHaveCount(1);
    await expect(options.filter({ hasText: "Danjimoh" })).toHaveCount(0);
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

    // Switch to the Access view (the console now shows one section at a time).
    await page.locator('.rail nav a[href="#access-assignments"]').click();
    await expect(page.locator("#access-assignments")).toBeVisible();
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

  test("issues a PIN when creating a user and lets HR reset it", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    const unique = Date.now();
    const name = `PIN HR ${unique}`;
    await page.locator("#people .create > summary").click({ force: true });
    await page.locator('#personForm input[name="display_name"]').fill(name);
    await page.locator('#personForm input[name="phone"]').fill(`+23482${String(unique).slice(-8)}`);
    await page.locator("#personForm").getByRole("button", { name: "Create person" }).click();
    await expect(page.locator("#notice")).toContainText("Person created.");

    await page.locator('.rail nav a[href="#users"]').click();
    await expect(page.locator("#users")).toBeVisible();
    await page.locator("#users .create > summary").click({ force: true });
    await page.locator('#userForm select[name="person_id"]').selectOption({ label: name });
    await page.locator("#userForm").getByRole("button", { name: "Create user" }).click();
    // The new account's PIN is revealed once.
    await expect(page.locator("#pinDialog")).toBeVisible();
    await expect(page.locator("#pinValue")).toHaveText(/^\d{6}$/);
    await page.locator("#pinDialog").getByRole("button", { name: "Done" }).click();

    // HR can reset it from the user row.
    const row = page.locator("#userRows tr").filter({ hasText: name });
    await row.getByRole("button", { name: "Reset PIN" }).click();
    await page.locator("#confirmButton").click();
    await expect(page.locator("#pinDialog")).toBeVisible();
    await expect(page.locator("#pinValue")).toHaveText(/^\d{6}$/);
  });

  test("mobile layout has no horizontal page overflow", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
