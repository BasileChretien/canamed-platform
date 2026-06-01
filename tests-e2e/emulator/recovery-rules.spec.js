/* tests-e2e/emulator/recovery-rules.spec.js
 *
 * D21 (hardened) — FUNCTIONAL rules test against the REAL Firebase emulator.
 *
 * This is the test that actually proves the security boundary the LOCAL-mode
 * suite cannot (LocalDB does not enforce database.rules.json). It exercises
 * the live rules end-to-end:
 *
 *   SETUP   — a facilitator creates a session through the UI. createSession
 *             writes the recovery code to the unreadable /recovery subtree
 *             (before the password hash) and surfaces it once on the created
 *             view. We capture it from #splash-recovery-code.
 *
 *   NEGATIVE — a SECOND, independently-authenticated client (a "participant"
 *              who only knows the session code, not the recovery code):
 *                a) cannot READ the recovery code back (/recovery is .read:false)
 *                b) cannot write _superadminReset with NO code            → denied
 *                c) cannot write _superadminReset with a WRONG code        → denied
 *                d) cannot overwrite adminPasswordHash directly            → denied
 *
 *   POSITIVE — the same client, presenting the CORRECT recovery code, CAN
 *              write _superadminReset and then overwrite adminPasswordHash.
 *
 * The negative writes failing with PERMISSION_DENIED is the whole point: it
 * means a participant who knows the (spoken-aloud) session code still cannot
 * hijack the admin password, because the recovery code is the gate and they
 * cannot read or guess it.
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

async function createSessionUI(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Recovery Emu Fac");
  await page.locator("#splash-create-label").fill("recovery-rules");
  await page.locator("#splash-create-pass").fill("emu-init-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  // The recovery code is surfaced once on the created view.
  const recoveryNode = page.locator("#splash-recovery-code");
  await expect(recoveryNode).toBeVisible({ timeout: 10_000 });
  const recovery = (await recoveryNode.textContent()).trim();
  return { code, recovery };
}

// Wait for anonymous sign-in so SDK writes are attempted as an authed user.
async function waitForAuth(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
}

// The session subtree path in the default (caen-nagoya) deployment is
// "sessions/<lowercased code>". The UI shows the code uppercased; the engine
// stores it lowercased (sanitizeCode). Match the engine here.
function sessionPath(code) {
  return "sessions/" + code.toLowerCase();
}

test("rules: a non-creator cannot reset the password without the recovery code, but CAN with it", async ({ page, context, browser }) => {
  // ---- SETUP: facilitator creates the session (writes recovery + hash) ----
  const { code, recovery } = await createSessionUI(page);
  expect(recovery).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);

  // ---- A second, independent client (a participant who knows only the code) ----
  const attacker = await context.newPage();
  await useEmulator(attacker);
  attacker.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await attacker.goto("/");
  await waitForAuth(attacker);

  const sPath = sessionPath(code);

  // a) CANNOT read the recovery code back — /recovery is .read:false.
  const readResult = await attacker.evaluate(async (p) => {
    try {
      const snap = await firebase.database().ref(p).once("value");
      return { ok: true, val: snap.val() };
    } catch (e) { return { ok: false, err: (e && (e.code || e.message)) || "DENIED" }; }
  }, "recovery/" + sPath);
  expect(readResult.ok, "reading /recovery must be denied").toBeFalsy();

  // Helper: attempt a write from the attacker tab and report ALLOWED / error.
  const tryWrite = (path, value) => attacker.evaluate(async ({ path, value }) => {
    try {
      await firebase.database().ref(path).set(value);
      return "ALLOWED";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { path, value });

  const now = Date.now();

  // b) _superadminReset with NO code → denied (validate requires code).
  const noCode = await tryWrite(sPath + "/_superadminReset",
    { requestedAt: now, by: "Mallory" });
  expect(noCode, "_superadminReset without a code must be denied").not.toBe("ALLOWED");
  expect(String(noCode)).toMatch(/PERMISSION_DENIED|denied/i);

  // c) _superadminReset with a WRONG code → denied (write predicate compares
  //    the code to the unreadable /recovery/.../code).
  const wrongCode = await tryWrite(sPath + "/_superadminReset",
    { requestedAt: now, by: "Mallory", code: "wrong-wrong-wrong" });
  expect(wrongCode, "_superadminReset with a wrong code must be denied").not.toBe("ALLOWED");
  expect(String(wrongCode)).toMatch(/PERMISSION_DENIED|denied/i);

  // d) Direct adminPasswordHash overwrite (no fresh reset flag) → denied.
  const directHash = await tryWrite(sPath + "/adminPasswordHash",
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  expect(directHash, "direct adminPasswordHash overwrite must be denied").not.toBe("ALLOWED");
  expect(String(directHash)).toMatch(/PERMISSION_DENIED|denied/i);

  // ---- POSITIVE: with the CORRECT recovery code, the chain succeeds ----
  // The reset flag is now bound to its initiator's uid (R3 recovery-race fix).
  const attackerUid = await attacker.evaluate(() => firebase.auth().currentUser.uid);

  // e) CORRECT code but a FORGED uid (!= the writer's own auth.uid) → denied.
  //    The reset write binds uid to its initiator (R3); you can't open a reset
  //    on someone else's behalf even if you know the code.
  const forgedUid = await tryWrite(sPath + "/_superadminReset",
    { requestedAt: Date.now(), by: "Mallory", code: recovery, uid: attackerUid + "-forged" });
  expect(forgedUid, "_superadminReset with a forged uid must be denied").not.toBe("ALLOWED");
  expect(String(forgedUid)).toMatch(/permission_denied|denied/i);

  const goodReset = await tryWrite(sPath + "/_superadminReset",
    { requestedAt: Date.now(), by: "Recovery Emu Fac", code: recovery, uid: attackerUid });
  expect(goodReset, "_superadminReset with the correct code must be ALLOWED: " + goodReset).toBe("ALLOWED");

  // RACE GUARD (R3): while that reset is fresh, a DIFFERENT uid must NOT be able
  // to overwrite the hash — the write is bound to the reset initiator's uid,
  // closing the recovery-race takeover. Use a fresh isolated context so the
  // racer signs in as a DISTINCT anonymous uid (context.newPage reuses the uid).
  const racerCtx = await browser.newContext();
  const racer = await racerCtx.newPage();
  await useEmulator(racer);
  await racer.goto("/");
  await waitForAuth(racer);
  const racerUid = await racer.evaluate(() => firebase.auth().currentUser.uid);
  expect(racerUid).not.toBe(attackerUid);
  const raceHash = await racer.evaluate(async (p) => {
    try { await firebase.database().ref(p).set("v2$100000$cccccccccccccccc"); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, sPath + "/adminPasswordHash");
  expect(raceHash, "a non-initiator uid must NOT write the hash during the reset window").not.toBe("ALLOWED");
  expect(String(raceHash)).toMatch(/permission_denied|denied/i);
  await racerCtx.close();

  // The reset INITIATOR (attacker tab) can complete the hash overwrite.
  // (The real-hash adminSecrets path carries the byte-identical uid-bound rule;
  // its race is covered structurally + by the adminSecrets smoke tests.)
  const goodHash = await tryWrite(sPath + "/adminPasswordHash",
    "v2$100000$abcdef0123456789");
  expect(goodHash, "adminPasswordHash overwrite by the reset initiator must be ALLOWED: " + goodHash).toBe("ALLOWED");

  await attacker.close();
});
