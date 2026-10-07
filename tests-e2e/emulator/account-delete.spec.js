/* tests-e2e/emulator/account-delete.spec.js
 *
 * Deleting an account, through the real button and the real rules.
 *
 * THE DEFECT: accountDelete() removed `users/<uid>` and then the sign-in
 * account. It left `scenarios/<uid>` — readable and writable ONLY by that uid,
 * so once the account was gone nobody could ever read or delete it again — and
 * every `sharedScenarios/<uid>_<id>` the user had published, still on offer to
 * other facilitators under the author's display name with no owner left to
 * withdraw it.
 *
 * Why this needs the emulator and not just a unit test: the fix removes three
 * differently-ruled trees in ONE multi-path update, which the rules accept or
 * refuse as a whole. Whether the engine really lets an owner delete all three
 * at once, really refuses the whole update when one path in it is refused, and
 * really refuses the paths this test says it refuses, are properties of
 * database.rules.json — which the LOCAL suite never loads and a fake database
 * cannot model.
 *
 * The handler is deleteMyAccount() in the LAZY data-rights.js; the button's
 * shim in script.js loads it on the click. So this is also the only test that
 * runs that load in a real browser against a real account.
 *
 * Conventions (CLAUDE.md): every "gone" is asserted on the DATABASE with
 * dbReadAsOwner(), and only after the same read showed the node PRESENT —
 * a node that was never written is also "gone". Every denial is paired with an
 * allow. The second user is a second CONTEXT, and the two uids are asserted to
 * differ.
 */

// @ts-check
const { test, expect, useEmulator, PROJECT, dbReadAsOwner } = require("./fixtures.js");

const AUTH_API = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

