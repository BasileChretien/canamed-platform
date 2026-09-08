/* data-rights.js — the GDPR Art. 15 participant self-export (lazy chunk)
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
