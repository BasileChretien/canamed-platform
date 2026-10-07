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
 *   FAKE_RTDB_THROW_ON  optional path whose read rejects
 */

const Module = require("node:module");
const fs = require("node:fs");

const FILE = process.env.FAKE_RTDB_FILE;
if (!FILE) throw new Error("fake-rtdb-preload: FAKE_RTDB_FILE is not set");
const tree = JSON.parse(fs.readFileSync(FILE, "utf8"));
const throwOn = process.env.FAKE_RTDB_THROW_ON || "";

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
    throw Object.assign(new Error("fake read failure"), { code: "PERMISSION_DENIED" });
  }
  const v = at(p);
  return { exists: () => v !== null, val: () => (v === null ? null : JSON.parse(JSON.stringify(v))) };
}

let pushed = 0;
const db = {
  ref(p) {
    const where = segs(p).join("/");
    return {
      key: segs(where).pop() || null,
      async once() { return snapshot(where); },
      async get() { return snapshot(where); },
      /* A multi-path update: every key is a path below this ref. */
      async update(obj) {
        for (const key of Object.keys(obj)) put(where ? where + "/" + key : key, obj[key]);
        prune(tree);
      },
      async set(value) { put(where, value); prune(tree); },
      async remove() { put(where, null); prune(tree); },
      push() { return db.ref(where + "/-fakePush" + String(++pushed).padStart(4, "0")); }
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
  const node = at(p);
  const body = /[?&]shallow=true/.test(String(url))
    ? (isObj(node) ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : null)
    : node;
  return { ok: true, status: 200, json: async () => body };
};

process.on("exit", () => { fs.writeFileSync(FILE, JSON.stringify(tree)); });
