/* tests/purged-session-marker.test.js
 *
 * The marker the purge leaves behind: `purgedSessions/<code> = <when>`.
 *
 * WHY IT EXISTS. A withdrawal record is `withdrawals/<code>/<uid>`, and its
 * rule used to look only at the uid. So any signed-in visitor — an anonymous
 * one included — could record an "erasure request" for a code that never
 * existed, and the daily monitor counted it: once a session is purged, nothing
 * in the database distinguished "this session was here" from "this code was
 * made up". The request's own date was the writer's to choose as well (the
 * rule wanted only `at <= now`), so one write with `at: 1` turned the job red
 * on its next run.
 *
 * The marker is that missing fact, written by the one job that knows it. These
 * tests RUN the purge (scripts/cleanup-stale-sessions.js, in a child process,
 * against an in-memory database) rather than read it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  sessionLocations, sessionLocationsFromKeys, locationForKey, purgedMarkers,
} = require("../scripts/lib/session-trees");
const { runOpsScript, at } = require("./fixtures/run-ops-script");

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 7, 3, 17);
const ago = (d) => NOW - d * DAY;

const purge = (tree, env) => runOpsScript("cleanup-stale-sessions.js", {
  tree, now: NOW,
  env: Object.assign({ CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "0" }, env),
});

// ------------------------------------------------------------ where it lives

test("every location names its marker, and the two trees cannot collide", () => {
  const [plain, org] = sessionLocations({ "ABC-123": {} }, { "uni-x": { sessions: { "ABC-123": {} } } });
  assert.strictEqual(plain.purgedMarkerPath, "purgedSessions/ABC-123");
  assert.strictEqual(org.purgedMarkerPath, "purgedSessions/orgs/uni-x/ABC-123");
  // The keys-only enumerator — the one the purge uses — builds the same paths.
  const [k1, k2] = sessionLocationsFromKeys(["ABC-123"], { "uni-x": ["ABC-123"] });
  assert.strictEqual(k1.purgedMarkerPath, plain.purgedMarkerPath);
  assert.strictEqual(k2.purgedMarkerPath, org.purgedMarkerPath);
});

test("a location key leads back to the same paths the purge uses", () => {
  /* A request and a marker carry a KEY, long after the session that produced
     it is gone. Anything that rebuilds paths from that key has to land where
     the purge wrote — so this compares, path by path, against the enumerator. */
  const locations = sessionLocations({ "ABC-123": {} }, { "uni-x": { sessions: { "XYZ-789": {} } } });
  assert.strictEqual(locations.length, 2);
  for (const loc of locations) {
    const again = locationForKey(loc.key);
    for (const field of Object.keys(again)) {
      assert.strictEqual(again[field], loc[field], `${loc.key}: ${field} differs`);
    }
  }
  assert.strictEqual(locationForKey("orgs/uni-x/XYZ-789").orgSlug, "uni-x");
  assert.strictEqual(locationForKey("ABC-123").orgSlug, null);
});

test("the marker tree is regrouped under location keys, and only numbers are markers", () => {
  const grouped = purgedMarkers({
    "GONE-1": 1700000000000,
    "NOT-A-MARKER": "yes",
    "ALSO-NOT": { at: 5 },
    orgs: { "uni-x": { "GONE-2": 1700000000001, "BAD": null }, "uni-y": "x" },
  });
  assert.deepStrictEqual(grouped, { "GONE-1": 1700000000000, "orgs/uni-x/GONE-2": 1700000000001 });
  for (const junk of [null, undefined, "x", 7, [], { orgs: null }, { orgs: "x" }]) {
    assert.deepStrictEqual(purgedMarkers(junk), {});
  }
});

// --------------------------------------------------------- the purge writes it

const closed = (daysAgo) => ({ created: { at: ago(daysAgo + 1) }, closed: { at: ago(daysAgo) }, pool: { c1: { name: "N" } } });

