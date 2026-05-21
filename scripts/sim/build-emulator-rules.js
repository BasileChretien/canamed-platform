#!/usr/bin/env node
/* scripts/sim/build-emulator-rules.js
 *
 * Writes the emulator-compatible copies of the production Firebase config:
 *   - database.rules.emulator.json  (rules with the `\s` regex workaround)
 *   - firebase.emulator.json        (firebase.json pointing at those rules)
 *
 * Why: the production database.rules.json uses `\\s` inside RegExp literals
 * (`[^\\s]+` for "non-whitespace"). Real Firebase RTDB accepts this; the
 * local emulator's stricter regex parser rejects it ("Illegal regular
 * expression, 'whitespacechar' not found"). We emit an emulator-only copy
 * that swaps `\\s` for an explicit whitespace class. Production rules are
 * NOT modified.
 *
 * This is the same transform sim-with-emulator.js applies inline, factored
 * out so the CI rules-e2e job can prepare the emulator inputs before
 * `firebase emulators:exec` boots the emulator. Both output files are
 * gitignored (they're generated build artefacts).
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

function buildEmulatorRules() {
  // Swap the JSON-escaped \s (stored as the two-char sequence \\s) for the
  // JSON-escaped explicit whitespace class \t\n\r + a literal space.
  const src = fs.readFileSync(RULES_PROD, "utf8");
  const patched = src.replace(/\\\\s/g, () => "\\\\t\\\\n\\\\r ");
  // Sanity: the patched rules must still be valid JSON.
  JSON.parse(patched);
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

module.exports = { buildEmulatorRules, RULES_EMU, FIREBASE_CONFIG_EMU };
