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
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2]);
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
  test("branched: stage nav never targets a stage outside the flow", async ({
    page,
  }) => {
    await applyAndFrame(page, "ward-escalation-branched");
    /* S1b — there is no SKIPPED stage any more: the flow is contiguous, so a
       branched session is Welcome → the case → Wrap-up as [0,1,2]. The M0 bug
       this guards is unchanged in substance: nav must never target a stage the
       session does not run (raw ±1 arithmetic used to). */
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2]);

    // Back from Wrap-up returns to the case.
    expect(await page.evaluate(() => window.adjacentStage(window.lastStage(), -1))).toBe(1);
    // Forward from the case reaches Wrap-up.
    expect(await page.evaluate(() => window.adjacentStage(1, 1))).toBe(2);
    // Ends of the flow are fixed points, which is how the nav buttons disable.
    expect(await page.evaluate(() => window.adjacentStage(0, -1))).toBe(0);
    expect(await page.evaluate(() => window.adjacentStage(window.lastStage(), 1))).toBe(2);
    // Every reachable target is a stage this session actually runs.
    const targets = await page.evaluate(() =>
      [0, 1, 2].flatMap((s) => [window.adjacentStage(s, -1), window.adjacentStage(s, 1)]),
    );
    expect(targets.every((t) => [0, 1, 2].includes(t))).toBe(true);

    /* S1b — the old assertion was "snapStageToFlow() will not hand back the
       SKIPPED stage 2". Stage 2 is this flow's wrap-up now, so that premise is
       gone. What snapping must still guarantee — and what carries real
       operational weight — is that an index from OUTSIDE the flow lands inside
       it. That is the migration path for a room whose stored roomStage predates
       the renumbering (a branched session used to park its wrap-up at 4). */
    const snapped = await page.evaluate(() =>
      [4, 3, 9].map((n) => window.snapStageToFlow(n, 1)));
    expect(snapped.every((n) => [0, 1, 2].includes(n))).toBe(true);
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
        backFromWrap: window.adjacentStage(window.lastStage(), -1),
      };
    }, oneModuleScenario("A"));

    expect(got.mods).toEqual(["A"]);
    expect(got.stages).toEqual([1]);
    expect(got.flow).toEqual([0, 1, 2]);
    // Module B's stage is genuinely skipped in both directions.
    expect(got.fwdFromCase).toBe(2);
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
    expect(got.stages).toEqual([1]);
    expect(got.flow).toEqual([0, 1, 2]);
    // Welcome leads straight to the roleplay stage — stage 1 is skipped.
    expect(got.fwdFromWelcome).toBe(1);
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
    expect(got.flow).toEqual([0, 1, 2]);
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
    expect(got.narrowed.flow).toEqual([0, 1, 2]);
    expect(got.narrowed.fwdFromCase).toBe(2);
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
    expect(got.flow).toEqual([0, 1, 2]);
  });

  test("S3b: the create form offers the SECTION picker, not a module tick-row",
    async ({ page }) => {
      /* SUPERSEDES the M2 tick-row test. A section pick IS the module set, at a
         granularity the tick-row could not reach: it can name two sections of
         the same type, and it carries ORDER. The tick-row is gone from the form;
         `modules` itself is still honoured on the read side for sessions created
         before the picker. */
      await page.goto("/");
      await page.locator("#splash-go-create").click();
      const form = await page.evaluate(() => ({
        tickRow: !!document.getElementById("splash-create-mod-A"),
        sectionList: !!document.getElementById("splash-section-list"),
        addControl: !!document.getElementById("splash-section-add-btn")
      }));
      expect(form.tickRow, "the per-module tick-row is superseded").toBe(false);
      expect(form.sectionList).toBe(true);
      expect(form.addControl).toBe(true);
    });

  test("standard: stage nav walks every stage the session runs (M0 regression guard)", async ({
    page,
  }) => {
    await applyAndFrame(page, "chronic-pain-opioids");
    /* S1b — an A+B session is Welcome → section 1 → section 2 → Wrap-up as
       [0,1,2,3]. It used to be [0,1,2,4] with the branched stage 3 skipped;
       stages now exist only where a section sits, so nothing is skipped. */
    expect(await page.evaluate(() => window.stageFlow())).toEqual([0, 1, 2, 3]);
    const walk = await page.evaluate(() => [
      window.adjacentStage(0, 1),
      window.adjacentStage(1, 1),
      window.adjacentStage(2, 1),
      window.adjacentStage(window.lastStage(), 1),
      window.adjacentStage(2, -1),
    ]);
    // Unchanged BEHAVIOUR: 0→1→2→wrap-up, wrap-up is terminal, back from 2 → 1.
    expect(walk).toEqual([1, 2, 3, 3, 1]);
    // Nav never leaves the flow.
    const targets = await page.evaluate(() =>
      [0, 1, 2, 3].flatMap((s) => [window.adjacentStage(s, -1), window.adjacentStage(s, 1)]),
    );
    expect(targets.every((t) => [0, 1, 2, 3].includes(t))).toBe(true);
  });

  /* Phase M4c — COMPOSITION. A mixed scenario runs a branched decision case
     alongside A/B by REFERENCING a standalone branched scenario id. This is the
     behavioural proof: the reference resolves, the nodes are namespaced + tagged,
     the graph edges survive, and the tree renders on the branched stage. */
  test("M4c: a mixed scenario composes a referenced branched case onto stage 3", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/");
    const got = await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      const outer = window.CANAMED_SCENARIOS["chronic-pain-opioids"];
      const ref = window.CANAMED_SCENARIOS["ward-escalation-branched"];
      if (!outer || !ref) throw new Error("fixtures missing");
      // A mixed session: Modules A + B, plus the branched case by reference.
      window.applyScenario("m4c-mixed", Object.assign({}, outer, {
        id: "m4c-mixed",
        modules: ["A", "B", "branched"],
        branchedRef: "ward-escalation-branched",
      }));
      window.renderDecisions();
      const all = window.DECISIONS || [];
      const br = all.filter((d) => d.module === "branched");
      const outerIds = (outer.decisions || []).map((d) => d.id);
      const box = document.getElementById("decisions-branched");
      return {
        mods: window.moduleSet(),
        flow: window.stageFlow(),
        stages: window.CANAMED_MODULE_STAGES,
        brCount: br.length,
        refCount: (ref.decisions || []).length,
        allNamespaced: br.every((d) => d.id.indexOf("br_") === 0),
        // No composed id may collide with an outer A/B decision id.
        collides: br.some((d) => outerIds.indexOf(d.id) !== -1),
        // Graph edges must have been rewritten to the namespaced ids.
        edges: br
          .filter((d) => d.unlockWhen && d.unlockWhen.afterDecision)
          .map((d) => {
            const a = d.unlockWhen.afterDecision;
            return typeof a === "string" ? a : a.id;
          }),
        // The outer A/B decisions survive untouched.
        aCount: all.filter((d) => d.module === "A").length,
        bCount: all.filter((d) => d.module === "B").length,
        // buildDecision()'s root element carries the `decision` class.
        rendered: box ? box.querySelectorAll(".decision").length : -1,
        boxHidden: box ? box.classList.contains("hidden") : null,
      };
    });

    // The branched module joins the session and gets its own stage.
    expect(got.mods).toEqual(["A", "B", "branched"]);
    expect(got.stages).toEqual([1, 2, 3]);
    expect(got.flow).toEqual([0, 1, 2, 3, 4]);

    // Every referenced node was composed in, namespaced, and collision-free.
    expect(got.brCount).toBe(got.refCount);
    expect(got.brCount).toBeGreaterThan(0);
    expect(got.allNamespaced).toBe(true);
    expect(got.collides).toBe(false);
    // …and the graph edges point at the namespaced ids, so the tree still walks.
    expect(got.edges.length).toBeGreaterThan(0);
    got.edges.forEach((e) => expect(e).toMatch(/^br_/));

    // The outer A/B content is untouched, and the tree actually rendered.
    expect(got.aCount).toBeGreaterThan(0);
    expect(got.bCount).toBeGreaterThan(0);
    expect(got.boxHidden).toBe(false);
    expect(got.rendered).toBeGreaterThan(0);

    expect(errors, "composing must not throw").toEqual([]);
  });

  test("M4c: switching away from a composed scenario drops the branched nodes", async ({
    page,
  }) => {
    // applyScenario only reassigns DECISIONS when the new scenario HAS a
    // decisions key, so a stale composed graph could otherwise survive.
    await page.goto("/");
    const got = await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      const outer = window.CANAMED_SCENARIOS["chronic-pain-opioids"];
      window.applyScenario("m4c-mixed", Object.assign({}, outer, {
        id: "m4c-mixed", modules: ["A", "B", "branched"],
        branchedRef: "ward-escalation-branched",
      }));
      const composed = (window.DECISIONS || []).filter((d) => d.module === "branched").length;
      // Now switch to a plain A/B scenario with no reference.
      window.applyScenario("chronic-pain-opioids");
      const after = (window.DECISIONS || []).filter((d) => d.module === "branched").length;
      return { composed, after, mods: window.moduleSet(), flow: window.stageFlow() };
    });
    expect(got.composed).toBeGreaterThan(0);
    expect(got.after).toBe(0);
    expect(got.mods).toEqual(["A", "B"]);
    expect(got.flow).toEqual([0, 1, 2, 3]);
  });
});
