"use strict";
/* List and delete Firebase Auth accounts over the Identity Toolkit REST API,
 * WITHOUT ever receiving an e-mail address.
 *
 * WHY NOT THE ADMIN SDK. `getAuth().listUsers()` returns whole user records:
 * e-mail, display name and photo URL for every signed-in account. The job that
 * needs this list runs on a GitHub Actions runner in the United States, and it
 * needs none of that — only whether an account is anonymous and when it was
 * last used. Pulling every facilitator's e-mail address across that border
 * each night to answer a yes/no question is the mistake this repository has
 * already made twice with session bodies (the purge and the storage monitor,
 * both fixed 2026-09-01). Art. 5(1)(c).
 *
 * So this asks Google for a PARTIAL RESPONSE. `fields` is a standard system
 * parameter on this API ("Selector specifying which fields to include in a
 * partial response" — identitytoolkit v1 discovery document), and the mask
 * below names exactly five things. An account's sign-in providers are requested
 * by `providerId` alone, so "google.com" comes back and the address behind it
 * does not.
 *
 * ⚠️ THE MASK IS VERIFIED, NOT TRUSTED. If the server ever ignored `fields`,
 * the full records would arrive and nothing would look wrong. Every account
 * object is therefore checked against the allowlist, and a single unexpected
 * KEY aborts the run — naming the key, never its value. The data has crossed by
 * then, but the job stops instead of carrying on every night, and the failure
 * says exactly what happened.
 *
 * Network access is injected (`fetch`, `getToken`) so all of this is testable
 * without credentials or firebase-admin.
 */

const DEFAULT_API_BASE = "https://identitytoolkit.googleapis.com/v1";

/* What one account may contain. Nothing here identifies a person beyond the
   uid itself: three timestamps and the NAMES of the sign-in providers. */
const ACCOUNT_KEYS = ["localId", "createdAt", "lastLoginAt", "lastRefreshAt", "providerUserInfo"];
const PROVIDER_KEYS = ["providerId"];
const FIELD_MASK =
  "nextPageToken,users(localId,createdAt,lastLoginAt,lastRefreshAt,providerUserInfo(providerId))";

const PAGE_SIZE = 1000;          // the API maximum for batchGet
const DELETE_BATCH = 1000;       // the API maximum for batchDelete
const MAX_PAGES = 2000;          // 2M accounts; a runaway-loop bound, not a quota

