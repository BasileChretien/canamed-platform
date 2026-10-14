/* tests-e2e/emulator/call-before-claim.spec.js
 *
 * "Call a facilitator" pressed before the participant's room claim has landed.
 *
 * Since #457 the call for help needs a room claim in the session
 * (`roomOf/<uid>`) or the facilitator. startRoom() issues the claim when the
 * room is entered — a read, then a write — and the button is on screen and
 * live before that write has reached the server. A participant who pressed it
 * in that moment was REFUSED: the button said "called" and went back to "Call
 * a facilitator", nothing was written, nothing was said. Seen once by chance
 * in a run of call-for-help-ack.spec.js (2026-10-14), then made reproducible
 * here, before the client changed, by holding the claim's write in transit.
 *
 * THE FIX (client): the call button's writes — raising, re-raising,
 * cancelling, and the `help` entry in the room's event log — wait until the
 * claim has settled. Nothing else changes: the rule, the payload, the
 * thirty-second throttle.
 *
 * THE SAME RACE, AND THE SAME FIX, FOR TWO MORE WRITES (the second and third
 * tests). A workup reveal and the team name need a claim on THIS room (#457)
 * and were refused the same way: a reveal clicked in the first moment wrote
 * nothing (the toast had already shown the answer), and "Save name" said
 * "Could not save the team name". reveal() — which the LLM chat's unlocks also
 * call — and the team-name save now wait for the claim too.
 *
 * HOW THE RACE IS MADE CERTAIN. The participant's page routes its own
 * database WebSocket and holds the one frame that writes `roomOf/<uid>` for
 * a few seconds; everything else passes untouched. Two preconditions are
 * ASSERTED, not assumed — that the frame was held, and that the claim is not
 * in the database when the button is pressed — so the test cannot pass
 * without the race having happened.
 *
 * The DB value first, then the DOM. dbReadAsOwner() observes; it never
 * decides a verdict.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

const HOLD_MS = 4_000;

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

/* A participant whose room claim reaches the server HOLD_MS late. The claim
   is the client's only `put` to a `/roomOf/` path; its READ (a listen on the
   same path) is not a put and passes. */
async function joinWithHeldClaim(browser, code, name, holdMs = HOLD_MS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  await installModalAutoAccept(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  const held = [];
  await page.routeWebSocket((url) => url.port === "9000", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (typeof m === "string" && /"a":"p"/.test(m) && /\/roomOf\//.test(m)) {
        held.push(Date.now());
        setTimeout(() => server.send(m), holdMs);
      } else {
        server.send(m);
      }
    });
    server.onMessage((m) => ws.send(m));
  });
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
  return { ctx, page, name, held, uid: await page.evaluate(() => firebase.auth().currentUser.uid) };
}

/* A session with one participant whose room claim is held: the facilitator's
   page on the dashboard, the participant in the room, the claim not landed. */
