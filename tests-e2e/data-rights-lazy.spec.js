/* tests-e2e/data-rights-lazy.spec.js
 *
 * Contract for the GDPR Art. 15 self-export lazy split (perf reclaim,
 * 2026-09-08). downloadMyData() moved out of the eager script.js into
 * data-rights.js, <script>-injected by CanamedLoader.ensureDataRights() from
 * the #gdpr-export-btn click on the waiting screen.
 *
 * Both halves are load-bearing:
 *   1. data-rights.js must NOT be fetched on the splash — otherwise the reclaim
 *      is undone and the budget silently regresses.
 *   2. The export must still WORK, on the real join flow: a right that a split
 *      quietly broke would be far worse than the bytes it saved. The last test
 *      joins a session for real (LOCAL mode), clicks the real button, and reads
 *      the bytes of the JSON the browser is handed.
 *
 * The static half is tests/data-rights-lazy-split.test.js. Runs on desktop +
 * the three mobile projects (registered in playwright.config.js).
 */
// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures.js");

const defined = (page) => page.evaluate(() => typeof window.downloadMyData === "function");

test("data-rights.js is NOT loaded on the splash (the perf reclaim holds)", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });
  await page.goto("/");
  await expect(page.locator("#splash")).toBeVisible();
  await page.waitForTimeout(1200);   // let the idle-prefetch window run
  expect(scripts.join("\n")).not.toMatch(/data-rights\.js/);
  expect(await defined(page)).toBe(false);   // and script.js kept no copy
});

test("ensureDataRights() defines the export, idempotently", async ({ page }) => {
  await page.goto("/");
  expect(await defined(page)).toBe(false);
  await page.evaluate(() => window.CanamedLoader.ensureDataRights());
  expect(await defined(page)).toBe(true);
  await page.evaluate(() => window.CanamedLoader.ensureDataRights());
  expect(await page.locator('script[src*="data-rights.js"]').count()).toBe(1);
});

/* Create a session, join it as a participant, land on the waiting screen —
   the screen that carries the data-rights row. Same flow as
   withdraw-consent-ui.spec.js, the sibling button. */
async function joinAsParticipant(page) {
  await forceLocalMode(page);
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("E2E Facilitator");
  await page.locator("#splash-create-label").fill("Export probe");
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  await page.evaluate(() => {
    const s = /** @type {any} */ (document.getElementById("splash-section-add"));
    // @ts-ignore — splash globals
    splashSectionPick.length = 0;
    // @ts-ignore
    splashSectionPick.push(s.options[0].value);
    // @ts-ignore
    renderSectionPick();
  });
  await page.locator("#splash-create-pass").fill("e2e-pass-2026");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/[A-Z0-9]{3}-?[A-Z0-9]{3}/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 20_000 });
  await page.locator("#name-input").fill("E2E Student");
  const uni = await page.locator("#uni-input option:not([disabled])").first().getAttribute("value");
  await page.locator("#uni-input").selectOption(uni);
  await page.locator("#consent-workshop").check();
  await page.locator("#consent-research").check();
  await expect(page.locator("#join-btn")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#join-btn").click();
  await expect(page.locator("#gdpr-export-btn")).toBeVisible({ timeout: 20_000 });
  return code.replace(/-/g, "");
}

test("clicking the export button loads the chunk and downloads the real Art. 15 export", async ({ page }) => {
  const code = await joinAsParticipant(page);
  // Nothing loaded yet: the wiring is synchronous, the chunk is not.
  expect(await page.locator('script[src*="data-rights.js"]').count()).toBe(0);
  expect(await defined(page)).toBe(false);
  /* Capture the Blob at createObjectURL rather than waiting on a "download"
     event (engine-specific headless plumbing; the exporter revokes its URL on
     the same tick) — same technique as takehome-lazy.spec.js. */
  await page.evaluate(() => {
    const realCreate = URL.createObjectURL.bind(URL);
    window.__dl = { text: null, name: null };
    URL.createObjectURL = function (blob) {
      try { blob.text().then((t) => { window.__dl.text = t; }); } catch (e) { /* not a Blob */ }
      return realCreate(blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__dl.name = this.download;
    };
  });
  await page.locator("#gdpr-export-btn").click();
  await page.waitForFunction(() => window.__dl && window.__dl.text, null, { timeout: 20_000 });
  expect(await page.locator('script[src*="data-rights.js"]').count()).toBe(1);
  const out = await page.evaluate(() => window.__dl);
  expect(out.name).toMatch(/^canamed-my-data-.+\.json$/);
  const json = JSON.parse(out.text);
  // The envelope a participant walks away with, end to end.
  expect(json.type).toBe("participant-self-export-art-15-gdpr");
  expect(json.canamedSchemaVersion).toBe("1.0.0");
  // The app stores the code lowercase; the splash displays it uppercase.
  expect(String(json.sessionCode).replace(/-/g, "").toLowerCase()).toBe(code.toLowerCase());
  expect(json.pool && json.pool.name).toBe("E2E Student");
  for (const k of ["answers", "votes", "tests", "manualScoresAboutMe", "helpCallsByMe"]) {
    expect(json).toHaveProperty(k);
  }
  expect(json.answers).toEqual({ moduleA: [], moduleB: [], moduleBranched: [] });
});
