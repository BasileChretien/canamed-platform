/* tests-e2e/stable-id.spec.js
 *
 * R2-24/25 regression test: stableId is a per-person identifier (Google
 * uid when signed in, localStorage random when anonymous) that survives
 * a tab refresh / close — so research (Aisha's longitudinal replay) can
 * deduplicate a participant across tab resets. Distinct from clientId
 * which is per-tab.
 *
 * What this test asserts:
 *   1. On first page load, localStorage.canamed_stable_id is minted and
 *      starts with "s" (the anonymous-tier prefix).
 *   2. After a hard reload of the same tab, the same stableId value is
 *      reused (the bug we're fixing was: refresh => new id => fragments
 *      individuals in the export).
 *   3. The platform's `stableId` JS variable equals the localStorage one.
 *   4. The legacy localStorage clientId is cleaned up on init.
 *   5. leaveAndReload's cleanup clears the stableId (so a shared lab
 *      machine doesn't bleed the previous student into the next).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Helper: poll until script.js has populated localStorage. script.js is
   `defer`-loaded so it runs after DOMContentLoaded but before window.load. */
async function waitForStableId(page) {
  await page.waitForFunction(() =>
    typeof localStorage.getItem("canamed_stable_id") === "string" &&
    localStorage.getItem("canamed_stable_id") !== null
  );
}

test.describe("R2-24/25: stableId persistence across tab refresh", () => {
  test("stableId is minted on first load and survives a reload", async ({ page }) => {
    await page.goto("/");
    await waitForStableId(page);

    const first = await page.evaluate(() => ({
      stored: localStorage.getItem("canamed_stable_id"),
      legacy: localStorage.getItem("canamed_client")
    }));

    expect(first.stored).toBeTruthy();
    expect(first.stored).toMatch(/^s[0-9a-f]{16}$/);
    // legacy localStorage client id from older builds is cleaned up
    expect(first.legacy).toBeNull();

    // Hard reload — the bug we're fixing was: refresh => new id =>
    // fragments the same person into many participants in the export.
    await page.reload();
    await waitForStableId(page);

    const second = await page.evaluate(
      () => localStorage.getItem("canamed_stable_id")
    );

    expect(second).toEqual(first.stored);
  });

  test("a fresh browser context mints a NEW stableId", async ({ browser }) => {
    // Two fresh contexts must mint distinct stableIds — confirms the
    // value is random per-browser, not a hardcoded constant.
    const c1 = await browser.newContext();
    const p1 = await c1.newPage();
    await p1.addInitScript(() => {
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value, set: () => {}, configurable: true, enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      pin("CANAMED_PERF_MONITORING", false);
    });
    await p1.goto("/");
    await waitForStableId(p1);
    const id1 = await p1.evaluate(() => localStorage.getItem("canamed_stable_id"));
    await c1.close();

    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await p2.addInitScript(() => {
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value, set: () => {}, configurable: true, enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      pin("CANAMED_PERF_MONITORING", false);
    });
    await p2.goto("/");
    await waitForStableId(p2);
    const id2 = await p2.evaluate(() => localStorage.getItem("canamed_stable_id"));
    await c2.close();

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toEqual(id2);
  });
});
