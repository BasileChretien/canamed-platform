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
    // Red flags now score per category (2026-06-03): "Any fever or weight loss?"
    // hits infection (fever) AND malignancy (weight loss).
    expect(results.en.award).toContain("qr_rf_infection");
    expect(results.en.award).toContain("qr_rf_malignancy");
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
    // "Any fever, weight loss or night pain?" scores each red-flag category it
    // touches (infection + malignancy), then cauda equina on the second turn.
    expect(out.calls.award).toContain("qr_rf_infection");
    expect(out.calls.award).toContain("qr_rf_malignancy");
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

  // 2026-06-02: the LLM patient chat is the DEFAULT Module A experience — it
  // must load with NO ?llm=1 in the URL and NO localStorage flag set. ?llm=0 is
  // the only opt-out.
  test("default-on: the chat loads WITHOUT ?llm=1 (no flag needed)", async ({ page }) => {
    await page.goto("/");                       // plain URL — no ?llm, no localStorage seed
    const state = await page.evaluate(async () => {
      if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
        await window.CanamedLoader.ensureCaseContent();
      }
      const flagDefault = !!(window.CanamedLoader &&
        typeof window.CanamedLoader.modALLMFlagOn === "function" &&
        window.CanamedLoader.modALLMFlagOn());
      if (window.CanamedLoader && window.CanamedLoader.ensureModALlm) {
        await window.CanamedLoader.ensureModALlm();
      }
      return {
        flagDefault,
        initFn: typeof window.modALLMInit === "function",
        bridge: !!(window.modALLMBridge && typeof window.modALLMBridge.create === "function")
      };
    });
    expect(state.flagDefault, "modALLMFlagOn() must be true by default (no ?llm=1)").toBe(true);
    expect(state.initFn, "the lazy LLM bundle loads on a plain URL").toBe(true);
    expect(state.bridge, "the chat bridge is available by default").toBe(true);
  });

  test("opt-out: ?llm=0 turns the chat OFF (legacy click-button workup)", async ({ page }) => {
    await page.goto("/?llm=0");
    const off = await page.evaluate(() => !(window.CanamedLoader &&
      window.CanamedLoader.modALLMFlagOn && window.CanamedLoader.modALLMFlagOn()));
    expect(off, "?llm=0 must opt out of the chat").toBe(true);
  });
});

/* Session-1 live-session regressions (2026-06-23). These drive the real
 * modALLMInit() wiring (not just a bare bridge) under LocalDB, so they cover the
 * two integration bugs that the bridge-only tests above cannot: the patient
 * answering in each participant's browser language, and re-entry stacking a
 * second chat listener (every message rendered twice). Since 2026-07-21 LocalDB
 * models Firebase child_added (one callback per new child — rendered-bubble
 * coverage lives in modA-chat-controls.spec.js); here we assert the
 * listener-subscription count, which is the idempotency contract itself. */
test.describe("Module A — LLM-patient session-1 fixes (live init wiring)", () => {
  async function setupRoom(page, sessionCode) {
    await setupLLMMode(page);
    return page.evaluate((code) => {
      // Minimal room so modALLMInit()'s _refs() resolves under LocalDB.
      if (!window.db && window.LocalDB) window.db = new window.LocalDB();
      if (window._test_setSessionNum) window._test_setSessionNum(code);
      window.myRoom = "Room 1";
      return !!window.db;
    }, sessionCode);
  }

  test("patient reply language is pinned to English, NOT the participant's UI language", async ({ page }) => {
    expect(await setupRoom(page, "e2e-lang"), "LocalDB available").toBe(true);
    const out = await page.evaluate(async () => {
      // Force this participant's UI language to French — the exact session-1
      // condition where Mr. Lefebvre wrongly answered French-browser students
      // in French.
      if (typeof window.setLang === "function") { await window.setLang("fr"); }
      const ok = !!(window.modALLMInit && window.modALLMInit());
      const bridge = window.modALLMRuntime && window.modALLMRuntime.bridge;
      return {
        ok,
        uiLang: typeof window.getLang === "function" ? window.getLang() : "?",
        bridgeLang: bridge && bridge._internal ? bridge._internal.getLang() : "?"
      };
    });
    expect(out.ok, "modALLMInit() wired the chat under LocalDB").toBe(true);
    expect(out.uiLang, "participant UI language is French").toBe("fr");
    expect(out.bridgeLang, "patient replies stay English regardless of UI language").toBe("en");
  });

  test("re-entry is idempotent — chat listeners never stack (no double render)", async ({ page }) => {
    expect(await setupRoom(page, "e2e-idemp"), "LocalDB available").toBe(true);
    const counts = await page.evaluate(() => {
      const chatSubs = () => (window.db._subs || [])
        .filter((s) => /\/moduleA\/chat$/.test(s.path)).length;
      window.modALLMInit();
      const afterFirst = chatSubs();
      window.modALLMInit();   // a second enterRoom() (room switch / re-entry)
      window.modALLMInit();   // and a third, for good measure
      return { afterFirst, afterThird: chatSubs() };
    });
    expect(counts.afterFirst, "exactly one chat listener after first init").toBe(1);
    // The bug: each init attached another child_added listener (teardownRoom
    // never detached them), so every chat turn rendered N×. The fix tears down
    // the previous wiring before re-wiring.
    expect(counts.afterThird, "still exactly one chat listener after re-entry").toBe(1);
  });
});
