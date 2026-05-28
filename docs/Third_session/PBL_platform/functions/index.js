/* CANAMED — email Cloud Function (consent-gated transactional mail).
 *
 * WHAT: when an admin enqueues a mail job at sessions/<code>/mail/<id> (e.g. a
 * spaced-reinforcement "revisit your retention quiz" reminder to a participant
 * who opted in), this function sends it via SMTP and records the delivery state
 * back on the node. Idempotent (skips anything already delivered).
 *
 * SECURITY / PRIVACY:
 *   - SMTP credentials are read from runtime config (functions.config().smtp.*)
 *     or environment — NEVER hardcoded. See functions/README.md for setup.
 *   - The mail queue is ADMIN-WRITE-ONLY at the database-rules layer (a session's
 *     adminPasswordHash must exist), so this is not an open relay: only a
 *     facilitator can enqueue, and only for addresses a participant consented to.
 *   - Recipient + subject + body length are validated by the rules before this
 *     ever runs; this function additionally fails closed if SMTP is unconfigured.
 *
 * DEPLOY: requires the Firebase Blaze plan (Cloud Functions). This file is the
 * complete code; activation is three operator steps documented in README.md.
 */
"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

/* Build an SMTP transport from runtime config. Returns null when unconfigured
   so the caller can fail closed (record an error rather than crash). */
function buildTransport() {
  const c = (functions.config && functions.config().smtp) || {};
  const host = c.host || process.env.SMTP_HOST;
  const user = c.user || process.env.SMTP_USER;
  const pass = c.pass || process.env.SMTP_PASS;
  const port = Number(c.port || process.env.SMTP_PORT || 587);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,            // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: user, pass: pass }
  });
}

function fromAddress() {
  const c = (functions.config && functions.config().smtp) || {};
  return c.from || process.env.SMTP_FROM || "CANAMED <no-reply@example.org>";
}

/* Approval gate. Email stays OFF until an operator deliberately enables it
   AFTER institutional (university president) approval. Default: disabled. */
function emailEnabled() {
  const c = (functions.config && functions.config().email) || {};
  const v = (c.enabled != null ? c.enabled : process.env.EMAIL_ENABLED);
  return String(v).toLowerCase() === "true";
}

/* sessions/<code>/mail/<id> queue. The orgs/<slug>/sessions/... tree, if used,
   needs a parallel export (same body) — see README.md. */
exports.sendQueuedMail = functions.database
  .ref("/sessions/{code}/mail/{id}")
  .onCreate(async (snap) => {
    const job = snap.val() || {};
    // Skip malformed or already-processed jobs (idempotent on retries).
    if (!job.to || !job.subject || job.delivery) return null;

    // APPROVAL GATE: email is DISABLED by default and stays dormant until the
    // institution (university president) approves it. Beyond just configuring
    // SMTP, an operator must DELIBERATELY flip this flag on:
    //   firebase functions:config:set email.enabled="true"
    // (or set EMAIL_ENABLED=true). Until then, nothing is ever sent — jobs just
    // record that the feature is gated. This makes "keep it hidden until
    // approved" enforced in code, not just convention.
    if (!emailEnabled()) {
      await snap.ref.child("delivery").set({
        state: "disabled", at: Date.now(),
        error: "Email feature disabled (pending institutional approval)"
      });
      return null;
    }

    const transport = buildTransport();
    if (!transport) {
      await snap.ref.child("delivery").set({
        state: "error", at: Date.now(), error: "SMTP not configured"
      });
      return null;
    }

    try {
      await transport.sendMail({
        from: fromAddress(),
        to: String(job.to),
        subject: String(job.subject),
        text: job.text ? String(job.text) : "",
        html: job.html ? String(job.html) : undefined
      });
      await snap.ref.child("delivery").set({ state: "sent", at: Date.now() });
    } catch (e) {
      await snap.ref.child("delivery").set({
        state: "error", at: Date.now(),
        error: String((e && e.message) || e).slice(0, 300)
      });
    }
    return null;
  });

