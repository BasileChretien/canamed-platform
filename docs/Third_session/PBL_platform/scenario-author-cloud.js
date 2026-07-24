/* scenario-author-cloud.js — adds Firebase-backed save/load to the
 * standalone Scenario Authoring Tool (scenario-author.html).
 *
 * The host page (scenario-author.js) renders the editor and exposes
 * window.__scenarioAuthor with { getState, setState, toJson, fromJson,
 * validate, parseInput }. This module:
 *
 *   1. Initializes Firebase from window.CANAMED_FIREBASE (same config the
 *      main platform uses). If the config is absent or Firebase isn't
 *      loaded, the module silently no-ops — the offline editor still
 *      works exactly as before.
 *   2. Surfaces sign-in state (Google / email-password) in a small panel
 *      injected at the top of the action bar.
 *   3. Injects three new buttons next to the existing action bar:
 *        - "Save to my scenarios" → scenarios/$uid/$scenarioId
 *        - "Save & share"         → also writes sharedScenarios/$uid_$id
 *        - "Load from cloud…"     → modal picker over my+shared scenarios
 *   4. Validates the scenario before any cloud write (re-uses the in-page
 *      validate() so cloud-stored scenarios are guaranteed self-consistent).
 *
 * Security: relies on the database rules in database.rules.json. The
 * rules already enforce ownership (writes only to scenarios/$uid where
 * $uid == auth.uid) and the size cap (≤256KB bodyJson). This module
 * additionally rejects oversized blobs client-side to give a faster
 * error message.
 */
