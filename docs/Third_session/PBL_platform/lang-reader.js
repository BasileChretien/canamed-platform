/* lang-reader.js — in-page reading aid (DOM glue for reader-core.js).
 *
 * The site content is canonical English. A FR/JA (or EN) student can turn on
 * "Word help" (settings cog) and then:
 *   • DESKTOP: hover any word → a small popover shows the term + a short gloss
 *     in their chosen language.
 *   • TOUCH: tap any non-interactive word → same popover. (Taps on buttons /
 *     links / inputs are left alone so the reader never hijacks a real action;
 *     case-content reveal buttons already carry the 📖 glossary marker.)
 *
 * Everything is client-side: the lookup runs against the bundled glossary via
 * reader-core.glossAt(). No text ever leaves the device — safe even over
 * student-typed answers and the patient chat (no MT API, no sub-processor).
 *
 * Target language = the global language switcher (window.getLang()). For "en"
 * the popover shows the plain-English explanation, which is still useful for a
 * student who knows the word but not the jargon.
 *
 * Pairs with reader-core.js (pure brain, unit-tested) and the .gloss-pop /
 * .reader-pop CSS in style.css. Lazy-loaded by script-loader.ensureLangReader.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "canamed_reader";
  // Don't hijack taps that land on a real control — let the action happen.
  // Our own popovers are included so a tap on the popover never re-triggers a
  // lookup at coordinates that sit on top of it.
  var INTERACTIVE =
    "button, a[href], input, textarea, select, label, summary, " +
    "[role=button], [contenteditable], [data-no-reader], .reader-pop, .gloss-pop";

  var pop = null;
  var moveTimer = null;
  var curKey = null;      // term@start currently shown — avoids re-render flicker
  var lastX = 0;
  var lastY = 0;
  // In-memory mirror of the on/off choice, so an explicit opt-out still holds
  // for the session when localStorage is unavailable (private mode / blocked).
  var memEnabled = null;  // null = untouched this session (use the default-on)

  function core() { return window.CanamedReaderCore; }
  function glossary() { return window.CANAMED_GLOSSARY; }
  function targetLang() {
    return (typeof window.getLang === "function") ? window.getLang() : "en";
  }

  function enabled() {
    // Default ON: the reader works out of the box ("just hover any word") for
    // every student; only an explicit opt-out ("0", via the Word-help toggle)
    // turns it off. Existing visitors who never touched the toggle have no
    // flag, so they get the reader automatically.
    try { return localStorage.getItem(STORAGE_KEY) !== "0"; }
    catch (e) { return memEnabled !== false; }   // storage blocked → honour this session's choice (default ON)
  }
  function setEnabled(on) {
    on = !!on;
    memEnabled = on;   // remember the choice even if storage write fails below
    // Reader is ON by default; persist only the explicit OFF ("0"). Turning it
    // back on removes the flag (returns to the default-on state).
    try {
      if (on) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, "0");
    } catch (e) { /* private mode — memEnabled holds the choice */ }
    syncToggle(on);
    if (!on) hide();
    if (on) {
      // Pull the glossary in lazily the first time the reader is switched on.
      if (!glossary() && window.CanamedLoader && window.CanamedLoader.ensureGlossary) {
        window.CanamedLoader.ensureGlossary().catch(function () { /* degrade quietly */ });
      }
      ensureDictForLang();
    }
  }

  // Fetch the general dictionary for the current target language (fr/ja) once,
  // in the background. getDict() starts returning it as soon as it's parsed; a
  // hover before then just falls back to glossary-only. ~1.5 MB, so only ever
  // pulled when the reader is actually on.
  function ensureDictForLang() {
    var l = targetLang();
    if ((l === "fr" || l === "ja") && window.CanamedReaderDict) {
      window.CanamedReaderDict.ensureDict(l).catch(function () { /* optional */ });
    }
  }

  /* Resolve a viewport point to a { node, offset } caret inside a text node.
   * caretRangeFromPoint (Chrome/WebKit) and caretPositionFromPoint (Firefox)
   * cover the full Playwright matrix between them. */
  function caretFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r && r.startContainer && r.startContainer.nodeType === 3) {
        return { node: r.startContainer, offset: r.startOffset };
      }
      return null;
    }
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p && p.offsetNode && p.offsetNode.nodeType === 3) {
        return { node: p.offsetNode, offset: p.offset };
      }
    }
    return null;
  }

  /* Look up the gloss under a viewport point. Returns { node, hit } or null.
   * Curated clinical glossary wins; the general bundled dictionary (Phase 2)
   * is the fallback for everyday words the glossary doesn't cover. */
  function lookupAt(x, y) {
    var c = core();
    if (!c) return null;
    var caret = caretFromPoint(x, y);
    if (!caret) return null;
    var node = caret.node;
    var parent = node.parentElement;
    // Never read our own popovers or non-content nodes.
    if (parent && parent.closest &&
        parent.closest(".reader-pop, .gloss-pop, script, style, [data-no-reader]")) {
      return null;
    }
    var lang = targetLang();
    var text = node.nodeValue || "";
    var g = glossary();
    var hit = g ? c.glossAt(text, caret.offset, g, lang) : null;
    if (!hit && c.dictAt) {
      var dict = window.CanamedReaderDict && window.CanamedReaderDict.getDict(lang);
      if (dict) hit = c.dictAt(text, caret.offset, dict);
    }
    if (!hit) return null;
    return { node: node, hit: hit };
  }

  function popEl() {
    if (pop) return pop;
    pop = document.createElement("div");
    // Share the .gloss-pop look; .reader-pop lets CSS/tests target it distinctly.
    pop.className = "gloss-pop reader-pop";
    pop.setAttribute("aria-hidden", "true");   // decorative; pointer-driven
    pop.hidden = true;
    (document.body || document.documentElement).appendChild(pop);
    return pop;
  }

  function rectFor(node, start, end) {
    try {
      var r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, end);
      var rect = r.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    } catch (e) { /* detached node / bad offset — fall through */ }
    return null;
  }

  function place(p, rect) {
    if (!rect) {
      p.style.left = Math.max(6, lastX) + "px";
      p.style.top = (lastY + 14) + "px";
      return;
    }
    var pw = Math.min(p.offsetWidth || 280, window.innerWidth - 12);
    var left = Math.min(Math.max(6, rect.left), Math.max(6, window.innerWidth - pw - 6));
    var top = rect.bottom + 6;
    if (top + p.offsetHeight > window.innerHeight - 6) {
      top = Math.max(6, rect.top - p.offsetHeight - 6);   // flip above if it'd overflow
    }
    p.style.left = left + "px";
    p.style.top = top + "px";
  }

  function showHit(node, hit) {
    var p = popEl();
    p.textContent = "";
    var term = document.createElement("strong");
    term.className = "reader-term";
    term.textContent = hit.term;
    var def = document.createElement("span");
    def.className = "reader-def";
    def.textContent = hit.text;
    p.appendChild(term);
    p.appendChild(document.createTextNode(" — "));
    p.appendChild(def);
    p.hidden = false;
    place(p, rectFor(node, hit.start, hit.end));
    curKey = hit.term + "@" + hit.start;
  }

  function hide() {
    // Cancel any queued hover lookup so a disable-mid-hover can't flash the
    // popover after the 70 ms debounce fires.
    if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
    if (pop) pop.hidden = true;
    curKey = null;
  }

  // ── Pointer wiring ──────────────────────────────────────────────────────
  function onMove(e) {
    if (!enabled() || e.pointerType === "touch") return;   // hover = mouse/pen
    lastX = e.clientX;
    lastY = e.clientY;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      var res = lookupAt(lastX, lastY);
      if (res) {
        var key = res.hit.term + "@" + res.hit.start;
        if (key !== curKey) showHit(res.node, res.hit);
      } else {
        hide();
      }
    }, 70);
  }

  function onTap(e) {
    if (!enabled() || e.pointerType !== "touch") return;
    lastX = e.clientX;
    lastY = e.clientY;
    var tgt = e.target;
    if (tgt && tgt.closest && tgt.closest(INTERACTIVE)) return;   // don't hijack controls
    // A long-press selects text (copy / OS context menu). If there's an active
    // selection, the user isn't asking for a gloss — leave them alone.
    if (window.getSelection && String(window.getSelection()).trim()) return;
    var res = lookupAt(e.clientX, e.clientY);
    if (res) showHit(res.node, res.hit);
    else hide();
  }

  function onDismissPointer(e) {
    if (!pop || pop.hidden) return;
    if (e.target === pop || (pop.contains && pop.contains(e.target))) return;
    hide();
  }

  function syncToggle(on) {
    var cb = document.getElementById("reader-toggle");
    if (cb) cb.checked = !!on;
  }

  function wireToggle() {
    var cb = document.getElementById("reader-toggle");
    if (cb && !cb._readerWired) {
      cb._readerWired = true;
      cb.checked = enabled();
      cb.addEventListener("change", function () { setEnabled(cb.checked); });
    }
  }

  function init() {
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onTap, { passive: true });
    document.addEventListener("pointerdown", onDismissPointer, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    // On language change: close any open popover and, if the reader is on,
    // start loading the newly-selected language's dictionary. NB: i18n.js
    // dispatches this on `document` (non-bubbling), so we MUST listen there —
    // a `window` listener never fires, which is why switching to French never
    // loaded the FR dictionary (the default-language dict loaded on init, so
    // only that language's reader worked).
    document.addEventListener("canamed:langchange", function () {
      hide();
      if (enabled()) ensureDictForLang();
    });
    wireToggle();
    // If the user had it on from a previous visit, make sure the data is ready.
    if (enabled()) {
      if (!glossary() && window.CanamedLoader && window.CanamedLoader.ensureGlossary) {
        window.CanamedLoader.ensureGlossary().catch(function () { /* optional */ });
      }
      ensureDictForLang();
    }
  }

  window.CanamedReader = {
    isEnabled: enabled,
    setEnabled: setEnabled,
    lookupAt: lookupAt,      // exposed for E2E / debugging
    showHit: showHit,
    hide: hide
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
