/* tests/per-section-rendering.test.js
 *
 * Found live on the first six-section session (Mayumi, 2026-09-07): a picked
 * section re-pointed the CONTENT globals but the room kept rendering the
 * first section's DOM — the history / examination / investigation buttons,
 * the "patient in front of you" card, the strings that name the patient, and
 * the reference panels behind the PBL toolbar were all the default case's.
 * Every multi-section session had this; the mixed-session e2e asserted the
 * globals, never the DOM.
 *
 * These pin the contracts: applySectionContent() rebuilds the board and the
 * vignette and re-applies the {patientName} strings; a section carries its
 * vignette, its case identity and (optionally) its reference panels; the PBL
 * toolbar's panels follow the section like the roleplay's do; a new reply is
 * typed out word by word; and the picker groups the library by case.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (f) => fs.readFileSync(path.join(P, f), "utf8");
const SCRIPT = read("script.js");
const INIT = read("modA-llm-init.js");
const CONTENT = read("section-content.js");
const HTML = read("index.html");
const ROOM_CSS = read("room.css");
const STYLE = read("style.css");
const I18N = read("i18n.js");
const PICKER = read("section-picker.js");

function fnOf(src, name, len) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " must exist");
  return src.slice(at, at + (len || 3000));
}

/* ── applySectionContent: the DOM follows the section ─────────────────────── */

test("applySectionContent rebuilds the CASE first, then hands the room DOM to the lazy chunk", () => {
  const f = fnOf(SCRIPT, "applySectionContent", 9000);
  const rebuild = f.indexOf("rebuildCaseDerived();");
  const refresh = f.indexOf("window.CanamedSectionContent.refresh();");
  assert.ok(rebuild > 0 && refresh > rebuild, "refresh() must run AFTER rebuildCaseDerived() — the board is built from CASE");
  assert.match(f, /window\.CURRENT_SECTION_VIGNETTE = sec\.vignette \|\| sec\.summary \|\| null;/, "vignette first, blurb as the fallback");
  assert.match(f, /window\.CURRENT_SECTION_TYPE = slot\.type \|\| null;/, "the chunk gates the PBL rebuild on the slot type");
  // The DOM work itself is NOT in the eager bundle (byte budget): nothing here
  // touches the board or the card directly.
  assert.ok(!/buildButtons\(\)/.test(f) && !/modA-vignette-text/.test(f));
});

test("the lazy chunk rebuilds the workup board, renders the vignette and re-applies the {patientName} strings", () => {
  const board = fnOf(CONTENT, "renderPblBoard");
  assert.match(board, /if \(!document\.getElementById\("group-history"\)\) return;/, "guarded on the board existing");
  assert.match(board, /if \(typeof buildButtons === "function"\) buildButtons\(\);/);
  assert.match(board, /if \(typeof renderButtons === "function"\) renderButtons\(\);/, "then this slot's revealed state");
  assert.match(board, /if \(typeof renderFindings === "function"\) renderFindings\(\);/);
  const v = fnOf(CONTENT, "renderPblVignette");
  assert.match(v, /window\.CURRENT_SECTION_VIGNETTE/);
  assert.match(v, /getElementById\("modA-vignette-text"\)/);
  assert.match(v, /p\.textContent = /, "textContent — the text can be facilitator-authored");
  assert.ok(!/innerHTML/.test(v));
  assert.match(HTML, /<p id="modA-vignette-text">/, "the vignette paragraph must be addressable");
  const strings = fnOf(CONTENT, "reapplyPblStrings");
  assert.match(strings, /I\.applyI18n\(view\)/);
  assert.match(strings, /document\.getElementById\("stage-1"\)/);
  const view = fnOf(CONTENT, "renderPblView");
  assert.match(view, /if \(type && type !== "pbl"\) return;/, "a roleplay/branched slot leaves the hidden PBL view alone");
  assert.match(view, /renderPblBoard\(\);\s*renderPblVignette\(\);\s*reapplyPblStrings\(\);/);
  const refresh = CONTENT.slice(CONTENT.indexOf("root.CanamedSectionContent = { refresh"));
  assert.match(refresh, /renderPblView\(\)/, "refresh() must run it, so a section change re-renders");
  ["renderPblBoard", "renderPblVignette", "reapplyPblStrings", "renderPblView"].forEach(n =>
    assert.ok(CONTENT.includes("root." + n + " = " + n + ";"), n + " published"));
});

test("applySectionContent publishes the section's reference panels (null keeps the shipped markup)", () => {
  const f = fnOf(SCRIPT, "applySectionContent", 9000);
  assert.match(f, /window\.CURRENT_SECTION_REFERENCES = \(c\.references && typeof c\.references === "object"\)\s*\? c\.references : null;/);
});

/* ── registry: what a section carries ─────────────────────────────────────── */

