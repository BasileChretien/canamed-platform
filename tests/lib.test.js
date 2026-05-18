/* tests/lib.test.js
 *
 * Unit tests for the CaNaMED pure utility library (lib.js). Runs with
 * Node's built-in test runner: `node --test tests/`. No DOM, no
 * Firebase, no fixtures beyond what each test sets up inline.
 *
 * Every exported function is covered: input validation, the happy
 * path, and the security-sensitive edge cases that an attacker would
 * actually probe (XSS schemes, malformed inputs, length overflows,
 * timing-equal strings, brute-force resistance).
 */

const test = require("node:test");
const assert = require("node:assert");
const lib = require("../docs/Third_session/PBL_platform/lib.js");

// =============================================================
// safeHref
// =============================================================
test("safeHref accepts https URLs", () => {
  assert.equal(lib.safeHref("https://example.com"), "https://example.com/");
  assert.equal(lib.safeHref("https://forms.gle/abc?q=1"),
    "https://forms.gle/abc?q=1");
  assert.equal(lib.safeHref("  https://example.com/path  "),
    "https://example.com/path");
});

test("safeHref rejects every non-https scheme (defence in depth)", () => {
  for (const url of [
    "http://example.com",          // plain HTTP would leak in transit
    "javascript:alert(1)",         // XSS
    "JaVaScRiPt:alert(1)",         // XSS, mixed case
    "data:text/html,<script>",     // XSS via data URL
    "vbscript:msgbox(1)",          // legacy IE XSS
    "mailto:victim@example.com",   // phishing — auto-opens mail client
    "tel:+1-555-1234",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "ws://example.com",
    "wss://example.com"            // websockets shouldn't end up in hrefs
  ]) {
    assert.equal(lib.safeHref(url), null,
      "Should reject scheme but didn't: " + url);
  }
});

test("safeHref rejects non-string / falsy / malformed input", () => {
  assert.equal(lib.safeHref(null), null);
  assert.equal(lib.safeHref(undefined), null);
  assert.equal(lib.safeHref(""), null);
  assert.equal(lib.safeHref(42), null);
  assert.equal(lib.safeHref({}), null);
  assert.equal(lib.safeHref([]), null);
  assert.equal(lib.safeHref("not a URL at all"), null);
  assert.equal(lib.safeHref("://broken"), null);
});

// =============================================================
// sanitizeCode
// =============================================================
test("sanitizeCode normalises typed session codes", () => {
  assert.equal(lib.sanitizeCode("ABC-DEF"), "abc-def");
  assert.equal(lib.sanitizeCode("  abc-def  "), "abc-def");
  assert.equal(lib.sanitizeCode("ABC-Def!@#$"), "abc-def");
  assert.equal(lib.sanitizeCode("abc def"), "abcdef");
  assert.equal(lib.sanitizeCode("abc_def"), "abc_def");
});

test("sanitizeCode handles bad input safely", () => {
  assert.equal(lib.sanitizeCode(null), "");
  assert.equal(lib.sanitizeCode(undefined), "");
  assert.equal(lib.sanitizeCode(""), "");
  assert.equal(lib.sanitizeCode(123), "123");           // coerced to string
  assert.equal(lib.sanitizeCode("../../etc/passwd"), "etcpasswd");
});

test("sanitizeCode caps length at 20 chars", () => {
  const long = "a".repeat(50);
  assert.equal(lib.sanitizeCode(long).length, 20);
});

// =============================================================
// sanitizeResume
// =============================================================
test("sanitizeResume accepts a well-formed resume and clamps strings", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc-def",
    name: "Alice",
    university: "Caen",
    year: 3,
    english: "B2",
    room: "Room 1"
  });
  assert.deepEqual(r, {
    sessionNum: "abc-def",
    name: "Alice",
    university: "Caen",
    year: 3,
    english: "B2",
    room: "Room 1",
    consent: null
  });
});

test("sanitizeResume rejects non-object / missing required fields", () => {
  assert.equal(lib.sanitizeResume(null), null);
  assert.equal(lib.sanitizeResume(undefined), null);
  assert.equal(lib.sanitizeResume("string"), null);
  assert.equal(lib.sanitizeResume({}), null);
  assert.equal(lib.sanitizeResume({ sessionNum: "abc" }), null);  // no name
  assert.equal(lib.sanitizeResume({ name: "x" }), null);           // no session
});

test("sanitizeResume rejects non-whitelisted universities", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc", name: "Alice", university: "Harvard"
  });
  assert.equal(r.university, "");
});

