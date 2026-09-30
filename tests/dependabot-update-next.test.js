/* tests/dependabot-update-next.test.js
 *
 * main's branch protection is strict: a PR must be up to date with main to
 * merge. Dependabot opens its PRs in batches, so the first one to merge
 * leaves the rest BEHIND. Auto-merge then waits forever, because Dependabot
 * rebases only on conflicts, not when a branch is merely behind. On
 * 2026-09-28 four PRs opened together; #416 merged and #415, #417 and #418
 * sat behind for two days until someone clicked "Update branch" on each.
 *
 * dependabot-update-next.yml (on every push to main, and hourly) updates ONE
 * behind Dependabot PR, the oldest, with the GitHub App token. A GITHUB_TOKEN
 * push starts no CI, so an update made with it would leave the PR up to date
 * and blocked; the script checks that CI started. These tests pin the
 * selection, the token split, the failure handling and the workflow wiring.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  summarise, pickNext, classify, gh: ghCli, plan, update,
} = require("../scripts/ops/dependabot-update-next.js");

const NOW = Date.parse("2026-09-30T12:00:00Z");
const OLD = "2026-09-30T10:00:00Z";      // > 10 min before NOW
const RECENT = "2026-09-30T11:58:00Z";   // < 10 min before NOW

/* ── summarise ─────────────────────────────────────────────────────────── */

const row = (over = {}) => ({
  number: 1,
  author: { login: "app/dependabot", is_bot: true },
  createdAt: "2026-09-28T04:32:00Z",
  updatedAt: OLD,
  autoMergeRequest: { mergeMethod: "SQUASH" },
  isDraft: false,
  mergeable: "MERGEABLE",
  headRefOid: "abc",
  baseRefName: "main",
  statusCheckRollup: [],
  ...over,
});
const run = (status, conclusion = "") => ({ __typename: "CheckRun", status, conclusion });
const ctx = (state) => ({ __typename: "StatusContext", state });
const facts = (checks, over = {}) => summarise(row({ statusCheckRollup: checks, ...over }), 1, NOW);

test("summarise: check runs", () => {
  assert.strictEqual(facts([run("IN_PROGRESS")]).pending, true);
  assert.strictEqual(facts([run("QUEUED")]).pending, true);
  assert.strictEqual(facts([run("COMPLETED", "SUCCESS")]).pending, false);
  for (const c of ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]) {
    assert.strictEqual(facts([run("COMPLETED", c)]).failing, true, c + " is a failure");
  }
  /* The auto-merge job is SKIPPED on every App update; skipped is not failed. */
  for (const c of ["SUCCESS", "SKIPPED", "NEUTRAL"]) {
    assert.strictEqual(facts([run("COMPLETED", c)]).failing, false, c + " is not a failure");
  }
});

test("summarise: legacy status contexts (CodeRabbit posts one)", () => {
  assert.strictEqual(facts([ctx("SUCCESS")]).pending, false, "a green status must not read as running");
  assert.strictEqual(facts([ctx("SUCCESS")]).failing, false);
  assert.strictEqual(facts([ctx("PENDING")]).pending, true);
  assert.strictEqual(facts([ctx("EXPECTED")]).pending, true);
  assert.strictEqual(facts([ctx("FAILURE")]).failing, true);
  assert.strictEqual(facts([ctx("ERROR")]).failing, true);
  /* gh rows without __typename are told apart by the fields present. */
  assert.strictEqual(facts([{ state: "SUCCESS" }]).pending, false);
  assert.strictEqual(facts([{ status: "IN_PROGRESS" }]).pending, true);
});

test("summarise: a just-updated head with no checks yet counts as running", () => {
  assert.strictEqual(facts([], { updatedAt: RECENT }).pending, true);
  assert.strictEqual(facts([], { updatedAt: OLD }).pending, false,
    "an old PR with no checks at all must not block the queue forever");
  assert.strictEqual(facts(null).pending, false);
});

