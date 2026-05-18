#!/usr/bin/env node
/* scripts/i18n-coverage-report.js
 *
 * Language-coverage linter for case-content.js, written for Pr. Müller's
 * R3 systemic-i18n finding: clinical scenario content is wrapped as
 * { en, fr, ja, ... } translation triplets, but a new partnership (e.g.
 * Berlin-Tokyo) would need a German translation pass and there is no
 * way to see what percent of the surface is actually covered.
 *
 * What it does
 * ------------
 * 1. Loads docs/Third_session/PBL_platform/case-content.js (as a script,
 *    Node-style — the file declares `var CASE = ...` and ends with
 *    `window.CANAMED_SCENARIOS = { ... }`). We provide a stub `window`
 *    so the assignments land somewhere we can read.
 * 2. Walks every value in CANAMED_SCENARIOS and counts, per scenario and
 *    per language, how many translatable string values are non-empty.
 *    A "translatable string" is detected as an object whose keys are a
 *    SUBSET of the known language codes — same heuristic the runtime
 *    `tc()` accessor uses.
 * 3. Prints a Markdown-ish report to stdout AND emits a structured JSON
 *    object via --json if asked.
 * 4. Exits 0 by default (advisory). With --fail-below=<n> + --language=<lang>
 *    it exits 1 if that language's coverage is below the threshold —
 *    intended for CI gating once a language is officially supported.
 *
 * Usage
 * -----
 *   node scripts/i18n-coverage-report.js
 *   node scripts/i18n-coverage-report.js --json
 *   node scripts/i18n-coverage-report.js --language=de --fail-below=80
 *   node scripts/i18n-coverage-report.js --file=path/to/scenarios.js
 *
 * No third-party dependencies — uses only Node built-ins.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SUPPORTED = ["en", "fr", "ja", "es", "pt", "de", "ko", "zh"];

// -------- argv parsing (tiny, no yargs) --------
function parseArgs(argv) {
  const out = { json: false, language: null, failBelow: null, file: null };
  for (const a of argv.slice(2)) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--language=")) out.language = a.slice("--language=".length);
    else if (a.startsWith("--fail-below=")) out.failBelow = parseFloat(a.slice("--fail-below=".length));
    else if (a.startsWith("--file=")) out.file = a.slice("--file=".length);
  }
  return out;
}

// -------- load scenarios via a sandboxed script eval --------
// case-content.js declares `var CASE = ...` (top-level var binds to the
// vm context's global, which we read back). It ends with
// `window.CANAMED_SCENARIOS = { ... }`; we provide a `window` stub so
// the assignment is captured.
function loadScenarios(scenariosFile) {
  const src = fs.readFileSync(scenariosFile, "utf8");
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: scenariosFile });
  return sandbox.window.CANAMED_SCENARIOS || {};
}

// -------- core walker --------
// A "translatable triplet" = a plain object whose own enumerable keys
// are ALL in the known SUPPORTED set, and at least one key value is a
// string. Anything else is just a container — recurse into it.
function isTranslatable(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  if (keys.length === 0) return false;
  let hasString = false;
  for (const k of keys) {
    if (SUPPORTED.indexOf(k) < 0) return false;       // not all keys are langs
    if (typeof node[k] === "string") hasString = true;
    else if (node[k] != null) return false;            // mixed shape — not a triplet
  }
  return hasString;
}

// Counts per language: for every translatable triplet found, increment
// the denominator (one per triplet), and increment the numerator for
// every language whose value is a non-empty string.
function walk(node, langs, stats) {
  if (node == null) return;
  if (isTranslatable(node)) {
    stats.total += 1;
    for (const l of langs) {
      const v = node[l];
      if (typeof v === "string" && v.length > 0) {
        stats.byLang[l] = (stats.byLang[l] || 0) + 1;
      }
    }
    return;  // do NOT recurse into a triplet — its string children are the leaves
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, langs, stats);
    return;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) walk(node[k], langs, stats);
  }
}

function freshStats() {
  const byLang = {};
  for (const l of SUPPORTED) byLang[l] = 0;
  return { total: 0, byLang };
}

function coveragePercent(num, denom) {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 1000) / 10;  // 1-decimal percentage
}

// -------- main --------
function main() {
  const args = parseArgs(process.argv);
  const scenariosFile = args.file || path.join(
    __dirname, "..", "docs", "Third_session", "PBL_platform", "case-content.js"
  );
  if (!fs.existsSync(scenariosFile)) {
    process.stderr.write("i18n-coverage-report: file not found: " + scenariosFile + "\n");
    process.exit(2);
  }

  const SCENARIOS = loadScenarios(scenariosFile);
  const scenarioIds = Object.keys(SCENARIOS);

  // per-scenario stats
  const perScenario = {};
  const overall = freshStats();
  for (const id of scenarioIds) {
    const s = freshStats();
    walk(SCENARIOS[id], SUPPORTED, s);
    perScenario[id] = s;
    overall.total += s.total;
    for (const l of SUPPORTED) overall.byLang[l] += s.byLang[l];
  }

  const report = {
    file: scenariosFile,
    supported: SUPPORTED,
    scenarios: {},
    overall: {
      triplets: overall.total,
      coverage: {}
    }
  };
  for (const id of scenarioIds) {
    const s = perScenario[id];
    const cov = {};
    for (const l of SUPPORTED) cov[l] = coveragePercent(s.byLang[l], s.total);
    report.scenarios[id] = { triplets: s.total, coverage: cov };
  }
  for (const l of SUPPORTED) {
    report.overall.coverage[l] = coveragePercent(overall.byLang[l], overall.total);
  }

  // ---- output ----
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write("CaNaMED i18n coverage report\n");
    process.stdout.write("============================\n");
    process.stdout.write("Source: " + scenariosFile + "\n");
    process.stdout.write("Translatable triplets: " + overall.total + "\n\n");
    process.stdout.write("Per-scenario coverage:\n");
    for (const id of scenarioIds) {
      const s = report.scenarios[id];
      process.stdout.write("  - " + id + " (" + s.triplets + " triplets)\n");
      for (const l of SUPPORTED) {
        process.stdout.write("      " + l + ": " + s.coverage[l].toFixed(1) + "%\n");
      }
    }
    process.stdout.write("\nOverall:\n");
    for (const l of SUPPORTED) {
      process.stdout.write("  " + l + ": " + report.overall.coverage[l].toFixed(1) + "%\n");
    }
  }

  // ---- optional CI gate ----
  if (args.language && args.failBelow != null) {
    if (SUPPORTED.indexOf(args.language) < 0) {
      process.stderr.write(
        "i18n-coverage-report: --language=" + args.language +
        " is not in SUPPORTED set [" + SUPPORTED.join(", ") + "]\n"
      );
      process.exit(2);
    }
    const actual = report.overall.coverage[args.language];
    if (actual < args.failBelow) {
      process.stderr.write(
        "\ni18n-coverage-report: FAIL — " + args.language +
        " coverage " + actual.toFixed(1) + "% is below threshold " +
        args.failBelow + "%\n"
      );
      process.exit(1);
    } else {
      process.stderr.write(
        "\ni18n-coverage-report: OK — " + args.language +
        " coverage " + actual.toFixed(1) + "% >= threshold " +
        args.failBelow + "%\n"
      );
    }
  }

  process.exit(0);
}

if (require.main === module) main();

// Exported for tests (tests/i18n-coverage.test.js drives these directly
// rather than spawning a subprocess).
module.exports = {
  isTranslatable,
  walk,
  coveragePercent,
  freshStats,
  loadScenarios,
  SUPPORTED
};
