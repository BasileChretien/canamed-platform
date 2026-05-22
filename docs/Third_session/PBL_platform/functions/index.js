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
