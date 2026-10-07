/* tests/privacy-ja-line-breaks.test.js
 *
 * In HTML a line break in running text is rendered as a SPACE. That is what an
 * English or French sentence wants between two words. Japanese writes no space
 * between words, so a source line wrapped in the middle of a phrase publishes a
 * stray one: 本プラット フォーム, 稼働中の プラットフォーム.
 *
 * The Japanese body of privacy.html was hand-wrapped at about 80 columns and
 * carried 125 of these. One whitespace-only pass removed them; this test keeps
 * them out, because the next edit to the notice will be wrapped by an editor
 * that knows nothing about this.
 *
 * THE RULE. Inside <section data-priv-lang="ja">, a line break that a browser
 * renders as a space, with a Japanese character on either side of it, must come
 * directly after 。 or 、. Those two already end a clause, so the space falls
 * where a reader pauses anyway. One sentence or clause per line satisfies the
 * rule, and so does one long line.
 *
 * What is NOT a rendered space, and is therefore free:
 *   - a break next to a block boundary (<p>, </li>, <h2> ...), because white
 *     space at the start and end of a block is dropped;
 *   - a break between two non-Japanese characters ("Hugging" / "Face").
 * What IS one, although it looks like markup: a break next to an INLINE tag.
 * `<strong>第28条</strong>`, newline, `を満たす` still renders 第28条 を満たす.
 *
 * To fix a failure, join the two lines. Where the space is wanted (around the
 * contact e-mail link, say), keep it as an ordinary space on the joined line:
 * the rule is about line breaks, not about a space someone typed on purpose.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "privacy.html");

/* core.autocrlf checks this file out as CRLF on Windows and as LF in CI.
   Normalise where it is read, so the scan and the line numbers agree. */
const readLF = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

const INLINE = new Set([
  "a", "abbr", "b", "cite", "code", "em", "i", "kbd", "mark", "q", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var",
]);
const BLOCK = new Set([
  "blockquote", "br", "dd", "details", "div", "dl", "dt", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "li", "ol", "p", "pre", "section", "summary", "table",
  "tbody", "td", "th", "thead", "tr", "ul",
]);
const CLAUSE_END = new Set(["。", "、"]);

/* Code points rather than a character class: kana, CJK punctuation, the
   ideographs and the full-width forms. */
function isJapanese(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3000 && c <= 0x30ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x20000 && c <= 0x3ffff)
  );
}

/* Only the white space HTML collapses. `\s` would also swallow U+3000 and a
   literal no-break space, which are characters a reader sees. */
const isCollapsible = (ch) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";

/* A tag nobody has classified must stop the test, not pass through it: read as
   a block it would hide every stray break beside it. */
function isInlineTag(tag) {
  if (tag.startsWith("<!--")) return true;
  const m = /^<\/?([a-z][a-z0-9]*)/i.exec(tag);
  assert.ok(m, `not a tag: ${tag}`);
  const name = m[1].toLowerCase();
  if (INLINE.has(name)) return true;
  assert.ok(BLOCK.has(name), `<${name}> is in neither INLINE nor BLOCK in this test: add it to the right one`);
  return false;
}

/* The character a reader sees to the LEFT of index `i`, stepping over white
   space, inline tags and comments. null at a block boundary. An entity counts
   as one non-Japanese character. */
