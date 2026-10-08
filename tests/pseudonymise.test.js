"use strict";
/* Unit tests for the research-export pseudonymisation transform.
 * Guards the de-identification fixes from the 2026-05-30 security review. */

const test = require("node:test");
const assert = require("node:assert");
const {
  pseudonymiseSession,
  pseudoCode,
  normName,
  hasResearchConsent,
  sessionHasConsent,
  REDACTED_NAME
} = require("../scripts/lib/pseudonymise");

// Research consent is a precondition for appearing in the export at all, so
// every fixture participant who is expected to survive carries one. YES/NO
// mirror the two lobby outcomes; a pool entry with no `consent` key at all
// (a record predating the field) must behave exactly like NO.
const YES = { workshop: true, research: true, version: "PIS-v2-2026-05", at: 5 };
const NO = { workshop: true, research: false, version: "PIS-v2-2026-05", at: 5 };

// A representative closed session covering every field the review flagged.
function sampleSession() {
  return {
    closed: { at: 1000 },
    adminPasswordHash: "deadbeef-secret",
    created: { by: "Dr Facilitator", at: 1 },                 // facilitator name (not in pool)
    _adminPresence: { by: "Dr Facilitator", at: 2 },          // facilitator transient
    _superadminReset: { by: "Dr Facilitator", code: "ZZZ9", requestedAt: 3 },
    pool: {
      c1: { name: "Alice", university: "Caen", at: 10, consent: YES },
      c2: { name: "Bob", university: "Nagoya", at: 20, consent: YES },
      c3: { name: "Alice", university: "Caen", at: 30, consent: YES }       // DUPLICATE display name
    },
    rooms: {
      r1: {
        uidMembers: { uidA: true },
        answers: {
          a1: { by: "Alice", university: "Caen", text: "differential is X" },
          a2: { by: "Bob", text: "I agree" }
        },
        score: {
          manual: { m1: { by: "Dr Facilitator", points: 5 } } // facilitator awarder
        },
        moduleA: {
          scoring: { awarded: { fam1: { points: 2 } } },
          chat: {                                              // FREE-TEXT — must be dropped
            t1: { role: "user", content: "Hi, I'm Alice, my question is...", at: 11 },
            t2: { role: "assistant", content: "I am Mr Lefebvre...", at: 12 }
          }
        }
      }
    }
  };
}

test("participant names in pool/name and by-fields become Student-A/B by join order", () => {
  const linkage = {};
  const out = pseudonymiseSession(sampleSession(), "S1", linkage);
  assert.strictEqual(out.pool.c1.name, "Student-A"); // Alice joined first
  assert.strictEqual(out.pool.c2.name, "Student-B"); // Bob second
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
  assert.strictEqual(out.rooms.r1.answers.a2.by, "Student-B");
  assert.strictEqual(linkage.S1.Alice, "Student-A");
  assert.strictEqual(linkage.S1.Bob, "Student-B");
});

test("duplicate display names are still fully mapped — no plaintext survivor", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  // The third participant also named "Alice" must NOT keep the plaintext name.
  assert.strictEqual(out.pool.c3.name, "Student-A");
  const blob = JSON.stringify(out);
  assert.ok(!/Alice/.test(blob), "no occurrence of the real name 'Alice' may remain");
  assert.ok(!/Bob/.test(blob), "no occurrence of the real name 'Bob' may remain");
});

test("facilitator names (not in pool) are redacted everywhere, never passed through", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.strictEqual(out.created.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.score.manual.m1.by, REDACTED_NAME);
  const blob = JSON.stringify(out);
  assert.ok(!/Facilitator/.test(blob), "facilitator real name must not survive");
});

test("facilitator transient subtrees and the admin hash are dropped", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.ok(!("adminPasswordHash" in out));
  assert.ok(!("_adminPresence" in out));
  assert.ok(!("_superadminReset" in out));
  const blob = JSON.stringify(out);
  assert.ok(!/ZZZ9/.test(blob), "recovery code must not survive");
});

