/* tests/fallback-contradiction.test.js
 *
 * Annex VI L6 — a hard-coded fallback in index.html must not contradict the
 * canonical string it stands in for.
 *
 * WHY THIS IS A REAL DEFECT AND NOT A TIDINESS ONE. The fallback is what the
 * browser PAINTS FIRST — before i18n.js has loaded and swapped the runtime
 * string in. So on a cold load, over a slow link, or if the locale chunk fails,
 * the fallback is the ONLY text a participant sees, and it is the text they may
 * act on. Three of them said the pre-test and post-test were "anonymous within
 * your university" and the questionnaire was "a short, anonymous questionnaire",
 * while the canonical strings they replaced say the answers are "linked to you
 * for the CaNaMED study". A participant who clicked Start on the strength of the
 * first sentence consented to something the notice says is not true — GDPR
 * Art. 13, and the claim at issue is identifiability itself.
 *
 * DERIVED, NOT HAND-LISTED. The canonical `i18n._T.en` table is the enforcing
 * source, so a new fallback added tomorrow is covered without editing this file.
 * A hand-written list of the three known-bad keys would have passed forever
 * after they were fixed and caught nothing new.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = undefined;
global.self = undefined;

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const en = require(path.join(PLATFORM, "i18n.js"))._T.en;
const html = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");

/** Every data-i18n element in index.html that carries fallback text. */
function fallbacks() {
  const out = new Map();
  const re = /data-i18n="([\w.\-]+)"[^>]*>([\s\S]*?)</g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (text) out.set(m[1], text);
  }
  return out;
}

test("the scan actually finds fallbacks (anti-vacuity)", () => {
  /* Without this, a change to the markup or the regex turns every assertion
     below into a loop over an empty map — green, and testing nothing. */
  const f = fallbacks();
  assert.ok(f.size > 100,
    `only ${f.size} data-i18n fallbacks found; the scan has stopped working`);
  const known = [...f.keys()].filter((k) => en[k]);
  assert.ok(known.length > 80,
    `only ${known.length} fallbacks matched a canonical string; the i18n table ` +
    `lookup has stopped working`);
});

test("no fallback claims an anonymity its canonical string does not", () => {
  const BAD = /anonym/i;
  const bad = [];
  for (const [k, text] of fallbacks()) {
    if (!en[k]) continue;
    if (BAD.test(text) && !BAD.test(en[k])) bad.push(k);
  }
  assert.deepStrictEqual(bad, [],
    `these fallbacks tell the participant their data is anonymous while the ` +
    `string they stand in for does not: ${bad.join(", ")}. The fallback is ` +
    `painted FIRST, so this is the claim a participant acts on.`);
});

test("where the canonical says the answers are linked, so does the fallback", () => {
  /* The converse defect: a fallback that merely OMITS the linkage is not
     neutral — it presents an optional-and-harmless questionnaire and leaves out
     the one fact that would make a participant think twice. */
  const LINKED = /linked to you/i;
  const linkedKeys = Object.keys(en).filter((k) => LINKED.test(en[k]));
  assert.ok(linkedKeys.length >= 4,
    `only ${linkedKeys.length} canonical strings mention linkage; if the wording ` +
    `changed, update this test rather than deleting it`);

  const f = fallbacks();
  const silent = linkedKeys.filter((k) => f.has(k) && !LINKED.test(f.get(k)));
  assert.deepStrictEqual(silent, [],
    `these fallbacks drop the "linked to you" disclosure their canonical string ` +
    `carries: ${silent.join(", ")}`);
});

test("the three L6 fallbacks are byte-identical to their canonical strings", () => {
  /* The strongest available form of the contract for the three that were wrong:
     not merely non-contradictory, but the same sentence. Copied from the module
     at fix time rather than retyped, so drift cannot creep back in by a stray
     edit to one copy. */
  const decode = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const f = fallbacks();
  for (const k of ["test.pre.intro", "test.post.intro", "survey.intro"]) {
    assert.ok(f.has(k), `${k} has no fallback in index.html any more`);
    assert.strictEqual(decode(f.get(k)), en[k],
      `${k}: the fallback has drifted from its canonical string`);
  }
});
