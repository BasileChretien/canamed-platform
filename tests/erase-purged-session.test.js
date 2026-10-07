/* tests/erase-purged-session.test.js
 *
 * Carrying out an erasure request whose session has already been purged.
 *
 * THE DEFECT. scripts/erase-participant.js walked the sessions in the
 * database. For a session that had been purged — 30 days after closing, 90
 * after creation, so the ordinary case for anyone who comes back later — it
 * printed "Nothing to erase", exited 0 and wrote nothing. So:
 *   - the request could never be closed: the monitor marks a request done only
 *     when an erasure record carries its session and uid, and none was written;
 *   - the nightly snapshots that still held the session (up to 90) had no
 *     record telling a restore to leave the participant out.
 *
 * These tests RUN the tool (a child process, an in-memory database), then run
 * the things that READ what it wrote: the monitor, the nightly sweep, and the
 * restore's own suppression step. A record that was merely written proves
 * nothing about any of them.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { applySuppression, buildRecord } = require("../scripts/lib/suppression");
const { flattenErasures, erasureQueue } = require("../scripts/lib/data-rights");
const { purgedMarkers } = require("../scripts/lib/session-trees");
const { runOpsScript, at } = require("./fixtures/run-ops-script");

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 7, 10, 0);
const ago = (d) => NOW - d * DAY;
const request = (days) => ({ research: false, erasure: true, at: ago(days) });

function erase(tree, args, env) {
  return runOpsScript("erase-participant.js", { tree, now: NOW, args, env: env || {} });
}
const LIVE = { ERASE_CONFIRM: "1" };
const records = (tree) => flattenErasures(tree.erasures);

/* What the session looked like on the night before it was purged — i.e. what
   the nightly snapshots still hold. Two participants; uidA has two browsers. */
const sessionAsArchived = () => ({
  created: { at: ago(80) }, closed: { at: ago(70) },
  clientMapping: { c1: "uidA", c2: "uidA", c3: "uidB" },
  pool: {
    c1: { name: "Asker", consent: { research: true } },
    c2: { name: "Asker", consent: { research: true } },
    c3: { name: "Bystander", consent: { research: true } },
  },
  members: { uidA: true, uidB: true },
  rooms: { r1: { answers: { moduleA: {
    e1: { cid: "c1", text: "A's answer" }, e2: { cid: "c3", text: "B's answer" },
  } } } },
});

/* The database today: the session is gone, its marker and the request are not. */
const purgedTree = () => ({
  sessions: { "LIVE-1": { created: { at: ago(2) }, clientMapping: { cx: "uidZ" }, pool: { cx: { name: "Z" } } } },
  purgedSessions: { "GONE-1": ago(40) },
  withdrawals: { "GONE-1": { uidA: request(45), uidB: { research: false, at: ago(45) } } },
  users: {
    uidA: {
      profile: { name: "Asker", university: "Caen", updatedAt: 1 },
      history: {
        "GONE-1": { code: "GONE-1", joinedAt: ago(80) },
        "OTHER-9": { code: "OTHER-9", joinedAt: ago(10) },
      },
    },
    uidB: { history: { "GONE-1": { code: "GONE-1", joinedAt: ago(80) } } },
  },
});

const ATTEST = "--research-copy-checked";

// ------------------------------------------------------------ the defect

