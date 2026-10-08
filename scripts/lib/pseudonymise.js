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
 *
 * RESEARCH CONSENT (added 2026-07-23 — Phase-4e compliance gap 1):
 *   The lobby has always collected an OPTIONAL research-consent tick alongside
 *   the required workshop consent (`pool/{cid}/consent = {workshop, research,
 *   verification, version, at}`), and joining is deliberately NOT conditional
 *   on it — but nothing downstream honoured it, so the export swept in every
 *   participant regardless. It now excludes non-consenting participants:
 *   - FAIL-CLOSED: only `consent.research === true` counts. Absent, false, or
 *     malformed consent (including sessions predating the field) = excluded.
 *     Consent must be affirmative and demonstrable (GDPR Art. 7), so silence
 *     can never be read as agreement.
 *   - A non-consenting participant's `pool` entry is removed, every node keyed
 *     by their clientId is removed, and every node keyed by a stableId that
 *     resolves to their uid is removed (`votes/ballots` is stableId-keyed).
 *   - Their name is never entered into the pseudonym map, so the existing
 *     unknown-name path redacts it to REDACTED-NAME everywhere it appears, and
 *     they get no linkage-table entry (nothing to re-identify them with).
 *   - `sessionHasConsent()` lets the caller skip a session where nobody opted
 *     in, rather than exporting a participant-free husk.
 *   - `clientMapping`/`stableIdMapping` are DROPPED from the output: they map
 *     to Firebase auth uids, which are stable across sessions and would let an
 *     analyst re-link "Student-A" in one session to "Student-C" in another,
 *     defeating the per-session pseudonymisation. They are read for the
 *     stableId join first, then discarded.
 *
 * TRANSFORM VERSION 2 (in code 2026-10-08) — IDENTIFIERS VERSION 1 LET THROUGH.
 *   Found by running this function on sessions shaped like real ones, and by an
 *   independent review of that work. Every file written by version 1 carries
 *   them; a file says which version wrote it (`transformVersion`, below).
 *
 *   Real NAMES, inside a string:
 *   - `rooms/<room>/events/<id>/payload`. The client writes a room event as
 *     { kind, by, at, payload: JSON.stringify({ by: <display name>,
 *     university, len, … }) } for every answer, edit, deletion and hypothesis,
 *     and for a manual score with the FACILITATOR's name. The walker rewrote
 *     the `by` beside the payload and never opened the string, so the real
 *     name and university of everyone who contributed — participants who had
 *     DECLINED research use included — went out in every export since the
 *     first. A `payload` is now parsed, scrubbed by the same walk as the rest
 *     of the tree, and written back; one that does not parse as a JSON object
 *     (the client cuts it at 500 characters; the rule accepts any string) is
 *     removed, because what cannot be opened cannot be scrubbed. ONLY keys
 *     named `payload` are opened: an authored scenario is JSON in a string
 *     too, and its `name` keys are the case's characters.
 *
 *   E-mail addresses, in a node the rules no longer declare:
 *   - `mail/<id>` = { to, subject, text } at the session's root: the queue of
 *     the mail function removed on 2026-09-24. A rule being deleted does not
 *     delete what it guarded, so a session created before that date can still
 *     hold one. Dropped at the root only — a content id may be called "mail".
 *
 *   Firebase auth uids, outside the two mapping tables:
 *   - `creatorUid` — the facilitator's account. DROPPED, not replaced by a
 *     pseudonym: a session has exactly one creator, so a stand-in would be the
 *     same constant in every session and say nothing, and the one thing it
 *     could say — which pool participant, if any, the creator also was — picks
 *     the facilitator out among the participants. Uid-keyed maps likewise drop
 *     a facilitator's entry rather than give it a stand-in.
 *   - `ownerUid` (in `scenarioRef`) — the account that authored the scenario;
 *     for a shared scenario, somebody who was never in the session. DROPPED,
 *     whatever it holds: the rules validate it as a string, not as a uid.
 *     `scenarioId` and `source` stay — which scenario ran is research content.
 *   - `roomOf/<uid>` — a participant's account, as a key, next to their
 *     clientId: the join `clientMapping` was dropped to withhold, the other way
 *     round. In the rules since 2026-08-03, after the list below was written.
 *     DROPPED, not rekeyed like `members`: one account can stand behind two
 *     pool rows (two students on one browser), `roomOf` is written once per
 *     account, and "the account's pseudonym" then puts one student's name on
 *     the other's row. Nothing is lost: `pool/<clientId>/room` says who was in
 *     which room.
 *   - Under a rekeyed map. The walker stopped at `members` once it had
 *     rekeyed it, so a name or uid its owner had written beneath their own
 *     entry passed as written. It now walks what it rekeyed.
 *
 *   tests/pseudonymise-uid-coverage.test.js derives from database.rules.json
 *   the positions that hold an account identifier and runs this function on
 *   each, so that MOST uids the rules gain later fail a test. It cannot see a
 *   field no rule names, a node the rules no longer declare, a uid under a
 *   name that says nothing, or a name inside a string — which is two of the
 *   defects listed above. Read its header before relying on it.
 *
 * WHAT IS STILL CARRIED — `stableId`, AND IT IS NOT SETTLED THAT IT SHOULD BE:
 *   The study's join key, left exactly as written: in `pool`, `tests`,
 *   `survey`, `poll` (older sessions), and as the key of each ballot. For a
 *   participant who is SIGNED IN it is their auth uid, the same in every
 *   session. For an anonymous one it is a random value kept in the browser,
 *   carried into the next session unless they left through Leave, "use a
 *   different session" or "forget this session", which clear it. So this
 *   export is NOT free of cross-session identifiers and must not be described
 *   as if it were.
 *   It does not have to be carried raw for the joins made INSIDE the platform:
 *   pre-test, post-test and wrap-up questionnaire sit in one session, so a
 *   stand-in per distinct stableId per session would keep them all. The join
 *   that needs the raw value is the one the protocol PLANS to a questionnaire
 *   outside the platform, through a printed code the client does not yet
 *   show. That is a decision about the study, put to the controller in
 *   legal/dpa-draft.md (Annex VI R8, R10) — not taken here.
 *
 * WHAT THIS MODULE DOES NOT DO, so that nobody reads it as more:
 *   - A participant who declined is not ERASED from the output. Their pool
 *     row and every node keyed by their identifiers go; what they wrote into
 *     the room's shared lists (answers, replies, hypotheses, deleted answers)
 *     stays, with the name redacted and their per-tab clientId as `cid`.
 *   - Free text is exported as written (R7 in the DPA draft).
 */

