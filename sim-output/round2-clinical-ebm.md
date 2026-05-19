# Round 2 — Clinical / EBM review of CaNaMED Session 3 PBL platform

**Reviewer perspective:** senior clinical educator (UK/EU primary care + medical
education background), reviewing the cases shipped in
`C:/cnm-pp/docs/Third_session/PBL_platform/case-content.js` (3 scenarios,
2,241 lines) against current 2025-2026 guidance.

**Date:** 2026-05-20
**Cases reviewed:**
- Scenario 1 (`chronic-pain-opioids`) — Mr Lefebvre, 45y, 8-month low-back pain, asks for oxycodone by name.
- Scenario 2 (`breaking-bad-news-disclosure`) — Mrs Tanaka (田中), 75y, painless obstructive jaundice → Stage IV pancreatic adenocarcinoma; adult son requests non-disclosure.
- Scenario 3 (`respiratory-stewardship`) — Mme Moreau, 32y, 5-day viral pharyngitis, asks for amoxicillin (post-tonsillectomy, McIsaac/Centor = 0).
- A `PRETEST_CHRONIC_PAIN` / `POSTTEST_CHRONIC_PAIN` MCQ bank attached to Scenario 1.
- Scenarios 2 and 3 ship without pre-/post-tests (acknowledged as follow-up in the file's own comments).

The **structural pedagogy is excellent.** All three cases share a coherent
scaffold: focused-history → focused-exam → synthesis gate (`labs[0]` with
`key:true`) → discussion prompts. Each scenario deliberately seeds 2–3
**wrong-move items** with explicit `PENALTIES` and pedagogically-narrated
"what just went wrong" stage directions in the `.a` text — this is unusually
honest design for a simulation platform and worth preserving as a project
asset. The `unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 }`
gate on the treatment-plan vote (added on 2026-05-18 per the inline comment)
correctly enforces the PBL "no plan before workup" discipline.

The critique below is therefore mostly about **gaps and refinements** at the
margin, not structural problems.

---

## Scenario 1 — Chronic pain & the opioid request (Mr Lefebvre)

### 1. Clinical accuracy

**Strong points:**
- The vignette is plausible. 8-month mechanical-pattern non-radicular pain in a 45-year-old, with normal neuro exam and negative SLR, is the canonical chronic non-specific low-back pain (CNSLBP) presentation.
- Red-flag screen (`history:1`) bundles malignancy / infection / fracture / IVDU correctly — and the cauda-equina screen is broken out into its own item (`history:2`), which is good ergonomics.
- The hip + sacroiliac (`exam:4`, FABER) item is a particularly nice teaching point — these are the two highest-yield mimics of "low-back pain" in primary care.
- Yellow-flag identification (fear of movement, low mood, activity avoidance, sleep disturbance) in the synthesis text is textbook-correct and aligns with the Keele STarT Back/PsychFLAGS literature.

**Weaknesses / red-flag-misses:**
- **No inflammatory back pain (axial spondyloarthritis, axSpA) screen.** The synthesis text *mentions* "inflammatory (axial spondyloarthritis) disease" as ruled out, but no history item ever asks the IBP-suggestive features: morning stiffness > 30 min, alternating buttock pain, age < 45 at onset, improvement with NSAIDs, response to exercise rather than rest, family history of HLA-B27 disease / psoriasis / IBD / uveitis. A 45-year-old with 8 months of pain *is* in the age window where axSpA still needs an explicit screen. **This is the biggest single clinical-accuracy gap in the case.** Currently the history sequence lets students "rule out" axSpA without ever asking about it.
- The exam item "lumbar range of movement" (`exam:2`) says extension is preserved — this is consistent with mechanical pain but Schober's test is not mentioned. Optional but worth a note.
- `history:0` — "8 months… worse after sitting, eases when lying down" is mechanical-pattern, but the patient also says pain "doesn't wake me from sleep and isn't worse lying down." Combining "worse after sitting / eased by lying" with the standard cancer/infection screen is fine, but for axSpA the distinguishing feature is "*better* with movement, *worse* after rest" — the case answer in `history:0` ("eases when I move around") is actually mildly axSpA-suggestive in isolation. The synthesis then declares the picture mechanical without the case ever doing the screen that would discriminate. A teaching gap, not a frank error.

**Pedagogical simplification flags:**
- The deliberately-wrong "promise oxycodone first" (`history:8`) and "is it just stress" (`history:9`) items are excellent — keep these.
- `exam:5` (DRE without indication) is appropriately framed as harm. Good.

### 2. EBM grounding

The case header cites **NICE NG59 (2016, upd. 2020)**, **HAS 2019**, **JOA 2019**, **ACP 2017**, **CDC 2022**. All four are real, current, and from reputable sources. Strengths:
- The `PRETEST_CHRONIC_PAIN` Q3 says NSAIDs at lowest effective dose are first-line and paracetamol monotherapy is *not* recommended — this is the **correct current NICE NG59 position** (the 2016 reversal away from paracetamol monotherapy is one of the most-misquoted facts in the field; the case gets it right).
- Q5 (oxycodone request) cites CDC 2022 and HAS — CDC 2022 is the current Clinical Practice Guideline for Prescribing Opioids for Pain (Dowell et al, MMWR Recomm Rep 2022;71:1-95), which superseded the more rigid 2016 version. Correct.

**Issues to fix:**
- **The HAS chronic-pain reference is imprecise.** The case says "HAS 2019" — HAS's flagship document on chronic non-cancer pain opioid use is actually:
  - HAS "Pertinence et bon usage des antalgiques opioïdes" — work programme 2022-2023, with the public report and recommendations published in **2024** (not 2019).
  - HAS "Prise en charge du patient présentant une lombalgie commune" — 2019 (this is the LBP document — the 2019 date is right for LBP, but the case cites "HAS 2019" in the context of opioids more than once, which conflates two different HAS documents).
  - Recommend changing the citation header to: "HAS 2019 (lombalgie commune) + HAS 2024 (bon usage des antalgiques opioïdes)" to avoid teaching a wrong date for the opioid recommendation.
- **No mention of CNAM / ANSM oxycodone-specific data.** France's ANSM published opioid surveillance data through 2024 showing oxycodone consumption tripled 2006–2017 and then plateaued under the post-2017 tightening — this is *exactly* the data the cross-cultural prompt #4 invites students to discuss, and the case currently relies on students sourcing it themselves. A one-line cite in the synthesis would harden it.
- **JOA 2019** — the **Japanese Orthopaedic Association guideline for low-back pain was updated in 2019**; this is correct. However the case mentions JOA twice without distinguishing it from the Japanese Society of Pain Clinicians (JSPC) guideline on chronic pain (2018, updated 2021) — the latter is the more relevant document for the *opioid* arm of the discussion. Worth adding.
- **CDC 2022** is cited but not explained: the most important shift from 2016 → 2022 was *removing* the 90 MME/day hard threshold and reasserting clinician judgement / shared decision-making. The case captures this in spirit (the correct answer is "explore the request") but the explicit teaching moment is missed.

### 3. Differential / hypothesis-building

The platform forces students to commit to ≥1 working hypothesis before unlocking the plan vote (`unlockWhen: { hypotheses: 1, ... }`) — good. However:
- The case never **lists** a differential explicitly. There is no "name 3 things this could be" prompt. The synthesis just declares the diagnosis. For Year-4–6 students learning hypothesis-driven reasoning, an explicit differential step (mechanical CNSLBP vs axSpA vs malignancy vs visceral referred pain vs hip OA) would be high-value.
- **Recommendation:** add a `prompts[0]` (or an early discussion prompt) — "Before the synthesis: name THREE diagnoses you would seriously consider for an office worker with 8 months of low-back pain, and the single feature that would push you toward each."

### 4. Cultural fit (Franco-Japanese)

- The patient name is **Mr Lefebvre** — fine for a Caen cohort. There is **no Japanese variant** of this case (no "Mr 田中 with chronic low-back pain"). The cross-cultural prompts ask students to "describe a real consultation pattern" from their side, which is good — but the patient is implicitly French. Consider offering a parallel Japanese version of the vignette so Nagoya students can roleplay from a closer-to-home starting point. (Scenario 2 does this — its patient *is* Japanese.)
- The opioid-culture prompt (Module A #4) is well-pitched and avoids stereotyping. Good.
- The "father had a problem with alcohol" line (`history:7`) — adds family-history substance-use risk, which is appropriate, but be aware that in a Japanese teaching context this is unusual openness in a first consultation; a brief facilitator note might help.

### 5. What's missing

- **axSpA screen** (above).
- **Explicit differential step** (above).
- **No PHQ-2 / GAD-2 mention** — yellow flags are talked about but no screening tool. Year-4–6 students should be exposed to PHQ-2 as a 30-second screen for the low-mood yellow flag.
- **No mention of return-to-work / fit-note / arrêt de travail.** This is a 45-year-old office worker. The French case context begs a one-line cue about *what the GP writes on the arrêt de travail* — and whether that itself is a clinical tool (graded return to work) or just paperwork. Compare with the Japanese context where 病気休暇 / 傷病手当 cultures differ markedly.
- **No FACILITATOR notes per case.** The case ships pedagogically rich answers, but a separate "facilitator pocket card" would help the Nagoya / Caen academic running the room. Currently the educator has to read the inline JS comments.

### 6. Top 3 specific edits for Scenario 1

**Edit 1 — Insert an axSpA screen as a new `history` item.** Suggested replacement (insert as `history[3]`, push existing items down; remember to update `synthPrereqs` to keep `history:1, history:2, exam:3` indices stable, or rename to a key-based reference):

```js
{ q: { en: "Inflammatory back-pain screen: morning back stiffness lasting more than 30 minutes, alternating buttock pain, pain that IMPROVES with movement and is worse after rest, age < 45 at onset, family history of psoriasis, inflammatory bowel disease, or uveitis?",
       fr: "Dépistage de la lombalgie inflammatoire : raideur matinale du dos > 30 min, douleur fessière alternante, douleur AMÉLIORÉE par le mouvement et aggravée par le repos, début avant 45 ans, antécédents familiaux de psoriasis, MICI ou uvéite ?",
       ja: "炎症性腰痛のスクリーニング:30分以上続く朝のこわばり、左右交代性の臀部痛、運動で改善し安静で悪化する痛み、45歳未満での発症、乾癬・炎症性腸疾患・ぶどう膜炎の家族歴は?" },
  a: { en: "No morning stiffness — when I get up I'm just sore, not stiff, and it loosens up within a few minutes. No buttock pain. Movement actually doesn't help much; in fact resting helps more. No psoriasis, no IBD, no eye problems in me or my family.",
       fr: "Pas de raideur matinale — au lever je suis juste douloureux, pas raide, et ça se délie en quelques minutes. Pas de douleur fessière. Le mouvement n'aide pas vraiment ; le repos m'aide plutôt plus. Pas de psoriasis, pas de MICI, pas de problème oculaire chez moi ou ma famille.",
       ja: "朝のこわばりはなく — 起床時はただ痛いだけで、数分で楽になります。臀部痛もありません。動いてもあまり楽にならず、むしろ休んだほうが楽です。本人にも家族にも乾癬、炎症性腸疾患、眼の病気はありません。" },
  cite: { en: "ASAS / NICE NG65 — axial spondyloarthritis red flags",
          fr: "ASAS / HAS — spondyloarthrite axiale",
          ja: "ASAS / 日本リウマチ学会 — 軸性脊椎関節炎" } }
```

**Edit 2 — Fix the HAS citation in the file header.** Replace the existing header block on lines ~44-46:

```js
// from:
// Clinical content reviewed against current guidance: HAS 2019 (France), JOA
// low-back-pain guideline 2019 (Japan), NICE NG59 (UK), ACP 2017 + CDC 2022 (USA).

// to:
// Clinical content reviewed against current guidance:
//   - France: HAS 2019 ("Prise en charge du patient présentant une lombalgie
//     commune") + HAS 2024 ("Pertinence et bon usage des antalgiques opioïdes")
//     + ANSM 2024 opioid surveillance report.
//   - Japan: JOA 2019 (low-back pain) + JSPC 2021 (chronic pain).
//   - UK: NICE NG59 (2016, upd. 2020 — low-back pain & sciatica) + NICE NG193
//     (2021 — chronic primary pain).
//   - USA: ACP 2017 (non-invasive Rx of LBP) + CDC 2022 (opioids for pain,
//     supersedes 2016).
```

**Edit 3 — Add an explicit differential prompt** as a new top-of-list element to `prompts[]` (becomes prompts[0], existing prompts shift down):

```js
{ en: "Differential first, plan second: name THREE diagnoses you would seriously consider for an office worker with 8 months of low-back pain — and for each, the single history or examination feature that would push you toward it. Only after that, agree your synthesis.",
  fr: "D'abord le diagnostic différentiel, ensuite le plan : nommez TROIS diagnostics que vous envisageriez sérieusement chez un employé de bureau avec 8 mois de lombalgie — et pour chacun, l'élément d'interrogatoire ou d'examen qui pencherait dans son sens. Ne validez votre synthèse qu'après.",
  ja: "まず鑑別、次に計画:8か月続く腰痛の事務職男性で本気で考える3つの鑑別診断を挙げ — それぞれについて、その診断に傾く問診または身体所見の鍵を一つ示してください。総合判断はそのうえで行いましょう。" }
```

---

## Scenario 2 — Breaking Bad News (Mrs Tanaka, pancreatic Ca)

### 1. Clinical accuracy

This is the strongest of the three cases clinically. The painless obstructive jaundice → pancreatic head adenocarcinoma → Stage IV with hepatic/peritoneal mets → unresectable workflow is textbook-correct, and the case correctly drops in:

- **Courvoisier's sign** (`exam:1`) — painless palpable gallbladder in a jaundiced patient = pancreatic / distal biliary malignancy, not stones. Cited correctly.
- **Double-duct sign** on pancreas-protocol CT — correct radiology language.
- **CA 19-9 = 1,840** with explicit note that CA 19-9 has limited diagnostic specificity but is consistent with the picture — appropriately hedged. Good.
- **MDT/RCP decision** to use **gemcitabine ± nab-paclitaxel** over FOLFIRINOX on age / performance status / albumin grounds — this is current 2025 practice. FOLFIRINOX vs Gem/NabPac selection is one of the most asked oncology-MDT questions of the past 3 years and the case answers it correctly. The albumin 28 g/L line is a nice realistic detail (it would knock most patients off FOLFIRINOX eligibility).
- **6-11 months median survival with chemo, 3-5 months without** — within the range commonly cited (the MPACT trial benchmark is ~8.5 months Gem/NabPac vs ~6.7 months Gem alone; the case's range is a reasonable, hedged communication number).
- **Capacity check (`exam:3`)** — the case explicitly walks through Understand / Retain / Weigh / Communicate. **This is excellent.** It is the right vocabulary in both France (Loi Kouchner — patient apte) and the UK (Mental Capacity Act 2005). It also pre-empts any attempt to bypass the patient on "best-interests" grounds.

**Minor clinical gaps:**
- No explicit **performance status (ECOG / Karnofsky)** in the MDT summary. For a real chemo-eligibility decision this is the second number after the albumin. Worth adding ("ECOG 1" would fit the picture).
- **ERCP / biliary stent** is mentioned in the MDT but the case never lets the student *order* it. Since biliary stenting is an immediate symptom-relief intervention (pruritus, cholangitis prevention) that the patient might want even if she refuses chemo, it would be a high-value `decisions` vote item — "Do you offer ERCP biliary stenting now, or wait for her chemo decision?"

### 2. EBM / guideline grounding

The header cites:
- France: **Loi Kouchner (loi n°2002-303 du 4 mars 2002)**; **HAS 2008 "L'annonce du diagnostic"**; **dispositif d'annonce 2019** in oncology.
- Japan: **MHLW guideline on End-of-Life Care (2007, revised 2018)** — the **人生会議 (jinsei kaigi) / ACP** rebrand and the move from family-mediated non-disclosure.
- International: **SPIKES (Baile et al, Oncologist 2000)**.

All four are real, the dates are correct, and the framing ("Japan is converging, not diverging") is exactly the modern consensus. **Strong EBM grounding.**

One refinement:
- **The 2018 MHLW revision** is more precisely "**人生の最終段階における医療・ケアの決定プロセスに関するガイドライン**" (Guideline on the Decision Process for Medical Care in the Final Stage of Life). The case calls it "MHLW Guidelines on End-of-Life Care" — fine as English shorthand, but the **MHLW 人生会議 campaign formally launched November 2018** and the **Japan Society for Palliative Medicine (JSPM) / JSCO joint statement on disclosure**, plus the **Japan Society of Clinical Oncology (JSCO) Communication Skills Training (CST) curriculum**, would be worth referencing if the file ever gets a fuller cite list.

### 3. SPIKES application

The case lands SPIKES correctly:
- **Setting** — `dec_family` and the "who is in the room" choice in the synthesis.
- **Perception** — covered by the dec_first_words winning option ("how much detail would you like").
- **Invitation** — same choice, "would you like your son to stay."
- **Knowledge** — the case repeatedly says "small piece," "warning shot," "pause."
- **Empathy** — the `prompts[6]` "She cries quietly. He sits very still. What do you say next?" is the empathy step, well-pitched.
- **Strategy & Summary** — `prompts[7]` (advance care planning, who else in the room) hits this.

The `SCORING_B.moduleB.structure` family pattern-matches all six SPIKES components in the `any` array — that is correct (some platforms only score "spikes" as a word, which is gameable; this case requires real elements).

**Most impressive piece:** the case **refuses** the false binary "tell vs withhold." `dec_family`'s winning option is "acknowledge the son's fear, then ask Mrs Tanaka herself." This is the **single hardest** teaching point in breaking bad news, and the case nails it.

### 4. Cultural fit

Excellent. The son's stated rationale ("eldest son carries the burden," "my father stopped eating after his news") is culturally specific without being a caricature. The case avoids the common Western-trained-doctor trap of treating "family wants to withhold" as monolithically Japanese — by writing the son as **recently bereaved**, the case grounds his behaviour in grief, not in stereotype. This is what experienced cross-cultural educators do.

The bilingual rendering uses 田中さん (Tanaka-san) correctly and uses 進行 / 限られた時間 as worked examples of "softer Japanese clinical language" in `prompts[5]`. The prompt is sharp: "Is softening language a form of dishonesty, a form of respect, or a culturally legitimate technical vocabulary?" — this is the right question and it does not pre-judge.

### 5. What's missing

- **No prognosis-disclosure step.** The case decides *whether* to tell the diagnosis but never asks the harder downstream question: *should you volunteer numerical prognosis* (e.g. "median 6-11 months") *or wait for the patient to ask?* HAS 2019 dispositif d'annonce explicitly addresses this; so does the JSCO CST. A short `decisions` item would close the loop.
- **No mention of interpreter / language.** Mrs Tanaka is being seen "jointly by a French and a Japanese physician." In which language is the consultation happening? The case is silent. For a Franco-Japanese teaching cohort, asking "which language do you break the news in, and what do you tell the patient about your own language fluency?" is a real-world skill — worth a prompt.
- **No religious / spiritual screen.** The case mentions chaplaincy only in `prompts[7]` as a list option. A direct question ("Would you like us to involve anyone outside the medical team — a religious figure, a counsellor?") is a SPIKES-Setting move that students often skip.
- **No mention of advance directive / DNACPR / 蘇生処置の希望.** `prompts[7]` mentions "resuscitation status" briefly but a separate vote on *when* to introduce it (today vs at a follow-up vs only when the patient asks) would be a strong teaching item.

### 6. Top 3 specific edits for Scenario 2

**Edit 1 — Add a vote on volunteering numerical prognosis.** New `DECISIONS_B` entry:

```js
{ id: "dec_prognosis", module: "B", points: 20, penalty: 0,
  prompt: { en: "After Mrs Tanaka has absorbed the diagnosis, she asks: \"How long do I have, doctor?\" Your response is…",
            fr: "Une fois que Mme Tanaka a absorbé le diagnostic, elle demande : « Combien de temps me reste-t-il, docteur ? » Votre réponse est…",
            ja: "田中さんが診断を受け止めたあと、こう尋ねます:「先生、私はあとどれくらいですか?」あなたの応答は…" },
  options: [
    { text: { en: "\"Median survival is 6-11 months with chemotherapy.\" — Give the number directly.",
              fr: "« La survie médiane est de 6 à 11 mois avec chimiothérapie. » — Donner le chiffre directement.",
              ja: "「化学療法ありで生存期間中央値は6か月から11か月です。」 — 数字を直接伝える。" },
      correct: false,
      why: { en: "Honest, but premature. She asked a question; she has not yet asked for a number. Some patients want the median, some want a range, some want \"weeks vs months vs years.\" Volunteering the precise number can land like a sentence — explore first what kind of answer she is asking for.",
             fr: "Honnête, mais prématuré. Elle a posé une question, elle n'a pas demandé un chiffre. Certaines patientes veulent la médiane, d'autres une fourchette, d'autres « semaines vs mois vs années ». Donner le chiffre précis peut tomber comme une condamnation — explorez d'abord quel type de réponse elle attend.",
             ja: "誠実ですが、急ぎすぎです。彼女は問いを発しただけで、数字を求めたわけではありません。中央値を知りたい人もいれば、範囲を聞きたい人も、「週か、月か、年か」だけを知りたい人もいます。正確な数字を持ち出すと宣告のように響くことがあります — まずどんな答えを求めているのか確認しましょう。" } },
    { text: { en: "\"That's hard to predict — every patient is different.\" — Deflect.",
              fr: "« C'est difficile à dire — chaque patient est différent. » — Esquiver.",
              ja: "「予測は難しいんです — 患者さんごとに違いますから。」 — はぐらかす。" },
      correct: false,
      why: { en: "True in part, but used here as deflection it refuses her question. She asked because she wants to plan — for grandchildren, for affairs, for the time she has. Deflection denies her that planning capacity.",
             fr: "Partiellement vrai, mais utilisé ici comme esquive cela refuse sa question. Elle demande parce qu'elle veut planifier — pour ses petits-enfants, ses affaires, le temps qui lui reste. L'esquive lui refuse cette capacité de planification.",
             ja: "一面では正しいですが、ここではぐらかしとして使えば、彼女の問いを退けることになります。彼女は計画したいから尋ねているのです — 孫のこと、身辺の整理、残された時間のために。はぐらかしはその計画する力を奪います。" } },
    { text: { en: "\"That is a really important question. Before I answer, can I ask — would you like a precise estimate, a rough range like 'months not years', or just the headline?\"",
              fr: "« C'est une question vraiment importante. Avant que je vous réponde, puis-je vous demander — préférez-vous une estimation précise, une fourchette comme « des mois plutôt que des années », ou juste l'essentiel ? »",
              ja: "「とても大切なご質問です。お答えする前に伺ってもよろしいですか — 具体的な見込み、『年単位ではなく月単位』のような大まかな範囲、それとも要点だけ、どれをお望みですか?」" },
      correct: true,
      why: { en: "This is SPIKES Invitation applied to prognosis: name that the question is important, check what KIND of answer she wants, then deliver at her chosen resolution. Studies of cancer-prognosis disclosure (Mack et al; the Japanese JSCO CST) show that calibrating the resolution to patient preference improves both understanding and emotional integration.",
             fr: "C'est l'étape « Invitation » de SPIKES appliquée au pronostic : nommer l'importance de la question, vérifier quel TYPE de réponse elle souhaite, puis répondre à la résolution qu'elle a choisie. Les études sur l'annonce du pronostic en oncologie (Mack et al ; CST de la JSCO) montrent que calibrer la résolution selon la préférence de la patiente améliore à la fois la compréhension et l'intégration émotionnelle.",
             ja: "これはSPIKESのInvitationを予後告知に応用したものです:質問の重要性を認め、どんな種類の答えを望むかを確認し、彼女が選んだ粒度で答える。予後告知の研究(Mackら;JSCO CST)は、患者の希望に粒度を合わせることが理解と感情的統合の双方を改善することを示しています。" } }
  ] }
```

**Edit 2 — Add the language-of-consultation prompt.** Insert into `prompts[]` of CASE_B (after current `prompts[5]`):

```js
{ en: "Compare France & Japan — language of the consultation: this case is being run by a French and a Japanese physician jointly. In what language do you break the news? If you (the doctor) are speaking a language that is not your strongest, do you tell the patient that? Caen and Nagoya: give a real example each of how language choice has shaped a breaking-bad-news consultation in your hospital.",
  fr: "Comparaison France-Japon — la langue de la consultation : cette consultation est menée conjointement par un médecin français et un médecin japonais. Dans quelle langue annoncez-vous la mauvaise nouvelle ? Si vous (le médecin) parlez une langue qui n'est pas votre langue la plus forte, le dites-vous à la patiente ? Caen et Nagoya : donnez chacun·e un exemple réel de la façon dont le choix de la langue a façonné une annonce dans votre hôpital.",
  ja: "フランスと日本の比較 — 診察に使う言語:この症例はフランス人医師と日本人医師が共同で担当しています。どの言語で告知しますか?もしあなた(医師)が自分の最も得意な言語ではない言語で話している場合、その事実を患者に伝えますか?Caen と名古屋:それぞれの病院で言語の選択が告知の場をどう形作ったか、実例を一つずつ挙げてください。" }
```

**Edit 3 — Add ECOG and ERCP nuance to the MDT step.** In `labs[4]` (the MDT/biopsy item), expand the answer text from `"... gemcitabine ± nab-paclitaxel; FOLFIRINOX considered too toxic given her age, performance status and albumin) ..."` to:

```js
"... gemcitabine ± nab-paclitaxel chosen over FOLFIRINOX given her ECOG performance status 1, age 75, and serum albumin 28 g/L (FOLFIRINOX would require ECOG 0-1 AND robust nutritional status — she does not meet the second criterion). Biliary stenting (ERCP) is being offered now for symptom relief from the obstructive jaundice (pruritus, prevention of cholangitis), independent of whether she chooses chemotherapy. Early palliative care referral and advance care planning offered alongside oncology, not after it. Estimated median survival 6-11 months with chemotherapy, 3-5 months without ..."
```

(Also, consider adding ERCP biliary stenting as a separate ordered `labs[]` item so students can choose to offer it before the disclosure conversation — currently it sits inside the MDT summary as a fait accompli.)

---

## Scenario 3 — Antibiotic stewardship (Mme Moreau)

### 1. Clinical accuracy

Strong. The vignette of viral pharyngitis (cough, coryza, low fever, no exudate, household contact with the same self-limiting illness) with a Centor/McIsaac of 0 is a clean pedagogical setup. Particularly strong choices:

- The patient is **post-tonsillectomy** (`history:4`, `exam:1`) — this elegantly removes the "tonsillar exudate" Centor point and means the McIsaac calculation has to be done thoughtfully rather than rotely. **Nice teaching design.**
- **Red-flag screen (`history:6`)** is correct and explicit: difficulty breathing, neck stiffness, severe unilateral throat pain, "hot-potato" voice, unable to swallow saliva, rash. These cover the key emergencies — **peritonsillar abscess, retropharyngeal abscess, epiglottitis (now rare but still teachable), Lemierre's syndrome, and scarlet fever/streptococcal rash**.
- **Lemierre's syndrome** is *named in the synthesis* (`labs[0]`, "no Lemierre-suggestive unilateral neck pain") — this is the kind of subtle teaching reference that wins respect from clinical educators. It's a once-in-a-career diagnosis but every Year-5 student should have heard the name.
- The **OCP + amoxicillin** background is implicitly in the case (she takes the combined OCP, `history:4`). It would be a missed opportunity not to surface this: amoxicillin and the combined OCP do NOT have a meaningful interaction (a long-debunked myth — the 2011 FSRH guidance and current BNF agree), but Year-4–6 students still hear conflicting things about it. A facilitator pocket card could note "no need to advise additional contraception."

**Minor clinical gaps:**
- **No infectious mononucleosis (EBV) screen.** The case correctly says blood tests are not indicated, but the differential of "pharyngitis with posterior cervical adenopathy in a young adult" includes EBV mononucleosis, which is **dangerous to give amoxicillin to** (~ 90% develop a morbilliform rash — the case does not mention this, despite the patient *being on the verge of getting amoxicillin*). This is a meaningful teaching gap. Even one line in the `labs[4]` (empirical amoxicillin) penalty text — "and if this had turned out to be EBV mono, she would now have a florid rash and an erroneous future 'penicillin allergy' label" — would close it.
- **No COVID-19 mention.** A 5-day pharyngitis with cough, coryza, low-grade fever, family contact with the same illness, in a working adult — in 2026, COVID-19 *and* respiratory-syncytial-virus and influenza all sit on this differential. The case never mentions any of them. The clinical management doesn't change (still no antibiotic, still symptomatic, still safety-net) — but pedagogically, in 2026, naming "this could be SARS-CoV-2, RSV, influenza, rhinovirus, adenovirus, or a parainfluenza" is part of being honest about what "viral pharyngitis" means. Add to synthesis text.

### 2. EBM grounding

The cited sources are strong and current:
- **HAS 2021** (Antibiothérapie par voie générale dans les infections respiratoires hautes — adulte et enfant) + **SPILF** — both real and correct.
- **NICE NG84** (sore throat: antimicrobial prescribing, 2018) — correct.
- **CDC "Be Antibiotics Aware"** — correct (this is the rebranded successor to the 2009-era "Get Smart" campaign).
- **Japan MHLW AMR National Action Plan 2023–2027** — correct, with the specific 50% respiratory-prescription cut target. **This is current.**
- **抗微生物薬適正使用加算 (Antimicrobial Stewardship Premium)** — correctly described as a 2018 fee-schedule revision that pays primary-care clinicians for *not* prescribing an antibiotic for an acute viral URI in a patient ≥ 6 months old, conditional on documented counselling. **This is correct as of the 2024 revision** (the premium has been adjusted in subsequent biennial fee-schedule revisions but the core mechanism is intact).

This is the **best EBM grounding of any of the three cases.** The Japanese policy detail in particular is the kind of thing a senior clinical educator would notice and respect — most simulations either ignore Japanese primary-care policy or get it wrong.

One refinement:
- The 2018 premium was modified in the **2022 and 2024** biennial reimbursement revisions — at present the relevant code is the **小児抗菌薬適正使用支援加算** (paediatric AMR-stewardship support fee) and the broader **外来感染対策向上加算** (outpatient infection-control fee). The case can keep the 2018-anchored framing for simplicity, but if anyone updates this in 2027 they should check the current fee-schedule code, not the original 2018 one.

### 3. Differential / hypothesis-building

Same gap as Scenario 1 — no explicit differential prompt. Students could benefit from a "name 3 things this could be" step (viral pharyngitis vs strep vs EBV mono vs early Lemierre's vs peritonsillar abscess). The current scaffolding lets the synthesis declare the diagnosis without an explicit hypothesis-test step.

### 4. Cultural fit

The patient is **French** (Mme Moreau, traveling to Frankfurt). The cross-cultural prompts are well-designed — particularly the Module B prompt comparing France's same-fee-regardless-of-prescription model with Japan's pay-for-not-prescribing model. This is one of the **sharpest health-policy comparisons** in any of the three cases.

One nuance worth surfacing in the facilitator notes: in 2026, French primary care has the **ROSP (Rémunération sur Objectifs de Santé Publique)** which *does* include antibiotic-prescribing targets — so the "France pays the same regardless" framing is slightly oversimplified. ROSP includes an indicator on antibiotic-prescribing rates which translates to (modest) per-GP variable income. Worth flagging so students from Caen don't get a misleadingly clean France/Japan contrast.

### 5. What's missing

- **EBV mono mention** (above).
- **COVID-19 / influenza / RSV mention** in 2026 framing (above).
- **No FeverPAIN score detail.** The case cites FeverPAIN but never tells students what FeverPAIN *is* (the 5-item NICE score: Fever in past 24h, Purulence, Attend rapidly within 3 days, severely Inflamed tonsils, No cough/coryza). Worth a one-line addition in the synthesis or in `exam[4]`.
- **No CRP point-of-care testing discussion.** Used widely in some European primary-care settings as an antibiotic-stewardship tool — and notably absent from Japanese / French primary care. Worth a prompt.
- **No mention of the OCP / amoxicillin myth** (above).

### 6. Top 3 specific edits for Scenario 3

**Edit 1 — EBV mention in the amoxicillin-penalty text.** In `PENALTIES_C.pen_amox.why` (lines ~1589-1614), add to the en/fr/ja paragraphs:

```
"... and contributes to community resistance — for an illness her body was already clearing on its own. SEPARATELY: had this turned out to be infectious mononucleosis (EBV pharyngitis is a common mimic of strep in young adults — posterior cervical adenopathy is a hint), she would now have a florid morbilliform rash from amoxicillin AND a probably-permanent 'penicillin-allergy' label, both entirely iatrogenic. 'It worked' is not the same as 'it was needed' — and 'it was harmless' is also not guaranteed."
```

**Edit 2 — Add COVID/RSV/flu to the synthesis text.** In `CASE_C.labs[0].a` (the synthesis), add to the existing first sentence:

```
"... is viral pharyngitis. In 2026, the relevant viruses are SARS-CoV-2 (often presents like this in vaccinated adults), influenza A/B (cough + coryza + sore throat in the right season), RSV (increasingly recognised in adults), and the everyday rhinovirus/adenovirus/parainfluenza family. The management is the same — no antibiotic, symptomatic care, safety-net — but naming the actual viruses is part of being honest with Mme Moreau about what 'just a virus' actually means."
```

**Edit 3 — Add the OCP / amoxicillin facilitator note.** This is best placed as a small `cite`-style annotation on `history:4` or as a standalone discussion prompt:

```js
{ en: "Side-conversation worth having: Mme Moreau is on the combined oral contraceptive pill. Many patients (and some clinicians) still believe amoxicillin reduces COCP efficacy. Caen and Nagoya: what does current guidance actually say in your country, and how do you handle the patient who arrives already convinced?",
  fr: "Conversation parallèle utile : Mme Moreau prend une pilule œstroprogestative. Beaucoup de patients (et certains cliniciens) croient encore que l'amoxicilline réduit l'efficacité de la pilule. Caen et Nagoya : que disent réellement les recommandations actuelles dans votre pays, et comment gérez-vous la patiente déjà convaincue ?",
  ja: "話題にする価値のある脇道:Mme Moreau は混合経口避妊薬を服用しています。アモキシシリンが避妊薬の効果を下げると今でも信じている患者(そして一部の医師)が多くいます。Caen と名古屋:現行のガイドラインは実際に何と述べていますか、そしてすでに信じ込んでいる患者をどう扱いますか?" }
```

(The current evidence — FSRH, BNF, CDC — is that **non-enzyme-inducing antibiotics including amoxicillin do NOT reduce COCP efficacy**; the historical advice to use additional contraception has been formally withdrawn for years but persists in patient lore.)

---

## Cross-cutting observations

### What the cases do unusually well
1. **Wrong-move pedagogy is exemplary.** The deliberately-wrong items (`history:8/9`, `exam:5/6`, etc.) with narrated "what just happened" stage directions and explicit point deductions are the right way to teach hard skills. Most simulation platforms either hide bad choices or punish silently. These do neither.
2. **Bilingual rendering is genuine.** The `{ en, fr, ja }` triplets are not Google-Translate placeholders — the Japanese in particular reads naturally (e.g. 田中さん, 馬尾症候群, 抗微生物薬適正使用加算, 人生会議). Worth crediting whoever translated this.
3. **Synthesis-as-gate** (`labs[0].key:true` + `synthPrereqs`) is the right structural move — students cannot unlock the discussion until they have done the right red-flag screens.
4. **The PBL 7-jump scaffold note** in the `dec_plan` comment (lines 563-569) shows the design team thought hard about the difference between "pattern-match-and-anchor" and genuine hypothesis-driven reasoning. The `unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 }` gate is a direct architectural answer to that concern.

### What is consistently missing across all 3 cases
1. **No facilitator pocket cards.** The educator running a Caen or Nagoya room has to derive their teaching script from the inline JS comments. A separate `facilitator-notes.md` per scenario — even 200 words per case — would multiply the value of these cases.
2. **No explicit differential-step prompt.** All three cases let the synthesis declare the diagnosis without an intermediate "name your top 3 hypotheses" step. For Year-4–6 students this is the biggest single hypothesis-generation skill, and it's the step the platform's `hypotheses:1` gate is trying to enforce — but there's no in-case prompt to model what a hypothesis-list looks like.
3. **No MDT/MDM discussion** in cases 1 and 3. Scenario 2 has a real MDT/RCP step; scenarios 1 and 3 don't, even though both involve referral pathways that in real practice involve a primary-care + specialist conversation. For pain management (1), a real consultation might involve physiotherapy, primary care, and chronic-pain MDT; for AMR (3), a real conversation might involve pharmacist-led stewardship. Worth one prompt each.
4. **Safety-netting is verbal but never quantified.** All three cases include safety-net prompts but none give the student a specific "if X happens within Y days, come back" formulation. Naming **exactly what** to tell the patient — e.g. "fever > 38.5 °C beyond day 7, can't swallow saliva, unilateral severe pain, breathing difficulty" — is the EBM gold standard. Scenario 3's synthesis does this best; Scenarios 1 and 2 are vaguer.
5. **No reflection prompt on "what did this case teach you about your own bias."** All three cases address cross-cultural difference well, but none ask the student to reflect on their own initial reaction — "When the patient asked for oxycodone, what was your first instinct, and where did that instinct come from?" This is metacognition, not clinical content, but for Year-4–6 students it's the most durable learning.

### Pre/post-test coverage
- Scenario 1 ships with a 5+5 question MCQ bank — well-written, current, with explanations that cite NICE NG59 / HAS / JOA / CDC. The questions are appropriately difficult and the distractors (e.g. "Order a CT scan instead — lower cost") are plausible-wrong, which is good MCQ writing.
- Scenarios 2 and 3 **have no pre/post tests** (the file flags this as known follow-up at line 1894). For a workshop that uses the same engine across three different sessions, this is an asymmetry worth closing — even 3 questions per scenario would let educators measure learning gain.

---

## Severity-coded summary

| # | Issue | Severity | Scenario | Fix effort |
|---|---|---|---|---|
| 1 | No axSpA / inflammatory back-pain screen in chronic LBP case | **HIGH** | 1 | 10 min (1 history item) |
| 2 | HAS citation conflates 2019 LBP and 2024 opioid documents | MEDIUM | 1 | 5 min (header comment) |
| 3 | No EBV-mono mention given amoxicillin is on the table | **HIGH** | 3 | 5 min (add to penalty text) |
| 4 | No COVID/flu/RSV mention in 2026 viral-pharyngitis case | MEDIUM | 3 | 5 min (synthesis text) |
| 5 | No explicit differential prompt in any case | MEDIUM | 1, 2, 3 | 15 min (3 prompts) |
| 6 | No facilitator pocket cards | MEDIUM | all | half-day per scenario |
| 7 | Pre/post tests missing for scenarios 2 and 3 | MEDIUM | 2, 3 | ~1 day per scenario |
| 8 | Vague safety-net specifics in scenarios 1 and 2 | LOW | 1, 2 | 10 min per scenario |
| 9 | No prognosis-disclosure step in breaking-bad-news | MEDIUM | 2 | 30 min (one DECISIONS_B item) |
| 10 | No OCP / amoxicillin myth note in stewardship case | LOW | 3 | 10 min (one prompt) |

**Total estimated effort to address high-severity items only: ~30 minutes of editing across two files.**

The three high-severity items (axSpA screen, EBV mention, and — depending on
how strict you want to be — the differential prompt) are clinically meaningful
and should be addressed before the next Caen × Nagoya session. Everything else
is high-value polish that can roll in over the next several sessions without
changing the platform structure.

---

*End of Round 2 clinical / EBM review. Reviewer: senior clinical educator
agent; files reviewed: `case-content.js` (2,241 lines), `platform-config.js`,
`README.md`. Output saved per task spec to `C:/cnm-pp/sim-output/round2-clinical-ebm.md`.*
