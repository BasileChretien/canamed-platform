/* tests-e2e/mayumi-session.spec.js
 *
 * "A Difficult Child (Mayumi)" — the six-section PBL, driven end to end in a
 * REAL LOCAL-mode room: the facilitator picks all six sections in reveal
 * order, a student joins, and the room is advanced through them. This is the
 * integration of everything built for it — the switchboard (#389), the
 * per-slot chat store (#390) and the content (mayumi-seed.js) — asserted in
 * one session, on chromium + the three mobile projects.
 *
 * What a green run proves, in order:
 *   1. the picker offers the six sections and a six-section session runs
 *      Welcome + 6 + Wrap-up;
 *   2. section 1 offers the PARENTS only (two chips, Mayumi absent) and the
 *      chat is addressed to the father, not to a missing patient;
 *   3. a question to the father is answered from HIS facts and scores;
 *   4. section 3 offers all three; a family-history question to the MOTHER
 *      is answered from her facts and earns the askOf family that the same
 *      words at Mayumi would not;
 *   5. section 4 carries the examination and the MFQ, section 5 the results;
 *   6. every section's transcript is its own (per slot), and Back restores it.
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

const PICK = ["mayumi-1-pbl", "mayumi-2-pbl", "mayumi-3-pbl", "mayumi-4-pbl", "mayumi-5-pbl", "mayumi-6-pbl"];

async function createSession(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  // 1. the picker offers the six, in reveal order.
  const offered = await page.locator("#splash-section-add option")
    .evaluateAll(els => els.map(e => e.value).filter(v => v.startsWith("mayumi")));
  expect(offered).toEqual(PICK);
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
  for (const id of PICK) {
    await page.selectOption("#splash-section-add", id);
    await page.locator("#splash-section-add-btn").click();
  }
  await expect(page.locator("#splash-section-list .splash-section-row")).toHaveCount(6);
  await page.locator("#splash-create-name").fill("Mayumi Tutor");
  await page.locator("#splash-create-pass").fill("mayumi-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
  const code = (await codeNode.textContent()).trim();
  await page.locator("#splash-go-admin").click();
  await expect(page.locator("#admin-app")).toBeVisible();
  return code;
}

async function joinAsStudent(context, code) {
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
  await tab2.locator("#name-input").fill("Mayumi Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  const joinBtn = tab2.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 5000 });
  await joinBtn.click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab2;
}

async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.click();
}

/* Send with Enter (the chat's keyboard path), not the Send button: this spec
   is about the content and the routing, and the button's tap geometry on the
   phone viewports is already proven by modA-chat-controls.spec.js and
   modA-switchboard.spec.js. */
async function ask(student, text) {
  const input = student.locator("#modA-chat-input");
  await input.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("", { timeout: 10_000 });
}

const slotOf = (student) => student.evaluate(() => window.modALLMRuntime.getSlot());

/* Advance the room FROM stage index k. The per-room "Advance →" button captures
   the stage it was rendered at and setRoomStage() refuses a stale `from`, so a
   click that lands before the dashboard has re-rendered after the previous
   advance is silently dropped. Wait for the row to show the current stage
   first (the label is 1-based: stage index k reads "Stage k+1/8"). */
async function advanceFrom(page, k) {
  await expect(page.locator("#admin-app")).toContainText("Stage " + (k + 1) + "/8", { timeout: 10_000 });
  await page.getByRole("button", { name: /^Advance\s*→?$/ }).first().click();
}
const chips = (student) => student.locator("#modA-chat-cast .moda-chat-chip");
const thread = (student, who) => student.locator(`#modA-chat-transcript .moda-chat-thread[data-character="${who}"]`);

