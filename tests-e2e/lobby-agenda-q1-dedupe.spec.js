/* tests-e2e/lobby-agenda-q1-dedupe.spec.js
 *
 * Two content corrections requested 2026-08-17, both about the platform
 * claiming something that isn't true of a given session:
 *
 *   1. The lobby "Today's structure" agenda hardcoded an "Opening
 *      presentation — a Franco-Japanese student pair compares medical
 *      education in France and Japan (10-15 min + questions)" row. What opens
 *      a session varies session to session, and it is a real-world step the
 *      platform neither runs nor knows about, so the row was wrong for most
 *      sessions. The agenda now lists only what the platform runs: the picked
 *      sections (or the scenario's modules) plus the wrap-up.
 *
 *   2. Module A asked for the treatment plan TWICE — the dec_plan vote in the
 *      Decide tab ("What should be the core of this patient's initial
 *      management plan?") and again at the end of the Debate & answers Q1
 *      hint ("Then give the first-line treatment plan you'd propose for …").
 *      Q1 now asks only how the team REACHED its diagnosis; the plan is asked
 *      once, by the scored + workup-gated vote.
 *
 * Both are static-HTML/i18n strings, so they are asserted on the served page
 * without needing a room. Runs on desktop AND the three mobile projects (see
 * the testMatch allowlists in playwright.config.js) per the standing
 * per-device rule in CLAUDE.md — the agenda and the answers column are both
 * reflowed by the mobile stacked layout.
 */

// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Lobby agenda + Q1 de-duplication", () => {
  test("the agenda lists only platform steps — no hardcoded opening presentation", async ({
    page,
  }) => {
    await page.goto("/");

    const agenda = page.locator(".info-list").first();
    await expect(agenda).toHaveCount(1);

    const text = (await agenda.innerText()).replace(/\s+/g, " ");

    // The removed row, in the forms it appeared in.
    expect(text).not.toMatch(/Opening presentation/i);
    expect(text).not.toMatch(/Franco-Japanese/i);
    expect(text).not.toMatch(/compares medical education/i);

    // What must remain: the wrap-up, and the scenario/module rows.
    expect(text).toMatch(/Wrap-up/i);
    await expect(page.locator("#lobby-struct-modA")).toHaveCount(1);
  });

  test("the agenda hint names no first step and no Module A", async ({ page }) => {
    await page.goto("/");
    // The hint directly under the agenda list.
    const hint = page.locator(".info-list ~ .hint").first();
    const text = (await hint.innerText()).replace(/\s+/g, " ");

    // It used to read "Watch and listen during the opening presentation. A
    // facilitator will move your room to Module A when it finishes." — both
    // halves became wrong: the row is gone, and "Module A" is not what a
    // branched or section-picked session starts with.
    expect(text).not.toMatch(/opening presentation/i);
    expect(text).not.toMatch(/Module A/i);
    expect(text).toMatch(/facilitator/i);
  });

  test("Debate & answers Q1 asks for the diagnosis only, not the plan", async ({
    page,
  }) => {
    await page.goto("/");

    const label = page.locator('label[for="answer-input-moduleA-diagnosis"]');
    const hint = page.locator('[data-i18n="modA.answers.bullet.diagnosis.hint"]');
    const input = page.locator("#answer-input-moduleA-diagnosis");

    await expect(label).toHaveCount(1);
    await expect(hint).toHaveCount(1);

    const labelText = (await label.innerText()).replace(/\s+/g, " ");
    const hintText = (await hint.innerText()).replace(/\s+/g, " ");
    const placeholder = (await input.getAttribute("placeholder")) || "";

    // The de-duplicated wording: diagnosis only.
    expect(labelText).toMatch(/working diagnosis/i);
    expect(labelText).not.toMatch(/plan/i);

    // The removed sentence, and the patient name it carried.
    expect(hintText).not.toMatch(/treatment plan/i);
    expect(hintText).not.toMatch(/first-line/i);
    expect(hintText).not.toMatch(/Lefebvre/i);
    // …while the part that earns its place stays.
    expect(hintText).toMatch(/how did your team reach/i);
    expect(hintText).toMatch(/rule out/i);

    expect(placeholder).not.toMatch(/first-line|opioids/i);
  });

  test("the plan question still exists exactly once — in the vote", async ({ page }) => {
    await page.goto("/");
    /* The point of the change was to move the plan question to ONE place, not
       to delete it. dec_plan is scored and workup-gated, and lives in
       case-content.js rather than the served HTML, so assert it there via the
       loaded page globals. Guards against a future "tidy-up" removing the vote
       as well and leaving Module A with no plan question at all. */
    const found = await page.evaluate(() => {
      const list = (typeof window !== "undefined" && window.DECISIONS) || [];
      const d = list.filter((x) => x && x.id === "dec_plan");
      return {
        count: d.length,
        prompt: d[0] && d[0].prompt ? String(d[0].prompt.en || "") : "",
      };
    });

    expect(found.count).toBe(1);
    expect(found.prompt).toMatch(/initial\s+management plan/i);
  });
});
