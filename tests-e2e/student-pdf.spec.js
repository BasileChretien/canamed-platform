/* tests-e2e/student-pdf.spec.js
 *
 * Participant-facing PDF downloads (2026-05-27). This PR ships the certificate
 * of attendance: pdfmake is vendored + lazy-loaded (ensurePdfmake), and the
 * generator lives in student-pdf.js (ensureStudentPdf). The docDefinition
 * builder is pure, so we assert its structure without rendering; a chromium-
 * only smoke confirms pdfmake actually produces a non-empty PDF blob.
 *
 * In the mobile testMatch (playwright.config.js) so the wrap-up button +
 * builder are exercised per-device; the heavy 2 MB render smoke is chromium-only.
 */

// @ts-check
const { test, expect } = require("./fixtures.js");

test.describe("Student PDFs — certificate of attendance", () => {
  test("the wrap-up certificate button + pdf loaders are present", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(() => ({
      btn: !!document.getElementById("wrapup-cert-btn"),
      ensurePdfmake: !!(window.CanamedLoader && typeof window.CanamedLoader.ensurePdfmake === "function"),
      ensureStudentPdf: !!(window.CanamedLoader && typeof window.CanamedLoader.ensureStudentPdf === "function")
    }));
    expect(info.btn, "#wrapup-cert-btn must exist at wrap-up").toBe(true);
    expect(info.ensurePdfmake).toBe(true);
    expect(info.ensureStudentPdf).toBe(true);
  });

  test("the certificate docDefinition embeds the name, session + competencies", async ({ page }) => {
    await page.goto("/");
    const doc = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      if (!window.CanamedPdf || !window.CanamedPdf.buildCertificateDocDefinition) return null;
      const d = window.CanamedPdf.buildCertificateDocDefinition({
        name: "Akari Tanaka",
        sessionCode: "ABC-DEF",
        dateStr: "2026-05-27",
        competencies: ["Breaking bad news (SPIKES)", "Shared decision-making"]
      });
      return { json: JSON.stringify(d), orientation: d.pageOrientation };
    });
    expect(doc, "buildCertificateDocDefinition must be exposed").not.toBeNull();
    expect(doc.orientation).toBe("landscape");
    expect(doc.json).toContain("Akari Tanaka");
    expect(doc.json).toContain("ABC-DEF");
    expect(doc.json).toContain("Breaking bad news (SPIKES)");
    expect(doc.json).toContain("Shared decision-making");
    expect(doc.json).toContain("CERTIFICATE OF ATTENDANCE");
  });

  test("pdfmake renders a non-empty PDF blob (chromium smoke)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "2 MB pdfmake render smoke runs on chromium only");
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensurePdfmake();
      await window.CanamedLoader.ensureStudentPdf();
      if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") return { ok: false, why: "no pdfMake" };
      const d = window.CanamedPdf.buildCertificateDocDefinition({ name: "Test Student", competencies: ["A"] });
      return await new Promise((resolve) => {
        try {
          window.pdfMake.createPdf(d).getBlob((blob) => resolve({ ok: true, size: blob.size, type: blob.type }));
        } catch (e) { resolve({ ok: false, why: String(e) }); }
      });
    });
    expect(out.ok, out.why || "").toBe(true);
    expect(out.size).toBeGreaterThan(1000);
    expect(out.type).toContain("pdf");
  });
});

