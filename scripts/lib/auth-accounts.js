"use strict";
/* List, re-check and delete Firebase Auth accounts over the Identity Toolkit
 * REST API, WITHOUT ever receiving an e-mail address.
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
 * ⚠️ THE MASK IS VERIFIED, NOT TRUSTED — and the verification can only DETECT
 * a transfer, not undo one. If the server ignored `fields`, whole records
 * would arrive and nothing would look wrong, so every account object is checked
 * against the allowlist and a single unexpected KEY aborts the run, naming the
 * key and never its value. To keep what an ignored mask can expose as small as
 * it can be, the listing begins with a CANARY: one account, same mask, same
 * check. Only when that comes back clean are the full pages requested.
 *
 * Network access is injected (`fetch`, `getToken`) so all of this is testable
 * without credentials or firebase-admin.
 */

const DEFAULT_API_BASE = "https://identitytoolkit.googleapis.com/v1";

/* What one account may contain. Nothing here identifies a person beyond the
   uid itself: three timestamps and the NAMES of the sign-in providers. */
const ACCOUNT_KEYS = ["localId", "createdAt", "lastLoginAt", "lastRefreshAt", "providerUserInfo"];
const PROVIDER_KEYS = ["providerId"];
const USER_MASK = "users(localId,createdAt,lastLoginAt,lastRefreshAt,providerUserInfo(providerId))";
const FIELD_MASK = "nextPageToken," + USER_MASK;

const PAGE_SIZE = 1000;          // the API maximum for batchGet
const DELETE_BATCH = 1000;       // the API maximum for batchDelete
const LOOKUP_BATCH = 100;        // the API maximum for accounts:lookup by localId
const MAX_PAGES = 2000;          // 2M accounts; a runaway-loop bound, not a quota
/* Without one, a stalled connection runs to the workflow's timeout, and GitHub
   records that as "cancelled" — which sends no failure mail. */
const REQUEST_TIMEOUT_MS = 60 * 1000;

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
 * `dateFault` is true when a date field is PRESENT but unreadable. That is not
 * the same as absent, and the difference decides a deletion: a returning
 * participant's sign-in date never moves (the SDK restores the session), so the
 * last-refresh date is the only sign they are still here. Reading a garbled one
 * as "no date" would leave the old sign-in date to speak for the account and
 * expire someone who was active yesterday.
 *
 * @returns {{uid:string, createdMs:number|null, lastLoginMs:number|null,
 *            lastRefreshMs:number|null, dateFault:boolean, providers:string[]}}
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

  let dateFault = false;
  const date = (key, parse) => {
    if (raw[key] === undefined) return null;
    const ms = parse(raw[key]);
    if (ms === null) dateFault = true;
    return ms;
  };
  return {
    uid: typeof raw.localId === "string" ? raw.localId : "",
    createdMs: date("createdAt", msFromEpochString),
    lastLoginMs: date("lastLoginAt", msFromEpochString),
    lastRefreshMs: date("lastRefreshAt", msFromRfc3339),
    dateFault,
    providers
  };
}

/* The same uid on two pages is not something this API documents, but a
   listing that changes while it is being paged could produce it. Merged in the
   direction that DELETES LESS: every provider seen, the latest of each date. */
function mergeAccounts(a, b) {
  const later = (x, y) => (x === null ? y : (y === null ? x : Math.max(x, y)));
  return {
    uid: a.uid,
    createdMs: later(a.createdMs, b.createdMs),
    lastLoginMs: later(a.lastLoginMs, b.lastLoginMs),
    lastRefreshMs: later(a.lastRefreshMs, b.lastRefreshMs),
    dateFault: a.dateFault || b.dateFault,
    providers: [...new Set(a.providers.concat(b.providers))]
  };
}

function requireDeps(deps) {
  if (!deps || typeof deps.fetch !== "function" || typeof deps.getToken !== "function") {
    throw new Error("auth-accounts needs { fetch, getToken, projectId }");
  }
  if (typeof deps.projectId !== "string" || !/^[a-z0-9-]{4,40}$/.test(deps.projectId)) {
    throw new Error("auth-accounts needs a plain projectId, got: " + JSON.stringify(deps.projectId));
  }
  return String(deps.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "") +
    "/projects/" + deps.projectId;
}

async function send(deps, url, init) {
  const headers = Object.assign({ Authorization: "Bearer " + (await deps.getToken()) },
    (init && init.headers) || {});
  return deps.fetch(url, Object.assign({}, init, {
    headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }));
}

/* A JSON parse error quotes the text it choked on, and that text is a response
   that may hold account data. The status is reported; the body never is. */
async function readBody(res, what) {
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(what + " returned an unreadable body: HTTP " + res.status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(what + " returned a non-object body");
  }
  if (body.users !== undefined && !Array.isArray(body.users)) {
    throw new Error(what + " returned a non-array `users`");
  }
  return body;
}

