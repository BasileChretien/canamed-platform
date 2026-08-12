"use strict";
/* tests/hf-membership-lockstep.test.js
 *
 * hfPatient's per-room authorisation reads a node that a DIFFERENT file writes:
 *   - script.js            claims  sessions/<code>/roomOf/<uid> = { room, cid }
 *   - functions/index.js   reads it back in _verifyMembership
 *
 * Those two must name the same node. On 2026-08-03, #268 replaced the per-room
 * `uidMembers` marker with the session-level `roomOf` claim and migrated the
 * client and the database rules — but not the Cloud Function, which kept
 * reading `rooms/<roomId>/uidMembers/<uid>`. Nothing writes that node any more,
 * so _verifyMembership failed for EVERY participant, hfPatient returned
 * permission-denied on every turn, and the bridge silently degraded the whole
 * room to the stub patient. It survived ~9 days and a green CI, and was only
 * found by a live test on 2026-08-12 — because the failure is silent by design
 * (the bridge treats any error as "backend unavailable").
 *
 * rules.test.js already forbids any DATABASE RULE from gating on the retired
 * marker. This is the same lock for the FUNCTION, plus the client↔server
 * lockstep the region test does for `region:`.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const FUNCS = fs.readFileSync(path.join(P, "functions", "index.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const { roomClaimPath, roomClaimMatches } =
  require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers");

/* The node the CLIENT claims, read out of the real write site rather than
   hard-coded here — otherwise this test pins a constant instead of the code. */
function clientClaimNode(src) {
  const m = src.match(/db\.ref\(sPath\("([A-Za-z]+)\/"\s*\+\s*uid\)\)\s*\n?\s*\.transaction/);
  assert.ok(m, "could not find the client's write-once room claim in script.js");
  return m[1];
}

/* The node the SERVER authorises against, derived from the helper the function
   actually calls (not from a copy of the string). */
function serverClaimNode() {
  const parts = roomClaimPath("CODE", "", "UID").split("/");
  assert.strictEqual(parts[0], "sessions", "the claim must live under the session");
  assert.strictEqual(parts[1], "CODE");
  assert.strictEqual(parts[3], "UID", "the claim must be keyed by uid");
  return parts[2];
}

test("the client and the function agree on the room-claim node", () => {
  assert.strictEqual(serverClaimNode(), clientClaimNode(SCRIPT),
    "node drift denies every hfPatient call and silently drops the room to the stub patient");
});

/* Comments are stripped first: the migration is worth DOCUMENTING at the call
   site, so only executable code may still name the retired node. The `[^:]`
   guard keeps `https://` out of the line-comment rule. Heuristic (it does not
   parse strings or regex literals), which is fine for a "does this token appear
   in code" check. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("the function no longer authorises on the retired uidMembers marker", () => {
  // The exact miss that broke the feature. Nothing writes this node any more.
  assert.ok(!stripComments(FUNCS).includes("uidMembers"),
    "functions/index.js must not read the retired per-room uidMembers marker");
});

test("_verifyMembership resolves the path through the shared helper", () => {
  // A correct helper is useless if the call site still builds its own path.
  const at = FUNCS.indexOf("async function _verifyMembership");
  assert.notStrictEqual(at, -1, "could not find _verifyMembership");
  const body = FUNCS.slice(at, at + 1600);
  assert.match(body, /roomClaimPath\(/, "must build the path via roomClaimPath");
  assert.match(body, /roomClaimMatches\(/, "must compare the claimed room via roomClaimMatches");
  assert.ok(!/\.exists\(\)/.test(body),
    "an existence check authorises any room — the claim's room must be COMPARED");
});

/* The claim is session-level, so the room it grants travels in the value. If
   the function ever went back to an existence check, a participant in Room 1
   could drive Room 2's patient — the cross-room hole the marker once closed. */
test("holding one room does not authorise another", () => {
  assert.strictEqual(roomClaimMatches({ room: "Room 1", cid: "c1" }, "Room 2"), false);
  assert.strictEqual(roomClaimPath("abc", "", "u1"), roomClaimPath("abc", "", "u1"));
});
