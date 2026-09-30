/* tests/dependabot-update-next.test.js
 *
 * main's branch protection is strict: a PR must be up to date with main to
 * merge. Dependabot opens its PRs in batches, so the first one to merge
 * leaves the rest BEHIND. Auto-merge then waits forever, because Dependabot
 * rebases only on conflicts, not when a branch is merely behind. On
 * 2026-09-28 four PRs opened together; #416 merged and #415, #417 and #418
 * sat behind for two days until someone clicked "Update branch" on each.
 *
 * dependabot-update-next.yml runs on every push to main and updates ONE
 * behind Dependabot PR, the oldest, with the GitHub App token. A GITHUB_TOKEN
 * push starts no CI, so an update made with it would leave the PR up to date
 * and blocked. When that PR merges, its push re-triggers the workflow for the
 * next one. These tests pin the selection logic and the token handling.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  summarise,
  pickNext,
  run: updateNext,
  gh: ghCli,
} = require("../scripts/ops/dependabot-update-next.js");

/* ── summarise: raw `gh pr list` rows → the facts pickNext reads ─────────── */

const row = (over = {}) => ({
  number: 1,
  createdAt: "2026-09-28T04:32:00Z",
  autoMergeRequest: { mergeMethod: "SQUASH" },
  isDraft: false,
  mergeable: "MERGEABLE",
  headRefOid: "abc",
  baseRefName: "main",
  statusCheckRollup: [],
  ...over,
});

test("summarise reads check runs and legacy status contexts alike", () => {
  const f = summarise(row({
    statusCheckRollup: [
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "StatusContext", state: "PENDING" },
    ],
  }), 2);
  assert.deepStrictEqual(
    { autoMerge: f.autoMerge, pending: f.pending, failing: f.failing, behindBy: f.behindBy },
    { autoMerge: true, pending: true, failing: false, behindBy: 2 }
  );

  assert.strictEqual(summarise(row({ statusCheckRollup: [{ status: "IN_PROGRESS" }] }), 0).pending, true);
  for (const bad of [{ conclusion: "FAILURE" }, { conclusion: "TIMED_OUT" }, { conclusion: "CANCELLED" }, { state: "ERROR" }]) {
    assert.strictEqual(summarise(row({ statusCheckRollup: [{ status: "COMPLETED", ...bad }] }), 1).failing, true,
      JSON.stringify(bad) + " should count as failing");
  }
  assert.strictEqual(summarise(row({ autoMergeRequest: null }), 1).autoMerge, false);
  assert.strictEqual(summarise(row({ mergeable: "CONFLICTING" }), 1).conflicting, true);
  assert.strictEqual(summarise(row({ statusCheckRollup: null }), 1).pending, false);
});

/* ── pickNext: which PR, if any, to update ─────────────────────────────── */

const fact = (number, over = {}) => ({
  number,
  createdAt: "2026-09-28T04:32:0" + number + "Z",
  autoMerge: true,
  draft: false,
  conflicting: false,
  failing: false,
  pending: false,
  behindBy: 1,
  ...over,
});

test("queues behind PRs oldest first", () => {
  const plan = pickNext([fact(3), fact(1), fact(2)]);
  assert.strictEqual(plan.inFlight, null);
  assert.deepStrictEqual(plan.queue, [1, 2, 3]);
});

test("waits while an up-to-date Dependabot PR is still running CI", () => {
  /* Updating a second one now would only make the two race: whichever
     merges first puts the other behind again and wastes its whole run. */
  const plan = pickNext([fact(1), fact(2, { behindBy: 0, pending: true })]);
  assert.strictEqual(plan.inFlight, 2);
  assert.deepStrictEqual(plan.queue, []);
});

test("an up-to-date PR with no running checks does not hold up the queue", () => {
  const plan = pickNext([fact(1), fact(2, { behindBy: 0, pending: false })]);
  assert.strictEqual(plan.inFlight, null);
  assert.deepStrictEqual(plan.queue, [1]);
});

test("leaves PRs a human has to look at", () => {
  const plan = pickNext([
    fact(1, { autoMerge: false }),   // npm semver-major: held for review
    fact(2, { draft: true }),
    fact(3, { conflicting: true }),  // Dependabot rebases conflicts itself
    fact(4, { failing: true }),      // would fail again on every push
    fact(5),
  ]);
  assert.deepStrictEqual(plan.queue, [5]);
});

test("nothing behind, nothing to do", () => {
  assert.deepStrictEqual(pickNext([fact(1, { behindBy: 0 })]), { inFlight: null, queue: [] });
  assert.deepStrictEqual(pickNext([]), { inFlight: null, queue: [] });
});

/* ── run: the gh calls, with a fake gh ─────────────────────────────────── */

function fakeGh(rows, behind, { failUpdate = [] } = {}) {
  const calls = [];
  const gh = (args, opts = {}) => {
    calls.push((opts.write ? "WRITE " : "") + args.join(" "));
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify(rows);
    if (args[0] === "api") {
      const sha = args[1].split("...")[1];
      return String(behind[sha]) + "\n";
    }
    if (args[0] === "pr" && args[1] === "update-branch") {
      if (failUpdate.includes(Number(args[2]))) throw new Error("refusing to allow a GitHub App to create or update workflow");
      return "";
    }
    throw new Error("unexpected gh call: " + args.join(" "));
  };
  return { gh, calls };
}

