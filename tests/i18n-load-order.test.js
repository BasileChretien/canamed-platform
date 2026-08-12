"use strict";
/* tests/i18n-load-order.test.js
 *
 * i18n.js applies translations the moment it EXECUTES: its init() only defers
 * to DOMContentLoaded when `document.readyState === "loading"`, and for a
 * deferred script that is already false ("interactive"), so the branch never
 * fires. Deferred scripts run in document order, so whatever i18n.js needs must
 * be loaded BEFORE it in the HTML.
 *
 * t() substitutes {cohortPair} through window.buildCohortPair +
 * window.applyTemplate, both defined by lib.js. index.html loaded lib.js AFTER
 * i18n.js, so the substitution silently no-opped — t() falls back to the raw
 * template rather than throwing — and the literal text "{cohortPair}" was baked
 * into the waiting-room paragraph shown to every student:
 *
 *     "A facilitator will place you in a mixed {cohortPair} room…"
 *
 * It rendered on every load, in every language, and no test caught it because
 * the unit suite calls t() directly (where lib.js is already required) rather
 * than through the real script order. Found by a live test on 2026-08-12.
 *
 * Re-running applyI18n() after lib.js lands is NOT the fix: it rewrites
 * innerHTML and wipes the participant's name out of #waiting-name, which
 * script.js injected earlier. Load order is the fix.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");

/* Keys whose English template carries a placeholder that only lib.js can
   resolve. Derived from i18n.js so a new one is covered automatically. */
function substitutingKeys() {
  const keys = new Set();
  const re = /"([A-Za-z0-9._-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(I18N))) {
    if (m[2].includes("{cohortPair}")) keys.add(m[1]);
  }
  return keys;
}

function scriptOrder(html, file) {
  const at = src => {
    const i = html.search(new RegExp('<script[^>]+src="/?' + src.replace(".", "\\.") + '\\?'));
    return i;
  };
  return { i18n: at("i18n.js"), lib: at("lib.js"), file };
}

const KEYS = substitutingKeys();

test("i18n.js declares at least one lib-substituted key (guard is not vacuous)", () => {
  assert.ok(KEYS.size >= 1, "expected {cohortPair} templates in i18n.js");
  assert.ok(KEYS.has("waiting.body"),
    "waiting.body is the string that shipped broken — it must stay covered");
});

/* Every page that translates a placeholder-bearing key must load lib.js first.
   Pages that load i18n.js but use none of those keys (privacy.html,
   verify.html) are deliberately NOT forced to ship lib.js they do not need. */
for (const file of fs.readdirSync(P).filter(f => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(P, file), "utf8");
  const order = scriptOrder(html, file);
  if (order.i18n < 0) continue;                       // page has no i18n
  const usesKey = [...KEYS].some(k =>
    html.includes('data-i18n="' + k + '"') || html.includes('data-i18n-html="' + k + '"'));
  if (!usesKey) continue;

  test(`${file}: lib.js loads BEFORE i18n.js (placeholder substitution)`, () => {
    assert.ok(order.lib >= 0,
      `${file} renders a {cohortPair} key but never loads lib.js — the ` +
      "placeholder would render raw, permanently");
    assert.ok(order.lib < order.i18n,
      `${file} must load lib.js before i18n.js: i18n applies translations at ` +
      "execution time, so buildCohortPair/applyTemplate must already exist");
  });

  test(`${file}: both scripts stay deferred (defer is what orders them)`, () => {
    // Without defer on BOTH, document order no longer implies execution order.
    for (const src of ["lib.js", "i18n.js"]) {
      const m = html.match(new RegExp('<script[^>]+src="/?' + src.replace(".", "\\.") + '\\?[^"]*"[^>]*>'));
      assert.ok(m, `${file}: could not find the ${src} tag`);
      assert.match(m[0], /\sdefer\b/, `${file}: ${src} must stay deferred`);
    }
  });
}
