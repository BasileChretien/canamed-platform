/* tests/scenario-author-startfrom.test.js
 *
 * Phase 5b — "start from" shortcuts in the scenario author:
 *   • Start from skeleton — a small worked example that must VALIDATE CLEAN, so
 *     a facilitator can edit placeholders instead of guessing the shape. If a
 *     future edit to skeletonJson() breaks a validate() rule, the button would
 *     hand the author a form that immediately reports errors — this pins it.
 *   • Clone a built-in / clone from the cloud — cloneJson() must mint a NEW id.
 *     saveScenarioToCloud() writes scenarios/<uid>/<body.id>, so cloning one of
 *     YOUR OWN scenarios and saving under the same id would silently OVERWRITE
 *     the original. Plain "Load" keeps the id on purpose (edit-in-place); only
 *     Clone re-ids.
 *   • The cloud picker must drop moderator takedowns (moderation/removed),
 *     exactly as script.js listSharedScenarios() does for the create picker —
 *     otherwise a removed shared scenario stays listed AND clonable here.
 *
 * Harness mirrors scenario-author-coverage.test.js: load the browser IIFE with a
 * minimal window/document and readyState "loading" so boot() (which needs a real
 * DOM) never fires, then exercise the pure exposed helpers.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
const CLOUD = fs.readFileSync(path.join(P, "scenario-author-cloud.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "scenario-author.html"), "utf8");

function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  const factory = new Function("window", "document", JS);
  factory(win, doc);
  const api = win.__scenarioAuthor;
  assert.ok(api, "scenario-author.js must expose window.__scenarioAuthor");
  return api;
}

/* Install a scenario as the live STATE (same trick as the coverage test: mutate
   the object getState() returns, since STATE itself is closure-private). */
function install(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
}

/* ── skeleton ─────────────────────────────────────────────────────────────── */

test("the author exposes the Phase-5b start-from helpers", () => {
  const api = loadAuthor();
  assert.equal(typeof api.skeleton, "function", "skeleton() must be exposed");
  assert.equal(typeof api.cloneJson, "function", "cloneJson() must be exposed (cloud reuses it)");
  assert.equal(typeof api.loadBuiltins, "function", "loadBuiltins() must be exposed");
});

test("the starter skeleton validates clean out of the box", () => {
  const api = loadAuthor();
  install(api, api.skeleton());
  const errs = api.validate();
  assert.deepStrictEqual(errs, [],
    "skeletonJson() must satisfy every validate() rule; got: " + JSON.stringify(errs));
});

test("the starter skeleton round-trips losslessly through the form", () => {
  const api = loadAuthor();
  const skel = api.skeleton();
  install(api, skel);
  const out = api.toJson();
  // The editor normalises trios/ordering, so compare the load-bearing shape
  // rather than byte-equality.
  assert.equal(out.id, skel.id);
  assert.equal(out.name.en, skel.name.en);
  assert.equal(out.case.history.length, 1);
  assert.equal(out.case.exam.length, 1);
  assert.equal(out.case.labs.length, 1);
  assert.equal(out.case.labs[0].key, true, "the single lab row must stay the key/synthesis row");
  assert.equal(out.synthId, "labs:0");
  assert.equal(out.decisions.length, 1);
  assert.ok(out.decisions[0].options.some((o) => o.correct),
    "the skeleton decision must keep an option marked correct");
});

test("the skeleton is a worked example, not the empty default form", () => {
  const api = loadAuthor();
  const skel = api.skeleton();
  // "Reset form" already gives an empty shell; the skeleton's value is that
  // every required English field is pre-filled.
  assert.ok(skel.name.en, "skeleton must name itself");
  assert.ok(skel.summary.en);
  assert.ok(skel.moduleAName.en);
  assert.ok(skel.moduleBName.en);
  assert.ok(skel.case.history[0].q.en && skel.case.history[0].a.en);
  assert.ok(skel.scoring.moduleA[0].label.en);
  assert.ok(skel.penalties[0].title.en && skel.penalties[0].why.en);
});

/* ── clone ────────────────────────────────────────────────────────────────── */

test("cloneJson mints a new id so saving cannot overwrite the source", () => {
  const api = loadAuthor();
  const src = { id: "acute-asthma-er", name: { en: "Acute asthma", fr: "", ja: "" } };
  const out = api.cloneJson(src);
  assert.notEqual(out.id, src.id, "a clone must NOT keep the source id");
  assert.equal(out.id, "acute-asthma-er-copy");
  assert.equal(out.name.en, "Acute asthma (copy)", "the copy should be distinguishable");
  // The source object must be untouched (it may be a live built-in).
  assert.equal(src.id, "acute-asthma-er");
  assert.equal(src.name.en, "Acute asthma");
});

