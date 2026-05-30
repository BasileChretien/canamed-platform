"use strict";
/* Pure, dependency-free pseudonymisation transform for the research export.
 *
 * Extracted from pseudonymise-export.js so it can be unit-tested WITHOUT
 * firebase-admin. scripts/pseudonymise-export.js is just the I/O wrapper.
 *
 * De-identification guarantees (hardened after the 2026-05-30 security review,
 * which found the previous exact-name-match-only approach left real names in
 * the "pseudonymised" output):
 *   - Participant display names (`pool/{cid}/name` and every `by` field) are
 *     replaced with Student-A/B/... codes, assigned by join order.
 *   - Duplicate display names are STILL fully mapped (the colliding name keeps
 *     the first cid's code) — so no real name survives as plaintext, even when
 *     two participants share a name.
 *   - Names in `name`/`by` fields that are NOT in the participant pool — most
 *     importantly FACILITATORS (who join via the admin path, never the pool) —
 *     are redacted to a marker, never passed through. This closes `created.by`,
 *     `_adminPresence.by`, etc.
 *   - Free-text that cannot be reliably scrubbed by value-matching (LLM chat
 *     turns, whose `content` can embed a name mid-sentence) is DROPPED entirely.
 *   - Facilitator transient/identifying subtrees (`_adminPresence`,
 *     `_superadminReset`) and the admin hash marker are dropped.
 *   - `university` (a quasi-identifier that can re-identify in a small cohort)
 *     is bucketed to Univ-N, consistent within the session.
 *   - Names are NFC-normalised and trimmed before matching so whitespace/case
 *     inconsistencies between the pool entry and a `by` field don't leak.
 */

const REDACTED_NAME = "REDACTED-NAME";

// Keys whose ENTIRE value/subtree is removed from the export.
const DROP_KEYS = new Set([
  "adminPasswordHash", // secret marker — never in research data
  "_adminPresence",    // facilitator display name (transient)
  "_superadminReset",  // facilitator name + recovery code (transient)
  "chat"               // free-text LLM turns: a name embedded in prose can't be exact-matched
]);

function normName(s) {
  return typeof s === "string" ? s.normalize("NFC").trim() : s;
}

// Own-property check — the lookup maps are null-prototype objects so that a
// participant named "__proto__" / "toString" / "constructor" can't collide with
// a built-in via the prototype chain (which would leave the real name neither
// pseudonymised nor redacted). Belt-and-braces: use hasOwnProperty too.
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// 26 single letters then AA, AB, ... so we never run out.
function pseudoCode(i) {
  if (i < 26) return "Student-" + String.fromCharCode(65 + i);
  const a = Math.floor(i / 26) - 1;
  const b = i % 26;
  return "Student-" + String.fromCharCode(65 + a) + String.fromCharCode(65 + b);
}

/**
 * Return a pseudonymised deep copy of one session.
 * @param {object} sess         the raw session subtree
 * @param {string} sessionCode  the session code (linkage key)
 * @param {object} [linkage]    if provided, linkage[sessionCode] is set to the
 *                              realName -> pseudonym map (for re-identification)
 */
function pseudonymiseSession(sess, sessionCode, linkage) {
  if (!sess || typeof sess !== "object") return sess;

  const pool = sess.pool || {};
  const cids = Object.keys(pool).sort((a, b) => {
    const ta = (pool[a] && pool[a].at) || 0;
    const tb = (pool[b] && pool[b].at) || 0;
    return ta - tb;
  });

  // name -> pseudonym. Every distinct normalised name is mapped; on collision
  // the colliding name keeps the first cid's code (more anonymous, and crucially
  // never a plaintext survivor).
  const nameToPseudo = Object.create(null);
  cids.forEach((cid, i) => {
    const name = normName(pool[cid] && pool[cid].name);
    if (typeof name === "string" && name.length > 0 && !hasOwn(nameToPseudo, name)) {
      nameToPseudo[name] = pseudoCode(i);
    }
  });
  // Assign the null-proto map directly: JSON.stringify serialises its own keys
  // correctly (including a literal "__proto__" key), whereas Object.assign into
  // a plain {} would re-trigger the __proto__ setter and lose that entry.
  if (linkage) linkage[sessionCode] = nameToPseudo;

  // university -> Univ-N, consistent within the session.
  const univToCode = Object.create(null);
  let univN = 0;
  function bucketUniv(v) {
    const u = normName(v);
    if (typeof u !== "string" || u.length === 0) return v;
    if (!hasOwn(univToCode, u)) univToCode[u] = "Univ-" + (++univN);
    return univToCode[u];
  }

  function redactName(v) {
    const n = normName(v);
    if (typeof n !== "string" || n.length === 0) return v;
    if (hasOwn(nameToPseudo, n)) return nameToPseudo[n];
    return REDACTED_NAME; // unknown name (facilitator / unforeseen) — never leak
  }

  const out = JSON.parse(JSON.stringify(sess));

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (typeof item === "string") {
          // Bare-string array element: apply the same exact-known-name safety net.
          const n = normName(item);
          if (hasOwn(nameToPseudo, n)) node[i] = nameToPseudo[n];
        } else if (item && typeof item === "object") {
          walk(item);
        }
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (DROP_KEYS.has(k)) { delete node[k]; continue; }
      const v = node[k];
      if (k === "name" || k === "by") {
        node[k] = redactName(v);
      } else if (k === "university") {
        node[k] = bucketUniv(v);
      } else if (typeof v === "string") {
        // Safety net: replace any exact known-name occurrence in any other field.
        const n = normName(v);
        if (hasOwn(nameToPseudo, n)) node[k] = nameToPseudo[n];
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  }
  walk(out);
  return out;
}

module.exports = { pseudonymiseSession, pseudoCode, normName, REDACTED_NAME, DROP_KEYS };
