/* tests-e2e/shell-csp-vendoring.spec.js
 *
 * Static guard for two shell-integrity invariants that have no runtime
 * symptom until a real browser hits them:
 *
 *  1. CSP must allow sourcemap fetches from gstatic. DevTools fetches
 *     https://www.gstatic.com/firebasejs/.../firebase-*-compat.js.map, and
 *     those fetches are governed by `connect-src` (not `script-src`). If
 *     gstatic is missing from connect-src the console fills with CSP
 *     violations every time a facilitator opens DevTools mid-session.
 *
 *  2. Firebase Performance SDK is vendored first-party (fb-timings.min.js),
 *     NOT loaded from the gstatic firebase-performance-compat.js URL, which
 *     privacy/ad blockers ERR_BLOCKED_BY_CLIENT. The vendored bytes must be
 *     the genuine SDK — asserted by matching the file's sha384 against the
 *     SRI hash in index.html.
 *
 * Also guards the THREE-marker SHELL_VERSION lockstep (index.html ?v=,
 * script-loader.js, sw.js) — bumping only some of them ships a half-busted
 * cache to returning browsers. This is a documented footgun (see CLAUDE.md
 * "Service-worker cache-versioning gotcha"), so it gets a test.
 *
 * Pure fs/crypto assertions: no page navigation, no network, no flake.
 */

// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_DIR = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(APP_DIR, f), "utf8");

const PERF_SDK_FILE = "fb-timings.min.js";
const GSTATIC_PERF_URL = "firebasejs/10.12.5/firebase-performance-compat.js";

test.describe("shell CSP + perf-SDK vendoring", () => {
  test("CSP connect-src allows gstatic in BOTH the meta and the header", () => {
    // index.html <meta> fallback CSP
    const html = read("index.html");
    const metaConnect = html.match(/connect-src([^;]*);/);
    expect(metaConnect, "connect-src directive in index.html meta").not.toBeNull();
    expect(metaConnect[1]).toContain("https://www.gstatic.com");

    // firebase.json production response header (the authoritative one)
    const fbJson = read("firebase.json");
    const headerConnect = fbJson.match(/connect-src([^;]*);/);
    expect(headerConnect, "connect-src directive in firebase.json header").not.toBeNull();
    expect(headerConnect[1]).toContain("https://www.gstatic.com");
  });

  // matches src="fb-timings.min.js" with an optional ?v=vNN cache-buster
  const PERF_SRC_RE = /src="fb-timings\.min\.js(?:\?v=v\d+)?"/;

  test("perf SDK is vendored first-party, not loaded from gstatic", () => {
    const html = read("index.html");
    expect(html).toMatch(PERF_SRC_RE);
    // must NOT regress to the blocker-tripping gstatic URL
    expect(html).not.toContain(GSTATIC_PERF_URL);
    // and the file must actually exist on disk
    expect(fs.existsSync(path.join(APP_DIR, PERF_SDK_FILE))).toBe(true);
  });

  test("vendored perf SDK bytes match the SRI hash in index.html", () => {
    const html = read("index.html");
    // grab the integrity attr on the fb-timings.min.js script tag
    const tag = html.match(
      /<script[^>]*src="fb-timings\.min\.js(?:\?v=v\d+)?"[^>]*>/i
    );
    expect(tag, "fb-timings.min.js script tag").not.toBeNull();
    const sri = tag[0].match(/integrity="sha384-([^"]+)"/);
    expect(sri, "integrity attr on perf SDK tag").not.toBeNull();

    const bytes = fs.readFileSync(path.join(APP_DIR, PERF_SDK_FILE));
    const actual = crypto.createHash("sha384").update(bytes).digest("base64");
    expect(actual).toBe(sri[1]);
  });

  test("vendored perf SDK is in the service-worker precache list", () => {
    const sw = read("sw.js");
    expect(sw).toContain(`"/${PERF_SDK_FILE}"`);
  });

  test("SHELL_VERSION is in lockstep across index.html, script-loader.js and sw.js", () => {
    const html = read("index.html");
    const loader = read("script-loader.js");
    const sw = read("sw.js");

    // every ?v= query in index.html must be the same version
    const htmlVersions = [...html.matchAll(/\?v=(v\d+)/g)].map((m) => m[1]);
    expect(htmlVersions.length, "index.html should have ?v= versioned assets").toBeGreaterThan(0);
    const htmlVersion = htmlVersions[0];
    for (const v of htmlVersions) expect(v).toBe(htmlVersion);

    const loaderVersion = (loader.match(/SHELL_VERSION\s*=\s*"(v\d+)"/) || [])[1];
    const swVersion = (sw.match(/SHELL_VERSION\s*=\s*"canamed-shell-(v\d+)"/) || [])[1];

    expect(loaderVersion, "script-loader.js SHELL_VERSION").toBe(htmlVersion);
    expect(swVersion, "sw.js SHELL_VERSION").toBe(htmlVersion);
  });
});