const REDACTED_NAME = "REDACTED-NAME";

/* Which transform wrote a file. The export stamps it on the payload, because a
 * DATE cannot say it: the job runs once a night on whatever `main` holds, so
 * the day a fix is written, the day it merges and the day a file is first
 * written by it are three different days.
 *   (absent) / 1  everything before version 2
 *   2             names inside event payloads, the legacy mail queue,
 *                 creatorUid, ownerUid and roomOf are removed (header above)
 * Raise it with every change to what this module lets through. */
const TRANSFORM_VERSION = 2;

// Keys whose ENTIRE value/subtree is removed from the export.
const DROP_KEYS = new Set([
  "adminPasswordHash", // secret marker — never in research data
  "_adminPresence",    // facilitator display name (transient)
  "_superadminReset",  // facilitator name + recovery code (transient)
  "chat",              // free-text LLM turns: a name embedded in prose can't be exact-matched
  "clientMapping",     // clientId -> auth uid: a CROSS-SESSION identifier (see header)
  "stableIdMapping",   // stableId -> auth uid: ditto
  "creatorUid",        // the facilitator's auth uid (see header: dropped, not pseudonymised)
  "ownerUid",          // scenarioRef.ownerUid: the scenario author's auth uid
  "roomOf"             // uid -> { room, cid }: see header for why it is not rekeyed
]);

// Dropped ONLY at the session's root. Legacy nodes the rules no longer declare;
// the name is too ordinary to remove at every depth (see header).
const ROOT_DROP_KEYS = ["mail"];

// Nodes whose CHILD KEYS are Firebase auth uids. Their keys are rewritten to
// per-session pseudonyms so the map keeps its shape (and its research value)
// without exporting an identifier that is stable across sessions.
const UID_KEYED = new Set(["uidMembers", "members"]);

/**
 * Did this participant opt in to research use? Fail-closed: only an explicit
 * boolean true counts, so a missing/legacy/malformed consent record excludes
 * them (GDPR Art. 7 — consent must be affirmative, never inferred from silence).
 * @param {object} poolEntry a single `pool/{clientId}` record
 */
