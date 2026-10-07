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
 *   - the KEYS of users/, scenarios/, rateLimits/uid/ and reports/scenarios/
 *   - rateLimits/ whole: uid or session code, a time bucket, a count
 * No name, no e-mail address, no session content, no scenario body, no report
 * text. Every read below is either `shallow` or of a node that holds nothing
 * but identifiers and integers.
 *
 * ORDER OF DELETION. Database records first, the Auth account second, the same
 * order the client's own accountDelete() uses and for the same reason: if the
 * second step fails, the account is still there and the next run finds it
 * again. The other order would strand records under a uid no listing returns.
 * If ANY database write fails, no account is deleted in that run.
 */

const { readSessionLocationsShallow, shallowKeysOf } = require("./session-trees");
const {
  classifyAccounts, planDeletion, orphanTripwire, assertSafePaths,
  dropDescendants, chunk, SHARE_ID_RE
} = require("./anonymous-retention");
const { planRateLimitSweep } = require("./rate-limit-retention");

/* Paths per multi-path update. Each update is atomic; the size is a bound on
   one request, not a correctness requirement. */
const UPDATE_CHUNK = 400;

/** A deliberate "will not run", as opposed to something breaking. */
class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
    this.refusal = true;
  }
}

/* Session codes and room names are free-form RTDB keys ("Room 2"), and these
   paths become REST URLs. */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/* A reader error names the path it failed on, and these paths carry session
   codes. Re-thrown with a label and the status code only, so the caller can
   print the message into a world-readable log. */
function labelled(reader) {
  return async (path, label) => {
    try {
      return await reader(encodePath(path));
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

/** KEYS of the four uid-keyed trees outside any session. */
async function collectKeysets(read) {
  const keys = async (path) => shallowKeysOf(await read.shallow(path, path), path);
  const keysets = {
    users: await keys("users"),
    scenarios: await keys("scenarios"),
    rateLimitUids: await keys("rateLimits/uid"),
    reports: {}
  };
  for (const shareId of await keys("reports/scenarios")) {
    /* An id the rules would never have accepted is not fetched, and is not
       added: planDeletion() counts what it is handed. */
    if (!SHARE_ID_RE.test(shareId)) continue;
    keysets.reports[shareId] = shallowKeysOf(
      await read.shallow("reports/scenarios/" + shareId, "a scenario's reports"),
      "a scenario's reports");
  }
  return keysets;
}

/** The counts a run reports. Built before anything is written, so a dry run
 *  and a live run describe the same plan. */
function reportOf(sessions, cls, plan, sweep, pathCount) {
  return {
    sessions,
    accounts: {
      total: cls.total, named: cls.named, anonymous: cls.anonymous,
      expired: cls.expired.length, kept: cls.kept, protected: cls.protected,
      undated: cls.undated, unusable: cls.unusable
    },
    records: {
      expiredPaths: plan.expiredPaths, legacyHistory: plan.legacyHistory,
      orphans: plan.orphans, orphanPaths: plan.orphanPaths, skippedKeys: plan.skippedKeys
    },
    rateLimits: {
      staleUid: sweep.stale.uid, staleSession: sweep.stale.session,
      kept: sweep.kept, unparsed: sweep.unparsed
    },
    paths: pathCount,
    written: { paths: 0, failedUpdates: 0, errorCodes: [] },
    auth: { deleted: 0, failed: 0, httpStatuses: [], skipped: false }
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

/**
 * Run the job.
 *
 * @param {object} deps
 * @param {function} deps.listAccounts   () => Promise<account[]>
 * @param {function} deps.deleteAccounts (uids) => Promise<{deleted, failed, httpStatuses}>
 * @param {function} deps.fetchShallow   (path) => Promise<keys|null>
 * @param {function} deps.readValue      (path) => Promise<value>
 * @param {function} deps.updateRoot     (multiPathUpdate) => Promise<void>
 * @param {object} opts { nowMs, windowMs, confirm, sweepOrphans }
 * @returns {Promise<object>} a report of COUNTS — no uid, no session code
 */
async function runAnonymousRetention(deps, opts) {
  const { nowMs, windowMs } = opts;
  const sweepOrphans = !!opts.sweepOrphans;
  const read = { shallow: labelled(deps.fetchShallow), value: labelled(deps.readValue) };

  const accounts = await deps.listAccounts();
  if (!accounts.length) {
    /* Every visitor gets an account, so an empty list is a broken listing. */
    throw new Refusal("the account listing came back empty. Nothing was deleted.");
  }

  const { protectedUids, sessions } = await collectProtectedUids(read);
  const cls = classifyAccounts(accounts, { nowMs, windowMs, protectedUids });
  const plan = planDeletion(cls, await collectKeysets(read), { sweepOrphans });

  if (sweepOrphans) {
    const o = plan.orphans;
    const trip = orphanTripwire(o.users + o.scenarios + o.rateLimits + o.reports, cls.total);
    if (!trip.ok) throw new Refusal(trip.error);
  }

  const sweep = planRateLimitSweep(await read.value("rateLimits", "rateLimits"), nowMs);
  const paths = dropDescendants(plan.paths.concat(sweep.paths.map((p) => "rateLimits/" + p)));
  assertSafePaths(paths);

  const report = reportOf(sessions, cls, plan, sweep, paths.length);
  if (!opts.confirm) return report;

  report.written = await writeDeletions(deps.updateRoot, paths);
  if (!cls.expired.length) return report;
  if (report.written.failedUpdates) {
    /* An account goes only after its records. See ORDER OF DELETION above. */
    report.auth.skipped = true;
    return report;
  }
  const res = await deps.deleteAccounts(cls.expired);
  report.auth = {
    deleted: res.deleted, failed: res.failed,
    httpStatuses: res.httpStatuses || [], skipped: false
  };
  return report;
}

module.exports = {
  runAnonymousRetention, collectProtectedUids, collectKeysets, Refusal,
  UPDATE_CHUNK, encodePath
};
