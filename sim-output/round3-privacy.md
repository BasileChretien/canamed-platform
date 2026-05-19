# CaNaMED PBL Platform — GDPR / APPI Privacy Audit
**Audit date:** 2026-05-20  
**Auditor:** Security Reviewer (automated)  
**Files reviewed:**
- `docs/Third_session/PBL_platform/index.html`
- `docs/Third_session/PBL_platform/privacy.html`
- `docs/Third_session/PBL_platform/script.js`
- `docs/Third_session/PBL_platform/database.rules.json`

---

## 1. Consent Flow

**Severity: MEDIUM**

### What is present (strengths)
- Two separable checkboxes: mandatory workshop-consent (gates the Join button) and optional research-consent. These are correctly unbundled per GDPR Art. 7(2) and APPI Art. 20(2).
- Both checkboxes are versioned (`CONSENT_NOTICE_VERSION = "PIS-v1-2026-05"`) and timestamped server-side in `pool/{clientId}/consent` — `{ workshop, research, version, at }`.
- `autoResume()` invalidates saved consent and forces re-consent if the notice version changes — correct re-consent on material change (GDPR Art. 7(3), Recital 42).
- Privacy notice in the lobby is rendered inline and open-by-default (collapsed only on ≤600 px viewports); full trilingual policy is at `privacy.html`.
- Special-category framing (GDPR Art. 9, APPI Art. 2(3)) is explicitly called out in the lobby inline notice and in section 5 of `privacy.html` for health, religious and philosophical opinions.
- Legal bases are stated: GDPR Art. 6(1)(a), 9(2)(a), 9(2)(j); APPI Art. 17/21, 20(2), 27(5).

### Gap: revocation path is incomplete for already-submitted data
`privacy.html` section 10 and `index.html` lobby copy say "you can withdraw consent at any time" but instruct users to email `canamed-ethics@unicaen.fr` rather than providing a self-service deletion path for in-session content. The **Leave** button removes the participant from the pool but does NOT delete their answers, votes, or free-text contributions from the room. The policy text acknowledges this ("contributions already submitted remain in the room's record … unless you also request deletion at the contact above") but there is no in-platform confirmation or timer shown to the user at the moment of leaving.

**Fix:** Add a "Leave and request data deletion" path in the UI that (a) calls `refMyPool.remove()`, (b) deletes the user's own answers/votes/presence from Firebase (rules already permit `$uid` to write null), and (c) displays an unambiguous on-screen confirmation that the deletion request has been sent to the ethics mailbox for the facilitator-archive copy. This covers GDPR Art. 7(3) + Art. 17(1)(b).

---

## 2. Anti-Coercion / Grading Relationship

**Severity: LOW (well-handled)**

The grade-note card (`lobby-grade-note`, `stage.welcome.grade-note`) is injected into the lobby DOM **above** the consent checkboxes, making it visible before the user decides. The full policy (section 9) also states "no effect on your grades, university standing, or workshop participation". The research-consent box explicitly states this in its label text. GDPR Recital 43 (power imbalance) and APPI Art. 26-3 requirements are met at the UI level.

**No action required.** Verify that the grade-note text is translated in all eight UI languages (en/fr/ja are reviewed; es/pt/de/ko/zh are machine-drafted — ensure "grade" is correctly translated, not just "points").

---

## 3. Data Minimisation (GDPR Art. 5(1)(c) / APPI Art. 19)

**Severity: MEDIUM**

Fields collected on join: `name`, `university`, `year`, `english`. These are all used for room balancing (algorithm visible in `lib.js`) and for displaying contributions — justified.

**Finding 3a — `stableId` for anonymous users retained in localStorage indefinitely.**  
`stableId` is a random 80-bit identifier stored in `localStorage` under `canamed_stable_id`. It is cleared on sign-out from Google-authenticated sessions but it is NOT cleared when an anonymous (non-Google) participant closes the session or clears their in-session resume data. This allows longitudinal re-identification of the same device across multiple workshop sessions, which exceeds the stated purpose ("balance rooms, run one workshop"). Only Google-authenticated users' `stableId` is bound to an erasable Firebase `uid`.

**Fix:** On `leaveAndReload()` for anonymous users, also call `localStorage.removeItem(STABLE_ID_KEY)`. This is symmetric with the existing cleanup for Google users (see `script.js` line 7890 comment which references this removal for Google sign-out but the anonymous path needs verification).

