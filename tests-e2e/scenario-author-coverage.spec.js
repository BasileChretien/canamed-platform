/* tests-e2e/scenario-author-coverage.spec.js
 *
 * Phase 3 (authoring coverage) — the scenario-author form can now author the
 * Module A LLM-chat scoring families (moduleA_questions +
 * moduleA_question_penalties) and the optional per-family `unlocks` reveal-id,
 * which were previously JSON-hand-edit only. This drives the real author page
 * in a browser and asserts the new sections render, add rows, and flow into the
 * live JSON preview.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is registered
 * in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Scenario author — Phase 3 chat-scoring authoring", () => {
  test("moduleA_questions + moduleA_question_penalties sections author into the JSON preview", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/scenario-author.html");

    // The two new sections + their add buttons exist.
    await expect(page.locator("#list-scoringAQ")).toBeAttached();
    await expect(page.locator("#list-scoringAQP")).toBeAttached();
    const addQ = page.locator('.add-btn[data-add="scoringAQ"]');
    const addQP = page.locator('.add-btn[data-add="scoringAQP"]');
    await expect(addQ).toBeVisible();
    await expect(addQP).toBeVisible();

    // Add a chat-question family; fill its id, a keyword stem, and an unlocks id.
    await addQ.click();
    const qRow = page.locator("#list-scoringAQ .dyn-list, #list-scoringAQ > *").first();
    await qRow.locator('input[type="text"]').first().fill("chatfam1");
    await qRow.locator('input[placeholder^="e.g. activ"]').fill("how long, onset");
    await qRow.locator('input[placeholder^="e.g. labs:0"]').fill("history:0");

    // Add a chat-penalty family too.
    await addQP.click();
    const qpRow = page.locator("#list-scoringAQP > *").first();
    await qpRow.locator('input[type="text"]').first().fill("chatpen1");
    await qpRow.locator('input[placeholder^="e.g. activ"]').fill("prescribe, oxycodone");

    // The live JSON preview reflects both families under scoring.*.
    const preview = page.locator("#json-preview");
    await expect.poll(async () => (await preview.inputValue()).includes('"moduleA_questions"')).toBe(true);
    await expect.poll(async () => (await preview.inputValue()).includes('"moduleA_question_penalties"')).toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.scoring.moduleA_questions[0].id).toBe("chatfam1");
    expect(json.scoring.moduleA_questions[0].any).toContain("how long");
    expect(json.scoring.moduleA_questions[0].unlocks).toBe("history:0");
    expect(json.scoring.moduleA_question_penalties[0].id).toBe("chatpen1");
    expect(json.scoring.moduleA_question_penalties[0].any).toContain("oxycodone");

    expect(errors, "author page must load and edit without JS errors").toEqual([]);
  });

  test("decision branch.reveal + unlockWhen author into the JSON preview", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/scenario-author.html");
    await expect(page.locator("#list-decisions")).toBeAttached();

    // The default scenario ships with one decision row + two options.
    const decRow = page.locator("#list-decisions > *").first();
    await decRow.locator('input[type="text"]').first().fill("dec1"); // decision id

    // unlockWhen: min hypotheses (first number in the gate row) + afterDecision.
    await decRow.locator('.unlockwhen-row input[type="number"]').first().fill("2");
    await decRow.locator('.unlockwhen-row input[placeholder^="e.g. dec_"]').fill("dec0");

    // Branch reveal on the first option: the EN textarea of the "Branch reveal" trio.
    const branchTrio = decRow.locator(".trio-block", {
      has: page.locator(".trio-label", { hasText: "Branch reveal" })
    }).first();
    await branchTrio.locator("textarea").first().fill("The patient thanks you and relaxes.");

    // The live JSON preview reflects the modeled gate + branch.
    const preview = page.locator("#json-preview");
    await expect.poll(async () => (await preview.inputValue()).includes('"unlockWhen"')).toBe(true);
    const json = JSON.parse(await preview.inputValue());
    const dec = json.decisions.find((d) => d.id === "dec1");
    expect(dec.unlockWhen.hypotheses).toBe(2);
    expect(dec.unlockWhen.afterDecision).toBe("dec0");
    expect(dec.options[0].branch.reveal.en).toBe("The patient thanks you and relaxes.");
    // The second option was left untouched → no branch key.
    expect(dec.options[1].branch).toBeUndefined();

    expect(errors, "author page must edit decisions without JS errors").toEqual([]);
  });

  test("preTest question authors into the JSON preview", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/scenario-author.html");
    await expect(page.locator("#list-pretest")).toBeAttached();

    await page.locator('.add-btn[data-add="pretest"]').click();
    const qRow = page.locator("#list-pretest > *").first();
    await qRow.locator('input[type="text"]').first().fill("pq1"); // question id

    const stemTrio = qRow.locator(".trio-block", {
      has: page.locator(".trio-label", { hasText: "Question" })
    }).first();
    await stemTrio.locator("textarea").first().fill("What is the red flag?");

    // Tick the first answer option as correct.
    await qRow.locator('input[type="checkbox"]').first().check();

    const json = JSON.parse(await page.locator("#json-preview").inputValue());
    const q = json.preTest.find((x) => x.id === "pq1");
    expect(q.q.en).toBe("What is the red flag?");
    expect(q.options[0].correct).toBe(true);

    expect(errors, "author page must edit the pre-test without JS errors").toEqual([]);
  });
});
