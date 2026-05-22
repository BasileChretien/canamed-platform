/* docs-page.js — tiny shared behaviour for the standalone doc pages.
 *
 * EXTERNAL script on purpose: the production CSP is `script-src 'self'` (no
 * 'unsafe-inline'), so inline onclick handlers are blocked. This wires any
 * [data-print] button to window.print() without inline JS. */
(function () {
  "use strict";
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-print]");
    if (btn) { e.preventDefault(); try { window.print(); } catch (_) {} }
  });
})();
