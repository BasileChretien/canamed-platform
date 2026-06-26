/* tests/rules.test.js
 *
 * Structural tests for the Firebase Realtime Database security rules
 * (docs/Third_session/PBL_platform/database.rules.json).
 *
 * The Firebase emulator can run a full functional rules test suite, but
 * that requires a Java runtime + emulator install. These tests catch the
 * regression we actually care about under Round-2 hardening: every
 * write-capable path under /sessions/* must include `auth != null` in
 * its .write rule, so a stolen database URL alone cannot tamper with
 * workshop data. We also assert that the session-level .read requires
 * auth so participant rosters / consent records aren't world-readable.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RULES_PATH = path.join(
  __dirname, "..", "docs", "Third_session", "PBL_platform", "database.rules.json"
);

const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));

/* recursively walk a rules subtree, yielding {path, key, value} for every
   ".write" / ".read" rule found. $wildcard keys are normalized in the
   reported path so the test output reads naturally. */
function* walkRules(node, prefix) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    const childPath = prefix + "/" + key;
    if (key === ".write" || key === ".read") {
      yield { path: prefix, key, value: node[key] };
    } else if (typeof node[key] === "object" && node[key] !== null) {
      yield* walkRules(node[key], childPath);
    }
  }
}

// =============================================================
// Round-2 invariants
// =============================================================

test("rules: top-level read and write are denied by default", () => {
  assert.strictEqual(rules.rules[".read"], false);
  assert.strictEqual(rules.rules[".write"], false);
});

test("rules: every write rule under /sessions/* requires auth != null", () => {
  const sessions = rules.rules.sessions["$sessionId"];
  const offenders = [];
  for (const entry of walkRules(sessions, "/sessions/$sessionId")) {
    if (entry.key !== ".write") continue;
    if (typeof entry.value !== "string") {
      offenders.push(entry.path + " has non-string .write: " + JSON.stringify(entry.value));
      continue;
    }
    if (!entry.value.includes("auth != null")) {
      offenders.push(entry.path + " .write is missing 'auth != null': " + entry.value);
    }
  }
  assert.deepStrictEqual(offenders, [],
    "Every write path under /sessions/* must require an authenticated user. " +
    "Offending rules:\n" + offenders.join("\n"));
});

test("rules: session subtree .read requires authentication", () => {
  const sessionRule = rules.rules.sessions["$sessionId"][".read"];
  assert.strictEqual(typeof sessionRule, "string",
    "/sessions/$sessionId/.read must be a string expression, not a literal");
  assert.ok(sessionRule.includes("auth != null"),
    "/sessions/$sessionId/.read must require auth != null; got: " + sessionRule);
});

test("rules: /users/$uid is bound to auth.uid for both read and write", () => {
  const user = rules.rules.users["$uid"];
  assert.match(user[".read"], /auth\s*!=\s*null/);
  assert.match(user[".read"], /auth\.uid\s*==\s*\$uid/);
  assert.match(user[".write"], /auth\s*!=\s*null/);
  assert.match(user[".write"], /auth\.uid\s*==\s*\$uid/);
});

test("rules: write-once markers stay write-once (no overwrite)", () => {
  const session = rules.rules.sessions["$sessionId"];
  const writeOnceFields = [
    "adminPasswordHash", "created", "workshopLabel", "scenarioId", "scenarioCustomJson"
  ];
  for (const field of writeOnceFields) {
    const rule = session[field][".write"];
    assert.ok(rule.includes("!data.exists()"),
      "/sessions/$sessionId/" + field + " should refuse overwrites (!data.exists()); got: " + rule);
  }
});

test("rules: every closed-session-protected path refuses writes once closed", () => {
  // Once a session is closed (closed marker exists), no further writes to
  // its workshop data should be accepted. Privileged write paths embed
  // !root.child('sessions').child($sessionId).child('closed').exists().
  const session = rules.rules.sessions["$sessionId"];
  // sample several paths that the audit highlighted
  const protectedPaths = [
    session.pool["$clientId"][".write"],
    session.rooms["$roomId"].stage[".write"],
    session.rooms["$roomId"].teamName[".write"],
    session.rooms["$roomId"].presence["$clientId"][".write"],
    session.rooms["$roomId"].typing["$clientId"][".write"],
    session.rooms["$roomId"].answers.moduleA["$entryId"][".write"],
    session.rooms["$roomId"].answers.moduleB["$entryId"][".write"]
  ];
  for (const rule of protectedPaths) {
    assert.ok(rule.includes("'closed'"),
      "Expected a closed-marker guard, got: " + rule);
    assert.ok(rule.includes("!root.child"),
      "Expected !root.child(...).exists() pattern, got: " + rule);
  }
});

test("rules: closed-marker itself is write-once (no re-opening)", () => {
  const closedRule = rules.rules.sessions["$sessionId"].closed[".write"];
  assert.ok(closedRule.includes("!data.exists()"),
    "The closed marker must be write-once; got: " + closedRule);
});

test("rules: link fields validate https:// (no plaintext / javascript:)", () => {
  const session = rules.rules.sessions["$sessionId"];
  for (const field of ["teamsLink", "questionnaireLink", "preQuestionnaireLink"]) {
    const v = session[field][".validate"];
    assert.ok(v.includes("https:"),
      "/sessions/$sessionId/" + field + " .validate must constrain to https; got: " + v);
  }
});

test("rules: password-hash field validates PBKDF2 or legacy SHA-256 format", () => {
  const v = rules.rules.sessions["$sessionId"].adminPasswordHash[".validate"];
  // PBKDF2 envelope v2$iters$hex
  assert.match(v, /v2\[\$\]\[0-9\]\+\[\$\]\[0-9a-f\]\+/);
  // legacy SHA-256 64 lowercase hex
  assert.match(v, /\[0-9a-f\]\{64\}/);
});

// =============================================================
// Event-sourcing subtree (Phase 1)
// docs/Third_session/PBL_platform/ARCHITECTURE/EVENT_SOURCING_DESIGN.md
// =============================================================

test("rules: events subtree exists under rooms with envelope validation", () => {
  const events = rules.rules.sessions["$sessionId"].rooms["$roomId"].events;
  assert.ok(events && typeof events === "object",
    "/sessions/$sessionId/rooms/$roomId/events must be declared");
  const node = events["$pushId"];
  assert.ok(node, "events subtree must wildcard over $pushId");
  // envelope fields must be validated
  const v = node[".validate"];
  assert.ok(v.includes("'kind'") && v.includes("'by'") && v.includes("'at'"),
    "events validate must enforce kind/by/at envelope: " + v);
  // size caps match audit (kind <= 30, by <= 40, payload <= 500 when present)
  assert.match(v, /child\('kind'\)\.val\(\)\.length <= 30/);
  assert.match(v, /child\('by'\)\.val\(\)\.length <= 40/);
  assert.match(v, /child\('payload'\)\.val\(\)\.length <= 500/);
});

