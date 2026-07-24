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

  test("a chat character (persona) authors into the JSON preview", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/scenario-author.html");
    await expect(page.locator("#list-characters")).toBeAttached();

    await page.locator('.add-btn[data-add="characters"]').click();
    const chRow = page.locator("#list-characters > *").first();
    // id / role / module / present are the first four text inputs of the row.
    const texts = chRow.locator('input[type="text"]');
    await texts.nth(0).fill("patient"); // id

    // Name (first trio in the row) EN input.
    const nameTrio = chRow.locator(".trio-block", {
      has: page.locator(".trio-label", { hasText: "Name" })
    }).first();
    await nameTrio.locator("input").first().fill("Mrs Okafor");

    // Persona (its own trio) EN textarea.
    const personaTrio = chRow.locator(".trio-block", {
      has: page.locator(".trio-label", { hasText: "Persona" })
    }).first();
    await personaTrio.locator("textarea").first().fill("You are Mrs Okafor, here about chest pain.");

    const json = JSON.parse(await page.locator("#json-preview").inputValue());
    const ch = json.characters.find((c) => c.id === "patient");
    expect(ch.name.en).toBe("Mrs Okafor");
    // EN-only persona stays a plain string (no fr/ja typed).
    expect(ch.persona).toBe("You are Mrs Okafor, here about chest pain.");

    expect(errors, "author page must edit characters without JS errors").toEqual([]);
  });
});

/* Phase 5b — "start from" shortcuts. Both buttons guard with a NATIVE
   window.confirm (the pattern this standalone page already uses for "Reset
   form" / delete). Playwright auto-DISMISSES dialogs, so every test here must
   accept them or the click is a silent no-op. */
test.describe("Scenario author — Phase 5b start-from shortcuts", () => {
  test("Start from skeleton loads a worked example that validates clean", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await expect(page.locator("#btn-skeleton")).toBeVisible();
    await page.locator("#btn-skeleton").click();

    // The form is populated from the skeleton.
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => (await preview.inputValue()).includes('"new-scenario"'))
      .toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.id).toBe("new-scenario");
    expect(json.name.en).toBeTruthy();
    expect(json.case.labs[0].key).toBe(true);
    expect(json.decisions[0].options.some((o) => o.correct)).toBe(true);

    // …and it VALIDATES — the whole point of a starter template is that the
    // facilitator doesn't land on a form that immediately reports errors.
    await page.locator("#btn-validate").click();
    const out = page.locator("#validation-output");
    await expect(out).toHaveClass(/success/);
    await expect(out).toContainText("Validation passed");

    expect(errors, "skeleton must load without JS errors").toEqual([]);
  });

  test("Clone a built-in copies a shipped scenario under a NEW id", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await page.locator("#btn-clone-builtin").click();

    // case-content.js (the built-ins) is fetched lazily on first use, so the
    // picker only appears once that script has loaded — allow for the download.
    const picker = page.locator("#builtin-picker");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    const first = picker.locator(".scenario-cloud-list button").first();
    await expect(first).toBeVisible();
    await first.click();

    // The clone carries a -copy id, so a later save cannot overwrite the
    // built-in it came from, and the picker closes.
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => /-copy"/.test(await preview.inputValue()))
      .toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.id).toMatch(/-copy$/);
    await expect(picker).toHaveCount(0);

    expect(errors, "cloning a built-in must not throw").toEqual([]);
  });
});
