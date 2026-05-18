/* CaNaMED platform — health check page logic.
 *
 * Runs six independent checks. Each check is wrapped in try/catch and
 * resolves to one of: "pass", "fail", "warn". A failed check NEVER throws
 * out of its handler — the page must keep rendering the other rows even
 * if Firebase is wholly broken.
 *
 * No build step. Plain ES2018 so it parses in any current browser.
 * Loaded with a normal <script> tag from healthcheck.html.
 */
(function () {
  "use strict";

  // ----- result-state machine -----------------------------------------
  var STATES = {
    pending: { text: "...", cls: "hc-pill-pending" },
    pass:    { text: "PASS", cls: "hc-pill-pass" },
    fail:    { text: "FAIL", cls: "hc-pill-fail" },
    warn:    { text: "WARN", cls: "hc-pill-warn" }
  };

  var CHECK_LABELS = {
    "page-loaded":      "HTTPS load + brand mark renders",
    "local-storage":    "localStorage write/read/delete",
    "session-storage":  "sessionStorage write/read/delete",
    "firebase-config":  "Firebase config loaded",
    "firebase-db":      "Firebase Realtime DB reachable",
    "app-check":        "App Check provider available"
  };

  var lastResults = {};

  // ----- DOM helpers --------------------------------------------------
  function setPill(checkId, state, detail) {
    try {
      var row = document.querySelector(
        '.hc-row[data-check="' + checkId + '"]'
      );
      if (!row) return;
      var pill = row.querySelector("[data-pill]");
      if (!pill) return;
      var s = STATES[state] || STATES.pending;
      pill.className = "hc-pill " + s.cls;
      pill.textContent = s.text;
      if (detail) {
        pill.setAttribute("title", String(detail));
      } else {
        pill.removeAttribute("title");
      }
      lastResults[checkId] = { state: state, detail: detail || "" };
    } catch (_) {
      // never let DOM updates throw — they're cosmetic
    }
  }

  function setAllPending() {
    Object.keys(CHECK_LABELS).forEach(function (id) {
      setPill(id, "pending");
    });
  }

  // ----- individual checks --------------------------------------------

  // 1. The page rendered. If this file is executing, the host served
  //    the bundle, the CSP didn't block our script, and the DOM parsed.
  function checkPageLoaded() {
    try {
      var hasBrandSvg = !!document.querySelector(".brand-mark");
      var isSecure =
        location.protocol === "https:" || location.hostname === "localhost";
      if (!hasBrandSvg) {
        return { state: "warn", detail: "brand mark SVG missing" };
      }
      if (!isSecure) {
        return {
          state: "warn",
          detail: "page is not on HTTPS (or localhost)"
        };
      }
      return { state: "pass", detail: "page served + DOM parsed" };
    } catch (e) {
      return { state: "fail", detail: errMsg(e) };
    }
  }

  // 2. localStorage round-trip.
  function checkLocalStorage() {
    var key = "__canamed_hc_ls__";
    try {
      if (typeof localStorage === "undefined") {
        return { state: "fail", detail: "localStorage is undefined" };
      }
      var token = "hc-" + Date.now();
      localStorage.setItem(key, token);
      var back = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (back !== token) {
        return { state: "fail", detail: "read-back mismatch" };
      }
      return { state: "pass", detail: "round-trip OK" };
    } catch (e) {
      try { localStorage.removeItem(key); } catch (_) {}
      return { state: "fail", detail: errMsg(e) };
    }
  }

  // 3. sessionStorage round-trip.
  function checkSessionStorage() {
    var key = "__canamed_hc_ss__";
    try {
      if (typeof sessionStorage === "undefined") {
        return { state: "fail", detail: "sessionStorage is undefined" };
      }
      var token = "hc-" + Date.now();
      sessionStorage.setItem(key, token);
      var back = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      if (back !== token) {
        return { state: "fail", detail: "read-back mismatch" };
      }
      return { state: "pass", detail: "round-trip OK" };
    } catch (e) {
      try { sessionStorage.removeItem(key); } catch (_) {}
      return { state: "fail", detail: errMsg(e) };
    }
  }

  // 4. firebase-config.js loaded the credentials block.
  function checkFirebaseConfig() {
    try {
      var cfg = window.CANAMED_FIREBASE;
      if (cfg === null || cfg === undefined) {
        return {
          state: "warn",
          detail: "CANAMED_FIREBASE is null — local-test mode"
        };
      }
      if (typeof cfg !== "object") {
        return { state: "fail", detail: "CANAMED_FIREBASE is not an object" };
      }
      var missing = [];
      ["apiKey", "authDomain", "databaseURL", "projectId"].forEach(function (k) {
        if (!cfg[k] || typeof cfg[k] !== "string") missing.push(k);
      });
      if (missing.length) {
        return {
          state: "fail",
          detail: "missing keys: " + missing.join(", ")
        };
      }
      return { state: "pass", detail: "projectId=" + cfg.projectId };
    } catch (e) {
      return { state: "fail", detail: errMsg(e) };
    }
  }

  // 5. Firebase RTDB reachable. Lazy-loads the SDK (so the page renders
  //    instantly even if gstatic is slow / blocked), then watches
  //    /.info/connected for up to 5 s.
  function checkFirebaseDb() {
    return new Promise(function (resolve) {
      var cfg = window.CANAMED_FIREBASE;
      if (!cfg || typeof cfg !== "object" || !cfg.databaseURL) {
        resolve({
          state: "warn",
          detail: "skipped — no Firebase config"
        });
        return;
      }
      var settled = false;
      function done(state, detail) {
        if (settled) return;
        settled = true;
        resolve({ state: state, detail: detail });
      }
      var timeout = setTimeout(function () {
        done("fail", "no /.info/connected reply within 5s");
      }, 5000);

      loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js")
        .then(function () {
          return loadScript(
            "https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js"
          );
        })
        .then(function () {
          try {
            var fb = window.firebase;
            if (!fb || !fb.initializeApp) {
              throw new Error("firebase SDK not present on window");
            }
            var appName = "__canamed_hc__";
            var app;
            try {
              app = fb.app(appName);
            } catch (_) {
              app = fb.initializeApp(cfg, appName);
            }
            var db = fb.database(app);
            var ref = db.ref(".info/connected");
            ref.on(
              "value",
              function (snap) {
                try {
                  if (snap && snap.val() === true) {
                    clearTimeout(timeout);
                    ref.off();
                    done("pass", "/.info/connected = true");
                  }
                } catch (e) {
                  clearTimeout(timeout);
                  done("fail", errMsg(e));
                }
              },
              function (err) {
                clearTimeout(timeout);
                done("fail", errMsg(err));
              }
            );
          } catch (e) {
            clearTimeout(timeout);
            done("fail", errMsg(e));
          }
        })
        .catch(function (e) {
          clearTimeout(timeout);
          done("fail", "SDK load failed: " + errMsg(e));
        });
    });
  }

  // 6. App Check / reCAPTCHA site key set.
  function checkAppCheck() {
    try {
      var key = window.CANAMED_RECAPTCHA_SITE_KEY;
      if (key === null || key === undefined || key === "") {
        return {
          state: "warn",
          detail: "RECAPTCHA_SITE_KEY is null — App Check disabled"
        };
      }
      if (typeof key !== "string") {
        return {
          state: "fail",
          detail: "RECAPTCHA_SITE_KEY is not a string"
        };
      }
      // reCAPTCHA v3 site keys are 40 chars, start "6L"
      if (!/^6L[A-Za-z0-9_-]{30,}$/.test(key)) {
        return {
          state: "warn",
          detail: "site key shape looks unusual (expected 6L… ~40 chars)"
        };
      }
      return {
        state: "pass",
        detail: "site key present (" + key.slice(0, 6) + "...)"
      };
    } catch (e) {
      return { state: "fail", detail: errMsg(e) };
    }
  }

  // ----- utilities ----------------------------------------------------
  var scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve, reject) {
      try {
        var s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("failed: " + src)); };
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
    return scriptCache[src];
  }

  function errMsg(e) {
    if (!e) return "unknown error";
    if (typeof e === "string") return e;
    if (e.message) return e.message;
    try { return String(e); } catch (_) { return "unknown error"; }
  }

  function applySync(checkId, syncFn) {
    setPill(checkId, "pending");
    try {
      var r = syncFn();
      setPill(checkId, r.state, r.detail);
    } catch (e) {
      setPill(checkId, "fail", errMsg(e));
    }
  }

  function applyAsync(checkId, asyncFn) {
    setPill(checkId, "pending");
    Promise.resolve()
      .then(asyncFn)
      .then(function (r) {
        setPill(checkId, r.state, r.detail);
      })
      .catch(function (e) {
        setPill(checkId, "fail", errMsg(e));
      });
  }

  // ----- run all ------------------------------------------------------
  function runAll() {
    setAllPending();
    applySync("page-loaded",     checkPageLoaded);
    applySync("local-storage",   checkLocalStorage);
    applySync("session-storage", checkSessionStorage);
    applySync("firebase-config", checkFirebaseConfig);
    applySync("app-check",       checkAppCheck);
    applyAsync("firebase-db",    checkFirebaseDb);
  }

  // ----- report builder + clipboard ----------------------------------
  function buildReport() {
    var lines = [];
    lines.push("CaNaMED health-check report");
    lines.push("Generated: " + new Date().toISOString());
    try { lines.push("Page:      " + location.href); } catch (_) {}
    try { lines.push("User-Agent: " + navigator.userAgent); } catch (_) {}
    lines.push("");
    Object.keys(CHECK_LABELS).forEach(function (id) {
      var r = lastResults[id] || { state: "pending", detail: "" };
      var tag = (r.state || "pending").toUpperCase();
      var label = CHECK_LABELS[id];
      var detail = r.detail ? "  — " + r.detail : "";
      lines.push("[" + tag + "] " + label + detail);
    });
    return lines.join("\n");
  }

  function copyReport() {
    var text = buildReport();
    var status = document.getElementById("hc-copy-status");
    function ok() {
      if (status) status.textContent = "Copied to clipboard.";
    }
    function fail(msg) {
      if (status) status.textContent = "Copy failed: " + msg;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function (e) {
          legacyCopy(text, ok, fail);
        });
        return;
      }
      legacyCopy(text, ok, fail);
    } catch (e) {
      legacyCopy(text, ok, fail);
    }
  }

  function legacyCopy(text, onOk, onFail) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var success = document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      if (success) onOk(); else onFail("execCommand returned false");
    } catch (e) {
      onFail(errMsg(e));
    }
  }

  // ----- bootstrap ----------------------------------------------------
  function bootstrap() {
    try {
      var rerun = document.getElementById("hc-rerun");
      if (rerun) rerun.addEventListener("click", runAll);
      var copy = document.getElementById("hc-copy");
      if (copy) copy.addEventListener("click", copyReport);
    } catch (_) {}
    runAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
