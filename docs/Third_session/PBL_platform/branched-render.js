/* branched-render.js — LAZY in-room render helpers for the branched format.
 *
 * Split out of the eager script.js so this room-only code is NOT in the splash
 * critical-path bundle (perf budget). Loaded by script-loader's
 * ensureCaseContent() chain, so it is present before any decision renders.
 *
 * Classic script: it shares the global script scope, so tc() (the localiser)
 * and `document` are reachable directly — no imports. Exposes
 * window.CanamedBranchedRender; buildDecision() (in script.js) calls it if
 * present and degrades gracefully (no documents) if it is not yet loaded.
 *
 * This is the designated home for branched in-room render code as the OSCE
 * format grows (documents now; the final diagnosis/guidelines step next).
 */
(function (root) {
  "use strict";

  /* Only allow a same-origin, extension-whitelisted, traversal-free image path.
   * Document images come from facilitator-authored scenario content, so guard
   * against javascript:/external/absolute/.. srcs. Bundled images live under a
   * same-origin folder (e.g. scenario-images/…) and need no CSP change (img-src
   * 'self'). Returns an <img> or null. */
  function _safeScenarioImage(path) {
    if (typeof path !== "string" || !path) return null;
    if (path.indexOf("..") !== -1) return null;
    if (/^[a-z]+:/i.test(path) || path.charAt(0) === "/") return null; // no scheme, no absolute
    if (!/^[\w][\w./-]*\.(png|jpe?g|webp|svg|gif)$/i.test(path)) return null;
    const img = document.createElement("img");
    img.className = "dec-doc-img";
    img.loading = "lazy";
    img.src = path;
    return img;
  }

  /* Build the documents block for a branched node (vitals/labs/ECG/CXR/CT
   * revealed with the decision). Each doc: { title, text, image, alt } — all
   * optional, all localisable. DOM-built with textContent (never innerHTML).
   * Returns the block element or null when the node carries no documents. */
  function buildDecisionDocs(d, lang) {
    if (!d || !Array.isArray(d.documents) || !d.documents.length) return null;
    const box = document.createElement("div");
    box.className = "dec-documents";
    d.documents.forEach(doc => {
      if (!doc) return;
      const card = document.createElement("div");
      card.className = "dec-doc";
      const title = tc(doc.title, lang);
      if (title) {
        const h = document.createElement("h4");
        h.className = "dec-doc-title";
        h.textContent = title;
        card.appendChild(h);
      }
      const img = _safeScenarioImage(doc.image);
      if (img) {
        img.alt = tc(doc.alt, lang) || title || "Clinical document";
        card.appendChild(img);
      }
      const text = tc(doc.text, lang);
      if (text) {
        const p = document.createElement("p");
        p.className = "dec-doc-text";
        p.textContent = text;
        card.appendChild(p);
      }
      box.appendChild(card);
    });
    return box;
  }

  root.CanamedBranchedRender = { buildDecisionDocs, _safeScenarioImage };
})(typeof window !== "undefined" ? window : this);
