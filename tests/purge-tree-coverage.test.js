"use strict";
/* tests/purge-tree-coverage.test.js
 *
 * Everything a session owns OUTSIDE its own subtree has to be named, one path
 * at a time, in the nightly purge — and from 2026-05-25 until the fix of
 * 2026-10-07 one of them was not.
 *
 * Creating a session writes a recovery code to `recovery/sessions/<code>` (or
 * `recovery/orgs/<slug>/sessions/<id>`): a secret, shown to the facilitator
 * once, that the rules compare against when a forgotten admin password is
 * reset. scripts/cleanup-stale-sessions.js deleted a session together with six
 * out-of-cascade siblings, and `recovery/` was not among them. No script
 * referenced the tree at all. So every recovery code ever written outlived its
 * session with no retention period — a session code plus a secret that still
 * opened the reset path at that code. Found 2026-10-07 by reading; reproduced
 * by running the real script, which is what the last section of this file does.
 *
 * WHY NOTHING CAUGHT IT. The purge's list of siblings is a hand-written copy of
 * something database.rules.json already states. Every earlier miss was the same
 * miss — adminSecrets, roomChat, certIds, rosters, withdrawals were each added
 * after somebody noticed — and each time the test that followed pinned the list
 * AS IT THEN WAS. A complete-list assertion cannot see a tree that was never on
 * the list.
 *
 * So the list is DERIVED here from the rules and compared with what the script
 * actually writes when it is RUN:
 *
 *   1. Walk every top-level rule tree except `sessions` and `orgs`. A wildcard
 *      that is a session key marks a per-session node outside the cascade.
 *   2. Every wildcard NAME must be classified — session key, org slug, or one
 *      of the names in NOT_A_SESSION_KEY. An unknown one fails. A tree keyed by
 *      `$sid` must not slip past because nobody thought of the spelling.
 *   3. Run scripts/cleanup-stale-sessions.js in a child process against an
 *      in-memory database holding one expired and one live session in EACH
 *      session tree, with a record seeded under every derived path.
 *   4. Each derived path of an expired session must be in that session's purge
 *      update — that exact path, deleted whole — or appear in one of the maps
 *      below with the reason: a decision, in the repository, rather than an
 *      omission.
 *
 * WHAT THIS CAN AND CANNOT SEE. It reads the RULES, so it sees what the rules
 * declare with a wildcard:
 *   - A top-level tree in which it finds no session key at all is not waved
 *     through: it must be listed in NO_SESSION_KEY_IN_RULES with what it is.
 *     That is how an admin-only tree with no child rules — which may well be
 *     keyed by session — gets a line here instead of silence.
 *   - A tree with NO rules entry (`ops/`, `metrics/`, `erasures/`: admin-only by
 *     the root deny) is invisible. Nothing here speaks for those.
 *   - A session keyed under a wildcard NAME that NOT_A_SESSION_KEY already
 *     excuses (`foo/$uid` holding session codes) passes as "not a session".
 *     The names are a convention, and this trusts it.
 *   - Under `orgs/<slug>/` it assumes there is only `sessions/`, and checks so.
 *
 * tests/erasure-node-coverage.test.js does the same for the erasure planner and
 * is the model. tests/cleanup-passes.test.js pins the exact key list for one
 * session; this file is what says that list is the RIGHT one.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8")).rules;
const SCRIPT_PATH = path.join(ROOT, "scripts", "cleanup-stale-sessions.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");

const { sessionLocationsFromKeys } = require("../scripts/lib/session-trees");
const { canamedSessionPrefix } = require(path.join(PLATFORM, "orgs.js"));

/* ── classification ──────────────────────────────────────────────────── */

/* The session trees themselves. The purge deletes `sessions/<code>` and
   `orgs/<slug>/sessions/<id>` whole; this file is about what lies outside. */
const SESSION_TREES = ["sessions", "orgs"];

