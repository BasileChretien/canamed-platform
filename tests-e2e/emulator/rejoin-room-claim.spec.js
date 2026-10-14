/* tests-e2e/emulator/rejoin-room-claim.spec.js
 *
 * A participant holds ONE room per session: `roomOf/<uid>`, written once, on
 * the first room entry, by an anonymous account the browser keeps (Auth
 * persistence is LOCAL). Every room write the rules gate on a room is refused
 * in any other room. Until this change the client could show a participant
 * such a room, and nothing told them — measured on this emulator on
 * 2026-10-08 and again on 2026-10-14, with the real client in every seat:
 *
 *   - LEAVE, THEN JOIN AGAIN IN THE SAME BROWSER. Leave keeps the account and
 *     cannot remove the claim. The room was then chosen afresh by
 *     bestRoomFor(), which put "Ben" (Nagoya), who had left Room 2, in Room 1
 *     — a tie, broken by name. Simulated over 4–6 rooms of about four with the
 *     real assignRooms()/bestRoomFor(), about one leaver in five lands
 *     elsewhere (roughly 14 % ties, 5–6 % a room with fewer of their own
 *     university). There, an answer stayed in its box, refused, while a toast
 *     said "+3 — First answer written".
 *   - TWO STUDENTS ON ONE LAPTOP, ONE TAB EACH — which the clientId comment in
 *     script.js names as supported. One browser, one account, one claim: the
 *     facilitator's start placed the two tabs in different rooms, the first
 *     tab to enter claimed, and the second tab's student could write nothing.
 *     (That run got "We could not confirm your place in this room… please
 *     reload"; a reload changes nothing. With the other timing it was silent.)
 *
 * What the client does now: placement follows the claim (maybeSelfAssign), and
 * a participant shown a room their claim does not name is taken to the claimed
 * room and told why (startRoom). A join after Leave under a DIFFERENT name
 * takes a fresh client id (ownClientId), so the next student on a shared
 * browser keeps the browser's room but not the previous student's pool row
 * (decided 2026-10-14). And a score is celebrated only once the server has
 * accepted it (scoreTx).
 *
 * ── Every refusal is paired with an ALLOW ───────────────────────────────
 * The write that proves a participant is in the right room is one the rules
 * gate on the room (a working hypothesis), and the refused-score test has a
 * teammate whose same write is accepted AND celebrated — a client that never
 * celebrated anything would pass a refusal-only test.
 *
 * ── Users, contexts, devices ─────────────────────────────────────────────
 * Each participant is its own browser CONTEXT, and the uids are asserted to
 * differ — except the two tabs of the laptop test, which are ONE user on
 * purpose and are asserted to be. The participant under test runs on each of
 * the four viewports the platform supports (Chromium's device emulation —
 * this config has one browser): on a phone, Leave sits in the "More" menu.
 *
 * ── The DB value first, then the DOM ────────────────────────────────────
 * dbReadAsOwner() observes; it never decides a verdict. The facilitator never
 * opens a room here (its dashboard stops updating after it does).
 */

// @ts-check
const { devices } = require("@playwright/test");
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

const VIEWPORTS = [
  ["desktop", {}],
  ["iPhone", devices["iPhone 13"]],
  ["iPad", devices["iPad (gen 7)"]],
  ["Android", devices["Pixel 7"]],
];

/* Accepts the in-page confirm modal (Start warns about small rooms). */
async function autoAcceptModal(page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      setInterval(() => {
        const dlg = /** @type {any} */ (document.getElementById("canamed-modal"));
        if (dlg && dlg.open) {
          const ok = document.getElementById("canamed-modal-confirm");
          if (ok) ok.click();
        }
      }, 200);
    });
  });
}

/* Every toast the page shows, in order, readable as window.__toasts. */
async function recordToasts(page) {
  await page.addInitScript(() => {
    // @ts-ignore
    window.__toasts = [];
    const wrap = setInterval(() => {
      // @ts-ignore
      const orig = window.toast;
      if (typeof orig !== "function") return;
      clearInterval(wrap);
      // @ts-ignore
      window.toast = function (msg) { window.__toasts.push(String(msg)); return orig.apply(this, arguments); };
    }, 10);
  });
}
// @ts-ignore
const toastsOf = (page) => page.evaluate(() => window.__toasts.slice());

