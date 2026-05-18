/* tests/i18n.test.js
 *
 * Sanity tests for the i18n translation table. We don't have a DOM here
 * (those flows are tested by Playwright), but we can verify the table is
 * structurally sound: every key has an English entry, every non-English
 * table only uses keys that exist in English, every supported language
 * has full key coverage, and the fallback chain works.
 */

const test = require("node:test");
const assert = require("node:assert");

// Make the dummy globals expected by the UMD wrapper present BEFORE require.
global.window = undefined;
global.self = undefined;
const i18n = require("../docs/Third_session/PBL_platform/i18n.js");

const T = i18n._T;
const langs = i18n.SUPPORTED;

// Languages other than the canonical English. Driven off SUPPORTED so
// that adding a new language to i18n.js automatically extends the
// "no foreign keys" assertion below (every translated key MUST exist in
// English). The "full coverage" assertion further down is restricted to
// the core languages (fr, ja) because the second-wave languages (es, pt,
// de, ko, zh) are machine-drafted and may lag behind by a few keys
// between batches — that lag falls back to English at runtime, which is
// safe behaviour we tolerate.
const NON_EN_LANGS = langs.filter(l => l !== "en");
const CORE_TRANSLATED = ["fr", "ja"];

test("i18n: supported languages are exactly [en, fr, ja, es, pt, de, ko, zh]", () => {
  assert.deepStrictEqual(langs, ["en", "fr", "ja", "es", "pt", "de", "ko", "zh"]);
});

test("i18n: English is the canonical key set", () => {
  const enKeys = Object.keys(T.en).sort();
  assert.ok(enKeys.length > 30, "English should have a meaningful number of keys");
  // every key starts with a section prefix
  for (const k of enKeys) {
    assert.match(k, /^(lang|a11y|splash|lobby|waiting|data-rights|stage|room|admin|closed|ended|debrief|tour|test|offline|modal|privacy|rcol|findings|prompts|reset|settings|modA|modB|coach)\./, `key ${k} should be section.prefixed`);
  }
});

test("i18n: every non-English table only uses keys that exist in English", () => {
  const enKeys = new Set(Object.keys(T.en));
  for (const lang of NON_EN_LANGS) {
    for (const k of Object.keys(T[lang])) {
      assert.ok(enKeys.has(k), `${lang} has key ${k} that doesn't exist in English`);
    }
  }
});

test("i18n: every English key has a translation in fr and ja (core)", () => {
  // The core languages (fr, ja) must have full coverage of every English
  // key. The second-wave languages (es, pt, de, ko, zh) are best-effort
  // and may temporarily lag behind a recent EN key addition — they fall
  // back to English at runtime, which is acceptable.
  const missing = {};
  for (const lang of CORE_TRANSLATED) missing[lang] = [];
  for (const k of Object.keys(T.en)) {
    for (const lang of CORE_TRANSLATED) {
      if (!Object.prototype.hasOwnProperty.call(T[lang], k)) missing[lang].push(k);
    }
  }
  for (const lang of CORE_TRANSLATED) {
    assert.deepStrictEqual(
      missing[lang],
      [],
      `Missing ${lang} translations:\n` + missing[lang].join("\n")
    );
  }
});

test("i18n: t() returns the right translation per language", () => {
  // The exported t() reads navigator.language / localStorage at call time,
  // both of which are undefined in Node — so the default fallback is "en".
  // Direct table access tests the actual translation, not the runtime
  // language resolution (that's a browser concern).
  assert.strictEqual(T.en["splash.enter.submit"], "Enter →");
  assert.strictEqual(T.fr["splash.enter.submit"], "Entrer →");
  assert.strictEqual(T.ja["splash.enter.submit"], "入室 →");
  assert.strictEqual(T.es["splash.enter.submit"], "Entrar →");
  assert.strictEqual(T.pt["splash.enter.submit"], "Entrar →");
  assert.strictEqual(T.de["splash.enter.submit"], "Beitreten →");
  assert.strictEqual(T.ko["splash.enter.submit"], "입장 →");
  assert.strictEqual(T.zh["splash.enter.submit"], "进入 →");
});

test("i18n: missing key returns the key itself (so the gap is visible)", () => {
  const result = i18n.t("nonexistent.key.for.this.test");
  assert.strictEqual(result, "nonexistent.key.for.this.test");
});

