/* tests/synthesis-chunked.test.js
 *
 * The Module A clinical synthesis carries `aParts` — the model write-up split
 * into 5 labelled micro-sections (what you found / diagnosis / yellow flags /
 * safety-net / decide together). The on-screen synthesis reveal was REMOVED
 * 2026-06-02; that structured write-up now ships only in the stage-4 take-home
 * export (downloadMyRoomAnswers), so these tests pin:
 *   1. structure: labs[0] keeps key:true + a, and a 5-part aParts with
 *      non-empty en/fr/ja label + body on every part;
 *   2. CONTENT PRESERVATION: every key clinical token in the flat `a` still
 *      appears across the chunked parts (nothing dropped in the split);
 *   3. export contract: downloadMyRoomAnswers renders the aParts (labelled +
 *      localised) and keeps the flat `a` fallback.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cov = require("../scripts/i18n-coverage-report.js");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCENARIOS = cov.loadScenarios(path.join(PLATFORM, "case-content.js"));
const SCRIPT = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

const synth = SCENARIOS["chronic-pain-opioids"].case.labs[0];

test("the synthesis item still exists (key:true) and keeps its flat `a` write-up", () => {
  assert.strictEqual(synth.key, true, "labs[0] must remain the key synthesis item");
  assert.ok(synth.a && typeof synth.a.en === "string" && synth.a.en.length > 100,
    "the flat `a` answer must remain (export fallback text)");
});

test("aParts is a 5-section list with non-empty en/fr/ja label + body", () => {
  assert.ok(Array.isArray(synth.aParts), "labs[0].aParts must be an array");
  assert.strictEqual(synth.aParts.length, 5, "expected 5 labelled synthesis sections");
  for (const [i, part] of synth.aParts.entries()) {
    for (const field of ["label", "body"]) {
      assert.ok(part[field], `aParts[${i}].${field} missing`);
      for (const lang of ["en", "fr", "ja"]) {
        assert.ok(typeof part[field][lang] === "string" && part[field][lang].trim().length > 0,
          `aParts[${i}].${field}.${lang} must be a non-empty string (i18n parity)`);
      }
    }
  }
});

test("CONTENT PRESERVATION: every key clinical token from `a` survives in the chunks (EN)", () => {
  const joined = synth.aParts.map((p) => p.label.en + " " + p.body.en).join("  ");
  const mustKeep = [
    "cauda equina", "malignancy", "infection", "fracture",
    "axial spondyloarthritis", "radicular", "non-specific",
    "Fear of movement", "saddle", "bladder", "weight loss",
    "MRI", "oxycodone",
  ];
  const dropped = mustKeep.filter((t) => !joined.includes(t));
  assert.deepStrictEqual(dropped, [],
    "these clinical tokens from the flat `a` were dropped in the chunked split: " + dropped.join(", "));
});

test("CONTENT PRESERVATION: the must-not-miss safety-net + decisions survive (FR + JA)", () => {
  const fr = synth.aParts.map((p) => p.label.fr + " " + p.body.fr).join("  ");
  const ja = synth.aParts.map((p) => p.label.ja + " " + p.body.ja).join("  ");
  for (const t of ["queue de cheval", "IRM", "oxycodone"]) {
    assert.ok(fr.includes(t), "FR chunks must still contain: " + t);
  }
  for (const t of ["馬尾", "MRI", "オキシコドン"]) {
    assert.ok(ja.includes(t), "JA chunks must still contain: " + t);
  }
});

test("the stage-4 take-home export renders the synthesis aParts (labelled + localised)", () => {
  const start = SCRIPT.indexOf("function downloadMyRoomAnswers(");
  const dl = SCRIPT.slice(start, start + 4000);
  assert.match(dl, /itemById\(SYNTH_ID\)/, "the export pulls the SYNTH_ID case item");
  assert.match(dl, /synItem\.aParts/, "the export iterates the labelled aParts");
  assert.match(dl, /tc\(part\.label, lang\)/, "aParts labels localised via tc()");
  assert.match(dl, /tc\(part\.body, lang\)/, "aParts bodies localised via tc()");
  assert.match(dl, /tc\(synItem\.a, lang\)/, "the flat `a` fallback is kept when aParts is absent");
});