test("free-text LLM chat turns are dropped entirely", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.ok(!("chat" in out.rooms.r1.moduleA), "chat subtree must be removed");
  const blob = JSON.stringify(out);
  assert.ok(!/my question is/.test(blob), "free-text content must not survive");
  // Non-free-text scoring under moduleA must be preserved.
  assert.strictEqual(out.rooms.r1.moduleA.scoring.awarded.fam1.points, 2);
});

test("university is bucketed to Univ-N consistently within the session", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  const caen = out.pool.c1.university;
  const nagoya = out.pool.c2.university;
  assert.match(caen, /^Univ-\d+$/);
  assert.match(nagoya, /^Univ-\d+$/);
  assert.notStrictEqual(caen, nagoya);                 // distinct universities -> distinct codes
  assert.strictEqual(out.pool.c3.university, caen);    // same university -> same code
  assert.strictEqual(out.rooms.r1.answers.a1.university, caen); // consistent in answer objects too
  const blob = JSON.stringify(out);
  assert.ok(!/Caen/.test(blob) && !/Nagoya/.test(blob), "raw university names must not survive");
});

test("non-name fields are left intact", () => {
  const out = pseudonymiseSession(sampleSession(), "S1", {});
  assert.strictEqual(out.rooms.r1.answers.a1.text, "differential is X");
  assert.strictEqual(out.rooms.r1.score.manual.m1.points, 5);
  assert.strictEqual(out.closed.at, 1000);
  assert.strictEqual(out.created.at, 1);               // timestamp kept, only `by` redacted
});