test("the purge leaves a marker for each session it removes, in both trees, and for no other", () => {
  const r = purge({
    sessions: { "OLD-1": closed(31), "FRESH-1": closed(5) },
    orgs: { "uni-x": { sessions: { "OLD-2": closed(40), "FRESH-2": closed(2) } } },
  });
  assert.strictEqual(r.code, 0, r.out);

  // Positive control: the purge really ran, and really spared what it should.
  assert.strictEqual(at(r.tree, "sessions/OLD-1"), null, "the stale session was not purged");
  assert.strictEqual(at(r.tree, "orgs/uni-x/sessions/OLD-2"), null);
  assert.notStrictEqual(at(r.tree, "sessions/FRESH-1"), null, "a session inside its window was purged");
  assert.notStrictEqual(at(r.tree, "orgs/uni-x/sessions/FRESH-2"), null);

  assert.strictEqual(at(r.tree, "purgedSessions/OLD-1"), NOW,
    "the marker must be the time of the purge, as a number");
  assert.strictEqual(at(r.tree, "purgedSessions/orgs/uni-x/OLD-2"), NOW);
  assert.deepStrictEqual(purgedMarkers(at(r.tree, "purgedSessions")),
    { "OLD-1": NOW, "orgs/uni-x/OLD-2": NOW },
    "a marker exists for a session that was not purged");
});

test("a dry run writes no marker", () => {
  /* A marker for a session that is still there would let the sweep treat its
     withdrawal records as belonging to a purged session. */
  const r = purge({ sessions: { "OLD-1": closed(31) } }, { CLEANUP_CONFIRM: "0" });
  assert.strictEqual(r.code, 0, r.out);
  assert.notStrictEqual(at(r.tree, "sessions/OLD-1"), null, "positive control: nothing was deleted");
  assert.strictEqual(at(r.tree, "purgedSessions"), null);
});

test("the marker says nothing about anyone", () => {
  /* It is kept far longer than the session, on the strength of holding a code
     and a date. If it ever grew a field, that reasoning would stop being true. */
  const r = purge({
    sessions: { "OLD-1": Object.assign(closed(31), { creatorUid: "uidFacilitator" }) },
    withdrawals: { "OLD-1": { uidParticipant: { research: false, erasure: true, at: ago(2) } } },
  });
  const marker = at(r.tree, "purgedSessions/OLD-1");
  assert.strictEqual(typeof marker, "number");
  assert.doesNotMatch(JSON.stringify(at(r.tree, "purgedSessions")), /uid/i);
});

test("the purge prints neither the code nor the marker's path — its logs are public", () => {
  const r = purge({
    sessions: { "SECRETCODE-1": closed(31) },
    orgs: { "uni-x": { sessions: { "SECRETCODE-2": closed(31) } } },
    withdrawals: { "SECRETCODE-1": { uidSecretA: { research: false, erasure: true, at: ago(2) } } },
  });
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(at(r.tree, "purgedSessions/SECRETCODE-1"), NOW, "positive control: it did purge");
  assert.doesNotMatch(r.out, /SECRETCODE|uidSecret/);
});

// ------------------------------------------------- sessions purged before it

/* The rule turns away a withdrawal for a session with no marker — and every
   session purged before the purge wrote markers has none. Those participants
   would be refused in the product for a session they really took part in. The
   nightly snapshots still list such a session for up to 90 days, which is also
   exactly as long as a suppression record for it can matter, so the markers are
   rebuilt from them: scripts/backfill-purged-markers.js, run once by hand. */

