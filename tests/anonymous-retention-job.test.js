"use strict";
/* tests/anonymous-retention-job.test.js
 *
 * The anonymous-account retention job (issue #347), run end to end against
 * fakes. The rules are tested in anonymous-retention.test.js; this is what is
 * actually READ and WRITTEN, which is where the expensive mistakes live:
 *
 *   - an account deleted before, or without, its records
 *   - an account a live session still names being removed anyway
 *   - an account that CHANGED between the listing and the delete
 *   - a dry run that writes, or a refusal that writes first
 *   - one participant being able to stop the job for everyone
 *   - a uid or a session code reaching the job's (world-readable) output
 *
 * The tests marked (review) exist because an independent review of the first
 * version found the failure they describe. The last section pins the workflow,
 * because the one thing a unit test of the script cannot see is whether the job
 * is scheduled, armed, and quiet.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { runAnonymousRetention, UPDATE_CHUNK } = require("../scripts/lib/anonymous-retention-job");
const {
  exitCodeFor, formatReport, formatSweepOnly
} = require("../scripts/lib/anonymous-retention-report");
const { DEFAULT_RETENTION_DAYS, DAY_MS } = require("../scripts/lib/anonymous-retention");
const { HOUR_MS } = require("../scripts/lib/rate-limit-retention");
const { dayKey } = require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers");

const ROOT = path.join(__dirname, "..");
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const WINDOW = DEFAULT_RETENTION_DAYS * DAY_MS;
const OLD = NOW - WINDOW - DAY_MS;            // idle past the window
const QUIET = NOW - 2 * DAY_MS;               // quiet for a day, nowhere near the window
const TODAY = NOW - HOUR_MS;                  // used an hour ago
const OLD_HOUR = "h" + Math.floor(OLD / HOUR_MS);
const NOW_DAY = "d" + dayKey(NOW);

const acct = (uid, last, providers) => ({
  uid, createdMs: last, lastLoginMs: last, lastRefreshMs: last, dateFault: false,
  providers: providers || []
});

/* One world, used by most tests. Shallow nodes are what a `shallow` read
   returns: an object of keys. */
function world(overrides) {
  return Object.assign({
    accounts: [
      acct("idleAnon", OLD),               // the one that goes
      acct("idleMember", OLD), acct("idleCreator", OLD), acct("idleAllowed", OLD),
      acct("idleModerator", OLD), acct("idleOrgMember", OLD),   // idle, but still referred to
      acct("quietAnon", QUIET),            // stays; loses its bug-written history
      acct("todayAnon", TODAY),            // used today: left entirely alone
      acct("scenAnon", OLD),               // "anonymous", yet has authored scenarios
      acct("profileAnon", OLD),            // "anonymous", yet has a profile
      acct("namedOld", OLD, ["google.com"]), acct("namedFresh", TODAY, ["password"])
    ],
    shallow: {
      "sessions": { "CODE1": true, "My Code": true },
      "orgs": { "partner": true },
      "orgs/partner/sessions": { "ORG9": true },
      "sessions/CODE1/members": { idleMember: true, todayAnon: true },
      "sessions/My%20Code/members": null,
      "orgs/partner/sessions/ORG9/members": { idleOrgMember: true },
      "facilitatorGate/allow": { idleAllowed: true },
      "moderators": { idleModerator: true },
      "users": { idleAnon: true, quietAnon: true, todayAnon: true, profileAnon: true, namedOld: true },
      "scenarios": { scenAnon: true, namedOld: true },
      "users/idleAnon": { history: true },
      "users/quietAnon": { history: true },
      "users/profileAnon": { profile: true, history: true },
      "rateLimits/uid": { idleAnon: true, quietAnon: true },
      "rateLimits/session": { CODE1: true },
      "rateLimits/uid/idleAnon": { [OLD_HOUR]: true },
      "rateLimits/uid/quietAnon": { [OLD_HOUR]: true, [NOW_DAY]: true },
      "rateLimits/session/CODE1": { [OLD_HOUR]: true }
    },
    values: {
      "sessions/CODE1/creatorUid": "idleCreator",
      "sessions/My%20Code/creatorUid": null,
      "orgs/partner/sessions/ORG9/creatorUid": "namedFresh"
    }
  }, overrides || {});
}

function harness(w, opts) {
  const o = opts || {};
  const log = [];
  const failing = [].concat(o.failRead || []);
  const deps = {
    listAccounts: async () => {
      log.push({ op: "list" });
      if (o.listThrows) throw new Error(o.listThrows);
      return w.accounts;
    },
    lookupAccounts: async (uids) => {
      log.push({ op: "lookup", uids: [...uids] });
      if (o.lookupThrows) throw new Error(o.lookupThrows);
      const now = o.fresh || w.accounts;
      return now.filter((a) => uids.includes(a.uid));
    },
    deleteAccounts: async (uids) => {
      log.push({ op: "deleteAccounts", uids: [...uids] });
      return o.deleteResult || { deleted: uids.length, failed: 0, httpStatuses: [], networkErrors: 0 };
    },
    fetchShallow: async (p) => {
      log.push({ op: "shallow", path: p });
      if (failing.includes(p)) { const e = new Error("boom at " + p); e.code = "HTTP_500"; throw e; }
      if (!(p in w.shallow)) throw new Error("test world has no shallow node " + p);
      return w.shallow[p];
    },
    readValue: async (p) => {
      log.push({ op: "value", path: p });
      if (!(p in w.values)) throw new Error("test world has no value node " + p);
      return w.values[p];
    },
    updateRoot: async (update) => {
      const n = log.filter((l) => l.op === "update").length;
      log.push({ op: "update", update });
      if (o.failUpdate === true || o.failUpdate === n) {
        const e = new Error("denied"); e.code = "PERMISSION_DENIED"; throw e;
      }
    }
  };
  const run = (extra) => runAnonymousRetention(deps, Object.assign(
    { nowMs: NOW, windowMs: WINDOW, confirm: false, sweepOrphans: false }, extra || {}));
  const updates = () => log.filter((l) => l.op === "update").map((l) => l.update);
  const writtenPaths = () => updates().flatMap((u) => Object.keys(u)).sort();
  const deletedUids = () => log.filter((l) => l.op === "deleteAccounts").flatMap((l) => l.uids);
  const ops = () => log.map((l) => l.op);
  return { deps, log, run, updates, writtenPaths, deletedUids, ops };
}

