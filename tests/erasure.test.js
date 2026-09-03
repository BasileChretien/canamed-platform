/* tests/erasure.test.js
 *
 * The planner behind `scripts/erase-participant.js` and the archive
 * suppression it feeds (Annex VI G12, technical half).
 *
 * The stakes are asymmetric and the tests are shaped by that. Erasing too
 * LITTLE means telling someone their data is gone when it is not — the defect
 * G12 records. Erasing too MUCH means destroying a third party's work in the
 * name of someone else's rights, which no amount of good intent repairs. So
 * there are tests for both directions, and the namesake case has its own.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  resolveIdentity, planSessionErasure, applyPlan,
} = require("../scripts/lib/erasure");
const { buildRecord, applySuppression } = require("../scripts/lib/suppression");

/* A session holding TWO participants, one of whom (cid-b / uid-B) shares a
   display name with the target. That collision is the whole point of the
   fixture: every "erase" assertion below is also an assertion that B survived. */
function fixture() {
  return {
    created: { at: 1 },
    clientMapping: { "cid-a1": "uid-A", "cid-a2": "uid-A", "cid-b": "uid-B" },
    stableIdMapping: { "sid-A": "uid-A", "sid-B": "uid-B" },
    members: { "uid-A": true, "uid-B": true },
    roomOf: { "uid-A": { room: "Room 1", cid: "cid-a1" },
              "uid-B": { room: "Room 1", cid: "cid-b" } },
    pool: {
      "cid-a1": { name: "Sato Yuki", university: "Caen", room: "Room 1",
                  consent: { research: true } },
      "cid-a2": { name: "Sato Yuki", university: "Caen", room: "Room 1" },
      "cid-b": { name: "Sato Yuki", university: "Nagoya", room: "Room 1" },
    },
    poll: { "cid-a1": { hardest: "x" }, "cid-b": { hardest: "y" } },
    rooms: {
      "Room 1": {
        stage: 1,
        presence: { "cid-a1": 1, "cid-b": 1 },
        typing: { "cid-a1": true },
        observers: { "cid-b": true },
        roleChoices: { "cid-a1": "doctor", "cid-b": "nurse" },
        tests: { "cid-a1": { score: 3 }, "cid-b": { score: 4 } },
        survey: { "cid-a1": { q1: 5 } },
        uidMembers: { "uid-A": true, "uid-B": true },
        votes: {
          "vote-1": { committed: true,
                      ballots: { "cid-a1": "opt1", "cid-b": "opt2" } },
        },
        moduleA: {
          hypotheses: {
            h1: { text: "sepsis", by: "Sato Yuki", cid: "cid-a1", at: 1 },
            h2: { text: "pneumonia", by: "Sato Yuki", cid: "cid-b", at: 2 },
          },
        },
        answers: {
          moduleA: {
            e1: { text: "aaa", by: "Sato Yuki", cid: "cid-a2", at: 3 },
            e2: { text: "bbb", by: "Sato Yuki", cid: "cid-b", at: 4 },
            /* No cid at all — the ambiguous case. */
            e3: { text: "ccc", by: "Sato Yuki", at: 5 },
          },
        },
        events: {
          ev1: { kind: "join", by: "Sato Yuki", cid: "cid-a1", at: 6 },
          ev2: { kind: "join", by: "Sato Yuki", cid: "cid-b", at: 7 },
        },
      },
      "Room 2": { stage: 0, presence: { "cid-z": 1 } },
    },
  };
}

// ---------------------------------------------------------------- identity

test("identity resolves from a uid to every clientId and stableId it owns", () => {
  const id = resolveIdentity(fixture(), { uid: "uid-A" });
  assert.strictEqual(id.uid, "uid-A");
  assert.deepStrictEqual(id.clientIds, ["cid-a1", "cid-a2"]);
  assert.deepStrictEqual(id.stableIds, ["sid-A"]);
});

test("identity resolves from a clientId, then finds the participant's OTHER clientId", () => {
  /* One person, two browsers. Resolving only the id you were handed would
     leave half their rows behind and report a complete erasure. */
  const id = resolveIdentity(fixture(), { clientId: "cid-a2" });
  assert.strictEqual(id.uid, "uid-A");
  assert.deepStrictEqual(id.clientIds, ["cid-a1", "cid-a2"]);
});

test("identity resolves from a stableId", () => {
  const id = resolveIdentity(fixture(), { stableId: "sid-A" });
  assert.strictEqual(id.uid, "uid-A");
  assert.deepStrictEqual(id.clientIds, ["cid-a1", "cid-a2"]);
});