**Finding 3b — Google profile picture.**  
`privacy.html` section 4 mentions "optional profile picture" from Google sign-in. The `users/{uid}/profile` schema in `database.rules.json` does not include a `photoURL` field, and the `profile` node validation only validates `name`, `university`, `year`, `english`, `updatedAt`. If the Google display photo URL is stored anywhere outside the `users` subtree it falls outside the deletion path in `accountDelete()`.

**Fix:** Confirm whether `photoURL` is stored in the platform DB or only used ephemerally from the Firebase Auth object. If stored, add it to both the `profile` validation rule and the `accountDelete()` erasure path.

---

## 4. Self-Export (Art. 15 GDPR) + Erasure (Art. 17 GDPR / APPI Art. 35)

**Severity: MEDIUM**

### Self-export (Art. 15) — present and well-implemented
`downloadMyData()` (script.js ~4701) produces a structured JSON download (`participant-self-export-art-15-gdpr`) covering pool, presence, typing, answers, votes, pre/post tests, manual scores, and help calls, plus Google profile + history for authenticated users. No admin involvement required; Firebase rules permit the participant to read their own data. Satisfies GDPR Art. 15 + Art. 20 (portability).

**Gap:** The export is only wired inside the active session — `downloadMyData()` returns early if `!sessionNum`. A participant who exercised their Art. 15 right after the session has closed can only access their data via the ethics mailbox email route, not via self-service. The `closed` state does not revoke the participant's `.read` on their own pool entry, so the data is technically readable; the UI block is the only barrier.

**Fix:** Wire the GDPR export button to remain enabled post-close, or add a separate Art. 15 request path on the session-ended screen with a "download what we have on you" button.

### Erasure (Art. 17) — partial
`accountDelete()` removes `users/{uid}` (profile + history) and deletes the Firebase Auth user. This covers the user-account layer.

**Gap:** `accountDelete()` does NOT delete the participant's `pool/{clientId}` entry, room `answers/{module}/{entryId}` records keyed by `cid`, `presence/{clientId}`, `votes/{voteId}/ballots/{clientId}`, or `tests/{cid}` entries across any sessions the user joined. Those remain in the session subtrees until the 7-day/30-day automatic purge. The gap is partially acknowledged (the `accountDelete()` confirm dialog says "contributions in past sessions stay in those sessions' records but are no longer linked to your identity") but the active session's room data is not covered by this erasure.

**Fix:** Before writing the `closed` marker and generating the archive, check whether the departing user has pending research-consent = false and if so exclude their contributions from the archive (already partially handled by the pseudonymisation toggle — elevate this to a data-hygiene step). For full Art. 17 compliance on deletion requests, provide an operator-run deletion script that removes contributions by `stableId` across all open sessions.

---

## 5. Retention

**Severity: LOW (documented; automation gap on private repo)**

`privacy.html` section 8 documents the retention schedule:
- Live session data: purged within 7 days
- Session archive: pseudonymised within 30 days; linkage table destroyed within 6 months
- Pseudonymised research dataset: up to 5 years after publication
- Google profile + history: until account deletion

The private CANAMED repo's `cleanup-stale-sessions.yml` and `pseudonymise-export.yml` workflows implement these schedules — but as of 2026-05-18, both are **disabled** (cron schedules commented out, per `CLAUDE.md`). Manual execution is the only enforcement path during this period.

**Severity elevated to HIGH while crons are disabled.**

**Fix:** Document in the privacy policy (or a supplementary operational notice) that the automated schedules are currently suspended and state the manual cadence being used. Reactivate the cron schedules as soon as the Actions minute budget allows. Consider adding a status badge or internal tracker so the gap does not exceed 7–14 days without attestation.

---

## 6. International Transfer / Firebase Hosting Region

**Severity: LOW (well-documented)**

`privacy.html` section 7 and the lobby inline notice both state the database is hosted in **`europe-west1` (Belgium, EU)**. Google Firebase DPA + EU SCCs are cited. For Japanese participants, the 2019 EU–Japan mutual adequacy decision (PPC) is referenced.

**Finding:** The Firebase project ID (`canamed-69785`) is visible in the CSP header and in the privacy policy URL, which is unavoidable. However, `firebase-config.js` is not audited here; confirm the `databaseURL` in that file points to a `europe-west1` regional endpoint (e.g. `https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app`) and not the legacy US `firebaseio.com` endpoint. If it points to the US endpoint, the stated region in the privacy policy is incorrect.

**Fix:** Audit `firebase-config.js` and confirm the RTDB URL region tag. Update the privacy policy if there is a discrepancy.

---

## 7. Facilitator-Side Logs — PII Leakage

**Severity: LOW (no critical leakage found; one advisory)**

