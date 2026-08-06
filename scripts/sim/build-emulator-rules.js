#!/usr/bin/env node
/* scripts/sim/build-emulator-rules.js
 *
 * Writes the emulator-compatible copies of the production Firebase config:
 *   - database.rules.emulator.json  (rules with the `\s` classes rewritten)
 *   - firebase.emulator.json        (firebase.json pointing at those rules)
 *
 * Why: the production database.rules.json uses `\s` inside RegExp literals
 * (`[^@\s]` = "non-whitespace, not @"; `[^\s]` = "non-whitespace"). Real
 * Firebase RTDB accepts this — the rules deploy compiles. The local emulator's
 * regex parser does NOT: it fails at rules-LOAD time with
 *
 *     Illegal regular expression, 'whitespacechar' not found
 *
 * so the whole file is rejected and no rules load at all. `\S` fails the same
 * way. An emulator-only copy is therefore unavoidable; production rules are
 * NOT modified.
 *
 * ── WHAT THE OLD TRANSFORM DID, AND WHY IT WAS WORSE THAN NO TRANSFORM ──
 *
 * Until 2026-08-06 this file rewrote `\s` to `\t\n\r ` — an "explicit
 * whitespace class". That LOADS, which is why it went unnoticed for months,
 * but it is semantically wrong: **the emulator's regex parser does not honour
 * backslash escapes inside a character class — it simply drops the
 * backslash.** Probed directly against the emulator (round-trip REST writes
 * against `.validate`-guarded probe nodes):
 *
 *   /^[^\t]+$/   denies "ttt"     ← the LETTER t is excluded
 *                allows "a<TAB>b" ← a real TAB is NOT excluded
 *   /^[^\x09]+$/ denies "v@example.test"  ← `\x` is likewise x, 0, 9
 *
 * So `[^@\t\n\r ]` actually meant "not @, not t, not n, not r, not space".
 * It banned the letters t/n/r from every address while letting real tabs and
 * newlines through — i.e. it inverted the validator. The consequence was a
 * FALSE GREEN: `sessions/$id/mail/$mailId` could not be satisfied by ANY
 * realistic address under the emulator, so the open-relay test in
 * tests-e2e/emulator/rules-smoke.spec.js passed on a denial the admin gate had
 * nothing to do with. It would have passed with the gate deleted.
 *
 * ── WHAT THE EMULATOR ACTUALLY HONOURS ──
 *
 * Probed, not reasoned. Of the forms tried, only two express "no whitespace"
 * in a way the emulator both loads and honours:
 *
 *   [!-~]      printable ASCII, 0x21–0x7E — excludes space, TAB, CR, LF, every
 *              other control char, DEL and all non-ASCII. HONOURED.
 *   [!-?A-~]   the same minus `@` (0x40), as two ranges.        HONOURED.
 *
 * Rejected by probe: `\s`/`\S` (load error), `\t\n\r ` (letters, see above),
 * `\x00-\x20` (matches nothing — `\x` is x/0/2), `[:space:]` POSIX bracket
 * expressions (match nothing), `[^@ ]` and `[^ ]` (exclude only the space, so
 * a TAB or a NEWLINE inside an address or URL still validates — precisely the
 * header-injection shape the rule exists to block).
 *
 * A literal TAB inside the class does work, but a literal newline cannot be
 * expressed at all: the parser ends a regex literal at end-of-line and reports
 * "unterminated regular expression literal". Since newline is the whitespace
 * character that matters most here, the printable-range form is the one used.
 *
 * ── THE DIRECTION OF THE REMAINING DIVERGENCE ──
 *
 * `[!-~]` is STRICTLY TIGHTER than `[^\s]`: it additionally rejects non-ASCII
 * and control characters. Every value the EMULATOR accepts, production accepts
 * too — so an emulator test that asserts ALLOW is sound. The converse does not
 * hold: an emulator DENIAL of a non-ASCII payload would not prove production
 * denies it. No test uses one; if one ever does, it must not read that denial
 * as a production guarantee. Tighter is the safe direction to be wrong in for
 * a test harness, which is why it was chosen over `[^@ ]`.
 *
 * (Production's own reading of `\s` is not verifiable from here — it would
 * take a deploy plus a live write. The emulator's error message names the
 * class it cannot find, i.e. its parser recognises `\s` as a named class and
 * lacks the entry; a complete registry resolving it is the natural reading,
 * and it is what the rule was written for. It is not proof.)
 *
 * ── FAIL LOUD ──
 *
 * The old transform was a blind global replace, so an unsupported construct
 * arriving in the rules later would have been silently mistranslated the same
 * way. assertEmulatorSafe() now rejects ANY backslash escape surviving in the
 * emitted rules, because inside a character class the emulator drops it and
 * changes the meaning without erroring. Adding a new escape to
 * database.rules.json now breaks this build with a message, instead of
 * quietly disarming whichever rule contains it.
 *
 * Usage:  node scripts/sim/build-emulator-rules.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const PLATFORM_DIR = path.resolve(__dirname, "..", "..",
  "docs", "Third_session", "PBL_platform");
const FIREBASE_CONFIG     = path.join(PLATFORM_DIR, "firebase.json");
const RULES_PROD          = path.join(PLATFORM_DIR, "database.rules.json");
const RULES_EMU           = path.join(PLATFORM_DIR, "database.rules.emulator.json");
const FIREBASE_CONFIG_EMU = path.join(PLATFORM_DIR, "firebase.emulator.json");

/* Whole-CLASS substitutions, applied to the FILE TEXT (where a rules-level
 * backslash is stored JSON-escaped, i.e. as the two characters `\\`).
 *
 * Deliberately keyed on the entire character class rather than on the bare
 * `\s`, because the replacement is only correct in a NEGATED class. `\s` used
 * as a standalone atom (`\s+`) means the opposite, and a bare-token replace
 * would invert it. Anything not listed here trips assertEmulatorSafe().
 */