function backfill(tree, snapshots, env, extraArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-backfill-"));
  try {
    const args = [];
    snapshots.forEach((payload, i) => {
      const file = path.join(dir, "snapshot-" + i + ".json");
      fs.writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
      args.push("--file", file);
    });
    return runOpsScript("backfill-purged-markers.js", {
      tree, now: NOW, env: env || {}, args: args.concat(extraArgs || []),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TAKEN = "2026-09-20T02:47:11.000Z";
const snapshot = (sessions, takenAt) => ({
  backupTakenAt: takenAt || TAKEN, databaseUrl: "x", sessionCount: Object.keys(sessions).length, sessions,
});

test("the backfill marks sessions a snapshot holds and the database no longer does", () => {
  const tree = {
    sessions: { "STILL-HERE": { created: { at: ago(3) } } },
    orgs: { "uni-x": { sessions: { "ORG-HERE": { created: { at: ago(3) } } } } },
    purgedSessions: { "HAS-ONE": 1234 },
  };
  const snap = snapshot({
    "STILL-HERE": {}, "GONE-1": {}, "HAS-ONE": {},
    "orgs/uni-x/ORG-HERE": {}, "orgs/uni-x/ORG-GONE": {},
  });

  const dry = backfill(tree, [snap]);
  assert.strictEqual(dry.code, 0, dry.out);
  assert.deepStrictEqual(dry.tree.purgedSessions, { "HAS-ONE": 1234 }, "a dry run wrote something");
  assert.match(dry.out, /DRY RUN/);

  const live = backfill(tree, [snap], { BACKFILL_CONFIRM: "1" });
  assert.strictEqual(live.code, 0, live.out);
  assert.deepStrictEqual(purgedMarkers(live.tree.purgedSessions), {
    "GONE-1": Date.parse(TAKEN),
    "HAS-ONE": 1234,
    "orgs/uni-x/ORG-GONE": Date.parse(TAKEN),
  }, "markers must be written for the purged sessions only, in both trees, " +
     "and an existing marker must not be overwritten");
  // Nothing else in the database moved.
  assert.deepStrictEqual(live.tree.sessions, tree.sessions);
  assert.deepStrictEqual(live.tree.orgs, tree.orgs);
});

test("the backfill dates a marker by the LAST snapshot that holds the session", () => {
  /* Not by today: the marker says when a session was last known to exist. */
  const r = backfill({}, [
    snapshot({ "GONE-1": {} }, "2026-08-01T02:47:00.000Z"),
    snapshot({ "GONE-1": {}, "GONE-2": {} }, "2026-08-20T02:47:00.000Z"),
    snapshot({ "GONE-2": {} }, "2026-08-05T02:47:00.000Z"),
  ], { BACKFILL_CONFIRM: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.tree.purgedSessions, {
    "GONE-1": Date.parse("2026-08-20T02:47:00.000Z"),
    "GONE-2": Date.parse("2026-08-20T02:47:00.000Z"),
  });
});

test("the backfill refuses a file it cannot vouch for, and writes nothing", () => {
  /* A marker is a standing permission to record a withdrawal and to write a
     permanent suppression record. It is issued for what a real snapshot shows,
     or not at all. */
  const good = snapshot({ "GONE-1": {} });
  const cases = [
    ["not a backup payload", { some: "export" }],
    ["no date", { sessions: { "GONE-1": {} } }],
    ["an unreadable date", { backupTakenAt: "last tuesday", sessions: { "GONE-1": {} } }],
    ["a date in the future", snapshot({ "GONE-1": {} }, new Date(NOW + DAY).toISOString())],
    ["not JSON", "{ nope"],
  ];
  for (const [label, bad] of cases) {
    const r = backfill({}, [good, bad], { BACKFILL_CONFIRM: "1" });
    assert.notStrictEqual(r.code, 0, label + ": it exited 0");
    assert.strictEqual(at(r.tree, "purgedSessions"), null,
      label + ": markers were written from the good file although the run was refused");
  }
  const none = backfill({}, [], { BACKFILL_CONFIRM: "1" });
  assert.notStrictEqual(none.code, 0, "it ran with no snapshot at all");
});

test("the backfill skips a key that is not a session location, and says how many", () => {
  const r = backfill({}, [snapshot({
    "GONE-1": {}, "a/b": {}, "orgs/uni-x": {}, "orgs/uni-x/GONE-2/extra": {}, "bad.key": {}, "": {},
  })], { BACKFILL_CONFIRM: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.tree.purgedSessions, { "GONE-1": Date.parse(TAKEN) });
  assert.match(r.out, /not a session location:\s+5\b/);
});

test("the backfill prints session codes only when asked", () => {
  const snap = snapshot({ "SECRETCODE-1": {} });
  const quiet = backfill({}, [snap]);
  assert.doesNotMatch(quiet.out, /SECRETCODE/);
  assert.match(quiet.out, /to mark:\s+1\b/i, "positive control: it found the session");
  const listed = backfill({}, [snap], {}, ["--list"]);
  assert.match(listed.out, /SECRETCODE-1/);
});
