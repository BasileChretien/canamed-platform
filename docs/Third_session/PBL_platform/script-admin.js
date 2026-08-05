/* script-admin.js — the FACILITATOR DASHBOARD engine (lazy chunk)
 *
 * SPLIT OUT OF script.js 2026-08-05. This is slice 2 ("Admin dashboard") of
 * ARCHITECTURE/eager-bundle-reclaim-plan.md, the largest single win that plan
 * prices. Everything here lives behind the facilitator password: the dashboard
 * itself (renderDashboard / renderPrestart / renderSidebar / the session
 * signal), stage control (startSession / setRoomStage / logAdminAction), the
 * facilitator debrief, manual points, help-call alerting, the impact report,
 * the session archive + close flow, and the admin shell (enterAdminApp /
 * startAdmin). A student never reaches any of it, and the SPLASH — the entry
 * view ~100% of users hit first — certainly never does.
 *
 * Loaded via CanamedLoader.ensureAdminApp(), from _enterAdminAppLazy() in
 * script.js — the ONE shim both admin routes pass through. There are exactly
 * two routes into the dashboard (joinAdmin, the password login; and
 * joinSuperAdmin, which also serves the post-create hand-off from
 * createSession() and the recovery-code reset), and both already ended with
 * the same `enterAdminApp(); startAdmin();` pair inside an existing promise
 * chain — so the load is a parallel leg of a chain that was already async, not
 * a new sync→async conversion. In joinAdmin it joins the Promise.all that
 * already fetches qrcode + case-content, per the plan's §5.5 "fetch in
 * parallel, never chained".
 *
 * script.js keeps NO copies (tests/admin-lazy-split.test.js pins that). It
 * keeps only THREE typeof-guarded references back into this chunk, all of them
 * unreachable unless an admin is already inside a room (so the chunk is
 * loaded): setRoomStage ×2 in initStageNav's prev/next handlers, and
 * backToDashboard in initLeave's leave handler — each behind `if (isRoomAdmin)`
 * and each degrading to a toast rather than a ReferenceError out of a click
 * handler. `typeof` on a not-yet-loaded classic script's function declaration
 * is safe (no TDZ); that is why the guards are written that way and why no
 * eager code may reference this chunk's top-level `let`/`const`.
 *
 * Deliberately a CLASSIC script, not an IIFE module — the same reasoning as
 * section-picker.js and takehome.js. This block reads a long list of script.js
 * top-level `let`/`const` bindings under their bare names (sessionNum, myName,
 * role, db, pool, allRooms, roomCount, started, myRoom, roomStage, isRoomAdmin,
 * joined, currentUser, refPool/refRooms/…, MODE, SUPERADMIN_KEY, …), and that
 * is EXACTLY the objection recorded against this split ("it reads N script.js
 * top-level bindings, none on window"). The objection is false: classic scripts
 * share the global script scope, so a top-level `let` in script.js is visible
 * here under its bare name exactly as it was before the move. No context object
 * was invented, nothing was rewritten to window.*, and the e2e specs that drive
 * these functions through page.evaluate keep working. The bindings sit in their
 * TDZ until script.js evaluates; this chunk only ever loads from an admin
 * login, long after that.
 *
 * THE ROOM BOUNDARY (the plan's §6 warning). The admin "Open room" control
 * crosses into the room engine: openRoomAsAdmin → enterRoom → startRoom →
 * renderStage, and closeSession → renderClosedState → renderStudentDebrief.
 * All of those are OUTBOUND — chunk → still-eager script.js — which is the safe
 * direction and needs no guard, because script.js has fully evaluated long
 * before this chunk loads. Slice 3 (the room engine) must therefore NOT assume
 * this slice made the room unreachable; when it moves, those edges become
 * chunk → chunk and the load ORDER starts to matter.
 *
 * What was deliberately LEFT EAGER, and why (see the plan's "a smaller,
 * correct reclaim beats a larger, broken one"):
 *   • renderLeaderboard — the plan lists it as an admin entry point, but its
 *     callers are startRoom, renderScore, renderButtons, buildDecision,
 *     _joinParticipantWireUp and wireLanguageSwitcher. It is a ROOM renderer
 *     the dashboard also calls, not an admin one.
 *   • closeMySession — reached from renderMySessions, i.e. the SPLASH's "My
 *     sessions" list, not the dashboard. It is a different surface behind a
 *     different click; folding it in would have meant a second choke point.
 *   • getTheme / setTheme (wireLanguageSwitcher), logEvent (reveal, castVote,
 *     addAnswer, … — the whole room), roomSlotBuckets (downloadMyData, the
 *     participant Art. 15 export), _debriefT / _debriefBucket and
 *     renderStudentDebrief / renderClosedState (the STUDENT debrief),
 *     downloadMyData, showLateBanner, stageNow — all genuinely shared with the
 *     room or splash. Moving any of them would have broken a student path to
 *     buy a few hundred bytes.
 *   • joinAdmin / joinSuperAdmin themselves — they are the choke points that
 *     LOAD this chunk, so they cannot live in it.
 *
 * The block below is moved VERBATIM and in its original order (the unit tests
 * that slice source text between two function anchors depend on that order).
 */

