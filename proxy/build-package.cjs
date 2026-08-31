#!/usr/bin/env node
/* build-package.cjs — assemble a self-contained deployment package.
 *
 * .cjs, not .js: proxy/package.json declares "type": "module", so a .js file
 * here would be parsed as ESM and `require` would throw.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * `src/handler.js` imports the shared pure logic from
 *   ../../docs/Third_session/PBL_platform/functions/lib/hf-helpers.js
 * which is OUTSIDE this directory. That import is deliberate — it is what
 * stops the server-authoritative prompt guard, the HF_URL allowlist and the
 * roomOf comparison drifting between the Cloud Function and the proxy, and a
 * test fails if the proxy ever re-declares them.
 *
 * But it means a zip of `proxy/` alone is NOT deployable: the file simply is
 * not in it, and the function dies at load with MODULE_NOT_FOUND. Zipping from
 * the repo root instead would drag in the whole platform to reach one 227-line
 * file.
 *
 * So the helper is VENDORED AT BUILD TIME, into `dist/` only. There is still
 * exactly one copy in git; the duplicate exists for the length of a deploy and
 * is reproduced from the canonical file every time. `tests/proxy-build.test.js`
 * asserts the copy is byte-identical to the source, so a stale dist cannot be
 * shipped silently.
 *
 * ── WHY THE LAYOUT LOOKS LIKE THIS ───────────────────────────────────────
 * Two module systems have to coexist in one zip. Scaleway's Node runtime
 * expects `module.exports.handle` (CommonJS) at the handler path, while the
 * shared core is ESM. Node picks the module type from the NEAREST package.json,
 * so:
 *
 *   dist/package.json        {"type":"commonjs"}   <- makes handler.js CJS
 *   dist/handler.js          the adapter; dynamic import() reaches the ESM core
 *   dist/core/package.json   {"type":"module"}     <- makes the core ESM
 *   dist/core/*.js           the shared handler, jwt verifier, stores
 *   dist/core/hf-helpers.js  vendored, build output only
 *
 * Putting the handler at the ZIP ROOT also means the Scaleway function's
 * handler setting is just `handler.handle`, with no subdirectory path to get
 * wrong.
 *
 * Usage:  node proxy/build-package.cjs   ->  proxy/dist/  (+ prints next steps)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROXY = __dirname;
const DIST = path.join(PROXY, "dist");
const CORE = path.join(DIST, "core");
const HELPERS_SRC = path.join(
  PROXY, "..", "docs", "Third_session", "PBL_platform", "functions", "lib", "hf-helpers.js");

/* The exact import specifier src/handler.js uses. Pinned here (and asserted by
 * the test) so a change to the layout fails the BUILD rather than producing a
 * package that loads fine locally and dies in production. */
const HELPERS_IMPORT = '"../../docs/Third_session/PBL_platform/functions/lib/hf-helpers.js"';
/* .cjs, and this matters more than it looks. hf-helpers.js is CommonJS
 * (`module.exports = {...}`). In the repo it sits under a package.json with no
 * "type", so Node treats it as CJS and the default import works. Vendored into
 * dist/core/ — whose package.json says "type": "module" — the SAME file would
 * be parsed as ESM, and the function would die at load with "does not provide
 * an export named 'default'". Caught by running the built package rather than
 * by reading it; the .cjs extension pins the module type regardless of the
 * surrounding package.json. */
const HELPERS_VENDORED = '"./hf-helpers.cjs"';

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function build() {
  if (!fs.existsSync(HELPERS_SRC)) {
    throw new Error("cannot find hf-helpers.js at " + HELPERS_SRC);
  }

  rmrf(DIST);
  fs.mkdirSync(CORE, { recursive: true });

  // 1. The CJS shell: root package.json + the Scaleway adapter as handler.js.
  fs.writeFileSync(path.join(DIST, "package.json"), JSON.stringify({
    name: "canamed-hf-patient-proxy",
    version: "1.0.0",
    private: true,
    type: "commonjs",
    main: "handler.js"
  }, null, 2) + "\n");

  const adapter = fs.readFileSync(path.join(PROXY, "scaleway", "handler.js"), "utf8");
  /* The adapter imports "../src/handler.js" in the repo; in the package the
   * core sits at ./core/. One substitution, asserted by the test. */
  const ADAPTER_IMPORT = '"../src/handler.js"';
  if (!adapter.includes(ADAPTER_IMPORT)) {
    throw new Error("scaleway/handler.js no longer imports " + ADAPTER_IMPORT +
      " — update build-package.cjs in the same change");
  }
  fs.writeFileSync(path.join(DIST, "handler.js"),
    adapter.replace(ADAPTER_IMPORT, '"./core/handler.js"'));

  // 2. The ESM core.
  fs.writeFileSync(path.join(CORE, "package.json"), JSON.stringify({
    name: "canamed-hf-patient-proxy-core",
    version: "1.0.0",
    private: true,
    type: "module"
  }, null, 2) + "\n");

  for (const f of ["handler.js", "firebase-jwt.js", "stores.js"]) {
    let code = fs.readFileSync(path.join(PROXY, "src", f), "utf8");
    if (f === "handler.js") {
      if (!code.includes(HELPERS_IMPORT)) {
        throw new Error("src/handler.js no longer imports " + HELPERS_IMPORT +
          " — update build-package.cjs in the same change");
      }
      code = code.replace(HELPERS_IMPORT, HELPERS_VENDORED);
    }
    fs.writeFileSync(path.join(CORE, f), code);
  }

  // 3. The vendored helper — copied verbatim, never edited.
  fs.copyFileSync(HELPERS_SRC, path.join(CORE, "hf-helpers.cjs"));

  return DIST;
}

if (require.main === module) {
  const out = build();
  const rel = path.relative(process.cwd(), out);
  console.log("Built deployment package: " + rel);
  console.log("");
  console.log("Contents:");
  for (const f of fs.readdirSync(out)) {
    const p = path.join(out, f);
    if (fs.statSync(p).isDirectory()) {
      for (const g of fs.readdirSync(p)) console.log("  " + f + "/" + g);
    } else {
      console.log("  " + f);
    }
  }
  console.log("");
  console.log("Next:");
  console.log("  cd " + rel + " && zip -r ../hf-patient-proxy.zip .");
  console.log("  Scaleway function: runtime node22, handler `handler.handle`, region fr-par");
  console.log("  See proxy/README.md for the variables and the required HF spend limit.");
}

module.exports = { build, DIST, CORE, HELPERS_SRC, HELPERS_IMPORT };
