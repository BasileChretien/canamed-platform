/* tests/withdrawal-retention.test.js
 *
 * An erasure request must outlive its session until someone has answered it.
 *
 * THE DEFECT, MEASURED. The nightly purge deleted `withdrawals/<code>` whole,
 * in the update that deletes the session. On the real schedule — purge 03:17
 * UTC, data-rights monitor 04:11 UTC — that removed any unanswered erasure
 * request, whenever it had been made:
 *
 *   made 10 minutes after the session closed      0 red runs, then deleted
 *   made 20 days after it closed                  0 red runs, then deleted
 *   made 2 hours BEFORE it closed                 0 red runs, then deleted
 *   made 5 days before it closed                  red 5 days, then green by
 *                                                 itself at the purge
 *   day 70 of a session that was never closed     0 red runs, then deleted
 *
 * No erasure record existed in any of them, so nothing told a restore from
 * the nightly snapshots to leave the participant out.
 *
 * So these tests do what the measurement did: RUN the purge
 * (scripts/cleanup-stale-sessions.js, in a child process, against an in-memory
 * database), then hand the database it leaves to the monitor.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { planPurgedSessionWithdrawals, isOpenRequest } = require("../scripts/lib/withdrawal-retention");
const { answeredKeys, pendingErasures } = require("../scripts/lib/data-rights");
const { readSessionLocationsShallow } = require("../scripts/lib/session-trees");
const { run: runMonitor } = require("../scripts/data-rights-monitor");
const { runOpsScript, at } = require("./fixtures/run-ops-script");

const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const D0 = Date.UTC(2026, 5, 1);                       // a midnight, UTC
const PURGE_AT = 3 * HOUR + 17 * MIN;                  // cleanup-stale-sessions.yml
const MONITOR_AT = 4 * HOUR + 11 * MIN;                // data-rights-monitor.yml

const request = (when) => ({ research: false, erasure: true, at: when });

/* The purge as its cron runs it: live, quiet. The backup gate is disarmed so
   the session pass runs; the gate has its own tests. */
function purge(tree, now, env) {
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree, now,
    env: Object.assign({ CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" }, env),
  });
  assert.strictEqual(r.code, 0, "the purge failed:\n" + r.out);
  return r;
}

/* The monitor's own run(), over the database the purge left, with the real
   keys-only enumerator. */
async function monitor(tree, now) {
  const lines = [];
  const snap = (p) => { const v = at(tree, p); return { exists: () => v !== null, val: () => v }; };
  const db = { ref: (p) => ({ get: async () => snap(p), once: async () => snap(p) }) };
  const fetchShallow = async (p) => {
    const node = at(tree, p);
    return node !== null && typeof node === "object"
      ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null;
  };
  const code = await runMonitor(db, {
    now, deadlineDays: 30, warnDays: 21,
    liveLocations: () => readSessionLocationsShallow({ fetchShallow }),
    out: (l) => lines.push(String(l)), err: (l) => lines.push(String(l)),
  });
  const open = Number((lines.join("\n").match(/Erasure requests open:\s+(\d+)/) || [])[1]);
  return { code, open, text: lines.join("\n") };
}

/* Day after day: the purge at 03:17, then the monitor at 04:11, on one
   database. Returns what the monitor said each day. */
async function nights(tree, firstDay, count) {
  const days = [];
  let db = tree;
  for (let d = 0; d < count; d++) {
    const midnight = firstDay + d * DAY;
    db = purge(db, midnight + PURGE_AT).tree;
    const m = await monitor(db, midnight + MONITOR_AT);
    days.push({ d, sessionThere: at(db, "sessions/S-1") !== null, code: m.code, open: m.open, text: m.text });
  }
  return { days, tree: db };
}

// ------------------------------------------------------------- the decision

