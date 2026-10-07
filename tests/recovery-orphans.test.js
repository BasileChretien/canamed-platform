"use strict";
/* tests/recovery-orphans.test.js
 *
 * The one-off sweep for recovery records whose session is gone
 * (scripts/sweep-orphaned-recovery.js, scripts/lib/recovery-orphans.js).
 *
 * The purge deletes a recovery record WITH its session since the fix of
 * 2026-10-07; the records it left before that have no session to be found
 * through, so the sweep starts from the records instead. That direction is what
 * makes it dangerous: anything that makes a LIVE session look absent turns its
 * record into an "orphan", and deleting that one is silent and permanent — the
 * facilitator can no longer reset a forgotten password. So most of this file is
 * about what the sweep must NOT delete:
 *
 *   - a record whose session exists, in either tree;
 *   - a record whose code is live in the OTHER tree only (same code, two trees);
 *   - anything at all when a tree that holds records lists no session, unless
 *     told to — per tree, so a node in one tree cannot vouch for another;
 *   - anything at all when a list cannot be read as a list;
 *   - a session created while the sweep is reading (the order of the reads);
 *   - another slug's records, because a key was put into a URL unencoded.
 *
 * Three levels, as in tests/cleanup-passes.test.js: the pure plan, the reads
 * against an injected reader, then THE REAL SCRIPT in a child process against
 * an in-memory database, asserting on the complete list of writes it attempted.
 * Every refusal is paired with a run that is allowed on the same database.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  BATCH_SIZE, makeSweepReader, readRecoveryKeys, planRecoverySweep, findOrphanedRecovery,
  deleteRecoveryRecords, describeBatchError, describeFatal, batches
} = require("../scripts/lib/recovery-orphans");
const { encodePath: anonJobEncodePath } = require("../scripts/lib/anonymous-retention-job");
const {
  sessionLocationsFromKeys, makeRestShallowReader, makeRestValueReader, encodeRestPath
} = require("../scripts/lib/session-trees");

const ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "sweep-orphaned-recovery.js");
const PRELOAD = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");
const FAILING_UPDATE = path.join(__dirname, "fixtures", "failing-update-preload.js");
const WORKFLOW =path.join(ROOT, ".github", "workflows", "sweep-orphaned-recovery.yml");

/* ── the plan ────────────────────────────────────────────────────────── */

test("a record with no session is an orphan; a record with one is kept — both trees", () => {
  const live = sessionLocationsFromKeys(["liv-aaa"], { partner: ["liv-bbb"] });
  const plan = planRecoverySweep(
    { codes: ["liv-aaa", "old-aaa"], orgCodes: { partner: ["liv-bbb", "old-bbb"], gone: ["old-ccc"] } },
    live
  );
  assert.deepStrictEqual(plan.orphans.sort(), [
    "recovery/orgs/gone/sessions/old-ccc",
    "recovery/orgs/partner/sessions/old-bbb",
    "recovery/sessions/old-aaa"
  ]);
  assert.strictEqual(plan.records, 5);
  assert.strictEqual(plan.kept, 2);
  assert.strictEqual(plan.orphansDefault, 1);
  assert.strictEqual(plan.orphansOrg, 2);
});

test("the same code in two trees is two records — being live in one does not keep the other", () => {
  /* And the reverse, which is the dangerous direction: a code that is live in
     the ORG tree must not be judged by the default tree's list. */
  const liveInDefault = planRecoverySweep(
    { codes: ["abc-234"], orgCodes: { partner: ["abc-234"] } },
    sessionLocationsFromKeys(["abc-234"], {})
  );
  assert.deepStrictEqual(liveInDefault.orphans, ["recovery/orgs/partner/sessions/abc-234"]);

  const liveInOrg = planRecoverySweep(
    { codes: ["abc-234"], orgCodes: { partner: ["abc-234"] } },
    sessionLocationsFromKeys([], { partner: ["abc-234"] })
  );
  assert.deepStrictEqual(liveInOrg.orphans, ["recovery/sessions/abc-234"]);
});

test("nothing recorded, nothing to sweep", () => {
  const plan = planRecoverySweep({ codes: [], orgCodes: {} }, sessionLocationsFromKeys(["a"], {}));
  assert.deepStrictEqual(plan, {
    records: 0, kept: 0, orphans: [], orphansDefault: 0, orphansOrg: 0,
    emptyDefaultTree: false, emptyOrgTrees: 0
  });
});

