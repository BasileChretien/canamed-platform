/* account-ui.js — the account screens (lazy chunk)
 *
 * What nobody needs before they click: the sign-in view (the three routes, the
 * password meter), the account dialog (profile, joined sessions, delete) and
 * the profile-setup save. Loaded by CanamedLoader.ensureAccountUI(), from
 * accountUI() in script.js and from nowhere else: the front page, a join and a
 * room never fetch it.
 *
 * WHAT STAYS IN script.js, because it runs at load, at join, or when the
 * account changes: the anonymous sign-in, handleAuthStateChange(), the reset
 * (resetAccountUI, clearSignInForm, closeAccountDialog), the profile read and
 * write, the chip, the join-form fill, the history entry — and accountSignOut(),
 * so that signing out never waits for a download. All the state is declared
 * there too. script.js keeps no copy of anything declared here
 * (tests/account-ui-lazy-split.test.js).
 *
 * A CLASSIC script: it shares script.js's global scope, so currentUser,
 * currentProfile, auth, db, _anonShown and _historyListenerRef are read, and
 * the last one set, under their bare names. Nothing in script.js may name a
 * function of this file outside accountUI()'s callbacks.
 *
 * data-rights.js's deleteMyAccount() calls authErrorMessage(), declared here.
 * Its one caller is accountDelete() below, so this file is always in by then.
 */

/* turn the Firebase auth error code into a sentence a human can act on */
function authErrorMessage(err) {
  const code = err && err.code || "";
  const map = {
    "auth/popup-blocked": "Your browser blocked the sign-in popup — allow popups on this site and try again.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/operation-not-allowed": "This sign-in provider is not enabled for this Firebase project (turn it on in Firebase Console → Authentication → Sign-in method).",
    "auth/configuration-not-found": "This sign-in provider is not configured for this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method.",
    "auth/unauthorized-domain": "This domain is not authorised for sign-in — add it in Firebase Console → Authentication → Settings → Authorized domains.",
    "auth/account-exists-with-different-credential": "An account already exists with this email under a different sign-in method.",
    "auth/network-request-failed": "Could not reach the sign-in server — check your connection.",
    "auth/too-many-requests": "Too many attempts — try again in a few minutes.",
    "auth/requires-recent-login": "For this action, please sign out and sign back in, then try again.",
    "auth/invalid-email": "That email address does not look valid.",
    "auth/missing-password": "Enter your password.",
    "auth/wrong-password": "Wrong password — try again, or use Create account if this is your first sign-in.",
    "auth/user-not-found": "No account with that email — use Create account to make one.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/weak-password": "Pick a stronger password: at least 8 characters mixing letters, numbers, and symbols.",
    "auth/email-already-in-use": "An account with that email already exists — use Sign in instead."
  };
  if (map[code]) return map[code];
  // Don't surface raw SDK messages to the UI — they can leak internal request
  // URLs or quota strings. Log the code for debugging, show a generic line.
  if (code) { try { console.warn("[auth] unmapped error code:", code); } catch (_) { /* noop */ } }
  return "Sign-in failed — please try again.";
}

/* Sign in through a provider's popup: google / microsoft / apple. The first
   sign-in creates the account, so there is no separate sign-up. */
