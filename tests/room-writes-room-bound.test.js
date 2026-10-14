"use strict";
/* tests/room-writes-room-bound.test.js
 *
 * Seven writes inside a room named nobody until 2026-10-14:
 *
 *     rooms/$roomId/teamName
 *     rooms/$roomId/roleplayRound
 *     rooms/$roomId/callForHelp
 *     rooms/$roomId/sections/$slot/revealed/$itemId
 *     rooms/$roomId/moduleA/revealed/$itemId
 *     rooms/$roomId/events/$pushId
 *     rooms/$roomId/answerReplies/$entryId/$replyId
 *
 * Each `.write` asked for a signed-in user and an open session, and for no
 * particular user (`events` was also append-only, and `callForHelp` allowed
 * one call at a time; neither says who). A visitor who had joined nothing
 * wrote all seven into a room of a running session; what that did is in the
 * header of tests-e2e/emulator/room-writes-room-bound.spec.js, measured.
 *
 * THE RULE NOW — one clause appended to each of the seven, in both trees. For
 * six of them:
 *
 *     (  the writer's room claim names this room
 *     || the writer is the session's facilitator  )
 *
 * and for the call for help, which asks for less:
 *
 *     (  the writer holds a room claim in this session — on any room
 *     || the writer is the session's facilitator  )
 *
 * WHY THE CALL FOR HELP IS DIFFERENT (decided 2026-10-14, after review). The
 * product could show a participant a room their claim does not name: Leave,
 * then join again in the same browser, kept the account and its write-once
 * claim and placed the participant afresh. (The client now places them by the
 * claim — tests/rejoin-room-claim.test.js; a browser on an older shell still
 * does not.) In that room their answers were already
 * refused; with the first form of the rule, so was their call for help — the
 * one control that had still worked, and a regression against the rules as
 * they were. The price is accepted and pinned on the emulator: somebody who
 * has JOINED the session can raise or cancel a call in another room. A visitor
 * who has joined nothing still cannot.
 *
 * This file pins two things the emulator cannot.
 *
 * 1. THE TEXT. The facilitator half is not retyped: it is cut out of the same
 *    tree's `rooms/$roomId/stage` rule — the Phase 4a predicate — so the seven
 *    cannot drift from the nodes the facilitator alone writes. A proof is
 *    compared with the CURRENT hash, and only where a hash exists.
 *
 * 2. WHY THERE ARE TWO HALVES. "Give them the room condition their neighbours
 *    have" was the obvious fix, and it was wrong: SIX of the seven are also
 *    written by the facilitator, who holds a claim on at most one room —
 *    `events` and `callForHelp` by the dashboard's own functions, `teamName`,
 *    `roleplayRound`, `answerReplies` and the per-slot `revealed` through the
 *    room's controls. (The seventh, `moduleA/revealed`, has no client writer
 *    left; it carries the same clause so that the old address is not the one
 *    left open.) Whether a node needs the second half depends on what the
 *    CLIENT does, so the client facts are asserted here. If one stops being
 *    true the rule may be narrowed — and if somebody narrows the rule first,
 *    these say what breaks.
 *
 * WHAT THIS DOES NOT SAY. That the room claim keeps anybody out. Joining a
 * session is three writes and asks for its code and nothing else; the claim
 * binds a writer to ONE room and puts them on the facilitator's list. The
 * emulator spec has a test whose only purpose is to record that.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
/* Normalised at the read site: a CRLF checkout must not change what a regex
   that walks lines sees. */
const read = (f) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("script.js");
const ADMIN = read("script-admin.js");

const TREES = [
  ["sessions/$sessionId", rules.sessions.$sessionId,
    "root.child('sessions').child($sessionId)",
    "root.child('adminSecrets').child($sessionId)"],
  ["orgs/$orgSlug/sessions/$sessionId", rules.orgs.$orgSlug.sessions.$sessionId,
    "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)",
    "root.child('adminSecrets').child('orgs').child($orgSlug).child($sessionId)"],
];

const closedOf = (p) => "!" + p + ".child('closed').exists()";
const roomClaim = (p) => p + ".child('roomOf').child(auth.uid).child('room').val() == $roomId";

