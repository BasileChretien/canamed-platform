#!/usr/bin/env node
"use strict";
/* Delete expired certificate records — Annex VI item G6.
 *
 * `credentials/<certId>` is the public verification record behind a take-home
 * certificate. It deliberately outlives its session: the session and the
 * code->certificate map (certIds/) are purged at 30/90 days by
 * cleanup-stale-sessions.js, while the certificate itself has to survive for as
 * long as it is meant to be verifiable, about five years.
 *
 * Until 2026-08-21, "about five years" was an intention and nothing more.
 * `retentionUntil` was written on every record and capped by the database rules,
 * then never read back — no script referenced it, or `credentials/`, at all. An
 * intention does not satisfy GDPR Art. 5(1)(e), which is why the participant
 * consent text could not state a retention period as fact. This job is what
 * makes it true.
 *
 * WHY THIS IS A SEPARATE JOB from cleanup-stale-sessions.js: these records are
 * on a different clock by design. Riding the session purge would destroy a
 * certificate 30 days after its session closed, which is the opposite of the
 * point. The participant ROSTER, by contrast, IS on the session clock and is
 * purged there — a certificate is verified by hashing the name the verifier
 * types (verify.js -> credentialNameHash(name, cred.session)), so nothing in
 * verification reads the roster and there is no reason to keep names for years.
 *
 * Dry-run by default; set CREDENTIALS_CONFIRM=1 to actually delete. Mirrors
 * cleanup-stale-sessions.js deliberately, including the fail-loud window parser:
 * a negative window puts the cutoff in the future and deletes live records, and
 * a non-numeric one disables retention silently.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS   path to the SA JSON (set by GH Actions)
 *   FIREBASE_DATABASE_URL            the RTDB URL (with region suffix)
 *   CREDENTIALS_RETENTION_DAYS       default 1826 (~5y) — fallback window applied
 *                                    to `at` ONLY when a record carries no usable
 *                                    `retentionUntil`. Records that carry one are
 *                                    judged by it, not by this.
 *   CREDENTIALS_CONFIRM              "1" to actually delete (otherwise just log)
 *   CREDENTIALS_QUIET                "1" to suppress per-record lines. REQUIRED on
 *                                    a PUBLIC repo: the payload contains `session`,
 *                                    which is the session JOIN CODE, and this repo
 *                                    already treats codes as semi-sensitive
 *                                    (cleanup-stale-sessions.yml sets CLEANUP_QUIET
 *                                    for exactly that reason). Cert ids are
 *                                    equally unfit for a world-readable log: they
 *                                    are the read key for a public record.
 */

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { parseRetentionDays } = require("./lib/retention-window");
const { pruneExpiredCredentials } = require("./lib/credential-retention");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

function retentionDays(name, fallback) {
  const r = parseRetentionDays(process.env[name], fallback);
  if (!r.ok) {
    console.error(`FATAL: ${name}=${r.error}. Refusing to run: a negative window ` +
      "puts the cutoff in the future and deletes live records, and a non-numeric " +
      "one disables retention silently.");
    process.exit(2);
  }
  return r.value;
}

/* 1826 days is 5 x 365 + 1 leap day. The database rules cap `retentionUntil` at
   roughly five years from the write, so this fallback matches the ceiling the
   rules already enforce — a record missing the field is treated no more
   generously than one that has it. */
const RETENTION_DAYS = retentionDays("CREDENTIALS_RETENTION_DAYS", 1826);
const CONFIRM = process.env.CREDENTIALS_CONFIRM === "1";
const QUIET = process.env.CREDENTIALS_QUIET === "1";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function main() {
  // initializeApp picks up GOOGLE_APPLICATION_CREDENTIALS automatically
  initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("Certificate retention");
  console.log(`Mode:        ${CONFIRM ? "LIVE — deletions WILL happen" : "DRY-RUN"}`);
  console.log(`Fallback:    ${RETENTION_DAYS}d from 'at', for records with no usable retentionUntil`);

  const res = await pruneExpiredCredentials(db, {
    nowMs: Date.now(),
    fallbackMs: RETENTION_DAYS * MS_PER_DAY,
    confirm: CONFIRM
  });

  if (!QUIET) {
    for (const id of res.expiredIds) {
      console.log(`${CONFIRM ? "PURGE   " : "DRY-RUN "} credentials/${id}`);
    }
  }

  console.log(`Total:       ${res.total}`);
  console.log(`Expired:     ${res.expired}${CONFIRM ? ` (deleted ${res.deleted})` : " (dry-run, nothing deleted)"}`);
  console.log(`Kept:        ${res.kept}`);

  if (res.undated) {
    // Not an error, and deliberately never deleted — see credential-retention.js.
    // Surfaced because a rising count means something is writing records without
    // `at` or `retentionUntil`, which the rules permit (neither is a required
    // child) and which would quietly build an un-expirable population.
    console.log(`Undated:     ${res.undated} kept with no usable date — these can never expire.`);
    console.log("             The rules do not require retentionUntil, so this is possible;");
    console.log("             a non-zero or growing count needs investigating at the write side.");
  }

  if (res.errors) {
    console.error(`Errors:      ${res.errors} deletion(s) failed`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  // Message only, never the stack or the record: this runs on a public repo.
  console.error("FATAL:", e && e.message ? e.message : String(e));
  process.exit(1);
});
