/* tests/modA-llm-lazy-split.test.js
 *
 * UX-overload Phase-2 perf reclaim (2026-06-01): the four Module A LLM-patient
 * scripts (modA-question-scoring / modA-llm-prompts / modA-llm-bridge /
 * modA-llm-init, ~12 KB raw) were SPLIT out of the eager splash bundle. They
 * are gated behind ?llm=1 and dead weight for the ~all non-pilot students, so
 * they now load on demand via CanamedLoader.ensureModALlm(), called by
 * startRoom() ONLY when CanamedLoader.modALLMFlagOn() is true.
 *
 * The one thing that MUST stay eager: the ?llm=1 → localStorage promotion. The
 * join flow strips the query string before startRoom() runs, so the flag has
 * to be persisted on first page load (now hoisted into script-loader.js).
 *
 * These static assertions guard the reclaim against regression (re-adding the
 * eager tags) and the pilot against breakage (losing the eager flag promotion
 * or the flag gate). The functional pilot behaviour is covered by
 * tests-e2e/modA-llm-stub.spec.js + tests/modA-llm-bridge.test.js.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const LOADER = fs.readFileSync(path.join(PLATFORM, "script-loader.js"), "utf8");
const JS = fs.readFileSync(path.join(PLATFORM, "script.js"), "utf8");

const LLM_FILES = [
  "modA-question-scoring.js",
  "modA-llm-prompts.js",
  "modA-llm-bridge.js",
  "modA-llm-init.js",
];

test("the 4 LLM scripts are NOT eagerly loaded in index.html (perf reclaim)", () => {
  for (const f of LLM_FILES) {
    const re = new RegExp('<script[^>]*src="' + f.replace(/\./g, "\\.") + '"');
    assert.doesNotMatch(INDEX, re, f + " must not be an eager <script> tag (it is lazy now)");
  }
});

test("script-loader exposes the lazy LLM API and loads all 4 in order", () => {
  assert.match(LOADER, /function ensureModALlm\(/, "ensureModALlm must exist");
  assert.match(LOADER, /function modALLMFlagOn\(/, "modALLMFlagOn must exist");
  // ensureModALlm chains all four files (order matters: init wires the rest).
  const start = LOADER.indexOf("function ensureModALlm(");
  const body = LOADER.slice(start, LOADER.indexOf("\n  function ", start + 1) + 1 || undefined);
  let lastIdx = -1;
  for (const f of LLM_FILES) {
    const at = body.indexOf(f);
    assert.ok(at > 0, "ensureModALlm must load " + f);
    assert.ok(at > lastIdx, f + " must load after the previous file (document order)");
    lastIdx = at;
  }
  // Exposed on the public namespace.
  assert.match(LOADER, /ensureModALlm\b/);
  assert.match(LOADER, /modALLMFlagOn\b/);
});

test("the ?llm flag is promoted to localStorage EAGERLY (survives the join flow)", () => {
  // This promotion used to live in modA-llm-init.js's IIFE (eager). Now that
  // file is lazy, so the promotion must be hoisted into the eager loader or the
  // pilot flag is lost by the time startRoom() runs.
  assert.match(LOADER, /setItem\("canamedModALLM", "1"\)/,
    "script-loader must persist ?llm=1 to localStorage on first load");
  assert.match(LOADER, /llm.*===\s*"1"/,
    "script-loader must read the ?llm query param");
});

test("startRoom lazy-loads the LLM bundle ONLY when the flag is on", () => {
  const start = JS.slice(JS.indexOf("function startRoom("), JS.indexOf("function joinAdmin("));
  assert.ok(start.length > 0, "startRoom function not found");
  assert.match(start, /modALLMFlagOn\(\)/, "startRoom must gate on the flag before loading");
  assert.match(start, /ensureModALlm\(\)/, "startRoom must lazy-load the bundle when the flag is on");
  assert.match(start, /modALLMInit/, "startRoom must still init after the bundle resolves");
  // The old synchronous eager-assumption call must be gone.
  assert.doesNotMatch(start, /if \(typeof window\.modALLMInit === "function"\) window\.modALLMInit\(\);\s*\n\s*\} catch/,
    "the old unconditional synchronous modALLMInit() call must be replaced by the lazy path");
});