test("rules: events writes are append-only and freshness-bounded", () => {
  const node = rules.rules.sessions["$sessionId"].rooms["$roomId"].events["$pushId"];
  const w = node[".write"];
  assert.ok(w.includes("!data.exists()"),
    "events writes must be append-only (!data.exists()): " + w);
  assert.ok(w.includes("auth != null"),
    "events writes must require an authenticated participant: " + w);
  assert.ok(w.includes("'closed'") && w.includes("!root.child"),
    "events writes must be refused after the session is closed: " + w);
  // freshness guard on the `at` field (±60s of server now, matches audit)
  const v = node[".validate"];
  assert.match(v, /child\('at'\)\.val\(\) <= now \+ 5000/);
  assert.match(v, /child\('at'\)\.val\(\) >= now - 60000/);
});

test("rules: events are writable by any authenticated participant (not admin-only)", () => {
  // /events/ is written by ordinary participants — NOT admin-gated. This
  // test guards against a future change accidentally tightening the rule
  // to admin-only and silently breaking the dual-write — see
  // EVENT_SOURCING_DESIGN.md §6.
  const eventsWrite = rules.rules.sessions["$sessionId"].rooms["$roomId"].events["$pushId"][".write"];
  assert.ok(eventsWrite.includes("auth != null"),
    "events writes must require an authenticated user: " + eventsWrite);
  assert.ok(!eventsWrite.includes("adminPasswordHash"),
    "events writes must NOT require adminPasswordHash — any participant emits: " + eventsWrite);
});

test("rules: bounded numeric fields stay clamped (no integer overflow tricks)", () => {
  const session = rules.rules.sessions["$sessionId"];
  // roomCount 1..20
  assert.match(session.roomCount[".validate"], /newData\.val\(\) >= 1/);
  assert.match(session.roomCount[".validate"], /newData\.val\(\) <= 20/);
  // stage 0..3
  assert.match(session.rooms["$roomId"].stage[".validate"], /newData\.val\(\) >= 0/);
  assert.match(session.rooms["$roomId"].stage[".validate"], /newData\.val\(\) <= 3/);
  // manual score points 0..50
  assert.match(session.rooms["$roomId"].score.manual["$pushId"][".validate"], /<= 50/);
  // vote choice 0..9
  assert.match(
    session.rooms["$roomId"].votes["$voteId"].ballots["$clientId"][".validate"],
    /newData\.child\('choice'\)\.val\(\) <= 9/
  );
});

// =============================================================
// Multi-tenant invariants (/orgs/{slug}/sessions/...)
// =============================================================
//
// The /orgs/ subtree mirrors /sessions/ so a partnership running on its own
// /o/{slug}/ URL gets the same auth + immutability protections. These tests
// keep the mirror honest: every write-capable path under /orgs/ must require
// auth, the slug must be constrained, and write-once / closed-marker guards
// must survive any future rule edit.

test("rules: /orgs subtree exists with $orgSlug wildcard", () => {
  assert.ok(rules.rules.orgs, "/orgs root rule must be defined for multi-tenant support");
  const orgWildcard = rules.rules.orgs["$orgSlug"];
  assert.ok(orgWildcard, "/orgs must use an $orgSlug wildcard");
  assert.ok(orgWildcard.sessions, "/orgs/$orgSlug must contain a sessions subtree");
  assert.ok(orgWildcard.sessions["$sessionId"], "/orgs/$orgSlug/sessions must use a $sessionId wildcard");
});

test("rules: /orgs/$orgSlug slug is constrained to lowercase alphanumeric + hyphens", () => {
  const validate = rules.rules.orgs["$orgSlug"][".validate"];
  assert.strictEqual(typeof validate, "string",
    "/orgs/$orgSlug must constrain the slug via .validate (got: " + JSON.stringify(validate) + ")");
  assert.match(validate, /\$orgSlug\.matches\(\/\^\[a-z0-9-\]\+\$\/\)/,
    "slug must be limited to /^[a-z0-9-]+$/ to prevent path-injection through arbitrary keys");
});

test("rules: every write rule under /orgs/$orgSlug/sessions/* requires auth != null", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const offenders = [];
  for (const entry of walkRules(orgSession, "/orgs/$orgSlug/sessions/$sessionId")) {
    if (entry.key !== ".write") continue;
    if (typeof entry.value !== "string") {
      offenders.push(entry.path + " has non-string .write: " + JSON.stringify(entry.value));
      continue;
    }
    if (!entry.value.includes("auth != null")) {
      offenders.push(entry.path + " .write is missing 'auth != null': " + entry.value);
    }
  }
  assert.deepStrictEqual(offenders, [],
    "Every write path under /orgs/$orgSlug/sessions/* must require an authenticated user. " +
    "Offending rules:\n" + offenders.join("\n"));
});

test("rules: /orgs/$orgSlug/sessions/$sessionId .read requires authentication", () => {
  const readRule = rules.rules.orgs["$orgSlug"].sessions["$sessionId"][".read"];
  assert.strictEqual(typeof readRule, "string",
    "/orgs/$orgSlug/sessions/$sessionId/.read must be a string expression, not a literal");
  assert.ok(readRule.includes("auth != null"),
    "/orgs/$orgSlug/sessions/$sessionId/.read must require auth != null; got: " + readRule);
});

test("rules: /orgs write-once markers stay write-once", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const writeOnceFields = [
    "adminPasswordHash", "created", "workshopLabel", "scenarioId", "scenarioCustomJson"
  ];
  for (const field of writeOnceFields) {
    const rule = orgSession[field][".write"];
    assert.ok(rule.includes("!data.exists()"),
      "/orgs/$orgSlug/sessions/$sessionId/" + field + " should refuse overwrites; got: " + rule);
  }
});

test("rules: /orgs closed-marker is write-once + scoped to its own org+session", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const closedRule = orgSession.closed[".write"];
  assert.ok(closedRule.includes("!data.exists()"),
    "The /orgs closed marker must be write-once; got: " + closedRule);
  // Critical: must reference its OWN org+session, not the legacy /sessions/
  // path. A typo here would let an org tamper with a legacy session's lock.
  assert.ok(closedRule.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId)"),
    "/orgs closed.write must reference the org-scoped session subtree; got: " + closedRule);
});

test("rules: /orgs closed-session guard blocks writes once a session is closed", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const protectedRules = [
    orgSession.pool["$clientId"][".write"],
    orgSession.rooms["$roomId"].stage[".write"],
    orgSession.rooms["$roomId"].teamName[".write"],
    orgSession.rooms["$roomId"].presence["$clientId"][".write"],
    orgSession.rooms["$roomId"].typing["$clientId"][".write"],
    orgSession.rooms["$roomId"].answers.moduleA["$entryId"][".write"],
    orgSession.rooms["$roomId"].answers.moduleB["$entryId"][".write"]
  ];
  for (const rule of protectedRules) {
    assert.ok(rule.includes("'closed'"),
      "Expected a closed-marker guard, got: " + rule);
    assert.ok(rule.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId)"),
      "Closed-guard must reference org-scoped session subtree; got: " + rule);
  }
});

