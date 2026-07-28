/* tests-e2e/section-stage-labels.spec.js
 *
 * S1b of the section model: a stage is a POSITION, not a module.
 *
 *   - Students see "Section k — <the section's own title>" (decision 8), with
 *     the "Module A — " prefix gone.
 *   - The session is Welcome + N sections + Wrap-up, CONTIGUOUS. Before S1b an
 *     A-only session ran [0,1,4] with two stages skipped.
 *   - Pick order decides running order: a roleplay picked first runs on stage 1
 *     and shows the roleplay view there.
 *
 * This is the browser-side proof. The unit tests slice the resolver out of
 * script.js; here the real shell is loaded, i18n has resolved, and the labels
 * are the strings a student would actually read.
 *
 * Registered into the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function surfaceApp(page) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  /* Apply a real built-in case: the synthetic surfacing below skips startRoom(),
     which is what normally calls applyScenario(), and without it the section
     TITLES are empty (the label correctly degrades to "Section k"). Loading the
     registry the same way the app does keeps the titles the real ones. */
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.CANAMED_SCENARIOS);
  await page.evaluate(() => window.applyScenario("chronic-pain-opioids"));
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    const splash = document.getElementById("splash");
    if (splash) splash.classList.add("hidden");
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  });
}

/* Narrow the session to an ordered module set, the way S3's picker will. */
async function pick(page, mods) {
  await page.evaluate((m) => {
    window.CURRENT_SCENARIO_MODULES = m;
    window.setSessionModules(m.join(","));
  }, mods);
}

test.describe("S1b — section stage labels and ordering", () => {
  test("a stage reads 'Section k — title', with no Module A/B prefix", async ({ page }) => {
    await surfaceApp(page);
    const labels = await page.evaluate(() =>
      [window.stageLabel(1), window.stageLabel(2)]);

    for (const l of labels) {
      expect(l).toMatch(/^Section [12] — .+/);
      expect(l).not.toMatch(/Module [AB]/);
    }
    expect(labels[0]).not.toEqual(labels[1]);
    // The title is the case's own — not a generic placeholder.
    expect(labels[0].replace(/^Section \d+ — /, "").length).toBeGreaterThan(3);
  });

  test("welcome and wrap-up keep their own labels, by role not index", async ({ page }) => {
    await surfaceApp(page);
    const ends = await page.evaluate(() =>
      [window.stageLabel(0), window.stageLabel(window.lastStage())]);
    expect(ends[0]).toBe("Welcome");
    expect(ends[1]).toBe("Wrap-up");
  });

  test("the flow is contiguous: Welcome + one stage per section + Wrap-up", async ({ page }) => {
    await surfaceApp(page);
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);

    await pick(page, ["A"]);
    /* Before S1b this was [0,1,4] — two dead stages in between. */
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2]);
    expect(await page.evaluate(() => window.stageLabel(2))).toBe("Wrap-up");
  });

  test("a single roleplay section runs on stage 1, not on Module B's old index",
    async ({ page }) => {
      await surfaceApp(page);
      await pick(page, ["B"]);
      const info = await page.evaluate(() => ({
        slots: window.sectionSlots().map(s => [s.stage, s.type]),
        view: window.stageViewId(1),
        label: window.stageLabel(1)
      }));
      expect(info.slots).toEqual([[1, "roleplay"]]);
      /* The roleplay MARKUP keeps its id — #stage-2 is now "the roleplay view",
         which is what removes the need to clone stage DOM per slot. */
      expect(info.view).toBe("stage-2");
      expect(info.label).toMatch(/^Section 1 — /);
    });

  test("the wrap-up view is shown even though its number moved", async ({ page }) => {
    await surfaceApp(page);
    await pick(page, ["A"]);
    /* _test_setViewStage only sets the state; renderStage() is what resolves
       the view, and it is the function under test here. */
    await page.evaluate(() => { window._test_setViewStage(2); window.renderStage(); });
    /* Its markup is #stage-4 while it now sits at stage 2: resolving
       "stage-" + n would have shown the branched view instead. */
    await expect(page.locator("#stage-4")).toBeVisible();
    await expect(page.locator("#stage-3")).toBeHidden();
    await expect(page.locator("#stage-1")).toBeHidden();
  });

  test("the stepper draws one numbered step per section, plus the two ends",
    async ({ page }) => {
      await surfaceApp(page);
      await page.evaluate(() => { window._test_setViewStage(1); window.renderStage(); });
      const steps = page.locator("#global-stage-progress .gsp-step");
      await expect(steps).toHaveCount(4);
      const nums = await page.locator("#global-stage-progress .gsp-num")
        .allTextContents();
      expect(nums).toEqual(["1", "2", "3", "4"]);
    });
});

/* ── S1c-1 — the roleplay CAST is section data ─────────────────────────────
   Proof in the real shell: a section declaring its own roles rebuilds the chip
   row, and the built-in cast leaves the hand-authored chips untouched. */
