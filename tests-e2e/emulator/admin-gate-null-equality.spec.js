/* tests-e2e/emulator/admin-gate-null-equality.spec.js
 *
 * The admin gate on several session-level nodes reads:
 *
 *   creatorUid == auth.uid
 *   || adminSecrets/<code>/proof/<auth.uid>.val() == adminSecrets/<code>/hash.val()
 *
 * When NO admin secret exists, both sides of that comparison are `null`, and
 * `null == null` is TRUE — so the second disjunct passes for EVERY
 * authenticated user and the gate is open.
 *
 * REACHABILITY IS NOT HYPOTHETICAL. The rules also require
 * `sessions/<code>/adminPasswordHash` to exist, so the vulnerable shape is
 * "has adminPasswordHash, has no adminSecrets/hash". That is exactly what a
 * session predating the adminSecrets scheme (FINDING-07) looks like, and the
 * client still supports them: verifyAdminPassword()'s fallback is commented
 * "an older session that predates adminSecrets". So the state is one the
 * product expects to encounter, not one that requires an attacker to create it.
 *
 * On such a session, any authenticated participant could:
 *   - CLOSE it (write-once, unrecoverable — ends the session for everyone)
 *   - write its summary and audit log
 *   - reassign participants between rooms (pool/<cid>/room)
 *   - enqueue MAIL (sendQueuedMail performs no authorisation of its own; the
 *     RTDB rule is the only gate on who may enqueue)
 *
 * 26 of the 36 sites using this disjunct ALREADY guard it with
 * `adminSecrets/<code>/hash.exists() &&` — roomOf does, for both .read and
 * .write. So the correct shape is already established in the same file; the
 * remaining 10 are an omission. This spec pins the fix for the highest-impact
 * one (`closed`) and for `mail`, plus the org mirrors.
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

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

/* Build the LEGACY shape: adminPasswordHash present, adminSecrets/<code>/hash
   ABSENT. Returns the session code. */
