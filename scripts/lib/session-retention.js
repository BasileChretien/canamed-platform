"use strict";
/* session-retention.js — is this session due for the nightly purge, and why.
 *
 * ── WHY THIS EXISTS (2026-10-07) ─────────────────────────────────────────
 * cleanup-stale-sessions.js decides per session from two numbers the CLIENT
 * writes: `closed/at` (purge 30 days after) and `created/at` (purge 90 days
 * after, for a session never closed). It compared each with a cutoff and never
 * asked whether the number could be true.
 *
 * So a date in the FUTURE was read as "within retention" — until that date.
 * Measured by running the real script against an in-memory database: a session
 * created with `created.at = now + 10 years` was kept, and kept again when the
 * job was run five years later; the same for a session 200 days old whose
 * `closed.at` was ten years ahead, and for one in the organisation tree. The
 * rules required of both fields only that they be numbers, `created` is written
 * by whoever creates the session (any signed-in visitor while
 * `facilitatorGate/enforce` is off) and `closed` by its admin — so the 30- and
 * 90-day limits the privacy notice publishes could be set aside for a session
 * by its own creator, and a participant's data in it kept indefinitely.
 *
 * The rules now bound both dates to the server clock (database.rules.json).
 * That protects sessions created from here on. It does nothing for a session
 * already in the database, and a rules deploy is not something this job can
 * see — so the decision that closes the hole is the one below: a date later
 * than now cannot be right, and a session carrying one is DUE.
 *
 * Pure — no database, no clock of its own — for the reason backup-marker.js
 * gives: every branch can then be driven in a test, and "five years later" is
 * an argument rather than a wait. tests/session-retention.test.js does that,
 * and then runs the real script in a child process, because a correct
 * function proves nothing about whether main() calls it.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* How far ahead of this run a date may be before it is called impossible.
 *
 * ONE DAY, and it is sized for the honest case, not the dishonest one. These
 * dates are `Date.now()` on the device that created or closed the session. A
 * device clock that is merely fast produces a date a little ahead of the true
 * time, and a session created by one shortly before the nightly run is then
 * "in the future" when the job looks at it. Treating that as due would delete
 * a session that is minutes old. And a clock set to the right wall time in the
 * wrong time zone is off by whole hours — seven or eight for a laptop carried
 * between France and Japan, up to fourteen anywhere. A day covers every such
 * case.
 *
 * The rules bound both dates too, to twelve hours either side of the server
 * clock: wide enough for that laptop, because the client sends its own clock
 * and a refused date means a facilitator cannot create or close a session at
 * all. Sessions written before the rules shipped carry whatever their device
 * said, which is why the decision is made here and not left to the rules.
 *
 * What it costs: a date within the tolerance is taken at face value, so the
 * most anyone gains by dating a session ahead is one day on a 30- or 90-day
 * limit that a daily job already enforces to the nearest day (twelve hours,
 * once the rules are in force).
 *
 * It must stay LARGER than the rules' own allowance, with room to spare, or a
 * date the rules accept could be one this job deletes on sight: the job's
 * clock is a CI runner's, not the database server's.
 * tests/session-retention.test.js reads the allowance out of
 * database.rules.json and fails if the margin goes. */
const FUTURE_DATE_TOLERANCE_MS = MS_PER_DAY;

/* Whole days, never negative: a date a few hours ahead (inside the tolerance)
   reads "0d ago", not "-0d ago". */
function ageInDays(at, now) {
  return Math.max(0, Math.round((now - at) / MS_PER_DAY));
}

/* "3650 days" for the operator's log. Bounded, because the value is whatever a
   client wrote: Number.MAX_VALUE is a valid RTDB number, and nothing here may
   throw on it — a throw is counted as an error and the session is KEPT, which
   would hand the hole straight back to anyone who picked a large enough date. */