function enterAdminApp() {
  try { CanamedLoader.ensureAdminStyles().catch(function(){}); } catch (e) {}
  el("lobby").classList.add("hidden");
  el("admin-app").classList.remove("hidden");
  el("admin-mode-line").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum +
    " · " + myName + (MODE === "local" ? "  (local test mode)" : "");
  // the session code, always visible at the top of the admin dashboard so the
  // facilitator can read it aloud or copy it again for a late-joiner
  const codeNode = el("admin-session-code");
  if (codeNode) codeNode.textContent = sessionNum || "—";
  const copyBtn = el("admin-copy-code");
  const copyOk = el("admin-copy-ok");
  if (copyBtn && !copyBtn.dataset.wired) {
    copyBtn.dataset.wired = "1";
    copyBtn.addEventListener("click", () => {
      const code = (sessionNum || "").toUpperCase();
      const showOk = () => {
        if (!copyOk) return;
        copyOk.classList.remove("hidden");
        clearTimeout(copyBtn._t);
        copyBtn._t = setTimeout(() => copyOk.classList.add("hidden"), 1800);
      };
      const selectFallback = () => {
        // clipboard refused (e.g. insecure context) - fall back to selecting
        // the code so the facilitator can press Ctrl/Cmd-C themselves
        if (!codeNode) return;
        const range = document.createRange();
        range.selectNodeContents(codeNode);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(showOk).catch(selectFallback);
      } else {
        selectFallback();
      }
    });
  }
  el("header-right").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum;
  el("header-right").className = MODE === "shared" ? "mode-badge shared" : "mode-badge solo";
  if (role === "superadmin") {
    el("superadmin-card").classList.remove("hidden");
    el("change-session-input").value = sessionNum;
    el("purge-session-btn").addEventListener("click", () => {
      const target = (el("change-session-input").value || "").trim()
        .replace(/[^a-zA-Z0-9_-]/g, "");
      if (!target) return;
      if (!confirm("Permanently delete ALL data for Session " + target +
        " (names, rooms, answers, password)?\n\nThis cannot be undone. Make sure " +
        "you have downloaded the group answers first.")) return;
      db.ref(oPath(target, "")).remove().then(() => {
        el("purge-ok").textContent = "Purged Session " + target;
        flashSaved("purge-ok", 2500);
      }).catch(e => {
        console.error("Purge failed", e);
        alert("Could not purge Session " + target + " - check your connection and try again.");
      });
    });
  }
  focusHeading("admin-app");

  el("admin-leave-btn").addEventListener("click", () => {
    if (confirm("Leave the admin dashboard? You will return to the lobby.")) location.reload();
  });
  // Download archive (CSV / JSON) — replaces the old plain-text "Download all
  // group answers" button + its Markdown variant (2026-06-25, user request).
  const archCsvBtn = el("admin-archive-csv-btn");
  if (archCsvBtn && !archCsvBtn.dataset.wired) {
    archCsvBtn.dataset.wired = "1";
    archCsvBtn.addEventListener("click", () => downloadSessionArchive("csv"));
  }
  const archJsonBtn = el("admin-archive-json-btn");
  if (archJsonBtn && !archJsonBtn.dataset.wired) {
    archJsonBtn.dataset.wired = "1";
    archJsonBtn.addEventListener("click", () => downloadSessionArchive("json"));
  }
  initAdminToolsMenu();   // wire the "More tools ▾" dropdown (decluttered toolbar)
  const debriefBtn = el("admin-debrief-btn");
  if (debriefBtn && !debriefBtn.dataset.wired) {
    debriefBtn.dataset.wired = "1";
    debriefBtn.addEventListener("click", toggleDebrief);
  }
  // Admin-tools buttons — the report code lives in the lazy admin-tools.js
  // chunk; ensure it's loaded, then invoke. A brief toast covers the (usually
  // sub-second) load. (The lean menu keeps only the most-needed tools — the
  // Impact / Accreditation / Program / Item-difficulty / Cohort reports were
  // removed from the UI 2026-06-25; their generators remain in admin-tools.js.)
  const researchBtn = el("admin-research-btn");
  if (researchBtn && !researchBtn.dataset.wired) {
    researchBtn.dataset.wired = "1";
    researchBtn.addEventListener("click", () => runAdminTool("generateResearchExport"));
  }
  const researchCsvBtn = el("admin-research-csv-btn");
  if (researchCsvBtn && !researchCsvBtn.dataset.wired) {
    researchCsvBtn.dataset.wired = "1";
    researchCsvBtn.addEventListener("click", () => runAdminTool("generateResearchExportCSV"));
  }
  const rosterBtn = el("admin-roster-btn");
  if (rosterBtn && !rosterBtn.dataset.wired) {
    rosterBtn.dataset.wired = "1";
    rosterBtn.addEventListener("click", () => runAdminTool("generateEmailRoster"));
  }
  const attestBtn = el("admin-attest-btn");
  if (attestBtn && !attestBtn.dataset.wired) {
    attestBtn.dataset.wired = "1";
    attestBtn.addEventListener("click", () => runAdminTool("generateAttestations"));
  }
  const revokeBtn = el("admin-revoke-cert-btn");
  if (revokeBtn && !revokeBtn.dataset.wired) {
    revokeBtn.dataset.wired = "1";
    revokeBtn.addEventListener("click", () => runAdminTool("removeVerificationEntry"));
  }
  const closeBtn = el("admin-close-btn");
  if (closeBtn && !closeBtn.dataset.wired) {
    closeBtn.dataset.wired = "1";
    closeBtn.addEventListener("click", closeSession);
  }
  // Mute-alerts checkbox — restores from localStorage on render, writes
  // through on toggle. Idempotent against re-renders.
  const muteBox = el("admin-mute-alerts");
  if (muteBox && !muteBox.dataset.wired) {
    muteBox.dataset.wired = "1";
    muteBox.checked = isHelpAlertsMuted();
    muteBox.addEventListener("change", () => setHelpAlertsMuted(muteBox.checked));
  }
  // Theme picker — light / dark / auto. Persisted via setTheme() to
  // localStorage.canamed_theme and applied immediately on <html data-theme>;
  // theme-init.js reads the same key at page boot so a refresh keeps the choice.
  const themeSel = el("admin-theme-select");
  if (themeSel && !themeSel.dataset.wired) {
    themeSel.dataset.wired = "1";
    themeSel.value = getTheme();
    themeSel.addEventListener("change", () => setTheme(themeSel.value));
  }
  // Download error log — exposes the in-page telemetry buffer
  // (window.CanamedTelemetry from telemetry.js) as a downloadable
  // JSON file. Empty-buffer case: download is still produced (with
  // entries: []) so a postmortem reviewer can confirm "no errors
  // captured during this session" vs "no telemetry running".
  const errLogBtn = el("admin-error-log-btn");
  if (errLogBtn && !errLogBtn.dataset.wired) {
    errLogBtn.dataset.wired = "1";
    errLogBtn.addEventListener("click", () => {
      if (window.CanamedTelemetry && typeof window.CanamedTelemetry.download === "function") {
        window.CanamedTelemetry.download();
      } else {
        alert("Error-log capture is not available in this build.");
      }
    });
  }
  // Report a bug — opens the user's mail client with a pre-filled message
  // describing the session context + browser fingerprint + a hint to
  // attach the just-downloaded error log. Avoids putting the full
  // telemetry blob in the mailto URL (most mail clients clamp it to
  // ~2 KB), instead instructing the user to attach the file. We do NOT
  // transmit any data ourselves — the email is composed locally and the
  // user remains in control of what they send.
  const bugBtn = el("admin-bug-report-btn");
  if (bugBtn && !bugBtn.dataset.wired) {
    bugBtn.dataset.wired = "1";
    bugBtn.addEventListener("click", () => openBugReportMailto());
  }
  el("start-session-btn").addEventListener("click", startSession);
  el("advance-all-btn").addEventListener("click", () => {
    const summary = roomNames(roomCount).map(r => {
      const cur = (allRooms[r] && typeof allRooms[r].stage === "number") ? allRooms[r].stage : 0;
      // Preview the stage the room will ACTUALLY land on: a branched flow skips
      // stage 2, so cur+1 could name a stage that is never shown.
      const nxt = adjacentStage(cur, 1);
      // stageLabel(), not STAGE_LABELS[]: the preview must name the ACTIVE
      // scenario's modules, or a respiratory-stewardship session still reads
      // "Module A - Chronic Pain" in the confirm dialog.
      return r + ": " + stageLabel(cur) +
        (nxt !== cur ? "  →  " + stageLabel(nxt) : "  (already last)");
    }).join("\n");
    canamedConfirm({
      title: (window.t ? window.t("modal.advance-all.title") : "Advance all rooms?"),
      message: (window.t ? window.t("modal.advance-all.message") :
        "Every room will move forward by one stage. Per-room preview below:"),
      detail: summary,
      okLabel: (window.t ? window.t("modal.advance-all.ok") : "Advance all")
    }).then(ok => {
      if (!ok) return;
      roomNames(roomCount).forEach(r => {
        const cur = (allRooms[r] && typeof allRooms[r].stage === "number") ? allRooms[r].stage : 0;
        const nxt = adjacentStage(cur, 1);
        if (nxt !== cur) setRoomStage(r, cur, nxt);
      });
    });
  });
  el("save-teams-btn").addEventListener("click", () => {
    const val = (el("teams-link-input").value || "").trim();
    db.ref(sPath("teamsLink")).set(val)
      .then(() => { flashSaved("teams-saved-ok"); saveLastWorkshop({ teamsLink: val || null }); })
      .catch(e => {
        console.error("Save Teams link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  el("save-quiz-btn").addEventListener("click", () => {
    const val = (el("quiz-link-input").value || "").trim();
    db.ref(sPath("questionnaireLink")).set(val)
      .then(() => { flashSaved("quiz-saved-ok"); saveLastWorkshop({ questionnaireLink: val || null }); })
      .catch(e => {
        console.error("Save questionnaire link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  const savePreQuizBtn = el("save-prequiz-btn");
  if (savePreQuizBtn) savePreQuizBtn.addEventListener("click", () => {
    const val = (el("prequiz-link-input").value || "").trim();
    db.ref(sPath("preQuestionnaireLink")).set(val)
      .then(() => { flashSaved("prequiz-saved-ok"); saveLastWorkshop({ preQuestionnaireLink: val || null }); })
      .catch(e => {
        console.error("Save pre-questionnaire link failed", e);
        alert("Could not save the link - check your connection and try again.");
      });
  });
  el("change-pass-btn").addEventListener("click", () => {
    const np = el("change-pass-input").value;
    const targetSession = (el("change-session-input").value || "").trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");
    if (!np || !targetSession) return;
    const recoveryEl = el("change-recovery-input");
    // Normalise (trim + lowercase) — the recovery alphabet is lowercase.
    const recoveryCode = recoveryEl ? (recoveryEl.value || "").trim().toLowerCase() : "";
    // D21 recovery: pre-provisioning a NEW session number (no hash yet) needs
    // no code — the rule's !data.exists() branch allows it. OVERWRITING an
    // existing session's password requires that session's recovery code: the
    // rule gates _superadminReset on the code matching the unreadable
    // /recovery/.../code, and the hash overwrite on a fresh _superadminReset.
    hashPassword(np, targetSession)
      .then(h => {
        // FINDING-07: legacy path stores the real hash in unreadable
        // adminSecrets/<code>/hash + a readable random marker; the readable
        // marker's existence decides initial-set vs reset.
        const legacy = useAdminSecrets();
        const refMarker = db.ref(oPath(targetSession, "adminPasswordHash"));
        const refSecret = legacy ? db.ref(adminSecretPath(targetSession, "hash")) : refMarker;
        return refMarker.once("value").then(snap => {
          // snap.val() == null (NOT snap.exists()) for LOCAL-mode LocalDB
          // compatibility (no .exists() there); equivalent on Firebase.
          if (snap.val() == null) {
            // initial set / pre-provision a new session number — no code needed
            return legacy
              ? Promise.all([refSecret.set(h), refMarker.set(randomAdminMarker())])
              : refSecret.set(h);
          }
          // OVERWRITE an existing session's password — requires that session's
          // recovery code (the rule gates _superadminReset on it). Validate it
          // is non-empty client-side for a clear message vs a bare denial.
          if (!recoveryCode) {
            const err = new Error("recovery-code-required");
            err._canamedRecovery = true;
            throw err;
          }
          const refReset = db.ref(oPath(targetSession, "_superadminReset"));
          // ServerValue.TIMESTAMP (R3-D1) so a skewed client clock still
          // passes the rule's ±5s freshness window; Date.now() fallback for
          // non-Firebase test contexts.
          const TS = (typeof firebase !== "undefined" &&
            firebase.database && firebase.database.ServerValue &&
            firebase.database.ServerValue.TIMESTAMP) || Date.now();
          return refReset.set({ requestedAt: TS, by: myName || "superadmin", code: recoveryCode, uid: (currentUser && currentUser.uid) })
            .then(() => refSecret.set(h))
            .then(() => refReset.remove())
            .catch(err => {
              try { refReset.remove(); } catch (_) {}
              const code = (err && (err.code || err.message)) || "";
              if (/permission_denied|denied/i.test(String(code))) err._canamedRecovery = true;
              throw err;
            });
        });
      })
      .then(() => {
        el("change-pass-input").value = "";
        if (recoveryEl) recoveryEl.value = "";
        const ok = el("change-pass-ok");
        ok.textContent = "Saved for Session " + targetSession;
        flashSaved("change-pass-ok", 2000);
      }).catch(e => {
      console.error("Set password failed", e);
      if (e && e._canamedRecovery) {
        alert(tFallback("lobby.superadmin.bad-recovery",
          "That recovery code doesn't match this session. Check the code you saved when the session was created."));
      } else {
        alert("Could not save the password - check your connection and try again.");
      }
    });
  });
  el("sidebar-dashboard-btn").addEventListener("click", backToDashboard);
}

/* Audible + title-bar alert when a room raises a NEW un-acknowledged call -
   a floating prof watching other rooms would otherwise miss a silent badge. */
let prevCallRooms = {};
let baseTitle = document.title;
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch (e) { /* audio not available - silent */ }
}
function checkCallAlerts() {
  // Title-bar counter only — the actual audible + desktop alert path
  // goes through maybeAlertHelpCall() inside renderDashboard(), which
  // de-duplicates per-room by the call's `at` timestamp. Previously
  // this function also fired beep() on `isNew`, which double-alerted
  // (chime from here + chime from maybeAlertHelpCall) on every other
  // room joining the calling set. Security/UX audit caught it.
  const calling = {};
  Object.keys(allRooms).forEach(r => {
    const c = allRooms[r] && allRooms[r].callForHelp;
    if (c && !c.ack) calling[r] = true;
  });
  prevCallRooms = calling;
  const n = Object.keys(calling).length;
  document.title = n > 0 ? "(" + n + ") " + baseTitle : baseTitle;
}

function startAdmin() {
  // Reset the sticky-presence view (otherwise an admin re-entering the
  // dashboard after switching sessions would see students from the
  // previous session as "gone").
  adminSeenPool = {};
  refStarted = db.ref(sPath("started"));
  refRoomCount = db.ref(sPath("roomCount"));
  refPool = db.ref(sPath("pool"));
  refRooms = db.ref(sPath("rooms"));
  // Preload the admin-readable certIds map (published cert id per participant) so
  // the SYNCHRONOUS participant-row + research-CSV builders can source each id
  // from window._certIdByCid[cid] — the id is now crypto-random and cannot be
  // recomputed. A LIVE listener keeps it fresh as certs are downloaded during
  // wrap-up (a one-shot read at dashboard-open would be empty and never update).
  // Admin-only read; a denied read (e.g. before the password proof) just leaves
  // the map empty → "" ids, and never throws.
  window._certIdByCid = window._certIdByCid || {};
  refCertIds = db.ref(certIdBasePath(sessionNum));
  refCertIds.on("value", function (snap) { window._certIdByCid = snap.val() || {}; },
    function () { /* read denied → leave the map empty */ });
  refTeams = db.ref(sPath("teamsLink"));
  refQuiz = db.ref(sPath("questionnaireLink"));
  refPreQuiz = db.ref(sPath("preQuestionnaireLink"));
  // closed marker - so the admin's "End session" button reflects state even if
  // the session was already closed (e.g. by a second facilitator re-opening
  // the dashboard later to re-download the archive)
  db.ref(sPath("closed")).on("value", snap => {
    const closed = snap.val();
    renderClosedState(closed);
    const btn = el("admin-close-btn");
    if (btn && closed) {
      btn.textContent = "Session closed ✓ — re-download archive";
      btn.classList.add("done");
    }
  });

  refRoomCount.on("value", snap => {
    roomCount = snap.val() || 4;
    if (!started) el("roomcount-input").value = String(roomCount);
  });
  refStarted.on("value", snap => {
    started = !!snap.val();
    el("admin-prestart").classList.toggle("hidden", started);
    el("admin-dashboard").classList.toggle("hidden", !started);
    // Reveal the destructive End-session button only once the session has
    // actually started (it's hidden in HTML by default). If the session
    // gets closed and re-opened the listener will toggle this back on.
    const endBtn = el("admin-close-btn");
    if (endBtn) endBtn.hidden = !started;
    // First-time admin-dashboard onboarding tour. Defer so the dashboard
    // has had time to render at least once (anchor elements need to be
    // measurable for getBoundingClientRect). The tour is gated by its
    // own localStorage key (canamed_tour_admin_done) and is independent
    // of the create-session tour version.
    if (started && window.CanamedTour && !window.CanamedTour.isDone("admin")) {
      setTimeout(() => {
        const dash = el("admin-dashboard");
        if (dash && !dash.classList.contains("hidden") &&
            !window.CanamedTour.isDone("admin")) {
          try { window.CanamedTour.start("admin"); } catch (e) { console.warn("admin tour failed", e); }
        }
      }, 600);
    }
  });
  refPool.on("value", snap => {
    pool = snap.val() || {};
    renderPrestart();
    wireExpectedTotal();    // idempotent — wires on first render, no-op after
    wireTestAlertsBtn();    // ditto
    if (debriefVisible) renderDebrief();
  });
  // the rooms subtree changes on every presence / answer / stage write across
  // every room - debounce the (heavy) dashboard rebuild so a burst of writes
  // collapses into one render; call alerts stay immediate (a missed beep is
  // worse than a 400ms-stale badge).
  //
  // BUT: facilitators reported that the per-room score chip and the cohort
  // leaderboard felt sluggish ("not updating in real time"). The 400ms
  // debounce was kicked further every time presence / typing churned, so a
  // score event could be hidden for far longer than 400ms in a busy room.
  // Fix: compute a cheap score signature on every snapshot; when it changes
  // we bypass the debounce and render immediately. Non-score churn still
  // collapses into the debounced render.
  let dashRenderTimer = null;
  let prevScoreSig = "";
  function _scoreSignature(rooms) {
    // Stable string of (room → auto/manual/penalty totals). Cheap enough to
    // run on every refRooms tick — O(rooms * scoreKeys) — and changes iff
    // any score node was added / removed / re-pointed.
    const out = [];
    Object.keys(rooms || {}).sort().forEach(r => {
      const s = (rooms[r] && rooms[r].score) || {};
      let a = 0, m = 0, p = 0;
      const sa = s.auto || {}, sm = s.manual || {}, sp = s.penalties || {};
      Object.keys(sa).forEach(k => { a += (sa[k] && sa[k].points) || 0; });
      Object.keys(sm).forEach(k => { m += (sm[k] && sm[k].points) || 0; });
      Object.keys(sp).forEach(k => { p += (sp[k] && sp[k].points) || 0; });
      out.push(r + ":" + a + "/" + m + "/" + p);
    });
    return out.join("|");
  }
  function _flushDashRender() {
    clearTimeout(dashRenderTimer); dashRenderTimer = null;
    renderDashboard(); renderSidebar(); renderLeaderboard();
    if (debriefVisible) renderDebrief();
  }
  refRooms.on("value", snap => {
    allRooms = snap.val() || {};
    checkCallAlerts();
    const sig = _scoreSignature(allRooms);
    if (sig !== prevScoreSig) {
      // A score (auto / manual / penalty) changed somewhere — operators
      // expect the leaderboard chip to move instantly. Skip the debounce.
      prevScoreSig = sig;
      _flushDashRender();
      return;
    }
    clearTimeout(dashRenderTimer);
    dashRenderTimer = setTimeout(_flushDashRender, 400);
  });
  // keep the "minutes in stage" timers fresh even when nothing changes
  setInterval(() => {
    if (started) { renderDashboard(); renderSidebar(); }
  }, 30000);

  // D22 (SIMULATION_EDGE_CASES.md): admin presence heartbeat. Writes a
  // {by, at} stamp to _adminPresence every 30s and clears it via
  // onDisconnect, so students can detect a facilitator who closed the
  // browser without ending the session and show a "facilitator may be
  // offline" hint. The interval starts immediately on dashboard entry
  // (well before `started` flips true) so a forgotten password / dead
  // tab pre-start is also visible to anyone in the lobby.
  try {
    const refAdminPresence = db.ref(sPath("_adminPresence"));
    const writePresence = () => {
      try { refAdminPresence.set({ by: myName || "facilitator", at: Date.now() }); }
      catch (e) { /* offline / closed — non-fatal */ }
    };
    try { refAdminPresence.onDisconnect().remove(); } catch (e) {}
    writePresence();
    setInterval(writePresence, 30000);
  } catch (e) { console.warn("Admin presence heartbeat failed to start", e); }
  refTeams.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("teams-link-input")) el("teams-link-input").value = v;
  });
  refQuiz.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("quiz-link-input")) el("quiz-link-input").value = v;
  });
  refPreQuiz.on("value", snap => {
    const v = snap.val() || "";
    if (document.activeElement !== el("prequiz-link-input")) el("prequiz-link-input").value = v;
  });
}

/* Per-cohort live count for the waiting room — see lib.js for the pure
   computation. Renders as chips in renderPrestart() below. */

/* Persisted facilitator hint: how many students were expected in this
   session. Local-only (per-browser, per-session), never written to the
   DB — it's a personal anxiety reducer, not session state. */
const EXPECTED_TOTAL_KEY_PREFIX = "canamed_expected_";
function getExpectedTotalFor(code) {
  if (!code) return null;
  try {
    const raw = localStorage.getItem(EXPECTED_TOTAL_KEY_PREFIX + code);
    const n = parseInt(raw, 10);
    return (isFinite(n) && n > 0 && n <= 500) ? n : null;
  } catch (e) { return null; }
}
function setExpectedTotalFor(code, n) {
  if (!code) return;
  // Inline try/catch on each call so the storage-guard test (E30 in
  // edge-cases.test.js) can detect the guard via simple brace-balance —
  // a try wrapping an if/else is logically equivalent but the walker
  // only matches the immediately-enclosing try.
  if (n == null || n === "" || !isFinite(n) || n <= 0) {
    try { localStorage.removeItem(EXPECTED_TOTAL_KEY_PREFIX + code); } catch (e) {}
  } else {
    try { localStorage.setItem(EXPECTED_TOTAL_KEY_PREFIX + code, String(Math.min(500, Math.floor(n)))); } catch (e) {}
  }
}

/* ── Admin sticky-presence view (2026-05-18 user report:
 * "Frequently as an admin I cannot see which students are connected.
 *  I think that this is caused by how the website checks it.")
 *
 * Root cause: Firebase's onDisconnect().remove() fires after a 60-90s
 * WebSocket silence. On a typical workshop where students are on phones,
 * normal events — screen lock, tab background, cellular handoff,
 * brief network drop — trigger that disconnect handler. The student's
 * pool entry is removed, the admin's refPool listener fires with the
 * updated pool (student missing), and renderPrestart shows the student
 * VANISHED. When the student reconnects 20s later they re-appear.
 *
 * From the admin's viewpoint the waiting list FLICKERS — students
 * appear and disappear with no clear signal whether they actually left
 * or just had a brief network hiccup.
 *
 * Fix: smooth the admin's view client-side. We keep a per-session
 * "ever-seen" map of every cid that has been in the pool at any point.
 * Each entry carries (a) the LATEST data snapshot, (b) when we last
 * saw them in a live pool snapshot, (c) a status — online / blip /
 * gone — derived from that age. The admin's waiting list shows ALL
 * ever-seen entries with a colour-coded status dot, plus a manual
 * remove button for entries that are truly gone. */
const ADMIN_PRESENCE_BLIP_MS = 30_000;    // ≤30s gap = probably a network blip
const ADMIN_PRESENCE_GONE_MS = 120_000;   // >2min gap = treat as truly gone
let adminSeenPool = {};                   // cid → { entry, lastSeenAt }
let _adminPresenceRefreshTimer = null;

function adminPresenceStatus(cid) {
  const seen = adminSeenPool[cid];
  if (!seen) return "gone";
  if (pool[cid]) return "online";   // present in the current live snapshot
  const age = Date.now() - seen.lastSeenAt;
  if (age < ADMIN_PRESENCE_BLIP_MS) return "online";   // tolerant of micro-gaps
  if (age < ADMIN_PRESENCE_GONE_MS) return "blip";
  return "gone";
}

function adminRemoveStudent(cid) {
  if (!cid) return;
  const seen = adminSeenPool[cid];
  const nm = (seen && seen.entry && seen.entry.name) || cid;
  if (typeof confirm === "function" && !confirm(
    "Remove " + nm + " from the waiting list? They'll have to rejoin if they come back."
  )) return;
  // Best-effort: clear from Firebase if their entry still exists, AND
  // wipe the local sticky record so the admin's view stops showing them.
  if (refPool) refPool.child(cid).remove().catch(e => console.error("admin remove failed", e));
  delete adminSeenPool[cid];
  renderPrestart();
}

/* Periodically re-render the prestart list so age-based status
 * transitions (online→blip→gone) happen even when no new Firebase
 * snapshot has arrived. */
function _scheduleAdminPresenceRefresh() {
  if (_adminPresenceRefreshTimer) return;
  _adminPresenceRefreshTimer = setInterval(() => {
    if (typeof renderPrestart === "function" && el("prestart-list")) renderPrestart();
  }, 15_000);
}

function renderPrestart() {
  // Update the sticky "ever-seen" map from the current pool snapshot,
  // BEFORE we compute the visible list. Every cid present in pool[]
  // refreshes its lastSeenAt; cids present in adminSeenPool but absent
  // from pool[] keep their old lastSeenAt and age into blip/gone.
  const now = Date.now();
  Object.keys(pool || {}).forEach(cid => {
    if (!pool[cid]) return;
    const prev = adminSeenPool[cid];
    adminSeenPool[cid] = {
      entry: pool[cid],
      lastSeenAt: now,
      firstSeenAt: (prev && prev.firstSeenAt) || now
    };
  });
  _scheduleAdminPresenceRefresh();

  // The "live count" in the header is the count of TRULY-ONLINE
  // students (pool snapshot intersection); the visible list below
  // includes blip + gone so the admin doesn't lose sight of who joined.
  const onlineNow = Object.keys(pool || {}).filter(cid => !!pool[cid]);
  const waiting = onlineNow.map(cid => pool[cid]);
  el("prestart-count").textContent = waiting.length;
  // expected-total chip "(of 30)" — read from localStorage, updated by
  // the input change handler in wireExpectedTotal()
  const expNode = el("prestart-expected");
  const expected = getExpectedTotalFor(sessionNum);
  if (expNode) {
    if (expected) {
      expNode.textContent = "/ " + expected;
      expNode.classList.remove("hidden");
      expNode.classList.toggle("full", waiting.length >= expected);
    } else {
      expNode.textContent = "";
      expNode.classList.add("hidden");
      expNode.classList.remove("full");
    }
  }
  // Cohort split chips ("Caen: 14 · Nagoya: 16"). Always shown when at
  // least one person has joined; uses the COHORTS registry for labels +
  // colours so additional partnerships get correct visuals for free.
  const cohortRow = el("prestart-cohort-row");
  if (cohortRow) {
    cohortRow.innerHTML = "";
    if (waiting.length > 0 && typeof COHORTS !== "undefined" && COHORTS) {
      const counts = computeCohortCounts(waiting, COHORTS);
      COHORTS.forEach(c => {
        const chip = document.createElement("span");
        chip.className = "prestart-cohort-chip";
        chip.setAttribute("data-cohort", c.id);
        const dot = document.createElement("span");
        dot.className = "prestart-cohort-chip-dot";
        if (c.color) dot.style.background = c.color;
        chip.appendChild(dot);
        const label = document.createElement("span");
        label.textContent = (c.short || c.id) + ": ";
        chip.appendChild(label);
        const num = document.createElement("span");
        num.className = "prestart-cohort-chip-count";
        num.textContent = String(counts[c.id] || 0);
        chip.appendChild(num);
        cohortRow.appendChild(chip);
      });
      if (counts.__other__) {
        const chip = document.createElement("span");
        chip.className = "prestart-cohort-chip";
        chip.setAttribute("data-cohort", "__other__");
        const dot = document.createElement("span");
        dot.className = "prestart-cohort-chip-dot";
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode("Other: " + counts.__other__));
        cohortRow.appendChild(chip);
      }
    }
  }
  const list = el("prestart-list");
  list.innerHTML = "";
  // Render every cid we've EVER seen during this session, not just the
  // ones in the current live pool snapshot. This is the sticky-presence
  // view that prevents the admin from losing sight of students during
  // network blips.
  const allCids = Object.keys(adminSeenPool);
  if (allCids.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No one has joined yet.";
    list.appendChild(p);
    return;
  }
  allCids
    .map(cid => ({ cid: cid, entry: adminSeenPool[cid].entry,
                    seen: adminSeenPool[cid] }))
    .sort((a, b) => (a.entry.name || "").localeCompare(b.entry.name || ""))
    .forEach(({ cid, entry, seen }) => {
      const status = adminPresenceStatus(cid);
      const chip = makeChip(entry.name,
        entry.name + "  ·  " + entry.university +
        "  ·  Year " + entry.year + "  ·  English " + entry.english,
        "prestart-person prestart-person-" + status);
      // Status dot — colour-coded by online/blip/gone state.
      const dot = document.createElement("span");
      dot.className = "prestart-status-dot prestart-status-dot-" + status;
      dot.setAttribute("aria-hidden", "true");
      chip.insertBefore(dot, chip.firstChild);
      // Status label for screen readers + a small visible age tag for
      // blip/gone states so the admin knows HOW long someone's been
      // missing without having to click them.
      if (status !== "online") {
        const ageMs = Date.now() - seen.lastSeenAt;
        const ageS = Math.round(ageMs / 1000);
        const ageStr = ageS < 60 ? ageS + "s" : Math.round(ageS / 60) + "m";
        const ageEl = document.createElement("span");
        ageEl.className = "prestart-status-age";
        ageEl.textContent = (status === "blip" ? "away " : "offline ") + ageStr;
        chip.appendChild(ageEl);
        // Manual remove button — only shown on truly-gone entries so
        // the admin doesn't accidentally drop someone whose phone just
        // blipped.
        if (status === "gone") {
          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "prestart-remove-btn";
          rm.title = "Remove this student from the waiting list";
          rm.setAttribute("aria-label", "Remove " + entry.name);
          rm.textContent = "×";
          rm.addEventListener("click", e => {
            e.stopPropagation();
            adminRemoveStudent(cid);
          });
          chip.appendChild(rm);
        }
      }
      const aria = chip.getAttribute("aria-label") || entry.name;
      chip.setAttribute("aria-label", aria + " — " + status);
      list.appendChild(chip);
    });
}

