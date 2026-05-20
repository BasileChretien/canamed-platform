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
    "codeine": {
      en: "weak opioid; CYP2D6 converts it to morphine (variable effect)",
      ja: "弱オピオイド;CYP2D6がモルヒネに変換(効果に個人差)"
    },
    "naproxen": {
      en: "NSAID — longer-acting anti-inflammatory",
      ja: "ナプロキセン — 作用時間の長いNSAID"
    },
    "sciatica": {
      en: "leg pain from a compressed lumbar nerve root",
      ja: "坐骨神経痛 — 腰部神経根の圧迫による下肢痛"
    },
    "slr": {
      en: "straight-leg-raise test — screens for nerve-root irritation",
      ja: "下肢伸展挙上テスト(SLR)— 神経根刺激のスクリーニング"
    },
    "faber": {
      en: "hip/sacroiliac provocation test (Patrick's test)",
      ja: "FABERテスト — 股関節/仙腸関節の誘発試験"
    },
    "spondyloarthritis": {
      en: "inflammatory spine arthritis (axSpA) — morning stiffness, age <45",
      ja: "脊椎関節炎(軸性脊椎関節炎)— 朝のこわばり、45歳未満発症"
    },
    "yellow flag": {
      en: "psychosocial risk factor for pain becoming chronic",
      ja: "痛みの慢性化に関わる心理社会的リスク因子(イエローフラッグ)"
    },
    "biopsychosocial": {
      en: "model: pain = biology + psychology + social context together",
      ja: "生物心理社会モデル — 痛みは生物・心理・社会の総和"
    },
    "dependence": {
      en: "body adapts to a drug; stopping causes withdrawal",
      ja: "依存 — 薬に身体が順応し、中止で離脱症状"
    },
    "shared decision": {
      en: "clinician + patient decide together, weighing options",
      ja: "共有意思決定 — 医師と患者が選択肢を一緒に検討"
    },
    "mri": {
      en: "detailed scan; not needed in back pain without red flags",
      ja: "MRI — レッドフラッグのない腰痛では不要"
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
    "courvoisier": {
      en: "painless palpable gallbladder + jaundice → suspect cancer",
      ja: "クールボアジェ徴候 — 無痛性の触知可能な胆嚢+黄疸→がんを疑う"
    },
    "jaundice": {
      en: "yellowing of skin/eyes from high bilirubin",
      ja: "黄疸 — ビリルビン上昇による皮膚・眼の黄染"
    },
    "palliative": {
      en: "care focused on comfort + quality of life, not cure",
      ja: "緩和ケア — 治癒ではなく快適さとQOLを重視"
    },
    "prognosis": {
      en: "the likely course / outcome of the illness",
      ja: "予後 — 病気の今後の経過・見通し"
    },
    "capacity": {
      en: "the patient can understand, retain, weigh + communicate a decision",
      ja: "意思決定能力 — 理解・保持・比較検討・意思表示ができること"
    },
    "ecog": {
      en: "performance-status score (0 = fully active … 4 = bedbound)",
      ja: "ECOG全身状態スコア(0=完全に活動的…4=寝たきり)"
    },
    "ercp": {
      en: "endoscopic procedure to relieve a blocked bile duct (stent)",
      ja: "ERCP — 閉塞した胆管を内視鏡で開通(ステント)"
    },
    "metasta": {
      en: "cancer that has spread beyond the original site",
      ja: "転移 — がんが原発巣を越えて広がること"
    },
    "advance care": {
      en: "planning future care while the patient can still decide",
      ja: "アドバンス・ケア・プランニング(人生会議)"
    },
    "warning shot": {
      en: "a brief phrase that signals bad news is coming",
      ja: "ウォーニングショット — 悪い知らせを予告する一言"
    },
    "empathy": {
      en: "naming + acknowledging the patient's emotion",
      ja: "共感 — 患者の感情を言葉にして受け止める"
    },

    // ── Module C — Respiratory / antibiotic stewardship ──
    "centor": {
      en: "score estimating strep-throat likelihood (fever, exudate…)",
      ja: "Centorスコア — 溶連菌咽頭炎の可能性を推定"
    },
    "mcisaac": {
      en: "Centor score adjusted for age (McIsaac modification)",
      ja: "McIsaac基準 — 年齢補正したCentorスコア"
    },
    "pharyngitis": {
      en: "sore throat / inflamed pharynx — usually viral",
      ja: "咽頭炎 — のどの炎症、多くはウイルス性"
    },
    "amoxicillin": {
      en: "penicillin antibiotic; not for viral sore throat",
      ja: "アモキシシリン — ペニシリン系抗菌薬、ウイルス性咽頭炎には不要"
    },
    "antimicrobial resistance": {
      en: "bacteria evolving to survive antibiotics (AMR) — a population harm",
      ja: "薬剤耐性(AMR)— 抗菌薬に細菌が耐性を獲得、集団レベルの害"
    },
    "stewardship": {
      en: "using antibiotics only when truly needed, to preserve them",
      ja: "抗菌薬適正使用 — 本当に必要な時だけ使い温存する"
    },
    "delayed prescri": {
      en: "give a script but ask to fill only if symptoms worsen (NICE NG84)",
      ja: "遅延処方 — 悪化時のみ使うよう求める処方(NICE NG84)"
    },
    "rapid antigen": {
      en: "in-clinic strep test; only useful when Centor/McIsaac ≥ 2",
      ja: "迅速抗原検査 — Centor/McIsaac≥2のときのみ有用"
    },
    "mononucleosis": {
      en: "EBV 'glandular fever'; amoxicillin causes a rash here",
      ja: "伝染性単核症(EBV)— アモキシシリンで皮疹が出る"
    },
    "safety net": {
      en: "telling the patient exactly what change should prompt return",
      ja: "セーフティネット — 再受診すべき変化を明確に伝える"
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
