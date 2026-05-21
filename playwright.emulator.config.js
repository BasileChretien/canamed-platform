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

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests-e2e/emulator",
  // The first emulator round-trip (anon auth + RTDB WebSocket handshake)
  // is slower than LocalDB — give it room.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,       // cross-tab sync needs a single shared context
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    reuseExistingServer: !process.env.CI,
    env: { SIM_EMULATOR_MODE: "1" },
    stdout: "ignore",
    stderr: "pipe"
  }
});
