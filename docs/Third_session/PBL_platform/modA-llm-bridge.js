/* modA-llm-bridge.js
 *
 * Module A free-text patient interview (LLM-patient pilot, 2026-05-28).
 *
 * The bridge owns the CHAT UI and the SCORE-ON-EVERY-TURN loop. It is
 * deliberately decoupled from Firebase and from script.js: the host wires
 * up callbacks (onAward, onUnlock, persistTurn, ...) and the bridge calls
 * them in lockstep with the patient endpoint. This keeps the LLM piece
 * easy to unit-test and lets us swap the backend (HF Space, HF Inference
 * Providers API, Mistral, a local stub) without re-touching DOM code.
 *
 * RUNTIME CONTRACT (the only globals it touches):
 *   - window.modAQuestionScoring.scoreQuestion(text, awarded) → {award,penalty,unlocks}
 *   - window.modALLMPrompts.buildChatMessages(lang, transcript, userText)
 *   - window.CASE                — fact lookup for the local stub fallback
 *   - DOM in the container the host passes to init()
 *
 * No Firebase calls in here. No reveal() calls. All side effects go through
 * the host-supplied hooks.
 *
 * Loaded BEFORE script.js (so script.js can call init() once the room is set
 * up). In Node tests, require()'d via the window-shim pattern below.
 */

if (typeof window === "undefined") { var window = globalThis; }