test("rules: legacy /sessions subtree remains intact for back-compat", () => {
  // Multi-tenant is a pure additive change — the existing default-org
  // canamed.web.app/ deployment must keep using /sessions/* unchanged.
  assert.ok(rules.rules.sessions, "/sessions root rule must still exist");
  assert.ok(rules.rules.sessions["$sessionId"], "/sessions/$sessionId must still exist");
  assert.ok(rules.rules.sessions["$sessionId"].adminPasswordHash,
    "/sessions/$sessionId/adminPasswordHash must still exist (back-compat)");
});

// ----------------------------------------------------------------
// orgs.js helpers — exercise the slug parser + prefix builder so a
// regression in the router (e.g. accepting uppercase or path traversal)
// breaks the test suite before it ships.
// ----------------------------------------------------------------

const orgs = require("../docs/Third_session/PBL_platform/orgs.js");

test("orgs: parser extracts /o/{slug}/ from common pathnames", () => {
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o/caen-nagoya/"), "caen-nagoya");
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o/caen-nagoya"), "caen-nagoya");
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o/lyon-tokyo/anything/here"), "lyon-tokyo");
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o/abc123/"), "abc123");
});

test("orgs: parser returns null on missing / malformed prefixes", () => {
  assert.strictEqual(orgs.canamedParseOrgFromPath("/"), null);
  assert.strictEqual(orgs.canamedParseOrgFromPath("/index.html"), null);
  assert.strictEqual(orgs.canamedParseOrgFromPath("/orgs/foo"), null,  // wrong prefix (must be /o/)
    "must reject /orgs/* (correct prefix is /o/)");
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o/FOO/"), null,
    "must reject uppercase slugs (router lower-cases by convention)");
  assert.strictEqual(orgs.canamedParseOrgFromPath("/o//"), null,
    "must reject empty slug");
  assert.strictEqual(orgs.canamedParseOrgFromPath(null), null);
  assert.strictEqual(orgs.canamedParseOrgFromPath(undefined), null);
});

test("orgs: resolver finds caen-nagoya + returns null for unknown slugs", () => {
  const def = orgs.canamedResolveOrg("caen-nagoya");
  assert.ok(def, "default org must be registered in CANAMED_ORGS");
  assert.strictEqual(typeof def.name, "string");
  assert.ok(Array.isArray(def.cohorts) && def.cohorts.length >= 2,
    "default org must declare at least two cohorts");
  assert.strictEqual(orgs.canamedResolveOrg("does-not-exist"), null);
  assert.strictEqual(orgs.canamedResolveOrg(""), null);
  assert.strictEqual(orgs.canamedResolveOrg(null), null);
});

test("orgs: session prefix preserves legacy path for default, namespaces others", () => {
  // BACK-COMPAT INVARIANT: the default org must still write to /sessions/{code}/,
  // so the existing canamed.web.app deployment continues unchanged.
  assert.strictEqual(orgs.canamedSessionPrefix("caen-nagoya"), "sessions/");
  assert.strictEqual(orgs.canamedSessionPrefix(null), "sessions/");
  assert.strictEqual(orgs.canamedSessionPrefix(""), "sessions/");
  // Every other org is namespaced to keep partnerships isolated on the
  // same Firebase database.
  assert.strictEqual(orgs.canamedSessionPrefix("lyon-tokyo"), "orgs/lyon-tokyo/sessions/");
  assert.strictEqual(orgs.canamedSessionPrefix("paris-osaka"), "orgs/paris-osaka/sessions/");
});

// =============================================================
// D21 — super-admin password reset (SIMULATION_EDGE_CASES.md)
// =============================================================
//
// The original adminPasswordHash rule was strict !data.exists(), which
// blocked the super-admin recovery path when a hash already existed.
// The fix gates an overwrite on a fresh _superadminReset flag (±30s of
// server `now`). Tests below pin the rule shape so a future edit can't
// silently drop the gate or widen the window.

test("rules: adminPasswordHash allows overwrite only via fresh _superadminReset", () => {
  const rule = rules.rules.sessions["$sessionId"].adminPasswordHash[".write"];
  // initial set must still work
  assert.ok(rule.includes("!data.exists()"),
    "adminPasswordHash must still allow first write when no hash exists: " + rule);
  // overwrite is gated by the reset-flag sibling
  assert.ok(rule.includes("_superadminReset"),
    "adminPasswordHash overwrite must require _superadminReset flag: " + rule);
  // 30-second freshness window keeps the door from staying open
  assert.ok(rule.includes("now - 30000"),
    "adminPasswordHash overwrite window must be 30s: " + rule);
});

test("rules: _superadminReset itself is freshness-bounded and closed-aware", () => {
  const reset = rules.rules.sessions["$sessionId"]._superadminReset;
  assert.ok(reset, "/sessions/$sessionId/_superadminReset must be defined");
  const w = reset[".write"];
  assert.ok(w.includes("auth != null"),
    "_superadminReset write must require authentication: " + w);
  assert.ok(w.includes("'closed'"),
    "_superadminReset must be refused once the session is closed: " + w);
  // requestedAt must be near server `now` so a stale flag can't reopen the door
  assert.ok(w.includes("now - 5000"),
    "_superadminReset requestedAt freshness lower bound (now - 5000): " + w);
  const v = reset[".validate"];
  assert.ok(v.includes("requestedAt") && v.includes("'by'"),
    "_superadminReset must validate {requestedAt, by} envelope: " + v);
});

test("rules: /orgs adminPasswordHash overwrite goes through _superadminReset too", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const rule = orgSession.adminPasswordHash[".write"];
  assert.ok(rule.includes("!data.exists()"),
    "/orgs adminPasswordHash must still allow first write: " + rule);
  assert.ok(rule.includes("_superadminReset"),
    "/orgs adminPasswordHash overwrite must require _superadminReset: " + rule);
  // org-scoped path - must not accidentally check the legacy /sessions/ subtree
  assert.ok(rule.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId)"),
    "/orgs adminPasswordHash overwrite must reference org-scoped reset flag: " + rule);
});

// =============================================================
// D22 — facilitator presence (SIMULATION_EDGE_CASES.md)
// =============================================================
test("rules: _adminPresence requires admin-set session + closed-aware", () => {
  const presence = rules.rules.sessions["$sessionId"]._adminPresence;
  assert.ok(presence, "/sessions/$sessionId/_adminPresence must be defined");
  const w = presence[".write"];
  assert.ok(w.includes("auth != null"),
    "_adminPresence write must require auth: " + w);
  assert.ok(w.includes("adminPasswordHash"),
    "_adminPresence write must require an admin-set session: " + w);
  assert.ok(w.includes("'closed'"),
    "_adminPresence write must be refused once closed: " + w);
  const v = presence[".validate"];
  assert.ok(v.includes("'by'") && v.includes("'at'"),
    "_adminPresence validate must enforce {by, at} envelope: " + v);
});