test("EMPTY TREES are counted per tree — a session in one tree does not vouch for another", () => {
  const keys = { codes: ["old-aaa"], orgCodes: { partner: ["old-bbb"], gone: ["old-ccc"] } };
  const empty = (live) => {
    const p = planRecoverySweep(keys, live);
    return [p.emptyDefaultTree, p.emptyOrgTrees];
  };

  assert.deepStrictEqual(empty(sessionLocationsFromKeys([], {})), [true, 2],
    "no session anywhere: all three trees hold records and list nothing");
  /* THE CASE THIS EXISTS FOR. One node under some org — which a signed-in
     visitor can create — while the default tree lists none. Counted over the
     whole database that reads as "there are sessions". */
  assert.deepStrictEqual(empty(sessionLocationsFromKeys([], { junk: ["x"] })), [true, 2],
    "a node in an unrelated org tree must not clear the default tree or the other orgs");
  assert.deepStrictEqual(empty(sessionLocationsFromKeys(["liv"], {})), [false, 2],
    "the default tree has a session; the two org trees still list none");
  assert.deepStrictEqual(empty(sessionLocationsFromKeys(["liv"], { partner: ["liv"] })), [false, 1]);
  assert.deepStrictEqual(empty(sessionLocationsFromKeys(["liv"], { partner: ["a"], gone: ["b"] })),
    [false, 0], "the control: every tree with records lists a session");

  /* A tree with NO records is never "empty with records", sessions or not. */
  const none = planRecoverySweep({ codes: [], orgCodes: { partner: [] } }, sessionLocationsFromKeys([], {}));
  assert.deepStrictEqual([none.emptyDefaultTree, none.emptyOrgTrees], [false, 0]);
});

test("the error line for a failed batch carries the CODE and the size — never the message", () => {
  /* The message is where firebase-admin puts the path, and the path ends in a
     session code. */
  const e = Object.assign(new Error("update at /recovery/sessions/abc-234 failed: permission_denied"),
    { code: "PERMISSION_DENIED" });
  const line = describeBatchError(e, 12);
  assert.strictEqual(line, "ERROR    a batch of 12 was not deleted: PERMISSION_DENIED");
  assert.ok(!line.includes("abc-234"));

  for (const odd of [new Error("x at recovery/sessions/abc-234"), { code: "" }, { code: 7 }, null, undefined, "abc-234"]) {
    assert.strictEqual(describeBatchError(odd, 3), "ERROR    a batch of 3 was not deleted: error",
      "with no usable code the line says only that it failed");
  }
});

test("batches() covers every path once, in order", () => {
  const list = Array.from({ length: 11 }, (_, i) => "p" + i);
  const parts = batches(list, 4);
  assert.deepStrictEqual(parts.map((p) => p.length), [4, 4, 3]);
  assert.deepStrictEqual(parts.flat(), list);
  assert.deepStrictEqual(batches([], 4), []);
});

test("a batch that fails is counted and skipped — the batches after it still run", async () => {
  /* Each batch is its own all-or-nothing update, so one refusal must not strand
     the rest; and the caller is handed the ERROR, not a message built here,
     because only the caller knows what its log may show. */
  const paths = Array.from({ length: 7 }, (_, i) => "recovery/sessions/p" + i);
  const updates = [], errors = [];
  const db = {
    ref(p) {
      assert.strictEqual(p, undefined, "deletes go through ONE root-level update per batch");
      return {
        async update(obj) {
          updates.push(Object.keys(obj));
          assert.ok(Object.values(obj).every((v) => v === null), "a sweep only ever writes null");
          if (updates.length === 2) throw Object.assign(new Error("boom at recovery/sessions/p3"), { code: "PERMISSION_DENIED" });
        }
      };
    }
  };
  const r = await deleteRecoveryRecords(db, paths, {
    batchSize: 3, onError: (e, size) => errors.push([e.code, size])
  });
  assert.deepStrictEqual(updates.map((u) => u.length), [3, 3, 1]);
  assert.deepStrictEqual(r, { deleted: 4, failedBatches: 1 });
  assert.deepStrictEqual(errors, [["PERMISSION_DENIED", 3]]);
});

/* ── the reads ───────────────────────────────────────────────────────── */

/* A reader over a plain tree that answers the way `?shallow=true` does — keys
   mapped to true, never a value — and records what it was asked for. */
function shallowReader(tree, asked) {
  return async (p) => {
    asked.push(p);
    const node = p.split("/").reduce(
      (n, k) => (n && typeof n === "object" && k in n ? n[k] : null), tree);
    return node && typeof node === "object"
      ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null;
  };
}

const TREE = {
  sessions: { "liv-aaa": { created: { at: 1 } } },
  orgs: { partner: { sessions: { "liv-bbb": { created: { at: 2 } } } } },
  recovery: {
    sessions: { "liv-aaa": { code: "SECRET-LIVE-A" }, "old-aaa": { code: "SECRET-OLD-A" } },
    orgs: { partner: { sessions: { "liv-bbb": { code: "SECRET-LIVE-B" }, "old-bbb": { code: "SECRET-OLD-B" } } } }
  }
};

