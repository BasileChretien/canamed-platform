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

  /* Strip emoji / pictographs from text destined for the PDF. pdfmake's bundled
   * font is Roboto, which has no colour-emoji glyphs, so a 📋 / ✓ / 🇫🇷 in a card
   * heading or recap cell renders as an empty "tofu" box. The live cards use
   * these decoratively; the booklet reads cleaner without them. Keeps ordinary
   * punctuation, accents and dashes (— …) untouched. */
  function _deEmoji(v) {
    if (v == null) return "";
    return String(v)
      .replace(/[\u{1F000}-\u{1FAFF}]/gu, "")   // emoji & pictographs (📋 🎯 🗳️ …)
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")   // regional-indicator flags (🇫🇷 🇯🇵)
      .replace(/[\u{2600}-\u{27BF}]/gu, "")     // misc symbols + dingbats (✓ ✗ ☀ ✏)
      .replace(/[\u{2B00}-\u{2BFF}]/gu, "")      // misc symbols & arrows (⭐ ⬆)
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, "") // variation selectors + ZWJ
      .replace(/\s{2,}/g, " ")
      .trim();
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

  /* ---- Study booklet -------------------------------------------------------
   * A designed, multi-page A4 booklet the student can keep to revise from:
   * a cover, the session's reference sections (historical context, guidelines,
   * recap tables — passed in as structured `sections` so this builder stays
   * pure + scenario-agnostic), then a "Your team" page with the team's points,
   * what they did well, and a reflection-only comparison with the other rooms.
   * `sections` block shape: { type:"p"|"sub"|"ul"|"table", text?, items?, rows?, header? }
   */
  function _sectionBlocks(blocks) {
    var out = [];
    (blocks || []).forEach(function (b) {
      if (!b) return;
      if (b.type === "p" && b.text) out.push({ text: _deEmoji(b.text), style: "para" });
      else if (b.type === "sub" && b.text) out.push({ text: _deEmoji(b.text), style: "h3" });
      else if (b.type === "ul" && Array.isArray(b.items) && b.items.length) {
        out.push({ ul: b.items.map(_deEmoji).filter(Boolean), style: "list" });
      } else if (b.type === "table" && Array.isArray(b.rows) && b.rows.length) {
        var body = b.rows.map(function (row) { return row.map(_deEmoji); });
        out.push({
          table: { headerRows: b.header ? 1 : 0, widths: b.rows[0].map(function () { return "*"; }), body: body },
          layout: "lightHorizontalLines", style: "table", margin: [0, 4, 0, 12]
        });
      }
    });
    return out;
  }

  function buildBookletDocDefinition(data) {
    data = data || {};
    var name = _str(data.name, "");
    var dateStr = _str(data.dateStr, new Date().toLocaleDateString());
    var partnership = _str(data.partnership, "Université de Caen Normandie × Nagoya University");
    var sessionCode = _str(data.sessionCode, "—");
    var sections = Array.isArray(data.sections) ? data.sections : [];
    var team = data.team || {};
    var content = [];

    // Cover
    content.push({ text: "CaNaMED", style: "coverBrand", margin: [0, 120, 0, 0] });
    content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 3, lineColor: BRAND.gold }], alignment: "center", margin: [0, 8, 0, 0] });
    content.push({ text: "Session study booklet", style: "coverTitle" });
    content.push({ text: partnership, style: "coverSub" });
    if (name) content.push({ text: "Prepared for " + _deEmoji(name), style: "coverName", margin: [0, 28, 0, 0] });
    content.push({ text: "Session " + sessionCode + "  ·  " + dateStr, style: "coverMeta" });
    content.push({ text: "Keep this to revise from — the historical background, the guideline standards, and a quick recap of each module.", style: "coverBlurb", margin: [60, 40, 60, 0] });

    // Clickable table of contents on its own page. Each heading below opts in
    // with tocItem:true, so pdfmake generates the entries + page numbers and
    // links each one to its heading (clickable in any PDF viewer).
    content.push({ text: "Contents", style: "tocTitle", pageBreak: "before" });
    content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 2.5, lineColor: BRAND.gold }], margin: [0, 6, 0, 16] });
    content.push({ toc: { textStyle: "tocEntry", numberStyle: "tocPage" } });

    // A small accent rule under a section heading, for a cleaner look.
    function headingRule() {
      return { canvas: [{ type: "line", x1: 0, y1: 0, x2: 64, y2: 0, lineWidth: 2, lineColor: BRAND.accent }], margin: [0, 0, 0, 10] };
    }

    // Reference sections (from the live session cards). Each starts a fresh page
    // so the TOC stands alone and sections don't run together.
    sections.forEach(function (sec, i) {
      content.push({ text: _deEmoji(sec.title) || ("Section " + (i + 1)), style: "h1", tocItem: true, tocStyle: "tocEntry", pageBreak: "before" });
      content.push(headingRule());
      _sectionBlocks(sec.blocks).forEach(function (blk) { content.push(blk); });
    });

    // Your team
    content.push({ text: "Your team", style: "h1", tocItem: true, tocStyle: "tocEntry", pageBreak: "before" });
    content.push(headingRule());
    if (team.name) content.push({ text: _deEmoji(team.name), style: "teamName" });
    if (typeof team.score === "number") content.push({ text: team.score + " points earned today", style: "teamScore" });
    if (Array.isArray(team.wins) && team.wins.length) {
      content.push({ text: "What your team did well", style: "h2" });
      content.push({ ul: team.wins.map(_deEmoji).filter(Boolean), style: "list" });
    }
    if (Array.isArray(team.cohort) && team.cohort.length) {
      content.push({ text: "How the room compares", style: "h2" });
      var max = team.cohort.reduce(function (m, r) { return Math.max(m, r.score || 0); }, 1);
      var rows = team.cohort.map(function (r) {
        var w = Math.max(2, Math.round(((r.score || 0) / max) * 150));
        return [
          { text: _deEmoji(r.label || "") + (r.you ? "  ← your team" : ""), bold: !!r.you, color: r.you ? BRAND.accent : BRAND.ink },
          { text: String(r.score || 0), alignment: "right" },
          { canvas: [{ type: "rect", x: 0, y: 3, w: w, h: 9, r: 2, color: r.you ? BRAND.accent : BRAND.line }] }
        ];
      });
      content.push({ table: { widths: ["*", "auto", 160], body: rows }, layout: "noBorders", margin: [0, 4, 0, 0] });
      content.push({ text: "Every team's points add to the shared cohort goal — this comparison is for reflection, not ranking.", style: "note", margin: [0, 10, 0, 0] });
    }

    return {
      pageSize: "A4",
      pageMargins: [54, 60, 54, 56],
      info: { title: "CaNaMED — Study booklet", author: "CaNaMED" },
      defaultStyle: { font: "Roboto", color: BRAND.ink, fontSize: 11, lineHeight: 1.3 },
      footer: function (currentPage, pageCount) {
        return { text: "CaNaMED study booklet  ·  " + currentPage + " / " + pageCount, style: "pageFoot" };
      },
      content: content,
      styles: {
        coverBrand:  { fontSize: 40, bold: true, color: BRAND.ink, alignment: "center" },
        coverTitle:  { fontSize: 20, color: BRAND.accent, alignment: "center", margin: [0, 16, 0, 0] },
        coverSub:    { fontSize: 12, color: BRAND.muted, alignment: "center", margin: [0, 8, 0, 0] },
        coverName:   { fontSize: 14, bold: true, alignment: "center" },
        coverMeta:   { fontSize: 11, color: BRAND.muted, alignment: "center", margin: [0, 4, 0, 0] },
        coverBlurb:  { fontSize: 11, color: BRAND.muted, alignment: "center", italics: true },
        tocTitle:    { fontSize: 24, bold: true, color: BRAND.ink, margin: [0, 0, 0, 0] },
        tocEntry:    { fontSize: 12.5, color: BRAND.ink, margin: [0, 5, 0, 5] },
        tocPage:     { fontSize: 12.5, color: BRAND.muted },
        h1:          { fontSize: 18, bold: true, color: BRAND.ink, margin: [0, 6, 0, 8] },
        h2:          { fontSize: 14, bold: true, color: BRAND.accent, margin: [0, 14, 0, 6] },
        h3:          { fontSize: 12, bold: true, color: BRAND.ink, margin: [0, 8, 0, 4] },
        para:        { fontSize: 11, margin: [0, 0, 0, 8], lineHeight: 1.35 },
        list:        { fontSize: 11, margin: [0, 0, 0, 8], lineHeight: 1.3 },
        table:       { fontSize: 10 },
        teamName:    { fontSize: 16, bold: true, color: BRAND.accent },
        teamScore:   { fontSize: 12, color: BRAND.muted, margin: [0, 2, 0, 0] },
        note:        { fontSize: 9.5, color: BRAND.muted, italics: true },
        pageFoot:    { fontSize: 8, color: BRAND.muted, alignment: "center", margin: [0, 16, 0, 0] }
      }
    };
  }

  function booklet(data) {
    if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") return false;
    window.pdfMake.createPdf(buildBookletDocDefinition(data)).download("CaNaMED_study-booklet.pdf");
    return true;
  }

  window.CanamedPdf = window.CanamedPdf || {};
  window.CanamedPdf.buildCertificateDocDefinition = buildCertificateDocDefinition;
  window.CanamedPdf.certificate = certificate;
  window.CanamedPdf.buildBookletDocDefinition = buildBookletDocDefinition;
  window.CanamedPdf.booklet = booklet;
})();
