/* tests-e2e/moderation-ui.spec.js
 *
 * Phase 4d (moderation) — the client wiring for the rules shipped in #227:
 *
 *   1. The SECTION picker must HIDE a shared scenario a moderator has
 *      tombstoned (moderation/removed/<shareId> === true). The tombstone lives
 *      OUTSIDE sharedScenarios precisely so a scenario owner re-publishing
 *      cannot clear it — which makes the client filter the thing that actually
 *      takes a reported scenario out of circulation.
 *   2. A "Report" affordance appears only on a picked section that came from
 *      SOMEONE ELSE's shared scenario.
 *
 * S7 CUTOVER — both used to be driven through the Scenario select
 * (#splash-create-scenario) and its single #splash-report-scenario button. The
 * select is gone; a shared scenario now reaches the facilitator as a SECTION in
 * #splash-section-add, and Report lives on the picked row. The capability moved
 * with the content — it did not go away, which is the point of test 3.
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
/* S7 — a shared scenario reaches the facilitator as a SECTION now, keyed by the
   synthetic authored key, not as a `__ref:shared:…` option on the deleted
   Scenario select. */
const OK_VALUE = `authored:${OWNER}:${OK_ID}:pbl`;
const GONE_VALUE = `authored:${OWNER}:${GONE_ID}:pbl`;

function sharedRow(scenarioId, name) {
  return {
    ownerUid: OWNER,
    scenarioId,
    ownerName: "Dr. Other",
    meta: { name: { en: name } },
    /* The body must actually YIELD a section — the picker derives sections from
       it via sectionsForScenario(), so a body carrying only id+name produces
       nothing and every assertion below would pass vacuously. `moduleAName` is
       the name-first declaration that makes it a PBL section. */
    bodyJson: JSON.stringify({
      id: scenarioId,
      name: { en: name, fr: "", ja: "" },
      moduleAName: { en: `${name} workup`, fr: "", ja: "" }
    })
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

/* Open the create form and wait for the SECTION add-list to be fully populated:
   the built-ins arrive with the lazy section library, and the authored/shared
   ones after their own DB read. Waiting only for "some options" would race the
   second half, which is precisely the half these tests are about. */
async function openCreate(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  const picker = page.locator("#splash-section-add");
  await expect(picker).toBeVisible();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  /* …and then the AUTHORED half explicitly. `options.length > 0` is satisfied by
     the built-ins alone, so it does NOT prove the shared sections have been
     looked for — which is the half every test here is about. Awaiting the load
     makes the comment above true instead of aspirational, and it is what lets
     the tombstone test assert an ABSENCE without it passing vacuously. */
  await page.evaluate(() => loadAuthoredSectionsIntoPicker());
  /* The picker SEEDS a default section once the library lands, and duplicate
     picks are legal — so adding that same section below would yield two rows
     and a strict-mode violation. These tests are about WHICH rows are
     reportable, so start from a known-empty pick. */
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
  return picker;
}

/* Add a section to the pick by its add-list value, and return its row. */
async function addSection(page, value) {
  await page.selectOption("#splash-section-add", value);
  await page.locator("#splash-section-add-btn").click();
  return page.locator(`.splash-section-row[data-section-id="${value}"]`);
}

test("a moderator-tombstoned shared scenario is hidden from the picker", async ({ page }) => {
  await seed(page, true);
  const picker = await openCreate(page);
  // The un-removed scenario still lists (proves the shared sections rendered at
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

test("Report appears only for someone else's shared section, and requires an account", async ({ page }) => {
  /* S7 — the Report button moved WITH the content: it used to hang off the
     Scenario select as the single #splash-report-scenario, and now lives on the
     picked row (.splash-section-report) of a section that came from someone
     else's SHARED scenario. Deleting the select must not have deleted the
     safety feature (PRs #227/#228), which is what this pins. */
  await seed(page, false);
  const picker = await openCreate(page);

  // A built-in section is not reportable.
  const builtIn = await addSection(page, "chronic-pain-pbl");
  await expect(builtIn).toBeVisible();
  await expect(builtIn.locator(".splash-section-report")).toHaveCount(0);

  // Someone else's shared section is.
  await expect
    .poll(async () => await picker.locator(`option[value="${OK_VALUE}"]`).count())
    .toBe(1);
  const sharedRowEl = await addSection(page, OK_VALUE);
  const report = sharedRowEl.locator(".splash-section-report");
  await expect(report).toBeVisible();

  // LOCAL mode has no auth, so the click must say "sign in" rather than
  // settling into a "Reported" state that wrote nothing.
  await report.click();
  await expect(page.locator("#toast")).toContainText(/sign in/i);
});
