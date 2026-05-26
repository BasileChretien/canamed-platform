/* tests-e2e/admin-tools-export.spec.js
 *
 * admin-tools.js round 2 (2026-05-22): research export (pseudonymous JSON
 * download) + per-participant attestations (printable popup). Drives the real
 * lazy-loaded path in a browser.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");
const fs = require("fs");

async function loadAdminTools(page) {
  await page.evaluate(() =>
    (window.CanamedLoader && window.CanamedLoader.ensureAdminTools)
      ? window.CanamedLoader.ensureAdminTools()
      : Promise.reject(new Error("ensureAdminTools missing")));
}

test.describe("Admin tools — research export + attestations", () => {
  test("research export downloads pseudonymous, SAP-aligned JSON", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await loadAdminTools(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(() => window.generateResearchExport())
    ]);
    expect(download.suggestedFilename()).toMatch(/research_export\.json$/);

    const p = await download.path();
    const bundle = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(bundle.pseudonymous, "export must be pseudonymous").toBe(true);
    expect(Array.isArray(bundle.participants), "must carry a participants array").toBe(true);
    expect(Array.isArray(bundle.decisions), "must carry a decisions array").toBe(true);
    expect(Array.isArray(bundle.rooms), "must carry a rooms array").toBe(true);
    // No participant row may carry a name field (pseudonymity).
    for (const row of bundle.participants) {
      expect(row.name, "participant rows must not carry names").toBeUndefined();
    }
  });

  test("CSV export downloads the linked analysis files (runs without error)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await loadAdminTools(page);

    let downloads = 0;
    page.on("download", () => { downloads++; });
    // Resolves only if every new builder (reveals / votes / free-text / codebook)
    // runs without a runtime error on the live data shapes — a throw would
    // reject this evaluate. That's the real check here.
    await page.evaluate(() => window.generateResearchExportCSV());
    // A single download fires reliably cross-browser; WebKit is flaky about
    // *multiple* rapid programmatic downloads, so we only assert that the
    // export produced output. The full six-file set is locked by the static
    // unit test (tests/survey-csv-export.test.js).
    await expect.poll(() => downloads, { timeout: 4000 }).toBeGreaterThan(0);
  });

  test("attestations open a printable, named certificate page", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await loadAdminTools(page);

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateAttestations())
    ]);
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup.locator(".cert-head")).toContainText("CANAMED");
    await expect(popup.locator("body")).toContainText("This certifies that");
    await expect(popup.locator("button", { hasText: "Print" })).toBeVisible();
    // The competencies-practiced list is present (e.g. breaking bad news / SPIKES).
    await expect(popup.locator(".cert-comps")).toContainText("Breaking bad news");
    await popup.close();
  });
});
