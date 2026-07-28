/* tests/roleplay-phases.test.js
 *
 * S1c-3b (decision 12): an authored roleplay declares its OWN phases.
 *
 * MODB_PHASES was a six-entry literal, the minute budgets lived in the markup
 * and the stepper was six hand-authored <li>, so every roleplay ran the
 * breaking-bad-news timetable. The phase list is now section data, and WHICH
 * CARDS a phase shows is part of the declaration — the consumer M3b's
 * phase-visibility seam was built for and never had.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function phases(win) {
  const start = SCRIPT.indexOf("const ROLEPLAY_CARDS");
  assert.ok(start > -1, "the card key map must exist");
  const end = SCRIPT.indexOf("function modBProgressCfg", start);
  const src = SCRIPT.slice(start, end) + "\nreturn { ROLEPLAY_CARDS, roleplayPhases };";
  // eslint-disable-next-line no-new-func
  return new Function("window", src)(win || {});
}
const declare = (list) => phases({ CURRENT_SECTION_ROLEPLAY: { phases: list } }).roleplayPhases();

test("declaring nothing keeps the shipped six-phase timetable", () => {
  assert.equal(phases({}).roleplayPhases(), null);
  assert.match(SCRIPT, /if \(!authored\) return MODULE_PROGRESS\.B;/,
    "modBProgressCfg must fall back to the shipped config untouched");
  assert.match(SCRIPT, /const MODB_PHASES = \["setup", "play", "exchange", "swap", "replay", "reflect"\]/,
    "the built-in timetable itself is unchanged");
});

test("a section declares its own phases, with labels and minutes", () => {
  const p = declare([
    { id: "brief", label: "Brief the room", minutes: 5, shows: ["vignette", "roles"] },
    { id: "play", label: "Play it", minutes: 12, shows: ["roles"] },
    { id: "debrief", label: "Debrief", minutes: 8, shows: ["reflect"], expanded: true }
  ]);
  assert.deepEqual(p.map(x => x.id), ["brief", "play", "debrief"]);
  assert.equal(p[0].minutes, 5);
  assert.equal(p[2].expanded, true);
});

test("cards are named by KEY, never by raw CSS selector", () => {
  const keys = Object.keys(phases({}).ROLEPLAY_CARDS);
  assert.ok(keys.indexOf("roles") > -1 && keys.indexOf("reflect") > -1);
  /* A raw selector from a facilitator can be malformed (querySelectorAll
     throws) or reach chrome it has no business touching. */
  const p = declare([{ id: "a", shows: ["roles", "#anything-else", ".vignette"] }]);
  assert.deepEqual(p[0].shows, ["roles"], "unknown keys are dropped");
});

test("phase ids are validated — they are written to RTDB and read back as DOM attrs", () => {
  const p = declare([{ id: "ok" }, { id: "Has Space" }, { id: "" }, { id: "ok" }, { id: "two" }]);
  assert.deepEqual(p.map(x => x.id), ["ok", "two"]);
  assert.equal(declare([{ id: "!!" }]), null,
    "a list with no usable phase falls back rather than leaving a roleplay with none");
});

test("a card no phase shows is HIDDEN, not left permanently on screen", () => {
  const i = SCRIPT.indexOf("function modBProgressCfg");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\n/* Rebuild the phase stepper", i));
  assert.match(fn, /Object\.keys\(ROLEPLAY_CARDS\)\.map/,
    "EVERY known card needs an entry — an omitted one is never touched by " +
    "applyPhaseVisibility and would stay visible in every phase");
  assert.match(fn, /phases: authored\.filter\(p => p\.shows\.indexOf\(key\) !== -1\)/);
});

test("the phase indicator counts the authored phases, not a literal six", () => {
  const i = SCRIPT.indexOf("function modBProgressCfg");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("function renderPhaseStepper", i));
  assert.match(fn, /indicatorFallback: "Phase \{n\} \/ " \+ authored\.length/);
  /* Match the PROPERTY, not the word — the code carries a comment explaining
     why the key is omitted, and a bare /indicatorKey/ matches that comment. */
  assert.ok(!/indicatorKey\s*:/.test(fn.slice(fn.indexOf("nav: {"))),
    "the shipped 'Phase {n} / 6' key must not be reused for an authored list");
});

test("the rebuilt stepper clears the flag the nav actually guards on", () => {
  const i = SCRIPT.indexOf("function renderPhaseStepper");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nconst SECTION_TYPE_FOR_MODULE", i));
  /* initModBPhaseNav guards on a `_wired` PROPERTY of the stepper node and
     binds one listener per chip BY INDEX. Clearing a dataset flag instead would
     leave an authored stepper rendering perfectly and completely untappable. */
  assert.match(fn, /nav\._wired = false;/);
  assert.match(SCRIPT, /if \(stepper && !stepper\._wired\)/,
    "…which is the flag initModBPhaseNav checks");
  assert.ok(!/innerHTML/.test(fn), "phase labels may be facilitator-authored");
});

test("the phase consumers all resolve the config per section", () => {
  assert.match(SCRIPT, /const c = modBProgressCfg\(\);/);
  assert.match(SCRIPT, /renderModulePhase\(modBProgressCfg\(\), modBPhase\)/);
  assert.match(SCRIPT, /Math\.min\(modBProgressCfg\(\)\.phases\.length - 1, idx \| 0\)/,
    "clamping to a literal six would strand the last phase of a longer list");
});

test("the phase READ clamps to this roleplay's length, not the built-in six", () => {
  /* Third instance of the same class as the two rules enums fixed in S1c —
     and the only one on a READ path, so it would have presented as the room
     jumping back to phase 0 rather than as a write being refused. A literal
     `<= 5` silently reset an authored 8-phase roleplay the moment the room
     advanced past its sixth beat. */
  const i = SCRIPT.indexOf("refModBPhase.on(");
  assert.ok(i > -1, "the phase listener must exist");
  const fn = SCRIPT.slice(i, i + 900);
  assert.ok(!/v <= 5\b/.test(fn), "the built-in six must not be hardcoded on read");
  assert.match(fn, /modBProgressCfg\(\)\.phases \|\| \[\]\)\.length - 1/,
    "the clamp must come from the roleplay's own phase list");
});
