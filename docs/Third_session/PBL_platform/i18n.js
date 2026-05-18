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

      // privacy page — R3 deep-i18n: privacy.html is a single dynamic
      // page; reviewed body copy lives inline as <section data-priv-lang>.
      // privacy.title / privacy.subtitle wire the page chrome.
      "privacy.title": "CaNaMED — Privacy Policy",
      "privacy.subtitle": "How we use your data, and your rights",
      // Banner shown when the active UI lang has no reviewed body
      // (es/pt/de/ko/zh fall back to the EN body).
      "privacy.lang-not-available": "A full translation of this privacy policy in your selected language is not yet available. The English text below is the legally binding version. A reviewed <a href=\"privacy.html?lang=fr\">French</a> or <a href=\"privacy.html?lang=ja\">Japanese</a> version is also available.",

      // splash — enter-code view (participants)
      "splash.enter.label": "Enter the session code your facilitator gave you",
      "splash.enter.placeholder": "e.g. ABC-DEF",
      "splash.enter.submit": "Enter →",
      "splash.enter.no-code": "Don't have a code yet?",
      "splash.enter.go-create": "I'm a facilitator — create a session →",
      "splash.enter.go-account": "Sign in with Google (optional — to save your profile & history) →",

      // splash — sign-in view
      "splash.account.title": "Sign in with Google",
      "splash.account.subtitle": "We use Google to verify your identity — no separate password to remember. Your details auto-fill when you join a session, and the sessions you have taken part in are kept under your profile.",
      "splash.account.continue-google": "Continue with Google",
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
      "splash.created.create-another": "Create another",
      "splash.created.open-admin": "Open admin dashboard →",

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
      "lobby.consent-research": "I additionally consent to my contributions (group answers, votes, scores) being used for the CaNaMED education-research project (analysis and publication in pseudonymised form). I understand that I can take part in the workshop without ticking this second box — refusing has no effect on my participation, my grades or my standing at my university.",
      "lobby.consent-version": "Notice version PIS v1 · 2026-05. Full ",
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
      "lobby.forgot-pass-link": "Forgot the password? Reset with super-admin key ›",
      "lobby.superadmin.disabled": "Super-admin is disabled on this deployment.",
      "lobby.superadmin.bad-key": "Incorrect super-admin key.",
      "lobby.superadmin.no-new-pass": "Enter a new session password to set.",
      "lobby.superadmin.confirm-mismatch": "The two password fields do not match — please re-type the new password.",
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
      "lobby.privacy.p3": "Data is stored on Google Firebase Realtime Database in <strong>europe-west1 (Belgium, EU)</strong>. For Japanese participants this is a cross-border transfer protected by the EU–Japan mutual adequacy decision (PPC, 2019). Live session data is purged within 7 days; if you ticked the research-consent box your contributions are kept pseudonymised for up to 5 years after publication.",
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
      "room.answer-input-language-hint": "Write in any language — your facilitator and teammates can read English, French and Japanese.",
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

      "stage.modB.phase2.title": "Phase 2 — Play it out (12 min scene + 3 min swap)",
      "stage.modB.phase2.intro": "The observer says \"start\": the patient is already seated, the physician begins. The physician delivers the news and handles the family member's request in the moment. Observers stay silent; the observer calls \"time\" at the end. <strong>Then swap and run it again</strong> with a different physician — over the two runs, at least one Caen and one Nagoya student must take the physician role. The second run is almost always better, and that improvement is worth discussing.",

      "stage.modB.framework.label": "<strong>When the family asks you to withhold information — \"Pause · Explore · Explain · Realign\":</strong>",
      "stage.modB.framework.pause": "<strong>Pause</strong> — don't refuse or agree on the spot. Thank them; their worry is real and usually loving.",
      "stage.modB.framework.explore": "<strong>Explore the <em>why</em></strong> — \"Help me understand what worries you most about your parent knowing.\"",
      "stage.modB.framework.explain": "<strong>Explain your position</strong> — you cannot deceive a patient who wants to know, but you do not have to force information on someone who does not.",
      "stage.modB.framework.realign": "<strong>Realign</strong> — ask the <em>patient</em> how much they want to know and who they want involved (this is SPIKES' \"Invitation\"). The family's worry becomes part of the conversation, not a secret kept from the patient.",

      "stage.modB.phase3.title": "Phase 3 — The exchange (15 min)",
      "stage.modB.phase3.ground-rule": "<strong>Ground rule (an observer reads this aloud):</strong> we are comparing <em>practices and how they are changing</em>, not ranking countries. Neither model is \"the advanced one\". Speak about what you have actually seen or been taught — and it is completely fine to say \"I'm not sure, this is changing.\"",
      "stage.modB.phase3.intro": "An observer reads these out one at a time — for each, make sure both a Caen and a Nagoya voice answers:",
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

      // wrap-up stage (stage-3) — the last thing students see in the room
      "stage.wrap.title": "Wrap-up & Next Steps",
      "stage.wrap.thanks": "Thank you for taking part! Before you go:",
      "stage.wrap.do-questionnaire": "Complete the end-of-session questionnaire — it only takes a few minutes, and there is a short post-test in 3 weeks.",
      "stage.wrap.answers-saved": "Your group's answers are saved below — your facilitators will collect them.",
      "stage.wrap.open-questionnaire": "Open the end-of-session questionnaire",
      "stage.wrap.questionnaire-fallback": "Your facilitator will share the questionnaire link.",
      "stage.wrap.bye": "Once you've done the questionnaire you can close this tab. See you at Session 4!",
      "stage.wrap.room-answers": "Your room's answers",

      // pre/post knowledge test (per-scenario in-platform MCQ) — optional;
      // students can always skip. Pre-test shown on the Welcome stage,
      // post-test on the Wrap-up stage.
      "test.pre.title": "Quick pre-session knowledge check",
      "test.pre.intro": "Before today's workshop starts, your facilitator has set up a short multiple-choice check on the scenario you're about to discuss. It's anonymous within your university, optional, and your answers do not affect your grade.",
      "test.pre.start": "Start the pre-test",
      "test.post.title": "Quick post-session knowledge check",
      "test.post.intro": "Now that the workshop is finished, a short multiple-choice check helps us see what changed during today's session. It's anonymous within your university, optional, and your answers do not affect your grade.",
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
      "test.thanks": "Thank you — your answers help us improve the workshop. They are stored anonymously within your group.",
      "test.skipped": "You skipped the test. You can take it now if you change your mind.",
      "test.already-done": "You have already taken this test today. Thank you!",
      "test.error-save": "We could not save your answer right now — your in-session points are not affected.",
      // R3-C4 (Akari late-join): the pre-test card replaces its start / skip
      // buttons with this notice when a late-joiner views "Welcome" after
      // their room has already entered Module A. The post-test still runs.
      "test.late-join-closed": "The pre-test closed when your room started. It's only meaningful when taken before the workshop begins — your post-test at the end of the session will still count.",

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

      // admin dashboard search/filter (appears when roomCount > 5)
      "admin.search.placeholder": "Filter rooms by name…",
      "admin.search.clear": "Clear",
      "admin.search.label": "Filter rooms",
      "admin.search.empty": "No rooms match this filter.",

      // Right-column tab labels (Module A panels). User feedback flagged
      // these as the most visible English-only strings once the user has
      // joined a room. Pinned per language so a translator catches a
      // missing key in CI rather than at runtime.
      "rcol.tab.findings": "Findings",
      "rcol.tab.decisions": "Team decisions",
      "rcol.tab.discussion": "Discussion",
      "rcol.tab.answers": "Group answers",
      "rcol.tab.reference": "Reference",

      // Findings + discussion panel chrome (in-room, high-visibility).
      "findings.title": "Findings log",
      "findings.empty": "Nothing asked yet — use the buttons on the left to work the case.",
      "prompts.title": "Discussion prompts",
      "prompts.locked": "Locked — complete the clinical synthesis (red-flag review) to unlock the discussion prompts.",

      // Reset button (in-room, destructive — must be discoverable in
      // every UI language so a participant doesn't tap it by mistake).
      "reset.btn": "Reset this room's case",
      "reset.btn-title": "Clear this room's findings"
    },

    fr: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "Aller au contenu principal",

      "splash.tagline": "Une plateforme collaborative pour les partenariats pédagogiques entre facultés de médecine.",
      "splash.signed-in-as": "Connecté·e en tant que",
      "splash.sign-out": "Se déconnecter",
      "splash.lang-label": "Langue",
      "privacy.title": "CaNaMED — Politique de confidentialité",
      "privacy.subtitle": "Comment nous utilisons vos données, et vos droits",
      "privacy.lang-not-available": "Une traduction complète de cette politique de confidentialité dans la langue que vous avez choisie n'est pas encore disponible. Le texte anglais ci-dessous est la version juridiquement contraignante. Une version révisée en <a href=\"privacy.html?lang=fr\">français</a> ou en <a href=\"privacy.html?lang=ja\">japonais</a> est également disponible.",

      "splash.enter.label": "Entrez le code de séance fourni par votre encadrant·e",
      "splash.enter.placeholder": "ex. ABC-DEF",
      "splash.enter.submit": "Entrer →",
      "splash.enter.no-code": "Pas encore de code ?",
      "splash.enter.go-create": "Je suis encadrant·e — créer une séance →",
      "splash.enter.go-account": "Se connecter avec Google (facultatif — pour sauvegarder mon profil et mon historique) →",

      "splash.account.title": "Se connecter avec Google",
      "splash.account.subtitle": "Nous utilisons Google pour vérifier votre identité — pas de mot de passe supplémentaire à retenir. Vos informations se remplissent automatiquement à chaque séance, et l'historique des séances auxquelles vous avez participé est conservé sous votre profil.",
      "splash.account.continue-google": "Continuer avec Google",
      "splash.account.back": "← Retour pour rejoindre une séance",

      "splash.profile.title": "Configurer votre profil",
      "splash.profile.subtitle": "Ces informations se remplissent automatiquement à chaque fois que vous rejoignez une séance. Vous pourrez les modifier plus tard depuis votre compte.",
      "splash.profile.name-label": "Votre prénom (ou pseudonyme)",
      "splash.profile.name-placeholder": "ex. Alice / Akari",
      "splash.profile.uni-label": "Université",
      "splash.profile.year-label": "Année d'études",
      "splash.profile.english-label": "Niveau d'anglais (auto-évaluation CECRL)",
      "splash.profile.submit": "Enregistrer et continuer →",

      "splash.create.title": "Créer une séance CaNaMED",
      "splash.create.subtitle": "Vous recevrez un code court à partager avec vos étudiant·e·s. Vous devenez l'encadrant·e (admin) — gardez le mot de passe défini ici pour piloter la séance.",
      "splash.create.name-label": "Votre nom",
      "splash.create.name-placeholder": "ex. Dr Smith",
      "splash.create.workshop-label": "Intitulé de l'atelier",
      "splash.create.workshop-optional": "(facultatif)",
      "splash.create.workshop-placeholder": "ex. Caen × Nagoya — juin 2026",
      "splash.create.content-label": "Scénario (le cas clinique de cet atelier)",
      "splash.create.password-label": "Définir un mot de passe de séance",
      "splash.create.password-placeholder": "quelque chose que seul·e·s les encadrant·e·s connaîtront",
      "splash.create.password-hint": "Vous en aurez besoin pour rouvrir le tableau de bord si vous rechargez la page. Les étudiant·e·s ne le voient jamais. Choisissez un mot de passe différent de celui de votre université.",
      "splash.create.advanced-toggle": "Créer un contenu personnalisé (avancé) ↓",
      "splash.create.custom-label": "Contenu personnalisé (JSON)",
      "splash.create.custom-help": "Collez un objet JSON avec les clés name, case, scoring, penalties, decisions — voir le README pour la structure complète. Utilisez « Charger le modèle » pour partir du contenu intégré, puis modifiez ce dont vous avez besoin.",
      "splash.create.custom-desc": "Collez un objet JSON décrivant votre cas. Utilisez « Charger le modèle » pour partir du contenu intégré.",
      "splash.create.load-template": "Charger le modèle",
      "splash.create.back": "← Retour",
      "splash.create.submit": "Créer la séance",
      "splash.create.clone-last": "Cloner la dernière séance ↻",
      "splash.create.clone-clear": "Effacer",

      "modal.confirm": "OK",
      "modal.cancel": "Annuler",
      "modal.advance-all.title": "Faire avancer toutes les salles ?",
      "modal.advance-all.message": "Chaque salle passera à l'étape suivante. Aperçu détaillé ci-dessous :",
      "modal.advance-all.ok": "Tout faire avancer",
      "modal.start.too-many-rooms-title": "Plus de salles que de participant·e·s",
      "modal.start.too-many-rooms-message": "Vous avez moins de participant·e·s que de salles. Certaines salles seront vides ou très petites. Démarrer quand même ?",
      "modal.start.weak-rooms-title": "Salles déséquilibrées",
      "modal.start.weak-rooms-message": "Certaines salles sont petites ou mono-université. L'objectif est de former des groupes mixtes {cohortPair}. Démarrer quand même ?",
      "modal.start.ok": "Démarrer quand même",
      "modal.close.title": "Clôturer la séance et télécharger l'archive ?",
      "modal.close.message": "Cette action téléchargera un fichier JSON contenant toutes les réponses, votes, révélations, scores, contributions et présences, puis marquera la séance comme close — les participant·e·s verront une bannière de remerciement et ne pourront plus saisir de texte.\n\nLes données restent dans la base — vous pouvez retélécharger l'archive à tout moment. Le marquage n'est pas facilement réversible.",
      "modal.close.ok": "Clôturer et télécharger",

      "admin.waiting.title": "Salle d'attente",
      "admin.waiting.expected-label": "Effectif attendu (facultatif)",
      "admin.waiting.expected-placeholder": "ex. 30",
      "admin.waiting.expected-hint": "Affiché à côté du compteur pour suivre l'arrivée des étudiant·e·s.",
      "admin.test-alerts": "Tester les alertes",
      "admin.test-alerts-hint": "Cliquez avant l'arrivée des étudiant·e·s — joue le carillon et demande l'autorisation pour les notifications bureau, afin que la première vraie demande d'aide ne soit jamais silencieuse.",
      "admin.test-alerts.ok": "Carillon joué. Notifications bureau activées.",
      "admin.test-alerts.ok-noperm": "Carillon joué. Ce navigateur ne prend pas en charge les notifications bureau.",
      "admin.test-alerts.denied": "Carillon joué, mais les notifications bureau sont bloquées. Vérifiez les paramètres du navigateur.",
      "admin.test-alerts.noaudio": "L'audio a été bloqué par le navigateur — cliquez quelque part sur la page, puis réessayez.",
      "admin.test-alerts.dismissed": "Carillon joué. La demande de notification a été ignorée — cliquez à nouveau pour réessayer.",

      "splash.created.title": "Séance créée",
      "splash.created.subtitle": "Partagez ce code avec vos étudiant·e·s. Iels le saisiront sur cette même page pour rejoindre la séance.",
      "splash.created.copy": "Copier",
      "splash.created.copy-link": "Copier le lien",
      "splash.created.qr-caption": "Ou scannez le QR avec un téléphone",
      "splash.created.create-another": "Créer une autre séance",
      "splash.created.open-admin": "Ouvrir le tableau de bord →",

      "lobby.join-title": "Rejoindre en tant que participant·e",
      "lobby.join-hint": "Vous serez automatiquement placé·e dans une salle mixte {cohortPair} — équilibrée par université, année et niveau d'anglais.",
      "lobby.uni-label": "Université",
      "lobby.uni-placeholder": "Choisissez votre université…",
      "lobby.year-label": "Année d'études",
      "lobby.year-postgrad": "Internat / 3ᵉ cycle",
      "lobby.english-label": "Niveau d'anglais (auto-évaluation CECRL)",
      "lobby.english-hint": "Niveaux CECRL : A2 élémentaire · B1 intermédiaire · B2 intermédiaire avancé (peut discuter de sujets complexes) · C1 avancé · C2 expérimenté. Choisissez le plus proche — c'est uniquement utilisé pour équilibrer les salles.",
      "lobby.name-label": "Votre prénom (ou pseudonyme)",
      "lobby.name-placeholder": "ex. Alice / Akari",
      "lobby.consent-workshop": "J'ai lu la notice d'utilisation des données ci-dessus et je consens à participer à cet atelier CaNaMED.",
      "lobby.consent-workshop-detail": "Mon prénom, mon université, mon année, mon niveau d'anglais et les textes que je saisis pendant l'atelier seront visibles par les autres personnes de ma salle et par les encadrant·e·s.",
      "lobby.consent-research": "Je consens en outre à ce que mes contributions (réponses de groupe, votes, scores) soient utilisées pour le projet de recherche éducative CaNaMED (analyse et publication sous forme pseudonymisée). Je comprends que je peux participer à l'atelier sans cocher cette deuxième case — un refus n'a aucun impact sur ma participation, mes notes ou ma situation universitaire.",
      "lobby.consent-version": "Version de la notice PIS v1 · 2026-05. ",
      "lobby.consent-version-link": "Politique de confidentialité complète",
      "lobby.consent-version-suffix": ".",
      "lobby.consent-required-hint": "Veuillez lire la notice d'utilisation des données et cocher la case de consentement ci-dessus pour participer.",
      "lobby.consent-required-title": "Cochez la case de consentement à l'atelier ci-dessus pour activer ce bouton.",
      "lobby.session-code-label": "Code de séance",
      "lobby.session-code-placeholder": "ex. ABC-DEF",
      "lobby.name-required-hint": "Saisissez votre prénom.",
      "lobby.session-required-hint": "Saisissez le numéro de séance.",
      "lobby.university-required-hint": "Veuillez sélectionner votre université.",
      "lobby.join-btn": "Rejoindre la salle d'attente",
      "lobby.session-code-label": "Code de la séance",
      "lobby.admin-toggle": "Je suis encadrant·e ›",
      "lobby.admin-pass-label": "Mot de passe encadrant",
      "lobby.admin-pass-placeholder": "mot de passe de la séance",
      "lobby.admin-open-dashboard": "Ouvrir le tableau de bord",
      "lobby.superadmin-toggle": "Super-admin : définir / changer le mot de passe",
      "lobby.superadmin-key-label": "Clé super-admin",
      "lobby.superadmin-key-placeholder": "clé super-admin",
      "lobby.new-pass-label": "Nouveau mot de passe de séance",
      "lobby.new-pass-placeholder": "nouveau mot de passe de séance",
      // R3-D3 (Renaud): confirm-password label/placeholder + R3-D2: forgot link.
      "lobby.new-pass-confirm-label": "Confirmer le nouveau mot de passe",
      "lobby.new-pass-confirm-placeholder": "confirmer le nouveau mot de passe",
      "lobby.forgot-pass-link": "Mot de passe oublié ? Réinitialiser avec la clé super-admin ›",
      "lobby.superadmin.disabled": "Le mode super-admin est désactivé sur ce déploiement.",
      "lobby.superadmin.bad-key": "Clé super-admin incorrecte.",
      "lobby.superadmin.no-new-pass": "Saisissez un nouveau mot de passe de séance à définir.",
      "lobby.superadmin.confirm-mismatch": "Les deux champs de mot de passe ne correspondent pas — merci de retaper le nouveau mot de passe.",
      "lobby.save-pass-btn": "Enregistrer le mot de passe & ouvrir le tableau de bord",
      "lobby.err.name-required": "Saisissez votre prénom.",
      "lobby.err.session-required": "Saisissez le code de la séance.",
      "lobby.err.consent-required": "Veuillez lire la notice d'utilisation des données et cocher la case de consentement ci-dessus pour participer.",
      "lobby.err.university-required": "Veuillez sélectionner votre université.",

      "lobby.privacy.summary": "Utilisation de vos données (à lire avant de rejoindre)",
      "lobby.privacy.p1": "L'équipe de recherche CaNaMED (<strong>Université de Caen Normandie × Université de Nagoya</strong>, responsables conjoints au sens de l'art. 26 RGPD / utilisateurs conjoints au sens de l'art. 27(5) APPI) collecte votre prénom ou pseudonyme, votre université, votre année d'études et votre niveau d'anglais auto-évalué. Votre prénom est visible par toutes les personnes de votre salle et apparaît à côté des points que vous apportez.",
      "lobby.privacy.p2": "Les réponses en texte libre que vous rédigez peuvent révéler des opinions sur la santé, religieuses ou philosophiques liées à des situations cliniques — <strong>données sensibles</strong> au sens de l'art. 9 RGPD et <strong>要配慮個人情報</strong> au sens de l'art. 2(3) APPI. La deuxième case de consentement, optionnelle, ci-dessous couvre ce point.",
      "lobby.privacy.p3": "Les données sont stockées sur Google Firebase Realtime Database en <strong>europe-west1 (Belgique, UE)</strong>. Pour les participant·e·s japonais·es il s'agit d'un transfert transfrontalier protégé par la décision d'adéquation mutuelle UE–Japon (PPC, 2019). Les données de séance en direct sont purgées sous 7 jours ; si vous avez coché la case de consentement à la recherche, vos contributions sont conservées sous forme pseudonymisée jusqu'à 5 ans après publication.",
      "lobby.privacy.p4": "<strong>La connexion avec Google est facultative.</strong> Si vous l'utilisez, un petit profil et la liste des codes de séances auxquelles vous avez participé sont rattachés à votre compte Google ; vous pouvez les modifier ou les supprimer à tout moment depuis le panneau « Mon compte ». La participation anonyme fonctionne exactement de la même façon.",
      "lobby.privacy.p5": "Vous pouvez retirer votre consentement à tout moment. Le fait de cocher ou non la deuxième case de consentement <strong>n'a aucun effet sur votre note, sur votre situation universitaire, ni sur votre participation à l'atelier.</strong> Pour exercer l'un de vos droits (accès, rectification, effacement, portabilité, limitation, opposition, retrait, réclamation), contactez votre encadrant·e ou écrivez à <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> (voir la <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">politique de confidentialité complète</a> pour l'adresse stable).",
      "lobby.privacy.p6": "La <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">politique de confidentialité complète</a> détaille l'identité des responsables, les bases légales, les éléments traités conjointement, les garanties applicables aux transferts internationaux, les durées de conservation, vos droits avec les délais de réponse, et les avis des comités d'éthique. Merci de la lire une fois avant de rejoindre.",

      "waiting.title": "Salle d'attente",
      "waiting.you-are": "Vous êtes",
      "waiting.leave": "Quitter",
      "waiting.status-not-started": "Vous avez rejoint la séance. En attente de son démarrage par l'encadrant·e…",
      "waiting.status-starting": "La séance a commencé — vous êtes en cours d'attribution à une salle…",
      "waiting.heading": "Vous avez rejoint la séance",
      "waiting.body": "Bonjour <strong id=\"waiting-name\"></strong> — vous êtes dans la salle d'attente. Un·e encadrant·e va vous placer dans une salle mixte {cohortPair} et démarrer la séance dans un instant. <strong>Votre écran avancera automatiquement</strong> — vous n'avez rien à faire.",
      "waiting.teams-btn": "Rejoindre l'appel Teams",
      "waiting.joined-so-far": "Présent·e·s pour l'instant",

      // R3-C1 — bandeau d'arrivée tardive
      "waiting.late-join.banner": "Vous avez rejoint la séance alors que votre salle est déjà à l'étape « {stage} ». Les étapes précédentes se sont déroulées avant votre arrivée — utilisez « ← Revoir l'étape précédente » à tout moment pour les consulter.  ",
      "waiting.late-join.dismiss": "Compris",

      "data-rights.export-btn": "Télécharger mes données (JSON) ⤓",
      "data-rights.err.no-session": "Rejoignez d'abord une séance — il n'y a rien à exporter pour l'instant.",
      "data-rights.err.not-ready": "La plateforme est encore en cours d'initialisation. Veuillez réessayer dans un instant.",
      "data-rights.err.export-failed": "Impossible d'exporter vos données — réessayez ou contactez votre encadrant·e.",

      "stage.label.0": "Accueil",
      "stage.label.1": "Module A — Douleur chronique",
      "stage.label.2": "Module B — Annoncer une mauvaise nouvelle",
      "stage.label.3": "Bilan",

      "stage.welcome.title": "Bienvenue à la séance 3",
      "stage.welcome.intro": "Thème : Apprendre les un·e·s des autres — une séance d'échange portée par les étudiant·e·s. Toute la séance se déroule depuis cette plateforme. Vous avancez ensemble ; un·e encadrant·e fait passer votre salle d'un bloc au suivant.",
      "stage.welcome.grade-note": "Votre note et votre statut ne sont pas affectés par cet atelier. Les points attribués par la plateforme sont uniquement pédagogiques — ils ne contribuent pas à votre note universitaire. Si vous êtes en désaccord avec un point ou une pénalité, parlez-en à votre encadrant·e ; la notation est révisable.",

      "room.call-facilitator": "Appeler un·e encadrant·e",
      "room.team-name-label": "Nom de l'équipe",
      "room.answer-input-label": "Ajouter une réponse de groupe pour le Module A",
      "room.answer-input-label-b": "Ajouter une réponse de groupe pour le Module B",
      "room.call.throttle-recall": "Veuillez patienter {seconds}s avant de rappeler un·e encadrant·e.",
      "room.call.throttle-again": "Veuillez patienter {seconds}s avant d'appeler à nouveau un·e encadrant·e.",
      "room.answer.err.edit-failed": "Votre modification n'a pas pu être enregistrée — vérifiez votre connexion. Votre texte : ",
      "room.answer.err.delete-failed": "Ce point n'a pas pu être supprimé — vérifiez votre connexion et réessayez.",
      "room.answer-input-language-hint": "Écrivez dans la langue de votre choix — vos encadrant·e·s et coéquipier·ère·s lisent l'anglais, le français et le japonais.",
      "room.answer-input-placeholder": "Ajoutez un point — il apparaît avec votre nom et votre couleur",
      "room.answers.hint.moduleA": "Chacun·e dans la salle peut ajouter un point — l'enregistrement est automatique. Visez les quatre puces ci-dessus ; la France comme le Japon doivent écrire.",
      "room.answers.hint.moduleB": "Chacun·e dans la salle peut ajouter un point — l'enregistrement est automatique. Couvrez les trois puces ci-dessus ; la France comme le Japon doivent écrire.",
      "room.answers.hint.count-one": "{n} réponse pour l'instant",
      "room.answers.hint.count-many": "{n} réponses pour l'instant",
      "room.answers.hint.both-wrote": "✓ la France et le Japon ont tous deux écrit ici",
      "room.answers.hint.one-wrote": "un pays a écrit — invitez l'autre",
      "room.answers.hint.suffix": "Écrivez avec vos propres mots — court et clair, c'est du bon anglais ici.",

      "admin.mute-alerts": "Couper le son d'appel + la notification système",
      "admin.download-error-log": "Télécharger le journal d'erreurs",
      "admin.theme": "Thème",
      "admin.theme.auto": "Auto (système)",
      "admin.theme.light": "Clair",
      "admin.theme.dark": "Sombre",
      "admin.theme.hc": "Contraste élevé",
      "admin.report-bug": "Signaler un bug",

      "admin.start-session": "Démarrer la séance — placer tout le monde dans les salles",
      "admin.advance-all": "Avancer toutes les salles →",
      "admin.download-all": "Télécharger toutes les réponses",
      "admin.end-session": "Clôturer la séance & télécharger l'archive",

      "stage.modB.title": "Module B — Annoncer une mauvaise nouvelle : un jeu de rôle interculturel",

      "stage.modB.vignette.body": "<strong>La situation (à lire une fois, ensemble).</strong> M. / Mme Tanaka-Martin, <strong>60 ans</strong>, consulte pour fatigue et perte de poids. Les examens sont revenus : le diagnostic est une <strong>maladie grave, chronique, qui change la vie</strong> — votre groupe en choisit une (par exemple : un cancer nouvellement diagnostiqué, une insuffisance cardiaque avancée, une maladie de Parkinson débutante, ou une insuffisance rénale nécessitant la dialyse). Elle est <strong>traitable mais incurable</strong>, et elle va changer la vie du patient. Le patient ne le sait pas encore. Son <strong>enfant adulte</strong> l'accompagne et se trouve dans la pièce — et à un moment, à voix basse, va vous demander quelque chose.",

      "stage.modB.safety.heading": "<strong>Avant de commencer — deux points.</strong>",
      "stage.modB.safety.simulation": "<em>Ceci est une simulation.</em> Les émotions peuvent malgré tout sembler bien réelles. Si quelque chose vous touche de trop près, vous pouvez prendre le rôle d'observateur·rice à tout moment, sans avoir à vous expliquer. Lors du débriefing, parlez des <strong>choix du médecin</strong> — ne critiquez jamais la personne.",
      "stage.modB.safety.language": "<em>L'anglais est ici la deuxième ou la troisième langue de chacun·e</em> — c'est aussi le but. Si un mot vous manque, ralentissez, utilisez un mot plus simple, ou faites une pause. Le silence est permis dans cet échange et aide souvent. L'empathie passe par votre ton, votre rythme et votre visage, pas par un vocabulaire complexe.",

      "stage.modB.intro.hint": "Ce module est un jeu de rôle que votre groupe mène ensemble. Travaillez les quatre phases dans l'ordre — un·e observateur·rice tient le temps.",

      "stage.modB.phase1.title": "Phase 1 — Mise en place (6 min)",
      "stage.modB.phase1.intro": "Désignez un·e volontaire pour chaque rôle ; tou·te·s les autres sont observateur·rice·s. Lisez votre courte fiche, puis commencez.",
      "stage.modB.phase1.role.physician": "<strong>Médecin</strong> — vous avez les résultats. Annoncez la nouvelle avec honnêteté et empathie, et gérez ce qui se passera dans la pièce. Gardez SPIKES à l'esprit (voir le bandeau ci-dessous) mais ne le récitez pas. Vous n'avez pas à « gagner » ni à tout résoudre — une bonne consultation peut se terminer avec le patient toujours bouleversé.",
      "stage.modB.phase1.role.patient": "<strong>Patient·e</strong> — vous avez 60 ans. Vous vous doutiez de quelque chose mais espériez que ce n'était rien. Choisissez en secret comment vous réagissez ; vous pouvez changer au fil de la scène. <strong>Décidez à l'avance une chose : au fond de vous, voulez-vous tout savoir, ou pas ?</strong> Ne l'annoncez pas — laissez le médecin le découvrir.",
      "stage.modB.phase1.role.family": "<strong>Proche (enfant adulte)</strong> — vous aimez votre parent et vous avez peur. À un moment de la consultation — pas au début — trouvez un instant naturel pour <strong>baisser la voix et parler au médecin à l'écart</strong> : demandez-lui de ne pas tout dire à votre parent. Ayez une raison prête dans votre tête. Restez discret·ète et bienveillant·e, sans exigence.",
      "stage.modB.phase1.role.observer": "<strong>Observateur·rice·s</strong> — vous êtes garant·e·s du temps et vous animez la Phase 3. Restez silencieux·ses pendant la scène. Observez <em>les étapes SPIKES</em> : ce qui a créé la confiance, ce qui a créé de la distance, et ce qu'a fait le médecin au moment où le proche lui a parlé. Notez une chose que le médecin a <em>dite</em> qui a marché, et un moment qui a été difficile.",

      "stage.modB.spikes.label": "SPIKES",
      "stage.modB.spikes.s": "<strong>S</strong>etting — cadre",
      "stage.modB.spikes.p": "<strong>P</strong>erception (que comprennent-ils déjà ?)",
      "stage.modB.spikes.i": "<strong>I</strong>nvitation (combien veulent-ils savoir ?)",
      "stage.modB.spikes.k": "<strong>K</strong>nowledge — l'information par petits morceaux simples",
      "stage.modB.spikes.e": "<strong>E</strong>motions (nommer et reconnaître ce qui est ressenti)",
      "stage.modB.spikes.s2": "<strong>S</strong>trategy — convenir de l'étape suivante ; vous ne les abandonnez pas",

      "stage.modB.spikes.useful.label": "Phrases utiles (l'anglais est la deuxième langue de chacun·e) :",
      "stage.modB.spikes.useful.examples": "« I'm afraid I have some serious news. » · « Would you like me to explain everything, or focus on what we do next? » · « I can see this is hard to hear. » · « Take your time. » · « What questions do you have for me? »",

      "stage.modB.phase2.title": "Phase 2 — Jouer la scène (12 min de scène + 3 min de relais)",
      "stage.modB.phase2.intro": "L'observateur·rice dit « start » : le patient est déjà assis, le médecin commence. Le médecin annonce la nouvelle et gère la demande du proche sur le moment. Les observateur·rice·s restent silencieux·ses ; l'observateur·rice dit « time » à la fin. <strong>Puis échangez et rejouez</strong> avec un autre médecin — sur les deux passages, au moins un·e étudiant·e de Caen et un·e de Nagoya doivent prendre le rôle du médecin. Le deuxième passage est presque toujours meilleur, et cette amélioration mérite d'être discutée.",

      "stage.modB.framework.label": "<strong>Quand la famille vous demande de ne pas tout dire — « Pause · Explorer · Expliquer · Réaligner » :</strong>",
      "stage.modB.framework.pause": "<strong>Pause</strong> — ne refusez ni n'acceptez sur le moment. Remerciez-les ; leur inquiétude est réelle et le plus souvent par amour.",
      "stage.modB.framework.explore": "<strong>Explorez le <em>pourquoi</em></strong> — « Aidez-moi à comprendre ce qui vous inquiète le plus si votre parent sait. »",
      "stage.modB.framework.explain": "<strong>Expliquez votre position</strong> — vous ne pouvez pas tromper un patient qui veut savoir, mais vous n'avez pas à imposer l'information à qui ne le souhaite pas.",
      "stage.modB.framework.realign": "<strong>Réalignez</strong> — demandez au <em>patient</em> ce qu'il veut savoir et qui il veut impliquer (c'est l'« Invitation » de SPIKES). L'inquiétude de la famille devient une partie de la conversation, pas un secret gardé loin du patient.",

      "stage.modB.phase3.title": "Phase 3 — L'échange (15 min)",
      "stage.modB.phase3.ground-rule": "<strong>Règle du jeu (à lire à voix haute par un·e observateur·rice) :</strong> nous comparons <em>des pratiques et leur évolution</em>, pas des pays à classer. Aucun modèle n'est « le plus avancé ». Parlez de ce que vous avez vu ou appris — et il est tout à fait acceptable de dire « je ne suis pas sûr·e, c'est en train de changer ».",
      "stage.modB.phase3.intro": "Un·e observateur·rice lit ces questions une par une — pour chacune, assurez-vous qu'une voix de Caen et une voix de Nagoya répondent :",
      "stage.modB.phase3.q1": "<strong>À qui est destinée l'information ?</strong> Quand la nouvelle est grave, qui est informé <em>en premier</em> — le patient ou la famille ? Est-ce ce que dit la loi, ce que dit le manuel, ou ce qui se passe réellement dans le service ? Nommez une chose commune entre la France et le Japon, et une chose qui <strong>diffère</strong>.",
      "stage.modB.phase3.q2": "<strong>Cela a-t-il changé ?</strong> L'annonce était-elle différente il y a 20 à 30 ans ? (Japon : la divulgation du diagnostic de cancer est passée de moins de ~30 % au début des années 1990 à ~94 % en 2016. France : la <em>loi Kouchner</em> de 2002 a transformé les droits à l'information.) Pourquoi les normes changent-elles — loi, générations, attentes ?",
      "stage.modB.phase3.q3": "<strong>La demande discrète de la famille — qu'avez-vous fait, et pourquoi ?</strong> Un médecin français répondrait-il de la même manière qu'un médecin japonais ? De quoi chacun a-t-il le plus peur — mentir au patient, ou lui faire du mal ? « Protéger quelqu'un d'une mauvaise nouvelle » est-ce de l'amour, ou lui retirer son choix — ou les deux ?",
      "stage.modB.phase3.q4": "<strong>Autonomie vs famille — est-ce vraiment l'un ou l'autre ?</strong> La France est décrite « autonomie d'abord », le Japon « centré sur la famille » — mais le droit français protège aussi le droit <em>de ne pas</em> savoir, et beaucoup de patients japonais veulent aujourd'hui une information complète. Où se situe réellement votre pays ? À quoi ressemblerait un modèle <em>les deux</em> ?",
      "stage.modB.phase3.q5": "<strong>L'empathie à travers la barrière de la langue.</strong> Vous avez annoncé une mauvaise nouvelle en anglais. Les étudiant·e·s de Caen et de Nagoya se sont-ils appuyés sur des choses différentes — les mots, le silence, le ton, le langage du corps ? Qu'est-ce qui survit à la barrière linguistique, et qu'est-ce qui se perd ?",
      "stage.modB.phase3.q6": "<strong>Qu'est-ce qui a été difficile — et l'a-t-il été de la même façon ?</strong> Les étudiant·e·s de Caen et de Nagoya ont-ils trouvé <em>différentes</em> choses difficiles (le silence ? le proche ? prononcer le diagnostic à voix haute ? ne pas pouvoir réparer la détresse ?) ? Que vous dit cette différence ?",

      "stage.modB.phase4.title": "Phase 4 — Écrivez vos puces (5 min)",
      "stage.modB.phase4.intro": "Dans la zone Réponses de groupe ci-dessous (les encadrant·e·s les collectent à la fin) :",
      "stage.modB.phase4.b1": "Une phrase concrète que votre groupe utiliserait pour répondre à la demande de la famille de taire l'information.",
      "stage.modB.phase4.b2": "Une façon dont la pratique de l'annonce <strong>diffère</strong> entre la France et le Japon — et une façon dont elle <strong>converge</strong>.",
      "stage.modB.phase4.b3": "Une chose que chacun·e d'entre vous fera différemment, dans son propre pays, grâce à cette discussion.",

      "stage.modB.answers.title": "Réponses de groupe — Module B",

      "stage.wrap.title": "Bilan & Étapes suivantes",
      "stage.wrap.thanks": "Merci d'avoir participé ! Avant de partir :",
      "stage.wrap.do-questionnaire": "Remplissez le questionnaire de fin de séance — il ne prend que quelques minutes, et un court post-test aura lieu dans 3 semaines.",
      "stage.wrap.answers-saved": "Les réponses de votre groupe sont sauvegardées ci-dessous — vos encadrant·e·s les récupéreront.",
      "stage.wrap.open-questionnaire": "Ouvrir le questionnaire de fin de séance",
      "stage.wrap.questionnaire-fallback": "Votre encadrant·e partagera le lien du questionnaire.",
      "stage.wrap.bye": "Une fois le questionnaire rempli vous pouvez fermer cet onglet. Rendez-vous à la séance 4 !",
      "stage.wrap.room-answers": "Les réponses de votre salle",

      "test.pre.title": "Petit test de connaissances avant la séance",
      "test.pre.intro": "Avant le début de l'atelier, votre encadrant·e a mis en place un court questionnaire à choix multiples sur le scénario que vous allez discuter. Il est anonyme au sein de votre université, facultatif, et vos réponses n'affectent pas votre note.",
      "test.pre.start": "Commencer le pré-test",
      "test.post.title": "Petit test de connaissances après la séance",
      "test.post.intro": "Maintenant que l'atelier est terminé, un court questionnaire à choix multiples nous aide à voir ce qui a évolué durant la séance. Il est anonyme au sein de votre université, facultatif, et vos réponses n'affectent pas votre note.",
      "test.post.start": "Commencer le post-test",
      "test.question": "Question {n} sur {total}",
      "test.submit": "Valider la réponse",
      "test.next": "Question suivante →",
      "test.see-results": "Voir vos résultats →",
      "test.skip": "Passer le test",
      "test.skip-question": "Passer cette question",
      "test.correct": "Correct",
      "test.incorrect": "Pas tout à fait",
      "test.complete": "Test terminé",
      "test.score-line": "Vous avez {n} bonnes réponses sur {total}.",
      "test.thanks": "Merci — vos réponses nous aident à améliorer l'atelier. Elles sont enregistrées de façon anonyme au sein de votre groupe.",
      "test.skipped": "Vous avez passé le test. Vous pouvez encore le faire si vous changez d'avis.",
      "test.already-done": "Vous avez déjà fait ce test aujourd'hui. Merci !",
      "test.error-save": "Impossible d'enregistrer votre réponse pour le moment — vos points en séance ne sont pas affectés.",
      "test.late-join-closed": "Le pré-test s'est clôturé au démarrage de votre salle. Il n'a de sens que s'il est rempli avant le début du workshop — votre post-test en fin de séance comptera, lui.",

      "closed.title": "Séance clôturée par l'encadrant·e.",
      "closed.subtitle": "Merci d'avoir participé — le travail de votre équipe a été sauvegardé.",

      "ended.title": "Merci d'avoir participé",
      "ended.message": "Votre encadrant·e a clôturé cette séance. Les contributions de votre équipe ont été sauvegardées.",
      "ended.questionnaire": "Ouvrir le questionnaire de fin de séance →",
      "ended.future": "Si vous participez à une future séance CaNaMED, vous recevrez un nouveau code de séance.",
      "ended.return": "Retour à CANAMED",

      "offline.banner": "Vous êtes hors ligne. Tentative de reconnexion…",

      "debrief.toggle": "Ouvrir le bilan",
      "debrief.toggle-close": "Fermer le bilan",
      "debrief.title": "Bilan de la séance",
      "debrief.subtitle": "Statistiques agrégées sur toutes les salles — utiles pour la discussion de débriefing.",
      "debrief.empty": "Démarrez la séance pour voir les statistiques agrégées ici.",
      "debrief.section.ranking": "Classement des salles",
      "debrief.section.decisions": "Analyse des décisions",
      "debrief.section.penalties": "Carte des pénalités",
      "debrief.section.concepts": "Couverture des concepts",
      "debrief.section.funnel": "Entonnoir de participation",
      "debrief.section.time": "Temps par étape",
      "debrief.col.room": "Salle",
      "debrief.col.team": "Équipe",
      "debrief.col.score": "Score",
      "debrief.no-data": "Pas encore de données.",
      "debrief.no-commit": "Aucune salle n'a validé cette décision.",
      "debrief.rooms-picked": "salles",
      "debrief.correct-option": "(correct)",
      "debrief.module-a": "Module A",
      "debrief.module-b": "Module B",
      "debrief.penalty-fired": "déclenchée",
      "debrief.penalty-rooms": "salles touchées",
      "debrief.concept.rooms-hit": "salles atteignent",
      "debrief.funnel.registered": "A rejoint le vivier",
      "debrief.funnel.assigned": "Attribué·e à une salle",
      "debrief.funnel.answered": "A répondu à ≥1 prompt",
      "debrief.funnel.voted": "A voté sur une décision",
      "debrief.time.minutes": "min",
      "debrief.time.stage": "Étape",
      "debrief.points-per-room": "points / salle",

      "debrief.student.title": "Le bilan de votre équipe",
      "debrief.student.score": "Votre équipe a marqué",
      "debrief.student.score-suffix": "points",
      "debrief.student.decisions-locked": "décisions validées",
      "debrief.student.agreed": "Décisions où votre équipe a choisi la réponse la plus sûre",
      "debrief.student.disagreed": "Décisions à revoir",
      "debrief.student.top-concept": "Le concept le mieux abordé par votre équipe",
      "debrief.student.missed-concept": "Concept que votre équipe n'a pas mis en avant",
      "debrief.student.engaged": "Moment le plus engagé",
      "debrief.student.engaged-detail": "passé·e·s sur",
      "debrief.student.closing": "Merci d'avoir participé — chaque contribution fait grandir le partenariat.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "Les contributions de votre équipe ont été sauvegardées.",
      "debrief.student.team-label": "Votre équipe",

      "tour.btn.next": "Suivant",
      "tour.btn.back": "Précédent",
      "tour.btn.skip": "Passer la visite",
      "tour.btn.done": "C'est compris",
      "tour.btn.close": "Fermer",
      "tour.progress": "Étape {n} sur {total}",
      "tour.reopen": "Revoir la visite",

      "tour.create.1.title": "Intitulé de l'atelier",
      "tour.create.1.body": "Donnez à cette séance un nom parlant (ex. « Caen × Nagoya — juin 2026 »). Facultatif, mais utile lorsque vous la cloner pour la prochaine promotion.",
      "tour.create.2.title": "Choisir le scénario",
      "tour.create.2.body": "Choisissez le contenu clinique sur lequel travailleront les étudiant·e·s. Vous pouvez aussi coller un scénario personnalisé au format JSON pour un usage avancé.",
      "tour.create.3.title": "Définir un mot de passe",
      "tour.create.3.body": "Seul·e·s les encadrant·e·s doivent le connaître — il vous servira à rouvrir le tableau de bord plus tard. Choisissez quelque chose que vous pourrez partager avec vos co-encadrant·e·s le jour J.",
      "tour.create.4.title": "Créer et partager",
      "tour.create.4.body": "En cliquant sur Créer la séance, vous obtenez un code court (et un QR) à partager avec les étudiant·e·s. Vous arrivez ensuite directement dans le tableau de bord.",

      "tour.admin.1.title": "Vos salles d'un coup d'œil",
      "tour.admin.1.body": "Chaque carte ici correspond à une salle. Vous y voyez l'étape en cours, qui y est, le score de l'équipe et les éventuels appels à un·e encadrant·e.",
      "tour.admin.2.title": "Faire avancer toute la séance",
      "tour.admin.2.body": "Utilisez « Avancer toutes les salles » pour les synchroniser, ou les flèches par salle pour rythmer une salle indépendamment.",
      "tour.admin.3.title": "Ouvrir une salle",
      "tour.admin.3.body": "Cliquez sur « Ouvrir la salle » pour voir exactement ce que voient les étudiant·e·s, avec un panneau latéral pour changer de salle sans perdre le contexte.",
      "tour.admin.4.title": "Clôturer et archiver",
      "tour.admin.4.body": "Quand c'est fini, clôturez la séance et téléchargez l'archive. Réponses de groupe, votes et scores sont exportés dans un unique fichier JSON.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "Paramètres",
      "settings.title": "Paramètres",
      "settings.restart-tour": "Revoir la visite d'introduction",
      "settings.close": "Fermer",
      "tour.student.1.title": "Bienvenue dans votre salle",
      "tour.student.1.body": "Voici l'espace de votre équipe pour toute la séance. Petite visite des contrôles que vous utiliserez le plus.",
      "tour.student.2.title": "Nommer votre équipe",
      "tour.student.2.body": "Choisissez ensemble un nom d'équipe — n'importe qui dans la salle peut le saisir. Il apparaît sur le classement en direct.",
      "tour.student.3.title": "Journal des observations",
      "tour.student.3.body": "Quand vous posez une question, examinez ou demandez un examen, la réponse du patient apparaît ici. Sur téléphone, elle s'affiche aussi juste sous le bouton.",
      "tour.student.4.title": "Décisions d'équipe",
      "tour.student.4.body": "Quand une carte de décision apparaît, chacun·e vote pour son choix. Une fois assez de votes, verrouillez la réponse de l'équipe ensemble.",
      "tour.student.5.title": "Réponses de groupe",
      "tour.student.5.body": "Utilisez ce cadre pour ajouter de courts points sur lesquels votre équipe est d'accord. Tout le monde les voit en direct.",
      "tour.student.6.title": "Appeler un·e encadrant·e",
      "tour.student.6.body": "Touchez ici à tout moment pour demander de l'aide. L'encadrant·e voit votre salle signalée sur son tableau de bord.",
      "tour.student.7.title": "Langue et paramètres",
      "tour.student.7.body": "Utilisez ce menu pour changer de langue à tout moment. Le bouton roue dentée ouvre les paramètres de thème et d'accessibilité.",

      "admin.search.placeholder": "Filtrer les salles par nom…",
      "admin.search.clear": "Effacer",
      "admin.search.label": "Filtrer les salles",
      "admin.search.empty": "Aucune salle ne correspond à ce filtre.",

      "rcol.tab.findings": "Résultats",
      "rcol.tab.decisions": "Décisions d'équipe",
      "rcol.tab.discussion": "Discussion",
      "rcol.tab.answers": "Réponses du groupe",
      "rcol.tab.reference": "Référence",

      "findings.title": "Journal des résultats",
      "findings.empty": "Rien demandé pour l'instant — utilisez les boutons à gauche pour avancer dans le cas.",
      "prompts.title": "Questions de discussion",
      "prompts.locked": "Verrouillé — complétez la synthèse clinique (revue des signes d'alerte) pour débloquer les questions de discussion.",

      "reset.btn": "Réinitialiser le cas de cette salle",
      "reset.btn-title": "Effacer les résultats de cette salle"
    },

    // Japanese strings: machine-drafted, then taken through a deeper
    // LLM polish pass (register, consent paragraph flow, warmer
    // closing screens, terser admin verbs). Still NOT reviewed by a
    // native speaker — pull requests welcome.
    ja: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "メインコンテンツへスキップ",

      "splash.tagline": "大学間の医学教育連携を支える協働プラットフォーム。",
      "splash.signed-in-as": "ログイン中:",
      "splash.sign-out": "ログアウト",
      "splash.lang-label": "言語",
      "privacy.title": "CaNaMED — プライバシーポリシー",
      "privacy.subtitle": "あなたのデータの使い方と、あなたの権利",
      "privacy.lang-not-available": "選択された言語によるプライバシーポリシー全文の翻訳はまだご用意できていません。下記の英文が法的拘束力を持つ版です。レビュー済みの<a href=\"privacy.html?lang=fr\">フランス語</a>版または<a href=\"privacy.html?lang=ja\">日本語</a>版もご利用いただけます。",

      "splash.enter.label": "ファシリテーターから配布されたセッションコードを入力してください",
      "splash.enter.placeholder": "例: ABC-DEF",
      "splash.enter.submit": "入室 →",
      "splash.enter.no-code": "コードをお持ちでない方は",
      "splash.enter.go-create": "ファシリテーターの方はこちら — セッションを作成 →",
      "splash.enter.go-account": "Googleでログイン (任意 — プロフィールと履歴を保存) →",

      "splash.account.title": "Googleでログイン",
      "splash.account.subtitle": "本人確認にはGoogleを利用するため、別途パスワードを覚える必要はありません。セッション参加時には登録情報が自動で入力され、参加したセッションの履歴はプロフィールに保存されます。",
      "splash.account.continue-google": "Googleで続行",
      "splash.account.back": "← セッション参加に戻る",

      "splash.profile.title": "プロフィールの設定",
      "splash.profile.subtitle": "ここに入力した情報は、セッションに参加するたびに自動で入力されます。後からアカウントページで変更できます。",
      "splash.profile.name-label": "お名前 (名またはニックネーム)",
      "splash.profile.name-placeholder": "例: Alice / 明里",
      "splash.profile.uni-label": "大学",
      "splash.profile.year-label": "学年",
      "splash.profile.english-label": "英語レベル (CEFR自己評価)",
      "splash.profile.submit": "保存して続行 →",

      "splash.create.title": "CaNaMEDセッションを作成",
      "splash.create.subtitle": "学生に配布する短いコードが発行されます。作成された方がそのセッションのファシリテーター (管理者) となります — 後からセッションを操作するために必要となりますので、ここで設定するパスワードはお忘れなく。",
      "splash.create.name-label": "お名前",
      "splash.create.name-placeholder": "例: Dr Smith",
      "splash.create.workshop-label": "ワークショップ名",
      "splash.create.workshop-optional": "(任意)",
      "splash.create.workshop-placeholder": "例: Caen × 名古屋 — 2026年6月",
      "splash.create.content-label": "シナリオ (このワークショップの臨床ケース)",
      "splash.create.password-label": "セッションパスワードを設定",
      "splash.create.password-placeholder": "ファシリテーターのみが知るパスワード",
      "splash.create.password-hint": "ページを再読み込みした際、管理ダッシュボードを再度開くために必要です。学生には表示されません。大学のパスワードは流用せず、新しいものを設定してください。",
      "splash.create.advanced-toggle": "新しい内容を作成 (上級) ↓",
      "splash.create.custom-label": "カスタム内容 (JSON)",
      "splash.create.custom-help": "name, case, scoring, penalties, decisions を含む JSON オブジェクトを貼り付けてください — 完全な構造は README を参照。「テンプレートを読み込む」で内蔵コンテンツから始められます。",
      "splash.create.custom-desc": "症例を記述する JSON オブジェクトを貼り付けてください。「テンプレートを読み込む」で内蔵コンテンツから始められます。",
      "splash.create.load-template": "テンプレートを読み込む",
      "splash.create.back": "← 戻る",
      "splash.create.submit": "セッションを作成",
      "splash.create.clone-last": "前回のワークショップを複製 ↻",
      "splash.create.clone-clear": "クリア",

      "modal.confirm": "OK",
      "modal.cancel": "キャンセル",
      "modal.advance-all.title": "すべてのルームを進めますか?",
      "modal.advance-all.message": "すべてのルームが次のステージに進みます。ルームごとのプレビューは下記の通りです:",
      "modal.advance-all.ok": "すべて進める",
      "modal.start.too-many-rooms-title": "参加者よりルーム数が多いです",
      "modal.start.too-many-rooms-message": "選択したルーム数より参加者が少ないため、空または少人数のルームができます。それでも開始しますか?",
      "modal.start.weak-rooms-title": "ルームのバランスが取れていません",
      "modal.start.weak-rooms-message": "一部のルームは少人数または単一大学のみです。{cohortPair} の混成グループを目指しています。それでも開始しますか?",
      "modal.start.ok": "それでも開始",
      "modal.close.title": "セッションを終了してアーカイブをダウンロードしますか?",
      "modal.close.message": "すべてのグループの回答・投票・公開・スコア・コントリビューション・参加状況を含む JSON ファイルがダウンロードされ、セッションは終了済みとしてマークされます — 参加者には「ご参加ありがとうございました」のバナーが表示され、それ以上の入力はできなくなります。\n\nデータはデータベースに残ります — アーカイブはいつでも再ダウンロードできます。終了マークは簡単には元に戻せません。",
      "modal.close.ok": "終了してダウンロード",

      "admin.waiting.title": "待合室",
      "admin.waiting.expected-label": "想定人数 (任意)",
      "admin.waiting.expected-placeholder": "例: 30",
      "admin.waiting.expected-hint": "リアルタイムの人数の横に表示され、全員揃ったかどうかを把握できます。",
      "admin.test-alerts": "アラートをテスト",
      "admin.test-alerts-hint": "学生が参加する前に一度クリックしてください — チャイムを鳴らし、デスクトップ通知の許可をリクエストするので、最初のヘルプコールが無音になることはありません。",
      "admin.test-alerts.ok": "チャイムが鳴りました。デスクトップ通知が有効になりました。",
      "admin.test-alerts.ok-noperm": "チャイムが鳴りました。このブラウザはデスクトップ通知に対応していません。",
      "admin.test-alerts.denied": "チャイムは鳴りましたが、デスクトップ通知はブロックされています。ブラウザの設定を確認してください。",
      "admin.test-alerts.noaudio": "ブラウザによって音声がブロックされました — まずページ上をクリックしてから再度お試しください。",
      "admin.test-alerts.dismissed": "チャイムが鳴りました。通知のリクエストが閉じられました — 再度「アラートをテスト」をクリックして再試行してください。",

      "splash.created.title": "セッションを作成しました",
      "splash.created.subtitle": "このコードを学生に共有してください。学生は同じページでこのコードを入力して参加します。",
      "splash.created.copy": "コピー",
      "splash.created.copy-link": "リンクをコピー",
      "splash.created.qr-caption": "またはスマートフォンでQRコードを読み取ってください",
      "splash.created.create-another": "別のセッションを作成",
      "splash.created.open-admin": "管理ダッシュボードを開く →",

      "lobby.join-title": "参加者として参加",
      "lobby.join-hint": "大学・学年・英語レベルに応じて、{cohortPair} の混成ルームへ自動的に振り分けられます。",
      "lobby.uni-label": "大学",
      "lobby.uni-placeholder": "大学を選択してください…",
      "lobby.year-label": "学年",
      "lobby.year-postgrad": "大学院生 / 研修医",
      "lobby.english-label": "英語レベル (CEFR自己評価)",
      "lobby.english-hint": "CEFRレベル: A2 初級 · B1 中級 · B2 中上級 (複雑な話題を議論できる) · C1 上級 · C2 熟達。最も近いものを選んでください — ルームのバランス調整のためにのみ使用されます。",
      "lobby.name-label": "お名前 (名またはニックネーム)",
      "lobby.name-placeholder": "例: Alice / 明里",
      "lobby.consent-workshop": "上記のデータ利用に関する説明を読んだうえで、このCaNaMEDワークショップへの参加に同意します。",
      "lobby.consent-workshop-detail": "私の名前(またはニックネーム)・大学・学年・英語レベル、およびワークショップ中に入力する文章は、同じルームの参加者とファシリテーターから閲覧できる状態となります。",
      "lobby.consent-research": "加えて、自身の貢献内容 (グループ回答・投票・スコア) を、CaNaMED教育研究プロジェクトにおいて仮名化したうえで分析・公表する目的で利用することに同意します。この2つ目のチェックを入れなくてもワークショップには参加でき、同意しないことによって参加・成績・所属大学での立場に何ら影響が生じないことを理解しています。",
      "lobby.consent-version": "説明文書のバージョン: PIS v1 · 2026-05。",
      "lobby.consent-version-link": "プライバシーポリシー全文",
      "lobby.consent-version-suffix": "。",
      "lobby.consent-required-hint": "参加するには、上記のデータ利用に関する説明をお読みのうえ、同意のチェックボックスにチェックを入れてください。",
      "lobby.consent-required-title": "このボタンを有効にするには、上のワークショップ参加同意のチェックを入れてください。",
      "lobby.session-code-label": "セッションコード",
      "lobby.session-code-placeholder": "例: ABC-DEF",
      "lobby.name-required-hint": "お名前を入力してください。",
      "lobby.session-required-hint": "セッション番号を入力してください。",
      "lobby.university-required-hint": "ご所属の大学を選択してください。",
      "lobby.join-btn": "待合室に入る",
      "lobby.session-code-label": "セッションコード",
      "lobby.admin-toggle": "ファシリテーターとして入る ›",
      "lobby.admin-pass-label": "管理者パスワード",
      "lobby.admin-pass-placeholder": "セッションのパスワード",
      "lobby.admin-open-dashboard": "管理ダッシュボードを開く",
      "lobby.superadmin-toggle": "スーパー管理者: パスワードの設定 / 変更",
      "lobby.superadmin-key-label": "スーパー管理者キー",
      "lobby.superadmin-key-placeholder": "スーパー管理者キー",
      "lobby.new-pass-label": "新しいセッションのパスワード",
      "lobby.new-pass-placeholder": "新しいセッションのパスワード",
      "lobby.new-pass-confirm-label": "新しいパスワードの確認",
      "lobby.new-pass-confirm-placeholder": "新しいパスワード（確認）",
      "lobby.forgot-pass-link": "パスワードをお忘れですか? スーパー管理者キーでリセットする ›",
      "lobby.superadmin.disabled": "この環境ではスーパー管理者機能は無効になっています。",
      "lobby.superadmin.bad-key": "スーパー管理者キーが正しくありません。",
      "lobby.superadmin.no-new-pass": "設定する新しいセッションパスワードを入力してください。",
      "lobby.superadmin.confirm-mismatch": "二つのパスワード欄が一致しません — 新しいパスワードを入力し直してください。",
      "lobby.save-pass-btn": "パスワードを保存して管理画面を開く",
      "lobby.err.name-required": "お名前を入力してください。",
      "lobby.err.session-required": "セッションコードを入力してください。",
      "lobby.err.consent-required": "上記のデータ利用に関する説明をお読みのうえ、参加するには同意のチェックボックスにチェックを入れてください。",
      "lobby.err.university-required": "所属大学を選択してください。",

      "lobby.privacy.summary": "データの利用方法 (参加前に必ずお読みください)",
      "lobby.privacy.p1": "CaNaMED研究チーム (<strong>カーン・ノルマンディー大学 × 名古屋大学</strong>、GDPR第26条上の共同管理者 / APPI第27条(5)上の共同利用者) は、皆さんの名前またはニックネーム、所属大学、学年、自己評価による英語レベルを収集します。お名前は同じルームの全員に表示され、貢献したポイントの横に並んで表示されます。",
      "lobby.privacy.p2": "自由記述で回答する内容には、臨床シナリオに関する健康・宗教・思想信条に関わる見解が含まれる可能性があります — GDPR第9条上の<strong>特別カテゴリのデータ</strong>、およびAPPI第2条(3)上の<strong>要配慮個人情報</strong>に該当します。下の2つ目の任意の同意ボックスがこれに対応します。",
      "lobby.privacy.p3": "データは Google Firebase Realtime Database (<strong>europe-west1, ベルギー, EU</strong>) に保存されます。日本の参加者にとっては越境移転にあたりますが、EU・日本相互の十分性認定 (個人情報保護委員会, 2019年) によって保護されます。ライブセッションのデータは7日以内に削除されます。研究利用への同意ボックスにチェックを入れた場合、皆さんの貢献内容は仮名化のうえで論文公表後最長5年間保持されます。",
      "lobby.privacy.p4": "<strong>Googleでのサインインは任意です。</strong> サインインした場合、簡易プロフィールと参加したセッションコードの一覧がGoogleアカウントに紐付けられます。これらは「マイアカウント」パネルからいつでも編集・削除できます。匿名で参加する場合もまったく同じように動作します。",
      "lobby.privacy.p5": "同意はいつでも撤回できます。2つ目の同意ボックスにチェックを入れるかどうかは、<strong>皆さんの成績、所属大学での立場、ワークショップへの参加には一切影響しません。</strong> 権利の行使 (アクセス、訂正、削除、ポータビリティ、制限、異議、撤回、苦情) を希望する場合は、ファシリテーターにご連絡いただくか、<strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> までご連絡ください (恒久的な連絡先は<a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">プライバシーポリシー全文</a>を参照)。",
      "lobby.privacy.p6": "<a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">プライバシーポリシー全文</a>には、管理者の身元、法的根拠、共同利用項目、国際移転に関する保護措置、保持期間、回答までの期日を含む皆さんの権利、および倫理委員会の承認が記載されています。参加前に必ず一度お読みください。",

      "waiting.title": "待合室",
      "waiting.you-are": "参加者:",
      "waiting.leave": "退出",
      "waiting.status-not-started": "参加が完了しました。ファシリテーターがセッションを開始するまでお待ちください…",
      "waiting.status-starting": "セッションが開始されました — ルームへの割り当てを行っています…",
      "waiting.heading": "参加が完了しました",
      "waiting.body": "<strong id=\"waiting-name\"></strong> さん、待合室にご案内しています。ファシリテーターが {cohortPair} の混成ルームへ振り分け、まもなくセッションを開始します。<strong>画面は自動的に切り替わります</strong> — 何も操作する必要はありません。",
      "waiting.teams-btn": "Teams通話に参加",
      "waiting.joined-so-far": "現在の参加者",

      // R3-C1 — 途中参加バナー
      "waiting.late-join.banner": "あなたが参加した時点で、ルームはすでに「{stage}」に進んでいます。前のステージはあなたが到着する前に終了しました — いつでも「← 前のステージを確認」ボタンから読み返せます。  ",
      "waiting.late-join.dismiss": "了解しました",

      "data-rights.export-btn": "自分のデータをダウンロード (JSON) ⤓",
      "data-rights.err.no-session": "まずセッションに参加してください — エクスポートするデータがまだありません。",
      "data-rights.err.not-ready": "プラットフォームの準備中です。少し待ってからもう一度お試しください。",
      "data-rights.err.export-failed": "データをエクスポートできませんでした — もう一度お試しいただくか、ファシリテーターまでご連絡ください。",

      "stage.label.0": "ようこそ",
      "stage.label.1": "モジュールA — 慢性疼痛",
      "stage.label.2": "モジュールB — 悪い知らせを伝える",
      "stage.label.3": "まとめ",

      "stage.welcome.title": "セッション3へようこそ",
      "stage.welcome.intro": "テーマ: 互いから学ぶ — 学生主体の交流セッションです。本日のプログラムはすべてこのプラットフォームから進行します。皆さんで一緒に進めていただき、ファシリテーターが各ルームを次のブロックへと進めます。",
      "stage.welcome.grade-note": "このワークショップが皆さんの成績や所属大学での立場に影響することは一切ありません。プラットフォーム上で付与されるポイントはセッション中の学習のためのものであり、大学の成績には反映されません。ポイントやペナルティに納得がいかない場合は、ファシリテーターにお知らせください。スコアは見直しの対象となります。",

      "room.call-facilitator": "ファシリテーターを呼ぶ",
      "room.team-name-label": "チーム名",
      "room.answer-input-label": "モジュールAのグループ回答を追加",
      "room.answer-input-label-b": "モジュールBのグループ回答を追加",
      "room.call.throttle-recall": "ファシリテーターを再度呼ぶまで{seconds}秒お待ちください。",
      "room.call.throttle-again": "ファシリテーターを再度呼ぶまで{seconds}秒お待ちください。",
      "room.answer.err.edit-failed": "編集を保存できませんでした — 接続を確認してください。入力内容: ",
      "room.answer.err.delete-failed": "この項目を削除できませんでした — 接続を確認してもう一度お試しください。",
      "room.answer-input-language-hint": "好きな言語で書いてください — ファシリテーターと仲間は英語・フランス語・日本語を読めます。",
      "room.answer-input-placeholder": "ポイントを追加 — あなたの名前と色とともに表示されます",
      "room.answers.hint.moduleA": "ルームの誰でもポイントを追加できます — 自動的に保存されます。上の4つの項目をカバーしましょう。フランスと日本の双方から書き込んでください。",
      "room.answers.hint.moduleB": "ルームの誰でもポイントを追加できます — 自動的に保存されます。上の3つの項目をカバーしましょう。フランスと日本の双方から書き込んでください。",
      "room.answers.hint.count-one": "現在 {n} 件の回答",
      "room.answers.hint.count-many": "現在 {n} 件の回答",
      "room.answers.hint.both-wrote": "✓ フランスと日本の両方が書き込みました",
      "room.answers.hint.one-wrote": "片方の国だけが書き込みました — もう一方にも声をかけましょう",
      "room.answers.hint.suffix": "自分の言葉で書いてください — 短く明快な英語がここでは良い英語です。",

      "admin.mute-alerts": "呼び出し音とデスクトップ通知をミュート",
      "admin.download-error-log": "エラーログをダウンロード",
      "admin.theme": "テーマ",
      "admin.theme.auto": "自動（OS設定）",
      "admin.theme.light": "ライト",
      "admin.theme.dark": "ダーク",
      "admin.theme.hc": "ハイコントラスト",
      "admin.report-bug": "バグを報告",

      "admin.start-session": "セッション開始 — 全員をルームに振り分け",
      "admin.advance-all": "全ルームを進める →",
      "admin.download-all": "全グループの回答をダウンロード",
      "admin.end-session": "セッション終了 & アーカイブをダウンロード",

      "stage.modB.title": "モジュールB — 悪い知らせを伝える: 異文化間ロールプレイ",

      "stage.modB.vignette.body": "<strong>状況設定 (一度、皆で読みましょう)。</strong> タナカ・マルタン氏 (<strong>60歳</strong>) が、倦怠感と体重減少を主訴に来院しました。検査結果が出ました — 診断は <strong>深刻で慢性的、人生を変える病気</strong> です。グループで一つ選んでください (例: 新たに診断されたがん、進行した心不全、初期のパーキンソン病、透析が必要な腎不全など)。<strong>治療は可能だが治癒はしない</strong> 病気で、患者の生活を一変させます。患者本人はまだ知りません。<strong>成人した子ども</strong> が一緒に診察室にいて — ある瞬間、小声であなたに何かを頼むでしょう。",

      "stage.modB.safety.heading": "<strong>始める前に — 二つお伝えします。</strong>",
      "stage.modB.safety.simulation": "<em>これはシミュレーションです。</em> それでも感情は本物のように感じることがあります。もし内容が自分に近すぎると感じたら、いつでも観察者の役に移って構いません。理由を説明する必要はありません。振り返りでは <strong>医師の選択</strong> について話してください — 人そのものを批判しないでください。",
      "stage.modB.safety.language": "<em>ここでは英語は誰にとっても第二・第三言語です</em> — それもこの演習の狙いの一部です。言葉が出てこないときは、ゆっくり話す、簡単な言葉を使う、間をとる、で構いません。この会話では沈黙が許され、しばしば助けになります。共感は声の調子・ペース・表情に宿るものであり、難しい語彙にはありません。",

      "stage.modB.intro.hint": "このモジュールはグループで進めるロールプレイです。観察者が時間を計りながら、四つのフェーズを順に進めてください。",

      "stage.modB.phase1.title": "フェーズ1 — 準備 (6分)",
      "stage.modB.phase1.intro": "各役に志願者を一人ずつ決め、それ以外は全員観察者になります。自分用の短い説明を読んでから始めてください。",
      "stage.modB.phase1.role.physician": "<strong>医師</strong> — 検査結果はあなたの手元にあります。誠実かつ共感をもって知らせを伝え、診察室で起こることに対応してください。SPIKES (下の帯を参照) を念頭に置きつつ、暗唱はしないように。「うまく終わらせる」必要も、すべて解決する必要もありません — 良い面談は、患者がまだ動揺したまま終わってもよいのです。",
      "stage.modB.phase1.role.patient": "<strong>患者</strong> — あなたは60歳です。何かおかしいと薄々感じていましたが、何でもないことを願っていました。どう反応するかは自分で決めてください。場面が進む中で変わってもかまいません。<strong>一つだけ事前に決めてください: 心の奥で、すべて知りたいですか、それとも知りたくないですか?</strong> それを口に出さずに — 医師に発見させてください。",
      "stage.modB.phase1.role.family": "<strong>家族 (成人した子ども)</strong> — あなたは親を愛していて、怖れています。診察の途中で — 最初ではなく — 自然なタイミングを見つけて <strong>声を落とし、医師に脇でこう話してください</strong>: 「親に全部は伝えないでほしい」と。心の中で理由を一つ用意してください。静かで善意のある頼み方で、要求ではないように。",
      "stage.modB.phase1.role.observer": "<strong>観察者 (1名以上)</strong> — あなたが時間を計り、フェーズ3を進めます。場面の間は静かにしてください。<em>SPIKES のステップ</em> に注目しましょう: 何が信頼を生んだか、何が距離を生んだか、家族が医師に話した瞬間に医師は何をしたか。医師が <em>言った言葉</em> で効果があったものを一つ、難しかった瞬間を一つメモしてください。",

      "stage.modB.spikes.label": "SPIKES",
      "stage.modB.spikes.s": "<strong>S</strong>etting — 環境設定",
      "stage.modB.spikes.p": "<strong>P</strong>erception (相手はすでに何を理解しているか?)",
      "stage.modB.spikes.i": "<strong>I</strong>nvitation (どこまで知りたいか?)",
      "stage.modB.spikes.k": "<strong>K</strong>nowledge (情報を小さく、平易な言葉で)",
      "stage.modB.spikes.e": "<strong>E</strong>motions (感情に名前を与え、受け止める)",
      "stage.modB.spikes.s2": "<strong>S</strong>trategy (次の一歩を合意する。見捨てないと伝える)",

      "stage.modB.spikes.useful.label": "役立つフレーズ (英語は誰にとっても第二言語です):",
      "stage.modB.spikes.useful.examples": "「I'm afraid I have some serious news.」·「Would you like me to explain everything, or focus on what we do next?」·「I can see this is hard to hear.」·「Take your time.」·「What questions do you have for me?」",

      "stage.modB.phase2.title": "フェーズ2 — 演じる (場面12分 + 入れ替え3分)",
      "stage.modB.phase2.intro": "観察者が「start」と言ったら、患者はすでに座っている状態で医師が始めます。医師は知らせを伝え、その場で家族の頼みにも対応します。観察者は黙って見守り、終わりに「time」と告げます。<strong>その後、医師役を交代してもう一度演じます</strong> — 2回の演習を通じて、Caen と Nagoya の学生がそれぞれ少なくとも1回は医師役を担うようにしてください。2回目はほぼ必ず良くなります。その「良くなり方」も話し合う価値があります。",

      "stage.modB.framework.label": "<strong>家族から情報を伏せてほしいと頼まれたとき —「立ち止まる · 探る · 説明する · 整え直す」:</strong>",
      "stage.modB.framework.pause": "<strong>立ち止まる</strong> — その場で断っても、同意してもいけません。まず感謝を伝えてください。家族の心配は本物で、たいていは愛情からきています。",
      "stage.modB.framework.explore": "<strong><em>なぜ</em> を探る</strong> — 「親御さんが知ることで何が一番心配ですか? もう少し聞かせてください。」",
      "stage.modB.framework.explain": "<strong>立場を説明する</strong> — 知りたいと望む患者を欺くことはできません。同時に、知りたくない人に情報を押しつける必要もありません。",
      "stage.modB.framework.realign": "<strong>整え直す</strong> — <em>患者本人</em> に、どこまで知りたいか、誰に関わってほしいかを尋ねます (これが SPIKES の「Invitation」です)。家族の心配は、患者から隠す秘密ではなく、会話の一部になります。",

      "stage.modB.phase3.title": "フェーズ3 — 対話 (15分)",
      "stage.modB.phase3.ground-rule": "<strong>基本ルール (観察者が声に出して読みます):</strong> 私たちは <em>診療実践とその変化</em> を比べているのであって、国に順位をつけているのではありません。どちらのモデルも「進んでいる方」ではありません。実際に見たこと、学んだことを話してください — 「よく分からない、今変わりつつある」と言うのもまったく構いません。",
      "stage.modB.phase3.intro": "観察者が以下の問いを一つずつ読み上げます — それぞれについて、Caen と Nagoya の両方から声が上がるようにしてください:",
      "stage.modB.phase3.q1": "<strong>情報は誰のためのものか?</strong> 深刻な知らせがあるとき、<em>最初に</em> 伝えられるのは — 患者か、家族か? それは法律が定めることか、教科書に書かれていることか、それとも実際の現場で起きていることか? フランスと日本で <strong>共通する</strong> 点と、<strong>異なる</strong> 点をそれぞれ一つずつ挙げてください。",
      "stage.modB.phase3.q2": "<strong>変化したか?</strong> 20〜30年前は告知の仕方が違いましたか? (日本: がん告知率は1990年代初頭の約30%未満から2016年には約94%まで上昇。フランス: 2002年のクシュネル法 (<em>loi Kouchner</em>) が患者の情報権を変えました。) なぜ規範は変わるのでしょう — 法、世代、期待?",
      "stage.modB.phase3.q3": "<strong>家族の静かな頼み — あなたは実際にどうしましたか? なぜ?</strong> フランスの典型的な医師と日本の医師は同じように対応するでしょうか? それぞれが最も恐れているのは — 患者に嘘をつくこと、それとも患者を傷つけること? 「悪い知らせから誰かを守ること」は愛か、選択肢を奪うことか — それとも両方か?",
      "stage.modB.phase3.q4": "<strong>自律 vs 家族 — 本当にどちらか一つなのか?</strong> フランスは「自律性優先」、日本は「家族中心」と言われます — しかしフランス法は <em>知らされない</em> 権利も保障しており、今日の日本の患者の多くは完全な情報を望んでいます。あなたの国は実際どこに位置しますか? <em>両方</em> のモデルはどのようなものでしょう?",
      "stage.modB.phase3.q5": "<strong>言語の壁を越えた共感。</strong> 英語で悪い知らせを伝えました。Caen と Nagoya の学生が頼ったものは違いましたか — 言葉、沈黙、声の調子、身体表現? 言語の壁を越えて伝わるものは何で、失われるものは何ですか?",
      "stage.modB.phase3.q6": "<strong>難しかったのは何か — そして同じように難しかったか?</strong> Caen と Nagoya の学生は <em>異なる</em> 部分を難しく感じましたか (沈黙? 家族? 診断名を声に出すこと? 苦しみを解決できないこと?) その違いは何を物語っていますか?",

      "stage.modB.phase4.title": "フェーズ4 — 要点を書く (5分)",
      "stage.modB.phase4.intro": "下のグループ回答欄に書いてください (最後にファシリテーターが回収します):",
      "stage.modB.phase4.b1": "情報を伏せてほしいという家族の頼みに、あなたのグループならどう答えるか — 具体的な一文。",
      "stage.modB.phase4.b2": "フランスと日本で告知の実践が <strong>異なる</strong> 一つの点 — そして <strong>近づきつつある</strong> 一つの点。",
      "stage.modB.phase4.b3": "この議論を受けて、それぞれが自国で違うふうにしようと思うこと、一つずつ。",

      "stage.modB.answers.title": "グループ回答 — モジュールB",

      "stage.wrap.title": "まとめと次のステップ",
      "stage.wrap.thanks": "ご参加ありがとうございました。退室する前に以下をお願いします:",
      "stage.wrap.do-questionnaire": "セッション終了アンケートにご回答ください — 数分で完了します。また、3週間後に短いポストテストを実施します。",
      "stage.wrap.answers-saved": "グループの回答は下記に保存されています — ファシリテーターが回収します。",
      "stage.wrap.open-questionnaire": "セッション終了アンケートを開く",
      "stage.wrap.questionnaire-fallback": "ファシリテーターからアンケートのリンクが共有されます。",
      "stage.wrap.bye": "アンケートにご回答いただけましたら、このタブを閉じてお戻りください。セッション4でお会いしましょう!",
      "stage.wrap.room-answers": "ルームの回答",

      "test.pre.title": "セッション前の簡単な知識チェック",
      "test.pre.intro": "本日のワークショップが始まる前に、これから議論するシナリオに関する短い選択式の確認テストをご用意しています。所属大学内では匿名で、回答は任意であり、成績には影響しません。",
      "test.pre.start": "プレテストを開始",
      "test.post.title": "セッション後の簡単な知識チェック",
      "test.post.intro": "ワークショップが終了したので、本日のセッションで何が変わったかを確認するための短い選択式テストを実施します。所属大学内では匿名で、回答は任意であり、成績には影響しません。",
      "test.post.start": "ポストテストを開始",
      "test.question": "問題 {n} / {total}",
      "test.submit": "回答を確定",
      "test.next": "次の問題 →",
      "test.see-results": "結果を見る →",
      "test.skip": "テストをスキップ",
      "test.skip-question": "この問題をスキップ",
      "test.correct": "正解",
      "test.incorrect": "惜しい",
      "test.complete": "テスト終了",
      "test.score-line": "{total} 問中 {n} 問正解です。",
      "test.thanks": "ありがとうございました — ご回答はワークショップの改善に役立ちます。グループ内で匿名のまま保存されます。",
      "test.skipped": "テストをスキップしました。気が変わった場合は今からでも受けられます。",
      "test.already-done": "本日のテストはすでに完了しています。ありがとうございました!",
      "test.error-save": "現在ご回答を保存できません — セッション中のポイントには影響しません。",
      "test.late-join-closed": "プレテストはあなたのルームが開始した時点で締め切られました。ワークショップ開始前に受験して初めて意味があるためです — セッション終了時のポストテストは引き続きカウントされます。",

      "closed.title": "ファシリテーターによりセッションが終了されました。",
      "closed.subtitle": "ご参加ありがとうございました — チームの成果は保存されています。",

      "ended.title": "ご参加ありがとうございました",
      "ended.message": "ファシリテーターによりこのセッションは終了されました。チームでの成果は保存されています。",
      "ended.questionnaire": "セッション終了アンケートを開く →",
      "ended.future": "今後のCaNaMEDワークショップにご参加いただく際には、新しいセッションコードが発行されます。",
      "ended.return": "CANAMEDに戻る",

      "offline.banner": "オフラインです。再接続を試みています…",

      "debrief.toggle": "振り返りを開く",
      "debrief.toggle-close": "振り返りを閉じる",
      "debrief.title": "セッション振り返り",
      "debrief.subtitle": "全ルーム横断の集計データ — 振り返り討論に役立ちます。",
      "debrief.empty": "セッションを開始すると、ここに集計データが表示されます。",
      "debrief.section.ranking": "ルームのランキング",
      "debrief.section.decisions": "意思決定の内訳",
      "debrief.section.penalties": "ペナルティのヒートマップ",
      "debrief.section.concepts": "概念のカバレッジ",
      "debrief.section.funnel": "参加ファネル",
      "debrief.section.time": "ステージ別の時間",
      "debrief.col.room": "ルーム",
      "debrief.col.team": "チーム",
      "debrief.col.score": "スコア",
      "debrief.no-data": "まだデータがありません。",
      "debrief.no-commit": "まだどのルームもこの決定を確定していません。",
      "debrief.rooms-picked": "ルーム",
      "debrief.correct-option": "(正解)",
      "debrief.module-a": "モジュールA",
      "debrief.module-b": "モジュールB",
      "debrief.penalty-fired": "発動",
      "debrief.penalty-rooms": "影響を受けたルーム",
      "debrief.concept.rooms-hit": "ルームが到達",
      "debrief.funnel.registered": "プールに参加",
      "debrief.funnel.assigned": "ルームに割り当て",
      "debrief.funnel.answered": "1件以上回答",
      "debrief.funnel.voted": "意思決定に投票",
      "debrief.time.minutes": "分",
      "debrief.time.stage": "ステージ",
      "debrief.points-per-room": "ポイント / ルーム",

      "debrief.student.title": "あなたのチームの振り返り",
      "debrief.student.score": "あなたのチームの獲得点数:",
      "debrief.student.score-suffix": "点",
      "debrief.student.decisions-locked": "件の意思決定を確定",
      "debrief.student.agreed": "あなたのチームが最も安全な答えを選んだ意思決定",
      "debrief.student.disagreed": "再考すべき意思決定",
      "debrief.student.top-concept": "あなたのチームが最もよく扱った概念",
      "debrief.student.missed-concept": "あなたのチームが触れられなかった概念",
      "debrief.student.engaged": "最も集中した瞬間",
      "debrief.student.engaged-detail": "を費やしました:",
      "debrief.student.closing": "ご参加ありがとうございました — 一つ一つの貢献がパートナーシップを育てます。",
      "debrief.student.none": "—",
      "debrief.student.no-team": "あなたのチームの貢献は保存されました。",
      "debrief.student.team-label": "あなたのチーム",

      "tour.btn.next": "次へ",
      "tour.btn.back": "戻る",
      "tour.btn.skip": "ツアーをスキップ",
      "tour.btn.done": "完了",
      "tour.btn.close": "閉じる",
      "tour.progress": "{n} / {total} ステップ",
      "tour.reopen": "ツアーをもう一度見る",

      "tour.create.1.title": "ワークショップ名",
      "tour.create.1.body": "このセッションに分かりやすい名前を付けてください (例: 「Caen × 名古屋 — 2026年6月」)。任意ですが、後で次回用に複製する際に役立ちます。",
      "tour.create.2.title": "シナリオを選択",
      "tour.create.2.body": "学生が取り組む臨床コンテンツを選択します。上級者向けには、カスタムシナリオをJSONとして貼り付けることもできます。",
      "tour.create.3.title": "セッションパスワードを設定",
      "tour.create.3.body": "ファシリテーターのみが知るべきものです。後でダッシュボードを再度開く際に必要となります。当日に共同ファシリテーターと共有できる文字列を選んでください。",
      "tour.create.4.title": "作成して共有",
      "tour.create.4.body": "「セッションを作成」をクリックすると、学生に共有する短いコード (とQR) が発行されます。その後、管理ダッシュボードへ直接遷移します。",

      "tour.admin.1.title": "ルーム一覧",
      "tour.admin.1.body": "各カードは1つのルームです。現在のステージ、参加者、チームのスコア、ファシリテーター呼び出しの有無を確認できます。",
      "tour.admin.2.title": "セッション全体を進める",
      "tour.admin.2.body": "「全ルームを進める」で全ルームを同期して進められます。ルームごとの矢印を使えば、個別にペース調整も可能です。",
      "tour.admin.3.title": "ルームを開く",
      "tour.admin.3.body": "「ルームを開く」をクリックすると、学生と同じ画面が表示され、サイドパネルから文脈を失わずにルームを切り替えられます。",
      "tour.admin.4.title": "終了とアーカイブ",
      "tour.admin.4.body": "終了時には、セッションをクローズしてアーカイブをダウンロードしてください。グループの回答・投票・スコアが1つのJSONファイルにエクスポートされます。",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "設定",
      "settings.title": "設定",
      "settings.restart-tour": "はじめてのご案内をもう一度",
      "settings.close": "閉じる",
      "tour.student.1.title": "ルームへようこそ",
      "tour.student.1.body": "ここはセッション中、皆さんのチーム専用の場所です。よく使う操作を簡単にご案内します。",
      "tour.student.2.title": "チーム名を決めましょう",
      "tour.student.2.body": "チームで楽しい名前を考えてみてください。ルームの誰でも設定でき、ライブのリーダーボードに表示されます。",
      "tour.student.3.title": "所見ログ",
      "tour.student.3.body": "質問・診察・検査を選ぶと、患者さんの応答がここに表示されます。スマートフォンでは、タップしたボタンの直下にも表示されます。",
      "tour.student.4.title": "チームでの意思決定",
      "tour.student.4.body": "決定カードが表示されたら、それぞれが選択肢をタップします。十分な人数が投票したら、チームの回答を一緒にロックインしてください。",
      "tour.student.5.title": "グループの回答",
      "tour.student.5.body": "チームで合意した要点をここに短く書き加えてください。皆さんに同時に表示されます。",
      "tour.student.6.title": "ファシリテーターを呼ぶ",
      "tour.student.6.body": "助けが必要な時はいつでもここをタップしてください。ファシリテーターのダッシュボードにルームが表示されます。",
      "tour.student.7.title": "言語と設定",
      "tour.student.7.body": "このドロップダウンでいつでも言語を切り替えられます。隣の歯車ボタンから、テーマやアクセシビリティの設定を開けます。",

      "admin.search.placeholder": "ルーム名で絞り込み…",
      "admin.search.clear": "クリア",
      "admin.search.label": "ルームを絞り込み",
      "admin.search.empty": "条件に一致するルームはありません。",

      "rcol.tab.findings": "所見",
      "rcol.tab.decisions": "チームの意思決定",
      "rcol.tab.discussion": "ディスカッション",
      "rcol.tab.answers": "グループの回答",
      "rcol.tab.reference": "参考資料",

      "findings.title": "所見ログ",
      "findings.empty": "まだ何も尋ねていません。左のボタンを使って症例を進めてください。",
      "prompts.title": "ディスカッションの設問",
      "prompts.locked": "ロック中 — 臨床的総合（レッドフラッグの確認）を完了するとディスカッションの設問が解放されます。",

      "reset.btn": "このルームの症例をリセット",
      "reset.btn-title": "このルームの所見を消去します"
    },

    // Spanish — neutral Latin American Spanish (no voseo). Medical
    // register; "usted" used in the consent paragraphs and other
    // legally-binding copy. Machine-drafted, NOT yet reviewed by a
    // native speaker — corrections welcome.
    es: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "Saltar al contenido principal",

      "splash.tagline": "Una plataforma colaborativa para alianzas de educación médica entre universidades.",
      "splash.signed-in-as": "Sesión iniciada como",
      "splash.sign-out": "Cerrar sesión",
      "splash.lang-label": "Idioma",
      "privacy.title": "CaNaMED — Política de privacidad",
      "privacy.subtitle": "Cómo utilizamos sus datos y sus derechos",
      "privacy.lang-not-available": "Aún no se encuentra disponible una traducción completa de esta política de privacidad en el idioma seleccionado. El texto en inglés que aparece a continuación es la versión jurídicamente vinculante. También están disponibles las versiones revisadas en <a href=\"privacy.html?lang=fr\">francés</a> y en <a href=\"privacy.html?lang=ja\">japonés</a>.",

      "splash.enter.label": "Ingrese el código de sesión que le entregó su facilitador/a",
      "splash.enter.placeholder": "p. ej. ABC-DEF",
      "splash.enter.submit": "Entrar →",
      "splash.enter.no-code": "¿Aún no tiene código?",
      "splash.enter.go-create": "Soy facilitador/a — crear una sesión →",
      "splash.enter.go-account": "Iniciar sesión con Google para guardar mi perfil e historial →",

      "splash.account.title": "Iniciar sesión con Google",
      "splash.account.subtitle": "Usamos Google para verificar su identidad — no necesita recordar otra contraseña. Sus datos se completan automáticamente al unirse a una sesión, y las sesiones en las que ha participado se conservan en su perfil.",
      "splash.account.continue-google": "Continuar con Google",
      "splash.account.back": "← Volver para unirse a una sesión",

      "splash.profile.title": "Configurar su perfil",
      "splash.profile.subtitle": "Estos datos se completan automáticamente cada vez que se une a una sesión. Puede actualizarlos más tarde desde su cuenta.",
      "splash.profile.name-label": "Su nombre (nombre o apodo)",
      "splash.profile.name-placeholder": "p. ej. Alice / Akari",
      "splash.profile.uni-label": "Universidad",
      "splash.profile.year-label": "Año de estudio",
      "splash.profile.english-label": "Nivel de inglés (autoevaluación MCER)",
      "splash.profile.submit": "Guardar y continuar →",

      "splash.create.title": "Crear una sesión CaNaMED",
      "splash.create.subtitle": "Recibirá un código corto para compartir con sus estudiantes. Usted será su facilitador/a (admin) — conserve la contraseña definida aquí para poder controlarla más tarde.",
      "splash.create.name-label": "Su nombre",
      "splash.create.name-placeholder": "p. ej. Dr. Smith",
      "splash.create.workshop-label": "Nombre del taller",
      "splash.create.workshop-optional": "(opcional)",
      "splash.create.workshop-placeholder": "p. ej. Caen × Nagoya — junio de 2026",
      "splash.create.content-label": "Contenido del taller",
      "splash.create.password-label": "Defina una contraseña de sesión",
      "splash.create.password-placeholder": "algo que solo los facilitadores conozcan",
      "splash.create.back": "← Volver",
      "splash.create.submit": "Crear sesión",
      "splash.create.clone-last": "Clonar último taller ↻",
      "splash.create.clone-clear": "Borrar",

      "splash.created.title": "Sesión creada",
      "splash.created.subtitle": "Comparta este código con sus estudiantes. Lo ingresan en esta misma página para unirse.",
      "splash.created.copy": "Copiar",
      "splash.created.copy-link": "Copiar enlace",
      "splash.created.qr-caption": "O escanee el QR con un teléfono",
      "splash.created.create-another": "Crear otra",
      "splash.created.open-admin": "Abrir panel de administración →",

      "lobby.join-title": "Unirse como participante",
      "lobby.join-hint": "Será asignado/a automáticamente a una sala mixta {cohortPair} — equilibrada por universidad, año y nivel de inglés.",
      "lobby.uni-label": "Universidad",
      "lobby.uni-placeholder": "Seleccione su universidad…",
      "lobby.year-label": "Año de estudio",
      "lobby.year-postgrad": "Posgrado / Residente",
      "lobby.english-label": "Nivel de inglés (autoevaluación MCER)",
      "lobby.english-hint": "Niveles MCER: A2 elemental · B1 intermedio · B2 intermedio alto (puede discutir temas complejos) · C1 avanzado · C2 dominio. Elija el más cercano — solo se usa para equilibrar las salas.",
      "lobby.name-label": "Su nombre (nombre o apodo)",
      "lobby.name-placeholder": "p. ej. Alice / Akari",
      "lobby.consent-workshop": "He leído el aviso sobre el uso de datos que figura arriba y consiento mi participación en este taller CaNaMED.",
      "lobby.consent-workshop-detail": "Mi nombre, universidad, año, nivel de inglés y los textos que escriba durante el taller serán visibles para las demás personas de mi sala y para los/as facilitadores/as.",
      "lobby.consent-research": "Adicionalmente consiento que mis contribuciones (respuestas grupales, votos, puntuaciones) sean utilizadas para el proyecto de investigación educativa CaNaMED (análisis y publicación en forma seudonimizada). Entiendo que puedo participar en el taller sin marcar esta segunda casilla — la negativa no tiene ningún efecto sobre mi participación, mis calificaciones ni mi situación en mi universidad.",
      "lobby.consent-version": "Versión del aviso PIS v1 · 2026-05. ",
      "lobby.consent-version-link": "Política de privacidad completa",
      "lobby.consent-version-suffix": ".",
      "lobby.privacy.summary": "Cómo se utilizan sus datos (lea antes de unirse)",
      "lobby.privacy.p1": "El equipo de investigación CaNaMED (<strong>Université de Caen Normandie × Universidad de Nagoya</strong>, corresponsables del tratamiento según el art. 26 RGPD / usuarios conjuntos según el art. 27(5) APPI) recopila su nombre o apodo, universidad, año de estudios y nivel de inglés autoevaluado. Su nombre es visible para todas las personas de su sala y aparece junto a los puntos que aporta.",
      "lobby.privacy.p2": "Las respuestas de texto libre que escriba pueden revelar opiniones relacionadas con la salud, religiosas o filosóficas sobre escenarios clínicos — <strong>datos de categoría especial</strong> según el art. 9 RGPD y <strong>要配慮個人情報</strong> según el art. 2(3) APPI. La segunda casilla de consentimiento, opcional, cubre este punto.",
      "lobby.privacy.p3": "Los datos se almacenan en Google Firebase Realtime Database en <strong>europe-west1 (Bélgica, UE)</strong>. Para los participantes japoneses se trata de una transferencia transfronteriza protegida por la decisión de adecuación mutua UE–Japón (PPC, 2019). Los datos de la sesión en vivo se eliminan en un plazo de 7 días; si marcó la casilla de consentimiento para investigación, sus contribuciones se conservan de forma seudonimizada hasta 5 años después de la publicación.",
      "lobby.privacy.p4": "<strong>Iniciar sesión con Google es opcional.</strong> Si lo hace, un pequeño perfil y la lista de códigos de sesión a los que se ha unido quedan vinculados a su cuenta de Google; puede editarlos o eliminarlos en cualquier momento desde el panel «Mi cuenta». La participación anónima funciona exactamente de la misma manera.",
      "lobby.privacy.p5": "Puede retirar su consentimiento en cualquier momento. Marcar o no la segunda casilla <strong>no tiene ningún efecto sobre su calificación, su situación en su universidad ni su participación en el taller.</strong> Para ejercer cualquier derecho (acceso, rectificación, supresión, portabilidad, limitación, oposición, retirada, reclamación), póngase en contacto con su facilitador/a o escriba a <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> (consulte la <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">política de privacidad completa</a> para el buzón estable).",
      "lobby.privacy.p6": "La <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">política de privacidad completa</a> enumera la identidad de los responsables, las bases jurídicas, los elementos de uso conjunto, las salvaguardias para las transferencias internacionales, los plazos de conservación, sus derechos con los tiempos de respuesta y las aprobaciones del comité de ética. Léala una vez antes de unirse.",
      "lobby.join-btn": "Unirse a la sala de espera",

      "waiting.title": "Sala de espera",
      "waiting.you-are": "Usted es",
      "waiting.leave": "Salir",
      "waiting.status-not-started": "Se ha unido. Esperando a que un/a facilitador/a inicie la sesión…",
      "waiting.status-starting": "La sesión ha comenzado — se le está asignando a una sala…",
      // R3-C1
      "waiting.late-join.banner": "Se unió cuando su sala ya estaba en «{stage}». Las etapas anteriores ocurrieron antes de su llegada — use «← Revisar etapa anterior» en cualquier momento para leerlas.  ",
      "waiting.late-join.dismiss": "Entendido",

      "data-rights.export-btn": "Descargar mis datos (JSON) ⤓",

      "stage.label.0": "Bienvenida",
      "stage.label.1": "Módulo A — Dolor crónico",
      "stage.label.2": "Módulo B — Comunicar malas noticias",
      "stage.label.3": "Cierre",

      "stage.welcome.title": "Bienvenido/a a la Sesión 3",
      "stage.welcome.intro": "Tema: Aprender unos de otros — una sesión de intercambio liderada por estudiantes. Todo el día de hoy se desarrolla desde esta plataforma. Avanzan juntos; un/a facilitador/a hace pasar su sala de un bloque al siguiente.",
      "stage.welcome.grade-note": "Su calificación y su situación académica no se ven afectadas por este taller. Los puntos que otorga la plataforma son únicamente para el aprendizaje durante la sesión — no contribuyen a su nota universitaria. Si está en desacuerdo con un punto o una penalización, dígaselo a su facilitador/a; la puntuación es revisable.",

      "room.call-facilitator": "Llamar a un/a facilitador/a",

      "admin.mute-alerts": "Silenciar sonido de llamada + notificación de escritorio",
      "admin.download-error-log": "Descargar registro de errores",
      "admin.theme": "Tema",
      "admin.theme.auto": "Automático (sistema)",
      "admin.theme.light": "Claro",
      "admin.theme.dark": "Oscuro",
      "admin.theme.hc": "Alto contraste",
      "admin.report-bug": "Reportar un error",

      "admin.start-session": "Iniciar sesión — colocar a todos en las salas",
      "admin.advance-all": "Avanzar todas las salas →",
      "admin.download-all": "Descargar todas las respuestas",
      "admin.end-session": "Finalizar sesión y descargar archivo",

      "stage.modB.title": "Módulo B — Comunicar malas noticias: un juego de rol intercultural",

      "stage.wrap.title": "Cierre y próximos pasos",
      "stage.wrap.thanks": "¡Gracias por participar! Antes de irse:",
      "stage.wrap.do-questionnaire": "Complete el cuestionario de fin de sesión — solo toma unos minutos, y hay un breve post-test en 3 semanas.",
      "stage.wrap.answers-saved": "Las respuestas de su grupo están guardadas abajo — sus facilitadores las recopilarán.",
      "stage.wrap.open-questionnaire": "Abrir el cuestionario de fin de sesión",
      "stage.wrap.questionnaire-fallback": "Su facilitador/a compartirá el enlace del cuestionario.",
      "stage.wrap.bye": "Una vez completado el cuestionario puede cerrar esta pestaña. ¡Nos vemos en la Sesión 4!",
      "stage.wrap.room-answers": "Las respuestas de su sala",

      "closed.title": "Sesión cerrada por el/la facilitador/a.",
      "closed.subtitle": "Gracias por participar — el trabajo de su equipo ha sido guardado.",

      "ended.title": "Gracias por participar",
      "ended.message": "Su facilitador/a ha finalizado esta sesión. Las contribuciones de su equipo han sido guardadas.",
      "ended.questionnaire": "Abrir el cuestionario de fin de sesión →",
      "ended.future": "Si participa en un futuro taller CaNaMED, recibirá un nuevo código de sesión.",
      "ended.return": "Volver a CANAMED",

      "debrief.toggle": "Abrir balance",
      "debrief.toggle-close": "Cerrar balance",
      "debrief.title": "Balance de la sesión",
      "debrief.subtitle": "Estadísticas agregadas de todas las salas — útiles para la conversación de cierre.",
      "debrief.empty": "Inicie la sesión para ver aquí las estadísticas agregadas.",
      "debrief.section.ranking": "Clasificación de salas",
      "debrief.section.decisions": "Desglose de decisiones",
      "debrief.section.penalties": "Mapa de calor de penalizaciones",
      "debrief.section.concepts": "Cobertura de conceptos",
      "debrief.section.funnel": "Embudo de participación",
      "debrief.section.time": "Tiempo por etapa",
      "debrief.col.room": "Sala",
      "debrief.col.team": "Equipo",
      "debrief.col.score": "Puntuación",
      "debrief.no-data": "Aún no hay datos.",
      "debrief.no-commit": "Ninguna sala ha confirmado esta decisión todavía.",
      "debrief.rooms-picked": "salas",
      "debrief.correct-option": "(correcto)",
      "debrief.module-a": "Módulo A",
      "debrief.module-b": "Módulo B",
      "debrief.penalty-fired": "activada",
      "debrief.penalty-rooms": "salas afectadas",
      "debrief.concept.rooms-hit": "salas alcanzaron",
      "debrief.funnel.registered": "Se unió al grupo",
      "debrief.funnel.assigned": "Asignado/a a una sala",
      "debrief.funnel.answered": "Respondió ≥1 pregunta",
      "debrief.funnel.voted": "Votó en una decisión",
      "debrief.time.minutes": "min",
      "debrief.time.stage": "Etapa",
      "debrief.points-per-room": "puntos / sala",

      "debrief.student.title": "El balance de su equipo",
      "debrief.student.score": "Su equipo obtuvo",
      "debrief.student.score-suffix": "puntos",
      "debrief.student.decisions-locked": "decisiones confirmadas",
      "debrief.student.agreed": "Decisiones donde su equipo eligió la respuesta más segura",
      "debrief.student.disagreed": "Decisiones a revisar",
      "debrief.student.top-concept": "Concepto que mejor abordó su equipo",
      "debrief.student.missed-concept": "Concepto que su equipo no destacó",
      "debrief.student.engaged": "Momento de mayor involucramiento",
      "debrief.student.engaged-detail": "dedicados a",
      "debrief.student.closing": "Gracias por participar — cada contribución ayuda a que la alianza crezca.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "Las contribuciones de su equipo han sido guardadas.",
      "debrief.student.team-label": "Su equipo",

      "tour.btn.next": "Siguiente",
      "tour.btn.back": "Atrás",
      "tour.btn.skip": "Omitir recorrido",
      "tour.btn.done": "Entendido",
      "tour.btn.close": "Cerrar",
      "tour.progress": "Paso {n} de {total}",
      "tour.reopen": "Volver a ver el recorrido",

      "tour.create.1.title": "Nombre del taller",
      "tour.create.1.body": "Dele a esta sesión un nombre claro (p. ej. «Caen × Nagoya — junio de 2026»). Opcional, pero útil cuando la clone más tarde para la próxima cohorte.",
      "tour.create.2.title": "Elegir el escenario",
      "tour.create.2.body": "Elija el contenido clínico en el que trabajarán sus estudiantes. También puede pegar un escenario personalizado en formato JSON para un uso avanzado.",
      "tour.create.3.title": "Definir una contraseña de sesión",
      "tour.create.3.body": "Solo los facilitadores deben conocerla — la necesitará para volver a abrir el panel más tarde. Elija algo que pueda compartir con sus co-facilitadores el día del taller.",
      "tour.create.4.title": "Crear y compartir",
      "tour.create.4.body": "Al hacer clic en Crear sesión obtendrá un código corto (y un QR) para compartir con los estudiantes. Luego accederá directamente al panel de administración.",

      "tour.admin.1.title": "Sus salas de un vistazo",
      "tour.admin.1.body": "Cada tarjeta aquí es una sala. Verá la etapa actual, quién está en ella, la puntuación del equipo y cualquier llamada al facilitador/a.",
      "tour.admin.2.title": "Avanzar toda la sesión",
      "tour.admin.2.body": "Use «Avanzar todas las salas» para sincronizarlas, o las flechas por sala para llevar una sala a su propio ritmo.",
      "tour.admin.3.title": "Abrir una sala",
      "tour.admin.3.body": "Haga clic en «Abrir sala» para ver exactamente lo que ven los estudiantes, con un panel lateral para cambiar de sala sin perder el contexto.",
      "tour.admin.4.title": "Finalizar y archivar",
      "tour.admin.4.body": "Cuando termine, finalice la sesión y descargue el archivo. Respuestas grupales, votos y puntuaciones se exportan en un único archivo JSON.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "Ajustes",
      "settings.title": "Ajustes",
      "settings.restart-tour": "Ver de nuevo la visita de introducción",
      "settings.close": "Cerrar",
      "tour.student.1.title": "Bienvenido/a a la sala",
      "tour.student.1.body": "Este es el espacio de su equipo durante toda la sesión. Una visita breve a los controles que más usará.",
      "tour.student.2.title": "Nombre del equipo",
      "tour.student.2.body": "Elijan juntos un nombre divertido — cualquiera en la sala puede ponerlo. Aparece en la clasificación en vivo.",
      "tour.student.3.title": "Registro de hallazgos",
      "tour.student.3.body": "Cuando pregunta, examina o pide una prueba, la respuesta del paciente aparece aquí. En móvil también aparece justo debajo del botón.",
      "tour.student.4.title": "Decisiones del equipo",
      "tour.student.4.body": "Cuando aparezca una tarjeta de decisión, cada persona toca su opción. Cuando voten suficientes, bloqueen juntos la respuesta del equipo.",
      "tour.student.5.title": "Respuestas del grupo",
      "tour.student.5.body": "Use este cuadro para añadir puntos breves acordados por el equipo. Todos los ven en vivo.",
      "tour.student.6.title": "Llamar a un facilitador",
      "tour.student.6.body": "Toque aquí cuando necesite ayuda. El facilitador verá su sala marcada en su panel.",
      "tour.student.7.title": "Idioma y ajustes",
      "tour.student.7.body": "Use este desplegable para cambiar de idioma cuando quiera. La rueda dentada abre los ajustes de tema y accesibilidad.",

      "admin.search.placeholder": "Filtrar salas por nombre…",
      "admin.search.clear": "Borrar",
      "admin.search.label": "Filtrar salas",
      "admin.search.empty": "Ninguna sala coincide con este filtro."
    },

    // Brazilian Portuguese — você form, medical register. Machine-drafted,
    // NOT yet reviewed by a native speaker.
    pt: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "Pular para o conteúdo principal",

      "splash.tagline": "Uma plataforma colaborativa para parcerias de educação médica entre universidades.",
      "splash.signed-in-as": "Conectado como",
      "splash.sign-out": "Sair",
      "splash.lang-label": "Idioma",
      "privacy.title": "CaNaMED — Política de privacidade",
      "privacy.subtitle": "Como usamos seus dados e seus direitos",
      "privacy.lang-not-available": "Ainda não está disponível uma tradução completa desta política de privacidade no idioma selecionado. O texto em inglês abaixo é a versão juridicamente vinculante. Também estão disponíveis versões revisadas em <a href=\"privacy.html?lang=fr\">francês</a> e em <a href=\"privacy.html?lang=ja\">japonês</a>.",

      "splash.enter.label": "Digite o código de sessão fornecido pelo(a) seu(sua) facilitador(a)",
      "splash.enter.placeholder": "ex.: ABC-DEF",
      "splash.enter.submit": "Entrar →",
      "splash.enter.no-code": "Ainda não tem um código?",
      "splash.enter.go-create": "Sou facilitador(a) — criar uma sessão →",
      "splash.enter.go-account": "Entrar com Google para salvar meu perfil e histórico →",

      "splash.account.title": "Entrar com Google",
      "splash.account.subtitle": "Usamos o Google para verificar sua identidade — sem precisar lembrar de outra senha. Seus dados são preenchidos automaticamente ao entrar em uma sessão, e o histórico das sessões em que você participou fica salvo no seu perfil.",
      "splash.account.continue-google": "Continuar com Google",
      "splash.account.back": "← Voltar para entrar em uma sessão",

      "splash.profile.title": "Configure seu perfil",
      "splash.profile.subtitle": "Estes dados são preenchidos automaticamente toda vez que você entra em uma sessão. Você pode atualizá-los depois pela sua conta.",
      "splash.profile.name-label": "Seu nome (primeiro nome ou apelido)",
      "splash.profile.name-placeholder": "ex.: Alice / Akari",
      "splash.profile.uni-label": "Universidade",
      "splash.profile.year-label": "Ano do curso",
      "splash.profile.english-label": "Nível de inglês (autoavaliação CEFR)",
      "splash.profile.submit": "Salvar e continuar →",

      "splash.create.title": "Criar uma sessão CaNaMED",
      "splash.create.subtitle": "Você receberá um código curto para compartilhar com seus alunos. Você se torna o(a) facilitador(a) (admin) — guarde a senha definida aqui para controlar a sessão depois.",
      "splash.create.name-label": "Seu nome",
      "splash.create.name-placeholder": "ex.: Dr. Smith",
      "splash.create.workshop-label": "Nome do workshop",
      "splash.create.workshop-optional": "(opcional)",
      "splash.create.workshop-placeholder": "ex.: Caen × Nagoya — junho de 2026",
      "splash.create.content-label": "Conteúdo do workshop",
      "splash.create.password-label": "Defina uma senha de sessão",
      "splash.create.password-placeholder": "algo que só os facilitadores conheçam",
      "splash.create.back": "← Voltar",
      "splash.create.submit": "Criar sessão",
      "splash.create.clone-last": "Clonar último workshop ↻",
      "splash.create.clone-clear": "Limpar",

      "splash.created.title": "Sessão criada",
      "splash.created.subtitle": "Compartilhe este código com seus alunos. Eles digitam o código nesta mesma página para entrar.",
      "splash.created.copy": "Copiar",
      "splash.created.copy-link": "Copiar link",
      "splash.created.qr-caption": "Ou escaneie o QR com um celular",
      "splash.created.create-another": "Criar outra",
      "splash.created.open-admin": "Abrir painel de administração →",

      "lobby.join-title": "Entrar como participante",
      "lobby.join-hint": "Você será colocado(a) automaticamente em uma sala mista {cohortPair} — equilibrada por universidade, ano e nível de inglês.",
      "lobby.uni-label": "Universidade",
      "lobby.uni-placeholder": "Selecione sua universidade…",
      "lobby.year-label": "Ano do curso",
      "lobby.year-postgrad": "Pós-graduação / Residente",
      "lobby.english-label": "Nível de inglês (autoavaliação CEFR)",
      "lobby.english-hint": "Níveis CEFR: A2 elementar · B1 intermediário · B2 intermediário avançado (consegue discutir temas complexos) · C1 avançado · C2 proficiente. Escolha o mais próximo — só é usado para equilibrar as salas.",
      "lobby.name-label": "Seu nome (primeiro nome ou apelido)",
      "lobby.name-placeholder": "ex.: Alice / Akari",
      "lobby.consent-workshop": "Li o aviso de uso de dados acima e consinto em participar deste workshop CaNaMED.",
      "lobby.consent-workshop-detail": "Meu nome, universidade, ano, nível de inglês e os textos que eu digitar durante o workshop serão visíveis para as outras pessoas da minha sala e para os(as) facilitadores(as).",
      "lobby.consent-research": "Consinto adicionalmente que minhas contribuições (respostas em grupo, votos, pontuações) sejam utilizadas para o projeto de pesquisa educacional CaNaMED (análise e publicação em forma pseudonimizada). Entendo que posso participar do workshop sem marcar esta segunda caixa — recusar não tem qualquer efeito sobre minha participação, minhas notas ou minha situação na minha universidade.",
      "lobby.consent-version": "Versão do aviso PIS v1 · 2026-05. ",
      "lobby.consent-version-link": "Política de privacidade completa",
      "lobby.consent-version-suffix": ".",
      "lobby.privacy.summary": "Como seus dados são usados (leia antes de entrar)",
      "lobby.privacy.p1": "A equipe de pesquisa CaNaMED (<strong>Université de Caen Normandie × Universidade de Nagoya</strong>, controladores conjuntos nos termos do art. 26 do RGPD / usuários conjuntos nos termos do art. 27(5) da APPI) coleta seu primeiro nome ou apelido, universidade, ano de estudo e nível de inglês autoavaliado. Seu nome é visível para todas as pessoas da sua sala e aparece ao lado dos pontos que você contribui.",
      "lobby.privacy.p2": "As respostas de texto livre que você escreve podem revelar opiniões relacionadas à saúde, religiosas ou filosóficas sobre cenários clínicos — <strong>dados de categoria especial</strong> nos termos do art. 9 do RGPD e <strong>要配慮個人情報</strong> nos termos do art. 2(3) da APPI. A segunda caixa de consentimento, opcional, abaixo cobre este ponto.",
      "lobby.privacy.p3": "Os dados são armazenados no Google Firebase Realtime Database em <strong>europe-west1 (Bélgica, UE)</strong>. Para os participantes japoneses trata-se de uma transferência transfronteiriça protegida pela decisão de adequação mútua UE–Japão (PPC, 2019). Os dados da sessão ao vivo são apagados em até 7 dias; se você marcou a caixa de consentimento de pesquisa, suas contribuições são mantidas pseudonimizadas por até 5 anos após a publicação.",
      "lobby.privacy.p4": "<strong>Entrar com o Google é opcional.</strong> Se você o fizer, um pequeno perfil e uma lista de códigos de sessão dos quais você participou ficam vinculados à sua conta Google; você pode editar ou excluí-los a qualquer momento pelo painel «Minha conta». A participação anônima funciona exatamente da mesma forma.",
      "lobby.privacy.p5": "Você pode retirar seu consentimiento a qualquer momento. Marcar ou não a segunda caixa <strong>não tem nenhum efeito sobre sua nota, sua situação na sua universidade ou sua participação no workshop.</strong> Para exercer qualquer direito (acesso, retificação, exclusão, portabilidade, limitação, oposição, retirada, reclamação), entre em contato com seu(sua) facilitador(a) ou escreva para <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> (consulte a <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">política de privacidade completa</a> para o endereço estável).",
      "lobby.privacy.p6": "A <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">política de privacidade completa</a> lista a identidade dos controladores, as bases legais, os itens de uso conjunto, as salvaguardas para transferências internacionais, os períodos de retenção, seus direitos com prazos de resposta e as aprovações do comitê de ética. Leia-a uma vez antes de entrar.",
      "lobby.join-btn": "Entrar na sala de espera",

      "waiting.title": "Sala de espera",
      "waiting.you-are": "Você é",
      "waiting.leave": "Sair",
      "waiting.status-not-started": "Você entrou. Aguardando o(a) facilitador(a) iniciar a sessão…",
      "waiting.status-starting": "A sessão começou — você está sendo alocado(a) em uma sala…",
      // R3-C1
      "waiting.late-join.banner": "Você entrou enquanto sua sala já estava em «{stage}». As etapas anteriores ocorreram antes de você chegar — use «← Rever etapa anterior» a qualquer momento para lê-las.  ",
      "waiting.late-join.dismiss": "Entendi",

      "data-rights.export-btn": "Baixar meus dados (JSON) ⤓",

      "stage.label.0": "Boas-vindas",
      "stage.label.1": "Módulo A — Dor crônica",
      "stage.label.2": "Módulo B — Comunicando más notícias",
      "stage.label.3": "Encerramento",

      "stage.welcome.title": "Bem-vindo(a) à Sessão 3",
      "stage.welcome.intro": "Tema: Aprender uns com os outros — uma sessão de intercâmbio conduzida pelos alunos. Tudo o que acontece hoje é executado nesta plataforma. Vocês avançam juntos; um(a) facilitador(a) leva sua sala de um bloco ao próximo.",
      "stage.welcome.grade-note": "Sua nota e sua situação acadêmica não são afetadas por este workshop. Os pontos atribuídos pela plataforma são apenas para o aprendizado durante a sessão — eles não contam para sua nota universitária. Se você discordar de um ponto ou de uma penalidade, fale com o(a) facilitador(a); a pontuação é revisável.",

      "room.call-facilitator": "Chamar um(a) facilitador(a)",

      "admin.mute-alerts": "Silenciar som de chamada + notificação do sistema",
      "admin.download-error-log": "Baixar log de erros",
      "admin.theme": "Tema",
      "admin.theme.auto": "Automático (sistema)",
      "admin.theme.light": "Claro",
      "admin.theme.dark": "Escuro",
      "admin.theme.hc": "Alto contraste",
      "admin.report-bug": "Reportar um bug",

      "admin.start-session": "Iniciar sessão — alocar todos nas salas",
      "admin.advance-all": "Avançar todas as salas →",
      "admin.download-all": "Baixar todas as respostas",
      "admin.end-session": "Encerrar sessão e baixar arquivo",

      "stage.modB.title": "Módulo B — Comunicando más notícias: um roleplay intercultural",

      "stage.wrap.title": "Encerramento e próximos passos",
      "stage.wrap.thanks": "Obrigado por participar! Antes de sair:",
      "stage.wrap.do-questionnaire": "Preencha o questionário de fim de sessão — leva apenas alguns minutos, e há um pós-teste curto daqui a 3 semanas.",
      "stage.wrap.answers-saved": "As respostas do seu grupo estão salvas abaixo — os(as) facilitadores(as) vão coletá-las.",
      "stage.wrap.open-questionnaire": "Abrir o questionário de fim de sessão",
      "stage.wrap.questionnaire-fallback": "Seu(sua) facilitador(a) compartilhará o link do questionário.",
      "stage.wrap.bye": "Quando terminar o questionário, você pode fechar esta aba. Até a Sessão 4!",
      "stage.wrap.room-answers": "As respostas da sua sala",

      "closed.title": "Sessão encerrada pelo(a) facilitador(a).",
      "closed.subtitle": "Obrigado por participar — o trabalho da sua equipe foi salvo.",

      "ended.title": "Obrigado por participar",
      "ended.message": "Seu(sua) facilitador(a) encerrou esta sessão. As contribuições da sua equipe foram salvas.",
      "ended.questionnaire": "Abrir o questionário de fim de sessão →",
      "ended.future": "Se você participar de um futuro workshop CaNaMED, receberá um novo código de sessão.",
      "ended.return": "Voltar ao CANAMED",

      "debrief.toggle": "Abrir balanço",
      "debrief.toggle-close": "Fechar balanço",
      "debrief.title": "Balanço da sessão",
      "debrief.subtitle": "Estatísticas agregadas de todas as salas — úteis para a conversa de encerramento.",
      "debrief.empty": "Inicie a sessão para ver as estatísticas agregadas aqui.",
      "debrief.section.ranking": "Ranking das salas",
      "debrief.section.decisions": "Detalhamento das decisões",
      "debrief.section.penalties": "Mapa de calor de penalidades",
      "debrief.section.concepts": "Cobertura de conceitos",
      "debrief.section.funnel": "Funil de participação",
      "debrief.section.time": "Tempo por etapa",
      "debrief.col.room": "Sala",
      "debrief.col.team": "Equipe",
      "debrief.col.score": "Pontuação",
      "debrief.no-data": "Ainda sem dados.",
      "debrief.no-commit": "Nenhuma sala confirmou esta decisão ainda.",
      "debrief.rooms-picked": "salas",
      "debrief.correct-option": "(correto)",
      "debrief.module-a": "Módulo A",
      "debrief.module-b": "Módulo B",
      "debrief.penalty-fired": "acionada",
      "debrief.penalty-rooms": "salas afetadas",
      "debrief.concept.rooms-hit": "salas atingiram",
      "debrief.funnel.registered": "Entrou no grupo",
      "debrief.funnel.assigned": "Alocado(a) em uma sala",
      "debrief.funnel.answered": "Respondeu ≥1 pergunta",
      "debrief.funnel.voted": "Votou em uma decisão",
      "debrief.time.minutes": "min",
      "debrief.time.stage": "Etapa",
      "debrief.points-per-room": "pontos / sala",

      "debrief.student.title": "O balanço da sua equipe",
      "debrief.student.score": "Sua equipe marcou",
      "debrief.student.score-suffix": "pontos",
      "debrief.student.decisions-locked": "decisões confirmadas",
      "debrief.student.agreed": "Decisões em que sua equipe escolheu a resposta mais segura",
      "debrief.student.disagreed": "Decisões a revisitar",
      "debrief.student.top-concept": "Conceito que sua equipe mais abordou",
      "debrief.student.missed-concept": "Conceito que sua equipe não destacou",
      "debrief.student.engaged": "Momento de maior engajamento",
      "debrief.student.engaged-detail": "dedicados a",
      "debrief.student.closing": "Obrigado por participar — cada contribuição faz a parceria crescer.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "As contribuições da sua equipe foram salvas.",
      "debrief.student.team-label": "Sua equipe",

      "tour.btn.next": "Próximo",
      "tour.btn.back": "Voltar",
      "tour.btn.skip": "Pular tour",
      "tour.btn.done": "Entendi",
      "tour.btn.close": "Fechar",
      "tour.progress": "Passo {n} de {total}",
      "tour.reopen": "Ver o tour novamente",

      "tour.create.1.title": "Nome do workshop",
      "tour.create.1.body": "Dê a esta sessão um nome amigável (ex.: «Caen × Nagoya — junho de 2026»). Opcional, mas útil quando você clonar para a próxima turma.",
      "tour.create.2.title": "Escolher o cenário",
      "tour.create.2.body": "Escolha o conteúdo clínico em que seus alunos vão trabalhar. Você também pode colar um cenário personalizado em JSON para uso avançado.",
      "tour.create.3.title": "Definir uma senha de sessão",
      "tour.create.3.body": "Somente os(as) facilitadores(as) devem conhecê-la — você vai precisar dela para reabrir o painel depois. Escolha algo que possa compartilhar com seus(suas) co-facilitadores(as) no dia.",
      "tour.create.4.title": "Criar e compartilhar",
      "tour.create.4.body": "Ao clicar em Criar sessão, você recebe um código curto (e um QR) para compartilhar com os alunos. Depois você vai direto para o painel de administração.",

      "tour.admin.1.title": "Suas salas em um relance",
      "tour.admin.1.body": "Cada cartão aqui é uma sala. Você vê a etapa atual, quem está nela, a pontuação da equipe e qualquer chamada de facilitador(a).",
      "tour.admin.2.title": "Avançar toda a sessão",
      "tour.admin.2.body": "Use «Avançar todas as salas» para movê-las em sincronia, ou as setas por sala para conduzir uma sala no seu próprio ritmo.",
      "tour.admin.3.title": "Abrir uma sala",
      "tour.admin.3.body": "Clique em «Abrir sala» para ver exatamente o que os alunos veem, com um painel lateral para trocar de sala sem perder o contexto.",
      "tour.admin.4.title": "Encerrar e arquivar",
      "tour.admin.4.body": "Quando terminar, encerre a sessão e baixe o arquivo. Respostas de grupo, votos e pontuações são exportados em um único arquivo JSON.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "Configurações",
      "settings.title": "Configurações",
      "settings.restart-tour": "Ver novamente o tour de introdução",
      "settings.close": "Fechar",
      "tour.student.1.title": "Bem-vindo(a) à sala",
      "tour.student.1.body": "Este é o espaço da sua equipe durante toda a sessão. Um tour rápido pelos controles que você mais vai usar.",
      "tour.student.2.title": "Nome do time",
      "tour.student.2.body": "Escolham juntos um nome divertido — qualquer pessoa na sala pode definir. Aparece na classificação ao vivo.",
      "tour.student.3.title": "Registro de achados",
      "tour.student.3.body": "Quando você pergunta, examina ou pede um exame, a resposta do paciente aparece aqui. No celular também aparece logo abaixo do botão.",
      "tour.student.4.title": "Decisões da equipe",
      "tour.student.4.body": "Quando surgir uma carta de decisão, cada pessoa toca a sua opção. Quando houver votos suficientes, travem juntos a resposta da equipe.",
      "tour.student.5.title": "Respostas do grupo",
      "tour.student.5.body": "Use esta caixa para adicionar pontos curtos que sua equipe combinou. Todos veem em tempo real.",
      "tour.student.6.title": "Chamar um facilitador",
      "tour.student.6.body": "Toque aqui quando precisar de ajuda. O facilitador verá sua sala marcada no painel.",
      "tour.student.7.title": "Idioma e configurações",
      "tour.student.7.body": "Use este menu para trocar o idioma a qualquer momento. A engrenagem abre as configurações de tema e acessibilidade.",

      "admin.search.placeholder": "Filtrar salas pelo nome…",
      "admin.search.clear": "Limpar",
      "admin.search.label": "Filtrar salas",
      "admin.search.empty": "Nenhuma sala corresponde a este filtro."
    },

    // German — Hochdeutsch, formal "Sie" register throughout. The consent
    // paragraphs use DSGVO-aligned terminology ("Einwilligung",
    // "pseudonymisiert"). Machine-drafted; NOT yet reviewed by a native
    // speaker.
    de: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "Zum Hauptinhalt springen",

      "splash.tagline": "Eine kollaborative Plattform für Partnerschaften in der medizinischen Ausbildung zwischen Universitäten.",
      "splash.signed-in-as": "Angemeldet als",
      "splash.sign-out": "Abmelden",
      "splash.lang-label": "Sprache",
      "privacy.title": "CaNaMED — Datenschutzerklärung",
      "privacy.subtitle": "Wie wir Ihre Daten verwenden und Ihre Rechte",
      "privacy.lang-not-available": "Eine vollständige Übersetzung dieser Datenschutzerklärung in die von Ihnen gewählte Sprache ist noch nicht verfügbar. Der nachstehende englische Text ist die rechtlich verbindliche Fassung. Geprüfte Fassungen auf <a href=\"privacy.html?lang=fr\">Französisch</a> und <a href=\"privacy.html?lang=ja\">Japanisch</a> stehen ebenfalls zur Verfügung.",

      "splash.enter.label": "Geben Sie den Sitzungscode ein, den Ihre Lehrperson Ihnen mitgeteilt hat",
      "splash.enter.placeholder": "z. B. ABC-DEF",
      "splash.enter.submit": "Beitreten →",
      "splash.enter.no-code": "Noch keinen Code?",
      "splash.enter.go-create": "Ich bin Lehrperson — eine Sitzung erstellen →",
      "splash.enter.go-account": "Mit Google anmelden, um Profil und Verlauf zu speichern →",

      "splash.account.title": "Mit Google anmelden",
      "splash.account.subtitle": "Wir verwenden Google zur Identitätsprüfung — Sie müssen sich kein zusätzliches Passwort merken. Ihre Angaben werden bei jedem Sitzungsbeitritt automatisch ausgefüllt, und die Sitzungen, an denen Sie teilgenommen haben, werden in Ihrem Profil gespeichert.",
      "splash.account.continue-google": "Mit Google fortfahren",
      "splash.account.back": "← Zurück zum Sitzungsbeitritt",

      "splash.profile.title": "Profil einrichten",
      "splash.profile.subtitle": "Diese Angaben werden bei jedem Sitzungsbeitritt automatisch ausgefüllt. Sie können sie später in Ihrem Konto aktualisieren.",
      "splash.profile.name-label": "Ihr Name (Vorname oder Spitzname)",
      "splash.profile.name-placeholder": "z. B. Alice / Akari",
      "splash.profile.uni-label": "Universität",
      "splash.profile.year-label": "Studienjahr",
      "splash.profile.english-label": "Englischniveau (GER-Selbsteinschätzung)",
      "splash.profile.submit": "Speichern und fortfahren →",

      "splash.create.title": "Eine CaNaMED-Sitzung erstellen",
      "splash.create.subtitle": "Sie erhalten einen kurzen Code zur Weitergabe an Ihre Studierenden. Sie werden zur Lehrperson (Admin) — bewahren Sie das hier festgelegte Passwort auf, um die Sitzung später zu steuern.",
      "splash.create.name-label": "Ihr Name",
      "splash.create.name-placeholder": "z. B. Dr. Smith",
      "splash.create.workshop-label": "Workshop-Bezeichnung",
      "splash.create.workshop-optional": "(optional)",
      "splash.create.workshop-placeholder": "z. B. Caen × Nagoya — Juni 2026",
      "splash.create.content-label": "Workshop-Inhalt",
      "splash.create.password-label": "Sitzungspasswort festlegen",
      "splash.create.password-placeholder": "etwas, das nur die Lehrpersonen kennen",
      "splash.create.back": "← Zurück",
      "splash.create.submit": "Sitzung erstellen",
      "splash.create.clone-last": "Letzten Workshop klonen ↻",
      "splash.create.clone-clear": "Löschen",

      "splash.created.title": "Sitzung erstellt",
      "splash.created.subtitle": "Geben Sie diesen Code an Ihre Studierenden weiter. Sie geben ihn auf derselben Seite ein, um beizutreten.",
      "splash.created.copy": "Kopieren",
      "splash.created.copy-link": "Link kopieren",
      "splash.created.qr-caption": "Oder scannen Sie den QR-Code mit einem Smartphone",
      "splash.created.create-another": "Weitere erstellen",
      "splash.created.open-admin": "Admin-Dashboard öffnen →",

      "lobby.join-title": "Als Teilnehmer/in beitreten",
      // R3-G1 / R3 deep-i18n fix: the original text hardcoded "deutsch-
      // japanisch", which is factually wrong on a Caen-Nagoya deployment.
      // R3 interim fix used a generic "international" wording; the deep
      // fix now interpolates {cohortPair} from the active COHORTS via
      // buildCohortPair(COHORTS, "de") — renders "Frankreich-Japan" for
      // Caen-Nagoya and "Deutschland-Japan" for a future Berlin-Tokyo
      // deployment, with NO change to this i18n entry.
      "lobby.join-hint": "Sie werden automatisch einem gemischten {cohortPair}-Raum zugewiesen — ausgewogen nach Universität, Studienjahr und Englischniveau.",
      "lobby.uni-label": "Universität",
      "lobby.uni-placeholder": "Wählen Sie Ihre Universität…",
      "lobby.year-label": "Studienjahr",
      "lobby.year-postgrad": "Postgraduiert / Assistenzarzt/-ärztin",
      "lobby.english-label": "Englischniveau (GER-Selbsteinschätzung)",
      "lobby.english-hint": "GER-Niveaustufen: A2 elementar · B1 mittelstufe · B2 selbstständig (kann komplexe Themen diskutieren) · C1 fortgeschritten · C2 kompetent. Wählen Sie die nächstliegende — sie dient nur dem Ausgleich der Räume.",
      "lobby.name-label": "Ihr Name (Vorname oder Spitzname)",
      "lobby.name-placeholder": "z. B. Alice / Akari",
      "lobby.consent-workshop": "Ich habe den oben stehenden Hinweis zur Datenverwendung gelesen und willige in die Teilnahme an diesem CaNaMED-Workshop ein.",
      "lobby.consent-workshop-detail": "Mein Name, meine Universität, mein Studienjahr, mein Englischniveau und die Texte, die ich während des Workshops eingebe, sind für die anderen Personen in meinem Raum und für die Lehrpersonen sichtbar.",
      "lobby.consent-research": "Ich willige zusätzlich ein, dass meine Beiträge (Gruppenantworten, Abstimmungen, Punktzahlen) im Rahmen des CaNaMED-Bildungsforschungsprojekts (Auswertung und Veröffentlichung in pseudonymisierter Form) verwendet werden. Mir ist bekannt, dass ich auch ohne Aktivierung dieses zweiten Kästchens am Workshop teilnehmen kann — eine Verweigerung hat keinerlei Auswirkungen auf meine Teilnahme, meine Noten oder meine Stellung an meiner Universität.",
      "lobby.consent-version": "Hinweisversion PIS v1 · 2026-05. ",
      "lobby.consent-version-link": "Vollständige Datenschutzerklärung",
      "lobby.consent-version-suffix": ".",
      "lobby.privacy.summary": "Wie Ihre Daten verwendet werden (bitte vor dem Beitritt lesen)",
      "lobby.privacy.p1": "Das CaNaMED-Forschungsteam (<strong>Université de Caen Normandie × Universität Nagoya</strong>, gemeinsame Verantwortliche nach Art. 26 DSGVO / gemeinsame Nutzer nach Art. 27(5) APPI) erhebt Ihren Vornamen oder Spitznamen, Ihre Universität, Ihr Studienjahr und Ihr selbst eingeschätztes Englischniveau. Ihr Name ist für alle Personen in Ihrem Raum sichtbar und erscheint neben den Punkten, die Sie beitragen.",
      "lobby.privacy.p2": "Die Freitextantworten, die Sie schreiben, können gesundheitsbezogene, religiöse oder philosophische Meinungen zu klinischen Szenarien offenlegen — <strong>besondere Kategorien personenbezogener Daten</strong> nach Art. 9 DSGVO und <strong>要配慮個人情報</strong> nach Art. 2(3) APPI. Das zweite, optionale Einwilligungskästchen unten deckt dies ab.",
      "lobby.privacy.p3": "Die Daten werden in der Google Firebase Realtime Database in <strong>europe-west1 (Belgien, EU)</strong> gespeichert. Für japanische Teilnehmende ist dies eine grenzüberschreitende Übermittlung, die durch den EU–Japan-Angemessenheitsbeschluss (PPC, 2019) geschützt ist. Live-Sitzungsdaten werden innerhalb von 7 Tagen gelöscht; wenn Sie das Forschungseinwilligungskästchen angekreuzt haben, werden Ihre Beiträge bis zu 5 Jahre nach der Veröffentlichung pseudonymisiert aufbewahrt.",
      "lobby.privacy.p4": "<strong>Die Anmeldung mit Google ist optional.</strong> Wenn Sie sie nutzen, werden ein kleines Profil und eine Liste der Sitzungscodes, denen Sie beigetreten sind, mit Ihrem Google-Konto verknüpft; Sie können dies jederzeit im «Mein Konto»-Panel bearbeiten oder löschen. Die anonyme Teilnahme funktioniert genau gleich.",
      "lobby.privacy.p5": "Sie können Ihre Einwilligung jederzeit widerrufen. Ob Sie das zweite Einwilligungskästchen ankreuzen, hat <strong>keinerlei Auswirkungen auf Ihre Note, Ihre Stellung an Ihrer Universität oder Ihre Teilnahme am Workshop.</strong> Um eines Ihrer Rechte auszuüben (Auskunft, Berichtigung, Löschung, Datenübertragbarkeit, Einschränkung, Widerspruch, Widerruf, Beschwerde), wenden Sie sich an Ihre Lehrperson oder schreiben Sie an <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong> (siehe die <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">vollständige Datenschutzerklärung</a> für das stabile Postfach).",
      "lobby.privacy.p6": "Die <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">vollständige Datenschutzerklärung</a> nennt die Identität der Verantwortlichen, die Rechtsgrundlagen, die gemeinsam genutzten Datenpunkte, die Schutzmaßnahmen für internationale Übermittlungen, die Aufbewahrungsfristen, Ihre Rechte mit Reaktionszeiten und die Genehmigungen der Ethikkommissionen. Bitte lesen Sie sie einmal vor dem Beitritt.",
      "lobby.join-btn": "Dem Warteraum beitreten",

      "waiting.title": "Warteraum",
      "waiting.you-are": "Sie sind",
      "waiting.leave": "Verlassen",
      "waiting.status-not-started": "Sie sind beigetreten. Es wird gewartet, bis eine Lehrperson die Sitzung startet…",
      "waiting.status-starting": "Die Sitzung hat begonnen — Sie werden einem Raum zugewiesen…",
      // R3-C1
      "waiting.late-join.banner": "Sie sind beigetreten, während Ihr Raum bereits bei „{stage}\" ist. Frühere Phasen fanden vor Ihrer Ankunft statt — verwenden Sie jederzeit „← Vorherige Phase ansehen\", um sie zu lesen.  ",
      "waiting.late-join.dismiss": "Verstanden",

      "data-rights.export-btn": "Meine Daten herunterladen (JSON) ⤓",

      "stage.label.0": "Willkommen",
      "stage.label.1": "Modul A — Chronische Schmerzen",
      "stage.label.2": "Modul B — Schlechte Nachrichten überbringen",
      "stage.label.3": "Abschluss",

      "stage.welcome.title": "Willkommen zur Sitzung 3",
      "stage.welcome.intro": "Thema: Voneinander lernen — eine von Studierenden geleitete Austauschsitzung. Der gesamte heutige Ablauf läuft über diese Plattform. Sie arbeiten gemeinsam; eine Lehrperson schaltet Ihren Raum von einem Block zum nächsten.",
      "stage.welcome.grade-note": "Ihre Note und Ihre Stellung werden durch diesen Workshop nicht beeinflusst. Die von der Plattform vergebenen Punkte dienen ausschließlich dem Lernen während der Sitzung — sie fließen nicht in Ihre Universitätsnote ein. Falls Sie mit einem Punkt oder einer Abwertung nicht einverstanden sind, sprechen Sie Ihre Lehrperson an; die Bewertung ist überprüfbar.",

      "room.call-facilitator": "Lehrperson rufen",

      "admin.mute-alerts": "Rufton + Desktop-Benachrichtigung stummschalten",
      "admin.download-error-log": "Fehlerprotokoll herunterladen",
      "admin.theme": "Thema",
      "admin.theme.auto": "Automatisch (System)",
      "admin.theme.light": "Hell",
      "admin.theme.dark": "Dunkel",
      "admin.theme.hc": "Hoher Kontrast",
      "admin.report-bug": "Fehler melden",

      // R3-G3: was "alle Räumen" (nom/acc plural mixed with dative plural —
      // ungrammatical Hochdeutsch). Accusative "alle Räume zuweisen" is the
      // correct form when the rooms are the direct object being assigned.
      "admin.start-session": "Sitzung starten — alle Räume zuweisen",
      "admin.advance-all": "Alle Räume weiterschalten →",
      "admin.download-all": "Alle Gruppenantworten herunterladen",
      "admin.end-session": "Sitzung beenden & Archiv herunterladen",

      "stage.modB.title": "Modul B — Schlechte Nachrichten überbringen: ein interkulturelles Rollenspiel",

      "stage.wrap.title": "Abschluss & nächste Schritte",
      "stage.wrap.thanks": "Danke für Ihre Teilnahme! Vor dem Verlassen:",
      "stage.wrap.do-questionnaire": "Füllen Sie den Abschlussfragebogen aus — er dauert nur wenige Minuten, und in 3 Wochen folgt ein kurzer Nachtest.",
      "stage.wrap.answers-saved": "Die Antworten Ihrer Gruppe sind unten gespeichert — Ihre Lehrpersonen werden sie einsammeln.",
      "stage.wrap.open-questionnaire": "Abschlussfragebogen öffnen",
      "stage.wrap.questionnaire-fallback": "Ihre Lehrperson wird den Link zum Fragebogen teilen.",
      "stage.wrap.bye": "Nach dem Ausfüllen des Fragebogens können Sie diesen Tab schließen. Bis zur Sitzung 4!",
      "stage.wrap.room-answers": "Antworten Ihres Raums",

      "closed.title": "Sitzung von der Lehrperson beendet.",
      "closed.subtitle": "Danke für Ihre Teilnahme — die Arbeit Ihres Teams wurde gespeichert.",

      "ended.title": "Danke für Ihre Teilnahme",
      "ended.message": "Ihre Lehrperson hat diese Sitzung beendet. Die Beiträge Ihres Teams wurden gespeichert.",
      "ended.questionnaire": "Abschlussfragebogen öffnen →",
      "ended.future": "Wenn Sie an einem künftigen CaNaMED-Workshop teilnehmen, erhalten Sie einen neuen Sitzungscode.",
      "ended.return": "Zurück zu CANAMED",

      "debrief.toggle": "Debrief öffnen",
      "debrief.toggle-close": "Debrief schließen",
      "debrief.title": "Sitzungs-Debrief",
      "debrief.subtitle": "Aggregierte Statistiken über alle Räume hinweg — nützlich für das Abschlussgespräch.",
      "debrief.empty": "Starten Sie die Sitzung, um hier aggregierte Statistiken zu sehen.",
      "debrief.section.ranking": "Raum-Rangliste",
      "debrief.section.decisions": "Entscheidungsaufschlüsselung",
      "debrief.section.penalties": "Heatmap der Abwertungen",
      "debrief.section.concepts": "Konzept-Abdeckung",
      "debrief.section.funnel": "Teilnahme-Funnel",
      "debrief.section.time": "Zeit pro Etappe",
      "debrief.col.room": "Raum",
      "debrief.col.team": "Team",
      "debrief.col.score": "Punkte",
      "debrief.no-data": "Noch keine Daten.",
      "debrief.no-commit": "Noch kein Raum hat diese Entscheidung bestätigt.",
      "debrief.rooms-picked": "Räume",
      "debrief.correct-option": "(richtig)",
      "debrief.module-a": "Modul A",
      "debrief.module-b": "Modul B",
      "debrief.penalty-fired": "ausgelöst",
      "debrief.penalty-rooms": "betroffene Räume",
      "debrief.concept.rooms-hit": "Räume erreicht",
      "debrief.funnel.registered": "Pool beigetreten",
      "debrief.funnel.assigned": "Einem Raum zugewiesen",
      "debrief.funnel.answered": "≥1 Frage beantwortet",
      "debrief.funnel.voted": "Über eine Entscheidung abgestimmt",
      "debrief.time.minutes": "Min.",
      "debrief.time.stage": "Etappe",
      "debrief.points-per-room": "Punkte / Raum",

      "debrief.student.title": "Das Debrief Ihres Teams",
      "debrief.student.score": "Ihr Team hat erzielt:",
      "debrief.student.score-suffix": "Punkte",
      "debrief.student.decisions-locked": "Entscheidungen bestätigt",
      "debrief.student.agreed": "Entscheidungen, bei denen Ihr Team die sicherste Antwort gewählt hat",
      "debrief.student.disagreed": "Entscheidungen, die noch einmal betrachtet werden sollten",
      "debrief.student.top-concept": "Bestes von Ihrem Team behandeltes Konzept",
      "debrief.student.missed-concept": "Konzept, das Ihr Team nicht hervorgehoben hat",
      "debrief.student.engaged": "Engagiertester Moment",
      "debrief.student.engaged-detail": "verbracht mit",
      "debrief.student.closing": "Danke für Ihre Teilnahme — jeder Beitrag stärkt die Partnerschaft.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "Die Beiträge Ihres Teams wurden gespeichert.",
      "debrief.student.team-label": "Ihr Team",

      "tour.btn.next": "Weiter",
      "tour.btn.back": "Zurück",
      "tour.btn.skip": "Tour überspringen",
      "tour.btn.done": "Verstanden",
      "tour.btn.close": "Schließen",
      "tour.progress": "Schritt {n} von {total}",
      "tour.reopen": "Tour erneut anzeigen",

      "tour.create.1.title": "Workshop-Bezeichnung",
      "tour.create.1.body": "Geben Sie dieser Sitzung einen aussagekräftigen Namen (z. B. „Caen × Nagoya — Juni 2026“). Optional, aber später beim Klonen für die nächste Kohorte hilfreich.",
      "tour.create.2.title": "Szenario wählen",
      "tour.create.2.body": "Wählen Sie den klinischen Inhalt, mit dem Ihre Studierenden arbeiten. Für fortgeschrittene Anwendungen können Sie auch ein eigenes Szenario als JSON einfügen.",
      "tour.create.3.title": "Sitzungspasswort festlegen",
      "tour.create.3.body": "Nur die Lehrpersonen sollten es kennen — Sie benötigen es, um das Dashboard später erneut zu öffnen. Wählen Sie etwas, das Sie mit Ihren Co-Lehrpersonen am Tag teilen können.",
      "tour.create.4.title": "Erstellen und teilen",
      "tour.create.4.body": "Wenn Sie auf Sitzung erstellen klicken, erhalten Sie einen kurzen Code (und einen QR), um ihn mit den Studierenden zu teilen. Anschließend gelangen Sie direkt ins Admin-Dashboard.",

      "tour.admin.1.title": "Ihre Räume auf einen Blick",
      "tour.admin.1.body": "Jede Karte hier entspricht einem Raum. Sie sehen die aktuelle Etappe, wer darin ist, die Team-Punktzahl und etwaige Hilferufe an die Lehrperson.",
      "tour.admin.2.title": "Die gesamte Sitzung weiterschalten",
      "tour.admin.2.body": "Nutzen Sie „Alle Räume weiterschalten“, um sie synchron zu bewegen, oder die Pfeile pro Raum, um einen einzelnen Raum eigenständig zu führen.",
      "tour.admin.3.title": "Einen Raum öffnen",
      "tour.admin.3.body": "Klicken Sie auf „Raum öffnen“, um genau das zu sehen, was die Studierenden sehen — mit einem Seitenbereich, um zwischen Räumen zu wechseln, ohne den Kontext zu verlieren.",
      "tour.admin.4.title": "Beenden und archivieren",
      "tour.admin.4.body": "Wenn Sie fertig sind, beenden Sie die Sitzung und laden Sie das Archiv herunter. Gruppenantworten, Abstimmungen und Punkte werden als eine einzelne JSON-Datei exportiert.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "Einstellungen",
      "settings.title": "Einstellungen",
      "settings.restart-tour": "Einführungstour erneut anzeigen",
      "settings.close": "Schließen",
      "tour.student.1.title": "Willkommen im Raum",
      "tour.student.1.body": "Das ist der Raum Ihres Teams für die gesamte Sitzung. Eine kurze Tour zu den Bedienelementen, die Sie am häufigsten brauchen.",
      "tour.student.2.title": "Teamname",
      "tour.student.2.body": "Wählen Sie gemeinsam einen Teamnamen — jede Person im Raum kann ihn setzen. Er erscheint in der Live-Rangliste.",
      "tour.student.3.title": "Befund-Log",
      "tour.student.3.body": "Wenn Sie fragen, untersuchen oder einen Test anfordern, erscheint die Antwort der Patientin / des Patienten hier. Auf dem Handy zusätzlich direkt unter der Schaltfläche.",
      "tour.student.4.title": "Team-Entscheidungen",
      "tour.student.4.body": "Wenn eine Entscheidungskarte erscheint, tippt jede Person ihre Wahl. Sobald genug abgestimmt haben, legen Sie die Team-Antwort gemeinsam fest.",
      "tour.student.5.title": "Gruppenantworten",
      "tour.student.5.body": "Hier fügen Sie kurze, von Ihrem Team vereinbarte Punkte ein. Alle sehen sie live.",
      "tour.student.6.title": "Lehrperson rufen",
      "tour.student.6.body": "Tippen Sie hier, wenn Sie Hilfe brauchen. Die Lehrperson sieht Ihren Raum auf dem Dashboard markiert.",
      "tour.student.7.title": "Sprache und Einstellungen",
      "tour.student.7.body": "Mit diesem Auswahlmenü wechseln Sie jederzeit die Sprache. Das Zahnrad daneben öffnet Theme- und Barrierefreiheits-Einstellungen.",

      "admin.search.placeholder": "Räume nach Namen filtern…",
      "admin.search.clear": "Löschen",
      "admin.search.label": "Räume filtern",
      "admin.search.empty": "Kein Raum entspricht diesem Filter."
    },

    // Korean — polite -습니다 form for student-facing copy, terser
    // sentence-final endings for admin dashboard chrome. Machine-drafted;
    // NOT yet reviewed by a native speaker.
    ko: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "본문으로 건너뛰기",

      "splash.tagline": "대학 간 의학 교육 파트너십을 위한 협업 플랫폼입니다.",
      "splash.signed-in-as": "로그인:",
      "splash.sign-out": "로그아웃",
      "splash.lang-label": "언어",
      "privacy.title": "CaNaMED — 개인정보 처리방침",
      "privacy.subtitle": "당사가 귀하의 데이터를 사용하는 방식과 귀하의 권리",
      "privacy.lang-not-available": "선택하신 언어로 된 개인정보 처리방침 전문 번역본은 아직 제공되지 않습니다. 아래의 영문이 법적 효력을 가지는 정식 버전입니다. 검토 완료된 <a href=\"privacy.html?lang=fr\">프랑스어</a> 및 <a href=\"privacy.html?lang=ja\">일본어</a> 버전도 제공됩니다.",

      "splash.enter.label": "진행자가 알려준 세션 코드를 입력하세요",
      "splash.enter.placeholder": "예: ABC-DEF",
      "splash.enter.submit": "입장 →",
      "splash.enter.no-code": "아직 코드가 없으신가요?",
      "splash.enter.go-create": "저는 진행자입니다 — 세션 만들기 →",
      "splash.enter.go-account": "Google로 로그인하여 프로필과 기록 저장하기 →",

      "splash.account.title": "Google로 로그인",
      "splash.account.subtitle": "본인 확인을 위해 Google을 사용하므로 별도의 비밀번호를 기억하실 필요가 없습니다. 세션에 참여할 때 정보가 자동으로 입력되며, 참여하신 세션 기록은 프로필에 보관됩니다.",
      "splash.account.continue-google": "Google로 계속하기",
      "splash.account.back": "← 세션 참여로 돌아가기",

      "splash.profile.title": "프로필 설정",
      "splash.profile.subtitle": "여기에 입력하신 정보는 세션에 참여하실 때마다 자동으로 입력됩니다. 나중에 계정에서 변경하실 수 있습니다.",
      "splash.profile.name-label": "이름 (이름 또는 닉네임)",
      "splash.profile.name-placeholder": "예: Alice / 아카리",
      "splash.profile.uni-label": "대학",
      "splash.profile.year-label": "학년",
      "splash.profile.english-label": "영어 수준 (CEFR 자기 평가)",
      "splash.profile.submit": "저장하고 계속하기 →",

      "splash.create.title": "CaNaMED 세션 만들기",
      "splash.create.subtitle": "학생들과 공유할 짧은 코드가 발급됩니다. 세션을 만든 분이 진행자(관리자)가 되며, 이후 세션을 관리하기 위해 여기서 설정하신 비밀번호가 필요합니다.",
      "splash.create.name-label": "이름",
      "splash.create.name-placeholder": "예: Dr Smith",
      "splash.create.workshop-label": "워크숍 이름",
      "splash.create.workshop-optional": "(선택)",
      "splash.create.workshop-placeholder": "예: Caen × Nagoya — 2026년 6월",
      "splash.create.content-label": "워크숍 콘텐츠",
      "splash.create.password-label": "세션 비밀번호 설정",
      "splash.create.password-placeholder": "진행자만 아는 비밀번호",
      "splash.create.back": "← 뒤로",
      "splash.create.submit": "세션 만들기",
      "splash.create.clone-last": "이전 워크숍 복제 ↻",
      "splash.create.clone-clear": "지우기",

      "splash.created.title": "세션이 생성되었습니다",
      "splash.created.subtitle": "이 코드를 학생들과 공유하세요. 학생들은 같은 페이지에서 이 코드를 입력하여 참여합니다.",
      "splash.created.copy": "복사",
      "splash.created.copy-link": "링크 복사",
      "splash.created.qr-caption": "또는 스마트폰으로 QR 코드를 스캔하세요",
      "splash.created.create-another": "다른 세션 만들기",
      "splash.created.open-admin": "관리 대시보드 열기 →",

      "lobby.join-title": "참가자로 참여하기",
      "lobby.join-hint": "대학, 학년, 영어 수준에 따라 균형 잡힌 {cohortPair} 혼성 룸에 자동으로 배정됩니다.",
      "lobby.uni-label": "대학",
      "lobby.uni-placeholder": "대학을 선택하세요…",
      "lobby.year-label": "학년",
      "lobby.year-postgrad": "대학원생 / 전공의",
      "lobby.english-label": "영어 수준 (CEFR 자기 평가)",
      "lobby.english-hint": "CEFR 수준: A2 초급 · B1 중급 · B2 중상급 (복잡한 주제 토론 가능) · C1 상급 · C2 능숙. 가장 가까운 수준을 선택하세요 — 룸 균형 조정에만 사용됩니다.",
      "lobby.name-label": "이름 (이름 또는 닉네임)",
      "lobby.name-placeholder": "예: Alice / 아카리",
      "lobby.consent-workshop": "위의 데이터 이용 안내를 읽었으며, 본 CaNaMED 워크숍에 참여하는 데 동의합니다.",
      "lobby.consent-workshop-detail": "본인의 이름, 대학, 학년, 영어 수준과 워크숍 중 입력하는 텍스트는 같은 방의 다른 참가자와 진행자에게 표시됩니다.",
      "lobby.consent-research": "추가로, 본인의 기여 내용(그룹 답변, 투표, 점수)이 CaNaMED 교육 연구 프로젝트에서 가명화된 형태로 분석 및 공표되는 데 동의합니다. 이 두 번째 항목에 체크하지 않아도 워크숍에 참여할 수 있으며, 동의하지 않더라도 본인의 참여, 성적, 또는 소속 대학에서의 지위에 어떠한 영향도 미치지 않음을 이해합니다.",
      "lobby.consent-version": "안내문 버전 PIS v1 · 2026-05. ",
      "lobby.consent-version-link": "개인정보 처리방침 전문",
      "lobby.consent-version-suffix": ".",
      "lobby.privacy.summary": "데이터 사용 방법 (참여 전에 읽어 주세요)",
      "lobby.privacy.p1": "CaNaMED 연구팀(<strong>Université de Caen Normandie × 나고야 대학</strong>, GDPR 제26조에 따른 공동관리자 / APPI 제27조(5)에 따른 공동이용자)은 여러분의 이름 또는 닉네임, 대학, 학년, 자가 평가한 영어 수준을 수집합니다. 이름은 같은 방의 모든 참가자에게 표시되며 여러분이 기여한 점수 옆에 함께 나타납니다.",
      "lobby.privacy.p2": "자유 기술로 작성하는 답변에는 임상 시나리오에 관한 건강·종교·사상적 견해가 포함될 수 있으며, 이는 GDPR 제9조상의 <strong>특별 카테고리 데이터</strong> 및 APPI 제2조(3)상의 <strong>要配慮個人情報</strong>에 해당합니다. 아래의 두 번째 선택형 동의 항목이 이 부분을 다룹니다.",
      "lobby.privacy.p3": "데이터는 Google Firebase Realtime Database의 <strong>europe-west1(벨기에, EU)</strong>에 저장됩니다. 일본 참가자의 경우 이는 EU–일본 상호 적정성 결정(PPC, 2019)에 의해 보호되는 국경 간 이전입니다. 라이브 세션 데이터는 7일 이내에 삭제되며, 연구 동의 항목에 체크하신 경우 기여 내용은 발표 후 최대 5년 동안 가명화된 형태로 보관됩니다.",
      "lobby.privacy.p4": "<strong>Google 로그인은 선택 사항입니다.</strong> 로그인하시면 간단한 프로필과 참여하신 세션 코드 목록이 Google 계정에 연결되며, 「내 계정」 패널에서 언제든지 수정하거나 삭제할 수 있습니다. 익명 참여도 동일하게 동작합니다.",
      "lobby.privacy.p5": "언제든지 동의를 철회하실 수 있습니다. 두 번째 동의 항목에 체크하시는지 여부는 <strong>성적, 소속 대학에서의 지위, 워크숍 참여에 어떠한 영향도 미치지 않습니다.</strong> 권리(열람, 정정, 삭제, 이동, 제한, 거부, 철회, 이의 제기) 행사는 진행자에게 연락하시거나 <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong>로 이메일을 보내 주세요(안정적인 연락처는 <a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">개인정보 처리방침 전문</a>을 참고하세요).",
      "lobby.privacy.p6": "<a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">개인정보 처리방침 전문</a>에는 관리자 신원, 법적 근거, 공동이용 항목, 국제 이전 보호 조치, 보관 기간, 응답 기한이 포함된 권리 안내, 윤리 위원회 승인 내용이 기재되어 있습니다. 참여 전에 한 번 읽어 주세요.",
      "lobby.join-btn": "대기실로 입장",

      "waiting.title": "대기실",
      "waiting.you-are": "참가자:",
      "waiting.leave": "나가기",
      "waiting.status-not-started": "참여가 완료되었습니다. 진행자가 세션을 시작할 때까지 기다려 주세요…",
      "waiting.status-starting": "세션이 시작되었습니다 — 룸 배정 중입니다…",
      // R3-C1
      "waiting.late-join.banner": "참가하셨을 때 룸은 이미 「{stage}」 단계에 있습니다. 이전 단계는 도착 전에 진행되었습니다 — 언제든지 「← 이전 단계 보기」 버튼으로 확인할 수 있습니다.  ",
      "waiting.late-join.dismiss": "확인",

      "data-rights.export-btn": "내 데이터 다운로드 (JSON) ⤓",

      "stage.label.0": "환영합니다",
      "stage.label.1": "모듈 A — 만성 통증",
      "stage.label.2": "모듈 B — 나쁜 소식 전하기",
      "stage.label.3": "마무리",

      "stage.welcome.title": "세션 3에 오신 것을 환영합니다",
      "stage.welcome.intro": "주제: 서로에게서 배우기 — 학생 주도형 교류 세션입니다. 오늘의 모든 진행은 이 플랫폼에서 이루어집니다. 함께 진행하시고, 진행자가 룸을 다음 블록으로 넘겨드립니다.",
      "stage.welcome.grade-note": "이 워크숍은 여러분의 성적이나 학내 지위에 어떠한 영향도 주지 않습니다. 플랫폼에서 부여되는 점수는 세션 중 학습용일 뿐 대학 성적에 반영되지 않습니다. 점수나 감점에 동의하지 않으실 경우 진행자에게 알려주세요. 점수는 재검토 대상입니다.",

      "room.call-facilitator": "진행자 호출",

      "admin.mute-alerts": "호출음 + 데스크톱 알림 음소거",
      "admin.download-error-log": "오류 로그 다운로드",
      "admin.theme": "테마",
      "admin.theme.auto": "자동(시스템)",
      "admin.theme.light": "라이트",
      "admin.theme.dark": "다크",
      "admin.theme.hc": "고대비",
      "admin.report-bug": "버그 신고",

      "admin.start-session": "세션 시작 — 모두를 룸에 배정",
      "admin.advance-all": "모든 룸 다음 단계로 →",
      "admin.download-all": "모든 그룹 답변 다운로드",
      "admin.end-session": "세션 종료 및 아카이브 다운로드",

      "stage.modB.title": "모듈 B — 나쁜 소식 전하기: 다문화 롤플레이",

      "stage.wrap.title": "마무리 및 다음 단계",
      "stage.wrap.thanks": "참여해 주셔서 감사합니다! 떠나시기 전에:",
      "stage.wrap.do-questionnaire": "세션 종료 설문지를 작성해 주세요 — 몇 분이면 완료되며, 3주 후에 짧은 사후 테스트가 있습니다.",
      "stage.wrap.answers-saved": "그룹의 답변은 아래에 저장되어 있습니다 — 진행자가 수집할 예정입니다.",
      "stage.wrap.open-questionnaire": "세션 종료 설문지 열기",
      "stage.wrap.questionnaire-fallback": "진행자가 설문지 링크를 공유해 드립니다.",
      "stage.wrap.bye": "설문지를 마치시면 이 탭을 닫으셔도 됩니다. 세션 4에서 뵙겠습니다!",
      "stage.wrap.room-answers": "룸의 답변",

      "closed.title": "진행자가 세션을 종료했습니다.",
      "closed.subtitle": "참여해 주셔서 감사합니다 — 팀의 작업은 저장되었습니다.",

      "ended.title": "참여해 주셔서 감사합니다",
      "ended.message": "진행자가 이 세션을 종료했습니다. 팀의 기여 내용은 저장되었습니다.",
      "ended.questionnaire": "세션 종료 설문지 열기 →",
      "ended.future": "추후 CaNaMED 워크숍에 참여하시면 새로운 세션 코드가 발급됩니다.",
      "ended.return": "CANAMED로 돌아가기",

      "debrief.toggle": "디브리프 열기",
      "debrief.toggle-close": "디브리프 닫기",
      "debrief.title": "세션 디브리프",
      "debrief.subtitle": "모든 룸 전체에 걸친 집계 통계 — 마무리 토론에 유용합니다.",
      "debrief.empty": "세션을 시작하면 여기에 집계 통계가 표시됩니다.",
      "debrief.section.ranking": "룸 랭킹",
      "debrief.section.decisions": "의사결정 내역",
      "debrief.section.penalties": "감점 히트맵",
      "debrief.section.concepts": "개념 커버리지",
      "debrief.section.funnel": "참여 퍼널",
      "debrief.section.time": "단계별 소요 시간",
      "debrief.col.room": "룸",
      "debrief.col.team": "팀",
      "debrief.col.score": "점수",
      "debrief.no-data": "아직 데이터가 없습니다.",
      "debrief.no-commit": "아직 이 결정을 확정한 룸이 없습니다.",
      "debrief.rooms-picked": "룸",
      "debrief.correct-option": "(정답)",
      "debrief.module-a": "모듈 A",
      "debrief.module-b": "모듈 B",
      "debrief.penalty-fired": "발동",
      "debrief.penalty-rooms": "영향을 받은 룸",
      "debrief.concept.rooms-hit": "룸이 도달",
      "debrief.funnel.registered": "풀에 참여",
      "debrief.funnel.assigned": "룸에 배정",
      "debrief.funnel.answered": "1개 이상 응답",
      "debrief.funnel.voted": "의사결정에 투표",
      "debrief.time.minutes": "분",
      "debrief.time.stage": "단계",
      "debrief.points-per-room": "점 / 룸",

      "debrief.student.title": "우리 팀의 디브리프",
      "debrief.student.score": "우리 팀의 점수:",
      "debrief.student.score-suffix": "점",
      "debrief.student.decisions-locked": "건의 결정을 확정",
      "debrief.student.agreed": "우리 팀이 가장 안전한 답을 선택한 결정",
      "debrief.student.disagreed": "다시 살펴볼 결정",
      "debrief.student.top-concept": "우리 팀이 가장 잘 다룬 개념",
      "debrief.student.missed-concept": "우리 팀이 충분히 다루지 못한 개념",
      "debrief.student.engaged": "가장 몰입한 순간",
      "debrief.student.engaged-detail": "동안:",
      "debrief.student.closing": "참여해 주셔서 감사합니다 — 한 분 한 분의 기여가 파트너십을 키워갑니다.",
      "debrief.student.none": "—",
      "debrief.student.no-team": "우리 팀의 기여 내용은 저장되었습니다.",
      "debrief.student.team-label": "우리 팀",

      "tour.btn.next": "다음",
      "tour.btn.back": "이전",
      "tour.btn.skip": "투어 건너뛰기",
      "tour.btn.done": "완료",
      "tour.btn.close": "닫기",
      "tour.progress": "{n} / {total} 단계",
      "tour.reopen": "투어 다시 보기",

      "tour.create.1.title": "워크숍 이름",
      "tour.create.1.body": "이 세션에 알아보기 쉬운 이름을 붙여 주세요(예: 「Caen × Nagoya — 2026년 6월」). 선택 사항이지만 다음 기수를 위해 복제할 때 유용합니다.",
      "tour.create.2.title": "시나리오 선택",
      "tour.create.2.body": "학생들이 다룰 임상 콘텐츠를 선택하세요. 고급 사용을 위해 JSON 형식의 사용자 정의 시나리오를 붙여넣을 수도 있습니다.",
      "tour.create.3.title": "세션 비밀번호 설정",
      "tour.create.3.body": "진행자만 알아야 합니다 — 이후 대시보드를 다시 열 때 필요합니다. 당일 공동 진행자와 공유할 수 있는 문자열로 정해 주세요.",
      "tour.create.4.title": "생성 및 공유",
      "tour.create.4.body": "「세션 만들기」를 클릭하면 학생들과 공유할 짧은 코드(및 QR)가 발급됩니다. 이후 관리 대시보드로 바로 이동합니다.",

      "tour.admin.1.title": "한눈에 보는 룸",
      "tour.admin.1.body": "여기 각 카드가 하나의 룸입니다. 현재 단계, 참가자, 팀 점수, 진행자 호출 여부를 확인할 수 있습니다.",
      "tour.admin.2.title": "세션 전체 진행",
      "tour.admin.2.body": "「모든 룸 다음 단계로」를 사용하면 모든 룸을 동기화하여 진행할 수 있고, 룸별 화살표로 개별 룸의 속도를 조절할 수도 있습니다.",
      "tour.admin.3.title": "룸 열기",
      "tour.admin.3.body": "「룸 열기」를 클릭하면 학생과 동일한 화면을 보실 수 있으며, 사이드 패널을 통해 컨텍스트를 잃지 않고 룸을 전환할 수 있습니다.",
      "tour.admin.4.title": "종료 및 아카이브",
      "tour.admin.4.body": "마치실 때 세션을 종료하고 아카이브를 다운로드하세요. 그룹 답변, 투표, 점수가 하나의 JSON 파일로 내보내집니다.",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "설정",
      "settings.title": "설정",
      "settings.restart-tour": "안내 투어 다시 보기",
      "settings.close": "닫기",
      "tour.student.1.title": "방에 오신 것을 환영합니다",
      "tour.student.1.body": "이 공간은 세션 동안 팀 전용입니다. 가장 자주 사용하는 컨트롤을 짧게 안내합니다.",
      "tour.student.2.title": "팀 이름",
      "tour.student.2.body": "함께 재미있는 팀 이름을 정하세요. 방의 누구나 설정할 수 있고 실시간 리더보드에 표시됩니다.",
      "tour.student.3.title": "소견 로그",
      "tour.student.3.body": "질문, 진찰, 검사를 요청하면 환자의 응답이 여기에 표시됩니다. 모바일에서는 누른 버튼 바로 아래에도 표시됩니다.",
      "tour.student.4.title": "팀 의사결정",
      "tour.student.4.body": "결정 카드가 나타나면 각자 선택지를 누릅니다. 충분한 인원이 투표하면 팀의 답을 함께 확정하세요.",
      "tour.student.5.title": "그룹 답변",
      "tour.student.5.body": "팀이 합의한 짧은 항목을 여기에 적습니다. 모두에게 실시간으로 보입니다.",
      "tour.student.6.title": "퍼실리테이터 호출",
      "tour.student.6.body": "도움이 필요할 때 언제든 누르세요. 퍼실리테이터의 대시보드에 방이 표시됩니다.",
      "tour.student.7.title": "언어 및 설정",
      "tour.student.7.body": "이 드롭다운으로 언제든 언어를 바꿀 수 있습니다. 옆의 톱니바퀴는 테마와 접근성 설정을 엽니다.",

      "admin.search.placeholder": "룸 이름으로 필터…",
      "admin.search.clear": "지우기",
      "admin.search.label": "룸 필터",
      "admin.search.empty": "이 필터에 일치하는 룸이 없습니다."
    },

    // Simplified Mandarin Chinese — mainland conventions, polite but
    // unornate register. Medical terms in standard mainland Chinese
    // (慢性疼痛, 阿片类). Machine-drafted; NOT yet reviewed by a native
    // speaker.
    zh: {
      "lang.en": "English",
      "lang.fr": "Français",
      "lang.ja": "日本語",
      "lang.es": "Español",
      "lang.pt": "Português",
      "lang.de": "Deutsch",
      "lang.ko": "한국어",
      "lang.zh": "中文",

      "a11y.skip-to-main": "跳至正文",

      "splash.tagline": "面向高校间医学教育合作的协作平台。",
      "splash.signed-in-as": "已登录:",
      "splash.sign-out": "退出登录",
      "splash.lang-label": "语言",
      "privacy.title": "CaNaMED — 隐私政策",
      "privacy.subtitle": "我们如何使用您的数据,以及您的权利",
      "privacy.lang-not-available": "本隐私政策尚未提供您所选语言的完整翻译版本。下方英文文本为具有法律效力的版本。亦提供已审校的<a href=\"privacy.html?lang=fr\">法文</a>和<a href=\"privacy.html?lang=ja\">日文</a>版本。",

      "splash.enter.label": "请输入主持人发给您的会话代码",
      "splash.enter.placeholder": "例如:ABC-DEF",
      "splash.enter.submit": "进入 →",
      "splash.enter.no-code": "还没有代码?",
      "splash.enter.go-create": "我是主持人 — 创建会话 →",
      "splash.enter.go-account": "使用 Google 登录以保存我的资料和记录 →",

      "splash.account.title": "使用 Google 登录",
      "splash.account.subtitle": "我们使用 Google 进行身份验证,无需另记密码。加入会话时您的信息会自动填充,您参与过的会话记录会保存在您的资料中。",
      "splash.account.continue-google": "使用 Google 继续",
      "splash.account.back": "← 返回加入会话",

      "splash.profile.title": "设置您的资料",
      "splash.profile.subtitle": "您在此填写的信息将在每次加入会话时自动填充。之后可在账户中修改。",
      "splash.profile.name-label": "您的姓名(名字或昵称)",
      "splash.profile.name-placeholder": "例如:Alice / 明里",
      "splash.profile.uni-label": "大学",
      "splash.profile.year-label": "年级",
      "splash.profile.english-label": "英语水平(CEFR 自我评估)",
      "splash.profile.submit": "保存并继续 →",

      "splash.create.title": "创建 CaNaMED 会话",
      "splash.create.subtitle": "您将获得一个简短代码,可分享给学生。您将成为本会话的主持人(管理员)——请妥善保管这里设置的密码,以便日后管理会话。",
      "splash.create.name-label": "您的姓名",
      "splash.create.name-placeholder": "例如:Dr Smith",
      "splash.create.workshop-label": "工作坊名称",
      "splash.create.workshop-optional": "(可选)",
      "splash.create.workshop-placeholder": "例如:Caen × 名古屋 — 2026 年 6 月",
      "splash.create.content-label": "工作坊内容",
      "splash.create.password-label": "设置会话密码",
      "splash.create.password-placeholder": "只有主持人知晓的内容",
      "splash.create.back": "← 返回",
      "splash.create.submit": "创建会话",
      "splash.create.clone-last": "复制上次工作坊 ↻",
      "splash.create.clone-clear": "清空",

      "splash.created.title": "会话已创建",
      "splash.created.subtitle": "请将此代码分享给您的学生。他们在同一页面输入即可加入。",
      "splash.created.copy": "复制",
      "splash.created.copy-link": "复制链接",
      "splash.created.qr-caption": "或用手机扫描二维码",
      "splash.created.create-another": "再创建一个",
      "splash.created.open-admin": "打开管理面板 →",

      "lobby.join-title": "以参与者身份加入",
      "lobby.join-hint": "系统将自动把您分配到一个 {cohortPair} 混合房间——按大学、年级和英语水平进行平衡。",
      "lobby.uni-label": "大学",
      "lobby.uni-placeholder": "请选择您的大学…",
      "lobby.year-label": "年级",
      "lobby.year-postgrad": "研究生 / 住院医师",
      "lobby.english-label": "英语水平(CEFR 自我评估)",
      "lobby.english-hint": "CEFR 等级:A2 入门 · B1 中级 · B2 中高级(可讨论复杂话题) · C1 高级 · C2 精通。请选择最接近的一项——仅用于房间平衡分配。",
      "lobby.name-label": "您的姓名(名字或昵称)",
      "lobby.name-placeholder": "例如:Alice / 明里",
      "lobby.consent-workshop": "本人已阅读上述数据使用说明,同意参加本次 CaNaMED 工作坊。",
      "lobby.consent-workshop-detail": "本人的姓名、大学、年级、英语水平以及在工作坊期间输入的文本将对同房间的其他参与者和主持人可见。",
      "lobby.consent-research": "本人另行同意将本人的贡献(小组回答、投票、得分)用于 CaNaMED 教育研究项目,并以假名化形式进行分析和发表。本人理解,不勾选第二项亦可参加工作坊;拒绝勾选不会对本人的参加、成绩或在所在大学的地位产生任何影响。",
      "lobby.consent-version": "告知版本 PIS v1 · 2026-05。",
      "lobby.consent-version-link": "完整隐私政策",
      "lobby.consent-version-suffix": "。",
      "lobby.privacy.summary": "您的数据如何被使用(加入前请阅读)",
      "lobby.privacy.p1": "CaNaMED 研究团队(<strong>卡昂诺曼底大学 × 名古屋大学</strong>,GDPR 第 26 条意义上的共同管理者 / APPI 第 27 条第(5)款意义上的共同使用者)会收集您的名字或昵称、大学、年级和自我评估的英语水平。您的姓名对同房间的所有参与者可见,并会显示在您所贡献的分数旁边。",
      "lobby.privacy.p2": "您撰写的自由文本回答可能会涉及对临床情境的健康、宗教或哲学观点——这属于 GDPR 第 9 条所称的<strong>特殊类别数据</strong>以及 APPI 第 2 条第(3)款所称的<strong>要配慮個人情報</strong>。下方的第二个可选同意项即用于覆盖此情况。",
      "lobby.privacy.p3": "数据存储于 Google Firebase 实时数据库的 <strong>europe-west1(比利时,欧盟)</strong>。对于日本参与者而言,这是一次跨境传输,受欧盟–日本相互充分性决定(PPC,2019)的保护。实时会话数据将在 7 天内清除;如您勾选了研究同意项,您的贡献将在发表后以假名化形式保留最多 5 年。",
      "lobby.privacy.p4": "<strong>使用 Google 登录是可选的。</strong>如选择登录,一个小型个人资料以及您加入过的会话代码列表将与您的 Google 账号相关联;您可以随时在「我的账户」面板中编辑或删除。匿名加入完全以相同方式工作。",
      "lobby.privacy.p5": "您可以随时撤回同意。是否勾选第二个同意项<strong>不会对您的成绩、所在大学的地位或参加工作坊产生任何影响。</strong>如需行使任何权利(访问、更正、删除、可携、限制、反对、撤回、投诉),请联系主持人或发送邮件至 <strong><a href=\"mailto:canamed-ethics@unicaen.fr\">canamed-ethics@unicaen.fr</a></strong>(稳定的联系邮箱请参见<a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">完整隐私政策</a>)。",
      "lobby.privacy.p6": "<a href=\"privacy.html\" data-i18n-href=\"privacy\" target=\"_blank\" rel=\"noopener\">完整隐私政策</a>列明了管理者身份、法律依据、共同使用项目、跨境传输保护措施、保存期限、您的权利及响应时限,以及伦理委员会批准。请在加入前阅读一次。",
      "lobby.join-btn": "进入等候室",

      "waiting.title": "等候室",
      "waiting.you-are": "您是",
      "waiting.leave": "离开",
      "waiting.status-not-started": "您已加入。正在等待主持人开始会话…",
      "waiting.status-starting": "会话已开始——正在为您分配房间…",
      // R3-C1
      "waiting.late-join.banner": "您加入时房间已经在「{stage}」。之前的阶段在您到达之前已经发生——您可以随时点击「← 查看上一阶段」来回顾。  ",
      "waiting.late-join.dismiss": "知道了",

      "data-rights.export-btn": "下载我的数据(JSON) ⤓",

      "stage.label.0": "欢迎",
      "stage.label.1": "模块 A — 慢性疼痛",
      "stage.label.2": "模块 B — 告知坏消息",
      "stage.label.3": "总结",

      "stage.welcome.title": "欢迎参加第 3 次会话",
      "stage.welcome.intro": "主题:相互学习——学生主导的交流会话。今天的全部内容都在本平台进行。请大家一同推进;主持人会将您所在的房间从一个环节切换到下一个环节。",
      "stage.welcome.grade-note": "本工作坊不会影响您的成绩或在校地位。平台所给予的分数仅用于会话期间的学习,不计入大学成绩。如对某项得分或扣分有异议,请告知主持人;评分可以复核。",

      "room.call-facilitator": "呼叫主持人",

      "admin.mute-alerts": "静音呼叫提示音 + 桌面通知",
      "admin.download-error-log": "下载错误日志",
      "admin.theme": "主题",
      "admin.theme.auto": "自动(跟随系统)",
      "admin.theme.light": "浅色",
      "admin.theme.dark": "深色",
      "admin.theme.hc": "高对比度",
      "admin.report-bug": "报告问题",

      "admin.start-session": "开始会话——将所有人分配到房间",
      "admin.advance-all": "推进所有房间 →",
      "admin.download-all": "下载所有小组回答",
      "admin.end-session": "结束会话并下载归档",

      "stage.modB.title": "模块 B — 告知坏消息:跨文化角色扮演",

      "stage.wrap.title": "总结与后续步骤",
      "stage.wrap.thanks": "感谢您的参与!离开前请:",
      "stage.wrap.do-questionnaire": "完成会话结束问卷——仅需几分钟,3 周后会有一次简短的后测。",
      "stage.wrap.answers-saved": "您小组的回答已保存在下方——主持人将进行收集。",
      "stage.wrap.open-questionnaire": "打开会话结束问卷",
      "stage.wrap.questionnaire-fallback": "主持人会分享问卷链接。",
      "stage.wrap.bye": "完成问卷后可关闭此标签页。期待在第 4 次会话与您再见!",
      "stage.wrap.room-answers": "房间回答",

      "closed.title": "主持人已结束会话。",
      "closed.subtitle": "感谢您的参与——您小组的成果已保存。",

      "ended.title": "感谢您的参与",
      "ended.message": "主持人已结束本次会话。您小组的贡献已被保存。",
      "ended.questionnaire": "打开会话结束问卷 →",
      "ended.future": "如您参加今后的 CaNaMED 工作坊,将会获得新的会话代码。",
      "ended.return": "返回 CANAMED",

      "debrief.toggle": "打开复盘",
      "debrief.toggle-close": "关闭复盘",
      "debrief.title": "会话复盘",
      "debrief.subtitle": "跨所有房间的汇总统计——便于结束环节的讨论。",
      "debrief.empty": "开始会话后,这里会显示汇总统计。",
      "debrief.section.ranking": "房间排名",
      "debrief.section.decisions": "决策分布",
      "debrief.section.penalties": "扣分热力图",
      "debrief.section.concepts": "概念覆盖",
      "debrief.section.funnel": "参与漏斗",
      "debrief.section.time": "各阶段用时",
      "debrief.col.room": "房间",
      "debrief.col.team": "小组",
      "debrief.col.score": "得分",
      "debrief.no-data": "暂无数据。",
      "debrief.no-commit": "尚无房间确认此决策。",
      "debrief.rooms-picked": "房间",
      "debrief.correct-option": "(正确)",
      "debrief.module-a": "模块 A",
      "debrief.module-b": "模块 B",
      "debrief.penalty-fired": "已触发",
      "debrief.penalty-rooms": "受影响房间",
      "debrief.concept.rooms-hit": "个房间触及",
      "debrief.funnel.registered": "加入参与池",
      "debrief.funnel.assigned": "已分配到房间",
      "debrief.funnel.answered": "已回答 ≥1 题",
      "debrief.funnel.voted": "已对决策投票",
      "debrief.time.minutes": "分钟",
      "debrief.time.stage": "阶段",
      "debrief.points-per-room": "分 / 房间",

      "debrief.student.title": "您所在小组的复盘",
      "debrief.student.score": "您小组的得分:",
      "debrief.student.score-suffix": "分",
      "debrief.student.decisions-locked": "项决策已确认",
      "debrief.student.agreed": "您小组选择了最稳妥答案的决策",
      "debrief.student.disagreed": "需要再讨论的决策",
      "debrief.student.top-concept": "您小组涉及最充分的概念",
      "debrief.student.missed-concept": "您小组未能突出的概念",
      "debrief.student.engaged": "参与度最高的时刻",
      "debrief.student.engaged-detail": "用于",
      "debrief.student.closing": "感谢您的参与——每一份贡献都在助力这一合作的成长。",
      "debrief.student.none": "—",
      "debrief.student.no-team": "您小组的贡献已被保存。",
      "debrief.student.team-label": "您的小组",

      "tour.btn.next": "下一步",
      "tour.btn.back": "上一步",
      "tour.btn.skip": "跳过引导",
      "tour.btn.done": "知道了",
      "tour.btn.close": "关闭",
      "tour.progress": "第 {n} / {total} 步",
      "tour.reopen": "再次查看引导",

      "tour.create.1.title": "工作坊名称",
      "tour.create.1.body": "请为本次会话起一个易识别的名称(例如「Caen × 名古屋 — 2026 年 6 月」)。可选填,但在为下一届复制使用时会很方便。",
      "tour.create.2.title": "选择场景",
      "tour.create.2.body": "选择学生将要进行的临床内容。如需高级用法,也可以以 JSON 形式粘贴自定义场景。",
      "tour.create.3.title": "设置会话密码",
      "tour.create.3.body": "应仅由主持人知晓——日后需要用它重新打开管理面板。请选择当天能与协同主持人共享的字符串。",
      "tour.create.4.title": "创建并分享",
      "tour.create.4.body": "点击「创建会话」后,您将获得用于分享给学生的简短代码(以及二维码)。随后会直接进入管理面板。",

      "tour.admin.1.title": "房间一览",
      "tour.admin.1.body": "这里的每张卡片代表一个房间。您可以看到当前阶段、在场人员、小组得分以及是否有主持人呼叫。",
      "tour.admin.2.title": "推进整个会话",
      "tour.admin.2.body": "使用「推进所有房间」可让所有房间同步前进;也可用单房间箭头单独调控某个房间的节奏。",
      "tour.admin.3.title": "打开房间",
      "tour.admin.3.body": "点击「打开房间」可看到学生看到的画面,侧边面板可在不丢失上下文的情况下在多个房间之间切换。",
      "tour.admin.4.title": "结束与归档",
      "tour.admin.4.body": "结束时请关闭会话并下载归档。小组回答、投票与得分将导出为一个 JSON 文件。",

      // Bug 5/6 (user-feedback-2): student onboarding tour + participant settings widget
      "settings.btn": "设置",
      "settings.title": "设置",
      "settings.restart-tour": "再次查看入门导览",
      "settings.close": "关闭",
      "tour.student.1.title": "欢迎进入小组房间",
      "tour.student.1.body": "在整场会话中，这里是您团队的专属空间。下面快速介绍最常用的几个操作。",
      "tour.student.2.title": "为团队取名",
      "tour.student.2.body": "一起想一个有趣的团队名称——房间里任何人都可以填写。它会显示在实时排行榜上。",
      "tour.student.3.title": "发现记录",
      "tour.student.3.body": "当您询问、检查或开检查时，患者的回应会出现在这里。在手机上，回应也会显示在所点按钮的正下方。",
      "tour.student.4.title": "团队决策",
      "tour.student.4.body": "出现决策卡时，每位成员点选自己的选项。当投票人数达到要求时，一起锁定团队的答案。",
      "tour.student.5.title": "小组答案",
      "tour.student.5.body": "在此输入团队达成共识的简短要点。所有成员都会实时看到。",
      "tour.student.6.title": "呼叫指导老师",
      "tour.student.6.body": "需要帮助时随时点击这里。指导老师的仪表盘上会标记您的房间。",
      "tour.student.7.title": "语言与设置",
      "tour.student.7.body": "用此下拉菜单可随时切换语言。旁边的齿轮按钮可打开主题与无障碍设置。",

      "admin.search.placeholder": "按名称筛选房间…",
      "admin.search.clear": "清空",
      "admin.search.label": "筛选房间",
      "admin.search.empty": "没有房间符合此筛选条件。"
    }
  };

  let _currentLang = null;

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

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) < 0) return;
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
      // applyI18n + canamed:langchange would be no-ops; still emit the
      // event so listeners that rely on it (e.g. the lobby join-btn
      // tooltip) can re-sync defensively.
      if (typeof document !== "undefined" && typeof CustomEvent === "function") {
        try {
          document.dispatchEvent(new CustomEvent("canamed:langchange", {
            detail: { lang: lang }
          }));
        } catch (e) {}
      }
      return;
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("lang", lang);
    }
    applyI18n();
    // Notify listeners that the active language has changed. Used by
    // dynamic UI state (e.g. the lobby join-btn lock-tooltip) that lives
    // outside the data-i18n auto-application pipeline and needs to
    // re-read translated strings after a switch.
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      try {
        document.dispatchEvent(new CustomEvent("canamed:langchange", {
          detail: { lang: lang }
        }));
      } catch (e) { /* CustomEvent not supported — silent */ }
    }
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

  function applyI18n(root) {
    if (typeof document === "undefined") return;
    const scope = root || document;
    // text content
    scope.querySelectorAll("[data-i18n]").forEach(node => {
      const key = node.getAttribute("data-i18n");
      const attr = node.getAttribute("data-i18n-attr");
      const value = t(key);
      if (attr) node.setAttribute(attr, value);
      else if (node.hasAttribute("data-i18n-html")) node.innerHTML = value;
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
      node.innerHTML = t(key);
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

  // auto-apply once the DOM is ready, so HTML doesn't flash English first
  if (typeof document !== "undefined") {
    const init = () => {
      _currentLang = detectLang();
      if (document.documentElement) {
        document.documentElement.setAttribute("lang", _currentLang);
      }
      applyI18n();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  return { t, getLang, setLang, applyI18n, localizedHref, SUPPORTED, _T: T };
});