test("the recovery keys are read in both trees, and no path that holds a code is ever requested", async () => {
  const asked = [];
  const keys = await readRecoveryKeys(shallowReader(TREE, asked));
  assert.deepStrictEqual(keys.codes, ["liv-aaa", "old-aaa"]);
  assert.deepStrictEqual(Object.entries(keys.orgCodes), [["partner", ["liv-bbb", "old-bbb"]]]);
  assert.strictEqual(Object.getPrototypeOf(keys.orgCodes), null,
    "slugs are collected into an object WITH a prototype again — see the __proto__ test");
  assert.deepStrictEqual(asked,
    ["recovery/sessions", "recovery/orgs", "recovery/orgs/partner/sessions"],
    "three LISTS. A read of recovery/sessions/<code> would return the secret itself.");
});

test("ORDER: every recovery list is read before any session list", async () => {
  /* The safety of the whole sweep. A session created between the two reads is
     unknown to whichever list is older: read sessions first and its record is
     in the (newer) recovery list with no session beside it — an "orphan" that
     is one second old and very much alive. */
  const asked = [];
  const found = await findOrphanedRecovery(shallowReader(TREE, asked));
  const firstSessionRead = asked.findIndex((p) => !p.startsWith("recovery/"));
  const lastRecoveryRead = asked.map((p) => p.startsWith("recovery/")).lastIndexOf(true);
  assert.ok(firstSessionRead > 0, "the session trees were never read: " + asked.join(", "));
  assert.ok(lastRecoveryRead < firstSessionRead,
    "a session list was read before the recovery lists were complete: " + asked.join(", "));

  assert.deepStrictEqual(found.orphans.sort(),
    ["recovery/orgs/partner/sessions/old-bbb", "recovery/sessions/old-aaa"]);
  assert.strictEqual(found.liveSessions, 2);
});

test("ORDER, demonstrated: a session created mid-sweep survives recovery-first and would not survive sessions-first", async () => {
  /* The database CHANGES between the two phases: a session is created at the
     moment the reads switch from one kind of list to the other — WHICHEVER
     kind came first, so this does not assume the order it is testing. */
  const before = { sessions: {}, orgs: {}, recovery: { sessions: {}, orgs: {} } };
  before.sessions["liv-aaa"] = { created: { at: 1 } };
  before.recovery.sessions["liv-aaa"] = { code: "x" };
  const create = (tree) => {
    tree.sessions["new-zzz"] = { created: { at: 9 } };
    tree.recovery.sessions["new-zzz"] = { code: "y" };
  };
  const clone = () => JSON.parse(JSON.stringify(before));

  // The function as shipped.
  const t1 = clone();
  let firstKind = null, created = false;
  const real = shallowReader(t1, []);
  const found = await findOrphanedRecovery(async (p) => {
    const kind = p.startsWith("recovery/") ? "recovery" : "sessions";
    if (firstKind === null) firstKind = kind;
    if (kind !== firstKind && !created) { created = true; create(t1); }
    return real(p);
  });
  assert.strictEqual(created, true, "the reads never changed kind, so nothing was created mid-sweep");
  assert.deepStrictEqual(found.orphans, [],
    "a session created between the two phases had its record judged an orphan");

  // The other order, by hand: sessions listed, THEN the session appears, THEN recovery listed.
  const t2 = clone();
  const live = sessionLocationsFromKeys(Object.keys(t2.sessions), {});
  create(t2);
  const wrong = planRecoverySweep(await readRecoveryKeys(shallowReader(t2, [])), live);
  assert.deepStrictEqual(wrong.orphans, ["recovery/sessions/new-zzz"],
    "control: sessions-first DOES condemn the new session's record — if this stops " +
    "being true the ordering test above is no longer testing anything");
});

test("a list that is not a list stops the sweep — it is never read as 'no sessions'", async () => {
  /* shallowKeysOf() throws on anything that is not an object of keys or null.
     Here that matters in the DANGEROUS direction: sessions read as empty makes
     every record an orphan. */
  /* The two PER-ORG lists as well as the four top-level ones. An org's session
     list read as empty is the same hazard one level down — every live session
     of that org looks absent — and nothing failed that read in any test until
     a review turned its failure into `[]` and the whole suite stayed green. */
  for (const bad of ["sessions", "orgs", "orgs/partner/sessions",
    "recovery/sessions", "recovery/orgs", "recovery/orgs/partner/sessions"]) {
    const asked = [];
    const real = shallowReader(TREE, asked);
    await assert.rejects(
      findOrphanedRecovery(async (p) => (p === bad ? "Permission denied" : real(p))),
      /Refusing to treat this as an empty tree/,
      "a string body for '" + bad + "' must throw");
  }
  /* …and each of those six is a list the sweep really reads, or the loop above
     proves nothing about it. */
  const asked = [];
  await findOrphanedRecovery(shallowReader(TREE, asked));
  assert.deepStrictEqual(asked.slice().sort(), ["orgs", "orgs/partner/sessions",
    "recovery/orgs", "recovery/orgs/partner/sessions", "recovery/sessions", "sessions"]);
});