test("sanitizeResume accepts deployment-specific cohort IDs", () => {
  // a different deployment passes its own cohort IDs - we don't hard-code
  // Caen/Nagoya in the lib
  const r = lib.sanitizeResume(
    { sessionNum: "abc", name: "X", university: "Stanford" },
    ["Stanford", "Tokyo"]
  );
  assert.equal(r.university, "Stanford");
});

test("sanitizeResume strips overlong fields + invalid year/english", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc",
    name: "A".repeat(200),     // should clamp to 40
    university: "Caen",
    year: 99,                  // not 1..7
    english: "Z9",             // not in CEFR
    room: "x".repeat(100)      // clamp to 30
  });
  assert.equal(r.name.length, 40);
  assert.equal(r.year, 1);
  assert.equal(r.english, "B2");
  assert.equal(r.room.length, 30);
});

test("sanitizeResume strips a malformed consent block", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc", name: "A",
    consent: "not an object"        // attacker-written garbage
  });
  assert.equal(r.consent, null);
});

test("sanitizeResume preserves a valid consent block", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc", name: "A",
    consent: { workshop: true, research: false, version: "PIS-v1", at: 1234 }
  });
  assert.deepEqual(r.consent, {
    workshop: true, research: false, version: "PIS-v1", at: 1234
  });
});

test("sanitizeResume strips a partially-malformed consent block", () => {
  const r = lib.sanitizeResume({
    sessionNum: "abc", name: "A",
    consent: { workshop: "yes", research: true, version: "v1", at: 1234 }
  });
  assert.equal(r.consent, null);
});

// =============================================================
// entriesSorted
// =============================================================
test("entriesSorted returns objects ordered by `at`", () => {
  const input = { a: { at: 30, x: 1 }, b: { at: 10, x: 2 }, c: { at: 20, x: 3 } };
  const out = lib.entriesSorted(input);
  assert.deepEqual(out.map(e => e.id), ["b", "c", "a"]);
});

test("entriesSorted treats missing `at` as 0 (stable-ish)", () => {
  const input = { a: { x: 1 }, b: { at: 10 } };
  const out = lib.entriesSorted(input);
  assert.equal(out[0].id, "a");
});

test("entriesSorted handles null / empty", () => {
  assert.deepEqual(lib.entriesSorted(null), []);
  assert.deepEqual(lib.entriesSorted({}), []);
});

// =============================================================
// normalizeForScore
// =============================================================
test("normalizeForScore strips accents, lowercases, collapses whitespace", () => {
  assert.equal(lib.normalizeForScore("Hôpital  Universitaire"),
    "hopital universitaire");
  assert.equal(lib.normalizeForScore("PHYSIO-thérapie"), "physio-therapie");
  assert.equal(lib.normalizeForScore(""), "");
  assert.equal(lib.normalizeForScore(null), "");
});

// =============================================================
// tc — translatable-content accessor for { en, fr, ja } wrapped strings
// =============================================================
test("tc passes plain strings through unchanged (legacy back-compat)", () => {
  assert.equal(lib.tc("hello", "fr"), "hello");
  assert.equal(lib.tc("hello", "ja"), "hello");
  assert.equal(lib.tc("hello", "en"), "hello");
  // empty string is a string and passes through (matches the back-compat path)
  assert.equal(lib.tc("", "fr"), "");
});

test("tc selects the requested language from { en, fr, ja }", () => {
  const v = { en: "Hello", fr: "Bonjour", ja: "こんにちは" };
  assert.equal(lib.tc(v, "en"), "Hello");
  assert.equal(lib.tc(v, "fr"), "Bonjour");
  assert.equal(lib.tc(v, "ja"), "こんにちは");
});

test("tc falls back to en when the requested language is missing/empty", () => {
  const v = { en: "Hello", fr: "", ja: "" };
  assert.equal(lib.tc(v, "fr"), "Hello");
  assert.equal(lib.tc(v, "ja"), "Hello");
  // also when the requested key is simply absent from the object
  assert.equal(lib.tc({ en: "Hello" }, "fr"), "Hello");
});

test("tc falls back to first non-empty string when en is missing/empty too", () => {
  assert.equal(lib.tc({ en: "", fr: "Bonjour", ja: "" }, "ja"), "Bonjour");
  assert.equal(lib.tc({ fr: "Bonjour" }, "ja"), "Bonjour");
  assert.equal(lib.tc({ ja: "こんにちは" }, "fr"), "こんにちは");
});

test("tc returns '' for null/undefined/non-object/empty-object/unknown input", () => {
  assert.equal(lib.tc(null, "en"), "");
  assert.equal(lib.tc(undefined, "en"), "");
  assert.equal(lib.tc({}, "en"), "");
  assert.equal(lib.tc({ en: "", fr: "", ja: "" }, "en"), "");
  assert.equal(lib.tc(42, "en"), "");
  assert.equal(lib.tc(true, "en"), "");
  assert.equal(lib.tc([], "en"), "");
});

