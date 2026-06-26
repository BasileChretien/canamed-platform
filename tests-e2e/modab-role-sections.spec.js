/* tests-e2e/modab-role-sections.spec.js
 *
 * 2026-06-03 UX fixes:
 *   (A) Module A recap card — the "first-line management" list was squeezed
 *       against the left by the global .info-list 70ch cap while the adjacent
 *       recap tables spanned the card. It must now use the card's full width.
 *   (B) Module B — each role-specific guidance block shows ONLY for the
 *       participant holding that role: physician → Pause/Explore/Explain/Realign
 *       card; observer → SPIKES checklist; patient → "playing the patient" guide;
 *       family → "playing the family" guide. Nothing shows before a role is picked.
 *
 * Hermetic LOCAL mode (no Firebase) — drives the picker via window.initRolePicker
 * and phases via window.setModBPhase, the same lightweight approach as
 * modb-role-objective / modb-phase-flow. Listed in the mobile testMatch in
 * playwright.config.js so it runs per-device (desktop + iPhone/iPad/Android).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* ── Module A: recap list width ─────────────────────────────────────────── */
async function openModuleARecap(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-2", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const s1 = document.getElementById("stage-1");
    if (s1) s1.classList.remove("hidden");
    // Reveal the (default-hidden) recap reference panel.
    const recap = document.getElementById("refA-panel-recap");
    if (recap) recap.hidden = false;
  });
}

test.describe("Module A — recap management list width", () => {
  test("the first-line-management list is not capped to the left (full width)", async ({ page }) => {
    await openModuleARecap(page);
    const list = page.locator("#refA-panel-recap .info-list");
    await expect(list).toBeVisible();
    // The global cap (.info-list { max-width: 70ch }) must be overridden in the
    // recap card so the list matches the full-width tables beside it.
    const maxWidth = await list.evaluate(el => getComputedStyle(el).maxWidth);
    expect(maxWidth, "recap info-list must not carry the 70ch readability cap")
      .toBe("none");
  });
});

/* ── Module B: per-role section visibility ──────────────────────────────── */
async function openModuleBPlay(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    ["stage-0", "stage-1", "stage-3"].forEach(id => {
      const n = document.getElementById(id);
      if (n) n.classList.add("hidden");
    });
    const s2 = document.getElementById("stage-2");
    if (s2) s2.classList.remove("hidden");
    if (typeof window.initRolePicker === "function") window.initRolePicker();
    if (typeof window.initModBPhaseNav === "function") window.initModBPhaseNav();
    // Phase 2 (play) is the one phase where all four role blocks are eligible.
    if (typeof window.setModBPhase === "function") window.setModBPhase(1);
  });
}

// Visible == in the DOM and carrying NEITHER the phase nor the role hide class.
function visible(page, sel) {
  return page.evaluate(s => {
    const n = document.querySelector("#stage-2 " + s);
    return !!n && !n.classList.contains("is-phase-hidden")
                && !n.classList.contains("is-role-hidden");
  }, sel);
}

const ROLE_SECTION = {
  physician: ".micro-framework-card",
  observer: "#observer-checklist",
  patient: "#modB-patient-guide",
  family: "#modB-family-guide"
};

async function pickRole(page, role) {
  await page.locator('#modB-role-picker .role-chip[data-role="' + role + '"]').click();
}

