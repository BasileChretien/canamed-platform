/* tests-e2e/facilitator-profile.spec.js
 *
 * The profile-setup form serves both students and facilitators. A role
 * toggle hides the student-only fields (year of study, English level) for
 * facilitators, who only provide name + institution.
 *
 * The profile-setup view is normally reached via Google sign-in (there is no
 * auth in local test mode), so the view is revealed directly to exercise the
 * toggle's show/hide behaviour. Registered against the mobile-iphone /
 * mobile-ipad / mobile-android projects (and run by the desktop projects by
 * default) per the per-device standing instruction.
 */

// @ts-check
const { test, expect } = require("./fixtures");

test.describe("Profile-setup role toggle (student / facilitator)", () => {
  test("facilitator role hides the student-only fields", async ({ page }) => {
    await page.goto("/");

    // Reveal the profile-setup view (auth-gated in production).
    await page.evaluate(() => {
      const v = document.getElementById("splash-view-profile-setup");
      if (v) v.hidden = false;
    });

    const roleGroup = page.locator("#splash-prof-role");
    const student = roleGroup.getByRole("radio", { name: /student/i });
    const facilitator = roleGroup.getByRole("radio", { name: /facilitator/i });
    const studentFields = page.locator("#splash-prof-student-fields");

    // Default = student → year + English level visible.
    await expect(student).toBeChecked();
    await expect(studentFields).toBeVisible();
    await expect(page.locator("#splash-prof-year")).toBeVisible();
    await expect(page.locator("#splash-prof-english")).toBeVisible();

    // Switch to facilitator → student-only fields hidden.
    await facilitator.check();
    await expect(studentFields).toBeHidden();

    // Switch back to student → visible again.
    await student.check();
    await expect(studentFields).toBeVisible();
  });
});
