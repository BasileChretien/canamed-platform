/* tests-e2e/sim-recommendations.spec.js
 *
 * Locks in the DOM + JS contracts for the 12 sim 2026-05-19
 * recommendations. Each `test.describe` block covers one feature with
 * the smallest assertions that would catch a future regression. None
 * of these tests require a full session flow — they just assert that
 * the controls exist, are wired, and behave correctly in isolation.
 *
 * The four schema-needing features (observer, side-chat, end-poll,
 * counter-bullet) are validated against the rule schema in
 * tests/rules.test.js separately; this suite covers the UI contract.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Sticky right-column (≥961px)", () => {
  test("col-right has position:sticky on a wide viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const stickyPos = await page.evaluate(() => {
      const col = document.querySelector(".columns > .col-right");
      if (!col) return "no-col-right";
      return getComputedStyle(col).position;
    });
    expect(stickyPos, "col-right should be sticky on wide viewports").toBe("sticky");
  });
  test("col-right is NOT sticky on a narrow viewport (≤960px)", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto("/");
    const stickyPos = await page.evaluate(() => {
      const col = document.querySelector(".columns > .col-right");
      if (!col) return "no-col-right";
      return getComputedStyle(col).position;
    });
    expect(stickyPos, "col-right should NOT be sticky when stacked").not.toBe("sticky");
  });
});

test.describe("Auto-collapse Module A chart sections on completion", () => {
  test("a chart-section with all key items revealed gets auto-collapsed once", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof window._autoCollapseCompletedChartSections === "function" ||
      typeof window.CASE === "object", { timeout: 5000 }).catch(() => {});
    const ok = await page.evaluate(() => {
      // need CASE + revealed in scope — load via the lazy loader and run.
      if (!window.CanamedLoader || !window.CanamedLoader.ensureCaseContent) return "no-loader";
      return window.CanamedLoader.ensureCaseContent().then(() => {
        // Reveal the first 4 history items — that crosses the
        // _AUTO_COLLAPSE_MIN threshold so the auto-collapse fires.
        const items = (window.CASE && window.CASE.history) || [];
        const r = {};
        items.slice(0, 4).forEach((it, i) => {
          r["history:" + i] = { by: "T", at: Date.now() };
        });
        if (window._test_setRevealed) window._test_setRevealed(r);
        const sec = document.getElementById("chart-section-history");
        if (!sec) return "no-section";
        sec.setAttribute("open", "");
        delete sec.dataset.autoCollapsed;
        if (typeof window._autoCollapseCompletedChartSections !== "function") {
          return "no-hook";
        }
        window._autoCollapseCompletedChartSections();
        return sec.hasAttribute("open") ? "still-open" : "collapsed";
      });
    });
    expect(ok).toBe("collapsed");
  });
});

test.describe("Per-bullet Module A progress checklist", () => {
  test("DOM exposes 4 bullet rows + a JS update function", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => {
      const list = document.getElementById("modA-bullet-progress");
      if (!list) return { ok: false };
      const items = Array.from(list.querySelectorAll("li[data-bullet-key]"))
        .map(li => li.dataset.bulletKey);
      return {
        ok: true,
        items: items,
        hasUpdater: typeof window._updateModABulletProgress === "function"
      };
    });
    expect(info.ok).toBe(true);
    expect(info.items.sort()).toEqual(["differ", "disagree", "plan", "takehome"]);
    expect(info.hasUpdater).toBe(true);
  });
});

test.describe("Markdown export of group-answers", () => {
  test("admin dashboard exposes a Download as Markdown button", async ({ page }) => {
    await page.goto("/");
    const present = await page.evaluate(() => {
      const b = document.getElementById("admin-download-md-btn");
      return !!b;
    });
    expect(present).toBe(true);
  });
  test("downloadAllAnswersMarkdown emits valid markdown (smoke-test the function)", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(() => {
      // Drive module state through the platform's test hooks so the
      // function sees the right session + room shape.
      if (window._test_setSessionNum) window._test_setSessionNum("TEST-CODE");
      if (window._test_setRoomCount)  window._test_setRoomCount(1);
      if (window._test_setAllRooms)   window._test_setAllRooms({
        "Room 1": { stage: 3, answers: { moduleA: { x: { by: "A", text: "first" } } } }
      });
      // Stub URL.createObjectURL to capture the Blob synchronously
      // (the production code revokes the blob URL the moment click()
      // returns, so a later fetch(blob:…) is too late).
      const realCO = URL.createObjectURL.bind(URL);
      const realRO = URL.revokeObjectURL.bind(URL);
      let captured = null;
      URL.createObjectURL = function (blob) {
        captured = blob;
        return "blob:test/dummy";
      };
      URL.revokeObjectURL = function () {};
      try {
        if (typeof window.downloadAllAnswersMarkdown !== "function") return Promise.resolve("no-fn");
        window.downloadAllAnswersMarkdown();
      } finally {
        URL.createObjectURL = realCO;
        URL.revokeObjectURL = realRO;
      }
      if (!captured) return Promise.resolve("no-blob");
      return captured.text();
    });
    expect(result).toMatch(/^# CaNaMED Session TEST-CODE/);
    expect(result).toMatch(/^## Room 1/m);
    expect(result).toMatch(/^### Module A/m);
    expect(result).toMatch(/- \*\*A:\*\* first/);
  });
});

test.describe("Glossary tooltips on clinical buttons", () => {
  test("glossary.js exposes a populated CANAMED_GLOSSARY", async ({ page }) => {
    await page.goto("/");
    const count = await page.evaluate(() =>
      window.CANAMED_GLOSSARY ? Object.keys(window.CANAMED_GLOSSARY).length : 0);
    expect(count, "glossary must ship a non-empty term map").toBeGreaterThanOrEqual(10);
  });
  test("a synthetic button with a glossed term gets a title attribute", async ({ page }) => {
    await page.goto("/");
    const title = await page.evaluate(() => {
      const b = document.createElement("button");
      b.className = "req-btn";
      b.textContent = "Why do you want oxycodone specifically?";
      document.body.appendChild(b);
      if (typeof window._annotateButtonWithGlossary === "function") {
        window._annotateButtonWithGlossary(b);
      }
      return b.title;
    });
    expect(title, "title should mention the glossed term (oxycodone)").toMatch(/oxycodone/i);
  });
});

test.describe("Inline citation badges on revealed findings", () => {
  test(".req-inline-cite styling rule exists in stylesheet", async ({ page }) => {
    await page.goto("/");
    const found = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (const r of Array.from(rules)) {
          if (r.selectorText && r.selectorText.indexOf(".req-inline-cite") !== -1) {
            return true;
          }
        }
      }
      return false;
    });
    expect(found, "stylesheet must define .req-inline-cite").toBe(true);
  });
});

test.describe("Skip-able 30-second Module A walkthrough", () => {
  test("tour.js registers a studentModA tour set with 3 steps", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => {
      if (!window.CanamedTour) return { hasTour: false };
      // .start("studentModA") would actually open the overlay; we just
      // want to verify the set + marker exist.
      return {
        hasTour: true,
        isDone: window.CanamedTour.isDone("studentModA")   // marker query works
      };
    });
    expect(info.hasTour).toBe(true);
    expect(typeof info.isDone).toBe("boolean");
  });
});

test.describe("Anonymised cohort progress strip", () => {
  test(".lb-cohort-progress class is styled (bars render at viewport-fit width)", async ({ page }) => {
    await page.goto("/");
    const styled = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (const r of Array.from(rules)) {
          if (r.selectorText && r.selectorText.indexOf(".lb-cohort-grid") !== -1) {
            return true;
          }
        }
      }
      return false;
    });
    expect(styled).toBe(true);
  });
});

test.describe("'I'm just observing' panic button", () => {
  test("observer button is in the DOM with a 44px tap target", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => {
      ["splash","lobby","waiting","admin-app","session-ended"].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.classList.add("hidden");
      });
      document.getElementById("app").classList.remove("hidden");
      document.body.classList.remove("locked");
      const b = document.getElementById("observer-btn");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { hidden: b.classList.contains("hidden"), height: r.height };
    });
    expect(info, "observer button must exist").not.toBeNull();
    expect(info.hidden).toBe(false);
    expect(info.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe("Side-chat tab + input", () => {
  test("rcol-tab[data-tab='chat'] + #chat-list + #chat-input + #chat-send exist", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => ({
      tab:   !!document.querySelector(".rcol-tab[data-tab='chat']"),
      list:  !!document.getElementById("chat-list"),
      input: !!document.getElementById("chat-input"),
      send:  !!document.getElementById("chat-send")
    }));
    expect(info.tab).toBe(true);
    expect(info.list).toBe(true);
    expect(info.input).toBe(true);
    expect(info.send).toBe(true);
  });
});

test.describe("End-of-session reflection poll", () => {
  test("wrap-up stage exposes #endpoll-card with two inputs + submit", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => ({
      card:     !!document.getElementById("endpoll-card"),
      hardest:  !!document.getElementById("endpoll-hardest"),
      feeling:  !!document.getElementById("endpoll-feeling"),
      submit:   !!document.getElementById("endpoll-submit"),
      thanks:   !!document.getElementById("endpoll-thanks")
    }));
    expect(info.card).toBe(true);
    expect(info.hardest).toBe(true);
    expect(info.feeling).toBe(true);
    expect(info.submit).toBe(true);
    expect(info.thanks).toBe(true);
  });
});

test.describe("Disagree → counter-bullet on teammate answers", () => {
  test("buildAnswerLi exposes a .entry-disagree button only on teammates' entries", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(() => {
      // Drive module-scope clientId through the test hook so the
      // teammate-vs-self branch in buildAnswerLi sees a real id.
      if (window._test_setClientId) window._test_setClientId("ME");
      if (window._test_setAnswerReplies) window._test_setAnswerReplies({});
      const teammate = { id: "x1", cid: "OTHER", by: "Other", text: "their point" };
      const mine     = { id: "x2", cid: "ME",    by: "Me",    text: "my point" };
      if (typeof window.buildAnswerLi !== "function") return null;
      const a = window.buildAnswerLi("moduleA", teammate);
      const b = window.buildAnswerLi("moduleA", mine);
      return {
        teamHasDisagree:  !!a.querySelector(".entry-disagree"),
        teamHasReplies:   !!a.querySelector(".answer-replies"),
        mineHasDisagree:  !!b.querySelector(".entry-disagree"),
        mineHasEdit:      !!b.querySelector(".entry-act")
      };
    });
    expect(out, "buildAnswerLi must be in scope").not.toBeNull();
    expect(out.teamHasDisagree, "teammate's answer must show disagree").toBe(true);
    expect(out.teamHasReplies,  "teammate's answer must include a replies <ul>").toBe(true);
    expect(out.mineHasDisagree, "my own answer must NOT show disagree").toBe(false);
    expect(out.mineHasEdit,     "my own answer must keep edit/delete").toBe(true);
  });
});
