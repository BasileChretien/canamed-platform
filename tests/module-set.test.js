/* tests/module-set.test.js
 *
 * Phase M0 of the module-set work (ARCHITECTURE/module-set-design.md).
 *
 * Two things are pinned here:
 *
 * 1. THE SEAM. Every place that used to hardcode "stage 1 is Module A, stage 2
 *    is Module B" now resolves through MODULE_REGISTRY / moduleAtStage() /
 *    moduleSet(). M0 must return EXACTLY the old answer — it is a refactor, not
 *    a behaviour change — so these tests double as the regression net for M1/M2,
 *    which will make the set scenario-driven and facilitator-narrowable.
 *
 * 2. THE DEAD-STAGE BUG. stageFlow() has always produced variable-length
 *    sessions (a branched scenario returns [0,1,3], skipping stage 2), but five
 *    navigation sites bypassed it and did raw arithmetic on STAGE_COUNT. The
 *    worst case was silent: stepping BACK from Wrap-up in a branched session
 *    targeted the skipped stage 2, which snapStageToFlow() then rolled FORWARD
 *    again — so "back" did nothing. These assertions fail if anyone reintroduces
 *    raw ±1 / STAGE_COUNT arithmetic at those sites.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

/* The resolver block is self-contained (its only dependency is `window`), so we
   can slice it out and evaluate it for REAL behavioural coverage rather than
   another source-regex. */
function loadResolver(win) {
  const start = SCRIPT.indexOf("const MODULE_REGISTRY");
  assert.notStrictEqual(start, -1, "MODULE_REGISTRY must exist");
  const endMarker = "\nfunction stageLabel(";
  const end = SCRIPT.indexOf(endMarker, start);
  assert.notStrictEqual(end, -1, "the resolver block must sit just above stageLabel()");
  const src = SCRIPT.slice(start, end);
  const factory = new Function("window", src +
    "\nreturn { MODULE_REGISTRY, moduleAtStage, stageForModule, moduleSet, moduleNameTrio };");
  return factory(win);
}

test("M0: the registry maps stages to modules positionally", () => {
  const r = loadResolver({});
  assert.equal(r.moduleAtStage(1), "A", "stage 1 is Module A");
  assert.equal(r.moduleAtStage(2), "B", "stage 2 is Module B");
  assert.equal(r.moduleAtStage(0), null, "Welcome is not a module stage");
  assert.equal(r.moduleAtStage(3), null, "Wrap-up is not a module stage");
  assert.equal(r.stageForModule("A"), 1);
  assert.equal(r.stageForModule("B"), 2);
  assert.equal(r.stageForModule("C"), -1, "an unknown module has no stage yet");
});

test("M0: moduleSet returns today's answer — both modules, none when branched", () => {
  assert.deepStrictEqual(loadResolver({}).moduleSet(), ["A", "B"],
    "a standard scenario runs both modules (unchanged behaviour)");
  assert.deepStrictEqual(loadResolver({ CURRENT_SCENARIO_FORMAT: "standard" }).moduleSet(), ["A", "B"]);
  assert.deepStrictEqual(loadResolver({ CURRENT_SCENARIO_FORMAT: "branched" }).moduleSet(), [],
    "a branched scenario has no A/B modules — its content is the node graph");
});

test("M0: moduleNameTrio resolves the scenario's module names, unfiltered by the set", () => {
  const trioA = { en: "Chronic pain", fr: "", ja: "" };
  const trioB = { en: "Breaking bad news", fr: "", ja: "" };
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: trioA,
    CURRENT_SCENARIO_MODULE_B_NAME: trioB
  });
  assert.deepStrictEqual(r.moduleNameTrio("A"), trioA);
  assert.deepStrictEqual(r.moduleNameTrio("B"), trioB);
  assert.equal(r.moduleNameTrio(null), null, "no module → no trio");
  assert.equal(r.moduleNameTrio("C"), null);
  // Deliberately unfiltered: branched-author.js writes moduleAName as the node
  // title, so a branched session must still be able to label stage 1.
  const branched = loadResolver({
    CURRENT_SCENARIO_FORMAT: "branched",
    CURRENT_SCENARIO_MODULE_A_NAME: trioA
  });
  assert.deepStrictEqual(branched.moduleNameTrio(branched.moduleAtStage(1)), trioA,
    "a branched stage-1 label must still resolve even though moduleSet() is empty");
});

test("M0: stageLabel resolves the module trio through the registry, not stage literals", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function stageLabel("),
                          SCRIPT.indexOf("/* Stage-flow wrappers"));
  assert.match(fn, /moduleNameTrio\(\s*moduleAtStage\(\s*i\s*\)\s*\)/,
    "stageLabel must go through the registry");
  assert.doesNotMatch(fn, /i\s*===\s*1/, "the hardcoded stage-1 literal must be gone");
  assert.doesNotMatch(fn, /i\s*===\s*2/, "the hardcoded stage-2 literal must be gone");
});