async function fetchPage(deps, root, pageSize, pageToken) {
  const qs = "maxResults=" + pageSize + "&fields=" + encodeURIComponent(FIELD_MASK) +
    (pageToken ? "&nextPageToken=" + encodeURIComponent(pageToken) : "");
  const res = await send(deps, root + "/accounts:batchGet?" + qs);
  /* Status only. An error body can echo request details, and these logs are
     world-readable. */
  if (!res.ok) throw new Error("account listing failed: HTTP " + res.status);
  return readBody(res, "account listing");
}

/**
 * List every Auth account, masked. Throws rather than returning a partial
 * list: the caller treats "not in this list" as "has no account", so a short
 * list must never look like a complete one.
 *
 * @param {object} deps { fetch, getToken, projectId, [apiBase] }
 * @returns {Promise<Array>} normalised accounts, one per uid
 */
async function listAccounts(deps) {
  const root = requireDeps(deps);

  /* THE CANARY. One account, checked exactly as every later one is. If the
     mask is being ignored this throws here, with one record received rather
     than a thousand. Its page token is discarded: the listing below starts
     again from the beginning. */
  for (const raw of (await fetchPage(deps, root, 1, "")).users || []) normaliseAccount(raw);

  const byUid = new Map();
  const unkeyed = [];
  const seenTokens = new Set();
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(deps, root, PAGE_SIZE, pageToken);
    for (const raw of body.users || []) {
      const acct = normaliseAccount(raw);
      if (!acct.uid) unkeyed.push(acct);
      else byUid.set(acct.uid, byUid.has(acct.uid) ? mergeAccounts(byUid.get(acct.uid), acct) : acct);
    }
    if (!body.nextPageToken) return [...byUid.values()].concat(unkeyed);
    if (typeof body.nextPageToken !== "string" || seenTokens.has(body.nextPageToken)) {
      throw new Error("account listing returned an unusable or repeated page token");
    }
    seenTokens.add(body.nextPageToken);
    pageToken = body.nextPageToken;
  }
  throw new Error("account listing did not finish within " + MAX_PAGES + " pages");
}

/**
 * Fetch specific accounts again, by uid — the re-check made immediately before
 * anything is deleted. Same mask, same verification, a different endpoint, so
 * it is also a second opinion on what the listing said.
 *
 * A uid the API does not return no longer has an account; it is simply absent
 * from the result. Any failure throws: a re-check that cannot be made must not
 * be read as "nothing changed".
 *
 * @param {object} deps { fetch, getToken, projectId, [apiBase] }
 * @param {string[]} uids
 * @returns {Promise<Array>} normalised accounts
 */
async function lookupAccounts(deps, uids) {
  const root = requireDeps(deps);
  const out = [];
  for (let i = 0; i < uids.length; i += LOOKUP_BATCH) {
    const res = await send(deps,
      root + "/accounts:lookup?fields=" + encodeURIComponent(USER_MASK), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localId: uids.slice(i, i + LOOKUP_BATCH) })
      });
    if (!res.ok) throw new Error("account re-check failed: HTTP " + res.status);
    for (const raw of (await readBody(res, "account re-check")).users || []) {
      out.push(normaliseAccount(raw));
    }
  }
  return out;
}

/**
 * Delete accounts by uid.
 *
 * `force: true` is what the API requires to delete an account that is not
 * disabled; without it every deletion is refused.
 *
 * @param {object} deps { fetch, getToken, projectId, [apiBase], [sleep] }
 * @param {string[]} uids
 * @returns {Promise<{deleted:number, failed:number, httpStatuses:number[],
 *                    networkErrors:number}>}
 *   counts and the distinct non-2xx statuses, never a uid. A failed uid is
 *   retried by the next run, which rediscovers it from the listing.
 */
async function deleteAccounts(deps, uids) {
  const root = requireDeps(deps);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const httpStatuses = new Set();
  let deleted = 0, failed = 0, networkErrors = 0;

  for (let i = 0; i < uids.length; i += DELETE_BATCH) {
    const chunk = uids.slice(i, i + DELETE_BATCH);
    /* batchDelete is limited to one request a second per project. */
    if (i > 0) await sleep(1100);
    let res, text;
    try {
      res = await send(deps, root + "/accounts:batchDelete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localIds: chunk, force: true })
      });
      text = res.ok ? await res.text() : "";
    } catch {
      /* A timeout or a dropped connection. The records are already gone by
         now, so this must be counted, not thrown: the remaining chunks still
         deserve their attempt and the caller exits non-zero either way. */
      networkErrors++;
      failed += chunk.length;
      continue;
    }
    if (!res.ok) {
      httpStatuses.add(res.status);
      failed += chunk.length;
      continue;
    }
    /* A 200 carries per-uid failures in `errors`; an empty body means none. */
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
  return {
    deleted, failed, networkErrors,
    httpStatuses: [...httpStatuses].sort((a, b) => a - b)
  };
}

module.exports = {
  listAccounts, lookupAccounts, deleteAccounts, normaliseAccount, mergeAccounts,
  msFromEpochString, msFromRfc3339,
  FIELD_MASK, USER_MASK, ACCOUNT_KEYS, PROVIDER_KEYS,
  PAGE_SIZE, DELETE_BATCH, LOOKUP_BATCH, REQUEST_TIMEOUT_MS
};