(function (W) {
  "use strict";

  /* ---------------- defaults & config ---------------- */

  var DEFAULTS = {
    /* No endpoint by default → stub patient (canned answers from CASE.history[].a).
       Set via setEndpoint() when an HF Space / proxy is deployed. */
    endpointUrl: null,
    endpointHeaders: null,    // e.g. { "x-canamed-token": "<shared secret>" }
    timeoutMs: 25000,         // covers HF Space cold-starts up to ~25s
    contextTurns: 6,          // last N turns sent as chat history
    maxInputLen: 500,         // enforced client-side (rules cap too)
    maxReplyLen: 600,         // sanity cap on patient replies
    lang: "en"
  };

  /* ---------------- pure helpers ---------------- */

  function _ce(tag, attrs, text) {
    var el = (typeof document !== "undefined") ? document.createElement(tag) : null;
    if (!el) return null;
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        if (k === "class") el.className = attrs[k];
        else if (k === "dataset" && attrs[k]) {
          for (var d in attrs[k]) el.dataset[d] = attrs[k][d];
        } else el.setAttribute(k, attrs[k]);
      }
    }
    if (text != null) el.textContent = String(text);
    return el;
  }

  /* Reply sanitiser. Mirrors the server-side regex in functions/index.js so
   * a stale Cloud Function or a Worker proxy can't slip through formats the
   * server would have caught. (M4 + defence-in-depth from the 2026-05-28
   * review.) */
  // Role-prefix matcher. Tolerates markdown wrappers (**Patient**:) by allowing
  // up to ~40 chars of stuff between the role keyword and the colon — covers
  // ", age 45**" and similar emit patterns.
  var _ROLE_PREFIX_RE = /^\s*[*_"'`>「『]*\s*(\[[^\]]+\]\s*)?(patient|mr\.?\s*lefebvre|le\s+patient|réponse|response|回答|患者(?:さん)?|彼)[^:：\-—\n]{0,40}\s*[:：\-—]\s*/i;
  function _sanitiseReply(raw, maxLen) {
    if (raw == null) return "";
    var s = String(raw).trim();
    // Strip wrapper-style leading brackets first ("[Patient response]" /
    // "[Mr. Lefebvre says]") — these are NOT JSON arrays, they're model
    // formatting. The JSON-rejection check below must come AFTER this.
    s = s.replace(/^\s*\[[A-Za-z0-9 .,'!_'-]{1,60}\]\s*/, "");
    s = s.replace(_ROLE_PREFIX_RE, "").replace(_ROLE_PREFIX_RE, "");
    s = s.replace(/^\s*[-•*]\s+/, "");
    s = s.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "");
    if (/^\s*[{[]/.test(s)) return "";
    if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
    return s.trim();
  }

  /* ---------------- local stub patient ---------------- */
  /* When no endpoint is configured (offline / pre-pilot / E2E), we still
   * want the chat experience to work for development. The stub picks the
   * canned `.a` text of the *highest-scoring matching item* in CASE.history,
   * falling back to a generic "I'm not sure, doctor" line. This is also
   * what the E2E suite stubs, so test code doesn't need a network mock. */

  function _stubReply(userText, caseObj, lang) {
    if (!caseObj || !Array.isArray(caseObj.history)) {
      return _genericStubReply(lang);
    }
    var lowered = String(userText || "").toLowerCase();
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < caseObj.history.length; i++) {
      var it = caseObj.history[i];
      if (!it || !it.q || !it.a) continue;
      // Skip narratorOnly entries — these are third-person stage directions
      // ("He flinches and pulls away") for the click-mode UI's bad-move
      // consequences, not first-person patient speech. Letting the stub
      // surface them produced replies like "He looks relieved for a moment,
      // then uneasy..." in response to "Do you have pain when you pee?".
      if (it.narratorOnly) continue;
      var qText = "";
      ["en", "fr", "ja"].forEach(function (L) {
        var v = it.q && it.q[L];
        if (typeof v === "string") qText += " " + v.toLowerCase();
      });
      // Score = number of meaningful tokens in the user text that also appear
      // in the canonical question. Crude but enough to demo.
      var tokens = lowered.split(/[\s,.;:!?¿¡。、，！？]+/).filter(function (t) {
        return t.length >= 3;
      });
      var score = 0;
      for (var t = 0; t < tokens.length; t++) {
        if (qText.indexOf(tokens[t]) >= 0) score++;
      }
      if (score > bestScore) { bestScore = score; best = it; }
    }
    if (best && bestScore > 0) {
      var pick = best.a && (best.a[lang] || best.a.en);
      if (pick) return String(pick);
    }
    return _genericStubReply(lang);
  }

  function _genericStubReply(lang) {
    if (lang === "fr") return "Je ne suis pas sûr, docteur. Personne ne m'a jamais demandé ça.";
    if (lang === "ja") return "わかりません、先生。それは誰にも聞かれたことがありません。";
    return "I'm not sure, doctor. Nobody's ever asked me that.";
  }

  /* ---------------- endpoint call ---------------- */
  /* The endpoint is POST'd a JSON body of {messages, lang} and is expected
   * to return JSON {reply: "..."}. This shape works for a thin wrapper Space
   * around any chat model and is easy to mock in tests. */

  function _callEndpoint(url, headers, body, timeoutMs) {
    // Resolve fetch / AbortController via W first so unit tests can inject
    // mocks on the shared context (Node's globals leak through new Function
    // and would otherwise win). Falls back to whatever the runtime gives us.
    var fetchFn = (W && typeof W.fetch === "function") ? W.fetch
                 : (typeof fetch === "function") ? fetch : null;
    if (!fetchFn) return Promise.reject(new Error("fetch unavailable"));

    var AC = (W && typeof W.AbortController === "function") ? W.AbortController
            : (typeof AbortController === "function") ? AbortController : null;
    var ctrl = AC ? new AC() : null;
    var to = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;

    var init = {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: JSON.stringify(body)
    };
    if (ctrl) init.signal = ctrl.signal;

    return fetchFn(url, init)
      .then(function (r) {
        if (to) clearTimeout(to);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || typeof j.reply !== "string") throw new Error("malformed reply");
        return j.reply;
      });
  }

  /* ---------------- public Bridge ---------------- */

  function createBridge(hostHooks) {
    /* hostHooks: {
     *   onAward(famId, family)     - apply points + persist
     *   onPenalty(famId, family)   - apply penalty + persist
     *   onUnlock(legacyItemId)     - call existing reveal()
     *   persistTurn(role, content) - write to .../modA/chat/{turn}
     *   logError(err)              - optional, host-side logging
     *   getAwarded()               - returns { famId: true } map
     * }
     * Any missing hook is a no-op so the bridge is usable from unit tests
     * with a minimal `{}` argument.
     */
    var hooks = hostHooks || {};
    var cfg = Object.assign({}, DEFAULTS);
    var transcript = [];     // [{role, content}], capped at contextTurns*2
    var callable = null;     // alternative to endpointUrl: a function (body) => Promise<{reply}>

    function setEndpoint(url, headers) {
      cfg.endpointUrl = url || null;
      cfg.endpointHeaders = headers || null;
    }

    /* setCallable(fn) — plug in a Firebase HTTPS callable (or any function
     * with the shape `(body) => Promise<{reply}>`). When set, takes
     * precedence over setEndpoint() so we can preserve App-Check token
     * forwarding (the Firebase SDK injects it automatically; raw fetch
     * cannot). Pass `null` to clear and fall back to the fetch path. */
    function setCallable(fn) {
      callable = (typeof fn === "function") ? fn : null;
    }

    function setLang(lang) {
      cfg.lang = String(lang || "en");
    }

    function setConfig(partial) {
      if (partial && typeof partial === "object") Object.assign(cfg, partial);
    }

    function loadTranscript(turns) {
      transcript = Array.isArray(turns)
        ? turns.filter(function (t) { return t && t.role && t.content; })
              .slice(-cfg.contextTurns * 4)
        : [];
    }

    function _runScoring(text) {
      var SC = W.modAQuestionScoring;
      if (!SC || typeof SC.scoreQuestion !== "function") return null;
      var awarded = (typeof hooks.getAwarded === "function") ? (hooks.getAwarded() || {}) : {};
      var result = SC.scoreQuestion(text, awarded);

      var familyById = SC.familyById || function () { return null; };
      (result.award || []).forEach(function (id) {
        if (typeof hooks.onAward === "function") hooks.onAward(id, familyById(id));
      });
      (result.penalty || []).forEach(function (id) {
        if (typeof hooks.onPenalty === "function") hooks.onPenalty(id, familyById(id));
      });
      (result.unlocks || []).forEach(function (legacyId) {
        if (typeof hooks.onUnlock === "function") hooks.onUnlock(legacyId);
      });
      return result;
    }

    function _getPatientReply(userText) {
      // Build messages even when stubbing — keeps the contract identical
      // across stub and real endpoint, so the stub catches prompt bugs too.
      var msgs = (W.modALLMPrompts && W.modALLMPrompts.buildChatMessages)
        ? W.modALLMPrompts.buildChatMessages(cfg.lang, transcript, userText)
        : [{ role: "user", content: userText }];

      if (callable) {
        // Firebase HTTPS callable path. The SDK injects the App Check token,
        // and the Function enforces it server-side. Replies arrive as
        // { data: { reply, state, error? } }; we accept both that shape and
        // a bare { reply } for portability.
        return Promise.resolve(callable({ messages: msgs, lang: cfg.lang }))
          .then(function (result) {
            var payload = (result && result.data) ? result.data : result;
            if (!payload || typeof payload.reply !== "string") {
              throw new Error(payload && payload.error || "malformed reply");
            }
            // A `state: "disabled"` from the dormant function is treated as
            // an error here so we fall back to the stub locally.
            if (payload.state && payload.state !== "ok") {
              throw new Error("state:" + payload.state);
            }
            return payload.reply;
          })
          .then(function (raw) { return _sanitiseReply(raw, cfg.maxReplyLen); })
          .then(function (clean) {
            if (!clean) {
              if (typeof hooks.logError === "function") hooks.logError(new Error("empty reply"));
              return _stubReply(userText, W.CASE, cfg.lang);
            }
            return clean;
          });
      }

      if (!cfg.endpointUrl) {
        return Promise.resolve(_stubReply(userText, W.CASE, cfg.lang));
      }
      return _callEndpoint(cfg.endpointUrl, cfg.endpointHeaders,
                           { messages: msgs, lang: cfg.lang },
                           cfg.timeoutMs)
        .then(function (raw) { return _sanitiseReply(raw, cfg.maxReplyLen); })
        .then(function (clean) {
          // Empty/JSON-shaped reply → fall back to stub so the lesson can
          // continue. Host logs the error.
          if (!clean) {
            if (typeof hooks.logError === "function") hooks.logError(new Error("empty reply"));
            return _stubReply(userText, W.CASE, cfg.lang);
          }
          return clean;
        });
    }

    /* submit(text) → Promise<{userText, reply, score}>
     *
     * The end-to-end flow for one student turn:
     *   1. trim + cap text
     *   2. score it locally (sync) — awards, penalties, unlocks
     *   3. persist the user turn (via hook)
     *   4. fetch patient reply (real endpoint or stub)
     *   5. persist the assistant turn (via hook)
     *   6. update local transcript ring
     */
    function submit(text) {
      var clean = String(text || "").trim();
      if (!clean) return Promise.resolve(null);
      if (clean.length > cfg.maxInputLen) clean = clean.slice(0, cfg.maxInputLen);

      var score = _runScoring(clean);
      if (typeof hooks.persistTurn === "function") {
        try { hooks.persistTurn("user", clean); }
        catch (e) { if (typeof hooks.logError === "function") hooks.logError(e); }
      }
      // Note: clean is NOT pushed onto `transcript` before _getPatientReply
      // — buildChatMessages appends userText as the final {role:"user"}
      // itself. Pushing first would duplicate the new turn in the network
      // payload. We update the local ring once the reply lands so the
      // NEXT submit() sees the full history.

      return _getPatientReply(clean).then(function (reply) {
        if (typeof hooks.persistTurn === "function") {
          try { hooks.persistTurn("assistant", reply); }
          catch (e) { if (typeof hooks.logError === "function") hooks.logError(e); }
        }
        transcript.push({ role: "user", content: clean });
        transcript.push({ role: "assistant", content: reply });
        var maxKeep = cfg.contextTurns * 4;
        if (transcript.length > maxKeep) {
          transcript = transcript.slice(transcript.length - maxKeep);
        }
        return { userText: clean, reply: reply, score: score };
      }).catch(function (err) {
        if (typeof hooks.logError === "function") hooks.logError(err);
        // Network/timeout failure: emit a stub reply locally so the team
        // can keep going. The host UI surfaces the fallback notice.
        var reply = _stubReply(clean, W.CASE, cfg.lang);
        if (typeof hooks.persistTurn === "function") {
          try { hooks.persistTurn("assistant", reply); } catch (e) { /* ignore */ }
        }
        transcript.push({ role: "user", content: clean });
        transcript.push({ role: "assistant", content: reply });
        return { userText: clean, reply: reply, score: score, fallback: true };
      });
    }

    return {
      submit: submit,
      setEndpoint: setEndpoint,
      setCallable: setCallable,
      setLang: setLang,
      setConfig: setConfig,
      loadTranscript: loadTranscript,
      _internal: {                 // exposed for tests only
        runScoring: _runScoring,
        getTranscript: function () { return transcript.slice(); },
        sanitiseReply: _sanitiseReply,
        stubReply: function (t, c, l) { return _stubReply(t, c, l); }
      }
    };
  }

  W.modALLMBridge = {
    create: createBridge,
    DEFAULTS: DEFAULTS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = W.modALLMBridge;
  }
})(typeof window !== "undefined" ? window : globalThis);
