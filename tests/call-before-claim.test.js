"use strict";
/* tests/call-before-claim.test.js
 *
 * The call button's writes wait for the participant's room claim.
 *
 * Since #457 the call for help — and the `help` entry the button writes to the
 * room's event log — need a room claim. startRoom() issues the claim as the
 * room appears (a read, then a write), and the button is live before it lands:
 * a press in that moment was refused, silently. Reproduced on the emulator by
 * holding the claim's write in transit (tests-e2e/emulator/call-before-claim.spec.js,
 * red before this change). Now every participant write of the button goes
 * through `_afterClaim()`, which waits for `roomClaimSettled`; startRoom()
 * settles it on every outcome of the claim, and after ten seconds whatever
 * happens, so a stuck claim never holds a call for good.
 *
 * This file pins the text; the emulator spec is the behaviour.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8").replace(/\r\n/g, "\n");

function bodyOf(src, name) {
  const start = src.indexOf("\nfunction " + name + "(");
  assert.notStrictEqual(start, -1, name + "() not found");
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

/* The spans of every `_afterClaim( … )` call, by bracket matching. */
function afterClaimSpans(src) {
  const spans = [];
  let i = src.indexOf("_afterClaim(");
  while (i !== -1) {
    let depth = 0, j = i + "_afterClaim".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    spans.push([i, j]);
    i = src.indexOf("_afterClaim(", j);
  }
  return spans;
}
function writesOutside(src, re) {
  const spans = afterClaimSpans(src);
  const out = [];
  for (const m of src.matchAll(re)) {
    if (!spans.some(([a, b]) => m.index > a && m.index < b)) out.push(m[0]);
  }
  return out;
}

test("the helper waits for the claim", () => {
  assert.match(code(SCRIPT), /const _afterClaim = \(write\) => roomClaimSettled\.then\(write\);/);
  assert.match(code(SCRIPT), /\nlet roomClaimSettled = Promise\.resolve\(\);/,
    "roomClaimSettled must exist, already settled, for LOCAL mode and before any room");
});

test("every participant write of the call button waits for the claim", () => {
  for (const name of ["initCallProf", "_callFacilitatorToAdvance"]) {
    const body = code(bodyOf(SCRIPT, name));
    /* The facilitator's "Resolve call" is not a participant write: the rule's
       facilitator half admits it with or without a claim. */
    const participant = body.replace("if (isRoomAdmin) { refCallForHelp.remove(); return; }", "");
    const writes = [...participant.matchAll(/refCallForHelp\.(set|remove|update)\(|logEvent\(myRoom, "help"/g)];
    assert.ok(writes.length >= (name === "initCallProf" ? 5 : 2), `${name}(): writes not found — the check would pass on nothing`);
    assert.deepStrictEqual(writesOutside(participant, /refCallForHelp\.(set|remove|update)\(|logEvent\(myRoom, "help"/g), [],
      `${name}() writes the call (or its help event) without waiting for the room claim`);
  }
  /* The matcher itself must see a write outside a span. */
  assert.deepStrictEqual(writesOutside("a(); refCallForHelp.set(x); _afterClaim(() => refCallForHelp.remove());",
    /refCallForHelp\.(set|remove)\(/g), ["refCallForHelp.set("]);
});

test("startRoom settles the claim on every outcome, and after ten seconds regardless", () => {
  const body = code(bodyOf(SCRIPT, "startRoom"));
  assert.match(body, /roomClaimSettled = Promise\.resolve\(\);/, "a room entered without a claim attempt must not wait");
  assert.match(body, /roomClaimSettled = new Promise\(\(r\) => \{ _settle = r; setTimeout\(r, 10000\); \}\);/,
    "the claim's promise, with its ten-second cap");
  const claim = body.slice(body.indexOf("const _claimRoomOf"), body.indexOf("_claimRoomOf(true);"));
  assert.ok(claim.length > 200, "_claimRoomOf not captured");
  /* landed or found; re-read after a denial; given up */
  assert.match(claim, /: ref\.set\(\{ room: myRoom, cid: clientId \}\)\)\)\n\s*\.then\(_settle\)/);
  assert.match(claim, /_notConfirmed\)\.then\(_settle, _settle\);/);
  assert.match(claim, /_notConfirmed\(\);\n\s*_settle\(\);/);
});