const EXPECTED_PATHS = [
  "rateLimits/session/CODE1/" + OLD_HOUR,
  "rateLimits/uid/idleAnon/" + OLD_HOUR,
  "rateLimits/uid/quietAnon/" + OLD_HOUR,
  "users/idleAnon",
  "users/quietAnon/history"                  // bug-written history of an account that stays
];
const mentions = (paths, uid) => paths.filter((p) => p.split("/").includes(uid));

// ── dry run ─────────────────────────────────────────────────────────────────

test("dry run: counts everything, writes NOTHING, deletes no account", async () => {
  const h = harness(world());
  const r = await h.run();
  assert.deepStrictEqual(h.updates(), [], "a dry run must not write");
  assert.deepStrictEqual(h.deletedUids(), [], "a dry run must not delete an account");
  assert.strictEqual(r.paths, EXPECTED_PATHS.length);
  assert.deepStrictEqual(r.accounts, {
    total: 12, named: 2, anonymous: 10, expired: 1, kept: 9, protected: 5,
    undated: 0, unusable: 0, contradicted: 2, recheckChanged: 0, recheckGone: 0
  });
  assert.deepStrictEqual(r.records, {
    expiredPaths: 1, historyPaths: 1, orphans: { users: 0, scenarios: 0 },
    orphanPaths: 0, skippedKeys: 0, readErrors: 0
  });
  assert.deepStrictEqual(r.rateLimits,
    { staleUid: 2, staleSession: 1, kept: 1, unparsed: 0, readErrors: 0, unread: 0, unwritten: 0 });
  assert.strictEqual(r.sessions, 3);
});

test("dry run: still makes the re-check, so a dry run exercises every read a live run makes", async () => {
  /* The first dispatch against production is a dry run, and it is the only
     evidence anyone will have before arming the job. It has to fail if the
     re-check endpoint would. */
  const h = harness(world());
  await h.run();
  assert.deepStrictEqual(h.log.find((l) => l.op === "lookup").uids.sort(), ["idleAnon", "quietAnon"]);
});

// ── live run ────────────────────────────────────────────────────────────────

test("live: deletes exactly the planned paths, then exactly the idle account", async () => {
  const h = harness(world());
  const r = await h.run({ confirm: true });

  assert.deepStrictEqual(h.writtenPaths(), EXPECTED_PATHS);
  for (const u of h.updates()) for (const v of Object.values(u)) assert.strictEqual(v, null);

  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"]);
  assert.deepStrictEqual(r.written, { paths: EXPECTED_PATHS.length, failedUpdates: 0, errorCodes: [] });
  assert.deepStrictEqual(r.auth,
    { deleted: 1, failed: 0, httpStatuses: [], networkErrors: 0, skipped: false });
});

test("live: the ORDER — record keys, then the listing, then the re-check, records, account", async () => {
  const h = harness(world());
  await h.run({ confirm: true });
  const ops = h.ops();
  const first = (op) => ops.indexOf(op), last = (op) => ops.lastIndexOf(op);
  /* (review) An orphan is "a key with no account". If the listing were taken
     first, someone who signed up in between would have a key and no place in
     it — and an orphan sweep would delete a brand-new user's data. */
  const usersKeys = h.log.findIndex((l) => l.op === "shallow" && l.path === "users");
  assert.ok(usersKeys !== -1 && usersKeys < first("list"), "record keys must be read before the listing");
  /* The counters are a phase of their own and go FIRST: before the listing is
     even asked for, so that nothing the account half does can hold them up. */
  const isCounters = (l) => l.op === "update" &&
    Object.keys(l.update).every((p) => p.startsWith("rateLimits/"));
  const isRecords = (l) => l.op === "update" &&
    Object.keys(l.update).some((p) => p.startsWith("users/"));
  const counters = h.log.findIndex(isCounters), records = h.log.findIndex(isRecords);
  assert.ok(counters !== -1 && counters < first("list"),
    "the counter sweep must be written before the account listing is requested");
  /* The re-check has to be the last thing before the account's records go: it
     is only worth anything if nothing slow happens after it. */
  assert.ok(first("lookup") > first("list"));
  assert.ok(records !== -1 && first("lookup") < records);
  assert.ok(Math.max(last("shallow"), last("value")) < first("lookup"),
    "a database read happens AFTER the re-check, widening the gap it exists to close");
  /* If the account went first and the write then failed, the records would sit
     under a uid no listing returns — unreachable by every later run. */
  assert.ok(records < first("deleteAccounts"));
});

