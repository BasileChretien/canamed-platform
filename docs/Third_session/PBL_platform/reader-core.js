/* reader-core.js — pure, DOM-free core for the in-page reading aid.
 *
 * The platform's content is canonical English (medical-English immersion is a
 * feature). For the Caen (FR) / Nagoya (JP) cohorts whose English is still
 * developing, the reading aid lets a student hover (desktop) or tap (touch)
 * ANY word and see a short gloss in their own language — entirely client-side,
 * à la Rikaikun/Yomitan, so no text ever leaves the device (no MT API, no new
 * GDPR/APPI sub-processor, safe even over student-typed text and the patient
 * chat).
 *
 * This file is the brain: given a string + a caret offset, find the word under
 * the cursor and match it against the curated clinical glossary (glossary.js).
 * It is deliberately DOM-free so it unit-tests under `node --test`
 * (tests/reader-core.test.js). The DOM glue — pointer events, caret hit-test,
 * popover — lives in lang-reader.js.
 *
 * Matching strategy (Phase 1, glossary only):
 *   The glossary keys are SUBSTRINGS by design (e.g. "metasta" matches
 *   "metastatic"/"metastasis"; "opioid" matches "opioids"; "red flag" is a
 *   multi-word phrase). So instead of word-by-word lemmatising, we scan the
 *   glossary terms as substrings of the hovered text and keep the LONGEST term
 *   whose match span overlaps the hovered word. That mirrors the existing
 *   _annotateButtonWithGlossary behaviour and needs no English deinflector.
 *   (A bundled general EN->FR/JA dictionary + a deinflector arrive in Phase 2;
 *   those keys ARE exact lemmas and will use englishDeinflect — not built yet,
 *   to avoid shipping untested-against-real-use code now.)
 */
