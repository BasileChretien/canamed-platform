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
 * question. So: a single unrequested key must stop the run, and it must stop
 * it on a ONE-account canary rather than a thousand-account page.
 *
 * The second thing tested hard is what an unreadable DATE turns into, because
 * the dates decide who is deleted.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  listAccounts, lookupAccounts, deleteAccounts, normaliseAccount, mergeAccounts,
  msFromEpochString, msFromRfc3339,
  FIELD_MASK, USER_MASK, ACCOUNT_KEYS, PROVIDER_KEYS, DELETE_BATCH, LOOKUP_BATCH
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
    if (r.throws) throw new Error(r.throws);
    const status = r.status || 200;
    const text = r.text !== undefined ? r.text : JSON.stringify(r.body === undefined ? {} : r.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text
    };
  };
  fn.calls = calls;
  return fn;
}

const deps = (fetch, extra) => Object.assign(
  { fetch, getToken: async () => "tok", projectId: PROJECT }, extra || {});

const anon = (id, extra) => Object.assign(
  { localId: id, createdAt: "1750000000000", lastRefreshAt: "2026-06-15T15:06:40Z" }, extra || {});
/** The canary answer every well-behaved listing starts with. */
const CANARY = { body: { users: [anon("canary")], nextPageToken: "ignored" } };

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
  assert.ok(FIELD_MASK.endsWith(USER_MASK), "the listing and the re-check ask for the same fields");
});

test("the mask is sent on EVERY request: the canary and each page", async () => {
  const fetch = fakeFetch([
    CANARY,
    { body: { users: [anon("a")], nextPageToken: "p2" } },
    { body: { users: [anon("b")] } }
  ]);
  const got = await listAccounts(deps(fetch));
  assert.deepStrictEqual(got.map((a) => a.uid), ["a", "b"]);
  assert.strictEqual(fetch.calls.length, 3);
  for (const c of fetch.calls) {
    const u = new URL(c.url);
    assert.strictEqual(u.searchParams.get("fields"), FIELD_MASK);
    assert.strictEqual(u.pathname, "/v1/projects/" + PROJECT + "/accounts:batchGet");
    assert.strictEqual(c.init.headers.Authorization, "Bearer tok");
    assert.ok(c.init.signal, "every request carries a timeout");
  }
  assert.strictEqual(new URL(fetch.calls[2].url).searchParams.get("nextPageToken"), "p2");
});

test("the CANARY asks for one account, and the real listing starts from the beginning", async () => {
  const fetch = fakeFetch([CANARY, { body: { users: [anon("a")] } }]);
  await listAccounts(deps(fetch));
  const canary = new URL(fetch.calls[0].url), first = new URL(fetch.calls[1].url);
  assert.strictEqual(canary.searchParams.get("maxResults"), "1");
  assert.strictEqual(first.searchParams.get("maxResults"), "1000");
  assert.strictEqual(first.searchParams.get("nextPageToken"), null,
    "the canary's page token must be discarded, or its account would be skipped");
});

test("an ignored mask is caught ON THE CANARY — one record received, not a thousand", async () => {
  /* The check cannot prevent a transfer, only detect one. The canary is what
     bounds how much an ignored mask can bring across before the job stops. */
  const fetch = fakeFetch([
    { body: { users: [{ localId: "b", email: "someone@example.test", createdAt: "1" }] } },
    { body: { users: [anon("never-requested")] } }
  ]);
  await assert.rejects(listAccounts(deps(fetch)), (e) => {
    assert.match(e.message, /mask was NOT honoured/);
    assert.match(e.message, /\[email\]/, "the offending KEY is named");
    assert.ok(!e.message.includes("someone@example.test"), "its VALUE must never be");
    return true;
  });
  assert.strictEqual(fetch.calls.length, 1, "no full page may be requested after a failed canary");
});

