/* handler.js — the hfPatient LLM proxy, off Google's platform.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 * Firebase Cloud Functions v2 run on Cloud Run, which requires a Blaze
 * (billing) plan. The project's billing trial closed on 2026-08-27 and was
 * deliberately not renewed, so `hfPatient` cannot start at all and Module A's
 * chat degrades — silently — to the stub patient on every turn. This is the
 * same feature, hosted somewhere that is free.
 *
 * ⚠ PORT, NOT REWRITE. Every security control the callable carried is
 * reproduced here, because dropping any of them turns this into an open relay
 * for the HF token — a spendable credential. The pure logic is IMPORTED from
 * functions/lib/hf-helpers.js rather than copied, so the server-authoritative
 * system guard, the HF_URL allowlist, message validation and the roomOf claim
 * comparison cannot drift between the two deployments. tests/llm-proxy.test.js
 * fails if this file re-declares any of them.
 *
 *   callable gave us                    here it is
 *   ─────────────────────────────────   ────────────────────────────────────
 *   request.auth.uid (SDK-verified)     verifyFirebaseIdToken() — Web Crypto
 *   _verifyMembership via admin SDK     RTDB REST read, authorised by the
 *                                       CALLER'S OWN token (see below)
 *   RTDB counters via admin SDK         injected KV store; REQUIRED, fails
 *                                       closed when absent
 *   HF_TOKEN in Secret Manager          host secret store, never in source
 *   App Check                           NOT AVAILABLE off Google — see README
 *
 * ── THE MEMBERSHIP READ IS DONE WITH THE CALLER'S TOKEN, ON PURPOSE ──────
 * The callable read `roomOf/<uid>` with admin credentials. Reproducing that
 * would mean putting a Google SERVICE ACCOUNT KEY on a third-party host — a
 * full-database credential, far more dangerous than the HF token it is
 * protecting, and a much worse thing to leak. Instead the proxy reads the
 * claim over RTDB REST using the caller's own ID token.
 *
 * That is not weaker for THIS check, and the reason is worth stating: the
 * value still comes from the DATABASE, never from the request body, so a
 * client cannot assert its way into another room. The rules let a participant
 * read their own claim, and the proxy compares the room the DATABASE returns
 * against the room the caller claims. A caller who forges the body fails the
 * comparison; a caller with no claim gets no room. What the caller's token
 * cannot do is read someone ELSE's claim — which this check never needs.
 */

import helpers from "../../docs/Third_session/PBL_platform/functions/lib/hf-helpers.js";
import { verifyFirebaseIdToken } from "./firebase-jwt.js";
import { rtdbStore } from "./stores.js";

const {
  isAllowedHfUrl, validateMessages, buildMessages, normLang,
  dayKey, roomClaimPath, roomClaimMatches, applyProviderPin, stripReasoning
} = helpers;

/* Kept in lockstep with functions/index.js — a divergence here would silently
 * change the cost ceiling or the persona's behaviour on one deployment only.
 * tests/llm-proxy.test.js pins these against the function's own source. */
export const LIMITS = {
  MAX_REPLY_CHARS: 600,
  RATE_LIMIT_TURNS: 40,              // per uid, per hour
  RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
  SESSION_RATE_LIMIT_TURNS: 250,     // per session, per hour
  RATE_LIMIT_DAILY_TURNS: 200        // per uid, per UTC day
};

