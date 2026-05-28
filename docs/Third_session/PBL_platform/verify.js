/* verify.js — CaNaMED public certificate verification (PIS v2 §18).
 *
 * The verifier enters the ID printed on the certificate AND the name on it.
 * We read the credential by exact ID (rule: .read true on /credentials/$id,
 * .read false on the parent — so the registry can NOT be listed), hash the
 * verifier's typed name + session, and confirm a match. We never publish the
 * name; only "valid" / "no match" / "not found" is returned.
 *
 * CSP-safe: external script, no inline handlers, no eval, no innerHTML of
 * untrusted input. Pure-utils provides credentialNameHash() and normalizeName().
 * A `window._test_verifyCredentials` hook lets the e2e suite drive the page
 * without a real Firebase backend.
 */
(function () {
  "use strict";
  var ID_RE = /^CNM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

  function $(id) { return document.getElementById(id); }
  function t(key, fb) {
    if (typeof window.t === "function") { var v = window.t(key); if (v && v !== key) return v; }
    return fb;
  }

  var _dbReady = false;
  function initFirebase() {
    try {
      if (typeof firebase === "undefined") return false;
      if (!window.CANAMED_FIREBASE) return false;  // LOCAL mode → no real DB
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.CANAMED_FIREBASE);
      firebase.database();
      _dbReady = true;
      return true;
    } catch (e) { console.warn("verify: firebase init failed", e); return false; }
  }

  function show(kind, msg) {
    var r = $("verify-result");
    if (!r) return;
    r.className = "verify-result verify-" + kind;
    r.textContent = msg;
  }

  function lookupCredential(id) {
    // Test seam for e2e: when window._test_verifyCredentials is defined it is
    // the authoritative source — a hit returns the entry, a miss returns null
    // (i.e. an empty map means "no credentials exist", surfaced as "not found").
    if (window._test_verifyCredentials) {
      return Promise.resolve(window._test_verifyCredentials[id] || null);
    }
    if (!_dbReady) return Promise.reject(new Error("verify: firebase unavailable"));
    return firebase.database().ref("credentials/" + id).get().then(function (snap) {
      return snap.exists() ? snap.val() : null;
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    var id = (($("verify-id").value || "").trim().toUpperCase());
    var name = $("verify-name").value || "";
    if (!id || !name.trim()) {
      show("error", t("verify.required",
        "Please enter both the Verification ID and the name on the certificate."));
      return;
    }
    if (!ID_RE.test(id)) {
      show("invalid", t("verify.bad-format",
        "That doesn't look like a CaNaMED verification ID (expected CNM-XXXXX-XXXXX)."));
      return;
    }
    show("checking", t("verify.checking", "Checking…"));
    lookupCredential(id).then(function (cred) {
      if (!cred) {
        show("invalid", t("verify.not-found",
          "No CaNaMED certificate with that Verification ID."));
        return null;
      }
      return window.credentialNameHash(name, cred.session || "").then(function (hash) {
        if (hash === cred.nameHash) {
          var when = cred.at ? new Date(cred.at).toLocaleDateString() : "";
          var lbl  = cred.sessionLabel ? (" — " + cred.sessionLabel) : "";
          show("valid",
            t("verify.valid", "✓ Valid: this is a real CaNaMED certificate") +
            " (" + (cred.session || "") + lbl + (when ? " · " + when : "") + ")"
          );
        } else {
          show("invalid", t("verify.no-match",
            "The name you entered does not match the certificate with that ID."));
        }
      });
    }).catch(function (err) {
      console.warn("verify lookup failed", err);
      show("error", t("verify.unavailable",
        "Verification is temporarily unavailable. Please try again later."));
    });
  }

  function init() {
    initFirebase();
    var form = $("verify-form");
    var idEl = $("verify-id");
    if (idEl) {
      try {
        var p = new URLSearchParams(location.search);
        var qid = (p.get("id") || "").trim().toUpperCase();
        if (qid && ID_RE.test(qid)) idEl.value = qid;
      } catch (e) { /* ignore — pre-fill is best-effort */ }
    }
    if (form) form.addEventListener("submit", onSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
