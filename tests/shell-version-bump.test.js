/* tests/shell-version-bump.test.js
 *
 * THE DEFECT THIS CATCHES: a PR that changes a precached or lazily-loaded
 * chunk and does NOT bump the PWA shell version. Returning browsers keep
 * serving the OLD chunk out of the service-worker cache, so the deploy is
 * silently broken for exactly the users who have been here before — while
 * every check is green and the live site *looks* updated to anyone testing
 * in a fresh profile.
 *
 * WHY THE EXISTING GUARD CANNOT SEE IT. tests-e2e/shell-csp-vendoring.spec.js
 * ("SHELL_VERSION is in lockstep across index.html, script-loader.js and
 * sw.js") checks only that the three markers AGREE WITH EACH OTHER. Three
 * markers reading v142 is equally consistent whether the shell content
 * changed or not, so the spec passes on the broken state by construction.
 * Two recorded near-misses of precisely this shape:
 *   - PR #226 edited a lazy chunk with no bump and was nearly shipped; the
 *     lockstep spec was green throughout.
 *   - CLAUDE.md, 2026-08-06 (#292): a rebase onto a `main` that had bumped to
 *     the same version made git DROP the identical bump hunk as
 *     already-upstream. Result: modified shell files, no version increment,
 *     all three markers still agreeing — "undeployable-but-green".
 * The same trap has a second instance in this repo: LOCALE_VERSION (i18n.js)
 * is an independent counter for /locales/*.js, and CLAUDE.md records it being
 * bumped v8→v9 only because someone remembered ("without it returning
 * browsers keep serving the cached 7-day locale chunk"). Nothing enforced it.
 *
 * THE CHECK. Diff the working tree against the merge base with origin/main.
 * If any watched file differs, the corresponding version marker must differ
 * too. That is inherently diff-based: no snapshot of the current tree can
 * tell you whether its content moved.
 *
 * THE WATCHED SET IS DERIVED FROM THE ENFORCING SOURCES, never hand-listed —
 * a copied list drifts, and a drifted allow-list is a guard that silently
 * stops guarding:
 *   - sw.js            SHELL_ASSETS[]                (the precache manifest)
 *   - script-loader.js every v("…") and loadScript("/…")  (the lazy chunks +
 *                      the idle-prefetch set, which all route through v())
 *   - index.html       every src/href carrying ?v=vNNN (the eager bundle;
 *                      contributes sw-register.js, orgs.js, pure-utils.js and
 *                      script-loader.js itself, none of which sw.js precaches)
 *   - reader-dict.js   the /dict/*.gz it fetches with CanamedLoader.SHELL_VERSION
 *   - i18n.js          the /locales/<lang>.js line, for the LOCALE_VERSION pair
 * Every derivation asserts on its own input, so a parser that stops matching
 * fails loudly here instead of quietly narrowing the set to nothing.
 *
 * IT SKIPS, NEVER FAILS, WHEN THE COMPARISON IS IMPOSSIBLE: no git, no
 * origin/main (shallow clone, fork checkout without the base ref), no merge
 * base, or the marker file absent at the base. On main itself the diff is
 * empty and the test simply passes. Because a silent skip everywhere would be
 * indistinguishable from a passing guard, a companion test asserts that the
 * unit-test workflow still checks out enough history for the comparison to
 * run at all (actions/checkout defaults to depth 1, which has no origin/main).
 *
 * KNOWN RESIDUAL (deliberately not covered): sw.js also caches-on-fetch every
 * same-origin 200 it sees (handleSameOrigin), so unversioned secondary pages —
 * privacy*.html, verify.html/verify.js, scenario-author.html/.css,
 * healthcheck.* — are stale-served too after a visit. Catching those means
 * crawling every HTML entry point, which widens "you must bump" to most of the
 * platform directory; that is a workflow decision, not a bug fix, so it is
 * recorded here rather than enforced.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const APP = "docs/Third_session/PBL_platform";
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---- git plumbing ---------------------------------------------------------
// execFileSync, not a shell: argv goes to git.exe untouched, so Git Bash's
// MSYS path mangling (`origin/main:path` → `origin\main;path`) cannot happen.

/** Run git; return trimmed stdout, or null if git fails / is absent. */
function tryGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }).trim();
  } catch (_) {
    return null;
  }
}

/** Commit this branch forked from, or null when it cannot be determined. */
function mergeBase() {
  const refs = [];
  // On a pull_request run the base branch is authoritative and need not be main.
  if (process.env.GITHUB_BASE_REF) refs.push("origin/" + process.env.GITHUB_BASE_REF);
  refs.push("origin/main", "origin/HEAD", "main");
  for (const ref of refs) {
    if (tryGit(["rev-parse", "--verify", "--quiet", ref + "^{commit}"]) === null) continue;
    const base = tryGit(["merge-base", ref, "HEAD"]);
    if (base) return base;
  }
  return null;
}

