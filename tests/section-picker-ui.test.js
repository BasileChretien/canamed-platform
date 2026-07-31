/* tests/section-picker-ui.test.js
 *
 * S3b: the create form's section picker. "Scenario (the clinical case for this
 * workshop)" stops being the primary control — a facilitator picks the SECTIONS
 * the session runs, in order, possibly from different clinical cases.
 *
 * It also supersedes M2's "Modules to run" tick-row: a section pick IS the
 * module set, expressed at a granularity the tick-row could not reach (two
 * sections of the same type).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(P, "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(P, "style.css"), "utf8");

function fnOf(name) {
  const i = SCRIPT.indexOf("function " + name + "(");
  assert.ok(i > -1, name + "() must exist");
  return SCRIPT.slice(i, SCRIPT.indexOf("\nfunction ", i + 1));
}
/* Comment-blind view of a function. A guard like "never innerHTML" otherwise
   matches the word inside the comment that EXPLAINS the guard — which is how
   the same assertion misfired twice during this refactor. */
function codeOf(name) {
  return fnOf(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("the picker ships in the shell and is the ONLY content control", () => {
  /* Was "above the scenario field", ordering the picker against a select that
     no longer exists. The S7 cutover deleted it, so the assertion becomes the
     stronger one it was always standing in for. */
  assert.ok(HTML.indexOf('id="splash-section-list"') > -1);
  assert.ok(HTML.indexOf('id="splash-section-add"') > -1);
  assert.ok(HTML.indexOf('id="splash-section-add-btn"') > -1);
  assert.ok(HTML.indexOf("splash-sections-field") > -1);

  /* The Scenario select and everything that hung off it are GONE from the
     shell — not hidden. Each of these was a route to content that bypassed the
     section model. */
  ["splash-create-scenario", "splash-scenario-desc", "splash-report-scenario",
   "splash-create-custom", "splash-custom-wrap", "splash-create-advanced-toggle"]
    .forEach(id => {
      assert.equal(HTML.indexOf('id="' + id + '"'), -1,
        id + " must be deleted from index.html, not merely hidden");
    });
  assert.equal(SCRIPT.indexOf("splash-create-scenario"), -1,
    "and no script may still reach for it");
});

test("a session cannot be created with NO sections", () => {
  /* Before the cutover an empty pick was legal: the session fell back to the
     chosen scenario's shape. There is no scenario to fall back to now, so an
     empty pick would create a session with NO CONTENT — the failure the
     Scenario select used to mask. */
  assert.match(SCRIPT, /if \(!_sectionCsv\) \{/,
    "the submit handler must refuse an empty pick");
  assert.match(SCRIPT, /splash\.create\.sections-required/,
    "…with a translated message, not a silent return");
  const i18n = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
  assert.match(i18n, /"splash\.create\.sections-required":/);
  ["fr", "ja"].forEach(lang => {
    const t = fs.readFileSync(path.join(P, "locales", lang + ".js"), "utf8");
    assert.match(t, /"splash\.create\.sections-required":/,
      lang + " must carry the key — tests/i18n.test.js enforces core-lang parity");
  });
});

test("moderation reporting MOVED with the content — it did not go away", () => {
  /* Deleting the Scenario select would otherwise have removed the only UI for
     reporting a shared scenario (PRs #227/#228). A safety feature must not be
     collateral damage of a layout change. */
  assert.match(SCRIPT, /function reportAuthoredSection\(/,
    "reporting must still exist");
  assert.match(SCRIPT, /entry\.source !== "shared"/,
    "only SOMEONE ELSE's shared scenario is reportable");
  assert.match(SCRIPT, /entry\.ownerUid \+ "_" \+ entry\.scenarioId/,
    "shareId must match sharedScenarios' own key shape");
  const f = fnOf("renderSectionPick");
  assert.match(f, /authored\.source === "shared"/,
    "the row must offer it for a shared authored section");
  assert.match(SCRIPT, /reportSharedScenario\(shareId\)/,
    "…and still write the write-once report");
});

test("the guided tour does not point at the deleted select", () => {
  /* A tour step anchored to a removed id silently does nothing, and this one
     ALSO told facilitators they could "paste a custom scenario as JSON" — the
     exact path the cutover removed. Both had to change together. */
  const tour = fs.readFileSync(path.join(P, "tour.js"), "utf8");
  assert.equal(tour.indexOf("splash-create-scenario"), -1);
  assert.match(tour, /anchor: "splash-section-add"/);
  const i18n = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
  const body = i18n.match(/"tour\.create\.2\.body": "([^"]*)"/);
  assert.ok(body, "the tour step must still have a body");
  assert.ok(!/JSON/i.test(body[1]),
    "the tour must not advertise a JSON paste path that no longer exists");
});

test("the superseded module tick-row is gone from the form", () => {
  assert.ok(HTML.indexOf("splash-create-mod-") === -1);
});

test("pick order is preserved, and reordering swaps neighbours", () => {
  const f = fnOf("moveSectionPick");
  assert.match(f, /if \(j < 0 \|\| j >= splashSectionPick\.length\) return;/,
    "the ends must not wrap");
  assert.match(f, /renderSectionPick\(\)/);
});

test("duplicates are ALLOWED — running a section twice is legitimate", () => {
  const f = fnOf("addSectionPick");
  assert.ok(!/indexOf\(id\) > -1|includes\(id\)/.test(f),
    "the slot model keys state by POSITION, not by section id");
  assert.match(f, /splashSectionPick\.length >= MAX_SECTION_SLOTS/,
    "…but the physical slot cap the DB rules enforce still applies");
});

test("section titles are rendered as TEXT — they can be facilitator-authored", () => {
  assert.ok(!/innerHTML/.test(codeOf("renderSectionPick")));
  const f = fnOf("renderSectionPick");
  /* The row now renders through the SAME i18n pattern as the student's stage
     label, so the facilitator's list and the stage read identically in every
     language rather than the picker being the one hardcoded-English part of an
     otherwise-translated form. */
  assert.match(f, /window\.t\("stage\.label\.section"\)/,
    "the row must reuse the student's stage-label pattern");
  assert.match(f, /tpl\.replace\("\{n\}", String\(i \+ 1\)\)/,
    "…numbered by position");
});

test("the row is numbered by POSITION, matching the student's stage label", () => {
  const f = fnOf("renderSectionPick");
  assert.match(f, /window\.t\("stage\.label\.section"\)/,
    "same pattern the student sees on the stage");
  assert.match(f, /replace\("\{title\}", title\)/);
});

test("an empty pick writes NO sections field — the session falls back", () => {
  /* This used to pin sectionPickCsv's exact SOURCE TEXT
     (`splashSectionPick.length ? … : null`), which broke the moment the
     function legitimately grew the authored-section mapping while keeping the
     behaviour identical. Assert the BEHAVIOUR: empty pick → null. */
  const f = fnOf("sectionPickCsv");
  assert.match(f, /if \(!splashSectionPick\.length\) return null;/,
    "an empty pick must still yield null, not an empty string");
  assert.match(SCRIPT, /if \(typeof sections === "string" && sections\)/,
    "createSession must skip the write when nothing was picked");
});

test("an AUTHORED pick is written as custom-<slot>, never its synthetic key", () => {
  /* The one that would only fail in PRODUCTION. The `sections` CSV validator is
     /^[A-Za-z0-9_-]{1,48}(,...)*$/ — no colons — so writing the in-form key
     "authored:<uid>:<scenarioId>:<type>" is REJECTED at write time. LOCAL-mode
     Playwright does not exercise rules, so nothing else in the suite can catch
     a regression here. */
  const f = fnOf("sectionPickCsv");
  assert.match(f, /isAuthoredSectionKey\(id\)/,
    "the CSV mapper must recognise an authored pick");
  assert.match(f, /"custom-" \+ \(i \+ 1\)/,
    "…and emit custom-<slot>, since the slot IS the position");

  // And every token the mapper can emit must satisfy the rule's own regex.
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
  const v = rules.rules.sessions.$sessionId.sections[".validate"];
  const m = v.match(/matches\(\/(.+?)\/\)/);
  assert.ok(m, "the sections validator must carry a regex");
  const csvRe = new RegExp(m[1]);
  assert.ok(csvRe.test("custom-1,chronic-pain-pbl,custom-3"),
    "a mixed built-in/authored pick must satisfy the DB validator");
  assert.ok(!csvRe.test("authored:abc:my-case:pbl"),
    "…and the synthetic key must NOT — this is the failure being guarded");
});

test("authored section bodies are snapshotted per slot, matching the tokens", () => {
  const f = fnOf("sectionPickBodies");
  assert.match(f, /String\(i \+ 1\)/, "keyed by slot, like the custom-<slot> token");
  assert.match(SCRIPT, /oPath\(code, "sectionBodies\/" \+ slot\)\)\.set\(body\)/,
    "createSession must write each authored body");
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
  const sb = rules.rules.sessions.$sessionId.sectionBodies;
  assert.ok(sb, "the sectionBodies node must exist in the sessions tree");
  assert.equal(sb.$slot[".write"], "auth != null && !data.exists()",
    "write-once: a session's content must not change after creation");
  assert.ok(rules.rules.orgs.$orgSlug.sessions.$sessionId.sectionBodies,
    "…and mirrored in the org tree, or org sessions fail closed");
});

test("a late pre-sign-in picker load cannot overwrite the signed-in one", () => {
  /* Two call sites invoke loadAuthoredSectionsIntoPicker (wireSplash on load,
     and the auth-state handler after sign-in), each doing up to CAP async
     reads. They overlap and settle in an unspecified order, so without a
     generation guard the LOSER wins: the pre-sign-in pass lands last, replaces
     the map with the shared-only set, and the filter right below it then drops
     any authored pick the facilitator had already arranged. */
  const f = fnOf("loadAuthoredSectionsIntoPicker");
  assert.match(f, /const gen = \+\+_authoredSectionsGen;/,
    "each call must claim a generation as it starts");
  assert.match(f, /if \(gen !== _authoredSectionsGen\) return;/,
    "…and a superseded call must commit NOTHING");
  // The guard has to precede the assignment, or it guards nothing.
  assert.ok(f.indexOf("if (gen !== _authoredSectionsGen) return;") <
            f.indexOf("splashAuthoredSections = next;"),
    "the generation check must come BEFORE the assignment it protects");
  assert.match(SCRIPT, /let _authoredSectionsGen = 0;/);
});

test("authored sections survive a COLD load — the lazy library lands later", () => {
  /* The regression the cutover created. loadAuthoredSectionsIntoPicker() runs
     during splash wiring, BEFORE the lazy section-registry.js has landed, so
     its `typeof window.sectionsForScenario !== "function"` guard fired every
     time — and nothing retried. On a cold load no authored or shared section
     appeared in the picker at all.

     Survivable while the Scenario select existed (it listed shared scenarios
     itself); with the select deleted the picker is the ONLY route to them, so
     this also silently disabled the moderation filter — you cannot hide a
     tombstoned scenario from a list that never renders. */
  const f = fnOf("loadAuthoredSectionsIntoPicker");
  assert.match(f, /ensureCaseContent\(\)\s*\n?\s*\.then\(loadAuthoredSectionsIntoPicker\)/,
    "the not-loaded-yet branch must chain onto the fetch and come back");
  assert.match(f, /_authoredSectionsTries \+= 1;/);
  assert.match(f, /if \(_authoredSectionsTries > 3\) return Promise\.resolve\(\);/,
    "bounded — section-registry.js is optional and its load failure is swallowed, " +
    "so an unbounded retry would recurse for ever on an already-settled promise");
  // The same bounded-retry shape the built-in half has always used.
  assert.match(fnOf("populateSectionPicker"), /ensureCaseContent\(\)\.then\(populateSectionPicker\)/);
});

test("an oversized authored section is refused BEFORE anything is written", () => {
  /* The bodies are written after `created` and `recovery` — the rule requires
     the CSV to already name custom-<slot>, so they cannot share that batch. A
     body over the cap therefore rejected a write once the session half-existed,
     and tryCreate reported it as "check your connection", hiding the cause. */
  const body = fnOf("sectionPickBodies");
  assert.match(body, /json\.length > SECTION_BODY_MAX_LEN/,
    "the snapshotter must measure each body against the cap");
  assert.match(body, /return \{ bodies: out, oversized: oversized \};/,
    "…and report what it refused, rather than silently dropping it");

  // The refusal must happen before the create begins, not inside the catch.
  const iCheck = SCRIPT.indexOf("if (_snapshot.oversized.length) {");
  const iCreating = SCRIPT.indexOf('cHint.textContent = "Creating session…";');
  assert.ok(iCheck > -1, "tryCreate must check for oversized bodies");
  assert.ok(iCheck < iCreating,
    "the check must precede the create — after it, `created` is already written");
  assert.match(SCRIPT, /splash\.create\.section-too-big/,
    "…with a translated message naming the section, not a generic failure");

  /* An oversized section must be recorded and then SKIPPED — the guard block
     has to bail before the body assignment, or the create is refused while the
     over-cap body is still queued for a write that the rules will reject. */
  assert.match(body, /oversized\.push\([^\n]*\);\s*\n\s*return;\s*\n\s*\}/,
    "recording an oversized section must be followed immediately by return");
});

test("the client's body cap is the SAME number the rules enforce", () => {
  /* Two independent sources of one truth: a client cap looser than the rule
     lets the rejected write through again, and a stricter one blocks sessions
     the DB would have accepted. Derive the rule's number, don't restate it. */
  const m = SCRIPT.match(/const SECTION_BODY_MAX_LEN = (\d+);/);
  assert.ok(m, "the client cap must exist as a named constant");
  const clientCap = Number(m[1]);

  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
  const trees = [
    rules.rules.sessions.$sessionId.sectionBodies,
    rules.rules.orgs.$orgSlug.sessions.$sessionId.sectionBodies
  ];
  trees.forEach((sb, i) => {
    const v = sb.$slot[".validate"];
    const cap = v.match(/newData\.val\(\)\.length <= (\d+)/);
    assert.ok(cap, "tree " + i + " must cap the body length");
    assert.equal(clientCap, Number(cap[1]),
      "tree " + i + ": the client cap must equal the rule's cap");
  });
});

test("the too-big message carries fr + ja, like every user-facing key", () => {
  const i18n = fs.readFileSync(path.join(P, "i18n.js"), "utf8");
  assert.match(i18n, /"splash\.create\.section-too-big":/);
  ["fr", "ja"].forEach(lang => {
    const t = fs.readFileSync(path.join(P, "locales", lang + ".js"), "utf8");
    assert.match(t, /"splash\.create\.section-too-big":/,
      lang + " must carry the key — tests/i18n.test.js enforces core-lang parity");
  });
  // The message names the offending section, so the placeholder must survive.
  assert.match(i18n, /"splash\.create\.section-too-big": "[^"]*\{title\}/);
  assert.match(SCRIPT, /\.replace\("\{title\}", first\.title\)/);
});

