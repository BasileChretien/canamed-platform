/* tests-e2e/lang-reader.spec.js
 *
 * The in-page reading aid (lang-reader.js + reader-core.js): with "Word help"
 * on, hovering (desktop) or tapping (touch) a glossed word shows a popover with
 * the term + a gloss in the chosen language — fully client-side, no network.
 *
 * Runs per-device (registered in the mobile testMatch) because the desktop
 * path is HOVER and the touch path is TAP — different code branches we must
 * exercise on real engines. The end-to-end pipeline check goes through the
 * browser's own caret hit-testing (caretRangeFromPoint / caretPositionFromPoint)
 * so it covers chromium/webkit/firefox.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const SENTENCE = "Consider an opioid taper now.";
const WORD = "opioid";
const FR_NEEDLE = "antalgique"; // in the French gloss for "opioid"
const JA_NEEDLE = "モルヒネ";    // in the Japanese gloss for "opioid"

async function setup(page, lang) {
  await page.goto("/");
  await page.evaluate(async () => {
    if (window.CanamedLoader) {
      if (window.CanamedLoader.ensureGlossary) await window.CanamedLoader.ensureGlossary();
      if (window.CanamedLoader.ensureLangReader) await window.CanamedLoader.ensureLangReader();
    }
    // Reveal the body — the splash gate covers it otherwise.
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    // A known glossed word, pinned near the top so coords are scroll-free.
    const p = document.createElement("p");
    p.id = "reader-fixture";
    p.textContent = "Consider an opioid taper now.";
    p.style.cssText =
      "position:fixed;top:120px;left:20px;margin:0;font-size:28px;" +
      "z-index:9999;background:#fff;color:#000";
    document.body.appendChild(p);
  });
  if (lang) await page.evaluate((l) => window.setLang(l), lang);
}

async function enable(page, on) {
  await page.evaluate((v) => window.CanamedReader.setEnabled(v), on);
  // Deterministically wait for the ACTIVE language's offline dictionary to
  // finish loading (fetch + DecompressionStream, ~1.5 MB) before any lookup.
  // The gloss pipeline (lookupAt → getDict) otherwise races the dict download
  // and reads the English fallback — the flake the 15s expect.poll only papered
  // over (recurred 2026-07-15 at :94 chromium / :137 mobile-android, blocking
  // the #198 + #199 deploys). ensureDict resolves to the loaded Map (or null for
  // en / unsupported), and targetLang() === window.getLang(), so awaiting
  // ensureDict(getLang()) matches exactly what the reader itself loads.
  if (on) {
    await page.evaluate(async () => {
      const d = window.CanamedReaderDict;
      const lang = (typeof window.getLang === "function") ? window.getLang() : "en";
      if (d && d.ensureDict) await d.ensureDict(lang);
    });
  }
}

// Viewport centre of the word "opioid" within the fixture sentence.
function wordCenter(page) {
  return page.evaluate(({ sentence, word }) => {
    const p = document.getElementById("reader-fixture");
    const txt = p.firstChild;
    const i = sentence.indexOf(word);
    const r = document.createRange();
    r.setStart(txt, i);
    r.setEnd(txt, i + word.length);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { sentence: SENTENCE, word: WORD });
}

// Resolve the gloss text under a viewport point via the reader's own pipeline.
// Returns the localized gloss string, or null when nothing resolves there yet.
// Used with expect.poll so a lookup auto-retries while the reader's locale +
// bundled dictionary finish settling (they load async) instead of flaking on a
// single cold probe.
function lookupTextAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const res = window.CanamedReader.lookupAt(x, y);
    return res && res.hit ? res.hit.text : null;
  }, { x, y });
}

test.describe("Word help — in-page reading aid", () => {
  test("resolves the word under the cursor to its French gloss (full pipeline)", async ({ page }) => {
    await setup(page, "fr");
    await enable(page, true);
    const { x, y } = await wordCenter(page);
    // The reader's locale + bundled dictionary settle asynchronously, so a
    // one-shot lookup can fire before French is applied and read the English
    // fallback. Auto-retry the lookup (like the popover assertions below) so it
    // waits for the gloss to resolve instead of flaking on a cold/slow run.
    await expect.poll(() => lookupTextAt(page, x, y), { timeout: 15_000 }).toContain(FR_NEEDLE);
    const hit = await page.evaluate(({ x, y }) => {
      const res = window.CanamedReader.lookupAt(x, y);
      return res ? { term: res.hit.term, text: res.hit.text, en: res.hit.en } : null;
    }, { x, y });
    expect(hit.term).toBe(WORD);
    expect(hit.text).toContain(FR_NEEDLE);
    expect(hit.text).not.toBe(hit.en); // really the French, not the English fallback
  });

  test("Word help works in the admin dashboard (dictionaries usable over the leaderboard)", async ({ page }) => {
    // User 2026-06-25: the hover dictionaries must be usable in the admin
    // leaderboard. The reader is document-wide + default-on and the toggle lives
    // in the global-settings cog (reachable in the admin view) — this pins that
    // it glosses text rendered inside #admin-app.
    await page.goto("/");
    await page.evaluate(async () => {
      if (window.CanamedLoader) {
        if (window.CanamedLoader.ensureGlossary) await window.CanamedLoader.ensureGlossary();
        if (window.CanamedLoader.ensureLangReader) await window.CanamedLoader.ensureLangReader();
      }
      ["splash", "lobby", "waiting", "app", "session-ended"].forEach(id => {
        const e = document.getElementById(id); if (e) e.classList.add("hidden");
      });
      document.body.classList.remove("locked");
      const admin = document.getElementById("admin-app");
      if (admin) {
        admin.classList.remove("hidden");
        const p = document.createElement("p");
        p.id = "admin-reader-fixture";
        p.textContent = "Consider an opioid taper now.";
        p.style.cssText =
          "position:fixed;top:120px;left:20px;margin:0;font-size:28px;" +
          "z-index:9999;background:#fff;color:#000";
        admin.appendChild(p);
      }
    });
    await page.evaluate((l) => window.setLang(l), "fr");
    await enable(page, true);
    // The reader toggle (global-settings cog) is present/reachable in admin too.
    await expect(page.locator("#reader-toggle")).toHaveCount(1);
    const { x, y } = await page.evaluate(({ sentence, word }) => {
      const p = document.getElementById("admin-reader-fixture");
      const txt = p.firstChild;
      const i = sentence.indexOf(word);
      const r = document.createRange();
      r.setStart(txt, i); r.setEnd(txt, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, { sentence: SENTENCE, word: WORD });
    // Auto-retry: the reader may still be applying French when we first probe.
    await expect
      .poll(() => lookupTextAt(page, x, y), { timeout: 15_000 })
      .toContain(FR_NEEDLE);
  });

  test("hover (desktop) / tap (touch) opens the popover with the gloss", async ({ page }, testInfo) => {
    const isTouch = !!(testInfo.project.use && testInfo.project.use.hasTouch);
    await setup(page, "fr");
    await enable(page, true);
    const { x, y } = await wordCenter(page);
    if (isTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.move(x, y);
    const popPromise = page.locator(".reader-pop");
    await expect(popPromise).toBeVisible();
    await expect(popPromise).toContainText(FR_NEEDLE);
  });

  test("Japanese is selected when the chosen language is ja", async ({ page }) => {
    await setup(page, "ja");
    await enable(page, true);
    const { x, y } = await wordCenter(page);
    await expect
      .poll(() => lookupTextAt(page, x, y), { timeout: 15_000 })
      .toContain(JA_NEEDLE);
  });

  test("no popover when Word help is OFF", async ({ page }, testInfo) => {
    const isTouch = !!(testInfo.project.use && testInfo.project.use.hasTouch);
    await setup(page, "fr");
    await enable(page, false);
    const { x, y } = await wordCenter(page);
    if (isTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.move(x, y);
    // Give the debounce a beat, then assert nothing showed.
    await page.waitForTimeout(200);
    await expect(page.locator(".reader-pop")).toBeHidden();
  });

  test("reader is ON by default — hovering/tapping works without enabling anything", async ({ page }, testInfo) => {
    const isTouch = !!(testInfo.project.use && testInfo.project.use.hasTouch);
    await setup(page, "fr");   // deliberately NO enable() call
    // Out of the box, with no localStorage flag, the reader is active.
    expect(await page.evaluate(() => window.CanamedReader.isEnabled())).toBe(true);
    const { x, y } = await wordCenter(page);
    if (isTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.move(x, y);
    await expect(page.locator(".reader-pop")).toBeVisible();
    await expect(page.locator(".reader-pop")).toContainText(FR_NEEDLE);
  });

  test("the settings checkbox reflects + toggles the reader state (default ON)", async ({ page }) => {
    await setup(page, "fr");
    // The fixed-position word fixture overlays the settings panel on small
    // viewports — drop it; this test only needs the checkbox.
    await page.evaluate(() => {
      const f = document.getElementById("reader-fixture");
      if (f) f.remove();
    });
    // Open the settings panel so the checkbox is interactable.
    await page.evaluate(() => { document.getElementById("global-settings-panel").hidden = false; });
    const cb = page.locator("#reader-toggle");
    // Default ON: the checkbox is checked and the reader is enabled out of the box.
    await expect(cb).toBeChecked();
    expect(await page.evaluate(() => window.CanamedReader.isEnabled())).toBe(true);
    // user → state: a real click turns the reader OFF.
    await cb.click();
    await expect(cb).not.toBeChecked();
    expect(await page.evaluate(() => window.CanamedReader.isEnabled())).toBe(false);
    // state → UI: a programmatic re-enable is mirrored back into the checkbox.
    // (Via the API, not a 2nd synthetic tap, which flakes on mobile WebKit —
    // the change handler has no preventDefault, so real taps toggle natively;
    // we assert the binding, not the browser's tap engine.)
    await page.evaluate(() => window.CanamedReader.setEnabled(true));
    await expect(cb).toBeChecked();
    expect(await page.evaluate(() => window.CanamedReader.isEnabled())).toBe(true);
  });
});

// ── Phase 2: general-dictionary fallback ────────────────────────────────────
// Exercises the real runtime path: fetch dict/en-<lang>.txt.gz, decompress via
// DecompressionStream, parse into a Map, and resolve a word the curated
// clinical glossary doesn't cover. Runs per-device (file is in the mobile
// testMatch) so the gz-decompress path is validated on every engine.
test.describe("Word help — general-dictionary fallback (Phase 2)", () => {
  async function setupDict(page, lang, sentence) {
    await page.goto("/");
    await page.evaluate(async () => {
      if (window.CanamedLoader && window.CanamedLoader.ensureLangReader) {
        await window.CanamedLoader.ensureLangReader();
      }
      document.body.classList.remove("locked");
      const splash = document.getElementById("splash");
      if (splash) splash.classList.add("hidden");
    });
    await page.evaluate((l) => window.setLang(l), lang);
    await page.evaluate(() => window.CanamedReader.setEnabled(true));
    // Block until the dictionary has fetched + decompressed + parsed.
    await page.evaluate((l) => window.CanamedReaderDict.ensureDict(l), lang);
    await page.evaluate((s) => {
      const p = document.createElement("p");
      p.id = "dict-fixture";
      p.textContent = s;
      p.style.cssText =
        "position:fixed;top:120px;left:20px;margin:0;font-size:28px;" +
        "z-index:9999;background:#fff;color:#000";
      document.body.appendChild(p);
    }, sentence);
  }

  function centerOf(page, sentence, word) {
    return page.evaluate(({ sentence, word }) => {
      const txt = document.getElementById("dict-fixture").firstChild;
      const i = sentence.indexOf(word);
      const r = document.createRange();
      r.setStart(txt, i);
      r.setEnd(txt, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, { sentence, word });
  }

  function lookup(page, x, y) {
    return page.evaluate(({ x, y }) => {
      const res = window.CanamedReader.lookupAt(x, y);
      return res ? { term: res.hit.term, text: res.hit.text } : null;
    }, { x, y });
  }

  test("resolves a non-glossary word to French via the bundled dictionary", async ({ page }) => {
    const s = "The patient seemed reluctant to continue.";
    await setupDict(page, "fr", s);
    // 'reluctant' is everyday vocabulary, NOT a curated clinical glossary term.
    // Use the real glossAt resolver rather than a fragile substring scan (a
    // short glossary key could otherwise be a coincidental substring of
    // "reluctant" and wrongly flip this).
    const glossaryResolves = await page.evaluate(() => {
      const c = window.CanamedReaderCore, g = window.CANAMED_GLOSSARY;
      return !!(c && g && c.glossAt("reluctant", 3, g, "fr"));
    });
    expect(glossaryResolves).toBe(false);
    const { x, y } = await centerOf(page, s, "reluctant");
    const hit = await lookup(page, x, y);
    expect(hit, "dictionary resolved 'reluctant'").not.toBeNull();
    expect(hit.term).toBe("reluctant");
    expect(hit.text.toLowerCase()).toMatch(/réticent|réfractaire|récalcitrant/);
  });

  test("resolves a non-glossary word to Japanese (other gz file)", async ({ page }) => {
    const s = "They examined the gallbladder on the scan.";
    await setupDict(page, "ja", s);
    const { x, y } = await centerOf(page, s, "gallbladder");
    const hit = await lookup(page, x, y);
    expect(hit, "dictionary resolved 'gallbladder'").not.toBeNull();
    expect(hit.text).toContain("胆"); // 胆のう (gallbladder)
  });

  test("de-inflects an inflected hover before lookup (plural)", async ({ page }) => {
    const s = "Both gallbladders were imaged.";
    await setupDict(page, "ja", s);
    const { x, y } = await centerOf(page, s, "gallbladders");
    const hit = await lookup(page, x, y);
    // 'gallbladders' (plural) resolves via deinflection to 'gallbladder'.
    expect(hit, "dictionary resolved the plural via deinflection").not.toBeNull();
    expect(hit.text).toContain("胆");
  });

  test("switching language loads the newly-selected dictionary (langchange fires on document)", async ({ page }) => {
    // Regression: i18n.js dispatches `canamed:langchange` on `document`
    // (non-bubbling), so the reader MUST listen there. A `window` listener never
    // fired — meaning on a JA-OS only the init-time ja dict loaded, and switching
    // to French never loaded en-fr.txt.gz, so French hovering silently failed.
    const s = "The patient seemed reluctant to continue.";
    await setupDict(page, "ja", s);                  // start in Japanese (ja dict loaded)
    // Switch to French; the document langchange listener must trigger ensureDict('fr').
    await page.evaluate(() => window.setLang("fr"));
    await page.waitForFunction(
      () => !!(window.CanamedReaderDict && window.CanamedReaderDict.getDict("fr")),
      null, { timeout: 15_000 }
    );
    // A French general-word hover now resolves via the freshly-loaded dict.
    const { x, y } = await centerOf(page, s, "reluctant");
    const hit = await lookup(page, x, y);
    expect(hit, "French dict resolved after switching language").not.toBeNull();
    expect(hit.text.toLowerCase()).toMatch(/réticent|réfractaire|récalcitrant/);
  });
});
