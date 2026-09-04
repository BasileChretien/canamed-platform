/* tests-e2e/modA-switchboard.spec.js
 *
 * The Module A chat switchboard (scenario-characters design, slice 2): when a
 * section declares several Module A characters, the student picks who they
 * are speaking to and each character is its own thread. LOCAL mode
 * (hermetic, bridge in stub mode, LocalDB), across chromium + the three
 * mobile projects per the CLAUDE.md standing instruction on Module A UI.
 *
 * Runs in a REAL room (create → join → start → advance, the same bootstrap as
 * modA-chat-controls.spec.js) so that visibility, tap targets and the
 * hidden/shown thread switching are asserted on a rendered stage, not on a
 * panel mounted under the splash. The built-in scenario has one patient; the
 * plural cast is injected on the student's tab through the same globals
 * applySectionContent() republishes, followed by the same event it fires.
 *
 * What a green run proves, in order:
 *   1. the built-in single-character section shows NO chips (no new chrome
 *      for every existing scenario);
 *   2. a three-character cast shows three chips, the patient pressed;
 *   3. addressing the mother re-targets the placeholder, sends her the
 *      question, renders the exchange in HER thread only, and persists the
 *      turn with `character: "mother"`;
 *   4. the patient's thread is untouched by that exchange;
 *   5. a reply for a character who is not being addressed dots their chip
 *      and stays out of the visible thread;
 *   6. a cast change (the session moved to another section) re-renders the
 *      chips and falls back to the new section's patient.
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

const CAST = [
  { id: "patient", role: "patient", module: ["A"], present: "start",
    name: "Mayumi", blurb: "15-year-old patient", persona: "You are Mayumi, 15, guarded and sullen." },
  { id: "mother", role: "relative", module: ["A"], present: "start",
    name: "Mayumi's Mother", blurb: "warm but anxious", persona: "You are Mayumi's mother." },
  { id: "father", role: "relative", module: ["A"], present: "start",
    name: "Mayumi's Father", blurb: "practical, a little defensive", persona: "You are Mayumi's father." }
];

const CASE = {
  history: [
    { q: { en: "How are you sleeping?" }, a: { en: "PATIENT-LINE: I can't sleep unless I drink." } },
    { q: { en: "How is your own mood, how are you sleeping?" }, who: "mother",
      a: { en: "MOTHER-LINE: Every spring and autumn I feel tired and down." } }
  ],
  exam: [], labs: [], prompts: []
};

/* Facilitator creates + starts a session; a participant joins in a SECOND
   tab and the room is advanced to Stage 1. Mirrors modA-chat-controls.spec.js
   (the participant tab re-pins LOCAL mode and skips the tours + the chat's
   one-time consent, which that spec covers on its own). */
async function reachStage1(page, context) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Switchboard Fac");
  await page.locator("#splash-create-pass").fill("swb-pw");
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
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
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
  await tab2.locator("#name-input").fill("Switchboard Student");
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

/* Tap a control on the student page. Instant pre-scroll first: on the WebKit
   projects Playwright's own pre-click "scrolling into view" step can hang —
   the collapsing room header shifts the layout mid-scroll, so the target never
   settles (observed on mobile-ipad, 2026-07-21, modA-chat-controls.spec.js).
   Centring the element ourselves makes that step a no-op. */
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.click();
}

/* Republish a cast (and case) the way applySectionContent() does. */
async function publishCast(student, cast, caseObj) {
  await student.evaluate(({ cast, caseObj }) => {
    window.CURRENT_SCENARIO_CHARACTERS = cast;
    if (caseObj) window.CASE = caseObj;
    window.dispatchEvent(new CustomEvent("canamed:castchange"));
  }, { cast, caseObj });
}

