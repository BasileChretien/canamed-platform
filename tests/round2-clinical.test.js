/* tests/round2-clinical.test.js
 *
 * Lock-in tests for the Round-2 clinical/EBM specialist-agent fixes
 * (see sim-output/round2-clinical-ebm.md):
 *
 *   C1  Scenario 1 (Lefebvre / chronic-pain) has an inflammatory-back-pain
 *       (axSpA) screen item. Previously the synthesis claimed axSpA was
 *       "ruled out" without ever doing the screen.
 *
 *   C2  PENALTIES indices for the deliberately-wrong history items shifted
 *       from 8/9 → 9/10 to follow the new axSpA insertion.
 *
 *   C3  Header citation now lists HAS 2024 (opioids) + NICE NG65 (axSpA) +
 *       MHLW AMR Plan (pharyngitis) — the previous "HAS 2019" alone
 *       conflated two different HAS documents.
 *
 *   C4  Scenario 3 (Moreau / pharyngitis) amoxicillin penalty now flags
 *       the EBV / infectious-mononucleosis + aminopenicillin rash trap.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE_CONTENT = fs.readFileSync(
  path.join(PLATFORM, "case-content.js"), "utf8");

// ------------------------------------------------------------------
// C1 — axSpA screen present
// ------------------------------------------------------------------
test("Round2-C1: Scenario 1 includes an axSpA / inflammatory-back-pain screen", () => {
  // English wording must mention the discriminating IBP features.
  assert.match(CASE_CONTENT,
    /Inflammatory back-pain screen.*morning back stiffness.*alternating buttock pain/s,
    "Scenario 1 history must include an explicit IBP screen with the IBP features");
  // The cite line must reference ASAS or NG65 (the axSpA criteria sources).
  assert.match(CASE_CONTENT,
    /ASAS \/ NICE NG65/,
    "axSpA screen must cite ASAS / NICE NG65");
});

// ------------------------------------------------------------------
// C2 — PENALTIES indices shifted (8/9 → 9/10)
// ------------------------------------------------------------------
test("Round2-C2: pen_prescribe references history:9 (not history:8) after axSpA insert", () => {
  assert.match(CASE_CONTENT,
    /id:\s*"pen_prescribe",\s*item:\s*"history:9"/,
    "pen_prescribe must now reference history:9 (the deliberately-wrong " +
    "'promise oxycodone' item shifted +1 by the axSpA insert)");
  // Must NOT still reference history:8 for the prescribe penalty.
  assert.doesNotMatch(CASE_CONTENT,
    /id:\s*"pen_prescribe",\s*item:\s*"history:8"/,
    "pen_prescribe must no longer reference the stale history:8 index");
});
test("Round2-C2: pen_dismiss references history:10 (not history:9) after axSpA insert", () => {
  assert.match(CASE_CONTENT,
    /id:\s*"pen_dismiss",\s*item:\s*"history:10"/,
    "pen_dismiss must now reference history:10");
  assert.doesNotMatch(CASE_CONTENT,
    /id:\s*"pen_dismiss",\s*item:\s*"history:9"/,
    "pen_dismiss must no longer reference the stale history:9 index");
});

// ------------------------------------------------------------------
// C3 — header citation refresh
// ------------------------------------------------------------------
test("Round2-C3: file header lists HAS 2024 (opioids) + NICE NG65 (axSpA)", () => {
  assert.match(CASE_CONTENT,
    /HAS 2024[\s\S]{0,200}?opioïdes/,
    "header must cite HAS 2024 for the opioid recommendation (not HAS 2019)");
  assert.match(CASE_CONTENT,
    /NICE NG65/,
    "header must cite NICE NG65 (axial spondyloarthritis)");
  assert.match(CASE_CONTENT,
    /MHLW AMR[\s\S]{0,40}?Action Plan 2023[\s\S]{0,5}2027/,
    "header must cite the MHLW AMR Action Plan 2023-2027 for pharyngitis");
});

// ------------------------------------------------------------------
// C4 — EBV/amoxicillin trap surfaced in Scenario 3 penalty
// ------------------------------------------------------------------
test("Round2-C4: Scenario 3 amoxicillin penalty flags the EBV/aminopenicillin rash trap", () => {
  // The penalty `why` must mention EBV / mononucleosis + the maculopapular
  // rash + the false penicillin-allergy label.
  assert.match(CASE_CONTENT,
    /pen_amox[\s\S]*?EBV[\s\S]*?mononucleosis/,
    "pen_amox penalty must mention EBV / mononucleosis");
  assert.match(CASE_CONTENT,
    /pen_amox[\s\S]*?maculopapular rash/,
    "pen_amox penalty must describe the maculopapular rash mechanism");
  assert.match(CASE_CONTENT,
    /pen_amox[\s\S]*?penicillin allergy/,
    "pen_amox penalty must warn about the durable false-allergy label");
});