test.describe("A Difficult Child (Mayumi) — six sections, end to end", () => {
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

  test("parents-only steps, the switchboard, askOf scoring, exam + results, per-slot transcripts", async ({ page, context }) => {
    test.setTimeout(240_000);
    const code = await createSession(page);
    const student = await joinAsStudent(context, code);

    await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
    await page.locator("#start-session-btn").click();
    await expect(student.locator("#app")).toBeVisible({ timeout: 15_000 });
    const flow = await student.evaluate(() => window.stageFlow());
    expect(flow).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // 2. Section 1 — parents only.
    await advanceFrom(page, 0);
    await expect(student.locator("#stage-1")).toBeVisible({ timeout: 10_000 });
    await expect(student.locator("#modA-chat-panel")).toBeVisible({ timeout: 10_000 });
    expect(await slotOf(student)).toBe(1);
    await expect(chips(student)).toHaveCount(2);
    await expect(chips(student).nth(0)).toContainText("father");
    await expect(chips(student).nth(0)).toHaveAttribute("aria-pressed", "true");
    expect(await student.evaluate(() => window.modALLMRuntime.getCharacter())).toBe("father");
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Mayumi's father/);

    // 3. A question the father can answer from his facts, and which scores.
    await ask(student, "Why isn't Mayumi with you today?");
    await expect(thread(student, "father").locator(".moda-chat-bub-assistant")).toHaveText(/refused to come/, { timeout: 10_000 });
    await expect(thread(student, "father").locator(".moda-chat-score.is-award")).toHaveCount(1);

    // Section 2 — still parents only, an EMPTY transcript of its own.
    await advanceFrom(page, 1);
    await expect.poll(() => slotOf(student), { timeout: 10_000 }).toBe(2);
    await expect(chips(student)).toHaveCount(2);
    expect(await student.locator("#modA-chat-transcript .moda-chat-bub").count()).toBe(0);

    // 4. Section 3 — the home visit: all three, Mayumi first.
    await advanceFrom(page, 2);
    await expect.poll(() => slotOf(student), { timeout: 10_000 }).toBe(3);
    await expect(chips(student)).toHaveCount(3);
    await expect(chips(student).nth(0)).toContainText("Mayumi");
    await expect(chips(student).nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Ask Mayumi a question/);

    // The same family-history question at Mayumi scores nothing…
    await ask(student, "Is there any depression in the family?");
    await expect(thread(student, "patient").locator(".moda-chat-bub-assistant")).toHaveCount(1, { timeout: 10_000 });
    expect(await thread(student, "patient").locator(".moda-chat-score.is-award").count()).toBe(0);
    // …and at the MOTHER it is answered from her facts and earns the family.
    await tap(chips(student).nth(2));
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Mayumi's mother/);
    await ask(student, "Is there any depression in the family?");
    await expect(thread(student, "mother").locator(".moda-chat-bub-assistant")).toHaveText(/grandmother/, { timeout: 10_000 });
    await expect(thread(student, "mother").locator(".moda-chat-score.is-award")).toHaveCount(1);
    const awarded3 = await student.evaluate(async () => {
      const base = window.sPath("rooms/" + window.myRoom);
      return Object.keys((await window.db.ref(base + "/sections/3/scoring/awarded").once("value")).val() || {});
    });
    expect(awarded3).toContain("q3_family_psych");

    // 5. Section 4 — the examination and the MFQ; section 5 — the results.
    await advanceFrom(page, 3);
    await expect.poll(() => slotOf(student), { timeout: 10_000 }).toBe(4);
    const s4 = await student.evaluate(() => ({
      exam: window.CASE.exam.length, labs: window.CASE.labs.map(l => l.q.en)
    }));
    expect(s4.exam).toBe(6);
    expect(s4.labs.some(q => /Mood and Feelings Questionnaire/.test(q))).toBe(true);
    await advanceFrom(page, 4);
    await expect.poll(() => slotOf(student), { timeout: 10_000 }).toBe(5);
    const s5 = await student.evaluate(() => window.CASE.labs.map(l => l.q.en).join(" | "));
    for (const k of ["Full blood count", "Thyroid", "Monospot", "MRI", "EEG"]) expect(s5).toMatch(new RegExp(k));

    // 6. Back to section 3: its two conversations, and only those.
    for (let i = 0; i < 2; i++) await tap(student.locator("#prev-btn"));
    await expect.poll(() => slotOf(student), { timeout: 10_000 }).toBe(3);
    await expect(chips(student)).toHaveCount(3);
    expect(await thread(student, "mother").locator(".moda-chat-bub").count()).toBe(2);
    expect(await thread(student, "patient").locator(".moda-chat-bub").count()).toBe(2);
    expect(await thread(student, "father").locator(".moda-chat-bub").count()).toBe(0);
  });
});