test("a slug named __proto__ is listed, counted and swept like any other", async () => {
  /* A legal key, and under recovery/orgs/ no rule says otherwise. Collected
     into a plain object, `orgCodes["__proto__"] = [...]` sets the prototype and
     adds no key: the slug's records were never listed, and the run ended
     "nothing to sweep" with the orphan still there. (JSON.parse, not a literal:
     in source code `{ "__proto__": x }` sets the prototype too.) */
  const tree = JSON.parse(
    '{"sessions":{"liv-aaa":{"created":{"at":1}}},' +
    '"recovery":{"sessions":{"liv-aaa":{"code":"k"}},' +
    '"orgs":{"__proto__":{"sessions":{"old-ppp":{"code":"p"}}}}}}');
  const keys = await readRecoveryKeys(shallowReader(tree, []));
  assert.deepStrictEqual(Object.keys(keys.orgCodes), ["__proto__"]);
  assert.deepStrictEqual(keys.orgCodes["__proto__"], ["old-ppp"]);

  const found = await findOrphanedRecovery(shallowReader(tree, []));
  assert.deepStrictEqual(found.orphans, ["recovery/orgs/__proto__/sessions/old-ppp"]);
  assert.strictEqual(found.emptyOrgTrees, 1);

  const r = runSweep(tree, { RECOVERY_SWEEP_CONFIRM: "1", RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes,
    [{ op: "update", path: "", keys: ["recovery/orgs/__proto__/sessions/old-ppp"] }], r.log);
});

test("the FATAL line carries a code or a name — never the message", () => {
  /* A JSON parse error quotes the start of the body it failed on, and the body
     of a list read is session codes. */
  let parseError;
  try { JSON.parse('abc-234":true'); } catch (e) { parseError = e; }
  assert.ok(parseError.message.includes("abc"), "precondition: the engine's message quotes the body");
  assert.strictEqual(describeFatal(parseError), "FATAL: SyntaxError");

  assert.strictEqual(describeFatal(Object.assign(new Error("read of 'sessions/abc-234' failed"), { code: "HTTP_401" })),
    "FATAL: HTTP_401");
  assert.strictEqual(describeFatal(new Error("needs an https databaseURL")), "FATAL: Error");
  for (const odd of [null, undefined, "abc-234", { message: "abc-234" }, { code: 5, name: "" }]) {
    assert.strictEqual(describeFatal(odd), "FATAL: error");
  }
});

/* ── the REST reader: a key is not always one the platform wrote ─────────
 * Found in review. The sweep is the first job to read lists under
 * `recovery/orgs/<slug>`, and no rule validates that slug (the one under
 * `orgs/` must match /^[a-z0-9-]+$/; this one may be anything a key may be).
 * Put into a URL as it stands, such a key reads a different node.
 *
 * WHERE the encoding happens is the other half, and it was got wrong once: the
 * first fix encoded inside the SHARED reader, which the anonymous-account job
 * calls with paths it has already encoded. That job then read `My%2520Code`
 * for the key `My Code`, got null, and took it for "no members to protect" —
 * in a job that deletes on a schedule. So: the shared reader sends what it is
 * given, and each caller encodes once. Both halves are pinned below. */

const FAKE_APP = { options: { credential: { getAccessToken: async () => ({ access_token: "t" }) } } };

/* The URLs the REAL reader requests, with fetch stubbed for the duration. */
async function urlsFor(makeReader, paths) {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => null }; };
  try {
    const read = makeReader({ app: FAKE_APP, databaseURL: "https://db.invalid/" });
    for (const p of paths) await read(p);
  } finally {
    globalThis.fetch = realFetch;
  }
  return urls;
}

test("SHARED reader: it requests exactly the path it is given — it does not encode", async () => {
  /* Every other job's requests are unchanged by this branch, for every key,
     because the shared reader is unchanged: clean paths and already-encoded
     ones alike go out verbatim. */
  const given = [
    "sessions", "orgs", "orgs/caen-nagoya/sessions", "sessions/abc-234/members",
    "users/AbCdEf0123456789_xyzUID12345Qq", "rateLimits/session/abc-234",
    "sessions/My%20Code/members", "sessions/a%3Fb/creatorUid"
  ];
  assert.deepStrictEqual(await urlsFor(makeRestShallowReader, given),
    given.map((p) => "https://db.invalid/" + p + ".json?shallow=true"));
  assert.deepStrictEqual(await urlsFor(makeRestValueReader, given),
    given.map((p) => "https://db.invalid/" + p + ".json"));
});

