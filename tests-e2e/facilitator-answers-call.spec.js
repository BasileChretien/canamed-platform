/* tests-e2e/facilitator-answers-call.spec.js
 *
 * (Not named after the emulator spec, call-for-help-ack.spec.js, on purpose:
 * the mobile projects' testMatch is a list of NAME endings with no directory,
 * so a shared name would run the emulator spec under a mobile project — against
 * whatever emulator holds :9000 at the time.)
 *
 * What a room sees once a facilitator answers its call for help, on every
 * device: the facilitator opens the room, the room's button turns to
 * "A facilitator is coming ✓ (tap to call again)", and tapping it calls again.
 * And the facilitator's view of a room no longer offers "Reset this room's
 * case" (removed 2026-10-14: it sent a delete no rule grants, and deleted
 * nothing).
 *
 * Until 2026-10-14 no production room ever reached the acknowledged state: the
 * database refused the facilitator's acknowledgement (tests/call-for-help-ack.test.js,
 * and the emulator spec of the same name, which is where the RULES are
 * exercised). This spec runs in LOCAL mode, which models no rules — it covers
 * the screens the repaired rule makes reachable, on desktop and the three
 * mobile projects.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js). A participant tab shares the
 * facilitator's storage, which is what LocalDB syncs through; in LOCAL mode
 * there are no accounts, so that is not the identity trap the emulator suite
 * warns about.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function acceptModals(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg) new MutationObserver(tryAccept).observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });
  page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
}

async function createSession(page) {
  await acceptModals(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill("E2E call ack");
  await page.locator("#splash-create-pass").fill("e2e-ack-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
  return code;
}

async function joinAsParticipant(context, code) {
  const tab = await context.newPage();
  await acceptModals(tab);
  await tab.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
    } catch (e) {}
    function pin(name, value) {
      Object.defineProperty(window, name, { get: () => value, set: () => {}, configurable: true, enumerable: true });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    /* The call button's own throttle speaks through alert(). */
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
  });
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  await tab.locator("#name-input").fill("E2E Student");
  const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab.locator("#uni-input").selectOption(uni);
  await tab.locator("#consent-workshop").check();
  await expect(tab.locator("#join-btn")).toBeEnabled({ timeout: 5_000 });
  await tab.locator("#join-btn").click();
  await expect(tab.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab;
}

/* The room's call, read from LocalDB through the page's own path helper.
   (LocalDB's once() returns a promise and ignores a callback.) */
const readCall = (page, room) => page.evaluate((r) =>
  db.ref(sPath("rooms/" + r + "/callForHelp")).once("value").then((s) => s.val()), room);

test("a facilitator who opens a room answers its call; the room sees it and can call again; no reset control", async ({ page, context }) => {
  test.setTimeout(180_000);   // includes the client's own thirty-second wait; the iPad project is slowest
  const code = await createSession(page);
  const student = await joinAsParticipant(context, code);

  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
  await page.locator("#roomcount-input").selectOption("1");
  await page.locator("#start-session-btn").click();
  await expect(student.locator("#app")).toBeVisible({ timeout: 15_000 });
  const room = await student.evaluate(() => myRoom);

  /* ── the room calls ── */
  const btn = student.locator("#call-prof-btn");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Call a facilitator");
  await btn.click();
  await expect.poll(async () => ((await readCall(page, room)) || {}).by, { timeout: 10_000 }).toBe("E2E Student");
  /* The client's throttle runs from the moment its click handler ran, and
     initCallProf() stamps the call with that same moment — so this, not a
     clock read in Node before the click, is where the thirty seconds start.
     (On WebKit-iPhone the handler ran 1.5-2.1 s after such a Node read; the
     first version of this test waited from the Node read and failed in CI.) */
  const firstCallAt = (await readCall(page, room)).at;
  await expect(btn).toHaveText("Facilitator called ✓ (tap to cancel)");

  /* ── the facilitator opens the room ── */
  await page.evaluate((r) => openRoomAsAdmin(r), room);
  /* The DB first, then the DOM. */
  await expect.poll(async () => ((await readCall(page, room)) || {}).ack, { timeout: 10_000 }).toBe(true);
  await expect(btn).toHaveText("A facilitator is coming ✓ (tap to call again)", { timeout: 10_000 });
  await expect(btn).toBeVisible();
  await expect(student.locator("#a11y-stage-announce")).toHaveText("A facilitator is on the way.");

  /* The facilitator's view of the room: "Resolve call", and no reset. */
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#call-prof-btn")).toHaveText("Resolve call (clear the alert)");
  await expect(page.locator("#reset-btn")).toHaveCount(0);
  await expect(page.getByText("Reset this room's case")).toHaveCount(0);

  /* ── "tap to call again" ──
     The client keeps thirty seconds between two calls of its own (the server
     rule lets a call follow an acknowledged one at once): a tap inside them is
     answered with a wait, and writes nothing… */
  await btn.click();
  await expect.poll(() => student.evaluate(() => window.__alerts.join(" | ")), { timeout: 5_000 })
    .toMatch(/Please wait \d+s before re-calling a facilitator/);
  expect(((await readCall(page, room)) || {}).ack, "still the acknowledged call").toBe(true);
  /* …and a tap after them calls again. Wait on the PAGE's clock, from the
     first call's own date. */
  await student.waitForFunction((at) => serverNow() >= at + 30_500, firstCallAt, { timeout: 45_000 });
  const alertsBefore = await student.evaluate(() => window.__alerts.length);
  await btn.click();
  /* A refused tap leaves the acknowledged call in place; say whether the
     throttle refused it, so a failure here names its cause. */
  await expect.poll(async () => {
    const c = await readCall(page, room);
    const state = c ? (c.ack === true ? "acknowledged" : "fresh call") : "none";
    const throttled = await student.evaluate((n) => window.__alerts.slice(n).join(" | "), alertsBefore);
    return throttled ? state + " (throttled: " + throttled + ")" : state;
  }, { timeout: 10_000 }).toBe("fresh call");
  await expect(btn).toHaveText("Facilitator called ✓ (tap to cancel)");

  await student.close();
});
