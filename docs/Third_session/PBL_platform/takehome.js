/* takehome.js — the wrap-up TAKE-HOME block (lazy chunk)
 *
 * SPLIT OUT OF script.js 2026-08-04 to repay part of the reclaim debt the perf
 * budget header has recorded since 2026-06-28. Everything here runs at the
 * WRAP-UP stage, behind an explicit download click: the student's takeaway
 * Markdown (buildRoomTakeawayMarkdown + downloadMyRoomAnswers), the
 * certificate-of-attendance PDF (downloadCertificatePdf + _verifyUrl) and the
 * study booklet (the _booklet* collectors + downloadStudyBookletPdf). None of
 * it is reachable from the splash — the entry view ~100% of users hit first —
 * so none of it belongs on that critical path. This is slice 1 ("Take-out") of
 * ARCHITECTURE/eager-bundle-reclaim-plan.md.
 *
 * Loaded via CanamedLoader.ensureTakeHome(), from initEndPoll()'s three click
 * handlers — the single place the wrap-up download buttons are wired. The load
 * happens ON CLICK, not on room entry: the two PDF paths already pull ~2.2 MB
 * of pdfmake on click, so a 3 KB chunk in front of them costs nothing, and a
 * student who never downloads never fetches it at all. script.js keeps NO
 * copies (tests/takehome-lazy-split.test.js pins that), only typeof-guarded
 * call sites, so a failed load degrades to a toast rather than a
 * ReferenceError out of a click handler.
 *
 * Deliberately a CLASSIC script, not an IIFE module — the same reasoning as
 * section-picker.js, and it is what dissolves the obstacle that stopped an
 * earlier attempt at this split. The block reads TEN script.js top-level `let`
 * bindings, none of which is a window property (clientId, myRoom, sessionNum,
 * myName, roomScore, allRooms, roomCount, teamName, db, SYNTH_ID) — that is the
 * "eleven bindings, none on window" the perf-budget header cited as the reason
 * this split was too expensive. Classic scripts SHARE the global script scope, so a
 * top-level `let` in script.js is visible here under its bare name exactly as
 * it was when this code lived there — no context object, no window.* rewrite,
 * no rewiring of the five unit tests that read these function bodies. (See
 * script-loader.js's header: "classic scripts share the global script-scope so
 * the existing function/let/const declarations remain reachable cross-file".)
 * The bindings are in their TDZ until script.js evaluates; this chunk only
 * ever loads from a wrap-up click, long after that, so the ordering is safe.
 *
 * The block below is moved VERBATIM. Its outbound dependencies on script.js —
 * el, toast, tc, getLang, _curLang, sPath, entriesSorted, itemById, scoreTotal,
 * scoreEventMeta, penaltyMeta, moduleSet, stageForModule, roomNames,
 * sessionRunsCaseWork — resolve the same way, as do the ones on other chunks
 * (canamedCertId / randomCredentialId / credentialNameHash / certIdPath in
 * pure-utils.js, CASE / DECISIONS in case-content.js, window.CanamedPdf in
 * student-pdf.js).
 */

/* Escape the markdown control chars (incl. the table pipe) so a free-text
   answer can never break the document structure. */
