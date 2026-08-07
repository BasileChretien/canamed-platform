/* tests/sw-cache-policy.test.js
 *
 * THE DEFECT THIS PINS. sw.js's handleSameOrigin() was unconditionally
 * cache-first, and it cached every same-origin 200 it saw on a miss. Cache-
 * first is sound only when the URL changes whenever the content changes, or
 * when the content never changes. That holds for the SHELL_ASSETS precache
 * (the cache NAME carries SHELL_VERSION, and `activate` deletes every cache
 * that isn't the current one) and for the ?v=-busted chunks. It does NOT hold
 * for anything else: a returning visitor kept the first copy they ever fetched
 * until some UNRELATED SHELL_VERSION bump happened to evict it — and a PR that
 * touches only those files needs no bump, so the change reached nobody who had
 * ever loaded the page.
 *
 * tests/shell-version-bump.test.js recorded exactly this as a KNOWN RESIDUAL
 * ("privacy*.html, verify.html/verify.js, scenario-author.html/.css,
 * healthcheck.* are stale-served too after a visit"). This is the fix, and
 * these are its tests. The two that matter most:
 *   - privacy*.html + privacy-lang.js are the Art. 13 legal notice in three
 *     languages, which has drifted from the code before;
 *   - healthcheck.* is the operator's pre-session gate.
 *
 * WHY A GENERIC GUARD, not just a list. A hand-written list of stale-prone
 * files is right on the day it is written and wrong the first time someone
 * adds an unversioned page. So the classification test below DERIVES the
 * reality from the enforcing sources — sw.js's SHELL_ASSETS text, and every
 * asset reference in the served HTML pages / script-loader.js / i18n.js /
 * reader-dict.js — and asserts isImmutableRequest() agrees with it, file by
 * file. A future page that ships without a ?v= is then classified correctly
 * with nobody remembering anything. Each derivation asserts its own input is
 * non-empty, because a derivation that quietly returned nothing would make
 * every assertion below pass vacuously.
 *
 * sw.js is not otherwise Node-requireable: it touches self.addEventListener at
 * top level. The house pattern (tests/localdb-child-added.test.js) is to stub
 * the browser globals BEFORE requiring, and sw.js carries a
 * `typeof module !== "undefined"` export guard that the browser never reaches.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const ORIGIN = "https://canamed-69785.web.app";

// ---- stub the ServiceWorkerGlobalScope BEFORE requiring -------------------
// sw.js registers four listeners at module scope; `caches` / `fetch` are only
// reached from inside the handlers, and both resolve off the global at CALL
// time, so each behavioural test can swap in its own without re-requiring.
const swListeners = Object.create(null);
global.self = {
  addEventListener(type, fn) { swListeners[type] = fn; },
  location: { origin: ORIGIN },
  clients: { claim() { return Promise.resolve(); } },
  skipWaiting() {}
};
global.caches = {
  match() { return Promise.resolve(undefined); },
  open() { return Promise.resolve({ put() { return Promise.resolve(); } }) }
};

const sw = require("../docs/Third_session/PBL_platform/sw.js");
const { isImmutableRequest, IMMUTABLE_VENDOR, SHELL_ASSETS, handleSameOrigin } = sw;

/** isImmutableRequest takes a URL object; tests speak in same-origin paths. */
const immutable = (p) => isImmutableRequest(new URL(ORIGIN + p));

// ==========================================================================
// 1. the concrete stale-prone set
// ==========================================================================

// Neither precached nor ?v=-busted: every one of these was pinned to whatever
// copy the visitor first loaded. The derived guard further down re-discovers
// this set from the repo, so the two must keep agreeing.
const STALE_PRONE = [
  // the Art. 13 legal notice, three languages
  "/privacy.html",
  "/privacy-fr.html",
  "/privacy-ja.html",
  "/privacy-lang.js",
  "/privacy-redirect.js",
  // the operator's pre-session gate
  "/healthcheck.html",
  "/healthcheck.js",
  "/healthcheck.css",
  // secondary entry points
  "/verify.html",
  "/scenario-author.html",
  "/scenario-author.css",
  "/scenario-author-cloud.js",
  "/branched-author.js",
  "/branched-validate.js"
];

