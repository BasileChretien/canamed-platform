#!/usr/bin/env node
/* synthetic-uptime-check.js
 *
 * External health probe for the CaNaMED platform. Runs from GitHub Actions
 * on a 5-minute cron so we know the production site is reachable from outside
 * Firebase's network — catches OAuth/Hosting outages we'd otherwise discover
 * at session-start.
 *
 * Checks:
 *   1. GET https://canamed-69785.web.app/                       (splash)
 *   2. GET https://canamed-69785.web.app/privacy.html           (privacy)
 *   3. GET https://canamed-69785.web.app/healthcheck.html       (smoke page; tolerated 404 if not yet shipped)
 *
 * For each: must return HTTP 200, must include the brand mark text, must
 * include the platform's <title> tag. If any check fails, the script exits
 * with code 1 — the GitHub Actions job will go red and the operator gets
 * an email.
 *
 * No external dependencies — uses node's built-in https module so it runs
 * without `npm install`. Works on node >= 18.
 *
 * Usage:
 *   node scripts/synthetic-uptime-check.js
 *   PROBE_URL=https://staging.example node scripts/synthetic-uptime-check.js
 */

"use strict";

const https = require("node:https");

const BASE = (process.env.PROBE_URL || "https://canamed-69785.web.app").replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

const CHECKS = [
  {
    url: BASE + "/",
    label: "splash",
    expectStatuses: [200],
    mustContain: ["CaNaMED", "splash"]
  },
  {
    url: BASE + "/privacy.html",
    label: "privacy.html",
    expectStatuses: [200],
    mustContain: ["Privacy Policy", "GDPR"]
  },
  {
    // healthcheck page is shipped in a separate PR; treat 404 as tolerable
    // here (probe still records it, just doesn't fail the run on 404)
    url: BASE + "/healthcheck.html",
    label: "healthcheck.html",
    expectStatuses: [200, 404],
    mustContain: []
  }
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = https.get(url, { headers: { "User-Agent": "canamed-synthetic-probe" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body,
          ms: Date.now() - startedAt,
          headers: res.headers
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("Request timed out after " + TIMEOUT_MS + "ms"));
    });
  });
}

async function runOne(check) {
  try {
    const r = await fetchUrl(check.url);
    const statusOk = check.expectStatuses.indexOf(r.status) >= 0;
    const contentOk = check.mustContain.every(s => r.body.indexOf(s) >= 0);
    const pass = statusOk && (r.status !== 200 || contentOk);
    return {
      label: check.label,
      url: check.url,
      pass: pass,
      status: r.status,
      ms: r.ms,
      missing: contentOk ? [] : check.mustContain.filter(s => r.body.indexOf(s) < 0),
      // not-fatal mark for the 404 case on shippable-later pages
      tolerated: r.status !== 200 && check.expectStatuses.indexOf(r.status) >= 0
    };
  } catch (e) {
    return {
      label: check.label,
      url: check.url,
      pass: false,
      status: 0,
      ms: 0,
      error: e.message
    };
  }
}

(async function main() {
  console.log("Probing", BASE, "at", new Date().toISOString());
  const results = [];
  for (const c of CHECKS) {
    const r = await runOne(c);
    const tag = r.pass ? (r.tolerated ? "TOLERATED" : "OK") : "FAIL";
    console.log("[" + tag + "]", r.label.padEnd(20), "status=" + r.status, "ms=" + r.ms,
      r.error ? "error=" + r.error : "",
      r.missing && r.missing.length ? "missing=" + r.missing.join("|") : "");
    results.push(r);
  }
  const hardFails = results.filter(r => !r.pass);
  if (hardFails.length > 0) {
    console.error("FAIL: " + hardFails.length + " check(s) failed");
    process.exit(1);
  }
  console.log("OK: all checks passed");
})();
