/* tests/admin-lazy-split.test.js
 *
 * Perf reclaim 2026-08-05: the FACILITATOR DASHBOARD engine — the admin shell
 * (enterAdminApp / startAdmin / renderPrestart / renderSidebar), the dashboard
 * (renderDashboard + filter + points panel + session signal), stage control
 * (startSession / setRoomStage / logAdminAction), help-call alerting, the
 * facilitator debrief, the impact report and the archive/close flow — was split
 * out of the eager script.js into the lazy script-admin.js, loaded by
 * CanamedLoader.ensureAdminApp() from _enterAdminAppLazy(). That is slice 2
 * ("Admin dashboard") of ARCHITECTURE/eager-bundle-reclaim-plan.md and it took
 * the splash first-party budget from 346.97 to 312.96 KB gz locally
 * (script.js alone 219.5 → 185.0), cap 347 → 313.
 *
 * These are the guards the reclaim plan's §7 calls non-negotiable — the same
 * set tests/takehome-lazy-split.test.js pins for slice 1:
 *   1. script.js keeps NO COPY. Without this, a future edit can restore an
 *      eager definition and every other assertion still passes — 14 unit test
 *      files now read the CONCATENATION of both files, so they cannot tell
 *      which one a function lives in, and the byte reclaim silently unwinds.
 *   2. No DUPLICATE top-level declaration across the two files. They share the
 *      global script scope (that sharing is the whole reason the split needs no
 *      context object), so a name declared with let/const in both is a
 *      redeclaration SyntaxError that only fires when the chunk evaluates —
 *      i.e. it takes down the entire dashboard, in production, at the moment a
 *      facilitator logs in to start a class.
 *   3. The loader + service-worker + perf-budget registrations exist. A chunk
 *      missing from sw.js is not precached; one missing from perf.spec.js's
 *      LAZY_CHUNKS would count against the splash budget if ever prefetched,
 *      making the reclaim invisible to the test that exists to protect it.
 *   4. Every eager reference into the chunk is typeof-guarded and degrades to a
 *      message, so a 404 or offline chunk cannot throw a ReferenceError out of
 *      a click handler in a live classroom.
 *   5. Nothing STILL EAGER but shared was dragged along: renderLeaderboard,
 *      renderStudentDebrief, getTheme/setTheme, logEvent and friends have
 *      student/splash callers and must stay in script.js.
 *
 * The functional side (the chunk is absent on the splash, present after the
 * facilitator login, and the dashboard actually renders and advances a stage)
 * is covered per device by tests-e2e/admin-lazy.spec.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(PLATFORM, "script-admin.js"), "utf8");
const LOADER = fs.readFileSync(path.join(PLATFORM, "script-loader.js"), "utf8");
const SW = fs.readFileSync(path.join(PLATFORM, "sw.js"), "utf8");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const PERF = fs.readFileSync(path.join(__dirname, "..", "tests-e2e", "perf.spec.js"), "utf8");

/* Every function the split moved. Each must be DEFINED in script-admin.js and
   DEFINED NOWHERE in script.js. Listed in source order — the order matters,
   because several repointed unit tests slice the concatenated source between
   two function anchors and would silently match an empty string if the move
   had reordered them. */
const MOVED = [
  "enterAdminApp",
  "beep",
  "checkCallAlerts",
  "startAdmin",
  "getExpectedTotalFor",
  "setExpectedTotalFor",
  "adminPresenceStatus",
  "adminRemoveStudent",
  "_scheduleAdminPresenceRefresh",
  "renderPrestart",
  "wireExpectedTotal",
  "wireTestAlertsBtn",
  "logAdminAction",
  "startSession",
  "setRoomStage",
  "stageMinutes",
  "roomProgress",
  "gini",
  "roomParticipation",
  "helpCallChime",
  "helpCallNotify",
  "openBugReportMailto",
  "isHelpAlertsMuted",
  "setHelpAlertsMuted",
  "maybeAlertHelpCall",
  "wireDashboardFilter",
  "roomMatchesFilter",
  "sessionSignal",
  "renderSessionSignal",
  "renderDashboard",
  "buildPointsPanel",
  "awardManual",
  "undoLastManual",
  "_debriefRoomList",
  "_debriefMakeBar",
  "_debriefSection",
  "_debriefEmpty",
  "_debriefRankingSection",
  "_debriefDecisionsSection",
  "_debriefPenaltiesSection",
  "_debriefConceptsSection",
  "_debriefFunnelSection",
  "_debriefTimeSection",
  "renderDebrief",
  "toggleDebrief",
  "renderSidebar",
  "openRoomAsAdmin",
  "backToDashboard",
  "closeSession",
  "downloadFullArchive",
  "recordProgramSession",
  "_sessionSummaryObj",
  "runAdminTool",
  "_knowledgeGain",
  "_impactMetrics",
  "_impactEsc",
  "generateImpactReport",
  "_archiveCsvCell",
  "_archiveSectionManifest",
  "_sessionArchiveData",
  "_sessionArchiveToCSV",
  "downloadSessionArchive"
];

