# cnm-pp — CaNaMED PBL platform

Franco-Japanese medical-education roleplay/PBL platform (Université de Caen
Normandie × Nagoya University). Static SPA (HTML/CSS/vanilla JS) on Firebase
Hosting + Realtime Database + anonymous Auth + App Check (reCAPTCHA v3).

This file holds only what stays true across sessions. Status, findings and the
stories behind the rules live in the docs below and in git history.

## Where things are

- `docs/STATUS.md`: operational status and reminders (billing, deploys, App
  Check, the LLM patient, retention, erasure), Round-3 items 0–5. Read it
  before any deploy, Console, billing or data-retention work.
- `docs/security-follow-ups.md`: security findings, open and closed, each with
  a `Verify:` hint. Read the relevant entry before touching
  `database.rules.json` or a finding's area.
- `docs/scenario-characters.md`: scenario personas, the multi-character
  switchboard, per-slot chat. Read it before authoring scenarios or editing
  Module A chat.
- Platform: `docs/Third_session/PBL_platform/` (`index.html`, `script.js`,
  `style.css`, `case-content.js`, `glossary.js`, `i18n.js`, `tour.js`,
  `database.rules.json`, `firebase.json`). Everything served lives here, so a
  pathspec written from the repo root matches nothing.
- LLM proxy: `proxy/`. Tests: `tests/` (unit), `tests-e2e/` (Playwright),
  `tests-e2e/emulator/` (rules suite).
- Older comments that say "see CLAUDE.md" for a status or a finding now mean
  `docs/STATUS.md` or `docs/security-follow-ups.md`.

## Current state (verify before relying on it)

- **Spark (free) plan since 2026-08-27; billing closed.** Cloud Functions and
  Cloud Storage cannot deploy. Do not propose `firebase deploy --only
  functions` or GCS work unless the user restores Blaze.
- **The LLM patient runs on `proxy/`** (Scaleway fr-par,
  `meta-llama/Llama-3.3-70B-Instruct`), not on `functions/`.
- **App Check is in Monitor, and reCAPTCHA is consent-gated with no UI to give
  consent**, so no client mints a token. Switching RTDB to Enforce would
  reject all traffic: build the consent affordance first.
- **The strict withdrawal rule is off** until an operator runs
  `backfill-purged-markers.js`.
- Open security items and deploys awaiting confirmation: see
  `docs/security-follow-ups.md`.

## Commands

- `npm run test`: unit tests (`node --test tests/*.test.js`).
- `npm run emulator`: Firebase RTDB+Auth emulator (needs Java on PATH).
- `npm run sim:emulator`: headless cross-tab persona sim against the emulator.
- `npm run test:e2e:rules`: emulator-backed Playwright rules suite (via
  `scripts/ops/run-rules-e2e.js`). With `sim:emulator`, the only runs that
  exercise `database.rules.json`.
- `npx playwright test`: E2E suite in LOCAL mode (hermetic, no Firebase, never
  touches the rules). Projects: chromium/firefox/webkit, perf, a11y,
  mobile-iphone/ipad/android.

### Emulator and Playwright

- **One rules-suite or `sim:emulator` run per machine at a time.** Ports 4400,
  9000 and 9099 are fixed and shared by every checkout and worktree. Check
  `node scripts/ops/emulator-ports.js check 4400 9000 9099` first. On "ANOTHER
  RUN HOLDS THE EMULATOR PORTS", or if the hub falls back to 4401, wait for the
  other run; do not retry in a loop.
- A held port may be another session's live emulator. `npm run emulator:free`
  kills by port: use it only when you know the listener is stale
  (`npm run emulator:ports` names it).
- The runner's sweep kills by process lineage, never by port
  (`scripts/ops/process-lineage.js`). Keep it so: `node --test
  tests/emulator-sweep-lineage.test.js tests/process-lineage.test.js
  tests/emulator-runner-signal.test.js tests/sim-launcher-run.test.js`.
- The emulator runs the GENERATED `database.rules.emulator.json`. Before any
  hand-rolled `firebase emulators:exec`, run `node
  scripts/sim/build-emulator-rules.js` and check the gate is in that file.
- Pass an explicit `PORT=` to Playwright (e.g. `PORT=8771`): 8765 is
  AnkiConnect on this machine, and `reuseExistingServer` latches onto it.
- Run `webkit`, `mobile-iphone` and `mobile-ipad` with `--workers=1`; all three
  hang at 2.

## Standing instructions

### Claims and PRs

- **STATUS-CLAIM RULE.** Status labels in `docs/STATUS.md`,
  `docs/security-follow-ups.md` and any inline ✅/DONE note can be stale.
  Never relay one without confirming it from the code or the live system
  (items carry a `Verify:` hint). If a label is wrong, fix it in the same turn;
  when work resolves an item, update its label in the same commit.
- **A green Deploy does not mean the rules shipped** (the step is
  `continue-on-error`). Only `gh run view <run> --log | grep -F 'released
  successfully'`, on the first non-skipped Deploy run whose commit contains the
  merge, proves it. `Database rules deployed` is printed either way.
- **A fix lands in up to three places**: the rules (released), the shell
  (`SHELL_VERSION` served live by `sw.js`) and scheduled jobs (next run). Say
  which are live; never date an exposure as ended from the Hosting deploy alone.
