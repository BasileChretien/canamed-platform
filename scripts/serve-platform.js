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

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(url.parse(req.url).pathname);
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  // strict: deny anything that escapes ROOT
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
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

server.listen(PORT, "127.0.0.1", () => {
  console.log("CaNaMED platform listening on http://127.0.0.1:" + PORT);
});
