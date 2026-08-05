/* tests-e2e/admin-lazy.spec.js
 *
 * Contract for the FACILITATOR DASHBOARD lazy split (perf reclaim, 2026-08-05).
 *
 * The dashboard engine — enterAdminApp / startAdmin / renderPrestart /
 * renderDashboard / setRoomStage / the debrief / the impact report / the
 * archive + close flow — moved out of the eager script.js into script-admin.js,
 * <script>-injected by CanamedLoader.ensureAdminApp() from _enterAdminAppLazy(),
 * the single shim both admin routes pass through. That reclaimed 34.0 KB gz of
 * the splash first-party budget (347 -> 313).
 *
 * Three things must stay true, and all three are load-bearing:
 *   1. script-admin.js must NOT be fetched on the splash — otherwise the
 *      reclaim is undone and the perf budget silently regresses. Asserting the
 *      REQUEST is not enough on its own: an eager copy left behind in script.js
 *      would satisfy it, so the globals are checked too.
 *   2. The dashboard must still RENDER and DRIVE a session. Proving the chunk
 *      loads is not proving the facilitator can work: these tests go through
 *      the real create → "Open admin dashboard" flow and assert the VISIBLE
 *      dashboard, then seed a started session and assert a room card paints —
 *      i.e. renderPrestart and renderDashboard, both chunk code, reaching the
 *      DOM.
 *   3. A chunk that never arrives must SAY SO. The last test blocks the
 *      script-admin.js request outright and asserts the facilitator gets a
 *      visible message in the lobby instead of a dead button and a
 *      ReferenceError in the console. That is the whole reason
 *      _enterAdminAppLazy exists.
 *
 * The static half (script.js keeps no copy, no duplicate declarations, the
 * loader/sw/perf registrations, the three typeof guards) is pinned by
 * tests/admin-lazy-split.test.js.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is registered
 * in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* A representative slice of the move: the shell, the two renderers, stage
   control, the report and the archive. If any of these is defined on the
   splash, an eager copy survived. */
const MOVED_GLOBALS = [
  "enterAdminApp",
  "startAdmin",
  "renderDashboard",
  "renderPrestart",
  "setRoomStage",
  "generateImpactReport",
  "downloadSessionArchive",
  "closeSession"
];

const present = (page) => page.evaluate(
  (names) => names.map((n) => typeof window[n] === "function"),
  MOVED_GLOBALS);

/* The real facilitator route: create a session on the splash, then click
   "Open admin dashboard", which pre-fills the lobby and calls joinAdmin(). */
async function createAndOpenDashboard(page, label) {
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Facilitator");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-password-2026");
  await page.locator("#splash-create-submit").click();

  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 15_000 });
  /* The splash shows the code uppercase but the platform stores
     /sessions/{code}/* under the LOWERCASE form (sessionNum is the normalised
     createSession() output) — see live-leaderboard.spec.js. Return lowercase so
     a direct LocalDB write lands on the subtree the admin listeners watch. */
  const code = (await codeNode.textContent()).trim().toLowerCase();

  await page.locator("#splash-go-admin").click();
  return code;
}

test("script-admin.js is NOT loaded on the splash (the perf reclaim holds)", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });

  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  // Let the idle-prefetch window do whatever it does before concluding.
  await page.waitForTimeout(1200);

  expect(scripts.join("\n")).not.toMatch(/script-admin\.js/);
  // …and none of the moved code is defined, which is what actually proves
  // script.js kept no eager copy (a copy would satisfy the request check).
  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => false));
});

test("the facilitator login loads the chunk and the dashboard RENDERS", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });

  await page.goto("/");
  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => false)); // precondition

  const code = await createAndOpenDashboard(page, "E2E admin-lazy render");

  // What the facilitator SEES: the admin app, its mode line, the session code,
  // and the pre-start panel that renderPrestart() paints. Every one of those
  // renderers now lives in the chunk, so a visible dashboard is the real proof
  // that the split did not just load a file.
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#admin-mode-line")).toBeVisible();
  await expect(page.locator("#admin-session-code")).toContainText(code, { ignoreCase: true });
  await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 15_000 });

  // The chunk was actually fetched (and exactly once — loadScript de-dupes).
  const hits = scripts.filter((u) => /script-admin\.js/.test(u));
  expect(hits.length, "script-admin.js must be fetched on the admin route").toBe(1);
  expect(hits[0], "the chunk must carry the shell-version cache-buster")
    .toMatch(/script-admin\.js\?v=v\d+/);

  // …and every moved global is now defined.
  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => true));
});

test("renderDashboard paints a room card once the session is started", async ({ page }) => {
  await page.goto("/");
  const code = await createAndOpenDashboard(page, "E2E admin-lazy dashboard");
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 15_000 });

  /* Flip the session to started through LocalDB rather than the start-button
     modal (that flow is covered by advance-and-close.spec.js). What matters
     here is that renderDashboard — chunk code — reaches the DOM. */
  await page.evaluate((sessionCode) => {
    const db = window.db;
    db.ref("sessions/" + sessionCode + "/rooms/Room 1").set({ stage: 0 });
    db.ref("sessions/" + sessionCode + "/started").set(true);
  }, code);

  await expect(page.locator("#admin-dashboard")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#dashboard .dash-room").first()).toBeVisible({ timeout: 15_000 });
});

/* The failure test needs the service worker OUT of the way. sw.js precaches
   /script-admin.js and its fetch handler is cache-first, and a request issued
   BY a service worker is not intercepted by page.route() — so with the SW
   registered the abort below is silently ineffective and the dashboard opens
   normally, which is exactly what happened on the first run of this spec. */
test.describe("dashboard chunk unavailable", () => {
  test.use({ serviceWorkers: "block" });

  test("a chunk that never arrives shows a message, not a dead button", async ({ page }) => {
  /* THE failure mode _enterAdminAppLazy exists for. Abort the chunk request and
     confirm the facilitator is told, is left on the lobby (not a half-entered
     admin app), and can press the button again — `joined` must have been reset
     or joinAdmin's own re-entry guard would wedge them out of retrying. */
  await page.route("**/script-admin.js*", (route) => route.abort());

  await page.goto("/");
  await createAndOpenDashboard(page, "E2E admin-lazy failure");

  const hint = page.locator("#admin-hint");
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint).toContainText(/dashboard/i, { timeout: 20_000 });
  // The admin app must NOT have been revealed — enterAdminApp never ran.
  await expect(page.locator("#admin-app")).toBeHidden();
  // And the login is retryable: the button is re-enabled AND the module-level
  // re-entry guard was released, which is the half a visual check can't see.
  await expect(page.locator("#join-admin-btn")).toBeEnabled({ timeout: 10_000 });
  });
});
