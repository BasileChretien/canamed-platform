/* tests-e2e/chart-tabs.spec.js
 *
 * 2026-06-25: Module A's three data-gathering modes — Dialogue (the LLM
 * patient chat), Examination and Investigations — moved from three stacked
 * <details> into a horizontal tab strip (.chart-tabs) that shows ONE at a
 * time, so a student no longer scrolls past a long chat transcript to reach
 * the exam/labs buttons. This replaces chart-sections-collapsible.spec.js,
 * which locked in the <details> progressive-disclosure behaviour this
 * supersedes.
 *
 * Locks in:
 *   1. Three role=tab buttons + three role=tabpanel panels; Dialogue active by
 *      default, Examination/Investigations hidden. Panel ids are UNCHANGED
 *      (chart-section-history / chart-section-exam / chart-investigations) and
 *      the group ids (group-history / group-exam / group-labs) still exist, so
 *      buildButtons(), the chat mount and the is-locked toggle keep working.
 *   2. Clicking a tab shows its panel + hides the others (+ aria-selected).
 *   3. ArrowLeft/Right move roving focus AND switch tabs (a11y tablist pattern).
 *   4. The "Mr Lefebvre answered" badge on the Dialogue tab clears when the
 *      student returns to Dialogue.
 *   5. The deleted "First impressions" textarea is gone.
 *
 * Cross-device: spec name is in the mobile-iphone/ipad/android testMatch in
 * playwright.config.js, so it also runs on the three mobile viewports — per the
 * CLAUDE.md standing rule that every Module A UI change ships per-device cover.
 *
 * Mode: LOCAL (forceLocalMode in fixtures.js).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Reveal the room view so the Module A chart (and its tab strip) paints — the
 * state machine normally gates #stage-1 behind a real room. The tab strip lives
 * in static HTML (default state correct without JS); initChartTabs() only wires
 * the click + arrow-key handlers, and it normally runs inside wireRoomUI() once
 * a real room is set up, so we call it directly here. */
async function showChart(page) {
  await page.goto("/");
  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    document.getElementById("app").classList.remove("hidden");
    const s1 = document.getElementById("stage-1");
    if (s1) s1.classList.remove("hidden");
    document.body.classList.remove("locked");
    if (typeof window.initChartTabs === "function") window.initChartTabs();
  });
}

