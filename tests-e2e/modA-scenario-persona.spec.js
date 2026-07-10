/* tests-e2e/modA-scenario-persona.spec.js
 *
 * The Module A chat must voice the patient of the scenario in play.
 *
 * Before slice 0, PATIENT_IDENTITY was a constant in modA-llm-prompts.js while
 * CASE.history[] was swapped by applyScenario(), so picking the jaundice case
 * gave a chat in which "Mr Lefebvre, 45-year-old office worker" demanded
 * oxycodone while quoting Mrs Tanaka's history. Six i18n strings named him too.
 *
 * Runs in LOCAL mode (hermetic, no Firebase, bridge in stub mode) across the
 * desktop + mobile-iphone / mobile-ipad / mobile-android projects, per the
 * CLAUDE.md standing instruction on Module A UI changes.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const SCENARIOS = [
  { id: "chronic-pain-opioids",         patient: "Mr Lefebvre", strangers: ["Tanaka", "Moreau"] },
  { id: "breaking-bad-news-disclosure", patient: "Mrs Tanaka",  strangers: ["Lefebvre", "Moreau"] },
  { id: "respiratory-stewardship",      patient: "Mme Moreau",  strangers: ["Lefebvre", "Tanaka"] }
];

async function loadWithScenario(page, scenarioId) {
  await page.addInitScript(() => {
    try { localStorage.setItem("canamedModALLM", "1"); } catch (_) { /* private mode */ }
  });
  await page.goto("/?llm=1");
  await page.evaluate(async (id) => {
    await window.CanamedLoader.ensureCaseContent();
    await window.CanamedLoader.ensureModALlm();
    window.applyScenario(id);
  }, scenarioId);
}

/* modALLMInit() bails unless _refs() resolves, so give it the minimal room the
 * stub spec uses. Returns the mounted disclosure banner, or null. */
async function mountChat(page, sessionCode) {
  return page.evaluate((code) => {
    if (!window.db && window.LocalDB) window.db = new window.LocalDB();
    if (window._test_setSessionNum) window._test_setSessionNum(code);
    window.myRoom = "Room 1";
    if (window.modALLMInit() === false) return null;
    const el = document.querySelector(".moda-chat-disclosure");
    if (!el) return null;
    return { text: el.textContent, injected: el.querySelectorAll("img,script").length };
  }, sessionCode);
}

test.describe("Module A persona follows the scenario", () => {
  for (const sc of SCENARIOS) {
    test(`${sc.id}: prompt and chat chrome name ${sc.patient}`, async ({ page }) => {
      await loadWithScenario(page, sc.id);

      const out = await page.evaluate(() => ({
        prompt: window.modALLMPrompts.buildPatientPrompt("en"),
        name: window.modALLMPrompts.characterName("en"),
        placeholder: window.t("modA.chat.placeholder"),
        thinking: window.t("modA.chat.thinking"),
        chartTitle: window.t("modA.chart.title"),
        coach: window.t("modA.coach.read-case"),
        diagnosisHint: window.t("modA.answers.bullet.diagnosis.hint")
      }));

      expect(out.name).toBe(sc.patient);

      // The persona, not just the facts, belongs to this scenario.
      expect(out.prompt, "prompt names its own patient").toContain(sc.patient.split(" ").pop());
      for (const stranger of sc.strangers) {
        expect(out.prompt, `prompt must not mention ${stranger}`).not.toContain(stranger);
      }

      // Every string that used to hardcode "Mr Lefebvre".
      for (const [key, value] of Object.entries(out)) {
        if (key === "prompt" || key === "name") continue;
        expect(value, `${key} interpolates the patient name`).toContain(sc.patient);
        expect(value, `${key} leaves no raw placeholder`).not.toContain("{patientName}");
      }
    });
  }

  test("the opioid stance does not bleed into the jaundice case", async ({ page }) => {
    await loadWithScenario(page, "breaking-bad-news-disclosure");
    const prompt = await page.evaluate(() => window.modALLMPrompts.buildPatientPrompt("en"));

    expect(prompt.toLowerCase()).not.toContain("oxycodone");
    expect(prompt.toLowerCase()).not.toContain("office worker");
    // …while her own history is still what she knows.
    expect(prompt).toMatch(/yellow/i);
  });

  test("the disclosure banner names the scenario's patient", async ({ page }) => {
    await loadWithScenario(page, "respiratory-stewardship");
    const banner = await mountChat(page, "e2e-persona");

    expect(banner, "the chat panel mounted").not.toBeNull();
    expect(banner.text).toContain("Mme Moreau");
    expect(banner.text).not.toContain("Lefebvre");
    expect(banner.text).not.toContain("{patientName}");
  });

  test("a hostile character name cannot inject markup into the banner", async ({ page }) => {
    // The banner is the one innerHTML sink that now interpolates scenario-authored
    // text. Once facilitators author personas, the name is untrusted input.
    await page.addInitScript(() => {
      try { localStorage.setItem("canamedModALLM", "1"); } catch (_) { /* private mode */ }
    });
    await page.goto("/?llm=1");
    await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      await window.CanamedLoader.ensureModALlm();
      window.applyScenario("chronic-pain-opioids");
      window.CURRENT_SCENARIO_CHARACTERS = [{
        id: "patient", role: "patient",
        name: '<img src=x onerror="window.__pwned=1">Eve',
        persona: "You are Eve."
      }];
    });

    const banner = await mountChat(page, "e2e-xss");
    expect(banner, "the chat panel mounted").not.toBeNull();
    expect(banner.injected, "no element injected from the name").toBe(0);
    expect(banner.text, "the name renders as inert text").toContain("Eve");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
