/* tests-e2e/retention-notice.spec.js
 *
 * The retention period a participant actually READS, on the four viewports the
 * project supports (desktop + iPhone + iPad + Android — playwright.config.js
 * routes this file to all four).
 *
 * tests/retention-notice-consistency.test.js already proves, at source level,
 * that every published string agrees with the days the cleanup job enforces.
 * That is the stronger guarantee, but it is blind to one failure mode: a string
 * can be correct in i18n.js and never reach the screen — collapsed inside a
 * <details> that no longer opens, overwritten by the hardcoded index.html
 * fallback, or clipped off a narrow viewport. This spec closes that gap by
 * reading the rendered DOM in the lobby, where consent is actually given.
 *
 * Two claims are asserted, because they are the two that were wrong:
 *
 *   1. the 30-day / 90-day purge periods (the notice said "7 days" for months
 *      while the deployed job kept closed sessions 30 days and abandoned ones
 *      90 — found 2026-07-29 preparing the CER Unicaen ethics dossier);
 *   2. the research copy is stored LINKED to the participant (identifiable),
 *      never "pseudonymised" — five locale files and the index.html fallback
 *      used to claim the latter, which is a materially different Art. 13 claim.
 *
 * The lobby UI is English-only by deliberate decision (user 2026-06-25); the
 * language picker drives the reading aid, not the UI copy. So this spec reads
 * the English rendering — that IS what every participant sees. The per-language
 * translation tables are covered by the source-level suite.
 *
 * Selector strategy mirrors lazy-locale-consent.spec.js: stable IDs and the
 * data-i18n-html attribute, with web-first assertions so the i18n re-render is
 * awaited rather than raced.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

// WebKit-family emulation (desktop Safari + iPad) occasionally stalls the first
// anonymous-auth + LocalDB write under suite load on the shared create-session
// step — environmental, not this spec's assertions. Same mitigation as the
// sibling consent spec.
test.describe.configure({ retries: 2 });

async function createSession(page, label) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-retention-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

async function openLobbyTab(context, code) {
  const tab = await context.newPage();
  await forceLocalMode(tab);
  await tab.addInitScript(() => {
    try {
      localStorage.setItem("canamed_lang", "en");
      localStorage.removeItem("canamed_session");
    } catch (e) {}
  });
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  return tab;
}

// The notice lives inside the collapsed <details> above the consent boxes.
// Open it the way a participant does, then hand back the p3 paragraph.
async function openNotice(tab) {
  const p3 = tab.locator('[data-i18n-html="lobby.privacy.p3"]');
  await expect(p3).toHaveCount(1);
  const summary = tab.locator('[data-i18n="lobby.privacy.summary"], summary').first();
  if (await summary.count()) {
    // Idempotent: clicking an already-open <details> would close it.
    const isOpen = await p3.isVisible().catch(() => false);
    if (!isOpen) await summary.click();
  }
  await expect(p3).toBeVisible({ timeout: 10_000 });
  return p3;
}

test.describe("Retention notice — what the participant actually reads", () => {
  test("the rendered notice states the enforced 30/90-day periods, never 7 days", async ({ page, context }) => {
    const code = await createSession(page, "retention notice run");
    const tab = await openLobbyTab(context, code);
    const p3 = await openNotice(tab);

    const text = (await p3.innerText()).replace(/\s+/g, " ").trim();

    expect(text, "rendered notice must state the 30-day closed-session purge")
      .toMatch(/30\s*days/i);
    expect(text, "rendered notice must state the 90-day abandoned-session purge")
      .toMatch(/90\s*days/i);
    // The literal defect: a stale "7 days" reaching a participant's screen.
    expect(text, "rendered notice still claims the retired 7-day purge")
      .not.toMatch(/(?:^|[^\d])7\s*days/i);

    await tab.close();
  });

  test("the rendered notice describes the research copy as identifiable, not pseudonymised", async ({ page, context }) => {
    const code = await createSession(page, "retention identifiable run");
    const tab = await openLobbyTab(context, code);
    const p3 = await openNotice(tab);

    const text = (await p3.innerText()).replace(/\s+/g, " ").trim();

    expect(text, "rendered notice must disclose that research data stays linked to the participant")
      .toMatch(/linked to you\s*\(identifiable\)/i);
    expect(text, "rendered notice must state the 5-year research retention")
      .toMatch(/5\s*years/i);
    expect(text, "rendered notice must not call the research dataset pseudonymised")
      .not.toMatch(/pseudonym/i);

    await tab.close();
  });

  test("the notice is reachable and legible without horizontal overflow", async ({ page, context }) => {
    // A correct string clipped off a narrow viewport is still a notice the
    // participant did not read. Horizontal overflow is the repo's known mobile
    // failure mode (it zooms the page out and breaks hit-testing), so assert
    // the document does not scroll sideways while the notice is open.
    const code = await createSession(page, "retention layout run");
    const tab = await openLobbyTab(context, code);
    const p3 = await openNotice(tab);

    const box = await p3.boundingBox();
    expect(box, "the notice paragraph has no layout box").not.toBeNull();
    expect(box.width, "the notice paragraph collapsed to nothing").toBeGreaterThan(80);

    const overflow = await tab.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(
      overflow.scrollWidth,
      `page overflows horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await tab.close();
  });
});
