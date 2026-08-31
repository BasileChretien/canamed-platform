/* backup-marker.js — the handshake between the backup job and the purge job.
 *
 * ── WHY THIS EXISTS (2026-08-31) ─────────────────────────────────────────
 * `cleanup-stale-sessions` and `backup-sessions` had no knowledge of each
 * other. That is fine while both are green, and dangerous the moment they
 * diverge — which is exactly what happened when the billing account closed on
 * 2026-08-27:
 *
 *   backup-sessions      FAILS (GCS needs billing)  -> no archive
 *   cleanup-stale-sessions SUCCEEDS (RTDB is free)  -> still deletes
 *
 * Nothing was lost, only because no session had aged past 30/90 days yet
 * (the run of 2026-08-30 reported `4 kept, 0 purged`). Had one aged out, it
 * would have been deleted with no archive anywhere, and neither job would
 * have reported anything wrong: the purge job would have logged a clean
 * success. That is the failure this module closes.
 *
 * The marker lives in RTDB rather than in GCS ON PURPOSE. Reading GCS to
 * decide whether GCS is healthy fails in the one state that matters — when
 * billing is off, the read itself throws, and a check that cannot run during
 * the incident it was written for is not a check. RTDB is on the free tier
 * and stays up.
 *
 * `ops/` has NO entry in database.rules.json, so root `.read:false` /
 * `.write:false` applies and no client can read or forge it — the same
 * treatment `metrics/` already gets. Only the admin SDK (which bypasses
 * rules) writes here.
 *
 * ⚠ READ THIS BEFORE ARMING THE INTERLOCK. Blocking the purge is NOT
 * automatically the safe choice, and the default is OFF for a reason.
 * Deletion is a LEGAL DUTY (GDPR Art. 5(1)(e) storage limitation, and the
 * 30/90-day windows this platform publishes in its own privacy notice);
 * the backup is operational disaster recovery. If backups are impossible —
 * which is the state today, with no Blaze plan and therefore no GCS — an
 * armed interlock would block deletion FOREVER and convert a missing-archive
 * problem into a permanent retention breach. That is strictly worse.
 *
 * So the interlock is opt-in, and turning it on is an assertion that backups
 * are expected to work. When they are not, the purge job says so on every run
 * instead of staying quiet (see `backupGateReport`).
 */

"use strict";

/* Single source of truth for the node path — imported by both jobs so they
 * cannot drift onto different paths and silently stop talking to each other. */
const BACKUP_MARKER_PATH = "ops/lastBackup";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* Written by backup-sessions.js ONLY after the upload has actually succeeded.
 * Writing it before, or on a partial run, would make the marker a record of
 * "the job started", which is precisely the claim the purge job must not
 * trust. */
async function writeBackupMarker(db, info) {
  const i = info || {};
  const payload = {
    at: typeof i.at === "number" ? i.at : Date.now(),
    sessions: typeof i.sessions === "number" ? i.sessions : null,
    // The gs:// URI, so an operator reading the node can find the artefact.
    // No PII: a bucket path and a count, nothing from inside a session.
    uri: typeof i.uri === "string" ? i.uri : null
  };
  await db.ref(BACKUP_MARKER_PATH).set(payload);
  return payload;
}

async function readBackupMarker(db) {
  const snap = await db.ref(BACKUP_MARKER_PATH).once("value");
  return snap.val();
}

/* PURE — no db, no clock of its own — so every branch below is unit-testable
 * without an emulator. `now` and `maxAgeDays` are injected for the same
 * reason.
 *
 * Returns { fresh, ageDays, reason }. `fresh` is false for a missing,
 * malformed, stale OR future-dated marker. The future-dated case is not
 * hypothetical paranoia: a clock skew or a hand-edited node would otherwise
 * produce a negative age that compares as "fresher than fresh" and would
 * disarm the gate permanently. */
function assessBackupFreshness(opts) {
  const o = opts || {};
  const marker = o.marker;
  const now = typeof o.now === "number" ? o.now : Date.now();
  const maxAgeDays = typeof o.maxAgeDays === "number" ? o.maxAgeDays : 2;

  if (marker == null) {
    return { fresh: false, ageDays: null, reason: "no backup marker has ever been written" };
  }
  const at = marker && marker.at;
  if (typeof at !== "number" || !Number.isFinite(at)) {
    return { fresh: false, ageDays: null, reason: "backup marker has no usable `at` timestamp" };
  }
  const ageMs = now - at;
  const ageDays = ageMs / MS_PER_DAY;
  if (ageMs < 0) {
    return {
      fresh: false,
      ageDays,
      reason: `backup marker is dated in the FUTURE (${new Date(at).toISOString()}) — clock skew or a hand-edited node`
    };
  }
  if (ageDays > maxAgeDays) {
    return {
      fresh: false,
      ageDays,
      reason: `last successful backup was ${ageDays.toFixed(1)}d ago (> ${maxAgeDays}d)`
    };
  }
  return { fresh: true, ageDays, reason: `last successful backup ${ageDays.toFixed(1)}d ago` };
}

/* The decision AND the words for it, together, so the purge job cannot report
 * a state it did not actually reach.
 *
 * `armed=false` never blocks — but it must never be silent either, or the
 * disarmed state becomes indistinguishable from a working one at a glance.
 * That indistinguishability is the whole bug this module exists for. */
function backupGateReport(opts) {
  const o = opts || {};
  const armed = o.armed === true;
  const assessment = assessBackupFreshness(o);

  if (!armed) {
    return {
      block: false,
      line: assessment.fresh
        ? `Backup gate: DISARMED (CLEANUP_REQUIRE_BACKUP != 1). ${assessment.reason}.`
        : `Backup gate: DISARMED (CLEANUP_REQUIRE_BACKUP != 1) — purging WITHOUT a verified archive: ${assessment.reason}.`
    };
  }
  if (!assessment.fresh) {
    return {
      block: true,
      line: `Backup gate: BLOCKED — ${assessment.reason}. Refusing to purge sessions: ` +
        "deleting them now would destroy the only copy. Fix the backup job, or set " +
        "CLEANUP_REQUIRE_BACKUP=0 to purge deliberately without one."
    };
  }
  return { block: false, line: `Backup gate: OK — ${assessment.reason}.` };
}

module.exports = {
  BACKUP_MARKER_PATH,
  writeBackupMarker,
  readBackupMarker,
  assessBackupFreshness,
  backupGateReport
};