test("of a purged session's records, only an unanswered erasure request stays", () => {
  const byUid = {
    asked: { research: false, erasure: true, at: 1 },
    answered: { research: false, erasure: true, at: 1 },
    withdrewOnly: { research: false, at: 1 },
    saidNo: { research: false, erasure: false, at: 1 },
    debris: "x",
    nothing: null,
  };
  const plan = planPurgedSessionWithdrawals(
    byUid, "S-1", answeredKeys([{ locationKey: "S-1", uid: "answered" }]));
  assert.deepStrictEqual(plan.keptUids, ["asked"]);
  assert.deepStrictEqual(plan.deleteUids, ["answered", "debris", "nothing", "saidNo", "withdrewOnly"]);
});

test("an erasure record for ANOTHER session, or another person, answers nothing here", () => {
  const byUid = { asked: { research: false, erasure: true, at: 1 } };
  for (const rec of [{ locationKey: "OTHER", uid: "asked" }, { locationKey: "S-1", uid: "someoneElse" },
                     { locationKey: "orgs/uni-x/S-1", uid: "asked" }]) {
    const plan = planPurgedSessionWithdrawals(byUid, "S-1", answeredKeys([rec]));
    assert.deepStrictEqual(plan.keptUids, ["asked"], JSON.stringify(rec));
  }
});

test("when the erasure ledger cannot be read, every request is kept", () => {
  /* "Unreadable" must not be read as "nothing has been answered, so nothing
     needs keeping" — nor as "everything has". With no ledger nothing can be
     SHOWN to be answered, and the only safe thing to do with a request is to
     leave it where the monitor will find it. */
  const byUid = {
    a: { research: false, erasure: true, at: 1 },
    b: { research: false, erasure: true, at: 1 },
    c: { research: false, at: 1 },
  };
  const plan = planPurgedSessionWithdrawals(byUid, "S-1", null);
  assert.deepStrictEqual(plan.keptUids, ["a", "b"]);
  assert.deepStrictEqual(plan.deleteUids, ["c"]);
});

test("the purge and the monitor agree on what is still open", () => {
  /* The purge keeps exactly what the monitor counts. Checked across a mixed
     tree rather than assumed from the shared helper: a record kept that the
     monitor ignores is retained for nothing, and one deleted that the monitor
     counts is the original defect. */
  const withdrawals = {
    "S-1": {
      u1: { research: false, erasure: true, at: 5 }, u2: { research: false, at: 5 },
      u3: { research: false, erasure: true, at: 5 }, u4: 7, u5: { erasure: true },
    },
  };
  const records = [{ locationKey: "S-1", uid: "u3" }];
  const kept = planPurgedSessionWithdrawals(withdrawals["S-1"], "S-1", answeredKeys(records)).keptUids;
  const open = pendingErasures(withdrawals, records, 1000).pending.map((p) => p.uid).sort();
  assert.deepStrictEqual(kept, open);
  assert.deepStrictEqual(kept, ["u1", "u5"]);
  assert.strictEqual(isOpenRequest(withdrawals["S-1"].u5, "S-1", "u5", answeredKeys(records)), true,
    "an undated request is still a request");
});

test("malformed input plans nothing and throws nothing", () => {
  for (const byUid of [null, undefined, "x", 7, []]) {
    assert.deepStrictEqual(planPurgedSessionWithdrawals(byUid, "S-1", new Set()),
      { deleteUids: [], keptUids: [], answeredUids: [] });
  }
});

// ------------------------------------------- the purge, then the monitor

const C = D0 + 11 * HOUR;                              // a workshop closes at 11:00 UTC
const closedAt = (c) => ({ created: { at: c - 3 * HOUR }, closed: { at: c }, pool: { c1: { name: "N" } } });

