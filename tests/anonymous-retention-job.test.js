"use strict";
/* tests/anonymous-retention-job.test.js
 *
 * The anonymous-account retention job (issue #347), run end to end against
 * fakes. The rules are tested in anonymous-retention.test.js; this is what is
 * actually READ and WRITTEN, which is where the expensive mistakes live:
 *
 *   - an account deleted before, or without, its records
 *   - an account a live session still names being removed anyway
 *   - a dry run that writes, or a refusal that writes first
 *   - a uid or a session code reaching the job's (world-readable) output
 *
 * The last section pins the workflow, because the one thing a unit test of the
 * script cannot see is whether the job is scheduled, armed, and quiet.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { runAnonymousRetention, UPDATE_CHUNK } = require("../scripts/lib/anonymous-retention-job");
const { DEFAULT_RETENTION_DAYS, DAY_MS } = require("../scripts/lib/anonymous-retention");
const { HOUR_MS } = require("../scripts/lib/rate-limit-retention");
const { dayKey } = require("../docs/Third_session/PBL_platform/functions/lib/hf-helpers");

const ROOT = path.join(__dirname, "..");
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const WINDOW = DEFAULT_RETENTION_DAYS * DAY_MS;
const OLD = NOW - WINDOW - DAY_MS;
const FRESH = NOW - DAY_MS;
const OLD_HOUR = "h" + Math.floor(OLD / HOUR_MS);
const NOW_DAY = "d" + dayKey(NOW);

const acct = (uid, last, providers) => ({
  uid, createdMs: last, lastLoginMs: last, lastRefreshMs: last, providers: providers || []
});

/* One world, used by most tests. Keys are what a `shallow` read returns. */
function world(overrides) {
  return Object.assign({
    accounts: [
      acct("idleAnon", OLD), acct("idleMember", OLD), acct("idleCreator", OLD),
      acct("idleAllowed", OLD), acct("idleModerator", OLD), acct("idleOrgMember", OLD),
      acct("freshAnon", FRESH), acct("namedOld", OLD, ["google.com"])
    ],
    shallow: {
      "sessions": { "CODE1": true, "My Code": true },
      "orgs": { "partner": true },
      "orgs/partner/sessions": { "ORG9": true },
      "sessions/CODE1/members": { idleMember: true, freshAnon: true },
      "sessions/My%20Code/members": null,
      "orgs/partner/sessions/ORG9/members": { idleOrgMember: true },
      "facilitatorGate/allow": { idleAllowed: true },
      "moderators": { idleModerator: true },
      "users": { idleAnon: true, freshAnon: true, namedOld: true },
      "scenarios": { idleAnon: true, namedOld: true },
      "rateLimits/uid": { idleAnon: true, freshAnon: true },
      "reports/scenarios": { shareA: true },
      "reports/scenarios/shareA": { idleAnon: true, namedOld: true }
    },
    values: {
      "sessions/CODE1/creatorUid": "idleCreator",
      "sessions/My%20Code/creatorUid": null,
      "orgs/partner/sessions/ORG9/creatorUid": "namedOld",
      "rateLimits": {
        uid: { idleAnon: { [OLD_HOUR]: 3 }, freshAnon: { [OLD_HOUR]: 2, [NOW_DAY]: 5 } },
        session: { CODE1: { [OLD_HOUR]: 9 } }
      }
    }
  }, overrides || {});
}

function harness(w, opts) {
  const o = opts || {};
  const log = [];
  const deps = {
    listAccounts: async () => {
      log.push({ op: "list" });
      if (o.listThrows) throw new Error(o.listThrows);
      return w.accounts;
    },
    deleteAccounts: async (uids) => {
      log.push({ op: "deleteAccounts", uids: [...uids] });
      return o.deleteResult || { deleted: uids.length, failed: 0, httpStatuses: [] };
    },
    fetchShallow: async (p) => {
      log.push({ op: "shallow", path: p });
      if (o.failRead === p) { const e = new Error("boom at " + p); e.code = "HTTP_500"; throw e; }
      if (!(p in w.shallow)) throw new Error("test world has no shallow node " + p);
      return w.shallow[p];
    },
    readValue: async (p) => {
      log.push({ op: "value", path: p });
      if (!(p in w.values)) throw new Error("test world has no value node " + p);
      return w.values[p];
    },
    updateRoot: async (update) => {
      log.push({ op: "update", update });
      if (o.failUpdate) { const e = new Error("denied"); e.code = "PERMISSION_DENIED"; throw e; }
    }
  };
  const run = (extra) => runAnonymousRetention(deps, Object.assign(
    { nowMs: NOW, windowMs: WINDOW, confirm: false, sweepOrphans: false }, extra || {}));
  const updates = () => log.filter((l) => l.op === "update").map((l) => l.update);
  const deletedUids = () => log.filter((l) => l.op === "deleteAccounts").flatMap((l) => l.uids);
  return { deps, log, run, updates, deletedUids };
}