test.describe("S1c-1 — an authored roleplay cast", () => {
  test("the built-in cast leaves the shipped chips exactly as authored", async ({ page }) => {
    await surfaceApp(page);
    const roles = await page.locator("#modB-role-picker .role-chip")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-role")));
    expect(roles).toEqual(["physician", "patient", "family", "observer"]);
    // i18n attributes survive because renderRoleChips() no-ops on a match.
    await expect(page.locator('#modB-role-picker .role-chip[data-role="family"] span'))
      .toHaveAttribute("data-i18n", "modB.role.family.name");
  });

  test("a section's own cast replaces the chips, with its own names", async ({ page }) => {
    await surfaceApp(page);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { roles: [
        { id: "pharmacist", name: "Community pharmacist" },
        { id: "prescriber", name: "Prescriber" },
        { id: "observer", name: "Observer" }
      ] };
      window.renderRoleChips();
    });
    const chips = page.locator("#modB-role-picker .role-chip");
    await expect(chips).toHaveCount(3);
    expect(await chips.evaluateAll((els) => els.map((e) => e.textContent.trim())))
      .toEqual(["Community pharmacist", "Prescriber", "Observer"]);
  });

  test("an authored cast is still clickable — the picker re-arms", async ({ page }) => {
    await surfaceApp(page);
    /* The chip has to be VISIBLE to be clicked, so run a roleplay-only session
       and show its stage — which is stage 1 since S1b. */
    await pick(page, ["B"]);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { roles: [
        { id: "pharmacist", name: "Community pharmacist", brief: "You dispensed it." },
        { id: "prescriber", name: "Prescriber" }
      ] };
      window.renderRoleChips();
      window._test_setViewStage(1);
      window.renderStage();
      /* Module B gates its cards by phase; the role picker lives in the setup
         phase, so without this the chip is present but not visible. */
      if (typeof window.renderModBPhase === "function") window.renderModBPhase(0);
    });
    await expect(page.locator("#stage-2")).toBeVisible();
    await expect(page.locator('.role-chip[data-role="pharmacist"]')).toBeVisible();
    /* Fire the chip's own click rather than a synthetic pointer event: this
       page is a half-mounted room (no startRoom(), so the usual chrome/overlay
       state is not settled) and Playwright's actionability gate times out on
       something overlapping it. The claim under test is that renderRoleChips()
       RE-ARMED the picker's listener over the new chips — which the element's
       own click() exercises exactly. Visibility is asserted separately above. */
    await page.locator('.role-chip[data-role="pharmacist"]').evaluate((e) => e.click());
    await expect(page.locator('.role-chip[data-role="pharmacist"]'))
      .toHaveAttribute("aria-checked", "true");
    /* And its private brief is the authored text, not a shipped i18n string. */
    await expect(page.locator("#modB-role-objective-text"))
      .toHaveText("You dispensed it.");
  });
});

/* ── S1c-2 — the roleplay reference panels are optional section data ────────
   Decision 11: fill what you want; an unfilled panel disappears, button and
   all. The built-ins declare nothing, so their shipped panels are untouched. */
test.describe("S1c-2 — optional roleplay reference panels", () => {
  test("the built-in roleplay keeps all four shipped panels", async ({ page }) => {
    await surfaceApp(page);
    for (const id of ["history", "guidelines", "recap", "useful"]) {
      await expect(page.locator("#refB-btn-" + id)).not.toHaveClass(/hidden/);
      expect(await page.locator("#refB-panel-" + id).innerHTML()).not.toBe("");
    }
  });

  test("a section fills only the panels it wants; the rest disappear", async ({ page }) => {
    await surfaceApp(page);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { panels: {
        useful: { label: "Phrases that help",
                  paragraphs: ["Can I check what you already know?"],
                  bullets: ["Name the emotion", "Then pause"] }
      } };
      window.renderRoleplayPanels();
    });
    await expect(page.locator("#refB-btn-useful")).not.toHaveClass(/hidden/);
    for (const id of ["history", "guidelines", "recap"]) {
      await expect(page.locator("#refB-btn-" + id)).toHaveClass(/hidden/);
      expect(await page.locator("#refB-panel-" + id).innerHTML()).toBe("");
    }
    const filled = page.locator("#refB-panel-useful");
    await expect(filled.locator("strong")).toHaveText("Phrases that help");
    await expect(filled.locator("p").nth(1)).toHaveText("Can I check what you already know?");
    await expect(filled.locator("li")).toHaveCount(2);
  });

  test("authored panel prose is inserted as text, never as markup", async ({ page }) => {
    await surfaceApp(page);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { panels: {
        recap: { paragraphs: ["<img src=x onerror=alert(1)>"] }
      } };
      window.renderRoleplayPanels();
    });
    await expect(page.locator("#refB-panel-recap img")).toHaveCount(0);
    await expect(page.locator("#refB-panel-recap p"))
      .toHaveText("<img src=x onerror=alert(1)>");
  });
});

