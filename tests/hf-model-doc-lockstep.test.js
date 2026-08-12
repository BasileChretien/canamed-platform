"use strict";
/* tests/hf-model-doc-lockstep.test.js
 *
 * The HF model names are stated in FOUR places that must agree:
 *   - functions/index.js        HF_DEFAULT_MODEL / HF_DEFAULT_MODEL_JA (the truth)
 *   - functions/.env.example    the template operators copy
 *   - functions/README.md       the ".env file" setup block operators copy-paste
 *   - CLAUDE.md                 item 4's record of the deployed config
 *
 * CLAUDE.md and the README both said `mistralai/Mistral-7B-Instruct-v0.3` while
 * the code default and the live deployment used `meta-llama/Llama-3.1-8B-Instruct`
 * (found 2026-08-12). The README one is the dangerous copy: it is a setup
 * instruction, so following it deploys a DIFFERENT model than the code default
 * — silently, since any valid HF model id just works.
 *
 * Only CONFIG ASSIGNMENTS (`HF_MODEL=...`) are checked. Prose that names Mistral
 * as the historical choice, as a free-tier example, or as a chat-completion
 * FORMAT ("OpenAI/Mistral/HF format") is legitimate and deliberately untouched —
 * pinning those would make the honest history unwritable.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FN = path.join(ROOT, "docs", "Third_session", "PBL_platform", "functions");
const read = p => fs.readFileSync(p, "utf8");

const INDEX = read(path.join(FN, "index.js"));
const ENV_EXAMPLE = read(path.join(FN, ".env.example"));
const README = read(path.join(FN, "README.md"));
const CLAUDE_MD = read(path.join(ROOT, "CLAUDE.md"));

/* The truth: the defaults baked into the function. */
function codeDefault(constName) {
  const m = INDEX.match(new RegExp("const " + constName + "\\s*=\\s*\"([^\"]+)\""));
  assert.ok(m, `index.js must define ${constName}`);
  return m[1];
}

/* Every `HF_MODEL=<value>` / `HF_MODEL_JA=<value>` assignment in a doc, wherever
   it appears (fenced block, .env template, or inline in backticks). */
function assignments(src, key) {
  const re = new RegExp("\\b" + key + "=([^\\s`\"',]+)", "g");
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const SOURCES = [
  [".env.example", ENV_EXAMPLE],
  ["functions/README.md", README],
  ["CLAUDE.md", CLAUDE_MD]
];

for (const [key, constName] of [["HF_MODEL", "HF_DEFAULT_MODEL"],
                                ["HF_MODEL_JA", "HF_DEFAULT_MODEL_JA"]]) {
  const expected = codeDefault(constName);

  test(`${key}: every documented assignment matches ${constName}`, () => {
    for (const [label, src] of SOURCES) {
      for (const got of assignments(src, key)) {
        assert.strictEqual(got, expected,
          `${label} sets ${key}=${got}, but index.js ${constName} is ${expected} — ` +
          "a stale setup snippet silently deploys a different model");
      }
    }
  });

  test(`${key}: the guard is not vacuous — the docs DO state it`, () => {
    // If a rename made the assignments disappear, the loop above would pass
    // over an empty list and prove nothing.
    const total = SOURCES.reduce((n, [, src]) => n + assignments(src, key).length, 0);
    assert.ok(total >= 2, `expected ${key} to be documented in at least 2 places, found ${total}`);
  });
}

/* The README tells operators these values are the same as the code defaults, so
   omitting them is a no-op. That sentence is only true while it is true. */
test("the code defaults are what the README claims operators can safely omit", () => {
  assert.strictEqual(codeDefault("HF_DEFAULT_MODEL"), "meta-llama/Llama-3.1-8B-Instruct");
  assert.strictEqual(codeDefault("HF_DEFAULT_MODEL_JA"), "Qwen/Qwen2.5-7B-Instruct");
  assert.match(README, /defineString` defaults baked into `index\.js`/,
    "the README must keep explaining that these mirror the code defaults");
});
