import { expect, test } from "@playwright/test";

const url = "/apps/ops-admin-console/?opsApiBase=http://127.0.0.1:4530&foundationApiBase=http://127.0.0.1:4510";
// A tiny but valid-looking PDF payload.
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test.describe("ops-admin documents", () => {
  test("attaches and removes an operator document", async ({ page }) => {
    // The console shows one hash-routed section at a time; land directly on the roster.
    await page.goto(`${url}#operators`);
    await expect(page.locator("#notice")).toContainText("Connected to Fleximotion Ops.");
    await expect(page.locator("#operators")).toHaveClass(/view-active/);

    // Roster management (filter + list) lives in a collapsed <details>.
    await page.locator("#rosterPanel > summary").click();
    // The roster only renders once a scope is chosen; take whichever operator it shows.
    await page.locator("#operatorAmoebaFilter").selectOption("__all");
    const row = page.locator("#operatorList [data-operator-id]").first();
    await expect(row).toBeVisible();
    await row.locator("[data-operator-docs]").click();

    const dialog = page.locator("#docDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#docDialogTitle")).toHaveText("Operator documents");

    const label = `e2e contract ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await page.locator('#docForm select[name="doc_type"]').selectOption("employment_contract");
    await page.locator('#docForm input[name="label"]').fill(label);
    await page.locator('#docForm input[name="file"]').setInputFiles({
      name: "contract.pdf",
      mimeType: "application/pdf",
      buffer: pdf
    });
    await page.locator('#docForm button[type="submit"]').click();

    await expect(page.locator("#docDialogResult")).toContainText("Uploaded");
    const docRow = page.locator("#docList .doc-row", { hasText: label });
    await expect(docRow).toBeVisible();
    await expect(docRow).toContainText("Employment contract");

    // Remove just the document this test created (unique label), confirming the
    // native confirm() dialog.
    page.once("dialog", (d) => d.accept());
    await docRow.locator("[data-del-doc]").click();
    await expect(page.locator("#docList .doc-row", { hasText: label })).toHaveCount(0);
  });
});
