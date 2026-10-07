"use strict";
/* tests/fixtures/fake-rtdb-preload.js
 *
 * Loaded with `node -r`, so that a REAL ops script runs to completion in a
 * child process against an in-memory database WHOSE WRITES ARE APPLIED, with a
 * fixed clock. The tree comes in from a file and goes back out to it at exit.
 *
 * WHY THE WRITES ARE APPLIED. The questions this serves are about what one
 * job leaves behind for the next: the nightly purge runs at 03:17 and the
 * data-rights monitor at 04:11, on the same database, and whether an erasure
 * request survives the first to be seen by the second cannot be answered by
 * listing what the purge tried to write. So the tests run the purge, read the
 * tree it produced, and hand that tree to the monitor.
 *
 * It is deliberately dumb: paths in, values out, nulls delete, and an empty
 * object disappears the way it does in the Realtime Database. No rules are
 * modelled — the Admin SDK bypasses them, and these scripts are Admin scripts.
 *
 *   FAKE_RTDB_FILE      JSON file holding the whole database (read, then rewritten)
 *   FAKE_RTDB_NOW       epoch ms that Date.now() returns
 *   FAKE_RTDB_THROW_ON  optional path whose read fails: a rejected Admin read,
 *                       or an HTTP 401 for a keys-only listing over REST
 *   FAKE_RTDB_WRITE_LOG optional file: one JSON line per WRITE CALL the script
 *                       makes ({ op, paths }), so a test can tell one
 *                       multi-path update from two writes that leave the same
 *                       tree behind — the difference between "atomic" and not
 */

const Module = require("node:module");
const fs = require("node:fs");

const FILE = process.env.FAKE_RTDB_FILE;
if (!FILE) throw new Error("fake-rtdb-preload: FAKE_RTDB_FILE is not set");
const tree = JSON.parse(fs.readFileSync(FILE, "utf8"));
const throwOn = process.env.FAKE_RTDB_THROW_ON || "";
const writeLog = process.env.FAKE_RTDB_WRITE_LOG || "";
const logWrite = (op, paths) => {
  if (writeLog) fs.appendFileSync(writeLog, JSON.stringify({ op, paths }) + String.fromCharCode(10));
};

if (process.env.FAKE_RTDB_NOW) {
  const fixed = Number(process.env.FAKE_RTDB_NOW);
  if (!Number.isFinite(fixed)) throw new Error("fake-rtdb-preload: FAKE_RTDB_NOW is not a number");
  Date.now = () => fixed;
}

const isObj = (v) => v !== null && typeof v === "object";
const segs = (p) => String(p || "").split("/").filter(Boolean);
const at = (p) => segs(p).reduce(
  (node, key) => (isObj(node) && key in node ? node[key] : null), tree);

function put(p, value) {
  const s = segs(p);
  if (!s.length) throw new Error("fake-rtdb-preload: refusing to replace the root");
  let node = tree;
  for (const key of s.slice(0, -1)) {
    if (!isObj(node[key])) {
      if (value === null) return;
      node[key] = {};
    }
    node = node[key];
  }
  if (value === null) delete node[s[s.length - 1]];
  else node[s[s.length - 1]] = JSON.parse(JSON.stringify(value));
}

/* The Realtime Database stores no empty objects. */
function prune(node) {
  for (const key of Object.keys(node)) {
    if (!isObj(node[key])) continue;
    prune(node[key]);
    if (!Object.keys(node[key]).length) delete node[key];
  }
}

function snapshot(p) {
  if (throwOn && p === throwOn) {
    /* The message QUOTES THE PATH, as real firebase-admin errors can — so a
       script that prints e.message into a public log shows up in a test as the
       session code or uid it would have leaked. */
    throw Object.assign(new Error("fake read failure at /" + p), { code: "PERMISSION_DENIED" });
  }
  const v = at(p);
  return { exists: () => v !== null, val: () => (v === null ? null : JSON.parse(JSON.stringify(v))) };
}

/* push() keys must be new each time, ACROSS runs: the tree outlives the
   process, and a counter restarting at 1 would make a second run overwrite the
   first run's `erasures/` entry — so a test chaining two runs would see one
   record where the real database holds two. Like the real thing, a key sorts
   after every key already under that node. */
function pushKey(where) {
  const node = at(where);
  const taken = isObj(node) ? Object.keys(node) : [];
  let n = taken.length + 1;
  let key;
  do { key = "-fakePush" + String(n++).padStart(4, "0"); } while (taken.includes(key));
  return key;
}

const db = {
  ref(p) {
    const where = segs(p).join("/");
    return {
      key: segs(where).pop() || null,
      async once() { return snapshot(where); },
      async get() { return snapshot(where); },
      /* A multi-path update: every key is a path below this ref. The real
         database REJECTS one in which a path is an ancestor of another, and
         applies none of it — so does this, or a script that deletes a node and
         one of its children in the same update would pass here and fail there. */
      async update(obj) {
        const paths = Object.keys(obj).map((key) => segs(where ? where + "/" + key : key).join("/"));
        for (const a of paths) {
          for (const b of paths) {
            if (a !== b && b.startsWith(a + "/")) {
              throw new Error(`fake update refused: path "${a}" is an ancestor of "${b}"`);
            }
          }
        }
        logWrite("update", paths.slice().sort());
        for (const key of Object.keys(obj)) put(where ? where + "/" + key : key, obj[key]);
        prune(tree);
      },
      async set(value) { logWrite("set", [where]); put(where, value); prune(tree); },
      async remove() { logWrite("remove", [where]); put(where, null); prune(tree); },
      push() { return db.ref(where + "/" + pushKey(where)); }
    };
  }
};

const app = { options: { credential: { getAccessToken: async () => ({ access_token: "fake" }) } } };

/* Only these two specifiers are replaced. A script that starts importing a
   third firebase-admin entry point gets the real one (or MODULE_NOT_FOUND),
   which fails its test loudly instead of being half-faked. */
const realLoad = Module._load;
Module._load = function (request) {
  if (request === "firebase-admin/app") {
    return { initializeApp: () => app, getApps: () => [app], cert: (x) => x };
  }
  if (request === "firebase-admin/database") return { getDatabase: () => db };
  return realLoad.apply(this, arguments);
};

/* The keys-only enumerator reads over REST (`?shallow=true`), which returns
   the KEYS of a node and never its values. Answer the same way. */
globalThis.fetch = async (url) => {
  const p = String(url).replace(/^https:\/\/[^/]+\//, "").replace(/\.json(\?.*)?$/, "");
  if (throwOn && p === throwOn) return { ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) };
  const node = at(p);
  const body = /[?&]shallow=true/.test(String(url))
    ? (isObj(node) ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null)
    : node;
  return { ok: true, status: 200, json: async () => body };
};

/* A real Realtime Database connection keeps the event loop alive for ever —
   which is why every script that opens one must call process.exit()
   (tests/ops-scripts-terminate.test.js, which can only check that by reading).
   Without this timer a main() that merely RETURNED would end the child by
   itself and look healthy; with it, that script hangs here exactly as it would
   against the real database, and the caller's timeout turns the hang into a
   failure. */
setInterval(() => {}, 2 ** 30);

process.on("exit", () => { fs.writeFileSync(FILE, JSON.stringify(tree)); });
