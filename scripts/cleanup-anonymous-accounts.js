#!/usr/bin/env node
"use strict";
/* Remove anonymous Firebase Auth accounts nobody has used, and what is kept
 * under them — issue #347.
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
 * Exit codes: 0 done · 1 something was not done (see the output) ·
 *             2 misconfigured or broken · 3 the ACCOUNT half refused on purpose
 *             (no account or user record deleted; the counter sweep, which
 *             does not depend on it, has still run and is reported)
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { makeRestShallowReader, makeRestValueReader } = require("./lib/session-trees");
const { parseRetentionDays } = require("./lib/retention-window");
const { listAccounts, lookupAccounts, deleteAccounts } = require("./lib/auth-accounts");
const {
  validateWindowDays, DEFAULT_RETENTION_DAYS, DAY_MS
} = require("./lib/anonymous-retention");
const { runAnonymousRetention, withTimeout } = require("./lib/anonymous-retention-job");
const { exitCodeFor, formatReport, formatSweepOnly } = require("./lib/anonymous-retention-report");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "canamed-69785";
const CONFIRM = process.env.ANON_CONFIRM === "1";
const SWEEP_ORPHANS = process.env.ANON_SWEEP_ORPHANS === "1";
/* One multi-path update of a few hundred nulls takes well under a second. */
const WRITE_TIMEOUT_MS = 2 * 60 * 1000;

function retentionDays() {
  const parsed = parseRetentionDays(process.env.ANON_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  const checked = parsed.ok ? validateWindowDays(parsed.value) : parsed;
  if (!checked.ok) {
    console.error(`FATAL: ANON_RETENTION_DAYS=${checked.error}`);
    process.exit(2);
  }
  return checked.value;
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
    lookupAccounts: (uids) => lookupAccounts(authDeps, uids),
    deleteAccounts: (uids) => deleteAccounts(authDeps, uids),
    fetchShallow: makeRestShallowReader({ app, databaseURL: DB_URL }),
    readValue: makeRestValueReader({ app, databaseURL: DB_URL }),
    updateRoot: (update) => withTimeout(db.ref().update(update), WRITE_TIMEOUT_MS)
  }, {
    nowMs: Date.now(),
    windowMs: days * DAY_MS,
    confirm: CONFIRM,
    sweepOrphans: SWEEP_ORPHANS
  });

  for (const line of formatReport(report, { confirm: CONFIRM, days, sweepOrphans: SWEEP_ORPHANS })) {
    console.log(line);
  }
  /* Explicit: firebase-admin's database connection keeps the event loop alive,
     so falling off the end would hang until the workflow timeout — see
     tests/ops-scripts-terminate.test.js. */
  process.exit(exitCodeFor(report));
}

main().catch((e) => {
  /* The counter sweep runs before the account half and does not depend on it,
     so by the time that half refuses or fails the counters are already done.
     Say so, or the log reads as though nothing happened. */
  if (e && e.rateLimits) {
    for (const line of formatSweepOnly(e.rateLimits, CONFIRM)) console.log(line);
  }
  if (e && e.refusal) {
    console.error("REFUSED: " + e.message);
    process.exit(3);
  }
  // Message only, never the stack: this runs on a public repo. Every error the
  // job raises is written to carry a label and a status, not a path or a uid.
  console.error("FATAL: " + (e && e.message ? e.message : String(e)));
  process.exit(2);
});
