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
 * any mechanism. The account is a persistent identifier; the records keyed by
 * it outside a session are what this file reaches:
 *
 *   users/<uid>                          history written by a since-fixed bug
 *   scenarios/<uid>                      the rules permit an anonymous owner
 *   rateLimits/uid/<uid>                 the chat's usage counters
 *   reports/scenarios/<shareId>/<uid>    a moderation report, keyed by reporter
 *
 * Everything INSIDE a session (members, roomOf, clientMapping, …) is already on
 * the session clock and is not touched here.
 *
 * THE RULE THAT SHAPES EVERYTHING BELOW: an account is deleted only when it has
 * been POSITIVELY identified as anonymous from its own Auth record. Never by
 * elimination. A uid that merely fails to appear in the listing is an "orphan",
 * counted and — unless an operator asks — left alone, because "not in the list"
 * is also what a truncated listing looks like, and acting on that would delete
 * signed-in users' profiles and authored scenarios. Under-deleting is
 * recoverable on the next run. Over-deleting is not.
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

/* Firebase-generated uids are 28 base-62 characters. Anything outside this set
   is never turned into a database path: an empty or slash-bearing "uid" in a
   multi-path update would address a parent node. */
const UID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
/* sharedScenarios ids, as the rules validate them. */
const SHARE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
/* One RTDB key: no path separators and none of the characters RTDB forbids. */
const RTDB_KEY = "[^/.$#\\[\\]\\u0000-\\u001f\\u007f]+";

const isUid = (v) => typeof v === "string" && UID_RE.test(v);

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

/** The most recent sign of use, or null when the record carries no usable date. */
function lastActivityMs(acct) {
  let best = null;
  for (const v of [acct.createdMs, acct.lastLoginMs, acct.lastRefreshMs]) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && (best === null || v > best)) {
      best = v;
    }
  }
  return best;
}

/**
 * Sort every account into its fate.
 *
 * @param {Array} accounts normalised accounts (see auth-accounts.js)
 * @param {object} opts { nowMs, windowMs, protectedUids:Set }
 * @returns {{total:number, named:number, anonymous:number, expired:string[],
 *            kept:number, protected:number, undated:number, unusable:number,
 *            anonymousUids:Set<string>, authUids:Set<string>}}
 *   `protected`, `undated` and `unusable` are subsets of what is kept.
 */
function classifyAccounts(accounts, opts) {
  const { nowMs, windowMs } = opts;
  const protectedUids = opts.protectedUids || new Set();
  const out = {
    total: 0, named: 0, anonymous: 0, expired: [], kept: 0,
    protected: 0, undated: 0, unusable: 0,
    anonymousUids: new Set(), authUids: new Set()
  };

  for (const acct of accounts || []) {
    out.total++;
    /* Recorded even when unusable: the account EXISTS, so nothing keyed by it
       may be mistaken for an orphan. */
    if (acct && typeof acct.uid === "string" && acct.uid) out.authUids.add(acct.uid);

    if (!isAnonymous(acct)) { out.named++; continue; }
    out.anonymous++;

    if (!isUid(acct.uid)) { out.unusable++; out.kept++; continue; }
    out.anonymousUids.add(acct.uid);

    const last = lastActivityMs(acct);
    if (last === null) {
      /* Undated: kept, and reported. Treating it as infinitely old would
         delete exactly the records understood least. */
      out.undated++; out.kept++;
      continue;
    }
    if (nowMs - last < windowMs) { out.kept++; continue; }
    if (protectedUids.has(acct.uid)) { out.protected++; out.kept++; continue; }
    out.expired.push(acct.uid);
  }
  out.expired.sort();
  return out;
}

/**
 * Build the database paths to delete.
 *
 * @param {object} cls        result of classifyAccounts()
 * @param {object} keysets    { users:string[], scenarios:string[],
 *                              rateLimitUids:string[],
 *                              reports:{[shareId]:string[]} } — KEYS only
 * @param {object} [opts]     { sweepOrphans:boolean }
 * @returns {{paths:string[], expiredPaths:number, legacyHistory:number,
 *            orphans:{users:number, scenarios:number, rateLimits:number,
 *                     reports:number}, orphanPaths:number, skippedKeys:number}}
 */
function planDeletion(cls, keysets, opts) {
  const sweepOrphans = !!(opts && opts.sweepOrphans);
  const expired = new Set(cls.expired);
  const ks = keysets || {};
  const paths = [];
  const out = {
    paths, expiredPaths: 0, legacyHistory: 0,
    orphans: { users: 0, scenarios: 0, rateLimits: 0, reports: 0 },
    orphanPaths: 0, skippedKeys: 0
  };

  const visit = (keys, kind, pathFor) => {
    for (const uid of keys || []) {
      if (!isUid(uid)) { out.skippedKeys++; continue; }
      if (expired.has(uid)) {
        paths.push(pathFor(uid));
        out.expiredPaths++;
      } else if (!cls.authUids.has(uid)) {
        out.orphans[kind]++;
        if (sweepOrphans) { paths.push(pathFor(uid)); out.orphanPaths++; }
      } else if (kind === "users" && cls.anonymousUids.has(uid)) {
        /* A LIVE anonymous account with a users/ node. The client refuses to
           write a profile for an anonymous user, so what is here is the
           session history the pre-2026-08-25 bug wrote for every joiner — and
           the client refuses to show it to them either. Removed now rather
           than when the account ages out: it should never have existed. */
        paths.push("users/" + uid + "/history");
        out.legacyHistory++;
      }
    }
  };

  visit(ks.users, "users", (uid) => "users/" + uid);
  visit(ks.scenarios, "scenarios", (uid) => "scenarios/" + uid);
  visit(ks.rateLimitUids, "rateLimits", (uid) => "rateLimits/uid/" + uid);
  for (const shareId of Object.keys(ks.reports || {})) {
    if (!SHARE_ID_RE.test(shareId)) { out.skippedKeys++; continue; }
    visit(ks.reports[shareId], "reports",
      (uid) => "reports/scenarios/" + shareId + "/" + uid);
  }
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
      "account listing than abandoned data. Nothing was deleted."
  };
}

const SAFE_PATHS = [
  new RegExp("^users/" + UID_RE.source.slice(1, -1) + "(/history)?$"),
  new RegExp("^scenarios/" + UID_RE.source.slice(1, -1) + "$"),
  new RegExp("^reports/scenarios/" + SHARE_ID_RE.source.slice(1, -1) + "/" +
             UID_RE.source.slice(1, -1) + "$"),
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
  validateWindowDays, isAnonymous, lastActivityMs, classifyAccounts,
  planDeletion, orphanTripwire, assertSafePaths, dropDescendants, chunk, isUid,
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS,
  ORPHAN_FLOOR, ORPHAN_RATIO, DAY_MS, UID_RE, SHARE_ID_RE
};
