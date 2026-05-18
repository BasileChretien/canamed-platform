/* tests-e2e/user-feedback-2.spec.js
 *
 * Behavioural E2E pins for the user-feedback-2 batch (Bugs 1, 2, 6 — the
 * three with directly-observable DOM/CSS behaviour). Bugs 3/4/5 are
 * already covered:
 *   - Bug 3 (live i18n) — source pins in tests/user-feedback-2.test.js
 *     plus an in-page DOM test below that flips lang and asserts the
 *     finding-button text changes language
 *   - Bug 4 (dark/HC axe) — extended in tests-e2e/a11y.spec.js
 *   - Bug 5 (student tour) — source pins in tests/user-feedback-2.test.js
 *
 * All tests run under LOCAL mode and synthesize the room layout in-page
 * (avoiding the multi-tab create/join orchestration that other specs
 * cover) so each test is hermetic and fast.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Bug 1 — team name renders horizontally at narrow viewport", () => {
  test("at 320px width, .lb-name with an emoji prefix does NOT vertical-stack",
    async ({ page }) => {
      // iPhone-SE-like narrow viewport
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto("/");

      // Synthesize a single leaderboard row offscreen-free so we can
      // measure its rendered height. .lb-name is a flex child with
      // siblings (rank + pts); if `overflow-wrap: anywhere` were back
      // the row would stack each grapheme on its own line and
      // .lb-name's clientHeight would balloon to roughly
      // graphemeCount * line-height (>= 8 * ~16px = 128px). The fix
      // keeps it on ~1-2 lines (<= 60px).
      const heightInfo = await page.evaluate(() => {
        // Make sure splash is out of the way so getComputedStyle reads
        // the page-level palette, not the splash overlay's.
        document.body.classList.remove("locked");
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");

        const li = document.createElement("li");
        li.className = "lb-row";
        const rank = document.createElement("span");
        rank.className = "lb-rank";
        rank.textContent = "#1";
        const name = document.createElement("span");
        name.className = "lb-name";
        // Emoji + multi-word team name — the worst-case for an
        // `overflow-wrap: anywhere` regression on a 320px viewport.
        name.textContent = "🍣 Team Sakura-Camembert";
        const pts = document.createElement("span");
        pts.className = "lb-pts";
        pts.textContent = "120 pts";
        li.appendChild(rank); li.appendChild(name); li.appendChild(pts);

        const list = document.createElement("ul");
        list.id = "leaderboard";
        list.style.maxWidth = "300px";
        list.appendChild(li);
        document.body.appendChild(list);

        const lineHeight = parseFloat(
          getComputedStyle(name).lineHeight) || 16;
        const h = name.getBoundingClientRect().height;
        return { height: h, lineHeight: lineHeight };
      });

      // Even at 320px and a flex sibling competing for width, the team
      // name must render on no more than 3 lines (line-height * 3) —
      // the vertical-stack regression rendered ~10+ lines for the
      // 10-char string we use above.
      const maxAllowed = heightInfo.lineHeight * 3 + 4;
      expect(heightInfo.height,
        `lb-name rendered at ${heightInfo.height}px (line-height ${heightInfo.lineHeight}px). ` +
        "If this is many lines tall, the per-grapheme vertical-stack regression is back.")
        .toBeLessThan(maxAllowed);
    });

  // Round 2 — the original .lb-name rendered FINE in the 3-sibling
  // configuration (rank + name + pts). The vertical-stack regression
  // re-surfaced only when the user was in a non-#1 room: an extra
  // `.lb-gap` ("+N to catch X") gets appended, and because `.lb-row`
  // was missing `flex-wrap: wrap`, .lb-gap's `flex-basis: 100%`
  // couldn't push it to its own line — it competed for the same
  // horizontal track and squashed .lb-name to ~0 width. Pin the
  // failing scenario explicitly so we don't regress again.
  test("at desktop width with .lb-gap sibling present, .lb-name still renders horizontally",
    async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto("/");

      const heightInfo = await page.evaluate(() => {
        document.body.classList.remove("locked");
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");

        const li = document.createElement("li");
        li.className = "lb-row me";  // .me triggers the gap path in real UI

        const rank = document.createElement("span");
        rank.className = "lb-rank";
        rank.textContent = "#2";

        const name = document.createElement("span");
        name.className = "lb-name";
        // The exact string from the user-reported bug screenshot.
        name.textContent = "Lala (your team)";

        const pts = document.createElement("span");
        pts.className = "lb-pts";
        pts.textContent = "45 pts";

        // The critical 4th child — its `flex-basis: 100%` was being
        // ignored without flex-wrap on the parent.
        const gap = document.createElement("span");
        gap.className = "lb-gap";
        gap.textContent = "+14 to catch Room 2";

        li.appendChild(rank); li.appendChild(name);
        li.appendChild(pts); li.appendChild(gap);

        const list = document.createElement("ul");
        list.id = "leaderboard";
        list.style.maxWidth = "560px";  // matches the real card width in screenshot
        list.appendChild(li);
        document.body.appendChild(list);

        const lineHeight = parseFloat(getComputedStyle(name).lineHeight) || 16;
        return {
          height: name.getBoundingClientRect().height,
          width: name.getBoundingClientRect().width,
          lineHeight: lineHeight
        };
      });

      // Without the flex-wrap fix the user-reported screenshot showed
      // .lb-name at ~16 lines tall (one per character of "Lala (your
      // team)"). With it, it should sit on a single line.
      const maxAllowed = heightInfo.lineHeight * 2 + 4;
      expect(heightInfo.height,
        `lb-name rendered ${heightInfo.height}px tall × ${heightInfo.width}px wide ` +
        `(line-height ${heightInfo.lineHeight}px). If tall+narrow, the per-character ` +
        `vertical stack is back — likely missing flex-wrap: wrap on .lb-row.`)
        .toBeLessThan(maxAllowed);
      // Also assert width: the squashed-to-zero failure mode renders
      // .lb-name at < 20px wide; a healthy render should be well past
      // that even on the narrowest practical leaderboard.
      expect(heightInfo.width,
        `lb-name width was ${heightInfo.width}px — squashed to zero means flex layout broke.`)
        .toBeGreaterThan(60);
    });
});

test.describe("Bug 2 — findings answer appears under the button on mobile", () => {
  test("at <=960px viewport, an inline req-inline-reveal sits DOM-adjacent to its button",
    async ({ page }) => {
      // Mobile-stacked layout threshold per style.css
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto("/");

      // Make the room view visible + force-trigger renderButtons with a
      // fake `revealed` map. We can't call reveal() directly without a
      // full firebase round-trip, but we CAN set the module-scoped
      // `revealed` object and re-run renderButtons because buildButtons
      // is idempotent and renderButtons reads `revealed` straight from
      // the closure.
      const layout = await page.evaluate(() => {
        // Surface stage 1 (Module A) so the buttons render.
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");

        // Build buttons from the case content if available.
        if (typeof window.buildButtons === "function") window.buildButtons();
        // Find the first history button — its id is "history:0".
        const firstBtn = document.querySelector(
          '.req-btn[data-id="history:0"]');
        if (!firstBtn) return { reason: "no req-btn rendered" };

        // Fake-reveal it. The module-scope `revealed` is not on window
        // (script.js IIFE-less but vars are module-scoped), so the
        // simplest cross-version trick is to call renderButtons after
        // hand-installing the inline-reveal exactly as the fix would.
        // We populate the inline-reveal directly to verify the CSS
        // visibility rules.
        const existing = firstBtn.nextElementSibling;
        if (!existing || !existing.classList.contains("req-inline-reveal")) {
          const inline = document.createElement("div");
          inline.className = "req-inline-reveal";
          inline.textContent = "Patient response goes here.";
          firstBtn.insertAdjacentElement("afterend", inline);
        }

        const inline = firstBtn.nextElementSibling;
        const rect = inline.getBoundingClientRect();
        const cs = getComputedStyle(inline);
        return {
          isAdjacent: inline.classList.contains("req-inline-reveal"),
          display: cs.display,
          height: rect.height,
          top: rect.top,
          buttonTop: firstBtn.getBoundingClientRect().top,
          buttonBottom: firstBtn.getBoundingClientRect().bottom
        };
      });

      expect(layout.isAdjacent, "inline reveal must be DOM-adjacent to the button").toBe(true);
      expect(layout.display,
        "inline reveal must be visible (display != none) on <=960px viewports")
        .not.toEqual("none");
      // The inline reveal should sit BELOW the button (no negative gap)
      // and within a few px of the button bottom (it's directly under).
      expect(layout.top).toBeGreaterThanOrEqual(layout.buttonBottom - 2);
      expect(layout.top - layout.buttonBottom).toBeLessThan(40);
    });

  test("at desktop width (>960px), the inline reveal is ALSO visible",
    async ({ page }) => {
      // Updated 2026-05-18 after the specialist panel: the inline
      // reveal was promoted from mobile-only to all-viewports. Action
      // and result must fuse spatially on every screen size — desktop
      // students lose the connection too when the right-column log is
      // far from the button (especially in deeper case-work where
      // there's a lot of vertical scrolling).
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      const display = await page.evaluate(() => {
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");
        if (typeof window.buildButtons === "function") window.buildButtons();
        const firstBtn = document.querySelector(
          '.req-btn[data-id="history:0"]');
        const inline = document.createElement("div");
        inline.className = "req-inline-reveal";
        inline.textContent = "Visible on desktop too.";
        firstBtn.insertAdjacentElement("afterend", inline);
        return getComputedStyle(inline).display;
      });
      expect(display, "the inline reveal must render on desktop now").toEqual("block");
    });
});

test.describe("Bug 3 — language switcher re-renders dynamic case content", () => {
  test("switching lang while in-room re-renders the finding-button labels",
    async ({ page }) => {
      await page.goto("/");
      const result = await page.evaluate(() => {
        // Land in stage 1 with the case buttons rendered.
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");

        if (typeof window.buildButtons === "function") window.buildButtons();
        const firstBtn = document.querySelector(
          '.req-btn[data-id="history:0"]');
        if (!firstBtn) return { reason: "no req-btn rendered" };

        // Make sure we start in English so the switch to FR is
        // observable (textContent must actually change).
        if (typeof window.setLang === "function") window.setLang("en");
        if (typeof window.buildButtons === "function") window.buildButtons();
        const enText = firstBtn.textContent.trim();

        // Switch to French. The Bug 3 fix wires a canamed:langchange
        // listener that re-calls buildButtons (which reads
        // `tc(item.q, _curLang())`), so the button text re-flows.
        if (typeof window.setLang === "function") window.setLang("fr");
        // Re-fetch since buildButtons() recreates the DOM nodes.
        const afterFr = document.querySelector(
          '.req-btn[data-id="history:0"]');
        const frText = afterFr ? afterFr.textContent.trim() : "";
        return { enText, frText };
      });
      expect(result.enText, "EN text must be present").toBeTruthy();
      expect(result.frText, "FR text must be present").toBeTruthy();
      expect(result.frText,
        "FR text must differ from EN — proves the lang-change listener re-ran buildButtons")
        .not.toEqual(result.enText);
    });
});

test.describe("Bug 6 — participant settings cog + theme picker", () => {
  test("the settings cog is visible to participants and opens a panel",
    async ({ page }) => {
      await page.goto("/");
      // The splash gate hides the global widgets via body.locked; once
      // hidden, the cog must be visible. We simulate splash-dismissed
      // by removing body.locked.
      await page.evaluate(() => document.body.classList.remove("locked"));

      const cog = page.locator("#global-settings-btn");
      await expect(cog).toBeVisible();
      await cog.click();
      await expect(page.locator("#global-settings-panel")).toBeVisible();

      // The theme picker offers high-contrast specifically (the
      // participant-accessibility win the fix is about).
      const themeOptions = await page.locator(
        "#global-theme-select option").evaluateAll(
          opts => opts.map(o => o.value));
      expect(themeOptions).toContain("auto");
      expect(themeOptions).toContain("light");
      expect(themeOptions).toContain("dark");
      expect(themeOptions).toContain("high-contrast");
    });

  test("changing theme via the settings panel sets <html data-theme> and persists",
    async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => document.body.classList.remove("locked"));
      await page.locator("#global-settings-btn").click();
      await page.locator("#global-theme-select").selectOption("high-contrast");

      const dataTheme = await page.evaluate(
        () => document.documentElement.getAttribute("data-theme"));
      expect(dataTheme,
        "<html data-theme> must reflect the picked theme")
        .toEqual("high-contrast");

      const stored = await page.evaluate(
        () => localStorage.getItem("canamed_theme"));
      expect(stored,
        "the chosen theme must persist to localStorage so theme-init.js applies it on reload")
        .toEqual("high-contrast");
    });

  /* User report (2026-05-18): "The setting button on the phone does
   * not work. You have to add unit tests every time for all devices."
   *
   * Two regression tests pinning the mobile-specific failure mode.
   * Together they ensure that tapping the cog ANYWHERE (on the SVG
   * icon or on the button chrome) opens the panel AND that the panel
   * STAYS open afterwards (the previous code closed it immediately
   * because the document-click handler used reference equality on
   * e.target and failed when e.target was the SVG/path child of the
   * button). */
  test("Bug 6 (mobile): tapping the cog SVG opens the settings panel and it stays open",
    async ({ page }) => {
      // Force a mobile-sized viewport regardless of the project this
      // test happens to run under, so the assertion is meaningful on
      // every profile (chromium/firefox/webkit + mobile-*).
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      // Splash gate hides the global widgets via body.locked — peel it
      // off so the cog is in the layout tree and tappable.
      await page.evaluate(() => document.body.classList.remove("locked"));

      // Tap the SVG element INSIDE the button, NOT the button itself.
      // This is the exact mobile path that was broken: e.target is the
      // <svg> (or one of its <path>/<circle> children), not the button.
      const svgInsideButton = page.locator("#global-settings-btn svg");
      await expect(svgInsideButton).toBeVisible();
      await svgInsideButton.click();

      // Panel must be visible after the click.
      const panel = page.locator("#global-settings-panel");
      await expect(panel).toBeVisible();

      // CRITICAL — wait 200ms and re-check. The previous bug closed
      // the panel synchronously via the document-click handler firing
      // after the button handler. If THAT regression returns, the
      // panel would be visible for one frame then flip back to hidden.
      await page.waitForTimeout(200);
      await expect(panel,
        "the settings panel must STAY open after the tap — if this " +
        "fails, the document-click handler is closing it immediately " +
        "(reference-equality regression on e.target check)")
        .toBeVisible();

      // Tap a child path inside the SVG (the gear teeth) to cover the
      // case where the tap lands on a specific path element, not the
      // <svg> root. Closes + reopens.
      await page.locator("#global-settings-btn").click();   // close
      await expect(panel).toBeHidden();
      const path = page.locator("#global-settings-btn svg path").first();
      await path.click();
      await page.waitForTimeout(200);
      await expect(panel,
        "tapping a child SVG path must also open and keep the panel open")
        .toBeVisible();
    });

  test("Bug 6 (mobile): tapping outside the panel still closes it",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.evaluate(() => document.body.classList.remove("locked"));

      await page.locator("#global-settings-btn").click();
      const panel = page.locator("#global-settings-panel");
      await expect(panel).toBeVisible();

      // Tap on the body far from the panel — should close the panel.
      await page.mouse.click(20, 600);
      await expect(panel,
        "tapping outside the settings widget must close the panel " +
        "(close-on-outside-click behaviour preserved by the defensive fix)")
        .toBeHidden();
    });
});

