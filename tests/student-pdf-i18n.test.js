/* tests/student-pdf-i18n.test.js
 *
 * Localization + booklet improvements (2026-05-30):
 *   - the certificate + study booklet are produced in EN / FR / JA from a pure,
 *     Node-requireable builder (student-pdf.js exposes module.exports);
 *   - the certificate carries an extra-curricular / no-academic-credit
 *     disclaimer in every language;
 *   - DOIs and URLs in the booklet are rendered as clickable pdfmake link runs;
 *   - the booklet gained Learning-objectives, SPIKES, Glossary and References
 *     pages, all localized and in the clickable table of contents.
 *
 * These pin the contract the browser e2e suite also relies on (English
 * defaults) without rendering the 2 MB pdfmake bundle.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const Pdf = require(path.join(P, "student-pdf.js"));

const J = (o) => JSON.stringify(o);

test("student-pdf.js is Node-requireable and exposes the pure builders", () => {
  assert.equal(typeof Pdf.buildCertificateDocDefinition, "function");
  assert.equal(typeof Pdf.buildBookletDocDefinition, "function");
  assert.equal(typeof Pdf._linkify, "function");
});

test("certificate localizes its chrome to data.lang (en/fr/ja)", () => {
  const en = J(Pdf.buildCertificateDocDefinition({ name: "Akari", certId: "CNM-AAAAA-BBBBB" }));
  assert.ok(en.includes("CERTIFICATE OF ATTENDANCE"));
  assert.ok(en.includes("Language of instruction: English"));
  assert.ok(en.includes("Verification ID"));

  const fr = J(Pdf.buildCertificateDocDefinition({ name: "Akari", lang: "fr", certId: "CNM-AAAAA-BBBBB" }));
  assert.ok(fr.includes("ATTESTATION DE PARTICIPATION"));
  assert.ok(fr.includes("Identifiant de vérification"));

  const ja = J(Pdf.buildCertificateDocDefinition({ name: "田中", lang: "ja", certId: "CNM-AAAAA-BBBBB" }));
  assert.ok(ja.includes("参加証明書"));
  assert.ok(ja.includes("検証 ID"));
});

test("certificate states it is extra-curricular and gives no academic credit (all languages)", () => {
  const en = J(Pdf.buildCertificateDocDefinition({ name: "A" }));
  assert.ok(/extra-curricular/i.test(en), "EN disclaimer present");
  assert.ok(en.includes("does not award any academic credit"));
  assert.ok(en.includes("Université de Caen Normandie") && en.includes("Nagoya University"));

  const fr = J(Pdf.buildCertificateDocDefinition({ name: "A", lang: "fr" }));
  assert.ok(fr.includes("extra-curriculaire"));
  assert.ok(fr.includes("aucun crédit universitaire"));

  const ja = J(Pdf.buildCertificateDocDefinition({ name: "A", lang: "ja" }));
  assert.ok(ja.includes("正課外"));
  assert.ok(ja.includes("単位"));
});

test("certificate uses localized default competencies but honours a caller override", () => {
  const dflt = J(Pdf.buildCertificateDocDefinition({ name: "A", lang: "fr" }));
  assert.ok(dflt.includes("Décision médicale partagée") || dflt.includes("décision médicale partagée"));

  const override = J(Pdf.buildCertificateDocDefinition({
    name: "A", competencies: ["Breaking bad news (SPIKES)", "Shared decision-making"]
  }));
  assert.ok(override.includes("Breaking bad news (SPIKES)"));
  assert.ok(override.includes("Shared decision-making"));
});

test("certificate gates the verification id on a supplied certId (QR hidden 2026-06-16)", () => {
  const withId = J(Pdf.buildCertificateDocDefinition({ name: "A", certId: "CNM-AAAAA-BBBBB" }));
  assert.ok(!withId.includes('"qr"'), "the certificate QR is hidden");
  assert.ok(withId.includes("CNM-AAAAA-BBBBB"), "the verification id is printed");
  const noId = J(Pdf.buildCertificateDocDefinition({ name: "A" }));
  assert.ok(!noId.includes('"qr"'));
  assert.ok(!noId.includes("Verification ID"), "no id line when no id supplied");
});

test("_linkify turns DOIs and URLs into clickable runs and leaves plain text a string", () => {
  assert.equal(Pdf._linkify("no links here"), "no links here");

  // bare DOI with parentheses (the canonical Lancet low-back-pain DOI)
  const doi = Pdf._linkify("ref 10.1016/S0140-6736(18)30489-6.");
  const hit = doi.find((r) => r.link);
  assert.equal(hit.link, "https://doi.org/10.1016/S0140-6736(18)30489-6");
  assert.equal(hit.style, "link");
  // the trailing full stop is NOT part of the link
  assert.ok(doi.some((r) => r.text === "." && !r.link));

  // doi.org/… and www.… and full URLs
  assert.equal(Pdf._linkify("doi.org/10.1634/x")[0].link, "https://doi.org/10.1634/x");
  assert.equal(Pdf._linkify("www.nice.org.uk/ng59")[0].link, "https://www.nice.org.uk/ng59");
  assert.equal(Pdf._linkify("https://has-sante.fr/p")[0].link, "https://has-sante.fr/p");
});

test("booklet keeps the English defaults the e2e suite relies on", () => {
  const d = Pdf.buildBookletDocDefinition({ name: "Akari", sessionCode: "ABC-DEF",
    sections: [{ title: "Historical context", blocks: [{ type: "p", text: "x" }] }],
    team: { name: "Room 1", score: 10, wins: [], cohort: [{ label: "Room 1", score: 10, you: true }] } });
  const s = J(d);
  assert.ok(s.includes("Session study booklet"));
  assert.ok(s.includes("Contents"));
  assert.ok(s.includes("Your team"));
  assert.ok(s.includes("your team"));            // the "← your team" marker
  // exactly one pdfmake toc node
  assert.equal(d.content.filter((n) => n && n.toc).length, 1);
});

test("booklet adds localized Objectives / SPIKES / Glossary / References pages in the TOC", () => {
  const tocItems = (lang) => {
    const d = Pdf.buildBookletDocDefinition({ name: "A", sessionCode: "S", lang,
      sections: [{ title: "Guidelines", blocks: [{ type: "p", text: "y" }] }],
      team: { name: "R1", score: 1, wins: [], cohort: [] } });
    return d.content.filter((n) => n && n.tocItem === true).map((n) => n.text);
  };
  const en = tocItems("en");
  assert.ok(en.includes("Learning objectives"));
  assert.ok(en.includes("Glossary"));
  assert.ok(en.includes("References & further reading"));
  assert.ok(en.includes("Guidelines"));
  assert.ok(en.includes("Your team"));

  assert.ok(tocItems("fr").includes("Objectifs d'apprentissage"));
  assert.ok(tocItems("ja").includes("用語集"));
});

test("booklet references render DOIs/links as clickable runs", () => {
  const s = J(Pdf.buildBookletDocDefinition({ name: "A", sessionCode: "S",
    sections: [], team: {} }));
  assert.ok(s.includes("https://doi.org/10.1634/theoncologist.5-4-302"));
  assert.ok(s.includes('"style":"link"'));
});

test("booklet linkifies DOIs/URLs that appear in collected DOM section text", () => {
  const d = Pdf.buildBookletDocDefinition({ name: "A", sessionCode: "S",
    sections: [{ title: "Refs", blocks: [
      { type: "p", text: "See doi.org/10.1007/s40122-018-0097-6 for the review." },
      { type: "ul", items: ["guideline at https://www.nice.org.uk/guidance/ng59"] }
    ] }],
    team: {} });
  const s = J(d);
  assert.ok(s.includes('"link":"https://doi.org/10.1007/s40122-018-0097-6"'));
  assert.ok(s.includes('"link":"https://www.nice.org.uk/guidance/ng59"'));
});

test("booklet strips emoji from all surfaces (Roboto has no emoji glyphs)", () => {
  const s = J(Pdf.buildBookletDocDefinition({ name: "🙂 Akari", lang: "fr",
    sections: [{ title: "📋 Historical 🇫🇷", blocks: [
      { type: "p", text: "Truth ✅ changed 🎯." },
      { type: "table", header: true, rows: [["Country 🇯🇵", "Norm"], ["France", "autonomy ⭐"]] }
    ] }],
    team: { name: "Room 1 🏆", score: 1, wins: ["🎉 win"], cohort: [{ label: "Room 1 🇫🇷", score: 1, you: true }] } }));
  const emoji = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  assert.ok(!emoji.test(s), "no emoji should survive in the booklet doc");
  assert.ok(s.includes("Historical"));
  assert.ok(s.includes("autonomy"));
});