function seenBefore(html, i) {
  for (;;) {
    while (i > 0 && isCollapsible(html[i - 1])) i--;
    if (i === 0) return null;
    if (html[i - 1] !== ">") {
      if (html[i - 1] === ";" && /&#?\w+;$/.test(html.slice(Math.max(0, i - 12), i))) return "&";
      const low = html.charCodeAt(i - 1) >= 0xdc00 && html.charCodeAt(i - 1) <= 0xdfff;
      return html.slice(i - (low ? 2 : 1), i);
    }
    const lt = html.lastIndexOf("<", i - 1);
    if (!isInlineTag(html.slice(lt, i))) return null;
    i = lt;
  }
}

/* The same, to the RIGHT of index `i`. */
function seenAfter(html, i) {
  for (;;) {
    while (i < html.length && isCollapsible(html[i])) i++;
    if (i >= html.length) return null;
    if (html[i] !== "<") {
      if (html[i] === "&" && /^&#?\w+;/.test(html.slice(i, i + 12))) return "&";
      return String.fromCodePoint(html.codePointAt(i));
    }
    const gt = html.startsWith("<!--", i) ? html.indexOf("-->", i) + 2 : html.indexOf(">", i);
    if (!isInlineTag(html.slice(i, gt + 1))) return null;
    i = gt + 1;
  }
}

/* Every line break in `html` that renders as a space inside Japanese text
   without following 。 or 、. `line` is the line the break ends. */
function strayBreaks(html, firstLine = 1) {
  const found = [];
  let line = firstLine;
  for (let i = html.indexOf("\n"); i !== -1; i = html.indexOf("\n", i + 1), line++) {
    const left = seenBefore(html, i);
    const right = seenAfter(html, i + 1);
    if (left === null || right === null) continue;
    if (CLAUSE_END.has(left)) continue;
    if (!isJapanese(left) && !isJapanese(right)) continue;
    found.push({ line, left, right });
  }
  return found;
}

function japaneseSection(html) {
  const m = /<section data-priv-lang="ja"[^>]*>[\s\S]*?<\/section>/.exec(html);
  assert.ok(m, "privacy.html has no <section data-priv-lang=\"ja\">");
  return { text: m[0], firstLine: html.slice(0, m.index).split("\n").length };
}

test("the scan reads a line break the way a browser renders it", () => {
  const count = (html) => strayBreaks(html).length;

  // the defect itself
  assert.strictEqual(count("<p>本プラット\n      フォーム</p>"), 1, "a break inside a word");
  assert.strictEqual(count("<p>稼働中の\n      プラットフォーム</p>"), 1, "a break inside a phrase");
  // an inline tag does not absorb the space
  assert.strictEqual(count("<p><strong>第28条</strong>\n      を満たす</p>"), 1, "after an inline closing tag");
  assert.strictEqual(count("<p>処理が\n      <strong>稼働中</strong>の</p>"), 1, "before an inline opening tag");
  // Japanese on ONE side is enough: 処理は 2026年 is as wrong as 処理は 稼働
  assert.strictEqual(count("<p>これらの処理は\n      2026年8月27日以降</p>"), 1, "Japanese, then a digit");
  assert.strictEqual(count("<p>APPI\n      第26条の3</p>"), 1, "Latin, then Japanese");
  assert.strictEqual(count("<p>提供先 &mdash;\n      各社</p>"), 1, "after an entity");
  // full-width punctuation other than 。 and 、 is not a clause end
  assert.strictEqual(count("<p>（GDPR第8条）\n      または</p>"), 1, "after a closing bracket");

  // allowed
  assert.strictEqual(count("<p>削除します。\n      その後は、\n      保持します。</p>"), 0, "after 。 and 、");
  assert.strictEqual(count("<p><strong>読み込みません。</strong>\n      読み込むのは</p>"), 0, "。 inside an inline tag");
  assert.strictEqual(count("<ul>\n  <li>一つ目</li>\n  <li>二つ目</li>\n</ul>"), 0, "block boundaries");
  assert.strictEqual(count("<p>\n      本文\n    </p>"), 0, "the edges of a block");
  assert.strictEqual(count("<p>Hugging\n      Face</p>"), 0, "between two Latin words");
});

test("an unclassified tag stops the scan instead of hiding a break", () => {
  assert.throws(() => strayBreaks("<p>本プラット<ruby>\n      フォーム</ruby></p>"), /neither INLINE nor BLOCK/);
});

test("no line break in the Japanese notice splits a phrase", () => {
  const html = readLF(FILE);
  const { text, firstLine } = japaneseSection(html);

  // Anti-vacuity: the section the scan walked really is the Japanese body.
  const japanese = Array.from(text).filter(isJapanese).length;
  assert.ok(japanese > 2000, `the Japanese section holds only ${japanese} Japanese characters: wrong slice?`);

  const lines = html.split("\n");
  const stray = strayBreaks(text, firstLine).map(
    (b) => `privacy.html:${b.line}  …${lines[b.line - 1].trim().slice(-14)} ⏎ ${lines[b.line].trim().slice(0, 14)}…`
  );
  assert.deepStrictEqual(
    stray,
    [],
    `${stray.length} line break(s) render as a space inside Japanese text. ` +
      "Join the two lines, or end the first one on 。 or 、."
  );
});
