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
 * WHAT IT READS. The `withdrawals`, `erasures` and `purgedSessions` trees,
 * whole — identifiers and dates — and the KEYS of `sessions` and
 * `orgs/<slug>/sessions`. No session body: it runs daily on a hosted runner
 * outside the EEA, and the privacy notice says the daily jobs do not read
 * session content.
 *
 * WHAT IT CAN AND CANNOT TELL YOU. It counts a request whether or not its
 * session is still in the database, and says how many are in the second group.
 * Within that group it separates a session the purge removed (it left a marker
 * under `purgedSessions`) from one that nothing shows ever existed. The rules
 * accept a withdrawal only for a session that exists or carries a marker, so a
 * record with neither predates that rule, or names a session purged before the
 * purge wrote markers — it cannot say which. scripts/erase-participant.js
 * answers a request for a purged session (with the operator's word on the
 * research copy) and writes nothing for one with no marker; the failure
 * message below says which is which. DPA Annex VI, G12.
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

const { readSessionLocationsShallow, purgedMarkers } = require("./lib/session-trees");
const { erasureQueue, flattenErasures, DEADLINE_DAYS } = require("./lib/data-rights");

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
  if (getApps().length) return getApps()[0];
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  return raw
    ? initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL })
    : initializeApp({ databaseURL: DB_URL });
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
 * @param {function} opts.liveLocations async () => the sessions in the
 *   database, as session-trees locations. REQUIRED, and must list KEYS ONLY:
 *   see the note where it is called.
 * @param {function} [opts.out] defaults to console.log
 * @param {function} [opts.err] defaults to console.error
 * @returns {Promise<number>} 0 = nothing late, 1 = a request is past the limit
 */
async function run(db, opts) {
  const DEADLINE = opts.deadlineDays;
  const WARN = opts.warnDays;
  const out = opts.out || console.log;
  const err = opts.err || console.error;
  if (typeof opts.liveLocations !== "function") {
    throw new Error("run() needs opts.liveLocations — there is deliberately no " +
      "default: the obvious one reads every session body.");
  }

  /* THE WHOLE `withdrawals` TREE, not one branch per live session. Until
     2026-10-07 this visited `withdrawals/<code>` only for the sessions it found
     in the database, so a request whose session had been purged — which the
     rules accept, and which the account dialog's history row exists for — was
     never open, due or overdue: the participant was told it was recorded, and
     this job stayed green for ever. A failed read throws; it must never read
     as "no requests". */
  /* WHICH SESSIONS EXIST — KEYS ONLY. This job runs daily on a hosted runner
     outside the EEA, and the privacy notice says the daily jobs do not read
     session content. Until 2026-10-07 this line called the deep enumerator,
     which reads `sessions` and `orgs` whole in order to use a key, a path and
     a count. The two trees read whole below hold requests and erasure records:
     identifiers and dates, no session content. */
  const locations = await opts.liveLocations();
  const withdrawalsSnap = await db.ref("withdrawals").get();
  const erasuresSnap = await db.ref("erasures").get();
  /* The purge's markers: a session code and a date each. A failed read throws
     like the two above — read as "no markers", every request for a purged
     session would be reported as a record that nothing accounts for. */
  const markersSnap = await db.ref("purgedSessions").get();

  const { pending, overdue, handled, sessionGone, noMarker } = erasureQueue({
    withdrawals: withdrawalsSnap.exists() ? withdrawalsSnap.val() : {},
    erasureRecords: flattenErasures(erasuresSnap.exists() ? erasuresSnap.val() : {}),
    liveLocationKeys: locations.map((loc) => loc.key),
    purgedLocationKeys: Object.keys(purgedMarkers(markersSnap.exists() ? markersSnap.val() : {})),
    now: opts.now,
    deadlineDays: DEADLINE,
  });

  out(`Sessions in database:    ${locations.length}`);
  out(`Erasure requests done:   ${handled}`);
  out(`Erasure requests open:   ${pending.length}`);
  if (sessionGone.length) {
    out(`  session not in the database: ${sessionGone.length}`);
  }
  if (noMarker.length) {
    out(`    of which with no purge marker: ${noMarker.length}`);
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
      (p.sessionInDatabase ? ""
        : p.sessionPurged ? " (session not in the database)"
          : " (session not in the database, no purge marker)"));
  }

  if (overdue.length) {
    err("");
    err(`FAIL: ${overdue.length} erasure request(s) past the ` +
      `${DEADLINE}-day limit in GDPR Art. 12(3).`);
    err("Run scripts/erase-participant.js for each. Read the open " +
      "requests from `withdrawals/` in the database — deliberately not printed " +
      "here, because these logs are public.");
    /* Said here because "run the tool" alone would send the operator to a run
       that refuses, or to one that reports nothing to erase. */
    const purged = overdue.filter((p) => p.sessionPurged).length;
    if (purged) {
      err("");
      err(`${purged} of them name a session that has been purged. The tool answers ` +
        "those too, but only with --uid, and it will not write without " +
        "--research-copy-checked: for a purged session nothing but you takes " +
        "the participant out of the research copy. Run it without " +
        "ERASE_CONFIRM first and read what it cannot reach.");
    }
    const untraced = overdue.filter((p) => !p.sessionInDatabase && !p.sessionPurged).length;
    if (untraced) {
      err("");
      err(`${untraced} of them name a session that is not in the database and has no ` +
        "purge marker: nothing shows it ever existed, and the tool writes no " +
        "record for those. If it was purged before the purge wrote markers " +
        "(2026-10-07), rebuild them from the nightly snapshots with " +
        "scripts/backfill-purged-markers.js; otherwise remove the request with " +
        "erase-participant.js --dismiss. See DPA Annex VI, G12.");
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
  const app = initAdmin();
  return run(getDatabase(), {
    now: Date.now(), deadlineDays, warnDays,
    liveLocations: () => readSessionLocationsShallow({ app, databaseURL: DB_URL }),
  });
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error("FATAL: " + (e && e.message));
    process.exit(2);
  });
}

module.exports = { run };
