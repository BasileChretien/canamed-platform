/* tests/modA-vote-prompt.test.js
 *
 * 2026-06-02: the dec_plan vote prompt used to presume the diagnosis ("Your team
 * agrees this is non-specific low-back pain…"), which over-states certainty. It
 * was reworded (EN/FR/JA) to ask about the initial management plan without
 * asserting the diagnosis. Static content guard on case-content.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const CASE_SRC = fs.readFileSync(path.join(PLATFORM, "case-content.js"), "utf8");

test("the dec_plan vote no longer presumes the diagnosis (EN/FR)", () => {
  assert.doesNotMatch(CASE_SRC, /agrees this is non-specific/i,
    "EN prompt must not presume 'your team agrees this is…'");
  assert.doesNotMatch(CASE_SRC, /convient qu'il s'agit d'une lombalgie/i,
    "FR prompt must not presume the diagnosis");
});

test("the reworded dec_plan prompt is present in all three languages", () => {
  assert.match(CASE_SRC, /core of this patient's initial\s*"?\s*\+?\s*"?\s*management plan\?/i,
    "EN prompt asks for the core of the initial management plan");
  assert.match(CASE_SRC, /cœur du plan de prise en charge initial/i,
    "FR prompt asks for the core of the initial management plan");
  assert.match(CASE_SRC, /この患者の初期治療計画/,
    "JA prompt asks for the core of the initial management plan");
});
