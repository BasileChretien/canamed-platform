"use strict";
/* Orchestration for the anonymous-account retention job — issue #347.
 *
 * The decisions live in anonymous-retention.js and rate-limit-retention.js;
 * this file does the reading and the writing, with every dependency injected
 * so the whole run can be driven against fakes (tests/anonymous-retention-job
 * .test.js). scripts/cleanup-anonymous-accounts.js wires in the real ones.
 *
 * WHAT CROSSES TO THE RUNNER, and nothing else:
 *   - per Auth account: uid, three dates, the names of its sign-in providers
 *   - per live session: the uids of its members and of its creator
 *   - the uids on the two operator allowlists (facilitatorGate/allow,
 *     moderators)
 *   - the KEYS of users/ and scenarios/, and of each quiet anonymous
 *     account's users/ node ("history", "profile" — never what is in them)
 *   - the KEYS of rateLimits/: uid or session code, and the time buckets
 * No name, no e-mail address, no session content, no scenario body. Every
 * database read below is `shallow` except one: a session's `creatorUid`.
 * privacy.html section 6 lists the same things; keep the two in step.
 *
 * TWO PHASES, AND THE FIRST DOES NOT DEPEND ON THE SECOND.
 *
 * Phase 1 sweeps the chat's rate-limit counters. It needs nothing from Firebase
 * Auth, so it runs — and writes — before the account listing is even asked
 * for. The notice promises those counters gone within about three days; if
 * that promise hung on the account half, every refused or failed listing would
 * quietly break it. A participant can also write under their own counters,
 * which makes this the one read an outsider could cause to fail: it is read
 * per id, each failure is counted, and nothing here can stop phase 2.
 *
 * Phase 2 removes idle anonymous accounts, in this order and for these reasons:
 *   1. record keys BEFORE the account listing. An orphan is "a key with no
 *      account"; read the other way round, someone who signed up in between
 *      would have a key and no place in the list.
 *   2. list, classify, sanity-check the listing as a whole.
 *   3. spare anything the database contradicts.
 *   4. RE-CHECK every account about to be acted on, by fetching it again. The
 *      listing is minutes old by now, and the delete is irreversible. No
 *      database read comes after this.
 *   5. database records first, the Auth account second — the order the
 *      client's own accountDelete() uses and for the same reason: if the
 *      second step fails the account is still there and the next run finds it
 *      again. If any write of those RECORDS fails, no account is deleted in
 *      that run.
 */

const { readSessionLocationsShallow, shallowKeysOf } = require("./session-trees");
const {
  classifyAccounts, listingSanity, sparing, historyCandidates, recheck, planDeletion,
  orphanTripwire, assertSafePaths, dropDescendants, chunk, QUIET_MS
} = require("./anonymous-retention");
const { planRateLimitSweep, SCOPES } = require("./rate-limit-retention");

/* Paths per multi-path update. Each update is atomic; the size is a bound on
   one request, not a correctness requirement. */
const UPDATE_CHUNK = 400;
/* Without one, a stalled read runs to the workflow's timeout, which GitHub
   records as "cancelled" and mails nobody about. */
const READ_TIMEOUT_MS = 60 * 1000;

/** A deliberate "will not run", as opposed to something breaking. */
class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
    this.refusal = true;
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error("timed out");
      e.code = "TIMEOUT";
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* Session codes and room names are free-form RTDB keys ("Room 2"), and these
   paths become REST URLs. */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/* A reader error names the path it failed on, and these paths carry session
   codes and uids. Re-thrown with a label and the status code only, so the
   caller can print the message into a world-readable log. */
function labelled(reader) {
  return async (path, label) => {
    try {
      return await withTimeout(reader(encodePath(path)), READ_TIMEOUT_MS);
    } catch (e) {
      throw new Error("could not read " + label + ": " + ((e && e.code) || "error"));
    }
  };
}

/**
 * Uids that must not be deleted however long they have been idle: anyone a
 * LIVE session still refers to, and anyone an operator has allowlisted by uid.
 *
 * The session half is what makes the retention period true in the awkward
 * case. A session closed on its 89th day lives another 30, so an account idle
 * for 90 days can still be a member of something that exists; deleting it would
 * leave that session pointing at a uid nobody can sign in as.
 */
async function collectProtectedUids(read) {
  const protectedUids = new Set();
  const locations = await readSessionLocationsShallow({
    fetchShallow: (p) => read.shallow(p, "the session list")
  });
  for (const loc of locations) {
    const members = await read.shallow(loc.path + "/members", "a session's member list");
    for (const uid of shallowKeysOf(members, "a session's member list")) protectedUids.add(uid);
    const creator = await read.value(loc.path + "/creatorUid", "a session's creator");
    if (typeof creator === "string" && creator) protectedUids.add(creator);
  }
  for (const node of ["facilitatorGate/allow", "moderators"]) {
    for (const uid of shallowKeysOf(await read.shallow(node, node), node)) protectedUids.add(uid);
  }
  return { protectedUids, sessions: locations.length };
}

