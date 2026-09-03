/* tests/erasure-node-coverage.test.js
 *
 * `scripts/lib/erasure.js` knows the participant-keyed nodes by name. That list
 * is a hand-written copy of something the DATABASE RULES already state, and a
 * hand-written copy of a moving target goes stale — silently, and in the
 * direction that matters: add a node keyed by `$clientId` to the rules, forget
 * the planner, and every erasure from then on reports success while leaving the
 * new node behind. Nobody would notice, least of all the person who asked to be
 * erased.
 *
 * So the list is DERIVED here from `database.rules.json` and compared. Anything
 * the rules key by a participant identifier must either be handled by the
 * planner or appear in ACKNOWLEDGED below with a reason — a decision, in the
 * repository, rather than an omission.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RULES = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform",
                        "database.rules.json");
const rules = JSON.parse(fs.readFileSync(RULES, "utf8")).rules;

const {
  BY_CLIENT_ID, BY_UID, BY_STABLE_ID, ROOM_BY_CLIENT_ID, ROOM_BY_UID,
} = require("../scripts/lib/erasure");

/* The wildcard names the rules use for each identifier. `tests` and `survey`
   spell clientId as `$cid`; same identifier, different spelling. */
const CLIENT_KEYS = new Set(["$clientId", "$cid"]);
const UID_KEYS = new Set(["$uid"]);
const STABLE_KEYS = new Set(["$stableId"]);

/** Direct children of `node` whose only wildcard child is a participant key. */
function keyedChildren(node, keyset) {
  const out = [];
  for (const name of Object.keys(node || {})) {
    if (name.startsWith(".") || name.startsWith("$")) continue;
    const kid = node[name];
    if (!kid || typeof kid !== "object") continue;
    for (const wild of Object.keys(kid)) {
      if (keyset.has(wild)) out.push(name);
    }
  }
  return out.sort();
}

const session = rules.sessions.$sessionId;
const room = session.rooms.$roomId;

/* Nodes the planner deliberately does not key-delete, each with the reason.
   Adding to this list is a decision that shows up in review; leaving a node out
   of BOTH lists fails the test. */
const ACKNOWLEDGED = {
  /* Empty on purpose, and that is the honest state: as of 2026-09-03 every
     participant-keyed node the rules declare is handled by the planner, so
     there is nothing to excuse. The first draft of this file carried a
     "session:votes" entry, which the derivation never produces — an exception
     for a node that was never found reads as a considered decision and is
     really just dead config. The test below stops that recurring. */
};

function assertCovered(found, handled, scope) {
  const missing = found.filter(
    (n) => !handled.includes(n) && !(`${scope}:${n}` in ACKNOWLEDGED));
  assert.deepStrictEqual(missing, [],
    `these ${scope} nodes are keyed by a participant identifier in ` +
    `database.rules.json but scripts/lib/erasure.js does not handle them. An ` +
    `erasure would report success and leave them standing. Add each to the ` +
    `planner, or to ACKNOWLEDGED in this file with the reason.`);
}

test("every session node keyed by clientId is handled by the planner", () => {
  const found = keyedChildren(session, CLIENT_KEYS);
  assert.ok(found.length >= 3, "derivation found almost nothing — it broke");
  assertCovered(found, BY_CLIENT_ID, "session");
});

test("every session node keyed by uid is handled by the planner", () => {
  const found = keyedChildren(session, UID_KEYS);
  assert.ok(found.length >= 2, "derivation found almost nothing — it broke");
  assertCovered(found, BY_UID, "session");
});

test("every session node keyed by stableId is handled by the planner", () => {
  const found = keyedChildren(session, STABLE_KEYS);
  assert.ok(found.length >= 1, "derivation found almost nothing — it broke");
  assertCovered(found, BY_STABLE_ID, "session");
});

test("every room node keyed by clientId is handled by the planner", () => {
  const found = keyedChildren(room, CLIENT_KEYS);
  assert.ok(found.length >= 5, "derivation found almost nothing — it broke");
  assertCovered(found, ROOM_BY_CLIENT_ID, "room");
});

test("every room node keyed by uid is handled by the planner", () => {
  const found = keyedChildren(room, UID_KEYS);
  assert.ok(found.length >= 1, "derivation found almost nothing — it broke");
  assertCovered(found, ROOM_BY_UID, "room");
});

test("the org tree keys participants the same way as the default tree", () => {
  /* The planner runs on a session subtree and never sees which tree it came
     from, which is only safe while the two are shaped alike. They have drifted
     before — the `rosters` org branch was mis-nested for weeks. */
  const orgSession = rules.orgs.$orgSlug.sessions.$sessionId;
  for (const [keyset, label] of [[CLIENT_KEYS, "clientId"], [UID_KEYS, "uid"],
                                 [STABLE_KEYS, "stableId"]]) {
    const a = keyedChildren(session, keyset);
    const b = keyedChildren(orgSession, keyset);
    assert.deepStrictEqual(b.filter((n) => !a.includes(n)), [],
      `the org tree has ${label}-keyed session nodes the default tree does ` +
      `not, so the planner has never been told about them`);
  }
});

test("roomChat still carries no author — the stated reason it is unerasable", () => {
  /* scripts/erase-participant.js prints, on every run, that a participant's
     simulated-patient chat cannot be separated from their roommates'. If the
     schema ever gains an author field that claim becomes false and the chat
     becomes erasable — at which point the message is the thing to fix. */
  const turn = rules.roomChat.$sessionId.$roomId.$turnId;
  const v = String(turn[".validate"] || "");
  assert.ok(!/child\('(uid|cid|clientId|by)'\)/.test(v),
    "roomChat turns now record an author. The 'unerasable' notice in " +
    "scripts/erase-participant.js is out of date, and the chat should be " +
    "added to the planner instead.");
});

test("ACKNOWLEDGED carries no exception for a node the rules do not have", () => {
  /* A stale exception is worse than none: it silently excuses a node name that
     no longer exists, and if that name ever comes BACK it arrives pre-excused
     and the coverage test stays green on a genuine gap. */
  const real = new Set([
    ...keyedChildren(session, CLIENT_KEYS).map((n) => `session:${n}`),
    ...keyedChildren(session, UID_KEYS).map((n) => `session:${n}`),
    ...keyedChildren(session, STABLE_KEYS).map((n) => `session:${n}`),
    ...keyedChildren(room, CLIENT_KEYS).map((n) => `room:${n}`),
    ...keyedChildren(room, UID_KEYS).map((n) => `room:${n}`),
  ]);
  const stale = Object.keys(ACKNOWLEDGED).filter((k) => !real.has(k));
  assert.deepStrictEqual(stale, [],
    "these exceptions name nodes the rules do not key by a participant " +
    "identifier. Remove them — an exception nobody needs is indistinguishable " +
    "from one that is load-bearing.");
});