test("the check runs on every later account too, not only the canary", async () => {
  const fetch = fakeFetch([CANARY, {
    body: { users: [anon("a"), { localId: "b", displayName: "A Person" }] }
  }]);
  await assert.rejects(listAccounts(deps(fetch)), /\[displayName\]/);
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

test("date parsers: epoch-millisecond strings and RFC 3339, nothing else", () => {
  assert.strictEqual(msFromEpochString("1750000000000"), 1750000000000);
  for (const bad of ["", "0", "-5", "1.5", "abc", "12345678901234567", 1750000000000, null, undefined]) {
    assert.strictEqual(msFromEpochString(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(msFromRfc3339("2026-08-25T02:35:09.123Z"), Date.UTC(2026, 7, 25, 2, 35, 9, 123));
  for (const bad of ["", "yesterday", "1750000000000", "2026-13-45Tgarbage", 5, null, undefined]) {
    assert.strictEqual(msFromRfc3339(bad), null, JSON.stringify(bad));
  }
});

test("dates: read into milliseconds, with no fault when all are well-formed", () => {
  const a = normaliseAccount(anon("a", {
    lastLoginAt: "1750000001000", lastRefreshAt: "2026-08-25T00:00:00Z"
  }));
  assert.deepStrictEqual(
    [a.createdMs, a.lastLoginMs, a.lastRefreshMs, a.dateFault],
    [1750000000000, 1750000001000, Date.UTC(2026, 7, 25), false]);
});

test("an ABSENT date is null without a fault; a PRESENT but unreadable one is a FAULT", () => {
  /* The difference decides a deletion. A returning participant's sign-in date
     never moves, so the last-refresh date is the only sign they are still
     here. If a garbled one were read as "no date", the old sign-in date would
     speak for the account and someone active yesterday would expire. */
  const absent = normaliseAccount({ localId: "a", createdAt: "1750000000000" });
  assert.deepStrictEqual([absent.lastRefreshMs, absent.dateFault], [null, false]);

  for (const garbled of [1750000000000, "1750000000000", "2026-10-05t10:00:00z", {}, "garbage", null, ""]) {
    const a = normaliseAccount({ localId: "a", createdAt: "1750000000000", lastRefreshAt: garbled });
    assert.strictEqual(a.lastRefreshMs, null);
    assert.strictEqual(a.dateFault, true, "garbled lastRefreshAt " + JSON.stringify(garbled));
  }
  assert.strictEqual(normaliseAccount({ localId: "a", lastLoginAt: 1750000000000 }).dateFault, true);
  assert.strictEqual(normaliseAccount({ localId: "a", createdAt: "soon" }).dateFault, true);
});

test("the same uid twice is merged in the direction that deletes LESS", () => {
  const old = { uid: "u", createdMs: 10, lastLoginMs: 10, lastRefreshMs: 10, dateFault: false, providers: [] };
  const newer = { uid: "u", createdMs: 10, lastLoginMs: null, lastRefreshMs: 99, dateFault: true,
                  providers: ["google.com"] };
  assert.deepStrictEqual(mergeAccounts(old, newer), {
    uid: "u", createdMs: 10, lastLoginMs: 10, lastRefreshMs: 99, dateFault: true,
    providers: ["google.com"]
  });
});

test("listing: a uid repeated across pages comes back once, merged", async () => {
  const fetch = fakeFetch([
    CANARY,
    { body: { users: [anon("dup")], nextPageToken: "p2" } },
    { body: { users: [anon("dup", { providerUserInfo: [{ providerId: "password" }] }), anon("b")] } }
  ]);
  const got = await listAccounts(deps(fetch));
  assert.deepStrictEqual(got.map((a) => a.uid), ["dup", "b"]);
  assert.deepStrictEqual(got[0].providers, ["password"],
    "a provider seen on either copy must survive the merge");
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
    CANARY,
    { body: { users: [anon("a")], nextPageToken: "p2" } },
    { status: 500, body: {} }
  ]);
  await assert.rejects(listAccounts(deps(fetch)), /HTTP 500/);
});

test("listing: a repeated page token is an error, not an endless loop", async () => {
  const fetch = fakeFetch([
    CANARY,
    { body: { users: [anon("a")], nextPageToken: "same" } },
    { body: { users: [anon("b")], nextPageToken: "same" } }
  ]);
  await assert.rejects(listAccounts(deps(fetch)), /repeated page token/);
});

test("listing: malformed pages throw rather than being read as empty", async () => {
  for (const body of [null, [], "x", { users: "nope" }, { users: [null] }, { users: [[]] }]) {
    await assert.rejects(listAccounts(deps(fakeFetch([{ body }, { body }]))), Error, JSON.stringify(body));
  }
});

test("listing: an unreadable body is reported by status — the body is never quoted", async () => {
  /* A JSON parse error quotes the text it choked on, and that text is a
     response that may hold account data. */
  const fetch = fakeFetch([{ text: "<html>someone@example.test</html>" }]);
  await assert.rejects(listAccounts(deps(fetch)), (e) =>
    /unreadable body: HTTP 200/.test(e.message) && !e.message.includes("someone@example.test"));
});

test("listing: an empty project is an empty list (the caller decides what that means)", async () => {
  assert.deepStrictEqual(await listAccounts(deps(fakeFetch([{ body: {} }, { body: {} }]))), []);
});

test("every call refuses to run without a plain project id", async () => {
  for (const projectId of [undefined, "", "a/b", "../x", "UPPER", "has space"]) {
    const d = { fetch: fakeFetch([]), getToken: async () => "t", projectId };
    await assert.rejects(listAccounts(d), /projectId/);
    await assert.rejects(lookupAccounts(d, ["u"]), /projectId/);
    await assert.rejects(deleteAccounts(d, ["u"]), /projectId/);
  }
});

// ── the re-check ────────────────────────────────────────────────────────────

test("lookup: asks for the named uids, masked, a hundred at a time", async () => {
  const uids = Array.from({ length: LOOKUP_BATCH + 2 }, (_, i) => "u" + i);
  const fetch = fakeFetch([
    { body: { users: [anon("u0"), anon("u1")] } },
    { body: { users: [anon("u100")] } }
  ]);
  const got = await lookupAccounts(deps(fetch), uids);
  assert.deepStrictEqual(got.map((a) => a.uid), ["u0", "u1", "u100"]);
  assert.strictEqual(fetch.calls.length, 2);
  const u = new URL(fetch.calls[0].url);
  assert.strictEqual(u.pathname, "/v1/projects/" + PROJECT + "/accounts:lookup");
  assert.strictEqual(u.searchParams.get("fields"), USER_MASK);
  assert.strictEqual(fetch.calls[0].init.method, "POST");
  assert.strictEqual(JSON.parse(fetch.calls[0].init.body).localId.length, LOOKUP_BATCH);
  assert.deepStrictEqual(JSON.parse(fetch.calls[1].init.body).localId, ["u100", "u101"]);
});

test("lookup: a uid the API does not return is simply absent — it has no account", async () => {
  const got = await lookupAccounts(deps(fakeFetch([{ body: {} }])), ["gone"]);
  assert.deepStrictEqual(got, []);
});

test("lookup: any failure THROWS — a re-check that could not be made did not pass", async () => {
  await assert.rejects(lookupAccounts(deps(fakeFetch([{ status: 503 }])), ["u"]), /re-check failed: HTTP 503/);
  await assert.rejects(lookupAccounts(deps(fakeFetch([{ text: "<html>" }])), ["u"]), /unreadable body/);
  await assert.rejects(lookupAccounts(deps(fakeFetch([{ body: { users: "x" } }])), ["u"]), /non-array/);
});

test("lookup: the mask is verified here too", async () => {
  const fetch = fakeFetch([{ body: { users: [{ localId: "u", email: "a@example.test" }] } }]);
  await assert.rejects(lookupAccounts(deps(fetch), ["u"]), /mask was NOT honoured/);
});

test("lookup: nothing to check makes no request", async () => {
  const fetch = fakeFetch([]);
  assert.deepStrictEqual(await lookupAccounts(deps(fetch), []), []);
  assert.strictEqual(fetch.calls.length, 0);
});

// ── deletion ────────────────────────────────────────────────────────────────

const CLEAN = { failed: 0, httpStatuses: [], networkErrors: 0 };

test("delete: one POST per 1000 uids, with force, never faster than 1/s", async () => {
  const uids = Array.from({ length: DELETE_BATCH + 3 }, (_, i) => "u" + i);
  const fetch = fakeFetch([{ body: {} }, { body: {} }]);
  const sleeps = [];
  const res = await deleteAccounts(deps(fetch, { sleep: async (ms) => { sleeps.push(ms); } }), uids);

  assert.deepStrictEqual(res, Object.assign({ deleted: uids.length }, CLEAN));
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
  assert.deepStrictEqual(res, Object.assign({}, CLEAN, { deleted: 2, failed: 1 }));
});

test("delete: a refused batch fails whole, reports its status, and the rest still runs", async () => {
  const uids = Array.from({ length: DELETE_BATCH + 2 }, (_, i) => "u" + i);
  const fetch = fakeFetch([{ status: 429, body: {} }, { body: {} }]);
  const res = await deleteAccounts(deps(fetch, { sleep: async () => {} }), uids);
  assert.deepStrictEqual(res,
    { deleted: 2, failed: DELETE_BATCH, httpStatuses: [429], networkErrors: 0 });
});

test("delete: a request that never completes is COUNTED, and the rest still runs", async () => {
  /* By this point the records are already gone, so a timeout must not throw
     the whole run away: the remaining batches deserve their attempt, and the
     failure has to reach the exit code as a number rather than a crash. */
  const uids = Array.from({ length: DELETE_BATCH + 1 }, (_, i) => "u" + i);
  const fetch = fakeFetch([{ throws: "The operation was aborted due to timeout" }, { body: {} }]);
  const res = await deleteAccounts(deps(fetch, { sleep: async () => {} }), uids);
  assert.deepStrictEqual(res,
    { deleted: 1, failed: DELETE_BATCH, httpStatuses: [], networkErrors: 1 });
});

test("delete: an unreadable 200 claims nothing", async () => {
  /* The request may have partly applied. Counting it as deleted would report
     success nobody confirmed; the next run rediscovers whatever survived. */
  const fetch = fakeFetch([{ text: "<html>gateway</html>" }]);
  const res = await deleteAccounts(deps(fetch), ["a", "b"]);
  assert.deepStrictEqual(res, { deleted: 0, failed: 2, httpStatuses: [200], networkErrors: 0 });
});

test("delete: an empty 200 body is a clean success", async () => {
  const res = await deleteAccounts(deps(fakeFetch([{ text: "" }])), ["a"]);
  assert.deepStrictEqual(res, Object.assign({ deleted: 1 }, CLEAN));
});

test("delete: nothing to delete makes no request", async () => {
  const fetch = fakeFetch([]);
  assert.deepStrictEqual(await deleteAccounts(deps(fetch), []), Object.assign({ deleted: 0 }, CLEAN));
  assert.strictEqual(fetch.calls.length, 0);
});