/* The facilitator predicate, taken from the rule that has carried it since
   Phase 4a: `stage` is `auth != null && <facilitator> && !closed`. */
function facilitatorOf(node, p) {
  const stage = node.rooms.$roomId.stage[".write"];
  const head = "auth != null && ";
  const tail = " && " + closedOf(p);
  assert.ok(stage.startsWith(head) && stage.endsWith(tail),
    "rooms/$roomId/stage is no longer `auth != null && <facilitator> && !closed` — this file " +
    "cuts the facilitator predicate out of it: " + stage);
  return stage.slice(head.length, stage.length - tail.length);
}
const who = (node, p) => "(" + roomClaim(p) + " || (" + facilitatorOf(node, p) + "))";
/* The call for help: a claim on ANY room of this session. */
const sessionClaim = (p) => p + ".child('roomOf').child(auth.uid).exists()";
const whoInSession = (node, p) => "(" + sessionClaim(p) + " || (" + facilitatorOf(node, p) + "))";

/* What each of the seven carried before, and still carries: the clause is
   appended, nothing is taken away. */
const SEVEN = [
  ["teamName", (p) => "auth != null && " + closedOf(p)],
  ["roleplayRound", (p) => "auth != null && " + closedOf(p)],
  ["sections/$slot/revealed/$itemId", (p) => "auth != null && " + closedOf(p)],
  ["moduleA/revealed/$itemId", (p) => "auth != null && " + closedOf(p)],
  ["answerReplies/$entryId/$replyId", (p) => "auth != null && " + closedOf(p)],
  /* append-only */
  ["events/$pushId", (p) => "auth != null && " + closedOf(p) + " && !data.exists()"],
  /* one call at a time: none standing, or the last one answered, or a cancel,
     or thirty seconds later */
  ["callForHelp", (p) => "auth != null && " + closedOf(p) +
    " && (!data.exists() || data.child('ack').val() == true || newData.val() == null || " +
    "newData.child('at').val() >= data.child('at').val() + 30000)", whoInSession],
];
const at = (node, p) => p.split("/").reduce((a, k) => a && a[k], node.rooms.$roomId);

function bodyOf(src, name) {
  const start = src.indexOf("\nfunction " + name + "(");
  assert.notStrictEqual(start, -1, name + "() not found");
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}
/* Comments say what the code used to do; only the code may answer. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

test("each of the seven carries what it had, and then: this room's participant (for the call for help, the session's), or the facilitator", () => {
  for (const [label, node, p] of TREES) {
    for (const [where, had, clause] of SEVEN) {
      const n = at(node, where);
      assert.ok(n && typeof n[".write"] === "string",
        `${label}/rooms/$roomId/${where}: no write rule — the node would fail closed`);
      assert.strictEqual(n[".write"], had(p) + " && " + (clause || who)(node, p), `${label}/rooms/$roomId/${where}`);
    }
  }
  /* Exactly one of the seven asks for the weaker claim, and it is the call for
     help. A second one would be a room's work writable from another room. */
  assert.deepStrictEqual(SEVEN.filter((r) => r[2]).map((r) => r[0]), ["callForHelp"]);
  for (const [label, node, p] of TREES) {
    const weaker = SEVEN.map((r) => r[0]).filter((where) => at(node, where)[".write"].includes(sessionClaim(p)));
    assert.deepStrictEqual(weaker, ["callForHelp"], label + ": which of the seven accept a claim on any room");
  }
});

test("the facilitator half is the Phase 4a predicate, proof against the CURRENT password", () => {
  for (const [label, node, p, secrets] of TREES) {
    const f = facilitatorOf(node, p);
    assert.strictEqual(f,
      p + ".child('adminPasswordHash').exists() && (" + p + ".child('creatorUid').val() == auth.uid || " +
      secrets + ".child('hash').exists() && " + secrets + ".child('proof').child(auth.uid).val() == " +
      secrets + ".child('hash').val())",
      `${label}: the facilitator predicate has changed shape. A proof must equal the current hash ` +
      "(one written against an old password stops counting when it is reset), and the comparison " +
      "must be guarded by hash.exists() — null == null is true in these rules, and that was #297");
    /* …and it is the session's OWN secret: the org tree's lives under orgs/. */
    assert.ok(!label.startsWith("orgs") || !f.includes("root.child('adminSecrets').child($sessionId)"),
      `${label}: reads the default tree's secret`);
  }
});

