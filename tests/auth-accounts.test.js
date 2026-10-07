"use strict";
/* tests/auth-accounts.test.js
 *
 * scripts/lib/auth-accounts.js lists Firebase Auth accounts for the retention
 * job (issue #347) WITHOUT receiving an e-mail address. The Admin SDK's
 * listUsers() returns whole user records, and the job runs on a GitHub runner
 * in the United States — so the listing asks Google for a partial response and
 * then VERIFIES it got one.
 *
 * That verification is the property worth testing hardest. A mask the server
 * silently ignored would look exactly like one it honoured, every night, with
 * every signed-in user's address crossing the border to answer a yes/no
 * question. So: a single unrequested key must stop the run.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  listAccounts, deleteAccounts, normaliseAccount, msFromEpochString, msFromRfc3339,
  FIELD_MASK, ACCOUNT_KEYS, PROVIDER_KEYS, DELETE_BATCH
} = require("../scripts/lib/auth-accounts");

const PROJECT = "canamed-test";

/** A fetch that replays queued responses and records every request. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init) => {
    calls.push({ url, init: init || {} });
    const r = queue.shift();
    if (!r) throw new Error("fakeFetch: no response queued for " + url);
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
      text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.body === undefined ? {} : r.body))
    };
  };
  fn.calls = calls;
  return fn;
}

const deps = (fetch, extra) => Object.assign(
  { fetch, getToken: async () => "tok", projectId: PROJECT }, extra || {});

const anon = (id, extra) => Object.assign({ localId: id, createdAt: "1750000000000" }, extra || {});

// ── the mask ────────────────────────────────────────────────────────────────

test("the mask names identifiers and dates, and nothing that identifies a person", () => {
  for (const banned of ["email", "displayName", "photoUrl", "phoneNumber", "passwordHash",
                        "salt", "federatedId", "rawId", "screenName", "customAttributes"]) {
    assert.ok(!FIELD_MASK.includes(banned), "the mask must not request " + banned);
    assert.ok(!ACCOUNT_KEYS.includes(banned) && !PROVIDER_KEYS.includes(banned));
  }
  // providers are requested by NAME only — "google.com", not the address behind it
  assert.match(FIELD_MASK, /providerUserInfo\(providerId\)/);
  assert.deepStrictEqual(PROVIDER_KEYS, ["providerId"]);
});

test("the mask is actually sent, on every page", async () => {
  const fetch = fakeFetch([
    { body: { users: [anon("a")], nextPageToken: "p2" } },
    { body: { users: [anon("b")] } }
  ]);
  await listAccounts(deps(fetch));
  assert.strictEqual(fetch.calls.length, 2);
  for (const c of fetch.calls) {
    const u = new URL(c.url);
    assert.strictEqual(u.searchParams.get("fields"), FIELD_MASK);
    assert.strictEqual(u.pathname, "/v1/projects/" + PROJECT + "/accounts:batchGet");
    assert.strictEqual(c.init.headers.Authorization, "Bearer tok");
  }
  assert.strictEqual(new URL(fetch.calls[1].url).searchParams.get("nextPageToken"), "p2");
});

test("an e-mail address in the response STOPS the run — and is not echoed", async () => {
  const fetch = fakeFetch([{
    body: { users: [anon("a"), { localId: "b", email: "someone@example.test", createdAt: "1" }] }
  }]);
  await assert.rejects(listAccounts(deps(fetch)), (e) => {
    assert.match(e.message, /mask was NOT honoured/);
    assert.match(e.message, /\[email\]/, "the offending KEY is named");
    assert.ok(!e.message.includes("someone@example.test"), "its VALUE must never be");
    return true;
  });
});

test("any unrequested key trips it, not only the obvious ones", () => {
  for (const key of ["displayName", "photoUrl", "phoneNumber", "passwordHash", "disabled",
                     "emailVerified", "validSince", "customAttributes", "somethingNew"]) {
    assert.throws(() => normaliseAccount({ localId: "x", [key]: "v" }), /mask was NOT honoured/, key);
  }
});

test("the provider entries are checked too — that is where a Google address lives", () => {
  assert.throws(
    () => normaliseAccount({
      localId: "x",
      providerUserInfo: [{ providerId: "google.com", email: "a@example.test", rawId: "123" }]
    }),
    (e) => /provider entry/.test(e.message) && /email, rawId/.test(e.message) &&
           !e.message.includes("a@example.test"));
});

// ── normalisation ───────────────────────────────────────────────────────────

test("anonymous means NO provider; any provider at all means signed-in", () => {
  assert.deepStrictEqual(normaliseAccount(anon("a")).providers, []);
  assert.deepStrictEqual(normaliseAccount(anon("a", { providerUserInfo: [] })).providers, []);
  assert.deepStrictEqual(
    normaliseAccount(anon("g", { providerUserInfo: [{ providerId: "google.com" }] })).providers,
    ["google.com"]);
  assert.deepStrictEqual(
    normaliseAccount(anon("p", { providerUserInfo: [{ providerId: "password" }] })).providers,
    ["password"]);
});

test("a provider entry with no usable id still counts as a provider", () => {
  /* The safe direction: it keeps the account OUT of the anonymous set. Reading
     it as "no provider" would make a signed-in account deletable. */
  for (const entry of [{}, { providerId: "" }, { providerId: 7 }]) {
    assert.deepStrictEqual(
      normaliseAccount(anon("x", { providerUserInfo: [entry] })).providers, ["unknown"]);
  }
});

