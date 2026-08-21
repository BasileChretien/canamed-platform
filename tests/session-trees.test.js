"use strict";
/* tests/session-trees.test.js
 *
 * Phase-4e compliance gap 2: org-scoped sessions had ZERO retention coverage.
 *
 * orgs.js shipped with /o/{slug}/ routing and a full parallel rules tree under
 * orgs/{slug}/sessions/, but all three retention jobs were hard-scoped to
 * db.ref("sessions") — so org sessions were never purged, never backed up and
 * never pseudonymised. These guard the shared enumerator that now feeds all
 * three, and assert that no job has silently reverted to the single-tree read.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { sessionLocations, safeLabel } = require("../scripts/lib/session-trees");

const SCRIPTS = path.join(__dirname, "..", "scripts");
const read = f => fs.readFileSync(path.join(SCRIPTS, f), "utf8");
const JOBS = ["cleanup-stale-sessions.js", "backup-sessions.js", "pseudonymise-export.js"];

const SESSIONS = {
  ABC: { closed: { at: 1 }, pool: { c1: { name: "A" } } },
  DEF: { created: { at: 2 } }
};
const ORGS = {
  caen: { sessions: { XYZ: { closed: { at: 3 } } } },
  nagoya: { sessions: { ABC: { closed: { at: 4 } }, QRS: { created: { at: 5 } } } }
};

test("both trees are enumerated, not just sessions/", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  assert.strictEqual(locs.length, 5, "2 default + 3 org-scoped");
  assert.strictEqual(locs.filter(l => l.orgSlug).length, 3);
  assert.strictEqual(locs.filter(l => !l.orgSlug).length, 2);
});

test("paths point at the right subtree in each tree", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  const byKey = Object.fromEntries(locs.map(l => [l.key, l]));
  assert.strictEqual(byKey.ABC.path, "sessions/ABC");
  assert.strictEqual(byKey["orgs/caen/XYZ"].path, "orgs/caen/sessions/XYZ");
  assert.strictEqual(byKey["orgs/nagoya/QRS"].path, "orgs/nagoya/sessions/QRS");
});

test("adminSecrets paths mirror the two-tree layout", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  const byKey = Object.fromEntries(locs.map(l => [l.key, l]));
  assert.strictEqual(byKey.ABC.adminSecretPath, "adminSecrets/ABC");
  assert.strictEqual(byKey["orgs/caen/XYZ"].adminSecretPath, "adminSecrets/orgs/caen/XYZ");
});

test("a session code reused across trees does not collide", () => {
  // "ABC" exists in BOTH the default tree and the nagoya org. Keying an export
  // by the bare code would silently drop one of the two.
  const locs = sessionLocations(SESSIONS, ORGS);
  const keys = locs.map(l => l.key);
  assert.strictEqual(new Set(keys).size, keys.length, "location keys must be unique");
  const abc = locs.filter(l => l.code === "ABC");
  assert.strictEqual(abc.length, 2, "the same code appears in two trees");
  assert.notStrictEqual(abc[0].key, abc[1].key);
  assert.notStrictEqual(abc[0].data.closed.at, abc[1].data.closed.at, "distinct data preserved");
});

test("empty / missing trees are handled without throwing", () => {
  assert.deepStrictEqual(sessionLocations(null, null), []);
  assert.deepStrictEqual(sessionLocations(undefined, undefined), []);
  assert.deepStrictEqual(sessionLocations({}, {}), []);
  // An org with no sessions node at all must not blow up.
  assert.deepStrictEqual(sessionLocations(null, { empty: {} }), []);
  assert.deepStrictEqual(sessionLocations(null, { weird: null }), []);
});

test("safeLabel never leaks a session code in QUIET mode", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  for (const loc of locs) {
    const quiet = safeLabel(loc, true);
    assert.ok(!quiet.includes(loc.code),
      "a world-readable log line must not carry the join code: " + quiet);
  }
  // The org slug is not a secret and is useful for diagnosis, so it is kept.
  const org = locs.find(l => l.orgSlug === "caen");
  assert.strictEqual(safeLabel(org, true), "orgs/caen/<redacted>");
  assert.strictEqual(safeLabel(org, false), "orgs/caen/XYZ");
});

test("every retention job reads BOTH trees via the shared enumerator", () => {
  for (const job of JOBS) {
    const src = read(job);
    assert.match(src, /require\(["']\.\/lib\/session-trees["']\)/,
      job + " must use the shared enumerator");
    assert.match(src, /readSessionLocations\(db\)/,
      job + " must enumerate both trees");
  }
});

test("no retention job still reads only db.ref('sessions')", () => {
  for (const job of JOBS) {
    const src = read(job);
    assert.ok(!/db\.ref\(["']sessions["']\)/.test(src),
      job + " must not go back to the single-tree read that caused this gap");
  }
});

test("roomChat paths mirror the two-tree layout", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  const byKey = Object.fromEntries(locs.map(l => [l.key, l]));
  assert.strictEqual(byKey.ABC.roomChatPath, "roomChat/ABC");
  assert.strictEqual(byKey["orgs/caen/XYZ"].roomChatPath, "roomChat/orgs/caen/XYZ");
});

test("certIds paths mirror the two-tree layout", () => {
  const locs = sessionLocations(SESSIONS, ORGS);
  const byKey = Object.fromEntries(locs.map(l => [l.key, l]));
  assert.strictEqual(byKey.ABC.certIdsPath, "certIds/ABC");
  assert.strictEqual(byKey["orgs/caen/XYZ"].certIdsPath, "certIds/orgs/caen/XYZ");
  // rosterPath must mirror the CLIENT path exactly: script.js writes
  // "rosters/" + sPath(uid), and sPath is _sessionPrefix(org) + code. A
  // mismatch here is silent - the roster write is best-effort and .catch()es,
  // so a wrong path means names are never purged and nobody finds out.
  assert.strictEqual(byKey.ABC.rosterPath, "rosters/sessions/ABC");
  assert.strictEqual(byKey["orgs/caen/XYZ"].rosterPath, "rosters/orgs/caen/sessions/XYZ");
});

test("cleanup purges the session AND its four out-of-cascade siblings", () => {
  const src = read("cleanup-stale-sessions.js");
  for (const [key, why] of [
    ["loc.path",
      "cleanup must purge by resolved location path, not a hardcoded sessions/ path"],
    ["loc.adminSecretPath",
      "adminSecrets lives outside the session subtree and nothing else purges it"],
    ["loc.roomChatPath",
      "the free-text chat lives outside the session subtree and must not outlive it"],
    ["loc.certIdsPath",
      "the published-cert-id map lives outside the session subtree and must not outlive it"],
    ["loc.rosterPath",
      "the participant roster holds names and emails; nothing deleted it before " +
      "2026-08-21 (Annex VI G5) and it must not outlive its session"]
  ]) {
    assert.ok(src.includes("purge[" + key + "] = null;"), why);
  }
});

/* The five paths must go in ONE atomic update, and the reason is recoverability
   rather than tidiness.

   They used to be five sequential removes with `sessions/<code>` FIRST. If any
   later delete failed, the session was already gone — and the enumeration that
   drives this job walks `sessions` and `orgs`, so the next run could never
   rediscover it. The surviving sibling was orphaned permanently, with nothing
   left pointing at it. Stranding the roster that way is the worst case: it is
   the node holding names and emails.

   An RTDB update() with null values applies every path or none, so a failure
   leaves the session in place and the next run retries the whole set. */
