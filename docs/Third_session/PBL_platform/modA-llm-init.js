/* modA-llm-init.js — wires modALLMBridge into the live Firebase + DOM stack.
 *
 * Loaded after script.js (which exposes `db`, `sPath`, `refRevealed`,
 * `reveal`, `revealed`, `toast`, `_curLang`, etc. as module-globals). The
 * bridge itself stays Firebase-agnostic — the hooks defined here are the
 * single integration point.
 *
 * Activation gate (all must be true):
 *   1. The LLM chat is NOT opted out — i.e. NOT `?llm=0` and
 *      localStorage.canamedModALLM !== "0". It is ON by default (2026-06-02):
 *      the chat is Module A's history-taking interface for every session.
 *   2. window.modALLMBridge / modAQuestionScoring / modALLMPrompts loaded
 *   3. startRoom() has populated refRevealed (i.e. we are in a real room)
 *   4. The room is in Module A (stage === 1)
 *
 * The HF backend still degrades gracefully: if the `hfPatient` function is
 * disabled (`MODA_LLM_ENABLED=false`) or errors, the bridge falls back to a
 * canned stub patient, so the chat never leaves Module A dead.
 */

(function () {
  "use strict";
  if (typeof window === "undefined") return;

  // Auto-promote ?llm=1 to localStorage as soon as this script loads.
  // Reason: the platform's join flow (splash → lobby → session → room) is a
  // multi-step internal navigation. The original URL's query string gets
  // stripped along the way, so by the time startRoom() calls modALLMInit(),
  // ?llm=1 is gone and the flag check fails. Persisting to localStorage on
  // FIRST page-load makes the flag survive the entire flow.
  // Default-ON (2026-06-02): persist only the OPT-OUT so it survives the
  // multi-step join flow (which strips the query string). `?llm=0` → sticky
  // off (facilitator demo / debug); `?llm=1` → clear the opt-out (back to
  // default). Mirrors modALLMFlagOn() in script-loader.js.
  try {
    var _initialParams = new URLSearchParams(location.search);
    if (window.localStorage) {
      if (_initialParams.get("llm") === "0") localStorage.setItem("canamedModALLM", "0");
      else if (_initialParams.get("llm") === "1") localStorage.removeItem("canamedModALLM");
    }
  } catch (_) { /* private mode / locked-down env — fall back to URL-only check */ }

  function _flagOn() {
    try {
      var q = new URLSearchParams(location.search).get("llm");
      if (q === "0") return false;                                          // explicit opt-out
      if (q === "1") return true;                                           // explicit opt-in
      if (window.localStorage && localStorage.getItem("canamedModALLM") === "0") return false; // sticky opt-out
    } catch (_) { /* SSR / locked-down env — fall through to the default */ }
    return true;   // default ON
  }

  function _$(id) { return document.getElementById(id); }

  /* DOM-safe element factory. Uses setAttribute/textContent so user-controlled
   * strings (placeholder text, button labels) never run as HTML. Mirrors the
   * bridge's private _ce helper; kept here so this file doesn't depend on
   * bridge internals. */
  function _ce(tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (k === "class") el.className = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    if (text != null) el.textContent = String(text);
    return el;
  }

  function _curLang() {
    if (typeof window.getLang === "function") return window.getLang();
    return "en";
  }

  function _t(key, fallback) {
    // i18n.js exposes window.t(key) — returns the active-language string
    // or "" if the key is missing. Fall back to the inline English copy
    // so the chat panel is still readable if i18n hasn't initialised.
    try {
      if (typeof window.t === "function") {
        var v = window.t(key);
        if (v) return v;
      }
    } catch (_) { /* fall through */ }
    return fallback;
  }

  /* ------------- DOM: build (or reveal) the chat panel ------------- */

  /* DOM-safe panel construction — no innerHTML interpolation of i18n strings
   * anywhere user-controlled content lands. The disclosure carries a single
   * <a href="privacy.html"> link (operator-controlled i18n), so we set its
   * innerHTML once with the trusted translation; everything else is
   * createElement + textContent. (M1 from the 2026-05-28 review.) */
  function _mountChatUI(host) {
    if (host.querySelector("#modA-chat-panel")) return host.querySelector("#modA-chat-panel");

    var panel  = _ce("div", { id: "modA-chat-panel", "class": "moda-chat-panel" });
    var notice = _ce("div", { "class": "moda-chat-disclosure", role: "note" });
    // i18n string is operator-controlled and contains <strong> / <a>. Setting
    // innerHTML here is acceptable because the source is a static translation
    // file, NOT a runtime-modifiable input. If translations ever become
    // user-editable, replace with explicit createElement nodes.
    notice.innerHTML = _t("modA.chat.disclosure",
      "Beta: a language model voices the patient. Your typed questions are sent to our server and to Hugging Face as a third-party sub-processor. Do not type names, contact details, or anything personal.");

    var consentRow = _ce("div", { "class": "moda-chat-consent", id: "modA-chat-consent" });
    var consentBtn = _ce("button", { type: "button", "class": "moda-chat-consent-btn", id: "modA-chat-consent-btn" },
                         _t("modA.chat.consentCta", "I understand — start the consultation"));
    consentRow.appendChild(consentBtn);

    var transcript = _ce("div", {
      "class": "moda-chat-transcript", id: "modA-chat-transcript",
      "aria-live": "polite", "aria-busy": "false"
    });
    var form  = _ce("form", { "class": "moda-chat-form", id: "modA-chat-form", autocomplete: "off" });
    var input = _ce("textarea", {
      id: "modA-chat-input", rows: "2", maxlength: "500",
      placeholder: _t("modA.chat.placeholder", "Ask Mr. Lefebvre a question…")
    });
    var send  = _ce("button", { type: "submit", id: "modA-chat-send" },
                    _t("modA.chat.send", "Send"));
    form.appendChild(input);
    form.appendChild(send);

    var status = _ce("div", {
      "class": "moda-chat-status", id: "modA-chat-status", "aria-live": "polite"
    });

    panel.appendChild(notice);
    panel.appendChild(consentRow);
    panel.appendChild(transcript);
    panel.appendChild(form);
    panel.appendChild(status);
    host.appendChild(panel);

    // Gate input behind one-time consent (H5 from the 2026-05-28 review).
    // Re-shown until acknowledged this session; persisted in localStorage so
    // repeat-joiners don't see it again.
    function _hasConsent() {
      try { return localStorage.getItem("canamedModALLMConsent") === "1"; }
      catch (_) { return false; }
    }
    function _setConsent() {
      try { localStorage.setItem("canamedModALLMConsent", "1"); } catch (_) { /* private mode */ }
    }
    function _applyConsentState() {
      var ok = _hasConsent();
      consentRow.style.display = ok ? "none" : "";
      input.disabled = !ok;
      send.disabled = !ok;
      if (!ok) input.setAttribute("placeholder",
        _t("modA.chat.consentRequired", "Please confirm the notice above before sending."));
    }
    consentBtn.addEventListener("click", function () {
      _setConsent();
      _applyConsentState();
      input.setAttribute("placeholder", _t("modA.chat.placeholder", "Ask Mr. Lefebvre a question…"));
      input.focus();
    });
    _applyConsentState();

    return panel;
  }

  function _renderTurn(transcriptEl, role, content) {
    if (!transcriptEl) return;
    var bub = document.createElement("div");
    bub.className = "moda-chat-bub moda-chat-bub-" + role;
    bub.textContent = content;
    transcriptEl.appendChild(bub);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function _setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.dataset.kind = kind || "";
  }

  /* ------------- Firebase wiring ------------- */

  function _refs() {
    var db = window.db;
    var sPath = window.sPath;
    if (!db || typeof sPath !== "function" || !window.myRoom) return null;
    var roomBase  = sPath("rooms/" + window.myRoom);
    var modABase  = roomBase + "/moduleA";
    var scoreBase = roomBase + "/score";
    return {
      chat:           db.ref(modABase + "/chat"),
      awarded:        db.ref(modABase + "/scoring/awarded"),
      points:         db.ref(modABase + "/scoring/points"),
      // ALSO write to the platform-wide score subtree so:
      //   - the existing scoreTotal() helper sums chat points into the room total
      //   - the existing refScore listener fires → renderScore() → renderObjectives()
      //     and the new awards show up in the right-column scoring sidebar
      //     alongside the existing concept rows (SCORE_AUTO + SCORING.moduleA)
      scoreAuto:      db.ref(scoreBase + "/auto"),
      scorePenalties: db.ref(scoreBase + "/penalties")
    };
  }

  /* ------------- public init() ------------- */

  function init() {
    if (!_flagOn()) return false;
    if (!window.modALLMBridge || !window.modAQuestionScoring || !window.modALLMPrompts) {
      return false;
    }
    var host = _$("chart-section-history");
    var btnGroup = _$("group-history");
    if (!host) return false;

    var refs = _refs();
    if (!refs) return false;

    // Chat-only mode (user request 2026-05-28): the legacy click-button
    // workup (Ask the patient / Examine / Investigations / Synthesis) is
    // entirely replaced by the chat. We add a body class so the CSS
    // selector hides ALL four button groups uniformly — buildButtons()
    // re-creates them after this runs, so a one-shot `.hidden = true`
    // gets blown away on the next render. A CSS class on <body> is
    // robust against any DOM rebuild.
    document.body.classList.add("moda-llm-active");
    var panel = _mountChatUI(host);
    var transcriptEl = panel.querySelector("#modA-chat-transcript");
    var inputEl = panel.querySelector("#modA-chat-input");
    var sendEl = panel.querySelector("#modA-chat-send");
    var statusEl = panel.querySelector("#modA-chat-status");
    var formEl = panel.querySelector("#modA-chat-form");

    // Local cache of the awarded map (mirrors RTDB; the bridge reads it
    // synchronously). The .on() subscription below keeps it fresh.
    var awarded = {};
    refs.awarded.on("value", function (snap) {
      awarded = snap.val() || {};
    });

    // Replay existing transcript when a teammate refreshes mid-session.
    refs.chat.on("child_added", function (snap) {
      var t = snap.val();
      if (!t || !t.role || !t.content) return;
      _renderTurn(transcriptEl, t.role, t.content);
      // Seed the local context ring lazily — bridge has its own copy.
    });

    var bridge = window.modALLMBridge.create({
      getAwarded: function () { return awarded; },
      onAward: function (famId, fam) {
        // Once-only guard at RTDB level via write-with-condition. We mirror
        // the value locally + write the family id; rules enforce write-once
        // (see database.rules.json updates in task 8).
        if (awarded[famId]) return;
        awarded[famId] = true;
        var pts = (fam && fam.points) || 0;
        var now = Date.now();
        // 1. Fine-grained inspection log (one record per family, with at + points)
        refs.awarded.child(famId).transaction(function (cur) {
          return cur == null ? { at: now, points: pts } : undefined;
        });
        // 2. Platform-wide score path: makes the chat award count toward the
        //    team total via the existing scoreTotal() helper, AND triggers
        //    renderObjectives() so the row shows up in the right-column sidebar.
        //    Event id `chatA_<famId>` mirrors the existing `conceptA_<famId>`
        //    convention used by SCORING.moduleA concepts.
        refs.scoreAuto.child("chatA_" + famId).transaction(function (cur) {
          return cur == null ? { points: pts, at: now } : undefined;
        });
      },
      onPenalty: function (famId, fam) {
        if (awarded[famId]) return;
        awarded[famId] = true;
        var pts = (fam && fam.points) || 0;
        var now = Date.now();
        // 1. Fine-grained inspection log (negative points to mark it as penalty)
        refs.awarded.child(famId).transaction(function (cur) {
          return cur == null ? { at: now, points: -pts } : undefined;
        });
        // 2. Platform-wide penalty path: scoreTotal() subtracts the sum of
        //    score/penalties from the team total. Stored as a POSITIVE value
        //    (the math is `auto + min(manual,cap) - pen`). The renderObjectives
        //    penalty section picks it up automatically once penaltyMeta() is
        //    taught to look up chat-penalty IDs in SCORING.moduleA_question_penalties.
        refs.scorePenalties.child(famId).transaction(function (cur) {
          return cur == null ? { points: pts, at: now } : undefined;
        });
      },
      onUnlock: function (legacyId) {
        // The chat's red-flag questions still reveal their legacy history items
        // (e.g. history:1) via the first-write-wins path, so SYNTH_PREREQS /
        // prereqsMet() and the red-flag SCORING stay deterministic.
        if (typeof window.reveal === "function") {
          try { window.reveal(legacyId); } catch (_) { /* defensive */ }
        }
        // NB (2026-06-02): the chat no longer AUTO-reveals the synthesis. The
        // on-screen Clinical synthesis section was removed entirely — its model
        // write-up now ships only in the stage-4 take-home (downloadMyRoomAnswers).
        // The ≥2-hypotheses phase gate (phaseGateOpen) drives the Debate reveal;
        // the red-flag screen is scoring-only now, not a gate.
      },
      persistTurn: function (role, content) {
        refs.chat.push({ role: role, content: content, at: Date.now() });
      },
      logError: function (err) {
        if (window.CanamedTelemetry && window.CanamedTelemetry.record) {
          try { window.CanamedTelemetry.record("modA-llm-error", { msg: String(err && err.message || err) }); }
          catch (_) { /* telemetry optional */ }
        }
      }
    });

    bridge.setLang(_curLang());

    // Wire the patient endpoint. Priority order:
    //   1. Firebase HTTPS callable (when the SDK + the deployed function
    //      are present). This is the secure default — App Check token is
    //      injected automatically, HF token never leaves the server, and
    //      the dormant `moda.llm` flag controls activation.
    //   2. Plain HTTP endpoint via window.CANAMED_LLM_ENDPOINT (escape
    //      hatch for facilitators who run their own proxy — e.g. a
    //      Cloudflare Worker fronting an HF Space).
    //   3. Local stub (no network) — what unit-tests and offline demos use.
    var fb = window.firebase;
    if (fb && typeof fb.functions === "function") {
      try {
        var raw = fb.functions().httpsCallable("hfPatient");
        // Wrap the callable so every request carries the verified room
        // context. The server (functions/index.js _verifyMembership) checks
        // rooms/<id>/uidMembers/<uid>; without these fields the call is
        // rejected as permission-denied, closing the "any authed anon can
        // spend HF tokens" hole flagged in the 2026-05-28 security review.
        var sessionCode = String(window.sessionNum || "");
        var orgSlug = window.CANAMED_ORG_SLUG ? String(window.CANAMED_ORG_SLUG) : "";
        var roomId = String(window.myRoom || "");
        bridge.setCallable(function (body) {
          var payload = Object.assign({}, body, {
            roomCode: sessionCode,
            roomId: roomId
          });
          if (orgSlug) payload.orgSlug = orgSlug;
          return raw(payload);
        });
      } catch (e) { /* SDK present but not configured — fall through */ }
    } else if (window.CANAMED_LLM_ENDPOINT && window.CANAMED_LLM_ENDPOINT.url) {
      // Escape-hatch fetch endpoint (e.g. a Cloudflare Worker proxy). This
      // bypasses Firebase App Check enforcement, so we REQUIRE an explicit
      // acknowledgeUnsafe:true flag (L1 from the 2026-05-28 review). Without
      // it the bridge stays in stub mode rather than silently leaving App
      // Check off for a real-user pilot.
      var ep = window.CANAMED_LLM_ENDPOINT;
      if (ep.acknowledgeUnsafe === true) {
        bridge.setEndpoint(ep.url, ep.headers || null);
      } else if (typeof console !== "undefined") {
        console.warn("[modA LLM] CANAMED_LLM_ENDPOINT ignored: missing acknowledgeUnsafe:true (App Check bypass)");
      }
    }

    // Re-sync language when the global lang switcher fires.
    window.addEventListener("canamed:langchange", function () {
      bridge.setLang(_curLang());
    });

    // Track consecutive fallbacks so we can escalate the facilitator banner
    // when the LLM endpoint is dead for the whole room, not just one turn.
    // (M6 from the 2026-05-28 review.)
    var _fallbackStreak = 0;
    var FALLBACK_STREAK_BANNER = 3;

    function _onSubmit(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var text = (inputEl.value || "").trim();
      if (!text) return;
      inputEl.value = "";
      inputEl.disabled = true;
      sendEl.disabled = true;
      _setStatus(statusEl, _t("modA.chat.thinking", "Mr. Lefebvre is thinking…"), "pending");
      transcriptEl.setAttribute("aria-busy", "true");

      bridge.submit(text).then(function (res) {
        if (res && res.fallback) {
          _fallbackStreak += 1;
          var msg = _t("modA.chat.fallbackNotice",
            "Patient endpoint unavailable — using a stub reply so the team can keep going.");
          if (_fallbackStreak >= FALLBACK_STREAK_BANNER) {
            msg += " (" + _fallbackStreak + " turns in a row — ask your facilitator to check the endpoint.)";
          }
          _setStatus(statusEl, msg, "warn");
        } else {
          _fallbackStreak = 0;
          _setStatus(statusEl, "", "");
        }
      }).catch(function (err) {
        _setStatus(statusEl, _t("modA.chat.error",
          "Something went wrong — try a different question."), "error");
        if (typeof window.toast === "function") {
          window.toast(_t("modA.chat.error", "Chat error"), String(err && err.message || err));
        }
      }).then(function () {
        inputEl.disabled = false;
        sendEl.disabled = false;
        transcriptEl.setAttribute("aria-busy", "false");
        inputEl.focus();
      });
    }

    formEl.addEventListener("submit", _onSubmit);
    // Enter submits, Shift+Enter adds a newline (familiar chat ergonomics)
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        _onSubmit(e);
      }
    });

    window.modALLMRuntime = { bridge: bridge, refs: refs };
    return true;
  }

  // Allow script.js to call this explicitly after startRoom() resolves.
  window.modALLMInit = init;
})();
