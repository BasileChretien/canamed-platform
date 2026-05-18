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
