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

  test(`${key}: the guard is not vacuous — EVERY source states it`, () => {
    /* Per source, not a total. A total lets one file go silent while the others
       carry the count: drop HF_MODEL from CLAUDE.md and a `>= 2` check still
       passes, so the doc stops stating the deployed model and nothing complains
       — the exact failure this file exists to catch. Each source is a place an
       operator reads, so each must answer the question. */
    for (const [label, src] of SOURCES) {
      assert.ok(assignments(src, key).length > 0,
        `${label} no longer states ${key}=… — a source that goes silent cannot go stale, ` +
        "but it also stops telling operators which model is deployed");
    }
  });
}

/* The README tells operators these values are the same as the code defaults, so
   omitting them is a no-op. That sentence is only true while it is true. */
test("the code defaults are what the README claims operators can safely omit", () => {
  assert.strictEqual(codeDefault("HF_DEFAULT_MODEL"), "Qwen/Qwen3.5-9B");
  assert.strictEqual(codeDefault("HF_DEFAULT_MODEL_JA"), "Qwen/Qwen3.5-9B");
  assert.match(README, /defineString` defaults baked into `index\.js`/,
    "the README must keep explaining that these mirror the code defaults");
});

/* HF_PROVIDER (2026-08-20) is under the same lockstep, and matters MORE than the
 * model names: it is a data-residency control. Unpinned, the HF router picks an
 * inference provider per request, so the recipient of a participant's free-text
 * clinical chat varies turn to turn and cannot be named in the DPA at all.
 *
 * The sentinel is hardcoded ON PURPOSE. Deriving it from index.js would make
 * this test agree with whatever the code says, including "" — which is exactly
 * the regression worth catching, because it is INVISIBLE: the chat keeps working
 * flawlessly while the data goes somewhere undocumented. Changing the pin should
 * require changing this line, and changing this line should mean re-reading the
 * DPA transfer table. */
test("HF_PROVIDER is pinned, and pinned to the jurisdiction the DPA claims", () => {
  const provider = codeDefault("HF_DEFAULT_PROVIDER");
  assert.strictEqual(provider, "ovhcloud",
    "the pinned provider changed — Annex IV of the DPA names the recipient and " +
    "its jurisdiction, so update the transfer table in the same change");
  assert.notStrictEqual(provider, "",
    "an empty pin restores router 'auto': the recipient becomes unassessable");

  // The .env template is copy-pasted into a real .env, so a stale value here
  // silently deploys an UNPINNED function.
  const envPin = assignments(ENV_EXAMPLE, "HF_PROVIDER");
  assert.deepStrictEqual(envPin, [provider],
    ".env.example must pin the same provider as the code default");
});

/* The pin and the model are only correct TOGETHER: a model the pinned provider
 * does not serve makes every call fail, and the bridge treats any failure as
 * "backend unavailable" and falls back to the stub patient — silently. That is
 * the exact shape of the 9-day hfPatient outage (#311). */
test("the pinned provider actually serves the default models (recorded evidence)", () => {
  const models = new Set([codeDefault("HF_DEFAULT_MODEL"), codeDefault("HF_DEFAULT_MODEL_JA")]);
  // Verified 2026-08-20 against
  //   https://huggingface.co/api/models/Qwen/Qwen3.5-9B?expand[]=inferenceProviderMapping
  // which listed ovhcloud with status "live". This cannot be re-checked offline,
  // so it is recorded rather than queried — but a model change forces a reader
  // past this note, which is the point.
  const VERIFIED = { "Qwen/Qwen3.5-9B": ["ovhcloud", "together", "featherless-ai", "deepinfra"] };
  for (const m of models) {
    assert.ok(VERIFIED[m],
      "default model " + m + " has no recorded provider check — confirm it is live " +
      "on the pinned provider and record it here");
    assert.ok(VERIFIED[m].includes(codeDefault("HF_DEFAULT_PROVIDER")),
      m + " is not served by the pinned provider — every call would 404 and the " +
      "chat would degrade silently to the stub patient");
  }
});
