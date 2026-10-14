"use strict";
/* tests/fixtures/consent-scope-session.js
 *
 * One closed session in which eight identities write what the STOCK CLIENT
 * writes, record by record, so that the research export can be asked who it
 * lets through. Every shape below was read from the client on 2026-10-14, not
 * from the rules: a fixture shaped by the rules alone is how the names inside
 * event payloads went unseen for months (DPA Annex VI R10).
 *
 *   record                  written by                       shape
 *   pool/<cid>              _joinParticipantWireUp           { name, university, year, english, at, room, consent, stableId }
 *   clientMapping/<cid>     claimClientMapping()  3489       auth uid
 *   stableIdMapping/<sid>   claimStableIdMapping() 3524      auth uid
 *   poll/<cid>              the end-of-session poll          { hardest, feeling, by, at, stableId }
 *   answers/…/<push>        addAnswer()           9750       { by, cid, university, text, at, bulletKey }
 *   …/edits/<push>          editAnswer()          9800       { text: <superseded text>, by, at }
 *   answersDeleted/<push>   deleteAnswer()        9841       { text, by, module, at, cid, bulletKey, university }
 *   …hypotheses/<push>      initHypotheses()      8859       { by, cid, university, text, at }
 *   answerReplies/<e>/<p>   the counter-bullet form 9693     { text, by, cid, at, stance }
 *   votes/<d>/ballots/<k>   castVote(), key = ballotKey() 7645  { choice, at }
 *   tests/<cid>/{pre,post}  the knowledge test    3774       { answers, score, startedAt, completedAt, stableId }
 *   survey/<cid>            the wrap-up questionnaire 4082   { startedAt, completedAt, responses, stableId }
 *   roleChoices/<cid>       the role picker       9069       { role, name, at }
 *   presence/<cid>          presence              —          { name, at }
 *   events/<push>           logEvent()            5773       { kind, by, at, payload: JSON string with by + university }
 *   …/revealed/<item>       revealItem()          6918       { by, at }
 *   …/triage/<item>         modA-triage.js        88         { disposition, reason, by, at }
 *   …/roleAssign            assignRolesRandomly() 9180       { assignments: { <cid>: role }, by: <CLIENTID>, at }
 *   callForHelp             the help button       6489       { by, at, msg }
 * (Line numbers: docs/Third_session/PBL_platform/script.js unless named.)
 *
 * Every value a party plants carries that party's TOKEN, so a test can look
 * for the token in the serialised output and find any of it — text, clientId,
 * account uid or stableId — wherever it went.
 */

const YES = { workshop: true, research: true, version: "PIS-v12", at: 5 };
const NO = { workshop: true, research: false, version: "PIS-v12", at: 5 };

/* account: the auth uid behind the clientId, or null for an identity that
   never claimed one. stableId: for a signed-in participant it IS the uid
   (handleAuthStateChange), for an anonymous one a random browser value.
   mapStable: whether stableIdMapping has its row. pool: the row, or null. */
const PARTIES = {
  ann:   { token: "ANN7", name: "Ann Dupont", univ: "Caen", consent: YES, account: true, mapStable: true,
           what: "a consenting participant" },
  ben:   { token: "BEN7", name: "Ben Sato", univ: "Nagoya", consent: NO, account: true, mapStable: true,
           what: "a participant who declined" },
  cleo:  { token: "CLEO7", name: "Cleo Martin", univ: "Caen", consent: YES, account: true, mapStable: true,
           what: "a participant who consented and then WITHDREW (withdrawals/<code>/<uid>)" },
  danay: { token: "DANAY7", name: "Dana Kato", univ: "Nagoya", consent: YES, account: true, mapStable: true,
           what: "a consenting participant who shares a display name with a decliner" },
  danan: { token: "DANAN7", name: "Dana Kato", univ: "Nagoya", consent: NO, account: true, mapStable: true,
           what: "a declining participant who shares a display name with a consenting one" },
  eve:   { token: "EVE7", name: "Eve Leroy", univ: "Caen", consent: NO, account: true, mapStable: false,
           signedIn: true, what: "a SIGNED-IN participant who declined, with no stableIdMapping row" },
  mal:   { token: "MAL7", name: "Mallory Noentry", univ: "Caen", consent: null, account: false, mapStable: false,
           noPool: true, what: "an invented identity with no participant-list entry" },
  forge: { token: "FORGE7", name: "Fergus Forged", univ: "Caen", consent: YES, account: false, mapStable: false,
           what: "an invented identity with a FORGED entry recording consent, and no clientMapping row" }
};

const INCLUDED = ["ann", "danay"];
const EXCLUDED = ["ben", "cleo", "danan", "eve", "mal", "forge"];

function ids(key) {
  const p = PARTIES[key];
  const uid = p.account ? "uid-" + p.token + "-000000000000000" : null;
  return {
    cid: "cid-" + p.token,
    uid,
    stableId: p.signedIn ? uid : "sid-" + p.token
  };
}

function event(kind, p, at, extra) {
  return { kind, by: p.name, at, payload: JSON.stringify(Object.assign(
    { by: p.name, university: p.univ, len: 12 }, extra || {})) };
}