test("live: a SIGNED-IN account and its records are never touched", async () => {
  /* namedOld is idle past the window, has a users/ node AND authored
     scenarios, and no session refers to it — so nothing but its provider
     stands between it and deletion. */
  const h = harness(world());
  await h.run({ confirm: true });
  assert.ok(!h.deletedUids().includes("namedOld"));
  assert.deepStrictEqual(mentions(h.writtenPaths(), "namedOld"), []);
  assert.ok(!h.log.some((l) => l.op === "lookup" && l.uids.includes("namedOld")));
});

test("live: nobody a LIVE session names is removed, however idle", async () => {
  /* A session closed on its 89th day lives another 30. An account idle for 90
     days can therefore still be a member of something that exists. */
  const h = harness(world());
  await h.run({ confirm: true });
  for (const uid of ["idleMember", "idleOrgMember", "idleCreator", "idleAllowed", "idleModerator"]) {
    assert.ok(!h.deletedUids().includes(uid), uid + " is still referenced and must survive");
  }
});

test("live: once its session is gone, the same idle member does expire", async () => {
  /* The positive control for the test above: the protection comes from the
     session, not from something about the account. */
  const w = world();
  w.shallow["sessions/CODE1/members"] = { todayAnon: true };
  const h = harness(w);
  await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids().sort(), ["idleAnon", "idleMember"]);
});

test("live: an account used TODAY is left entirely alone, history included", async () => {
  const h = harness(world());
  await h.run({ confirm: true });
  assert.deepStrictEqual(mentions(h.writtenPaths(), "todayAnon"), []);
  assert.ok(!h.log.some((l) => l.op === "shallow" && l.path === "users/todayAnon"),
    "there is nothing to corroborate for an account this run will not act on");
});

// ── (review) the database contradicts the listing ───────────────────────────

test("(review) an 'anonymous' account with a PROFILE or SCENARIOS is spared, records and all", async () => {
  /* The client writes users/<uid>/profile and scenarios/<uid> only for a
     signed-in user. If the listing says anonymous and the database says
     otherwise, the listing is not believed — this is the corroboration that
     catches a provider field missing from one account's record. */
  const h = harness(world());
  const r = await h.run({ confirm: true });
  for (const uid of ["scenAnon", "profileAnon"]) {
    assert.ok(!h.deletedUids().includes(uid), uid + " was deleted against the database's evidence");
    assert.deepStrictEqual(mentions(h.writtenPaths(), uid), [], uid + "'s records were touched");
  }
  assert.strictEqual(r.accounts.contradicted, 2);
});

test("(review) without that evidence the same accounts do expire", async () => {
  // Positive control: it is the profile and the scenarios that spared them.
  const w = world();
  w.shallow["scenarios"] = { namedOld: true };
  w.shallow["users/profileAnon"] = { history: true };
  const h = harness(w);
  await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids().sort(), ["idleAnon", "profileAnon", "scenAnon"]);
});

test("(review) a users/ node that is not a node, or cannot be read, spares its account", async () => {
  /* The owner can write there, so neither may stop the run — one participant
     could otherwise halt retention for everyone. */
  const w = world();
  w.shallow["users/idleAnon"] = 7;                       // a primitive where a node belongs
  const h = harness(w, { failRead: "users/quietAnon" });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), []);
  assert.deepStrictEqual(mentions(h.writtenPaths(), "idleAnon").filter((p) => p.startsWith("users/")), []);
  assert.deepStrictEqual(mentions(h.writtenPaths(), "quietAnon").filter((p) => p.startsWith("users/")), []);
  assert.strictEqual(r.records.readErrors, 1);
  assert.strictEqual(exitCodeFor(r), 1, "a read that had to be skipped is not a clean run");
});

// ── (review) the re-check ───────────────────────────────────────────────────

test("(review) an account that CREATED AN ACCOUNT since the listing is not deleted", async () => {
  /* The listing is minutes old by the time anything is written. Someone idle
     for 90 days who returns and signs in with Google in that gap is, by the
     listing, still an expired anonymous account. */
  const w = world();
  const fresh = w.accounts.map((a) => (a.uid === "idleAnon" ? acct("idleAnon", OLD, ["google.com"]) : a));
  const h = harness(w, { fresh });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), []);
  assert.deepStrictEqual(mentions(h.writtenPaths(), "idleAnon").filter((p) => p.startsWith("users/")), []);
  assert.strictEqual(r.accounts.recheckChanged, 1);
  assert.strictEqual(r.accounts.expired, 0);
});

test("(review) an account that simply CAME BACK since the listing is not deleted", async () => {
  const w = world();
  const fresh = w.accounts.map((a) => (a.uid === "idleAnon" ? acct("idleAnon", TODAY) : a));
  const h = harness(w, { fresh });
  await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), []);
});

test("(review) history is not removed from an account that signed in since the listing", async () => {
  /* The other half of the same race: for a signed-in user, users/<uid>/history
     is real and is theirs. */
  const w = world();
  const fresh = w.accounts.map((a) => (a.uid === "quietAnon" ? acct("quietAnon", QUIET, ["password"]) : a));
  const h = harness(w, { fresh });
  await h.run({ confirm: true });
  assert.ok(!h.writtenPaths().includes("users/quietAnon/history"));
  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"], "the unrelated idle account still goes");
});

test("(review) an account that no longer exists at the re-check is not acted on", async () => {
  const w = world();
  const h = harness(w, { fresh: w.accounts.filter((a) => a.uid !== "idleAnon") });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), []);
  assert.strictEqual(r.accounts.recheckGone, 1);
});