/* What the rules call a session. `adminSecrets` and `rateLimits` say `$code`;
   everything else says `$sessionId`. Same identifier. */
const SESSION_KEYS = new Set(["$sessionId", "$code"]);
const ORG_KEY = "$orgSlug";

/* Every other wildcard name the rules use outside the session trees, each with
   what it is. A name missing from here AND from SESSION_KEYS fails the
   derivation — see "every wildcard is classified". */
const NOT_A_SESSION_KEY = {
  "$uid": "a Firebase Auth uid",
  "$ownerUid": "the uid that owns an authored scenario",
  "$reporterUid": "the uid that filed a moderation report",
  "$certId": "a published certificate id",
  "$shareId": "a shared-scenario id",
  "$scenarioId": "an authored-scenario id",
  "$bucket": "a rate-limit window key (h<hour> / d<yyyymmdd>)",
  "$other": "the closed-schema sentinel, never a real key"
};

/* Session-keyed nodes the purge deliberately does not delete, each with the
   reason. Keyed by the rule path. Adding one is a decision that shows up in
   review; leaving a node out of both the purge and this map fails the suite. */
const ACKNOWLEDGED = {
  "rateLimits/session/$code":
    "The LLM proxy's per-session counters. They run on the BUCKET's clock, not " +
    "the session's: a bucket is stale two windows after it was written (2 h or " +
    "2 days — scripts/lib/rate-limit-retention.js), long before its session " +
    "could expire. Swept nightly by the anonymous-retention job " +
    "(cleanup-anonymous-accounts.yml), not by this purge.",
  "users/$uid/history/$code":
    "A signed-in participant's own list of sessions they took part in. Keyed by " +
    "uid FIRST, so there is no path the purge could address by session without " +
    "enumerating every account, and it is not the session's record: it follows " +
    "the ACCOUNT and is removed with it."
};

/* Per-session nodes the purge does NOT delete whole: it reads them and decides
   record by record, so part of a purged session's node may deliberately stay.
   NONE TODAY. An entry relaxes the check for that rule path from "this exact
   path is deleted" to "something under it is", so it must say what stays, why,
   and what deals with the survivors afterwards. */
const DECIDED_PER_RECORD = {
  "withdrawals/$sessionId":
    "An erasure request nobody has answered yet stays when its session is purged, " +
    "so the data-rights monitor keeps counting it; every other record goes. A " +
    "survivor is removed by sweepWithdrawals() once it has been answered " +
    "(scripts/lib/withdrawal-retention.js).",
  "withdrawals/orgs/$orgSlug/$sessionId": "As the default tree's."
};

/* Top-level trees in which the derivation finds no session key at any depth,
   each with what it is. A tree absent from here AND yielding nothing fails —
   which is the only way an admin-only tree with no child rules (the rules can
   say `.read:false, .write:false` and nothing else about a tree a script keys
   by session) is ever looked at. If such a tree IS per-session, the entry says
   so, and names what writes it and what deletes it. */
const NO_SESSION_KEY_IN_RULES = {
  credentials: "published certificate records, keyed by certificate id. Each carries " +
    "its own retentionUntil; the job that acts on it (cleanup-expired-credentials) is " +
    "scheduled as a DRY RUN, so nothing deletes them on a timer yet (DPA Annex VI G6)",
  facilitatorGate: "one admin-only switch and an allowlist of uids",
  scenarios: "authored scenarios, keyed by their owner's uid",
  sharedScenarios: "published scenarios, keyed by share id",
  moderators: "an admin-only allowlist of uids",
  reports: "moderation reports, keyed by share id and then by the reporter's uid",
  moderation: "takedown tombstones, keyed by share id",
  purgedSessions: "PER-SESSION, and invisible to the derivation: admin-only, with no " +
    "child rules. A session code and a date, WRITTEN by the purge in the same update " +
    "that deletes the session, and expired by sweepWithdrawals() after " +
    "CLEANUP_RETENTION_PURGED_MARKER_DAYS."
};