test("name matching is whitespace/NFC tolerant", () => {
  const sess = {
    pool: { c1: { name: "Alice", at: 1, consent: YES } },
    rooms: { r1: { answers: { a1: { by: "  Alice  " } } } }   // padded variant
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
});

test("input is not mutated (deep copy)", () => {
  const sess = sampleSession();
  const before = JSON.stringify(sess);
  pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(JSON.stringify(sess), before, "source session must be unchanged");
});

test("pseudoCode rolls over past 26 participants", () => {
  assert.strictEqual(pseudoCode(0), "Student-A");
  assert.strictEqual(pseudoCode(25), "Student-Z");
  assert.strictEqual(pseudoCode(26), "Student-AA");
  assert.strictEqual(pseudoCode(27), "Student-AB");
});

test("normName trims and NFC-normalises, passes non-strings through", () => {
  assert.strictEqual(normName("  x "), "x");
  assert.strictEqual(normName(5), 5);
  assert.strictEqual(normName(null), null);
});

test("participants named like Object built-ins are pseudonymised, not dropped", () => {
  const sess = {
    pool: {
      c1: { name: "__proto__", at: 1, consent: YES },
      c2: { name: "toString", at: 2, consent: YES },
      c3: { name: "constructor", at: 3, consent: YES }
    },
    rooms: { r1: { answers: {
      a1: { by: "__proto__" }, a2: { by: "toString" }, a3: { by: "constructor" }
    } } }
  };
  const linkage = {};
  const out = pseudonymiseSession(sess, "S1", linkage);
  assert.strictEqual(out.pool.c1.name, "Student-A");
  assert.strictEqual(out.pool.c2.name, "Student-B");
  assert.strictEqual(out.pool.c3.name, "Student-C");
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
  assert.strictEqual(out.rooms.r1.answers.a2.by, "Student-B");
  assert.strictEqual(out.rooms.r1.answers.a3.by, "Student-C");
  // No real value should be a non-string (function/object) leftover.
  for (const a of Object.values(out.rooms.r1.answers)) {
    assert.strictEqual(typeof a.by, "string");
  }
  // Linkage round-trips through JSON with the literal "__proto__" key intact.
  const round = JSON.parse(JSON.stringify(linkage));
  assert.strictEqual(round.S1["__proto__"], "Student-A");
});

test("participant names appearing as bare array elements are scrubbed", () => {
  const sess = {
    pool: { c1: { name: "Alice", at: 1, consent: YES } },
    rooms: { r1: { tags: ["Alice", "keep-me", "Alice"] } }
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.deepStrictEqual(out.rooms.r1.tags, ["Student-A", "keep-me", "Student-A"]);
  assert.ok(!/Alice/.test(JSON.stringify(out)), "no real name may survive in arrays");
});

test("a session with no pool redacts every name/by and does not crash", () => {
  const sess = {
    created: { by: "Dr Fac", at: 1 },
    rooms: { r1: { answers: { a1: { by: "Whoever", text: "keep" } } } }
  };
  const out = pseudonymiseSession(sess, "S1", {});
  assert.strictEqual(out.created.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.answers.a1.by, REDACTED_NAME);
  assert.strictEqual(out.rooms.r1.answers.a1.text, "keep");
});

/* ============ RESEARCH CONSENT gate (Phase-4e compliance gap 1) ============
 * The lobby collects an OPTIONAL research tick; joining the workshop is not
 * conditional on it. These guard that opting out actually removes the person
 * from the research export, and that the absence of a record never reads as
 * agreement. */

// A mixed session: c1 consented, c2 declined, c3 has no consent record at all
// (a row written before the field existed). Only c1 may survive.
function mixedConsentSession() {
  return {
    closed: { at: 1000 },
    pool: {
      c1: { name: "Yes-Person", university: "Caen", at: 10, consent: YES },
      c2: { name: "No-Person", university: "Caen", at: 20, consent: NO },
      c3: { name: "Legacy-Person", university: "Caen", at: 30 }
    },
    clientMapping: { c1: "uid1", c2: "uid2", c3: "uid3" },
    stableIdMapping: { s1: "uid1", s2: "uid2", s3: "uid3" },
    poll: {
      c1: { hardest: "modA" },
      c2: { hardest: "modB" },
      c3: { hardest: "modA" }
    },
    rooms: {
      r1: {
        uidMembers: { uid1: true, uid2: true, uid3: true },
        answers: {
          a1: { by: "Yes-Person", text: "keep me" },
          a2: { by: "No-Person", text: "drop my attribution" }
        },
        tags: ["No-Person", "keep-me"],
        votes: { v1: { ballots: { s1: "opt-a", s2: "opt-b", s3: "opt-c" } } }
      }
    }
  };
}

test("only participants who consented to research reach the export", () => {
  const out = pseudonymiseSession(mixedConsentSession(), "S1", {});
  assert.ok(out.pool.c1, "the consenting participant is kept");
  assert.ok(!("c2" in out.pool), "a participant who declined is removed from the pool");
  assert.ok(!("c3" in out.pool), "a participant with no consent record is removed too");
});

test("consent is fail-closed: a missing record is never treated as agreement", () => {
  assert.strictEqual(hasResearchConsent({ consent: YES }), true);
  assert.strictEqual(hasResearchConsent({ consent: NO }), false);
  assert.strictEqual(hasResearchConsent({}), false);                       // no consent key
  assert.strictEqual(hasResearchConsent({ consent: {} }), false);          // key but no field
  assert.strictEqual(hasResearchConsent({ consent: { research: "true" } }), false); // string, not bool
  assert.strictEqual(hasResearchConsent(null), false);
  assert.strictEqual(hasResearchConsent(undefined), false);
});

test("a non-consenting participant's clientId-keyed data is erased", () => {
  const out = pseudonymiseSession(mixedConsentSession(), "S1", {});
  assert.deepStrictEqual(Object.keys(out.poll), ["c1"], "only the consenting poll answer survives");
});

test("a non-consenting participant's stableId-keyed ballot is erased", () => {
  const out = pseudonymiseSession(mixedConsentSession(), "S1", {});
  const ballots = out.rooms.r1.votes.v1.ballots;
  assert.deepStrictEqual(Object.keys(ballots), ["s1"],
    "ballots are keyed by stableId, so the clientId filter alone would miss them");
});

test("a non-consenting participant's name never survives, in any field", () => {
  const out = pseudonymiseSession(mixedConsentSession(), "S1", {});
  const blob = JSON.stringify(out);
  assert.ok(!/No-Person/.test(blob), "declining participant's name must not survive");
  assert.ok(!/Legacy-Person/.test(blob), "no-record participant's name must not survive");
  assert.ok(!/Yes-Person/.test(blob), "the consenting participant is pseudonymised, not plaintext");
  // Redacted rather than passed through, including as a bare array element.
  assert.strictEqual(out.rooms.r1.answers.a2.by, REDACTED_NAME);
  assert.deepStrictEqual(out.rooms.r1.tags, [REDACTED_NAME, "keep-me"]);
});

test("the linkage table lists only consenting participants", () => {
  const linkage = {};
  pseudonymiseSession(mixedConsentSession(), "S1", linkage);
  assert.deepStrictEqual(Object.keys(linkage.S1), ["Yes-Person"],
    "a non-consenting participant must have no re-identification key");
});

test("auth-uid mappings are dropped and uid-keyed membership is rekeyed", () => {
  const out = pseudonymiseSession(mixedConsentSession(), "S1", {});
  assert.ok(!("clientMapping" in out), "clientId -> uid join table must not be exported");
  assert.ok(!("stableIdMapping" in out), "stableId -> uid join table must not be exported");
  // uidMembers keeps its shape but is keyed by pseudonym, so room membership
  // stays analysable without exporting a cross-session identifier.
  // Compare the serialised form: that is what lands in the export file, and the
  // rekeyed map is deliberately null-prototype (as the other lookup maps here).
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(out.rooms.r1.uidMembers)),
    { "Student-A": true }
  );
  assert.ok(!/uid1|uid2|uid3/.test(JSON.stringify(out)), "no raw auth uid may survive");
});

