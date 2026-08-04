/* tests-e2e/authoring-integrity.spec.js
 *
 * The two authoring-integrity defects, driven through the REAL author page —
 * what a facilitator actually sees in the JSON preview and in the validation
 * panel, not what the pure functions return.
 *
 * A — "Load JSON…" a branched case, and the preview must still contain the
 *     evidence documents, the option rationales and the subset gate. Before the
 *     fix the paste round-trip destroyed all three, silently, and the panel
 *     said the tree was valid.
 * B — a character's `module` box: blank must default to the section's own
 *     module (it used to route the character NOWHERE and the chat fell back to
 *     a generic patient), and a value that is not a module must be REPORTED.
 *
 * Runs on desktop + the three mobile viewports (per-device standing
 * instruction); the author page is the same DOM everywhere, and the point of
 * the mobile runs is that the character hint + the validation panel remain
 * reachable and readable on a narrow screen.
 */

const { test, expect } = require("./fixtures");

/* A cut-down but STRUCTURALLY REAL branched case: a node with an evidence
   `documents` panel, options carrying `why`, and the subset gate
   ({ option: [1, 2] }) that the forward-edge model could not express. */
const BRANCHED_JSON = {
  id: "e2e-integrity-branched",
  format: "branched",
  name: { en: "Integrity branched case" },
  summary: { en: "Carries documents, why and a subset gate." },
  moduleAName: { en: "Integrity" },
  case: { history: [], exam: [], labs: [] },
  scoring: {},
  penalties: [],
  synthPrereqs: [],
  decisions: [
    {
      id: "b_first",
      module: "A",
      points: 20,
      penalty: 15,
      documents: [
        {
          title: { en: "Bedside observations" },
          text: { en: "RR 28 - SpO2 88% on air - BP 95/60 - HR 118." },
        },
      ],
      prompt: { en: "Your team's first move is..." },
      options: [
        {
          text: { en: "Oxygen and reassess" },
          correct: true,
          why: { en: "Treat the patient in front of you before the screen." },
          branch: { reveal: { en: "SpO2 climbs to 94%." } },
        },
        {
          text: { en: "Wait for the film" },
          correct: false,
          why: { en: "Investigation is not resuscitation." },
          branch: { reveal: { en: "Twenty minutes pass." } },
        },
        {
          text: { en: "Fluid bolus and recheck later" },
          correct: false,
          why: { en: "Thirty minutes is far too long to look away." },
          branch: { reveal: { en: "He is mottled when you return." } },
        },
      ],
    },
    {
      id: "b_good",
      module: "A",
      points: 20,
      penalty: 15,
      unlockWhen: { afterDecision: { id: "b_first", option: 0 } },
      hideWhenLocked: true,
      prompt: { en: "He is stabilising. Next?" },
      options: [
        {
          text: { en: "Call the outreach team" }, correct: true,
          why: { en: "Escalate early." },
          branch: { reveal: { en: "They arrive within minutes. The case ends well." } },
        },
        {
          text: { en: "Document and hand over" }, correct: false,
          why: { en: "A note is not a plan." },
          branch: { reveal: { en: "The note is immaculate; nobody comes." } },
        },
      ],
    },
    {
      id: "b_bad",
      module: "A",
      points: 20,
      penalty: 15,
      // The SUBSET gate: choices 1 and 2 of a THREE-choice node, so an id-only
      // "any option of b_first" gate would wrongly also open it after choice 0.
      unlockWhen: { afterDecision: { id: "b_first", option: [1, 2] } },
      hideWhenLocked: true,
      documents: [
        { title: { en: "Repeat observations" }, text: { en: "SpO2 84% - RR 32." } },
      ],
      prompt: { en: "He has deteriorated. Next?" },
      options: [
        {
          text: { en: "Put out an emergency call" }, correct: true,
          why: { en: "He needs a team now." },
          branch: { reveal: { en: "The team arrives late but he survives." } },
        },
        {
          text: { en: "Another bolus" }, correct: false,
          why: { en: "More fluid is not the answer." },
          branch: { reveal: { en: "He tips into pulmonary oedema. The case ends here." } },
        },
      ],
    },
  ],
};

/* A one-character roleplay section, so the `module` box has a section to
   default to and a wrong value has somewhere visible to fail. */
