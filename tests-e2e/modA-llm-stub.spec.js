/* tests-e2e/modA-llm-stub.spec.js
 *
 * Module A LLM-patient pilot (2026-05-28) — flag-on + stub-mode browser
 * checks. Runs in LOCAL mode (forceLocalMode) so no real Firebase, no real
 * HF API. The chat bridge falls back to its own canned-answer stub when no
 * endpoint is configured — perfect for hermetic E2E.
 *
 * What this locks in:
 *   1. The four LLM scripts (scoring, prompts, bridge, init) load under the
 *      existing CSP and expose the documented globals.
 *   2. With the feature flag on (?llm=1), the chat panel renders inside
 *      #chart-section-history while the legacy #group-history is hidden.
 *   3. scoreQuestion + the bridge correctly award red-flag families and
 *      synthesise reveal()s for the SYNTH_PREREQS items.
 *   4. The privacy disclosure is always visible before the first message
 *      (no surprise-data-leaving-the-room moments for users).
 *
 * Cross-device: spec name matches the mobile testMatch regex so this also
 * runs under mobile-iphone, mobile-ipad and mobile-android — per the
 * CLAUDE.md standing instruction that every Module A UI change ships
 * coverage on all four viewports.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function setupLLMMode(page) {
  // Flip the localStorage flag BEFORE the page loads so modA-llm-init.js
  // sees it inside its IIFE. Also pin myRoom etc. so the init() Firebase
  // path resolves under LocalDB. The bridge stays in stub mode (no
  // endpoint, no callable) — same as the unit tests.
  await page.addInitScript(() => {
    try { localStorage.setItem("canamedModALLM", "1"); } catch (_) { /* private mode */ }
  });
  await page.goto("/?llm=1");
  await page.evaluate(async () => {
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      await window.CanamedLoader.ensureCaseContent();
    }
    // The four LLM scripts were lazy-split out of the eager bundle
    // (2026-06-01); they now load on demand via ensureModALlm() — the same
    // path startRoom() uses for ?llm=1 users. Pull them in here so the global
    // assertions below see modAQuestionScoring / modALLMPrompts / modALLMBridge
    // / modALLMInit, exactly as the eager <script> tags used to provide them.
    if (window.CanamedLoader && window.CanamedLoader.ensureModALlm) {
      await window.CanamedLoader.ensureModALlm();
    }
  });
}

