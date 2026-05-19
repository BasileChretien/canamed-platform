/* CaNaMED clinical glossary — plain-English + Japanese glosses for
 * the medical terms that appear in case-content. Sim 2026-05-19
 * surfaced two A2-level Japanese students (Kenta, Takeshi) asking for
 * "Hover a medical phrase → see plain-English + Japanese gloss in a
 * tooltip" — this is the minimal dataset for that feature.
 *
 * Format: each key is a lowercase substring; the entry is
 *   { en: "plain-English explanation", ja: "Japanese explanation" }
 *
 * Match logic in script.js does case-insensitive substring matching
 * on the BUTTON text, then attaches a multi-line `title` attribute.
 *
 * Extend by adding entries — no schema changes required.
 */
(function (root) {
  var GLOSSARY = {
    // ── Module A — Chronic Pain stewardship ──
    "oxycodone": {
      en: "strong opioid pain medication — risk of dependence",
      ja: "強オピオイド系鎮痛薬 — 依存のリスクあり"
    },
    "opioid": {
      en: "morphine-family pain medication; effective but addictive",
      ja: "モルヒネ系の鎮痛薬;効果はあるが依存性あり"
    },
    "cauda equina": {
      en: "spinal-nerve compression — surgical emergency",
      ja: "馬尾症候群 — 緊急の脊髄神経圧迫"
    },
    "paracetamol": {
      en: "acetaminophen — first-line non-opioid analgesic",
      ja: "アセトアミノフェン — 非オピオイド系の第一選択鎮痛薬"
    },
    "ibuprofen": {
      en: "NSAID — non-steroidal anti-inflammatory drug",
      ja: "イブプロフェン — 非ステロイド性抗炎症薬(NSAIDs)"
    },
    "tramadol": {
      en: "weak opioid + SNRI; CYP2D6-dependent metabolism",
      ja: "弱オピオイド+SNRI;CYP2D6で代謝"
    },
    "cyp2d6": {
      en: "liver enzyme — converts codeine/tramadol to active form",
      ja: "肝酵素 — コデイン/トラマドールを活性型に変換"
    },
    "differential": {
      en: "list of possible diagnoses to consider and rule out",
      ja: "考えられる診断のリスト(鑑別診断)"
    },
    "red flag": {
      en: "warning sign suggesting serious underlying disease",
      ja: "重篤な原疾患を示唆する警告徴候(レッドフラッグ)"
    },
    "nsaid": {
      en: "non-steroidal anti-inflammatory (e.g., ibuprofen, naproxen)",
      ja: "非ステロイド性抗炎症薬(NSAIDs)"
    },
    "physio": {
      en: "physiotherapy — movement-based pain management",
      ja: "理学療法(運動療法)"
    },
    "neuropathic": {
      en: "nerve-origin pain — burning / electric / pins-and-needles",
      ja: "神経由来の痛み — 焼ける/電気/ピリピリ"
    },

    // ── Module B — Breaking Bad News ──
    "spikes": {
      en: "6-step framework for delivering bad news clearly + kindly",
      ja: "悪い知らせの伝え方の6段階フレームワーク(SPIKES)"
    },
    "autonomy": {
      en: "the patient's right to decide about their own care",
      ja: "患者自身が自分の医療を決定する権利(自律性)"
    },
    "disclosure": {
      en: "telling the patient the diagnosis directly",
      ja: "患者本人への診断告知"
    },

    // ── general workshop terms ──
    "pbl": {
      en: "problem-based learning — case-driven small-group teaching",
      ja: "問題基盤型学習(PBL)— 症例ベースの少人数教育"
    }
  };

  if (typeof window !== "undefined") {
    root.CANAMED_GLOSSARY = GLOSSARY;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = GLOSSARY;
  }
})(typeof self !== "undefined" ? self : this);
