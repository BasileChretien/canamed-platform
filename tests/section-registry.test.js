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

test("the known thin-section gap is pinned, so filling it is visible", () => {
  /* Decision 10: the jaundice case's items are almost entirely disclosure, so
     its PBL section starts with 0 pre-test and 1 post-test item. Drafted items
     await medical review (ARCHITECTURE/section-test-items-proposal.md). When
     they are merged this test SHOULD fail — update the numbers then. */
  assert.equal(SECTIONS["jaundice-pbl"].preTest.length, 0);
  assert.equal(SECTIONS["jaundice-pbl"].postTest.length, 1);
  assert.equal(SECTIONS["jaundice-roleplay"].preTest.length, 10);
});

test("S0 is inert — no shell tag loads the registry yet", () => {
  const html = fs.readFileSync(path.join(P, "index.html"), "utf8");
  assert.ok(html.indexOf("section-registry.js") === -1,
    "S0 must not be wired into the shell (that is S1, with a version bump)");
});
