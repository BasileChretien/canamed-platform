/* tests/rcol-tab-a11y.test.js
 *
 * Regression guard for the UX-overload fix (2026-06-01) to the Module A
 * right-column tab bar (Decide together | Debate | Our final answers).
 *
 * Two defects were verified against the live code:
 *   1. The decisions + answers tab BUTTONS had no id, yet their tabpanels
 *      used aria-labelledby="rcol-tab-decisions"/"…-answers" — a dangling
 *      reference, so the panels had no accessible name.
 *   2. style.css hid the tab LABEL on <=720px (`.rcol-tab-label{display:none}`)
 *      while the icon is aria-hidden — leaving each tab with NO accessible
 *      name at all on phones (WCAG 4.1.2), the device class workshops run on.
 *
 * These tests pin the bidirectional tab <-> tabpanel ARIA wiring and the
 * "label stays visible on mobile" invariant. Static assertions, no DOM.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const INDEX = fs.readFileSync(path.join(PLATFORM, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(PLATFORM, "style.css"), "utf8");

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

// Opening tags for the Module A tab buttons and their tabpanels.
const tabTags = [...INDEX.matchAll(/<button\b[^>]*class="rcol-tab\b[^"]*"[\s\S]*?>/g)].map((m) => m[0]);
const panelTags = [...INDEX.matchAll(/<div\b[^>]*class="rcol-panel\b[^"]*"[\s\S]*?>/g)].map((m) => m[0]);

const tabs = tabTags.map((t) => ({
  id: attr(t, "id"),
  controls: attr(t, "aria-controls"),
  role: attr(t, "role"),
}));
const panels = panelTags.map((p) => ({
  id: attr(p, "id"),
  labelledby: attr(p, "aria-labelledby"),
  role: attr(p, "role"),
}));

const tabIds = new Set(tabs.map((t) => t.id).filter(Boolean));
const panelIds = new Set(panels.map((p) => p.id).filter(Boolean));

test("there are 2 Module A tabs and 2 tabpanels", () => {
  // Debate + answers MERGED into one tab (2026-06-25): Decide together | Debate & answers.
  assert.equal(tabs.length, 2, "expected Decide together / Debate & answers tabs");
  assert.equal(panels.length, 2, "expected one panel per tab");
});

test("every Module A tab button has an id and role=tab", () => {
  for (const t of tabs) {
    assert.ok(t.id, "a .rcol-tab button is missing an id (tabpanels reference it)");
    assert.equal(t.role, "tab", `${t.id} should have role="tab"`);
  }
  // the specific ids the panels expect must exist (Debate tab merged into answers)
  for (const id of ["rcol-tab-decisions", "rcol-tab-answers"]) {
    assert.ok(tabIds.has(id), `tab button id #${id} must exist`);
  }
});

test("each tab's aria-controls resolves to a real tabpanel id", () => {
  for (const t of tabs) {
    assert.ok(t.controls, `${t.id} must have aria-controls`);
    assert.ok(panelIds.has(t.controls),
      `${t.id} aria-controls="${t.controls}" has no matching tabpanel`);
  }
});

test("each tabpanel's aria-labelledby resolves to a real tab button id (no dangling refs)", () => {
  for (const p of panels) {
    assert.equal(p.role, "tabpanel", `${p.id} should have role="tabpanel"`);
    assert.ok(p.labelledby, `${p.id} must have aria-labelledby (was missing → no accessible name)`);
    assert.ok(tabIds.has(p.labelledby),
      `${p.id} aria-labelledby="${p.labelledby}" points at a non-existent tab button id`);
  }
});

test("tab <-> tabpanel references are mutually consistent", () => {
  for (const t of tabs) {
    const p = panels.find((pp) => pp.id === t.controls);
    assert.ok(p, `${t.id} controls ${t.controls} which is missing`);
    assert.equal(p.labelledby, t.id,
      `${t.id} controls ${p.id}, so ${p.id} must be labelled-by ${t.id} (got ${p.labelledby})`);
  }
});

test("the tab label is NOT hidden on mobile (keeps an accessible name + readable verb)", () => {
  // The whole defect: `.rcol-tab-label { display: none; }` inside the <=720px
  // block left the tabs as aria-hidden icons with no name. It must be gone.
  assert.doesNotMatch(
    CSS,
    /\.rcol-tab-label\s*\{[^}]*display:\s*none/,
    "the mobile rule must not hide .rcol-tab-label (WCAG 4.1.2 + L2 legibility)"
  );
  // and the label spans must still be present in the markup
  assert.match(INDEX, /class="rcol-tab-label"[^>]*data-i18n="rcol\.tab\.decisions"/,
    "the Decide tab must carry a localized visible label");
});