function signInWithProvider(name) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  let provider;
  let pretty;
  if (name === "google") {
    pretty = "Google";
    provider = new firebase.auth.GoogleAuthProvider();
    // Ask which account every time: never silently another tab's session.
    provider.setCustomParameters({ prompt: "select_account" });
  } else if (name === "microsoft") {
    pretty = "Microsoft";
    provider = new firebase.auth.OAuthProvider("microsoft.com");
    provider.setCustomParameters({ prompt: "select_account" });
  } else if (name === "apple") {
    pretty = "Apple";
    provider = new firebase.auth.OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
  } else {
    return;
  }
  splashHintOk(hint, "Opening " + pretty + " sign-in…");
  /* An anonymous visitor is LINKED: the uid, and what is stored under it, are
     kept. If the provider account already exists as a user of its own, sign in
     AS it with the credential the error carries (no second popup to block);
     what was under the throwaway anonymous uid is then left behind. */
  const cur = auth.currentUser;
  const popupSignIn = () => auth.signInWithPopup(provider);
  const salvageSignIn = e =>
    (e && e.credential) ? auth.signInWithCredential(e.credential) : popupSignIn();
  /* A blocked popup falls back to a full-page redirect: no blocker stops it,
     and it is reliable only because auth is first-party (authDomain = web.app).
     getRedirectResult() in dbInit() finishes the sign-in on return. */
  const popupBlocked = e => e && (
    e.code === "auth/popup-blocked" ||
    e.code === "auth/cancelled-popup-request" ||
    e.code === "auth/operation-not-supported-in-this-environment" ||
    e.code === "auth/web-storage-unsupported");
  const redirectSignIn = () => {
    splashHintOk(hint, "Redirecting to " + pretty + "…");
    const c = auth.currentUser;
    return (c && c.isAnonymous)
      ? c.linkWithRedirect(provider)
      : auth.signInWithRedirect(provider);
  };
  const link = (cur && cur.isAnonymous)
    ? cur.linkWithPopup(provider).catch(e => {
        if (e && (e.code === "auth/credential-already-in-use" ||
                  e.code === "auth/email-already-in-use")) {
          return salvageSignIn(e);
        }
        if (e && e.code === "auth/provider-already-linked") {
          return popupSignIn();
        }
        throw e;
      })
    : popupSignIn();
  link.then(() => signInDone(hint)).catch(e => {
    if (popupBlocked(e)) {
      redirectSignIn().catch(err => splashHintErr(hint, authErrorMessage(err)));
      return;
    }
    splashHintErr(hint, authErrorMessage(e));
  });
}

/* Cheap password-strength scorer — no zxcvbn dependency. Returns
   { score: 0-4, label: i18n-key, ok: boolean }. ok=true means the
   password is acceptable for account creation (≥8 chars + at least 3 of
   {lowercase, uppercase, digit, symbol}). The score 0-4 drives the
   colored meter; the threshold for ok is score >= 3. */