test("a consenting participant sharing a name with a decliner keeps the pseudonym", () => {
  const sess = {
    pool: {
      c1: { name: "Sam", at: 10, consent: YES },
      c2: { name: "Sam", at: 20, consent: NO }
    },
    rooms: { r1: { answers: { a1: { by: "Sam" } } } }
  };
  const out = pseudonymiseSession(sess, "S1", {});
  // The shared name is ambiguous, so it must resolve to the consenting
  // participant's pseudonym rather than being redacted away.
  assert.strictEqual(out.rooms.r1.answers.a1.by, "Student-A");
  assert.ok(!("c2" in out.pool));
});

test("sessionHasConsent detects whether a session may be exported at all", () => {
  assert.strictEqual(sessionHasConsent(mixedConsentSession()), true);
  assert.strictEqual(sessionHasConsent({ pool: { c1: { name: "N", consent: NO } } }), false);
  assert.strictEqual(sessionHasConsent({ pool: { c1: { name: "N" } } }), false);
  assert.strictEqual(sessionHasConsent({ pool: {} }), false);
  assert.strictEqual(sessionHasConsent({}), false);
});

/* ============ ACCOUNT IDENTIFIERS outside the two mapping tables ============
 * Found 2026-10-08 by running the function, not by reading it. The header says
 * `clientMapping` / `stableIdMapping` are dropped because a Firebase auth uid
 * is the same in every session, and `members` is rekeyed for the same reason.
 * Three more places held one and none was handled:
 *   - `creatorUid`            the facilitator's account
 *   - `scenarioRef.ownerUid`  the account of whoever authored the scenario —
 *                             for a shared scenario, somebody who was never in
 *                             the session
 *   - `roomOf/<uid>`          EVERY participant's account, as a key, with their
 *                             clientId beside it: the join `clientMapping` was
 *                             dropped to withhold, the other way round. Added
 *                             to the rules on 2026-08-03, after this module's
 *                             list of uid-keyed maps was written.
 * tests/pseudonymise-uid-coverage.test.js derives that list from the rules so
 * that it cannot be one short again; these pin the behaviour on a session
 * shaped like a real one. */

const FACILITATOR_UID = "FacilitatorAuthUid0000000001";
const AUTHOR_UID = "ScenarioAuthorAuthUid0000002";
const STUDENT_UID = "StudentAuthUid00000000000003";
const DECLINER_UID = "DeclinerAuthUid0000000000004";