/* ── S1c-3a — the observation framework is a shipped library ────────────────
   Decision 11: a roleplay picks its observer checklist from frameworks I own,
   or supplies its own. Declaring nothing keeps the shipped SPIKES list. */
test.describe("S1c-3a — the observer's framework", () => {
  test("the built-in roleplay keeps its six SPIKES steps", async ({ page }) => {
    await surfaceApp(page);
    const ids = await page.locator("#observer-checklist input[data-obs]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-obs")));
    expect(ids).toEqual(["s", "p", "i", "k", "e", "s2"]);
  });

  test("a section swaps in a library framework", async ({ page }) => {
    await surfaceApp(page);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { framework: "pause-explore-explain-realign" };
      window.renderObserverChecklist();
    });
    const boxes = page.locator("#observer-checklist input[data-obs]");
    await expect(boxes).toHaveCount(4);
    await expect(page.locator("#observer-checklist li").first())
      .toContainText("Pause —");
  });

  test("an authored checklist still persists what the observer ticks", async ({ page }) => {
    await surfaceApp(page);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { framework: {
        label: "Ours", steps: [{ id: "one", label: "Asked first" },
                               { id: "two", label: "Then told" }] } };
      window.renderObserverChecklist();
      /* The wiring must have been re-armed over the NEW boxes; without that an
         authored framework ticks but never saves. */
      document.querySelector('#observer-checklist input[data-obs="two"]').click();
    });
    const saved = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("canamed_obs_spikes") || "{}"));
    expect(saved.two).toBe(1);
  });
});

/* ── S1c-3b — an authored roleplay declares its own phases ──────────────────
   Decision 12. The shipped six-phase timetable is right for breaking bad news
   and wrong for a three-beat negotiation; the phase list, its minutes and the
   cards each phase shows are now section data. */
test.describe("S1c-3b — authored phases", () => {
  async function threePhase(page) {
    await pick(page, ["B"]);
    await page.evaluate(() => {
      window.CURRENT_SECTION_ROLEPLAY = { phases: [
        { id: "brief", label: "Brief the room", minutes: 4, shows: ["vignette", "roles"] },
        { id: "play", label: "Play it", minutes: 12, shows: ["roles"] },
        { id: "debrief", label: "Debrief", minutes: 6, shows: ["reflect"], expanded: true }
      ] };
      window.renderPhaseStepper();
      window._test_setViewStage(1);
      window.renderStage();
    });
  }

  test("the built-in roleplay keeps its six shipped phase chips", async ({ page }) => {
    await surfaceApp(page);
    const ids = await page.locator("#stage-2 .phase-step")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-phase")));
    expect(ids).toEqual(["setup", "play", "exchange", "swap", "replay", "reflect"]);
  });

  test("an authored list replaces the stepper, with its own labels and minutes",
    async ({ page }) => {
      await surfaceApp(page);
      await threePhase(page);
      const steps = page.locator("#stage-2 .phase-step");
      await expect(steps).toHaveCount(3);
      await expect(steps.first()).toContainText("Brief the room");
      await expect(steps.first()).toContainText("4 min");
      await expect(page.locator("#stage-2 .phase-stepper"))
        .toHaveAttribute("data-steps", "3");
    });

  test("phase visibility follows the declaration, and unlisted cards stay hidden",
    async ({ page }) => {
      await surfaceApp(page);
      await threePhase(page);
      await page.evaluate(() => window.applyModBPhaseVisibility("brief"));
      await expect(page.locator("#modB-role-picker")).not.toHaveClass(/is-phase-hidden/);
      /* Never declared by any phase — it must be hidden, not left permanently
         on screen because applyPhaseVisibility never touched it. */
      await expect(page.locator("#modB-swap-card")).toHaveClass(/is-phase-hidden/);

      await page.evaluate(() => window.applyModBPhaseVisibility("debrief"));
      await expect(page.locator("#modB-role-picker")).toHaveClass(/is-phase-hidden/);
      await expect(page.locator(".answers-card-modB-reflect")).not.toHaveClass(/is-phase-hidden/);
    });

  test("an authored stepper is still tappable — the nav re-arms", async ({ page }) => {
    await surfaceApp(page);
    await threePhase(page);
    await page.locator('#stage-2 .phase-step[data-phase="debrief"] .phase-step-btn')
      .evaluate((e) => e.click());
    await expect(page.locator('#stage-2 .phase-step[data-phase="debrief"]'))
      .toHaveClass(/is-current/);
  });

  test("the indicator counts the authored phases, not a literal six", async ({ page }) => {
    await surfaceApp(page);
    await threePhase(page);
    /* renderModBPhase() takes no argument — it reads the module-scoped
       modBPhase — so drive the shared renderer with the section's config
       directly; the indicator is what is under test. */
    await page.evaluate(() => window.renderModulePhase(window.modBProgressCfg(), 1));
    await expect(page.locator("#modB-phase-indicator")).toHaveText("Phase 2 / 3");
  });
});
