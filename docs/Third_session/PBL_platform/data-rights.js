/* data-rights.js — the GDPR Art. 15 participant self-export, and account
 * deletion (lazy chunk)
 *
 * Two entry points, each behind ONE explicit click and a shim in script.js:
 *   downloadMyData()   #gdpr-export-btn      via _wireDataRightsExport()
 *   deleteMyAccount()  #account-delete-btn   via accountDelete()   (2026-10-07)
 * The deletion block is at the END of this file and carries its own header.
 *
 * SPLIT OUT OF script.js 2026-09-08 to repay the reclaim the perf-budget header
 * (tests-e2e/perf.spec.js) had named since 2026-09-03 and again on 2026-09-07,
 * after two consecutive cap bumps without one. downloadMyData() is reachable
 * from exactly one click — #gdpr-export-btn on the waiting screen — so none of
 * it belongs on the splash's critical path.
 *
 * Loaded via CanamedLoader.ensureDataRights() from _wireDataRightsExport() in
 * script.js, ON CLICK: a participant who never exports never fetches it.
 * script.js keeps NO copy (tests/data-rights-lazy-split.test.js pins that) —
 * only the typeof-guarded shim, so a failed load is the export-failed toast,
 * not a ReferenceError.
 *
 * A CLASSIC script, deliberately, for the same reason as takehome.js: classic
 * scripts share the global script scope, so the script.js top-level `let`s
 * this block reads by bare name — sessionNum, db, clientId, currentUser,
 * myName — resolve exactly as they did when it lived there, with no context
 * object and no window.* rewrite. Its other outbound dependencies (sPath,
 * roomSlotBuckets, LEGACY_SLOT_KEY, tFallback) resolve the same way. Those
 * bindings are in their TDZ until script.js evaluates; this chunk only ever
 * loads from a click long after that, so the ordering is safe.
 *
 * The block below is moved VERBATIM. The export payload is unchanged: the
 * archive-export-v2 and r3-blockers unit suites read it from here now.
 */
/* GDPR Art. 15 (right of access) participant data export.
 *
 * Self-service "download everything you have on me" for the current
 * session. Runs entirely in the browser:
 *   - reads /sessions/{code}/pool/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/presence/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/typing/{clientId}
 *   - reads /sessions/{code}/rooms/{room}/answers/{module}/{*} and
 *     filters by cid === clientId
 *   - reads /sessions/{code}/rooms/{room}/votes/{*}/ballots/{clientId}
 *   - if Google-signed-in, also reads /users/{uid}/profile + history
 *
 * No admin involvement; rules already permit the participant to read
 * their own pool/presence/answers (the session-level .read is
 * auth != null, and the participant IS auth'd). Triggers a JSON
 * download via Blob.
 *
 * If the platform is in MODE === "local" (no Firebase), the function
 * walks the LocalDB the same way — useful for E2E + demos.
 */
