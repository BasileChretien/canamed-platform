/* tests-e2e/emulator/anonymous-account-retention.spec.js
 *
 * The anonymous-account retention job (issue #347), run for real: real
 * anonymous sign-ins, the real Auth and Realtime Database emulators, the real
 * job, and then the browser that was holding the deleted account.
 *
 * The unit tests drive the job against fakes. What they cannot show — and what
 * decides whether deleting accounts is SAFE — is on the other side:
 *
 *   1. that the deletion request is one a real Identity Toolkit implementation
 *      accepts and acts on;
 *   2. that the lister really does stop when a server hands back more than was
 *      asked for (the Auth emulator ignores `fields`, which makes it a ready
 *      positive control);
 *   3. that a participant whose account was removed is signed in afresh on
 *      their next visit, with nothing for them to do.
 *
 * (3) is the property the whole design leans on. Without it this job would
 * leave returning participants holding a dead credential.
 *
 * ⚠️ WHAT (3) COVERS, exactly, because the first version of this test asserted
 * more and was wrong. It covers the NEXT PAGE LOAD: on start-up the Auth SDK
 * reloads the stored user and, on any failure that is not a network error,
 * clears it (`reloadAndSetCurrentUserOrClear`); the platform then signs in
 * anonymously again. That is what a returning participant actually does, and
 * an account is only ever deleted after 90 days of not doing it.
 *
 * It does NOT cover a tab that stays open across the deletion. There the SDK
 * signs out only on `auth/user-token-expired` or `auth/user-disabled`. Google
 * documents USER_NOT_FOUND for a deleted account's refresh, which this SDK
 * build maps to `user-token-expired` — but the emulator answers
 * INVALID_REFRESH_TOKEN instead, which is not in that set, so the emulator
 * cannot show the in-tab path either way. Stated rather than papered over: a
 * tab open and idle for 90 days is the case this suite cannot reach.
 *
 * The job is handed a clock 100 days ahead rather than old accounts, because
 * the emulator cannot backdate one. It therefore treats EVERY anonymous account
 * in the emulator as idle — harmless here because this suite runs one worker,
 * so the only live browsers are this test's own.
 */

// @ts-check
const { test, expect, useEmulator, PROJECT, dbReadAsOwner } = require("./fixtures");
const { runAnonymousRetention } = require("../../scripts/lib/anonymous-retention-job");
const {
  listAccounts, lookupAccounts, deleteAccounts, normaliseAccount
} = require("../../scripts/lib/auth-accounts");
const { DAY_MS } = require("../../scripts/lib/anonymous-retention");

const AUTH_API = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const DB = "http://127.0.0.1:9000";
const NS = PROJECT + "-default-rtdb";
const OWNER = { Authorization: "Bearer owner" };
const authDeps = { fetch, getToken: async () => "owner", projectId: PROJECT, apiBase: AUTH_API };

const signedIn = (page) => page.waitForFunction(
  () => window.firebase && firebase.auth && firebase.auth().currentUser, null, { timeout: 30_000 });
const uidOf = (page) => page.evaluate(() => firebase.auth().currentUser.uid);

/* The job's database access, pointed at the emulator with the owner bypass —
   the same privilege the Admin SDK has in production. Paths arrive already
   URL-encoded. */
