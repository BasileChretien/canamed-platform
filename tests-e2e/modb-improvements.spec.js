/* tests-e2e/modb-improvements.spec.js
 *
 * 2026-06-26 Module B improvements:
 *   (1) "Randomly assign roles" button — distributes DISTINCT roles across the
 *       room (physician/patient/family first, observers for the rest). In
 *       LOCAL/solo mode it assigns THIS device one of the four at random.
 *   (2) Bandeau restructure — the reference toolbar gains "Your role" (first,
 *       highlighted when a role is held) + "Useful sentences" tabs. The per-role
 *       guides, the observer checklist, the private brief and the "Before you
 *       start" safety note moved into the Your-role tab; the SPIKES strip was
 *       deleted (redundant with the Recap-table tab).
 *
 * Hermetic LOCAL mode (no Firebase). Listed in the mobile testMatch in
 * playwright.config.js so it runs per-device (desktop + iPhone/iPad/Android).
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openModuleB(page) {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.classList.remove("locked");
    ["splash", "lobby", "waiting", "admin-app", "session-ended", "stage-0", "stage-1", "stage-3"]
      .forEach(id => { const n = document.getElementById(id); if (n) n.classList.add("hidden"); });
    const app = document.getElementById("app"); if (app) app.classList.remove("hidden");
    const s2 = document.getElementById("stage-2"); if (s2) s2.classList.remove("hidden");
    if (typeof window.initRolePicker === "function") window.initRolePicker();
    if (typeof window.setModBPhase === "function") window.setModBPhase(1);   // Phase 2 (play)
  });
}

const pickRole = (page, role) =>
  page.locator('#modB-role-picker .role-chip[data-role="' + role + '"]').click();

test.describe("Module B — bandeau restructure", () => {
  test("the reference toolbar leads with Your role + Useful sentences tabs", async ({ page }) => {
    await openModuleB(page);
    const ids = await page.locator("#stage-2 .reference-toolbar .reference-btn")
      .evaluateAll(els => els.map(e => e.id));
    expect(ids[0], "Your role is the first tab").toBe("refB-btn-role");
    expect(ids[1], "Useful sentences is the second tab").toBe("refB-btn-useful");
    expect(ids).toEqual(expect.arrayContaining(
      ["refB-btn-history", "refB-btn-guidelines", "refB-btn-recap"]));
  });

  test("SPIKES strip is gone; role guides + brief + safety note live in the Your-role tab", async ({ page }) => {
    await openModuleB(page);
    await expect(page.locator("#stage-2 .spikes-strip"), "SPIKES strip deleted").toHaveCount(0);
    await expect(page.locator("#stage-2 .phrases-box"), "inline phrases strip removed").toHaveCount(0);
    for (const sel of ["#modB-patient-guide", "#modB-family-guide", ".micro-framework-card",
                       "#observer-checklist", "#modB-role-objective", ".safety-note"]) {
      await expect(page.locator("#refB-panel-role " + sel), sel + " is inside the Your-role tab")
        .toHaveCount(1);
    }
    // The "Useful sentences" tab carries the phrases.
    await page.locator("#refB-btn-useful").click();
    await expect(page.locator("#refB-panel-useful"))
      .toContainText("I'm afraid I have some serious news");
  });

  test("picking a role highlights the Your-role tab; the brief is read inside it", async ({ page }) => {
    await openModuleB(page);
    const roleTab = page.locator("#refB-btn-role");
    const prompt = page.locator("#modB-role-card-prompt");
    await expect(roleTab, "no role yet → tab not highlighted").not.toHaveClass(/has-role/);
    await pickRole(page, "physician");
    await expect(roleTab, "role held → tab highlighted").toHaveClass(/has-role/);
    await expect(prompt, "prompt hidden once a role is held").toHaveClass(/hidden/);
    // The brief lives in the tab — NOT auto-opened (the sticky panel would overlay
    // the picker on a phone). Open it to read the role's brief.
    await roleTab.click();
    await expect(page.locator("#modB-role-objective")).toBeVisible();
    await expect(page.locator("#modB-role-objective")).toContainText("Deliver the news with empathy");
    // Close the tab, then deselect — the highlight clears and the prompt un-hides.
    await roleTab.click();
    await pickRole(page, "physician");
    await expect(roleTab, "deselect clears the highlight").not.toHaveClass(/has-role/);
    await expect(prompt, "prompt returns once no role is held").not.toHaveClass(/hidden/);
  });
});

test.describe("Module B — randomly assign roles", () => {
  test("the button assigns this device one role (LOCAL/solo) + highlights the tab", async ({ page }) => {
    await openModuleB(page);
    await expect(page.locator('#modB-role-picker .role-chip[aria-checked="true"]'),
      "no role checked initially").toHaveCount(0);
    await page.locator("#modB-assign-roles-btn").click();
    await expect(page.locator('#modB-role-picker .role-chip[aria-checked="true"]'),
      "exactly one role assigned").toHaveCount(1);
    await expect(page.locator("#refB-btn-role"), "Your-role tab highlighted after assign")
      .toHaveClass(/has-role/);
  });

  test("the role deck always fills physician first + keeps named roles distinct", async ({ page }) => {
    await openModuleB(page);
    const out = await page.evaluate(() => ({
      one:   window._roleDeckFor(1),
      two:   window._roleDeckFor(2),
      three: window._roleDeckFor(3),
      five:  window._roleDeckFor(5)
    }));
    expect(out.one, "1 person → physician").toEqual(["physician"]);
    expect(out.two, "2 people → physician + patient").toEqual(["physician", "patient"]);
    expect(out.three, "3 people → the three named roles").toEqual(["physician", "patient", "family"]);
    // 5 people: the four named-ish deck + 1 extra observer; the three core named
    // roles are present and distinct, extras are observers.
    expect(out.five.slice(0, 4)).toEqual(["physician", "patient", "family", "observer"]);
    expect(out.five.filter(r => r === "observer").length, "extras become observers").toBe(2);
    const named = out.five.filter(r => r !== "observer");
    expect(new Set(named).size, "named roles are distinct").toBe(named.length);
  });
});
