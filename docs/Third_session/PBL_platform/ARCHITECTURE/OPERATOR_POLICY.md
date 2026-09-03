# Operator Policy: Security disclosure, Blaze plan migration, and ops contacts

This document captures the platform's operator-level policies that need a
human decision rather than a code change. It's the place a new operator
(faculty, ops engineer) reads to understand the live-service posture.

---

## 1. Responsible disclosure / coordinated vulnerability disclosure

The CaNaMED platform handles student PII (names, university, year, English
level, free-text answers about clinically sensitive topics under GDPR Art. 9
and APPI Art. 2(3)). Security researchers who find a vulnerability are
asked to follow this disclosure protocol:

### Scope (in)

- The Firebase Hosting deployment at `canamed-69785.web.app`
- The Realtime Database rules at `docs/Third_session/PBL_platform/database.rules.json`
- The auth + session lifecycle at `docs/Third_session/PBL_platform/script.js`
- The CSP / hosting headers in `docs/Third_session/PBL_platform/firebase.json`

### Scope (out)

- Issues only reproducible on the local dev server (`scripts/serve-platform.js`)
- DoS / volumetric attacks
- Findings in third-party services (Firebase, Google reCAPTCHA) — report
  those to the vendor

### Reporting

Email a single message to **`canamed-security@unicaen.fr`** (operator
deliverable — to be confirmed and provisioned before publishing this
notice). PGP key fingerprint placeholder: `[to be added]`. Please include:

- A short description of the vulnerability
- Steps to reproduce
- Impact assessment
- Your preferred attribution (or anonymous)

### Response targets

- **Acknowledge** within 5 working days
- **First triage + severity rating** within 10 working days
- **Resolution or mitigation plan** within 90 days for High/Critical, 180
  for Medium

We commit to public credit (CVE if applicable, line in the release notes)
unless the reporter prefers to stay anonymous. No legal action will be
taken against good-faith research that respects scope and avoids
exfiltrating real-user data.

### Safe-harbour conditions

- Stop at the first evidence of access — do not pivot or persist
- Do not exfiltrate user data beyond the minimum needed to demonstrate
  the issue
- Do not interact with workshops in progress (visible via active session
  codes on the dashboard)
- Notify us at the first opportunity

---

## 2. Firebase Spark vs Blaze plan migration

The platform runs on the **Spark (free) plan** today. This has hard caps
that are fine for single-session use but will be exceeded at scale:

| Resource | Spark cap | Notes |
|----------|-----------|-------|
| Realtime Database simultaneous connections | 100 | one tab = one connection; a 30-student session uses ~32 |
| Realtime Database storage | 1 GB | session data is small (~1 MB / session) |
| Realtime Database egress | 10 GB / month | the throttle most likely to bite during heavy debrief downloads |
| Hosting transfer | 10 GB / month | static assets gzipped are ~50 KB total |
| Hosting build storage | 1 GB | well under |
| Cloud Functions | — not available — | Spark plan does not include Functions |

### What we'd unlock on Blaze

1. **Cloud Functions** — needed to:
   - Accept CSP violation reports at `/_csp_report` (currently 404)
   - Run pseudonymised export jobs on a schedule (today the facilitator
     downloads the archive manually)
   - Send help-call notifications via Pub/Sub for facilitators on a
     different device
   - Implement per-IP rate limiting beyond what Realtime Database rules
     can do

2. **Higher connection cap** — Blaze removes the 100-simultaneous limit;
   pay-as-you-go after ~200,000 connection-minutes/month. A 30-student
   session for 3 hours = 30 × 180 = 5400 connection-minutes — well within
   the free Blaze allowance, but no longer capped.

3. **Better observability** — Cloud Logging, Cloud Monitoring, alerts on
   budget overrun.

### Cost estimate

For 5 workshops of ~30 students × 3 hours each per month:

- Database connections: free (under 200K minute-allowance)
- Database storage: free (under 5 GB)
- Database egress: ~ $0.50 (under 5 GB)
- Hosting transfer: free (under 10 GB)
- Cloud Functions: ~ $0.10 (well under 2M invocation free tier)

**Estimated monthly cost: under $5.** A $10/month budget alert in Cloud
Console gives substantial headroom.

### Risk: runaway cost

Set a **budget alert at $5/month** and a **hard budget cap at $25/month**
in Cloud Billing. If the cap is hit, Cloud Functions are paused — the
static site keeps serving but reports/jobs stop. Set up the alert on the
billing account before flipping to Blaze.

