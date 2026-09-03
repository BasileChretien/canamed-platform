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
const { pendingErasures, DEADLINE_DAYS } = require("./lib/data-rights");

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

const DEADLINE = positiveDays("DATA_RIGHTS_DEADLINE_DAYS", DEADLINE_DAYS);
const WARN = positiveDays("DATA_RIGHTS_WARN_DAYS", 21);

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

async function main() {
  initAdmin();
  const db = getDatabase();

  const locations = await readSessionLocations(db);
  const withdrawalsByLocation = {};
  for (const loc of locations) {
    const snap = await db.ref(loc.withdrawalsPath).get();
    if (snap.exists()) withdrawalsByLocation[loc.key] = snap.val() || {};
  }

  const erasuresSnap = await db.ref("erasures").get();
  const records = flattenErasures(erasuresSnap.exists() ? erasuresSnap.val() : {});

  const now = Date.now();
  const { pending, overdue, handled } = pendingErasures(
    withdrawalsByLocation, records, now, DEADLINE);

  console.log(`Sessions checked:        ${locations.length}`);
  console.log(`Erasure requests done:   ${handled}`);
  console.log(`Erasure requests open:   ${pending.length}`);
  console.log(`Deadline:                ${DEADLINE} days (Art. 12(3)); warn at ${WARN}`);

  /* ⚠️ NO uid, NO session code in the output. These logs are world-readable on
     a public repository — the same reason cleanup-stale-sessions runs with
     CLEANUP_QUIET=1. Knowing that a request is late is what an operator needs
     here; knowing WHOSE it is comes from the database, not from CI. */
  for (const p of pending) {
    const age = p.ageDays === null ? "undated" : `${p.ageDays}d`;
    const flag = p.overdue ? "OVERDUE" : (p.ageDays !== null && p.ageDays >= WARN ? "due soon" : "open");
    console.log(`  - request age ${age} [${flag}]`);
  }

  if (overdue.length) {
    console.error("");
    console.error(`FAIL: ${overdue.length} erasure request(s) past the ` +
      `${DEADLINE}-day limit in GDPR Art. 12(3).`);
    console.error("Run scripts/erase-participant.js for each. Read the open " +
      "requests from `withdrawals/` in the database — deliberately not printed " +
      "here, because these logs are public.");
    process.exit(1);
  }

  const soon = pending.filter((p) => p.ageDays !== null && p.ageDays >= WARN);
  if (soon.length) {
    console.log("");
    console.log(`${soon.length} request(s) will pass the deadline within ` +
      `${DEADLINE - WARN} day(s). Acting now avoids a breach, not just a red run.`);
  }
  console.log("");
  console.log("OK — nothing is past the limit.");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL: " + (e && e.message));
  process.exit(2);
});
