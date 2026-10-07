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
const { exitCodeFor, formatReport } = require("../scripts/lib/anonymous-retention-report");
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
    { staleUid: 2, staleSession: 1, kept: 1, unparsed: 0, readErrors: 0 });
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

  assert.strictEqual(h.updates().length, 1);
  assert.deepStrictEqual(h.writtenPaths(), EXPECTED_PATHS);
  for (const v of Object.values(h.updates()[0])) assert.strictEqual(v, null);

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
  /* The re-check has to be the last thing before the writes: it is only worth
     anything if nothing slow happens after it. */
  assert.ok(first("lookup") > first("list"));
  assert.ok(first("lookup") < first("update"));
  assert.ok(Math.max(last("shallow"), last("value")) < first("lookup"),
    "a database read happens AFTER the re-check — the counter sweep is one " +
    "request per counter, and every one of them widens the gap the re-check closes");
  /* If the account went first and the write then failed, the records would sit
     under a uid no listing returns — unreachable by every later run. */
  assert.ok(last("update") < first("deleteAccounts"));
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
  assert.deepStrictEqual(h.updates(), []);
  assert.deepStrictEqual(h.deletedUids(), []);
});

// ── failures ────────────────────────────────────────────────────────────────

test("live: a failed database write means NO account is deleted", async () => {
  const h = harness(world(), { failUpdate: true });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), [], "an account must not outlive its records' deletion failing");
  assert.strictEqual(r.auth.skipped, true);
  assert.strictEqual(r.written.failedUpdates, 1);
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

const neverActed = (h) => {
  assert.deepStrictEqual(h.updates(), []);
  assert.deepStrictEqual(h.deletedUids(), []);
};

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

// ── what reaches the log ────────────────────────────────────────────────────

const secretsOf = (w) => w.accounts.map((a) => a.uid).concat(["CODE1", "My Code", "ORG9", "partner"]);

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

test("the workflow is NOT scheduled while the privacy notice does not describe it", () => {
  /* A scheduled run sends account identifiers and session member uids to a
     GitHub runner in the United States every night. privacy.html sections 6-7
     list what the scheduled jobs read, and section 8 states the retention
     periods; neither mentions this job. Adding a cron here alone makes the
     published notice wrong the same night.
     WHEN YOU SCHEDULE IT: replace this test, in the same change, with one that
     ties the cron and the armed ANON_CONFIRM to the notice's wording. */
  assert.strictEqual(liveCrons(WORKFLOW), 0,
    "cleanup-anonymous-accounts.yml gained a live cron. See the comment above.");
  const privacy = fs.readFileSync(
    path.join(ROOT, "docs", "Third_session", "PBL_platform", "privacy.html"), "utf8");
  assert.ok(!/anonymous(ly)? (sign|account|identifier)/i.test(privacy),
    "privacy.html now mentions the anonymous identifier — this test is the " +
    "placeholder that change was meant to replace with a real lockstep.");
});

test("the workflow deletes only on an explicit manual confirm", () => {
  assert.match(WORKFLOW, /ANON_CONFIRM: \$\{\{ github\.event\.inputs\.confirm == 'true' && '1' \|\| '0' \}\}/);
  const confirmInput = /confirm:\s*\n(?:\s+.*\n)*?\s+default: (\w+)/.exec(WORKFLOW);
  assert.ok(confirmInput && confirmInput[1] === "false", "the confirm input must default to false");
  assert.match(WORKFLOW, /ANON_SWEEP_ORPHANS: \$\{\{ github\.event\.inputs\.sweep_orphans == 'true' && '1' \|\| '0' \}\}/);
});

test("the workflow's default window is the one the rules default to", () => {
  const m = /ANON_RETENTION_DAYS: \$\{\{ github\.event\.inputs\.retention_days \|\| '(\d+)' \}\}/.exec(WORKFLOW);
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
