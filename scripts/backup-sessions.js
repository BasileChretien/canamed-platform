#!/usr/bin/env node
/* Daily snapshot of /sessions from the live Realtime Database.
 *
 * Pairs with scripts/cleanup-stale-sessions.js: cleanup PURGES old sessions
 * once their retention window expires; this script ARCHIVES a snapshot
 * before they're purged, so a research-data-loss scenario (database bug,
 * fat-finger purge, malicious wipe) is recoverable.
 *
 * Output: $RUNNER_TEMP/canamed-backup-YYYY-MM-DD.json containing the
 * full /sessions subtree with adminPasswordHash stripped from every
 * session (same as the in-app archive — passwords don't belong in
 * backups).
 *
 * Two delivery modes:
 *   - PRIVATE-REPO mode (no GCS env): the local file is the deliverable;
 *     the GitHub workflow uploads it as a 90-day workflow artifact.
 *   - PUBLIC-REPO mode (BACKUP_GCS_BUCKET set): the file is ALSO uploaded
 *     to a private GCS bucket, so the job can run from the public repo
 *     without exposing PII via world-downloadable artifacts.
 *
 * Env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the SA JSON file
 *   FIREBASE_DATABASE_URL           the RTDB URL (with region suffix)
 *   BACKUP_OUT_PATH                 where to write the JSON (default
 *                                   $RUNNER_TEMP/canamed-backup-DATE.json)
 *   BACKUP_GCS_BUCKET               if set, upload the file to this private
 *                                   GCS bucket (no gs:// prefix)
 *   BACKUP_GCS_PREFIX               object-path prefix in the bucket
 *                                   (default "backups")
 *   BACKUP_REQUIRE_GCS              set to "1" to FAIL when BACKUP_GCS_BUCKET
 *                                   is empty — used by the public-repo
 *                                   workflow so a misconfigured bucket gives
 *                                   a loud red run instead of a backup that
 *                                   silently vanishes with the runner.
 *
 * Exits 0 on success (even if /sessions is empty); non-zero only on
 * infrastructure failure (auth, network, GCS upload, misconfiguration).
 */

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { uploadToGcs } = require("./lib/gcs-archive");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";

const GCS_BUCKET = process.env.BACKUP_GCS_BUCKET || "";
const GCS_PREFIX = (process.env.BACKUP_GCS_PREFIX || "backups").replace(/\/+$/, "");
const REQUIRE_GCS = process.env.BACKUP_REQUIRE_GCS === "1";

function isoDate() {
  // YYYY-MM-DD in UTC — workflows fire on UTC schedule, so UTC dates
  // are predictable across timezones.
  return new Date().toISOString().slice(0, 10);
}

const OUT_PATH = process.env.BACKUP_OUT_PATH
  || path.join(process.env.RUNNER_TEMP || ".", `canamed-backup-${isoDate()}.json`);

async function main() {
  if (REQUIRE_GCS && !GCS_BUCKET) {
    console.error(
      "FATAL: BACKUP_REQUIRE_GCS=1 but BACKUP_GCS_BUCKET is empty.\n" +
      "       Set the PII_ARCHIVE_BUCKET repo variable to a PRIVATE GCS bucket.\n" +
      "       Refusing to run a backup whose only copy would vanish with the runner."
    );
    process.exit(2);
  }

  admin.initializeApp({ databaseURL: DB_URL });
  const db = admin.database();

  console.log("--- CaNaMED daily backup ---");
  console.log(`Database:  ${DB_URL}`);
  console.log(`Out path:  ${OUT_PATH}`);
  console.log(`GCS:       ${GCS_BUCKET ? `gs://${GCS_BUCKET}/${GCS_PREFIX}/` : "(none — local artifact mode)"}`);
  console.log("");

  const snap = await db.ref("sessions").once("value");
  const sessions = snap.val() || {};
  const codes = Object.keys(sessions);
  console.log(`Found ${codes.length} sessions.`);

  // Strip adminPasswordHash from every session — same as the in-app
  // archive does. Passwords are recoverable via the super-admin set
  // panel, so they don't need to live in backups.
  let stripped = 0;
  for (const code of codes) {
    if (sessions[code] && sessions[code].adminPasswordHash) {
      delete sessions[code].adminPasswordHash;
      stripped++;
    }
  }
  console.log(`Stripped adminPasswordHash from ${stripped}/${codes.length} sessions.`);

  const payload = {
    backupTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: codes.length,
    sessions: sessions
  };
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(OUT_PATH, json, "utf8");
  const sizeKb = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${sizeKb} KB).`);

  if (GCS_BUCKET) {
    const destination = `${GCS_PREFIX}/canamed-backup-${isoDate()}.json`;
    const uri = await uploadToGcs({ bucket: GCS_BUCKET, localPath: OUT_PATH, destination });
    console.log(`Uploaded to ${uri}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
