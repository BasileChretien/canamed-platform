/* tests-e2e/fixtures.js
 *
 * Shared helpers for the Playwright suite.
 *
 * forceLocalMode() — addInitScript that nails CANAMED_FIREBASE = null and
 * keeps it null even after firebase-config.js's own assignment runs. The
 * platform's mode detector picks the in-browser LocalDB whenever
 * CANAMED_FIREBASE is null, so this keeps the E2E suite hermetic: no real
 * Firebase, no production data, no shared-state flakiness between CI runs.
 *
 * Why defineProperty instead of plain assignment:
 *   addInitScript runs BEFORE the page's own scripts. A bare
 *   `window.CANAMED_FIREBASE = null` therefore gets overwritten the moment
 *   firebase-config.js loads ("window.CANAMED_FIREBASE = {...real config}").
 *   We define a property with a setter that ignores assignments, so the
 *   real config never lands. Same trick for CANAMED_RECAPTCHA_SITE_KEY so
 *   App Check stays off in tests regardless of what firebase-config.js
 *   contains.
 */

// @ts-check
const { test: base, expect } = require("@playwright/test");

async function forceLocalMode(page) {
  await page.addInitScript(() => {
    // Pin each global to a fixed value, ignoring any later assignment.
    // configurable:true so a teardown or debug session can still re-set.
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => { /* swallow firebase-config.js's assignment */ },
        configurable: true,
        enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);                  // → MODE = "local"
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);        // → App Check OFF
    // Suppress onboarding tour during E2E — the overlay covers the
    // create-session form and would block any test that needs to click
    // a control there. Setting the "done" flag mimics a user who has
    // already dismissed the tour.
    try {
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      // Bug 5 (user-feedback-2): student tour pinned-done in tests so it
      // doesn't cover room-view controls and break unrelated assertions.
      localStorage.setItem("canamed_tour_student_done", "v1");
    } catch (e) {}
    // Override super-admin key so the super-admin set-password flow can be
    // tested without secrets leaking. This one we want WRITEABLE because
    // firebase-config.js's null assignment is fine — we just provide a
    // default value the platform code can use if the file's value is null.
    if (!window.CANAMED_SUPERADMIN_KEY) {
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    }
  });
}

const test = base.extend({
  page: async ({ page }, use) => {
    await forceLocalMode(page);
    await use(page);
  }
});

module.exports = { test, expect, forceLocalMode };
