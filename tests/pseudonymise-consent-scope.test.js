/* tests/pseudonymise-consent-scope.test.js
 *
 * WHO the research export lets through. Participants are told research use is
 * optional; until transform version 3 the export removed only what was KEYED
 * by a declining participant, so what they wrote into a room's shared lists —
 * answers, replies, hypotheses, edits, deleted answers, events — went out with
 * the name redacted and their clientId beside it. Rows under an identity with
 * no participant-list entry went out as written, and one invented entry that
 * recorded consent made a session exportable on its own.
 *
 * The export is now an INCLUSION filter: a record that names a person is kept
 * only when it can be shown to be an included participant's — one whose
 * pool row records research consent, is bound to an account by clientMapping,
 * and has not been withdrawn. These tests run the real function on a session
 * written the way the stock client writes it (tests/fixtures/
 * consent-scope-session.js) and look at the SERIALISED output, where a value
 * cannot hide under a key nobody thought to check.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { pseudonymiseSession, applyWithdrawals, sessionHasConsent, TRANSFORM_VERSION } =
  require("../scripts/lib/pseudonymise");
const { PARTIES, INCLUDED, EXCLUDED, ids, consentScopeSession, consentScopeWithdrawals, YES } =
  require("./fixtures/consent-scope-session");
const { asRtdbWould, holdsArray } = require("./fixtures/rtdb-shape");

function exported(stats) {
  const sess = applyWithdrawals(consentScopeSession(), consentScopeWithdrawals());
  return pseudonymiseSession(sess, "S1", {}, stats);
}

/** Every path in `tree` whose key or string value contains `needle`. */
function whereIs(tree, needle) {
  const out = [];
  (function walk(node, at) {
    if (typeof node === "string") { if (node.includes(needle)) out.push(at.join("/")); return; }
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      if (k.includes(needle)) out.push(at.concat(k).join("/") + " [key]");
      walk(node[k], at.concat(k));
    }
  })(tree, []);
  return out;
}

const RECORD_KINDS = ["pool row", "poll", "answer", "edit", "section answer", "deleted answer",
  "hypothesis", "section hypothesis", "reply", "ballot", "tests", "survey", "role choice",
  "presence", "event", "reveal", "triage"];

test("the fixture plants what every party writes, so a clean result means something", () => {
  /* A test that plants nothing cannot fail. Each party's token must be in the
     database in every kind of record the stock client writes for them. */
  const db = consentScopeSession();
  const room = db.rooms["Room 1"];
  for (const key of Object.keys(PARTIES)) {
    const { cid, stableId } = ids(key);
    const T = PARTIES[key].token;
    const present = {
      "pool row": PARTIES[key].noPool ? true : cid in db.pool,
      poll: cid in db.poll,
      answer: room.answers.moduleA["ans-" + T].text.includes(T),
      edit: room.answers.moduleA["ans-" + T].edits["ed-" + T].text.includes(T),
      "section answer": room.answers.sections[1]["sans-" + T].text.includes(T),
      "deleted answer": room.answersDeleted["del-" + T].text.includes(T),
      hypothesis: room.moduleA.hypotheses["hyp-" + T].text.includes(T),
      "section hypothesis": room.sections[1].hypotheses["shyp-" + T].text.includes(T),
      reply: room.answerReplies["ans-ANN7"]["rep-" + T].text.includes(T),
      ballot: stableId in room.votes.d1.ballots,
      tests: cid in room.tests,
      survey: room.survey[cid].responses.q1.includes(T),
      "role choice": cid in room.roleChoices,
      presence: cid in room.presence,
      event: JSON.parse(room.events["ev-" + T].payload).note.includes(T),
      reveal: ("item-" + T) in room.sections[1].revealed,
      triage: room.sections[1].triage["tri-" + T].reason.includes(T)
    };
    for (const kind of RECORD_KINDS) {
      assert.strictEqual(present[kind], true, `fixture is broken: ${key} has no ${kind}`);
    }
  }
  assert.ok(JSON.stringify(db).includes("help asked by BEN7"));
  assert.ok(typeof db.rooms["Room 1"].teamName === "string");
});