test("summarise: flags", () => {
  const f = summarise(row({ autoMergeRequest: null, isDraft: true, mergeable: "CONFLICTING" }), 3, NOW);
  assert.deepStrictEqual(
    { autoMerge: f.autoMerge, draft: f.draft, conflicting: f.conflicting, behindBy: f.behindBy },
    { autoMerge: false, draft: true, conflicting: true, behindBy: 3 });
});

/* ── pickNext ──────────────────────────────────────────────────────────── */

const fact = (number, over = {}) => ({
  number,
  createdAt: "2026-09-28T04:32:0" + number + "Z",
  autoMerge: true, draft: false, conflicting: false, failing: false, pending: false,
  behindBy: 1,
  ...over,
});

test("pickNext: behind PRs, oldest first", () => {
  assert.deepStrictEqual(pickNext([fact(3), fact(1), fact(2)]), { inFlight: null, queue: [1, 2, 3] });
});

test("pickNext: PRs whose last checks failed go last, not away", () => {
  /* That failure was on an older base: a flake, or a non-required check. */
  assert.deepStrictEqual(pickNext([fact(1, { failing: true }), fact(2), fact(3)]).queue, [2, 3, 1]);
});

test("pickNext: waits while an up-to-date Dependabot PR is running CI", () => {
  const plan1 = pickNext([fact(1), fact(2, { behindBy: 0, pending: true })]);
  assert.deepStrictEqual(plan1, { inFlight: 2, queue: [] });
});

test("pickNext: a BEHIND PR with checks running is not in flight", () => {
  /* A fresh batch: every PR is running its first CI and all but one are
     already behind. Only the up-to-date one counts. */
  const plan1 = pickNext([fact(1, { pending: true }), fact(2, { pending: true })]);
  assert.deepStrictEqual(plan1, { inFlight: null, queue: [1, 2] });
});

test("pickNext: an idle up-to-date PR does not hold up the queue", () => {
  assert.deepStrictEqual(pickNext([fact(1), fact(2, { behindBy: 0 })]).queue, [1]);
});

test("pickNext: leaves PRs a human has to look at", () => {
  const queue = pickNext([
    fact(1, { autoMerge: false }),    // npm semver-major: held for review
    fact(2, { draft: true }),
    fact(3, { conflicting: true }),
    fact(4, { behindBy: null }),      // compare failed
    fact(5),
  ]).queue;
  assert.deepStrictEqual(queue, [5]);
  assert.deepStrictEqual(pickNext([]), { inFlight: null, queue: [] });
});

/* ── classify ──────────────────────────────────────────────────────────── */

test("classify: the refusals worth a comment, and everything else", () => {
  assert.strictEqual(classify("refusing to allow a GitHub App to create or update workflow `.github/workflows/e2e.yml` without `workflows` permission"), "workflows");
  assert.strictEqual(classify("GraphQL: merge conflict between base and head (updatePullRequestBranch)"), "conflict");
  assert.strictEqual(classify("GraphQL: Resource not accessible by integration (updatePullRequestBranch)"), "other");
  assert.strictEqual(classify("HTTP 502: Bad Gateway"), "other");
});

/* ── the real gh helper: which token goes out ──────────────────────────── */

