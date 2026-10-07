#!/usr/bin/env node
/* Are outstanding data-subject requests being acted on in time?
 *
 * GDPR Art. 12(3): "without undue delay and in any event within one month of
 * receipt of the request." APPI Art. 35 sets a parallel expectation.
 *
 * THIS IS THE PIECE THAT WAS MISSING, and its absence is why Annex VI G12 could
 * not close. A participant can record an erasure request in the product (#376)
 * and an operator can perform one (#375), but nothing connected the two: the
 * queue lived in the database and no human or job ever read it. An unread queue
 * discharges no duty, and — worse — every other part of the system reports
 * success while the clock runs.
 *
 * QUIET BY DESIGN. It prints a summary and exits 0 while nothing is late. It
 * exits 1 only when a request has passed the deadline, so a red run means a
 * real obligation is overdue rather than "the daily job ran". This repository
 * has lost real failures to alert fatigue more than once; a monitor that cries
 * every morning would be worse than none.
 *
 * WHAT IT CANNOT TELL YOU. It counts a request whether or not its session is
 * still in the database, and says how many are in the second group — but for
 * those it cannot distinguish a session that was purged from a code that never
 * existed (any signed-in visitor may write a withdrawal record for any code),
 * and scripts/erase-participant.js cannot act on them. Both are open in DPA
 * Annex VI, G12.
 *
 * ENV
 *   DATA_RIGHTS_DEADLINE_DAYS  default 30 (Art. 12(3))
 *   DATA_RIGHTS_WARN_DAYS      default 21 — warn before it is late, since a
 *                              monitor that only speaks on the deadline gives
 *                              nobody time to act
 */

"use strict";

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const { readSessionLocations } = require("./lib/session-trees");
const { erasureQueue, DEADLINE_DAYS } = require("./lib/data-rights");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

function positiveDays(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`FATAL: ${name}="${raw}" is not a positive number. Refusing ` +
      "to run: a bad deadline silently disables the only check that a legal " +
      "time limit is being met.");
    process.exit(2);
  }
  return n;
}

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL });
  else initializeApp({ databaseURL: DB_URL });
}

function flattenErasures(node) {
  const out = [];
  for (const id of Object.keys(node || {})) {
    const entry = node[id];
    if (!entry || typeof entry !== "object") continue;
    for (const rec of entry.records || []) out.push(rec);
  }
  return out;
}

/**
 * The whole check, against any database handle. Returns the exit code instead
 * of exiting, and writes through `out` / `err`, so a test can run the real
 * thing against a fake database rather than read this file for strings.
 *
 * @param {object} db a firebase-admin database() handle (or a stand-in)
 * @param {object} opts
 * @param {number} opts.now epoch ms
 * @param {number} opts.deadlineDays
 * @param {number} opts.warnDays
 * @param {function} [opts.out] defaults to console.log
 * @param {function} [opts.err] defaults to console.error
 * @returns {Promise<number>} 0 = nothing late, 1 = a request is past the limit
 */
async function run(db, opts) {
  const DEADLINE = opts.deadlineDays;
  const WARN = opts.warnDays;
  const out = opts.out || console.log;
  const err = opts.err || console.error;

  /* THE WHOLE `withdrawals` TREE, not one branch per live session. Until
     2026-10-07 this visited `withdrawals/<code>` only for the sessions it found
     in the database, so a request whose session had been purged — which the
     rules accept, and which the account dialog's history row exists for — was
     never open, due or overdue: the participant was told it was recorded, and
     this job stayed green for ever. A failed read throws; it must never read
     as "no requests". */
  const locations = await readSessionLocations(db);
  const withdrawalsSnap = await db.ref("withdrawals").get();
  const erasuresSnap = await db.ref("erasures").get();

  const { pending, overdue, handled, sessionGone } = erasureQueue({
    withdrawals: withdrawalsSnap.exists() ? withdrawalsSnap.val() : {},
    erasureRecords: flattenErasures(erasuresSnap.exists() ? erasuresSnap.val() : {}),
    liveLocationKeys: locations.map((loc) => loc.key),
    now: opts.now,
    deadlineDays: DEADLINE,
  });

  out(`Sessions in database:    ${locations.length}`);
  out(`Erasure requests done:   ${handled}`);
  out(`Erasure requests open:   ${pending.length}`);
  if (sessionGone.length) {
    out(`  session not in the database: ${sessionGone.length}`);
  }
  out(`Deadline:                ${DEADLINE} days (Art. 12(3)); warn at ${WARN}`);

  /* ⚠️ NO uid, NO session code in the output. These logs are world-readable on
     a public repository — the same reason cleanup-stale-sessions runs with
     CLEANUP_QUIET=1. Knowing that a request is late is what an operator needs
     here; knowing WHOSE it is comes from the database, not from CI. */
  for (const p of pending) {
    const age = p.ageDays === null ? "undated" : `${p.ageDays}d`;
    const flag = p.overdue ? "OVERDUE" : (p.ageDays !== null && p.ageDays >= WARN ? "due soon" : "open");
    out(`  - request age ${age} [${flag}]` +
      (p.sessionInDatabase ? "" : " (session not in the database)"));
  }

  if (overdue.length) {
    err("");
    err(`FAIL: ${overdue.length} erasure request(s) past the ` +
      `${DEADLINE}-day limit in GDPR Art. 12(3).`);
    err("Run scripts/erase-participant.js for each. Read the open " +
      "requests from `withdrawals/` in the database — deliberately not printed " +
      "here, because these logs are public.");
    const gone = overdue.filter((p) => !p.sessionInDatabase).length;
    if (gone) {
      /* Said here because the line above would otherwise send the operator to
         a tool that answers "nothing to erase" and exits 0. */
      err("");
      err(`Session not in the database for ${gone} of them. ` +
        "erase-participant.js walks live sessions only: it will find nothing " +
        "for those and write no suppression record, so nothing in the tooling " +
        "closes them yet. They concern the copies that outlive a session " +
        "(archive snapshots, exports), or a code that never existed — the " +
        "record is writable for any code. See DPA Annex VI, G12.");
    }
    return 1;
  }

  const soon = pending.filter((p) => p.ageDays !== null && p.ageDays >= WARN);
  if (soon.length) {
    out("");
    out(`${soon.length} request(s) will pass the deadline within ` +
      `${DEADLINE - WARN} day(s). Acting now avoids a breach, not just a red run.`);
  }
  out("");
  out("OK — nothing is past the limit.");
  return 0;
}

async function main() {
  const deadlineDays = positiveDays("DATA_RIGHTS_DEADLINE_DAYS", DEADLINE_DAYS);
  const warnDays = positiveDays("DATA_RIGHTS_WARN_DAYS", 21);
  initAdmin();
  return run(getDatabase(), { now: Date.now(), deadlineDays, warnDays });
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error("FATAL: " + (e && e.message));
    process.exit(2);
  });
}

module.exports = { run };
