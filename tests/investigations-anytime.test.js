/* tests/investigations-anytime.test.js
 *
 * Dry-run feedback (2026-05-26): investigations (imaging + bloods) should be
 * clickable AT ANY TIME — a real choice the team can get wrong — and penalised
 * if ordered prematurely / without indication, rather than hard-locked behind
 * "add a working hypothesis first". The clinical SYNTHESIS item (labs:0,
 * key:true) still exists in case-content.js but is NO LONGER rendered on-screen
 * (2026-06-02) — its write-up ships in the stage-4 take-home export. The ≥2
 * working-hypotheses phase gate now drives the Debate. The investigation
 * penalties already exist (pen_mri / pen_xray / pen_bloods / pen_ct). Static
 * source + content checks.
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

test("the on-screen synthesis button is gone; the Debate gates on ≥1 hypothesis (phaseGateOpen)", () => {
  // 2026-06-02: the Clinical synthesis section was removed; SYNTH_ID is no longer
  // rendered as a button, so neither renderButtons nor reveal() special-case it.
  const rb = fnSlice("renderButtons");
  assert.doesNotMatch(rb, /id === SYNTH_ID/, "renderButtons no longer special-cases a synthesis button");
  const rv = fnSlice("reveal");
  assert.doesNotMatch(rv, /SYNTH_ID && !phaseGateOpen/,
    "reveal() no longer carries the synthesis gate guard");
  // Gate threshold lowered to ≥1 hypothesis (user 2026-06-25).
  assert.match(SCRIPT, /function phaseGateOpen\(\)[\s\S]*?hypothesisCount\(\) >= 1/,
    "phaseGateOpen() must be hypothesisCount() >= 1");
  assert.match(SCRIPT, /const unlocked = \(typeof phaseGateOpen === "function"\) && phaseGateOpen\(\);/,
    "the discussion prompts unlock on phaseGateOpen()");
});

test("the hypothesis-first investigations lock is gone (dead code removed)", () => {
  assert.doesNotMatch(SCRIPT, /function hypothesesUnlocked\s*\(/,
    "the unused hypothesesUnlocked gate should be removed");
  // The panel must not be greyed out as locked any more.
  const rh = fnSlice("renderHypotheses");
  assert.doesNotMatch(rh, /toggle\("is-locked", !unlocked\)/,
    "the investigations panel must no longer be hypothesis-locked");
});

test("investigations copy frames them as FREE (not locked); the gate is ≥1 hypothesis", () => {
  const I18N = require("./_i18n_source.js").readI18nSource();
  // 2026-06-02: the old investigations.locked-hint is retired; the section shows
  // a free "yours to choose" hint. The Clinical synthesis section was removed, so
  // its locked-hint key is gone too; the gate is now ≥1 working hypothesis.
  assert.doesNotMatch(I18N, /"modA\.chart\.investigations\.locked-hint"/,
    "the dead investigations.locked-hint key must be removed");
  const hint = I18N.match(/"modA\.chart\.investigations\.hint":\s*"([^"]*)"/);
  assert.ok(hint, "investigations.hint key must exist");
  assert.doesNotMatch(hint[1], /🔒|Locked/i, "the investigations hint must not say the panel is locked");
  // The synthesis section is gone — its lock-hint key must be removed.
  assert.doesNotMatch(I18N, /"modA\.chart\.synthesis\.locked-hint"/,
    "the dead synthesis.locked-hint key must be removed");
  // The coach gather copy points at writing hypotheses, not a locked panel.
  const gather = I18N.match(/"modA\.coach\.gather":\s*"([^"]*)"/);
  assert.ok(gather, "coach gather key must exist");
  assert.doesNotMatch(gather[1], /🔒|Locked/i, "coach copy must not frame investigations as locked");
  assert.match(gather[1], /hypoth/i, "coach gather copy points at writing hypotheses");
});
