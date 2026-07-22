/* tests/round3-clientmapping.test.js
 *
 * Lock-in tests for the Round-3 Firebase-rules agent CRITICAL/HIGH fixes
 * (sim-output/round3-firebase.md):
 *
 *   CM1  A clientMapping/$clientId node exists (write-once, == auth.uid)
 *        in BOTH the /sessions and /orgs trees (FINDING-01).
 *   CM2  Owner-keyed write paths (pool, presence, typing, observers, poll,
 *        tests pre/post) carry the tolerant ownership guard
 *        (mapping absent OR mapping == auth.uid).
 *   CM3  pool/$clientId/room keeps the looser auth+open guard so admin
 *        room-assignment + self-assign still work (carve-out).
 *   CM4  stageAt is admin-gated + freshness-bounded (FINDING-03), in both
 *        trees.
 *
 * These are static rule-string assertions (the suite does not spin up the
 * emulator); the emulator-backed behaviour is exercised by the e2e suite
 * in CI, which must stay green for the join flow.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const RULES = JSON.parse(
  fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8"));
const SCRIPT_JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

const sess = RULES.rules.sessions["$sessionId"];
const org  = RULES.rules.orgs["$orgSlug"].sessions["$sessionId"];

// Ownership guard fragment, parameterised by tree + wildcard name.
function ownerGuard(treePrefix, wildcard) {
  const base = treePrefix + ".child('clientMapping').child(" + wildcard + ")";
  return "(!" + base + ".exists() || " + base + ".val() == auth.uid)";
}
const SESS_PREFIX = "root.child('sessions').child($sessionId)";
const ORG_PREFIX  = "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";

// ------------------------------------------------------------------
// CM1 — clientMapping node exists, write-once, == auth.uid
// ------------------------------------------------------------------
test("CM1: /sessions clientMapping is write-once and validates == auth.uid", () => {
  const node = sess.clientMapping && sess.clientMapping["$clientId"];
  assert.ok(node, "sessions tree must declare clientMapping/$clientId");
  assert.match(node[".write"], /!data\.exists\(\)/,
    "clientMapping must be write-once: " + node[".write"]);
  assert.match(node[".validate"], /newData\.val\(\)\s*==\s*auth\.uid/,
    "clientMapping must validate the value equals the caller's uid");
});
test("CM1: /orgs clientMapping mirrors the /sessions node", () => {
  const node = org.clientMapping && org.clientMapping["$clientId"];
  assert.ok(node, "orgs tree must declare clientMapping/$clientId");
  assert.match(node[".write"], /!data\.exists\(\)/);
  assert.match(node[".validate"], /newData\.val\(\)\s*==\s*auth\.uid/);
});

// ------------------------------------------------------------------
// CM2 — owner-keyed paths carry the ownership guard
// ------------------------------------------------------------------
test("CM2: /sessions pool/$clientId write requires the ownership guard", () => {
  const w = sess.pool["$clientId"][".write"];
  assert.ok(w.includes(ownerGuard(SESS_PREFIX, "$clientId")),
    "pool/$clientId .write must include the clientMapping ownership guard: " + w);
});
test("CM2: /sessions presence + typing carry the ownership guard", () => {
  const room = sess.rooms["$roomId"];
  assert.ok(room.presence["$clientId"][".write"].includes(ownerGuard(SESS_PREFIX, "$clientId")),
    "presence/$clientId must carry the ownership guard");
  assert.ok(room.typing["$clientId"][".write"].includes(ownerGuard(SESS_PREFIX, "$clientId")),
    "typing/$clientId must carry the ownership guard");
});
test("CM2: /sessions observers + poll carry the ownership guard", () => {
  assert.ok(sess.rooms["$roomId"].observers["$clientId"][".write"]
    .includes(ownerGuard(SESS_PREFIX, "$clientId")),
    "observers/$clientId must carry the ownership guard");
  assert.ok(sess.poll["$cid"][".write"].includes(ownerGuard(SESS_PREFIX, "$cid")),
    "poll/$cid must carry the ownership guard");
});
test("CM2: /sessions tests pre + post carry the ownership guard", () => {
  const tests = sess.rooms["$roomId"].tests["$cid"];
  assert.ok(tests.pre[".write"].includes(ownerGuard(SESS_PREFIX, "$cid")),
    "tests/$cid/pre must carry the ownership guard");
  assert.ok(tests.post[".write"].includes(ownerGuard(SESS_PREFIX, "$cid")),
    "tests/$cid/post must carry the ownership guard");
});
test("CM2: /orgs pool + presence + typing + tests carry the ownership guard", () => {
  assert.ok(org.pool["$clientId"][".write"].includes(ownerGuard(ORG_PREFIX, "$clientId")),
    "orgs pool/$clientId must carry the ownership guard");
  const room = org.rooms["$roomId"];
  assert.ok(room.presence["$clientId"][".write"].includes(ownerGuard(ORG_PREFIX, "$clientId")),
    "orgs presence must carry the ownership guard");
  assert.ok(room.typing["$clientId"][".write"].includes(ownerGuard(ORG_PREFIX, "$clientId")),
    "orgs typing must carry the ownership guard");
  assert.ok(room.tests["$cid"].pre[".write"].includes(ownerGuard(ORG_PREFIX, "$cid")),
    "orgs tests pre must carry the ownership guard");
  assert.ok(room.tests["$cid"].post[".write"].includes(ownerGuard(ORG_PREFIX, "$cid")),
    "orgs tests post must carry the ownership guard");
});

// ------------------------------------------------------------------
// CM3 — pool/$clientId/room carve-out (admin assignment must keep working)
// ------------------------------------------------------------------
// Phase 4a (2026-07-22) tightened this: the room sub-field is now restricted to
// SELF-assign (the client owns its clientMapping) OR ADMIN-assign (creator or a
// password-proof holder), closing the room-griefing residual for self-serve.
test("CM3/P4a: /sessions pool/$clientId/room is restricted to self (clientMapping) OR admin", () => {
  const roomWrite = sess.pool["$clientId"].room[".write"];
  assert.ok(roomWrite, "pool/$clientId/room must declare its own .write");
  assert.ok(roomWrite.includes("auth != null"), "room write must require auth");
  assert.match(roomWrite, /clientMapping'\)\.child\(\$clientId\)\.val\(\) == auth\.uid/,
    "self-assign must require clientMapping ownership");
  assert.match(roomWrite, /creatorUid'\)\.val\(\) == auth\.uid/,
    "admin-assign must allow the session creator");
  assert.match(roomWrite, /adminSecrets'\)\.child\(\$sessionId\)\.child\('proof'\)/,
    "admin-assign must allow a password-proof holder");
});
test("CM3/P4a: /orgs pool/$clientId/room is restricted to self OR admin", () => {
  const roomWrite = org.pool["$clientId"].room[".write"];
  assert.ok(roomWrite, "orgs room sub-field must declare .write");
  assert.match(roomWrite, /clientMapping'\)\.child\(\$clientId\)\.val\(\) == auth\.uid/,
    "orgs self-assign must require clientMapping ownership");
  assert.match(roomWrite, /adminSecrets'\)\.child\('orgs'\)/,
    "orgs admin-assign must allow a password-proof holder (org-scoped adminSecrets)");
});
// Phase 4a — a representative admin-write node (started) is now identity-bound
// (creator OR proof), not merely "the session has an admin".
test("P4a: /sessions started is bound to creatorUid OR a password-proof", () => {
  const w = sess.started[".write"];
  assert.match(w, /adminPasswordHash'\)\.exists\(\)/, "still requires the session to have an admin");
  assert.match(w, /creatorUid'\)\.val\(\) == auth\.uid/, "must allow the creator");
  assert.match(w, /adminSecrets'\)\.child\(\$sessionId\)\.child\('proof'\)/, "must allow a proof holder");
});

// ------------------------------------------------------------------
// CM4 — stageAt admin-gated + freshness-bounded (FINDING-03)
// ------------------------------------------------------------------
test("CM4: /sessions stageAt is admin-gated + freshness-bounded", () => {
  const node = sess.rooms["$roomId"].stageAt;
  assert.match(node[".write"], /adminPasswordHash'\)\.exists\(\)/,
    "stageAt must be admin-gated: " + node[".write"]);
  assert.match(node[".validate"], /now\s*-\s*5000/,
    "stageAt must enforce a now-5000 lower bound: " + node[".validate"]);
  assert.match(node[".validate"], /now\s*\+\s*5000/,
    "stageAt must enforce a now+5000 upper bound");
});
test("CM4: /orgs stageAt is admin-gated + freshness-bounded", () => {
  const node = org.rooms["$roomId"].stageAt;
  assert.match(node[".write"], /adminPasswordHash'\)\.exists\(\)/);
  assert.match(node[".validate"], /now\s*-\s*5000/);
});

// ------------------------------------------------------------------
// Client wiring — the join flow binds clientId->uid before the pool write
// ------------------------------------------------------------------
test("CM-client: script.js defines claimClientMapping() and calls it in the join chain", () => {
  assert.match(SCRIPT_JS, /function claimClientMapping\s*\(/,
    "script.js must define claimClientMapping()");
  assert.match(SCRIPT_JS, /clientMapping\/"\s*\+\s*clientId/,
    "claimClientMapping must write sPath('clientMapping/' + clientId)");
  assert.match(SCRIPT_JS, /claimMembership\("participant"\)[\s\S]{0,120}?claimClientMapping\(\)/,
    "the join chain must call claimClientMapping() after claimMembership()");
});