/* Wire the "Expected total" input on first render. Local-only (per-browser
   key), so two facilitators sharing a session can each have their own
   target without colliding. */
function wireExpectedTotal() {
  const inp = el("prestart-expected-input");
  if (!inp || inp.dataset.wired === "1") return;
  inp.dataset.wired = "1";
  const cur = getExpectedTotalFor(sessionNum);
  if (cur) inp.value = String(cur);
  inp.addEventListener("input", () => {
    const v = inp.value.trim();
    if (v === "") { setExpectedTotalFor(sessionNum, null); }
    else {
      const n = parseInt(v, 10);
      if (isFinite(n) && n >= 0) setExpectedTotalFor(sessionNum, n);
    }
    renderPrestart();
  });
}

/* Wire the pre-start "Test alerts" button. Pre-arms the AudioContext
   (Chrome's autoplay-on-no-interaction rule needs a user gesture before
   any audio can play, including the help-call chime) AND deliberately
   triggers the Notification permission prompt now, rather than during
   the first real help call. */
function wireTestAlertsBtn() {
  const btn = el("test-alerts-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  const status = el("test-alerts-status");
  const setStatus = (msg, isErr) => {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("err", !!isErr);
  };
  btn.addEventListener("click", () => {
    setStatus("");
    // 1. Audio: pre-arm the Web Audio context with a user gesture.
    let audioOk = false;
    try {
      if (typeof helpCallChime === "function") helpCallChime();
      audioOk = true;
    } catch (e) { audioOk = false; }
    // 2. Notifications: request permission proactively. The browser
    //    only prompts once per origin; subsequent clicks reuse the
    //    decision, so this is idempotent.
    if (typeof Notification === "undefined") {
      setStatus(window.t ? window.t("admin.test-alerts.ok-noperm") :
        "Chime played. Desktop notifications are not supported in this browser.",
        false);
      return;
    }
    const finish = (perm) => {
      const ok = window.t ? window.t("admin.test-alerts.ok") :
        "Chime played. Desktop notifications enabled.";
      const denied = window.t ? window.t("admin.test-alerts.denied") :
        "Chime played, but desktop notifications are blocked. Check your browser settings.";
      const noaudio = window.t ? window.t("admin.test-alerts.noaudio") :
        "Audio was blocked by the browser — click anywhere on the page first, then try again.";
      if (!audioOk) { setStatus(noaudio, true); return; }
      if (perm === "granted") {
        setStatus(ok, false);
        // Fire one real notification so the facilitator sees what it
        // looks like (auto-close after 4s so it doesn't linger).
        try {
          const n = new Notification("CaNaMED — alerts armed", {
            body: "Help-call notifications are now enabled for this tab.",
            tag: "canamed-test-alerts"
          });
          setTimeout(() => { try { n.close(); } catch (e) {} }, 4000);
        } catch (e) {}
      } else if (perm === "denied") {
        setStatus(denied, true);
      } else {
        // "default" — user dismissed without choosing
        setStatus(audioOk ? (window.t ? window.t("admin.test-alerts.dismissed") :
          "Chime played. Notifications prompt was dismissed — click Test alerts again to retry.") : noaudio,
          true);
      }
    };
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      finish(Notification.permission);
    } else {
      try {
        Notification.requestPermission().then(finish).catch(() => finish("default"));
      } catch (e) { finish("default"); }
    }
  });
}

/* Append-only audit log for admin actions. Each entry is a push-id'd
   record under {org-prefix}/sessions/{code}/audit/. Best-effort: if the
   write fails (network / rules), we don't block the underlying action. */
function logAdminAction(kind, payload) {
  if (typeof db === "undefined" || !db || typeof sessionNum !== "string" || !sessionNum) return;
  try {
    const envelope = {
      kind: String(kind || "").slice(0, 30),
      by: (typeof myName === "string" ? myName : "Admin").slice(0, 40),
      at: Date.now()
    };
    if (payload && typeof payload === "object") {
      try {
        const s = JSON.stringify(payload).slice(0, 500);
        envelope.payload = s;
      } catch (e) { /* unserialisable payload — skip it */ }
    }
    db.ref(sPath("audit")).push(envelope)
      .catch(e => console.warn("audit log write failed", kind, e && e.message));
  } catch (e) { console.warn("audit log helper failed", e); }
}

/* Append-only EVENT log for participant-side state changes (Phase 1 of the
   event-sourcing design — see ARCHITECTURE/EVENT_SOURCING_DESIGN.md). Each
   call writes one record under {org-prefix}/sessions/{code}/rooms/{room}/events/.
   Same envelope shape as the admin audit log, but writable by any
   authenticated participant (not just admins). */
function startSession() {
  const rc = parseInt(el("roomcount-input").value, 10) || 4;
  refPool.once("value").then(snap => {
    const poolNow = snap.val() || {};
    const arr = Object.keys(poolNow).map(cid => Object.assign({ clientId: cid }, poolNow[cid]));
    if (arr.length === 0) {
      alert("No one has joined the waiting room yet - wait for participants before starting.");
      return;
    }
    const checkRoomCount = () => {
      if (rc <= arr.length) return Promise.resolve(true);
      return canamedConfirm({
        title: (window.t ? window.t("modal.start.too-many-rooms-title") :
          "More rooms than participants"),
        message: (window.t ? window.t("modal.start.too-many-rooms-message") :
          "You have " + arr.length + " participant(s) but " + rc +
          " rooms. Some rooms will be empty or very small. Start anyway?"),
        okLabel: (window.t ? window.t("modal.start.ok") : "Start anyway")
      });
    };
    checkRoomCount().then(okRooms => {
      if (!okRooms) return;
      const assignment = assignRooms(arr, rc);
      // flag rooms that are tiny or single-university so the prof can rebalance
      const byRoom = {};
      Object.keys(assignment).forEach(cid => {
        (byRoom[assignment[cid]] = byRoom[assignment[cid]] || []).push(poolNow[cid]);
      });
      const weak = Object.keys(byRoom).sort().filter(r => {
        const m = byRoom[r];
        return m.length < 3 || new Set(m.map(p => p.university)).size < 2;
      });
      const checkBalance = () => {
        if (!weak.length) return Promise.resolve(true);
        return canamedConfirm({
          title: (window.t ? window.t("modal.start.weak-rooms-title") :
            "Some rooms are unbalanced"),
          message: (window.t ? window.t("modal.start.weak-rooms-message") :
            "These rooms are small or single-university:\n" + weak.join(", ") +
            "\n\nThe goal is mixed Franco-Japanese groups. Start anyway?"),
          okLabel: (window.t ? window.t("modal.start.ok") : "Start anyway")
        });
      };
      checkBalance().then(okBalance => {
        if (!okBalance) return;
        // Single atomic multi-path write: every room assignment + roomCount +
        // started commit together, or not at all. The old code wrote each
        // room separately and only set `started` AFTER all of them resolved —
        // so one transient write blip rejected Promise.all and left the
        // session half-started (rooms assigned but `started` never set, so the
        // facilitator stayed stuck on the waiting room). One update() is also
        // a single round-trip, far less exposed to a connection blip.
        const updates = { roomCount: rc, started: true };
        Object.keys(assignment).forEach(cid => {
          updates["pool/" + cid + "/room"] = assignment[cid];
        });
        db.ref(sPath("")).update(updates).then(() => {
          // Remember this session's room count so the next "Clone last
          // workshop" includes it as a default.
          saveLastWorkshop({ roomCount: rc });
        }).catch(e => {
          console.error("Start session failed", e);
          alert("Could not start the session (connection issue) - some participants " +
            "may not be placed in rooms. Check the dashboard and press Start again; " +
            "it is safe to retry.");
        });
      });
    });
  }).catch(e => {
    console.error("Start session failed", e);
    alert("Could not start the session (connection issue) - some participants " +
      "may not be placed in rooms. Check the dashboard and press Start again; " +
      "it is safe to retry.");
  });
}