test("cloneJson avoids ids already taken by the account", () => {
  const api = loadAuthor();
  const taken = { "case-a-copy": true, "case-a-copy-2": true };
  const out = api.cloneJson({ id: "case-a" }, { taken });
  assert.equal(out.id, "case-a-copy-3", "must skip past every taken id");
});

test("cloning a clone does not stack -copy suffixes", () => {
  const api = loadAuthor();
  const once = api.cloneJson({ id: "case-a" });
  const twice = api.cloneJson({ id: once.id }, { taken: { "case-a-copy": true } });
  assert.equal(twice.id, "case-a-copy-2",
    "re-cloning must re-base, not produce case-a-copy-copy");
});

test("a cloned id stays legal for both validate() and the cloud save rule", () => {
  const api = loadAuthor();
  const ids = [
    api.cloneJson({ id: "case-a" }).id,
    api.cloneJson({ id: "case-a" }, { taken: { "case-a-copy": true } }).id,
    api.cloneJson({ id: "x" }).id
  ];
  ids.forEach((id) => {
    // validate(): lowercase kebab-case; saveScenarioToCloud(): [a-z0-9_-]{1,60}
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/, "clone id must be kebab-case: " + id);
    assert.match(id, /^[a-z0-9_-]{1,60}$/, "clone id must satisfy the save rule: " + id);
  });
});

test("cloneJson handles a bare-string name (some built-ins) and a missing id", () => {
  const api = loadAuthor();
  const strName = api.cloneJson({ id: "b", name: "Plain" });
  assert.equal(strName.name, "Plain (copy)", "a string name stays a string");
  const noId = api.cloneJson({});
  assert.equal(noId.id, "scenario-copy", "a payload with no id still gets a legal one");
});

test("a cloned scenario still validates (clone → save is a usable flow)", () => {
  const api = loadAuthor();
  const cloned = api.cloneJson(api.skeleton());
  install(api, cloned);
  assert.deepStrictEqual(api.validate(), [],
    "cloning must not break validity — otherwise clone→save is dead on arrival");
});

/* ── wiring / moderation ──────────────────────────────────────────────────── */

test("the action bar exposes both start-from buttons and the JS wires them", () => {
  assert.match(HTML, /id="btn-skeleton"/, "skeleton button must exist");
  assert.match(HTML, /id="btn-clone-builtin"/, "clone-a-built-in button must exist");
  assert.match(JS, /getElementById\("btn-skeleton"\)/, "skeleton button must be wired");
  assert.match(JS, /getElementById\("btn-clone-builtin"\)/, "clone button must be wired");
});

test("built-ins are lazy-loaded, not a static tag on the author page", () => {
  // case-content.js is ~171 KB gz. The author page must stay light for the
  // facilitators who never clone a built-in.
  assert.doesNotMatch(HTML, /<script[^>]+src="case-content\.js"/,
    "case-content.js must NOT be a static <script> on scenario-author.html");
  assert.match(JS, /src\s*=\s*"case-content\.js"/,
    "loadBuiltins() must inject case-content.js on demand");
  assert.match(JS, /CANAMED_SCENARIOS/, "built-ins come from window.CANAMED_SCENARIOS");
});

test("the cloud picker filters moderator takedowns before listing/cloning", () => {
  assert.match(CLOUD, /moderation\/removed/,
    "openLoadFromCloud must read moderation/removed (a takedown must hide the scenario)");
  assert.match(CLOUD, /removed\[s\.shareId\]\s*!==\s*true/,
    "the shared list must be filtered by shareId against the takedown map");
});

test("the cloud picker offers Clone as well as Load, and only Clone re-ids", () => {
  assert.match(CLOUD, /loadByPath\(\s*getValue\(s\),\s*true,\s*mineIds\s*\)/,
    "the Clone button must call loadByPath in clone mode with the taken-id map");
  assert.match(CLOUD, /function loadByPath\(path, asClone, takenIds\)/,
    "loadByPath must accept the clone flag");
  assert.match(CLOUD, /asClone[\s\S]{0,200}cloneJson\(/,
    "clone mode must re-id via the author's cloneJson");
});
