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
 *   - window.modAQuestionScoring.scoreQuestion(text, awarded, characterId) → {award,penalty,unlocks}
 *   - window.modALLMPrompts.buildChatMessages(lang, transcript, userText, {characterId})
 *   - window.CASE                — fact lookup for the local stub fallback
 *   - DOM in the container the host passes to init()
 *
 * SWITCHBOARD (scenario-characters design, slice 2). The bridge keeps ONE
 * transcript thread PER CHARACTER and an "active" character the next
 * submit() is addressed to. Each thread is its own LLM conversation — one
 * persona per call, never several — and a turn persisted through the host
 * carries the character id so a teammate's client can route it to the same
 * thread. A turn with no id belongs to the index patient, which is what every
 * pre-switchboard transcript is.
 *
 * PER-SLOT (section model, 2026-09-07). A session may run several PBL
 * sections, each with its own case and cast, and the room's ONE roomChat
 * tree holds all of them. So threads are keyed by SLOT first, then character:
 * setSlot(n) is called as the student moves between sections, and every
 * persisted turn carries the slot it was spoken in. A turn with no slot is
 * the session's first PBL slot — every transcript written before this change.
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
  // ", age 45**" and similar emit patterns. The character's own name is added
  // per-scenario; it is validated and escaped before reaching the RegExp, the
  // same way functions/lib/hf-helpers.js does it.
  var _GENERIC_ROLES = "patient|le\\s+patient|réponse|response|回答|患者(?:さん)?|彼";

  function _characterName(lang, characterId) {
    try {
      if (W.modALLMPrompts && typeof W.modALLMPrompts.characterName === "function") {
        return W.modALLMPrompts.characterName(lang || "en", characterId || undefined);
      }
    } catch (_) { /* prompts module absent — generic roles only */ }
    return "";
  }

  /* The id a turn with no `character` belongs to — the index patient. */
  function _defaultCharacterId() {
    try {
      if (W.modALLMPrompts && typeof W.modALLMPrompts.defaultCharacterId === "function") {
        return String(W.modALLMPrompts.defaultCharacterId() || "patient");
      }
    } catch (_) { /* prompts module absent */ }
    return "patient";
  }

  function _rolePrefixRe(name) {
    // Every metacharacter is escaped, so an authored name cannot alter the
    // pattern. Each token also gets an optional trailing dot, so a scenario's
    // "Mr Lefebvre" still matches the model's "Mr. Lefebvre:".
    var n = String(name == null ? "" : name).trim().slice(0, 40);
    var alts = _GENERIC_ROLES;
    var pat = n.split(/\s+/).map(function (tok) {
      return tok.replace(/\.+$/, "").replace(/[.*+?^${}()|[\]\\\-]/g, "\\$&");
    }).filter(Boolean).join("\\.?\\s*");
    if (pat) alts += "|" + pat;
    return new RegExp(
      "^\\s*[*_\"'`>「『]*\\s*(\\[[^\\]]+\\]\\s*)?(" + alts + ")[^:：\\-—\\n]{0,40}\\s*[:：\\-—]\\s*",
      "i");
  }

  function _sanitiseReply(raw, maxLen, characterName) {
    if (raw == null) return "";
    var s = String(raw).trim();
    // Strip wrapper-style leading brackets first ("[Patient response]" /
    // "[Mr. Lefebvre says]") — these are NOT JSON arrays, they're model
    // formatting. The JSON-rejection check below must come AFTER this.
    s = s.replace(/^\s*\[[A-Za-z0-9 .,'!_'-]{1,60}\]\s*/, "");
    var re = _rolePrefixRe(characterName == null ? _characterName() : characterName);
    s = s.replace(re, "").replace(re, "");
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

  function _stubReply(userText, caseObj, lang, characterId) {
    if (!caseObj || !Array.isArray(caseObj.history)) {
      return _genericStubReply(lang);
    }
    var lowered = String(userText || "").toLowerCase();
    var best = null;
    var bestScore = 0;
    // Route by owner exactly as the prompt builder's _collectFacts does: an
    // item with no `who` belongs to the index patient. Only applied when a
    // character is named, so the legacy single-patient stub is unchanged.
    var who = characterId ? String(characterId) : null;
    var defaultId = who ? _defaultCharacterId() : null;
    for (var i = 0; i < caseObj.history.length; i++) {
      var it = caseObj.history[i];
      if (!it || !it.q || !it.a) continue;
      if (who && String(it.who || defaultId) !== who) continue;
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
     *   persistTurn(role, content, characterId) - write to roomChat/…/{turn};
     *                              characterId is the addressee (null = index
     *                              patient, the only value pre-switchboard hosts
     *                              ever saw)
     *   logError(err)              - optional, host-side logging
     *   getAwarded()               - returns { famId: true } map
     * }
     * Any missing hook is a no-op so the bridge is usable from unit tests
     * with a minimal `{}` argument.
     */
    var hooks = hostHooks || {};
    var cfg = Object.assign({}, DEFAULTS);
    /* One thread per character id: { [id]: [{role, content}, …] }, each capped
       at contextTurns*4. `active` is the addressee of the next submit(); null
       resolves to the index patient at call time, so a host that never calls
       setCharacter() gets exactly the single-patient behaviour. */
    var threads = {};        // { [slot]: { [characterId]: [{role, content}, …] } }
    var active = null;
    var activeSlot = 1;      // the section the next submit() is spoken in
    var callable = null;     // alternative to endpointUrl: a function (body) => Promise<{reply}>

    function _activeId() { return active || _defaultCharacterId(); }
    function _slotThreads(slot) {
      var k = String(slot || activeSlot);
      if (!threads[k]) threads[k] = {};
      return threads[k];
    }
    function _thread(id, slot) {
      var st = _slotThreads(slot);
      if (!st[id]) st[id] = [];
      return st[id];
    }
    function _pushTurns(id, slot, userText, reply) {
      var st = _slotThreads(slot);
      var t = _thread(id, slot);
      t.push({ role: "user", content: userText });
      t.push({ role: "assistant", content: reply });
      var maxKeep = cfg.contextTurns * 4;
      if (t.length > maxKeep) st[id] = t.slice(t.length - maxKeep);
    }

    /* setSlot(n) — the section the next submit() belongs to. Threads of other
       slots are kept, so walking Back into an earlier section resumes its
       conversations. A non-numeric or sub-1 value resets to slot 1. */
    function setSlot(n) {
      var v = Number(n);
      activeSlot = (isFinite(v) && v >= 1) ? Math.floor(v) : 1;
    }
    function getSlot() { return activeSlot; }

    /* setCharacter(id) — address the next submit() to this character. Pass
       null to return to the index patient. Threads are kept, so switching
       back resumes that conversation where it was. */
    function setCharacter(id) {
      active = (id == null || id === "") ? null : String(id);
    }
    function getCharacter() { return _activeId(); }

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

    /* loadTranscript(turns, defaultSlot?) — seed the threads from persisted
       turns [{role, content, character?, slot?}]. A turn with no `character`
       is the index patient's; a turn with no `slot` belongs to `defaultSlot`
       (the session's first PBL slot; falls back to the active slot). Replaces
       every thread. */
    function loadTranscript(turns, defaultSlot) {
      threads = {};
      if (!Array.isArray(turns)) return;
      var defaultId = _defaultCharacterId();
      var fallbackSlot = (Number(defaultSlot) >= 1) ? Math.floor(Number(defaultSlot)) : activeSlot;
      var maxKeep = cfg.contextTurns * 4;
      for (var i = 0; i < turns.length; i++) {
        var t = turns[i];
        if (!t || !t.role || !t.content) continue;
        var slot = (Number(t.slot) >= 1) ? Math.floor(Number(t.slot)) : fallbackSlot;
        _thread(t.character ? String(t.character) : defaultId, slot)
          .push({ role: t.role, content: t.content });
      }
      for (var k in threads) if (Object.prototype.hasOwnProperty.call(threads, k)) {
        var st = threads[k];
        for (var id in st) if (Object.prototype.hasOwnProperty.call(st, id)) {
          if (st[id].length > maxKeep) st[id] = st[id].slice(-maxKeep);
        }
      }
    }

    function _runScoring(text, characterId, slot) {
      var SC = W.modAQuestionScoring;
      if (!SC || typeof SC.scoreQuestion !== "function") return null;
      // The awarded map is PER SLOT: the same family may fire once in each
      // section, so the host is asked for the map of the slot being scored.
      var awarded = (typeof hooks.getAwarded === "function") ? (hooks.getAwarded(slot) || {}) : {};
      var result = SC.scoreQuestion(text, awarded, characterId);

      var familyById = SC.familyById || function () { return null; };
      (result.award || []).forEach(function (id) {
        if (typeof hooks.onAward === "function") hooks.onAward(id, familyById(id), slot);
      });
      (result.penalty || []).forEach(function (id) {
        if (typeof hooks.onPenalty === "function") hooks.onPenalty(id, familyById(id), slot);
      });
      (result.unlocks || []).forEach(function (legacyId) {
        if (typeof hooks.onUnlock === "function") hooks.onUnlock(legacyId);
      });
      return result;
    }

    /* The mutable context this ONE request must be answered against.
     *
     * `W.CASE` and `cfg` are per-active-slot globals: `applySectionContent()`
     * republishes W.CASE when the session moves to another section, and
     * `bridge.setLang()` fires from modA-llm-init's canamed:langchange handler
     * whenever the participant switches language. A patient reply can land
     * seconds after either, so reading them when the promise RESOLVES answers
     * the student's question out of whatever content is on screen by then —
     * a fallback stub sourced from a different case, or sanitised for a
     * different language than it was asked in. Nothing errors; the answer is
     * simply attributed to the wrong section. That is the same defect family
     * as #275 (authored content silently replaced by a default).
     *
     * So the request captures its context ONCE, here, and every continuation
     * below uses the capture rather than re-reading the global. */
    function _captureRequestContext() {
      var id = _activeId();
      return {
        caseObj: W.CASE,
        lang: cfg.lang,
        maxReplyLen: cfg.maxReplyLen,
        characterId: id,
        slot: activeSlot,
        charName: _characterName(cfg.lang, id)
      };
    }

    function _getPatientReply(userText, req) {
      req = req || _captureRequestContext();
      // Build messages even when stubbing — keeps the contract identical
      // across stub and real endpoint, so the stub catches prompt bugs too.
      // The thread and the persona are BOTH the addressee's: one character
      // per call, never a merged cast.
      var msgs = (W.modALLMPrompts && W.modALLMPrompts.buildChatMessages)
        ? W.modALLMPrompts.buildChatMessages(req.lang, _thread(req.characterId, req.slot), userText,
                                            { characterId: req.characterId })
        : [{ role: "user", content: userText }];
      // Sent so the server strips "<Name>:" prefixes it cannot otherwise know.
      var charName = req.charName;

      if (callable) {
        // Firebase HTTPS callable path. The SDK injects the App Check token,
        // and the Function enforces it server-side. Replies arrive as
        // { data: { reply, state, error? } }; we accept both that shape and
        // a bare { reply } for portability.
        return Promise.resolve(callable({ messages: msgs, lang: req.lang, characterName: charName }))
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
          .then(function (raw) { return _sanitiseReply(raw, req.maxReplyLen, charName); })
          .then(function (clean) {
            if (!clean) {
              if (typeof hooks.logError === "function") hooks.logError(new Error("empty reply"));
              return _stubReply(userText, req.caseObj, req.lang, req.characterId);
            }
            return clean;
          });
      }

      if (!cfg.endpointUrl) {
        return Promise.resolve(_stubReply(userText, req.caseObj, req.lang, req.characterId));
      }
      return _callEndpoint(cfg.endpointUrl, cfg.endpointHeaders,
                           { messages: msgs, lang: req.lang, characterName: charName },
                           cfg.timeoutMs)
        .then(function (raw) { return _sanitiseReply(raw, req.maxReplyLen, charName); })
        .then(function (clean) {
          // Empty/JSON-shaped reply → fall back to stub so the lesson can
          // continue. Host logs the error.
          if (!clean) {
            if (typeof hooks.logError === "function") hooks.logError(new Error("empty reply"));
            return _stubReply(userText, req.caseObj, req.lang, req.characterId);
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

      /* Capture the content context for THIS turn before anything awaits.
         _runScoring already runs synchronously here — it reads window.SCORING
         at submit time, so scoring was never exposed to the race — but the
         patient reply resolves later, and its fallback paths must answer out
         of the case and language the student actually asked in. See
         _captureRequestContext. */
      var req = _captureRequestContext();
      var who = req.characterId;
      var slot = req.slot;

      var score = _runScoring(clean, who, slot);
      if (typeof hooks.persistTurn === "function") {
        try { hooks.persistTurn("user", clean, who, slot); }
        catch (e) { if (typeof hooks.logError === "function") hooks.logError(e); }
      }
      // Note: clean is NOT pushed onto the thread before _getPatientReply
      // — buildChatMessages appends userText as the final {role:"user"}
      // itself. Pushing first would duplicate the new turn in the network
      // payload. We update the local ring once the reply lands so the
      // NEXT submit() sees the full history.

      return _getPatientReply(clean, req).then(function (reply) {
        if (typeof hooks.persistTurn === "function") {
          try { hooks.persistTurn("assistant", reply, who, slot); }
          catch (e) { if (typeof hooks.logError === "function") hooks.logError(e); }
        }
        _pushTurns(who, slot, clean, reply);
        return { userText: clean, reply: reply, score: score, character: who, slot: slot };
      }).catch(function (err) {
        if (typeof hooks.logError === "function") hooks.logError(err);
        // Network/timeout failure: emit a stub reply locally so the team
        // can keep going. The host UI surfaces the fallback notice.
        var reply = _stubReply(clean, req.caseObj, req.lang, who);
        if (typeof hooks.persistTurn === "function") {
          try { hooks.persistTurn("assistant", reply, who, slot); } catch (e) { /* ignore */ }
        }
        _pushTurns(who, slot, clean, reply);
        return { userText: clean, reply: reply, score: score, character: who, slot: slot, fallback: true };
      });
    }

    return {
      submit: submit,
      setEndpoint: setEndpoint,
      setCallable: setCallable,
      setLang: setLang,
      setConfig: setConfig,
      setCharacter: setCharacter,
      getCharacter: getCharacter,
      setSlot: setSlot,
      getSlot: getSlot,
      loadTranscript: loadTranscript,
      _internal: {                 // exposed for tests only
        runScoring: _runScoring,
        // The ACTIVE character's thread in the ACTIVE slot — what
        // pre-switchboard tests read.
        getTranscript: function () { return _thread(_activeId(), activeSlot).slice(); },
        // The threads of ONE slot (the active one by default), keyed by
        // character — the pre-per-slot shape.
        getThreads: function (slot) {
          var st = _slotThreads(slot);
          var out = {};
          for (var id in st) if (Object.prototype.hasOwnProperty.call(st, id)) {
            out[id] = st[id].slice();
          }
          return out;
        },
        getSlots: function () { return Object.keys(threads); },
        getLang: function () { return cfg.lang; },
        sanitiseReply: _sanitiseReply,
        stubReply: function (t, c, l, id) { return _stubReply(t, c, l, id); }
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
