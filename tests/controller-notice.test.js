/* tests/controller-notice.test.js
 *
 * Annex VI L1 — the join screen must name the controller of THIS session.
 *
 * It used to state as a fact that Caen and Nagoya are the joint controllers of
 * every session. Any signed-in facilitator can create one (facilitatorGate is
 * inert by default), so a session run by a third institution told its
 * participants the wrong controller at the moment of collection — GDPR
 * Art. 13(1)(a).
 *
 * ⚠️ THE FIRST ATTEMPT AT THIS WAS WRONG IN AN INSTRUCTIVE WAY, and these tests
 * exist mostly to stop it coming back. It substituted only the institution
 * NAME inside the existing sentence, which rendered
 *   "The CaNaMED research team (Universiteit Leiden, joint controllers under
 *    GDPR Art. 26 / joint users under APPI Art. 27(5)) collects…"
 * — a single institution described as "joint controllers", still attributed to
 * the CaNaMED research team. Grammatical nonsense AND a fresh false statement.
 * The replaceable unit is the whole CLAUSE, not the name inside it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Dummy globals the UMD wrapper expects, present BEFORE require — same as
// tests/i18n.test.js.
global.window = undefined;
global.self = undefined;
const i18n = require("../docs/Third_session/PBL_platform/i18n.js");
const T = i18n._T;

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const LANGS = ["en", "fr", "ja", "de", "es", "pt", "ko", "zh"];

function render(lang, controller) {
  i18n.setLang(lang);
  global.CANAMED_SESSION_CONTROLLER = controller;
  return i18n.t("lobby.privacy.p1");
}

test("every language carries both controller clauses", () => {
  for (const lang of LANGS) {
    for (const k of ["lobby.privacy.controller-default", "lobby.privacy.controller-named"]) {
      assert.ok(T[lang][k], `${lang} is missing ${k}`);
    }
    assert.match(T[lang]["lobby.privacy.p1"], /\{controller\}/,
      `${lang}'s p1 does not carry the {controller} placeholder, so that ` +
      `language would keep naming the wrong controller`);
  }
});

test("the named clause replaces the WHOLE clause, not the name inside it", () => {
  /* The exact regression from the first attempt. If `controller-named` ever
     shrinks back to just the institution, this fails. */
  for (const lang of LANGS) {
    const named = T[lang]["lobby.privacy.controller-named"];
    assert.match(named, /\{name\}/, `${lang}: controller-named has no {name}`);
    assert.ok(!/26|27\(5\)|Art\./.test(named),
      `${lang}: controller-named still carries the joint-controller citations. ` +
      `A single named institution is not "joint controllers under Art. 26".`);
  }
});

test("with no session controller, every language renders exactly what it did before", () => {
  /* The default IS the sentence opening that was there, so this change must be
     invisible on the canonical deployment and on every session predating the
     field. */
  for (const lang of LANGS) {
    const out = render(lang, "");
    assert.ok(out.startsWith(T[lang]["lobby.privacy.controller-default"]),
      `${lang}: the default rendering changed`);
    assert.ok(!out.includes("{controller}"), `${lang}: placeholder left unsubstituted`);
  }
  i18n.setLang("en");
});

test("a named controller replaces the joint-controller claim outright", () => {
  const out = render("en", "Universiteit Leiden");
  assert.match(out, /Universiteit Leiden/);
  assert.ok(!/joint controllers/i.test(out),
    "the sentence still calls a single named institution 'joint controllers' — " +
    "this is the first attempt's bug, back again");
  assert.ok(!/CaNaMED research team/.test(out),
    "the sentence still attributes the collection to the CaNaMED research team");
  i18n.setLang("en");
});

test("the interpolated name is HTML-escaped — p1 reaches innerHTML", () => {
  /* lobby.privacy.p1 is rendered with data-i18n-html. The value is typed by a
     facilitator, so it is untrusted input at an HTML sink. */
  const out = render("en", '<img src=x onerror=alert(1)>"x"');
  assert.ok(!out.includes("<img"), "raw markup survived into an innerHTML sink");
  assert.match(out, /&lt;img/);
  assert.match(out, /&quot;x&quot;/);
  i18n.setLang("en");
});

