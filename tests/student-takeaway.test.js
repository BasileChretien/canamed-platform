/* tests/student-takeaway.test.js
 *
 * Dry-run feedback (2026-05-26): "student must be able at the end to download
 * all the historical context, guidelines and recap table, as well as their
 * detailed responses and the group common responses."
 *
 * The Round-4 student export was a plain group-answer dump. It is now a full
 * end-of-session TAKEAWAY built from the live room data + the case content.
 * Static source-text checks (the suite convention).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = require("./_i18n_source.js").readI18nSource();

function takeawayFn() {
  const start = SCRIPT.indexOf("function downloadMyRoomAnswers");
  assert.ok(start >= 0, "downloadMyRoomAnswers must exist");
  return SCRIPT.slice(start, start + 8000);
}

test("helpers resolve case content + escape markdown", () => {
  assert.match(SCRIPT, /function _mdEsc\(/, "_mdEsc markdown-escaper must exist");
  assert.match(SCRIPT, /function _caseItemById\(/, "_caseItemById resolver must exist");
  const resolver = SCRIPT.slice(SCRIPT.indexOf("function _caseItemById"),
    SCRIPT.indexOf("function _caseItemById") + 500);
  assert.match(resolver, /CASE\[/, "must look the revealed item up in CASE");
  assert.match(resolver, /tc\(item\.q/, "must translate the item label via tc()");
});

test("the takeaway carries the historical context (reveals, in order)", () => {
  const fn = takeawayFn();
  assert.match(fn, /\.revealed/, "must read the moduleA.revealed log");
  assert.match(fn, /\.sort\(\(a, b\) => a\.at - b\.at\)/, "reveals must be ordered by time opened");
  assert.match(fn, /_caseItemById/, "must render each revealed item's clinical content");
});

test("the takeaway carries the guidelines (prompts) and the team's committed decisions", () => {
  const fn = takeawayFn();
  assert.match(fn, /CASE\.prompts/, "must include the discussion guidelines (CASE.prompts)");
  assert.match(fn, /\.votes\b/, "must read the team votes");
  assert.match(fn, /committed/, "must report the team's committed choice");
  assert.match(fn, /\| Decision \| Team's choice \| Safest\? \|/, "must render a decisions table");
  assert.match(fn, /Teaching points/, "must include the teaching points (decision rationale)");
});

test("the takeaway separates the student's OWN responses from the group's", () => {
  const fn = takeawayFn();
  assert.match(fn, /e\.cid === clientId/, "must filter the student's own answers by clientId");
  assert.match(fn, /My responses/, "must have a 'My responses' section");
  assert.match(fn, /My hypotheses/, "must include the student's own hypotheses");
  assert.match(fn, /My votes/, "must include the student's own ballots");
  assert.match(fn, /Group answers \(everyone in the room\)/, "must still include the whole group's answers");
});

test("the takeaway includes the recap (score, wins, lessons)", () => {
  const fn = takeawayFn();
  assert.match(fn, /## Recap/, "must include a recap section");
  assert.match(fn, /scoreTotal\(/, "must compute the team score");
  assert.match(fn, /scoreEventMeta/, "must list what the team did well");
  assert.match(fn, /penaltyMeta/, "must list what is worth remembering");
});

test("the button still ships in en / fr / ja (relabelled to 'takeaway')", () => {
  const n = I18N.split('"stage.wrap.download"').length - 1;
  assert.strictEqual(n, 3, "stage.wrap.download must be in en/fr/ja (got " + n + ")");
});