test("SHARED reader + the anonymous-account job's own encoding: a key is encoded ONCE", async () => {
  /* The regression, through that job's real encoder. It encodes the path and
     hands it to the shared reader; the request must carry `My%20Code`, which
     the server decodes back to the key `My Code`. `My%2520Code` is the key
     `My%20Code` — some other session, or none: a null that reads as "nobody to
     protect". */
  const paths = ["sessions/My Code/members", "sessions/a?b/creatorUid", "users/plain_uid-1"];
  const urls = await urlsFor(makeRestShallowReader, paths.map(anonJobEncodePath));
  assert.deepStrictEqual(urls, [
    "https://db.invalid/sessions/My%20Code/members.json?shallow=true",
    "https://db.invalid/sessions/a%3Fb/creatorUid.json?shallow=true",
    "https://db.invalid/users/plain_uid-1.json?shallow=true"
  ]);
  for (const u of urls) assert.ok(!u.includes("%25"), "encoded twice: " + u);
});

test("SWEEP reader: a clean path is requested as it stands", async () => {
  const clean = ["sessions", "orgs", "orgs/caen-nagoya/sessions",
    "recovery/sessions", "recovery/orgs", "recovery/orgs/partner-2/sessions"];
  for (const p of clean) assert.strictEqual(encodeRestPath(p), p, "encoding changed '" + p + "'");
  assert.deepStrictEqual(await urlsFor(makeSweepReader, clean),
    clean.map((p) => "https://db.invalid/" + p + ".json?shallow=true"));
});

test("SWEEP reader: a key with a '?' stays inside the path instead of ending it", async () => {
  /* Unencoded, the request is for `recovery/orgs/a` with a query string of
     `b/sessions.json?shallow=true` — not the list that was asked for, and with
     the `shallow` flag no longer a parameter of its own. */
  const [url] = await urlsFor(makeSweepReader, ["recovery/orgs/a?b/sessions"]);
  assert.strictEqual(url, "https://db.invalid/recovery/orgs/a%3Fb/sessions.json?shallow=true");
  assert.strictEqual(url.split("?").length, 2, "exactly one '?': the one before shallow=true");
});

test("SWEEP reader: a key that LOOKS encoded is not decoded into a different key", async () => {
  /* `x%20y` is a legal key, and so is `x y`. Sent as it stands, the server
     decodes the first into the second and answers with the OTHER slug's
     sessions — which the sweep would then plan against the first slug's paths,
     as orphans that are never there to delete and never go away. */
  const urls = await urlsFor(makeSweepReader,
    ["recovery/orgs/x%20y/sessions", "recovery/orgs/x y/sessions", "recovery/orgs/a&b=c/sessions"]);
  assert.deepStrictEqual(urls, [
    "https://db.invalid/recovery/orgs/x%2520y/sessions.json?shallow=true",
    "https://db.invalid/recovery/orgs/x%20y/sessions.json?shallow=true",
    "https://db.invalid/recovery/orgs/a%26b%3Dc/sessions.json?shallow=true"
  ]);
  assert.notStrictEqual(urls[0], urls[1], "two different keys must be two different requests");
  for (const u of urls) {
    const path = new URL(u).pathname;
    assert.ok(path.endsWith("/sessions.json"), "the path no longer ends at the list: " + path);
    assert.strictEqual(new URL(u).search, "?shallow=true");
  }
});

test("encodeRestPath: the slashes BETWEEN segments are kept", () => {
  assert.strictEqual(encodeRestPath("a/b c/d"), "a/b%20c/d");
  assert.strictEqual(encodeRestPath("recovery/orgs/é/sessions"), "recovery/orgs/%C3%A9/sessions");
});

/* ── THE REAL SCRIPT, in a child process ─────────────────────────────── */

const HANG_TIMEOUT_MS = 20000;