/* ── the dead-stage bug ───────────────────────────────────────────────────── */

test("M0: objectives + celebration derive the module from the registry", () => {
  assert.match(SCRIPT, /const mod = moduleAtStage\(viewStage\) \|\| "A";/,
    "renderObjectives must not use (viewStage === 2) ? 'B' : 'A'");
  assert.match(SCRIPT, /moduleAtStage\(roomStage\) === "B"/,
    "celebrateEvents must not test roomStage === 2 directly");
});

/* doesNotMatch on a 690 KB source dumps the whole file into the failure output,
   which is unreadable — assert on a boolean instead. */
function absent(re, msg) {
  assert.ok(!re.test(SCRIPT), msg);
}

test("M0: every stage-nav site steps through the ACTIVE flow, not raw arithmetic", () => {
  // Dashboard row Back / Advance.
  assert.match(SCRIPT, /const _dprev = adjacentStage\(st, -1\);/);
  assert.match(SCRIPT, /const _dnext = adjacentStage\(st, 1\);/);
  assert.match(SCRIPT, /back\.disabled = _dprev === st;/);
  assert.match(SCRIPT, /fwd\.disabled = _dnext === st;/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _dprev\)/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _dnext\)/);

  // Admin sidebar per-room arrows.
  assert.match(SCRIPT, /const _sprev = adjacentStage\(st, -1\);/);
  assert.match(SCRIPT, /const _snext = adjacentStage\(st, 1\);/);
  assert.match(SCRIPT, /back\.disabled = _sprev === st;/,
    "sidebar back must disable on the flow, not st === 0");
  assert.match(SCRIPT, /fwd\.disabled = _snext === st;/,
    "sidebar forward must disable on the flow, not st === STAGE_COUNT - 1");
  assert.match(SCRIPT, /setRoomStage\(r, st, _sprev\)/);
  assert.match(SCRIPT, /setRoomStage\(r, st, _snext\)/);

  // Room-view Back / Advance (the silent no-op case).
  assert.match(SCRIPT, /setRoomStage\(myRoom, roomStage, adjacentStage\(roomStage, -1\)\)/,
    "room-admin Back must resolve through the flow or it is a no-op when a stage is skipped");
  assert.match(SCRIPT, /setRoomStage\(myRoom, roomStage, adjacentStage\(roomStage, 1\)\)/);

  // Disable logic for both roles.
  assert.match(SCRIPT, /el\("prev-btn"\)\.disabled = adjacentStage\(roomStage, -1\) === roomStage;/);
  assert.match(SCRIPT, /el\("next-btn"\)\.disabled = adjacentStage\(roomStage, 1\) === roomStage;/);
  assert.match(SCRIPT, /el\("prev-btn"\)\.disabled = adjacentStage\(viewStage, -1\) === viewStage;/);

  // "Advance all rooms" preview + write.
  assert.match(SCRIPT, /const nxt = adjacentStage\(cur, 1\);/,
    "advance-all must preview/target the stage the room will actually land on");
  assert.match(SCRIPT, /if \(nxt !== cur\) setRoomStage\(r, cur, nxt\);/);

  // No nav site may do raw last-index / ±1 arithmetic any more. (The surviving
  // STAGE_COUNT uses are legitimate: the stageFlow() fallbacks, setRoomStage's
  // bounds clamp, the show/hide loop over ALL stage sections — which must also
  // hide a skipped one — and "is this the wrap-up stage", since the last index
  // is in every flow.)
  absent(/roomStage >= STAGE_COUNT - 1/,
    "raw STAGE_COUNT arithmetic in stage nav reintroduces the dead-stage bug");
  absent(/st === STAGE_COUNT - 1/, "a room-stepper still compares against the raw last index");
  absent(/cur < STAGE_COUNT - 1/, "advance-all still uses raw arithmetic");
  absent(/setRoomStage\([^)]*,\s*st\s*[-+]\s*1\s*\)/, "a stepper still writes st±1 directly");
  absent(/setRoomStage\(myRoom, roomStage, roomStage\s*[-+]\s*1\)/,
    "room-view nav still writes roomStage±1 directly");
});

test("M0: the debrief legend lists only the stages the session visits", () => {
  assert.match(SCRIPT, /stageFlow\(\)\.forEach\(\(i\) => \{[\s\S]{0,400}debrief|stageFlow\(\)\.forEach/,
    "the legend must iterate the flow");
  const legend = SCRIPT.slice(SCRIPT.indexOf('legend.className = "debrief-time-legend"'),
                              SCRIPT.indexOf('sec.appendChild(legend)'));
  assert.match(legend, /stageFlow\(\)\.forEach/,
    "the legend must not loop 0..STAGE_COUNT (it would advertise a skipped stage)");
  assert.doesNotMatch(legend, /STAGE_COUNT/);
});
