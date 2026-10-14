/* tests-e2e/emulator/call-for-help-ack.spec.js
 *
 * A facilitator who opens a room acknowledges the room's call for help:
 * openRoomAsAdmin() re-sends the standing call as { by, at, ack: true }, the
 * dashboard's alert clears, and the room's button reads "A facilitator is
 * coming ✓ (tap to call again)".
 *
 * NONE OF THAT HAPPENED until 2026-10-14. Measured on this emulator, with the
 * rules as they were (the probe is not in the repository; the table is in the
 * pull request that added this file):
 *
 *   - the acknowledgement was PERMISSION_DENIED — for the session's creator and
 *     for a co-facilitator who had proved the password; for a call a few
 *     seconds old and for one more than a minute old; written whole, as the
 *     client does, and written as the `ack` child alone. The rule allows one
 *     call at a time (none standing, the last one acknowledged, a cancel, or a
 *     call thirty seconds newer) and an acknowledgement is none of those; past
 *     a minute the validator refused its date as well;
 *   - the client said so only in the console ("Acknowledging call failed");
 *     the room kept "Facilitator called ✓ (tap to cancel)"; the dashboard kept
 *     the alert until "Resolve call" (a delete, which worked) was pressed.
 *
 * THE RULE NOW, both trees: the one-call-at-a-time clause has one more way
 * through — the facilitator (creator, or a proof of the current password),
 * writing ack == true onto the call that stands, with its `at` and `by`
 * unchanged and its `msg` unchanged or removed; and the validator takes a date
 * older than a minute on any record that is acknowledged and keeps the call's
 * `at` and `by`. That is the acknowledgement's shape, but the validator does
 * not ask who writes it: on an acknowledged call older than a minute, anyone
 * the `.write` admits (a room claim anywhere in the session) can rewrite `msg`
 * and keep the date — before, only by re-dating the call. Recorded in review,
 * not pinned here. Both only ADD a way through: nothing accepted before is
 * refused now. The rule accepts the payload the deployed client already
 * sends, so no browser needs a new shell for it.
 *
 * NEW TO STUDENTS. With the acknowledgement landing, a room sees a state no
 * production session has shown before — "A facilitator is coming ✓ (tap to
 * call again)" — and tapping it raises a fresh call at once (the rule lets a
 * call follow an acknowledged one; the client keeps its own thirty seconds).
 * The second test drives that through the product.
 *
 * ALSO HERE: "Reset this room's case" is gone from the client (decided
 * 2026-10-14). It sent a remove() of the whole `revealed` list, which no rule
 * grants — refused, silently. The first test pins that refusal with its allow
 * leg, so that whoever brings a reset back meets the reason it did nothing.
 *
 * ── A denial here is never left to stand alone ──────────────────────────
 * Every refused write has its ALLOW: the same payload, on the same path, by an
 * identity entitled to it.
 *
 * ── A second user is a second CONTEXT ───────────────────────────────────
 * Each identity is its own browser context, and the uids are asserted distinct.
 *
 * ── The DB value first, then the DOM ────────────────────────────────────
 * dbReadAsOwner() observes; it never decides a verdict.
 */

// @ts-check
const { test, expect, useEmulator, claimRoom, dbReadAsOwner } = require("./fixtures.js");

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