test("a request made after the session closes survives the purge and turns the monitor red at 30 days", async () => {
  /* The ordinary case: someone withdraws ten minutes after the debrief. The
     purge is due 30 days after closing, the limit is 30 days after the request,
     and the purge runs first every night. */
  const A = C + 10 * MIN;
  const { days, tree } = await nights({
    sessions: { "S-1": closedAt(C) },
    rosters: { sessions: { "S-1": { u1: { name: "A Name" } } } },
    withdrawals: { "S-1": { u1: request(A) } },
  }, D0 + DAY, 34);

  const purgedOn = days.findIndex((d) => !d.sessionThere);
  assert.strictEqual(purgedOn, 30, "positive control: the purge removed the session, on the night it was due");
  assert.strictEqual(at(tree, "rosters/sessions/S-1"), null, "positive control: the roster went with it");

  assert.deepStrictEqual(at(tree, "withdrawals/S-1/u1"), request(A),
    "the request was deleted with its session — unanswered");
  assert.ok(days.every((d) => d.open === 1), "the monitor lost sight of the request on some day");

  const red = days.filter((d) => d.code === 1).map((d) => d.d);
  assert.deepStrictEqual(red, [30, 31, 32, 33],
    "it must be late from the 30th day after the request, and stay late until someone acts");
  assert.match(days[33].text, /session not in the database:\s+1\b/i);
  assert.doesNotMatch(days[33].text, /no purge marker/i, "the purge's own marker must account for it");
});

test("the same holds whenever the request was made, and for a session that is never closed", async () => {
  const cases = [
    ["2 hours BEFORE closing", { "S-1": closedAt(C) }, C - 2 * HOUR, D0 + 29 * DAY, 4],
    ["20 days after closing", { "S-1": closedAt(C) }, C + 20 * DAY, D0 + 29 * DAY, 3],
    ["5 days before closing", { "S-1": { created: { at: C - 6 * DAY }, closed: { at: C } } }, C - 5 * DAY, D0 + 29 * DAY, 4],
    ["day 70 of an abandoned session", { "S-1": { created: { at: C } } }, C + 70 * DAY, D0 + 89 * DAY, 3],
  ];
  for (const [label, sessions, A, firstDay, count] of cases) {
    const { days, tree } = await nights({ sessions, withdrawals: { "S-1": { u1: request(A) } } }, firstDay, count);
    assert.ok(days.some((d) => !d.sessionThere), label + ": positive control — the session was never purged");
    assert.deepStrictEqual(at(tree, "withdrawals/S-1/u1"), request(A), label + ": the request did not survive the purge");
    assert.strictEqual(days[days.length - 1].open, 1, label);

    // ...and, left alone, it goes red when its own 30 days are up and not before.
    const before = await monitor(tree, A + 30 * DAY - HOUR);
    const after = await monitor(tree, A + 30 * DAY + HOUR);
    assert.strictEqual(before.code, 0, label + ": red before the limit");
    assert.strictEqual(after.code, 1, label + ": not red after the limit");
  }
});

test("everything else about the session still goes — the purge keeps the request and nothing more", () => {
  const A = C + DAY;
  const r = purge({
    sessions: { "S-1": closedAt(C), "FRESH": closedAt(C + 29 * DAY) },
    orgs: { "uni-x": { sessions: { "S-2": closedAt(C) } } },
    adminSecrets: { "S-1": { hash: "h" }, orgs: { "uni-x": { "S-2": { hash: "h" } } } },
    roomChat: { "S-1": { r: { t: { content: "x" } } } },
    roomChatAuthors: { "S-1": { r: { t: "u1" } } },
    certIds: { "S-1": { c1: "cert" } },
    rosters: { sessions: { "S-1": { u1: { name: "A Name" } } }, orgs: { "uni-x": { sessions: { "S-2": { u9: { name: "B" } } } } } },
    withdrawals: {
      "S-1": {
        asked: request(A),
        answered: request(A),
        withdrewOnly: { research: false, at: A },
      },
      "FRESH": { other: request(A) },
      orgs: { "uni-x": { "S-2": { orgAsked: request(A), orgWithdrewOnly: { research: false, at: A } } } },
    },
    erasures: { e1: { at: "x", records: [{ locationKey: "S-1", uid: "answered" }] } },
  }, C + 31 * DAY);

  for (const gone of ["sessions/S-1", "orgs/uni-x/sessions/S-2", "adminSecrets/S-1",
                      "adminSecrets/orgs/uni-x/S-2", "roomChat/S-1", "roomChatAuthors/S-1",
                      "certIds/S-1", "rosters/sessions/S-1", "rosters/orgs/uni-x/sessions/S-2"]) {
    assert.strictEqual(at(r.tree, gone), null, gone + " survived the purge");
  }
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/S-1")), ["asked"],
    "of the three records, only the unanswered request stays");
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/orgs/uni-x/S-2")), ["orgAsked"],
    "the org tree keeps its unanswered request and nothing else");
  // A session inside its window is not touched at all.
  assert.notStrictEqual(at(r.tree, "sessions/FRESH"), null);
  assert.deepStrictEqual(at(r.tree, "withdrawals/FRESH/other"), request(A));
  // The erasure ledger is never deleted from.
  assert.deepStrictEqual(at(r.tree, "erasures/e1/records"), [{ locationKey: "S-1", uid: "answered" }]);

  assert.match(r.out, /Erasure requests kept past their session:\s+2\b/);
  assert.doesNotMatch(r.out, /S-1|S-2|asked|uni-x\/S/, "the purge printed a code or a uid");
});

