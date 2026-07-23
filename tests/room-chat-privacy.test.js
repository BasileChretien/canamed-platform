"use strict";
/* tests/room-chat-privacy.test.js
 *
 * Phase-4e compliance gap 3: the Module A free-text chat was NOT room-private.
 *
 * RTDB `.read` CASCADES and cannot be revoked at a deeper path.
 * `sessions/$sessionId` grants `.read` to every session member, so the
 * room-scoped `.read` that used to sit on
 * `sessions/$sessionId/rooms/$roomId/moduleA/chat` was ADDITIVE ONLY — it
 * restricted nothing, and every member of a session could read every room's
 * conversation with the LLM patient.
 *
 * The fix mirrors FINDING-07 (the admin hash -> `adminSecrets/`): move the data
 * OUT of the cascade into a TOP-LEVEL `roomChat/` tree with its own per-room
 * `.read`. These tests exist to stop it drifting back.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const RULES = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8")).rules;
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const INIT = fs.readFileSync(path.join(P, "modA-llm-init.js"), "utf8");

const sessRoom = RULES.sessions.$sessionId.rooms.$roomId;
const orgRoom = RULES.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId;

test("the chat no longer sits inside the session read-cascade", () => {
  assert.ok(!(sessRoom.moduleA && sessRoom.moduleA.chat),
    "sessions/.../moduleA/chat must be gone — a .read there can never restrict");
  assert.ok(!(orgRoom.moduleA && orgRoom.moduleA.chat),
    "orgs/.../moduleA/chat must be gone too");
});

test("roomChat is a TOP-LEVEL tree, so no session .read reaches it", () => {
  assert.ok(RULES.roomChat, "roomChat must exist at the rules root");
  // The database root is .read:false, and roomChat adds no read of its own at
  // the session level — only per room. If a $sessionId-level .read appeared it
  // would re-create exactly the cross-room cascade this fix removes.
  assert.ok(!RULES.roomChat.$sessionId[".read"],
    "a $sessionId-level .read would re-create the cross-room cascade");
  assert.ok(!RULES.roomChat[".read"], "roomChat must not grant a blanket read");
});

test("roomChat read is gated on ROOM membership, not session membership", () => {
  const r = RULES.roomChat.$sessionId.$roomId[".read"];
  assert.match(r, /rooms'\)\.child\(\$roomId\)\.child\('uidMembers'\)\.child\(auth\.uid\)\.exists\(\)/,
    "read must require membership of THAT room");
  assert.ok(!/child\('members'\)\.hasChild\(auth\.uid\)/.test(r),
    "read must NOT fall back to session-wide membership — that is the bug");
});

test("the facilitator keeps read access (needed for debrief)", () => {
  const r = RULES.roomChat.$sessionId.$roomId[".read"];
  assert.match(r, /creatorUid'\)\.val\(\) == auth\.uid/,
    "the session creator must still be able to read");
  assert.match(r, /adminSecrets'\)[\s\S]*proof'\)\.child\(auth\.uid\)/,
    "an authenticated facilitator (proof-write) must still be able to read");
});

test("org-scoped roomChat has the same gating, scoped to the org tree", () => {
  const r = RULES.roomChat.orgs.$orgSlug.$sessionId.$roomId[".read"];
  assert.match(r, /child\('orgs'\)\.child\(\$orgSlug\)/, "must resolve inside the org tree");
  assert.match(r, /child\(\$roomId\)\.child\('uidMembers'\)\.child\(auth\.uid\)\.exists\(\)/,
    "org read must require membership of THAT room");
  assert.ok(!/child\('members'\)\.hasChild\(auth\.uid\)/.test(r),
    "org read must not fall back to session-wide membership either");
});

test("write stays room-scoped, write-once and closed-session-blocked", () => {
  for (const [label, node] of [
    ["default", RULES.roomChat.$sessionId.$roomId.$turnId],
    ["org", RULES.roomChat.orgs.$orgSlug.$sessionId.$roomId.$turnId]
  ]) {
    assert.match(node[".write"], /!data\.exists\(\)/, label + ": turns must be write-once");
    assert.match(node[".write"], /'closed'\)\.exists\(\)/, label + ": no writes to a closed session");
    assert.match(node[".write"], /uidMembers'\)\.child\(auth\.uid\)\.exists\(\)/,
      label + ": only members of that room may write");
  }
});

test("the turn validate is unchanged (no constraint was loosened in the move)", () => {
  for (const node of [
    RULES.roomChat.$sessionId.$roomId.$turnId,
    RULES.roomChat.orgs.$orgSlug.$sessionId.$roomId.$turnId
  ]) {
    const v = node[".validate"];
    assert.match(v, /hasChildren\(\['role','content','at'\]\)/);
    assert.match(v, /'user' \|\| newData\.child\('role'\)\.val\(\) === 'assistant'/);
    assert.match(v, /'content'\)\.val\(\)\.length <= 600/);
  }
});

test("the client resolves the chat through roomChatPath, not the room subtree", () => {
  assert.match(SCRIPT, /function roomChatPath\(code, roomId\)/,
    "script.js must expose a roomChat path resolver");
  assert.match(SCRIPT, /window\.roomChatPath = roomChatPath/,
    "the resolver must be bridged to the LLM init");
  assert.match(INIT, /window\.roomChatPath\(window\.sessionNum, window\.myRoom\)/,
    "modA-llm-init must build the chat ref from roomChatPath");
  assert.ok(!/modABase \+ "\/chat"/.test(INIT),
    "the old in-cascade chat path must not come back");
});

test("roomChatPath namespaces org sessions like adminSecretPath does", () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf("function roomChatPath"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /"roomChat\/" \+ code/, "default org keeps the flat path");
  assert.match(body, /"roomChat\/orgs\/" \+ currentOrg \+ "\/" \+ code/,
    "other orgs namespace under roomChat/orgs/<slug>/");
});
