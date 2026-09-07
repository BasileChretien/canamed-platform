/* tests/mayumi-content.test.js
 *
 * "A Difficult Child (Mayumi)" — the Nagoya PBL No. 57 ported as six PBL
 * sections (mayumi-seed.js). These tests pin the CONTRACTS the content relies
 * on, not the clinical prose:
 *   - the seed registers six scenarios that the real registry turns into six
 *     PBL sections, in reveal order, with no roleplay half;
 *   - facts are CUMULATIVE (section n carries everything before it) and every
 *     fact is owned by a declared character;
 *   - every step declares exactly one index patient, and Mayumi is only
 *     OFFERED in the steps where the tutorial puts her in the room;
 *   - every chat scoring family's `askOf` names someone present in that step;
 *   - each section carries a vote and four pre/post items, all classified;
 *   - the author's own validate() accepts every section, so a facilitator who
 *     clones one gets a form they can save.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SEED = require(path.join(P, "mayumi-seed.js"));
const IDS = ["mayumi-1", "mayumi-2", "mayumi-3", "mayumi-4", "mayumi-5", "mayumi-6"];

function loadRegistry() {
  const ctx = {};
  ctx.module = { exports: {} };
  ["case-content.js", "branched-seed.js", "mayumi-seed.js", "section-registry.js"].forEach(f => {
    const src = fs.readFileSync(path.join(P, f), "utf8");
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);
  });
  return { ctx, sections: ctx.buildSectionRegistry(ctx.CANAMED_SCENARIOS) };
}

function loadPrompts() {
  const ctx = {};
  ctx.module = { exports: {} };
  ["modA-question-scoring.js", "modA-llm-prompts.js", "modA-llm-bridge.js"].forEach(f => {
    const src = fs.readFileSync(path.join(P, f), "utf8");
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", src).call(ctx, ctx, ctx, ctx.module);
  });
  return ctx;
}

const ownersOf = (item) => item.who == null ? ["patient"] : [].concat(item.who).map(String);
const offered = (sc) => sc.characters.filter(c => c.present !== "onCue").map(c => c.id);

test("the seed is six scenarios in reveal order, PBL-only, each with exactly one index patient", () => {
  assert.deepEqual(SEED.map(s => s.id), IDS);
  for (const sc of SEED) {
    assert.deepEqual(sc.modules, ["A"], sc.id + " runs Module A only");
    assert.ok(!sc.moduleBName && !(sc.scoring || {}).moduleB, sc.id + " has no roleplay half");
    assert.equal(sc.characters.filter(c => c.role === "patient").length, 1, sc.id + " declares one patient");
    assert.ok(sc.summary && sc.summary.en, sc.id + " carries its own blurb");
  }
});

test("the real registry derives six PBL sections and no roleplay sections from them", () => {
  const { ctx, sections } = loadRegistry();
  const ids = IDS.map(id => id + "-pbl");
  ids.forEach(id => assert.ok(sections[id], id + " must exist"));
  IDS.forEach(id => assert.ok(!sections[id + "-roleplay"], "no roleplay half for " + id));
  // Picker order = SECTION_SOURCES order = reveal order.
  const order = Object.keys(sections).filter(k => k.startsWith("mayumi"));
  assert.deepEqual(order, ids);
  assert.deepEqual(ctx.unclassifiedTestItems(ctx.CANAMED_SCENARIOS), [],
    "every knowledge item must be classified (TEST_SPLIT)");
  ids.forEach(id => {
    const sec = sections[id];
    assert.equal(sec.type, "pbl");
    assert.equal(sec.preTest.length, 4, id + " pre-test");
    assert.equal(sec.postTest.length, 4, id + " post-test");
    assert.ok(sec.content.decisions.length >= 1, id + " carries a vote");
    assert.ok(sec.content.case && sec.content.case.history.length > 0, id + " carries facts");
    assert.ok((sec.content.scoringQuestions || []).length > 0, id + " carries chat scoring");
    assert.equal(sec.content.characters.length, 3, id + " carries the whole cast");
  });
});

test("Mayumi is offered only from the home visit on; the parents throughout", () => {
  assert.deepEqual(offered(SEED[0]), ["father", "mother"]);
  assert.deepEqual(offered(SEED[1]), ["father", "mother"]);
  for (const sc of SEED.slice(2)) assert.deepEqual(offered(sc), ["patient", "father", "mother"], sc.id);
  // The switchboard's cast helper agrees: with no patient offered, two chips.
  const ctx = loadPrompts();
  ctx.CURRENT_SCENARIO_CHARACTERS = SEED[0].characters;
  assert.deepEqual(ctx.modALLMPrompts.moduleACharacters().map(c => c.id), ["father", "mother"]);
  assert.equal(ctx.modALLMPrompts.defaultCharacterId(), "patient",
    "the index patient is still the default id — the panel must fall back to the first OFFERED character");
});

test("facts are cumulative: each step carries every earlier fact, in order, and adds its own", () => {
  for (let i = 1; i < SEED.length; i++) {
    const prev = SEED[i - 1].case.history, cur = SEED[i].case.history;
    assert.ok(cur.length >= prev.length, SEED[i].id + " must not lose facts");
    prev.forEach((item, k) => assert.strictEqual(cur[k], item, SEED[i].id + " fact " + k + " must be the same object as in the previous step"));
  }
  // The steps that add nothing new are the ones the tutorial says add nothing.
  assert.equal(SEED[1].case.history.length, SEED[0].case.history.length, "the chief complaint adds no fact — the point of section 2");
  assert.ok(SEED[2].case.history.length > SEED[1].case.history.length, "the home visit adds facts");
});

test("every fact is owned by a declared character, and Mayumi owns none before she is in the room", () => {
  for (const sc of SEED) {
    const cast = sc.characters.map(c => c.id);
    sc.case.history.forEach((item, k) => {
      ownersOf(item).forEach(o => assert.ok(cast.includes(o), sc.id + " fact " + k + " owner " + o + " is not in the cast"));
      assert.ok(item.q && item.q.en && item.a && item.a.en, sc.id + " fact " + k + " needs q/a");
    });
  }
  for (const sc of SEED.slice(0, 2)) {
    sc.case.history.forEach((item, k) =>
      assert.ok(!ownersOf(item).includes("patient"), sc.id + " fact " + k + " is Mayumi's but she is absent"));
  }
});

test("the prompt builder routes a shared parents' fact to both parents and to nobody else", () => {
  const ctx = loadPrompts();
  ctx.CURRENT_SCENARIO_CHARACTERS = SEED[2].characters;
  ctx.CASE = SEED[2].case;
  const sys = (id) => ctx.modALLMPrompts.buildPatientPrompt("en", { characterId: id });
  assert.match(sys("father"), /principal at Mayumi's school/);
  assert.match(sys("mother"), /principal at Mayumi's school/);
  assert.doesNotMatch(sys("patient"), /principal at Mayumi's school/);
  // Mayumi's own lines reach only her; the mother's own mood reaches only the mother.
  assert.match(sys("patient"), /It's no use anyway/);
  assert.doesNotMatch(sys("father"), /It's no use anyway/);
  assert.match(sys("mother"), /tired and down/);
  assert.doesNotMatch(sys("father"), /irritable bowel/);
});

test("every askOf names a character who is OFFERED in that step, and stems are lower-case", () => {
  for (const sc of SEED) {
    const present = offered(sc);
    const fams = [].concat(sc.scoring.moduleA_questions, sc.scoring.moduleA_question_penalties || []);
    for (const f of fams) {
      assert.ok(f.id && f.points > 0 && Array.isArray(f.any) && f.any.length, sc.id + " family " + f.id);
      f.any.forEach(st => assert.equal(st, st.toLowerCase(), sc.id + " " + f.id + " stem '" + st + "' must be lower-case (the scorer lower-cases the question only)"));
      if (f.askOf != null) {
        [].concat(f.askOf).forEach(who => assert.ok(present.includes(who),
          sc.id + " " + f.id + " askOf " + who + " but only " + present.join(",") + " are offered"));
      }
    }
    const ids = fams.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length, sc.id + " duplicate family id");
  }
});

test("no scoring stem is short enough to fire on an innocent word, unless hand-exempted", () => {
  /* The scorer matches by plain substring, so a bare "ill" fires on "will" and
     a bare "down" on "sit down" (both found in review). Every stem under four
     characters must be an abbreviation or number a student would actually
     type, listed here on purpose. */
  const EXEMPT = new Set(["asd", "ebv", "crp", "tsh", "fbc", "cbc", "b12", "mdd", "cbt", "sex", "16", "27", "33"]);
  for (const sc of SEED) {
    const fams = [].concat(sc.scoring.moduleA, sc.scoring.moduleA_questions, sc.scoring.moduleA_question_penalties || []);
    for (const f of fams) f.any.forEach(st => {
      if (st.trim().length < 4) assert.ok(EXEMPT.has(st.trim()), sc.id + " " + f.id + " stem '" + st + "' is too short to be safe");
    });
  }
});

