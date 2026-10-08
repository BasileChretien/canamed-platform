"use strict";
/* tests/reset-flag-unreadable.test.js
 *
 * THE DEFECT. To overwrite a forgotten admin password, the client first wrote
 * a flag carrying the session's RECOVERY CODE, in clear, to
 * `sessions/<code>/_superadminReset` — the rule required the code there. That
 * node is inside the session subtree, whose `.read` every member has, and
 * membership is self-claimed. So anyone signed in who knew a session code could
 * listen on that node, be handed the recovery code the one time a facilitator
 * used "forgot password", and from then on reset the password themselves for as
 * long as the session stayed open. Measured on the emulator, in both trees,
 * before the change: tests-e2e/emulator/reset-flag-unreadable.spec.js.
 *
 * THE FIX, in four parts — each of which this file pins:
 *   1. RULES   the flag lives at adminSecrets/<code>/reset/<uid>, a tree with
 *              no read rule, keyed by its writer. The old node accepts nothing
 *              but a delete, and no rule reads it.
 *   2. CLIENT  both reset call sites write the flag there, and nothing in the
 *              served code writes the old node.
 *   3. OPS     a leftover in the old node (a removal that failed, before the
 *              move) is stripped from the nightly backup, withheld by a
 *              restore, and cleared by the nightly purge — blind, because the
 *              purge may not read anything new.
 *   4. the purge's reads are RECORDED and compared, not asserted in a comment.
 *
 * WHAT THIS FILE CANNOT SEE. It evaluates no rule. That a member really is
 * refused the read, and that the reset really works for its owner and for
 * nobody else, is the emulator spec's to show. The rule TEXT of the flag's own
 * write is pinned word for word in tests/reset-needs-a-password.test.js.
 *
 * NOT FIXED, AND NOT CLAIMED: a code that leaked before this shipped stays
 * valid while its session is open. The record is write-once and a reset does
 * not issue a new one.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { runOpsScript, at } = require("./fixtures/run-ops-script");
const { sessionLocationsFromKeys } = require("../scripts/lib/session-trees");
const {
  LEGACY_RESET_FLAG, legacyResetFlagPath, withoutLegacyResetFlag
} = require("../scripts/lib/reset-flag");

const ROOT = path.join(__dirname, "..");
const PLATFORM = path.join(ROOT, "docs", "Third_session", "PBL_platform");
const lf = (s) => s.split("\r\n").join("\n");
const read = (f) => lf(fs.readFileSync(path.join(PLATFORM, f), "utf8"));
const RULES_TEXT = read("database.rules.json");
const rules = JSON.parse(RULES_TEXT).rules;

const OLD = "_superadminReset";

/* ══ 1. THE RULES ═══════════════════════════════════════════════════════ */

const ORG_SESSION = "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";
const ORG_FLAG = "root.child('adminSecrets').child('orgs').child($orgSlug).child($sessionId).child('reset').child(auth.uid)";
const GATE = "(root.child('facilitatorGate').child('enforce').val() != true || " +
  "root.child('facilitatorGate').child('allow').child(auth.uid).val() == true)";

/* Each tree has TWO hash rules — the readable marker under the session and the
   real hash under adminSecrets — and each names the session by its own
   wildcard, so each is listed with the session and the flag as IT spells them. */
const TREES = [
  { name: "default",
    old: rules.sessions.$sessionId[OLD],
    secrets: rules.adminSecrets.$code,
    hashRules: [
      { what: "sessions/$sessionId/adminPasswordHash",
        rule: rules.sessions.$sessionId.adminPasswordHash[".write"],
        session: "root.child('sessions').child($sessionId)",
        flag: "root.child('adminSecrets').child($sessionId).child('reset').child(auth.uid)" },
      { what: "adminSecrets/$code/hash",
        rule: rules.adminSecrets.$code.hash[".write"],
        session: "root.child('sessions').child($code)",
        flag: "root.child('adminSecrets').child($code).child('reset').child(auth.uid)" }
    ] },
  { name: "org",
    old: rules.orgs.$orgSlug.sessions.$sessionId[OLD],
    secrets: rules.adminSecrets.orgs.$orgSlug.$sessionId,
    hashRules: [
      { what: "orgs/$orgSlug/sessions/$sessionId/adminPasswordHash",
        rule: rules.orgs.$orgSlug.sessions.$sessionId.adminPasswordHash[".write"],
        session: ORG_SESSION, flag: ORG_FLAG },
      { what: "adminSecrets/orgs/$orgSlug/$sessionId/hash",
        rule: rules.adminSecrets.orgs.$orgSlug.$sessionId.hash[".write"],
        session: ORG_SESSION, flag: ORG_FLAG }
    ] }
];

