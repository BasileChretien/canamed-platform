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
 *                            keeps, so one left in the database is gone at
 *                            the first run the backup gate lets through after
 *                            this ships (a refused run skips the session pass
 *                            whole, and this with it).
 * The three share this file for the node's name. (Two older lists spell it
 * themselves and are left alone: the research export's drop list in
 * lib/pseudonymise.js, and the in-app archive in the platform's lib.js.)
 *
 * WHEN THIS CAN GO — a state, not a date. Nothing can put a value in the old
 * node once the rules that make it delete-only are live: no client may write
 * it, and a restore withholds it. So:
 *   - the purge's nightly null and the backup's strip are dead code after the
 *     first purge run that (a) follows the rules release and (b) logs
 *     `Leftover reset flags: cleared`;
 *   - the restore's withholding has to outlive every archive taken before the
 *     backup stripped the node — 90 days after this shipped, by the bucket's
 *     lifecycle rule.
 * Until someone has checked both, leave all three: each is one line, and a
 * recovery code in clear is what they stand between.
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
