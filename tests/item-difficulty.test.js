/* tests/item-difficulty.test.js
 *
 * Item-difficulty / curriculum-feedback analytics (2026-05-22). Each session
 * summary now carries a per-decision correct-rate map (decAcc); admin-tools
 * .generateItemDifficulty() aggregates it across the program rollup + the live
 * session, keyed by decision id, sorted hardest-first with a reteach flag.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

test("the session summary carries a per-decision correct-rate map (decAcc)", () => {
  assert.match(SCRIPT, /decAgg\.push\(\{ id: dec\.id/, "decAgg must carry the decision id");
  const ss = SCRIPT.slice(SCRIPT.indexOf("function _sessionSummaryObj"),
    SCRIPT.indexOf("function runAdminTool"));
  assert.match(ss, /decAcc:/, "summary must include a decAcc map");
  assert.match(ss, /correctRooms \/ d\.committedRooms/, "decAcc must be the per-decision correct-rate");
});

test("generateItemDifficulty aggregates by decision id, hardest-first, with a reteach flag", () => {
  assert.match(TOOLS, /function itemDifficultyRows\(\)/, "itemDifficultyRows must exist");
  assert.match(TOOLS, /function generateItemDifficulty\(\)/, "generateItemDifficulty must exist");
  const fn = TOOLS.slice(TOOLS.indexOf("function itemDifficultyRows"),
    TOOLS.indexOf("// Expose on window"));
  assert.match(fn, /programSessions\(\)/, "must aggregate across the program rollup");
  assert.match(fn, /s\.decAcc/, "must read each session's decAcc map");
  assert.match(fn, /window\._impactMetrics\(\)\.decAgg|_impactMetrics\(\)/, "must also fold in the live session");
  assert.match(fn, /a\.pct - b\.pct/, "must sort hardest-first (ascending accuracy)");
  assert.match(fn, /reteach/, "must flag low-accuracy items to reteach");
  assert.match(TOOLS, /window\.generateItemDifficulty = generateItemDifficulty/, "must be exposed");
});

test("the item-difficulty generator is localised (button removed from the lean menu 2026-06-25)", () => {
  assert.doesNotMatch(HTML, /id="admin-itemdiff-btn"/, "the item-difficulty button is gone from the lean menu");
  const n = (I18N.match(/"impact\.itemdiff":/g) || []).length;
  assert.ok(n >= 3, "impact.itemdiff must be defined in en, fr and ja (got " + n + ")");
});
