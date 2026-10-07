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

const { applySuppression, buildRecord, describeReasons } = require("../scripts/lib/suppression");
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

/* The database today: the session is gone, its marker and the request are not.
   The marker backfill has been run (`ops/purgedMarkersBackfilledAt`), which is
   what lets a request be dismissed at all — see "--dismiss is refused until
   the purge markers have been backfilled". */
const purgedTree = () => ({
  ops: { purgedMarkersBackfilledAt: ago(30) },
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
  const r = erase(before, ["--uid", "uidA", "--session", "GONE-1", "--reason", "art17", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);

  // 1. The suppression record: this person, this session, identifiers only.
  const recs = records(r.tree);
  assert.strictEqual(recs.length, 1, "exactly one record must be written:\n" + r.out);
  assert.deepStrictEqual(recs[0], {
    locationKey: "GONE-1", uid: "uidA",
    at: new Date(NOW).toISOString(), reason: "Art. 17 request",
    requestAt: ago(45),
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

test("the REAL restore, run on a snapshot that still holds the session, leaves the person out — in both trees", () => {
  /* The claim that matters most is about scripts/restore-sessions.js, so it is
     that script which runs here: the erasure tool answers two requests for
     purged sessions (one in the default tree, one under an organisation), then
     the restore is given a snapshot from before the purge. */
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tree = purgedTree();
  tree.purgedSessions.orgs = { "uni-x": { "GONE-2": ago(40) } };
  tree.withdrawals.orgs = { "uni-x": { "GONE-2": { uidA: request(45) } } };
  const erased = erase(tree, ["--uid", "uidA", ATTEST], LIVE);
  assert.strictEqual(erased.code, 0, erased.out);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-restore-"));
  try {
    const file = path.join(dir, "snapshot.json");
    fs.writeFileSync(file, JSON.stringify({
      backupTakenAt: new Date(ago(41)).toISOString(), databaseUrl: "https://fake-rtdb.example.test",
      sessions: { "GONE-1": sessionAsArchived(), "orgs/uni-x/GONE-2": sessionAsArchived() },
    }));
    const restore = (db) => runOpsScript("restore-sessions.js", {
      tree: db, now: NOW, args: ["--file", file], env: { RESTORE_CONFIRM: "1" },
    });

    const r = restore(erased.tree);
    assert.strictEqual(r.code, 0, r.out);
    for (const where of ["sessions/GONE-1", "orgs/uni-x/sessions/GONE-2"]) {
      const s = at(r.tree, where);
      assert.notStrictEqual(s, null, where + " was not restored where the platform reads it");
      assert.deepStrictEqual(Object.keys(s.pool), ["c3"], where + ": the erased participant came back");
      assert.deepStrictEqual(s.clientMapping, { c3: "uidB" });
      assert.deepStrictEqual(s.members, { uidB: true });
    }
    assert.strictEqual(at(r.tree, "orgs/orgs"), null,
      "an organisation's session was restored under a path nothing reads");

    // The control: the same restore with the ledger emptied brings them back.
    const without = restore(Object.assign({}, erased.tree, { erasures: undefined }));
    assert.deepStrictEqual(Object.keys(at(without.tree, "sessions/GONE-1/pool")).sort(), ["c1", "c2", "c3"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two runs leave two ledger entries, and the second request is answered by the second", () => {
  /* Erased once; asks again later (same person, same purged session, a new
     date). The first record does not answer the new request, the tool writes a
     second one, and the ledger keeps both. */
  const tree = purgedTree();
  const first = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(Object.keys(first.tree.erasures).length, 1);

  /* The second request carries a date EARLIER than the first erasure — a
     device whose clock is slow, or simply an `at` chosen inside the 24 hours
     the rule allows. Comparing its date with the record's would call it
     answered. It is a different request: its own date differs from the one
     the first record was written for. (Review finding B3.) */
  const later = JSON.parse(JSON.stringify(first.tree));
  later.withdrawals = { "GONE-1": { uidA: { research: false, erasure: true, at: NOW - 3600000 } } };
  const pendingAgain = erasureQueue({
    withdrawals: later.withdrawals, erasureRecords: records(later),
    liveLocationKeys: ["LIVE-1"], purgedLocationKeys: ["GONE-1"], now: NOW + 3 * DAY,
  });
  assert.deepStrictEqual([pendingAgain.pending.length, pendingAgain.handled], [1, 0],
    "a request dated before the last erasure was read as already answered");
  const second = runOpsScript("erase-participant.js", {
    tree: later, now: NOW + 3 * DAY,
    args: ["--uid", "uidA", "--session", "GONE-1", ATTEST], env: LIVE,
  });
  assert.strictEqual(second.code, 0, second.out);
  assert.strictEqual(Object.keys(second.tree.erasures).length, 2,
    "the second run overwrote the first run's ledger entry, or wrote nothing");
  const q = erasureQueue({
    withdrawals: second.tree.withdrawals, erasureRecords: records(second.tree),
    liveLocationKeys: ["LIVE-1"], purgedLocationKeys: ["GONE-1"], now: NOW + 3 * DAY,
  });
  assert.deepStrictEqual([q.pending.length, q.handled], [0, 1]);
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

// ------------------------------ purged, and its code is in the database again

/* A purge marker says a session with this code was purged; the snapshots
   still hold it. If something sits under `sessions/<code>` again, that does
   not un-purge it — and anyone can put something there: a signed-in visitor
   may write their own membership row under ANY code, or create a session
   under a code that is free again. The tool used to skip every key that
   is in the database, so for such a code it said "Nothing to erase … NOT
   ACTED ON" and pointed at --dismiss; --dismiss looked for the marker only
   when the session was absent, so it deleted the request with no suppression
   record. The monitor went green and a restore brought the person back.
   Found by the independent review of this change (its B1). */

const reoccupied = (how) => {
  const tree = purgedTree();
  tree.sessions["GONE-1"] = how === "stranger"
    ? { members: { uidStranger: { at: ago(0.01) } } }
    : { created: { by: "x", at: NOW + 3650 * DAY } };
  return tree;
};

for (const how of ["stranger", "future-dated created"]) {
  test("a request for a purged session is still ANSWERED when its code is in the database again (" + how + ")", () => {
    const before = reoccupied(how);

    const dismissed = erase(before,
      ["--uid", "uidA", "--session", "GONE-1", "--dismiss", "--reason", "nothing to erase"], LIVE);
    assert.strictEqual(dismissed.code, 2, "--dismiss must be refused under a purge marker:\n" + dismissed.out);
    assert.deepStrictEqual(dismissed.tree, before, "the request was deleted without being answered");

    const dry = erase(before, ["--uid", "uidA", "--session", "GONE-1"]);
    assert.doesNotMatch(dry.out, /--dismiss/, "the tool must not point at --dismiss for a purged session");
    assert.match(dry.out, /--research-copy-checked/);

    const r = erase(before, ["--uid", "uidA", "--session", "GONE-1", "--reason", "art17", ATTEST], LIVE);
    assert.strictEqual(r.code, 0, r.out);
    const recs = records(r.tree);
    assert.deepStrictEqual(recs.map((x) => [x.locationKey, x.uid, x.sessionPurged, x.requestAt]),
      [["GONE-1", "uidA", true, ago(45)]]);
    assert.deepStrictEqual(r.tree.sessions, before.sessions, "whatever sits under the code now is not theirs");

    // What it is for: a restore of the pre-purge snapshot leaves them out.
    const restored = applySuppression(
      { backupTakenAt: "x", sessions: { "GONE-1": sessionAsArchived() } }, recs).payload.sessions["GONE-1"];
    assert.deepStrictEqual(Object.keys(restored.pool), ["c3"]);
    // And the monitor's queue has nothing left open.
    const q = erasureQueue({
      withdrawals: r.tree.withdrawals, erasureRecords: recs,
      liveLocationKeys: Object.keys(r.tree.sessions), purgedLocationKeys: ["GONE-1"], now: NOW,
    });
    assert.deepStrictEqual([q.pending.length, q.handled], [0, 1]);
  });
}

test("a purged code that is a real session again: one record, the live work erased, and still the attestation", () => {
  /* A restore, or a code allocated twice. The person is in the session that is
     there now, and was in the one that was purged. One answer covers both: the
     live path's record is re-resolved against every snapshot, old and new. */
  const tree = purgedTree();
  tree.sessions["GONE-1"] = {
    created: { at: ago(3) }, clientMapping: { cNew: "uidA" }, pool: { cNew: { name: "Asker" } },
  };
  const refused = erase(tree, ["--uid", "uidA", "--session", "GONE-1"], LIVE);
  assert.strictEqual(refused.code, 2, "a purged incarnation exists: the research copy still has to be vouched for");
  assert.deepStrictEqual(refused.tree, tree);

  const r = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(at(r.tree, "sessions/GONE-1/pool"), null);
  const recs = records(r.tree);
  assert.strictEqual(recs.length, 1, "one request, one record");
  assert.deepStrictEqual([recs[0].locationKey, recs[0].uid, recs[0].clientIds, recs[0].requestAt],
    ["GONE-1", "uidA", ["cNew"], ago(45)]);
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
  tree.erasures = { e0: { at: new Date(ago(1)).toISOString(), records: [{ locationKey: "GONE-1", uid: "uidA" }] } };
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
  assert.strictEqual(r.code, 3, "it could not act on what it was asked; that is not a clean exit");
});

test("with --uid, a client id the operator supplies goes into the record — the uid alone does not reach every row", () => {
  /* The record is re-resolved against each snapshot through the session's
     mapping tables. A browser that dropped out mid-join left a pool row — with
     the name in it — and NO mapping row, so nothing joins it to the uid, and a
     uid-only record leaves it in a restored session. The tool cannot find such
     a row once the session is gone; it can carry the id if the operator has it. */
  const archived = sessionAsArchived();
  archived.pool.cOrphan = { name: "Asker", consent: { research: true } };      // no clientMapping row
  const snapshot = { backupTakenAt: "x", sessions: { "GONE-1": archived } };

  const uidOnly = erase(purgedTree(), ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  const left = applySuppression(snapshot, records(uidOnly.tree)).payload.sessions["GONE-1"];
  assert.deepStrictEqual(Object.keys(left.pool).sort(), ["c3", "cOrphan"],
    "the limit, stated: a uid-only record does not reach an unmapped pool row");

  const withCid = erase(purgedTree(),
    ["--uid", "uidA", "--client-id", "cOrphan", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(withCid.code, 0, withCid.out);
  assert.deepStrictEqual(records(withCid.tree)[0].clientIds, ["cOrphan"]);
  const clean = applySuppression(snapshot, records(withCid.tree)).payload.sessions["GONE-1"];
  assert.deepStrictEqual(Object.keys(clean.pool), ["c3"]);
});

test("--uid without --session means EVERY session, and the tool says so before it acts", () => {
  /* The request in the queue is for one purged session. The person is also in
     a session that is still in the database, about which they asked nothing.
     `--uid` alone has always meant "erase this person everywhere" — so run
     that way it also deletes their work in the live session and their whole
     account record. That is the contract, pinned here; what must not happen is
     an operator meeting it by surprise. */
  const tree = purgedTree();
  tree.sessions["LIVE-1"].clientMapping.cA = "uidA";
  tree.sessions["LIVE-1"].pool.cA = { name: "Asker" };

  const dry = erase(tree, ["--uid", "uidA"]);
  assert.match(dry.out, /SCOPE/);
  assert.match(dry.out, /every session/i);
  assert.match(dry.out, /--session/);
  assert.deepStrictEqual(dry.tree, tree);

  // Scoped to the request: the live session and the account are untouched.
  const scoped = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
  assert.strictEqual(scoped.code, 0, scoped.out);
  assert.doesNotMatch(scoped.out, /SCOPE/);
  assert.deepStrictEqual(scoped.tree.sessions, tree.sessions);
  assert.deepStrictEqual(at(scoped.tree, "users/uidA/profile"), tree.users.uidA.profile);
  assert.deepStrictEqual(records(scoped.tree).map((x) => x.locationKey), ["GONE-1"]);

  // Unscoped: everything, as it says.
  const all = erase(tree, ["--uid", "uidA", ATTEST], LIVE);
  assert.strictEqual(all.code, 0, all.out);
  assert.strictEqual(at(all.tree, "sessions/LIVE-1/pool/cA"), null);
  assert.strictEqual(at(all.tree, "users/uidA"), null);
  assert.deepStrictEqual(records(all.tree).map((x) => x.locationKey).sort(), ["GONE-1", "LIVE-1"]);
});

test("a flag it does not know stops the run", () => {
  /* `--sesion GONE-1` used to be ignored, and the run went ahead as `--uid`
     alone — which, per the test above, is every session. */
  const tree = purgedTree();
  for (const args of [["--uid", "uidA", "--sesion", "GONE-1", ATTEST],
                      ["--uid", "uidA", "--session", "GONE-1", "--research-copy-check"],
                      ["--uid", "uidA", "stray"],
                      ["--uid", "uidA", "--session", "orgs", ATTEST],
                      ["--uid", "uid/A"], ["--uid"], ["--uid", "uidA", "--session"]]) {
    const r = erase(tree, args, LIVE);
    assert.strictEqual(r.code, 2, JSON.stringify(args) + " was accepted:\n" + r.out);
    assert.deepStrictEqual(r.tree, tree, JSON.stringify(args) + " wrote something");
  }
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
  const r = erase(before, ["--uid", "uidA", "--reason", "Art. 17 request"], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(records(r.tree)[0].reason, "Art. 17 request");
  assert.strictEqual(records(r.tree)[0].requestAt, before.withdrawals["LIVE-1"].uidA.at,
    "the record must name the request it answers, by that request's own date");
  // With no request in the queue (an erasure asked for by other means): 0.
  const unasked = liveTree();
  delete unasked.withdrawals;
  assert.strictEqual(records(erase(unasked, ["--uid", "uidA"], LIVE).tree)[0].requestAt, 0);
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

// ------------------------------------------------------------- the reason

test("the reason written into the ledger comes from a fixed list — it is never free text", () => {
  /* `erasures/` is never deleted, and two jobs read it every day on a hosted
     runner; the participant notice says what they read is the session's
     identifier, the person's technical identifiers, a date and what was asked.
     A field the operator can type anything into — a name, an e-mail address, a
     note about the person — makes that sentence untrue the first time someone
     does. So the tool takes a short code, or the exact text a code stands for,
     and refuses everything else before it reads or writes anything. */
  for (const [given, stored] of [
    [null, "erasure request"],                       // no --reason at all
    ["erasure-request", "erasure request"],
    ["art17", "Art. 17 request"],
    ["Art. 17 request", "Art. 17 request"],          // what the procedure has always shown
    ["ART17", "Art. 17 request"],
    ["art7-3", "Art. 7(3) withdrawal"],
    ["appi35", "APPI Art. 35(5) request"],
    ["controller", "controller instruction"],
  ]) {
    const args = ["--uid", "uidA", "--session", "GONE-1", ATTEST].concat(given === null ? [] : ["--reason", given]);
    const r = erase(purgedTree(), args, LIVE);
    assert.strictEqual(r.code, 0, JSON.stringify(given) + ":\n" + r.out);
    assert.strictEqual(records(r.tree)[0].reason, stored, "given " + JSON.stringify(given));
  }

  const tree = purgedTree();
  for (const given of ["Jane Doe asked by phone", "Art. 17", "art17 - see e-mail of 3 Oct", "jane@example.test", " "]) {
    const live = erase(tree, ["--uid", "uidA", "--session", "GONE-1", ATTEST, "--reason", given], LIVE);
    assert.strictEqual(live.code, 2, JSON.stringify(given) + " was accepted:\n" + live.out);
    assert.deepStrictEqual(live.tree, tree, JSON.stringify(given) + " wrote something");
    assert.match(live.out, /art17/, "the refusal must list what is accepted");
    /* ("Art. 17" is part of a listed reason, so it appears in the list the
       refusal prints; that is not an echo.) */
    if (given.trim() !== "" && !describeReasons().includes(given.trim())) {
      assert.ok(!live.out.includes(given.trim()),
        "the refusal echoed the text back — it is being refused because it may be about a person");
    }
    // A dry run refuses it too: the mistake should surface before ERASE_CONFIRM.
    assert.strictEqual(erase(tree, ["--uid", "uidA", "--reason", given]).code, 2);
  }
});

test("for --dismiss the reason stays free text: it is printed, never stored", () => {
  const tree = purgedTree();
  tree.withdrawals["NEVER-WAS"] = { uidA: request(50) };
  const r = erase(tree,
    ["--uid", "uidA", "--session", "NEVER-WAS", "--dismiss", "--reason", "no snapshot holds this code"], LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /no snapshot holds this code/);
  assert.doesNotMatch(JSON.stringify(r.tree), /no snapshot holds this code/,
    "a dismissal's reason reached the database");
});

test("the ledger's writer refuses a reason outside the list, whoever calls it", () => {
  const base = { locationKey: "L", identity: { uid: "u" }, at: "2026-10-07T00:00:00.000Z" };
  assert.strictEqual(buildRecord(base).reason, "erasure request");
  assert.strictEqual(buildRecord(Object.assign({ reason: "art17" }, base)).reason, "Art. 17 request");
  assert.strictEqual(buildRecord(Object.assign({ reason: "Art. 17 request" }, base)).reason, "Art. 17 request");
  for (const reason of ["anything else", "Art. 17", 7, {}, "  "]) {
    assert.throws(() => buildRecord(Object.assign({ reason }, base)), /fixed list/, JSON.stringify(reason));
  }
});

// ------------------------------------------------------------------ dismiss

test("--dismiss removes a request that nothing ties to a real session, and only that", () => {
  /* With the strict rule on — it is, here: `purgedTree()` has the backfill's
     switch — the rules no longer accept such a record, so these are leftovers:
     written while it was off, for a code that never existed. (A session
     purged before the purge wrote markers has its marker by now; that is what
     the backfill is for, and why nothing is dismissed before it has run.)
     The monitor counts them for ever otherwise. */
  const tree = purgedTree();
  tree.withdrawals["NEVER-WAS"] = { uidA: request(50), uidB: request(50) };
  tree.users.uidA.history["NEVER-WAS"] = { code: "NEVER-WAS", joinedAt: ago(60) };
  const args = ["--uid", "uidA", "--session", "NEVER-WAS", "--dismiss", "--reason", "no such session"];

  const dry = erase(tree, args);
  assert.strictEqual(dry.code, 0, dry.out);
  assert.deepStrictEqual(dry.tree, tree, "a dry run dismissed something");

  const r = erase(tree, args, LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/NEVER-WAS")), ["uidB"]);
  assert.strictEqual(at(r.tree, "erasures"), null, "a dismissal is not an erasure and must not be recorded as one");
  assert.deepStrictEqual(at(r.tree, "withdrawals/GONE-1"), tree.withdrawals["GONE-1"]);
  /* The row of their history that offered the button goes too: left behind, it
     invites the same request again, which the rules would now refuse. Nothing
     else of the account, and nobody else's. */
  assert.strictEqual(at(r.tree, "users/uidA/history/NEVER-WAS"), null);
  assert.deepStrictEqual(Object.keys(at(r.tree, "users/uidA/history")).sort(), ["GONE-1", "OTHER-9"]);
  assert.deepStrictEqual(at(r.tree, "users/uidA/profile"), tree.users.uidA.profile);
  assert.deepStrictEqual(r.tree.users.uidB, tree.users.uidB);
});

test("--dismiss closes a request under a LIVE session when the person left nothing in it", () => {
  /* Someone erased from a session who clicks the button again, or a request
     filed under a session the requester never joined: there is nothing to
     erase, the erasure path says so and writes nothing — and until the session
     was purged (up to 60 days on) nothing could close the request, while the
     monitor stayed red. */
  const tree = purgedTree();
  tree.withdrawals["LIVE-1"] = { uidA: request(35) };
  const args = ["--uid", "uidA", "--session", "LIVE-1", "--dismiss", "--reason", "already erased"];

  const erasure = erase(tree, ["--uid", "uidA", "--session", "LIVE-1"], LIVE);
  assert.deepStrictEqual(erasure.tree, tree, "positive control: the erasure path has nothing to do here");
  assert.match(erasure.out, /Nothing to erase/);
  assert.match(erasure.out, /--dismiss/, "it must say how such a request is closed");

  const r = erase(tree, args, LIVE);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(at(r.tree, "withdrawals/LIVE-1"), null);
  assert.deepStrictEqual(r.tree.sessions, tree.sessions);
  assert.strictEqual(at(r.tree, "erasures"), null);
});

test("--dismiss is refused until the purge markers have been backfilled", () => {
  /* A session purged before the purge wrote markers has none until
     scripts/backfill-purged-markers.js has run — and until then "no purge
     marker" is true of a session that was purged and of a code that never was
     one alike, with or without something under the code today. Dismissing on
     that reading deleted a real, unanswered request (review round 2, F2). The
     warning not to was prose in the operator procedure; it is now a check on
     the switch the backfill sets. */
  const backfilled = purgedTree();
  backfilled.withdrawals["NEVER-WAS"] = { uidA: request(50) };
  backfilled.withdrawals["LIVE-1"] = { uidA: request(35) };
  const notYet = JSON.parse(JSON.stringify(backfilled));
  delete notYet.ops;

  for (const [label, session] of [
    ["no session and no marker", "NEVER-WAS"],
    ["a code that is in the database, where the person has nothing", "LIVE-1"],
  ]) {
    const args = ["--uid", "uidA", "--session", session, "--dismiss", "--reason", "x"];
    const refused = erase(notYet, args, LIVE);
    assert.strictEqual(refused.code, 2, label + ": not refused\n" + refused.out);
    assert.match(refused.out, /REFUSED/, label);
    assert.match(refused.out, /backfill-purged-markers\.js/, label + ": it must say what has to be run first");
    assert.deepStrictEqual(refused.writes, [], label + ": something was written");
    assert.deepStrictEqual(refused.tree, notYet, label);
    /* The allow: the same command on the same database, with the one thing
       that differs — the backfill has run. */
    const allowed = erase(backfilled, args, LIVE);
    assert.strictEqual(allowed.code, 0, label + ": refused although the backfill has run\n" + allowed.out);
    assert.strictEqual(at(allowed.tree, `withdrawals/${session}/uidA`), null, label);
  }

  /* Under a marker the reason for refusing is the marker, switch or no switch:
     the request is to be answered. */
  for (const tree of [backfilled, notYet]) {
    const r = erase(tree, ["--uid", "uidA", "--session", "GONE-1", "--dismiss", "--reason", "x"], LIVE);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /the purge left a marker/);
  }

  /* The ordinary run must not send anyone to a command that will refuse.
     Without the switch it points at the backfill; with it, at --dismiss. */
  for (const session of ["NEVER-WAS", "LIVE-1"]) {
    const before = erase(notYet, ["--uid", "uidA", "--session", session], LIVE);
    assert.strictEqual(before.code, 3, before.out);
    assert.match(before.out, /backfill-purged-markers\.js/, session);
    assert.match(before.out, /--dismiss is refused until/i, session);
    const after = erase(backfilled, ["--uid", "uidA", "--session", session], LIVE);
    assert.strictEqual(after.code, 3, after.out);
    assert.match(after.out, /--dismiss --reason/, session);
    assert.doesNotMatch(after.out, /--dismiss is refused until/i, session);
  }

  /* The same wording when the run DID something first — a second place it is
     printed. `--uid` alone: the person's work in a live session is erased, a
     purged session's request is answered, and the request under the code
     nothing accounts for is reported. */
  for (const [tree, wording] of [[notYet, /--dismiss is refused until/i], [backfilled, /--dismiss --reason/]]) {
    const busy = JSON.parse(JSON.stringify(tree));
    busy.sessions["LIVE-1"].clientMapping.cA = "uidA";
    busy.sessions["LIVE-1"].pool.cA = { name: "Asker" };
    const r = erase(busy, ["--uid", "uidA", ATTEST], LIVE);
    assert.strictEqual(r.code, 3, r.out);
    assert.match(r.out, /ERASED/, "positive control: this is the run that acts, then reports");
    assert.strictEqual(at(r.tree, "sessions/LIVE-1/pool/cA"), null);
    assert.match(r.out, wording);
    if (tree === backfilled) assert.doesNotMatch(r.out, /--dismiss is refused until/i);
  }

  /* The switch cannot be read: nothing is assumed, nothing is written — and
     that is the run FAILING (exit 1, FATAL), not the run refusing a dismissal
     (exit 2): an operator must not read "could not look" as "looked, and no". */
  const blind = runOpsScript("erase-participant.js", {
    tree: backfilled, now: NOW, env: LIVE, throwOn: "ops/purgedMarkersBackfilledAt",
    args: ["--uid", "uidA", "--session", "NEVER-WAS", "--dismiss", "--reason", "x"],
  });
  assert.strictEqual(blind.code, 1, "an unreadable switch was taken for an answer\n" + blind.out);
  assert.match(blind.out, /FATAL/);
  assert.doesNotMatch(blind.out, /REFUSED|DISMISSED/);
  assert.deepStrictEqual(blind.writes, []);
});

test("--dismiss refuses anything that could be a real request", () => {
  const tree = Object.assign(purgedTree(), {});
  tree.withdrawals["LIVE-1"] = { uidA: request(3), uidR: request(3), uidC: request(3) };
  tree.withdrawals["NEVER-WAS"] = { uidA: request(50) };
  // Three ways of having left something in a live session.
  tree.sessions["LIVE-1"].clientMapping.cA = "uidA";
  tree.sessions["LIVE-1"].pool.cA = { name: "Asker" };
  tree.rosters = { sessions: { "LIVE-1": { uidR: { name: "On The Roster" } } } };
  tree.roomChat = { "LIVE-1": { r1: { t1: { role: "user", content: "x", at: 1 } } } };
  tree.roomChatAuthors = { "LIVE-1": { r1: { t1: "uidC" } } };
  const cases = [
    ["a live session the person has work in", ["--uid", "uidA", "--session", "LIVE-1", "--dismiss", "--reason", "x"]],
    ["a live session whose roster names them", ["--uid", "uidR", "--session", "LIVE-1", "--dismiss", "--reason", "x"]],
    ["a live session they wrote chat turns in", ["--uid", "uidC", "--session", "LIVE-1", "--dismiss", "--reason", "x"]],
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

// ------------------------------- a request date the rules accept, whatever it is

test("a request whose date is not a whole number is answered like any other", () => {
  /* The rule on `withdrawals/…/at` asks for a NUMBER inside a window. It does
     not ask for a whole one, so any signed-in visitor can write
     `at: Date.now() + 0.5` — and before the window existed the rule took any
     number up to the present, a negative one included. The record's builder
     refused a stamp that was not a non-negative integer, and the tool passes
     the request's own date straight in: the run died on FATAL, wrote nothing,
     `--dismiss` was refused too, and a `--uid`-only run aborted whole, so the
     person's OTHER sessions were not erased either. One write produced a
     request that could be neither answered nor dismissed. (Review round 2,
     F1 — a regression from stamping records with the request's date.)

     The stamp is compared for equality and nothing else, so any date the
     database can hold is a valid one. This runs the TOOL, on requests the
     rules accept, and then the readers of what it wrote. */
  const nightly = (tree) => runOpsScript("cleanup-stale-sessions.js", {
    tree, now: NOW + DAY,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
  });
  const monitor = (tree) => runOpsScript("data-rights-monitor.js", { tree, now: NOW });

  for (const odd of [ago(35) + 0.5, ago(35) + 0.001, -5, -0.75]) {
    const label = "at=" + String(odd);
    const asked = { research: false, erasure: true, at: odd };

    // 1. A session that is in the database, with the person's work in it.
    const live = liveTree();
    live.withdrawals["LIVE-1"].uidA = asked;
    assert.strictEqual(monitor(live).code, 1, label + ": positive control — the request is open and late");
    const r1 = erase(live, ["--uid", "uidA", "--session", "LIVE-1"], LIVE);
    assert.strictEqual(r1.code, 0, label + ": the live erasure did not run\n" + r1.out);
    assert.doesNotMatch(r1.out, /FATAL/);
    assert.deepStrictEqual(Object.keys(at(r1.tree, "sessions/LIVE-1/pool")), ["c3"], label);
    assert.strictEqual(records(r1.tree).length, 1, label);
    assert.strictEqual(records(r1.tree)[0].requestAt, odd, label + ": the record must carry the request's date as it is");
    assert.strictEqual(monitor(r1.tree).code, 0, label + ": the monitor still counts the request as open");

    // 2. A purged session.
    const gone = purgedTree();
    gone.withdrawals["GONE-1"].uidA = asked;
    const r2 = erase(gone, ["--uid", "uidA", "--session", "GONE-1", ATTEST], LIVE);
    assert.strictEqual(r2.code, 0, label + ": the purged-session request was not answered\n" + r2.out);
    assert.deepStrictEqual(
      records(r2.tree).map((x) => [x.locationKey, x.uid, x.sessionPurged, x.requestAt]),
      [["GONE-1", "uidA", true, odd]], label);
    assert.strictEqual(monitor(r2.tree).code, 0, label);
    // …and the nightly sweep agrees it is answered, and clears it away.
    const night = nightly(r2.tree);
    assert.strictEqual(night.code, 0, night.out);
    assert.strictEqual(at(night.tree, "withdrawals/GONE-1/uidA"), null, label + ": answered, and never swept");
    assert.strictEqual(records(night.tree).length, 1, label);

    // 3. `--uid` alone: this request under one session, real work in another.
    const two = liveTree();
    two.withdrawals["LIVE-1"].uidA = asked;
    two.sessions["LIVE-2"] = { created: { at: ago(5) }, clientMapping: { c7: "uidA" }, pool: { c7: { name: "Asker" } } };
    two.withdrawals["LIVE-2"] = { uidA: request(3) };
    const r3 = erase(two, ["--uid", "uidA"], LIVE);
    assert.strictEqual(r3.code, 0, label + ": one odd date stopped the whole run\n" + r3.out);
    assert.strictEqual(at(r3.tree, "sessions/LIVE-2/pool"), null, label + ": the other session was not erased");
    assert.deepStrictEqual(Object.keys(at(r3.tree, "sessions/LIVE-1/pool")), ["c3"], label);
    assert.deepStrictEqual(
      records(r3.tree).map((x) => [x.locationKey, x.requestAt]).sort(),
      [["LIVE-1", odd], ["LIVE-2", ago(3)]], label);
  }

  /* An unanswered request with such a date is still an unanswered request:
     the stamp of a DIFFERENT request does not close it. */
  const second = purgedTree();
  second.withdrawals["GONE-1"].uidA = { research: false, erasure: true, at: ago(35) + 0.5 };
  second.erasures = { e1: { at: new Date(ago(34)).toISOString(), records: [
    { locationKey: "GONE-1", uid: "uidA", at: new Date(ago(34)).toISOString(), requestAt: ago(35), sessionPurged: true },
  ] } };
  assert.strictEqual(monitor(second).code, 1, "a record stamped for another request closed this one");
});

// ------------------------------------------------------------- the record

test("a suppression record for a purged session is uid-only and says so", () => {
  const rec = buildRecord({
    locationKey: "GONE-1", identity: { uid: "uidA" }, at: "2026-10-07T00:00:00.000Z",
    sessionPurged: true, researchCopyChecked: true,
  });
  assert.deepStrictEqual(rec, {
    locationKey: "GONE-1", uid: "uidA", clientIds: [], stableIds: [],
    at: "2026-10-07T00:00:00.000Z", reason: "erasure request", requestAt: 0,
    sessionPurged: true, researchCopyChecked: true,
  });
  /* Every record carries `requestAt`: the `at` of the request it answers, or 0
     when it was written with no request in the queue. Its PRESENCE is what
     tells a record that is matched to a request by that stamp from an older
     one that can only be compared by date. */
  const live = buildRecord({ locationKey: "L", identity: { uid: "u", clientIds: ["c"] }, at: "t" });
  assert.deepStrictEqual(Object.keys(live).sort(),
    ["at", "clientIds", "locationKey", "reason", "requestAt", "stableIds", "uid"]);
  assert.strictEqual(live.requestAt, 0);
  assert.strictEqual(buildRecord({ locationKey: "L", identity: { uid: "u" }, at: "t", requestAt: 1234 }).requestAt, 1234);
  /* ANY number the database can hold is a valid stamp: the rules ask a
     request's `at` only to be a number, and the stamp is matched for equality.
     The builder used to insist on a non-negative integer and the tool, handed
     a request dated a half millisecond off, died on it (review round 2, F1). */
  for (const odd of [1.5, -1, -0.25, 1759831200000.5]) {
    assert.strictEqual(
      buildRecord({ locationKey: "L", identity: { uid: "u" }, at: "t", requestAt: odd }).requestAt, odd);
  }
  // What it still refuses is what could not have come from a request's `at`,
  // or could not be stored: those are a caller's mistake, not a visitor's.
  for (const bad of ["1234", NaN, Infinity, -Infinity, true, {}]) {
    assert.throws(() => buildRecord({ locationKey: "L", identity: { uid: "u" }, at: "t", requestAt: bad }),
      /requestAt/, "requestAt=" + String(bad));
  }
  // A purged-session record needs the uid: there is no session to resolve a
  // clientId against, and the request queue is keyed by uid.
  assert.throws(() => buildRecord({
    locationKey: "GONE-1", identity: { clientIds: ["c1"] }, at: "t", sessionPurged: true,
  }), /uid/);
});