test("the pick is written write-once, like the module narrowing before it", () => {
  assert.match(SCRIPT, /oPath\(code, "sections"\)\)\.set\(sections\)/);
  const rules = JSON.parse(fs.readFileSync(path.join(P, "database.rules.json"), "utf8"));
  const s = rules.rules.sessions.$sessionId.sections;
  assert.equal(s[".write"], "auth != null && !data.exists()");
});

test("the add-list fills itself once the lazy library lands", () => {
  /* section-registry.js is chained after case-content, so on a cold load the
     picker is rendered before the library exists. Without the retry it would
     stay permanently empty. */
  const f = fnOf("populateSectionPicker");
  assert.match(f, /ensureCaseContent\(\)\.then\(populateSectionPicker\)/);
});

test("the picker is wired eagerly and only once", () => {
  const f = fnOf("wireSectionPicker");
  assert.match(f, /if \(!btn \|\| btn\._wired\) return;/);
  assert.match(SCRIPT, /wireSectionPicker\(\);\s*\n\s*populateSectionPicker\(\);/);
});

test("every custom property the picker uses actually EXISTS in tokens.css", () => {
  /* Invented token names do not fail loudly — `var(--space-1)` is simply an
     invalid declaration the browser DROPS, so the rule silently does nothing.
     That is exactly what happened here first time round (padding and margins
     computed to 0 with no error anywhere). */
  const TOKENS = fs.readFileSync(path.join(P, "tokens.css"), "utf8");
  const i = CSS.indexOf(".splash-section-list");
  const end = CSS.indexOf("}", CSS.indexOf(".splash-section-add select", i)) + 1;
  const used = new Set((CSS.slice(i, end).match(/var\((--[a-z0-9-]+)\)/g) || [])
    .map(m => m.replace(/var\(|\)/g, "")));
  used.forEach(t =>
    assert.ok(TOKENS.indexOf(t + ":") > -1, t + " is not defined in tokens.css"));
  assert.ok(used.size >= 4, "the picker should be token-driven, not hardcoded");
});

