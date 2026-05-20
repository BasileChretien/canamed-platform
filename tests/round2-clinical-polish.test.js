/* tests/round2-clinical-polish.test.js
 *
 * Lock-in tests for the Round-2 clinical-POLISH edits
 * (see sim-output/round2-clinical-ebm.md). These complement
 * tests/round2-clinical.test.js (the earlier high-severity content fixes)
 * and cover the medium-severity polish round:
 *
 *   P1  Scenario 2 (Tanaka) gains a `dec_prognosis` vote — explore what
 *       kind of answer she wants BEFORE giving a median; trap option blurts
 *       "6-11 months".  (round2-clinical-ebm.md Scenario 2 Edit 1)
 *
 *   P2  Scenario 2 MDT/exam summary names an ECOG performance status, and a
 *       `dec_ercp_stent` biliary-stent decision is added to DECISIONS_B.
 *
 *   P3  Pre/post-test MCQ banks exist for scenarios 2 and 3 and are wired
 *       into the scenario registry the same way scenario 1's are.
 *
 *   P4  FACILITATOR_NOTES covers all three scenarios in en / fr / ja and is
 *       exposed on window the way the other globals are.
 *
 * Style mirrors tests/round2-clinical.test.js: read case-content.js as text
 * and regex-match. The file ships with CRLF line terminators, so multi-line
 * patterns use [\s\S] (which matches \r and \n) rather than the /m or /s
 * dotted-newline shorthands tied to a single newline convention.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE_CONTENT = fs.readFileSync(
  path.join(PLATFORM, "case-content.js"), "utf8");

// Strip CRLF -> LF up front so the cross-line [\s\S] windows below behave
// identically regardless of how the file was checked out.
const SRC = CASE_CONTENT.replace(/\r\n/g, "\n");

// ------------------------------------------------------------------
// Pre-flight: the file must still load under Node with no error.
// case-content.js is browser-authored (assigns onto `window`); it carries a
// `typeof window === "undefined"` shim so `require()` does not throw.
// ------------------------------------------------------------------
test("Round2-polish-P0: case-content.js loads under Node without throwing", () => {
  assert.doesNotThrow(() => {
    require(path.join(PLATFORM, "case-content.js"));
  }, "case-content.js must require() cleanly under Node");
});

// ------------------------------------------------------------------
// P1 — dec_prognosis present, with a correct (explore-first) and trap option
// ------------------------------------------------------------------
test("Round2-polish-P1: DECISIONS_B includes a dec_prognosis vote", () => {
  assert.match(SRC,
    /id:\s*"dec_prognosis",\s*module:\s*"B"/,
    "DECISIONS_B must contain a dec_prognosis decision in module B");
  // It must sit inside the DECISIONS_B array (between var DECISIONS_B and the
  // SCENARIO 3 banner), not in DECISIONS_C.
  const decBBlock = SRC.slice(
    SRC.indexOf("var DECISIONS_B"),
    SRC.indexOf("SCENARIO 3: Antibiotic Stewardship"));
  assert.ok(decBBlock.includes('id: "dec_prognosis"'),
    "dec_prognosis must live inside the DECISIONS_B array");
});

test("Round2-polish-P1: dec_prognosis has a CORRECT explore-first option and a TRAP that blurts the median", () => {
  // Window the source to the dec_prognosis decision only.
  const start = SRC.indexOf('id: "dec_prognosis"');
  const after = SRC.indexOf('id: "dec_ercp_stent"', start);
  const block = SRC.slice(start, after > -1 ? after : start + 6000);

  // CORRECT option = the SPIKES-Invitation "what kind of answer" move.
  assert.match(block,
    /precise estimate[\s\S]*?rough range[\s\S]*?correct:\s*true/,
    "dec_prognosis correct option must offer to calibrate the answer (precise / range / headline) and be correct:true");

  // TRAP option = directly volunteering "6-11 months", marked correct:false.
  assert.match(block,
    /6-11 months[\s\S]*?correct:\s*false/,
    "dec_prognosis must include a trap option that blurts '6-11 months' and is correct:false");
});

// ------------------------------------------------------------------
// P2 — ECOG in the MDT summary, and a dec_ercp_stent vote in DECISIONS_B
// ------------------------------------------------------------------
test("Round2-polish-P2: Scenario 2 MDT/exam text names an ECOG performance status", () => {
  assert.match(SRC,
    /ECOG performance status\s*1/,
    "the MDT summary must state an ECOG performance status (e.g. ECOG performance status 1)");
});

test("Round2-polish-P2: DECISIONS_B includes a dec_ercp_stent biliary-stent decision", () => {
  assert.match(SRC,
    /id:\s*"dec_ercp_stent",\s*module:\s*"B"/,
    "DECISIONS_B must contain a dec_ercp_stent decision in module B");
  // The decision must contrast 'offer now' vs 'wait for chemo decision'.
  const start = SRC.indexOf('id: "dec_ercp_stent"');
  const block = SRC.slice(start, start + 6000);
  assert.match(block,
    /Offer the stent now[\s\S]*?correct:\s*true/,
    "the correct dec_ercp_stent option must offer the stent now for symptom relief");
  assert.match(block,
    /Wait[\s\S]*?chemotherapy[\s\S]*?correct:\s*false/,
    "dec_ercp_stent must include a 'wait for her chemo decision' trap option");
});

// ------------------------------------------------------------------
// P3 — pre/post banks for scenarios 2 and 3, wired into the registry
// ------------------------------------------------------------------
test("Round2-polish-P3: pre/post MCQ banks are defined for scenarios 2 and 3", () => {
  assert.match(SRC, /var PRETEST_BREAKING_BAD_NEWS\s*=\s*\[/,
    "PRETEST_BREAKING_BAD_NEWS bank must be defined");
  assert.match(SRC, /var POSTTEST_BREAKING_BAD_NEWS\s*=\s*\[/,
    "POSTTEST_BREAKING_BAD_NEWS bank must be defined");
  assert.match(SRC, /var PRETEST_RESPIRATORY_STEWARDSHIP\s*=\s*\[/,
    "PRETEST_RESPIRATORY_STEWARDSHIP bank must be defined");
  assert.match(SRC, /var POSTTEST_RESPIRATORY_STEWARDSHIP\s*=\s*\[/,
    "POSTTEST_RESPIRATORY_STEWARDSHIP bank must be defined");
});

test("Round2-polish-P3: the scenario-2 and scenario-3 banks are wired into the registry", () => {
  // Mirror scenario 1's wiring (preTest: PRETEST_CHRONIC_PAIN, postTest: ...).
  assert.match(SRC,
    /preTest:\s*PRETEST_BREAKING_BAD_NEWS/,
    "breaking-bad-news scenario must wire preTest: PRETEST_BREAKING_BAD_NEWS");
  assert.match(SRC,
    /postTest:\s*POSTTEST_BREAKING_BAD_NEWS/,
    "breaking-bad-news scenario must wire postTest: POSTTEST_BREAKING_BAD_NEWS");
  assert.match(SRC,
    /preTest:\s*PRETEST_RESPIRATORY_STEWARDSHIP/,
    "respiratory-stewardship scenario must wire preTest: PRETEST_RESPIRATORY_STEWARDSHIP");
  assert.match(SRC,
    /postTest:\s*POSTTEST_RESPIRATORY_STEWARDSHIP/,
    "respiratory-stewardship scenario must wire postTest: POSTTEST_RESPIRATORY_STEWARDSHIP");
});

test("Round2-polish-P3: each new bank has 6-10 questions and each carries en/fr/ja + a correct option", () => {
  // Load via VM so we can count questions and check structure precisely.
  const vm = require("node:vm");
  const sandbox = { window: undefined, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const w = sandbox.window;

  const banks = {
    "s2.preTest": w.CANAMED_SCENARIOS["breaking-bad-news-disclosure"].preTest,
    "s2.postTest": w.CANAMED_SCENARIOS["breaking-bad-news-disclosure"].postTest,
    "s3.preTest": w.CANAMED_SCENARIOS["respiratory-stewardship"].preTest,
    "s3.postTest": w.CANAMED_SCENARIOS["respiratory-stewardship"].postTest,
  };

  for (const [name, bank] of Object.entries(banks)) {
    assert.ok(Array.isArray(bank), `${name} must be an array`);
    assert.ok(bank.length >= 6 && bank.length <= 10,
      `${name} should hold 6-10 questions (got ${bank.length})`);
    for (const q of bank) {
      assert.ok(q.q && q.q.en && q.q.fr && q.q.ja,
        `${name} question ${q.id} must have en/fr/ja stems`);
      assert.ok(Array.isArray(q.options) && q.options.length >= 2,
        `${name} question ${q.id} must have >=2 options`);
      assert.ok(q.options.some(o => o.correct === true),
        `${name} question ${q.id} must mark exactly one option correct`);
      for (const o of q.options) {
        assert.ok(o.text && o.text.en && o.text.fr && o.text.ja,
          `${name} question ${q.id} option must carry en/fr/ja`);
      }
      assert.ok(q.explanation && q.explanation.en && q.explanation.fr && q.explanation.ja,
        `${name} question ${q.id} must have an en/fr/ja explanation`);
    }
  }
});

// ------------------------------------------------------------------
// P4 — FACILITATOR_NOTES covers all 3 scenarios in en/fr/ja, exposed on window
// ------------------------------------------------------------------
test("Round2-polish-P4: FACILITATOR_NOTES is defined and exposed on window", () => {
  assert.match(SRC, /var FACILITATOR_NOTES\s*=\s*\{/,
    "FACILITATOR_NOTES object must be defined");
  assert.match(SRC, /window\.FACILITATOR_NOTES\s*=\s*FACILITATOR_NOTES/,
    "FACILITATOR_NOTES must be exposed on window like the other globals");
});

test("Round2-polish-P4: FACILITATOR_NOTES covers all 3 scenario ids in en/fr/ja", () => {
  const vm = require("node:vm");
  const sandbox = { window: undefined, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const fn = sandbox.window.FACILITATOR_NOTES;

  const ids = [
    "chronic-pain-opioids",
    "breaking-bad-news-disclosure",
    "respiratory-stewardship",
  ];
  for (const id of ids) {
    assert.ok(fn[id], `FACILITATOR_NOTES must have an entry for ${id}`);
    assert.ok(fn[id].en && fn[id].en.length > 50, `${id} card must have non-trivial en text`);
    assert.ok(fn[id].fr && fn[id].fr.length > 50, `${id} card must have non-trivial fr text`);
    assert.ok(fn[id].ja && fn[id].ja.length > 50, `${id} card must have non-trivial ja text`);
  }
  // Every scenario in the registry must have a matching facilitator card.
  for (const id of Object.keys(sandbox.window.CANAMED_SCENARIOS)) {
    assert.ok(fn[id], `every registry scenario (${id}) must have a facilitator card`);
  }
});
