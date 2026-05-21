/* tests/swap-replay-roleplay.test.js
 *
 * Swap-and-replay loop (2026-05-22) — the Module B roleplay enhancement: after
 * a round the room rotates roles (physician → patient → family → observer) and
 * replays the scene from the other side. Synced via <base>/roleplayRound; each
 * client rotates only its OWN roleChoices node, so no cross-client writes are
 * needed. Works in LOCAL/solo mode too.
 *
 * Static source-text checks (the project's primary test mechanism). The
 * runtime rotation + banner are exercised in tests-e2e/swap-replay.spec.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const I18N = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");
const RULES = fs.readFileSync(path.join(P, "database.rules.json"), "utf8");

test("the role-picker exposes a swap button, round indicator and banner", () => {
  assert.match(HTML, /id="modB-swap-replay-btn"/, "swap button must exist");
  assert.match(HTML, /id="modB-replay-round"/, "round indicator must exist");
  assert.match(HTML, /id="modB-replay-banner"/, "swap banner must exist");
  // The banner is a polite live region (announced to screen readers).
  const i = HTML.indexOf('id="modB-replay-banner"');
  const blk = HTML.slice(i - 120, i + 120);
  assert.match(blk, /aria-live="polite"/, "swap banner must be a polite live region");
});

test("rotateRole cycles physician → patient → family → observer", () => {
  const i = SCRIPT.indexOf("REPLAY_ROLE_ORDER");
  assert.ok(i > -1, "the role rotation order must be defined");
  const order = SCRIPT.slice(i, i + 120);
  assert.match(order, /"physician"\s*,\s*"patient"\s*,\s*"family"\s*,\s*"observer"/,
    "rotation order must be physician → patient → family → observer");
  assert.match(SCRIPT, /function rotateRole\(role, steps\)/, "rotateRole must exist");
});

test("the round advances together and rotates only the client's OWN role", () => {
  assert.match(SCRIPT, /function bumpReplayRound\(\)/, "bumpReplayRound must exist");
  assert.match(SCRIPT, /function handleReplayRound\(round, fromSync\)/, "handleReplayRound must exist");
  assert.match(SCRIPT, /function applyRoleSwap\(steps, round\)/, "applyRoleSwap must exist");
  // Shared mode advances via the synced node; LOCAL applies it directly.
  assert.match(SCRIPT, /refReplayRound\.set\(next\)/, "shared mode must write roleplayRound");
  // The rotation must write only the client's OWN roleChoices child.
  const a = SCRIPT.indexOf("function applyRoleSwap");
  const blk = SCRIPT.slice(a, a + 1400);
  assert.match(blk, /refRoleChoices\.child\(clientId\)\.set/,
    "rotation must write only the client's own roleChoices node (no cross-writing)");
  assert.match(blk, /showSwapBanner/, "applyRoleSwap must surface the reflective banner");
});

test("a late joiner does not auto-rotate on arrival (replayRoundReady guard)", () => {
  assert.match(SCRIPT, /let replayRoundReady = false/, "the readiness guard must exist");
  const h = SCRIPT.indexOf("function handleReplayRound");
  const blk = SCRIPT.slice(h, h + 700);
  assert.match(blk, /wasReady && round > prev/,
    "rotation must only fire on a real increment after the baseline is known");
});

test("the roleplayRound listener is wired and cleaned up", () => {
  assert.match(SCRIPT, /refReplayRound = db\.ref\(base \+ "\/roleplayRound"\)/,
    "the roleplayRound ref must be bound in the room");
  assert.match(SCRIPT, /refReplayRound\.on\("value"/, "must subscribe to roleplayRound");
  assert.match(SCRIPT, /if \(refReplayRound\) refReplayRound\.off\(\)/,
    "must detach the roleplayRound listener on room teardown");
});

test("roleplayRound is rule-guarded in both the sessions and orgs trees", () => {
  const count = (RULES.match(/"roleplayRound":/g) || []).length;
  assert.strictEqual(count, 2, "roleplayRound must be ruled in both trees (got " + count + ")");
  // Validate: a number bounded 1..4 (matches the 4-role rotation cap).
  assert.match(RULES, /newData\.isNumber\(\) && newData\.val\(\) >= 1 && newData\.val\(\) <= 4/,
    "roleplayRound must validate as a number in [1,4]");
});

test("the swap-replay copy ships in en / fr / ja", () => {
  for (const key of ["modB.replay.swap", "modB.replay.swapped", "modB.replay.fromto",
                     "modB.replay.round1", "modB.replay.roundN"]) {
    const n = (I18N.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length;
    assert.ok(n >= 3, key + " must be defined in en, fr and ja (got " + n + ")");
  }
});

test("the swap-replay UI has dedicated styles", () => {
  assert.match(CSS, /\.role-replay-btn\b/, "swap button must be styled");
  assert.match(CSS, /\.role-replay-banner\b/, "swap banner must be styled");
});
