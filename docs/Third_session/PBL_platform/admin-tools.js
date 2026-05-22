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
"<div class='foot'>Figures are aggregate + pseudonymous, computed client-side from this session. " +
"'Safest %' is the share of rooms whose committed team decision matched the clinically-safest option " +
"defined in the case — a deliberate, discussed choice (reasoning evidence, not recall). Knowledge gain " +
"(pre/post) and satisfaction are captured separately via the session instruments.</div>" +
"</body></html>";
    openReport(html, "accreditation_evidence");
    if (typeof toast === "function") toast("📋 Accreditation evidence generated.");
  }

  // Expose on window for the admin button + future tools.
  window.CanamedAdminTools = window.CanamedAdminTools || {};
  window.CanamedAdminTools.generateAccreditationReport = generateAccreditationReport;
  window.CanamedAdminTools.competencyRows = competencyRows;     // for tests
  window.generateAccreditationReport = generateAccreditationReport;
})();
