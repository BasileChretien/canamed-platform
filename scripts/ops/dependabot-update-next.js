#!/usr/bin/env node
/* scripts/ops/dependabot-update-next.js — bring the next Dependabot PR up to date with main
 *
 * WHY THIS EXISTS. main's branch protection is strict: a PR must be up to
 * date with main before it can merge. Dependabot opens its PRs in batches, so
 * the first one to merge leaves every other one BEHIND, and their auto-merge
 * then waits forever: Dependabot rebases a PR only when it CONFLICTS, never
 * when it is merely behind. On 2026-09-28 four opened together; #416 merged
 * and #415, #417 and #418 sat behind for two days until someone clicked
 * "Update branch" on each.
 *
 * ONE AT A TIME, OLDEST FIRST. Updating every behind PR at once makes them
 * race: whichever merges first puts the others behind again and wastes their
 * whole E2E run (~20–35 min). So this updates one, and waits while any
 * up-to-date Dependabot PR still has checks running. That PR's merge is a push
 * to main, which runs dependabot-update-next.yml again for the next; an hourly
 * run catches the links that end without a merge (a failed or cancelled run,
 * a green PR that doesn't merge).
 *
 * LEFT FOR A HUMAN: PRs without auto-merge (npm majors, held for review by
 * dependabot-auto-merge.yml), drafts and conflicts. PRs whose last checks
 * failed are retried last: that failure was on an older base, and may have
 * been a flake or a non-required check.
 *
 * TWO MODES, TWO TOKENS:
 *   plan    reads only (GH_TOKEN = the job's read-only GITHUB_TOKEN) and
 *           writes `queue=<PR numbers>` to $GITHUB_OUTPUT.
 *   update  tries the queued PRs in order (QUEUE), pushing with UPDATE_TOKEN,
 *           the GitHub App token. A GITHUB_TOKEN push starts no CI, which is
 *           why this checks that CI did start on the new head.
 *
 * FAILING LOUDLY, NOT OFTEN. An update GitHub refuses for a known reason
 * (the branch conflicts; main changed a workflow file and the App lacks the
 * Workflows permission) is posted ONCE as a comment on that PR, which
 * notifies the maintainer, and the next PR is tried. Anything unexpected, or
 * an update after which no CI starts, fails the run.
 */

"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const DEPENDABOT_LOGINS = new Set(["app/dependabot", "dependabot[bot]", "dependabot"]);
const FAILED_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);
/* A head this recently updated with no checks yet is about to get them. */
const FRESH_MS = 10 * 60 * 1000;
const MARKER = "<!-- dependabot-update-next";
const PR_FIELDS = "number,author,createdAt,updatedAt,autoMergeRequest,isDraft,mergeable,statusCheckRollup,headRefOid,baseRefName";

/* statusCheckRollup mixes check runs (status/conclusion) and legacy commit
   statuses (state, no status). */
function isCheckRun(c) {
  return c.__typename === "CheckRun" || (c.__typename === undefined && c.status !== undefined);
}
function isPending(c) {
  return isCheckRun(c) ? c.status !== "COMPLETED" : PENDING_STATES.has(c.state);
}
function isFailing(c) {
  return isCheckRun(c) ? FAILED_CONCLUSIONS.has(c.conclusion) : FAILED_STATES.has(c.state);
}

/* One `gh pr list` row, plus how far its branch is behind its base (null if
   that couldn't be read), reduced to the facts pickNext reads. */
function summarise(pr, behindBy, now = Date.now()) {
  const checks = pr.statusCheckRollup || [];
  const fresh = now - Date.parse(pr.updatedAt || 0) < FRESH_MS;
  return {
    number: pr.number,
    createdAt: pr.createdAt,
    autoMerge: Boolean(pr.autoMergeRequest),
    draft: Boolean(pr.isDraft),
    conflicting: pr.mergeable === "CONFLICTING",
    failing: checks.some(isFailing),
    /* Right after an update the new head has no checks for a few seconds.
       Counting it as idle would let a second run update another PR alongside. */
    pending: checks.some(isPending) || (checks.length === 0 && fresh),
    behindBy,
  };
}

/* { inFlight: <PR number still running CI> | null, queue: [behind PRs] }.
   The queue is oldest first, with PRs whose last checks failed at the end. */
function pickNext(facts) {
  const eligible = facts.filter((f) =>
    f.autoMerge && !f.draft && !f.conflicting && Number.isInteger(f.behindBy));
  const running = eligible.find((f) => f.behindBy === 0 && f.pending);
  if (running) return { inFlight: running.number, queue: [] };
  const queue = eligible
    .filter((f) => f.behindBy > 0)
    .sort((a, b) => (Number(a.failing) - Number(b.failing)) || a.createdAt.localeCompare(b.createdAt))
    .map((f) => f.number);
  return { inFlight: null, queue };
}

