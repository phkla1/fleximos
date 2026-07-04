import { expect, test } from "@playwright/test";

test.describe("Supervisor Ops console", () => {
  const url = "/apps/ops-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

  test("shows only supervisor operational surfaces", async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle("Fleximotion Ops");
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.locator("#activeOperatorCount")).not.toHaveText("0");
    await expect(page.locator("#liveOperatorCount")).toBeVisible();
    await expect(page.locator("#carRevenueTotal")).toBeVisible();
    await expect(page.locator("#bikeRevenueTotal")).toBeVisible();
    await expect(page.getByText(/(Car|Bike) · (Bolt Lagos|Uber Ride-Hailing|Uber Courier)/).first()).toBeVisible();
    await expect(page.getByText(/Expected (now|by close)/).first()).toBeVisible();
    await expect(page.locator(".pace-status").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team board" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alert inbox" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operator performance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fuel and mileage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm fuel" })).toBeVisible();
    await expect(page.locator(".mileage-row").first()).toBeVisible();
    await expect(page.getByText("Daily performance ingestion")).toHaveCount(0);
    await expect(page.getByText("API connection")).toHaveCount(0);
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

test.describe("Ops admin console", () => {
  const url = "/apps/ops-admin-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

  test("keeps ingestion and roster controls out of the supervisor workspace", async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle("Fleximotion Ops Admin");
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Manual data entry" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operators" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Targets, fuel and mileage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Revenue pace profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vehicle efficiency policy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily reports" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data health" })).toBeVisible();
    await expect(page.getByText("15 registered jobs")).toBeVisible();
    await expect(page.locator(".job-row")).toHaveCount(15);
  });

  test("summarises teams before exposing individual operators", async ({ page }) => {
    await page.goto(`${url}#team`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Team summary" })).toBeVisible();
    await expect(page.locator("#teamBoard .operator-tile")).toHaveCount(0);

    const teams = page.locator("#teamBoard .team-summary");
    expect(await teams.count()).toBeGreaterThan(0);
    await teams.first().getByRole("button", { name: "Open team" }).click();
    await expect(page.locator("#teamDialog")).toBeVisible();
    await expect(page.locator("#teamOperatorList .team-operator-row").first()).toBeVisible();
  });

  test("groups alerts and drills into affected operators", async ({ page }) => {
    await page.goto(`${url}#alerts`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator("#alertFilter").selectOption("");
    const alertGroups = page.locator("#alertList .alert-group");
    expect(await alertGroups.count()).toBeGreaterThan(0);
    await expect(alertGroups.first()).toContainText(/active operators affected/);
    await alertGroups.first().getByRole("button", { name: "View affected operators" }).click();
    await expect(page.locator("#alertGroupDialog")).toBeVisible();
    await expect(page.locator("#alertGroupList .alert-detail-row").first()).toBeVisible();
  });

  test("uses friendly operators and team-first performance history", async ({ page }) => {
    await page.goto(`${url}#ingestion`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Enter a performance record", { exact: true }).click();
    const operatorText = await page.locator('#ingestionForm select[name="operator_id"] option').first().textContent();
    expect(operatorText).not.toMatch(/^person_/);

    await page.getByText("View performance records", { exact: true }).click();
    await expect(page.locator("#performanceTeamFilter")).toBeVisible();
    await expect(page.locator("#performanceOperatorFilter")).toHaveValue("");
    await expect(page.locator("#performanceRows")).toContainText("Choose a team and operator");
    await page.locator("#performanceTeamFilter").selectOption({ index: 1 });
    expect(await page.locator("#performanceOperatorFilter option").count()).toBeGreaterThan(1);
    await page.locator("#performanceOperatorFilter").selectOption({ index: 1 });
    expect(await page.locator("#performanceRows tr").count()).toBeGreaterThan(0);
    await expect(page.getByText("View platform import runs", { exact: true })).toBeVisible();
  });

  test("scopes the vehicle list before showing fleet assets", async ({ page }) => {
    await page.goto(`${url}#vehicles`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage fleet assets", { exact: true }).click();
    await expect(page.locator("#vehicleList")).toContainText("Choose a fleet scope");
    await expect(page.locator("#vehicleList .data-row")).toHaveCount(0);

    await page.locator("#vehicleAmoebaFilter").selectOption({ index: 1 });
    expect(await page.locator("#vehicleList .data-row").count()).toBeGreaterThan(0);
    await expect(page.locator("#vehicleFilterSummary")).toContainText("matching active");

    await page.locator("#vehicleSearch").fill("NO-MATCHING-PLATE");
    await expect(page.locator("#vehicleList")).toContainText("No vehicles match this scope");
  });

  test("scopes the operator roster before showing operators", async ({ page }) => {
    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await expect(page.locator("#operatorList")).toContainText("Choose a roster scope");
    await expect(page.locator("#operatorList .data-row")).toHaveCount(0);

    await page.locator("#operatorAmoebaFilter").selectOption({ index: 1 });
    expect(await page.locator("#operatorList .data-row").count()).toBeGreaterThan(0);
    await expect(page.locator("#operatorFilterSummary")).toContainText("matching active");

    await page.locator("#operatorSearch").fill("NO-MATCHING-OPERATOR");
    await expect(page.locator("#operatorList")).toContainText("No operators match this scope");
  });

  test("loads the selected vehicle pace profile into the form", async ({ page }) => {
    await page.goto(`${url}#controls`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Add or change a pace profile", { exact: true }).click();
    const form = page.locator("#paceProfileForm");
    await expect(form.locator('input[name="daily_target_ngn"]')).toHaveValue("60000");
    await form.locator('select[name="vehicle_type"]').selectOption("motorbike");
    await expect(form.locator('input[name="daily_target_ngn"]')).toHaveValue("27000");
    await expect(form.locator('input[name="noon_pct"]')).toHaveValue("40");
    await expect(form.locator('input[name="afternoon_pct"]')).toHaveValue("65");
    await expect(form.locator('input[name="evening_pct"]')).toHaveValue("90");
  });

  test("queues a scoped scheduled-job replay", async ({ page }) => {
    await page.goto(`${url}#data-health`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("View scheduled jobs", { exact: true }).click();
    const job = page.locator(".job-row").filter({ hasText: "daily-report-generate" });
    await job.getByRole("button", { name: "Replay" }).click();
    await expect(page.locator("#notice")).toContainText("queued");
    await expect(page.locator("#scheduledJobRuns")).toContainText("daily-report-generate");
  });

  test("generates, opens, and downloads a daily report", async ({ page }) => {
    await page.goto(`${url}#reports`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator("#reportForm").getByRole("button", { name: "Generate report" }).click();
    await expect(page.locator("#notice")).toContainText("Daily report generated");
    await expect(page.locator("#reportList .report-row").first()).toBeVisible();

    await page.locator("#reportList .report-row").first().getByRole("button", { name: "Open report" }).click();
    await expect(page.locator("#reportDialog")).toBeVisible();
    await expect(page.locator("#reportDialogRows tr").first()).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#reportDialog").getByRole("button", { name: "Download CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^fleximotion-ops-.*\.csv$/);
  });

  test("submits a connector test record", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Enter a performance record", { exact: true }).click();
    await page.locator('#ingestionForm input[name="ride_revenue_ngn"]').fill("27500");
    await page.locator('#ingestionForm select[name="current_status"]').selectOption("online");
    await page.locator("#ingestionForm").getByRole("button", { name: "Save performance record" }).click();
    await expect(page.locator("#notice")).toContainText("1 record accepted");
  });
});