- **Re-verify a PR before repeating "it's green".** Re-run `gh pr view <n>
  --json commits,statusCheckRollup,mergeStateStatus` and read the commit list.
  If a finished PR gained unfinished commits, move the finished ones to a fresh
  branch off `main` and retitle the original **WIP — DO NOT MERGE**.
- **A failed `gh pr merge` is not evidence the merge failed.** `main` is
  checked out in another worktree, so the local half fails after GitHub has
  merged. Check `gh pr view <n> --json state,mergeCommit,mergedAt` before
  retrying. `--delete-branch` did not run: `git push origin --delete <branch>`,
  then confirm with `git ls-remote --heads origin <branch>`.
- A `Verify:` line must tell the fixed state from the broken one; run it
  against both when you can. In Git Bash never use `curl -o /dev/null`
  (mingw64 curl exits 23).

### Shell version

- Any change to a file the cache-version machinery addresses bumps
  `SHELL_VERSION` FORWARD. Never reuse a number; a revert bumps forward too.
- After any rebase, re-check the bump against `origin/main`: an identical bump
  is absorbed silently. `tests/shell-version-bump.test.js` guards this when a
  merge base exists (CI must keep `fetch-depth: 0`). Then check what shipped:

  ```bash
  git fetch origin
  P=docs/Third_session/PBL_platform
  git diff --stat origin/main...HEAD -- $P/sw.js $P/script-loader.js $P/index.html
  expected=v141   # the version THIS change ships
  curl --fail --silent --show-error https://canamed-69785.web.app/sw.js \
    | grep -F "canamed-shell-$expected"
  ```

### Tests

- **Per-device tests for every UI change**: Playwright coverage for
  mobile-iphone, mobile-ipad, mobile-android and desktop.
- **A second page is not a second user** in the emulator suite: it shares the
  first page's anonymous session and `localStorage`. Use `browser.newContext()`
  for each extra participant and assert the uids differ.
- **Assert the DB value, then the DOM**, with `dbReadAsOwner()`
  (`tests-e2e/emulator/fixtures.js`). The owner bypass is for observation
  only; never settle an allow/deny verdict with it.
- **A denial is not evidence of a gate.** Pair every denial with an ALLOW of
  the same payload by an authorised identity. Keep payloads ASCII: the
  emulator drops backslash escapes in regex classes.
- **A conditional around an assertion tests nothing.** Assert the element
  exists instead.
- Fill fixtures with what the client actually writes, not markers. A walker
  over `.val()` output must treat arrays (integer keys) as maps.
- To fake a device clock, replace `Date` itself, not `Date.now()`.
- Quote constants, not prose: e.g. the perf cap is `grep
  FIRST_PARTY_BYTES_LIMIT_KB tests-e2e/perf.spec.js`.

### Database rules

- LOCAL E2E does not exercise the rules. Run the rules suite or the emulator
  sim locally before merging a rules change.
- `.read` cascades down and a deeper rule cannot revoke it. To make data
  private, move it out of the readable subtree.
- Do not write a node through `.transaction()` when its rule reads a node the
  client cannot read or has not cached. Read, then `set()`.
- Every path through a write must name `auth.uid`; write-once is not enough.
  Derive coverage lists from `database.rules.json`, never by hand.
- Before tightening a rule, list what a REFUSAL does to real flows: create,
  close, skewed clocks, a facilitator without a room claim.
- Edit the `sessions/` and `orgs/` trees together as pure re-prefixes
  (`tests/rule-tree-parity.test.js`; declare any asymmetry in `ASYMMETRIC`).
- Removal conditions are states, not dates (`legacyVerify()`, reset flags,
  export transform versions).

### Area rules

- `proxy/` imports its logic from `functions/lib/hf-helpers.js`, never copies
  it (`tests/llm-proxy.test.js`). Changing the proxy origin takes two edits:
  `CANAMED_LLM_PROXY` in `firebase-config.js` and CSP `connect-src` in
  `index.html`.
- An in-character reply does not prove the model answered: the stub is
  scenario-aware. Check the `provider` field. For "thinking but no reply",
  check `closed`, then the console for `permission_denied`, then the proxy.
- The platform sends no email. Do not add sending without asking.
- Bump `CONSENT_NOTICE_VERSION` in `script.js` with every PIS version; the
  anonymous-account cron, `ANON_CONFIRM` and `privacy.html` §8 change together.
- Never write free text into the `erasures/` ledger: `--reason` is a closed
  list.
- Ops workflows use `npm ci`, never floating installs. Never order events by
  timestamps from two machines.
- Do not write JS through Bash heredocs that contain backslashes; use
  Write/Edit, and scan changed files for control bytes before committing.
- Before pushing splash markup changes, run `splash-overflow.spec` on webkit
  and keep `<select>` option text short.
- **Deleting a long-lived UI control is an audit.** Grep its id across `*.js`,
  `*.html`, `tour.js` anchors and every spec, plus the globals it assigns and
  features that hang off its value. Expect the suite to find the rest.

## Keeping this file small

Stay under ~200 lines. Add a line here only if a session would get something
wrong without it, in every task. Status goes in `docs/STATUS.md`, findings in
`docs/security-follow-ups.md`, the story behind a rule in its commit message.
A PR edits this file to change a rule, not to record what the PR did.