test("the picker styles use tokens, never raw hex or px", () => {
  const i = CSS.indexOf(".splash-section-list");
  const end = CSS.indexOf("}", CSS.indexOf(".splash-section-add select", i)) + 1;
  /* Strip comments FIRST: a prose reference like "PR #172" reads as a hex
     colour to this regex. Third time a comment has tripped a source guard in
     this refactor — assert against the code, not the prose explaining it. */
  const block = CSS.slice(i, end).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), "no raw hex — tokens.css owns colour");
  assert.ok(!/:\s*\d+px/.test(block.replace(/1px solid/g, "")),
    "no raw px spacing — use the space scale");
});

test("authored snapshots are registered BEFORE the pick is published", () => {
  /* Ordering bug with no error message. setSessionSections() triggers
     refreshModuleStages(), which resolves every token against
     window.CANAMED_SECTIONS. Register the snapshots after it and each
     custom-<slot> is simply dropped as unresolvable — the stage does not
     exist, no exception, no console warning, just a session missing a section.
     Assert the source order rather than trusting a comment. */
  const reg = SCRIPT.indexOf("registerSectionBodies(res[5]");
  const set = SCRIPT.indexOf("setSessionSections(res[4]");
  assert.ok(reg > -1, "the session load must register authored snapshots");
  assert.ok(set > -1, "…and publish the pick");
  assert.ok(reg < set,
    "registerSectionBodies must run BEFORE setSessionSections, or every " +
    "custom-<slot> resolves against a library that does not contain it yet");
});

test("a malformed snapshot degrades to skipping ONE slot, not the session", () => {
  const f = fnOf("registerSectionBodies");
  assert.match(f, /try \{ sec = JSON\.parse\(raw\); \}/,
    "an unparseable snapshot must not throw out of the session load");
  assert.match(f, /if \(!sec \|\| typeof sec !== "object" \|\| !sec\.type\)/,
    "a snapshot with no type cannot become a stage — skip it explicitly");
  assert.match(f, /return;/, "…and skip only that slot");
});

test("clone-last-workshop cannot revive a custom-<slot> token", () => {
  /* saveLastWorkshop persists sectionPickCsv()'s output, where an authored pick
     has ALREADY become "custom-<slot>" — a token meaning "the body stored on
     THAT session". Restoring it into a new pick would give the new session a
     slot nothing can resolve. It can even survive the resolve-check: once this
     tab has joined a session, registerSectionBodies() has put custom-<slot>
     into CANAMED_SECTIONS, so sectionLibEntry() finds the PREVIOUS session's
     section and keeps it. */
  assert.match(SCRIPT, /\.filter\(id => !\/\^custom-\[1-9\]\$\/\.test\(id\)\)/,
    "the clone restore must drop custom-<slot> tokens before resolving them");
});
