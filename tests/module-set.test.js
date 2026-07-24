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
    "\nreturn { MODULE_REGISTRY, moduleAtStage, stageForModule, moduleSet, moduleNameTrio," +
    "\n         moduleHasContent, moduleNameEn, moduleHasScoring, refreshModuleStages," +
    "\n         setSessionModules, scenarioModuleSet };");
  return factory(win);
}

const TRIO = (en) => ({ en, fr: "", ja: "" });

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

/* ── M1: the module set is scenario-driven ────────────────────────────────── */

test("M1: BACK-COMPAT — a scenario that names both modules still runs A+B", () => {
  // This is the migration story: all three built-ins declare both names, so
  // inference must return A+B for them with no `modules` field and no data edit.
  const bothNames = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Chronic pain"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Breaking bad news")
  };
  assert.deepStrictEqual(loadResolver(bothNames).moduleSet(), ["A", "B"]);
  assert.deepStrictEqual(
    loadResolver(Object.assign({ CURRENT_SCENARIO_FORMAT: "standard" }, bothNames)).moduleSet(),
    ["A", "B"]);
});

test("M1: an explicit scenario `modules` declaration wins over inference", () => {
  // Names for BOTH are present, but the scenario declares it only runs A.
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay"),
    CURRENT_SCENARIO_MODULES: ["A"]
  };
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["A"]);
  win.CURRENT_SCENARIO_MODULES = ["B"];
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["B"]);
  win.CURRENT_SCENARIO_MODULES = ["B", "A"];
  assert.deepStrictEqual(loadResolver(win).moduleSet(), ["A", "B"],
    "the set is always returned in stage order, whatever order it was declared");
});

test("M1: inference — a module with no name and no scoring family is absent", () => {
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning only") }).moduleSet(),
    ["A"], "naming only Module A yields an A-only session");
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay only") }).moduleSet(),
    ["B"], "naming only Module B yields a B-only session");
});

test("M1: a scoring family alone is enough to make a module present", () => {
  const r = loadResolver({ SCORING: { moduleB: [{ id: "b1" }] } });
  assert.equal(r.moduleHasContent("B"), true);
  assert.equal(r.moduleHasContent("A"), false);
  assert.deepStrictEqual(r.moduleSet(), ["B"]);
  // An EMPTY family is not content (scenario-author emits scoring.moduleB: []).
  assert.equal(loadResolver({ SCORING: { moduleB: [] } }).moduleHasContent("B"), false);
});

test("M1: a stale SCORING table cannot resurrect a module the scenario doesn't name", () => {
  // applyScenario() resets the module NAMES for every scenario but only
  // overwrites window.SCORING when the new scenario has a scoring key. So after
  // switching from an A+B scenario to an A-only one, window.SCORING.moduleB can
  // still be populated — it must not put Module B back into the session.
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("Reasoning only"),
    SCORING: { moduleA: [{ id: "a1" }], moduleB: [{ id: "b1" }] }   // leftover
  });
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "names are authoritative when present, so the leftover B scoring is ignored");
  // The scoring fallback still applies when NO module is named at all.
  assert.deepStrictEqual(
    loadResolver({ SCORING: { moduleB: [{ id: "b1" }] } }).moduleSet(), ["B"]);
});

test("M1: a branched scenario declares no A/B module, whatever else is set", () => {
  assert.deepStrictEqual(loadResolver({ CURRENT_SCENARIO_FORMAT: "branched" }).moduleSet(), [],
    "its content is the node graph, not an A/B module");
  assert.deepStrictEqual(loadResolver({
    CURRENT_SCENARIO_FORMAT: "branched",
    CURRENT_SCENARIO_MODULES: ["A", "B"],
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("placeholder")
  }).moduleSet(), [], "branched wins over both a declaration and inference");
});

test("M1: a malformed standard scenario still yields a navigable session", () => {
  // No names, no scoring, no declaration: rather than collapse the flow to
  // Welcome → Wrap-up, keep one module stage.
  assert.deepStrictEqual(loadResolver({}).moduleSet(), ["A"]);
  // A declaration naming nothing we recognise falls through to inference.
  assert.deepStrictEqual(
    loadResolver({ CURRENT_SCENARIO_MODULES: ["Z"],
                   CURRENT_SCENARIO_MODULE_B_NAME: TRIO("Roleplay") }).moduleSet(),
    ["B"]);
});