test("a section carries its vignette, its case identity and (for PBL) its reference panels", () => {
  const ctx = {}; ctx.module = { exports: {} };
  ["case-content.js", "branched-seed.js", "mayumi-seed.js", "section-registry.js"].forEach(f => {
    // eslint-disable-next-line no-new-func
    new Function("window", "self", "module", read(f)).call(ctx, ctx, ctx, ctx.module);
  });
  const S = ctx.buildSectionRegistry(ctx.CANAMED_SCENARIOS);
  // Built-ins: the two halves of a case share its caseId; no references (shipped markup).
  assert.equal(S["chronic-pain-pbl"].caseId, S["chronic-pain-roleplay"].caseId);
  assert.equal(S["chronic-pain-pbl"].caseId, "chronic-pain");
  assert.ok(S["chronic-pain-pbl"].caseName && S["chronic-pain-pbl"].caseName.en);
  assert.equal(S["chronic-pain-pbl"].content.references, undefined);
  assert.equal(S["ward-escalation-branched"].caseId, "ward-escalation-branched");
  // Mayumi: six sections, ONE case, each with a vignette and the shared panels.
  for (let i = 1; i <= 6; i++) {
    const sec = S["mayumi-" + i + "-pbl"];
    assert.equal(sec.caseId, "mayumi", sec.id);
    assert.match(sec.caseName.en, /Mayumi/);
    assert.ok(sec.vignette && sec.vignette.en.length > 120, sec.id + " carries the long vignette");
    assert.ok(sec.summary.en.length <= 140, sec.id + " blurb is one line for the agenda: " + sec.summary.en.length);
    assert.notEqual(sec.summary.en, sec.vignette.en);
    const refs = sec.content.references;
    assert.ok(refs && refs.history && refs.guidelines && refs.recap, sec.id + " carries the three panels");
    assert.match(JSON.stringify(refs), /depress/i);
    assert.doesNotMatch(JSON.stringify(refs), /opioid|Lefebvre/i);
  }
});

/* ── section-content: the PBL toolbar's panels follow the section ─────────── */

test("renderPblPanels mirrors the roleplay contract: absent = untouched, declared = full control", () => {
  const f = fnOf(CONTENT, "renderPblPanels");
  assert.match(f, /if \(!panels\) return;/, "no `references` → the shipped chronic-pain prose stays");
  assert.match(f, /el\("refA-panel-" \+ id\)/);
  assert.match(f, /el\("refA-btn-" \+ id\)/);
  assert.match(f, /btn\.classList\.toggle\("hidden", !on\)/, "an undeclared panel hides its BUTTON too");
  assert.match(f, /_fillRoleplayPanel\(node, spec\)/, "same text-only filler — never innerHTML");
  assert.match(CONTENT, /const PBL_PANEL_IDS = \["history", "guidelines", "recap"\];/);
  const refresh = CONTENT.slice(CONTENT.indexOf("root.CanamedSectionContent = { refresh"));
  assert.match(refresh, /renderPblPanels\(\)/, "refresh() must run it, so a section change re-renders");
});

/* ── init: a new reply is typed out ────────────────────────────────────────── */

test("a NEW reply in the visible thread is typed word by word; replays and reduced motion render whole", () => {
  const rt = fnOf(INIT, "_renderTurn");
  assert.match(rt, /if \(animate && role === "assistant" && !_reducedMotion\(\)\)/);
  assert.match(rt, /_typewrite\(bub, content, host\)/);
  const child = fnOf(INIT, "_onChatChild");
  assert.match(child, /var fresh = t\.role === "assistant" && Number\(t\.at \|\| 0\) >= initStartedAt;/);
  assert.match(child, /fresh && who === activeId/, "only the visible thread animates");
  const rebuild = fnOf(INIT, "_rebuildForSlot");
  assert.match(rebuild, /_renderTurn\(_threadEl\(who\), t\.role, t\.content\);/, "a slot replay renders whole");
  const tw = fnOf(INIT, "_typewrite");
  assert.match(tw, /bub\.classList\.add\("is-typing"\)/);
  assert.match(tw, /bub\.classList\.remove\("is-typing"\)/);
  assert.match(INIT, /var TYPE_MAX_MS = 2500;/, "a long reply must not drag: words-per-tick scales to a cap");
  assert.match(ROOM_CSS, /\.moda-chat-bub\.is-typing::after/);
  assert.match(ROOM_CSS, /prefers-reduced-motion: reduce\) \{\s*\.moda-chat-bub\.is-typing::after \{ animation: none; \}/);
});

/* ── picker: case first, then the parts ───────────────────────────────────── */