test("nothing an excluded party wrote, and none of their identifiers, reaches the export", () => {
  const out = exported();
  const db = JSON.stringify(consentScopeSession());
  for (const key of EXCLUDED) {
    const T = PARTIES[key].token;
    assert.ok(db.includes(T), `fixture is broken: nothing of ${key} is in it`);
    const left = whereIs(out, T);
    assert.deepStrictEqual(left, [],
      `${PARTIES[key].what} (${key}) is still in the research export at:\n  ` + left.join("\n  "));
  }
  const text = JSON.stringify(out);
  for (const name of ["Ann Dupont", "Ben Sato", "Cleo Martin", "Dana Kato", "Eve Leroy",
                      "Mallory Noentry", "Fergus Forged", "Dr Claire Facilitator", "Nagoya"]) {
    assert.ok(db.includes(name), "fixture is broken: it does not hold " + name);
    assert.ok(!text.includes(name), name + " reached the export");
  }
  assert.ok(!/uid-[A-Z]/.test(text), "an account uid reached the export");
});

test("what the consenting participant wrote is all still there", () => {
  const out = exported();
  const room = out.rooms["Room 1"];
  const { cid, stableId } = ids("ann");
  assert.strictEqual(out.pool[cid].name, "Student-A");
  assert.strictEqual(out.poll[cid].hardest, "hardest part for ANN7");
  assert.strictEqual(room.answers.moduleA["ans-ANN7"].text, "answer by ANN7");
  assert.strictEqual(room.answers.moduleA["ans-ANN7"].by, "Student-A");
  assert.strictEqual(room.answers.moduleA["ans-ANN7"].edits["ed-ANN7"].text, "first draft by ANN7");
  assert.strictEqual(room.answers.sections[1]["sans-ANN7"].text, "section answer by ANN7");
  assert.strictEqual(room.answersDeleted["del-ANN7"].text, "deleted point by ANN7");
  assert.strictEqual(room.moduleA.hypotheses["hyp-ANN7"].text, "hypothesis by ANN7");
  assert.strictEqual(room.sections[1].hypotheses["shyp-ANN7"].text, "section hypothesis by ANN7");
  assert.strictEqual(room.answerReplies["ans-ANN7"]["rep-ANN7"].text, "reply by ANN7");
  assert.deepStrictEqual(room.votes.d1.ballots[stableId], { choice: 2, at: 26 });
  assert.strictEqual(room.tests[cid].post.score, 4);
  assert.strictEqual(room.survey[cid].responses.q1, "survey text by ANN7");
  assert.strictEqual(room.roleChoices[cid].name, "Student-A");
  assert.strictEqual(room.presence[cid].name, "Student-A");
  assert.strictEqual(JSON.parse(room.events["ev-ANN7"].payload).note, "event of ANN7");
  assert.strictEqual(JSON.parse(room.events["ev-ANN7"].payload).by, "Student-A");
  assert.strictEqual(room.sections[1].revealed["item-ANN7"].by, "Student-A");
  assert.strictEqual(room.sections[1].triage["tri-ANN7"].reason, "triage reason by ANN7");
});

test("a shared display name: the consenting namesake keeps what carries her clientId, and loses what carries only the name", () => {
  /* Display names are not unique, and events, reveals and triage choices name
     their author by display name ONLY (logEvent, revealItem, modA-triage).
     When a consenting and a declining participant are both "Dana Kato", such a
     record cannot be shown to be the consenting one's, so it goes — hers with
     the decliner's. That is the cost of failing closed, and it is counted. */
  const stats = {};
  const out = exported(stats);
  const room = out.rooms["Room 1"];
  const { cid, stableId } = ids("danay");
  assert.strictEqual(out.pool[cid].name, "Student-B");
  assert.strictEqual(room.answers.moduleA["ans-DANAY7"].text, "answer by DANAY7");
  assert.strictEqual(room.answerReplies["ans-ANN7"]["rep-DANAY7"].text, "reply by DANAY7");
  assert.ok(stableId in room.votes.d1.ballots);
  assert.ok(cid in room.survey);
  for (const [where, node, id] of [["event", room.events, "ev-DANAY7"],
                                   ["reveal", room.sections[1].revealed, "item-DANAY7"],
                                   ["triage", room.sections[1].triage, "tri-DANAY7"]]) {
    assert.ok(!(id in node), `the consenting namesake's ${where} was kept on the strength of a name ` +
      "a participant who declined also holds");
  }
  assert.strictEqual(stats.nameShared, 6, "three name-only records each, for the two Danas");
});

test("room-level artefacts: no author, no text — kept; the team name is free text with no author — removed", () => {
  const out = exported();
  const room = out.rooms["Room 1"];
  assert.strictEqual(room.stage, 2);
  assert.deepStrictEqual(room.stageAt, { 1: 100, 2: 200 });
  assert.deepStrictEqual(room.votes.d1.committed, { choice: 1, at: 300 });
  assert.deepStrictEqual(room.score.auto.ev1, { points: 5, at: 60 });
  assert.deepStrictEqual(room.moduleA.scoring.awarded.fam1, { at: 50, points: 2 });
  assert.deepStrictEqual(room.sections[1].scoring.awarded.fam2, { at: 51, points: 3 });
  assert.ok(!("teamName" in room), "a team name is typed by somebody in the room, and nothing records whom");
  assert.ok(!("callForHelp" in room), "a call for help by a participant who declined");
});

