/* Playwright config for the CaNaMED PBL platform E2E suite.
 *
 * Tests run against a local static server (scripts/serve-platform.js)
 * that serves docs/Third_session/PBL_platform/ with production-equivalent
 * HTTP security headers. The platform is forced into LOCAL mode (an
 * in-browser LocalDB that survives across tabs of the same browser
 * context) via a page.addInitScript helper in the test files — so the
 * tests never touch real Firebase or the production database. Every CI
 * run is hermetic.
 *
 * To run locally:
 *   npm install
 *   npx playwright install --with-deps chromium
 *   npm run test:e2e
 *
 * To debug interactively:
 *   npm run test:e2e:ui
 */

// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests-e2e",
  // Fail fast on CI; tolerate flakier-than-expected times for the first run
  // (anonymous-auth init + WebSocket handshake can take a couple of seconds).
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,           // LocalDB syncs across same-context tabs only
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Headless by default; HEADED=1 to watch the browser interactively
    headless: !process.env.HEADED
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /visual\.spec\.js$|mobile\.spec\.js$|a11y\.spec\.js$|perf\.spec\.js$|android-findings\.spec\.js$|[\\/]emulator[\\/]/
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: /visual\.spec\.js$|mobile\.spec\.js$|a11y\.spec\.js$|perf\.spec\.js$|android-findings\.spec\.js$|[\\/]emulator[\\/]/
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: /visual\.spec\.js$|mobile\.spec\.js$|a11y\.spec\.js$|perf\.spec\.js$|android-findings\.spec\.js$|[\\/]emulator[\\/]/
    },
    // ---- perf budget — splash FCP/TTI and first-party JS+CSS bytes,
    // chromium only (Chrome's PerformanceNavigationTiming is the most
    // representative across the user base we care about). See
    // tests-e2e/perf.spec.js for the thresholds. Runs as a dedicated
    // project so a budget regression shows up as its own red dot in CI.
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /perf\.spec\.js$/
    },
    // ---- accessibility — axe-core via @axe-core/playwright, chromium only.
    // Runs against splash + privacy (en/fr/ja) + lobby + waiting room and
    // asserts zero serious/critical WCAG 2.1 AA violations. Moderate /
    // minor findings are surfaced as test annotations, not failures, so
    // CI doesn't go red on the long-tail issues tracked in
    // docs/Third_session/PBL_platform/ARCHITECTURE/ACCESSIBILITY_AUDIT.md.
    {
      name: "a11y",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /a11y\.spec\.js$/
    },
    // ---- visual regression snapshots — chromium only for determinism ----
    {
      name: "visual",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      testMatch: /visual\.spec\.js$/
    },
    // ---- mobile / tablet device emulation pass ----
    {
      name: "mobile-iphone",
      use: { ...devices["iPhone 14 Pro"] },
      testMatch: /(?:mobile|lazy-locale-consent|survey-feedback|lobby-form-semantics|facilitator-profile|modb-role-objective|case-cluster-by-category|investigations-anytime|modb-observer-dark|modA-autoopen-steps|modb-phase-flow)\.spec\.js$/
    },
    {
      name: "mobile-ipad",
      use: { ...devices["iPad Pro 11"] },
      testMatch: /(?:mobile|lazy-locale-consent|survey-feedback|lobby-form-semantics|facilitator-profile|modb-role-objective|case-cluster-by-category|investigations-anytime|modb-observer-dark|modA-autoopen-steps|modb-phase-flow)\.spec\.js$/
    },
    // Pixel 7 (Android Chrome) emulation pass — user feedback (Bug 3)
    // reported the Module A findings reveal was invisible on Android
    // Chrome because the stacked-column mobile layout left the new
    // answer below the fold. The android-findings spec exercises the
    // reveal flow on a Pixel 7 viewport and asserts the freshly-revealed
    // answer is both in the DOM AND scrolled into the viewport.
    {
      name: "mobile-android",
      use: { ...devices["Pixel 7"] },
      testMatch: /(?:android-findings|lazy-locale-consent|survey-feedback|lobby-form-semantics|facilitator-profile|modb-role-objective|case-cluster-by-category|investigations-anytime|modb-observer-dark|modA-autoopen-steps|modb-phase-flow)\.spec\.js$/
    }
  ],
  // Auto-start the static server before the suite runs; auto-shut down after.
  webServer: {
    command: "node scripts/serve-platform.js",
    port: PORT,
    timeout: 10_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe"
  }
});
