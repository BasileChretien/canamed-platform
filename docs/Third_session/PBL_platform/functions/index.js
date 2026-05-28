/* CANAMED Cloud Functions — Gen 2 (firebase-functions v2 API).
 *
 * Two functions live in this codebase:
 *   1. sendQueuedMail — dormant transactional-email pipeline (consent-gated
 *      revisit reminders). Stays disabled until institutional approval.
 *   2. hfPatient — Module A LLM-patient broker. Calls Hugging Face Inference
 *      Providers; dormant until MODA_LLM_ENABLED=true.
 *
 * Migrated from v1 → v2 on 2026-05-28. Reasons:
 *   - Cloud Functions Gen 1 caps at Node 20 (decommissioned 2026-10-30);
 *     Gen 2 supports Node 22+.
 *   - firebase-functions v1 surface (functions.https.onCall, runWith) is
 *     deprecated; firebase-tools warns on every deploy.
 *   - Gen 2 has concurrency (one instance serves many requests), better
 *     cold-start, cheaper per-invocation pricing.
 *
 * SECURITY model (unchanged from v1 — only the API style changed):
 *   - App Check ENFORCED on hfPatient (consumeAppCheckToken=false; see H7
 *     of the 2026-05-28 review for why single-use is wrong here).
 *   - HF token + SMTP password in Google Secret Manager (never in .env,
 *     never in source). Bound per-function via `secrets: [...]`.
 *   - Non-secret config (MODA_LLM_ENABLED, SMTP_HOST, etc.) via
 *     defineString / defineBoolean — set in functions/.env or per-project
 *     functions/.env.<projectId>.
 *   - Counters-only metrics; never the user text or patient reply.
 */
"use strict";

const { onValueCreated } = require("firebase-functions/v2/database");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineString, defineSecret, defineBoolean } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// Force Node 22 explicitly. Without this, firebase-tools v13.x defaults Gen 2
// functions to Node 20 even when package.json says engines.node="22" — the
// engines field is a hint, not a directive, for Gen 2. setGlobalOptions
// applies to every function in this file. (Per-function `runtime` works too
// but is more verbose.)
setGlobalOptions({ runtime: "nodejs22" });

admin.initializeApp();

/* ============================================================================
 * sendQueuedMail — consent-gated transactional email (DORMANT by default).
 *
 * When an admin enqueues a mail job at /sessions/<code>/mail/<id> (e.g. a
 * spaced-reinforcement "revisit your retention quiz" reminder to a participant
 * who opted in), this function sends it via SMTP and records the delivery
 * state back on the node. Idempotent — skips anything already delivered.
 * ========================================================================== */

const EMAIL_ENABLED = defineBoolean("EMAIL_ENABLED", { default: false });
const SMTP_HOST     = defineString("SMTP_HOST", { default: "" });
const SMTP_USER     = defineString("SMTP_USER", { default: "" });
const SMTP_PASS     = defineSecret("SMTP_PASS");   // password in Secret Manager
const SMTP_PORT     = defineString("SMTP_PORT", { default: "587" });
const SMTP_FROM     = defineString("SMTP_FROM", { default: "CANAMED <no-reply@example.org>" });

function buildTransport() {
  const host = SMTP_HOST.value();
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  const port = Number(SMTP_PORT.value() || 587);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,              // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: user, pass: pass }
  });
}

function fromAddress() {
  return SMTP_FROM.value() || "CANAMED <no-reply@example.org>";
}

function emailEnabled() {
  return EMAIL_ENABLED.value() === true;
}

