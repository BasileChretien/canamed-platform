/* sw-register.js — register the CaNaMED Service Worker after the page
 * has finished loading. Kept separate from script.js so:
 *   - SW registration runs even if the main app fails to load
 *   - CSP-friendly (no inline script needed in index.html)
 *   - One short, easily-auditable file
 *
 * Also exposes a minimal online/offline UI banner so users know when
 * a wifi blip happens and when the connection comes back.
 */

"use strict";

(function () {
  if (!("serviceWorker" in navigator)) return;

  // Auto-reload to the freshly-deployed version when an updated Service Worker
  // takes control — but ONLY when the user is still on the splash (not inside
  // an active workshop) and ONLY for a genuine update (a controller already
  // existed; never the very first install). This stops returning users from
  // being stranded on a stale cached build, without interrupting anyone
  // mid-session. The SW uses skipWaiting()+clients.claim(), so a new version
  // fires controllerchange shortly after the page loads.
  var _reloadingForUpdate = false;
  var _hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (_reloadingForUpdate || !_hadController) return;
    var splash = document.getElementById("splash");
    var onSplash = !!splash &&
      !splash.classList.contains("hidden") && splash.hidden !== true;
    if (!onSplash) return; // mid-session — don't yank the user out; they pick
                           // up the new version next time they're on the splash
    _reloadingForUpdate = true;
    window.location.reload();
  });

  // Register on window.load so the SW install doesn't race the first paint.
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js")
      .then(function (reg) {
        // Periodically check for a new SW. When one installs it activates
        // (skipWaiting) and the controllerchange handler above auto-reloads
        // the page if the user is on the splash.
        if (reg.update) {
          // Check for updates every hour; navigating/reopening also checks.
          setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
        }
      })
      .catch(function (err) {
        // SW registration is best-effort. Don't show the user — degrade silently.
        console.warn("[sw-register] registration failed:", err && err.message);
      });
  });

  // Online / offline status banner — a small visual cue so the user knows
  // their wifi blipped + recovered. Inserted into the body once on
  // first offline event; subsequent offline/online toggles just update it.
  function ensureBanner() {
    var existing = document.getElementById("canamed-offline-banner");
    if (existing) return existing;
    var b = document.createElement("div");
    b.id = "canamed-offline-banner";
    b.className = "canamed-offline-banner";
    b.setAttribute("role", "status");
    b.setAttribute("aria-live", "polite");
    b.hidden = true;
    document.body.appendChild(b);
    return b;
  }

  // Resolve the i18n translator at call-time (NOT registration-time) so
  // load-order between this file (classic, non-deferred) and i18n.js
  // (deferred) doesn't matter. We check both window.CanamedI18n.t and the
  // top-level window.t alias since i18n.js exposes both — either being
  // available is enough to localise the banner. Falls back to English if
  // neither has loaded yet (e.g. an offline event fires before the
  // deferred bundle finishes parsing on a slow connection).
  function translateBanner() {
    var fallback = "You are offline. Trying to reconnect…";
    try {
      if (window.CanamedI18n && typeof window.CanamedI18n.t === "function") {
        return window.CanamedI18n.t("offline.banner") || fallback;
      }
      if (typeof window.t === "function") {
        return window.t("offline.banner") || fallback;
      }
    } catch (_) { /* defensive: don't let an i18n bug break the banner */ }
    return fallback;
  }

  function setStatus(online) {
    var b = ensureBanner();
    if (online) {
      b.textContent = "";
      b.hidden = true;
      b.classList.remove("offline");
    } else {
      b.textContent = translateBanner();
      b.hidden = false;
      b.classList.add("offline");
    }
  }

  window.addEventListener("online",  function () { setStatus(true);  });
  window.addEventListener("offline", function () { setStatus(false); });
  // Initial state — only show banner if we're already offline at boot
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    // Defer to avoid racing the body element
    setTimeout(function () { setStatus(false); }, 0);
  }
})();