function setRoomStage(r, from, to) {
  to = Math.max(0, Math.min(lastStage(), to));
  // Honour the scenario's stage flow (branched skips stage 2). Every advance
  // call site passes to = from ± 1, so this one guard covers them all.
  to = snapStageToFlow(to, from);
  // Plain read-then-set, NOT a transaction: RTDB .transaction() does a
  // client-side rule pre-check against the LOCAL cache, but the admin-identity
  // write rule (Phase 4a) references the unreadable adminSecrets/proof node, so
  // a legitimate admin's advance would be rejected client-side before reaching
  // the server. A .set() is evaluated server-side (full data access) and works
  // for both the creator and a proved-password co-facilitator. The from-guard
  // keeps the "another admin already moved this room" check (best-effort;
  // last-write-wins is benign for a stage counter).
  const stageRef = db.ref(sPath("rooms/" + r + "/stage"));
  stageRef.once("value").then(snap => {
    const c = typeof snap.val() === "number" ? snap.val() : 0;
    if (from != null && c !== from) return null;   // conflict — another admin moved it
    if (c === to) return null;                      // no-op, nothing to write
    return stageRef.set(to).then(() => {
      db.ref(sPath("rooms/" + r + "/stageAt")).set(Date.now());
      logAdminAction("room.stage", { room: r, from: from, to: to });
      logEvent(r, "stage", { room: r, from: from, to: to });
    });
  }).catch(e => {
    console.error("Stage change failed for " + r, e);
    alert("Could not change the stage for " + r + " - check your connection and try again.");
  });
}
/* approximate planned minutes per stage, for the dashboard "over time" cue */
/* Approximate planned minutes, for the dashboard "over time" cue. S1b: keyed by
   ROLE and section TYPE, not by stage index — a stage number no longer tells you
   what is running on it. */
const STAGE_MINUTES_BY_ROLE = { welcome: 20, wrapup: 15,
                                pbl: 40, roleplay: 40, branched: 30 };
function stageMinutes(st) {
  if (st === 0) return STAGE_MINUTES_BY_ROLE.welcome;
  if (st === lastStage()) return STAGE_MINUTES_BY_ROLE.wrapup;
  const slot = slotAtStage(st);
  return (slot && STAGE_MINUTES_BY_ROLE[slot.type]) || 99;
}
function roomProgress(data) {
  /* Summed across the session's slots: a room may run two PBL sections, and the
     facilitator wants the room's total, not slot 1's. */
  const buckets = roomSlotBuckets(data);
  let found = 0, answered = 0;
  buckets.forEach(b => {
    found += Object.keys(b.revealed).length;
    answered += Object.keys(b.answers).length;
  });
  const cap = ITEM_IDS.length * Math.max(1, buckets.filter(b => b.type === "pbl").length);
  return "findings " + found + "/" + cap + " · answers " + answered;
}

/* Live participation equity for the facilitator dashboard. Returns how many
 * of the students PRESENT in the room have actually CONTRIBUTED a substantive
 * artefact (a group answer or a working hypothesis — both tagged with the
 * author's clientId via `cid`). Lets the lead facilitator spot a room where
 * one or two students are carrying the group while others stay silent, and
 * intervene mid-session rather than discover it in the transcript afterwards.
 *   present     = clientIds with a presence record
 *   contributing = present clientIds that authored >= 1 answer/hypothesis
 *   quiet        = present but never contributed (the students to nudge) */
/* Gini coefficient of a list of non-negative values (0 = perfectly even,
 * → 1 = one person holds everything). Used to summarise how evenly the
 * room's contributions are spread across the present students. Returns 0
 * for an empty list or an all-zero list (no contributions yet = "even"). */
function gini(values) {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  if (sum === 0) return 0;
  let absDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) absDiff += Math.abs(values[i] - values[j]);
  }
  return absDiff / (2 * n * sum);
}

function roomParticipation(data) {
  const presence = (data && data.presence) || {};
  const present = Object.keys(presence);
  // Per-student contribution COUNT (not just a boolean) so we can measure
  // the spread, not only the headcount. Each answer / hypothesis is tagged
  // with its author's clientId via `cid`.
  const counts = Object.create(null);
  const tally = (obj) => {
    Object.keys(obj || {}).forEach(k => {
      const cid = obj[k] && obj[k].cid;
      if (typeof cid === "string") counts[cid] = (counts[cid] || 0) + 1;
    });
  };
  /* Every slot's answers and hypotheses count toward participation. */
  roomSlotBuckets(data).forEach(b => { tally(b.answers); tally(b.hypotheses); });
  const perPresent = present.map(cid => counts[cid] || 0);
  const contributing = perPresent.filter(c => c > 0).length;
  // "Who's stuck" — present students who haven't contributed anything yet.
  const quietNames = present
    .filter(cid => !(counts[cid] > 0))
    .map(cid => (presence[cid] && presence[cid].name) ? presence[cid].name : "—");
  return {
    present: present.length,
    contributing: contributing,
    gini: gini(perPresent),
    quietNames: quietNames
  };
}

/* the big dashboard overview */
/* Help-call notifier — when a NEW (not-already-alerted) call appears
   on a room the admin is watching, play a soft chime + fire a desktop
   notification. Idempotent: each call's `at` timestamp is the de-dup
   key, so re-renders don't repeat the alert. Silent fallback when
   the browser denies Notifications or blocks Web Audio. */
const _helpCallSeen = Object.create(null);  // room → at-timestamp last alerted
let _helpAudioCtx = null;
function helpCallChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_helpAudioCtx) _helpAudioCtx = new Ctx();
    const ctx = _helpAudioCtx;
    // soft 2-tone chime: 880 Hz then 660 Hz, 200ms total, gentle ADSR
    const now = ctx.currentTime;
    [
      { freq: 880, start: 0,    dur: 0.18 },
      { freq: 660, start: 0.10, dur: 0.22 }
    ].forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.18, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.05);
    });
  } catch (e) { /* audio API unavailable or autoplay-blocked — silent */ }
}
function helpCallNotify(roomName, message) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "denied") return;
    const show = () => {
      try {
        const n = new Notification("CaNaMED — facilitator wanted", {
          body: roomName + (message ? ": " + message : " is calling for help"),
          tag: "canamed-help-" + roomName,  // collapse duplicates per room
          silent: false
        });
        // auto-close after 12s so they don't pile up
        setTimeout(() => { try { n.close(); } catch (e) {} }, 12_000);
        n.onclick = () => {
          try { window.focus(); n.close(); } catch (e) {}
        };
      } catch (e) {}
    };
    if (Notification.permission === "granted") {
      show();
    } else if (Notification.permission === "default") {
      // lazy-request — only the first call triggers the prompt; subsequent
      // calls reuse whichever decision the user made
      Notification.requestPermission().then(p => { if (p === "granted") show(); });
    }
  } catch (e) {}
}
/* Bug-report helper. Builds a mailto: with a short summary of the
   session context + browser fingerprint, then opens the user's mail
   client. We never transmit anything ourselves — the user remains in
   control of whether they actually hit Send and whether they attach
   the previously-downloaded error log. Mail clients clamp mailto bodies
   to ~2 KB so we don't pack the full telemetry payload; we ask the user
   to attach the JSON file instead. */
const BUG_REPORT_EMAIL = "canamed-bugs@unicaen.fr";  // operator deliverable
function openBugReportMailto() {
  const ctx = (function () {
    try {
      var summary = {
        when: new Date().toISOString(),
        url: location.href,
        sessionCode: (typeof currentSession === "string" ? currentSession : null),
        ua: navigator.userAgent,
        lang: (typeof getLang === "function" ? getLang() : (navigator.language || "")),
        viewport: window.innerWidth + "x" + window.innerHeight,
        errorCount: (window.CanamedTelemetry && Array.isArray(window.CanamedTelemetry.getErrors())
          ? window.CanamedTelemetry.getErrors().length : null)
      };
      return summary;
    } catch (e) { return { when: new Date().toISOString(), error: String(e) }; }
  })();
  var subject = "[CaNaMED bug] " + (ctx.sessionCode || "no-session") + " — please describe";
  var bodyLines = [
    "Please describe what you were doing when the issue happened, and what happened instead of what you expected.",
    "",
    "----- DO NOT EDIT BELOW THIS LINE -----",
    "Session: " + (ctx.sessionCode || "(none)"),
    "URL: " + (ctx.url || ""),
    "Time: " + ctx.when,
    "Viewport: " + ctx.viewport,
    "UI lang: " + ctx.lang,
    "Browser: " + (ctx.ua || ""),
    "In-page error log entries captured this tab: " + (ctx.errorCount == null ? "(unknown)" : ctx.errorCount),
    "",
    "If your facilitator asked you to attach the error log, please use the",
    "'Download error log' button in the admin panel before sending this email,",
    "and attach the resulting JSON file."
  ];
  var href = "mailto:" + encodeURIComponent(BUG_REPORT_EMAIL)
    + "?subject=" + encodeURIComponent(subject)
    + "&body=" + encodeURIComponent(bodyLines.join("\n"));
  // Some browsers cap mailto length around 2000 chars; truncate the UA if needed.
  if (href.length > 1800) {
    // re-build with truncated UA
    bodyLines[7] = "Browser: " + (ctx.ua || "").slice(0, 200) + " (truncated)";
    href = "mailto:" + encodeURIComponent(BUG_REPORT_EMAIL)
      + "?subject=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(bodyLines.join("\n"));
  }
  // Opening via location.href lets the OS hand off to the default mail
  // app; we don't open a new tab (which would just show a blank page if
  // no mail handler is registered).
  try { location.href = href; }
  catch (e) { alert("Could not open mail client: " + e.message); }
}
if (typeof window !== "undefined") {
  window.openBugReportMailto = openBugReportMailto;
}

/* Theme preference: "light" | "dark" | "auto" (= follow OS prefers-color-scheme).
   Read at boot by theme-init.js to set <html data-theme> before the first
   paint so a returning user never sees a flash of the wrong palette. */
const HELP_MUTE_KEY = "canamed_help_alerts_muted";
function isHelpAlertsMuted() {
  try { return localStorage.getItem(HELP_MUTE_KEY) === "1"; }
  catch (e) { return false; }
}
function setHelpAlertsMuted(muted) {
  try {
    if (muted) localStorage.setItem(HELP_MUTE_KEY, "1");
    else localStorage.removeItem(HELP_MUTE_KEY);
  } catch (e) {}
}
function maybeAlertHelpCall(roomName, callForHelpRecord) {
  if (!callForHelpRecord || callForHelpRecord.ack) return;
  const at = callForHelpRecord.at;
  if (typeof at !== "number") return;
  if (_helpCallSeen[roomName] === at) return;   // already alerted on THIS call
  _helpCallSeen[roomName] = at;
  if (isHelpAlertsMuted()) return;              // facilitator opted out
  helpCallChime();
  helpCallNotify(roomName, callForHelpRecord.msg || "");
}

/* ===== Dashboard search/filter =====
   Module-scope state: the filter string survives re-renders of the
   dashboard (which fire on every Firebase write — presence churn alone
   would otherwise wipe what the facilitator typed).
   The input is only revealed once there are MORE than 5 rooms, because
   the typical 3-4-room workshop has no clutter to filter. */
let dashboardFilter = "";
let dashboardFilterWired = false;
const DASHBOARD_FILTER_THRESHOLD = 5;

function wireDashboardFilter() {
  if (dashboardFilterWired) return;
  const input = el("dashboard-filter-input");
  const clear = el("dashboard-filter-clear");
  if (!input) return;
  dashboardFilterWired = true;
  input.addEventListener("input", () => {
    dashboardFilter = (input.value || "").trim().toLowerCase();
    if (clear) clear.hidden = !dashboardFilter;
    renderDashboard();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dashboardFilter) {
      e.preventDefault();
      input.value = "";
      dashboardFilter = "";
      if (clear) clear.hidden = true;
      renderDashboard();
    }
  });
  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      dashboardFilter = "";
      clear.hidden = true;
      input.focus();
      renderDashboard();
    });
  }
}

/* Returns true if the room (named `name`, with `data` from allRooms[name])
   matches the current dashboardFilter. Empty filter matches everything.
   Match is case-insensitive substring against the room's name, its team
   name (if set) and the names of any participants currently in it. */
function roomMatchesFilter(name, data) {
  if (!dashboardFilter) return true;
  const q = dashboardFilter;
  if ((name || "").toLowerCase().indexOf(q) >= 0) return true;
  if (data && data.teamName && data.teamName.toLowerCase().indexOf(q) >= 0) return true;
  if (data && data.presence) {
    const keys = Object.keys(data.presence);
    for (let i = 0; i < keys.length; i++) {
      const p = data.presence[keys[i]];
      if (p && p.name && p.name.toLowerCase().indexOf(q) >= 0) return true;
    }
  }
  return false;
}

/* Session-wide pacing + attention roll-up for the lead facilitator. Aggregates
   the same per-room signals already on each card (stage timer vs planned, help
   calls, quiet rooms) into ONE glance, so a prof running several rooms can pace
   the whole session and triage attention without scanning every card. Pure
   read of the live `allRooms` — no new schema, no new listeners. */
function sessionSignal() {
  const names = roomNames(roomCount);
  let active = 0, over = 0, minStage = Infinity, maxStage = -Infinity;
  let slowest = null, slowestMin = -1, quietRooms = 0;
  const calling = [];
  names.forEach(r => {
    const d = allRooms[r] || {};
    const st = typeof d.stage === "number" ? d.stage : 0;
    if (d.callForHelp && !d.callForHelp.ack) calling.push(r);
    const mins = minsSince(d.stageAt);
    if (mins == null) return;            // room hasn't started a stage yet
    active++;
    minStage = Math.min(minStage, st);
    maxStage = Math.max(maxStage, st);
    if (mins > stageMinutes(st)) {
      over++;
      if (mins > slowestMin) { slowestMin = mins; slowest = r; }
    }
    if ((st === 1 || st === 2) && typeof roomParticipation === "function") {
      const p = roomParticipation(d);
      if (p.present >= 2 && p.contributing < p.present) quietRooms++;
    }
  });
  return { rooms: names.length, active, over, minStage, maxStage,
           slowest, slowestMin, calling, quietRooms };
}

/* Paint the session signal as the first child of #dashboard. */
function renderSessionSignal(dash) {
  if (!dash) return;
  const s = sessionSignal();
  if (!s.active && !s.calling.length) return;   // nothing started yet
  const wrap = document.createElement("div");
  wrap.className = "dash-session-signal";

  // 1) Urgent first: rooms calling for a facilitator.
  if (s.calling.length) {
    const call = document.createElement("div");
    call.className = "dash-signal-line dash-signal-call";
    call.textContent = " " + s.calling.length + " room" + (s.calling.length === 1 ? "" : "s") +
      " need a facilitator now: " + s.calling.join(", ");
    call.prepend(icNode("bell"));
    wrap.appendChild(call);
  }

  // 2) Pacing.
  const pace = document.createElement("div");
  pace.className = "dash-signal-line dash-signal-pace" + (s.over > 0 ? " behind" : " ontrack");
  if (!s.active) {
    pace.textContent = " Pacing — waiting for rooms to start.";
  } else if (s.over === 0) {
    pace.textContent = " Pacing — all " + s.active + " active room" +
      (s.active === 1 ? "" : "s") + " on track.";
  } else {
    pace.textContent = " Pacing — " + s.over + "/" + s.active +
      " over planned stage time" +
      (s.slowest ? " (slowest: " + s.slowest + ", " + s.slowestMin + " min)" : "") +
      (s.maxStage > s.minStage
        ? " · rooms span stages " + (s.minStage + 1) + "–" + (s.maxStage + 1) : "") + ".";
  }
  pace.prepend(icNode("clock"));
  wrap.appendChild(pace);

  // 3) Quiet rooms (gentle nudge; per-room names are still on each card).
  if (s.quietRooms > 0) {
    const q = document.createElement("div");
    q.className = "dash-signal-line dash-signal-quiet";
    q.textContent = " " + s.quietRooms + " room" + (s.quietRooms === 1 ? "" : "s") +
      " with a student not yet contributing.";
    q.prepend(icNode("moon"));
    wrap.appendChild(q);
  }
  dash.appendChild(wrap);
}

