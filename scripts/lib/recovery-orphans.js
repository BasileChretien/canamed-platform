"use strict";
/* Recovery records whose session no longer exists — finding them, from keys
 * alone. The deletion itself is scripts/sweep-orphaned-recovery.js.
 *
 * WHY THERE ARE ANY. Creating a session writes a recovery code to
 * `recovery/sessions/<code>` (or `recovery/orgs/<slug>/sessions/<id>`), outside
 * the session subtree. From 2026-05-25, when the code was introduced, until
 * the fix of 2026-10-07 the nightly purge deleted the session and left that
 * node: no script referenced `recovery` at all. The purge deletes it now — but
 * it walks SESSIONS, so a record whose session is already gone is invisible to
 * it for good. This goes the other way: it starts from the records.
 *
 * It is not only the backlog. A signed-in visitor may write a recovery node at
 * a code that has no session — the rule asks that the node and the session's
 * password do not exist yet, and, when the facilitator gate is enforced, that
 * the writer is on its allowlist — and nothing else would ever remove one.
 *
 * NOTHING HERE READS A RECOVERY CODE. Every read is `?shallow=true`, which
 * returns the keys of a node and never a value — so what reaches the machine
 * running this is session codes (the identifier the nightly purge already
 * lists, here including those of sessions that are gone) and not one secret.
 */

const {
  shallowKeysOf,
  sessionLocationsFromKeys,
  readSessionLocationsShallow,
  makeRestShallowReader,
  encodeRestPath
} = require("./session-trees");

/* Paths per multi-path update. Each batch is all-or-nothing and the sweep is
   idempotent, so a batch that fails is simply found again by the next run. */
const BATCH_SIZE = 500;

/**
 * The sweep's reader: the shared shallow REST reader, with each path encoded
 * ONCE on the way in.
 *
 * The sweep is the first job to read lists under `recovery/orgs/<slug>`, and no
 * rule validates that slug (the one under `orgs/` must match /^[a-z0-9-]+$/;
 * this one may be anything a key may be). Put into a URL as it stands, a `?`
 * in it ends the path, and a `%20` asks for a different slug's list.
 *
 * Encoded HERE and not inside the shared reader, which another job calls with
 * paths it has already encoded — see encodeRestPath() in session-trees.js.
 *
 * @param {{app:object, databaseURL:string}} opts as makeRestShallowReader takes
 * @returns {function(string): Promise<object|null>} takes a DATABASE path
 */
function makeSweepReader(opts) {
  const rest = makeRestShallowReader(opts);
  return (path) => rest(encodeRestPath(path));
}

/**
 * The keys of the recovery tree, in both session trees.
 *
 * @param {function(string): Promise<object|null>} fetchShallow
 * @returns {Promise<{codes:string[], orgCodes:Object<string,string[]>}>}
 */
async function readRecoveryKeys(fetchShallow) {
  const codes = shallowKeysOf(await fetchShallow("recovery/sessions"), "recovery/sessions");
  const slugs = shallowKeysOf(await fetchShallow("recovery/orgs"), "recovery/orgs");
  /* No prototype. A slug is whatever its writer typed, `__proto__` included:
     on a plain object that assignment sets the prototype instead of a key, and
     the slug's records are then never listed, counted or deleted. */
  const orgCodes = Object.create(null);
  for (const slug of slugs) {
    const p = "recovery/orgs/" + slug + "/sessions";
    orgCodes[slug] = shallowKeysOf(await fetchShallow(p), p);
  }
  return { codes, orgCodes };
}

/**
 * Which recovery records have no session. PURE.
 *
 * Both sides are turned into paths by the same builder the purge uses
 * (locationFor, via sessionLocationsFromKeys), so "this record belongs to that
 * session" is path equality and cannot drift from what the purge deletes — and
 * a code that exists in two trees is two different records.
 *
 * EMPTY TREES. A tree — the default one, or one org's — that holds recovery
 * records and lists NO session is reported separately, because that is the one
 * state in which every record in it looks orphaned, and it is also what a
 * wrong database or a list that could not really be read looks like. Counted
 * PER TREE, not over the whole database: a single node under any org, which a
 * signed-in visitor can create, would otherwise be enough to say "there are
 * sessions" on behalf of a default tree that listed none. The caller decides
 * what to do about it; this only counts. Org trees are counted and not named:
 * a slug under `recovery/orgs/` is whatever its writer typed.
 *
 * @param {{codes:string[], orgCodes:Object<string,string[]>}} recoveryKeys
 * @param {Array<{recoveryPath:string, orgSlug:string|null}>} liveLocations
 *   every session that exists
 */
