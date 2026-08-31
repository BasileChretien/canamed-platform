/* proxy-build.test.js
 *
 * The deployment package is the thing that actually runs in production, and it
 * is NOT the same shape as the source tree. Two differences make it possible
 * for the repo's own tests to be entirely green while the deployed function is
 * dead on arrival:
 *
 *   1. `src/handler.js` imports hf-helpers.js from OUTSIDE proxy/, so a zip of
 *      proxy/ alone does not contain it.
 *   2. hf-helpers.js is CommonJS. In the repo it sits under a package.json with
 *      no "type" and imports fine; vendored next to the ESM core it would be
 *      parsed as ESM and throw "does not provide an export named 'default'" at
 *      load — which the client reports as the stub patient, silently.
 *
 * Both were real: (2) was only found by RUNNING the built package. So this
 * builds it and exercises it, rather than inspecting it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "proxy", "build-package.cjs");
const DIST = path.join(ROOT, "proxy", "dist");

function build() {
  execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: "pipe" });
}

test.before(build);

test("the built package is self-contained — no path escapes its own root", () => {
  /* A surviving `../../docs/...` specifier is the exact failure mode: it
   * resolves in the repo and does not exist in the zip. */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const files = walk(DIST).filter((f) => /\.(js|cjs|mjs)$/.test(f));
  assert.ok(files.length >= 5, "expected the core plus the adapter, got " + files.length);

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const specifiers = [...src.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      if (!spec.startsWith(".")) continue;              // bare = node builtin/dep
      assert.ok(!spec.includes("../.."),
        `${path.relative(DIST, f)} still imports ${spec}, which does not exist inside the package`);
      const resolved = path.resolve(path.dirname(f), spec);
      assert.ok(fs.existsSync(resolved),
        `${path.relative(DIST, f)} imports ${spec}, which is missing from the package`);
    }
  }
});

test("the vendored helper is byte-identical to the canonical file", () => {
  /* Vendoring is only safe while the copy is reproduced from source on every
   * build. A drifted copy would mean the deployed prompt guard, HF_URL
   * allowlist and roomOf comparison differ from the ones under test. */
  const canonical = fs.readFileSync(
    path.join(ROOT, "docs", "Third_session", "PBL_platform", "functions", "lib", "hf-helpers.js"));
  const vendored = fs.readFileSync(path.join(DIST, "core", "hf-helpers.cjs"));
  assert.deepEqual(vendored, canonical,
    "dist/core/hf-helpers.cjs has drifted from functions/lib/hf-helpers.js");
});

test("the vendored helper keeps a .cjs extension", () => {
  /* Not cosmetic. dist/core/package.json says "type": "module", so the SAME
   * CommonJS file named .js would be parsed as ESM and the function would die
   * at load — reported to the room as the stub patient, with no error anywhere
   * a facilitator would see. */
  assert.ok(fs.existsSync(path.join(DIST, "core", "hf-helpers.cjs")));
  assert.ok(!fs.existsSync(path.join(DIST, "core", "hf-helpers.js")),
    "a .js copy would be parsed as ESM by the core's package.json");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(DIST, "core", "package.json"), "utf8")).type, "module");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(DIST, "package.json"), "utf8")).type, "commonjs",
    "the root must be CommonJS so Scaleway finds module.exports.handle");
});

test("THE BUILT PACKAGE ACTUALLY RUNS", async () => {
  /* The point of the file. Everything above inspects; this loads the artifact
   * exactly as Scaleway will and drives real requests through it. */
  const entry = path.join(DIST, "handler.js");
  const { handle } = require(entry);
  assert.equal(typeof handle, "function", "Scaleway looks for module.exports.handle");

  const saved = { ...process.env };
  Object.assign(process.env, {
    MODA_LLM_ENABLED: "true",
    ALLOWED_ORIGINS: "https://canamed-69785.web.app",
    FIREBASE_PROJECT_ID: "canamed-69785",
    RTDB_URL: "https://rtdb.example.invalid",
    HF_TOKEN: "t"
  });

  const ev = (over) => Object.assign({
    httpMethod: "POST",
    path: "/",
    headers: {
      "content-type": "application/json",
      host: "fn.example",
      origin: "https://canamed-69785.web.app"
    },
    body: JSON.stringify({ data: {} }),
    isBase64Encoded: false
  }, over || {});

  try {
    // Reaches the handler's own auth check → the whole import chain loaded.
    const unauth = await handle(ev(), {}, null);
    assert.equal(unauth.statusCode, 401, unauth.body);
    assert.equal(JSON.parse(unauth.body).error.message, "auth required");
    assert.equal(unauth.headers["access-control-allow-origin"], "https://canamed-69785.web.app");

    // Preflight and origin allowlist survive the packaging.
    assert.equal((await handle(ev({ httpMethod: "OPTIONS", body: undefined }), {}, null)).statusCode, 204);
    const evil = await handle(ev({ headers: { "content-type": "application/json", host: "f", origin: "https://evil.example" } }), {}, null);
    assert.equal(evil.statusCode, 403);

    // And the config guard, so a misconfigured deploy is loud.
    process.env.RTDB_URL = "http://rtdb.example.invalid";
    const plaintext = await handle(ev(), {}, null);
    assert.equal(plaintext.statusCode, 500);
    assert.equal(JSON.parse(plaintext.body).result.error, "proxy misconfigured");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("the build fails loudly if an import specifier it rewrites moves", () => {
  /* The build does two string substitutions. If either target changes and the
   * build silently no-ops, the package is broken in a way only a deploy would
   * reveal — so the build throws instead. This pins that it still throws. */
  const src = fs.readFileSync(BUILD, "utf8");
  assert.match(src, /update build-package\.cjs in the same change/);
  const handler = fs.readFileSync(path.join(ROOT, "proxy", "src", "handler.js"), "utf8");
  assert.ok(handler.includes('"../../docs/Third_session/PBL_platform/functions/lib/hf-helpers.js"'),
    "src/handler.js's helper import moved — build-package.cjs pins this exact specifier");
  const adapter = fs.readFileSync(path.join(ROOT, "proxy", "scaleway", "handler.js"), "utf8");
  assert.ok(adapter.includes('"../src/handler.js"'),
    "scaleway/handler.js's core import moved — build-package.cjs pins this exact specifier");
});
