/* tests/case-more-wrong-items.test.js
 *
 * Dry-run feedback (2026-05-26): "We need more wrong questions and wrong
 * examinations" so students can make mistakes and learn. Three new deliberately
 * POOR moves were APPENDED to the chronic-pain case (history:11 premature
 * reassurance, history:12 reflex referral, exam:7 deliberate pain provocation),
 * each with a matching PENALTY + teaching `why`. Appended at the end so existing
 * indices, SYNTH_PREREQS and the other PENALTIES references stay valid.
 *
 * Executable check of the case content shape (eval with a window shim).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

function loadCase() {
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.__CASE = CASE; this.__PEN = PENALTIES;";
  const ctx = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, {}, {});
  return { CASE: ctx.__CASE, PENALTIES: ctx.__PEN };
}

const tri = o => !!(o && typeof o.en === "string" && o.en && typeof o.fr === "string" && o.fr &&
                    typeof o.ja === "string" && o.ja);

test("the chronic-pain case gained more wrong history + exam moves", () => {
  const { CASE } = loadCase();
  assert.ok(CASE.history.length >= 13, "history must have the 2 new wrong moves appended (>=13)");
  assert.ok(CASE.exam.length >= 8, "exam must have the new wrong move appended (>=8)");
  [CASE.history[11], CASE.history[12], CASE.exam[7]].forEach((it, i) => {
    assert.ok(it && tri(it.q) && tri(it.a), "new item " + i + " must be present + en/fr/ja");
  });
});

test("each new wrong move has a matching penalty + teaching why, all trilingual", () => {
  const { CASE, PENALTIES } = loadCase();
  const byItem = {};
  PENALTIES.forEach(p => { byItem[p.item] = p; });
  ["history:11", "history:12", "exam:7"].forEach(item => {
    const p = byItem[item];
    assert.ok(p, "a penalty must reference " + item);
    assert.ok(typeof p.points === "number" && p.points > 0, item + " penalty must deduct points");
    assert.ok(tri(p.title) && tri(p.why), item + " penalty title + why must be en/fr/ja");
  });
});

test("every PENALTIES item still resolves to a real case item (no dangling refs)", () => {
  const { CASE, PENALTIES } = loadCase();
  PENALTIES.forEach(p => {
    const m = /^([a-z]+):(\d+)$/.exec(p.item);
    assert.ok(m, p.id + ": item must be 'group:index'");
    const arr = CASE[m[1]];
    assert.ok(Array.isArray(arr) && arr[Number(m[2])], p.id + " -> " + p.item + " must resolve");
  });
});

test("the red-flag gating prerequisites are untouched by the append", () => {
  // SYNTH_PREREQS in script.js = history:1, history:2, exam:3 — appending at the
  // END must not have shifted those. Assert the screens are still where the
  // gating expects them.
  const { CASE } = loadCase();
  assert.match(CASE.history[1].q.en, /serious causes|red flag|weight loss/i,
    "history:1 must still be the serious-causes red-flag screen");
  assert.match(CASE.history[2].q.en, /[Cc]auda equina/,
    "history:2 must still be the cauda-equina screen");
  assert.match(CASE.exam[3].q.en, /[Nn]eurolog/,
    "exam:3 must still be the leg neuro exam");
});