test("a clientId in pool but not yet in clientMapping is still claimed", () => {
  /* The join chain writes `pool` before `clientMapping`, so someone who
     abandoned the join has the first and not the second. Requiring a mapping
     row would skip exactly those rows — the ones with a name in them. */
  const s = fixture();
  s.pool["cid-orphan"] = { name: "Half Joined", university: "Caen" };
  const id = resolveIdentity(s, { clientId: "cid-orphan" });
  assert.strictEqual(id.uid, null);
  assert.deepStrictEqual(id.clientIds, ["cid-orphan"]);
});

test("an unknown identifier resolves to nothing rather than to everything", () => {
  const id = resolveIdentity(fixture(), { uid: "uid-NOBODY" });
  assert.deepStrictEqual(id, { uid: "uid-NOBODY", clientIds: [], stableIds: [] });
  const plan = planSessionErasure(fixture(), id);
  assert.deepStrictEqual(plan.deletes, []);
});

// -------------------------------------------------------------------- plan

test("the plan reaches every node keyed by any of the three identifiers", () => {
  const s = fixture();
  const plan = planSessionErasure(s, resolveIdentity(s, { uid: "uid-A" }));
  for (const p of [
    "pool/cid-a1", "pool/cid-a2", "poll/cid-a1",
    "clientMapping/cid-a1", "clientMapping/cid-a2",
    "members/uid-A", "roomOf/uid-A", "stableIdMapping/sid-A",
    "rooms/Room 1/presence/cid-a1", "rooms/Room 1/typing/cid-a1",
    "rooms/Room 1/roleChoices/cid-a1", "rooms/Room 1/tests/cid-a1",
    "rooms/Room 1/survey/cid-a1", "rooms/Room 1/uidMembers/uid-A",
    "rooms/Room 1/votes/vote-1/ballots/cid-a1",
    "rooms/Room 1/moduleA/hypotheses/h1",
    "rooms/Room 1/answers/moduleA/e1",
    "rooms/Room 1/events/ev1",
  ]) {
    assert.ok(plan.deletes.includes(p), `plan is missing ${p}`);
  }
});

test("the plan leaves the OTHER participant entirely alone", () => {
  const s = fixture();
  const plan = planSessionErasure(s, resolveIdentity(s, { uid: "uid-A" }));
  const touchesB = plan.deletes.filter((p) => /cid-b|uid-B|sid-B/.test(p));
  assert.deepStrictEqual(touchesB, [],
    "the plan would delete rows belonging to a different participant");
});

test("NAMESAKE SAFETY: an entry attributed by name with no cid is never deleted", () => {
  const s = fixture();
  const plan = planSessionErasure(s, resolveIdentity(s, { uid: "uid-A" }));
  assert.ok(!plan.deletes.includes("rooms/Room 1/answers/moduleA/e3"),
    "an entry whose only link is a shared display name was deleted — that is " +
    "how you destroy a namesake's work while honouring someone else's request");
  assert.strictEqual(plan.ambiguous.length, 1);
  assert.strictEqual(plan.ambiguous[0].path, "rooms/Room 1/answers/moduleA/e3");
  assert.match(plan.ambiguous[0].reason, /display name/);
});

test("rooms the participant never entered contribute nothing", () => {
  const s = fixture();
  const plan = planSessionErasure(s, resolveIdentity(s, { uid: "uid-A" }));
  assert.deepStrictEqual(plan.deletes.filter((p) => p.startsWith("rooms/Room 2")), []);
});

test("malformed or empty input yields an empty plan instead of throwing", () => {
  for (const bad of [null, undefined, {}, { rooms: null }, { pool: "nope" },
                     { rooms: { r: null } }]) {
    const plan = planSessionErasure(bad, { uid: "uid-A", clientIds: ["c"], stableIds: [] });
    assert.deepStrictEqual(plan.deletes, []);
    assert.deepStrictEqual(plan.ambiguous, []);
  }
});

// --------------------------------------------------------------- applyPlan

test("applyPlan removes exactly the planned paths and mutates nothing", () => {
  const s = fixture();
  const frozen = JSON.stringify(s);
  const plan = planSessionErasure(s, resolveIdentity(s, { uid: "uid-A" }));
  const out = applyPlan(s, plan);

  assert.strictEqual(JSON.stringify(s), frozen, "the input was mutated");
  assert.ok(!("cid-a1" in out.pool) && !("cid-a2" in out.pool));
  assert.ok("cid-b" in out.pool, "the other participant was removed too");
  assert.ok(!("h1" in out.rooms["Room 1"].moduleA.hypotheses));
  assert.ok("h2" in out.rooms["Room 1"].moduleA.hypotheses);
  assert.strictEqual(out.rooms["Room 1"].stage, 1, "unrelated data was disturbed");
});

