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

## 4. Document version

**v1 · 2026-05** — initial publication.

Subsequent versions tracked here with a change-log entry per material edit.