test("an unreadable erasure ledger keeps every request, purges anyway, and fails the run", () => {
  /* Storage limitation does not wait for the ledger: the session still goes.
     But nothing can be shown to be answered, so no request may be deleted —
     and the run is red, because an unreadable ledger is a broken restore too. */
  const A = C + DAY;
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: {
      sessions: { "S-1": closedAt(C) },
      withdrawals: { "S-1": { asked: request(A), answered: request(A), withdrewOnly: { research: false, at: A } } },
      erasures: { e1: { at: "x", records: [{ locationKey: "S-1", uid: "answered" }] } },
    },
    now: C + 31 * DAY,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
    throwOn: "erasures",
  });
  assert.strictEqual(at(r.tree, "sessions/S-1"), null, "the session was not purged");
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/S-1")).sort(), ["answered", "asked"],
    "with no ledger, both requests must be kept; the bare withdrawal still goes");
  assert.strictEqual(r.code, 1, "an unreadable ledger must not look like a clean run:\n" + r.out);
});

test("if the session's withdrawal records cannot be read, the session is NOT purged that night", () => {
  /* Deleting the session without knowing what requests hang off it would be
     the old behaviour by another route. The update is all-or-nothing, so the
     next night retries the whole set. */
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: { sessions: { "S-1": closedAt(C) }, withdrawals: { "S-1": { asked: request(C + DAY) } } },
    now: C + 31 * DAY,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
    throwOn: "withdrawals/S-1",
  });
  assert.notStrictEqual(at(r.tree, "sessions/S-1"), null, "the session was purged blind");
  assert.strictEqual(at(r.tree, "purgedSessions"), null, "a marker was written for a session that is still there");
  assert.deepStrictEqual(at(r.tree, "withdrawals/S-1/asked"), request(C + DAY));
  assert.strictEqual(r.code, 1, r.out);
});

// ------------------------------------------------------------- end of life

/* A record written AFTER its session was purged had no end of life at all:
   the only thing that ever deleted `withdrawals/<code>` was the update that
   deleted the session. And a request the purge now keeps needs one too, once
   it has been answered. So the nightly job sweeps the records of purged
   sessions by the same rule the purge applies — and ONLY under a purge marker,
   never because a session merely did not appear in a listing: deleting a bare
   withdrawal from a session that is in fact still there would put a
   participant back into the research export. */

