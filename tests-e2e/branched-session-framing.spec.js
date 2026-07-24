/* tests-e2e/branched-session-framing.spec.js
 *
 * The branched format reshapes the whole SESSION framing, not just in-stage
 * chrome: the lobby "Today's structure" agenda was hardcoded to the
 * chronic-pain / breaking-bad-news modules, so a branched session read as the
 * wrong (A+B) session. A branched scenario is a single-stage decision case
 * with NO Module-B / Reflection step — the session runs Welcome → the case →
 * Wrap-up (stageFlow() skips stage 2). This locks:
 *   - the lobby agenda is rendered from the ACTIVE scenario's module names;
 *   - branched → the agenda lists ONLY the case (the Module-B row is hidden);
 *   - branched → stageFlow() drops stage 2 (a 3-stage session);
 *   - standard scenarios keep their real module names + all four stages.
 */

const { test, expect } = require("./fixtures");

async function applyAndFrame(page, scenarioId) {
  await page.goto("/");
  await page.evaluate(async (id) => {
    await window.CanamedLoader.ensureCaseContent();
    window.applyScenario(id);
    window.renderLobbyStructure();
    const rm = document.getElementById("room-main");
    if (rm) rm.classList.remove("hidden");
  }, scenarioId);
}

test.describe("branched session framing", () => {
  test("branched: agenda lists only the case + the session skips stage 2", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");

    // The "Today's structure" agenda reflects the branched scenario's case…
    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /breathless/i,
    );
    await expect(page.locator("#lobby-struct-modA")).not.toContainText(
      /Chronic Pain/i,
    );
    // …and the Module-B / reflection agenda row is hidden (no roleplay step).
    expect(
      await page.locator("#lobby-struct-modB").evaluate((n) => n.hidden),
    ).toBe(true);

    // The reflection card was removed entirely (not merely hidden).
    expect(
      await page.evaluate(() => !!document.getElementById("branched-reflection")),
    ).toBe(false);

    // The session is a 3-stage flow: Welcome → the case → Wrap-up (no stage 2).
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 3]);
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "branched",
    );
  });

  test("standard scenario: agenda keeps its real module names + all four stages", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain-opioids");

    await expect(page.locator("#lobby-struct-modA")).toContainText(
      /Chronic Pain/i,
    );
    await expect(page.locator("#lobby-struct-modB")).toContainText(
      /Breaking Bad News/i,
    );
    expect(
      await page.locator("#lobby-struct-modB").evaluate((n) => n.hidden),
    ).toBe(false);
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "standard",
    );
  });

  /* Phase M0 (ARCHITECTURE/module-set-design.md) — the dead-stage bug.
     Six navigation sites did raw arithmetic on STAGE_COUNT instead of walking
     the active flow. The worst case was silent: stepping BACK from Wrap-up in a
     branched session targeted the SKIPPED stage 2, and snapStageToFlow() rolls a
     skipped target FORWARD, landing back on Wrap-up — so "back" did nothing. */
  test("branched: stage nav never targets the skipped stage (M0 dead-stage fix)", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 3]);

    // Back from Wrap-up returns to the case, NOT the skipped stage 2 (and not
    // a no-op back on 3, which is what raw roomStage-1 produced).
    expect(await page.evaluate(() => window.adjacentStage(3, -1))).toBe(1);
    // Forward from the case jumps straight to Wrap-up.
    expect(await page.evaluate(() => window.adjacentStage(1, 1))).toBe(3);
    // Ends of the flow are fixed points, which is how the nav buttons disable.
    expect(await page.evaluate(() => window.adjacentStage(0, -1))).toBe(0);
    expect(await page.evaluate(() => window.adjacentStage(3, 1))).toBe(3);
    // Neither direction ever yields the skipped stage.
    const targets = await page.evaluate(() =>
      [0, 1, 3].flatMap((s) => [window.adjacentStage(s, -1), window.adjacentStage(s, 1)]),
    );
    expect(targets).not.toContain(2);

    // Documents the trap: snapStageToFlow() will NOT hand back the skipped
    // stage, which is precisely why raw ±1 arithmetic was unsafe.
    expect(await page.evaluate(() => window.snapStageToFlow(2, 3))).not.toBe(2);
  });

  /* Phase M1 — single-module sessions. Naming only one module drops the other
     module's stage from the flow, so every flow consumer (steppers, Back/
     Advance, the debrief legend) follows automatically. */
  const T = (en) => ({ en, fr: "", ja: "" });
  function oneModuleScenario(which) {
    const item = { q: T("q"), a: T("a") };
    const scn = {
      id: "m1-" + which.toLowerCase() + "-only",
      name: T(which + " only"),
      summary: T("single-module session"),
      case: {
        history: [item],
        exam: [item],
        labs: [Object.assign({ key: true }, item)],
        prompts: [T("p")],
      },
      synthId: "labs:0",
      synthPrereqs: [],
      scoring: { moduleA: [], moduleB: [] },
      penalties: [],
      decisions: [],
    };
    // Only ONE module is named — that is what declares the set.
    scn["module" + which + "Name"] =
      T(which === "A" ? "Reasoning only" : "Roleplay only");
    return scn;
  }

  test("M1: a Module-A-only scenario runs a 3-stage session that skips stage 2", async ({
    page,
  }) => {
    await page.goto("/");
    const got = await page.evaluate(async (scn) => {
      await window.CanamedLoader.ensureCaseContent();
      window.applyScenario(scn.id, scn);
      return {
        mods: window.moduleSet(),
        stages: window.CANAMED_MODULE_STAGES,
        flow: window.stageFlow(),
        fwdFromCase: window.adjacentStage(1, 1),
        backFromWrap: window.adjacentStage(3, -1),
      };
    }, oneModuleScenario("A"));

    expect(got.mods).toEqual(["A"]);
    expect(got.stages).toEqual([1]);
    expect(got.flow).toEqual([0, 1, 3]);
    // Module B's stage is genuinely skipped in both directions.
    expect(got.fwdFromCase).toBe(3);
    expect(got.backFromWrap).toBe(1);
  });

  test("M1: a Module-B-only scenario skips stage 1 instead", async ({ page }) => {
    await page.goto("/");
    const got = await page.evaluate(async (scn) => {
      await window.CanamedLoader.ensureCaseContent();
      window.applyScenario(scn.id, scn);
      return {
        mods: window.moduleSet(),
        stages: window.CANAMED_MODULE_STAGES,
        flow: window.stageFlow(),
        fwdFromWelcome: window.adjacentStage(0, 1),
      };
    }, oneModuleScenario("B"));

    expect(got.mods).toEqual(["B"]);
    expect(got.stages).toEqual([2]);
    expect(got.flow).toEqual([0, 2, 3]);
    // Welcome leads straight to the roleplay stage — stage 1 is skipped.
    expect(got.fwdFromWelcome).toBe(2);
  });

  test("M1: an explicit `modules` field overrides the names", async ({ page }) => {
    await page.goto("/");
    const got = await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      // The built-in names BOTH modules; the declaration narrows it to A. Assert
      // the fixture really is a two-module scenario, so this test cannot pass by
      // accidentally spreading `undefined`.
      const src = window.CANAMED_SCENARIOS["chronic-pain-opioids"];
      if (!src) throw new Error("fixture scenario not registered");
      if (!src.moduleAName || !src.moduleBName) {
        throw new Error("fixture must name BOTH modules for this test to mean anything");
      }
      window.applyScenario("m1-declared", Object.assign({}, src, { modules: ["A"] }));
      return { mods: window.moduleSet(), flow: window.stageFlow() };
    });
    expect(got.mods).toEqual(["A"]);
    expect(got.flow).toEqual([0, 1, 3]);
  });

  test("M1: BACK-COMPAT — a built-in naming both modules still runs four stages", async ({
    page,
  }) => {
    // The built-ins carry no `modules` field, so this is the no-migration path.
    await applyAndFrame(page, "chronic-pain-opioids");
    expect(await page.evaluate(() => window.moduleSet())).toEqual(["A", "B"]);
    expect(await page.evaluate(() => window.CANAMED_MODULE_STAGES)).toEqual([1, 2]);
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
  });

  /* Phase M2 — the facilitator narrows the scenario's set for one session. */
  test("M2: a session narrowing runs a SUBSET of the scenario's modules", async ({
    page,
  }) => {
    await page.goto("/");
    const got = await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      // A built-in that contains BOTH modules.
      window.applyScenario("chronic-pain-opioids");
      const full = { mods: window.moduleSet(), flow: window.stageFlow() };
      // The facilitator chose to run Module A only for this session.
      window.setSessionModules("A");
      const narrowed = {
        mods: window.moduleSet(),
        scenario: window.scenarioModuleSet(),
        stages: window.CANAMED_MODULE_STAGES,
        flow: window.stageFlow(),
        fwdFromCase: window.adjacentStage(1, 1),
      };
      // Clearing the narrowing restores the scenario's own set.
      window.setSessionModules(null);
      const restored = { mods: window.moduleSet(), flow: window.stageFlow() };
      return { full, narrowed, restored };
    });

    expect(got.full.mods).toEqual(["A", "B"]);
    expect(got.full.flow).toEqual([0, 1, 2, 3]);
    // Narrowed: the session runs A, though the SCENARIO still contains both.
    expect(got.narrowed.mods).toEqual(["A"]);
    expect(got.narrowed.scenario).toEqual(["A", "B"]);
    expect(got.narrowed.stages).toEqual([1]);
    expect(got.narrowed.flow).toEqual([0, 1, 3]);
    expect(got.narrowed.fwdFromCase).toBe(3);
    expect(got.restored.flow).toEqual([0, 1, 2, 3]);
  });

  test("M2: an impossible narrowing cannot produce an empty session", async ({
    page,
  }) => {
    await page.goto("/");
    const got = await page.evaluate(async (scn) => {
      await window.CanamedLoader.ensureCaseContent();
      window.applyScenario(scn.id, scn);        // A-only scenario…
      window.setSessionModules("B");            // …with a stale "B" selection
      return { mods: window.moduleSet(), flow: window.stageFlow() };
    }, oneModuleScenario("A"));
    // The empty intersection is ignored rather than collapsing the session.
    expect(got.mods).toEqual(["A"]);
    expect(got.flow).toEqual([0, 1, 3]);
  });

  test("M2: the create form offers the module picker, both ticked by default", async ({
    page,
  }) => {
    await page.goto("/");
    const cb = await page.evaluate(() => {
      const a = document.getElementById("splash-create-mod-A");
      const b = document.getElementById("splash-create-mod-B");
      return {
        present: !!a && !!b,
        aChecked: !!(a && a.checked),
        bChecked: !!(b && b.checked),
        type: a && a.type,
      };
    });
    expect(cb.present, "the create form must expose a per-module picker").toBe(true);
    expect(cb.type).toBe("checkbox");
    // Default = run everything the scenario contains (identical to M1).
    expect(cb.aChecked).toBe(true);
    expect(cb.bChecked).toBe(true);
  });

  test("standard: stage nav still walks all four stages (M0 regression guard)", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain-opioids");
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
    const walk = await page.evaluate(() => [
      window.adjacentStage(0, 1),
      window.adjacentStage(1, 1),
      window.adjacentStage(2, 1),
      window.adjacentStage(3, 1),
      window.adjacentStage(2, -1),
    ]);
    // Unchanged behaviour for a standard A+B session: 0→1→2→3, 3 is terminal.
    expect(walk).toEqual([1, 2, 3, 3, 1]);
  });
});
