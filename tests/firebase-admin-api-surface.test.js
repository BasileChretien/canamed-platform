/* tests/firebase-admin-api-surface.test.js
 *
 * The four ops scripts (backup-sessions, cleanup-stale-sessions,
 * firebase-cost-monitor, pseudonymise-export) run ONLY on their nightly cron.
 * No CI job executes them. A dependency change can therefore be fully green on
 * a PR and still break every one of them, surfacing as a 03:00 failure email
 * nobody is watching — the outage shape #316 existed to end.
 *
 * #316 claimed such a change was something "CI gets to reject". It wasn't:
 * nothing required firebase-admin, so no check existed to do the rejecting.
 * #324 added this file to make that true. Dependabot #320 (13.10.0 -> 14.2.0)
 * was the live example — v14 removes the namespaced accessors:
 *
 *     v14  admin.initializeApp   function
 *     v14  admin.database        undefined
 *     v14  admin.storage         undefined
 *
 * The scripts have since MOVED to the modular API (this PR), which v13 and v14
 * both expose identically — verified against real installs of each:
 *
 *     firebase-admin/app       initializeApp   v13 function / v14 function
 *     firebase-admin/database  getDatabase     v13 function / v14 function
 *     firebase-admin/storage   getStorage      v13 function / v14 function
 *
 * so the code is now version-agnostic across that boundary. This file tracks
 * the NEW shape: it derives which `firebase-admin/<sub>` entry points the
 * scripts import, and which names they destructure, then asserts the installed
 * package actually exports them.
 *
 * NOTE for whoever changes this next: #324's version of this file scanned for
 * `admin.<member>` and hardcoded ["initializeApp","database","storage"] as its
 * anti-vacuity sentinel. Its header claimed the list "follows automatically"
 * when the scripts migrate. The DERIVED list does; the sentinel did not, and
 * this migration duly broke it. The sentinel below has the same property —
 * it is a deliberate tripwire, so update it in the same change that moves the
 * scripts off these entry points.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");

/** The installed firebase-admin version, for the failure message.
 *  Read from disk, NOT via require("firebase-admin/package.json"): the package
 *  does not export that subpath, so requiring it throws
 *  ERR_PACKAGE_PATH_NOT_EXPORTED and the assertion message becomes a crash. */
function installedVersion() {
  try {
    const p = path.join(ROOT, "node_modules", "firebase-admin", "package.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).version;
  } catch {
    return "(version unreadable)";
  }
}

function jsFilesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      out.push(...jsFilesUnder(p));
    } else if (e.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

/** Map of "firebase-admin/<sub>" -> { names:Set, files:[] }, derived from
 *  `const { a, b } = require("firebase-admin/sub")` in scripts/. */
function entryPointsUsedByScripts() {
  const used = new Map();
  const re = /const\s*\{([^}]*)\}\s*=\s*require\(\s*["'](firebase-admin\/[a-z-]+)["']\s*\)/g;
  for (const file of jsFilesUnder(SCRIPTS)) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const m of src.matchAll(re)) {
      const names = m[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean);
      if (!used.has(m[2])) used.set(m[2], { names: new Set(), files: [] });
      const e = used.get(m[2]);
      names.forEach((n) => e.names.add(n));
      if (!e.files.includes(rel)) e.files.push(rel);
    }
  }
  return used;
}

test("the scan finds the firebase-admin entry points it is supposed to guard", () => {
  /* Anti-vacuity tripwire. Without it, a broken walker or regex would make the
     assertions below pass loudest exactly when they had stopped looking —
     which is how two separate checks in this repo reported success while
     measuring nothing. Deliberately hardcoded: update it in the same change
     that moves the scripts off these entry points. */
  const used = entryPointsUsedByScripts();
  const expected = {
    "firebase-admin/app": "initializeApp",
    "firebase-admin/database": "getDatabase",
    "firebase-admin/storage": "getStorage",
  };
  for (const [mod, fn] of Object.entries(expected)) {
    assert.ok(used.has(mod),
      "scan found no import of " + mod + " under scripts/ — the walker or the " +
      "regex is broken, not the dependency (found: " +
      [...used.keys()].join(", ") + ")");
    assert.ok(used.get(mod).names.has(fn),
      mod + " is imported but " + fn + " was not among the destructured names (" +
      [...used.get(mod).names].join(", ") + ")");
  }
});

test("the installed firebase-admin exports every modular entry point the ops scripts import", () => {
  const used = entryPointsUsedByScripts();
  const missing = [];
  for (const [mod, { names, files }] of used) {
    let m;
    try {
      m = require(mod);
    } catch (e) {
      missing.push(mod + " — require failed: " + (e.code || e.message) +
                   "  <- " + files.join(", "));
      continue;
    }
    for (const n of names) {
      if (typeof m[n] !== "function") {
        missing.push(mod + "." + n + " is " + typeof m[n] + "  <- " + files.join(", "));
      }
    }
  }
  assert.deepStrictEqual(missing, [],
    "firebase-admin " + installedVersion() +
    " does not export what the ops scripts import:\n  " + missing.join("\n  ") +
    "\n\nThose scripts run only on their nightly cron, so nothing else in CI " +
    "would have caught this. Either hold the version (see the firebase-admin " +
    "ignore in .github/dependabot.yml) or update the scripts in the SAME change.");
});
