/* tests-e2e/scenario-snapshot.spec.js
 *
 * INTEGRITY — a session created from AUTHORED content must be PINNED to a
 * snapshot of that content taken at creation time, so a later owner edit or
 * delete of the shared scenario cannot mutate or break a running session.
 *
 * S7 CUTOVER — the mechanism changed, the property did not. This spec used to
 * drive the Scenario select (#splash-create-scenario), pick a
 * `__ref:shared:<uid>:<id>` option, and assert createSession() resolved it into
 * an inline `scenarioCustomJson`. That select is gone and the create form now
 * passes null for scenarioId / customJson / scenarioRef, so the old path no
 * longer runs from the form at all — re-pointing the selectors would have
 * tested nothing. The authored content a facilitator picks is now a SECTION,
 * and its snapshot lands per slot at sessions/<code>/sectionBodies/<slot>,
 * claimed by a `custom-<slot>` token in the `sections` CSV.
 *
 * (createSession() still ACCEPTS the legacy parameters — they carry
 * pre-cutover sessions through revisit/exports — so this is a change of what
 * the create form does, not a deletion of the snapshot idea.)
 *
 * Hermetic LOCAL-mode coverage: seed the shared scenario into LocalDB, drive
 * the real create flow through the section picker, then read LocalDB back.
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const OWNER = "u_demo";
const SCID = "scn";
const SHARE_KEY = `${OWNER}_${SCID}`;
/* The synthetic key the picker gives an authored section — "authored:<uid>:<scenarioId>:<type>".
   It never reaches the database: at create it becomes the `custom-<slot>` token. */
const SECTION_VALUE = `authored:${OWNER}:${SCID}:pbl`;

/* A minimal but valid authored scenario, with a recognisable marker in
   moduleAName so we can prove WHICH version got pinned. moduleAName is also
   what makes this scenario yield a PBL section at all (name-first derivation). */
function originalScenario() {
  const trio = (en) => ({ en, fr: "", ja: "" });
  return {
    id: SCID,
    name: trio("Snapshot Original"),
    summary: trio("summary"),
    moduleAName: trio("SNAPSHOT-ORIGINAL"),
    moduleBName: trio("Module B"),
    synthId: "labs:0",
    synthPrereqs: [],
    case: {
      history: [{ q: trio("hx?"), a: trio("hx.") }],
      exam: [{ q: trio("ex?"), a: trio("ex.") }],
      labs: [{ key: true, q: trio("lab?"), a: trio("lab.") }],
      prompts: [trio("discuss")]
    },
    scoring: { moduleA: [], moduleB: [] },
    penalties: [],
    decisions: []
  };
}

/* Seed LocalDB (localStorage) with one shared scenario BEFORE any page script
   runs. `withBody` controls whether it carries a resolvable bodyJson. */
async function seedSharedScenario(page, withBody) {
  const shared = {
    ownerUid: OWNER,
    scenarioId: SCID,
    ownerName: "Dr. Local",
    meta: { name: { en: "Snapshot Original" } }
  };
  if (withBody) shared.bodyJson = JSON.stringify(originalScenario());
  await page.addInitScript(
    ([key, shareKey, shared]) => {
      localStorage.setItem(key, JSON.stringify({ sharedScenarios: { [shareKey]: shared } }));
    },
    ["canamed_localdb_v1", SHARE_KEY, shared]
  );
}

/* Open the create form with the section library AND the authored sections
   loaded, starting from an empty pick (the picker seeds a default). */
async function openCreate(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.evaluate(() => window.CanamedLoader.ensureCaseContent());
  await page.waitForFunction(() => {
    const s = document.getElementById("splash-section-add");
    return !!(s && s.options.length > 0);
  });
  await page.evaluate(() => { splashSectionPick.length = 0; renderSectionPick(); });
}

