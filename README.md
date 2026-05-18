# CaNaMED Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-Contributor%20Covenant%202.1-blue.svg)](CODE_OF_CONDUCT.md)

Open-source single-page web platform for running **cross-cultural,
problem-based-learning (PBL) workshops in clinical communication**. Pairs
students from two (or more) medical schools into shared online rooms,
walks them through a clinical case + a roleplay + structured team
decisions, and records anonymisable contributions for downstream
education-research analysis.

Originally built for the Franco-Japanese **CaNaMED** project
(Université de Caen Normandie × Nagoya University); released as a
standalone platform so any medical-school partnership can adopt or
fork it.

**Reference live deployment:** [https://canamed-69785.web.app](https://canamed-69785.web.app)

---

## Fork this for your own partnership

The engine (`script.js`, `lib.js`) is partnership- and case-agnostic;
the content (`case-content.js`, scenario JSON), branding, and language
packs are the parts you swap.

To adapt the platform for a different partnership:

1. **Fork the repo** on GitHub.
2. **Edit `docs/Third_session/PBL_platform/platform-config.js`** —
   partnership name, university list, default language, branding colours.
3. **Add your scenario(s)** via the in-app scenario author tool
   (`docs/Third_session/PBL_platform/scenario-author.html`) or by
   editing `case-content.js` / `CANAMED_SCENARIOS` directly. See
   [CONTRIBUTING.md](CONTRIBUTING.md) for the full path.
4. **Add language packs** if your students don't share English — edit
   `docs/Third_session/PBL_platform/i18n.js` (instructions in CONTRIBUTING).
5. **Configure your own Firebase project** (free Spark plan is enough
   for single sessions) — drop your credentials into a local
   `firebase-config.js` and deploy. Hosting + database rules are in
   the repo; the GitHub Actions deploy workflow needs your project's
   service-account secret.
6. **Review the ethics + privacy posture** in `SECURITY.md` and in
   `docs/Third_session/PBL_platform/ARCHITECTURE/OPERATOR_POLICY.md`
   — both will need to be adapted to your institutions' data
   protection regimes (GDPR, APPI, HIPAA, your local IRB).

Contributions welcome — bug fixes, new scenarios, new language packs,
accessibility improvements. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the development workflow and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
for community norms. Security issues: see [SECURITY.md](SECURITY.md).

---

## What's in this repo

| Path | What it is |
|---|---|
| **`docs/Third_session/PBL_platform/`** | The single-page web platform. Vanilla HTML/CSS/JS, Firebase Realtime Database, no build step. **Live at the URL above.** See its own [README](docs/Third_session/PBL_platform/README.md) for setup. |
| **`tests/`** | Node-based unit + Firebase-rules tests (run with `npm test`). |
| **`tests-e2e/`** | Playwright end-to-end suite — splash, lobby, mobile, a11y, perf, i18n, cross-tab coordination. |
| **`scripts/`** | Operational helpers: local dev server, synthetic-uptime probe, cost monitor, daily backup, stale-session cleanup, pseudonymisation export. |
| **`.github/workflows/`** | CI/CD — test, e2e matrix, firebase-deploy, synthetic-uptime, cost-monitor, backup, cleanup. |

> **Note on the path `docs/Third_session/`** — this is a historical
> artefact from the original CaNaMED research repo where the platform
> was built during the project's third workshop cycle. The structure is
> preserved so all internal references keep working; a future PR may
> flatten it.

The original research data, R analysis pipeline, and curriculum
materials live in a **separate private repository** held by the CaNaMED
research team; only the platform code is open-sourced here.

---

## Quick start by role

### I'm a **student** joining a workshop
Open the operator's URL (the reference deployment is
[https://canamed-69785.web.app](https://canamed-69785.web.app)), type
the session code your facilitator gave you, fill in your name +
university + year + English level. That's it. Everything runs in the
browser.

### I'm a **facilitator** running a workshop
Same URL. Click "I'm a facilitator — create a session →", set a session
password, pick the scenario (or paste your own), and you get a code to
hand out. The admin dashboard tracks every room live; when you're done,
"End session & download archive" exports the whole session as JSON.

Detailed walkthrough:
[`docs/Third_session/PBL_platform/OPERATOR_QUICK_START.md`](docs/Third_session/PBL_platform/OPERATOR_QUICK_START.md).

### I'm a **developer** working on the platform
The whole app is in `docs/Third_session/PBL_platform/` — `index.html`,
`script.js`, `style.css`, `case-content.js`, `platform-config.js`,
`firebase-config.js`, `database.rules.json`. No `npm install` for the
app itself, no build step. Run the tests with:

```
npm install
npm test                # unit + rules
npm run e2e             # Playwright (set up browsers first: npx playwright install)
```

Local dev server: `node scripts/serve-platform.js` then open
http://localhost:8080.

Push to `main` and the firebase-deploy GitHub Action ships hosting +
database rules (requires `FIREBASE_SERVICE_ACCOUNT_CANAMED_69785`
secret configured for your fork).

---

## Operator privacy & ethics

This platform is designed for live use with student participants who
will provide identifying data (name, university, year of study,
self-reported English level) and free-text answers. **Every operator
deploying this platform** is responsible for:

- **Notice + consent** — the in-app lobby shows a "How your data is
  used" panel before any join; align it with what students are told
  verbally and with your institution's IRB-approved consent text.
- **Privacy policy** — the bundled `privacy.html` / `privacy-fr.html` /
  `privacy-ja.html` are **templates with placeholders** for
  operator-specific values (postal addresses, DPO email, retention
  period, complaint authority). Fill these BEFORE first live use.
- **Storage** — Firebase Realtime Database (Google Cloud) + per-device
  `localStorage`. Pick a region appropriate to your jurisdiction.
- **Retention** — there is no automatic deletion. Purge each session
  after the workshop (super-admin "Purge this session's data" button in
  the dashboard, or delete `sessions/{code}` from the Firebase console).
- **Pseudonymisation** — when exporting group answers, the admin can
  tick **"Anonymise names in export"** to pseudonymise students per
  room (Student A, Student B, …).
- **Right to be forgotten** — students who sign in with Google can
  delete their account from the "My account" panel.

See `docs/Third_session/PBL_platform/ARCHITECTURE/OPERATOR_POLICY.md`
for the full operator obligations.

---

## License

MIT — see [LICENSE](LICENSE).
