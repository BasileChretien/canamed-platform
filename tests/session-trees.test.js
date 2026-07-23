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

test("cleanup purges the session's adminSecrets entry too", () => {
  const src = read("cleanup-stale-sessions.js");
  assert.match(src, /adminSecretPath\)\.remove\(\)/,
    "adminSecrets lives outside the session subtree and nothing else purges it");
  assert.match(src, /db\.ref\(loc\.path\)\.remove\(\)/,
    "cleanup must purge by resolved location path, not a hardcoded sessions/ path");
});
