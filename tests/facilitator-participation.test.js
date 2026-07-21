/* tests/facilitator-participation.test.js
 *
 * Lock-in for the live facilitator participation-equity panel (2026-05-21).
 * The dashboard now shows, per room, how many PRESENT students have
 * contributed (authored an answer/hypothesis, tagged by clientId), and
 * flags a room "quiet" when someone present hasn't contributed — so the
 * lead facilitator can nudge mid-session instead of finding out afterwards.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8") +
  // admin-only rules moved to the lazily-loaded admin.css (perf-budget
  // reclaim); these assertions cover the pair as one cascade
  fs.readFileSync(path.join(P, "admin.css"), "utf8");

test("roomParticipation derives present, contributing, gini + who's-stuck names", () => {
  assert.match(SCRIPT, /function roomParticipation\(/, "roomParticipation must be defined");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function roomParticipation"),
    SCRIPT.indexOf("function roomParticipation") + 1600);
  assert.match(fn, /presence/, "must read presence for the present set");
  assert.match(fn, /answers[\s\S]*moduleA/, "must count Module A answers");
  assert.match(fn, /moduleA[\s\S]*hypotheses/, "must count hypotheses as contributions");
  assert.match(fn, /\.cid/, "contribution authorship is keyed by clientId (cid)");
  assert.match(fn, /gini:/, "must return a gini spread measure");
  assert.match(fn, /quietNames:/, "must return the names of present non-contributors");
  assert.match(fn, /presence\[cid\][\s\S]*\.name/, "quiet names come from the presence records");
});

test("gini() is defined and treats an all-zero room as even (not NaN)", () => {
  assert.match(SCRIPT, /function gini\(values\)/, "a gini(values) helper must exist");
  assert.match(SCRIPT, /if \(sum === 0\) return 0/,
    "gini must return 0 for a room with no contributions yet");
});

test("renderDashboard shows the participation line, a balance read, and who's-stuck names", () => {
  assert.match(SCRIPT, /roomParticipation\(data\)/, "renderDashboard must call roomParticipation");
  assert.match(SCRIPT, /dash-participation/, "a .dash-participation element must be rendered");
  assert.match(SCRIPT, /dash-quiet-names/, "a .dash-quiet-names element must list non-contributors");
  // balance read only when meaningful (2+ contributors among 3+ present)
  assert.match(SCRIPT, /part\.contributing\s*>=\s*2\s*&&\s*part\.present\s*>=\s*3/,
    "the Gini balance read must be gated to 2+ contributors and 3+ present");
  assert.match(SCRIPT, /Gini/, "the Gini value must be surfaced to the facilitator");
  assert.match(SCRIPT, /quiet\s*=\s*interactive\s*&&\s*part\.present\s*>=\s*2\s*&&\s*part\.contributing\s*<\s*part\.present/,
    "quiet flag must fire only on an interactive stage with 2+ present and < all contributing");
});

test("the quiet participation states have distinct styles", () => {
  assert.match(CSS, /\.dash-participation\.quiet\b/, "a .dash-participation.quiet style must exist");
  assert.match(CSS, /\.dash-quiet-names\b/, "a .dash-quiet-names style must exist");
});
