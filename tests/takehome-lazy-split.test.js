/* tests/takehome-lazy-split.test.js
 *
 * Perf reclaim 2026-08-04: the wrap-up TAKE-HOME block — the takeaway Markdown
 * (buildRoomTakeawayMarkdown + downloadMyRoomAnswers), the certificate PDF
 * (downloadCertificatePdf + _verifyUrl) and the study booklet (_booklet* +
 * downloadStudyBookletPdf) — was split out of the eager script.js into the lazy
 * takehome.js, loaded by CanamedLoader.ensureTakeHome() from initEndPoll()'s
 * three click handlers. That is slice 1 ("Take-out") of
 * ARCHITECTURE/eager-bundle-reclaim-plan.md and it took the splash first-party
 * budget from 352.4 to 346.3 KB gz locally (350.8 → 344.8 LF-normalised, the
 * number CI reads).
 *
 * These are the guards the reclaim plan's §7 calls non-negotiable:
 *   1. script.js keeps NO COPY. Without this, a future edit can restore an
 *      eager definition and every other assertion still passes — the eager and
 *      lazy files simply both define it, and the byte reclaim silently unwinds.
 *   2. No DUPLICATE top-level declaration across the two files. They share the
 *      global script scope (that sharing is the whole reason the split works
 *      without a context object), so a name declared with let/const in both is
 *      a redeclaration SyntaxError that only fires when the chunk evaluates —
 *      i.e. it takes down the wrap-up downloads, in production, at wrap-up.
 *   3. The loader + service-worker + perf-budget registrations exist. A chunk
 *      that is not in sw.js is not precached; one that is not in perf.spec.js's
 *      LAZY_CHUNKS still counts against the splash budget if it is ever
 *      prefetched, which would make the reclaim invisible to the test.
 *   4. Every eager call site is typeof/`window[...]`-guarded, so a 404 or an
 *      offline chunk surfaces a toast instead of throwing a ReferenceError out
 *      of a click handler.
 *
 * The functional side (the chunk is absent on the splash, present after the
 * click, and the downloaded Markdown is the real takeaway) is covered per
 * device by tests-e2e/takehome-lazy.spec.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const TAKEHOME = fs.readFileSync(path.join(PLATFORM, "takehome.js"), "utf8");
const LOADER = fs.readFileSync(path.join(PLATFORM, "script-loader.js"), "utf8");
const SW = fs.readFileSync(path.join(PLATFORM, "sw.js"), "utf8");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const PERF = fs.readFileSync(path.join(__dirname, "..", "tests-e2e", "perf.spec.js"), "utf8");

/* Every function the split moved. Each must be DEFINED in takehome.js and
   DEFINED NOWHERE in script.js. */
const MOVED = [
  "_mdEsc",
  "_caseItemById",
  "downloadCertificatePdf",
  "_verifyUrl",
  "_textWithLinks",
  "_bookletBlocks",
  "_collectBookletSections",
  "_bookletTeamData",
  "downloadStudyBookletPdf",
  "buildRoomTakeawayMarkdown",
  "downloadMyRoomAnswers"
];

test("every moved function is defined in takehome.js", () => {
  for (const name of MOVED) {
    assert.match(TAKEHOME, new RegExp("^function " + name + "\\(", "m"),
      name + " must be a top-level function declaration in takehome.js");
  }
});

test("script.js keeps NO eager copy of any moved function (the reclaim holds)", () => {
  for (const name of MOVED) {
    assert.doesNotMatch(SCRIPT, new RegExp("^function " + name + "\\(", "m"),
      name + " must NOT be re-declared in the eager script.js — that would " +
      "undo the byte reclaim while every behavioural test still passed");
  }
});

test("takehome.js is NOT an eager <script> tag in index.html", () => {
  assert.doesNotMatch(INDEX, /<script[^>]*src="takehome\.js/,
    "takehome.js must be injected by the loader, never shipped in the shell");
});

test("no top-level declaration is duplicated across script.js and takehome.js", () => {
  /* The two files share the global script scope. A `let`/`const` in both is a
     redeclaration SyntaxError that surfaces only when the chunk evaluates. */
  const decls = (src) => {
    const out = new Set();
    const re = /^(?:function|let|const|var)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
    return out;
  };
  const a = decls(SCRIPT);
  const dupes = [...decls(TAKEHOME)].filter((n) => a.has(n));
  assert.deepStrictEqual(dupes, [],
    "these names are declared in BOTH files: " + dupes.join(", "));
});

test("the loader exposes ensureTakeHome() and version-suffixes the chunk", () => {
  assert.match(LOADER, /function ensureTakeHome\(\)\s*\{\s*return loadScript\(v\("takehome\.js"\)\)/,
    "ensureTakeHome must load the version-suffixed takehome.js");
  assert.match(LOADER, /^\s*ensureTakeHome,\s*$/m,
    "ensureTakeHome must be on the public CanamedLoader namespace");
});

test("initEndPoll wires all three wrap-up buttons through the lazy shim", () => {
  const at = SCRIPT.indexOf("function initEndPoll(");
  assert.ok(at > 0, "initEndPoll must exist");
  const body = SCRIPT.slice(at, SCRIPT.indexOf("\nfunction _wireTakeHomeButton", at));
  for (const [id, fn] of [
    ["wrapup-download-btn", "downloadMyRoomAnswers"],
    ["wrapup-cert-btn", "downloadCertificatePdf"],
    ["wrapup-booklet-btn", "downloadStudyBookletPdf"]
  ]) {
    assert.ok(body.includes('_wireTakeHomeButton("' + id + '", "' + fn + '")'),
      id + " must be wired to " + fn + " through the lazy shim");
  }
  // the admin still gets the student export hidden, not wired
  assert.match(body, /isRoomAdmin[\s\S]{0,160}?wrapup-download-btn[\s\S]{0,40}?add\("hidden"\)/,
    "the student export must still be hidden for admins");
});

test("the shim guards the load AND the handler, and degrades to a toast", () => {
  const at = SCRIPT.indexOf("function _wireTakeHomeButton(");
  assert.ok(at > 0, "_wireTakeHomeButton must exist");
  const fn = SCRIPT.slice(at, at + 1400);
  assert.match(fn, /loader\.ensureTakeHome\s*\?/,
    "a loader without ensureTakeHome must not throw (older cached shell)");
  assert.match(fn, /typeof fn !== "function"/,
    "the handler reference must be typeof-guarded — the chunk may have 404'd");
  assert.match(fn, /\.catch\([\s\S]{0,300}?toast\(/,
    "a failed load must surface a toast, not a silent dead button");
});

test("takehome.js is registered for precache and excluded from the splash budget", () => {
  assert.match(SW, /"\/takehome\.js"/, "sw.js SHELL_ASSETS must precache /takehome.js");
  assert.match(PERF, /"takehome\.js"/,
    "perf.spec.js LAZY_CHUNKS must list takehome.js, or a prefetch would count " +
    "against the splash budget the split exists to protect");
});

test("the three shell-version markers agree (a changed chunk needs the bump)", () => {
  const sw = /canamed-shell-(v\d+)/.exec(SW);
  const loader = /SHELL_VERSION = "(v\d+)"/.exec(LOADER);
  assert.ok(sw && loader, "both SHELL_VERSION markers must be readable");
  assert.strictEqual(loader[1], sw[1], "sw.js and script-loader.js must agree");
  const stale = INDEX.match(/\?v=v\d+/g) || [];
  for (const s of stale) {
    assert.strictEqual(s, "?v=" + sw[1],
      "every ?v= in index.html must carry the current shell version");
  }
});