test("i18n: cross-cutting-minor batch keys are present in en/fr/ja", () => {
  // Keys introduced when wiring the lobby's bare hardcoded strings, the
  // admin-lobby controls, the participant validation messages, the GDPR
  // self-export error alerts, and the call-a-facilitator throttle alerts
  // to i18n. The 3 core languages (en/fr/ja) MUST have all of them —
  // this guards against accidental removal of any single one and against
  // a future contributor adding the EN string but forgetting FR/JA.
  const KEYS = [
    "lobby.session-code-label",
    "lobby.admin-toggle",
    "lobby.admin-pass-label",
    "lobby.admin-pass-placeholder",
    "lobby.admin-open-dashboard",
    "lobby.superadmin-toggle",
    "lobby.superadmin-key-label",
    "lobby.superadmin-key-placeholder",
    "lobby.new-pass-label",
    "lobby.new-pass-placeholder",
    "lobby.save-pass-btn",
    "lobby.err.name-required",
    "lobby.err.session-required",
    "lobby.err.consent-required",
    "lobby.err.university-required",
    "data-rights.err.no-session",
    "data-rights.err.not-ready",
    "data-rights.err.export-failed",
    "room.call.throttle-recall",
    "room.call.throttle-again",
    "room.answer.err.edit-failed",
    "room.answer.err.delete-failed",
    "splash.create.password-hint"
  ];
  for (const k of KEYS) {
    for (const lang of ["en", "fr", "ja"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} should have key ${k}`
      );
      assert.ok(
        typeof T[lang][k] === "string" && T[lang][k].length > 0,
        `${lang}.${k} should be a non-empty string`
      );
    }
  }
});

// Lobby + waiting-room translation gap fixed in fix/participant-i18n-core.
// The simulation in SIMULATION_PARTICIPANTS.md flagged the privacy notice
// and the waiting-room HTML as English-only despite the surrounding consent
// text being localised. These tests pin the new keys + their fr/ja coverage
// so a future refactor that drops a key or a translation goes red.
// NOTE: reconciled with main — p5 absorbed the real ethics-mailbox link
// from main and p6 is one consolidated key (the prefix/link/suffix split
// was redundant given data-i18n-html lets translators reorder freely).
test("i18n: lobby.privacy.* keys exist for en/fr/ja with non-empty translations", () => {
  const required = [
    "lobby.privacy.summary",
    "lobby.privacy.p1",
    "lobby.privacy.p2",
    "lobby.privacy.p3",
    "lobby.privacy.p4",
    "lobby.privacy.p5",
    "lobby.privacy.p6"
  ];
  for (const k of required) {
    for (const lang of ["en", "fr", "ja"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} is missing required lobby-privacy key ${k}`
      );
      assert.ok(
        typeof T[lang][k] === "string" && T[lang][k].length > 0,
        `${lang}.${k} must be a non-empty string`
      );
    }
  }
});

test("i18n: room.call throttle keys interpolate {seconds}", () => {
  // The runtime wiring does its own substitution rather than relying on
  // a template helper; this just guarantees the placeholder is present
  // in every translation so the substitution produces a meaningful string.
  for (const lang of ["en", "fr", "ja"]) {
    assert.match(
      T[lang]["room.call.throttle-recall"],
      /\{seconds\}/,
      `${lang} throttle-recall should interpolate {seconds}`
    );
    assert.match(
      T[lang]["room.call.throttle-again"],
      /\{seconds\}/,
      `${lang} throttle-again should interpolate {seconds}`
    );
  }
});

test("i18n: lobby consent + version + lock-tooltip keys exist for en/fr/ja", () => {
  const required = [
    "lobby.consent-workshop-detail",
    "lobby.consent-version",
    "lobby.consent-version-link",
    "lobby.consent-version-suffix",
    "lobby.consent-required-hint",
    "lobby.consent-required-title",
    "lobby.session-code-label",
    "lobby.session-code-placeholder",
    "lobby.name-required-hint",
    "lobby.session-required-hint",
    "lobby.university-required-hint"
  ];
  for (const k of required) {
    for (const lang of ["en", "fr", "ja"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} is missing required lobby key ${k}`
      );
      assert.ok(T[lang][k].length > 0, `${lang}.${k} must be non-empty`);
    }
  }
});

test("i18n: waiting.* keys exist for en/fr/ja (HTML-wired keys)", () => {
  const required = [
    "waiting.heading",
    "waiting.body",
    "waiting.teams-btn",
    "waiting.joined-so-far"
  ];
  for (const k of required) {
    for (const lang of ["en", "fr", "ja"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} is missing required waiting key ${k}`
      );
      assert.ok(T[lang][k].length > 0, `${lang}.${k} must be non-empty`);
    }
  }
});

test("i18n: privacy paragraphs translate to different prose per language", () => {
  // Sanity-check that the FR + JA translations are not accidental copies
  // of the English source. Catches a real bug we hit during the first
  // pass where a copy-paste left the EN string in the FR table.
  for (const k of ["lobby.privacy.summary", "lobby.privacy.p1", "lobby.privacy.p3"]) {
    assert.notStrictEqual(T.fr[k], T.en[k], `${k} fr should differ from en`);
    assert.notStrictEqual(T.ja[k], T.en[k], `${k} ja should differ from en`);
  }
});