function renderDashboard() {
  const dash = el("dashboard");
  dash.innerHTML = "";
  // toggle the filter wrap visibility based on roomCount; wire its
  // listeners once the input is in the DOM (which it always is — it
  // lives in index.html alongside #dashboard — but the wiring is
  // deferred so it doesn't run when there's no admin view yet).
  const filterWrap = el("dashboard-filter-wrap");
  if (filterWrap) {
    const showFilter = roomCount > DASHBOARD_FILTER_THRESHOLD;
    filterWrap.classList.toggle("hidden", !showFilter);
    if (showFilter) wireDashboardFilter();
    else if (dashboardFilter) {
      // facilitator dropped to <=5 rooms (rare, but cope) — clear stale filter
      dashboardFilter = "";
      const inp = el("dashboard-filter-input");
      if (inp) inp.value = "";
      const clr = el("dashboard-filter-clear");
      if (clr) clr.hidden = true;
    }
  }
  // Session-wide pacing + attention roll-up at the top of the dashboard, so
  // the lead facilitator can pace the whole room set at a glance instead of
  // scanning every card (read-only; derived from the live `allRooms`).
  renderSessionSignal(dash);
  let visibleCount = 0;
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const people = data.presence
      ? Object.keys(data.presence).map(c => data.presence[c].name) : [];
    const calling = !!data.callForHelp && !data.callForHelp.ack;
    // Side-effect: trigger sound + desktop notification for any NEW
    // call (per-room dedup by the call's `at` timestamp).
    if (calling) maybeAlertHelpCall(r, data.callForHelp);

    const row = document.createElement("div");
    row.className = "dash-room" + (calling ? " calling" : "");
    // apply the search filter: hide rooms that don't match without
    // dropping them from the DOM (so a clear-filter is instant)
    if (!roomMatchesFilter(r, data)) {
      row.classList.add("dashboard-filtered-out");
    } else {
      visibleCount++;
    }

    const info = document.createElement("div");
    info.className = "dash-info";
    const title = document.createElement("div");
    title.className = "dash-title";
    title.textContent = r + "  ·  " + people.length +
      (people.length === 1 ? " person" : " people");
    if (calling) {
      const badge = document.createElement("span");
      badge.className = "call-badge";
      const age = minsSince(data.callForHelp.at);
      badge.textContent = " calling for a facilitator" +
        (age != null && age > 0 ? " · " + age + " min" : "");
      badge.prepend(icNode("bell"));
      title.appendChild(badge);
    }
    const stg = document.createElement("div");
    stg.className = "dash-stage";
    // Count by position in the active stage flow (branched skips stage 2).
    const _dflow = stageFlow();
    const _dpos = _dflow.indexOf(st);
    stg.textContent = "Stage " + ((_dpos === -1 ? st : _dpos) + 1) + "/" + _dflow.length +
      " · " + stageLabel(st);
    // time-in-stage + work-progress, so the lead prof can pace without opening rooms
    const timer = document.createElement("div");
    const mins = minsSince(data.stageAt);
    if (mins != null) {
      const over = mins > stageMinutes(st);
      timer.className = "dash-timer" + (over ? " over" : "");
      timer.textContent = mins + " min in this stage" +
        (over ? " (planned ~" + stageMinutes(st) + ")" : "");
    } else {
      timer.className = "dash-timer";
      timer.textContent = "";
    }
    const prog = document.createElement("div");
    prog.className = "dash-progress";
    prog.textContent = roomProgress(data);
    if (calling && data.callForHelp.msg) {
      const det = document.createElement("span");
      det.className = "call-detail";
      det.textContent = "needs: ";
      const m = document.createElement("span");
      m.className = "call-msg"; m.textContent = data.callForHelp.msg;
      det.appendChild(m);
      prog.appendChild(det);
    }
    // Live participation equity — how evenly the room is engaged. Only
    // meaningful once the room is in an interactive stage (Module A/B) with
    // students present. Shows the contributing headcount + a Gini-derived
    // "balance" read, and (separately) names the students who haven't
    // contributed yet so the facilitator can nudge them by name.
    const part = roomParticipation(data);
    const interactive = (st === 1 || st === 2);
    const quiet = interactive && part.present >= 2 && part.contributing < part.present;

    const partic = document.createElement("div");
    partic.className = "dash-participation" + (quiet ? " quiet" : "");
    if (interactive && part.present >= 1) {
      let line = " " + part.contributing + "/" + part.present + " contributing";
      // A balance read is only meaningful with 2+ actual contributors among
      // 3+ present (Gini on tiny / single-contributor sets is noise).
      if (part.contributing >= 2 && part.present >= 3) {
        const g = part.gini;
        const label = g < 0.2 ? "even" :
                      g < 0.4 ? "slightly uneven" : "uneven — one or two carrying it";
        line += " · " + label;
        partic.title = "Contribution balance (Gini) " + g.toFixed(2) +
          " — 0 is perfectly even, 1 is one person doing everything";
      }
      partic.textContent = line;
      partic.prepend(icNode("users"));
    } else {
      partic.textContent = "";
    }

    // "Who's stuck" — name the present students with zero contributions so
    // the facilitator can prompt them directly. Names via textContent only.
    const quietLine = document.createElement("div");
    quietLine.className = "dash-quiet-names";
    if (interactive && part.present >= 2 && part.quietNames.length &&
        part.quietNames.length < part.present) {
      quietLine.textContent = " not yet contributing: " + part.quietNames.join(", ");
      quietLine.prepend(icNode("moon"));
    } else {
      quietLine.textContent = "";
    }

    const ppl = document.createElement("div");
    ppl.className = "dash-people";
    if (people.length) {
      people.forEach(nm => ppl.appendChild(makeChip(nm, nm, "mini-chip")));
    } else {
      ppl.textContent = "empty";
    }
    // live score line - total, plus the auto / manual / penalty split
    const s = data.score || {};
    let sAuto = 0, sManualRaw = 0, sPen = 0;
    Object.keys(s.auto || {}).forEach(k => { sAuto += (s.auto[k].points || 0); });
    Object.keys(s.manual || {}).forEach(k => { sManualRaw += (s.manual[k].points || 0); });
    Object.keys(s.penalties || {}).forEach(k => { sPen += (s.penalties[k].points || 0); });
    const sManual = Math.min(sManualRaw, MANUAL_CAP);
    const score = document.createElement("div");
    score.className = "dash-score";
    score.textContent = (data.teamName ? data.teamName + " — " : "") +
      "Score " + Math.max(0, sAuto + sManual - sPen) + "  ·  auto " + sAuto +
      "  ·  facilitator " + sManual + "/" + MANUAL_CAP +
      (sPen ? "  ·  penalties −" + sPen : "");
    info.appendChild(title); info.appendChild(stg);
    info.appendChild(timer); info.appendChild(prog);
    info.appendChild(partic); info.appendChild(quietLine); info.appendChild(ppl);
    info.appendChild(score);
    // Branched scenarios: this room's path through the decision tree — each
    // committed choice marked green (correct) / red (incorrect), plus where the
    // room is deciding now. Built by the lazy branched-render.js (room-only;
    // null for non-branched sessions or before it loads).
    const _cbr = window.CanamedBranchedRender;
    if (_cbr && _cbr.buildRoomChoiceTree) {
      const tree = _cbr.buildRoomChoiceTree(data, _curLang ? _curLang() : "en");
      if (tree) info.appendChild(tree);
    }

    const ctrl = document.createElement("div");
    ctrl.className = "dash-ctrl";
    const view = document.createElement("button");
    view.className = "view-btn";
    view.textContent = "Open room";
    view.addEventListener("click", () => openRoomAsAdmin(r));
    // Step through the ACTIVE flow (see the sidebar arrows below for why raw
    // st±1 is wrong: a skipped stage is a dead target, and Back silently
    // rolled forward again).
    const _dprev = adjacentStage(st, -1);
    const _dnext = adjacentStage(st, 1);
    const back = document.createElement("button");
    back.textContent = "← Back"; back.disabled = _dprev === st;
    back.addEventListener("click", () => setRoomStage(r, st, _dprev));
    const fwd = document.createElement("button");
    fwd.textContent = "Advance →"; fwd.disabled = _dnext === st;
    fwd.addEventListener("click", () => setRoomStage(r, st, _dnext));
    const ptsBtn = document.createElement("button");
    ptsBtn.className = "pts-btn";
    ptsBtn.textContent = "+ Points";
    ptsBtn.addEventListener("click", () => {
      pointsPanelOpen = (pointsPanelOpen === r) ? null : r;
      renderDashboard();
    });
    ctrl.appendChild(view); ctrl.appendChild(back); ctrl.appendChild(fwd);
    ctrl.appendChild(ptsBtn);

    row.appendChild(info); row.appendChild(ctrl);
    if (pointsPanelOpen === r) row.appendChild(buildPointsPanel(r, sManualRaw));
    dash.appendChild(row);
  });
  // when a filter is active and nothing matched, show a polite empty-
  // state line instead of an entirely blank panel
  if (dashboardFilter && visibleCount === 0) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty-filter";
    empty.textContent = (typeof window.t === "function")
      ? window.t("admin.search.empty")
      : "No rooms match this filter.";
    dash.appendChild(empty);
  }
}

/* the facilitator's +points panel - fixed reason tags, capped manual total */
let pointsPanelOpen = null;
function buildPointsPanel(room, manualRaw) {
  const panel = document.createElement("div");
  panel.className = "dash-points-panel";
  const atCap = manualRaw >= MANUAL_CAP;
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = atCap
    ? "Facilitator-points cap reached for this room (" + MANUAL_CAP + ")."
    : "Award the room that reasons and debates well — not the one that finishes first.";
  panel.appendChild(intro);
  SCORE_MANUAL_TAGS.forEach(t => {
    const b = document.createElement("button");
    b.className = "pts-tag";
    b.textContent = "+" + t.points + "  " + t.tag;
    b.disabled = atCap;
    b.addEventListener("click", () => awardManual(room, t.tag, t.points));
    panel.appendChild(b);
  });
  const undo = document.createElement("button");
  undo.className = "pts-undo";
  undo.textContent = "Undo last award";
  undo.addEventListener("click", () => undoLastManual(room));
  panel.appendChild(undo);
  return panel;
}
function awardManual(room, tag, points) {
  db.ref(sPath("rooms/" + room + "/score/manual")).push({
    points: points, tag: tag, by: myName, at: Date.now()
  }).catch(e => console.error("Award failed", e));
  logEvent(room, "score.manual", { tag: tag, points: points, by: myName });
}
function undoLastManual(room) {
  const ref = db.ref(sPath("rooms/" + room + "/score/manual"));
  ref.once("value").then(snap => {
    const v = snap.val() || {};
    const keys = Object.keys(v).sort((a, b) => (v[a].at || 0) - (v[b].at || 0));
    if (keys.length) return ref.child(keys[keys.length - 1]).remove();
  }).catch(e => console.error("Undo failed", e));
}

/* ===================== POST-SESSION DEBRIEF DASHBOARD =====================
   Aggregate stats panel for facilitators, toggled from the admin chrome.
   Computed entirely from `allRooms` (already live-subscribed via startAdmin)
   and `pool` (also live). No new Firebase listeners, no new schema.

   Sections, in order:
     1. Ranking — rooms by total score
     2. Decisions — per-decision option split across rooms
     3. Penalties — heatmap of penalties × rooms
     4. Concepts — per scoring family, how many rooms hit it
     5. Funnel — pool → assigned → answered → voted
     6. Time-on-stage — when stage history is unavailable, current
        stage durations are used (only stageAt is stored)

   Rendered into #debrief-body when the panel is visible. The debounced
   refRooms listener also triggers a re-render here (cheap, pure-DOM). */