(function (root, factory) {
  const exp = factory();
  if (typeof window !== "undefined") root.CanamedReaderCore = exp;
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // A "word" character: ASCII letters/digits plus internal hyphen and
  // apostrophe. The source corpus is English, so we stay ASCII-pragmatic rather
  // than reaching for full Unicode \p{L}. The class spans straight (U+0027) and
  // typographic (U+2019) apostrophes plus a trailing ASCII hyphen — keep those
  // literal characters intact if an editor offers to "smarten" quotes.
  function isWordChar(ch) {
    return ch != null && /[A-Za-z0-9'’-]/.test(ch);
  }

  /* Normalise a raw token to a lowercase lookup key: lowercase, drop any
   * leading/trailing punctuation, keep internal hyphen/apostrophe.
   *   "  Opioids."  -> "opioids"
   *   "(red-flag)"  -> "red-flag"
   * Returns "" when there is no alphanumeric content. */
  function normalizeWord(raw) {
    if (raw == null) return "";
    const m = String(raw)
      .toLowerCase()
      .match(/[a-z0-9](?:[a-z0-9'’-]*[a-z0-9])?/);
    return m ? m[0] : "";
  }

  /* Find the word that the caret offset sits on (or immediately after).
   * `text` is a single text-node's data; `offset` is the caret index into it.
   * Returns { raw, start, end } with the original-case slice and its [start,end)
   * bounds, or null when the caret is on whitespace/punctuation.
   *
   * Boundary handling: a caret resting just AFTER a word (offset === word end,
   * char at offset is a space) still resolves to that word — matching how a
   * mouse hover near a word's trailing edge feels. */
  function extractWordAt(text, offset) {
    if (text == null) return null;
    const s = String(text);
    let off = offset | 0;
    if (off < 0) off = 0;
    if (off > s.length) off = s.length;

    const onWord = off < s.length && isWordChar(s[off]);
    const afterWord = off > 0 && isWordChar(s[off - 1]);
    if (!onWord && !afterWord) return null;

    let start = off;
    let end = off;
    while (start > 0 && isWordChar(s[start - 1])) start--;
    while (end < s.length && isWordChar(s[end])) end++;
    // Trim leading/trailing hyphen/apostrophe so "-word-" yields "word".
    while (start < end && /['’-]/.test(s[start])) start++;
    while (end > start && /['’-]/.test(s[end - 1])) end--;
    if (end <= start) return null;
    return { raw: s.slice(start, end), start: start, end: end };
  }

  /* Pick the gloss string for a target language from a glossary entry.
   * Entries are { en, fr, ja, ... }; falls back to English, then "".
   * Tolerates a bare-string entry (future-proofing). */
  function glossText(entry, lang) {
    if (entry == null) return "";
    if (typeof entry === "string") return entry;
    if (lang && entry[lang]) return entry[lang];
    return entry.en || "";
  }

  /* Core lookup: given the hovered text + caret offset, return the best
   * glossary hit overlapping the hovered word, or null.
   *
   * Returns { term, start, end, en, text } where:
   *   - term      the glossary key that matched
   *   - start/end the matched span in `text` (for highlight / anchoring)
   *   - en        the canonical English plain-language gloss (always present)
   *   - text      the gloss in `lang` (falls back to English)
   * Longest matching term wins, so "antimicrobial resistance" beats a bare
   * "resistance" entry, and "red flag" beats "flag". */
  function glossAt(text, offset, glossary, lang) {
    if (text == null || !glossary) return null;
    const word = extractWordAt(text, offset);
    if (!word) return null;

    const hay = String(text).toLowerCase();
    let best = null;
    const keys = Object.keys(glossary);
    for (let i = 0; i < keys.length; i++) {
      const term = keys[i];
      if (!term) continue;
      let from = 0;
      let idx;
      while ((idx = hay.indexOf(term, from)) !== -1) {
        const tStart = idx;
        const tEnd = idx + term.length;
        // Keep only matches that actually cover the word under the cursor.
        if (tStart < word.end && tEnd > word.start) {
          if (!best || term.length > best.term.length) {
            best = { term: term, start: tStart, end: tEnd, entry: glossary[term] };
          }
        }
        // Advance past this occurrence (not by 1): cheaper, and overlapping
        // re-matches of the same term are discarded by the length check anyway.
        from = idx + term.length;
      }
    }
    if (!best) return null;
    return {
      term: best.term,
      start: best.start,
      end: best.end,
      en: glossText(best.entry, "en"),
      text: glossText(best.entry, lang)
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Phase 2 — general-dictionary fallback (reader-dict.js loads the bundled
   * EN->JA / EN->FR dictionaries; this resolves the hovered word against them
   * when the curated clinical glossary misses).
   * ────────────────────────────────────────────────────────────────────── */

  // A few high-frequency irregular forms whose base can't be reached by the
  // regular rules below. The bundled dictionaries already list many irregulars
  // as their own headwords, so this is a small safety net, not exhaustive.
  var IRREGULAR = {
    children: "child", men: "man", women: "woman", feet: "foot",
    teeth: "tooth", geese: "goose", mice: "mouse", people: "person",
    lives: "life", knives: "knife", wives: "wife", leaves: "leaf",
    wolves: "wolf", halves: "half", shelves: "shelf",
    went: "go", gone: "go", did: "do", done: "do", had: "have", has: "have",
    was: "be", were: "be", been: "be", said: "say", made: "make",
    came: "come", took: "take", taken: "take", got: "get", gotten: "get",
    saw: "see", seen: "see", gave: "give", given: "give", found: "find",
    better: "good", best: "good", worse: "bad", worst: "bad"
  };

  function pushUnique(arr, seen, w) {
    if (w && w.length > 1 && !seen[w]) { seen[w] = 1; arr.push(w); }
  }

  /* Candidate base forms for an English surface word, most-likely first, so a
   * lemma-keyed dictionary resolves inflected hovers ("running" -> "run",
   * "studies" -> "study", "happier" -> "happy"). The word itself is always
   * first (many entries are surface forms). Rules are intentionally broad —
   * validity is decided downstream by dictionary membership, so an
   * over-generated non-word candidate simply never matches. English inflection
   * is far simpler than the Japanese deinflection Rikaikun/Yomitan need. */
  function englishDeinflect(word) {
    var w = normalizeWord(word);
    var out = [];
    var seen = {};
    if (!w) return out;
    pushUnique(out, seen, w);
    if (Object.prototype.hasOwnProperty.call(IRREGULAR, w)) {
      pushUnique(out, seen, IRREGULAR[w]);
      return out;                                   // irregular handled
    }
    var last = w.charAt(w.length - 1);
    // plural / 3rd-person -s
    if (/(ches|shes|sses|xes|zes)$/.test(w)) pushUnique(out, seen, w.slice(0, -2));      // boxes->box
    if (/ies$/.test(w) && w.length > 4) pushUnique(out, seen, w.slice(0, -3) + "y");      // studies->study
    if (/ves$/.test(w) && w.length > 3) {
      pushUnique(out, seen, w.slice(0, -3) + "f");                                        // knives->knife
      pushUnique(out, seen, w.slice(0, -3) + "fe");
    }
    if (last === "s" && w.slice(-2) !== "ss") pushUnique(out, seen, w.slice(0, -1));      // cats->cat
    if (/es$/.test(w)) pushUnique(out, seen, w.slice(0, -2));                             // goes->go
    // verb -ing
    if (/ing$/.test(w) && w.length > 4) {
      var ingStem = w.slice(0, -3);
      pushUnique(out, seen, ingStem);                                                     // walking->walk
      pushUnique(out, seen, ingStem + "e");                                               // making->make
      if (/(.)\1$/.test(ingStem)) pushUnique(out, seen, ingStem.slice(0, -1));            // running->run
    }
    // verb -ed
    if (/ied$/.test(w)) pushUnique(out, seen, w.slice(0, -3) + "y");                      // tried->try
    if (/ed$/.test(w) && w.length > 3) {
      var edStem = w.slice(0, -2);
      pushUnique(out, seen, edStem);                                                      // walked->walk
      pushUnique(out, seen, edStem + "e");                                                // used->use
      if (/(.)\1$/.test(edStem)) pushUnique(out, seen, edStem.slice(0, -1));              // stopped->stop
    }
    // comparative / superlative
    if (/ier$/.test(w)) pushUnique(out, seen, w.slice(0, -3) + "y");                      // happier->happy
    if (/iest$/.test(w)) pushUnique(out, seen, w.slice(0, -4) + "y");                     // happiest->happy
    if (/er$/.test(w) && w.length > 3) {
      var erStem = w.slice(0, -2);
      pushUnique(out, seen, erStem);                                                      // faster->fast
      pushUnique(out, seen, erStem + "e");                                                // larger->large
      if (/(.)\1$/.test(erStem)) pushUnique(out, seen, erStem.slice(0, -1));              // bigger->big
    }
    if (/est$/.test(w) && w.length > 4) {
      var estStem = w.slice(0, -3);
      pushUnique(out, seen, estStem);                                                     // fastest->fast
      pushUnique(out, seen, estStem + "e");                                               // largest->large
      if (/(.)\1$/.test(estStem)) pushUnique(out, seen, estStem.slice(0, -1));            // biggest->big
    }
    // adverb -ly
    if (/ly$/.test(w) && w.length > 3) {
      if (/ily$/.test(w)) pushUnique(out, seen, w.slice(0, -3) + "y");                    // happily->happy
      pushUnique(out, seen, w.slice(0, -2));                                              // quickly->quick
    }
    return out;
  }

  /* Dictionary fallback: the word under the caret, de-inflected and matched
   * against a Map of lowercased headword -> gloss. Returns
   * { term, start, end, text } (term = the original-case hovered word) or null.
   * Called only after glossAt() misses, so the curated glossary always wins. */
  function dictAt(text, offset, dictMap) {
    if (text == null || !dictMap || typeof dictMap.get !== "function") return null;
    var w = extractWordAt(text, offset);
    if (!w) return null;
    var cands = englishDeinflect(w.raw);
    for (var i = 0; i < cands.length; i++) {
      if (dictMap.has(cands[i])) {
        return { term: w.raw, start: w.start, end: w.end, text: dictMap.get(cands[i]) };
      }
    }
    return null;
  }

  return {
    isWordChar: isWordChar,
    normalizeWord: normalizeWord,
    extractWordAt: extractWordAt,
    glossText: glossText,
    glossAt: glossAt,
    englishDeinflect: englishDeinflect,
    dictAt: dictAt
  };
});
