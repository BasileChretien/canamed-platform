/* tests/round4-clinical.test.js
 *
 * Lock-in tests for the Round-4 clinical/EBM specialist-agent fixes
 * (see sim-output/round4-clinical.md):
 *
 *   R1  Explicit "name THREE diagnoses" differential prompt is present in
 *       ALL THREE scenarios (chronic-pain CASE, breaking-bad-news CASE_B,
 *       respiratory CASE_C). Round-2 recommended it; it was never shipped.
 *
 *   R2  Cholangitis safety-netting is present in the breaking-bad-news case
 *       (obstructive jaundice + fever/rigors = ascending cholangitis = an
 *       emergency). A genuine safety omission the case previously had.
 *
 *   R3  Chronic-pain synthesis now states an explicit, quantified return-
 *       precautions / safety-net set (cauda-equina + sinister red flags).
 *
 *   R4  The breaking-bad-news PRE-TEST q1 explanation is softened so it no
 *       longer overstates FR/JP autonomy convergence vs the post-test.
 *
 *   R5  Scenario 3 viral-pharyngitis differential now names the 2026 viruses
 *       (SARS-CoV-2 / influenza / RSV) and carries a post-tonsillectomy
 *       McIsaac caveat.
 *
 * Static text assertions only (the file is CRLF; patterns use [\s\S] so they
 * match across line breaks regardless of line-ending style), mirroring the
 * style of tests/round2-clinical.test.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE_CONTENT = fs.readFileSync(
  path.join(PLATFORM, "case-content.js"), "utf8");

// ------------------------------------------------------------------
// R1 — "name THREE diagnoses" differential prompt in all three scenarios
// ------------------------------------------------------------------
test("Round4-R1: a 'name THREE diagnoses' differential prompt exists", () => {
  // Each scenario's English differential prompt opens with the shared
  // "Differential first, plan second" framing and the "name THREE diagnoses"
  // instruction. There must be at least three such prompts in the file
  // (one per scenario: CASE, CASE_B, CASE_C).
  const matches = CASE_CONTENT.match(
    /Differential first, plan second[\s\S]{0,400}?name THREE diagnoses/g);
  assert.ok(matches && matches.length >= 3,
    "expected the 'Differential first, plan second … name THREE diagnoses' " +
    "prompt in all three scenarios; found " +
    (matches ? matches.length : 0));
});

test("Round4-R1: the differential prompt names the discriminating-feature instruction", () => {
  // The prompt trains hypothesis-driven reasoning: each diagnosis must be
  // paired with the single feature that points to it.
  assert.match(CASE_CONTENT,
    /name THREE diagnoses[\s\S]{0,200}?single (history|feature)/,
    "the differential prompt must ask for the single feature that points " +
    "to each diagnosis");
});

// ------------------------------------------------------------------
// R2 — cholangitis safety-netting in the breaking-bad-news case
// ------------------------------------------------------------------
test("Round4-R2: breaking-bad-news case has cholangitis safety-netting", () => {
  // The synthesis must name ascending cholangitis as the emergency that
  // jaundice + fever/rigors signals, and the return-precaution trigger.
  assert.match(CASE_CONTENT,
    /cholangitis precautions[\s\S]{0,200}?fever[\s\S]{0,40}?rigors/,
    "CASE_B synthesis must give cholangitis return-precautions (fever, rigors)");
  assert.match(CASE_CONTENT,
    /ascending cholangitis[\s\S]{0,80}?emergency/,
    "CASE_B synthesis must flag ascending cholangitis as an emergency");
});

// ------------------------------------------------------------------
// R3 — quantified return-precautions in the chronic-pain synthesis
// ------------------------------------------------------------------
test("Round4-R3: chronic-pain synthesis has an explicit quantified safety-net", () => {
  assert.match(CASE_CONTENT,
    /Safety-net explicitly[\s\S]{0,200}?saddle numbness[\s\S]{0,160}?(weight loss|night)/,
    "CASE synthesis must spell out the urgent return red flags " +
    "(leg weakness/numbness, saddle numbness, bladder/bowel, fever, " +
    "weight loss, night/rest pain)");
});

// ------------------------------------------------------------------
// R4 — pre-test q1 FR/JP convergence softened
// ------------------------------------------------------------------
test("Round4-R4: breaking-bad-news pre-test q1 acknowledges FR/JP practice nuance", () => {
  // The softened explanation must concede that in PRACTICE the family's role
  // in disclosure remains more prominent in Japan, while preserving the legal
  // teaching point (it cannot override a competent patient's wish).
  assert.match(CASE_CONTENT,
    /In practice[\s\S]{0,160}?family's role[\s\S]{0,120}?more prominent[\s\S]{0,80}?Japan/,
    "pre-test q1 must acknowledge the family's more-prominent practical role " +
    "in Japan");
  assert.match(CASE_CONTENT,
    /cannot override a competent patient's expressed wish/,
    "pre-test q1 must keep the legal point that practice cannot override a " +
    "competent patient's expressed wish");
});

// ------------------------------------------------------------------
// R5 — 2026 viral differential names + post-tonsillectomy McIsaac caveat
// ------------------------------------------------------------------
test("Round4-R5: respiratory synthesis names the 2026 viruses (covid/RSV/influenza)", () => {
  assert.match(CASE_CONTENT,
    /SARS-CoV-2/,
    "CASE_C synthesis must name SARS-CoV-2 in the 2026 viral differential");
  assert.match(CASE_CONTENT,
    /influenza A\/B/,
    "CASE_C synthesis must name influenza A/B");
  assert.match(CASE_CONTENT,
    /RSV/,
    "CASE_C synthesis must name RSV");
});

test("Round4-R5: respiratory exam carries a post-tonsillectomy McIsaac caveat", () => {
  assert.match(CASE_CONTENT,
    /post-tonsillectomy patient cannot be fully Centor\/McIsaac-scored/,
    "CASE_C McIsaac answer must note a post-tonsillectomy patient cannot be " +
    "fully Centor/McIsaac-scored");
});
