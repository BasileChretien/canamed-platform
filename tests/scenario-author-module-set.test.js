/* tests/scenario-author-module-set.test.js
 *
 * Module-set M5 — the scenario author can declare WHICH modules a scenario runs
 * and, when a branched decision case is one of them, WHICH standalone branched
 * scenario it references:
 *
 *   { modules: ["A", "B", "branched"], branchedRef: "ward-escalation-branched" }
 *
 * Before M5 those two keys only SURVIVED (they rode Phase 1's passthrough bag);
 * nothing in the form could produce them and nothing checked them. Three things
 * are pinned here:
 *
 *   1. `modules` is emitted only when it CARRIES INFORMATION — a branched module
 *      (which the runtime can never infer, having no name and no scoring family)
 *      or an A/B pick that differs from the names. Otherwise every existing
 *      scenario would gain a redundant key on a round-trip.
 *   2. The two keys are MODELED, not passed through. If they stayed in the
 *      passthrough bag as well, unticking the branched module would silently
 *      resurrect the old value (mergeExtra only skips keys the export set).
 *   3. A declared branched module needs a `branchedRef` that RESOLVES against
 *      the built-in registry — composeBranchedModule() looks it up there, and an
 *      unresolvable id renders an empty stage with only a console warning.
 *
 * Harness mirrors the sibling author tests: load the browser IIFE with a minimal
 * window/document and readyState "loading" so boot() (which needs a real DOM)
 * never fires. This one also KEEPS the fake window, because validate()'s
 * reference check reads window.CANAMED_SCENARIOS.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "scenario-author.html"), "utf8");
const CSS = fs.readFileSync(path.join(P, "scenario-author.css"), "utf8");

function loadAuthor() {
  const win = {};
  const doc = { readyState: "loading", addEventListener() {} };
  new Function("window", "document", JS)(win, doc);
  const api = win.__scenarioAuthor;
  assert.ok(api, "scenario-author.js must expose window.__scenarioAuthor");
  return { api, win };
}

/* Install a scenario as the live STATE (STATE itself is closure-private). */
function install(api, scenario) {
  const parsed = api.fromJson(scenario);
  const live = api.getState();
  Object.keys(live).forEach((k) => { delete live[k]; });
  Object.assign(live, parsed);
  return live;
}

/* A stand-in for the lazily-fetched built-in registry. */
function fakeRegistry() {
  return {
    "ward-escalation-branched": { id: "ward-escalation-branched", format: "branched",
      name: { en: "The Breathless Patient on the Ward" }, decisions: [{ id: "n1" }] },
    "second-branched": { id: "second-branched", format: "branched", name: "Plain name" },
    "chronic-pain": { id: "chronic-pain", name: { en: "Chronic pain" } }
  };
}

/* ── the exposed surface ──────────────────────────────────────────────────── */

test("M5: the author exposes the module-set helpers", () => {
  const { api } = loadAuthor();
  assert.equal(typeof api.declaredModules, "function");
  assert.equal(typeof api.branchedScenarioList, "function");
});

/* ── `modules` is emitted only when it carries information ────────────────── */

test("M5: a fresh form emits no `modules` key (nothing to declare yet)", () => {
  const { api } = loadAuthor();
  const out = api.toJson();
  assert.equal("modules" in out, false,
    "an empty form must not write a module list it inferred from nothing");
  assert.equal("branchedRef" in out, false);
});

test("M5: naming both modules keeps the JSON free of a redundant `modules` key", () => {
  const { api } = loadAuthor();
  install(api, api.skeleton());   // the skeleton names A and B
  const out = api.toJson();
  assert.equal("modules" in out, false,
    "the names already imply A+B — writing the list would be noise on every round-trip");
});

test("M5: unticking a NAMED module writes the explicit override", () => {
  const { api } = loadAuthor();
  const live = install(api, api.skeleton());
  live.modules.B = false;                       // the facilitator unticks Module B
  assert.deepStrictEqual(api.toJson().modules, ["A"],
    "a pick that differs from the names must be written explicitly");
});

test("M5: an explicit `modules` in the source file still wins over the names", () => {
  const { api } = loadAuthor();
  const s = api.skeleton();                     // names BOTH modules
  s.modules = ["A"];
  install(api, s);
  assert.deepStrictEqual(api.getState().modules, { A: true, B: false, branched: false },
    "the declaration, not the names, must seed the tick boxes");
  assert.deepStrictEqual(api.toJson().modules, ["A"]);
});

test("M5: a declaration naming nothing we know falls back to the inference", () => {
  // Mirrors the runtime: scenarioModuleSet() ignores a declaration that names no
  // registered module rather than collapsing the session to zero stages.
  const { api } = loadAuthor();
  const s = api.skeleton();
  s.modules = ["Z"];
  install(api, s);
  assert.deepStrictEqual(api.getState().modules, { A: true, B: true, branched: false },
    "an unknown-only declaration must fall back to the name inference (A+B)");
});

