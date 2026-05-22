/* tests/inclusion-language-hint.test.js
 *
 * Lock-in for the inclusion language aids (2026-05-21): non-native-English
 * students should be reassured they're assessed on clinical reasoning, not
 * English, at every point they contribute free text. The shared
 * `room.answer-input-language-hint` now carries that reassurance and is
 * shown on the working-hypotheses input and the side-chat (not just the two
 * group-answer cards).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const I18N  = require("./_i18n_source.js").readI18nSource();

test("the language hint reassures students they're not marked on English (en/fr/ja)", () => {
  // en + fr + ja must all carry the no-language-penalty message.
  assert.match(I18N, /"room\.answer-input-language-hint":\s*"[^"]*not marked on your English[^"]*"/,
    "EN hint must say students are not marked on their English");
  assert.match(I18N, /"room\.answer-input-language-hint":\s*"[^"]*pas évalué[^"]*anglais[^"]*"/,
    "FR hint must carry the no-language-penalty reassurance");
  assert.match(I18N, /"room\.answer-input-language-hint":\s*"[^"]*英語[^"]*評価[^"]*"/,
    "JA hint must carry the no-language-penalty reassurance");
});

test("the language hint is shown on every free-text contribution point", () => {
  // Count usages of the shared hint class: 2 group-answer cards (modA/modB)
  // + the working-hypotheses input + the side-chat = at least 4.
  const n = INDEX.split("answer-input-language-hint").length - 1;
  assert.ok(n >= 4,
    "expected the language hint on >= 4 contribution points (group answers A+B, hypotheses, side-chat); got " + n);
});

test("the hint sits with the working-hypotheses input and the side-chat", () => {
  // hypotheses: hint appears right after the hypothesis-add block.
  assert.match(INDEX, /hypothesis-add-btn[\s\S]{0,400}?answer-input-language-hint/,
    "the language hint must accompany the working-hypotheses input");
  // side-chat: hint appears near the chat-list / chat-input.
  assert.match(INDEX, /Private side-chat[\s\S]{0,400}?answer-input-language-hint/,
    "the language hint must accompany the side-chat");
});
