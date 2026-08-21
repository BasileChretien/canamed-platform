"use strict";
/* App Check / reCAPTCHA is consent-gated (2026-08-21).
 *
 * reCAPTCHA v3 profiles the visitor — IP, mouse movement, keystroke timing,
 * device signals — and sets persistent cookies. ePrivacy Art. 5(3) requires
 * PRIOR consent for that, and legitimate interest under GDPR Art. 6 does not
 * substitute; CNIL has fined on exactly this point. Until this gate it ran at
 * Firebase init, on page load, for every visitor, before any consent existed.
 *
 * These are source-level assertions rather than a DOM harness on purpose. What
 * has to hold is a STATIC property of the code — that no path reaches the
 * reCAPTCHA provider without passing the gate first — and a behavioural test
 * that happened to load a page with consent absent would pass just as well
 * against a build where the gate had been deleted and the key removed.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "script.js"),
  "utf8"
);

/** The body of initAppCheck(), from its declaration to the next top-level
 *  function. Brace-matching rather than a regex: the body contains nested
 *  braces, and a lazy match would stop at the first one. */
function initAppCheckBody() {
  const start = SRC.indexOf("function initAppCheck() {");
  assert.notStrictEqual(start, -1, "initAppCheck() must exist");
  let depth = 0, i = SRC.indexOf("{", start);
  const from = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  assert.ok(i < SRC.length, "initAppCheck() braces must balance");
  return SRC.slice(from, i + 1);
}

test("the consent gate exists and is readable from a single named key", () => {
  assert.match(SRC, /const APPCHECK_CONSENT_KEY = "canamed_appcheck_consent";/,
    "the persisted key must be a named constant, not a scattered literal");
  assert.match(SRC, /function appCheckConsentGranted\(\)/);
  assert.match(SRC, /function grantAppCheckConsent\(\)/,
    "a future consent banner needs a documented entry point");
  assert.match(SRC, /function revokeAppCheckConsent\(\)/);
});

test("consent is granted ONLY by the exact opt-in value", () => {
  // A truthiness check would let any stale or partial value count as consent.
  assert.match(SRC, /localStorage\.getItem\(APPCHECK_CONSENT_KEY\) === "1"/,
    "must compare to the exact opt-in string, never a truthiness test");
});

test("a storage failure denies consent rather than granting it", () => {
  // Private browsing and blocked storage both throw here. The failure
  // direction has to be towards NOT profiling the visitor.
  const fn = SRC.slice(SRC.indexOf("function appCheckConsentGranted()"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.match(body, /catch[\s\S]*return false/,
    "the catch branch must return false, not true and not undefined");
});

test("initAppCheck REFUSES to reach reCAPTCHA without recorded consent", () => {
  const body = initAppCheckBody();
  const gate = body.indexOf("appCheckConsentGranted()");
  const provider = body.indexOf("ReCaptchaV3Provider");
  assert.notStrictEqual(gate, -1, "initAppCheck must consult the gate");
  assert.notStrictEqual(provider, -1, "initAppCheck must still be able to activate");
  assert.ok(gate < provider,
    "the consent check must come BEFORE the reCAPTCHA provider is constructed — " +
    "constructing it is what loads the profiling script");
  // And the gate must actually stop execution, not merely log.
  //
  // The window is deliberately NARROW: gate -> the `const siteKey` line that
  // follows the gate block. Bounding it at the provider instead looks stricter
  // but is much weaker, because the site-key and SDK guards in between contain
  // their own `return;` statements — so deleting the gate return still left a
  // match and the assertion passed. Caught by mutation-testing the deletion;
  // the wide version reported a clean pass on code that loaded reCAPTCHA
  // without consent.
  const siteKeyLine = body.indexOf("const siteKey");
  assert.ok(siteKeyLine > gate, "the gate must precede the site-key lookup");
  const gateBlock = body.slice(gate, siteKeyLine);
  assert.match(gateBlock, /return;/,
    "the gate must RETURN when consent is absent; a bare console.info would " +
    "let execution fall through and construct the provider anyway");
});

test("nothing else in the app activates App Check behind the gate", () => {
  // A second call site that skipped initAppCheck() would reintroduce the
  // pre-consent load without touching any of the code above.
  const providers = SRC.split("ReCaptchaV3Provider").length - 1;
  assert.strictEqual(providers, 1,
    "exactly one reCAPTCHA provider construction should exist, inside initAppCheck()");
  const activates = SRC.split(".appCheck().activate(").length - 1;
  assert.strictEqual(activates, 1, "exactly one App Check activation should exist");
});

test("grantAppCheckConsent activates immediately, so no reload is needed", () => {
  const fn = SRC.slice(SRC.indexOf("function grantAppCheckConsent()"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.match(body, /setItem\(APPCHECK_CONSENT_KEY, "1"\)/);
  assert.match(body, /initAppCheck\(\)/,
    "granting must take effect in the current page, not only on next load");
});

test("the reasoning is recorded next to the gate, not only in a commit", () => {
  // This block is why a future reader does not 'fix' the fact that App Check
  // never activates. Losing it is how the gate gets deleted as dead code.
  assert.match(SRC, /ePrivacy Art\. 5\(3\)/,
    "the legal basis for gating must be stated at the gate");
  assert.match(SRC, /Monitor/,
    "the reason gating is currently free — App Check is not enforcing — must be stated");
  assert.match(SRC, /ENFORCE/,
    "the Enforce hazard (no client tokens => 100% rejection) must be stated");
});