/* ⚠ THE GLOBAL DAILY CAP IS NOT ENFORCED HERE — IT MOVED TO HUGGING FACE.
 *
 * The callable held a cross-user counter (HF_GLOBAL_DAILY_CAP, 4000/day) as a
 * ceiling on the inference bill. It could do that because the admin SDK gave
 * it a store NO CLIENT could write. The proxy has no such store, and that is
 * not an oversight to route around:
 *
 *   - Its counters live in RTDB, written with the CALLER'S OWN token. A
 *     shared, client-writable counter is forgeable UPWARD, so any participant
 *     could push it past the cap and switch the chat off for the whole
 *     platform for the rest of the day — trading a cost control for a
 *     one-caller denial of service. (The per-uid counters do not have this
 *     problem: inflating your own only restricts you.)
 *   - A store only the proxy can write means a proxy-held secret with write
 *     access to the database — i.e. a Google service-account key on a
 *     third-party host, which is the thing handler.js's header refuses to do.
 *
 * So the ceiling moved to the layer that can actually enforce it: the
 * SPEND LIMIT ON THE HUGGING FACE ACCOUNT. That is a hard cap set by the
 * party doing the billing, it cannot be forged by a participant, and it
 * bounds the real quantity (money) rather than a proxy for it (turns).
 *
 * ⚠ IT IS THEREFORE A REQUIRED SETUP STEP, not an optional hardening — see
 * proxy/README.md. Skip it and there is no cost ceiling at all: the per-uid
 * limits still bound one participant to 200 turns/day, but nothing bounds
 * 30 participants x N sessions.
 *
 * The per-uid and per-session limits below are unchanged and still enforced. */

const HF_DEFAULT_URL = "https://router.huggingface.co/v1/chat/completions";
/* Llama-3.3-70B-Instruct, NOT the callable's Qwen/Qwen3.5-9B.
 *
 * Qwen3.5-9B is a HYBRID-REASONING model, and OVHcloud — the EEA-pinned
 * provider — rejects the only field that switches reasoning off
 * (chat_template_kwargs, HTTP 400). Qwen's in-prompt `/no_think` did not
 * suppress it either. Left reasoning, it spent its whole token budget
 * thinking and returned nothing visible: ~28s per turn and an empty reply,
 * which every room saw as the stub patient.
 *
 * Llama-3.3-70B-Instruct is the only NON-reasoning instruct model OVHcloud
 * serves, so it is the one choice that satisfies both "no reasoning" and the
 * EEA residency pin. Verified live from a real room on 2026-09-01: coherent
 * in-character replies in ~8s (EN) and ~6s (JA), `provider: "ovhcloud"`
 * echoed back, and a novel unscripted question answered — which no canned
 * stub could do.
 *
 * ⚠ Its Japanese is unofficial (Meta lists 8 languages, not JA) but tested
 * natural and idiomatic. Re-check if the JA cohort reports awkward phrasing.
 * ⚠ The model is NAMED in the DPA and the privacy notice — changing it again
 * means changing those too. */
const HF_DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
const HF_DEFAULT_PROVIDER = "ovhcloud";
/* 45s, up from the callable's 25s. Measured against the live deployment:
 * OVHcloud took 28s to return for this model, so 25s timed out every call.
 * 45s leaves headroom without letting a wedged request hold an instance for
 * long. If replies routinely approach this, the model is the problem, not the
 * budget. */
const TOTAL_BUDGET_MS = 45_000;

/* Mirrors the callable's PROMPT_VERSION so the two can be told apart in the
 * metrics, and so "which deployment answered this turn" is answerable. */
export const PROMPT_VERSION = "modA-llm@2.5-proxy";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

/* The callable protocol the client already speaks: errors come back as
 * { error: { message, status } }. Keeping the shape means the client's
 * existing error handling — and its stub fallback — works unchanged. */
function callableError(message, status, httpStatus) {
  return json({ error: { message, status } }, httpStatus);
}

/* CORS: the platform is served from a different origin to the proxy, so the
 * browser preflights. The allowlist is EXPLICIT — `*` would let any site on
 * the internet spend the HF budget using a victim's token. */
function corsHeaders(origin, allowed) {
  const ok = allowed.includes(origin);
  return ok
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        // Different origins get different bodies; without this a shared cache
        // could serve one origin's CORS headers to another.
        "Vary": "Origin"
      }
    : null;
}