test("a whitespace-only controller falls back rather than rendering an empty subject", () => {
  const out = render("en", "   ");
  assert.ok(out.startsWith(T.en["lobby.privacy.controller-default"]),
    "a blank controller produced a sentence with no subject");
  i18n.setLang("en");
});

// ------------------------------------------------------------------ wiring

test("the rules accept a controller on the session, write-once, in both trees", () => {
  const rules = JSON.parse(read(PLATFORM, "database.rules.json")).rules;
  for (const [label, node] of [
    ["default", rules.sessions.$sessionId.controller],
    ["orgs", rules.orgs.$orgSlug.sessions.$sessionId.controller],
  ]) {
    assert.ok(node, `${label}: no controller rule`);
    assert.match(node[".write"], /!data\.exists\(\)/, `${label}: not write-once`);
    assert.match(node[".validate"], /length <= 120/, `${label}: unbounded`);
  }
});

test("the create flow collects it, refuses a blank, and writes it", () => {
  const src = read(PLATFORM, "script.js");
  assert.match(src, /splash-create-controller/,
    "the create form never reads the field");
  assert.match(src, /controller-required/,
    "a blank controller is accepted, which silently names the platform's own " +
    "institutions for somebody else's session");
  assert.match(src, /oPath\(code, "controller"\)/, "it is never written");
  assert.match(src, /CANAMED_SESSION_CONTROLLER/,
    "it is never published for the notice to read");
});

test("the field is on the create form and required", () => {
  const html = read(PLATFORM, "index.html");
  assert.match(html, /id="splash-create-controller"[\s\S]{0,400}required/,
    "the controller field is missing or not marked required");
});

test("a session naming the platform's own institutions keeps the joint-controller clause", () => {
  /* The create form PREFILLS the controller with the platform's institutions,
     so without this every canonical session would carry a `controller` value
     and silently lose "joint controllers under GDPR Art. 26 / joint users under
     APPI Art. 27(5)" — citations the CER dossier relies on. Found by an e2e
     that asserted the French "responsables conjoints" and got the named clause
     instead. */
  for (const lang of LANGS) {
    const plain = T[lang]["lobby.privacy.controller-plain"] ||
      T.en["lobby.privacy.controller-plain"];
    assert.ok(plain, `${lang}: no controller-plain to compare against`);
    const out = render(lang, plain);
    assert.ok(out.startsWith(T[lang]["lobby.privacy.controller-default"]),
      `${lang}: naming the platform's own institutions dropped the ` +
      `joint-controller clause`);
  }
  i18n.setLang("en");
});

test("the comparison is not case- or whitespace-sensitive to the point of uselessness", () => {
  const plain = T.en["lobby.privacy.controller-plain"];
  assert.ok(render("en", "  " + plain.toUpperCase() + "  ")
    .startsWith(T.en["lobby.privacy.controller-default"]),
    "a differently-cased or padded copy of the default was treated as a " +
    "third-party controller");
  /* …but a genuinely different institution must still be named. */
  assert.match(render("en", "Universiteit Leiden"), /Universiteit Leiden/);
  i18n.setLang("en");
});

test("the default is recognised whatever language the FACILITATOR typed it in", () => {
  /* The value is written by the facilitator and read by a participant who may
     have chosen another language. Comparing only against the reader's language
     lost the joint-controller citations for every non-English reader — caught
     by the French lobby e2e, not by the first version of this file. */
  const forms = LANGS.map((l) => T[l]["lobby.privacy.controller-plain"]).filter(Boolean);
  assert.ok(forms.length >= 3, "not enough plain forms to make this meaningful");
  for (const reader of LANGS) {
    for (const typed of forms) {
      assert.ok(render(reader, typed).startsWith(T[reader]["lobby.privacy.controller-default"]),
        `reader=${reader} lost the joint-controller clause when the facilitator ` +
        `typed "${typed.slice(0, 40)}"`);
    }
  }
  i18n.setLang("en");
});