async function createSession(page, rooms) {
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await autoAcceptModal(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Claim Fac");
  await page.locator("#splash-create-label").fill("rejoin-room-claim");
  await page.locator("#splash-create-pass").fill("emu-claim-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  await page.locator("#roomcount-input").selectOption(String(rooms));
  const uid = await page.evaluate(() => firebase.auth().currentUser.uid);
  return { code, base, uid };
}

async function newTab(ctx) {
  const page = await ctx.newPage();
  await useEmulator(page);
  await recordToasts(page);
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  return page;
}

async function join(page, code, name, uni) {
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  /* NOT #name-input: the lobby shows before the session's scenario has loaded,
     and initLobby() then rebuilds the university list, wiping a choice made in
     between (seen here: the second tab joined with no university and never
     reached the waiting room). The badge is set after that rebuild. */
  await expect(page.locator("#session-badge")).toBeVisible({ timeout: 15_000 });
  await page.locator("#name-input").fill(name);
  await page.locator("#uni-input").selectOption(uni);
  await page.locator("#consent-workshop").check();
  await expect(page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#join-btn").click();
  await page.waitForFunction(() => !!firebase.auth().currentUser, null, { timeout: 20_000 });
}

/* A participant in a context of their own. */
async function participant(browser, code, name, uni, device) {
  const ctx = await browser.newContext(device || {});
  const page = await newTab(ctx);
  await join(page, code, name, uni);
  await expect(page.locator("#waiting")).toBeVisible({ timeout: 15_000 });
  return { ctx, page, name, uni };
}

async function identify(p) {
  p.uid = await p.page.evaluate(() => firebase.auth().currentUser.uid);
  p.cid = await p.page.evaluate(() => clientId);
  p.room = await p.page.evaluate(() => myRoom);
  return p;
}

/* Start, then take every room to the case stage. Read the dashboard only. */
async function startAndAdvance(fac, base, rooms, seated) {
  await expect(fac.locator("#prestart-count")).toHaveText(String(seated.length), { timeout: 15_000 });
  await fac.locator("#start-session-btn").click();
  for (const p of seated) await expect(p.page.locator("#app")).toBeVisible({ timeout: 20_000 });
  const adv = fac.getByRole("button", { name: /^Advance\s*→?$/ });
  await expect(adv).toHaveCount(rooms, { timeout: 15_000 });
  for (let i = 0; i < rooms; i++) await adv.nth(i).click();
  for (let i = 1; i <= rooms; i++) {
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/rooms/Room ${i}`)) || {}).stage,
      { message: `Room ${i} must reach the case stage`, timeout: 15_000 }).toBe(1);
  }
}

/* Write a working hypothesis through the on-screen form — a write the rules
   accept only from a participant whose claim names this room. */
async function addHypothesis(page, text) {
  await expect(page.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 15_000 });
  const details = page.locator("#chart-hypotheses");
  if (!(await details.evaluate((n) => /** @type {any} */ (n).open))) {
    await page.locator("#chart-hypotheses > summary").click();
  }
  const input = page.locator("#hypothesis-input");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(text);
  await input.press("Enter");
}

const findText = (node, text) => JSON.stringify(node || {}).includes(text);

for (const [label, device] of VIEWPORTS) {
  test(`Leave, then join again in the same browser (${label}): back in the claimed room, and the work saves`, async ({ page, browser }) => {
    test.setTimeout(150_000);
    const { code, base, uid: facUid } = await createSession(page, 2);

    /* assignRooms() takes the universities in turn and snakes through the
       rooms: Caen, Nagoya, Caen -> Room 1, Room 2, Room 2. So Ben, the only
       Nagoya participant, is in Room 2 with one Caen participant, and once he
       leaves both rooms hold one Caen participant: bestRoomFor() ties and
       picks Room 1 by name. That is the measured defect, and this test
       asserts the starting placement rather than assuming it. */
    const ana = await participant(browser, code, "Ana", "Caen");
    const ben = await participant(browser, code, "Ben", "Nagoya", device);
    const cleo = await participant(browser, code, "Cleo", "Caen");
    const seated = [ana, ben, cleo];
    await startAndAdvance(page, base, 2, seated);
    for (const p of seated) await identify(p);
    expect(new Set([facUid, ...seated.map((p) => p.uid)]).size,
      "four users, four accounts — a second page would be the same user").toBe(4);
    expect(ben.room, "the precondition: Ben starts in Room 2").toBe("Room 2");
    expect(await dbReadAsOwner(`${base}/roomOf/${ben.uid}`))
      .toEqual({ room: "Room 2", cid: ben.cid });

    // ---- Leave (on a phone it sits in the "More" menu) ----
    const leave = ben.page.locator("#leave-btn");
    if (!(await leave.isVisible())) await ben.page.locator("#stage-overflow-toggle").click();
    await leave.click();
    await expect(ben.page.locator("#splash-code")).toBeVisible({ timeout: 20_000 });

    // ---- and join again, same name ----
    await join(ben.page, code, "Ben", "Nagoya");
    await expect(ben.page.locator("#app")).toBeVisible({ timeout: 20_000 });
    const again = await identify({ page: ben.page });
    expect(again.uid, "the browser kept the account, so the claim is still this user's").toBe(ben.uid);
    expect(await dbReadAsOwner(`${base}/roomOf/${ben.uid}`), "the claim is write-once: unchanged")
      .toEqual({ room: "Room 2", cid: ben.cid });

    /* The DB first: the placement the client WROTE. On main this was Room 1. */
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/pool/${again.cid}`)) || {}).room,
      { message: "the rejoin must be placed in the room the claim names", timeout: 15_000 }).toBe("Room 2");
    expect(again.room).toBe("Room 2");
    await expect(ben.page.locator("#room-name")).toHaveText("Room 2");

    /* And a room-gated write lands — the reason the room matters. */
    const text = "rejoined " + Date.now().toString(36);
    await addHypothesis(ben.page, text);
    await expect.poll(async () => findText(await dbReadAsOwner(`${base}/rooms/Room 2`), text),
      { message: "the hypothesis must land in Room 2", timeout: 15_000 }).toBe(true);
    await expect(ben.page.locator("#hypothesis-input"), "the box empties when the write lands")
      .toHaveValue("", { timeout: 10_000 });
    await expect(ben.page.locator("#hypothesis-list")).toContainText(text);

    for (const p of seated) await p.ctx.close();
  });

  test(`two students on one laptop, one tab each (${label}): the second follows the claim and its work saves`, async ({ page, browser }) => {
    test.setTimeout(150_000);
    const { code, base, uid: facUid } = await createSession(page, 3);

    /* One context, two tabs: ONE user, deliberately. Caen, Nagoya, Caen over
       three rooms puts the three entries in three different rooms, so the two
       tabs always start apart. */
    const laptop = await browser.newContext(device);
    const dana = { ctx: laptop, page: await newTab(laptop), name: "Dana" };
    await join(dana.page, code, "Dana", "Caen");
    await expect(dana.page.locator("#waiting")).toBeVisible({ timeout: 15_000 });
    const eli = { ctx: laptop, page: await newTab(laptop), name: "Eli" };
    await join(eli.page, code, "Eli", "Nagoya");
    await expect(eli.page.locator("#waiting")).toBeVisible({ timeout: 15_000 });
    const fay = await participant(browser, code, "Fay", "Caen");
    const seated = [dana, eli, fay];

    await expect(page.locator("#prestart-count")).toHaveText("3", { timeout: 15_000 });
    await page.locator("#start-session-btn").click();
    for (const p of seated) await expect(p.page.locator("#app")).toBeVisible({ timeout: 20_000 });

    const sharedUid = await dana.page.evaluate(() => firebase.auth().currentUser.uid);
    expect(await eli.page.evaluate(() => firebase.auth().currentUser.uid),
      "two tabs of one browser are ONE account — the route under test").toBe(sharedUid);
    const fayUid = await fay.page.evaluate(() => firebase.auth().currentUser.uid);
    expect(new Set([facUid, sharedUid, fayUid]).size).toBe(3);

    /* The DB first: one claim, and both tabs' pool entries name its room. */
    await expect.poll(() => dbReadAsOwner(`${base}/roomOf/${sharedUid}`),
      { message: "the first tab to enter claims", timeout: 15_000 }).not.toBeNull();
    const claimRoom = (await dbReadAsOwner(`${base}/roomOf/${sharedUid}`)).room;
    for (const t of [dana, eli]) {
      const cid = await t.page.evaluate(() => clientId);
      await expect.poll(async () => ((await dbReadAsOwner(`${base}/pool/${cid}`)) || {}).room,
        { message: `${t.name}'s tab must be placed in the claimed room`, timeout: 15_000 }).toBe(claimRoom);
      await expect(t.page.locator("#room-name")).toHaveText(claimRoom, { timeout: 15_000 });
    }

    /* The tab that was moved says why; the other says nothing of the kind. */
    const said = [await toastsOf(dana.page), await toastsOf(eli.page)]
      .map((ts) => ts.filter((m) => m.indexOf("You are in " + claimRoom) === 0).length);
    expect(said.sort(), "exactly one tab was moved, and it was told").toEqual([0, 1]);

    /* Advance the room they share, and both tabs' work lands there. */
    const adv = page.getByRole("button", { name: /^Advance\s*→?$/ });
    await expect(adv).toHaveCount(3, { timeout: 15_000 });
    await adv.nth(Number(claimRoom.slice(-1)) - 1).click();
    await expect.poll(async () => ((await dbReadAsOwner(`${base}/rooms/${claimRoom}`)) || {}).stage,
      { timeout: 15_000 }).toBe(1);
    for (const t of [dana, eli]) {
      const text = "laptop " + t.name + " " + Date.now().toString(36);
      await addHypothesis(t.page, text);
      await expect.poll(async () => findText(await dbReadAsOwner(`${base}/rooms/${claimRoom}`), text),
        { message: `${t.name}'s hypothesis must land in ${claimRoom}`, timeout: 15_000 }).toBe(true);
    }

    await laptop.close();
    await fay.ctx.close();
  });
}

