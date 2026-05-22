/* tests/program-dashboard.test.js
 *
 * Program-level (cross-session) dashboard (2026-05-22). closeSession persists a
 * pseudonymous per-session summary — a durable DB copy (/summary, rules-guarded)
 * AND a local rollup (canamed_program_sessions, kept across close). admin-tools
 * .generateProgramDashboard() aggregates the local rollup into a program-level
 * report (cumulative students, sessions, equity/decision trend). Static checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const RULES = fs.readFileSync(path.join(P, "database.rules.json"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("closeSession persists a pseudonymous summary (local rollup + durable DB copy)", () => {
  assert.match(SCRIPT, /const PROGRAM_SESSIONS_KEY = "canamed_program_sessions"/, "rollup key must exist");
  assert.match(SCRIPT, /function recordProgramSession\(summary\)/, "recordProgramSession must exist");
  assert.match(SCRIPT, /function _sessionSummaryObj\(\)/, "summary builder must exist");
  // Wired into the close path.
  const cs = SCRIPT.slice(SCRIPT.indexOf("function closeSession"),
    SCRIPT.indexOf("function closeSession") + 4000);
  assert.match(cs, /recordProgramSession\(summary\)/, "close must record the local rollup");
  assert.match(cs, /sPath\("summary"\)\)\.set\(summary\)/, "close must write the durable DB summary");
  // Summary is aggregate only — no names/answers bodies.
  const sb = SCRIPT.slice(SCRIPT.indexOf("function _sessionSummaryObj"),
    SCRIPT.indexOf("function _sessionSummaryObj") + 600);
  assert.doesNotMatch(sb, /\bname\b|\.by\b/, "summary must not carry names");
  assert.match(sb, /participants|meanGini|decisionAccuracyPct/, "summary carries aggregate metrics");
});

test("/summary is rule-guarded (admin-write, auth-read) in both trees", () => {
  const count = (RULES.match(/"summary":/g) || []).length;
  assert.strictEqual(count, 2, "summary must be ruled in both trees (got " + count + ")");
  assert.match(RULES, /"summary":\s*\{\s*"\.read":\s*"auth != null"/, "summary readable by any authed user");
});

test("generateProgramDashboard aggregates the local rollup", () => {
  assert.match(TOOLS, /function generateProgramDashboard\(\)/, "the dashboard fn must exist");
  assert.match(TOOLS, /function programSessions\(\)/, "must read the program-session rollup");
  assert.match(TOOLS, /canamed_program_sessions/, "must read the rollup key");
  const fn = TOOLS.slice(TOOLS.indexOf("function generateProgramDashboard"),
    TOOLS.indexOf("// Expose on window"));
  assert.match(fn, /students trained \(cumulative\)/, "must show cumulative students");
  assert.match(fn, /sessions run/, "must show sessions run");
  assert.match(fn, /mean equity|Gini/, "must show the equity trend");
  assert.match(fn, /window\.print\(\)/, "must be printable");
  assert.match(fn, /No closed sessions/, "must handle the empty state");
});

test("the program button is wired + exposed + localised", () => {
  assert.match(HTML, /id="admin-program-btn"/, "the program button must exist");
  assert.match(SCRIPT, /runAdminTool\("generateProgramDashboard"\)/, "the button must be wired");
  assert.match(TOOLS, /window\.generateProgramDashboard = generateProgramDashboard/, "must be exposed");
  const n = (I18N.match(/"impact\.program":/g) || []).length;
  assert.ok(n >= 3, "impact.program must be defined in en, fr and ja (got " + n + ")");
});
