#!/usr/bin/env node
"use strict";
/* Remove anonymous Firebase Auth accounts nobody has used, and the records
 * keyed by them — issue #347.
 *
 * Every visitor is signed in anonymously before any consent surface is
 * reached, and until this job nothing removed those accounts: retention was
 * indefinite, by absence of any mechanism (auto-deletion of anonymous users is
 * an Identity Platform feature this project does not have). An anonymous
 * account is now removed once it has gone ANON_RETENTION_DAYS without use AND
 * no session it joined still exists — so at most about 30 days later than the
 * window, when a long-open session is closed at the last moment.
 *
 * In the same pass:
 *   - the session history a since-fixed bug wrote under every anonymous joiner
 *     (users/<uid>/history, #348) is removed for accounts that still exist;
 *   - the LLM proxy's rate-limit counters are swept once their window has
 *     passed. They were never swept before, despite a comment saying so.
 *
 * What is decided, and why, is in scripts/lib/anonymous-retention.js. What is
 * read onto this machine is in scripts/lib/anonymous-retention-job.js — in
 * short: identifiers and dates, never a name or an e-mail address.
 *
 * DRY-RUN BY DEFAULT. Set ANON_CONFIRM=1 to delete. A deleted account cannot be
 * restored; its owner is simply signed in afresh on their next visit.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON (set by GH Actions)
 *   FIREBASE_DATABASE_URL           the RTDB URL (with region suffix)
 *   FIREBASE_PROJECT_ID             default canamed-69785
 *   ANON_RETENTION_DAYS             default 90; refused outside 7..90
 *   ANON_CONFIRM                    "1" to actually delete
 *   ANON_SWEEP_ORPHANS              "1" to also delete records whose uid has NO
 *                                   account at all. Off by default: see the
 *                                   header of anonymous-retention.js.
 *
 * Prints COUNTS ONLY, always. There is no verbose mode: this runs on a public
 * repository, whose Actions logs are world-readable, and a uid is the very
 * identifier this job exists to stop keeping.
 *
 * Exit codes: 0 done · 1 some deletions failed · 2 misconfigured or broken ·
 *             3 refused on purpose (nothing was deleted)
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { makeRestShallowReader, makeRestValueReader } = require("./lib/session-trees");
const { parseRetentionDays } = require("./lib/retention-window");
const { listAccounts, deleteAccounts } = require("./lib/auth-accounts");
const {
  validateWindowDays, DEFAULT_RETENTION_DAYS, DAY_MS
} = require("./lib/anonymous-retention");
const { runAnonymousRetention } = require("./lib/anonymous-retention-job");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "canamed-69785";
const CONFIRM = process.env.ANON_CONFIRM === "1";
const SWEEP_ORPHANS = process.env.ANON_SWEEP_ORPHANS === "1";

function retentionDays() {
  const parsed = parseRetentionDays(process.env.ANON_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  const checked = parsed.ok ? validateWindowDays(parsed.value) : parsed;
  if (!checked.ok) {
    console.error(`FATAL: ANON_RETENTION_DAYS=${checked.error}`);
    process.exit(2);
  }
  return checked.value;
}

function print(report, days) {
  const a = report.accounts, r = report.records, l = report.rateLimits;
  const will = CONFIRM ? "deleted" : "would delete";
  console.log(`Sessions:    ${report.sessions} live, whose members and creators are never removed`);
  console.log(`Accounts:    ${a.total} total — ${a.anonymous} anonymous, ${a.named} signed-in (untouched)`);
  console.log(`Anonymous:   ${a.expired} idle > ${days}d, ${a.kept} kept ` +
    `(${a.protected} still in a live session or allowlisted, ${a.undated} undated, ` +
    `${a.unusable} with an unusable uid)`);
  console.log(`Records:     ${r.expiredPaths} keyed by those accounts`);
  console.log(`History:     ${r.legacyHistory} live anonymous account(s) with a users/ node`);
  if (r.legacyHistory) {
    console.log("             Expected on the first live run only. Anonymous joiners stopped");
    console.log("             getting a history record on 2026-08-25 (#348); a count that");
    console.log("             comes back afterwards means that write has regressed.");
  }
  const o = r.orphans;
  console.log(`Orphans:     ${o.users} users, ${o.scenarios} scenarios, ${o.rateLimits} rateLimits, ` +
    `${o.reports} reports with no account — ` +
    (SWEEP_ORPHANS ? `${r.orphanPaths} included` : "reported only (ANON_SWEEP_ORPHANS=1 to remove)"));
  if (r.skippedKeys) {
    console.log(`Skipped:     ${r.skippedKeys} key(s) that are not a well-formed uid or share id`);
  }
  console.log(`Rate limits: ${l.staleUid} per-uid + ${l.staleSession} per-session bucket(s) past ` +
    `their window, ${l.kept} current` + (l.unparsed ? `, ${l.unparsed} in no known format` : ""));
  console.log(`Paths:       ${report.paths} database path(s) — ${will}`);
  if (!CONFIRM) return;

  const w = report.written, au = report.auth;
  console.log(`Written:     ${w.paths} path(s) removed` +
    (w.failedUpdates ? `, ${w.failedUpdates} update(s) FAILED [${w.errorCodes.join(", ")}]` : ""));
  if (au.skipped) {
    console.log("Auth:        NO account deleted — a database write failed, and an account");
    console.log("             is only removed after its records. The next run retries both.");
  } else {
    console.log(`Auth:        ${au.deleted} account(s) deleted` +
      (au.failed ? `, ${au.failed} FAILED` : "") +
      (au.httpStatuses.length ? ` [HTTP ${au.httpStatuses.join(", ")}]` : ""));
  }
}

async function main() {
  const days = retentionDays();
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  const app = initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();
  const cred = app.options.credential;
  const authDeps = {
    fetch,
    getToken: async () => (await cred.getAccessToken()).access_token,
    projectId: PROJECT_ID
  };

  console.log("--- CaNaMED anonymous-account retention ---");
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log(`Window:      ${days}d without use`);

  const report = await runAnonymousRetention({
    listAccounts: () => listAccounts(authDeps),
    deleteAccounts: (uids) => deleteAccounts(authDeps, uids),
    fetchShallow: makeRestShallowReader({ app, databaseURL: DB_URL }),
    readValue: makeRestValueReader({ app, databaseURL: DB_URL }),
    updateRoot: (update) => db.ref().update(update)
  }, {
    nowMs: Date.now(),
    windowMs: days * DAY_MS,
    confirm: CONFIRM,
    sweepOrphans: SWEEP_ORPHANS
  });

  print(report, days);
  if (!CONFIRM && report.paths + report.accounts.expired > 0) {
    console.log("(Set ANON_CONFIRM=1 to actually delete.)");
  }

  const failed = report.written.failedUpdates > 0 || report.auth.failed > 0 || report.auth.skipped;
  /* Explicit: firebase-admin's database connection keeps the event loop alive,
     so falling off the end would hang until the workflow timeout — see
     tests/ops-scripts-terminate.test.js. */
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  if (e && e.refusal) {
    console.error("REFUSED: " + e.message);
    process.exit(3);
  }
  // Message only, never the stack: this runs on a public repo. Every error the
  // job raises is written to carry a label and a status, not a path or a uid.
  console.error("FATAL: " + (e && e.message ? e.message : String(e)));
  process.exit(2);
});
