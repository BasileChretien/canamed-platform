/* tests/functions-hygiene.test.js
 *
 * General checks on the Cloud Functions codebase that used to live in
 * tests/email-scaffold.test.js and outlived the email function it was named
 * for (removed 2026-09-24): hfPatient still binds a secret (HF_TOKEN), so the
 * no-hardcoded-credential scan still matters, and firebase.json must keep
 * pointing the deploy at the functions source.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const FUNCS = path.join(P, "functions");
const FB = JSON.parse(fs.readFileSync(path.join(P, "firebase.json"), "utf8"));

const SOURCES = ["index.js"].concat(
  fs.readdirSync(path.join(FUNCS, "lib")).filter(f => f.endsWith(".js")).map(f => path.join("lib", f))
);

test("firebase.json wires the functions source", () => {
  assert.ok(FB.functions, "firebase.json must declare a functions block");
  assert.strictEqual(FB.functions.source, "functions", "functions.source must be \"functions\"");
});

test("no hardcoded password or API key in the functions sources", () => {
  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(FUNCS, rel), "utf8");
    assert.doesNotMatch(src, /pass(word)?\s*[:=]\s*["'][A-Za-z0-9._\-]{12,}["']/i,
      rel + " must not hardcode a password");
    assert.doesNotMatch(src, /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9._\-]{12,}["']/i,
      rel + " must not hardcode an API key");
    assert.doesNotMatch(src, /\bhf_[A-Za-z0-9]{30,}\b/,
      rel + " must not contain a Hugging Face token (it lives in Secret Manager)");
  }
});
