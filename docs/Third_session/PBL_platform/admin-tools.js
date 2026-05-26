/* admin-tools.js — lazy-loaded facilitator/decision-maker tooling.
 *
 * WHY a separate file: these are admin-only artifacts (accreditation evidence,
 * research export, per-participant attestations, program rollups). They are
 * never needed on the splash, and bundling them into the eager script.js was
 * pushing the splash perf budget. This chunk is lazy-loaded by
 * script-loader.js (CanamedLoader.ensureAdminTools()) when the facilitator
 * opens the dashboard, so the student-facing splash stays lean.
 *
 * It is a CLASSIC script (NOT a module): it shares the global script-scope, so
 * it can read the engine globals defined in script.js — allRooms, DECISIONS,
 * roomNames, roomCount, _debriefRoomList, _debriefBucket, roomParticipation,
 * tc, _curLang, sessionNum, _impactEsc — and expose its own functions on
 * window for the admin buttons to call.
 *
 * Everything here is computed CLIENT-SIDE from data already on the dashboard,
 * is aggregate + pseudonymous unless a name is intrinsic to the artifact, and
 * adds no new Firebase path.
 */

/* ── Competency map ────────────────────────────────────────────────────────
   Maps the platform's teaching content to recognised communication / clinical
   -reasoning competency frameworks, with a `localCode` slot each institution
   fills with its own national framework reference (France: EDN / référentiel
   de compétences; Japan: model core curriculum / CBME EPAs). `evidencedBy`
   lists the decision ids (and activity keys) that exercise + assess the
   competency, so the accreditation export can show, per competency, the
   activity, how it was assessed, and the cohort outcome.

   EDIT THIS to match your curriculum: add competencies, set localCode, and
   point evidencedBy at the relevant decision ids in case-content.js. */
var CANAMED_COMPETENCY_MAP = {
  framework: "Communication & clinical-reasoning competencies (Calgary–Cambridge / " +
    "SPIKES / shared decision-making), to be cross-referenced to the local national " +
    "framework via each competency's localCode (FR: EDN ; JP: model core curriculum / CBME).",
  competencies: [
    { id: "gather", label: "Information gathering & shared agenda-setting",
      framework: "Calgary–Cambridge", localCode: "",
      evidencedBy: ["dec_opioid", "dec_prescribe_or_not"], module: "A" },
    { id: "reasoning", label: "Hypothesis-driven clinical reasoning",
      framework: "CBME / EDN reasoning", localCode: "",
      evidencedBy: ["dec_plan"], module: "A" },
    { id: "stewardship", label: "Evidence-based prescribing & antimicrobial stewardship",
      framework: "Stewardship / NICE", localCode: "",
      evidencedBy: ["dec_prescribe_or_not", "dec_delayed_script"], module: "A" },
    { id: "empathy", label: "Empathic response & acknowledging emotion",
      framework: "SPIKES (E) / NURSE", localCode: "",
      evidencedBy: ["dec_first_words", "dec_family"], module: "B" },
    { id: "bbn", label: "Breaking bad news (SPIKES) & calibrated prognosis disclosure",
      framework: "SPIKES — Baile et al. 2000", localCode: "",
      evidencedBy: ["dec_prognosis", "dec_prognosis_next"], module: "B" },
    { id: "autonomy", label: "Respecting autonomy & goals-of-care decisions",
      framework: "Shared decision-making", localCode: "",
      evidencedBy: ["dec_ercp_stent", "dec_prognosis_next"], module: "B" }
  ]
};

