"use strict";
/* tests/reset-needs-a-password.test.js
 *
 * The STRUCTURE of two rules, in both session trees, and the two things in the
 * client they are safe because of. What the rules actually DO is measured on
 * the emulator, in tests-e2e/emulator/reset-needs-a-password.spec.js — nothing
 * in this file evaluates a rule, and a predicate that is present but placed
 * where it cannot bite would pass here. This is the fast backstop that fails
 * in the unit suite, with a reason, when one of them is removed.
 *
 *   (a) the reset flag may be written only where the session HAS a password
 *       (`adminPasswordHash` exists). A reset needs something to reset.
 *       Without it, whoever held a session's recovery code set its FIRST
 *       hash, whatever `creatorUid` said.
 *   (b) the recovery node may be written only where the session has no
 *       `creatorUid`, or by that creator. Without it — and (a) alone does not
 *       help here — a stranger plants a code on a session with no password,
 *       waits for its creator to set one, and resets it then. A session
 *       restored from the nightly archive is in exactly that state.
 *
 * Both were measured as takeovers before the change (2026-10-07, both trees).
 *
 * THE FLAG MOVED afterwards, from sessions/<code>/_superadminReset — readable
 * by every member of the session, with the recovery code in it — to
 * adminSecrets/<code>/reset/<uid>, which no client can read. (a) went with it,
 * and is checked here on the rule that now carries it. What the move itself
 * must guarantee is in tests/reset-flag-unreadable.test.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const rules = JSON.parse(fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8")).rules;
const read = (f) => fs.readFileSync(path.join(PLATFORM, f), "utf8").split("\r\n").join("\n");

const SESS = "root.child('sessions').child($sessionId)";
const ORG = "root.child('orgs').child($orgSlug).child('sessions').child($sessionId)";
const REC_SESS = "root.child('recovery').child('sessions').child($sessionId)";
const REC_ORG = "root.child('recovery').child('orgs').child($orgSlug).child('sessions').child($sessionId)";
/* The flag's rule sits under adminSecrets/$code, so in the default tree it
   names the session by `$code`. The org one keeps $orgSlug / $sessionId. */
const FLAG_SESS = "root.child('sessions').child($code)";
const FLAG_REC_SESS = "root.child('recovery').child('sessions').child($code)";
const GATE = "(root.child('facilitatorGate').child('enforce').val() != true || " +
  "root.child('facilitatorGate').child('allow').child(auth.uid).val() == true)";

const TREES = [
  { name: "default", base: SESS, rec: REC_SESS, flagBase: FLAG_SESS, flagRec: FLAG_REC_SESS,
    reset: rules.adminSecrets.$code.reset.$uid[".write"],
    recovery: rules.recovery.sessions.$sessionId[".write"],
    hash: rules.adminSecrets.$code.hash[".write"],
    hashBase: "root.child('sessions').child($code)" },
  { name: "org", base: ORG, rec: REC_ORG, flagBase: ORG, flagRec: REC_ORG,
    reset: rules.adminSecrets.orgs.$orgSlug.$sessionId.reset.$uid[".write"],
    recovery: rules.recovery.orgs.$orgSlug.sessions.$sessionId[".write"],
    hash: rules.adminSecrets.orgs.$orgSlug.$sessionId.hash[".write"],
    hashBase: ORG }
];