function hasResearchConsent(poolEntry) {
  return !!(poolEntry && poolEntry.consent && poolEntry.consent.research === true);
}

/**
 * True if at least one pooled participant consented to research use. Callers
 * use this to skip the session entirely rather than export a husk with every
 * participant stripped out.
 * @param {object} sess the raw session subtree
 */
function sessionHasConsent(sess) {
  const pool = (sess && sess.pool) || {};
  return Object.keys(pool).some(cid => hasResearchConsent(pool[cid]));
}

/**
 * Apply a session's withdrawal records to its pool, in memory.
 *
 * A participant who withdraws (GDPR Art. 7(3)) writes
 * `withdrawals/<code>/<uid>`, which the rules keep writable AFTER the session
 * closes — unlike `pool/<cid>/consent`, which is closed-guarded and so cannot
 * be flipped once the session ends. Since withdrawal is exercised precisely
 * then, the withdrawals node is the authoritative record and the pool flag is
 * only a best-effort mirror.
 *
 * Flipping the pool flag here rather than teaching every caller about
 * withdrawals is deliberate: `sessionHasConsent`, `hasResearchConsent` and
 * `pseudonymiseSession` all read that one flag, so one transformation at the
 * front makes every downstream gate honour the withdrawal. A second code path
 * that had to be remembered is how the export came to ignore consent entirely
 * in the first place (Annex VI G1).
 *
 * @param {object} session the raw session subtree
 * @param {object} withdrawals `withdrawals/<code>` — { uid: {research, at} }
 * @returns {object} a NEW session; the input is not mutated
 */
