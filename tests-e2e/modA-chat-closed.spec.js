/* tests-e2e/modA-chat-closed.spec.js
 *
 * A closed session locks the chat and says so (found live 2026-09-09: "it says
 * thinking but no reply is written"). Once `closed` exists the rules refuse
 * every roomChat write, so a question typed after "End session" was relayed to
 * the model and then silently dropped — the transcript is DB-driven, both turn
 * writes were denied, the status cleared, and the input stayed open.
 *
 * LOCAL mode has no rules, so the DENIAL itself cannot be exercised here; what
 * this pins is the client contract: the moment the session is closed, the chat
 * input and Send are disabled, the consent gate goes, the status line explains,
 * and a submit attempted anyway produces no turn. The static half is
 * tests/chat-closed-session.test.js. Runs on desktop + the three mobile projects
 * (registered in playwright.config.js).
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

/* Facilitator creates + starts a session in the main page; a student joins in
   a second page and lands on stage 1 with the chat. Same recipe as
   modA-chat-controls.spec.js. */
async function reachStage1(page, context) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Chat Fac");
  await page.locator("#splash-create-pass").fill("chat-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible();
  const tab2 = await context.newPage();
  tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab2.addInitScript(() => {
    function pin(name, value) {
      Object.defineProperty(window, name, { get: () => value, set: () => {}, configurable: true, enumerable: true });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
    } catch (e) {}
  });
  await tab2.goto("/");
  await tab2.locator("#splash-code").fill(code);
  await tab2.locator("#splash-enter").click();
  await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  await tab2.locator("#name-input").fill("Chat Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  const joinBtn = tab2.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 5000 });
  await joinBtn.click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
  await page.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Advance\s*→?$/ }).first().click();
  await expect(tab2.locator("#stage-1")).toBeVisible({ timeout: 10_000 });
  return tab2;
}

/* Tap a control on the student page. Instant pre-scroll first: on the WebKit
   projects Playwright's own pre-click "scrolling into view" step can hang —
   the collapsing room header shifts the layout mid-scroll, so the target never
   settles (observed on mobile-iphone here, and on mobile-ipad in
   modA-chat-controls.spec.js, 2026-07-21). */
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.click();
}

test.describe("Module A chat — closed session", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("canamed_tour_done", "v1");
        localStorage.setItem("canamed_tour_admin_done", "v1");
        localStorage.setItem("canamed_tour_student_done", "v1");
        localStorage.setItem("canamed_tour_student_moda_done", "v1");
      } catch (e) {}
      const tryAccept = () => {
        const dlg = document.getElementById("canamed-modal");
        if (dlg && dlg.open) {
          const ok = document.getElementById("canamed-modal-confirm");
          if (ok) ok.click();
        }
      };
      document.addEventListener("DOMContentLoaded", () => setInterval(tryAccept, 200));
    });
  });

  test("ending the session locks the chat, says so, and a submit produces no turn", async ({ page, context }) => {
    const student = await reachStage1(page, context);
    const input = student.locator("#modA-chat-input");
    const consent = student.locator("#modA-chat-consent-btn");
    await expect(student.locator("#modA-chat-panel")).toBeVisible({ timeout: 10_000 });
    // Precondition: an open session accepts questions (after the consent gate).
    await tap(consent);
    await expect(input).toBeEnabled();
    const turnsBefore = await student.locator(".moda-chat-bub").count();

    // The facilitator ends the session. The student's closed listener fires
    // renderClosedState(), which now publishes the flag + event for the chat.
    await student.evaluate(() => {
      // @ts-ignore — page globals (LOCAL mode, no rules)
      db.ref(sPath("closed")).set({ at: Date.now(), by: "Chat Fac" });
    });
    await expect(input).toBeDisabled({ timeout: 10_000 });
    await expect(student.locator("#modA-chat-send")).toBeDisabled();
    await expect(student.locator("#modA-chat-status")).toContainText(/session has ended/i);
    await expect(input).toHaveAttribute("placeholder", /session has ended/i);
    expect(await student.evaluate(() => window.CANAMED_SESSION_CLOSED)).toBe(true);

    // A submit forced through anyway (the form, not the disabled button) must
    // not reach the model or write a turn.
    await student.evaluate(() => {
      const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById("modA-chat-input"));
      ta.value = "Why is the patient here?";
      const form = ta.closest("form");
      if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await student.waitForTimeout(1500);
    expect(await student.locator(".moda-chat-bub").count()).toBe(turnsBefore);
    await expect(student.locator("#modA-chat-status")).toContainText(/session has ended/i);
    await student.close();
  });

  test("a chat mounted AFTER the session closed is locked from the start", async ({ page, context }) => {
    const student = await reachStage1(page, context);
    await expect(student.locator("#modA-chat-panel")).toBeVisible({ timeout: 10_000 });
    await student.evaluate(() => {
      // @ts-ignore
      db.ref(sPath("closed")).set({ at: Date.now(), by: "Chat Fac" });
    });
    await expect(student.locator("#modA-chat-input")).toBeDisabled({ timeout: 10_000 });
    // Re-initialise the chat (what re-entering the section does): the flag is
    // already set, so the lock must apply at mount, not only on the event.
    await student.evaluate(() => {
      // @ts-ignore
      window.modALLMRuntime.destroy();
      // @ts-ignore
      window.modALLMInit && window.modALLMInit();
    });
    await expect(student.locator("#modA-chat-input")).toBeDisabled();
    await expect(student.locator("#modA-chat-status")).toContainText(/session has ended/i);
    await student.close();
  });
});