test("nothing above the seven grants what they now refuse", () => {
  /* A `.write` on an ancestor cascades over every rule below it and cannot be
     taken back there. One on `rooms`, on a room, on `sections` or on a slot
     would reopen these however their own rules read — and so would one on the
     session, on `sessions`, on an organisation or at the root. All the way up:
     this file must not lean on another one to have looked. */
  const top = [
    ["the root", rules],
    ["sessions", rules.sessions],
    ["orgs", rules.orgs],
    ["orgs/$orgSlug", rules.orgs.$orgSlug],
    ["orgs/$orgSlug/sessions", rules.orgs.$orgSlug.sessions],
  ];
  for (const [where, n] of top) {
    assert.ok(n && typeof n === "object", `${where}: not found`);
    assert.ok(n[".write"] === undefined || n[".write"] === false,
      `${where} carries ".write": ${JSON.stringify(n[".write"])} — it is granted to every room beneath it`);
  }
  assert.strictEqual(rules[".write"], false, "the root must refuse writes outright");
  for (const [label, node] of TREES) {
    const room = node.rooms.$roomId;
    const above = [
      [label, node],
      ["rooms", node.rooms], ["rooms/$roomId", room],
      ["rooms/$roomId/sections", room.sections], ["rooms/$roomId/sections/$slot", room.sections.$slot],
      ["rooms/$roomId/sections/$slot/revealed", room.sections.$slot.revealed],
      ["rooms/$roomId/moduleA", room.moduleA], ["rooms/$roomId/moduleA/revealed", room.moduleA.revealed],
      ["rooms/$roomId/events", room.events],
      ["rooms/$roomId/answerReplies", room.answerReplies],
      ["rooms/$roomId/answerReplies/$entryId", room.answerReplies.$entryId],
    ];
    for (const [where, n] of above) {
      assert.ok(n && typeof n === "object", `${label}/${where}: not found`);
      assert.strictEqual(n[".write"], undefined,
        `${label}/${where} carries a ".write": it is granted to everything beneath it`);
    }
  }
});

/* ── the client facts the second half rests on ──────────────────────────── */