test("dates: epoch-millisecond strings and RFC 3339, nothing else", () => {
  assert.strictEqual(msFromEpochString("1750000000000"), 1750000000000);
  for (const bad of ["", "0", "-5", "1.5", "abc", "12345678901234567", 1750000000000, null, undefined]) {
    assert.strictEqual(msFromEpochString(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(msFromRfc3339("2026-08-25T02:35:09.123Z"), Date.UTC(2026, 7, 25, 2, 35, 9, 123));
  for (const bad of ["", "yesterday", "1750000000000", "2026-13-45Tgarbage", 5, null, undefined]) {
    assert.strictEqual(msFromRfc3339(bad), null, JSON.stringify(bad));
  }
  const a = normaliseAccount(anon("a", {
    lastLoginAt: "1750000001000", lastRefreshAt: "2026-08-25T00:00:00Z"
  }));
  assert.deepStrictEqual(
    [a.createdMs, a.lastLoginMs, a.lastRefreshMs],
    [1750000000000, 1750000001000, Date.UTC(2026, 7, 25)]);
});

// ── a short list must never look complete ───────────────────────────────────

test("listing: an HTTP error throws, with the status and nothing else", async () => {
  const fetch = fakeFetch([{ status: 403, body: { error: { message: "secret detail" } } }]);
  await assert.rejects(listAccounts(deps(fetch)), (e) =>
    /HTTP 403/.test(e.message) && !e.message.includes("secret detail"));
});

test("listing: a failure on a LATER page discards the pages already read", async () => {
  /* The caller reads "absent from the list" as "has no account". Returning
     page one after page two failed would turn every account on page two into
     an apparent orphan. */
  const fetch = fakeFetch([
    { body: { users: [anon("a")], nextPageToken: "p2" } },
    { status: 500, body: {} }
  ]);
  await assert.rejects(listAccounts(deps(fetch)), /HTTP 500/);
});

test("listing: a repeated page token is an error, not an endless loop", async () => {
  const fetch = fakeFetch([
    { body: { users: [anon("a")], nextPageToken: "same" } },
    { body: { users: [anon("b")], nextPageToken: "same" } }
  ]);
  await assert.rejects(listAccounts(deps(fetch)), /repeated page token/);
});

test("listing: malformed pages throw rather than being read as empty", async () => {
  for (const body of [null, [], "x", { users: "nope" }, { users: [null] }, { users: [[]] }]) {
    await assert.rejects(listAccounts(deps(fakeFetch([{ body }]))), Error, JSON.stringify(body));
  }
});

test("listing: an empty project is an empty list (the caller decides what that means)", async () => {
  assert.deepStrictEqual(await listAccounts(deps(fakeFetch([{ body: {} }]))), []);
});

test("both calls refuse to run without a plain project id", async () => {
  for (const projectId of [undefined, "", "a/b", "../x", "UPPER", "has space"]) {
    const d = { fetch: fakeFetch([]), getToken: async () => "t", projectId };
    await assert.rejects(listAccounts(d), /projectId/);
    await assert.rejects(deleteAccounts(d, ["u"]), /projectId/);
  }
});

// ── deletion ────────────────────────────────────────────────────────────────

test("delete: one POST per 1000 uids, with force, never faster than 1/s", async () => {
  const uids = Array.from({ length: DELETE_BATCH + 3 }, (_, i) => "u" + i);
  const fetch = fakeFetch([{ body: {} }, { body: {} }]);
  const sleeps = [];
  const res = await deleteAccounts(deps(fetch, { sleep: async (ms) => { sleeps.push(ms); } }), uids);

  assert.deepStrictEqual(res, { deleted: uids.length, failed: 0, httpStatuses: [] });
  assert.strictEqual(fetch.calls.length, 2);
  assert.strictEqual(new URL(fetch.calls[0].url).pathname,
    "/v1/projects/" + PROJECT + "/accounts:batchDelete");
  const first = JSON.parse(fetch.calls[0].init.body);
  assert.strictEqual(first.force, true, "without force the API refuses every deletion");
  assert.strictEqual(first.localIds.length, DELETE_BATCH);
  assert.strictEqual(JSON.parse(fetch.calls[1].init.body).localIds.length, 3);
  assert.deepStrictEqual(sleeps.length, 1, "one pause between two batches");
  assert.ok(sleeps[0] >= 1000);
});

test("delete: per-uid errors in a 200 are counted as failures, not successes", async () => {
  const fetch = fakeFetch([{
    body: { errors: [{ index: 1, localId: "b", message: "x" }] }
  }]);
  const res = await deleteAccounts(deps(fetch), ["a", "b", "c"]);
  assert.deepStrictEqual(res, { deleted: 2, failed: 1, httpStatuses: [] });
});

test("delete: a refused batch fails whole, reports its status, and the rest still runs", async () => {
  const uids = Array.from({ length: DELETE_BATCH + 2 }, (_, i) => "u" + i);
  const fetch = fakeFetch([{ status: 429, body: {} }, { body: {} }]);
  const res = await deleteAccounts(deps(fetch, { sleep: async () => {} }), uids);
  assert.deepStrictEqual(res, { deleted: 2, failed: DELETE_BATCH, httpStatuses: [429] });
});

test("delete: an unreadable 200 claims nothing", async () => {
  /* The request may have partly applied. Counting it as deleted would report
     success nobody confirmed; the next run rediscovers whatever survived. */
  const fetch = fakeFetch([{ text: "<html>gateway</html>" }]);
  const res = await deleteAccounts(deps(fetch), ["a", "b"]);
  assert.deepStrictEqual(res, { deleted: 0, failed: 2, httpStatuses: [200] });
});

test("delete: an empty 200 body is a clean success", async () => {
  const res = await deleteAccounts(deps(fakeFetch([{ text: "" }])), ["a"]);
  assert.deepStrictEqual(res, { deleted: 1, failed: 0, httpStatuses: [] });
});

test("delete: nothing to delete makes no request", async () => {
  const fetch = fakeFetch([]);
  assert.deepStrictEqual(await deleteAccounts(deps(fetch), []),
    { deleted: 0, failed: 0, httpStatuses: [] });
  assert.strictEqual(fetch.calls.length, 0);
});
