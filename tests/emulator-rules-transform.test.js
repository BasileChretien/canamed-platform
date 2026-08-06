/* tests/emulator-rules-transform.test.js
 *
 * Pins the database.rules.json → database.rules.emulator.json transform.
 *
 * WHY THIS FILE EXISTS. The transform used to rewrite `\s` to `\t\n\r ` and
 * nothing checked what that meant. It loaded, so it looked fine for months. It
 * was not fine: the RTDB emulator's regex parser DROPS a backslash inside a
 * character class, so `[^@\t\n\r ]` meant "not @, not the letter t, not n, not
 * r, not space" — it banned t/n/r from every email address and admitted real
 * tabs and newlines. `sessions/$id/mail/$mailId` therefore could not be
 * satisfied by ANY realistic address under the emulator, and the open-relay
 * security test passed on a denial that had nothing to do with the admin gate.
 * It would have passed with the gate deleted.
 *
 * The evidence behind every substitution is in build-emulator-rules.js's
 * header; it was probed against a live emulator, not reasoned about. These
 * tests keep the table, the fail-loud guard, and the SAFE DIRECTION of the
 * remaining divergence from silently regressing. What they cannot do is prove
 * the emulator honours the result — only tests-e2e/emulator/rules-smoke.spec.js
 * ("mail queue is admin-gated") does that, by writing a real address through
 * the real rules and requiring it to be ALLOWED.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  transformRules, assertEmulatorSafe, CLASS_SUBSTITUTIONS
} = require("../scripts/sim/build-emulator-rules.js");

const PLATFORM = path.resolve(__dirname, "..", "docs", "Third_session", "PBL_platform");
const PROD = fs.readFileSync(path.join(PLATFORM, "database.rules.json"), "utf8");

test("the transform rewrites both \\s character classes and leaves valid JSON", () => {
  const out = transformRules(PROD);
  JSON.parse(out); // transformRules already does this; assert the contract too.

  assert.equal(PROD.split("[^@\\\\s]").length - 1, 6,
    "the mail `to` validator's three parts, in the sessions AND orgs trees");
  assert.equal(PROD.split("[^\\\\s]").length - 1, 6,
    "the three https:// link validators, in the sessions AND orgs trees");

  assert.equal(out.split("[!-?A-~]").length - 1, 6);
  assert.equal(out.split("[!-~]").length - 1, 6);
  assert.ok(!out.includes("[^@\\\\s]") && !out.includes("[^\\\\s]"),
    "no production class may survive the transform");
});

test("no backslash escape survives into the emulator rules", () => {
  /* The whole failure mode. An escape that reaches the emulator is not
     rejected — it is silently re-read with the backslash removed, so the rule
     keeps loading and means something else. */
  const out = transformRules(PROD);
  assert.ok(!/\\\\/.test(out),
    "a surviving `\\\\` would be mis-parsed by the emulator, not rejected");
});

test("assertEmulatorSafe REJECTS the old \\t\\n\\r transform (regression pin)", () => {
  /* This is the exact string the transform emitted before 2026-08-06. It must
     never again be producible without the build failing. */
  const old = '{"a":{".validate":"x.matches(/^[^@\\\\t\\\\n\\\\r ]+$/)"}}';
  assert.throws(() => assertEmulatorSafe(old), /backslash escape/i);
});

test("assertEmulatorSafe REJECTS an untranslated \\s and names the fix", () => {
  const withS = '{"a":{".validate":"x.matches(/^[^@\\\\s]+$/)"}}';
  let err = null;
  try { assertEmulatorSafe(withS); } catch (e) { err = e; }
  assert.ok(err, "an untranslated class must fail the build, not be emitted");
  assert.match(err.message, /CLASS_SUBSTITUTIONS/,
    "the message must say where to add the translation");
  assert.match(err.message, /probe/i,
    "and that the replacement is to be probed, not reasoned about — two " +
    "earlier attempts to shortcut this by reasoning were wrong");
});

test("assertEmulatorSafe passes clean rules", () => {
  assert.doesNotThrow(() => assertEmulatorSafe(
    '{"a":{".validate":"x.matches(/^[!-?A-~]+@[!-?A-~]+[.][!-?A-~]+$/)"}}'));
});

test("each substitution is STRICTLY TIGHTER than the class it replaces", () => {
  /* The direction of the divergence is the safety property. Every value the
     EMULATOR accepts must be one production accepts, so an emulator ALLOW is
     sound evidence about production. The converse is not claimed: `[!-~]` also
     rejects non-ASCII, which production's `[^\s]` admits — so an emulator
     DENIAL of a non-ASCII payload proves nothing about production, and no test
     may read it as if it did.

     Evaluated with JS RegExp, which is NOT the emulator's engine — this pins
     the INTENT of the table. That the emulator honours the replacement is
     proved by the emulator suite, not here. */
  const PAIRS = [
    { prod: /^[^@\s]$/, emu: /^[!-?A-~]$/ },
    { prod: /^[^\s]$/,  emu: /^[!-~]$/ }
  ];
  const chars = [];
  for (let i = 0; i < 0x100; i++) chars.push(String.fromCharCode(i));
  chars.push("é", "ï", "→", "　" /* ideographic space */);

  for (const { prod, emu } of PAIRS) {
    for (const c of chars) {
      if (emu.test(c)) {
        assert.ok(prod.test(c),
          "emulator class " + emu + " accepts " + JSON.stringify(c) +
          " but production class " + prod + " does not — the divergence must " +
          "only ever run the other way");
      }
    }
    // And it must actually exclude the whitespace the production class excludes.
    for (const ws of [" ", "\t", "\n", "\r", "\f", "\v"]) {
      assert.ok(!emu.test(ws),
        emu + " must exclude " + JSON.stringify(ws) + " — admitting a newline " +
        "is the header-injection shape the mail validator exists to block");
    }
  }
});

test("the substitution table keys on the WHOLE class, never on a bare \\s", () => {
  /* `\s` as a standalone atom (`\s+`) means the opposite of `[^\s]`, so a
     bare-token replace would invert any future rule that used one. */
  for (const { from } of CLASS_SUBSTITUTIONS) {
    assert.ok(from.startsWith("[") && from.endsWith("]"),
      "substitution key " + JSON.stringify(from) + " must be a full class");
  }
});

test("sim-with-emulator delegates the transform instead of copying it", () => {
  /* There were two copies. build-emulator-rules.js is what `npm run
     test:e2e:rules` uses and sim-with-emulator.js is what `npm run
     sim:emulator` uses, so a divergence means the two suites run different
     rules while both report on "the rules". */
  const SIM = fs.readFileSync(
    path.resolve(__dirname, "..", "scripts", "sim", "sim-with-emulator.js"), "utf8");
  assert.match(SIM, /require\("\.\/build-emulator-rules\.js"\)/,
    "sim-with-emulator must import the shared transform");
  assert.ok(!/\.replace\(\/\\\\\\\\s\//.test(SIM),
    "sim-with-emulator must not carry its own \\s replace");
});
