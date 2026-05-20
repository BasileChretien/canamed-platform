/* tests/dompurify.test.js
 *
 * Defense-in-depth: pin the DOMPurify XSS hardening of the i18n layer.
 *
 * docs/Third_session/PBL_platform/i18n.js renders translation strings into
 * innerHTML for nodes carrying data-i18n-html (legitimate strings contain
 * <strong>/<em>/<br>/<a href> and lang= attrs). That is an XSS sink the
 * moment a CMS or remote feed supplies a string, so every such write is now
 * routed through DOMPurify.sanitize with a tag/attr allowlist. DOMPurify is
 * vendored locally (purify.min.js) because the site CSP is
 * `script-src 'self'` with NO unsafe-inline — a CDN copy would be blocked.
 *
 * We have no DOM here (those flows are Playwright's job), so these are
 * static, file-as-text assertions in the style of the other tests/*.test.js:
 *
 *   1. purify.min.js exists, is a real (non-stub) library: > 5000 bytes and
 *      contains the "DOMPurify" marker.
 *   2. index.html loads purify.min.js BEFORE i18n.js (so window.DOMPurify is
 *      defined by the time i18n's data-i18n-html sinks run).
 *   3. i18n.js routes the data-i18n-html innerHTML path through
 *      DOMPurify.sanitize with an ALLOWED_TAGS allowlist, and fails closed.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const PURIFY = path.join(PLATFORM, "purify.min.js");
const INDEX_HTML = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const PRIVACY_HTML = fs.readFileSync(path.join(PLATFORM, "privacy.html"), "utf8");
const I18N_JS = fs.readFileSync(path.join(PLATFORM, "i18n.js"), "utf8");

// ============================================================
// 1 — purify.min.js is the real, vendored library
// ============================================================

test("purify.min.js exists in the platform dir", () => {
  assert.ok(fs.existsSync(PURIFY),
    "docs/Third_session/PBL_platform/purify.min.js must be vendored locally (CSP forbids a CDN copy)");
});

test("purify.min.js is a real library, not a hand-written stub (> 5000 bytes)", () => {
  const bytes = fs.statSync(PURIFY).size;
  assert.ok(bytes > 5000,
    "purify.min.js is suspiciously small (" + bytes + " bytes) — the real minified DOMPurify is tens of KB");
});

test("purify.min.js contains the DOMPurify marker", () => {
  const src = fs.readFileSync(PURIFY, "utf8");
  assert.ok(src.includes("DOMPurify"),
    "purify.min.js must contain the string 'DOMPurify' (proves it is the real library)");
});

// ============================================================
// 2 — index.html loads purify BEFORE i18n
// ============================================================

test("index.html references purify.min.js with a cache-bust ?v= token", () => {
  assert.match(INDEX_HTML, /<script[^>]*src="purify\.min\.js\?v=[^"]+"/,
    "index.html must load purify.min.js with the same ?v= cache-bust scheme as the other local scripts");
});

test("index.html loads purify.min.js BEFORE i18n.js", () => {
  // Both are <script src="...?v=..."> tags; DOMPurify must be defined before
  // i18n.js runs so the data-i18n-html sinks can sanitise. Compare the byte
  // offset of each tag in the document (regex is CRLF-agnostic).
  const purifyIdx = INDEX_HTML.search(/<script[^>]*src="purify\.min\.js\?v=/);
  const i18nIdx = INDEX_HTML.search(/<script[^>]*src="i18n\.js\?v=/);
  assert.ok(purifyIdx >= 0, "purify.min.js <script> tag not found in index.html");
  assert.ok(i18nIdx >= 0, "i18n.js <script> tag not found in index.html");
  assert.ok(purifyIdx < i18nIdx,
    "purify.min.js must appear BEFORE i18n.js in index.html (load order = run order for deferred scripts)");
});

test("privacy.html loads purify.min.js BEFORE i18n.js", () => {
  // privacy.html carries a data-i18n-html banner (privacy.lang-not-available,
  // which contains <a href> links). Without DOMPurify loaded first, the
  // fail-closed helper would blank that legitimate banner. Pin the order.
  const purifyIdx = PRIVACY_HTML.search(/<script[^>]*src="purify\.min\.js/);
  const i18nIdx = PRIVACY_HTML.search(/<script[^>]*src="i18n\.js/);
  assert.ok(purifyIdx >= 0, "purify.min.js <script> tag not found in privacy.html");
  assert.ok(i18nIdx >= 0, "i18n.js <script> tag not found in privacy.html");
  assert.ok(purifyIdx < i18nIdx,
    "purify.min.js must appear BEFORE i18n.js in privacy.html (its lang-not-available banner is a data-i18n-html sink)");
});

// ============================================================
// 3 — i18n.js routes data-i18n-html innerHTML through DOMPurify
// ============================================================

test("i18n.js calls DOMPurify.sanitize for the data-i18n-html path", () => {
  assert.match(I18N_JS, /window\.DOMPurify\.sanitize\(/,
    "i18n.js must route the data-i18n-html innerHTML write through window.DOMPurify.sanitize");
});

test("i18n.js sanitize uses an ALLOWED_TAGS allowlist", () => {
  assert.match(I18N_JS, /ALLOWED_TAGS\s*:\s*\[/,
    "i18n.js DOMPurify.sanitize must pass an ALLOWED_TAGS allowlist (not the permissive default)");
  // The legitimate privacy/legal markup uses these inline tags — they must
  // be on the allowlist or the existing strings would render unstyled/broken.
  for (const tag of ["strong", "em", "br", "a"]) {
    assert.ok(new RegExp('ALLOWED_TAGS[\\s\\S]{0,120}"' + tag + '"').test(I18N_JS),
      "ALLOWED_TAGS must include \"" + tag + "\" so existing legitimate markup still renders");
  }
});

test("i18n.js sanitize allows the href/target/rel/lang attributes", () => {
  assert.match(I18N_JS, /ALLOWED_ATTR\s*:\s*\[/,
    "i18n.js DOMPurify.sanitize must pass an ALLOWED_ATTR allowlist");
  for (const attr of ["href", "target", "rel", "lang"]) {
    assert.ok(new RegExp('ALLOWED_ATTR[\\s\\S]{0,80}"' + attr + '"').test(I18N_JS),
      "ALLOWED_ATTR must include \"" + attr + "\" (used by the privacy links and FR/JA lang= phrases)");
  }
});

test("i18n.js no longer writes raw t(...) into innerHTML for data-i18n-html", () => {
  // Both former sinks must be gone: `node.innerHTML = value` and
  // `node.innerHTML = t(key)` are replaced by the sanitising helper.
  assert.ok(!/node\.innerHTML\s*=\s*value\b/.test(I18N_JS),
    "the data-i18n flag-form sink must not assign raw `value` to innerHTML");
  assert.ok(!/node\.innerHTML\s*=\s*t\(key\)/.test(I18N_JS),
    "the data-i18n-html key-form sink must not assign raw `t(key)` to innerHTML");
});

test("i18n.js fails closed (writes \"\") when DOMPurify is absent", () => {
  // If DOMPurify somehow did not load, the helper must write the empty
  // string rather than the raw (unsanitised) translation string. Pin this
  // so a future refactor can't quietly re-introduce a raw-innerHTML fallback.
  const helper = I18N_JS.match(/function _setHTML\(node, html\)[\s\S]{0,1600}?\n  \}/);
  assert.ok(helper, "i18n.js must define a _setHTML(node, html) sanitising helper");
  assert.ok(/window\.DOMPurify/.test(helper[0]),
    "_setHTML must guard on window.DOMPurify being present");
  // Fail closed: when DOMPurify is absent the helper writes "" (never the raw,
  // unsanitised string). Accept either the legacy ternary (`: ""`) or the
  // current guard-clause form (`innerHTML = "";`). Pin this so a future
  // refactor can't quietly re-introduce a raw-innerHTML fallback.
  assert.ok(/innerHTML\s*=\s*""|:\s*""/.test(helper[0]),
    "_setHTML must fall back to \"\" (never raw innerHTML) when DOMPurify is missing");
});