/* One write through the rules. `value === undefined` is a delete. */
function tryWrite(page, path, value) {
  return page.evaluate(async ([p, v, del]) => {
    try {
      const ref = firebase.database().ref(p);
      if (del) await ref.remove(); else await ref.set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, [path, value === undefined ? null : value, value === undefined]);
}
const tryDelete = (page, path) => tryWrite(page, path, undefined);

/* A denial must be a PERMISSION denial, not a transport or config failure. */
function expectDenied(result, why) {
  expect(result, why).not.toBe("ALLOWED");
  expect(String(result), why + " (and denied for PERMISSION, not by a transport error)")
    .toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
}

/* Its own browser context, hence its own anonymous user. */
async function someone(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  const uid = await signedInUid(page);
  return { ctx, page, uid };
}

const uniq = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const HEX_A = "a".repeat(64);          // the readable marker
const HEX_C = "c".repeat(64);          // the real hash, where no client can read it

const TREES = [
  ["sessions/", (id) => "sessions/" + id, (id) => "adminSecrets/" + id],
  ["orgs/<slug>/sessions/", (id) => "orgs/e2e-org/sessions/" + id, (id) => "adminSecrets/orgs/e2e-org/" + id]
];

for (const [tree, baseOf, secretsOf] of TREES) {
  test(`rules: ${tree} — the facilitator acknowledges a call for help, however old; nobody else can; and the acknowledgement is all it may do`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = uniq("ack-");
    const base = baseOf(id);
    const room = `${base}/rooms/Room 1`;
    const call = `${room}/callForHelp`;

    /* The facilitator: creates the session and gives it a password. */
    const creatorUid = await signedInUid(page);
    expect(await tryWrite(page, `${base}/creatorUid`, creatorUid)).toBe("ALLOWED");
    expect(await tryWrite(page, `${base}/adminPasswordHash`, HEX_A)).toBe("ALLOWED");
    expect(await tryWrite(page, `${secretsOf(id)}/hash`, HEX_C)).toBe("ALLOWED");

    const member = await someone(browser);        // joins Room 1, which calls
    const neighbour = await someone(browser);     // joins Room 2
    const stranger = await someone(browser);      // knows the code, joins nothing
    const cofac = await someone(browser);         // proves the password; not the creator
    const uids = [creatorUid, member.uid, neighbour.uid, stranger.uid, cofac.uid];
    expect(new Set(uids).size, "five DISTINCT users, or every verdict below is about somebody else").toBe(5);

    await claimRoom(member.page, base, "Room 1", member.uid);
    await claimRoom(neighbour.page, base, "Room 2", neighbour.uid);
    expect(await tryWrite(cofac.page, `${secretsOf(id)}/proof/${cofac.uid}`, HEX_C),
      "the co-facilitator proves the password").toBe("ALLOWED");
    for (const [who, uid] of [["the creator", creatorUid], ["the co-facilitator", cofac.uid]]) {
      expect(await dbReadAsOwner(`${base}/roomOf/${uid}`),
        `${who} holds no room claim: an allow below can only be the facilitator's`).toBeNull();
    }

    /* ── 1. a call more than a minute old — what a facilitator walking over meets ──
       Raised by the room's member with a date 52 s back (the validator takes
       up to 60 s), then left to age past the minute. */
    const OLD = { by: "Room One", at: Date.now() - 52_000, msg: "we are ready to move on" };
    expect(await tryWrite(member.page, call, OLD), "the room raises its call").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(OLD);
    await page.waitForTimeout(Math.max(0, OLD.at + 63_000 - Date.now()));
    expect(Date.now() - OLD.at, "the call is now more than a minute old").toBeGreaterThan(61_000);

    /* Exactly what openRoomAsAdmin() sends: the call as read, ack: true, no msg. */
    const ACK_OLD = { by: OLD.by, at: OLD.at, ack: true };
    expectDenied(await tryWrite(stranger.page, call, ACK_OLD), "acknowledged by a visitor who joined nothing");
    expectDenied(await tryWrite(neighbour.page, call, ACK_OLD),
      "acknowledged by a participant of another room — who may cancel this call (PR #457), not answer it");
    expectDenied(await tryWrite(member.page, call, ACK_OLD), "acknowledged by the room that called");
    expect(await dbReadAsOwner(call), "none of the three landed").toEqual(OLD);
    /* THE ALLOW LEG: the same payload, the same path, the creator. */
    expect(await tryWrite(page, call, ACK_OLD), "acknowledged by the session's creator").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(ACK_OLD);

    /* ── 2. "tap to call again": a call may follow an acknowledged one at once ── */
    const AGAIN = { by: "Room One", at: Date.now() };
    expect(await tryWrite(member.page, call, AGAIN), "the room calls again after the acknowledgement").toBe("ALLOWED");
    expect(await dbReadAsOwner(call), "a fresh call, not acknowledged").toEqual(AGAIN);

    /* ── 3. the `ack` child alone — what an update() would send ─────────────── */
    expectDenied(await tryWrite(stranger.page, `${call}/ack`, true), "ack child, by the stranger");
    expectDenied(await tryWrite(member.page, `${call}/ack`, true), "ack child, by the room that called");
    expect(await dbReadAsOwner(call)).toEqual(AGAIN);
    expect(await tryWrite(cofac.page, `${call}/ack`, true),
      "ack child, by a co-facilitator whose only title is a proof no client can read").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(Object.assign({}, AGAIN, { ack: true }));

    /* ── 4. the acknowledgement and nothing else ──────────────────────────────
       A fresh call (a few seconds old: the thirty-second clause cannot let any
       of these through), and the facilitator trying to change it while
       acknowledging. */
    expect(await tryDelete(member.page, call)).toBe("ALLOWED");
    const FRESH = { by: "Room One", at: Date.now(), msg: "stuck on the examination" };
    expect(await tryWrite(member.page, call, FRESH)).toBe("ALLOWED");
    expectDenied(await tryWrite(page, call, { by: "Somebody Else", at: FRESH.at, ack: true }),
      "the facilitator re-signs the call while acknowledging it");
    expectDenied(await tryWrite(page, call, { by: FRESH.by, at: FRESH.at, ack: true, msg: "a different message" }),
      "the facilitator rewrites its message while acknowledging it");
    expectDenied(await tryWrite(cofac.page, call, { by: FRESH.by, at: FRESH.at, ack: false }),
      "a write that is not an acknowledgement");
    expect(await dbReadAsOwner(call), "the call is as the room raised it").toEqual(FRESH);
    /* The allow legs: the same identities, the call as it stands, ack: true —
       the message kept, here, which the branch allows as well as dropping it. */
    const ACK_FRESH = Object.assign({}, FRESH, { ack: true });
    expect(await tryWrite(cofac.page, call, ACK_FRESH), "a co-facilitator acknowledges, message kept").toBe("ALLOWED");
    expect(await dbReadAsOwner(call)).toEqual(ACK_FRESH);
    expect(await tryWrite(page, call, ACK_FRESH), "and the creator, on a call already acknowledged").toBe("ALLOWED");

    /* ── 5. OPEN, as before this change — pinned, not implied closed ─────────
       A participant can still make a call read as acknowledged: by RE-DATING
       it, once thirty seconds have passed (the clause that lets a new call
       replace an old one does not look at `ack`). And since PR #457 a
       participant of ANOTHER room can do it too — as they can cancel the call
       outright. This change adds no participant path; it does not close this
       one either. If these two go red, the clause was tightened: update the
       data-model note and this comment. */
    expect(await tryDelete(member.page, call)).toBe("ALLOWED");
    const AGED = { by: "Room One", at: Date.now() - 35_000 };
    expect(await tryWrite(member.page, call, AGED)).toBe("ALLOWED");
    expect(await tryWrite(neighbour.page, call, { by: "Room One", at: Date.now(), ack: true }),
      "OPEN: a participant of another room marks the call acknowledged by re-dating it").toBe("ALLOWED");
    expect((await dbReadAsOwner(call)).ack).toBe(true);

    /* ── 6. a whole list of findings: no rule grants that delete ──────────────
       What "Reset this room's case" sent (refRevealed.remove()), and why it
       did nothing. The control is gone; this is here so that whoever brings it
       back meets the reason. */
    const list = `${room}/sections/1/revealed`;
    expect(await tryWrite(member.page, `${list}/history:0`, { by: "Room One", at: Date.now() })).toBe("ALLOWED");
    expectDenied(await tryDelete(page, list), "the creator removes the room's whole list of findings");
    expectDenied(await tryDelete(cofac.page, list), "a co-facilitator removes it");
    expectDenied(await tryDelete(member.page, list), "the room's own member removes it");
    expect(Object.keys((await dbReadAsOwner(list)) || {}), "the finding is still there").toEqual(["history:0"]);
    /* The allow leg: the same facilitator, a delete in the same list — one item. */
    expect(await tryDelete(page, `${list}/history:0`), "the creator takes back one finding").toBe("ALLOWED");
    expect(await dbReadAsOwner(list)).toBeNull();

    /* ── 7. a closed session takes no acknowledgement ──────────────────────── */
    expect(await tryDelete(member.page, call)).toBe("ALLOWED");
    const LAST = { by: "Room One", at: Date.now() };
    expect(await tryWrite(member.page, call, LAST)).toBe("ALLOWED");
    expect(await tryWrite(page, `${base}/closed`, { by: "Emu Fac", at: Date.now() }), "the creator closes the session").toBe("ALLOWED");
    expectDenied(await tryWrite(page, call, Object.assign({}, LAST, { ack: true })),
      "acknowledged by the creator after the close (the allow leg is section 1: same writer, session open)");

    for (const u of [member, neighbour, stranger, cofac]) await u.ctx.close();
  });
}

/* ── the product itself ─────────────────────────────────────────────────── */

// Auto-accept the in-page confirm modal that Start opens.
async function installModalAutoAccept(page) {
  await page.addInitScript(() => {
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg) new MutationObserver(tryAccept)
        .observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });
}
async function joinAsStudent(browser, code, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  await installModalAutoAccept(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  await page.locator("#name-input").fill(name);
  const uni = await page.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await page.locator("#uni-input").selectOption(uni);
  await page.locator("#consent-workshop").check();
  await expect(page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#join-btn").click();
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 15_000 });
  return { ctx, page, name, uid: await page.evaluate(() => firebase.auth().currentUser.uid) };
}
const callButton = (page) => page.locator("#call-prof-btn");
const callingRows = (page) => page.evaluate(() => document.querySelectorAll("#dashboard .calling").length);