test("a family history question at the mother scores; the same words at Mayumi do not", () => {
  const ctx = loadPrompts();
  ctx.CURRENT_SCENARIO_CHARACTERS = SEED[2].characters;
  ctx.SCORING = SEED[2].scoring;
  const SC = ctx.modAQuestionScoring;
  assert.ok(SC.scoreQuestion("Is there any depression in the family?", {}, "mother").award.includes("q3_family_psych"));
  assert.ok(!SC.scoreQuestion("Is there any depression in the family?", {}, "patient").award.includes("q3_family_psych"));
  assert.ok(SC.scoreQuestion("Have you ever thought about hurting yourself?", {}, "patient").award.includes("q3_suicide_direct"));
});

test("every vote has one correct option, a why for each option, and unique ids per section", () => {
  for (const sc of SEED) {
    const ids = sc.decisions.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length, sc.id + " duplicate vote id");
    for (const d of sc.decisions) {
      assert.equal(d.module, "A");
      assert.ok(d.prompt && d.prompt.en);
      assert.equal(d.options.filter(o => o.correct).length, 1, sc.id + " " + d.id + " needs exactly one correct option");
      d.options.forEach(o => assert.ok(o.text.en && o.why.en, sc.id + " " + d.id + " every option needs text + why"));
    }
  }
});

