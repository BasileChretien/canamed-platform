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
async function joinWithHeldClaim(browser, code, name) {
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
        setTimeout(() => server.send(m), HOLD_MS);
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

test("a call pressed before the room claim has landed still reaches the facilitator", async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  await installModalAutoAccept(page);

  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Fac");
  await page.locator("#splash-create-label").fill("call-before-claim");
  await page.locator("#splash-create-pass").fill("emu-claim-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 15_000 });
  const facUid = await page.evaluate(() => firebase.auth().currentUser.uid);

  const ana = await joinWithHeldClaim(browser, code, "Ana");
  expect(ana.uid, "a second user, in a second context").not.toBe(facUid);
  await expect(page.locator("#prestart-count")).toHaveText("1", { timeout: 20_000 });
  await page.locator("#roomcount-input").selectOption("1");
  await page.locator("#start-session-btn").click();

  await expect(ana.page.locator("#app")).toBeVisible({ timeout: 25_000 });
  const room = await ana.page.evaluate(() => myRoom);
  const call = `${base}/rooms/${room}/callForHelp`;
  const btn = ana.page.locator("#call-prof-btn");
  await expect(btn).toHaveText("Call a facilitator");

  /* THE PRECONDITIONS: the claim's write is in transit, and the database does
     not hold it when the button is pressed. */
  await expect.poll(() => ana.held.length, { message: "the claim's write was held", timeout: 10_000 }).toBe(1);
  expect(await dbReadAsOwner(`${base}/roomOf/${ana.uid}`), "no claim in the database yet").toBeNull();
  await btn.click();
  expect(Date.now() - ana.held[0], "pressed while the claim was still held").toBeLessThan(HOLD_MS);

  /* The DB first: the claim lands when released, and then the call. */
  await expect.poll(async () => ((await dbReadAsOwner(`${base}/roomOf/${ana.uid}`)) || {}).room,
    { message: "the claim, once released", timeout: 15_000 }).toBe(room);
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