// =============================================================
// tc — R3 deep-i18n strict fallback priority (documented chain)
// =============================================================
// The documented priority chain in lib.js (PRIORITY 1..7) is the
// public contract; the cases below pin each step so a future "small
// refactor" can't silently change behaviour.

test("tc PRIORITY 1: defensive type guard — Array input always returns ''", () => {
  // Array is a typeof 'object' but a translation triplet is never an
  // array; treat as malformed (don't iterate elements as if they were
  // language keys).
  assert.equal(lib.tc(["en", "fr"], "en"), "");
  assert.equal(lib.tc([{ en: "Hello" }], "en"), "");
});

test("tc PRIORITY 1: defensive type guard — symbol/function input returns ''", () => {
  assert.equal(lib.tc(Symbol("x"), "en"), "");
  assert.equal(lib.tc(() => "Hello", "en"), "");
});

test("tc PRIORITY 2 vs 3: empty-string value at requested lang falls through to en", () => {
  // The critical distinction: value[lang] === "" means "translator
  // deliberately left this blank" => fall through, do NOT return "".
  // Only `value` itself being the string "" triggers PRIORITY 2.
  assert.equal(lib.tc("", "fr"), "");                                      // PRIORITY 2 — plain string
  assert.equal(lib.tc({ en: "Hello", fr: "" }, "fr"), "Hello");            // PRIORITY 3 falls through to 4
  assert.equal(lib.tc({ en: "Hello", fr: null }, "fr"), "Hello");          // non-string fr also falls through
});

test("tc PRIORITY 3 vs 4: requested lang wins over en when both non-empty", () => {
  const v = { en: "Hello", fr: "Bonjour", ja: "こんにちは" };
  assert.equal(lib.tc(v, "fr"), "Bonjour");
  assert.equal(lib.tc(v, "ja"), "こんにちは");
  // missing lang argument => only PRIORITY 4 (en) can fire
  assert.equal(lib.tc(v), "Hello");
  assert.equal(lib.tc(v, undefined), "Hello");
  assert.equal(lib.tc(v, null), "Hello");
});

test("tc PRIORITY 5: iterates known SUPPORTED languages when en is missing", () => {
  // Order across SUPPORTED is en, fr, ja, es, pt, de, ko, zh — once en
  // is gone, fr wins over ja, ja over es, etc.
  assert.equal(lib.tc({ fr: "Bonjour", ja: "こんにちは" }, "es"), "Bonjour");
  assert.equal(lib.tc({ ja: "こんにちは", es: "Hola" }, "fr"), "こんにちは");
  // also when the requested lang has an empty string
  assert.equal(lib.tc({ de: "", ko: "안녕", zh: "你好" }, "de"), "안녕");
});

test("tc PRIORITY 6: falls through to first non-empty string-valued key for exotic shapes", () => {
  // language not yet in SUPPORTED (e.g. Arabic) must still render
  // rather than vanish.
  assert.equal(lib.tc({ ar: "مرحبا" }, "fr"), "مرحبا");
  // mix of known-empty + exotic-populated
  assert.equal(lib.tc({ en: "", fr: "", ar: "مرحبا" }, "fr"), "مرحبا");
});

test("tc PRIORITY 7: ignores non-string values when looking for a fallback", () => {
  // A future extension might use { en: "...", meta: { ... } } — meta is
  // not a string and must not be returned as if it were a translation.
  assert.equal(lib.tc({ en: "", meta: { reviewed: true } }, "fr"), "");
  assert.equal(lib.tc({ en: "", count: 5 }, "fr"), "");
  assert.equal(lib.tc({ en: "", flag: true }, "fr"), "");
});

// =============================================================
// localCountryName + buildCohortPair — cohort-aware string templates
// =============================================================
// R3 deep-i18n fix: replace per-language "Franco-Japanese" / "deutsch-
// japanisch" hardcodes with a {cohortPair} placeholder rendered from
// COHORTS[].country at i18n-render time.

test("localCountryName: returns localised name for known country+lang pair", () => {
  assert.equal(lib.localCountryName("France", "ja"), "フランス");
  assert.equal(lib.localCountryName("Japan", "fr"), "Japon");
  assert.equal(lib.localCountryName("Germany", "ja"), "ドイツ");
  assert.equal(lib.localCountryName("Germany", "de"), "Deutschland");
  assert.equal(lib.localCountryName("Korea", "zh"), "韩国");
});

