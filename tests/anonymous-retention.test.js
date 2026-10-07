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
 *   - deleting on evidence that is merely ABSENT — a missing or garbled date, a
 *     uid that failed to be listed, a response that dropped a field
 *   - a planner bug producing a path that addresses a whole tree
 *   - and the opposite failure, quietly keeping what the policy says goes
 *
 * An independent review of the first version found that two of its predicates
 * failed OPEN: an unreadable last-refresh date was treated as no date at all,
 * and "anonymous" rested on one field being absent with nothing to notice if
 * it were absent for everyone. The tests marked (review) pin those.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  validateWindowDays, isAnonymous, isDated, lastActivityMs, classifyAccounts,
  listingSanity, sparing, historyCandidates, recheck, planDeletion, orphanTripwire,
  assertSafePaths, dropDescendants, chunk,
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, QUIET_MS,
  ORPHAN_FLOOR, UNDATED_FLOOR, DAY_MS
} = require("../scripts/lib/anonymous-retention");

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);            // fixed clock
const WINDOW = DEFAULT_RETENTION_DAYS * DAY_MS;
const OLD = NOW - WINDOW - DAY_MS;                      // safely idle
const FRESH = NOW - WINDOW + DAY_MS;                    // inside the window, but quiet
const TODAY = NOW - 60 * 60 * 1000;                     // used an hour ago