/** `createdAt` / `lastLoginAt` arrive as int64 STRINGS of milliseconds. */
function msFromEpochString(v) {
  if (typeof v !== "string" || !/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `lastRefreshAt` arrives as an RFC 3339 timestamp. */
function msFromRfc3339(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unexpectedKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

/**
 * Turn one API account object into the shape the retention rules read, after
 * checking the partial-response mask was honoured.
 *
 * @returns {{uid:string, createdMs:number|null, lastLoginMs:number|null,
 *            lastRefreshMs:number|null, providers:string[]}}
 */
function normaliseAccount(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("account listing returned a non-object entry");
  }
  const extra = unexpectedKeys(raw, ACCOUNT_KEYS);
  if (extra.length) {
    throw new Error(
      "the partial-response mask was NOT honoured: an account carried " +
      "unrequested field(s) [" + extra.sort().join(", ") + "]. Refusing to " +
      "process records that may contain e-mail addresses on this runner. " +
      "See the header of scripts/lib/auth-accounts.js.");
  }
  const info = raw.providerUserInfo === undefined ? [] : raw.providerUserInfo;
  if (!Array.isArray(info)) {
    throw new Error("account listing returned a non-array providerUserInfo");
  }
  const providers = [];
  for (const p of info) {
    if (!p || typeof p !== "object") throw new Error("malformed providerUserInfo entry");
    const extraP = unexpectedKeys(p, PROVIDER_KEYS);
    if (extraP.length) {
      throw new Error(
        "the partial-response mask was NOT honoured: a sign-in provider entry " +
        "carried unrequested field(s) [" + extraP.sort().join(", ") + "].");
    }
    /* An entry with no usable providerId still means "this account has a
       sign-in method", which is the only thing the caller asks. Recording it
       keeps such an account out of the anonymous set — the safe direction. */
    providers.push(typeof p.providerId === "string" && p.providerId ? p.providerId : "unknown");
  }
  return {
    uid: typeof raw.localId === "string" ? raw.localId : "",
    createdMs: msFromEpochString(raw.createdAt),
    lastLoginMs: msFromEpochString(raw.lastLoginAt),
    lastRefreshMs: msFromRfc3339(raw.lastRefreshAt),
    providers
  };
}

function requireDeps(deps) {
  if (!deps || typeof deps.fetch !== "function" || typeof deps.getToken !== "function") {
    throw new Error("auth-accounts needs { fetch, getToken, projectId }");
  }
  if (typeof deps.projectId !== "string" || !/^[a-z0-9-]{4,40}$/.test(deps.projectId)) {
    throw new Error("auth-accounts needs a plain projectId, got: " + JSON.stringify(deps.projectId));
  }
  return String(deps.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
}

/**
 * List every Auth account, masked. Throws rather than returning a partial
 * list: the caller treats "not in this list" as "has no account", so a short
 * list must never look like a complete one.
 *
 * @param {object} deps { fetch, getToken, projectId, [apiBase] }
 * @returns {Promise<Array>} normalised accounts
 */
async function listAccounts(deps) {
  const base = requireDeps(deps);
  const out = [];
  const seenTokens = new Set();
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = "maxResults=" + PAGE_SIZE +
      "&fields=" + encodeURIComponent(FIELD_MASK) +
      (pageToken ? "&nextPageToken=" + encodeURIComponent(pageToken) : "");
    const res = await deps.fetch(
      base + "/projects/" + deps.projectId + "/accounts:batchGet?" + qs,
      { headers: { Authorization: "Bearer " + (await deps.getToken()) } });
    if (!res.ok) {
      /* Status only. An error body can echo request details, and these logs
         are world-readable. */
      throw new Error("account listing failed: HTTP " + res.status);
    }
    const body = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("account listing returned a non-object page");
    }
    if (body.users !== undefined && !Array.isArray(body.users)) {
      throw new Error("account listing returned a non-array `users`");
    }
    for (const raw of body.users || []) out.push(normaliseAccount(raw));

    if (!body.nextPageToken) return out;
    if (typeof body.nextPageToken !== "string" || seenTokens.has(body.nextPageToken)) {
      throw new Error("account listing returned an unusable or repeated page token");
    }
    seenTokens.add(body.nextPageToken);
    pageToken = body.nextPageToken;
  }
  throw new Error("account listing did not finish within " + MAX_PAGES + " pages");
}

/**
 * Delete accounts by uid.
 *
 * `force: true` is what the API requires to delete an account that is not
 * disabled; without it every deletion is refused.
 *
 * @param {object} deps { fetch, getToken, projectId, [apiBase], [sleep] }
 * @param {string[]} uids
 * @returns {Promise<{deleted:number, failed:number, httpStatuses:number[]}>}
 *   counts and the distinct non-2xx statuses, never a uid. A failed uid is
 *   retried by the next run, which rediscovers it from the listing.
 */
async function deleteAccounts(deps, uids) {
  const base = requireDeps(deps);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const httpStatuses = new Set();
  let deleted = 0, failed = 0;

  for (let i = 0; i < uids.length; i += DELETE_BATCH) {
    const chunk = uids.slice(i, i + DELETE_BATCH);
    /* batchDelete is limited to one request a second per project. */
    if (i > 0) await sleep(1100);
    const res = await deps.fetch(
      base + "/projects/" + deps.projectId + "/accounts:batchDelete",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + (await deps.getToken()),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ localIds: chunk, force: true })
      });
    if (!res.ok) {
      /* Carry on with the remaining chunks: one refused batch should not
         strand the rest, and the caller reports the status and exits non-zero. */
      httpStatuses.add(res.status);
      failed += chunk.length;
      continue;
    }
    /* A 200 carries per-uid failures in `errors`; an empty body means none. */
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      /* Unreadable reply to a request that may have partly applied. Count the
         whole chunk as failed rather than claim deletions nobody confirmed. */
      httpStatuses.add(res.status);
      failed += chunk.length;
      continue;
    }
    const errs = Math.min(body && Array.isArray(body.errors) ? body.errors.length : 0, chunk.length);
    failed += errs;
    deleted += chunk.length - errs;
  }
  return { deleted, failed, httpStatuses: [...httpStatuses].sort((a, b) => a - b) };
}

module.exports = {
  listAccounts, deleteAccounts, normaliseAccount,
  msFromEpochString, msFromRfc3339,
  FIELD_MASK, ACCOUNT_KEYS, PROVIDER_KEYS, PAGE_SIZE, DELETE_BATCH
};
