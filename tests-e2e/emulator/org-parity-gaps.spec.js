/* tests-e2e/emulator/org-parity-gaps.spec.js
 *
 * Two rule gaps found while driving the first org-scoped session end-to-end
 * (2026-08-05). Both were STATIC ANALYSIS when found — read off
 * database.rules.json, never observed. These tests observe them, against the
 * real rules in the emulator, because "I read the JSON and it looks wrong" is
 * not the same claim as "the database refused the write".
 *
 * They are written to DOCUMENT current behaviour, not to demand a fix in this
 * PR: each pairs the failing tree with the working one, so the assertion is
 * about the ASYMMETRY. When either gap is fixed, the corresponding test fails
 * loudly and points at itself — which is what you want from a test that pins a
 * known defect rather than a desired behaviour.
 *
 * GAP A — `rosters` is mis-nested by one level for orgs.
 *   The client writes `"rosters/" + sPath(uid)`, and sPath() is
 *   org-namespaced, so an org session writes
 *       rosters/orgs/<slug>/sessions/<code>/<uid>
 *   The rule, however, sits at
 *       rosters/sessions/orgs/$orgSlug/sessions/$sessionId/$uid
 *   i.e. under `rosters/sessions/`, mirroring the DEFAULT tree's shape and
 *   then nesting the org variant inside it. `rosters` has exactly one child
 *   (`sessions`) and no wildcard, so the org address matches nothing and the
 *   root's `.write: false` stands. Both call sites `.catch()`, so email
 *   capture and the facilitator roster export fail SILENTLY for every org
 *   session.
 *
 * GAP B — `audit` exists only in the ORG tree; the DEFAULT tree has none.
 *   logAdminAction() writes sPath("audit") for both trees. The org tree
 *   declares audit/$entryId with a real .write; `sessions/$sessionId` declares
 *   no audit, no `$other`, and nothing above it grants .write (root is
 *   `.write: false`). So the facilitator audit log has never worked on the
 *   default org — the mirror image of gap A.
 */

// @ts-check
const { test, expect, claimRoom } = require("./fixtures.js");

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

test("rules: GAP A — the roster write is denied for an org and allowed for the default tree", async ({ page }) => {
  const uid = await signedInUid(page);
  const code = "org-roster-" + Date.now().toString(36);
  const entry = { name: "Probe", email: "probe@example.test", university: "Caen", at: Date.now() };

  /* The address an ORG session actually produces. */
  const orgWrite = await tryWrite(page,
    "rosters/orgs/" + ORG + "/sessions/" + code + "/" + uid, entry);

  /* The DEFAULT tree's address, same payload, same caller — the control. If
     this were also denied the org result would prove nothing about nesting;
     it would just mean the payload or the caller was wrong. */
  const defaultWrite = await tryWrite(page,
    "rosters/sessions/" + code + "/" + uid, entry);

  expect(defaultWrite,
    "the default tree's roster write must be ALLOWED — it is the control that " +
    "proves the payload and caller are valid").toBe("ALLOWED");
  expect(orgWrite,
    "an org session's roster write lands at rosters/orgs/... which matches no " +
    "rule (the rule is nested under rosters/sessions/orgs/...), so it is denied"
  ).not.toBe("ALLOWED");
  expect(String(orgWrite)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);

  /* Name the shape explicitly, so a future fix that moves the rule to
     rosters/orgs/... makes this test fail with a message that explains why. */
  const misnested = await tryWrite(page,
    "rosters/sessions/orgs/" + ORG + "/sessions/" + code + "/" + uid, entry);
  expect(misnested,
    "the rule currently lives one level too deep — the path NO CLIENT EVER " +
    "WRITES is the one that is permitted. If this stops being ALLOWED the gap " +
    "has been fixed and this spec should be updated.").toBe("ALLOWED");
});

test("rules: GAP B — the audit write is allowed for an org and denied for the default tree", async ({ page }) => {
  const uid = await signedInUid(page);
  const envelope = { at: Date.now(), by: uid, kind: "probe", payload: {} };

  /* DEFAULT tree: sessions/<code>/audit has no rule, no $other above it, and
     root is .write:false — so logAdminAction() has never persisted here. */
  const defaultWrite = await tryWrite(page,
    "sessions/audit-probe-" + Date.now().toString(36) + "/audit/x1", envelope);

  expect(defaultWrite,
    "sessions/$sessionId declares no audit child and no $other, and nothing " +
    "above it grants .write — the facilitator audit log cannot persist on the " +
    "default org").not.toBe("ALLOWED");
  expect(String(defaultWrite)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);

  /* The org tree DOES declare audit/$entryId. It is admin-gated, so an
     unprivileged caller is refused there too — but for a DIFFERENT reason,
     and that distinction is the point: one tree has a rule that says no, the
     other has no rule at all. Assert the rule EXISTS rather than that this
     caller may use it. */
  const orgRules = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..",
      "docs", "Third_session", "PBL_platform", "database.rules.json"), "utf8");
  const parsed = JSON.parse(orgRules).rules;
  expect(parsed.orgs.$orgSlug.sessions.$sessionId.audit,
    "the ORG tree must declare an audit rule").toBeTruthy();
  expect(parsed.sessions.$sessionId.audit,
    "the DEFAULT tree must NOT — that asymmetry is the gap this test pins").toBeFalsy();
  expect(parsed.sessions.$sessionId.$other,
    "and there is no $other to catch it either").toBeFalsy();
});

test("rules: the org tree DOES accept a legitimate per-slot answer (the gap is not 'orgs are broken')", async ({ page, browser }) => {
  /* Context for the two gaps above: org rules are not wholesale missing. The
     answers path a real org session uses works, which is what makes the two
     gaps specific defects rather than "org is unimplemented". */
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

  /* Session-level membership. BOTH trees gate reads at
     `<session>.read: members.hasChild(auth.uid)`, and claimRoom deliberately
     writes only the room-claim chain (clientMapping / pool / roomOf) — so
     without this the read below is denied for want of a join, not for want of
     an org rule. Discovered by the read failing and then reading the rule,
     rather than by deleting the assertion that failed. */
  /* `true` is rejected: .validate requires an object with a recent `at`. */
  const joined = await tryWrite(page, base + "/members/" + uid, { at: Date.now() });
  expect(joined, "self-join must be allowed — it gates every read below").toBe("ALLOWED");

  const answer = await tryWrite(page,
    base + "/rooms/Room 1/answers/sections/1/probe1",
    { at: Date.now(), by: "Probe", cid, text: "an org answer", bulletKey: "b1", university: "Caen" });
  expect(answer,
    "the per-slot answers path an org session actually writes must be allowed"
  ).toBe("ALLOWED");

  const readBack = await page.evaluate(async (p) => {
    const s = await firebase.database().ref(p).once("value");
    return s.val();
  }, base + "/rooms/Room 1/answers/sections/1/probe1/text");
  expect(readBack, "and it must be readable back from the org tree").toBe("an org answer");
});
