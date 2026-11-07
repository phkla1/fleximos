import { expect, test } from "@playwright/test";

const url = "/apps/ops-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";
const opsBase = "http://127.0.0.1:4530";
const token = "flexi-dev-service-token";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Ensure at least one fuel issue (with a cost) exists today for a seeded rider,
// so the Fuel tab's recent-issues list and the receipt dialog have something to drive.
test.beforeAll(async ({ request }) => {
  const operators = (await (await request.get(`${opsBase}/ops/v1/operators`, { headers: { Authorization: `Bearer ${token}` } })).json()).data || [];
  const op = operators.find((o) => o.vehicle_id && o.operator_status === "active");
  if (!op) return;
  await request.post(`${opsBase}/ops/v1/fuel-issues`, {
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `e2e-fuel-${today}` },
    data: { operator_id: op.operator_id, vehicle_id: op.vehicle_id, operating_date: today, quantity: 8, unit: "litres", total_cost_ngn: 7600 }
  });
});

test.describe("Supervisor fuel receipts", () => {
  test("Fuel tab lists issues and the receipt dialog records a price", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("#notice")).toContainText("Connected");
    await page.locator('[data-tab-link="fuel"]').click();
    await expect(page.locator("#fuel")).toBeVisible();

    const firstRow = page.locator("#fuelIssueList .fuel-issue-row").first();
    await expect(firstRow).toBeVisible();

    // Open the receipt dialog, enter an actual per-unit price, save.
    await firstRow.locator("[data-fuel-receipt]").click();
    await expect(page.locator("#fuelReceiptDialog")).toBeVisible();
    await expect(page.locator("#fuelReceiptContext")).not.toBeEmpty();
    await page.locator("#fuelReceiptPpu").fill("1000");
    await page.locator("#fuelReceiptSave").click();

    await expect(page.locator("#notice")).toContainText("Fuel receipt saved");
    // The row now shows a per-unit price and a policy-comparison pill.
    await expect(page.locator("#fuelIssueList .fuel-issue-row").first()).toContainText("/litres");
    await expect(page.locator("#fuelIssueList .fuel-issue-row .pill").first()).toBeVisible();
  });
});
