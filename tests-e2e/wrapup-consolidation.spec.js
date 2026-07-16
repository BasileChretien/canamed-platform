/* tests-e2e/wrapup-consolidation.spec.js
 *
 * Consolidated wrap-up (2026-07-16, user request). The wrap-up (#stage-3) used
 * to be several separate cards: "Wrap-up & Next Steps", a team-recap card, a
 * lone "Download my room's answers" button card, and a "Take it with you" PDF
 * card — with the optional post-test / survey cards interleaved between them.
 * They are now ONE card (.wrapup-card) at the TOP of the wrap-up: the next-steps
 * copy, the team recap (#team-recap) and the take-home downloads (booklet + cert
 * PDFs + the room-answers Markdown export) all live inside it. The optional
 * post-test (#posttest-card) and feedback survey (#survey-card) stay as their
 * own sibling cards BELOW it. The "Your group's answers are saved below …"
 * next-step line was removed.
 *
 * These are static-DOM contracts (the wrap-up markup ships in index.html and is
 * only hidden until stage-3), asserted at "/" so they run identically per-device
 * (chromium/firefox/webkit + mobile-iphone/ipad/android — the mobile projects
 * via the testMatch allow-list in playwright.config.js). A final per-device
 * check un-hides the card and asserts it doesn't overflow its width on narrow
 * viewports.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Wrap-up — consolidated single card", () => {
  test("the three wrap-up sections live inside ONE .wrapup-card", async ({ page }) => {
    await page.goto("/");
    const dom = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("#stage-3 .wrapup-card"));
      const card = cards[0] || null;
      const has = (sel) => !!(card && card.querySelector(sel));
      return {
        wrapupCardCount: cards.length,
        // the "Wrap-up & Next Steps" heading is the card's title
        title: has('[data-i18n="stage.wrap.title"]'),
        // team recap render target is inside the same card…
        teamRecapInCard: has("#team-recap"),
        // …and only appears once in the whole document (no duplicate id)
        teamRecapTotal: document.querySelectorAll("#team-recap").length,
        // all three take-home downloads folded into the same card
        bookletInCard: has("#wrapup-booklet-btn"),
        certInCard: has("#wrapup-cert-btn"),
        answersInCard: has("#wrapup-download-btn"),
        // each download button is unique (no orphan duplicate left behind)
        bookletTotal: document.querySelectorAll("#wrapup-booklet-btn").length,
        certTotal: document.querySelectorAll("#wrapup-cert-btn").length,
        answersTotal: document.querySelectorAll("#wrapup-download-btn").length
      };
    });
    expect(dom.wrapupCardCount, "exactly one .wrapup-card").toBe(1);
    expect(dom.title, "wrap-up title inside the card").toBe(true);
    expect(dom.teamRecapInCard, "#team-recap inside the card").toBe(true);
    expect(dom.teamRecapTotal, "#team-recap not duplicated").toBe(1);
    expect(dom.bookletInCard, "booklet PDF button inside the card").toBe(true);
    expect(dom.certInCard, "certificate PDF button inside the card").toBe(true);
    expect(dom.answersInCard, "room-answers download inside the card").toBe(true);
    expect(dom.bookletTotal, "booklet button not duplicated").toBe(1);
    expect(dom.certTotal, "certificate button not duplicated").toBe(1);
    expect(dom.answersTotal, "answers download not duplicated").toBe(1);
  });

  test('the "answers are saved below" next-step line is gone', async ({ page }) => {
    await page.goto("/");
    const gone = await page.evaluate(() => ({
      byKey: document.querySelectorAll('[data-i18n="stage.wrap.answers-saved"]').length,
      bodyText: /answers are saved below/i.test(document.body.textContent || "")
    }));
    expect(gone.byKey, "no element carries the removed i18n key").toBe(0);
    expect(gone.bodyText, "the phrase text is nowhere in the DOM").toBe(false);
    // (the i18n key's removal from every locale dictionary is enforced by the
    //  node unit-test parity suite — see tests/*.test.js.)
  });

  test("the optional post-test + survey cards stay their own cards below", async ({ page }) => {
    await page.goto("/");
    const layout = await page.evaluate(() => {
      const card = document.querySelector("#stage-3 .wrapup-card");
      const post = document.getElementById("posttest-card");
      const survey = document.getElementById("survey-card");
      return {
        postExists: !!post,
        surveyExists: !!survey,
        postOutsideWrapup: !!(card && post && !card.contains(post)),
        surveyOutsideWrapup: !!(card && survey && !card.contains(survey)),
        // both optional cards are their own .card and hidden by default
        postIsCard: !!(post && post.classList.contains("card")),
        surveyIsCard: !!(survey && survey.classList.contains("card"))
      };
    });
    expect(layout.postExists && layout.surveyExists, "both optional cards still ship").toBe(true);
    expect(layout.postOutsideWrapup, "post-test is NOT inside the wrap-up card").toBe(true);
    expect(layout.surveyOutsideWrapup, "survey is NOT inside the wrap-up card").toBe(true);
    expect(layout.postIsCard && layout.surveyIsCard, "both remain their own .card").toBe(true);
  });

  test("the consolidated card fits its width (no horizontal overflow) per-device", async ({ page }) => {
    await page.goto("/");
    const fit = await page.evaluate(() => {
      // un-hide stage-3 and its ancestors (siblings stay hidden) so the wrap-up
      // card lays out at the real viewport width for this device.
      const s3 = document.getElementById("stage-3");
      for (let el = s3; el; el = el.parentElement) {
        if (el.classList) el.classList.remove("hidden");
      }
      try { if (typeof window.renderTeamRecap === "function") window.renderTeamRecap(); } catch (e) { /* app state may be absent; the card still lays out */ }
      const card = document.querySelector("#stage-3 .wrapup-card");
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const btns = ["wrapup-booklet-btn", "wrapup-cert-btn", "wrapup-download-btn"].map((id) => {
        const b = document.getElementById(id);
        return !!(b && b.getBoundingClientRect().width > 0);
      });
      return {
        visible: rect.width > 0,
        scrollW: card.scrollWidth,
        clientW: card.clientWidth,
        buttonsVisible: btns.every(Boolean)
      };
    });
    expect(fit, "wrap-up card is measurable").not.toBeNull();
    if (fit && fit.visible) {
      // no content spills past the card's own width on this viewport
      expect(fit.scrollW, "wrap-up card content does not overflow horizontally").toBeLessThanOrEqual(fit.clientW + 1);
      expect(fit.buttonsVisible, "all three take-home downloads are laid out").toBe(true);
    }
  });
});
