/* sw.js — CaNaMED Service Worker.
 *
 * Goal: a 30-second wifi blip mid-workshop is a non-event. The platform
 * shell (HTML/CSS/JS/fonts) loads from cache; Firebase API calls go to
 * network with a graceful offline fallback. When the session resumes,
 * the in-page Firebase SDK reconnects via its own offline-queue.
 *
 * Strategy:
 *   - Cache-first for the static shell (versioned cache name; old caches
 *     evicted on activate so a redeploy never serves stale JS)
 *   - Network-FIRST, cache-fallback for every other same-origin GET — see
 *     isImmutableRequest() below for why the split exists and where it runs
 *   - Network-only for Firebase (firebaseio.com / firebasedatabase.app /
 *     googleapis.com / recaptcha) — SW never intercepts these
 *   - Navigation fallback: if a top-level GET fails offline, serve the
 *     cached index.html so the user still sees the platform shell with
 *     a "you're offline — reconnecting" banner
 *
 * Cache versioning:
 *   - SHELL_VERSION bumps on every deploy (Firebase Hosting cache-busts
 *     by URL hash, but the SW shell is content-addressed by this string)
 *   - On activate, all caches whose name doesn't start with the current
 *     SHELL_VERSION are deleted
 *
 * Lifecycle:
 *   1. Page loads, sw-register.js registers this SW
 *   2. SW installs → pre-caches the shell
 *   3. SW activates → cleans old caches
 *   4. Future fetches go through onfetch (shell from cache, API from network)
 *
 * Privacy: this SW does not log, ping, or share any data. It exists
 * entirely on the user's device.
 */

"use strict";

// Bump on every deploy — the SW won't "see" a new shell version until this
// string changes. Use a build-time injection if you ever want this automated;
// for now, bump manually when shipping a deploy that should invalidate
// the shell cache.
const SHELL_VERSION = "canamed-shell-v162";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/tokens.css",
  "/style.css",
  "/fonts/source-sans-3-latin-wght-normal.woff2",
  "/fonts/source-sans-3-latin-ext-wght-normal.woff2",
  "/fonts/source-serif-4-latin-wght-normal.woff2",
  "/fonts/source-serif-4-latin-ext-wght-normal.woff2",
  "/privacy.css",
  "/theme-init.js",
  "/qrcode.js",
  "/telemetry.js",
  "/purify.min.js",
  "/i18n.js",
  "/lib.js",
  "/localdb.js",
  "/script.js",
  "/case-content.js",
  "/branched-seed.js",
  "/branched-render.js",
  "/branched-runtime.js",
  "/section-registry.js",
  "/section-content.js",
  "/section-picker.js",
  "/takehome.js",
  "/script-admin.js",
  "/branched.css",
  "/admin.css",
  "/room.css",
  "/modA-question-scoring.js",
  "/modA-llm-prompts.js",
  "/modA-llm-bridge.js",
  "/modA-llm-init.js",
  "/glossary.js",
  "/admin-tools.js",
  "/facilitator-guide.html",
  "/compliance.html",
  "/revisit.html",
  "/revisit.js",
  "/docs-page.css",
  "/docs-page.js",
  "/platform-config.js",
  "/firebase-config.js",
  "/manifest.webmanifest"
];

// NOTE (#48 — i18n locale lazy-load): the per-language tables in
// /locales/<lang>.js are deliberately NOT precached here. /i18n.js carries
// the inline English fallback (always cached above), so a fresh offline user
// always has working English UI. Each non-English locale is fetched on demand
// by ensureLang and then picked up by the runtime cache-on-fetch path in
// handleSameOrigin() below, so it survives a later offline blip. Precaching
// all 7 here would re-bloat the install we just trimmed off the splash.
//
// Same rationale for the reading aid (reader-core.js + lang-reader.js,
// ensureLangReader): it's lazy + opt-in ("Word help" toggle), so it's NOT
// precached. handleSameOrigin caches with { ignoreSearch: false }, so a
// precache of the bare "/lang-reader.js" would never match the versioned
// "lang-reader.js?v=vNN" the loader requests anyway — the cache-on-fetch path
// is what actually makes it survive offline once it's been loaded once.