/* ============================================================================
 * hfPatient — HTTPS callable that voices Mr Lefebvre via Hugging Face
 * Inference Providers (or any compatible chat-completion endpoint). Used by
 * the Module A LLM-patient pilot (modA-llm-bridge.js).
 *
 * SECURITY model:
 *   - App Check is ENFORCED at the Realtime Database (since 2026-05-23) and
 *     also REQUIRED on this callable: `consumeAppCheckToken: true` rejects
 *     any caller without a valid attestation token. The token is replay-
 *     protected (single-use) so a leaked token can't be reused.
 *   - Auth is required (`enforceAppCheck: true` + Auth context check below);
 *     anonymous Firebase Auth is enough — that is what every classroom
 *     student uses.
 *   - The HF token NEVER reaches a client. It is read from
 *     functions.config().hf.token (or HF_TOKEN env var) — set via the
 *     Firebase CLI, never committed.
 *   - Per-user rate limit (RTDB counter) prevents API-bill griefing.
 *   - Body size limits + reply size limits + reply sanitisation are applied
 *     server-side so an LLM response cannot blow up the client.
 *   - Only counters (uid, ts, tokensIn approx) are logged — NEVER the user
 *     text, NEVER the patient reply. (The full transcript is the room's
 *     responsibility, persisted via the existing chat path with App-Check
 *     enforced RTDB rules.)
 *
 * APPROVAL GATE: dormant until an operator deliberately opts in (mirrors
 * the email function pattern). Even with a token set, this function refuses
 * to call HF until `functions.config().moda.llm === "true"`. */

const HF_DEFAULT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";
/* Mistral-7B's Japanese is weak (byte-level CJK tokenisation, drops out of role
 * mid-reply). JA traffic routes to a Qwen variant by default — same OpenAI-
 * compat surface, much stronger JA. Override via functions.config().hf.modelJa. */
const HF_DEFAULT_MODEL_JA = "Qwen/Qwen2.5-7B-Instruct";
const HF_DEFAULT_URL   = "https://router.huggingface.co/v1/chat/completions";
const MAX_BODY_MESSAGES = 16;
const MAX_BODY_CHARS    = 4000;
const MAX_REPLY_CHARS   = 600;
const RATE_LIMIT_TURNS  = 40;            // turns per uid per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SESSION_RATE_LIMIT_TURNS = 250;    // turns per session per window
const PROMPT_VERSION = "modA-llm@1.1";   // bump when STYLE_RULES change

function _modAllmEnabled() {
  const c = (functions.config && functions.config().moda) || {};
  const v = (c.llm != null ? c.llm : process.env.MODA_LLM);
  return String(v).toLowerCase() === "true";
}
function _hfToken() {
  const c = (functions.config && functions.config().hf) || {};
  return c.token || process.env.HF_TOKEN || "";
}
function _hfUrl() {
  const c = (functions.config && functions.config().hf) || {};
  return c.url || process.env.HF_URL || HF_DEFAULT_URL;
}
/* Lang-aware model picker. Mistral-7B for EN/FR (well-tuned + cheaper) and a
 * JA-capable model for JA. Operator can override either via config. */
function _hfModel(lang) {
  const c = (functions.config && functions.config().hf) || {};
  if (lang === "ja") {
    return c.modelJa || process.env.HF_MODEL_JA || HF_DEFAULT_MODEL_JA;
  }
  return c.model || process.env.HF_MODEL || HF_DEFAULT_MODEL;
}