test.describe("Module A chat switchboard", () => {
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

  test("single-character section: no chips; plural cast: chips, per-character threads, tagged persistence, badge, cast change", async ({ page, context }) => {
    test.setTimeout(120_000);
    const student = await reachStage1(page, context);
    const cast = student.locator("#modA-chat-cast");
    const chips = student.locator("#modA-chat-cast .moda-chat-chip");
    const input = student.locator("#modA-chat-input");

    // 1. the built-in scenario has ONE patient: no chip row at all.
    await expect(cast).toBeHidden();
    expect(await chips.count()).toBe(0);
    await expect(input).toHaveAttribute("placeholder", /Mr Lefebvre/);

    // 2. a three-member cast arrives with the section.
    await publishCast(student, CAST, CASE);
    await expect(cast).toBeVisible();
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.nth(0)).toContainText("Mayumi");
    await expect(chips.nth(1)).toContainText("Mayumi's Mother");
    await expect(input).toHaveAttribute("placeholder", "Ask Mayumi a question…");
    for (let i = 0; i < 3; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box && box.height, "chip keeps a usable tap height").toBeGreaterThanOrEqual(24);
    }

    // 3. address the mother.
    await tap(chips.nth(1));
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(input).toHaveAttribute("placeholder", "Ask Mayumi's Mother a question…");

    await input.fill("How are you sleeping?");
    await tap(student.locator("#modA-chat-send"));

    const motherThread = student.locator('#modA-chat-transcript .moda-chat-thread[data-character="mother"]');
    const patientThread = student.locator('#modA-chat-transcript .moda-chat-thread[data-character="patient"]');
    await expect(motherThread.locator(".moda-chat-bub-assistant")).toHaveText(/^MOTHER-LINE/, { timeout: 10_000 });
    await expect(motherThread.locator(".moda-chat-bub-user")).toHaveText("How are you sleeping?");
    await expect(motherThread).toBeVisible();

    // 4. the patient's thread has none of it, and is hidden while the mother
    //    is addressed.
    await expect(patientThread).toBeHidden();
    expect(await patientThread.locator(".moda-chat-bub").count()).toBe(0);

    // The persisted turns carry the addressee (what a teammate's client and
    // the export read). Read from the store, not the DOM.
    const stored = await student.evaluate(async () => {
      const snap = await window.db.ref(window.roomChatPath(window.sessionNum, window.myRoom)).once("value");
      return Object.values(snap.val() || {}).map(t => [t.role, t.character || null]);
    });
    expect(stored).toEqual([["user", "mother"], ["assistant", "mother"]]);

    // Back to the patient: her (empty) thread is un-hidden, the mother's hides,
    // and the bridge is re-addressed. (toBeVisible() would report an EMPTY
    // flex column as hidden — zero box — so assert the attribute itself.)
    await tap(chips.nth(0));
    await expect(patientThread).toHaveJSProperty("hidden", false);
    await expect(motherThread).toHaveJSProperty("hidden", true);
    expect(await student.evaluate(() => window.modALLMRuntime.bridge.getCharacter())).toBe("patient");

    // 5. a teammate's exchange with the FATHER lands while this student is
    //    addressing the patient: it routes to the father's thread and flags
    //    his chip, and never appears in the visible thread.
    await student.evaluate(() => {
      const ref = window.db.ref(window.roomChatPath(window.sessionNum, window.myRoom));
      ref.push({ role: "user", content: "teammate to father", at: Date.now(), character: "father" });
      ref.push({ role: "assistant", content: "FATHER-LINE: reply", at: Date.now(), character: "father" });
    });
    const fatherChip = student.locator('#modA-chat-cast .moda-chat-chip[data-character="father"]');
    await expect(fatherChip.locator(".moda-chat-chip-badge")).toHaveText("1", { timeout: 10_000 });
    expect(await patientThread.locator(".moda-chat-bub").count()).toBe(0);
    await tap(fatherChip);
    await expect(fatherChip.locator(".moda-chat-chip-badge")).toBeHidden();
    await expect(student.locator('#modA-chat-transcript .moda-chat-thread[data-character="father"] .moda-chat-bub-assistant'))
      .toHaveText(/^FATHER-LINE/);

    // 6. the session moves to a section whose cast is the patient alone: the
    //    chips disappear and the chat is addressed to that section's patient.
    await publishCast(student, [{ id: "patient", role: "patient", name: "Mrs Tanaka", persona: "…" }], null);
    await expect(cast).toBeHidden();
    await expect(input).toHaveAttribute("placeholder", /Mrs Tanaka/);
    expect(await student.evaluate(() => window.modALLMRuntime.bridge.getCharacter())).toBe("patient");
  });
});