test("localCountryName: falls back to English when lang is unknown or missing", () => {
  assert.equal(lib.localCountryName("France", "ar"), "France");     // unknown lang
  assert.equal(lib.localCountryName("France", undefined), "France");
  assert.equal(lib.localCountryName("France", null), "France");
});

test("localCountryName: returns the input verbatim when the country is unknown", () => {
  // safer than "" — operator still sees something readable in the UI
  assert.equal(lib.localCountryName("Atlantis", "fr"), "Atlantis");
  assert.equal(lib.localCountryName("", "fr"), "");
});

test("buildCohortPair: renders Caen-Nagoya in every supported language", () => {
  const COHORTS = [
    { id: "Caen", country: "France", short: "Caen" },
    { id: "Nagoya", country: "Japan", short: "Nagoya" }
  ];
  assert.equal(lib.buildCohortPair(COHORTS, "en"), "France-Japan");
  assert.equal(lib.buildCohortPair(COHORTS, "fr"), "France-Japon");
  assert.equal(lib.buildCohortPair(COHORTS, "ja"), "フランス-日本");
  assert.equal(lib.buildCohortPair(COHORTS, "de"), "Frankreich-Japan");
  assert.equal(lib.buildCohortPair(COHORTS, "ko"), "프랑스-일본");
  assert.equal(lib.buildCohortPair(COHORTS, "zh"), "法国-日本");
});

test("buildCohortPair: renders Berlin-Tokyo without any code change beyond COHORTS", () => {
  // The single most-important Müller fix: a future Berlin-Tokyo
  // partnership must render "deutsch-japanisch" in DE and "ドイツ-日本"
  // in JA purely from editing the COHORTS list.
  const COHORTS = [
    { id: "Berlin", country: "Germany", short: "Berlin" },
    { id: "Tokyo",  country: "Japan",   short: "Tokyo" }
  ];
  assert.equal(lib.buildCohortPair(COHORTS, "en"), "Germany-Japan");
  assert.equal(lib.buildCohortPair(COHORTS, "de"), "Deutschland-Japan");
  assert.equal(lib.buildCohortPair(COHORTS, "ja"), "ドイツ-日本");
  assert.equal(lib.buildCohortPair(COHORTS, "fr"), "Allemagne-Japon");
});

test("buildCohortPair: supports 3+ cohorts and a custom separator", () => {
  const TRI = [
    { id: "Caen",   country: "France" },
    { id: "Nagoya", country: "Japan" },
    { id: "Seoul",  country: "Korea" }
  ];
  assert.equal(lib.buildCohortPair(TRI, "en"), "France-Japan-Korea");
  assert.equal(lib.buildCohortPair(TRI, "en", " × "), "France × Japan × Korea");
});

test("buildCohortPair: falls back to cohort.short / .id when country is missing", () => {
  const C = [{ id: "Lyon", short: "Lyon" }, { id: "Tokyo", country: "Japan" }];
  // Lyon has no country -> uses "Lyon"; Tokyo has country -> "Japan"
  assert.equal(lib.buildCohortPair(C, "en"), "Lyon-Japan");
  assert.equal(lib.buildCohortPair(C, "ja"), "Lyon-日本");
});

test("buildCohortPair: defensive — empty/null/malformed inputs return 'International'", () => {
  assert.equal(lib.buildCohortPair(null, "en"), "International");
  assert.equal(lib.buildCohortPair(undefined, "en"), "International");
  assert.equal(lib.buildCohortPair([], "en"), "International");
  assert.equal(lib.buildCohortPair([null, undefined, {}], "en"), "International");
});

test("applyTemplate: substitutes {cohortPair} and leaves unknown placeholders untouched", () => {
  assert.equal(
    lib.applyTemplate("Join a {cohortPair} room.", { cohortPair: "France-Japan" }),
    "Join a France-Japan room."
  );
  // unknown placeholder stays visible so the gap is greppable
  assert.equal(
    lib.applyTemplate("Join {cohortPair} - {unknown}.", { cohortPair: "X" }),
    "Join X - {unknown}."
  );
  // defensive
  assert.equal(lib.applyTemplate(null, { x: 1 }), "");
  assert.equal(lib.applyTemplate("no vars", null), "no vars");
});

// =============================================================
// decisionShort
// =============================================================
test("decisionShort returns the prompt verbatim if short", () => {
  assert.equal(lib.decisionShort({ prompt: "What do you do?" }),
    "What do you do?");
});

test("decisionShort truncates and ellipses if > 64 chars", () => {
  const long = "x".repeat(100);
  const short = lib.decisionShort({ prompt: long });
  assert.ok(short.length <= 62);
  assert.ok(short.endsWith("…"));
});

