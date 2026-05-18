/* theme-init.js — set the data-theme attribute on <html> before any paint.
 *
 * Loaded SYNCHRONOUSLY in <head> before stylesheet/script tags, so the page
 * never flashes the wrong palette ("FOUC") on a hard reload by a user who
 * has saved a non-auto theme. Four values are honoured:
 *
 *   localStorage.canamed_theme === "dark"          -> force dark, regardless of OS
 *   localStorage.canamed_theme === "light"         -> force light, regardless of OS
 *   localStorage.canamed_theme === "high-contrast" -> force high-contrast (WCAG-AAA-targeted)
 *   anything else / unset                          -> follow OS via prefers-color-scheme + prefers-contrast
 *
 * Lives in its own UMD-free module on purpose: the file is loaded before
 * everything else, must not depend on any other script, and must not crash
 * if localStorage is disabled (private-browsing mode, locked-down kiosks).
 *
 * The corresponding stylesheet rules are in style.css under the "DARK THEME"
 * and "HIGH-CONTRAST THEME" sections.
 */
(function () {
  "use strict";
  try {
    var t = localStorage.getItem("canamed_theme");
    if (t === "dark" || t === "light" || t === "high-contrast") {
      document.documentElement.setAttribute("data-theme", t);
    } else {
      // explicit auto: lets CSS fall through to the
      // prefers-color-scheme + prefers-contrast media queries
      document.documentElement.setAttribute("data-theme", "auto");
    }
  } catch (e) {
    // localStorage unavailable; default to auto
    document.documentElement.setAttribute("data-theme", "auto");
  }
})();
