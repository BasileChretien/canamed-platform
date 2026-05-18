/* tests-e2e/a11y.spec.js
 *
 * Automated WCAG 2.1 AA accessibility checks for the CaNaMED platform.
 *
 * Uses @axe-core/playwright to inject axe-core into each page we care
 * about and assert that there are NO violations at impact
 * "serious" or "critical". Moderate / minor issues are logged as
 * warnings (collected in the test report) so they don't block CI while
 * we burn down the long tail.
 *
 * Pages covered:
 *   - splash (entry, enter view + create-session view + Google sign-in view)
 *   - privacy policy in en / fr / ja
 *   - lobby (after entering a session code)
 *   - room view (after a participant joins a created session)
 *
 * Why not test every screen: stages 1..N are heavy, dynamic, and many
 * of their components share the same templates. Covering splash +
 * lobby + room gives us coverage of the structural primitives
 * (landmarks, headings, form labels, focus management, colour
 * contrast) without doubling CI time. Stage-specific violations are
 * the domain of the manual audit in ACCESSIBILITY_AUDIT.md.
 *
 * Rules disabled:
 *   - color-contrast on dynamic chips that depend on team colour
 *     assignment (chips are checked separately in the audit report).
 *   None at this time; we run with axe's default WCAG21AA ruleset.
 *
 * Selector strategy: by-ID, same as the other specs.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");
const AxeBuilder = require("@axe-core/playwright").default;

// Severities we treat as failures. Moderate / minor are still surfaced
// in the test output (see logWarnings) but do not fail the build.
const FAIL_IMPACTS = new Set(["serious", "critical"]);

/**
 * Wait for any in-flight CSS animation to settle so axe samples the
 * static rendered colours, not a mid-fade value. The platform's
 * view-in animation (lobby-card, room view, admin view) animates
 * opacity from 0 → 1 over ~380ms with a 120ms delay; axe-core's
 * colour-contrast check uses the rendered RGB value, which during a
 * fade-in is a mix of the foreground and the background — causing
 * spurious "below 4.5:1" failures that the static design clears.
 *
 * Resolves when every finite animation in the document has finished,
 * with a 1.5s ceiling so an infinite animation (.stage-wait breathe,
 * .call-btn.pending pulse) does not block forever.
 */
async function waitForAnimationsToSettle(page) {
  await page.evaluate(async () => {
    const all = (document.getAnimations && document.getAnimations()) || [];
    // Skip infinite animations (breathing, pulse). The .stage-wait
    // colour was already darkened to clear 4.5:1 even at the trough of
    // its breathing opacity cycle, so axe is safe to read it any time.
    const finite = all.filter((a) => {
      const eff = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
      return !eff || eff.iterations !== Infinity;
    });
    const deadlines = finite.map((a) => a.finished.catch(() => {}));
    const cap = new Promise((r) => setTimeout(r, 1500));
    await Promise.race([Promise.all(deadlines), cap]);
  });
}

/**
 * Run axe and assert there are zero serious/critical violations.
 * Returns the full violations array so the caller can log the
 * non-failing impact tiers.
 */