test("the stale-prone secondary pages are NOT immutable — they go network-first", () => {
  for (const p of STALE_PRONE) {
    assert.strictEqual(
      immutable(p),
      false,
      `${p} classifies as immutable, so it would be served cache-first. It carries no ?v= ` +
        `and is not precached, so a returning visitor would keep the copy they first fetched.`
    );
  }
});

test("verify.html is network-first even though verify.js is versioned", () => {
  // verify.html loads "verify.js?v=v26" — the SCRIPT is version-busted, the
  // PAGE that references it is not. Edit the page (or bump that marker) and
  // only a fresh profile ever sees it.
  assert.strictEqual(immutable("/verify.js?v=v26"), true, "verify.js carries its own ?v=");
  assert.strictEqual(immutable("/verify.html"), false, "verify.html carries none");
});

// ==========================================================================
// 2. the vendored exemption
// ==========================================================================

test("IMMUTABLE_VENDOR is EXACTLY pdfmake + vfs_fonts", () => {
  // Deliberately unversioned (~2.2 MB): script-loader.js says a ?v= bump
  // "would force a pointless 2 MB re-download". Network-first would re-fetch
  // them every session. They are vendored and never edited in place, so
  // "the content never changes" is a real guarantee here and nowhere else.
  // Pinning the exact pair makes growing the list a reviewed act — an entry
  // added here silently re-opens the staleness hole for that file.
  assert.deepStrictEqual([...IMMUTABLE_VENDOR].sort(), ["/pdfmake.min.js", "/vfs_fonts.js"]);
  for (const p of IMMUTABLE_VENDOR) {
    assert.strictEqual(immutable(p), true, `${p} must stay cache-first`);
  }
});

test("the vendored bundles really are loaded without a ?v=", () => {
  // The exemption's whole premise. If script-loader.js ever starts versioning
  // them, the allowlist is dead weight that only hides staleness.
  const loader = fs.readFileSync(path.join(APP, "script-loader.js"), "utf8");
  for (const p of IMMUTABLE_VENDOR) {
    assert.ok(
      loader.includes(`loadScript("${p}")`),
      `script-loader.js no longer loads ${p} un-versioned — re-check whether it still needs the IMMUTABLE_VENDOR exemption`
    );
  }
});

// ==========================================================================
// 3. the shell stays cache-first
// ==========================================================================

test("precached shell paths and ?v=-busted URLs are immutable", () => {
  for (const p of ["/", "/index.html", "/script.js", "/tokens.css", "/style.css",
                   "/fonts/source-serif-4-latin-wght-normal.woff2", "/manifest.webmanifest"]) {
    assert.ok(SHELL_ASSETS.includes(p), `${p} should be in the precache manifest`);
    assert.strictEqual(immutable(p), true, `${p} is precached — it must stay cache-first`);
  }
  for (const u of ["/case-content.js?v=v143", "/locales/fr.js?v=v13",
                   "/dict/en-fr.txt.gz?v=v143", "/admin-tools.js?v=v999"]) {
    assert.strictEqual(immutable(u), true, `${u} carries a ?v= — it must stay cache-first`);
  }
});

test("a bare or empty ?v= is not a version", () => {
  // "?v=" with no value cannot distinguish two builds, so it must not buy
  // cache-first. /scenario-author.js is the live example of the same file
  // being addressed both ways: versioned by script-loader.js, bare by
  // scenario-author.html — the bare request must go to the network.
  assert.strictEqual(immutable("/scenario-author.js?v="), false);
  assert.strictEqual(immutable("/scenario-author.js"), false);
  assert.strictEqual(immutable("/scenario-author.js?v=v143"), true);
  // …and a different query param is not a version either.
  assert.strictEqual(immutable("/privacy.html?lang=fr"), false);
});

// ==========================================================================
// 4. the generic guard: classification must match the repo's derived reality
// ==========================================================================

