/* tests-e2e/survey-feedback.spec.js
 *
 * End-of-session feedback survey (in-platform questionnaire) + CSV export.
 *
 * Per the project standing instruction, UI changes get a per-device pass:
 * this spec is wired into the desktop (chromium/firefox/webkit) projects AND
 * the mobile-iphone / mobile-ipad / mobile-android projects (see
 * playwright.config.js testMatch), so the survey form is exercised on all four
 * target viewports. Runs in hermetic LocalDB mode via fixtures.forceLocalMode.
 */

// @ts-check
const { test, expect } = require("./fixtures");

test.describe("Wrap-up feedback survey", () => {
  test("survey card + controls + CSV export button exist", async ({ page }) => {
    await page.goto("/");
    // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
    // this spec surfaces the room synthetically, so load it explicitly (same
    // convention as branched-format.spec.js awaiting ensureBranchedStyles).
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    const info = await page.evaluate(() => ({
      card:    !!document.getElementById("survey-card"),
      start:   !!document.getElementById("survey-start-btn"),
      skip:    !!document.getElementById("survey-skip-btn"),
      body:    !!document.getElementById("survey-body"),
      csvBtn:  !!document.getElementById("admin-research-csv-btn"),
      bank:    Array.isArray(window.SURVEY) ? window.SURVEY.length : 0
    }));
    expect(info.card).toBe(true);
    expect(info.start).toBe(true);
    expect(info.skip).toBe(true);
    expect(info.body).toBe(true);
    expect(info.csvBtn).toBe(true);
    expect(info.bank).toBeGreaterThanOrEqual(10);
  });

  test("the survey form renders likert / select / open fields + a submit", async ({ page }) => {
    await page.goto("/");
    // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
    // this spec surfaces the room synthetically, so load it explicitly (same
    // convention as branched-format.spec.js awaiting ensureBranchedStyles).
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    const out = await page.evaluate(() => {
      if (typeof window._mountSurveyForm !== "function") return null;
      window._mountSurveyForm();
      const body = document.getElementById("survey-body");
      const likertGroups = body.querySelectorAll(".survey-likert");
      const firstGroup = likertGroups[0];
      const likertBtn = firstGroup ? firstGroup.querySelector(".survey-likert-opt") : null;
      return {
        sections: body.querySelectorAll(".survey-section").length,
        likertGroups: likertGroups.length,
        likertButtonsInFirst: firstGroup ? firstGroup.querySelectorAll(".survey-likert-opt").length : 0,
        selects: body.querySelectorAll("select.survey-select").length,
        textareas: body.querySelectorAll("textarea.survey-open").length,
        hasSubmit: !!document.getElementById("survey-submit-btn"),
        likertMinHeight: likertBtn ? parseInt(getComputedStyle(likertBtn).minHeight, 10) || 0 : 0
      };
    });
    expect(out, "_mountSurveyForm must be exposed").not.toBeNull();
    expect(out.sections).toBeGreaterThanOrEqual(3);
    expect(out.likertGroups).toBeGreaterThanOrEqual(5);
    expect(out.likertButtonsInFirst).toBe(5);          // 1..5 Likert scale
    expect(out.selects).toBeGreaterThanOrEqual(1);     // demographics
    expect(out.textareas).toBeGreaterThanOrEqual(1);   // open-ended
    expect(out.hasSubmit).toBe(true);
    // touch target — must stay tappable on the mobile/tablet viewports too.
    // Computed min-height is layout-independent (the wrap-up stage is behind the
    // splash on "/", so a rendered bounding-rect would read 0 here).
    expect(out.likertMinHeight).toBeGreaterThanOrEqual(44);
  });

  test("the demographic questions are pre-filled from the join profile", async ({ page }) => {
    await page.goto("/");
    // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
    // this spec surfaces the room synthetically, so load it explicitly (same
    // convention as branched-format.spec.js awaiting ensureBranchedStyles).
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    const r = await page.evaluate(() => {
      // simulate a participant who already gave university + year on the join form
      const uni = document.getElementById("uni-input");
      const yr = document.getElementById("year-input");
      if (uni) uni.value = "Caen";
      if (yr) yr.value = "4";
      window._mountSurveyForm();
      const body = document.getElementById("survey-body");
      const sels = Array.from(body.querySelectorAll("select.survey-select"));
      return {
        uniInputSet: uni ? uni.value : null,
        yrInputSet: yr ? yr.value : null,
        selectValues: sels.map(s => s.value),
        hints: body.querySelectorAll(".survey-prefill-hint").length
      };
    });
    // sanity: the join inputs actually carry the seeded values
    expect(r.uniInputSet).toBe("Caen");
    expect(r.yrInputSet).toBe("4");
    // the questionnaire arrives pre-answered — no re-asking
    expect(r.selectValues, "university must be pre-filled").toContain("Caen");
    expect(r.selectValues, "year must be pre-filled").toContain("4");
    // both demographic fields are flagged as pre-filled
    expect(r.hints).toBeGreaterThanOrEqual(2);
  });

  test("_surveyReadyAfterPostTest helper stays exposed (retained; renderSurvey no longer gates on it, 2026-06-16)", async ({ page }) => {
    await page.goto("/");
    // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
    // this spec surfaces the room synthetically, so load it explicitly (same
    // convention as branched-format.spec.js awaiting ensureBranchedStyles).
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    const r = await page.evaluate(() => {
      const f = window._surveyReadyAfterPostTest;
      if (typeof f !== "function") return null;
      return {
        noPostTest:      f(0, null),                       // no post-test → show now
        postPending:     f(10, null),                      // post-test exists, untouched → wait
        postPendingRec:  f(10, { startedAt: 1 }),          // started but not done → wait
        postCompleted:   f(10, { completedAt: 123 }),      // done → show
        postSkipped:     f(10, { skipped: true })          // skipped → show
      };
    });
    expect(r, "_surveyReadyAfterPostTest must be exposed").not.toBeNull();
    expect(r.noPostTest).toBe(true);
    expect(r.postPending).toBe(false);
    expect(r.postPendingRec).toBe(false);
    expect(r.postCompleted).toBe(true);
    expect(r.postSkipped).toBe(true);
  });

  test("a Likert option records a selection (aria-checked)", async ({ page }) => {
    await page.goto("/");
    // room-only CSS is lazily <link>ed by ensureRoomStyles() on real room entry;
    // this spec surfaces the room synthetically, so load it explicitly (same
    // convention as branched-format.spec.js awaiting ensureBranchedStyles).
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    const checked = await page.evaluate(() => {
      window._mountSurveyForm();
      const btn = document.querySelector(".survey-likert .survey-likert-opt");
      if (!btn) return null;
      btn.click();
      return btn.getAttribute("aria-checked");
    });
    expect(checked).toBe("true");
  });
});
