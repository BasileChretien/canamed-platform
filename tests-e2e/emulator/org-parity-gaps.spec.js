/* tests-e2e/emulator/org-parity-gaps.spec.js
 *
 * Two rule-tree asymmetries found while driving the first org-scoped session
 * end-to-end (#291, 2026-08-05), and FIXED here. Each was a case of one tree
 * having a rule the other lacked, so a feature worked on one and silently did
 * nothing on the other.
 *
 * GAP A — `rosters` was mis-nested by one level for orgs.
 *   The client writes `"rosters/" + sPath(uid)`, and sPath() is org-namespaced,
 *   so an org session addresses
 *       rosters/orgs/<slug>/sessions/<code>/<uid>
 *   The rule sat at
 *       rosters/sessions/orgs/$orgSlug/sessions/$sessionId/$uid
 *   — the org variant nested INSIDE the default tree's shape. `rosters` had one
 *   child (`sessions`) and no wildcard, so the address a client actually uses
 *   matched nothing and the root's `.write:false` stood. Both call sites
 *   `.catch()`, so email capture and the facilitator roster export failed
 *   SILENTLY for every org session. Fixed by moving the block to `rosters/orgs`.
 *
 * GAP B — `audit` existed only in the ORG tree.
 *   logAdminAction() writes sPath("audit") for both trees, but
 *   `sessions/$sessionId` declared no audit child, no `$other`, and nothing
 *   above it granted .write (root is `.write:false`). The facilitator audit log
 *   had never persisted on the DEFAULT org — which is the one in production.
 *   Fixed by mirroring the org tree's audit rule, admin-gate and validator
 *   included, into the default tree.
 *
 * These tests assert the FIXED contract on both trees. They started life
 * asserting the broken one (deliberately: a test that pins a known defect
 * should fail when the defect is fixed, and say so) — and they did exactly
 * that when these rules changed, which is how the rewrite was prompted.
 *
 * NB the emulator is the only thing that can answer these questions. The LOCAL
 * Playwright suite models no rules at all, and both gaps were originally found
 * by READING database.rules.json — a weaker claim than watching the database
 * refuse a write.
 */

// @ts-check
const { test, expect, claimRoom, useEmulator } = require("./fixtures.js");

const ORG = "e2e-org";