test("the next student on a shared browser: the room the browser holds, and a pool row of their own", async ({ page, browser }) => {
  /* Decided 2026-10-14 (Basile): a different student who joins after Leave in
     the same browser keeps the browser's place — the account and its claim
     are the browser's — but must not take over the previous student's pool
     row, which holds that student's name and the consent record their
     answers are read against. Before: the same tab kept the client id, and
     the join rewrote that row. */
  test.setTimeout(150_000);
  const { code, base, uid: facUid } = await createSession(page, 2);
  const ana = await participant(browser, code, "Ana", "Caen");
  const ben = await participant(browser, code, "Ben", "Nagoya");
  const cleo = await participant(browser, code, "Cleo", "Caen");
  const seated = [ana, ben, cleo];
  await startAndAdvance(page, base, 2, seated);
  for (const p of seated) await identify(p);
  expect(new Set([facUid, ...seated.map((p) => p.uid)]).size).toBe(4);
  expect(ben.room).toBe("Room 2");
  const benRow = await dbReadAsOwner(`${base}/pool/${ben.cid}`);
  expect(benRow.name).toBe("Ben");

  await ben.page.locator("#leave-btn").click();
  await expect(ben.page.locator("#splash-code")).toBeVisible({ timeout: 20_000 });
  await join(ben.page, code, "Zed", "Nagoya");
  await expect(ben.page.locator("#app")).toBeVisible({ timeout: 20_000 });
  const zed = await identify({ page: ben.page });

  expect(zed.uid, "a shared browser is one account").toBe(ben.uid);
  expect(zed.cid, "a different name takes a client id of its own").not.toBe(ben.cid);
  /* The DB first: Ben's row is still Ben's, consent record and all. */
  const benRowAfter = await dbReadAsOwner(`${base}/pool/${ben.cid}`);
  expect(benRowAfter && benRowAfter.name, "Ben's row is not rewritten as Zed's").toBe("Ben");
  expect(benRowAfter.consent, "nor is the consent record Ben's answers are read against").toEqual(benRow.consent);
  await expect.poll(async () => ((await dbReadAsOwner(`${base}/pool/${zed.cid}`)) || {}).room,
    { message: "Zed has a row of their own, in the room the browser holds", timeout: 15_000 }).toBe("Room 2");
  expect((await dbReadAsOwner(`${base}/pool/${zed.cid}`)).name).toBe("Zed");
  expect(await dbReadAsOwner(`${base}/roomOf/${ben.uid}`), "the claim is untouched")
    .toEqual({ room: "Room 2", cid: ben.cid });
  await expect(ben.page.locator("#room-name")).toHaveText("Room 2");

  const text = "next student " + Date.now().toString(36);
  await addHypothesis(ben.page, text);
  await expect.poll(async () => findText(await dbReadAsOwner(`${base}/rooms/Room 2`), text),
    { message: "and Zed's work lands there", timeout: 15_000 }).toBe(true);

  for (const p of seated) await p.ctx.close();
});