/** KEYS of the two uid-keyed trees this job may delete from. */
async function collectKeysets(read) {
  const keys = async (path) => shallowKeysOf(await read.shallow(path, path), path);
  return { users: await keys("users"), scenarios: await keys("scenarios") };
}

/**
 * Accounts the listing calls anonymous but the database suggests are not.
 *
 * The client writes `users/<uid>/profile` and `scenarios/<uid>` only for a
 * signed-in user. Finding either under an "anonymous" uid means the listing
 * and the database disagree about who this is, and the account is spared: of
 * the two ways to be wrong, keeping a real anonymous account costs nothing.
 *
 * A `users/` node that cannot be read, or is not a node at all, spares its
 * account too and is counted. It is not allowed to stop the run — the owner
 * can write there, so one participant could otherwise halt retention for all.
 */
async function findContradictions(read, cls, keysets) {
  const scenarios = new Set(keysets.scenarios);
  const contradicted = new Set();
  let readErrors = 0;
  for (const uid of cls.anonymousUids) if (scenarios.has(uid)) contradicted.add(uid);

  for (const uid of keysets.users) {
    /* Only accounts this run might act on. Anything used in the last day is
       left alone regardless, so there is nothing to corroborate. */
    if (!cls.quietUids.has(uid) || contradicted.has(uid)) continue;
    let node;
    try {
      node = await read.shallow("users/" + uid, "a user node");
    } catch {
      readErrors++;
      contradicted.add(uid);
      continue;
    }
    if (node === null || node === undefined) continue;
    if (typeof node !== "object" || Array.isArray(node) ||
        Object.prototype.hasOwnProperty.call(node, "profile")) {
      contradicted.add(uid);
    }
  }
  return { contradicted: [...contradicted], readErrors };
}

/**
 * Fetch again every account about to be acted on and keep only those that are
 * still what the listing said. Throws if the fetch fails: a re-check that
 * could not be made is not a re-check that passed.
 */
async function recheckCandidates(lookupAccounts, cls, history, opts) {
  const candidates = [...new Set(cls.expired.concat(history))];
  if (!candidates.length) return { expired: [], history: [], changed: 0, gone: 0 };
  const fresh = await lookupAccounts(candidates);
  const e = recheck(cls.expired, fresh, { nowMs: opts.nowMs, idleMs: opts.windowMs });
  const h = recheck(history, fresh, { nowMs: opts.nowMs, idleMs: QUIET_MS });
  return {
    expired: e.still, history: h.still,
    changed: e.changed + h.changed, gone: e.gone + h.gone
  };
}

/**
 * Plan the rate-limit sweep from KEYS alone, one small read per counter.
 * Never throws: see the note at the top about why this must not block.
 */
async function planRateLimits(read, nowMs) {
  const tree = Object.create(null);
  let readErrors = 0;
  for (const scope of SCOPES) {
    tree[scope] = Object.create(null);
    let ids;
    try {
      const label = "rateLimits/" + scope;
      ids = shallowKeysOf(await read.shallow(label, label), label);
    } catch {
      readErrors++;
      continue;
    }
    for (const id of ids) {
      try {
        const buckets = await read.shallow("rateLimits/" + scope + "/" + id, "a rate-limit counter");
        if (buckets !== null && buckets !== undefined) tree[scope][id] = buckets;
      } catch {
        readErrors++;
      }
    }
  }
  const sweep = planRateLimitSweep(tree, nowMs);
  return {
    paths: sweep.paths.map((p) => "rateLimits/" + p),
    counts: {
      staleUid: sweep.stale.uid, staleSession: sweep.stale.session,
      kept: sweep.kept, unparsed: sweep.unparsed, readErrors
    }
  };
}

/** Null every path, one atomic update per chunk. A failed chunk is counted,
 *  not thrown: the remaining chunks still run, and the caller decides what a
 *  failure means for the accounts. */
async function writeDeletions(updateRoot, paths) {
  const written = { paths: 0, failedUpdates: 0, errorCodes: [] };
  for (const part of chunk(paths, UPDATE_CHUNK)) {
    const update = {};
    for (const p of part) update[p] = null;
    try {
      await updateRoot(update);
      written.paths += part.length;
    } catch (e) {
      written.failedUpdates++;
      const code = (e && e.code) || "error";
      if (!written.errorCodes.includes(code)) written.errorCodes.push(code);
    }
  }
  return written;
}

/** The counts a run reports. Built before anything is written, so a dry run
 *  and a live run describe the same plan. */
function reportOf({ sessions, cls, checked, plan, found, limits, pathCount }) {
  return {
    sessions,
    accounts: {
      total: cls.total, named: cls.named, anonymous: cls.anonymous,
      expired: checked.expired.length, kept: cls.anonymous - checked.expired.length,
      protected: cls.protected, undated: cls.undated, unusable: cls.unusable,
      contradicted: cls.contradicted, recheckChanged: checked.changed,
      recheckGone: checked.gone
    },
    records: {
      expiredPaths: plan.expiredPaths, historyPaths: plan.historyPaths,
      orphans: plan.orphans, orphanPaths: plan.orphanPaths,
      skippedKeys: plan.skippedKeys, readErrors: found.readErrors
    },
    rateLimits: limits.counts,
    paths: pathCount,
    written: { paths: 0, failedUpdates: 0, errorCodes: [] },
    auth: { deleted: 0, failed: 0, httpStatuses: [], networkErrors: 0, skipped: false }
  };
}