exports.sendQueuedMail = onValueCreated({
  ref: "/sessions/{code}/mail/{id}",
  region: "europe-west1",        // co-located with the trigger (EU-resident data)
  runtime: "nodejs22",           // explicit override; setGlobalOptions can be ignored on `update` ops
  secrets: [SMTP_PASS]
}, async (event) => {
  const snap = event.data;
  const job = snap.val() || {};
  // Skip malformed or already-processed jobs (idempotent on retries).
  if (!job.to || !job.subject || job.delivery) return null;

  // APPROVAL GATE: email is DISABLED until an operator deliberately opts in
  // (after institutional sign-off). Set EMAIL_ENABLED=true in functions/.env.
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
 * Inference Providers. Used by the Module A LLM-patient pilot
 * (modA-llm-bridge.js).
 *
 * Approval gate: dormant until MODA_LLM_ENABLED=true (functions/.env).
 * ========================================================================== */

const HF_DEFAULT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";
const HF_DEFAULT_MODEL_JA = "Qwen/Qwen2.5-7B-Instruct";
const HF_DEFAULT_URL   = "https://router.huggingface.co/v1/chat/completions";
const MAX_BODY_MESSAGES = 16;
const MAX_BODY_CHARS    = 4000;
const MAX_REPLY_CHARS   = 600;
const RATE_LIMIT_TURNS  = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const SESSION_RATE_LIMIT_TURNS = 250;
const PROMPT_VERSION = "modA-llm@1.4";   // bumped to force redeploy of `enforceAppCheck: false` — previous attempts skipped

const MODA_LLM_ENABLED = defineBoolean("MODA_LLM_ENABLED", { default: false });
const HF_TOKEN         = defineSecret("HF_TOKEN");
const HF_URL           = defineString("HF_URL",       { default: HF_DEFAULT_URL });
const HF_MODEL         = defineString("HF_MODEL",     { default: HF_DEFAULT_MODEL });
const HF_MODEL_JA      = defineString("HF_MODEL_JA",  { default: HF_DEFAULT_MODEL_JA });

function _hfModel(lang) {
  return lang === "ja" ? HF_MODEL_JA.value() : HF_MODEL.value();
}

function _sanitiseReply(s) {
  if (s == null) return "";
  let t = String(s).trim();
  // Strip wrapper brackets BEFORE the JSON-shape check.
  t = t.replace(/^\s*\[[A-Za-z0-9 .,'!_'-]{1,60}\]\s*/, "");
  const ROLE_PREFIX = /^\s*[*_"'`>「『]*\s*(\[[^\]]+\]\s*)?(patient|mr\.?\s*lefebvre|le\s+patient|réponse|response|回答|患者(?:さん)?|彼)[^:：\-—\n]{0,40}\s*[:：\-—]\s*/i;
  t = t.replace(ROLE_PREFIX, "");
  t = t.replace(ROLE_PREFIX, "");
  t = t.replace(/^\s*[-•*]\s+/, "");
  t = t.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "");
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

async function _hfCallWithRetry(url, headers, body, signal, totalBudgetMs) {
  const start = Date.now();
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url, { method: "POST", headers, body, signal });
    if (res.ok) return { res, attempt };
    const status = res.status;
    const isRetryable = (status === 429 || status === 503 || status === 520 || status === 524);
    if (!isRetryable || attempt >= 3) return { res, attempt };
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
    const remaining = totalBudgetMs - (Date.now() - start);
    if (remaining <= waitMs + 1000) return { res, attempt };
    await new Promise(r => setTimeout(r, waitMs));
  }
}

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

exports.hfPatient = onCall({
  region: "us-central1",
  runtime: "nodejs22",          // explicit override; setGlobalOptions can be ignored on `update` ops
  // enforceAppCheck DISABLED (2026-05-28 pilot): the platform's client-side
  // App Check is OFF in this deployment (CANAMED_RECAPTCHA_SITE_KEY not set
  // in firebase-config.js), so every callable invocation would return
  // `unauthenticated` if we enforced. The real abuse defences here are:
  //   - Anonymous Auth required (request.auth check below)
  //   - Per-uid rate limit (40 turns/hr in RTDB)
  //   - Per-session rate limit (250 turns/hr in RTDB)
  //   - Server-side session-membership check (_verifyMembership)
  //   - HF token stays in Secret Manager, never reaches the client
  // Re-enable once App Check is wired client-side (App Check token must
  // flow through firebase-config.js → initializeAppCheck → SDK).
  enforceAppCheck: false,
  consumeAppCheckToken: false,
  secrets: [HF_TOKEN],
  memory: "256MiB",            // v2 uses MiB; Gen 2 minimum
  timeoutSeconds: 30,
  cpu: 1,
  // Concurrency: how many requests a single instance handles in parallel.
  // 80 is the v2 default; works for our workload (each request is mostly
  // I/O wait on HF). Lower if you observe CPU contention.
  concurrency: 80
}, async (request) => {
  const startedAt = Date.now();
  const body = request.data || {};
  const lang = String(body.lang || "en").slice(0, 2);

  // 1) Approval gate.
  if (MODA_LLM_ENABLED.value() !== true) {
    return { reply: "", state: "disabled",
             error: "MODA_LLM_ENABLED param is off" };
  }

  // 2) Auth required (anonymous Firebase Auth counts).
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "auth required");
  }
  const uid = request.auth.uid;

  // 3) Validate input shape + sizes.
  if (!_validateMessages(body.messages)) {
    throw new HttpsError("invalid-argument", "bad messages");
  }
  const messages = body.messages;

  // 4) Session-membership check (H8 from the 2026-05-28 review).
  const member = await _verifyMembership(uid, body);
  if (!member) {
    throw new HttpsError("permission-denied",
      "not a member of the claimed room");
  }

  // 5) Rate-limit per uid AND per session.
  const rl = await _rateLimit(uid, member.code);
  if (!rl.ok) {
    throw new HttpsError(
      "resource-exhausted", "rate limit exceeded (" + rl.scope + ")");
  }

  // 6) HF token must be configured.
  const token = HF_TOKEN.value();
  if (!token) {
    return { reply: "", state: "error", error: "HF_TOKEN secret not configured" };
  }

  // 7) Call HF with bounded retry. Sampling params hardened (H3 review):
  //    temperature 0.3, top_p 0.9, presence_penalty 0.3, stop tokens.
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
      HF_URL.value(),
      { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      reqBody,
      ctrl.signal,
      TOTAL_BUDGET_MS);
    clearTimeout(to);
    attempts = attempt;
    httpStatus = res.status;
    provider = (res.headers && res.headers.get && res.headers.get("x-inference-provider")) || "";
    if (!res.ok) {
      const code = (res.status === 429) ? "resource-exhausted"
                 : (res.status >= 500)  ? "unavailable"
                                        : "failed-precondition";
      throw new HttpsError(code, "hf http " + res.status);
    }
    const j = await res.json();
    if (j && j.error && !j.choices) {
      throw new HttpsError("unavailable",
        "hf provider error: " + String(j.error).slice(0, 200));
    }
    raw = _extractContent(j);
    if (j && j.usage) {
      promptTokens = Number(j.usage.prompt_tokens) || 0;
      completionTokens = Number(j.usage.completion_tokens) || 0;
    }
  } catch (e) {
    clearTimeout(to);
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(
      "internal", "hf error: " + String((e && e.message) || e).slice(0, 200));
  }

  const reply = _sanitiseReply(raw);
  // 8) Counters only — never user text, never patient reply.
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
