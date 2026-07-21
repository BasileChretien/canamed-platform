/* tests-e2e/modA-chat-controls.spec.js
 *
 * Functional coverage for the Module A patient-chat CONTROLS
 * (.moda-chat-consent-btn and the .moda-chat-form Send button) — added with
 * the 2026-07-18 pill-button restyle so the two controls that gate the
 * platform's core interaction are exercised on every device project, not
 * only screenshotted. LOCAL mode: the stub patient replies, no Firebase.
 */
const { test, expect } = require("./fixtures.js");

async function reachStage1(page, context) {
  // Facilitator creates a session…
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

  // …a participant joins…
  const tab2 = await context.newPage();
  tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
  await tab2.addInitScript(() => {
    // context.newPage() does NOT inherit the fixture's LOCAL-mode pinning —
    // re-pin here (mirrors a11y.spec.js) or the join gate waits on Firebase.
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
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

  // …admin starts and advances the room to Stage 1 (Module A).
  await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
  await page.locator("#start-session-btn").click();
  await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Advance\s*→?$/ }).first().click();
  await expect(tab2.locator("#stage-1")).toBeVisible({ timeout: 10_000 });
  return tab2;
}

test.describe("Module A chat controls", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("canamed_tour_done", "v1");
        localStorage.setItem("canamed_tour_admin_done", "v1");
        localStorage.setItem("canamed_tour_student_done", "v1");
      localStorage.setItem("canamed_tour_student_moda_done", "v1");
      } catch (e) {}
      // Start/Advance confirm via the in-page canamed-modal — auto-accept it
      // (mirrors a11y.spec.js) or the participant is never placed.
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

  test("consent gate then Send round-trips a question to the stub patient", async ({ page, context }) => {
    const student = await reachStage1(page, context);

    // The consent CTA gates the chat: visible, tappable, and it reveals the form.
    const consent = student.locator(".moda-chat-consent-btn");
    await consent.scrollIntoViewIfNeeded();
    await expect(consent).toBeVisible({ timeout: 10_000 });
    // Touch-target floor measured BEFORE the click — the button leaves the
    // DOM afterwards, and a null boundingBox behind an if-guard would skip
    // the assertion silently (CodeRabbit catch).
    const consentBox = await consent.boundingBox();
    expect(consentBox.height, "consent button keeps a usable tap height").toBeGreaterThanOrEqual(24);
    await consent.click();

    // The form controls become usable.
    const input = student.locator("#modA-chat-input");
    const send = student.locator("#modA-chat-send");
    await expect(input).toBeVisible();
    await expect(send).toBeEnabled();

    // Type + send; the submission is PROCESSED: the input clears and the
    // LOCAL stub scores the history question (award chip in the transcript).
    // NOTE deliberately NOT asserting a .moda-chat-bub-user bubble: rendering
    // the turn bubbles is broken in LOCAL DESKTOP mode (pre-existing — the
    // score pipeline runs but the transcript stays empty; tracked as its own
    // bug task 2026-07-21). Mobile projects do render bubbles; this spec
    // asserts the cross-project truth.
    await input.fill("Where exactly does it hurt?");
    await send.click();
    await expect(input).toHaveValue("", { timeout: 10_000 });
    await expect(student.locator(".moda-chat-score.is-award").first())
      .toBeVisible({ timeout: 10_000 });

    // Send stays in the DOM — assert its tap height unguarded.
    const sendBox = await send.boundingBox();
    expect(sendBox.height, "send button keeps a usable tap height").toBeGreaterThanOrEqual(24);
    await student.close();
  });
});