async function heldParticipantInRoom(page, browser, label, holdMs = HOLD_MS) {
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("emu-claim-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  const facUid = await page.evaluate(() => firebase.auth().currentUser.uid);

  const ana = await joinWithHeldClaim(browser, code, "Ana", holdMs);
  expect(ana.uid, "a second user, in a second context").not.toBe(facUid);
  await expect(page.locator("#prestart-count")).toHaveText("1", { timeout: 20_000 });
  await page.locator("#roomcount-input").selectOption("1");
  await page.locator("#start-session-btn").click();
  await expect(ana.page.locator("#app")).toBeVisible({ timeout: 25_000 });
  const room = await ana.page.evaluate(() => myRoom);
  /* THE PRECONDITIONS: the claim's write is in transit, and the database does
     not hold it. Each test asserts the second again at the moment it writes. */
  await expect.poll(() => ana.held.length, { message: "the claim's write was held", timeout: 10_000 }).toBe(1);
  expect(await dbReadAsOwner(`${base}/roomOf/${ana.uid}`), "no claim in the database yet").toBeNull();
  return { base, room, ana };
}
const claimLands = (base, ana, room) => expect.poll(
  async () => ((await dbReadAsOwner(`${base}/roomOf/${ana.uid}`)) || {}).room,
  { message: "the claim, once released", timeout: 15_000 }).toBe(room);

test("a call pressed before the room claim has landed still reaches the facilitator", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { base, room, ana } = await heldParticipantInRoom(page, browser, "call-before-claim");
  const call = `${base}/rooms/${room}/callForHelp`;
  const btn = ana.page.locator("#call-prof-btn");
  await expect(btn).toHaveText("Call a facilitator");

  expect(await dbReadAsOwner(`${base}/roomOf/${ana.uid}`), "no claim in the database when pressed").toBeNull();
  await btn.click();
  expect(Date.now() - ana.held[0], "pressed while the claim was still held").toBeLessThan(HOLD_MS);

  /* The DB first: the claim lands when released, and then the call. */
  await claimLands(base, ana, room);
  await expect.poll(async () => ((await dbReadAsOwner(call)) || {}).by,
    { message: "the call pressed before the claim must reach the database", timeout: 15_000 }).toBe("Ana");
  await expect.poll(async () => Object.values((await dbReadAsOwner(`${base}/rooms/${room}/events`)) || {})
    .filter(e => e.kind === "help" && e.by === "Ana").length,
    { message: "…and its entry in the room's event log", timeout: 15_000 }).toBe(1);
  /* Then the DOM: the room shows the call, and so does the facilitator. */
  await expect(btn).toHaveText("Facilitator called ✓ (tap to cancel)", { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#dashboard .calling").length),
    { message: "the dashboard shows the room calling", timeout: 15_000 }).toBeGreaterThan(0);

  await ana.ctx.close();
});

test("a reveal clicked before the room claim has landed is saved", async ({ page, browser }) => {
  test.setTimeout(120_000);
  /* A longer hold: the room is moved to the case stage first, as for a
     participant who arrives while the case is already open. */
  const HOLD = 8_000;
  const { base, room, ana } = await heldParticipantInRoom(page, browser, "reveal-before-claim", HOLD);
  await page.evaluate((r) => setRoomStage(r, 0, 1), room);
  await expect(ana.page.locator("#stage-indicator")).toContainText(/Stage 2/i, { timeout: 10_000 });
  await expect.poll(() => ana.page.evaluate(() => document.querySelectorAll(".req-btn").length),
    { timeout: 10_000 }).toBeGreaterThan(0);

  expect(await dbReadAsOwner(`${base}/roomOf/${ana.uid}`), "no claim in the database when clicked").toBeNull();
  /* The workup button's own handler, clicked from script: the chat-first case
     view keeps the buttons out of the layout (as in room-writes-room-bound). */
  await ana.page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".req-btn")).find(x => x.dataset.id === "history:0");
    if (!b) throw new Error("no workup button for history:0");
    b.click();
  });
  expect(Date.now() - ana.held[0], "clicked while the claim was still held").toBeLessThan(HOLD);

  await claimLands(base, ana, room);
  await expect.poll(async () => ((await dbReadAsOwner(`${base}/rooms/${room}/sections/1/revealed/history:0`)) || {}).by,
    { message: "the reveal clicked before the claim must reach the database", timeout: 15_000 }).toBe("Ana");
  await expect.poll(async () => Object.values((await dbReadAsOwner(`${base}/rooms/${room}/events`)) || {})
    .filter(e => e.kind === "reveal" && e.by === "Ana").length,
    { message: "…and its entry in the room's event log", timeout: 15_000 }).toBe(1);
  /* Then the DOM: the button is marked done. */
  await expect.poll(() => ana.page.evaluate(() =>
    Array.from(document.querySelectorAll(".req-btn")).some(x => x.dataset.id === "history:0" && x.classList.contains("done"))),
    { timeout: 15_000 }).toBe(true);

  await ana.ctx.close();
});

test("a team name saved before the room claim has landed is saved, without an error", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { base, room, ana } = await heldParticipantInRoom(page, browser, "team-name-before-claim");
  await ana.page.evaluate(() => {
    window.__toasts = [];
    const orig = window.toast;
    window.toast = function (msg) { window.__toasts.push(String(msg)); return orig.apply(this, arguments); };
  });

  expect(await dbReadAsOwner(`${base}/roomOf/${ana.uid}`), "no claim in the database when saved").toBeNull();
  await ana.page.evaluate(() => {
    document.getElementById("team-name-input").value = "Team Early";
    document.getElementById("team-name-btn").click();
  });
  expect(Date.now() - ana.held[0], "saved while the claim was still held").toBeLessThan(HOLD_MS);

  await claimLands(base, ana, room);
  await expect.poll(() => dbReadAsOwner(`${base}/rooms/${room}/teamName`),
    { message: "the team name saved before the claim must reach the database", timeout: 15_000 }).toBe("Team Early");
  /* Then the DOM: on the score chip, and no "Could not save" message. */
  await expect(ana.page.locator("#room-score-chip")).toContainText("Team Early", { timeout: 15_000 });
  expect((await ana.page.evaluate(() => window.__toasts)).filter(t => /Could not save the team name/.test(t)),
    "no failure message").toEqual([]);

  await ana.ctx.close();
});
