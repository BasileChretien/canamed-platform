/* tests-e2e/room-css-lazy.spec.js
 *
 * Contract for the room-only stylesheet split (perf reclaim, 2026-07-23).
 *
 * The stage / decision / leaderboard / debrief / wrap-up CSS was moved out of
 * the eager style.css into room.css, which CanamedLoader.ensureRoomStyles()
 * <link>s in on room entry (same lazy pattern as admin.css / branched.css).
 * That reclaimed ~12.9 KB gz of the splash first-party CSS budget (337 → 325).
 *
 * Two things must stay true, and BOTH are load-bearing:
 *   1. room.css must NOT be fetched on the splash — otherwise the reclaim is
 *      undone and the perf budget silently regresses.
 *   2. ensureRoomStyles() must actually APPLY the room styles — otherwise the
 *      room renders unstyled and only a human would notice, since the
 *      functional specs assert behaviour and text, not CSS.
 *
 * Probe choice matters: `#findings-log { list-style: none }` lives ONLY in
 * room.css and has no eager default anywhere (style.css/tokens.css), so
 * list-style-type flips disc → none exactly when room.css lands. An earlier
 * draft probed the --stage-accent custom property instead, which was a FALSE
 * POSITIVE: tokens.css defines an inherited default for it, so it resolved
 * non-empty with or without room.css and proved nothing.
 *
 * Asserted via computed style rather than a screenshot, so it is stable across
 * machines/renderers (visual.spec.js has no committed baselines and covers only
 * splash + privacy — there is no pixel net here).
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Inject a bare <ul id="findings-log"> and report its computed list-style-type.
   "disc" = UA default (room.css absent); "none" = room.css applied. */
async function findingsListStyle(page) {
  return await page.evaluate(() => {
    let ul = document.getElementById("findings-log");
    if (!ul) {
      ul = document.createElement("ul");
      ul.id = "findings-log";
      ul.appendChild(document.createElement("li"));
      document.body.appendChild(ul);
    }
    return getComputedStyle(ul).listStyleType;
  });
}

test("room.css is NOT loaded on the splash (the perf reclaim holds)", async ({ page }) => {
  const cssRequests = [];
  page.on("request", (r) => {
    if (r.resourceType() === "stylesheet" || /\.css(\?|$)/.test(r.url())) cssRequests.push(r.url());
  });

  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  // Give the idle-prefetch window time to do whatever it does.
  await page.waitForTimeout(1200);

  expect(cssRequests.join("\n")).not.toMatch(/room\.css/);
  expect(await page.locator("#room-css").count()).toBe(0);
  // …and the room rules genuinely are not in effect yet.
  expect(await findingsListStyle(page)).toBe("disc");
});

test("ensureRoomStyles() applies the room styles", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  expect(await findingsListStyle(page)).toBe("disc"); // precondition

  await page.evaluate(async () => {
    await window.CanamedLoader.ensureRoomStyles();
  });

  expect(await page.locator("#room-css").count()).toBe(1);
  expect(await findingsListStyle(page)).toBe("none");  // room.css now in effect

  // Idempotent: a second call must not inject a duplicate <link>.
  await page.evaluate(async () => { await window.CanamedLoader.ensureRoomStyles(); });
  expect(await page.locator("#room-css").count()).toBe(1);
});