for (const t of TREES) {
  test(`rules, ${t.name} tree: the old node accepts a delete and nothing else`, () => {
    assert.deepStrictEqual(t.old, { ".write": "auth != null && newData.val() == null" },
      "the old reset node is inside the session, where every member can read. It must " +
      "accept no value at all — a client that still writes the recovery code there " +
      "(a cached shell) has to be REFUSED, not obeyed. A delete by anyone signed in is " +
      "meant: what is left there is a recovery code in clear, and removing it is the point.");
  });

  test(`rules, ${t.name} tree: the flag is its writer's own key, holds two fields, and nothing reads it`, () => {
    assert.deepStrictEqual(Object.keys(t.secrets.reset), ["$uid"],
      "a rule on `reset` itself (above the per-user key) would apply to every user's flag");
    const flag = Object.assign({}, t.secrets.reset.$uid);
    const write = flag[".write"];
    delete flag[".write"];
    assert.deepStrictEqual(flag, {
      ".validate": "newData.hasChildren(['requestedAt','code'])",
      requestedAt: { ".validate": "newData.isNumber()" },
      code: { ".validate": "newData.isString() && newData.val().length >= 8 && newData.val().length <= 60" },
      $other: { ".validate": false }
    }, "the flag is a timestamp and the code. No name, no uid field (the uid is the KEY, " +
       "which cannot be forged), no `.read`, and no room for anything else");
    /* The whole write rule is in tests/reset-needs-a-password.test.js; what
       matters HERE is who may touch a flag at all, and that is the first thing
       the rule says — before the delete branch, so that it binds a delete too.
       Without it a stranger deletes a facilitator's flag mid-reset (measured,
       on the old node). */
    assert.ok(write.startsWith("auth != null && $uid == auth.uid && ("),
      "every write to a flag — a delete included — must be by the user it is keyed to: " + write);
  });

  for (const h of t.hashRules) {
    test(`rules, ${t.name} tree: ${h.what} is overwritten only under the WRITER'S OWN fresh flag`, () => {
      const first = "(!data.exists() && (!" + h.session + ".child('creatorUid').exists() || " +
        h.session + ".child('creatorUid').val() == auth.uid) && " + GATE + ")";
      const fresh = "(" + h.flag + ".child('requestedAt').isNumber() && " +
        h.flag + ".child('requestedAt').val() >= now - 30000 && " +
        h.flag + ".child('requestedAt').val() <= now + 5000)";
      /* THE WHOLE RULE. Two ways to write a hash and no third: the first write
         (the creator's, through the creation gate), or an overwrite while the
         writer's OWN flag is fresh. `child(auth.uid)` is what makes a reset its
         owner's alone — a flag read by any other key lets one user open the
         door and another walk through it (the R3 recovery race). */
      assert.strictEqual(h.rule, "auth != null && (" + first + " || " + fresh + ")",
        h.what + " is not, word for word, the rule this test knows");
    });
  }
}

test("rules: no rule anywhere reads the old node", () => {
  const readers = [];
  (function walk(node, where) {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && value.includes(OLD)) readers.push(where + "/" + key);
      else if (value !== null && typeof value === "object") walk(value, where + "/" + key);
    }
  })(rules, "");
  assert.deepStrictEqual(readers, [],
    "a rule consults " + OLD + ". Whatever it decides is then decided by a node any " +
    "member can read, and until the purge has run, by whatever a client left in it");
  assert.strictEqual(RULES_TEXT.split(OLD).length - 1, 2,
    "the old node should appear exactly twice in the rules: its own (delete-only) " +
    "declaration, once per tree");
});