test("(review) a re-check that FAILS stops the run with nothing written", async () => {
  const h = harness(world(), { lookupThrows: "account re-check failed: HTTP 503" });
  await assert.rejects(h.run({ confirm: true }), /HTTP 503/);
  assert.deepStrictEqual(h.writtenPaths().filter((p) => !p.startsWith("rateLimits/")), []);
  assert.deepStrictEqual(h.deletedUids(), []);
});

// ── failures ────────────────────────────────────────────────────────────────

test("live: a failed database write means NO account is deleted", async () => {
  const h = harness(world(), { failUpdate: true });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), [], "an account must not outlive its records' deletion failing");
  assert.strictEqual(r.auth.skipped, true);
  assert.strictEqual(r.written.failedUpdates, 2, "the counter update and the record update");
  assert.deepStrictEqual(r.written.errorCodes, ["PERMISSION_DENIED"]);
  assert.strictEqual(r.written.paths, 0);
  assert.strictEqual(exitCodeFor(r), 1);
});

test("live: a partly failed account deletion is reported, not hidden", async () => {
  const h = harness(world(),
    { deleteResult: { deleted: 0, failed: 1, httpStatuses: [403], networkErrors: 0 } });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(r.auth,
    { deleted: 0, failed: 1, httpStatuses: [403], networkErrors: 0, skipped: false });
  assert.strictEqual(exitCodeFor(r), 1);
});

test("live: with nothing idle, no account call is made at all", async () => {
  const w = world();
  w.accounts = w.accounts.filter((a) => a.uid !== "idleAnon");
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.ok(!h.ops().includes("deleteAccounts"));
  assert.strictEqual(r.auth.skipped, false);
  assert.strictEqual(exitCodeFor(r), 0);
});

/* A world with enough idle accounts to need more than one update. */
function bulkWorld(extra) {
  const many = Array.from({ length: UPDATE_CHUNK + 25 }, (_, i) => "bulk" + i);
  const nodes = Object.fromEntries(many.map((u) => ["users/" + u, { history: true }]));
  return {
    many,
    w: {
      accounts: many.map((u) => acct(u, OLD)).concat([acct("named", OLD, ["google.com"])]),
      shallow: Object.assign({
        "sessions": null, "orgs": null, "facilitatorGate/allow": null, "moderators": null,
        "users": Object.fromEntries(many.map((u) => [u, true])),
        "scenarios": null, "rateLimits/uid": null, "rateLimits/session": null
      }, nodes, extra || {}),
      values: {}
    }
  };
}

test("live: large plans are split, and every chunk is still all-null", async () => {
  const { many, w } = bulkWorld();
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.strictEqual(h.updates().length, 2);
  assert.ok(h.updates().every((u) => Object.keys(u).length <= UPDATE_CHUNK));
  assert.ok(h.updates().every((u) => Object.values(u).every((v) => v === null)));
  assert.strictEqual(h.writtenPaths().length, many.length);
  assert.strictEqual(r.written.paths, many.length);
  assert.strictEqual(h.deletedUids().length, many.length);
});

test("(review) live: ONE failed chunk among several still means no account is deleted", async () => {
  /* Which accounts' records were in the failed chunk is not tracked, so none
     may go: the next run rediscovers every one of them. */
  const { w } = bulkWorld();
  const h = harness(w, { failUpdate: 1 });           // the second update fails
  const r = await h.run({ confirm: true });
  assert.strictEqual(h.updates().length, 2, "the first failure must not stop the later chunks");
  assert.strictEqual(r.written.failedUpdates, 1);
  assert.strictEqual(r.written.paths, UPDATE_CHUNK);
  assert.deepStrictEqual(h.deletedUids(), []);
  assert.strictEqual(r.auth.skipped, true);
});

// ── refusals: nothing may be written first ──────────────────────────────────

/* The counter sweep is a phase of its own that runs first and needs nothing
   from the account half, so a refusal there may come AFTER the counters were
   written. What must never have happened is anything to an account or to a
   user record. */
const neverActed = (h) => {
  assert.deepStrictEqual(h.writtenPaths().filter((p) => !p.startsWith("rateLimits/")), []);
  assert.deepStrictEqual(h.deletedUids(), []);
};
const COUNTER_PATHS = EXPECTED_PATHS.filter((p) => p.startsWith("rateLimits/"));

test("an EMPTY account listing is refused", async () => {
  /* Every visitor gets an account, so "no accounts" is a broken listing — and
     with an empty list every record in the database looks orphaned. */
  const h = harness(world({ accounts: [] }));
  await assert.rejects(h.run({ confirm: true, sweepOrphans: true }), (e) => e.refusal === true);
  neverActed(h);
  assert.ok(!h.ops().includes("lookup"));
});

test("a FAILED account listing stops the run with nothing written", async () => {
  const h = harness(world(), { listThrows: "account listing failed: HTTP 403" });
  await assert.rejects(h.run({ confirm: true }), /HTTP 403/);
  neverActed(h);
});

test("(review) a listing with no signed-in account is REFUSED before anything is deleted", async () => {
  /* What a response missing the provider field would look like: the
     facilitators' accounts indistinguishable from visitors'. */
  const w = world();
  w.accounts = w.accounts.map((a) => Object.assign({}, a, { providers: [] }));
  const h = harness(w);
  await assert.rejects(h.run({ confirm: true }),
    (e) => e.refusal === true && /sign-in provider/.test(e.message));
  neverActed(h);
});

test("(review) a listing whose anonymous accounts carry no refresh date is REFUSED", async () => {
  const w = world();
  w.accounts = w.accounts.map((a) =>
    (a.providers.length ? a : Object.assign({}, a, { lastRefreshMs: null })));
  const h = harness(w);
  await assert.rejects(h.run({ confirm: true }),
    (e) => e.refusal === true && /last-refresh date/.test(e.message));
  neverActed(h);
});

