/* tests/section-picker-ui.test.js
 *
 * S3b: the create form's section picker. "Scenario (the clinical case for this
 * workshop)" stops being the primary control — a facilitator picks the SECTIONS
 * the session runs, in order, possibly from different clinical cases.
 *
 * It also supersedes M2's "Modules to run" tick-row: a section pick IS the
 * module set, expressed at a granularity the tick-row could not reach (two
 * sections of the same type).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

function fnOf(name) {
  const i = SCRIPT.indexOf("function " + name + "(");
  assert.ok(i > -1, name + "() must exist");
  return SCRIPT.slice(i, SCRIPT.indexOf("\nfunction ", i + 1));
}
/* Comment-blind view of a function. A guard like "never innerHTML" otherwise
   matches the word inside the comment that EXPLAINS the guard — which is how
   the same assertion misfired twice during this refactor. */
function codeOf(name) {
  return fnOf(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("the picker ships in the shell, above the scenario field", () => {
  assert.ok(HTML.indexOf('id="splash-section-list"') > -1);
  assert.ok(HTML.indexOf('id="splash-section-add"') > -1);
  assert.ok(HTML.indexOf('id="splash-section-add-btn"') > -1);
  assert.ok(HTML.indexOf('id="splash-section-field"') === -1 ||
            HTML.indexOf("splash-sections-field") > -1);
  assert.ok(HTML.indexOf("splash-sections-field") <
            HTML.indexOf('for="splash-create-scenario"'),
    "the section picker is the PRIMARY control now");
});

test("the superseded module tick-row is gone from the form", () => {
  assert.ok(HTML.indexOf("splash-create-mod-") === -1);
});

test("pick order is preserved, and reordering swaps neighbours", () => {
  const f = fnOf("moveSectionPick");
  assert.match(f, /if \(j < 0 \|\| j >= splashSectionPick\.length\) return;/,
    "the ends must not wrap");
  assert.match(f, /renderSectionPick\(\)/);
});

test("duplicates are ALLOWED — running a section twice is legitimate", () => {
  const f = fnOf("addSectionPick");
  assert.ok(!/indexOf\(id\) > -1|includes\(id\)/.test(f),
    "the slot model keys state by POSITION, not by section id");
  assert.match(f, /splashSectionPick\.length >= MAX_SECTION_SLOTS/,
    "…but the physical slot cap the DB rules enforce still applies");
});

test("section titles are rendered as TEXT — they can be facilitator-authored", () => {
  assert.ok(!/innerHTML/.test(codeOf("renderSectionPick")));
  const f = fnOf("renderSectionPick");
  /* The row now renders through the SAME i18n pattern as the student's stage
     label, so the facilitator's list and the stage read identically in every
     language rather than the picker being the one hardcoded-English part of an
     otherwise-translated form. */
  assert.match(f, /window\.t\("stage\.label\.section"\)/,
    "the row must reuse the student's stage-label pattern");
  assert.match(f, /tpl\.replace\("\{n\}", String\(i \+ 1\)\)/,
    "…numbered by position");
});

test("the row is numbered by POSITION, matching the student's stage label", () => {
  const f = fnOf("renderSectionPick");
  assert.match(f, /window\.t\("stage\.label\.section"\)/,
    "same pattern the student sees on the stage");
  assert.match(f, /replace\("\{title\}", title\)/);
});

test("an empty pick writes NO sections field — the session falls back", () => {
  const f = fnOf("sectionPickCsv");
  assert.match(f, /splashSectionPick\.length \? splashSectionPick\.join\(","\) : null/);
  assert.match(SCRIPT, /if \(typeof sections === "string" && sections\)/,
    "createSession must skip the write when nothing was picked");
});

test("the pick is written write-once, like the module narrowing before it", () => {
  assert.match(SCRIPT, /oPath\(code, "sections"\)\)\.set\(sections\)/);
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
  const s = rules.rules.sessions.$sessionId.sections;
  assert.equal(s[".write"], "auth != null && !data.exists()");
});

test("the add-list fills itself once the lazy library lands", () => {
  /* section-registry.js is chained after case-content, so on a cold load the
     picker is rendered before the library exists. Without the retry it would
     stay permanently empty. */
  const f = fnOf("populateSectionPicker");
  assert.match(f, /ensureCaseContent\(\)\.then\(populateSectionPicker\)/);
});

test("the picker is wired eagerly and only once", () => {
  const f = fnOf("wireSectionPicker");
  assert.match(f, /if \(!btn \|\| btn\._wired\) return;/);
  assert.match(SCRIPT, /wireSectionPicker\(\);\s*\n\s*populateSectionPicker\(\);/);
});

test("every custom property the picker uses actually EXISTS in tokens.css", () => {
  /* Invented token names do not fail loudly — `var(--space-1)` is simply an
     invalid declaration the browser DROPS, so the rule silently does nothing.
     That is exactly what happened here first time round (padding and margins
     computed to 0 with no error anywhere). */
  const TOKENS = fs.readFileSync(path.join(P, "tokens.css"), "utf8");
  const i = CSS.indexOf(".splash-section-list");
  const end = CSS.indexOf("}", CSS.indexOf(".splash-section-add select", i)) + 1;
  const used = new Set((CSS.slice(i, end).match(/var\((--[a-z0-9-]+)\)/g) || [])
    .map(m => m.replace(/var\(|\)/g, "")));
  used.forEach(t =>
    assert.ok(TOKENS.indexOf(t + ":") > -1, t + " is not defined in tokens.css"));
  assert.ok(used.size >= 4, "the picker should be token-driven, not hardcoded");
});

test("the picker styles use tokens, never raw hex or px", () => {
  const i = CSS.indexOf(".splash-section-list");
  const end = CSS.indexOf("}", CSS.indexOf(".splash-section-add select", i)) + 1;
  /* Strip comments FIRST: a prose reference like "PR #172" reads as a hex
     colour to this regex. Third time a comment has tripped a source guard in
     this refactor — assert against the code, not the prose explaining it. */
  const block = CSS.slice(i, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), "no raw hex — tokens.css owns colour");
  assert.ok(!/:\s*\d+px/.test(block.replace(/1px solid/g, "")),
    "no raw px spacing — use the space scale");
});
