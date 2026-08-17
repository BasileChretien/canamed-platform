/* tests/firebase-cli-pinning.test.js
 *
 * Two workflows drive the Firebase CLI: rules-e2e.yml (the emulator that is
 * one of only two things validating database.rules.json) and
 * firebase-deploy.yml (which ships hosting + database rules to PRODUCTION).
 * Both used to install it unpinned — `npm install --no-save firebase-tools`
 * and `npm install -g firebase-tools` — resolving the registry `latest` tag
 * on every run, with nothing locked beneath it.
 *
 * That exposure is not hypothetical. The four ops workflows failed on all five
 * days from 2026-07-31 to 2026-08-04 because @firebase/database-compat 2.1.5 —
 * a TRANSITIVE dependency, not the one anybody names — shipped a standalone
 * bundle that require()s a peer npm never installed. Nothing in this repo
 * changed, and the jobs recovered only when upstream reverted it in 2.1.6.
 * The long version lives in .github/workflows/cleanup-stale-sessions.yml.
 *
 * Note what that implies and why this file checks the LOCKFILE rather than a
 * version string: pinning `firebase-tools@x.y.z` alone would NOT have stopped
 * the analogous failure, because the break was underneath it. Only a committed
 * lockfile pins the whole tree.
 *
 * Both consumers now install from tools/firebase-cli — one package, one lock,
 * ~670 packages pinned by integrity hash, and deliberately OUT of the root
 * lock so the other CI jobs never pay for it. This test keeps it that way. The
 * regression is a one-line edit that reads like a simplification, and it would
 * go unnoticed until an upstream break reached production.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const DEPLOY = read(".github", "workflows", "firebase-deploy.yml");
const RULES = read(".github", "workflows", "rules-e2e.yml");
const PINNED_DIR = "tools/firebase-cli";

test("neither workflow installs firebase-tools unpinned", () => {
  for (const [name, wf] of [["firebase-deploy.yml", DEPLOY], ["rules-e2e.yml", RULES]]) {
    /* Match the executable `run:` line only. The files legitimately MENTION
       the old commands in comments explaining why they were replaced, so a
       bare substring search would fire on the documentation forever.
       Split on /\r?\n/, not "\n": these files are CRLF in a Windows checkout,
       and a control written with "\n" silently matches nothing — which reads
       as "the guard passed" rather than "the guard never ran". */
    const runLines = wf.split(/\r?\n/).filter((l) => /^\s*run:/.test(l));
    for (const line of runLines) {
      assert.ok(!/npm\s+install\s+-g\s+firebase-tools/.test(line),
        name + ": a GLOBAL firebase-tools install is unpinned — " + line.trim());
      assert.ok(!/npm\s+(install|i)\s+--no-save\s+firebase-tools/.test(line),
        name + ": a --no-save firebase-tools install is unpinned — " + line.trim());
    }
  }
});

test("both workflows install the CLI from the same pinned package", () => {
  for (const [name, wf] of [["firebase-deploy.yml", DEPLOY], ["rules-e2e.yml", RULES]]) {
    assert.ok(wf.includes("working-directory: " + PINNED_DIR),
      name + " must install the CLI from " + PINNED_DIR);
  }
  /* One pinned copy, not two that can drift apart: production and CI must
     validate against the SAME CLI build. */
  const dirs = new Set();
  for (const wf of [DEPLOY, RULES]) {
    for (const m of wf.matchAll(/working-directory:\s*(tools\/[^\s]+)/g)) dirs.add(m[1]);
  }
  assert.deepStrictEqual([...dirs], [PINNED_DIR],
    "both workflows must share one pinned CLI package, got: " + [...dirs].join(", "));
});

test("the deploy asserts WHICH cli it is about to ship with", () => {
  /* A wrong CLI on the production path must fail loudly, not silently. The
     deploy calls a bare `firebase`, which honours PATH — but `npx` does NOT
     (it checks local node_modules/.bin then the npm GLOBAL prefix and ignores
     PATH entirely), which is why the rules-E2E runner needs an explicit binary
     path instead. Measured 2026-08-17: pinned 15.27.0 first on PATH, and
     `npx firebase --version` still reported a global 15.19.0. */
  assert.match(DEPLOY, /GITHUB_PATH/,
    "the deploy must put the pinned CLI on PATH");
  assert.match(DEPLOY, /command -v firebase/,
    "the deploy must resolve `firebase` and check what it got");
  assert.match(DEPLOY, /exit 1/,
    "an unexpected CLI must FAIL the deploy, not just warn");

  const pathAt = DEPLOY.indexOf("GITHUB_PATH");
  const assertAt = DEPLOY.indexOf("command -v firebase");
  /* Locate the deploy STEP by its name, not by the string "firebase deploy":
     that phrase first appears at line 5 of this workflow, inside the header
     comment ("Manual `firebase deploy` from a developer machine continues to
     work"). indexOf finds the DOCUMENTATION, ~16 KB before the real step, and
     the ordering assertion then fails for a reason that has nothing to do with
     the ordering. Caught by this very test on its first run — the same
     comment-vs-executable-line trap the drift guard in CLAUDE.md hit. */
  const deployAt = DEPLOY.indexOf("- name: Deploy hosting");
  assert.ok(pathAt > 0 && assertAt > 0 && deployAt > 0,
    "locator stale: PATH export / assertion / deploy step not all found");
  assert.ok(pathAt < assertAt && assertAt < deployAt,
    "the assertion must run AFTER the PATH export and BEFORE anything ships");
});

test("the pinned CLI is pinned by a committed lockfile, not just a range", () => {
  const pkg = JSON.parse(read("tools", "firebase-cli", "package.json"));
  assert.ok(pkg.dependencies && pkg.dependencies["firebase-tools"],
    "tools/firebase-cli must declare firebase-tools");

  const lock = JSON.parse(read("tools", "firebase-cli", "package-lock.json"));
  const entry = lock.packages && lock.packages["node_modules/firebase-tools"];
  assert.ok(entry && entry.version,
    "firebase-tools must appear in the committed lockfile");
  assert.ok(entry.integrity || entry.resolved,
    "the locked entry must carry integrity/resolved");

  /* The point of the separate package: the CLI's tree must NOT be in the root
     lock, or every `npm ci` in CI — all 8 E2E matrix jobs included — installs
     it. If this ever fails, someone "simplified" it into the root. */
  const rootLock = JSON.parse(read("package-lock.json"));
  assert.ok(!rootLock.packages["node_modules/firebase-tools"],
    "firebase-tools must stay OUT of the root lock (it is ~670 packages that " +
    "only the rules-E2E and deploy jobs need)");
});