/* ── the branched module ──────────────────────────────────────────────────── */

function mixedScenario(api) {
  const s = api.skeleton();
  s.modules = ["A", "B", "branched"];
  s.branchedRef = "ward-escalation-branched";
  return s;
}

test("M5: a mixed scenario round-trips its modules + branchedRef", () => {
  const { api } = loadAuthor();
  const s = mixedScenario(api);
  install(api, s);
  const sel = api.getState().modules;
  assert.deepStrictEqual(sel, { A: true, B: true, branched: true });
  const out = api.toJson();
  assert.deepStrictEqual(out.modules, ["A", "B", "branched"]);
  assert.equal(out.branchedRef, "ward-escalation-branched");
});

test("M5: ticking branched forces the list even when A+B match the names", () => {
  const { api } = loadAuthor();
  const live = install(api, api.skeleton());
  live.modules.branched = true;
  live.branchedRef = "ward-escalation-branched";
  const out = api.toJson();
  assert.deepStrictEqual(out.modules, ["A", "B", "branched"],
    "the runtime cannot INFER branched, so the list must always be written for it");
  assert.equal(out.branchedRef, "ward-escalation-branched");
});

test("M5: modules order follows the runtime's stage order (A, B, branched)", () => {
  const { api } = loadAuthor();
  const live = install(api, api.skeleton());
  live.modules.branched = true;
  assert.deepStrictEqual(api.toJson().modules, ["A", "B", "branched"]);
  assert.deepStrictEqual(api.declaredModules(), ["A", "B", "branched"]);
});

test("M5: branchedRef is emitted even while blank, so the gap is visible", () => {
  const { api } = loadAuthor();
  const live = install(api, api.skeleton());
  live.modules.branched = true;
  assert.equal(api.toJson().branchedRef, "",
    "an unpicked case must show in the preview, not vanish");
});

/* ── the double-emit trap: these keys must be MODELED, not passed through ─── */

test("M5: unticking branched DROPS both keys (no passthrough resurrection)", () => {
  const { api } = loadAuthor();
  const live = install(api, mixedScenario(api));
  live.modules.branched = false;
  const out = api.toJson();
  assert.equal("branchedRef" in out, false,
    "branchedRef must not survive in the passthrough bag after the module is unticked");
  assert.equal("modules" in out, false,
    "with A+B matching the names again, the explicit list must go too");
});

test("M5: changing the referenced case replaces it rather than duplicating", () => {
  const { api } = loadAuthor();
  const live = install(api, mixedScenario(api));
  live.branchedRef = "second-branched";
  assert.equal(api.toJson().branchedRef, "second-branched");
});

test("M5: modules/branchedRef left the passthrough known-list", () => {
  const { api } = loadAuthor();
  const state = api.fromJson(mixedScenario(api));
  assert.deepStrictEqual(Object.keys(state._extra || {}), [],
    "both keys are modeled now — keeping them in _extra double-books them");
});

/* ── validation ───────────────────────────────────────────────────────────── */

test("M5: a mixed scenario with a resolving reference validates clean", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  install(api, mixedScenario(api));
  assert.deepStrictEqual(api.validate(), []);
});

test("M5: a branched module with no case picked is rejected", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  const live = install(api, api.skeleton());
  live.modules.branched = true;
  const errs = api.validate();
  assert.ok(errs.some((e) => /branched decision case is selected but none is picked/.test(e)),
    "got: " + JSON.stringify(errs));
});

test("M5: a branchedRef that is not in the registry is rejected", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  const s = mixedScenario(api);
  s.branchedRef = "no-such-case";
  install(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /'no-such-case' is not one of the branched scenarios/.test(e)),
    "an unresolvable id renders an EMPTY branched stage at runtime; got: " + JSON.stringify(errs));
});

test("M5: a branchedRef pointing at a NON-branched scenario is rejected", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  const s = mixedScenario(api);
  s.branchedRef = "chronic-pain";
  install(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /is not a branched scenario/.test(e)),
    "got: " + JSON.stringify(errs));
});

test("M5: with the registry not yet fetched, a reference is NOT called unknown", () => {
  // The registry is lazily downloaded by the picker. Validating before that
  // finishes must not accuse a perfectly good id of being unregistered.
  const { api } = loadAuthor();     // no win.CANAMED_SCENARIOS
  install(api, mixedScenario(api));
  assert.deepStrictEqual(api.validate(), []);
});

test("M5: a selected module with neither a name nor a scoring family is rejected", () => {
  const { api } = loadAuthor();
  const s = api.skeleton();
  s.moduleBName = { en: "", fr: "", ja: "" };
  s.scoring.moduleB = [];
  s.modules = ["A", "B"];           // still ticked → an empty stage 2
  install(api, s);
  const errs = api.validate();
  assert.ok(errs.some((e) => /Module B is selected but has no name and no scoring family/.test(e)),
    "got: " + JSON.stringify(errs));
});

