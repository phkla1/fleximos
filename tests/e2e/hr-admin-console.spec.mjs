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

  test("configures the Flexi Points programme from the Ops API", async ({ page }) => {
    // This panel reaches the Ops API (4530 in e2e), not foundation.
    await page.goto(`${adminUrl}&opsApiBase=http://127.0.0.1:4530#flexi-points`);
    await expect(page.locator("#flexiPointsConn")).toHaveText("Live from Ops API");
    const summary = page.locator("#flexiPointsConfigSummary");
    await expect(summary).toContainText("Earn a bike");
    await expect(summary).toContainText("624 points");
    // The guardrail copy never uses the word "ownership".
    await expect(page.locator("#flexi-points")).not.toContainText(/ownership/i);

    // Save a change and confirm it round-trips through the Ops API.
    const form = page.locator("#flexiPointsConfigForm");
    await page.locator('#flexi-points .create > summary').click();
    const step = form.locator('input[name="accelerator_step_ngn"]');
    await step.fill("5000");
    await form.locator('button[type="submit"]').click();
    await expect(page.locator("#notice")).toContainText("Flexi Points programme saved");
    await expect(summary).toContainText("₦5,000");

    // Restore the default so the shared demo DB is left as found.
    await step.fill("6000");
    await form.locator('button[type="submit"]').click();
    await expect(page.locator("#notice")).toContainText("Flexi Points programme saved");
    await expect(summary).toContainText("₦6,000");
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

  test("imports, lists and deactivates an HMO facility (Ops-API-backed)", async ({ page }) => {
    // The HMO directory is served from the Ops API (4530 in e2e), like Flexi Points.
    await page.goto(`${adminUrl}&opsApiBase=http://127.0.0.1:4530#hmo-facilities`);
    await expect(page.getByRole("heading", { name: "HMO facilities" })).toBeVisible();
    await expect(page.locator("#hospitalConn")).toContainText("facilities");

    // Import a facility via the HR console's own import panel.
    const name = `E2E HMO ${Date.now().toString().slice(-7)}`;
    const csv = [
      "name,provider_type,address,state,lga,phone,lat,lng,coords_quality",
      `${name},Dentist,1 Test Road Ikeja,Lagos,Ikeja,08030000000,6.6018,3.3515,street`
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
    await expect(commit).toBeDisabled();

    // It appears in the directory and is reachable via the type filter.
    const row = page.locator("#hospitalRows tr").filter({ hasText: name });
    await expect(row).toBeVisible();
    await page.locator("#hospitalTypeFilter").selectOption("Dentist");
    await expect(page.locator("#hospitalRows tr").filter({ hasText: name })).toBeVisible();
    await page.locator("#hospitalTypeFilter").selectOption("");

    // Deactivating goes through the confirm dialog and drops it from the default view.
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.locator("#confirmDialog")).toBeVisible();
    await page.locator("#confirmButton").click();
    await expect(page.locator("#notice")).toContainText("deactivated");
    await expect(page.locator("#hospitalRows tr").filter({ hasText: name })).toHaveCount(0);

    // "Show deactivated" brings it back, with a Reactivate action.
    await page.locator("#hospitalInactiveToggle").check();
    await expect(page.locator("#hospitalRows tr").filter({ hasText: name })).toBeVisible();
  });

  test("mobile layout has no horizontal page overflow", async ({ page }) => {
    await page.goto(adminUrl);
    await expect(page.locator("#notice")).toContainText("Connected");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
