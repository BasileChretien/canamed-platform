/* tests-e2e/emulator/fixtures.js
 *
 * Points the browser at the local Firebase emulator (RTDB :9000, Auth
 * :9099) instead of LOCAL mode — so writes/reads go through the REAL
 * database.rules.json. Mirrors the pin block in scripts/sim/simulate-session.js.
 *
 * App Check is pinned OFF (CANAMED_RECAPTCHA_SITE_KEY = null): App Check
 * can't attest against an emulator and is a production-Console concern, not
 * a rules concern. This suite tests the security RULES + the auth/membership
 * flow, which is the gap the LOCAL-mode suite leaves open.
 */

// @ts-check
const { test: base, expect } = require("@playwright/test");

const EMU_HOST = "127.0.0.1";
const EMU_DB_PORT = 9000;
const EMU_AUTH_PORT = 9099;
const PROJECT = "canamed-sim";
// CRITICAL: the emulator applies database.rules.json to the DEFAULT RTDB
// namespace ("<project>-default-rtdb"). A connection to any OTHER namespace
// (e.g. "?ns=canamed-sim") gets auto-created with OPEN (allow-all) rules —
// so the rules would never actually be exercised. We must target the default
// namespace for the rules to apply. (This also fixes a latent gap in the
// sim, which used "?ns=canamed-sim" and was therefore running rule-less.)
const DB_NAMESPACE = PROJECT + "-default-rtdb";

async function useEmulator(page) {
  await page.addInitScript((cfg) => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", {
      apiKey: "fake-emulator-key",
      authDomain: cfg.host + ":" + cfg.authPort,
      databaseURL: "http://" + cfg.host + ":" + cfg.dbPort + "?ns=" + cfg.ns,
      projectId: cfg.project,
      appId: "1:0:web:emulator"
    });
    pin("CANAMED_EMULATOR", {
      host: cfg.host, dbPort: cfg.dbPort, authPort: cfg.authPort
    });
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);   // App Check OFF
    window.CANAMED_SUPERADMIN_KEY = "e2e-emulator-super-admin";
    try {
      // Suppress tours so overlays don't cover the controls under test.
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
    } catch (e) {}
  }, { host: EMU_HOST, dbPort: EMU_DB_PORT, authPort: EMU_AUTH_PORT, project: PROJECT, ns: DB_NAMESPACE });
}

const test = base.extend({
  page: async ({ page }, use) => {
    await useEmulator(page);
    await use(page);
  }
});

module.exports = { test, expect, useEmulator, PROJECT };