test("M5: selecting nothing at all is rejected", () => {
  const { api } = loadAuthor();
  const live = install(api, api.skeleton());
  live.modules = { A: false, B: false, branched: false };
  const errs = api.validate();
  assert.ok(errs.some((e) => /at least one module/i.test(e)), "got: " + JSON.stringify(errs));
});

test("M5: an A/B decision in a branched-ONLY scenario is flagged as unreachable", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  const live = install(api, mixedScenario(api));
  live.modules.A = false;
  live.modules.B = false;           // the skeleton's decision is module "A"
  const errs = api.validate();
  assert.ok(errs.some((e) => /only runs a branched decision case/.test(e)),
    "got: " + JSON.stringify(errs));
});

test("M5: the decisions[].module whitelist stays A|B — branched is never inlined", () => {
  const { api, win } = loadAuthor();
  win.CANAMED_SCENARIOS = fakeRegistry();
  const s = mixedScenario(api);
  s.decisions[0].module = "branched";
  install(api, s);
  const errs = api.validate();
  // fromJson coerces an unknown module to "A", so the invariant to pin is the
  // source rule: composition means no branched node ever enters decisions[].
  assert.equal(api.toJson().decisions[0].module, "A",
    "a branched node is REFERENCED, never inlined into decisions[]");
  assert.match(JS, /d\.module !== "A" && d\.module !== "B"/,
    "the decision-module whitelist must stay A|B");
  assert.deepStrictEqual(errs, []);
});

/* ── the pickable-case list ───────────────────────────────────────────────── */

test("M5: branchedScenarioList keeps only format:branched entries", () => {
  const { api } = loadAuthor();
  const list = api.branchedScenarioList(fakeRegistry());
  assert.deepStrictEqual(list.map((r) => r.id), ["ward-escalation-branched", "second-branched"],
    "a standard scenario must never be offered as a branched case");
  assert.match(list[0].label, /Breathless Patient/, "the English name labels the option");
  assert.match(list[0].label, /ward-escalation-branched/, "…and the id disambiguates it");
  assert.equal(list[1].label, "Plain name (second-branched)",
    "a bare-string name (some built-ins) must still label cleanly");
});

test("M5: an empty / missing registry yields an empty list, not a throw", () => {
  const { api } = loadAuthor();
  assert.deepStrictEqual(api.branchedScenarioList(null), []);
  assert.deepStrictEqual(api.branchedScenarioList({}), []);
});

/* ── lazy loading + ordering ──────────────────────────────────────────────── */

test("M5: the branched cases are lazy-loaded, chained AFTER case-content.js", () => {
  // Order is load-bearing: branched-seed.js does
  // `CANAMED_SCENARIOS = CANAMED_SCENARIOS || {}` before merging itself in, so
  // fetching it first would leave loadBuiltins() looking at a non-empty registry
  // and case-content.js would never be fetched at all.
  assert.doesNotMatch(HTML, /<script[^>]+src="branched-seed\.js"/,
    "branched-seed.js must NOT be a static tag on the author page");
  const fn = JS.slice(JS.indexOf("function ensureBranchedRefs()"));
  const body = fn.slice(0, fn.indexOf("\n  function "));
  assert.match(body, /loadBuiltins\(\)[\s\S]*injectScript\("branched-seed\.js"\)/,
    "ensureBranchedRefs must chain branched-seed.js onto loadBuiltins()");
});

/* ── markup + styling ─────────────────────────────────────────────────────── */

test("M5: the meta section carries the module tick boxes and the case picker", () => {
  assert.match(HTML, /id="mod-A"/);
  assert.match(HTML, /id="mod-B"/);
  assert.match(HTML, /id="mod-branched"/);
  assert.match(HTML, /<select id="branched-ref"/);
  // It starts hidden — it is only relevant once a branched module is ticked.
  assert.match(HTML, /class="field-row standard-only hidden" id="branched-ref-row"/,
    "the branched-case row must exist and start hidden");
  assert.match(JS, /getElementById\("mod-" \+ id\)/, "the tick boxes must be wired");
  assert.match(JS, /function syncBranchedRefRow\(/, "the picker must have a sync function");
});

test("M5: the module controls are hidden for a WHOLE-scenario branched file", () => {
  // A branched-FORMAT scenario is a single tree and declares no module list, so
  // the standard-only meta controls must not linger in that mode.
  assert.match(CSS, /\.author-form\[data-format="branched"\] \.standard-only \{ display: none; \}/);
  const modulesRow = HTML.slice(HTML.indexOf('id="modules-row"') - 120,
                                HTML.indexOf('id="modules-row"') + 20);
  assert.match(modulesRow, /standard-only/);
});