test("every knowledge item has one correct option and an explanation", () => {
  for (const sc of SEED) {
    [["pre", sc.preTest], ["post", sc.postTest]].forEach(([which, items]) => {
      assert.equal(items.length, 4, sc.id + " " + which);
      items.forEach(it => {
        assert.equal(it.options.filter(o => o.correct).length, 1, sc.id + " " + which + " " + it.id);
        assert.ok(it.explanation && it.explanation.en, sc.id + " " + which + " " + it.id + " explanation");
        assert.ok(it.options.length >= 3);
      });
    });
  }
});

test("each section's synthesis item is labs[0] with key:true, and section 5 carries every result the handout lists", () => {
  for (const sc of SEED) {
    assert.equal(sc.synthId, "labs:0");
    assert.equal(sc.case.labs[0].key, true, sc.id);
  }
  const labs5 = SEED[4].case.labs.map(l => l.q.en).join(" | ");
  ["Full blood count", "CRP", "Monospot", "Glucose", "Thyroid", "Ferritin", "MRI", "EEG"].forEach(k =>
    assert.match(labs5, new RegExp(k), "section 5 must offer " + k));
  const mfq = SEED[3].case.labs.find(l => /Mood and Feelings/.test(l.q.en));
  assert.ok(mfq, "section 4 offers the MFQ");
  assert.match(mfq.a.en, /TOTAL 33 \/ 66/, "the MFQ carries Mayumi's real total");
  for (const sc of SEED) {
    assert.equal(sc.penalties.length, 1, sc.id + " carries its trap penalty");
    assert.equal(sc.penalties[0].item, "labs:1", sc.id + " trap is labs[1]");
    assert.equal(sc.case.labs[1].indicated, false, sc.id + " labs[1] is the trap");
    assert.ok(sc.case.exam.length >= 1, sc.id + " has an observation or examination");
  }
  assert.equal(SEED[3].case.exam.length, 6, "section 4 has the examination");
});

test("the handout wins over the app where they differ: the SSRI is escitalopram", () => {
  const six = JSON.stringify(SEED[5]);
  assert.match(six, /escitalopram/);
  assert.ok(!/fluoxetine was/.test(six));
});

test("the author's validate() accepts every section (a facilitator can clone and save it)", () => {
  const JS = fs.readFileSync(path.join(P, "scenario-author.js"), "utf8");
  for (const sc of SEED) {
    const win = {};
    const doc = { readyState: "loading", addEventListener() {} };
    // eslint-disable-next-line no-new-func
    new Function("window", "document", JS)(win, doc);
    const api = win.__scenarioAuthor;
    const parsed = api.fromJson(JSON.parse(JSON.stringify(sc)));
    const live = api.getState();
    Object.keys(live).forEach(k => { delete live[k]; });
    Object.assign(live, parsed);
    const errs = api.validate();
    assert.deepStrictEqual(errs, [], sc.id + " must validate clean; got " + JSON.stringify(errs));
  }
});

test("the seed is loaded by the shell in the same place as the branched seed, before the registry", () => {
  const loader = fs.readFileSync(path.join(P, "script-loader.js"), "utf8");
  const sw = fs.readFileSync(path.join(P, "sw.js"), "utf8");
  const a = loader.indexOf('loadScript(v("branched-seed.js"))');
  const b = loader.indexOf('loadScript(v("mayumi-seed.js"))');
  const c = loader.indexOf('loadScript(v("section-registry.js"))');
  assert.ok(a > 0 && b > a && c > b, "branched-seed → mayumi-seed → section-registry, chained");
  assert.match(sw, /"\/mayumi-seed\.js",/, "precached like every lazy chunk");
});