test("the purge is ONE atomic multi-path update, so a partial failure is retryable", () => {
  const src = read("cleanup-stale-sessions.js");
  assert.ok(src.includes("db.ref().update(purge)"),
    "the purge must be a single root-level update() so it is all-or-nothing");
  // No stragglers: a later edit that adds a sixth path as a separate remove()
  // would reintroduce exactly the orphaning this replaced.
  assert.ok(!/loc\.\w+\)\.remove\(\)/.test(src),
    "no purge path may be removed separately — that is what made a partial " +
    "failure unrecoverable. Add it to the `purge` object instead.");
});

/* The roster path is DERIVED here, but the rules are hand-written, so the two
   can drift. If the rule tree stopped covering the path the client writes to,
   rosters would land somewhere retention never looks - and the write is
   best-effort with a .catch(), so nothing would surface it. */
test("the rosters rule tree covers both derived roster paths", () => {
  const rulesPath = path.join(__dirname, "..", "docs", "Third_session",
    "PBL_platform", "database.rules.json");
  const r = JSON.parse(fs.readFileSync(rulesPath, "utf8")).rules.rosters;
  assert.ok(r.sessions && r.sessions.$sessionId,
    "rosters/sessions/$sessionId must exist - the default-tree write target");
  assert.ok(r.orgs && r.orgs.$orgSlug && r.orgs.$orgSlug.sessions
    && r.orgs.$orgSlug.sessions.$sessionId,
    "rosters/orgs/$orgSlug/sessions/$sessionId must exist. CLAUDE.md long claimed " +
    "this branch was MIS-NESTED at rosters/sessions/orgs/... and therefore " +
    "fail-closed for every org session. It is not; that was fixed. This pins it.");
});
