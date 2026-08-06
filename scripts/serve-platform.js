#!/usr/bin/env node
/* Minimal static file server for the PBL platform — used by the Playwright
 * E2E suite (and handy for local poking). Serves docs/Third_session/PBL_platform/
 * on http://localhost:8765 with the same Content-Security-Policy headers
 * the production deploy sends, so tests catch CSP regressions too.
 *
 * No external dependencies — built on Node's http + fs. The static set is
 * tiny (~10 files), so a 60-line bespoke server beats pulling express in.
 *
 * Usage:
 *   node scripts/serve-platform.js                # http://localhost:8765
 *   PORT=3000 node scripts/serve-platform.js      # custom port
 *
 * ROUTING — see REWRITES / ORG_PREFIX_RE below. This server used to do
 * nothing but map pathname -> file, so `/o/<slug>/` (the multi-tenant org
 * entry point that firebase.json rewrites to index.html) returned a bare
 * 404 and no E2E test could ever load an org URL. That is why the whole
 * `orgs/` database subtree had never been driven end to end.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(__dirname, "..", "docs", "Third_session", "PBL_platform");
const PORT = parseInt(process.env.PORT || "8765", 10);

// Mirror the headers in docs/Third_session/PBL_platform/firebase.json so
// tests get the same CSP / framing / cache behaviour as production.
//
// SIM_EMULATOR_MODE=1 (set by scripts/sim/sim-with-emulator.js) extends
// the CSP to allow http/ws://127.0.0.1:* and ://localhost:*. Both
// connect-src AND script-src need the relaxation — Firebase's RTDB
// long-polling fallback loads scripts from /lp on the database
// emulator port, so a connect-src-only relaxation would still get
// "Refused to load the script" CSP errors silently breaking writes.
const _EMU_HOSTS = " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*";
const _EMU_HOSTS_SCRIPT = " http://127.0.0.1:* http://localhost:*";
const _EMU_CONNECT = process.env.SIM_EMULATOR_MODE === "1" ? _EMU_HOSTS : "";
const _EMU_SCRIPT  = process.env.SIM_EMULATOR_MODE === "1" ? _EMU_HOSTS_SCRIPT : "";
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/" + _EMU_SCRIPT + "; connect-src 'self' https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.googleapis.com https://accounts.google.com https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/" + _EMU_CONNECT + "; frame-src https://canamed-69785.firebaseapp.com https://accounts.google.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/; frame-ancestors 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.googleusercontent.com https://lh3.googleusercontent.com; object-src 'none'; base-uri 'self'; form-action 'none'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

/* ---------------------------------------------------------------------------
 * Routing — kept in lockstep with docs/Third_session/PBL_platform/firebase.json
 * `hosting.rewrites`. tests/serve-platform-routing.test.js READS that file and
 * asserts this server honours every rewrite in it, so the two cannot drift.
 *
 * Firebase Hosting resolves a request as: real file first, then the rewrite
 * table in order. `resolveRequest()` below does the same.
 * ------------------------------------------------------------------------- */
const REWRITES = [
  // { "source": "/o/**", "destination": "/index.html" }
  { source: "/o/**", match: (p) => /^\/o\/[^/]+(?:\/|$)/.test(p), destination: "/index.html" },
  // { "source": "/v", "destination": "/verify.html" }
  { source: "/v", match: (p) => p === "/v", destination: "/verify.html" }
];

/* Resolve a pathname to an absolute file under ROOT, or null. */
function fileUnderRoot(urlPath) {
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) return undefined;   // traversal → 403
  try {
    return fs.statSync(filePath).isFile() ? filePath : null;
  } catch (_) {
    return null;
  }
}

/* Map a request pathname to the file this server should send.
 *
 * Returns { file } to serve, { forbidden: true } for a traversal attempt, or
 * null for a genuine 404. Exported so the routing test can exercise it
 * directly as well as over HTTP.
 */
function resolveRequest(urlPath) {
  if (urlPath === "" || urlPath === "/") urlPath = "/index.html";

  // 1. A real file always wins, exactly as on Firebase Hosting.
  let hit = fileUnderRoot(urlPath);
  if (hit === undefined) return { forbidden: true };
  if (hit) return { file: hit };

  /* 2. The firebase.json rewrite table, in order.
   *
   * ⚠ THERE IS DELIBERATELY NO ORG-ASSET FALLBACK HERE. An earlier version of
   * this server stripped a leading `/o/<slug>` and retried, because index.html
   * addressed every asset RELATIVELY and a shell served at `/o/<slug>/` asked
   * for `/o/<slug>/script.js`. That crutch had to go the moment the app moved
   * to ROOT-ABSOLUTE asset URLs (2026-08-06), for two reasons:
   *
   *   1. It is not what Hosting does. Measured against the live deploy
   *      2026-08-05, BEFORE the root-absolute fix:
   *          GET /theme-init.js               -> 200 text/javascript (1 579 B)
   *          GET /o/caen-nagoya/theme-init.js -> 200 text/html     (221 781 B)
   *      i.e. the `/o/**` rewrite swallows every org-prefixed asset and hands
   *      back index.html, which `X-Content-Type-Options: nosniff` then refuses
   *      to execute. Keeping the crutch means the dev server is KINDER than
   *      production, which is the one direction a test server must never be.
   *   2. It would MASK the very regression the fix exists to prevent. With the
   *      strip in place, a relative asset ref still resolves locally, so
   *      org-URL tests pass whether or not the app is addressing correctly.
   *      Without it, a single relative ref comes back as the SPA shell and the
   *      org e2e spec fails — which is exactly the control run recorded in
   *      tests-e2e/org-session-e2e.spec.js.
   *
   * So: real file, then rewrites. Same as Hosting, no more and no less.
   */
  for (const rw of REWRITES) {
    if (!rw.match(urlPath)) continue;
    hit = fileUnderRoot(rw.destination);
    if (hit) return { file: hit };
  }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(url.parse(req.url).pathname);
  const resolved = resolveRequest(urlPath);
  if (resolved && resolved.forbidden) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (!resolved) { res.writeHead(404); res.end("Not Found: " + urlPath); return; }
  const filePath = resolved.file;
  fs.readFile(filePath, (err, body) => {
    if (err) { res.writeHead(404); res.end("Not Found: " + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    // Emulator mode: index.html ships an inline <meta http-equiv
    // "Content-Security-Policy"> tag with the production rules. Browsers
    // apply the INTERSECTION of header + meta CSPs, so the meta blocks
    // localhost even when the response header allows it. Rewrite the
    // meta to add the same localhost extras whenever we serve HTML in
    // emulator mode. Production hosting never sees this branch.
    if (process.env.SIM_EMULATOR_MODE === "1" && ext === ".html") {
      const src = body.toString("utf8");
      const patched = src
        .replace(
          /(script-src[^;]*)(;)/,
          "$1 http://127.0.0.1:* http://localhost:*$2"
        )
        .replace(
          /(connect-src[^;]*)(;)/,
          "$1 http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*$2"
        );
      body = Buffer.from(patched, "utf8");
    }
    res.writeHead(200, Object.assign({
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, max-age=0"
    }, SECURITY_HEADERS));
    res.end(body);
  });
});

/* Only listen when run as a script — the routing test requires this file and
   drives `server` on an ephemeral port of its own. */
if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log("CaNaMED platform listening on http://127.0.0.1:" + PORT);
  });
}

module.exports = { server, resolveRequest, REWRITES, ROOT, SECURITY_HEADERS };