/* Wait for the app's own sign-in (anonymous at start-up). */
async function waitForUid(page) {
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, null, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

/* A write through the REAL rules: "ALLOWED" or the denial's code/message.
   `value === null` is a delete. */
function tryWrite(page, path, value) {
  return page.evaluate(async ({ p, v }) => {
    try { await firebase.database().ref(p).set(v); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { p: path, v: value });
}

/* A denial has to be the RULES saying no. `not.toBe("ALLOWED")` would also be
   satisfied by a typo in the path, a dropped socket or a thrown TypeError. */
function expectDenied(result, why) {
  expect(String(result), why).toMatch(/permission[_ ]denied/i);
}

/* A read through the REAL rules. */
function tryRead(page, path) {
  return page.evaluate(async (p) => {
    try { await firebase.database().ref(p).once("value"); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, path);
}

/* Does the Auth emulator still hold this account? Asked of the emulator
   directly — not of the SDK in the page, whose answer after a deletion is
   exactly what is under test. */
async function authAccountExists(uid) {
  const res = await fetch(AUTH_API + "/projects/" + PROJECT + "/accounts:lookup", {
    method: "POST",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [uid] })
  });
  if (!res.ok) throw new Error("auth emulator lookup -> HTTP " + res.status);
  const users = (await res.json()).users || [];
  return users.some(u => u.localId === uid);
}

const sharedEntry = (ownerUid, scenarioId) => ({
  ownerUid, scenarioId,
  meta: { name: "Account-delete fixture", updatedAt: Date.now() },
  bodyJson: "{}"
});

test("account deletion removes the profile, the authored scenarios and their published copies", async ({ page, browser }) => {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4);

  // The native confirm. Kept, because what it PROMISES is part of the fix.
  const confirms = [];
  page.on("dialog", d => { confirms.push(d.message()); d.accept().catch(() => {}); });

  // ---- A: a real (non-anonymous) account, created on the Auth emulator ----
  await page.goto("/");
  const anonUid = await waitForUid(page);
  /* Throwaway credentials for an account that exists only in this emulator
     run. A is a NEW user rather than the anonymous one upgraded, so the app's
     own auth-state handler runs and `currentUser` is the signed-in account. */
  const email = "acct-del-" + stamp + "@example.test";
  const password = "Emu-" + stamp + "-Aa1!";
  await page.evaluate(({ email, password }) =>
    firebase.auth().createUserWithEmailAndPassword(email, password), { email, password });
  await page.waitForFunction(() => {
    const u = firebase.auth().currentUser;
    return !!u && !u.isAnonymous && currentUser && currentUser.uid === u.uid;
  }, null, { timeout: 20_000 });
  const uidA = await page.evaluate(() => firebase.auth().currentUser.uid);
  expect(uidA, "sign-up must produce a new account, not reuse the anonymous one").not.toBe(anonUid);
  expect(await authAccountExists(uidA), "positive control: the account exists before deletion").toBe(true);

  // ---- A's data, written by the app's own functions through the rules ----
  /* Wait for the profile-setup view first. It is shown from the .then of the
     app's own loadProfile(), which also assigns `currentProfile` — so writing a
     profile before it settles races that assignment, and the published copy
     below would then carry an empty ownerName. */
  await expect(page.locator("#splash-view-profile-setup")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => saveProfile({
    name: "Emu Author", university: "Caen", role: "facilitator", year: null, english: null
  }));
  expect(await tryWrite(page, `users/${uidA}/history/EMU-DEL`, { code: "EMU-DEL", joinedAt: Date.now() }))
    .toBe("ALLOWED");
  await page.evaluate(() => window.canamedScenarios.save("kept-private", { name: "Private one" }, false));
  await page.evaluate(() => window.canamedScenarios.save("published", { name: "Published one" }, true));
  /* A published copy whose private original is gone — the state a failed
     half of deleteScenario() leaves behind (its shared delete is best-effort).
     Walking scenarios/<uid> to find what to unpublish would miss this one. */
  const orphan = `sharedScenarios/${uidA}_orphaned`;
  expect(await tryWrite(page, orphan, sharedEntry(uidA, "orphaned"))).toBe("ALLOWED");

  // ---- B: a different person, in a different CONTEXT ----
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await useEmulator(pageB);
  await pageB.goto("/");
  const uidB = await waitForUid(pageB);
  expect(uidB, "the second context must be a different user").not.toBe(uidA);

  const theirs = `sharedScenarios/${uidB}_theirs`;
  expect(await tryWrite(pageB, theirs, sharedEntry(uidB, "theirs"))).toBe("ALLOWED");
  expect(await tryWrite(pageB, `scenarios/${uidB}/theirs`,
    { meta: { id: "theirs", name: "B's own", updatedAt: Date.now() }, bodyJson: "{}" })).toBe("ALLOWED");
  /* B parks an entry INSIDE A's key range. The rules allow it: creating a
     shared entry needs only `ownerUid == auth.uid`, whatever the key. A cannot
     delete it, and a multi-path update is refused whole if one path is — so an
     unfiltered key-range delete would let any stranger make A's account
     undeletable. */
  const squat = `sharedScenarios/${uidA}_squat`;
  expect(await tryWrite(pageB, squat, sharedEntry(uidB, "squat"))).toBe("ALLOWED");

  // Reports in both directions — the part deletion deliberately leaves.
  const reportByA = `reports/scenarios/${uidB}_theirs/${uidA}`;
  const reportOnA = `reports/scenarios/${uidA}_published/${uidB}`;
  await page.evaluate((id) => reportSharedScenario(id, "fixture report"), `${uidB}_theirs`);
  await pageB.evaluate((id) => reportSharedScenario(id, "fixture report"), `${uidA}_published`);

  // ---- BEFORE: everything is really there (or "gone" below means nothing) ----
  expect(await page.evaluate(() => localStorage.getItem("canamed_stable_id")),
    "positive control: a signed-in account's uid IS this browser's stableId").toBe(uidA);
  expect((await dbReadAsOwner(`users/${uidA}/profile`)).name).toBe("Emu Author");
  expect(await dbReadAsOwner(`users/${uidA}/history/EMU-DEL/code`)).toBe("EMU-DEL");
  expect(Object.keys(await dbReadAsOwner(`scenarios/${uidA}`)).sort())
    .toEqual(["kept-private", "published"]);
  expect((await dbReadAsOwner(`sharedScenarios/${uidA}_published`)).ownerName).toBe("Emu Author");
  expect((await dbReadAsOwner(orphan)).ownerUid).toBe(uidA);
  expect((await dbReadAsOwner(squat)).ownerUid).toBe(uidB);
  expect((await dbReadAsOwner(reportByA)).reason).toBe("fixture report");
  expect((await dbReadAsOwner(reportOnA)).reason).toBe("fixture report");

  // ---- The rules this deletion depends on, each denial with its allow ----
  // Nobody but the owner can read or delete a private scenario tree — which is
  // why it must go BEFORE the account does. (Allow leg: A's own deletion below.)
  expectDenied(await tryRead(pageB, `scenarios/${uidA}`),
    "another user must not be able to read A's private scenarios");
  expect(await tryRead(page, `scenarios/${uidA}`),
    "allow leg: the owner reads the same path").toBe("ALLOWED");
  expectDenied(await tryWrite(pageB, `scenarios/${uidA}`, null),
    "another user must not be able to delete A's private scenarios");
  // A cannot withdraw someone else's published scenario... (allow leg: B does, at the end)
  expectDenied(await tryWrite(page, theirs, null),
    "A must not be able to unpublish B's scenario");
  // ...nor the entry B parked in A's key range.
  expectDenied(await tryWrite(page, squat, null),
    "A must not be able to delete an entry B owns, even under A's key prefix");
  // A report is write-once: its author cannot retract it. (Allow leg: A wrote
  // it above, to this same path, when it did not yet exist.)
  expectDenied(await tryWrite(page, reportByA, null),
    "a report must not be removable by the client that filed it");
  expect((await dbReadAsOwner(reportByA)).reason, "the refused delete changed nothing")
    .toBe("fixture report");

  /* THE PROPERTY THE WHOLE DESIGN RESTS ON: a multi-path update is refused
     WHOLE when one of its paths is. A's own profile and scenarios are deletable
     by A (the real deletion below is the allow leg, over the same paths), yet
     adding B's parked entry to the same update must sink all of it. Otherwise
     a refusal could leave an account half-deleted, and the handler's "nothing
     was removed" would be a guess. */
  const mixed = await page.evaluate(async ({ uid, squatPath }) => {
    const removals = {};
    removals[squatPath] = null;
    removals["scenarios/" + uid] = null;
    removals["users/" + uid] = null;
    try { await firebase.database().ref().update(removals); return "ALLOWED"; }
    catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, { uid: uidA, squatPath: squat });
  expectDenied(mixed, "an update containing one undeletable path must be refused");
  expect((await dbReadAsOwner(`users/${uidA}/profile`)).name,
    "...and must not have removed the paths A COULD delete").toBe("Emu Author");
  expect(Object.keys(await dbReadAsOwner(`scenarios/${uidA}`)).sort())
    .toEqual(["kept-private", "published"]);

  // ---- DELETE: the real button, the real handler ----
  expect(await page.evaluate(() => typeof window.deleteMyAccount),
    "the deletion code is lazy: it must not be on the page before the click").toBe("undefined");
  /* Opened by the app's own function rather than by clicking #user-chip: the
     chip sits in the page header, which `body.locked` hides until a session
     code has been entered, so on the front page there is nothing to click.
     (That the dialog is reachable ONLY from inside a session is a limitation
     of the product, recorded in DPA Annex VI G8/G12 — not something this test
     should paper over by joining a session it does not otherwise need.) */
  await expect(page.locator("#user-chip")).toBeHidden();
  await page.evaluate(() => openAccountDialog());
  await expect(page.locator("#account-dialog")).toBeVisible();
  /* The dialog had not been able to open since #264 (an undeclared variable
     threw before dialogShow()), which also hid the one in-product route a
     signed-in participant has to withdraw from a session after it ends: the
     button on each row of this history list. Asserted here because nothing
     else opens this dialog in a real browser. */
  await expect(page.locator("#account-history .account-history-code")).toHaveText("EMU-DEL");
  await expect(page.locator("#account-history .account-history-withdraw")).toHaveCount(1);
  await page.locator("#account-delete-btn").click();

  /* Settled when the deleted account is no longer the page's user — the app
     signs in anonymously again as soon as the user goes null, so "a different
     uid" is the end state, not "no user" — OR when the handler reported a
     failure. Waiting on the uid alone turns a refused deletion into a bare
     30 s timeout that says nothing about why. */
  await page.waitForFunction((gone) => {
    const u = firebase.auth().currentUser;
    const hint = document.getElementById("account-action-hint");
    return (!!u && u.uid !== gone) || !!(hint && hint.classList.contains("err"));
  }, uidA, { timeout: 30_000 });
  /* The class, not the text: the handler shows a progress line while it runs,
     so "any text" would settle this wait before anything had happened. */
  expect(await page.evaluate(() =>
    document.getElementById("account-action-hint").classList.contains("err")),
    "the deletion must not report a failure").toBe(false);
  expect(await page.evaluate(() => typeof window.deleteMyAccount),
    "the click loaded the chunk").toBe("function");

  // ---- AFTER: the database first ----
  expect(await dbReadAsOwner(`users/${uidA}`), "profile + history").toBeNull();
  expect(await dbReadAsOwner(`scenarios/${uidA}`), "the private scenarios").toBeNull();
  expect(await dbReadAsOwner(`sharedScenarios/${uidA}_published`), "the published copy").toBeNull();
  expect(await dbReadAsOwner(orphan), "a published copy with no private original").toBeNull();

  // It removed A's data and nothing else.
  expect((await dbReadAsOwner(squat)).ownerUid, "an entry B owns survives, whatever its key").toBe(uidB);
  expect((await dbReadAsOwner(theirs)).ownerUid).toBe(uidB);
  expect(Object.keys(await dbReadAsOwner(`scenarios/${uidB}`))).toEqual(["theirs"]);

  /* Deliberately LEFT, and asserted so the contract is recorded rather than
     implied: reports are write-once and unreadable, so no client can remove
     one — the reporter's uid stays under the reported scenario, and the
     deleted author's uid stays in the key of reports filed against them. An
     operator removes these on request (DPA Annex VI, G8). */
  expect((await dbReadAsOwner(reportByA)).reason, "a report A filed is not removed").toBe("fixture report");
  expect((await dbReadAsOwner(reportOnA)).reason, "a report about A's scenario is not removed").toBe("fixture report");

  // The sign-in account went too — and only after the data did.
  expect(await authAccountExists(uidA), "the Auth account must be deleted").toBe(false);

  // ---- then the page ----
  await expect(page.locator("#account-dialog")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("canamed_stable_id")),
    "the deleted account's uid must not linger as this browser's stableId").not.toBe(uidA);
  expect(confirms.length, "exactly one confirmation was asked").toBe(1);
  expect(confirms[0], "the confirmation must say the scenarios go too").toMatch(/scenario/i);
  expect(confirms[0], "and that published copies are withdrawn").toMatch(/shared|publish/i);
  expect(confirms[0], "it must not claim session records are unlinked from the person")
    .not.toMatch(/no longer linked/i);

  // Allow leg for "A cannot unpublish B's scenario": B can, same path, same payload.
  expect(await tryWrite(pageB, theirs, null)).toBe("ALLOWED");
  expect(await dbReadAsOwner(theirs)).toBeNull();
  await ctxB.close();
});