// --- which same-origin URLs may be served from cache WITHOUT asking ---------
//
// Cache-first is only sound when the URL changes whenever the content changes,
// or the content never changes. It held for the shell and quietly failed for
// everything else: handleSameOrigin used to be unconditionally cache-first AND
// to cache every same-origin 200 it saw, so a returning visitor kept the first
// copy they ever fetched until some UNRELATED SHELL_VERSION bump happened to
// evict it — and a PR touching only these files needs no bump, so the change
// reached nobody who had ever loaded the page. Concretely stale-pinned:
//
//   - privacy.html / privacy-fr.html / privacy-ja.html + privacy-lang.js +
//     privacy-redirect.js — the Art. 13 legal notice in three languages. It
//     has drifted from the code before and was corrected with a guard
//     (tests/retention-notice-consistency.test.js); a returning participant
//     kept reading the pre-correction wording indefinitely.
//   - healthcheck.html / healthcheck.js / healthcheck.css — the operator's
//     pre-session gate, which OPERATOR_QUICK_START now sends operators to. A
//     stale gate runs old checks against a new backend.
//   - verify.html, scenario-author.html / .css / scenario-author-cloud.js,
//     branched-author.js, branched-validate.js — secondary entry points whose
//     HTML carries no ?v= of its own.
//
// Three families ARE safe to serve cache-first, and only these:
//   1. anything carrying a non-empty ?v= (SHELL_VERSION for the shell and the
//      lazy chunks, LOCALE_VERSION for /locales/*.js, a page's own marker for
//      e.g. verify.js?v=v26) — a new build asks for a NEW url;
//   2. the SHELL_ASSETS precache manifest — the cache NAME carries
//      SHELL_VERSION and `activate` deletes every cache that isn't the current
//      one, so a deploy re-installs the whole manifest;
//   3. IMMUTABLE_VENDOR, below.
// Everything else is network-first with a cache fallback, so a page already
// visited still renders offline — the "30-second wifi blip is a non-event"
// goal is about the SHELL, which stays entirely cache-first.
const IMMUTABLE_VENDOR = [
  // pdfmake + its font bundle: ~2.2 MB, vendored, never edited in place.
  // script-loader.js loads them deliberately WITHOUT a ?v= because "a ?v= bump
  // would force a pointless 2 MB re-download" — so they are neither precached
  // nor versioned, and network-first would re-fetch them every session. They
  // are the one case where "the content never changes" is the real guarantee,
  // so they stay cache-first by name. Keep this list at exactly these two:
  // growing it must be a deliberate, reviewed act (a unit test pins the pair).
  "/pdfmake.min.js",
  "/vfs_fonts.js"
];

const SHELL_ASSET_PATHS = new Set(SHELL_ASSETS);

/**
 * True when `url` (a URL object) addresses content that cannot change under
 * that exact URL, so answering from cache without asking the network is safe.
 * Pure — same URL in, same answer out, no I/O. The whole cache policy hinges
 * on it, which is why it is a named predicate rather than an inline condition.
 */
function isImmutableRequest(url) {
  // A bare "?v=" is not a version — require a non-empty value.
  if (url.searchParams.get("v")) return true;
  if (SHELL_ASSET_PATHS.has(url.pathname)) return true;
  return IMMUTABLE_VENDOR.indexOf(url.pathname) !== -1;
}

// Hostnames whose fetches should ALWAYS go to network (never cached) —
// these are dynamic, auth-tokened, and stateful.
const NETWORK_ONLY_HOSTS = [
  "firebaseio.com",
  "firebasedatabase.app",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "recaptcha.net",
  "firebaseapp.com"
];

// --- install: pre-cache the shell ----------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_VERSION).then((cache) => {
      // Cache each asset individually so a single 404 doesn't abort the install
      return Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((e) => {
            console.warn("[sw] shell asset failed to cache: " + url, e);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// --- activate: drop stale caches -----------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== SHELL_VERSION).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// --- fetch: shell from cache, API from network ---------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes

  const url = new URL(req.url);
  const isNetworkOnly = NETWORK_ONLY_HOSTS.some(
    (h) => url.hostname === h || url.hostname.endsWith("." + h)
  );
  if (isNetworkOnly) return; // SW doesn't intercept
  if (url.origin === self.location.origin && url.pathname.startsWith("/__/")) return; // Firebase Auth reserved paths: never cache/intercept

  // Same-origin: cache-first for the immutable shell, network-first otherwise.
  // `event` rides along so the cache write can outlive the response — see
  // keepAlive(). Dropping it silently reverts the write to fire-and-forget.
  if (url.origin === self.location.origin) {
    event.respondWith(handleSameOrigin(req, event));
    return;
  }
  // Cross-origin GET (e.g. icon): network-only, no cache layer.
});

