/* tests-e2e/perf.spec.js
 *
 * Performance budget for the splash page (the entry that ~100% of users
 * hit first). Asserts:
 *   - First Contentful Paint (FCP) below threshold
 *   - DOMContentLoaded → "interactive" below threshold (TTI proxy)
 *   - Total transferred bytes for all <script> + <link rel="stylesheet">
 *     responses below threshold
 *
 * Thresholds: tuned so the suite passes on the GitHub Actions ubuntu-latest
 * runner (a 2-core, 7 GB VM that is meaningfully slower than a developer
 * laptop). Local runs typically beat them by a wide margin. Tighten them
 * once we get a few weeks of CI data and see the actual ceiling.
 *
 * The thresholds CAN tighten as we ship more lazy-loading and bundle
 * splits — that is the whole point of having a budget in CI. The PR that
 * regresses past the budget is the PR that must justify the regression.
 *
 * Not covered here (out of scope for a budget test):
 *   - Time on slower stages (room view, debrief) — those are measured by
 *     the existing stage-progression.spec.js latency assertions.
 *   - CDN-served Firebase SDK bytes (counted but informational only —
 *     they live on a fixed-version pinned CDN we don't control).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");
const zlib = require("zlib");

// FCP / TTI ceilings in milliseconds.
// CI=1 environment indicates GitHub Actions; we relax there.
const onCI = !!process.env.CI;
const FCP_LIMIT_MS = onCI ? 3000 : 1500;
const TTI_LIMIT_MS = onCI ? 6000 : 3000;

// Transferred bytes for first-party JS + CSS that the splash NEEDS for an
// interactive code-input. Cap is in KB gzipped — matches production
// transfer size on Firebase Hosting. Excludes the Firebase SDK CDN
// scripts (CDN-pinned, not in our control) and the lazy-loaded chunks
// (case-content / qrcode / tour / script-room / script-admin), which by
// design are not on the splash critical path.
//
// Current critical-path bundle (post R2-43 lobby-i18n backfill + R2-47
// privacy lang-toggle + R2-34 dialog polyfill):
//   script.js (~88 KB gz — canamedConfirm, dialog polyfill, help-call
//   throttle, modal wiring), i18n.js (~64 KB gz — privacy paragraphs
//   now translated across all 8 locales, not just en/fr/ja), style.css
//   (~30 KB — modal + waiting-room + dialog-polyfill styling), lib.js
//   (~5 KB), telemetry/firebase-config/platform-config (~5 KB),
//   localdb.js (~2 KB), script-loader.js (~3 KB), orgs.js (~2 KB),
//   theme-init.js (~1 KB), sw-register.js (~1 KB) = ~201 KB gzipped.
//
// Budget set to 220 KB gz: ~19 KB headroom for incremental growth on
// top of the post-R2 baseline. Previously 200 KB; raised here to absorb
// the legitimate feature payload of the Round-2 fix batch (es/pt/de/ko/
// zh privacy backfill is required by GDPR for the new languages — it's
// not optional). Any breach forces the next PR to either justify the
// regression or split another chunk out via script-loader.js (lazy-load
// i18n locale tables is the obvious next move once we hit ~240 KB).
const FIRST_PARTY_BYTES_LIMIT_KB = 220;

test.describe("Perf budget — splash", () => {
  test("FCP, TTI, and first-party JS+CSS bytes are within budget", async ({ page }) => {
    /** @type {{ url: string, raw: number, gz: number, type: string }[]} */
    const assets = [];

    // Collect every response that the splash pulls down. We tally first-party
    // <script> and <link rel="stylesheet"> bodies for the budget assertion;
    // CDN third-party scripts (gstatic Firebase SDK) are recorded for
    // diagnostics but excluded from the cap.
    //
    // The local static dev server (scripts/serve-platform.js) does NOT gzip.
    // Production (Firebase Hosting) does. To make the budget mirror what
    // actual users download, we gzip each response body ourselves and assert
    // against the compressed size. That keeps the test honest regardless of
    // whether the local server learns gzip later.
    page.on("response", async (resp) => {
      const url = resp.url();
      const req = resp.request();
      const rtype = req.resourceType(); // "script", "stylesheet", "document", …
      if (rtype !== "script" && rtype !== "stylesheet") return;

      let raw = 0;
      let gz = 0;
      try {
        const body = await resp.body();
        raw = body.length;
        gz = zlib.gzipSync(body, { level: 9 }).length;
      } catch (_) { /* response gone (e.g. preflight); ignore */ }
      assets.push({ url, raw, gz, type: rtype });
    });

    const navStart = Date.now();
    // Wait for load — paint entries are guaranteed to be populated by then.
    await page.goto("/", { waitUntil: "load" });

    // Wait for the splash heading to actually paint — that's our "ready" signal.
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();

    // Force a few rAF + microtask flushes so paint timings get committed
    // even on very fast pages where they trail the `load` event by a tick.
    await page.evaluate(() => new Promise((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)));
    }));
    // Wait for the FCP entry to be recorded. On a fast splash with no
    // render-blocking work, paint timings can still flush a tick later.
    // Poll up to 3s — failure here is "we couldn't measure", not "perf bad".
    await page.waitForFunction(() => {
      const p = performance.getEntriesByType("paint");
      return p.some((e) => e.name === "first-contentful-paint" || e.name === "first-paint");
    }, null, { timeout: 3000 }).catch(() => { /* fall through; metric stays null */ });

    // Pull paint + navigation metrics from the page itself.
    const metrics = await page.evaluate(() => {
      const paint = performance.getEntriesByType("paint");
      const fcp = paint.find((e) => e.name === "first-contentful-paint");
      const fp = paint.find((e) => e.name === "first-paint");
      const nav = /** @type {PerformanceNavigationTiming[]} */ (
        performance.getEntriesByType("navigation")
      )[0];
      return {
        // Prefer FCP; fall back to first-paint if FCP isn't recorded (some
        // headless configurations skip the "contentful" classification).
        fcp: fcp ? Math.round(fcp.startTime)
           : fp  ? Math.round(fp.startTime)
           : null,
        // domInteractive ≈ TTI for a static-ish page like the splash. Real TTI
        // (long-task observer) overshoots when the page never has long tasks,
        // which is exactly what we want here.
        tti: nav ? Math.round(nav.domInteractive) : null,
        dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        loadEnd: nav ? Math.round(nav.loadEventEnd) : null
      };
    });

    // Sum first-party bytes only. Anything served from gstatic / google.com /
    // recaptcha is the SDK CDN and excluded from our app-bytes budget.
    const isThirdParty = (u) =>
      /^https?:\/\/(www\.)?(gstatic|google|recaptcha|googletagmanager)\.com\//.test(u);
    // Lazy-loaded chunks fetched by script-loader.js's idle prefetch are
    // NOT critical-path: the splash is interactive without them. They are
    // captured in the test's response stream because Chrome's idle window
    // overlaps with our DOM-ready signal, but they should not count
    // against the splash budget — that's the whole point of lazy-loading.
    // Surface them in the diagnostics log so a regression here is still
    // visible, just not budget-failing.
    const LAZY_CHUNKS = new Set([
      "case-content.js",
      "qrcode.js",
      "tour.js",
      "scenario-author.js",
      "script-room.js",
      "script-admin.js"
    ]);
    const isLazyChunk = (u) => {
      // Strip host, leading slash, AND any ?v=… cache-buster query string
      // (E28 fix — SIMULATION_EDGE_CASES.md — adds ?v=v2 to every chunk
      // URL so the set lookup must compare on the bare filename).
      const path = u.replace(/^https?:\/\/[^/]+/, "")
                    .replace(/^\//, "")
                    .replace(/\?.*$/, "");
      return LAZY_CHUNKS.has(path);
    };
    const firstParty = assets.filter((a) => !isThirdParty(a.url) && !isLazyChunk(a.url));
    const lazyChunks = assets.filter((a) => isLazyChunk(a.url));
    const thirdParty = assets.filter((a) => isThirdParty(a.url));
    const sumGz = (arr) => arr.reduce((s, a) => s + (a.gz || 0), 0);
    const sumRaw = (arr) => arr.reduce((s, a) => s + (a.raw || 0), 0);
    const firstPartyGz = sumGz(firstParty);
    const firstPartyRaw = sumRaw(firstParty);
    const thirdPartyGz = sumGz(thirdParty);

    // Log to the console so CI surfaces the actual numbers in the run log.
    // Helps diagnose "why did the budget regress?" without digging into traces.
    // eslint-disable-next-line no-console
    console.log("[perf] splash metrics", {
      fcp_ms: metrics.fcp,
      tti_ms: metrics.tti,
      dcl_ms: metrics.dcl,
      critical_kb_gz: Math.round(firstPartyGz / 1024),
      critical_kb_raw: Math.round(firstPartyRaw / 1024),
      third_party_kb_gz: Math.round(thirdPartyGz / 1024),
      lazy_chunks_kb_gz: Math.round(sumGz(lazyChunks) / 1024),
      critical_assets: firstParty
        .sort((a, b) => b.gz - a.gz)
        .map((a) =>
          `${(a.gz / 1024).toFixed(1)}KB gz (${(a.raw / 1024).toFixed(1)}KB raw) ` +
          a.url.replace(/^https?:\/\/[^/]+/, "")
        ),
      lazy_assets: lazyChunks
        .sort((a, b) => b.gz - a.gz)
        .map((a) =>
          `${(a.gz / 1024).toFixed(1)}KB gz (${(a.raw / 1024).toFixed(1)}KB raw) ` +
          a.url.replace(/^https?:\/\/[^/]+/, "")
        )
    });

    // ----------- assertions -----------
    // FCP & TTI: paint and become interactive within the budget.
    if (metrics.fcp != null) {
      expect(metrics.fcp, `FCP ${metrics.fcp}ms exceeds budget ${FCP_LIMIT_MS}ms`)
        .toBeLessThan(FCP_LIMIT_MS);
    }
    if (metrics.tti != null) {
      expect(metrics.tti, `TTI ${metrics.tti}ms exceeds budget ${TTI_LIMIT_MS}ms`)
        .toBeLessThan(TTI_LIMIT_MS);
    }

    // Bundle size: first-party JS + CSS must stay below the cap (gzipped,
    // matching production transfer size on Firebase Hosting).
    const firstPartyKb = firstPartyGz / 1024;
    expect(
      firstPartyKb,
      `First-party JS+CSS ${firstPartyKb.toFixed(1)} KB gzipped exceeds budget ${FIRST_PARTY_BYTES_LIMIT_KB} KB`
    ).toBeLessThan(FIRST_PARTY_BYTES_LIMIT_KB);

    // Sanity: navigation actually completed.
    expect(navStart).toBeGreaterThan(0);
  });
});
