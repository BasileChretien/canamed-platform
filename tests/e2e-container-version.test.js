/* tests/e2e-container-version.test.js
 *
 * The E2E matrix runs inside the official Playwright container image, which
 * ships the browsers AND their system libraries preinstalled. That is what
 * keeps `apt-get` off the critical path — see the long comment at the top of
 * .github/workflows/e2e.yml for why apt, not the browser cache, was blowing
 * the job timeout (a cache-HIT webkit job still died at the 55-minute cap with
 * a 40-minute apt step).
 *
 * The catch: the image tag and the @playwright/test dependency are two
 * separate facts that must agree. Browsers in the image are built for the
 * Playwright version in its tag, and the test runner refuses to drive browsers
 * from a different build — so a drifted tag fails at browserType.launch, deep
 * in a 20-minute matrix job, with an error that reads like a browser bug.
 *
 * Dependabot bumps package.json/package-lock.json and has no idea the workflow
 * pins a matching tag, so drift is the DEFAULT outcome of routine maintenance,
 * not an unlikely accident. This test makes the two agree mechanically: it
 * fails in ~50 ms in the unit job instead of ~20 min into the E2E matrix.
 *
 * If you bump @playwright/test, update the `container:` tag in e2e.yml to the
 * same version. This test tells you if you forgot.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

const workflow = read(ROOT, ".github", "workflows", "e2e.yml");
const lock = JSON.parse(read(ROOT, "package-lock.json"));

/* The "must not contain" checks below have to read CONFIG, not prose. e2e.yml
 * deliberately discusses `playwright install` and /ms-playwright at length in
 * its comments — explaining why they are gone is the whole point of that block
 * — so asserting against the raw file would fail on the very documentation
 * that prevents the regression. (Caught by this test failing on its own first
 * run.) Strip full-line and trailing comments first.
 *
 * NB the \r\n normalisation is load-bearing on Windows checkouts: JS regex `.`
 * does not match `\r`, so `#.*$` never reaches the `$` anchor on a CRLF line
 * and nothing gets stripped — the test then silently reads the comments it was
 * supposed to ignore. (Also caught by this test failing on itself.) */
const config = workflow
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/(^|\s)#.*$/, ""))
  .join("\n");

// ---- the two facts that must agree ----------------------------------------

/** The exact @playwright/test version the lockfile installs. */
function lockedPlaywrightVersion() {
  const entry = lock.packages && lock.packages["node_modules/@playwright/test"];
  assert.ok(entry, "@playwright/test missing from package-lock.json");
  return entry.version;
}

/** The version embedded in the `container:` image tag, e.g. v1.62.1-noble. */
function containerImageVersion() {
  const m = workflow.match(
    /container:\s*mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)-\S+/
  );
  assert.ok(
    m,
    "e2e.yml has no recognisable `container: mcr.microsoft.com/playwright:vX.Y.Z-<distro>` line"
  );
  return m[1];
}

test("e2e container tag matches the locked @playwright/test version", () => {
  const locked = lockedPlaywrightVersion();
  const image = containerImageVersion();
  assert.strictEqual(
    image,
    locked,
    `Playwright version drift: package-lock.json pins ${locked} but ` +
      `.github/workflows/e2e.yml runs mcr.microsoft.com/playwright:v${image}-*. ` +
      `Update the container tag in e2e.yml to v${locked}-noble.`
  );
});

test("the e2e job runs in a container and installs no browsers", () => {
  assert.match(
    config,
    /container:\s*mcr\.microsoft\.com\/playwright:/,
    "the e2e job must run in the Playwright container — that is what keeps apt off the critical path"
  );
  // `playwright install` re-introduces the apt step (and its 15-40 min tail)
  // that this job was rebuilt to avoid. `install-deps` is the apt half on its
  // own, so it is just as disqualifying.
  assert.doesNotMatch(
    config,
    /playwright install(-deps)?\b/,
    "e2e.yml must not RUN `playwright install` / `install-deps` — the container already " +
      "has the browsers and their system libraries; re-adding it puts apt back on the critical path"
  );
});

test("no stale browser-cache config survives in the e2e job", () => {
  // The ~/.cache/ms-playwright cache and the `browser:` matrix include existed
  // only to serve the removed install steps. Leaving either behind is dead
  // config that reads as meaningful.
  assert.doesNotMatch(
    config,
    /ms-playwright/,
    "the browser cache is obsolete under the container — remove it rather than leaving it inert"
  );
  assert.doesNotMatch(
    config,
    /matrix\.browser/,
    "the `browser:` matrix dimension existed only to pick which engine to install; it is dead under the container"
  );
});
