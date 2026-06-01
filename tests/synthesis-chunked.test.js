/* tests/synthesis-chunked.test.js
 *
 * Regression guard for the UX-overload fix (2026-06-01) that segments the
 * Module A clinical-synthesis reveal. The synthesis answer used to be one
 * ~160-word paragraph (a wall for a B1/A2 FR/JP cohort). It now also carries
 * `aParts` — the SAME clinical content split into labelled micro-sections —
 * which the inline-reveal renders one idea at a time.
 *
 * These tests pin:
 *   1. structure: labs[0] keeps key:true + a, and gains a 5-part aParts with
 *      non-empty en/fr/ja label + body on every part;
 *   2. CONTENT PRESERVATION: every key clinical token in the flat `a` still
 *      appears across the chunked parts (nothing dropped in the split);
 *   3. render contract: script.js special-cases SYNTH_ID with aParts but
 *      keeps the flat .req-inline-answer fallback;
 *   4. CSS for the chunk labels exists.
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
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");

const synth = SCENARIOS["chronic-pain-opioids"].case.labs[0];

test("the synthesis item still gates (key:true) and keeps its flat `a` fallback", () => {
  assert.strictEqual(synth.key, true, "labs[0] must remain the key synthesis item");
  assert.ok(synth.a && typeof synth.a.en === "string" && synth.a.en.length > 100,
    "the flat `a` answer must remain (toast / export / fallback text)");
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

test("renderButtons special-cases the synthesis with aParts but keeps the flat fallback", () => {
  assert.match(SCRIPT, /id === SYNTH_ID && item && Array\.isArray\(item\.aParts\)/,
    "the inline-reveal must render aParts only for the synthesis item");
  assert.match(SCRIPT, /synth-chunk-label/, "the chunk label node must be created");
  assert.match(SCRIPT, /tc\(part\.label, lang\)/, "chunk labels must be localised via tc()");
  // the flat fallback (required by user-feedback-2 + non-synth reveals) stays
  assert.match(SCRIPT, /tc\(item\.a,\s*lang\)/, "the flat answer fallback must remain");
  assert.match(SCRIPT, /className\s*=\s*"req-inline-answer"/, "the flat answer span must remain");
});

test("the chunked-synthesis CSS exists", () => {
  assert.match(CSS, /\.synth-chunk-label\s*\{/, "missing .synth-chunk-label style");
  assert.match(CSS, /\.synth-chunks\s*\{/, "missing .synth-chunks layout");
});