(function () {
  "use strict";

  // ---- guard rails -------------------------------------------------------
  if (typeof window === "undefined") return;
  if (!window.firebase || !window.CANAMED_FIREBASE) {
    // Standalone offline mode (no Firebase config) — leave the editor as-is.
    return;
  }

  // Initialize Firebase exactly once. The host index.html already runs
  // firebase.initializeApp() too; if the scenario-author page is opened
  // in a tab without that, we do it here. Idempotent: a second call
  // would throw with code "app/duplicate-app", which we catch.
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(window.CANAMED_FIREBASE);
    }
  } catch (e) {
    if (e && e.code !== "app/duplicate-app") {
      console.error("[scenario-author-cloud] Firebase init failed", e);
      return;
    }
  }

  var auth = firebase.auth();
  var db   = firebase.database();

  // ---- DOM helpers -------------------------------------------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        // NB: no `html` key on purpose — this helper must never set innerHTML
        // from caller data (it would be an unsanitised XSS sink). Use `text`.
        else n[k] = attrs[k];
      });
    }
    if (children) children.forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function $(id) { return document.getElementById(id); }

  // Password policy — mirrors the main app (script.js signUpWithEmail): at
  // least 8 chars and at least 3 of {lower, upper, digit, symbol}. Both paths
  // share the same Firebase Auth backend, so this one must not be weaker.
  function passwordPolicyError(pw) {
    if (typeof pw !== "string" || pw.length < 8) {
      return "use at least 8 characters.";
    }
    var classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/[0-9]/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    if (classes < 3) {
      return "mix at least 3 of: lower-case, upper-case, numbers, symbols.";
    }
    return null;
  }

  function setStatus(kind, msg) {
    var out = $("validation-output");
    if (!out) return;
    out.className = "validation-output" + (kind ? " " + kind : "");
    out.textContent = msg || "";
  }

  // ---- sign-in panel -----------------------------------------------------
  // Injected at the top of <main>, replaces nothing. Three states:
  //   signed-out: Google + Email/Password forms + "Continue without saving"
  //   signed-in:  identity chip + sign-out button
  //   busy:       spinner + status message
  function renderAuthPanel(user) {
    var host = $("scenario-author-auth");
    if (!host) return;
    host.innerHTML = "";
    var card = el("div", { class: "card scenario-auth-card" });
    if (user && !user.isAnonymous) {
      var who = user.displayName || user.email || ("user " + user.uid.slice(0, 8));
      card.appendChild(el("p", { text: "Signed in as " + who + "." }));
      var out = el("button", {
        type: "button",
        class: "secondary-btn",
        text: "Sign out"
      });
      out.addEventListener("click", function () {
        auth.signOut().then(function () { renderAuthPanel(null); });
      });
      card.appendChild(out);
    } else {
      card.appendChild(el("p", {
        text: "Sign in to save scenarios to your account or pick from shared scenarios. You can also use the editor offline and export JSON."
      }));
      var row = el("div", { class: "scenario-auth-row" });

      var google = el("button", {
        type: "button", class: "primary-btn",
        text: "Continue with Google"
      });
      google.addEventListener("click", function () {
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        setStatus("", "Opening Google sign-in…");
        auth.signInWithPopup(provider)
          .then(function () { setStatus("success", "Signed in."); })
          .catch(function (e) { setStatus("error", e.message || "Sign-in failed."); });
      });
      row.appendChild(google);

      card.appendChild(row);

      var emailForm = el("form", { class: "scenario-auth-email" });
      var emailIn = el("input", { type: "email", placeholder: "Email", required: true, autocomplete: "email" });
      var pwIn = el("input", { type: "password", placeholder: "Password", required: true, autocomplete: "current-password" });
      var signin = el("button", { type: "submit", class: "primary-btn", text: "Sign in" });
      var signup = el("button", { type: "button", class: "secondary-btn", text: "Create account" });
      emailForm.appendChild(emailIn);
      emailForm.appendChild(pwIn);
      emailForm.appendChild(signin);
      emailForm.appendChild(signup);
      emailForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        setStatus("", "Signing in…");
        auth.signInWithEmailAndPassword(emailIn.value.trim(), pwIn.value)
          .then(function () { setStatus("success", "Signed in."); })
          .catch(function (e) { setStatus("error", e.message || "Sign-in failed."); });
      });
      signup.addEventListener("click", function () {
        if (!emailIn.value.trim()) {
          setStatus("error", "Enter an email address.");
          return;
        }
        var pwErr = passwordPolicyError(pwIn.value);
        if (pwErr) {
          setStatus("error", "Weak password — " + pwErr);
          return;
        }
        setStatus("", "Creating your account…");
        auth.createUserWithEmailAndPassword(emailIn.value.trim(), pwIn.value)
          .then(function () { setStatus("success", "Account created."); })
          .catch(function (e) { setStatus("error", e.message || "Sign-up failed."); });
      });
      card.appendChild(emailForm);
    }
    host.appendChild(card);
  }

  // ---- cloud actions -----------------------------------------------------
  function getEditorJson() {
    if (!window.__scenarioAuthor || typeof window.__scenarioAuthor.toJson !== "function") {
      throw new Error("Scenario editor is not initialised yet.");
    }
    return window.__scenarioAuthor.toJson();
  }

  function runEditorValidate() {
    if (!window.__scenarioAuthor || typeof window.__scenarioAuthor.validate !== "function") {
      return ["Scenario editor is not initialised yet."];
    }
    return window.__scenarioAuthor.validate();
  }

  function saveScenarioToCloud(share) {
    var user = auth.currentUser;
    if (!user || user.isAnonymous) {
      setStatus("error", "Sign in first to save to your account.");
      return;
    }
    var errs = runEditorValidate();
    if (errs && errs.length) {
      setStatus("error", "Fix " + errs.length + " validation issue(s) before saving. Click Validate to see them.");
      return;
    }
    var body;
    try { body = getEditorJson(); }
    catch (e) { setStatus("error", e.message); return; }
    var id = body.id || "";
    if (!/^[a-z0-9_-]{1,60}$/.test(id)) {
      setStatus("error", "Scenario id must be 1-60 chars, lowercase letters/digits/_/-.");
      return;
    }
    var bodyJson = JSON.stringify(body);
    if (bodyJson.length > 262144) {
      setStatus("error", "Scenario is too large (" + bodyJson.length +
        " bytes, max 262144). Trim long narrative or split modules.");
      return;
    }
    var uid = user.uid;
    var path = "scenarios/" + uid + "/" + id;
    setStatus("", share ? "Saving & sharing…" : "Saving…");
    db.ref(path + "/meta/createdAt").once("value").then(function (snap) {
      var now = Date.now();
      var createdAt = snap.val() || now;
      var nameStr = (typeof body.name === "string"
        ? body.name
        : (body.name && body.name.en) || id).slice(0, 200);
      var summaryStr = (typeof body.summary === "string"
        ? body.summary
        : (body.summary && body.summary.en) || "").slice(0, 400);
      var meta = {
        id: id, name: nameStr, summary: summaryStr,
        createdAt: createdAt, updatedAt: now, version: 1, locale: "fr-ja"
      };
      var writes = [db.ref(path).set({ meta: meta, bodyJson: bodyJson })];
      var shareId = uid + "_" + id;
      if (share) {
        writes.push(db.ref("sharedScenarios/" + shareId).set({
          ownerUid: uid,
          ownerName: (user.displayName || user.email || "").slice(0, 80),
          scenarioId: id,
          meta: meta,
          bodyJson: bodyJson
        }));
      } else {
        writes.push(db.ref("sharedScenarios/" + shareId).remove().catch(function () { return null; }));
      }
      return Promise.all(writes);
    }).then(function () {
      setStatus("success", share
        ? "Saved to your account and published to shared scenarios."
        : "Saved to your account. (Not shared.)");
    }).catch(function (e) {
      console.error("[scenario-author-cloud] save failed", e);
      setStatus("error", "Save failed: " + (e.message || "unknown error"));
    });
  }

  function openLoadFromCloud() {
    var user = auth.currentUser;
    if (!user || user.isAnonymous) {
      setStatus("error", "Sign in first to load from your account.");
      return;
    }
    var uid = user.uid;
    setStatus("", "Loading your scenarios…");
    Promise.all([
      db.ref("scenarios/" + uid).once("value").then(function (snap) {
        var out = []; snap.forEach(function (c) {
          out.push({ kind: "private", id: c.key, meta: (c.val() || {}).meta || {} });
        }); return out;
      }).catch(function () { return []; }),
      db.ref("sharedScenarios").limitToFirst(200).once("value").then(function (snap) {
        var out = []; snap.forEach(function (c) {
          var v = c.val() || {};
          if (v.ownerUid === uid) return; // own private copy already listed
          out.push({
            kind: "shared", shareId: c.key, id: v.scenarioId,
            ownerUid: v.ownerUid, ownerName: v.ownerName || "",
            meta: v.meta || {}
          });
        }); return out;
      }).catch(function () { return []; }),
      // Takedowns live at moderation/removed/<shareId>, OUTSIDE sharedScenarios
      // (so an owner re-publishing can't clear one). script.js
      // listSharedScenarios() already filters these for the session-create
      // picker; this list MUST too, or a moderator-removed scenario stays
      // listed — and clonable — from the author. Degrades to "nothing removed".
      db.ref("moderation/removed").once("value")
        .then(function (s) { return s.val() || {}; })
        .catch(function () { return {}; })
    ]).then(function (res) {
      var removed = res[2] || {};
      var shared = (res[1] || []).filter(function (s) { return removed[s.shareId] !== true; });
      renderCloudPicker(res[0], shared);
    });
  }

  function renderCloudPicker(mine, shared) {
    var existing = $("scenario-cloud-picker");
    if (existing) existing.remove();
    var modal = el("div", {
      id: "scenario-cloud-picker",
      class: "load-modal",
      role: "dialog"
    });
    var inner = el("div", { class: "load-modal-inner" });
    inner.appendChild(el("h3", { text: "Load scenario from your account" }));
    inner.appendChild(el("p", {
      class: "field-hint",
      text: "Load edits a scenario in place (saving overwrites it). Clone copies it " +
            "into the form under a new id, leaving the original untouched."
    }));
    // Ids already used by this account, so a repeated Clone doesn't land on an
    // id that would overwrite one of the user's other scenarios on save.
    var mineIds = {};
    (mine || []).forEach(function (s) { if (s && s.id) mineIds[s.id] = true; });
    function pickerSection(title, items, getValue) {
      inner.appendChild(el("h4", { text: title + " (" + items.length + ")" }));
      if (!items.length) {
        inner.appendChild(el("p", { class: "field-hint", text: "Nothing here yet." }));
        return;
      }
      var ul = el("ul", { class: "scenario-cloud-list" });
      items.forEach(function (s) {
        var name = (s.meta && s.meta.name) || s.id;
        var sub = (s.kind === "shared" && s.ownerName) ? " — " + s.ownerName : "";
        var li = el("li");
        var btn = el("button", { type: "button", class: "secondary-btn", text: name + sub });
        btn.addEventListener("click", function () {
          loadByPath(getValue(s)).then(function () { modal.remove(); });
        });
        li.appendChild(btn);
        var clone = el("button", {
          type: "button", class: "secondary-btn",
          title: "Copy into the form under a new id (the original is untouched)",
          text: "Clone"
        });
        clone.addEventListener("click", function () {
          loadByPath(getValue(s), true, mineIds).then(function () { modal.remove(); });
        });
        li.appendChild(clone);
        if (s.kind === "private") {
          var del = el("button", {
            type: "button", class: "secondary-btn",
            title: "Delete this scenario",
            text: "×"
          });
          del.addEventListener("click", function () {
            if (!window.confirm("Delete '" + name + "' from your account? This cannot be undone.")) return;
            var uid = auth.currentUser.uid;
            Promise.all([
              db.ref("scenarios/" + uid + "/" + s.id).remove(),
              db.ref("sharedScenarios/" + uid + "_" + s.id).remove().catch(function () { return null; })
            ]).then(function () {
              li.remove();
              setStatus("success", "Deleted '" + name + "'.");
            }).catch(function (e) {
              setStatus("error", "Delete failed: " + (e.message || ""));
            });
          });
          li.appendChild(del);
        }
        ul.appendChild(li);
      });
      inner.appendChild(ul);
    }
    pickerSection("My scenarios", mine, function (s) {
      return "scenarios/" + auth.currentUser.uid + "/" + s.id + "/bodyJson";
    });
    pickerSection("Shared scenarios", shared, function (s) {
      return "sharedScenarios/" + s.shareId + "/bodyJson";
    });
    var closeRow = el("div", { class: "load-modal-actions" });
    var close = el("button", { type: "button", class: "secondary-btn", text: "Cancel" });
    close.addEventListener("click", function () { modal.remove(); });
    closeRow.appendChild(close);
    inner.appendChild(closeRow);
    modal.appendChild(inner);
    document.body.appendChild(modal);
  }

  /* asClone=true re-ids the payload before it reaches the form, so saving it
     creates a NEW scenario instead of overwriting the one it came from
     (saveScenarioToCloud writes scenarios/<uid>/<body.id>). Plain load keeps
     the id on purpose — that is the edit-in-place path. */
  function loadByPath(path, asClone, takenIds) {
    setStatus("", asClone ? "Cloning…" : "Loading…");
    return db.ref(path).once("value").then(function (snap) {
      var json = snap && snap.val();
      if (!json) {
        setStatus("error", "Scenario could not be loaded (empty body).");
        return;
      }
      try {
        var parsed = JSON.parse(json);
        var fromId = parsed.id || "(no id)";
        if (asClone && window.__scenarioAuthor &&
            typeof window.__scenarioAuthor.cloneJson === "function") {
          parsed = window.__scenarioAuthor.cloneJson(parsed, { taken: takenIds || {} });
        }
        var state = window.__scenarioAuthor.fromJson(parsed);
        window.__scenarioAuthor.setState(state);
        setStatus("success", asClone
          ? "Cloned '" + fromId + "' into the form as '" + (parsed.id || "(no id)") +
            "'. The original is untouched — save to keep the copy."
          : "Loaded scenario '" + fromId + "' into the form.");
      } catch (e) {
        setStatus("error", "Loaded payload is not valid JSON: " + (e.message || ""));
      }
    }).catch(function (e) {
      setStatus("error", "Load failed: " + (e.message || "permission denied?"));
    });
  }

  // ---- injection ---------------------------------------------------------
  function injectChrome() {
    var main = document.querySelector("main.author");
    if (!main) return;
    if (!$("scenario-author-auth")) {
      var slot = el("section", { id: "scenario-author-auth", class: "scenario-auth-slot" });
      main.insertBefore(slot, main.firstChild);
    }
    var actions = document.querySelector(".author-actions");
    if (actions && !$("btn-cloud-save")) {
      var save  = el("button", { type: "button", id: "btn-cloud-save",       class: "primary-btn",   text: "Save to my scenarios" });
      var share = el("button", { type: "button", id: "btn-cloud-save-share", class: "primary-btn",   text: "Save & share" });
      var load  = el("button", { type: "button", id: "btn-cloud-load",       class: "secondary-btn", text: "Load from cloud…" });
      save.addEventListener("click",  function () { saveScenarioToCloud(false); });
      share.addEventListener("click", function () { saveScenarioToCloud(true); });
      load.addEventListener("click",  openLoadFromCloud);
      actions.appendChild(save);
      actions.appendChild(share);
      actions.appendChild(load);
    }
  }

  function boot() {
    injectChrome();
    auth.onAuthStateChanged(function (user) { renderAuthPanel(user); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
