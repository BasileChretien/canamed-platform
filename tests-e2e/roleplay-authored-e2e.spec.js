/* tests-e2e/roleplay-authored-e2e.spec.js
 *
 * THE END-TO-END TEST FOR AN AUTHORED ROLEPLAY.
 *
 * #274 made the roleplay's scene, cast, checklist, timing and panels authorable,
 * and proved it at the form's own boundary: the block round-trips byte-identically
 * through state and export. That is NOT the same claim as "an authored roleplay
 * runs", and the difference was a real bug.
 *
 * `buildSection()` never copied `scenario.roleplay` onto the roleplay section, so
 * the block was dropped the moment a scenario became a section. A facilitator
 * could author a whole roleplay, watch it survive the form, watch it land in
 * `sectionBodies` at create — and then watch the session run the SHIPPED
 * breaking-bad-news content instead. Silently, because "no roleplay block" is a
 * legitimate state meaning "keep the built-in": there is no error to notice.
 *
 * So this spec walks the WHOLE chain the platform actually walks, with no step
 * simulated by hand:
 *
 *   the authoring form's own toJson()
 *     → sectionsForScenario()      — what the create form derives a section with
 *     → registerSectionBodies()    — what a client runs on joining a session
 *     → setSessionSections()       — the facilitator's pick, as a custom-<slot>
 *     → applySectionContent()      — publishes CURRENT_SECTION_ROLEPLAY
 *     → CanamedSectionContent.refresh()
 *     → the DOM a student looks at
 *
 * and asserts the student sees the AUTHOR's scene, cast, checklist, phases and
 * panels — never the shipped ones. It also asserts the no-op discipline in the
 * other direction: a scenario with no roleplay block must leave the built-in
 * markup untouched, since that is the behaviour every shipped roleplay relies on.
 *
 * Registered on the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* Deliberately unlike the shipped content in every dimension, so any assertion
   that passes by accident (because SPIKES happens to contain a similar word, or
   the default cast happens to include a physician) is caught. */
const AUTHORED = {
  title: "A difficult discharge",
  vignette: ["The patient wants to go home tonight.",
             "The family does not agree, and the ward is short a bed."],
  roles: [
    { id: "physician", name: "Ward doctor", brief: "You think another night is safer." },
    { id: "relative",  name: "Adult daughter", brief: "You cannot manage another fall at home." },
    { id: "observer",  name: "Watcher", brief: "Note who names the risk first." }
  ],
  framework: "calgary-cambridge",
  phases: [
    { id: "brief", label: "Read the room", minutes: 4, shows: ["vignette", "roles"] },
    { id: "play",  label: "Have the conversation", minutes: 11, shows: ["roles"] }
  ],
  panels: { useful: { label: "Phrases that help",
                      bullets: ["Ask what home actually looks like tonight."] } }
};

/* Build the scenario through the AUTHORING FORM, not by hand — the point is that
   what the facilitator's form emits is what runs. Anything hand-written here
   would test a shape I invented rather than the one the tool produces. */
async function authorScenarioJson(page) {
  await page.goto("/scenario-author.html");
  await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
  return page.evaluate((authored) => {
    const A = window.__scenarioAuthor;
    const s = A.getState();
    s.format = "roleplay";
    s.meta.id = "authored-rp";
    s.meta.name = { en: "Authored roleplay", fr: "", ja: "" };
    s.meta.moduleBName = { en: "A difficult discharge", fr: "", ja: "" };
    s.roleplay.title = authored.title;
    s.roleplay.vignette = authored.vignette.join("\n");
    s.roleplay.roles = authored.roles.map(r => Object.assign({ _extra: {} }, r));
    s.roleplay.framework = authored.framework;
    s.roleplay.phases = authored.phases.map(p => ({
      id: p.id, label: p.label, minutes: String(p.minutes),
      shows: p.shows.slice(), expanded: false, _extra: {}
    }));
    s.roleplay.panels.forEach(p => {
      if (p.id !== "useful") return;
      p.on = true;
      p.label = authored.panels.useful.label;
      p.bullets = authored.panels.useful.bullets.join("\n");
    });
    A.setState(s);
    return JSON.stringify(A.toJson());
  }, AUTHORED);
}

