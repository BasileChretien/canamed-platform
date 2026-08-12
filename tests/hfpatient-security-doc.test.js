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
  /* Each fact carries the WORDS that identify which control it is. Checking
     only that the number appears somewhere in the section lets the three rate
     limits be swapped — "40 / day, 200 / hour" would satisfy a bare presence
     test while documenting a 5x-wrong hourly budget. `near` keeps the value and
     its label in the same clause without pinning the whole sentence. */
  ["max messages per body", constOf(HELPERS, "MAX_BODY_MESSAGES"), "messages"],
  ["max chars per body", constOf(HELPERS, "MAX_BODY_CHARS"), "chars"],
  ["max reply chars", constOf(INDEX, "MAX_REPLY_CHARS"), "chars"],
  ["per-uid hourly turns", constOf(INDEX, "RATE_LIMIT_TURNS"), "hour"],
  ["per-uid daily turns", constOf(INDEX, "RATE_LIMIT_DAILY_TURNS"), "day"],
  ["per-session turns", constOf(INDEX, "SESSION_RATE_LIMIT_TURNS"), "session"]
];

/* value ... label, within one clause (no sentence end between them). */
function near(sec, value, label) {
  return new RegExp("\\b" + value + "\\b[^.\\n]{0,40}" + label).test(sec);
}

test("every documented limit matches the constant in code, under its own label", () => {
  const sec = securitySection();
  for (const [label, value, keyword] of FACTS) {
    assert.ok(sec.includes(value),
      `the security section never states the ${label} (${value}) — either it is ` +
      "missing or it still shows the old number");
    assert.ok(near(sec, value, keyword),
      `${label} (${value}) appears, but not attached to "${keyword}" — a number ` +
      "documented against the wrong control is as misleading as a wrong number");
  }
});

test("the reply cap is the reply's, not a second body cap", () => {
  /* MAX_REPLY_CHARS and MAX_BODY_CHARS are both "<n> chars", so the keyword
     test above cannot tell them apart on its own. */
  const sec = securitySection();
  assert.match(sec, new RegExp("capped at[^.\\n]{0,20}\\b" + constOf(INDEX, "MAX_REPLY_CHARS") + "\\b"),
    "the reply cap must be stated as the REPLY's cap");
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
  // ...and the param that actually drives it must be named, WITH its default —
  // "enforcement is a param" reads as reassuring unless the doc says the param
  // is off. Same for the single-use setting, whose absence let the old text
  // claim `consumeAppCheckToken: true` unchallenged.
  assert.match(sec, /APP_CHECK_ENFORCE/,
    "the section must name the param that actually controls enforcement");
  assert.match(sec, /default\s*`?false`?/i,
    "the section must state that APP_CHECK_ENFORCE defaults to false, or a " +
    "reader assumes enforcement is on");
  assert.match(sec, /consumeAppCheckToken:\s*false/,
    "the section must state consumeAppCheckToken: false — it is a deliberate " +
    "choice (single-use tokens break a multi-turn chat), not an oversight");
  assert.match(INDEX, /consumeAppCheckToken:\s*false/,
    "index.js must actually set it false (this is what the doc describes)");
  assert.match(INDEX, /defineBoolean\("APP_CHECK_ENFORCE",\s*\{\s*default:\s*false/,
    "the documented default must be the real one");
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

test("the metrics are not described as anonymous / PII-free", () => {
  /* The function persists the Firebase Auth `uid` with every metrics row. A
     persistent online identifier is personal data in pseudonymous form (GDPR
     Recital 30), so "No PII logged" was an overstatement — and this repo carries
     a real GDPR/APPI posture, so an overstatement here is not cosmetic. What IS
     true is that no transcript or free text is written by the function. */
  /* Match the CLAIM ("No PII logged"), never a bare mention of "no PII" — the
     corrected text has to be able to SAY it must not be described that way.
     Third time this bit in one session (the uidMembers comment in #311, the
     functions.config() ban above, this): a guard that forbids naming the bug
     forbids documenting the fix. Ban the assertion, not the vocabulary. */
  const sec = securitySection();
  for (const claim of [/no pii logged/i, /\bnot? personal data\b/i, /\banonymous(?:ly)? logg/i]) {
    assert.ok(!claim.test(sec),
      `the security section claims ${claim} of the metrics, but each row carries ` +
      "the uid — pseudonymous, not anonymous");
  }
  assert.match(sec, /pseudonymous/i, "the section must classify the metrics honestly");
  assert.match(INDEX, /metrics\/hfPatient\/events/,
    "the metrics path must exist (this is what the doc describes)");
  assert.match(INDEX, /\buid,/, "the events record must actually carry uid");
});

test("the room-membership boundary is documented", () => {
  /* It is the control that always applies — App Check is off here — so a
     security section that omits it describes a weaker system than exists. */
  const sec = securitySection();
  assert.match(sec, /roomOf/, "the section must document the roomOf membership claim");
  assert.match(INDEX, /_verifyMembership\(uid, body\)/,
    "the handler must actually perform the membership check");
});
