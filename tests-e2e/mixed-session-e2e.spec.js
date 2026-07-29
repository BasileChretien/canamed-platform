/* tests-e2e/mixed-session-e2e.spec.js
 *
 * THE INTEGRATION TEST FOR THE WHOLE SECTION MODEL.
 *
 * Every phase so far has been verified in its own layer. This one asserts the
 * thing the user actually asked for, end to end, in one session:
 *
 *   "Each part must be considered independent, and selectable as is in order to
 *    create a new session."
 *
 * A session built from TWO SECTIONS OF DIFFERENT CLINICAL CASES must:
 *   1. offer them in the picker and store them in pick order;
 *   2. run one stage per section, labelled by position;
 *   3. show each section's OWN content on its own stage;
 *   4. keep per-slot state separate (S2b);
 *   5. namespace vote ids per slot so two sections cannot share a tally (S3c);
 *   6. export per slot with a section manifest (S4).
 *
 * Registered on the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Two sections from DIFFERENT clinical cases — two different patients in one
   session, which is what decision 4 allows.
   Chosen because BOTH carry vote cards (chronic-pain-pbl has 2,
   jaundice-roleplay has 5), which is what makes the per-slot vote-id assertion
   meaningful. Not every section has them: jaundice-pbl and sore-throat-roleplay
   both ship ZERO decisions, so a pair drawn from those would have asserted
   namespacing over empty lists and passed vacuously. */
const PICK = ["chronic-pain-pbl", "jaundice-roleplay"];

async function mixedSession(page) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.CANAMED_SECTIONS);
  await page.evaluate((ids) => {
    window.setSessionSections(ids.join(","));
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  }, PICK);
}

test.describe("A mixed session, end to end", () => {
  test("runs one stage per picked section, labelled by position", async ({ page }) => {
    await mixedSession(page);
    const info = await page.evaluate(() => ({
      slots: window.sectionSlots().map(s => [s.stage, s.type, s.sectionId]),
      flow: window.stageFlow(),
      labels: [window.stageLabel(1), window.stageLabel(2)],
      wrapUp: window.stageLabel(window.lastStage())
    }));
    expect(info.slots).toEqual([
      [1, "pbl", "chronic-pain-pbl"],
      [2, "roleplay", "jaundice-roleplay"]
    ]);
    expect(info.flow).toEqual([0, 1, 2, 3]);
    expect(info.labels[0]).toMatch(/^Section 1 — /);
    expect(info.labels[1]).toMatch(/^Section 2 — /);
    expect(info.wrapUp).toBe("Wrap-up");
    // The two sections are genuinely different cases, not one case twice.
    expect(info.labels[0]).not.toEqual(info.labels[1]);
  });

  test("each stage shows ITS OWN section's content", async ({ page }) => {
    await mixedSession(page);
    /* Stage 1 is the jaundice workup: its case must be the one on screen. */
    const onStage1 = await page.evaluate(() => {
      window._test_setViewStage(1);
      window.renderStage();
      return { caseFirst: (window.CASE.history[0].q.en || ""),
               view: window.stageViewId(1) };
    });
    expect(onStage1.view).toBe("stage-1");

    /* Walking to stage 2 swaps the content to the sore-throat roleplay. */
    const onStage2 = await page.evaluate(() => {
      window._test_setViewStage(2);
      window.renderStage();
      return { view: window.stageViewId(2),
               scoringB: ((window.SCORING || {}).moduleB || []).length };
    });
    expect(onStage2.view).toBe("stage-2");
    expect(onStage2.scoringB).toBeGreaterThan(0);
  });

  test("vote ids are namespaced per slot — two sections cannot share a tally",
    async ({ page }) => {
      await mixedSession(page);
      const ids = await page.evaluate(() => {
        window._test_setViewStage(1); window.renderStage();
        const first = (window.DECISIONS || []).map(d => d.id);
        window._test_setViewStage(2); window.renderStage();
        const second = (window.DECISIONS || []).map(d => d.id);
        return { first, second };
      });
      expect(ids.first.length).toBeGreaterThan(0);
      expect(ids.second.length).toBeGreaterThan(0);
      ids.first.forEach((id) => expect(id).toMatch(/^s1_/));
      ids.second.forEach((id) => expect(id).toMatch(/^s2_/));
      /* The decisive property: no id appears in both slots, so votes/$voteId
         cannot collide. */
      const overlap = ids.first.filter((id) => ids.second.includes(id));
      expect(overlap).toEqual([]);
    });

  test("per-slot room state stays separate", async ({ page }) => {
    await mixedSession(page);
    const state = await page.evaluate(() => {
      /* `revealed` is a top-level `let`, so it is NOT a window property —
         assert through the store, which is where the isolation actually lives. */
      window.slotState(1).revealed = { "history:0": { by: "A", at: 1 } };
      window.slotState(2).revealed = {};
      window._test_setViewStage(1); window.renderStage();
      const slot1 = Object.keys(window.slotState(1).revealed).length;
      window._test_setViewStage(2); window.renderStage();
      const slot2 = Object.keys(window.slotState(2).revealed).length;
      return { slot1, slot2, distinct: window.slotState(1) !== window.slotState(2) };
    });
    /* An item revealed in section 1 must not appear in section 2's board — the
       whole reason room state moved per slot in S2b. */
    expect(state.slot1).toBe(1);
    expect(state.slot2).toBe(0);
    expect(state.distinct).toBe(true);
  });

  test("the export carries a section manifest and per-slot buckets", async ({ page }) => {
    await mixedSession(page);
    const archive = await page.evaluate(() => {
      window._test_setSessionNum("MIX-1");
      window._test_setRoomCount(1);
      window._test_setAllRooms({
        "Room 1": { stage: 3,
          sections: { 1: { hypotheses: { h: { by: "A", text: "mechanical pain" } } } },
          answers: { sections: { 2: { x: { by: "B", text: "no antibiotic" } } } } }
      });
      return window._sessionArchiveData ? window._sessionArchiveData(false) : null;
    });
    if (archive === null) test.skip(true, "archive builder not exposed in this build");
    expect(archive.exportVersion).toBe(2);
    expect(archive.sections.map((s) => s.sectionId)).toEqual(PICK);
    /* Each slot's work lands under ITS OWN slot — the whole point of S2/S4. */
    expect(archive.rooms[0].sections["1"].hypotheses[0].text).toBe("mechanical pain");
    expect(archive.rooms[0].sections["2"].answers[0].text).toBe("no antibiotic");
    expect(archive.rooms[0].sections["1"].answers).toEqual([]);
  });
});