let debriefVisible = false;
function _debriefRoomList() {
  return roomNames(roomCount).filter(r => allRooms[r] != null);
}
function _debriefMakeBar(labelText, fillPct, valText, kind) {
  const row = document.createElement("div");
  row.className = "debrief-bar-row";
  const lbl = document.createElement("div");
  lbl.className = "lbl"; lbl.textContent = labelText;
  const track = document.createElement("div");
  track.className = "debrief-bar-track";
  const fill = document.createElement("i");
  fill.className = "debrief-bar-fill" + (kind ? " " + kind : "");
  // CSP forbids inline style="..." attrs in our policy, but element.style.X
  // is a property set, which is allowed and not parsed as inline CSS.
  fill.style.width = Math.max(0, Math.min(100, fillPct)) + "%";
  track.appendChild(fill);
  const val = document.createElement("div");
  val.className = "val"; val.textContent = valText;
  row.appendChild(lbl); row.appendChild(track); row.appendChild(val);
  return row;
}
function _debriefSection(titleKey) {
  const sec = document.createElement("section");
  sec.className = "debrief-section";
  const h = document.createElement("h4");
  h.textContent = _debriefT(titleKey);
  sec.appendChild(h);
  return sec;
}
function _debriefEmpty(sec) {
  const p = document.createElement("p");
  p.className = "debrief-empty";
  p.textContent = _debriefT("debrief.no-data");
  sec.appendChild(p);
  return sec;
}
function _debriefRankingSection() {
  const sec = _debriefSection("debrief.section.ranking");
  const rooms = _debriefRoomList();
  if (!rooms.length) return _debriefEmpty(sec);
  const rows = rooms.map(r => ({
    room: r,
    team: (allRooms[r] && allRooms[r].teamName) || "",
    score: _debriefBucket(allRooms[r]).total
  })).sort((a, b) => b.score - a.score);
  const maxScore = Math.max(1, rows[0].score);
  rows.forEach(rr => {
    const lbl = rr.room + (rr.team ? " — " + rr.team : "");
    sec.appendChild(_debriefMakeBar(
      lbl, (rr.score / maxScore) * 100, String(rr.score)));
  });
  return sec;
}
function _debriefDecisionsSection() {
  const sec = _debriefSection("debrief.section.decisions");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof DECISIONS === "undefined" || !Array.isArray(DECISIONS)) {
    return _debriefEmpty(sec);
  }
  const lang = _curLang();
  DECISIONS.forEach(d => {
    const card = document.createElement("div");
    card.className = "debrief-decision";
    const prompt = document.createElement("div");
    prompt.className = "debrief-decision-prompt";
    prompt.textContent = (d.module ? "[" + _debriefT(
      d.module === "B" ? "debrief.module-b" : "debrief.module-a") + "] " : "") +
      tc(d.prompt, lang);
    card.appendChild(prompt);

    // tally how each room locked it in
    const counts = (d.options || []).map(() => 0);
    let committed = 0;
    rooms.forEach(r => {
      const v = ((allRooms[r] || {}).votes || {})[d.id] || {};
      const c = v.committed && typeof v.committed.choice === "number"
        ? v.committed.choice : null;
      if (c != null && c >= 0 && c < counts.length) {
        counts[c] += 1; committed += 1;
      }
    });
    const meta = document.createElement("div");
    meta.className = "debrief-decision-meta";
    meta.textContent = committed + " / " + rooms.length + " " +
      _debriefT("debrief.rooms-picked") +
      (committed ? "" : " — " + _debriefT("debrief.no-commit"));
    card.appendChild(meta);

    (d.options || []).forEach((opt, i) => {
      const row = document.createElement("div");
      row.className = "debrief-decision-option";
      const text = document.createElement("span");
      text.className = "opt-text" + (opt.correct ? " correct" : "");
      text.textContent = tc(opt.text, lang) +
        (opt.correct ? " " + _debriefT("debrief.correct-option") : "");
      const cnt = document.createElement("span");
      cnt.className = "opt-count";
      const pct = committed > 0 ? Math.round((counts[i] / committed) * 100) : 0;
      const pts = (opt.correct ? (d.points || 0) : -(d.penalty || 0));
      cnt.textContent = counts[i] + " · " + pct + "% · " +
        (pts >= 0 ? "+" : "") + pts;
      const bar = document.createElement("div");
      bar.className = "debrief-option-bar";
      const fill = document.createElement("i");
      if (opt.correct) fill.className = "correct";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      row.appendChild(text); row.appendChild(cnt);
      card.appendChild(row);
      card.appendChild(bar);
    });
    sec.appendChild(card);
  });
  return sec;
}
function _debriefPenaltiesSection() {
  const sec = _debriefSection("debrief.section.penalties");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof PENALTIES === "undefined" || !Array.isArray(PENALTIES)) {
    return _debriefEmpty(sec);
  }
  const lang = _curLang();
  // identify which penalties have fired anywhere; if none, show empty state
  // (much friendlier than a fully-empty grid)
  const firedByRoom = {};
  rooms.forEach(r => {
    firedByRoom[r] = {};
    const s = ((allRooms[r] || {}).score || {}).penalties || {};
    Object.keys(s).forEach(eid => {
      // eid is the penalty's id (or "decpen_<...>") — count by id
      firedByRoom[r][eid] = (firedByRoom[r][eid] || 0) + (s[eid].points || 0);
    });
  });
  const totalFires = rooms.reduce((acc, r) =>
    acc + Object.keys(firedByRoom[r]).length, 0);
  if (totalFires === 0) return _debriefEmpty(sec);

  const wrap = document.createElement("div");
  wrap.className = "debrief-heat-wrap";
  const grid = document.createElement("div");
  grid.className = "debrief-heat";
  // grid columns: penalty label + one per room
  grid.style.gridTemplateColumns = "minmax(180px, 1fr) repeat(" + rooms.length + ", minmax(60px, 1fr))";
  // header row
  const corner = document.createElement("div"); corner.className = "debrief-heat-h"; grid.appendChild(corner);
  rooms.forEach(r => {
    const h = document.createElement("div");
    h.className = "debrief-heat-h"; h.textContent = r; grid.appendChild(h);
  });
  // only render penalties that fired in ≥1 room
  PENALTIES.forEach(p => {
    const anyHit = rooms.some(r => firedByRoom[r][p.id]);
    if (!anyHit) return;
    const lbl = document.createElement("div");
    lbl.className = "debrief-heat-rowlbl";
    lbl.textContent = tc(p.title, lang);
    grid.appendChild(lbl);
    rooms.forEach(r => {
      const cell = document.createElement("div");
      cell.className = "debrief-heat-cell" + (firedByRoom[r][p.id] ? " fired" : "");
      cell.textContent = firedByRoom[r][p.id] ? "−" + firedByRoom[r][p.id] : "";
      grid.appendChild(cell);
    });
  });
  wrap.appendChild(grid);
  sec.appendChild(wrap);
  return sec;
}
function _debriefConceptsSection() {
  const sec = _debriefSection("debrief.section.concepts");
  const rooms = _debriefRoomList();
  if (!rooms.length || typeof SCORING === "undefined") return _debriefEmpty(sec);
  const lang = _curLang();
  const totalRooms = rooms.length;
  ["moduleA", "moduleB"].forEach(mk => {
    const fams = (SCORING && SCORING[mk]) || [];
    if (!fams.length) return;
    const sub = document.createElement("div");
    const sh = document.createElement("strong");
    sh.textContent = _debriefT(mk === "moduleA" ? "debrief.module-a" : "debrief.module-b");
    sub.appendChild(sh);
    fams.forEach(fam => {
      const evKey = "concept" + (mk === "moduleA" ? "A" : "B") + "_" + fam.id;
      let hits = 0;
      rooms.forEach(r => {
        const auto = ((allRooms[r] || {}).score || {}).auto || {};
        if (auto[evKey]) hits += 1;
      });
      const pct = totalRooms ? (hits / totalRooms) * 100 : 0;
      const kind = hits === totalRooms ? "ok"
                 : hits === 0 ? "bad"
                 : (hits / totalRooms < 0.5 ? "warn" : "");
      sub.appendChild(_debriefMakeBar(
        tc(fam.label, lang), pct,
        hits + " / " + totalRooms + " " + _debriefT("debrief.concept.rooms-hit"),
        kind));
    });
    sec.appendChild(sub);
  });
  return sec;
}
function _debriefFunnelSection() {
  const sec = _debriefSection("debrief.section.funnel");
  // count: anyone in pool (with consent already implied)
  const poolList = Object.keys(pool || {}).map(k => pool[k] || {});
  const joinedPool = poolList.length;
  if (!joinedPool) return _debriefEmpty(sec);
  const assigned = poolList.filter(p => p && typeof p.room === "string" && p.room).length;
  // answered ≥1: count unique clientIds across all rooms' answer entries
  const answeredCids = {};
  const votedCids = {};
  _debriefRoomList().forEach(r => {
    const room = allRooms[r] || {};
    const ans = room.answers || {};
    ["moduleA", "moduleB"].forEach(mk => {
      const entries = ans[mk] || {};
      Object.keys(entries).forEach(eid => {
        const e = entries[eid] || {};
        if (e.cid) answeredCids[e.cid] = true;
      });
    });
    const votes = room.votes || {};
    Object.keys(votes).forEach(vid => {
      const ballots = (votes[vid] && votes[vid].ballots) || {};
      Object.keys(ballots).forEach(cid => { votedCids[cid] = true; });
    });
  });
  const rows = [
    { key: "debrief.funnel.registered", n: joinedPool },
    { key: "debrief.funnel.assigned",   n: assigned },
    { key: "debrief.funnel.answered",   n: Object.keys(answeredCids).length },
    { key: "debrief.funnel.voted",      n: Object.keys(votedCids).length }
  ];
  rows.forEach(rr => {
    const row = document.createElement("div");
    row.className = "debrief-funnel-row";
    const lbl = document.createElement("span");
    lbl.textContent = _debriefT(rr.key) + " — " + rr.n;
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = Math.round((rr.n / Math.max(1, joinedPool)) * 100) + "%";
    row.appendChild(lbl); row.appendChild(pct);
    sec.appendChild(row);
  });
  return sec;
}
function _debriefTimeSection() {
  const sec = _debriefSection("debrief.section.time");
  const rooms = _debriefRoomList();
  if (!rooms.length) return _debriefEmpty(sec);
  // We only have the CURRENT stage's stageAt (no history). Show minutes spent
  // on the current stage per room as a single coloured segment — this is the
  // best signal available without adding schema.
  const now = Date.now();
  rooms.forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const at = typeof data.stageAt === "number" ? data.stageAt : null;
    const mins = at ? Math.max(0, Math.round((now - at) / 60000)) : 0;
    const block = document.createElement("div");
    block.className = "debrief-time-room";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.textContent = r + " — " + _debriefT("debrief.time.stage") + " " + (st + 1) +
      " · " + mins + " " + _debriefT("debrief.time.minutes");
    block.appendChild(lbl);
    const stack = document.createElement("div");
    stack.className = "debrief-time-stack";
    const seg = document.createElement("div");
    seg.className = "debrief-time-seg s" + st;
    seg.style.width = "100%";
    seg.textContent = mins + " " + _debriefT("debrief.time.minutes");
    stack.appendChild(seg);
    block.appendChild(stack);
    sec.appendChild(block);
  });
  // legend
  const legend = document.createElement("div");
  legend.className = "debrief-time-legend";
  // Only the stages this session actually visits (a branched flow skips 2), so
  // the legend can't advertise a stage nobody will ever see.
  stageFlow().forEach((i) => {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = "s" + i;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(stageLabel(i)));
    legend.appendChild(item);
  });
  sec.appendChild(legend);
  return sec;
}
function renderDebrief() {
  const body = el("debrief-body");
  if (!body) return;
  body.innerHTML = "";
  const noRooms = _debriefRoomList().length === 0;
  if (noRooms) {
    const p = document.createElement("p");
    p.className = "debrief-empty";
    p.textContent = _debriefT("debrief.empty");
    body.appendChild(p);
    return;
  }
  body.appendChild(_debriefRankingSection());
  body.appendChild(_debriefDecisionsSection());
  body.appendChild(_debriefPenaltiesSection());
  body.appendChild(_debriefConceptsSection());
  body.appendChild(_debriefFunnelSection());
  body.appendChild(_debriefTimeSection());
}
function toggleDebrief() {
  debriefVisible = !debriefVisible;
  const panel = el("admin-debrief");
  const btn = el("admin-debrief-btn");
  if (panel) panel.classList.toggle("hidden", !debriefVisible);
  if (btn) {
    btn.setAttribute("aria-expanded", debriefVisible ? "true" : "false");
    // toggle the data-i18n key + textContent so the language switcher refreshes
    btn.setAttribute("data-i18n",
      debriefVisible ? "debrief.toggle-close" : "debrief.toggle");
    btn.textContent = _debriefT(
      debriefVisible ? "debrief.toggle-close" : "debrief.toggle");
  }
  if (debriefVisible) renderDebrief();
}
if (typeof window !== "undefined") {
  window.renderDebrief = renderDebrief;
  window.toggleDebrief = toggleDebrief;
}

/* the side panel shown while an admin is inside a room */
function renderSidebar() {
  const box = el("sidebar-rooms");
  if (!box) return;
  box.innerHTML = "";
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const calling = !!data.callForHelp && !data.callForHelp.ack;
    const count = data.presence ? Object.keys(data.presence).length : 0;

    const row = document.createElement("div");
    row.className = "sidebar-room" + (r === myRoom ? " current" : "") +
      (calling ? " calling" : "");
    const nameBtn = document.createElement("button");
    nameBtn.className = "sidebar-room-name";
    nameBtn.textContent = r + "  ·  " + count +
      (count === 1 ? " person" : " people");
    if (calling) {
      nameBtn.appendChild(document.createTextNode("  "));
      nameBtn.appendChild(icNode("bell"));
    }
    nameBtn.addEventListener("click", () => { if (r !== myRoom) openRoomAsAdmin(r); });

    const meta = document.createElement("div");
    meta.className = "sidebar-room-meta";
    // Count by position in the ACTIVE stage flow (branched skips stage 2) —
    // same as the dashboard row above.
    const _sflow = stageFlow();
    const _spos = _sflow.indexOf(st);
    meta.textContent = "Stage " + ((_spos === -1 ? st : _spos) + 1) + "/" + _sflow.length +
      " · " + stageLabel(st);

    const ctrl = document.createElement("div");
    ctrl.className = "sidebar-room-ctrl";
    // Step through the active flow, not raw indices. With raw st±1 a branched
    // room could be pointed at the skipped stage 2, and stepping BACK from
    // Wrap-up was a silent no-op (snapStageToFlow rolls a skipped target
    // FORWARD, landing back on Wrap-up).
    const _sprev = adjacentStage(st, -1);
    const _snext = adjacentStage(st, 1);
    const back = document.createElement("button");
    back.textContent = "←"; back.disabled = _sprev === st;
    back.title = "Step " + r + " back a stage";
    back.setAttribute("aria-label", back.title);
    back.addEventListener("click", () => setRoomStage(r, st, _sprev));
    const fwd = document.createElement("button");
    fwd.textContent = "→"; fwd.disabled = _snext === st;
    fwd.title = "Advance " + r + " a stage";
    fwd.setAttribute("aria-label", fwd.title);
    fwd.addEventListener("click", () => setRoomStage(r, st, _snext));
    ctrl.appendChild(back); ctrl.appendChild(fwd);

    row.appendChild(nameBtn); row.appendChild(meta); row.appendChild(ctrl);
    box.appendChild(row);
  });
}

/* an admin opens (or switches to) a room - sees the exact student view.
   Acknowledge any call for help: the dashboard alert clears, and the room's
   students see "a prof is on the way". */
function openRoomAsAdmin(roomName) {
  const cfh = db.ref(sPath("rooms/" + roomName + "/callForHelp"));
  cfh.once("value").then(snap => {
    const v = snap.val();
    if (v && !v.ack) return cfh.set({ by: v.by, at: v.at, ack: true });
  }).catch(e => console.error("Acknowledging call failed", e));
  enterRoom(roomName, true);
  renderSidebar();
}
function backToDashboard() {
  teardownRoom();
  isRoomAdmin = false;
  myRoom = null;
  document.body.classList.remove("admin-room");
  el("app").classList.add("hidden");
  try { CanamedLoader.ensureAdminStyles().catch(function(){}); } catch (e) {}
  el("room-sidebar").classList.add("hidden");
  el("admin-app").classList.remove("hidden");
  el("header-right").textContent =
    (role === "superadmin" ? "Super admin" : "Admin") + " · Session " + sessionNum;
  focusHeading("admin-app");
}

/* ===================== CLOSE SESSION & FULL ARCHIVE EXPORT ==================
   When an admin "ends" the session, the platform downloads the WHOLE session
   subtree as one JSON file (every group's answers, votes, revealed findings,
   scores, contributions, presence) and writes a `closed` marker so every
   participant sees a "thanks for taking part" banner.

   The marker is advisory: the database stays readable so latecomers can still
   review their team's work, but the social signal is unambiguous - the
   facilitator has ended the workshop, and the full record is in the
   facilitator's downloads folder. */
