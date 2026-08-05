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
 *      promise, still resolves org-prefixed assets, and still refuses to
 *      escape its root.
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

  await t.test("org-prefixed assets resolve to the real file", async () => {
    /* index.html has no <base> and references assets relatively, so the
       shell served at /o/<slug>/ asks for them under that prefix. If these
       come back as text/html the page boots with zero scripts. */
    const cases = [
      ["/o/e2e-org/orgs.js", /javascript/],
      ["/o/e2e-org/style.css", /text\/css/],
      ["/o/e2e-org/manifest.webmanifest", /manifest\+json/]
    ];
    for (const [p, ctype] of cases) {
      const res = await get(p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get("content-type"), ctype, p);
    }
    /* Byte-identical to the un-prefixed file — not a lookalike. */
    const a = await (await get("/orgs.js")).text();
    const b = await (await get("/o/e2e-org/orgs.js")).text();
    assert.equal(b, a);
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