function _mdEsc(s) {
  return String(s == null ? "" : s).replace(/([*_`#|\[\]])/g, "\\$1");
}
/* Resolve a revealed item id ("history:2", "exam:0", "labs:0") back to the
   case content (button label + result text) in the active language, so the
   student's takeaway carries the actual clinical information, not just ids. */
function _caseItemById(itemId, lang) {
  const m = /^([a-zA-Z]+):(\d+)$/.exec(itemId || "");
  if (!m) return null;
  const group = (typeof CASE !== "undefined" && CASE) ? CASE[m[1]] : null;
  const item = Array.isArray(group) ? group[parseInt(m[2], 10)] : null;
  if (!item) return null;
  return { q: tc(item.q, lang), a: tc(item.a, lang) };
}

/* Student-facing end-of-session takeaway. Round-4 began as a plain group-answer
 * dump; the dry-run (2026-05-26) asked for the FULL record a student can revise
 * from: the clinical information the team gathered (historical context), the
 * discussion guidelines, the team's committed decisions + teaching points, the
 * student's OWN responses (answers / hypotheses / votes), the whole group's
 * answers, and the recap. Exports ONLY the participant's own room as Markdown,
 * read fresh from the room subtree (the student is a member, so the read is
 * allowed). Distinct from the admin export above, which dumps every room. */
/* Student certificate of attendance (PDF). Lazy-loads pdfmake (~2.2 MB) then
   our generator, only on click. Best-effort: a network failure (e.g. offline)
   surfaces a toast rather than a dead button. */
function downloadCertificatePdf() {
  const btn = el("wrapup-cert-btn");
  if (btn) btn.disabled = true;
  const loader = window.CanamedLoader || {};

  // ID + verification strategy (verifiable by DEFAULT, privacy-preserving):
  //   • The certificate carries a CRYPTO-RANDOM id, persisted per participant at
  //     certIds/<code>/<clientId> (write-once, owner-only, OUTSIDE the sessions/
  //     read-cascade — see certIdPath). A re-download reuses it, and the
  //     facilitator research export reads it from that map, so the cert, the
  //     public registry and the export still agree — now WITHOUT a guessable
  //     join key. (The old id was a deterministic hash of (session|clientId);
  //     every input is readable by any session member from the pool keys, so a
  //     classmate could recompute a peer's id and read their credentials/<id>.)
  //   • Whenever a certificate is generated we publish ONLY a one-way hash of
  //     (name, session) to /credentials/<id> (write-once). The public verify
  //     page confirms a (name, id) match without the name ever being stored or
  //     returned — it only answers "valid" / "no match".
  //   • The QR encodes the verify-page URL (id pre-filled) so a scan opens a
  //     real link, not bare text.
  // detId is the OFFLINE-ONLY fallback: deterministic, so a cert still renders an
  // id when there is no DB/crypto to mint+persist a random one. Nothing is
  // published in that case (the cert is unverifiable regardless, same as any
  // offline generation); detId is NOT published as a credential id anymore.
  const detId = (typeof canamedCertId === "function")
    ? canamedCertId((sessionNum || "") + "|" + (clientId || "")) : "";
  const detVerifyUrl = detId ? _verifyUrl(detId) : "";
  const CID_RE = /^CNM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

  // Publish the (name, session) hash under credentials/<certId>. Write-once: a
  // re-download is denied because the entry exists, which is success (already
  // published). Resolves {certId, verifyUrl} either way.
  function _publishCredential(certId) {
    const done = { certId: certId, verifyUrl: _verifyUrl(certId) };
    if (typeof credentialNameHash !== "function") return Promise.resolve(done);
    return credentialNameHash(myName || "", sessionNum || "").then(function (nameHash) {
      const sessionLabel = (typeof CANAMED_CONFIG !== "undefined" && CANAMED_CONFIG &&
        typeof CANAMED_CONFIG.workshopName === "string")
        ? String(CANAMED_CONFIG.workshopName).slice(0, 80) : "";
      const payload = {
        nameHash: nameHash,
        session: (sessionNum || "").slice(0, 40),
        sessionLabel: sessionLabel,
        at: Date.now(),
        // Keep inside the DB rule's ~5-year retention cap (5y minus a margin for
        // clock skew). The previous 10-year value exceeded the cap, so the rule
        // rejected every write — leaving the id absent from the registry.
        retentionUntil: Date.now() + (5 * 365 - 30) * 24 * 60 * 60 * 1000
      };
      return firebase.database().ref("credentials/" + certId).set(payload).then(
        function () { return done; },
        function (err) { console.warn("credential publish skipped", err && err.code); return done; }
      );
    }, function () { return done; });
  }

  function resolveCertId() {
    const fallback = { certId: detId, verifyUrl: detVerifyUrl };
    // No session/client to bind to, no DB, or no crypto to mint a random id →
    // hand back the deterministic offline id so the cert renders; nothing is
    // published (unverifiable, same as any offline generation).
    if (!(sessionNum || "").length || !(clientId || "") ||
        typeof firebase === "undefined" || typeof randomCredentialId !== "function") {
      return Promise.resolve(fallback);
    }
    const idRef = firebase.database().ref(certIdPath(sessionNum, clientId));
    // Reuse an already-minted id (idempotent re-download); else mint a fresh
    // crypto-random one and persist it write-once. A lost write-once race
    // (another tab of the same participant minted first) re-reads theirs.
    return idRef.once("value").then(function (snap) {
      const existing = (snap && snap.exists()) ? String(snap.val() || "") : "";
      if (CID_RE.test(existing)) return _publishCredential(existing);
      let minted;
      try { minted = randomCredentialId(); }
      catch (e) { return fallback; }
      return idRef.set(minted).then(
        function () { return _publishCredential(minted); },
        function () {
          // Denied/raced — re-read; use a valid id if one landed, else give up.
          return idRef.once("value").then(function (s2) {
            const now = (s2 && s2.exists()) ? String(s2.val() || "") : "";
            return CID_RE.test(now) ? _publishCredential(now) : fallback;
          }, function () { return fallback; });
        }
      );
    }, function () {
      // certIds read failed/denied → can't safely mint/persist; fall back to the
      // offline id (nothing published) rather than reuse a guessable id.
      return fallback;
    });
  }

  if (typeof toast === "function") toast("Preparing your certificate…");
  Promise.resolve()
    .then(() => loader.ensurePdfmake ? loader.ensurePdfmake() : Promise.reject(new Error("loader")))
    .then(() => loader.ensureStudentPdf())
    .then(resolveCertId)
    .then(function (id) {
      const data = {
        name: myName || "",
        sessionCode: sessionNum || "",
        sessionLabel: "",
        lang: (typeof getLang === "function") ? getLang() : "en",
        dateStr: new Date().toLocaleDateString(),
        partnership: "Université de Caen Normandie × Nagoya University",
        // Competencies omitted on purpose: the builder localizes its own
        // default set to data.lang. (A caller may still pass competencies to
        // override.)
        certId: id.certId,
        verifyUrl: id.verifyUrl
      };
      if (window.CanamedPdf && typeof window.CanamedPdf.certificate === "function") {
        window.CanamedPdf.certificate(data);
      }
    })
    .catch(() => {
      if (typeof toast === "function") toast("Couldn't prepare the PDF — check your connection and try again.", "", "loss");
    })
    .then(() => { if (btn) btn.disabled = false; });
}

// Verify-page URL for a given credential id. Pegs to the live host (the cert
// is taken offline + scanned anywhere), with a sensible fallback to whatever
// origin served the platform — useful for staging and local dev.
//
// Uses the short "/v?id=" path (a Firebase Hosting rewrite to verify.html, see
// firebase.json) rather than "/verify.html?id=". Dropping the 10-char filename
// from the URL keeps the QR-encoded payload low enough to render as a sparser,
// easier-to-scan QR version (~29x29 instead of 33x33). verify.html still works
// directly, so certificates printed before this change keep verifying.
function _verifyUrl(id) {
  const host = (typeof CANAMED_CONFIG !== "undefined" && CANAMED_CONFIG &&
    typeof CANAMED_CONFIG.verifyOrigin === "string" && CANAMED_CONFIG.verifyOrigin)
    ? CANAMED_CONFIG.verifyOrigin
    : (typeof location !== "undefined" && location.origin) ? location.origin
    : "https://canamed-69785.web.app";
  return host.replace(/\/+$/, "") + "/v?id=" + encodeURIComponent(id);
}

/* Gather the session's reference cards (historical context, guidelines, recap
   tables) from the LIVE DOM into structured booklet sections — single source of
   truth (the same cards students read in-session), so no per-scenario content
   is duplicated in the PDF code. */
/* node.textContent, but with any link that isn't already spelled out in the
   text appended as a bare URL in parentheses — so the booklet's DOI/website
   links survive the DOM→PDF crossing and the PDF builder can make them
   clickable (links in the live cards are <a href> whose visible text is often
   a human label, e.g. "HAS 2019", that would otherwise lose its URL). */
function _textWithLinks(node) {
  let txt = node.textContent.replace(/\s+/g, " ").trim();
  try {
    const anchors = node.querySelectorAll ? node.querySelectorAll("a[href]") : [];
    anchors.forEach(a => {
      const href = (a.getAttribute("href") || "").trim();
      if (!/^https?:\/\//i.test(href)) return;
      const bare = href.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (txt.indexOf(bare) >= 0 || txt.indexOf(href) >= 0) return;  // already shown
      txt += " (" + href + ")";
    });
  } catch (_) { /* best-effort link capture */ }
  return txt;
}
function _bookletBlocks(node, blocks) {
  const tag = node.tagName;
  if (!tag) return;
  if (tag === "P") {
    const t = _textWithLinks(node);
    if (t) blocks.push({ type: "p", text: t });
  } else if (tag === "H4" || tag === "H5") {
    const t = node.textContent.replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type: "sub", text: t });
  } else if (tag === "UL" || tag === "OL") {
    const items = Array.from(node.querySelectorAll(":scope > li"))
      .map(li => _textWithLinks(li)).filter(Boolean);
    if (items.length) blocks.push({ type: "ul", items: items });
  } else if (tag === "TABLE") {
    const rows = Array.from(node.querySelectorAll("tr")).map(tr =>
      Array.from(tr.querySelectorAll("th,td")).map(c => c.textContent.replace(/\s+/g, " ").trim()));
    if (rows.length) blocks.push({ type: "table", rows: rows, header: !!node.querySelector("thead") });
  } else if (node.children && node.children.length) {
    Array.from(node.children).forEach(c => _bookletBlocks(c, blocks));
  }
}
function _collectBookletSections() {
  // Only the stages this session actually runs: the stage-2 DOM still EXISTS in
  // an A-only session (it is merely never shown), so a fixed selector would pull
  // its unvisited template cards into the take-home.
  const CARDS = [".history-card", ".guidelines-card", ".recap-card"];
  const sel = moduleSet()
    .map(id => "#stage-" + stageForModule(id))
    .flatMap(stage => CARDS.map(c => stage + " " + c))
    .join(", ");
  if (!sel) return [];
  const out = [];
  document.querySelectorAll(sel).forEach(card => {
    const sum = card.querySelector("summary");
    const title = sum ? sum.textContent.replace(/\s+/g, " ").trim() : "";
    const blocks = [];
    Array.from(card.children).forEach(ch => {
      if (ch.tagName === "SUMMARY") return;
      _bookletBlocks(ch, blocks);
    });
    if (title || blocks.length) out.push({ title: title, blocks: blocks });
  });
  return out;
}
/* This team's points, headline (non-micro) achievements, and the cross-room
   comparison — all read from the live roomScore / allRooms, no new schema. */
function _bookletTeamData() {
  const wins = [];
  try {
    const earned = (roomScore && roomScore.auto) || {};
    Object.keys(earned).forEach(ev => {
      const meta = (typeof scoreEventMeta === "function") ? scoreEventMeta(ev) : null;
      if (meta && meta.tier !== "micro" && meta.title) wins.push(meta.title);
    });
  } catch (_) { /* roomScore not ready — booklet still renders without wins */ }
  let cohort = [];
  try {
    const rooms = (typeof roomNames === "function") ? roomNames(roomCount) : [];
    cohort = rooms
      .filter(r => allRooms[r] != null)
      .map(r => ({ label: r, score: (typeof scoreTotal === "function") ? scoreTotal(allRooms[r]) : 0, you: r === myRoom }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  } catch (_) { /* leaderboard not ready */ }
  return {
    name: (typeof teamName === "string" && teamName) ? teamName : (myRoom || ""),
    score: (typeof scoreTotal === "function" && roomScore) ? scoreTotal(roomScore) : 0,
    wins: wins.slice(0, 8),
    cohort: cohort
  };
}
/* Student study-booklet (PDF) — designed multi-page revision aid. Lazy-loads
   pdfmake on click, like the certificate. */
function downloadStudyBookletPdf() {
  const btn = el("wrapup-booklet-btn");
  if (btn) btn.disabled = true;
  const loader = window.CanamedLoader || {};
  const data = {
    name: myName || "",
    sessionCode: sessionNum || "",
    lang: (typeof getLang === "function") ? getLang() : "en",
    dateStr: new Date().toLocaleDateString(),
    partnership: "Université de Caen Normandie × Nagoya University",
    sections: _collectBookletSections(),
    team: _bookletTeamData()
  };
  if (typeof toast === "function") toast("Preparing your study booklet…");
  Promise.resolve()
    .then(() => loader.ensurePdfmake ? loader.ensurePdfmake() : Promise.reject(new Error("loader")))
    .then(() => loader.ensureStudentPdf())
    .then(() => {
      if (window.CanamedPdf && typeof window.CanamedPdf.booklet === "function") {
        window.CanamedPdf.booklet(data);
      }
    })
    .catch(() => {
      if (typeof toast === "function") toast("Couldn't prepare the PDF — check your connection and try again.", "", "loss");
    })
    .then(() => { if (btn) btn.disabled = false; });
}

/* The take-home markdown itself, extracted from the download plumbing so the
   document a student actually receives can be asserted in a test without a
   live room. Reads the same room `data` snapshot the download path reads, and
   the same ambient globals (clientId, myRoom, sessionNum, myName, the score
   helpers) it always did. */
function buildRoomTakeawayMarkdown(data) {
  data = data || {};
  const lang = (typeof _curLang === "function") ? _curLang() : "en";
  const ans = data.answers || {};
  const reveals = (data.moduleA || {}).revealed || {};
  const hyps = (data.moduleA || {}).hypotheses || data.hypotheses || {};
  const votes = data.votes || {};
  const me = (typeof myName === "string" && myName) ? myName : "";
  const decList = []
    .concat((typeof window !== "undefined" && Array.isArray(window.DECISIONS)) ? window.DECISIONS
      : (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [])
    .concat((typeof DECISIONS_B !== "undefined" && Array.isArray(DECISIONS_B)) ? DECISIONS_B : []);
  const decById = {};
  decList.forEach(d => { if (d && d.id) decById[d.id] = d; });
  const decPrompt = (dec, id) => _mdEsc(dec && dec.prompt ? tc(dec.prompt, lang) : id);

  const lines = [];
  lines.push("# CaNaMED — my session takeaway");
  lines.push("");
  lines.push("- **Session:** " + _mdEsc(sessionNum));
  lines.push("- **Room / team:** " + _mdEsc(myRoom) + (data.teamName ? " — " + _mdEsc(data.teamName) : ""));
  if (me) lines.push("- **Name:** " + _mdEsc(me));
  lines.push("- **Exported:** " + new Date().toLocaleString());
  lines.push("");

  /* S7 — sections 1, 1b and 2 below all read the ambient CASE / SYNTH_ID
     globals, which a session with no PBL section never sets:
     applySectionContent() deliberately skips `c.case` when a section has none
     (blanking CASE would strip the board a PBL slot next door still needs), so
     they keep applyDefaultScenario()'s chronic-pain values. No roleplay stage
     renders a workup, so the screen never showed it — but the TAKE-HOME did,
     handing every roleplay-only student a chronic-pain model synthesis and
     chronic-pain discussion prompts for a case they never opened. */
  if (sessionRunsCaseWork()) {
    // 1. Historical context — the clinical information the team gathered, in
    //    the order it was opened.
    lines.push("## The case — clinical information gathered");
    const revealSeq = Object.keys(reveals)
      .map(id => ({ id: id, by: (reveals[id] || {}).by || "", at: (reveals[id] || {}).at || 0 }))
      .sort((a, b) => a.at - b.at);
    if (!revealSeq.length) {
      lines.push("_(nothing was opened)_");
    } else {
      revealSeq.forEach((e, i) => {
        const it = _caseItemById(e.id, lang);
        if (it) lines.push("- **" + (i + 1) + ". " + _mdEsc(it.q) + "** — " + _mdEsc(it.a) +
          (e.by ? "  _(opened by " + _mdEsc(e.by) + ")_" : ""));
      });
    }
    lines.push("");

    // 1b. Clinical synthesis — the model write-up (same for everyone). The
    //     on-screen synthesis card was removed 2026-06-02, so this take-home is
    //     now the only place it lands. SYNTH_ID stays defined in
    //     case-content.js; prefer its labelled aParts, fall back to flat `a`.
    const synItem = (typeof itemById === "function") ? itemById(SYNTH_ID) : null;
    if (synItem && (synItem.a || (Array.isArray(synItem.aParts) && synItem.aParts.length))) {
      lines.push("## Clinical synthesis (model summary)");
      if (Array.isArray(synItem.aParts) && synItem.aParts.length) {
        synItem.aParts.forEach(part => {
          const label = (part && part.label) ? tc(part.label, lang) : "";
          const body = (part && part.body) ? tc(part.body, lang) : "";
          if (label || body) lines.push("- **" + _mdEsc(label) + ":** " + _mdEsc(body));
        });
      } else {
        lines.push(_mdEsc(tc(synItem.a, lang)));
      }
      lines.push("");
    }

    // 2. Discussion guidelines — the prompts that framed the debate.
    const prompts = (typeof CASE !== "undefined" && CASE && Array.isArray(CASE.prompts)) ? CASE.prompts : [];
    if (prompts.length) {
      lines.push("## Discussion guidelines");
      prompts.forEach(p => lines.push("- " + _mdEsc(tc(p, lang))));
      lines.push("");
    }
  }

  // 3. The team's committed decisions (group common responses) + teaching points.
  const decIds = Object.keys(votes);
  if (decIds.length) {
    lines.push("## Your team's decisions");
    lines.push("");
    lines.push("| Decision | Team's choice | Safest? |");
    lines.push("| --- | --- | --- |");
    decIds.forEach(decId => {
      const dec = decById[decId] || {};
      const v = votes[decId] || {};
      const ci = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
      const opt = (ci != null && dec.options) ? dec.options[ci] : null;
      lines.push("| " + decPrompt(dec, decId) + " | " + _mdEsc(opt ? tc(opt.text, lang) : "—") +
        " | " + (opt ? (opt.correct ? "yes" : "no") : "—") + " |");
    });
    lines.push("");
    const teaching = [];
    decIds.forEach(decId => {
      const dec = decById[decId] || {};
      const v = votes[decId] || {};
      const ci = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
      const opt = (ci != null && dec.options) ? dec.options[ci] : null;
      const why = (opt && opt.why) ? tc(opt.why, lang) : (dec.why ? tc(dec.why, lang) : "");
      if (why) teaching.push("- **" + decPrompt(dec, decId) + ":** " + _mdEsc(why));
    });
    if (teaching.length) { lines.push("### Teaching points"); teaching.forEach(t => lines.push(t)); lines.push(""); }
  }

  // 4. The student's OWN responses.
  lines.push("## My responses");
  let mineAny = false;
  [["moduleA", "Module A"], ["moduleB", "Module B"]].forEach(pair => {
    const mine = entriesSorted(ans[pair[0]]).filter(e => e.cid === clientId);
    if (mine.length) {
      mineAny = true;
      lines.push("### " + pair[1] + " — my answers");
      mine.forEach(e => lines.push("- " + _mdEsc(e.text)));
    }
  });
  const myHyps = Object.keys(hyps).map(k => hyps[k]).filter(h => h && h.cid === clientId);
  if (myHyps.length) {
    mineAny = true;
    lines.push("### My hypotheses");
    myHyps.forEach(h => lines.push("- " + _mdEsc(h.text)));
  }
  const myVotes = [];
  decIds.forEach(decId => {
    const dec = decById[decId] || {};
    const b = ((votes[decId] || {}).ballots || {})[clientId];
    if (b && typeof b.choice === "number" && dec.options) {
      const opt = dec.options[b.choice];
      myVotes.push("- **" + decPrompt(dec, decId) + ":** " + _mdEsc(opt ? tc(opt.text, lang) : "?") +
        (opt && opt.correct ? " (safest)" : ""));
    }
  });
  if (myVotes.length) { mineAny = true; lines.push("### My votes"); myVotes.forEach(l => lines.push(l)); }
  if (!mineAny) lines.push("_(no individual responses recorded)_");
  lines.push("");

  // 5. The whole group's answers (everyone in the room).
  lines.push("## Group answers (everyone in the room)");
  [["moduleA", "Module A"], ["moduleB", "Module B"]].forEach(pair => {
    lines.push("### " + pair[1]);
    const entries = entriesSorted(ans[pair[0]]);
    if (!entries.length) lines.push("_(no points recorded)_");
    else entries.forEach(e => lines.push("- **" + _mdEsc(e.by || "?") +
      (e.university ? " / " + _mdEsc(e.university) : "") + ":** " + _mdEsc(e.text)));
    lines.push("");
  });

  // 6. Recap — the team's score, what went well, what to remember.
  lines.push("## Recap");
  try {
    const sc = data.score || (typeof roomScore !== "undefined" ? roomScore : null) || {};
    lines.push("- **Team score:** " + scoreTotal({ score: sc }) + " points");
    const wins = Object.keys(sc.auto || {}).map(scoreEventMeta)
      .filter(m => m && m.tier !== "micro").map(m => m.title);
    if (wins.length) { lines.push("- **What your team did well:**"); wins.forEach(w => lines.push("  - " + _mdEsc(w))); }
    const lessons = Object.keys(sc.penalties || {}).map(penaltyMeta).filter(Boolean);
    if (lessons.length) {
      lines.push("- **Worth remembering for next time:**");
      lessons.forEach(m => lines.push("  - " + _mdEsc(m.title) + (m.why ? " — " + _mdEsc(m.why) : "")));
    }
  } catch (_) { /* recap is best-effort — never block the download */ }
  lines.push("");
  return lines.join("\n");
}

function downloadMyRoomAnswers() {
  if (!db || !myRoom) return;
  db.ref(sPath("rooms/" + myRoom)).once("value").then(snap => {
    const text = buildRoomTakeawayMarkdown(snap.val() || {});
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CaNaMED_" + myRoom + "_my-takeaway.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }).catch(e => { try { console.warn("room export failed", e); } catch (_) {} });
}
