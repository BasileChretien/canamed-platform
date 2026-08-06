/* playwright.emulator.config.js — rules-exercising E2E against the emulator.
 *
 * The main suite (playwright.config.js) runs in LOCAL mode (in-browser
 * LocalDB), so it NEVER exercises database.rules.json. This config runs a
 * small smoke flow against the REAL Firebase Realtime Database + Auth
 * EMULATORS, so a rules regression (e.g. a write predicate that breaks the
 * join flow, or a rule accidentally opened to `true`) is caught at PR time.
 *
 * Orchestration (see .github/workflows/rules-e2e.yml and the local npm
 * script `test:e2e:rules`):
 *   1. node scripts/sim/build-emulator-rules.js   (emulator-compatible rules)
 *   2. firebase emulators:exec --only database,auth ... "<this playwright run>"
 *      → the emulators are up on 9000 (DB) / 9099 (Auth) for the test.
 *   3. Playwright's webServer starts serve-platform.js with
 *      SIM_EMULATOR_MODE=1 so its CSP allows connections to the emulator.
 *
 * The browser is pointed at the emulator by tests-e2e/emulator/fixtures.js
 * (pins CANAMED_FIREBASE + CANAMED_EMULATOR), mirroring scripts/sim.
 */

// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/* Overridable, like playwright.config.js — 8765 is also AnkiConnect's port on
   some dev machines, and a hardcoded number there turns into a full-suite
   failure on the splash. scripts/ops/run-rules-e2e.js passes PORT through. */
const PORT = parseInt(process.env.PORT || "8765", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests-e2e/emulator",
  /* NOT the default test-results/ — that directory is shared with the LOCAL
     suite (playwright.config.js), and Playwright CLEARS its output dir at
     start-up, so a concurrent LOCAL run aborts this one with ENOTEMPTY. */
  outputDir: "./test-results-emulator",
  // The first emulator round-trip (anon auth + RTDB WebSocket handshake)
  // is slower than LocalDB — give it room.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,       // cross-tab sync needs a single shared context
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* The retry above buys tolerance for genuine infrastructure noise (a slow
     emulator boot, a dropped socket). It must NOT buy tolerance for a flaky
     RULE. Without this flag a test that fails then passes on retry exits 0 and
     appears only as "1 flaky" in a report nobody opens — so a real defect in
     database.rules.json, or in the client's use of it, reads as green.
     That is not hypothetical: the create → join → advance test failed ~15% of
     full runs for weeks on a genuine single-writer bug (a participant write
     racing the facilitator's Advance, fixed in #292). Both attempts failing is
     ~2% at that rate, so CI essentially never surfaced it, and it was written
     off as flake three times locally instead.
     Keep the retry, but make a flaky result FAIL the run: the retry is then a
     diagnostic (it says "this is intermittent"), not a silencer. */
  failOnFlakyTests: true,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: !process.env.HEADED
  },
  projects: [
    { name: "emulator", use: { ...devices["Desktop Chrome"] } }
  ],
  // Serve the platform with the emulator-CSP relaxation so the page is
  // allowed to talk to 127.0.0.1:9000 / :9099.
  webServer: {
    command: "node scripts/serve-platform.js",
    port: PORT,
    timeout: 15_000,
    /* NEVER reuse. The emulator-CSP relaxation lives in serve-platform.js's
       SIM_EMULATOR_MODE branch, so adopting a server started without it means
       the page is forbidden to reach 127.0.0.1:9000 and EVERY test fails on a
       CSP violation that reads as a rules failure. sim-with-emulator.js
       already treats a pre-existing :8765 as fatal for the same reason; this
       config used to silently adopt it. run-rules-e2e.js preflights the port
       and names the squatter, so the failure here is diagnosable. */
    reuseExistingServer: false,
    env: { SIM_EMULATOR_MODE: "1" },
    stdout: "ignore",
    stderr: "pipe"
  }
});