### Migration steps (operator deliverable)

1. Add a billing account to the Firebase project (Firebase console →
   Settings → Usage and Billing → Modify Plan → Blaze)
2. Set the $5 budget alert + $25 hard cap
3. Deploy Cloud Functions for `/_csp_report` (separate PR)
4. Enable Cloud Monitoring + create an alert policy for "Function invocations
   per minute > 100" (catches abuse)
5. Document the rollback path: Blaze can be downgraded back to Spark
   but Functions will be deleted

---

## 3. Operator contacts

| Role | Contact | Responsibility |
|------|---------|----------------|
| Data Protection Officer (Caen) | `[to be added]` | GDPR data-subject requests, breach notifications |
| Joint controller PI (Caen) | `[to be added]` | Study-level decisions, ethics committee liaison |
| Joint controller PI (Nagoya) | `[to be added]` | APPI compliance, Japanese ethics committee |
| Platform engineering lead | `[to be added]` | Code reviews, deployment authorization, on-call |
| Security disclosure | `canamed-security@unicaen.fr` | Vulnerability reports (per §1) |
| Bug reports (non-security) | `canamed-bugs@unicaen.fr` | Operational bugs, see in-app "Report a bug" |

(All addresses are operator deliverables — confirm before publishing.)

---

## 4. Erasure requests (GDPR Art. 17 / Art. 7(3), APPI Art. 35(5))

A participant asking to be erased is an **operator action** today — there is no
in-product withdrawal button, which is itself an open item (Annex VI **G12**).

```bash
# 1. ALWAYS look first. Dry run is the default; nothing is written.
node scripts/erase-participant.js --uid <uid>
```

Read the whole report before confirming. It prints three things:

- **PLAN** — every path that will be deleted, per session.
- **AMBIGUOUS** — entries attributed by display name with no id beside them.
  These are **not** deleted. Two students with the same name in one cohort is
  ordinary, so confirm identity by hand before touching them.
- **UNERASABLE** — `roomChat`. Turns carry no author, so this participant's
  conversation with the simulated patient cannot be separated from their
  roommates'. Erasing it means erasing other people's data.

```bash
# 2. Then, and only then:
ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> --reason "Art. 17 request"
```

The run writes a **suppression record** at `erasures/`. ⚠️ **Do not delete
that record.** The nightly snapshots are not rewritten — they expire on their
own 90-day cycle — and the record is the only thing stopping a restore from
bringing the participant back. It must outlive the last snapshot that contains
them, which is up to 90 days after the erasure.

`scripts/restore-sessions.js` applies the list before writing, and refuses to
run if it cannot read it. Restore is likewise dry-run by default
(`RESTORE_CONFIRM=1` to write).

**Tell the requester what actually happened**, including the parts that did not:
the live platform is cleared immediately; backup copies are put beyond use and
expire within 90 days; and if their room used the simulated-patient chat, that
conversation cannot be separated out.

## 5. Rectification requests (GDPR Art. 16, APPI Art. 34)

```bash
node scripts/rectify-participant.js --uid <uid> --set name="Correct Name"
RECTIFY_CONFIRM=1 node scripts/rectify-participant.js --uid <uid> --set name="Correct Name"
```

Correctable fields are `name`, `university`, `year`, `english` — the values a
participant typed about themselves. **Answers are deliberately not correctable**:
Art. 16 is about factual accuracy, and rewriting someone's clinical reasoning
after the fact falsifies the record rather than correcting it.

The tool writes the pool entry and the roster together, so the two cannot end up
disagreeing. ⚠️ It will not CREATE a roster row — if a mistyped uid matches
nobody it does nothing, rather than inventing a participant with a name in it.

⚠️ **Tell the requester the archive is not rewritten.** Snapshots taken before
the correction still hold the old value and expire on their own 90-day cycle;
they are never used except to restore after an incident.

## 6. The data-rights deadline monitor

`Data-rights monitor` runs daily and **fails only when an erasure request has
passed the GDPR Art. 12(3) one-month limit**. A red run there is a real legal
deadline missed, not a flaky job — treat it as the highest-priority alert this
repository produces, and clear it by running the erasure tool in §4.

It warns in the log from day 21, so there is time to act before a breach. Its
output carries counts and ages only — **never a uid or a session code**, because
these logs are world-readable. Read the open requests from `withdrawals/` in the
database.

## 7. Document version

**v1 · 2026-05** — initial publication.

Subsequent versions tracked here with a change-log entry per material edit.
