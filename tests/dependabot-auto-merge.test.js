/* tests/dependabot-auto-merge.test.js
 *
 * Dependabot PRs merged, but main's CI never ran on them. From #416 to #415
 * (2026-09-28 → 09-30) every Dependabot merge landed on main with no E2E, no
 * unit tests and no deploy run. The workflow enabled auto-merge with
 * GITHUB_TOKEN, so GitHub performed the merge as github-actions[bot], and
 * GitHub never starts a workflow from a push made with GITHUB_TOKEN. The
 * deploy is downstream of main's E2E run (firebase-deploy.yml), so a
 * Dependabot-only main also never shipped.
 *
 * Auto-merge now runs with a short-lived GitHub App token. Its merge is a
 * normal push, so main's push-triggered workflows run. These checks keep the
 * workflow from sliding back to GITHUB_TOKEN. That change would read like a
 * simplification and fail silently: nothing goes red, main just stops
 * getting CI.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WF = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "dependabot-auto-merge.yml"),
  "utf8"
);
/* CRLF in a Windows checkout: split on /\r?\n/ or the guards match nothing. */
const LINES = WF.split(/\r?\n/);
const code = LINES.filter((l) => !/^\s*#/.test(l)).join("\n");

/* The body of one step, from its `- name:` line to the next step. */
function step(name) {
  const start = LINES.findIndex((l) => l.trim() === "- name: " + name);
  assert.ok(start >= 0, "step not found: " + name);
  const indent = LINES[start].indexOf("-");
  let end = start + 1;
  while (end < LINES.length) {
    const l = LINES[end];
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    end++;
  }
  return LINES.slice(start, end).filter((l) => !/^\s*#/.test(l)).join("\n");
}

test("auto-merge is enabled with the App token, GITHUB_TOKEN only as fallback", () => {
  const s = step("Enable auto-merge");
  assert.match(s, /gh pr merge --auto --squash/);
  assert.match(s, /GH_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}/,
    "GH_TOKEN must prefer the App token — a GITHUB_TOKEN merge starts no workflows on main");
});

test("the App token can merge workflow-file bumps", () => {
  const s = step("Mint merge token (GitHub App)");
  assert.match(s, /uses:\s*actions\/create-github-app-token@v\d+/);
  assert.match(s, /permission-contents:\s*write/);
  assert.match(s, /permission-pull-requests:\s*write/);
  /* github-actions ecosystem bumps edit .github/workflows/*; merging those
     needs `workflows: write`, which GITHUB_TOKEN can never have. */
  assert.match(s, /permission-workflows:\s*write/);
  assert.match(s, /if:\s*env\.HAS_APP == 'true'/);
});

test("missing App secrets degrade to the old behaviour, loudly", () => {
  const s = step("Warn that main CI will not run for this merge");
  assert.match(s, /if:\s*env\.HAS_APP != 'true'/);
  assert.match(s, /::warning /);
});

test("runs only for Dependabot's own events", () => {
  /* Dependabot's events read the Dependabot secrets store, where the App key
     lives. A maintainer's "Update branch" fires pull_request too, but reads
     the Actions store, so it would fall back to GITHUB_TOKEN and re-enable
     auto-merge as github-actions, undoing the fix. Auto-merge survives a
     branch update, so skipping that run loses nothing. */
  assert.match(code, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(code, /github\.actor == 'dependabot\[bot\]'/);
});