/** The session, as the database holds it, before withdrawals are applied. */
function consentScopeSession() {
  const s = {
    created: { by: "Dr Claire Facilitator", at: 1 },
    closed: { by: "Dr Claire Facilitator", at: 9000 },
    creatorUid: "uid-FACILITATOR-00000000000",
    members: {}, roomOf: {}, clientMapping: {}, stableIdMapping: {}, pool: {}, poll: {},
    audit: { x1: { kind: "room.stage", by: "Dr Claire Facilitator", at: 100,
                   payload: JSON.stringify({ room: "Room 1", from: 0, to: 1 }) } },
    rooms: { "Room 1": {
      stage: 2, stageAt: { 1: 100, 2: 200 },
      teamName: "Team name somebody typed",
      answers: { moduleA: {}, sections: { 1: {} } },
      answerReplies: { "ans-ANN7": {} },
      answersDeleted: {},
      moduleA: { hypotheses: {}, scoring: { awarded: { fam1: { at: 50, points: 2 } } } },
      sections: { 1: { hypotheses: {}, revealed: {}, triage: {},
                       roleAssign: null, scoring: { awarded: { fam2: { at: 51, points: 3 } } } } },
      votes: { d1: { ballots: {}, committed: { choice: 1, at: 300 } } },
      tests: {}, survey: {}, roleChoices: {}, presence: {},
      score: { auto: { ev1: { points: 5, at: 60 } },
               manual: { m1: { points: 4, tag: "good reasoning", by: "Dr Claire Facilitator", at: 61 } } },
      events: {
        "ev-FAC": { kind: "score.manual", by: "Dr Claire Facilitator", at: 62,
                    payload: JSON.stringify({ tag: "good reasoning", points: 4, by: "Dr Claire Facilitator" }) }
      },
      callForHelp: { by: "Ben Sato", at: 400, msg: "help asked by BEN7" }
    } }
  };
  const room = s.rooms["Room 1"];
  let at = 10;
  for (const key of Object.keys(PARTIES)) {
    const p = PARTIES[key];
    const { cid, uid, stableId } = ids(key);
    const T = p.token;
    at += 10;
    if (!p.noPool) {
      s.pool[cid] = { name: p.name, university: p.univ, year: 3, english: "B2", at, room: "Room 1",
                      stableId };
      if (p.consent) s.pool[cid].consent = p.consent;
    }
    if (uid) {
      s.clientMapping[cid] = uid;
      s.members[uid] = { at, role: "participant" };
      s.roomOf[uid] = { room: "Room 1", cid };
      if (p.mapStable) s.stableIdMapping[stableId] = uid;
    }
    s.poll[cid] = { hardest: "hardest part for " + T, feeling: "ok", by: p.name, at, stableId };

    room.answers.moduleA["ans-" + T] = { by: p.name, cid, university: p.univ, text: "answer by " + T,
      at: at + 1, bulletKey: "",
      edits: { ["ed-" + T]: { text: "first draft by " + T, by: p.name, at: at + 2 } } };
    room.answers.sections[1]["sans-" + T] = { by: p.name, cid, university: p.univ,
      text: "section answer by " + T, at: at + 1 };
    room.answersDeleted["del-" + T] = { text: "deleted point by " + T, by: p.name, module: "moduleA",
      at: at + 3, cid, bulletKey: "", university: p.univ };
    room.moduleA.hypotheses["hyp-" + T] = { by: p.name, cid, university: p.univ,
      text: "hypothesis by " + T, at: at + 4 };
    room.sections[1].hypotheses["shyp-" + T] = { by: p.name, cid, university: p.univ,
      text: "section hypothesis by " + T, at: at + 4 };
    room.answerReplies["ans-ANN7"]["rep-" + T] = { text: "reply by " + T, by: p.name, cid,
      at: at + 5, stance: "support" };
    room.votes.d1.ballots[stableId] = { choice: 2, at: at + 6 };
    room.tests[cid] = {
      pre: { answers: { q1: 1 }, score: 3, startedAt: at, completedAt: at + 7, stableId },
      post: { answers: { q1: 2 }, score: 4, startedAt: at + 8, completedAt: at + 9, stableId }
    };
    room.survey[cid] = { startedAt: at, completedAt: at + 9, responses: { q1: "survey text by " + T },
                         stableId };
    room.roleChoices[cid] = { role: "doctor", name: p.name, at };
    room.presence[cid] = { name: p.name, at };
    room.events["ev-" + T] = event("answer.moduleA", p, at + 1, { bulletKey: "", note: "event of " + T });
    room.sections[1].revealed["item-" + T] = { by: p.name, at: at + 2 };
    room.sections[1].triage["tri-" + T] = { disposition: "ruleout", reason: "triage reason by " + T,
                                            by: p.name, at: at + 3 };
  }
  /* roleAssign records its assigner by CLIENTID (script.js 9180), and assigns
     every clientId present in the room. One by a consenting participant, one
     by a decliner. */
  const assignments = {};
  for (const key of Object.keys(PARTIES)) assignments[ids(key).cid] = "doctor";
  room.moduleB = { roleAssign: { assignments: Object.assign({}, assignments), by: ids("ann").cid, at: 500 } };
  room.sections[1].roleAssign = { assignments: Object.assign({}, assignments), by: ids("ben").cid, at: 501 };
  return s;
}

/** withdrawals/<code> for the session: Cleo withdrew. */
function consentScopeWithdrawals() {
  return { [ids("cleo").uid]: { research: false, at: 8000 } };
}

module.exports = { PARTIES, INCLUDED, EXCLUDED, ids, consentScopeSession, consentScopeWithdrawals, YES, NO };
