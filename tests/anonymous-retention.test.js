"use strict";
/* tests/anonymous-retention.test.js
 *
 * The deletion RULES for anonymous Firebase Auth accounts — issue #347.
 *
 * Every visitor is signed in anonymously, before any consent surface, and
 * nothing ever removed those accounts. This is the job that does, so the tests
 * are organised around the ways it could hurt:
 *
 *   - deleting a SIGNED-IN account (it is only ever meant to see anonymous ones)
 *   - deleting an account someone is still using, or a live session still names
 *   - deleting on the strength of a uid that merely failed to be listed
 *   - a planner bug producing a path that addresses a whole tree
 *   - and the opposite failure, quietly keeping what the policy says goes
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  validateWindowDays, isAnonymous, lastActivityMs, classifyAccounts, planDeletion,
  orphanTripwire, assertSafePaths, dropDescendants, chunk,
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, ORPHAN_FLOOR, DAY_MS
} = require("../scripts/lib/anonymous-retention");

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);            // fixed clock
const WINDOW = DEFAULT_RETENTION_DAYS * DAY_MS;
const OLD = NOW - WINDOW - DAY_MS;                      // safely idle
const FRESH = NOW - WINDOW + DAY_MS;                    // safely inside

const acct = (uid, last, providers) => ({
  uid, createdMs: last, lastLoginMs: last, lastRefreshMs: last, providers: providers || []
});
const classify = (accounts, protectedUids) =>
  classifyAccounts(accounts, { nowMs: NOW, windowMs: WINDOW, protectedUids });

// ── the window ──────────────────────────────────────────────────────────────

test("the default window is the published 90 days, and the ceiling is the same", () => {
  assert.strictEqual(DEFAULT_RETENTION_DAYS, 90);
  assert.strictEqual(MAX_RETENTION_DAYS, DEFAULT_RETENTION_DAYS,
    "a longer window would keep identifiers past what participants are told");
});

test("window: refused below the floor, above the ceiling, and when not a whole number", () => {
  assert.deepStrictEqual(validateWindowDays(90), { ok: true, value: 90 });
  assert.deepStrictEqual(validateWindowDays(MIN_RETENTION_DAYS), { ok: true, value: MIN_RETENTION_DAYS });
  for (const bad of [0, 1, MIN_RETENTION_DAYS - 1, MAX_RETENTION_DAYS + 1, 365, -90,
                     90.5, NaN, Infinity, "90", null, undefined]) {
    assert.strictEqual(validateWindowDays(bad).ok, false, JSON.stringify(bad));
  }
});

// ── who is anonymous, and how idle ──────────────────────────────────────────

test("anonymous means an EMPTY provider list — a missing one is not anonymous", () => {
  assert.strictEqual(isAnonymous({ providers: [] }), true);
  assert.strictEqual(isAnonymous({ providers: ["google.com"] }), false);
  assert.strictEqual(isAnonymous({ providers: ["password"] }), false);
  /* If the shape is not what the lister produces, the account is not shown to
     be anonymous, so it is not treated as one. */
  for (const odd of [{}, { providers: null }, { providers: "none" }, null, undefined]) {
    assert.strictEqual(isAnonymous(odd), false, JSON.stringify(odd));
  }
});

test("last activity is the MOST RECENT of the three dates", () => {
  assert.strictEqual(lastActivityMs({ createdMs: 1, lastLoginMs: 5, lastRefreshMs: 3 }), 5);
  /* A token refresh is the only sign of an active tab that never signs in
     again: the account below was created long ago and is in use today. */
  assert.strictEqual(lastActivityMs({ createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: NOW }), NOW);
  assert.strictEqual(lastActivityMs({ createdMs: null, lastLoginMs: null, lastRefreshMs: null }), null);
  assert.strictEqual(lastActivityMs({ createdMs: "x", lastLoginMs: -1, lastRefreshMs: NaN }), null);
});

test("classify: idle anonymous accounts expire; everything else is kept", () => {
  const cls = classify([
    acct("idle1", OLD), acct("idle2", OLD - 50 * DAY_MS),
    acct("recent", FRESH), acct("today", NOW)
  ]);
  assert.deepStrictEqual(cls.expired, ["idle1", "idle2"]);
  assert.strictEqual(cls.kept, 2);
  assert.strictEqual(cls.anonymous, 4);
});

test("classify: the boundary — idle for exactly the window expires, a millisecond less does not", () => {
  assert.deepStrictEqual(classify([acct("edge", NOW - WINDOW)]).expired, ["edge"]);
  assert.deepStrictEqual(classify([acct("edge", NOW - WINDOW + 1)]).expired, []);
});

test("classify: a SIGNED-IN account never expires, however long it has been idle", () => {
  const ancient = NOW - 5000 * DAY_MS;
  const cls = classify([
    acct("google", ancient, ["google.com"]),
    acct("password", ancient, ["password"]),
    acct("unknown", ancient, ["unknown"]),
    acct("linked", ancient, ["password", "google.com"])
  ]);
  assert.deepStrictEqual(cls.expired, []);
  assert.strictEqual(cls.named, 4);
  assert.strictEqual(cls.anonymous, 0);
  assert.strictEqual(cls.anonymousUids.size, 0);
});

