"use strict";
/* Retention decisions for anonymous Firebase Auth accounts — issue #347.
 *
 * Pure: no Firebase, no I/O, no clock. `anonymous-retention-job.js` does the
 * reading and writing; this decides WHAT goes.
 *
 * WHY THIS EXISTS. `signInAnonymously()` mints an Auth account for every
 * visitor, before any consent surface is reached, and nothing ever removed one.
 * The oldest were 101 days old when anyone looked (2026-08-25), still present,
 * never returned to. Auto-deletion of anonymous users is an Identity Platform
 * feature this project does not have, so retention was indefinite by absence of
 * any mechanism. The account is a persistent identifier; what this reaches,
 * outside any session, is:
 *
 *   users/<uid>              history written by a since-fixed bug (#348)
 *
 * (The chat's usage counters, rateLimits/uid/<uid>/…, are also keyed by it.
 * They need no rule here: every one is swept on its own clock within days —
 * see rate-limit-retention.js — long before its account could expire.)
 *
 * Everything INSIDE a session (members, roomOf, clientMapping, …) is already on
 * the session clock and is not touched here.
 *
 * THE RULE THAT SHAPES EVERYTHING BELOW: an account is deleted only on
 * POSITIVE evidence, at every step, and anything that cannot be shown is kept.
 *
 *   - anonymous: its own Auth record lists no sign-in provider — never
 *     because a uid merely failed to appear in the listing;
 *   - idle: it carries a readable last-refresh date and that date is old. A
 *     missing or unreadable date is not "old", it is unknown, and unknown
 *     stays (classifyAccounts);
 *   - not contradicted: the database holds nothing only a signed-in user
 *     could have put there (findContradictions in the job);
 *   - still so a moment before the delete: fetched again, by a different
 *     endpoint (recheck).
 *
 * And the listing as a whole has to look like a listing (listingSanity),
 * because every one of those checks reads fields the server chose to send.
 * Under-deleting is recoverable on the next run. Over-deleting is not.
 *
 * WHAT IS DELIBERATELY LEFT ALONE:
 *   - `scenarios/<uid>`. The client refuses to save a scenario for an
 *     anonymous user, so one existing under an "anonymous" uid is evidence the
 *     account is not what the listing says. It protects the account instead
 *     of being deleted with it.
 *   - `reports/scenarios/<shareId>/<uid>`. A moderation report may concern content
 *     that is still published and that nobody has reviewed. Deleting evidence
 *     on a timer is a product decision, not a retention default.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_RETENTION_DAYS = 90;
/* A FLOOR, because the window arrives from a free-form workflow input: "1"
   would remove an account a day after its owner last used it, mid-course. */
const MIN_RETENTION_DAYS = 7;
/* A CEILING, because the period is a published commitment. A longer window
   would keep identifiers past what participants are told; a shorter one only
   deletes sooner. Same reasoning as MAX_FALLBACK_DAYS in credential-retention. */
const MAX_RETENTION_DAYS = 90;

/* An account used within the last day is left entirely alone, including its
   bug-written history: its owner may be in the middle of creating an account,
   and a job that runs for minutes must not race someone who is typing. */
const QUIET_MS = DAY_MS;

/* Firebase-generated uids are 28 base-62 characters. Anything outside this set
   is never turned into a database path: an empty or slash-bearing "uid" in a
   multi-path update would address a parent node. */
const UID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
/* One RTDB key: no path separators and none of the characters RTDB forbids. */
const RTDB_KEY = "[^/.$#\\[\\]\\u0000-\\u001f\\u007f]+";

const isUid = (v) => typeof v === "string" && UID_RE.test(v);
const usableMs = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