function accountIdSession() {
  return {
    created: { by: "Dr Facilitator", at: 1 },
    closed: { by: "Dr Facilitator", at: 1000 },
    creatorUid: FACILITATOR_UID,
    scenarioId: "chest-pain",
    scenarioRef: { ownerUid: AUTHOR_UID, scenarioId: "chest-pain", source: "shared" },
    members: {
      [FACILITATOR_UID]: { at: 2 },
      [STUDENT_UID]: { at: 10 },
      [DECLINER_UID]: { at: 20 }
    },
    roomOf: {
      [STUDENT_UID]: { room: "Room 1", cid: "c1" },
      [DECLINER_UID]: { room: "Room 1", cid: "c2" }
    },
    clientMapping: { c1: STUDENT_UID, c2: DECLINER_UID },
    pool: {
      c1: { name: "Ann", university: "Caen", at: 10, room: "Room 1", consent: YES },
      c2: { name: "Ben", university: "Caen", at: 20, room: "Room 1", consent: NO }
    },
    rooms: {
      "Room 1": {
        answers: { moduleA: { a1: { by: "Ann", cid: "c1", text: "differential is X", at: 30 } } }
      }
    }
  };
}

test("no account identifier survives — the facilitator's, the scenario author's or a participant's", () => {
  const sess = accountIdSession();
  const before = JSON.stringify(sess);
  const blob = JSON.stringify(pseudonymiseSession(sess, "S1", {}));
  for (const [who, uid] of [["the facilitator (creatorUid)", FACILITATOR_UID],
                            ["the scenario author (scenarioRef.ownerUid)", AUTHOR_UID],
                            ["a consenting participant (roomOf key)", STUDENT_UID],
                            ["a participant who declined (roomOf key)", DECLINER_UID]]) {
    // Anti-vacuity: a fixture that never held the uid would pass on its own.
    assert.ok(before.includes(uid), "fixture is broken: it does not hold the uid of " + who);
    assert.ok(!blob.includes(uid),
      "the export still carries the Firebase auth uid of " + who + ". An auth uid is the " +
      "same in every session, so it re-links what the per-session pseudonyms keep apart.");
  }
});

test("the session's research content is still returned once the identifiers are gone", () => {
  const out = pseudonymiseSession(accountIdSession(), "S1", {});
  assert.strictEqual(out.pool.c1.name, "Student-A");
  assert.strictEqual(out.rooms["Room 1"].answers.moduleA.a1.text, "differential is X");
  assert.strictEqual(out.rooms["Room 1"].answers.moduleA.a1.by, "Student-A");
  assert.strictEqual(out.created.at, 1);
  assert.strictEqual(out.closed.at, 1000);
  assert.strictEqual(out.scenarioId, "chest-pain");
});

test("creatorUid is dropped, not replaced: one creator per session is not a variable", () => {
  const out = pseudonymiseSession(accountIdSession(), "S1", {});
  assert.ok(!("creatorUid" in out));
});

test("a scenario reference keeps WHICH scenario ran and loses whose account holds it", () => {
  const out = pseudonymiseSession(accountIdSession(), "S1", {});
  assert.deepStrictEqual(out.scenarioRef, { scenarioId: "chest-pain", source: "shared" });
});

test("ownerUid is dropped whatever it holds — the rules ask only for a string", () => {
  /* `scenarioRef.ownerUid` is validated as a string of at most 128 characters,
     not as the writer's own uid, and until the rules bound `scenarioRef` to the
     session's creator any signed-in visitor could write it. A replacement keyed
     on "is this a uid we know" would pass anything else through. */
  const sess = accountIdSession();
  sess.scenarioRef.ownerUid = "someone@example.org";
  const blob = JSON.stringify(pseudonymiseSession(sess, "S1", {}));
  assert.ok(!blob.includes("someone@example.org"));
});

test("roomOf is rekeyed by pseudonym like members: who was in which room, not which account", () => {
  const out = pseudonymiseSession(accountIdSession(), "S1", {});
  // Serialised form, as for uidMembers above: the rekeyed map is null-prototype.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.roomOf)),
    { "Student-A": { room: "Room 1", cid: "c1" } },
    "the consenting participant's claim is kept under their pseudonym; the decliner's, " +
    "and any uid that maps to no consenting participant, is removed");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.members)), { "Student-A": { at: 10 } });
});
