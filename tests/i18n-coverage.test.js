/* tests/i18n-coverage.test.js
 *
 * Unit tests for scripts/i18n-coverage-report.js — the per-language
 * coverage linter for case-content.js. Tests drive the pure helpers
 * directly (faster + greppable error messages than spawning a child
 * process to parse stdout).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const cov = require("../scripts/i18n-coverage-report.js");

test("i18n-coverage: isTranslatable detects { en, fr, ja } triplets", () => {
  assert.equal(cov.isTranslatable({ en: "Hello", fr: "Bonjour", ja: "こんにちは" }), true);
  assert.equal(cov.isTranslatable({ en: "Hello", fr: "", ja: "" }), true);
  assert.equal(cov.isTranslatable({ en: "Hello", de: "Hallo" }), true);
  // mixed shape — has a non-string non-null value, NOT a triplet
  assert.equal(cov.isTranslatable({ en: "Hello", meta: { reviewed: true } }), false);
  // contains a key outside the SUPPORTED set — treat as container
  assert.equal(cov.isTranslatable({ en: "Hello", q: "x" }), false);
  // empty object / arrays / primitives — not triplets
  assert.equal(cov.isTranslatable({}), false);
  assert.equal(cov.isTranslatable([]), false);
  assert.equal(cov.isTranslatable(null), false);
  assert.equal(cov.isTranslatable("plain string"), false);
});

test("i18n-coverage: walk() counts triplets + per-language non-empty values", () => {
  const SCENARIO = {
    name: { en: "Hi", fr: "Salut", ja: "こんにちは" },
    summary: { en: "Long EN", fr: "", ja: "Long JA" },
    case: {
      history: [
        { q: { en: "Q1", fr: "Q1-fr", ja: "Q1-ja" },
          a: { en: "A1", fr: "A1-fr", ja: "" } }
      ]
    }
  };
  const stats = cov.freshStats();
  cov.walk(SCENARIO, cov.SUPPORTED, stats);
  // 4 triplets: name, summary, history[0].q, history[0].a
  assert.equal(stats.total, 4);
  assert.equal(stats.byLang.en, 4);  // every triplet has a non-empty en
  assert.equal(stats.byLang.fr, 3);  // summary.fr is "" — not counted
  assert.equal(stats.byLang.ja, 3);  // history[0].a.ja is "" — not counted
  assert.equal(stats.byLang.de, 0);  // no German anywhere
});

test("i18n-coverage: coveragePercent rounds to one decimal place", () => {
  assert.equal(cov.coveragePercent(0, 0), 0);
  assert.equal(cov.coveragePercent(1, 4), 25);
  assert.equal(cov.coveragePercent(1, 3), 33.3);
  assert.equal(cov.coveragePercent(3, 3), 100);
  assert.equal(cov.coveragePercent(0, 100), 0);
});

test("i18n-coverage: loadScenarios reads the real case-content.js", () => {
  // Acceptance: the script can load the real file (this is the contract
  // the CLI relies on). We expect chronic-pain-opioids to be present
  // with EN coverage 100% — it's the canonical translated scenario.
  const file = path.join(__dirname, "..", "docs", "Third_session",
                         "PBL_platform", "case-content.js");
  const SCENARIOS = cov.loadScenarios(file);
  assert.ok(typeof SCENARIOS === "object" && SCENARIOS !== null);
  assert.ok("chronic-pain-opioids" in SCENARIOS,
            "the canonical scenario id must be present");
  // walk it and check structural sanity (don't pin exact numbers — they
  // change as scenarios are edited).
  const stats = cov.freshStats();
  cov.walk(SCENARIOS["chronic-pain-opioids"], cov.SUPPORTED, stats);
  assert.ok(stats.total > 50,
            "chronic-pain scenario should have a substantive number of triplets, got " + stats.total);
  assert.equal(stats.byLang.en, stats.total,
               "EN must be the canonical fully-covered language");
});

test("i18n-coverage: walk does NOT recurse into a triplet's string values", () => {
  // If walk recursed into the strings, every character would become a
  // candidate sub-node — we'd count nothing extra, but a future bug
  // (e.g. wrapping a string in { en: { en: "Hi" } }) would silently
  // collapse counts. Pin the "no double-walk" behaviour explicitly.
  const node = { en: "Hello", fr: "Bonjour" };
  const stats = cov.freshStats();
  cov.walk(node, cov.SUPPORTED, stats);
  assert.equal(stats.total, 1, "exactly one triplet, no double-walk into the strings");
});
