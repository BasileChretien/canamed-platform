/* Scaleway Serverless Functions adapter.
 *
 * WHY SCALEWAY IS THE RECOMMENDED HOST. Cloudflare's free plan runs a Worker
 * at whichever edge PoP is nearest the visitor, anywhere in the world;
 * restricting execution to the EU needs Regional Services / the Data
 * Localization Suite, an ENTERPRISE add-on. Scaleway is a French provider and
 * `fr-par` is Paris, so deploying here keeps participants' free-text chat
 * inside the EEA — the commitment recorded in functions/index.js and
 * modA-llm-init.js, and the one Japan's APPI Art. 28 equivalence list depends
 * on (it covers only the EEA and the UK). It also puts the proxy in the same
 * country as the pinned inference provider (OVHcloud, Gravelines).
 *
 * Free tier: 1,000,000 requests and 400,000 GB-s per account per month —
 * orders of magnitude above workshop traffic.
 *
 * ⚠ NOTE ON THE RATE-LIMIT STORE. Scaleway's free tier includes no key/value
 * service, and Serverless SQL Database has no free tier (it bills from
 * ~€0.10/month even when idle). So this adapter binds NO store and lets
 * handler.js fall back to its RTDB-backed default, which is free, already
 * inside the EEA, already named in the DPA, and — thanks to the
 * increment-only database rule — atomic. See proxy/src/stores.js.
 *
 * Scaleway's Node runtime is a normal Node 20/22, so `fetch`, `Request`,
 * `Response` and `crypto.subtle` are all global; the shared handler needs no
 * polyfills. All this file does is translate between Scaleway's
 * event/response envelope and the Fetch API objects the handler speaks.
 */

"use strict";

let handleRequest;

/* The shared core is ESM and this file is CJS (Scaleway's Node template).
 * A cached dynamic import keeps the cold-start cost to one load. */
async function core() {
  if (!handleRequest) ({ handleRequest } = await import("../src/handler.js"));
  return handleRequest;
}

/* Scaleway passes headers as a plain object; values may be arrays when a
 * header repeats. Headers() rejects an array, so join per the HTTP spec. */
function toHeaders(raw) {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw || {})) {
    if (v === undefined || v === null) continue;
    h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  return h;
}

function toRequest(event) {
  const headers = toHeaders(event.headers);
  const method = event.httpMethod || event.method || "GET";
  /* Scaleway base64-encodes the body for binary content types and sets
   * isBase64Encoded. Decoding unconditionally would corrupt a plain JSON
   * body, so honour the flag. */
  let body = event.body;
  if (body && event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
  // GET/HEAD must not carry a body or the Request constructor throws.
  const canHaveBody = method !== "GET" && method !== "HEAD";

  /* The URL only has to be well-formed — the handler routes on method, not
   * path — but keep the real path so logs are readable. */
  const host = headers.get("host") || "proxy.invalid";
  const url = "https://" + host + (event.path || "/");
  return new Request(url, { method, headers, body: canHaveBody ? (body || null) : undefined });
}

async function fromResponse(res) {
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const text = await res.text();
  return { statusCode: res.status, headers, body: text };
}

module.exports.handle = async (event, _context, _callback) => {
  try {
    const run = await core();
    /* process.env carries the function's configured variables AND its
     * secrets (HF_TOKEN), which Scaleway injects the same way. Passing it
     * straight through is why the shared handler needs no Scaleway-specific
     * config code. */
    const res = await run(toRequest(event), process.env, {});
    return fromResponse(res);
  } catch (e) {
    /* Never leak an internal error to the caller: the client treats any
     * failure as "backend unavailable" and falls back to the stub patient,
     * which is the behaviour we want, and the detail belongs in the log. */
    console.error("[hfPatient-proxy] unhandled:", e && e.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: { reply: "", state: "error", error: "backend unavailable" } })
    };
  }
};
