import { expect, test } from "@playwright/test";

test.describe("Supervisor Ops console", () => {
  const url = "/apps/ops-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";

  test("cockpit answers what needs action now", async ({ page }) => {
    await page.goto(url);
    await expect(page).toHaveTitle("Fleximotion Supervisor App");
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.locator("#paceGauge")).toBeVisible();
    await expect(page.locator("#utilisationGauge")).toBeVisible();
    await expect(page.locator("#closeoutGauge")).toBeVisible();
    await expect(page.locator("#utilisationGauge figcaption strong")).not.toHaveText("0%");
    await expect(page.locator("#carRevenueChip")).toContainText("Cars");
    await expect(page.locator("#bikeRevenueChip")).toContainText("Bikes");
    await expect(page.getByRole("heading", { name: "Do these first" })).toBeVisible();
    await expect(page.locator(".condition-card").first()).toBeVisible();
    await expect(page.locator(".dock a")).toHaveCount(7);
    await expect(page.getByText("Daily performance ingestion")).toHaveCount(0);
    await expect(page.getByText("API connection")).toHaveCount(0);
  });

  test("groups the operator board by state with tap-through detail", async ({ page }) => {
    await page.goto(`${url}#board`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const groups = page.locator("#teamBoard .board-group");
    expect(await groups.count()).toBeGreaterThan(0);
    await expect(page.locator(".group-count").first()).toBeVisible();

    const firstGroup = groups.first();
    if (!(await firstGroup.evaluate((node) => node.open))) await firstGroup.locator("summary").click();
    await firstGroup.locator(".operator-tile").first().click();
    await expect(page.locator("#operatorDialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's timeline" })).toBeVisible();
    await expect(page.locator("#operatorDialog .progress-track")).toBeVisible();
    await page.locator("[data-close-operator]").click();
    await expect(page.locator("#operatorDialog")).not.toBeVisible();
  });

  test("acknowledges an alert from the grouped queue", async ({ page }) => {
    await page.goto(`${url}#alerts`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const acknowledgeButtons = page.getByRole("button", { name: "Acknowledge" });
    const count = await acknowledgeButtons.count();
    if (count === 0) test.skip(true, "Persistent test DB already acknowledged seeded alerts.");
    await expect(page.locator("#alertList .board-group").first()).toBeVisible();
    await acknowledgeButtons.first().click();
    await expect(page.getByRole("heading", { name: "Acknowledge alert" })).toBeVisible();
    await page.locator("#dialogNotes").fill("Checked by Playwright.");
    await page.locator("#confirmActionButton").click();
    await expect(page.locator("#notice")).toContainText("acknowledged");
  });

  test("runs field operations: incidents, inspections and maintenance", async ({ page }) => {
    await page.goto(`${url}#field`);
    await expect(page.locator("#notice")).toContainText("Connected");

    await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vehicle inspections" })).toBeVisible();
    await expect(page.locator("#inspectionComplianceLabel")).toContainText(/vehicles inspected|No active vehicles/);

    const inspectionForm = page.locator("#inspectionForm");
    await inspectionForm.locator('select[name="vehicle_id"]').selectOption({ index: 0 });
    await inspectionForm.locator('input[name="odometer_km"]').fill("12345");
    await inspectionForm.locator('select[name="condition"]').selectOption("ok");
    await inspectionForm.getByRole("button", { name: "Submit inspection" }).click();
    await expect(page.locator("#notice")).toContainText("Inspection submitted");
    await expect(page.locator("#inspectionList .mileage-row").first()).toBeVisible();

    const maintenanceForm = page.locator("#maintenanceForm");
    await maintenanceForm.locator('select[name="vehicle_id"]').selectOption({ index: 0 });
    await maintenanceForm.locator('select[name="category"]').selectOption("tyres");
    await maintenanceForm.locator('input[name="description"]').fill("Front tyre worn");
    await maintenanceForm.getByRole("button", { name: "Report issue" }).click();
    await expect(page.locator("#notice")).toContainText("Maintenance issue reported");
    await expect(page.locator("#maintenanceList .alert-row").first()).toBeVisible();
  });

  test("shows the KPI strip and ranks drivers and vehicles with CSV export", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");

    // Cockpit KPI strip: raw range numbers at a glance.
    await expect(page.locator("#kpiStrip .kpi-cell")).toHaveCount(6);
    await expect(page.locator("#kpiStrip")).toContainText("Vehicles");
    await expect(page.locator("#kpiStrip")).toContainText("Earnings");

    // Quick-range chips are one tap.
    await page.locator("[data-quick-range='week']").click();
    await expect(page.locator("#notice")).toContainText(/Showing team activity/);

    await page.locator("[data-tab-link='board']").click();
    const driverTable = page.locator("#driverTable");
    await expect(driverTable.locator("tbody tr").first()).toBeVisible();
    await expect(driverTable).toContainText("Variance ₦");
    await expect(driverTable).toContainText("KM/L");

    // Column sort = ranking view.
    await driverTable.locator("th[data-sort-key='targetPct']").click();
    await expect(driverTable.locator("th.sorted")).toContainText("Target %");

    // Vehicle table carries the honest downtime placeholder.
    await page.getByText("Vehicle comparison table", { exact: true }).click();
    await expect(page.locator("#vehicleTable tbody tr").first()).toBeVisible();
    await expect(page.locator("#vehicleTable")).toContainText("Idle days");
    await expect(page.locator("#vehicleTable")).toContainText("awaiting tracker telemetry");

    const download = page.waitForEvent("download");
    await page.locator("#exportDriversCsv").click();
    expect((await download).suggestedFilename()).toMatch(/^drivers-.*\.csv$/);
  });

  test("rolls the range into a team summary with contribution", async ({ page }) => {
    await page.goto(`${url}#closeout`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Team summary" })).toBeVisible();
    const summaryCard = page.locator("#weeklySummary .closeout-card").first();
    await expect(summaryCard).toBeVisible();
    await expect(summaryCard).toContainText("Contribution");
    await expect(summaryCard).toContainText("Fuel ₦");

    const download = page.waitForEvent("download");
    await page.locator("#exportWeeklyCsv").click();
    expect((await download).suggestedFilename()).toMatch(/^team-summary-.*\.csv$/);
  });

  test("logs a supervisor incident with category, action and cost", async ({ page }) => {
    await page.goto(`${url}#field`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Log an incident", { exact: false }).click();
    const form = page.locator("#incidentForm");
    await form.locator('select[name="operator_id"]').selectOption({ index: 0 });
    await form.locator('select[name="incident_type"]').selectOption("customer_complaint");
    await form.locator('input[name="description"]').fill("Customer reported repeated late arrivals.");
    await form.locator('input[name="required_action"]').fill("Call the customer today.");
    await form.locator('input[name="cost_implication_ngn"]').fill("2500");
    await form.getByRole("button", { name: "Log incident" }).click();
    await expect(page.locator("#notice")).toContainText("Incident logged");
    await expect(page.locator("#incidentList")).toContainText("customer complaint");
    await expect(page.locator("#incidentList")).toContainText("Call the customer today.");
  });

  test("confirms fuel or charge with a unit choice", async ({ page }) => {
    await page.goto(`${url}#fuel`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Fuel & charge" })).toBeVisible();
    await expect(page.locator('#fuelIssueForm select[name="unit"] option[value="kWh"]')).toHaveCount(1);
    await expect(page.locator(".mileage-row").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm fuel" })).toBeVisible();
  });

  test("submits a structured daily closeout", async ({ page }) => {
    await page.goto(`${url}#closeout`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const cards = page.locator(".closeout-card");
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(page.locator(".closeout-checklist").first()).toBeVisible();

    const submitButton = page.locator("[data-submit-closeout]").first();
    if (await submitButton.count()) {
      await submitButton.click();
      await expect(page.locator("#notice")).toContainText("Closeout submitted");
      await expect(page.locator(".closeout-card.submitted").first()).toBeVisible();
    } else {
      await expect(page.locator(".closeout-card.submitted").first()).toBeVisible();
    }
  });

  test("runs the scheduled-delivery board", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator("[data-tab-link='deliveries']").click();
    await expect(page.getByRole("heading", { name: "Scheduled deliveries" })).toBeVisible();
    const batchGroups = page.locator("#deliveryList .board-group");
    expect(await batchGroups.count()).toBeGreaterThan(0);
    await expect(batchGroups.first()).toContainText("Konga");
    await expect(page.locator(".count-ladder").first()).toBeVisible();
    await expect(page.locator(".source-chip").first()).toContainText("customer app manual");
    await expect(page.locator(".assignment-row").first()).toBeVisible();
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
    await expect(page).toHaveTitle("Fleximotion Administrator Console");
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
    // Alerts are scoped to the From/To range; widen it so seeded alerts from
    // earlier operating days stay visible regardless of when the suite runs.
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await page.locator("#dateFrom").fill(from);
    await expect(page.locator("#notice")).toContainText("Showing operations");
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
    await expect(page.locator("#performanceRows")).toContainText("Choose a team");
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

  test("saves an efficiency policy version in place and closes the panel", async ({ page }) => {
    await page.goto(`${url}#controls`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const panel = page.locator("#efficiencyPolicyForm").locator("xpath=ancestor::details");
    await page.getByText("Update the efficiency policy for a vehicle type", { exact: true }).click();
    const form = page.locator("#efficiencyPolicyForm");
    await form.locator('input[name="price_per_unit_ngn"]').fill("1150");
    await form.getByRole("button", { name: "Save efficiency policy version" }).click();
    await expect(page.locator("#notice")).toContainText("efficiency policy saved");
    // The edit window closes so the click clearly landed.
    await expect(panel).not.toHaveAttribute("open", "");

    const rowCount = await page.locator("#efficiencyPolicyList .policy-row").count();

    // Saving again with the same effective date corrects in place — no
    // duplicate version rows.
    await page.getByText("Update the efficiency policy for a vehicle type", { exact: true }).click();
    await form.locator('input[name="price_per_unit_ngn"]').fill("1175");
    await form.getByRole("button", { name: "Save efficiency policy version" }).click();
    await expect(page.locator("#notice")).toContainText("efficiency policy saved");
    await expect(page.locator("#efficiencyPolicyList .policy-row")).toHaveCount(rowCount);
    await expect(page.locator("#efficiencyPolicyList")).toContainText("₦1,175");
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
