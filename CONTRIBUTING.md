# Contributing to CaNaMED

Thanks for your interest in contributing. CaNaMED is a medical-education
research collaboration between Université de Caen Normandie and Nagoya
University; the codebase is the platform that runs the Franco-Japanese
problem-based-learning (PBL) workshops plus the analysis pipelines that
process the resulting research data.

This document explains how to set up a development environment, run the
tests, propose changes, and add new clinical content or language support.

If anything below is unclear, please open a discussion or an issue.

---

## Getting set up

### Prerequisites

- **Node.js 20+** — the test suite, the local dev server, and the Playwright
  end-to-end tests all assume Node 20 (matches CI).
- **Git** — for clone, branch, commit, push.
- **A modern browser** — Chromium, Firefox or WebKit for E2E runs.
- (Optional) **R + RStudio** — only if you want to run the research-analysis
  pipelines under `scripts/0*.R`. Not required for platform development.
- (Optional) **Python 3.10+** — only for `scripts/_gen_session3_docs.py`.

### Install

```bash
git clone https://github.com/<your-fork>/CANAMED.git
cd CANAMED
npm install
npx playwright install --with-deps
```

`npm install` pulls only dev-dependencies (Playwright, axe-core, c8 coverage).
The platform itself has **no runtime npm dependencies** — it is vanilla
HTML/CSS/JS served as static files. The npm setup is purely for testing.

### Run the platform locally

```bash
npm run serve:platform
```

This starts `scripts/serve-platform.js`, a tiny static server with the same
security headers (CSP, COOP, etc.) the production Firebase deployment ships.
Open the URL it prints (typically `http://localhost:8080/`). The first time
you load it, you will be in **local test mode** — no Firebase connection is
required and data persists to `localStorage`, syncing across tabs of the
same browser. Use the super-admin key `test` to open the dashboard.