test("gh: reads use GH_TOKEN, writes use UPDATE_TOKEN", () => {
  const saved = { GH_TOKEN: process.env.GH_TOKEN, UPDATE_TOKEN: process.env.UPDATE_TOKEN };
  process.env.GH_TOKEN = "read-token";
  process.env.UPDATE_TOKEN = "app-token";
  try {
    const seen = [];
    const exec = (cmd, args, opts) => { seen.push({ cmd, token: opts.env.GH_TOKEN }); return ""; };
    ghCli(["pr", "list"], {}, exec);
    ghCli(["pr", "update-branch", "1"], { write: true }, exec);
    assert.deepStrictEqual(seen, [{ cmd: "gh", token: "read-token" }, { cmd: "gh", token: "app-token" }]);

    delete process.env.UPDATE_TOKEN;
    assert.throws(() => ghCli(["pr", "update-branch", "1"], { write: true }, exec), /UPDATE_TOKEN is not set/);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

/* ── a fake gh with just enough GitHub behind it ───────────────────────── */

function ghError(stderr) {
  const err = new Error("Command failed: gh");
  err.stderr = stderr;
  return err;
}

function fakeGitHub({ prs = [], behind = {}, compareFails = [], updateErrors = {}, updateOut = {},
  ciStarts = true, closed = [] } = {}) {
  const calls = [];
  const heads = Object.fromEntries(prs.map((p) => [p.number, p.headRefOid]));
  const checks = {};
  const comments = {};
  const gh = (args, opts = {}) => {
    calls.push({ args, write: Boolean(opts.write), line: args.join(" ") });
    const [a, b, n] = args;
    if (a === "pr" && b === "list") return JSON.stringify(prs);
    if (a === "api") {
      const sha = args[1].split("...")[1];
      if (compareFails.includes(sha)) throw ghError("HTTP 404: Not Found");
      return String(behind[sha]) + "\n";
    }
    if (a === "pr" && b === "view") {
      const num = Number(n);
      return JSON.stringify({
        headRefOid: heads[num],
        state: closed.includes(num) ? "MERGED" : "OPEN",
        statusCheckRollup: checks[num] || [],
        comments: comments[num] || [],
      });
    }
    if (a === "pr" && b === "update-branch") {
      const num = Number(n);
      if (updateErrors[num]) throw ghError(updateErrors[num]);
      if (updateOut[num]) return updateOut[num];
      heads[num] = heads[num] + "-merged";
      if (ciStarts) checks[num] = [run("QUEUED")];
      return "✓ PR branch updated\n";
    }
    if (a === "pr" && b === "comment") {
      const num = Number(n);
      (comments[num] = comments[num] || []).push({ body: args[args.indexOf("--body") + 1] });
      return "";
    }
    throw new Error("unexpected gh call: " + args.join(" "));
  };
  return { gh, calls, comments };
}

const quiet = { log() {}, warn() {} };
const noWait = { sleep: async () => {}, pollMs: 1, timeoutMs: 3 };
const pr = (number, headRefOid, over = {}) => row({
  number, headRefOid, createdAt: `2026-09-28T04:32:${String(number % 60).padStart(2, "0")}Z`, ...over,
});

/* ── plan ──────────────────────────────────────────────────────────────── */

test("plan: lists open PRs itself and keeps only Dependabot's", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dun-")), "out");
  const { gh, calls } = fakeGitHub({
    prs: [
      pr(18, "c"), pr(15, "a"), pr(17, "b"),
      pr(20, "h", { author: { login: "BasileChretien" } }),
    ],
    behind: { a: 3, b: 3, c: 3, h: 3 },
  });
  const queue = plan({ repo: "o/r", gh, ...quiet, now: NOW, outputFile: out });
  assert.deepStrictEqual(queue, [15, 17, 18]);
  assert.strictEqual(fs.readFileSync(out, "utf8"), "queue=15 17 18\n");

  const list = calls[0].args;
  assert.ok(!list.includes("--author"), "--author goes through the search index, which lags");
  assert.strictEqual(list[list.indexOf("--state") + 1], "open");
  const fields = list[list.indexOf("--json") + 1].split(",");
  for (const f of ["author", "autoMergeRequest", "statusCheckRollup", "updatedAt", "mergeable", "headRefOid", "baseRefName"]) {
    assert.ok(fields.includes(f), "--json must ask for " + f);
  }
  assert.ok(!calls.some((c) => c.line.includes("compare/main...h")), "human PRs are not even compared");
  assert.ok(calls.every((c) => !c.write), "plan never writes");
});

test("plan: compares each PR with its own base", () => {
  const { gh, calls } = fakeGitHub({ prs: [pr(1, "a", { baseRefName: "release" })], behind: { a: 1 } });
  plan({ repo: "o/r", gh, ...quiet, now: NOW, outputFile: null });
  assert.ok(calls.some((c) => c.line === "api repos/o/r/compare/release...a --jq .behind_by"));
});

test("plan: a PR that can't be compared is skipped with a warning, not fatal", () => {
  const warnings = [];
  const { gh } = fakeGitHub({ prs: [pr(1, "a"), pr(2, "b")], behind: { b: 1 }, compareFails: ["a"] });
  const queue = plan({ repo: "o/r", gh, log() {}, warn: (m) => warnings.push(m), now: NOW, outputFile: null });
  assert.deepStrictEqual(queue, [2]);
  assert.match(warnings.join("\n"), /#1/);
});

test("plan: writes an empty queue while one is in flight", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dun-")), "out");
  const { gh } = fakeGitHub({
    prs: [pr(1, "a"), pr(2, "b", { statusCheckRollup: [run("IN_PROGRESS")] })],
    behind: { a: 2, b: 0 },
  });
  assert.deepStrictEqual(plan({ repo: "o/r", gh, ...quiet, now: NOW, outputFile: out }), []);
  assert.strictEqual(fs.readFileSync(out, "utf8"), "queue=\n");
});

/* ── update ────────────────────────────────────────────────────────────── */

test("update: updates the first PR, with the App token, and confirms CI started", async () => {
  const { gh, calls } = fakeGitHub({ prs: [pr(15, "a"), pr(17, "b")] });
  assert.strictEqual(await update([15, 17], { repo: "o/r", gh, ...quiet, ...noWait }), 15);
  const writes = calls.filter((c) => c.write).map((c) => c.line);
  assert.deepStrictEqual(writes, ["pr update-branch 15 --repo o/r"]);
  assert.ok(!calls.some((c) => c.line.includes("update-branch 17")), "only one PR per run");
});

test("update: an update after which no CI starts fails the run", async () => {
  /* The #420 failure class: a push that starts no workflows. */
  const { gh } = fakeGitHub({ prs: [pr(15, "a")], ciStarts: false });
  await assert.rejects(update([15], { repo: "o/r", gh, ...quiet, ...noWait }), /no CI started/);
});

test("update: a Workflows refusal comments once, then tries the next PR", async () => {
  const refusal = "refusing to allow a GitHub App to create or update workflow `.github/workflows/e2e.yml` without `workflows` permission";
  const gitHub = fakeGitHub({ prs: [pr(1, "a"), pr(2, "b")], updateErrors: { 1: refusal } });
  const warnings = [];
  const opts = { repo: "o/r", gh: gitHub.gh, log() {}, warn: (m) => warnings.push(m), ...noWait };
  assert.strictEqual(await update([1, 2], opts), 2);
  assert.strictEqual(gitHub.comments[1].length, 1);
  assert.match(gitHub.comments[1][0].body, /Update branch/);
  assert.match(gitHub.comments[1][0].body, /<!-- dependabot-update-next workflows a -->/);
  assert.match(warnings[0], /#1/);
  assert.ok(gitHub.calls.filter((c) => c.line.startsWith("pr comment")).every((c) => c.write),
    "the comment goes out on the App token");

  /* Next run, same head: no second comment. */
  await update([1], opts);
  assert.strictEqual(gitHub.comments[1].length, 1, "one comment per head commit, not per run");
});

test("update: a conflict points at @dependabot recreate, not Update branch", async () => {
  const gitHub = fakeGitHub({ prs: [pr(1, "a")], updateErrors: { 1: "GraphQL: merge conflict (updatePullRequestBranch)" } });
  assert.strictEqual(await update([1], { repo: "o/r", gh: gitHub.gh, ...quiet, ...noWait }), null);
  assert.match(gitHub.comments[1][0].body, /@dependabot recreate/);
});

test("update: an unexpected error fails the run instead of going green", async () => {
  const { gh } = fakeGitHub({ prs: [pr(1, "a"), pr(2, "b")], updateErrors: { 1: "GraphQL: Resource not accessible by integration" } });
  await assert.rejects(update([1, 2], { repo: "o/r", gh, ...quiet, ...noWait }), /Resource not accessible/);
});

test("update: skips PRs that closed or were already up to date", async () => {
  const { gh } = fakeGitHub({
    prs: [pr(1, "a"), pr(2, "b"), pr(3, "c")],
    closed: [1],
    updateOut: { 2: "! PR branch already up-to-date\n" },
  });
  assert.strictEqual(await update([1, 2, 3], { repo: "o/r", gh, ...quiet, ...noWait }), 3);
});

/* ── the workflow ──────────────────────────────────────────────────────── */

const WF = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "dependabot-update-next.yml"), "utf8");
/* CRLF in a Windows checkout: split on /\r?\n/ or the guards match nothing. */
const LINES = WF.split(/\r?\n/);
const CODE = LINES.filter((l) => !/^\s*#/.test(l)).join("\n");

function step(name) {
  const start = LINES.findIndex((l) => l.trim() === "- name: " + name);
  assert.ok(start >= 0, "step not found: " + name);
  const indent = LINES[start].indexOf("-");
  let end = start + 1;
  while (end < LINES.length && (LINES[end].trim() === "" || LINES[end].search(/\S/) > indent)) end++;
  return LINES.slice(start, end).filter((l) => !/^\s*#/.test(l)).join("\n");
}

test("workflow: every push to main, hourly as a backstop, one run at a time", () => {
  assert.match(CODE, /on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(CODE, /schedule:\s*\n\s+- cron:/);
  assert.match(CODE, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+dry_run:/);
  assert.match(CODE, /concurrency:\s*\n\s+group:\s*dependabot-update-next\s*\n\s+cancel-in-progress:\s*false/);
});

test("workflow: the job token only reads", () => {
  const perms = CODE.slice(CODE.indexOf("\npermissions:"), CODE.indexOf("\nconcurrency:"));
  assert.match(perms, /pull-requests:\s*read/);
  assert.match(perms, /checks:\s*read/);
  assert.doesNotMatch(perms, /write/);
  assert.match(step("Plan"), /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(step("Plan"), /run:\s*node scripts\/ops\/dependabot-update-next\.js plan/);
});

test("workflow: updates with the App token, never GITHUB_TOKEN", () => {
  const s = step("Update the oldest behind Dependabot PR");
  assert.match(s, /UPDATE_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\}\}/);
  assert.match(s, /run:\s*node scripts\/ops\/dependabot-update-next\.js update\s*$/m,
    "the queue goes in through env (QUEUE), not interpolated into run");
  assert.match(s, /QUEUE:\s*\$\{\{\s*steps\.plan\.outputs\.queue\s*\}\}/);

  const mint = step("Mint update token (GitHub App)");
  assert.match(mint, /^\s*id:\s*app\s*$/m);
  assert.match(mint, /uses:\s*actions\/create-github-app-token@[0-9a-f]{40}\b/);
  assert.match(mint, /client-id:\s*\$\{\{\s*secrets\.AUTOMERGE_APP_CLIENT_ID\s*\}\}/);
  assert.match(mint, /private-key:\s*\$\{\{\s*secrets\.AUTOMERGE_APP_PRIVATE_KEY\s*\}\}/);
  /* No narrowing: the token must carry Workflows when the App has it, or
     every PR behind a workflow change on main is refused. */
  assert.doesNotMatch(mint, /permission-/);
});

test("workflow: the App is used only when there is work, the secrets exist and it isn't a dry run", () => {
  assert.match(CODE, /HAS_APP:.*secrets\.AUTOMERGE_APP_CLIENT_ID != ''.*secrets\.AUTOMERGE_APP_PRIVATE_KEY != ''/);
  for (const name of ["Mint update token (GitHub App)", "Update the oldest behind Dependabot PR"]) {
    const s = step(name);
    assert.match(s, /steps\.plan\.outputs\.queue != ''/, name);
    assert.match(s, /env\.HAS_APP == 'true'/, name);
    assert.match(s, /github\.event\.inputs\.dry_run != 'true'/, name);
  }
  const skip = step("Skip without the App");
  assert.match(skip, /env\.HAS_APP != 'true'/);
  assert.match(skip, /::notice /);
});
