/* tests/firebase-admin-api-surface.test.js
 *
 * The four ops scripts (backup-sessions, cleanup-stale-sessions,
 * firebase-cost-monitor, pseudonymise-export) run ONLY on their nightly cron.
 * No CI job executes them. That means a dependency change can be fully green
 * on a PR and still break every one of them — and the breakage first shows up
 * as a 03:00 failure email nobody is watching, which is precisely the outage
 * shape #316 existed to end.
 *
 * #316 made firebase-admin a real root devDependency so upstream changes
 * arrive as a reviewable Dependabot PR instead of drifting in unseen. Its
 * rationale claimed such a PR was something "CI gets to reject". That was an
 * OVERCLAIM: nothing in the unit, E2E, rules or functions suites requires
 * firebase-admin from the root, so there was no check to do the rejecting.
 *
 * PR #320 (bump firebase-admin 13.10.0 -> 14.2.0) proved it. v14 drops the
 * namespaced accessors entirely — measured, not inferred:
 *
 *     v14  admin.initializeApp   function
 *     v14  admin.database        undefined   <- 4 call sites
 *     v14  admin.storage         undefined   <- 1 call site
 *     v14  admin.credential      undefined
 *
 * `const db = admin.database()` is a TypeError on the first line of real work
 * in all four scripts. This file is the missing check that makes the claim
 * true: it fails in ~50 ms in the unit job instead of at 03:00.
 *
 * It is deliberately SELF-MAINTAINING — the member list is derived from the
 * scripts themselves, so a script that starts using admin.messaging() is
 * covered without anyone remembering to update this file.
 *
 * When firebase-admin v14 is eventually adopted, do NOT delete this test:
 * migrate the scripts to the modular API (getDatabase(app), getStorage(app))
 * and this test's derived list follows them automatically.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const admin = require("firebase-admin");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");

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

/** Every `admin.<member>` referenced anywhere under scripts/. */
function membersUsedByScripts() {
  const used = new Map(); // member -> [files]
  for (const file of jsFilesUnder(SCRIPTS)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/\badmin\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (!used.has(m[1])) used.set(m[1], []);
      if (!used.get(m[1]).includes(rel)) used.get(m[1]).push(rel);
    }
  }
  return used;
}

test("the scan finds the call sites it is supposed to guard", () => {
  /* Without this, a broken walker or regex would make every assertion below
     vacuous — the test would pass loudest exactly when it had stopped
     looking. These three are known-present in the ops scripts today. */
  const used = membersUsedByScripts();
  for (const expected of ["initializeApp", "database", "storage"]) {
    assert.ok(used.has(expected),
      "scan found no `admin." + expected + "` under scripts/ — the walker or " +
      "the regex is broken, not the dependency (found: " +
      [...used.keys()].join(", ") + ")");
  }
});

test("the installed firebase-admin still exposes every member the ops scripts call", () => {
  const used = membersUsedByScripts();
  const missing = [];
  for (const [member, files] of used) {
    if (admin[member] === undefined) missing.push(member + "  <- " + files.join(", "));
  }
  assert.deepStrictEqual(missing, [],
    "firebase-admin " + installedVersion() +
    " no longer exposes members the ops scripts call:\n  " + missing.join("\n  ") +
    "\n\nThose scripts run only on their nightly cron, so nothing else in CI " +
    "would have caught this. v14 removed the namespaced accessors " +
    "(admin.database / admin.storage / admin.credential) in favour of the " +
    "modular API. Either hold the major (see the firebase-admin ignore in " +
    ".github/workflows/../dependabot.yml) or migrate the scripts to " +
    "getDatabase(app) / getStorage(app) in the SAME change.");
});
