/* tests-e2e/privacy-ja-spacing.spec.js
 *
 * The Japanese privacy notice must not show a space inside a phrase.
 *
 * tests/privacy-ja-line-breaks.test.js guards the CAUSE, in the source: a line
 * break that renders as a space inside Japanese text. That test reasons about
 * what a browser does with the line break. This spec looks at what the
 * browsers actually show, because they do not agree. Measured on the notice as
 * it stood before the line breaks were removed (Playwright 1.63, 375 px):
 *
 *   Chromium 153   103 spaces inside a phrase
 *   WebKit 26.6    103
 *   Firefox 155      6
 *
 * Firefox drops a line break between two wide East Asian characters; the other
 * two engines render it as a space. So a check made in Firefox alone would
 * have reported a notice that most readers saw broken as nearly clean.
 *
 * THE CHECK. Collect every space in the rendered Japanese body that sits
 * between two Japanese characters and does not follow 。 or 、. Each one must
 * be a space TYPED in the source on a single line. The notice has a few of
 * those on purpose (section 3 separates a legal citation from its gloss with
 * one), and the expected set is read from the source rather than listed here,
 * so adding or removing a deliberate space needs no change to this file.
 *
 * WHERE IT RUNS. On the three desktop projects, at four widths: desktop,
 * tablet, phone and the narrowest phone the platform supports. privacy.html
 * has no device-specific behaviour, so the width is all a device changes on
 * this page. It is NOT listed in the mobile projects' testMatch.
 *
 * privacy.html needs no session and no database, so there is nothing to mock.
 */

// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "privacy.html");

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1194 },
  phone: { width: 412, height: 839 },
  "narrow phone": { width: 375, height: 812 }
};

/** Kana, CJK punctuation, the ideographs and the full-width forms. */
function isJapanese(ch) {
  const c = ch.codePointAt(0) || 0;
  return (
    (c >= 0x3000 && c <= 0x30ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xffef)
  );
}

/**
 * Every space in `text` between two Japanese characters that does not follow
 * 。 or 、, with a little of the text around it.
 * @param {string} text
 * @returns {{ pair: string, context: string }[]}
 */
function spacesInsidePhrases(text) {
  const found = [];
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] !== " ") continue;
    const left = text[i - 1];
    const right = text[i + 1];
    if (left === "。" || left === "、") continue;
    if (!isJapanese(left) || !isJapanese(right)) continue;
    found.push({ pair: left + right, context: text.slice(Math.max(0, i - 8), i + 9) });
  }
  return found;
}

/**
 * The same spaces as the SOURCE types them: on one line, tags removed. A line
 * break is never one of these, which is the point of the comparison.
 * @returns {{ pair: string, context: string }[]}
 */
function typedSpaces() {
  const html = fs.readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n");
  const section = /<section data-priv-lang="ja"[^>]*>[\s\S]*?<\/section>/.exec(html);
  if (!section) throw new Error("privacy.html has no Japanese section");
  return section[0]
    .split("\n")
    .flatMap((line) => spacesInsidePhrases(line.replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ")));
}

const pairs = (/** @type {{ pair: string }[]} */ list) => list.map((s) => s.pair).sort();

/**
 * The rendered spaces that no typed space accounts for.
 * @param {{ pair: string, context: string }[]} rendered
 * @param {{ pair: string }[]} typed
 */
function notTyped(rendered, typed) {
  const budget = new Map();
  for (const s of typed) budget.set(s.pair, (budget.get(s.pair) || 0) + 1);
  return rendered.filter((s) => {
    const left = budget.get(s.pair) || 0;
    if (left > 0) budget.set(s.pair, left - 1);
    return left === 0;
  });
}

test.describe("Japanese privacy notice: no space inside a phrase", () => {
  const typed = typedSpaces();

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`every rendered space between Japanese characters is a typed one (${name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/privacy.html?lang=ja");

      const body = page.locator('section[data-priv-lang="ja"]');
      await expect(body).toBeVisible();
      await expect(page.locator('section[data-priv-lang="en"]')).toBeHidden();

      const text = await body.innerText();
      // Anti-vacuity: an empty or hidden body has no stray space either.
      expect(Array.from(text).filter(isJapanese).length).toBeGreaterThan(2000);

      const rendered = spacesInsidePhrases(text);
      expect(
        notTyped(rendered, typed).map((s) => s.context),
        "a space is shown inside Japanese text that nobody typed: a line break in the source renders as one"
      ).toEqual([]);
      expect(pairs(rendered), "a space typed in the source is missing from the rendered notice").toEqual(pairs(typed));

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(sideways, "the notice must not scroll sideways").toBeLessThanOrEqual(2);
    });
  }

  test("the collector sees a space when there is one", async ({ page }) => {
    await page.setContent("<p>第27条第5項 共同利用。 次の文、 そして第21条 利用目的</p>");
    const found = spacesInsidePhrases(await page.locator("p").innerText());
    expect(pairs(found)).toEqual(["条利", "項共"]);
  });
});
