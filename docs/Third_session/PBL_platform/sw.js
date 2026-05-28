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
const SHELL_VERSION = "canamed-shell-v27";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
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
  "/fb-timings.min.js",
  "/manifest.webmanifest"
];

// NOTE (#48 — i18n locale lazy-load): the per-language tables in
// /locales/<lang>.js are deliberately NOT precached here. /i18n.js carries
// the inline English fallback (always cached above), so a fresh offline user
// always has working English UI. Each non-English locale is fetched on demand
// by ensureLang and then picked up by the runtime cache-on-fetch path in
// handleSameOrigin() below, so it survives a later offline blip. Precaching
// all 7 here would re-bloat the install we just trimmed off the splash.

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

  // Same-origin shell: cache-first, fall through to network, then 504.
  if (url.origin === self.location.origin) {
    event.respondWith(handleSameOrigin(req));
    return;
  }
  // Cross-origin GET (e.g. icon): network-only, no cache layer.
});

async function handleSameOrigin(req) {
  // 1. Try cache
  const cached = await caches.match(req, { ignoreSearch: false });
  if (cached) return cached;

  // 2. Cache miss → network. Cache successful 200 responses for next time.
  try {
    const resp = await fetch(req);
    if (resp.ok && (resp.type === "basic" || resp.type === "default")) {
      const cache = await caches.open(SHELL_VERSION);
      cache.put(req, resp.clone()).catch(() => { /* quota / opaque */ });
    }
    return resp;
  } catch (e) {
    // 3. Offline + cache miss. If this is a navigation, serve the cached
    //    shell so the user gets the offline banner instead of a blank page.
    if (req.mode === "navigate") {
      const indexFallback = await caches.match("/index.html");
      if (indexFallback) return indexFallback;
    }
    // Otherwise 504 — caller decides how to handle.
    return new Response("", {
      status: 504,
      statusText: "Offline + not in cache"
    });
  }
}

// Listen for "skip-waiting" message from the page (manual update prompt).
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