test("classify: one recent date is enough to keep an otherwise ancient account", () => {
  const cls = classify([{
    uid: "returning", createdMs: OLD - 300 * DAY_MS, lastLoginMs: OLD - 300 * DAY_MS,
    lastRefreshMs: FRESH, providers: []
  }]);
  assert.deepStrictEqual(cls.expired, []);
});

test("classify: an account a live session names is kept, and counted as protected", () => {
  const cls = classify([acct("member", OLD), acct("loner", OLD)], new Set(["member"]));
  assert.deepStrictEqual(cls.expired, ["loner"]);
  assert.strictEqual(cls.protected, 1);
  assert.strictEqual(cls.kept, 1);
});

test("classify: protection only matters once idle — a fresh member is just kept", () => {
  const cls = classify([acct("member", FRESH)], new Set(["member"]));
  assert.strictEqual(cls.protected, 0);
  assert.strictEqual(cls.kept, 1);
});

test("classify: an UNDATED account is kept and reported, never treated as ancient", () => {
  /* Over-deletion is not recoverable. An account with no usable date is the
     one understood least; it must not be the one deleted most readily. */
  const cls = classify([{ uid: "nodate", createdMs: null, lastLoginMs: null,
                          lastRefreshMs: null, providers: [] }]);
  assert.deepStrictEqual(cls.expired, []);
  assert.strictEqual(cls.undated, 1);
  assert.strictEqual(cls.kept, 1);
});

test("classify: a uid that could not safely become a path is never expired", () => {
  /* "" would address users/ itself in a multi-path update; "a/b" a child of
     somebody else. Neither may reach the planner. */
  const cls = classify([acct("", OLD), acct("a/b", OLD), acct("a.b", OLD), acct("x".repeat(129), OLD),
                        acct("ok_uid-1", OLD)]);
  assert.deepStrictEqual(cls.expired, ["ok_uid-1"]);
  assert.strictEqual(cls.unusable, 4);
  assert.ok(!cls.anonymousUids.has("a/b"));
});

test("classify: authUids records EVERY listed account, usable or not", () => {
  /* It answers "does this uid have an account?". Leaving out the odd ones
     would make their records look orphaned. */
  const cls = classify([acct("anon", OLD), acct("named", OLD, ["google.com"]), acct("a/b", OLD)]);
  assert.deepStrictEqual([...cls.authUids].sort(), ["a/b", "anon", "named"]);
  assert.strictEqual(cls.total, 3);
});

test("classify: empty / missing input is a no-op", () => {
  for (const v of [[], null, undefined]) {
    const cls = classify(v);
    assert.deepStrictEqual(cls.expired, []);
    assert.strictEqual(cls.total, 0);
  }
});

// ── what gets deleted ───────────────────────────────────────────────────────

const CLS = () => classify([
  acct("gone", OLD), acct("live", FRESH), acct("named", OLD, ["google.com"])
]);

test("plan: an expired account takes every record keyed by it", () => {
  const plan = planDeletion(CLS(), {
    users: ["gone"], scenarios: ["gone"], rateLimitUids: ["gone"],
    reports: { shareA: ["gone"], shareB: ["gone", "named"] }
  });
  assert.deepStrictEqual(plan.paths.sort(), [
    "rateLimits/uid/gone", "reports/scenarios/shareA/gone", "reports/scenarios/shareB/gone",
    "scenarios/gone", "users/gone"
  ]);
  assert.strictEqual(plan.expiredPaths, 5);
});

test("plan: only records that EXIST are listed", () => {
  const plan = planDeletion(CLS(), { users: [], scenarios: [], rateLimitUids: [], reports: {} });
  assert.deepStrictEqual(plan.paths, []);
});

test("plan: a SIGNED-IN account's records are never touched", () => {
  const plan = planDeletion(CLS(), {
    users: ["named"], scenarios: ["named"], rateLimitUids: ["named"], reports: { s: ["named"] }
  });
  assert.deepStrictEqual(plan.paths, []);
  assert.strictEqual(plan.legacyHistory, 0);
});

test("plan: a LIVE anonymous account loses its bug-written history, and only that", () => {
  /* #348 stopped the write on 2026-08-25; this removes what it left. Scoped to
     /history so that anything else found under an anonymous uid survives to be
     looked at rather than being deleted unexamined. */
  const plan = planDeletion(CLS(), {
    users: ["live"], scenarios: ["live"], rateLimitUids: ["live"], reports: { s: ["live"] }
  });
  assert.deepStrictEqual(plan.paths, ["users/live/history"]);
  assert.strictEqual(plan.legacyHistory, 1);
  assert.strictEqual(plan.expiredPaths, 0);
});

