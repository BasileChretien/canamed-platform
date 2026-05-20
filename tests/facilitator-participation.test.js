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
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

test("roomParticipation derives present + contributing from presence + cid-tagged work", () => {
  assert.match(SCRIPT, /function roomParticipation\(/, "roomParticipation must be defined");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function roomParticipation"),
    SCRIPT.indexOf("function roomParticipation") + 1200);
  assert.match(fn, /data\.presence/, "must read presence for the present set");
  assert.match(fn, /answers[\s\S]*moduleA/, "must count Module A answers");
  assert.match(fn, /moduleA[\s\S]*hypotheses/, "must count hypotheses as contributions");
  assert.match(fn, /\.cid/, "contribution authorship is keyed by clientId (cid)");
  assert.match(fn, /present:[^,]+,\s*contributing:/, "must return { present, contributing }");
});

test("renderDashboard shows the participation line + flags quiet rooms", () => {
  assert.match(SCRIPT, /roomParticipation\(data\)/,
    "renderDashboard must call roomParticipation");
  assert.match(SCRIPT, /dash-participation/, "a .dash-participation element must be rendered");
  // quiet flag: interactive stage + 2+ present + someone hasn't contributed.
  assert.match(SCRIPT, /quiet\s*=\s*interactive\s*&&\s*part\.present\s*>=\s*2\s*&&\s*part\.contributing\s*<\s*part\.present/,
    "quiet flag must fire only on an interactive stage with 2+ present and < all contributing");
});

test("the quiet participation state has a distinct style", () => {
  assert.match(CSS, /\.dash-participation\.quiet\b/,
    "a .dash-participation.quiet style must exist to draw the facilitator's eye");
});