test("a request for a purged session is carried out: the record is written, and everything that reads it agrees", () => {
  const before = purgedTree();
  const r = erase(before, ["--uid", "uidA", "--session", "GONE-1", "--reason", "Art. 17", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);

  // 1. The suppression record: this person, this session, identifiers only.
  const recs = records(r.tree);
  assert.strictEqual(recs.length, 1, "exactly one record must be written:\n" + r.out);
  assert.deepStrictEqual(recs[0], {
    locationKey: "GONE-1", uid: "uidA",
    at: new Date(NOW).toISOString(), reason: "Art. 17",
    sessionPurged: true, researchCopyChecked: true,
  }, "RTDB stores no empty arrays, so a uid-only record has no clientIds / stableIds");

  // 2. The monitor now counts the request as done.
  const q = erasureQueue({
    withdrawals: r.tree.withdrawals, erasureRecords: recs,
    liveLocationKeys: Object.keys(r.tree.sessions), purgedLocationKeys: Object.keys(purgedMarkers(r.tree.purgedSessions)),
    now: NOW,
  });
  assert.deepStrictEqual([q.pending.length, q.handled], [0, 1],
    "the record does not close the request it was written for");
  const control = erasureQueue({
    withdrawals: before.withdrawals, erasureRecords: [],
    liveLocationKeys: ["LIVE-1"], purgedLocationKeys: ["GONE-1"], now: NOW,
  });
  assert.deepStrictEqual([control.pending.length, control.overdue.length], [1, 1],
    "positive control: before the run the request was open and late");

  // 3. A restore from a snapshot that still holds the session leaves them out.
  const snapshot = { backupTakenAt: "x", sessions: { "GONE-1": sessionAsArchived() } };
  const restored = applySuppression(snapshot, recs).payload.sessions["GONE-1"];
  assert.deepStrictEqual(Object.keys(restored.pool), ["c3"], "the participant came back from the archive");
  assert.deepStrictEqual(restored.clientMapping, { c3: "uidB" });
  assert.deepStrictEqual(Object.keys(restored.rooms.r1.answers.moduleA), ["e2"]);
  assert.deepStrictEqual(restored.members, { uidB: true });
  const unsuppressed = applySuppression(snapshot, []).payload.sessions["GONE-1"];
  assert.deepStrictEqual(Object.keys(unsuppressed.pool).sort(), ["c1", "c2", "c3"],
    "positive control: without the record a restore brings them back");

  // 4. The one row of their history that named the session is gone; the rest
  //    of their account, and everyone else's, is as it was.
  assert.strictEqual(at(r.tree, "users/uidA/history/GONE-1"), null);
  assert.deepStrictEqual(at(r.tree, "users/uidA/history/OTHER-9"), before.users.uidA.history["OTHER-9"]);
  assert.deepStrictEqual(at(r.tree, "users/uidA/profile"), before.users.uidA.profile,
    "asking about one session must not wipe the account");
  assert.deepStrictEqual(r.tree.users.uidB, before.users.uidB);
  assert.deepStrictEqual(r.tree.sessions, before.sessions);
  assert.deepStrictEqual(r.tree.purgedSessions, before.purgedSessions);

  // 5. The request itself is left for the nightly job, which now deletes it —
  //    and leaves the other participant's bare withdrawal to the same rule.
  assert.deepStrictEqual(at(r.tree, "withdrawals/GONE-1/uidA"), before.withdrawals["GONE-1"].uidA);
  const night = runOpsScript("cleanup-stale-sessions.js", {
    tree: r.tree, now: NOW + DAY,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
  });
  assert.strictEqual(night.code, 0, night.out);
  assert.strictEqual(at(night.tree, "withdrawals"), null, "the answered request was never cleared away");
  assert.strictEqual(records(night.tree).length, 1, "the erasure ledger must outlive it");
});

test("the tool as it stood is what this replaces: no record, exit 0", () => {
  /* Kept as a statement of the old contract so the test above cannot pass for
     a reason other than the fix: for a session that is gone AND has no marker,
     the tool still writes no suppression record — now on purpose, and no
     longer silently. */
  const tree = purgedTree();
  delete tree.purgedSessions;
  const r = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(at(r.tree, "erasures"), null);
  assert.notStrictEqual(r.code, 0, "an open request it could not act on must not look like success");
  assert.match(r.out, /no purge marker/i);
  assert.match(r.out, /backfill-purged-markers\.js/);
  assert.match(r.out, /--dismiss/);
  assert.deepStrictEqual(r.tree, tree, "nothing may be written");
});

// ---------------------------------------------------------- how it is asked

test("a dry run is the default: it shows the plan and what it cannot reach, and writes nothing", () => {
  const before = purgedTree();
  const r = erase(before, ["--uid", "uidA"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.tree, before);
  assert.match(r.out, /DRY RUN/);
  assert.match(r.out, /GONE-1/, "the operator must be able to see which session the plan concerns");
  assert.match(r.out, /research dataset/i);
  assert.match(r.out, /certificate/i);
  assert.match(r.out, /--research-copy-checked/);
});

test("it refuses to write without the operator's word on the research copy", () => {
  /* The product tells the participant "You are excluded from the research
     dataset". The export reads only sessions that are in the database, so for
     a purged session that sentence is made true by a person or by nothing. The
     tool cannot check it; it can refuse to call the request done without it. */
  const before = purgedTree();
  const r = erase(before, ["--uid", "uidA", "--session", "GONE-1"], LIVE);
  assert.strictEqual(r.code, 2, r.out);
  assert.deepStrictEqual(r.tree, before, "something was written without the attestation");
  assert.match(r.out, /--research-copy-checked/);
});

test("without --session it finds every open request the person has for a purged session, in both trees", () => {
  const tree = purgedTree();
  tree.purgedSessions.orgs = { "uni-x": { "GONE-2": ago(40) } };
  tree.withdrawals.orgs = { "uni-x": { "GONE-2": { uidA: request(33), uidC: request(33) } } };
  tree.withdrawals["GONE-3"] = { uidA: { research: false, at: ago(5) } };      // no erasure asked
  tree.purgedSessions["GONE-3"] = ago(40);
  const r = erase(tree, ["--uid", "uidA", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(records(r.tree).map((x) => [x.locationKey, x.uid]).sort(),
    [["GONE-1", "uidA"], ["orgs/uni-x/GONE-2", "uidA"]],
    "one record per open request of THIS person; none for another person, " +
    "none for a withdrawal that asked for no erasure");
  assert.strictEqual(Object.keys(r.tree.erasures).length, 1, "one run, one ledger entry");
});

test("a request already answered is not answered twice", () => {
  const tree = purgedTree();
  tree.erasures = { e0: { at: "x", records: [{ locationKey: "GONE-1", uid: "uidA" }] } };
  const r = erase(tree, ["--uid", "uidA", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.tree, tree);
  assert.match(r.out, /Nothing to erase/);

  /* Naming the session does not get round it either: --session adds a session
     with no request in the queue, and must not add one already answered. */
  const named = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(named.code, 0, named.out);
  assert.deepStrictEqual(named.tree, tree, "a second record was written for an answered request");
  assert.match(named.out, /Nothing to erase/);
});

test("a request that reached the operator by another route can be recorded, for a session that has a marker", () => {
  /* An e-mail, say: there is no withdrawal record. --session names the purged
     session; the marker is what shows it existed. */
  const tree = purgedTree();
  delete tree.withdrawals;
  const r = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(records(r.tree).map((x) => [x.locationKey, x.uid, x.sessionPurged]),
    [["GONE-1", "uidA", true]]);

  // ...but never for a session nothing shows existed: `erasures/` is permanent.
  // And a mistyped code is not "an open request with no marker": nobody asked
  // anything about it, so the run must not report one or exit as if it had
  // left a request unanswered.
  const typo = erase(tree, ["--uid", "uidA", "--session", "GONE-1-TYPO", ATTEST], LIVE);
  assert.strictEqual(at(typo.tree, "erasures"), null);
  assert.deepStrictEqual(typo.tree, tree);
  assert.strictEqual(typo.code, 0, typo.out);
  assert.match(typo.out, /Nothing to erase/);
  assert.doesNotMatch(typo.out, /NOT ACTED ON/);
});

test("a purged session can only be addressed by uid", () => {
  /* clientIds are resolved inside a session; with the session gone there is
     nothing to resolve them against, and the request queue is keyed by uid. */
  const tree = purgedTree();
  const r = erase(tree, ["--client-id", "c1", "--session", "GONE-1", ATTEST], LIVE);
  assert.deepStrictEqual(r.tree, tree);
  assert.match(r.out, /--uid/);
});

// ------------------------------------------------- the live path, unchanged

const liveTree = () => ({
  sessions: { "LIVE-1": {
    created: { at: ago(2) },
    clientMapping: { c1: "uidA", c3: "uidB" },
    pool: { c1: { name: "Asker" }, c3: { name: "Bystander" } },
    members: { uidA: true, uidB: true },
  } },
  rosters: { sessions: { "LIVE-1": { uidA: { name: "Asker" }, uidB: { name: "Bystander" } } } },
  users: { uidA: { profile: { name: "Asker", university: "Caen", updatedAt: 1 } } },
  withdrawals: { "LIVE-1": { uidA: request(3) } },
});

test("a session that is in the database is erased as before, needs no attestation, and the run ends", () => {
  const before = liveTree();
  const r = erase(before, ["--uid", "uidA", "--reason", "Art. 17"], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(at(r.tree, "sessions/LIVE-1/pool"), { c3: before.sessions["LIVE-1"].pool.c3 });
  assert.deepStrictEqual(at(r.tree, "sessions/LIVE-1/members"), { uidB: true });
  assert.deepStrictEqual(Object.keys(at(r.tree, "rosters/sessions/LIVE-1")), ["uidB"]);
  assert.strictEqual(at(r.tree, "users/uidA"), null);
  const recs = records(r.tree);
  assert.deepStrictEqual(recs.map((x) => [x.locationKey, x.uid, x.clientIds, x.sessionPurged]),
    [["LIVE-1", "uidA", ["c1"], undefined]], "a live erasure is not marked as a purged-session one");
});

test("one run covers a live session and a purged one — and without the attestation writes neither", () => {
  const tree = Object.assign(liveTree(), { purgedSessions: { "GONE-1": ago(40) } });
  tree.withdrawals["GONE-1"] = { uidA: request(45) };

  const refused = erase(tree, ["--uid", "uidA"], LIVE);
  assert.strictEqual(refused.code, 2, refused.out);
  assert.deepStrictEqual(refused.tree, tree, "the live half was written although the run was refused");

  const done = erase(tree, ["--uid", "uidA", ATTEST], LIVE);
  assert.strictEqual(done.code, 0, done.out);
  assert.deepStrictEqual(records(done.tree).map((x) => x.locationKey).sort(), ["GONE-1", "LIVE-1"]);
  assert.strictEqual(Object.keys(done.tree.erasures).length, 1, "the two halves must land in one update");
  assert.strictEqual(at(done.tree, "sessions/LIVE-1/pool/c1"), null);
});

test("the old guards still hold: no identifier, and a participant nobody matches", () => {
  const none = erase(liveTree(), [], LIVE);
  assert.strictEqual(none.code, 2);
  const before = liveTree();
  const nobody = erase(before, ["--uid", "uidNOBODY", ATTEST], LIVE);
  assert.strictEqual(nobody.code, 0, nobody.out);
  assert.deepStrictEqual(nobody.tree, before);
  assert.match(nobody.out, /Nothing to erase/);
});

// ------------------------------------------------------------------ dismiss

test("--dismiss removes a request that nothing ties to a real session, and only that", () => {
  /* The rules no longer accept such a record, so these are leftovers: written
     before the rule, for a code that never existed or a session purged before
     the purge wrote markers. The monitor counts them for ever otherwise. */
  const tree = purgedTree();
  tree.withdrawals["NEVER-WAS"] = { uidA: request(50), uidB: request(50) };
  const args = ["--uid", "uidA", "--session", "NEVER-WAS", "--dismiss", "--reason", "no such session"];

  const dry = erase(tree, args);
  assert.strictEqual(dry.code, 0, dry.out);
  assert.deepStrictEqual(dry.tree, tree, "a dry run dismissed something");

  const r = erase(tree, args, LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/NEVER-WAS")), ["uidB"]);
  assert.strictEqual(at(r.tree, "erasures"), null, "a dismissal is not an erasure and must not be recorded as one");
  assert.deepStrictEqual(at(r.tree, "withdrawals/GONE-1"), tree.withdrawals["GONE-1"]);
  assert.deepStrictEqual(r.tree.users, tree.users);
});

test("--dismiss refuses anything that could be a real request", () => {
  const tree = Object.assign(purgedTree(), {});
  tree.withdrawals["LIVE-1"] = { uidA: request(3) };
  tree.withdrawals["NEVER-WAS"] = { uidA: request(50) };
  const cases = [
    ["a session that is in the database", ["--uid", "uidA", "--session", "LIVE-1", "--dismiss", "--reason", "x"]],
    ["a session the purge left a marker for", ["--uid", "uidA", "--session", "GONE-1", "--dismiss", "--reason", "x"]],
    ["no reason given", ["--uid", "uidA", "--session", "NEVER-WAS", "--dismiss"]],
    ["no session named", ["--uid", "uidA", "--dismiss", "--reason", "x"]],
    ["no uid", ["--client-id", "c1", "--session", "NEVER-WAS", "--dismiss", "--reason", "x"]],
    ["no such record", ["--uid", "uidQ", "--session", "NEVER-WAS", "--dismiss", "--reason", "x"]],
  ];
  for (const [label, args] of cases) {
    const r = erase(tree, args, LIVE);
    assert.notStrictEqual(r.code, 0, label + ": exited 0\n" + r.out);
    assert.deepStrictEqual(r.tree, tree, label + ": something was written");
  }
});

// ------------------------------------------------------------- the record

test("a suppression record for a purged session is uid-only and says so", () => {
  const rec = buildRecord({
    locationKey: "GONE-1", identity: { uid: "uidA" }, at: "2026-10-07T00:00:00.000Z",
    sessionPurged: true, researchCopyChecked: true,
  });
  assert.deepStrictEqual(rec, {
    locationKey: "GONE-1", uid: "uidA", clientIds: [], stableIds: [],
    at: "2026-10-07T00:00:00.000Z", reason: "erasure request",
    sessionPurged: true, researchCopyChecked: true,
  });
  // The ordinary record is unchanged: no new keys appear on it.
  const live = buildRecord({ locationKey: "L", identity: { uid: "u", clientIds: ["c"] }, at: "t" });
  assert.deepStrictEqual(Object.keys(live).sort(),
    ["at", "clientIds", "locationKey", "reason", "stableIds", "uid"]);
  // A purged-session record needs the uid: there is no session to resolve a
  // clientId against, and the request queue is keyed by uid.
  assert.throws(() => buildRecord({
    locationKey: "GONE-1", identity: { clientIds: ["c1"] }, at: "t", sessionPurged: true,
  }), /uid/);
});
