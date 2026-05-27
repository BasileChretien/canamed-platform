/* student-pdf.js — participant-facing client-side PDF generation (lazy chunk).
 *
 * Loaded on demand at wrap-up (script-loader.ensureStudentPdf), AFTER pdfmake
 * (script-loader.ensurePdfmake → window.pdfMake + its vfs fonts). Classic
 * script: shares the global scope, but it takes all its inputs as a plain
 * `data` object passed by the caller so it has no hidden coupling to script.js
 * state and the docDefinition builders stay pure + unit-testable.
 *
 * Exposes window.CanamedPdf:
 *   buildCertificateDocDefinition(data) → pdfmake docDefinition (pure)
 *   certificate(data)                   → triggers a browser download
 * (The study-booklet builder is added by a later PR.)
 */
(function () {
  "use strict";

  var BRAND = { ink: "#16335c", accent: "#2563eb", muted: "#5b6b7b", gold: "#e7b800", line: "#c9bd9c" };

  function _str(v, fallback) {
    return (v != null && String(v).trim()) ? String(v).trim() : (fallback || "");
  }

  /* A4 landscape certificate of attendance. Pure: returns the pdfmake doc. */
  function buildCertificateDocDefinition(data) {
    data = data || {};
    var name = _str(data.name, "Participant");
    var dateStr = _str(data.dateStr, new Date().toLocaleDateString());
    var partnership = _str(data.partnership, "Université de Caen Normandie × Nagoya University");
    var sessionLabel = _str(data.sessionLabel, "");
    var sessionCode = _str(data.sessionCode, "—");
    var comps = Array.isArray(data.competencies) ? data.competencies.filter(Boolean) : [];

    var did = "attended the CaNaMED Franco-Japanese medical-education workshop"
      + (sessionLabel ? " — " + sessionLabel : "")
      + " on " + dateStr + ", taking part in structured clinical reasoning and a "
      + "breaking-bad-news roleplay, and practising:";

    return {
      pageSize: "A4",
      pageOrientation: "landscape",
      pageMargins: [64, 70, 64, 56],
      info: { title: "CaNaMED — Certificate of Attendance", author: "CaNaMED" },
      defaultStyle: { font: "Roboto", color: BRAND.ink, fontSize: 12 },
      // Decorative double border + a gold accent rule under the wordmark.
      background: function (currentPage, pageSize) {
        return {
          canvas: [
            { type: "rect", x: 22, y: 22, w: pageSize.width - 44, h: pageSize.height - 44,
              lineWidth: 2, lineColor: BRAND.ink },
            { type: "rect", x: 30, y: 30, w: pageSize.width - 60, h: pageSize.height - 60,
              lineWidth: 0.75, lineColor: BRAND.line }
          ]
        };
      },
      content: [
        { text: "CERTIFICATE OF ATTENDANCE", style: "kicker" },
        { text: "CaNaMED", style: "brand" },
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 2.5, lineColor: BRAND.gold }],
          alignment: "center", margin: [0, 6, 0, 0] },
        { text: partnership, style: "subtitle" },
        { text: "This certifies that", style: "line", margin: [0, 26, 0, 2] },
        { text: name, style: "name" },
        { text: did, style: "line", margin: [70, 10, 70, 6], alignment: "center" },
        comps.length
          ? { ul: comps, style: "comps", margin: [0, 0, 0, 0] }
          : { text: "" },
        { text: "Issued " + dateStr + "  ·  Session " + sessionCode, style: "foot", margin: [0, 30, 0, 0] }
      ],
      styles: {
        kicker:   { fontSize: 11, characterSpacing: 3, color: BRAND.muted, alignment: "center", bold: true },
        brand:    { fontSize: 34, bold: true, color: BRAND.ink, alignment: "center", margin: [0, 4, 0, 0] },
        subtitle: { fontSize: 12, color: BRAND.muted, alignment: "center", margin: [0, 6, 0, 0] },
        line:     { fontSize: 12, alignment: "center", lineHeight: 1.3 },
        name:     { fontSize: 26, bold: true, color: BRAND.accent, alignment: "center", margin: [0, 4, 0, 4] },
        comps:    { fontSize: 12, color: BRAND.ink },
        foot:     { fontSize: 10, color: BRAND.muted, alignment: "center" }
      }
    };
  }

  function _safe(s) { return String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, ""); }

  function certificate(data) {
    if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") return false;
    var fname = "CaNaMED_certificate"
      + (data && data.name ? "_" + _safe(data.name) : "") + ".pdf";
    window.pdfMake.createPdf(buildCertificateDocDefinition(data)).download(fname);
    return true;
  }

  window.CanamedPdf = window.CanamedPdf || {};
  window.CanamedPdf.buildCertificateDocDefinition = buildCertificateDocDefinition;
  window.CanamedPdf.certificate = certificate;
})();
