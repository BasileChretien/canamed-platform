/* scripts/ops/web-port.js — the platform server's port, from PORT
 *
 * Both emulator-backed entry points serve the platform themselves and take the
 * port from PORT (8765 by default, which AnkiConnect owns on at least one dev
 * machine): `npm run test:e2e:rules` (run-rules-e2e.js) and `npm run
 * sim:emulator` (sim/sim-with-emulator.js). This is the one reading of PORT
 * they share, so that they cannot come to disagree about what a PORT means.
 *
 * They did. The sim launcher got a check of its own (2026-10-08) and the
 * runner kept a bare parseInt, and the launcher's check then refused a value
 * the runner took: in cmd.exe `set PORT=8771 && npm run sim:emulator` hands
 * node "8771 " — the space before `&&` is part of the value — and a test for
 * "all digits" called that not a port.
 *
 * What a PORT may be:
 *   - unset, empty or blank: the default;
 *   - a whole number from 1 to 65535, with any whitespace around it ignored;
 *   - NOT either emulator's port. The platform server is started first, so it
 *     would take the port, the emulator could not bind it — and the listener
 *     found there is this run's own server, which the lineage check rightly
 *     says the emulator CLI did not start. The sim launcher then reported
 *     ANOTHER RUN HOLDS THE EMULATOR PORTS, about its own node.exe.
 * Anything else is refused by the caller, by name, BEFORE it starts anything.
 * (parseInt alone reads "8771abc" as 8771 and "abc" as NaN, and a NaN port
 * was announced as "on :NaN" before failing ten seconds later.)
 */
"use strict";

const DEFAULT_WEB_PORT = 8765;

/* read(raw, { db, auth }) → { asked, port, problem }
 *
 *   asked    what was asked for, trimmed — for the message
 *   port     the port number, or NaN when `asked` is not one
 *   problem  null, or why this cannot be the platform server's port: the end
 *            of a sentence that starts "PORT=… cannot be the platform
 *            server's port — "
 */
function read(raw, emulators) {
  const asked = String(raw === undefined || raw === null ? "" : raw).trim() ||
    String(DEFAULT_WEB_PORT);
  const port = /^\d+$/.test(asked) ? parseInt(asked, 10) : NaN;
  let problem = null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problem = "that is not a port (a whole number from 1 to 65535)";
  } else if (emulators && port === emulators.db) {
    problem = "that is the database emulator's port";
  } else if (emulators && port === emulators.auth) {
    problem = "that is the auth emulator's port";
  }
  return { asked, port, problem };
}

/* The refusal both entry points print. `command` is how to run this one. */
function refusal(web, command) {
  return "PORT=" + JSON.stringify(web.asked) + " cannot be the platform server's " +
    "port — " + web.problem + ".\nNothing was started. Unset PORT to use " +
    DEFAULT_WEB_PORT + ", or name a free one: PORT=8771 " + command;
}

module.exports = { read, refusal, DEFAULT_WEB_PORT };
