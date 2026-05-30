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

  /* The workshop director's signature, as a base64 PNG data URL (transparent
   * background, ~600×200). Empty by default — drop the scan in here (or pass
   * data.signatureDataUrl) and the certificate renders the real signature above
   * the name; until then it falls back to a blank signature line. */
  var SIGNATURE_DATAURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMcAAABZCAYAAACKaTD1AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAACEJSURBVHhe7d11qyxH1wXw93PlIySEkD8SCEkgStw9N+7u7u7u7u7u7u5u/fIrWJd6mpl7Ro9NLyi6p6e81t61966ec/6v6dChQ090wtGhQx90wtED//77b0n//fdfSX///Xfz119/lWc//fRTuf/999+bP//8s/n444+bTz75pPn+++9LXs/++OOPkuRLHUkdlg464agQoZAQ+5dffimCAa6fffZZ8/zzzzcXX3xxc/TRRzdnn312c9111zWXX355c8UVVzQ33HBD8+ijjzZffvll89tvvzX//PNPJxxLGJ1wVEBmggGE4auvvmqeeeaZ5pprrimCcM455zS33HJL2SkQ3S5BCD7//PPm1VdfbR577LHmqquuas4888zmiCOOaD766KNOOJYwOuFogTn00ksvFYIfd9xxza233to8++yzRQCYVITBVT4CZHeJiWW3+eGHH8r1ww8/bE444YROOJYwZko4kFayOyCqe8S2Y/AZbr/99uaCCy4o2v/tt99euYsMg5hk6nzxxRebyy67bKXwSB0GQ1uptNN8YKaEA2ElZI3m//XXX4vZtGLFiuaOO+5oPv300/I9go8CC5ey2rID/fjjj+WzXafDYGgLQzvNB2ZKOGj1ONj8ibvuuqs41rfddlshdCJMYAGQexTYIbSj/CmnnNJ888035fOoAjeLaAtDO80HZm7nsFPwIy666KLmueeeK58Jzc8//1y+d++Z+1EWwe6gnHpc7Rzq+vbbb4t/0mEwRAj6pfnAshKO7ApgApGStqbJkf/xxx8vQiEC5btp+AAJ4ar766+/LtEt0A8CM4sIobObZhd1DdHt2nVKmaSFwLISjkysibcISc4ehGKffvrpEk3yDImnQVYLaecBZyDOPLSnLX2bBZiD7JyQdQjcR2mZKz6Za50iFEkLgWW3c2RRXBHzyiuvLGZUwrARHpjGpGtD/SJV2TUihGl3uSPzTwisSdZFoEPAw2Gq9SAEBMS8RAj6pYXAshKOTCRNdP/99xehYOtbGELhKlkQCzYNs8pCExAhXK+WIAQgykIt8kLBXNipHYaaC6atkHl8L/ORdcjaJGUt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";

  function _str(v, fallback) {
    return (v != null && String(v).trim()) ? String(v).trim() : (fallback || "");
  }

  /* A small vector gold seal/rosette (concentric rings + an 8-point burst),
   * drawn with pdfmake canvas so it needs no image or font. Centred at (cx,cy). */
  function _seal(cx, cy) {
    var burst = [];
    for (var i = 0; i < 8; i++) {
      var a = (Math.PI / 4) * i;
      burst.push({ type: "line",
        x1: cx + Math.cos(a) * 9, y1: cy + Math.sin(a) * 9,
        x2: cx + Math.cos(a) * 19, y2: cy + Math.sin(a) * 19,
        lineWidth: 1.4, lineColor: BRAND.gold });
    }
    return [
      { type: "ellipse", x: cx, y: cy, r1: 27, r2: 27, lineWidth: 1.2, lineColor: BRAND.gold },
      { type: "ellipse", x: cx, y: cy, r1: 21, r2: 21, lineWidth: 0.8, lineColor: BRAND.gold },
      { type: "ellipse", x: cx, y: cy, r1: 6, r2: 6, color: BRAND.gold }
    ].concat(burst);
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

  /* ---- Localization (EN / FR / JA) ----------------------------------------
   * The certificate and the study booklet draw every fixed label, the
   * competencies/learning-objectives, the SPIKES framework, the glossary and
   * the references from this table, keyed by data.lang (default "en"). Keeping
   * it INSIDE the pure builder means student-pdf.js has no window.t dependency
   * — it stays side-effect-free and unit-testable by passing { lang }.
   * References are language-neutral citations (DOIs/URLs); only their heading
   * is translated. NB: keep this content emoji-free — pdfmake's Roboto renders
   * emoji as tofu, and the e2e suite asserts none survive. */
  var STR = {
    en: {
      certKicker: "CERTIFICATE OF ATTENDANCE",
      certCertifies: "This certifies that",
      certDid: function (label, dateStr) {
        return "attended the CaNaMED Franco-Japanese medical-education workshop"
          + (label ? " — " + label : "")
          + " on " + dateStr + ", taking part in structured clinical reasoning and a "
          + "breaking-bad-news roleplay, and practising:";
      },
      certLang: "Language of instruction: English",
      certDisclaimer: "This is an extra-curricular activity. It does not award any academic credit (ECTS or other) at Université de Caen Normandie or Nagoya University, and is not part of either university's official curriculum.",
      certVerifyId: "Verification ID",
      certIssued: "Issued ",
      certSession: "Session ",
      certVerifyOnline: "Verify online — scan the QR",
      sigTitle: "On behalf of the CaNaMED team",
      competencies: [
        "Information gathering & shared decision-making",
        "Hypothesis-driven clinical reasoning",
        "Responsible, evidence-based prescribing",
        "Empathic response & acknowledging emotion (SPIKES)",
        "Breaking bad news with a clear plan",
        "Respecting patient autonomy across cultures"
      ],
      bookletTitle: "Session study booklet",
      bookletBlurb: "Keep this to revise from — the historical background, the guideline standards, and a quick recap of each module.",
      preparedFor: function (name) { return "Prepared for " + name; },
      contents: "Contents",
      objectivesTitle: "Learning objectives",
      objectivesIntro: "By the end of this session you will have practised:",
      frameworkTitle: "Key framework — SPIKES",
      frameworkIntro: "A six-step guide for breaking bad news (Baile et al., 2000):",
      glossaryTitle: "Glossary",
      glossaryIntro: "Plain-language definitions of the key terms in this session.",
      referencesTitle: "References & further reading",
      referencesIntro: "The DOIs and links below are clickable.",
      yourTeam: "Your team",
      pointsEarned: function (n) { return n + " points earned today"; },
      didWell: "What your team did well",
      howCompares: "How the room compares",
      yourTeamMarker: "  ← your team",
      cohortNote: "Every team's points add to the shared cohort goal — this comparison is for reflection, not ranking.",
      pageFoot: "CaNaMED study booklet",
      spikes: [
        ["S", "Setting", "Set up the conversation: privacy, sit down, no interruptions, ask who should be present."],
        ["P", "Perception", "Find out what the patient already knows and believes about their situation."],
        ["I", "Invitation", "Ask how much they want to know before you tell them."],
        ["K", "Knowledge", "Give a warning shot, then the news in small, plain pieces — avoid jargon."],
        ["E", "Emotions", "Name and acknowledge the emotion; allow silence; respond with empathy."],
        ["S", "Strategy & summary", "Agree the next step together; make clear you will not abandon them."]
      ],
      glossary: [
        ["Opioid", "Morphine-family painkiller; effective but carries a dependence risk."],
        ["NSAID", "Non-steroidal anti-inflammatory drug (e.g. ibuprofen, naproxen)."],
        ["Cauda equina syndrome", "Compression of the lower spinal nerves — a surgical emergency."],
        ["Red flag", "A warning sign suggesting serious underlying disease."],
        ["Differential diagnosis", "The list of possible diagnoses to consider and rule out."],
        ["Neuropathic pain", "Nerve-origin pain — burning, electric or pins-and-needles."],
        ["Shared decision-making", "Clinician and patient decide together, weighing the evidence and the patient's values."],
        ["Patient autonomy", "The patient's right to make informed decisions about their own care."]
      ]
    },
    fr: {
      certKicker: "ATTESTATION DE PARTICIPATION",
      certCertifies: "Le présent document atteste que",
      certDid: function (label, dateStr) {
        return "a participé à l'atelier franco-japonais d'éducation médicale CaNaMED"
          + (label ? " — " + label : "")
          + " le " + dateStr + ", prenant part à un raisonnement clinique structuré et à un "
          + "jeu de rôle d'annonce d'une mauvaise nouvelle, et a mis en pratique :";
      },
      certLang: "Langue d'enseignement : anglais",
      certDisclaimer: "Activité extra-curriculaire. Elle ne confère aucun crédit universitaire (ECTS ou autre) à l'Université de Caen Normandie ni à l'Université de Nagoya, et ne fait pas partie du cursus officiel de l'une ou l'autre université.",
      certVerifyId: "Identifiant de vérification",
      certIssued: "Délivré le ",
      certSession: "Session ",
      certVerifyOnline: "Vérifiable en ligne — scannez le QR",
      sigTitle: "Au nom de l'équipe CaNaMED",
      competencies: [
        "Recueil d'informations et décision médicale partagée",
        "Raisonnement clinique guidé par les hypothèses",
        "Prescription responsable et fondée sur les preuves",
        "Réponse empathique et reconnaissance des émotions (SPIKES)",
        "Annonce d'une mauvaise nouvelle avec un plan clair",
        "Respect de l'autonomie du patient à travers les cultures"
      ],
      bookletTitle: "Livret d'étude de la session",
      bookletBlurb: "À conserver pour réviser — le contexte historique, les recommandations de référence et un récapitulatif de chaque module.",
      preparedFor: function (name) { return "Préparé pour " + name; },
      contents: "Sommaire",
      objectivesTitle: "Objectifs d'apprentissage",
      objectivesIntro: "À l'issue de cette session, vous aurez mis en pratique :",
      frameworkTitle: "Cadre clé — SPIKES",
      frameworkIntro: "Un guide en six étapes pour annoncer une mauvaise nouvelle (Baile et al., 2000) :",
      glossaryTitle: "Glossaire",
      glossaryIntro: "Définitions en langage clair des termes clés de cette session.",
      referencesTitle: "Références et pour aller plus loin",
      referencesIntro: "Les DOI et les liens ci-dessous sont cliquables.",
      yourTeam: "Votre équipe",
      pointsEarned: function (n) { return n + " points obtenus aujourd'hui"; },
      didWell: "Ce que votre équipe a bien réussi",
      howCompares: "Comparaison entre les salles",
      yourTeamMarker: "  ← votre équipe",
      cohortNote: "Les points de chaque équipe contribuent à l'objectif commun de la cohorte — cette comparaison sert à la réflexion, pas au classement.",
      pageFoot: "Livret d'étude CaNaMED",
      spikes: [
        ["S", "Cadre (Setting)", "Préparez l'entretien : intimité, asseyez-vous, pas d'interruptions, demandez qui doit être présent."],
        ["P", "Perception", "Découvrez ce que le patient sait et croit déjà de sa situation."],
        ["I", "Invitation", "Demandez-lui ce qu'il souhaite savoir avant de l'informer."],
        ["K", "Connaissances (Knowledge)", "Annoncez un signal d'alerte, puis la nouvelle par petites étapes simples — sans jargon."],
        ["E", "Émotions", "Nommez et reconnaissez l'émotion ; laissez le silence ; répondez avec empathie."],
        ["S", "Stratégie et synthèse", "Convenez ensemble de l'étape suivante ; montrez que vous ne l'abandonnerez pas."]
      ],
      glossary: [
        ["Opioïde", "Antalgique de la famille de la morphine ; efficace mais à risque de dépendance."],
        ["AINS", "Anti-inflammatoire non stéroïdien (p. ex. ibuprofène, naproxène)."],
        ["Syndrome de la queue de cheval", "Compression des nerfs spinaux inférieurs — urgence chirurgicale."],
        ["Signe d'alerte (red flag)", "Signe évoquant une maladie sous-jacente grave."],
        ["Diagnostic différentiel", "Liste des diagnostics possibles à envisager et à écarter."],
        ["Douleur neuropathique", "Douleur d'origine nerveuse — brûlure, décharge électrique ou fourmillements."],
        ["Décision médicale partagée", "Le médecin et le patient décident ensemble, en pesant les preuves et les valeurs du patient."],
        ["Autonomie du patient", "Droit du patient de prendre des décisions éclairées concernant ses soins."]
      ]
    },
    ja: {
      certKicker: "参加証明書",
      certCertifies: "本証明書は、",
      certDid: function (label, dateStr) {
        return "氏が、CaNaMED 日仏医学教育ワークショップ" + (label ? "（" + label + "）" : "")
          + "に " + dateStr + " に参加し、構造化された臨床推論および悪い知らせを伝えるロールプレイに取り組み、"
          + "以下の能力を実践したことを証明します：";
      },
      certLang: "使用言語：英語",
      certDisclaimer: "本活動は正課外（課外）活動です。カン・ノルマンディー大学および名古屋大学のいずれにおいても単位（ECTS 等）は付与されず、両大学の正式なカリキュラムには含まれません。",
      certVerifyId: "検証 ID",
      certIssued: "発行日：",
      certSession: "セッション ",
      certVerifyOnline: "オンラインで検証可能 — QR をスキャン",
      sigTitle: "CaNaMED チームを代表して",
      competencies: [
        "情報収集と共同意思決定（shared decision-making）",
        "仮説に基づく臨床推論",
        "責任ある、根拠に基づく処方",
        "共感的な対応と感情の受けとめ（SPIKES）",
        "明確な方針を伴う悪い知らせの伝え方",
        "文化を超えた患者の自律性の尊重"
      ],
      bookletTitle: "セッション学習ブックレット",
      bookletBlurb: "復習用に保存してください — 歴史的背景、ガイドラインの基準、各モジュールの要点をまとめています。",
      preparedFor: function (name) { return name + " さんへ"; },
      contents: "目次",
      objectivesTitle: "学習目標",
      objectivesIntro: "本セッションの終わりまでに、次のことを実践します：",
      frameworkTitle: "重要なフレームワーク — SPIKES",
      frameworkIntro: "悪い知らせを伝えるための 6 ステップの指針（Baile ほか、2000）：",
      glossaryTitle: "用語集",
      glossaryIntro: "本セッションに登場する重要用語の平易な解説です。",
      referencesTitle: "参考文献・さらに学ぶために",
      referencesIntro: "以下の DOI・リンクはクリックできます。",
      yourTeam: "あなたのチーム",
      pointsEarned: function (n) { return "本日獲得した " + n + " ポイント"; },
      didWell: "あなたのチームがうまくできたこと",
      howCompares: "各ルームの比較",
      yourTeamMarker: "  ← あなたのチーム",
      cohortNote: "各チームのポイントは共通のコホート目標に加算されます — この比較は振り返りのためであり、順位付けではありません。",
      pageFoot: "CaNaMED 学習ブックレット",
      spikes: [
        ["S", "場の設定（Setting）", "面談の準備：プライバシー、着席、中断のない環境、同席者の確認。"],
        ["P", "認識（Perception）", "患者が自分の状況について既に何を知り、どう考えているかを把握する。"],
        ["I", "意向の確認（Invitation）", "伝える前に、どこまで知りたいかを尋ねる。"],
        ["K", "情報提供（Knowledge）", "予告（warning shot）をしてから、専門用語を避け、小さく分けて伝える。"],
        ["E", "感情への対応（Emotions）", "感情に名前をつけて受けとめ、沈黙を許し、共感をもって応じる。"],
        ["S", "方針と要約（Strategy）", "次の一歩を一緒に決め、見捨てないことを明確に伝える。"]
      ],
      glossary: [
        ["オピオイド", "モルヒネ系の鎮痛薬。効果はあるが依存のリスクがある。"],
        ["NSAID（非ステロイド性抗炎症薬）", "イブプロフェンやナプロキセンなどの抗炎症薬。"],
        ["馬尾症候群", "下位脊髄神経の圧迫。外科的緊急症。"],
        ["レッドフラッグ（警告徴候）", "重篤な原疾患を示唆する徴候。"],
        ["鑑別診断", "考慮し、除外すべき可能性のある診断のリスト。"],
        ["神経障害性疼痛", "神経由来の痛み。灼熱感・電撃痛・ピリピリ感。"],
        ["共同意思決定", "医師と患者が、根拠と患者の価値観を踏まえて共に意思決定すること。"],
        ["患者の自律性", "自らの医療について十分な情報を得て決定する患者の権利。"]
      ]
    }
  };

  // Language-neutral references (DOIs / URLs are clickable in the PDF; the
  // section heading + intro come from STR). Sourced from the in-session
  // reference cards, so they are the same authorities the students already saw.
  var REFERENCES = [
    ["Baile WF et al. SPIKES — a six-step protocol for delivering bad news. The Oncologist, 2000.",
     "https://doi.org/10.1634/theoncologist.5-4-302"],
    ["Foster NE et al. Prevention and treatment of low back pain. The Lancet, 2018.",
     "https://doi.org/10.1016/S0140-6736(18)30489-6"],
    ["Chronic low back pain — non-opioid management. Pain and Therapy, 2018.",
     "https://doi.org/10.1007/s40122-018-0097-6"],
    ["CDC Clinical Practice Guideline for Prescribing Opioids for Pain, 2022.",
     "https://www.cdc.gov/mmwr/volumes/71/rr/rr7103a1.htm"],
    ["HAS — Prise en charge du patient présentant une lombalgie commune.",
     "https://www.has-sante.fr/jcms/c_2961499/fr/prise-en-charge-du-patient-presentant-une-lombalgie-commune"],
    ["Loi Kouchner (2002) — droits des malades et information du patient (France).",
     "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000227015"],
    ["HAS — Annoncer une mauvaise nouvelle.",
     "https://www.has-sante.fr/jcms/c_698028/fr/annoncer-une-mauvaise-nouvelle"]
  ];

  function _L(data) {
    var lang = data && typeof data.lang === "string" ? data.lang.slice(0, 2).toLowerCase() : "en";
    return STR[lang] || STR.en;
  }

  /* URL / DOI auto-linker. Returns a plain string when there's nothing to link
   * (so callers can use it as a text value directly), or an array of pdfmake
   * text runs where each recognised link becomes a clickable { text, link }
   * run (style "link"). Recognises full URLs, bare www.*, doi.org/* and bare
   * DOIs (10.xxxx/...). Trailing sentence punctuation is kept as plain text. */
  // Allow parentheses inside the token (DOIs such as 10.1016/S0140-6736(18)30489-6
  // contain them); _trimUrl peels only UNbalanced trailing ) / brackets so a URL
  // wrapped in "(…)" in prose doesn't keep the sentence's closing paren.
  var _URL_RE = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|doi\.org\/10\.[^\s<>]+|10\.\d{4,9}\/[^\s<>]+)/gi;
  function _trimUrl(u) {
    var s = u.replace(/[.,;:'"\]]+$/, "");      // trailing sentence punctuation
    while (/[)\]]$/.test(s)) {                    // unbalanced trailing close-paren?
      var opens = (s.match(/\(/g) || []).length;
      var closes = (s.match(/\)/g) || []).length;
      if (closes > opens) s = s.replace(/[.,;:'"\])]+$/, ""); else break;
    }
    return s;
  }
  function _hrefFor(token) {
    var s = _trimUrl(token);
    if (/^https?:\/\//i.test(s)) return s;
    if (/^www\./i.test(s)) return "https://" + s;
    if (/^doi\.org\//i.test(s)) return "https://" + s;
    if (/^10\./.test(s)) return "https://doi.org/" + s;
    return s;
  }
  function linkify(text) {
    var str = String(text == null ? "" : text);
    _URL_RE.lastIndex = 0;
    if (!_URL_RE.test(str)) return str;       // fast path: nothing to link
    _URL_RE.lastIndex = 0;
    var runs = [], last = 0, m;
    while ((m = _URL_RE.exec(str)) !== null) {
      var token = m[0];
      var clean = _trimUrl(token);
      if (m.index > last) runs.push({ text: str.slice(last, m.index) });
      runs.push({ text: clean, link: _hrefFor(clean), style: "link" });
      var tail = token.slice(clean.length);
      if (tail) runs.push({ text: tail });
      last = m.index + token.length;
    }
    if (last < str.length) runs.push({ text: str.slice(last) });
    return runs;
  }
  // de-emoji THEN linkify, wrapped as a pdfmake text node with the given style.
  function _linkText(text, style) {
    return { text: linkify(_deEmoji(text)), style: style };
  }

  /* A4 landscape certificate of attendance. Pure: returns the pdfmake doc.
   * Honours data.signatureDataUrl (base64 PNG) → SIGNATURE_DATAURL fallback;
   * with no image it draws a blank signature line instead. Localized via
   * data.lang (en/fr/ja); falls back to English. */
  function buildCertificateDocDefinition(data) {
    data = data || {};
    var name = _str(data.name, "Participant");
    var dateStr = _str(data.dateStr, new Date().toLocaleDateString());
    var partnership = _str(data.partnership, "Université de Caen Normandie × Nagoya University");
    var sessionLabel = _str(data.sessionLabel, "");
    var sessionCode = _str(data.sessionCode, "—");
    var L = _L(data);
    // Competencies: caller override wins, else the localized default set.
    var comps = (Array.isArray(data.competencies) && data.competencies.length)
      ? data.competencies.filter(Boolean) : L.competencies;
    var sigUrl = _str(data.signatureDataUrl, SIGNATURE_DATAURL);
    var sigName = _str(data.signatureName, "Dr. Basile Chrétien");
    var sigTitle = _str(data.signatureTitle, L.sigTitle);
    var certId = _str(data.certId, "");   // verification id (optional; QR + text when present)
    var verifyUrl = _str(data.verifyUrl, ""); // public verify URL — QR encodes this when set, else the bare id

    var did = L.certDid(sessionLabel, dateStr);

    // Signature mark: the scanned signature if supplied, else a blank ruled line.
    var sigMark = sigUrl
      ? { image: sigUrl, fit: [190, 64], margin: [0, 0, 0, 2] }
      : { canvas: [{ type: "line", x1: 0, y1: 56, x2: 200, y2: 56, lineWidth: 0.8, lineColor: BRAND.ink }] };

    return {
      pageSize: "A4",
      pageOrientation: "landscape",
      pageMargins: [70, 58, 70, 52],
      info: { title: "CaNaMED — Certificate of Attendance", author: "CaNaMED" },
      defaultStyle: { font: "Roboto", color: BRAND.ink, fontSize: 12 },
      // Decorative double border, gold corner flourishes + a faint gold seal.
      background: function (currentPage, pageSize) {
        var W = pageSize.width, H = pageSize.height, m = 22, m2 = 30, c = 26;
        return {
          canvas: [
            { type: "rect", x: m, y: m, w: W - 2 * m, h: H - 2 * m, lineWidth: 2, lineColor: BRAND.ink },
            { type: "rect", x: m2, y: m2, w: W - 2 * m2, h: H - 2 * m2, lineWidth: 0.75, lineColor: BRAND.line },
            // four gold corner brackets
            { type: "line", x1: m2, y1: m2 + c, x2: m2, y2: m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: m2, y1: m2, x2: m2 + c, y2: m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: W - m2 - c, y1: m2, x2: W - m2, y2: m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: W - m2, y1: m2, x2: W - m2, y2: m2 + c, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: m2, y1: H - m2 - c, x2: m2, y2: H - m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: m2, y1: H - m2, x2: m2 + c, y2: H - m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: W - m2 - c, y1: H - m2, x2: W - m2, y2: H - m2, lineWidth: 2, lineColor: BRAND.gold },
            { type: "line", x1: W - m2, y1: H - m2 - c, x2: W - m2, y2: H - m2, lineWidth: 2, lineColor: BRAND.gold }
          ].concat(_seal(W - 96, H - 104))
        };
      },
      content: [
        { text: L.certKicker, style: "kicker" },
        { text: "CaNaMED", style: "brand" },
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 2.5, lineColor: BRAND.gold }],
          alignment: "center", margin: [0, 6, 0, 0] },
        { text: partnership, style: "subtitle" },
        { text: L.certCertifies, style: "line", margin: [0, 18, 0, 2] },
        { text: name, style: "name" },
        { text: did, style: "line", margin: [70, 8, 70, 6], alignment: "center" },
        comps.length
          ? { ul: comps, style: "comps", margin: [0, 0, 0, 0] }
          : { text: "" },
        { text: L.certLang, style: "lang", margin: [0, 10, 0, 4] },
        // Extra-curricular / no-academic-credit disclaimer (boxed, centred) —
        // makes explicit that neither university awards credit for this.
        { table: { widths: ["*"], body: [[
            { text: L.certDisclaimer, style: "disclaimer",
              fillColor: "#f6f3ea", margin: [10, 5, 10, 5] }
          ]] }, layout: "noBorders", margin: [60, 4, 60, 0] },
        // Foot row: signature (left) · verification QR+ID (centre, when issued) ·
        // issue details (right). The QR opens the public verify page (id pre-
        // filled); entering the name on the certificate confirms it is genuine.
        { columns: [
            { width: "*", stack: [
                sigMark,
                { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: BRAND.ink }], margin: [0, 0, 0, 3] },
                { text: sigName, style: "sigName" },
                { text: sigTitle, style: "sigTitle" }
              ] },
            certId
              ? { width: "auto", alignment: "center", margin: [12, 0, 12, 0], stack: [
                    { qr: (verifyUrl || certId), fit: 60, foreground: BRAND.ink, eccLevel: "M", alignment: "center" },
                    { text: L.certVerifyId, style: "certLbl", alignment: "center", margin: [0, 3, 0, 0] },
                    { text: certId, style: "certId", alignment: "center" }
                  ] }
              : { width: 0, text: "" },
            { width: "auto", stack: [
                { text: L.certIssued + dateStr, style: "foot", alignment: "right" },
                { text: L.certSession + sessionCode, style: "foot", alignment: "right" },
                certId
                  ? { text: L.certVerifyOnline, style: "footSmall", alignment: "right", margin: [0, 4, 0, 0] }
                  : { text: "" }
              ] }
          ], columnGap: 22, margin: [0, 18, 0, 0] }
      ],
      styles: {
        kicker:   { fontSize: 11, characterSpacing: 3, color: BRAND.muted, alignment: "center", bold: true },
        brand:    { fontSize: 34, bold: true, color: BRAND.ink, alignment: "center", margin: [0, 4, 0, 0] },
        subtitle: { fontSize: 12, color: BRAND.muted, alignment: "center", margin: [0, 6, 0, 0] },
        line:     { fontSize: 12, alignment: "center", lineHeight: 1.3 },
        name:     { fontSize: 26, bold: true, color: BRAND.accent, alignment: "center", margin: [0, 4, 0, 4] },
        comps:    { fontSize: 12, color: BRAND.ink },
        lang:     { fontSize: 10.5, italics: true, color: BRAND.muted, alignment: "center" },
        disclaimer: { fontSize: 8.5, italics: true, color: BRAND.muted, alignment: "center", lineHeight: 1.25 },
        sigName:  { fontSize: 12, bold: true, color: BRAND.ink },
        sigTitle: { fontSize: 9.5, color: BRAND.muted },
        foot:     { fontSize: 10, color: BRAND.muted },
        footSmall:{ fontSize: 8, italics: true, color: BRAND.muted },
        certLbl:  { fontSize: 7.5, characterSpacing: 1.5, color: BRAND.muted },
        certId:   { fontSize: 11, bold: true, color: BRAND.ink, characterSpacing: 0.5 }
      }
    };
  }

  function _safe(s) { return String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, ""); }

  function certificate(data) {
    var pm = (typeof window !== "undefined") && window.pdfMake;
    if (!pm || typeof pm.createPdf !== "function") return false;
    var fname = "CaNaMED_certificate"
      + (data && data.name ? "_" + _safe(data.name) : "") + ".pdf";
    pm.createPdf(buildCertificateDocDefinition(data)).download(fname);
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
      if (b.type === "p" && b.text) out.push(_linkText(b.text, "para"));
      else if (b.type === "sub" && b.text) out.push({ text: _deEmoji(b.text), style: "h3" });
      else if (b.type === "ul" && Array.isArray(b.items) && b.items.length) {
        var items = b.items.map(_deEmoji).filter(Boolean)
          .map(function (it) { return { text: linkify(it) }; });
        out.push({ ul: items, style: "list" });
      } else if (b.type === "table" && Array.isArray(b.rows) && b.rows.length) {
        var body = b.rows.map(function (row) {
          return row.map(function (c) { return { text: linkify(_deEmoji(c)) }; });
        });
        out.push({
          table: { headerRows: b.header ? 1 : 0, widths: b.rows[0].map(function () { return "*"; }), body: body },
          layout: "lightHorizontalLines", style: "table", margin: [0, 4, 0, 12]
        });
      }
    });
    return out;
  }

  // A small accent rule drawn under a section heading, for a cleaner look.
  function _headingRule() {
    return { canvas: [{ type: "line", x1: 0, y1: 0, x2: 64, y2: 0, lineWidth: 2, lineColor: BRAND.accent }], margin: [0, 0, 0, 10] };
  }
  // Standard "new page + tocItem heading + accent rule" opener for a section.
  function _sectionHeading(title) {
    return [
      { text: _deEmoji(title), style: "h1", tocItem: true, tocStyle: "tocEntry", pageBreak: "before" },
      _headingRule()
    ];
  }

  function buildBookletDocDefinition(data) {
    data = data || {};
    var L = _L(data);
    var name = _str(data.name, "");
    var dateStr = _str(data.dateStr, new Date().toLocaleDateString());
    var partnership = _str(data.partnership, "Université de Caen Normandie × Nagoya University");
    var sessionCode = _str(data.sessionCode, "—");
    var sections = Array.isArray(data.sections) ? data.sections : [];
    var team = data.team || {};
    var content = [];
    function push() { for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (Array.isArray(a)) a.forEach(function (x) { content.push(x); }); else content.push(a);
    } }

    // Cover
    push({ text: "CaNaMED", style: "coverBrand", margin: [0, 120, 0, 0] });
    push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 3, lineColor: BRAND.gold }], alignment: "center", margin: [0, 8, 0, 0] });
    push({ text: L.bookletTitle, style: "coverTitle" });
    push({ text: partnership, style: "coverSub" });
    if (name) push({ text: L.preparedFor(_deEmoji(name)), style: "coverName", margin: [0, 28, 0, 0] });
    push({ text: L.certSession + sessionCode + "  ·  " + dateStr, style: "coverMeta" });
    push({ text: L.bookletBlurb, style: "coverBlurb", margin: [60, 40, 60, 0] });

    // Clickable table of contents on its own page. Each heading below opts in
    // with tocItem:true, so pdfmake generates the entries + page numbers and
    // links each one to its heading (clickable in any PDF viewer).
    push({ text: L.contents, style: "tocTitle", pageBreak: "before" });
    push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 2.5, lineColor: BRAND.gold }], margin: [0, 6, 0, 16] });
    push({ toc: { textStyle: "tocEntry", numberStyle: "tocPage" } });

    // Learning objectives
    push(_sectionHeading(L.objectivesTitle));
    push({ text: L.objectivesIntro, style: "para" });
    push({ ul: L.competencies.map(function (c) { return { text: _deEmoji(c) }; }), style: "list" });

    // Reference sections (from the live session cards). Each starts a fresh page
    // so the TOC stands alone and sections don't run together.
    sections.forEach(function (sec, i) {
      push(_sectionHeading(sec.title || ("Section " + (i + 1))));
      _sectionBlocks(sec.blocks).forEach(function (blk) { content.push(blk); });
    });

    // Key framework — SPIKES (two-column step table)
    push(_sectionHeading(L.frameworkTitle));
    push({ text: L.frameworkIntro, style: "para" });
    push({ table: { widths: ["auto", "*"], body: L.spikes.map(function (s) {
      return [ { text: s[0] + " — " + s[1], style: "spikeStep" }, { text: s[2], style: "spikeBody" } ];
    }) }, layout: "lightHorizontalLines", margin: [0, 4, 0, 0] });

    // Glossary
    push(_sectionHeading(L.glossaryTitle));
    push({ text: L.glossaryIntro, style: "para" });
    push({ table: { widths: [150, "*"], body: L.glossary.map(function (g) {
      return [ { text: g[0], style: "glossTerm" }, { text: g[1], style: "glossDef" } ];
    }) }, layout: "lightHorizontalLines", margin: [0, 4, 0, 0] });

    // References & further reading — DOIs / URLs rendered clickable.
    push(_sectionHeading(L.referencesTitle));
    push({ text: L.referencesIntro, style: "para" });
    push({ ul: REFERENCES.map(function (r) { return { text: linkify(r[0] + " " + r[1]) }; }), style: "refList" });

    // Your team
    push(_sectionHeading(L.yourTeam));
    if (team.name) push({ text: _deEmoji(team.name), style: "teamName" });
    if (typeof team.score === "number") push({ text: L.pointsEarned(team.score), style: "teamScore" });
    if (Array.isArray(team.wins) && team.wins.length) {
      push({ text: L.didWell, style: "h2" });
      push({ ul: team.wins.map(_deEmoji).filter(Boolean), style: "list" });
    }
    if (Array.isArray(team.cohort) && team.cohort.length) {
      push({ text: L.howCompares, style: "h2" });
      var max = team.cohort.reduce(function (m, r) { return Math.max(m, r.score || 0); }, 1);
      var rows = team.cohort.map(function (r) {
        var w = Math.max(2, Math.round(((r.score || 0) / max) * 150));
        return [
          { text: _deEmoji(r.label || "") + (r.you ? L.yourTeamMarker : ""), bold: !!r.you, color: r.you ? BRAND.accent : BRAND.ink },
          { text: String(r.score || 0), alignment: "right" },
          { canvas: [{ type: "rect", x: 0, y: 3, w: w, h: 9, r: 2, color: r.you ? BRAND.accent : BRAND.line }] }
        ];
      });
      push({ table: { widths: ["*", "auto", 160], body: rows }, layout: "noBorders", margin: [0, 4, 0, 0] });
      push({ text: L.cohortNote, style: "note", margin: [0, 10, 0, 0] });
    }

    return {
      pageSize: "A4",
      pageMargins: [54, 60, 54, 56],
      info: { title: "CaNaMED — Study booklet", author: "CaNaMED" },
      defaultStyle: { font: "Roboto", color: BRAND.ink, fontSize: 11, lineHeight: 1.3 },
      footer: function (currentPage, pageCount) {
        return { text: L.pageFoot + "  ·  " + currentPage + " / " + pageCount, style: "pageFoot" };
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
        link:        { color: BRAND.accent, decoration: "underline" },
        spikeStep:   { fontSize: 11, bold: true, color: BRAND.accent, margin: [0, 3, 8, 3] },
        spikeBody:   { fontSize: 10.5, margin: [0, 3, 0, 3], lineHeight: 1.3 },
        glossTerm:   { fontSize: 10.5, bold: true, color: BRAND.ink, margin: [0, 3, 6, 3] },
        glossDef:    { fontSize: 10.5, margin: [0, 3, 0, 3], lineHeight: 1.3 },
        refList:     { fontSize: 10, margin: [0, 2, 0, 0], lineHeight: 1.35 },
        teamName:    { fontSize: 16, bold: true, color: BRAND.accent },
        teamScore:   { fontSize: 12, color: BRAND.muted, margin: [0, 2, 0, 0] },
        note:        { fontSize: 9.5, color: BRAND.muted, italics: true },
        pageFoot:    { fontSize: 8, color: BRAND.muted, alignment: "center", margin: [0, 16, 0, 0] }
      }
    };
  }

  function booklet(data) {
    var pm = (typeof window !== "undefined") && window.pdfMake;
    if (!pm || typeof pm.createPdf !== "function") return false;
    pm.createPdf(buildBookletDocDefinition(data)).download("CaNaMED_study-booklet.pdf");
    return true;
  }

  // UMD-ish export: attach to the browser global for the lazy-loaded runtime,
  // and to module.exports so Node unit tests can require the pure builders.
  var _api = {
    buildCertificateDocDefinition: buildCertificateDocDefinition,
    certificate: certificate,
    buildBookletDocDefinition: buildBookletDocDefinition,
    booklet: booklet,
    _linkify: linkify
  };
  var _root = (typeof self !== "undefined") ? self
            : (typeof globalThis !== "undefined") ? globalThis : null;
  if (_root) {
    _root.CanamedPdf = _root.CanamedPdf || {};
    _root.CanamedPdf.buildCertificateDocDefinition = buildCertificateDocDefinition;
    _root.CanamedPdf.certificate = certificate;
    _root.CanamedPdf.buildBookletDocDefinition = buildBookletDocDefinition;
    _root.CanamedPdf.booklet = booklet;
    _root.CanamedPdf._linkify = linkify;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = _api;
})();
