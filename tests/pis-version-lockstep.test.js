/* tests/pis-version-lockstep.test.js
 *
 * Annex VI L1, second half — the consent-version string is hand-maintained in
 * nine places, and on 2026-09-02 it was found NINE VERSIONS STALE in
 * `index.html`. The item asks for it to be generated rather than literal. This
 * test does not make it generated; it makes the drift that motivated that
 * request impossible to land.
 *
 * WHY THE EXISTING GUARD DID NOT CATCH IT. `llm-recipients-notice.test.js`
 * already asserts a notice version, but only that it is `>= 4` — enough to prove
 * the text postdates the simulated-patient disclosure, and blind to a PARTIAL
 * bump. Raise `privacy.html` to v12 and leave the eight locale files at v11 and
 * that test stays green, which is precisely the state that produced the
 * nine-version gap: every surface individually plausible, no two compared.
 *
 * WHAT A STALE VERSION ACTUALLY COSTS. The string is the participant's only
 * handle on WHICH notice they consented to. A consent record pointing at "PIS
 * v2" when the live text is v11 cannot show what was disclosed at the moment of
 * collection — and re-consent on a material change (which `privacy.html` §16
 * promises) is unprovable if the version the participant saw was wrong.
 *
 * DECLARATIONS ONLY, NOT MENTIONS. A version is DECLARED in the form
 * "PIS v<n> · <date>" (or with the `&middot;` entity in HTML). A bare mention —
 * "Material changes since PIS v10" — is the changelog describing history, and
 * must keep naming older versions. A test that forbade every mention would
 * forbid the sentence explaining the change.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(PLATFORM, ...p), "utf8");

// "PIS v11 · 2026-09" / "PIS v11 &middot; 2026-09" — the declaration form.
const DECLARED = /PIS v(\d+)\s*(?:·|&middot;)/g;

function declarationsIn(text) {
  return [...text.matchAll(DECLARED)].map((m) => Number(m[1]));
}

/** Every surface that declares a notice version, as file -> versions declared. */
function surfaces() {
  const out = new Map();
  out.set("privacy.html", declarationsIn(read("privacy.html")));
  out.set("index.html", declarationsIn(read("index.html")));
  out.set("i18n.js", declarationsIn(read("i18n.js")));
  for (const f of fs.readdirSync(path.join(PLATFORM, "locales"))) {
    if (f.endsWith(".js")) out.set("locales/" + f, declarationsIn(read("locales", f)));
  }
  return out;
}

test("the scan finds every surface that declares a version (anti-vacuity)", () => {
  /* Nine is the number Annex VI L1 cites: index.html's fallback, i18n.js's
     canonical table, and seven locale files — plus privacy.html itself. If this
     count drops, a surface stopped declaring a version (or the regex broke) and
     every comparison below silently covers less than it claims. */
  const s = surfaces();
  const declaring = [...s.entries()].filter(([, v]) => v.length > 0);
  assert.ok(declaring.length >= 9,
    `only ${declaring.length} surfaces declare a notice version; expected at ` +
    `least 9. Surfaces found: ${[...s.keys()].join(", ")}`);
});

test("every surface declares the SAME notice version", () => {
  const s = surfaces();
  const seen = new Map();               // version -> [files]
  for (const [file, versions] of s) {
    for (const v of versions) {
      if (!seen.has(v)) seen.set(v, []);
      if (!seen.get(v).includes(file)) seen.get(v).push(file);
    }
  }

  /* privacy.html is the only file allowed to declare several, because its §16
     changelog reproduces past declarations verbatim. Judge it by its HIGHEST —
     that is the version the document is issued AT. Every other file must carry
     exactly one, and it must equal that. */
  const privacy = s.get("privacy.html");
  assert.ok(privacy.length > 0, "privacy.html declares no notice version at all");
  const current = Math.max(...privacy);

  const wrong = [];
  for (const [file, versions] of s) {
    if (file === "privacy.html" || versions.length === 0) continue;
    for (const v of versions) if (v !== current) wrong.push(`${file} declares v${v}`);
  }
  assert.deepStrictEqual(wrong, [],
    `privacy.html is issued at PIS v${current}, but these surfaces declare ` +
    `something else: ${wrong.join("; ")}. A participant's consent record would ` +
    `then name a notice version different from the one they were shown.`);
});

test("the live consent string is not stuck behind the published notice", () => {
  /* The specific 2026-09-02 failure, stated as its own assertion so a
     regression names the defect rather than a generic mismatch. */
  const i18n = read("i18n.js");
  const line = i18n.split("\n").find((l) => l.includes('lobby.consent-version"'));
  assert.ok(line, "i18n.js has no lobby.consent-version string");
  const consent = line.match(/PIS v(\d+)/);
  assert.ok(consent, "lobby.consent-version no longer declares a version");

  const current = Math.max(...declarationsIn(read("privacy.html")));
  assert.strictEqual(Number(consent[1]), current,
    `the consent form shows PIS v${consent[1]} while the published notice is ` +
    `issued at v${current} — the exact drift found on 2026-09-02, when the ` +
    `consent string was NINE versions stale`);
});
