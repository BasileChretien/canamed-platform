"use strict";
/* tests/hfpatient-security-doc.test.js
 *
 * The `hfPatient` security section of functions/README.md describes controls
 * that live in code. It had drifted badly (found 2026-08-12) and claimed, all
 * at once:
 *
 *   - "App Check is ENFORCED (enforceAppCheck: true, consumeAppCheckToken: true)"
 *     — it is `enforceAppCheck: APP_CHECK_ENFORCE` (default false), reverted to
 *     Monitor on 2026-06-03, and consumeAppCheckToken is false by design.
 *   - "HF token stored server-side (functions.config().hf.token)" — that API is
 *     deprecated; the token is a defineSecret in Secret Manager.
 *   - "at most 16 messages, 4000 chars total" — the cap is 12000.
 *   - "until an operator deliberately flips moda.llm=true" — the param is
 *     MODA_LLM_ENABLED.
 *   - Status "⛔ DISABLED pending institutional approval" — it has been live
 *     since 2026-05-30.
 *
 * A security doc that overstates its controls is worse than no doc: it invites
 * a reader to skip the check that is actually load-bearing. This pins the
 * CHECKABLE facts — the numbers and the identifiers — to the code.
 *
 * Prose is deliberately NOT pinned. The point is to make a wrong NUMBER or a
 * renamed PARAM fail, not to freeze the wording.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const FN = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "functions");
const read = p => fs.readFileSync(p, "utf8");
const INDEX = read(path.join(FN, "index.js"));
const HELPERS = read(path.join(FN, "lib", "hf-helpers.js"));
const README = read(path.join(FN, "README.md"));

function constOf(src, name) {
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*(\\d+)"));
  assert.ok(m, `expected a numeric const ${name}`);
  return m[1];
}

/* Only the security section — a number like "16" appears all over a long
   README, so an unscoped search would pass on coincidence. */
function securitySection() {
  const start = README.indexOf("### Security model");
  assert.notStrictEqual(start, -1, "the security section must exist");
  const end = README.indexOf("\n### ", start + 1);
  assert.notStrictEqual(end, -1, "the security section must be followed by another heading");
  const sec = README.slice(start, end);
  assert.ok(sec.length > 400, "security section looks truncated");
  return sec;
}

const FACTS = [
  ["max messages per body", constOf(HELPERS, "MAX_BODY_MESSAGES")],
  ["max chars per body", constOf(HELPERS, "MAX_BODY_CHARS")],
  ["max reply chars", constOf(INDEX, "MAX_REPLY_CHARS")],
  ["per-uid hourly turns", constOf(INDEX, "RATE_LIMIT_TURNS")],
  ["per-uid daily turns", constOf(INDEX, "RATE_LIMIT_DAILY_TURNS")],
  ["per-session turns", constOf(INDEX, "SESSION_RATE_LIMIT_TURNS")]
];

test("every documented limit matches the constant in code", () => {
  const sec = securitySection();
  for (const [label, value] of FACTS) {
    assert.ok(sec.includes(value),
      `the security section never states the ${label} (${value}) — either it is ` +
      "missing or it still shows the old number");
  }
});

test("the retired 4000-char body cap is gone", () => {
  // The specific stale value that shipped. Worth naming: it under-reported the
  // cap by 3x, so a reader would think the surface was smaller than it is.
  assert.ok(!securitySection().includes("4000"),
    "the security section still cites the retired 4000-char body cap");
});

test("App Check is not described as unconditionally enforced", () => {
  const sec = securitySection();
  for (const claim of ["enforceAppCheck: true", "enforceAppCheck:true",
                       "consumeAppCheckToken: true", "consumeAppCheckToken:true"]) {
    assert.ok(!sec.includes(claim),
      `the security section claims \`${claim}\`, but enforcement is the ` +
      "APP_CHECK_ENFORCE param (default false) and single-use tokens are wrong here");
  }
  // ...and the param that actually drives it must be named.
  assert.match(sec, /APP_CHECK_ENFORCE/,
    "the section must name the param that actually controls enforcement");
  assert.match(INDEX, /enforceAppCheck:\s*APP_CHECK_ENFORCE/,
    "index.js must drive enforcement from the param (this is what the doc describes)");
});

test("the token store is Secret Manager, not the deprecated functions.config()", () => {
  const sec = securitySection();
  /* Match the CITATION (`functions.config().hf…`), not any mention of the API.
     Saying "functions.config() is deprecated and is NOT used" is exactly the
     clarification a reader needs — an unscoped ban on the string forbids the
     correction along with the error. (This test failed that way first.) */
  assert.ok(!/functions\.config\(\)\s*\.\s*hf/.test(sec),
    "the security section still cites functions.config().hf as the token store — " +
    "the token is a defineSecret in Secret Manager");
  assert.match(sec, /Secret Manager/i);
  assert.match(INDEX, /defineSecret\("HF_TOKEN"\)/,
    "index.js must hold HF_TOKEN as a secret (this is what the doc describes)");
});

test("the enable flag is named MODA_LLM_ENABLED everywhere in the README", () => {
  assert.ok(!README.includes("moda.llm"),
    "`moda.llm` is the retired functions.config() key; the param is MODA_LLM_ENABLED");
  assert.match(README, /MODA_LLM_ENABLED/);
  assert.match(INDEX, /defineBoolean\("MODA_LLM_ENABLED"/,
    "index.js must define MODA_LLM_ENABLED (this is what the doc describes)");
});

test("the room-membership boundary is documented", () => {
  /* It is the control that always applies — App Check is off here — so a
     security section that omits it describes a weaker system than exists. */
  const sec = securitySection();
  assert.match(sec, /roomOf/, "the section must document the roomOf membership claim");
  assert.match(INDEX, /_verifyMembership\(uid, body\)/,
    "the handler must actually perform the membership check");
});