const CLASS_SUBSTITUTIONS = [
  // "non-whitespace, not @" — the mail `to` validator's three parts.
  { from: "[^@\\\\s]", to: "[!-?A-~]" },
  // "non-whitespace" — the https:// link validators.
  { from: "[^\\\\s]", to: "[!-~]" }
];

/* Reject anything the emulator would mis-parse instead of reject.
 *
 * A surviving `\\` in the file text is a rules-level backslash escape. Inside
 * a character class the emulator drops it (see the header), so the rule keeps
 * loading while meaning something else — the exact failure this file exists to
 * prevent. Fail the build and name the offender.
 */
function assertEmulatorSafe(text) {
  const offenders = [];
  const re = /\\\\./g;
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split("\n").length;
    offenders.push("  line " + line + ": " + JSON.stringify(m[0]) + "  …" +
      text.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\n/g, " ") + "…");
  }
  if (!offenders.length) return;
  throw new Error(
    "build-emulator-rules: database.rules.json contains " + offenders.length +
    " backslash escape(s) with no emulator translation:\n" +
    offenders.join("\n") + "\n\n" +
    "The RTDB emulator does NOT honour backslash escapes inside a character\n" +
    "class — it drops the backslash, so `[^\\t]` excludes the LETTER t and\n" +
    "admits a real TAB. Such a rule loads and silently means something else,\n" +
    "which is how the mail validator became unsatisfiable while its security\n" +
    "test still passed.\n\n" +
    "Fix by adding a whole-class entry to CLASS_SUBSTITUTIONS in this file\n" +
    "(probe the replacement against the emulator first — do not reason about\n" +
    "it), or by rewriting the rule in database.rules.json to use an explicit\n" +
    "range such as [!-~], which both parsers honour identically.");
}

function transformRules(src) {
  let out = src;
  for (const { from, to } of CLASS_SUBSTITUTIONS) out = out.split(from).join(to);
  assertEmulatorSafe(out);
  // Sanity: the patched rules must still be valid JSON.
  JSON.parse(out);
  return out;
}

function buildEmulatorRules() {
  const patched = transformRules(fs.readFileSync(RULES_PROD, "utf8"));
  fs.writeFileSync(RULES_EMU, patched, "utf8");

  // Companion firebase.json that points at the patched rules. Keep the
  // emulators{} block (ports) intact so `firebase emulators:exec` binds
  // the DB on 9000 + Auth on 9099 (matching the test fixture's pins).
  const cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG, "utf8"));
  if (cfg.database) cfg.database.rules = "database.rules.emulator.json";
  fs.writeFileSync(FIREBASE_CONFIG_EMU, JSON.stringify(cfg, null, 2), "utf8");

  return { RULES_EMU, FIREBASE_CONFIG_EMU };
}

if (require.main === module) {
  const out = buildEmulatorRules();
  console.log("Wrote emulator rules:\n  " + out.RULES_EMU +
    "\n  " + out.FIREBASE_CONFIG_EMU);
}

module.exports = {
  buildEmulatorRules, transformRules, assertEmulatorSafe,
  CLASS_SUBSTITUTIONS, RULES_EMU, FIREBASE_CONFIG_EMU
};