/* Sign in anonymously and hand back the uid, so a write is even attempted. */
async function signedInUid(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* Attempt one write and report ALLOWED / the error code. Never throws, so a
   test can compare two trees in one pass. */
function tryWrite(page, path, value) {
  return page.evaluate(async ([p, v]) => {
    try {
      await firebase.database().ref(p).set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, [path, value]);
}

test("rules: GAP A — a roster entry is accepted at the address an ORG session actually writes", async ({ page }) => {
  const uid = await signedInUid(page);
  const code = "org-roster-" + Date.now().toString(36);
  const entry = { name: "Probe", email: "probe@example.test", university: "Caen", at: Date.now() };

  /* The address "rosters/" + sPath(uid) produces for an org. This was DENIED
     before the fix, silently, because the rule lived one level deeper. */
  const orgWrite = await tryWrite(page,
    "rosters/orgs/" + ORG + "/sessions/" + code + "/" + uid, entry);
  expect(orgWrite,
    "an org session's roster write must be accepted at rosters/orgs/<slug>/..."
  ).toBe("ALLOWED");

  /* The default tree still works — the fix moved the org branch, it did not
     re-home the default one. */
  const defaultWrite = await tryWrite(page,
    "rosters/sessions/" + code + "/" + uid, entry);
  expect(defaultWrite, "the default tree's roster write must still be ALLOWED")
    .toBe("ALLOWED");

  /* And the OLD mis-nested address must no longer be writable. If this were
     still allowed the block would have been copied rather than moved, leaving
     a second, unreachable rule behind to rot. */
  const oldPath = await tryWrite(page,
    "rosters/sessions/orgs/" + ORG + "/sessions/" + code + "/" + uid, entry);
  expect(oldPath,
    "the mis-nested address must be gone, not merely superseded — a leftover " +
    "duplicate would drift out of sync with the real one").not.toBe("ALLOWED");
});

test("rules: GAP B — the audit log persists on the DEFAULT tree, and stays admin-gated", async ({ page }) => {
  const uid = await signedInUid(page);
  const code = "audit-" + Date.now().toString(36);
  const base = "sessions/" + code;

  /* Establish this caller as the session creator, which is one arm of the
     admin gate the org tree already used. */
  const seeded = await page.evaluate(async ([b, u]) => {
    try {
      await firebase.database().ref(b + "/creatorUid").set(u);
      await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
      return "OK";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, [base, uid]);
  expect(seeded, "the creator must be able to establish the session").toBe("OK");

  const envelope = { kind: "probe", by: "Facilitator", at: Date.now() };

  /* The gate requires adminPasswordHash to EXIST. Before it does, even the
     creator is refused — so this also proves the rule is a real gate and not a
     blanket allow that happens to let the creator through. */
  const beforeHash = await tryWrite(page, base + "/audit/e1", envelope);
  expect(beforeHash,
    "without an admin password configured the audit write must be refused, " +
    "even for the creator — otherwise the new rule is not actually gating"
  ).not.toBe("ALLOWED");

  /* 64 hex chars: .validate accepts /^[0-9a-f]{64}$/ or a v2$…$… form, so a
     human-readable marker is rejected. Mirrors rules-smoke.spec.js. */
  const hash = await tryWrite(page, base + "/adminPasswordHash", "a".repeat(64));
  expect(hash, "the creator must be able to configure the admin marker").toBe("ALLOWED");

  const afterHash = await tryWrite(page, base + "/audit/e1", envelope);
  expect(afterHash,
    "with the admin gate satisfied the facilitator audit log must persist on " +
    "the DEFAULT tree — it never did before this fix").toBe("ALLOWED");

  /* Write-once, mirroring the org rule's `!data.exists()`. */
  const rewrite = await tryWrite(page, base + "/audit/e1", envelope);
  expect(rewrite, "an audit entry must be write-once").not.toBe("ALLOWED");

  /* The validator must reject a malformed envelope, or the log is unusable. */
  const bad = await tryWrite(page, base + "/audit/e2", { kind: "probe" });
  expect(bad, "an envelope missing by/at must be rejected").not.toBe("ALLOWED");
});

test("rules: GAP B — a NON-admin still cannot write the default tree's audit log", async ({ page, browser }) => {
  /* The gap was a missing rule, and the cheapest wrong fix would have been a
     permissive one. This is the assertion that would catch that. */
  const uid = await signedInUid(page);
  const code = "audit-peer-" + Date.now().toString(36);
  const base = "sessions/" + code;

  /* Mirror the PRODUCTION shape: the real hash lives at adminSecrets/<code>/hash
     (FINDING-07), and the session node carries only a non-secret marker. Without
     the secret, `proof/<uid> == hash` compares null to null and is vacuously TRUE,
     so ANY authenticated user clears the admin gate. That quirk is shared by the
     pre-existing `closed` and `summary` rules and is recorded as its own finding —
     it is not introduced here, and it does not apply to a real session. */
  await page.evaluate(async ([b, c, u]) => {
    await firebase.database().ref(b + "/creatorUid").set(u);
    await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
    await firebase.database().ref(b + "/adminPasswordHash").set("a".repeat(64));
    await firebase.database().ref("adminSecrets/" + c + "/hash").set("b".repeat(64));
  }, [base, code, uid]);

  /* A separate CONTEXT, with useEmulator() applied by hand: the emulator
     pinning rides the `page` fixture, so a bare browser.newPage() would talk
     to no Firebase at all and hang waiting for sign-in. Mirrors the
     multi-principal tests in rules-smoke.spec.js. */
  const peerCtx = await browser.newContext();
  const peer = await peerCtx.newPage();
  await useEmulator(peer);
  const peerUid = await signedInUid(peer);
  expect(peerUid, "the peer must be a DIFFERENT principal").not.toBe(uid);

  const peerWrite = await tryWrite(peer, base + "/audit/e1",
    { kind: "probe", by: "Peer", at: Date.now() });
  expect(peerWrite,
    "a participant who is neither the creator nor holds the admin proof must " +
    "not be able to forge audit-log entries").not.toBe("ALLOWED");
  expect(String(peerWrite)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
  await peerCtx.close();
});

test("rules: the org tree still accepts a legitimate per-slot answer", async ({ page }) => {
  /* Regression guard for the rosters move: it edits the `rosters` subtree, not
     the session trees, but a brace-matching edit to a rules file deserves a
     check that the neighbouring trees still work. */
  const uid = await signedInUid(page);
  const code = "org-ok-" + Date.now().toString(36);
  const base = "orgs/" + ORG + "/sessions/" + code;
  const cid = "cid-" + Date.now().toString(36);

  const seeded = await page.evaluate(async ([b, u]) => {
    try {
      await firebase.database().ref(b + "/creatorUid").set(u);
      await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
      return "OK";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, [base, uid]);
  expect(seeded, "the org session must be creatable by its creator").toBe("OK");

  await claimRoom(page, base, "Room 1", uid, cid);

  /* Both trees gate reads at <session>.read on members.hasChild(auth.uid), and
     claimRoom() writes only the room-claim chain — so the read below needs an
     explicit self-join. `true` is rejected: .validate wants a recent `at`. */
  const joined = await tryWrite(page, base + "/members/" + uid, { at: Date.now() });
  expect(joined, "self-join must be allowed — it gates every read below").toBe("ALLOWED");

  const answer = await tryWrite(page,
    base + "/rooms/Room 1/answers/sections/1/probe1",
    { at: Date.now(), by: "Probe", cid, text: "an org answer", bulletKey: "b1", university: "Caen" });
  expect(answer, "the per-slot answers path an org session writes must be allowed")
    .toBe("ALLOWED");

  const readBack = await page.evaluate(async (p) => {
    const s = await firebase.database().ref(p).once("value");
    return s.val();
  }, base + "/rooms/Room 1/answers/sections/1/probe1/text");
  expect(readBack, "and it must be readable back from the org tree").toBe("an org answer");
});
