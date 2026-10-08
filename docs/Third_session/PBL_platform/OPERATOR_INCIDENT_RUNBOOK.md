# CaNaMED Operator Incident Runbook

What to do when things go wrong, **five minutes before** or **during** a
live session. Designed to be readable on a phone while standing up.

For the happy-path setup, see
[`OPERATOR_QUICK_START.md`](OPERATOR_QUICK_START.md). For the deep
technical lifecycle (deploys, key rotation, retention), see
[`RUNBOOK.md`](RUNBOOK.md).

---

## Quick-reference table

| Symptom (what you see) | First-line fix |
|---|---|
| Splash page won't load | §1 Check Firebase Hosting; fall back to local copy |
| Students report "session not found" | §2 Confirm code on dashboard; check session not closed |
| Console / page shows "App Check failed" | §3 Check reCAPTCHA; temporarily disable App Check in console |
| Rooms not advancing when you press the button | §4 Re-prompt for admin password; verify not closed |
| Help-call alerts won't stop | §5 Tick *Mute alerts* on dashboard |
| Dashboard shows stale data or phantom rooms | §6 Clear `localStorage` + reload |
| Total outage (Firebase down, network gone) | §7 Fall back to Google Form + verbal |
| Need to capture state for a postmortem | §8 Download in-page error log |
| Need to escalate | §9 Contacts |
| You forgot the admin password mid-session | §10 Super-admin password recovery |

---

## §1 Splash page won't load

You typed the URL and got a white page, a "site can't be reached", or a
generic Firebase 404.

1. **Check Firebase Hosting status** — open
   <https://status.firebase.google.com>. If Hosting is red, this is an
   upstream outage. Wait it out or fall back (§7).
2. **Check the URL.** A subtle typo in `canamed-69785.web.app` is the
   most common cause. The deployment also lives at
   `canamed-69785.firebaseapp.com` — try both.
3. **Hard reload** (Ctrl+Shift+R / Cmd+Shift+R) to bust the browser
   cache.
4. **Fall back to a local copy.** Operators who pre-cloned the repo can
   run the platform locally:
   ```
   cd docs/Third_session/PBL_platform
   python -m http.server 8000
   ```
   Then open `http://localhost:8000`. This serves the same code; if
   `firebase-config.js` has credentials, it talks to the same Firebase
   project. If credentials are stripped, it runs in local-test mode
   (single browser, no cross-device — useful only for a single-room
   dry run).
5. **Last resort:** open the platform on a colleague's machine and screen-
   share via Teams.

---

## §2 Students get "session not found"

The room is staring at "no such session" messages.

1. **Re-confirm the code.** Look at the dashboard URL bar; the code is in
   the address (`…/?session=ABC-DEF`). Read it out again, loud and slow.
   Codes are case-insensitive but the dashes matter only visually.
2. **Did you close the session?** A closed session refuses new joins.
   From the dashboard, look for the "Session closed by …" banner. If
   yes: you cannot re-open it (the database rule is final). Create a new
   session and re-share the new code.
3. **Did the cleanup workflow purge it?** Sessions that have been closed
   for 30+ days or open + idle for 90+ days are auto-purged. Unlikely
   during a live workshop, but check `RUNBOOK.md` §6 if a session you
   left running over a weekend is gone.
4. **Database connectivity check.** Open the **Health check** page; row
   5 (Realtime DB reachable) tells you if the database is reachable at
   all.

---

## §3 "App Check failed" / reCAPTCHA errors

Errors in DevTools mentioning `appcheck`, `recaptcha`, `403`, or
"attestation failed".

1. **Check the reCAPTCHA token state.** Open DevTools → Console. Look
   for `[CaNaMED] App Check is OFF` (means it never activated) or
   repeated `App Check token fetch failed` messages.
2. **Confirm the site key is set.** In Console, type
   `window.CANAMED_RECAPTCHA_SITE_KEY`. It should be a string starting
   `6L…`. If `null`, App Check is intentionally off — that's fine.