const EXPECTED_PATHS = [
  "rateLimits/session/CODE1/" + OLD_HOUR,
  "rateLimits/uid/freshAnon/" + OLD_HOUR,
  "rateLimits/uid/idleAnon",                 // whole node: its stale bucket is beneath it
  "reports/scenarios/shareA/idleAnon",
  "scenarios/idleAnon",
  "users/freshAnon/history",                 // bug-written history of a LIVE anonymous account
  "users/idleAnon"
];

// ── dry run ─────────────────────────────────────────────────────────────────

test("dry run: counts everything, writes NOTHING, deletes no account", async () => {
  const h = harness(world());
  const r = await h.run();
  assert.deepStrictEqual(h.updates(), [], "a dry run must not write");
  assert.deepStrictEqual(h.deletedUids(), [], "a dry run must not delete an account");
  assert.strictEqual(r.paths, EXPECTED_PATHS.length);
  assert.deepStrictEqual(r.accounts, {
    total: 8, named: 1, anonymous: 7, expired: 1, kept: 6, protected: 5, undated: 0, unusable: 0
  });
  assert.strictEqual(r.records.legacyHistory, 1);
  assert.deepStrictEqual(r.rateLimits, { staleUid: 2, staleSession: 1, kept: 1, unparsed: 0 });
  assert.strictEqual(r.sessions, 3);
});

// ── live run ────────────────────────────────────────────────────────────────

test("live: deletes exactly the planned paths, then exactly the idle account", async () => {
  const h = harness(world());
  const r = await h.run({ confirm: true });

  assert.strictEqual(h.updates().length, 1);
  assert.deepStrictEqual(Object.keys(h.updates()[0]).sort(), EXPECTED_PATHS);
  for (const v of Object.values(h.updates()[0])) assert.strictEqual(v, null);

  assert.deepStrictEqual(h.deletedUids(), ["idleAnon"]);
  assert.deepStrictEqual(r.written, { paths: EXPECTED_PATHS.length, failedUpdates: 0, errorCodes: [] });
  assert.deepStrictEqual(r.auth, { deleted: 1, failed: 0, httpStatuses: [], skipped: false });
});

test("live: the records go BEFORE the account, never after", async () => {
  /* If the account went first and the write then failed, the records would sit
     under a uid no listing returns — unreachable by every later run. */
  const h = harness(world());
  await h.run({ confirm: true });
  const ops = h.log.map((l) => l.op);
  assert.ok(ops.indexOf("update") !== -1 && ops.indexOf("deleteAccounts") !== -1);
  assert.ok(ops.lastIndexOf("update") < ops.indexOf("deleteAccounts"));
});

test("live: a SIGNED-IN account and its records are never touched", async () => {
  const h = harness(world());
  await h.run({ confirm: true });
  assert.ok(!h.deletedUids().includes("namedOld"));
  for (const p of Object.keys(h.updates()[0])) {
    assert.ok(!p.includes("namedOld"), "a signed-in user's record was planned for deletion: " + p);
  }
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
  w.shallow["sessions/CODE1/members"] = { freshAnon: true };
  const h = harness(w);
  await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids().sort(), ["idleAnon", "idleMember"]);
});

test("live: a failed database write means NO account is deleted", async () => {
  const h = harness(world(), { failUpdate: true });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(h.deletedUids(), [], "an account must not outlive its records' deletion failing");
  assert.strictEqual(r.auth.skipped, true);
  assert.strictEqual(r.written.failedUpdates, 1);
  assert.deepStrictEqual(r.written.errorCodes, ["PERMISSION_DENIED"]);
  assert.strictEqual(r.written.paths, 0);
});

test("live: a partly failed account deletion is reported, not hidden", async () => {
  const h = harness(world(), { deleteResult: { deleted: 0, failed: 1, httpStatuses: [403] } });
  const r = await h.run({ confirm: true });
  assert.deepStrictEqual(r.auth, { deleted: 0, failed: 1, httpStatuses: [403], skipped: false });
});

test("live: with nothing idle, no account call is made at all", async () => {
  const w = world({ accounts: [acct("freshAnon", FRESH), acct("namedOld", OLD, ["google.com"])] });
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.ok(!h.log.some((l) => l.op === "deleteAccounts"));
  assert.strictEqual(r.auth.skipped, false);
});

test("live: large plans are split, and every chunk is still all-null and safe", async () => {
  const many = Array.from({ length: UPDATE_CHUNK + 25 }, (_, i) => "bulk" + i);
  const w = world({ accounts: many.map((u) => acct(u, OLD)) });
  w.shallow = Object.assign({}, w.shallow, {
    "sessions": null, "orgs": null, "facilitatorGate/allow": null, "moderators": null,
    "users": Object.fromEntries(many.map((u) => [u, true])),
    "scenarios": null, "rateLimits/uid": null, "reports/scenarios": null
  });
  w.values = { "rateLimits": null };
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.strictEqual(h.updates().length, 2);
  assert.ok(h.updates().every((u) => Object.keys(u).length <= UPDATE_CHUNK));
  assert.strictEqual(h.updates().reduce((n, u) => n + Object.keys(u).length, 0), many.length);
  assert.strictEqual(r.written.paths, many.length);
  assert.strictEqual(h.deletedUids().length, many.length);
});