/** All captures of `re` in `text`, deduped, in order. */
function allMatches(text, re) {
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");

/** The precache manifest, parsed out of sw.js's TEXT (not the import). */
function derivePrecached() {
  const manifest = read("sw.js").match(/SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(manifest, "sw.js: SHELL_ASSETS array not found — the parser needs updating");
  const paths = allMatches(manifest[1], /"([^"]+)"/g);
  assert.ok(paths.length > 30, `SHELL_ASSETS parsed to only ${paths.length} entries — the parser is broken`);
  return new Set(paths);
}

/**
 * Every same-origin URL the platform actually requests: the served HTML
 * pages' src/href, script-loader.js's v("…") lazy chunks and its two bare
 * loadScript("/…") bundles, i18n.js's locale chunks, reader-dict.js's dicts.
 */
function deriveRequestUrls() {
  const urls = new Set();

  // The leading (?:^|\s) matters: a bare /href="/ also matches the i18n
  // attribute data-i18n-href="privacy", whose value is a TRANSLATION KEY, not
  // a URL — which would inject a phantom /privacy into the corpus.
  const pages = fs.readdirSync(APP).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 5, `only ${pages.length} served HTML pages found — the walk is broken`);
  for (const page of pages) {
    for (const ref of allMatches(read(page), /(?:^|\s)(?:src|href)="([^"]+)"/gm)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue; // absolute / protocol-relative / in-page
      urls.add(ref.startsWith("/") ? ref : "/" + ref);           // pages all sit at the root
    }
  }

  const loader = read("script-loader.js");
  const shellVersion = (loader.match(/SHELL_VERSION\s*=\s*"(v\d+)"/) || [])[1];
  assert.ok(shellVersion, "script-loader.js: SHELL_VERSION marker not found");
  const lazy = allMatches(loader, /\bv\(\s*"([^"]+)"\s*\)/g);
  assert.ok(lazy.length > 20, `script-loader.js yielded only ${lazy.length} v("…") chunks — the parser is broken`);
  for (const chunk of lazy) urls.add(`/${chunk}?v=${shellVersion}`);
  const vendored = allMatches(loader, /loadScript\(\s*"(\/[^"?]+)"\s*\)/g);
  assert.ok(vendored.length > 0, 'script-loader.js: no bare loadScript("/…") bundles found — parser drift');
  for (const b of vendored) urls.add(b);

  const localeVersion = (read("i18n.js").match(/LOCALE_VERSION\s*=\s*"(v\d+)"/) || [])[1];
  assert.ok(localeVersion, "i18n.js: LOCALE_VERSION marker not found");
  const locales = fs.readdirSync(path.join(APP, "locales")).filter((f) => f.endsWith(".js"));
  assert.ok(locales.length > 0, "no /locales/*.js chunks found — derivation is wrong");
  for (const l of locales) urls.add(`/locales/${l}?v=${localeVersion}`);

  const dicts = allMatches(read("reader-dict.js"), /"(\/dict\/[^"]+)"/g);
  assert.ok(dicts.length > 0, "reader-dict.js: no /dict/… files found — parser drift");
  for (const d of dicts) urls.add(`${d}?v=${shellVersion}`);

  assert.ok(urls.size > 50, `only ${urls.size} request URLs derived — the corpus collapsed`);
  return urls;
}

test("every URL the platform requests is classified from the repo's own sources", () => {
  const precached = derivePrecached();
  const vendor = new Set(IMMUTABLE_VENDOR);
  let immutableCount = 0;
  let mutableCount = 0;

  for (const ref of deriveRequestUrls()) {
    const url = new URL(ORIGIN + ref);
    // The independent reality: this URL can serve different bytes tomorrow
    // UNLESS it is version-busted, re-installed on every deploy (precached),
    // or a frozen vendored bundle.
    const expected =
      !!url.searchParams.get("v") || precached.has(url.pathname) || vendor.has(url.pathname);
    assert.strictEqual(
      isImmutableRequest(url),
      expected,
      `${ref}: isImmutableRequest says ${isImmutableRequest(url)}, but the repo says ${expected} ` +
        `(?v=${url.searchParams.get("v") || "-"}, precached=${precached.has(url.pathname)}, ` +
        `vendor=${vendor.has(url.pathname)})`
    );
    expected ? immutableCount++ : mutableCount++;
  }

  // Both halves must be populated, or the loop above proved nothing.
  assert.ok(immutableCount > 30, `only ${immutableCount} immutable URLs — the guard is vacuous`);
  assert.ok(mutableCount > 5, `only ${mutableCount} mutable URLs — the guard is vacuous`);
});