/* Top-level bindings that moved with them. A `let`/`const` is the dangerous
   half of the move: unlike a function declaration, referencing one that has
   not loaded is not a soft `typeof` miss — and declaring it in BOTH files is a
   hard SyntaxError. */
const MOVED_BINDINGS = [
  "prevCallRooms", "baseTitle", "EXPECTED_TOTAL_KEY_PREFIX",
  "ADMIN_PRESENCE_BLIP_MS", "ADMIN_PRESENCE_GONE_MS", "adminSeenPool",
  "_adminPresenceRefreshTimer", "STAGE_MINUTES_BY_ROLE", "_helpCallSeen",
  "_helpAudioCtx", "BUG_REPORT_EMAIL", "HELP_MUTE_KEY", "dashboardFilter",
  "dashboardFilterWired", "DASHBOARD_FILTER_THRESHOLD", "pointsPanelOpen",
  "debriefVisible", "PROGRAM_SESSIONS_KEY", "PRINT_ICON_SVG",
  "ARCHIVE_EXPORT_VERSION"
];

/* Deliberately LEFT EAGER because they have student / splash callers. The
   reclaim plan's entry-point table names the first two as admin functions;
   reading the call sites says otherwise, and moving them would break a room. */
const STAYS_EAGER = [
  "renderLeaderboard",       // startRoom, renderScore, renderButtons, buildDecision
  "closeMySession",          // renderMySessions — the SPLASH "My sessions" list
  "renderStudentDebrief",    // renderClosedState ← startRoom
  "renderClosedState",       // startRoom, subscribeClosedListener
  "downloadMyData",          // joinParticipant — the Art. 15 participant export
  "logEvent",                // reveal, castVote, addAnswer … the whole room
  "getTheme",                // wireLanguageSwitcher — the splash
  "setTheme",                // wireLanguageSwitcher — the splash
  "roomSlotBuckets",         // downloadMyData
  "_debriefT",               // renderStudentDebrief
  "_debriefBucket",          // renderStudentDebrief
  "showLateBanner",          // startRoom
  "stageNow",                // renderStage
  "joinAdmin",               // the choke point that LOADS the chunk
  "joinSuperAdmin"           // ditto
];

test("every moved function is defined in script-admin.js", () => {
  for (const name of MOVED) {
    assert.match(ADMIN, new RegExp("^function " + name + "\\(", "m"),
      name + " must be a top-level function declaration in script-admin.js");
  }
});

test("script.js keeps NO eager copy of any moved function (the reclaim holds)", () => {
  for (const name of MOVED) {
    assert.doesNotMatch(SCRIPT, new RegExp("^function " + name + "\\(", "m"),
      name + " must NOT be re-declared in the eager script.js — that would " +
      "undo the byte reclaim while every behavioural test still passed, " +
      "because 14 unit files now read both files concatenated");
  }
});

test("script.js keeps NO eager copy of any moved top-level binding", () => {
  for (const name of MOVED_BINDINGS) {
    assert.match(ADMIN, new RegExp("^(?:let|const|var) " + name + "\\b", "m"),
      name + " must be declared in script-admin.js");
    assert.doesNotMatch(SCRIPT, new RegExp("^(?:let|const|var) " + name + "\\b", "m"),
      name + " must NOT be re-declared in the eager script.js");
  }
});

test("the shared room/splash functions were NOT dragged into the chunk", () => {
  /* The failure this catches is the opposite of a leftover copy: a future
     "tidy-up" moving one of these into the chunk would leave a student path
     calling a function that only exists after a facilitator login. */
  for (const name of STAYS_EAGER) {
    assert.match(SCRIPT, new RegExp("^function " + name + "\\(", "m"),
      name + " has student/splash callers and must stay in the eager script.js");
    assert.doesNotMatch(ADMIN, new RegExp("^function " + name + "\\(", "m"),
      name + " must NOT be moved into the admin chunk");
  }
});

test("script-admin.js is NOT an eager <script> tag in index.html", () => {
  assert.doesNotMatch(INDEX, /<script[^>]*src="script-admin\.js/,
    "script-admin.js must be injected by the loader, never shipped in the shell");
});

test("no top-level declaration is duplicated across script.js and script-admin.js", () => {
  /* The two files share the global script scope. A `let`/`const` in both is a
     redeclaration SyntaxError that surfaces only when the chunk evaluates —
     and this chunk evaluates at facilitator login, taking the whole dashboard
     down at once. */
  const decls = (src) => {
    const out = new Set();
    const re = /^(?:function|let|const|var)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
    return out;
  };
  const a = decls(SCRIPT);
  const dupes = [...decls(ADMIN)].filter((n) => a.has(n));
  assert.deepStrictEqual(dupes, [],
    "these names are declared in BOTH files: " + dupes.join(", "));
});