test("decisionShort handles null/empty", () => {
  assert.equal(lib.decisionShort(null), "");
  assert.equal(lib.decisionShort({}), "");
  assert.equal(lib.decisionShort({ prompt: null }), "");
});

test("decisionShort reads { en, fr, ja } prompts via tc()", () => {
  const d = { prompt: { en: "What do you do?", fr: "Que faites-vous ?", ja: "どうしますか?" } };
  assert.equal(lib.decisionShort(d, "en"), "What do you do?");
  assert.equal(lib.decisionShort(d, "fr"), "Que faites-vous ?");
  assert.equal(lib.decisionShort(d, "ja"), "どうしますか?");
  // missing lang argument defaults to en
  assert.equal(lib.decisionShort(d), "What do you do?");
  // missing fr falls back to en
  assert.equal(lib.decisionShort({ prompt: { en: "Hello", fr: "", ja: "" } }, "fr"),
    "Hello");
});

test("decisionShort truncates a wrapped prompt past 64 chars", () => {
  const long = "x".repeat(100);
  const out = lib.decisionShort({ prompt: { en: long, fr: "", ja: "" } }, "fr");
  assert.ok(out.length <= 62);
  assert.ok(out.endsWith("…"));
});

// =============================================================
// scoreTotal
// =============================================================
test("scoreTotal sums auto + min(manual, cap) − penalties, floored at 0", () => {
  const room = {
    score: {
      auto: { a: { points: 10 }, b: { points: 20 } },        // 30
      manual: { x: { points: 50 } },                          // 50 capped at 30
      penalties: { p: { points: 5 } }                         // -5
    }
  };
  assert.equal(lib.scoreTotal(room, 30), 55);                 // 30 + 30 - 5
});

test("scoreTotal floors at 0 when penalties exceed auto+manual", () => {
  const room = {
    score: {
      auto: { a: { points: 5 } },
      penalties: { p: { points: 50 } }
    }
  };
  assert.equal(lib.scoreTotal(room, 70), 0);
});

test("scoreTotal defaults manualCap to 70 when not provided", () => {
  const room = { score: { manual: { x: { points: 100 } } } };
  assert.equal(lib.scoreTotal(room), 70);
});

test("scoreTotal handles missing / malformed input", () => {
  assert.equal(lib.scoreTotal(null), 0);
  assert.equal(lib.scoreTotal({}), 0);
  assert.equal(lib.scoreTotal({ score: {} }), 0);
  assert.equal(lib.scoreTotal({ score: { auto: { x: { points: undefined } } } }), 0);
});

// =============================================================
// constantTimeEq
// =============================================================
test("constantTimeEq returns true only for byte-equal strings", () => {
  assert.equal(lib.constantTimeEq("abc", "abc"), true);
  assert.equal(lib.constantTimeEq("abc", "abd"), false);
  assert.equal(lib.constantTimeEq("", ""), true);
});

test("constantTimeEq returns false on length mismatch", () => {
  assert.equal(lib.constantTimeEq("abc", "abcd"), false);
  assert.equal(lib.constantTimeEq("abcd", "abc"), false);
});

test("constantTimeEq returns false on non-string input", () => {
  assert.equal(lib.constantTimeEq("abc", null), false);
  assert.equal(lib.constantTimeEq(null, "abc"), false);
  assert.equal(lib.constantTimeEq(123, 123), false);
});

// =============================================================
// hashPassword / verifyPassword / pbkdf2 / sha256Hex
// =============================================================
test("hashPassword returns the v2$iters$hex envelope", async () => {
  const h = await lib.hashPassword("hunter2", "abc-def");
  assert.match(h, /^v2\$\d+\$[0-9a-f]+$/);
  assert.ok(h.startsWith("v2$" + lib.PBKDF2_ITERS_DEFAULT + "$"));
});

test("hashPassword is deterministic for the same salt+password", async () => {
  const a = await lib.hashPassword("hunter2", "abc-def");
  const b = await lib.hashPassword("hunter2", "abc-def");
  assert.equal(a, b);
});

test("hashPassword differs for different salts (different sessions)", async () => {
  const a = await lib.hashPassword("hunter2", "abc-def");
  const b = await lib.hashPassword("hunter2", "xyz-123");
  assert.notEqual(a, b);
});

test("verifyPassword: round-trip with the current PBKDF2 format", async () => {
  const h = await lib.hashPassword("hunter2", "abc-def");
  assert.equal(await lib.verifyPassword("hunter2", "abc-def", h), true);
  assert.equal(await lib.verifyPassword("wrong",   "abc-def", h), false);
  assert.equal(await lib.verifyPassword("hunter2", "wrong",   h), false);
});

