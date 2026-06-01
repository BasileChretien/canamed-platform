/* CaNaMED telemetry — in-browser error + CSP-violation capture.
 *
 * Sentry without Sentry. Three event sources flow into one circular
 * buffer:
 *
 *   1. window.onerror — uncaught synchronous JS errors
 *   2. window.unhandledrejection — uncaught Promise rejections
 *   3. document securitypolicyviolation — CSP block events
 *
 * The buffer is capped (50 entries; oldest evicted) and mirrored to
 * sessionStorage so a page refresh doesn't lose what happened just
 * before. Exposes window.CanamedTelemetry for the admin "Download
 * error log" button + manual inspection via DevTools.
 *
 * No remote reporting yet — adding a remote endpoint would need a
 * matching DB rule + a privacy-doc disclosure. This PR ships the
 * capture half; the upload half is a follow-up.
 *
 * Why no Sentry / Datadog / etc.: those want a paid plan for the
 * privacy-respecting EU-data-residency option that CaNaMED needs.
 * The local capture solves 90% of the "what broke for that student"
 * problem on its own — a facilitator post-mortem can download the
 * log from a fresh tab, and a future PR can add opt-in remote
 * upload if it proves useful.
 */

(function (root, factory) {
  const exp = factory();
  if (typeof window !== "undefined") {
    window.CanamedTelemetry = exp;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "canamed_telemetry_buf_v1";
  const MAX_ENTRIES = 50;

  let _wired = false;
  let _buf = [];

  function _loadFromStorage() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function _saveToStorage() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_buf.slice(-MAX_ENTRIES)));
    } catch (e) { /* quota / disabled — non-fatal */ }
  }
  function _push(entry) {
    _buf.push(entry);
    if (_buf.length > MAX_ENTRIES) _buf.splice(0, _buf.length - MAX_ENTRIES);
    _saveToStorage();
  }
  function _truncate(s, n) {
    if (s == null) return null;
    s = String(s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function record(kind, payload) {
    _push({
      kind: String(kind || "unknown"),
      at: new Date().toISOString(),
      // pathname only — never the query/fragment, which can carry a session
      // code (?code=...) or other identifiers into the downloadable log.
      url: (typeof location !== "undefined") ? location.pathname : null,
      lang: (typeof navigator !== "undefined") ? navigator.language : null,
      ua: (typeof navigator !== "undefined") ? _truncate(navigator.userAgent, 200) : null,
      payload: payload || null
    });
  }

  function init() {
    if (_wired || typeof window === "undefined") return;
    _wired = true;
    _buf = _loadFromStorage();

    // Uncaught synchronous JS errors
    window.addEventListener("error", function (ev) {
      // The "error" event fires for resource-load failures (<img>, <script>
      // failing to load) too; those have no `error` property and aren't
      // worth capturing here — they're noisy.
      if (!ev.error && !ev.message) return;
      record("error", {
        message: _truncate(ev.message, 500),
        source: _truncate(ev.filename, 200),
        line: ev.lineno || null,
        col: ev.colno || null,
        stack: ev.error ? _truncate(ev.error.stack, 2000) : null
      });
    });

    // Uncaught Promise rejections
    window.addEventListener("unhandledrejection", function (ev) {
      const r = ev.reason;
      record("unhandledrejection", {
        message: _truncate(r && r.message ? r.message : String(r), 500),
        stack: r && r.stack ? _truncate(r.stack, 2000) : null
      });
    });

    // CSP violations (also receivable server-side via the report-to
    // directive once an endpoint exists; for now we just observe locally)
    document.addEventListener("securitypolicyviolation", function (ev) {
      record("csp-violation", {
        blockedURI: _truncate(ev.blockedURI, 300),
        violatedDirective: ev.violatedDirective || null,
        effectiveDirective: ev.effectiveDirective || null,
        originalPolicy: _truncate(ev.originalPolicy, 500),
        sourceFile: _truncate(ev.sourceFile, 200),
        lineNumber: ev.lineNumber || null,
        sample: _truncate(ev.sample, 200)
      });
      // Also log to console so DevTools highlights it under "Issues"
      try {
        console.warn("[CaNaMED telemetry] CSP violation:", ev.violatedDirective,
          ev.blockedURI);
      } catch (e) {}
    });
  }

  /* Public API ---------------------------------------------- */

  function getErrors() {
    return _buf.slice();
  }
  function clear() {
    _buf = [];
    _saveToStorage();
  }
  function download() {
    try {
      const blob = new Blob(
        [JSON.stringify({ takenAt: new Date().toISOString(), entries: _buf }, null, 2)],
        { type: "application/json" }
      );
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = "canamed-error-log-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 250);
    } catch (e) {
      console.error("[CaNaMED telemetry] download failed", e);
    }
  }

  // Auto-init on script load (idempotent)
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  return { init, record, getErrors, clear, download, MAX_ENTRIES };
});