test("the facilitator's own records stay, name redacted; their entries in shared lists do not", () => {
  /* audit and score/manual are writable by the facilitator only (the rules'
     creator-or-proof predicate), so what is in them is theirs. An event can be
     written by anyone with a room claim, under any name, so an event in the
     facilitator's name cannot be told from somebody else's. */
  const out = exported();
  assert.strictEqual(out.audit.x1.by, "REDACTED-NAME");
  assert.strictEqual(out.rooms["Room 1"].score.manual.m1.tag, "good reasoning");
  assert.strictEqual(out.created.at, 1);
  assert.ok(!("ev-FAC" in out.rooms["Room 1"].events));
});

test("a facilitator who shares a participant's display name makes her name-only records unprovable", () => {
  /* The facilitator writes events and reveals under their own display name,
     and is not in the pool. If it is also an included participant's name, an
     event under it cannot be shown to be hers. The facilitator's name is taken
     from the records only they can write (created, closed, audit, manual
     scores). */
  const sess = consentScopeSession();
  sess.created.by = "Ann Dupont";
  const stats = {};
  const out = pseudonymiseSession(applyWithdrawals(sess, consentScopeWithdrawals()), "S1", {}, stats);
  assert.ok(!("ev-ANN7" in out.rooms["Room 1"].events));
  assert.strictEqual(out.rooms["Room 1"].answers.moduleA["ans-ANN7"].text, "answer by ANN7",
    "what carries her clientId is still hers");
  assert.strictEqual(stats.nameShared, 9);
});

test("roleAssign names its assigner by CLIENTID: kept when that is an included participant, and lists only included ones", () => {
  const out = exported();
  const room = out.rooms["Room 1"];
  assert.deepStrictEqual(Object.keys(room.moduleB.roleAssign.assignments).sort(),
    [ids("ann").cid, ids("danay").cid].sort());
  assert.ok(!("roleAssign" in room.sections[1]), "assigned by a participant who declined");
});

test("the consent gate counts only an entry bound to an account", () => {
  /* One invented pool row recording consent used to make a session
     exportable. Every stock client claims clientMapping/<cid> before it
     writes its row (script.js, _joinParticipantAfterAuth). What this does
     NOT stop: a visitor who claims a mapping too is, to the database, a
     participant. */
  const forgedOnly = consentScopeSession();
  for (const cid of Object.keys(forgedOnly.pool)) {
    if (cid !== ids("forge").cid) forgedOnly.pool[cid].consent = { research: false };
  }
  assert.strictEqual(sessionHasConsent(forgedOnly), false,
    "a session whose only consenting row is bound to no account was exportable");
  const bound = { pool: { c1: { name: "A", consent: YES } }, clientMapping: { c1: "uid1" } };
  assert.strictEqual(sessionHasConsent(bound), true);
  const unbound = { pool: { c1: { name: "A", consent: YES } } };
  assert.strictEqual(sessionHasConsent(unbound), false);
  assert.strictEqual(pseudonymiseSession(unbound, "S1", {}).pool.c1, undefined);
});

test("a withdrawal is reported as applied only where it changed a row", () => {
  /* A withdrawal is recorded by account uid. With no clientMapping row tying
     that uid to a pool row, applyWithdrawals changed nothing — and the job's
     log still counted it as applied. */
  const sess = { clientMapping: { c1: "uA" }, pool: {
    c1: { name: "A", consent: YES }, c2: { name: "B", consent: YES } } };
  const report = {};
  const out = applyWithdrawals(sess, { uA: { research: false }, uB: { research: false },
                                       uC: { research: true } }, report);
  assert.deepStrictEqual(report, { records: 2, rowsWithdrawn: 1, unmatched: 1 });
  assert.strictEqual(out.pool.c1.consent.research, false);
  assert.strictEqual(out.pool.c2.consent.research, true,
    "nothing ties uB to c2; the row stays as written — and is excluded only if unbound");
});

