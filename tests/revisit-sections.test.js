/* tests/revisit-sections.test.js
 *
 * S6 — the retention self-check (revisit.html) under the section model.
 *
 * ⚠️ CORRECTION to decision 13. The plan assumed revisit.html re-opened a past
 * SESSION, so the hard cutover would break older links. It does not: it reads an
 * id from ?s= and renders that content's post-test from the registry, never
 * touching session state. So the change here is ADDITIVE — a section id now
 * resolves to that section's own post-test (decision 3), and every
 * previously-shared scenario link keeps working exactly as before.
 *
 * That is a better outcome than the decision accepted, so it is taken.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const JS = fs.readFileSync(path.join(P, "revisit.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "revisit.html"), "utf8");

/* Build the real registries the way the page does. */
function registries() {
  const win = {};
  ["case-content.js", "branched-seed.js", "section-registry.js"].forEach(f => {
    const p = path.join(P, f);
    if (!fs.existsSync(p)) return;
    new Function("window", "self", fs.readFileSync(p, "utf8")).call(win, win, win);
  });
  const scenarios = win.CANAMED_SCENARIOS || {};
  return { scenarios, sections: win.buildSectionRegistry(scenarios) };
}

/* Mirror revisit.js's resolution, which is the line under test. */
function resolve(sid) {
  const { scenarios, sections } = registries();
  return sections[sid] || scenarios[sid] || scenarios[Object.keys(scenarios)[0]];
}

test("a SECTION id resolves to that section's own post-test", () => {
  const sec = resolve("jaundice-roleplay");
  assert.ok(sec, "the section library must be reachable from this page");
  assert.ok(Array.isArray(sec.postTest) && sec.postTest.length,
    "a revisit link for a section must re-test THAT section");
  /* Decision 3: the section's items, not the whole case's. */
  const whole = registries().scenarios["breaking-bad-news-disclosure"];
  assert.ok(sec.postTest.length < whole.postTest.length,
    "it must be the section's subset, not the case's full set");
});

test("an OLD scenario link still resolves — nothing shared before this breaks", () => {
  const sc = resolve("chronic-pain-opioids");
  assert.ok(sc && Array.isArray(sc.postTest) && sc.postTest.length);
  assert.equal(sc.postTest.length,
    registries().scenarios["chronic-pain-opioids"].postTest.length,
    "a legacy link must still show the whole case's post-test");
});

test("an unknown id still falls back rather than showing an empty page", () => {
  assert.ok(resolve("no-such-thing-at-all"));
});

test("sections are resolved BEFORE scenarios, so an id collision favours the section", () => {
  const i = JS.indexOf("var sc = sections[sid]");
  assert.ok(i > -1, "section lookup must come first");
  assert.match(JS.slice(i, i + 120), /sections\[sid\] \|\| scenarios\[sid\]/);
});

test("the page loads the registry chain in dependency order", () => {
  /* section-registry.js reads CANAMED_SCENARIOS, and branched-seed merges the
     branched case into it — all three are `defer`, which preserves order. */
  const order = ["case-content.js", "branched-seed.js", "section-registry.js", "revisit.js"];
  /* Match the SCRIPT TAG, not the bare filename: the file names also appear in
     the comment above them, and indexOf would find those first. */
  let last = -1;
  order.forEach(f => {
    const at = HTML.indexOf('src="' + f + '?v=');
    assert.ok(at > -1, f + " must be loaded with a cache-busted src");
    assert.ok(at > last, f + " must load after the file it depends on");
    last = at;
  });
});