const quiet = { log() {}, warn() {} };

test("updates only the oldest behind PR", () => {
  const rows = [
    row({ number: 418, createdAt: "2026-09-28T04:32:41Z", headRefOid: "c" }),
    row({ number: 415, createdAt: "2026-09-28T04:32:26Z", headRefOid: "a" }),
    row({ number: 417, createdAt: "2026-09-28T04:32:35Z", headRefOid: "b" }),
  ];
  const { gh, calls } = fakeGh(rows, { a: 3, b: 3, c: 3 });
  const updated = updateNext({ repo: "o/r", gh, ...quiet });
  assert.strictEqual(updated, 415);
  /* The update, and only the update, goes out on the App token. */
  assert.deepStrictEqual(calls.filter((c) => c.includes("update-branch")), ["WRITE pr update-branch 415 --repo o/r"]);
  assert.deepStrictEqual(calls.filter((c) => c.startsWith("WRITE")), ["WRITE pr update-branch 415 --repo o/r"]);
  assert.ok(calls.some((c) => c === "api repos/o/r/compare/main...a --jq .behind_by"));
  assert.ok(calls[0].includes("--author app/dependabot"), calls[0]);
});

test("a refused update falls through to the next PR, with a warning", () => {
  const rows = [
    row({ number: 1, createdAt: "2026-09-28T01:00:00Z", headRefOid: "a" }),
    row({ number: 2, createdAt: "2026-09-28T02:00:00Z", headRefOid: "b" }),
  ];
  const { gh } = fakeGh(rows, { a: 1, b: 1 }, { failUpdate: [1] });
  const warnings = [];
  const updated = updateNext({ repo: "o/r", gh, log() {}, warn: (m) => warnings.push(m) });
  assert.strictEqual(updated, 2);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /#1/);
});

test("makes no update while one is in flight", () => {
  const rows = [
    row({ number: 1, headRefOid: "a" }),
    row({ number: 2, headRefOid: "b", statusCheckRollup: [{ status: "IN_PROGRESS" }] }),
  ];
  const { gh, calls } = fakeGh(rows, { a: 2, b: 0 });
  assert.strictEqual(updateNext({ repo: "o/r", gh, ...quiet }), null);
  assert.ok(!calls.some((c) => c.includes("update-branch")));
});

test("the real gh helper refuses to update without UPDATE_TOKEN", () => {
  const saved = process.env.UPDATE_TOKEN;
  delete process.env.UPDATE_TOKEN;
  try {
    assert.throws(() => ghCli(["pr", "update-branch", "1"], { write: true }), /UPDATE_TOKEN is not set/);
  } finally {
    if (saved !== undefined) process.env.UPDATE_TOKEN = saved;
  }
});

/* ── the workflow ──────────────────────────────────────────────────────── */

const WF = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "dependabot-update-next.yml"), "utf8");
/* CRLF in a Windows checkout: split on /\r?\n/ or the guards match nothing. */
const CODE = WF.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");

test("workflow: runs on every push to main, one run at a time", () => {
  assert.match(CODE, /on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(CODE, /concurrency:\s*\n\s+group:\s*dependabot-update-next\s*\n\s+cancel-in-progress:\s*false/);
});

test("workflow: updates with the App token and never with GITHUB_TOKEN", () => {
  /* A GITHUB_TOKEN push to the PR branch starts no CI: the PR would sit up
     to date, with no checks, blocked. GITHUB_TOKEN only reads. */
  assert.match(CODE, /UPDATE_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\}\}/);
  assert.doesNotMatch(CODE, /UPDATE_TOKEN:.*GITHUB_TOKEN/);
  assert.match(CODE, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  const perms = CODE.slice(CODE.indexOf("\npermissions:"), CODE.indexOf("\nconcurrency:"));
  assert.doesNotMatch(perms, /write/, "the job token must stay read-only");
  assert.match(CODE, /id:\s*app\b/);
  assert.match(CODE, /uses:\s*actions\/create-github-app-token@[0-9a-f]{40}\b/);
  assert.match(CODE, /client-id:\s*\$\{\{\s*secrets\.AUTOMERGE_APP_CLIENT_ID\s*\}\}/);
  assert.match(CODE, /private-key:\s*\$\{\{\s*secrets\.AUTOMERGE_APP_PRIVATE_KEY\s*\}\}/);
  assert.match(CODE, /run:\s*node scripts\/ops\/dependabot-update-next\.js/);
});

test("workflow: without the App it does nothing, and says so", () => {
  assert.match(CODE, /HAS_APP:.*secrets\.AUTOMERGE_APP_CLIENT_ID != ''.*secrets\.AUTOMERGE_APP_PRIVATE_KEY != ''/);
  assert.match(CODE, /if:\s*env\.HAS_APP != 'true'[\s\S]*?::notice /);
  for (const step of ["Mint update token (GitHub App)", "Update the oldest behind Dependabot PR"]) {
    const at = CODE.indexOf("- name: " + step);
    assert.ok(at >= 0, "step not found: " + step);
    const body = CODE.slice(at, CODE.indexOf("- name:", at + 1) >>> 0);
    assert.match(body, /if:\s*env\.HAS_APP == 'true'/, step + " must be gated on the App");
  }
});