test("orphans: reported by default, and their records left in place", async () => {
  const w = world();
  w.shallow["users"] = Object.assign({ ghost: true }, w.shallow["users"]);
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.strictEqual(r.records.orphans.users, 1);
  assert.strictEqual(r.records.orphanPaths, 0);
  assert.deepStrictEqual(mentions(h.writtenPaths(), "ghost"), []);
});

test("orphans: an implausible number REFUSES the run before any write", async () => {
  const w = world();
  w.shallow["users"] = Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["ghost" + i, true]));
  const h = harness(w);
  await assert.rejects(h.run({ confirm: true, sweepOrphans: true }),
    (e) => e.refusal === true && /incomplete account listing/.test(e.message));
  neverActed(h);
});

test("orphans: a plausible number is removed when asked", async () => {
  const w = world();
  w.shallow["scenarios"] = Object.assign({ ghost: true }, w.shallow["scenarios"]);
  const h = harness(w);
  const r = await h.run({ confirm: true, sweepOrphans: true });
  assert.ok(h.writtenPaths().includes("scenarios/ghost"));
  assert.strictEqual(r.records.orphanPaths, 1);
  assert.ok(!h.deletedUids().includes("ghost"), "an orphan has no account to delete");
});

// ── (review) neither half may be able to stop the other ─────────────────────

test("(review) the counters are swept even when the account half REFUSES", async () => {
  /* The notice promises the counters gone within about three days. If that hung
     on the account half, every refused listing — and there are three ways to
     refuse one — would quietly break a published period. */
  const w = world();
  w.accounts = w.accounts.map((a) => Object.assign({}, a, { providers: [] }));
  const h = harness(w);
  const err = await h.run({ confirm: true }).then(() => null, (e) => e);
  assert.ok(err && err.refusal === true);
  assert.deepStrictEqual(h.writtenPaths(), COUNTER_PATHS);
  /* ...and whoever reports the refusal can say what was done. Counts only. */
  assert.strictEqual(err.rateLimits.staleUid, 2);
  assert.strictEqual(err.rateLimits.staleSession, 1);
  assert.strictEqual(err.rateLimits.written.paths, COUNTER_PATHS.length);
  const printed = formatSweepOnly(err.rateLimits, true).join("\n");
  assert.match(printed, /Rate limits: 2 per-uid \+ 1 per-session/);
  assert.match(printed, /3 counter path\(s\) removed/);
  for (const s of secretsOf(w)) assert.ok(!printed.includes(s), "leaked " + JSON.stringify(s));
});

test("(review) the counters are swept even when the account LISTING fails outright", async () => {
  const h = harness(world(), { listThrows: "account listing failed: HTTP 403" });
  await assert.rejects(h.run({ confirm: true }), /HTTP 403/);
  assert.deepStrictEqual(h.writtenPaths(), COUNTER_PATHS);
});

test("(review) a dry run sweeps nothing even when the account half refuses", async () => {
  const h = harness(world({ accounts: [] }));
  const err = await h.run().then(() => null, (e) => e);
  assert.ok(err && err.refusal === true);
  assert.deepStrictEqual(h.updates(), []);
  assert.strictEqual(err.rateLimits.written.paths, 0);
  assert.match(formatSweepOnly(err.rateLimits, false).join("\n"), /dry run: nothing written/);
});

test("(review) a failed COUNTER write does not stop the account being removed", async () => {
  /* The rule is that an account goes only after ITS records. The counters are
     not its records: they expire on their own clock whoever owns them. */
  const h = harness(world(), { failUpdate: 0 });          // the first update is the counters
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"]);
  assert.strictEqual(r.auth.skipped, false);
  assert.strictEqual(r.written.failedUpdates, 1);
  assert.strictEqual(r.written.paths, 2, "the two user-record paths still went");
  assert.strictEqual(exitCodeFor(r), 1, "but the run must not report a clean sweep");
});

// ── (review) the counter sweep must not be able to stop the job ─────────────

test("(review) a rate-limit tree that cannot be read does NOT stop the account being removed", async () => {
  /* Participants can write under their own counters, so this is the one read
     an outsider could make fail. If it blocked the run, one inflated node
     would end retention for everyone. */
  const h = harness(world(), { failRead: ["rateLimits/uid", "rateLimits/session"] });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"]);
  assert.deepStrictEqual(h.writtenPaths(), ["users/idleAnon", "users/quietAnon/history"]);
  assert.strictEqual(r.rateLimits.readErrors, 2);
  assert.strictEqual(exitCodeFor(r), 1, "the counters were not swept, and the run must say so");
});

test("(review) one unreadable counter is skipped; the others are still swept", async () => {
  const h = harness(world(), { failRead: "rateLimits/uid/idleAnon" });
  const r = await h.run({ confirm: true });
  assert.ok(h.writtenPaths().includes("rateLimits/uid/quietAnon/" + OLD_HOUR));
  assert.ok(h.writtenPaths().includes("rateLimits/session/CODE1/" + OLD_HOUR));
  assert.deepStrictEqual(mentions(h.writtenPaths(), "idleAnon").filter((p) => p.startsWith("rateLimits/")), []);
  assert.strictEqual(r.rateLimits.readErrors, 1);
});

