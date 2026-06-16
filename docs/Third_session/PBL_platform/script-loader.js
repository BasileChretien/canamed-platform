/* script-loader.js — bundle splitter for CaNaMED platform.
 *
 * Strategy: keep the splash boot lean by deferring heavy sibling scripts
 * (case-content, qrcode, tour, scenario-author) until they're actually
 * needed.
 *
 * Initial-load bundle (sent on splash GET /):
 *   - theme-init.js               (synchronous; 1.6 KB — needs to run pre-paint)
 *   - Firebase SDK (CDN)
 *   - firebase-config.js, platform-config.js, telemetry.js
 *   - i18n.js, localdb.js, lib.js
 *   - script.js                   (deferred — boot, splash, auth, session lifecycle)
 *
 * Lazy-loaded:
 *   - case-content.js             (loaded BEFORE a session is joined or admin enters)
 *   - qrcode.js                   (loaded when an admin enters the dashboard)
 *   - tour.js                     (loaded after splash is interactive, idle window)
 *   - scenario-author.js          (loaded when scenario-author form opens)
 *
 * Previously planned but dropped (R2-01 — SIMULATION_ROUND2.md):
 *   - script-room.js / script-admin.js were empty placeholder files paired
 *     with ensureRoomRuntime() / ensureAdminRuntime() helpers. The intended
 *     migration of room-/admin-only code out of script.js never landed
 *     because the shared mutable state (`pool`, `allRooms`, `roomStage`, …)
 *     made the extraction invasive. The placeholders + their loader entries
 *     were removed to cut a redundant HTTP round-trip per join and reduce
 *     maintenance burden. Re-introducing them is fine if/when the actual
 *     extraction PR is ready — see ARCHITECTURE/script-js-map.md.
 *
 * Globals exposed by this file (under window.CanamedLoader):
 *   loadScript(src)               → Promise<void>, idempotent (de-duped by src)
 *   ensureCaseContent()           → Promise<void>
 *   ensureQrcode()                → Promise<void>
 *   ensureTour()                  → Promise<void>
 *   ensureScenarioAuthor()        → Promise<void>
 *
 * Cleanliness invariants:
 *   - Each script loads at most once, even under concurrent ensure*() calls
 *     (the in-flight Promise is cached and re-used).
 *   - Order matters for case-content: it MUST resolve before any code that
 *     touches the CASE / SCORING / DECISIONS / PENALTIES globals runs. The
 *     boot path calls ensureCaseContent() before populating scenario pickers
 *     and before joinParticipant() actually writes to the pool.
 *   - All loaded scripts use type="text/javascript" (classic), NOT module —
 *     classic scripts share the global script-scope so the existing
 *     function/let/const declarations remain reachable cross-file. (Modules
 *     would isolate scopes and break the platform.)
 *   - Append to <head> with `async`-style insertion (no defer needed since
 *     we await readiness via the load event).
 *
 * CSP: script-src 'self' permits these injections. No nonces required.
 */

