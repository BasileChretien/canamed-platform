/* tests-e2e/modA-chat-wait.spec.js
 *
 * Module A chat, WAITING for a reply (found live 2026-09-11, shell v171).
 * Replies through the self-hosted proxy take 7–19 s, and the only feedback
 * was a static "<Character> is thinking…", so students took the chat for
 * frozen. While a turn is pending the thread it was asked in now shows three
 * typing dots, and after a threshold the status line counts the seconds.
 *
 * HOLDING A TURN PENDING. LOCAL mode wires no backend (no Firebase app, so
 * neither the proxy nor the callable branch is taken) and the stub patient
 * answers in the same task, so the dots would never paint. The spec swaps the
 * bridge's backend for a callable whose promise the PAGE keeps a handle on —
 * the same setCallable() seam the proxy and the Firebase callable use in
 * production, so everything above it (submit, persistence, the waiting cue,
 * teardown) runs as it does live; only the length of the wait is the test's.
 * The counter's threshold is set to 0 through CANAMED_CHAT_WAIT_HINT_MS rather
 * than sleeping five seconds on every device.
 *
 * The client-side TIMEOUT on the proxy path is proven with mock timers in
 * tests/modA-chat-wait-feedback.test.js — 50 s cannot be waited out here.
 *
 * Runs on desktop chromium + mobile-iphone / mobile-ipad / mobile-android
 * (registered in playwright.config.js), per the standing instruction.
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

const CAST = [
  { id: "patient", role: "patient", module: ["A"], present: "start",
    name: "Mayumi", persona: "You are Mayumi, 15, guarded and sullen." },
  { id: "mother", role: "relative", module: ["A"], present: "start",
    name: "Mayumi's Mother", persona: "You are Mayumi's mother." }
];
const CASE = {
  history: [{ q: { en: "How are you sleeping?" }, a: { en: "PATIENT-LINE: badly." } }],
  exam: [], labs: [], prompts: []
};

/* Facilitator creates + starts a session; a participant joins in a second tab
   and lands on stage 1 with the chat. Same recipe as modA-switchboard.spec.js
   (LOCAL mode needs the SAME context: LocalDB syncs across its tabs). The
   chat's one-time consent is pre-accepted — modA-chat-controls.spec.js covers
   that gate. */
async function reachStage1(page, context) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Wait Fac");
  await page.locator("#splash-create-pass").fill("wait-pw");
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
      localStorage.setItem("canamedModALLMConsent", "1");
    } catch (e) {}
  });
  await tab2.goto("/");
  await tab2.locator("#splash-code").fill(code);
  await tab2.locator("#splash-enter").click();
  await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
  await tab2.locator("#name-input").fill("Wait Student");
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
  await expect(tab2.locator("#modA-chat-panel")).toBeVisible({ timeout: 10_000 });
  return tab2;
}

/* Instant pre-scroll before a tap: on the WebKit projects Playwright's own
   "scrolling into view" step can hang while the collapsing room header shifts
   the layout (modA-chat-controls.spec.js, 2026-07-21). */
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.click();
}

/* Every patient reply now waits for release(). */
async function holdReplies(student) {
  await student.evaluate(() => {
    // @ts-ignore — test-only handles on the page
    window.__heldReplies = [];
    // @ts-ignore
    window.modALLMRuntime.bridge.setCallable(() => new Promise((resolve) => {
      // @ts-ignore
      window.__heldReplies.push((reply) => resolve({ data: { reply, state: "ok" } }));
    }));
  });
}

/* Release the oldest held reply. Throws — failing the test — when none is
   held, so a turn that never reached the backend cannot pass silently. */
async function release(student, reply) {
  await student.evaluate((r) => {
    // @ts-ignore
    const next = window.__heldReplies.shift();
    if (!next) throw new Error("no pending reply to release");
    next(r);
  }, reply);
}

