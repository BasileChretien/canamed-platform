# Security Policy

The CaNaMED platform handles student personal data (names, university,
year of study, self-reported English level, free-text answers about
clinically sensitive topics) under GDPR (France) and APPI (Japan). We
take security reports seriously.

## Reporting a vulnerability

**Please do not file public issues for security problems.**

Email a single message to **`canamed-security@unicaen.fr`** with:

- A short description of the vulnerability
- Steps to reproduce
- Impact assessment
- Your preferred attribution (or anonymous)

## Response targets

- **Acknowledge** within 5 working days
- **First triage + severity rating** within 10 working days
- **Resolution or mitigation plan** within 90 days for High/Critical,
  180 days for Medium

## Scope

**In scope:**

- The Firebase Hosting deployment at `canamed-69785.web.app`
- The Realtime Database rules at
  `docs/Third_session/PBL_platform/database.rules.json`
- The auth and session lifecycle in
  `docs/Third_session/PBL_platform/script.js`
- The CSP and hosting headers in
  `docs/Third_session/PBL_platform/firebase.json`

**Out of scope:**

- Issues only reproducible on the local dev server
  (`scripts/serve-platform.js`)
- DoS / volumetric attacks
- Findings in third-party services (Firebase, Google reCAPTCHA) -
  please report those directly to the vendor

## Safe harbour

We will not pursue legal action against good-faith research that:

- Stops at the first evidence of access (no pivot, no persistence)
- Does not exfiltrate user data beyond the minimum needed to demonstrate
  the issue
- Does not interact with workshops in progress (visible via active
  session codes on the dashboard)
- Notifies us at the first reasonable opportunity

We commit to public credit (release notes, CVE if applicable) unless
the reporter prefers to stay anonymous.

## Full policy

For the full disclosure protocol, contact details, PGP key placeholder,
and the ops posture around live sessions, see
[`docs/Third_session/PBL_platform/ARCHITECTURE/OPERATOR_POLICY.md`](docs/Third_session/PBL_platform/ARCHITECTURE/OPERATOR_POLICY.md)
section 1 (Responsible disclosure / coordinated vulnerability
disclosure).