/* Reads use GH_TOKEN. Writes use UPDATE_TOKEN (the App token). */
function gh(args, { write = false } = {}, exec = execFileSync) {
  const env = { ...process.env };
  if (write) {
    if (!process.env.UPDATE_TOKEN) throw new Error("UPDATE_TOKEN is not set");
    env.GH_TOKEN = process.env.UPDATE_TOKEN;
  }
  return exec("gh", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

function errorText(err) {
  return String((err && (err.stderr || err.message)) || err).trim();
}

/* "workflows" | "conflict" | "other" */
function classify(text) {
  if (/workflows?`? permission|create or update workflow/i.test(text)) return "workflows";
  if (/conflict/i.test(text)) return "conflict";
  return "other";
}

const ADVICE = {
  workflows:
    "main has changed a workflow file since this PR was opened, and the automation's GitHub App has no " +
    "**Workflows** permission, so it can't merge main into this branch. Click **Update branch** once " +
    "(or grant the App *Workflows: read and write*; see `dependabot-update-next.yml`).",
  conflict:
    "This branch conflicts with main. Comment `@dependabot recreate`: Dependabot stops rebasing a " +
    "branch once anyone else has pushed to it.",
};

function listFacts({ repo, gh: call, warn, now }) {
  const rows = JSON.parse(call([
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", PR_FIELDS,
  ]));
  /* Filtered here, not with --author: that goes through the search index,
     which can still list a PR merged a moment ago as open. */
  return rows
    .filter((pr) => pr.author && DEPENDABOT_LOGINS.has(pr.author.login))
    .map((pr) => {
      let behindBy = null;
      try {
        behindBy = Number(call([
          "api", `repos/${repo}/compare/${pr.baseRefName}...${pr.headRefOid}`, "--jq", ".behind_by",
        ]).trim());
      } catch (err) {
        warn(`::warning title=Skipping Dependabot PR #${pr.number}::could not compare it with ${pr.baseRefName}: ${errorText(err).split("\n")[0]}`);
      }
      return summarise(pr, Number.isInteger(behindBy) ? behindBy : null, now);
    });
}

/* Decide what to update. Returns the queue (possibly empty). */
function plan({ repo = process.env.GITHUB_REPOSITORY, gh: call = gh, log = console.log, warn = console.warn,
  now = Date.now(), outputFile = process.env.GITHUB_OUTPUT } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const { inFlight, queue } = pickNext(listFacts({ repo, gh: call, warn, now }));
  if (inFlight !== null) log(`#${inFlight} is up to date and still running CI; waiting for it.`);
  else if (queue.length === 0) log("No Dependabot PR is behind main.");
  else log(`Behind main, in order: ${queue.map((n) => "#" + n).join(", ")}.`);
  if (outputFile) fs.appendFileSync(outputFile, `queue=${queue.join(" ")}\n`);
  return queue;
}

function viewPr(call, repo, n, fields) {
  return JSON.parse(call(["pr", "view", String(n), "--repo", repo, "--json", fields]));
}

/* Comment on the PR once per head commit, so a refusal notifies the
   maintainer without repeating on every push and every hourly run. */
function commentOnce(call, repo, n, head, kind, why) {
  const tag = `${MARKER} ${kind} ${head} -->`;
  const { comments = [] } = viewPr(call, repo, n, "comments");
  if (comments.some((c) => (c.body || "").includes(tag))) return false;
  const body = `${tag}\nCould not bring this PR up to date with main automatically.\n\n` +
    `${ADVICE[kind]}\n\n<details><summary>GitHub said</summary>\n\n\`\`\`\n${why}\n\`\`\`\n</details>`;
  call(["pr", "comment", String(n), "--repo", repo, "--body", body], { write: true });
  return true;
}

/* The new head of PR n once some check has appeared on it, or null. */
async function waitForCi(call, repo, n, oldHead, { sleep, pollMs, timeoutMs }) {
  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    const pr = viewPr(call, repo, n, "headRefOid,statusCheckRollup");
    if (pr.headRefOid !== oldHead && (pr.statusCheckRollup || []).length > 0) return pr.headRefOid;
    await sleep(pollMs);
  }
  return null;
}

/* Update the first PR of the queue that GitHub accepts. Returns its number or null. */
async function update(queue, { repo = process.env.GITHUB_REPOSITORY, gh: call = gh, log = console.log,
  warn = console.warn, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = 15000, timeoutMs = 180000 } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  for (const n of queue) {
    const { headRefOid: head, state } = viewPr(call, repo, n, "headRefOid,state");
    if (state !== "OPEN") { log(`#${n} is ${String(state).toLowerCase()} now; skipping.`); continue; }

    let out;
    try {
      out = call(["pr", "update-branch", String(n), "--repo", repo], { write: true });
    } catch (err) {
      const why = errorText(err);
      const kind = classify(why);
      if (kind === "other") throw new Error(`updating #${n} failed: ${why}`);
      warn(`::warning title=Could not update Dependabot PR #${n}::${why.split("\n")[0]}`);
      if (commentOnce(call, repo, n, head, kind, why)) log(`Left a comment on #${n}.`);
      continue;
    }
    if (/already up.to.date/i.test(String(out))) { log(`#${n} was already up to date.`); continue; }

    const newHead = await waitForCi(call, repo, n, head, { sleep, pollMs, timeoutMs });
    if (!newHead) {
      throw new Error(`#${n} was updated but no CI started on its new head within ${timeoutMs / 1000}s. ` +
        "A push that starts no workflows means it was not made with the App token.");
    }
    log(`Updated #${n} with main; CI started on ${newHead.slice(0, 7)}.`);
    return n;
  }
  return null;
}

module.exports = { summarise, pickNext, classify, gh, plan, update };

if (require.main === module) {
  const mode = process.argv[2];
  const main = mode === "plan" ? async () => plan()
    : mode === "update" ? () => update((process.env.QUEUE || "").split(/\s+/).filter(Boolean).map(Number))
    : null;
  if (!main) {
    console.error("usage: dependabot-update-next.js plan | update   (update reads QUEUE)");
    process.exit(2);
  }
  main().catch((err) => {
    console.error(`::error title=Dependabot update-next failed::${errorText(err).split("\n")[0]}`);
    console.error(err);
    process.exit(1);
  });
}