const secondsIn = async (locator) => Number(((await locator.textContent()) || "").trim().split(/\s+/)[0]);

test.describe("Module A chat — waiting for a reply", () => {
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

  test("dots in the asked thread, a ticking count, both gone on the reply; still under reduced motion", async ({ page, context }) => {
    test.setTimeout(120_000);
    const student = await reachStage1(page, context);
    await student.evaluate(() => { /* @ts-ignore */ window.CANAMED_CHAT_WAIT_HINT_MS = 0; });
    await holdReplies(student);

    const input = student.locator("#modA-chat-input");
    const send = student.locator("#modA-chat-send");
    const status = student.locator("#modA-chat-status");
    const elapsed = status.locator(".moda-chat-elapsed");
    const transcript = student.locator("#modA-chat-transcript");
    const dots = transcript.locator(".moda-chat-typing");
    const thread = transcript.locator('.moda-chat-thread[data-character="patient"]');

    await input.fill("Where exactly does it hurt?");
    await tap(send);

    // Pending: exactly one set of dots, in the asked thread, BELOW the question,
    // hidden from assistive tech, and not counted as a reply bubble.
    await expect(thread.locator(".moda-chat-typing")).toBeVisible({ timeout: 10_000 });
    await expect(dots).toHaveCount(1);
    await expect(dots).toHaveAttribute("aria-hidden", "true");
    await expect(dots.locator(".moda-chat-typing-dot")).toHaveCount(3);
    await expect(thread.locator(".moda-chat-bub-user")).toHaveText("Where exactly does it hurt?");
    expect(await thread.evaluate((el) => el.lastElementChild && el.lastElementChild.className)).toBe("moda-chat-typing");
    await expect(thread.locator(".moda-chat-bub-assistant")).toHaveCount(0);
    await expect(transcript).toHaveAttribute("aria-busy", "true");
    await expect(input).toBeDisabled();
    await expect(status).toContainText("is thinking…");
    expect(await dots.locator(".moda-chat-typing-dot").first()
      .evaluate((el) => getComputedStyle(el).animationName)).toBe("moda-typing");

    // The count joins the line (aria-hidden: the line is a live region) and ticks.
    await expect(elapsed).toHaveText(/^\s\d+ s$/, { timeout: 5_000 });
    await expect(elapsed).toHaveAttribute("aria-hidden", "true");
    await expect(status).toHaveText(/is thinking… \d+ s$/);
    const first = await secondsIn(elapsed);
    await expect.poll(() => secondsIn(elapsed), { timeout: 5_000 }).toBeGreaterThan(first);

    // A teammate's question landing in the same thread keeps the dots below it.
    await student.evaluate(() => {
      // @ts-ignore — page globals (LOCAL mode)
      window.db.ref(window.roomChatPath(window.sessionNum, window.myRoom))
        .push({ role: "user", content: "teammate: and since when?", at: Date.now() });
    });
    await expect(thread.locator(".moda-chat-bub-user")).toHaveCount(2, { timeout: 10_000 });
    expect(await thread.evaluate((el) => el.lastElementChild && el.lastElementChild.className)).toBe("moda-chat-typing");

    // The reply settles the turn: dots and count gone, the reply rendered, the
    // chat usable again — and nothing keeps writing the line afterwards.
    await release(student, "Just here, in my lower back.");
    await expect(dots).toHaveCount(0);
    await expect(thread.locator(".moda-chat-bub-assistant")).toHaveText("Just here, in my lower back.", { timeout: 10_000 });
    await expect(elapsed).toHaveCount(0);
    await expect(status).not.toContainText("thinking");
    await expect(input).toBeEnabled();
    await expect(transcript).toHaveAttribute("aria-busy", "false");
    const settled = await status.textContent();
    await student.waitForTimeout(2_200);
    expect(await status.textContent(), "the per-second count stopped with the turn").toBe(settled);

    // Reduced motion: the same cue, standing still.
    await student.emulateMedia({ reducedMotion: "reduce" });
    await input.fill("Any fever?");
    await tap(send);
    await expect(dots).toHaveCount(1, { timeout: 10_000 });
    expect(await dots.locator(".moda-chat-typing-dot").first()
      .evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await release(student, "No fever.");
    await expect(dots).toHaveCount(0);
    await expect(thread.locator(".moda-chat-bub-assistant").last()).toHaveText("No fever.", { timeout: 10_000 });
    await student.close();
  });

  test("switching character mid-wait leaves no dots in the other thread; destroy() mid-wait stops the count", async ({ page, context }) => {
    test.setTimeout(120_000);
    const student = await reachStage1(page, context);
    await student.evaluate(() => { /* @ts-ignore */ window.CANAMED_CHAT_WAIT_HINT_MS = 0; });
    await holdReplies(student);
    await student.evaluate(({ cast, caseObj }) => {
      // @ts-ignore — republish a cast the way applySectionContent() does
      window.CURRENT_SCENARIO_CHARACTERS = cast;
      // @ts-ignore
      window.CASE = caseObj;
      window.dispatchEvent(new CustomEvent("canamed:castchange"));
    }, { cast: CAST, caseObj: CASE });

    const input = student.locator("#modA-chat-input");
    const send = student.locator("#modA-chat-send");
    const status = student.locator("#modA-chat-status");
    const elapsed = status.locator(".moda-chat-elapsed");
    const transcript = student.locator("#modA-chat-transcript");
    const dots = transcript.locator(".moda-chat-typing");
    const chips = student.locator("#modA-chat-cast .moda-chat-chip");
    const patientThread = transcript.locator('.moda-chat-thread[data-character="patient"]');
    const motherThread = transcript.locator('.moda-chat-thread[data-character="mother"]');
    await expect(chips).toHaveCount(2);

    // Ask the mother, then turn to the patient while she is still "thinking".
    await tap(chips.nth(1));
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await input.fill("How is your own mood?");
    await tap(send);
    await expect(motherThread.locator(".moda-chat-typing")).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText("Mayumi's Mother is thinking…");

    await tap(chips.nth(0));
    await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(motherThread).toHaveJSProperty("hidden", true);
    await expect(patientThread.locator(".moda-chat-typing")).toHaveCount(0);
    await expect(dots).toHaveCount(1);   // still the mother's, hidden with her thread
    await expect(status).toContainText("Mayumi's Mother is thinking…", { timeout: 1_000 });

    await release(student, "MOTHER-LINE: I feel tired every spring.");
    await expect(dots).toHaveCount(0);
    await expect(motherThread.locator(".moda-chat-bub-assistant")).toHaveText(/^MOTHER-LINE/, { timeout: 10_000 });
    await expect(patientThread.locator(".moda-chat-typing")).toHaveCount(0);
    await expect(student.locator('#modA-chat-cast .moda-chat-chip[data-character="mother"] .moda-chat-chip-badge'))
      .toHaveText("1");
    await expect(input).toBeEnabled();

    // The panel torn down mid-wait (a room switch, a re-entry): the dots and
    // the count come down with it, and no interval keeps writing the line.
    await input.fill("How are you sleeping?");
    await tap(send);
    await expect(patientThread.locator(".moda-chat-typing")).toBeVisible({ timeout: 10_000 });
    await expect(elapsed).toHaveText(/^\s\d+ s$/, { timeout: 5_000 });
    await student.evaluate(() => { /* @ts-ignore */ window.modALLMRuntime.destroy(); });
    await expect(dots).toHaveCount(0);
    await expect(elapsed).toHaveCount(0);
    const frozen = await status.textContent();
    await student.waitForTimeout(2_200);
    expect(await status.textContent(), "no ticker survives destroy()").toBe(frozen);
    await expect(elapsed).toHaveCount(0);
    await student.close();
  });
});
