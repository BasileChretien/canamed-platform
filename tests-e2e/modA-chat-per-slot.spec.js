/* tests-e2e/modA-chat-per-slot.spec.js
 *
 * The Module A chat store is PER SLOT: a session built from TWO PBL sections
 * keeps two separate conversations, two separate award maps and two sets of
 * score events. Before this change the room's one roomChat tree replayed
 * section 1's conversation inside section 2, and a scoring family that fired
 * in section 1 could never fire in section 2.
 *
 * A REAL two-section room: the facilitator picks the SAME PBL section twice
 * in the create form (the picker allows it — slots are keyed by position),
 * a student joins, the room is advanced through both, and the student walks
 * Back. Two copies of one section is the strongest case: identical cast,
 * identical scoring families, so the only thing keeping the two apart is the
 * slot. (Only the chronic-pain workup ships chat scoring families today, so
 * a two-case pick could not prove the per-slot dedupe.) LOCAL mode (stub
 * patient, LocalDB), on chromium + the three mobile projects.
 *
 * What a green run proves, in order:
 *   1. section 1: a question and its reply render there;
 *   2. advancing to section 2 shows the SAME patient with an EMPTY transcript;
 *   3. a question there renders in section 2 only, and every stored turn
 *      carries the slot it was spoken in;
 *   4. the same scoring family earns in BOTH sections, each under its own
 *      per-slot awarded node and its own slot-prefixed score event;
 *   5. walking Back restores section 1's two bubbles, and section 2's are gone.
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

const PICK = ["chronic-pain-pbl", "chronic-pain-pbl"];

/* Scores the malignancy red-flag family (qr_rf_malignancy) — asked in BOTH
   sections, so the per-slot dedupe is exercised, not just the transcript. */
const QUESTION = "Have you lost weight recently?";
const FAMILY = "qr_rf_malignancy";

async function createTwoSectionSession(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
  for (const id of PICK) {
    await page.selectOption("#splash-section-add", id);
    await page.locator("#splash-section-add-btn").click();
  }
  await expect(page.locator("#splash-section-list .splash-section-row")).toHaveCount(2);
  await page.locator("#splash-create-name").fill("Per-slot Fac");
  await page.locator("#splash-create-pass").fill("slot-pw");
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
  await tab2.locator("#name-input").fill("Per-slot Student");
  const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await tab2.locator("#uni-input").selectOption(uni);
  await tab2.locator("#consent-workshop").check();
  const joinBtn = tab2.locator("#join-btn");
  await expect(joinBtn).toBeEnabled({ timeout: 5000 });
  await joinBtn.click();
  await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });
  return tab2;
}

/* Instant pre-scroll then click — the WebKit projects can hang in Playwright's
   own scroll-into-view when the collapsing room header shifts the layout. */
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.click();
}

async function ask(student, text) {
  const input = student.locator("#modA-chat-input");
  await input.fill(text);
  await tap(student.locator("#modA-chat-send"));
  await expect(input).toHaveValue("", { timeout: 10_000 });
}

const bubbles = (student) => student.locator("#modA-chat-transcript .moda-chat-bub");

test.describe("Module A chat — per-slot store", () => {
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

  test("two PBL sections keep two conversations, two award maps and two sets of score events", async ({ page, context }) => {
    test.setTimeout(150_000);
    const code = await createTwoSectionSession(page);
    const student = await joinAsStudent(context, code);

    await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
    await page.locator("#start-session-btn").click();
    await expect(student.locator("#app")).toBeVisible({ timeout: 15_000 });
    const advance = page.getByRole("button", { name: /^Advance\s*→?$/ }).first();

    // 1. Section 1 — chronic pain, Mr Lefebvre.
    await advance.click();
    await expect(student.locator("#stage-1")).toBeVisible({ timeout: 10_000 });
    await expect(student.locator("#modA-chat-panel")).toBeVisible({ timeout: 10_000 });
    expect(await student.evaluate(() => window.modALLMRuntime.getSlot())).toBe(1);
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Lefebvre/);
    await ask(student, QUESTION);
    await expect(bubbles(student)).toHaveCount(2, { timeout: 10_000 });
    await expect(bubbles(student).first()).toHaveText(QUESTION);

    // 2. Section 2 — the same workup again — starts EMPTY.
    await advance.click();
    await expect(student.locator("#stage-1")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => student.evaluate(() => window.modALLMRuntime.getSlot()), { timeout: 10_000 }).toBe(2);
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Lefebvre/);
    await expect(bubbles(student)).toHaveCount(0);

    // 3. A question here lands in section 2 only, and every stored turn is
    //    tagged with its slot.
    await ask(student, QUESTION);
    await expect(bubbles(student)).toHaveCount(2, { timeout: 10_000 });
    const stored = await student.evaluate(async () => {
      const snap = await window.db.ref(window.roomChatPath(window.sessionNum, window.myRoom)).once("value");
      return Object.values(snap.val() || {}).map(t => [t.role, t.slot]);
    });
    expect(stored).toEqual([["user", 1], ["assistant", 1], ["user", 2], ["assistant", 2]]);

    // 4. The same family earned in BOTH sections: its own awarded node per
    //    slot, its own slot-prefixed score event.
    const scoring = await student.evaluate(async () => {
      const base = window.sPath("rooms/" + window.myRoom);
      const read = async (p) => (await window.db.ref(base + p).once("value")).val() || {};
      return {
        awarded1: Object.keys(await read("/sections/1/scoring/awarded")),
        awarded2: Object.keys(await read("/sections/2/scoring/awarded")),
        legacy: Object.keys(await read("/moduleA/scoring/awarded")),
        auto: Object.keys(await read("/score/auto"))
      };
    });
    expect(scoring.awarded1, "section 1 earned the malignancy family").toContain(FAMILY);
    expect(scoring.awarded2, "section 2 earned it TOO — dedupe is per slot").toContain(FAMILY);
    expect(scoring.legacy, "the module-literal node is no longer written").toEqual([]);
    expect(scoring.auto).toContain("chatA_s1_" + FAMILY);
    expect(scoring.auto).toContain("chatA_s2_" + FAMILY);
    expect(scoring.auto.some(id => /^chatA_(?!s\d+_)/.test(id)), "no unnamespaced chat event").toBe(false);

    // 5. Back to section 1: its two bubbles, and only those.
    await tap(student.locator("#prev-btn"));
    await expect.poll(() => student.evaluate(() => window.modALLMRuntime.getSlot()), { timeout: 10_000 }).toBe(1);
    await expect(student.locator("#modA-chat-input")).toHaveAttribute("placeholder", /Lefebvre/);
    await expect(bubbles(student)).toHaveCount(2, { timeout: 10_000 });
    await expect(bubbles(student).first()).toHaveText(QUESTION);
    expect(await student.evaluate(() => window.modALLMRuntime.bridge.getSlot())).toBe(1);
  });
});