(function () {
  "use strict";

  /** @type {Map<string, Promise<void>>} */
  const inflight = new Map();

  function loadScript(src) {
    if (inflight.has(src)) return inflight.get(src);
    const p = new Promise((resolve, reject) => {
      // If a script tag for this src already exists (e.g. HTML wrote it
      // synchronously), assume it loaded. The lazy path is then a no-op.
      const existing = document.querySelector(
        'script[src="' + src.replace(/"/g, '\\"') + '"]'
      );
      if (existing && (/** @type {any} */ (existing)).dataset.loaded === "1") {
        return resolve();
      }
      const tag = document.createElement("script");
      tag.src = src;
      // Don't set async/defer here — appendChild to <head> on an idle page
      // is treated as a parser-inserted script with default ordering, which
      // is fine because each lazy chunk is independent of the others.
      tag.addEventListener("load", () => {
        tag.dataset.loaded = "1";
        resolve();
      });
      tag.addEventListener("error", (e) => {
        // Surface load failures in telemetry so a CDN outage / 404 doesn't
        // produce a silent dead page.
        try {
          if (window.CanamedTelemetry && window.CanamedTelemetry.record) {
            window.CanamedTelemetry.record("lazy-script-error", { src });
          }
        } catch (_) { /* telemetry might not be loaded yet */ }
        reject(new Error("Failed to load script: " + src));
      });
      document.head.appendChild(tag);
    });
    inflight.set(src, p);
    return p;
  }

  // Convenience wrappers for the individual chunks. The names match the
  // contract documented in ARCHITECTURE/script-js-map.md so future devs
  // searching for "where is the X bundle loaded" find both ends.
  //
  // Cache-busting (E28 — SIMULATION_EDGE_CASES.md): each lazy chunk URL
  // carries the same SHELL_VERSION suffix as the eager scripts in
  // index.html, so a deploy that bumps the version forces every chunk
  // to be re-fetched. The constant must be updated in lockstep with the
  // ?v= strings in index.html AND sw.js SHELL_VERSION.
  var SHELL_VERSION = "v50";
  function v(src) { return src + "?v=" + SHELL_VERSION; }
  function ensureCaseContent() { return loadScript(v("case-content.js")); }
  function ensureQrcode()      { return loadScript(v("qrcode.js")); }
  function ensureTour()        { return loadScript(v("tour.js")); }
  function ensureScenarioAuthor() { return loadScript(v("scenario-author.js")); }
  // glossary.js (clinical term tooltips) — only used in Module A/B, never on
  // the splash, so it is lazy. Idempotent; the consumer
  // (_annotateButtonWithGlossary) no-ops gracefully until window.CANAMED_GLOSSARY
  // exists and re-annotates on the next button render.
  function ensureGlossary()    { return loadScript(v("glossary.js")); }
  // admin-tools.js — facilitator/decision-maker reports (accreditation
  // evidence, research export, attestations, program rollup). Lazy: only an
  // admin who opens the dashboard needs it, never the student splash.
  function ensureAdminTools() { return loadScript(v("admin-tools.js")); }
  // pdfmake — client-side PDF, ~2.2 MB, only needed when a participant
  // downloads a PDF at wrap-up. Lazy, and deliberately NOT version-suffixed:
  // the vendored bundle is immutable, so the browser caches it across deploys
  // (a ?v= bump would force a pointless 2 MB re-download). vfs_fonts.js MUST
  // load after pdfmake.min.js (it assigns window.pdfMake.vfs).
  function ensurePdfmake() {
    return loadScript("pdfmake.min.js").then(function () { return loadScript("vfs_fonts.js"); });
  }
  // student-pdf.js — our certificate + study-booklet generators. Version-
  // suffixed (it changes with deploys). Caller must ensurePdfmake() first.
  function ensureStudentPdf() { return loadScript(v("student-pdf.js")); }

  // Module A LLM-patient pilot scripts (2026-05-28). LAZY-SPLIT out of the
  // eager splash bundle (2026-06-01) to reclaim critical-path JS: the four
  // files are gated behind ?llm=1 and are dead weight for the ~all non-pilot
  // users. startRoom() calls ensureModALlm() only when modALLMFlagOn() — so a
  // normal student never fetches them.
  //
  // The ?llm flag itself, however, MUST be resolved EAGERLY on first page-load:
  // the join flow (splash → lobby → session → room) strips the query string
  // before startRoom() runs, so we persist ?llm=1 to localStorage now. This is
  // the same promotion modA-llm-init.js does inside its IIFE — hoisted here so
  // it still happens when that file is no longer eagerly loaded.
  // DEFAULT-ON (2026-06-02): the LLM patient chat IS Module A's history-taking
  // interface — no `?llm=1` needed any more. We now persist only the OPT-OUT
  // (`?llm=0`) to localStorage so a facilitator demo of the legacy click-button
  // workup survives the multi-step join flow; `?llm=1` clears the opt-out (back
  // to default). The server-side `MODA_LLM_ENABLED` flag + the bridge's stub
  // fallback remain the real kill-switch for the HF backend.
  try {
    var _llmParams = new URLSearchParams(location.search);
    if (window.localStorage) {
      if (_llmParams.get("llm") === "0") localStorage.setItem("canamedModALLM", "0");
      else if (_llmParams.get("llm") === "1") localStorage.removeItem("canamedModALLM");
    }
  } catch (_) { /* private mode — the URL-only check in modALLMFlagOn still works */ }
  function modALLMFlagOn() {
    try {
      var q = new URLSearchParams(location.search).get("llm");
      if (q === "0") return false;                                          // explicit opt-out
      if (q === "1") return true;                                           // explicit opt-in
      if (window.localStorage && localStorage.getItem("canamedModALLM") === "0") return false; // sticky opt-out
    } catch (_) { /* locked-down env — fall through to the default */ }
    return true;   // default ON
  }
  // The four scripts must run in document order — init wires the others:
  // scoring → prompts → bridge → init. loadScript de-dupes, so re-calls are
  // cheap; chain to preserve ordering.
  function ensureModALlm() {
    return loadScript(v("modA-question-scoring.js"))
      .then(function () { return loadScript(v("modA-llm-prompts.js")); })
      .then(function () { return loadScript(v("modA-llm-bridge.js")); })
      .then(function () { return loadScript(v("modA-llm-init.js")); });
  }

  // Public namespace. Single object so the rest of script.js can do
  // `window.CanamedLoader.ensureX()` without polluting the global namespace
  // with several free functions.
  window.CanamedLoader = {
    loadScript,
    ensureCaseContent,
    ensureQrcode,
    ensureTour,
    ensureScenarioAuthor,
    ensureGlossary,
    ensureAdminTools,
    ensurePdfmake,
    ensureStudentPdf,
    modALLMFlagOn,
    ensureModALlm
  };

  // After the splash is interactive, prefetch tour.js + case-content.js in
  // the background. By the time the user actually clicks "Enter session"
  // they're already cached. This costs nothing if the user closes the tab
  // before joining (browser cancels in-flight requests).
  function prefetchAfterIdle() {
    const fire = () => {
      ensureCaseContent().catch(() => { /* will retry on actual join */ });
      ensureTour().catch(() => { /* tour is optional */ });
      ensureGlossary().catch(() => { /* tooltips are optional, degrade gracefully */ });
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fire, { timeout: 2000 });
    } else {
      // Safari < 17 + iOS — fall back to a generous timeout.
      setTimeout(fire, 1500);
    }
  }
  // Don't start prefetching until the page has actually rendered the splash;
  // otherwise we're competing with critical render-blocking work.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    prefetchAfterIdle();
  } else {
    document.addEventListener("DOMContentLoaded", prefetchAfterIdle, { once: true });
  }
})();