function planRecoverySweep(recoveryKeys, liveLocations) {
  const live = new Set(liveLocations.map((l) => l.recoveryPath));
  const records = sessionLocationsFromKeys(recoveryKeys.codes, recoveryKeys.orgCodes);
  const orphans = records.filter((r) => !live.has(r.recoveryPath));

  const treeOf = (l) => (l.orgSlug ? "org:" + l.orgSlug : "default");
  const treesWithSessions = new Set(liveLocations.map(treeOf));
  const emptyTrees = [...new Set(records.map(treeOf))].filter((t) => !treesWithSessions.has(t));

  return {
    records: records.length,
    kept: records.length - orphans.length,
    orphans: orphans.map((r) => r.recoveryPath),
    orphansDefault: orphans.filter((r) => !r.orgSlug).length,
    orphansOrg: orphans.filter((r) => r.orgSlug).length,
    emptyDefaultTree: emptyTrees.includes("default"),
    emptyOrgTrees: emptyTrees.filter((t) => t !== "default").length
  };
}

/**
 * Read both sides and plan.
 *
 * ⚠️ THE ORDER OF THE TWO READS IS THE SAFETY, not a detail. Recovery keys
 * FIRST, sessions SECOND. A session can be created between them, and whichever
 * list is older is the one that does not know about it:
 *
 *   recovery first  -> the new session is missing from the RECOVERY list, so
 *                      its record is simply not considered. Harmless.
 *   sessions first  -> the new session is missing from the SESSION list, its
 *                      record is in the recovery list, and it looks orphaned.
 *                      Deleting it takes away a live session's only way to
 *                      reset a forgotten password, silently.
 *
 * (createSession() issues `created` before the recovery write, on one
 * connection, so a recovery key that is visible implies a session key that is
 * too.) tests/recovery-orphans.test.js records the order of the reads.
 *
 * A session that is purged between the two reads goes the safe way as well: by
 * then the purge has deleted its record itself.
 *
 * @param {function(string): Promise<object|null>} fetchShallow
 */
async function findOrphanedRecovery(fetchShallow) {
  const recoveryKeys = await readRecoveryKeys(fetchShallow);
  const live = await readSessionLocationsShallow({ fetchShallow });
  return Object.assign(planRecoverySweep(recoveryKeys, live), { liveSessions: live.length });
}

/** Split a list into batches of at most `size`. */
function batches(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Delete the given recovery paths, one multi-path update per batch.
 *
 * A batch that fails is reported and SKIPPED, not retried and not fatal: the
 * others are independent of it, and the next run finds whatever is left.
 *
 * @param {object} db a firebase-admin database() handle
 * @param {string[]} paths absolute paths, as planRecoverySweep() returns them
 * @param {object} [opts]
 * @param {number} [opts.batchSize]
 * @param {function(Error, number): void} [opts.onError] called with the error
 *   and the size of the batch it cost
 * @returns {Promise<{deleted:number, failedBatches:number}>}
 */
async function deleteRecoveryRecords(db, paths, opts) {
  const size = (opts && opts.batchSize) || BATCH_SIZE;
  const onError = (opts && opts.onError) || (() => {});
  let deleted = 0, failedBatches = 0;
  for (const batch of batches(paths, size)) {
    const update = {};
    for (const p of batch) update[p] = null;
    try {
      await db.ref().update(update);
      deleted += batch.length;
    } catch (e) {
      failedBatches++;
      onError(e, batch.length);
    }
  }
  return { deleted, failedBatches };
}

/**
 * The log line for a batch that could not be deleted.
 *
 * The error CODE and the size of the batch, never the message: a firebase-admin
 * message can embed the path it failed on, the path ends in a session code, and
 * the log this goes to is world-readable.
 */
function describeBatchError(e, size) {
  const code = e && typeof e.code === "string" && e.code ? e.code : "error";
  return "ERROR    a batch of " + size + " was not deleted: " + code;
}

/**
 * The log line for a run that could not start or could not read.
 *
 * The error's CODE, or failing that its NAME — never its message. A message is
 * free text from wherever the failure happened: a JSON parse error quotes the
 * first characters of the body it choked on, and the body of a list read is
 * session codes.
 */
function describeFatal(e) {
  const pick = (v) => (typeof v === "string" && v ? v : null);
  return "FATAL: " + (pick(e && e.code) || pick(e && e.name) || "error");
}

module.exports = {
  BATCH_SIZE,
  makeSweepReader,
  readRecoveryKeys,
  planRecoverySweep,
  findOrphanedRecovery,
  deleteRecoveryRecords,
  describeBatchError,
  describeFatal,
  batches
};