async function runAxe(page, { tags } = {}) {
  await waitForAnimationsToSettle(page);
  const builder = new AxeBuilder({ page })
    .withTags(tags || ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

  const { violations } = await builder.analyze();
  const blocking = violations.filter((v) => FAIL_IMPACTS.has(v.impact));

  // Render a readable message when something fails — axe's raw output
  // is a 100-line object dump that hides the actual problem.
  if (blocking.length > 0) {
    const lines = blocking.flatMap((v) => {
      const head = `  [${v.impact}] ${v.id}: ${v.help}\n     ${v.helpUrl}`;
      const nodes = (v.nodes || []).map((n) => {
        const summary = (n.failureSummary || "").replace(/\s+/g, " ").trim();
        return `       - ${n.target.join(" ")}\n         ${summary}`;
      });
      return [head, ...nodes];
    });
    throw new Error(
      `axe-core found ${blocking.length} serious/critical violation(s):\n${lines.join("\n")}`
    );
  }

  return violations;
}

function logWarnings(testInfo, page, violations) {
  const warnings = violations.filter((v) => !FAIL_IMPACTS.has(v.impact));
  if (warnings.length > 0) {
    const summary = warnings.map((v) => `  [${v.impact || "n/a"}] ${v.id}: ${v.help}`).join("\n");
    testInfo.annotations.push({
      type: "a11y-warning",
      description: `${warnings.length} non-blocking axe finding(s) on ${page.url()}:\n${summary}`
    });
  }
}

test.describe("Accessibility (axe-core)", () => {
  test("splash — enter-code view", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "CANAMED" })).toBeVisible();
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("splash — create-session view", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await expect(page.locator("#splash-create-name")).toBeVisible();
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("splash — sign-in-with-Google view", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.locator("#splash-go-account").click();
    await expect(page.locator("#splash-google-signin")).toBeVisible();
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("privacy policy (en)", async ({ page }, testInfo) => {
    await page.goto("/privacy.html");
    await expect(page.getByRole("heading", { name: /Privacy Policy/i })).toBeVisible();
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("privacy policy (fr)", async ({ page }, testInfo) => {
    await page.goto("/privacy-fr.html");
    await expect(page).toHaveURL(/privacy-fr\.html$/);
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("privacy policy (ja)", async ({ page }, testInfo) => {
    await page.goto("/privacy-ja.html");
    await expect(page).toHaveURL(/privacy-ja\.html$/);
    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("lobby — after entering a session code", async ({ page, context }, testInfo) => {
    // Step A: facilitator creates a session in tab 1 (so a code exists
    // in the shared LocalDB).
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("A11y Fac");
    await page.locator("#splash-create-label").fill("A11y lobby check");
    await page.locator("#splash-create-pass").fill("a11y-pw");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    // Step B: a participant in tab 2 enters the code and reaches the
    // lobby. Inherit forceLocalMode init for the new tab.
    const tab2 = await context.newPage();
    await tab2.addInitScript(() => {
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value,
          set: () => {},
          configurable: true,
          enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "a11y-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    const v = await runAxe(tab2);
    logWarnings(testInfo, tab2, v);
  });

  test("admin dashboard — after a facilitator creates a session", async ({ page }, testInfo) => {
    // Facilitator creates a session via the splash, then jumps into the
    // admin dashboard. This is the prestart state (no participants
    // joined yet) — covers the largest chunk of the admin UI without
    // needing a second tab.
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("A11y Admin Fac");
    await page.locator("#splash-create-label").fill("A11y admin dashboard check");
    await page.locator("#splash-create-pass").fill("a11y-pw-admin");
    await page.locator("#splash-create-submit").click();
    await expect(page.locator("#splash-shown-code"))
      .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    await page.locator("#splash-go-admin").click();
    await expect(page.locator("#admin-app")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });

    const v = await runAxe(page);
    logWarnings(testInfo, page, v);
  });

  test("room view — stages 0, 1, 2 after a participant lands in a room",
    async ({ page, context }, testInfo) => {
      // Cross-tab flow lifted from stage-progression.spec.js so we can
      // exercise axe on the per-room participant view. Reuses the same
      // dialog auto-accept pattern.
      page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
      // SIMULATION_FACILITATOR.md batch: Start/Advance now open the
      // in-page canamed-modal instead of native confirm — auto-click
      // its OK button so this test exercises the real flow without UI.
      await page.addInitScript(() => {
        const tryAccept = () => {
          const dlg = document.getElementById("canamed-modal");
          if (dlg && dlg.open) {
            const ok = document.getElementById("canamed-modal-confirm");
            if (ok) ok.click();
          }
        };
        document.addEventListener("DOMContentLoaded", () => {
          const dlg = document.getElementById("canamed-modal");
          if (dlg) {
            const observer = new MutationObserver(tryAccept);
            observer.observe(dlg, { attributes: true, attributeFilter: ["open"] });
          }
          setInterval(tryAccept, 200);
        });
      });

      // Facilitator tab — create + open admin.
      await page.goto("/");
      await page.locator("#splash-go-create").click();
      await page.locator("#splash-create-name").fill("A11y Stage Fac");
      await page.locator("#splash-create-label").fill("A11y room-stage check");
      await page.locator("#splash-create-pass").fill("a11y-stage-pw");
      await page.locator("#splash-create-submit").click();
      const codeNode = page.locator("#splash-shown-code");
      await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
      const code = (await codeNode.textContent()).trim();
      await page.locator("#splash-go-admin").click();
      await expect(page.locator("#admin-app")).toBeVisible();

      // Participant tab — clear the auto-resume key so the splash
      // renders normally, then join.
      const tab2 = await context.newPage();
      tab2.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
      await tab2.addInitScript(() => {
        try {
          localStorage.removeItem("canamed_session");
          localStorage.removeItem("canamed_resume");
        } catch (e) {}
        function pin(name, value) {
          Object.defineProperty(window, name, {
            get: () => value,
            set: () => {},
            configurable: true,
            enumerable: true
          });
        }
        pin("CANAMED_FIREBASE", null);
        pin("CANAMED_RECAPTCHA_SITE_KEY", null);
        pin("CANAMED_PERF_MONITORING", false);
        window.CANAMED_SUPERADMIN_KEY = "a11y-stage-super-admin";
      });
      await tab2.goto("/");
      await tab2.locator("#splash-code").fill(code);
      await tab2.locator("#splash-enter").click();
      await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });
      await tab2.locator("#name-input").fill("A11y Room Student");
      const uni = await tab2
        .locator("#uni-input option:not([disabled])")
        .first()
        .getAttribute("value");
      await tab2.locator("#uni-input").selectOption(uni);
      await tab2.locator("#consent-workshop").check();
      const joinBtn = tab2.locator("#join-btn");
      await expect(joinBtn).toBeEnabled({ timeout: 5000 });
      await joinBtn.click();
      await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

      // Admin starts so the participant moves into #app at stage 0.
      await expect(page.locator("#admin-prestart")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("#prestart-count")).not.toHaveText("0", { timeout: 10_000 });
      await page.locator("#start-session-btn").click();
      await expect(tab2.locator("#app")).toBeVisible({ timeout: 15_000 });

      // Stage 0 — the freshly-placed room view. Run axe.
      const v0 = await runAxe(tab2);
      logWarnings(testInfo, tab2, v0);

      // Advance to stage 1 from the admin tab and rerun. The dashboard
      // renders an "Advance →" button on each dash-room card; the first
      // such button is the only one in single-room runs.
      const adv = () => page.getByRole("button", { name: /^Advance\s*→?$/ }).first();
      if (await adv().count()) {
        await adv().click();
        // Participant view should reflect the new stage indicator.
        await expect(tab2.locator("#stage-indicator")).toContainText(/Stage 2/i, {
          timeout: 10_000
        });
        const v1 = await runAxe(tab2);
        logWarnings(testInfo, tab2, v1);

        // Stage 2.
        if (await adv().count()) {
          await adv().click();
          await expect(tab2.locator("#stage-indicator")).toContainText(/Stage 3/i, {
            timeout: 10_000
          });
          const v2 = await runAxe(tab2);
          logWarnings(testInfo, tab2, v2);
        }
      }

      await tab2.close();
    });

  test("waiting room — after a participant joins", async ({ page, context }, testInfo) => {
    // Facilitator creates a session
    await page.goto("/");
    await page.locator("#splash-go-create").click();
    await page.locator("#splash-create-name").fill("A11y Fac 2");
    await page.locator("#splash-create-label").fill("A11y room check");
    await page.locator("#splash-create-pass").fill("a11y-pw-2");
    await page.locator("#splash-create-submit").click();
    const codeNode = page.locator("#splash-shown-code");
    await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 10_000 });
    const code = (await codeNode.textContent()).trim();

    // Participant joins
    const tab2 = await context.newPage();
    await tab2.addInitScript(() => {
      function pin(name, value) {
        Object.defineProperty(window, name, {
          get: () => value,
          set: () => {},
          configurable: true,
          enumerable: true
        });
      }
      pin("CANAMED_FIREBASE", null);
      pin("CANAMED_RECAPTCHA_SITE_KEY", null);
      pin("CANAMED_PERF_MONITORING", false);
      window.CANAMED_SUPERADMIN_KEY = "a11y-super-admin";
    });
    await tab2.goto("/");
    await tab2.locator("#splash-code").fill(code);
    await tab2.locator("#splash-enter").click();
    await expect(tab2.locator("#name-input")).toBeVisible({ timeout: 10_000 });

    await tab2.locator("#name-input").fill("A11y Student");
    const realUni = await tab2
      .locator("#uni-input option:not([disabled])")
      .first()
      .getAttribute("value");
    await tab2.locator("#uni-input").selectOption(realUni);
    await tab2.locator("#consent-workshop").check();
    const joinBtn = tab2.locator("#join-btn");
    await expect(joinBtn).toBeEnabled({ timeout: 5000 });
    await joinBtn.click();

    // Waiting room is the participant-side "room" prior to the
    // facilitator placing them. Covers the dynamic main landmark we
    // never tested before.
    await expect(tab2.locator("#waiting")).toBeVisible({ timeout: 10_000 });

    const v = await runAxe(tab2);
    logWarnings(testInfo, tab2, v);
  });
});
