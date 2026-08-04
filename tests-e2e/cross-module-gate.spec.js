/* tests-e2e/cross-module-gate.spec.js
 *
 * THE STUDENT-VISIBLE HALF of the cross-module gate fix.
 *
 * `unlockWhen.afterDecision` holds a decision until another one is committed.
 * The section model splits a scenario's decisions across sections BY MODULE and
 * namespaces each section's ids per slot, so a gate written across modules
 * named an id its stage never publishes: decisionUnlocked() reported it
 * permanently unmet and the decision was locked for the whole session — under
 * `hideWhenLocked`, never rendered at all.
 *
 * The unit tests pin the DATA TRANSFORM (namespaceDecisions drops the dead
 * gate). They cannot see the consequence that actually matters: whether the
 * student can SEE the decision. That is what this asserts, on every viewport —
 * a locked card and a missing card are both invisible failures the transform
 * tests would happily pass through.
 *
 * Registered on the mobile projects per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* A scenario whose Module B decision is gated on a Module A one — the exact
   shape the section split broke. `hideWhenLocked` is set because that is the
   WORST case: a locked card at least leaves a trace, a hidden one does not. */
const CROSS_MODULE_SCENARIO = {
  id: "xmod",
  format: "standard",
  name: { en: "Cross-module gate case", fr: "", ja: "" },
  summary: { en: "Fixture", fr: "", ja: "" },
  moduleAName: { en: "Module A — Workup", fr: "", ja: "" },
  moduleBName: { en: "Module B — Conversation", fr: "", ja: "" },
  case: {
    history: [{ q: { en: "How long?" }, a: { en: "Three days." } }],
    exam: [{ q: { en: "Chest" }, a: { en: "Clear." } }],
    labs: [{ key: true, q: { en: "CRP" }, a: { en: "Raised." } }],
    prompts: [{ en: "Discuss." }]
  },
  scoring: {
    moduleA: [{ id: "famA", label: { en: "A" }, points: 5, any: ["history:0"] }],
    moduleB: [{ id: "famB", label: { en: "B" }, points: 5, any: ["history:0"] }]
  },
  penalties: [],
  synthId: "labs:0",
  synthPrereqs: [],
  decisions: [
    { id: "xm_a1", module: "A", points: 10, penalty: 0,
      prompt: { en: "PROMPT-A-ONE" },
      options: [{ text: { en: "a-yes" }, correct: true, why: { en: "w" } },
                { text: { en: "a-no" }, correct: false, why: { en: "w" } }] },
    /* The gated one. Authored to open only after the Module A decision — which
       now lives on another stage under another id. */
    { id: "xm_b1", module: "B", points: 10, penalty: 0,
      unlockWhen: { afterDecision: "xm_a1" },
      hideWhenLocked: true,
      prompt: { en: "PROMPT-B-GATED" },
      options: [{ text: { en: "b-yes" }, correct: true, why: { en: "w" } },
                { text: { en: "b-no" }, correct: false, why: { en: "w" } }] }
  ]
};

/* Build the two sections this scenario yields, register them, and pick both. */
async function crossModuleSession(page) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.CANAMED_SECTIONS);
  await page.evaluate((scenario) => {
    window.CANAMED_SCENARIOS = window.CANAMED_SCENARIOS || {};
    window.CANAMED_SCENARIOS[scenario.id] = scenario;
    window.sectionsForScenario(scenario, scenario.id).forEach((sec) => {
      window.CANAMED_SECTIONS[sec.id] = sec;
    });
    window.setSessionSections("xmod-pbl,xmod-roleplay");
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  }, CROSS_MODULE_SCENARIO);
}

test.describe("A gate written across modules", () => {
  test("the fixture really does split across two sections", async ({ page }) => {
    await crossModuleSession(page);
    const info = await page.evaluate(() => ({
      slots: window.sectionSlots().map((s) => [s.stage, s.type, s.sectionId]),
      pbl: (window.CANAMED_SECTIONS["xmod-pbl"].content.decisions || [])
        .map((d) => d.id),
      roleplay: (window.CANAMED_SECTIONS["xmod-roleplay"].content.decisions || [])
        .map((d) => d.id)
    }));
    /* Guards the whole file: if the split ever stopped separating them, every
       assertion below would pass vacuously. */
    expect(info.slots).toEqual([
      [1, "pbl", "xmod-pbl"],
      [2, "roleplay", "xmod-roleplay"]
    ]);
    expect(info.pbl).toEqual(["xm_a1"]);
    expect(info.roleplay).toEqual(["xm_b1"]);
  });

  test("the gated decision IS RENDERED on its stage, not silently missing",
    async ({ page }) => {
      await crossModuleSession(page);
      const seen = await page.evaluate(() => {
        window._test_setViewStage(2);
        window.renderStage();
        window.renderDecisions();
        const box = document.getElementById("decisions-B");
        return {
          ids: (window.DECISIONS || []).map((d) => d.id),
          gate: (window.DECISIONS || [])
            .map((d) => (d.unlockWhen || {}).afterDecision),
          html: box ? box.textContent : "",
          locked: box ? box.querySelectorAll(".decision-locked").length : -1,
          cards: box ? box.querySelectorAll(".decision").length : -1
        };
      });
      expect(seen.ids).toEqual(["s2_xm_b1"]);
      /* The dead cross-module reference is gone… */
      expect(seen.gate[0]).toBeUndefined();
      /* …and the consequence the student actually experiences: the decision is
         on screen and votable, rather than hidden behind a gate that can never
         fire. Before the fix this card did not exist in the DOM at all. */
      expect(seen.html).toContain("PROMPT-B-GATED");
      expect(seen.cards).toBeGreaterThan(0);
      expect(seen.locked).toBe(0);
    });

  test("a gate INSIDE one section still locks — the fix did not ungate everything",
    async ({ page }) => {
      /* The counterpart that stops this suite from passing for the wrong
         reason. An in-section gate must still hold the decision shut, so
         "nothing is ever gated any more" would fail here. */
      await crossModuleSession(page);
      const seen = await page.evaluate(() => {
        const sec = window.CANAMED_SECTIONS["xmod-pbl"];
        sec.content.decisions = [
          sec.content.decisions[0],
          { id: "xm_a2", module: "A", points: 10, penalty: 0,
            unlockWhen: { afterDecision: "xm_a1" },
            prompt: { en: "PROMPT-A-GATED" },
            options: [{ text: { en: "y" }, correct: true, why: { en: "w" } },
                      { text: { en: "n" }, correct: false, why: { en: "w" } }] }
        ];
        window._appliedSectionId = null;
        window._test_setViewStage(1);
        window.renderStage();
        window.renderDecisions();
        const box = document.getElementById("decisions-A");
        return {
          gate: (window.DECISIONS || [])
            .filter((d) => d.id === "s1_xm_a2")
            .map((d) => (d.unlockWhen || {}).afterDecision)[0],
          locked: box ? box.querySelectorAll(".decision-locked").length : -1
        };
      });
      expect(seen.gate).toBe("s1_xm_a1");
      expect(seen.locked).toBeGreaterThan(0);
    });
});