/* ── derivation ──────────────────────────────────────────────────────── */

/**
 * Every node outside the session trees that is keyed by a session.
 *
 * `direct` nodes are reached through literal keys and `$orgSlug` only — one
 * path per session, which the purge can delete. `nested` ones sit under some
 * other wildcard first, so no single path names "this session's" records.
 */
function deriveSessionKeyed(ruleTree) {
  const direct = [], nested = [], unclassified = [], namesSeen = new Set();

  const walk = (node, segs, underOtherWildcard) => {
    for (const key of Object.keys(node)) {
      if (key.startsWith(".")) continue;
      const kid = node[key];
      if (!kid || typeof kid !== "object") continue;
      const here = segs.concat(key);
      if (!key.startsWith("$")) { walk(kid, here, underOtherWildcard); continue; }

      namesSeen.add(key);
      if (key === ORG_KEY) { walk(kid, here, underOtherWildcard); continue; }
      if (SESSION_KEYS.has(key)) {
        // Not descended into: whatever is below belongs to the session-keyed
        // node and goes when it does.
        (underOtherWildcard ? nested : direct).push(here.join("/"));
        continue;
      }
      if (!(key in NOT_A_SESSION_KEY)) { unclassified.push(here.join("/")); continue; }
      walk(kid, here, true);
    }
  };

  for (const top of Object.keys(ruleTree)) {
    if (top.startsWith(".") || SESSION_TREES.includes(top)) continue;
    walk(ruleTree[top], [top], false);
  }
  return { direct: direct.sort(), nested: nested.sort(), unclassified, namesSeen };
}

const derived = deriveSessionKeyed(rules);
const isOrgRule = (rulePath) => rulePath.split("/").includes(ORG_KEY);
const treeOf = (rulePath) => rulePath.split("/")[0];

/** A rule path with its wildcards filled in. */
function concrete(rulePath, slug, code) {
  return rulePath.split("/").map((seg) => {
    if (seg === ORG_KEY) return slug;
    if (SESSION_KEYS.has(seg)) return code;
    return seg;
  }).join("/");
}

/* ── the derivation itself ───────────────────────────────────────────── */

test("every wildcard the rules use outside the session trees is classified", () => {
  assert.deepStrictEqual(derived.unclassified, [],
    "database.rules.json uses a wildcard name this file has never been told about. " +
    "If it is a session code, add the name to SESSION_KEYS — the node then has to be " +
    "purged with its session or ACKNOWLEDGED. If it is not, add it to " +
    "NOT_A_SESSION_KEY with what it is. Guessing 'not a session' is how a " +
    "per-session tree goes unpurged.");
});

test("the derivation finds the trees known to be per-session — it is not vacuous", () => {
  /* Two anchors of DIFFERENT shapes: the default tree's `$code` directly under
     the tree, and an org branch that repeats the literal `sessions`. A walk that
     only understood one shape would miss the other. */
  assert.ok(derived.direct.includes("adminSecrets/$code"), "lost adminSecrets/$code");
  assert.ok(derived.direct.includes("rosters/orgs/$orgSlug/sessions/$sessionId"),
    "lost the org roster branch");
  assert.ok(derived.direct.length >= 14,
    "found " + derived.direct.length + " per-session nodes; there were 15 on 2026-10-07 " +
    "(seven trees in two session trees, plus the proxy's counters)");
  assert.ok(derived.nested.includes("users/$uid/history/$code"),
    "the walk no longer looks below a non-session wildcard");
});