const acct = (uid, last, providers) => ({
  uid, createdMs: last, lastLoginMs: last, lastRefreshMs: last, dateFault: false,
  providers: providers || []
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

test("(review) an account is DATED only with a readable last-refresh date and no fault", () => {
  assert.strictEqual(isDated(acct("a", OLD)), true);
  // no last-refresh date at all: the other two cannot stand in for it
  assert.strictEqual(isDated({ createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null, dateFault: false }), false);
  // a date field was present but garbled
  assert.strictEqual(isDated(Object.assign(acct("a", OLD), { dateFault: true })), false);
  for (const odd of [null, undefined, {}]) assert.strictEqual(isDated(odd), false);
});

test("classify: idle anonymous accounts expire; everything else is kept", () => {
  const cls = classify([
    acct("idle1", OLD), acct("idle2", OLD - 50 * DAY_MS),
    acct("recent", FRESH), acct("today", TODAY)
  ]);
  assert.deepStrictEqual(cls.expired, ["idle1", "idle2"]);
  assert.strictEqual(cls.kept, 2);
  assert.strictEqual(cls.anonymous, 4);
  assert.strictEqual(cls.withRefresh, 4);
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
  assert.strictEqual(cls.quietUids.size, 0);
});

test("classify: one recent date is enough to keep an otherwise ancient account", () => {
  const cls = classify([{
    uid: "returning", createdMs: OLD - 300 * DAY_MS, lastLoginMs: OLD - 300 * DAY_MS,
    lastRefreshMs: FRESH, dateFault: false, providers: []
  }]);
  assert.deepStrictEqual(cls.expired, []);
});

test("(review) classify: a GARBLED last-refresh date keeps the account — it is not read as absent", () => {
  /* The failure the review reproduced. A returning participant: created and
     last signed in long ago, refreshed yesterday, but the refresh date arrived
     in a form the parser rejects. Read as "no date", the two old dates would
     speak for the account and it would expire. */
  const returning = {
    uid: "returning", createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null,
    dateFault: true, providers: []
  };
  const cls = classify([returning]);
  assert.deepStrictEqual(cls.expired, [], "an active account expired on a date it could not read");
  assert.strictEqual(cls.undated, 1);
  assert.strictEqual(cls.kept, 1);
});

test("(review) classify: NO last-refresh date at all also keeps the account", () => {
  const cls = classify([{
    uid: "norefresh", createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null,
    dateFault: false, providers: []
  }]);
  assert.deepStrictEqual(cls.expired, []);
  assert.strictEqual(cls.undated, 1);
  assert.strictEqual(cls.withRefresh, 0);
});

test("classify: an account with no date of any kind is kept and reported", () => {
  const cls = classify([{ uid: "nodate", createdMs: null, lastLoginMs: null,
                          lastRefreshMs: null, dateFault: false, providers: [] }]);
  assert.deepStrictEqual(cls.expired, []);
  assert.strictEqual(cls.undated, 1);
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

test("classify: QUIET means shown idle for a day — today's users and the undated are not", () => {
  const cls = classify([
    acct("idle", OLD), acct("lastweek", NOW - 7 * DAY_MS), acct("edge", NOW - QUIET_MS),
    acct("today", TODAY),
    { uid: "undated", createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null, dateFault: false, providers: [] }
  ]);
  assert.deepStrictEqual([...cls.quietUids].sort(), ["edge", "idle", "lastweek"]);
});

test("classify: empty / missing input is a no-op", () => {
  for (const v of [[], null, undefined]) {
    const cls = classify(v);
    assert.deepStrictEqual(cls.expired, []);
    assert.strictEqual(cls.total, 0);
  }
});

// ── does the listing look like a listing? ───────────────────────────────────

test("(review) sanity: a listing with NO signed-in account is refused", () => {
  /* "Anonymous" is the absence of a provider. If the response dropped the
     provider field for everyone, every account — the facilitators' included —
     would look anonymous, and nothing else here would notice. This project
     has signed-in accounts, so none in the listing means a broken listing. */
  const allLookAnonymous = classify([acct("facilitator", OLD), acct("visitor", OLD)]);
  assert.strictEqual(allLookAnonymous.expired.length, 2, "without the guard both would be deleted");
  const verdict = listingSanity(allLookAnonymous);
  assert.strictEqual(verdict.ok, false);
  assert.match(verdict.error, /no account in the listing has a sign-in provider/);

  assert.strictEqual(listingSanity(classify([acct("v", OLD), acct("f", OLD, ["google.com"])])).ok, true);
});

test("(review) sanity: a listing where NO anonymous account has a refresh date is refused", () => {
  const bare = (uid) => ({ uid, createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null,
                           dateFault: false, providers: [] });
  const cls = classify([bare("a"), bare("b"), acct("f", OLD, ["password"])]);
  const verdict = listingSanity(cls);
  assert.strictEqual(verdict.ok, false);
  assert.match(verdict.error, /last-refresh date/);
});

test("(review) sanity: a few undated accounts are noise; most of them is a format change", () => {
  const named = acct("f", OLD, ["google.com"]);
  const faulty = (i) => Object.assign(acct("bad" + i, OLD), { dateFault: true });
  const good = (i) => acct("ok" + i, OLD);
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  // 3 of 40 unreadable: carry on, they are simply kept
  assert.strictEqual(listingSanity(classify([named, ...many(3, faulty), ...many(37, good)])).ok, true);
  // below the floor even when it is most of a tiny project
  assert.strictEqual(listingSanity(classify([named, ...many(UNDATED_FLOOR, faulty), good(0)])).ok, true);
  // 30 of 40: the dates have stopped parsing
  const verdict = listingSanity(classify([named, ...many(30, faulty), ...many(10, good)]));
  assert.strictEqual(verdict.ok, false);
  assert.match(verdict.error, /30 of 40/);
});

test("sanity: an empty classification is not this function's to refuse", () => {
  assert.strictEqual(listingSanity(classify([])).ok, true);
});

// ── sparing, history, and the re-check ──────────────────────────────────────

test("sparing: takes uids out of `expired`, counts them, and remembers them", () => {
  const cls = classify([acct("a", OLD), acct("b", OLD), acct("c", FRESH)]);
  const out = sparing(cls, ["a", "c"], "contradicted");
  assert.deepStrictEqual(out.expired, ["b"]);
  assert.strictEqual(out.contradicted, 2);
  assert.strictEqual(out.kept, cls.kept + 1, "only the one that was expired moves to kept");
  assert.deepStrictEqual([...out.sparedUids].sort(), ["a", "c"]);
  assert.deepStrictEqual(cls.expired, ["a", "b"], "the input must not be mutated");
});

test("history: only quiet, still-present, un-spared anonymous accounts with a users/ node", () => {
  const base = classify([
    acct("idle", OLD), acct("quiet", FRESH), acct("today", TODAY),
    acct("spared", FRESH), acct("named", FRESH, ["google.com"])
  ]);
  const cls = sparing(base, ["spared"], "contradicted");
  const got = historyCandidates(cls, ["idle", "quiet", "today", "spared", "named", "ghost", "a/b"]);
  /* idle  — being deleted whole, so not a history-only case
     today — used within the day: left alone, its owner may be mid-sign-up
     spared — the database contradicts the listing; nothing of theirs is touched
     named — signed in: that history is theirs and is meant to be there
     ghost — no account: an orphan, a different rule */
  assert.deepStrictEqual(got, ["quiet"]);
});

test("re-check: only what is STILL there, STILL anonymous, STILL dated and STILL idle survives", () => {
  const fresh = [
    acct("same", OLD),
    acct("linked", OLD, ["google.com"]),                              // created an account since
    acct("returned", TODAY),                                          // came back since
    Object.assign(acct("garbled", OLD), { dateFault: true }),         // can no longer be judged
    { uid: "norefresh", createdMs: OLD, lastLoginMs: OLD, lastRefreshMs: null, dateFault: false, providers: [] }
  ];
  const got = recheck(["same", "linked", "returned", "garbled", "norefresh", "vanished"], fresh,
    { nowMs: NOW, idleMs: WINDOW });
  assert.deepStrictEqual(got, { still: ["same"], changed: 4, gone: 1 });
});

test("re-check: the idle bar is the caller's — a day for history, the window for deletion", () => {
  const fresh = [acct("u", FRESH)];           // quiet, but nowhere near 90 days
  assert.deepStrictEqual(recheck(["u"], fresh, { nowMs: NOW, idleMs: QUIET_MS }).still, ["u"]);
  assert.deepStrictEqual(recheck(["u"], fresh, { nowMs: NOW, idleMs: WINDOW }).still, []);
});

test("re-check: an empty or missing fetch spares nobody by accident — everyone is `gone`", () => {
  for (const f of [[], null, undefined]) {
    assert.deepStrictEqual(recheck(["a", "b"], f, { nowMs: NOW, idleMs: WINDOW }),
      { still: [], changed: 0, gone: 2 });
  }
});

// ── what gets deleted ───────────────────────────────────────────────────────

const AUTH = new Set(["gone", "live", "named"]);
const plan = (sets, keysets, opts) => planDeletion(
  Object.assign({ expired: [], history: [], authUids: AUTH }, sets), keysets, opts);

test("plan: an expired account takes its users/ node, and nothing else", () => {
  const p = plan({ expired: ["gone"] }, { users: ["gone"], scenarios: [] });
  assert.deepStrictEqual(p.paths, ["users/gone"]);
  assert.strictEqual(p.expiredPaths, 1);
});

test("plan: only records that EXIST are listed", () => {
  assert.deepStrictEqual(plan({ expired: ["gone"] }, { users: [], scenarios: [] }).paths, []);
});

test("plan: `scenarios/` is NEVER deleted for an account being removed", () => {
  /* The job spares any "anonymous" account that has one, so none should reach
     the planner — and if one did, a scenario is authored work that only a
     signed-in user can save. It is skipped, not trusted. */
  const p = plan({ expired: ["gone"] }, { users: ["gone"], scenarios: ["gone"] });
  assert.deepStrictEqual(p.paths, ["users/gone"]);
  assert.ok(!p.paths.some((x) => x.startsWith("scenarios/")));
});

test("plan: a SIGNED-IN account's records are never touched", () => {
  const p = plan({ expired: ["gone"], history: ["live"] }, { users: ["named"], scenarios: ["named"] });
  assert.deepStrictEqual(p.paths, []);
});

test("plan: a history candidate loses its history, and only that", () => {
  /* #348 stopped the write on 2026-08-25; this removes what it left. Scoped to
     /history so that anything else under the node survives to be looked at. */
  const p = plan({ history: ["live"] }, { users: ["live"], scenarios: [] });
  assert.deepStrictEqual(p.paths, ["users/live/history"]);
  assert.strictEqual(p.historyPaths, 1);
  assert.strictEqual(p.expiredPaths, 0);
});

test("plan: a live account that is NOT a history candidate is left entirely alone", () => {
  const p = plan({}, { users: ["live"], scenarios: [] });
  assert.deepStrictEqual(p.paths, []);
});

test("plan: an ORPHAN is counted and left alone by default", () => {
  /* "Not in the listing" is also what a truncated listing looks like. Acting
     on it by default would delete signed-in users' profiles and scenarios. */
  const p = plan({}, { users: ["ghost"], scenarios: ["ghost"] });
  assert.deepStrictEqual(p.paths, []);
  assert.deepStrictEqual(p.orphans, { users: 1, scenarios: 1 });
  assert.strictEqual(p.orphanPaths, 0);
});

test("plan: orphans go only when an operator asks", () => {
  const p = plan({}, { users: ["ghost"], scenarios: ["ghost"] }, { sweepOrphans: true });
  assert.deepStrictEqual(p.paths.sort(), ["scenarios/ghost", "users/ghost"]);
  assert.strictEqual(p.orphanPaths, 2);
});

test("plan: moderation reports are not this job's to delete", () => {
  /* A report may concern content that is still published and unreviewed.
     Deleting evidence on a timer is a product decision, not a default. */
  const p = plan({ expired: ["gone"] },
    { users: ["gone"], scenarios: [], reports: { shareA: ["gone"] } }, { sweepOrphans: true });
  assert.ok(!p.paths.some((x) => x.startsWith("reports/")));
});

test("plan: malformed keys never become paths", () => {
  const p = plan({ expired: ["gone"] },
    { users: ["", "a b", "x/y", "__proto__/x"], scenarios: [null, 7, "ok.no"] }, { sweepOrphans: true });
  assert.deepStrictEqual(p.paths, []);
  assert.strictEqual(p.skippedKeys, 7);
});

test("plan: missing keysets are a no-op, not a crash", () => {
  for (const ks of [undefined, null, {}]) {
    assert.deepStrictEqual(plan({ expired: ["gone"] }, ks).paths, []);
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
    "rateLimits/uid/AbC123", "rateLimits/uid/AbC123/h489912",
    "rateLimits/session/Room 2 code/d20261007", "rateLimits/uid/__proto__/h1"
  ]);
});

test("safe paths: anything that addresses a tree, or an unknown place, is refused", () => {
  /* The failure this exists for: one of these in an atomic multi-path update
     deletes every profile, or every counter, in a single write. */
  for (const bad of [
    "users", "users/", "scenarios", "rateLimits", "rateLimits/uid", "rateLimits/session",
    "reports", "reports/scenarios", "reports/scenarios/share_1", "reports/scenarios/share_1/AbC123",
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