test("verifyPassword: accepts the legacy SHA-256 envelope (back-compat)", async () => {
  // produce a legacy hash exactly the way the old hashPassword did
  const legacy = await lib.sha256Hex("canamed:abc-def:hunter2");
  assert.equal(legacy.length, 64);
  assert.match(legacy, /^[0-9a-f]{64}$/);
  // verifyPassword should still accept it
  assert.equal(await lib.verifyPassword("hunter2", "abc-def", legacy), true);
  assert.equal(await lib.verifyPassword("wrong",   "abc-def", legacy), false);
});

test("verifyPassword rejects malformed stored hashes", async () => {
  assert.equal(await lib.verifyPassword("x", "y", null), false);
  assert.equal(await lib.verifyPassword("x", "y", ""), false);
  assert.equal(await lib.verifyPassword("x", "y", "v2$abc$def"), false);   // non-numeric iters
  assert.equal(await lib.verifyPassword("x", "y", "v2$100$abc"), false);   // iters too low
  assert.equal(await lib.verifyPassword("x", "y", "v2$badformat"), false); // wrong shape
});

// =============================================================
// generateSessionCode
// =============================================================
test("generateSessionCode matches the expected format", () => {
  // alphabet skips i/l/o/0/1; 3-char-dash-3-char layout
  const re = /^[abcdefghjkmnpqrstuvwxyz23456789]{3}-[abcdefghjkmnpqrstuvwxyz23456789]{3}$/;
  for (let i = 0; i < 50; i++) {
    const code = lib.generateSessionCode();
    assert.match(code, re,
      "Code " + code + " does not match the expected format");
  }
});

test("generateSessionCode collisions over a small batch are vanishingly rare", () => {
  // 31^6 ≈ 887M combinations; in 1,000 draws expected collisions ≈ 0
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = lib.generateSessionCode();
    assert.equal(seen.has(code), false,
      "Unexpected duplicate session code: " + code);
    seen.add(code);
  }
});

test("generateSessionCode never returns a forbidden character", () => {
  // exhaustive sweep against the visually-ambiguous set we deliberately
  // excluded (i, l, o, 0, 1 — same alphabet, both halves of the dash)
  const forbidden = ["i", "l", "o", "0", "1"];
  for (let i = 0; i < 200; i++) {
    const code = lib.generateSessionCode();
    for (const f of forbidden) {
      assert.equal(code.indexOf(f), -1,
        "Code " + code + " contains the forbidden char '" + f + "'");
    }
  }
});

// =============================================================
// integration: hashPassword + verifyPassword resists obvious attacks
// =============================================================
test("a leaked hash is unusable to verify a different password (timing- and value-wise)", async () => {
  const h = await lib.hashPassword("correct horse battery staple", "abc-def");
  // even a one-character-off attempt fails
  for (const guess of [
    "Correct horse battery staple",
    "correct horse battery stapl",
    "correct horse battery staple ",
    "",
    "v2$100000$" + "0".repeat(64)
  ]) {
    assert.equal(await lib.verifyPassword(guess, "abc-def", h), false,
      "Wrongly accepted guess: " + JSON.stringify(guess));
  }
});

// =============================================================
// computeCohortCounts — facilitator waiting-room chip tallies
// (SIMULATION_FACILITATOR.md finding: Caen-vs-Nagoya live count)
// =============================================================
const CAEN_NAGOYA = [
  { id: "Caen", short: "Caen", color: "#b45309" },
  { id: "Nagoya", short: "Nagoya", color: "#1763a6" }
];

test("computeCohortCounts: empty waiting room returns zeros for every cohort", () => {
  const counts = lib.computeCohortCounts([], CAEN_NAGOYA);
  assert.deepStrictEqual(counts, { Caen: 0, Nagoya: 0 });
  assert.ok(!("__other__" in counts), "no __other__ bucket when nothing is buckets");
});

test("computeCohortCounts: tallies a mixed Franco-Japanese cohort", () => {
  const waiting = [
    { name: "Alice",   university: "Caen" },
    { name: "Bob",     university: "Caen" },
    { name: "Yuki",    university: "Nagoya" },
    { name: "Hiro",    university: "Nagoya" },
    { name: "Sakura",  university: "Nagoya" }
  ];
  const counts = lib.computeCohortCounts(waiting, CAEN_NAGOYA);
  assert.deepStrictEqual(counts, { Caen: 2, Nagoya: 3 });
});

test("computeCohortCounts: unknown universities bucket under __other__", () => {
  const waiting = [
    { name: "Alice", university: "Caen" },
    { name: "Bob",   university: "Lyon" },     // not in CAEN_NAGOYA
    { name: "Chao",  university: "Beijing" }   // not in CAEN_NAGOYA
  ];
  const counts = lib.computeCohortCounts(waiting, CAEN_NAGOYA);
  assert.deepStrictEqual(counts, { Caen: 1, Nagoya: 0, __other__: 2 });
});

