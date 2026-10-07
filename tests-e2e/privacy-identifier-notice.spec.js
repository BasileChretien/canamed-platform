/* tests-e2e/privacy-identifier-notice.spec.js
 *
 * PIS v12 (issue #347): the privacy notice now describes the technical
 * identifier every visitor's browser is given at startup, and states how long
 * it is kept.
 *
 * tests/anonymous-identifier-notice.test.js pins the WORDING against the job
 * that enforces it, by reading the HTML source. That cannot show what a
 * participant actually sees: privacy.html holds three language bodies and
 * shows one, so a disclosure can be present in the file and hidden on the
 * page; and a notice is read on a phone as often as on a laptop, where one
 * unbreakable string turns the whole page into a sideways scroll.
 *
 * So this runs on desktop (chromium/firefox/webkit) and — via the testMatch
 * entries in playwright.config.js — on mobile-iphone / mobile-ipad /
 * mobile-android, in each of the three published languages.
 *
 * privacy.html needs no session and no database, so there is nothing to mock.
 */

// @ts-check
const { test, expect } = require("@playwright/test");

const LANGS = {
  en: {
    url: "/privacy.html",
    identifier: /signed in\s+anonymously/,
    period: /90 days\s+without being used/,
    counters: /usage counters are deleted within\s+about three days/,
    device: /sign-in credential behind the technical\s+identifier/
  },
  fr: {
    url: "/privacy.html?lang=fr",
    identifier: /connecté\s+de façon\s+anonyme/,
    period: /90 jours\s+sans utilisation/,
    counters: /sont supprimés sous trois jours environ/,
    device: /informations de connexion\s+correspondant à l'identifiant technique/
  },
  ja: {
    url: "/privacy.html?lang=ja",
    identifier: /匿名でサインインされます/,
    period: /90日間利用がなければ削除します/,
    counters: /利用回数カウンターは、おおむね3日以内に削除します/,
    device: /技術的識別子のサインイン情報も保存されます/
  }
};

for (const [lang, spec] of Object.entries(LANGS)) {
  test(`privacy notice [${lang}] shows the identifier, its period, and fits the screen`, async ({ page }) => {
    await page.goto(spec.url);

    const body = page.locator(`section[data-priv-lang="${lang}"]`);
    await expect(body, "the " + lang + " body should be the one on screen").toBeVisible();
    /* The other two bodies carry the same sentences. If one of them were the
       visible one, every text assertion below would pass on the wrong language. */
    for (const other of Object.keys(LANGS).filter((l) => l !== lang)) {
      await expect(page.locator(`section[data-priv-lang="${other}"]`)).toBeHidden();
    }

    await expect(body).toContainText("PIS v12");
    await expect(body).toContainText(spec.identifier);
    await expect(body).toContainText(spec.period);
    await expect(body).toContainText(spec.counters);
    await expect(body).toContainText(spec.device);

    /* The retention item is the one a participant is most likely to look for;
       it has to be reachable, not merely present. */
    const item = body.locator("li", { hasText: spec.period });
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeInViewport();

    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
    });
    expect(overflow.scrollWidth,
      "the notice scrolls sideways at this width").toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
}
