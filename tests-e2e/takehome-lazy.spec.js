/* tests-e2e/takehome-lazy.spec.js
 *
 * Contract for the wrap-up TAKE-HOME lazy split (perf reclaim, 2026-08-04).
 *
 * The takeaway Markdown, the certificate PDF and the study booklet moved out of
 * the eager script.js into takehome.js, <script>-injected by
 * CanamedLoader.ensureTakeHome() from initEndPoll()'s three click handlers.
 * That reclaimed ~6 KB gz of the splash first-party budget (353 -> 347).
 *
 * Two things must stay true, and BOTH are load-bearing:
 *   1. takehome.js must NOT be fetched on the splash — otherwise the reclaim is
 *      undone and the perf budget silently regresses.
 *   2. The wrap-up download must still WORK — the file a student walks away
 *      with is the whole point, and a split that quietly breaks it is far worse
 *      than no split. So the last test does not stub anything: it seeds a room,
 *      clicks the real #wrapup-download-btn, and reads the bytes of the file the
 *      browser actually downloads.
 *
 * The static half (script.js keeps no copy, no duplicate declarations, the
 * loader/sw/perf registrations) is pinned by tests/takehome-lazy-split.test.js.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is registered
 * in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const MOVED_GLOBALS = [
  "buildRoomTakeawayMarkdown",
  "downloadMyRoomAnswers",
  "downloadCertificatePdf",
  "downloadStudyBookletPdf",
  "_collectBookletSections"
];

const present = (page) => page.evaluate(
  (names) => names.map((n) => typeof window[n] === "function"),
  MOVED_GLOBALS);

test("takehome.js is NOT loaded on the splash (the perf reclaim holds)", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });

  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  // Let the idle-prefetch window do whatever it does before concluding.
  await page.waitForTimeout(1200);

  expect(scripts.join("\n")).not.toMatch(/takehome\.js/);
  // …and none of the moved code is defined, which is what actually proves
  // script.js kept no eager copy (a copy would satisfy the request check).
  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => false));
});

test("ensureTakeHome() defines the whole take-home surface", async ({ page }) => {
  await page.goto("/");
  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => false)); // precondition

  await page.evaluate(() => window.CanamedLoader.ensureTakeHome());

  expect(await present(page)).toEqual(MOVED_GLOBALS.map(() => true));
  // Idempotent: a second call must not inject a duplicate <script>.
  await page.evaluate(() => window.CanamedLoader.ensureTakeHome());
  expect(await page.locator('script[src*="takehome.js"]').count()).toBe(1);
});

test("the moved code still reads script.js's top-level bindings by bare name", async ({ page }) => {
  /* The reason the split works without a context object: takehome.js is a
     CLASSIC script, so it shares the global script scope with script.js and
     sees its top-level `let`s (sessionNum, myRoom, clientId, …) unchanged.
     Those bindings are NOT window properties, so this is the one thing a
     window.*-based rewrite would have had to replace — assert it directly. */
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureTakeHome());
  const md = await page.evaluate(() => {
    window._test_setSessionNum("9137");
    window._test_setMyRoom("Room 3");
    return window.buildRoomTakeawayMarkdown({ teamName: "Les Bleus" });
  });
  expect(md, "sessionNum reached the chunk").toContain("9137");
  expect(md, "myRoom reached the chunk").toContain("Room 3");
  expect(md, "the snapshot's own fields still render").toContain("Les Bleus");
});