test("recovery is one of them, in both session trees, at the path the client writes", () => {
  /* The org branch is recovery/orgs/<slug>/SESSIONS/<id> — the roster's shape,
     not adminSecrets' (adminSecrets/orgs/<slug>/<id>). Derived, not typed: the
     client writes "recovery/" + oPath(code), and oPath is the org prefix + code. */
  assert.ok(derived.direct.includes("recovery/sessions/$sessionId"));
  assert.ok(derived.direct.includes("recovery/orgs/$orgSlug/sessions/$sessionId"));

  const client = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");
  assert.ok(client.includes('db.ref("recovery/" + oPath(code)).set({ code: recoveryCode })'),
    "createSession() no longer writes the recovery code the way this test assumes — " +
    "re-derive the path before trusting anything below");

  const [dflt, org] = sessionLocationsFromKeys(["abc-234"], { partner: ["xyz-567"] });
  assert.strictEqual(dflt.recoveryPath, "recovery/" + canamedSessionPrefix(null) + "abc-234");
  assert.strictEqual(org.recoveryPath, "recovery/" + canamedSessionPrefix("partner") + "xyz-567");
  assert.strictEqual(dflt.recoveryPath, concrete("recovery/sessions/$sessionId", null, "abc-234"));
  assert.strictEqual(org.recoveryPath,
    concrete("recovery/orgs/$orgSlug/sessions/$sessionId", "partner", "xyz-567"));
});

test("a tree declared for one session tree is declared for the other", () => {
  /* A per-session tree with no org branch is fail-closed for every org session
     (nothing can be written), and one with ONLY an org branch means the default
     tree's records have no rule. Either way the purge is told about half. */
  const byTree = {};
  for (const p of derived.direct) {
    if (p in ACKNOWLEDGED) continue;
    const t = (byTree[treeOf(p)] = byTree[treeOf(p)] || { dflt: 0, org: 0 });
    if (isOrgRule(p)) t.org++; else t.dflt++;
  }
  for (const [tree, n] of Object.entries(byTree)) {
    assert.deepStrictEqual(n, { dflt: 1, org: 1 },
      tree + " is keyed by session " + n.dflt + " time(s) in the default tree and " +
      n.org + " in the org tree; expected exactly one of each");
  }
});

test("the classification carries nothing the rules do not have", () => {
  /* A stale entry is worse than none: it excuses a name that no longer exists,
     and if that name ever comes BACK it arrives pre-excused. */
  const staleNames = Object.keys(NOT_A_SESSION_KEY).filter((n) => !derived.namesSeen.has(n));
  assert.deepStrictEqual(staleNames, [],
    "NOT_A_SESSION_KEY names wildcards the rules no longer use outside the session trees");
  const real = new Set(derived.direct.concat(derived.nested));
  const staleAck = Object.keys(ACKNOWLEDGED).filter((p) => !real.has(p));
  assert.deepStrictEqual(staleAck, [],
    "ACKNOWLEDGED excuses nodes the derivation does not find. Remove them.");
  const stalePerRecord = Object.keys(DECIDED_PER_RECORD).filter((p) => !derived.direct.includes(p));
  assert.deepStrictEqual(stalePerRecord, [],
    "DECIDED_PER_RECORD relaxes the check for nodes the derivation does not find. Remove them.");
  const both = Object.keys(DECIDED_PER_RECORD).filter((p) => p in ACKNOWLEDGED);
  assert.deepStrictEqual(both, [], "a node is either left alone or decided per record, not both");
});

test("every top-level tree is accounted for — one with no session key in the rules is not waved through", () => {
  /* The derivation follows wildcards. A tree declared as `.read:false,
     .write:false` and nothing else has none, so it yields nothing — and "yields
     nothing" must not read as "holds nothing per-session": an admin-only tree
     that a script keys by session code looks exactly like that. */
  const yielding = new Set(derived.direct.concat(derived.nested).map(treeOf));
  const tops = Object.keys(rules).filter((k) => !k.startsWith(".") && !SESSION_TREES.includes(k));
  const unaccounted = tops.filter((t) => !yielding.has(t) && !(t in NO_SESSION_KEY_IN_RULES));
  assert.deepStrictEqual(unaccounted, [],
    "the rules declare these top-level trees and this file can find no session key in " +
    "them. Add each to NO_SESSION_KEY_IN_RULES saying what it is. If a script keys it " +
    "by session all the same, say so there, with what writes it and what deletes it — " +
    "the purge's coverage of it cannot be derived from the rules and is then a claim " +
    "someone has to have checked.");

  const stale = Object.keys(NO_SESSION_KEY_IN_RULES).filter((t) => !tops.includes(t) || yielding.has(t));
  assert.deepStrictEqual(stale, [],
    "NO_SESSION_KEY_IN_RULES lists trees the rules no longer have, or in which the " +
    "derivation now DOES find a session key. Remove them.");
});

