/* tests-e2e/shell-csp-vendoring.spec.js
 *
 * Static guard for shell-integrity invariants that have no runtime
 * symptom until a real browser hits them:
 *
 *  1. CSP must allow sourcemap fetches from gstatic. DevTools fetches
 *     https://www.gstatic.com/firebasejs/.../firebase-*-compat.js.map, and
 *     those fetches are governed by `connect-src` (not `script-src`). If
 *     gstatic is missing from connect-src the console fills with CSP
 *     violations every time a facilitator opens DevTools mid-session.
 *
 *  2. The THREE-marker SHELL_VERSION lockstep (index.html ?v=,
 *     script-loader.js, sw.js) — bumping only some of them ships a
 *     half-busted cache to returning browsers. This is a documented
 *     footgun (see CLAUDE.md "Service-worker cache-versioning gotcha"),
 *     so it gets a test.
 *
 * Pure fs/crypto assertions: no page navigation, no network, no flake.
 */

// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(APP_DIR, f), "utf8");

test.describe("shell CSP + SHELL_VERSION lockstep", () => {
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