const NIGHT = D0 + 200 * DAY + PURGE_AT;
const old = (days) => NIGHT - days * DAY;
const sweepTree = () => ({
  sessions: { "LIVE-1": { created: { at: old(3) } }, "BACK-1": { created: { at: old(3) } } },
  orgs: { "uni-x": { sessions: { "ORG-LIVE": { created: { at: old(3) } } } } },
  purgedSessions: {
    "GONE-1": old(40), "BACK-1": old(40), "EMPTY-1": old(40),
    orgs: { "uni-x": { "GONE-2": old(40) } },
  },
  withdrawals: {
    "GONE-1": { open: request(old(35)), answered: request(old(35)), withdrewOnly: { research: false, at: old(35) } },
    "NO-MARKER": { answered: request(old(35)), withdrewOnly: { research: false, at: old(35) } },
    "LIVE-1": { answered: request(old(2)), withdrewOnly: { research: false, at: old(2) } },
    "BACK-1": { answered: request(old(2)), withdrewOnly: { research: false, at: old(2) } },
    orgs: { "uni-x": {
      "GONE-2": { open: request(old(35)), answered: request(old(35)), withdrewOnly: { research: false, at: old(35) } },
      "ORG-LIVE": { withdrewOnly: { research: false, at: old(2) } },
    } },
  },
  erasures: { e1: { at: "x", records: [
    { locationKey: "GONE-1", uid: "answered" }, { locationKey: "orgs/uni-x/GONE-2", uid: "answered" },
    { locationKey: "NO-MARKER", uid: "answered" }, { locationKey: "LIVE-1", uid: "answered" },
    { locationKey: "BACK-1", uid: "answered" },
  ] } },
});

test("the plan says which deleted records were answered requests", () => {
  const plan = planPurgedSessionWithdrawals({
    open: request(1), answered: request(1), withdrewOnly: { research: false, at: 1 },
  }, "S-1", answeredKeys([{ locationKey: "S-1", uid: "answered" }]));
  assert.deepStrictEqual(plan.answeredUids, ["answered"]);
  assert.deepStrictEqual(plan.deleteUids, ["answered", "withdrewOnly"]);
});

test("the nightly sweep ends the life of answered and request-less records of PURGED sessions only", () => {
  const before = sweepTree();
  const r = purge(before, NIGHT);

  // Under a marker, session gone: only the unanswered request stays.
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/GONE-1")), ["open"]);
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/orgs/uni-x/GONE-2")), ["open"]);

  // No marker: nothing shows the session was purged, so nothing is deleted.
  assert.deepStrictEqual(at(r.tree, "withdrawals/NO-MARKER"), before.withdrawals["NO-MARKER"],
    "a record was deleted on the strength of a session merely being absent");
  // In the database: not the sweep's to touch — a bare withdrawal there is what
  // keeps the participant out of tonight's research export.
  assert.deepStrictEqual(at(r.tree, "withdrawals/LIVE-1"), before.withdrawals["LIVE-1"]);
  assert.deepStrictEqual(at(r.tree, "withdrawals/orgs/uni-x/ORG-LIVE"), before.withdrawals.orgs["uni-x"]["ORG-LIVE"]);
  // Back in the database under an old marker (a restore, a reused code): live.
  assert.deepStrictEqual(at(r.tree, "withdrawals/BACK-1"), before.withdrawals["BACK-1"],
    "a marker left by an earlier purge must not outrank the session being there");

  // Never deleted from, and nothing else moved.
  assert.deepStrictEqual(r.tree.erasures, before.erasures);
  assert.deepStrictEqual(r.tree.sessions, before.sessions);
  assert.deepStrictEqual(r.tree.purgedSessions, before.purgedSessions, "no marker here is old enough to expire");

  assert.match(r.out, /Withdrawal records of purged sessions: purged 2 answered request\(s\), 2 with no erasure request; 2 unanswered request\(s\) kept\./);
  assert.doesNotMatch(r.out, /GONE-|NO-MARKER|LIVE-1|BACK-1|withdrewOnly|uni-x\//,
    "the sweep printed a code or a uid");
});

test("a dry run sweeps nothing and says what it would", () => {
  const before = sweepTree();
  const r = purge(before, NIGHT, { CLEANUP_CONFIRM: "0" });
  assert.deepStrictEqual(r.tree, before);
  assert.match(r.out, /would-purge 2 answered request\(s\), 2 with no erasure request; 2 unanswered request\(s\) kept\./);
});

