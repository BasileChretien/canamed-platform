/* tests-e2e/scenario-snapshot.spec.js
 *
 * Phase 1 (integrity) — a session created from an authored scenarioRef must be
 * PINNED to a snapshot of that scenario taken at creation time, so a later
 * owner edit or delete of the shared scenario can't mutate or break the
 * running session. createSession() resolves the ref via loadScenarioByRef()
 * and stores the resolved body inline as scenarioCustomJson (which
 * loadSessionScenario() prefers over the live scenarioRef). If the resolve
 * fails (offline / no body), it degrades gracefully to the legacy live ref.
 *
 * Hermetic LOCAL-mode coverage: seed the shared scenario into LocalDB, drive
 * the real create flow through the picker, then read LocalDB back and assert
 * the session captured the snapshot (or fell back to a live ref when there was
 * nothing to snapshot).
 *
 * Runs on every configured viewport (desktop + mobile-iphone/ipad/android) per
 * CLAUDE.md's per-device standing instruction — the spec basename is
 * registered in the three mobile testMatch regexes in playwright.config.js.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

const OWNER = "u_demo";
const SCID = "scn";
const REF_VALUE = `__ref:shared:${OWNER}:${SCID}`;
const SHARE_KEY = `${OWNER}_${SCID}`;

/* A minimal but valid authored scenario, with a recognisable marker in
   moduleAName so we can prove WHICH version got pinned. */
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

/* Drive the create-session flow, picking the seeded shared scenario. Returns
   the generated session code. */
async function createFromSharedScenario(page) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();

  const picker = page.locator("#splash-create-scenario");
  await expect(picker).toBeVisible();
  const refOption = picker.locator(`option[value="${REF_VALUE}"]`);
  await expect.poll(async () => await refOption.count()).toBe(1);
  await picker.selectOption(REF_VALUE);

  await page.locator("#splash-create-name").fill("Snap Fac");
  await page.locator("#splash-create-label").fill("snapshot-test");
  await page.locator("#splash-create-pass").fill("snap-pw");
  await page.locator("#splash-create-submit").click();

  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  return (await codeNode.textContent()).trim();
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

test.describe("Scenario snapshot at session creation (Phase 1 integrity)", () => {
  test("session created from an authored ref stores a pinned snapshot", async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await seedSharedScenario(page, true);
    const code = await createFromSharedScenario(page);

    // The session must carry a scenarioCustomJson SNAPSHOT of the original.
    let sess = null;
    await expect
      .poll(async () => {
        sess = await readSession(page, code);
        return sess && typeof sess.scenarioCustomJson === "string";
      }, { timeout: 10_000 })
      .toBe(true);

    const snap = JSON.parse(sess.scenarioCustomJson);
    expect(snap.moduleAName.en).toBe("SNAPSHOT-ORIGINAL");
    // Provenance is kept alongside the snapshot.
    expect(sess.scenarioRef).toMatchObject({ ownerUid: OWNER, scenarioId: SCID, source: "shared" });
    expect(sess.scenarioId).toBe(SCID);

    // Integrity: editing the source scenario afterwards must NOT change the
    // session's pinned snapshot (it is a decoupled copy, not a live read).
    await page.evaluate((shareKey) => {
      const db = JSON.parse(localStorage.getItem("canamed_localdb_v1"));
      const body = JSON.parse(db.sharedScenarios[shareKey].bodyJson);
      body.moduleAName.en = "EDITED-AFTER-CREATE";
      db.sharedScenarios[shareKey].bodyJson = JSON.stringify(body);
      localStorage.setItem("canamed_localdb_v1", JSON.stringify(db));
    }, SHARE_KEY);

    const after = await readSession(page, code);
    expect(JSON.parse(after.scenarioCustomJson).moduleAName.en).toBe("SNAPSHOT-ORIGINAL");
  });

  test("falls back to a live ref when the scenario has no resolvable body", async ({ page }) => {
    page.on("dialog", (d) => { try { d.accept(); } catch (_) {} });
    await seedSharedScenario(page, false); // no bodyJson → nothing to snapshot
    const code = await createFromSharedScenario(page);

    let sess = null;
    await expect
      .poll(async () => {
        sess = await readSession(page, code);
        return sess && sess.scenarioRef != null;
      }, { timeout: 10_000 })
      .toBe(true);

    // Graceful degradation: live ref stored, no snapshot written.
    expect(sess.scenarioRef).toMatchObject({ ownerUid: OWNER, scenarioId: SCID, source: "shared" });
    expect(sess.scenarioCustomJson == null).toBe(true);
  });
});