function scorePassword(pw) {
  pw = String(pw || "");
  if (!pw) return { score: 0, key: "splash.account.pwd-strength-empty", ok: false };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  // Soft penalty for trivially weak strings (single char class regardless of
  // length, or sequences like 12345/abcdef). Doesn't try to be a full check.
  if (classes <= 1 || /(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) {
    score = Math.min(score, 1);
  }
  score = Math.max(0, Math.min(4, score));
  const labels = [
    "splash.account.pwd-strength-veryweak",
    "splash.account.pwd-strength-weak",
    "splash.account.pwd-strength-fair",
    "splash.account.pwd-strength-good",
    "splash.account.pwd-strength-strong"
  ];
  return {
    score: score,
    key: labels[score],
    ok: score >= 3 && pw.length >= 8 && classes >= 3
  };
}

/* Wire the sign-in / sign-up email form: tab toggle, password-strength
   meter, single submit handler that dispatches on data-mode. Idempotent
   — calling it again rebinds without duplicating listeners (we only
   look up by id and use simple guard flags). */
function wireEmailAuthForm() {
  const form    = el("splash-email-form");
  const tabIn   = el("splash-email-mode-signin");
  const tabUp   = el("splash-email-mode-signup");
  const pwIn    = el("splash-password-input");
  const submit  = el("splash-email-submit");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  function applyMode(mode) {
    const isSignup = (mode === "signup");
    form.dataset.mode = isSignup ? "signup" : "signin";
    if (tabIn) {
      tabIn.classList.toggle("is-active", !isSignup);
      tabIn.setAttribute("aria-selected", String(!isSignup));
    }
    if (tabUp) {
      tabUp.classList.toggle("is-active", isSignup);
      tabUp.setAttribute("aria-selected", String(isSignup));
    }
    // Show / hide the sign-up-only rows (confirm field + strength meter).
    Array.from(document.querySelectorAll(".splash-signup-only"))
      .forEach(n => { n.hidden = !isSignup; });
    if (pwIn) {
      pwIn.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
      pwIn.setAttribute("minlength", isSignup ? "8" : "6");
    }
    if (submit) {
      const key = isSignup ? "splash.account.signup-email" : "splash.account.signin-email";
      submit.setAttribute("data-i18n", key);
      submit.textContent = (window.t ? window.t(key) :
        (isSignup ? "Create account" : "Sign in"));
    }
    // Clear any stale hint from the other mode.
    splashHintOk(el("splash-account-hint"), "");
    if (isSignup) updateStrengthMeter();
  }

  function updateStrengthMeter() {
    const fill  = el("splash-pwd-strength-fill");
    const label = el("splash-pwd-strength-label");
    if (!fill || !label) return;
    const s = scorePassword(pwIn ? pwIn.value : "");
    // 0..4 → width 0..100%; data attribute drives colour via CSS.
    fill.style.width = (s.score * 25) + "%";
    fill.dataset.score = String(s.score);
    label.textContent = (window.t ? window.t(s.key) : s.key);
  }

  if (tabIn) tabIn.addEventListener("click", () => applyMode("signin"));
  if (tabUp) tabUp.addEventListener("click", () => applyMode("signup"));
  if (pwIn)  pwIn.addEventListener("input", () => {
    if (form.dataset.mode === "signup") updateStrengthMeter();
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const em = (el("splash-email-input") || {}).value.trim();
    const pw = (el("splash-password-input") || {}).value || "";
    if (form.dataset.mode === "signup") {
      const pw2 = (el("splash-password-confirm") || {}).value || "";
      const hint = el("splash-account-hint");
      if (pw !== pw2) {
        splashHintErr(hint, (window.t && window.t("splash.account.pwd-mismatch")) ||
          "The two passwords don't match — retype them.");
        return;
      }
      const s = scorePassword(pw);
      if (!s.ok) {
        splashHintErr(hint, (window.t && window.t("splash.account.pwd-too-weak")) ||
          "Pick a stronger password: at least 8 characters with a mix of upper-case, lower-case, digits, and symbols.");
        return;
      }
      signUpWithEmail(em, pw);
    } else {
      signInWithEmail(em, pw);
    }
  });

  applyMode("signin");
}

/* Sign in to an EXISTING e-mail account. Nothing is linked: the account
   pre-dates this tab, and the throwaway anonymous uid is left behind. */
function signInWithEmail(email, password) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  if (!email || !password) {
    splashHintErr(hint, "Enter your email and password.");
    return;
  }
  splashHintOk(hint, "Signing you in…");
  auth.signInWithEmailAndPassword(email, password)
    .then(() => signInDone(hint))
    .catch(e => splashHintErr(hint, authErrorMessage(e)));
}

/* Create an e-mail account. An anonymous visitor is LINKED, as in
   signInWithProvider(); an address already in use signs in to that account. */
function signUpWithEmail(email, password) {
  const hint = el("splash-account-hint");
  if (!auth) { splashHintErr(hint, "Sign-in is not available in local-test mode."); return; }
  if (!email || !password) {
    splashHintErr(hint, "Enter your email and password.");
    return;
  }
  // The form's strength rule, for ANY caller: this must never be the weaker gate.
  if (!scorePassword(password).ok) {
    splashHintErr(hint, authErrorMessage({ code: "auth/weak-password" }));
    return;
  }
  splashHintOk(hint, "Creating your account…");
  const cur = auth.currentUser;
  const cred = firebase.auth.EmailAuthProvider.credential(email, password);
  const link = (cur && cur.isAnonymous)
    ? cur.linkWithCredential(cred).catch(e => {
        if (e && (e.code === "auth/credential-already-in-use" ||
                  e.code === "auth/email-already-in-use")) {
          return auth.signInWithCredential(cred);
        }
        throw e;
      })
    : auth.createUserWithEmailAndPassword(email, password)
        .catch(e => {
          if (e && e.code === "auth/email-already-in-use") {
            return auth.signInWithEmailAndPassword(email, password);
          }
          throw e;
        });
  link.then(() => signInDone(hint))
      .catch(e => splashHintErr(hint, authErrorMessage(e)));
}

