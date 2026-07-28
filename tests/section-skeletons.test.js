/* tests/section-skeletons.test.js
 *
 * S5 — the three skeleton TYPES (the second half of the user's request):
 *
 *   "They must be called something like PBL, Roleplay, Branched Scenario and be
 *    EMPTY BUT READY TO FILL. For example for the PBL there must be a way to
 *    write the prompt to play the patient, etc."
 *
 * "Ready to fill" is the load-bearing part: every field the type supports must
 * be PRESENT with placeholder text, so the author can see the whole surface and
 * overwrite it. A skeleton that silently omits a field leaves the facilitator
 * running the built-in content without realising it.
 *
 * Skeleton TYPES stay code-owned — a facilitator authors instances, only the
 * platform owner adds a type.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const AUTHOR = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");

/* Evaluate the two builders directly — they are pure and depend only on trio(). */
function skeletons() {
  const grab = (name) => {
    const i = AUTHOR.indexOf("  function " + name + "() {");
    assert.ok(i > -1, name + "() must exist");
    const j = AUTHOR.indexOf("\n  function ", i + 1);
    return AUTHOR.slice(i, j > 0 ? j : AUTHOR.length);
  };
  const src = "const trio = (en) => ({ en: en, fr: '', ja: '' });\n" +
    grab("pblSkeletonJson") + "\n" + grab("roleplaySkeletonJson") + "\n" +
    "return { pbl: pblSkeletonJson(), roleplay: roleplaySkeletonJson() };";
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

const S = skeletons();

test("the picker LEADS with the three types the user named", () => {
  const i = AUTHOR.indexOf("function openSkeletonPicker");
  const fn = AUTHOR.slice(i, AUTHOR.indexOf("\n  function ", i + 1));
  const labels = (fn.match(/choice\("([^"]+)"/g) || []).map(m => m.slice(8, -1));
  /* The three section types come FIRST — those are what a facilitator should
     pick. The two-module starter survives only while mixed A/B authoring is
     still supported; removing the starter before the capability would leave
     that path unreachable and untestable. It is therefore last and labelled
     legacy, and S6 retires both together — this assertion is what fails when
     someone adds a fourth unlabelled entry. */
  assert.deepEqual(labels.slice(0, 2), ["PBL", "Roleplay"]);
  assert.ok(labels.indexOf("Branched Scenario") > -1, "the third named type");
  labels.slice(2).forEach(l => {
    assert.ok(l === "Branched Scenario" || /legacy/i.test(l),
      "anything beyond the three named types must be marked legacy: " + l);
  });
});

/* ── PBL ──────────────────────────────────────────────────────────────────── */

test("the PBL skeleton carries the PATIENT PERSONA PROMPT — the field asked for by name", () => {
  const patient = (S.pbl.characters || []).find(c => c.role === "patient");
  assert.ok(patient, "a PBL section without an LLM patient cannot run its chat");
  assert.ok(patient.persona && patient.persona.en.length > 100,
    "the persona must be a real writable prompt, not an empty string");
  /* It has to TEACH the shape, not just exist: these are the sections that make
     an LLM stay in character. */
  ["Never break character", "WHY YOU ARE HERE", "WHAT YOU KNOW", "HOW YOU SPEAK"]
    .forEach(k => assert.ok(patient.persona.en.indexOf(k) > -1,
      "the persona template must prompt for: " + k));
});

test("the PBL skeleton declares itself a single PBL section", () => {
  assert.deepEqual(S.pbl.modules, ["A"]);
  assert.ok(S.pbl.moduleAName && S.pbl.moduleAName.en);
  assert.equal(S.pbl.moduleBName, undefined, "a PBL section is not half of a pair");
});

test("the PBL skeleton exposes the whole authorable surface", () => {
  /* Exactly the must-haves chosen in the Q&A: persona + vignette, workup items
     with scoring, decisions, and per-section tests + objectives. */
  ["history", "exam", "labs"].forEach(g =>
    assert.ok((S.pbl.case[g] || []).length, "the workup needs a starter " + g + " item"));
  assert.ok((S.pbl.scoring.moduleA || []).length, "an answer key to edit");
  assert.ok((S.pbl.penalties || []).length, "a penalty item to edit");
  assert.ok((S.pbl.decisions || []).length, "a vote card to edit");
  assert.ok((S.pbl.preTest || []).length && (S.pbl.postTest || []).length,
    "per-section tests (decision 3)");
});

test("the PBL synthesis gate points at items that actually exist", () => {
  const ids = [];
  ["history", "exam", "labs"].forEach(g =>
    (S.pbl.case[g] || []).forEach((_, i) => ids.push(g + ":" + i)));
  assert.ok(ids.indexOf(S.pbl.synthId) > -1, "synthId must reference a real item");
  (S.pbl.synthPrereqs || []).forEach(p =>
    assert.ok(ids.indexOf(p) > -1, "prereq " + p + " must reference a real item"));
  (S.pbl.penalties || []).forEach(pen =>
    assert.ok(ids.indexOf(pen.item) > -1, "penalty item " + pen.item + " must exist"));
});

/* ── Roleplay ─────────────────────────────────────────────────────────────── */

test("the Roleplay skeleton fills EVERY part S1c made authorable", () => {
  /* If the skeleton omitted one of these, the facilitator would silently run
     the built-in breaking-bad-news content in its place. */
  const rp = S.roleplay.roleplay;
  assert.ok(rp, "a roleplay section needs its roleplay block");
  assert.ok(rp.title, "title");
  assert.ok(Array.isArray(rp.vignette) && rp.vignette.length, "vignette");
  assert.ok(Array.isArray(rp.roles) && rp.roles.length >= 3, "a cast");
  assert.ok(rp.framework, "an observation framework");
  assert.ok(Array.isArray(rp.phases) && rp.phases.length, "a phase timetable");
  assert.ok(rp.panels && Object.keys(rp.panels).length, "at least one reference panel");
});

test("every role in the Roleplay skeleton has a PRIVATE BRIEF to write", () => {
  S.roleplay.roleplay.roles.forEach(r => {
    assert.ok(/^[a-z][a-z0-9_-]{0,23}$/.test(r.id), r.id + " must be a valid role id");
    assert.ok(r.name, r.id + " needs a display name");
    assert.ok(r.brief && r.brief.length > 20,
      r.id + " needs a private brief — that is the whole mechanic");
  });
  const ids = S.roleplay.roleplay.roles.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate role ids break the deck");
});

test("the Roleplay skeleton's framework is one the library actually ships", () => {
  const SC = fs.readFileSync(path.join(P, "section-content.js"), "utf8");
  const i = SC.indexOf("const OBSERVATION_FRAMEWORKS");
  const lib = SC.slice(i, SC.indexOf("\n  function observationFramework", i));
  assert.ok(lib.indexOf('"' + S.roleplay.roleplay.framework + '"') > -1 ||
            lib.indexOf(S.roleplay.roleplay.framework + ":") > -1,
    "an unknown id degrades to the shipped SPIKES list — a silent wrong default");
});

test("the Roleplay skeleton's phases are valid ids with minutes", () => {
  S.roleplay.roleplay.phases.forEach(ph => {
    assert.ok(/^[a-z][a-z0-9_-]{0,23}$/.test(ph.id), ph.id + " must be a valid phase id");
    assert.ok(ph.label, ph.id + " needs a label");
    assert.ok(typeof ph.minutes === "number" && ph.minutes > 0, ph.id + " needs minutes");
  });
});

test("the Roleplay skeleton declares itself a single Roleplay section", () => {
  assert.deepEqual(S.roleplay.modules, ["B"]);
  assert.ok(S.roleplay.moduleBName && S.roleplay.moduleBName.en);
  assert.equal(S.roleplay.moduleAName, undefined);
  assert.ok((S.roleplay.preTest || []).length && (S.roleplay.postTest || []).length);
});

test("both skeletons carry their own id, so a save cannot overwrite a built-in", () => {
  assert.equal(S.pbl.id, "new-pbl-section");
  assert.equal(S.roleplay.id, "new-roleplay-section");
  assert.notEqual(S.pbl.id, S.roleplay.id);
});

test("every decision is tagged with the module its section runs", () => {
  (S.pbl.decisions || []).forEach(d => assert.equal(d.module, "A"));
  (S.roleplay.decisions || []).forEach(d => assert.equal(d.module, "B"));
});