test("a request has its whole life: kept at the purge, red at 30 days, gone the night after it is answered", async () => {
  const A = C + 10 * MIN;
  let { tree } = await nights({
    sessions: { "S-1": closedAt(C) }, withdrawals: { "S-1": { u1: request(A) } },
  }, D0 + 30 * DAY, 3);
  assert.strictEqual(at(tree, "sessions/S-1"), null, "positive control: purged");
  assert.deepStrictEqual(at(tree, "withdrawals/S-1/u1"), request(A));
  assert.strictEqual((await monitor(tree, A + 31 * DAY)).code, 1, "positive control: late and red");

  // Someone answers it: an erasure record for this person in this session.
  tree = JSON.parse(JSON.stringify(tree));
  tree.erasures = { e1: { at: "x", records: [{ locationKey: "S-1", uid: "u1" }] } };
  const sameDay = await monitor(tree, A + 31 * DAY);
  assert.strictEqual(sameDay.code, 0, "an answered request must stop failing the job at once");
  assert.match(sameDay.text, /Erasure requests done:\s+1\b/);

  // The next night's job deletes the record; the ledger and the marker stay.
  const next = purge(tree, A + 32 * DAY);
  assert.strictEqual(at(next.tree, "withdrawals"), null, "the answered record was kept");
  assert.deepStrictEqual(next.tree.erasures, tree.erasures);
  assert.strictEqual(typeof at(next.tree, "purgedSessions/S-1"), "number");
  const after = await monitor(next.tree, A + 33 * DAY);
  assert.deepStrictEqual([after.code, after.open], [0, 0]);
});

test("a blocked backup gate stops the session purge and not the sweep", () => {
  /* The gate exists so the purge cannot delete the only copy of a session.
     The sweep deletes nothing the backup holds — records of sessions already
     gone — so a stale backup must not pause it, exactly as it must not pause
     the metrics pruning. One database, the gate armed, no backup marker:
     the session due for purging stays, the purged session's records are swept. */
  const tree = Object.assign(sweepTree(), {});
  tree.sessions["DUE-1"] = { created: { at: old(40) }, closed: { at: old(31) } };
  tree.withdrawals["DUE-1"] = { asked: request(old(20)) };
  const armed = { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "1" };

  const r = runOpsScript("cleanup-stale-sessions.js", { tree, now: NIGHT, env: armed });
  assert.strictEqual(r.code, 3, "a blocked run exits 3:\n" + r.out);
  assert.notStrictEqual(at(r.tree, "sessions/DUE-1"), null, "the gate did not stop the session purge");
  assert.strictEqual(at(r.tree, "purgedSessions/DUE-1"), null, "a marker was written for a session that was not purged");
  assert.deepStrictEqual(at(r.tree, "withdrawals/DUE-1"), tree.withdrawals["DUE-1"]);
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/GONE-1")), ["open"],
    "the sweep did not run on a blocked night");
  assert.match(r.out, /Withdrawal records of purged sessions: purged 2 answered request\(s\)/);

  /* The control: the same database with a fresh backup. The session goes too. */
  const fresh = Object.assign({}, tree, { ops: { lastBackup: { at: NIGHT - 3600000, sessions: 4 } } });
  const ok = runOpsScript("cleanup-stale-sessions.js", { tree: fresh, now: NIGHT, env: armed });
  assert.strictEqual(ok.code, 0, ok.out);
  assert.strictEqual(at(ok.tree, "sessions/DUE-1"), null, "positive control: with a backup the session is purged");
  assert.deepStrictEqual(Object.keys(at(ok.tree, "withdrawals/DUE-1")), ["asked"]);
});

test("with an unreadable ledger the sweep keeps every request, and the run fails", () => {
  const before = sweepTree();
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: before, now: NIGHT,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
    throwOn: "erasures",
  });
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/GONE-1")).sort(), ["answered", "open"]);
  assert.strictEqual(r.code, 1, r.out);
});