/**
 * Watched files changed between `base` and the WORKING TREE — uncommitted
 * edits included on purpose: the working tree is what you are about to ship,
 * and a developer should learn they owe a bump before they commit, not after.
 */
function changedSince(base, files) {
  const out = tryGit(["diff", "--name-only", base, "--", ...files]);
  if (out === null) return null;
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** First capture of `re` in `file` as it stood at `base`; null if unavailable. */
function markerAt(base, file, re) {
  const text = tryGit(["show", base + ":" + file]);
  if (text === null) return null;
  const m = text.match(re);
  return m ? m[1] : null;
}

// ---- derivation: what the version machinery actually addresses -------------

/** All captures of `re` in `text`, deduped, in order. */
function allMatches(text, re) {
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

/** "/x.js" (or "/" for the shell root) → repo-relative "docs/…/x.js". */
function toRepoPath(url) {
  return APP + (url === "/" ? "/index.html" : url);
}

function deriveShellAssets() {
  const sw = read(APP + "/sw.js");
  const loader = read(APP + "/script-loader.js");
  const html = read(APP + "/index.html");
  const dict = read(APP + "/reader-dict.js");

  // 1. the service-worker precache manifest
  const manifest = sw.match(/SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(manifest, "sw.js: could not find the SHELL_ASSETS array — the precache manifest parser needs updating");
  const precached = allMatches(manifest[1], /"([^"]+)"/g);
  assert.ok(precached.length > 30, `sw.js SHELL_ASSETS parsed to only ${precached.length} entries — the parser is broken, not the manifest`);

  // 2. every lazy chunk, i.e. every URL that goes through the version helper
  //    v(src) → "/" + src + "?v=" + SHELL_VERSION, plus the two vendored
  //    bundles that bypass v() (pdfmake/vfs_fonts, deliberately unversioned
  //    but still shell-cached under the versioned cache name).
  const lazy = allMatches(loader, /\bv\(\s*"([^"]+)"\s*\)/g).map((s) => "/" + s);
  assert.ok(lazy.length > 20, `script-loader.js yielded only ${lazy.length} v("…") chunks — the parser is broken`);
  const vendored = allMatches(loader, /loadScript\(\s*"(\/[^"?]+)"\s*\)/g);
  assert.ok(vendored.length > 0, "script-loader.js: no un-versioned loadScript(\"/…\") bundles found — parser drift");

  // 3. the eager bundle: everything index.html cache-busts by hand
  const eager = allMatches(html, /(?:src|href)="([^"]+)\?v=v\d+"/g);
  assert.ok(eager.length > 5, `index.html yielded only ${eager.length} ?v= assets — the parser is broken`);

  // 4. the reading-aid dictionaries, cache-busted off CanamedLoader.SHELL_VERSION
  assert.match(dict, /SHELL_VERSION/, "reader-dict.js no longer references SHELL_VERSION — re-check whether its dict files still ride the shell version");
  const dicts = allMatches(dict, /"(\/dict\/[^"]+)"/g);
  assert.ok(dicts.length > 0, "reader-dict.js: no /dict/… files found — parser drift");

  const files = [...new Set([...precached, ...lazy, ...vendored, ...eager, ...dicts].map(toRepoPath))];
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is addressed by the shell-version machinery but does not exist on disk`);
  }
  return files.sort();
}

function deriveLocaleAssets() {
  const i18n = read(APP + "/i18n.js");
  // The enforcing line itself: s.src = "/locales/" + lang + ".js?v=" + LOCALE_VERSION;
  const m = i18n.match(/"(\/locales\/)"\s*\+\s*\w+\s*\+\s*"(\.js)\?v="\s*\+\s*LOCALE_VERSION/);
  assert.ok(m, "i18n.js: could not find the `\"/locales/\" + lang + \".js?v=\" + LOCALE_VERSION` load line — the locale-chunk parser needs updating");
  const dir = m[1].replace(/^\/|\/$/g, "");
  const suffix = m[2];
  const files = fs
    .readdirSync(path.join(ROOT, APP, dir))
    .filter((f) => f.endsWith(suffix))
    .map((f) => `${APP}/${dir}/${f}`);
  assert.ok(files.length > 0, `${APP}/${dir} contains no ${suffix} chunks — derivation is wrong`);
  return files.sort();
}

// ---- the two cache-version contracts --------------------------------------

