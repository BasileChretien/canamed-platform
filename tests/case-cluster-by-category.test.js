/* tests/case-cluster-by-category.test.js
 *
 * Dry-run feedback (2026-05-26): group the Module A History + Examination
 * reveal buttons by clinical category, so the ~13-button History wall reads as
 * a few labelled clinical clusters instead of a flat list. This is a
 * DISPLAY-ONLY grouping: a `group` field ({en,fr,ja}) is added to each
 * history/exam item, but the arrays are NOT reordered — so item indices,
 * SYNTH_PREREQS (history:1 / history:2 / exam:3) and every PENALTIES `item`
 * reference stay valid. buildButtons() clusters by category at render time;
 * the dense-History HISTORY_VISIBLE_COUNT overflow split is kept as the
 * fallback for category-less (custom-JSON) scenarios. Static source + content
 * checks (a window-shim eval for the case data).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function loadCases() {
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.__CASE = CASE; this.__CASE_B = CASE_B; this.__CASE_C = CASE_C;";
  const ctx = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, {}, {});
  return { CASE: ctx.__CASE, CASE_B: ctx.__CASE_B, CASE_C: ctx.__CASE_C };
}

const tri = o => !!(o && typeof o.en === "string" && o.en &&
                    typeof o.fr === "string" && o.fr &&
                    typeof o.ja === "string" && o.ja);

// Slice a whole function body (header → next top-level `function `) so length-
// based windows can't truncate the assertion target as the function grows.
function fnSlice(name) {
  const start = SCRIPT.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " must exist");
  const after = SCRIPT.indexOf("\nfunction ", start + 1);
  return SCRIPT.slice(start, after === -1 ? undefined : after);
}

const ALL = loadCases();
const SCENARIOS = [["CASE", ALL.CASE], ["CASE_B", ALL.CASE_B], ["CASE_C", ALL.CASE_C]];

test("every history + exam item carries a trilingual clinical `group` label", () => {
  for (const [name, C] of SCENARIOS) {
    ["history", "exam"].forEach(section => {
      C[section].forEach((item, i) => {
        assert.ok(item.group, name + "." + section + "[" + i + "] must have a `group` category");
        assert.ok(tri(item.group),
          name + "." + section + "[" + i + "] group must be a {en,fr,ja} trio");
      });
    });
  }
});

test("labs items are NOT clustered (investigations stay flat)", () => {
  for (const [name, C] of SCENARIOS) {
    C.labs.forEach((item, i) => {
      assert.ok(!item.group,
        name + ".labs[" + i + "] must NOT carry a category (investigations render flat)");
    });
  }
});

test("each section resolves to 2+ clinical categories (a real clustering)", () => {
  for (const [name, C] of SCENARIOS) {
    ["history", "exam"].forEach(section => {
      const keys = new Set(C[section].map(it => it.group.en));
      assert.ok(keys.size >= 2,
        name + "." + section + " should cluster into 2+ categories (got " + keys.size + ")");
    });
  }
});

test("buildButtons clusters History/Exam by category but keeps Investigations flat", () => {
  const fn = fnSlice("buildButtons");
  // labs short-circuits to a flat render.
  assert.match(fn, /group === "labs"/, "labs must be handled as a flat (non-clustered) render");
  // category clustering path
  assert.match(fn, /_categoryClusters/, "buildButtons must call _categoryClusters");
  assert.match(fn, /req-category/, "clustered buttons must be wrapped in .req-category sub-groups");
  assert.match(fn, /req-category-label/, "each cluster must render a category heading");
});

test("_categoryClusters keys by canonical EN + returns null when no categories", () => {
  const start = SCRIPT.indexOf("function _categoryClusters");
  assert.ok(start >= 0, "_categoryClusters helper must exist");
  const fn = SCRIPT.slice(start, start + 900);
  assert.match(fn, /g\.en/, "clusters must be keyed by the canonical EN value (stable across langs)");
  assert.match(fn, /return any \?/, "must return null when no item carries a category (custom scenarios)");
});

test("the HISTORY_VISIBLE_COUNT overflow split survives as the category-less fallback", () => {
  const fn = fnSlice("buildButtons");
  assert.match(fn, /HISTORY_VISIBLE_COUNT/, "the dense-History fallback must remain");
  assert.match(fn, /history-sub-more/, "the overflow <details> fallback must remain");
});

test("indices are untouched: SYNTH_PREREQS + synth id unchanged", () => {
  assert.match(SCRIPT, /SYNTH_PREREQS\s*=\s*\["history:1",\s*"history:2",\s*"exam:3"\]/,
    "SYNTH_PREREQS must stay history:1 / history:2 / exam:3 (no reorder)");
});

test("categories partition every history/exam item exactly once (no item lost)", () => {
  // The render iterates the (shuffled) index list and drops each index into its
  // category bucket. Confirm the categories cover all indices with no overlap.
  for (const [name, C] of SCENARIOS) {
    ["history", "exam"].forEach(section => {
      const byCat = {};
      C[section].forEach((it, i) => {
        const k = it.group.en;
        (byCat[k] = byCat[k] || []).push(i);
      });
      const covered = Object.values(byCat).reduce((a, arr) => a + arr.length, 0);
      assert.strictEqual(covered, C[section].length,
        name + "." + section + ": every item must belong to exactly one category");
    });
  }
});