test("computeCohortCounts: ignores blank / missing university values", () => {
  const waiting = [
    { name: "Alice", university: "Caen" },
    { name: "Bob" },                   // no university field at all
    { name: "Chao", university: "" },  // empty string
    { name: "Yuki", university: "Nagoya" }
  ];
  const counts = lib.computeCohortCounts(waiting, CAEN_NAGOYA);
  assert.deepStrictEqual(counts, { Caen: 1, Nagoya: 1 },
    "blank university must NOT inflate __other__ or any cohort");
});

test("computeCohortCounts: handles arbitrary cohort registries (Lyon × Tokyo)", () => {
  const LYON_TOKYO = [
    { id: "Lyon",  short: "Lyon" },
    { id: "Tokyo", short: "Tokyo" }
  ];
  const waiting = [
    { university: "Lyon" }, { university: "Lyon" }, { university: "Lyon" },
    { university: "Tokyo" }
  ];
  assert.deepStrictEqual(
    lib.computeCohortCounts(waiting, LYON_TOKYO),
    { Lyon: 3, Tokyo: 1 }
  );
});

test("computeCohortCounts: defensive — bad inputs do not throw", () => {
  assert.deepStrictEqual(lib.computeCohortCounts(null, CAEN_NAGOYA), { Caen: 0, Nagoya: 0 });
  assert.deepStrictEqual(lib.computeCohortCounts(undefined, CAEN_NAGOYA), { Caen: 0, Nagoya: 0 });
  assert.deepStrictEqual(lib.computeCohortCounts([{ university: "Caen" }], null), { __other__: 1 });
  assert.deepStrictEqual(lib.computeCohortCounts([{ university: "Caen" }], []), { __other__: 1 });
  // bad cohort entries are filtered out, not treated as ids
  assert.deepStrictEqual(
    lib.computeCohortCounts([{ university: "Caen" }],
      [{ id: "" }, null, { id: "Caen" }]),
    { Caen: 1 }
  );
});

// =============================================================
// pseudoCode + pseudonymiseTree (R2-23)
// =============================================================
// The full JSON archive download used to ship raw participant names.
// pseudonymiseTree() is the shared walker that the admin checkbox
// invokes when the "Pseudonymise names in export" toggle is on, and
// mirrors scripts/pseudonymise-export.js (the cron research export)
// so the two outputs are interchangeable.
test("pseudoCode: deterministic Student-A..Z then AA, AB, ...", () => {
  assert.equal(lib.pseudoCode(0), "Student-A");
  assert.equal(lib.pseudoCode(1), "Student-B");
  assert.equal(lib.pseudoCode(25), "Student-Z");
  assert.equal(lib.pseudoCode(26), "Student-AA");
  assert.equal(lib.pseudoCode(27), "Student-AB");
  assert.equal(lib.pseudoCode(51), "Student-AZ");
  assert.equal(lib.pseudoCode(52), "Student-BA");
});

test("pseudonymiseTree: pool names rewritten + ordered by join time", () => {
  const tree = {
    pool: {
      c2: { name: "Bob",     university: "Caen",   at: 200 },
      c1: { name: "Alice",   university: "Caen",   at: 100 },
      c3: { name: "Chiyoko", university: "Nagoya", at: 300 }
    }
  };
  const { tree: out, linkage } = lib.pseudonymiseTree(tree);
  // ordered by `at` ascending, regardless of insertion order
  assert.equal(linkage["Alice"],   "Student-A");
  assert.equal(linkage["Bob"],     "Student-B");
  assert.equal(linkage["Chiyoko"], "Student-C");
  assert.equal(out.pool.c1.name, "Student-A");
  assert.equal(out.pool.c2.name, "Student-B");
  assert.equal(out.pool.c3.name, "Student-C");
  // non-name fields untouched
  assert.equal(out.pool.c1.university, "Caen");
  assert.equal(out.pool.c3.university, "Nagoya");
});

