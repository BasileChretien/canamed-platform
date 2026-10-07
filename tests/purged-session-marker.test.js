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
const { applySuppression } = require("../scripts/lib/suppression");
const { flattenErasures } = require("../scripts/lib/data-rights");
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

test("a node with no timestamps is purged WITHOUT a marker: it was never a session", () => {
  /* The purge removes a session-shaped node that has neither `created/at` nor
     `closed/at` defensively ("pre-schema or corrupted"). Any signed-in visitor
     can make one: `sessions/<any code>/members/<own uid>` is writable without
     the session ever having been created. If the purge left a marker for it,
     the purge itself would be issuing the proof that a made-up code "existed"
     — and the erasure tool, which refuses to dismiss a request under a marker,
     could then only close it with a permanent suppression record. */
  const r = purge({
    sessions: {
      "JUNK-1": { members: { uidVisitor: { at: ago(1) } } },
      "REAL-1": closed(31),
      "REAL-2": { created: { at: ago(91) } },                 // abandoned: no closed/at
      "REAL-3": { closed: { at: ago(31) } },                  // legacy: no created
    },
    withdrawals: { "JUNK-1": { uidVisitor: { research: false, erasure: true, at: ago(1) } } },
  });
  assert.strictEqual(r.code, 0, r.out);
  for (const code of ["JUNK-1", "REAL-1", "REAL-2", "REAL-3"]) {
    assert.strictEqual(at(r.tree, "sessions/" + code), null, code + " was not purged");
  }
  assert.deepStrictEqual(Object.keys(at(r.tree, "purgedSessions")).sort(), ["REAL-1", "REAL-2", "REAL-3"],
    "a marker is evidence that a session existed; a node with no timestamp is not one");

  /* The request under it is not deleted — a job never deletes an unanswered
     request — but it is now one of the records nothing accounts for, which the
     monitor counts apart and the erasure tool will dismiss. */
  assert.notStrictEqual(at(r.tree, "withdrawals/JUNK-1/uidVisitor"), null);
  const dismissed = runOpsScript("erase-participant.js", {
    tree: r.tree, now: NOW + DAY,
    args: ["--uid", "uidVisitor", "--session", "JUNK-1", "--dismiss", "--reason", "no such session"],
    env: { ERASE_CONFIRM: "1" },
  });
  assert.strictEqual(dismissed.code, 0, dismissed.out);
  assert.strictEqual(at(dismissed.tree, "withdrawals"), null);
  assert.strictEqual(at(dismissed.tree, "erasures"), null);
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
/* A session body as a snapshot holds it, reduced to the one thing the backfill
   looks at: it had a timestamp, so it was a session. */
const REAL = { created: { at: 1 } };
/* What the script under test is pointed at (tests/fixtures/run-ops-script.js). */
const THIS_DB = "https://fake-rtdb.example.test";
const snapshot = (sessions, takenAt) => ({
  backupTakenAt: takenAt || TAKEN, databaseUrl: THIS_DB, sessionCount: Object.keys(sessions).length, sessions,
});

test("the backfill marks sessions a snapshot holds and the database no longer does", () => {
  const tree = {
    sessions: { "STILL-HERE": { created: { at: ago(3) } } },
    orgs: { "uni-x": { sessions: { "ORG-HERE": { created: { at: ago(3) } } } } },
    purgedSessions: { "HAS-ONE": 1234 },
  };
  /* The two sessions that are still there are in the snapshot AS THEMSELVES —
     the same `created` the database holds. (They used to be `REAL`, a body
     with another date: a fixture in which "still in the database" could only
     mean "something has this key", which is the defect of the next test.) */
  const snap = snapshot({
    "STILL-HERE": tree.sessions["STILL-HERE"], "GONE-1": REAL, "HAS-ONE": REAL,
    "orgs/uni-x/ORG-HERE": tree.orgs["uni-x"].sessions["ORG-HERE"], "orgs/uni-x/ORG-GONE": REAL,
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

test("a session the snapshots hold was purged unless THAT session is in the database — a key under its code is not it", () => {
  /* Review round 2, F2. The backfill took "still in the database" from the
     key listing. Any signed-in visitor can put their own membership row under
     any code, and can create a session under a code that is free again — so on
     backfill day a session purged before markers existed could have SOMETHING
     under its code, and got no marker. The tool and the monitor then called it
     "a live session", the person had nothing in it, and `--dismiss` deleted
     their unanswered request: round 1's B1, for every session purged before
     the deploy.

     What is in the database is the snapshot's session only if it IS that
     session: a session by the purge's own test (a `created/at` or a
     `closed/at`), with the same `created/at` — written once, never changed —
     and, where the snapshot recorded one, the same `creatorUid`, which the
     rules let nobody set to anything but their own account. */
  const C = ago(140);
  const archived = {
    created: { by: "Facilitator", at: C }, closed: { by: "Facilitator", at: ago(100) },
    creatorUid: "uidFacilitator",
    clientMapping: { c1: "uidA" }, pool: { c1: { name: "Asker" } }, members: { uidA: true },
  };
  const TAKEN_AT = new Date(ago(71)).toISOString();
  const gone = [
    ["a stranger's membership row", { members: { uidStranger: { at: ago(0.01) } } }],
    ["a `created` dated in the future", { created: { by: "x", at: NOW + 3650 * DAY } }],
    ["a new session somebody else created", { created: { by: "Other", at: ago(5) }, creatorUid: "uidOther", members: { uidZ: true } }],
    ["the old `created` copied by another account", { created: { by: "Facilitator", at: C }, creatorUid: "uidStranger" }],
    ["the old `created` copied, with no creator at all", { created: { by: "Facilitator", at: C } }],
    ["only a `closed`, on a session that had a `created`", { closed: { by: "x", at: ago(100) } }],
  ];
  /* A session old enough to have only a `closed` is told apart by that date. */
  const legacy = { closed: { by: "F", at: ago(100) }, members: { uidA: true } };
  const legacyGone = [
    ["a legacy session, and another `closed` under its code", { closed: { by: "x", at: ago(3) } }],
    ["a legacy session, and a stranger's row under its code", { members: { uidStranger: { at: ago(0.01) } } }],
    ["a legacy session, and a new session under its code", { created: { by: "Other", at: ago(5) }, creatorUid: "uidOther" }],
  ];
  for (const tree of ["default", "orgs"]) {
    const key = tree === "default" ? "OLD-1" : "orgs/uni-x/OLD-1";
    const live = (body) => (tree === "default"
      ? { sessions: { "OLD-1": body } }
      : { orgs: { "uni-x": { sessions: { "OLD-1": body } } } });
    for (const [label, occupier] of gone) {
      const r = backfill(live(occupier), [snapshot({ [key]: archived }, TAKEN_AT)], { BACKFILL_CONFIRM: "1" });
      assert.strictEqual(r.code, 0, r.out);
      assert.deepStrictEqual(purgedMarkers(r.tree.purgedSessions), { [key]: Date.parse(TAKEN_AT) },
        `${tree}, ${label}: the purged session got no marker\n${r.out}`);
      assert.match(r.out, /in use again[^\n]*:\s+1\b/i, `${tree}, ${label}: it must say so`);
      assert.match(r.out, /still in the database:\s+0\b/i, `${tree}, ${label}`);
      // It marks; it does not touch what is under the code.
      assert.deepStrictEqual(r.tree.sessions, live(occupier).sessions, label);
      assert.deepStrictEqual(r.tree.orgs, live(occupier).orgs, label);
    }
    for (const [label, occupier] of legacyGone) {
      const r = backfill(live(occupier), [snapshot({ [key]: legacy }, TAKEN_AT)], { BACKFILL_CONFIRM: "1" });
      assert.strictEqual(r.code, 0, r.out);
      assert.deepStrictEqual(purgedMarkers(r.tree.purgedSessions), { [key]: Date.parse(TAKEN_AT) },
        `${tree}, ${label}: the purged session got no marker\n${r.out}`);
    }

    /* THE CONTROLS — the same session, still there, in the states a session
       passes through. None of them is purged, so none is marked. */
    const still = [
      ["exactly as the snapshot shows it", archived, archived],
      ["closed since the snapshot was taken",
        { created: archived.created, creatorUid: "uidFacilitator" },
        { created: archived.created, creatorUid: "uidFacilitator", closed: { by: "Facilitator", at: ago(1) } }],
      ["a session from before creators were recorded", { created: { by: "F", at: C } }, { created: { by: "F", at: C }, creatorUid: "uidLater" }],
      ["a legacy session that has only its `closed`", { closed: { by: "F", at: ago(20) } }, { closed: { by: "F", at: ago(20) } }],
    ];
    for (const [label, inSnapshot, inDatabase] of still) {
      const r = backfill(live(inDatabase), [snapshot({ [key]: inSnapshot }, TAKEN_AT)], { BACKFILL_CONFIRM: "1" });
      assert.strictEqual(r.code, 0, r.out);
      assert.strictEqual(at(r.tree, "purgedSessions"), null,
        `${tree}, ${label}: a session that is still there was marked as purged\n${r.out}`);
      assert.match(r.out, /still in the database:\s+1\b/i, `${tree}, ${label}`);
    }
  }

  /* Dated by the last snapshot that shows the session that is GONE — not by a
     later one that shows whatever took its place. */
  const successor = { created: { by: "Other", at: ago(30) }, creatorUid: "uidOther" };
  const later = new Date(ago(10)).toISOString();
  const two = backfill({ sessions: { "OLD-1": successor } },
    [snapshot({ "OLD-1": archived }, TAKEN_AT), snapshot({ "OLD-1": successor }, later)], { BACKFILL_CONFIRM: "1" });
  assert.deepStrictEqual(two.tree.purgedSessions, { "OLD-1": Date.parse(TAKEN_AT) }, two.out);

  // The live side cannot be read: no marker is guessed, and the run fails.
  for (const field of ["created/at", "closed/at", "creatorUid"]) {
    const unreadable = backfill({ sessions: { "OLD-1": { members: { s: true } } } },
      [snapshot({ "OLD-1": archived, "GONE-9": REAL }, TAKEN_AT)],
      { BACKFILL_CONFIRM: "1", FAKE_RTDB_THROW_ON: "sessions/OLD-1/" + field });
    assert.notStrictEqual(unreadable.code, 0, field + ": a failed read of the live session was taken for an answer");
    assert.strictEqual(at(unreadable.tree, "purgedSessions"), null,
      field + ": markers were written although the run could not see what is in the database");
  }
});

test("after the backfill, a request for such a session is answered and cannot be dismissed", () => {
  /* The chain the defect opened, run end to end on the reviewer's two cases:
     backfill, then the monitor, then the tool, then `--dismiss`. */
  const archived = {
    created: { at: ago(140) }, closed: { at: ago(100) },
    clientMapping: { c1: "uidA", c3: "uidB" },
    pool: { c1: { name: "Asker" }, c3: { name: "Bystander" } },
    members: { uidA: true, uidB: true },
  };
  const asked = { research: false, erasure: true, at: ago(45) };
  const before = (occupier) => ({
    sessions: { "LIVE-9": { created: { at: ago(2) } }, "OLD-1": occupier },
    withdrawals: { "OLD-1": { uidA: asked } },
    users: { uidA: { history: { "OLD-1": { code: "OLD-1", joinedAt: ago(140) } } } },
  });
  const snap = snapshot({ "OLD-1": archived }, new Date(ago(71)).toISOString());
  const tool = (tree, args) => runOpsScript("erase-participant.js", {
    tree, now: NOW, args, env: { ERASE_CONFIRM: "1" } });

  /* What each occupier is to the NIGHTLY JOB, which decides what the tool may
     promise afterwards:
       "junk"    not a session — the purge removes it that night;
       "session" a session within its retention — the purge keeps it;
       null      depends on what the purge makes of a date in the future. It
                 kept such a session for ever when this was written; a
                 separate change purges it. This test must hold either way,
                 so for that occupier it asserts only what both leave true. */
  for (const [label, occupier, toThePurge] of [
    ["a stranger's membership row", { members: { uidStranger: { at: ago(0.01) } } }, "junk"],
    ["a new session somebody else created", { created: { by: "Other", at: ago(5) }, creatorUid: "uidOther" }, "session"],
    ["a `created` dated in the future", { created: { by: "x", at: NOW + 3650 * DAY } }, null],
  ]) {
    const b = backfill(before(occupier), [snap], { BACKFILL_CONFIRM: "1" });
    assert.strictEqual(typeof at(b.tree, "purgedSessions/OLD-1"), "number", label + "\n" + b.out);

    const monitor = runOpsScript("data-rights-monitor.js", { tree: b.tree, now: NOW });
    assert.strictEqual(monitor.code, 1, label + ": the request is 45 days old and unanswered");
    assert.match(monitor.out, /session purged; its code is in the database again/, label);
    assert.doesNotMatch(monitor.out, /close that request with --dismiss/, label + ": the monitor must not send anyone to dismiss it");

    const dismissed = tool(b.tree, ["--uid", "uidA", "--session", "OLD-1", "--dismiss", "--reason", "nothing to erase"]);
    assert.notStrictEqual(dismissed.code, 0, label + ": --dismiss went through\n" + dismissed.out);
    assert.match(dismissed.out, /REFUSED/, label);
    assert.deepStrictEqual(at(dismissed.tree, "withdrawals/OLD-1/uidA"), asked, label + ": the request was deleted unanswered");
    assert.strictEqual(at(dismissed.tree, "erasures"), null, label);

    const answered = tool(b.tree, ["--uid", "uidA", "--session", "OLD-1", "--research-copy-checked"]);
    assert.strictEqual(answered.code, 0, label + "\n" + answered.out);
    const recs = flattenErasures(answered.tree.erasures);
    assert.deepStrictEqual(recs.map((x) => [x.locationKey, x.uid, x.sessionPurged, x.requestAt]),
      [["OLD-1", "uidA", true, asked.at]], label);
    // The record is what a restore of that snapshot obeys.
    const restored = applySuppression(snap, recs).payload.sessions["OLD-1"];
    assert.deepStrictEqual(Object.keys(restored.pool), ["c3"], label + ": a restore would bring the person back");
    assert.strictEqual(runOpsScript("data-rights-monitor.js", { tree: answered.tree, now: NOW }).code, 0, label);

    /* What the tool says happens next, and what then does. The nightly job
       does NOT clear an answered request away while something sits under the
       code — and the tool used to promise "on its next run" regardless. */
    assert.match(answered.out, /except 1 whose code is in the database again/, label);
    const night = purge(answered.tree);
    assert.strictEqual(night.code, 0, night.out);
    assert.strictEqual(typeof at(night.tree, "purgedSessions/OLD-1"), "number", label + ": the marker must outlive whatever was under the code");
    assert.strictEqual(flattenErasures(night.tree.erasures).length, 1, label);
    if (toThePurge === "session") {
      // A session within its retention stays, so the code stays in use…
      assert.deepStrictEqual(at(night.tree, "sessions/OLD-1"), occupier, label);
      assert.deepStrictEqual(at(night.tree, "withdrawals/OLD-1/uidA"), asked, label + ": …and the answered request stays with it");
    } else if (toThePurge === "junk") {
      // A stranger's row is not a session: the purge removes it, and with
      // nothing under the code any more the answered request goes too.
      assert.strictEqual(at(night.tree, "sessions/OLD-1"), null, label);
      assert.strictEqual(at(night.tree, "withdrawals"), null, label);
    } else {
      // Either the session and the answered request are both still there, or
      // both are gone. Never one without the other.
      const sessionThere = at(night.tree, "sessions/OLD-1") !== null;
      const requestThere = at(night.tree, "withdrawals/OLD-1/uidA") !== null;
      assert.strictEqual(requestThere, sessionThere,
        label + ": the answered request and what is under its code must go together");
    }
  }

  // With nothing under the code, there is no exception to state.
  const plain = backfill({
    sessions: { "LIVE-9": { created: { at: ago(2) } } },
    withdrawals: { "OLD-1": { uidA: asked } },
  }, [snap], { BACKFILL_CONFIRM: "1" });
  const plainAnswered = tool(plain.tree, ["--uid", "uidA", "--session", "OLD-1", "--research-copy-checked"]);
  assert.strictEqual(plainAnswered.code, 0, plainAnswered.out);
  assert.match(plainAnswered.out, /removes the withdrawal record\(s\) on its next run\./);
  assert.doesNotMatch(plainAnswered.out, /except \d+ whose code/);
});

test("the backfill marks only what the purge would have marked: a session with a timestamp", () => {
  /* The purge leaves no marker for a node with neither `created/at` nor
     `closed/at`: any signed-in visitor can write their own membership row
     under any code, and that is not a session. Such a node is in the nightly
     snapshot like everything else under `sessions/`, and the backfill marked
     every key it found — handing a made-up code the five-year marker the purge
     had just refused it. (Review finding B4. Every fixture here used an empty
     body, so the tests had the mistake built in.) */
  const junk = { members: { uidVisitor: { at: ago(1) } } };
  const r = backfill({}, [snapshot({
    "JUNK-1": junk, "EMPTY-1": {}, "NULL-1": null, "TEXT-1": "x",
    "REAL-1": { created: { at: ago(80) } },
    "REAL-2": { closed: { at: ago(40) } },
    "orgs/uni-x/JUNK-2": junk,
    "orgs/uni-x/REAL-3": { created: { at: ago(80) }, closed: { at: ago(70) } },
  })], { BACKFILL_CONFIRM: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(purgedMarkers(r.tree.purgedSessions)).sort(),
    ["REAL-1", "REAL-2", "orgs/uni-x/REAL-3"]);
  assert.match(r.out, /no timestamp[^\n]*:\s+5\b/i, "it must say how many it would not mark, and why");

  /* The same criterion as the purge, shown on the same node: neither marks it. */
  const purged = purge({ sessions: { "JUNK-1": junk } });
  assert.strictEqual(at(purged.tree, "sessions/JUNK-1"), null);
  assert.strictEqual(at(purged.tree, "purgedSessions"), null);

  // A session that had a timestamp in ONE snapshot is a session; it is dated
  // by the last snapshot that showed it as one.
  const mixed = backfill({}, [
    snapshot({ "S-1": { created: { at: ago(80) } } }, "2026-08-01T02:47:00.000Z"),
    snapshot({ "S-1": junk }, "2026-08-20T02:47:00.000Z"),
  ], { BACKFILL_CONFIRM: "1" });
  assert.deepStrictEqual(mixed.tree.purgedSessions, { "S-1": Date.parse("2026-08-01T02:47:00.000Z") });
});

test("the backfill dates a marker by the LAST snapshot that holds the session", () => {
  /* Not by today: the marker says when a session was last known to exist. */
  const r = backfill({}, [
    snapshot({ "GONE-1": REAL }, "2026-08-01T02:47:00.000Z"),
    snapshot({ "GONE-1": REAL, "GONE-2": REAL }, "2026-08-20T02:47:00.000Z"),
    snapshot({ "GONE-2": REAL }, "2026-08-05T02:47:00.000Z"),
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
  const good = snapshot({ "GONE-1": REAL });
  const cases = [
    ["not a backup payload", { some: "export" }],
    ["no date", { databaseUrl: THIS_DB, sessions: { "GONE-1": REAL } }],
    ["an unreadable date", { backupTakenAt: "last tuesday", databaseUrl: THIS_DB, sessions: { "GONE-1": REAL } }],
    /* A snapshot of ANOTHER database — the emulator, a test project — names
       sessions that were never in this one. Markers minted from it would let
       requests be recorded here for sessions this database never held. */
    ["a snapshot of another database",
      Object.assign(snapshot({ "GONE-1": REAL }), { databaseUrl: "https://other.example.test" })],
    ["a snapshot that does not say which database it is of", { backupTakenAt: TAKEN, sessions: { "GONE-1": REAL } }],
    ["a date in the future", snapshot({ "GONE-1": REAL }, new Date(NOW + DAY).toISOString())],
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
    "GONE-1": REAL, "a/b": REAL, "orgs/uni-x": REAL, "orgs/uni-x/GONE-2/extra": REAL, "bad.key": REAL, "": REAL,
    orgs: {},                                    // the organisation subtree's own name
  })], { BACKFILL_CONFIRM: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.tree.purgedSessions, { "GONE-1": Date.parse(TAKEN) });
  assert.match(r.out, /not a session location:\s+6\b/);
});

test("the backfill prints session codes only when asked", () => {
  const snap = snapshot({ "SECRETCODE-1": REAL });
  const quiet = backfill({}, [snap]);
  assert.doesNotMatch(quiet.out, /SECRETCODE/);
  assert.match(quiet.out, /to mark:\s+1\b/i, "positive control: it found the session");
  const listed = backfill({}, [snap], {}, ["--list"]);
  assert.match(listed.out, /SECRETCODE-1/);
});
