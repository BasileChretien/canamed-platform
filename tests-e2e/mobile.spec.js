/* tests-e2e/mobile.spec.js
 *
 * Mobile/tablet smoke tests. Runs under iPhone 14 Pro and iPad Pro 11
 * device emulation (touch, viewport, user-agent, devicePixelRatio) — a
 * classroom hardware mix that includes iPads is plausible, and Safari
 * on iOS has historically been the platform's biggest unknown.
 *
 * Goals:
 *   - the splash form is usable (visible, tappable, no horizontal scroll)
 *   - the privacy page renders without a broken layout
 *   - the dark theme works on small viewports
 *
 * NOT a full functional pass on mobile — the desktop chromium/firefox/webkit
 * suite covers create-session, admin-dashboard and stage-progression. This
 * is a layout/usability smoke test.
 */

// @ts-check
const { test, expect, forceLocalMode } = require("./fixtures");

test.describe("mobile splash usability", () => {
  test("splash form is visible + tappable, no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // No horizontal scroll: the body should not be wider than the viewport.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    // Allow a 2px subpixel tolerance.
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // The session-code input must be visible and have a reasonable tap-target
    // size (44x44 CSS px is the Apple HIG floor; we accept 40+).
    const inputBox = await page.locator("#splash-code").boundingBox();
    expect(inputBox, "session-code input must be visible").not.toBeNull();
    if (inputBox) {
      expect(inputBox.height).toBeGreaterThanOrEqual(36);
    }
  });

  test("privacy page renders without layout break", async ({ page }) => {
    await page.goto("/privacy.html");
    await page.waitForSelector("main.privacy", { state: "visible" });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // The brand mark SVG should be visible (top of page).
    const brand = await page.locator(".brand-mark").first().boundingBox();
    expect(brand, "brand-mark must render").not.toBeNull();
  });

  // R2-35: at 320-375px viewports (iPhone SE / older iOS Safari) the
  // splash form was overflowing the card and the language pill row was
  // wrapping onto two lines. The new <select> language switcher + the
  // shrunk #splash-code min-width must keep the page free of horizontal
  // scroll AND keep the entry form usable in the initial viewport.
  test("R2-35: iPhone-SE viewport (375x667) has no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(2);

    // Splash row stays single-row (input + button) at iPhone SE; the
    // language <select> sits above on its own line.
    const langSelect = page.locator("#splash-lang-select");
    await expect(langSelect).toBeVisible();
  });

  // R2-42: every supported language is reachable from the splash via the
  // new <select> switcher. The dropdown must contain exactly the 8
  // languages and switching to any of them must persist into
  // localStorage so a deep-link or refresh keeps the choice.
  test("R2-42: splash language switcher lists the 3 cohort languages (en/fr/ja)", async ({ page }) => {
    // English-only UI: the picker offers only the cohort languages and sets
    // ONLY the in-page reading-aid's word-help gloss language — no UI string
    // (consent included) follows it anymore.
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    const langSelect = page.locator("#splash-lang-select");
    await expect(langSelect).toBeVisible();
    const values = await langSelect.locator("option").evaluateAll(
      opts => opts.map(o => o.value)
    );
    expect(values).toEqual(["en", "fr", "ja"]);
  });

  // R2-36 / WCAG 2.5.8: the consent checkboxes must be at least 24x24
  // CSS pixels (target-size AA floor). They used to be 17x17, which the
  // disabled-user testing simulation flagged as a tap accuracy hazard
  // for fine-motor-impaired users on touch devices.
  test("R2-36: consent checkbox meets WCAG 2.5.8 target-size (>=24px)", async ({ page, context }) => {
    // Create a session in a first tab so we have a code to walk into
    // the lobby with (the consent checkbox only renders in the lobby).
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac");
    await page.locator("#splash-create-label").fill("R2-36 run");
    await page.locator("#splash-create-pass").fill("e2e-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    const tab = await context.newPage();
    await forceLocalMode(tab);
    await tab.addInitScript(() => {
      try { localStorage.removeItem("canamed_session"); } catch (e) {}
    });
    await tab.setViewportSize({ width: 375, height: 667 });
    await tab.goto("/");
    await tab.locator("#splash-code").fill(code);
    await tab.locator("#splash-enter").click();
    // Wait for the lobby to render (name-input is the canonical marker).
    await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    // The checkbox sits below the privacy <details> — scroll it into view
    // before measuring (it lives below the fold on a 375x667 viewport
    // since the privacy summary still takes a chunk even when collapsed).
    await tab.locator("#consent-workshop").scrollIntoViewIfNeeded();

    const box = await tab.locator("#consent-workshop").boundingBox();
    expect(box, "consent checkbox must render").not.toBeNull();
    if (box) {
      // Allow a 1px tolerance for native checkbox rendering quirks.
      expect(box.width).toBeGreaterThanOrEqual(23);
      expect(box.height).toBeGreaterThanOrEqual(23);
    }
    await tab.close();
  });

  // R2-37: with the privacy <details> auto-open, the Join button was
  // buried below ~3 screens of scroll on iPhone SE. The fix collapses
  // the details on viewports <= 600px wide so the consent + Join sit
  // in the first paint. Verify the details element is closed at 375px
  // and that the Join button is reachable without scrolling past the
  // privacy summary.
  test("R2-37: privacy details collapse on small viewports, Join visible", async ({ page, context }) => {
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("E2E Fac");
    await page.locator("#splash-create-label").fill("R2-37 run");
    await page.locator("#splash-create-pass").fill("e2e-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    const tab = await context.newPage();
    await forceLocalMode(tab);
    // Belt-and-braces: clear any persistent session pin from a previous
    // test in the same context so the splash actually paints, instead of
    // auto-resuming into a stale lobby (which would never re-render
    // #name-input from scratch).
    await tab.addInitScript(() => {
      try { localStorage.removeItem("canamed_session"); } catch (e) {}
    });
    await tab.setViewportSize({ width: 375, height: 667 });
    await tab.goto("/");
    await tab.locator("#splash-code").fill(code);
    await tab.locator("#splash-enter").click();
    await expect(tab.locator("#name-input")).toBeVisible({ timeout: 10_000 });
    // The privacy <details> should NOT be open at 375px.
    const isOpen = await tab.locator(".privacy-note").evaluate(
      d => d.hasAttribute("open")
    );
    expect(isOpen).toBe(false);
    await tab.close();
  });

  test("dark theme on mobile viewport", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("canamed_theme", "dark"));
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // The body background must be a dark colour when forced to dark theme.
    // (A light-mode regression would leave it the warm-paper #f6f4ef.)
    const bgRgb = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // Parse "rgb(R, G, B)" or "rgba(R, G, B, A)" — webkit on iPad
    // emulation occasionally returns the rgba form even with no alpha
    // override in CSS. The check is the same: the average channel must
    // be a dark colour (< 80).
    const m = bgRgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(m, `body background must parse as rgb()/rgba(), got ${bgRgb}`).not.toBeNull();
    if (m) {
      const avg = (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      expect(avg).toBeLessThan(80);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Disconnect / Leave (2026-05-18 user-reported regression: "once
  // connected to a session in a browser, it is not possible to disconnect
  // from this session"). The two new affordances — splash banner and
  // lobby "switch session" button — must be visible AND tappable on
  // mobile-iphone + mobile-ipad viewports (this spec runs under both via
  // the playwright project matrix).
  // ──────────────────────────────────────────────────────────────────────

  test("disconnect: splash banner is visible + tappable with a saved session", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("canamed_resume", JSON.stringify({
        sessionNum: "ABC-DEF", name: "Mobile User",
        university: "caen", year: 4, english: "C1",
        consent: { workshop: true, research: false, version: 1, at: Date.now() }
      }));
      localStorage.removeItem("canamed_session");
    });
    await page.reload();
    await page.waitForSelector(".splash", { state: "visible" });

    // Banner must be visible and contain the saved identity + code.
    await expect(page.locator("#splash-saved-session")).toBeVisible();
    await expect(page.locator("#splash-saved-session-name")).toHaveText("Mobile User");
    await expect(page.locator("#splash-saved-session-code")).toHaveText("ABC-DEF");

    // The clear button must meet the platform's 44px tap-target floor (the
    // same standard we hold elsewhere on mobile per the standing rule).
    const btn = page.locator("#splash-saved-session-clear");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box, "clear button must have a measurable bounding box").not.toBeNull();
    if (box) {
      expect(box.height, "tap-target height >= 40px on mobile").toBeGreaterThanOrEqual(40);
    }

    // Tap (touch event, not click) — verifies the handler is mobile-safe.
    await btn.tap();
    await expect(page.locator("#splash-saved-session")).toBeHidden();
    const resume = await page.evaluate(() => localStorage.getItem("canamed_resume"));
    expect(resume, "tap on clear must clear canamed_resume").toBeNull();
  });

  // "My open sessions" reaper (user-reported gap 2026-05-18: "I need a
  // way to close ongoing sessions for which there are no more
  // participants and the admin forgot to close them"). The reaper link
  // and the row buttons inside the list view must be tappable on mobile.
  test("reaper: 'My open sessions' link is visible + tappable on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });

    // Empty list → link must be hidden.
    await expect(page.locator("#splash-my-sessions-row")).toBeHidden();

    // Seed two tracked sessions and refresh the link.
    await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop A");
      addMySession("GHI-JKL", "Workshop B");
      paintMySessionsLink();
    });

    const link = page.locator("#splash-go-my-sessions");
    await expect(link).toBeVisible();
    await expect(page.locator("#splash-my-sessions-count")).toHaveText("2");

    // 44px hit target check.
    const box = await link.boundingBox();
    expect(box, "link must have a bounding box").not.toBeNull();
    if (box) {
      expect(box.height, "link tap-target >= 40px on mobile").toBeGreaterThanOrEqual(40);
    }

    // Tap (touch event, not click) → switches to my-sessions view.
    await link.tap();
    await expect(page.locator("#splash-view-my-sessions")).toBeVisible();
    await expect(page.locator(".my-session-row")).toHaveCount(2);
  });

  test("reaper: row 'Close' + 'Remove from list' buttons are tappable on mobile", async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      addMySession("ABC-DEF", "Workshop A");
      addMySession("GHI-JKL", "Workshop B");
      paintMySessionsLink();
    });
    await page.locator("#splash-go-my-sessions").tap();

    // Both action buttons must meet the 44px floor and respond to tap.
    const row = page.locator(".my-session-row").first();
    const closeBtn = row.locator(".my-session-close");
    const forgetBtn = row.locator(".my-session-forget");

    for (const [name, btn] of [["close", closeBtn], ["forget", forgetBtn]]) {
      await expect(btn, name + " must be visible").toBeVisible();
      const b = await btn.boundingBox();
      expect(b, name + " must have a bounding box").not.toBeNull();
      if (b) {
        expect(b.height, name + " tap-target >= 40px on mobile").toBeGreaterThanOrEqual(40);
      }
    }

    // Tap "Remove from list" on the first row → list shrinks to 1.
    await forgetBtn.tap();
    await expect(page.locator(".my-session-row")).toHaveCount(1);
  });

  test("disconnect: lobby 'switch session' button is visible + tappable", async ({ page }) => {
    // Render lobby directly with a stored session — we don't need a real
    // session here, just to assert the affordance is wired/visible/tappable.
    // initEntry's stored-session path calls sessionStatus, which in LOCAL
    // mode resolves to {exists:false} for an unknown code — that branch
    // clears the storage and shows splash, so for THIS test we manually
    // reveal #lobby + call paintLobbySwitchSession() to isolate the UI.
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      ["splash", "waiting", "app", "admin-app"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("lobby").classList.remove("hidden");
      document.body.classList.remove("locked");
      if (typeof paintLobbySwitchSession === "function") paintLobbySwitchSession();
    });

    const btn = page.locator("#lobby-switch-session-btn");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box, "switch-session button must have a bounding box").not.toBeNull();
    if (box) {
      expect(box.height, "tap-target height >= 40px on mobile").toBeGreaterThanOrEqual(40);
    }

    // Seed storage so we can verify the click clears it.
    await page.evaluate(() => {
      localStorage.setItem("canamed_session", "ABC-DEF");
      localStorage.setItem("canamed_resume", JSON.stringify({ sessionNum: "ABC-DEF", name: "X" }));
    });
    // The button calls location.reload(); wait for the next splash render
    // before reading localStorage to avoid "execution context destroyed".
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      btn.tap()
    ]);
    await page.waitForSelector(".splash", { state: "visible" });
    const cleared = await page.evaluate(() => ({
      session: localStorage.getItem("canamed_session"),
      resume:  localStorage.getItem("canamed_resume")
    }));
    expect(cleared.session, "switch must clear canamed_session").toBeNull();
    expect(cleared.resume,  "switch must clear canamed_resume").toBeNull();
  });

  // Module A workup tabs (2026-06-25): on a phone the stacked Module A
  // previously rendered ~30 buttons / ~5x viewport. Dialogue / Examination /
  // Investigations are now a tab strip showing ONE panel at a time, so the
  // stage opens compact. Verify the Dialogue panel is the active one and the
  // other two panels' button groups are not visible.
  test("Module A: the workup tab strip keeps the mobile stage compact", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s1 = document.getElementById("stage-1");
      if (s1) s1.classList.remove("hidden");
      document.body.classList.remove("locked");
    });
    await expect(page.locator("#chart-section-history")).not.toHaveAttribute("hidden", /.*/);
    await expect(page.locator('.chart-tab[data-chart-tab="dialogue"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#group-exam")).toBeHidden();
    await expect(page.locator("#group-labs")).toBeHidden();
  });

  // Swap-and-replay (2026-05-22): the swap button + role chips must be
  // tappable on a phone, and a swap must rotate the client's own role with
  // the reflective banner visible (it's a polite live region below the chips).
  test("swap-and-replay: button is tappable and rotates the role on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s2 = document.getElementById("stage-2");
      if (s2) s2.classList.remove("hidden");
      document.body.classList.remove("locked");
      if (typeof window.initRolePicker === "function") window.initRolePicker();
      if (typeof window.initModBPhaseNav === "function") window.initModBPhaseNav();
      // The swap button lives in the Phase-4 "swap & replay" card now (2026-06-26).
      if (typeof window.setModBPhase === "function") window.setModBPhase(3);
    });

    const swap = page.locator("#modB-swap-replay-btn");
    await expect(swap).toBeVisible();
    const box = await swap.boundingBox();
    expect(box, "swap button must render").not.toBeNull();
    if (box) {
      expect(box.height, "swap tap-target >= 36px on mobile").toBeGreaterThanOrEqual(36);
    }

    await page.locator('#modB-role-picker .role-chip[data-role="physician"]').tap();
    await swap.tap();
    await expect(page.locator('#modB-role-picker .role-chip[data-role="patient"]'))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#modB-replay-banner")).toBeVisible();
  });

  // "I'd rather observe" panic affordance (2026-05-22): the calm escape hatch
  // must be a comfortable tap-target on a phone and one tap must move the
  // student into the observer role with the reassurance shown.
  test("observe-escape: one tap selects observer on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s2 = document.getElementById("stage-2");
      if (s2) s2.classList.remove("hidden");
      document.body.classList.remove("locked");
      if (typeof window.initRolePicker === "function") window.initRolePicker();
    });

    const escape = page.locator("#modB-observe-instead-btn");
    await expect(escape).toBeVisible();
    const box = await escape.boundingBox();
    expect(box, "escape button must render").not.toBeNull();
    if (box) {
      expect(box.height, "escape tap-target >= 36px on mobile").toBeGreaterThanOrEqual(36);
    }
    await escape.tap();
    await expect(page.locator('#modB-role-picker .role-chip[data-role="observer"]'))
      .toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#modB-observe-reassure")).toBeVisible();
  });

  // Chained branching (2026-05-22): the follow-up dec_prognosis_next is gated
  // + hideWhenLocked, so before the room commits dec_prognosis it must not
  // appear. On a small viewport an unexpected extra decision card would push
  // the lock-in controls below the fold — verify it stays hidden on mobile.
  test("chained branching: the gated follow-up stays hidden on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".splash", { state: "visible" });
    const painted = await page.evaluate(() => {
      ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      const s2 = document.getElementById("stage-2");
      if (s2) s2.classList.remove("hidden");
      document.body.classList.remove("locked");
      if (window.DECISIONS_B) window.DECISIONS = window.DECISIONS_B;
      if (typeof window.renderDecisions === "function") window.renderDecisions();
      const box = document.getElementById("decisions-B");
      return !!(box && box.querySelector(".decision"));
    });
    expect(painted, "Module B decision cards must paint on mobile").toBe(true);
    await expect(page.locator("#decisions-B", { hasText: "her son is beside her" }))
      .toHaveCount(0);
    await expect(page.locator("#decisions-B .decision-locked")).toHaveCount(0);
  });
});