(function () {
  "use strict";

  function esc(s) {
    return (typeof window !== "undefined" && typeof window._impactEsc === "function")
      ? window._impactEsc(s)
      : String(s == null ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function activeRooms() {
    if (typeof _debriefRoomList === "function") return _debriefRoomList();
    if (typeof roomNames === "function") {
      return roomNames(typeof roomCount !== "undefined" ? roomCount : 0)
        .filter(function (r) { return (typeof allRooms !== "undefined") && allRooms[r] != null; });
    }
    return [];
  }

  /* Cross-room outcome for a single decision id: of the rooms that LOCKED it
     in, how many chose the clinically-safest (correct) option. */
  function decisionOutcome(decId) {
    const rooms = activeRooms();
    const dec = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS))
      ? DECISIONS.find(function (d) { return d.id === decId; }) : null;
    if (!dec) return null;
    let committed = 0, correct = 0;
    rooms.forEach(function (r) {
      const v = ((allRooms[r] || {}).votes || {})[decId] || {};
      const c = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
      if (c == null) return;
      committed++;
      const opt = (dec.options || [])[c];
      if (opt && opt.correct) correct++;
    });
    const lang = (typeof _curLang === "function") ? _curLang() : "en";
    return {
      prompt: (typeof tc === "function") ? tc(dec.prompt, lang) : decId,
      committed: committed, correct: correct,
      pct: committed ? Math.round((correct / committed) * 100) : null
    };
  }

  /* Build the report rows for each competency in the map. */
  function competencyRows() {
    return (CANAMED_COMPETENCY_MAP.competencies || []).map(function (c) {
      const outcomes = (c.evidencedBy || [])
        .map(decisionOutcome)
        .filter(function (o) { return o != null; });
      let committed = 0, correct = 0, measured = 0;
      outcomes.forEach(function (o) {
        committed += o.committed; correct += o.correct;
        if (o.pct != null) measured++;
      });
      const pct = committed ? Math.round((correct / committed) * 100) : null;
      return {
        id: c.id, label: c.label, framework: c.framework, localCode: c.localCode || "",
        module: c.module || "", activities: outcomes, pct: pct, anyData: measured > 0
      };
    });
  }

  function openReport(html, filenameSuffix) {
    let w = null;
    try { w = window.open("", "_blank"); } catch (e) { /* blocked */ }
    if (w && w.document) {
      w.document.open(); w.document.write(html); w.document.close();
    } else {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "CANAMED_Session" +
        (typeof sessionNum !== "undefined" ? sessionNum : "") + "_" + filenameSuffix + ".html";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }
  }

  // Shared print-ready stylesheet for all admin-tools reports.
  const REPORT_CSS =
"*{box-sizing:border-box}body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2733;max-width:920px;margin:0 auto;padding:32px 24px;background:#fff}" +
"h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:26px 0 8px;border-bottom:2px solid #2563eb;padding-bottom:4px;color:#16335c}" +
".sub{color:#5b6b7b;margin:0 0 18px}table{width:100%;border-collapse:collapse;margin:8px 0;font-size:.92rem}" +
"th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e8edf2;vertical-align:top}th{background:#f0f4f8;color:#16335c}" +
"td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.tag{display:inline-block;font-size:.72rem;background:#eef3f9;color:#16335c;border-radius:4px;padding:1px 6px;margin-left:4px}" +
".note{font-size:.85rem;color:#5b6b7b;background:#f7f9fb;border-left:3px solid #2563eb;padding:10px 12px;border-radius:6px;margin:10px 0}" +
".foot{margin-top:26px;font-size:.8rem;color:#7a8694;border-top:1px solid #e8edf2;padding-top:12px}" +
"@media print{.noprint{display:none}body{padding:0}}" +
".pbtn{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:.95rem;cursor:pointer}";

  /* ── Accreditation evidence report ─────────────────────────────────────── */
  function generateAccreditationReport() {
    const rows = competencyRows();
    const when = new Date();
    const g = (typeof window._knowledgeGain === "function") ? window._knowledgeGain() : {};
    const gainBlock = (g && g.nPaired)
      ? "<h2>Knowledge gain (pre → post)</h2><p>Among the " + g.nPaired +
        " participant(s) who completed both tests, mean score rose from <strong>" +
        (g.meanPrePct == null ? "—" : g.meanPrePct + "%") + "</strong> to <strong>" +
        (g.meanPostPct == null ? "—" : g.meanPostPct + "%") + "</strong>" +
        (g.meanNormGain == null ? "" : " (normalized gain g = <strong>" + g.meanNormGain.toFixed(2) + "</strong>)") +
        " — direct, objective evidence of knowledge acquisition against the case learning objectives.</p>"
      : "";
    const body = rows.map(function (r) {
      const acts = r.activities.length
        ? r.activities.map(function (a) {
            return "<div>" + esc(a.prompt) +
              (a.pct != null ? " <span class='tag'>" + a.correct + "/" + a.committed +
              " safest (" + a.pct + "%)</span>" : " <span class='tag'>not yet decided</span>") + "</div>";
          }).join("")
        : "<em>—</em>";
      return "<tr><td><strong>" + esc(r.label) + "</strong>" +
        (r.module ? " <span class='tag'>Module " + esc(r.module) + "</span>" : "") +
        "<div class='sub' style='margin:2px 0 0'>" + esc(r.framework) +
        (r.localCode ? " · local code: " + esc(r.localCode) : " · local code: —") + "</div></td>" +
        "<td>" + acts + "</td>" +
        "<td class='num'>" + (r.pct != null ? r.pct + "%" : "—") + "</td></tr>";
    }).join("");

    const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Accreditation Evidence</title><style>" + REPORT_CSS + "</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF</button>" +
"<h1>CANAMED — Competency Evidence (accreditation)</h1>" +
"<p class='sub'>Session <strong>" + esc(typeof sessionNum !== "undefined" ? sessionNum : "—") +
"</strong> · generated " + esc(when.toLocaleString()) + "</p>" +
"<p class='note'>This summary maps the session's structured activities to communication / clinical-" +
"reasoning competencies and shows how each was <strong>exercised and assessed</strong> (team decisions " +
"committed against the clinically-safest option). Cross-reference each row's <em>local code</em> to your " +
"national framework (FR: EDN ; JP: model core curriculum / CBME) — the mapping lives in " +
"<code>CANAMED_COMPETENCY_MAP</code> and is editable per curriculum.</p>" +
"<h2>Competencies exercised &amp; assessed</h2>" +
"<table><thead><tr><th>Competency (framework)</th><th>Evidenced by — activity &amp; outcome</th>" +
"<th class='num'>safest %</th></tr></thead><tbody>" + body + "</tbody></table>" +
gainBlock +
"<div class='foot'>Figures are aggregate + pseudonymous, computed client-side from this session. " +
"'Safest %' is the share of rooms whose committed team decision matched the clinically-safest option " +
"defined in the case — a deliberate, discussed choice (reasoning evidence, not recall). Knowledge gain " +
"(pre/post) and satisfaction are captured separately via the session instruments.</div>" +
"</body></html>";
    openReport(html, "accreditation_evidence");
    if (typeof toast === "function") toast("📋 Accreditation evidence generated.");
  }

  /* Download a text blob (research export uses this; reports use openReport). */
  function download(text, filenameSuffix, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CANAMED_Session" +
      (typeof sessionNum !== "undefined" ? sessionNum : "") + "_" + filenameSuffix;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  /* Per-participant rows derived from the live room data. Contribution counts
     are keyed by clientId (cid) across both modules + hypotheses; university is
     recovered from the participant's own answer entries (presence carries only
     name + timestamp). Names ARE included here — callers decide whether to keep
     them (attestations) or drop them (research export). */
  function participantRows() {
    const rooms = activeRooms();
    const out = [];
    let pid = 0;
    rooms.forEach(function (r) {
      const d = allRooms[r] || {};
      const pres = d.presence || {};
      const ans = d.answers || {};
      const contribByCid = {}, uniByCid = {};
      ["moduleA", "moduleB"].forEach(function (mk) {
        const m = ans[mk] || {};
        Object.keys(m).forEach(function (k) {
          const e = m[k]; const cid = e && e.cid;
          if (!cid) return;
          contribByCid[cid] = (contribByCid[cid] || 0) + 1;
          if (e.university && !uniByCid[cid]) uniByCid[cid] = e.university;
        });
      });
      const hyp = d.hypotheses || {}, hypByCid = {};
      Object.keys(hyp).forEach(function (k) {
        const cid = hyp[k] && hyp[k].cid; if (cid) hypByCid[cid] = (hypByCid[cid] || 0) + 1;
      });
      Object.keys(pres).forEach(function (cid) {
        pid++;
        const p = pres[cid] || {};
        const a = contribByCid[cid] || 0, h = hypByCid[cid] || 0;
        out.push({
          pid: "P" + pid, room: r,
          name: (typeof p.name === "string") ? p.name : "",
          university: uniByCid[cid] || "",
          answers: a, hypotheses: h, contributed: (a + h) > 0 ? 1 : 0
        });
      });
    });
    return out;
  }

  /* ── Research export ───────────────────────────────────────────────────── */
  /* One-click, analysis-ready, PSEUDONYMOUS JSON bundle aligned to the study
     protocol/SAP (participants P1..Pn, room-level decisions, equity summary).
     Read in R with jsonlite::fromJSON(). No names. */
  function generateResearchExport() {
    const rooms = activeRooms();
    const participants = participantRows().map(function (p) {
      return { pid: p.pid, room: p.room, university: p.university,
               answers: p.answers, hypotheses: p.hypotheses, contributed: p.contributed };
    });
    const decisions = [];
    const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
    rooms.forEach(function (r) {
      decList.forEach(function (dec) {
        const v = ((allRooms[r] || {}).votes || {})[dec.id] || {};
        const c = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
        const opt = (c != null && dec.options) ? dec.options[c] : null;
        decisions.push({ room: r, decision: dec.id, module: dec.module || "",
          committed_choice: c, correct: opt ? (opt.correct ? 1 : 0) : null });
      });
    });
    const preMax = Array.isArray(window.PRETEST) ? window.PRETEST.length : 0;
    const postMax = Array.isArray(window.POSTTEST) ? window.POSTTEST.length : 0;
    // Per-room, per-participant pre/post test scores (pseudonymous: indexed,
    // no cid/name) — the paired learning-gain inputs the SAP analysis needs.
    const tests = [];
    rooms.forEach(function (r) {
      const tnode = (allRooms[r] || {}).tests || {};
      let i = 0;
      Object.keys(tnode).forEach(function (cid) {
        i++;
        const t = tnode[cid] || {};
        const pre = (t.pre && typeof t.pre.score === "number" && !t.pre.skipped) ? t.pre.score : null;
        const post = (t.post && typeof t.post.score === "number" && !t.post.skipped) ? t.post.score : null;
        if (pre == null && post == null) return;
        tests.push({ room: r, idx: r + "-" + i, pre: pre, post: post, preMax: preMax, postMax: postMax });
      });
    });
    // Per-room, per-participant feedback-survey responses (pseudonymous: the
    // same room-idx scheme as `tests`, no cid/name). Long format — one row per
    // answered question — so a partial questionnaire still exports cleanly.
    const survey = [];
    rooms.forEach(function (r) {
      const snode = (allRooms[r] || {}).survey || {};
      let i = 0;
      Object.keys(snode).forEach(function (cid) {
        i++;
        const s = snode[cid] || {};
        if (s.skipped === true || !s.responses) return;
        Object.keys(s.responses).forEach(function (qid) {
          const resp = s.responses[qid] || {};
          if (resp.v == null || resp.v === "") return;
          survey.push({ room: r, idx: r + "-" + i, qid: qid, value: resp.v });
        });
      });
    });
    const roomsOut = rooms.map(function (r) {
      const d = allRooms[r] || {};
      const part = (typeof roomParticipation === "function") ? roomParticipation(d) : {};
      const score = (typeof _debriefBucket === "function") ? _debriefBucket(d).total : null;
      return { room: r, present: part.present || 0, contributing: part.contributing || 0,
               gini: (part.gini != null ? part.gini : null), score: score };
    });
    const bundle = {
      session: (typeof sessionNum !== "undefined") ? sessionNum : "",
      exportedAt: new Date().toISOString(),
      pseudonymous: true,
      note: "Analysis-ready CANAMED export. Participants are pseudonymous (P1..Pn / room-idx); no names. " +
            "Read in R with jsonlite::fromJSON(). Aligns to the study protocol/SAP: participant " +
            "contribution metrics, room-level committed decisions (with correctness), per-participant " +
            "pre/post test scores (with maxima) for paired learning-gain, the end-of-session feedback " +
            "survey responses (long format), and the equity (Gini) + score summary per room.",
      knowledgeGain: (typeof window._knowledgeGain === "function") ? window._knowledgeGain() : null,
      participants: participants, decisions: decisions, tests: tests, survey: survey, rooms: roomsOut
    };
    download(JSON.stringify(bundle, null, 2), "research_export.json", "application/json");
    if (typeof toast === "function") toast("🔬 Research export downloaded (pseudonymous JSON).");
  }

  /* ── CSV research export ───────────────────────────────────────────────── */
  /* Same pseudonymous data as the JSON export, but as flat CSV files that open
     straight in Excel / read with read.csv() in R. Produces TWO files in one
     click:
       • participants — one row per participant: contribution metrics, paired
         pre/post test scores (+ maxima + normalized gain), and one column per
         feedback-survey question (the response value).
       • decisions    — one row per room × team decision (committed choice +
         whether it matched the clinically-safest option).
     Heterogeneous tables don't fit one sheet, so the participant join (presence
     ⨝ tests ⨝ survey, by the per-room participant index) is the primary file
     and decisions ship alongside. No names; no new Firebase path. */
  function _csvCell(v) {
    if (v == null) return "";
    let s = String(v);
    // Strip CR/LF so a free-text answer can't break the row; quote always so
    // commas, quotes and semicolons survive in any locale's Excel.
    s = s.replace(/\r?\n/g, " ").replace(/"/g, '""');
    return '"' + s + '"';
  }
  function _toCSV(headers, rows) {
    const head = headers.map(_csvCell).join(",");
    const body = rows.map(function (row) {
      return headers.map(function (h) { return _csvCell(row[h]); }).join(",");
    }).join("\r\n");
    // BOM so Excel reads UTF-8 (accents, 日本語) correctly on open.
    return "﻿" + head + "\r\n" + body + "\r\n";
  }

  /* Stable survey-question column order: prefer the shipped bank order, then
     append any extra qids seen in the data (defensive against bank edits). */
  function _surveyColumns(rooms) {
    const cols = [];
    const seen = {};
    const bank = Array.isArray(window.SURVEY) ? window.SURVEY : [];
    bank.forEach(function (item) {
      if (item && item.id && !seen[item.id]) { seen[item.id] = 1; cols.push(item.id); }
    });
    rooms.forEach(function (r) {
      const snode = (allRooms[r] || {}).survey || {};
      Object.keys(snode).forEach(function (cid) {
        const resp = (snode[cid] || {}).responses || {};
        Object.keys(resp).forEach(function (qid) {
          if (!seen[qid]) { seen[qid] = 1; cols.push(qid); }
        });
      });
    });
    return cols;
  }

  function researchCsvParticipantRows() {
    const rooms = activeRooms();
    const preMax = Array.isArray(window.PRETEST) ? window.PRETEST.length : 0;
    const postMax = Array.isArray(window.POSTTEST) ? window.POSTTEST.length : 0;
    const surveyCols = _surveyColumns(rooms);
    const rows = [];
    let pid = 0;
    rooms.forEach(function (r) {
      const d = allRooms[r] || {};
      const pres = d.presence || {};
      const ans = d.answers || {};
      const tnode = d.tests || {};
      const snode = d.survey || {};
      // contribution + university by cid (same derivation as participantRows)
      const contribByCid = {}, uniByCid = {};
      ["moduleA", "moduleB"].forEach(function (mk) {
        const m = ans[mk] || {};
        Object.keys(m).forEach(function (k) {
          const e = m[k]; const cid = e && e.cid;
          if (!cid) return;
          contribByCid[cid] = (contribByCid[cid] || 0) + 1;
          if (e.university && !uniByCid[cid]) uniByCid[cid] = e.university;
        });
      });
      const hyp = d.hypotheses || {}, hypByCid = {};
      Object.keys(hyp).forEach(function (k) {
        const cid = hyp[k] && hyp[k].cid; if (cid) hypByCid[cid] = (hypByCid[cid] || 0) + 1;
      });
      Object.keys(pres).forEach(function (cid) {
        pid++;
        const t = tnode[cid] || {};
        const pre = (t.pre && typeof t.pre.score === "number" && !t.pre.skipped) ? t.pre.score : null;
        const post = (t.post && typeof t.post.score === "number" && !t.post.skipped) ? t.post.score : null;
        let gain = "";
        if (pre != null && post != null && preMax && postMax) {
          const prePct = (pre / preMax) * 100, postPct = (post / postMax) * 100;
          gain = (prePct < 100) ? Math.round(((postPct - prePct) / (100 - prePct)) * 100) / 100 : "";
        }
        const a = contribByCid[cid] || 0, h = hypByCid[cid] || 0;
        const row = {
          session: (typeof sessionNum !== "undefined") ? sessionNum : "",
          participant: "P" + pid, room: r,
          university: uniByCid[cid] || "",
          answers: a, hypotheses: h, contributed: (a + h) > 0 ? 1 : 0,
          pre: (pre == null ? "" : pre), preMax: preMax || "",
          post: (post == null ? "" : post), postMax: postMax || "",
          normGain: gain
        };
        const sresp = (snode[cid] || {}).responses || {};
        surveyCols.forEach(function (qid) {
          row[qid] = (sresp[qid] && sresp[qid].v != null) ? sresp[qid].v : "";
        });
        rows.push(row);
      });
    });
    return { rows: rows, surveyCols: surveyCols };
  }

  /* Pseudonymous per-room participant index: assigns P1..Pn over presence cids
     in the SAME order as researchCsvParticipantRows(), and maps cid + name → pid
     so the detail files (reveals / votes / free-text) link back to a participant
     without exposing names. */
  function _participantIndex() {
    const rooms = activeRooms();
    const pidByRoomCid = {}, pidByRoomName = {};
    let pid = 0;
    rooms.forEach(function (r) {
      const pres = (allRooms[r] || {}).presence || {};
      pidByRoomCid[r] = {}; pidByRoomName[r] = {};
      Object.keys(pres).forEach(function (cid) {
        pid++;
        const p = "P" + pid;
        pidByRoomCid[r][cid] = p;
        const nm = (pres[cid] && typeof pres[cid].name === "string") ? pres[cid].name : "";
        if (nm && !pidByRoomName[r][nm]) pidByRoomName[r][nm] = p;
      });
    });
    return { pidByRoomCid: pidByRoomCid, pidByRoomName: pidByRoomName };
  }
  const _sess = function () { return (typeof sessionNum !== "undefined") ? sessionNum : ""; };

  /* Reveals — the clinical action log: which item each participant opened and
     WHEN (so order is recoverable by sorting `at`). Reveals are stored with the
     revealer's name only; we map name→pid to keep the file pseudonymous. */
  function _revealRows(idx) {
    const rows = [];
    activeRooms().forEach(function (r) {
      const node = (((allRooms[r] || {}).moduleA) || {}).revealed || {};
      const seq = Object.keys(node).map(function (item) {
        return { item: item, by: (node[item] || {}).by || "", at: (node[item] || {}).at || 0 };
      }).sort(function (a, b) { return a.at - b.at; });
      seq.forEach(function (e, i) {
        rows.push({ session: _sess(), room: r,
          participant: (idx.pidByRoomName[r] || {})[e.by] || "",
          item: e.item, at: e.at, order: i + 1 });
      });
    });
    return rows;
  }

  /* Individual ballots — every participant's own vote on each team decision,
     plus the choice the team finally committed. */
  function _voteRows(idx) {
    const rows = [];
    const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
    const decById = {}; decList.forEach(function (d) { decById[d.id] = d; });
    activeRooms().forEach(function (r) {
      const votes = (allRooms[r] || {}).votes || {};
      Object.keys(votes).forEach(function (decId) {
        const v = votes[decId] || {}; const dec = decById[decId] || {};
        const committed = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : "";
        const ballots = v.ballots || {};
        Object.keys(ballots).forEach(function (cid) {
          const b = ballots[cid] || {};
          const choice = (typeof b.choice === "number") ? b.choice : "";
          const opt = (choice !== "" && dec.options) ? dec.options[choice] : null;
          rows.push({ session: _sess(), room: r, decision: decId, module: dec.module || "",
            participant: (idx.pidByRoomCid[r] || {})[cid] || "",
            choice: choice, choice_correct: opt ? (opt.correct ? 1 : 0) : "",
            committed_team_choice: committed });
        });
      });
    });
    return rows;
  }

  /* Free-text — the actual words participants wrote (Module A/B answers and the
     working hypotheses), not just counts. */
  function _freetextRows(idx) {
    const rows = [];
    activeRooms().forEach(function (r) {
      const d = allRooms[r] || {};
      ["moduleA", "moduleB"].forEach(function (mk) {
        const m = (d.answers || {})[mk] || {};
        Object.keys(m).forEach(function (k) {
          const e = m[k] || {}; const text = (e.text != null) ? e.text : (e.value != null ? e.value : "");
          if (text === "") return;
          rows.push({ session: _sess(), room: r,
            participant: (idx.pidByRoomCid[r] || {})[e.cid] || "",
            type: mk + "-answer", key: k, text: text });
        });
      });
      const hyp = (d.moduleA || {}).hypotheses || d.hypotheses || {};
      Object.keys(hyp).forEach(function (k) {
        const e = hyp[k] || {}; const text = (e.text != null) ? e.text : "";
        if (text === "") return;
        rows.push({ session: _sess(), room: r,
          participant: (idx.pidByRoomCid[r] || {})[e.cid] || "",
          type: "hypothesis", key: k, text: text });
      });
    });
    return rows;
  }

  /* Codebook — the data dictionary: what every coded value means (decision
     options + correctness, survey questions, test maxima, file/field notes). */
  function _codebookRows() {
    const rows = [];
    const lang = "en";
    const tcf = (typeof tc === "function") ? tc : function (x) { return (x && x.en != null) ? x.en : x; };
    const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
    decList.forEach(function (dec) {
      (dec.options || []).forEach(function (opt, i) {
        rows.push({ table: "votes/decisions", field: dec.id, code: i,
          meaning: tcf(opt.text, lang), extra: (opt.correct ? "clinically-safest option" : ""),
          module: dec.module || "" });
      });
    });
    const survey = Array.isArray(window.SURVEY) ? window.SURVEY : [];
    survey.forEach(function (q) {
      rows.push({ table: "participants (survey columns)", field: q.id, code: "value",
        meaning: tcf(q.q || q.text || q.label, lang), extra: q.scale ? ("scale: " + q.scale) : "", module: "" });
    });
    rows.push({ table: "participants", field: "pre/post", code: "0..max",
      meaning: "Pre/post knowledge-test score; preMax/postMax give the maximum.", extra: "", module: "" });
    rows.push({ table: "participants", field: "normGain", code: "0..1",
      meaning: "Normalized learning gain (post%-pre%)/(100-pre%).", extra: "", module: "" });
    rows.push({ table: "reveals", field: "order", code: "1..n",
      meaning: "Sequence in which the participant opened clinical items (sort key = at).", extra: "", module: "A" });
    rows.push({ table: "ALL", field: "participant", code: "P1..Pn",
      meaning: "Pseudonymous per-room participant id; join every file on this.", extra: "", module: "" });
    return rows;
  }

  function generateResearchExportCSV() {
    const idx = _participantIndex();
    const built = researchCsvParticipantRows();
    const baseCols = ["session", "participant", "room", "university", "answers", "hypotheses",
                      "contributed", "pre", "preMax", "post", "postMax", "normGain"];
    download(_toCSV(baseCols.concat(built.surveyCols), built.rows), "research_participants.csv", "text/csv");

    download(_toCSV(["session", "room", "participant", "item", "at", "order"], _revealRows(idx)),
      "research_reveals.csv", "text/csv");
    download(_toCSV(["session", "room", "decision", "module", "participant", "choice",
      "choice_correct", "committed_team_choice"], _voteRows(idx)), "research_votes.csv", "text/csv");
    download(_toCSV(["session", "room", "participant", "type", "key", "text"], _freetextRows(idx)),
      "research_freetext.csv", "text/csv");

    // Room × decision table (committed team decisions + correctness).
    const decList = (typeof DECISIONS !== "undefined" && Array.isArray(DECISIONS)) ? DECISIONS : [];
    const decRows = [];
    activeRooms().forEach(function (r) {
      decList.forEach(function (dec) {
        const v = ((allRooms[r] || {}).votes || {})[dec.id] || {};
        const c = (v.committed && typeof v.committed.choice === "number") ? v.committed.choice : null;
        const opt = (c != null && dec.options) ? dec.options[c] : null;
        decRows.push({ session: _sess(), room: r, decision: dec.id, module: dec.module || "",
          committed_choice: (c == null ? "" : c), correct: opt ? (opt.correct ? 1 : 0) : "" });
      });
    });
    download(_toCSV(["session", "room", "decision", "module", "committed_choice", "correct"], decRows),
      "research_decisions.csv", "text/csv");

    download(_toCSV(["table", "field", "code", "meaning", "extra", "module"], _codebookRows()),
      "research_codebook.csv", "text/csv");
    if (typeof toast === "function") {
      toast("📊 CSV export downloaded (participants, reveals, votes, free-text, decisions, codebook).");
    }
  }

  /* ── Per-participant attestations ──────────────────────────────────────── */
  /* Printable certificates of participation + competencies practiced, one per
     present participant (NAMED — an attestation is the student's own record;
     distribute individually). Page-break between cards for clean printing. */
  function generateAttestations() {
    const rows = participantRows();
    const when = new Date();
    const comps = (CANAMED_COMPETENCY_MAP.competencies || [])
      .map(function (c) { return "<li>" + esc(c.label) + " <em>(" + esc(c.framework) + ")</em></li>"; })
      .join("");
    const dateStr = when.toLocaleDateString();
    const cards = (rows.length ? rows : [{ name: "", pid: "P1", room: "" }]).map(function (p) {
      const nm = (p.name && p.name.trim()) ? p.name.trim() : "Participant " + p.pid;
      return "<section class='cert'>" +
        "<div class='cert-head'>CANAMED — Franco-Japanese Clinical Communication Workshop</div>" +
        "<div class='cert-sub'>Université de Caen Normandie × Nagoya University</div>" +
        "<p class='cert-line'>This certifies that</p>" +
        "<div class='cert-name'>" + esc(nm) + "</div>" +
        "<p class='cert-line'>participated in the CANAMED clinical-communication session on " +
        esc(dateStr) + (p.room ? " (" + esc(p.room) + ")" : "") +
        ", engaging in structured clinical reasoning and a breaking-bad-news roleplay, and practising:</p>" +
        "<ul class='cert-comps'>" + comps + "</ul>" +
        "<div class='cert-foot'>Session " + esc(typeof sessionNum !== "undefined" ? sessionNum : "—") +
        " · " + esc(when.toLocaleDateString()) + " · facilitator signature: ______________________</div>" +
        "</section>";
    }).join("");

    const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Attestations</title><style>" + REPORT_CSS +
".cert{border:2px solid #16335c;border-radius:12px;padding:28px 32px;margin:0 0 24px;page-break-after:always}" +
".cert-head{font-size:1.2rem;font-weight:700;color:#16335c;text-align:center}" +
".cert-sub{text-align:center;color:#5b6b7b;margin:2px 0 18px}" +
".cert-line{text-align:center;margin:6px 0}.cert-name{text-align:center;font-size:1.5rem;font-weight:700;color:#2563eb;margin:6px 0}" +
".cert-comps{max-width:520px;margin:10px auto}.cert-foot{margin-top:18px;font-size:.82rem;color:#5b6b7b;text-align:center}" +
"</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF (one per participant)</button>" +
cards +
"<div class='foot noprint'>One certificate per present participant. Attestations are named records — " +
"distribute each to its student. Generated client-side; no data leaves this device.</div>" +
"</body></html>";
    openReport(html, "attestations");
    if (typeof toast === "function") toast("🎓 Attestations generated (" + rows.length + ").");
  }

  /* ── Program overview (cross-session) ──────────────────────────────────── */
  /* Reads the durable LOCAL program-session rollup (written by closeSession in
     script.js, kept across close) and aggregates it into a program-level
     report — cumulative students trained, sessions run, and the satisfaction-
     proxy / equity / decision-quality trend. This is the "is the whole PROGRAM
     working?" view a décideur wants, above the per-session impact report.
     Aggregate + pseudonymous; data never leaves the device. */
  function programSessions() {
    try {
      const list = JSON.parse(localStorage.getItem("canamed_program_sessions"));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function generateProgramDashboard() {
    const list = programSessions().slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    const meanOf = function (vals) {
      const v = vals.filter(function (x) { return x != null; });
      return v.length ? (v.reduce(function (s, x) { return s + x; }, 0) / v.length) : null;
    };
    const totalParticipants = list.reduce(function (s, x) { return s + (x.participants || 0); }, 0);
    const meanContrib = meanOf(list.map(function (x) { return x.contribPct; }));
    const meanAcc = meanOf(list.map(function (x) { return x.decisionAccuracyPct; }));
    const meanGini = meanOf(list.map(function (x) { return x.meanGini; }));
    const meanGain = meanOf(list.map(function (x) { return x.normGain; }));
    const when = new Date();
    const pct = function (v) { return v == null ? "—" : Math.round(v) + "%"; };

    const rows = list.map(function (s) {
      const d = s.at ? new Date(s.at).toLocaleDateString() : "—";
      return "<tr><td>" + esc(d) + "</td><td>" + esc(s.code || "—") + "</td>" +
        "<td class='num'>" + (s.participants || 0) + "</td>" +
        "<td class='num'>" + (s.contribPct != null ? s.contribPct + "%" : "—") + "</td>" +
        "<td class='num'>" + (s.decisionAccuracyPct != null ? s.decisionAccuracyPct + "%" : "—") + "</td>" +
        "<td class='num'>" + (s.normGain != null ? "+" + Number(s.normGain).toFixed(2) : "—") + "</td>" +
        "<td class='num'>" + (s.meanGini != null ? Number(s.meanGini).toFixed(2) : "—") + "</td></tr>";
    }).join("");

    const empty = list.length === 0;
    const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Program Overview</title><style>" + REPORT_CSS +
".kpis{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}" +
".kpi{flex:1 1 150px;border:1px solid #e1e7ed;border-radius:10px;padding:12px 14px;background:#f7f9fb}" +
".kpi .v{font-size:1.7rem;font-weight:700;color:#16335c}.kpi .l{font-size:.8rem;color:#5b6b7b}" +
"</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF</button>" +
"<h1>CANAMED — Program Overview</h1>" +
"<p class='sub'>Across all closed sessions on this device · generated " + esc(when.toLocaleString()) + "</p>" +
(empty
  ? "<p class='note'>No closed sessions are recorded on this device yet. This overview fills in " +
    "automatically each time you run and close a session — then it shows the whole programme's " +
    "reach and trend at a glance (cumulative students, satisfaction-proxy, equity, decision quality).</p>"
  : "<div class='kpis'>" +
    "<div class='kpi'><div class='v'>" + list.length + "</div><div class='l'>sessions run</div></div>" +
    "<div class='kpi'><div class='v'>" + totalParticipants + "</div><div class='l'>students trained (cumulative)</div></div>" +
    "<div class='kpi'><div class='v'>" + pct(meanContrib) + "</div><div class='l'>mean contributing</div></div>" +
    "<div class='kpi'><div class='v'>" + pct(meanAcc) + "</div><div class='l'>mean decision accuracy</div></div>" +
    "<div class='kpi'><div class='v'>" + (meanGain == null ? "—" : "+" + meanGain.toFixed(2)) +
      "</div><div class='l'>mean knowledge gain (g)</div></div>" +
    "<div class='kpi'><div class='v'>" + (meanGini == null ? "—" : meanGini.toFixed(2)) +
      "</div><div class='l'>mean equity (Gini)</div></div>" +
    "</div>" +
    "<h2>Sessions</h2><table><thead><tr><th>Date</th><th>Session</th><th class='num'>students</th>" +
    "<th class='num'>contributing</th><th class='num'>decision acc.</th><th class='num'>gain g</th>" +
    "<th class='num'>equity</th>" +
    "</tr></thead><tbody>" + rows + "</tbody></table>") +
"<div class='foot'>Aggregate + pseudonymous, compiled from a local per-session rollup written when each " +
"session is closed (no names, no answers; data never leaves this device). A durable copy of each session " +
"summary is also stored under the session's <code>/summary</code> node for cross-device reporting. Use " +
"this as program-level evidence of reach and trend for leadership / accreditation.</div>" +
"</body></html>";
    openReport(html, "program_overview");
    if (typeof toast === "function") toast("📈 Program overview generated (" + list.length + " sessions).");
  }

  /* ── Item difficulty (curriculum feedback) ─────────────────────────────── */
  /* Which team decisions consistently trip rooms up — the curriculum-improvement
     view. Aggregates per-decision correct-rate across the program rollup
     (summary.decAcc, written on close) AND the current live session, keyed by
     decision id, sorted hardest-first, with a reteach/watch flag. Tells the
     facilitator what to redesign or reteach. Aggregate + pseudonymous. */
  function itemDifficultyRows() {
    const agg = {}; // decId -> { sum, n }
    (programSessions() || []).forEach(function (s) {
      const da = s.decAcc || {};
      Object.keys(da).forEach(function (id) {
        if (typeof da[id] !== "number") return;
        if (!agg[id]) agg[id] = { sum: 0, n: 0 };
        agg[id].sum += da[id]; agg[id].n++;
      });
    });
    const promptById = {};
    const live = (typeof window._impactMetrics === "function")
      ? (window._impactMetrics().decAgg || []) : [];
    live.forEach(function (d) {
      if (!d.id) return;
      promptById[d.id] = d.prompt;
      if (d.committedRooms > 0) {
        if (!agg[d.id]) agg[d.id] = { sum: 0, n: 0 };
        agg[d.id].sum += Math.round((d.correctRooms / d.committedRooms) * 100);
        agg[d.id].n++;
      }
    });
    return Object.keys(agg).map(function (id) {
      return { id: id, prompt: promptById[id] || id,
               pct: Math.round(agg[id].sum / agg[id].n), n: agg[id].n };
    }).sort(function (a, b) { return a.pct - b.pct; });
  }
  function generateItemDifficulty() {
    const items = itemDifficultyRows();
    const when = new Date();
    const flag = function (p) {
      return p < 60 ? "<span class='tag' style='background:#fde8e8;color:#9b1c1c'>reteach</span>"
           : p < 80 ? "<span class='tag' style='background:#fef3cd;color:#8a5a00'>watch</span>"
           : "<span class='tag' style='background:#e8f5ec;color:#1d6b3f'>solid</span>";
    };
    const rows = items.map(function (it) {
      return "<tr><td>" + esc(it.prompt) + "</td><td class='num'>" + it.pct + "%</td>" +
        "<td class='num'>" + it.n + "</td><td>" + flag(it.pct) + "</td></tr>";
    }).join("");
    const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Item Difficulty</title><style>" + REPORT_CSS + "</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF</button>" +
"<h1>CANAMED — Item Difficulty (curriculum feedback)</h1>" +
"<p class='sub'>Decisions ranked hardest-first · across the live session + your closed-session rollup · " +
esc(when.toLocaleString()) + "</p>" +
(items.length
  ? "<p class='note'>The lower the safest-answer rate, the more a decision is tripping teams up — a signal " +
    "to reteach the underlying concept or revisit the item's wording/options. 'n' is how many sessions " +
    "(live + rollup) contributed.</p>" +
    "<table><thead><tr><th>Team decision</th><th class='num'>safest %</th><th class='num'>n</th>" +
    "<th>status</th></tr></thead><tbody>" + rows + "</tbody></table>"
  : "<p class='note'>No committed decisions yet — this view fills in from the live session and from each " +
    "session you close. It then shows which decisions consistently trip rooms up, so you know what to reteach.</p>") +
"<div class='foot'>Aggregate + pseudonymous. Per-decision correct-rate = share of rooms whose committed " +
"team decision matched the clinically-safest option. Use this to target curriculum revision.</div>" +
"</body></html>";
    openReport(html, "item_difficulty");
    if (typeof toast === "function") toast("🧭 Item-difficulty report generated.");
  }

  /* ── Cohort comparison (Caen × Nagoya quasi-experiment) ────────────────── */
  /* Splits the live session by university — the same intervention across two
     cohorts is a built-in natural experiment. Per cohort: contributors, mean
     contributions, and paired pre→post knowledge gain. University is taken from
     each participant's own answer entries (the reliable client-side source);
     participants with no answer fall into "unknown". Aggregate + pseudonymous. */
  function cohortRows() {
    const rooms = activeRooms();
    const preMax = Array.isArray(window.PRETEST) ? window.PRETEST.length : 0;
    const postMax = Array.isArray(window.POSTTEST) ? window.POSTTEST.length : 0;
    const byUni = {};
    rooms.forEach(function (r) {
      const d = allRooms[r] || {};
      const ans = d.answers || {};
      const uniByCid = {}, ansByCid = {};
      ["moduleA", "moduleB"].forEach(function (mk) {
        const m = ans[mk] || {};
        Object.keys(m).forEach(function (k) {
          const e = m[k]; const cid = e && e.cid;
          if (!cid) return;
          ansByCid[cid] = (ansByCid[cid] || 0) + 1;
          if (e.university && !uniByCid[cid]) uniByCid[cid] = e.university;
        });
      });
      const tests = d.tests || {};
      Object.keys(ansByCid).forEach(function (cid) {
        const uni = uniByCid[cid] || "unknown";
        const b = byUni[uni] = byUni[uni] ||
          { n: 0, answers: 0, prePctSum: 0, postPctSum: 0, gainSum: 0, nGain: 0, nPaired: 0 };
        b.n++; b.answers += ansByCid[cid] || 0;
        const t = tests[cid] || {};
        const pre = t.pre, post = t.post;
        if (pre && !pre.skipped && typeof pre.score === "number" &&
            post && !post.skipped && typeof post.score === "number" && preMax && postMax) {
          const prePct = (pre.score / preMax) * 100, postPct = (post.score / postMax) * 100;
          b.prePctSum += prePct; b.postPctSum += postPct; b.nPaired++;
          if (prePct < 100) { b.gainSum += (postPct - prePct) / (100 - prePct); b.nGain++; }
        }
      });
    });
    return Object.keys(byUni).map(function (uni) {
      const b = byUni[uni];
      return {
        uni: uni, n: b.n,
        meanAnswers: b.n ? Math.round((b.answers / b.n) * 10) / 10 : 0,
        prePct: b.nPaired ? Math.round(b.prePctSum / b.nPaired) : null,
        postPct: b.nPaired ? Math.round(b.postPctSum / b.nPaired) : null,
        gain: b.nGain ? Math.round((b.gainSum / b.nGain) * 100) / 100 : null,
        nPaired: b.nPaired
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }
  function generateCohortComparison() {
    const cohorts = cohortRows();
    const when = new Date();
    const rows = cohorts.map(function (c) {
      return "<tr><td><strong>" + esc(c.uni) + "</strong></td>" +
        "<td class='num'>" + c.n + "</td>" +
        "<td class='num'>" + c.meanAnswers + "</td>" +
        "<td class='num'>" + (c.prePct == null ? "—" : c.prePct + "%") + "</td>" +
        "<td class='num'>" + (c.postPct == null ? "—" : c.postPct + "%") + "</td>" +
        "<td class='num'>" + (c.gain == null ? "—" : "+" + c.gain.toFixed(2)) +
        " <span class='tag'>n=" + c.nPaired + "</span></td></tr>";
    }).join("");
    const html =
"<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
"<meta name='viewport' content='width=device-width, initial-scale=1'>" +
"<title>CANAMED — Cohort Comparison</title><style>" + REPORT_CSS + "</style></head><body>" +
"<button class='pbtn noprint' onclick='window.print()'>🖨 Print / Save as PDF</button>" +
"<h1>CANAMED — Cohort Comparison</h1>" +
"<p class='sub'>By university · the same intervention across cohorts (a built-in natural experiment) · " +
esc(when.toLocaleString()) + "</p>" +
(cohorts.length
  ? "<table><thead><tr><th>Cohort</th><th class='num'>participants</th>" +
    "<th class='num'>mean contributions</th><th class='num'>pre %</th><th class='num'>post %</th>" +
    "<th class='num'>gain g</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    "<p class='note'>This Caen × Nagoya split is your strongest research asset: two cohorts, one " +
    "intervention. Treat the gains as comparable in magnitude (the tests may differ in content), and read " +
    "the per-cohort paired N before interpreting. University is taken from each participant's contributions.</p>"
  : "<p class='note'>No cohort data yet — this fills in as participants contribute and complete the tests.</p>") +
"<div class='foot'>Aggregate + pseudonymous, computed client-side from the live session. Participants whose " +
"university could not be determined from their contributions appear under 'unknown'.</div>" +
"</body></html>";
    openReport(html, "cohort_comparison");
    if (typeof toast === "function") toast("🌍 Cohort comparison generated.");
  }

  /* ── Transactional email (consent-gated) ──────────────────────────────── */
  /* Enqueue one email by writing sessions/<code>/mail/<id> — the Cloud Function
     (functions/index.js) sends it. Admin-gated by the database rules (a session
     adminPasswordHash must exist), so this is not an open relay.

     DORMANT until approved: the email feature is DISABLED by default and is not
     wired to any UI. Even when enqueued, the Cloud Function will not send until
     the institution (university president) approves it and an operator flips the
     approval flag (email.enabled) — see functions/README.md. This helper exists
     for that future, approved flow; consent + configured SMTP are also required.
     Returns a Promise. */
  function enqueueMail(to, subject, text) {
    if (typeof db === "undefined" || !db || typeof sPath !== "function") {
      return Promise.reject(new Error("no database"));
    }
    if (!to || !subject) return Promise.reject(new Error("missing recipient/subject"));
    return db.ref(sPath("mail")).push({
      to: String(to).slice(0, 200),
      subject: String(subject).slice(0, 200),
      text: text ? String(text).slice(0, 5000) : "",
      at: Date.now()
    });
  }

  // Expose on window for the admin button + future tools.
  window.CanamedAdminTools = window.CanamedAdminTools || {};
  window.CanamedAdminTools.enqueueMail = enqueueMail;
  window.CanamedAdminTools.cohortRows = cohortRows;                   // for tests
  window.CanamedAdminTools.generateCohortComparison = generateCohortComparison;
  window.generateCohortComparison = generateCohortComparison;
  window.CanamedAdminTools.itemDifficultyRows = itemDifficultyRows;   // for tests
  window.CanamedAdminTools.generateItemDifficulty = generateItemDifficulty;
  window.generateItemDifficulty = generateItemDifficulty;
  window.CanamedAdminTools.programSessions = programSessions;  // for tests
  window.CanamedAdminTools.generateProgramDashboard = generateProgramDashboard;
  window.generateProgramDashboard = generateProgramDashboard;
  window.CanamedAdminTools.generateAccreditationReport = generateAccreditationReport;
  window.CanamedAdminTools.competencyRows = competencyRows;     // for tests
  window.CanamedAdminTools.participantRows = participantRows;   // for tests
  window.CanamedAdminTools.generateResearchExport = generateResearchExport;
  window.CanamedAdminTools.generateResearchExportCSV = generateResearchExportCSV;
  window.CanamedAdminTools.researchCsvParticipantRows = researchCsvParticipantRows; // for tests
  window.CanamedAdminTools.generateAttestations = generateAttestations;
  window.generateAccreditationReport = generateAccreditationReport;
  window.generateResearchExport = generateResearchExport;
  window.generateResearchExportCSV = generateResearchExportCSV;
  window.generateAttestations = generateAttestations;
})();