test("nothing but `sessions` lives under an org", () => {
  /* The walk skips the `orgs` tree whole, on the strength of this: the purge
     deletes orgs/<slug>/sessions/<id>, and a per-session node anywhere else
     under an org would never be seen by it or by this file. */
  const children = (node) => Object.keys(node).filter((k) => !k.startsWith("."));
  assert.deepStrictEqual(children(rules.orgs), [ORG_KEY]);
  assert.deepStrictEqual(children(rules.orgs[ORG_KEY]), ["sessions"],
    "the rules now declare something beside `sessions` under orgs/<slug>/. If it is " +
    "keyed by session, the purge does not delete it — and nothing here derived it.");
  assert.deepStrictEqual(children(rules.orgs[ORG_KEY].sessions), ["$sessionId"]);
  /* The default tree, for the same reason: a literal key beside `$sessionId`
     (`sessions/_meta/…`) would be skipped by this file with the rest of the
     tree, and enumerated by the purge as if it were a session. */
  assert.deepStrictEqual(children(rules.sessions), ["$sessionId"]);
});

test("a per-session node the purge cannot address by path is acknowledged, not ignored", () => {
  const missing = derived.nested.filter((p) => !(p in ACKNOWLEDGED));
  assert.deepStrictEqual(missing, [],
    "these nodes are keyed by a session code UNDER another wildcard, so the purge " +
    "has no single path for them and they outlive their session. Decide what clock " +
    "they are on and record it in ACKNOWLEDGED.");
});

/* ── THE REAL SCRIPT, in a child process ─────────────────────────────────
 * Same harness as tests/cleanup-passes.test.js: firebase-admin is swapped for
 * an in-memory database at require() time, the script runs to its own
 * process.exit(), and the writes it ATTEMPTED come back in a file. Nothing here
 * reads the script's text. */

const DAY = 24 * 60 * 60 * 1000;
const HANG_TIMEOUT_MS = 20000;
const SLUG = "partner";
const CODES = { dfltExpired: "exd-234", dfltLive: "lvd-234", orgExpired: "exo-567", orgLive: "lvo-567" };

function setAt(tree, p, value) {
  const segs = p.split("/");
  let node = tree;
  for (const s of segs.slice(0, -1)) node = (node[s] = node[s] || {});
  node[segs[segs.length - 1]] = value;
}