const ROLEPLAY_JSON = {
  id: "e2e-integrity-cast",
  name: { en: "Integrity cast" },
  summary: { en: "One character, one roleplay section." },
  moduleBName: { en: "Breaking the news" },
  modules: ["B"],
  case: { history: [], exam: [], labs: [], prompts: [] },
  scoring: { moduleB: [{ id: "fam", points: 5, label: { en: "Empathy" }, any: ["sorry"] }] },
  penalties: [],
  decisions: [],
  synthId: "labs:0",
  synthPrereqs: [],
  characters: [
    {
      id: "daughter",
      role: "relative",
      module: "B",
      name: { en: "Ms Okada" },
      persona: "You are the patient's frightened daughter.",
    },
  ],
};

async function loadJson(page, obj) {
  await page.locator("#btn-load").click();
  await expect(page.locator("#load-modal")).toBeVisible();
  await page.locator("#load-textarea").fill(JSON.stringify(obj));
  await page.locator("#btn-load-apply").click();
  await expect(page.locator("#load-modal")).toBeHidden();
}

const preview = (page) => page.locator("#json-preview");

test.describe("authoring integrity", () => {
  test("A — loading a branched case keeps its documents, rationales and subset gate", async ({
    page,
  }) => {
    await page.goto("/scenario-author.html");
    await loadJson(page, BRANCHED_JSON);

    // The branch editor is what opened (not the standard PBL form).
    await expect(page.locator("#branched-editor")).toBeVisible();
    await expect(page.locator("#list-branched .dyn-row")).toHaveCount(3);

    // What the facilitator would copy out. Parsing it is the honest assertion:
    // the preview is the artefact they ship.
    const out = JSON.parse(await preview(page).inputValue());

    const first = out.decisions.find((d) => d.id === "b_first");
    expect(first.documents, "the evidence panel must survive the load").toBeTruthy();
    expect(first.documents[0].text.en).toContain("SpO2 88%");
    expect(first.options[0].why.en).toContain("Treat the patient");

    // Every rationale, not just the first.
    const whys = JSON.stringify(out).split('"why"').length - 1;
    expect(whys, "all seven option rationales must survive").toBe(7);

    // The subset gate is preserved EXACTLY — an id-only gate here would open
    // the deterioration node after the correct choice too.
    const bad = out.decisions.find((d) => d.id === "b_bad");
    expect(bad.unlockWhen).toEqual({ afterDecision: { id: "b_first", option: [1, 2] } });
    expect(bad.documents[0].text.en).toContain("SpO2 84%");

    // And the tree the author is told is valid really is.
    await expect(page.locator("#branched-validation")).toContainText("Valid branch tree");
  });

  test("B — a blank character module follows the section, and a bad one is reported", async ({
    page,
  }) => {
    await page.goto("/scenario-author.html");
    await loadJson(page, ROLEPLAY_JSON);

    const moduleBox = page
      .locator("#list-characters .dyn-row")
      .first()
      .locator('input[type="text"]')
      .nth(2); // id / role / module / present

    await expect(moduleBox).toHaveValue("B");
    // The rule is on screen, not just in a test.
    await expect(page.locator("#list-characters")).toContainText(
      "which section this character appears in",
    );

    // BLANK — used to route the character to NO section at all.
    await moduleBox.fill("");
    expect(JSON.parse(await preview(page).inputValue()).characters[0].module).toEqual(["B"]);
    await page.locator("#btn-validate").click();
    await expect(page.locator("#validation-output")).not.toContainText("Character 1");

    // Lower case is repaired rather than rejected.
    await moduleBox.fill("b");
    expect(JSON.parse(await preview(page).inputValue()).characters[0].module).toEqual(["B"]);

    // A value that is not a module is REPORTED, with the value named.
    await moduleBox.fill("banana");
    await page.locator("#btn-validate").click();
    const out = page.locator("#validation-output");
    await expect(out).toContainText("banana");
    await expect(out).toContainText("is not a module");

    // "branched" is recognised vocabulary but matches nothing in a standard
    // scenario — say so instead of banning or silently dropping it.
    await moduleBox.fill("branched");
    await page.locator("#btn-validate").click();
    await expect(out).toContainText("only applies to a scenario whose");

    // Back to a good value: the character error clears.
    await moduleBox.fill("B");
    await page.locator("#btn-validate").click();
    await expect(out).not.toContainText("Character 1");
  });
});