function validateWindowDays(days) {
  if (typeof days !== "number" || !Number.isSafeInteger(days)) {
    return { ok: false, error: JSON.stringify(days) + " is not a whole number of days" };
  }
  if (days < MIN_RETENTION_DAYS) {
    return {
      ok: false,
      error: days + " is below the " + MIN_RETENTION_DAYS + "-day floor. An account " +
        "this recently used may belong to someone in the middle of a course."
    };
  }
  if (days > MAX_RETENTION_DAYS) {
    return {
      ok: false,
      error: days + " exceeds the " + MAX_RETENTION_DAYS + "-day ceiling. That is the " +
        "period the privacy notice states; keeping identifiers longer needs the " +
        "notice changed first."
    };
  }
  return { ok: true, value: days };
}

/** No sign-in provider at all: neither Google nor e-mail/password. */
function isAnonymous(acct) {
  return !!acct && Array.isArray(acct.providers) && acct.providers.length === 0;
}

/**
 * Can this account's idleness be measured at all?
 *
 * It needs a readable LAST-REFRESH date ("when an ID token was last minted for
 * this account", so every account that ever signed in has one), and no date
 * field that was present but garbled. The sign-in date alone is not enough: for
 * a returning participant it never moves.
 */
function isDated(acct) {
  return !!acct && !acct.dateFault && usableMs(acct.lastRefreshMs);
}

/** The most recent sign of use, or null when the record carries no usable date. */
function lastActivityMs(acct) {
  let best = null;
  for (const v of [acct.createdMs, acct.lastLoginMs, acct.lastRefreshMs]) {
    if (usableMs(v) && (best === null || v > best)) best = v;
  }
  return best;
}

/**
 * Sort every account into its fate.
 *
 * @param {Array} accounts normalised accounts (see auth-accounts.js)
 * @param {object} opts { nowMs, windowMs, protectedUids:Set }
 * @returns {{total:number, named:number, anonymous:number, withRefresh:number,
 *            expired:string[], kept:number, protected:number, undated:number,
 *            unusable:number, anonymousUids:Set<string>, quietUids:Set<string>,
 *            authUids:Set<string>}}
 *   `protected`, `undated` and `unusable` are subsets of what is kept.
 *   `quietUids` are the anonymous accounts shown idle for at least a day.
 */
function classifyAccounts(accounts, opts) {
  const { nowMs, windowMs } = opts;
  const protectedUids = opts.protectedUids || new Set();
  const out = {
    total: 0, named: 0, anonymous: 0, withRefresh: 0, expired: [], kept: 0,
    protected: 0, undated: 0, unusable: 0,
    anonymousUids: new Set(), quietUids: new Set(), authUids: new Set()
  };

  for (const acct of accounts || []) {
    out.total++;
    /* Recorded even when unusable: the account EXISTS, so nothing keyed by it
       may be mistaken for an orphan. */
    if (acct && typeof acct.uid === "string" && acct.uid) out.authUids.add(acct.uid);

    if (!isAnonymous(acct)) { out.named++; continue; }
    out.anonymous++;
    if (usableMs(acct.lastRefreshMs)) out.withRefresh++;

    if (!isUid(acct.uid)) { out.unusable++; out.kept++; continue; }
    out.anonymousUids.add(acct.uid);

    if (!isDated(acct)) {
      /* Kept, and reported. Treating it as infinitely old would delete exactly
         the records understood least. */
      out.undated++; out.kept++;
      continue;
    }
    const idleMs = nowMs - lastActivityMs(acct);
    if (idleMs >= QUIET_MS) out.quietUids.add(acct.uid);
    if (idleMs < windowMs) { out.kept++; continue; }
    if (protectedUids.has(acct.uid)) { out.protected++; out.kept++; continue; }
    out.expired.push(acct.uid);
  }
  out.expired.sort();
  return out;
}

/* Does the listing look like a listing of THIS project? Every check above
   reads a field the server chose to send, so a response that silently dropped
   one would make every account look anonymous, or every account look idle.
   These are the three shapes that would take, and each refuses the run. */
const UNDATED_FLOOR = 10;

