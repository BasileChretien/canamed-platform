/* tests/glossary.test.js
 *
 * Lock-in for the glossary expansion (2026-05-20). The glossary was a
 * 16-entry token set scanning only Module A button labels. It now covers
 * all three scenarios (chronic pain, breaking bad news, respiratory
 * stewardship) so the A2/B1 cohort gets in-context plain-English +
 * Japanese glosses across the whole session.
 *
 * Every entry must carry both `en` and `ja` (the tooltip renders
 * "en / ja"); the dataset must cover the key terms of each scenario.
 */

const test = require("node:test");
const assert = require("node:assert");

const GLOSSARY = require("../docs/Third_session/PBL_platform/glossary.js");

test("glossary: every entry has non-empty en + ja glosses", () => {
  const keys = Object.keys(GLOSSARY);
  assert.ok(keys.length >= 45, "expected a substantially expanded glossary; got " + keys.length);
  for (const k of keys) {
    assert.ok(GLOSSARY[k] && typeof GLOSSARY[k].en === "string" && GLOSSARY[k].en.length > 0,
      "entry '" + k + "' must have an en gloss");
    assert.ok(typeof GLOSSARY[k].ja === "string" && GLOSSARY[k].ja.length > 0,
      "entry '" + k + "' must have a ja gloss");
  }
});

test("glossary: keys are lowercase (substring match is case-insensitive on lowered text)", () => {
  for (const k of Object.keys(GLOSSARY)) {
    assert.strictEqual(k, k.toLowerCase(), "glossary key '" + k + "' must be lowercase");
  }
});

test("glossary: covers all three scenarios", () => {
  const keys = Object.keys(GLOSSARY);
  // Module A — chronic pain
  for (const t of ["opioid", "cauda equina", "spondyloarthritis", "yellow flag"]) {
    assert.ok(keys.includes(t), "Module A term missing: " + t);
  }
  // Module B — breaking bad news
  for (const t of ["spikes", "capacity", "prognosis", "courvoisier"]) {
    assert.ok(keys.includes(t), "Module B term missing: " + t);
  }
  // Module C — respiratory stewardship
  for (const t of ["centor", "amoxicillin", "stewardship", "mononucleosis"]) {
    assert.ok(keys.includes(t), "Module C term missing: " + t);
  }
});
