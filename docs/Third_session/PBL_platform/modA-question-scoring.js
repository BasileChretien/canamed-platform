/* modA-question-scoring.js
 *
 * Score a free-text question typed by a student in the Module A LLM-patient
 * chat (introduced 2026-05-28). The award/penalty families live in
 * case-content.js (`SCORING.moduleA_questions` and
 * `SCORING.moduleA_question_penalties`) so that medical educators can edit
 * keywords without touching this file.
 *
 * Pure, side-effect-free. No DOM, no Firebase. The bridge
 * (modA-llm-bridge.js) handles persistence and reveal()s.
 *
 * Loaded BEFORE script.js (same <script> order as case-content.js); in Node
 * (unit tests) require()'d via the window shim below.
 */

if (typeof window === "undefined") { var window = globalThis; }

(function (W) {
  "use strict";

  function _norm(s) {
    // Case-folding is enough — JP/CJK stems are unaffected and FR diacritics
    // are kept verbatim in both the input and the stem list. We deliberately
    // do NOT strip diacritics here: "fièvre" ≠ "fievre" pedagogically — a
    // student who can't spell the symptom they're asking about probably
    // didn't ask it well enough to score. (Mirror of the script.js
    // `familyHits` behaviour at line 446.)
    return (s == null ? "" : String(s)).toLowerCase();
  }

  function _hits(family, lowered) {
    var stems = family && family.any;
    if (!stems || !stems.length) return false;
    for (var i = 0; i < stems.length; i++) {
      var stem = String(stems[i]).toLowerCase();
      if (stem && lowered.indexOf(stem) >= 0) return true;
    }
    return false;
  }

  /* scoreQuestion(text, awardedMap, characterId?)
   *   text        - the student's typed question (any language)
   *   awardedMap  - { [familyId]: truthy } of families already counted in this
   *                 room. Pass `{}` if you don't dedupe (rare — see below).
   *   characterId - who the question was addressed TO (the switchboard's
   *                 active character). Omitted/null means the index patient.
   *
   * `askOf` (scenario-characters design, decision 4): a family may declare
   * `askOf: "mother"` (or an array of ids) and then only scores when the
   * question was put to one of THOSE characters — a family history taken from
   * the mother earns the points; the same words typed at the patient do not.
   * A family with no `askOf` scores whoever it was asked of, so every
   * pre-switchboard family behaves exactly as before.
   *
   * Returns { award, penalty, unlocks } — each an array of ids the caller
   * should now persist + apply. Empty arrays when nothing matched (or when
   * SCORING isn't loaded yet, which happens in some Node test paths).
   *
   * Once-only semantics: a family present in `awardedMap` is silently
   * skipped. This is intentional — repeating "any fever?" three times must
   * not stack 24 points. The bridge persists the awarded map at
   * `…/modA/scoring/awarded/<familyId>` so all team members share it.
   */
  /* The id a question with NO addressee was put to: the scenario's index
     patient. Read lazily from the prompt builder (it loads AFTER this file),
     so a scenario whose patient is not literally `id:"patient"` still
     resolves; "patient" is only the fallback when no cast is declared. */
  function _defaultCharacterId() {
    try {
      var PR = W.modALLMPrompts;
      if (PR && typeof PR.defaultCharacterId === "function") return String(PR.defaultCharacterId() || "patient");
    } catch (_) { /* prompts not loaded */ }
    return "patient";
  }

  function _askOfMatches(family, characterId) {
    var spec = family && family.askOf;
    if (spec == null || spec === "") return true;          // no restriction
    var list = Array.isArray(spec) ? spec : [spec];
    if (!list.length) return true;                          // askOf: [] — an authoring slip, not "nobody"
    var who = (characterId == null || characterId === "") ? _defaultCharacterId() : String(characterId);
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]) === who) return true;
    }
    return false;
  }

  function scoreQuestion(text, awardedMap, characterId) {
    var out = { award: [], penalty: [], unlocks: [] };
    var SC = W.SCORING;
    if (!SC) return out;

    var lowered = _norm(text);
    if (!lowered.length) return out;
    var awarded = awardedMap || {};

    var awardFams = SC.moduleA_questions || [];
    for (var i = 0; i < awardFams.length; i++) {
      var fam = awardFams[i];
      if (!fam || !fam.id || awarded[fam.id]) continue;
      if (!_askOfMatches(fam, characterId)) continue;
      if (_hits(fam, lowered)) {
        out.award.push(fam.id);
        if (fam.unlocks) out.unlocks.push(fam.unlocks);
      }
    }

    var penFams = SC.moduleA_question_penalties || [];
    for (var j = 0; j < penFams.length; j++) {
      var pen = penFams[j];
      if (!pen || !pen.id || awarded[pen.id]) continue;
      if (!_askOfMatches(pen, characterId)) continue;
      if (_hits(pen, lowered)) out.penalty.push(pen.id);
    }

    return out;
  }

  /* familyById(id) — small lookup helper for the UI ("you scored 8 for
   * <label>"). Returns the family object (award or penalty) or null. */
  function familyById(id) {
    var SC = W.SCORING;
    if (!SC || !id) return null;
    var lists = [SC.moduleA_questions || [], SC.moduleA_question_penalties || []];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        if (lists[i][j] && lists[i][j].id === id) return lists[i][j];
      }
    }
    return null;
  }

  W.modAQuestionScoring = {
    scoreQuestion: scoreQuestion,
    familyById: familyById,
    askOfMatches: _askOfMatches
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = W.modAQuestionScoring;
  }
})(typeof window !== "undefined" ? window : globalThis);
