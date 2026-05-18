/* tests/edge-cases.test.js
 *
 * Structural tests for fixes applied per
 * docs/Third_session/PBL_platform/ARCHITECTURE/SIMULATION_EDGE_CASES.md.
 *
 * script.js cannot be loaded in Node (it depends on window, document,
 * firebase, etc.), so we read it as text and assert that the load-bearing
 * patterns for each fix are present. This catches a regression where
 * someone removes the heartbeat / reset-flow / cache-bust suffix without
 * realising what they're for.
 *
 * For full behavioural coverage see tests-e2e/help-call-throttle.spec.js
 * (C20) and tests/rules.test.js (D21/D22 rule shape).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const LOADER = fs.readFileSync(path.join(ROOT, "script-loader.js"), "utf8");

// =============================================================
// D21 — super-admin password reset writes _superadminReset before
// overwriting an existing adminPasswordHash.
// =============================================================
test("script: joinSuperAdmin writes _superadminReset before overwriting hash", () => {
  // The fix gates an overwrite on a fresh reset flag (the rules also
  // enforce this; the client must cooperate by writing the flag first).
  // We look for the literal node name in script.js so a future rename
  // here breaks loudly.
  assert.match(SCRIPT, /_superadminReset/,
    "joinSuperAdmin must reference _superadminReset to satisfy the new rule");
  // The write order matters: refReset.set(...).then(() => refHash.set(...)).
  // Look for the canonical sequence (whitespace-tolerant).
  const seq = /refReset\.set\([^)]*\)[\s\S]*?\.then\(\(\) => refHash\.set\(h\)\)/;
  assert.match(SCRIPT, seq,
    "joinSuperAdmin must set the reset flag BEFORE writing the new hash");
});

test("script: change-pass-btn dashboard handler also uses the reset-flow", () => {
  // The super-admin dashboard's "change password" button shares the
  // same overwrite constraint and must use the same flag pattern.
  // We look for the literal _superadminReset reference inside the
  // change-pass-btn handler scope (we just assert two distinct
  // references exist in the file — one for joinSuperAdmin and one for
  // the dashboard handler).
  const occurrences = SCRIPT.split("_superadminReset").length - 1;
  assert.ok(occurrences >= 3,
    "Expected at least 3 references to _superadminReset (rationale comment + " +
    "joinSuperAdmin write + dashboard change-pass-btn write); got " + occurrences);
});

// =============================================================
// D22 — facilitator presence heartbeat.
// =============================================================
test("script: startAdmin installs _adminPresence heartbeat + onDisconnect", () => {
  assert.match(SCRIPT, /_adminPresence/,
    "startAdmin must reference _adminPresence");
  assert.match(SCRIPT, /onDisconnect\(\)\.remove\(\)/,
    "Heartbeat node must clear via onDisconnect so a closed tab is visible");
  // The interval cadence (30000ms) is documented in the rules freshness
  // budget (newData.at >= now - 120000 means up to 4 missed heartbeats).
  assert.match(SCRIPT, /setInterval\(writePresence, 30000\)/,
    "Heartbeat must refresh every 30s to stay within the freshness window");
});

test("script: students subscribe to facilitator presence + render stale banner", () => {
  assert.match(SCRIPT, /subscribeFacilitatorPresence/,
    "Student-side subscription helper must be defined");
  assert.match(SCRIPT, /FACILITATOR_STALE_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    "Stale threshold must be 5 minutes (10x the 30s heartbeat cadence)");
  assert.match(SCRIPT, /renderFacilitatorPresenceBanner/,
    "Banner renderer must exist for stale-detection UI");
});

test("index.html: facilitator-presence-banner element exists in the app view", () => {
  assert.match(INDEX, /id="facilitator-presence-banner"/,
    "DOM target for the facilitator-stale banner must exist");
  assert.match(INDEX, /role="status"/,
    "Banner should be aria-live polite (role=status), not alert");
});

// =============================================================
// E28 — cache-busting on first-party JS/CSS in index.html.
// =============================================================
test("index.html: every first-party script tag carries a ?v= cache-buster", () => {
  // Pull every <script src="…"> from index.html and check that first-party
  // sources (no host, .js extension) have ?v=…
  const re = /<script\s+src="([^"]+\.js)([^"]*)"/g;
  const missing = [];
  let m;
  while ((m = re.exec(INDEX)) !== null) {
    const src = m[1];
    const tail = m[2] || "";
    // skip third-party (https://) — those carry their own version in path
    if (/^https?:\/\//.test(src)) continue;
    if (!/\?v=/.test(tail)) missing.push(src);
  }
  assert.deepStrictEqual(missing, [],
    "First-party <script src> tags missing ?v= cache-buster: " + missing.join(", "));
});

test("index.html: style.css and theme-init.js carry the cache-buster", () => {
  assert.match(INDEX, /href="style\.css\?v=[^"]+"/,
    "style.css must carry ?v= cache-buster");
  assert.match(INDEX, /src="theme-init\.js\?v=[^"]+"/,
    "theme-init.js must carry ?v= cache-buster");
});

test("script-loader.js: lazy-loaded chunks also carry ?v= cache-buster", () => {
  assert.match(LOADER, /SHELL_VERSION\s*=\s*"[^"]+"/,
    "loader must define a SHELL_VERSION constant for chunk cache-busting");
  // Every ensureXxx() must route through v(…) so the suffix is uniform.
  // Cheap check: every loadScript("file.js") call should use v(…).
  const direct = LOADER.match(/loadScript\("[^"]+\.js"\)/g) || [];
  assert.deepStrictEqual(direct, [],
    "All ensure*() lazy loaders must wrap the URL in v(...) so chunks get ?v=: " + direct.join(", "));
});

// =============================================================
// R2-01 / R2-02 — script-room.js + script-admin.js placeholder
// removal (SIMULATION_ROUND2.md). The empty stubs were paired
// with ensureRoomRuntime() / ensureAdminRuntime() helpers that
// added a redundant HTTP round-trip per join with zero benefit
// because the would-be extracted code still lives in script.js.
// =============================================================
test("loader: ensureRoomRuntime / ensureAdminRuntime are gone (R2-01)", () => {
  // Strip block comments before inspecting — the loader header may
  // legitimately mention the removed helpers as a rationale note,
  // but no live `function ensureRoomRuntime` declaration or
  // `ensureRoomRuntime` export entry should survive.
  const code = LOADER.replace(/\/\*[\s\S]*?\*\//g, "")
                     .replace(/\/\/.*$/gm, "");
  assert.ok(!code.includes("ensureRoomRuntime"),
    "ensureRoomRuntime() helper must be removed from live loader code — see SIMULATION_ROUND2.md R2-01");
  assert.ok(!code.includes("ensureAdminRuntime"),
    "ensureAdminRuntime() helper must be removed from live loader code — see SIMULATION_ROUND2.md R2-01");
  // The literal chunk filenames must not appear in loadScript() calls.
  assert.ok(!/loadScript\([^)]*script-room/.test(code),
    "script-room.js must not be referenced by the loader anymore");
  assert.ok(!/loadScript\([^)]*script-admin/.test(code),
    "script-admin.js must not be referenced by the loader anymore");
});

test("loader: the four surviving ensure helpers are still exposed", () => {
  // Anti-regression — if a careless edit drops the wrong group of helpers
  // this catches the omission before script.js fails at runtime.
  for (const fn of ["ensureCaseContent", "ensureQrcode", "ensureTour", "ensureScenarioAuthor"]) {
    assert.ok(LOADER.includes(fn),
      "loader must still expose " + fn + "()");
  }
});

test("script.js: no leftover ensureRoomRuntime / ensureAdminRuntime call sites", () => {
  // Calling a removed helper would throw at the precise moment a user
  // joins, which is the worst possible time. Pin the cleanup here so a
  // future merge from a stale branch can't silently re-introduce the
  // call sites against the now-thinner loader namespace.
  assert.ok(!SCRIPT.includes("ensureRoomRuntime"),
    "script.js must not call window.CanamedLoader.ensureRoomRuntime() — see R2-01");
  assert.ok(!SCRIPT.includes("ensureAdminRuntime"),
    "script.js must not call window.CanamedLoader.ensureAdminRuntime() — see R2-01");
});

test("placeholder chunks are physically removed from the platform folder", () => {
  // The two placeholder files were 1-line IIFEs that did nothing. Keep
  // them removed; deleting the entry from the loader without deleting
  // the file would leave dead code on disk.
  const fileExists = (rel) => {
    try { return fs.statSync(path.join(ROOT, rel)).isFile(); }
    catch (_) { return false; }
  };
  assert.ok(!fileExists("script-room.js"),
    "script-room.js placeholder must be deleted from disk (R2-01)");
  assert.ok(!fileExists("script-admin.js"),
    "script-admin.js placeholder must be deleted from disk (R2-01)");
});

// =============================================================
// R2-03/04 helpers — assert the sw-register offline banner falls back
// through CanamedI18n -> window.t -> English when called at runtime
// (not at registration time), so an offline event that fires before
// the deferred i18n bundle finishes parsing still localises correctly.
// =============================================================
test("sw-register: offline banner resolves translator at call time, not registration", () => {
  const SW_REG = fs.readFileSync(path.join(ROOT, "sw-register.js"), "utf8");
  // Translator lookup must check window.CanamedI18n FIRST (the explicit
  // namespace), then window.t (the alias), then fall back to English.
  // Order matters because a future change that removes window.t but
  // keeps CanamedI18n must continue to work.
  assert.ok(SW_REG.includes("window.CanamedI18n"),
    "sw-register must consult window.CanamedI18n.t() so it isn't dependent on the bare window.t alias");
  assert.ok(SW_REG.includes("offline.banner"),
    "sw-register must request the offline.banner i18n key");
  // The translator must be resolved inside a function body called at the
  // event time, not captured at registration. Detect this by checking
  // that the lookup happens inside a helper function rather than at
  // top-level module initialisation.
  assert.match(SW_REG, /function\s+translateBanner\s*\(\)/,
    "sw-register must wrap the translator lookup in a helper so it runs at call time");
});

// =============================================================
// E30 — every localStorage.setItem call in script.js is wrapped in try.
// =============================================================
test("script: all localStorage.setItem calls are guarded against Safari-private quota errors", () => {
  // For each `localStorage.setItem(` site, walk backward looking for an
  // unbalanced `try {` (i.e. one not yet closed by `}`) and forward for
  // a matching `} catch`. This catches both single-line guards and the
  // wider function-scoped try/catch shape used by saveLastWorkshop /
  // saveResume. A naive "5 lines window" heuristic produces false
  // positives — the brace-balance check is reliable.
  const offenders = [];
  const lines = SCRIPT.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("localStorage.setItem")) continue;
    if (/try\s*\{[^}]*localStorage\.setItem/.test(line)) continue; // inline guard

    // Walk backward, counting unbalanced braces. A `try {` before our
    // line whose `}` hasn't been seen yet is the enclosing try.
    let depth = 0;
    let tryLine = -1;
    for (let j = i - 1; j >= 0 && j >= i - 80; j--) {
      const l = lines[j];
      // Count braces on this line (whole-line, comments are rare here).
      const opens = (l.match(/\{/g) || []).length;
      const closes = (l.match(/\}/g) || []).length;
      depth += closes - opens;
      // depth < 0 means we've climbed into an outer scope with an open
      // brace not yet matched. If that brace was preceded by `try`,
      // this is our guard.
      if (depth < 0) {
        if (/\btry\s*\{?\s*$/.test(l) || /\btry\s*\{/.test(l)) { tryLine = j; break; }
        // otherwise it's an unrelated outer scope — keep climbing
        depth = 0;
      }
    }
    if (tryLine < 0) {
      offenders.push("line " + (i + 1) + ": " + line.trim());
      continue;
    }
    // Walk forward and confirm a matching `catch` exists before the try
    // block closes. Start at the setItem line itself (k = i) so any
    // brace it opens (e.g. JSON.stringify({...})) is accounted for —
    // otherwise a multi-line literal closes fDepth prematurely.
    let fDepth = 1;
    let hasCatch = false;
    for (let k = i; k < Math.min(lines.length, i + 80); k++) {
      const l = lines[k];
      const opens = (l.match(/\{/g) || []).length;
      const closes = (l.match(/\}/g) || []).length;
      if (k === i) fDepth += opens - closes; // include setItem-line's own braces
      else fDepth += opens - closes;
      if (k > i && fDepth <= 0) {
        if (/\bcatch\s*\(/.test(l)) hasCatch = true;
        break;
      }
    }
    if (!hasCatch) offenders.push("line " + (i + 1) + ": " + line.trim());
  }
  assert.deepStrictEqual(offenders, [],
    "Every localStorage.setItem in script.js must be inside a try/catch (Safari private mode " +
    "throws QuotaExceededError on the FIRST byte). Offenders:\n" + offenders.join("\n"));
});

// =============================================================
// C20 — help-call client throttle is in place.
// =============================================================
test("script: initCallProf enforces a client-side help-call throttle", () => {
  assert.match(SCRIPT, /HELP_CALL_THROTTLE_MS\s*=\s*30000/,
    "Client-side throttle constant must remain at 30s (matches server rule)");
  assert.match(SCRIPT, /lastHelpCallAt/,
    "Throttle anchor variable must exist");
  // Cancel must also anchor the timer (without this, cancel-then-call
  // bypasses the throttle — the original C20 finding).
  const cancelAnchorsThrottle = /refCallForHelp\.remove\(\)/.test(SCRIPT) &&
    /lastHelpCallAt\s*=\s*Date\.now\(\)/.test(SCRIPT);
  assert.ok(cancelAnchorsThrottle,
    "Cancel branch must update lastHelpCallAt so cancel-then-call is throttled too");
});
