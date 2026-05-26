/* tests-e2e/emulator/roster-rules.spec.js
 *
 * #14 (security-critical) — FUNCTIONAL rules test against the REAL Firebase
 * emulator for the facilitator-only participant email roster.
 *
 * The threat: email is new PII and the session read model is "any member can
 * read the session tree", so email must NOT be peer-readable. It lives in a
 * top-level /rosters subtree whose read is locked to the session CREATOR
 * (creatorUid), with each participant able to write ONLY their own entry.
 *
 *   SETUP    — a facilitator creates a session through the UI; createSession
 *              records creatorUid = the creator's auth uid (before the password
 *              hash, settable only to one's own uid).
 *
 *   NEGATIVE — a second, independent client (a participant who knows only the
 *              code) :
 *                a) CANNOT read the whole roster (creator-only)
 *                b) CANNOT write ANOTHER participant's roster entry
 *
 *   POSITIVE — that same participant CAN write their OWN roster entry, and the
 *              CREATOR can read the whole roster (and sees the entry).
 *
 * The creator-only read + own-entry-only write is the boundary that keeps one
 * participant's email invisible to every other participant.
 */

// @ts-check
const { test, expect, useEmulator } = require("./fixtures.js");

async function createSessionUI(page) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Roster Emu Fac");
  await page.locator("#splash-create-label").fill("roster-rules");
  await page.locator("#splash-create-pass").fill("emu-init-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

async function waitForAuth(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
}

const uidOf = (page) => page.evaluate(() => firebase.auth().currentUser.uid);
function sessionPath(code) { return "sessions/" + code.toLowerCase(); }
function rosterPath(code) { return "rosters/sessions/" + code.toLowerCase(); }

const tryWrite = (page, path, value) => page.evaluate(async ({ path, value }) => {
  try { await firebase.database().ref(path).set(value); return "ALLOWED"; }
  catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
}, { path, value });

const tryRead = (page, path) => page.evaluate(async (p) => {
  try { const s = await firebase.database().ref(p).once("value"); return { ok: true, val: s.val() }; }
  catch (e) { return { ok: false, err: (e && (e.code || e.message)) || "DENIED" }; }
}, path);

test("rules: only the creator reads the roster; a participant writes only their own email", async ({ page, context }) => {
  // ---- SETUP: facilitator creates the session (records creatorUid) ----
  const code = await createSessionUI(page);
  await waitForAuth(page);
  const creatorUid = await uidOf(page);

  // The creatorUid must have landed at the session path.
  const cu = await tryRead(page, sessionPath(code) + "/creatorUid");
  expect(cu.ok, "creatorUid should be readable").toBeTruthy();
  expect(cu.val, "creatorUid must equal the creator's uid").toBe(creatorUid);

  // ---- A second, independent client (a participant) ----
  // A FRESH browser context, not context.newPage(): Firebase Auth persists the
  // anonymous user per-context, so a same-context page would reuse the
  // creator's uid. A new context gets its own anonymous uid — a real "other
  // participant".
  const participantCtx = await context.browser().newContext();
  const participant = await participantCtx.newPage();
  await useEmulator(participant);
  participant.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await participant.goto("/");
  await waitForAuth(participant);
  const pUid = await uidOf(participant);
  expect(pUid).not.toBe(creatorUid);

  // a) participant CANNOT read the whole roster (creator-only).
  const peerRead = await tryRead(participant, rosterPath(code));
  expect(peerRead.ok, "a participant must NOT be able to read the roster").toBeFalsy();

  // b) participant CANNOT write someone else's entry (the creator's slot).
  const writeOther = await tryWrite(participant, rosterPath(code) + "/" + creatorUid,
    { email: "evil@example.com", at: Date.now() });
  expect(writeOther, "writing another participant's roster entry must be denied").not.toBe("ALLOWED");
  expect(String(writeOther)).toMatch(/PERMISSION_DENIED|denied/i);

  // POSITIVE: participant CAN write their OWN entry.
  const writeOwn = await tryWrite(participant, rosterPath(code) + "/" + pUid,
    { email: "participant@example.com", name: "Pat", university: "Caen", at: Date.now() });
  expect(writeOwn, "writing one's own roster entry must be ALLOWED: " + writeOwn).toBe("ALLOWED");

  // POSITIVE: the CREATOR can read the whole roster and sees the entry.
  const creatorRead = await tryRead(page, rosterPath(code));
  expect(creatorRead.ok, "the creator must be able to read the roster").toBeTruthy();
  expect(creatorRead.val && creatorRead.val[pUid] && creatorRead.val[pUid].email)
    .toBe("participant@example.com");

  await participant.close();
  await participantCtx.close();
});