test("clicking the wrap-up button downloads the real takeaway markdown", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();

  /* Capture the Blob the export hands to the browser, rather than waiting on a
     "download" event. The exporter revokes its object URL on the same tick as
     the click, and headless download plumbing differs per engine — capturing at
     createObjectURL keeps this assertion about OUR code (click → lazy load →
     room read → markdown → blob) and lets it run identically on all five
     projects instead of skipping WebKit. */
  await page.evaluate(() => {
    const realCreate = URL.createObjectURL.bind(URL);
    window.__dl = { text: null, name: null };
    URL.createObjectURL = function (blob) {
      try { blob.text().then((t) => { window.__dl.text = t; }); } catch (e) { /* not a Blob */ }
      return realCreate(blob);
    };
    // Record the synthetic anchor's filename and swallow the click: letting a
    // real blob download fire would tear the context down mid-assertion on
    // some engines. Everything upstream of it is the app's own code.
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__dl.name = this.download;
    };
  });

  // Seed a room in the LocalDB the e2e suite runs on, then reveal the wrap-up
  // and wire it exactly as room entry does. `db` is a top-level `let`, so it is
  // reachable by bare name from page scope but NOT as window.db — which is the
  // same property the moved chunk depends on.
  await page.evaluate(async () => {
    window._test_setSessionNum("4242");
    window._test_setMyRoom("Room 1");
    window._test_setClientId("cid-me");
    window.dbInit();
    await db.ref(sPath("rooms/Room 1")).set({
      teamName: "Les Bleus",
      answers: {
        moduleA: {
          a1: { cid: "cid-me", by: "Akari", text: "My own point", at: 1 },
          a2: { cid: "cid-other", by: "Antoine", text: "A teammate's point", at: 2 }
        }
      }
    });
    // Un-hide the wrap-up stage (and its ancestors) so the button is clickable
    // for real rather than dispatched at a hidden node.
    for (let el = document.getElementById("stage-4"); el; el = el.parentElement) {
      if (el.classList) el.classList.remove("hidden");
    }
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    window.initEndPoll();
  });

  // Nothing loaded yet: the wiring is synchronous, the chunk is not.
  expect(await page.locator('script[src*="takehome.js"]').count()).toBe(0);

  await page.locator("#wrapup-download-btn").click();
  await page.waitForFunction(() => window.__dl && window.__dl.text, null, { timeout: 15000 });
  const out = await page.evaluate(() => window.__dl);

  expect(out.name).toBe("CaNaMED_Room 1_my-takeaway.md");
  const md = out.text;

  // The document a student walks away with, end to end.
  expect(md).toContain("# CaNaMED — my session takeaway");
  expect(md).toContain("- **Session:** 4242");
  expect(md).toContain("- **Room / team:** Room 1 — Les Bleus");
  expect(md).toContain("## My responses");
  expect(md).toContain("My own point");
  // …and it separates the student's OWN answers from the group's.
  expect(md).toContain("## Group answers (everyone in the room)");
  expect(md).toContain("A teammate's point");
  expect(md.slice(md.indexOf("## My responses"), md.indexOf("## Group answers")),
    "a teammate's answer must not land in the student's own section")
    .not.toContain("A teammate's point");

  // The click is what pulled the chunk in.
  expect(await page.locator('script[src*="takehome.js"]').count()).toBe(1);
});

test("a failed chunk load degrades to a toast, not a dead button", async ({ page }) => {
  await page.goto("/");

  /* The failure is injected at the loader, not with page.route: sw.js
     PRECACHES /takehome.js, so a routed abort is served from the service-worker
     cache anyway and the chunk loads (which is the precache entry working, and
     is asserted separately in tests/takehome-lazy-split.test.js). Rejecting
     ensureTakeHome() reproduces exactly what the shim sees on a 404 / CSP block
     / offline first-ever click, which is the branch under test. */
  await page.evaluate(() => {
    for (let el = document.getElementById("stage-4"); el; el = el.parentElement) {
      if (el.classList) el.classList.remove("hidden");
    }
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    window.CanamedLoader.ensureTakeHome = () => Promise.reject(new Error("offline"));
    window.initEndPoll();
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.locator("#wrapup-cert-btn").click();

  // The user is told, in words, rather than left clicking a silent button.
  await expect(page.locator("#toast")).toContainText(/couldn't prepare/i, { timeout: 8000 });
  expect(errors, "no ReferenceError escapes the click handler").toEqual([]);

  /* And the other half of the guard: a loader too old to know about the chunk
     (a stale cached shell) must fall into the same path, not throw. */
  await page.evaluate(() => {
    delete window.CanamedLoader.ensureTakeHome;
    const t = document.getElementById("toast");
    if (t) t.textContent = "";
    const b = document.getElementById("wrapup-booklet-btn");
    if (b) b.click();
  });
  await expect(page.locator("#toast")).toContainText(/couldn't prepare/i, { timeout: 8000 });
  expect(errors, "no ReferenceError from the missing-loader branch either").toEqual([]);
});
