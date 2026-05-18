/* privacy-redirect.js — back-compat redirect from the legacy per-language
 * privacy-{fr,ja}.html stubs to the consolidated privacy.html?lang=<x>.
 *
 * R3 deep-i18n: privacy.html now serves all 8 supported languages from
 * a single page (with reviewed EN/FR/JA bodies inline + lang-not-available
 * fallback banner for es/pt/de/ko/zh). The two old standalone files are
 * kept as redirect stubs so any bookmark / external link / cached search
 * result that points at them keeps landing on the right localised page.
 *
 * CSP-safe: external script under script-src 'self', no inline JS.
 * <meta http-equiv="refresh"> is the no-JS fallback inside the stub HTML.
 */
"use strict";

(function () {
  if (typeof window === "undefined") return;
  // Each stub's filename encodes the target language; read it back from
  // the URL pathname rather than hardcoding it, so a future privacy-de.html
  // / privacy-ko.html stub works without editing this script.
  let target = "en";
  try {
    const path = window.location.pathname || "";
    const m = path.match(/privacy-([a-z]{2})\.html$/i);
    if (m && m[1]) target = m[1].toLowerCase();
  } catch (e) { /* keep target = "en" */ }
  const dest = "privacy.html?lang=" + encodeURIComponent(target);
  try {
    window.location.replace(dest);
  } catch (e) {
    window.location.href = dest;
  }
})();
