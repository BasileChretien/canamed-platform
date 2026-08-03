/* tests-e2e/author-format-split.spec.js
 *
 * The authoring tool's "Scenario format" offers PBL workup / Roleplay /
 * Branched as three distinct formats.
 *
 * It used to offer one combined "Standard — PBL workup + roleplay", which
 * contradicted the section model: a session is composed by PICKING sections, so
 * a scenario authors ONE. Which module a standard scenario ran was decided by a
 * separate tick-row, and nothing was hidden either way — so every author, PBL or
 * roleplay, scrolled past the other's fields.
 *
 * Registered in the three mobile testMatch allowlists per the standing
 * per-device rule.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

async function openAuthor(page) {
  await page.goto("/scenario-author.html");
  await page.waitForFunction(() => !!window.__scenarioAuthor, { timeout: 20_000 });
}
const shown = (page) => page.evaluate(() => {
  const q = (s) => { const n = document.querySelector(s); return n ? getComputedStyle(n).display !== "none" : false; };
  return { pbl: q(".pbl-only"), roleplay: q(".roleplay-only"), branched: q(".branched-only") };
});

test.describe("Author — PBL / Roleplay / Branched are separate formats", () => {
  test("three formats are offered, and the combined one is not authorable", async ({ page }) => {
    await openAuthor(page);
    const values = await page.locator("#meta-format option").evaluateAll(o => o.map(x => x.value));
    expect(values).toEqual(["pbl", "roleplay", "branched"]);
    expect(await page.locator("#meta-format").inputValue()).toBe("pbl");
  });

  test("each format shows only its own sections", async ({ page }) => {
    await openAuthor(page);
    expect(await shown(page)).toEqual({ pbl: true, roleplay: false, branched: false });
    await page.selectOption("#meta-format", "roleplay");
    expect(await shown(page)).toEqual({ pbl: false, roleplay: true, branched: false });
    await page.selectOption("#meta-format", "branched");
    expect(await shown(page)).toEqual({ pbl: false, roleplay: false, branched: true });
  });

  test("the format DRIVES the module set — the two controls cannot disagree", async ({ page }) => {
    await openAuthor(page);
    await page.selectOption("#meta-format", "roleplay");
    expect(await page.evaluate(() => document.getElementById("mod-B").checked)).toBe(true);
    expect(await page.evaluate(() => document.getElementById("mod-A").checked)).toBe(false);
    await page.selectOption("#meta-format", "pbl");
    expect(await page.evaluate(() => document.getElementById("mod-A").checked)).toBe(true);
    expect(await page.evaluate(() => document.getElementById("mod-B").checked)).toBe(false);
  });

  test("a LEGACY two-module scenario still loads and round-trips both halves", async ({ page }) => {
    /* The one that would be data loss. An existing scenario with both modules
       must not open as PBL and quietly drop its roleplay on the next save. */
    await openAuthor(page);
    const r = await page.evaluate(() => {
      const A = window.__scenarioAuthor;
      const trio = (en) => ({ en, fr: "", ja: "" });
      A.setState(A.fromJson({
        id: "legacy-both", name: trio("Legacy both"), summary: trio("s"),
        moduleAName: trio("Workup"), moduleBName: trio("Conversation"),
        case: { history: [{ q: trio("q"), a: trio("a") }], exam: [], labs: [], prompts: [] },
        scoring: { moduleA: [{ id: "fa", points: 1, label: trio("x") }],
                   moduleB: [{ id: "fb", points: 1, label: trio("y") }] },
        penalties: [], decisions: []
      }));
      const back = A.toJson();
      return {
        format: A.getState().format,
        selValue: document.getElementById("meta-format").value,
        keptA: !!(back.moduleAName && back.moduleAName.en),
        keptB: !!(back.moduleBName && back.moduleBName.en),
        keptScoringA: (back.scoring.moduleA || []).length,
        keptScoringB: (back.scoring.moduleB || []).length
      };
    });
    expect(r.format).toBe("combined");
    expect(r.selValue, "the legacy option is added so the select can show it").toBe("combined");
    expect(r.keptA && r.keptB, "both module names survive").toBe(true);
    expect(r.keptScoringA, "moduleA scoring survives").toBeGreaterThan(0);
    expect(r.keptScoringB, "moduleB scoring survives").toBeGreaterThan(0);
    // …and a combined scenario shows BOTH halves, or it could not be edited.
    expect(await shown(page)).toEqual({ pbl: true, roleplay: true, branched: false });
  });

  test("each skeleton opens in its own format", async ({ page }) => {
    await openAuthor(page);
    for (const [fn, want] of [["roleplaySkeleton", "roleplay"], ["pblSkeleton", "pbl"],
                              ["branchedSkeleton", "branched"]]) {
      const got = await page.evaluate((f) => {
        const A = window.__scenarioAuthor;
        A.setState(A.fromJson(A[f]()));
        return A.getState().format;
      }, fn);
      expect(got, `${fn} must open as ${want}`).toBe(want);
    }
  });

  test("the author page loads without script errors", async ({ page }) => {
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await openAuthor(page);
    await page.selectOption("#meta-format", "roleplay");
    await page.selectOption("#meta-format", "branched");
    expect(errs).toEqual([]);
  });
});

