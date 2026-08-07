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
 * If any watched file differs, the corresponding version marker must have
 * moved FORWARD. That is inherently diff-based: no snapshot of the current
 * tree can tell you whether its content moved.
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
 * DELETIONS COUNT, so the set is derived at BOTH ENDS of the diff. (Review
 * finding, CodeRabbit on #301.) Deriving from the working tree alone has a
 * hole: delete a precached asset or a locale chunk — which also means removing
 * it from sw.js's manifest — and the HEAD derivation no longer mentions it, so
 * it is never handed to `git diff` and the guard passes with no bump. But
 * removing an asset changes what the shell IS, and every client still holding
 * the old cache keeps serving the deleted file. The watched set is therefore
 * the UNION of the derivation at the merge base and the derivation at HEAD.
 * The base side is deliberately LENIENT (its `expect` is a no-op): the base is
 * history and may predate any given parser, so it contributes what it can
 * without failing a PR over how a file parsed two years ago. A companion test
 * asserts the base side is not silently returning nothing, because that would
 * re-open this exact hole without any visible symptom.
 *
 * A REVERT MUST BUMP FORWARD, NEVER BACK — the version must strictly INCREASE,
 * not merely differ. (Second review finding on #301; the first version of this
 * guard used notStrictEqual, on the reasoning that a revert legitimately
 * restores the previous version string. That reasoning is wrong.) sw.js's
 * activate handler deletes every cache whose name `!== SHELL_VERSION`: the
 * version is an IDENTITY, and a re-install is triggered by the name CHANGING,
 * not by it being newer. So take main going v142 → v143 → v142:
 *   - a client that reached v143 sees the name change back to v142,
 *     re-installs, and ends up correct — which is what makes the downgrade
 *     look safe;
 *   - a client still on v142 that NEVER SAW v143 (offline, or the window was
 *     only minutes wide) sees no version change at all across the whole round
 *     trip. It never re-installs and keeps serving its old v142 cache. If the
 *     v142 main returned to is not byte-identical to the v142 that client
 *     cached — a partial revert, or the usual "revert plus fix" — that client
 *     is PERMANENTLY stale, which is the precise failure this guard exists to
 *     prevent.
 * A cache version is a monotonic identifier, never a content label, and a
 * number is never reused. Revert the CONTENT and bump the version FORWARD
 * (v143 → v144 carrying the reverted files). Do not "fix" the friction by
 * relaxing this back to an inequality check.
 *
 * IT SKIPS, NEVER FAILS, WHEN THE COMPARISON IS IMPOSSIBLE: no git, no
 * origin/main (shallow clone, fork checkout without the base ref), no merge
 * base, or the marker file absent at the base. On main itself the diff is
 * empty and the test simply passes. Because a silent skip everywhere would be
 * indistinguishable from a passing guard, a companion test asserts that the
 * unit-test workflow still checks out enough history for the comparison to
 * run at all (actions/checkout defaults to depth 1, which has no origin/main).
 *
 * ~~KNOWN RESIDUAL (deliberately not covered)~~ — RESOLVED at the source, not
 * here. sw.js used to serve every same-origin GET cache-first while caching
 * every 200 it saw, so unversioned secondary pages — privacy*.html,
 * verify.html, scenario-author.html/.css, healthcheck.* — were stale-served
 * after a single visit. Widening THIS guard to cover them would have meant
 * crawling every HTML entry point and demanding a shell bump for most of the
 * platform directory. Instead sw.js now splits its routing: cache-first only
 * for URLs that pin their content (a ?v=, the SHELL_ASSETS manifest, two
 * frozen vendored bundles), network-first-with-cache-fallback for everything
 * else — so those pages need no version marker at all. See
 * sw.js `isImmutableRequest()` and tests/sw-cache-policy.test.js, whose
 * derived guard re-discovers that set from the repo on every run.
 *
 * STILL NOT COVERED HERE: sw.js ITSELF is not in the watched set (it is not
 * precached — a service worker cannot cache itself — and carries no ?v=), so
 * editing sw.js alone never trips this guard. That is consistent with the
 * contract above (browsers re-fetch sw.js on every update check, so it is
 * never served stale from the SW cache), but it does mean a change to the
 * cache POLICY or the manifest can ship without rebuilding existing clients'
 * caches. Verified by control run, 2026-08-07.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const APP = "docs/Third_session/PBL_platform";

// ---- git plumbing ---------------------------------------------------------
// execFileSync, not a shell: argv goes to git.exe untouched, so Git Bash's
// MSYS path mangling (`<rev>:path` → `<rev>\path`) cannot happen here. It very
// much can in a hand-run `git show origin/main:path` — export MSYS_NO_PATHCONV=1
// there, or the mangled path prints nothing and reads as "nothing changed".

/** Run git; return trimmed stdout, or null if git fails / is absent. */
function tryGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
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
 * Additions, modifications AND deletions all count (see the header).
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

// ---- where to read the repo FROM ------------------------------------------

/** The working tree. Strict: a parser that stops matching here is a defect. */
const WORKTREE = {
  label: "the working tree",
  strict: true,
  read(rel) {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  },
  list(dirRel) {
    const p = path.join(ROOT, dirRel);
    return fs.existsSync(p) ? fs.readdirSync(p) : [];
  },
  expect(cond, msg) {
    assert.ok(cond, msg);
  }
};

/** A git revision. Lenient — see the DELETIONS COUNT note in the header. */
function atRevision(rev) {
  return {
    label: rev.slice(0, 8),
    strict: false,
    read(rel) {
      return tryGit(["show", rev + ":" + rel]);
    },
    list(dirRel) {
      const out = tryGit(["ls-tree", "--name-only", rev, "--", dirRel + "/"]);
      if (!out) return [];
      return out
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.startsWith(dirRel + "/"))
        .map((p) => p.slice(dirRel.length + 1))
        .filter((name) => name && !name.includes("/"));
    },
    expect() {
      /* history is allowed to have parsed differently */
    }
  };
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

function deriveShellAssets(src) {
  const urls = [];

  // 1. the service-worker precache manifest
  const sw = src.read(APP + "/sw.js");
  src.expect(sw, `sw.js is unreadable in ${src.label}`);
  const manifest = sw && sw.match(/SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
  src.expect(manifest, "sw.js: could not find the SHELL_ASSETS array — the precache-manifest parser needs updating");
  if (manifest) {
    const precached = allMatches(manifest[1], /"([^"]+)"/g);
    src.expect(precached.length > 30, `sw.js SHELL_ASSETS parsed to only ${precached.length} entries — the parser is broken, not the manifest`);
    urls.push(...precached);
  }

  // 2. every lazy chunk, i.e. every URL that goes through the version helper
  //    v(src) → "/" + src + "?v=" + SHELL_VERSION, plus the two vendored
  //    bundles that bypass v() (pdfmake/vfs_fonts, deliberately unversioned
  //    but still shell-cached under the versioned cache name).
  const loader = src.read(APP + "/script-loader.js");
  src.expect(loader, `script-loader.js is unreadable in ${src.label}`);
  if (loader) {
    const lazy = allMatches(loader, /\bv\(\s*"([^"]+)"\s*\)/g).map((s) => "/" + s);
    src.expect(lazy.length > 20, `script-loader.js yielded only ${lazy.length} v("…") chunks — the parser is broken`);
    const vendored = allMatches(loader, /loadScript\(\s*"(\/[^"?]+)"\s*\)/g);
    src.expect(vendored.length > 0, 'script-loader.js: no un-versioned loadScript("/…") bundles found — parser drift');
    urls.push(...lazy, ...vendored);
  }

  // 3. the eager bundle: everything index.html cache-busts by hand
  const html = src.read(APP + "/index.html");
  src.expect(html, `index.html is unreadable in ${src.label}`);
  if (html) {
    const eager = allMatches(html, /(?:src|href)="([^"]+)\?v=v\d+"/g);
    src.expect(eager.length > 5, `index.html yielded only ${eager.length} ?v= assets — the parser is broken`);
    urls.push(...eager);
  }

  // 4. the reading-aid dictionaries, cache-busted off CanamedLoader.SHELL_VERSION
  const dict = src.read(APP + "/reader-dict.js");
  src.expect(dict, `reader-dict.js is unreadable in ${src.label}`);
  if (dict) {
    src.expect(/SHELL_VERSION/.test(dict), "reader-dict.js no longer references SHELL_VERSION — re-check whether its dict files still ride the shell version");
    const dicts = allMatches(dict, /"(\/dict\/[^"]+)"/g);
    src.expect(dicts.length > 0, "reader-dict.js: no /dict/… files found — parser drift");
    urls.push(...dicts);
  }

  const files = [...new Set(urls.map(toRepoPath))];
  if (src.strict) {
    // Only meaningful for the working tree: a base-side entry may legitimately
    // be absent from disk — that is exactly the deletion this guard catches.
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is addressed by the shell-version machinery but does not exist on disk`);
    }
  }
  return files.sort();
}

function deriveLocaleAssets(src) {
  const i18n = src.read(APP + "/i18n.js");
  src.expect(i18n, `i18n.js is unreadable in ${src.label}`);
  if (!i18n) return [];
  // The enforcing line itself: s.src = "/locales/" + lang + ".js?v=" + LOCALE_VERSION;
  const m = i18n.match(/"(\/locales\/)"\s*\+\s*\w+\s*\+\s*"(\.js)\?v="\s*\+\s*LOCALE_VERSION/);
  src.expect(m, 'i18n.js: could not find the `"/locales/" + lang + ".js?v=" + LOCALE_VERSION` load line — the locale-chunk parser needs updating');
  if (!m) return [];
  const dir = APP + "/" + m[1].replace(/^\/|\/$/g, "");
  const suffix = m[2];
  const files = src
    .list(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => `${dir}/${f}`);
  src.expect(files.length > 0, `${dir} contains no ${suffix} chunks in ${src.label} — derivation is wrong`);
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
    const found = allMatches(WORKTREE.read(marker.file), marker.re);
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

/** "v142" → 142, asserting the shape so a malformed marker cannot compare as NaN. */
function versionNumber(v, whence) {
  const m = /^v(\d+)$/.exec(v);
  assert.ok(m, `${whence} version "${v}" is not the expected vNNN form`);
  return Number(m[1]);
}

/** Union of the watched set at the merge base and at HEAD (deletions count). */
function watchedUnion(c, base) {
  const head = c.derive(WORKTREE);
  const before = base ? c.derive(atRevision(base)) : [];
  return [...new Set([...head, ...before])].sort();
}

function wentBackwardsMessage(c, now, before, base) {
  return (
    `${c.name} moved BACKWARDS, ${before} → ${now} (base ${base.slice(0, 8)}). A cache version is a ` +
    `monotonic identifier, not a content label: sw.js's activate handler re-installs when the cache ` +
    `NAME changes, so a client that never saw ${before} sees no change at all across the round trip ` +
    `and keeps serving its stale ${now} cache forever. Never reuse a number — even a revert bumps ` +
    `FORWARD, carrying the reverted content. Fix: ${c.fix}.`
  );
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
    const changed = changedSince(base, watchedUnion(c, base));
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
    assert.ok(
      versionNumber(now, `${c.name} (working tree)`) > versionNumber(before, `${c.name} (base)`),
      wentBackwardsMessage(c, now, before, base)
    );
  });

  test(`${c.name}: the version never moves backwards`, (t) => {
    // Holds even when no watched file changed: reusing a number is never safe,
    // because the re-install trigger is the cache NAME changing (see header).
    const base = mergeBase();
    if (!base) return t.skip("no merge base with origin/main — nothing to compare against");
    const marker = c.markers[0];
    const before = markerAt(base, marker.file, new RegExp(marker.re.source));
    if (before === null) return t.skip(`${marker.file} carries no ${c.name} at ${base.slice(0, 8)}`);
    const now = contractVersion(c);
    if (now === before) return; // untouched is fine; the test above owns "must move"
    assert.ok(
      versionNumber(now, `${c.name} (working tree)`) > versionNumber(before, `${c.name} (base)`),
      wentBackwardsMessage(c, now, before, base)
    );
  });

  test(`${c.name}: the merge-base side of the derivation actually reads`, (t) => {
    // The base-side derivation is what closes the DELETED-asset hole, and it is
    // lenient by design — so if `git show <base>:…` ever stopped working, it
    // would return [] and the guard would silently fall back to working-tree-
    // only, re-opening that hole with no visible symptom. Fail loudly instead.
    const base = mergeBase();
    if (!base) return t.skip("no merge base with origin/main — nothing to derive from");
    const before = c.derive(atRevision(base));
    assert.ok(
      before.length > 0,
      `deriving ${c.name}'s watched set at ${base.slice(0, 8)} produced NOTHING. The guard has ` +
        `degraded to a working-tree-only derivation, which cannot see a DELETED asset — the exact ` +
        `hole the two-sided union closes.`
    );
  });
}

test("the derived shell-asset set covers the chunks that have actually caused this", () => {
  // A derivation that quietly returns [] would make the guard above pass on
  // every broken state. Pin the members named in the incident record — the
  // lazy/precached chunks a PR is most likely to touch without thinking about
  // the cache — so a narrowed set fails here rather than passing everywhere.
  const files = deriveShellAssets(WORKTREE);
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
  // privacy.html deliberately carries no version marker: sw.js serves it
  // network-first instead (see the RESOLVED residual note in the header).
  assert.ok(!files.includes(`${APP}/privacy.html`), "privacy.html carries no version marker");
});

test("the unit-test workflow checks out enough history for the bump check to run", () => {
  // actions/checkout defaults to fetch-depth: 1, which leaves no origin/main
  // and no merge base — the bump check would then SKIP on every PR, which is
  // indistinguishable from passing. Strip comments first: the workflow is
  // free to discuss fetch-depth in prose. \r\n normalisation is load-bearing
  // on a CRLF checkout (JS `.` never matches \r, so `#.*$` would strip nothing).
  const config = WORKTREE.read(".github/workflows/test.yml")
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
