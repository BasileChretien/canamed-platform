/* tests-e2e/i18n-placeholder-substitution.spec.js
 *
 * No i18n placeholder may reach the screen unsubstituted.
 *
 * i18n.js applies translations the moment it EXECUTES — its init() only defers
 * to DOMContentLoaded when readyState is "loading", which is already false for
 * a deferred script. t() resolves {cohortPair} through window.buildCohortPair +
 * window.applyTemplate, defined by lib.js. index.html loaded lib.js AFTER
 * i18n.js, so the substitution silently no-opped (t() returns the raw template
 * rather than throwing) and the literal "{cohortPair}" was baked into the
 * waiting-room paragraph shown to EVERY student:
 *
 *   "A facilitator will place you in a mixed {cohortPair} room…"
 *
 * The unit suite missed it because it calls t() directly, where lib.js is
 * already required — the bug lived in the SCRIPT ORDER, so only a real page
 * load can see it. Found live 2026-08-12. tests/i18n-load-order.test.js pins
 * the order statically; this is the browser-side proof.
 *
 * Registered into the mobile projects too, per the standing per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

/* The placeholders t() resolves via lib.js. A raw one on screen is always a
   bug — these are template slots, never literal copy. */
const PLACEHOLDERS = ["{cohortPair}", "{patientName}"];

test.describe("i18n placeholders are substituted before paint", () => {
  test("the splash/lobby/waiting shell renders no raw placeholder", async ({ page }) => {
    await page.goto("/");
    /* TEXT NODES only — not innerHTML. The whole shell is in the DOM from the
       first paint (views are toggled, not injected), so one walk covers splash,
       lobby, waiting and wrap-up including the hidden ones, which innerText
       would skip. innerHTML is wrong here for the opposite reason: it includes
       COMMENT nodes, and the source comments that DOCUMENT this very bug
       mention the placeholders — that false positive is how this test first
       "failed". */
    const hits = await page.evaluate((placeholders) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const found = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue || "";
        for (const p of placeholders) {
          if (text.includes(p)) {
            found.push({
              placeholder: p,
              where: (n.parentElement && (n.parentElement.id ||
                     n.parentElement.getAttribute("data-i18n-html") ||
                     n.parentElement.getAttribute("data-i18n"))) || "?",
              sample: text.trim().slice(0, 80)
            });
          }
        }
      }
      return found;
    }, PLACEHOLDERS);
    expect(hits, "raw i18n placeholders reached the rendered DOM").toEqual([]);
  });

  test("the waiting-room body names a real cohort pair", async ({ page }) => {
    await page.goto("/");
    const body = await page.evaluate(() => {
      const el = document.querySelector('[data-i18n-html="waiting.body"]');
      return el ? el.innerHTML : null;
    });
    expect(body, "the waiting.body node must exist").not.toBeNull();
    expect(body).not.toContain("{cohortPair}");
    // Substituted, not merely stripped: the sentence still says which pair.
    expect(body).toMatch(/mixed\s+\S+\s+room/);
  });

  test("lib.js has published its globals by the time i18n applies", async ({ page }) => {
    await page.goto("/");
    const state = await page.evaluate(() => ({
      buildCohortPair: typeof window.buildCohortPair,
      applyTemplate: typeof window.applyTemplate,
      // t() must resolve the placeholder, not echo the template back.
      rendered: typeof window.t === "function" ? window.t("waiting.body") : null
    }));
    expect(state.buildCohortPair).toBe("function");
    expect(state.applyTemplate).toBe("function");
    expect(state.rendered).not.toContain("{cohortPair}");
  });

  /* Re-running applyI18n() is NOT an acceptable fix: it rewrites innerHTML and
     wipes the participant's name that script.js injected into #waiting-name.
     Pinned so nobody "fixes" a future placeholder that way. */
  test("re-applying i18n over the waiting room would destroy the student's name", async ({ page }) => {
    await page.goto("/");
    const wiped = await page.evaluate(() => {
      const slot = document.getElementById("waiting-name");
      if (!slot) return null;
      slot.textContent = "TestStudent";
      window.applyI18n(document.getElementById("waiting"));
      const after = document.getElementById("waiting-name");
      return after ? after.textContent : "";
    });
    // Documents WHY the fix is load order. If this ever stops being true the
    // note in index.html / i18n-load-order.test.js should be revisited.
    expect(wiped, "expected the re-apply to clear the injected name").toBe("");
  });
});
