/* tests/section-registry.test.js
 *
 * S0 of the section model (ARCHITECTURE/section-model-design.md): the flat
 * SECTION library derived from the scenario registry. A session becomes
 * opening + N independently-picked sections + wrap-up, so the three built-in
 * cases must yield 3 PBL + 3 Roleplay sections and the branched case 1 more.
 *
 * S0 is INERT — nothing loads section-registry.js in the browser yet. These
 * tests are therefore the only thing exercising it, and they pin the two
 * things a later phase could silently break: the content routing (a roleplay
 * must not inherit the workup board) and the per-item test classification
 * (a new test item must not default silently into one section).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const REG = require(path.join(P, "section-registry.js"));

/* The content files are browser scripts assigning globals; load them through a
   window shim the same way the other case-content tests do. branched-seed.js
   merges its case INTO window.CANAMED_SCENARIOS, so it must run after
   case-content.js — the same order script-loader.js uses. */
function loadScenarios() {
  const win = {};
  ["case-content.js", "branched-seed.js"].forEach(f => {
    const p = path.join(P, f);
    if (!fs.existsSync(p)) return;
    // eslint-disable-next-line no-new-func
    new Function("window", "self", fs.readFileSync(p, "utf8")).call(win, win, win);
  });
  return win.CANAMED_SCENARIOS || {};
}

const SCENARIOS = loadScenarios();
const SECTIONS = REG.buildSectionRegistry(SCENARIOS);

test("the three standard cases each yield a PBL and a Roleplay section", () => {
  ["chronic-pain", "jaundice", "sore-throat"].forEach(slug => {
    assert.ok(SECTIONS[slug + "-pbl"], slug + "-pbl must exist");
    assert.ok(SECTIONS[slug + "-roleplay"], slug + "-roleplay must exist");
  });
});

test("the branched case keeps its existing id (branchedRef points at it)", () => {
  const b = SECTIONS["ward-escalation-branched"];
  assert.ok(b, "the branched section must be in the library");
  assert.equal(b.type, "branched");
  assert.ok(b.content.decisions.length > 0, "its graph must come through");
});

test("section titles drop the Module A/B prefix in all three languages", () => {
  const a = SECTIONS["jaundice-pbl"].name;
  const b = SECTIONS["jaundice-roleplay"].name;
  [a, b].forEach(n => {
    ["en", "fr", "ja"].forEach(lang => {
      assert.ok(n[lang], "a title is needed in " + lang);
      assert.ok(!REG.MODULE_PREFIX.test(n[lang]),
        "must not keep the module prefix: " + n[lang]);
    });
  });
  assert.equal(a.en, "Painless jaundice workup");
  assert.equal(b.en, "Breaking Bad News across cultures");
});

test("stripModulePrefix handles the Japanese prefix and leaves clean names alone", () => {
  assert.equal(REG.stripModulePrefix({ ja: "モジュールA — 無痛性黄疸の臨床的精査" }).ja,
    "無痛性黄疸の臨床的精査");
  assert.equal(REG.stripModulePrefix({ en: "The breathless patient" }).en,
    "The breathless patient");
});

test("the workup board belongs to the PBL section only", () => {
  const pbl = SECTIONS["chronic-pain-pbl"];
  const rp = SECTIONS["chronic-pain-roleplay"];
  assert.ok(pbl.content.case, "the PBL section carries the case");
  assert.ok(pbl.content.penalties.length > 0, "and its penalties");
  assert.equal(pbl.content.synthId, "labs:0");
  assert.equal(rp.content.case, undefined, "a roleplay has no workup board");
  assert.equal(rp.content.penalties, undefined, "nor penalty items");
});

test("scoring and decisions are split by module, not shared", () => {
  const pbl = SECTIONS["sore-throat-pbl"];
  const rp = SECTIONS["sore-throat-roleplay"];
  assert.ok(pbl.content.scoring.length > 0);
  assert.ok(rp.content.scoring.length > 0);
  assert.notDeepStrictEqual(pbl.content.scoring, rp.content.scoring);
  assert.ok(pbl.content.decisions.every(d => d.module === "A"));
  assert.ok(rp.content.decisions.every(d => d.module === "B"));
  const total = SCENARIOS["respiratory-stewardship"].decisions.length;
  assert.equal(pbl.content.decisions.length + rp.content.decisions.length, total,
    "every decision must land in exactly one section");
});