/**
 * Phase 2, up to the point of writing: which accounts and records would go,
 * and the counts that describe them. Throws a Refusal when the account half
 * should not proceed.
 */
async function planAccounts(deps, read, opts) {
  const { nowMs, windowMs } = opts;
  const sweepOrphans = !!opts.sweepOrphans;

  const keysets = await collectKeysets(read);
  const accounts = await deps.listAccounts();
  if (!accounts.length) {
    /* Every visitor gets an account, so an empty list is a broken listing. */
    throw new Refusal(
      "the account listing came back empty. No account or user record was deleted.");
  }
  const { protectedUids, sessions } = await collectProtectedUids(read);
  let cls = classifyAccounts(accounts, { nowMs, windowMs, protectedUids });
  const sane = listingSanity(cls);
  if (!sane.ok) throw new Refusal(sane.error);

  /* The last database reads. Nothing is read after the re-check below: it is
     only worth anything if nothing slow comes between it and the delete. */
  const found = await findContradictions(read, cls, keysets);
  cls = sparing(cls, found.contradicted, "contradicted");
  const checked = await recheckCandidates(
    deps.lookupAccounts, cls, historyCandidates(cls, keysets.users), opts);

  const plan = planDeletion(
    { expired: checked.expired, history: checked.history, authUids: cls.authUids },
    keysets, { sweepOrphans });
  if (sweepOrphans) {
    const trip = orphanTripwire(plan.orphans.users + plan.orphans.scenarios, cls.total);
    if (!trip.ok) throw new Refusal(trip.error);
  }

  const paths = dropDescendants(plan.paths);
  assertSafePaths(paths);
  return { paths, expired: checked.expired, parts: { sessions, cls, checked, plan, found } };
}

const noWrites = () => ({ paths: 0, failedUpdates: 0, errorCodes: [] });

function addWrites(a, b) {
  return {
    paths: a.paths + b.paths,
    failedUpdates: a.failedUpdates + b.failedUpdates,
    errorCodes: [...new Set(a.errorCodes.concat(b.errorCodes))]
  };
}

/**
 * Run the job.
 *
 * @param {object} deps
 * @param {function} deps.listAccounts   () => Promise<account[]>
 * @param {function} deps.lookupAccounts (uids) => Promise<account[]>
 * @param {function} deps.deleteAccounts (uids) => Promise<{deleted, failed, …}>
 * @param {function} deps.fetchShallow   (path) => Promise<keys|null>
 * @param {function} deps.readValue      (path) => Promise<value>
 * @param {function} deps.updateRoot     (multiPathUpdate) => Promise<void>
 * @param {object} opts { nowMs, windowMs, confirm, sweepOrphans }
 * @returns {Promise<object>} a report of COUNTS — no uid, no session code
 */
async function runAnonymousRetention(deps, opts) {
  const read = { shallow: labelled(deps.fetchShallow), value: labelled(deps.readValue) };

  /* PHASE 1 — the counters. Planned, checked and written before anything is
     asked of Firebase Auth. */
  const limits = await planRateLimits(read, opts.nowMs);
  const limitPaths = dropDescendants(limits.paths);
  assertSafePaths(limitPaths);
  const swept = opts.confirm ? await writeDeletions(deps.updateRoot, limitPaths) : noWrites();

  /* PHASE 2 — the accounts. */
  let acc;
  try {
    acc = await planAccounts(deps, read, opts);
  } catch (e) {
    /* Phase 1 has already happened. Whoever reports this failure should be
       able to say so: counts only, like everything else that is printed. */
    if (e && typeof e === "object") e.rateLimits = Object.assign({ written: swept }, limits.counts);
    throw e;
  }
  const { paths, expired } = acc;
  const report = reportOf(Object.assign({}, acc.parts,
    { limits, pathCount: limitPaths.length + paths.length }));
  report.written = swept;
  if (!opts.confirm) return report;

  const records = await writeDeletions(deps.updateRoot, paths);
  report.written = addWrites(swept, records);
  if (!expired.length) return report;
  if (records.failedUpdates) {
    /* An account goes only after its records. See phase 2, step 5, above. */
    report.auth.skipped = true;
    return report;
  }
  const res = await deps.deleteAccounts(expired);
  report.auth = {
    deleted: res.deleted, failed: res.failed,
    httpStatuses: res.httpStatuses || [], networkErrors: res.networkErrors || 0,
    skipped: false
  };
  return report;
}

module.exports = {
  runAnonymousRetention, collectProtectedUids, collectKeysets, findContradictions,
  planRateLimits, Refusal, withTimeout, UPDATE_CHUNK, READ_TIMEOUT_MS, encodePath
};