test("plan: an ORPHAN is counted and left alone by default", () => {
  /* "Not in the listing" is also what a truncated listing looks like. Acting
     on it by default would delete signed-in users' profiles and scenarios. */
  const plan = planDeletion(CLS(), {
    users: ["ghost"], scenarios: ["ghost"], rateLimitUids: ["ghost"], reports: { s: ["ghost"] }
  });
  assert.deepStrictEqual(plan.paths, []);
  assert.deepStrictEqual(plan.orphans, { users: 1, scenarios: 1, rateLimits: 1, reports: 1 });
  assert.strictEqual(plan.orphanPaths, 0);
});

test("plan: orphans go only when an operator asks", () => {
  const plan = planDeletion(CLS(), {
    users: ["ghost"], scenarios: ["ghost"], rateLimitUids: [], reports: { s: ["ghost"] }
  }, { sweepOrphans: true });
  assert.deepStrictEqual(plan.paths.sort(),
    ["reports/scenarios/s/ghost", "scenarios/ghost", "users/ghost"]);
  assert.strictEqual(plan.orphanPaths, 3);
});

test("plan: malformed keys never become paths", () => {
  const plan = planDeletion(CLS(), {
    users: ["", "a b", "x/y"], scenarios: [null, 7],
    rateLimitUids: ["ok.no"], reports: { "bad share": ["gone"], "also/bad": ["gone"] }
  }, { sweepOrphans: true });
  assert.deepStrictEqual(plan.paths, []);
  assert.strictEqual(plan.skippedKeys, 8);
});

test("plan: missing keysets are a no-op, not a crash", () => {
  for (const ks of [undefined, null, {}, { reports: null }]) {
    assert.deepStrictEqual(planDeletion(CLS(), ks).paths, []);
  }
});

// ── the orphan tripwire ─────────────────────────────────────────────────────

test("tripwire: a handful of orphans is plausible; a crowd means the listing is short", () => {
  assert.strictEqual(orphanTripwire(0, 5).ok, true);
  assert.strictEqual(orphanTripwire(ORPHAN_FLOOR, 5).ok, true);
  assert.strictEqual(orphanTripwire(ORPHAN_FLOOR + 1, 5).ok, false);
  // scales with the project, so a large one is not blocked by a fixed floor
  assert.strictEqual(orphanTripwire(150, 1000).ok, true);
  assert.strictEqual(orphanTripwire(201, 1000).ok, false);
  assert.match(orphanTripwire(500, 20).error, /incomplete account listing/);
});

// ── the last check before a write ───────────────────────────────────────────

test("safe paths: every shape the job is allowed to delete passes", () => {
  assertSafePaths([
    "users/AbC123", "users/AbC123/history", "scenarios/AbC123",
    "rateLimits/uid/AbC123", "rateLimits/uid/AbC123/h489912", "rateLimits/session/Room 2 code/d20261007",
    "reports/scenarios/share_1/AbC123"
  ]);
});

test("safe paths: anything that addresses a tree, or an unknown place, is refused", () => {
  /* The failure this exists for: one of these in an atomic multi-path update
     deletes every profile, or every counter, in a single write. */
  for (const bad of [
    "users", "users/", "scenarios", "rateLimits", "rateLimits/uid", "rateLimits/session",
    "reports", "reports/scenarios", "reports/scenarios/share_1",
    "users/a/profile", "users/a/history/CODE", "users/a/b/c",
    "sessions/ABC", "sessions/ABC/members/u", "adminSecrets/ABC", "credentials/x",
    "rateLimits/global/d20261007", "rateLimits/uid/a/b/c", "users/a b", "users/a.b",
    "/users/a", "users//history", "", null, undefined, 7
  ]) {
    assert.throws(() => assertSafePaths([bad]), /unrecognised shape/, JSON.stringify(bad));
  }
});

test("safe paths: the refusal never repeats the path", () => {
  assert.throws(() => assertSafePaths(["sessions/SECRETCODE/members/someuid"]), (e) =>
    !e.message.includes("SECRETCODE") && !e.message.includes("someuid"));
});

test("dropDescendants: a node and something beneath it cannot share one update", () => {
  assert.deepStrictEqual(
    dropDescendants(["rateLimits/uid/a/h1", "rateLimits/uid/a", "rateLimits/uid/a/d20261007"]),
    ["rateLimits/uid/a"]);
  assert.deepStrictEqual(dropDescendants(["users/a", "users/a"]), ["users/a"]);
});

test("dropDescendants: is not fooled by a sibling that sorts in between", () => {
  /* "a/b-c" sorts between "a/b" and "a/b/d". A neighbour comparison on the
     sorted list would keep the descendant and RTDB would reject the update. */
  assert.deepStrictEqual(dropDescendants(["a/b/d", "a/b-c", "a/b"]), ["a/b", "a/b-c"]);
  // a shared PREFIX is not an ancestor
  assert.deepStrictEqual(dropDescendants(["users/ab", "users/a"]), ["users/a", "users/ab"]);
});

test("chunk: splits without losing or repeating anything", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunk([], 3), []);
});
