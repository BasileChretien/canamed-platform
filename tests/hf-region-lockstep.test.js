"use strict";
/* tests/hf-region-lockstep.test.js
 *
 * The hfPatient callable's region is declared in TWO places that must agree:
 *   - functions/index.js   `region:` on the onCall options
 *   - modA-llm-init.js     HF_FUNCTIONS_REGION, used to resolve the callable
 *
 * `firebase.functions()` with no argument resolves to us-central1. If the two
 * ever drift apart, every chat call 404s and the bridge falls back to the stub
 * patient on EVERY message — silently, because it treats any failure as
 * "backend unavailable". That is the same symptom as the 2026-06-03 App Check
 * incident, and it took a live diagnosis to find. This test makes the drift
 * loud at CI time instead.
 *
 * It also pins the region to the EEA: participants' free text is EEA-resident
 * everywhere else, and a US region would re-introduce a transfer to a country
 * outside Japan's APPI Art. 28 equivalent-protection list (EEA + UK only).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const FUNCS = fs.readFileSync(path.join(P, "functions", "index.js"), "utf8");
const INIT = fs.readFileSync(path.join(P, "modA-llm-init.js"), "utf8");

/* The `region:` that belongs to the hfPatient onCall options block (the file
   also declares a region for sendQueuedMail, so slice from the export). */
function hfPatientRegion(src) {
  const at = src.indexOf("exports.hfPatient = onCall({");
  assert.notStrictEqual(at, -1, "could not find the hfPatient onCall block");
  const block = src.slice(at, at + 2000);
  const m = block.match(/^\s*region:\s*"([a-z0-9-]+)"/m);
  assert.ok(m, "hfPatient must declare an explicit region");
  return m[1];
}

function clientRegion(src) {
  const m = src.match(/HF_FUNCTIONS_REGION\s*=\s*"([a-z0-9-]+)"/);
  assert.ok(m, "modA-llm-init.js must declare HF_FUNCTIONS_REGION");
  return m[1];
}

test("the client and the function agree on the hfPatient region", () => {
  assert.strictEqual(clientRegion(INIT), hfPatientRegion(FUNCS),
    "region drift 404s every chat call and silently falls back to the stub patient");
});

test("the client actually USES the region when resolving the callable", () => {
  // A correct constant is useless if the call site still says fb.functions().
  assert.match(INIT, /functions\(HF_FUNCTIONS_REGION\)\.httpsCallable\("hfPatient"\)/,
    "the callable must be resolved through the declared region");
});

/* Explicit allowlist, NOT a /^europe-/ prefix match: some europe-* Google
   Cloud regions are outside the EEA (e.g. europe-west6 = Zurich, Switzerland),
   so a prefix test would wave through an unassessed, non-EEA region. Adding a
   region here is a deliberate data-residency decision — assess it against
   Japan's APPI Art. 28 equivalent-protection list (EEA + UK) first. */
const APPROVED_EEA_REGIONS = ["europe-west1"];

test("hfPatient stays in an approved EEA region", () => {
  const region = hfPatientRegion(FUNCS);
  assert.ok(APPROVED_EEA_REGIONS.includes(region),
    "participants' free text must stay in an approved EEA region " +
    JSON.stringify(APPROVED_EEA_REGIONS) + "; got " + region);
});
