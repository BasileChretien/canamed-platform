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
    // Session-3 asks: state the language, and carry the director's signature.
    expect(doc.json).toContain("Language of instruction: English");
    expect(doc.json).toContain("Dr. Basile Chr");          // Chrétien (accent-safe match)
  });

  test("the certificate embeds the director's signature (default) and honours an override", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
      const withSig = JSON.stringify(window.CanamedPdf.buildCertificateDocDefinition({ name: "A", signatureDataUrl: px }));
      const dflt = JSON.stringify(window.CanamedPdf.buildCertificateDocDefinition({ name: "A" }));
      return { hasOverride: withSig.includes(px), withSig: withSig, dflt: dflt };
    });
    // An explicit signatureDataUrl overrides the baked-in default.
    expect(out.hasOverride, "a provided signatureDataUrl must be embedded as an image").toBe(true);
    // The default cert now carries the baked-in signature PNG (SIGNATURE_DATAURL).
    expect(out.dflt, "default cert must embed the real signature PNG").toContain("data:image/png;base64,");
    // The signature name appears regardless.
    expect(out.withSig).toContain("Dr. Basile Chr");
    expect(out.dflt).toContain("Dr. Basile Chr");
  });

  test("the certificate carries a verification ID when one is issued (QR hidden 2026-06-16)", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const id = (typeof window.canamedCertId === "function")
        ? window.canamedCertId("ABC-DEF|client-xyz") : "CNM-AAAAA-BBBBB";
      const withId = JSON.stringify(window.CanamedPdf.buildCertificateDocDefinition({ name: "A", certId: id }));
      const noId = JSON.stringify(window.CanamedPdf.buildCertificateDocDefinition({ name: "A" }));
      return { id: id, withId: withId, noId: noId };
    });
    // Issued cert: the id text is present; the QR is hidden (PI request).
    expect(out.withId).toContain(out.id);
    expect(out.withId).toContain("Verification ID");
    expect(out.withId).not.toContain('"qr"');
    // No id supplied → no id line (and still no QR).
    expect(out.noId).not.toContain('"qr"');
    expect(out.noId).not.toContain("Verification ID");
  });

  test("pdfmake renders the certificate (chromium smoke)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "2 MB pdfmake render smoke runs on chromium only");
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensurePdfmake();
      await window.CanamedLoader.ensureStudentPdf();
      const id = window.canamedCertId ? window.canamedCertId("ABC-DEF|client-xyz") : "CNM-AAAAA-BBBBB";
      const d = window.CanamedPdf.buildCertificateDocDefinition({ name: "Test Student", certId: id });
      return await new Promise((resolve) => {
        try { window.pdfMake.createPdf(d).getBlob((b) => resolve({ ok: true, size: b.size, type: b.type })); }
        catch (e) { resolve({ ok: false, why: String(e) }); }
      });
    });
    expect(out.ok, out.why || "").toBe(true);
    expect(out.size).toBeGreaterThan(1000);
    expect(out.type).toContain("pdf");
  });

  test("pdfmake renders the certificate with an embedded signature image (chromium smoke)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "2 MB pdfmake render smoke runs on chromium only");
    await page.goto("/");
    // A real (valid) 120x40 RGBA PNG stands in for the scanned signature, so this
    // exercises pdfmake's image pipeline — not just the docDefinition shape.
    const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAAo0lEQVR4nO3WsQ0CAAhFQYZwEudx/zW0sbaBBIQrrvsFyWuIx/P1/oofbP50M/o4m5rALNZ+AAIjMAIfFZM/QJv8ZvRxNjWBWaz9AARGYAQ+KiZ/gDb5zejjbGoCs1j7AQiMwAh8VEz+AG3ym9HH2dQEZrH2AxAYgRH4qJj8AdrkN6OPs6kJzGLtByAwAiPwUTH5A7TJb0YfZ1MTmMXaD0BgEj6WGiz04w+4+QAAAABJRU5ErkJggg==";
    const out = await page.evaluate(async (sig) => {
      await window.CanamedLoader.ensurePdfmake();
      await window.CanamedLoader.ensureStudentPdf();
      const d = window.CanamedPdf.buildCertificateDocDefinition({ name: "Test Student", signatureDataUrl: sig });
      return await new Promise((resolve) => {
        try { window.pdfMake.createPdf(d).getBlob((b) => resolve({ ok: true, size: b.size, type: b.type })); }
        catch (e) { resolve({ ok: false, why: String(e) }); }
      });
    }, SIG);
    expect(out.ok, out.why || "").toBe(true);
    expect(out.size).toBeGreaterThan(1000);
    expect(out.type).toContain("pdf");
  });

  test("pdfmake renders a non-empty PDF blob (chromium smoke)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "2 MB pdfmake render smoke runs on chromium only");
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensurePdfmake();
      await window.CanamedLoader.ensureStudentPdf();
      if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") return { ok: false, why: "no pdfMake" };
      // Default cert (no signature image yet) → exercises the new design with the
      // signature-line fallback, the gold seal + corner flourishes, and columns.
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
        team: { name: "Room 1", score: 120, wins: ["Committed your working hypotheses"],
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
    expect(doc).toContain("Committed your working hypotheses");
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

test.describe("Student PDFs — localization + clickable links (per-device)", () => {
  test("the certificate localizes (en/fr/ja) and always carries the extra-curricular / no-credit disclaimer", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const B = window.CanamedPdf.buildCertificateDocDefinition;
      return {
        en: JSON.stringify(B({ name: "A", lang: "en" })),
        fr: JSON.stringify(B({ name: "A", lang: "fr" })),
        ja: JSON.stringify(B({ name: "A", lang: "ja" }))
      };
    });
    // Localized title chrome
    expect(out.en).toContain("CERTIFICATE OF ATTENDANCE");
    expect(out.fr).toContain("ATTESTATION DE PARTICIPATION");
    expect(out.ja).toContain("参加証明書");
    // The extra-curricular / no-academic-credit disclaimer in each language
    expect(out.en).toContain("extra-curricular");
    expect(out.en).toContain("does not award any academic credit");
    expect(out.fr).toContain("extra-curriculaire");
    expect(out.fr).toContain("aucun crédit universitaire");
    expect(out.ja).toContain("正課外");
    expect(out.ja).toContain("単位");
  });

  test("the booklet localizes and renders DOIs/links as clickable runs", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      await window.CanamedLoader.ensureStudentPdf();
      const B = window.CanamedPdf.buildBookletDocDefinition;
      const fr = JSON.stringify(B({ name: "A", sessionCode: "S", lang: "fr",
        sections: [{ title: "Refs", blocks: [{ type: "p", text: "voir doi.org/10.1007/s40122-018-0097-6 ici" }] }],
        team: {} }));
      return { fr };
    });
    // Localized booklet chrome + new pages
    expect(out.fr).toContain("Livret d");
    expect(out.fr).toContain("Objectifs d'apprentissage");
    expect(out.fr).toContain("Glossaire");
    expect(out.fr).toContain("Références");
    // A DOI in collected section text becomes a clickable link run, and the
    // curated references include a clickable DOI.
    expect(out.fr).toContain('"link":"https://doi.org/10.1007/s40122-018-0097-6"');
    expect(out.fr).toContain("https://doi.org/10.1634/theoncologist.5-4-302");
  });

  test("the lobby presents certificate verification as an informational note, not an opt-in checkbox", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(() => ({
      hasCheckbox: !!document.querySelector("input#consent-verification"),
      note: (document.querySelector('[data-i18n="lobby.consent-verification"]') || {}).tagName || ""
    }));
    expect(out.hasCheckbox, "the opt-in verification checkbox is removed").toBe(false);
    expect(out.note, "verification copy is now a paragraph note").toBe("P");
  });
});
