/* tests-e2e/modab-2026-06-02-fixes.spec.js
 *
 * Per-device behavioural coverage for the 2026-06-02 Module A/B user requests
 * (static lock-ins live in tests/modab-2026-06-02-fixes.test.js):
 *   #3 an inappropriate exam/investigation reveal turns RED (wrong-choice)
 *   #4 the "Discussed verbally — skip ahead →" prompt button is gone
 *   #5 Module A shows a "call a facilitator to move to Module B" CTA once all
 *      four group-answer bullets are filled
 *   #6 the Module B phase stepper sits after the role picker, and a
 *      "call a facilitator to go to the final section" CTA appears once all
 *      three group-answer bullets are filled
 *
 * Driven via the platform's global render/setter test hooks with the LOCAL
 * fallback (no Firebase / room needed). Listed in the mobile/tablet testMatch
 * in playwright.config.js so it runs on iPhone, iPad and Pixel viewports as
 * well as the desktop browsers.
 */
// @ts-check
const { test, expect } = require("./fixtures.js");

async function showStage(page, stageId) {
  await page.goto("/");
  await page.evaluate((sid) => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-1", "stage-2", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.toggle("hidden", id !== sid);
    });
  }, stageId);
}

test.describe("2026-06-02 Module A/B fixes", () => {
  test("#4 the 'skip ahead' prompt button is gone", async ({ page }) => {
    await page.goto("/");
    const hasSkip = await page.evaluate(() => !!document.getElementById("prompt-skip"));
    expect(hasSkip, "#prompt-skip must not be in the DOM").toBe(false);
  });

  test("#3 a penalised investigation reveal is red; a normal one is green", async ({ page }) => {
    await showStage(page, "stage-1");
    const result = await page.evaluate(() => {
      if (!window.CanamedLoader || !window.CanamedLoader.ensureCaseContent) return "no-loader";
      return window.CanamedLoader.ensureCaseContent().then(() => {
        // Repopulate ITEM_IDS + PENALTY_ITEM_IDS now that PENALTIES is loaded.
        if (window._test_rebuildCaseDerived) window._test_rebuildCaseDerived();
        if (typeof window.buildButtons !== "function") return "no-build";
        window.buildButtons();
        // labs:1 = the MRI this case does not need (pen_mri). exam:0 = a
        // legitimate examination (no penalty). Reveal both and re-render.
        window._test_setRevealed({
          "labs:1": { by: "T", at: Date.now() },
          "exam:0": { by: "T", at: Date.now() }
        });
        window.renderButtons();
        const wrong = document.querySelector('.req-btn[data-id="labs:1"]');
        const ok = document.querySelector('.req-btn[data-id="exam:0"]');
        if (!wrong || !ok) return "missing-btn";
        return {
          wrongRed: wrong.classList.contains("done") && wrong.classList.contains("wrong-choice"),
          okGreen: ok.classList.contains("done") && !ok.classList.contains("wrong-choice")
        };
      });
    });
    expect(result, "both buttons must render").not.toBe("missing-btn");
    expect(result.wrongRed, "the not-needed MRI reveal must be red (done + wrong-choice)").toBe(true);
    expect(result.okGreen, "a legitimate examination reveal must stay green (done, not wrong)").toBe(true);
  });

  test("#5 Module A 'go to Module B' CTA appears when both merged questions are answered", async ({ page }) => {
    await showStage(page, "stage-1");
    const before = await page.evaluate(() => {
      const box = document.getElementById("modA-answers-complete");
      return box ? box.classList.contains("hidden") : "no-box";
    });
    expect(before, "CTA must start hidden").toBe(true);

    const after = await page.evaluate(() => {
      // The merged Debate & answers form is only reachable past the
      // ≥1-hypothesis gate, so open it before answering (realistic state).
      if (window._test_setHypotheses) {
        window._test_setHypotheses({ h: { text: "mechanical LBP", by: "T", at: 1 } });
      }
      // Debate + answers MERGED into two questions (2026-06-25): diagnosis & plan,
      // and pain across cultures. Both covered → the "go to Module B" CTA shows.
      window._test_setAnswers({ moduleA: {
        a: { id: "a", bulletKey: "diagnosis", text: "x", by: "T" },
        b: { id: "b", bulletKey: "culture", text: "x", by: "T" }
      } });
      window.updateModANextStep();
      return document.getElementById("modA-answers-complete").classList.contains("hidden");
    });
    expect(after, "CTA must show once both questions are answered").toBe(false);
    // The button is wired inside the (now-revealed) completion box. Its on-screen
    // visibility depends on the answers tab being active — that tab machinery is
    // covered elsewhere; here we assert the button is present and the box opened.
    await expect(page.locator("#modA-call-next-btn")).toHaveCount(1);
  });

  test("#6 the Module B phase stepper sits after the role picker", async ({ page }) => {
    await showStage(page, "stage-2");
    const order = await page.evaluate(() => {
      const rp = document.getElementById("modB-role-picker");
      const st = document.querySelector("#stage-2 .phase-stepper");
      if (!rp || !st) return "missing";
      // DOCUMENT_POSITION_FOLLOWING (4): st comes after rp in document order.
      return (rp.compareDocumentPosition(st) & 4) ? "after" : "before";
    });
    expect(order, "the phase stepper must follow the role picker").toBe("after");
  });

  test("#6 Module B 'final section' CTA appears when all four answer bullets are filled", async ({ page }) => {
    await showStage(page, "stage-2");
    const before = await page.evaluate(() => {
      const box = document.getElementById("modB-answers-complete");
      return box ? box.classList.contains("hidden") : "no-box";
    });
    expect(before, "CTA must start hidden").toBe(true);

    // Only three of the four bullets → still hidden (P6 reflect-improved missing).
    const partial = await page.evaluate(() => {
      window._test_setAnswers({ moduleB: {
        a: { id: "a", bulletKey: "family-sentence", text: "x", by: "T" },
        b: { id: "b", bulletKey: "differ-converge", text: "x", by: "T" },
        d: { id: "d", bulletKey: "practice-change", text: "x", by: "T" }
      } });
      window.updateModBNextStep();
      return document.getElementById("modB-answers-complete").classList.contains("hidden");
    });
    expect(partial, "CTA stays hidden until ALL four bullets are covered").toBe(true);

    // All four (the two Phase-3 questions + the two Phase-6 reflection answers).
    const after = await page.evaluate(() => {
      window._test_setAnswers({ moduleB: {
        a: { id: "a", bulletKey: "family-sentence", text: "x", by: "T" },
        b: { id: "b", bulletKey: "differ-converge", text: "x", by: "T" },
        c: { id: "c", bulletKey: "reflect-improved", text: "x", by: "T" },
        d: { id: "d", bulletKey: "practice-change", text: "x", by: "T" }
      } });
      window.updateModBNextStep();
      return document.getElementById("modB-answers-complete").classList.contains("hidden");
    });
    expect(after, "CTA must show once all four answer bullets are covered").toBe(false);
    await expect(page.locator("#modB-call-next-btn")).toHaveCount(1);
  });
});
