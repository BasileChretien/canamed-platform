/* tests-e2e/moderation-ui.spec.js
 *
 * Phase 4d (moderation) — the client wiring for the rules shipped in #227:
 *
 *   1. The scenario picker must HIDE a shared scenario a moderator has
 *      tombstoned (moderation/removed/<shareId> === true). The tombstone lives
 *      OUTSIDE sharedScenarios precisely so a scenario owner re-publishing
 *      cannot clear it — which makes the client filter the thing that actually
 *      takes a reported scenario out of circulation.
 *   2. A "Report this scenario" affordance appears only when the current
 *      selection is a scenario shared by SOMEONE ELSE.
 *
 * Hermetic LOCAL mode: LocalDB is seeded through localStorage before any page
 * script runs. NOTE that LOCAL mode has no auth at all (script.js only assigns
 * `auth` in the Firebase branch), so the report WRITE itself cannot be
 * exercised here — that path is covered against the real rules engine by the
 * "Phase 4d moderation" test in tests-e2e/emulator/rules-smoke.spec.js. What
 * this spec pins is the UI contract plus the signed-out guard.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const OWNER = "u_mod";
const OK_ID = "kept";
const GONE_ID = "tombstoned";
const OK_KEY = `${OWNER}_${OK_ID}`;
const GONE_KEY = `${OWNER}_${GONE_ID}`;
const OK_VALUE = `__ref:shared:${OWNER}:${OK_ID}`;
const GONE_VALUE = `__ref:shared:${OWNER}:${GONE_ID}`;

function sharedRow(scenarioId, name) {
  return {
    ownerUid: OWNER,
    scenarioId,
    ownerName: "Dr. Other",
    meta: { name: { en: name } },
    bodyJson: JSON.stringify({ id: scenarioId, name: { en: name, fr: "", ja: "" } })
  };
}

/* Seed two shared scenarios owned by someone else. `tombstone` controls
   whether the second one carries a moderator takedown. */
async function seed(page, tombstone) {
  await page.addInitScript(
    (args) => {
      const db = { sharedScenarios: {} };
      db.sharedScenarios[args.okKey] = args.ok;
      db.sharedScenarios[args.goneKey] = args.gone;
      if (args.tombstone) {
        db.moderation = { removed: {} };
        db.moderation.removed[args.goneKey] = true;
      }
      localStorage.setItem("canamed_localdb_v1", JSON.stringify(db));
    },
    {
      okKey: OK_KEY,
      goneKey: GONE_KEY,
      ok: sharedRow(OK_ID, "Kept scenario"),
      gone: sharedRow(GONE_ID, "Tombstoned scenario"),
      tombstone
    }
  );
}

async function openCreate(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  const picker = page.locator("#splash-create-scenario");
  await expect(picker).toBeVisible();
  return picker;
}

test("a moderator-tombstoned shared scenario is hidden from the picker", async ({ page }) => {
  await seed(page, true);
  const picker = await openCreate(page);
  // The un-removed scenario still lists (proves the shared group rendered at
  // all, so the assertion below is about the tombstone and not a load race).
  await expect
    .poll(async () => await picker.locator(`option[value="${OK_VALUE}"]`).count())
    .toBe(1);
  // …and the tombstoned one never appears.
  expect(await picker.locator(`option[value="${GONE_VALUE}"]`).count()).toBe(0);
});

test("with no tombstone both shared scenarios list (guards against over-filtering)", async ({ page }) => {
  await seed(page, false);
  const picker = await openCreate(page);
  await expect
    .poll(async () => await picker.locator(`option[value="${GONE_VALUE}"]`).count())
    .toBe(1);
  expect(await picker.locator(`option[value="${OK_VALUE}"]`).count()).toBe(1);
});

test("Report appears only for someone else's shared scenario, and requires an account", async ({ page }) => {
  await seed(page, false);
  const picker = await openCreate(page);
  const report = page.locator("#splash-report-scenario");

  // A built-in scenario is not reportable.
  await picker.selectOption({ index: 0 });
  await expect(report).toBeHidden();

  // Someone else's shared scenario is.
  await expect
    .poll(async () => await picker.locator(`option[value="${OK_VALUE}"]`).count())
    .toBe(1);
  await picker.selectOption(OK_VALUE);
  await expect(report).toBeVisible();

  // LOCAL mode has no auth, so the click must say "sign in" rather than
  // settling into a "Reported" state that wrote nothing.
  await report.click();
  await expect(page.locator("#toast")).toContainText(/sign in/i);
  await expect(report).toHaveText(/report this scenario/i);
});
