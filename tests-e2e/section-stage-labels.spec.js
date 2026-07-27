/* tests-e2e/section-stage-labels.spec.js
 *
 * S1b of the section model: a stage is a POSITION, not a module.
 *
 *   - Students see "Section k — <the section's own title>" (decision 8), with
 *     the "Module A — " prefix gone.
 *   - The session is Welcome + N sections + Wrap-up, CONTIGUOUS. Before S1b an
 *     A-only session ran [0,1,4] with two stages skipped.
 *   - Pick order decides running order: a roleplay picked first runs on stage 1
 *     and shows the roleplay view there.
 *
 * This is the browser-side proof. The unit tests slice the resolver out of
 * script.js; here the real shell is loaded, i18n has resolved, and the labels
 * are the strings a student would actually read.
 *
 * Registered into the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function surfaceApp(page) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  /* Apply a real built-in case: the synthetic surfacing below skips startRoom(),
     which is what normally calls applyScenario(), and without it the section
     TITLES are empty (the label correctly degrades to "Section k"). Loading the
     registry the same way the app does keeps the titles the real ones. */
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.CANAMED_SCENARIOS);
  await page.evaluate(() => window.applyScenario("chronic-pain-opioids"));
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  });
}

/* Narrow the session to an ordered module set, the way S3's picker will. */
async function pick(page, mods) {
  await page.evaluate((m) => {
    window.CURRENT_SCENARIO_MODULES = m;
    window.setSessionModules(m.join(","));
  }, mods);
}

test.describe("S1b — section stage labels and ordering", () => {
  test("a stage reads 'Section k — title', with no Module A/B prefix", async ({ page }) => {
    await surfaceApp(page);
    const labels = await page.evaluate(() =>
      [window.stageLabel(1), window.stageLabel(2)]);

    for (const l of labels) {
      expect(l).toMatch(/^Section [12] — .+/);
      expect(l).not.toMatch(/Module [AB]/);
    }
    expect(labels[0]).not.toEqual(labels[1]);
    // The title is the case's own — not a generic placeholder.
    expect(labels[0].replace(/^Section \d+ — /, "").length).toBeGreaterThan(3);
  });

  test("welcome and wrap-up keep their own labels, by role not index", async ({ page }) => {
    await surfaceApp(page);
    const ends = await page.evaluate(() =>
      [window.stageLabel(0), window.stageLabel(window.lastStage())]);
    expect(ends[0]).toBe("Welcome");
    expect(ends[1]).toBe("Wrap-up");
  });

  test("the flow is contiguous: Welcome + one stage per section + Wrap-up", async ({ page }) => {
    await surfaceApp(page);
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);

    await pick(page, ["A"]);
    /* Before S1b this was [0,1,4] — two dead stages in between. */
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2]);
    expect(await page.evaluate(() => window.stageLabel(2))).toBe("Wrap-up");
  });

  test("a single roleplay section runs on stage 1, not on Module B's old index",
    async ({ page }) => {
      await surfaceApp(page);
      await pick(page, ["B"]);
      const info = await page.evaluate(() => ({
        slots: window.sectionSlots().map(s => [s.stage, s.type]),
        view: window.stageViewId(1),
        label: window.stageLabel(1)
      }));
      expect(info.slots).toEqual([[1, "roleplay"]]);
      /* The roleplay MARKUP keeps its id — #stage-2 is now "the roleplay view",
         which is what removes the need to clone stage DOM per slot. */
      expect(info.view).toBe("stage-2");
      expect(info.label).toMatch(/^Section 1 — /);
    });

  test("the wrap-up view is shown even though its number moved", async ({ page }) => {
    await surfaceApp(page);
    await pick(page, ["A"]);
    /* _test_setViewStage only sets the state; renderStage() is what resolves
       the view, and it is the function under test here. */
    await page.evaluate(() => { window._test_setViewStage(2); window.renderStage(); });
    /* Its markup is #stage-4 while it now sits at stage 2: resolving
       "stage-" + n would have shown the branched view instead. */
    await expect(page.locator("#stage-4")).toBeVisible();
    await expect(page.locator("#stage-3")).toBeHidden();
    await expect(page.locator("#stage-1")).toBeHidden();
  });

  test("the stepper draws one numbered step per section, plus the two ends",
    async ({ page }) => {
      await surfaceApp(page);
      await page.evaluate(() => { window._test_setViewStage(1); window.renderStage(); });
      const steps = page.locator("#global-stage-progress .gsp-step");
      await expect(steps).toHaveCount(4);
      const nums = await page.locator("#global-stage-progress .gsp-num")
        .allTextContents();
      expect(nums).toEqual(["1", "2", "3", "4"]);
    });
});