test("M1: refreshModuleStages publishes the enabled modules' stage indices", () => {
  const win = { CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"), CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B") };
  loadResolver(win).refreshModuleStages();
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1, 2]);

  const aOnly = { CURRENT_SCENARIO_MODULES: ["A"], CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A") };
  loadResolver(aOnly).refreshModuleStages();
  assert.deepStrictEqual(aOnly.CANAMED_MODULE_STAGES, [1], "A-only drops stage 2");

  const bOnly = { CURRENT_SCENARIO_MODULES: ["B"], CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B") };
  loadResolver(bOnly).refreshModuleStages();
  assert.deepStrictEqual(bOnly.CANAMED_MODULE_STAGES, [2], "B-only drops stage 1");
});

test("M1: applyScenario publishes the declared set, in the right order", () => {
  // CURRENT_SCENARIO_MODULES must be assigned AFTER the format (moduleSet reads
  // it) and refreshModuleStages() must run after both, or the first stageFlow()
  // of a session would use a stale set.
  const fmt = SCRIPT.indexOf("window.CURRENT_SCENARIO_FORMAT = (sc && sc.format)");
  const mods = SCRIPT.indexOf("window.CURRENT_SCENARIO_MODULES =");
  const refresh = SCRIPT.indexOf("refreshModuleStages();", mods);
  assert.ok(fmt !== -1 && mods !== -1 && refresh !== -1, "all three must exist in applyScenario");
  assert.ok(fmt < mods, "format must be published before the module set");
  assert.ok(mods < refresh, "the stage list must be refreshed after the set is published");
  assert.match(SCRIPT, /Array\.isArray\(sc && sc\.modules\)/,
    "the scenario's `modules` field is the declaration");
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

/* ── M2: the facilitator narrows the scenario's set per session ───────────── */

test("M2: a session's narrowing intersects the scenario's set", () => {
  const win = {
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  };
  const r = loadResolver(win);
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "no narrowing → the scenario's set");
  r.setSessionModules("A");
  assert.deepStrictEqual(r.moduleSet(), ["A"]);
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [1], "the stage list refreshes with it");
  r.setSessionModules("B");
  assert.deepStrictEqual(r.moduleSet(), ["B"]);
  assert.deepStrictEqual(win.CANAMED_MODULE_STAGES, [2]);
  r.setSessionModules("B,A");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "stage order, not declaration order");
  r.setSessionModules(null);
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "clearing it restores the scenario's set");
});

test("M2: a narrowing that would empty the session is ignored", () => {
  // e.g. an A-only scenario carrying a stale "B" selection.
  const r = loadResolver({ CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A only") });
  r.setSessionModules("B");
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "an empty intersection falls back to the scenario's set, never a dead session");
});

test("M2: setSessionModules tolerates whitespace, empties and unknown ids", () => {
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  });
  r.setSessionModules("  A , B ");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "whitespace is trimmed");
  r.setSessionModules("");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "empty string = no narrowing");
  r.setSessionModules("Z");
  assert.deepStrictEqual(r.moduleSet(), ["A", "B"], "an unknown id intersects to nothing → ignored");
});

test("M2: the scenario set is still reachable independently of the narrowing", () => {
  const r = loadResolver({
    CURRENT_SCENARIO_MODULE_A_NAME: TRIO("A"),
    CURRENT_SCENARIO_MODULE_B_NAME: TRIO("B")
  });
  r.setSessionModules("A");
  assert.deepStrictEqual(r.scenarioModuleSet(), ["A", "B"],
    "scenarioModuleSet() reports what the scenario CONTAINS");
  assert.deepStrictEqual(r.moduleSet(), ["A"],
    "moduleSet() reports what this session RUNS");
});