for (const t of TREES) {
  test(`${t.name} tree: (a) a reset is refused unless the session has a password`, () => {
    const need = t.flagBase + ".child('adminPasswordHash').exists()";
    assert.ok(t.reset.includes(need),
      "the reset no longer asks for a password to exist. On a session with none, the " +
      "holder of its recovery code then sets the FIRST hash — round the creator " +
      "binding on the hash rule: " + t.reset);

    /* INSIDE the branch that writes a reset, ANDed with the rest of it. The
       rule is `… && (newData.val() == null || ( <conditions> ))`: clearing the
       flag stays possible without a password, starting a reset does not. */
    const branch = t.reset.indexOf("(newData.val() == null || (");
    assert.notStrictEqual(branch, -1, "the reset rule changed shape — re-read it: " + t.reset);
    const conditions = t.reset.slice(branch + "(newData.val() == null || (".length);
    assert.ok(conditions.split(" && ").includes(need),
      "the password requirement must be one of the reset branch's own conditions, " +
      "ANDed with the others. Elsewhere it may be ORed away: " + t.reset);
    assert.ok(!/\|\|/.test(conditions),
      "an OR appeared inside the reset branch. Every condition there has to hold " +
      "together; an alternative is a way round all of them: " + t.reset);

    /* THE WHOLE RULE, EXACTLY. The checks above only look at what FOLLOWS
       `(newData.val() == null || (`, and say why a failure matters; an
       alternative ORed in BEFORE that branch — identically in both trees, so
       the re-prefix test below is no help — passed all of them (found in
       review). Nothing short of the full text closes that. */
    assert.strictEqual(t.reset,
      "auth != null && $uid == auth.uid && " +
      "(newData.val() == null || (!" + t.flagBase + ".child('closed').exists() && " + need + " && " +
      "newData.child('requestedAt').isNumber() && " +
      "newData.child('requestedAt').val() >= now - 5000 && " +
      "newData.child('requestedAt').val() <= now + 5000 && " +
      t.flagRec + ".child('code').exists() && " +
      "newData.child('code').val() == " + t.flagRec + ".child('code').val()))",
      "the reset rule is not, word for word, the rule this test knows: signed in, under " +
      "the writer's OWN uid, and then EITHER a delete OR all of — the session is not " +
      "closed, a password exists, a fresh timestamp, the recovery code");
  });

  test(`${t.name} tree: (b) a recovery code is written by the session's creator, or where there is none yet`, () => {
    const bind = "(!" + t.base + ".child('creatorUid').exists() || " + t.base + ".child('creatorUid').val() == auth.uid)";
    assert.ok(t.recovery.includes(bind),
      "the recovery write is no longer bound to the creator. A stranger can then plant " +
      "a code on a passwordless session and reset it once its creator has set a " +
      "password — (a) alone does not stop that: " + t.recovery);

    /* The whole rule, exactly: every condition ANDed, nothing else. A looser
       shape (an OR at the top level) would pass an `includes`. */
    assert.strictEqual(t.recovery,
      "auth != null && !data.exists() && !" + t.base + ".child('adminPasswordHash').exists() && " +
      bind + " && " + GATE,
      "the recovery write rule is not the five conditions this test knows: signed in, " +
      "write-once, no password yet, the creator binding, the creation gate");
  });

  test(`${t.name} tree: the first hash is still the creator's — the binding (b) mirrors`, () => {
    /* (b) is only as good as this: the recovery write is bound to the same
       identity the FIRST hash write is. Where there is no creatorUid both are
       open to anyone, by design, and (b) closes nothing — the emulator spec
       pins that state as open rather than implying otherwise. */
    assert.ok(t.hash.includes("!data.exists() && (!" + t.hashBase + ".child('creatorUid').exists() || " +
      t.hashBase + ".child('creatorUid').val() == auth.uid)"),
      "the hash rule's first-write branch is no longer creator-bound: " + t.hash);
  });
}

test("the org tree's two rules are the default tree's, re-prefixed — and never look at the default tree", () => {
  const reprefix = (s) => s.split(REC_SESS).join(REC_ORG).split(SESS).join(ORG);
  const reprefixFlag = (s) => s.split(FLAG_REC_SESS).join(REC_ORG).split(FLAG_SESS).join(ORG);
  const [dflt, org] = TREES;
  assert.notStrictEqual(reprefixFlag(dflt.reset), dflt.reset, "the re-prefix found nothing to replace");
  assert.strictEqual(reprefixFlag(dflt.reset), org.reset, "the two reset rules have drifted apart");
  assert.strictEqual(reprefix(dflt.recovery), org.recovery, "the two recovery rules have drifted apart");
  for (const rule of [org.reset, org.recovery]) {
    assert.ok(!rule.includes("root.child('sessions')") && !rule.includes("child('recovery').child('sessions')"),
      "an org rule addresses the DEFAULT tree. It would then be decided by a session " +
      "that has nothing to do with it — and fail open: " + rule);
  }
});

/* ── the client, which these rules must not break ────────────────────── */