test("the real client: a facilitator who opens a room answers its call — a minute old or more — and the room sees it, and can call again", async ({ page, browser }) => {
  test.setTimeout(300_000);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("call-ack");
  await page.locator("#splash-create-pass").fill("emu-ack-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  const facUid = await page.evaluate(() => firebase.auth().currentUser.uid);

  const ana = await joinAsStudent(browser, code, "Ana");
  const ben = await joinAsStudent(browser, code, "Ben");
  expect(new Set([facUid, ana.uid, ben.uid]).size, "three DISTINCT users").toBe(3);
  await expect(page.locator("#prestart-count")).toHaveText("2", { timeout: 20_000 });
  await page.locator("#roomcount-input").selectOption("1");
  await page.locator("#start-session-btn").click();
  for (const s of [ana, ben]) await expect(s.page.locator("#app")).toBeVisible({ timeout: 25_000 });
  const room = await ana.page.evaluate(() => myRoom);
  expect(await ben.page.evaluate(() => myRoom), "one room, both in it").toBe(room);
  const call = `${base}/rooms/${room}/callForHelp`;
  /* The room claims, issued on entering the room. A call needs one (#457), and
     the button is on screen before the claim has landed: a first run of this
     test that clicked at once was refused, the button going back to "Call a
     facilitator" with nothing written. Wait for them, as #457's specs do. */
  for (const s of [ana, ben]) {
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${s.uid}`)) || {}).room,
      { message: `${s.name}: the room claim`, timeout: 15_000 }).toBe(room);
  }

  /* ── the room calls ──────────────────────────────────────────────────────── */
  await callButton(ana.page).click();
  await expect.poll(async () => ((await dbReadAsOwner(call)) || {}).by, { timeout: 15_000 }).toBe("Ana");
  const raised = await dbReadAsOwner(call);
  expect(raised.ack, "a call, not yet answered").toBeUndefined();
  await expect(callButton(ana.page)).toHaveText(/tap to cancel/);
  await expect(callButton(ben.page)).toHaveText(/tap to cancel/);
  /* The dashboard, read BEFORE the facilitator opens a room (a dashboard used
     to stop updating once its facilitator had been into a room and back;
     fixed in #459, and this test does not depend on either). */
  await expect.poll(() => callingRows(page), { message: "the dashboard shows the room calling", timeout: 15_000 })
    .toBeGreaterThan(0);

  /* ── the facilitator arrives after more than a minute, the usual case ──── */
  await page.waitForTimeout(Math.max(0, raised.at + 63_000 - Date.now()));
  expect(await dbReadAsOwner(call), "nothing touched the call while it waited").toEqual(raised);
  await page.evaluate((r) => openRoomAsAdmin(r), room);
  /* The DB first: the acknowledgement landed, on the call the room raised. */
  await expect.poll(async () => ((await dbReadAsOwner(call)) || {}).ack,
    { message: "openRoomAsAdmin()'s acknowledgement must reach the database", timeout: 15_000 }).toBe(true);
  expect(await dbReadAsOwner(call)).toEqual({ by: raised.by, at: raised.at, ack: true });
  /* Then the DOM: the room sees a facilitator coming… */
  await expect(callButton(ana.page)).toHaveText("A facilitator is coming ✓ (tap to call again)", { timeout: 15_000 });
  await expect(callButton(ben.page)).toHaveText("A facilitator is coming ✓ (tap to call again)", { timeout: 15_000 });
  /* …and the facilitator, inside the room, has its "Resolve call" and no
     reset control. */
  await expect(callButton(page)).toHaveText(/Resolve call/, { timeout: 15_000 });
  await expect(page.locator("#reset-btn"), "\"Reset this room's case\" is gone").toHaveCount(0);
  expect(consoleErrors.filter(t => /Acknowledging call failed/.test(t)), "no refused acknowledgement").toEqual([]);

  /* ── "tap to call again" ─────────────────────────────────────────────────
     Never reachable in production before: the acknowledgement never landed. */
  await callButton(ben.page).click();
  await expect.poll(async () => ((await dbReadAsOwner(call)) || {}).by,
    { message: "a fresh call, from the acknowledged state", timeout: 15_000 }).toBe("Ben");
  const again = await dbReadAsOwner(call);
  expect(again.ack, "and not acknowledged").toBeUndefined();
  expect(again.at).toBeGreaterThan(raised.at);
  await expect(callButton(ana.page)).toHaveText(/tap to cancel/, { timeout: 15_000 });

  for (const s of [ana, ben]) await s.ctx.close();
});