test("any served file that is neither precached nor ?v=-referenced is network-first", () => {
  // The future-proofing clause. Walk what is actually SHIPPED rather than a
  // list, so a page added next year with no version marker is covered without
  // anyone editing this file.
  const precached = derivePrecached();
  const versionedPaths = new Set();
  for (const ref of deriveRequestUrls()) {
    const url = new URL(ORIGIN + ref);
    if (url.searchParams.get("v")) versionedPaths.add(url.pathname);
  }
  assert.ok(versionedPaths.size > 20, `only ${versionedPaths.size} ?v=-referenced paths — derivation is wrong`);

  const served = fs.readdirSync(APP).filter((f) => /\.(html|js|css)$/.test(f));
  assert.ok(served.length > 40, `only ${served.length} served files walked — the walk is broken`);

  const derivedStale = served
    .map((f) => "/" + f)
    .filter((p) => !precached.has(p) && !versionedPaths.has(p) && !IMMUTABLE_VENDOR.includes(p))
    // sw.js is fetched by the browser's own SW update check, never through
    // its own fetch handler, so its classification is moot.
    .filter((p) => p !== "/sw.js");

  assert.ok(derivedStale.length > 0, "derived NO unversioned served files — the guard is vacuous");
  for (const p of derivedStale) {
    assert.strictEqual(
      immutable(p),
      false,
      `${p} is neither precached nor ?v=-referenced anywhere, yet classifies as immutable — ` +
        `it would be pinned to whatever copy a visitor first fetched`
    );
  }

  // …and the hand-written list at the top of this file must not have drifted
  // away from what the repo actually ships.
  assert.deepStrictEqual(
    derivedStale.sort(),
    [...STALE_PRONE].sort(),
    "the derived stale-prone set no longer matches STALE_PRONE — update the list (and check the new entry really should be unversioned)"
  );
});

// ==========================================================================
// 5. behaviour: which copy actually comes back
// ==========================================================================

/**
 * A cache stub whose contents and calls the test can inspect.
 * `put` behaviour is pluggable so a test can hold the write PENDING or make it
 * reject, which is the whole point of the lifetime tests further down.
 */
function fakeCaches(seed = {}, putBehaviour) {
  const store = new Map(Object.entries(seed));
  const calls = { put: [] };
  global.caches = {
    match(req) {
      const key = typeof req === "string" ? req : req.url.replace(ORIGIN, "");
      return Promise.resolve(store.get(key));
    },
    open() {
      return Promise.resolve({
        put(req, resp) {
          const key = req.url ? req.url.replace(ORIGIN, "") : String(req);
          calls.put.push(key);
          store.set(key, resp);
          return putBehaviour ? putBehaviour(key, resp) : Promise.resolve();
        }
      });
    }
  };
  return { store, calls };
}

/** A minimal Response-alike: enough for resp.ok / .type / .clone(). */
function body(text, ok = true) {
  return { ok, type: "basic", text: () => Promise.resolve(text), _text: text, clone() { return this; } };
}

const request = (p, extra = {}) => ({ url: ORIGIN + p, mode: "no-cors", ...extra });

/**
 * A FetchEvent-alike. `waitUntil` collects the promises the SW asks to be kept
 * alive; `settled()` awaits them, which is how a test observes a write that the
 * handler deliberately does NOT await.
 */
function fakeEvent(req) {
  const kept = [];
  const responses = [];
  return {
    request: req,
    kept,
    responses,
    waitUntil(p) { kept.push(p); },
    respondWith(p) { responses.push(p); },
    settled() { return Promise.all(kept); }
  };
}

/** Let every already-queued microtask AND macrotask run. */
const drain = () => new Promise((resolve) => setImmediate(resolve));

test("network-first returns the NETWORK copy even when a stale copy is cached", async () => {
  // The actual bug: privacy.html sat in the cache reading the pre-correction
  // Art. 13 wording, and the fixed copy on the server was never consulted.
  const { calls } = fakeCaches({ "/privacy.html": body("STALE notice") });
  global.fetch = () => Promise.resolve(body("FRESH notice"));

  const req = request("/privacy.html", { mode: "navigate" });
  const ev = fakeEvent(req);
  const resp = await handleSameOrigin(req, ev);
  assert.strictEqual(resp._text, "FRESH notice");
  await ev.settled();
  assert.deepStrictEqual(calls.put, ["/privacy.html"], "the fresh copy must replace the cached one");
});