test("client: both reset call sites issue a reset ONLY when a password marker exists", () => {
  /* Why (a) breaks nothing. Each site reads the readable marker first and, when
     it is absent, takes the first-write branch (no reset, no recovery code).

     ⚠️ WHAT THIS DOES NOT SEE. It reads the text of the two functions. Nothing
     on a session WITH NO PASSWORD drives joinSuperAdmin() against real rules:
     the LOCAL e2e suite runs it on LocalDB, which has no rules, and the one
     emulator spec that does drive the panel (reset-flag-unreadable.spec.js)
     resets a session that has a password. So this pins the shape that keeps a
     passwordless session away from the reset, and no more than the shape. */
  for (const [file, resetRef] of [
    ["script.js", 'db.ref(adminSecretPath(sessionNum, "reset/" + (currentUser && currentUser.uid)))'],
    ["script-admin.js", 'db.ref(adminSecretPath(targetSession, "reset/" + (currentUser && currentUser.uid)))']
  ]) {
    const src = read(file);
    const at = src.indexOf(resetRef);
    assert.notStrictEqual(at, -1, file + " no longer builds the reset the way this test expects");
    assert.strictEqual(src.split("\"reset/\"").length - 1, 1,
      file + " now builds a reset in more than one place — check each against the rule");
    assert.match(src.slice(Math.max(0, at - 2600), at), /refMarker\.once\("value"\)/,
      file + ": the branch must be decided on the marker");

    /* The first-write branch itself, brace to brace (it has none inside). */
    const guard = src.lastIndexOf("if (snap.val() == null) {", at);
    assert.ok(guard !== -1 && at - guard < 2600,
      file + ": the reset is no longer preceded by the `marker is absent -> first write` " +
      "branch. A reset attempted on a session with no password is refused by the rule.");
    const open = guard + "if (snap.val() == null) ".length;
    const close = src.indexOf("}", open);
    assert.ok(close > open && close < at, file + ": the first-write branch does not end before the reset");
    const branch = src.slice(open + 1, close).replace(/^\s*\/\/.*$/gm, "").trim();

    /* ONE statement, and it is a `return`. With the guard text intact but the
       `return` gone, the branch falls through: a session with no password is
       given its first hash AND then sent a reset, which the rule refuses —
       after the hash has landed. That mutant passed the first version of this
       check, which only looked for the guard somewhere above the reset. */
    assert.ok(/^return\s/.test(branch) && branch.endsWith(";") && branch.indexOf(";") === branch.length - 1,
      file + ": the first-write branch must be a single `return …;` — anything else can " +
      "fall through into the reset. It is:\n" + branch);
    assert.match(branch, /refMarker\.set\(randomAdminMarker\(\)\)/,
      file + ": the first-write branch must also write the marker, or the session has a " +
      "hash and still no `adminPasswordHash` — and can then never be reset");
    assert.ok(!branch.includes("refReset") && !branch.includes("reset/") && !branch.includes("recoveryCode"),
      file + ": the first-write branch must not touch the reset or the recovery code");
  }
});

test("client: createSession() writes the recovery code in the same batch as creatorUid", () => {
  /* Why (b) breaks nothing. The recovery write may arrive before `creatorUid`
     (none yet: allowed) or after it (the writer's own: allowed). What it must
     never do is arrive after a creatorUid that is somebody else's — and it
     cannot, while both are issued by one client in one batch, before the hash. */
  const src = read("script.js");
  const start = src.indexOf("function createSession(");
  const body = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const recovery = body.indexOf('db.ref("recovery/" + oPath(code)).set({ code: recoveryCode })');
  const creator = body.indexOf('writes.push(db.ref(oPath(code, "creatorUid")).set(_creatorUid))');
  const batch = body.indexOf("return Promise.all(writes)");
  const hash = body.indexOf("hashPassword(password, code)");
  assert.ok(recovery > 0 && creator > 0 && batch > 0 && hash > 0,
    "createSession() changed shape — re-read it against the recovery rule");
  assert.ok(recovery < batch && creator < batch, "both writes must be in the first batch");
  assert.ok(batch < hash, "and the batch must be issued before the password is hashed and written");
  assert.match(body, /const _creatorUid = \(auth && auth\.currentUser && auth\.currentUser\.uid\)/,
    "creatorUid must be the uid the writes are made as, or the creator fails their own binding");
});