The `logAdminAction()` and `logEvent()` functions write structured entries to Firebase under `audit/` and `rooms/{room}/events/`. The `by` field is populated with `myName` (participant's first name, ≤40 chars) and a `payload` field (serialised, up to 500 chars).

**Finding:** The `payload` field accepts arbitrary object serialisation. If a calling site passes an object that contains a participant's free-text answer excerpt or their email address as part of a scoring context (e.g., `{ reason: answer.text }`) this would persist in the append-only audit log beyond the 7-day window. A review of all `logAdminAction(…, payload)` call sites is needed.

**Confirmed safe:** `console.log/warn/error` calls do not emit PII — no user name, email, UID, or consent values appear in `console.*` output per the grep results. The `console.warn` on line 836 warns that the super-admin key is publicly readable in `firebase-config.js`, which is itself a correct security warning.

**Fix:** Audit every `logAdminAction(kind, payload)` call site to ensure `payload` never contains free-text answer content, email, or UID. Consider stripping `payload` fields from audit log entries entirely in production, or running the payload through a PII scrubber before writing.

---

## 8. Anonymisation / Pseudonymisation of Exports

**Severity: LOW (optional toggle; advisory on default)**

`downloadFullArchive()` and `downloadAllAnswers()` both honour an `anon-export` checkbox that, when checked, runs `pseudonymiseTree(tree)` — replacing real participant names with deterministic `Student-A / Student-B / …` codes per room, ordered by pool join time. The linkage table is NOT included in the download (only the count). This is the approach used by `scripts/pseudonymise-export.js`.

**Finding:** The pseudonymisation toggle is **optional and defaults to unchecked.** A facilitator who downloads the archive without enabling the toggle receives the full real-name session tree. There is no on-screen warning that the non-pseudonymised archive contains personal data (special-category data under GDPR Art. 9) and should be handled accordingly.

**Fix:** Default the `anon-export` checkbox to checked (opt-out pseudonymisation rather than opt-in). Add a warning next to the non-pseudonymised download option: "This file contains real names and may include special-category data (health opinions). Handle in accordance with your data management plan." For facilitators with research-consent = false participants in the session, consider blocking the non-pseudonymised download path entirely.

---

## 9. Children — Under-16 / Under-15

**Severity: LOW (correct documentation; no technical enforcement)**

`privacy.html` section 14 states the platform is "intended for adult medical students aged 18+" and instructs users under 16 (GDPR Art. 8) or under 20 (Japanese university norms) to contact their facilitator before joining. The French age for digital consent is 15 (Loi n°2018-493 art. 45), not 16, but since the stated minimum is 18, this is moot in practice.

**Finding:** There is no age gate or technical enforcement. The platform relies on the institutional process (students are enrolled in medical school, which requires baccalauréat / university entrance, implying age ≥18) rather than a checkbox or date-of-birth field.

**No action required** for the current deployment context (both Caen and Nagoya cohorts are enrolled medical students, all ≥18). If the platform is ever opened to general educational use outside medical schools, an explicit age confirmation step should be added.

---

## 10. Breach Notification Path

**Severity: LOW (documented; no in-platform path)**

`privacy.html` section 13 documents:
- CNIL notification within 72 hours (GDPR Art. 33–34)
- PPC preliminary report within 3–5 days, final within 30 days (APPI Art. 26, 2022 amendment)

The contact mailbox is `canamed-ethics@unicaen.fr`.

**Finding:** There is no in-platform incident-reporting workflow — no admin-facing "Report a security incident" button, no Slack/Teams webhook for automated alerting, and no documented internal escalation path beyond the external mailbox. The GDPR 72-hour clock starts at the moment the controller "becomes aware" — if breach discovery depends on a facilitator manually emailing the ethics address, the clock may already be running before the DPO is notified.

**Fix:** Document an internal escalation runbook (who to call, what to collect, when to notify CNIL). Consider adding a Firebase security rule alert or a Cloud Monitoring sink that notifies the platform administrator of anomalous read patterns (bulk data access outside session hours).

---

## 11. Consent Write-Once / Integrity (database.rules.json)

**Severity: MEDIUM**

In `database.rules.json`, the `pool/{clientId}/consent` node has **no `.write` rule** of its own — it inherits the parent `pool/{clientId}` `.write` rule, which is `auth != null && !closed`. This means any authenticated user can overwrite a participant's consent record at any time during an open session, including changing `workshop: true` to `workshop: false` or vice versa after the fact.

There is also no rule restricting who can write to `pool/{clientId}` — any authenticated user (not just the owner of that `clientId`) can write to any pool entry, including overwriting another participant's consent record.

**Fix:**
```json
"pool": {
  "$clientId": {
    ".write": "auth != null && auth.uid == $clientId && !root.child(...).child('closed').exists()",
    "consent": {
      ".write": "auth != null && auth.uid == $clientId && !data.exists()"
    }
  }
}
```
This (a) restricts pool writes to the owner of the entry (`auth.uid == $clientId`, assuming clientId is bound to uid) and (b) makes the consent record **write-once** (`!data.exists()`). If the consent model requires updates (e.g. version upgrade), add a separate `consent_v2` node or use a migration path. Note: `$clientId` is currently a random hex client ID (`c...`), not a Firebase UID — the rules need to use `stableId` or the pool entry's own auth context to restrict writes correctly.

---

## 12. Super-Admin Key in Public Source

**Severity: HIGH**

`script.js` line 835–838:
```javascript
if (MODE === "shared" && window.CANAMED_SUPERADMIN_KEY) {
  console.warn("[CaNaMED] A super-admin key is set in firebase-config.js and is " +
    "readable in the page source of a public deployment.");
}
```

The code itself warns about this. If `firebase-config.js` contains a non-null `CANAMED_SUPERADMIN_KEY`, any visitor can read it in the browser's DevTools source view and use it to reset the session admin password via `_superadminReset`. In production deployments the key should be `null` and password resets should go through the Firebase console.

**Fix:** Verify `firebase-config.js` in the production deployment has `window.CANAMED_SUPERADMIN_KEY = null`. Add a build-time CI check that fails if the key is non-null in a production build. This is already partially addressed by the existing `console.warn`, but a CI check provides enforcement.

---

## Summary Table

| # | Area | Severity | Status |
|---|------|----------|--------|
| 1 | Consent flow — revocation path incomplete for already-submitted room data | MEDIUM | Open |
| 2 | Anti-coercion grade-note visible before consent | LOW | Pass |
| 3a | Anonymous `stableId` not cleared on session leave | MEDIUM | Open |
| 3b | Google profile picture storage path unclear | LOW | Verify |
| 4a | Art. 15 export disabled post-session-close | MEDIUM | Open |
| 4b | `accountDelete()` does not erase room contributions | MEDIUM | Open |
| 5 | Retention cron schedules disabled — manual-only enforcement | HIGH (temporary) | In progress |
| 6 | Firebase region in `firebase-config.js` unverified | LOW | Verify |
| 7 | Audit log `payload` may contain free-text PII | LOW | Verify |
| 8 | Pseudonymisation toggle defaults to off | MEDIUM | Open |
| 9 | No age gate (acceptable for medical school context) | LOW | Accepted |
| 10 | No internal breach escalation runbook | LOW | Open |
| 11 | Consent node not write-once; pool entry not owner-restricted | MEDIUM | Open |
| 12 | Super-admin key potentially in public source | HIGH | Verify production config |

---

## Top 3 Priority Fixes

### Fix 1 — Restore retention automation (CRITICAL while disabled)
`C:/cnm-pp/CANAMED/.github/workflows/cleanup-stale-sessions.yml` and `pseudonymise-export.yml` have their cron schedules commented out. While manual compensation is documented in `CLAUDE.md`, the 7-day live-data purge and 30-day pseudonymisation commitments in the privacy policy are legally binding. Any gap longer than 7 days in the purge cadence constitutes a violation of the stated retention period. Uncomment the cron schedules as soon as the Actions minute budget resets, and add a calendar reminder to the platform administrator for manual execution every 5 days until then.

### Fix 2 — Make consent node write-once and owner-restricted (`database.rules.json`)
The pool entry and its nested `consent` node are writable by any authenticated user during an open session. A bad actor who knows another participant's `clientId` can overwrite their consent record. Add `".write": "auth != null && auth.uid == $clientId && !data.exists()"` on the `consent` subnode. This is a five-line change in `database.rules.json` and is the highest-impact correctness fix for the consent integrity of a research dataset.

### Fix 3 — Default pseudonymisation export to on, add PII warning to non-pseudonymised download
`downloadFullArchive()` and `downloadAllAnswers()` both default the `anon-export` toggle to unchecked. Facilitators downloading the post-session archive without pseudonymisation receive a file containing real names alongside free-text medical opinions (special-category data, GDPR Art. 9 / APPI 要配慮個人情報). Change the default to checked, and add an explicit on-screen warning when a facilitator opts into the non-pseudonymised path: "This file contains real participant names and may include health-related, religious, or philosophical opinions. Ensure it is stored and handled per your data management plan and not shared outside the named CaNaMED research team."