function runPurge() {
  const now = Date.now();
  const expired = () => ({ created: { at: now - 100 * DAY }, closed: { at: now - 40 * DAY } });
  const live = () => ({ created: { at: now - 1 * DAY } });
  const tree = { ops: { lastBackup: { at: now - 0.5 * DAY, sessions: 4, uri: "s3://fake" } } };
  setAt(tree, "sessions/" + CODES.dfltExpired, expired());
  setAt(tree, "sessions/" + CODES.dfltLive, live());
  setAt(tree, "orgs/" + SLUG + "/sessions/" + CODES.orgExpired, expired());
  setAt(tree, "orgs/" + SLUG + "/sessions/" + CODES.orgLive, live());
  /* A record under EVERY derived path, for the live sessions as well: a purge
     that reads a tree before deciding (rather than deleting it blind) must have
     something to read, and the live sessions' records are what must survive. */
  for (const rulePath of derived.direct) {
    const codes = isOrgRule(rulePath)
      ? [CODES.orgExpired, CODES.orgLive] : [CODES.dfltExpired, CODES.dfltLive];
    for (const code of codes) setAt(tree, concrete(rulePath, SLUG, code) + "/seeded", { at: 1 });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-coverage-"));
  const outFile = path.join(dir, "writes.json");
  const env = Object.assign({}, process.env);
  // Hermetic: a CLEANUP_* or FAKE_DB_* variable in the developer's shell must
  // not change what this run does.
  for (const k of Object.keys(env)) if (/^(CLEANUP_|FAKE_DB_)/.test(k)) delete env[k];
  try {
    const r = spawnSync(process.execPath, ["-r", PRELOAD, SCRIPT_PATH], {
      encoding: "utf8",
      timeout: HANG_TIMEOUT_MS,
      env: Object.assign(env, {
        FAKE_DB_TREE: JSON.stringify(tree),
        FAKE_DB_WRITES_OUT: outFile,
        FIREBASE_DATABASE_URL: "https://fake-db.invalid",
        // What .github/workflows/cleanup-stale-sessions.yml sets on the cron.
        CLEANUP_CONFIRM: "1",
        CLEANUP_QUIET: "1",
        CLEANUP_REQUIRE_BACKUP: "1",
        CLEANUP_BACKUP_MAX_AGE_DAYS: "2"
      })
    });
    const log = "\n--- stdout ---\n" + r.stdout + "\n--- stderr ---\n" + r.stderr;
    assert.ok(!r.error && r.status !== null,
      "the script did not end by itself and was killed after " + HANG_TIMEOUT_MS + " ms." + log);
    assert.strictEqual(r.status, 0, "the purge run must be clean." + log);
    const writes = JSON.parse(fs.readFileSync(outFile, "utf8")).writes;
    return { writes, log, stdout: r.stdout, stderr: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* One run for the whole section: the child process is the slow part. */
let purgeRun = null;
const purge = () => (purgeRun = purgeRun || runPurge());

/** The ONE root-level update that deleted `sessionPath`, as a list of keys. */
function updateFor(sessionPath) {
  const hits = purge().writes.filter((w) =>
    w.op === "update" && w.path === "" && w.keys.includes(sessionPath));
  assert.strictEqual(hits.length, 1,
    "expected exactly one root update deleting " + sessionPath + purge().log);
  return hits[0].keys;
}

/* Deleted WHOLE: the node's own path is in the update. A delete of something
   under it is not the same thing — the rest of the node stays — and only counts
   for a rule path listed in DECIDED_PER_RECORD, where staying is the decision.
   (Every node is seeded with one plain record, so "something under it" is at
   least that record going.) */
function goesWithSession(keys, rulePath, p) {
  if (keys.includes(p)) return true;
  return rulePath in DECIDED_PER_RECORD && keys.some((k) => k.startsWith(p + "/"));
}

for (const [label, sessionPath, code, wantOrg] of [
  ["default tree", "sessions/" + CODES.dfltExpired, CODES.dfltExpired, false],
  ["org tree", "orgs/" + SLUG + "/sessions/" + CODES.orgExpired, CODES.orgExpired, true]
]) {
  test("REAL SCRIPT, " + label + ": every per-session node the rules declare goes with the session", () => {
    const keys = updateFor(sessionPath);
    const left = derived.direct
      .filter((p) => isOrgRule(p) === wantOrg && !(p in ACKNOWLEDGED))
      .filter((p) => !goesWithSession(keys, p, concrete(p, SLUG, code)))
      .map((p) => concrete(p, SLUG, code));
    assert.deepStrictEqual(left, [],
      "database.rules.json keys these by session, the session was purged, and they " +
      "were not deleted whole — in the same update or not at all, because once the " +
      "session is gone no enumeration can find them again. Add each to locationFor() " +
      "in scripts/lib/session-trees.js and to the purge map in " +
      "cleanup-stale-sessions.js; or, in this file, to ACKNOWLEDGED (left alone on " +
      "purpose) or DECIDED_PER_RECORD (deleted record by record, some may stay), with " +
      "the reason.\nThe update wrote:\n  " + keys.join("\n  ") + purge().log);
  });

  test("REAL SCRIPT, " + label + ": the recovery code is in the SAME atomic update as the session", () => {
    /* The defect, named. Separate from the derived check above so that a
       failure says which secret was left behind rather than "a node". */
    const keys = updateFor(sessionPath);
    const recovery = wantOrg
      ? "recovery/orgs/" + SLUG + "/sessions/" + code
      : "recovery/sessions/" + code;
    assert.ok(keys.includes(recovery),
      recovery + " was not deleted with its session. It holds the code that resets " +
      "the admin password AT THAT SESSION CODE, and it is write-once: while it " +
      "stands, nobody can create a session there again.\nThe update wrote:\n  " +
      keys.join("\n  "));
  });
}

test("REAL SCRIPT: a live session keeps everything, its recovery code included", () => {
  /* The control. Without it the tests above pass just as well for a purge that
     deletes every recovery code in the database — and a live session that loses
     its code has lost the only way to reset a forgotten password.

     A write can reach a live session three ways, and all three are checked:
     AT one of its paths, BELOW one, or ABOVE one. The last is the one a search
     for the session's code misses — `recovery/orgs/<slug>: null` names no code
     and deletes every live code in that org (found in review: exactly that
     mutant survived the whole suite).

     ONE write below a live session is meant, and it is named rather than
     waved through: a null at <session>/_superadminReset, the old reset-flag
     node, where a leftover holds the recovery code in clear. No client can
     write that node any more, so the purge clears it for every session it
     keeps — in an update of its own, which must carry nothing else. */
  const live = sessionLocationsFromKeys([CODES.dfltLive], { [SLUG]: [CODES.orgLive] });
  const livePaths = live.flatMap((loc) =>
    Object.entries(loc).filter(([prop]) => prop === "path" || /Path$/.test(prop)).map(([, p]) => p));
  assert.ok(livePaths.includes("recovery/sessions/" + CODES.dfltLive) &&
    livePaths.includes("recovery/orgs/" + SLUG + "/sessions/" + CODES.orgLive),
    "the live sessions' recovery paths are not among the paths being protected");

  const meant = live.map((loc) => loc.path + "/_superadminReset").sort();
  const clearing = purge().writes.filter((w) =>
    w.op === "update" && w.path === "" && w.keys.some((k) => meant.includes(k)));
  assert.strictEqual(clearing.length, 1,
    "expected exactly one update clearing the old reset-flag node of the sessions kept" + purge().log);
  assert.deepStrictEqual(clearing[0].keys.slice().sort(), meant,
    "that update must name the old reset-flag node of EVERY session kept, and nothing " +
    "else — not a purged session's (its subtree is gone), not another node of a live one");

  const written = purge().writes.flatMap((w) =>
    (w.keys && w.keys.length ? w.keys : [""]).map((k) => (w.path ? w.path + (k ? "/" + k : "") : k)));
  const hits = [];
  for (const k of written) {
    if (meant.includes(k)) continue;
    for (const p of livePaths) {
      if (k === p || k.startsWith(p + "/") || p.startsWith(k + "/") || k === "") {
        hits.push(k + "  (reaches " + p + ")");
      }
    }
  }
  assert.deepStrictEqual(hits, [],
    "the purge wrote at, below or above a path of a session that is one day old" + purge().log);
  assert.match(purge().stdout, /Summary: 2 kept, 2 purged, 0 errors\./);
});

test("REAL SCRIPT: with CLEANUP_QUIET=1 no session code reaches the log", () => {
  const out = purge().stdout + purge().stderr;
  for (const code of Object.values(CODES)) {
    assert.ok(!out.includes(code), "a session code was printed to a world-readable log");
  }
});