function listingSanity(cls) {
  if (cls.total > 0 && cls.named === 0) {
    return {
      ok: false,
      error: "no account in the listing has a sign-in provider. This project has " +
        "signed-in facilitators, so that means the provider field is missing " +
        "from the response — and without it every account looks anonymous. " +
        "No account or user record was deleted."
    };
  }
  if (cls.anonymous > 0 && cls.withRefresh === 0) {
    return {
      ok: false,
      error: "no anonymous account carries a last-refresh date. That date is the " +
        "only sign that a returning participant is still active, so without " +
        "it idleness cannot be judged. No account or user record was deleted."
    };
  }
  if (cls.undated > Math.max(UNDATED_FLOOR, cls.anonymous / 2)) {
    return {
      ok: false,
      error: cls.undated + " of " + cls.anonymous + " anonymous accounts have no " +
        "readable last-use date. A few is noise; this many means the date " +
        "format changed. No account or user record was deleted."
    };
  }
  return { ok: true };
}

/**
 * A copy of `cls` in which some uids are SPARED: taken out of `expired` if they
 * were in it, and remembered so that no later step touches anything of theirs.
 * Used for each check that finds a reason to leave an account alone; `counter`
 * records how many it found.
 */
function sparing(cls, uids, counter) {
  const spare = new Set(uids);
  const expired = cls.expired.filter((u) => !spare.has(u));
  const sparedUids = new Set(cls.sparedUids || []);
  for (const u of spare) sparedUids.add(u);
  return Object.assign({}, cls, {
    expired, sparedUids,
    kept: cls.kept + (cls.expired.length - expired.length),
    [counter]: spare.size
  });
}

/**
 * The anonymous accounts that still exist, are not about to be deleted, have
 * been quiet for a day, have not been spared, and have a `users/` node. The
 * client never writes a profile for an anonymous user and never shows them a
 * history, so what sits there is the session history the pre-2026-08-25 bug
 * wrote for every joiner.
 */
function historyCandidates(cls, usersKeys) {
  const expired = new Set(cls.expired);
  const spared = cls.sparedUids || new Set();
  return (usersKeys || []).filter((uid) =>
    isUid(uid) && cls.quietUids.has(uid) && !expired.has(uid) && !spared.has(uid)).sort();
}

/**
 * Judge a fresh fetch of accounts about to be acted on. An account survives
 * only if it is STILL there, STILL anonymous, STILL dated and STILL idle for
 * `idleMs` — someone who came back, or created an account, in the minutes
 * since the listing is dropped.
 *
 * @returns {{still:string[], changed:number, gone:number}}
 *   `gone`: no longer has an account at all, so there is nothing to delete.
 */
function recheck(candidates, freshAccounts, opts) {
  const { nowMs, idleMs } = opts;
  const fresh = new Map();
  for (const a of freshAccounts || []) if (a && a.uid) fresh.set(a.uid, a);
  const out = { still: [], changed: 0, gone: 0 };
  for (const uid of candidates) {
    const a = fresh.get(uid);
    if (!a) { out.gone++; continue; }
    if (!isAnonymous(a) || !isDated(a) || nowMs - lastActivityMs(a) < idleMs) {
      out.changed++;
      continue;
    }
    out.still.push(uid);
  }
  return out;
}

/**
 * Build the database paths to delete.
 *
 * @param {object} sets     { expired:string[], history:string[], authUids:Set }
 * @param {object} keysets  { users:string[], scenarios:string[] } — KEYS only
 * @param {object} [opts]   { sweepOrphans:boolean }
 * @returns {{paths:string[], expiredPaths:number, historyPaths:number,
 *            orphans:{users:number, scenarios:number},
 *            orphanPaths:number, skippedKeys:number}}
 */
