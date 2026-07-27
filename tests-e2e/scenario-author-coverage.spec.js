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
  test("Start from skeleton → Standard loads a worked example that validates clean", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await expect(page.locator("#btn-skeleton")).toBeVisible();
    // "Start from skeleton" now opens a picker of starter types.
    await page.locator("#btn-skeleton").click();
    const picker = page.locator("#skeleton-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /Standard/ }).click();
    await expect(picker).toHaveCount(0);

    // The form is populated from the standard skeleton.
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

  test("Start from skeleton → Branched loads a valid branched decision-tree scaffold", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await page.locator("#btn-skeleton").click();
    const picker = page.locator("#skeleton-picker");
    await expect(picker).toBeVisible();
    // The branched scenario is a PICKABLE skeleton type.
    await picker.getByRole("button", { name: /Branched/ }).click();
    await expect(picker).toHaveCount(0);

    // The author flipped into branched format: the branch editor appears and the
    // format select reflects it.
    await expect(page.locator("#branched-editor")).toBeVisible();
    await expect(page.locator("#meta-format")).toHaveValue("branched");

    // The exported JSON is a branched scenario with a real decision tree.
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => (await preview.inputValue()).includes('"branched"'))
      .toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.format).toBe("branched");
    expect(Array.isArray(json.decisions)).toBe(true);
    expect(json.decisions.length).toBeGreaterThanOrEqual(1);

    // …and it VALIDATES against the real branched-graph validator — this is the
    // point: a branched skeleton the facilitator can edit, not an error list.
    await page.locator("#btn-validate").click();
    const out = page.locator("#validation-output");
    await expect(out).toHaveClass(/success/);
    await expect(out).toContainText("Validation passed");

    expect(errors, "branched skeleton must load without JS errors").toEqual([]);
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

/* Module-set M5 — authoring a MIXED scenario: Modules A + B plus a branched
   decision case, which the scenario REFERENCES by id (`branchedRef`) rather than
   inlining. The runtime cannot infer a branched module (it has no name field and
   no scoring family), so the explicit `modules` list must be written whenever it
   is ticked. The list of pickable cases is fetched lazily — case-content.js and
   then branched-seed.js, which is where the branched built-in actually lives. */
test.describe("Scenario author — M5 mixed A/B + branched module", () => {
  test("a mixed scenario authors modules + a resolving branchedRef, and validates", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");

    // Start from the standard skeleton so the rest of the form is already valid
    // — this test is about the module set, not about re-typing a whole case.
    await page.locator("#btn-skeleton").click();
    const picker = page.locator("#skeleton-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /Standard/ }).click();
    await expect(picker).toHaveCount(0);

    // A and B are ticked (the skeleton names both) and imply themselves, so no
    // explicit list is written yet.
    await expect(page.locator("#mod-A")).toBeChecked();
    await expect(page.locator("#mod-B")).toBeChecked();
    await expect(page.locator("#mod-branched")).not.toBeChecked();
    const preview = page.locator("#json-preview");
    expect(JSON.parse(await preview.inputValue()).modules).toBeUndefined();

    // The case picker only appears once a branched module is declared.
    await expect(page.locator("#branched-ref-row")).toBeHidden();
    await page.locator("#mod-branched").check();
    await expect(page.locator("#branched-ref-row")).toBeVisible();

    // The pickable cases arrive lazily (case-content.js → branched-seed.js).
    const refSelect = page.locator("#branched-ref");
    await expect(refSelect.locator('option[value="ward-escalation-branched"]'))
      .toBeAttached({ timeout: 30_000 });
    // Only BRANCHED scenarios are offered — a standard built-in must never be.
    await expect(refSelect.locator('option[value="chronic-pain"]')).toHaveCount(0);
    await refSelect.selectOption("ward-escalation-branched");

    // The export carries BOTH keys the runtime needs to compose the module.
    await expect
      .poll(async () => (await preview.inputValue()).includes('"branchedRef"'))
      .toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.modules).toEqual(["A", "B", "branched"]);
    expect(json.branchedRef).toBe("ward-escalation-branched");
    // Composition, not inlining: no branched node leaks into decisions[].
    expect(json.decisions.every((d) => d.module === "A" || d.module === "B")).toBe(true);

    // …and the whole thing VALIDATES — including the reference resolving against
    // the (now downloaded) built-in registry.
    await page.locator("#btn-validate").click();
    const out = page.locator("#validation-output");
    await expect(out).toHaveClass(/success/);
    await expect(out).toContainText("Validation passed");

    expect(errors, "authoring a mixed scenario must not throw").toEqual([]);
  });

  test("a branched module with no case picked is blocked, and unticking clears it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await page.locator("#btn-skeleton").click();
    await page.locator("#skeleton-picker").getByRole("button", { name: /Standard/ }).click();

    await page.locator("#mod-branched").check();
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => (await preview.inputValue()).includes('"branchedRef"'))
      .toBe(true);
    // Declared but unpicked → the export shows the gap and validate blocks it.
    expect(JSON.parse(await preview.inputValue()).branchedRef).toBe("");
    await page.locator("#btn-validate").click();
    const out = page.locator("#validation-output");
    await expect(out).toHaveClass(/error/);
    await expect(out).toContainText("branched decision case is selected but none is picked");

    // Unticking must DROP both keys rather than leaving a stale reference behind
    // (they are modeled now, not carried in the passthrough bag).
    await page.locator("#mod-branched").uncheck();
    await expect(page.locator("#branched-ref-row")).toBeHidden();
    await expect
      .poll(async () => (await preview.inputValue()).includes('"branchedRef"'))
      .toBe(false);
    const json = JSON.parse(await preview.inputValue());
    expect(json.branchedRef).toBeUndefined();
    expect(json.modules).toBeUndefined();

    await page.locator("#btn-validate").click();
    await expect(out).toHaveClass(/success/);

    expect(errors, "toggling the branched module must not throw").toEqual([]);
  });

  test("unticking a named PBL module writes the explicit modules override", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await page.locator("#btn-skeleton").click();
    await page.locator("#skeleton-picker").getByRole("button", { name: /Standard/ }).click();

    // The skeleton's only decision is Module A, so dropping B stays valid.
    await page.locator("#mod-B").uncheck();
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => (await preview.inputValue()).includes('"modules"'))
      .toBe(true);
    expect(JSON.parse(await preview.inputValue()).modules).toEqual(["A"]);

    // Module B is still NAMED by the skeleton; the explicit list is what makes
    // the session skip its stage.
    await page.locator("#btn-validate").click();
    await expect(page.locator("#validation-output")).toHaveClass(/success/);

    expect(errors, "narrowing the module set must not throw").toEqual([]);
  });
});