async function submitCreate(page) {
  await page.locator("#splash-create-name").fill("Snap Fac");
  await page.locator("#splash-create-label").fill("snapshot-test");
  await page.locator("#splash-create-pass").fill("snap-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
}

/* Drive the create flow picking the seeded shared scenario's SECTION. */
async function createFromSharedSection(page) {
  await openCreate(page);
  const picker = page.locator("#splash-section-add");
  const opt = picker.locator(`option[value="${SECTION_VALUE}"]`);
  await expect
    .poll(async () => await opt.count(), { timeout: 10_000 })
    .toBe(1);
  await picker.selectOption(SECTION_VALUE);
  await page.locator("#splash-section-add-btn").click();
  return submitCreate(page);
}

/* Read the persisted session record out of LocalDB. */
async function readSession(page, code) {
  return await page.evaluate((c) => {
    const raw = localStorage.getItem("canamed_localdb_v1");
    if (!raw) return null;
    const db = JSON.parse(raw);
    // The displayed code is upper-cased for readability; LocalDB stores the
    // session under the canonical lower-case key.
    const key = c.toLowerCase();
    return (db.sessions && db.sessions[key]) || null;
  }, code);
}

test.describe("Authored-section snapshot at session creation (integrity)", () => {
  test("a session created from an authored SECTION pins that section's body", async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await seedSharedScenario(page, true);
    const code = await createFromSharedSection(page);

    let sess = null;
    await expect
      .poll(async () => {
        sess = await readSession(page, code);
        return !!(sess && sess.sectionBodies && sess.sectionBodies["1"]);
      }, { timeout: 10_000 })
      .toBe(true);

    /* The CSV must CLAIM the slot the body was written for — the database rule
       rejects a body whose slot the CSV does not name, so a session that stored
       one without the other could never have been created against real rules. */
    expect(sess.sections).toBe("custom-1");

    const snap = JSON.parse(sess.sectionBodies["1"]);
    expect(snap.name.en).toBe("SNAPSHOT-ORIGINAL");
    expect(snap.type).toBe("pbl");
    /* The stored body is re-id'd to the slot token, so the runtime can register
       it as a library entry verbatim with no re-derivation. */
    expect(snap.id).toBe("custom-1");

    // Integrity: editing the source scenario afterwards must NOT change the
    // session's pinned body (it is a decoupled copy, not a live read).
    await page.evaluate((shareKey) => {
      const db = JSON.parse(localStorage.getItem("canamed_localdb_v1"));
      const body = JSON.parse(db.sharedScenarios[shareKey].bodyJson);
      body.moduleAName.en = "EDITED-AFTER-CREATE";
      db.sharedScenarios[shareKey].bodyJson = JSON.stringify(body);
      localStorage.setItem("canamed_localdb_v1", JSON.stringify(db));
    }, SHARE_KEY);

    const after = await readSession(page, code);
    expect(JSON.parse(after.sectionBodies["1"]).name.en).toBe("SNAPSHOT-ORIGINAL");
  });

  test("a shared scenario with no resolvable body yields no section to pick", async ({ page }) => {
    /* The graceful-degradation case. It used to be "fall back to a live ref";
       there is no ref to fall back to now, and the honest replacement is that
       an unresolvable shared scenario simply never becomes a pickable section —
       so a facilitator can never create a session pointing at content that
       cannot be resolved. */
    await seedSharedScenario(page, false); // no bodyJson → nothing to derive
    await openCreate(page);
    const picker = page.locator("#splash-section-add");
    // Give the authored load time to complete before asserting an ABSENCE.
    await page.evaluate(() => loadAuthoredSectionsIntoPicker());
    await expect
      .poll(async () => await picker.locator("option").count())
      .toBeGreaterThan(0);
    expect(await picker.locator(`option[value^="authored:"]`).count()).toBe(0);
  });

  test("an all-BUILT-IN pick writes no sectionBodies at all", async ({ page }) => {
    /* Bodies are written only for authored picks — the common case must stay
       byte-identical to a session created before sectionBodies existed. */
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await seedSharedScenario(page, true);
    await openCreate(page);
    await page.selectOption("#splash-section-add", "chronic-pain-pbl");
    await page.locator("#splash-section-add-btn").click();
    const code = await submitCreate(page);

    let sess = null;
    await expect
      .poll(async () => {
        sess = await readSession(page, code);
        return !!(sess && sess.sections);
      }, { timeout: 10_000 })
      .toBe(true);
    expect(sess.sections).toBe("chronic-pain-pbl");
    expect(sess.sectionBodies == null).toBe(true);
  });
});