test("rules: /orgs _adminPresence mirrors the session-level rule", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const presence = orgSession._adminPresence;
  assert.ok(presence, "/orgs _adminPresence must be defined");
  const w = presence[".write"];
  assert.ok(w.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('adminPasswordHash')"),
    "/orgs _adminPresence must require org-scoped admin password: " + w);
});

// =============================================================
// R2-09 — session .read narrowed to members + carve-outs
// SIMULATION_ROUND2.md (Pierre persona)
// =============================================================
//
// The Round-1 rule was `auth != null` on /sessions/$sessionId, which
// let any anon-authed user crawl /sessions/* — leaking pool PII
// (names + universities), participant answers, callForHelp messages,
// test scores, and audit envelopes. R2-09 narrows the session-level
// .read to "you must be a member of this session" (data.child('members').
// hasChild(auth.uid)). A small set of fields that the app reads BEFORE
// joining (adminPasswordHash for admin login, scenarioId / scenarioCustomJson
// for the lobby's scenario picker, created / workshopLabel / closed) keep
// .read: "auth != null" via per-field overrides so the join flow still
// works.

test("rules: R2-09 /sessions/$sessionId .read is narrowed to membership", () => {
  const r = rules.rules.sessions["$sessionId"][".read"];
  assert.strictEqual(typeof r, "string");
  assert.ok(r.includes("auth != null"),
    "session .read must still require an authenticated user: " + r);
  assert.ok(r.includes("members") && r.includes("hasChild(auth.uid)"),
    "session .read must require membership (data.child('members').hasChild(auth.uid)): " + r);
});

test("rules: R2-09 /orgs/$orgSlug/sessions/$sessionId .read is narrowed to membership", () => {
  const r = rules.rules.orgs["$orgSlug"].sessions["$sessionId"][".read"];
  assert.strictEqual(typeof r, "string");
  assert.ok(r.includes("auth != null"),
    "org session .read must still require an authenticated user: " + r);
  assert.ok(r.includes("members") && r.includes("hasChild(auth.uid)"),
    "org session .read must require membership: " + r);
});

test("rules: R2-09 members/$uid is writable only by the owning auth.uid", () => {
  const member = rules.rules.sessions["$sessionId"].members["$uid"];
  assert.ok(member, "/sessions/$sessionId/members/$uid must be declared");
  const w = member[".write"];
  assert.ok(w.includes("auth != null"),
    "members write must require auth: " + w);
  assert.ok(w.includes("auth.uid == $uid"),
    "members write must be self-scoped (auth.uid == $uid): " + w);
  assert.ok(w.includes("'closed'"),
    "members write must be refused once the session is closed: " + w);
  const v = member[".validate"];
  assert.ok(v.includes("'at'"),
    "members validate must enforce {at} envelope: " + v);
  assert.match(v, /at.*<= now \+ 5000/);
  assert.match(v, /at.*>= now - 120000/);
});

test("rules: R2-09 members/$uid is only readable by the owning auth.uid", () => {
  const member = rules.rules.sessions["$sessionId"].members["$uid"];
  const r = member[".read"];
  assert.strictEqual(typeof r, "string",
    "members/$uid .read must be a string predicate so other users' uids stay hidden");
  assert.ok(r.includes("auth != null") && r.includes("auth.uid == $uid"),
    "members read must be self-scoped: " + r);
  // The parent members subtree must NOT have its own .read — listing the
  // full membership roster would leak the set of joiners' auth uids and
  // defeat the whole point of R2-09.
  assert.strictEqual(rules.rules.sessions["$sessionId"].members[".read"], undefined,
    "/sessions/$sessionId/members must NOT grant a subtree-wide .read");
});

test("rules: R2-09 /orgs members/$uid mirrors the self-scoped read+write", () => {
  const member = rules.rules.orgs["$orgSlug"].sessions["$sessionId"].members["$uid"];
  assert.ok(member, "/orgs/$orgSlug/sessions/$sessionId/members/$uid must be declared");
  assert.ok(member[".read"].includes("auth.uid == $uid"),
    "org members read must be self-scoped: " + member[".read"]);
  const w = member[".write"];
  assert.ok(w.includes("auth.uid == $uid"),
    "org members write must be self-scoped: " + w);
  assert.ok(w.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('closed')"),
    "org members write must be refused once the org-scoped session is closed: " + w);
});

test("rules: R2-09 pre-join carve-outs keep auth-only read on fields the lobby reads", () => {
  // These fields are read BEFORE the user has had a chance to write
  // their members entry (e.g. admin login reads adminPasswordHash to
  // verify the typed password; the lobby reads scenarioId to display
  // the scenario). The session-level .read narrows to membership; each
  // of these fields restores .read: "auth != null" via a per-field
  // override so the join flow doesn't dead-lock.
  const session = rules.rules.sessions["$sessionId"];
  const carveOuts = ["adminPasswordHash", "scenarioId", "scenarioCustomJson",
                     "created", "workshopLabel", "closed"];
  for (const field of carveOuts) {
    const r = session[field][".read"];
    assert.strictEqual(typeof r, "string",
      "/sessions/$sessionId/" + field + " must declare its own .read; got: " + JSON.stringify(r));
    assert.ok(r.includes("auth != null"),
      "/sessions/$sessionId/" + field + " .read must remain auth-only: " + r);
  }
});

test("rules: R2-09 /orgs pre-join carve-outs match the /sessions ones", () => {
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  const carveOuts = ["adminPasswordHash", "scenarioId", "scenarioCustomJson",
                     "created", "workshopLabel", "closed"];
  for (const field of carveOuts) {
    const r = orgSession[field][".read"];
    assert.strictEqual(typeof r, "string",
      "/orgs/$orgSlug/sessions/$sessionId/" + field + " must declare its own .read; got: " + JSON.stringify(r));
    assert.ok(r.includes("auth != null"),
      "/orgs/$orgSlug/sessions/$sessionId/" + field + " .read must remain auth-only: " + r);
  }
});