function closeSession() {
  if (!sessionNum || !db) {
    alert("No session loaded — nothing to close.");
    return;
  }
  const btn = el("admin-close-btn");
  const orig = btn && btn.textContent;
  const resetBtn = (text) => {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = text || orig || "End session & download archive";
  };

  if (btn) { btn.disabled = true; btn.textContent = "Building archive…"; }

  // 1. is the session already closed? If yes, we'll just re-download.
  db.ref(sPath("closed")).once("value")
    .then(snap => {
      const alreadyClosed = !!snap.val();
      if (!alreadyClosed) {
        return canamedConfirm({
          title: (window.t ? window.t("modal.close.title") :
            "End session and download archive?"),
          message: (window.t ? window.t("modal.close.message") :
            "This will:\n" +
            "  • download a JSON file with every group's answers, votes, " +
            "reveals, scores, contributions and presence\n" +
            "  • mark the session as closed — participants see a 'thanks " +
            "for taking part' banner and cannot type any more text\n\n" +
            "The students' data stays in the database — you can re-download " +
            "the archive any time. The marker cannot easily be undone."),
          okLabel: (window.t ? window.t("modal.close.ok") :
            "End and download"),
          danger: true
        }).then(ok => {
          if (!ok) { resetBtn(); return { cancelled: true }; }
          // 2. fetch the full tree and download it
          return db.ref(sPath("")).once("value")
            .then(t => ({ tree: t.val() || {}, alreadyClosed: alreadyClosed }));
        });
      }
      // already closed → skip confirm, just re-fetch + re-download
      return db.ref(sPath("")).once("value")
        .then(t => ({ tree: t.val() || {}, alreadyClosed: alreadyClosed }));
    })
    .then(result => {
      if (!result || result.cancelled) return null;
      const tree = result.tree;
      // strip the password hash from the archive
      if (tree.adminPasswordHash) delete tree.adminPasswordHash;
      downloadFullArchive(tree, sessionNum);
      if (result.alreadyClosed) {
        resetBtn("Session closed ✓ — re-download archive");
        if (btn) btn.classList.add("done");
        return null;          // nothing more to do
      }
      // 3. archive is downloaded; now write the closed marker
      if (btn) btn.textContent = "Closing session…";
      return db.ref(sPath("closed")).set({
        by: myName || "Admin",
        at: Date.now()
      }).then(() => "written");
    })
    .then(result => {
      if (result !== "written") return;
      // Persist a pseudonymous program summary: a durable DB copy (rules-guarded
      // /summary) AND a local rollup entry kept across close, so the Program
      // overview can aggregate this session later. Best-effort — never blocks.
      try {
        const summary = _sessionSummaryObj();
        recordProgramSession(summary);
        if (db) db.ref(sPath("summary")).set(summary).catch(() => { /* rules/offline */ });
      } catch (e) { /* non-fatal */ }
      // write succeeded - update the button + drop this session from the
      // local "my open sessions" tracker (the reaper list won't show it
      // anymore on next splash visit).
      try { removeMySession(sessionNum); } catch (e) { /* non-fatal */ }
      resetBtn("Session closed ✓ — re-download archive");
      if (btn) btn.classList.add("done");
    })
    .catch(e => {
      console.error("Close session failed", e);
      // The archive was downloaded but the close-write failed - tell the user
      // exactly that, with the actual error so they can act on it. The most
      // common cause is stale database rules in production (the `closed`
      // field validation was added later) - solved by:
      //   firebase deploy --only database
      const reason = (e && e.code) ? (e.code + ": " + (e.message || ""))
                                   : (e && e.message) || String(e);
      alert(
        "The archive downloaded, but the session could NOT be marked as " +
        "closed.\n\n" +
        "Reason: " + reason + "\n\n" +
        "If this says PERMISSION_DENIED, your database rules need to be " +
        "deployed (run `firebase deploy --only database` from the platform " +
        "folder). Otherwise check your connection and try again."
      );
      resetBtn();
    });
}

