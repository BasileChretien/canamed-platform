"use strict";
/* tests/fixtures/failing-update-preload.js
 *
 * Loaded with a second `node -r`, AFTER fake-firebase-admin-preload.js. It
 * makes every database update() reject the way firebase-admin does: an error
 * with a `code`, and a `message` that names the path it failed on.
 *
 * That message is the point. An ops script that logs `e.message` for a failed
 * write prints a path, the path ends in a session code, and the logs are
 * world-readable — and no test could see it, because the fake's update() never
 * fails. Reads, and everything else, pass through to the fake unchanged.
 *
 *   FAKE_DB_FAIL_UPDATES_NAMING  optional. When set, only an update with a key
 *                                containing this text fails; the others go
 *                                through to the fake. For a script that makes
 *                                several updates, where the question is what
 *                                happens when ONE of them fails.
 */

const Module = require("node:module");

const ONLY = process.env.FAKE_DB_FAIL_UPDATES_NAMING || "";

const inner = Module._load;
Module._load = function (request) {
  const mod = inner.apply(this, arguments);
  if (request !== "firebase-admin/database") return mod;
  return {
    getDatabase: () => {
      const db = mod.getDatabase();
      return {
        ref(p) {
          const real = db.ref(p);
          return Object.assign({}, real, {
            async update(obj) {
              if (ONLY && !Object.keys(obj).some((key) => key.includes(ONLY))) return real.update(obj);
              throw Object.assign(
                new Error("update at /" + Object.keys(obj)[0] + " failed: permission_denied"),
                { code: "PERMISSION_DENIED" });
            }
          });
        }
      };
    }
  };
};
