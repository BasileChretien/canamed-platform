"use strict";
/* tests/call-for-help-ack.test.js
 *
 * Two controls a facilitator meets inside a room, both broken since this
 * repository's first commit (2026-05-18), both measured on the emulator with
 * the real client on 2026-10-08 and again before this change.
 *
 * 1. THE ACKNOWLEDGEMENT OF A CALL FOR HELP WAS REFUSED. openRoomAsAdmin()
 *    re-sends a standing call with `ack: true` and the call's own `at`. The
 *    rule allows one call at a time — none standing, or the last one
 *    acknowledged, or a cancel, or a call thirty seconds newer — and the
 *    acknowledgement is none of those, so it was PERMISSION_DENIED for the
 *    creator and for a co-facilitator alike. The validator refused it as well
 *    once the call was more than a minute old (`at >= now - 60000`), which is
 *    the usual case: the facilitator sees the alert and walks over. The room
 *    never saw "A facilitator is coming ✓"; the dashboard kept the alert
 *    until somebody pressed "Resolve call".
 *
 *    THE RULE NOW, both trees. One more way through the one-call-at-a-time
 *    clause, and it is the facilitator's (the Phase 4a predicate, cut from
 *    `rooms/$roomId/stage` as tests/room-writes-room-bound.test.js does):
 *
 *        the facilitator, writing ack == true onto the call that stands,
 *        with its `at` and its `by` unchanged and its `msg` unchanged or gone
 *
 *    and the validator accepts a date older than a minute on exactly that
 *    record: acknowledged, `at` and `by` unchanged. Nothing that was accepted
 *    before is refused now — both edits only add a way through — and the
 *    rule accepts what the DEPLOYED client already sends, so no shell has to
 *    change for the acknowledgement to work (rules deploy at once; browsers
 *    keep a cached shell for a while).
 *
 * 2. "RESET THIS ROOM'S CASE" DELETED NOTHING. The facilitator-only button
 *    did `refRevealed.remove()`: a delete of the PARENT `revealed` node, where
 *    no rule grants a write. Refused, silently (no catch). Decided 2026-10-14:
 *    the control is REMOVED, not repaired. A reset that cleared the findings
 *    only would leave the score, the penalties, the rule-outs and the chat
 *    awards those findings caused; a full one is a feature of its own; and
 *    either deletes a room's research record mid-session. So no `.write` is
 *    added at the parent — tests/room-writes-room-bound.test.js already holds
 *    every ancestor of `revealed/$itemId` free of one — and this file holds
 *    the control gone.
 *
 * The verdicts are on the emulator (tests-e2e/emulator/call-for-help-ack.spec.js:
 * every denial paired with an allow of the same payload). This file pins the
 * text, and the client facts the rule is written against.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
/* Normalised at the read site: a CRLF checkout must not change what a regex
   sees. */
const read = (f) => fs.readFileSync(path.join(P, f), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("script.js");
const ADMIN = read("script-admin.js");
const INDEX = read("index.html");

const TREES = [
  ["sessions/$sessionId", rules.sessions.$sessionId,
    "root.child('sessions').child($sessionId)"],
  ["orgs/$orgSlug/sessions/$sessionId", rules.orgs.$orgSlug.sessions.$sessionId,
    "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)"],
];
const closedOf = (p) => "!" + p + ".child('closed').exists()";

/* The facilitator predicate, from the rule that has carried it since Phase 4a. */
function facilitatorOf(node, p) {
  const stage = node.rooms.$roomId.stage[".write"];
  const head = "auth != null && ";
  const tail = " && " + closedOf(p);
  assert.ok(stage.startsWith(head) && stage.endsWith(tail),
    "rooms/$roomId/stage is no longer `auth != null && <facilitator> && !closed`: " + stage);
  return stage.slice(head.length, stage.length - tail.length);
}

/* The acknowledgement, and nothing else: the facilitator may set `ack` on the
   call that stands. It may not re-date it, re-sign it or rewrite its message —
   it may drop the message, because the deployed client does (below). */
const ackBranch = (node, p) => "((" + facilitatorOf(node, p) + ") && newData.child('ack').val() == true && " +
  "newData.child('at').val() == data.child('at').val() && " +
  "newData.child('by').val() == data.child('by').val() && " +
  "(!newData.child('msg').exists() || newData.child('msg').val() == data.child('msg').val()))";

const oneCallAtATime = (node, p) => "(!data.exists() || data.child('ack').val() == true || newData.val() == null || " +
  "newData.child('at').val() >= data.child('at').val() + 30000 || " + ackBranch(node, p) + ")";

/* Who may touch the call at all — unchanged here (PR #457: a room claim on any
   room of the session, or the facilitator). */
const whoInSession = (node, p) => "(" + p + ".child('roomOf').child(auth.uid).exists() || (" + facilitatorOf(node, p) + "))";

const VALIDATE = "newData.val() == null || (newData.hasChildren(['by','at']) && newData.child('by').isString() && " +
  "newData.child('by').val().length <= 40 && newData.child('at').isNumber() && newData.child('at').val() <= now + 5000 && " +
  "(newData.child('at').val() >= now - 60000 || newData.child('ack').val() == true && " +
  "newData.child('at').val() == data.child('at').val() && newData.child('by').val() == data.child('by').val()))";

function bodyOf(src, name) {
  const start = src.indexOf("\nfunction " + name + "(");
  assert.notStrictEqual(start, -1, name + "() not found");
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}
/* Comments say what the code used to do; only the code may answer. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

test("the call for help: the facilitator may acknowledge the call that stands, and only acknowledge it", () => {
  for (const [label, node, p] of TREES) {
    const cfh = node.rooms.$roomId.callForHelp;
    assert.strictEqual(cfh[".write"],
      "auth != null && " + closedOf(p) + " && " + oneCallAtATime(node, p) + " && " + whoInSession(node, p),
      `${label}/rooms/$roomId/callForHelp .write`);
    /* The facilitator half sits INSIDE the one-call-at-a-time clause, not
       beside it: a facilitator who is not acknowledging is held to one call at
       a time like anybody else. */
    assert.ok(oneCallAtATime(node, p).includes(facilitatorOf(node, p)));
  }
});

