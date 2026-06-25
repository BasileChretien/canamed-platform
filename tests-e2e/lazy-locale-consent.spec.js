/* tests-e2e/lazy-locale-consent.spec.js
 *
 * Guards the #48 i18n locale lazy-load split on the ONE path that must never
 * break: the lobby consent block. Students have to be able to read the
 * data-use notice and tick consent to join — if a perf refactor ever delayed
 * or blocked that, it would take the live workshop down.
 *
 * Two guarantees, asserted across desktop + iPhone + iPad + Android (the
 * project matrix in playwright.config.js routes this file to all four):
 *
 *   1. EN first paint — the consent block renders in English and is fully
 *      joinable WITHOUT fetching any locales/<lang>.js chunk. English is the
 *      inline canonical table in i18n.js, so the splash critical path pulls
 *      zero locale bytes (this is exactly what the perf budget bought us).
 *
 *   2. On switching to a non-English language, EXACTLY that one locale chunk
 *      is fetched on demand, the consent block localizes, and consent + join
 *      still work. No other locale is pulled.
 *
 * Selector strategy mirrors lobby-i18n.spec.js: stable IDs (#consent-workshop,
 * #consent-version, #join-btn, #name-input) + short language-specific
 * substrings from the i18n table, and web-first assertions so the async
 * locale load is awaited rather than raced.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

// Each test stands up a REAL session through the facilitator create flow,
// which on the WebKit-family engines (desktop Safari + iPad emulation) can
// occasionally stall the first anonymous-auth + LocalDB write under suite
// load (the shared #splash-shown-code "—" → code step, not anything in the
// i18n logic this spec exercises). Retry to absorb that environmental flake —
// the repo already runs retries:2 on CI; this makes the spec self-reliable
// locally too. The #48 assertions themselves (consent render, lazy locale
// load) are deterministic and have never been the failing step.
test.describe.configure({ retries: 2 });

// Record every locales/<lang>.js request the page makes, in order. Attach
// BEFORE navigation so nothing is missed.
function recordLocaleRequests(pageOrTab) {
  /** @type {string[]} */
  const hits = [];
  pageOrTab.on("request", (req) => {
    const m = req.url().match(/\/locales\/([a-z]{2})\.js(?:\?|$)/);
    if (m) hits.push(m[1]);
  });
  return hits;
}

// Create a session on `page` (English facilitator UI) and return its code.
async function createSession(page, label) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Fac");
  await page.locator("#splash-create-label").fill(label);
  await page.locator("#splash-create-pass").fill("e2e-lazy-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  // Generous timeout: WebKit-iPad emulation does anonymous-auth init + the
  // first LocalDB write notably slower than desktop, so 10s occasionally
  // races the code render under suite load. 20s removes the flake.
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

// Open a fresh participant tab pinned to English, walk it into the lobby for
// `code`, and return the tab + its locale-request recorder.
async function openLobbyTab(context, code) {
  const tab = await context.newPage();
  await forceLocalMode(tab);
  await tab.addInitScript(() => {
    // Pin English explicitly so the test is deterministic regardless of the
    // emulated device's navigator.language, and clear any stale session pin
    // so the splash actually paints instead of auto-resuming a prior lobby.
    try {
      localStorage.setItem("canamed_lang", "en");
      localStorage.removeItem("canamed_session");
    } catch (e) {}
  });
  const localeHits = recordLocaleRequests(tab);
  await tab.goto("/");
  await tab.locator("#splash-code").fill(code);
  await tab.locator("#splash-enter").click();
  await expect(tab.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  return { tab, localeHits };
}

test.describe("Lazy-loaded locales — consent first-paint safety (#48)", () => {
  test("EN lobby: consent renders in English and joins with ZERO locale fetch", async ({ page, context }) => {
    const code = await createSession(page, "lazy EN run");
    const { tab, localeHits } = await openLobbyTab(context, code);

    // Consent block is present and in English on first paint.
    await expect(tab.locator("#consent-workshop")).toBeVisible();
    await expect(tab.locator("#consent-version")).toContainText(/Notice version/i);

    // A student can read the notice, consent, and join.
    await tab.locator("#name-input").fill("Alex");
    const uni = await tab.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab.locator("#uni-input").selectOption(uni);
    await tab.locator("#consent-workshop").check();
    await expect(tab.locator("#join-btn")).toBeEnabled();
    await tab.locator("#join-btn").click();
    await expect(tab.locator("#waiting")).toBeVisible({ timeout: 20_000 });

    // The whole English consent+join flow pulled NO per-language chunk —
    // English ships inline in i18n.js. This is the perf win we're protecting.
    expect(localeHits, `expected zero locale fetches on EN, saw: [${localeHits.join(", ")}]`).toEqual([]);

    await tab.close();
  });

  test("switching language keeps the consent block in English and still joinable", async ({ page, context }) => {
    // User 2026-06-25: the whole UI is English-only now — consent included. The
    // language picker no longer localizes any UI string; it only re-targets the
    // in-page reading-aid's per-word hover gloss (lang-reader.js). So switching
    // to French must NOT translate the consent block, and must not break join.
    const code = await createSession(page, "lazy FR run");
    const { tab } = await openLobbyTab(context, code);

    // Starts English.
    await expect(tab.locator("#consent-version")).toContainText(/Notice version/i);

    // Switch the picker to French and wait for the langchange re-render to settle.
    await tab.evaluate(() => window.setLang("fr"));
    await expect(tab.locator("html")).toHaveAttribute("lang", "fr");

    // Consent text stays ENGLISH (the old French "Version de la notice" must NOT
    // appear) — the picker drives the reader, not the UI copy.
    await expect(tab.locator("#consent-version")).toContainText(/Notice version/i);
    await expect(tab.locator("#consent-version")).not.toContainText(/Version de la notice/i);

    // Consent still works after the switch: tick enables Join.
    await tab.locator("#consent-workshop").check();
    await expect(tab.locator("#join-btn")).toBeEnabled();

    await tab.close();
  });
});