function downloadMyData() {
  if (!sessionNum) {
    alert(tFallback("data-rights.err.no-session",
      "Join a session first — there's nothing to export yet."));
    return;
  }
  if (!db || !clientId) {
    alert(tFallback("data-rights.err.not-ready",
      "The platform is still initialising. Please try again in a moment."));
    return;
  }
  const stamp = new Date();
  const out = {
    // R3-E2 — keep canamedDataExport for back-compat; mirror the archive's
    // schema fields so a single pipeline can validate both shapes.
    canamedSchema: "https://canamed.web.app/schema/participant-export-v1.json",
    canamedSchemaVersion: "1.0.0",
    canamedDataExport: 1,
    type: "participant-self-export-art-15-gdpr",
    exportedAt: stamp.toISOString(),
    sessionCode: sessionNum,
    scenarioId: window.CURRENT_SCENARIO_ID || "",
    clientId: clientId,
    user: {
      uid: (currentUser && currentUser.uid) || null,
      email: (currentUser && currentUser.email) || null,
      displayName: (currentUser && currentUser.displayName) || null,
      isAnonymous: !!(currentUser && currentUser.isAnonymous)
    },
    pool: null,
    presence: {},
    typing: {},
    /* moduleBranched included: LEGACY_SLOT_KEY maps a branched slot to it,
       and an uninitialised bucket threw and rejected the WHOLE export. */
    answers: { moduleA: [], moduleB: [], moduleBranched: [] },
    votes: [],
    // R3-A2 — pre/post-test answers belong to the participant and must be
    // exported under GDPR Art. 15. Keyed by room then by 'pre'/'post' so a
    // researcher can correlate test scores with the same room's discussion.
    tests: {},
    // R3-A2 — manual score entries the admin awarded to me, plus help calls
    // I raised. Both reference the participant by name (`by`) so we filter
    // post-hoc against myName.
    manualScoresAboutMe: [],
    helpCallsByMe: [],
    profile: null,
    history: null
  };
  const tasks = [];
  // pool entry
  tasks.push(db.ref(sPath("pool/" + clientId)).once("value").then(s => {
    out.pool = s.val();
  }));
  // rooms — presence, typing, answers, votes, all filtered by clientId
  tasks.push(db.ref(sPath("rooms")).once("value").then(s => {
    const rooms = s.val() || {};
    Object.keys(rooms).forEach(roomName => {
      const r = rooms[roomName] || {};
      if (r.presence && r.presence[clientId]) {
        out.presence[roomName] = r.presence[clientId];
      }
      if (r.typing && r.typing[clientId]) {
        out.typing[roomName] = r.typing[clientId];
      }
      /* S6 — walk the session's SLOTS, not the two retired module keys: a
         participant's own answers must come back whatever slot they wrote them
         in, or a GDPR export silently under-reports their data. */
      roomSlotBuckets(r).forEach(b => {
        const mod = LEGACY_SLOT_KEY[b.type] || "moduleA";
        const ans = b.answers || {};
        Object.keys(ans).forEach(entryId => {
          if (ans[entryId] && ans[entryId].cid === clientId) {
            out.answers[mod].push(Object.assign(
              { room: roomName, slot: b.slot, sectionId: b.sectionId, entryId: entryId },
              ans[entryId]));
          }
        });
      });
      const votes = r.votes || {};
      Object.keys(votes).forEach(voteId => {
        const ballot = votes[voteId] && votes[voteId].ballots && votes[voteId].ballots[clientId];
        if (ballot) {
          out.votes.push({ room: roomName, voteId: voteId, ballot: ballot });
        }
      });
      // R3-A2 — pre/post-test answers under tests/{cid}/{pre|post}/...
      const tests = (r.tests && r.tests[clientId]) || null;
      if (tests) {
        out.tests[roomName] = {
          pre:  tests.pre  || null,
          post: tests.post || null
        };
      }
      // R3-A2 — manual scores the admin awarded that name the participant.
      // The rule layer requires `by` to be the participant's name (string,
      // <=40 chars), so a name match is the canonical filter. We also keep
      // the room name so the participant knows which group it referred to.
      const manual = (r.score && r.score.manual) || {};
      Object.keys(manual).forEach(pid => {
        const m = manual[pid];
        if (m && typeof m.by === "string" && myName && m.by === myName) {
          out.manualScoresAboutMe.push(Object.assign({ room: roomName, id: pid }, m));
        }
      });
      // R3-A2 — help calls I raised. Same name-match rationale as manual
      // scores; the room rule stores `by` as the participant's name.
      const cfh = r.callForHelp;
      if (cfh && typeof cfh.by === "string" && myName && cfh.by === myName) {
        out.helpCallsByMe.push(Object.assign({ room: roomName }, cfh));
      }
    });
  }));
  // identified-user data — only if Google-signed-in
  if (currentUser && !currentUser.isAnonymous) {
    tasks.push(db.ref("users/" + currentUser.uid + "/profile").once("value").then(s => {
      out.profile = s.val();
    }));
    tasks.push(db.ref("users/" + currentUser.uid + "/history").once("value").then(s => {
      out.history = s.val();
    }));
  }
  Promise.all(tasks).then(() => {
    const ymd = stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const blob = new Blob([JSON.stringify(out, null, 2)],
      { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "canamed-my-data-" + sessionNum + "-" + ymd + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
  }).catch(e => {
    console.error("Self-export failed", e);
    alert(tFallback("data-rights.err.export-failed",
      "Could not export your data — please try again, or contact the facilitator."));
  });
}

/* ---- Account deletion ------------------------------------------------------
 *
 * ADDED 2026-10-07. The handler used to live in script.js (accountDelete) and
 * removed `users/<uid>` and then the sign-in account - nothing else. That left
 * `scenarios/<uid>`, which is readable and writable by that uid ONLY, so once
 * the account was gone nobody could ever read or delete it again; and every
 * copy the user had published under `sharedScenarios/`, still on offer to other
 * facilitators under the author's display name with no owner left to withdraw
 * it. script.js keeps only the on-click shim.
 *
 * Reads script.js top-level bindings by bare name, like the export above:
 * db, auth, currentUser, el, splashHintOk, splashHintErr, authErrorMessage,
 * resetStableId, closeAccountDialog.
 */

/* The published copies of this user's scenarios. Both writers - saveScenario()
   in script.js and the authoring tool - key them `<uid>_<scenarioId>`, so a KEY
   RANGE finds them. It is preferred to walking scenarios/<uid> because it also
   finds a published copy whose private original is already gone
   (deleteScenario()'s shared delete is best-effort).

   The ownerUid test is load-bearing, not tidiness: the rules let any signed-in
   user CREATE an entry under any key, so a stranger can park one inside this
   range. The owner cannot delete it, and the removal below is one update the
   rules accept or refuse WHOLE - unfiltered, one such entry would make this
   account undeletable.

   Two limits, both recorded in DPA Annex VI G8: the range is READ whole, a
   stranger's entries included; and an entry this user published under a key of
   any other form - which the shipped client never writes - is not found. */
function listOwnSharedScenarioIds(uid) {
  return db.ref("sharedScenarios").orderByKey()
    .startAt(uid + "_").endAt(uid + "_\uf8ff").once("value")
    .then(snap => {
      const ids = [];
      // A block body: forEach() stops at the first truthy return, and push()
      // returns the new length.
      snap.forEach(child => {
        if ((child.val() || {}).ownerUid === uid) ids.push(child.key);
      });
      return ids;
    });
}

/* Every database path that deleting an account removes: what is keyed by the
   account ALONE and writable by its owner. `sharedIds` come from
   listOwnSharedScenarioIds().

   NOT here, and the confirmation says so:
     - anything inside a session (pool entry, answers, votes, chat), or keyed
       by one (roster row, certificate, withdrawal record). Those belong to the
       session's record and follow ITS retention and erasure path. Some of them
       the owner COULD still delete while the session is open (the roster row,
       the pool entry); they are left by design, not because the rules forbid
       it. A withdrawal record must never go: deleting it un-withdraws consent.
     - reports/scenarios/<shareId>/<uid>. Write-once and unreadable by design -
       a report must not be retractable by its author - so no client can remove
       one. Nor can it remove the reports others filed against this user's
       scenarios, or a takedown tombstone, both keyed by `<uid>_<scenarioId>`.
     - rateLimits/uid/<uid>: increment-only counters. The retention job
       (scripts/cleanup-anonymous-accounts.js) sweeps them within about three
       days; the confirmation below says so.
   The reports need an operator (DPA Annex VI, G8). */
function accountDeletionPaths(uid, sharedIds) {
  return sharedIds.map(id => "sharedScenarios/" + id)
    .concat(["scenarios/" + uid, "users/" + uid]);
}

/* One deletion at a time. Without it a second click starts a second run whose
   Auth delete fails on the account the first run just removed - and the user
   is told "only the sign-in account is left" about an account that is gone. */
let _accountDeleteInFlight = false;

function deleteMyAccount() {
  const hint = el("account-action-hint");
  if (!currentUser || !auth || _accountDeleteInFlight) return;
  const ok = confirm(
    "Delete your account?\n\n" +
    "This permanently removes:\n" +
    "- your profile and your list of joined sessions;\n" +
    "- every scenario you authored, including any you published to the " +
    "shared library, which other facilitators will no longer be able to " +
    "pick.\n\n" +
    "It does NOT remove:\n" +
    "- sessions you created, or what you contributed inside any session: " +
    "the name you joined under, your answers, votes and chat messages, and " +
    "any roster entry (your name and email) or certificate. These stay in " +
    "the session's records, still identifiable as yours, for the periods " +
    "given in the privacy notice;\n" +
    "- moderation records (reports you filed about shared scenarios, and " +
    "any filed about yours).\n\n" +
    "Chat usage counters are deleted automatically within about three " +
    "days. To have the rest erased, write to the contact in the privacy " +
    "notice. To " +
    "withdraw research consent for a past session, do it from the list in " +
    "this dialog BEFORE deleting: that list is removed with the account.\n\n" +
    "This cannot be undone."
  );
  if (!ok) return;
  // Captured: `currentUser` is reassigned by every auth-state change.
  const user = currentUser;
  const uid = user.uid;
  _accountDeleteInFlight = true;
  splashHintOk(hint, "Deleting your account\u2026");
  // Two-step deletion: remove the account's data FIRST while we still have
  // write permission, then delete the Firebase Auth user. If the Auth deletion
  // fails (e.g. "requires-recent-login"), the data is gone but the user can
  // sign back in and try again - which is the lesser harm. Doing it in the
  // other order (Auth first) would leave orphan data nobody can write to:
  // scenarios/<uid> is readable and writable by that uid ONLY, so it would be
  // kept for ever, and the published copies would stay on offer under the
  // author's name with no owner left to withdraw them.
  let stage = "data";
  // Started inside the chain so that a SYNCHRONOUS throw from the query lands
  // in the catch below, with a message, instead of escaping the click.
  Promise.resolve().then(() => listOwnSharedScenarioIds(uid)).then(sharedIds => {
    const removals = {};
    accountDeletionPaths(uid, sharedIds).forEach(p => { removals[p] = null; });
    // ONE multi-path update, not a remove() per path: the rules are checked
    // per path but the write lands whole or not at all, so a refusal cannot
    // leave the account half-deleted - and "nothing was removed" below is true.
    return db.ref().update(removals);
  }).then(() => {
    stage = "auth";
    return user.delete();
  }).then(() => {
    stage = "done";
    _accountDeleteInFlight = false;
    splashHintOk(hint, "");
    // Same stale-identifier problem as sign-out, and more acute: the account
    // is gone, so its uid must not linger as this browser's stableId.
    resetStableId();
    closeAccountDialog();
    // onAuthStateChanged fires with null next; paintUserChip clears the chip
  }).catch(e => {
    _accountDeleteInFlight = false;
    if (stage === "data") {
      // Nothing was written, so the Auth account is deliberately left alone:
      // deleting it now would orphan exactly the data this failed to remove.
      console.warn("Account data delete failed; account left intact:", e);
      splashHintErr(hint, "Could not delete your account data, so nothing was " +
        "removed and your account is unchanged. Check your connection and " +
        "try again.");
    } else if (stage === "auth") {
      console.warn("Auth delete failed after data delete:", e);
      splashHintErr(hint, authErrorMessage(e) +
        " Your profile, history and scenarios have already been removed; only " +
        "the sign-in account is left. Sign back in and delete it again to " +
        "finish.");
    } else {
      // The account IS deleted; only the tidying-up after it threw. Saying
      // "could not delete" here would be false.
      console.warn("Account deleted; tidying up afterwards failed:", e);
    }
  });
}