test("pseudonymiseTree: rewrites `by` fields in answers / score / calls", () => {
  const tree = {
    pool: {
      c1: { name: "Alice", university: "Caen", at: 100 },
      c2: { name: "Bob",   university: "Caen", at: 200 }
    },
    rooms: {
      "Room 1": {
        answers: {
          moduleA: {
            a1: { by: "Alice", text: "ask about red flags", at: 150 },
            a2: { by: "Bob",   text: "neuro exam",          at: 160 }
          }
        },
        score: {
          manual: {
            m1: { by: "Alice", points: 5, tag: "good answer", at: 170 }
          }
        },
        calls: {
          k1: { by: "Bob", at: 180 }
        }
      }
    }
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  assert.equal(out.rooms["Room 1"].answers.moduleA.a1.by, "Student-A");
  assert.equal(out.rooms["Room 1"].answers.moduleA.a2.by, "Student-B");
  // the actual answer text is preserved — it's content, not a name
  assert.equal(out.rooms["Room 1"].answers.moduleA.a1.text,
    "ask about red flags");
  assert.equal(out.rooms["Room 1"].score.manual.m1.by, "Student-A");
  assert.equal(out.rooms["Room 1"].calls.k1.by, "Student-B");
});

test("pseudonymiseTree: does not mutate the input tree", () => {
  const tree = {
    pool: { c1: { name: "Alice", university: "Caen", at: 100 } },
    rooms: { "Room 1": { answers: { moduleA: { a1: { by: "Alice", text: "x" } } } } }
  };
  const before = JSON.stringify(tree);
  lib.pseudonymiseTree(tree);
  assert.equal(JSON.stringify(tree), before,
    "pseudonymiseTree must NOT mutate the input — researchers may " +
    "re-use the same tree object for other downstream calls");
});

test("pseudonymiseTree: strips adminPasswordHash defence-in-depth", () => {
  const tree = {
    pool: { c1: { name: "Alice", at: 100 } },
    adminPasswordHash: "v2$100000$deadbeef"
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  assert.ok(!("adminPasswordHash" in out),
    "the pseudonymised export must never carry the admin password hash");
});

test("pseudonymiseTree: no real name survives a deep walk", () => {
  // The acceptance test: take a realistic tree, pseudonymise, then
  // JSON.stringify the result and assert that no real name appears
  // anywhere in the output. Mirrors the e2e expectation.
  const tree = {
    pool: {
      c1: { name: "Marie-Laure", university: "Caen",   at: 100 },
      c2: { name: "Yamada Hiro", university: "Nagoya", at: 200 }
    },
    rooms: {
      "Room 1": {
        teamName: "Team",
        presence:   { c1: { name: "Marie-Laure", at: 101 } },
        answers: {
          moduleA: {
            a1: { by: "Marie-Laure", text: "history first", at: 102 },
            a2: { by: "Yamada Hiro", text: "exam systematic", at: 103 }
          }
        }
      }
    }
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  const json = JSON.stringify(out);
  assert.ok(!json.includes("Marie-Laure"),
    "raw participant name leaked through the walker: Marie-Laure");
  assert.ok(!json.includes("Yamada Hiro"),
    "raw participant name leaked through the walker: Yamada Hiro");
  // and the pseudonyms ARE present
  assert.ok(json.includes("Student-A"));
  assert.ok(json.includes("Student-B"));
});

test("pseudonymiseTree: defensive — null / non-object inputs return safely", () => {
  assert.deepStrictEqual(lib.pseudonymiseTree(null),
    { tree: null, linkage: {} });
  assert.deepStrictEqual(lib.pseudonymiseTree(undefined),
    { tree: undefined, linkage: {} });
  assert.deepStrictEqual(lib.pseudonymiseTree("a string"),
    { tree: "a string", linkage: {} });
  // empty pool ⇒ empty linkage, but the walker still runs cleanly
  const { tree: out, linkage } = lib.pseudonymiseTree({ pool: {}, rooms: {} });
  assert.deepStrictEqual(linkage, {});
  assert.deepStrictEqual(out, { pool: {}, rooms: {} });
});

test("pseudonymiseTree: cids (object keys) are NEVER rewritten", () => {
  // Only string VALUES that match a real name get rewritten. Object keys
  // like cids must stay intact, otherwise the per-tab live state would
  // be misrouted.
  const tree = {
    pool: { Alice: { name: "Alice", at: 100 } }
    // ^^ contrived: someone has a cid that happens to equal a name
  };
  const { tree: out } = lib.pseudonymiseTree(tree);
  // the cid key "Alice" is preserved; only the .name value is rewritten
  assert.ok(Object.prototype.hasOwnProperty.call(out.pool, "Alice"),
    "cid key must not be rewritten — would orphan all references");
  assert.equal(out.pool.Alice.name, "Student-A");
});

test("pseudonymiseTree: linkage table excludes empty / missing names", () => {
  const tree = {
    pool: {
      c1: { name: "", at: 100 },
      c2: { at: 200 },                // no name field at all
      c3: { name: "Alice", at: 300 }
    }
  };
  const { linkage } = lib.pseudonymiseTree(tree);
  // only Alice gets a pseudonym; empty/missing names are skipped
  assert.deepStrictEqual(linkage, { Alice: "Student-A" });
});