test.describe("Module A workup — Dialogue / Examination / Investigations tabs", () => {
  test("three tabs + three panels; Dialogue active, the others hidden", async ({ page }) => {
    await showChart(page);
    const info = await page.evaluate(() => {
      const panel = (id) => {
        const p = document.getElementById(id);
        return p ? {
          role: p.getAttribute("role"),
          hidden: p.hasAttribute("hidden"),
          active: p.classList.contains("is-active")
        } : null;
      };
      const tabs = [...document.querySelectorAll(".chart-tabs .chart-tab")].map(t => ({
        tab: t.dataset.chartTab,
        role: t.getAttribute("role"),
        selected: t.getAttribute("aria-selected"),
        active: t.classList.contains("is-active")
      }));
      return {
        tabs,
        dialogue: panel("chart-section-history"),
        exam: panel("chart-section-exam"),
        labs: panel("chart-investigations"),
        groups: ["group-history", "group-exam", "group-labs"].map(id => !!document.getElementById(id))
      };
    });

    // The three tabs, in order, each a real ARIA tab.
    expect(info.tabs.map(t => t.tab)).toEqual(["dialogue", "exam", "labs"]);
    info.tabs.forEach(t => expect(t.role, t.tab + " must be role=tab").toBe("tab"));

    // Dialogue is the default-active tab; the others are not.
    const byTab = Object.fromEntries(info.tabs.map(t => [t.tab, t]));
    expect(byTab.dialogue.active).toBe(true);
    expect(byTab.dialogue.selected).toBe("true");
    expect(byTab.exam.active).toBe(false);
    expect(byTab.labs.active).toBe(false);

    // Panels keep their ids + role; Dialogue visible, the others hidden.
    expect(info.dialogue.role).toBe("tabpanel");
    expect(info.dialogue.hidden, "Dialogue panel visible by default").toBe(false);
    expect(info.exam.hidden, "Examination panel hidden until selected").toBe(true);
    expect(info.labs.hidden, "Investigations panel hidden until selected").toBe(true);

    // Group ids intact so buildButtons() keeps populating them.
    expect(info.groups, "group-history/exam/labs must still exist").toEqual([true, true, true]);
  });

  test("clicking Examination shows its panel and hides Dialogue + Investigations", async ({ page }) => {
    await showChart(page);
    await page.locator('.chart-tab[data-chart-tab="exam"]').click();
    const s = await page.evaluate(() => ({
      examHidden: document.getElementById("chart-section-exam").hasAttribute("hidden"),
      dialogueHidden: document.getElementById("chart-section-history").hasAttribute("hidden"),
      labsHidden: document.getElementById("chart-investigations").hasAttribute("hidden"),
      examSel: document.querySelector('.chart-tab[data-chart-tab="exam"]').getAttribute("aria-selected"),
      dialogueSel: document.querySelector('.chart-tab[data-chart-tab="dialogue"]').getAttribute("aria-selected")
    }));
    expect(s.examHidden, "Examination panel now visible").toBe(false);
    expect(s.dialogueHidden, "Dialogue panel now hidden").toBe(true);
    expect(s.labsHidden, "Investigations panel stays hidden").toBe(true);
    expect(s.examSel).toBe("true");
    expect(s.dialogueSel).toBe("false");

    // Switching to Investigations swaps again.
    await page.locator('.chart-tab[data-chart-tab="labs"]').click();
    const s2 = await page.evaluate(() => ({
      labsHidden: document.getElementById("chart-investigations").hasAttribute("hidden"),
      examHidden: document.getElementById("chart-section-exam").hasAttribute("hidden")
    }));
    expect(s2.labsHidden, "Investigations panel now visible").toBe(false);
    expect(s2.examHidden, "Examination panel hidden again").toBe(true);
  });

  test("ArrowRight / ArrowLeft move roving focus and switch tabs", async ({ page }) => {
    await showChart(page);
    await page.locator("#chart-tab-dialogue").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.dataset.chartTab),
      "ArrowRight focuses Examination").toBe("exam");
    expect(await page.evaluate(() => document.getElementById("chart-section-exam").hasAttribute("hidden")),
      "ArrowRight reveals the Examination panel").toBe(false);
    await page.keyboard.press("ArrowLeft");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.dataset.chartTab),
      "ArrowLeft returns focus to Dialogue").toBe("dialogue");
  });

  test("the Dialogue 'new reply' badge clears when the student returns to Dialogue", async ({ page }) => {
    await showChart(page);
    // Simulate Mr Lefebvre answering while the student is on Examination: switch
    // away (so the Dialogue panel is hidden — the precondition the real
    // _flagDialogueUnread() in modA-llm-init.js checks), then set the badge +
    // attention dot exactly as that function does.
    await page.locator('.chart-tab[data-chart-tab="exam"]').click();
    const away = await page.evaluate(() => {
      const hidden = document.getElementById("chart-section-history").hasAttribute("hidden");
      const badge = document.getElementById("chart-tab-badge-dialogue");
      const tab = document.getElementById("chart-tab-dialogue");
      if (hidden && badge && tab) {
        badge.dataset.count = "1"; badge.textContent = "1"; badge.hidden = false;
        tab.classList.add("has-attention");
      }
      return {
        precondition: hidden,
        hidden: badge.hidden, txt: badge.textContent,
        att: tab.classList.contains("has-attention")
      };
    });
    expect(away.precondition, "Dialogue panel must be hidden while on Examination").toBe(true);
    expect(away.hidden, "badge shows while away").toBe(false);
    expect(away.txt).toBe("1");
    expect(away.att, "Dialogue tab carries the attention dot").toBe(true);

    // Returning to Dialogue clears the badge + the dot (switchChartTab).
    await page.locator('.chart-tab[data-chart-tab="dialogue"]').click();
    const back = await page.evaluate(() => {
      const badge = document.getElementById("chart-tab-badge-dialogue");
      const tab = document.getElementById("chart-tab-dialogue");
      return { hidden: badge.hidden, txt: badge.textContent,
               att: tab.classList.contains("has-attention") };
    });
    expect(back.hidden, "badge hidden on return to Dialogue").toBe(true);
    expect(back.txt, "badge count reset").toBe("");
    expect(back.att, "attention dot cleared").toBe(false);
  });

  test("the deleted 'First impressions' textarea is gone", async ({ page }) => {
    await page.goto("/");
    const present = await page.evaluate(() => ({
      section: !!document.getElementById("chart-impressions"),
      textarea: !!document.getElementById("impressions-input")
    }));
    expect(present.section, "chart-impressions section must be removed").toBe(false);
    expect(present.textarea, "impressions-input textarea must be removed").toBe(false);
  });
});