test("M2: createSession records the narrowing write-once, and only a subset", () => {
  assert.match(SCRIPT, /oPath\(code, "modules"\)\)\.set\(modCsv\)/,
    "createSession must write the CSV to the session's modules field");
  assert.match(SCRIPT, /if \(modCsv\) writes\.push/,
    "an unnarrowed session must write NO modules field at all");
  assert.match(SCRIPT, /_modPick\.length < MODULE_REGISTRY\.length/,
    "the create form must pass null unless the pick is a strict subset");
});

test("M2: loadSessionScenario publishes the narrowing BEFORE applyScenario", () => {
  // applyScenario() calls refreshModuleStages(); if the narrowing were published
  // after it, the session's first stageFlow() would use the scenario's full set
  // and briefly offer a stage this session does not run.
  const read = SCRIPT.indexOf('oPath(code, "modules")).once("value")');
  const set = SCRIPT.indexOf("setSessionModules(res[3]", read);
  const apply = SCRIPT.indexOf("applyScenario(null, custom)", set);
  assert.ok(read !== -1, "loadSessionScenario must read the session's modules");
  assert.ok(set !== -1, "…and publish it via setSessionModules");
  assert.ok(apply !== -1 && set < apply, "…before applyScenario()");
});

test("M2: `modules` is declared write-once in BOTH rule trees", () => {
  const rules = JSON.parse(
    fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
  const s = rules.sessions.$sessionId.modules;
  const o = rules.orgs.$orgSlug.sessions.$sessionId.modules;
  [["sessions", s], ["orgs", o]].forEach(([label, node]) => {
    // sessions/$sessionId has NO $other catch-all, so an undeclared child is
    // denied — the field must be declared in both trees or M2 silently fails.
    assert.ok(node, label + " tree must declare `modules`");
    assert.equal(node[".write"], "auth != null && !data.exists()",
      label + ": must be write-once, mirroring scenarioId");
    assert.match(node[".validate"], /A-Za-z0-9_-/,
      label + ": ids validated generically (no A|B whitelist, so module C needs no rules change)");
  });
  assert.equal(s[".validate"], o[".validate"], "both trees must validate identically");
});

/* ── M1: the author can produce a single-module scenario ──────────────────── */

const AUTHOR_JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  new Function("window", "document", AUTHOR_JS)(win, doc);
  return win.__scenarioAuthor;
}
/* Install a scenario as the live STATE (STATE itself is closure-private). */
function installAuthor(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
}
const NO_TRIO = { en: "", fr: "", ja: "" };

test("M1: a Module-A-only scenario validates (Module B name no longer required)", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleBName = NO_TRIO;
  s.scoring.moduleB = [];
  installAuthor(api, s);
  assert.deepStrictEqual(api.validate(), [],
    "naming only Module A must be a valid single-module scenario");
});

test("M1: a Module-B-only scenario validates", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleAName = NO_TRIO;
  s.scoring.moduleA = [];
  s.decisions.forEach((d) => { d.module = "B"; });   // move the decision across
  installAuthor(api, s);
  assert.deepStrictEqual(api.validate(), []);
});

test("M1: a scenario that names NO module is rejected", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  s.moduleAName = NO_TRIO; s.moduleBName = NO_TRIO;
  s.scoring.moduleA = []; s.scoring.moduleB = [];
  installAuthor(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /at least one module/i.test(e)),
    "a scenario running no module at all must be rejected; got " + JSON.stringify(errs));
});

test("M1: a decision in a module the scenario does not run is rejected", () => {
  const api = loadAuthor();
  const s = api.skeleton();
  // Make it B-only while the skeleton's decision is still Module A → that
  // decision would render into a stage the session never visits.
  s.moduleAName = NO_TRIO;
  s.scoring.moduleA = [];
  installAuthor(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /only runs Module B/.test(e)),
    "an unreachable decision must be flagged; got " + JSON.stringify(errs));
});

test("M1: an explicit `modules` override survives an author round-trip", () => {
  // The runtime honours `modules` over inference; the editor has no control for
  // it, so it must ride Phase 1's passthrough bag rather than being dropped.
  const api = loadAuthor();
  const s = api.skeleton();
  s.modules = ["A"];
  installAuthor(api, s);
  assert.deepStrictEqual(api.toJson().modules, ["A"]);
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
