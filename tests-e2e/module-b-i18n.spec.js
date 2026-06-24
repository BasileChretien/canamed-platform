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
  test("Module B safety note stays Japanese but the learning body is English-canonical (Phase 3)", async ({ page }) => {
    // Phase 3 — English-canonical UI: the Module B SAFETY briefing (a
    // consent/safety string) stays in the participant's language; the clinical
    // vignette, SPIKES strip, phase headings and group-answers chrome are
    // learning content and now render in English for everyone (word-level help
    // comes from the in-page reading aid).
    await page.addInitScript(() => {
      try { localStorage.setItem("canamed_lang", "ja"); } catch (e) {}
    });

    await page.goto("/");
    const lang = await page.evaluate(() => (window.getLang && window.getLang()));
    expect(lang).toBe("ja");

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

    // Safety note (whitelisted consent/safety) STAYS Japanese.
    await expect(page.locator("[data-i18n='stage.modB.safety.heading']"))
      .toContainText("始める前に");
    await expect(page.locator("[data-i18n='stage.modB.safety.language']"))
      .toContainText("第二・第三言語");

    // Vignette is now English ("The situation…"), not Japanese ("状況設定").
    const vignette = page.locator("[data-i18n='stage.modB.vignette.body']");
    await expect(vignette).toBeVisible();
    await expect(vignette).toContainText(/situation/i);
    await expect(vignette).not.toContainText("状況設定");

    // Phase headings + group-answers chrome are English.
    await expect(page.locator("[data-i18n='stage.modB.phase1.title']"))
      .toContainText(/Phase 1/i);
    await expect(page.locator("[data-i18n='stage.modB.phase1.title']"))
      .not.toContainText("フェーズ");
    await expect(page.locator("[data-i18n='stage.modB.answers.title']"))
      .not.toContainText("グループ回答");

    // The shared free-text language hint is English-canonical too.
    const hints = page.locator(".answer-input-language-hint");
    await expect(hints.first()).not.toContainText("好きな言語");

    // The English learning body now legitimately appears (it used to be the
    // forbidden fallback).
    const stage2Text = await page.locator("#stage-2").innerText();
    expect(stage2Text).toContain("Phase 1");
  });

  test("answer-input language hint is English-canonical (Phase 3)", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("canamed_lang", "fr"); } catch (e) {}
    });

    await page.goto("/");

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
    // The shared language hint sits at every free-text contribution point
    // (Module A + Module B group-answer cards + the working-hypotheses input)
    // — 3 in all. Under the English-canonical UI all three render English,
    // even with fr selected (the hint says you MAY write in any language).
    const count = await hints.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      await expect(hints.nth(i)).not.toContainText("Écrivez dans la langue");
      await expect(hints.nth(i)).toContainText(/any language/i);
    }
  });
});