function withHeaders(res, extra) {
  if (!extra) return res;
  const h = new Headers(res.headers);
  for (const k of Object.keys(extra)) h.set(k, extra[k]);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ── rate limiting ────────────────────────────────────────────────────────
 * The callable kept counters in RTDB via the admin SDK. The proxy has no
 * admin credentials (see the header), so it drives a store with what it does
 * hold — the caller's own token. stores.js has the backends.
 *
 * REQUIRED, not optional. Without a SHARED store each instance counts only
 * its own traffic, so the limits would silently become per-instance — the
 * kind of control that looks present and enforces nothing. An absent store
 * therefore refuses service rather than serving unmetered, mirroring
 * BACKUP_REQUIRE_GCS elsewhere in this repo.
 *
 * The counters are structured ({scope, id, bucket}) rather than flat keys
 * because rtdbStore has to turn them into PATHS whose ownership the database
 * rules can check; a flat "u:<uid>:<hour>" string cannot be authorised.
 *
 * The BUCKET is the window — an hour or a UTC day is baked into the key — so
 * a counter simply stops being consulted when its window passes. No sliding
 * window, no reset logic. See the global-cap note above LIMITS for what is
 * deliberately NOT enforced here. */

export async function checkRateLimits(store, uid, sessionCode, now, caps) {
  const c = caps || LIMITS;
  const hourBucket = "h" + Math.floor(now / c.RATE_LIMIT_WINDOW_MS);
  const day = "d" + dayKey(now);

  /* Counters are structured rather than flat strings so rtdbStore can turn
   * them into paths the database rules can authorise — see stores.js. */
  const perUidHour = await store.increment({ scope: "uid", id: uid, bucket: hourBucket }, 2 * 3600);
  if (perUidHour > c.RATE_LIMIT_TURNS) return { ok: false, scope: "uid-hourly" };

  const perUidDay = await store.increment({ scope: "uid", id: uid, bucket: day }, 2 * 24 * 3600);
  if (perUidDay > c.RATE_LIMIT_DAILY_TURNS) return { ok: false, scope: "uid-daily" };

  const perSession = await store.increment({ scope: "session", id: sessionCode, bucket: hourBucket }, 2 * 3600);
  if (perSession > c.SESSION_RATE_LIMIT_TURNS) return { ok: false, scope: "session-hourly" };

  return { ok: true };
}

/* ── membership ───────────────────────────────────────────────────────────
 * Same validation as the callable's _verifyMembership, including the room-id
 * rule that allows spaces: the platform's room keys are "Room 1", "Room 2",
 * and an over-strict regex here rejects every legitimate room and 403s the
 * whole feature (that bug has already been paid for once). */
export async function verifyMembership(idToken, body, env, deps) {
  const d = deps || {};
  const code = String((body && body.roomCode) || "").trim();
  const roomId = String((body && body.roomId) || "").trim();
  const orgSlug = body && body.orgSlug ? String(body.orgSlug).trim() : "";
  if (!code || !roomId) return null;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) return null;
  if (!/^[^.#$[\]/]{1,40}$/.test(roomId)) return null;
  if (orgSlug && !/^[A-Za-z0-9_-]{1,40}$/.test(orgSlug)) return null;

  if (!env.RTDB_URL) return null;   // misconfigured: deny, never default-allow
  const uid = d.uid;
  const path = roomClaimPath(code, orgSlug, uid);
  const url = `${env.RTDB_URL.replace(/\/$/, "")}/${path}.json?auth=${encodeURIComponent(idToken)}`;
  const res = await (d.fetch || fetch)(url);
  // A non-200 is a denial or an outage; either way it is NOT authorisation.
  if (!res.ok) return null;
  const claim = await res.json();
  return roomClaimMatches(claim, roomId) ? { code, roomId, orgSlug } : null;
}

function hfModel(env, lang) {
  const base = lang === "ja"
    ? (env.HF_MODEL_JA || env.HF_MODEL || HF_DEFAULT_MODEL)
    : (env.HF_MODEL || HF_DEFAULT_MODEL);
  /* A BLANK value counts as unset, NOT as an opt-out. applyProviderPin treats
   * "" as a deliberate opt-out and returns the UNPINNED model id — but hosts
   * routinely surface a declared-but-empty variable as "", and an empty field
   * in wrangler.toml or a dashboard is a typo, not a decision. Left as-is the
   * chat keeps answering normally while the recipient of participants'
   * clinical free text silently reverts to whatever the HF router picks per
   * request: exactly the varying, unnameable recipient the pin exists to
   * remove, and the DPA would then name a provider that is not receiving the
   * data. Only a genuinely ABSENT variable falls back to the default pin;
   * opting out has to be done in code, visibly. */
  const rawProvider = env.HF_PROVIDER;
  const provider = (rawProvider === undefined || String(rawProvider).trim() === "")
    ? HF_DEFAULT_PROVIDER
    : rawProvider;
  return applyProviderPin(base, provider);
}

/* Strip a leading "Name:" the model sometimes prefixes, then the reasoning
 * block Qwen3.x can still emit despite chat_template_kwargs, then cap length.
 * Order matters: stripReasoning must run before the length cap or a long
 * <think> block would consume the whole budget. */
export function sanitiseReply(raw, characterName) {
  let text = stripReasoning(String(raw == null ? "" : raw)).trim();
  if (characterName) {
    const re = helpers.buildRolePrefixRe(helpers.safeCharacterName(characterName));
    if (re) text = text.replace(re, "").trim();
  }
  if (text.length > LIMITS.MAX_REPLY_CHARS) {
    text = text.slice(0, LIMITS.MAX_REPLY_CHARS).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

export async function handleRequest(request, env, deps) {
  const d = deps || {};
  const now = d.now ? d.now() : Date.now();
  const doFetch = d.fetch || fetch;
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === "OPTIONS") {
    // A preflight from a disallowed origin gets no CORS headers, so the
    // browser blocks the real request. Answering 204 regardless keeps the
    // proxy from looking like an origin scanner.
    return withHeaders(new Response(null, { status: 204 }), cors);
  }
  if (request.method !== "POST") return callableError("method not allowed", "INVALID_ARGUMENT", 405);
  // Reject cross-origin callers BEFORE doing any work, including before token
  // verification — an unlisted origin must not be able to probe timing.
  if (origin && !cors) return callableError("origin not allowed", "PERMISSION_DENIED", 403);

  const reply = (body, status) => withHeaders(json(body, status), cors);
  const fail = (m, s, h) => withHeaders(callableError(m, s, h), cors);

  // 1) Approval gate — the panic button, mirroring MODA_LLM_ENABLED.
  if (String(env.MODA_LLM_ENABLED) !== "true") {
    return reply({ result: { reply: "", state: "disabled", error: "MODA_LLM_ENABLED is off" } });
  }

  /* 1b) Required configuration, checked UP FRONT.
   *
   * RTDB_URL is required UNCONDITIONALLY, not just when the default store is
   * in use. An earlier version only demanded it when no store was bound, but
   * verifyMembership ALWAYS reads the roomOf claim over RTDB — so binding a
   * KV store without RTDB_URL left every legitimate caller with a
   * "not a member of the claimed room" 403, which points the operator at the
   * wrong problem entirely.
   *
   * It must also be HTTPS. The RTDB REST calls carry the caller's Firebase ID
   * token as a QUERY PARAMETER (?auth=...), which is how that API takes
   * credentials; over plaintext that token is readable by anything on the
   * path, and it is the credential the whole membership check rests on. */
  const rtdbUrl = String(env.RTDB_URL || "");
  if (!rtdbUrl || !/^https:\/\//i.test(rtdbUrl)) {
    console.error("[hfPatient-proxy] RTDB_URL must be set and must be https");
    return reply({ result: { reply: "", state: "error", error: "proxy misconfigured" } }, 500);
  }
  if (!env.FIREBASE_PROJECT_ID) {
    console.error("[hfPatient-proxy] FIREBASE_PROJECT_ID is not configured — cannot verify tokens");
    return reply({ result: { reply: "", state: "error", error: "proxy misconfigured" } }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_e) {
    return fail("bad request body", "INVALID_ARGUMENT", 400);
  }
  // The client posts the callable envelope { data: {...} }; accept a bare
  // object too so the endpoint is usable with curl during setup.
  const body = (payload && payload.data) || payload || {};

  // 2) Auth. `auth required` is kept VERBATIM from the callable: the synthetic
  //    uptime probe asserts on that exact string, so changing it would break
  //    the health check silently.
  const authz = request.headers.get("Authorization") || "";
  const idToken = /^Bearer\s+(.+)$/i.test(authz) ? authz.replace(/^Bearer\s+/i, "").trim() : "";
  if (!idToken) return fail("auth required", "UNAUTHENTICATED", 401);

  let uid;
  /* Injectable so the handler's own logic is testable without minting real
   * RS256 tokens. The default is the real verifier — a test seam must never
   * be the thing that decides whether auth happens in production. */
  const verifyToken = d.verifyToken || verifyFirebaseIdToken;
  try {
    ({ uid } = await verifyToken(idToken, env.FIREBASE_PROJECT_ID, { fetch: doFetch, now: () => now }));
  } catch (_e) {
    // Never echo the verification error: it tells an attacker which check
    // they failed, which is a free oracle for forging tokens.
    return fail("auth required", "UNAUTHENTICATED", 401);
  }

  // 3) Input shape.
  const lang = normLang(body.lang);
  if (!validateMessages(body.messages)) return fail("bad messages", "INVALID_ARGUMENT", 400);
  let messages = buildMessages(body.messages);
  /* ── /no_think ────────────────────────────────────────────────────────
   * Qwen3.5 is a HYBRID-REASONING model. The callable suppressed the
   * reasoning pass with `chat_template_kwargs: { enable_thinking: false }`,
   * but OVHcloud REJECTS that field outright (HTTP 400 on every call —
   * measured on the live proxy), so it had to be removed.
   *
   * Without it the model reasons first, and at any sane token budget it
   * spends the WHOLE budget thinking and never reaches the answer:
   * stripReasoning then removes the unterminated <think> block and the
   * handler returns "empty reply" — which the room sees as the stub patient.
   * Measured: 900 tokens, 28 seconds, no visible reply.
   *
   * `/no_think` is Qwen's own in-prompt switch for the same thing. It travels
   * in the message body, so unlike chat_template_kwargs it works with any
   * provider that serves the model. stripReasoning stays as the backstop —
   * this suppresses the block, that removes it if one appears anyway. */
  messages = messages.map((m, i) =>
    i === 0 && m.role === "system"
      ? { role: "system", content: m.content + "\n\n/no_think" }
      : m);


  // 4) Room membership.
  const member = await verifyMembership(idToken, body, env, { fetch: doFetch, uid });
  if (!member) return fail("not a member of the claimed room", "PERMISSION_DENIED", 403);

  // 5) Per-caller rate limits. FAIL CLOSED when no store is bound.
  /* Default to RTDB, driven with the caller's own token. Nothing extra to
   * provision, no new sub-processor, and the increment-only rule makes it
   * atomic — see stores.js. A host with its own KV can inject one instead. */
  const store = d.store ||
    (env.RATE_STORE || (env.RTDB_URL ? rtdbStore(env.RTDB_URL, idToken, { fetch: doFetch }) : null));
  if (!store || typeof store.increment !== "function") {
    console.error("[hfPatient-proxy] no rate-limit store bound — refusing to serve unmetered");
    return reply({ result: { reply: "", state: "error", error: "proxy misconfigured" } }, 500);
  }
  let rl;
  try {
    rl = await checkRateLimits(store, uid, member.code, now, LIMITS);
  } catch (e) {
    /* A store that cannot be read or written is NOT a reason to serve
     * unmetered — it is the same state as having no store. Fail closed. */
    console.error("[hfPatient-proxy] rate-limit store unavailable:", e.message);
    return reply({ result: { reply: "", state: "error", error: "proxy misconfigured" } }, 500);
  }
  if (!rl.ok) {
    return fail("rate limit exceeded (" + rl.scope + ")", "RESOURCE_EXHAUSTED", 429);
  }

  // 6) HF configuration. The token must never leave for a non-HF host.
  const token = env.HF_TOKEN;
  if (!token) return reply({ result: { reply: "", state: "error", error: "HF_TOKEN not configured" } });
  const hfUrl = env.HF_URL || HF_DEFAULT_URL;
  if (!isAllowedHfUrl(hfUrl)) {
    console.error("[hfPatient-proxy] refusing non-HuggingFace HF_URL");
    return reply({ result: { reply: "", state: "error", error: "HF_URL misconfigured" } });
  }

  let model;
  try {
    model = hfModel(env, lang);
  } catch (e) {
    // applyProviderPin fails closed on a malformed provider — sending the
    // data to an unknown provider is the exact failure the pin prevents.
    console.error("[hfPatient-proxy] provider pin rejected:", e.message);
    return reply({ result: { reply: "", state: "error", error: "HF_PROVIDER misconfigured" } });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOTAL_BUDGET_MS);
  try {
    const res = await doFetch(hfUrl, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages,
        /* 900, not the callable's 320.
         *
         * Qwen3.5 is a HYBRID-REASONING model and, with chat_template_kwargs
         * removed (OVHcloud rejects it — see below), it emits a <think> block
         * before answering. At 320 tokens it spent the ENTIRE budget thinking
         * and never reached the answer; stripReasoning then removed the
         * unterminated block and the handler returned "empty reply", which the
         * room saw as the stub patient. Observed live on the deployed proxy.
         *
         * The visible reply is still capped at MAX_REPLY_CHARS (600) by
         * sanitiseReply, so this buys the model room to think WITHOUT making
         * replies longer. */
        max_tokens: 900,
        temperature: 0.55,
        top_p: 0.9,
        presence_penalty: 0.3,
        stop: ["\nDoctor:", "\n- ", "[INST]", "</s>"],
        /* `chat_template_kwargs: { enable_thinking: false }` was here, copied
         * from the Cloud Function. OVHcloud's endpoint REJECTS it: the live
         * proxy returned HTTP 400 from the router on EVERY call, which the
         * client reported to the room as the stub patient. Hugging Face's docs
         * say providers that do not understand the field ignore it — this one
         * does not, so it is not safe to send unconditionally.
         *
         * Dropping it is safe because it was only ever the belt of a
         * belt-and-braces pair: hf-helpers.stripReasoning removes any <think>
         * block from the reply, and THAT is the guarantee. The flag merely
         * asked the model not to emit one. */
        stream: false
      })
    });

    if (!res.ok) {
      /* The provider BODY is still not forwarded (2026-05-30 round-2 review):
       * it can carry account and routing detail the client has no business
       * seeing. The numeric STATUS is different — it is not sensitive, and
       * without it a failing backend is undiagnosable from outside.
       *
       * That mattered immediately: the first live end-to-end test returned
       * "backend unavailable" and there was no way to tell an expired token
       * (401) from an exhausted allowance (402) from a bad model id (404)
       * without redeploying to add a log line. The whole recurring failure in
       * this project is silent degradation — the room gets the stub patient
       * and nobody can see why. A status code is the cheapest possible cure.
       *
       * Scaleway's log tab needs Cockpit provisioned, so console.error alone
       * was not reachable either; this travels back in the response. */
      console.error("[hfPatient-proxy] HF HTTP " + res.status);
      return reply({ result: {
        reply: "", state: "error",
        error: "backend unavailable",
        upstreamStatus: res.status
      } });
    }
    const data = await res.json();
    const raw = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    const text = sanitiseReply(raw, body.characterName);
    if (!text) return reply({ result: { reply: "", state: "error", error: "empty reply" } });

    return reply({
      result: {
        reply: text,
        state: "ok",
        elapsedMs: (d.now ? d.now() : Date.now()) - now,
        promptVersion: PROMPT_VERSION,
        // The header the router echoes is the only end-to-end proof the EU
        // provider pin actually took effect.
        provider: res.headers.get("x-inference-provider") || ""
      }
    });
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    console.error("[hfPatient-proxy] " + (aborted ? "HF timeout" : "HF call failed"));
    // Same reasoning as above: name the SHAPE of the failure, never the body.
    return reply({ result: {
      reply: "", state: "error",
      error: "backend unavailable",
      upstreamStatus: aborted ? "timeout" : "network"
    } });
  } finally {
    clearTimeout(timer);
  }
}
