/* tests/reader-core.test.js — unit tests for the DOM-free reading-aid core.
 *
 * Runs under `node --test`. Covers word extraction at a caret offset, the
 * substring-overlap glossary lookup (incl. multi-word phrases + longest-match),
 * and target-language selection with English fallback. Also sanity-checks
 * against the REAL glossary.js so the EN/FR/JA shape stays in lockstep with
 * the lookup contract.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../docs/Third_session/PBL_platform/reader-core.js");
const GLOSSARY = require("../docs/Third_session/PBL_platform/glossary.js");

test("normalizeWord strips surrounding punctuation, keeps internal marks", () => {
  assert.equal(core.normalizeWord("  Opioids."), "opioids");
  assert.equal(core.normalizeWord("(red-flag)"), "red-flag");
  assert.equal(core.normalizeWord("patient's"), "patient's");
  assert.equal(core.normalizeWord("…"), "");
  assert.equal(core.normalizeWord(null), "");
});

test("extractWordAt returns the word under the caret", () => {
  const s = "Consider an opioid taper now.";
  // offset 14 is inside "opioid" (C-o-n-s... "opioid" starts at 12)
  const w = core.extractWordAt(s, 14);
  assert.equal(w.raw, "opioid");
  assert.equal(s.slice(w.start, w.end), "opioid");
});

test("extractWordAt resolves the word at its leading edge", () => {
  const s = "red flag";
  const w = core.extractWordAt(s, 0);
  assert.equal(w.raw, "red");
});

test("extractWordAt resolves a caret sitting just AFTER a word", () => {
  const s = "opioid taper";
  // offset 6 is the space right after "opioid"
  const w = core.extractWordAt(s, 6);
  assert.equal(w.raw, "opioid");
});

test("extractWordAt returns null on whitespace/punctuation", () => {
  assert.equal(core.extractWordAt("a   b", 2), null); // middle of spaces
  assert.equal(core.extractWordAt("...", 1), null);
  assert.equal(core.extractWordAt("", 0), null);
});

test("extractWordAt clamps out-of-range offsets", () => {
  const s = "neuropathic";
  assert.equal(core.extractWordAt(s, 999).raw, "neuropathic");
  assert.equal(core.extractWordAt(s, -5).raw, "neuropathic");
});

const FAKE = {
  "opioid": { en: "morphine-family pain medication", fr: "antalgique morphinique", ja: "モルヒネ系鎮痛薬" },
  "red flag": { en: "serious warning sign", fr: "signal d'alarme", ja: "レッドフラッグ" },
  "flag": { en: "a flag (generic)", fr: "drapeau" },
  "metasta": { en: "cancer spread", fr: "métastase", ja: "転移" },
  "resistance": { en: "generic resistance" },
  "antimicrobial resistance": { en: "AMR — bacteria surviving antibiotics", fr: "résistance aux antimicrobiens" }
};

test("glossAt matches an inflected word via substring (opioids -> opioid)", () => {
  const s = "Stop the opioids today";
  const hit = core.glossAt(s, 11, FAKE, "fr"); // inside "opioids"
  assert.equal(hit.term, "opioid");
  assert.equal(hit.text, "antalgique morphinique");
  assert.equal(hit.en, "morphine-family pain medication");
});

test("glossAt matches mid-word substrings (metastatic -> metasta)", () => {
  const s = "widely metastatic disease";
  const hit = core.glossAt(s, 10, FAKE, "ja");
  assert.equal(hit.term, "metasta");
  assert.equal(hit.text, "転移");
});

test("glossAt prefers the LONGEST overlapping term (phrase beats word)", () => {
  const s = "any red flag means stop";
  const onRed = core.glossAt(s, 4, FAKE, "fr");   // hovering "red"
  assert.equal(onRed.term, "red flag");
  const onFlag = core.glossAt(s, 8, FAKE, "fr");  // hovering "flag" within the phrase
  assert.equal(onFlag.term, "red flag");
});

test("glossAt prefers the longer phrase 'antimicrobial resistance' over 'resistance'", () => {
  const s = "antimicrobial resistance is a population harm";
  const hit = core.glossAt(s, 16, FAKE, "fr"); // hovering "resistance"
  assert.equal(hit.term, "antimicrobial resistance");
  assert.equal(hit.text, "résistance aux antimicrobiens");
});

test("glossAt falls back to English when the target gloss is missing", () => {
  const s = "the resistance gene";
  const hit = core.glossAt(s, 6, FAKE, "ja"); // only 'resistance' covers it; no ja
  assert.equal(hit.term, "resistance");
  assert.equal(hit.text, "generic resistance");
});

test("glossAt returns null when the cursor is off any glossed term", () => {
  const s = "the cat sat";
  assert.equal(core.glossAt(s, 5, FAKE, "fr"), null);
  assert.equal(core.glossAt(s, 3, FAKE, "fr"), null); // on a space
});

test("glossAt works against the real glossary.js (EN + FR + JA present)", () => {
  // 'oxycodone' is a known Module A term; hovering it should resolve and carry
  // all three languages now that French has been added.
  const s = "prescribe oxycodone with caution";
  const hit = core.glossAt(s, 12, GLOSSARY, "fr");
  assert.equal(hit.term, "oxycodone");
  assert.ok(hit.text && hit.text.length > 0, "French gloss present");
  assert.notEqual(hit.text, hit.en, "French differs from English");
  const ja = core.glossAt(s, 12, GLOSSARY, "ja");
  assert.ok(ja.text && ja.text.length > 0, "Japanese gloss present");
});

test("every real glossary entry has en, fr and ja glosses", () => {
  for (const [term, entry] of Object.entries(GLOSSARY)) {
    assert.ok(entry.en, `${term} missing en`);
    assert.ok(entry.fr, `${term} missing fr`);
    assert.ok(entry.ja, `${term} missing ja`);
  }
});

// ── Phase 2: English deinflector + dictionary fallback ──────────────────────

test("englishDeinflect always offers the word itself first", () => {
  assert.equal(core.englishDeinflect("walk")[0], "walk");
  assert.equal(core.englishDeinflect("Running")[0], "running"); // normalised
});

test("englishDeinflect handles regular plurals", () => {
  assert.ok(core.englishDeinflect("cats").includes("cat"));
  assert.ok(core.englishDeinflect("boxes").includes("box"));
  assert.ok(core.englishDeinflect("studies").includes("study"));
  assert.ok(core.englishDeinflect("knives").includes("knife"));
});

test("englishDeinflect handles verb -ing / -ed with de-doubling and silent-e", () => {
  assert.ok(core.englishDeinflect("running").includes("run"));
  assert.ok(core.englishDeinflect("making").includes("make"));
  assert.ok(core.englishDeinflect("walking").includes("walk"));
  assert.ok(core.englishDeinflect("stopped").includes("stop"));
  assert.ok(core.englishDeinflect("used").includes("use"));
  assert.ok(core.englishDeinflect("tried").includes("try"));
});

test("englishDeinflect handles comparatives / superlatives / adverbs", () => {
  assert.ok(core.englishDeinflect("bigger").includes("big"));
  assert.ok(core.englishDeinflect("happier").includes("happy"));
  assert.ok(core.englishDeinflect("largest").includes("large"));
  assert.ok(core.englishDeinflect("quickly").includes("quick"));
});

test("englishDeinflect handles irregulars", () => {
  assert.ok(core.englishDeinflect("mice").includes("mouse"));
  assert.ok(core.englishDeinflect("children").includes("child"));
  assert.ok(core.englishDeinflect("went").includes("go"));
  assert.ok(core.englishDeinflect("better").includes("good"));
});

test("dictAt resolves an inflected hovered word against a Map", () => {
  const dict = new Map([
    ["run", "courir"],
    ["study", "étudier"],
    ["reluctant", "réticent"]
  ]);
  const s = "they were running fast";
  const hit = core.dictAt(s, 11, dict); // inside "running"
  assert.equal(hit.term, "running");
  assert.equal(hit.text, "courir");
  assert.equal(s.slice(hit.start, hit.end), "running");

  const s2 = "a reluctant witness";
  assert.equal(core.dictAt(s2, 4, dict).text, "réticent");
  // a word not in the dict → null
  assert.equal(core.dictAt("the cat sat", 4, dict), null);
  // off a word → null
  assert.equal(core.dictAt("a b", 1, dict), null);
});
