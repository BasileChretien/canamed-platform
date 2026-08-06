/* tests/serve-platform-routing.test.js
 *
 * THE DEV SERVER MUST ROUTE LIKE FIREBASE HOSTING.
 *
 * scripts/serve-platform.js is what the whole Playwright suite runs against.
 * It used to be a bare pathname→file mapper, while production Hosting also
 * applies firebase.json's `hosting.rewrites`. The gap was not cosmetic: it is
 * exactly why the multi-tenant `/o/<slug>/` entry point had never been driven
 * by a single E2E test — the page 404'd before it could load.
 *
 *   /                   http=200
 *   /o/caen-nagoya/     http=404   <- measured on the old server, 2026-08-05
 *   /o/lyon-tokyo/      http=404
 *
 * These tests pin the two halves that can drift:
 *   1. STRUCTURAL — the rewrite table is READ OUT OF firebase.json and every
 *      entry must be present in the server's own REWRITES list, same source,
 *      same destination. Add a rewrite to firebase.json and forget the dev
 *      server, and this fails.
 *   2. FUNCTIONAL — the server, over real HTTP, serves what those rewrites
 *      promise, swallows org-prefixed assets exactly as Hosting does, and
 *      still refuses to escape its root.
 *
 * UPDATED 2026-08-06 (root-absolute assets). This file used to assert that
 * org-prefixed assets "resolve to the real file" — the dev server stripped the
 * `/o/<slug>` prefix as a crutch for index.html's relative refs. Firebase
 * Hosting has never done that, so the crutch made the dev server kinder than
 * production AND hid the defect. Both halves of the real contract are pinned
 * instead: the server swallows those paths like Hosting, and the shell never
 * asks for them because it addresses assets root-absolutely.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const srv = require("../scripts/serve-platform.js");

const FIREBASE_JSON = path.join(
  __dirname, "..", "docs", "Third_session", "PBL_platform", "firebase.json"
);

/* ------------------------------------------------------------------ 1. */

test("every firebase.json hosting rewrite is implemented by the dev server", () => {
  const cfg = JSON.parse(fs.readFileSync(FIREBASE_JSON, "utf8"));
  const hosted = (cfg.hosting && cfg.hosting.rewrites) || [];
  assert.ok(hosted.length > 0, "firebase.json must declare hosting rewrites");

  for (const rw of hosted) {
    const mine = srv.REWRITES.find((r) => r.source === rw.source);
    assert.ok(
      mine,
      `firebase.json rewrites ${rw.source} but scripts/serve-platform.js does not`
    );
    assert.equal(
      mine.destination, rw.destination,
      `rewrite ${rw.source} points at ${rw.destination} in firebase.json`
    );
  }
});

test("the org rewrite matcher accepts the shapes orgs.js parses", () => {
  const org = srv.REWRITES.find((r) => r.source === "/o/**");
  assert.ok(org, "the /o/** rewrite must exist");
  for (const p of ["/o/caen-nagoya/", "/o/caen-nagoya", "/o/e2e-org/deep/route"]) {
    assert.equal(org.match(p), true, `${p} must match /o/**`);
  }
  for (const p of ["/", "/index.html", "/other/o/x"]) {
    assert.equal(org.match(p), false, `${p} must NOT match /o/**`);
  }
});

/* ------------------------------------------------------------------ 2. */

test("dev server routing over HTTP", async (t) => {
  await new Promise((r) => srv.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.server.address().port;
  t.after(() => new Promise((r) => srv.server.close(r)));

  const get = (p) => fetch(base + p);

  await t.test("/ still serves the shell", async () => {
    const res = await get("/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /<title>/i);
  });

  await t.test("/o/<slug>/ serves the SPA shell instead of 404", async () => {
    for (const p of ["/o/caen-nagoya/", "/o/e2e-org/", "/o/not-registered/"]) {
      const res = await get(p);
      assert.equal(res.status, 200, `${p} must not 404`);
      assert.match(res.headers.get("content-type"), /text\/html/, p);
      /* The real shell, not some other HTML page. */
      assert.match(await res.text(), /id="splash"/, p);
    }
  });

  await t.test("org-prefixed assets are SWALLOWED by the rewrite, exactly as Hosting does", async () => {
    /* This is the production behaviour the root-absolute fix exists to work
       WITH, measured on the live deploy 2026-08-05:
           GET /theme-init.js               -> 200 text/javascript (1 579 B)
           GET /o/caen-nagoya/theme-init.js -> 200 text/html     (221 781 B)
       `/o/**` rewrites to index.html, so anything asked for under an org
       prefix comes back as the SPA shell and nosniff refuses to execute it.

       This server used to strip the prefix and serve the real file. That made
       it KINDER than Hosting and, worse, masked the bug: a relative asset ref
       resolved locally, so an org-URL test passed either way. The app now
       addresses assets root-absolutely and never asks for these paths at all;
       pinning the swallow keeps the dev server honest, so a regression to
       relative addressing FAILS locally instead of only in production. */
    for (const p of ["/o/e2e-org/orgs.js", "/o/e2e-org/style.css",
                     "/o/e2e-org/manifest.webmanifest"]) {
      const res = await get(p);
      assert.equal(res.status, 200, p);
      assert.match(
        res.headers.get("content-type"), /text\/html/,
        `${p} must come back as the SPA shell, like Firebase Hosting`
      );
      assert.match(await res.text(), /id="splash"/, p);
    }
    /* And the un-prefixed path still serves the real script — the whole point
       of root-absolute addressing is that THIS is what the org page requests. */
    const real = await get("/orgs.js");
    assert.equal(real.status, 200);
    assert.match(real.headers.get("content-type"), /javascript/);
  });

  await t.test("the shell addresses every asset root-absolutely", async () => {
    /* The other half of the same contract, asserted at the source rather than
       over the wire: if index.html regains a relative src/href, the org page
       goes back to requesting /o/<slug>/<asset> — which the test above proves
       returns HTML. Fragment refs (#ic-* SVG <use>, the skip link) MUST stay
       relative, which is why this allowlists `#` and why <base href="/"> was
       rejected as the fix. */
    const html = fs.readFileSync(
      path.join(__dirname, "..", "docs", "Third_session", "PBL_platform", "index.html"),
      "utf8"
    );
    /* `\s` before the attribute name is load-bearing: without it this also
       matches the tail of `data-i18n-href="privacy"`, whose value is an i18n
       KEY (resolved by localizedHref()), not a URL. */
    const relative = [...html.matchAll(/\s(?:src|href)="([^"#][^"]*)"/g)]
      .map((m) => m[1])
      .filter((u) => !/^(?:https?:|data:|mailto:|\/\/|\/)/.test(u));
    assert.deepEqual(
      relative, [],
      "index.html must address assets and in-app pages root-absolutely, so the " +
      "/o/** rewrite cannot swallow them"
    );
  });

  await t.test("/v serves the verification page", async () => {
    const res = await get("/v");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /verify/i);
  });

  await t.test("unknown paths outside a rewrite still 404", async () => {
    assert.equal((await get("/no-such-file.js")).status, 404);
  });

  await t.test("path traversal is still refused", async () => {
    /* Pre-encoded so the client does not normalise it away before it is sent. */
    const res = await fetch(base + "/%2e%2e/%2e%2e/package.json");
    assert.ok(res.status === 403 || res.status === 404, "must not serve package.json");
  });

  await t.test("security headers ride on rewritten responses too", async () => {
    const res = await get("/o/e2e-org/");
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
