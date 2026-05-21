/* tests-e2e/module-b-i18n.spec.js
 *
 * Module B's instruction body (the vignette, safety note, SPIKES strip,
 * "useful sentences" box, and the four phase blocks) was English-only
 * until fix/module-b-i18n. This test pins the gap shut: loading the
 * platform with canamed_lang=ja must render the Module B body in
 * Japanese, not English.
 *
 * Approach: rather than driving the full splash → lobby → admin Start
 * → advance flow just to reach stage 2, the test loads the page with
 * canamed_lang pre-seeded, lets i18n.js run its DOMContentLoaded init,
 * then peels back the `hidden` class on #stage-2 so the Module B body is
 * visible to Playwright. Translation lookup is the unit under test;
 * stage navigation is covered by stage-progression.spec.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Module B body i18n", () => {
  test("renders Japanese vignette + safety + SPIKES + phases when lang=ja", async ({ page }) => {
    // Seed the language BEFORE any platform script runs so i18n.js'
    // DOMContentLoaded init picks up ja on the very first paint.
    await page.addInitScript(() => {
      try { localStorage.setItem("canamed_lang", "ja"); } catch (e) {}
    });

    await page.goto("/");

    // Confirm the language detection actually landed on Japanese — if
    // this fails, every assertion below would be a misleading red.
    const lang = await page.evaluate(() => (window.getLang && window.getLang()));
    expect(lang).toBe("ja");

    // Stage 2 is hidden on first load (the participant sees splash). We
    // surface it so its data-i18n nodes are in the layout tree; i18n.js
    // already populated their textContent / innerHTML during init. We
    // also unlock the body (the splash gate adds `body.locked` to hide
    // #app entirely until a session code is entered) and unhide #app +
    // stage-2 itself.
    await page.evaluate(() => {
      document.body.classList.remove("locked");
      const splash = document.getElementById("splash");
      if (splash) splash.classList.add("hidden");
      const app = document.getElementById("app");
      if (app) app.classList.remove("hidden");
      ["stage-0", "stage-1", "stage-3"].forEach(id => {
        const n = document.getElementById(id);
        if (n) n.classList.add("hidden");
      });
      const stage2 = document.getElementById("stage-2");
      if (stage2) stage2.classList.remove("hidden");
    });

    // Vignette body — Japanese opener "状況設定 (一度、皆で読みましょう)。"
    // is unmistakable; the English equivalent starts with "The situation".
    const vignette = page.locator("[data-i18n='stage.modB.vignette.body']");
    await expect(vignette).toBeVisible();
    await expect(vignette).toContainText("状況設定");
    await expect(vignette).not.toContainText("The situation");

    // Safety note headers + paragraphs.
    await expect(page.locator("[data-i18n='stage.modB.safety.heading']"))
      .toContainText("始める前に");
    await expect(page.locator("[data-i18n='stage.modB.safety.language']"))
      .toContainText("第二・第三言語");

    // SPIKES strip — both the label and an expanded letter.
    await expect(page.locator("[data-i18n='stage.modB.spikes.label']"))
      .toHaveText("SPIKES");
    await expect(page.locator("[data-i18n='stage.modB.spikes.p']"))
      .toContainText("erception");
    await expect(page.locator("[data-i18n='stage.modB.spikes.p']"))
      .toContainText("理解");

    // Useful-sentences box — the English example phrases are preserved
    // intentionally (they ARE the script learners should rehearse), but
    // the surrounding label must be Japanese.
    await expect(page.locator("[data-i18n='stage.modB.spikes.useful.label']"))
      .toContainText("役立つフレーズ");

    // Phase titles — confirm each of the four headings localized.
    await expect(page.locator("[data-i18n='stage.modB.phase1.title']"))
      .toContainText("フェーズ1");
    await expect(page.locator("[data-i18n='stage.modB.phase2.title']"))
      .toContainText("フェーズ2");
    await expect(page.locator("[data-i18n='stage.modB.phase3.title']"))
      .toContainText("フェーズ3");
    await expect(page.locator("[data-i18n='stage.modB.phase4.title']"))
      .toContainText("フェーズ4");

    // Answer-input language hint (also added in this PR; appears above
    // both the Module A and Module B free-text inputs).
    const hints = page.locator(".answer-input-language-hint");
    await expect(hints.first()).toContainText("好きな言語");

    // Module B group answers heading.
    await expect(page.locator("[data-i18n='stage.modB.answers.title']"))
      .toContainText("グループ回答");

    // Sanity: the original English fallback shouldn't appear anywhere
    // in the visible Module B body region.
    const stage2Text = await page.locator("#stage-2").innerText();
    expect(stage2Text).not.toContain("Before you start — two things");
    expect(stage2Text).not.toContain("Phase 1 — Set up");
  });

  test("answer-input language hint renders French when lang=fr", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("canamed_lang", "fr"); } catch (e) {}
    });

    await page.goto("/");

    // Surface stage-2 to put the Module B hint in the layout tree (the
    // Module A hint lives in the always-rendered answers panel of
    // stage-1, but it too is hidden until the participant is in a room).
    await page.evaluate(() => {
      document.body.classList.remove("locked");
      const splash = document.getElementById("splash");
      if (splash) splash.classList.add("hidden");
      const app = document.getElementById("app");
      if (app) app.classList.remove("hidden");
      const stage2 = document.getElementById("stage-2");
      if (stage2) stage2.classList.remove("hidden");
      const stage1 = document.getElementById("stage-1");
      if (stage1) stage1.classList.remove("hidden");
    });

    const hints = page.locator(".answer-input-language-hint");
    // The shared language hint now sits at every free-text contribution
    // point (inclusion 2026-05-21): the Module A + Module B group-answer
    // cards, the working-hypotheses input, and the side-chat — 4 in all.
    // Each uses the same i18n key, so all must show the French message.
    const count = await hints.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      await expect(hints.nth(i))
        .toContainText("Écrivez dans la langue de votre choix");
    }
  });
});
