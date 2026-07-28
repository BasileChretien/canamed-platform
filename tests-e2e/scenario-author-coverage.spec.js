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
    /* "Start from skeleton" opens a picker of the three SECTION types
       (S5): PBL, Roleplay, Branched Scenario. "Standard - Module A + B" is
       gone, because a skeleton is one SECTION now, not a two-module
       workshop. */
    await page.locator("#btn-skeleton").click();
    const picker = page.locator("#skeleton-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /^Two-module scenario \(legacy\)$/ }).click();
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

    await expect(picker).toHaveCount(0);

    /* S5 / decision 14 — a built-in is a two-module body, so cloning one now
       SPLITS it and asks which section to open. The author edits one section at
       a time; handing over a whole workshop would present two sections' fields
       as if they were one. */
    const split = page.locator("#section-split-picker");
    await expect(split).toBeVisible();
    await split.getByRole("button", { name: /^PBL — / }).click();
    await expect(split).toHaveCount(0);

    /* The id still cannot collide with the built-in it came from: the clone
       carries -copy, and the split half appends its section type. */
    const preview = page.locator("#json-preview");
    await expect
      .poll(async () => /-copy-pbl"/.test(await preview.inputValue()))
      .toBe(true);
    const json = JSON.parse(await preview.inputValue());
    expect(json.id).toMatch(/-copy-pbl$/);
    /* NOT asserting a `modules` key: the author omits one that carries no
       information beyond the module NAMES (M5), and this half names only
       Module A. What must hold is that it is a single PBL section. */
    expect(json.moduleAName.en).toBeTruthy();
    /* The form seeds an EMPTY trio rather than omitting the key, so "not a
       roleplay" means an empty English name, not an absent field. */
    expect((json.moduleBName || {}).en || "").toBe("");

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

    /* Start from the legacy two-module starter: this test is about the MODULE
       SET, not about re-typing a case. S5 made PBL/Roleplay the primary
       skeletons, and the two-module shape survives only while mixed A/B
       authoring is still supported (S6 retires both together). */
    await page.locator("#btn-skeleton").click();
    const picker = page.locator("#skeleton-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /^Two-module scenario \(legacy\)$/ }).click();
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
    await page.locator("#skeleton-picker").getByRole("button", { name: /^Two-module scenario \(legacy\)$/ }).click();

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
    await page.locator("#skeleton-picker").getByRole("button", { name: /^Two-module scenario \(legacy\)$/ }).click();

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

/* ── No horizontal scroll on a phone ───────────────────────────────────────
 * Regression guard for a long-standing (pre-M5) defect: at 375x812 the page
 * measured documentElement.scrollWidth 409 vs clientWidth 375 — a 34px
 * sideways scroll, which on a real phone makes the browser zoom the whole
 * form out to fit.
 *
 * Mechanism, so a future regression is diagnosable: a <fieldset> ships with
 * a UA-default `min-inline-size: min-content`, so it cannot shrink below the
 * widest thing inside it. A <select> is sized by its longest <option> and
 * never wraps, so #meta-format's "Branched — épuré decision tree
 * (English-only)" label (min-content 354px) inflated #meta-section to 396px
 * — wider than the 351px column — and every child stretched with it. The fix
 * is in scenario-author.css: `min-inline-size: 0` on the section plus a
 * `max-width: 100%` cap on the controls.
 *
 * The first two cases deliberately narrow the viewport themselves rather than
 * trusting the project's device width: at iPad Pro 11 (834px) the old bug was
 * invisible, so a native-viewport-only check would have been a green test over
 * a broken page. The third runs at each project's NATIVE width, so the
 * per-device standing instruction is met on the real emulated devices.
 */
test.describe("Scenario author — no horizontal overflow on narrow viewports", () => {
  /** Returns the page's sideways overflow plus the elements causing it. */
  const overflowReport = (page) =>
    page.evaluate(() => {
      const de = document.documentElement;
      const offenders = [];
      document.querySelectorAll("*").forEach((el) => {
        const r = el.getBoundingClientRect();
        // 0.5px guards against subpixel rounding on fractional device widths.
        if (r.width > 0 && r.right > de.clientWidth + 0.5) {
          offenders.push(
            `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}` +
              `${el.className ? "." + String(el.className).split(" ")[0] : ""}` +
              ` w=${Math.round(r.width)} right=${Math.round(r.right)}`
          );
        }
      });
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        offenders: offenders.slice(0, 8),
        offenderCount: offenders.length
      };
    });

  /** Asserts the document does not scroll sideways, naming what pushed it. */
  const expectNoOverflow = (report, where) => {
    expect(
      report.scrollWidth - report.clientWidth,
      `${where}: page scrolls horizontally (scrollWidth=${report.scrollWidth} > ` +
        `clientWidth=${report.clientWidth}); ${report.offenderCount} element(s) ` +
        `overflow, first: ${report.offenders.join(" | ") || "(none — check margins)"}`
    ).toBeLessThanOrEqual(2); // 2px subpixel tolerance, as in mobile.spec.js
  };

  // 320 = the narrowest phone still worth supporting (iPhone SE 1st gen);
  // 375 = the width the defect was reported at.
  for (const width of [320, 375]) {
    test(`the authoring form never scrolls sideways at ${width}px`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("dialog", (d) => d.accept());

      await page.setViewportSize({ width, height: 812 });
      await page.goto("/scenario-author.html");
      await expect(page.locator("#meta-section")).toBeVisible();

      expectNoOverflow(await overflowReport(page), `${width}px on load`);

      // The section that carried the bug must fit its column, not force it
      // wider — this is the assertion that fails if `min-inline-size: 0` is
      // ever dropped, even should some future change mask the page total.
      const fits = await page.evaluate(() => {
        const fs = document.getElementById("meta-section");
        return {
          section: fs.getBoundingClientRect().width,
          avail: fs.parentElement.getBoundingClientRect().width
        };
      });
      expect(
        fits.section,
        "#meta-section must not be wider than the column it sits in"
      ).toBeLessThanOrEqual(fits.avail + 1);

      // Ticking the branched module reveals #branched-ref — a second <select>,
      // whose options are scenario titles (author-supplied, so unbounded in
      // length). It must be capped like the format select.
      await page.locator("#mod-branched").check();
      await expect(page.locator("#branched-ref-row")).toBeVisible();
      expectNoOverflow(await overflowReport(page), `${width}px with branched-ref shown`);
      await page.locator("#mod-branched").uncheck();

      // Switching format swaps the whole form for the branch-tree editor.
      await page.locator("#meta-format").selectOption("branched");
      await expect(page.locator("#branched-editor")).toBeVisible();
      expectNoOverflow(await overflowReport(page), `${width}px in branched format`);

      // …and with an actual node row rendered (the densest layout on the page).
      await page.locator("#branched-editor .add-btn").first().click();
      expectNoOverflow(await overflowReport(page), `${width}px with a branch node`);

      expect(errors, "measuring layout must not throw").toEqual([]);
    });
  }

  test("a fully-populated skeleton stays within this device's width", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("dialog", (d) => d.accept());

    await page.goto("/scenario-author.html");
    await page.locator("#btn-skeleton").click();
    await page.locator("#skeleton-picker").getByRole("button", { name: /^Two-module scenario \(legacy\)$/ }).click();
    await expect
      .poll(async () =>
        (await page.locator("#json-preview").inputValue()).includes('"new-scenario"'))
      .toBe(true);

    const size = page.viewportSize();
    expectNoOverflow(
      await overflowReport(page),
      `native viewport ${size ? size.width : "?"}px`
    );

    expect(errors, "loading the skeleton must not throw").toEqual([]);
  });
});