/* A sign-in or sign-up succeeded: an account the page still shows as a visitor
   is handled here. (A tab nobody signs in on shows the visitor until reloaded.) */
function signInDone(hint) {
  clearSignInForm();
  splashHintOk(hint, "");
  const u = auth.currentUser;
  if (u && !u.isAnonymous && u.uid === _anonShown) handleAuthStateChange(u);
}

/* Build the saveProfile payload for the given role. Facilitators null out
   the student-only fields so a student→facilitator switch doesn't leave
   stale year/English behind. */
function profileUpdatesForRole(role, name, uni, yearEl, englishEl) {
  if (role === "facilitator") {
    return { name: name, university: uni, role: "facilitator", year: null, english: null };
  }
  return {
    name: name, university: uni, role: "student",
    year: parseInt(el(yearEl).value, 10) || 1,
    english: (el(englishEl).value || "B2").trim()
  };
}

/* Profile-setup submit (right after sign-up) */
function profileSetupSubmit() {
  const hint = el("splash-profile-setup-hint");
  const role = selectedRole("splash-prof-role");
  const name = (el("splash-prof-name").value || "").trim();
  const uni = (el("splash-prof-uni").value || "").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  if (!uni) { splashHintErr(hint, "Pick your university."); return; }
  splashHintOk(hint, "Saving your profile…");
  const updates = profileUpdatesForRole(role, name, uni, "splash-prof-year", "splash-prof-english");
  saveProfile(updates).then(p => {
    if (!p) return;
    splashHintOk(hint, "");
    paintUserChip();
    splashShowView("enter");
    applyProfileToJoinForm();
  }).catch(e => splashHintErr(hint, "Could not save: " + (e.message || "")));
}

/* The account dialog (opened by the header chip, or the splash's "Account") */
function openAccountDialog() {
  const dlg = el("account-dialog");
  if (!dlg || !currentUser) return;
  el("account-email").textContent = currentUser.email || "";
  // Every field, on every open: never what a previous account left here.
  const p = currentProfile || {};
  el("account-uni").value = "";
  populateProfileSelects("account-uni");
  el("account-name").value = p.name || "";
  if (p.university) el("account-uni").value = p.university;
  el("account-year").value = String(p.year || 1);
  el("account-english").value = p.english || "B2";
  setRoleRadio("account-role", p.role || "student");
  applyProfileRoleVisibility("account-role", "account-student-fields");
  splashHintOk(el("account-action-hint"), "");
  loadHistoryForDialog();
  dialogShow(dlg);
}

function loadHistoryForDialog() {
  const list = el("account-history");
  if (!list || !currentUser || !db) return;
  if (_historyListenerRef) _historyListenerRef.off();
  list.innerHTML = "";   // the answer comes later: never a previous account's rows meanwhile
  _historyListenerRef = db.ref("users/" + currentUser.uid + "/history");
  _historyListenerRef.on("value", snap => {
    const v = snap.val() || {};
    const items = Object.keys(v).map(k => v[k])
      .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
    list.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "No sessions yet — your history will appear here once you join one.";
      list.appendChild(li);
      return;
    }
    items.forEach(it => {
      const li = document.createElement("li");
      li.className = "account-history-row";
      const code = document.createElement("strong");
      code.className = "account-history-code";
      code.textContent = (it.code || "").toUpperCase();
      const meta = document.createElement("span");
      meta.className = "account-history-meta";
      const when = it.joinedAt ? new Date(it.joinedAt).toLocaleDateString() : "";
      const sc = it.scenarioName ? " · " + it.scenarioName : "";
      meta.textContent = when + sc;
      li.appendChild(code); li.appendChild(meta);
      /* The waiting-screen button only exists while someone is IN a session.
         A signed-in participant who wants to withdraw a month later needs a
         route too, and their history is the only place that lists the sessions
         they were in. Anonymous participants have no history by design, so for
         them the waiting-screen control is the only in-product route — stated
         in Annex VI G12 rather than glossed. */
      const wd = document.createElement("button");
      wd.type = "button";
      wd.className = "splash-link account-history-withdraw";
      wd.textContent = t("data-rights.withdraw-btn-short");
      wd.addEventListener("click", () => {
        runWithdrawalFlow(it.code, el("account-action-hint"));
      });
      li.appendChild(wd);
      list.appendChild(li);
    });
  });
}