test("rules: nothing in the adminSecrets tree is readable by a client", () => {
  /* Why the flag is safe THERE. RTDB reads cascade downward and cannot be
     revoked deeper, so the guarantee is: the root grants none, and no node on
     the way down to a flag grants one. (That a client is in fact refused is
     the emulator spec's cells 2.) */
  assert.strictEqual(rules[".read"], false, "the root must grant no read");
  const grants = [];
  (function walk(node, where) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ".read") grants.push(where);
      else if (value !== null && typeof value === "object") walk(value, where + "/" + key);
    }
  })(rules.adminSecrets, "adminSecrets");
  assert.deepStrictEqual(grants, [],
    "a `.read` appeared in the adminSecrets tree. Everything below it — password " +
    "hashes, proofs, and the recovery code while a reset is open — is then readable");
});

test("rules: nothing ABOVE a reset rule grants a write", () => {
  /* Writes cascade like reads: a `.write` that holds at ANY node on the way
     down grants the write, whatever the rule at the leaf says. Every test
     above reads a leaf. With `".write": "auth != null"` added at
     adminSecrets/$code — or at sessions/$sessionId, or at recovery/sessions —
     all of them stayed green, and any signed-in user could replace a hash, a
     proof or another user's flag wholesale (found by the independent review
     of this change; the same gap was noted on #447 for the rules it added). */
  const grants = [];
  (function walk(node, where) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ".write") grants.push(where);
      else if (value !== null && typeof value === "object") walk(value, where + "/" + key);
    }
  })(rules.adminSecrets, "adminSecrets");
  assert.deepStrictEqual(grants.sort(), [
    "adminSecrets/$code/hash",
    "adminSecrets/$code/proof/$uid",
    "adminSecrets/$code/reset/$uid",
    "adminSecrets/orgs/$orgSlug/$sessionId/hash",
    "adminSecrets/orgs/$orgSlug/$sessionId/proof/$uid",
    "adminSecrets/orgs/$orgSlug/$sessionId/reset/$uid"
  ], "in the adminSecrets tree a `.write` belongs at a hash, a proof or a flag — the " +
     "six leaves — and nowhere above them");

  /* …and the ancestors of the other rules a reset rests on: the marker and the
     old node under a session, and the recovery record. `false` is as good as
     absent (it grants nothing, and a deeper rule can still grant). */
  const s = rules.sessions, o = rules.orgs, rec = rules.recovery;
  const ANCESTORS = [
    ["(root)", rules],
    ["sessions", s], ["sessions/$sessionId", s.$sessionId],
    ["orgs", o], ["orgs/$orgSlug", o.$orgSlug], ["orgs/$orgSlug/sessions", o.$orgSlug.sessions],
    ["orgs/$orgSlug/sessions/$sessionId", o.$orgSlug.sessions.$sessionId],
    ["recovery", rec], ["recovery/sessions", rec.sessions], ["recovery/orgs", rec.orgs],
    ["recovery/orgs/$orgSlug", rec.orgs.$orgSlug], ["recovery/orgs/$orgSlug/sessions", rec.orgs.$orgSlug.sessions]
  ];
  for (const [where, node] of ANCESTORS) {
    assert.ok(node !== undefined, where + " is no longer in the rules — re-read this list");
    assert.ok(node[".write"] === undefined || node[".write"] === false,
      "a `.write` at " + where + " grants every write below it, over the head of the " +
      "rule that was meant to decide: " + JSON.stringify(node[".write"]));
  }
});

/* ══ 2. THE CLIENT ══════════════════════════════════════════════════════ */