function applyWithdrawals(session, withdrawals) {
  const out = JSON.parse(JSON.stringify(session === undefined ? null : session));
  if (!out || typeof out !== "object") return out;
  const recs = withdrawals && typeof withdrawals === "object" ? withdrawals : {};
  const withdrawn = new Set(
    Object.keys(recs).filter(uid => recs[uid] && recs[uid].research === false));
  if (!withdrawn.size) return out;

  const mapping = (out.clientMapping && typeof out.clientMapping === "object")
    ? out.clientMapping : {};
  const pool = (out.pool && typeof out.pool === "object") ? out.pool : {};
  for (const cid of Object.keys(pool)) {
    /* A withdrawal is by uid; the pool is keyed by clientId, and one person can
       hold several. Every clientId mapped to a withdrawn uid loses consent. */
    if (!withdrawn.has(mapping[cid])) continue;
    const entry = pool[cid];
    if (entry && typeof entry === "object") {
      entry.consent = Object.assign({}, entry.consent, { research: false });
    }
  }
  return out;
}

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
  const allCids = Object.keys(pool).sort((a, b) => {
    const ta = (pool[a] && pool[a].at) || 0;
    const tb = (pool[b] && pool[b].at) || 0;
    return ta - tb;
  });

  // Research-consent split. Only opted-in participants reach the export; the
  // rest are erased from it (see the RESEARCH CONSENT block in the header).
  const cids = allCids.filter(cid => hasResearchConsent(pool[cid]));
  const excludedCids = allCids.filter(cid => !hasResearchConsent(pool[cid]));

  // Keys to delete wherever they appear: the excluded participants' clientIds,
  // plus the stableIds/uids that resolve to them. `votes/ballots` is keyed by
  // stableId and `uidMembers`/`members` by uid, so clientId alone misses them.
  const clientMapping = sess.clientMapping || {};
  const stableIdMapping = sess.stableIdMapping || {};
  const excludedUids = new Set(
    excludedCids.map(cid => clientMapping[cid]).filter(u => typeof u === "string")
  );
  const excludedKeys = new Set(excludedCids);
  excludedUids.forEach(u => excludedKeys.add(u));
  Object.keys(stableIdMapping).forEach(sid => {
    if (excludedUids.has(stableIdMapping[sid])) excludedKeys.add(sid);
  });

  // uid -> pseudonym, so uid-keyed membership maps keep their shape (and their
  // research value: who was in which room) without carrying a cross-session
  // identifier. Built from the CONSENTING cids only; any uid left unmapped is
  // dropped rather than passed through.
  const uidToPseudo = Object.create(null);

  // name -> pseudonym. Every distinct normalised name is mapped; on collision
  // the colliding name keeps the first cid's code (more anonymous, and crucially
  // never a plaintext survivor).
  const nameToPseudo = Object.create(null);
  cids.forEach((cid, i) => {
    const name = normName(pool[cid] && pool[cid].name);
    if (typeof name === "string" && name.length > 0 && !hasOwn(nameToPseudo, name)) {
      nameToPseudo[name] = pseudoCode(i);
    }
    const uid = clientMapping[cid];
    if (typeof uid === "string" && uid.length > 0) uidToPseudo[uid] = pseudoCode(i);
  });

  // The replacement map actually used for substitution. It covers EVERY pooled
  // name, not just the consenting ones: a non-consenting participant maps to
  // REDACTED_NAME. Without this they would fall through the "unknown name"
  // path, which only redacts `name`/`by` — so their name would survive as
  // plaintext in a free-text field or a bare array element. `nameToPseudo`
  // stays consenting-only because it is what the linkage table is built from.
  const nameReplace = Object.create(null);
  Object.keys(nameToPseudo).forEach(n => { nameReplace[n] = nameToPseudo[n]; });
  excludedCids.forEach(cid => {
    const name = normName(pool[cid] && pool[cid].name);
    // A consenting participant sharing a display name with a non-consenting one
    // keeps the pseudonym: the tie must not un-map the consenting participant.
    if (typeof name === "string" && name.length > 0 && !hasOwn(nameReplace, name)) {
      nameReplace[name] = REDACTED_NAME;
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
    if (hasOwn(nameReplace, n)) return nameReplace[n];
    return REDACTED_NAME; // unknown name (facilitator / unforeseen) — never leak
  }

  // Replace the auth uids keying a membership map with per-session pseudonyms.
  // Unmappable uids (facilitators, or participants who did not consent) are
  // dropped: passing the raw uid through would re-link them across sessions.
  function rekeyByUid(map) {
    const out = Object.create(null);
    for (const uid of Object.keys(map)) {
      if (hasOwn(uidToPseudo, uid)) out[uidToPseudo[uid]] = map[uid];
    }
    return out;
  }

  const out = JSON.parse(JSON.stringify(sess));
  for (const k of ROOT_DROP_KEYS) delete out[k];

  // A `payload` is a JSON object in a string (logEvent / logAdminAction in the
  // client). Returns it scrubbed and re-serialised, or null when it cannot be
  // read as one — the caller then removes it rather than pass it through.
  function scrubPayload(s) {
    let parsed;
    try { parsed = JSON.parse(s); } catch (e) { return null; }
    if (!parsed || typeof parsed !== "object") return null;
    walk(parsed);
    return JSON.stringify(parsed);
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (typeof item === "string") {
          // Bare-string array element: apply the same exact-known-name safety net.
          const n = normName(item);
          if (hasOwn(nameReplace, n)) node[i] = nameReplace[n];
        } else if (item && typeof item === "object") {
          walk(item);
        }
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (DROP_KEYS.has(k)) { delete node[k]; continue; }
      // Non-consenting participant: erase the node keyed by their clientId /
      // stableId / uid, wherever in the tree it sits.
      if (excludedKeys.has(k)) { delete node[k]; continue; }
      const v = node[k];
      if (UID_KEYED.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
        node[k] = rekeyByUid(v);
        walk(node[k]);
      } else if (k === "payload" && typeof v === "string") {
        const scrubbed = scrubPayload(v);
        if (scrubbed === null) delete node[k]; else node[k] = scrubbed;
      } else if (k === "name" || k === "by") {
        node[k] = redactName(v);
      } else if (k === "university") {
        node[k] = bucketUniv(v);
      } else if (typeof v === "string") {
        // Safety net: replace any exact known-name occurrence in any other field.
        const n = normName(v);
        if (hasOwn(nameReplace, n)) node[k] = nameReplace[n];
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  }
  walk(out);
  return out;
}

module.exports = {
  applyWithdrawals,
  pseudonymiseSession,
  pseudoCode,
  normName,
  hasResearchConsent,
  sessionHasConsent,
  REDACTED_NAME,
  TRANSFORM_VERSION,
  DROP_KEYS,
  ROOT_DROP_KEYS,
  UID_KEYED
};