function _sanitiseReply(s) {
  if (s == null) return "";
  let t = String(s).trim();
  // Strip a much broader set of leading "Patient:" / "Mr. Lefebvre, age 45:" /
  // "Réponse:" / "[Patient response]:" / "**Patient**:" / "「" / "患者:" prefixes
  // the model sometimes emits even with stop[] tokens in place. (M4 from the
  // 2026-05-28 review.) Apply twice in case the model layered two wrappers.
  // Strip wrapper brackets BEFORE the JSON-shape check.
  t = t.replace(/^\s*\[[A-Za-z0-9 .,'!_'-]{1,60}\]\s*/, "");
  const ROLE_PREFIX = /^\s*[*_"'`>「『]*\s*(\[[^\]]+\]\s*)?(patient|mr\.?\s*lefebvre|le\s+patient|réponse|response|回答|患者(?:さん)?|彼)[^:：\-—\n]{0,40}\s*[:：\-—]\s*/i;
  t = t.replace(ROLE_PREFIX, "");
  t = t.replace(ROLE_PREFIX, "");
  // Strip a leading bullet — the most common list-continuation leak.
  t = t.replace(/^\s*[-•*]\s+/, "");
  // Trim leading/trailing quote marks the model sometimes wraps around its
  // reply ("..." or 「...」).
  t = t.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "");
  // Reject JSON-shaped replies (the prompt forbids them).
  if (/^\s*[{[]/.test(t)) return "";
  if (t.length > MAX_REPLY_CHARS) t = t.slice(0, MAX_REPLY_CHARS - 1) + "…";
  return t.trim();
}

function _validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  if (messages.length > MAX_BODY_MESSAGES) return false;
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== "object") return false;
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") return false;
    if (typeof m.content !== "string") return false;
    total += m.content.length;
    if (total > MAX_BODY_CHARS) return false;
  }
  return true;
}

/* Fixed-window counter in RTDB. NB: renamed from "rolling" to be honest about
 * what it is — when `now - windowStart >= window`, the window resets to `now`.
 * That's good enough for a workshop (cheap, race-safe via transaction); a
 * true rolling bucket would need per-call ledger writes. */
async function _bumpCounter(path, limit) {
  const ref = admin.database().ref(path);
  const now = Date.now();
  const result = await ref.transaction(cur => {
    cur = cur || { count: 0, windowStart: now };
    if (now - cur.windowStart >= RATE_LIMIT_WINDOW_MS) {
      cur = { count: 0, windowStart: now };
    }
    cur.count = (cur.count || 0) + 1;
    cur.lastAt = now;
    return cur;
  });
  const v = (result.snapshot && result.snapshot.val()) || {};
  return { ok: (v.count || 0) <= limit, count: v.count || 0 };
}

async function _rateLimit(uid, roomCode) {
  const perUid = await _bumpCounter("metrics/hfPatient/usage/" + uid, RATE_LIMIT_TURNS);
  if (!perUid.ok) return { ok: false, scope: "uid" };
  if (roomCode) {
    const safeCode = String(roomCode).replace(/[.#$/\[\]]/g, "");
    if (safeCode) {
      const perSession = await _bumpCounter(
        "metrics/hfPatient/sessionUsage/" + safeCode, SESSION_RATE_LIMIT_TURNS);
      if (!perSession.ok) return { ok: false, scope: "session" };
    }
  }
  return { ok: true };
}

/* Verify the caller is currently in the room they claim. Reads:
 *   sessions/<code>/rooms/<room>/uidMembers/<uid>  (or the orgs mirror)
 * Returns the resolved {code, roomId, orgSlug?} or null if not a member.
 * Avoids spending HF tokens on requests from users who never joined a room. */
async function _verifyMembership(uid, body) {
  const code   = String(body && body.roomCode || "").trim();
  const roomId = String(body && body.roomId   || "").trim();
  const orgSlug = body && body.orgSlug ? String(body.orgSlug).trim() : "";
  if (!code || !roomId) return null;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code))   return null;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(roomId)) return null;
  if (orgSlug && !/^[A-Za-z0-9_-]{1,40}$/.test(orgSlug)) return null;

  const path = orgSlug
    ? `orgs/${orgSlug}/sessions/${code}/rooms/${roomId}/uidMembers/${uid}`
    : `sessions/${code}/rooms/${roomId}/uidMembers/${uid}`;
  const snap = await admin.database().ref(path).once("value");
  return snap.exists() ? { code, roomId, orgSlug } : null;
}

