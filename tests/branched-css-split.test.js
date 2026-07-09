/* tests/branched-css-split.test.js
 *
 * The branched-only CSS lives in a LAZILY-loaded branched.css (injected in-room
 * by applyScenario → CanamedLoader.ensureBranchedStyles), NOT in the eager
 * style.css, so it stays out of the splash first-party CSS budget. This locks
 * the split so a future edit can't silently move branched rules back into the
 * eager stylesheet (which is what kept threatening the perf budget).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
// Strip CSS comments so a pointer comment that NAMES a moved selector (e.g.
// "the .dec-documents evidence panel … lives in branched.css") isn't mistaken
// for the rule still being present.
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const BRANCHED_CSS = stripCss(fs.readFileSync(path.join(P, "branched.css"), "utf8"));
const STYLE_CSS = stripCss(fs.readFileSync(path.join(P, "style.css"), "utf8"));
const LOADER = fs.readFileSync(path.join(P, "script-loader.js"), "utf8");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const SW = fs.readFileSync(path.join(P, "sw.js"), "utf8");

// Selectors that are branched-ONLY → must live in branched.css, not style.css.
const BRANCHED_ONLY = [
  'body[data-format="branched"]',
  ".dec-documents",
  ".dec-documents-head",
  ".branched-rationale",
  ".branched-final-input",
  "#branched-final-host",
  ".room-choice-tree",
  ".ct-step",
];

test("branched.css carries every branched-only selector", () => {
  for (const sel of BRANCHED_ONLY) {
    assert.ok(
      BRANCHED_CSS.includes(sel),
      "branched.css must contain " + sel,
    );
  }
});

test("eager style.css no longer carries the branched-only selectors", () => {
  for (const sel of BRANCHED_ONLY) {
    assert.ok(
      !STYLE_CSS.includes(sel),
      sel + " leaked back into the eager style.css — keep it in branched.css",
    );
  }
});

test("the SHARED .dec-branch + .dec-opt styles stay in eager style.css", () => {
  // .dec-branch (chained-branch consequence) + .dec-opt (vote buttons) are used
  // by standard Module-A/B too, so they must NOT move to the branched-only file.
  assert.match(STYLE_CSS, /\.dec-branch\b/, ".dec-branch base/overrides stay eager");
  assert.match(STYLE_CSS, /\.dec-opt\b/, ".dec-opt stays eager");
  assert.ok(
    !BRANCHED_CSS.includes(".dec-opt"),
    ".dec-opt must NOT be duplicated into branched.css",
  );
});

test("branched.css is wired: loader injector + applyScenario call + sw precache", () => {
  assert.match(LOADER, /function ensureBranchedStyles/, "loader defines the injector");
  assert.match(LOADER, /ensureBranchedStyles,/, "loader exports it on CanamedLoader");
  assert.match(LOADER, /v\("branched\.css"\)/, "injector loads the versioned branched.css");
  assert.match(
    SCRIPT,
    /ensureBranchedStyles\(\)/,
    "applyScenario calls ensureBranchedStyles for branched scenarios",
  );
  assert.match(SW, /"\/branched\.css"/, "sw.js precaches /branched.css");
});