function accountSaveBtn() {
  const hint = el("account-action-hint");
  const role = selectedRole("account-role");
  const name = (el("account-name").value || "").trim();
  const uni = (el("account-uni").value || "").trim();
  if (!name) { splashHintErr(hint, "Enter your name."); return; }
  const updates = profileUpdatesForRole(role, name, uni, "account-year", "account-english");
  saveProfile(updates).then(p => {
    if (!p) return;
    splashHintOk(hint, "Profile saved.");
    paintUserChip();
    applyProfileToJoinForm();
    const ok = el("account-save-ok");
    if (ok) {
      ok.classList.remove("hidden");
      setTimeout(() => ok.classList.add("hidden"), 1800);
    }
  }).catch(e => splashHintErr(hint, "Could not save: " + (e.message || "")));
}

/* "Delete account". The work lives in the LAZY data-rights.js, beside the other
   data-rights code (deleteMyAccount, 2026-10-07) - it is reachable from one
   click in the account dialog and has no business on the splash's critical
   path. This is the on-click shim, the same shape as _wireDataRightsExport():
   a loader without the method (an older cached shell) and a chunk that 404'd
   or is offline both end in a message saying nothing was deleted, never in a
   ReferenceError out of the click. */
function accountDelete() {
  if (!currentUser || !auth) return;
  const fail = (e) => {
    console.warn("Could not load the account-deletion code:", e);
    splashHintErr(el("account-action-hint"), "Could not load this action, so " +
      "nothing was deleted. Check your connection and try again.");
  };
  const run = () => {
    const fn = window.deleteMyAccount;
    if (typeof fn !== "function") { fail(new Error("deleteMyAccount missing")); return; }
    fn();
  };
  if (typeof window.deleteMyAccount === "function") { run(); return; }
  const loader = window.CanamedLoader;
  (loader && loader.ensureDataRights ? loader.ensureDataRights()
    : Promise.reject(new Error("loader has no ensureDataRights")))
    .then(run, fail);
}

/* The handlers of what only this file puts on screen: the sign-in view and the
   account dialog. script.js's wireAccountUI() wires what can be clicked before
   this file is in. Run once, below, when the file is evaluated: whoever loaded
   it, a chunk that is in is a chunk that is wired. */
let _accountChunkWired = false;
function wireAccountChunk() {
  if (_accountChunkWired) return;
  _accountChunkWired = true;

  if (el("splash-back-from-account")) el("splash-back-from-account")
    .addEventListener("click", () => { clearSignInForm(); splashShowView("enter"); });
  if (el("splash-google-signin")) el("splash-google-signin")
    .addEventListener("click", () => signInWithProvider("google"));
  if (el("splash-microsoft-signin")) el("splash-microsoft-signin")
    .addEventListener("click", () => signInWithProvider("microsoft"));
  if (el("splash-apple-signin")) el("splash-apple-signin")
    .addEventListener("click", () => signInWithProvider("apple"));
  wireEmailAuthForm();

  // role toggle: hide the student-only fields (year / English) for facilitators
  document.querySelectorAll('input[name="account-role"]').forEach(r =>
    r.addEventListener("change", () =>
      applyProfileRoleVisibility("account-role", "account-student-fields")));

  if (el("account-dialog-close")) el("account-dialog-close")
    .addEventListener("click", closeAccountDialog);
  if (el("account-save-btn")) el("account-save-btn").addEventListener("click", accountSaveBtn);
  if (el("account-signout-btn")) el("account-signout-btn").addEventListener("click", accountSignOut);
  if (el("account-delete-btn")) el("account-delete-btn").addEventListener("click", accountDelete);
  // close dialog when clicking the backdrop
  const dlg = el("account-dialog");
  if (dlg) dlg.addEventListener("click", e => {
    if (e.target === dlg) closeAccountDialog();
  });
}

wireAccountChunk();
