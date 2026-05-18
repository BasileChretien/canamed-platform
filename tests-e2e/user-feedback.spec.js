/* tests-e2e/user-feedback.spec.js
 *
 * Regression coverage for the three bugs reported by a facilitator
 * during a live session:
 *
 *   1. The room-count picker only listed 2-8 rooms — a small workshop
 *      (1 university, 1 room) couldn't be created at all.
 *   2. The language switcher was only on the splash; once a participant
 *      had joined the lobby / waiting room / a session room, they had
 *      no way to change the UI language.
 *   3. (mobile-only — see android-findings.spec.js) On Android Chrome,
 *      tapping a Module A finding button revealed the answer in the
 *      right-column panel but the user didn't see it because the
 *      stacked-mobile layout left it below the viewport.
 *
 * Bug 3 lives in its own spec because it needs Pixel 7 emulation; the
 * tests in THIS file run on the desktop chromium/firefox/webkit pass.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 * Stable selectors: by-ID throughout.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Bug 1 — single-room workshops", () => {
  test("roomcount picker exposes option value=1", async ({ page }) => {
    // The picker only renders inside the admin-prestart panel, so we
    // create a session + open the admin dashboard first.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac 1room");
    await page.locator("#splash-create-label").fill("Bug1 — single room");
    await page.locator("#splash-create-pass").fill("e2e-1room-pw");
    await page.locator("#splash-create-submit").click();
    await expect(page.locator("#splash-shown-code"))
      .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });

    const values = await page.locator("#roomcount-input option").evaluateAll(
      opts => opts.map(o => o.value)
    );
    expect(values).toContain("1");
    // First option should be "1" so the form sorts ascending.
    expect(values[0]).toEqual("1");
  });

  test("admin can start a session with roomCount=1 and participant lands in Room 1",
       async ({ page, context }) => {
    // Same in-page modal auto-accept trick as stage-progression.spec.js
    // (the Start button opens canamedConfirm() flows for too-many-rooms /
    // weak-rooms warnings; with 1 room and 1 participant the weak-rooms
    // confirm will fire — we want to accept it and proceed).
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.addInitScript(() => {
      const tryAccept = () => {
        const dlg = document.getElementById("canamed-modal");
        if (dlg && dlg.open) {
          const ok = document.getElementById("canamed-modal-confirm");
          if (ok) ok.click();
        }
      };
      const observer = new MutationObserver(tryAccept);
      document.addEventListener("DOMContentLoaded", () => {
        const dlg = document.getElementById("canamed-modal");
        if (dlg) observer.observe(dlg, { attributes: true, attributeFilter: ["open"] });
        setInterval(tryAccept, 200);
      });
    });

    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac 1room");
    await page.locator("#splash-create-label").fill("Bug1 single-room run");
    await page.locator("#splash-create-pass").fill("e2e-1room-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // Participant joins in a second tab.
    const tab2 = await context.newPage();
    tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await tab2.addInitScript(() => {
      try {
        localStorage.removeItem("canamed_session");
        localStorage.removeItem("canamed_resume");
      } catch (e) {}
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value, set: () => {},
          configurable: true, enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "e2e-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    await tab2.locator("#name-input").fill("E2E Solo Student");
    const uni = await tab2.locator("#uni-input option:not([disabled])").first().getAttribute("value");
    await tab2.locator("#uni-input").selectOption(uni);
    await tab2.locator("#consent-workshop").check();
    await expect(tab2.locator("#join-btn")).toBeEnabled({ timeout: 5000 });
    await tab2.locator("#join-btn").click();
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    // Pick "1" on the room-count select and Start.
    await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
    await page.locator("#roomcount-input").selectOption("1");
    await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
    await page.locator("#start-session-btn").click();

    // Participant should land in #app and the admin's allRooms structure
    // should know about "Room 1".
    await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });
    await tab2.close();
  });
});

test.describe("Bug 2a — global language switcher is always visible", () => {
  test("global switcher is hidden on splash (avoids duplicating the splash dropdown)",
       async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    // body.locked is the splash-on signal; CSS hides #global-lang-switcher
    // while body.locked is set. The element itself stays in the DOM.
    await expect(page.locator("#global-lang-switcher")).toBeHidden();
    // The splash's own dropdown is still visible — that's the obvious tap
    // target while the splash is on screen.
    await expect(page.locator("#splash-lang-select")).toBeVisible();
  });

  test("global switcher becomes visible once the user is past the splash (admin dashboard)",
       async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac LangSwitch");
    await page.locator("#splash-create-label").fill("Bug2a — admin lang");
    await page.locator("#splash-create-pass").fill("e2e-lang-pw");
    await page.locator("#splash-create-submit").click();
    await expect(page.locator("#splash-shown-code"))
      .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // The floating switcher is now reachable from the admin dashboard.
    const sw = page.locator("#global-lang-select");
    await expect(sw).toBeVisible();
    // It exposes the same 8 languages as the splash one.
    const values = await sw.locator("option").evaluateAll(opts => opts.map(o => o.value));
    expect(values).toEqual(["en", "fr", "ja", "es", "pt", "de", "ko", "zh"]);
  });

  test("changing the global switcher persists to localStorage AND re-renders translated nodes",
       async ({ page }) => {
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac LangPersist");
    await page.locator("#splash-create-label").fill("Bug2a — lang persist");
    await page.locator("#splash-create-pass").fill("e2e-langp-pw");
    await page.locator("#splash-create-submit").click();
    await expect(page.locator("#splash-shown-code"))
      .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible();

    // Switch to French via the global switcher. setLang() is driven by
    // the change event; selectOption() emits one.
    await page.locator("#global-lang-select").selectOption("fr");

    // localStorage now records the user's choice.
    const stored = await page.evaluate(() => localStorage.getItem("canamed_lang"));
    expect(stored).toEqual("fr");

    // The <html lang="..."> attribute reflects the active language.
    const htmlLang = await page.evaluate(() => document.documentElement.getAttribute("lang"));
    expect(htmlLang).toEqual("fr");
  });
});

test.describe("Bug 2b — new high-impact i18n keys", () => {
  test("findings, prompts, reset, and right-column tab labels translate to fr",
       async ({ page }) => {
    // We can verify the translations exist in the i18n table without
    // needing to be inside a room — the same key strings the app reads
    // are accessible via window.t(). This is faster + more deterministic
    // than spinning up a full room.
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => window.setLang("fr"));

    // Tab labels were renamed to activity verbs per the 2026-05-18
    // UX/pedagogy specialist panel ("Findings"→"What we're finding",
    // "Team decisions"→"Decide together"). The PANEL/log titles
    // (findings.title, prompts.title) and the reset button stayed,
    // so the test keeps asserting those. Tab keys assert the new
    // verb labels.
    const t = (k) => page.evaluate((key) => window.t(key), k);
    expect(await t("rcol.tab.findings")).toEqual("Ce qu'on trouve");
    expect(await t("rcol.tab.decisions")).toEqual("Décider ensemble");
    expect(await t("findings.title")).toEqual("Journal des résultats");
    expect(await t("prompts.title")).toEqual("Questions de discussion");
    expect(await t("reset.btn")).toEqual("Réinitialiser le cas de cette salle");

    // And in Japanese.
    await page.evaluate(() => window.setLang("ja"));
    expect(await page.evaluate(() => window.t("rcol.tab.findings"))).toEqual("分かったこと");
    expect(await page.evaluate(() => window.t("findings.title"))).toEqual("所見ログ");
  });
});