test("(review) hostile key names are swept like any other, not lost", async () => {
  /* `__proto__` as a plain-object key sets the prototype instead of adding an
     entry, so a counter stored under it would vanish from the plan and never
     expire. The rules let a participant choose bucket names, and a session
     code is free-form. */
  /* Built with JSON.parse, as a real response is: an object LITERAL cannot
     hold an own "__proto__" key, so a literal here would test nothing. */
  const w = world();
  w.shallow["rateLimits/session"] = JSON.parse('{"__proto__":true,"CODE1":true}');
  w.shallow["rateLimits/session/__proto__"] = { [OLD_HOUR]: true };
  w.shallow["rateLimits/uid/quietAnon"] = JSON.parse('{"__proto__":true,"' + NOW_DAY + '":true}');
  assert.ok(Object.keys(w.shallow["rateLimits/session"]).includes("__proto__"), "fixture check");
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.ok(h.writtenPaths().includes("rateLimits/session/__proto__/" + OLD_HOUR));
  assert.ok(h.writtenPaths().includes("rateLimits/uid/quietAnon/__proto__"));
  assert.strictEqual(r.rateLimits.unparsed, 1);
});

// ── the counter sweep's time budget ─────────────────────────────────────────

/* A world whose per-uid counters are `n` stale ids, and a harness in which
   every database read costs 10 ms on a clock the test owns. */
function floodedHarness(n) {
  const w = world();
  const ids = Array.from({ length: n }, (_, i) => "flood" + String(i).padStart(3, "0"));
  w.shallow["rateLimits/uid"] = Object.fromEntries(ids.map((id) => [id, true]));
  for (const id of ids) w.shallow["rateLimits/uid/" + id] = { [OLD_HOUR]: true };
  w.shallow["rateLimits/session"] = {};
  const h = harness(w);
  let t = 0;
  const realShallow = h.deps.fetchShallow;
  h.deps.clock = () => t;
  h.deps.fetchShallow = async (p) => { t += 10; return realShallow(p); };
  const counterReads = () => h.log
    .filter((l) => l.op === "shallow" && l.path.startsWith("rateLimits/uid/flood"))
    .map((l) => l.path.slice("rateLimits/uid/".length));
  return { h, ids, counterReads };
}

test("the counter sweep has a time budget: it writes what it read and says what it left", async () => {
  /* One read per counter id, every read before any write, under a 15-minute
     job — and the ids are a participant's to mint (a counter is written with
     the caller's own token). Without a budget, a few thousand of them make the
     sweep outlast the job: the run is cancelled with nothing written, the
     account half never starts, and a cancelled run tells nobody. Every night. */
  const { h, ids, counterReads } = floodedHarness(40);
  const r = await h.run({ confirm: true, sweepBudgetMs: 125 });
  const read = counterReads().length;
  assert.ok(read > 0 && read < ids.length,
    "expected the sweep to stop part-way; it read " + read + " of " + ids.length);
  assert.strictEqual(r.rateLimits.unread, ids.length - read,
    "what the sweep did not get to must be counted, not dropped");
  assert.strictEqual(h.writtenPaths().filter((p) => p.startsWith("rateLimits/")).length, read,
    "every counter that WAS read must still be swept");
  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"],
    "running out of time on the counters must not stop the account half");
  assert.strictEqual(exitCodeFor(r), 1, "a sweep that left counters unread is not a clean run");
});

test("with time to spare the budget changes nothing", async () => {
  const { h, ids, counterReads } = floodedHarness(40);
  const r = await h.run({ confirm: true, sweepBudgetMs: 60_000 });
  assert.strictEqual(counterReads().length, ids.length);
  assert.strictEqual(r.rateLimits.unread, 0);
  assert.strictEqual(exitCodeFor(r), 0);
});

test("a sweep short of time starts somewhere else each day, so no counter is starved", async () => {
  /* Stopping early is only safe if tomorrow does not stop at the same place.
     Stale counters at the front are deleted and make room; FRESH ones are not,
     and an attacker can keep a block of them fresh — so the sweep must not
     always begin with the same ids. */
  const seen = new Set();
  for (let day = 0; day < 30; day++) {
    const { h, counterReads } = floodedHarness(12);
    await h.run({ nowMs: NOW + day * DAY_MS, sweepBudgetMs: 75 });
    const today = counterReads();
    assert.ok(today.length >= 2 && today.length < 12, "day " + day + " read " + today.length);
    for (const id of today) seen.add(id);
  }
  assert.strictEqual(seen.size, 12,
    "after 30 days some counters had never been read: " + (12 - seen.size) + " of 12");
});

test("a broken clock cannot switch the sweep off", async () => {
  /* The budget is a guard against running too long. A clock that returns
     nonsense must cost the guard, not the sweep. */
  const { h, ids, counterReads } = floodedHarness(6);
  h.deps.clock = () => NaN;
  const r = await h.run({ confirm: true, sweepBudgetMs: 125 });
  assert.strictEqual(counterReads().length, ids.length);
  assert.strictEqual(r.rateLimits.unread, 0);
});

/* The budget above counted counter IDS. A second review pointed out what that
   leaves: the rules let a participant write any bucket NAME under their own
   uid, the sweep treats a name it does not recognise as stale, and every one
   becomes a path to delete — 400 per update, one update after another. One id
   with a million junk names is one fast read and thousands of writes, all in
   front of the account half. So the budget has to cover the writes too.

   A world with one flooded uid (`junk` unrecognisable bucket names) next to
   the usual counters, and a harness in which every WRITE costs 100 ms. */
