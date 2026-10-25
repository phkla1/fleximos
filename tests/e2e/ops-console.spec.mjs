import { readFile } from "node:fs/promises";
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
    await expect(page.locator("#notice")).toContainText(/Showing amoeba activity/);

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

    // Calculation integrity: the rendered arithmetic must reconcile.
    const naira = (text) => Number(String(text).replace(/[^\d.-]/g, "")) || 0;
    const firstRow = driverTable.locator("tbody tr").first();
    const cells = await firstRow.locator("td").allTextContents();
    const [/*name*/, /*plate*/, target, earnings, variance, targetPct] = cells;
    expect(Math.abs(naira(variance) - (naira(earnings) - naira(target)))).toBeLessThanOrEqual(1);
    if (naira(target) > 0) {
      expect(Math.abs(naira(targetPct) - Math.round(naira(earnings) / naira(target) * 100))).toBeLessThanOrEqual(1);
    }
    // Zero divisions must never leak into the UI.
    for (const tab of ["cockpit", "board", "closeout"]) {
      await page.evaluate((name) => { location.hash = `#${name}`; }, tab);
      expect(await page.locator(`[data-tab='${tab}']`).textContent()).not.toMatch(/NaN|Infinity/);
    }
    await page.evaluate(() => { location.hash = "#board"; });

    // Export validation: the CSV mirrors the table, row for row.
    const download = page.waitForEvent("download");
    await page.locator("#exportDriversCsv").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^drivers-.*\.csv$/);
    const csv = await readFile(await file.path(), "utf8");
    const csvLines = csv.trim().split("\n");
    expect(csvLines.length).toBe(await driverTable.locator("tbody tr").count() + 1);
    expect(csvLines[0]).toContain("Variance ₦");
    expect(csv).toContain(cells[0].trim());
  });

  test("rolls the range into a team summary with contribution", async ({ page }) => {
    await page.goto(`${url}#closeout`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Amoeba summary" })).toBeVisible();
    const summaryCard = page.locator("#weeklySummary .closeout-card").first();
    await expect(summaryCard).toBeVisible();
    await expect(summaryCard).toContainText("Contribution");
    await expect(summaryCard).toContainText("Fuel ₦");

    const download = page.waitForEvent("download");
    await page.locator("#exportWeeklyCsv").click();
    expect((await download).suggestedFilename()).toMatch(/^amoeba-summary-.*\.csv$/);
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
    await expect(page.locator("#mileageList .mileage-row").first()).toBeVisible();
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
      // Critical exceptions require an explanatory note before submit.
      const card = page.locator(".closeout-card").filter({ has: submitButton }).first();
      await card.locator("[data-closeout-note]").fill("End-of-day note from Playwright: open items handed to the manager.");
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

  test("offers the Speedaf import panel on the deliveries tab", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator("[data-tab-link='deliveries']").click();
    await page.getByText("Import Speedaf export (.xlsx)").click();
    await expect(page.locator("#importFile")).toBeVisible();
    await expect(page.locator("#importCustomer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import export" })).toBeVisible();
  });

  test("surfaces an operator check-in for approval on the cockpit", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const headers = { Authorization: "Bearer flexi-dev-service-token", "Content-Type": "application/json" };
    const roster = await request.get(`${opsBase}/ops/v1/operators`, { headers });
    const rosterRows = (await roster.json()).data;
    // Pick an operator on the default supervisor's (person_founder_wole) team so
    // the check-in lands in that cockpit's scope.
    const operator = rosterRows.find((row) => row.operator_status === "active" && row.supervisor_person_id === "person_founder_wole")
      || rosterRows.find((row) => row.operator_status === "active");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
    await request.post(`${opsBase}/ops/v1/checkins`, {
      headers: { ...headers, "Idempotency-Key": `e2e-checkin-${Date.now()}` },
      data: { operator_id: operator.operator_id, gps_lat: 6.44487, gps_lng: 3.47798, check_in_date: today }
    });
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    // The check-in lands in the supervisor's scope: the panel renders and,
    // when a pending row is present, exposes an Approve action that resolves it.
    const approvals = page.locator("#checkinApprovals");
    await expect(approvals).toContainText("Check-ins");
    const approveButton = approvals.getByRole("button", { name: "Approve" });
    if (await approveButton.count()) {
      await approveButton.first().click();
      await expect(approvals).toContainText(/approved today/i);
    }
  });

  test("shows the live vehicle map with remote power control", async ({ page, request }) => {
    // The demo vehicle's operator sits in Island; its supervisor is now derived
    // from the amoeba. Act as Island's supervisor so the fixture-backed position
    // is inside the actor's scope. Force an operator read first so the derived
    // supervisor is materialised before the map's positions are scoped.
    const opsBase = "http://127.0.0.1:4530";
    const foundationBase = "http://127.0.0.1:4510";
    const headers = { Authorization: "Bearer flexi-dev-service-token", "Content-Type": "application/json", "X-Actor-Person-Id": "person_founder_wole" };
    const amoebas = (await (await request.get(`${foundationBase}/amoeba/v1/amoebas`, { headers })).json()).data;
    let islandSupervisor = amoebas.find((a) => a.amoeba_id === "amoeba_island")?.supervisor_person_id;
    if (!islandSupervisor) {
      islandSupervisor = "person_founder_wole";
      await request.post(`${foundationBase}/amoeba/v1/amoebas/amoeba_island/assign-supervisor`, {
        headers: { ...headers, "Idempotency-Key": `e2e-island-sup-map-${Date.now()}` },
        data: { supervisor_person_id: islandSupervisor }
      });
    }
    await request.get(`${opsBase}/ops/v1/operators`, { headers });

    await page.goto(`${url}&actorPersonId=${islandSupervisor}#board`);
    await expect(page.locator("#notice")).toContainText("Connected");

    await page.locator("#boardMapToggle").click();
    await expect(page.locator("#boardMapView")).toBeVisible();
    await expect(page.locator("#teamBoard")).toBeHidden();
    await expect(page.locator("#mapStatus")).toContainText("reporting a position");
    const row = page.locator("#mapPositionList .mileage-row").filter({ hasText: "FLEXI-001" });
    await expect(row).toContainText("moving");
    await expect(row).toContainText("discharging");
    await expect(page.locator("#mapNoFeed")).toBeVisible();

    // Power-off on a moving bike surfaces the stolen-vehicle override.
    await row.getByRole("button", { name: "⛔ Power off" }).click();
    await expect(page.locator("#controlDialog")).toBeVisible();
    await expect(page.locator("#controlOverrideField")).toBeVisible();
    await page.locator("#controlReason").fill("Bike reported stolen — e2e drill.");
    await page.locator("#controlOverride").check();
    await page.locator("#confirmControlButton").click();
    await expect(page.locator("#notice")).toContainText("power cut");

    // Restore needs no override.
    await page.locator("#boardMapToggle").click();
    const restoreRow = page.locator("#mapPositionList .mileage-row").filter({ hasText: "FLEXI-001" });
    await restoreRow.getByRole("button", { name: "▶ Power on" }).click();
    await expect(page.locator("#controlOverrideField")).toBeHidden();
    await page.locator("#controlReason").fill("Recovered — e2e drill.");
    await page.locator("#confirmControlButton").click();
    await expect(page.locator("#notice")).toContainText("power restored");

    await page.locator("#boardListToggle").click();
    await expect(page.locator("#teamBoard")).toBeVisible();
  });

  test("shows the resumption-aware pace war-room board", async ({ page }) => {
    await page.goto(`${url}&actorPersonId=person_founder_wole#board`);
    await expect(page.locator("#notice")).toContainText("Connected");

    await page.locator("#boardPaceToggle").click();
    await expect(page.locator("#boardPaceView")).toBeVisible();
    await expect(page.locator("#teamBoard")).toBeHidden();
    await expect(page.locator("#boardPaceView")).toContainText("Call-time briefing");
    // At least one rider tile (or the empty state) renders.
    const paceContent = page.locator("#paceBoard .pace-tile, #paceBoard .empty");
    await expect(paceContent.first()).toBeVisible();

    await page.locator("#boardListToggle").click();
    await expect(page.locator("#teamBoard")).toBeVisible();
    await expect(page.locator("#boardPaceView")).toBeHidden();
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
    await expect(page).toHaveTitle("Fleximotion Operations Administration");
    await expect(page.locator("#notice")).toContainText("Connected");
    // The admin console exposes management surfaces the supervisor app hides,
    // reachable from the sidebar (one view at a time).
    for (const hash of ["#ingestion", "#operators", "#vehicles", "#controls", "#reports", "#data-health", "#onboarding"]) {
      await expect(page.locator(`.rail nav a[href="${hash}"]`)).toBeVisible();
    }
    await page.locator('.rail nav a[href="#controls"]').click();
    await expect(page.getByRole("heading", { name: "Revenue pace profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vehicle efficiency policy" })).toBeVisible();
    await page.locator('.rail nav a[href="#data-health"]').click();
    await expect(page.getByRole("heading", { name: "Data health" })).toBeVisible();
    await expect(page.getByText("16 registered jobs")).toBeVisible();
    await expect(page.locator(".job-row")).toHaveCount(16);
  });

  test("summarises teams before exposing individual operators", async ({ page }) => {
    await page.goto(`${url}#team`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await expect(page.getByRole("heading", { name: "Amoeba summary" })).toBeVisible();
    await expect(page.locator("#teamBoard .operator-tile")).toHaveCount(0);

    const teams = page.locator("#teamBoard .team-summary");
    expect(await teams.count()).toBeGreaterThan(0);
    await teams.first().getByRole("button", { name: "Open amoeba" }).click();
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
    await expect(page.locator("#performanceAmoebaFilter")).toBeVisible();
    await expect(page.locator("#performanceOperatorFilter")).toHaveValue("");
    await expect(page.locator("#performanceRows")).toContainText("Choose an amoeba");
    await page.locator("#performanceAmoebaFilter").selectOption({ index: 1 });
    expect(await page.locator("#performanceOperatorFilter option").count()).toBeGreaterThan(1);
    await page.locator("#performanceOperatorFilter").selectOption({ index: 1 });
    expect(await page.locator("#performanceRows tr").count()).toBeGreaterThan(0);
    // The technical import-run audit lives under Data health.
    await page.locator('.rail nav a[href="#data-health"]').click();
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
    // Each fleet row shows who holds the vehicle, or "Unassigned".
    await expect(page.locator("#vehicleList .data-row").first()).toContainText("Operator");

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

  test("shows an operator's supervisor as derived from the amoeba (read-only, no dropdown)", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const foundationBase = "http://127.0.0.1:4510";
    const headers = {
      Authorization: "Bearer flexi-dev-service-token",
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole"
    };
    // Make Tunde the supervisor of the Island amoeba, then create a rider there.
    const people = (await (await request.get(`${foundationBase}/identity/v1/people`, { headers })).json()).data;
    const tunde = people.find((p) => p.display_name.toLowerCase() === "tunde");
    expect(tunde, "seeded manager Tunde should exist").toBeTruthy();
    await request.post(`${foundationBase}/amoeba/v1/amoebas/amoeba_island/assign-supervisor`, {
      headers: { ...headers, "Idempotency-Key": `e2e-island-sup-${Date.now()}` },
      data: { supervisor_person_id: tunde.person_id }
    });
    const unique = Date.now();
    const created = await (await request.post(`${opsBase}/ops/v1/operators`, {
      headers: { ...headers, "Idempotency-Key": `e2e-derive-op-${unique}` },
      data: { person_id: `person_e2e_derive_${unique}`, operator_type: "rider", operator_status: "active", amoeba_id: "amoeba_island", site_id: "site_island_1" }
    })).json();
    const operatorId = created.operator_id || created.data?.operator_id;

    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await page.locator("#operatorAmoebaFilter").selectOption("amoeba_island");

    // No per-operator supervisor dropdown; the row shows the amoeba's supervisor.
    const row = page.locator(`[data-operator-id="${operatorId}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator("[data-operator-supervisor]")).toHaveCount(0);
    await expect(row.locator("[data-operator-supervisor-note]")).toContainText("Tunde");
    // The add-operator form no longer has a Supervisor field either.
    await expect(page.locator('#operatorForm select[name="supervisor_person_id"]')).toHaveCount(0);
  });

  test("reassigns an operator inline — amoeba, site and target — and persists it", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const headers = {
      Authorization: "Bearer flexi-dev-service-token",
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole"
    };
    // Create a fresh operator in Mainland so the test owns its state — it never
    // mutates a seeded operator (reassignment clears the amoeba-scoped vehicle,
    // which would otherwise poison the persistent e2e DB for later runs).
    const unique = Date.now();
    const created = await (await request.post(`${opsBase}/ops/v1/operators`, {
      headers: { ...headers, "Idempotency-Key": `e2e-reassign-op-${unique}` },
      data: { person_id: `person_e2e_reassign_${unique}`, operator_type: "rider", operator_status: "active", amoeba_id: "amoeba_mainland", site_id: "site_mainland_2" }
    })).json();
    const operatorId = created.operator_id || created.data?.operator_id;
    expect(operatorId).toBeTruthy();

    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await page.locator("#operatorAmoebaFilter").selectOption("amoeba_mainland");

    const row = page.locator(`[data-operator-id="${operatorId}"]`);
    await expect(row).toBeVisible();

    // Move the operator to the Island amoeba; the row's Site and Supervisor
    // re-scope to that amoeba (Island sites appear).
    await row.locator("[data-operator-amoeba]").selectOption("amoeba_island");
    await expect(row.locator('[data-operator-site] option[value="site_island_1"]')).toHaveCount(1);
    await row.locator("[data-operator-site]").selectOption("site_island_1");
    await row.locator("[data-operator-target]").fill("31500");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Operator updated.");

    // The change persisted exactly as entered.
    const saved = await (await request.get(`${opsBase}/ops/v1/operators/${operatorId}`, { headers })).json();
    expect(saved.amoeba_id).toBe("amoeba_island");
    expect(saved.site_id).toBe("site_island_1");
    expect(Number(saved.daily_revenue_target_ngn)).toBe(31500);
  });

  test("registers a platform through a dialog with inline feedback, not a browser prompt", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const headers = {
      Authorization: "Bearer flexi-dev-service-token",
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole"
    };
    // A fresh operator (unique person) starts with no registrations, so adding one
    // can never hit the "already registered for this account" conflict on re-runs.
    const unique = Date.now();
    const created = await (await request.post(`${opsBase}/ops/v1/operators`, {
      headers: { ...headers, "Idempotency-Key": `e2e-platform-operator-${unique}` },
      data: { person_id: `person_e2e_platform_${unique}`, operator_type: "driver", operator_status: "active", amoeba_id: "amoeba_island", site_id: "site_island_1" }
    })).json();
    const operatorId = created.operator_id || created.data?.operator_id;
    expect(operatorId).toBeTruthy();

    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await page.locator("#operatorAmoebaFilter").selectOption("amoeba_island");

    const row = page.locator(`[data-operator-id="${operatorId}"]`);
    await expect(row).toBeVisible();

    // No window.prompt — a real dialog opens with a platform dropdown and a field.
    const dialog = page.locator("#platformDialog");
    await expect(dialog).toBeHidden();
    await row.getByRole("button", { name: "Add platform" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select[name="platform_account_id"] option').first()).toBeAttached();

    await dialog.locator('select[name="platform_account_id"]').selectOption("platform_bolt_lagos");
    await dialog.locator('input[name="platform_operator_id"]').fill(`bolt-${unique}`);
    await dialog.getByRole("button", { name: "Add platform" }).click();

    // Inline confirmation, right where the user is looking.
    await expect(dialog.locator("#platformDialogResult")).toContainText("Added on Bolt Lagos");

    // It really persisted.
    const saved = await (await request.get(`${opsBase}/ops/v1/operators/${operatorId}`, { headers })).json();
    expect(saved.platform_registrations.length).toBe(1);

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  });

  test("assigns a vehicle to an operator inline and blocks double-booking it", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const headers = {
      Authorization: "Bearer flexi-dev-service-token",
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole"
    };
    const unique = Date.now();
    // A free vehicle in the Island amoeba, plus two fresh active operators there.
    const vehicle = await (await request.post(`${opsBase}/ops/v1/vehicles`, {
      headers: { ...headers, "Idempotency-Key": `e2e-vehicle-${unique}` },
      data: { plate: `E2EV${String(unique).slice(-6)}`, vehicle_type: "motorbike", amoeba_id: "amoeba_island" }
    })).json();
    const vehicleId = vehicle.vehicle_id || vehicle.data?.vehicle_id;
    expect(vehicleId).toBeTruthy();

    const makeOperator = async (suffix) => {
      const created = await (await request.post(`${opsBase}/ops/v1/operators`, {
        headers: { ...headers, "Idempotency-Key": `e2e-vehicle-op-${unique}-${suffix}` },
        data: { person_id: `person_e2e_vehicle_${unique}_${suffix}`, operator_type: "rider", operator_status: "active", amoeba_id: "amoeba_island", site_id: "site_island_1" }
      })).json();
      return created.operator_id || created.data?.operator_id;
    };
    const operatorId = await makeOperator("a");
    const rivalId = await makeOperator("b");
    expect(operatorId && rivalId).toBeTruthy();

    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await page.locator("#operatorAmoebaFilter").selectOption("amoeba_island");

    // The free vehicle is offered in the row; assign it and save.
    const row = page.locator(`[data-operator-id="${operatorId}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator(`[data-operator-vehicle] option[value="${vehicleId}"]`)).toHaveCount(1);
    await row.locator("[data-operator-vehicle]").selectOption(vehicleId);
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Operator updated.");

    const saved = await (await request.get(`${opsBase}/ops/v1/operators/${operatorId}`, { headers })).json();
    expect(saved.vehicle_id).toBe(vehicleId);

    // The now-taken vehicle disappears from another active operator's row...
    const rivalRow = page.locator(`[data-operator-id="${rivalId}"]`);
    await expect(rivalRow).toBeVisible();
    await expect(rivalRow.locator(`[data-operator-vehicle] option[value="${vehicleId}"]`)).toHaveCount(0);

    // ...and the API refuses a direct double-booking.
    const conflict = await request.patch(`${opsBase}/ops/v1/operators/${rivalId}`, {
      headers: { ...headers, "Idempotency-Key": `e2e-vehicle-conflict-${unique}` },
      data: { vehicle_id: vehicleId }
    });
    expect(conflict.status()).toBe(409);
  });

  test("saves an efficiency policy version in place and closes the panel", async ({ page }) => {
    await page.goto(`${url}#controls`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const panel = page.locator("#efficiencyPolicyPanel");
    await panel.locator("> summary").click();
    const form = page.locator("#efficiencyPolicyForm");
    // The current version is loaded, so the form is in "correct this version" mode.
    await expect(form.locator("#efficiencySubmit")).toHaveText("Save correction");
    await form.locator('input[name="price_per_unit_ngn"]').fill("1150");
    await form.locator("#efficiencySubmit").click();
    await expect(page.locator("#notice")).toContainText("efficiency policy saved");
    // The edit window closes so the click clearly landed.
    await expect(panel).not.toHaveAttribute("open", "");

    const rowCount = await page.locator("#efficiencyPolicyList .policy-row").count();

    // Saving again with the same effective date corrects in place — no
    // duplicate version rows.
    await panel.locator("> summary").click();
    await form.locator('input[name="price_per_unit_ngn"]').fill("1175");
    await form.locator("#efficiencySubmit").click();
    await expect(page.locator("#notice")).toContainText("efficiency policy saved");
    await expect(page.locator("#efficiencyPolicyList .policy-row")).toHaveCount(rowCount);
    await expect(page.locator("#efficiencyPolicyList")).toContainText("₦1,175");
  });

  test("loads the selected vehicle pace profile into the form", async ({ page }) => {
    await page.goto(`${url}#controls`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator("#paceProfilePanel > summary").click();
    const form = page.locator("#paceProfileForm");
    await expect(form.locator('input[name="daily_target_ngn"]')).toHaveValue("60000");
    await form.locator('select[name="vehicle_type"]').selectOption("motorbike");
    await expect(form.locator('input[name="daily_target_ngn"]')).toHaveValue("25000");
    await expect(form.locator('input[name="daily_target_accommodated_ngn"]')).toHaveValue("28000");
    await expect(form.locator('input[name="noon_pct"]')).toHaveValue("40");
    await expect(form.locator('input[name="afternoon_pct"]')).toHaveValue("65");
    await expect(form.locator('input[name="evening_pct"]')).toHaveValue("90");
  });

  test("pace rows show status + accommodated target and Edit loads that version", async ({ page }) => {
    await page.goto(`${url}#controls`);
    await expect(page.locator("#notice")).toContainText("Connected");
    const motorbikeRow = page.locator("#paceProfileList .policy-row").filter({ hasText: "motorbike" });
    await expect(motorbikeRow).toContainText("active");
    await expect(motorbikeRow).toContainText("accommodated ₦28,000");
    // Edit loads that exact version into the form, in "correct this version" mode.
    await motorbikeRow.getByRole("button", { name: "Edit" }).click();
    const form = page.locator("#paceProfileForm");
    await expect(form.locator('select[name="vehicle_type"]')).toHaveValue("motorbike");
    await expect(form.locator('input[name="daily_target_ngn"]')).toHaveValue("25000");
    await expect(page.locator("#paceSubmit")).toHaveText("Save correction");
    await expect(page.locator("#paceFormMode")).toContainText("Correcting the version");
    // Changing the effective date flips it to a new version.
    await form.locator('input[name="effective_from"]').fill("2027-01-01");
    await expect(page.locator("#paceSubmit")).toHaveText("Save as new version");
    await expect(page.locator("#paceFormMode")).toContainText("supersedes");
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
    await page.goto(`${url}#ingestion`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Enter a performance record", { exact: true }).click();
    await page.locator('#ingestionForm input[name="ride_revenue_ngn"]').fill("27500");
    await page.locator('#ingestionForm select[name="current_status"]').selectOption("online");
    await page.locator("#ingestionForm").getByRole("button", { name: "Save performance record" }).click();
    await expect(page.locator("#notice")).toContainText("1 record accepted");
  });

  test("configures an onboarding ramp and starts a cohort", async ({ page }) => {
    await page.goto(`${url}#onboarding`);
    await expect(page.locator("#notice")).toContainText("Connected");
    // Seeded rider ramp profile is listed.
    await expect(page.locator("#onboardingRampList")).toContainText("Riders · 12-day ramp");

    // Edit the completion bonus params.
    const rampPanel = page.locator("#onboardingRampForm").locator("xpath=ancestor::details");
    await page.getByText("Set the ramp curve & completion bonus", { exact: true }).click();
    await page.locator('#onboardingRampForm input[name="completion_bonus_ngn"]').fill("25000");
    await page.locator('#onboardingRampForm input[name="missed_day_reduction_pct"]').fill("8");
    await page.locator("#onboardingRampForm").getByRole("button", { name: "Save ramp profile" }).click();
    await expect(page.locator("#notice")).toContainText("ramp profile saved");
    await expect(page.locator("#onboardingRampList")).toContainText("₦25,000");
    await expect(rampPanel).not.toHaveAttribute("open", "");

    // Start a cohort.
    await page.getByText("Start a cohort", { exact: true }).click();
    await page.locator('#cohortForm input[name="name"]').fill("E2E Monday batch");
    await page.locator('#cohortForm input[name="start_date"]').fill("2026-06-01");
    await page.locator("#cohortForm").getByRole("button", { name: "Create cohort" }).click();
    await expect(page.locator("#notice")).toContainText("Cohort created");
    await expect(page.locator("#cohortList")).toContainText("E2E Monday batch");
  });

  test("tracks finite accommodation and flags housed riders", async ({ page, request }) => {
    const opsBase = "http://127.0.0.1:4530";
    const headers = {
      Authorization: "Bearer flexi-dev-service-token",
      "Content-Type": "application/json",
      "X-Actor-Person-Id": "person_founder_wole"
    };
    // Beds live on the site (site_island_1 is seeded with capacity). Create a
    // fresh active rider there, then house them from the roster.
    const unique = Date.now();
    const created = await (await request.post(`${opsBase}/ops/v1/operators`, {
      headers: { ...headers, "Idempotency-Key": `e2e-accom-op-${unique}` },
      data: { person_id: `person_e2e_accom_${unique}`, operator_type: "rider", operator_status: "active", amoeba_id: "amoeba_island", site_id: "site_island_1" }
    })).json();
    const operatorId = created.operator_id || created.data?.operator_id;
    expect(operatorId).toBeTruthy();

    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage operator roster", { exact: true }).click();
    await page.locator("#operatorAmoebaFilter").selectOption("amoeba_island");

    const opRow = page.locator(`[data-operator-id="${operatorId}"]`);
    await expect(opRow).toBeVisible();
    await opRow.locator("[data-operator-accommodated]").check();
    await opRow.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#notice")).toContainText("Operator updated");
    await expect(opRow).toContainText("🏠");

    // It persisted, and the housing monitor shows the site with beds in use.
    const saved = await (await request.get(`${opsBase}/ops/v1/operators/${operatorId}`, { headers })).json();
    expect(saved.accommodated).toBe(true);
    await page.locator('.rail nav a[href="#accommodation"]').click();
    await expect(page.locator("#accommodationList .policy-row").filter({ hasText: "Lekki Awudu Ekpegha" })).toContainText("beds");
  });

  test("registers a Tankvolt bike by VIN, guided by vehicle type, with live tracking status", async ({ page }) => {
    await page.goto(`${url}#vehicles`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage fleet assets", { exact: true }).click();

    const vin = `LB7FP210XSF${String(Date.now()).slice(-6)}`;
    const plate = `TV${String(Date.now()).slice(-5)}`;
    await page.locator('#vehicleForm input[name="plate"]').fill(plate);
    await page.locator('#vehicleForm select[name="amoeba_id"]').selectOption("amoeba_mainland");

    // A car cannot be a Tankvolt EV — the option isn't offered.
    await page.locator('#vehicleForm select[name="vehicle_type"]').selectOption("car");
    await expect(page.locator('#vehicleTrackerProvider option[value="tankvolt"]')).toHaveCount(0);

    // A motorbike can — and choosing Tankvolt makes the VIN field required + relabelled.
    await page.locator('#vehicleForm select[name="vehicle_type"]').selectOption("motorbike");
    await expect(page.locator('#vehicleTrackerProvider option[value="tankvolt"]')).toHaveCount(1);
    await page.locator("#vehicleTrackerProvider").selectOption("tankvolt");
    await expect(page.locator("#vehicleTrackerFieldLabel")).toHaveText("Bike VIN");
    await expect(page.locator("#vehicleTrackerHint")).toContainText("tracks by VIN");
    // The VIN is mandatory for Tankvolt (no device list to auto-map against).
    await expect(page.locator("#vehicleTrackerDeviceId")).toHaveJSProperty("required", true);

    // With the VIN it saves; the fleet row shows the tracker + live tracking status.
    await page.locator("#vehicleTrackerDeviceId").fill(vin);
    await page.locator("#vehicleForm").getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.locator("#notice")).toContainText("Vehicle added");

    await page.locator("#vehicleAmoebaFilter").selectOption("amoeba_mainland");
    const row = page.locator("#vehicleList .data-row").filter({ hasText: plate });
    await expect(row).toContainText("Tankvolt");
    await expect(row).toContainText(vin);
    // No live feed yet (only the fixture tracker is active in tests) -> awaiting fix.
    await expect(row).toContainText("awaiting fix");
  });

  test("tracker device mapping lives on its own Trackers screen, grouped by provider", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    // It has its own sidebar entry, no longer buried in Targets & policy.
    await page.locator('.rail nav a[href="#trackers"]').click();
    await expect(page.getByRole("heading", { name: "Trackers" })).toBeVisible();
    await expect(page.locator("#trackerSummary")).toContainText("mapped to vehicles");
    // The active credential environment is badged (tests run with the default).
    await expect(page.locator("#trackerSummary")).toContainText("TEST credentials");
    // Devices are grouped under a provider heading, and the folder is relabelled.
    await expect(page.locator("#trackerDeviceList .tracker-provider").first()).toBeVisible();
    // Connector health is shown per provider (answerable here, no hop to the Supervisor app).
    await expect(page.locator("#trackerDeviceList .tracker-health").first()).toBeVisible();
    await expect(page.locator("#trackerDeviceList")).toContainText("QLINK FLEXI-001");
    await expect(page.locator("#trackerDeviceList")).toContainText("folder: Qutes");
    // The tracker panel is gone from Targets & policy.
    await page.locator('.rail nav a[href="#controls"]').click();
    await expect(page.getByRole("heading", { name: "Vehicle trackers" })).toHaveCount(0);
  });

  test("registers a vehicle into the warehouse (no amoeba) and filters for it", async ({ page }) => {
    await page.goto(`${url}#vehicles`);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.getByText("Manage fleet assets", { exact: true }).click();

    const plate = `WARE${String(Date.now()).slice(-5)}`;
    // The amoeba picker offers "Unassigned (warehouse)" and it is the default.
    await expect(page.locator('#vehicleForm select[name="amoeba_id"] option[value=""]')).toHaveText("Unassigned (warehouse)");
    await page.locator('#vehicleForm input[name="plate"]').fill(plate);
    await page.locator('#vehicleForm select[name="vehicle_type"]').selectOption("motorbike");
    await page.locator('#vehicleForm select[name="amoeba_id"]').selectOption("");
    await page.locator("#vehicleForm").getByRole("button", { name: "Add vehicle" }).click();
    await expect(page.locator("#notice")).toContainText("Vehicle added");

    // The "Unassigned (warehouse)" fleet filter surfaces it, and the row says so.
    await page.locator("#vehicleAmoebaFilter").selectOption("__unassigned");
    const row = page.locator("#vehicleList .data-row").filter({ hasText: plate });
    await expect(row).toContainText("Unassigned (warehouse)");
    // A warehouse bike holds no operator.
    await expect(row).toContainText("Unassigned");
  });
});