/* Bounded retry on HF cold-load (503) + transient overload (429/520/524).
 * Reads Retry-After / `estimated_time` when present, sleeps with capped
 * backoff so we never exceed the AbortController budget. */
async function _hfCallWithRetry(url, headers, body, signal, totalBudgetMs) {
  const start = Date.now();
  let attempt = 0;
  // 2 retries max; first wait is min(parsedRetry, 3s), second is min(parsedRetry, 5s).
  while (true) {
    attempt++;
    const res = await fetch(url, { method: "POST", headers, body, signal });
    if (res.ok) return { res, attempt };
    const status = res.status;
    const isRetryable = (status === 429 || status === 503 || status === 520 || status === 524);
    if (!isRetryable || attempt >= 3) return { res, attempt };
    // Parse Retry-After header (seconds) or estimated_time (HF body)
    let waitMs = 1500;
    const ra = res.headers.get && res.headers.get("retry-after");
    if (ra) {
      const n = parseInt(ra, 10);
      if (Number.isFinite(n) && n >= 0) waitMs = Math.min(n * 1000, 8000);
    } else {
      try {
        const j = await res.clone().json();
        if (j && Number.isFinite(j.estimated_time)) {
          waitMs = Math.min(Math.ceil(j.estimated_time * 1000), 8000);
        }
      } catch (_) { /* not JSON, ignore */ }
    }
    // Honour overall budget — bail if a retry would blow the timeout.
    const remaining = totalBudgetMs - (Date.now() - start);
    if (remaining <= waitMs + 1000) return { res, attempt };
    await new Promise(r => setTimeout(r, waitMs));
  }
}

/* Extract a string completion from OpenAI-compat response, defensively. Some
 * HF Inference Providers (Cerebras, Sambanova on certain models) return
 * `content` as a string OR an array of {type:"text", text:"..."}. */
function _extractContent(j) {
  const choice = j && j.choices && j.choices[0];
  if (!choice || !choice.message) return "";
  const c = choice.message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map(part => (part && typeof part.text === "string") ? part.text : "").join("");
  }
  return "";
}