test("every removal is counted, by reason, for the job's log", () => {
  const stats = {};
  exported(stats);
  assert.deepStrictEqual(stats, {
    participantsIncluded: 2,
    participantsNoConsent: 4,      // ben, cleo (withdrawn), danan, eve
    participantsUnbound: 1,        // forge
    keyedRows: 36,                 // poll, tests, survey, roleChoices, presence: 6 each; 6 role assignments
    ballots: 6,
    cidNotIncluded: 37,            // 6 kinds x 6 excluded parties, and one roleAssign
    byNamesNobodyIncluded: 0,
    nameNotIncluded: 17,           // events 6 (5 + the facilitator's), reveals 5, triage 5, call for help 1
    nameShared: 6,
    teamNames: 1
  });
});

test("a record with a clientId is dropped when a name in it belongs to nobody included", () => {
  /* The stock client lets only an entry's author edit or delete it
     (renderAnswers: entry.cid === clientId), so an edit by another hand is
     not something it writes. The rules do not stop one. An edit whose `by`
     names nobody included is evidence that somebody else's words are in the
     entry, and the entry goes. */
  const sess = consentScopeSession();
  const a = sess.rooms["Room 1"].answers.moduleA["ans-ANN7"];
  a.edits.other = { text: "Ann's words, replaced by Ben", by: "Ben Sato", at: 99 };
  const stats = {};
  const out = pseudonymiseSession(sess, "S1", {}, stats);
  assert.ok(!("ans-ANN7" in out.rooms["Room 1"].answers.moduleA));
  assert.strictEqual(stats.byNamesNobodyIncluded, 1);
});

/* ============ THE SHAPE THE JOB ACTUALLY READS ============
 * Found in review of the first version of this change. The job reads a
 * session with the Admin SDK's `.val()`, which returns an integer-keyed node
 * as an ARRAY (tests/fixtures/rtdb-shape.js). Section slots are integer-keyed
 * by rule, so in every multi-section session `rooms/<r>/sections` and
 * `rooms/<r>/answers/sections` arrive as arrays — and the filter, which only
 * descended into plain objects, judged nothing under them: a decliner's
 * section answers, hypotheses, reveals, triage choices and role assignments
 * went out with their text and their clientId. The fixtures above are plain
 * objects, which is why nothing caught it. */

function slotsSession() {
  const sess = consentScopeSession();
  const room = sess.rooms["Room 1"];
  room.sections[2] = JSON.parse(JSON.stringify(room.sections[1]));
  room.answers.sections[2] = JSON.parse(JSON.stringify(room.answers.sections[1]));
  room.moduleA.promptReplies = { 0: { [ids("ann").cid]: { text: "prompt reply by ANN7" },
                                      [ids("ben").cid]: { text: "prompt reply by BEN7" } } };
  return asRtdbWould(sess);
}

test("slots, legacy reply lists and the rest come back from the database as ARRAYS — and are judged all the same", () => {
  const sess = slotsSession();
  const room = sess.rooms["Room 1"];
  assert.ok(Array.isArray(room.sections) && Array.isArray(room.answers.sections) &&
            Array.isArray(room.moduleA.promptReplies),
    "fixture is broken: it does not hold the shape .val() returns");
  const out = pseudonymiseSession(applyWithdrawals(sess, consentScopeWithdrawals()), "S1", {});
  for (const key of EXCLUDED) {
    const left = whereIs(out, PARTIES[key].token);
    assert.deepStrictEqual(left, [], `${PARTIES[key].what} (${key}) is still in the export at:\n  ` +
      left.join("\n  "));
  }
  const r = out.rooms["Room 1"];
  for (const slot of [1, 2]) {
    assert.strictEqual(r.answers.sections[slot]["sans-ANN7"].text, "section answer by ANN7");
    assert.strictEqual(r.sections[slot].hypotheses["shyp-ANN7"].text, "section hypothesis by ANN7");
    assert.strictEqual(r.sections[slot].revealed["item-ANN7"].by, "Student-A");
    assert.strictEqual(r.sections[slot].triage["tri-ANN7"].reason, "triage reason by ANN7");
    assert.ok(!("roleAssign" in r.sections[slot]), "slot " + slot + ": assigned by a decliner");
  }
  assert.strictEqual(r.moduleA.promptReplies[0][ids("ann").cid].text, "prompt reply by ANN7");
});

