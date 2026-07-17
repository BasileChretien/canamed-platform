/* tests/js-syntax.test.js
 *
 * Every platform JS file must parse. A SyntaxError in script.js does not
 * throw anywhere visible — the browser silently skips the whole file, the
 * page renders, Firebase SDKs load, but MODE/initializeApp never run, and
 * the only symptom is every emulator/e2e test timing out at waitForUid
 * (~20 wasted minutes per run; cost several runs on 2026-07-17). The rest
 * of the unit suite reads these files as TEXT, so nothing else catches a
 * parse error. This is the cheap guard: node --check each shipped file.
 */
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

const files = fs.readdirSync(PLATFORM)
  .filter(f => f.endsWith(".js") && !f.endsWith(".min.js"))
  // vendored/compat bundles are minified or externally owned; locales are
  // plain object literals but cheap to include, so they stay in.
  .filter(f => !/^firebase-.*-compat\.js$/.test(f) && f !== "qrcode.js")
  .concat(fs.readdirSync(path.join(PLATFORM, "locales")).map(f => path.join("locales", f)))
  .filter(f => f.endsWith(".js"));

for (const f of files) {
  test(`syntax: ${f} parses (node --check)`, () => {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["--check", path.join(PLATFORM, f)], { stdio: "pipe" });
    }, `${f} has a syntax error — the browser will silently drop the ENTIRE file`);
  });
}
