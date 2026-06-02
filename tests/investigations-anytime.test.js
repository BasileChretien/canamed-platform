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
});

test("investigations are freely clickable like the examination (no warn-cue gate)", () => {
  // 2026-06-02: investigations no longer carry the "screen the red flags first"
  // warn cue — they're free like the examination; a premature order still costs
  // points via the scoring engine. renderButtons clears any stale warn node.
  const fn = fnSlice("renderButtons");
  assert.doesNotMatch(fn, /classList\.toggle\("warn", warn\)/,
    "imaging buttons must NOT be given a premature-order warn class any more");
  assert.match(fn, /classList\.remove\("warn"\)/,
    "renderButtons clears any stale warn class on investigation buttons");
});

test("the synthesis is gated on ≥2 working hypotheses (phaseGateOpen), not the red-flag screen", () => {
  const rb = fnSlice("renderButtons");
  assert.match(rb, /id === SYNTH_ID/, "the synthesis button is still specially gated");
  assert.match(rb, /phaseGateOpen\(\)/, "synthesis gating uses the ≥2-hypotheses phase gate");
  const rv = fnSlice("reveal");
  assert.match(rv, /id === SYNTH_ID && !phaseGateOpen\(\)/,
    "reveal() hard-gates ONLY the synthesis, on ≥2 working hypotheses");
  assert.match(SCRIPT, /function phaseGateOpen\(\)[\s\S]*?hypothesisCount\(\) >= 2/,
    "phaseGateOpen() must be hypothesisCount() >= 2");
});

test("the hypothesis-first investigations lock is gone (dead code removed)", () => {
  assert.doesNotMatch(SCRIPT, /function hypothesesUnlocked\s*\(/,
    "the unused hypothesesUnlocked gate should be removed");
  // The panel must not be greyed out as locked any more.
  const rh = fnSlice("renderHypotheses");
  assert.doesNotMatch(rh, /toggle\("is-locked", !unlocked\)/,
    "the investigations panel must no longer be hypothesis-locked");
});

test("investigations copy frames them as FREE (not locked); the gate is the synthesis", () => {
  const I18N = require("./_i18n_source.js").readI18nSource();
  // 2026-06-02: the old investigations.locked-hint is retired; the section now
  // shows a free "yours to choose" hint, and the SYNTHESIS section carries the
  // ≥2-hypotheses lock hint.
  assert.doesNotMatch(I18N, /"modA\.chart\.investigations\.locked-hint"/,
    "the dead investigations.locked-hint key must be removed");
  const hint = I18N.match(/"modA\.chart\.investigations\.hint":\s*"([^"]*)"/);
  assert.ok(hint, "investigations.hint key must exist");
  assert.doesNotMatch(hint[1], /🔒|Locked/i, "the investigations hint must not say the panel is locked");
  // The synthesis lock hint gates on hypotheses, and the coach gather copy points
  // at writing hypotheses (not a locked investigations panel).
  const synLock = I18N.match(/"modA\.chart\.synthesis\.locked-hint":\s*"([^"]*)"/);
  assert.ok(synLock, "synthesis.locked-hint key must exist");
  assert.match(synLock[1], /two|2|hypoth/i, "synthesis lock hint must reference ≥2 hypotheses");
  const gather = I18N.match(/"modA\.coach\.gather":\s*"([^"]*)"/);
  assert.ok(gather, "coach gather key must exist");
  assert.doesNotMatch(gather[1], /🔒|Locked/i, "coach copy must not frame investigations as locked");
});