test("network-first falls back to the CACHED copy when the network throws", async () => {
  // The other half of the contract: a page already visited still renders
  // during a wifi blip. Network-first must not mean network-only.
  fakeCaches({ "/healthcheck.html": body("cached gate") });
  global.fetch = () => Promise.reject(new Error("offline"));

  const req = request("/healthcheck.html");
  const resp = await handleSameOrigin(req, fakeEvent(req));
  assert.strictEqual(resp._text, "cached gate");
});

test("network-first offline with nothing cached: navigations get index.html, others 504", async () => {
  fakeCaches({ "/index.html": body("<shell/>") });
  global.fetch = () => Promise.reject(new Error("offline"));

  const navReq = request("/scenario-author.html", { mode: "navigate" });
  const nav = await handleSameOrigin(navReq, fakeEvent(navReq));
  assert.strictEqual(nav._text, "<shell/>", "a navigation still gets the offline shell");

  const subReq = request("/healthcheck.css");
  const sub = await handleSameOrigin(subReq, fakeEvent(subReq));
  assert.strictEqual(sub.status, 504, "a sub-resource gets the 504 the caller expects");
});

test("cache-first answers from cache WITHOUT touching the network", async () => {
  fakeCaches({ "/script.js": body("cached shell js") });
  let fetched = 0;
  global.fetch = () => { fetched++; return Promise.resolve(body("network js")); };

  const req = request("/script.js");
  const resp = await handleSameOrigin(req, fakeEvent(req));
  assert.strictEqual(resp._text, "cached shell js");
  assert.strictEqual(fetched, 0, "a precached shell asset must not cost a network round-trip");

  // Same for a ?v=-busted lazy chunk.
  fakeCaches({ "/admin-tools.js?v=v143": body("cached chunk") });
  const chunkReq = request("/admin-tools.js?v=v143");
  const chunk = await handleSameOrigin(chunkReq, fakeEvent(chunkReq));
  assert.strictEqual(chunk._text, "cached chunk");
  assert.strictEqual(fetched, 0);
});

test("cache-first on a MISS still fetches and caches", async () => {
  const { calls } = fakeCaches({});
  global.fetch = () => Promise.resolve(body("fetched chunk"));
  const req = request("/room.css");
  const ev = fakeEvent(req);
  const resp = await handleSameOrigin(req, ev);
  assert.strictEqual(resp._text, "fetched chunk");
  await ev.settled();
  assert.deepStrictEqual(calls.put, ["/room.css"]);
});

test("a non-2xx network response is returned as-is, not masked by the cache", async () => {
  const { calls } = fakeCaches({ "/privacy.html": body("STALE notice") });
  global.fetch = () => Promise.resolve(body("<h1>Not found</h1>", false));
  const req = request("/privacy.html");
  const ev = fakeEvent(req);
  const resp = await handleSameOrigin(req, ev);
  assert.strictEqual(resp.ok, false, "a real 404 is information — do not answer it from a stale copy");
  await ev.settled();
  assert.deepStrictEqual(calls.put, [], "a non-2xx must never overwrite the cached copy");
});

// ==========================================================================
// 6. the cache write must outlive the response (CodeRabbit, #305)
// ==========================================================================
//
// A service worker may be terminated as soon as its event handlers settle. A
// fire-and-forget `cache.put(...)` can therefore be killed mid-write, and the
// entry is missing exactly when it is needed — offline. The fix is
// event.waitUntil, NOT await: awaiting would charge every network-first fetch
// the cache-write latency before the page sees a byte. These tests pin both
// halves — the write is protected AND the response is not delayed by it.