function writeFloodHarness(junk) {
  const w = world();
  const buckets = {};
  for (let i = 0; i < junk; i++) buckets["zz" + i] = true;
  w.shallow["rateLimits/uid"] = Object.assign({ flooder: true }, w.shallow["rateLimits/uid"]);
  w.shallow["rateLimits/uid/flooder"] = buckets;
  const h = harness(w);
  let t = 0;
  const realUpdate = h.deps.updateRoot;
  h.deps.clock = () => t;
  h.deps.updateRoot = async (u) => { t += 100; return realUpdate(u); };
  const counterWrites = () => h.writtenPaths().filter((p) => p.startsWith("rateLimits/"));
  return { h, counterWrites };
}

test("the budget covers the WRITES too: a flood of bucket names cannot hold the job", async () => {
  const junk = UPDATE_CHUNK * 5;
  const { h, counterWrites } = writeFloodHarness(junk);
  const r = await h.run({ confirm: true, sweepBudgetMs: 250 });
  const stale = junk + COUNTER_PATHS.length;
  const written = counterWrites().length;
  assert.ok(written > 0 && written < stale,
    "expected the sweep to stop writing part-way; it wrote " + written + " of " + stale);
  assert.strictEqual(r.rateLimits.unwritten, stale - written,
    "what the sweep did not get to delete must be counted, not dropped");
  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"],
    "running out of time on the counter writes must not stop the account half");
  assert.strictEqual(exitCodeFor(r), 1, "a sweep that left stale buckets behind is not a clean run");
  assert.match(formatReport(r, { confirm: true, days: 90, sweepOrphans: false }).join("\n"),
    /OUT OF TIME, \d+ stale bucket\(s\) not deleted/);
});

test("ordinary counters are swept before a flooded one, however short the time", async () => {
  /* Stopping the writes early is only acceptable if the flood is what waits.
     The counters the notice promises gone in about three days belong to
     everyone else, and there are few of them per id. */
  const { h, counterWrites } = writeFloodHarness(UPDATE_CHUNK * 5);
  const r = await h.run({ confirm: true, sweepBudgetMs: 50 });   // time for one update
  const written = counterWrites();
  for (const p of COUNTER_PATHS) {
    assert.ok(written.includes(p), "an ordinary stale counter was left behind a flood: " + p);
  }
  assert.ok(r.rateLimits.unwritten > 0);
  assert.ok(written.length <= UPDATE_CHUNK, "more than one update went out in time for one");
});

test("a dry run leaves nothing unwritten to report, whatever the size", async () => {
  const { h } = writeFloodHarness(UPDATE_CHUNK * 5);
  const r = await h.run({ confirm: false, sweepBudgetMs: 50 });
  assert.strictEqual(r.rateLimits.unwritten, 0);
  assert.deepStrictEqual(h.writtenPaths(), []);
});

// ── what reaches the log ────────────────────────────────────────────────────

const secretsOf = (w) =>w.accounts.map((a) => a.uid).concat(["CODE1", "My Code", "ORG9", "partner"]);

test("the report carries COUNTS only — no uid, no session code", async () => {
  const w = world();
  const text = JSON.stringify(await harness(w).run({ confirm: true }));
  for (const s of secretsOf(w)) assert.ok(!text.includes(s), "the report leaked " + JSON.stringify(s));
});

test("what the job PRINTS carries counts only, dry run and live", async () => {
  const w = world();
  for (const confirm of [false, true]) {
    const r = await harness(w).run({ confirm });
    const printed = formatReport(r, { confirm, days: 90, sweepOrphans: false }).join("\n");
    for (const s of secretsOf(w)) {
      assert.ok(!printed.includes(s), "the output leaked " + JSON.stringify(s));
    }
    assert.match(printed, /Accounts: {4}12 total — 10 anonymous, 2 signed-in/);
    assert.match(printed, /Anonymous: {3}1 idle > 90d, 9 kept/);
    assert.match(printed, confirm ? /Auth: {8}1 account\(s\) deleted/ : /Set ANON_CONFIRM=1/);
  }
});

test("the exit code is 0 only when everything asked for was done", () => {
  const clean = () => ({
    written: { failedUpdates: 0 }, auth: { failed: 0, skipped: false },
    records: { readErrors: 0 }, rateLimits: { readErrors: 0 }
  });
  assert.strictEqual(exitCodeFor(clean()), 0);
  const broken = [
    (r) => { r.written.failedUpdates = 1; },
    (r) => { r.auth.failed = 3; },
    (r) => { r.auth.skipped = true; },
    (r) => { r.records.readErrors = 1; },
    (r) => { r.rateLimits.readErrors = 1; }
  ];
  for (const breakIt of broken) {
    const r = clean();
    breakIt(r);
    assert.strictEqual(exitCodeFor(r), 1, breakIt.toString());
  }
});

test("a failed read is reported by label and status — never by its path", async () => {
  /* The reader's own message names the path, and that path carries a session
     join code. This runs on a public repository. */
  const h = harness(world(), { failRead: "sessions/CODE1/members" });
  await assert.rejects(h.run({ confirm: true }), (e) => {
    assert.match(e.message, /member list/);
    assert.match(e.message, /HTTP_500/);
    assert.ok(!e.message.includes("CODE1"), "the session code reached the error message");
    return true;
  });
  neverActed(h);
});

test("free-form keys are URL-encoded before they become a REST path", async () => {
  const h = harness(world());
  await h.run();
  const paths = h.log.filter((l) => l.op === "shallow" || l.op === "value").map((l) => l.path);
  assert.ok(paths.includes("sessions/My%20Code/members"));
  assert.ok(paths.includes("sessions/My%20Code/creatorUid"));
  assert.ok(!paths.some((p) => p.includes(" ")));
});