/* Join a session running ONE authored roleplay section, exactly as a client
   does: register the snapshot into the library FIRST, then publish the pick.
   That order is load-bearing — setSessionSections() resolves every token
   immediately, so registering afterwards drops custom-1 as unresolvable and the
   stage simply would not exist. */
async function runAuthoredSection(page, scenarioJson) {
  await page.goto("/");
  await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => !!window.sectionsForScenario);

  const derived = await page.evaluate((json) => {
    const scenario = JSON.parse(json);
    const secs = window.sectionsForScenario(scenario, "authored-rp");
    const rp = secs.find(s => s.type === "roleplay");
    if (!rp) return { ok: false };
    /* Stringified because sectionBodies stores a JSON STRING per slot — the
       same value createSession() writes and registerSectionBodies() parses. */
    window.registerSectionBodies({ "1": JSON.stringify(rp) });
    window.setSessionSections("custom-1");
    return { ok: true, hasRoleplay: !!rp.roleplay };
  }, scenarioJson);
  expect(derived.ok, "the authored scenario must yield a roleplay section").toBe(true);
  /* Asserted here rather than only via the DOM: when this is false every DOM
     assertion below fails at once with no hint of which link broke. */
  expect(derived.hasRoleplay,
    "the roleplay block must survive sectionsForScenario() — it is dropped silently otherwise")
    .toBe(true);

  await page.evaluate(() => {
    ["splash", "lobby", "waiting", "admin-app", "session-ended"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add("hidden");
    });
    document.getElementById("app").classList.remove("hidden");
    document.body.classList.remove("locked");
    window._test_setViewStage(1);
    window.renderStage();
    const s = document.getElementById(window.stageViewId(1));
    if (s) s.classList.remove("hidden");
  });
}

test.describe("An authored roleplay, end to end", () => {
  test("the student sees the AUTHOR's scene, not the shipped one", async ({ page }) => {
    await runAuthoredSection(page, await authorScenarioJson(page));
    const stage = page.locator("#" + (await page.evaluate(() => window.stageViewId(1))));
    const vignette = stage.locator(".vignette");
    /* VISIBLE, not merely present: toContainText reads textContent and passes on
       a node the student cannot see, so the visibility assertion is what makes
       the rest of this test mean "a student sees the authored scene". */
    await expect(vignette).toBeVisible();
    await expect(vignette).toContainText(AUTHORED.title);
    for (const para of AUTHORED.vignette) await expect(vignette).toContainText(para);
    /* The shipped vignette is a breaking-bad-news scene; none of it may survive. */
    await expect(vignette).not.toContainText(/warning shot/i);
  });

  test("the cast is the author's, including a role the built-ins do not have", async ({ page }) => {
    await runAuthoredSection(page, await authorScenarioJson(page));
    const cast = await page.evaluate(() =>
      window.roleplayRoles().map(r => ({ id: r.id, name: r.name })));
    expect(cast.map(r => r.id)).toEqual(["physician", "relative", "observer"]);
    expect(cast.find(r => r.id === "physician").name).toBe("Ward doctor");
    /* "relative" is NOT one of the four default role ids (the default is
       "family"), so its presence proves the authored cast replaced the shipped
       one rather than merging into it. */
    expect(cast.map(r => r.id)).not.toContain("family");
  });

  test("the observer checklist is the authored framework, not SPIKES", async ({ page }) => {
    await runAuthoredSection(page, await authorScenarioJson(page));
    /* The checklist lives inside the collapsed "Your role" reference tab, so it
       has to be opened before its text is readable — same reveal the existing
       modB-observer-checklist spec uses. */
    await page.evaluate(() => {
      const b = document.getElementById("refB-btn-role");
      if (b) b.setAttribute("aria-expanded", "true");
      const p = document.getElementById("refB-panel-role");
      if (p) p.hidden = false;
      const d = document.getElementById("observer-checklist");
      if (d) d.setAttribute("open", "");
    });
    /* Resolved data first: when this is wrong the DOM assertions below all fail
       together and say nothing about which link broke. */
    expect(await page.evaluate(() => window.observationFramework().label)).toMatch(/Calgary/i);
    const list = page.locator("#observer-checklist");
    await expect(list).toContainText(/Initiating the session/i);
    /* SPIKES' own steps must be gone — an antibiotic negotiation handed a
       breaking-bad-news checklist is the exact failure this feature exists for. */
    await expect(list).not.toContainText(/warning shot/i);
  });

  test("the phases are the authored timetable", async ({ page }) => {
    await runAuthoredSection(page, await authorScenarioJson(page));
    const phases = await page.evaluate(() =>
      (window.roleplayPhases() || []).map(p => [p.id, p.label, p.minutes]));
    expect(phases).toEqual([
      ["brief", "Read the room", 4],
      ["play", "Have the conversation", 11]
    ]);
  });

  test("ticking ONE panel hides the three the author did not write", async ({ page }) => {
    /* The trap the emission rules are built around, observed at the far end:
       declaring `panels` opts into controlling the SET, so the other three
       reference panels and their toolbar buttons must disappear. */
    await runAuthoredSection(page, await authorScenarioJson(page));
    const useful = page.locator("#refB-panel-useful");
    await expect(useful).toContainText("Phrases that help");
    await expect(useful).toContainText("Ask what home actually looks like tonight.");
    for (const id of ["history", "guidelines", "recap"]) {
      await expect(page.locator("#refB-btn-" + id),
        `the ${id} button must be hidden — the author did not write that panel`)
        .toHaveClass(/hidden/);
    }
    await expect(page.locator("#refB-btn-useful")).not.toHaveClass(/hidden/);
  });

  test("a scenario with NO roleplay block leaves the shipped content alone", async ({ page }) => {
    /* The other half of the contract, and the one every built-in roleplay
       depends on: omission must stay a no-op, or this feature would silently
       blank the four shipped cases. */
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureRoomStyles());
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.sectionsForScenario);
    const r = await page.evaluate(() => {
      const secs = window.sectionsForScenario({
        id: "plain-rp", name: { en: "Plain" }, moduleBName: { en: "Plain roleplay" }
      }, "plain-rp");
      const rp = secs.find(s => s.type === "roleplay");
      window.registerSectionBodies({ "1": JSON.stringify(rp) });
      window.setSessionSections("custom-1");
      window._test_setViewStage(1);
      window.renderStage();
      return { hasRoleplay: Object.prototype.hasOwnProperty.call(rp, "roleplay"),
               published: window.CURRENT_SECTION_ROLEPLAY };
    });
    expect(r.hasRoleplay, "no empty roleplay key may be invented").toBe(false);
    expect(r.published, "nothing authored ⇒ nothing published ⇒ shipped markup stands").toBeNull();
    /* The shipped panels stay reachable. */
    await expect(page.locator("#refB-btn-history")).not.toHaveClass(/hidden/);
  });
});

