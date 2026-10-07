"use strict";
/* tests/fixtures/run-ops-script.js
 *
 * Run one REAL script from scripts/ in a child process against an in-memory
 * database, and hand back what it printed, how it exited and the database it
 * left behind. See fake-rtdb-preload.js for the database.
 *
 * The scripts are run, not read: they call main() at load time, open a
 * database and end in process.exit(), so the only way to see what one of them
 * does to a database is to let it run against one.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const PRELOAD = path.join(__dirname, "fake-rtdb-preload.js");

/**
 * @param {string} script file name under scripts/
 * @param {object} opts
 * @param {object} opts.tree   the whole database before the run (not mutated)
 * @param {number} opts.now    epoch ms the script's Date.now() returns
 * @param {object} [opts.env]  extra environment for the script
 * @param {string[]} [opts.args]
 * @param {string} [opts.throwOn] a path whose read fails
 * @returns {{code: number, out: string, tree: object, writes: Array<{op: string, paths: string[]}>}}
 *   `writes` is every write CALL the script made, in order — one entry per
 *   update()/set()/remove(), with the paths it named.
 */
function runOpsScript(script, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canamed-ops-"));
  const file = path.join(dir, "db.json");
  const log = path.join(dir, "writes.jsonl");
  try {
    fs.writeFileSync(file, JSON.stringify(opts.tree || {}));
    /* The parent's CLEANUP_* / ERASE_* / DATA_RIGHTS_* settings must not leak
       into the script under test: a developer with CLEANUP_CONFIRM exported
       would otherwise get different results from CI. */
    const env = {};
    for (const key of Object.keys(process.env)) {
      if (!/^(CLEANUP_|ERASE_|DATA_RIGHTS_|BACKFILL_|FAKE_RTDB_|GOOGLE_APPLICATION_CREDENTIALS)/.test(key)) {
        env[key] = process.env[key];
      }
    }
    Object.assign(env, {
      FAKE_RTDB_FILE: file,
      FAKE_RTDB_NOW: String(opts.now),
      FAKE_RTDB_WRITE_LOG: log,
      FIREBASE_DATABASE_URL: "https://fake-rtdb.example.test"
    }, opts.throwOn ? { FAKE_RTDB_THROW_ON: opts.throwOn } : {}, opts.env || {});
    const r = spawnSync(process.execPath,
      ["-r", PRELOAD, path.join(ROOT, "scripts", script), ...(opts.args || [])],
      { env, encoding: "utf8", timeout: 30000 });
    /* A script that returns from main() without process.exit() hangs on the
       preload's keep-alive, as it would on a real connection, and ends here. */
    if (r.error) {
      throw new Error(`scripts/${script} did not finish (${r.error.code || r.error.message}). ` +
        "If it timed out, a path through it never calls process.exit().\n" +
        (r.stdout || "") + (r.stderr || ""));
    }
    return {
      code: r.status,
      out: (r.stdout || "") + (r.stderr || ""),
      tree: JSON.parse(fs.readFileSync(file, "utf8")),
      writes: fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").split(String.fromCharCode(10)).filter(Boolean).map((line) => JSON.parse(line))
        : []
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* Read a path out of a tree the way a snapshot would: null when absent. */
function at(tree, p) {
  return String(p).split("/").filter(Boolean).reduce(
    (node, key) => (node !== null && typeof node === "object" && key in node ? node[key] : null), tree);
}

module.exports = { runOpsScript, at, ROOT };