test("a poll, pool and mapping table keyed by integers are arrays too, and are filtered", () => {
  /* Anyone holding the code may write poll/0, poll/1, … (the poll rule's
     first-write branch), and a pool row under an unclaimed integer clientId. */
  const visitorPoll = consentScopeSession();
  visitorPoll.poll = { 0: { hardest: "poll by MAL7", feeling: "ok", by: "Mallory Noentry", at: 1 },
                       1: { hardest: "poll by FORGE7", feeling: "ok", by: "Fergus Forged", at: 2 } };
  const shaped = asRtdbWould(visitorPoll);
  assert.ok(Array.isArray(shaped.poll), "fixture is broken");
  const out = pseudonymiseSession(shaped, "S1", {});
  assert.ok(!JSON.stringify(out).includes("MAL7") && !JSON.stringify(out).includes("FORGE7"));

  const integerIds = asRtdbWould({
    clientMapping: { 0: "uidAnn00000000000000000001", 1: "uidBen00000000000000000002" },
    pool: { 0: { name: "Ann", at: 1, consent: YES }, 1: { name: "Ben", at: 2, consent: { research: false } } },
    poll: { 0: { hardest: "poll by ANN7" }, 1: { hardest: "poll by BEN7" } },
    rooms: { r1: { tests: { 0: { pre: { note: "test by ANN7" } }, 1: { pre: { note: "test by BEN7" } } } } }
  });
  assert.ok(Array.isArray(integerIds.pool) && Array.isArray(integerIds.clientMapping), "fixture is broken");
  assert.strictEqual(sessionHasConsent(integerIds), true,
    "an included participant under an integer clientId was not seen at all");
  const blob = JSON.stringify(pseudonymiseSession(integerIds, "S1", {}));
  assert.ok(!blob.includes("BEN7"), "the decliner's rows went out");
  assert.ok(blob.includes("poll by ANN7") && blob.includes("test by ANN7"), "the included one's went too");
  assert.ok(blob.includes("Student-A") && !blob.includes("\"Ann\""));
});

test("an edit log that comes back as an array is still read for another hand", () => {
  const sess = consentScopeSession();
  sess.rooms["Room 1"].answers.moduleA["ans-ANN7"].edits =
    asRtdbWould({ 0: { text: "Ann's words, replaced by Ben", by: "Ben Sato", at: 99 } });
  const out = pseudonymiseSession(sess, "S1", {});
  assert.ok(!("ans-ANN7" in out.rooms["Room 1"].answers.moduleA));
});

test("the array shape is really what the fixture builds", () => {
  assert.ok(holdsArray(slotsSession()));
  assert.ok(!holdsArray(consentScopeSession()), "the plain fixture should stay plain, for contrast");
});

/* ============ WHOSE NAME COUNTS AGAINST AN INCLUDED PARTICIPANT ============
 * Found in review of the first version. A name-only record is kept only when
 * nobody else the session records holds that name — and "the session records"
 * used to include every pool row that was not included. A pool row needs
 * neither consent nor a mapping row: anyone holding the code could write
 * pool/x = { name: "Ann Dupont" } and so remove every event, reveal and triage
 * choice of an included Ann from the export, and her reveals from the room's
 * revealed set. On version 2 those records were kept. Now only a row BOUND to
 * an account counts. That raises the bar and does not close it: a visitor can
 * bind a row of their own. */

test("an UNBOUND row carrying an included participant's name removes nothing of hers", () => {
  const sess = consentScopeSession();
  sess.pool["cid-VISITOR"] = { name: "Ann Dupont", university: "Caen", year: 3, english: "B2", at: 5 };
  const stats = {};
  const out = pseudonymiseSession(applyWithdrawals(sess, consentScopeWithdrawals()), "S1", {}, stats);
  const room = out.rooms["Room 1"];
  assert.ok("ev-ANN7" in room.events, "her event went because of a row anyone can write");
  assert.ok("item-ANN7" in room.sections[1].revealed);
  assert.ok("tri-ANN7" in room.sections[1].triage);
  assert.strictEqual(stats.nameShared, 6, "only the two Danas, as without the visitor's row");
});

test("a BOUND row carrying her name does remove them — the cost that is left, pinned", () => {
  const sess = consentScopeSession();
  sess.pool["cid-VISITOR"] = { name: "Ann Dupont", university: "Caen", year: 3, english: "B2", at: 5 };
  sess.clientMapping["cid-VISITOR"] = "uid-VISITOR-0000000000000000";
  const stats = {};
  const out = pseudonymiseSession(applyWithdrawals(sess, consentScopeWithdrawals()), "S1", {}, stats);
  const room = out.rooms["Room 1"];
  assert.ok(!("ev-ANN7" in room.events));
  assert.ok(!("item-ANN7" in room.sections[1].revealed));
  assert.strictEqual(room.answers.moduleA["ans-ANN7"].text, "answer by ANN7", "what carries her clientId stays");
  assert.strictEqual(stats.nameShared, 9);
});

test("the file says it was written by a transform that removes this", () => {
  assert.ok(Number.isInteger(TRANSFORM_VERSION) && TRANSFORM_VERSION >= 3);
});