test("with unreadable markers the sweep deletes nothing, and the run fails", () => {
  const before = sweepTree();
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: before, now: NIGHT,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
    throwOn: "purgedSessions",
  });
  assert.deepStrictEqual(r.tree.withdrawals, before.withdrawals);
  assert.strictEqual(r.code, 1, r.out);
});

test("one unreadable branch does not stop the others being swept", () => {
  const before = sweepTree();
  const r = runOpsScript("cleanup-stale-sessions.js", {
    tree: before, now: NIGHT,
    env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
    throwOn: "withdrawals/GONE-1",
  });
  assert.deepStrictEqual(at(r.tree, "withdrawals/GONE-1"), before.withdrawals["GONE-1"], "swept blind");
  assert.deepStrictEqual(Object.keys(at(r.tree, "withdrawals/orgs/uni-x/GONE-2")), ["open"]);
  assert.strictEqual(r.code, 1, r.out);
});

test("a purge marker expires after its window — unless a request still hangs off it", () => {
  const FIVE_YEARS = 5 * 365;
  const tree = {
    purgedSessions: {
      "OLD-EMPTY": old(FIVE_YEARS + 1),
      "OLD-OPEN": old(FIVE_YEARS + 1),
      "OLD-ANSWERED": old(FIVE_YEARS + 1),
      "YOUNG": old(FIVE_YEARS - 1),
      orgs: { "uni-x": { "OLD-ORG": old(FIVE_YEARS + 1) } },
    },
    withdrawals: {
      "OLD-OPEN": { u: request(old(40)) },
      "OLD-ANSWERED": { u: request(old(40)) },
    },
    erasures: { e1: { at: "x", records: [{ locationKey: "OLD-ANSWERED", uid: "u" }] } },
  };
  const r = purge(tree, NIGHT);
  assert.deepStrictEqual(Object.keys(r.tree.purgedSessions).sort(), ["OLD-OPEN", "YOUNG"],
    "expired markers with nothing left under them go, in both trees; a marker " +
    "with an unanswered request under it stays, and so does one inside the window");
  assert.deepStrictEqual(Object.keys(r.tree.withdrawals), ["OLD-OPEN"]);
  assert.match(r.out, /Purge markers: 5 held, 3 expired\./);

  // The window is a setting, and a bad one stops the job rather than guessing.
  const short = purge(tree, NIGHT, { CLEANUP_RETENTION_PURGED_MARKER_DAYS: "10" });
  assert.deepStrictEqual(Object.keys(short.tree.purgedSessions), ["OLD-OPEN"]);
  for (const bad of ["-1", "abc", "0", "30.5"]) {
    const refused = runOpsScript("cleanup-stale-sessions.js", {
      tree, now: NIGHT,
      env: { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0",
             CLEANUP_RETENTION_PURGED_MARKER_DAYS: bad },
    });
    assert.strictEqual(refused.code, 2, "window " + JSON.stringify(bad) + " was accepted");
    assert.deepStrictEqual(refused.tree, tree, "something was deleted under a refused window");
  }
});

test("a dry run does not read the records of a session it would purge, nor the ledger", () => {
  /* Nothing is decided about that session in a dry run, so nothing about it
     needs reading: the two reads carry uids onto a hosted runner. Shown by
     making both reads fail — a dry run that touched either would exit 1.
     (No session here has been purged before, so the sweep has no marker to
     visit; where it has, a dry run does read those branches, to report.) */
  for (const throwOn of ["erasures", "withdrawals/S-1"]) {
    const r = runOpsScript("cleanup-stale-sessions.js", {
      tree: { sessions: { "S-1": closedAt(C) }, withdrawals: { "S-1": { asked: request(C + DAY) } } },
      now: C + 31 * DAY,
      env: { CLEANUP_CONFIRM: "0", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" },
      throwOn,
    });
    assert.strictEqual(r.code, 0, throwOn + ":\n" + r.out);
    assert.notStrictEqual(at(r.tree, "sessions/S-1"), null);
  }
});