test.describe("Student PDFs — study booklet", () => {
  test("the booklet button is present + builder + collector exposed", async ({ page }) => {
    await page.goto("/");
    const info = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      return {
        btn: !!document.getElementById("wrapup-booklet-btn"),
        builder: !!(window.CanamedPdf && typeof window.CanamedPdf.buildBookletDocDefinition === "function"),
        collector: typeof window._collectBookletSections === "function"
      };
    });
    expect(info.btn, "#wrapup-booklet-btn must exist").toBe(true);
    expect(info.builder).toBe(true);
    expect(info.collector).toBe(true);
  });

  test("the live session reference cards are collected into booklet sections", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(() => {
      const secs = window._collectBookletSections();
      return { n: secs.length, hasTitles: secs.every(s => typeof s.title === "string"),
               hasBlocks: secs.some(s => Array.isArray(s.blocks) && s.blocks.length > 0),
               hasTable: secs.some(s => (s.blocks || []).some(b => b.type === "table")) };
    });
    // Module A + Module B each ship history + guidelines + recap reference cards.
    expect(out.n, "should collect several reference sections").toBeGreaterThanOrEqual(2);
    expect(out.hasBlocks).toBe(true);
    expect(out.hasTable, "recap cards contribute tables").toBe(true);
  });

  test("the booklet docDefinition embeds reference sections + the team comparison", async ({ page }) => {
    await page.goto("/");
    const doc = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const d = window.CanamedPdf.buildBookletDocDefinition({
        name: "Akari", sessionCode: "ABC-DEF",
        sections: [{ title: "Historical context", blocks: [
          { type: "p", text: "Truth-telling norms changed over time." },
          { type: "table", header: true, rows: [["Country", "Norm"], ["France", "autonomy first"]] }
        ] }],
        team: { name: "Room 1", score: 120, wins: ["Reached the clinical synthesis"],
                cohort: [{ label: "Room 1", score: 120, you: true }, { label: "Room 2", score: 90 }] }
      });
      return JSON.stringify(d);
    });
    expect(doc).toContain("Session study booklet");
    expect(doc).toContain("Historical context");
    expect(doc).toContain("Truth-telling norms changed over time.");
    expect(doc).toContain("autonomy first");
    expect(doc).toContain("Your team");
    expect(doc).toContain("your team");                 // the "← your team" marker
    expect(doc).toContain("Reached the clinical synthesis");
  });

  test("the booklet has a clickable table of contents (toc node + tocItem headings)", async ({ page }) => {
    await page.goto("/");
    const doc = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const d = window.CanamedPdf.buildBookletDocDefinition({
        name: "Akari", sessionCode: "ABC-DEF",
        sections: [{ title: "Historical context", blocks: [{ type: "p", text: "x" }] },
                   { title: "Guidelines", blocks: [{ type: "p", text: "y" }] }],
        team: { name: "Room 1", score: 10, wins: [], cohort: [] }
      });
      const content = d.content || [];
      return {
        hasContents: JSON.stringify(content).includes("Contents"),
        tocNodes: content.filter(n => n && n.toc).length,
        tocItems: content.filter(n => n && n.tocItem === true).map(n => n.text)
      };
    });
    expect(doc.hasContents, "a 'Contents' page is present").toBe(true);
    expect(doc.tocNodes, "exactly one pdfmake toc node").toBe(1);
    expect(doc.tocItems).toContain("Historical context");
    expect(doc.tocItems).toContain("Guidelines");
    expect(doc.tocItems).toContain("Your team");
  });

  test("emoji/smileys are stripped from titles, text, lists and tables", async ({ page }) => {
    await page.goto("/");
    const doc = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const d = window.CanamedPdf.buildBookletDocDefinition({
        name: "🙂 Akari",
        sections: [{ title: "📋 Historical context 🇫🇷", blocks: [
          { type: "p", text: "Truth-telling ✅ changed 🎯." },
          { type: "ul", items: ["✓ first point", "🚩 second"] },
          { type: "table", header: true, rows: [["Country 🇯🇵", "Norm"], ["France", "autonomy ⭐"]] }
        ] }],
        team: { name: "Room 1 🏆", score: 1, wins: ["🎉 win"], cohort: [{ label: "Room 1 🇫🇷", score: 1, you: true }] }
      });
      return JSON.stringify(d);
    });
    // Readable text is preserved …
    expect(doc).toContain("Historical context");
    expect(doc).toContain("Truth-telling");
    expect(doc).toContain("autonomy");
    expect(doc).toContain("first point");
    // … but no emoji / pictographs survive (they render as tofu in Roboto).
    const emoji = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    expect(emoji.test(doc), "no emoji should remain in the booklet doc").toBe(false);
  });

  test("pdfmake renders a non-empty booklet PDF with a TOC (chromium smoke)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "2 MB pdfmake render smoke runs on chromium only");
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensurePdfmake();
      await window.CanamedLoader.ensureStudentPdf();
      const d = window.CanamedPdf.buildBookletDocDefinition({
        name: "T 🙂",
        sections: [
          { title: "📋 Section one", blocks: [{ type: "p", text: "x" }] },
          { title: "Section two", blocks: [{ type: "p", text: "y" }] }
        ],
        team: { name: "R1", score: 10, wins: [], cohort: [{ label: "R1", score: 10, you: true }] }
      });
      return await new Promise((resolve) => {
        try { window.pdfMake.createPdf(d).getBlob((b) => resolve({ ok: true, size: b.size, type: b.type })); }
        catch (e) { resolve({ ok: false, why: String(e) }); }
      });
    });
    expect(out.ok, out.why || "").toBe(true);
    expect(out.size).toBeGreaterThan(1000);
    expect(out.type).toContain("pdf");
  });
});