function runSweep(tree, extraEnv, extraPreloads) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-sweep-"));
  const outFile = path.join(dir, "writes.json");
  const env = Object.assign({}, process.env);
  // Hermetic: nothing in the developer's shell may arm a delete.
  for (const k of Object.keys(env)) if (/^(RECOVERY_SWEEP_|FAKE_DB_)/.test(k)) delete env[k];
  const preloads = [PRELOAD].concat(extraPreloads || []).flatMap((p) => ["-r", p]);
  try {
    const r = spawnSync(process.execPath, preloads.concat(SCRIPT_PATH), {
      encoding: "utf8",
      timeout: HANG_TIMEOUT_MS,
      env: Object.assign(env, {
        FAKE_DB_TREE: JSON.stringify(tree),
        FAKE_DB_WRITES_OUT: outFile,
        FIREBASE_DATABASE_URL: "https://fake-db.invalid"
      }, extraEnv)
    });
    const log = "\n--- stdout ---\n" + r.stdout + "\n--- stderr ---\n" + r.stderr;
    assert.ok(!r.error && r.status !== null,
      "the script did not end by itself and was killed after " + HANG_TIMEOUT_MS + " ms — " +
      "a path through main() returns without process.exit()." + log);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, log,
      writes: JSON.parse(fs.readFileSync(outFile, "utf8")).writes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ORPHANS = ["recovery/orgs/partner/sessions/old-bbb", "recovery/sessions/old-aaa"];
const CODES = ["liv-aaa", "old-aaa", "liv-bbb", "old-bbb"];
const SECRETS = ["SECRET-LIVE-A", "SECRET-OLD-A", "SECRET-LIVE-B", "SECRET-OLD-B"];

function assertNothingSensitive(r) {
  const out = r.stdout + r.stderr;
  for (const s of CODES.concat(SECRETS)) {
    assert.ok(!out.includes(s),
      "'" + s + "' reached the output. The sweep prints counts only: these logs are " +
      "world-readable." + r.log);
  }
}

test("REAL SCRIPT, default mode: a DRY RUN — it reports the two orphans and writes nothing", () => {
  const r = runSweep(TREE, {});
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [], "a dry run must not write." + r.log);
  assert.match(r.stdout, /Mode:\s+DRY-RUN/);
  assert.match(r.stdout, /Recovery records:\s+4/);
  assert.match(r.stdout, /with a session \(kept\):\s+2/);
  assert.match(r.stdout, /with no session:\s+2 \(1 default, 1 org-scoped\)/);
  assert.match(r.stdout, /Summary: 2 would be deleted\. Set RECOVERY_SWEEP_CONFIRM=1/);
  assertNothingSensitive(r);
});

test("REAL SCRIPT, confirmed: ONE root update deleting exactly the orphans — the control for the dry run", () => {
  /* Same database. Without this the dry-run test could not tell "it held back"
     from "this harness never reaches the delete". */
  const r = runSweep(TREE, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, [{ op: "update", path: "", keys: ORPHANS }],
    "exactly the two records with no session. The two live sessions' records, and " +
    "everything outside recovery/, are untouched." + r.log);
  assert.match(r.stdout, /Summary: 2 deleted, 0 left\./);
  assertNothingSensitive(r);
});

test("REAL SCRIPT: anything but \"1\" is a dry run", () => {
  for (const v of ["true", "yes", "0", " 1", ""]) {
    const r = runSweep(TREE, { RECOVERY_SWEEP_CONFIRM: v });
    assert.deepStrictEqual(r.writes, [], "RECOVERY_SWEEP_CONFIRM=" + JSON.stringify(v) + " deleted." + r.log);
  }
});

test("REAL SCRIPT: nothing orphaned — no write, exit 0", () => {
  const tidy = JSON.parse(JSON.stringify(TREE));
  delete tidy.recovery.sessions["old-aaa"];
  delete tidy.recovery.orgs.partner.sessions["old-bbb"];
  const r = runSweep(tidy, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes, []);
  assert.match(r.stdout, /Summary: nothing to sweep\./);
});

/* TWO overrides, one per kind of tree, and neither waives the other. */
const DEFAULT_FLAG = "RECOVERY_SWEEP_ALLOW_EMPTY_DEFAULT_TREE";
const ORGS_FLAG = "RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES";
const confirmWith = (...flags) => Object.assign({ RECOVERY_SWEEP_CONFIRM: "1" },
  Object.fromEntries(flags.map((f) => [f, "1"])));

/* `trees`: how many trees are still blocking. `flags`: exactly the overrides the
   message must ask for — and no other, or it invites the operator to waive a
   guard that was not in the way. */
function assertRefused(r, trees, flags) {
  assert.strictEqual(r.status, 2, "a tree with records and no session must stop the run." + r.log);
  assert.deepStrictEqual(r.writes, [], "a refused run must not write." + r.log);
  assert.match(r.stderr, new RegExp("REFUSED: " + trees + " tree\\(s\\) hold recovery records and list no session"));
  for (const f of [DEFAULT_FLAG, ORGS_FLAG]) {
    assert.strictEqual(r.stderr.includes(f + "=1"), flags.includes(f),
      "the refusal " + (flags.includes(f) ? "does not name " : "names ") + f + r.log);
  }
  assertNothingSensitive(r);
}