const dbUrl = (p, extra) => DB + "/" + p + ".json?ns=" + NS + (extra || "");
async function dbGet(p, extra) {
  const res = await fetch(dbUrl(p, extra), { headers: OWNER });
  if (!res.ok) throw new Error("emulator read failed: HTTP " + res.status);
  return res.json();
}
async function dbWrite(method, p, body) {
  const res = await fetch(dbUrl(p), {
    method, headers: Object.assign({ "Content-Type": "application/json" }, OWNER),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("emulator " + method + " failed: HTTP " + res.status);
}

/** Every account the Auth emulator holds, whole — read directly, not through
 *  the code under test. */
async function emulatorAccounts() {
  const res = await fetch(AUTH_API + "/projects/" + PROJECT + "/accounts:batchGet?maxResults=1000",
    { headers: OWNER });
  if (!res.ok) throw new Error("emulator account list failed: HTTP " + res.status);
  return (await res.json()).users || [];
}

/** A signed-in (e-mail/password) account. The job refuses a listing that has
 *  none, and this is also the account it must never touch. */
async function createSignedInAccount(label) {
  const email = label + "-" + Date.now() + "@example.test";
  const res = await fetch(AUTH_API + "/accounts:signUp?key=fake-emulator-key", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Emu-Passw0rd!", returnSecureToken: true })
  });
  if (res.status !== 200) throw new Error("could not create an e-mail account: HTTP " + res.status);
  return { email, uid: (await res.json()).localId };
}

test.describe("anonymous-account retention against the emulators (#347)", () => {

  test("the lister REFUSES a server that hands back an e-mail address", async () => {
    /* The one privacy property nothing local could otherwise show. The Auth
       emulator does not implement `fields`: asked for five named fields, it
       returns the whole record. That is precisely the failure the lister
       exists to catch, so against the emulator it must stop — and say what
       came back, without repeating it.
       If the emulator ever learns to honour the mask, the first expectation
       below fails; that is the signal to make this a test of the masked path. */
    const { email: address } = await createSignedInAccount("masked");

    const held = (await emulatorAccounts()).find((u) => u.email === address);
    expect(held, "the emulator should hold the address it was just given").toBeTruthy();

    const refusal = await listAccounts(authDeps).then(() => null, (e) => e);
    expect(refusal, "the lister accepted records it never asked for").toBeTruthy();
    expect(refusal.message).toMatch(/mask was NOT honoured/);
    expect(refusal.message).toMatch(/email/);
    expect(refusal.message, "the address itself must never reach the message").not.toContain(address);
  });

  test("an idle anonymous account goes with its records; its owner is signed in afresh", async ({ page, browser }) => {
    // ── A: the participant who will be removed ──────────────────────────────
    await page.goto("/");
    await signedIn(page);
    const uidA = await uidOf(page);

    /* The session history the pre-#348 bug wrote under every anonymous joiner,
       written here the way that bug wrote it: by the client, through the rules. */
    const wrote = await page.evaluate(async (uid) => {
      try {
        await firebase.database().ref("users/" + uid + "/history/EMUHIST")
          .set({ code: "EMUHIST", joinedAt: Date.now() });
        return "ALLOWED";
      } catch (e) { return (e && e.code) || "DENIED"; }
    }, uidA);
    expect(wrote).toBe("ALLOWED");
    expect(await dbReadAsOwner("users/" + uidA + "/history/EMUHIST")).toBeTruthy();

    /* A signed-in account, exactly as old as A by the job's clock. The job
       refuses a listing with none, and this is the one it must leave alone. */
    const namedAccount = await createSignedInAccount("signedin");

    // ── B: just as idle, but a live session still names them ────────────────
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await useEmulator(pageB);
    await pageB.goto("/");
    await signedIn(pageB);
    const uidB = await uidOf(pageB);
    expect(uidB, "a second CONTEXT must be a second user").not.toBe(uidA);
    /* B carries the same bug-written history. B's ACCOUNT will survive; the
       history should not. */
    const wroteB = await pageB.evaluate(async (uid) => {
      try {
        await firebase.database().ref("users/" + uid + "/history/EMUHIST")
          .set({ code: "EMUHIST", joinedAt: Date.now() });
        return "ALLOWED";
      } catch (e) { return (e && e.code) || "DENIED"; }
    }, uidB);
    expect(wroteB).toBe("ALLOWED");

    const code = "ANONRET" + Date.now().toString(36).toUpperCase();
    await dbWrite("PUT", "sessions/" + code, {
      created: { at: Date.now() }, members: { [uidB]: true }
    });

    try {
      // ── the job, "100 days from now" ──────────────────────────────────────
      const report = await runAnonymousRetention({
        /* The emulator ignores the mask (previous test), so each record is cut
           down here to the shape production returns, and then goes through the
           real normaliser. Everything else below is the real code path. */
        listAccounts: async () => (await emulatorAccounts()).map((u) => normaliseAccount({
          localId: u.localId, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
          lastRefreshAt: u.lastRefreshAt,
          providerUserInfo: (u.providerUserInfo || []).map((p) => ({ providerId: p.providerId }))
        })),
        /* The REAL re-check and the REAL delete. The candidates are all
           anonymous, and the emulator's record for an anonymous account holds
           nothing beyond the masked fields, so the strict check passes. */
        lookupAccounts: (uids) => lookupAccounts(authDeps, uids),
        deleteAccounts: (uids) => deleteAccounts(authDeps, uids),
        fetchShallow: (p) => dbGet(p, "&shallow=true"),
        readValue: (p) => dbGet(p),
        updateRoot: (update) => dbWrite("PATCH", "", update)
      }, {
        nowMs: Date.now() + 100 * DAY_MS, windowMs: 90 * DAY_MS, confirm: true, sweepOrphans: false
      });

      expect(report.written.failedUpdates).toBe(0);
      expect(report.auth.failed, "the Auth emulator rejected the batchDelete request").toBe(0);
      expect(report.auth.deleted).toBeGreaterThanOrEqual(1);
      expect(report.accounts.protected).toBeGreaterThanOrEqual(1);

      // ── the DATABASE first, then anything that renders ────────────────────
      expect(await dbReadAsOwner("users/" + uidA), "A's records must be gone").toBeNull();
      const remaining = (await emulatorAccounts()).map((u) => u.localId);
      expect(remaining, "A's account must be gone").not.toContain(uidA);
      /* The control that makes the line above mean something: B was exactly as
         idle, and survives only because a live session names them. */
      expect(remaining, "B is still in a live session and must survive").toContain(uidB);
      /* ...but the history the bug wrote under B goes, account or no account. */
      expect(await dbReadAsOwner("users/" + uidB), "B's bug-written history must be gone").toBeNull();
      /* And the signed-in account is as idle as A by this clock. It has a
         provider, so it is not this job's to touch. */
      expect(remaining,
        "a signed-in account was deleted by a job that only removes anonymous ones")
        .toContain(namedAccount.uid);
      expect(report.accounts.named).toBeGreaterThanOrEqual(1);

      // ── A's next visit ────────────────────────────────────────────────────
      expect(await uidOf(page), "the open tab has not noticed, and need not").toBe(uidA);
      await page.reload();
      await page.waitForFunction((old) => {
        const u = firebase.auth().currentUser;
        return !!u && u.uid !== old;
      }, uidA, { timeout: 30_000 });
      const uidA2 = await uidOf(page);
      expect(uidA2).not.toBe(uidA);
      expect(await page.evaluate(() => firebase.auth().currentUser.isAnonymous)).toBe(true);

      /* And the database has the NEW identity, not a stale token for the old
         one: reading their own node is allowed, the old one's is not. */
      const readAs = (uid) => page.evaluate(async (u) => {
        try { await firebase.database().ref("users/" + u).once("value"); return "ALLOWED"; }
        catch (e) { return (e && e.code) || "DENIED"; }
      }, uid);
      expect(await readAs(uidA2)).toBe("ALLOWED");
      expect(await readAs(uidA)).toBe("PERMISSION_DENIED");
    } finally {
      await dbWrite("PUT", "sessions/" + code, null);
      await ctxB.close();
    }
  });
});
