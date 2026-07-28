/* tests/observation-framework.test.js
 *
 * S1c-3a: the observer's tick-list comes from a shipped framework LIBRARY
 * (decision 11), not from six hardcoded SPIKES <li> in index.html — an
 * antibiotic-negotiation roleplay was handing its observer a breaking-bad-news
 * checklist.
 *
 * Library = code-owned (same rule as the skeleton types); instances =
 * facilitator-owned, with a custom escape hatch.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8") +
  /* S3a — the roleplay content renderers were extracted to the room-only
     section-content.js chunk to reclaim splash bytes. These assertions are
     about the CODE, not about which file carries it. */
  fs.readFileSync(path.join(P, "section-content.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");

function lib(win) {
  const start = SCRIPT.indexOf("const OBSERVATION_FRAMEWORKS");
  assert.ok(start > -1, "the framework library must exist");
  const end = SCRIPT.indexOf("function renderObserverChecklist", start);
  const src = SCRIPT.slice(start, end) +
    "\nreturn { OBSERVATION_FRAMEWORKS, observationFramework };";
  // eslint-disable-next-line no-new-func
  return new Function("window", src)(win || {});
}

test("declaring nothing keeps the shipped SPIKES list", () => {
  assert.equal(lib({}).observationFramework(), null,
    "null means 'leave the markup alone' — the built-ins must not re-render");
  const i = SCRIPT.indexOf("function renderObserverChecklist");
  assert.match(SCRIPT.slice(i, i + 200), /if \(!fw\) return;/);
});

test("the library ships three frameworks, SPIKES keeping its i18n keys", () => {
  const L = lib({}).OBSERVATION_FRAMEWORKS;
  assert.deepEqual(Object.keys(L).sort(),
    ["calgary-cambridge", "pause-explore-explain-realign", "spikes"]);
  assert.equal(L.spikes.steps.length, 6);
  L.spikes.steps.forEach(s => assert.match(s.labelKey, /^modB\.obs\./,
    "SPIKES translations already exist — reuse them, do not restate"));
  assert.ok(L["calgary-cambridge"].steps.every(s => s.label && !s.labelKey));
});

test("a section picks a library framework by id", () => {
  const f = lib({ CURRENT_SECTION_ROLEPLAY: { framework: "pause-explore-explain-realign" } })
    .observationFramework();
  assert.equal(f.steps.length, 4);
  assert.match(f.label, /Pause/);
});

test("an unknown framework id degrades to the shipped list, not an empty one", () => {
  assert.equal(
    lib({ CURRENT_SECTION_ROLEPLAY: { framework: "no-such-framework" } })
      .observationFramework(), null);
});

test("a section may supply a custom framework", () => {
  const f = lib({ CURRENT_SECTION_ROLEPLAY: { framework: {
    label: "Our own", steps: [{ id: "a", label: "Asked first" }, { id: "b", label: "Then told" }]
  } } }).observationFramework();
  assert.equal(f.label, "Our own");
  assert.deepEqual(f.steps.map(s => s.id), ["a", "b"]);
});

test("custom step ids are validated — they key the observer's scratchpad", () => {
  const f = lib({ CURRENT_SECTION_ROLEPLAY: { framework: { steps: [
    { id: "ok1" }, { id: "has space" }, { id: "" }, { id: "x".repeat(40) }
  ] } } }).observationFramework();
  assert.deepEqual(f.steps.map(s => s.id), ["ok1"],
    "a malformed id would silently fail to persist in sessionStorage");
  assert.equal(
    lib({ CURRENT_SECTION_ROLEPLAY: { framework: { steps: [{ id: "!!" }] } } })
      .observationFramework(), null,
    "a custom framework with no usable step must not empty the checklist");
});

test("the renderer re-arms the persistence wiring", () => {
  const i = SCRIPT.indexOf("function renderObserverChecklist");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nconst SECTION_TYPE_FOR_MODULE", i));
  assert.match(fn, /root\.dataset\.wired = "";[\s\S]*initObserverChecklist\(\)/,
    "initObserverChecklist binds once over the boxes that existed then");
  assert.ok(!/innerHTML/.test(fn), "step labels may be facilitator-authored");
  assert.match(fn, /setAttribute\("data-obs", step\.id\)/,
    "the wiring selects on [data-obs]");
});

test("the shipped SPIKES markup stays in the shell", () => {
  assert.ok(HTML.indexOf('id="observer-checklist"') > -1);
  ["s", "p", "i", "k", "e", "s2"].forEach(k =>
    assert.ok(HTML.indexOf('data-obs="' + k + '"') > -1, k + " must remain"));
});
