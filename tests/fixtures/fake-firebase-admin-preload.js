"use strict";
/* tests/fixtures/fake-firebase-admin-preload.js
 *
 * Loaded with `node -r`, so that a REAL ops script can run to completion in a
 * child process against an in-memory database (see the child-process section
 * of tests/cleanup-passes.test.js).
 *
 * WHY THIS EXISTS. The ops scripts call main() at load time, open a database
 * and end in process.exit(), so none of them can be require()d by a test. Their
 * libraries are covered against fake dbs; the main() that wires those libraries
 * together was covered by text checks only — and a wiring defect is exactly
 * what the backup gate's early exit was (cleanup-passes.js has the story).
 * Swapping firebase-admin out at require() time lets the script itself run.
 *
 * It is deliberately dumb: a tree comes IN through the environment, the writes
 * the script attempted go OUT to a file, and nothing is interpreted here.
 *
 *   FAKE_DB_TREE        JSON for the whole database
 *   FAKE_DB_THROW_ON    optional path whose read rejects (PERMISSION_DENIED)
 *   FAKE_DB_WRITES_OUT  file that receives { exitCode, writes, reads } at exit
 *   FAKE_DB_NOW         optional epoch ms: the script's Date.now() returns this
 *                       for the whole run. A retention job is a function of the
 *                       date, and "the same database, five years later" is a
 *                       case worth running rather than reasoning about.
 */

const Module = require("node:module");
const fs = require("node:fs");

const OUT = process.env.FAKE_DB_WRITES_OUT;
if (!OUT) throw new Error("fake-firebase-admin-preload: FAKE_DB_WRITES_OUT is not set");

/* Refused when unusable, never ignored: a test that asked for a fixed clock and
   silently got the real one would pass or fail by the calendar. Set before the
   script is loaded, because the ops scripts read the clock at module scope. */
if (process.env.FAKE_DB_NOW) {
  const fixedNow = Number(process.env.FAKE_DB_NOW);
  if (!Number.isSafeInteger(fixedNow) || fixedNow <= 0) {
    throw new Error("fake-firebase-admin-preload: FAKE_DB_NOW must be epoch milliseconds");
  }
  Date.now = () => fixedNow;
}
const tree = JSON.parse(process.env.FAKE_DB_TREE || "{}");
const throwOn = process.env.FAKE_DB_THROW_ON || "";

const at = (p) => (p ? p.split("/") : []).reduce(
  (node, key) => (node && typeof node === "object" && key in node ? node[key] : null), tree);

/* Writes are RECORDED, never applied: the tests assert on what the script
   tried to write, and a script that re-read its own deletes would be a
   different script. `path` is "" for a root-level ref(). */
const writes = [];
/* Reads are recorded too, as { via, path }: `once` returns a node's VALUE, the
   whole subtree; `shallow` returns its keys and nothing under them. What a
   scheduled job reads is a published commitment (the participant notice lists
   it), so "this change reads nothing new" has to be something a test can
   show rather than something a comment says. */
const reads = [];
const db = {
  ref(p) {
    const where = p || "";
    return {
      async once() {
        reads.push({ via: "once", path: where });
        if (throwOn && where === throwOn) {
          throw Object.assign(new Error("fake read failure"), { code: "PERMISSION_DENIED" });
        }
        return { val: () => at(where) };
      },
      async update(obj) { writes.push({ op: "update", path: where, keys: Object.keys(obj).sort() }); },
      async set() { writes.push({ op: "set", path: where }); },
      async remove() { writes.push({ op: "remove", path: where }); }
    };
  }
};

const app = { options: { credential: { getAccessToken: async () => ({ access_token: "fake" }) } } };

/* Only these two specifiers are replaced. A script that starts importing a
   third firebase-admin entry point gets the real one (or MODULE_NOT_FOUND),
   which fails its test loudly instead of being half-faked. */
const realLoad = Module._load;
Module._load = function (request) {
  if (request === "firebase-admin/app") return { initializeApp: () => app };
  if (request === "firebase-admin/database") return { getDatabase: () => db };
  return realLoad.apply(this, arguments);
};

/* The shallow enumerator reads over REST (`?shallow=true`), which returns the
   KEYS of a node and never its values. Answer the same way. */
globalThis.fetch = async (url) => {
  const p = String(url).replace(/^https:\/\/[^/]+\//, "").replace(/\.json\?shallow=true$/, "");
  reads.push({ via: "shallow", path: p });
  const node = at(p);
  const keys = node && typeof node === "object"
    ? Object.fromEntries(Object.keys(node).map((k) => [k, true]))
    : null;
  return { ok: true, status: 200, json: async () => keys };
};

/* A real RTDB connection keeps the event loop alive for ever — which is why
   every ops script must call process.exit() (tests/ops-scripts-terminate.test.js).
   Without this timer a main() that merely RETURNED would end the child by
   itself and look healthy; with it, that script hangs here exactly as it would
   in production, and the caller's timeout turns the hang into a failure. */
setInterval(() => {}, 2 ** 30);

process.on("exit", (exitCode) => {
  fs.writeFileSync(OUT, JSON.stringify({ exitCode, writes, reads }));
});
