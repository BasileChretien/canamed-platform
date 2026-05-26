/* tests/investigations-anytime.test.js
 *
 * Dry-run feedback (2026-05-26): investigations (imaging + bloods) should be
 * clickable AT ANY TIME — a real choice the team can get wrong — and penalised
 * if ordered prematurely / without indication, rather than hard-locked behind
 * "add a working hypothesis first". Only the clinical SYNTHESIS (labs:0,
 * key:true) stays gated, and only on the red-flag screen (history:1 +
 * history:2 + exam:3) — NOT on a hypothesis. The penalties already exist
 * (pen_mri / pen_xray / pen_bloods / pen_ct). Static source + content checks.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");

function loadCase() {
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.__CASE = CASE; this.__PEN = PENALTIES;";
  const ctx = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, {}, {});
  return { CASE: ctx.__CASE, PENALTIES: ctx.__PEN };
}

function fnSlice(name) {
  const start = SCRIPT.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " must exist");
  const after = SCRIPT.indexOf("\nfunction ", start + 1);
  return SCRIPT.slice(start, after === -1 ? undefined : after);
}

test("each investigation (imaging + bloods) carries a penalty so a premature order costs points", () => {
  const { CASE, PENALTIES } = loadCase();
  const byItem = {};
  PENALTIES.forEach(p => { byItem[p.item] = p; });
  // labs:0 is the gated synthesis (no penalty); labs:1..N are the orderable
  // investigations and every one must be penalised when ordered without cause.
  for (let i = 1; i < CASE.labs.length; i++) {
    const p = byItem["labs:" + i];
    assert.ok(p, "labs:" + i + " (an investigation) must have a penalty");
    assert.ok(p.points > 0, "labs:" + i + " penalty must deduct points");
  }
});

test("the synthesis is labs:0 and key:true", () => {
  const { CASE } = loadCase();
  assert.strictEqual(CASE.labs[0].key, true, "labs:0 must be the key synthesis item");
});

test("renderButtons no longer hypothesis-gates the investigations", () => {
  const fn = fnSlice("renderButtons");
  assert.doesNotMatch(fn, /hypoOK/, "investigations must not be disabled by a hypothesis gate");
  assert.doesNotMatch(fn, /hypothesesUnlocked/, "renderButtons must not consult hypothesesUnlocked");
  // The 'order matters' soft warning on imaging is kept (penalty cue, not a lock).
  assert.match(fn, /isImaging/, "imaging buttons keep their premature-order warning cue");
});

test("the synthesis stays red-flag-gated (gateOK / prereqsMet), not hypothesis-gated", () => {
  const rb = fnSlice("renderButtons");
  assert.match(rb, /id === SYNTH_ID/, "the synthesis button is still specially gated");
  assert.match(rb, /gateOK/, "synthesis gating uses the red-flag prereq result");
  const rv = fnSlice("reveal");
  assert.match(rv, /id === SYNTH_ID && !prereqsMet\(\)/,
    "reveal() hard-gates ONLY the synthesis on the red-flag screen");
});

test("the hypothesis-first investigations lock is gone (dead code removed)", () => {
  assert.doesNotMatch(SCRIPT, /function hypothesesUnlocked\s*\(/,
    "the unused hypothesesUnlocked gate should be removed");
  // The panel must not be greyed out as locked any more.
  const rh = fnSlice("renderHypotheses");
  assert.doesNotMatch(rh, /toggle\("is-locked", !unlocked\)/,
    "the investigations panel must no longer be hypothesis-locked");
});

test("the panel hint + coach copy no longer claim investigations are locked", () => {
  const I18N = require("./_i18n_source.js").readI18nSource();
  // locked-hint reworded — no 'Locked' / lock emoji framing for investigations.
  const hint = I18N.match(/"modA\.chart\.investigations\.locked-hint":\s*"([^"]*)"/);
  assert.ok(hint, "locked-hint key must still exist");
  assert.doesNotMatch(hint[1], /🔒|Locked/i, "the hint must not say the panel is locked");
  // coach add-hypothesis must not claim 'Investigations unlock once you have one'.
  const coach = I18N.match(/"modA\.coach\.add-hypothesis":\s*"([^"]*)"/);
  assert.ok(coach, "coach add-hypothesis key must still exist");
  assert.doesNotMatch(coach[1], /unlock/i, "coach copy must not claim investigations unlock on a hypothesis");
});