/* ── The same gap, found twice more ───────────────────────────────────────────
 * The roleplay block was not the only authored content dropped between the form
 * and the stage. A systematic diff of "what the author emits" against "what
 * survives buildSection()" turned up two more of the identical shape — content
 * silently replaced by a default, with no error and nothing visibly wrong:
 *
 *   1. pre/post knowledge tests. TEST_SPLIT assigns a BUILT-IN case's shared
 *      bank to its PBL or roleplay half, and is keyed by built-in scenario id —
 *      so an authored scenario matched nothing and its questions were emptied.
 *   2. the LLM-chat consultation scoring (scoring.moduleA_questions /
 *      .moduleA_question_penalties). Only `scoring.moduleA` was carried, so an
 *      authored section's chat scoring never reached the engine, which kept
 *      whatever the PREVIOUS scenario left in the global — scoring this case's
 *      conversation against another case's questions.
 */
test.describe("Authored content that is NOT the roleplay block", () => {
  /* Take a skeleton straight from the tool and merge PLAIN DATA into it. The
     patch crosses the boundary as JSON, never as a serialised function, so this
     needs no dynamic code execution — which this repo deliberately removed from
     the author (the Function() sink, round-3 review). */
  async function derive(page, kind, patch) {
    await page.goto("/scenario-author.html");
    await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
    const json = await page.evaluate(({ kind, patch }) => {
      const A = window.__scenarioAuthor;
      const sc = (kind === "roleplay") ? A.roleplaySkeleton() : A.skeleton();
      Object.keys(patch).forEach(k => {
        sc[k] = (k === "scoring") ? Object.assign({}, sc.scoring || {}, patch[k]) : patch[k];
      });
      return JSON.stringify(sc);
    }, { kind, patch });
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.sectionsForScenario);
    return { json };
  }
  const QUESTION = (id, q) => ({ id, q: { en: q }, options: [{ text: { en: "a" }, correct: true }] });

  test("an authored scenario keeps its pre/post knowledge tests", async ({ page }) => {
    const { json } = await derive(page, "pbl",
      { preTest: [QUESTION("p1", "Before?")], postTest: [QUESTION("s1", "After?")] });
    const secs = await page.evaluate(j =>
      window.sectionsForScenario(JSON.parse(j), "probe")
        .map(s => ({ type: s.type, pre: s.preTest.length, post: s.postTest.length })), json);
    const pbl = secs.find(s => s.type === "pbl");
    expect(pbl, "the skeleton must yield a PBL section").toBeTruthy();
    expect([pbl.pre, pbl.post],
      "authored tests are dropped when TEST_SPLIT has no entry for the id").toEqual([1, 1]);
    /* Never DUPLICATED onto a second section: asking the student the same
       questions on two stages is worse than the drop it replaces. */
    const other = secs.find(s => s.type !== "pbl");
    if (other) expect([other.pre, other.post]).toEqual([0, 0]);
  });

  test("an authored roleplay keeps its tests too — the owner is not hardcoded to PBL", async ({ page }) => {
    const { json } = await derive(page, "roleplay", { preTest: [QUESTION("p1", "Before?")] });
    const secs = await page.evaluate(j =>
      window.sectionsForScenario(JSON.parse(j), "probe")
        .map(s => ({ type: s.type, pre: s.preTest.length })), json);
    expect(secs).toEqual([{ type: "roleplay", pre: 1 }]);
  });

  test("authored LLM-chat scoring reaches the engine, and a section without it clears the global", async ({ page }) => {
    const { json } = await derive(page, "pbl", { scoring: {
      moduleA_questions: [{ id: "q-good", points: 2, label: { en: "Asked about red flags" } }],
      moduleA_question_penalties: [{ id: "q-bad", points: -1, label: { en: "Leading question" } }]
    } });
    const r = await page.evaluate((j) => {
      const sec = window.sectionsForScenario(JSON.parse(j), "probe").find(s => s.type === "pbl");
      window.registerSectionBodies({ "1": JSON.stringify(sec) });
      window.setSessionSections("custom-1");
      window._test_setViewStage(1); window.renderStage();
      const withScoring = {
        q: (window.SCORING.moduleA_questions || []).map(x => x.id),
        qp: (window.SCORING.moduleA_question_penalties || []).map(x => x.id)
      };
      /* Now run a section that declares NO chat scoring. The global must be
         CLEARED, not left holding the previous section's rows — a stale global
         is the bug, so silence has to mean "none", never "keep the last one". */
      const bare = JSON.parse(JSON.stringify(sec));
      delete bare.content.scoringQuestions;
      delete bare.content.scoringQuestionPenalties;
      window.registerSectionBodies({ "2": JSON.stringify(bare) });
      window.setSessionSections("custom-2");
      window._test_setViewStage(1); window.renderStage();
      return { withScoring, after: (window.SCORING.moduleA_questions || []).map(x => x.id) };
    }, json);
    expect(r.withScoring).toEqual({ q: ["q-good"], qp: ["q-bad"] });
    expect(r.after, "a section with no chat scoring must not inherit the previous one's").toEqual([]);
  });

  test("a BUILT-IN case still gets its split tests and its own chat scoring", async ({ page }) => {
    /* The regression risk in both fixes: TEST_SPLIT must keep classifying the
       shipped banks, and clearing the chat-scoring global must not blank the
       one built-in case that has any. */
    await page.goto("/");
    await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
    await page.waitForFunction(() => !!window.CANAMED_SECTIONS);
    const r = await page.evaluate(() => {
      const s = window.CANAMED_SECTIONS["chronic-pain-pbl"];
      return { pre: s.preTest.length, post: s.postTest.length,
               q: (s.content.scoringQuestions || []).length,
               qp: (s.content.scoringQuestionPenalties || []).length };
    });
    expect(r.pre).toBeGreaterThan(0);
    expect(r.post).toBeGreaterThan(0);
    expect(r.q, "chronic-pain is the built-in that HAS chat scoring").toBeGreaterThan(0);
    expect(r.qp).toBeGreaterThan(0);
  });
});