test("applyPlan tolerates a path that is no longer there", () => {
  const out = applyPlan({ pool: {} }, { deletes: ["pool/gone", "rooms/x/y/z"] });
  assert.deepStrictEqual(out, { pool: {} });
});

// ------------------------------------------------------------- suppression

const AT = "2026-09-03T00:00:00.000Z";

test("a suppression record that identifies nobody is refused", () => {
  assert.throws(
    () => buildRecord({ locationKey: "ABC", identity: {}, at: AT }),
    /at least one identifier/,
    "an empty record would suppress nothing on restore while looking like a " +
    "record that had been honoured");
});

test("a suppression record refuses to invent its own timestamp", () => {
  assert.throws(() => buildRecord({ locationKey: "ABC",
    identity: { uid: "uid-A" } }), /explicit `at`/);
});

test("a suppression record carries identifiers only — no name, no content", () => {
  const s = fixture();
  const rec = buildRecord({ locationKey: "ABC",
    identity: resolveIdentity(s, { uid: "uid-A" }), at: AT });
  const json = JSON.stringify(rec);
  assert.ok(!/Sato Yuki/.test(json),
    "the record embeds the display name — keeping the erased values in order " +
    "to know what to suppress defeats the erasure");
  assert.ok(!/sepsis|aaa|Caen/.test(json), "the record embeds content");
});

test("suppression strips the participant out of an archived snapshot", () => {
  const s = fixture();
  const rec = buildRecord({ locationKey: "ABC",
    identity: resolveIdentity(s, { uid: "uid-A" }), at: AT });
  const payload = { backupTakenAt: AT, sessions: { ABC: fixture() } };
  const { payload: clean, applied, skipped } = applySuppression(payload, [rec]);

  assert.strictEqual(skipped.length, 0);
  assert.strictEqual(applied.length, 1);
  assert.ok(applied[0].removed > 10);
  assert.ok(!("cid-a1" in clean.sessions.ABC.pool));
  assert.ok("cid-b" in clean.sessions.ABC.pool, "the roommate was suppressed too");
  assert.ok("cid-a1" in payload.sessions.ABC.pool, "the input payload was mutated");
});

test("suppression re-resolves against the SNAPSHOT, catching ids the record never saw", () => {
  /* The record is written from the live tree at erasure time. A snapshot taken
     earlier can hold a clientId that had already been abandoned — trusting the
     record's list alone would restore it. */
  const rec = buildRecord({ locationKey: "ABC",
    identity: { uid: "uid-A", clientIds: ["cid-a1"], stableIds: [] }, at: AT });
  const snap = fixture();
  snap.clientMapping["cid-a-old"] = "uid-A";
  snap.pool["cid-a-old"] = { name: "Sato Yuki", university: "Caen" };

  const { payload: clean, applied } = applySuppression(
    { sessions: { ABC: snap } }, [rec]);
  assert.ok(!("cid-a-old" in clean.sessions.ABC.pool),
    "a clientId present in the snapshot but absent from the record survived");
  assert.ok(applied[0].identity.clientIds.includes("cid-a-old"));
});

test("a record for a session not in the snapshot is skipped, visibly", () => {
  const rec = buildRecord({ locationKey: "OTHER",
    identity: { uid: "uid-A", clientIds: [], stableIds: [] }, at: AT });
  const { applied, skipped } = applySuppression({ sessions: { ABC: fixture() } }, [rec]);
  assert.strictEqual(applied.length, 0);
  assert.strictEqual(skipped.length, 1,
    "a record that matched nothing must be reported, so a run that suppressed " +
    "nothing is distinguishable from one that had nothing to suppress");
});

test("live erasure and archive suppression produce the SAME removals", () => {
  /* The reason both call one planner. If these ever diverge, the archive
     becomes the copy that still holds the participant. */
  const s = fixture();
  const identity = resolveIdentity(s, { uid: "uid-A" });
  const livePlan = planSessionErasure(s, identity);

  const rec = buildRecord({ locationKey: "ABC", identity, at: AT });
  const { applied } = applySuppression({ sessions: { ABC: fixture() } }, [rec]);

  assert.deepStrictEqual(applied[0].paths, livePlan.deletes);
});