test("characters follow their module (the LLM patient stays with the PBL)", () => {
  const pbl = SECTIONS["chronic-pain-pbl"];
  const patient = pbl.content.characters.find(c => c.id === "patient");
  assert.ok(patient, "the LLM patient belongs to the PBL section");
  assert.ok(patient.persona && patient.persona.en, "with its persona prompt");
  SECTIONS["chronic-pain-roleplay"].content.characters.forEach(c => {
    assert.ok(c.module.indexOf("B") !== -1);
  });
});

test("every test item is classified — a new one must not default silently", () => {
  const missing = REG.unclassifiedTestItems(SCENARIOS);
  assert.deepEqual(missing, [],
    "unclassified test items (add them to TEST_SPLIT in section-registry.js): " +
    missing.join(", "));
});

test("test items are partitioned, never duplicated or dropped", () => {
  Object.keys(REG.TEST_SPLIT).forEach(sid => {
    [["pre", "preTest"], ["post", "postTest"]].forEach(pair => {
      const items = SCENARIOS[sid][pair[1]];
      const slug = REG.SECTION_SOURCES.find(s => s.scenarioId === sid).slug;
      const inPbl = SECTIONS[slug + "-pbl"][pair[0] + "Test"];
      const inRp = SECTIONS[slug + "-roleplay"][pair[0] + "Test"];
      assert.equal(inPbl.length + inRp.length, items.length,
        sid + " " + pair[0] + "-test must partition exactly");
      const ids = inPbl.concat(inRp).map(i => i.id);
      assert.equal(new Set(ids).size, ids.length, "no item in two sections");
    });
  });
});

test("every section has a blurb of its own, not the case-wide one", () => {
  Object.keys(SECTIONS).forEach(id => {
    const s = SECTIONS[id];
    assert.ok(s.summary && s.summary.en, id + " needs a summary");
    assert.equal(s.summaryIsCaseWide, false,
      id + " must not inherit the case summary — stage 0 prints one blurb per " +
      "picked section, and a case summary advertises the other half too");
    const caseSummary = (SCENARIOS[s.source].summary || {}).en || "";
    assert.notEqual(s.summary.en, caseSummary);
  });
});

test("the two sections of one case get DIFFERENT blurbs", () => {
  assert.notEqual(SECTIONS["jaundice-pbl"].summary.en,
                  SECTIONS["jaundice-roleplay"].summary.en);
});

test("the jaundice PBL gap is FILLED — every section carries its own test", () => {
  /* This test used to pin the gap: jaundice-pbl had 0 pre-test and 1 post-test
     item, because the case's questions were written almost entirely around
     disclosure. The drafted workup items were approved 2026-07-28 and merged,
     so the assertion flips from documenting the hole to guarding the fill. */
  assert.equal(SECTIONS["jaundice-pbl"].preTest.length, 6);
  assert.equal(SECTIONS["jaundice-pbl"].postTest.length, 5,
    "the pre-existing ERCP item plus the four approved ones");
  assert.equal(SECTIONS["jaundice-roleplay"].preTest.length, 10,
    "the disclosure half is unchanged");

  /* The other three thin halves, filled in the same pass: chronic-pain-roleplay
     and sore-throat-roleplay had ONE pre-test item each, sore-throat-pbl ONE
     post-test item. A section that can be picked alone needs a knowledge check
     that is about the section — so the floor is 4, not 1. */
  Object.keys(SECTIONS).forEach(id => {
    if (SECTIONS[id].type === "branched") return;   // branched cases carry none
    assert.ok(SECTIONS[id].preTest.length >= 4,
      id + " pre-test is too thin to stand alone (" + SECTIONS[id].preTest.length + ")");
    assert.ok(SECTIONS[id].postTest.length >= 4,
      id + " post-test is too thin to stand alone (" + SECTIONS[id].postTest.length + ")");
  });
});