test("rules: R2-09 sensitive subtrees fall under the narrowed parent read", () => {
  // pool, rooms, audit, _adminPresence, _superadminReset MUST NOT declare
  // their own .read — they inherit the narrowed session-level .read so
  // only members can read them. A future edit accidentally granting a
  // broad .read here would re-open the crawl vulnerability R2-09 fixes.
  const session = rules.rules.sessions["$sessionId"];
  const sensitive = ["pool", "rooms", "_adminPresence", "_superadminReset"];
  for (const field of sensitive) {
    const node = session[field];
    if (!node) continue; // /sessions doesn't carry audit at top level — that's only on /orgs
    assert.strictEqual(node[".read"], undefined,
      "/sessions/$sessionId/" + field + " must NOT declare its own .read; " +
      "the narrowed parent rule should gate it instead. Got: " + JSON.stringify(node[".read"]));
  }
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  for (const field of sensitive.concat(["audit"])) {
    const node = orgSession[field];
    if (!node) continue;
    assert.strictEqual(node[".read"], undefined,
      "/orgs/$orgSlug/sessions/$sessionId/" + field + " must NOT declare its own .read. " +
      "Got: " + JSON.stringify(node[".read"]));
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Sim 2026-05-19 — new schemas added for the 12 recommendations.
// Each test asserts the rule exists + retains the auth + closed-session
// guards that every other write path in /sessions/$sessionId already
// has, so a future edit can't accidentally drop them and re-open the
// session for writes after closure.
// ─────────────────────────────────────────────────────────────────────────

const SESSION = rules.rules.sessions.$sessionId;
const ROOM = SESSION.rooms.$roomId;

test("rules: session-level /poll/$cid requires auth + closed-session guard", () => {
  assert.ok(SESSION.poll, "rules must declare /sessions/$sessionId/poll");
  const node = SESSION.poll.$cid;
  assert.ok(node, "rules must declare /poll/$cid");
  assert.match(node[".write"], /auth != null/, "/poll/$cid must require authentication");
  assert.match(node[".write"], /closed/, "/poll/$cid must refuse writes once the session is closed");
  assert.match(node[".validate"], /hardest/, "/poll/$cid must validate the `hardest` field");
  assert.match(node[".validate"], /feeling/, "/poll/$cid must validate the `feeling` field");
});

test("rules: per-room /observers/$clientId requires auth + closed-session guard", () => {
  assert.ok(ROOM.observers, "rules must declare /rooms/$roomId/observers");
  const node = ROOM.observers.$clientId;
  assert.match(node[".write"], /auth != null/);
  assert.match(node[".write"], /closed/);
});

test("rules: per-room /moduleB/phase is an auth-guarded number 0..5 (synced phase)", () => {
  assert.ok(ROOM.moduleB && ROOM.moduleB.phase, "rules must declare /rooms/$roomId/moduleB/phase");
  const node = ROOM.moduleB.phase;
  assert.match(node[".write"], /auth != null/);
  assert.match(node[".write"], /closed/);
  assert.match(node[".validate"], /isNumber/, "phase must validate as a number");
  assert.match(node[".validate"], /<= 5/, "phase must be capped at 5 (six phases, 0..5)");
});

test("rules: per-room /moduleB/exchangeCursor is an auth-guarded number (Phase-3 cursor)", () => {
  assert.ok(ROOM.moduleB && ROOM.moduleB.exchangeCursor,
    "rules must declare /rooms/$roomId/moduleB/exchangeCursor");
  const node = ROOM.moduleB.exchangeCursor;
  assert.match(node[".write"], /auth != null/);
  assert.match(node[".write"], /closed/);
  assert.match(node[".validate"], /isNumber/);
});

test("rules: per-room /answerReplies/$entryId/$replyId requires auth + 400-char cap", () => {
  assert.ok(ROOM.answerReplies, "rules must declare /rooms/$roomId/answerReplies");
  const node = ROOM.answerReplies.$entryId.$replyId;
  assert.match(node[".write"], /auth != null/);
  assert.match(node[".write"], /closed/);
  assert.match(node[".validate"], /400/, "counter-bullet text must be capped at 400 chars");
  assert.match(node[".validate"], /disagree|support/,
    "counter-bullet stance must be a closed-set string when present");
});

// =============================================================
// Point 4 — append-only answer edit history (research integrity)
// =============================================================
//
// editAnswer used to overwrite `text` in place, losing a point's wording
// history. The fix snapshots each superseded version into an `edits/$editId`
// log under the answer entry (the client uses push() ids, so it is
// append-only by convention). Write authority is INHERITED from the answer
// entry's own `.write` (collaborative: any room participant; refused once
// closed) — an RTDB ancestor write-grant cascades and cannot be revoked at
// the child, so the `edits` node itself only carries a bounding `.validate`.
// These tests pin that the snapshot shape stays bounded so a participant
// can't smuggle an unbounded blob into the answers tree.

const ORG_ANSWERS = rules.rules.orgs.$orgSlug.sessions.$sessionId.rooms.$roomId.answers;

for (const mod of ["moduleA", "moduleB"]) {
  test(`rules: /answers/${mod}/$entryId/edits snapshot shape is bounded`, () => {
    const edits = ROOM.answers[mod].$entryId.edits;
    assert.ok(edits && edits.$editId, `/rooms/$roomId/answers/${mod}/$entryId/edits/$editId must be declared`);
    const v = edits.$editId[".validate"];
    assert.match(v, /child\('text'\)\.val\(\)\.length <= 1000/,
      "superseded text must be capped at 1000 chars: " + v);
    assert.ok(v.includes("'by'") && v.includes("'at'"),
      "edit snapshot must carry {by, at}: " + v);
    // freshness guard so a stale/forged timestamp can't be planted
    assert.match(v, /child\('at'\)\.val\(\) <= now \+ 5000/, "edit `at` must be near server now: " + v);
  });

  test(`rules: /orgs /answers/${mod}/$entryId/edits snapshot shape is bounded`, () => {
    const edits = ORG_ANSWERS[mod].$entryId.edits;
    assert.ok(edits && edits.$editId, `org /answers/${mod}/$entryId/edits/$editId must be declared`);
    const v = edits.$editId[".validate"];
    assert.match(v, /child\('text'\)\.val\(\)\.length <= 1000/, "org edit text must be capped at 1000: " + v);
    assert.ok(v.includes("'by'") && v.includes("'at'"), "org edit snapshot must carry {by, at}: " + v);
  });
}

// =============================================================
// FINDING-01 (ballots) — stableId ownership guard
// SIMULATION_EDGE_CASES.md / CLAUDE.md "Known security follow-ups"
// =============================================================
//
// Ballots are keyed by stableId (script.js castVote/ballotKey), not the
// per-tab clientId, so the original clientMapping ownership guard never
// covered them — any authenticated participant could overwrite a peer's
// ballot to swing a team tally. The fix adds a parallel stableIdMapping
// (stableId -> auth.uid, write-once) and gates ballot writes on ownership
// via *either* mapping (stableId for normal writes, clientId for the
// legacy-cleanup remove path in castVote). A tolerant "unclaimed" branch
// preserves first-write so a brand-new participant's first ballot lands
// even before the binding round-trips.

const ORG_SESSION = rules.rules.orgs.$orgSlug.sessions.$sessionId;
const ORG_ROOM = ORG_SESSION.rooms.$roomId;

test("rules: stableIdMapping/$stableId is write-once and bound to auth.uid", () => {
  const node = SESSION.stableIdMapping && SESSION.stableIdMapping.$stableId;
  assert.ok(node, "/sessions/$sessionId/stableIdMapping/$stableId must be declared");
  assert.ok(node[".write"].includes("auth != null"),
    "stableIdMapping write must require auth: " + node[".write"]);
  assert.ok(node[".write"].includes("!data.exists()"),
    "stableIdMapping must be write-once so a peer can't re-bind a claimed id: " + node[".write"]);
  assert.ok(node[".write"].includes("'closed'"),
    "stableIdMapping write must be refused once the session is closed: " + node[".write"]);
  assert.ok(node[".validate"].includes("newData.val() == auth.uid"),
    "stableIdMapping value must equal the writer's auth.uid: " + node[".validate"]);
  // read is membership-gated, same as clientMapping
  assert.ok(node[".read"].includes("members") && node[".read"].includes("hasChild(auth.uid)"),
    "stableIdMapping read must be membership-gated: " + node[".read"]);
});

test("rules: /orgs stableIdMapping mirrors the session-level rule (org-scoped)", () => {
  const node = ORG_SESSION.stableIdMapping && ORG_SESSION.stableIdMapping.$stableId;
  assert.ok(node, "/orgs/$orgSlug/sessions/$sessionId/stableIdMapping/$stableId must be declared");
  assert.ok(node[".write"].includes("!data.exists()"),
    "org stableIdMapping must be write-once: " + node[".write"]);
  assert.ok(node[".write"].includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('closed')"),
    "org stableIdMapping closed-guard must reference the org-scoped session: " + node[".write"]);
  assert.ok(node[".validate"].includes("newData.val() == auth.uid"),
    "org stableIdMapping value must equal the writer's auth.uid: " + node[".validate"]);
});

test("rules: votes/ballots/$clientId write is ownership-guarded (no more ballot stuffing)", () => {
  const w = ROOM.votes.$voteId.ballots.$clientId[".write"];
  assert.ok(w.includes("auth != null"), "ballot write must require auth: " + w);
  assert.ok(w.includes("'closed'"), "ballot write must keep the closed-session guard: " + w);
  // ownership is enforced via BOTH mappings: stableId (normal key) and
  // clientId (legacy-cleanup remove path).
  assert.ok(w.includes("child('stableIdMapping').child($clientId).val() == auth.uid"),
    "ballot write must accept the stableId owner: " + w);
  assert.ok(w.includes("child('clientMapping').child($clientId).val() == auth.uid"),
    "ballot write must accept the clientId owner (legacy cleanup): " + w);
  // tolerant first-write: an unclaimed key (neither mapping present) is
  // still writable so a brand-new participant's first ballot lands.
  assert.ok(w.includes("!root.child('sessions').child($sessionId).child('stableIdMapping').child($clientId).exists()"),
    "ballot write must allow an unclaimed stableId (first write): " + w);
  assert.ok(w.includes("!root.child('sessions').child($sessionId).child('clientMapping').child($clientId).exists()"),
    "ballot write must allow an unclaimed clientId (first write): " + w);
});

test("rules: /orgs votes/ballots ownership guard is org-scoped", () => {
  const w = ORG_ROOM.votes.$voteId.ballots.$clientId[".write"];
  assert.ok(w.includes("auth != null") && w.includes("'closed'"),
    "org ballot write must keep auth + closed guards: " + w);
  assert.ok(w.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('stableIdMapping').child($clientId).val() == auth.uid"),
    "org ballot write must accept the org-scoped stableId owner: " + w);
  assert.ok(w.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('clientMapping').child($clientId).val() == auth.uid"),
    "org ballot write must accept the org-scoped clientId owner: " + w);
  // must NOT leak into the legacy /sessions/ subtree
  assert.ok(!w.includes("root.child('sessions').child($sessionId).child('stableIdMapping')"),
    "org ballot guard must not reference the legacy /sessions subtree: " + w);
});

// =============================================================
// D21 (hardened) — per-session recovery code gates the password reset
// =============================================================
//
// The original D21 reset only required a fresh _superadminReset flag, which
// ANY authenticated participant could write — so any participant who knew the
// (spoken-aloud) session code could hijack the admin password. The fix adds
// an UNREADABLE top-level /recovery subtree holding a per-session secret,
// written ONCE at creation (before any adminPasswordHash exists), and makes
// both _superadminReset.write require the written `code` to equal
// /recovery/.../code. These tests pin that contract so a future edit can't
// silently drop the recovery binding and re-open the hijack path.

test("rules: /recovery subtree is unreadable at the top level", () => {
  const recovery = rules.rules.recovery;
  assert.ok(recovery && typeof recovery === "object",
    "/recovery top-level rule must be declared");
  assert.strictEqual(recovery[".read"], false,
    "/recovery must be unreadable (.read:false) so no client can fetch a code back");
  assert.strictEqual(recovery[".write"], false,
    "/recovery top-level .write must be denied by default (only the per-session leaf is writable)");
});

test("rules: /recovery/sessions/$sessionId is write-once, pre-password, unreadable, code 8..60", () => {
  const node = rules.rules.recovery.sessions["$sessionId"];
  assert.ok(node, "/recovery/sessions/$sessionId must be declared");
  // unreadable
  assert.strictEqual(node[".read"], false,
    "/recovery/sessions/$sessionId must be unreadable");
  const w = node[".write"];
  assert.ok(w.includes("auth != null"),
    "recovery write must require auth: " + w);
  // write-once: only when the node does not yet exist
  assert.ok(w.includes("!data.exists()"),
    "recovery write must be write-once (!data.exists()): " + w);
  // pre-password binding: only writable while the session has no adminPasswordHash
  assert.ok(w.includes("adminPasswordHash"),
    "recovery write must be gated on the session having no adminPasswordHash yet: " + w);
  assert.ok(w.includes("!root.child('sessions').child($sessionId).child('adminPasswordHash').exists()"),
    "recovery write must reference the matching session's adminPasswordHash: " + w);
  // validate: code is a string of length 8..60
  const v = node[".validate"];
  assert.ok(v.includes("'code'") && v.includes("isString"),
    "recovery validate must require a string `code`: " + v);
  assert.match(v, /length >= 8/, "recovery code must be >= 8 chars: " + v);
  assert.match(v, /length <= 60/, "recovery code must be <= 60 chars: " + v);
});

test("rules: /recovery/orgs/$orgSlug/sessions/$sessionId mirrors the session-scoped recovery rule", () => {
  const orgRecovery = rules.rules.recovery.orgs &&
    rules.rules.recovery.orgs["$orgSlug"] &&
    rules.rules.recovery.orgs["$orgSlug"].sessions &&
    rules.rules.recovery.orgs["$orgSlug"].sessions["$sessionId"];
  assert.ok(orgRecovery, "/recovery/orgs/$orgSlug/sessions/$sessionId must be declared (org mirror)");
  assert.strictEqual(orgRecovery[".read"], false,
    "org recovery node must be unreadable");
  const w = orgRecovery[".write"];
  assert.ok(w.includes("auth != null"), "org recovery write must require auth: " + w);
  assert.ok(w.includes("!data.exists()"), "org recovery write must be write-once: " + w);
  // pre-password binding must reference the ORG-scoped adminPasswordHash, not the legacy one
  assert.ok(w.includes("!root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('adminPasswordHash').exists()"),
    "org recovery write must reference the org-scoped adminPasswordHash: " + w);
  const v = orgRecovery[".validate"];
  assert.ok(v.includes("'code'"), "org recovery validate must require `code`: " + v);
  assert.match(v, /length >= 8/);
  assert.match(v, /length <= 60/);
});

test("rules: /sessions _superadminReset.write requires the recovery code to match", () => {
  const w = rules.rules.sessions["$sessionId"]._superadminReset[".write"];
  // the write must consult the unreadable recovery subtree
  assert.ok(w.includes("root.child('recovery').child('sessions').child($sessionId).child('code')"),
    "_superadminReset write must reference /recovery/sessions/$sessionId/code: " + w);
  // and require the written code to EQUAL the stored recovery code
  assert.ok(w.includes("newData.child('code').val() == root.child('recovery').child('sessions').child($sessionId).child('code').val()"),
    "_superadminReset write must require the submitted code to equal the stored recovery code: " + w);
});

test("rules: /sessions _superadminReset.validate requires a code field (8..60)", () => {
  const v = rules.rules.sessions["$sessionId"]._superadminReset[".validate"];
  assert.ok(v.includes("'code'"), "_superadminReset validate must require a `code` field: " + v);
  assert.ok(v.includes("child('uid').isString()"),
    "_superadminReset validate must require a `uid` field (R3 recovery-race fix): " + v);
  assert.ok(v.includes("hasChildren(['requestedAt','by','code','uid'])"),
    "_superadminReset validate must require {requestedAt, by, code}: " + v);
  assert.match(v, /child\('code'\)\.val\(\)\.length >= 8/,
    "_superadminReset code must be >= 8 chars: " + v);
  assert.match(v, /child\('code'\)\.val\(\)\.length <= 60/,
    "_superadminReset code must be <= 60 chars: " + v);
});

test("rules: /orgs _superadminReset.write requires the org-scoped recovery code to match", () => {
  const w = rules.rules.orgs["$orgSlug"].sessions["$sessionId"]._superadminReset[".write"];
  assert.ok(w.includes("root.child('recovery').child('orgs').child($orgSlug).child('sessions').child($sessionId).child('code')"),
    "/orgs _superadminReset write must reference /recovery/orgs/$orgSlug/sessions/$sessionId/code: " + w);
  assert.ok(w.includes("newData.child('code').val() == root.child('recovery').child('orgs').child($orgSlug).child('sessions').child($sessionId).child('code').val()"),
    "/orgs _superadminReset write must require the submitted code to equal the org-scoped recovery code: " + w);
});

test("rules: /orgs _superadminReset.validate requires a code field (8..60)", () => {
  const v = rules.rules.orgs["$orgSlug"].sessions["$sessionId"]._superadminReset[".validate"];
  assert.ok(v.includes("'code'"), "/orgs _superadminReset validate must require a `code` field: " + v);
  assert.ok(v.includes("child('uid').isString()"),
    "_superadminReset validate must require a `uid` field (R3 recovery-race fix): " + v);
  assert.ok(v.includes("hasChildren(['requestedAt','by','code','uid'])"),
    "/orgs _superadminReset validate must require {requestedAt, by, code}: " + v);
  assert.match(v, /child\('code'\)\.val\(\)\.length >= 8/);
  assert.match(v, /child\('code'\)\.val\(\)\.length <= 60/);
});

test("rules: /recovery is NOT under the readable session subtree (no cascade leak)", () => {
  // The recovery code MUST live OUTSIDE /sessions/$sessionId — the session's
  // .read cascades to members, so storing the code there would leak it to any
  // participant. Guard against a future refactor moving it under the session.
  const session = rules.rules.sessions["$sessionId"];
  assert.strictEqual(session.recovery, undefined,
    "recovery code must NOT live under /sessions/$sessionId (its .read cascades to members)");
  const orgSession = rules.rules.orgs["$orgSlug"].sessions["$sessionId"];
  assert.strictEqual(orgSession.recovery, undefined,
    "recovery code must NOT live under /orgs/$orgSlug/sessions/$sessionId either");
});

// =============================================================
// FINDING-07 — admin password hash oracle (free fix)
// =============================================================
//
// The real PBKDF2 hash now lives in the top-level adminSecrets/<code> tree,
// which has NO read rule (root is .read:false) — so it is unreadable by every
// client, closing the offline brute-force oracle. Login verifies via a
// proof-write: the rule allows a write to proof/<uid> only when the submitted
// candidate equals the stored hash (compared server-side). A non-secret random
// marker stays at sessions/<code>/adminPasswordHash so the existence-based
// admin-gated rules keep working.

test("rules: adminSecrets subtree grants NO read to any client (oracle closed)", () => {
  const node = rules.rules.adminSecrets;
  assert.ok(node, "/adminSecrets must be declared");
  // No .read anywhere on the path → unreadable (root .read is false).
  assert.strictEqual(node[".read"], undefined, "/adminSecrets must not grant .read");
  const code = node.$code;
  assert.ok(code, "/adminSecrets/$code must exist");
  assert.strictEqual(code[".read"], undefined, "/adminSecrets/$code must not grant .read");
  assert.strictEqual(code.hash[".read"], undefined, "/adminSecrets/$code/hash must not grant .read");
  assert.ok(code.proof && code.proof.$uid, "/adminSecrets/$code/proof/$uid must exist");
  assert.strictEqual(code.proof.$uid[".read"], undefined,
    "/adminSecrets/$code/proof/$uid must not grant .read");
});

test("rules: adminSecrets/$code/hash is write-once + _superadminReset-gated + format-validated", () => {
  const h = rules.rules.adminSecrets.$code.hash;
  assert.ok(h[".write"].includes("auth != null"), "hash write must require auth: " + h[".write"]);
  assert.ok(h[".write"].includes("!data.exists()"), "hash must be write-once: " + h[".write"]);
  assert.ok(h[".write"].includes("_superadminReset") && h[".write"].includes("now - 30000"),
    "hash overwrite must be gated by a fresh _superadminReset (30s window): " + h[".write"]);
  // same format guard as the legacy field (PBKDF2 v2$ envelope OR SHA-256 hex)
  assert.match(h[".validate"], /v2\[\$\]\[0-9\]\+\[\$\]\[0-9a-f\]\+/);
  assert.match(h[".validate"], /\[0-9a-f\]\{64\}/);
});

test("rules: adminSecrets/$code/proof/$uid verifies by server-side compare, owner-bound", () => {
  const p = rules.rules.adminSecrets.$code.proof.$uid;
  const w = p[".write"];
  assert.ok(w.includes("auth != null"), "proof write must require auth: " + w);
  assert.ok(w.includes("$uid == auth.uid"), "proof must be owner-bound: " + w);
  assert.ok(w.includes("newData.val() == root.child('adminSecrets').child($code).child('hash').val()"),
    "proof write must compare the candidate to the stored hash server-side: " + w);
});

// =============================================================
// answersDeleted — research-integrity retention of withdrawn points
// =============================================================
//
// deleteAnswer() snapshots a removed point's body into the append-only
// rooms/$roomId/answersDeleted log before hard-removing it from the live
// answers tree (so scoring/render are unaffected, but the text survives for
// analysis). rooms/$roomId carries no blanket .write, so the append-only
// !data.exists() guard here is actually enforced (unlike answers/$entryId/edits,
// whose write authority cascades from the collaborative entry rule).

test("rules: /rooms/$roomId/answersDeleted is append-only + bounded", () => {
  const node = ROOM.answersDeleted && ROOM.answersDeleted.$pushId;
  assert.ok(node, "/rooms/$roomId/answersDeleted/$pushId must be declared");
  const w = node[".write"];
  assert.ok(w.includes("auth != null"), "answersDeleted write must require auth: " + w);
  assert.ok(w.includes("!data.exists()"),
    "answersDeleted must be append-only — a withdrawn point can't be rewritten: " + w);
  assert.ok(w.includes("'closed'"),
    "answersDeleted write must be refused once the session is closed: " + w);
  const v = node[".validate"];
  assert.match(v, /child\('text'\)\.val\(\)\.length <= 1000/, "deleted body capped at 1000: " + v);
  assert.ok(v.includes("'module'") && v.includes("'by'") && v.includes("'at'"),
    "answersDeleted must carry {module, by, at}: " + v);
  assert.match(v, /child\('at'\)\.val\(\) <= now \+ 5000/, "deleted `at` must be near server now: " + v);
});

test("rules: /orgs /rooms/$roomId/answersDeleted mirrors append-only + org-scoped", () => {
  const node = ORG_ROOM.answersDeleted && ORG_ROOM.answersDeleted.$pushId;
  assert.ok(node, "org /rooms/$roomId/answersDeleted/$pushId must be declared");
  const w = node[".write"];
  assert.ok(w.includes("!data.exists()"), "org answersDeleted must be append-only: " + w);
  assert.ok(w.includes("root.child('orgs').child($orgSlug).child('sessions').child($sessionId).child('closed')"),
    "org answersDeleted closed-guard must reference the org-scoped session: " + w);
});

// =============================================================
// Authored scenarios (2026-05-29) — facilitators store scenarios
// they have created in their own /scenarios/$uid subtree, with an
// opt-in /sharedScenarios mirror that other facilitators can read.
// =============================================================

test("rules: /scenarios/$ownerUid is read+write gated by auth.uid == $ownerUid", () => {
  const node = rules.rules.scenarios && rules.rules.scenarios["$ownerUid"];
  assert.ok(node, "/scenarios/$ownerUid must be declared");
  assert.match(node[".read"], /auth\s*!=\s*null/,
    "scenarios read must require an authenticated user");
  assert.match(node[".read"], /auth\.uid\s*==\s*\$ownerUid/,
    "scenarios read must be bound to the owner");
  assert.match(node[".write"], /auth\s*!=\s*null/,
    "scenarios write must require auth");
  assert.match(node[".write"], /auth\.uid\s*==\s*\$ownerUid/,
    "scenarios write must be bound to the owner");
});

test("rules: /scenarios/$ownerUid/$scenarioId enforces shape + size cap", () => {
  const sc = rules.rules.scenarios.$ownerUid.$scenarioId;
  assert.ok(sc, "/scenarios/$ownerUid/$scenarioId must be declared");
  assert.match(sc[".validate"], /\$scenarioId\.matches\(\/\^\[a-z0-9_-\]\{1,60\}\$\/\)/,
    "scenario id must be 1-60 lowercase alphanumerics, _ or -");
  const meta = sc.meta;
  assert.ok(meta && meta[".validate"], "scenarios/$id/meta must validate");
  assert.match(meta[".validate"], /newData\.child\('id'\)\.val\(\) == \$scenarioId/,
    "meta.id must match the path key so list views can index reliably");
  assert.match(meta[".validate"], /newData\.child\('name'\)\.val\(\)\.length <= 200/,
    "meta.name must be capped at 200 chars");
  const body = sc.bodyJson;
  assert.ok(body && body[".validate"], "scenarios/$id/bodyJson must validate");
  assert.match(body[".validate"], /newData\.isString\(\)/,
    "bodyJson is stored as a single JSON string blob");
  assert.match(body[".validate"], /\.length <= 262144/,
    "bodyJson must be capped at 256 KB");
});

test("rules: /sharedScenarios is readable by any signed-in user", () => {
  const node = rules.rules.sharedScenarios;
  assert.ok(node, "/sharedScenarios must be declared");
  assert.match(node[".read"], /auth\s*!=\s*null/,
    "shared scenarios are visible to authenticated users (including anon participants browsing the picker)");
});

test("rules: /sharedScenarios/$shareId restricts writes to the owner", () => {
  const node = rules.rules.sharedScenarios.$shareId;
  assert.ok(node, "/sharedScenarios/$shareId must be declared");
  const w = node[".write"];
  assert.match(w, /auth\s*!=\s*null/, "shared scenario writes require auth");
  // On create: writer's uid must match newData.ownerUid; on update / delete:
  // existing record's ownerUid must match writer's uid. Both conditions
  // appear in the rule.
  assert.match(w, /newData\.child\('ownerUid'\)\.val\(\) == auth\.uid/,
    "shared scenario create must record the writer as the owner");
  assert.match(w, /data\.child\('ownerUid'\)\.val\(\) == auth\.uid/,
    "shared scenario update/delete must require existing-owner == writer");
});

test("rules: /sharedScenarios/$shareId validates shape, ownership immutability, and 256KB cap", () => {
  const v = rules.rules.sharedScenarios.$shareId[".validate"];
  assert.ok(v, "/sharedScenarios/$shareId must declare .validate");
  assert.match(v, /newData\.hasChildren\(\['ownerUid','scenarioId','meta','bodyJson'\]\)/,
    "shared scenario payload must include ownerUid/scenarioId/meta/bodyJson");
  assert.match(v, /newData\.child\('ownerUid'\)\.val\(\) == data\.child\('ownerUid'\)\.val\(\)/,
    "ownerUid must not change between writes (no ownership transfer)");
  assert.match(v, /newData\.child\('bodyJson'\)\.val\(\)\.length <= 262144/,
    "shared bodyJson must be capped at 256 KB just like the private copy");
});

test("rules: session scenarioRef is write-once and validates {ownerUid, scenarioId, source}", () => {
  const node = rules.rules.sessions.$sessionId.scenarioRef;
  assert.ok(node, "/sessions/$sessionId/scenarioRef must be declared");
  assert.ok(node[".write"].includes("!data.exists()"),
    "scenarioRef must be write-once (baked at session create): " + node[".write"]);
  const v = node[".validate"];
  assert.match(v, /newData\.hasChildren\(\['ownerUid','scenarioId','source'\]\)/,
    "scenarioRef must carry ownerUid + scenarioId + source");
  assert.match(v, /newData\.child\('source'\)\.val\(\) == 'private'/,
    "scenarioRef.source must allow 'private'");
  assert.match(v, /newData\.child\('source'\)\.val\(\) == 'shared'/,
    "scenarioRef.source must allow 'shared'");
  // org-scoped mirror must exist too
  const orgNode = rules.rules.orgs.$orgSlug.sessions.$sessionId.scenarioRef;
  assert.ok(orgNode, "/orgs/$orgSlug/sessions/$sessionId/scenarioRef must mirror the legacy path");
});