3. **Confirm the page domain is registered.** reCAPTCHA only attests for
   the domains listed on the site-key admin page
   (<https://www.google.com/recaptcha/admin>). If you moved the
   platform to a new domain today, that's the cause — add the new
   domain there.
4. **Temporarily disable App Check enforcement** (operator action — only
   the project owner can do this):
   - Firebase Console → **App Check** → **APIs** → **Realtime Database**.
   - Flip from *Enforced* back to *Unenforced*.
   - The platform will continue to attempt attestation but the database
     will accept requests that lack a valid token.
   - **Re-enforce after the session.** Unenforced mode is fine for a few
     hours but is the right thing to roll back the moment the incident
     is over.
5. Document what you did in your postmortem.

---

## §4 Rooms aren't advancing

You press *Advance →* and nothing happens, or you see a permission error.

1. **Are you actually the admin for this session?** The platform
   re-prompts for the session password after long idle. If the
   *Advance* button is greyed out, re-enter the password via the
   *"Re-authenticate"* link on the dashboard.
2. **Is the session closed?** Once `sessions/{code}/closed` is set, the
   database refuses every write — including stage advances. There's no
   way to "re-open"; create a new session.
3. **Is your password correct?** A wrong password silently leaves you in
   participant mode (the dashboard renders but writes are denied). Try
   the password in a fresh tab.
4. **Network blip?** Watch the dashboard's connection indicator. If it
   shows "Reconnecting…" for more than 10s, refresh — the SDK retries
   on its own but a hard refresh is faster.

---

## §5 Help-call alerts spamming

A room is pressing *Call a facilitator* repeatedly. Each press shows a
red badge + plays a chime.

1. **Tick *Mute alerts* at the top of the dashboard.** Badges still
   show on the room cards, but chime + toast go quiet.
2. **Open the room.** Opening the room auto-clears its current alert
   and is the polite acknowledgement to the students that you've seen
   them.
3. **Rate-limit is server-side**, set to 30 seconds between presses per
   room (database rule). A faster spam means the room has multiple
   students hitting the button — talk to them in voice.

---

## §6 Dashboard shows stale data / phantom rooms

The dashboard shows rooms that no longer exist, or scores that don't
match what students see, or a session you previously closed.

1. **Hard refresh** (Ctrl+Shift+R / Cmd+Shift+R) first.
2. **Clear the platform's `localStorage`:**
   - DevTools → **Application** → **Local Storage** → your domain.
   - Look for keys starting with `canamed_` (session unlocks, theme,
     i18n preference, telemetry buffer).
   - You can clear them all; the only thing you lose is your
     remembered session-code list (you still have the codes
     elsewhere).
3. **Reload the page.** Re-enter the session code, re-enter the admin
   password — and you're back to the canonical state from Firebase.
4. **If the phantom data persists after a clear**, it's coming from
   the database, not the cache. Inspect the session's actual state at
   Firebase Console → Realtime Database → `sessions/{code}` and
   delete stray children.

---

## §7 Total outage — Firebase or your network is down

Worst case: the platform is unreachable and a roomful of students is
waiting.

1. **Acknowledge it on voice.** Tell the room what's happening; ask
   them to keep their Teams / Zoom call open.
2. **Switch to a Google Form** for collecting answers. Pre-create
   forms for each module that mirror the platform's answer fields
   (the operator pack should include a *backup-forms* folder; if not,
   create them in five minutes with the questions from
   `case-content.js`).
3. **Switch to a backup session code.** If the issue is a corrupted
   single session (not a Firebase outage), create a fresh session and
   re-share the new code. Tell students to type the new code.
4. **Continue verbally.** The session is fundamentally a discussion;
   you can run Module A as a whole-class conversation if the platform
   is gone. The platform's value-add is scoring + recording, both of
   which can be reconstructed from voice + the Google Form afterward.
5. **Capture timestamps.** Note when the outage started and ended for
   the postmortem.

---

## §8 Download the in-page error log

After an incident, the platform's error log is useful for the
postmortem:

1. The admin dashboard has a **"Report a bug"** button (added in
   PR #65) that opens a pre-filled email with session code, browser
   info, recent telemetry events and the last ~50 error log entries.
2. To get the log without sending it: open DevTools → Console, run
   `JSON.stringify(window.CANAMED_TELEMETRY?.getBuffer?.() ?? [], null, 2)`
   and copy the result.
3. Save the JSON + screenshots + the session archive (§5 of the
   quick-start) together in your incident folder.

---

## §9 Escalation contacts

Replace these placeholders before your next session — keep them on the
fridge / phone, not buried in a doc:

| Role | Name | Contact |
|---|---|---|
| Platform technical lead | _[fill in]_ | _[email + phone]_ |
| Firebase project owner | _[fill in]_ | _[email]_ |
| Caen PI | _[fill in]_ | _[email]_ |
| Nagoya PI | _[fill in]_ | _[email]_ |
| Data Protection Officer (Caen) | _[fill in]_ | _[email]_ |
| On-call faculty (Module B safety) | _[fill in]_ | _[phone]_ |

For a data-protection incident specifically (a participant's data was
exposed, a database leak, an unauthorised re-use of answers), follow
the **Incident-Response plan** referenced in `README.md` →
"Operations / retention / breach response". Notification clocks start
the moment you realise: **72 h to CNIL** under GDPR Art. 33, **3–5
days preliminary report to PPC** under APPI Art. 26.

---

## §10 Super-admin password recovery

You forgot the session admin password while a live workshop is running.
What resets it is the session's **recovery code** — the twelve-character
code shown once, when the session was created. (This section said until
2026-10 that a super-admin key was required and that recovery was
impossible without one. That has not been true since the recovery code
was introduced: the key is checked only on a deployment that sets one,
and the public deployment sets none.)

1. **Find the recovery code.** Without it the panel cannot reset an
   existing password — go to "When recovery itself doesn't work" below.
2. **Open the lobby** (`canamed-69785.web.app/` or your deployment
   URL), enter the session code, expand "I am a facilitator", then
   follow the **"Forgot the password?"** link to the recovery panel.
3. **Enter your name, the new session password TWICE, and the recovery
   code.** If your deployment sets a `SUPERADMIN_KEY`, enter that too.
   Submit. You should land in the admin dashboard.

A reset is refused once the session has been **closed**.

### Known constraints

- **Where the reset is recorded** — to open a reset the client writes a
  short-lived record holding the recovery code to
  `adminSecrets/<code>/reset/<your uid>`, a part of the database no
  client can read, and removes it once the new password is in place.
  Nothing is written under the session. (Until 2026-10 it was written
  to `sessions/<code>/_superadminReset`, which every participant of the
  session could read while the reset was in progress. **If you used
  this path before that change on a session that is still open, treat
  its recovery code as known to its participants**; closing the session
  ends what the code can do.)
- **No audit trail** — the record is removed as soon as the reset is
  done and never held a history. This section used to describe one; it
  did not exist.
- **30-second window** — after the record is written, the rule allows
  the password hash to be overwritten for 30 s, by the same user only.
  If the removal step fails, the window still expires by itself.
- **Clock skew does not matter** — the record is stamped with the
  server's time, not the laptop's.

### When recovery itself doesn't work

The panel answers every refusal with *"That recovery code doesn't match
this session"*, whatever the cause. In order of likelihood:

1. **The code is mistyped**, or belongs to another session.
2. **The browser is running an older copy of the app.** A copy cached
   before the 2026-10 change still writes the reset where it used to,
   and the rules now refuse that — with the same message. Reload the
   page, wait a few seconds, and reload again (the first reload fetches
   the new version in the background, the second one runs it), then
   retry.
3. **The session is closed.** A closed session cannot be reset.
4. **The recovery code is lost.** No client can read it back. Escalate
   to §9: the project owner can read it in the Firebase Console at
   `recovery/sessions/<code>/code` (for an organisation,
   `recovery/orgs/<slug>/sessions/<code>/code`).
5. If none of those applies, check that the database rules of the
   current release are deployed (`firebase deploy --only database`),
   then escalate to §9.

---

## After the incident

- Write a short postmortem (one page is fine) in `docs/incidents/`,
  dated. Capture: what happened, what you saw, what you did, what
  worked, what didn't, what to change.
- If you had to disable App Check, re-enforce it.
- If you used a fallback session code, archive both the original and
  the fallback.
- If you discovered a bug, file an issue with the bug-report JSON
  attached.
