/* tests/knowledge-checks-expanded.test.js
 *
 * Session-3 facilitator ask (2026-05-27): "the knowledge check (pre and post-
 * test) were a bit longer in previous sessions." The chronic-pain and breaking-
 * bad-news pre/post banks were expanded to 10 questions each (chronic-pain
 * +5/+5; breaking-bad-news +4/+4). The new items are DRAFTS pending PI
 * (clinical) sign-off; this test pins their structural integrity so a malformed
 * bank can't ship: 10 questions, contiguous q1..q10 ids, exactly one correct
 * option per question, 4 options each, and complete en/fr/ja everywhere.
 *
 * Loaded with a window shim (same approach as case-more-wrong-items.test.js).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");

function loadBanks() {
  let src = fs.readFileSync(path.join(P, "case-content.js"), "utf8");
  src += "\nthis.__B = {" +
    "PRETEST_CHRONIC_PAIN: PRETEST_CHRONIC_PAIN," +
    "POSTTEST_CHRONIC_PAIN: POSTTEST_CHRONIC_PAIN," +
    "PRETEST_BREAKING_BAD_NEWS: PRETEST_BREAKING_BAD_NEWS," +
    "POSTTEST_BREAKING_BAD_NEWS: POSTTEST_BREAKING_BAD_NEWS };";
  const ctx = {};
  // eslint-disable-next-line no-new-func
  new Function("window", "self", src).call(ctx, {}, {});
  return ctx.__B;
}

const tri = o => !!(o && typeof o.en === "string" && o.en.trim() &&
                    typeof o.fr === "string" && o.fr.trim() &&
                    typeof o.ja === "string" && o.ja.trim());

const BANKS = loadBanks();

Object.keys(BANKS).forEach(name => {
  const bank = BANKS[name];

  test(name + ": has 10 questions with contiguous q1..q10 ids", () => {
    assert.equal(bank.length, 10, name + " should have 10 questions");
    assert.deepEqual(bank.map(q => q.id),
      Array.from({ length: 10 }, (_, i) => "q" + (i + 1)),
      name + " ids must be q1..q10 in order");
  });

  test(name + ": every question is well-formed + fully trilingual", () => {
    bank.forEach((q, i) => {
      const where = name + " " + (q.id || ("#" + i));
      assert.ok(tri(q.q), where + ": stem must be en/fr/ja");
      assert.ok(tri(q.explanation), where + ": explanation must be en/fr/ja");
      assert.ok(Array.isArray(q.options) && q.options.length === 4,
        where + ": must have exactly 4 options");
      const correct = q.options.filter(o => o.correct === true).length;
      assert.equal(correct, 1, where + ": must have exactly one correct option");
      q.options.forEach((o, j) => assert.ok(tri(o.text), where + " option " + j + ": en/fr/ja"));
    });
  });

  test(name + ": the correct answer is not always in the same slot", () => {
    const slots = new Set(bank.map(q => q.options.findIndex(o => o.correct === true)));
    assert.ok(slots.size >= 2, name + ": correct-answer position should vary across questions");
  });
});