// ── refusals: nothing may be written first ──────────────────────────────────

test("an EMPTY account listing is refused before anything else is read", async () => {
  /* Every visitor gets an account, so "no accounts" is a broken listing — and
     with an empty list every record in the database looks orphaned. */
  const h = harness(world({ accounts: [] }));
  await assert.rejects(h.run({ confirm: true, sweepOrphans: true }), (e) => e.refusal === true);
  assert.deepStrictEqual(h.log.map((l) => l.op), ["list"]);
});

test("a FAILED account listing stops the run with nothing written", async () => {
  const h = harness(world(), { listThrows: "account listing failed: HTTP 403" });
  await assert.rejects(h.run({ confirm: true }), /HTTP 403/);
  assert.deepStrictEqual(h.updates(), []);
  assert.deepStrictEqual(h.deletedUids(), []);
});

test("orphans: reported by default, and their records left in place", async () => {
  const w = world();
  w.shallow["users"] = Object.assign({ ghost: true }, w.shallow["users"]);
  const h = harness(w);
  const r = await h.run({ confirm: true });
  assert.strictEqual(r.records.orphans.users, 1);
  assert.strictEqual(r.records.orphanPaths, 0);
  assert.ok(!Object.keys(h.updates()[0]).includes("users/ghost"));
});

test("orphans: an implausible number REFUSES the run before any write", async () => {
  const ghosts = Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["ghost" + i, true]));
  const w = world();
  w.shallow["users"] = ghosts;
  const h = harness(w);
  await assert.rejects(h.run({ confirm: true, sweepOrphans: true }),
    (e) => e.refusal === true && /incomplete account listing/.test(e.message));
  assert.deepStrictEqual(h.updates(), []);
  assert.deepStrictEqual(h.deletedUids(), []);
});

test("orphans: a plausible number is removed when asked", async () => {
  const w = world();
  w.shallow["scenarios"] = Object.assign({ ghost: true }, w.shallow["scenarios"]);
  const h = harness(w);
  const r = await h.run({ confirm: true, sweepOrphans: true });
  assert.ok(Object.keys(h.updates()[0]).includes("scenarios/ghost"));
  assert.strictEqual(r.records.orphanPaths, 1);
  assert.ok(!h.deletedUids().includes("ghost"), "an orphan has no account to delete");
});

// ── what reaches the log ────────────────────────────────────────────────────

test("the report carries COUNTS only — no uid, no session code", async () => {
  const w = world();
  const h = harness(w);
  const text = JSON.stringify(await h.run({ confirm: true }));
  const secrets = w.accounts.map((a) => a.uid).concat(["CODE1", "My Code", "ORG9", "shareA"]);
  for (const s of secrets) {
    assert.ok(!text.includes(s), "the report leaked " + JSON.stringify(s));
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
  assert.deepStrictEqual(h.updates(), [], "nothing may be written after a failed read");
});

test("free-form keys are URL-encoded before they become a REST path", async () => {
  const h = harness(world());
  await h.run();
  const paths = h.log.filter((l) => l.op === "shallow" || l.op === "value").map((l) => l.path);
  assert.ok(paths.includes("sessions/My%20Code/members"));
  assert.ok(paths.includes("sessions/My%20Code/creatorUid"));
  assert.ok(!paths.some((p) => p.includes(" ")));
});

test("nothing is ever read deeply except the counter tree", async () => {
  /* `readValue` returns a node's whole value. It is allowed for one uid
     (creatorUid) and for rateLimits (identifier, bucket, integer). Anything
     else here would be a session or profile body crossing to the runner. */
  const h = harness(world());
  await h.run({ confirm: true });
  for (const l of h.log.filter((x) => x.op === "value")) {
    assert.ok(l.path === "rateLimits" || /\/creatorUid$/.test(l.path),
      "unexpected deep read of " + l.path);
  }
});

// ── the workflow and the runner ─────────────────────────────────────────────

const WORKFLOW = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "cleanup-anonymous-accounts.yml"), "utf8");
const RUNNER = fs.readFileSync(path.join(ROOT, "scripts", "cleanup-anonymous-accounts.js"), "utf8");
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

test("the runner distinguishes a refusal from a breakage, and always exits", () => {
  assert.match(RUNNER, /process\.exit\(3\)/, "a refusal has its own exit code");
  assert.match(RUNNER, /process\.exit\(failed \? 1 : 0\)/,
    "the success path must exit explicitly — firebase-admin keeps the event loop alive");
});