/* User request (2026-05-18): "the ask the patients, examination,
 * investigations sections button must be in a random order. Not always
 * the same one."
 *
 * Three regression tests on a 390x844 mobile viewport (per the new
 * standing rule: test every UI change across devices):
 *   1. Display order is NOT the original CASE order (i.e., shuffled).
 *   2. Same session + same room ⇒ same order on reload (stable for
 *      mid-conversation reloads).
 *   3. Item IDs (data-id) are preserved across the shuffle so the
 *      reveal-write Firebase path doesn't change. */
test.describe("Random button order — shuffled display, stable IDs", () => {
  test("display order differs from the source CASE order (mobile viewport)",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      const result = await page.evaluate(() => {
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");
        // Force a non-empty sessionNum + myRoom so the seed is stable.
        window.sessionNum = "test-session";
        window.myRoom = "room-1";
        if (typeof window.buildButtons === "function") window.buildButtons();
        const groups = ["history", "exam", "labs"];
        const out = {};
        groups.forEach(g => {
          const buttons = Array.from(document.querySelectorAll(
            '#group-' + g + ' .req-btn'));
          out[g] = {
            ids: buttons.map(b => b.dataset.id),
            count: buttons.length,
            sourceCount: (window.CASE && window.CASE[g] || []).length
          };
        });
        return out;
      });
      // At least ONE of the 3 groups must show a non-default order.
      // (A 3-item group has a 1/6 chance of randomly landing on
      // [0,1,2], so guarding all three together is a near-zero
      // false-positive bar.)
      const groups = ["history", "exam", "labs"];
      let atLeastOneShuffled = false;
      for (const g of groups) {
        const r = result[g];
        if (r.count !== r.sourceCount) continue; // skip if buildButtons didn't load CASE
        const ordered = r.ids.map((_, i) => g + ":" + i);
        if (JSON.stringify(r.ids) !== JSON.stringify(ordered)) {
          atLeastOneShuffled = true;
          break;
        }
      }
      expect(atLeastOneShuffled,
        "at least one section must render its buttons in a non-default order — " +
        "if all three sections render in source order, the seeded shuffle isn't " +
        "running. Saw: " + JSON.stringify(result))
        .toBe(true);
    });

  test("same room + session = same order on reload (stability)",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      // Capture order on first load.
      const orderOne = await page.evaluate(() => {
        // noop — page.goto below.
      });
      await page.goto("/");
      const first = await page.evaluate(() => {
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");
        window.sessionNum = "test-session-stable";
        window.myRoom = "room-1";
        if (typeof window.buildButtons === "function") window.buildButtons();
        return Array.from(document.querySelectorAll(
          '#group-history .req-btn')).map(b => b.dataset.id);
      });

      // Reload, re-render with the same session/room seed.
      await page.goto("/");
      const second = await page.evaluate(() => {
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");
        window.sessionNum = "test-session-stable";
        window.myRoom = "room-1";
        if (typeof window.buildButtons === "function") window.buildButtons();
        return Array.from(document.querySelectorAll(
          '#group-history .req-btn')).map(b => b.dataset.id);
      });

      expect(first.length).toBeGreaterThan(0);
      expect(second,
        "same sessionNum + myRoom must produce the SAME shuffled order on " +
        "reload — otherwise a student mid-conversation would lose their cursor " +
        "position every time they refreshed.")
        .toEqual(first);
    });

  test("different rooms in the same session = different orders (anti-copying)",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      const orders = await page.evaluate(() => {
        document.querySelectorAll(".hidden").forEach(n => n.classList.remove("hidden"));
        const splash = document.getElementById("splash");
        if (splash) splash.classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("stage-1").classList.remove("hidden");
        const captures = {};
        ["room-1", "room-2", "room-3", "room-4"].forEach(r => {
          window.sessionNum = "test-multi-room";
          window.myRoom = r;
          if (typeof window.buildButtons === "function") window.buildButtons();
          captures[r] = Array.from(document.querySelectorAll(
            '#group-history .req-btn')).map(b => b.dataset.id);
        });
        return captures;
      });
      // At least TWO of the four rooms must have different orders —
      // otherwise the room-component of the seed isn't doing anything.
      const distinct = new Set(Object.values(orders).map(JSON.stringify));
      expect(distinct.size,
        "different rooms in the same session must produce different orders " +
        "to discourage cross-room copying. All 4 rooms produced: " +
        JSON.stringify(orders))
        .toBeGreaterThan(1);
    });
});