function loadPicker(library) {
  const win = { CANAMED_SECTIONS: library };
  const doc = { getElementById() { return null; }, createElement() { return { appendChild() {}, setAttribute() {}, classList: { toggle() {} } }; } };
  const src = PICKER +
    "\nthis.__exports = { caseGroups: caseGroups, sectionLibraryList: sectionLibraryList };";
  const ctx = { window: win, document: doc, tc: (v) => (v && v.en) || v, _curLang: () => "en",
                el: () => null, MAX_SECTION_SLOTS: 8, sectionTypeLabel: (t) => t };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "tc", "_curLang", "el", "MAX_SECTION_SLOTS", src)
    .call(ctx, win, doc, ctx.tc, ctx._curLang, ctx.el, ctx.MAX_SECTION_SLOTS);
  return ctx.__exports;
}

test("caseGroups groups the flat library by case, keeping library order and each case's part order", () => {
  const lib = {
    "a-pbl":      { id: "a-pbl",      type: "pbl",      caseId: "a", caseName: { en: "Case A" }, name: { en: "A workup" } },
    "a-roleplay": { id: "a-roleplay", type: "roleplay", caseId: "a", caseName: { en: "Case A" }, name: { en: "A roleplay" } },
    "m-1-pbl":    { id: "m-1-pbl",    type: "pbl",      caseId: "m", caseName: { en: "Mayumi" },  name: { en: "Initial information" } },
    "m-2-pbl":    { id: "m-2-pbl",    type: "pbl",      caseId: "m", caseName: { en: "Mayumi" },  name: { en: "The home visit" } },
    "b-branched": { id: "b-branched", type: "branched", source: "b-branched", name: { en: "B" } }
  };
  const api = loadPicker(lib);
  const groups = api.caseGroups();
  assert.deepEqual(groups.map(g => g.id), ["a", "m", "b-branched"]);
  assert.deepEqual(groups[0].sections.map(s => s.id), ["a-pbl", "a-roleplay"]);
  assert.deepEqual(groups[1].sections.map(s => s.id), ["m-1-pbl", "m-2-pbl"]);
  assert.equal(groups[1].name.en, "Mayumi");
  assert.equal(groups[2].name.en, "B", "a case with no caseName falls back to its section's name");
});

test("the create form has the case block above the list, and the strings exist", () => {
  const caseAt = HTML.indexOf('id="splash-case-add"');
  const listAt = HTML.indexOf('id="splash-section-list"');
  const singleAt = HTML.indexOf('id="splash-section-add"');
  assert.ok(caseAt > 0 && listAt > caseAt && singleAt > listAt, "case → list → single-section add");
  assert.match(HTML, /id="splash-case-parts"/);
  assert.match(HTML, /id="splash-case-add-btn"/);
  ["splash.create.case-label", "splash.create.case-help", "splash.create.case-add"].forEach(k =>
    assert.ok(I18N.includes('"' + k + '"'), k));
  assert.match(fnOf(PICKER, "wireSectionPicker"), /wireCasePicker\(\);/);
  assert.match(fnOf(PICKER, "populateSectionPicker", 4000), /populateCasePicker\(\);/);
  // The flat list is grouped by case with <optgroup>, never prefixed in the
  // option text (WebKit counts the longest option toward the page width).
  const pop = fnOf(PICKER, "populateSectionPicker", 4000);
  assert.match(pop, /document\.createElement\("optgroup"\)/);
  assert.match(pop, /og\.label = _caseTitle\(g, lang\);/);
  assert.ok(!/cn \+ ": "/.test(pop), "no case-name prefix in the option text");
  // The slot cap is REPORTED, never silently applied: one click can ask for six.
  const addOne = fnOf(PICKER, "addSectionPick");
  assert.match(addOne, /return true;/); assert.match(addOne, /return false;/);
  assert.match(addOne, /"splash\.create\.sections-full"/);
  const addParts = fnOf(PICKER, "addCasePartsPick");
  assert.match(addParts, /if \(addSectionPick\(cb\.value\)\) added\+\+;/);
  assert.match(addParts, /if \(added < wanted && typeof toast === "function"\)/);
  assert.match(addParts, /_pickT\("splash\.create\.case-full"/, "top-level helper — the picker's T is function-scoped and unreachable here");
  assert.match(addOne, /_pickT\("splash\.create\.sections-full"/);
  ["splash.create.case-full", "splash.create.sections-full"].forEach(k =>
    assert.ok(I18N.includes('"' + k + '"'), k));
  // The part names render through textContent (they can be facilitator-authored).
  assert.match(fnOf(PICKER, "renderCaseParts"), /name\.textContent = _secTitle\(sec, lang\);/);
  assert.ok(!/innerHTML/.test(fnOf(PICKER, "renderCaseParts")));
  // Styles use tokens only.
  const block = STYLE.slice(STYLE.indexOf(".splash-case-add {"), STYLE.indexOf(".splash-section-add {"));
  assert.ok(block.length > 50);
  assert.ok(!/#[0-9a-fA-F]{3,6}\b|\d+px/.test(block), "tokens, never raw hex or px");
});
