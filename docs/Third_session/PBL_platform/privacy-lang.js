/* privacy-lang.js — language switcher for the consolidated privacy.html.
 *
 * R3 deep-i18n: privacy.html now embeds the full reviewed body in three
 * `<section data-priv-lang="en|fr|ja">` blocks. This tiny script picks
 * the active section based on (in order):
 *
 *   1. URL query param ?lang=<x>   (highest priority, set by the
 *      privacy-fr.html / privacy-ja.html back-compat redirect stubs and
 *      by inbound deep links)
 *   2. localStorage.canamed_lang   (sticky UI language across the rest
 *      of the platform — set by the splash language switcher)
 *   3. <html lang> as fallback     (always "en" on first paint)
 *
 * If the resolved language has no <section data-priv-lang> block (e.g.
 * de, es, pt, ko, zh — covered by the privacy.lang-not-available banner
 * via i18n.js) the EN section is shown and the banner surfaces.
 *
 * CSP-safe: this is an external script under script-src 'self'; no inline
 * event handlers, no eval, no innerHTML of untrusted input. The text
 * inside the sections is author-controlled HTML in the same file.
 *
 * Co-exists with i18n.js (which handles data-i18n, data-i18n-html,
 * data-toggle-when-lang on the chrome around the body sections).
 */
"use strict";

(function () {
  const SUPPORTED_BODIES = ["en", "fr", "ja"];

  function readQueryLang() {
    try {
      const u = new URL(window.location.href);
      const q = u.searchParams.get("lang");
      if (q && SUPPORTED_BODIES.indexOf(q) >= 0) return q;
      // any value (including unsupported ones like 'de') is still
      // honoured for the chrome via setLang; for the body we fall
      // back to EN below.
      return q || null;
    } catch (e) { return null; }
  }

  function readStorageLang() {
    try {
      const v = localStorage.getItem("canamed_lang");
      return v || null;
    } catch (e) { return null; }
  }

  function applyPrivacyLang(lang) {
    if (typeof document === "undefined") return;
    // Pick which body section to show: prefer the requested lang if we
    // have a reviewed body for it; otherwise fall back to EN.
    const bodyLang = SUPPORTED_BODIES.indexOf(lang) >= 0 ? lang : "en";
    document.querySelectorAll("section[data-priv-lang]").forEach(s => {
      if (s.getAttribute("data-priv-lang") === bodyLang) {
        s.removeAttribute("hidden");
      } else {
        s.setAttribute("hidden", "");
      }
    });
    // Mark the active switcher link so the user sees which language
    // they're on. Visual styling is in privacy.css's .active rule.
    document.querySelectorAll("[data-priv-lang-btn]").forEach(n => {
      const active = n.getAttribute("data-priv-lang-btn") === bodyLang;
      n.classList.toggle("active", active);
      if (active) n.setAttribute("aria-current", "page");
      else n.removeAttribute("aria-current");
    });
    // Sync document.documentElement.lang for accessibility tooling
    // (screen readers honour <html lang>).
    if (document.documentElement) {
      document.documentElement.setAttribute("lang", bodyLang);
    }
  }

  function init() {
    // Resolution order documented above.
    const queryLang = readQueryLang();
    const storageLang = readStorageLang();
    const resolved = queryLang || storageLang || "en";

    // If the URL carried ?lang=<x>, persist it so the rest of the
    // platform (and a refresh of this page) picks it up. Also tell
    // i18n.js to re-apply for chrome translations.
    if (queryLang) {
      try { localStorage.setItem("canamed_lang", queryLang); } catch (e) {}
      if (typeof window.setLang === "function") {
        try { window.setLang(queryLang); } catch (e) {}
      }
    }

    applyPrivacyLang(resolved);

    // Intercept clicks on the in-page language switcher: no full
    // navigation needed (cheaper than a reload + keeps the URL clean
    // for share). Falls back to the href on JS failure.
    document.querySelectorAll("[data-priv-lang-btn]").forEach(n => {
      n.addEventListener("click", (ev) => {
        const target = n.getAttribute("data-priv-lang-btn");
        if (!target) return;
        ev.preventDefault();
        try { localStorage.setItem("canamed_lang", target); } catch (e) {}
        if (typeof window.setLang === "function") {
          try { window.setLang(target); } catch (e) {}
        }
        applyPrivacyLang(target);
        // Update the URL so a copy-link / refresh keeps the language.
        // history.replaceState is CSP-safe.
        try {
          const u = new URL(window.location.href);
          u.searchParams.set("lang", target);
          history.replaceState(null, "", u.toString());
        } catch (e) {}
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