for (const [file, session] of [["script.js", "sessionNum"], ["script-admin.js", "targetSession"]]) {
  test(`client, ${file}: the flag is written to adminSecrets/…/reset/<own uid>, used, and removed`, () => {
    const src = read(file);
    const ref = 'const refReset = db.ref(adminSecretPath(' + session + ', "reset/" + (currentUser && currentUser.uid)));';
    const start = src.indexOf(ref);
    assert.notStrictEqual(start, -1,
      file + " does not build the reset flag at adminSecrets/…/reset/<own uid>. Anywhere " +
      "under the session it is readable by every member");
    const block = src.slice(start, src.indexOf("throw err;", start));
    /* Flag, THEN the hash, THEN the flag removed — and removed on failure too.
       The payload is the timestamp and the code: the old one also carried the
       facilitator's display name and uid, which nothing needs now. */
    assert.match(block,
      /return refReset\.set\(\{ requestedAt: TS, code: recoveryCode \}\)\s*\.then\(\(\) => refSecret\.set\(h\)\)\s*\.then\(\(\) => refReset\.remove\(\)\)\s*\.catch\(err => \{/,
      file + ": the reset must be flag -> hash -> remove the flag, with exactly { requestedAt, code } in it");
    assert.match(block.slice(block.indexOf(".catch(err => {")), /try \{ refReset\.remove\(\); \} catch \(_\) \{\}/,
      file + ": a failed reset must still try to remove its flag — it holds the recovery code");
    /* The flag is dated by the SERVER. The rule accepts ±5 s of its own clock,
       so a laptop a minute out would be refused — and told its recovery code
       is wrong. Pinned for script.js by r3-blockers only; the dashboard
       handler had nothing (found in review), and the runbook now says a wrong
       clock does not matter. */
    assert.match(block,
      /const TS = \(typeof firebase !== "undefined" &&\s*firebase\.database && firebase\.database\.ServerValue &&\s*firebase\.database\.ServerValue\.TIMESTAMP\) \|\| Date\.now\(\);/,
      file + ": the flag's requestedAt must be the server's timestamp placeholder");
  });
}

test("client, script-admin.js: the facilitator's own archive download leaves a leftover flag out", () => {
  /* The dashboard's "close and download" reads the session whole and saves it.
     It stripped the password marker and nothing else, so a leftover of the old
     flag went into the file with the recovery code in clear (found in review).
     Deleted unconditionally: a falsy leftover is still a leftover. */
  assert.match(read("script-admin.js"),
    /if \(tree\.adminPasswordHash\) delete tree\.adminPasswordHash;\n(?:\s*\/\/[^\n]*\n)*\s*delete tree\._superadminReset;\n\s*downloadFullArchive\(tree, sessionNum\);/,
    "the archive download must drop the old reset node before it saves the session");
});

test("client: nothing served to a browser writes the old node", () => {
  /* Every script in the platform directory, lazy chunks included: a write to
     the old node from any of them is refused by the rules, so it would be a
     broken reset — and before the rules are live, a leaked code. Two files
     may NAME the node, each to delete it from a copy of a session that is
     about to be saved: lib.js (the pseudonymised export) and script-admin.js
     (the facilitator's archive download). */
  const WRITES = /\.ref\(|sPath\(|oPath\(|\.set\(|\.update\(|\.push\(/;
  const naming = [];
  const writing = [];
  for (const file of fs.readdirSync(PLATFORM).filter((f) => f.endsWith(".js")).sort()) {
    const lines = read(file).split("\n").filter((line) => line.includes(OLD));
    if (lines.length) naming.push(file);
    for (const line of lines) if (WRITES.test(line)) writing.push(file + ": " + line.trim());
  }
  assert.deepStrictEqual(writing, [], "a served script addresses the old reset node");
  assert.deepStrictEqual(naming, ["lib.js", "script-admin.js"],
    "only lib.js and script-admin.js should name the old node (each strips it from a " +
    "copy it saves). A new mention is either a write coming back or a comment that " +
    "will mislead the next reader");
  assert.match(read("lib.js"), /delete out\._superadminReset;/,
    "lib.js must go on stripping a leftover from the pseudonymised export");
  assert.deepStrictEqual(
    read("script-admin.js").split("\n").filter((line) => line.includes(OLD)).map((line) => line.trim()),
    ["delete tree._superadminReset;"],
    "script-admin.js may name the old node in ONE place: the archive download's strip");
});

/* ══ 3. THE OPS SCRIPTS ═════════════════════════════════════════════════ */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 3, 17, 0);
const LEAK = "leak-code-zzzz";                    // a recovery code, as a leftover holds it
const leftover = () => ({ requestedAt: NOW - 30 * DAY, by: "Dr Example", code: LEAK, uid: "uid-fac" });

test("lib: withoutLegacyResetFlag() drops the node, copies, and leaves the rest alone", () => {
  assert.strictEqual(LEGACY_RESET_FLAG, OLD, "the name the scripts strip is not the node the client used to write");
  const body = { created: { at: 1 }, pool: { c1: { name: "A" } }, [OLD]: leftover() };
  const before = JSON.stringify(body);
  const out = withoutLegacyResetFlag(body);
  assert.strictEqual(out.stripped, true);
  assert.deepStrictEqual(out.session, { created: { at: 1 }, pool: { c1: { name: "A" } } });
  assert.strictEqual(JSON.stringify(body), before, "the input must not be modified");

  const clean = { created: { at: 1 } };
  assert.deepStrictEqual(withoutLegacyResetFlag(clean), { session: clean, stripped: false });
  /* Present but falsy is still a leftover: a check on truthiness would let
     `_superadminReset: 0` (or "") through into the archive. */
  for (const odd of [0, "", false, null]) {
    assert.strictEqual(withoutLegacyResetFlag({ a: 1, [OLD]: odd }).stripped, true, "value " + JSON.stringify(odd));
  }
  for (const notASession of [null, undefined, 7, "x"]) {
    assert.deepStrictEqual(withoutLegacyResetFlag(notASession), { session: notASession, stripped: false });
  }
  const [dflt] = sessionLocationsFromKeys(["abc-234"], {});
  const [org] = sessionLocationsFromKeys([], { partner: ["abc-567"] });
  assert.strictEqual(legacyResetFlagPath(dflt), "sessions/abc-234/" + OLD);
  assert.strictEqual(legacyResetFlagPath(org), "orgs/partner/sessions/abc-567/" + OLD);
});

/* ── the backup ── */

test("REAL SCRIPT, backup: a leftover flag is not archived — in either tree — and everything else is", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-backup-"));
  try {
    const out = path.join(dir, "backup.json");
    const tree = {
      sessions: {
        "bkl-234": { created: { at: NOW - DAY }, adminPasswordHash: "v2$marker",
          pool: { c1: { name: "Alice" } }, [OLD]: leftover() },
        "bkc-234": { created: { at: NOW - DAY }, pool: { c2: { name: "Bob" } } }
      },
      orgs: { partner: { sessions: { "bko-567": { created: { at: NOW - DAY }, [OLD]: leftover() } } } }
    };
    const r = runOpsScript("backup-sessions.js", {
      tree, now: NOW,
      /* No archive destination: the local file is the deliverable, and a
         developer's own bucket settings must not turn this into an upload. */
      env: { BACKUP_OUT_PATH: out, BACKUP_S3_BUCKET: "", BACKUP_GCS_BUCKET: "", BACKUP_REQUIRE_GCS: "" }
    });
    assert.strictEqual(r.code, 0, r.out);
    const text = fs.readFileSync(out, "utf8");
    assert.ok(!text.includes(OLD), "the archive holds a " + OLD + " node");
    assert.ok(!text.includes(LEAK), "the archive holds a recovery code");
    assert.ok(!text.includes("Dr Example"), "the archive holds the facilitator name the flag carried");
    const archived = JSON.parse(text).sessions;
    assert.deepStrictEqual(archived, {
      "bkl-234": { created: { at: NOW - DAY }, pool: { c1: { name: "Alice" } } },
      "bkc-234": { created: { at: NOW - DAY }, pool: { c2: { name: "Bob" } } },
      "orgs/partner/bko-567": { created: { at: NOW - DAY } }
    }, "the archive must be the sessions, whole, less the password marker and the leftover flag");
    assert.match(r.out, /Stripped a leftover reset flag from 2\/3 sessions\./);
    for (const code of ["bkl-234", "bkc-234", "bko-567"]) {
      assert.ok(!r.out.includes(code), "the backup log names a session: a count, never which");
    }
    assert.deepStrictEqual(r.tree, tree, "a backup reads; it must leave the database as it found it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ── the restore ── */

test("REAL SCRIPT, restore: a snapshot that still holds a leftover is restored without it", () => {
  /* The archives taken before the backup learned to strip the node are kept
     for 90 days. Restoring one wrote the recovery code straight back into the
     session, where every member reads. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-restore-"));
  try {
    const file = path.join(dir, "snapshot.json");
    fs.writeFileSync(file, JSON.stringify({
      backupTakenAt: new Date(NOW - 5 * DAY).toISOString(),
      databaseUrl: "https://fake-rtdb.example.test",
      sessions: {
        "rsl-234": { created: { at: NOW - 9 * DAY }, pool: { c1: { name: "Alice" } }, [OLD]: leftover() },
        "orgs/partner/rso-567": { created: { at: NOW - 9 * DAY }, [OLD]: leftover() },
        "rsc-234": { created: { at: NOW - 9 * DAY }, pool: { c2: { name: "Bob" } } }
      }
    }));
    const run = (env) => runOpsScript("restore-sessions.js", { tree: {}, now: NOW, args: ["--file", file], env });

    const dry = run({});
    assert.strictEqual(dry.code, 0, dry.out);
    assert.deepStrictEqual(dry.tree, {}, "a dry run restores nothing");
    assert.match(dry.out, /A leftover password-reset flag is withheld from 2 of them\./,
      "the dry run must say what the live run will withhold");

    const live = run({ RESTORE_CONFIRM: "1" });
    assert.strictEqual(live.code, 0, live.out);
    assert.deepStrictEqual(live.tree, {
      sessions: {
        "rsl-234": { created: { at: NOW - 9 * DAY }, pool: { c1: { name: "Alice" } } },
        "rsc-234": { created: { at: NOW - 9 * DAY }, pool: { c2: { name: "Bob" } } }
      },
      orgs: { partner: { sessions: { "rso-567": { created: { at: NOW - 9 * DAY } } } } }
    }, "the restore must bring back each session whole, less the leftover flag");
    assert.ok(!JSON.stringify(live.tree).includes(LEAK), "the restore wrote a recovery code back");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ── the purge ── */

const CODES = { expired: "pfx-234", flagged: "pfl-234", clean: "pfc-234", org: "pfo-567" };
const SLUG = "partner";
const KEPT = sessionLocationsFromKeys([CODES.flagged, CODES.clean], { [SLUG]: [CODES.org] });
const [EXPIRED] = sessionLocationsFromKeys([CODES.expired], {});

function purgeTree(backupAgeDays) {
  return {
    sessions: {
      [CODES.expired]: { created: { at: NOW - 100 * DAY }, closed: { at: NOW - 40 * DAY }, [OLD]: leftover() },
      [CODES.flagged]: { created: { at: NOW - DAY }, pool: { c1: { name: "Alice" } }, [OLD]: leftover() },
      [CODES.clean]: { created: { at: NOW - 2 * DAY }, pool: { c2: { name: "Bob" } } }
    },
    orgs: { [SLUG]: { sessions: { [CODES.org]: { created: { at: NOW - DAY }, [OLD]: leftover() } } } },
    ops: { lastBackup: { at: NOW - backupAgeDays * DAY, sessions: 4, uri: "s3://fake" } }
  };
}
/* What .github/workflows/cleanup-stale-sessions.yml sets on the cron. */
const CRON = { CLEANUP_CONFIRM: "1", CLEANUP_QUIET: "1", CLEANUP_REQUIRE_BACKUP: "1", CLEANUP_BACKUP_MAX_AGE_DAYS: "2" };
const noCodeIn = (out) => {
  for (const code of Object.values(CODES)) assert.ok(!out.includes(code), "a session code reached the log:\n" + out);
  assert.ok(!out.includes(LEAK), "a recovery code reached the log");
};

test("REAL SCRIPT, purge: a leftover flag is gone from every session kept, and nothing else of them is touched", () => {
  const tree = purgeTree(0.5);
  const r = runOpsScript("cleanup-stale-sessions.js", { tree, now: NOW, env: CRON });
  assert.strictEqual(r.code, 0, r.out);

  /* The database it leaves. The kept sessions are what they were, less the
     flag; the expired one is gone whole (its marker is the purge's own). */
  assert.deepStrictEqual(at(r.tree, "sessions/" + CODES.flagged),
    { created: { at: NOW - DAY }, pool: { c1: { name: "Alice" } } });
  assert.deepStrictEqual(at(r.tree, "sessions/" + CODES.clean), tree.sessions[CODES.clean],
    "a session that held no flag must be exactly as it was");
  assert.deepStrictEqual(at(r.tree, "orgs/" + SLUG + "/sessions/" + CODES.org), { created: { at: NOW - DAY } });
  assert.strictEqual(at(r.tree, "sessions/" + CODES.expired), null, "the control: the expired session was purged");
  assert.ok(!JSON.stringify(r.tree).includes(LEAK), "a recovery code is still in the database after the purge");

  /* How it was written: ONE update of its own, naming the old node of every
     session kept and nothing else, AFTER the purge. Its own, because a path
     and its ancestor in one update are refused whole (the expired session's
     subtree goes in the purge's); after, so that failing cannot stop a purge. */
  const meant = KEPT.map(legacyResetFlagPath).sort();
  const clears = r.writes.filter((w) => w.paths.some((p) => p.endsWith("/" + OLD)));
  assert.deepStrictEqual(clears, [{ op: "update", paths: meant }],
    "expected exactly one write to the old reset node: one update, every session kept");
  const purgeAt = r.writes.findIndex((w) => w.paths.includes(EXPIRED.path));
  assert.ok(purgeAt !== -1 && purgeAt < r.writes.indexOf(clears[0]),
    "the clearing update must come after the purge of the expired session");

  assert.match(r.out, /Leftover reset flags: cleared 3 path\(s\), one per session kept — written blind, nothing read\./);
  noCodeIn(r.out);
});

test("REAL SCRIPT, purge: a dry run writes nothing, and says what a live run would clear", () => {
  const tree = purgeTree(0.5);
  const env = Object.assign({}, CRON);
  delete env.CLEANUP_CONFIRM;
  const r = runOpsScript("cleanup-stale-sessions.js", { tree, now: NOW, env });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.writes, [], "a dry run made a write");
  assert.deepStrictEqual(r.tree, tree);
  assert.match(r.out, /Leftover reset flags: would clear 3 path\(s\), one per session kept/);
  noCodeIn(r.out);
});

test("REAL SCRIPT, purge: a run the backup gate refuses clears nothing", () => {
  /* Stated because it is a limit, not because it is wanted: the leftover
     clearing rides the session pass, and a stale backup skips that pass whole.
     The flag itself is never in a backup, so nothing is protected by waiting —
     it simply waits for the next run that is let through. */
  const tree = purgeTree(5);
  const r = runOpsScript("cleanup-stale-sessions.js", { tree, now: NOW, env: CRON });
  assert.strictEqual(r.code, 3, r.out);
  assert.deepStrictEqual(r.writes.filter((w) => w.paths.some((p) => p.includes(OLD))), []);
  assert.strictEqual(at(r.tree, legacyResetFlagPath(KEPT[0])).code, LEAK);
  assert.doesNotMatch(r.out, /Leftover reset flags/);
});

/* ══ 4. WHAT THE PURGE READS ════════════════════════════════════════════
 * The participant notice says what the scheduled jobs read per session: the
 * identifiers, and the two dates that decide when it is deleted. A purge that
 * looked at the flag before deleting it — to count the real leftovers, say —
 * would read a third value, and that value is a recovery code. So the reads
 * are recorded by the fake database and compared, for the same tree as above.
 */

const RECORDING = path.join(__dirname, "fixtures", "fake-firebase-admin-preload.js");
const FAILING = path.join(__dirname, "fixtures", "failing-update-preload.js");
const PURGE = path.join(ROOT, "scripts", "cleanup-stale-sessions.js");

function recordedPurge(extraPreloads, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-purge-reads-"));
  const outFile = path.join(dir, "io.json");
  const env = {};
  for (const k of Object.keys(process.env)) if (!/^(CLEANUP_|FAKE_DB_)/.test(k)) env[k] = process.env[k];
  try {
    const preloads = [RECORDING].concat(extraPreloads || []).flatMap((p) => ["-r", p]);
    const r = spawnSync(process.execPath, preloads.concat([PURGE]), {
      encoding: "utf8", timeout: 20000,
      env: Object.assign(env, CRON, {
        FAKE_DB_TREE: JSON.stringify(purgeTree(0.5)), FAKE_DB_NOW: String(NOW),
        FAKE_DB_WRITES_OUT: outFile, FIREBASE_DATABASE_URL: "https://fake-db.invalid"
      }, extraEnv || {})
    });
    const out = (r.stdout || "") + (r.stderr || "");
    assert.ok(!r.error && r.status !== null, "the purge did not end by itself:\n" + out);
    return Object.assign({ status: r.status, out }, JSON.parse(fs.readFileSync(outFile, "utf8")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("REAL SCRIPT, purge: per session kept it reads the two dates, and never a value at, under or above the flag", () => {
  const r = recordedPurge();
  assert.strictEqual(r.status, 0, r.out);
  /* `once` returns a VALUE, with everything under it. (`shallow` returns the
     keys of a node and nothing below: it is how the sessions are listed.) */
  const values = r.reads.filter((x) => x.via === "once").map((x) => x.path);
  assert.ok(values.length > 0, "the fake recorded no reads at all — this test would pass on anything");

  for (const loc of KEPT.concat([EXPIRED])) {
    const flag = legacyResetFlagPath(loc);
    const reaching = values.filter((p) => p === "" || p === flag || p.startsWith(flag + "/") || flag.startsWith(p + "/"));
    assert.deepStrictEqual(reaching, [],
      "the purge read a value that includes a session's old reset node — a recovery " +
      "code, if a leftover is there. It must be deleted blind");
  }
  for (const loc of KEPT) {
    assert.deepStrictEqual(values.filter((p) => p.startsWith(loc.path + "/")).sort(),
      [loc.path + "/closed/at", loc.path + "/created/at"],
      "for a session it keeps, the purge reads the two dates and nothing else. The " +
      "participant notice says so (tests/ops-transfer-notice.test.js)");
  }
  /* And it still did the work: same clearing update as the applied-writes run. */
  assert.deepStrictEqual(
    r.writes.filter((w) => w.keys && w.keys.some((k) => k.endsWith("/" + OLD))),
    [{ op: "update", path: "", keys: KEPT.map(legacyResetFlagPath).sort() }]);
});

test("REAL SCRIPT, purge: when the clearing update fails the run is red, the purge stands, and the log carries the error code only", () => {
  /* ONLY the clearing update fails. (With every update failing, the purge's
     own failure turns the run red by itself, and a clearing failure that was
     swallowed went unnoticed — that mutant survived the first version of this
     test.) firebase-admin's message names the path it failed on, and the path
     ends in a session code. */
  const r = recordedPurge([FAILING], { FAKE_DB_FAIL_UPDATES_NAMING: "/" + OLD });
  assert.strictEqual(r.status, 1, "a clearing that failed must fail the run:\n" + r.out);
  assert.ok(r.writes.some((w) => w.op === "update" && w.keys.includes(EXPIRED.path)),
    "the purge of the expired session must have gone through: the clearing is a " +
    "separate update so that its failure cannot stop or undo a purge");
  assert.match(r.out, /Summary: 3 kept, 1 purged, 1 errors\./);
  assert.match(r.out, /ERROR {4}leftover reset flags were not cleared: PERMISSION_DENIED/);
  assert.doesNotMatch(r.out, /Leftover reset flags: cleared/, "a failed clearing must not be reported as done");
  noCodeIn(r.out);
});
