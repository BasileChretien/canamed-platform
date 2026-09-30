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
const SECRET_ID = "AUTOMERGE_APP_CLIENT_ID";
const SECRET_KEY = "AUTOMERGE_APP_PRIVATE_KEY";

/* Lines from `start` up to the next line indented no deeper than `start`,
   comments dropped: one step, or one multi-line key. */
function blockFrom(start) {
  const indent = LINES[start].search(/\S/);
  let end = start + 1;
  while (end < LINES.length) {
    const l = LINES[end];
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    end++;
  }
  return LINES.slice(start, end).filter((l) => !/^\s*#/.test(l)).join("\n");
}

function step(name) {
  const start = LINES.findIndex((l) => l.trim() === "- name: " + name);
  assert.ok(start >= 0, "step not found: " + name);
  return blockFrom(start);
}

/* A job-level key (4-space indent under `jobs.auto-merge`). */
function jobKey(key) {
  const start = LINES.findIndex((l) => l.startsWith("    " + key + ":"));
  assert.ok(start >= 0, "job key not found: " + key);
  return blockFrom(start);
}

test("auto-merge is enabled with the App token, GITHUB_TOKEN only as fallback", () => {
  const s = step("Enable auto-merge");
  assert.match(s, /gh pr merge --auto --squash/);
  assert.match(s, /GH_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}/,
    "GH_TOKEN must prefer the App token — a GITHUB_TOKEN merge starts no workflows on main");
  assert.match(s, /if:\s*steps\.policy\.outputs\.arm == 'true'/);
});

test("the token is minted by the step GH_TOKEN reads, from the secrets HAS_APP checks", () => {
  const s = step("Mint merge token (GitHub App)");
  /* Each of these silently empties the token, so GH_TOKEN falls back to
     GITHUB_TOKEN and main stops getting CI, with every other check green. */
  assert.match(s, /^\s*id:\s*app\s*$/m, "GH_TOKEN reads steps.app — the mint step must keep id: app");
  assert.match(s, new RegExp("client-id:\\s*\\$\\{\\{\\s*secrets\\." + SECRET_ID + "\\s*\\}\\}"));
  assert.match(s, new RegExp("private-key:\\s*\\$\\{\\{\\s*secrets\\." + SECRET_KEY + "\\s*\\}\\}"));
  assert.match(s, /if:\s*steps\.policy\.outputs\.arm == 'true' && env\.HAS_APP == 'true'/);

  const env = jobKey("env");
  assert.match(env, new RegExp("HAS_APP:.*secrets\\." + SECRET_ID + " != ''"));
  assert.match(env, new RegExp("HAS_APP:.*secrets\\." + SECRET_KEY + " != ''"));
});

test("the App token has the merge scopes and its action is pinned to a commit", () => {
  const s = step("Mint merge token (GitHub App)");
  /* This action receives the App private key: a moved tag could leak it. */
  assert.match(s, /uses:\s*actions\/create-github-app-token@[0-9a-f]{40}\b/);
  assert.match(s, /permission-contents:\s*write/);
  assert.match(s, /permission-pull-requests:\s*write/);
});

test("missing App secrets degrade to the old behaviour, loudly", () => {
  const s = step("Warn that main CI will not run for this merge");
  assert.match(s, /if:\s*steps\.policy\.outputs\.arm == 'true' && env\.HAS_APP != 'true'/);
  assert.match(s, /::warning /);
});

test("runs only for Dependabot's own events", () => {
  /* Dependabot's events read the Dependabot secrets store, where the App key
     lives. A maintainer's "Update branch" fires pull_request too, but reads
     the Actions store, so it would fall back to GITHUB_TOKEN and re-enable
     auto-merge as github-actions, undoing the fix. Auto-merge survives a
     branch update, so skipping that run loses nothing. */
  const cond = jobKey("if");
  assert.match(cond, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(cond, /github\.actor == 'dependabot\[bot\]'/);
  assert.match(cond, /&&/);
});

test("the workflow token keeps write scope (Dependabot runs default to read-only)", () => {
  const top = LINES.findIndex((l) => l === "permissions:");
  assert.ok(top >= 0, "top-level permissions block missing");
  const perms = blockFrom(top);
  assert.match(perms, /contents:\s*write/);
  assert.match(perms, /pull-requests:\s*write/);
});