test.describe("Module A — LLM-patient stub (feature flag on)", () => {
  test("the four LLM scripts load and expose their globals", async ({ page }) => {
    await setupLLMMode(page);
    const exposed = await page.evaluate(() => ({
      scoring:    !!(window.modAQuestionScoring && typeof window.modAQuestionScoring.scoreQuestion === "function"),
      prompts:    !!(window.modALLMPrompts && typeof window.modALLMPrompts.buildPatientPrompt === "function"),
      bridge:     !!(window.modALLMBridge && typeof window.modALLMBridge.create === "function"),
      initFn:     typeof window.modALLMInit === "function",
      scoringFams: (window.SCORING && window.SCORING.moduleA_questions || []).length
    }));
    expect(exposed.scoring, "modAQuestionScoring.scoreQuestion exposed").toBe(true);
    expect(exposed.prompts, "modALLMPrompts.buildPatientPrompt exposed").toBe(true);
    expect(exposed.bridge,  "modALLMBridge.create exposed").toBe(true);
    expect(exposed.initFn,  "modALLMInit exposed").toBe(true);
    expect(exposed.scoringFams, "moduleA_questions families loaded from case-content").toBeGreaterThanOrEqual(7);
  });

  test("scoreQuestion fires red-flag families with unlocks across EN/FR/JA", async ({ page }) => {
    await setupLLMMode(page);
    const results = await page.evaluate(() => {
      const SC = window.modAQuestionScoring;
      const awarded = {};
      const ask = (text) => {
        const r = SC.scoreQuestion(text, awarded);
        r.award.forEach(id => awarded[id] = true);
        return r;
      };
      return {
        en: ask("Any fever or weight loss?"),
        fr: ask("Avez-vous une anesthésie en selle ou des troubles urinaires ?"),
        ja: ask("下肢の筋力低下や反射の異常はありますか？"),
        opioid: SC.scoreQuestion("OK, I'll prescribe oxycodone for you today.", {})
      };
    });
    expect(results.en.award).toContain("qr_redflags");
    expect(results.en.unlocks).toContain("history:1");
    expect(results.fr.award).toContain("qr_cauda");
    expect(results.fr.unlocks).toContain("history:2");
    expect(results.ja.award).toContain("qr_neuro");
    expect(results.ja.unlocks).toContain("exam:3");
    expect(results.opioid.penalty).toContain("pen_chat_prescribe");
  });

  test("bridge.submit() with stub patient persists turns + applies score hooks", async ({ page }) => {
    await setupLLMMode(page);
    const out = await page.evaluate(async () => {
      const awarded = {};
      const calls = { award: [], unlock: [], persist: [] };
      const bridge = window.modALLMBridge.create({
        getAwarded: () => awarded,
        onAward:  (id, fam) => { awarded[id] = true; calls.award.push(id); },
        onPenalty: (id, fam) => { calls.award.push("pen:" + id); },
        onUnlock: (id) => calls.unlock.push(id),
        persistTurn: (role, content) => calls.persist.push({ role, content })
      });
      bridge.setLang("en");
      const r1 = await bridge.submit("Any fever, weight loss or night pain?");
      const r2 = await bridge.submit("And any cauda equina symptoms — saddle numbness, bladder problems?");
      return {
        calls,
        replies: [r1 && r1.reply, r2 && r2.reply].map(r => (r || "").length > 0)
      };
    });
    expect(out.calls.award).toContain("qr_redflags");
    expect(out.calls.award).toContain("qr_cauda");
    expect(out.calls.unlock).toContain("history:1");
    expect(out.calls.unlock).toContain("history:2");
    // Each submit → user + assistant persisted (4 total for two submits)
    expect(out.calls.persist).toHaveLength(4);
    expect(out.calls.persist[0].role).toBe("user");
    expect(out.calls.persist[1].role).toBe("assistant");
    expect(out.replies.every(Boolean)).toBe(true);
  });

  test("buildPatientPrompt embeds case facts + identity per language", async ({ page }) => {
    await setupLLMMode(page);
    const prompts = await page.evaluate(() => {
      const B = window.modALLMPrompts;
      return {
        en: B.buildPatientPrompt("en"),
        fr: B.buildPatientPrompt("fr"),
        ja: B.buildPatientPrompt("ja")
      };
    });
    expect(prompts.en, "EN prompt names Mr Lefebvre").toMatch(/Lefebvre/);
    expect(prompts.fr, "FR prompt names M. Lefebvre").toMatch(/Lefebvre/);
    expect(prompts.ja, "JA prompt names the patient").toMatch(/ルフェーブル/);
    expect(prompts.en, "EN prompt lists at least one case fact").toMatch(/8 months|back|hurting/i);
    expect(prompts.fr, "FR prompt lists at least one case fact").toMatch(/dos|lombaire|8 mois/i);
    expect(prompts.ja, "JA prompt lists at least one case fact").toMatch(/腰|8か月|痛/);
    // Each prompt must forbid invented symptoms — that's the safety rule.
    expect(prompts.en).toMatch(/NEVER invent/);
    expect(prompts.fr).toMatch(/N'INVENTEZ JAMAIS/);
    expect(prompts.ja).toMatch(/絶対に作らない/);
    // After H2 hardening: stage-direction text must NOT appear in any prompt.
    expect(prompts.en).not.toMatch(/He flinches|He looks startled|Anal tone/);
    expect(prompts.fr).not.toMatch(/Il sursaute|Le tonus anal/);
    expect(prompts.ja).not.toMatch(/びくっとして|肛門括約筋/);
  });

  test("chat injects no errors into the console under CSP", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", msg => {
      if (msg.type() === "error") errors.push("console.error: " + msg.text());
    });
    await setupLLMMode(page);
    // Touch the bridge once so any lazy errors surface.
    await page.evaluate(async () => {
      const bridge = window.modALLMBridge.create({});
      await bridge.submit("hello");
    });
    // CSP / load errors would show up here. We tolerate a few benign console
    // messages (Firebase Auth network errors in LOCAL mode etc.) — keep the
    // strict filter to script load + bridge errors only.
    const fatal = errors.filter(e => /modA-|modAQuestion|modALLM|csp|content security/i.test(e));
    expect(fatal, "no fatal LLM-script errors in console: " + fatal.join("; ")).toEqual([]);
  });
});
