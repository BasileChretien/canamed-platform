/* tests-e2e/branched-format.spec.js
 *
 * Branched-scenarios format — browser-level integration of the wiring + the
 * épuré CSS, on the real stylesheet served from this checkout (LOCAL mode).
 *
 * Verifies:
 *   1. script-loader's ensureCaseContent() merges the branched seed scenario
 *      into window.CANAMED_SCENARIOS (the load-order chain works in a browser);
 *   2. applyScenario() flips body[data-format="branched"];
 *   3. the épuré CSS actually computes: in a revealed stage-1 the case chrome
 *      (vignette, left chart column, rcol tab bar) is display:none while the
 *      decisions column survives — and that NONE of that hiding happens in the
 *      standard (non-branched) layout (regression guard for the two existing
 *      formats).
 *
 * The full multi-participant vote → commit → branch-advance flow is covered
 * separately; this spec locks the integration seam + CSS without needing a
 * live session. Runs on the desktop + per-device matrix (standing rule).
 */

const { test, expect } = require("./fixtures");

test.describe("branched-scenarios format", () => {
  test("the seed scenario registers and is tagged branched", async ({
    page,
  }) => {
    await page.goto("/");
    const info = await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      const sc = (window.CANAMED_SCENARIOS || {})["ward-escalation-branched"];
      return sc
        ? { format: sc.format, nodes: sc.decisions.length, name: sc.name.en }
        : null;
    });
    expect(
      info,
      "branched seed must be in the registry after ensureCaseContent",
    ).not.toBeNull();
    expect(info.format).toBe("branched");
    expect(info.nodes).toBeGreaterThanOrEqual(3);
    expect(info.name).toMatch(/Breathless/i);
  });

  test("applyScenario flips body[data-format] and the épuré CSS hides the chrome", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      window.applyScenario("ward-escalation-branched");
      // Force the room + stage-1 visible so computed styles reflect the live
      // layout (no session needed for a pure CSS assertion).
      const rm = document.getElementById("room-main");
      if (rm) (rm.classList.remove("hidden"), (rm.style.display = "block"));
      const s1 = document.getElementById("stage-1");
      if (s1) s1.classList.remove("hidden");
    });

    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "branched",
    );

    const disp = (sel) =>
      page.evaluate((s) => {
        const n = document.querySelector(s);
        return n ? getComputedStyle(n).display : "absent";
      }, sel);

    // Case chrome hidden…
    expect(await disp("#stage-1 .vignette")).toBe("none");
    expect(await disp("#stage-1 .columns > .col-left")).toBe("none");
    expect(await disp("#stage-1 .rcol-tabs")).toBe("none");
    // …decisions column survives.
    expect(await disp("#stage-1 .columns > .col-right")).not.toBe("none");
    expect(await disp("#decisions-A")).not.toBe("none");
  });

  test("standard layout is untouched (regression guard for PBL/roleplay)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await window.CanamedLoader.ensureCaseContent();
      // Standard scenario → no branched hiding.
      window.applyScenario("chronic-pain-opioids");
      const rm = document.getElementById("room-main");
      if (rm) (rm.classList.remove("hidden"), (rm.style.display = "block"));
      const s1 = document.getElementById("stage-1");
      if (s1) s1.classList.remove("hidden");
    });
    expect(await page.evaluate(() => document.body.dataset.format)).toBe(
      "standard",
    );
    const leftDisp = await page.evaluate(() => {
      const n = document.querySelector("#stage-1 .columns > .col-left");
      return n ? getComputedStyle(n).display : "absent";
    });
    expect(leftDisp).not.toBe("none"); // chart column visible in standard mode
  });

  test("branched documents render via the lazy branched-render.js (per-device)", async ({
    page,
  }) => {
    await page.goto("/");
    const r = await page.evaluate(async () => {
      // ensureCaseContent() chains branched-render.js — the lazy documents
      // renderer that buildDecision delegates to.
      await window.CanamedLoader.ensureCaseContent();
      const br = window.CanamedBranchedRender;
      if (!br || !br.buildDecisionDocs) return { loaded: false };
      const node = {
        documents: [
          {
            title: { en: "Bedside observations" },
            text: { en: "RR 28 · SpO2 88%" },
          },
          {
            title: { en: "Chest X-ray" },
            image: "scenario-images/sample-clinical.svg",
          },
        ],
      };
      const block = br.buildDecisionDocs(node, "en");
      if (!block) return { loaded: true, built: false };
      document.body.appendChild(block);
      const img = block.querySelector(".dec-doc-img");
      return {
        loaded: true,
        built: true,
        docCount: block.querySelectorAll(".dec-doc").length,
        text: block.textContent,
        imgSrc: img ? img.getAttribute("src") : null,
      };
    });
    expect(r.loaded, "branched-render.js must load via ensureCaseContent").toBe(
      true,
    );
    expect(r.built).toBe(true);
    expect(r.docCount).toBe(2);
    expect(r.text).toMatch(/Bedside observations/);
    expect(r.imgSrc).toBe("scenario-images/sample-clinical.svg");
  });
});
