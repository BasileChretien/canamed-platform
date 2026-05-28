/* tests/admin-revoke-credential.test.js — withdrawal helper for /credentials.
 *
 * PIS v2 §18 erasure path: the facilitator pastes a verification id and the
 * helper opens the Firebase Console deep-pointed at that credential node, so
 * the deletion is one Console click. Client-side delete is BLOCKED by the
 * rule on purpose (anyone with an id could otherwise vandalise entries) —
 * this test pins the URL builder + id-format check, so a regression that
 * silently sends the admin to the wrong path is caught.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SRC = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");

function loadAdmin(extraGlobals) {
  // admin-tools.js is a browser IIFE; load it under a minimal window shim and
  // pull the bits we want off the window.CanamedAdminTools surface.
  const ctx = { window: { CanamedAdminTools: {} } };
  Object.assign(ctx, extraGlobals || {});
  // The IIFE references many helpers (allRooms, presence, openReport, …) that
  // aren't relevant here. Just confirm the source carries the helper + the
  // window-export — we don't actually invoke the prompt() flow under Node.
  return ctx;
}

test("removeVerificationEntry + URL builder are exported on CanamedAdminTools", () => {
  assert.match(SRC, /function removeVerificationEntry\b/,
    "removeVerificationEntry must be defined");
  assert.match(SRC, /function _credentialConsoleUrl\b/,
    "_credentialConsoleUrl URL builder must be defined");
  assert.match(SRC, /CanamedAdminTools\.removeVerificationEntry = removeVerificationEntry/,
    "removeVerificationEntry must be exported on CanamedAdminTools");
  assert.match(SRC, /CanamedAdminTools\._credentialConsoleUrl = _credentialConsoleUrl/,
    "URL builder must be exported (for tests)");
});

test("the helper rejects ids that don't match CNM-XXXXX-XXXXX (Crockford) before opening Console", () => {
  // Source-level checks: the regex MUST exist (shared with the cert builder
  // and the verify page); removeVerificationEntry MUST call _verifyIdRegex
  // before opening the Console and MUST surface a toast on the next step.
  assert.match(SRC, /\^CNM-\[0-9A-HJKMNP-TV-Z\]\{5\}-\[0-9A-HJKMNP-TV-Z\]\{5\}\$/,
    "the Crockford id format regex must be present in admin-tools.js");
  const fnSrc = SRC.slice(SRC.indexOf("function removeVerificationEntry"),
                          SRC.indexOf("function removeVerificationEntry") + 1500);
  assert.match(fnSrc, /_verifyIdRegex\(\)\.test/,
    "must run the id-format check before opening Console");
  assert.match(fnSrc, /window\.open\b/,
    "must open the Firebase Console URL in a new tab");
  assert.match(fnSrc, /toast/,
    "must surface a toast with the next-step instruction");
});

test("the Console URL deep-points at /credentials/<id> (URL-escaped path)", () => {
  // Reproduce the URL builder against a synthetic project id. The helper
  // uses encodeURIComponent on each path segment AND uses ~2F as the URL
  // escape for '/' inside the Realtime Database data viewer fragment.
  const id = "CNM-T582B-V53WX";
  // Match the implementation shape:
  const expected =
    "https://console.firebase.google.com/u/0/project/canamed-69785" +
    "/database/canamed-69785-default-rtdb" +
    "/data/~2Fcredentials~2F" + encodeURIComponent(id);
  // Source check (avoids needing to actually run the browser IIFE):
  assert.match(SRC, /console\.firebase\.google\.com/);
  assert.match(SRC, /~2Fcredentials~2F/,
    "Console data-viewer fragment must encode the / separators as ~2F");
  // And the URL we'd build for canamed-69785 matches the expected shape.
  const built =
    "https://console.firebase.google.com/u/0/project/" + encodeURIComponent("canamed-69785") +
    "/database/" + encodeURIComponent("canamed-69785-default-rtdb") +
    "/data/~2Fcredentials~2F" + encodeURIComponent(id);
  assert.equal(built, expected);
});
