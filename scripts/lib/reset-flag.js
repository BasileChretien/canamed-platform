"use strict";
/* scripts/lib/reset-flag.js
 *
 * The OLD password-reset flag, and the three places a leftover one is dropped.
 *
 * WHAT IT WAS. To overwrite a forgotten admin password the client first wrote a
 * flag carrying the session's RECOVERY CODE, in clear, and removed it a moment
 * later. Until the flag moved it was written at
 *
 *     sessions/<code>/_superadminReset          (and the same under an org)
 *
 * which sits inside the session subtree — readable by every member of the
 * session (`.read` cascades). A member watching that node during a reset kept
 * the code, and the code resets the password for as long as the session lives
 * (measured: tests-e2e/emulator/reset-flag-unreadable.spec.js).
 *
 * WHERE IT IS NOW. adminSecrets/<code>/reset/<the writer's uid>: a tree with no
 * read rule at all. The rules no longer let any client write the old node —
 * only delete it — so whatever is found there is a leftover BY DEFINITION: a
 * removal that failed, at some point before the move. No date has to be read
 * to decide that, and none is.
 *
 * THE THREE PLACES, each of which would otherwise carry a leftover onwards:
 *   - the nightly backup   — it archived the session body whole, for 90 days;
 *   - a restore            — it writes an archived body back, and an archive
 *                            taken before the backup learned to strip the node
 *                            may still hold one;
 *   - the nightly purge    — it writes a null there for every session it
 *                            keeps, so one left in the database is gone within
 *                            a day of this shipping.
 * They share this file so that the node's name is spelled once.
 */

/** The old node's key under a session. Nothing writes it any more. */
const LEGACY_RESET_FLAG = "_superadminReset";

/**
 * Where the old flag would be for one session.
 * @param {{path: string}} loc a location from scripts/lib/session-trees.js
 * @returns {string} an absolute database path
 */
function legacyResetFlagPath(loc) {
  return loc.path + "/" + LEGACY_RESET_FLAG;
}

/**
 * A session body without the old flag. The input is never modified: a body that
 * holds none comes back as it is, one that does comes back as a copy.
 * @param {object|null} session
 * @returns {{session: object|null, stripped: boolean}}
 */
function withoutLegacyResetFlag(session) {
  const holdsOne = session !== null && typeof session === "object" &&
    Object.prototype.hasOwnProperty.call(session, LEGACY_RESET_FLAG);
  if (!holdsOne) return { session, stripped: false };
  const copy = Object.assign({}, session);
  delete copy[LEGACY_RESET_FLAG];
  return { session: copy, stripped: true };
}

module.exports = { LEGACY_RESET_FLAG, legacyResetFlagPath, withoutLegacyResetFlag };
