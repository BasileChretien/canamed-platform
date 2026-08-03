/* tests-e2e/roleplay-authoring.spec.js
 *
 * S5 — the roleplay's CONTENT is authorable in the form.
 *
 * Until now the only roleplay field the tool offered was the section NAME:
 * the scene, the cast and their private briefs, the observer's checklist, the
 * phase timetable and the four reference panels all had to arrive as pasted
 * JSON. "Author a roleplay" therefore meant "hand-edit JSON", which is the one
 * thing this tool exists to prevent. The block survived a round-trip only
 * because `_extra` carried it opaquely — invisible, uneditable.
 *
 * The contract under test is section-content.js's, not a new one. Its two
 * defining behaviours are what most of these assertions are about:
 *
 *   OMISSION IS MEANINGFUL. Declaring nothing keeps the shipped built-in;
 *   declaring something opts into FULL control. `roleplayPanels()` returns
 *   `rp.panels` whenever it is an object — and `{}` is an object — so writing
 *   an empty panels bag would hide all four panels and their toolbar buttons
 *   instead of leaving the shipped ones alone.
 *
 *   MALFORMED INPUT IS DROPPED SILENTLY. A role or phase id that fails
 *   /^[a-z][a-z0-9_-]{0,23}$/ is skipped at runtime with no message, so the
 *   roleplay runs with a cast the author did not write. validate() has to say
 *   so here, because nothing downstream ever will.
 *
 * Registered in the three mobile testMatch allowlists per the standing
 * per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openAuthor(page) {
  await page.goto("/scenario-author.html");
  await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
  await page.selectOption("#meta-format", "roleplay");
}
const rpJson = (page) => page.evaluate(() => window.__scenarioAuthor.toJson().roleplay || null);

test.describe("Author — roleplay content", () => {
  test("the roleplay fieldset belongs to the roleplay format alone", async ({ page }) => {
    await page.goto("/scenario-author.html");
    await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
    const vis = () => page.evaluate(() => {
      const n = document.getElementById("roleplay-section");
      return n ? getComputedStyle(n).display !== "none" : false;
    });
    expect(await vis()).toBe(false);          // pbl is the default
    await page.selectOption("#meta-format", "roleplay");
    expect(await vis()).toBe(true);
    await page.selectOption("#meta-format", "branched");
    expect(await vis()).toBe(false);
  });

  test("a PBL scenario never grows an empty roleplay key", async ({ page }) => {
    /* The block has one field with a non-empty default (framework: spikes), so
       a naive "emit whatever is in state" writes `roleplay` into every PBL
       scenario. It must stay absent until something is actually authored. */
    await page.goto("/scenario-author.html");
    await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
    await page.evaluate(() => {
      const A = window.__scenarioAuthor;
      A.setState(A.fromJson(A.skeleton()));
    });
    expect(await rpJson(page)).toBeNull();
  });

  test("typing a scene and a role writes them to the JSON", async ({ page }) => {
    await openAuthor(page);
    await page.locator("#rp-scene input").first().fill("A difficult discharge");
    await page.locator("#rp-scene textarea").first()
      .fill("The patient wants to go home tonight.\nThe family does not agree.");
    await page.locator('.add-btn[data-add="rp-roles"]').click();
    const row = page.locator("#list-rp-roles .dyn-row").first();
    await row.locator("input").nth(0).fill("physician");
    await row.locator("input").nth(1).fill("Ward doctor");
    await row.locator("textarea").first().fill("You think another night is safer.");

    expect(await rpJson(page)).toMatchObject({
      title: "A difficult discharge",
      vignette: ["The patient wants to go home tonight.", "The family does not agree."],
      roles: [{ id: "physician", name: "Ward doctor", brief: "You think another night is safer." }]
    });
  });

  test("a phase names the cards it shows by TICK BOX, never by selector", async ({ page }) => {
    /* `shows` reaches querySelectorAll at runtime, so a free-text field would
       let a facilitator write a malformed selector or reach chrome the section
       has no business touching. Tick boxes make an unknown key untypable. */
    await openAuthor(page);
    await page.locator('.add-btn[data-add="rp-phases"]').click();
    const row = page.locator("#list-rp-phases .dyn-row").first();
    await row.locator("input[type=text]").nth(0).fill("play");
    await row.locator("input[type=text]").nth(1).fill("Play the scene");
    await row.locator("input[type=number]").first().fill("12");
    await row.locator(".check-row .check-cell").filter({ hasText: "roles" }).locator("input").check();

    const rp = await rpJson(page);
    expect(rp.phases).toEqual([{ id: "play", label: "Play the scene", minutes: 12, shows: ["roles"] }]);

    /* Every offered key must be one the runtime actually resolves. */
    const offered = await row.locator(".check-row .check-cell span").allTextContents();
    expect(offered).toEqual(["vignette", "roles", "exchange", "decisions", "swap", "replay", "reflect"]);
  });

  test("the checklist comes from the library, or from your own steps", async ({ page }) => {
    await openAuthor(page);
    const sel = page.locator("#rp-framework select");
    expect(await sel.locator("option").evaluateAll(o => o.map(x => x.value)))
      .toEqual(["spikes", "calgary-cambridge", "pause-explore-explain-realign", "custom"]);

    /* A non-default library pick is authored content on its own. */
    await sel.selectOption("calgary-cambridge");
    expect(await rpJson(page)).toEqual({ framework: "calgary-cambridge" });

    await sel.selectOption("custom");
    await page.locator("#list-rp-steps .add-btn").click();
    const step = page.locator("#list-rp-steps .dyn-row").first();
    await step.locator("input").nth(0).fill("q1");
    await step.locator("input").nth(1).fill("Asked what the family understood");
    await page.locator("#list-rp-steps input").first().fill("Family meeting");

    expect((await rpJson(page)).framework).toEqual({
      label: "Family meeting",
      steps: [{ id: "q1", label: "Asked what the family understood" }]
    });
  });

  test("a custom framework with no usable step is refused, not silently ignored", async ({ page }) => {
    /* The runtime drops it and shows the shipped SPIKES list instead — so the
       author would believe they replaced a checklist they had not. */
    await openAuthor(page);
    await page.locator("#rp-framework select").selectOption("custom");
    const errs = await page.evaluate(() => window.__scenarioAuthor.validate());
    expect(errs.join(" ")).toContain("add at least one step");
  });

  test("a malformed or duplicate id is reported, because the runtime just drops it", async ({ page }) => {
    await openAuthor(page);
    for (let i = 0; i < 3; i++) await page.locator('.add-btn[data-add="rp-roles"]').click();
    const rows = page.locator("#list-rp-roles .dyn-row");
    await rows.nth(0).locator("input").nth(0).fill("Physician");   // capital → invalid
    /* A duplicate is only worth reporting when the id is otherwise VALID — an
       invalid one is already covered, and saying both would be noise. */
    await rows.nth(1).locator("input").nth(0).fill("patient");
    await rows.nth(2).locator("input").nth(0).fill("patient");
    const errs = (await page.evaluate(() => window.__scenarioAuthor.validate())).join(" | ");
    expect(errs).toContain("is not usable");
    expect(errs).toContain("duplicate id");
  });

  test("ticking one panel is opting into ALL FOUR — an empty one is never written", async ({ page }) => {
    /* This is the trap the whole block is shaped around: `panels: {}` is an
       object, so the runtime treats it as "I control the panels" and hides
       every one of them, buttons included. */
    await openAuthor(page);
    const first = page.locator("#list-rp-panels .dyn-row").first();
    await first.locator("input[type=checkbox]").check();
    expect(await rpJson(page)).toBeNull();                   // ticked but empty ⇒ nothing written

    const errs = await page.evaluate(() => window.__scenarioAuthor.validate());
    expect(errs.join(" ")).toContain("ticked but empty");

    await first.locator("textarea").last().fill("Open with a question.\nThen wait.");
    expect((await rpJson(page)).panels).toEqual({
      history: { bullets: ["Open with a question.", "Then wait."] }
    });
  });

  test("the roleplay skeleton round-trips byte-identically through the form", async ({ page }) => {
    /* The block used to survive only via the opaque `_extra` bag. Now that the
       form models it, the form is what has to preserve it — including key
       order, so re-exporting an unchanged scenario yields no diff noise. */
    await openAuthor(page);
    const r = await page.evaluate(() => {
      const A = window.__scenarioAuthor;
      const sk = A.roleplaySkeleton();
      A.setState(A.fromJson(sk));
      return { before: JSON.stringify(sk.roleplay), after: JSON.stringify(A.toJson().roleplay) };
    });
    expect(r.after).toBe(r.before);
  });

  test("an unknown key inside the roleplay block still round-trips", async ({ page }) => {
    /* Modeling a key removes it from the `_extra` known-list; anything NOT
       modeled must still pass through, or the form silently eats a field a
       future runtime added. */
    await openAuthor(page);
    const out = await page.evaluate(() => {
      const A = window.__scenarioAuthor;
      A.setState(A.fromJson({ id: "x", moduleBName: { en: "R" },
                              roleplay: { title: "T", futureKey: { a: 1 } } }));
      return A.toJson().roleplay;
    });
    expect(out).toMatchObject({ title: "T", futureKey: { a: 1 } });
  });
});
