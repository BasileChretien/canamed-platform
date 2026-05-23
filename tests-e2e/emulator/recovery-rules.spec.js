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

test("rules: a non-creator cannot reset the password without the recovery code, but CAN with it", async ({ page, context }) => {
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
  const goodReset = await tryWrite(sPath + "/_superadminReset",
    { requestedAt: Date.now(), by: "Recovery Emu Fac", code: recovery });
  expect(goodReset, "_superadminReset with the correct code must be ALLOWED: " + goodReset).toBe("ALLOWED");

  // With a fresh, valid reset flag in place, the hash overwrite is allowed.
  const goodHash = await tryWrite(sPath + "/adminPasswordHash",
    "v2$100000$abcdef0123456789");
  expect(goodHash, "adminPasswordHash overwrite with a fresh valid reset must be ALLOWED: " + goodHash).toBe("ALLOWED");

  await attacker.close();
});