test("the facilitator writes a room's event log from the dashboard, with no claim on the room", () => {
  /* Every stage change logs one, in the room it moves. With the room condition
     alone that write is refused — to a console warning, on every advance of
     every session — and the log loses its `stage` entries. */
  const body = code(bodyOf(ADMIN, "setRoomStage"));
  assert.match(body, /logEvent\(r, "stage"/, "setRoomStage() no longer logs the stage change in the room's events");
  assert.match(code(bodyOf(SCRIPT, "logEvent")),
    /db\.ref\(sPath\("rooms\/" \+ roomName \+ "\/events"\)\)\.push\(envelope\)/,
    "logEvent() no longer appends to rooms/<room>/events");
});

test("the facilitator clears a call for help from inside the room, whichever room it is", () => {
  /* "Resolve call": the same button the room calls with, in the facilitator's
     hands — a delete, and the write the facilitator half of this rule is for.
     (openRoomAsAdmin() also tries to ACKNOWLEDGE a call. That write is refused
     by the one-call-at-a-time clause for every facilitator, before and after
     this change — run on the emulator — so nothing here rests on it and it is
     not pinned: whoever repairs or removes it should not meet this test.) */
  assert.match(code(bodyOf(SCRIPT, "initCallProf")), /if \(isRoomAdmin\) \{ refCallForHelp\.remove\(\); return; \}/,
    "the facilitator's Resolve call is no longer a remove() on the room's callForHelp");
});

test("a facilitator inside a room is shown the room's own controls, and none of them asks who is clicking", () => {
  /* enterRoom(room, true) is "the exact student view". Naming a team, replying
     to an answer, revealing an item and moving the roleplay round have no
     isRoomAdmin guard, so each is a write the facilitator makes with no claim
     on the room — or with a claim on a DIFFERENT room: startRoom() claims the
     first room a facilitator opens (the claim rule's own facilitator branch)
     and no other. Add a guard to one of these and its rule may lose the
     facilitator half; until then it must keep it. */
  for (const name of ["reveal", "initTeamName", "bumpReplayRound", "openCounterBullet"]) {
    const body = code(bodyOf(SCRIPT, name));
    assert.ok(body.length > 200, `${name}() body not captured — the check below would pass on nothing`);
    assert.doesNotMatch(body, /isRoomAdmin/,
      `${name}() now distinguishes a facilitator: look again at whether its node needs the facilitator half`);
  }
  /* The stripper itself: it must take comments out and leave code in, or
     every doesNotMatch in this file is reading the wrong text. */
  assert.strictEqual(code("a(); // isRoomAdmin\n/* isRoomAdmin */ b();"), "a(); \n b();");
  assert.match(code("if (isRoomAdmin) { x(); } // why"), /isRoomAdmin/);
  assert.match(code(bodyOf(SCRIPT, "initTeamName")), /refTeamName\.set\(v\)/);
  assert.match(code(bodyOf(SCRIPT, "bumpReplayRound")), /refReplayRound\.set\(next\)/);
  assert.match(code(bodyOf(SCRIPT, "openCounterBullet")), /refAnswerReplies\.child\(entry\.id\)\.push\(/);
});

test("a reveal is a transaction — the one write among the seven that is", () => {
  /* CLAUDE.md records two rules that could not be written by transaction once
     they read a node the client does not hold (#223, and the room claim). The
     rule on `revealed` now reads the room claim, or a proof no client can read
     at all, and reveal() is a transaction. It commits: run on the emulator, by
     a participant and by a co-facilitator whose only title is that proof
     (room-writes-room-bound.spec.js). If another of the seven becomes a
     transaction, run it there before trusting it. */
  assert.match(code(bodyOf(SCRIPT, "reveal")), /refRevealed\.child\(id\)\.transaction\(/,
    "reveal() no longer writes by transaction");
  const client = code(SCRIPT) + code(ADMIN);
  for (const [name, re] of [
    ["teamName", /refTeamName[^;\n]*\.transaction\(/],
    ["callForHelp", /(refCallForHelp|cfh)[^;\n]*\.transaction\(/],
    ["roleplayRound", /refReplayRound[^;\n]*\.transaction\(/],
    ["answerReplies", /refAnswerReplies[^;\n]*\.transaction\(/],
  ]) {
    assert.doesNotMatch(client, re, `${name} is now written by transaction`);
  }
});

test("entering a room makes the claim and none of the seven writes", () => {
  /* The room half reads the claim, and the claim is issued by startRoom(). A
     write of one of the seven issued from the same function would race it:
     refused whenever it arrived first, for the participant it belongs to. All
     seven follow something a person does after the room is on screen. */
  const body = code(bodyOf(SCRIPT, "startRoom"));
  assert.ok(body.length > 5000, "startRoom() body not captured");
  assert.match(body, /_claimRoomOf\(true\)/, "startRoom() no longer issues the room claim");
  for (const [what, re] of [
    ["an event", /logEvent\(/],
    ["a reveal", /\breveal\(/],
    ["the team name", /refTeamName\.(set|update|remove|transaction)\(/],
    ["a call for help", /refCallForHelp\.(set|update|remove|transaction)\(/],
    ["the roleplay round", /refReplayRound\.(set|update|remove|transaction)\(/],
    ["a reply", /refAnswerReplies[^;\n]*\.(push|set|update|remove|transaction)\(/],
  ]) {
    assert.doesNotMatch(body, re, `startRoom() now writes ${what} on entering the room, before the claim can have landed`);
  }
  /* …and neither does the function that calls it. (The positive match first:
     a body that was not captured would pass the negative one on nothing.) */
  const enter = code(bodyOf(SCRIPT, "enterRoom"));
  assert.match(enter, /startRoom\(\)/, "enterRoom() body not captured, or it no longer starts the room");
  assert.doesNotMatch(enter, /logEvent\(/, "enterRoom() now logs an event before the room claim is issued");
});
