import { expect, test } from "@playwright/test";

test.describe("role consoles", () => {
  test("manager console presents scoped multi-team oversight", async ({ page }) => {
    await page.goto("/apps/manager-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510");

    await expect(page).toHaveTitle("Fleximotion Manager Console");
    await expect(page.getByRole("heading", { name: "Operations across your teams" })).toBeVisible();
    await expect(page.locator("#notice")).toContainText("Manager view is limited");
    await expect(page.locator("#activeCount")).not.toHaveText("0");
    await expect(page.locator("#teamPortfolio .summary-card")).not.toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Escalations" })).toBeVisible();
    await expect(page.locator("#escalationSummary article")).toHaveCount(5);
  });

  test("manager console computes P&L, records expenses and ranks the leaderboard", async ({ page }) => {
    await page.goto("/apps/manager-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510");
    await expect(page.locator("#notice")).toContainText("Manager view is limited");

    await expect(page.getByRole("heading", { name: "Profit & loss" })).toBeVisible();
    await expect(page.locator("#pnlTotals article")).toHaveCount(5);
    await expect(page.locator("#pnlList .summary-card")).not.toHaveCount(0);

    const expenseForm = page.locator("#expenseForm");
    await expenseForm.locator('input[name="amount_ngn"]').fill("1500");
    await expenseForm.locator('select[name="category"]').selectOption("fuel");
    await expenseForm.locator('input[name="description"]').fill("Playwright fuel top-up");
    await expenseForm.getByRole("button", { name: "Save expense" }).click();
    await expect(page.locator("#notice")).toContainText("Expense saved");
    await expect(page.locator("#expenseList")).toContainText("Playwright fuel top-up");

    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
    await expect(page.locator("#leaderboardList .data-row")).not.toHaveCount(0);
    await page.locator("#leaderboardSort").getByRole("button", { name: "Trips" }).click();
    await expect(page.locator("#leaderboardSort").getByRole("button", { name: "Trips" })).toHaveClass(/active/);

    const pnlDownload = page.waitForEvent("download");
    await page.locator("#exportPnlCsv").click();
    expect((await pnlDownload).suggestedFilename()).toContain("fleximotion-pnl");
    const leaderboardDownload = page.waitForEvent("download");
    await page.locator("#exportLeaderboardCsv").click();
    expect((await leaderboardDownload).suggestedFilename()).toContain("fleximotion-leaderboard");
  });

  test("finance console separates available operational context from pending ledger data", async ({ page }) => {
    await page.goto("/apps/finance-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542");

    await expect(page).toHaveTitle("Fleximotion Finance Console");
    await expect(page.getByRole("heading", { name: "Collections and reconciliation status" })).toBeVisible();
    await expect(page.locator("#providerMode")).toContainText("simulated");
    await expect(page.locator("#accessMode")).toContainText("System admin");
    await expect(page.locator("#reservedAccountMetric")).not.toContainText("Not connected");
    await expect(page.locator("#reservedAccountMetric")).not.toContainText("Checking");
    await expect(page.locator("#notice")).toContainText("Payments Integration is connected");
    await expect(page.locator("#operatorAccountList .summary-card")).not.toHaveCount(0);
    await expect(page.locator("#periodCloseBanner")).toContainText("Open for Finance review");
    await expect(page.getByRole("heading", { name: "Recent period closes" })).toBeVisible();
    await expect(page.locator("#periodCloseList")).toBeVisible();
    const cashDownload = page.waitForEvent("download");
    await page.locator("#exportCashCsv").click();
    expect((await cashDownload).suggestedFilename()).toContain("cash-closeout");
    const accountDownload = page.waitForEvent("download");
    await page.locator("#exportAccountsCsv").click();
    expect((await accountDownload).suggestedFilename()).toContain("reserved-accounts");
    await expect(page.locator("#adjustmentForm")).toBeAttached();
    await page.locator("#operatorAccountList").getByRole("button", { name: "View operators" }).first().click();
    await expect(page.locator("#operatorDialogList .data-row")).not.toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Monnify service readiness" })).toBeVisible();
  });

  test("finance console can run the sandbox Monnify test flow", async ({ page }) => {
    await page.goto("/apps/finance-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542");

    await expect(page.locator("#providerMode")).toContainText("simulated");
    await page.locator("#runSandboxTest").click();
    await expect(page.locator("#notice")).toContainText("Sandbox deposit delivered");
    await expect(page.locator("#webhookEventCount")).not.toHaveText("0");
    await expect(page.locator("#reconciliationRunCount")).not.toHaveText("0");
  });

  test("analytics console presents Net Earnings control signals", async ({ page }) => {
    await page.goto("/apps/analytics-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542&labourCostPerHour=2500&dailyOverheads=50000");

    await expect(page).toHaveTitle("Fleximotion Analytics Console");
    await expect(page.getByRole("heading", { name: "Net Earnings control room" })).toBeVisible();
    await expect(page.locator("#notice")).toContainText("Analytics view uses Net Earnings");
    await expect(page.locator("#netEarningsTotal")).not.toHaveText("₦0");
    await expect(page.locator("#hourlyEfficiency")).not.toHaveText("₦0/h");
    await expect(page.locator("#hourlyEfficiencyThreshold")).toContainText("labour cost");
    await expect(page.locator("#dataQuality")).toContainText("Net Earnings");
    await page.getByRole("button", { name: "Open data quality impact" }).first().click();
    await expect(page.locator("#detailDialog")).toBeVisible();
    await expect(page.locator("#detailTitle")).toHaveText("Data quality impact");
    await page.keyboard.press("Escape");
    await expect(page.locator("#netEarningsWeek")).toContainText("same weekday");
    await expect(page.getByRole("heading", { name: "Net Earnings trend" })).toBeVisible();
    await expect(page.locator("#trendChart .bar-column")).not.toHaveCount(0);
    await page.locator("#trendChart .bar-column").last().click();
    await expect(page.locator("#detailDialog")).toBeVisible();
    await expect(page.locator("#detailBody")).toContainText("What changed?");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Breakeven and platform mix" })).toBeVisible();
    await expect(page.locator("#breakevenStatus")).not.toHaveText("Checking");
    await expect(page.locator("#platformMixChart .split-row")).not.toHaveCount(0);
    const analyticsDownload = page.waitForEvent("download");
    await page.locator("#exportAnalyticsCsv").click();
    expect((await analyticsDownload).suggestedFilename()).toContain("fleximotion-analytics");
    await expect(page.getByRole("heading", { name: "Performance bars" })).toBeVisible();
    await expect(page.locator("#amoebaComparisonChart .comparison-row")).not.toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Amoeba portfolio" })).toBeVisible();
    await expect(page.locator("#amoebaPortfolio .summary-card")).not.toHaveCount(0);
    await page.getByRole("button", { name: "HE", exact: true }).click();
    await expect(page.getByRole("button", { name: "HE", exact: true })).toHaveClass(/active/);
    await page.locator("#amoebaPortfolio .summary-card").first().click();
    await expect(page.locator("#detailDialog")).toBeVisible();
    await expect(page.locator("#detailTitle")).toContainText("details");
    await expect(page.locator("#detailBody")).toContainText("Decision cue");
    await expect(page.locator("#detailBody")).toContainText("Platform mix");
    await expect(page.locator("#detailBody")).toContainText("Vehicle mix");
    await page.locator("#detailBody .interactive-row").first().click();
    await expect(page.locator("#detailBody")).toContainText("Operator signal");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Operator leaderboard" })).toBeVisible();
    await expect(page.locator("#operatorLeaderboard .data-row")).not.toHaveCount(0);
    await page.getByRole("button", { name: "Acceptance" }).click();
    await expect(page.getByRole("button", { name: "Acceptance" })).toHaveClass(/active/);
    await page.locator("#operatorLeaderboard .data-row").first().click();
    await expect(page.locator("#detailDialog")).toBeVisible();
    await expect(page.locator("#detailBody")).toContainText("Operator signal");
    await page.keyboard.press("Escape");
    await page.locator("#leakageSummaryChart .horizontal-bar").first().click();
    await expect(page.locator("#detailDialog")).toBeVisible();
    await expect(page.locator("#detailTitle")).toContainText(/Cash shortfalls|No operators|Open alerts/);
    await page.keyboard.press("Escape");
  });

  test("analytics console switches day week and month review periods", async ({ page }) => {
    await page.goto("/apps/analytics-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542&labourCostPerHour=2500&dailyOverheads=50000");

    await expect(page.locator("#notice")).toContainText("Analytics view uses Net Earnings");
    await expect(page.locator("[data-period-mode='day']")).toHaveClass(/active/);
    await expect(page.locator("#paceContext")).toContainText("selected");

    await page.locator("[data-period-mode='week']").click();
    await expect(page.locator("[data-period-mode='week']")).toHaveClass(/active/);
    await expect(page.locator("#paceContext")).toContainText("7 days ending");
    await expect(page.locator("#netEarningsGrowth")).toContainText(/previous period|No previous period/);
    await expect(page.locator("#netEarningsWeek")).toContainText(/previous same-length window|No previous same-length window/);

    await page.locator("[data-period-mode='month']").click();
    await expect(page.locator("[data-period-mode='month']")).toHaveClass(/active/);
    await expect(page.locator("#paceContext")).toContainText("30 days ending");
    await expect(page.locator("#trendChart .bar-column")).not.toHaveCount(0);

    await page.locator("[data-period-mode='day']").click();
    await expect(page.locator("[data-period-mode='day']")).toHaveClass(/active/);
    await expect(page.locator("#netEarningsWeek")).toContainText(/same weekday|No same weekday/);
  });

  test("role consoles do not create horizontal page overflow", async ({ page }) => {
    for (const app of ["manager-console", "finance-console", "analytics-console"]) {
      await page.goto(`/apps/${app}/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542`);
      await expect(page.locator("#notice")).not.toContainText("Loading");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow).toBe(false);
    }

    await page.setViewportSize({ width: 620, height: 900 });
    await page.goto("/apps/analytics-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510&paymentsApiBase=http://127.0.0.1:4542&adminLabourCostNg=50000&operatorLabourSharePct=25");
    await expect(page.locator("#notice")).not.toContainText("Loading");
    const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(narrowOverflow).toBe(false);
  });
});