test("every section carries at least one vote card of its own", () => {
  /* The same gap as the test items, on the other axis. jaundice-pbl had zero
     Module A decisions and sore-throat-roleplay zero Module B ones, because
     each case's votes had been written entirely around one of its two halves.
     Harmless while a session ran both halves of one case; under the section
     model either half can be picked alone, and it would then reach the
     decide-together stage with nothing to decide. Filled 2026-07-28. */
  Object.keys(SECTIONS).forEach(id => {
    assert.ok(SECTIONS[id].content.decisions.length > 0,
      id + " must carry at least one decision of its own");
  });
  assert.equal(SECTIONS["jaundice-pbl"].content.decisions.length, 2);
  assert.equal(SECTIONS["sore-throat-roleplay"].content.decisions.length, 2);
});

test("no two decisions in a case share an id (they become RTDB vote keys)", () => {
  /* Decision ids are namespaced per slot (s<slot>_<id>) but stay unique WITHIN
     a section, so a duplicate id in one bank would collapse two votes onto one
     ballot node. */
  Object.keys(SECTIONS).forEach(id => {
    const ids = SECTIONS[id].content.decisions.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length, id + " has a duplicate vote id");
  });
});

test("sectionsForScenario is the ONE derivation — and honours a null slug", () => {
  /* buildSectionRegistry() now delegates to sectionsForScenario() so there is a
     single answer to "what sections does this scenario have?", reusable for a
     scenario that is NOT in SECTION_SOURCES (i.e. one a facilitator authored).

     The null-slug branch is the trap, and it bit on the first attempt: the
     BRANCHED case deliberately carries `slug: null` in SECTION_SOURCES because
     it keeps its own scenario id, so a blanket `if (!slug) return []` drops it
     from the library entirely — and `branchedRef` composition then resolves
     nothing. */
  const branched = SCENARIOS["ward-escalation-branched"];
  const fromNull = REG.sectionsForScenario(branched, null);
  assert.equal(fromNull.length, 1, "a branched case yields one section, slug or not");
  assert.equal(fromNull[0].id, "ward-escalation-branched", "and keeps its own id");

  /* A non-branched scenario without a slug cannot form `<slug>-<type>` ids, so
     it yields nothing rather than "null-pbl". */
  assert.deepEqual(REG.sectionsForScenario(SCENARIOS["chronic-pain-opioids"], null), []);

  const pair = REG.sectionsForScenario(SCENARIOS["chronic-pain-opioids"], "chronic-pain");
  assert.deepEqual(pair.map(s => s.id), ["chronic-pain-pbl", "chronic-pain-roleplay"],
    "PBL before Roleplay — picker order");

  assert.deepEqual(REG.sectionTypesFor(branched), ["branched"]);
  assert.deepEqual(REG.sectionTypesFor(SCENARIOS["chronic-pain-opioids"]), ["pbl", "roleplay"]);
  assert.deepEqual(REG.sectionsForScenario(null, "x"), [], "no scenario, no sections");
});

test("the built-in library is exactly what sectionsForScenario yields", () => {
  /* Guards the delegation itself: if buildSectionRegistry ever stops routing
     through the shared helper, the two can drift again — which is the whole
     failure mode this extraction exists to close. */
  const viaHelper = {};
  REG.SECTION_SOURCES.forEach(src => {
    REG.sectionsForScenario(SCENARIOS[src.scenarioId], src.slug)
      .forEach(sec => { viaHelper[sec.id] = sec; });
  });
  assert.deepEqual(Object.keys(viaHelper).sort(), Object.keys(SECTIONS).sort());
});

test("S0 is inert — no shell tag loads the registry yet", () => {
  const html = fs.readFileSync(path.join(P, "index.html"), "utf8");
  assert.ok(html.indexOf("section-registry.js") === -1,
    "S0 must not be wired into the shell (that is S1, with a version bump)");
});
