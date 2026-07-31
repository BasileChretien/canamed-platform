/* tests-e2e/create-form-authoring.spec.js
 *
 * S7 CUTOVER, part 1 — the create form has NO raw-JSON surface, and the
 * fill-in authoring board is reachable from where a facilitator actually works.
 *
 * WHY THIS EXISTS. A facilitator reported the platform as "JSON-only" for
 * authoring. It never was: scenario-author.html has been a 15-section fill-in
 * board with a PBL / Roleplay / Branched skeleton picker all along. Two
 * decisions had combined to hide it:
 *
 *   1. its only link (#splash-author-row) was `hidden` until a non-anonymous
 *      sign-in, "to keep the participant landing page uncluttered"; and
 *   2. the create form offered a raw-JSON textarea (#splash-create-custom)
 *      behind an "advanced" toggle, in plain sight.
 *
 * So the good path was invisible and the bad one wasn't. Worse, #splash-author-row
 * lives in the ENTER view — so even once unhidden it is never passed by someone
 * who clicks straight through to "Create a session". Hence the create-form link
 * asserted below: unhiding the footer link alone does NOT fix discoverability,
 * and a test that only checked the footer would have called this done.
 *
 * Per-device because the create form is the facilitator's phone-and-laptop
 * surface (CLAUDE.md standing instruction).
 */

/* MUST import from ./fixtures.js, not @playwright/test: the custom `page`
   fixture calls forceLocalMode() before use(page), which pins
   CANAMED_FIREBASE = null (via a defineProperty setter that swallows
   firebase-config.js's own assignment) so the suite is hermetic.
   This is not cosmetic here — the sign-in test below argues "LOCAL mode never
   produces a non-anonymous user, so a still-gated link would fail". That
   reasoning is only TRUE when LOCAL mode is pinned. Imported bare, the spec
   passed for the wrong reason: it only inspects DOM presence, which happens
   not to depend on the backend, so the false premise never surfaced. */
const { test, expect } = require("./fixtures.js");

async function openCreateForm(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const b = document.getElementById("splash-go-create");
    if (b) b.click();
  });
  await expect(page.locator("#splash-view-create")).toBeVisible();
}

test.describe("Create form — authoring entry point, no JSON", () => {
  test("no raw-JSON surface survives anywhere on the create form", async ({ page }) => {
    await openCreateForm(page);
    /* toHaveCount(0), NOT toBeHidden(): toBeHidden() also passes for an element
       that does not exist, so it cannot tell "removed" from "still shipping but
       display:none" — and the whole point here is that the markup is gone. */
    for (const id of ["splash-create-custom", "splash-custom-wrap",
                      "splash-create-advanced-toggle", "splash-load-template"]) {
      await expect(page.locator("#" + id), id + " must be deleted, not hidden")
        .toHaveCount(0);
    }
    // No textarea at all on the create form — the strongest form of the claim.
    await expect(page.locator("#splash-view-create textarea")).toHaveCount(0);
  });

  test("the authoring board is linked from beside the section picker", async ({ page }) => {
    await openCreateForm(page);
    const link = page.locator("#splash-create-author-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "scenario-author.html");
    // Opening in a new tab must not hand the board window.opener access.
    await expect(link).toHaveAttribute("rel", /noopener/);

    /* It must sit with the SECTION picker, not orphaned at the bottom of the
       form: the question it answers ("the section I want isn't listed") arises
       exactly there. */
    const sameField = await page.evaluate(() => {
      const a = document.getElementById("splash-create-author-link");
      const list = document.getElementById("splash-section-list");
      if (!a || !list) return false;
      const field = a.closest(".splash-field");
      return !!field && field.contains(list);
    });
    expect(sameField, "the link belongs in the sections field").toBe(true);
  });

  test("the board link is reachable without signing in", async ({ page }) => {
    /* LOCAL mode never produces a non-anonymous user, so if the link were still
       gated on sign-in this would fail — which is the regression to catch. */
    await openCreateForm(page);
    await expect(page.locator("#splash-create-author-link")).toBeVisible();
    await page.evaluate(() => {
      const b = document.getElementById("splash-create-back")
             || document.querySelector('[data-splash-back]');
      if (b) b.click();
    });
    // The enter-view footer link is unhidden too (belt and braces).
    const row = page.locator("#splash-author-row");
    await expect(row).toBeAttached();
    expect(await row.evaluate(e => e.hasAttribute("hidden"))).toBe(false);
  });

  test("the section picker is the primary content control", async ({ page }) => {
    await openCreateForm(page);
    // The picker's own controls are present and usable.
    await expect(page.locator("#splash-section-add")).toBeVisible();
    await expect(page.locator("#splash-section-add-btn")).toBeVisible();
    // And the empty-state tells the facilitator what to do.
    await expect(page.locator("#splash-section-empty")).toBeVisible();
  });
});
