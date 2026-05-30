/* CaNaMED i18n — EN / FR / JA / ES / PT / DE / KO / ZH translations
 * across the workshop surfaces.
 *
 * The platform's primary audience is medical students from Caen (FR) and
 * Nagoya (JP). An all-English UI works for them in principle, but during
 * fast-moving roleplay segments cognitive load is high enough that the
 * native-language UI matters. This file ships English (the canonical
 * keys), French, Japanese, plus a second wave of languages added for
 * upcoming partnership outreach (Spanish, Brazilian Portuguese, German,
 * Korean, Simplified Mandarin Chinese) across:
 *
 *   Phase 1 (PR #27): splash, code-entry lobby, participant lobby,
 *                     waiting room
 *   Phase 2 (PR #49): stage labels (Welcome/Module A/Module B/Wrap-up),
 *                     Welcome screen, ethics grade-note, Call-facilitator
 *   Phase 3 (PR #51 + this PR):
 *                     wrap-up stage, session-ended screen, closed-banner,
 *                     admin dashboard buttons (Start/Advance/Download/End),
 *                     admin prefs (mute alerts, download error log),
 *                     Module B title, GDPR Art. 15 export, QR caption,
 *                     copy-link, session-clone affordances
 *
 * Still in English (deferred — JS-generated dynamic content needing a
 * deeper refactor):
 *   - Module A interactive case (findings log, decisions UI, scoring
 *     banners, country-compare card)
 *   - Module B roleplay instruction body text
 *   - Toast / celebration / penalty messages
 *
 * How it works:
 *   - Every translatable HTML node has data-i18n="key" (and optionally
 *     data-i18n-attr="attr" if the string is an attribute, e.g. placeholder).
 *   - applyI18n() iterates them all and rewrites text / attribute values.
 *   - Language detection (in priority order):
 *       1. localStorage.canamed_lang (sticky user choice)
 *       2. navigator.language prefix (fr → fr, ja → ja, otherwise en)
 *   - The header language switcher writes localStorage and re-applies.
 *
 * Japanese strings: drafted by machine and then taken through a deeper
 * LLM polish pass focused on (a) consistent register — 丁寧語 for
 * student-facing copy, terser dashboard-verb style for admin chrome,
 * (b) more natural phrasing in the consent paragraphs and the
 * anti-coercion grade note, and (c) warmer closure on the
 * session-ended / closed-banner screens. Still NOT reviewed by a
 * native speaker — a final pass before a production cohort is
 * recommended, especially on the two consent strings
 * (`lobby.consent-workshop`, `lobby.consent-research`). Please send
 * corrections.
 *
 * Second-wave languages (es, pt, de, ko, zh): machine-drafted with the
 * same register conventions applied per language — neutral Latin
 * American Spanish (usted in legal copy), Brazilian Portuguese (você
 * form), Standard German Hochdeutsch (Sie, with DSGVO terminology in
 * the consent paragraphs), polite Korean -습니다 form for student-facing
 * copy and terser -다 verbs for admin chrome, and Simplified Mandarin
 * Chinese using mainland conventions and minimal modal particles in
 * legal copy. NOT YET reviewed by native speakers — please send
 * corrections, especially on `lobby.consent-workshop` and
 * `lobby.consent-research`.
 */