test("REAL SCRIPT: NO session listed at all — refused, exit 2, nothing deleted, even when confirmed", () => {
  /* The state in which every record looks orphaned. It is also what a wrong
     database URL, or a tree that moved, looks like. */
  const empty = { recovery: TREE.recovery };
  assertRefused(runSweep(empty, confirmWith()), 2, [DEFAULT_FLAG, ORGS_FLAG]);
  // A dry run is refused too: its count would mislead.
  assertRefused(runSweep(empty, {}), 2, [DEFAULT_FLAG, ORGS_FLAG]);

  /* ONE OVERRIDE DOES NOT WAIVE THE OTHER TREE'S GUARD (found in review, when
     there was a single switch). The dangerous half: a visitor plants a record
     under a new org slug, the operator ticks the box for it — and with one
     switch the default tree's guard was off in that same run, deleting a live
     session's record if the default list was empty for a bad reason. */
  assertRefused(runSweep(empty, confirmWith(ORGS_FLAG)), 1, [DEFAULT_FLAG]);
  assertRefused(runSweep(empty, confirmWith(DEFAULT_FLAG)), 1, [ORGS_FLAG]);

  // …and the same database, with the operator saying so for BOTH: all four go.
  const allowed = runSweep(empty, confirmWith(DEFAULT_FLAG, ORGS_FLAG));
  assert.strictEqual(allowed.status, 0, allowed.log);
  assert.strictEqual(allowed.writes.length, 1);
  assert.strictEqual(allowed.writes[0].keys.length, 4);
});

test("REAL SCRIPT: the default tree lists nothing and ONE junk node sits under an org — still refused", () => {
  /* Found in review. Any signed-in visitor can create a node under
     orgs/<anything>/sessions/<anything>. Counting sessions over the whole
     database, that one node said "there are sessions", and a confirmed run
     deleted every default-tree record without refusing. */
  const junk = {
    orgs: { squat: { sessions: { x: { members: { u1: { at: 1 } } } } } },
    recovery: { sessions: TREE.recovery.sessions }
  };
  const r = runSweep(junk, confirmWith());
  assertRefused(r, 1, [DEFAULT_FLAG]);
  assert.match(r.stdout, /Sessions in the database:\s+1/, "precondition: the junk node IS counted as a session");
  assert.match(r.stdout, /Trees with records and NO session: 1 \(default tree: yes; org trees: 0\)/);
  // The org override is the wrong one for this, and must not open it.
  assertRefused(runSweep(junk, confirmWith(ORGS_FLAG)), 1, [DEFAULT_FLAG]);

  // The control: same database, the operator asserts it. Both default records go.
  const allowed = runSweep(junk, confirmWith(DEFAULT_FLAG));
  assert.strictEqual(allowed.status, 0, allowed.log);
  assert.deepStrictEqual(allowed.writes,
    [{ op: "update", path: "", keys: ["recovery/sessions/liv-aaa", "recovery/sessions/old-aaa"] }]);
});

test("REAL SCRIPT: an ORG tree with records and no session is refused even when the default tree is healthy", () => {
  /* The same guard from the other side: the default tree's sessions must not
     vouch for an org whose list came back empty. */
  const lopsided = {
    sessions: TREE.sessions,
    recovery: { sessions: TREE.recovery.sessions, orgs: TREE.recovery.orgs }
  };
  const r = runSweep(lopsided, confirmWith());
  assertRefused(r, 1, [ORGS_FLAG]);
  assert.match(r.stdout, /Trees with records and NO session: 1 \(default tree: no; org trees: 1\)/);
  assert.ok(!(r.stdout + r.stderr).includes("partner"),
    "an org tree is counted, not named: a slug under recovery/orgs is whatever its writer typed");
  assertRefused(runSweep(lopsided, confirmWith(DEFAULT_FLAG)), 1, [ORGS_FLAG]);

  const allowed = runSweep(lopsided, confirmWith(ORGS_FLAG));
  assert.strictEqual(allowed.status, 0, allowed.log);
  assert.deepStrictEqual(allowed.writes, [{ op: "update", path: "", keys: [
    "recovery/orgs/partner/sessions/liv-bbb", "recovery/orgs/partner/sessions/old-bbb",
    "recovery/sessions/old-aaa"
  ] }], "with the flag: the org's two records and the default tree's one orphan — " +
    "and NOT the default tree's live record");
});

test("REAL SCRIPT: a batch the database refuses — exit 1, and the log has the code, not the path", () => {
  /* A second preload makes every root update reject the way firebase-admin
     does: a `code`, and a message that NAMES THE PATH. The path ends in a
     session code, so printing e.message here is a leak; this is the only test
     that runs the script's own error line. */
  const r = runSweep(TREE, { RECOVERY_SWEEP_CONFIRM: "1" }, [FAILING_UPDATE]);
  assert.strictEqual(r.status, 1, r.log);
  assert.match(r.stderr, /^ERROR {4}a batch of 2 was not deleted: PERMISSION_DENIED$/m);
  assert.match(r.stdout, /Summary: 0 deleted, 2 left \(1 batch\(es\) failed — run again\)\./);
  assertNothingSensitive(r);
});