test("the loader exposes ensureAdminApp() and version-suffixes the chunk", () => {
  assert.match(LOADER, /function ensureAdminApp\(\)\s*\{\s*return loadScript\(v\("script-admin\.js"\)\)/,
    "ensureAdminApp must load the version-suffixed script-admin.js");
  assert.match(LOADER, /^\s*ensureAdminApp,\s*$/m,
    "ensureAdminApp must be on the public CanamedLoader namespace");
});

test("BOTH admin routes go through the single _enterAdminAppLazy shim", () => {
  /* The whole point of the shim is that there is ONE place the chunk is
     loaded. Two call sites would drift; the old code had exactly that
     duplication (`enterAdminApp(); startAdmin();` written twice). */
  /* Strip comments first — the shim's own rationale note quotes the pair. */
  const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const pairs = code.match(/enterAdminApp\(\);\s*startAdmin\(\);/g) || [];
  assert.strictEqual(pairs.length, 1,
    "exactly ONE `enterAdminApp(); startAdmin();` may remain in script.js — " +
    "the one inside _enterAdminAppLazy, after the chunk has resolved. Got " +
    pairs.length + ". A second one is a route that bypasses the chunk load " +
    "and throws a ReferenceError at facilitator login.");

  const routeBody = (name) => {
    const at = code.indexOf("function " + name + "(");
    assert.ok(at > 0, name + " must exist in the eager script.js");
    // up to the next top-level function declaration (comments already stripped,
    // or the shim's own rationale note would leak into joinSuperAdmin's body)
    const rest = code.slice(at + 10);
    const end = rest.search(/\n(?:async )?function [A-Za-z_$]/);
    return rest.slice(0, end === -1 ? rest.length : end);
  };
  for (const route of ["joinAdmin", "joinSuperAdmin"]) {
    const body = routeBody(route);
    assert.match(body, /_enterAdminAppLazy\(/,
      route + " must enter the dashboard through _enterAdminAppLazy()");
    assert.doesNotMatch(body, /enterAdminApp\(\);\s*startAdmin\(\);/,
      route + " must not call the pair directly — that bypasses the chunk load");
  }
  // …and the one survivor is inside the shim.
  const shim = SCRIPT.slice(SCRIPT.indexOf("function _enterAdminAppLazy("),
                            SCRIPT.indexOf("function _adminChunkFailedMsg("));
  assert.match(shim, /enterAdminApp\(\);\s*startAdmin\(\);/,
    "the shim must actually enter the dashboard once the chunk resolves");
});

test("the shim guards the load AND the definitions, and degrades to a message", () => {
  const at = SCRIPT.indexOf("function _enterAdminAppLazy(");
  assert.ok(at > 0, "_enterAdminAppLazy must exist");
  const fn = SCRIPT.slice(at, at + 1800);
  assert.match(fn, /typeof loader\.ensureAdminApp === "function"/,
    "a loader without ensureAdminApp must not throw (older cached shell)");
  assert.match(fn, /typeof enterAdminApp !== "function" \|\| typeof startAdmin !== "function"/,
    "the chunk may 'load' a truncated body — assert it defined the dashboard");
  assert.match(fn, /\.catch\([\s\S]{0,600}?toast\(/,
    "a failed load must surface a message, not a silent dead lobby");
  assert.match(fn, /joined = false/,
    "a failed load must reset `joined` or joinAdmin's own re-entry guard " +
    "wedges the facilitator out of retrying");
});

test("the three eager references into the chunk are typeof-guarded", () => {
  /* setRoomStage ×2 (initStageNav) + backToDashboard (initLeave). All three sit
     behind `if (isRoomAdmin)`, so they are unreachable without the chunk — but
     "advance the stage" is the one control a live classroom cannot lose
     silently, so they are guarded anyway. */
  const nav = SCRIPT.slice(SCRIPT.indexOf("function initStageNav("),
                           SCRIPT.indexOf("function initStageNav(") + 1200);
  const guards = nav.match(/typeof setRoomStage !== "function"/g) || [];
  assert.strictEqual(guards.length, 2,
    "both stage-nav handlers must guard setRoomStage; got " + guards.length);
  assert.match(nav, /_adminChunkMissing\(\)/,
    "the guard must route to the shared failure path, not fail silently");

  const leave = SCRIPT.slice(SCRIPT.indexOf("function initLeave("),
                             SCRIPT.indexOf("function initLeave(") + 600);
  assert.match(leave, /typeof backToDashboard !== "function"/,
    "the leave handler must guard backToDashboard");
  assert.match(leave, /_adminChunkMissing\(\)/,
    "the guard must route to the shared failure path");

  assert.match(SCRIPT, /function _adminChunkMissing\(\)[\s\S]{0,300}?toast\(/,
    "_adminChunkMissing must surface a toast");
});

test("script-admin.js is registered for precache and excluded from the splash budget", () => {
  assert.match(SW, /"\/script-admin\.js"/,
    "sw.js SHELL_ASSETS must precache /script-admin.js");
  assert.match(PERF, /"script-admin\.js"/,
    "perf.spec.js LAZY_CHUNKS must list script-admin.js, or a prefetch would " +
    "count against the splash budget the split exists to protect");
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