/* ── English-only authoring ─────────────────────────────────────────────────
 * The form asked for every learner-facing string in EN / FR / JA, and the help
 * text promised "partial translations are safe". Both were false from
 * 2026-06-25, when the platform went English-canonical: script.js `_curLang()`
 * is pinned to "en" and ALL case content renders through `tc(value,
 * _curLang())`, so a facilitator who translated a scenario into French
 * produced text no learner could ever be shown. The FR/JA that remains is the
 * hover reading aid, which glosses the ENGLISH words from a shipped dictionary
 * — it never reads these fields.
 */
test.describe("Author — content is authored in English only", () => {
  test("no trio field asks for a French or Japanese value", async ({ page }) => {
    await openAuthor(page);
    /* Every localisable field renders through buildTrio(), so counting inputs
       per block catches the whole form rather than a sampled few. */
    const perBlock = await page.locator(".trio-block .trio-grid").evaluateAll(
      g => g.map(x => x.querySelectorAll("input, textarea").length));
    expect(perBlock.length).toBeGreaterThan(3);
    expect(perBlock.every(n => n === 1)).toBe(true);

    /* The "EN" tag over each cell only ever disambiguated one language from
       another — with one column it is noise on every field. */
    expect(await page.locator(".trio-grid label").count()).toBe(0);
  });

  test("the help text does not promise translation", async ({ page }) => {
    await openAuthor(page);
    /* textContent, not innerText: .author-help is a collapsed <details>, so
       innerText yields the <summary> alone and every assertion below would
       pass vacuously. */
    const help = (await page.locator(".author-help").textContent() || "").toLowerCase();
    expect(help).toContain("in english");
    expect(help).not.toContain("partial translations");
    /* It may still MENTION French/Japanese — to explain the hover dictionary —
       but never as something the author is asked to supply. */
    expect(help).not.toMatch(/split into/);
  });

  test("an imported scenario KEEPS its fr/ja rather than losing them on export", async ({ page }) => {
    await openAuthor(page);
    /* The round-trip is the risk in removing the inputs: values with no field
       are easy to drop silently. buildTrio only mutates on input, so with no
       fr/ja input rendered they must pass through untouched. */
    const out = await page.evaluate(() => {
      const A = window.__scenarioAuthor;
      const s = A.getState();
      s.meta.name = { en: "Imported", fr: "Importé", ja: "輸入" };
      A.setState(s);                      // re-renders the whole form
      const name = (A.toJson() || {}).name || {};
      return { en: name.en, fr: name.fr, ja: name.ja };
    });
    expect(out).toEqual({ en: "Imported", fr: "Importé", ja: "輸入" });
  });
});