test("the validator takes a call older than a minute only as its own acknowledgement", () => {
  /* `at >= now - 60000` keeps a NEW call from being back-dated. The
     acknowledgement re-sends the call's own date, and a facilitator usually
     arrives more than a minute after the call — so the window applies to
     every record except one that is acknowledged and keeps its date and its
     author. */
  for (const [label, node] of TREES) {
    const cfh = node.rooms.$roomId.callForHelp;
    assert.strictEqual(cfh[".validate"], VALIDATE, `${label}/rooms/$roomId/callForHelp .validate`);
    assert.strictEqual(cfh.ack[".validate"], "newData.val() == null || newData.isBoolean()");
  }
});

test("the rule accepts what the deployed client sends — the call it read, with ack: true", () => {
  /* openRoomAsAdmin() reads the call and, if it is not yet acknowledged,
     writes it back with `by` and `at` as read, `ack: true`, and no `msg`. The
     rule above is written against exactly this. If the payload changes, check
     it against the branch (a new `at` is refused as a re-dating; a new `by` as
     a re-signing) and run the emulator spec. */
  const body = code(bodyOf(ADMIN, "openRoomAsAdmin"));
  assert.match(body, /const cfh = db\.ref\(sPath\("rooms\/" \+ roomName \+ "\/callForHelp"\)\);/);
  assert.match(body, /if \(v && !v\.ack\) return cfh\.set\(\{ by: v\.by, at: v\.at, ack: true \}\);/,
    "openRoomAsAdmin() no longer sends { by: v.by, at: v.at, ack: true }");
  assert.match(body, /\.catch\(e => console\.error\("Acknowledging call failed", e\)\)/);
  /* …and the room renders what the acknowledgement is for. */
  const render = code(bodyOf(SCRIPT, "renderCallProf"));
  assert.match(render, /else if \(callForHelp\.ack\)/);
  assert.match(render, /A facilitator is coming ✓ \(tap to call again\)/);
});

test("\"Reset this room's case\" is gone, and nothing deletes a room's whole list of findings", () => {
  assert.doesNotMatch(INDEX, /id="reset-btn"/, "index.html still carries the reset control");
  assert.doesNotMatch(INDEX, /data-i18n="reset\.btn"/);
  /* `.reset-btn` is a CLASS as well, and the waiting room's Leave button wears
     it: the class stays, and so must that button. */
  assert.match(INDEX, /<button id="waiting-leave" class="reset-btn"/);
  const s = code(SCRIPT);
  assert.doesNotMatch(s, /\binitReset\b/, "script.js still defines or calls initReset()");
  assert.doesNotMatch(s, /"reset-btn"/, "script.js still addresses #reset-btn");
  /* No client file removes the parent list. `revealed/<item>` may be deleted
     one at a time (a roommate takes back a reveal); the list as a whole has no
     rule, so a remove() there is refused — which is what the button did. */
  const clientFiles = fs.readdirSync(P).filter((f) => f.endsWith(".js"));
  assert.ok(clientFiles.includes("script.js") && clientFiles.includes("script-admin.js"), "client files not listed");
  for (const f of clientFiles) {
    const src = code(read(f));
    assert.doesNotMatch(src, /refRevealed\.(remove|set|update)\(/, `${f}: writes the whole revealed list`);
    assert.doesNotMatch(src, /\/revealed"\)\)?\.(remove|set|update)\(/, `${f}: writes the whole revealed list`);
  }
  /* Its two strings went with it, from the canonical table and every locale. */
  for (const f of ["i18n.js"].concat(fs.readdirSync(path.join(P, "locales")).map((l) => "locales/" + l))) {
    assert.doesNotMatch(read(f), /"reset\.btn(-title)?"\s*:/, `${f} still carries the reset control's strings`);
  }
});