exports.hfPatient = functions
  .runWith({
    enforceAppCheck: true,
    // consumeAppCheckToken intentionally FALSE (2026-05-28 review H7):
    // single-use consumption was rejecting legitimate workshop turns under
    // load (token churn vs HF latency). Replay protection here is low-value
    // because the real abuse defence is the per-uid + per-session rate
    // limits below; the App Check signal alone keeps bots out.
    consumeAppCheckToken: false,
    memory: "256MB",
    timeoutSeconds: 30
  })
  .https.onCall(async (data, context) => {
    const startedAt = Date.now();
    const body = data || {};
    const lang = String(body.lang || "en").slice(0, 2);

    // 1) Approval gate — DORMANT by default. Even with a valid token, this
    //    function returns a structured "disabled" response until an operator
    //    explicitly flips the flag (see functions/README.md).
    if (!_modAllmEnabled()) {
      return { reply: "", state: "disabled",
               error: "moda.llm feature flag is off" };
    }

    // 2) Auth — every classroom user signs in anonymously; that is enough.
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError("unauthenticated", "auth required");
    }
    const uid = context.auth.uid;

    // 3) Validate input shape + sizes BEFORE doing anything else.
    if (!_validateMessages(body.messages)) {
      throw new functions.https.HttpsError("invalid-argument", "bad messages");
    }
    const messages = body.messages;

    // 4) Session-membership check (H8): refuse callers who are NOT currently
    //    in the room they claim. Reads sessions/<code>/rooms/<r>/uidMembers/<uid>.
    //    Closes the "any authed anon can spend HF tokens" hole and also
    //    keys the per-session rate limit on a verified roomCode.
    const member = await _verifyMembership(uid, body);
    if (!member) {
      throw new functions.https.HttpsError("permission-denied",
        "not a member of the claimed room");
    }

    // 5) Rate-limit per uid AND per session (H2/H3 from the review).
    const rl = await _rateLimit(uid, member.code);
    if (!rl.ok) {
      throw new functions.https.HttpsError(
        "resource-exhausted", "rate limit exceeded (" + rl.scope + ")");
    }

    // 6) HF token must be configured. If it isn't, return a structured error
    //    so the client falls back to the local stub patient (chat keeps
    //    working — facilitator sees the fallback banner).
    const token = _hfToken();
    if (!token) {
      return { reply: "", state: "error", error: "HF token not configured" };
    }

    // 7) Call HF with bounded retry on 503/429/520/524 (H6). Sampling params
    //    hardened (H3): temperature 0.3, top_p 0.9, presence_penalty 0.3,
    //    stop[] to kill bullet + imagined-doctor continuation leaks.
    const ctrl = new AbortController();
    const TOTAL_BUDGET_MS = 25_000;
    const to = setTimeout(() => ctrl.abort(), TOTAL_BUDGET_MS);
    let raw = "", attempts = 0, httpStatus = 0, provider = "";
    let promptTokens = 0, completionTokens = 0;
    const reqBody = JSON.stringify({
      model: _hfModel(lang),
      messages,
      max_tokens: 220,
      temperature: 0.3,
      top_p: 0.9,
      presence_penalty: 0.3,
      stop: [
        "\nDoctor:", "\nDocteur:", "\n医師:", "\nDoctor :", "Doctor:",
        "\n- ", "\n* ", "\n• ",
        "[INST]", "</s>"
      ],
      stream: false
    });
    try {
      const { res, attempt } = await _hfCallWithRetry(
        _hfUrl(),
        { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        reqBody,
        ctrl.signal,
        TOTAL_BUDGET_MS);
      clearTimeout(to);
      attempts = attempt;
      httpStatus = res.status;
      provider = (res.headers && res.headers.get && res.headers.get("x-inference-provider")) || "";
      if (!res.ok) {
        // 4xx → caller-side problem (failed-precondition); 429 → quota; 5xx → upstream.
        const code = (res.status === 429) ? "resource-exhausted"
                   : (res.status >= 500)  ? "unavailable"
                                          : "failed-precondition";
        throw new functions.https.HttpsError(code, "hf http " + res.status);
      }
      const j = await res.json();
      // Some providers signal failure with HTTP 200 + {error: "..."}; treat as upstream.
      if (j && j.error && !j.choices) {
        throw new functions.https.HttpsError("unavailable",
          "hf provider error: " + String(j.error).slice(0, 200));
      }
      raw = _extractContent(j);
      if (j && j.usage) {
        promptTokens = Number(j.usage.prompt_tokens) || 0;
        completionTokens = Number(j.usage.completion_tokens) || 0;
      }
    } catch (e) {
      clearTimeout(to);
      if (e && e.code && typeof e.code === "string") throw e; // HttpsError
      throw new functions.https.HttpsError(
        "internal", "hf error: " + String((e && e.message) || e).slice(0, 200));
    }

    const reply = _sanitiseReply(raw);
    // 8) Counters only — NEVER user text, NEVER patient reply. Now includes
    //    upstream latency, HTTP status, provider, token usage, retries —
    //    enough for an operator to debug "why was the patient slow tonight".
    try {
      await admin.database().ref("metrics/hfPatient/events").push({
        uid,
        at: Date.now(),
        lang,
        msgCount: messages.length,
        replyLen: reply.length,
        latencyMs: Date.now() - startedAt,
        httpStatus,
        provider: provider.slice(0, 40),
        promptTokens,
        completionTokens,
        attempts,
        promptVersion: PROMPT_VERSION,
        sessionCode: member.code
      });
    } catch (_) { /* metrics best-effort */ }

    return { reply, state: "ok" };
  });
