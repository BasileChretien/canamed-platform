/* tests/round4-modB-export.test.js
 *
 * Lock-in for two Round-4 UX items:
 *  (A) Module B now uses the same two-column sticky layout as Module A —
 *      instructional/reference cards in .col-left, the group-answers form in
 *      a sticky .col-right (the real cause of the "sticky column" votes was
 *      Module B being single-column with the answers form dead-last).
 *  (B) Students can export their OWN room's answers as Markdown at wrap-up
 *      (previously only the facilitator could export, all rooms).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX  = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const CSS    = fs.readFileSync(path.join(P, "style.css"), "utf8");
const I18N   = require("./_i18n_source.js").readI18nSource();

test("Module B is wrapped in a two-column layout with a sticky answers column", () => {
  // The columns wrap exists with the modB-columns class + col-left/col-right.
  assert.match(INDEX, /<div class="columns modB-columns">\s*<div class="col-left">/,
    "Module B must open .columns.modB-columns > .col-left after the coach");
  assert.match(INDEX, /<div class="col-right">\s*<section class="card answers-card answers-card-bulleted">/,
    "the Module B group-answers card must sit in the sticky .col-right");
  // Module-B-specific column ratio (col-left wider than the answers sidebar).
  assert.match(CSS, /\.columns\.modB-columns\s*\{[^}]*grid-template-columns/,
    "a .columns.modB-columns grid-template-columns override must exist");
});

test("wrap-up offers a student-facing room-answers export", () => {
  assert.match(INDEX, /id="wrapup-download-btn"[^>]*data-i18n="stage.wrap.download"/,
    "the wrap-up must include a student export button bound to stage.wrap.download");
  // i18n in en/fr/ja
  const n = I18N.split('"stage.wrap.download"').length - 1;
  assert.strictEqual(n, 3, "stage.wrap.download must be in en/fr/ja (got " + n + ")");
});

test("downloadMyRoomAnswers exports only the student's own room + is wired student-only", () => {
  assert.match(SCRIPT, /function downloadMyRoomAnswers\(/, "downloadMyRoomAnswers must exist");
  const fn = SCRIPT.slice(SCRIPT.indexOf("function downloadMyRoomAnswers"),
    SCRIPT.indexOf("function downloadMyRoomAnswers") + 8000);
  assert.match(fn, /rooms\/"\s*\+\s*myRoom/, "must read the participant's OWN room only");
  assert.match(fn, /text\/markdown/, "must produce a Markdown blob");
  // wired in initEndPoll (student path); hidden for admins
  assert.match(SCRIPT, /wrapup-download-btn[\s\S]{0,160}?addEventListener\("click", downloadMyRoomAnswers\)/,
    "the export button must be wired to downloadMyRoomAnswers in the student wrap-up");
  assert.match(SCRIPT, /isRoomAdmin[\s\S]{0,160}?wrapup-download-btn[\s\S]{0,40}?add\("hidden"\)/,
    "the student export must be hidden for admins (who have their own export)");
});
