/* tests-e2e/impact-report.spec.js
 *
 * Impact report (2026-05-22): the admin "📊 Impact report" generates a
 * self-contained, printable summary in a new window. This drives the REAL
 * generation path (window.generateImpactReport, a classic-script global) and
 * asserts the report renders with its dean-facing sections — even with no
 * room data it must produce a valid, titled, aggregate report (graceful zero
 * state), which also proves script.js still parses + boots.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). Runs on the desktop matrix.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Impact report", () => {
  test("generates a titled, sectioned report window with a print affordance", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // generateImpactReport is a classic-script global; invoking it opens the
    // report in a new tab. Capture the popup and assert its content.
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate(() => window.generateImpactReport())
    ]);
    await popup.waitForLoadState("domcontentloaded");

    await expect(popup.locator("h1")).toContainText("Session Impact Report");
    // Dean-facing section headings are present.
    await expect(popup.locator("h2", { hasText: "At a glance" })).toBeVisible();
    await expect(popup.locator("h2", { hasText: "Participation" })).toBeVisible();
    await expect(popup.locator("h2", { hasText: "Decision quality" })).toBeVisible();
    await expect(popup.locator("h2", { hasText: "Engagement" })).toBeVisible();
    // Print / Save-as-PDF affordance for the dossier workflow.
    await expect(popup.locator("button", { hasText: "Print" })).toBeVisible();
    // Privacy posture is stated.
    await expect(popup.locator("body")).toContainText("aggregate and pseudonymous");
    await popup.close();
  });
});