(function (root, factory) {
  const exp = factory();
  if (typeof window !== "undefined") {
    window.CanamedI18n = exp;
    window.t = exp.t;
    window.setLang = exp.setLang;
    window.getLang = exp.getLang;
    window.applyI18n = exp.applyI18n;
    window.localizedHref = exp.localizedHref;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "canamed_lang";
  const SUPPORTED = ["en", "fr", "ja", "es", "pt", "de", "ko", "zh"];

  /* ============================================================
   * Translation table. Keys are kebab-case with a section prefix
   * so they're greppable from HTML. English is the canonical fallback
   * — every key MUST have an English entry. fr/ja are best-effort and
   * fall back to English when missing.
   * ============================================================ */
  const T = {
    en: {
      // language switcher labels (in their own language for clarity)
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      // a11y — skip-to-content link (WCAG 2.4.1)
      "a11y.skip-to-main": "Skip to main content",

      // splash — shared chrome
      "splash.tagline": "A collaborative platform for medical-education partnerships between universities.",
      "splash.signed-in-as": "Signed in as",
      "splash.sign-out": "Sign out",
      "splash.lang-label": "Language",
      "splash.saved-session-as": "Resuming as",
      "splash.saved-session-in": "in session",
      "splash.saved-session-clear": "Not you? Disconnect & start fresh →",
      "lobby.switch-session": "← Use a different session",
      "lobby.admin-default-name": "Facilitator",
      "lobby.admin-name-defaulted": "Joining as the default name — edit the name field above to put your own name on the audit trail.",
      "lobby.admin-name-prompt": "Type your name above first, then your admin password here.",
      "lobby.forgot-pass-link": "Need to set or recover the admin password? ›",
      "modA.bullet-progress.plan": "Plan",
      "modA.bullet-progress.differ": "Differentials",
      "modA.bullet-progress.disagree": "Disagreements",
      "modA.bullet-progress.takehome": "Take-home",
      "room.observer-btn": "I'm just observing",
      "room.observer-btn-title": "Move into the observer role — you can still see everything but no one will ask you to commit.",
      "room.observer-rejoin": "Rejoin actively",
      "endpoll.title": "Quick reflection — 30 seconds",
      "endpoll.intro": "Two questions before you close the tab. Optional but valuable — your facilitators read every answer to shape the next session.",
      "endpoll.hardest-label": "What was the hardest moment today?",
      "endpoll.hardest-placeholder": "A short sentence is enough.",
      "endpoll.feeling-label": "One word that describes how you felt:",
      "endpoll.feeling-placeholder": "e.g. focused / unsure / surprised / proud",
      "endpoll.submit": "Send my reflection",
      "endpoll.thanks": "Thank you — your reflection is in.",
      "answer.counter.placeholder": "Why do you see it differently?",
      "answer.counter.aria": "Counter-bullet to teammate's answer",
      "answer.counter.send": "Send counter-point",
      "answer.support.placeholder": "What would you add, or why do you agree?",
      "answer.support.aria": "Supporting point",
      "answer.support.send": "Add supporting point",
      "splash.back": "← Back",
      "splash.my-sessions.link": "My open sessions (<span id=\"splash-my-sessions-count\">0</span>) →",
      "splash.my-sessions.title": "Sessions you created",
      "splash.my-sessions.subtitle": "These are sessions started from this browser. Close any that are no longer in use to free quota and stop new students from joining.",
      "splash.my-sessions.empty": "No sessions tracked on this browser. Sessions you create from here will appear in this list.",
      "splash.my-sessions.no-label": "(no label)",
      "splash.my-sessions.opened-just-now": "Opened just now",
      "splash.my-sessions.opened-mins": "Opened {n} min ago",
      "splash.my-sessions.opened-hours": "Opened {n}h ago",
      "splash.my-sessions.opened-days": "Opened {n} day(s) ago",
      "splash.my-sessions.opened-earlier": "Opened earlier",
      "splash.my-sessions.checking": "Checking status…",
      "splash.my-sessions.status-open": "Open — click Close to end it",
      "splash.my-sessions.status-unknown": "Status unknown",
      "splash.my-sessions.already-closed": "Already closed — will be removed",
      "splash.my-sessions.close-btn": "Close session",
      "splash.my-sessions.forget-btn": "Remove from list",
      "splash.my-sessions.close-confirm": "End this session? Participants will see the wrap-up screen and cannot interact further. The data stays in the database — you can re-open the admin dashboard later to download the archive.",
      "splash.my-sessions.closing": "Closing…",
      "splash.my-sessions.closed-ok": "Closed ✓",
      "splash.my-sessions.closed-btn": "Closed",
      "splash.my-sessions.close-failed": "Could not close — check your connection and try again.",

      // privacy page — R3 deep-i18n: privacy.html is a single dynamic
      // page; reviewed body copy lives inline as <section data-priv-lang>.
      // privacy.title / privacy.subtitle wire the page chrome.
      "privacy.title": "CaNaMED — Privacy Policy",
      "privacy.subtitle": "How we use your data, and your rights",
      // Banner shown when the active UI lang has no reviewed body
      // (es/pt/de/ko/zh fall back to the EN body).
      "privacy.lang-not-available": "A full translation of this privacy policy in your selected language is not yet available. The English text below is the legally binding version. A reviewed <a href=\"privacy.html?lang=fr\">French</a> or <a href=\"privacy.html?lang=ja\">Japanese</a> version is also available.",

      // verify.html — public certificate verification page (PIS v2 §18)
      "verify.title": "Verify a CaNaMED certificate",
      "verify.subtitle": "Confirm a certificate is genuine",
      "verify.back": "← Back to the CaNaMED platform",
      "verify.intro": "Enter the <strong>Verification ID</strong> printed on the certificate <strong>and</strong> the name on it. The page confirms whether they match a real CaNaMED certificate. The name is never published — only \"valid\" or \"no match\" is returned.",
      "verify.id-label": "Verification ID",
      "verify.name-label": "Name on the certificate",
      "verify.button": "Verify",
      "verify.required": "Please enter both the Verification ID and the name on the certificate.",
      "verify.bad-format": "That doesn't look like a CaNaMED verification ID (expected CNM-XXXXX-XXXXX).",
      "verify.checking": "Checking…",
      "verify.valid": "✓ Valid: this is a real CaNaMED certificate",
      "verify.no-match": "The name you entered does not match the certificate with that ID.",
      "verify.not-found": "This Verification ID is not in the public registry. If you received it on a CaNaMED certificate, please contact the CaNaMED team with the ID and the name on the certificate — they hold the master record.",
      "verify.unavailable": "Verification is temporarily unavailable. Please try again later.",
      "verify.privacy-note": "See section 18 of the <a href=\"privacy.html\">privacy policy</a> for what is stored, the retention period and how to remove an entry.",

      // splash — enter-code view (participants)
      "splash.enter.label": "Enter the session code your facilitator gave you",
      "splash.enter.placeholder": "e.g. ABC-DEF",
      "splash.enter.submit": "Enter →",
      "splash.enter.no-code": "Don't have a code yet?",
      "splash.enter.go-create": "I'm a facilitator — create a session →",
      "splash.enter.go-account": "Sign in with Google or email (optional — to save your profile & history) →",
      "splash.enter.go-author": "Author or edit your own scenarios →",

      // splash — sign-in view
      "splash.account.title": "Sign in to your account",
      "splash.account.subtitle": "Sign in with Google or with an email and password. Your details auto-fill when you join a session, and the sessions you have taken part in — plus any scenarios you author — are kept under your profile.",
      "splash.account.continue-google": "Continue with Google",
      "splash.account.or": "— or use email —",
      "splash.account.mode-signin": "I already have an account",
      "splash.account.mode-signup": "Create a new account",
      "splash.account.email-label": "Email",
      "splash.account.password-label": "Password",
      "splash.account.password-confirm-label": "Confirm password",
      "splash.account.signin-email": "Sign in",
      "splash.account.signup-email": "Create account",
      "splash.account.pwd-strength-empty": "Strength: —",
      "splash.account.pwd-strength-veryweak": "Strength: very weak",
      "splash.account.pwd-strength-weak": "Strength: weak",
      "splash.account.pwd-strength-fair": "Strength: fair",
      "splash.account.pwd-strength-good": "Strength: good",
      "splash.account.pwd-strength-strong": "Strength: strong",
      "splash.account.pwd-strength-hint": "Use at least 8 characters with a mix of upper- and lower-case letters, digits, and symbols.",
      "splash.account.pwd-mismatch": "The two passwords don't match — retype them.",
      "splash.account.pwd-too-weak": "Pick a stronger password: at least 8 characters with a mix of upper-case, lower-case, digits, and symbols.",
      "splash.account.back": "← Back to join a session",

      // splash — profile-setup view
      "splash.profile.title": "Set up your profile",
      "splash.profile.subtitle": "These details auto-fill every time you join a session. You can update them later from your account.",
      "splash.profile.name-label": "Your name (first name or nickname)",
      "splash.profile.name-placeholder": "e.g. Alice / Akari",
      "splash.profile.uni-label": "University",
      "splash.profile.year-label": "Year of study",
      "splash.profile.english-label": "English level (CEFR self-assessment)",
      "splash.profile.submit": "Save and continue →",
      "splash.profile.role-label": "I am a…",
      "splash.profile.role-student": "Student",
      "splash.profile.role-facilitator": "Facilitator",

      // splash — create-session view (facilitator)
      "splash.create.title": "Create a CANAMED session",
      "splash.create.subtitle": "You will get a short code to share with your students. You become its facilitator (admin) — keep the password you set here to control it later.",
      "splash.create.name-label": "Your name",
      "splash.create.name-placeholder": "e.g. Dr Smith",
      "splash.create.workshop-label": "Workshop label",
      "splash.create.workshop-optional": "(optional)",
      "splash.create.workshop-placeholder": "e.g. Caen × Nagoya — June 2026",
      "splash.create.content-label": "Scenario (the clinical case for this workshop)",
      "splash.create.password-label": "Set a session password",
      "splash.create.password-placeholder": "something only the facilitators will know",
      "splash.create.password-hint": "You'll need this to re-open the admin dashboard if you reload the page. Students never see it. Use a fresh password — not your university one.",
      "splash.create.builtin-group": "Built-in scenarios",
      "splash.create.mine-group": "My scenarios",
      "splash.create.shared-group": "Shared scenarios",
      "splash.create.advanced-toggle": "Create new content (advanced) ↓",
      "splash.create.custom-label": "Custom content (JSON)",
      "splash.create.custom-help": "Paste a JSON object with the keys name, case, scoring, penalties, decisions — see the README for the full structure. Use \"Load template\" to start from the built-in content, then edit only what you need.",
      "splash.create.custom-desc": "Paste a JSON object describing your case. Use 'Load template' to start from the built-in content.",
      "splash.create.load-template": "Load template",
      "splash.create.back": "← Back",
      "splash.create.submit": "Create session",
      "splash.create.clone-last": "Clone last workshop ↻",
      "splash.create.clone-clear": "Clear",

      // in-page confirmation modal (replaces native window.confirm)
      "modal.confirm": "OK",
      "modal.cancel": "Cancel",
      "modal.advance-all.title": "Advance all rooms?",
      "modal.advance-all.message": "Every room will move forward by one stage. Per-room preview below:",
      "modal.advance-all.ok": "Advance all",
      "modal.start.too-many-rooms-title": "More rooms than participants",
      "modal.start.too-many-rooms-message": "You have fewer participants than the number of rooms you selected. Some rooms will be empty or very small. Start anyway?",
      "modal.start.weak-rooms-title": "Some rooms are unbalanced",
      "modal.start.weak-rooms-message": "Some rooms are small or single-university. The goal is mixed {cohortPair} groups. Start anyway?",
      "modal.start.ok": "Start anyway",
      "modal.close.title": "End session and download archive?",
      "modal.close.message": "This will download a JSON file with every group's answers, votes, reveals, scores, contributions and presence, and mark the session as closed — participants see a thanks-for-taking-part banner and cannot type any more text.\n\nThe students' data stays in the database — you can re-download the archive any time. The marker cannot easily be undone.",
      "modal.close.ok": "End and download",

      // admin pre-start UI additions (waiting room, expected total, test alerts)
      "admin.waiting.title": "Waiting room",
      "admin.waiting.expected-label": "Expected total (optional)",
      "admin.waiting.expected-placeholder": "e.g. 30",
      "admin.waiting.expected-hint": "Shown next to the live count so you know when everyone has joined.",
      "admin.test-alerts": "Test alerts",
      "admin.test-alerts-hint": "Click once before students join — plays the chime and asks for desktop-notification permission, so the first real help call is never silent.",
      "admin.test-alerts.ok": "Chime played. Desktop notifications enabled.",
      "admin.test-alerts.ok-noperm": "Chime played. Desktop notifications are not supported in this browser.",
      "admin.test-alerts.denied": "Chime played, but desktop notifications are blocked. Check your browser settings.",
      "admin.test-alerts.noaudio": "Audio was blocked by the browser — click anywhere on the page first, then try again.",
      "admin.test-alerts.dismissed": "Chime played. Notifications prompt was dismissed — click Test alerts again to retry.",

      // splash — created-success view
      "splash.created.title": "Session created",
      "splash.created.subtitle": "Share this code with your students. They type it on this same page to join.",
      "splash.created.copy": "Copy",
      "splash.created.copy-link": "Copy link",
      "splash.created.qr-caption": "Or scan the QR with a phone",
      "splash.qr.loading": "Generating QR code…",
      // Reject-closed-session messages (2026-05-18 user report: "It
      // should not be possible for a student to join a finished
      // session anyway"). Surface at splash before the lobby flow.
      "splash.enter.session-ended": "This session has already ended. Ask your facilitator for a new session code.",
      "splash.enter.previous-session-ended": "Your previous session has ended. Enter a new code from your facilitator.",
      "splash.enter.unreachable": "Couldn't reach the session server. Check your connection and try again.",
      "splash.created.create-another": "Create another",
      "splash.created.open-admin": "Open admin dashboard →",
      // D21 — one-time recovery code shown on the created view.
      "splash.created.recovery-title": "Recovery code — write this down now",
      "splash.created.recovery-copy": "Copy",
      "splash.created.recovery-warn": "This is the ONLY way to reset the session password if you forget it. It will not be shown again. Keep it private — anyone who has it can reset this session’s password.",
      "splash.created.recovery-copied": "Recovery code copied!",
      "splash.created.recovery-copy-fail": "Couldn’t copy — write the recovery code down manually.",

      // lobby — participant join form (after entering a code)
      "lobby.join-title": "Join as a participant",
      "lobby.join-hint": "You will be placed in a mixed {cohortPair} room automatically — balanced by university, year and English level.",
      "lobby.uni-label": "University",
      "lobby.uni-placeholder": "Select your university…",
      "lobby.year-label": "Year of study",
      "lobby.year-postgrad": "Postgraduate / Resident",
      "lobby.english-label": "English level (CEFR self-assessment)",
      "lobby.english-hint": "CEFR levels: A2 elementary · B1 intermediate · B2 upper-intermediate (can discuss complex topics) · C1 advanced · C2 proficient. Pick the closest — it is only used to balance the rooms.",
      "lobby.name-label": "Your name (first name or nickname)",
      "lobby.name-placeholder": "e.g. Alice / Akari",
      "lobby.consent-workshop": "I have read the data-use notice above and consent to taking part in this CaNaMED workshop.",
      "lobby.consent-workshop-detail": "My first name, university, year, English level and the text I type during the workshop will be visible to the other people in my room and to the facilitators.",
      "lobby.consent-research": "I additionally consent to my contributions — my answers, the questions and examinations I choose and their order, my votes, my scores and my free-text — being recorded and linked to me (identifiably) for the CaNaMED education-research project (analysis and publication). Only the study facilitators see my identity; other participants do not. I understand that I can take part in the workshop without ticking this second box — refusing has no effect on my participation, my grades or my standing at my university.",
      "lobby.consent-verification": "I additionally consent to my certificate being independently verifiable: a verification ID printed on the certificate is linked, in a separate registry, to a one-way hash of my name + session, so that a third party who is given BOTH my certificate ID AND the name on it can confirm — on a public CaNaMED page — that they match a real CaNaMED certificate. The page does not publish my name; it only returns \"valid\" or \"no match\" when both inputs are supplied. The registry is retained for up to 10 years and I can ask for my entry to be removed at any time (see the privacy policy, section 18). I understand I can take part and consent to the research without ticking this third box.",
      "lobby.consent-version": "Notice version PIS v2 · 2026-05. Full ",
      "lobby.consent-version-link": "privacy policy",
      "lobby.consent-version-suffix": ".",
      "lobby.consent-required-hint": "Please read the data-use notice and tick the consent box above to take part.",
      "lobby.consent-required-title": "Tick the workshop-consent box above to enable this button.",
      "lobby.session-code-label": "Session code",
      "lobby.session-code-placeholder": "e.g. ABC-DEF",
      "lobby.name-required-hint": "Enter your name.",
      "lobby.session-required-hint": "Enter the session number.",
      "lobby.university-required-hint": "Please select your university.",
      "lobby.join-btn": "Join the waiting room",
      // session code field on the lobby (above the join form)
      "lobby.session-code-label": "Session code",
      // admin / super-admin lobby section
      "lobby.admin-toggle": "I am a facilitator ›",
      "lobby.admin-pass-label": "Admin password",
      "lobby.admin-pass-placeholder": "session password",
      "lobby.admin-open-dashboard": "Open admin dashboard",
      "lobby.superadmin-toggle": "Super admin: set / change the password",
      "lobby.superadmin-key-label": "Super-admin key",
      "lobby.superadmin-key-placeholder": "super-admin key",
      "lobby.new-pass-label": "New session password",
      "lobby.new-pass-placeholder": "new session password",
      // R3-D3: confirm-password label/placeholder + R3-D2: forgot link.
      "lobby.new-pass-confirm-label": "Confirm new password",
      "lobby.new-pass-confirm-placeholder": "confirm new password",
      "lobby.forgot-pass-link": "Need to set or recover the admin password? ›",
      "lobby.superadmin.disabled": "Super-admin is disabled on this deployment.",
      "lobby.superadmin.bad-key": "Incorrect super-admin key.",
      "lobby.superadmin.no-new-pass": "Enter a new session password to set.",
      "lobby.superadmin.confirm-mismatch": "The two password fields do not match — please re-type the new password.",
      // D21 — recovery-code field + reset error messages.
      "lobby.recovery-code-label": "Recovery code (to reset a forgotten password)",
      "lobby.recovery-code-placeholder": "xxxx-xxxx-xxxx",
      "lobby.superadmin.bad-recovery": "That recovery code doesn’t match this session. Check the code you saved when the session was created.",
      "lobby.superadmin.db-error": "Could not reach the session database.",
      "lobby.save-pass-btn": "Save password & open dashboard",
      // join-form validation messages (shown in the lobby hint line)
      "lobby.err.name-required": "Enter your name.",
      "lobby.err.session-required": "Enter the session code.",
      "lobby.err.consent-required": "Please read the data-use notice and tick the consent box above to take part.",
      "lobby.err.university-required": "Please select your university.",

      // lobby — privacy / data-use notice (GDPR Art. 13/14 information notice).
      // Keys carry small inline <strong> / <em> tags via data-i18n-html so that
      // legally meaningful emphasis survives translation. Author-controlled
      // content only — safe under CSP.
      "lobby.privacy.summary": "How your data is used (please read before joining)",
      "lobby.privacy.p1": "The CaNaMED research team (<strong>Université de Caen Normandie × Nagoya University</strong>, joint controllers under GDPR Art. 26 / joint users under APPI Art. 27(5)) collects your first name or nickname, university, year of study and self-assessed English level. Your name is visible to everyone in your room and appears next to the points you contribute.",
      "lobby.privacy.p2": "The free-text answers you write may disclose health-related, religious or philosophical opinions about clinical scenarios — <strong>special-category data</strong> under GDPR Art. 9 and <strong>要配慮個人情報</strong> under APPI Art. 2(3). The optional second consent box below covers this.",
      "lobby.privacy.p3": "Data is stored on Google Firebase Realtime Database in <strong>europe-west1 (Belgium, EU)</strong>. For Japanese participants this is a cross-border transfer protected by the EU–Japan mutual adequacy decision (PPC, 2019). Live session data is purged within 7 days; if you ticked the research-consent box your contributions are kept linked to you (identifiable) for up to 5 years after publication.",
      "lobby.privacy.p4": "<strong>Signing in with Google is optional.</strong> If you do, a small profile and a list of session codes you have joined are tied to your Google account; you can edit or delete this at any time from the \"My account\" panel. Anonymous joining works exactly the same way.",
      "lobby.privacy.p5": "You can withdraw your consent at any time. Whether you tick the second consent box has <strong>no effect on your grade, your standing at your university, or your participation in the workshop.</strong> To exercise any right (access, correction, deletion, portability, restriction, objection, withdrawal, complaint), contact your facilitator or write to <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> (see the <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">full privacy policy</a> for the stable mailbox).",
      "lobby.privacy.p6": "The <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">full privacy policy</a> lists the controllers' identities, the legal bases, the joint-use items, the international-transfer safeguards, retention periods, your rights with response times, and the ethics-committee approvals. Please read it once before joining.",

      // waiting room
      "waiting.title": "Waiting room",
      "waiting.you-are": "You are",
      "waiting.leave": "Leave",
      "waiting.status-not-started": "You have joined. Waiting for a facilitator to start the session…",
      "waiting.status-starting": "The session has started — placing you in a room…",
      "waiting.heading": "You have joined",
      "waiting.body": "Hi <strong id=\"waiting-name\"></strong> — you are in the waiting room. A facilitator will place you in a mixed {cohortPair} room and start the session shortly. <strong>Your screen will move automatically</strong> — nothing to do.",
      "waiting.teams-btn": "Join the Teams call",
      "waiting.joined-so-far": "Joined so far",

      // late-join banner (R3-C1). Shown when a participant lands in a room
      // that has already advanced past stage 0. {stage} is replaced at
      // runtime with the current stage's localised name via stageLabel(i).
      "waiting.late-join.banner": "You joined while your room is already on “{stage}”. Earlier stages happened before you arrived — use “← Review previous stage” at any time to read them.  ",
      "waiting.late-join.dismiss": "Got it",

      // data-rights — GDPR Art. 15 (right of access) participant self-export
      "data-rights.export-btn": "Download my data (JSON) ⤓",
      "data-rights.err.no-session": "Join a session first — there's nothing to export yet.",
      "data-rights.err.not-ready": "The platform is still initialising. Please try again in a moment.",
      "data-rights.err.export-failed": "Could not export your data — please try again, or contact the facilitator.",

      // stage labels — shown in the room header + stage indicator + dashboard
      "stage.label.0": "Welcome",
      "stage.label.1": "Module A — Chronic Pain",
      "stage.label.2": "Module B — Breaking Bad News",
      "stage.label.3": "Wrap-up",

      // stage 0 (Welcome) chrome
      "stage.welcome.title": "Welcome to Session 3",
      "stage.welcome.intro": "Theme: Learning From Each Other — a student-led exchange session. Everything for today runs from this platform. You move through the session together; a facilitator advances your room from one block to the next.",
      "stage.welcome.grade-note": "Your grade and your standing are not affected by this workshop. The points the platform awards are for in-session learning only — they do not contribute to your university grade. If you disagree with a point or a penalty, tell your facilitator; scoring is reviewable.",

      // room chrome
      "room.call-facilitator": "Call a facilitator",
      // accessible labels for inputs that otherwise rely on placeholder text
      // only (insufficient for screen readers — placeholders are not labels)
      "room.team-name-label": "Team name",
      // Team-name save feedback (user-visible instead of silent failures)
      "room.team-name.empty": "Type a team name first.",
      "room.team-name.not-ready": "Not ready yet — try again in a second.",
      "room.team-name.saving": "Saving…",
      "room.team-name.saved": "Team name saved —",
      "room.team-name.error": "Could not save the team name — check your connection and try again.",
      "room.answer-input-label": "Add a Module A group answer",
      "room.answer-input-label-b": "Add a Module B group answer",
      // call-a-facilitator throttle messages (when a student spam-clicks
      // the help button). {seconds} is interpolated client-side.
      "room.call.throttle-recall": "Please wait {seconds}s before re-calling a facilitator.",
      "room.call.throttle-again": "Please wait {seconds}s before calling a facilitator again.",
      // group-answer edit / delete error alerts (network failures)
      "room.answer.err.edit-failed": "Your edit could not be saved — check your connection. Your text: ",
      "room.answer.err.delete-failed": "That point could not be deleted — check your connection and try again.",
      // language hint + placeholder shown above each answers box
      "room.answer-input-language-hint": "Write in any language — English, French or Japanese. You're not marked on your English; it's your clinical thinking that counts.",
      "room.answer-input-placeholder": "Add a point — it appears with your name and colour",
      // dynamic hint under each answers box (set from script.js)
      "room.answers.hint.moduleA": "Anyone in the room can add a point — it saves automatically. Aim for the four bullets above; both France and Japan should write.",
      "room.answers.hint.moduleB": "Anyone in the room can add a point — it saves automatically. Cover the three bullets above; both France and Japan should write.",
      "room.answers.hint.count-one": "{n} answer so far",
      "room.answers.hint.count-many": "{n} answers so far",
      "room.answers.hint.both-wrote": "✓ both France and Japan have written here",
      "room.answers.hint.one-wrote": "one country has written — invite the other",
      "room.answers.hint.suffix": "Write in your own words — short and clear is good English here.",

      // admin dashboard preferences
      "admin.mute-alerts": "Mute help-call sound + desktop notification",
      "admin.download-error-log": "Download error log",
      "admin.theme": "Theme",
      "admin.theme.auto": "Auto (system)",
      "admin.theme.light": "Light",
      "admin.theme.dark": "Dark",
      "admin.theme.hc": "High contrast",
      "admin.report-bug": "Report a bug",

      // admin dashboard primary buttons
      "admin.start-session": "Start session — place everyone in rooms",
      "admin.advance-all": "Advance all rooms →",
      "admin.download-all": "Download all group answers",
      "admin.download-md": "Download as Markdown",
      "admin.end-session": "End session & download archive",

      // Module B stage heading
      "stage.modB.title": "Module B — Breaking Bad News: A Cross-Cultural Roleplay",

      // Module B body — the vignette, safety note, SPIKES strip and
      // phase-by-phase roleplay instructions. These strings are long
      // because they teach the SPIKES framework + the cross-cultural
      // family-disclosure ground rules in plain student-facing English.
      // HTML in these strings (<strong>, <em>) is intentional — the
      // wrapper uses innerHTML for the modB.body.* keys (see script.js).
      "stage.modB.vignette.body": "<strong>The situation (read once, together).</strong> Mr / Mrs Tanaka-Martin, <strong>60 years old</strong>, came in for tiredness and weight loss. The tests are back: the diagnosis is a <strong>serious, chronic, life-changing illness</strong> — your group chooses one (for example: a newly diagnosed cancer, advanced heart failure, early Parkinson's disease, or kidney failure needing dialysis). It is <strong>treatable but not curable</strong>, and it will change how the patient lives. The patient does not yet know. Their <strong>adult child</strong> has come with them and is in the room — and at some point will quietly ask you something.",

      "stage.modB.safety.heading": "<strong>Before you start — two things.</strong>",
      "stage.modB.safety.simulation": "<em>This is a simulation.</em> The feelings can still feel real. If anything hits too close to home, you can move into the observer role at any time, no explanation needed. When you debrief, talk about <strong>the physician's choices</strong> — never criticise the person.",
      "stage.modB.safety.language": "<em>English is everyone's second or third language here</em> — that is part of the point. If you cannot find a word, slow down, use a simpler one, or pause. Silence is allowed in this conversation and often helps. Empathy is in your tone, your pace and your face, not in advanced vocabulary.",

      "stage.modB.intro.hint": "This module is a roleplay your group runs together. Work through the four phases in order — an observer keeps time.",

      "stage.modB.phase1.title": "Phase 1 — Set up (6 min)",
      "stage.modB.phase1.intro": "Assign one volunteer to each role; everyone else is an observer. Read your own short brief, then begin.",
      "stage.modB.phase1.role.physician": "<strong>Physician</strong> — you have the test results. Deliver the news honestly and with empathy, and handle whatever happens in the room. Keep SPIKES in mind (see the strip below) but do not recite it. You do not have to \"win\" or fix everything — a good consultation can end with the patient still upset.",
      "stage.modB.phase1.role.patient": "<strong>Patient</strong> — you are 60. You suspected something was wrong but hoped it was nothing. Choose privately how you react, and you may change as the scene goes on. <strong>Decide one thing in advance: deep down, do you want to know everything, or not?</strong> Don't announce it — let the physician discover it.",
      "stage.modB.phase1.role.family": "<strong>Family member (adult child)</strong> — you love your parent and you are frightened. Partway through — not at the start — find a natural moment to <strong>lower your voice and speak to the physician aside</strong>: ask them not to tell your parent everything. Have a reason ready in your head. Keep it quiet and well-meant, not a demand.",
      "stage.modB.phase1.role.observer": "<strong>Observer(s)</strong> — you are the timekeeper and you run Phase 3. Stay silent during the scene. Watch <em>for the SPIKES steps</em>: what built trust, what created distance, and what the physician did at the moment the family member spoke to them. Note one thing the physician <em>said</em> that worked, and one moment that was hard.",

      "stage.modB.spikes.label": "SPIKES",
      "stage.modB.spikes.s": "<strong>S</strong>etting",
      "stage.modB.spikes.p": "<strong>P</strong>erception (what do they already understand?)",
      "stage.modB.spikes.i": "<strong>I</strong>nvitation (how much do they want to know?)",
      "stage.modB.spikes.k": "<strong>K</strong>nowledge (news in small, plain pieces)",
      "stage.modB.spikes.e": "<strong>E</strong>motions (name and acknowledge the feeling)",
      "stage.modB.spikes.s2": "<strong>S</strong>trategy (agree the next step; you won't abandon them)",

      "stage.modB.spikes.useful.label": "Useful sentences (English is everyone's second language):",
      "stage.modB.spikes.useful.examples": "\"I'm afraid I have some serious news.\" · \"Would you like me to explain everything, or focus on what we do next?\" · \"I can see this is hard to hear.\" · \"Take your time.\" · \"What questions do you have for me?\"",
      "modB.obs.title": "Observer's SPIKES checklist — tick what you see, note one win + one hard moment",
      "modB.obs.hint": "Just for you — tick a step when the physician does it, and jot the moments you'll raise in the debrief. Saved on this device only.",
      "modB.obs.s": "Setting — set up privately, sat down, no interruptions",
      "modB.obs.p": "Perception — asked what the patient already understands",
      "modB.obs.i": "Invitation — asked how much they want to know",
      "modB.obs.k": "Knowledge — gave a warning shot, then news in small plain pieces",
      "modB.obs.e": "Emotions — named and acknowledged the feeling, allowed silence",
      "modB.obs.s2": "Strategy — agreed a next step; signalled they won't be abandoned",
      "modB.obs.win-label": "One thing the physician SAID that worked:",
      "modB.obs.win-ph": "e.g. \"I can see this is hard to hear\" — she paused and let them react",
      "modB.obs.hard-label": "One moment that was hard or could improve:",
      "modB.obs.hard-ph": "e.g. gave the prognosis number before the patient asked for it",

      "stage.modB.phase2.title": "Phase 2 — Play it out (12 min scene + 3 min swap)",
      "stage.modB.phase2.intro": "The observer says \"start\": the patient is already seated, the physician begins. The physician delivers the news and handles the family member's request in the moment. Observers stay silent; the observer calls \"time\" at the end. <strong>Then swap and run it again</strong> with a different physician — over the two runs, at least one Caen and one Nagoya student must take the physician role. The second run is almost always better, and that improvement is worth discussing.",

      "stage.modB.framework.label": "<strong>When the family asks you to withhold information — \"Pause · Explore · Explain · Realign\":</strong>",
      "stage.modB.framework.pause": "<strong>Pause</strong> — don't refuse or agree on the spot. Thank them; their worry is real and usually loving.",
      "stage.modB.framework.explore": "<strong>Explore the <em>why</em></strong> — \"Help me understand what worries you most about your parent knowing.\"",
      "stage.modB.framework.explain": "<strong>Explain your position</strong> — you cannot deceive a patient who wants to know, but you do not have to force information on someone who does not.",
      "stage.modB.framework.realign": "<strong>Realign</strong> — ask the <em>patient</em> how much they want to know and who they want involved (this is SPIKES' \"Invitation\"). The family's worry becomes part of the conversation, not a secret kept from the patient.",

      "stage.modB.phase3.title": "Phase 3 — The exchange (15 min)",
      "stage.modB.phase3.ground-rule": "<strong>Ground rule for this discussion (Phase 3):</strong> we are comparing <em>practices and how they are changing</em>, not ranking countries. Neither model is \"the advanced one\". Speak about what you have actually seen or been taught — and it is completely fine to say \"I'm not sure, this is changing.\"",
      "stage.modB.phase3.intro": "Take the prompts one at a time — for each, make sure both a Caen and a Nagoya voice answers:",
      "stage.modB.phase3.q1": "<strong>Who is the information for?</strong> When there is serious news, who is told <em>first</em> — the patient or the family? Is that what the law says, the textbook says, or what actually happens on the ward? Name one way France and Japan are the <strong>same</strong> and one way they <strong>differ</strong>.",
      "stage.modB.phase3.q2": "<strong>Has it changed?</strong> Was disclosure done differently 20–30 years ago? (Japan: cancer-diagnosis disclosure rose from under ~30% in the early 1990s to ~94% by 2016. France: the 2002 <em>loi Kouchner</em> changed patients' information rights.) Why do norms change — law, generations, expectations?",
      "stage.modB.phase3.q3": "<strong>The family's quiet request — what did you actually do, and why?</strong> Would a typical doctor in France respond the same way as one in Japan? What is each most worried about — lying to the patient, or harming the patient? Is \"protecting someone from bad news\" love, or taking away their choice — or both?",
      "stage.modB.phase3.q4": "<strong>Autonomy vs. family — is it really either/or?</strong> France is described as \"autonomy first\", Japan as \"family-centred\" — but French law also protects the right <em>not</em> to know, and many Japanese patients today want full information. Where does your country actually sit? What would a <em>both</em> model look like?",
      "stage.modB.phase3.q5": "<strong>Empathy across a language barrier.</strong> You broke bad news in English. Did Caen and Nagoya students lean on different things — words, silence, tone, body language? What survives the language barrier, and what gets lost?",
      "stage.modB.phase3.q6": "<strong>What was hard — and was it hard in the same way?</strong> Did Caen and Nagoya students find <em>different</em> parts hard (the silence? the family member? saying the diagnosis out loud? not fixing the distress?)? What does that difference tell you?",

      "stage.modB.phase4.title": "Phase 4 — Write your bullets (5 min)",
      "stage.modB.phase4.intro": "In the Group answers box below (the facilitators collect these at the end):",
      "stage.modB.phase4.b1": "One concrete sentence your group would use to answer the family's request to withhold information.",
      "stage.modB.phase4.b2": "One way disclosure practice <strong>differs</strong> between France and Japan — and one way it is <strong>converging</strong>.",
      "stage.modB.phase4.b3": "One thing each of you will do differently, in your own country, because of this discussion.",

      "stage.modB.answers.title": "Group answers — Module B",

      // Module B — synced phase navigation + Phase-3 one-at-a-time (2026-05-27)
      "modB.phase.prev": "← Previous",
      "modB.phase.next": "Next →",
      "modB.phase.indicator": "Phase {n} / 4",
      "modB.exchange.prev": "← Previous",
      "modB.exchange.next": "Next →",
      "modB.exchange.counter": "Prompt {n} / {total}",
      "modB.exchange.done": "✓ You've worked through all six prompts. Move to Phase 4 to write your team's bullets.",
      "modB.exchange.reply.placeholder": "Type a short note from your group's discussion — anyone in the room can edit and it autosaves.",

      // ────────────────────────────────────────────────────────────────
      // Natural-flow refactor (2026-05-18): the Module A "instructions"
      // and Module B "instructions-open" walls were replaced with a
      // phase stepper + structured Group-answers form + small inline
      // hints. Only EN canonical strings are added here; other locales
      // fall back via tc() until a coverage pass is run.
      // ────────────────────────────────────────────────────────────────

      // Module A — phase stepper
      "modA.phase.setup.label": "Set up",
      "modA.phase.setup.time": "2 min",
      "modA.phase.case.label": "Work the case",
      "modA.phase.case.time": "22 min",
      "modA.phase.exchange.label": "The Exchange",
      "modA.phase.exchange.time": "10 min",
      "modA.phase.bullets.label": "Write bullets",
      "modA.phase.bullets.time": "5 min",

      // Module A — vignette hints
      "modA.vignette.hint": "Decide what to <em>ask</em>, <em>examine</em> and <em>investigate</em> — each result is revealed on request. Completing the clinical synthesis unlocks the discussion prompts.",
      "modA.vignette.everyone": "👥 <strong>Work as equals — every voice in the room.</strong> Before you finish a \"Compare France &amp; Japan\" prompt, check that both a Caen <em>and</em> a Nagoya voice have spoken.",

      // Module A — Discussion-panel banner
      "modA.discussion.compare-rule": "🗣️ <strong>Compare prompts:</strong> both a Caen <em>and</em> a Nagoya voice must speak before you move on. The point is to compare and debate, not to agree quickly.",

      // Module A — structured Group-answers form
      "modA.answers.title": "Group answers — Module A",
      "modA.answers.bullet.plan.label": "1. Your group's first-line plan for the patient",
      "modA.answers.bullet.plan.placeholder": "e.g. NSAID + active rehab; reassess in 4 weeks",
      "modA.answers.bullet.differ.label": "2. One way France and Japan genuinely <strong>differ</strong> on this case",
      "modA.answers.bullet.differ.placeholder": "e.g. how readily opioids are prescribed for chronic pain",
      "modA.answers.bullet.disagree.label": "3. One thing your group <strong>disagreed</strong> about and could not fully resolve",
      "modA.answers.bullet.disagree.placeholder": "e.g. whether imaging is reassuring or a waste of resources",
      "modA.answers.bullet.takehome.label": "4. One thing you each take home",
      "modA.answers.bullet.takehome.placeholder": "one sentence per person",
      "modA.answers.bullet.unsorted.label": "Other points (not yet attached to a bullet)",

      // Module B — phase stepper time chips (titles re-use existing
      // stage.modB.phaseN.title keys for cross-version stability)
      "modB.phase.setup.time": "6 min",
      "modB.phase.play.time": "12 + 3 min",
      "modB.phase.exchange.time": "15 min",
      "modB.phase.bullets.time": "5 min",

      // Module B — role picker
      "modB.roles.prompt": "<strong>Pick your role</strong> for this roleplay. Everyone not in a named role is an observer (timekeeper + Phase 3 facilitator).",
      "modB.role.physician.name": "Physician",
      "modB.role.physician.brief": "Deliver the news with empathy. Keep SPIKES in mind but don't recite it. A good consultation can end with the patient still upset.",
      "modB.role.patient.name": "Patient (60)",
      "modB.role.patient.brief": "You suspected something was wrong. <strong>Decide privately: deep down, do you want to know everything or not?</strong> Let the physician discover it.",
      "modB.role.family.name": "Family (adult child)",
      "modB.role.family.brief": "Partway through — not at the start — quietly take the physician aside and ask them not to tell your parent everything.",
      "modB.role.observer.name": "Observer",
      "modB.role.clash": "Two of you picked the same role — decide together so everyone has a part.",
      "modB.role.deselect-hint": "Picked the wrong role? Tap it again to clear your choice.",
      "modB.role.objective-label": "Your private brief — only you see this:",
      "modB.replay.round1": "Round 1 — first run",
      "modB.replay.roundN": "Round {n}",
      "modB.replay.swap": "🔄 Swap roles & replay",
      "modB.replay.swapped": "You've swapped seats — notice how the conversation feels from here.",
      "modB.replay.fromto": "You were the {old} — now you're the {new}.",
      "modB.replay.full": "Everyone has now played every role — nicely done.",
      "modB.observe.escape": "I'd rather just observe — that's completely okay",
      "modB.observe.reassure": "That's completely fine — you're observing now. Watch the SPIKES steps, and step back in whenever you're ready.",
      "modB.role.observer.brief": "You time the scene and run Phase 3. Watch the SPIKES steps — note one thing the physician <em>said</em> that worked and one moment that was hard.",

      // Module B — structured Group-answers form
      "modB.answers.bullet.family-sentence.label": "1. One concrete sentence your group would use to answer the family's request to withhold information",
      "modB.answers.bullet.family-sentence.placeholder": "e.g. \"Let me first ask your parent how much they want to know...\"",
      "modB.answers.bullet.differ-converge.label": "2. One way disclosure practice <strong>differs</strong> between France and Japan — and one way it is <strong>converging</strong>",
      "modB.answers.bullet.differ-converge.placeholder": "e.g. differs on family-first vs patient-first; converges toward shared decision-making",
      "modB.answers.bullet.practice-change.label": "3. One thing each of you will do differently, in your own country, because of this discussion",
      "modB.answers.bullet.practice-change.placeholder": "one sentence per person",
      "modB.answers.bullet.unsorted.label": "Other points (not yet attached to a bullet)",

      // Shared button label used by every "Add" button in the new
      // bulleted form. Kept short so it fits next to the input.
      "room.answer.add": "Add",

      // "What to do next" coach (under each phase stepper) — replaces
      // the deleted instruction walls with state-aware, single-line
      // guidance. State machine in updateModANextStep / updateModBNextStep.
      "coach.dismiss": "Hide this guidance for the rest of the session",
      "reference-section.title": "📚 Background & guidelines (open when you need them)",

      // Chart-metaphor framing (2026-05-18 pedagogist's strongest claim)
      "modA.chart.title": "Your consultation note — <em>M. Lefebvre</em>, today",
      "modA.chart.team-click-warning": "👥 <strong>Every click is a team decision.</strong> Anything you ask, examine, investigate or decide is recorded for <em>everyone</em> in your room — and counts as the team's choice. <strong>Discuss first, then click together.</strong>",
      // Locked-decision UI (per 2026-05-18 PBL specialist panel)
      "modA.decision.ready-when": "Ready when:",
      "modA.decision.unlocked": "A new team decision just opened",
      "modA.decision.unlock.hypotheses": "add a working hypothesis",
      "modA.decision.unlock.history": "ask the patient at least once",
      "modA.decision.unlock.exam": "examine at least once",
      "modA.decision.unlock.labs": "run at least one investigation",
      "modA.decision.unlock.synthesis": "complete the clinical synthesis",
      "modA.decision.unlock.after": "the team locks in the previous decision",
      "modA.chart.subtitle": "You and your partners are the clinicians seeing M. Lefebvre. Everything you ask, examine, investigate or decide goes into <em>your shared chart</em>.",
      "modA.chart.hypotheses.title": "Working hypotheses",
      "modA.chart.hypotheses.hint": "Now that you've taken a history and examined the patient, agree as a team: <strong>what do you suspect?</strong> List 2 or more differentials you want to rule in or rule out. (Investigations unlock once you have a hypothesis AND have completed the red-flag screen + leg neuro exam.)",
      "modA.chart.impressions.title": "First impressions (optional)",
      "modA.chart.impressions.hint": "Your gut-feel before you ask the patient. Just for you — no one else sees this, and you'll come back to refine it after History + Examination.",
      "modA.chart.impressions.placeholder": "A line or two — what do you suspect, what would surprise you?",
      "modA.chart.hypotheses.placeholder": "e.g. \"mechanical low back pain\"",
      "modA.chart.hypotheses.add": "Add",
      "modA.chart.hypotheses.empty": "No hypotheses yet — add one below.",
      "modA.chart.history.title": "History — ask the patient",
      "modA.history.sub.primary": "First questions to ask",
      "modA.history.sub.more": "More questions to ask",
      "modA.chat.disclosure": "Beta. A language model voices Mr. Lefebvre. Your typed questions are sent to our server and to Hugging Face (US/EU) as a third-party sub-processor. <strong>Do not type names, contact details, or anything personal.</strong> Type only what you would ask in a real consultation. See the <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">privacy policy</a>.",
      "modA.chat.consentCta": "I understand — start the consultation",
      "modA.chat.consentRequired": "Please confirm the notice above before sending your first question.",
      "modA.chat.placeholder": "Ask Mr. Lefebvre a question…",
      "modA.chat.send": "Send",
      "modA.chat.thinking": "Mr. Lefebvre is thinking…",
      "modA.chat.fallbackNotice": "Patient endpoint unavailable — using a stub reply so the team can keep going.",
      "modA.chat.error": "Something went wrong — try a different question.",
      "modA.contrib.acted": "contributed",
      "modA.contrib.not-yet": "not yet",
      "modA.glossary.marker-label": "has a plain-language definition",
      "modA.chart.exam.title": "Examination",
      "modA.chart.investigations.title": "Investigations & synthesis",
      "modA.chart.investigations.locked-hint": "You can order any investigation at any time — but ordering one that isn't indicated, or before screening the red flags, costs points. The clinical synthesis unlocks once you've screened the red flags (serious causes, cauda equina, leg neuro).",
      "modA.coach.add-hypothesis": "You've gathered some info — now agree on at least one working hypothesis above (what do you suspect?) before you commit to investigations and a plan.",
      "modA.coach.read-case": "Read the case below, then tap any button on the left (Ask the patient / Examine / Investigations) to start gathering info.",
      "modA.coach.gather": "Keep gathering case info — when you're ready, complete the clinical synthesis (red-flag review) to unlock the Discussion prompts.",
      "modA.coach.open-discussion": "✓ Synthesis done! Open Discussion to start the Exchange. Make sure both Caen and Nagoya voices speak on each compare prompt.",
      "modA.coach.in-discussion": "Debate the prompts with your group — when you're ready, open Group answers to capture your 4 bullets.",
      "modA.coach.bullets-partial": "Capturing bullets — {n} still to add to cover all 4.",
      "modA.coach.bullets-complete": "✓ All 4 bullets covered. Add more refinements or wait for your facilitator.",
      "modA.coach.btn.open-discussion": "Open Discussion →",
      "modA.coach.btn.open-answers": "Open Group answers →",
      "modA.coach.synthesis-unlocked": "✓ <strong>Synthesis done — Phase 3 is open.</strong> The 6 discussion prompts are below. Both Caen and Nagoya voices must speak on each comparison prompt.",
      "modB.coach.pick-role": "Pick your role below before starting the roleplay. The observer keeps time.",
      "modB.coach.roleplay": "Roles set! Run the scene — Phase 2 is the roleplay, Phase 3 is the discussion with the prompts below.",
      "modB.coach.bullets-partial": "Capturing bullets — {n} still to add to cover all 3.",
      "modB.coach.bullets-complete": "✓ All 3 bullets covered. Add more refinements or wait for your facilitator.",

      // wrap-up stage (stage-3) — the last thing students see in the room
      "stage.wrap.title": "Wrap-up & Next Steps",
      "stage.wrap.thanks": "Thank you for taking part! Before you go:",
      "stage.wrap.do-questionnaire": "Complete the end-of-session questionnaire — it only takes a few minutes, and there is a short post-test in 3 weeks.",
      "stage.wrap.answers-saved": "Your group's answers are saved below — your facilitators will collect them.",
      "stage.wrap.open-questionnaire": "Open the end-of-session questionnaire",
      "stage.wrap.questionnaire-fallback": "Your facilitator will share the questionnaire link.",
      "stage.wrap.bye": "Once you've done the questionnaire you can close this tab. See you at Session 4!",
      "stage.wrap.room-answers": "Your room's answers",
      "stage.wrap.download": "⤓ Download my session takeaway (Markdown)",
      "stage.wrap.takehome.title": "🎓 Take it with you",
      "stage.wrap.takehome.hint": "Two PDFs to keep: a study booklet to revise from, and your certificate of attendance.",
      "stage.wrap.booklet": "📘 Download the study booklet (PDF)",
      "stage.wrap.cert": "🎓 Download your certificate of attendance (PDF)",
      "stage.wrap.retention.title": "🔁 Test your retention in a few days",
      "stage.wrap.retention.hint": "Save this link and come back in 2–3 days for a short self-check — revisiting is what makes it stick. It scores on your device; nothing is sent.",
      "stage.wrap.retention.link": "Open my retention check →",

      // pre/post knowledge test (per-scenario in-platform MCQ) — optional;
      // students can always skip. Pre-test shown on the Welcome stage,
      // post-test on the Wrap-up stage.
      "test.pre.title": "Quick pre-session knowledge check",
      "test.pre.intro": "Before today's workshop starts, your facilitator has set up a short multiple-choice check on the scenario you're about to discuss. It's optional and your answers do not affect your grade; your answers are linked to you for the CaNaMED study.",
      "test.pre.start": "Start the pre-test",
      "test.post.title": "Quick post-session knowledge check",
      "test.post.intro": "Now that the workshop is finished, a short multiple-choice check helps us see what changed during today's session. It's optional and your answers do not affect your grade; your answers are linked to you for the CaNaMED study.",
      "test.post.start": "Start the post-test",
      "test.question": "Question {n} of {total}",
      "test.submit": "Submit answer",
      "test.next": "Next question →",
      "test.see-results": "See your results →",
      "test.skip": "Skip the test",
      "test.skip-question": "Skip this question",
      "test.correct": "Correct",
      "test.incorrect": "Not quite",
      "test.complete": "Test complete",
      "test.score-line": "You scored {n} out of {total}.",
      "test.thanks": "Thank you — your answers help us improve the workshop. They are linked to you and used for the CaNaMED study.",
      "test.skipped": "You skipped the test. You can take it now if you change your mind.",
      "test.already-done": "You have already taken this test today. Thank you!",
      "test.error-save": "We could not save your answer right now — your in-session points are not affected.",
      // R3-C4 (Akari late-join): the pre-test card replaces its start / skip
      // buttons with this notice when a late-joiner views "Welcome" after
      // their room has already entered Module A. The post-test still runs.
      "test.late-join-closed": "The pre-test closed when your room started. It's only meaningful when taken before the workshop begins — your post-test at the end of the session will still count.",

      // end-of-session feedback survey (in-platform questionnaire on Wrap-up)
      "survey.title": "Your feedback on today's session",
      "survey.intro": "A short questionnaire helps us improve future sessions. Your answers are linked to you for the CaNaMED study; it's optional and does not affect your grade.",
      "survey.start": "Start the questionnaire",
      "survey.skip": "Skip",
      "survey.skipped": "You skipped the questionnaire. You can still complete it if you change your mind.",
      "survey.already-done": "You have already completed the questionnaire. Thank you!",
      "survey.choose": "Choose…",
      "survey.prefilled": "Filled in from your profile — edit if it's not right.",
      "survey.submit": "Send my answers",
      "survey.thanks": "Thank you — your feedback helps us shape the next session. It is linked to you and used for the CaNaMED study; only the facilitators see your identity.",
      "survey.likert.1": "Strongly disagree",
      "survey.likert.2": "Disagree",
      "survey.likert.3": "Neutral",
      "survey.likert.4": "Agree",
      "survey.likert.5": "Strongly agree",

      // closed banner (interim, before the full session-ended screen takes over)
      "closed.title": "Session closed by the facilitator.",
      "closed.subtitle": "Thank you for taking part — your team's work has been saved.",

      // session-ended full-page screen
      "ended.title": "Thank you for taking part",
      "ended.message": "Your facilitator has ended this session. Your team's contributions have been saved.",
      "ended.questionnaire": "Open the end-of-session questionnaire →",
      "ended.future": "If you join a future CaNaMED workshop you will receive a new session code.",
      "ended.return": "Return to CANAMED",

      // offline / service-worker banner
      "offline.banner": "You are offline. Trying to reconnect…",

      // post-session debrief — facilitator dashboard panel
      "debrief.toggle": "Open debrief",
      "impact.button": "📊 Impact report",
      "impact.accred": "📋 Accreditation evidence",
      "impact.research": "🔬 Research export",
      "impact.research-csv": "📊 Research export (CSV)",
      "impact.roster": "📧 Email roster (CSV)",
      "impact.attest": "🎓 Attestations",
      "impact.program": "📈 Program overview",
      "impact.guide": "📖 Facilitator guide",
      "impact.compliance": "🛡 Compliance & accessibility",
      "impact.itemdiff": "🧭 Item difficulty",
      "impact.cohort": "🌍 Cohort comparison",
      "debrief.toggle-close": "Close debrief",
      "debrief.title": "Session debrief",
      "debrief.subtitle": "Aggregate stats across all rooms — useful for the wrap-up conversation.",
      "debrief.empty": "Start the session to see aggregate stats here.",
      "debrief.section.ranking": "Room ranking",
      "debrief.section.decisions": "Decision breakdown",
      "debrief.section.penalties": "Penalty heatmap",
      "debrief.section.concepts": "Concept coverage",
      "debrief.section.funnel": "Participation funnel",
      "debrief.section.time": "Time on stage",
      "debrief.col.room": "Room",
      "debrief.col.team": "Team",
      "debrief.col.score": "Score",
      "debrief.no-data": "No data yet.",
      "debrief.no-commit": "No room has locked this in yet.",
      "debrief.rooms-picked": "rooms",
      "debrief.correct-option": "(correct)",
      "debrief.module-a": "Module A",
      "debrief.module-b": "Module B",
      "debrief.penalty-fired": "fired",
      "debrief.penalty-rooms": "rooms affected",
      "debrief.concept.rooms-hit": "rooms hit",
      "debrief.funnel.registered": "Joined the pool",
      "debrief.funnel.assigned": "Assigned to a room",
      "debrief.funnel.answered": "Answered ≥1 prompt",
      "debrief.funnel.voted": "Voted on a decision",
      "debrief.time.minutes": "min",
      "debrief.time.stage": "Stage",
      "debrief.points-per-room": "points / room",

      // per-student debrief card (replaces the closed banner for participants)
      "debrief.student.title": "Your team's debrief",
      "debrief.student.score": "Your team scored",
      "debrief.student.score-suffix": "points",
      "debrief.student.decisions-locked": "decisions locked in",
      "debrief.student.agreed": "Decisions where your team chose the safest answer",
      "debrief.student.disagreed": "Decisions to revisit",
      "debrief.student.top-concept": "Top concept your team hit",
      "debrief.student.missed-concept": "Concept your team didn't surface",
      "debrief.student.engaged": "Most engaged moment",
      "debrief.student.engaged-detail": "spent on",
      "debrief.student.closing": "Thank you for taking part — every contribution helps the partnership grow.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "Your team's contributions have been saved.",
      "debrief.student.team-label": "Your team",

      // first-time facilitator onboarding tour (create-session view + admin dashboard)
      "tour.btn.next": "Next",
      "tour.btn.back": "Back",
      "tour.btn.skip": "Skip tour",
      "tour.btn.done": "Got it",
      "tour.btn.close": "Close",
      "tour.progress": "Step {n} of {total}",
      "tour.reopen": "Show tour again",

      "tour.create.1.title": "Workshop label",
      "tour.create.1.body": "Give this session a friendly name (e.g. \"Caen × Nagoya — June 2026\"). Optional, but it helps later when you clone it for the next cohort.",
      "tour.create.2.title": "Pick the scenario",
      "tour.create.2.body": "Choose the clinical content your students will work through. You can also paste a custom scenario as JSON for advanced use.",
      "tour.create.3.title": "Set a session password",
      "tour.create.3.body": "Only the facilitators should know this — you'll need it to re-open the dashboard later. Choose something you can share with your co-facilitators on the day.",
      "tour.create.4.title": "Create and share",
      "tour.create.4.body": "When you click Create session, you get a short code (and a QR) to share with students. You'll then jump straight into the admin dashboard.",

      "tour.admin.1.title": "Your rooms at a glance",
      "tour.admin.1.body": "Each card here is one room. You see the current stage, who is in it, the team's score and any call for a facilitator.",
      "tour.admin.2.title": "Advance the whole session",
      "tour.admin.2.body": "Use \"Advance all rooms\" to move every room forward in sync, or use the per-room arrows to pace one room independently.",
      "tour.admin.3.title": "Open a room",
      "tour.admin.3.body": "Click \"Open room\" to see exactly what students see, with a side panel to switch between rooms without losing context.",
      "tour.admin.4.title": "End and archive",
      "tour.admin.4.body": "When you're done, end the session and download the archive. Group answers, votes and scores are exported as a single JSON file.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "Settings",
      "settings.title": "Settings",
      "settings.restart-tour": "Show introduction tour again",
      "settings.close": "Close",
      "tour.student.1.title": "Welcome to the room",
      "tour.student.1.body": "This is your team's space for the whole session. A quick tour to show the controls you'll use most.",
      "tour.student.2.title": "Name your team",
      "tour.student.2.body": "Pick a fun team name together — anyone in the room can set it. It shows on the live leaderboard.",
      "tour.student.3.title": "Findings log",
      "tour.student.3.body": "When you ask, examine or order a test, the patient's response appears here. On phones it also shows up directly under the button you tapped.",
      "tour.student.4.title": "Team decisions",
      "tour.student.4.body": "When a decision card appears, everyone taps their choice. Once enough teammates vote, lock in the team's answer together.",
      "tour.student.5.title": "Group answers",
      "tour.student.5.body": "Use this box to add short bullet points your team agreed on. Everyone sees them update live.",
      "tour.student.6.title": "Call a facilitator",
      "tour.student.6.body": "Tap here at any time to ask for help. The facilitator sees your room flagged on their dashboard.",
      "tour.student.7.title": "Language and settings",
      "tour.student.7.body": "Use this dropdown to switch languages at any moment. The cog next to it opens theme and accessibility settings.",
      "tour.studentModA.1.title": "Module A — at a glance",
      "tour.studentModA.1.body": "These four chips track your team's progress against the four bullet questions. Tick them off as you write your group answers.",
      "tour.studentModA.2.title": "The case-workup chart",
      "tour.studentModA.2.body": "Click any history / examination / investigation button to gather information from the patient. Sections collapse automatically once you've covered the key items.",
      "tour.studentModA.3.title": "Team decisions",
      "tour.studentModA.3.body": "Every diagnostic + treatment choice is a TEAM decision. Discuss before committing — choices stick.",

      // admin dashboard search/filter (appears when roomCount > 5)
      "admin.search.placeholder": "Filter rooms by name…",
      "admin.search.clear": "Clear",
      "admin.search.label": "Filter rooms",
      "admin.search.empty": "No rooms match this filter.",

      // Right-column tab labels (Module A panels). User feedback flagged
      // these as the most visible English-only strings once the user has
      // joined a room. Pinned per language so a translator catches a
      // missing key in CI rather than at runtime.
      // Tab labels are activity verbs (per UX/pedagogy review 2026-05-18):
      // "what you DO in this section" beats "the name of the artefact",
      // so students don't have to guess what an empty tab is for.
      "rcol.tab.findings": "What we're finding",
      "rcol.tab.decisions": "Decide together",
      "rcol.tab.discussion": "Debate",
      "rcol.tab.answers": "Our final answers",
      "rcol.tab.reference": "Reference",
      // Lock-state suffix shown on tabs that aren't yet unlocked. The
      // unlock condition is named so students know exactly what to do
      // (specialist panel: "Discussion lies about being available" —
      // explicit lock + unlock condition fixes that).
      "rcol.tab.discussion.locked": "🔒 finish synthesis to unlock",
      // Synthesis prerequisites progress — shown above the disabled
      // "Clinical synthesis" button so students don't have to guess
      // when it'll unlock.
      "modA.synthesis.progress": "{done} / {total} red flags screened",
      "modA.synthesis.unlocked": "✓ Red-flag screen complete — synthesis is unlocked.",

      // Findings + discussion panel chrome (in-room, high-visibility).
      "findings.title": "Findings log",
      "findings.empty": "Nothing asked yet — use the buttons on the left to work the case.",
      "prompts.title": "Discussion prompts",
      "prompts.locked": "Locked — complete the clinical synthesis (red-flag review) to unlock the discussion prompts.",
      // Progressive single-prompt UI (2026-05-18 user request)
      "prompts.reply.placeholder": "Type a short note from your group's discussion — anyone in the room can edit and it autosaves.",
      "prompts.prev": "← Previous",
      "prompts.skip": "Discussed verbally — skip ahead →",
      "prompts.next": "Save and next →",
      "prompts.next.last": "Save and finish →",
      "prompts.done.msg": "✓ <strong>You've worked through all the discussion prompts.</strong> Now capture your team's bullets.",
      "prompts.done.cta": "Open Group answers →",
      "prompts.review": "← Review prompts",

      // Reset button (in-room, destructive — must be discoverable in
      // every UI language so a participant doesn't tap it by mistake).
      "reset.btn": "Reset this room's case",
      "reset.btn-title": "Clear this room's findings"
    }
  };

  let _currentLang = null;

  // ---- lazy locale loading -------------------------------------------------
  // English is bundled inline above as the canonical fallback, so t() always
  // resolves synchronously on first paint. Every OTHER language lives in its
  // own locales/<lang>.js and is fetched on demand: in the browser via a
  // dynamically-injected same-origin <script> (ensureLang — permitted by the
  // script-src 'self' CSP), and under Node via require() (see the eager block
  // near the bottom) so the unit tests still see a complete _T table.
  //
  // LOCALE_VERSION must track the ?v= cache-buster used by the eager scripts
  // in index.html / script-loader.js (SHELL_VERSION) and sw.js so a deploy
  // that bumps the shell version also re-fetches the locale chunks.
  const LOCALE_VERSION = "v4";
  const _localeLoads = {}; // lang -> Promise<table>; de-dupes concurrent loads

  function dispatchLangChange(lang) {
    if (typeof document === "undefined" || typeof CustomEvent !== "function") return;
    try {
      document.dispatchEvent(new CustomEvent("canamed:langchange", { detail: { lang: lang } }));
    } catch (e) { /* CustomEvent unsupported — silent */ }
  }

  function hasTable(lang) {
    return !!(T[lang] && Object.keys(T[lang]).length);
  }

  // Called by locales/<lang>.js once it executes. Pure registration: it only
  // populates the in-memory table. The caller that triggered the load
  // (ensureLang's consumer) is responsible for re-applying translations, so
  // we don't double-walk the DOM here.
  function register(lang, table) {
    if (!lang || !table || typeof table !== "object") return;
    T[lang] = table;
  }

  // Resolve once locales/<lang>.js has executed and registered its table.
  // English (inline) and already-loaded languages resolve synchronously.
  // A failed load rejects AND clears the cache so a later attempt can retry;
  // callers treat rejection as "stay on the current language" (English copy
  // is always present in the static HTML, so nothing breaks).
  function ensureLang(lang) {
    if (lang === "en" || hasTable(lang)) return Promise.resolve(T[lang] || T.en);
    if (_localeLoads[lang]) return _localeLoads[lang];
    if (typeof document === "undefined") return Promise.resolve(T.en);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "locales/" + lang + ".js?v=" + LOCALE_VERSION;
      s.async = true;
      s.addEventListener("load", () => resolve(T[lang] || T.en));
      s.addEventListener("error", () => {
        delete _localeLoads[lang]; // allow a later retry
        reject(new Error("i18n: failed to load locale " + lang));
      });
      (document.head || document.documentElement).appendChild(s);
    });
    _localeLoads[lang] = p;
    return p;
  }

  function detectLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.indexOf(stored) >= 0) return stored;
    } catch (e) { /* localStorage may be unavailable */ }
    const nav = (typeof navigator !== "undefined" && navigator.language)
      ? navigator.language.toLowerCase() : "en";
    if (nav.indexOf("fr") === 0) return "fr";
    if (nav.indexOf("ja") === 0) return "ja";
    if (nav.indexOf("es") === 0) return "es";
    if (nav.indexOf("pt") === 0) return "pt";
    if (nav.indexOf("de") === 0) return "de";
    if (nav.indexOf("ko") === 0) return "ko";
    if (nav.indexOf("zh") === 0) return "zh";
    return "en";
  }

  function t(key) {
    const lang = _currentLang || detectLang();
    const table = T[lang] || T.en;
    let raw;
    if (Object.prototype.hasOwnProperty.call(table, key)) raw = table[key];
    else if (Object.prototype.hasOwnProperty.call(T.en, key)) raw = T.en[key];
    else return key;  // last-ditch: return the key so the missing translation is visible
    // R3 deep-i18n: substitute {cohortPair} from the active COHORTS via
    // lib.js's buildCohortPair, so a Berlin-Tokyo partnership renders
    // "Deutschland-Japan" in DE and "ドイツ-日本" in JA without any
    // i18n.js edit. The substitution is opt-in (only fires when the
    // template contains the placeholder) and gated on lib.js being
    // present so the existing tests/i18n.test.js direct-table reads
    // still pin the raw template form.
    if (typeof raw === "string" && raw.indexOf("{cohortPair}") >= 0) {
      const tplFn = (typeof root !== "undefined" && root.applyTemplate) ||
        (typeof window !== "undefined" && window.applyTemplate) ||
        (typeof global !== "undefined" && global.applyTemplate);
      const pairFn = (typeof root !== "undefined" && root.buildCohortPair) ||
        (typeof window !== "undefined" && window.buildCohortPair) ||
        (typeof global !== "undefined" && global.buildCohortPair);
      const cohorts = (typeof window !== "undefined" && window.COHORTS) ||
        (typeof global !== "undefined" && global.COHORTS) || null;
      if (typeof tplFn === "function" && typeof pairFn === "function") {
        return tplFn(raw, { cohortPair: pairFn(cohorts, lang) });
      }
    }
    return raw;
  }

  function getLang() {
    return _currentLang || detectLang();
  }

  // Returns a Promise that resolves once the language is active AND the DOM
  // (plus any canamed:langchange-driven dynamic re-render) reflects it. For
  // English or an already-loaded locale that's synchronous (a resolved
  // promise); for a not-yet-loaded locale it resolves after the chunk loads
  // and applyI18n + the langchange re-render have run. Callers that need the
  // switch to be complete before reading translated content can `await` it
  // (e.g. `await window.setLang('fr')`); fire-and-forget callers ignore it.
  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) < 0) return Promise.resolve();
    // R3 (Léa step 11): persist + sync the dropdown unconditionally so a
    // user who picks their already-active language still records the
    // choice in localStorage (matters when detection picked the wrong
    // default and the user re-selects the same option to confirm). The
    // expensive DOM re-walk is skipped only when the language is
    // genuinely unchanged.
    const sameAsCurrent = (lang === _currentLang);
    if (!sameAsCurrent) _currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    if (sameAsCurrent) {
      // applyI18n would be a no-op; still emit the event so listeners that
      // rely on it (e.g. the lobby join-btn tooltip) can re-sync defensively.
      dispatchLangChange(lang);
      return Promise.resolve();
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("lang", lang);
    }
    if (lang === "en" || hasTable(lang)) {
      // Locale already in memory — swap synchronously, no flash.
      applyI18n();
      dispatchLangChange(lang);
      return Promise.resolve();
    }
    // Locale not loaded yet. Deliberately DON'T re-apply now: doing so would
    // briefly fall back to English (t() falls back per-key), a worse flash
    // than simply leaving the previous language on screen until the real
    // translation arrives. Fetch it, then apply once. Never rejects — a load
    // failure leaves the UI on the previous language (English copy is inline),
    // which is acceptable, and keeps `await setLang(...)` from throwing.
    return ensureLang(lang).then(() => {
      // The user may have switched again before this resolved — only apply
      // if this is still the active language.
      if (_currentLang === lang) {
        applyI18n();
        dispatchLangChange(lang);
      }
    }).catch(() => { /* load failed — UI stays on the previous language */ });
  }

  // Map a named link to a language-specific URL. R3 deep-i18n: privacy.html
  // is now a single dynamic page; the language is selected by the
  // ?lang=<x> query param (privacy-lang.js reads it on first paint and
  // persists it via localStorage). The legacy privacy-fr.html /
  // privacy-ja.html files redirect to the new URL for bookmark back-compat.
  function localizedHref(name, lang) {
    const l = lang || getLang();
    if (name === "privacy") {
      // Always return the canonical URL; pass ?lang only when needed so
      // that an EN user lands on a clean URL.
      return l && l !== "en" ? "privacy.html?lang=" + l : "privacy.html";
    }
    return null;
  }

  // Defense-in-depth XSS guard for the two data-i18n-html sinks below.
  // The translation table is author-controlled today, but the moment a CMS
  // or remote feed supplies a string this is a stored-XSS sink. Route every
  // innerHTML write through DOMPurify (vendored locally as purify.min.js so
  // it complies with the script-src 'self' CSP — no CDN at runtime).
  //
  // The allowlist mirrors the markup the privacy/legal paragraphs legitimately
  // use: inline emphasis (<strong>/<em>/<b>/<i>/<span>), line breaks (<br>),
  // and translated links (<a href target rel>). lang= is allowed so FR/JA
  // phrase fragments can carry their own language attribute.
  //
  // Hard fail-closed: if DOMPurify is somehow absent we write "" rather than
  // the raw (unsanitised) string — a missing emphasis tag is acceptable, an
  // injected <script>/onerror is not.
  function _setHTML(node, html) {
    // Hard fail-closed: if DOMPurify is somehow absent we write "" rather
    // than the raw (unsanitised) string — a missing emphasis tag is
    // acceptable, an injected <script>/onerror is not. DOMPurify is vendored
    // locally and loads (defer) before this file, so this branch is not
    // expected at runtime.
    if (typeof window === "undefined" || !window.DOMPurify) {
      node.innerHTML = "";
      return;
    }
    // The allowlist is a SUPERSET of every attribute the platform's own i18n
    // markup uses, so sanitisation is a no-op for legitimate content:
    //   - inline emphasis + translated links (strong/em/b/i/span/br/abbr/a)
    //   - href/target/rel + lang/title on links and phrase fragments
    //   - id/class and the data-i18n* hooks, because some data-i18n-html
    //     strings embed elements the runtime later re-localises OR queries by
    //     id/class (e.g. <a data-i18n-href="privacy"> in the consent
    //     paragraphs). Stripping these (the original [href,target,rel,lang]
    //     allowlist) broke runtime behaviour that depends on them.
    // DOMPurify still strips the actual XSS vectors regardless of this list:
    // <script>/<iframe>, on* event handlers, and javascript:/data: URIs.
    node.innerHTML = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["strong", "em", "br", "a", "b", "i", "span", "abbr"],
      ALLOWED_ATTR: ["href", "target", "rel", "lang", "title", "id", "class",
                     "data-i18n", "data-i18n-html", "data-i18n-attr", "data-i18n-href"]
    });
  }

  function applyI18n(root) {
    if (typeof document === "undefined") return;
    const scope = root || document;
    // text content
    scope.querySelectorAll("[data-i18n]").forEach(node => {
      const key = node.getAttribute("data-i18n");
      const attr = node.getAttribute("data-i18n-attr");
      const value = t(key);
      if (attr) node.setAttribute(attr, value);
      else if (node.hasAttribute("data-i18n-html")) _setHTML(node, value);
      else node.textContent = value;
    });
    // rich-text content: the value MAY contain a small, controlled set of
    // inline HTML tags (<strong>, <em>, <br>) so that legally meaningful
    // emphasis in the privacy paragraphs survives translation. Keys are
    // author-controlled (this file) — never user input — so innerHTML is
    // safe and CSP-compatible (no <script>, no event handlers, no inline JS).
    //
    // Two valid template forms exist (reconciled across #91 lobby-i18n and
    // #94 modB-i18n): (a) data-i18n-html="lobby.privacy.p1" — the attribute
    // carries the key; (b) data-i18n="..." data-i18n-html — the attribute is
    // a *flag* and the key lives on data-i18n. Form (b) is already handled
    // by the data-i18n loop above (the hasAttribute branch). We must skip
    // it here, otherwise t("") returns "" and clobbers the innerHTML the
    // first loop just installed (this regressed stage.modB.vignette.body).
    scope.querySelectorAll("[data-i18n-html]").forEach(node => {
      const key = node.getAttribute("data-i18n-html");
      if (!key) return;  // flag form — already handled in the data-i18n loop
      // eslint-disable-next-line no-unsanitized/property
      _setHTML(node, t(key));
    });
    // secondary translatable attributes — title tooltips need translation
    // INDEPENDENTLY of textContent (e.g. the Join button has translated
    // label via data-i18n AND a translated lock tooltip via data-i18n-title).
    scope.querySelectorAll("[data-i18n-title]").forEach(node => {
      node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
    });
    scope.querySelectorAll("[data-i18n-aria-label]").forEach(node => {
      node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria-label")));
    });
    // language-aware hrefs (e.g. <a data-i18n-href="privacy" href="privacy.html">)
    scope.querySelectorAll("[data-i18n-href]").forEach(node => {
      const name = node.getAttribute("data-i18n-href");
      const target = localizedHref(name);
      if (target) node.setAttribute("href", target);
    });
    // R2-47: conditional show/hide nodes that should only render for a
    // specific subset of languages. Used by the privacy-lang-banner on
    // privacy.html, which surfaces a "no full translation yet" notice
    // only for es/pt/de/ko/zh. Pure DOM toggle — no script/event so it
    // stays CSP-friendly under script-src 'self'.
    const activeLang = getLang();
    scope.querySelectorAll("[data-toggle-when-lang]").forEach(node => {
      const list = (node.getAttribute("data-toggle-when-lang") || "")
        .split(",").map(s => s.trim()).filter(Boolean);
      const shouldShow = list.indexOf(activeLang) >= 0;
      if (shouldShow) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "");
    });
    // mark the active language button (used by the header switcher)
    scope.querySelectorAll("[data-lang-btn]").forEach(node => {
      const lang = node.getAttribute("data-lang-btn");
      node.classList.toggle("active", lang === getLang());
      node.setAttribute("aria-pressed", lang === getLang() ? "true" : "false");
    });
  }

  // Node / unit-test environment (no DOM): eagerly load every locale so the
  // in-memory table is complete for tests that read CanamedI18n._T directly
  // (tests/i18n.test.js, tests/r3-blockers.test.js). The browser never takes
  // this branch — it lazy-loads each locale via ensureLang instead.
  if (typeof document === "undefined" &&
      typeof module !== "undefined" && module.exports &&
      typeof require === "function") {
    SUPPORTED.forEach((l) => {
      if (l === "en" || T[l]) return;
      try { T[l] = require("./locales/" + l + ".js"); }
      catch (e) { /* locale file absent — runtime falls back to English */ }
    });
  }

  // auto-apply once the DOM is ready. English (and any already-loaded locale)
  // applies synchronously; a detected non-English language is fetched first.
  // The static HTML ships English copy, so there is no blank flash while the
  // locale loads — at worst a non-EN user sees English for a few ms before the
  // localized strings swap in. That brief swap is the deliberate first-paint
  // trade of the lazy-load split: the splash no longer ships all 8 locales.
  if (typeof document !== "undefined") {
    // Belt-and-braces: drain any locale that executed before this file ran.
    // The documented load order puts i18n.js first, so this is normally a
    // no-op; init() below applies translations regardless.
    if (typeof window !== "undefined" && Array.isArray(window.__canamedLocaleQueue)) {
      const q = window.__canamedLocaleQueue;
      window.__canamedLocaleQueue = null;
      q.forEach((pair) => register(pair[0], pair[1]));
    }
    const init = () => {
      _currentLang = detectLang();
      if (document.documentElement) {
        document.documentElement.setAttribute("lang", _currentLang);
      }
      if (_currentLang === "en" || hasTable(_currentLang)) {
        applyI18n();
      } else {
        ensureLang(_currentLang).then(() => {
          applyI18n();
          dispatchLangChange(_currentLang);
        }).catch(() => { applyI18n(); /* fall back to the inline English copy */ });
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  return { t, getLang, setLang, applyI18n, localizedHref, ensureLang, register, SUPPORTED, _T: T };
});
