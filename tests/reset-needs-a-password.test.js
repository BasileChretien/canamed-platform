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
 *   (a) `_superadminReset` may be written only where the session HAS a
 *       password (`adminPasswordHash` exists). A reset needs something to
 *       reset. Without it, whoever held a session's recovery code set its
 *       FIRST hash, whatever `creatorUid` said.
 *   (b) the recovery node may be written only where the session has no
 *       `creatorUid`, or by that creator. Without it — and (a) alone does not
 *       help here — a stranger plants a code on a session with no password,
 *       waits for its creator to set one, and resets it then. A session
 *       restored from the nightly archive is in exactly that state.
 *
 * Both were measured as takeovers before the change (2026-10-07, both trees).
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
const GATE = "(root.child('facilitatorGate').child('enforce').val() != true || " +
  "root.child('facilitatorGate').child('allow').child(auth.uid).val() == true)";

const TREES = [
  { name: "default", base: SESS, rec: REC_SESS,
    reset: rules.sessions.$sessionId._superadminReset[".write"],
    recovery: rules.recovery.sessions.$sessionId[".write"],
    hash: rules.adminSecrets.$code.hash[".write"],
    hashBase: "root.child('sessions').child($code)" },
  { name: "org", base: ORG, rec: REC_ORG,
    reset: rules.orgs.$orgSlug.sessions.$sessionId._superadminReset[".write"],
    recovery: rules.recovery.orgs.$orgSlug.sessions.$sessionId[".write"],
    hash: rules.adminSecrets.orgs.$orgSlug.$sessionId.hash[".write"],
    hashBase: ORG }
];

for (const t of TREES) {
  test(`${t.name} tree: (a) a reset is refused unless the session has a password`, () => {
    const need = t.base + ".child('adminPasswordHash').exists()";
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
    assert.ok(conditions.startsWith(need + " && "),
      "the password requirement must be the first condition of the reset branch, " +
      "ANDed with the others. Elsewhere it may be ORed away: " + t.reset);
    assert.ok(!/\|\|/.test(conditions),
      "an OR appeared inside the reset branch. Every condition there has to hold " +
      "together; an alternative is a way round all of them: " + t.reset);

    /* Everything it asked before is still asked. */
    for (const kept of [
      "auth != null", "!" + t.base + ".child('closed').exists()",
      "newData.child('requestedAt').val() >= now - 5000", "newData.child('requestedAt').val() <= now + 5000",
      t.rec + ".child('code').exists()",
      "newData.child('code').val() == " + t.rec + ".child('code').val()",
      "newData.child('uid').val() == auth.uid"
    ]) assert.ok(t.reset.includes(kept), "the reset rule lost `" + kept + "`");
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
  const [dflt, org] = TREES;
  assert.strictEqual(reprefix(dflt.reset), org.reset, "the two reset rules have drifted apart");
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
     it is absent, takes the first-write branch (no reset, no recovery code). */
  for (const [file, resetRef] of [
    ["script.js", 'db.ref(sPath("_superadminReset"))'],
    ["script-admin.js", 'db.ref(oPath(targetSession, "_superadminReset"))']
  ]) {
    const src = read(file);
    const at = src.indexOf(resetRef);
    assert.notStrictEqual(at, -1, file + " no longer builds the reset the way this test expects");
    assert.strictEqual(src.split("_superadminReset\")").length - 1, 1,
      file + " now builds a reset in more than one place — check each against the rule");
    const before = src.slice(Math.max(0, at - 2600), at);
    const guard = before.lastIndexOf("if (snap.val() == null) {");
    assert.notStrictEqual(guard, -1,
      file + ": the reset is no longer preceded by the `marker is absent -> first write` " +
      "branch. A reset attempted on a session with no password is refused by the rule.");
    assert.match(before.slice(guard), /refMarker\.set\(randomAdminMarker\(\)\)/,
      file + ": the first-write branch must also write the marker, or the session has a " +
      "hash and still no `adminPasswordHash` — and can then never be reset");
    assert.match(before, /refMarker\.once\("value"\)/, file + ": the branch must be decided on the marker");
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