function downloadFullArchive(tree, code) {
  const anon = !!(el("anon-export") && el("anon-export").checked);
  const stamp = new Date();
  const ymd = stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  let sessionPayload = tree;
  let linkage = null;
  if (anon) {
    const result = pseudonymiseTree(tree);
    sessionPayload = result.tree;
    linkage = result.linkage;
  }
  const archive = {
    // R3-E1/E2/E4/E5 — explicit schema metadata so Tariq's R-pipeline (and
    // any downstream consumer) can detect drift between archives.
    //
    //   canamedSchema:        the canonical JSON-Schema document URL — bump
    //                         this when fields are added / removed / renamed.
    //   canamedSchemaVersion: human-readable semver. Pre-1.0 means the schema
    //                         is still in flux; pipelines should pin to a
    //                         minor and tolerate patch bumps.
    //   canamedVersion:       legacy integer kept for back-compat with
    //                         pre-R3 readers; will be removed at v2.0.
    //   scenarioId:           stable kebab-case id (e.g. "chronic-pain-opioids")
    //                         — pipelines should dispatch on this, NOT on
    //                         scenarioName which is a localised display string.
    canamedSchema: "https://canamed.web.app/schema/archive-v1.json",
    canamedSchemaVersion: "1.0.0",
    canamedVersion: 1,
    exportedAt: stamp.toISOString(),
    sessionCode: code,
    workshopName: (window.CFG && window.CFG.workshopName) || "",
    scenarioId: window.CURRENT_SCENARIO_ID || "",
    scenarioName: tc(window.CURRENT_SCENARIO_NAME, "en") || "",
    pseudonymised: !!anon,
    cohorts: (window.COHORTS || []).map(c => ({
      id: c.id, label: c.label, country: c.country
    })),
    /* the live tree as the engine saw it - rooms, pool, answers, votes,
       scores, presence, callForHelp, revealed items, decisions, the lot */
    session: sessionPayload
  };
  // When pseudonymised, include the linkage table count (not the table
  // itself) so a researcher reviewing the export knows the export was
  // pseudonymised and how many distinct participants were re-coded.
  if (anon) {
    archive.pseudonymisedParticipantCount = Object.keys(linkage || {}).length;
    archive.pseudonymisedNote = "Real names replaced by Student-A / Student-B / ... " +
      "deterministic per session, ordered by pool join time. " +
      "Linkage table is NOT included in this on-demand export — " +
      "re-identification requires the linkage table held by the operator.";
  }
  const json = JSON.stringify(archive, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "canamed-" + code + "-" + ymd +
    (anon ? "_pseudonymised.json" : ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ===================== PER-STUDENT DEBRIEF CARD =====================
   Renders into #student-debrief inside the full-page session-ended screen.
   Pulls from the data the student already subscribes to during the session:
     - allRooms (refLeaderboard) — every room's score, decisions, presence
     - myRoom, teamName — which row in allRooms is "ours"
     - myUniversity — for the "agreed with your country" framing
   Pure DOM build; idempotent (clears + repopulates on each call). */
const PROGRAM_SESSIONS_KEY = "canamed_program_sessions";
function recordProgramSession(summary) {
  if (!summary || !summary.code) return;
  try {
    let list = JSON.parse(localStorage.getItem(PROGRAM_SESSIONS_KEY)) || [];
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex(s => s && s.code === summary.code);
    if (i >= 0) list[i] = summary; else list.push(summary);
    localStorage.setItem(PROGRAM_SESSIONS_KEY, JSON.stringify(list.slice(-300)));
  } catch (e) { /* storage blocked — non-fatal */ }
}
function _sessionSummaryObj() {
  const m = (typeof _impactMetrics === "function") ? _impactMetrics() : {};
  return {
    code: (typeof sessionNum !== "undefined" && sessionNum) ? sessionNum : "",
    at: Date.now(),
    participants: m.present || 0,
    rooms: m.roomCount || 0,
    contribPct: (m.contribPct != null) ? m.contribPct : null,
    meanGini: (m.meanGini != null) ? Math.round(m.meanGini * 100) / 100 : null,
    decisionAccuracyPct: (m.decisionAccuracyPct != null) ? m.decisionAccuracyPct : null,
    answers: m.answers || 0,
    normGain: (m.gain && m.gain.meanNormGain != null) ? m.gain.meanNormGain : null,
    prePct: (m.gain && m.gain.meanPrePct != null) ? m.gain.meanPrePct : null,
    postPct: (m.gain && m.gain.meanPostPct != null) ? m.gain.meanPostPct : null,
    nPaired: (m.gain && m.gain.nPaired) ? m.gain.nPaired : 0,
    // Per-decision correct-rate for this session (id → %), so the cross-session
    // item-difficulty view can see which decisions consistently trip rooms up.
    decAcc: (m.decAgg || []).reduce(function (acc, d) {
      if (d.id && d.committedRooms > 0) acc[d.id] = Math.round((d.correctRooms / d.committedRooms) * 100);
      return acc;
    }, {})
  };
}

/* Lazy-load admin-tools.js (accreditation evidence, research export,
   attestations, program rollup), then invoke one of its exported functions.
   Keeps those heavy report generators off the splash critical path. */
function runAdminTool(fnName) {
  const call = () => {
    const fn = (window.CanamedAdminTools && window.CanamedAdminTools[fnName]) || window[fnName];
    if (typeof fn === "function") fn();
    else if (typeof toast === "function") toast("Report tool unavailable.");
  };
  const loader = window.CanamedLoader;
  if (loader && loader.ensureAdminTools) {
    if (typeof toast === "function") toast("Preparing…");
    loader.ensureAdminTools().then(call).catch(() => {
      if (typeof toast === "function") toast("Could not load the report tools — check your connection.");
    });
  } else {
    call();
  }
}

/* Pre→post knowledge gain across the cohort. Reads the per-participant test
   scores already in allRooms (rooms/<r>/tests/<cid>/{pre,post}/score), keyed
   by clientId; PRETEST/POSTTEST bank lengths give the maxima. Pairs a person's
   pre + post by cid (most students keep one tab; the stableId field supports
   stricter offline linkage). Reports mean pre%, mean post%, and Hake's
   normalized gain g = (post% − pre%) / (100 − pre%) — the standard
   education-research learning-gain metric. Aggregate; no names. */
function _knowledgeGain() {
  const rooms = (typeof _debriefRoomList === "function")
    ? _debriefRoomList()
    : roomNames(typeof roomCount !== "undefined" ? roomCount : 0).filter(r => allRooms[r] != null);
  const preMax = Array.isArray(window.PRETEST) ? window.PRETEST.length : 0;
  const postMax = Array.isArray(window.POSTTEST) ? window.POSTTEST.length : 0;
  let nPre = 0, nPost = 0, nPaired = 0, nGain = 0;
  let sumPre = 0, sumPost = 0, sumGain = 0;
  rooms.forEach(r => {
    const tests = (allRooms[r] || {}).tests || {};
    Object.keys(tests).forEach(cid => {
      const t = tests[cid] || {};
      const pre = t.pre, post = t.post;
      const preDone = pre && !pre.skipped && typeof pre.score === "number" && preMax > 0;
      const postDone = post && !post.skipped && typeof post.score === "number" && postMax > 0;
      if (preDone) nPre++;
      if (postDone) nPost++;
      if (preDone && postDone) {
        nPaired++;
        const prePct = (pre.score / preMax) * 100;
        const postPct = (post.score / postMax) * 100;
        sumPre += prePct; sumPost += postPct;
        if (prePct < 100) { sumGain += (postPct - prePct) / (100 - prePct); nGain++; }
      }
    });
  });
  return {
    preMax: preMax, postMax: postMax, nPre: nPre, nPost: nPost, nPaired: nPaired,
    meanPrePct: nPaired ? Math.round(sumPre / nPaired) : null,
    meanPostPct: nPaired ? Math.round(sumPost / nPaired) : null,
    meanNormGain: nGain ? Math.round((sumGain / nGain) * 100) / 100 : null
  };
}

/* Printer glyph for GENERATED standalone report documents (opened in their
   own window, where the index.html sprite is out of reach — so this is the
   one full inline literal; in-page icons all go through the sprite). */
var PRINT_ICON_SVG =
  "<svg width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor'" +
  " stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'" +
  " class='pic' aria-hidden='true'>" +
  "<path d='M7 8V4h10v4'/><rect x='4' y='8' width='16' height='8' rx='1.6'/>" +
  "<path d='M7 13h10v7H7Z'/></svg>";

/* ── Impact report ────────────────────────────────────────────────────────
   A one-click, dean-ready summary of the session, assembled CLIENT-SIDE from
   the data already live on the admin dashboard (allRooms). Opens as a
   self-contained, printable page (Save as PDF). Aggregate + pseudonymous: NO
   individual names — only counts, rates and balance measures. No new Firebase
   path. Built to drop straight into an accreditation dossier or partnership
   report: participation + equity, decision quality (a reasoning proxy),
   engagement, and a per-room appendix. */
function _impactMetrics() {
  const rooms = (typeof _debriefRoomList === "function")
    ? _debriefRoomList()
    : roomNames(roomCount).filter(r => allRooms[r] != null);
  let present = 0, contributing = 0, giniSum = 0, giniN = 0, unevenRooms = 0;
  let answers = 0, hypotheses = 0, decisionsCommitted = 0;
  const perRoom = [];

  rooms.forEach(r => {
    const d = allRooms[r] || {};
    const part = (typeof roomParticipation === "function")
      ? roomParticipation(d) : { present: 0, contributing: 0, gini: 0 };
    present += part.present || 0;
    contributing += part.contributing || 0;
    if ((part.present || 0) >= 3 && (part.contributing || 0) >= 2) {
      giniSum += part.gini || 0; giniN++;
    }
    if ((part.present || 0) >= 2 && (part.contributing || 0) < (part.present || 0)) unevenRooms++;

    const ans = d.answers || {};
    let roomAnswers = 0;
    ["moduleA", "moduleB"].forEach(mk => { roomAnswers += Object.keys(ans[mk] || {}).length; });
    answers += roomAnswers;
    hypotheses += Object.keys(d.hypotheses || {}).length;

    const votes = d.votes || {};
    let roomCommitted = 0;
    Object.keys(votes).forEach(id => {
      if (votes[id] && votes[id].committed && typeof votes[id].committed.choice === "number") {
        roomCommitted++;
      }
    });
    decisionsCommitted += roomCommitted;

    const score = (typeof _debriefBucket === "function") ? _debriefBucket(d).total : 0;
    perRoom.push({
      room: r, team: d.teamName || "",
      present: part.present || 0, contributing: part.contributing || 0,
      gini: part.gini || 0, answers: roomAnswers, committed: roomCommitted, score: score
    });
  });

  // Decision accuracy across rooms — a reasoning proxy: per DECISION, of the
  // rooms that locked an answer in, how many chose the safest (correct) option.
  const decAgg = [];
  const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
  let totalCommitted = 0, totalCorrect = 0;
  decList.forEach(dec => {
    let committedRooms = 0, correctRooms = 0;
    rooms.forEach(r => {
      const v = ((allRooms[r] || {}).votes || {})[dec.id] || {};
      const c = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
      if (c == null) return;
      committedRooms++;
      const opt = (dec.options || [])[c];
      if (opt && opt.correct) correctRooms++;
    });
    if (committedRooms > 0) {
      decAgg.push({ id: dec.id, prompt: tc(dec.prompt, _curLang()), module: dec.module || "",
                    committedRooms: committedRooms, correctRooms: correctRooms });
      totalCommitted += committedRooms; totalCorrect += correctRooms;
    }
  });

  return {
    rooms: rooms, perRoom: perRoom, decAgg: decAgg,
    roomCount: rooms.length, present: present, contributing: contributing,
    contribPct: present ? Math.round((contributing / present) * 100) : 0,
    meanGini: giniN ? (giniSum / giniN) : null, unevenRooms: unevenRooms,
    answers: answers, hypotheses: hypotheses, decisionsCommitted: decisionsCommitted,
    decisionAccuracyPct: totalCommitted ? Math.round((totalCorrect / totalCommitted) * 100) : null,
    gain: _knowledgeGain()
  };
}

/* HTML-escape for values interpolated into the report document. The report is
   opened in a fresh window (no platform CSP), so we escape defensively even
   though the inputs are aggregate numbers + the session code. */
function _impactEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateImpactReport() {
  const m = _impactMetrics();
  const when = new Date();
  const giniTxt = m.meanGini == null ? "—"
    : m.meanGini.toFixed(2) + " (" +
      (m.meanGini < 0.2 ? "even" : m.meanGini < 0.4 ? "slightly uneven" : "uneven") + ")";
  const accTxt = m.decisionAccuracyPct == null ? "—" : m.decisionAccuracyPct + "%";
  const g = m.gain || {};
  const gainKpi = (g.meanNormGain == null) ? "—" : ("+" + g.meanNormGain.toFixed(2));

  const decRows = m.decAgg.map(d => {
    const pct = d.committedRooms ? Math.round((d.correctRooms / d.committedRooms) * 100) : 0;
    return "<tr><td>" + (d.module ? "[" + _impactEsc(d.module) + "] " : "") + _impactEsc(d.prompt) +
      "</td><td class='num'>" + d.correctRooms + "/" + d.committedRooms +
      "</td><td class='num'>" + pct + "%</td></tr>";
  }).join("");

  const roomRows = m.perRoom.map(r =>
    "<tr><td>" + _impactEsc(r.room) + (r.team ? " — " + _impactEsc(r.team) : "") +
    "</td><td class='num'>" + r.contributing + "/" + r.present +
    "</td><td class='num'>" + (r.present >= 3 && r.contributing >= 2 ? r.gini.toFixed(2) : "—") +
    "</td><td class='num'>" + r.answers + "</td><td class='num'>" + r.committed +
    "</td><td class='num'>" + r.score + "</td></tr>"
  ).join("");

  const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Session Impact Report</title><style>" +
"*{box-sizing:border-box}body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2733;max-width:900px;margin:0 auto;padding:32px 24px;background:#fff}" +
"h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px;border-bottom:2px solid #2563eb;padding-bottom:4px;color:#16335c}" +
".sub{color:#5b6b7b;margin:0 0 20px}.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}" +
".kpi{flex:1 1 150px;border:1px solid #e1e7ed;border-radius:10px;padding:12px 14px;background:#f7f9fb}" +
".kpi .v{font-size:1.6rem;font-weight:700;color:#16335c}.kpi .l{font-size:.8rem;color:#5b6b7b}" +
"table{width:100%;border-collapse:collapse;margin:8px 0;font-size:.92rem}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e8edf2}" +
"th{background:#f0f4f8;color:#16335c}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}" +
".note{font-size:.85rem;color:#5b6b7b;background:#f7f9fb;border-left:3px solid #2563eb;padding:10px 12px;border-radius:6px;margin:10px 0}" +
".foot{margin-top:28px;font-size:.8rem;color:#7a8694;border-top:1px solid #e8edf2;padding-top:12px}" +
".pic{vertical-align:-0.125em}" +
"@media print{.noprint{display:none}body{padding:0}}" +
".pbtn{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:.95rem;cursor:pointer}" +
"</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>" + PRINT_ICON_SVG + " Print / Save as PDF</button>" +
"<h1>CANAMED — Session Impact Report</h1>" +
"<p class='sub'>Session <strong>" + _impactEsc(typeof sessionNum !== "undefined" ? sessionNum : "—") +
"</strong> · generated " + _impactEsc(when.toLocaleString()) + "</p>" +

"<h2>At a glance</h2><div class='kpis'>" +
"<div class='kpi'><div class='v'>" + m.present + "</div><div class='l'>participants present</div></div>" +
"<div class='kpi'><div class='v'>" + m.roomCount + "</div><div class='l'>active rooms</div></div>" +
"<div class='kpi'><div class='v'>" + m.contribPct + "%</div><div class='l'>actively contributing</div></div>" +
"<div class='kpi'><div class='v'>" + accTxt + "</div><div class='l'>decisions reached the safest answer</div></div>" +
"<div class='kpi'><div class='v'>" + gainKpi + "</div><div class='l'>knowledge gain (pre→post, g)</div></div>" +
"</div>" +

"<h2>Knowledge gain (pre → post)</h2>" +
(g.nPaired
  ? "<p>Among the <strong>" + g.nPaired + "</strong> participant(s) who completed BOTH the pre- and post-test, " +
    "mean score rose from <strong>" + (g.meanPrePct == null ? "—" : g.meanPrePct + "%") + "</strong> to <strong>" +
    (g.meanPostPct == null ? "—" : g.meanPostPct + "%") + "</strong>" +
    (g.meanNormGain == null ? "" : ", a normalized learning gain of <strong>g = " + g.meanNormGain.toFixed(2) +
      "</strong> (Hake's g; 0 = no gain, 1 = closed the whole gap)") + ". " +
    "(" + g.nPre + " pre-tests, " + g.nPost + " post-tests completed.)</p>" +
    "<p class='note'>Normalized gain is the standard education-research learning-outcome metric — the headline " +
    "evidence that the session <em>taught</em>, not just engaged. Pre↔post are paired per participant.</p>"
  : "<p>No paired pre/post tests are complete yet — the gain fills in once participants finish both tests. " +
    "(" + (g.nPre || 0) + " pre, " + (g.nPost || 0) + " post completed.)</p>") +

"<h2>Participation &amp; equity</h2>" +
"<p>" + m.contributing + " of " + m.present + " present participants actively contributed (" +
m.contribPct + "%). Mean contribution balance (Gini) across rooms with enough activity to measure: <strong>" +
giniTxt + "</strong> — 0 is perfectly even, 1 is one person carrying the room. " +
m.unevenRooms + " room(s) flagged as uneven for facilitator follow-up.</p>" +
"<p class='note'>Equity is a first-class outcome of this design: the platform measures whether <em>every</em> student engages, not just the average — directly relevant to inclusive-teaching and the cross-cultural (Caen × Nagoya) cohort.</p>" +

"<h2>Decision quality (clinical-reasoning proxy)</h2>" +
(decRows ? "<table><thead><tr><th>Team decision</th><th class='num'>safest</th><th class='num'>%</th></tr></thead><tbody>" +
  decRows + "</tbody></table>" +
  "<p>Across all committed team decisions, <strong>" + accTxt +
  "</strong> reached the safest option. These are deliberate, discussed choices on hard communication/ethics calls — a reasoning signal, not recall.</p>"
  : "<p>No team decisions were locked in yet.</p>") +

"<h2>Engagement</h2><div class='kpis'>" +
"<div class='kpi'><div class='v'>" + m.answers + "</div><div class='l'>group answers contributed</div></div>" +
"<div class='kpi'><div class='v'>" + m.hypotheses + "</div><div class='l'>working hypotheses</div></div>" +
"<div class='kpi'><div class='v'>" + m.decisionsCommitted + "</div><div class='l'>team decisions committed</div></div>" +
"</div>" +

"<h2>Per-room appendix</h2>" +
(roomRows ? "<table><thead><tr><th>Room</th><th class='num'>contributing</th><th class='num'>balance</th>" +
  "<th class='num'>answers</th><th class='num'>decisions</th><th class='num'>score</th></tr></thead><tbody>" +
  roomRows + "</tbody></table>" : "<p>No room activity recorded.</p>") +

"<div class='foot'><p><strong>Methodology &amp; privacy.</strong> Figures are computed client-side from this " +
"session's live data and are <strong>aggregate and pseudonymous</strong> — no individual is named. " +
"Decision accuracy counts a room's <em>committed</em> choice against the clinically-safest option defined " +
"in the case. Satisfaction and knowledge gain (pre/post) are captured separately via the session " +
"questionnaire and pre/post tests. This report is intended as supporting evidence of communication-skills " +
"teaching activity and student engagement.</p></div>" +
"</body></html>";

  // Open in a new window (user-gesture, so not popup-blocked). Fall back to a
  // downloadable .html file if the browser blocks the popup.
  let w = null;
  try { w = window.open("", "_blank"); } catch (e) { /* blocked */ }
  if (w && w.document) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } else {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CANAMED_Session" + (typeof sessionNum !== "undefined" ? sessionNum : "") + "_impact_report.html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
  if (typeof toast === "function") toast("Impact report generated.");
}

/* Download archive (2026-06-25, user request) — replaces the old plain-text /
 * Markdown "download all group answers" exports with a single structured
 * snapshot of the whole session, offered in CSV or JSON. Built inline (no lazy
 * admin-tools chunk) so it's always available from the dashboard. Honours the
 * "Pseudonymise names" toggle: when on, contributor names become "Student A,
 * B, …" per room (same scheme as the old export). Robust to the Module A
 * answer restructure — it reads whatever answer entries exist, by bulletKey. */
function _archiveCsvCell(v) {
  let s = String(v == null ? "" : v);
  // Neutralise spreadsheet formula injection: a cell beginning with = + - @ (or
  // a leading tab/CR Excel trims) is run as a formula (e.g. =HYPERLINK / =cmd|).
  // The archive flattens untrusted free-text answers into cells, so prefix a
  // single quote to force literal text in Excel / Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/* ── S4 — the research export, v2 ─────────────────────────────────────────────
 * A session is opening + N picked sections + wrap-up, so an export keyed by
 * `moduleA` / `moduleB` can no longer describe one: two sections of the SAME
 * type collide on the key, and the room's state has lived at
 * rooms/$roomId/sections/$slot since S2b-2 — the v1 reader was pointing at
 * nodes nothing writes any more, so it had silently started exporting empties.
 *
 * v2 is a CLEAN BREAK (decision 6), plus a converter for archived v1 files
 * (scripts/convert-archive-v2.js) so the whole dataset ends up one shape.
 *
 * Every row carries its SLOT and the section that ran there, which is what
 * makes a mixed session analysable at all: "the PBL answers" means nothing when
 * a session ran two different PBL sections. */
const ARCHIVE_EXPORT_VERSION = 2;

function _archiveSectionManifest() {
  return sectionSlots().map(sl => {
    const sec = (typeof window !== "undefined" &&
                 (window.CANAMED_SECTIONS || {})[sl.sectionId]) || null;
    const title = (sec && sec.name && (sec.name.en || sec.name)) ||
                  (sl.module ? moduleNameEn(sl.module) : "") || "";
    return { slot: sl.position, sectionId: sl.sectionId || null,
             type: sl.type || null, title: String(title) };
  });
}
function _sessionArchiveData(anon) {
  const manifest = _archiveSectionManifest();
  const rooms = [];
  roomNames(roomCount).forEach(r => {
    const data = allRooms[r] || {};
    const st = typeof data.stage === "number" ? data.stage : 0;
    const aliasMap = {};
    let aliasN = 0;
    const labelFor = nm => {
      if (!anon) return nm || "";
      if (!nm) return "";
      if (!(nm in aliasMap)) {
        const letter = String.fromCharCode(65 + (aliasN % 26));
        const suffix = aliasN >= 26 ? String(Math.floor(aliasN / 26) + 1) : "";
        aliasMap[nm] = "Student " + letter + suffix;
        aliasN++;
      }
      return aliasMap[nm];
    };
    const mapEntries = obj => entriesSorted(obj).map(e => ({
      by: labelFor(e.by), university: e.university || "",
      bulletKey: e.bulletKey || "", text: e.text || ""
    }));
    const mapHyps = obj => Object.keys(obj || {}).map(k => obj[k]).filter(Boolean)
      .sort((a, b) => (a.at || 0) - (b.at || 0))
      .map(h => ({ by: labelFor(h.by), university: h.university || "", text: h.text || "" }));

    /* Driven by the MANIFEST, not by whichever keys happen to exist: a slot
       that ran and produced nothing must still appear, or its silence is
       indistinguishable from it never having run. */
    /* One address resolver for every snapshot reader (roomSlotBuckets), so a
       future path move cannot fix the dashboard and miss the export again. */
    const perSlot = {};
    roomSlotBuckets(data).forEach(b => {
      perSlot[String(b.slot)] = {
        hypotheses: mapHyps(b.hypotheses),
        answers: mapEntries(b.answers)
      };
    });
    rooms.push({
      room: r,
      stageReached: stageLabelEn(st),
      score: (typeof scoreTotal === "function") ? scoreTotal(data) : null,
      sections: perSlot
    });
  });
  return {
    session: sessionNum,
    exportVersion: ARCHIVE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    pseudonymised: !!anon,
    sections: manifest,
    rooms: rooms
  };
}
function _sessionArchiveToCSV(archive) {
  const headers = ["room", "stageReached", "score", "slot", "sectionId", "sectionType",
                   "kind", "author", "university", "bulletKey", "text"];
  const bySlot = {};
  (archive.sections || []).forEach(m => { bySlot[String(m.slot)] = m; });
  const rows = [];
  (archive.rooms || []).forEach(rm => {
    const base = [rm.room, rm.stageReached, rm.score == null ? "" : rm.score];
    let any = false;
    Object.keys(rm.sections || {}).forEach(slot => {
      const m = bySlot[slot] || {};
      const sBase = base.concat([slot, m.sectionId || "", m.type || ""]);
      const bucket = rm.sections[slot] || {};
      (bucket.hypotheses || []).forEach(h => {
        any = true;
        rows.push(sBase.concat(["hypothesis", h.by, h.university, "", h.text]));
      });
      (bucket.answers || []).forEach(e => {
        any = true;
        rows.push(sBase.concat(["answer", e.by, e.university, e.bulletKey, e.text]));
      });
    });
    if (!any) rows.push(base.concat(["", "", "", "(empty)", "", "", "", ""]));
  });
  const head = headers.join(",");
  const body = rows.map(row => row.map(_archiveCsvCell).join(",")).join("\r\n");
  // Leading BOM so Excel reads the UTF-8 correctly.
  return "﻿" + head + "\r\n" + body + "\r\n";
}
function downloadSessionArchive(format) {
  const anon = !!(el("anon-export") && el("anon-export").checked);
  const archive = _sessionArchiveData(anon);
  let text, ext, mime;
  if (format === "json") {
    text = JSON.stringify(archive, null, 2);
    ext = "json"; mime = "application/json";
  } else {
    text = _sessionArchiveToCSV(archive);
    ext = "csv"; mime = "text/csv";
  }
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "CaNaMED_Session" + sessionNum + "_archive" +
    (anon ? "_pseudonymised" : "") + "." + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* The wrap-up TAKE-HOME block — the takeaway Markdown, the certificate PDF and
   the study booklet — was MOVED OUT of this file into the lazy takehome.js on
   2026-08-04 (perf reclaim, slice 1 of ARCHITECTURE/eager-bundle-reclaim-plan.md).
   It is wrap-up-only code behind a download click, so it never belonged on the
   splash critical path. initEndPoll() below loads it via
   CanamedLoader.ensureTakeHome() when one of the three buttons is clicked.
   Do not restore a copy here — tests/takehome-lazy-split.test.js fails if you do. */

/* ===================== ROOM VIEW: STAGE & NAVIGATION ===================== */
/* Late-join banner. R3-C1 fix: every visible string flows through tFallback()
   so a Japanese / French / German late-joiner sees a localised message at the
   exact moment the platform is most disorienting. stageLabel(stage) already
   handles per-language stage names — re-using it keeps the banner consistent
   with the rest of the chrome. */