test("a refused score write is not celebrated; an accepted one still is", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { code, base, uid: facUid } = await createSession(page, 2);
  // Caen, Nagoya, Caen -> Room 1, Room 2, Room 2: Ben and one Caen teammate share Room 2.
  const ana = await participant(browser, code, "Ana", "Caen");
  const ben = await participant(browser, code, "Ben", "Nagoya");
  const cleo = await participant(browser, code, "Cleo", "Caen");
  const seated = [ana, ben, cleo];
  await startAndAdvance(page, base, 2, seated);
  for (const p of seated) await identify(p);
  expect(new Set([facUid, ...seated.map((p) => p.uid)]).size).toBe(4);
  expect(ben.room).toBe("Room 2");
  const mate = seated.find((p) => p !== ben && p.room === "Room 2");

  /* Produce a refusal the product can reach without a route of its own: the
     facilitator rewrites Ben's claim to Room 1 (the claim rule's facilitator
     branch), while Ben stays on Room 2. From here the rules refuse Ben's
     room writes in Room 2. */
  const rewrite = await page.evaluate(async ([p, cid]) => {
    try { await firebase.database().ref(p).set({ room: "Room 1", cid }); return "ALLOWED"; }
    catch (e) { return String(e && (e.code || e.message)); }
  }, [`${base}/roomOf/${ben.uid}`, ben.cid]);
  expect(rewrite).toBe("ALLOWED");

  /* The teammate's hypothesis opens the answers tab for the room. */
  await addHypothesis(mate.page, "mate hypothesis");
  await expect.poll(async () => findText(await dbReadAsOwner(`${base}/rooms/Room 2`), "mate hypothesis"),
    { timeout: 15_000 }).toBe(true);

  const answer = async (p, text) => {
    await expect(p.page.locator("#rcol-tab-answers")).toBeVisible({ timeout: 15_000 });
    await p.page.locator("#rcol-tab-answers").dispatchEvent("click");
    const box = p.page.locator("#answer-input-moduleA-diagnosis");
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill(text);
    await box.press("Enter");
    return box;
  };

  // ---- REFUSED: Ben's answer, and the score writes it triggers ----
  const before = (await toastsOf(ben.page)).length;
  const benBox = await answer(ben, "refused answer");
  /* Nothing to poll for: the defect is a toast that appears and a write that
     does not. The refusals arrive within one round trip on the emulator. */
  await ben.page.waitForTimeout(3000);
  const room2 = await dbReadAsOwner(`${base}/rooms/Room 2`);
  expect(findText(room2, "refused answer"), "the answer was refused").toBe(false);
  expect(((room2 || {}).score || {}).auto || null, "and so was every score write it triggered").toBeNull();
  await expect(benBox, "the box keeps the refused text").toHaveValue("refused answer");
  expect((await toastsOf(ben.page)).slice(before).filter((m) => /^\+\d/.test(m)),
    "no points were announced for writes the server refused").toEqual([]);

  // ---- ALLOWED: the teammate's answer, celebrated once the server accepts it ----
  const mateBefore = (await toastsOf(mate.page)).length;
  const mateBox = await answer(mate, "accepted answer");
  await expect(mateBox, "the box empties when the write lands").toHaveValue("", { timeout: 10_000 });
  await expect.poll(async () => (((await dbReadAsOwner(`${base}/rooms/Room 2`)) || {}).score || {}).auto || {},
    { message: "the score writes land", timeout: 15_000 }).toHaveProperty("bulletsA1");
  await expect.poll(async () => (await toastsOf(mate.page)).slice(mateBefore).filter((m) => /^\+\d/.test(m)).length,
    { message: "and are announced", timeout: 10_000 }).toBeGreaterThan(0);

  for (const p of seated) await p.ctx.close();
});
