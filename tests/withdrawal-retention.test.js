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
      { deleteUids: [], keptUids: [] });
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

test("a dry run reads no withdrawal record and no ledger", () => {
  /* Nothing is decided in a dry run, so nothing needs reading: the two reads
     carry uids onto a hosted runner. Shown by making both reads fail — a dry
     run that touched either would exit 1. */
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
