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
 * whole E2E run (~35 min). So this updates one, and waits while any
 * up-to-date Dependabot PR still has checks running. That PR's merge is a push
 * to main, which runs dependabot-update-next.yml again for the next one.
 *
 * LEFT FOR A HUMAN: PRs without auto-merge (npm majors, held for review by
 * dependabot-auto-merge.yml), drafts, conflicts (Dependabot rebases those
 * itself) and PRs whose last checks failed (they would fail again on every
 * push to main).
 *
 * Needs GH_TOKEN (reads) and UPDATE_TOKEN (the GitHub App token, for the
 * update itself); see the workflow. Usage:
 *   GH_TOKEN=... UPDATE_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/ops/dependabot-update-next.js
 */

"use strict";

const { execFileSync } = require("node:child_process");

const FAILED_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

/* One `gh pr list` row, plus how far its branch is behind its base, reduced
   to the facts pickNext reads. statusCheckRollup mixes check runs
   (status/conclusion) and legacy commit statuses (state). */
function summarise(pr, behindBy) {
  const checks = pr.statusCheckRollup || [];
  return {
    number: pr.number,
    createdAt: pr.createdAt,
    autoMerge: Boolean(pr.autoMergeRequest),
    draft: Boolean(pr.isDraft),
    conflicting: pr.mergeable === "CONFLICTING",
    failing: checks.some((c) => FAILED_CONCLUSIONS.has(c.conclusion) || FAILED_STATES.has(c.state)),
    pending: checks.some((c) => (c.status && c.status !== "COMPLETED") || PENDING_STATES.has(c.state)),
    behindBy,
  };
}

/* { inFlight: <PR number still running CI> | null, queue: [behind PRs, oldest first] } */
function pickNext(facts) {
  const eligible = facts.filter((f) => f.autoMerge && !f.draft && !f.conflicting && !f.failing);
  const running = eligible.find((f) => f.behindBy === 0 && f.pending);
  if (running) return { inFlight: running.number, queue: [] };
  const queue = eligible
    .filter((f) => f.behindBy > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((f) => f.number);
  return { inFlight: null, queue };
}

/* Reads use GH_TOKEN (the workflow's read-only GITHUB_TOKEN, which can see
   check runs). Only the update uses UPDATE_TOKEN (the App token), because a
   GITHUB_TOKEN push starts no CI on the PR. */
function gh(args, { write = false } = {}) {
  const env = { ...process.env };
  if (write) {
    if (!process.env.UPDATE_TOKEN) throw new Error("UPDATE_TOKEN is not set");
    env.GH_TOKEN = process.env.UPDATE_TOKEN;
  }
  return execFileSync("gh", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

/* Update the next PR. Returns its number, or null if nothing was updated. */
function run({ repo = process.env.GITHUB_REPOSITORY, gh: call = gh, log = console.log, warn = console.warn } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const rows = JSON.parse(call([
    "pr", "list", "--repo", repo, "--author", "app/dependabot", "--state", "open", "--limit", "100",
    "--json", "number,createdAt,autoMergeRequest,isDraft,mergeable,statusCheckRollup,headRefOid,baseRefName",
  ]));
  const facts = rows.map((pr) => summarise(pr, Number(call([
    "api", `repos/${repo}/compare/${pr.baseRefName}...${pr.headRefOid}`, "--jq", ".behind_by",
  ]).trim())));

  const { inFlight, queue } = pickNext(facts);
  if (inFlight !== null) {
    log(`#${inFlight} is up to date and still running CI; waiting for it.`);
    return null;
  }
  if (queue.length === 0) {
    log("No Dependabot PR is behind main.");
    return null;
  }
  for (const n of queue) {
    try {
      call(["pr", "update-branch", String(n), "--repo", repo], { write: true });
      log(`Updated #${n} with main; its CI is starting.`);
      return n;
    } catch (err) {
      /* Typically main just changed a workflow file and the App has no
         Workflows permission; merging that into the PR branch is refused. */
      const why = String((err && (err.stderr || err.message)) || err).trim().split("\n")[0];
      warn(`::warning title=Could not update Dependabot PR #${n}::${why} — click "Update branch" on #${n} by hand.`);
    }
  }
  return null;
}

module.exports = { summarise, pickNext, run, gh };

if (require.main === module) {
  run();
}