test("REAL SCRIPT: cannot start — exit 2, nothing written, and it still ends by itself", () => {
  /* The REST reader refuses a non-https URL before making a request, which
     reaches main().catch() exactly as an auth failure or an unreadable list
     does (the list case is driven directly, above). */
  const r = runSweep(TREE, {
    RECOVERY_SWEEP_CONFIRM: "1", FIREBASE_DATABASE_URL: "http://plain.invalid"
  });
  assert.strictEqual(r.status, 2, r.log);
  assert.deepStrictEqual(r.writes, []);
  assert.match(r.stderr, /^FATAL: Error$/m,
    "the name of the error and nothing else — its message stays out of the log");
  assert.ok(!r.stderr.includes("plain.invalid"), "the message was printed" + r.log);
  assertNothingSensitive(r);
});

test("REAL SCRIPT: more orphans than one batch — several updates, every path once", () => {
  const n = BATCH_SIZE + 7;
  const big = { sessions: { "liv-aaa": { created: { at: 1 } } }, recovery: { sessions: { "liv-aaa": { code: "k" } } } };
  for (let i = 0; i < n; i++) big.recovery.sessions["old-" + i] = { code: "c" + i };
  const r = runSweep(big, { RECOVERY_SWEEP_CONFIRM: "1" });
  assert.strictEqual(r.status, 0, r.log);
  assert.deepStrictEqual(r.writes.map((w) => w.keys.length), [BATCH_SIZE, 7]);
  const all = r.writes.flatMap((w) => w.keys);
  assert.strictEqual(new Set(all).size, n, "a path was deleted twice or missed");
  assert.ok(!all.includes("recovery/sessions/liv-aaa"), "the live record was swept");
  assert.match(r.stdout, new RegExp("Summary: " + n + " deleted, 0 left\\."));
});

/* ── the workflow ────────────────────────────────────────────────────── */

const yml = fs.readFileSync(WORKFLOW, "utf8").split("\r\n").join("\n");
/* Comments describe what the job must NOT do, in the words it must not use. */
const ymlCode = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("workflow: dispatch only — a one-off never grows a schedule unnoticed", () => {
  assert.match(ymlCode, /^\s*workflow_dispatch:/m);
  assert.ok(!/^\s*schedule:/m.test(ymlCode) && !/^\s*-\s*cron:/m.test(ymlCode),
    "the sweep has a cron. A scheduled job that lists session codes on a runner is " +
    "a nightly transfer, which the privacy notice would have to describe — and " +
    "this assertion is the ONLY thing in the suite that notices one being added " +
    "(the notice lockstep in tests/ops-transfer-notice.test.js passes with it). " +
    "That is a decision, not a tidy-up.");
  assert.ok(!/^\s*(push|pull_request):/m.test(ymlCode), "it must not run on a push");
});

test("workflow: deleting takes a ticked box, and the box starts empty", () => {
  const confirm = ymlCode.slice(ymlCode.indexOf("confirm:"));
  assert.match(confirm.slice(0, 200), /type: boolean[\s\S]*default: false/);
  assert.match(ymlCode,
    /RECOVERY_SWEEP_CONFIRM: \$\{\{ github\.event\.inputs\.confirm == 'true' && '1' \|\| '0' \}\}/,
    "the flag must come from the box and nowhere else — a literal \"1\" here deletes on every dispatch");
  /* Two overrides, each from its own box, each starting empty — and the env
     names are the ones the script reads (a misspelt one is a box that does
     nothing, which here means a run that can never be let through). */
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  for (const [env, input] of [
    ["RECOVERY_SWEEP_ALLOW_EMPTY_DEFAULT_TREE", "allow_empty_default_tree"],
    ["RECOVERY_SWEEP_ALLOW_EMPTY_ORG_TREES", "allow_empty_org_trees"]
  ]) {
    assert.ok(ymlCode.includes(
      env + ": ${{ github.event.inputs." + input + " == 'true' && '1' || '0' }}"),
      env + " is not wired to the `" + input + "` box");
    const box = ymlCode.slice(ymlCode.indexOf("      " + input + ":"));
    assert.match(box.slice(0, 260), /type: boolean[\s\S]*default: false/, input + " must start unticked");
    assert.ok(script.includes("process.env." + env + " === \"1\""), "the script does not read " + env);
  }
  assert.ok(!/ALLOW_NO_SESSIONS/.test(ymlCode + script),
    "the single override is back. It waived the default tree's guard whenever it " +
    "was given for an org tree.");
  assert.match(ymlCode, /run: node scripts\/sweep-orphaned-recovery\.js/);
});

test("workflow: installs from the lockfile and asks for nothing but read access", () => {
  assert.match(ymlCode, /^\s*run:\s*npm ci(\s|$)/m,
    "a floating install is how four retention jobs failed for five nights (2026-07-31)");
  assert.match(ymlCode, /permissions:\s*\n\s*contents: read/);
  assert.match(ymlCode, /cancel-in-progress: false/, "never kill a run mid-delete");
});
