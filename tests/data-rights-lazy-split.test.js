/* tests/data-rights-lazy-split.test.js
 *
 * Perf reclaim 2026-09-08: the GDPR Art. 15 participant self-export
 * (downloadMyData) was split out of the eager script.js into the lazy
 * data-rights.js, loaded by CanamedLoader.ensureDataRights() from the one
 * click that can reach it (#gdpr-export-btn, via _wireDataRightsExport()).
 * It is the reclaim the perf-budget header named on 2026-09-03 and again on
 * 2026-09-07, after two consecutive cap bumps without one.
 *
 * Same four non-negotiable guards as tests/takehome-lazy-split.test.js:
 *   1. script.js keeps NO COPY — otherwise the byte reclaim silently unwinds
 *      while every behavioural test still passes.
 *   2. No DUPLICATE top-level declaration across the two files (they share the
 *      global script scope; a let/const in both is a SyntaxError that fires
 *      only when the chunk evaluates — on the participant's click).
 *   3. The loader, service-worker and perf-budget registrations exist.
 *   4. The click site is typeof-guarded and degrades to a toast.
 * The functional side (absent on the splash, present after the click, and the
 * file is the real export) is tests-e2e/data-rights-lazy.spec.js, per device.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const CHUNK = fs.readFileSync(path.join(PLATFORM, "data-rights.js"), "utf8");
const LOADER = fs.readFileSync(path.join(PLATFORM, "script-loader.js"), "utf8");
const SW = fs.readFileSync(path.join(PLATFORM, "sw.js"), "utf8");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const PERF = fs.readFileSync(path.join(__dirname, "..", "tests-e2e", "perf.spec.js"), "utf8");

test("downloadMyData is defined in data-rights.js and NOWHERE in script.js", () => {
  assert.match(CHUNK, /^function downloadMyData\(\)/m);
  assert.doesNotMatch(SCRIPT, /^function downloadMyData\(/m,
    "script.js must not re-declare it — that would undo the reclaim silently");
});

test("the moved block is the whole export: envelope, rooms walk, identified-user reads, download", () => {
  /* The payload must be byte-for-byte what it was — these are the fields the
     archive-export-v2 and r3-blockers suites (now reading the chunk) rely on. */
  for (const needle of [
    'type: "participant-self-export-art-15-gdpr"',
    "roomSlotBuckets(r).forEach(",
    "tests: {}", "manualScoresAboutMe: []", "helpCallsByMe: []",
    'db.ref("users/" + currentUser.uid + "/profile")',
    'a.download = "canamed-my-data-" + sessionNum'
  ]) assert.ok(CHUNK.includes(needle), needle);
});

test("no top-level declaration is duplicated across script.js and data-rights.js", () => {
  const decls = (src) => {
    const out = new Set();
    const re = /^(?:function|let|const|var)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
    return out;
  };
  const a = decls(SCRIPT);
  const dupes = [...decls(CHUNK)].filter((n) => a.has(n));
  assert.deepStrictEqual(dupes, [], "declared in BOTH files: " + dupes.join(", "));
});

test("data-rights.js is NOT an eager <script> tag in index.html", () => {
  assert.doesNotMatch(INDEX, /<script[^>]*src="\/?data-rights\.js/);
});

test("the loader exposes ensureDataRights() and version-suffixes the chunk", () => {
  assert.match(LOADER, /function ensureDataRights\(\)\s*\{\s*return loadScript\(v\("data-rights\.js"\)\)/);
  assert.match(LOADER, /^\s*ensureDataRights,\s*$/m, "must be on the public CanamedLoader namespace");
});

test("the one click site goes through the guarded shim, which degrades to a toast", () => {
  assert.match(SCRIPT, /_wireDataRightsExport\(gdprBtn\);/, "the waiting-screen button is wired through the shim");
  assert.doesNotMatch(SCRIPT, /addEventListener\("click", downloadMyData\)/, "no bare reference — the chunk may not have loaded");
  const at = SCRIPT.indexOf("function _wireDataRightsExport(");
  assert.ok(at > 0);
  const fn = SCRIPT.slice(at, at + 1200);
  assert.match(fn, /loader && loader\.ensureDataRights \?/, "a loader without the method (older cached shell) must not throw");
  assert.match(fn, /typeof fn !== "function"/, "the handler reference is typeof-guarded");
  assert.match(fn, /\.catch\(fail\)/, "a failed load surfaces the export-failed toast");
  assert.match(fn, /"data-rights\.err\.export-failed"/);
});

test("data-rights.js is registered for precache and excluded from the splash budget", () => {
  assert.match(SW, /"\/data-rights\.js"/, "sw.js SHELL_ASSETS must precache it");
  const a = PERF.indexOf("const LAZY_CHUNKS");
  const lazy = PERF.slice(a, PERF.indexOf("])", a));
  assert.match(lazy, /"data-rights\.js"/, "perf.spec.js LAZY_CHUNKS must list it, or a prefetch counts against the budget");
});
