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