const CONTRACTS = [
  {
    name: "SHELL_VERSION",
    markers: [
      { file: APP + "/sw.js", re: /SHELL_VERSION\s*=\s*"canamed-shell-(v\d+)"/g },
      { file: APP + "/script-loader.js", re: /SHELL_VERSION\s*=\s*"(v\d+)"/g },
      { file: APP + "/index.html", re: /\?v=(v\d+)"/g }
    ],
    derive: deriveShellAssets,
    fix:
      "bump SHELL_VERSION in sw.js AND script-loader.js AND every ?v= in index.html " +
      "(all three must move together — see CLAUDE.md, and re-check after any rebase: " +
      "git drops an identical bump hunk as already-upstream)"
  },
  {
    name: "LOCALE_VERSION",
    markers: [{ file: APP + "/i18n.js", re: /LOCALE_VERSION\s*=\s*"(v\d+)"/g }],
    derive: deriveLocaleAssets,
    fix: "bump LOCALE_VERSION in i18n.js (its own counter, independent of SHELL_VERSION)"
  }
];

/** The single version a contract's markers all state; asserts they agree. */
function contractVersion(c) {
  const seen = [];
  for (const marker of c.markers) {
    const found = allMatches(read(marker.file), marker.re);
    assert.ok(found.length > 0, `${marker.file}: no ${c.name} marker found — the marker regex needs updating`);
    assert.strictEqual(
      found.length,
      1,
      `${marker.file} states ${c.name} as ${found.join(", ")} — the markers inside one file must agree`
    );
    seen.push({ file: marker.file, version: found[0] });
  }
  const distinct = [...new Set(seen.map((s) => s.version))];
  assert.strictEqual(
    distinct.length,
    1,
    `${c.name} is out of lockstep: ` + seen.map((s) => `${s.file}=${s.version}`).join(", ")
  );
  return distinct[0];
}

// ---- tests ----------------------------------------------------------------

for (const c of CONTRACTS) {
  test(`${c.name}: every marker states the same version`, () => {
    // Cheap, but it also brings the three-marker lockstep into the fast suite:
    // it lived only in the Playwright spec, so a broken lockstep survived
    // `npm run test` entirely.
    assert.match(contractVersion(c), /^v\d+$/);
  });

  test(`${c.name}: a changed asset since origin/main forces a version bump`, (t) => {
    const base = mergeBase();
    if (!base) {
      return t.skip("no merge base with origin/main (shallow clone, or no origin) — nothing to compare against");
    }
    const watched = c.derive();
    const changed = changedSince(base, watched);
    if (changed === null) return t.skip("git diff unavailable");
    if (changed.length === 0) return; // nothing this contract covers was touched

    const marker = c.markers[0];
    const before = markerAt(base, marker.file, new RegExp(marker.re.source));
    if (before === null) {
      return t.skip(`${marker.file} carries no ${c.name} at ${base.slice(0, 8)} — nothing to compare`);
    }
    const now = contractVersion(c);
    assert.notStrictEqual(
      now,
      before,
      `${c.name} is still ${before} but ${changed.length} cache-versioned file(s) changed since ` +
        `${base.slice(0, 8)}:\n  ${changed.join("\n  ")}\n` +
        `Returning browsers will keep serving the CACHED copy of those files, so this deploy ` +
        `is a no-op for them. Fix: ${c.fix}.`
    );
  });
}

test("the derived shell-asset set covers the chunks that have actually caused this", () => {
  // A derivation that quietly returns [] would make the guard above pass on
  // every broken state. Pin the members named in the incident record — the
  // lazy/precached chunks a PR is most likely to touch without thinking about
  // the cache — so a narrowed set fails here rather than passing everywhere.
  const files = deriveShellAssets();
  for (const name of [
    "index.html",       // precached; served cache-first to returning users
    "script.js",
    "script-admin.js",  // #285
    "admin-tools.js",
    "case-content.js",
    "takehome.js",      // #278
    "room.css",
    "admin.css",
    "branched.css",
    "section-content.js",
    "reader-dict.js"
  ]) {
    assert.ok(
      files.includes(`${APP}/${name}`),
      `${name} is not in the derived shell-asset set — the guard would not notice it changing`
    );
  }
  // …and is not simply "every file in the platform directory", which would be
  // a different (much stricter) contract than the one documented above.
  assert.ok(!files.includes(`${APP}/database.rules.json`), "database.rules.json is not a shell asset");
  assert.ok(!files.includes(`${APP}/privacy.html`), "privacy.html carries no version marker — see the KNOWN RESIDUAL note");
});

test("the unit-test workflow checks out enough history for the bump check to run", () => {
  // actions/checkout defaults to fetch-depth: 1, which leaves no origin/main
  // and no merge base — the bump check would then SKIP on every PR, which is
  // indistinguishable from passing. Strip comments first: the workflow is
  // free to discuss fetch-depth in prose. \r\n normalisation is load-bearing
  // on a CRLF checkout (JS `.` never matches \r, so `#.*$` would strip nothing).
  const config = read(".github/workflows/test.yml")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  assert.match(
    config,
    /fetch-depth:\s*0/,
    "test.yml must check out with fetch-depth: 0, or tests/shell-version-bump.test.js silently skips in CI"
  );
});