test.describe("Module B — per-role guidance visibility", () => {
  test("no role picked → none of the four role blocks show", async ({ page }) => {
    await openModuleBPlay(page);
    for (const sel of Object.values(ROLE_SECTION)) {
      expect(await visible(page, sel), sel + " hidden before any pick").toBe(false);
    }
  });

  for (const [role, sel] of Object.entries(ROLE_SECTION)) {
    test(`picking ${role} shows only the ${role} block`, async ({ page }) => {
      await openModuleBPlay(page);
      await pickRole(page, role);
      expect(await visible(page, sel), sel + " shows for " + role).toBe(true);
      // Every OTHER role block stays hidden.
      for (const [otherRole, otherSel] of Object.entries(ROLE_SECTION)) {
        if (otherRole === role) continue;
        expect(await visible(page, otherSel),
          otherSel + " hidden when role is " + role).toBe(false);
      }
    });
  }

  test("switching roles swaps which block shows (physician → patient)", async ({ page }) => {
    await openModuleBPlay(page);
    await pickRole(page, "physician");
    expect(await visible(page, ROLE_SECTION.physician)).toBe(true);
    await pickRole(page, "patient");
    expect(await visible(page, ROLE_SECTION.patient), "patient guide now shows").toBe(true);
    expect(await visible(page, ROLE_SECTION.physician), "physician card now hidden").toBe(false);
  });

  test("a role block stays available across phases (now in the always-on 'Your role' tab)", async ({ page }) => {
    await openModuleBPlay(page);
    await pickRole(page, "patient");
    expect(await visible(page, ROLE_SECTION.patient), "patient guide shows in play").toBe(true);
    // 2026-06-26: the per-role guides moved into the always-available "Your role"
    // reference tab, so they are NO LONGER phase-gated — the holder can re-open
    // their part in any phase, including the Phase-3 exchange / debrief. Only the
    // role gating (is-role-hidden) still narrows it to the holder.
    await page.evaluate(() => window.setModBPhase(2));   // exchange
    expect(await visible(page, ROLE_SECTION.patient), "patient guide still available in exchange").toBe(true);
  });

  test("picking a role pulses the 'Your role' tab so the student notices + opens it", async ({ page }) => {
    await openModuleBPlay(page);
    await pickRole(page, "patient");
    // 2026-06-26: the role guides + brief moved into the "Your role" reference
    // tab, so a pick pulses the tab BUTTON (+ the brief panel inside it) rather
    // than the now-tabbed guide card, so the student notices it lit up + opens it.
    await expect(page.locator("#refB-btn-role")).toHaveClass(/attention-flash/);
    await expect(page.locator("#modB-role-objective")).toHaveClass(/attention-flash/);
  });

  test("Phase 1 (setup): each role's section shows once picked — including physician/observer", async ({ page }) => {
    await openModuleBPlay(page);
    await page.evaluate(() => window.setModBPhase(0));   // back to Phase 1 (setup)
    // Nothing role-specific shows before a pick.
    for (const sel of Object.values(ROLE_SECTION)) {
      expect(await visible(page, sel), sel + " hidden before any pick (setup)").toBe(false);
    }
    // Each role's section is readable in SETUP once that role is picked — this is
    // the fix for the report that physician/observer (previously play-only)
    // showed no role section in Phase 1.
    for (const [role, sel] of Object.entries(ROLE_SECTION)) {
      await pickRole(page, role);
      expect(await visible(page, sel), sel + " visible in setup for " + role).toBe(true);
    }
  });

  test("the private brief renders directly BELOW the picked role's guide (inside the Your-role tab)", async ({ page }) => {
    await openModuleBPlay(page);
    await page.evaluate(() => window.setModBPhase(0));   // Phase 1 (setup)
    await pickRole(page, "physician");
    const roleTab = page.locator("#refB-btn-role");
    await roleTab.click();   // open the "Your role" tab to read the brief

    const brief = page.locator("#modB-role-objective");
    await expect(brief).toBeVisible();
    await expect(brief).toContainText("Your private brief");
    await expect(brief).toContainText("Deliver the news with empathy");

    // It FOLLOWS the role's guide card in the DOM (both inside #refB-panel-role)
    // — and since the three other guides are display:none, the single brief panel
    // renders right under the one visible guide. (DOM order, not pixel boxes.)
    const briefFollowsGuide = await page.evaluate(guideSel => {
      const guide = document.querySelector("#stage-2 " + guideSel);
      const briefEl = document.getElementById("modB-role-objective");
      return !!(guide && briefEl &&
        (guide.compareDocumentPosition(briefEl) & Node.DOCUMENT_POSITION_FOLLOWING));
    }, ROLE_SECTION.physician);
    expect(briefFollowsGuide, "brief panel comes right after the guide card").toBe(true);

    // Switching role swaps the brief content (still one panel, below the new
    // guide). Close the tab first so the sticky panel doesn't overlay the chips.
    await roleTab.click();
    await pickRole(page, "patient");
    await expect(brief).toContainText("You suspected something was wrong");
    await expect(brief).not.toContainText("Deliver the news with empathy");
  });
});