/** Route a same-origin GET by whether its URL pins its content. */
async function handleSameOrigin(req, event) {
  return isImmutableRequest(new URL(req.url))
    ? cacheFirst(req, event)
    : networkFirst(req, event);
}

/** Immutable URL: answer from cache; only touch the network on a miss. */
async function cacheFirst(req, event) {
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;
  try {
    return await fromNetwork(req, event);
  } catch (e) {
    return offlineFallback(req);
  }
}

/**
 * Mutable URL: ask the network, and fall back to the cached copy only when the
 * network THROWS (offline, DNS, connection reset). A non-2xx response is
 * returned as-is: a real 404/500 is information, and masking it with a stale
 * copy is the very behaviour this split exists to remove.
 */
async function networkFirst(req, event) {
  try {
    return await fromNetwork(req, event);
  } catch (e) {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;
    return offlineFallback(req);
  }
}

/** Fetch, and keep a copy of a cacheable 200 so the page survives offline. */
async function fromNetwork(req, event) {
  const resp = await fetch(req);
  if (resp.ok && (resp.type === "basic" || resp.type === "default")) {
    keepAlive(event, storeInCache(req, resp.clone()));
  }
  return resp;
}

/** Put a response in the shell cache. Never rejects — quota/opaque are fine. */
async function storeInCache(req, resp) {
  try {
    const cache = await caches.open(SHELL_VERSION);
    await cache.put(req, resp);
  } catch (e) { /* quota exceeded, opaque body, cache deleted mid-write */ }
}

/**
 * Hold the fetch event open until `promise` settles, WITHOUT delaying the
 * response the page is waiting on.
 *
 * A service worker may be terminated as soon as its handlers settle, so a
 * fire-and-forget `cache.put(...)` can be killed mid-write — and the entry is
 * then missing exactly when it is needed, offline. (CodeRabbit, #305; the
 * pre-existing code had the same shape.) `await`ing the put instead would also
 * be correct, but it charges EVERY network-first fetch the cost of the cache
 * write before the page sees a byte — on the path this change just made
 * network-first. waitUntil extends the event's lifetime rather than the
 * response's latency, which is what it is for.
 */
function keepAlive(event, promise) {
  // Called before the respondWith promise settles, so the event is still
  // active. The guard covers a direct call with no event (unit tests) and the
  // InvalidStateError a strict host could raise on a late call; storeInCache
  // never rejects, so an un-protected promise can still not go unhandled.
  try {
    if (event && typeof event.waitUntil === "function") event.waitUntil(promise);
  } catch (e) { /* the write still runs, it just isn't lifetime-protected */ }
}

/**
 * Offline with nothing cached for this request. A navigation gets the cached
 * shell so the user sees the "you're offline — reconnecting" banner instead of
 * a blank page; anything else gets a 504 and the caller decides.
 */
async function offlineFallback(req) {
  if (req.mode === "navigate") {
    const indexFallback = await caches.match("/index.html");
    if (indexFallback) return indexFallback;
  }
  return new Response("", {
    status: 504,
    statusText: "Offline + not in cache"
  });
}

// Listen for "skip-waiting" message from the page (manual update prompt).
self.addEventListener("message", (event) => {
  // Only honour a same-origin window client (event.source present). skipWaiting
  // only activates already-installed code, but the source check is cheap hardening.
  if (event.data === "skipWaiting" && event.source) self.skipWaiting();
});

// Node-only export so tests/sw-cache-policy.test.js can exercise the cache
// policy directly. `module` is undefined in a ServiceWorkerGlobalScope, so the
// browser never reaches this — same guard as localdb.js / pure-utils.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SHELL_VERSION,
    SHELL_ASSETS,
    IMMUTABLE_VENDOR,
    isImmutableRequest,
    handleSameOrigin
  };
}