test("the only value ever read whole is a session's creator uid", async () => {
  /* `readValue` returns a node's whole value. Everything else is `shallow`:
     keys, never contents — not a profile, not a history entry, not a counter. */
  const h = harness(world());
  await h.run({ confirm: true });
  const whole = h.log.filter((x) => x.op === "value").map((x) => x.path);
  assert.ok(whole.length > 0);
  for (const p of whole) assert.match(p, /\/creatorUid$/, "unexpected deep read of " + p);
});

// ── the workflow and the runner ─────────────────────────────────────────────

/* Read as LF, whatever the checkout. With core.autocrlf=true the working tree
   is CRLF, and `.` does not match `\r` — so a pattern that walks lines with
   `.*\n` finds nothing on Windows while passing in CI. That is how the
   input-default checks below went red on a workflow that was correct. Same
   reason as the gzip site in tests-e2e/perf.spec.js. */
const readLF = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

const WORKFLOW = readLF(".github", "workflows", "cleanup-anonymous-accounts.yml");
const RUNNER = readLF("scripts", "cleanup-anonymous-accounts.js");
const liveCrons = (yml) =>
  yml.split("\n").filter((l) => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l)).length;

test("the workflow is scheduled, and what ties that to the notice lives next door", () => {
  /* Until the notice described this job, a test here asserted the workflow had
     NO cron: a scheduled run sends account identifiers to a US runner every
     night, and a notice that did not say so would have been wrong the same
     night. The cron, the armed switch and PIS v12 then landed in one change,
     and tests/anonymous-identifier-notice.test.js now holds the three
     together. This only pins that the hand-over happened. */
  assert.strictEqual(liveCrons(WORKFLOW), 1);
  assert.ok(fs.existsSync(path.join(ROOT, "tests", "anonymous-identifier-notice.test.js")),
    "the notice lockstep is gone, and with it the only thing stopping this " +
    "schedule from outliving the disclosure it depends on");
});

/* LIVE lines only, and exactly one of them: a pattern run over the whole file
   is satisfied by a commented-out line, and one that walks "any line" to the
   next `default:` slides out of the input it was asked about. Both let a wrong
   workflow through; see the same two readers in
   tests/anonymous-identifier-notice.test.js for how each was found. */
const LIVE = WORKFLOW.split("\n").filter((l) => !/^\s*#/.test(l));
function liveEnv(name) {
  const re = new RegExp("^\\s+" + name + ":\\s*(.+?)\\s*$");
  const hits = LIVE.map((l) => re.exec(l)).filter(Boolean).map((m) => m[1]);
  assert.strictEqual(hits.length, 1, name + " must be set on exactly one live line");
  return hits[0];
}
function inputDefault(name) {
  const at = LIVE.findIndex((l) => new RegExp("^\\s+" + name + ":\\s*$").test(l));
  assert.ok(at >= 0, "no `" + name + "` input in the workflow");
  const depth = (l) => l.match(/^\s*/)[0].length;
  for (let i = at + 1; i < LIVE.length; i++) {
    if (!LIVE[i].trim()) continue;
    if (depth(LIVE[i]) <= depth(LIVE[at])) break;
    const m = /^\s+default:\s*(.*?)\s*$/.exec(LIVE[i]);
    if (m) return m[1];
  }
  return null;
}

test("the orphan sweep is never on by schedule — only by an explicit manual tick", () => {
  /* Deleting on schedule is the published policy. Deleting records whose uid
     has no account is an operator decision, behind a tripwire. */
  assert.strictEqual(liveEnv("ANON_SWEEP_ORPHANS"),
    "${{ github.event.inputs.sweep_orphans == 'true' && '1' || '0' }}");
  assert.strictEqual(inputDefault("sweep_orphans"), "false",
    "the sweep_orphans input must default to false");
});

test("the workflow's default window is the one the rules default to", () => {
  const m = /^\$\{\{ github\.event\.inputs\.retention_days \|\| '(\d+)' \}\}$/
    .exec(liveEnv("ANON_RETENTION_DAYS"));
  assert.ok(m, "ANON_RETENTION_DAYS is no longer wired to the dispatch input");
  assert.strictEqual(Number(m[1]), DEFAULT_RETENTION_DAYS);
});

test("the workflow installs from the lockfile and never interrupts a deletion", () => {
  assert.match(WORKFLOW, /^\s*run:\s*npm ci(\s|$)/m);
  assert.match(WORKFLOW, /cancel-in-progress: false/);
});

test("the runner has no verbose mode and is dry-run unless told otherwise", () => {
  assert.match(RUNNER, /const CONFIRM = process\.env\.ANON_CONFIRM === "1";/);
  assert.ok(!/VERBOSE|QUIET/.test(RUNNER),
    "this job prints counts only, unconditionally — a uid is the identifier it exists to stop keeping");
});

test("the runner prints and exits through the tested functions, and nothing else", () => {
  /* formatReport() and exitCodeFor() are tested above. That only means
     anything if the CLI uses them and does not grow a second, untested path. */
  assert.match(RUNNER, /process\.exit\(exitCodeFor\(report\)\)/,
    "the success path must exit explicitly, with the tested exit code");
  assert.match(RUNNER, /for \(const line of formatReport\(report, /);
  assert.match(RUNNER, /process\.exit\(3\)/, "a refusal has its own exit code");
  const logs = [...RUNNER.matchAll(/console\.(log|error)\(([^\n]*)/g)].map((m) => m[2]);
  for (const arg of logs) {
    assert.ok(!/report\.|uid|expired/i.test(arg),
      "the runner prints something the tested formatter did not produce: " + arg);
  }
});