To test against a real Firebase project, populate `firebase-config.js` (see
[`docs/Third_session/PBL_platform/README.md`](docs/Third_session/PBL_platform/README.md#enabling-shared-mode-free--no-server-no-credit-card)).
Never commit a populated `firebase-config.js` to a fork that will be
published — that file ships as part of the live deployment.

### Run the tests

```bash
# Unit tests (Node's built-in test runner)
npm test

# Unit tests with coverage report (HTML in coverage/)
npm run test:coverage

# End-to-end tests (Playwright)
npx playwright test
# or with a live UI:
npm run test:e2e:ui
```

All tests run in CI on every push; please make sure both `npm test` and
`npx playwright test` pass locally before opening a PR. CI runs Playwright
against Chromium, Firefox and WebKit — on a typical contribution you only
need to verify Chromium locally, but if a PR touches layout or focus
management, please run all three browsers.

---

## Branching and commits

### Branch names

We use short prefixed branch names that describe the change:

| Prefix | When to use | Example |
|---|---|---|
| `feat/` | A new user-visible feature | `feat/scenario-import-export` |
| `fix/` | A bug fix | `fix/late-join-room-balance` |
| `docs/` | Docs-only changes | `docs/runbook-rotation` |
| `chore/` | Tooling, refactors, no behaviour change | `chore/bump-playwright` |
| `test/` | Tests-only changes | `test/votes-tie-break` |
| `sec/` | Security hardening | `sec/csp-tighten` |
| `ops/` | Infra / CI / workflow changes | `ops/cleanup-cron` |
| `a11y/` | Accessibility fixes | `a11y/focus-ring-contrast` |
| `i18n/` | Localisation work | `i18n/portuguese-strings` |

Branch off `main` and keep your branch up to date as you go (rebase or
merge, whichever your team prefers; CI is fine with either).

### Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative summary>

<optional body — what changed and why>
<optional body — references, breaking-change notes>
```

Types we use, with the same meaning as the branch prefixes above: `feat`,
`fix`, `docs`, `chore`, `test`, `sec`, `ops`, `a11y`, `i18n`, `refactor`,
`perf`, `ci`.

Examples from the history:

```
feat(scenarios): author Antibiotic Stewardship scenario (3rd clinical case)
fix(late-join): keep cohort balance when a student joins after start
docs(privacy): fill in DPO + ethics committee placeholders
sec(rules): tighten admin password write rule
```

Keep the summary line under 72 characters. The body is optional but
encouraged for anything more than a trivial change — explain the *why*,
not just the *what*. The repo's git log is part of the documentation.

---

## Pull request workflow

1. **Open a draft PR early** if you want feedback on direction.
2. **Fill in the PR template** (auto-loaded from `.github/pull_request_template.md`).
3. **Ensure CI is green** — the `test`, `e2e`, `cost-monitor` and (where
   relevant) `firebase-deploy` workflows must pass.
4. **Rebase or merge `main`** so your branch is up to date with the target.
5. **Request review** — at least one reviewer from the core team. For
   security- or ethics-touching changes, please tag both the engineering
   lead and the PI for the relevant cohort.
6. **Address review comments** by pushing new commits to the same branch;
   we squash-merge on landing, so commit count in the PR does not matter.

### PR checklist (also in the template)

- [ ] Tests added or updated for the change
- [ ] `npm test` passes locally
- [ ] `npx playwright test` passes locally (or CI green)
- [ ] No new lint / coverage regressions
- [ ] Docs updated (README, runbook, or in-code comments) if behaviour
      changes
- [ ] If the change touches privacy, security, or scoring rules, the PI
      or DPO has been pinged
- [ ] Branch is up to date with `main`

---

## How to add a new clinical scenario

CaNaMED separates **engine** (`script.js` — partnership- and case-agnostic)
from **content** (`case-content.js` — the actual clinical case). New
scenarios are added to the `CANAMED_SCENARIOS` registry as fully
self-contained content packs. Each pack describes the case, the scoring
families, penalties, and team-decision votes.

The easiest path for non-developers:

1. Open the **Scenario Author** tool — `docs/Third_session/PBL_platform/scenario-author.html`
   (open the file in a browser, or via `npm run serve:platform`).
2. Start from a built-in template (the existing chronic-pain case or the
   antibiotic-stewardship case).
3. Edit the cliniical metadata, the questions/findings, the scoring
   families, the penalties, and the team-decision prompts in the form.
4. Validate and download as JSON.
5. Either paste the JSON into the in-app *"Create new content (advanced)"*
   field at facilitator-create time (no code change), **or** open a PR
   that adds the scenario as a new key in `CANAMED_SCENARIOS` so it
   becomes a built-in.

When opening a PR for a new built-in scenario, please also:

- Add an end-to-end smoke test under `tests-e2e/` that loads the scenario
  and walks through the milestones.
- Update `docs/Third_session/PBL_platform/README.md` *"Built-in scenarios"*
  section to mention the new scenario.
- Use the **Scenario Proposal** issue template
  (`.github/ISSUE_TEMPLATE/scenario_proposal.md`) to draft the learning
  objectives and scoring criteria *before* the PR — that helps the
  curriculum reviewers approve direction without re-reading the JSON.

---

## How to add a new language

The platform is internationalised through `docs/Third_session/PBL_platform/i18n.js`
which exports a string table keyed by language code. To add a language:

1. Open `i18n.js` and copy an existing language block (English is the
   reference). Translate every key.
2. Add the new language to the dropdown in `index.html` (search for the
   existing language `<option>` entries).
3. Update the language-detection regex in `i18n.js` (and the matching
   regex in `tests/i18n.test.js`) so the new code is recognised when the
   browser advertises it.
4. Run `npm test` and verify the new language passes the i18n unit tests.
5. Add a sample-content translation for the **lobby + welcome stage** as
   the minimum bar; deeper content (Module A case text) can be added in
   follow-up PRs.

A PR that adds a new language should include all of the above in one
commit, and tag a native speaker for review if you are not one yourself.

---

## Reporting bugs and asking questions

- **Bug reports** — use the *Bug report* issue template. Include the
  session code (if reproducible against a live session), browser + OS,
  what you tried, what happened, what you expected.
- **Feature requests** — use the *Feature request* issue template. What
  problem are you trying to solve, and what would success look like?
- **Scenario proposals** — use the *Scenario proposal* issue template
  before opening a content PR.
- **Security vulnerabilities** — please **do not** file a public issue.
  See [`SECURITY.md`](SECURITY.md) for the responsible-disclosure flow.
- **General questions** — open a GitHub Discussion, or email the team
  contact listed in the platform README.

---

## Code style

We follow the project's existing style (vanilla JS, no transpilation, no
framework). A few guidelines:

- **Small modules over large ones** — keep files under ~800 lines.
- **Pure helpers in `lib.js`** — anything that does not touch the DOM or
  the database belongs there and should be unit-tested.
- **Functions under ~50 lines** — extract if longer.
- **Immutable updates** by default — prefer building a new object over
  mutating an existing one.
- **Explicit error handling** — no silent catches; either handle the
  error or let it bubble.
- **No hard-coded secrets** — anything secret lives in
  `firebase-config.js` (gitignored when populated) or a GitHub secret.

---

## Code of conduct

Participating in this project means agreeing to the
[Code of Conduct](CODE_OF_CONDUCT.md). It is a standard Contributor
Covenant; the short version is *be kind, assume good faith, and report
problems to* `canamed-ethics@unicaen.fr`.

---

## Licence

By contributing you agree that your contributions will be licensed under
the [MIT License](LICENSE) that covers this project.