test("the cache write is handed to waitUntil while still PENDING, and the response is NOT delayed by it", { timeout: 10000 }, async () => {
  // The put is held open for the whole test, so an implementation that AWAITS
  // it can never produce a response here. Deliberately not awaited directly:
  // `await handleSameOrigin(...)` against an awaiting implementation would hang
  // forever rather than fail, and a hang is not a test result.
  let releasePut;
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  const { calls } = fakeCaches({}, () => putGate);
  global.fetch = () => Promise.resolve(body("FRESH notice"));

  const req = request("/privacy.html", { mode: "navigate" });
  const ev = fakeEvent(req);
  const pending = handleSameOrigin(req, ev);
  let responded = null;
  pending.then((r) => { responded = r; }, () => {});
  await drain();

  // (a) the page already has its response, while the write is still in flight.
  //     This is the assertion that fails for option (1), `await cache.put(...)`.
  assert.ok(responded, "the response must arrive BEFORE the cache write completes — an awaited put would block here");
  assert.strictEqual(responded._text, "FRESH notice");
  // (b) the write really was started…
  assert.deepStrictEqual(calls.put, ["/privacy.html"]);
  // (c) …and handed over exactly once. This is the assertion that fails for a
  //     fire-and-forget write: nothing is handed over at all, so the SW may be
  //     terminated mid-write and the entry is missing when offline needs it.
  assert.strictEqual(ev.kept.length, 1, "the cache write must be handed to event.waitUntil");

  let settled = false;
  ev.kept[0].then(() => { settled = true; }, () => { settled = true; });
  await drain();
  assert.strictEqual(settled, false, "the kept promise is the PENDING write, not an already-resolved placeholder");

  releasePut();
  await ev.settled();
  await drain();
  assert.strictEqual(settled, true, "the kept promise resolves once the write completes");
  await pending;
});

test("the fetch listener threads its FetchEvent through to the cache write", async () => {
  // End-to-end through the REAL registered listener: a fix that teaches
  // fromNetwork about waitUntil but forgets to pass `event` down from
  // event.respondWith(handleSameOrigin(req)) would pass every test above.
  fakeCaches({});
  global.fetch = () => Promise.resolve(body("FRESH notice"));

  const req = request("/privacy.html", { mode: "navigate", method: "GET" });
  const ev = fakeEvent(req);
  swListeners.fetch(ev);

  assert.strictEqual(ev.responses.length, 1, "the listener must respondWith a promise");
  const resp = await ev.responses[0];
  assert.strictEqual(resp._text, "FRESH notice");
  assert.strictEqual(ev.kept.length, 1, "the FetchEvent must reach the cache write — otherwise it is fire-and-forget");
  await ev.settled();
});

test("cache-first also lifetime-protects the write it makes on a MISS", async () => {
  fakeCaches({});
  global.fetch = () => Promise.resolve(body("fetched chunk"));
  const req = request("/room.css");
  const ev = fakeEvent(req);
  await handleSameOrigin(req, ev);
  assert.strictEqual(ev.kept.length, 1, "the immutable path's cache write needs the same protection");
  await ev.settled();
});

test("a cache write that REJECTS never rejects the kept promise or breaks the response", async () => {
  // Quota exceeded, an opaque body, or the cache deleted mid-write. The old
  // code swallowed these with .catch(); handing a REJECTING promise to
  // waitUntil would instead surface an unhandled rejection in the SW.
  for (const failure of [
    () => Promise.reject(new Error("QuotaExceededError")),
    () => { throw new Error("synchronous put failure"); }
  ]) {
    fakeCaches({}, failure);
    global.fetch = () => Promise.resolve(body("FRESH notice"));
    const req = request("/privacy.html");
    const ev = fakeEvent(req);
    const resp = await handleSameOrigin(req, ev);
    assert.strictEqual(resp._text, "FRESH notice", "a failed cache write must not break the response");
    assert.strictEqual(ev.kept.length, 1);
    await assert.doesNotReject(() => ev.kept[0], "the kept promise must never reject");
  }

  // …and the same when caches.open itself fails.
  global.caches = { match: () => Promise.resolve(undefined), open: () => Promise.reject(new Error("no cache")) };
  global.fetch = () => Promise.resolve(body("FRESH notice"));
  const req = request("/privacy.html");
  const ev = fakeEvent(req);
  const resp = await handleSameOrigin(req, ev);
  assert.strictEqual(resp._text, "FRESH notice");
  await assert.doesNotReject(() => ev.kept[0]);
});

test("handleSameOrigin still works when called with no event at all", async () => {
  // Defensive: keepAlive must not throw on a missing/!waitUntil event, and the
  // unprotected write must still not produce an unhandled rejection.
  const { calls } = fakeCaches({}, () => Promise.reject(new Error("QuotaExceededError")));
  global.fetch = () => Promise.resolve(body("FRESH notice"));
  const resp = await handleSameOrigin(request("/privacy.html"));
  assert.strictEqual(resp._text, "FRESH notice");
  await drain();
  assert.deepStrictEqual(calls.put, ["/privacy.html"]);
});
