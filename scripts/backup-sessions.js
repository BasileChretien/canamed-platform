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

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");
const path = require("path");
const { uploadToGcs } = require("./lib/gcs-archive");
const { writeBackupMarker } = require("./lib/backup-marker");
const { readSessionLocations } = require("./lib/session-trees");

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

  initializeApp({ databaseURL: DB_URL });
  const db = getDatabase();

  console.log("--- CaNaMED daily backup ---");
  console.log(`Database:  ${DB_URL}`);
  console.log(`Out path:  ${OUT_PATH}`);
  console.log(`GCS:       ${GCS_BUCKET ? `gs://${GCS_BUCKET}/${GCS_PREFIX}/` : "(none — local artifact mode)"}`);
  console.log("");

  // BOTH trees: sessions/<code> and orgs/<slug>/sessions/<id>. Org-scoped
  // sessions had no backup at all until 2026-07-23.
  const locations = await readSessionLocations(db);
  const orgCount = locations.filter(l => l.orgSlug).length;
  console.log(`Found ${locations.length} sessions (${locations.length - orgCount} default, ${orgCount} org-scoped).`);

  // Keyed by location key, not bare code: two orgs may legitimately use the
  // same session code, and keying by code would silently drop one of them.
  const sessions = {};
  for (const loc of locations) sessions[loc.key] = loc.data;

  // Strip adminPasswordHash from every session — same as the in-app
  // archive does. Passwords are recoverable via the super-admin set
  // panel, so they don't need to live in backups.
  let stripped = 0;
  for (const key of Object.keys(sessions)) {
    if (sessions[key] && sessions[key].adminPasswordHash) {
      delete sessions[key].adminPasswordHash;
      stripped++;
    }
  }
  console.log(`Stripped adminPasswordHash from ${stripped}/${locations.length} sessions.`);

  const payload = {
    backupTakenAt: new Date().toISOString(),
    databaseUrl: DB_URL,
    sessionCount: locations.length,
    orgSessionCount: orgCount,
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

    /* AFTER the upload resolves, never before. This marker is what
     * cleanup-stale-sessions consults before it deletes anything (see
     * scripts/lib/backup-marker.js), so it must record "an archive exists",
     * not "a backup was attempted". Writing it earlier would let a failed
     * upload authorise a purge — the precise combination the interlock is
     * there to prevent.
     *
     * Only when GCS_BUCKET is set: the local-artifact path leaves nothing
     * durable behind, so it must not vouch for an archive either.
     *
     * Non-fatal. The backup itself succeeded; failing the job over the
     * bookkeeping write would turn a healthy run red, and the interlock
     * already fails CLOSED on a missing marker — the safe direction. */
    try {
      await writeBackupMarker(db, { sessions: locations.length, uri });
      console.log("Recorded backup marker for the purge interlock.");
    } catch (e) {
      console.warn(`WARN: backup succeeded but the marker write failed: ${e.message}`);
      console.warn("cleanup-stale-sessions will treat this as 'no recent backup' if its gate is armed.");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