function planDeletion(sets, keysets, opts) {
  const sweepOrphans = !!(opts && opts.sweepOrphans);
  const expired = new Set(sets.expired);
  const history = new Set(sets.history);
  const ks = keysets || {};
  const paths = [];
  const out = {
    paths, expiredPaths: 0, historyPaths: 0,
    orphans: { users: 0, scenarios: 0 },
    orphanPaths: 0, skippedKeys: 0
  };

  const visit = (keys, kind, pathFor) => {
    for (const uid of keys || []) {
      if (!isUid(uid)) { out.skippedKeys++; continue; }
      if (expired.has(uid)) {
        /* `scenarios` is never deleted for an account being removed: the job
           treats a scenarios node as evidence against anonymity and spares
           the account, so none reaches here. Skipped rather than trusted. */
        if (kind === "scenarios") continue;
        paths.push(pathFor(uid));
        out.expiredPaths++;
      } else if (!sets.authUids.has(uid)) {
        out.orphans[kind]++;
        if (sweepOrphans) { paths.push(pathFor(uid)); out.orphanPaths++; }
      } else if (kind === "users" && history.has(uid)) {
        paths.push("users/" + uid + "/history");
        out.historyPaths++;
      }
    }
  };

  visit(ks.users, "users", (uid) => "users/" + uid);
  visit(ks.scenarios, "scenarios", (uid) => "scenarios/" + uid);
  return out;
}

/* Trips when an operator asked for orphans to be removed and there are
   implausibly many. Every account deleted by this job takes its records with
   it, so orphans only arise from accounts removed some other way — a handful.
   A large count means the listing is short, not that the data is abandoned. */
const ORPHAN_FLOOR = 10;
const ORPHAN_RATIO = 0.2;

function orphanTripwire(orphanTotal, authTotal) {
  const limit = Math.max(ORPHAN_FLOOR, Math.floor(authTotal * ORPHAN_RATIO));
  if (orphanTotal <= limit) return { ok: true };
  return {
    ok: false,
    error: orphanTotal + " record(s) have no matching account, against " + authTotal +
      " accounts listed (limit " + limit + "). That is more likely an incomplete " +
      "account listing than abandoned data. No account or user record was deleted."
  };
}

const UID = UID_RE.source.slice(1, -1);
const SAFE_PATHS = [
  new RegExp("^users/" + UID + "(/history)?$"),
  /* Reachable only through the orphan sweep. */
  new RegExp("^scenarios/" + UID + "$"),
  /* rateLimits/<scope>/<id> and rateLimits/<scope>/<id>/<bucket> — never the
     scope node or the tree itself. */
  new RegExp("^rateLimits/(uid|session)/" + RTDB_KEY + "(/" + RTDB_KEY + ")?$")
];

/**
 * The last check before a write. Every path must have one of the shapes this
 * job is allowed to delete. A planner bug that produced "users" or
 * "rateLimits/uid" would otherwise null a whole tree in one atomic update.
 */
function assertSafePaths(paths) {
  for (const p of paths) {
    if (typeof p !== "string" || !SAFE_PATHS.some((re) => re.test(p))) {
      /* The SHAPE is reported, never the path: it may contain a uid. */
      const shape = typeof p === "string" ? p.split("/").length + " segment(s)" : typeof p;
      throw new Error("refusing to write: a planned deletion path has an " +
        "unrecognised shape (" + shape + ")");
    }
  }
}

/**
 * Remove duplicates and any path whose ancestor is also listed. RTDB rejects a
 * multi-path update that names both a node and something beneath it.
 */
function dropDescendants(paths) {
  const all = new Set(paths);
  const out = [];
  for (const p of all) {
    /* Every proper prefix, checked directly. Comparing sorted neighbours is not
       enough: "a/b-c" sorts between "a/b" and "a/b/d". */
    let covered = false;
    for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) {
      if (all.has(p.slice(0, i))) { covered = true; break; }
    }
    if (!covered) out.push(p);
  }
  return out.sort();
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

module.exports = {
  validateWindowDays, isAnonymous, isDated, lastActivityMs, classifyAccounts,
  listingSanity, sparing, historyCandidates, recheck, planDeletion, orphanTripwire,
  assertSafePaths, dropDescendants, chunk, isUid,
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, QUIET_MS,
  ORPHAN_FLOOR, ORPHAN_RATIO, UNDATED_FLOOR, DAY_MS, UID_RE
};