async function legacySession(page, uid, prefix) {
  const code = prefix + Date.now().toString(36);
  const base = "sessions/" + code;
  const r = await page.evaluate(async ([b, u]) => {
    try {
      await firebase.database().ref(b + "/creatorUid").set(u);
      await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
      /* The REAL hash, at the pre-adminSecrets address. No adminSecrets node. */
      await firebase.database().ref(b + "/adminPasswordHash").set("c".repeat(64));
      return "OK";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, [base, uid]);
  if (r !== "OK") throw new Error("legacy session seed failed: " + r);
  return code;
}

/* A second PRINCIPAL, not merely a second page: the emulator pinning rides the
   `page` fixture, so a bare browser.newPage() reaches no Firebase at all. */
async function peerPage(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await useEmulator(p);
  const uid = await signedInUid(p);
  return { ctx, page: p, uid };
}

test("rules: a peer cannot CLOSE a session that predates adminSecrets", async ({ page, browser }) => {
  const uid = await signedInUid(page);
  const code = await legacySession(page, uid, "legacy-close-");

  const peer = await peerPage(browser);
  expect(peer.uid, "the peer must be a different principal").not.toBe(uid);
  try {
    const closed = await tryWrite(peer.page, "sessions/" + code + "/closed",
      { by: "Attacker", at: Date.now() });
    expect(closed,
      "closing is write-once and unrecoverable — a participant must not be " +
      "able to end the session for everyone just because the session predates " +
      "the adminSecrets scheme").not.toBe("ALLOWED");
    expect(String(closed)).toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
  } finally { await peer.ctx.close(); }

  /* The creator must STILL be able to close it — the guard must not lock the
     legitimate facilitator out of their own legacy session. */
  const byCreator = await tryWrite(page, "sessions/" + code + "/closed",
    { by: "Facilitator", at: Date.now() });
  expect(byCreator, "the creator must still be able to close their session")
    .toBe("ALLOWED");
});

test("rules: a peer cannot ENQUEUE MAIL on a session that predates adminSecrets", async ({ page, browser }) => {
  /* sendQueuedMail does no authorisation of its own — it trusts whatever is at
     the node — so this rule is the ONLY gate on who may enqueue. */
  const uid = await signedInUid(page);
  const code = await legacySession(page, uid, "legacy-mail-");

  const peer = await peerPage(browser);
  try {
    const enqueued = await tryWrite(peer.page, "sessions/" + code + "/mail/m1",
      { to: "victim@example.test", subject: "spam", text: "spam", at: Date.now() });
    expect(enqueued,
      "the mail queue must stay admin-gated — sendQueuedMail re-checks nothing, " +
      "so a bypass here is an open relay").not.toBe("ALLOWED");
  } finally { await peer.ctx.close(); }
});

test("rules: a peer cannot REASSIGN a room on a session that predates adminSecrets", async ({ page, browser }) => {
  const uid = await signedInUid(page);
  const code = await legacySession(page, uid, "legacy-pool-");
  const cid = "cid" + Date.now().toString(36);

  /* clientMapping MUST be seeded. `pool/$clientId`.write has a tolerant
     first-write branch that grants when the mapping does NOT yet exist (the
     documented join-race allowance), and that grant CASCADES to `room`. With
     the mapping absent, a peer is let through by that branch and the test
     would look like an admin-gate bypass when it is nothing of the kind.
     Owned by the creator here, so the peer is a genuine outsider. */
  await page.evaluate(async ([b, c, u]) => {
    await firebase.database().ref(b + "/clientMapping/" + c).set(u);
    await firebase.database().ref(b + "/pool/" + c).set({
      name: "Victim", university: "Caen", year: 4, english: "B2",
      at: Date.now(), room: "Room 1"
    });
  }, ["sessions/" + code, cid, uid]);

  const peer = await peerPage(browser);
  try {
    const moved = await tryWrite(peer.page,
      "sessions/" + code + "/pool/" + cid + "/room", "Room 2");
    expect(moved,
      "room assignment is admin-gated; the null-equality bypass made it open " +
      "on any pre-adminSecrets session").not.toBe("ALLOWED");
  } finally { await peer.ctx.close(); }
});

test("rules: the ORG tree carries the same guard", async ({ page, browser }) => {
  const uid = await signedInUid(page);
  const code = "legacy-org-" + Date.now().toString(36);
  const base = "orgs/e2e-org/sessions/" + code;

  const seeded = await page.evaluate(async ([b, u]) => {
    try {
      await firebase.database().ref(b + "/creatorUid").set(u);
      await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
      await firebase.database().ref(b + "/adminPasswordHash").set("c".repeat(64));
      return "OK";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, [base, uid]);
  expect(seeded).toBe("OK");

  const peer = await peerPage(browser);
  try {
    const closed = await tryWrite(peer.page, base + "/closed",
      { by: "Attacker", at: Date.now() });
    expect(closed, "the org mirror must be guarded too — fixing only the " +
      "default tree would leave the same hole one namespace over")
      .not.toBe("ALLOWED");
  } finally { await peer.ctx.close(); }
});

test("rules: a REAL admin proof still opens the gate (the guard must not break login)", async ({ page }) => {
  /* The guard adds `hash.exists()`. If that were written wrongly it would lock
     out the legitimate proof path too, which no other test here would catch. */
  const uid = await signedInUid(page);
  const code = "proof-ok-" + Date.now().toString(36);
  const base = "sessions/" + code;
  const realHash = "d".repeat(64);

  await page.evaluate(async ([b, u, h, c]) => {
    await firebase.database().ref(b + "/creatorUid").set(u);
    await firebase.database().ref(b + "/created").set({ at: Date.now(), by: u });
    await firebase.database().ref(b + "/adminPasswordHash").set("e".repeat(64));
    await firebase.database().ref("adminSecrets/" + c + "/hash").set(h);
  }, [base, uid, realHash, code]);

  /* A DIFFERENT principal who supplies the correct password — i.e. writes a
     matching proof — must still pass the gate. */
  const other = await page.context().browser().newContext();
  const op = await other.newPage();
  await useEmulator(op);
  const otherUid = await signedInUid(op);
  try {
    expect(await tryWrite(op, "adminSecrets/" + code + "/proof/" + otherUid, realHash))
      .toBe("ALLOWED");
    const summary = await tryWrite(op, base + "/summary", { at: Date.now() });
    expect(summary,
      "a co-facilitator holding a VALID admin proof must still pass the gate")
      .toBe("ALLOWED");
  } finally { await other.close(); }
});