function daysAhead(at, now) {
  const d = Math.floor((at - now) / MS_PER_DAY);
  if (!Number.isSafeInteger(d) || d > 36500) return "more than 100 years";
  return d === 1 ? "1 day" : `${d} days`;
}

function isPositiveFinite(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/* A number the database can actually hold. NaN and ±Infinity are not JSON, so
   they cannot come back from RTDB — but `typeof NaN` is "number", every
   comparison against it is false, and a session carrying one would be kept for
   ever. Cheaper to rule it out than to argue it cannot happen. */
function isTimestamp(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Decide one session.
 *
 * `closed/at` wins when it is a number, as it always has: closing a session
 * restarts its clock at 30 days, whatever `created/at` says. A value that is
 * not a number is treated as absent — the rules never allowed one, so it is
 * old or hand-edited data, and it falls through exactly as before.
 *
 * @param {object} opts
 * @param {*} opts.createdAt        `<session>/created/at`, as the database returned it
 * @param {*} opts.closedAt         `<session>/closed/at`, as the database returned it
 * @param {number} opts.now         epoch ms of this run
 * @param {number} opts.closedDays  days a closed session is kept after closing
 * @param {number} opts.openDays    days a never-closed session is kept after creation
 * @returns {{purge: boolean, reason: string, futureDated: boolean}}
 *   `reason` holds ages and nothing else — never a session code, a name or a
 *   uid — so the caller decides alone whether a line may name its session.
 */
function sessionRetentionVerdict(opts) {
  const o = opts || {};
  const { createdAt, closedAt, now, closedDays, openDays } = o;
  /* Refused, not defaulted. Every comparison against NaN is false, so an
   * unusable clock or window would KEEP every session and report a clean run —
   * retention silently not happening, which is what this job exists to
   * prevent. (retention-window.js makes the same argument for the windows.) */
  if (!isPositiveFinite(now)) {
    throw new TypeError("sessionRetentionVerdict: `now` must be the run's time in epoch ms");
  }
  if (!isPositiveFinite(closedDays) || !isPositiveFinite(openDays)) {
    throw new TypeError("sessionRetentionVerdict: `closedDays` and `openDays` must be positive numbers of days");
  }
  const latestPlausible = now + FUTURE_DATE_TOLERANCE_MS;

  if (isTimestamp(closedAt)) {
    if (closedAt > latestPlausible) {
      return {
        purge: true, futureDated: true,
        reason: `closed date is ${daysAhead(closedAt, now)} in the FUTURE — no session can have ` +
          "been closed then, so the date is not trusted; treated as due"
      };
    }
    if (closedAt < now - closedDays * MS_PER_DAY) {
      return { purge: true, futureDated: false,
        reason: `closed ${ageInDays(closedAt, now)}d ago (> ${closedDays}d)` };
    }
    return { purge: false, futureDated: false,
      reason: `closed ${ageInDays(closedAt, now)}d ago (within retention)` };
  }

  if (isTimestamp(createdAt)) {
    if (createdAt > latestPlausible) {
      return {
        purge: true, futureDated: true,
        reason: `created date is ${daysAhead(createdAt, now)} in the FUTURE — no session can have ` +
          "been created then, so the date is not trusted; treated as due"
      };
    }
    if (createdAt < now - openDays * MS_PER_DAY) {
      return { purge: true, futureDated: false,
        reason: `abandoned, created ${ageInDays(createdAt, now)}d ago (> ${openDays}d)` };
    }
    return { purge: false, futureDated: false,
      reason: `open, created ${ageInDays(createdAt, now)}d ago (within retention)` };
  }

  // Sessions written before /created existed have no createdAt. No timestamps
  // at all → very old or malformed → purge defensively.
  return { purge: true, futureDated: false,
    reason: "no timestamps — likely pre-schema or corrupted" };
}

module.exports = { sessionRetentionVerdict, FUTURE_DATE_TOLERANCE_MS, MS_PER_DAY };