// ----- R2-43: lobby privacy + consent-version keys must reach es/pt/de/ko/zh
// too. The second-wave languages were added with most of the splash/lobby
// strings but the lobby.privacy.* + lobby.consent-version* family was
// missed, so Spanish/Portuguese/German/Korean/Chinese participants saw
// the English privacy notice mixed into an otherwise-translated lobby.
test("i18n: lobby.privacy.* keys cover all 8 supported languages (R2-43)", () => {
  const required = [
    "lobby.privacy.summary",
    "lobby.privacy.p1",
    "lobby.privacy.p2",
    "lobby.privacy.p3",
    "lobby.privacy.p4",
    "lobby.privacy.p5",
    "lobby.privacy.p6",
    "lobby.consent-workshop-detail",
    "lobby.consent-version",
    "lobby.consent-version-link",
    "lobby.consent-version-suffix"
  ];
  for (const k of required) {
    for (const lang of langs) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} is missing required lobby-privacy key ${k} (R2-43)`
      );
      assert.ok(
        typeof T[lang][k] === "string" && T[lang][k].length > 0,
        `${lang}.${k} must be a non-empty string (R2-43)`
      );
    }
  }
});

// ----- R2-42: the splash language switcher exposes all 8 supported langs
// via a <select>. Make sure the label key + every lang.* short-name key
// is present in every language so the dropdown always paints fully
// localised regardless of the active UI language.
test("i18n: splash.lang-label + lang.* keys exist for every language (R2-42)", () => {
  for (const lang of langs) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(T[lang], "splash.lang-label"),
      `${lang} is missing splash.lang-label (R2-42)`
    );
    for (const code of langs) {
      const key = "lang." + code;
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], key),
        `${lang} is missing the ${key} short-name (R2-42)`
      );
    }
  }
});

// ----- R2-47: privacy.html dynamically surfaces a banner when the user's
// UI language has no static full translation. The banner uses the
// privacy.lang-not-available key — it must exist (with a non-empty
// string) in every supported language so we never paint an empty banner.
test("i18n: privacy.lang-not-available exists in every language (R2-47)", () => {
  for (const lang of langs) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(T[lang], "privacy.lang-not-available"),
      `${lang} is missing privacy.lang-not-available (R2-47)`
    );
    assert.ok(
      T[lang]["privacy.lang-not-available"].length > 20,
      `${lang}.privacy.lang-not-available should be a real translation (R2-47)`
    );
  }
});

// ----- R3 deep-i18n: privacy.html is the single dynamic privacy page;
// privacy.title / privacy.subtitle wire the page chrome under data-i18n
// keys. Every supported language MUST carry both keys non-empty so a
// user landing on privacy.html?lang=<x> sees the localised page title
// even when the body falls back to the EN reviewed text.
test("i18n: privacy.* page-chrome keys cover all 8 supported languages (R3 deep-i18n)", () => {
  const required = ["privacy.title", "privacy.subtitle", "privacy.lang-not-available"];
  for (const k of required) {
    for (const lang of langs) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(T[lang], k),
        `${lang} is missing required privacy chrome key ${k} (R3 deep-i18n)`
      );
      assert.ok(
        typeof T[lang][k] === "string" && T[lang][k].length > 5,
        `${lang}.${k} should be a real translation (R3 deep-i18n)`
      );
    }
  }
});

// ----- R3 deep-i18n: the privacy.lang-not-available banner used to link
// to privacy-fr.html / privacy-ja.html (now redirect stubs). The links
// must now point at privacy.html?lang=<x> in every supported language so
// new clicks land on the canonical dynamic page rather than bouncing
// through a meta-refresh redirect stub.
test("i18n: privacy.lang-not-available links use ?lang= query param, not legacy stubs (R3)", () => {
  for (const lang of langs) {
    const v = T[lang]["privacy.lang-not-available"];
    assert.doesNotMatch(v, /privacy-fr\.html/,
      `${lang}.privacy.lang-not-available still links to legacy privacy-fr.html`);
    assert.doesNotMatch(v, /privacy-ja\.html/,
      `${lang}.privacy.lang-not-available still links to legacy privacy-ja.html`);
    assert.match(v, /privacy\.html\?lang=fr/,
      `${lang}.privacy.lang-not-available should link to privacy.html?lang=fr`);
    assert.match(v, /privacy\.html\?lang=ja/,
      `${lang}.privacy.lang-not-available should link to privacy.html?lang=ja`);
  }
});

// ----- R3 deep-i18n: localizedHref('privacy', lang) now returns
// privacy.html?lang=<x> rather than the legacy per-language stub.
test("i18n: localizedHref('privacy') returns the canonical ?lang= URL (R3 deep-i18n)", () => {
  assert.equal(i18n.localizedHref("privacy", "en"), "privacy.html");
  assert.equal(i18n.localizedHref("privacy", "fr"), "privacy.html?lang=fr");
  assert.equal(i18n.localizedHref("privacy", "ja"), "privacy.html?lang=ja");
  assert.equal(i18n.localizedHref("privacy", "de"), "privacy.html?lang=de");
  assert.equal(i18n.localizedHref("privacy", "es"), "privacy.html?lang=es");
});
