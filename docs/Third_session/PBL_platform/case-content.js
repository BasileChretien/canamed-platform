/* CaNaMED Session 3 - Module A clinical case content.
 *
 * This file is intentionally separate from script.js so that medical educators
 * can edit the case WITHOUT touching the application logic. Edit the text below
 * freely; keep the structure (history / exam / labs / prompts arrays, and the
 * { q, a } shape) intact.
 *
 *   history[] / exam[] / labs[]  - each item is { q: "button label", a: "result text" }
 *   labs[0] has  key: true       - it is the gated "synthesis" item; revealing it
 *                                  unlocks the discussion prompts
 *   prompts[]                    - the discussion questions shown once unlocked
 *
 * --- TRANSLATABLE-CONTENT CONVENTION ({ en, fr, ja }) -----------------------
 * Every user-facing string below is wrapped as a small translation object:
 *     { en: "...", fr: "...", ja: "..." }
 * The runtime renders the active language via lib.js's `tc(value, lang)`
 * accessor (script.js calls `tc(value, getLang())`). Rules of thumb for
 * editors:
 *   - Keep the same KEYS in every object (en, fr, ja). The runtime falls
 *     back to en when fr or ja is "" (empty), so a partial translation is
 *     safe — the English is always the canonical source.
 *   - A PLAIN STRING is still accepted by tc() (back-compat for legacy or
 *     custom-JSON scenarios). New content should use the wrap.
 *   - The SCORING families' `any` stem arrays stay ENGLISH ONLY — they are
 *     matched against the (English) text typed by students into the
 *     answers box, not displayed. Only the `label` of each family is
 *     wrapped for translation.
 *   - The `id` fields stay plain strings — they are database keys.
 * Long free-text (the `.a` answer paragraphs and the `.why` deduction
 * explanations) may ship with empty "" stubs in fr/ja during a structural
 * refactor; that is fine — the English shows through tc()'s fallback until
 * a translator pass fills them in.
 * ---------------------------------------------------------------------------
 *
 * IMPORTANT: script.js hard-codes two item references against these arrays:
 *   SYNTH_ID      = "labs:0"                              (the synthesis item)
 *   SYNTH_PREREQS = ["history:1","history:2","exam:3"]    (red-flag + cauda
 *                   equina screens + leg neuro exam must be done first)
 * If you re-order history/exam items, update SYNTH_PREREQS in script.js to match.
 *
 * Loaded BEFORE script.js (see the <script> order in index.html), so `CASE` is
 * available as a global there.
 *
 * Clinical content reviewed against current guidance (Round-2 clinical/EBM
 * audit 2026-05-20):
 *   - France: HAS 2019 ("Prise en charge du patient présentant une lombalgie
 *     commune") + HAS 2024 ("Pertinence et bon usage des antalgiques
 *     opioïdes") + ANSM 2024 opioid surveillance report.
 *   - Japan:  JOA 2019 (low-back pain) + JSPC 2021 (chronic pain).
 *   - UK:     NICE NG59 (2016, upd. 2020 — low-back pain & sciatica) +
 *             NICE NG65 (axial spondyloarthritis) + NICE NG193 (2021 —
 *             chronic primary pain).
 *   - USA:    ACP 2017 (non-invasive Rx of LBP) + CDC 2022 (opioids for
 *             pain, supersedes 2016).
 *   - Breaking bad news: SPIKES (Baile et al, Oncologist 2000), Loi
 *     Kouchner 2002, HAS 2008 (annonce), MHLW 2018 (人生会議).
 *   - Pharyngitis stewardship: McIsaac/Centor, NICE NG84, MHLW AMR
 *     Action Plan 2023–2027, HAS 2021 (antibiothérapie).
 */
/* Node/test shim: this file is authored for the browser and assigns scenario
   registries onto `window` near the bottom. When loaded under Node (e.g. the
   static-assertion tests, or `node -e "require(...)"`), `window` does not
   exist, so define a harmless stand-in. In the browser this branch never runs
   because `window` is already defined — so browser behaviour is unchanged. */
if (typeof window === "undefined") { var window = globalThis; }

/* `var` (not `const`) so applyScenario() in script.js can swap the data when a
   facilitator picks a different scenario at session-creation time. `var` at
   top-level binds to `window.CASE` etc., so writing `window.CASE = ...` is
   equivalent to reassigning the variable here. The default value below is the
   first scenario in the SCENARIOS registry at the bottom of this file. */
var CASE = {
  history: [
    { q: { en: "Tell me about your back pain.",
           fr: "Parlez-moi de votre douleur lombaire.",
           ja: "腰の痛みについて教えてください。" },
      a: { en: "It's been about 8 months now, low down in my back. Worse after sitting at my desk all day, eases when I move around or lie down. It doesn't shoot anywhere - it just stays in my back.",
           fr: "Ça dure depuis environ 8 mois maintenant, en bas du dos. C'est pire après être resté assis à mon bureau toute la journée, ça se calme quand je bouge ou que je m'allonge. Ça n'irradie nulle part — ça reste juste dans le dos.",
           ja: "もう8か月くらいになります、腰の下のほうです。一日中デスクに座っていると悪化して、動いたり横になったりすると楽になります。どこかに放散することはなくて、ただ腰にとどまっています。" } },
    { q: { en: "Screen for serious causes: weight loss, fever, night sweats, cancer history, pain at rest or at night, recent significant trauma, steroid use, IV drug use?",
           fr: "Dépister les causes graves : perte de poids, fièvre, sueurs nocturnes, antécédents de cancer, douleur au repos ou la nuit, traumatisme récent significatif, prise de corticoïdes, usage de drogues injectables ?",
           ja: "重篤な原因のスクリーニング:体重減少、発熱、寝汗、がんの既往、安静時または夜間の痛み、最近の重大な外傷、ステロイド使用、静注薬物使用はありますか?" },
      a: { en: "No unexplained weight loss, no fevers or night sweats. I've never had cancer. The pain doesn't wake me from sleep and isn't worse lying down - if anything lying down helps. No recent injury or accident. I've never taken steroids and I don't use injected drugs.",
           fr: "Pas de perte de poids inexpliquée, pas de fièvre ni de sueurs nocturnes. Je n'ai jamais eu de cancer. La douleur ne me réveille pas la nuit et ne s'aggrave pas en position allongée — au contraire, m'allonger me soulage plutôt. Pas de blessure ni d'accident récent. Je n'ai jamais pris de corticoïdes et je ne consomme pas de drogues injectables.",
           ja: "原因不明の体重減少はありません、発熱や寝汗もありません。がんになったこともありません。痛みで夜中に目が覚めることはなく、横になっても悪化しません — むしろ横になると楽になるくらいです。最近のけがや事故もありません。ステロイドを使ったこともなく、注射の薬物も使っていません。" },
      cite: { en: "NICE NG59 (2016, upd. 2020) — red-flag screen",
              fr: "HAS 2019 / NICE NG59 — drapeaux rouges",
              ja: "NICE NG59 — レッドフラッグ" } },
    { q: { en: "Cauda equina screen: any numbness in the saddle or groin area, difficulty passing or controlling urine, loss of bowel control, or new sexual dysfunction?",
           fr: "Dépistage du syndrome de la queue de cheval : engourdissement en selle ou au niveau de l'aine, difficulté à uriner ou à contrôler la miction, perte de contrôle des selles, ou trouble sexuel récent ?",
           ja: "馬尾症候群のスクリーニング:鞍状部または鼠径部のしびれ、排尿困難・尿失禁、便失禁、新たな性機能障害はありますか?" },
      a: { en: "No - no numbness around the saddle area, no problems starting or controlling my urine, my bowels are normal, nothing like that.",
           fr: "Non — pas d'engourdissement au niveau de la selle, pas de difficulté à amorcer ou contrôler la miction, mon transit est normal, rien de tout cela.",
           ja: "いいえ — 鞍状部のしびれもなく、排尿の出始めやコントロールに問題もなく、お通じも正常です、そういったことは何もありません。" },
      cite: { en: "RCSEng 2023 — cauda equina red flags",
              fr: "RCSEng 2023 — drapeaux rouges queue de cheval",
              ja: "RCSEng 2023 — 馬尾症候群レッドフラッグ" } },
    { q: { en: "Any leg weakness, numbness, or pain shooting down the leg past the knee?",
           fr: "Faiblesse, engourdissement, ou douleur irradiant dans la jambe au-delà du genou ?",
           ja: "下肢の筋力低下、しびれ、または膝より下に放散する痛みはありますか?" },
      a: { en: "No - my legs feel completely normal. No weakness, no pins and needles. The pain stays in my back.",
           fr: "Non — mes jambes sont tout à fait normales. Pas de faiblesse, pas de fourmillements. La douleur reste dans le dos.",
           ja: "いいえ — 脚はまったく普通の感覚です。筋力低下もしびれもありません。痛みは腰にとどまっています。" } },
    { q: { en: "What have you already tried?",
           fr: "Qu'avez-vous déjà essayé ?",
           ja: "これまでに何を試されましたか?" },
      a: { en: "Paracetamol does nothing. Ibuprofen helped a bit for a couple of weeks. I started physiotherapy but stopped after two sessions - it wasn't working fast enough.",
           fr: "Le paracétamol ne fait rien. L'ibuprofène m'a un peu soulagé pendant quelques semaines. J'ai commencé la kinésithérapie mais j'ai arrêté après deux séances — ça n'allait pas assez vite.",
           ja: "アセトアミノフェンは何も効きません。イブプロフェンは2週間ほど少し効きました。理学療法も始めましたが、2回で中断しました — 効果が出るのが遅すぎたので。" } },
    { q: { en: "How is it affecting your daily life and your mood?",
           fr: "Quel est l'impact sur votre vie quotidienne et votre moral ?",
           ja: "日常生活や気分にどのような影響がありますか?" },
      a: { en: "I'm frustrated, and honestly a bit low about it. I keep worrying it's something serious that's being missed. I've stopped going to the gym and I've cut right down on walking - I'm scared that moving the wrong way will damage my back. My sleep is broken because I'm uncomfortable and because I lie there worrying about it.",
           fr: "Je suis frustré, et honnêtement un peu déprimé à cause de ça. Je n'arrête pas de m'inquiéter que ce soit quelque chose de grave qu'on est en train de passer à côté. J'ai arrêté la salle de sport et j'ai beaucoup réduit la marche — j'ai peur qu'un mauvais mouvement n'abîme mon dos. Mon sommeil est haché parce que je suis mal installé et parce que je reste allongé à ruminer.",
           ja: "もどかしくて、正直少し気分も落ち込んでいます。何か重大なものを見落とされているのではないかと心配ばかりしてしまいます。ジムにも行かなくなり、歩くのも大幅に減らしました — 動き方を間違えて腰を傷めるのが怖いんです。痛みで寝つきが悪く、横になっても心配で考え込んでしまうので、睡眠も切れ切れです。" } },
    { q: { en: "Why do you want oxycodone specifically?",
           fr: "Pourquoi demandez-vous spécifiquement de l'oxycodone ?",
           ja: "なぜ特にオキシコドンを希望されるのですか?" },
      a: { en: "A friend abroad got oxycodone and was back to normal within days. I looked it up - it's a proper strong painkiller. I feel like my doctors here are under-treating me because of some rule about opioids.",
           fr: "Un ami à l'étranger a eu de l'oxycodone et il était de nouveau sur pied en quelques jours. Je me suis renseigné — c'est un vrai antalgique puissant. J'ai l'impression que mes médecins ici me sous-traitent à cause d'une espèce de règle sur les opioïdes.",
           ja: "海外の友人がオキシコドンを処方されて、数日で元通りになったんです。調べてみました — ちゃんとした強い鎮痛薬です。こちらの先生方は、オピオイドに関する何かの規則のせいで、私を過少治療しているように感じます。" } },
    { q: { en: "Any other medical problems, regular medication, alcohol or substance use?",
           fr: "Autres antécédents médicaux, traitements habituels, consommation d'alcool ou de substances ?",
           ja: "他の既往歴、常用薬、アルコール・薬物の使用はありますか?" },
      a: { en: "Otherwise healthy, no regular medication. A glass of wine at the weekend, no smoking, no recreational drugs. My father had a problem with alcohol years ago, but I don't.",
           fr: "Sinon je suis en bonne santé, pas de traitement habituel. Un verre de vin le week-end, je ne fume pas, pas de drogues récréatives. Mon père a eu un problème avec l'alcool il y a des années, mais pas moi.",
           ja: "それ以外は健康で、常用薬はありません。週末にワインを一杯、喫煙はせず、嗜好性の薬物もありません。父親は何年も前にアルコールの問題を抱えていましたが、私はそうではありません。" } },
    /* --- Round-2 clinical-EBM review (2026-05-20): inserted an explicit
       inflammatory back-pain / axial-spondyloarthritis (axSpA) screen.
       A 45-year-old with 8 months of low-back pain is squarely in the axSpA
       age window; before the new item the case let students "rule out"
       axSpA in the synthesis without ever doing the screen. */
    { q: { en: "Inflammatory back-pain screen: morning back stiffness lasting more than 30 minutes, alternating buttock pain, pain that IMPROVES with movement and is worse after rest, age < 45 at onset, family history of psoriasis, inflammatory bowel disease, or uveitis?",
           fr: "Dépistage de la lombalgie inflammatoire : raideur matinale du dos > 30 min, douleur fessière alternante, douleur AMÉLIORÉE par le mouvement et aggravée par le repos, début avant 45 ans, antécédents familiaux de psoriasis, MICI ou uvéite ?",
           ja: "炎症性腰痛のスクリーニング:30分以上続く朝のこわばり、左右交代性の臀部痛、運動で改善し安静で悪化する痛み、45歳未満での発症、乾癬・炎症性腸疾患・ぶどう膜炎の家族歴は?" },
      a: { en: "No morning stiffness — when I get up I'm just sore, not stiff, and it loosens up within a few minutes. No buttock pain. Movement actually doesn't help much; in fact resting helps more. No psoriasis, no IBD, no eye problems in me or my family.",
           fr: "Pas de raideur matinale — au lever je suis juste douloureux, pas raide, et ça se délie en quelques minutes. Pas de douleur fessière. Le mouvement n'aide pas vraiment ; le repos m'aide plutôt plus. Pas de psoriasis, pas de MICI, pas de problème oculaire chez moi ou ma famille.",
           ja: "朝のこわばりはなく — 起床時はただ痛いだけで、数分で楽になります。臀部痛もありません。動いてもあまり楽にならず、むしろ休んだほうが楽です。本人にも家族にも乾癬、炎症性腸疾患、眼の病気はありません。" },
      cite: { en: "ASAS / NICE NG65 — axial spondyloarthritis red flags",
              fr: "ASAS / HAS — spondyloarthrite axiale",
              ja: "ASAS / 日本リウマチ学会 — 軸性脊椎関節炎" } },
    /* --- the following two are deliberately POOR opening moves; the platform
       deducts points for them, with an explanation on screen. They are kept here
       (rather than hidden) so a real choice is offered - students should be able
       to make a mistake and learn from it. Indices are 9 and 10 (shifted +1
       after the axSpA insert above); PENALTIES below already references the
       new indices. */
    { q: { en: "So, shall I write the oxycodone now — tablets or patches?",
           fr: "Alors, je vous prescris l'oxycodone tout de suite — comprimés ou patchs ?",
           ja: "では、オキシコドンを今すぐ処方しましょうか — 錠剤と貼付剤、どちらにしますか?" },
      a: { en: "He looks startled but pleased: \"Tablets, I suppose - thank you, doctor.\" (You have just promised a strong opioid before assessing his pain, screening red flags or agreeing a plan with him - and you have made the rest of the consultation about confirming that promise, not exploring the request.)",
           fr: "Il a l'air surpris mais content : « Des comprimés, je suppose — merci, docteur. » (Vous venez de promettre un opioïde fort avant d'avoir évalué la douleur, dépisté les drapeaux rouges ou élaboré un plan partagé avec lui — et vous avez fait du reste de la consultation la confirmation de cette promesse, plutôt que l'exploration de la demande.)",
           ja: "彼は驚きながらも嬉しそうな表情で言います:「錠剤で、お願いします — ありがとうございます、先生。」(あなたは痛みの評価も、レッドフラッグのスクリーニングも、共有された計画づくりも行わないまま、強オピオイドを約束してしまいました — そして残りの診察は、要望を掘り下げるのではなく、その約束を確認するだけのものになってしまいました。)" } },
    { q: { en: "Are you sure the pain is really that bad? Could it just be stress, or in your head?",
           fr: "Êtes-vous sûr que la douleur est vraiment si forte ? Ne serait-ce pas du stress, ou dans votre tête ?",
           ja: "本当にそこまで痛みがひどいのですか?ストレスや気のせいではありませんか?" },
      a: { en: "His face hardens. \"So you don't believe me either. Everyone keeps saying that. That is exactly why I want a real painkiller.\" (The consultation has just lost its therapeutic alliance: he is now defending the reality of his pain instead of working with you. Suggesting pain is imagined or 'just stress' is dismissive, not a screen for psychological factors.)",
           fr: "Son visage se ferme. « Alors vous non plus vous ne me croyez pas. Tout le monde n'arrête pas de dire ça. C'est exactement pour ça que je veux un vrai antalgique. » (La consultation vient de perdre son alliance thérapeutique : il défend désormais la réalité de sa douleur au lieu de travailler avec vous. Suggérer que la douleur est imaginaire ou « juste du stress » est dévalorisant, ce n'est pas un dépistage des facteurs psychologiques.)",
           ja: "彼の表情がこわばります。「先生も私の言うことを信じてくれないんですね。みんな同じことを言うんです。だからこそ、ちゃんとした鎮痛薬が欲しいんですよ。」(診察はたった今、治療同盟を失いました:彼はあなたと協力するのではなく、自分の痛みの現実性を守ろうとしています。痛みが「気のせい」や「ただのストレス」だと示唆することは、相手を軽視する態度であり、心理社会的因子のスクリーニングにはなりません。)" } }
  ],
  exam: [
    { q: { en: "General observation and gait",
           fr: "Observation générale et démarche",
           ja: "全身観察と歩行" },
      a: { en: "Comfortable at rest, walks normally - including on heels and toes. Moves stiffly and cautiously when changing position.",
           fr: "Confortable au repos, marche normalement — y compris sur les talons et la pointe des pieds. Se mobilise de façon raide et prudente lors des changements de position.",
           ja: "安静時は楽そうで、歩行は正常 — 踵歩き・つま先歩きも問題ありません。体位変換時は固く慎重な動きをします。" } },
    { q: { en: "Spine inspection and palpation",
           fr: "Inspection et palpation du rachis",
           ja: "脊椎の視診と触診" },
      a: { en: "No deformity, no spinal step, no overlying redness or swelling. Diffuse tenderness over the paraspinal muscles; no midline bony tenderness.",
           fr: "Pas de déformation, pas de marche d'escalier rachidienne, pas de rougeur ni de tuméfaction en regard. Sensibilité diffuse des muscles paravertébraux ; pas de douleur osseuse médiane.",
           ja: "変形なし、脊椎の段差なし、表面の発赤や腫脹もありません。傍脊柱筋にびまん性の圧痛あり;正中の骨性圧痛はありません。" } },
    { q: { en: "Lumbar range of movement",
           fr: "Amplitude des mouvements lombaires",
           ja: "腰椎の可動域" },
      a: { en: "Lumbar flexion is reduced and limited by pain; extension and lateral flexion are preserved. The pain does not clearly improve once he has been moving for a while.",
           fr: "La flexion lombaire est réduite et limitée par la douleur ; l'extension et les inclinaisons latérales sont conservées. La douleur ne s'améliore pas nettement après quelques minutes de mobilisation.",
           ja: "腰椎の前屈は疼痛のため低下・制限されています;伸展と側屈は保たれています。しばらく動いていても痛みは明らかに改善しません。" } },
    { q: { en: "Neurological examination of the legs",
           fr: "Examen neurologique des membres inférieurs",
           ja: "下肢の神経学的診察" },
      a: { en: "Normal power, sensation and reflexes throughout. Straight-leg raise is negative on both sides.",
           fr: "Force, sensibilité et réflexes normaux partout. Le signe de Lasègue est négatif des deux côtés.",
           ja: "全体に筋力・感覚・反射は正常。下肢伸展挙上テスト(SLR)は両側とも陰性です。" } },
    { q: { en: "Hip examination and sacroiliac joint (FABER) test",
           fr: "Examen des hanches et test sacro-iliaque (FABER)",
           ja: "股関節の診察と仙腸関節 (FABER) テスト" },
      a: { en: "Hip range of movement is full and pain-free. FABER (Patrick's) test does not reproduce his pain, and there is no sacroiliac joint tenderness. (Hip and sacroiliac problems are common mimics of \"low-back pain\".)",
           fr: "Amplitude des hanches complète et indolore. Le test FABER (de Patrick) ne reproduit pas sa douleur, et il n'y a pas de douleur des articulations sacro-iliaques. (Les pathologies de hanche et sacro-iliaques sont des causes fréquentes confondues avec une « lombalgie ».)",
           ja: "股関節の可動域は全可動域で疼痛もありません。FABER (パトリック) テストでは彼の痛みは再現されず、仙腸関節の圧痛もありません。(股関節および仙腸関節の病変は「腰痛」と誤認されやすい代表的な疾患です。)" } },
    /* --- the following two are deliberately POOR examination choices; the
       platform deducts points for them. Indices 5 and 6 - referenced by
       PENALTIES below. */
    { q: { en: "Digital rectal examination (DRE) — assess anal tone",
           fr: "Toucher rectal (TR) — évaluer le tonus anal",
           ja: "直腸指診 (DRE) — 肛門括約筋の緊張を評価" },
      a: { en: "Anal tone is normal. Mr Lefebvre is visibly uncomfortable that this was done. (A digital rectal examination is only indicated when cauda equina is suspected — saddle anaesthesia, urinary retention or bowel symptoms. With NONE of those, performing an intimate examination is intrusive, undignified and adds no useful information.)",
           fr: "Le tonus anal est normal. M. Lefebvre est visiblement gêné qu'on lui ait fait ce geste. (Le toucher rectal n'est indiqué qu'en cas de suspicion de syndrome de la queue de cheval — anesthésie en selle, rétention urinaire ou troubles du transit. En l'absence TOTALE de ces signes, réaliser un examen intime est intrusif, indigne et n'apporte aucune information utile.)",
           ja: "肛門括約筋の緊張は正常です。M. Lefebvre はこの診察を行われたことに明らかに困惑しています。(直腸指診は、馬尾症候群が疑われる場合 — 鞍状部知覚異常、尿閉、または便通障害 — に限って適応となります。これらが一つもない状態で内密的な診察を行うことは、侵襲的で患者の尊厳を損ない、何ら有用な情報をもたらしません。)" } },
    { q: { en: "Full cardiovascular and respiratory examination",
           fr: "Examen cardio-vasculaire et respiratoire complet",
           ja: "心血管系および呼吸器系の完全な診察" },
      a: { en: "Heart sounds normal, no murmur, chest clear, no peripheral oedema. (There is nothing in the history pointing to cardiac or respiratory disease and this has cost the consultation 5 minutes. A focused examination is not the same as a scattergun examination — the latter signals to the patient that you are searching at random.)",
           fr: "Bruits du cœur normaux, pas de souffle, auscultation pulmonaire claire, pas d'œdème périphérique. (Rien dans l'anamnèse n'oriente vers une pathologie cardiaque ou respiratoire et cela a coûté 5 minutes à la consultation. Un examen ciblé n'est pas la même chose qu'un examen au hasard — ce dernier signale au patient que vous cherchez à l'aveugle.)",
           ja: "心音は正常、雑音なし、呼吸音清明、末梢浮腫なし。(病歴には心疾患や呼吸器疾患を示唆する所見はなく、この診察に5分を費やしてしまいました。焦点を絞った診察と網羅的な「手当たり次第」の診察は別物です — 後者は、医師が当てずっぽうに探している印象を患者に与えてしまいます。)" } }
  ],
  labs: [
    { q: { en: "Clinical synthesis and red-flag review  (unlocks the discussion prompts)",
           fr: "Synthèse clinique et revue des drapeaux rouges  (débloque les questions de discussion)",
           ja: "臨床的総合判断とレッドフラッグの確認  (ディスカッション課題を解除)" },
      key: true,
      a: { en: "You have taken a focused history, screened the red-flag categories and examined the legs, spine and hips - all reassuring. There are NO red flags for cauda equina, malignancy, infection, fracture or inflammatory (axial spondyloarthritis) disease, and the neurological exam is normal with negative straight-leg raise, so this is NOT radicular pain. With 8 months of mechanical-pattern, non-radiating pain and a normal exam, this fits chronic non-specific (mechanical) low-back pain. Note also the yellow flags: fear of movement, activity avoidance, worry that something is being missed, low mood and disturbed sleep - these predict chronicity and are what your management plan must target. Before you open the discussion prompts, decide together as a group: does this picture justify an MRI, and how will you respond to the oxycodone request? Then work through the prompts below.",
           fr: "Vous avez mené un interrogatoire ciblé, dépisté les catégories de drapeaux rouges et examiné les membres inférieurs, le rachis et les hanches — l'ensemble est rassurant. Il n'y a AUCUN drapeau rouge en faveur d'un syndrome de la queue de cheval, d'une néoplasie, d'une infection, d'une fracture ou d'une pathologie inflammatoire (spondyloarthrite axiale), et l'examen neurologique est normal avec un signe de Lasègue négatif, donc il ne s'agit PAS d'une douleur radiculaire. Avec 8 mois de douleur de type mécanique, non irradiante, et un examen normal, le tableau correspond à une lombalgie chronique non spécifique (mécanique). Notez aussi les drapeaux jaunes : peur du mouvement, évitement de l'activité, inquiétude qu'on lui passe à côté de quelque chose, humeur basse et sommeil perturbé — ces éléments prédisent la chronicisation et constituent les cibles de votre plan de prise en charge. Avant d'ouvrir les questions de discussion, décidez ensemble en groupe : ce tableau justifie-t-il une IRM, et comment allez-vous répondre à la demande d'oxycodone ? Puis traitez les questions ci-dessous.",
           ja: "焦点を絞った病歴聴取を行い、レッドフラッグの各カテゴリーをスクリーニングし、下肢・脊椎・股関節を診察した — いずれも安心できる所見である。馬尾症候群、悪性腫瘍、感染、骨折、炎症性疾患 (軸性脊椎関節炎) を示唆するレッドフラッグは一つもなく、神経学的所見も正常で下肢伸展挙上テストも陰性であるため、本症例は神経根性疼痛ではない。8か月続く機械的パターンで放散しない疼痛と正常な診察所見は、慢性非特異的 (機械的) 腰痛に合致する。さらにイエローフラッグにも注目すべきである:運動恐怖、活動回避、見落とされているのではないかという不安、抑うつ気分、睡眠障害 — これらは慢性化を予測する因子であり、治療計画が標的とすべきものである。ディスカッション課題を開く前に、グループで一緒に決めましょう:この所見はMRIを正当化するか、そしてオキシコドンの要望にどう応えるか?その後、下記の課題に取り組んでください。" } },
    { q: { en: "Lumbar spine MRI",
           fr: "IRM du rachis lombaire",
           ja: "腰椎MRI" },
      a: { en: "Mild age-related degenerative disc changes only; no disc herniation, no nerve-root compression, no fracture, no sinister features. (Note: MRI is NOT indicated here - no red flags, no radicular signs. Imaging without an indication commonly shows age-related changes that are not the cause of the pain and can increase worry, further tests and disability.)",
           fr: "Discopathie dégénérative modérée liée à l'âge uniquement ; pas de hernie discale, pas de compression radiculaire, pas de fracture, aucun signe inquiétant. (Note : l'IRM N'est PAS indiquée ici — pas de drapeau rouge, pas de signe radiculaire. L'imagerie sans indication révèle souvent des modifications liées à l'âge qui ne sont pas la cause de la douleur et peut aggraver l'inquiétude, multiplier les examens et accroître l'incapacité.)",
           ja: "加齢に伴う軽度の椎間板変性のみ;椎間板ヘルニアなし、神経根圧迫なし、骨折なし、悪性を示唆する所見もなし。(注:本症例ではMRIは適応ではない — レッドフラッグも神経根症状もないため。適応のない画像検査は、しばしば疼痛の原因ではない加齢性変化を見つけてしまい、不安・追加検査・能力障害をかえって増大させ得る。)" } },
    { q: { en: "Plain lumbar spine X-ray",
           fr: "Radiographie standard du rachis lombaire",
           ja: "腰椎単純X線" },
      a: { en: "Mild degenerative changes consistent with age; no fracture. (Note: not indicated here - X-ray adds radiation, cannot show the discs or nerves, and has no role in non-specific low-back pain without a specific fracture concern.)",
           fr: "Modifications dégénératives modérées compatibles avec l'âge ; pas de fracture. (Note : non indiquée ici — la radiographie expose à des rayonnements, ne montre ni les disques ni les nerfs, et n'a pas de place dans la lombalgie non spécifique en l'absence d'une suspicion spécifique de fracture.)",
           ja: "年齢相応の軽度の変性変化;骨折なし。(注:本症例では適応なし — レントゲンは被ばくを伴い、椎間板や神経は描出できず、骨折を特に疑う根拠がない非特異的腰痛では役割がない。)" } },
    { q: { en: "Blood tests (only if a red flag is present)",
           fr: "Bilan sanguin (uniquement si drapeau rouge présent)",
           ja: "血液検査 (レッドフラッグがある場合のみ)" },
      a: { en: "Full blood count, ESR/CRP and calcium all within normal limits. (Note: bloods are not routine in non-specific low-back pain - they are useful only when a red flag raises suspicion of infection, malignancy or inflammatory disease, e.g. ESR/CRP if you suspect infection or axial spondyloarthritis.)",
           fr: "Numération formule sanguine, VS/CRP et calcémie tous dans les limites de la normale. (Note : le bilan sanguin n'est pas systématique dans la lombalgie non spécifique — il n'est utile que lorsqu'un drapeau rouge fait suspecter une infection, une néoplasie ou une pathologie inflammatoire, par exemple VS/CRP en cas de suspicion d'infection ou de spondyloarthrite axiale.)",
           ja: "全血球計算、赤沈/CRP、カルシウムはすべて正常範囲内。(注:非特異的腰痛において血液検査は定型ではない — 感染、悪性腫瘍、または炎症性疾患を疑わせるレッドフラッグがある場合にのみ有用であり、たとえば感染や軸性脊椎関節炎が疑われる場合の赤沈/CRPなど。)" } },
    /* --- another deliberately POOR investigation choice; index 4. */
    { q: { en: "CT scan of the lumbar spine",
           fr: "Scanner (TDM) du rachis lombaire",
           ja: "腰椎CT" },
      a: { en: "Minor age-related degenerative change only; no fracture, no acute lesion. (Note: a lumbar CT delivers a large radiation dose for a region full of radiosensitive organs, and shows even LESS soft-tissue detail than MRI — there is no clinical reason to choose it here. It is the most harmful of the imaging options for a patient who has no red flags.)",
           fr: "Modifications dégénératives mineures liées à l'âge uniquement ; pas de fracture, pas de lésion aiguë. (Note : un scanner lombaire délivre une dose de rayonnements importante à une région riche en organes radiosensibles, et montre encore MOINS de détails sur les tissus mous que l'IRM — il n'y a aucune raison clinique de le choisir ici. C'est l'examen d'imagerie le plus délétère pour un patient sans drapeau rouge.)",
           ja: "加齢に伴う軽微な変性変化のみ;骨折なし、急性病変なし。(注:腰椎CTは放射線感受性の高い臓器が集中する領域に大きな被ばくをもたらし、軟部組織の描出能はMRIよりさらに劣る — 本症例で選択する臨床的根拠はない。レッドフラッグのない患者に対する画像検査の選択肢の中で、最も有害である。)" } }
  ],
  prompts: [
    { en: "Explanation skill: in plain language, how would you explain to Mr Lefebvre that more scans and strong opioids are not the answer - without dismissing his very real pain? Try saying it out loud, in the words you would actually use.",
      fr: "Compétence d'explication : avec des mots simples, comment expliqueriez-vous à M. Lefebvre que d'autres examens et des opioïdes forts ne sont pas la solution — sans minimiser sa douleur bien réelle ? Essayez de le dire à voix haute, avec les mots que vous emploieriez vraiment.",
      ja: "説明スキル:M. Lefebvre に対し、さらなる画像検査や強オピオイドが答えではないことを、彼の本当の痛みを否定せずに、どのように平易な言葉で説明しますか?実際に使う言葉で声に出して言ってみましょう。" },
    { en: "Management plan: build a first-line plan for chronic non-specific low-back pain. Cover education and reassurance, staying active and returning to the gym, structured exercise / physiotherapy, non-opioid analgesia, tackling fear of movement, and addressing sleep and mood. What is the single most important element?",
      fr: "Plan de prise en charge : élaborez un plan de première intention pour la lombalgie chronique non spécifique. Couvrez l'éducation et la réassurance, le maintien de l'activité et la reprise du sport, l'exercice / kinésithérapie structuré·e, l'antalgie non opioïde, la prise en charge de la peur du mouvement, et le sommeil et le moral. Quel est l'élément le plus important ?",
      ja: "治療計画:慢性非特異的腰痛に対する第一選択の計画を立てましょう。教育と安心の提供、活動性の維持とジムへの復帰、構造化された運動療法/理学療法、非オピオイド鎮痛、運動恐怖への対応、睡眠と気分のケアを含めてください。最も重要な要素は一つ何でしょうか?" },
    { en: "Compare France & Japan - the medication request: a patient asks for a specific strong drug by name. In your country, how is that handled? Is a named request from a patient seen as normal and reasonable, or as something to gently resist? Caen and Nagoya: each describe a real consultation pattern.",
      fr: "Comparaison France-Japon — la demande médicamenteuse : un patient réclame un médicament puissant spécifique par son nom. Dans votre pays, comment cela se gère-t-il ? Une demande nommée par le patient est-elle perçue comme normale et raisonnable, ou comme quelque chose à freiner avec tact ? Caen et Nagoya : chaque université décrit une pratique réelle de consultation.",
      ja: "フランスと日本の比較 — 薬剤のリクエスト:患者が特定の強い薬を名指しで求めてきます。あなたの国ではどのように対応されますか?患者からの名指しのリクエストは普通で妥当なものとみなされますか、それとも穏やかに抑えるべきものですか?Caen と名古屋、それぞれ実際の診察パターンを述べてください。" },
    { en: "Compare France & Japan - opioid prescribing culture: per-person opioid use is far lower in Japan than in France, and far lower in France than in the USA. Caen: how easy is it actually to get a strong opioid prescribed in France - who can prescribe, what rules apply? Nagoya: the same for Japan. Then debate: is Japan's very low use a public-health success, a sign of under-treated pain, or both?",
      fr: "Comparaison France-Japon — culture de prescription des opioïdes : la consommation d'opioïdes par habitant est bien plus faible au Japon qu'en France, et bien plus faible en France qu'aux États-Unis. Caen : en pratique, est-il facile d'obtenir une prescription d'opioïde fort en France — qui peut prescrire, quelles règles s'appliquent ? Nagoya : idem pour le Japon. Puis débattez : la très faible consommation au Japon est-elle un succès de santé publique, le signe d'une douleur sous-traitée, ou les deux ?",
      ja: "フランスと日本の比較 — オピオイド処方の文化:一人当たりのオピオイド使用量は、日本がフランスよりはるかに少なく、フランスがアメリカよりはるかに少ないです。Caen:フランスで実際に強オピオイドの処方を受けるのはどの程度容易ですか — 誰が処方でき、どのような規則がありますか?名古屋:日本について同じく説明してください。そのうえで議論:日本の非常に低い使用量は公衆衛生上の成功か、痛みの過少治療の表れか、あるいは両方ですか?" },
    { en: "Compare France & Japan - the role of imaging: Mr Lefebvre wants a scan. In your country, how often would a patient like this actually get an MRI or X-ray, and who drives that - the doctor or the patient? Is ordering a scan ever the easy way to end a difficult consultation?",
      fr: "Comparaison France-Japon — le rôle de l'imagerie : M. Lefebvre veut un examen d'imagerie. Dans votre pays, à quelle fréquence un patient comme lui obtiendrait-il réellement une IRM ou une radiographie, et qui en est à l'initiative — le médecin ou le patient ? Prescrire un examen est-il parfois la façon facile de clore une consultation difficile ?",
      ja: "フランスと日本の比較 — 画像検査の役割:M. Lefebvre は画像検査を希望しています。あなたの国では、このような患者が実際にMRIやX線を受ける頻度はどれくらいですか、また誰がそれを推進しますか — 医師か患者か?画像検査を出すことが、難しい診察を終わらせる安易な手段になってしまうことはありますか?" },
    { en: "Compare France & Japan - patient expectations: what does a patient with chronic pain expect their doctor to do - a prescription, a scan, a referral, an explanation, time? How much does the patient expect to share in the decision, versus be told what to do? Does this differ between France and Japan?",
      fr: "Comparaison France-Japon — attentes des patients : qu'attend un patient atteint de douleur chronique de son médecin — une ordonnance, un examen, une orientation, une explication, du temps ? Dans quelle mesure le patient s'attend-il à participer à la décision, plutôt qu'à se faire dire quoi faire ? Cela diffère-t-il entre la France et le Japon ?",
      ja: "フランスと日本の比較 — 患者の期待:慢性疼痛の患者は、医師に何を期待しますか — 処方、画像検査、紹介、説明、時間?患者はどの程度、医師に決めてもらうのではなく決定に参加することを期待しますか?これはフランスと日本で異なりますか?" },
    { en: "Rebuilding trust: Mr Lefebvre thinks his doctors are 'under-treating him because of rules'. How do you keep him engaged with a non-opioid plan? Does framing the rules as protecting him, rather than restricting him, help?",
      fr: "Rebâtir la confiance : M. Lefebvre pense que ses médecins le « sous-traitent à cause des règles ». Comment le maintenir engagé dans un plan sans opioïde ? Présenter les règles comme le protégeant plutôt que le restreignant aide-t-il ?",
      ja: "信頼の再構築:M. Lefebvre は医師たちが「規則のせいで自分を過少治療している」と思っています。非オピオイドの計画に彼の関心を保つにはどうしますか?規則を「制限」ではなく「彼を守るもの」として提示することは助けになりますか?" },
    { en: "Safety netting: what would make you reconsider? Which red flags or new features would change your approach and prompt imaging, blood tests or referral - and what would you tell Mr Lefebvre to watch for and come back about?",
      fr: "Filet de sécurité : qu'est-ce qui vous ferait reconsidérer ? Quels drapeaux rouges ou nouveaux signes modifieraient votre approche et justifieraient une imagerie, un bilan sanguin ou un avis spécialisé — et que diriez-vous à M. Lefebvre de surveiller et pour quoi revenir consulter ?",
      ja: "セーフティネット:何があれば再考しますか?どのレッドフラッグまたは新しい所見が方針を変え、画像検査・血液検査・専門医紹介を促しますか — そして、M. Lefebvre には何に注意してどんな場合に再診するよう伝えますか?" },
    { en: "Take a position: one sentence each - name the single biggest difference between how France and Japan would handle Mr Lefebvre, and say whether you think one approach is better, or whether each simply fits its own health system.",
      fr: "Prenez position : une phrase chacun·e — nommez la principale différence entre la prise en charge de M. Lefebvre en France et au Japon, et dites si l'une des approches est, selon vous, meilleure, ou si chacune correspond simplement à son propre système de santé.",
      ja: "立場を表明:各自一文ずつ — フランスと日本で M. Lefebvre の対応における最大の違いを一つ挙げ、いずれかのアプローチがより優れていると思うか、あるいはそれぞれが自国の医療制度に適しているだけかを述べてください。" }
  ]
};

/* ===================== ANSWER SCORING - concept families ====================
 * The platform reads the team's typed "Group answers" and gives points when a
 * bullet shows a key idea. This is NOT keyword bingo: each family is awarded at
 * most once, the matcher is forgiving of second-language English (accents are
 * stripped, word *stems* match, e.g. "physio" matches "physiotherapy" and
 * "physiotherapie"), and the families are deliberately broad. Educators can edit
 * the families freely here without touching script.js.
 *
 *   { id, points, label,
 *     any:     [stems]    -> hits if the answers contain ANY one stem
 *     cohorts: true       -> hits if the answers name TWO OR MORE partner
 *                            universities (built from platform-config.js, so it
 *                            works for any partnership, not only France/Japan) }
 *
 * NOTE on i18n: the `label` is a translatable { en, fr, ja } — that is what
 * the points panel / objectives UI shows. The `any` stems stay ENGLISH ONLY;
 * the matcher works against the typed English answer text and does not need
 * (or want) translation, so leave it as a plain string array.
 * ========================================================================== */
var SCORING = {
  moduleA: [
    { id: "active", points: 8,
      label: { en: "Keep the patient active",
               fr: "Garder le patient actif",
               ja: "患者の活動性を保つ" },
      any: ["activ", "exercise", "walk", "gym", "mobil", "movement", "return to",
            "stay at work", "keep moving", "avoid bed rest", "avoid rest"] },
    { id: "educate", points: 8,
      label: { en: "Education & reassurance",
               fr: "Éducation et réassurance",
               ja: "教育と安心の提供" },
      any: ["reassur", "educat", "explain", "not dangerous", "not damage",
            "good prognos", "hurt is not harm", "benign", "not serious"] },
    { id: "physio", points: 6,
      label: { en: "Structured physiotherapy / exercise therapy",
               fr: "Kinésithérapie / exercice thérapeutique structuré·e",
               ja: "構造化された理学療法/運動療法" },
      any: ["physio", "physical therap", "kine", "rehab", "exercise programme",
            "exercise program", "supervised exercise"] },
    { id: "noopioid", points: 8,
      label: { en: "Non-opioid analgesia / decline opioids",
               fr: "Antalgie non opioïde / refuser les opioïdes",
               ja: "非オピオイド鎮痛/オピオイドを使わない" },
      any: ["non-opioid", "non opioid", "nsaid", "ibuprofen", "not first-line",
            "avoid opioid", "no opioid", "decline", "instead of opioid",
            "not oxycod", "say no to"] },
    { id: "yellow", points: 6,
      label: { en: "Address fear, mood & sleep (yellow flags)",
               fr: "Aborder la peur, l'humeur et le sommeil (drapeaux jaunes)",
               ja: "恐怖・気分・睡眠への対応 (イエローフラッグ)" },
      any: ["yellow flag", "fear of movement", "catastroph", "mood", "low mood",
            "sleep", "fear-avoidance", "fear avoidance", "anxiet", "worry"] },
    { id: "noimaging", points: 6,
      label: { en: "Imaging not indicated here",
               fr: "Imagerie non indiquée ici",
               ja: "ここでは画像検査の適応なし" },
      any: ["not indicated", "no mri", "no scan", "no x-ray", "no xray",
            "avoid imaging", "imaging not", "without red flag", "no need to scan"] },
    { id: "contrast", points: 12,
      label: { en: "Named a real difference between two countries",
               fr: "A nommé une réelle différence entre deux pays",
               ja: "二国間の実際の違いを挙げた" },
      cohorts: true },
    { id: "disagree", points: 8,
      label: { en: "Named a real disagreement",
               fr: "A nommé un véritable désaccord",
               ja: "実際の意見の相違を挙げた" },
      any: ["disagree", "could not agree", "did not agree", "not resolve",
            "we differ", "unsure", "split", "no consensus", "debated", "we argued"] }
  ],
  moduleB: [
    { id: "structure", points: 8,
      label: { en: "Used a communication structure",
               fr: "A utilisé une structure de communication",
               ja: "コミュニケーションの枠組みを用いた" },
      any: ["spikes", "warning shot", "perception", "invitation", "small piece",
            "pause", "explore", "realign", "silence", "ask permission",
            "how much", "what do you already know"] },
    { id: "withhold", points: 8,
      label: { en: "Handled the request to withhold",
               fr: "A géré la demande de ne pas dire la vérité",
               ja: "情報を伏せる要望への対応" },
      any: ["withhold", "not lie", "cannot lie", "can't lie", "right not to know",
            "ask the patient", "what they want to know", "do not deceive",
            "don't deceive", "honest", "explore the why", "the family"] },
    { id: "norms", points: 10,
      label: { en: "Compared disclosure norms across two countries",
               fr: "A comparé les normes de divulgation entre deux pays",
               ja: "二国間の情報開示規範を比較した" },
      cohorts: true },
    { id: "convergeB", points: 6,
      label: { en: "Saw how the two systems are converging",
               fr: "A vu comment les deux systèmes convergent",
               ja: "二つの制度の収束を見出した" },
      any: ["converg", "changing", "has changed", "moving toward", "moving towards",
            "both systems", "more similar", "used to"] }
  ]
};

/* ===================== PENALTIES - wrong choices cost points ================
 * A team can MAKE MISTAKES, and mistakes lose points - that is the whole point
 * of letting them choose. Each penalty fires when the team reveals an
 * investigation that THIS case does not need; the platform always shows WHY,
 * so the deduction teaches rather than just punishes. (The total score is
 * floored at 0 - a team is never shamed below zero.)
 *
 *   { id, item: "<group:index>", points, title, why }
 * Educator-editable: change which items are penalised, the size, and the
 * explanation, without touching script.js.
 *
 * NOTE on i18n: `title` and `why` are translatable { en, fr, ja }. The
 * long `why` paragraphs may ship with empty fr/ja stubs — tc() falls back
 * to en until a translator pass fills them in.
 * ========================================================================== */
var PENALTIES = [
  { id: "pen_mri", item: "labs:1", points: 12,
    title: { en: "Ordered an MRI that was not needed",
             fr: "A prescrit une IRM non indiquée",
             ja: "不要なMRIを指示した" },
    why: { en: "Mr Lefebvre has no red flags and a normal examination, so an MRI is " +
               "not indicated. It only finds harmless age-related changes that worry " +
               "the patient and lead to more tests - that is why your team loses points.",
           fr: "M. Lefebvre n'a aucun drapeau rouge et son examen est normal, l'IRM n'est " +
               "donc pas indiquée. Elle ne révèle que des modifications bénignes liées à l'âge " +
               "qui inquiètent le patient et entraînent d'autres examens — c'est pourquoi votre " +
               "équipe perd des points.",
           ja: "M. Lefebvre にはレッドフラッグがなく、診察も正常であるため、MRIの適応はあり" +
               "ません。MRIでは患者を不安にさせ追加検査を招く、無害な加齢性変化が見つかるだけ" +
               "です — それがチームが減点される理由です。" } },
  { id: "pen_xray", item: "labs:2", points: 10,
    title: { en: "Ordered an X-ray that was not needed",
             fr: "A prescrit une radiographie non indiquée",
             ja: "不要なX線を指示した" },
    why: { en: "A plain X-ray has no role in non-specific low-back pain without a " +
               "fracture concern - it adds radiation and shows only age-related change. " +
               "Ordering it here costs your team points.",
           fr: "La radiographie standard n'a pas de place dans la lombalgie non spécifique " +
               "en l'absence d'une suspicion de fracture — elle expose à des rayonnements et " +
               "ne montre que des modifications liées à l'âge. La prescrire ici coûte des " +
               "points à votre équipe.",
           ja: "単純X線は、骨折を疑う根拠のない非特異的腰痛では役割がありません — 被ばくを" +
               "増やすだけで、加齢性変化しか示しません。ここで指示することは、チームの減点に" +
               "つながります。" } },
  { id: "pen_bloods", item: "labs:3", points: 8,
    title: { en: "Ordered blood tests that were not needed",
             fr: "A prescrit un bilan sanguin non indiqué",
             ja: "不要な血液検査を指示した" },
    why: { en: "Blood tests are useful only when a red flag raises suspicion of " +
               "infection, cancer or inflammatory disease - there are none in this " +
               "case, so ordering them costs your team points.",
           fr: "Le bilan sanguin n'est utile que lorsqu'un drapeau rouge fait suspecter " +
               "une infection, un cancer ou une pathologie inflammatoire — il n'y en a aucun " +
               "dans ce cas, alors le prescrire coûte des points à votre équipe.",
           ja: "血液検査は、感染・がん・炎症性疾患を疑わせるレッドフラッグがある場合にのみ" +
               "有用です — 本症例にはそれらは一つもないため、指示することはチームの減点に" +
               "つながります。" } },
  { id: "pen_ct", item: "labs:4", points: 14,
    title: { en: "Ordered a lumbar CT that was not needed",
             fr: "A prescrit un scanner lombaire non indiqué",
             ja: "不要な腰椎CTを指示した" },
    why: { en: "A lumbar CT delivers a large radiation dose to a region full of " +
               "radiosensitive organs and shows less soft-tissue detail than MRI - " +
               "of the three imaging choices for a patient without red flags, this " +
               "is the most harmful, so it costs the most points.",
           fr: "Un scanner lombaire délivre une dose de rayonnements importante à une " +
               "région riche en organes radiosensibles et montre moins de détails des tissus " +
               "mous que l'IRM — parmi les trois choix d'imagerie pour un patient sans " +
               "drapeau rouge, c'est le plus délétère, et c'est donc celui qui coûte le plus " +
               "de points.",
           ja: "腰椎CTは放射線感受性の高い臓器が集中する領域に大きな被ばくをもたらし、" +
               "軟部組織の描出能はMRIより劣ります — レッドフラッグのない患者に対する3つの" +
               "画像検査の選択肢の中で、最も有害であり、したがって最も多くの点数が減点され" +
               "ます。" } },
  /* --- history: the two deliberately wrong opening moves --- */
  { id: "pen_prescribe", item: "history:9", points: 14,
    title: { en: "Promised the oxycodone before any assessment",
             fr: "A promis l'oxycodone avant toute évaluation",
             ja: "評価前にオキシコドンを約束した" },
    why: { en: "Agreeing to prescribe a strong opioid before assessing the pain, " +
               "screening red flags or building a shared plan is exactly the " +
               "prescribing pattern that drives dependence. The rest of the " +
               "consultation now revolves around delivering that promise, not " +
               "exploring the request - that is why your team loses points.",
           fr: "Accepter de prescrire un opioïde fort avant d'avoir évalué la douleur, " +
               "dépisté les drapeaux rouges ou élaboré un plan partagé est exactement le " +
               "schéma de prescription qui favorise la dépendance. Le reste de la " +
               "consultation tourne désormais autour de la tenue de cette promesse, et non " +
               "de l'exploration de la demande — c'est pourquoi votre équipe perd des points.",
           ja: "痛みの評価、レッドフラッグのスクリーニング、共有された計画づくりを行う" +
               "前に強オピオイドの処方に同意することは、まさに依存症を生み出す処方パターン" +
               "です。診察の残りは要望の掘り下げではなく、その約束を実行することを中心に" +
               "回ることになります — それがチームが減点される理由です。" } },
  { id: "pen_dismiss", item: "history:10", points: 10,
    title: { en: "Suggested the pain was imagined or 'just stress'",
             fr: "A suggéré que la douleur était imaginaire ou « juste du stress »",
             ja: "痛みは気のせい、または「ただのストレス」だと示唆した" },
    why: { en: "Telling a patient their pain might be in their head dismisses their " +
               "experience, damages the therapeutic relationship and is not a screen " +
               "for psychological factors (yellow flags are explored, not " +
               "accused). The consultation has lost its alliance - that costs " +
               "points.",
           fr: "Dire à un patient que sa douleur est peut-être imaginaire dévalorise " +
               "son vécu, abîme la relation thérapeutique et ne constitue pas un dépistage " +
               "des facteurs psychologiques (les drapeaux jaunes s'explorent, ils ne se " +
               "reprochent pas). La consultation a perdu son alliance — cela coûte des " +
               "points.",
           ja: "患者に痛みが気のせいかもしれないと伝えることは、患者の体験を軽視し、" +
               "治療関係を損ない、心理社会的因子のスクリーニングにもなりません (イエロー" +
               "フラッグは探るものであって、非難するものではありません)。診察は治療" +
               "同盟を失いました — それが減点につながります。" } },
  /* --- examination: the two deliberately wrong choices --- */
  { id: "pen_dre", item: "exam:5", points: 12,
    title: { en: "Performed a rectal examination with no indication",
             fr: "A réalisé un toucher rectal sans indication",
             ja: "適応なしに直腸指診を行った" },
    why: { en: "A digital rectal examination is indicated only when cauda equina is " +
               "suspected (saddle anaesthesia, urinary retention, bowel symptoms) - " +
               "and there are none here. Doing an intimate, undignified examination " +
               "without a reason is harmful and costs your team points.",
           fr: "Le toucher rectal n'est indiqué qu'en cas de suspicion de syndrome de la " +
               "queue de cheval (anesthésie en selle, rétention urinaire, troubles du transit) " +
               "— et aucun de ces signes n'est présent ici. Réaliser un examen intime et " +
               "dégradant sans raison est délétère et coûte des points à votre équipe.",
           ja: "直腸指診は、馬尾症候群が疑われる場合 (鞍状部知覚異常、尿閉、便通障害) に" +
               "限って適応となります — そして本症例にはこれらが一つもありません。理由なく" +
               "内密的で患者の尊厳を損なう診察を行うことは有害であり、チームの減点に" +
               "つながります。" } },
  { id: "pen_cvresp", item: "exam:6", points: 6,
    title: { en: "Did a scattergun cardio-respiratory examination",
             fr: "A fait un examen cardio-respiratoire au hasard",
             ja: "焦点のない心血管・呼吸器の診察を行った" },
    why: { en: "Nothing in the history points to cardiac or respiratory disease, so " +
               "a full cardio-respiratory examination is not a focused workup - it " +
               "signals to the patient that you are searching at random, and costs " +
               "consultation time the case really needed elsewhere.",
           fr: "Rien dans l'anamnèse n'oriente vers une pathologie cardiaque ou respiratoire, " +
               "un examen cardio-respiratoire complet ne constitue donc pas un bilan ciblé — " +
               "il signale au patient que vous cherchez au hasard, et consomme du temps de " +
               "consultation dont le cas avait réellement besoin ailleurs.",
           ja: "病歴には心疾患や呼吸器疾患を示唆する所見はないため、完全な心血管・呼吸器" +
               "の診察は焦点を絞った精査ではありません — 医師が当てずっぽうに探している" +
               "印象を患者に与え、本症例で本当に必要だった他の部分に充てるべき診察時間を" +
               "消費してしまいます。" } }
];

/* ===================== TEAM DECISIONS - vote together ======================
 * The "very important questions" of the session. Each is a Kahoot-style vote:
 * every student in the room casts a ballot, a live tally shows the room how it
 * is leaning, and the team LOCKS IN one answer together. A correct lock-in
 * earns `points`; a wrong one costs `penalty` points (penalty 0 = no deduction,
 * used for the Module B roleplay, which is deliberately kept low-stakes). The
 * platform always shows WHY, so a wrong vote still teaches.
 *
 *   { id, module: "A" | "B", prompt, points, penalty,
 *     options: [ { text, correct: bool, why } ] }
 *
 * Educator-editable: add, remove or reword decisions, change which option is
 * correct, the points and the explanations - without touching script.js.
 *
 * NOTE on i18n: `prompt`, `options[].text`, and `options[].why` are all
 * translatable { en, fr, ja }. `correct`, `points`, `penalty`, `id`, `module`
 * stay primitive — they are engine semantics, not display strings.
 * ========================================================================== */
var DECISIONS = [
  {
    // Always available — this is a stance/communication choice about HOW to
    // respond to the patient's name-brand request, not a clinical-plan
    // decision. Pedagogist + student-persona agreed it should be reachable
    // from t=0 because the right early behaviour ("explore the request")
    // is exactly what students should commit to before doing any workup.
    id: "dec_opioid", module: "A", points: 25, penalty: 15,
    prompt: { en: "Mr Lefebvre asks for oxycodone by name. Before anything else, " +
                  "your team should…",
              fr: "M. Lefebvre demande de l'oxycodone par son nom. Avant toute chose, " +
                  "votre équipe doit…",
              ja: "M. Lefebvre がオキシコドンを名指しで求めています。何よりもまず、" +
                  "あなたのチームがすべきことは…" },
    options: [
      { text: { en: "Prescribe a short course - he is in pain and a friend said it worked",
                fr: "Prescrire une courte cure — il a mal et un ami lui a dit que ça avait marché",
                ja: "短期間処方する — 痛みがあり、友人が効いたと言っているため" },
        correct: false,
        why: { en: "Prescribing a strong opioid on request, before assessing the pain " +
                   "or screening for red flags, is exactly the prescribing pattern that " +
                   "drives dependence. The request is information to explore, not an " +
                   "instruction to follow.",
               fr: "Prescrire un opioïde fort sur demande, avant d'évaluer la douleur ou " +
                   "de dépister les drapeaux rouges, est exactement le schéma de prescription " +
                   "qui favorise la dépendance. La demande est une information à explorer, " +
                   "pas une instruction à suivre.",
               ja: "痛みの評価やレッドフラッグのスクリーニングを行う前に、要望に応じて" +
                   "強オピオイドを処方することは、まさに依存症を生み出す処方パターンです。" +
                   "要望は掘り下げるべき情報であり、従うべき指示ではありません。" } },
      { text: { en: "Refuse outright and tell him opioids are not an option",
                fr: "Refuser catégoriquement et lui dire que les opioïdes ne sont pas une option",
                ja: "完全に拒否し、オピオイドは選択肢にないと伝える" },
        correct: false,
        why: { en: "A flat refusal shuts down the conversation and the therapeutic " +
                   "relationship. You have not yet assessed his pain or understood why " +
                   "he is asking - you cannot build a safe, shared plan from there.",
               fr: "Un refus catégorique met fin à la conversation et à la relation " +
                   "thérapeutique. Vous n'avez pas encore évalué sa douleur ni compris " +
                   "pourquoi il demande — vous ne pouvez pas bâtir un plan sûr et partagé " +
                   "à partir de là.",
               ja: "頭ごなしの拒否は、会話と治療関係を断ち切ります。あなたはまだ彼の" +
                   "痛みを評価しておらず、なぜ彼が求めているのかも理解していません — そこから" +
                   "安全で共有された計画を築くことはできません。" } },
      { text: { en: "Explore why he wants oxycodone specifically, and assess the pain first",
                fr: "Explorer pourquoi il veut spécifiquement de l'oxycodone, et évaluer d'abord la douleur",
                ja: "なぜ特にオキシコドンを希望するのか掘り下げ、まず痛みを評価する" },
        correct: true,
        why: { en: "Understanding the request - what he has tried, what he fears, what " +
                   "'oxycodone' means to him - and completing the assessment is what " +
                   "lets the team make a safe, shared plan. This is the cornerstone of " +
                   "good opioid stewardship in France and Japan alike.",
               fr: "Comprendre la demande — ce qu'il a déjà essayé, ce qu'il craint, ce " +
                   "que l'« oxycodone » représente pour lui — et compléter l'évaluation, " +
                   "voilà ce qui permet à l'équipe d'élaborer un plan sûr et partagé. C'est " +
                   "la pierre angulaire du bon usage des opioïdes, en France comme au Japon.",
               ja: "要望を理解すること — 彼が何を試したか、何を恐れているか、彼にとって" +
                   "「オキシコドン」が何を意味するか — そして評価を完了することこそが、" +
                   "チームが安全で共有された計画を立てることを可能にします。これは" +
                   "フランスでも日本でも、適正なオピオイド管理の要となるものです。" } }
    ]
  },
  {
    // PBL 7-jump scaffold (2026-05-18 specialist panel): the treatment
    // plan must be downstream of the workup. Locked until the team has
    // committed to ≥1 working hypothesis AND captured ≥1 history item
    // AND ≥1 examination item. Without this, the platform was rewarding
    // pattern-match-and-anchor behaviour ("oxycodone → addiction script")
    // which is exactly the bias PBL is meant to prevent.
    id: "dec_plan", module: "A", points: 25, penalty: 15,
    unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 },
    prompt: { en: "Your team agrees this is non-specific low-back pain. What is the " +
                  "core of the management plan?",
              fr: "Votre équipe convient qu'il s'agit d'une lombalgie non spécifique. Quel est " +
                  "le cœur du plan de prise en charge ?",
              ja: "あなたのチームはこれを非特異的腰痛と判断しました。治療計画の" +
                  "中核は何ですか?" },
    options: [
      { text: { en: "Strong opioids and bed rest until the pain settles",
                fr: "Opioïdes forts et repos au lit jusqu'à ce que la douleur cède",
                ja: "痛みが治まるまで強オピオイドと安静臥床" },
        correct: false,
        why: { en: "Bed rest and strong opioids both worsen outcomes in non-specific " +
                   "low-back pain - this is the opposite of current guidance in both " +
                   "France and Japan.",
               fr: "Le repos au lit et les opioïdes forts aggravent tous deux le pronostic " +
                   "de la lombalgie non spécifique — c'est l'inverse des recommandations " +
                   "actuelles, tant en France qu'au Japon.",
               ja: "安静臥床と強オピオイドはいずれも非特異的腰痛の転帰を悪化させます — " +
                   "これはフランスでも日本でも、現行のガイドラインとは正反対の対応です。" } },
      { text: { en: "Stay active, simple analgesia, reassurance and a clear safety-net",
                fr: "Rester actif, antalgie simple, réassurance et filet de sécurité clair",
                ja: "活動性の維持、シンプルな鎮痛、安心の提供、明確なセーフティネット" },
        correct: true,
        why: { en: "Staying active, simple analgesia, reassurance about the good " +
                   "prognosis and clear advice on when to seek help is the " +
                   "guideline-concordant core of management - and it answers his fear " +
                   "directly, without an opioid.",
               fr: "Rester actif, une antalgie simple, la réassurance sur le bon pronostic " +
                   "et des conseils clairs sur quand reconsulter constituent le cœur de la " +
                   "prise en charge conforme aux recommandations — et cela répond directement " +
                   "à sa peur, sans opioïde.",
               ja: "活動性の維持、シンプルな鎮痛、良好な予後についての安心の提供、そして" +
                   "いつ受診すべきかについての明確な助言が、ガイドラインに沿った治療の中核" +
                   "です — そしてこれは、オピオイドを使わずに、彼の不安に直接応えるものです。" } },
      { text: { en: "Refer to a spinal surgeon to be safe",
                fr: "Adresser à un chirurgien du rachis par précaution",
                ja: "念のため脊椎外科医に紹介する" },
        correct: false,
        why: { en: "There is no surgical question here - no red flags, no neurological " +
                   "deficit. A surgical referral medicalises a self-limiting problem and " +
                   "adds a long, worrying wait.",
               fr: "Il n'y a aucune question chirurgicale ici — pas de drapeau rouge, pas " +
                   "de déficit neurologique. Une orientation chirurgicale médicalise un " +
                   "problème qui guérit spontanément et ajoute une longue attente anxiogène.",
               ja: "ここに外科的問題はありません — レッドフラッグも神経学的欠損もありません。" +
                   "外科紹介は自然軽快する問題を医療化し、長く不安な待ち時間を加えるだけです。" } }
    ]
  },
  {
    id: "dec_family", module: "B", points: 20, penalty: 0,
    prompt: { en: "Before you go in, the patient's adult child quietly asks your team " +
                  "not to tell their parent the diagnosis. Your team's approach is…",
              fr: "Avant que vous n'entriez, l'enfant adulte de la patiente demande discrètement " +
                  "à votre équipe de ne pas annoncer le diagnostic à sa mère. L'approche de votre équipe est…",
              ja: "入室前に、患者の成人した子供が、親に診断を伝えないでほしいと" +
                  "あなたのチームにそっと頼んできました。チームの対応は…" },
    options: [
      { text: { en: "Agree - the family knows the patient best",
                fr: "Accepter — la famille connaît mieux le patient que quiconque",
                ja: "了承する — 家族が患者を最もよく知っているから" },
        correct: false,
        why: { en: "Agreeing without exploring it removes the patient's right to " +
                   "information and her capacity to make decisions. Family-centred " +
                   "communication does not mean bypassing a competent patient.",
               fr: "Accepter sans explorer prive la patiente de son droit à l'information " +
                   "et de sa capacité à décider. La communication centrée sur la famille ne " +
                   "signifie pas contourner une patiente apte à décider.",
               ja: "掘り下げることなく了承することは、患者の情報を知る権利と意思決定能力を" +
                   "奪うことになります。家族中心のコミュニケーションとは、判断能力のある" +
                   "患者を素通りすることではありません。" } },
      { text: { en: "Refuse - the patient must be told everything immediately",
                fr: "Refuser — la patiente doit être informée de tout immédiatement",
                ja: "拒否する — 患者には今すぐすべてを伝えるべき" },
        correct: false,
        why: { en: "A rigid 'tell everything now' ignores how much the patient actually " +
                   "wants to know and the family's genuine fear. Disclosure is a " +
                   "process, not one rule applied identically everywhere.",
               fr: "Un rigide « tout dire maintenant » ignore ce que la patiente souhaite " +
                   "réellement savoir, ainsi que la peur sincère de la famille. L'annonce " +
                   "est un processus, pas une règle unique appliquée à l'identique partout.",
               ja: "硬直的な「今すべて伝える」というやり方は、患者が実際にどこまで知り" +
                   "たいかと、家族の真摯な不安を無視するものです。情報開示はプロセスで" +
                   "あって、どこでも同じように当てはめる一つの規則ではありません。" } },
      { text: { en: "Explore it: ask the patient how much she wants to know, and why the child is worried",
                fr: "Explorer la situation : demander à la patiente ce qu'elle souhaite savoir, et pourquoi l'enfant s'inquiète",
                ja: "状況を掘り下げる:患者本人にどこまで知りたいかを尋ね、子供の心配の理由も聞く" },
        correct: true,
        why: { en: "Asking the patient herself what and how much she wants to know - " +
                   "and understanding the child's fear - respects both the patient's " +
                   "autonomy and the family's role. This is the cross-cultural skill " +
                   "the module is about.",
               fr: "Demander à la patiente elle-même ce qu'elle souhaite savoir et jusqu'où " +
                   "— et comprendre la peur de son enfant — respecte à la fois l'autonomie " +
                   "de la patiente et le rôle de la famille. C'est précisément la compétence " +
                   "interculturelle que vise ce module.",
               ja: "患者本人に、何をどこまで知りたいかを尋ね — そして子供の不安を理解する" +
                   "ことは、患者の自律と家族の役割の双方を尊重することです。これこそが、" +
                   "本モジュールが扱う異文化間のスキルです。" } }
    ]
  }
];

/* ===================== SCENARIOS REGISTRY ===================================
 * Every content pack (CASE + SCORING + PENALTIES + DECISIONS, plus the synthesis
 * gate fields) lives in this registry. The facilitator picks one at session-
 * creation time on the CANAMED splash, the choice is stored against the session
 * (`sessions/{code}/scenarioId`), and the engine applies it on join.
 *
 * To add a NEW scenario, add a new key to the object below with the same shape.
 * If you re-order history/exam items in the case, update `synthId` and
 * `synthPrereqs` so the synthesis still gates on the right red-flag screen.
 *
 *   id            unique key (lowercase, hyphenated, what gets stored in the DB)
 *   name          short name shown in the picker  (translatable { en, fr, ja })
 *   summary       1-2 sentence description        (translatable { en, fr, ja })
 *   moduleAName   the name shown for stage 1      (translatable { en, fr, ja })
 *   moduleBName   the name shown for stage 2      (translatable { en, fr, ja })
 *   case          the clinical content (history, exam, labs, prompts)
 *   scoring       the concept-family scoring (moduleA, moduleB)
 *   penalties     the wrong-choice deductions
 *   decisions     the team-vote decisions
 *   synthId       the gated synthesis item id, e.g. "labs:0"
 *   synthPrereqs  items that must be revealed before synthesis, e.g.
 *                 ["history:1", "history:2", "exam:3"]
 * ========================================================================== */
/* ===================== SCENARIO 2: Breaking Bad News ========================
 * Distinct clinical content for the Module-B-focused offering. A 75-year-old
 * Japanese woman, Mrs Tanaka (田中さん), is being seen jointly by a French and a
 * Japanese physician for painless jaundice and weight loss. Workup reveals an
 * advanced (Stage IV) pancreatic adenocarcinoma. Her adult son, who has
 * accompanied her, takes the team aside and asks them not to tell his mother
 * the diagnosis ("she could not bear it").
 *
 * Clinical / pedagogical sources:
 *   - France: Loi Kouchner (loi n°2002-303 du 4 mars 2002) — patient's right
 *     to be informed; HAS 2008 guidance on "L'annonce du diagnostic" and the
 *     2019 dispositif d'annonce in oncology.
 *   - Japan: MHLW (厚生労働省) Guidelines on End-of-Life Care (2007, revised
 *     2018) — shift from family-mediated non-disclosure (the historical norm
 *     of "がん告知" being filtered through family) toward documented advance
 *     care planning (人生会議) and direct patient-centred disclosure.
 *   - International: SPIKES protocol (Baile et al, Oncologist 2000).
 * ========================================================================== */
var CASE_B = {
  history: [
    { q: { en: "What brings you in today, Mrs Tanaka?",
           fr: "Qu'est-ce qui vous amène aujourd'hui, Madame Tanaka ?",
           ja: "今日はどうされましたか、田中さん?" },
      a: { en: "My son noticed about three weeks ago that my eyes had gone yellow. I didn't really notice it myself - I just felt tired. My appetite has been poor for maybe two months and I think I've lost some weight. The skin on my back itches.",
           fr: "Mon fils a remarqué il y a environ trois semaines que mes yeux étaient devenus jaunes. Moi-même je ne l'avais pas vraiment remarqué — je me sentais juste fatiguée. J'ai peu d'appétit depuis peut-être deux mois et je pense avoir perdu du poids. La peau de mon dos me démange.",
           ja: "息子が3週間ほど前に、私の目が黄色くなっていることに気づきました。自分ではあまり気づいていなくて — ただ疲れているなと感じていただけです。食欲は2か月ほど前から落ちていて、体重も少し減ったように思います。背中の皮膚がかゆいです。" } },
    { q: { en: "Any abdominal pain, change in stool or urine colour?",
           fr: "Douleur abdominale, changement de couleur des selles ou des urines ?",
           ja: "腹痛、便や尿の色の変化はありますか?" },
      a: { en: "There is a dull ache in my upper belly and sometimes it goes through to my back, but it isn't sharp. My urine has gone very dark - like strong tea - and my stools have become pale, almost white.",
           fr: "J'ai une douleur sourde en haut du ventre, qui irradie parfois jusqu'au dos, mais ce n'est pas vif. Mes urines sont devenues très foncées — comme du thé fort — et mes selles sont devenues pâles, presque blanches.",
           ja: "上腹部に鈍い痛みがあって、ときどき背中まで響きますが、鋭い痛みではありません。尿は非常に濃くなって — 濃いお茶のような色です — 便は色が薄くなり、ほとんど白っぽくなっています。" } },
    { q: { en: "How much weight have you lost, and over how long?",
           fr: "Combien de poids avez-vous perdu, et sur combien de temps ?",
           ja: "どのくらいの体重がどのくらいの期間で減りましたか?" },
      a: { en: "I think about six kilos in two months. My clothes are loose. I wasn't trying to lose weight - I just haven't wanted to eat.",
           fr: "Je pense environ six kilos en deux mois. Mes vêtements sont devenus larges. Je n'essayais pas de maigrir — je n'ai juste pas envie de manger.",
           ja: "2か月で6キロほどだと思います。服がゆるくなりました。痩せようとしていたわけではなく — ただ食べたくなかっただけです。" } },
    { q: { en: "Past medical history, medication, smoking and family history?",
           fr: "Antécédents médicaux, traitements, tabac et antécédents familiaux ?",
           ja: "既往歴、内服薬、喫煙歴、家族歴は?" },
      a: { en: "I have type 2 diabetes for fifteen years on metformin, and high blood pressure on amlodipine. I have never smoked. My husband died last year from a stroke. My older sister had breast cancer when she was sixty.",
           fr: "J'ai un diabète de type 2 depuis quinze ans sous metformine, et de l'hypertension sous amlodipine. Je n'ai jamais fumé. Mon mari est décédé l'an dernier d'un AVC. Ma sœur aînée a eu un cancer du sein à soixante ans.",
           ja: "15年前から2型糖尿病でメトホルミンを内服し、高血圧でアムロジピンを飲んでいます。喫煙歴はありません。夫は昨年、脳卒中で亡くなりました。姉は60歳のときに乳がんになりました。" } },
    { q: { en: "Speak with the son alone (he has stepped out and asks for a word)",
           fr: "Parler seul avec le fils (il est sorti et demande à vous parler)",
           ja: "息子と二人だけで話す(彼が席を外し、話があると言ってきた)" },
      a: { en: "In the corridor the son, visibly upset, says quietly: \"Doctor, please — whatever you find, do not tell my mother. She has just lost my father; she could not bear to hear the word 'cancer'. In our family we have always protected her. Tell me, and I will decide what she needs to know.\" He is sincere and frightened, not controlling.",
           fr: "Dans le couloir, le fils, visiblement bouleversé, dit à voix basse : « Docteur, je vous en prie — quoi que vous trouviez, ne le dites pas à ma mère. Elle vient de perdre mon père ; elle ne supporterait pas d'entendre le mot ‟cancer”. Dans notre famille, nous l'avons toujours protégée. Dites-le-moi, et je déciderai ce qu'elle a besoin de savoir. » Il est sincère et apeuré, pas dans le contrôle.",
           ja: "廊下で、息子は明らかに動揺した様子で、静かにこう言います:「先生、お願いです — 何が見つかっても、母には伝えないでください。父を亡くしたばかりで、『がん』という言葉に耐えられません。私たちの家族では、いつも母を守ってきました。私に教えてください、母に何を伝えるかは私が決めます。」彼は誠実で怯えており、支配的なのではありません。" } },
    { q: { en: "Ask Mrs Tanaka herself: how much would she like to know about her test results?",
           fr: "Demander à Madame Tanaka elle-même : combien souhaite-t-elle savoir des résultats ?",
           ja: "田中さん本人に尋ねる:検査結果についてどこまで知りたいですか?" },
      a: { en: "She looks at you carefully and answers slowly: \"Doctor… I am not a child. If it is something serious, I would want to know — but please, gently, and at my pace. My son worries about me. I would also like him to be in the room when you tell me. Will I have time to put my affairs in order?\" (This is a competent, autonomous answer: she wants information, on her terms, with her son present.)",
           fr: "Elle vous regarde attentivement et répond lentement : « Docteur… je ne suis pas une enfant. Si c'est quelque chose de grave, je voudrais le savoir — mais s'il vous plaît, doucement, et à mon rythme. Mon fils s'inquiète pour moi. J'aimerais aussi qu'il soit dans la pièce quand vous me le direz. Aurai-je le temps de mettre mes affaires en ordre ? » (C'est une réponse autonome d'une patiente apte : elle veut l'information, à ses conditions, en présence de son fils.)",
           ja: "彼女はあなたをじっと見つめ、ゆっくりと答えます:「先生……私は子供ではありません。もし重大なことなら、知りたいです — でもどうか、優しく、私のペースで。息子は私を心配しています。話してくださるときには息子にも同席してほしいです。身辺整理をする時間はありますか?」(これは判断能力のある自律的な回答です:彼女は自分の条件で、息子の同席のもと、情報を望んでいます。)" } },
    { q: { en: "Explore the son's fear: what is he afraid will happen if she is told?",
           fr: "Explorer la peur du fils : qu'a-t-il peur qu'il se passe si on lui dit ?",
           ja: "息子の恐れを掘り下げる:伝えたら何が起きると恐れているのか?" },
      a: { en: "After a long pause: \"She will give up. When my father was told his stroke might recur, he stopped eating. He died two weeks later. I cannot watch that again. Also — in our family, it has always been the eldest son who carries the burden. I should be the one to know first.\" (Beneath the request to withhold is a real, recent bereavement and a culturally rooted role.)",
           fr: "Après un long silence : « Elle va abandonner. Quand on a dit à mon père que son AVC pouvait récidiver, il a cessé de manger. Il est mort deux semaines plus tard. Je ne peux pas revivre ça. Et puis — dans notre famille, c'est toujours le fils aîné qui porte le fardeau. C'est à moi de savoir en premier. » (Derrière la demande de ne pas dire se cache un deuil réel et récent, ainsi qu'un rôle culturellement ancré.)",
           ja: "長い沈黙のあと:「母はあきらめてしまいます。父は脳卒中が再発するかもしれないと言われたとき、食事を取らなくなりました。2週間後に亡くなりました。あれをもう一度見たくありません。それに — 私たちの家族では、長男が重荷を背負ってきました。最初に知るのは私であるべきです。」(伏せてほしいという要望の背後には、実際の最近の死別と、文化的に根付いた役割があります。)" } },
    /* --- the following two are deliberately POOR opening moves; the platform
       deducts points for them. Indices 7 and 8 — referenced by PENALTIES_B. */
    { q: { en: "Promise the son immediately that you will not tell his mother",
           fr: "Promettre immédiatement au fils que vous ne direz rien à sa mère",
           ja: "息子に対し、母親には伝えないとすぐに約束する" },
      a: { en: "He looks relieved and thanks you. (You have just contracted with a third party to withhold information from your competent patient before even asking her what she wants to know. Whatever her actual preference, she now cannot exercise it — and you have aligned yourself with the family against the patient.)",
           fr: "Il a l'air soulagé et vous remercie. (Vous venez de vous engager auprès d'un tiers à ne pas informer votre patiente apte, avant même de lui avoir demandé ce qu'elle souhaite savoir. Quelle que soit sa préférence réelle, elle ne peut plus l'exercer — et vous vous êtes rangé du côté de la famille, contre la patiente.)",
           ja: "彼は安堵した様子であなたに感謝します。(あなたは、判断能力のある患者本人に、何を知りたいかを尋ねもしないうちに、第三者に対して情報を伏せることを約束してしまいました。彼女の実際の希望が何であれ、彼女はそれを行使できなくなり — そしてあなたは患者に対して、家族の側についた形になりました。)" } },
    { q: { en: "Tell the son firmly: \"I cannot keep secrets from my patient; I will tell her everything now.\"",
           fr: "Dire fermement au fils : « Je ne peux pas garder de secret vis-à-vis de ma patiente ; je vais tout lui dire maintenant. »",
           ja: "息子に毅然と伝える:「患者に秘密は持てません。今すぐ全部お母様に伝えます。」" },
      a: { en: "He stiffens, takes a step back and says coldly: \"Then you don't understand us. I will not be in the room.\" (You have answered a frightened, recently-bereaved family member by invoking a rule, without acknowledging his fear or exploring what his mother actually wants. The therapeutic alliance with the family is broken, and you still have not asked the patient.)",
           fr: "Il se raidit, recule d'un pas et dit froidement : « Alors vous ne nous comprenez pas. Je ne serai pas dans la pièce. » (Vous venez de répondre à un membre de la famille effrayé et récemment endeuillé en brandissant une règle, sans reconnaître sa peur ni explorer ce que sa mère souhaite réellement. L'alliance thérapeutique avec la famille est rompue, et vous n'avez toujours pas demandé à la patiente.)",
           ja: "彼は身をこわばらせ、一歩下がって冷たくこう言います:「それなら先生は私たちを理解していません。私は同席しません。」(あなたは、最近父を亡くしたばかりで怯えている家族に対し、その恐れを認めることも、母親が本当は何を望んでいるか探ることもなく、規則を振りかざして答えてしまいました。家族との治療同盟は壊れ、しかも患者本人にはまだ何も尋ねていません。)" } }
  ],
  exam: [
    { q: { en: "General observation and vital signs",
           fr: "Observation générale et constantes",
           ja: "全身観察とバイタルサイン" },
      a: { en: "Thin, frail-looking woman, alert and cooperative. Visible scleral icterus and mild jaundice of the skin. Temperature 36.8°C, pulse 88, BP 128/76, SpO2 98%. She looks tired but is in no acute distress.",
           fr: "Femme amaigrie, d'aspect frêle, vigilante et coopérante. Ictère scléral visible et discret ictère cutané. Température 36,8°C, pouls 88, TA 128/76, SpO2 98%. Elle paraît fatiguée mais n'est pas en détresse aiguë.",
           ja: "やせ型で華奢な印象の女性、意識清明で協力的。眼球結膜の黄染と軽度の皮膚黄疸を認める。体温36.8°C、脈拍88、血圧128/76、SpO2 98%。疲れた様子だが急性の苦悶状態ではない。" } },
    { q: { en: "Abdominal examination",
           fr: "Examen abdominal",
           ja: "腹部診察" },
      a: { en: "Soft, mildly tender in the epigastrium. No guarding. A non-tender, smooth, distended gallbladder is palpable in the right upper quadrant (Courvoisier's sign — a palpable, painless gallbladder in a jaundiced patient strongly suggests pancreatic or distal biliary malignancy, not gallstones). Liver edge palpable 2 cm below the costal margin, smooth.",
           fr: "Abdomen souple, sensibilité modérée à l'épigastre. Pas de défense. Vésicule biliaire palpable, lisse, distendue, indolore dans l'hypochondre droit (signe de Courvoisier — une vésicule palpable indolore chez un patient ictérique évoque fortement une néoplasie pancréatique ou des voies biliaires distales, et non une lithiase). Bord hépatique palpable à 2 cm sous le rebord costal, lisse.",
           ja: "腹部は柔らかく、心窩部に軽度の圧痛あり。筋性防御なし。右上腹部に圧痛のない、平滑で腫大した胆嚢を触知 (Courvoisier徴候 — 黄疸患者で圧痛のない触知可能な胆嚢は、胆石症ではなく膵がんまたは遠位胆管がんを強く示唆する)。肝縁は肋骨弓下2 cmに平滑に触知。" } },
    { q: { en: "Skin, lymph nodes, and signs of weight loss",
           fr: "Peau, ganglions, signes de perte de poids",
           ja: "皮膚、リンパ節、体重減少所見" },
      a: { en: "Diffuse scratch marks on the back and arms (pruritus from cholestasis). Temporal wasting and loss of subcutaneous fat on the chest wall. No palpable supraclavicular node (specifically: no left-sided Virchow's node). No peripheral oedema.",
           fr: "Marques de grattage diffuses sur le dos et les bras (prurit cholestatique). Fonte temporale et perte de tissu adipeux sous-cutané sur le thorax. Pas de ganglion sus-claviculaire palpable (en particulier : pas de ganglion de Troisier à gauche). Pas d'œdème périphérique.",
           ja: "背部・上肢にびまん性の掻破痕 (胆汁うっ滞性の掻痒)。側頭部のやせと胸壁の皮下脂肪の減少。鎖骨上リンパ節は触知せず (特に左Virchow リンパ節なし)。末梢浮腫なし。" } },
    { q: { en: "Cognitive screen — does she have decision-making capacity?",
           fr: "Évaluation cognitive — a-t-elle la capacité de décider ?",
           ja: "認知機能評価 — 意思決定能力はあるか?" },
      a: { en: "Mrs Tanaka is fully oriented, recalls why she came to hospital, can name her medications and dosages, and explains in her own words that the doctors think there may be a serious problem with her bile duct or pancreas. She demonstrates understanding, retention, weighing and communication. She has full decision-making capacity — there is no clinical basis to bypass her under any \"best-interests\" doctrine.",
           fr: "Madame Tanaka est parfaitement orientée, se rappelle la raison de son hospitalisation, peut nommer ses traitements et leurs posologies, et explique avec ses propres mots que les médecins pensent qu'il pourrait y avoir un problème sérieux au niveau de sa voie biliaire ou de son pancréas. Elle démontre compréhension, rétention, pondération et communication. Elle a une pleine capacité de décision — il n'y a aucune base clinique pour la contourner au titre d'un quelconque principe de « bien du patient ».",
           ja: "田中さんは見当識が完全に保たれており、入院理由を覚えており、内服薬とその用量を言うことができ、医師が胆管または膵臓に重大な問題があるかもしれないと考えていることを、自分の言葉で説明できます。理解・保持・比較考量・伝達のすべてを示しており、判断能力は完全です — いかなる「患者の最善の利益」原則によっても本人をバイパスする臨床的根拠はありません。" } },
    /* --- deliberately poor exam choice; index 4. */
    { q: { en: "Detailed neurological examination including cranial nerves",
           fr: "Examen neurologique détaillé y compris paires crâniennes",
           ja: "脳神経を含む詳細な神経学的診察" },
      a: { en: "Cranial nerves intact, no focal deficits. (Note: nothing in the history points to a neurological problem. A full neurological screen here is unfocused, eats consultation time that the case will need for the disclosure conversation, and signals to Mrs Tanaka and her son that you are searching at random rather than following the jaundice workup.)",
           fr: "Paires crâniennes intactes, pas de déficit focal. (Note : rien dans l'anamnèse n'oriente vers un problème neurologique. Un dépistage neurologique complet ici n'est pas ciblé, consomme du temps de consultation dont le cas aura besoin pour l'annonce, et signale à Mme Tanaka et son fils que vous cherchez au hasard plutôt que de suivre la démarche de l'ictère.)",
           ja: "脳神経に異常なし、巣症状なし。(注:病歴に神経学的問題を示唆する所見はありません。ここで包括的な神経学的スクリーニングを行うのは焦点を欠いており、診察時間を消費し、黄疸の精査の流れに従うのではなく当てずっぽうに探っている印象を田中さんと息子に与えてしまいます。)" } }
  ],
  labs: [
    { q: { en: "Clinical synthesis and disclosure planning  (unlocks the discussion prompts)",
           fr: "Synthèse clinique et planification de l'annonce  (débloque les questions de discussion)",
           ja: "臨床的総合判断と告知の計画  (ディスカッション課題を解除)" },
      key: true,
      a: { en: "You are looking at painless obstructive jaundice in an elderly woman with weight loss, anorexia, pale stools, dark urine, a palpable non-tender gallbladder (Courvoisier's sign) and an epigastric ache radiating to the back. CT abdomen confirms a mass in the head of the pancreas with liver metastases and peritoneal deposits — Stage IV pancreatic adenocarcinoma. Median survival with metastatic disease is measured in months. Mrs Tanaka has full decision-making capacity and has told you, in her own words, that she wants to know — gently, at her pace, with her son in the room. Her son, recently bereaved, has asked you not to tell her. Before opening the prompts, decide as a group: who is in the room when you break the news, what you say in the first sentence, and how you reconcile the son's fear with the patient's stated preference. Then work through the prompts below.",
           fr: "Vous êtes face à un ictère obstructif indolore chez une femme âgée, avec perte de poids, anorexie, selles décolorées, urines foncées, vésicule palpable indolore (signe de Courvoisier) et douleur épigastrique irradiant dans le dos. Le scanner abdominal confirme une masse de la tête du pancréas avec métastases hépatiques et carcinose péritonéale — adénocarcinome pancréatique Stade IV. La survie médiane en cas de maladie métastatique se compte en mois. Madame Tanaka a une pleine capacité de décision et vous a dit, avec ses propres mots, qu'elle souhaitait savoir — doucement, à son rythme, avec son fils dans la pièce. Son fils, récemment endeuillé, vous a demandé de ne pas lui dire. Avant d'ouvrir les questions de discussion, décidez en groupe : qui est dans la pièce au moment de l'annonce, ce que vous dites dans la première phrase, et comment vous conciliez la peur du fils avec la préférence exprimée par la patiente. Puis traitez les questions ci-dessous.",
           ja: "高齢女性の無痛性閉塞性黄疸であり、体重減少、食欲不振、灰白色便、濃染尿、圧痛のない触知可能な胆嚢 (Courvoisier徴候)、背部に放散する心窩部痛を呈しています。腹部CTで膵頭部腫瘤、肝転移、腹膜播種を確認 — Stage IV 膵腺がんです。転移性疾患の生存期間中央値は数か月単位で測られます。田中さんは完全な意思決定能力を有し、自分の言葉で「優しく、自分のペースで、息子に同席してもらって」知りたいと述べました。最近父親を亡くした息子は、母親に伝えないでほしいと頼んでいます。ディスカッション課題を開く前に、グループで決めましょう:告知の場に誰が同席するか、最初の一文に何と言うか、そして息子の恐れと患者が表明した希望をどう調和させるか。その後、下記の課題に取り組んでください。" } },
    { q: { en: "Liver function tests and full blood count",
           fr: "Bilan hépatique et numération formule sanguine",
           ja: "肝機能検査と全血球計算" },
      a: { en: "Total bilirubin 245 μmol/L (mostly conjugated), ALP 720 U/L, GGT 880 U/L, ALT 95, AST 88 — a clear obstructive (cholestatic) pattern. Albumin 28 g/L (low). Hb 10.8 g/dL (mild normocytic anaemia of chronic disease). Coagulation slightly deranged (INR 1.4) consistent with vitamin K malabsorption from biliary obstruction.",
           fr: "Bilirubine totale 245 μmol/L (majoritairement conjuguée), PAL 720 U/L, GGT 880 U/L, ALT 95, AST 88 — profil obstructif (cholestatique) net. Albumine 28 g/L (basse). Hb 10,8 g/dL (anémie normocytaire modérée de maladie chronique). Coagulation légèrement perturbée (INR 1,4) compatible avec une malabsorption de vitamine K liée à l'obstruction biliaire.",
           ja: "総ビリルビン 245 μmol/L (主に抱合型)、ALP 720 U/L、GGT 880 U/L、ALT 95、AST 88 — 明らかな閉塞性 (胆汁うっ滞性) パターン。アルブミン 28 g/L (低値)。Hb 10.8 g/dL (慢性疾患による軽度正球性貧血)。凝固能はわずかに延長 (INR 1.4)、胆道閉塞によるビタミンK吸収障害と矛盾しない。" } },
    { q: { en: "Tumour markers (CA 19-9, CEA)",
           fr: "Marqueurs tumoraux (CA 19-9, ACE)",
           ja: "腫瘍マーカー (CA 19-9、CEA)" },
      a: { en: "CA 19-9 markedly elevated at 1,840 U/mL (normal <37). CEA mildly elevated at 18 ng/mL (normal <5). CA 19-9 has limited diagnostic specificity but the magnitude here, with the imaging and clinical picture, is consistent with pancreatic adenocarcinoma.",
           fr: "CA 19-9 très élevé à 1 840 U/mL (normale <37). ACE modérément élevé à 18 ng/mL (normale <5). Le CA 19-9 a une spécificité diagnostique limitée, mais son ampleur ici, associée à l'imagerie et au tableau clinique, est compatible avec un adénocarcinome pancréatique.",
           ja: "CA 19-9 は 1,840 U/mL と著明高値 (基準 <37)。CEA も 18 ng/mL と軽度上昇 (基準 <5)。CA 19-9 は診断特異度に限界があるが、本症例の値の大きさは画像所見と臨床像とあわせて膵腺がんに合致する。" } },
    { q: { en: "Abdominal contrast-enhanced CT (with pancreas protocol)",
           fr: "Scanner abdominal injecté (protocole pancréas)",
           ja: "造影腹部CT (膵プロトコル)" },
      a: { en: "A 4.2 cm hypoenhancing mass in the head of the pancreas with abrupt cut-off of the common bile duct and pancreatic duct (\"double duct\" sign), encasement of the superior mesenteric artery (unresectable), multiple liver metastases (largest 3 cm), and peritoneal nodules with small-volume ascites. The radiologist's conclusion: \"Locally advanced pancreatic head mass with hepatic and peritoneal metastases — Stage IV pancreatic adenocarcinoma.\"",
           fr: "Masse hypovascularisée de 4,2 cm de la tête du pancréas avec interruption brutale du cholédoque et du canal pancréatique (signe du « double canal »), englobement de l'artère mésentérique supérieure (non résécable), multiples métastases hépatiques (la plus grande 3 cm), et nodules péritonéaux avec ascite de faible abondance. Conclusion du radiologue : « Masse de la tête du pancréas localement avancée avec métastases hépatiques et péritonéales — adénocarcinome pancréatique Stade IV. »",
           ja: "膵頭部に4.2 cmの低吸収性腫瘤、総胆管と主膵管の急峻な途絶 (「double duct」サイン)、上腸間膜動脈の浸潤 (切除不能)、複数の肝転移 (最大3 cm)、腹膜結節と少量腹水。放射線科医結論:「局所進行性膵頭部腫瘤に肝・腹膜転移を伴う — Stage IV 膵腺がん。」" } },
    { q: { en: "Multidisciplinary team (MDT / RCP) review and biopsy result",
           fr: "Revue en réunion de concertation pluridisciplinaire (RCP) et résultat de la biopsie",
           ja: "多職種カンファレンス (MDT/キャンサーボード) 検討とバイオプシー結果" },
      a: { en: "EUS-guided fine-needle biopsy of the pancreatic mass: \"Moderately differentiated ductal adenocarcinoma.\" MDT conclusion: unresectable Stage IV disease. Her ECOG performance status is 1 (symptomatic but fully ambulatory, able to do light work). Options to discuss with the patient are: palliative chemotherapy — gemcitabine ± nab-paclitaxel chosen over FOLFIRINOX given her ECOG performance status 1, age 75 and serum albumin 28 g/L (FOLFIRINOX would require ECOG 0-1 AND robust nutritional status — she does not meet the second criterion); biliary stenting (ERCP) offered now for symptom relief from the obstructive jaundice (pruritus, prevention of cholangitis), independent of whether she chooses chemotherapy; and early palliative care referral and advance care planning offered alongside oncology, not after it. Estimated median survival 6-11 months with chemotherapy, 3-5 months without.",
           fr: "Biopsie échoguidée (écho-endoscopie) de la masse pancréatique : « Adénocarcinome canalaire moyennement différencié. » Conclusion de RCP : maladie Stade IV non résécable. Son indice de performance ECOG est de 1 (symptomatique mais totalement ambulatoire, capable d'un travail léger). Options à discuter avec la patiente : chimiothérapie palliative — gemcitabine ± nab-paclitaxel retenue plutôt que le FOLFIRINOX compte tenu de son indice ECOG 1, de son âge (75 ans) et de son albuminémie à 28 g/L (le FOLFIRINOX exigerait un ECOG 0-1 ET un état nutritionnel robuste — elle ne remplit pas le second critère) ; drainage biliaire endoscopique (CPRE) proposé d'emblée pour soulager l'ictère obstructif (prurit, prévention de l'angiocholite), indépendamment de son choix de chimiothérapie ; et avis précoce en soins palliatifs et planification anticipée des soins, proposés en parallèle de l'oncologie et non après. Survie médiane estimée 6-11 mois sous chimiothérapie, 3-5 mois sans.",
           ja: "膵腫瘤の超音波内視鏡下穿刺吸引細胞診:「中分化型管状腺がん」。多職種カンファレンス結論:切除不能のStage IV。ECOG パフォーマンスステータスは 1 (症状はあるが完全に歩行可能で、軽作業もできる)。患者と相談すべき選択肢は:緩和的化学療法 — ECOG 1、年齢75歳、血清アルブミン 28 g/L を考慮し、FOLFIRINOX ではなくゲムシタビン±nab-パクリタキセルを選択 (FOLFIRINOX は ECOG 0-1 かつ良好な栄養状態の両方を要するが、彼女は後者を満たさない);閉塞性黄疸の症状緩和 (掻痒、胆管炎予防) のため、化学療法を選ぶか否かにかかわらず内視鏡的胆道ステント留置 (ERCP) を今すぐ提案;早期緩和ケアコンサルテーションとアドバンス・ケア・プランニングを、腫瘍内科の後ではなく並行して提案。推定生存期間中央値は化学療法ありで6-11か月、なしで3-5か月。" } },
    /* --- deliberately poor investigation choice; index 5. */
    { q: { en: "Whole-body PET-CT before the diagnosis is communicated",
           fr: "TEP-TDM corps entier avant l'annonce du diagnostic",
           ja: "診断告知前の全身PET-CT" },
      a: { en: "Multiple FDG-avid lesions in the pancreas, liver and peritoneum — consistent with the CT. (Note: with metastatic disease already proven on contrast CT and biopsy, a PET-CT does NOT change management. Ordering it delays the disclosure conversation by another week, leaves Mrs Tanaka and her son in suspense, and consumes a scarce, expensive resource for no decision benefit. Ordering tests as a way to postpone a difficult conversation is itself a clinical error.)",
           fr: "Multiples lésions hyperfixantes du pancréas, du foie et du péritoine — compatibles avec le scanner. (Note : avec une maladie métastatique déjà prouvée au scanner injecté et à la biopsie, une TEP-TDM NE modifie PAS la prise en charge. La prescrire retarde l'annonce d'une semaine supplémentaire, laisse Mme Tanaka et son fils dans l'attente, et consomme une ressource rare et coûteuse sans bénéfice décisionnel. Prescrire des examens pour différer une conversation difficile est en soi une erreur clinique.)",
           ja: "膵・肝・腹膜に複数のFDG集積病変 — CT所見と一致。(注:造影CTと生検ですでに転移性疾患が証明されている状況で、PET-CTは方針を変えません。指示することで告知がさらに1週間延び、田中さんと息子は宙ぶらりんの状態に置かれ、希少で高価な資源を意思決定上の利益なしに消費します。困難な会話を先延ばしにするために検査を出すこと自体が、臨床的な誤りです。)" } }
  ],
  prompts: [
    { en: "SPIKES in practice: walk through how you would actually open the conversation. What is your warning shot? Your first piece of information? When and how do you pause? Try saying the first three sentences out loud, in the words you would really use.",
      fr: "SPIKES en pratique : décrivez comment vous ouvririez réellement la conversation. Quel est votre « warning shot » ? Votre première information ? Quand et comment marquez-vous une pause ? Essayez de dire les trois premières phrases à voix haute, avec les mots que vous emploieriez vraiment.",
      ja: "SPIKES の実践:実際にどのように会話を始めるかを段階的に示してください。最初の予告 (warning shot) は?最初に伝える情報は?どのタイミングでどのように間を置きますか?最初の3文を、実際に使う言葉で声に出して言ってみましょう。" },
    { en: "The son's request: he is recently bereaved, frightened, and acting from love. How do you honour his fear and his cultural role as eldest son, AND honour his mother's expressed wish to know? Where exactly is the conflict, and where is it only an apparent conflict?",
      fr: "La demande du fils : il est récemment endeuillé, apeuré, et agit par amour. Comment honorer sa peur et son rôle culturel de fils aîné, ET honorer le souhait exprimé par sa mère de savoir ? Où se situe réellement le conflit, et où n'est-il qu'apparent ?",
      ja: "息子の要望:彼は最近父親を亡くし、怯えており、愛情から行動しています。彼の恐れと長男としての文化的役割を尊重しつつ、母親が表明した「知りたい」という希望をも尊重するには?どこに本当の対立があり、どこは見かけの対立にすぎないでしょうか?" },
    { en: "Compare France & Japan — the legal & professional default: in France, since the Loi Kouchner (2002), the default is direct disclosure to the competent patient. In Japan, family-mediated disclosure has historically been the norm but MHLW guidance since 2007 (revised 2018) explicitly endorses patient-centred decision-making (人生会議 / ACP). Caen and Nagoya: what does the LAW say, and what actually happens in practice in your hospitals?",
      fr: "Comparaison France-Japon — la règle légale et professionnelle : en France, depuis la Loi Kouchner (2002), la règle est l'information directe au patient apte. Au Japon, l'annonce médiée par la famille a historiquement été la norme, mais les recommandations du MHLW depuis 2007 (révisées en 2018) soutiennent explicitement une décision centrée sur le patient (人生会議 / ACP). Caen et Nagoya : que dit la LOI, et qu'est-ce qui se passe réellement dans vos hôpitaux ?",
      ja: "フランスと日本の比較 — 法的・職業的なデフォルト:フランスでは Loi Kouchner (2002) 以降、判断能力のある患者本人への直接告知が原則です。日本では家族を介した告知が歴史的に主流でしたが、MHLW 2007年ガイドライン (2018年改訂) は患者中心の意思決定 (人生会議/ACP) を明確に支持しています。Caen と名古屋:法律は何と定めており、それぞれの病院では実際に何が行われていますか?" },
    { en: "Compare France & Japan — \"がん告知\" historically: in Japan, well into the 1990s, the diagnosis of cancer was often disclosed first to the family and either softened or withheld from the patient. What changed? Why? What still differs from France today, and what is genuinely converging?",
      fr: "Comparaison France-Japon — « がん告知 » historiquement : au Japon, jusque dans les années 1990, le diagnostic de cancer était souvent d'abord annoncé à la famille et soit atténué, soit caché au patient. Qu'est-ce qui a changé ? Pourquoi ? Qu'est-ce qui diffère encore aujourd'hui par rapport à la France, et qu'est-ce qui converge réellement ?",
      ja: "フランスと日本の比較 — 「がん告知」の歴史:日本では1990年代まで、がんの診断はまず家族に伝えられ、患者本人には和らげて伝えられるか、または伏せられることが多くありました。何が変わったのでしょうか?なぜでしょうか?今日でもフランスと異なる点は何で、本当に収束している点は何でしょうか?" },
    { en: "Compare France & Japan — the family in the room: in Japan, having a family member present at a serious-news consultation is the expected default. In France, the patient is asked first whether they want anyone present. How does each practice protect — and how does each risk failing — the patient?",
      fr: "Comparaison France-Japon — la famille dans la pièce : au Japon, la présence d'un membre de la famille lors d'une annonce grave est la norme attendue. En France, on demande d'abord au patient s'il souhaite quelqu'un en présence. Comment chaque pratique protège-t-elle — et comment chacune risque-t-elle de manquer — le patient ?",
      ja: "フランスと日本の比較 — 同席する家族:日本では重大な告知に家族が同席するのが標準的な前提です。フランスではまず患者に誰かに同席してほしいか尋ねます。それぞれの慣行はどのように患者を守り、どのように患者を取りこぼす危険があるでしょうか?" },
    { en: "Compare France & Japan — language and softness: in Japanese, words like 進行 (advanced) and 限られた時間 (limited time) often do the work that the word 'cancer' does in French. Is softening language a form of dishonesty, a form of respect, or a culturally legitimate technical vocabulary? Caen and Nagoya: give a real example each.",
      fr: "Comparaison France-Japon — langue et adoucissement : en japonais, des mots comme 進行 (avancé) et 限られた時間 (temps limité) font souvent le travail que le mot « cancer » fait en français. L'adoucissement du langage est-il une forme de malhonnêteté, une forme de respect, ou un vocabulaire technique culturellement légitime ? Caen et Nagoya : donnez chacun·e un exemple réel.",
      ja: "フランスと日本の比較 — 言葉と和らげ方:日本語では「進行」「限られた時間」といった言葉が、フランス語で「がん」という言葉が果たす役割をしばしば担います。言葉を和らげることは不誠実なのでしょうか、敬意の表現なのでしょうか、それとも文化的に正当な専門用語なのでしょうか?Caen と名古屋、それぞれ実例を一つずつ挙げてください。" },
    { en: "After the news: Mrs Tanaka and her son are now in front of you. She begins to cry quietly. He sits very still. What do you say next? What do you NOT say? When do you start talking about chemotherapy, biliary stenting and palliative care, and when do you not?",
      fr: "Après l'annonce : Mme Tanaka et son fils sont devant vous. Elle se met à pleurer doucement. Lui reste immobile. Que dites-vous ensuite ? Que NE dites-vous PAS ? Quand commencez-vous à parler de chimiothérapie, de drainage biliaire et de soins palliatifs, et quand ne le faites-vous pas ?",
      ja: "告知のあと:田中さんと息子があなたの前にいます。彼女は静かに泣き始めます。彼は身じろぎもせず座っています。次に何と言いますか?何を言いませんか?化学療法、胆道ステント、緩和ケアの話をいつ始め、いつ始めませんか?" },
    { en: "The advance-care-planning step: once the dust settles, Mrs Tanaka will need to make decisions about chemotherapy, place of care, resuscitation status, and what she tells her grandchildren. How would you structure a follow-up conversation in your country? Who else (oncology, palliative care, primary care, chaplaincy) is in the room?",
      fr: "L'étape de la planification anticipée : une fois les choses retombées, Mme Tanaka devra décider de la chimiothérapie, du lieu de prise en charge, du statut de réanimation, et de ce qu'elle dit à ses petits-enfants. Comment structureriez-vous une consultation de suivi dans votre pays ? Qui d'autre (oncologie, soins palliatifs, médecine générale, aumônerie) est dans la pièce ?",
      ja: "アドバンス・ケア・プランニングの段階:落ち着いたあと、田中さんは化学療法、療養の場、心肺蘇生の意思、孫たちに何を伝えるかを決めていくことになります。あなたの国ではフォローアップの面談をどのように組み立てますか?ほかに誰が同席しますか(腫瘍内科、緩和ケア、かかりつけ医、宗教者など)?" },
    { en: "Take a position: one sentence each — name the single biggest difference between how France and Japan would handle this conversation, and say whether you think one approach is better, or whether each simply fits its own health system and culture.",
      fr: "Prenez position : une phrase chacun·e — nommez la principale différence entre la façon dont la France et le Japon mèneraient cette conversation, et dites si l'une des approches est, selon vous, meilleure, ou si chacune correspond simplement à son propre système de santé et à sa culture.",
      ja: "立場を表明:各自一文ずつ — フランスと日本でこの会話の進め方の最大の違いを一つ挙げ、いずれかのアプローチがより優れていると思うか、あるいはそれぞれが自国の医療制度と文化に適しているだけかを述べてください。" }
  ]
};

/* SCORING for the Breaking-Bad-News scenario. Module B is the focus here, so
   Module A carries lighter weight — a sound clinical workup is still required
   to reach the synthesis, but the pedagogical engine of the case is Module B. */
var SCORING_B = {
  moduleA: [
    { id: "courvoisier", points: 8,
      label: { en: "Recognised the Courvoisier sign / painless obstructive jaundice",
               fr: "A reconnu le signe de Courvoisier / ictère obstructif indolore",
               ja: "Courvoisier徴候/無痛性閉塞性黄疸を認識した" },
      any: ["courvoisier", "painless jaundice", "obstructive jaundice",
            "cholestatic", "cholestasis", "palpable gallbladder",
            "non-tender gallbladder", "double duct"] },
    { id: "pancreatic", points: 8,
      label: { en: "Named pancreatic / biliary malignancy as the leading diagnosis",
               fr: "A nommé une néoplasie pancréatique / biliaire comme diagnostic principal",
               ja: "膵がん/胆道がんを最有力診断として挙げた" },
      any: ["pancrea", "ductal adenocarcinoma", "cholangiocarcinoma",
            "biliary cancer", "klatskin", "head of pancreas"] },
    { id: "capacity", points: 8,
      label: { en: "Confirmed the patient has decision-making capacity",
               fr: "A confirmé la capacité de décision de la patiente",
               ja: "患者の意思決定能力を確認した" },
      any: ["capacity", "competent", "competence", "understand", "retain",
            "weigh", "communicate", "decision-making", "autonom"] },
    { id: "staging", points: 6,
      label: { en: "Recognised metastatic / Stage IV / unresectable disease",
               fr: "A reconnu la maladie métastatique / Stade IV / non résécable",
               ja: "転移性/Stage IV/切除不能の病勢を認識した" },
      any: ["metasta", "stage iv", "stage 4", "unresectable", "advanced",
            "liver met", "peritoneal", "incurable", "palliative intent"] },
    { id: "no_delay", points: 6,
      label: { en: "Did not order tests just to delay the conversation",
               fr: "N'a pas prescrit d'examens pour seulement différer la conversation",
               ja: "会話を先延ばしにするためだけの検査を指示しなかった" },
      any: ["do not delay", "don't delay", "without delay", "avoid postponing",
            "no further test", "no more test", "no pet", "no additional imaging",
            "ready to disclose", "tests are sufficient"] }
  ],
  moduleB: [
    { id: "structure", points: 8,
      label: { en: "Used a communication structure",
               fr: "A utilisé une structure de communication",
               ja: "コミュニケーションの枠組みを用いた" },
      any: ["spikes", "warning shot", "perception", "invitation", "small piece",
            "pause", "explore", "realign", "silence", "ask permission",
            "how much", "what do you already know", "setting", "knowledge",
            "empathy", "strategy and summary"] },
    { id: "withhold", points: 10,
      label: { en: "Handled the family request to withhold (asked the patient, did not promise)",
               fr: "A géré la demande familiale de ne pas dire (a interrogé la patiente, n'a pas promis)",
               ja: "家族の伏せてほしいとの要望に対応(患者に尋ね、約束はしなかった)" },
      any: ["withhold", "not lie", "cannot lie", "can't lie", "right not to know",
            "ask the patient", "what they want to know", "do not deceive",
            "don't deceive", "honest", "explore the why", "the family",
            "not promise", "did not promise", "explored the fear",
            "acknowledg the fear", "his fear", "her preference"] },
    { id: "norms", points: 10,
      label: { en: "Compared disclosure norms across two countries",
               fr: "A comparé les normes de divulgation entre deux pays",
               ja: "二国間の情報開示規範を比較した" },
      cohorts: true },
    { id: "convergeB", points: 6,
      label: { en: "Saw how the two systems are converging",
               fr: "A vu comment les deux systèmes convergent",
               ja: "二つの制度の収束を見出した" },
      any: ["converg", "changing", "has changed", "moving toward", "moving towards",
            "both systems", "more similar", "used to", "kouchner",
            "人生会議", "acp", "advance care planning", "mhlw",
            "ministry of health"] },
    { id: "family_role", points: 6,
      label: { en: "Recognised the family's legitimate role without overriding the patient",
               fr: "A reconnu le rôle légitime de la famille sans contourner la patiente",
               ja: "患者を素通りせず、家族の正当な役割を認識した" },
      any: ["family role", "with the family", "include the family",
            "eldest son", "family in the room", "filial", "support",
            "without bypassing", "patient remains", "patient still decides"] }
  ]
};

/* PENALTIES for the Breaking-Bad-News scenario. */
var PENALTIES_B = [
  { id: "pen_pet", item: "labs:5", points: 12,
    title: { en: "Ordered a PET-CT to delay the disclosure",
             fr: "A prescrit une TEP-TDM pour différer l'annonce",
             ja: "告知を先延ばしするためにPET-CTを指示した" },
    why: { en: "Metastatic disease is already proven on contrast CT and biopsy. A " +
               "PET-CT does not change management - ordering it postpones the " +
               "conversation by another week and leaves Mrs Tanaka and her son in " +
               "suspense for no decision benefit. Using investigations to avoid a " +
               "difficult conversation is itself a clinical error.",
           fr: "La maladie métastatique est déjà prouvée au scanner injecté et à la biopsie. " +
               "Une TEP-TDM ne modifie pas la prise en charge — la prescrire repousse la " +
               "conversation d'une semaine supplémentaire et laisse Mme Tanaka et son fils " +
               "dans l'attente, sans bénéfice décisionnel. Utiliser des examens pour éviter " +
               "une conversation difficile est en soi une erreur clinique.",
           ja: "造影CTと生検ですでに転移性疾患が証明されています。PET-CTは方針を変えず — " +
               "指示することで会話がさらに1週間延び、田中さんと息子は意思決定上の利益もな" +
               "く宙ぶらりんに置かれます。困難な会話を避けるために検査を使うこと自体が、" +
               "臨床的な誤りです。" } },
  { id: "pen_neuro", item: "exam:4", points: 6,
    title: { en: "Did an unfocused neurological examination",
             fr: "A fait un examen neurologique non ciblé",
             ja: "焦点を欠いた神経学的診察を行った" },
    why: { en: "Nothing in the history points to a neurological problem. A full " +
               "neurological screen here is unfocused, eats consultation time the " +
               "case will need for the disclosure, and signals that you are " +
               "searching at random rather than following the jaundice workup.",
           fr: "Rien dans l'anamnèse n'oriente vers un problème neurologique. Un dépistage " +
               "neurologique complet ici n'est pas ciblé, consomme du temps de consultation " +
               "dont le cas aura besoin pour l'annonce, et signale que vous cherchez au " +
               "hasard plutôt que de suivre la démarche de l'ictère.",
           ja: "病歴に神経学的問題を示唆する所見はありません。ここで包括的な神経学的スク" +
               "リーニングを行うのは焦点を欠いており、告知に必要な診察時間を消費し、黄疸" +
               "の精査の流れに従うのではなく当てずっぽうに探っている印象を与えます。" } },
  { id: "pen_promise_withhold", item: "history:7", points: 14,
    title: { en: "Promised the son you would not tell his mother",
             fr: "A promis au fils que vous ne diriez rien à sa mère",
             ja: "母親には伝えないと息子に約束した" },
    why: { en: "Contracting with a third party to withhold information from a " +
               "competent patient — before even asking her what she wants to know — " +
               "removes her capacity to exercise her preference. Whatever the family " +
               "wishes, the patient is the one whose information it is. The son's " +
               "fear deserves exploration, not a binding promise that bypasses his " +
               "mother. That is why your team loses points.",
           fr: "S'engager auprès d'un tiers à ne pas informer une patiente apte — avant " +
               "même de lui avoir demandé ce qu'elle souhaite savoir — la prive de la " +
               "possibilité d'exercer sa préférence. Quels que soient les souhaits de la " +
               "famille, l'information appartient à la patiente. La peur du fils mérite " +
               "d'être explorée, pas une promesse engageante qui contourne sa mère. " +
               "C'est pourquoi votre équipe perd des points.",
           ja: "判断能力のある患者に何を知りたいか尋ねもしないうちに、第三者に対して情報" +
               "を伏せることを約束することは、患者が自分の希望を行使する余地を奪うこと" +
               "です。家族の希望が何であれ、情報は患者本人のものです。息子の恐れは掘り" +
               "下げるべきものであり、母親をバイパスする拘束的な約束をすべきものでは" +
               "ありません — それがチームの減点理由です。" } },
  { id: "pen_rule_dump", item: "history:8", points: 10,
    title: { en: "Answered the son with a rule, without acknowledging his fear",
             fr: "A répondu au fils par une règle, sans reconnaître sa peur",
             ja: "息子の恐れを認めず、規則だけを振りかざして答えた" },
    why: { en: "\"I cannot keep secrets from my patient\" is correct in principle but " +
               "wrong as an opening response to a frightened, recently-bereaved son. " +
               "It dismisses his fear, breaks the therapeutic alliance with the " +
               "family, and still leaves you without having asked the patient what " +
               "she actually wants. Right rule, wrong moment — that costs points.",
           fr: "« Je ne peux pas garder de secret vis-à-vis de ma patiente » est juste sur " +
               "le principe mais inapproprié comme première réponse à un fils effrayé et " +
               "récemment endeuillé. Cela dévalorise sa peur, rompt l'alliance thérapeutique " +
               "avec la famille, et vous laisse toujours sans avoir demandé à la patiente " +
               "ce qu'elle souhaite réellement. La bonne règle, au mauvais moment — cela " +
               "coûte des points.",
           ja: "「患者に秘密は持てません」は原則としては正しいですが、最近父を亡くしたばか" +
               "りで怯えている息子への最初の応答としては不適切です。彼の恐れを軽視し、家" +
               "族との治療同盟を壊し、しかも患者本人が本当は何を望んでいるかをまだ尋ねて" +
               "いない状態を残します。正しい規則、誤ったタイミング — それが減点理由です。" } }
];

/* DECISIONS for the Breaking-Bad-News scenario. Two votes:
   1) handling the family request (the original dec_family, kept and refined);
   2) Mrs Tanaka's "is it bad, doctor?" — the first response. */
var DECISIONS_B = [
  {
    id: "dec_family", module: "B", points: 25, penalty: 0,
    prompt: { en: "Before you go in, Mrs Tanaka's son quietly asks your team not to " +
                  "tell his mother the diagnosis — \"she could not bear it.\" Your " +
                  "team's approach is…",
              fr: "Avant que vous n'entriez, le fils de Mme Tanaka demande discrètement à " +
                  "votre équipe de ne pas annoncer le diagnostic à sa mère — « elle ne le " +
                  "supporterait pas ». L'approche de votre équipe est…",
              ja: "入室前に、田中さんの息子が、母親に診断を伝えないでほしいとあなたの" +
                  "チームにそっと頼んできました — 「母には耐えられません」と。チームの" +
                  "対応は…" },
    options: [
      { text: { en: "Agree — the family knows the patient best and she has just lost her husband",
                fr: "Accepter — la famille connaît mieux la patiente, et elle vient de perdre son mari",
                ja: "了承する — 家族が患者を最もよく知っており、夫を亡くしたばかりなので" },
        correct: false,
        why: { en: "Agreeing without exploring it removes the patient's right to " +
                   "information and her capacity to make decisions about treatment, " +
                   "place of care and what time she has left. Family-centred " +
                   "communication is not the same as bypassing a competent patient.",
               fr: "Accepter sans explorer prive la patiente de son droit à l'information " +
                   "et de sa capacité à décider du traitement, du lieu de prise en charge et " +
                   "du temps qui lui reste. La communication centrée sur la famille ne signifie " +
                   "pas contourner une patiente apte.",
               ja: "掘り下げることなく了承することは、患者の情報を知る権利と、治療・療養" +
                   "の場・残された時間に関する意思決定能力を奪うことになります。家族中心" +
                   "のコミュニケーションは、判断能力のある患者をバイパスすることとは違い" +
                   "ます。" } },
      { text: { en: "Refuse — \"I cannot keep secrets from my patient\" — and go straight in to tell her",
                fr: "Refuser — « Je ne peux pas garder de secret vis-à-vis de ma patiente » — et entrer directement le lui dire",
                ja: "拒否する — 「患者に秘密は持てません」 — そして直接母親に伝えに行く" },
        correct: false,
        why: { en: "Right rule, wrong moment. Brandishing the rule at a frightened, " +
                   "recently-bereaved son dismisses his fear and breaks the alliance " +
                   "with the family. You still have not asked the patient what she " +
                   "wants. Disclosure is a process — it starts with a question to " +
                   "the patient, not a position taken against the family.",
               fr: "La bonne règle, au mauvais moment. Brandir la règle face à un fils " +
                   "effrayé et récemment endeuillé dévalorise sa peur et rompt l'alliance " +
                   "avec la famille. Vous n'avez toujours pas demandé à la patiente ce " +
                   "qu'elle souhaite. L'annonce est un processus — elle commence par une " +
                   "question à la patiente, pas par une position prise contre la famille.",
               ja: "正しい規則、誤ったタイミング。最近父を亡くしたばかりで怯えている息子" +
                   "に対し規則を振りかざすことは、彼の恐れを軽視し、家族との同盟を壊し" +
                   "ます。しかも患者本人にはまだ何を望むか尋ねていません。告知はプロセス" +
                   "であって — 家族に対して立場を取ることからではなく、患者への問いかけ" +
                   "から始まります。" } },
      { text: { en: "Acknowledge the son's fear, then ask Mrs Tanaka herself how much she wants to know",
                fr: "Reconnaître la peur du fils, puis demander à Mme Tanaka elle-même ce qu'elle souhaite savoir",
                ja: "息子の恐れをまず受け止め、その上で田中さん本人にどこまで知りたいかを尋ねる" },
        correct: true,
        why: { en: "This honours both the son's love and grief (he has just buried his " +
                   "father) and the patient's autonomy. It does not require choosing " +
                   "between the family and the patient — it requires asking the right " +
                   "person, in the right order, at the right pace. This is the " +
                   "cross-cultural skill at the heart of the module.",
               fr: "Cela honore à la fois l'amour et le deuil du fils (il vient d'enterrer " +
                   "son père) et l'autonomie de la patiente. Il n'est pas nécessaire de choisir " +
                   "entre la famille et la patiente — il faut interroger la bonne personne, " +
                   "dans le bon ordre, au bon rythme. C'est précisément la compétence " +
                   "interculturelle qui est au cœur de ce module.",
               ja: "これは、息子の愛情と悲しみ (彼は父親を埋葬したばかりです) と、患者の" +
                   "自律の双方を尊重します。家族か患者かを選ぶ必要はありません — 正しい" +
                   "順序で、正しいペースで、正しい人に尋ねることが必要なのです。これこそ" +
                   "が本モジュールの核心にある異文化間スキルです。" } }
    ]
  },
  {
    id: "dec_first_words", module: "B", points: 25, penalty: 0,
    prompt: { en: "You sit down with Mrs Tanaka and her son. Before you have said " +
                  "anything, she looks at you and asks: \"Doctor, is it bad?\" Your " +
                  "first response is…",
              fr: "Vous vous asseyez avec Mme Tanaka et son fils. Avant même que vous " +
                  "n'ayez parlé, elle vous regarde et demande : « Docteur, c'est grave ? » " +
                  "Votre première réponse est…",
              ja: "田中さんと息子と着席します。あなたがまだ何も言わないうちに、彼女は" +
                  "あなたを見てこう尋ねます:「先生、悪いんですか?」あなたの最初の応答" +
                  "は…" },
    options: [
      { text: { en: "\"Yes — I'm afraid you have advanced pancreatic cancer that has spread to your liver.\"",
                fr: "« Oui — j'ai bien peur que vous ayez un cancer du pancréas avancé qui s'est étendu au foie. »",
                ja: "「はい — 残念ながら肝臓に転移した進行膵がんがあります。」" },
        correct: false,
        why: { en: "Honest but too fast. The full diagnosis arrives in one sentence " +
                   "with no warning shot, no check of what she already understands, " +
                   "no invitation to set the pace. She asked an opening question, " +
                   "not for the whole diagnosis in one breath. SPIKES exists " +
                   "precisely to slow this moment down.",
               fr: "Honnête mais trop rapide. Le diagnostic complet arrive en une phrase " +
                   "sans « warning shot », sans vérification de ce qu'elle comprend déjà, " +
                   "sans invitation à fixer le rythme. Elle a posé une question d'ouverture, " +
                   "elle n'a pas demandé l'ensemble du diagnostic d'un seul tenant. SPIKES " +
                   "existe précisément pour ralentir ce moment.",
               ja: "誠実ですが、急ぎすぎです。診断全体が、予告 (warning shot) もなく、彼女" +
                   "がすでに何を理解しているかの確認もなく、ペースを決める招待もなく、一" +
                   "文で届けられてしまいます。彼女は冒頭の問いを発しただけで、診断のすべ" +
                   "てを一気に求めたのではありません。SPIKES はまさにこの瞬間を緩めるた" +
                   "めに存在します。" } },
      { text: { en: "\"Let's not worry about that just yet — we'll talk about it when the time is right.\"",
                fr: "« Ne vous inquiétez pas pour ça pour le moment — nous en parlerons en temps voulu. »",
                ja: "「今はそれを心配しないでください — 適切なときにお話ししましょう。」" },
        correct: false,
        why: { en: "This is paternalistic deflection. She has just asked a direct " +
                   "question; brushing it aside tells her you have bad news AND that " +
                   "you will not tell her. It also leaves the son holding the secret. " +
                   "Avoiding the question is not protection — it is a refusal to " +
                   "engage with the patient's expressed wish to know.",
               fr: "C'est une esquive paternaliste. Elle vient de poser une question directe ; " +
                   "l'écarter lui signifie à la fois que vous avez une mauvaise nouvelle ET " +
                   "que vous ne lui direz pas. Cela laisse aussi le fils porter le secret. " +
                   "Éviter la question n'est pas une protection — c'est un refus de répondre " +
                   "au souhait de savoir exprimé par la patiente.",
               ja: "これはパターナリスティックなはぐらかしです。彼女は今、率直な問いを発" +
                   "したのです;それを払いのけることは、悪い知らせがある、しかも伝えない" +
                   "という両方を彼女に告げることになります。息子に秘密を背負わせる結果に" +
                   "もなります。問いを避けることは保護ではなく — 患者が表明した「知りた" +
                   "い」という希望に応えることの拒否です。" } },
      { text: { en: "\"I do have news to share with you. Before I tell you, can I ask — how much detail would you like, and would you like your son to stay?\"",
                fr: "« J'ai effectivement des nouvelles à vous communiquer. Avant que je vous les dise, puis-je vous demander — jusqu'à quel niveau de détail souhaitez-vous, et voulez-vous que votre fils reste ? »",
                ja: "「お伝えすべきことがあります。お話しする前に伺ってもよろしいですか — どの程度詳しく聞きたいですか、息子さんは同席されますか?」" },
        correct: true,
        why: { en: "This is a SPIKES-style opening: a warning shot (\"I do have news\"), " +
                   "an invitation to set both the depth of information and the " +
                   "people in the room, and an explicit acknowledgement that this " +
                   "moment is hers to shape. It honours her earlier wish (gentle, " +
                   "at her pace, with her son present) without contracting with " +
                   "anyone behind her back.",
               fr: "C'est une ouverture de type SPIKES : un « warning shot » (« j'ai des " +
                   "nouvelles »), une invitation à fixer à la fois le niveau de détail et les " +
                   "personnes présentes, et une reconnaissance explicite que ce moment lui " +
                   "appartient. Cela honore son souhait antérieur (en douceur, à son rythme, " +
                   "avec son fils présent) sans engagement pris dans son dos.",
               ja: "これは SPIKES 流の切り出しです:予告 (「お伝えすべきことがあります」)、" +
                   "情報の深さと同席者の双方を決めるよう招くこと、そしてこの瞬間が彼女自身" +
                   "の形にすべきものであることの明確な承認。これは、彼女の先ほどの希望 " +
                   "(優しく、自分のペースで、息子に同席してもらって) を尊重しつつ、彼女" +
                   "の知らないところで誰とも約束を結ばないやり方です。" } }
    ]
  },
  {
    // Round-2 clinical-educator edit (sim-output/round2-clinical-ebm.md,
    // Scenario 2 Edit 1): the case decides WHETHER to disclose but never
    // models the harder downstream question — should you volunteer a
    // numerical prognosis, or first explore what kind of answer she wants?
    // SPIKES "Invitation" applied to prognosis. Low-stakes (penalty 0),
    // consistent with the other Module-B roleplay votes. Appended to the
    // END of DECISIONS_B; decisions are consumed by `.id`, never by index,
    // so this does not disturb dec_family / dec_first_words.
    id: "dec_prognosis", module: "B", points: 20, penalty: 0,
    prompt: { en: "After Mrs Tanaka has absorbed the diagnosis, she asks: \"How long " +
                  "do I have, doctor?\" Your response is…",
              fr: "Une fois que Mme Tanaka a absorbé le diagnostic, elle demande : " +
                  "« Combien de temps me reste-t-il, docteur ? » Votre réponse est…",
              ja: "田中さんが診断を受け止めたあと、こう尋ねます:「先生、私はあとどれ" +
                  "くらいですか?」あなたの応答は…" },
    options: [
      { text: { en: "\"Median survival is 6-11 months with chemotherapy.\" — Give the number directly.",
                fr: "« La survie médiane est de 6 à 11 mois avec chimiothérapie. » — Donner le chiffre directement.",
                ja: "「化学療法ありで生存期間中央値は6か月から11か月です。」 — 数字を直接伝える。" },
        correct: false,
        why: { en: "Honest, but premature. She asked a question; she has not yet asked " +
                   "for a number. Some patients want the median, some want a range, some " +
                   "want \"weeks vs months vs years.\" Volunteering the precise number can " +
                   "land like a sentence — explore first what kind of answer she is " +
                   "asking for.",
               fr: "Honnête, mais prématuré. Elle a posé une question, elle n'a pas demandé " +
                   "un chiffre. Certaines patientes veulent la médiane, d'autres une " +
                   "fourchette, d'autres « semaines vs mois vs années ». Donner le chiffre " +
                   "précis peut tomber comme une condamnation — explorez d'abord quel type " +
                   "de réponse elle attend.",
               ja: "誠実ですが、急ぎすぎです。彼女は問いを発しただけで、数字を求めたわけ" +
                   "ではありません。中央値を知りたい人もいれば、範囲を聞きたい人も、" +
                   "「週か、月か、年か」だけを知りたい人もいます。正確な数字を持ち出すと" +
                   "宣告のように響くことがあります — まずどんな答えを求めているのか確認" +
                   "しましょう。" } },
      { text: { en: "\"That's hard to predict — every patient is different.\" — Deflect.",
                fr: "« C'est difficile à dire — chaque patient est différent. » — Esquiver.",
                ja: "「予測は難しいんです — 患者さんごとに違いますから。」 — はぐらかす。" },
        correct: false,
        why: { en: "True in part, but used here as deflection it refuses her question. She " +
                   "asked because she wants to plan — for grandchildren, for affairs, for " +
                   "the time she has. Deflection denies her that planning capacity.",
               fr: "Partiellement vrai, mais utilisé ici comme esquive cela refuse sa " +
                   "question. Elle demande parce qu'elle veut planifier — pour ses " +
                   "petits-enfants, ses affaires, le temps qui lui reste. L'esquive lui " +
                   "refuse cette capacité de planification.",
               ja: "一面では正しいですが、ここではぐらかしとして使えば、彼女の問いを退ける" +
                   "ことになります。彼女は計画したいから尋ねているのです — 孫のこと、身辺" +
                   "の整理、残された時間のために。はぐらかしはその計画する力を奪います。" } },
      { text: { en: "\"That is a really important question. Before I answer, can I ask — " +
                    "would you like a precise estimate, a rough range like 'months not " +
                    "years', or just the headline?\"",
                fr: "« C'est une question vraiment importante. Avant que je vous réponde, " +
                    "puis-je vous demander — préférez-vous une estimation précise, une " +
                    "fourchette comme « des mois plutôt que des années », ou juste " +
                    "l'essentiel ? »",
                ja: "「とても大切なご質問です。お答えする前に伺ってもよろしいですか — " +
                    "具体的な見込み、『年単位ではなく月単位』のような大まかな範囲、それとも" +
                    "要点だけ、どれをお望みですか?」" },
        correct: true,
        why: { en: "This is SPIKES Invitation applied to prognosis: name that the question " +
                   "is important, check what KIND of answer she wants, then deliver at her " +
                   "chosen resolution. Studies of cancer-prognosis disclosure (Mack et al; " +
                   "the Japanese JSCO CST) show that calibrating the resolution to patient " +
                   "preference improves both understanding and emotional integration.",
               fr: "C'est l'étape « Invitation » de SPIKES appliquée au pronostic : nommer " +
                   "l'importance de la question, vérifier quel TYPE de réponse elle souhaite, " +
                   "puis répondre à la résolution qu'elle a choisie. Les études sur l'annonce " +
                   "du pronostic en oncologie (Mack et al ; CST de la JSCO) montrent que " +
                   "calibrer la résolution selon la préférence de la patiente améliore à la " +
                   "fois la compréhension et l'intégration émotionnelle.",
               ja: "これはSPIKESのInvitationを予後告知に応用したものです:質問の重要性を" +
                   "認め、どんな種類の答えを望むかを確認し、彼女が選んだ粒度で答える。予後" +
                   "告知の研究(Mackら;JSCO CST)は、患者の希望に粒度を合わせることが理解" +
                   "と感情的統合の双方を改善することを示しています。" } }
    ]
  },
  {
    // Round-2 clinical-educator edit (sim-output/round2-clinical-ebm.md,
    // Scenario 2 Edit 3 / "minor clinical gaps"): biliary stenting is an
    // immediate symptom-relief intervention the patient may want even if she
    // declines chemotherapy. Surface it as an explicit team vote rather than
    // a fait accompli buried in the MDT summary. Appended to the END (id-keyed).
    id: "dec_ercp_stent", module: "B", points: 20, penalty: 0,
    prompt: { en: "Mrs Tanaka has obstructive jaundice with distressing pruritus. The " +
                  "MDT has offered ERCP biliary stenting. She has NOT yet decided about " +
                  "chemotherapy. Your team's position on the stent is…",
              fr: "Mme Tanaka présente un ictère obstructif avec un prurit pénible. La RCP " +
                  "a proposé un drainage biliaire par CPRE. Elle n'a PAS encore décidé pour " +
                  "la chimiothérapie. La position de votre équipe sur le stent est…" ,
              ja: "田中さんは閉塞性黄疸でつらい掻痒を伴っています。多職種カンファレンスは " +
                  "ERCP による胆道ステント留置を提案しました。彼女は化学療法についてまだ" +
                  "決めていません。ステントに関するチームの立場は…" },
    options: [
      { text: { en: "Wait — don't offer the stent until she has decided about chemotherapy",
                fr: "Attendre — ne pas proposer le stent tant qu'elle n'a pas décidé pour la chimiothérapie",
                ja: "待つ — 化学療法を決めるまでステントは提案しない" },
        correct: false,
        why: { en: "Biliary stenting relieves the jaundice, the itch and the risk of " +
                   "cholangitis regardless of the cancer decision — it is a symptom-control " +
                   "intervention, not part of the chemotherapy pathway. Withholding it " +
                   "until she chooses chemotherapy needlessly prolongs her suffering and " +
                   "wrongly bundles a palliative comfort measure into a curative-intent " +
                   "decision.",
               fr: "Le drainage biliaire soulage l'ictère, le prurit et le risque " +
                   "d'angiocholite quelle que soit la décision oncologique — c'est un geste " +
                   "de contrôle des symptômes, pas une étape de la chimiothérapie. Le " +
                   "différer jusqu'à son choix de chimiothérapie prolonge inutilement sa " +
                   "souffrance et confond à tort une mesure de confort palliatif avec une " +
                   "décision à visée curative.",
               ja: "胆道ステントは、がんに関する決定とは無関係に黄疸・掻痒・胆管炎リスクを" +
                   "軽減します — これは症状コントロールの手技であって、化学療法の経路の一部" +
                   "ではありません。化学療法の選択まで保留することは、彼女の苦痛を不必要に" +
                   "長引かせ、緩和的な安楽措置を根治目的の決定と誤って束ねてしまいます。" } },
      { text: { en: "Offer the stent now for symptom relief, explaining it is independent of the chemotherapy decision",
                fr: "Proposer le stent maintenant pour soulager les symptômes, en expliquant qu'il est indépendant de la décision de chimiothérapie",
                ja: "症状緩和のため今ステントを提案し、化学療法の決定とは独立したものだと説明する" },
        correct: true,
        why: { en: "Correct. ERCP stenting is the right early offer: it relieves the " +
                   "obstructive jaundice and pruritus, reduces cholangitis risk, and can " +
                   "improve her quality of life and even her fitness for any chemotherapy " +
                   "she may later choose. Framing it explicitly as a comfort measure she " +
                   "can accept whether or not she wants chemotherapy respects her autonomy " +
                   "and separates symptom control from the bigger treatment decision.",
               fr: "Correct. Le drainage par CPRE est la bonne proposition précoce : il " +
                   "soulage l'ictère obstructif et le prurit, réduit le risque d'angiocholite, " +
                   "et peut améliorer sa qualité de vie et même son aptitude à une éventuelle " +
                   "chimiothérapie ultérieure. Le présenter explicitement comme une mesure de " +
                   "confort qu'elle peut accepter, qu'elle veuille ou non la chimiothérapie, " +
                   "respecte son autonomie et sépare le contrôle des symptômes de la décision " +
                   "thérapeutique plus large.",
               ja: "正解です。ERCP ステント留置は適切な早期提案です:閉塞性黄疸と掻痒を" +
                   "軽減し、胆管炎リスクを下げ、QOL を改善し、後に化学療法を選んだ場合の" +
                   "適応にも資する可能性があります。化学療法を望むか否かにかかわらず受け" +
                   "入れられる安楽措置として明確に提示することは、彼女の自律を尊重し、症状" +
                   "コントロールをより大きな治療決定から切り離すことになります。" } },
      { text: { en: "Insist she must accept the stent — refusing it would be irresponsible",
                fr: "Insister pour qu'elle accepte le stent — le refuser serait irresponsable",
                ja: "ステントを受けるべきだと迫る — 断るのは無責任だと伝える" },
        correct: false,
        why: { en: "Pressuring a competent patient to accept any intervention overrides her " +
                   "autonomy. The stent is strongly advisable for comfort, but it remains " +
                   "her choice — some patients decline procedures near the end of life. Your " +
                   "job is to make a clear, well-explained recommendation, not to coerce.",
               fr: "Faire pression sur une patiente apte pour qu'elle accepte un geste " +
                   "bafoue son autonomie. Le stent est fortement conseillé pour le confort, " +
                   "mais cela reste son choix — certains patients refusent des procédures en " +
                   "fin de vie. Votre rôle est de formuler une recommandation claire et bien " +
                   "expliquée, pas de contraindre.",
               ja: "判断能力のある患者にいかなる処置であれ受け入れるよう圧力をかけることは、" +
                   "彼女の自律を踏みにじります。ステントは安楽のために強く勧められますが、" +
                   "それでも選ぶのは彼女です — 終末期に処置を断る患者もいます。あなたの役割" +
                   "は、明確でよく説明された推奨を示すことであり、強制することではありません。" } }
    ]
  }
];

/* ===================== SCENARIO 3: Antibiotic Stewardship ===================
 * A 32-year-old French primary-care patient, Mme Moreau, presents with 5 days
 * of sore throat. The picture favours viral pharyngitis (cough, coryza, low
 * fever, no exudate, no tender anterior cervical adenopathy). She asks the
 * doctor for "the usual antibiotics" because she has a business trip on
 * Friday and "amoxicillin always works for me". Module A is the focused
 * clinical workup ending in a no-antibiotic recommendation with symptomatic
 * management and a safety net. Module B is the patient-pressure conversation,
 * compared across France and Japan.
 *
 * Clinical / pedagogical sources:
 *   - France: HAS 2021 — "Antibiothérapie par voie générale dans les
 *     infections respiratoires hautes de l'adulte et de l'enfant" — and
 *     SPILF guidance. McIsaac/Centor + rapid antigen test (TROD angine)
 *     are the documented decision tool; antibiotics are NOT indicated for
 *     viral pharyngitis.
 *   - UK: NICE NG84 (sore throat: antimicrobial prescribing, 2018) —
 *     FeverPAIN/Centor with delayed-prescribing as a recognised middle path.
 *   - US: CDC "Be Antibiotics Aware" — patient-facing communication
 *     scripts and the AAP/IDSA position that GAS testing should be reserved
 *     for patients with a Centor ≥ 2 picture.
 *   - Japan: AMR National Action Plan 2023-2027 (MHLW / 厚生労働省) —
 *     headline target of cutting outpatient oral antibiotic prescriptions
 *     by one third overall, with a SPECIFIC target of cutting prescriptions
 *     for respiratory tract infections by 50% by 2027. The 2018 fee-schedule
 *     revision created the 抗微生物薬適正使用加算 (Antimicrobial Stewardship
 *     Premium): primary-care clinicians who decide NOT to prescribe an
 *     antibiotic for a viral acute upper-respiratory infection in patients
 *     ≥ 6 months old can claim a small reimbursement, on the condition that
 *     the patient is counselled on viral aetiology and safety-netting.
 *
 * Pedagogical hook: the scenario asks Caen and Nagoya to compare a French
 * patient who arrives EXPECTING antibiotics (a culturally common pattern in
 * France, where per-capita antibiotic use remains among the highest in the
 * OECD) with the Japanese practice context, where MHLW policy has been
 * actively reshaping primary-care prescribing through both education and
 * payment design.
 * ========================================================================== */
var CASE_C = {
  history: [
    { q: { en: "What brings you in today?",
           fr: "Qu'est-ce qui vous amène aujourd'hui ?",
           ja: "今日はどうされましたか?" },
      a: { en: "I've had a really sore throat for about five days now. It started with a tickle, then a runny nose, and now my throat is killing me when I swallow. I've also got this annoying cough that won't go away.",
           fr: "J'ai mal à la gorge depuis environ cinq jours. Ça a commencé par un picotement, puis le nez qui coule, et maintenant la gorge me fait vraiment mal quand j'avale. J'ai aussi une toux agaçante qui ne passe pas.",
           ja: "5日ほど前からのどがひどく痛いんです。最初はちょっとしたイガイガから始まって、それから鼻水が出るようになって、今は飲み込むときにのどが本当に痛くて。あと、ずっと続く厄介な咳もあります。" } },
    { q: { en: "Fever, chills, any difficulty swallowing solids or your own saliva, or drooling?",
           fr: "Fièvre, frissons, difficulté à avaler les solides ou votre propre salive, hypersalivation ?",
           ja: "発熱、悪寒、固形物や唾液を飲み込みづらい、よだれが出るなどありますか?" },
      a: { en: "I felt a bit warm on day two — I took my temperature, it was 37.8°C. No real shivers, no shakes. I can still eat and drink, just slowly because it hurts. No drooling — I'm not THAT bad.",
           fr: "Je me suis sentie un peu fébrile le deuxième jour — j'ai pris ma température, c'était 37,8°C. Pas vraiment de frissons. Je peux toujours manger et boire, juste lentement parce que ça fait mal. Pas d'hypersalivation — je ne suis pas À CE POINT mal.",
           ja: "2日目に少し熱っぽくて — 体温を測ったら37.8°Cでした。本当の悪寒や震えはありません。食事も水分も摂れますが、痛いのでゆっくりです。よだれは出ていません — そこまでひどくはありません。" } },
    { q: { en: "Any cough, runny nose, or hoarseness with the sore throat?",
           fr: "Toux, rhinorrhée ou enrouement avec le mal de gorge ?",
           ja: "のどの痛みに加えて、咳、鼻水、嗄声(声がれ)はありますか?" },
      a: { en: "Yes — cough since day three, dry mostly, sometimes a bit of clear phlegm. Runny nose since the beginning, also clear. My voice was hoarse yesterday, a bit better today.",
           fr: "Oui — toux depuis le troisième jour, sèche principalement, parfois un peu de glaires claires. Le nez coule depuis le début, c'est également clair. Ma voix était enrouée hier, un peu mieux aujourd'hui.",
           ja: "はい — 3日目から咳が出ていて、ほとんどは乾いた咳ですが、ときどき透明な痰が少しあります。鼻水は最初から出ていて、こちらも透明です。昨日は声が嗄れていて、今日は少し良くなっています。" } },
    { q: { en: "What have you already tried, and why are you here today?",
           fr: "Qu'avez-vous déjà essayé, et pourquoi consultez-vous aujourd'hui ?",
           ja: "これまでに何を試されましたか、そして今日受診された理由は?" },
      a: { en: "Paracetamol, lemon-and-honey, throat lozenges. Honestly the paracetamol does help. But I've got a big client presentation in Frankfurt on Friday — three days from now — and I cannot be on a stage like this. Last year when this happened my GP gave me amoxicillin and I was fine by the second day. So really I just need the prescription.",
           fr: "Du paracétamol, du miel-citron, des pastilles pour la gorge. Honnêtement, le paracétamol m'aide. Mais j'ai une grosse présentation client à Francfort vendredi — dans trois jours — et je ne peux pas monter sur scène dans cet état. L'année dernière quand ça m'est arrivé, mon médecin m'a donné de l'amoxicilline et le deuxième jour j'allais bien. Alors j'ai juste besoin de l'ordonnance.",
           ja: "アセトアミノフェン、はちみつレモン、のど飴です。正直アセトアミノフェンは効いています。でも金曜日 — 3日後ですが — フランクフルトで大事なクライアント向けプレゼンがあって、こんな状態では人前に立てません。昨年同じことがあったとき、かかりつけの医師がアモキシシリンを出してくれて2日目には良くなりました。なので、本当に処方箋だけで大丈夫です。" } },
    { q: { en: "Past medical history, regular medication, allergies?",
           fr: "Antécédents médicaux, traitements habituels, allergies ?",
           ja: "既往歴、常用薬、アレルギーは?" },
      a: { en: "I'm generally well. No long-term conditions. I take the combined oral contraceptive pill. No medication allergies that I know of — I've had amoxicillin a few times without any problem. I had my tonsils out as a child.",
           fr: "Je suis en bonne santé en général. Pas de pathologie chronique. Je prends la pilule contraceptive œstroprogestative. Pas d'allergie médicamenteuse à ma connaissance — j'ai pris de l'amoxicilline plusieurs fois sans problème. J'ai été amygdalectomisée enfant.",
           ja: "全体的に健康です。慢性疾患はありません。混合経口避妊薬を服用しています。知っている限り薬物アレルギーはなく — アモキシシリンも何度か飲んでいますが問題ありません。子供のころ扁桃摘出術を受けました。" } },
    { q: { en: "Smoking, alcohol, contact with anyone unwell, recent travel or sexual exposure?",
           fr: "Tabac, alcool, contact avec une personne malade, voyage récent ou exposition sexuelle ?",
           ja: "喫煙、飲酒、体調不良の方との接触、最近の渡航歴や性交渉歴は?" },
      a: { en: "I don't smoke, a glass of wine in the evenings. My partner had the same thing last week and got better on his own in about a week. No travel since the summer. I'm in a stable monogamous relationship.",
           fr: "Je ne fume pas, un verre de vin le soir. Mon compagnon a eu la même chose la semaine dernière et il s'en est sorti tout seul en une semaine environ. Pas de voyage depuis l'été. Je suis dans une relation stable et monogame.",
           ja: "喫煙はしません、夜にワインを1杯飲みます。同居しているパートナーが先週同じ症状で、1週間ほどで自然に治りました。夏以降は渡航していません。安定した一対一の関係です。" } },
    { q: { en: "Screen for red flags: difficulty breathing, neck stiffness, severe one-sided throat pain, voice change (\"hot-potato\" voice), unable to swallow saliva, or a rash?",
           fr: "Dépister les drapeaux rouges : difficulté respiratoire, raideur de nuque, douleur pharyngée unilatérale sévère, voix modifiée (« patate chaude »), incapacité à avaler la salive, ou éruption cutanée ?",
           ja: "レッドフラッグのスクリーニング:呼吸困難、項部硬直、片側性の強い咽頭痛、こもったような声(「熱いポテト」声)、唾液が飲み込めない、皮疹はありますか?" },
      a: { en: "No — I can breathe fine. My neck is a bit sore where the glands are but I can move it normally. The pain is on both sides about the same. My voice is just hoarse, not muffled. No rash anywhere.",
           fr: "Non — je respire bien. Mon cou est un peu sensible au niveau des ganglions mais je le bouge normalement. La douleur est à peu près symétrique. Ma voix est juste enrouée, pas étouffée. Pas d'éruption nulle part.",
           ja: "いいえ — 呼吸は問題ありません。リンパ節のあたりが少し痛みますが、首は普通に動かせます。痛みは両側でほぼ同じです。声は単に嗄れているだけで、こもってはいません。発疹もどこにもありません。" } },
    /* --- the following two are deliberately POOR opening moves; the platform
       deducts points for them. Indices 7 and 8 — referenced by PENALTIES_C. */
    { q: { en: "All right — shall I write you a 5-day course of amoxicillin so you're set for Friday?",
           fr: "D'accord — je vous prescris une cure d'amoxicilline de 5 jours pour que vous soyez prête vendredi ?",
           ja: "わかりました — 金曜日に間に合うようアモキシシリンを5日分処方しましょうか?" },
      a: { en: "She smiles broadly: \"Oh thank you doctor, you're the only sensible one!\" (You have just promised an antibiotic before completing the assessment, scoring her Centor/McIsaac criteria, or even discussing whether antibiotics would actually shorten her illness. The rest of the consultation is now about confirming that promise, not exploring whether antibiotics are indicated — and you have reinforced the very pattern that drives community antibiotic resistance.)",
           fr: "Elle sourit largement : « Oh merci docteur, vous êtes la seule personne raisonnable ! » (Vous venez de promettre un antibiotique avant d'avoir complété l'évaluation, calculé son score de Centor/McIsaac, ou même discuté du fait que les antibiotiques raccourciraient réellement sa maladie. Le reste de la consultation tourne désormais autour de la confirmation de cette promesse, et non de l'exploration de l'indication réelle — et vous avez renforcé le schéma même qui alimente la résistance bactérienne communautaire.)",
           ja: "彼女は満面の笑みを浮かべます:「先生ありがとうございます、まともな先生に当たって良かった!」(あなたは評価を完了させる前、Centor/McIsaacスコアを算出する前、抗生物質が実際に病気を短縮するかを話し合う前に、抗生物質を約束してしまいました。診察の残りは、抗生物質が適応かを掘り下げるのではなく、その約束を確認することを中心に進むことになります — そしてあなたは、地域での薬剤耐性を生み出すまさにそのパターンを強化してしまいました。)" } },
    { q: { en: "Honestly, it's just a cold — there's nothing to do, you'll get over it. Take some paracetamol and wait.",
           fr: "Honnêtement, ce n'est qu'un rhume — il n'y a rien à faire, ça passera. Prenez du paracétamol et attendez.",
           ja: "正直、ただの風邪です — どうしようもありません、そのうち治ります。アセトアミノフェンを飲んで様子を見てください。" },
      a: { en: "Her face hardens. \"That's exactly what I was afraid of. You're not even examining me. I have a flight on Friday — does my throat just being 'a cold' magically clear up by then? Maybe I'll see someone else.\" (You have dismissed her concern, skipped the examination, given no advice on what to actually do, and offered no safety-net. \"It's just a virus\" without listening and without a plan is heard as not caring — and it loses the consultation.)",
           fr: "Son visage se ferme. « C'est exactement ce que je craignais. Vous ne m'examinez même pas. J'ai un avion vendredi — mon mal de gorge va comme par magie disparaître d'ici là parce que c'est ‟juste un rhume” ? Je vais peut-être aller voir quelqu'un d'autre. » (Vous avez balayé son inquiétude, sauté l'examen, ne lui avez donné aucun conseil concret sur ce qu'elle doit faire, et n'avez proposé aucun filet de sécurité. « C'est juste un virus » sans écouter et sans plan est entendu comme du désintérêt — et cela fait perdre la consultation.)",
           ja: "彼女の表情がこわばります。「それこそが私が恐れていたことです。診察すらしてくださらないんですね。金曜日にフライトがあるんです — のどがただの『風邪』だからって、それまでに魔法のように治るんですか?他の先生に診てもらおうかしら。」(あなたは彼女の不安を一蹴し、診察を省き、実際にどうすればよいかの助言もせず、セーフティネットも示しませんでした。きちんと聴かず、計画も示さずに「ただのウイルスです」と言うのは、関心を持たれていないと受け取られます — そして診察は失敗に終わります。)" } }
  ],
  exam: [
    { q: { en: "General observation and vital signs",
           fr: "Observation générale et constantes",
           ja: "全身観察とバイタルサイン" },
      a: { en: "Comfortable, well-hydrated, no respiratory distress, no drooling. Temperature 37.4°C, pulse 78, BP 118/72, SpO2 99% on room air, respiratory rate 14.",
           fr: "Confortable, bien hydratée, pas de détresse respiratoire, pas d'hypersalivation. Température 37,4°C, pouls 78, TA 118/72, SpO2 99% à l'air ambiant, fréquence respiratoire 14.",
           ja: "状態良好、水分摂取良好、呼吸困難なし、流涎なし。体温37.4°C、脈拍78、血圧118/72、室内気でSpO2 99%、呼吸数14。" } },
    { q: { en: "Throat examination (oropharynx and tonsillar fossae)",
           fr: "Examen pharyngé (oropharynx et loges amygdaliennes)",
           ja: "咽頭診察(中咽頭と扁桃窩)" },
      a: { en: "Diffusely erythematous oropharynx. Tonsillar fossae are surgically absent (childhood tonsillectomy noted), so no tonsillar enlargement and no tonsillar exudate to assess. Uvula midline, no peritonsillar bulge or trismus.",
           fr: "Oropharynx diffusément érythémateux. Loges amygdaliennes chirurgicalement absentes (amygdalectomie dans l'enfance, déjà notée), donc pas d'hypertrophie amygdalienne ni d'exsudat amygdalien à évaluer. Luette médiane, pas de bombement péri-amygdalien ni de trismus.",
           ja: "中咽頭はびまん性に発赤。扁桃窩は手術により欠損(小児期の扁桃摘出が既往にあり)、そのため扁桃肥大や扁桃滲出液の評価は不可。口蓋垂は正中、扁桃周囲の膨隆や開口障害なし。" } },
    { q: { en: "Cervical lymph node palpation",
           fr: "Palpation des ganglions cervicaux",
           ja: "頸部リンパ節触診" },
      a: { en: "No tender anterior cervical lymphadenopathy. A few small (< 1 cm), soft, mobile posterior cervical nodes — non-tender. No supraclavicular nodes.",
           fr: "Pas d'adénopathie cervicale antérieure douloureuse. Quelques petits ganglions cervicaux postérieurs (< 1 cm), souples, mobiles — non douloureux. Pas de ganglion sus-claviculaire.",
           ja: "圧痛を伴う前頸部リンパ節腫脹なし。後頸部に1 cm未満の小さく、軟らかく可動性のあるリンパ節をいくつか触知 — 圧痛なし。鎖骨上リンパ節なし。" } },
    { q: { en: "Focused ENT and chest examination",
           fr: "Examen ORL ciblé et examen thoracique",
           ja: "焦点を絞った耳鼻咽喉科診察と胸部診察" },
      a: { en: "Tympanic membranes normal bilaterally. Nasal mucosa congested with clear discharge. Chest clear, vesicular breath sounds throughout, no crackles or wheeze.",
           fr: "Tympans normaux des deux côtés. Muqueuse nasale congestionnée avec écoulement clair. Auscultation pulmonaire claire, murmure vésiculaire partout, pas de râles ni de sibilances.",
           ja: "両側鼓膜は正常。鼻粘膜は腫脹し、透明な分泌物あり。胸部聴診清明、全体に肺胞呼吸音、ラ音や喘鳴なし。" } },
    { q: { en: "Score the McIsaac/Centor criteria for her",
           fr: "Calculer son score McIsaac/Centor",
           ja: "McIsaac/Centorスコアを算出する" },
      a: { en: "Centor / McIsaac points: history of fever > 38°C — NO (max 37.8°C, currently 37.4°C); absence of cough — NO (she has a cough); tender anterior cervical lymphadenopathy — NO; tonsillar swelling/exudate — N/A (post-tonsillectomy); age 3-14 / 15-44 / ≥ 45 — age 32, score 0. TOTAL Centor 0, McIsaac 0. Probability of group A streptococcal infection is very low (~ 1-2.5%). Guidelines (HAS 2021, NICE NG84, CDC) DO NOT recommend antibiotics or even a rapid antigen test at this score — the clinical picture is viral pharyngitis.",
           fr: "Points Centor / McIsaac : antécédent de fièvre > 38°C — NON (max 37,8°C, actuellement 37,4°C) ; absence de toux — NON (elle tousse) ; adénopathie cervicale antérieure douloureuse — NON ; hypertrophie/exsudat amygdalien — N/A (post-amygdalectomie) ; âge 3-14 / 15-44 / ≥ 45 — âge 32, score 0. TOTAL Centor 0, McIsaac 0. La probabilité d'une infection à streptocoque du groupe A est très faible (~ 1-2,5%). Les recommandations (HAS 2021, NICE NG84, CDC) ne recommandent NI antibiotique NI test antigénique rapide à ce score — le tableau clinique est celui d'une pharyngite virale.",
           ja: "Centor / McIsaacの各項目:38°C超の発熱の既往 — なし(最高37.8°C、現在37.4°C);咳がない — 該当せず(咳あり);圧痛を伴う前頸部リンパ節腫脹 — なし;扁桃腫脹/滲出液 — 評価不能(扁桃摘出後);年齢 3-14 / 15-44 / ≥ 45 — 32歳でスコア0。合計 Centor 0、McIsaac 0。A群溶連菌感染症の確率は非常に低い(約1-2.5%)。各ガイドライン(HAS 2021、NICE NG84、CDC)はこのスコアでは抗生物質も迅速抗原検査も推奨していません — 臨床像はウイルス性咽頭炎です。" } },
    /* --- the following is a deliberately UNFOCUSED examination choice; index 5
       — referenced by PENALTIES_C. */
    { q: { en: "Full neurological and abdominal examination",
           fr: "Examen neurologique et abdominal complet",
           ja: "神経学的および腹部の完全な診察" },
      a: { en: "Cranial nerves and limb neurology normal, abdomen soft and non-tender. (Nothing in the history points to a neurological or abdominal problem. This is the scattergun examination — it signals to Mme Moreau that you are searching at random instead of completing the focused ENT workup she needed, and it eats time the case really needed for the stewardship conversation.)",
           fr: "Paires crâniennes et neurologie des membres normales, abdomen souple et non douloureux. (Rien dans l'anamnèse n'oriente vers un problème neurologique ou abdominal. C'est l'examen au hasard — il signale à Mme Moreau que vous cherchez à l'aveugle au lieu de compléter le bilan ORL ciblé qu'elle attendait, et cela consomme du temps de consultation dont le cas avait réellement besoin pour la conversation sur le bon usage des antibiotiques.)",
           ja: "脳神経と四肢神経学的所見は正常、腹部は柔らかく圧痛なし。(病歴に神経学的または腹部の問題を示唆する所見はありません。これは手当たり次第の診察です — Mme Moreau に対し、彼女が必要としていた焦点を絞った耳鼻咽喉科のワークアップを完了させるのではなく、当てずっぽうに探っている印象を与え、抗菌薬適正使用の会話に必要だった診察時間を消費してしまいます。)" } }
  ],
  labs: [
    { q: { en: "Clinical synthesis and stewardship plan  (unlocks the discussion prompts)",
           fr: "Synthèse clinique et plan de bon usage des antibiotiques  (débloque les questions de discussion)",
           ja: "臨床的総合判断と抗菌薬適正使用の計画  (ディスカッション課題を解除)" },
      key: true,
      a: { en: "You have taken a focused history, screened the red flags (no airway compromise, no peritonsillar abscess, no Lemierre-suggestive unilateral neck pain, no rash), examined the throat and neck, and scored Centor / McIsaac at 0. The picture — cough, coryza, hoarseness, low-grade fever, bilateral diffuse pharyngeal erythema, no tender anterior nodes, household contact with the same self-limiting illness — is viral pharyngitis. Antibiotics are NOT indicated: they do not shorten viral illness, they will not get her on the Frankfurt stage any faster, and at population scale they drive resistance and harm her own future microbiome. The job of this consultation is therefore: (1) explain what she has and what she does NOT have, in plain language; (2) give a real symptomatic plan (paracetamol scheduled, NSAID, fluids, voice rest, salt-water gargles, throat lozenges); (3) address the business trip directly — name what helps (analgesia + voice rest + hydration on the flight) and what does not (a 5-day amoxicillin course she would only be on day 3 of by Friday); (4) safety-net clearly (return if breathing difficulty, drooling, unilateral severe pain, can't swallow saliva, fever > 38.5°C beyond day 7); (5) consider whether a 'delayed' / 'back-pocket' prescription is the right tool here or whether it just outsources the decision. Then work through the prompts below.",
           fr: "Vous avez mené un interrogatoire ciblé, dépisté les drapeaux rouges (pas de menace des voies aériennes, pas d'abcès péri-amygdalien, pas de douleur cervicale unilatérale évocatrice de Lemierre, pas d'éruption), examiné la gorge et le cou, et calculé un score Centor / McIsaac à 0. Le tableau — toux, rhinorrhée, enrouement, fébricule, érythème pharyngé diffus bilatéral, pas de ganglion antérieur douloureux, contact familial avec la même maladie à résolution spontanée — est celui d'une pharyngite virale. Les antibiotiques NE sont PAS indiqués : ils ne raccourcissent pas une maladie virale, ils ne la remettront pas sur scène à Francfort plus vite, et à l'échelle de la population ils alimentent la résistance et nuisent à son propre microbiote futur. La tâche de cette consultation est donc : (1) expliquer ce qu'elle a et ce qu'elle n'a PAS, en mots simples ; (2) donner un vrai plan symptomatique (paracétamol systématique, AINS, hydratation, repos vocal, gargarismes salés, pastilles) ; (3) aborder directement le voyage d'affaires — nommer ce qui aide (antalgie + repos vocal + hydratation dans l'avion) et ce qui n'aide pas (une cure d'amoxicilline de 5 jours dont elle ne serait qu'au 3e jour vendredi) ; (4) établir un filet de sécurité clair (reconsulter si difficulté respiratoire, hypersalivation, douleur unilatérale sévère, incapacité à avaler la salive, fièvre > 38,5°C au-delà du 7e jour) ; (5) décider si une prescription « différée » / « de réserve » est ici le bon outil ou si elle ne fait que sous-traiter la décision. Puis traitez les questions ci-dessous.",
           ja: "あなたは焦点を絞った病歴聴取を行い、レッドフラッグをスクリーニングし(気道狭窄なし、扁桃周囲膿瘍なし、Lemierre症候群を示唆する片側性頸部痛なし、皮疹なし)、咽頭と頸部を診察し、Centor / McIsaacスコアを0と算出しました。所見 — 咳、鼻汁、嗄声、軽度の発熱、両側びまん性の咽頭発赤、圧痛を伴う前頸部リンパ節なし、家族内で同様の自然軽快性疾患の接触歴 — はウイルス性咽頭炎に合致します。抗生物質の適応はありません:ウイルス性疾患を短縮させず、彼女をフランクフルトの舞台に早く戻すこともなく、集団レベルでは薬剤耐性を生み、彼女自身の将来の腸内細菌叢にも害を与えます。したがってこの診察の課題は:(1) 何があり、何がないかを平易な言葉で説明する;(2) 実効性のある対症療法プラン(アセトアミノフェンの定時投与、NSAID、水分摂取、声の休息、塩水うがい、のど飴)を提示する;(3) 出張について直接取り上げ — 何が役立つか(鎮痛+声の休息+機内での水分摂取)と何が役立たないか(金曜日でも服用開始3日目にしかならない5日間のアモキシシリン)を名指しで伝える;(4) 明確なセーフティネット(呼吸困難、流涎、片側性の強い痛み、唾液が飲み込めない、第7病日を超えても38.5°C以上の発熱があれば再診)を提示する;(5) 「遅延処方」/「とっておき処方」がここでの正しい手段か、それとも単に判断を先送りしているだけかを検討する。その後、下記の課題に取り組んでください。" } },
    { q: { en: "Rapid antigen detection test for group A streptococcus (TROD angine in France)",
           fr: "Test rapide d'orientation diagnostique pour le streptocoque A (TROD angine)",
           ja: "A群溶連菌迅速抗原検査(フランスではTROD angine)" },
      a: { en: "If performed: negative. (Note: French and international guidance is to use the RADT only when Centor / McIsaac ≥ 2. At her score of 0 the test is NOT indicated — the pre-test probability of streptococcal infection is already low enough that a negative test changes nothing and a (false-) positive test would expose her to an antibiotic she does not need. The TROD is a decision aid, not a screening test.)",
           fr: "Si réalisé : négatif. (Note : les recommandations françaises et internationales sont d'utiliser le TROD uniquement lorsque le Centor / McIsaac ≥ 2. À son score de 0, le test N'est PAS indiqué — la probabilité pré-test d'infection streptococcique est déjà suffisamment faible pour qu'un test négatif ne change rien et qu'un test (faussement) positif l'expose à un antibiotique inutile. Le TROD est une aide à la décision, pas un test de dépistage.)",
           ja: "施行した場合:陰性。(注:フランスおよび国際的なガイドラインは、Centor / McIsaac ≥ 2 の場合にのみ迅速抗原検査を使用するよう推奨しています。スコア0の彼女には適応がありません — 検査前確率がすでに十分低いため、陰性結果は何も変えず、(偽)陽性結果は不要な抗生物質に彼女を曝露させてしまいます。TRODは意思決定の補助ツールであり、スクリーニング検査ではありません。)" } },
    { q: { en: "Throat swab for bacterial culture",
           fr: "Prélèvement de gorge pour culture bactérienne",
           ja: "細菌培養のための咽頭スワブ" },
      a: { en: "After 48 hours: normal pharyngeal flora, no group A streptococcus. (Note: a throat culture takes 2 days to result — by which time her viral illness is already resolving on its own. It cannot guide a clinical decision today. Cultures are used in specific contexts — recurrent infections, suspected diphtheria, surveillance — and are not indicated for routine viral pharyngitis.)",
           fr: "À 48 heures : flore pharyngée normale, pas de streptocoque du groupe A. (Note : une culture met 2 jours à rendre son résultat — d'ici là sa maladie virale est déjà en train de guérir spontanément. Elle ne peut pas guider une décision clinique aujourd'hui. Les cultures sont utilisées dans des contextes spécifiques — infections récidivantes, suspicion de diphtérie, surveillance — et ne sont pas indiquées pour une pharyngite virale banale.)",
           ja: "48時間後:正常咽頭フローラ、A群溶連菌は検出されず。(注:培養は結果が出るまで2日かかります — その頃には彼女のウイルス性疾患はすでに自然軽快に向かっています。今日の臨床判断を導くことはできません。培養は特定の状況 — 反復感染、ジフテリア疑い、サーベイランス — で用いられるもので、通常のウイルス性咽頭炎には適応がありません。)" } },
    { q: { en: "Full blood count, CRP and 'just check the liver while we're at it'",
           fr: "NFS, CRP et « tant qu'on y est, on contrôle aussi le foie »",
           ja: "全血球計算、CRP、そして「ついでに肝機能も診ておきましょう」" },
      a: { en: "Mildly elevated lymphocytes, CRP 12 mg/L (very mildly raised, non-specific), liver function normal. (Note: in a well, immunocompetent adult with a clinical picture of viral pharyngitis, blood tests are NOT indicated — they do not distinguish viral from bacterial pharyngitis reliably, the mild CRP rise will tempt some clinicians toward an antibiotic they should not prescribe, and the LFTs are completely irrelevant. \"Just check it while we're at it\" is the opposite of focused investigation.)",
           fr: "Lymphocytes légèrement augmentés, CRP 12 mg/L (très légèrement élevée, non spécifique), bilan hépatique normal. (Note : chez une adulte en bonne santé, immunocompétente, avec un tableau clinique de pharyngite virale, le bilan sanguin N'est PAS indiqué — il ne permet pas de distinguer de façon fiable une pharyngite virale d'une pharyngite bactérienne, l'élévation modérée de la CRP poussera certains cliniciens à prescrire un antibiotique non indiqué, et le bilan hépatique est totalement hors-sujet. « Tant qu'on y est » est l'opposé d'un bilan ciblé.)",
           ja: "リンパ球軽度増多、CRP 12 mg/L(非常にわずかな上昇で非特異的)、肝機能は正常。(注:免疫健常な健康成人で臨床像がウイルス性咽頭炎の場合、血液検査の適応はありません — ウイルス性と細菌性咽頭炎を確実に区別できず、軽度のCRP上昇は本来処方すべきでない抗生物質の処方へと一部の医師を誘導しかねず、肝機能検査は完全に無関係です。「ついでに調べておきましょう」は焦点を絞った検査の正反対です。)" } },
    /* --- another deliberately wrong investigation choice; index 4. */
    { q: { en: "Empirical 5-day course of amoxicillin 1 g three times daily",
           fr: "Cure empirique d'amoxicilline 1 g trois fois par jour pendant 5 jours",
           ja: "アモキシシリン1 gを1日3回、5日間の経験的処方" },
      a: { en: "Three days later she returns: \"It worked again, doctor!\" — but her sore throat would have settled by then anyway, AND now she has had three days of unnecessary antibiotic with the side-effects (GI upset, rash, ~ 1 in 1000 risk of C. difficile, ~ 1 in 10 000 risk of serious allergic reaction), AND her experience of \"amoxicillin always works\" is now even more strongly anchored, AND her contribution to community resistance is one course higher. \"It worked\" is not the same as \"it was needed\".",
           fr: "Trois jours plus tard, elle revient : « Ça a encore marché, docteur ! » — mais sa pharyngite aurait de toute façon cédé d'ici là, ET elle a maintenant pris trois jours d'antibiotique inutile avec les effets secondaires (troubles digestifs, éruption, risque d'environ 1 sur 1 000 d'infection à C. difficile, risque d'environ 1 sur 10 000 de réaction allergique grave), ET son vécu « l'amoxicilline marche toujours » est maintenant encore plus solidement ancré, ET sa contribution à la résistance bactérienne communautaire est d'une cure de plus. « Ça a marché » n'est pas la même chose que « c'était nécessaire ».",
           ja: "3日後に彼女は再診し:「先生、また効きました!」と言います — しかし彼女の咽頭痛はいずれにせよその頃には自然軽快しており、しかも不要な抗生物質を3日間服用した結果として副作用(消化器症状、皮疹、約1/1000のC. difficile感染リスク、約1/10 000の重篤なアレルギー反応リスク)を負い、しかも「アモキシシリンはいつも効く」という体験はさらに強く刻まれ、しかも地域での薬剤耐性への寄与は1コース分増えました。「効いた」は「必要だった」と同じではありません。" } }
  ],
  prompts: [
    { en: "Explanation skill: in plain language, how would you tell Mme Moreau that an antibiotic will not help her get to Frankfurt — without sounding like you're refusing her care? Try saying it out loud in two or three sentences, in the words you would actually use.",
      fr: "Compétence d'explication : avec des mots simples, comment diriez-vous à Mme Moreau qu'un antibiotique ne l'aidera pas à se rendre à Francfort — sans donner l'impression de refuser de la soigner ? Essayez de le dire à voix haute en deux ou trois phrases, avec les mots que vous emploieriez vraiment.",
      ja: "説明スキル:Mme Moreau に対し、抗生物質ではフランクフルトに行けるようにはならないことを、彼女のケアを拒否しているように聞こえないように、平易な言葉でどう伝えますか?実際に使う言葉で2~3文、声に出して言ってみましょう。" },
    { en: "The 'business trip on Friday' problem: she has a real, time-bound need. Build a symptomatic plan that addresses the trip directly — analgesia schedule, voice management, in-flight hydration, when to use NSAID vs paracetamol, what to do if it gets WORSE the morning of the flight. The single most important sentence to her about the trip is…?",
      fr: "Le problème du « voyage d'affaires vendredi » : elle a un besoin réel, avec une échéance. Construisez un plan symptomatique qui aborde directement le voyage — schéma antalgique, gestion de la voix, hydratation en vol, quand utiliser un AINS plutôt que le paracétamol, conduite à tenir si cela s'aggrave le matin du vol. La phrase la plus importante à lui dire à propos du voyage est… ?",
      ja: "「金曜日の出張」問題:彼女には時間に縛られた本当のニーズがあります。出張を直接取り上げる対症療法プラン(鎮痛のスケジュール、声のマネジメント、機内の水分摂取、NSAIDとアセトアミノフェンの使い分け、フライト当日の朝に悪化した場合の対応)を立てましょう。出張について彼女に伝えるべき最も重要な一文は何ですか?" },
    { en: "Delayed (back-pocket) prescribing: NICE NG84 and several French primary-care networks recognise delayed prescribing as a middle path — the patient leaves with a prescription but is asked not to fill it unless they get worse over 48-72 hours. Is this clinically sound stewardship, or is it just the doctor outsourcing the decision to the pharmacist and the patient? Caen and Nagoya — is this used in your country?",
      fr: "Prescription différée (« de réserve ») : NICE NG84 et plusieurs réseaux français de soins primaires reconnaissent la prescription différée comme une voie intermédiaire — le patient repart avec une ordonnance mais on lui demande de ne pas l'utiliser sauf en cas d'aggravation à 48-72 heures. Est-ce un bon usage cliniquement solide, ou n'est-ce que le médecin qui sous-traite la décision au pharmacien et au patient ? Caen et Nagoya — cette pratique existe-t-elle dans votre pays ?",
      ja: "遅延処方(「とっておき処方」):NICE NG84 とフランスの複数のプライマリ・ケアネットワークは、遅延処方を中間的な手段として認めています — 患者は処方箋を持ち帰りますが、48-72時間で悪化しない限り使わないよう求められます。これは臨床的に妥当な抗菌薬適正使用なのか、それとも医師が判断を薬剤師と患者に外注しているだけなのか?Caen と名古屋 — あなたの国ではこの実践はありますか?" },
    { en: "Compare France & Japan — patient expectations of antibiotics: France has one of the highest per-capita oral antibiotic consumption rates in the OECD, with a long-standing expectation in some patient groups that a sore throat warrants amoxicillin. Japan's MHLW AMR National Action Plan 2023-2027 targets a 50% reduction in respiratory-infection prescriptions by 2027, building on the 2018 fee-schedule revision that created the 抗微生物薬適正使用加算 (Antimicrobial Stewardship Premium) — a small but symbolically powerful reimbursement for NOT prescribing. Caen and Nagoya: how does that translate into a Friday morning consultation room?",
      fr: "Comparaison France-Japon — attentes des patients vis-à-vis des antibiotiques : la France a l'une des consommations d'antibiotiques oraux par habitant les plus élevées de l'OCDE, avec une attente bien ancrée dans certaines populations de patients qu'un mal de gorge mérite de l'amoxicilline. Le Plan national antibiorésistance 2023-2027 du MHLW japonais vise une réduction de 50% des prescriptions pour infections respiratoires d'ici 2027, en s'appuyant sur la réforme tarifaire de 2018 qui a créé le 抗微生物薬適正使用加算 (forfait « bon usage des antimicrobiens ») — un remboursement modeste mais symboliquement fort pour NE PAS prescrire. Caen et Nagoya : comment cela se traduit-il dans une salle de consultation un vendredi matin ?",
      ja: "フランスと日本の比較 — 抗生物質に対する患者の期待:フランスは経口抗生物質の一人当たり消費量がOECDの中で最も高い水準にあり、一部の患者層には「のどが痛ければアモキシシリン」という長年の期待があります。日本のMHLWによるAMR対策国家行動計画2023-2027は2027年までに呼吸器感染症への処方を50%削減することを目標としており、その基盤として2018年の診療報酬改定では、処方しないことに対する小さくとも象徴的に強い報酬として「抗微生物薬適正使用加算」が新設されました。Caen と名古屋:これは金曜午前の診察室でどう実装されますか?" },
    { en: "Compare France & Japan — the financial signal: in France, the consultation fee is the same whether you prescribe or not. In Japan, since 2018, a primary-care clinician who decides NOT to prescribe an antibiotic for an acute viral URI (in a patient aged ≥ 6 months) and documents the patient counselling can claim the 抗微生物薬適正使用加算 — a financial incentive to do the harder, slower thing. Should France introduce something analogous, or is it ethically off to pay doctors for omissions? Debate.",
      fr: "Comparaison France-Japon — le signal financier : en France, le tarif de la consultation est le même que vous prescriviez ou non. Au Japon, depuis 2018, un médecin de soins primaires qui décide de NE PAS prescrire d'antibiotique pour une infection virale aiguë des voies respiratoires (chez un patient ≥ 6 mois) et qui documente le conseil donné peut facturer le 抗微生物薬適正使用加算 — une incitation financière à faire la chose la plus difficile et la plus lente. La France devrait-elle introduire quelque chose d'analogue, ou est-il éthiquement problématique de rémunérer les médecins pour des omissions ? Débattez.",
      ja: "フランスと日本の比較 — 経済的シグナル:フランスでは処方の有無にかかわらず診察料は同じです。日本では2018年以降、急性ウイルス性上気道感染症(生後6か月以上の患者)に対し抗生物質を処方しないと決定し、患者への説明を記録した場合に、プライマリ・ケアの医師は「抗微生物薬適正使用加算」を算定できます — より難しく時間のかかる選択をすることへの経済的インセンティブです。フランスも類似の仕組みを導入すべきでしょうか、それとも「しないこと」に医師が報酬を受けるのは倫理的に問題でしょうか?議論してください。" },
    { en: "Compare France & Japan — antimicrobial resistance as 'somebody else's problem': resistance is a population-level harm — one patient who gets an unnecessary amoxicillin is barely affected, but the millions over a decade are. In your country, how do clinicians actually weigh \"this individual patient in front of me, this Friday\" against \"the next generation's working antibiotics\"? Is this a real lived tension or a slogan?",
      fr: "Comparaison France-Japon — la résistance comme « problème des autres » : la résistance est un dommage de niveau populationnel — un seul patient qui reçoit une amoxicilline inutile est à peine concerné, mais les millions sur une décennie le sont. Dans votre pays, comment les cliniciens arbitrent-ils réellement entre « cette patiente devant moi, ce vendredi » et « les antibiotiques qui fonctionneront encore pour la génération suivante » ? Est-ce une tension vécue réelle ou un slogan ?",
      ja: "フランスと日本の比較 — 薬剤耐性は「他人事」か:耐性は集団レベルの害です — 不要なアモキシシリンを服用した一人の患者にはほとんど影響しませんが、10年で何百万人ともなれば話は別です。あなたの国では臨床医は「目の前のこの患者、この金曜日」と「次の世代に残せる効く抗生物質」を実際にどう天秤にかけていますか?これは本当に体感される葛藤でしょうか、それともスローガンに過ぎませんか?" },
    { en: "Compare France & Japan — the patient who already has a diagnosis: Mme Moreau arrived with a self-diagnosis (\"strep, same as last year\") and a self-prescription (\"amoxicillin, 5 days\"). In Caen, is a patient turning up with their own diagnosis seen as informed and reasonable, or as something to gently re-frame? In Nagoya, the historical default was deference to the doctor — is that still true with younger patients today?",
      fr: "Comparaison France-Japon — le patient qui arrive avec un diagnostic déjà fait : Mme Moreau est venue avec un auto-diagnostic (« une angine, comme l'an dernier ») et une auto-prescription (« amoxicilline, 5 jours »). À Caen, un patient qui se présente avec son propre diagnostic est-il vu comme informé et raisonnable, ou comme quelque chose à recadrer avec tact ? À Nagoya, la norme historique était la déférence envers le médecin — est-ce encore vrai chez les patients plus jeunes aujourd'hui ?",
      ja: "フランスと日本の比較 — すでに診断を持って来る患者:Mme Moreau は自己診断(「去年と同じ咽頭炎」)と自己処方(「アモキシシリン5日分」)を携えて受診しました。Caen では、自分の診断を持って来る患者は情報通で妥当とみなされますか、それとも穏やかに枠組みを直すべき相手とみなされますか?名古屋では歴史的には医師への敬譲がデフォルトでしたが — 今日の若い患者でもそうですか?" },
    { en: "Safety netting: what would change your mind in the next 7 days? Name the specific features that would prompt review, a rapid antigen test, an antibiotic, or referral — and what exactly do you tell Mme Moreau to watch for and come back about?",
      fr: "Filet de sécurité : qu'est-ce qui vous ferait changer d'avis dans les 7 prochains jours ? Nommez les signes spécifiques qui justifieraient une réévaluation, un TROD, un antibiotique, ou une orientation — et que dites-vous exactement à Mme Moreau de surveiller et pour quoi revenir consulter ?",
      ja: "セーフティネット:今後7日間で何があれば方針を変えますか?再評価、迅速抗原検査、抗生物質、または専門医紹介を促す具体的な所見を挙げ、Mme Moreau には何に注意してどのような場合に再診するよう、正確にどう伝えますか?" },
    { en: "Take a position: one sentence each — name the single biggest difference between how a French and a Japanese primary-care clinician would handle Mme Moreau in 2026, and say whether you think one approach is better, or whether each is simply the rational response to its own health system's incentives and patient expectations.",
      fr: "Prenez position : une phrase chacun·e — nommez la principale différence entre la façon dont un médecin généraliste français et un médecin de soins primaires japonais prendraient en charge Mme Moreau en 2026, et dites si l'une des approches est, selon vous, meilleure, ou si chacune n'est que la réponse rationnelle aux incitatifs et aux attentes des patients de son propre système de santé.",
      ja: "立場を表明:各自一文ずつ — 2026年にフランスの一般医と日本のプライマリ・ケア医が Mme Moreau をどう対応するかの最大の違いを一つ挙げ、いずれかのアプローチがより優れていると思うか、あるいはそれぞれが自国の医療制度のインセンティブと患者の期待に対する合理的な応答にすぎないかを述べてください。" }
  ]
};

/* SCORING for the Antibiotic-Stewardship scenario. Module A is the focus — a
   sound clinical workup that lands on \"no antibiotic, here's why, here's
   what to do instead\" — and Module B is the patient-pressure conversation
   that compares the two countries' practice contexts. */
var SCORING_C = {
  moduleA: [
    { id: "centor", points: 8,
      label: { en: "Applied a Centor / McIsaac / FeverPAIN score",
               fr: "A appliqué un score de Centor / McIsaac / FeverPAIN",
               ja: "Centor / McIsaac / FeverPAIN スコアを適用した" },
      any: ["centor", "mcisaac", "feverpain", "score", "criteria", "decision rule",
            "no exudate", "no fever", "presence of cough", "tender anterior",
            "anterior cervical"] },
    { id: "viral", points: 8,
      label: { en: "Named viral pharyngitis as the leading diagnosis",
               fr: "A nommé la pharyngite virale comme diagnostic principal",
               ja: "ウイルス性咽頭炎を最有力診断として挙げた" },
      any: ["viral", "virus", "self-limit", "self limit", "no antibiotic",
            "antibiotic not", "abx not", "abx unnecessary", "not bacterial",
            "common cold", "uri", "upper respiratory"] },
    { id: "noabx", points: 10,
      label: { en: "Explicitly declined to prescribe antibiotics",
               fr: "A explicitement refusé de prescrire des antibiotiques",
               ja: "抗生物質の処方を明確に控えた" },
      any: ["no antibiotic", "no abx", "do not prescribe", "don't prescribe",
            "decline", "withhold antibiotic", "not amoxicillin", "no amoxicillin",
            "say no", "refrain from", "avoid antibiotic"] },
    { id: "amr", points: 8,
      label: { en: "Named antimicrobial resistance / AMR / future-microbiome harm",
               fr: "A nommé la résistance antimicrobienne / RAM / atteinte du microbiote",
               ja: "薬剤耐性 / AMR / 将来の腸内細菌叢への害を挙げた" },
      any: ["resistance", "amr", "antimicrobial resist", "antibiotic resist",
            "microbiome", "microbiota", "ecological", "stewardship",
            "population harm", "c. difficile", "c diff", "clostridi"] },
    { id: "symptomatic", points: 8,
      label: { en: "Built a real symptomatic management plan",
               fr: "A élaboré un vrai plan de prise en charge symptomatique",
               ja: "実効性のある対症療法プランを立てた" },
      any: ["paracetamol", "acetaminophen", "ibuprofen", "nsaid", "lozenge",
            "gargle", "hydrat", "fluid", "voice rest", "rest", "honey",
            "symptomatic", "salt water", "saline"] },
    { id: "safetynet", points: 6,
      label: { en: "Gave a clear safety-net",
               fr: "A donné un filet de sécurité clair",
               ja: "明確なセーフティネットを示した" },
      any: ["safety net", "safety-net", "come back", "return if", "red flag",
            "drooling", "stridor", "unable to swallow", "unilateral",
            "worsening", "if it gets worse", "review"] },
    { id: "trip", points: 6,
      label: { en: "Addressed the business trip without resorting to antibiotics",
               fr: "A abordé le voyage d'affaires sans recourir aux antibiotiques",
               ja: "抗生物質に頼らずに出張の問題に対応した" },
      any: ["business trip", "frankfurt", "flight", "presentation", "in-flight",
            "voice", "before the flight", "for the trip", "for friday",
            "won't help her get", "will not help her get", "wouldn't get her",
            "no faster"] },
    { id: "contrast", points: 12,
      label: { en: "Named a real difference between two countries",
               fr: "A nommé une réelle différence entre deux pays",
               ja: "二国間の実際の違いを挙げた" },
      cohorts: true },
    { id: "disagree", points: 8,
      label: { en: "Named a real disagreement",
               fr: "A nommé un véritable désaccord",
               ja: "実際の意見の相違を挙げた" },
      any: ["disagree", "could not agree", "did not agree", "not resolve",
            "we differ", "unsure", "split", "no consensus", "debated", "we argued"] }
  ],
  moduleB: [
    { id: "validate", points: 8,
      label: { en: "Validated the concern without agreeing to the request",
               fr: "A validé l'inquiétude sans accéder à la demande",
               ja: "要望に応じることなく不安を受け止めた" },
      any: ["validate", "acknowledg", "i hear you", "understand your concern",
            "your worry", "real concern", "make sense", "i can see why",
            "without agreeing", "name the fear", "name her fear"] },
    { id: "plainlang", points: 8,
      label: { en: "Explained the reasoning in plain language (no jargon)",
               fr: "A expliqué le raisonnement en mots simples (sans jargon)",
               ja: "専門用語を使わずに平易な言葉で説明した" },
      any: ["plain language", "in plain", "without jargon", "simple terms",
            "everyday words", "in your own words", "the way i'd say it",
            "explain why", "lay terms"] },
    { id: "shared", points: 8,
      label: { en: "Shared decision-making — agreed a plan together",
               fr: "Décision médicale partagée — accord sur un plan commun",
               ja: "共有意思決定 — 共に計画に合意した" },
      any: ["shared decision", "decide together", "agree a plan", "together we",
            "what matters to you", "her priorities", "with the patient",
            "concordant", "co-construct"] },
    { id: "delayed", points: 6,
      label: { en: "Discussed delayed / back-pocket prescribing as a tool",
               fr: "A discuté de la prescription différée / « de réserve » comme outil",
               ja: "遅延処方 / 「とっておき処方」を選択肢として議論した" },
      any: ["delayed prescri", "back-pocket", "back pocket", "wait-and-see",
            "wait and see", "deferred prescri", "safety-net prescri",
            "if not better in", "fill only if"] },
    { id: "crosscult", points: 10,
      label: { en: "Named a cross-cultural difference in antibiotic-prescribing norms",
               fr: "A nommé une différence interculturelle dans la prescription d'antibiotiques",
               ja: "抗生物質処方の規範における異文化間の違いを挙げた" },
      cohorts: true },
    { id: "policy", points: 6,
      label: { en: "Named a real policy lever (AMR plan, stewardship premium, HAS, NICE, CDC)",
               fr: "A nommé un levier réel de politique publique (plan AMR, forfait, HAS, NICE, CDC)",
               ja: "実際の政策手段(AMR行動計画、適正使用加算、HAS、NICE、CDCなど)を挙げた" },
      any: ["has 2021", "nice ng84", "ng84", "cdc", "be antibiotics aware",
            "amr action plan", "amr national action", "action plan",
            "stewardship premium", "適正使用加算", "mhlw", "厚生労働省",
            "fee schedule", "reimbursement", "incentive"] }
  ]
};

/* PENALTIES for the Antibiotic-Stewardship scenario. */
var PENALTIES_C = [
  { id: "pen_prescribe_abx", item: "history:7", points: 14,
    title: { en: "Promised an amoxicillin course before completing the assessment",
             fr: "A promis une cure d'amoxicilline avant d'avoir complété l'évaluation",
             ja: "評価を完了する前にアモキシシリンの処方を約束した" },
    why: { en: "Agreeing to prescribe an antibiotic before scoring Centor/McIsaac, " +
               "examining the throat or even discussing whether antibiotics shorten " +
               "viral pharyngitis (they do not) is exactly the prescribing pattern " +
               "that the HAS 2021 guidance, NICE NG84 and the Japanese AMR action " +
               "plan are all trying to change. The rest of the consultation now " +
               "revolves around delivering that promise — that is why your team " +
               "loses points.",
           fr: "Accepter de prescrire un antibiotique avant d'avoir calculé le score " +
               "Centor/McIsaac, examiné la gorge ou même discuté du fait que les " +
               "antibiotiques raccourcissent une pharyngite virale (ce qui n'est pas " +
               "le cas) est exactement le schéma de prescription que les recommandations " +
               "HAS 2021, NICE NG84 et le plan AMR japonais cherchent tous à modifier. " +
               "Le reste de la consultation tourne désormais autour de la tenue de cette " +
               "promesse — c'est pourquoi votre équipe perd des points.",
           ja: "Centor/McIsaacスコアを算出する前、咽頭を診察する前、そして抗生物質が" +
               "ウイルス性咽頭炎を短縮するかどうか(短縮しません)を話し合う前に抗生" +
               "物質の処方に同意することは、まさにHAS 2021、NICE NG84、日本のAMR" +
               "行動計画が変えようとしている処方パターンそのものです。診察の残りは" +
               "その約束の履行を中心に進むことになります — それがチームの減点理由です。" } },
  { id: "pen_dismiss_cold", item: "history:8", points: 10,
    title: { en: "Dismissed her with 'it's just a cold' and skipped the examination",
             fr: "L'a renvoyée avec « ce n'est qu'un rhume » sans réaliser d'examen",
             ja: "「ただの風邪です」と一蹴し、診察を省略した" },
    why: { en: "Telling a patient \"it's just a cold, there's nothing to do\" without " +
               "examining her, without explaining the reasoning, without a symptomatic " +
               "plan and without a safety-net is heard as not caring. It is also " +
               "indistinguishable, from the patient's chair, from incompetence. " +
               "Stewardship is NOT minimising the patient — it is taking her " +
               "seriously enough to explain, examine, plan and safety-net. Skipping " +
               "those steps loses both the consultation and points.",
           fr: "Dire à une patiente « ce n'est qu'un rhume, il n'y a rien à faire » sans " +
               "l'examiner, sans expliquer le raisonnement, sans plan symptomatique et " +
               "sans filet de sécurité est entendu comme du désintérêt. C'est aussi, du " +
               "fauteuil de la patiente, impossible à distinguer d'une incompétence. Le " +
               "bon usage des antibiotiques N'est PAS minimiser la patiente — c'est la " +
               "prendre suffisamment au sérieux pour expliquer, examiner, planifier et " +
               "sécuriser. Sauter ces étapes fait perdre à la fois la consultation et " +
               "des points.",
           ja: "診察もせず、理由の説明もせず、対症療法プランもセーフティネットも示さず" +
               "に患者に「ただの風邪です、どうしようもありません」と告げることは、関心" +
               "を持たれていないと受け取られます。さらに患者の側から見れば、これは無能" +
               "と区別がつきません。抗菌薬適正使用とは患者を軽視することではなく — " +
               "説明し、診察し、計画を立て、セーフティネットを示すに足るほど真剣に向き合" +
               "うことです。これらのステップを省くことは、診察と点数の両方を失わせます。" } },
  { id: "pen_neuroabdo", item: "exam:5", points: 6,
    title: { en: "Did a scattergun neuro / abdominal examination",
             fr: "A fait un examen neuro / abdominal au hasard",
             ja: "焦点のない神経・腹部の診察を行った" },
    why: { en: "Nothing in the history points to a neurological or abdominal problem — " +
               "this is a focused ENT consultation. A full neuro + abdominal screen " +
               "is unfocused, signals to Mme Moreau that you are searching at random " +
               "instead of completing the throat workup, and eats consultation time " +
               "the case really needed for the stewardship conversation.",
           fr: "Rien dans l'anamnèse n'oriente vers un problème neurologique ou abdominal " +
               "— il s'agit d'une consultation ORL ciblée. Un dépistage neurologique + " +
               "abdominal complet n'est pas ciblé, signale à Mme Moreau que vous cherchez " +
               "au hasard au lieu de compléter le bilan pharyngé, et consomme du temps " +
               "de consultation dont le cas avait réellement besoin pour la conversation " +
               "sur le bon usage des antibiotiques.",
           ja: "病歴に神経学的または腹部の問題を示唆する所見はありません — これは焦点" +
               "を絞った耳鼻咽喉科の診察です。包括的な神経 + 腹部のスクリーニングは" +
               "焦点を欠いており、咽頭のワークアップを完了させる代わりに当てずっぽうに" +
               "探っている印象を Mme Moreau に与え、抗菌薬適正使用の会話に必要だった" +
               "診察時間を消費してしまいます。" } },
  { id: "pen_bloods", item: "labs:3", points: 8,
    title: { en: "Ordered unnecessary blood tests (FBC, CRP, LFTs)",
             fr: "A prescrit un bilan sanguin inutile (NFS, CRP, bilan hépatique)",
             ja: "不要な血液検査(全血球計算、CRP、肝機能)を指示した" },
    why: { en: "In a well, immunocompetent adult with a clinical picture of viral " +
               "pharyngitis, blood tests are not indicated — they do not reliably " +
               "distinguish viral from bacterial pharyngitis, the mildly raised CRP " +
               "will tempt some clinicians toward an antibiotic that is not indicated, " +
               "and liver function tests are completely irrelevant. \"While we're at " +
               "it\" is the opposite of a focused workup.",
           fr: "Chez une adulte en bonne santé, immunocompétente, avec un tableau " +
               "clinique de pharyngite virale, le bilan sanguin n'est pas indiqué — " +
               "il ne permet pas de distinguer de façon fiable une pharyngite virale " +
               "d'une pharyngite bactérienne, l'élévation modérée de la CRP poussera " +
               "certains cliniciens à prescrire un antibiotique non indiqué, et le " +
               "bilan hépatique est totalement hors-sujet. « Tant qu'on y est » est " +
               "l'opposé d'un bilan ciblé.",
           ja: "免疫健常な健康成人で臨床像がウイルス性咽頭炎の場合、血液検査の適応は" +
               "ありません — ウイルス性と細菌性咽頭炎を確実に区別できず、軽度のCRP" +
               "上昇は本来処方すべきでない抗生物質の処方へと一部の医師を誘導しかねず、" +
               "肝機能検査は完全に無関係です。「ついでに」は焦点を絞った検査の正反対です。" } },
  { id: "pen_amox", item: "labs:4", points: 14,
    title: { en: "Prescribed an empirical 5-day amoxicillin course",
             fr: "A prescrit une cure empirique d'amoxicilline de 5 jours",
             ja: "経験的にアモキシシリン5日分を処方した" },
    why: { en: "Prescribing amoxicillin for a Centor/McIsaac-0 viral pharyngitis " +
               "exposes Mme Moreau to side-effects (GI upset, rash, ~ 1 in 1000 risk " +
               "of C. difficile, ~ 1 in 10 000 risk of serious allergic reaction), " +
               "reinforces her belief that \"amoxicillin always works\" (which makes " +
               "the next consultation harder for the next colleague), and contributes " +
               "to community resistance — for an illness her body was already clearing " +
               "on its own. \"It worked\" is not the same as \"it was needed\". This " +
               "is the central wrong choice the case is designed to teach. " +
               "ADDITIONAL TRAP: in any young adult with sore throat where EBV " +
               "(infectious mononucleosis) has not been ruled out, empirical aminopenicillins " +
               "trigger a near-universal maculopapular rash (~ 80–100% of EBV cases). " +
               "Most clinicians and patients then mislabel this as a permanent " +
               "\"penicillin allergy\" — a label that follows the patient for life " +
               "and pushes future infections toward broader-spectrum, more toxic, " +
               "more expensive antibiotics. Mme Moreau had her tonsils out as a " +
               "child so classic exudative tonsillitis is unlikely, but the EBV " +
               "+ amoxicillin trap is the canonical reason \"empirical amoxicillin " +
               "for sore throat\" is unsafe even when it does no infectious harm.",
           fr: "Prescrire de l'amoxicilline pour une pharyngite virale à Centor/McIsaac 0 " +
               "expose Mme Moreau aux effets secondaires (troubles digestifs, éruption, " +
               "risque d'environ 1 sur 1 000 d'infection à C. difficile, risque d'environ " +
               "1 sur 10 000 de réaction allergique grave), renforce sa conviction que " +
               "« l'amoxicilline marche toujours » (ce qui rend la prochaine consultation " +
               "plus difficile pour le prochain collègue), et contribue à la résistance " +
               "communautaire — pour une maladie que son corps était déjà en train de " +
               "résoudre seul. « Ça a marché » n'est pas la même chose que « c'était " +
               "nécessaire ». C'est le mauvais choix central que ce cas est conçu pour " +
               "enseigner.",
           ja: "Centor/McIsaacスコア0のウイルス性咽頭炎にアモキシシリンを処方すること" +
               "は、Mme Moreau を副作用(消化器症状、皮疹、約1/1000のC. difficile感染" +
               "リスク、約1/10 000の重篤なアレルギー反応リスク)に曝露させ、「アモキシ" +
               "シリンはいつも効く」という彼女の信念を強化し(これは次に診る同僚にとって" +
               "次の診察をさらに難しくします)、そして地域での薬剤耐性に寄与します — " +
               "彼女の身体がすでに自力で治しつつあった疾患のために。「効いた」は「必要" +
               "だった」と同じではありません。これがこの症例で教えることを意図した中心" +
               "的な誤った選択です。" } }
];

/* DECISIONS for the Antibiotic-Stewardship scenario. Three votes, all on
   Module A — the case's pedagogical centre of gravity is the in-room
   prescribing decision. */
var DECISIONS_C = [
  {
    // Sub-facet of the treatment plan — same gate as dec_plan.
    id: "dec_prescribe_or_not", module: "A", points: 25, penalty: 15,
    unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 },
    prompt: { en: "Mme Moreau is asking for a 5-day course of amoxicillin so she can " +
                  "give her client presentation in Frankfurt on Friday. Centor/McIsaac " +
                  "is 0. Your team should…",
              fr: "Mme Moreau demande une cure d'amoxicilline de 5 jours pour pouvoir " +
                  "donner sa présentation client à Francfort vendredi. Le score Centor/McIsaac " +
                  "est de 0. Votre équipe doit…",
              ja: "Mme Moreau は金曜日にフランクフルトでクライアント向けプレゼンを行う" +
                  "ため、アモキシシリン5日分を希望しています。Centor/McIsaacは0です。" +
                  "あなたのチームがすべきことは…" },
    options: [
      { text: { en: "Prescribe the amoxicillin — she's a paying patient with a real deadline and last year it worked",
                fr: "Prescrire l'amoxicilline — c'est une patiente qui paie, avec une vraie échéance, et l'an dernier ça a marché",
                ja: "アモキシシリンを処方する — 彼女は本当に締切のある自費患者で、昨年は効いたのだから" },
        correct: false,
        why: { en: "Antibiotics do not shorten viral pharyngitis — \"it worked last " +
                   "year\" almost certainly means the illness ran its course in parallel " +
                   "with the antibiotic. Prescribing now exposes her to side-effects " +
                   "(GI upset, ~ 1 in 1000 C. difficile risk), reinforces a false " +
                   "belief that drives future consultations, and contributes to " +
                   "community resistance — for an illness her body is already clearing.",
               fr: "Les antibiotiques ne raccourcissent pas une pharyngite virale — « ça a " +
                   "marché l'an dernier » signifie presque toujours que la maladie a évolué " +
                   "spontanément en parallèle de l'antibiotique. Prescrire maintenant " +
                   "l'expose à des effets secondaires (troubles digestifs, risque d'environ " +
                   "1 sur 1 000 d'infection à C. difficile), renforce une croyance fausse " +
                   "qui pèsera sur les consultations futures, et contribue à la résistance " +
                   "communautaire — pour une maladie que son corps est en train de résoudre " +
                   "seul.",
               ja: "抗生物質はウイルス性咽頭炎を短縮しません — 「昨年は効いた」というのは" +
                   "ほぼ確実に、抗生物質と並行して疾患が自然軽快しただけです。今処方すれば" +
                   "副作用(消化器症状、約1/1000のC. difficile感染リスク)に曝露され、" +
                   "将来の診察に響く誤った信念を強化し、地域の薬剤耐性にも寄与します — " +
                   "彼女の身体がすでに治しつつある疾患のために。" } },
      { text: { en: "Refuse and tell her: \"there's nothing I can do, take paracetamol\" — and move to the next patient",
                fr: "Refuser et lui dire : « je ne peux rien faire, prenez du paracétamol » — et passer au patient suivant",
                ja: "拒否してこう告げる:「私にできることはありません、アセトアミノフェンを飲んでください」 — そして次の患者へ" },
        correct: false,
        why: { en: "Right call, wrong execution. A bare refusal with no examination, " +
                   "no explanation, no symptomatic plan and no safety-net is heard as " +
                   "not caring. Stewardship is NOT minimising the patient — it is the " +
                   "opposite: taking her concern seriously enough to explain WHY " +
                   "antibiotics will not help, and to give her a plan that actually " +
                   "addresses the Friday deadline.",
               fr: "La bonne décision, mais mal exécutée. Un refus nu sans examen, sans " +
                   "explication, sans plan symptomatique et sans filet de sécurité est " +
                   "entendu comme du désintérêt. Le bon usage des antibiotiques N'est PAS " +
                   "minimiser la patiente — c'est l'inverse : prendre son inquiétude " +
                   "suffisamment au sérieux pour expliquer POURQUOI les antibiotiques " +
                   "n'aideront pas, et lui donner un plan qui répond réellement à " +
                   "l'échéance de vendredi.",
               ja: "判断は正しいが、進め方が誤りです。診察もせず、説明もせず、対症療法" +
                   "プランもセーフティネットも示さずにただ拒否することは、関心を持たれて" +
                   "いないと受け取られます。抗菌薬適正使用とは患者を軽視することではなく " +
                   "— その逆で、彼女の不安を、なぜ抗生物質が役に立たないかを説明し、" +
                   "金曜日の締切に実際に応える計画を示すに足るほど真剣に受け止めることです。" } },
      { text: { en: "Decline antibiotics, explain why in plain language, build a symptomatic plan for the trip, and safety-net",
                fr: "Refuser les antibiotiques, expliquer pourquoi avec des mots simples, élaborer un plan symptomatique pour le voyage, et établir un filet de sécurité",
                ja: "抗生物質を控え、平易な言葉で理由を説明し、出張に向けた対症療法プランを立て、セーフティネットを示す" },
        correct: true,
        why: { en: "This is what HAS 2021, NICE NG84, the CDC and the Japanese AMR " +
                   "National Action Plan all converge on: take the patient and her " +
                   "deadline seriously, explain why antibiotics will not help here, " +
                   "give a real plan that addresses the trip (scheduled paracetamol, " +
                   "NSAID, voice rest, in-flight hydration), and tell her exactly what " +
                   "would make you change your mind. The harder, slower, more honest " +
                   "choice — and the cornerstone of antibiotic stewardship in primary " +
                   "care.",
               fr: "C'est sur ce point que convergent HAS 2021, NICE NG84, le CDC et le " +
                   "Plan national AMR japonais : prendre la patiente et son échéance au " +
                   "sérieux, expliquer pourquoi les antibiotiques n'aideront pas ici, " +
                   "donner un vrai plan qui répond au voyage (paracétamol systématique, " +
                   "AINS, repos vocal, hydratation en vol), et lui dire exactement ce " +
                   "qui vous ferait changer d'avis. Le choix plus difficile, plus lent, " +
                   "plus honnête — et la pierre angulaire du bon usage des antibiotiques " +
                   "en soins primaires.",
               ja: "これこそHAS 2021、NICE NG84、CDC、日本のAMR国家行動計画が一致して" +
                   "推奨するアプローチです:患者と彼女の締切を真剣に受け止め、なぜ抗生" +
                   "物質がここでは役に立たないかを説明し、出張に応える実効性のあるプラン" +
                   "(アセトアミノフェンの定時投与、NSAID、声の休息、機内の水分摂取)を" +
                   "示し、何があれば方針を変えるかを正確に伝える。より難しく、より時間" +
                   "がかかり、より誠実な選択 — そしてプライマリ・ケアにおける抗菌薬適正" +
                   "使用の要となるものです。" } }
    ]
  },
  {
    // Refinement of the plan stance — same gate.
    id: "dec_delayed_script", module: "A", points: 20, penalty: 10,
    unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 },
    prompt: { en: "A team member suggests a compromise: give Mme Moreau a 'delayed' " +
                  "(back-pocket) amoxicillin prescription she fills only if she's worse " +
                  "in 48-72 hours. Your team's position is…",
              fr: "Un membre de l'équipe propose un compromis : donner à Mme Moreau une " +
                  "prescription d'amoxicilline « différée » (« de réserve ») qu'elle " +
                  "n'utilise qu'en cas d'aggravation à 48-72 heures. La position de votre " +
                  "équipe est…",
              ja: "チームメンバーが妥協案を提案します:Mme Moreau に「遅延処方」(とっておき" +
                  "処方)のアモキシシリンを渡し、48-72時間で悪化した場合にのみ使うようにする。" +
                  "チームの立場は…" },
    options: [
      { text: { en: "Yes — it makes everyone happy, she leaves with a prescription, we keep stewardship",
                fr: "Oui — tout le monde est content, elle repart avec une ordonnance, on garde le bon usage",
                ja: "賛成 — みんな満足、彼女は処方箋を持って帰り、適正使用も保てる" },
        correct: false,
        why: { en: "A delayed prescription handed out by reflex \"to keep everyone " +
                   "happy\" is exactly when this tool fails — it outsources the " +
                   "clinical decision to the patient at the pharmacy counter, and " +
                   "Mme Moreau's pre-existing belief that \"amoxicillin always works\" " +
                   "means she will almost certainly fill it. Used unselectively, the " +
                   "delayed prescription becomes a slower version of the immediate " +
                   "one.",
               fr: "Une prescription différée donnée par réflexe « pour que tout le monde " +
                   "soit content » est précisément le cas où cet outil échoue — il sous-" +
                   "traite la décision clinique au patient devant le comptoir de la pharmacie, " +
                   "et la conviction préexistante de Mme Moreau que « l'amoxicilline " +
                   "marche toujours » signifie qu'elle l'utilisera presque certainement. " +
                   "Utilisée sans discernement, la prescription différée devient une " +
                   "version plus lente de la prescription immédiate.",
               ja: "「みんなを満足させるため」に反射的に渡される遅延処方は、まさにこの手段" +
                   "が機能しない使い方です — 臨床判断を薬局のカウンターに立つ患者に外注する" +
                   "ことになり、しかも「アモキシシリンはいつも効く」という Mme Moreau の" +
                   "事前の信念を考えれば、彼女はほぼ確実に処方箋を使います。選別なく使えば、" +
                   "遅延処方は単に時間差のある即時処方になってしまいます。" } },
      { text: { en: "Discuss it openly: explain when delayed prescribing actually helps and when it doesn't, and decide WITH her",
                fr: "En discuter ouvertement : expliquer quand la prescription différée aide réellement et quand non, et décider AVEC elle",
                ja: "オープンに議論する:遅延処方が実際に役立つ場面と役立たない場面を説明し、彼女と共に決める" },
        correct: true,
        why: { en: "NICE NG84 endorses delayed prescribing — but as a thoughtful " +
                   "middle path with the right patient, not as a default. The right " +
                   "answer is to make it a shared decision: name the trade-offs " +
                   "(filling a prescription you may not need vs. catching a bacterial " +
                   "complication early), check what Mme Moreau actually wants, and " +
                   "agree explicit conditions for filling it. Used carefully, it can " +
                   "reduce unnecessary antibiotic use; used reflexively, it does the " +
                   "opposite.",
               fr: "NICE NG84 valide la prescription différée — mais comme une voie " +
                   "intermédiaire réfléchie avec le bon patient, pas comme un automatisme. " +
                   "La bonne réponse est d'en faire une décision partagée : nommer les " +
                   "compromis (utiliser une ordonnance peut-être inutile vs. dépister " +
                   "précocement une surinfection bactérienne), vérifier ce que Mme Moreau " +
                   "souhaite réellement, et convenir explicitement des conditions de " +
                   "délivrance. Utilisée avec discernement, elle peut réduire l'usage " +
                   "inutile d'antibiotiques ; utilisée par réflexe, elle fait l'inverse.",
               ja: "NICE NG84は遅延処方を支持していますが — 適切な患者に対する熟慮された" +
                   "中間的手段としてであり、デフォルトとしてではありません。正しい答えは、" +
                   "これを共有意思決定にすることです:トレードオフ(不要かもしれない処方を" +
                   "使うこと vs. 細菌性合併症を早期発見すること)を名指しで伝え、Mme Moreau " +
                   "が本当は何を望むかを確認し、使用条件を明示的に合意する。慎重に使えば" +
                   "不要な抗生物質使用を減らせますが、反射的に使えば逆効果になります。" } },
      { text: { en: "Never — delayed prescribing is just immediate prescribing with extra steps; reject it on principle",
                fr: "Jamais — la prescription différée n'est qu'une prescription immédiate avec des étapes en plus ; la refuser par principe",
                ja: "決してダメ — 遅延処方は手順を増やしただけの即時処方であり、原則として拒否すべき" },
        correct: false,
        why: { en: "An absolute rejection ignores the evidence base. Cochrane reviews " +
                   "and NICE NG84 both find that delayed prescribing, used with the " +
                   "right patient and clear rules for filling, materially reduces " +
                   "antibiotic consumption compared with an immediate script and " +
                   "performs similarly on clinical outcomes. The right answer is " +
                   "selective use, not blanket refusal.",
               fr: "Un refus absolu ignore les données disponibles. Les revues Cochrane " +
                   "et NICE NG84 montrent toutes deux que la prescription différée, " +
                   "utilisée avec le bon patient et des règles claires de délivrance, " +
                   "réduit nettement la consommation d'antibiotiques par rapport à une " +
                   "prescription immédiate, pour des résultats cliniques comparables. " +
                   "La bonne réponse est l'usage sélectif, pas le refus catégorique.",
               ja: "絶対的な拒否はエビデンスを無視しています。Cochraneレビューと " +
                   "NICE NG84 はいずれも、適切な患者と明確な使用ルールのもとで用いれば、" +
                   "遅延処方は即時処方と比べて抗生物質消費を実質的に減らし、臨床アウト" +
                   "カムは同等であることを示しています。正しい答えは選択的使用であり、" +
                   "一律の拒否ではありません。" } }
    ]
  },
  {
    // Contextual modifier on a chosen plan — same gate.
    id: "dec_business_trip", module: "A", points: 20, penalty: 0,
    unlockWhen: { hypotheses: 1, historyRevealed: 1, examRevealed: 1 },
    prompt: { en: "Setting antibiotics aside: Mme Moreau still has a presentation in " +
                  "Frankfurt on Friday. What is the single most useful thing your team " +
                  "can offer her FOR THE TRIP?",
              fr: "Mise à part la question des antibiotiques : Mme Moreau a toujours une " +
                  "présentation à Francfort vendredi. Quelle est la chose la plus utile que " +
                  "votre équipe puisse lui offrir POUR LE VOYAGE ?",
              ja: "抗生物質の話を脇に置いて:Mme Moreau には金曜日にフランクフルトでの" +
                  "プレゼンが残っています。出張のためにチームが提供できる最も役立つもの" +
                  "は一つ何でしょうか?" },
    options: [
      { text: { en: "A sick note recommending she cancel the trip",
                fr: "Un arrêt de travail recommandant l'annulation du voyage",
                ja: "出張中止を勧める就業制限の診断書" },
        correct: false,
        why: { en: "Cancelling is a legitimate option to mention, but it is NOT what " +
                   "she came for and it is not the most useful single offer. Her " +
                   "viral pharyngitis is self-limiting and she is not infectious in a " +
                   "way that requires grounding her — making the call to go or not is " +
                   "her decision once she has the information.",
               fr: "Annuler est une option légitime à mentionner, mais ce n'est PAS ce " +
                   "pour quoi elle est venue et ce n'est pas l'offre la plus utile. Sa " +
                   "pharyngite virale est à résolution spontanée et son caractère " +
                   "contagieux n'impose pas de la clouer au sol — la décision de partir " +
                   "ou non lui appartient, une fois qu'elle a l'information.",
               ja: "中止は言及すべき正当な選択肢ですが、彼女が受診した目的ではなく、最も" +
                   "役立つ単一の提供物でもありません。彼女のウイルス性咽頭炎は自然軽快" +
                   "するもので、地上に留めなければならないほどの感染性ではありません — " +
                   "情報を得た上で行くか行かないかを決めるのは彼女自身です。" } },
      { text: { en: "A symptomatic plan tuned to the flight and the stage — scheduled paracetamol + NSAID, voice rest, in-flight hydration, lozenges, and a clear plan if she's worse Friday morning",
                fr: "Un plan symptomatique adapté au vol et à la scène — paracétamol + AINS systématiques, repos vocal, hydratation en vol, pastilles, et un plan clair si elle est pire vendredi matin",
                ja: "フライトと壇上に合わせた対症療法プラン — アセトアミノフェン + NSAIDの定時投与、声の休息、機内の水分摂取、のど飴、そして金曜朝に悪化した場合の明確な計画" },
        correct: true,
        why: { en: "This is what actually helps. Scheduled (not as-needed) analgesia " +
                   "controls the throat pain through the meeting; NSAID added before " +
                   "the stage manages inflammation and voice; in-flight hydration " +
                   "protects the mucosa from cabin air; lozenges for sustained relief; " +
                   "and a clear Friday-morning rule (\"if you cannot swallow saliva or " +
                   "have stridor, do not fly, go to A&E\") gives her a safety-net she " +
                   "can act on. This addresses the trip far better than an antibiotic " +
                   "course she would only be on day 3 of by Friday.",
               fr: "C'est ce qui aide réellement. Une antalgie systématique (et non à la " +
                   "demande) contrôle la douleur pharyngée pendant la réunion ; un AINS " +
                   "ajouté avant la scène gère l'inflammation et la voix ; l'hydratation " +
                   "en vol protège la muqueuse de l'air sec de la cabine ; les pastilles " +
                   "pour un soulagement prolongé ; et une règle claire pour vendredi " +
                   "matin (« si vous ne pouvez plus avaler votre salive ou avez du " +
                   "stridor, ne prenez pas l'avion, allez aux urgences ») lui donne un " +
                   "filet de sécurité actionnable. Cela répond au voyage bien mieux qu'une " +
                   "cure d'antibiotique dont elle ne serait qu'au 3e jour vendredi.",
               ja: "これこそが実際に役立つものです。定時(頓用ではなく)の鎮痛は会議中の" +
                   "咽頭痛をコントロールし、登壇前のNSAIDは炎症と声を管理し、機内の水分" +
                   "摂取は乾燥した機内の空気から粘膜を守り、のど飴は持続的な緩和を提供" +
                   "します;そして金曜朝の明確なルール(「唾液が飲み込めない、または喘鳴" +
                   "があれば搭乗せずに救急へ」)は彼女が実行できるセーフティネットになり" +
                   "ます。金曜にやっと服用3日目になる抗生物質コースよりも、はるかにこの" +
                   "出張に応えるものです。" } },
      { text: { en: "A short course of oral corticosteroids — they'd reduce throat swelling quickly",
                fr: "Une cure courte de corticoïdes oraux — ils réduiraient rapidement l'inflammation pharyngée",
                ja: "経口ステロイドの短期コース — のどの腫れを素早く減らせる" },
        correct: false,
        why: { en: "Steroids do offer modest, short-term pain reduction in acute sore " +
                   "throat — but the effect is small, side-effects (mood, blood sugar, " +
                   "GI) are not zero, and prescribing a steroid course \"because she " +
                   "has a flight\" mirrors exactly the prescribing pattern this case " +
                   "is trying to teach you to resist. Plain analgesia + voice care " +
                   "does the same job with much less risk.",
               fr: "Les corticoïdes offrent effectivement un soulagement modeste et de " +
                   "courte durée dans le mal de gorge aigu — mais l'effet est faible, " +
                   "les effets secondaires (humeur, glycémie, gastro-intestinaux) ne sont " +
                   "pas nuls, et prescrire une cure de corticoïde « parce qu'elle a un " +
                   "avion » reproduit exactement le schéma de prescription que ce cas " +
                   "vise à vous apprendre à résister. Une antalgie simple + des soins de " +
                   "la voix font le même travail avec beaucoup moins de risque.",
               ja: "ステロイドは確かに急性咽頭痛に対して中等度・短時間の鎮痛効果を" +
                   "示しますが — 効果は小さく、副作用(気分、血糖、消化器)はゼロでは" +
                   "なく、しかも「フライトがあるから」とステロイドコースを処方すること" +
                   "は、この症例があなたに抵抗することを教えようとしているまさにその処方" +
                   "パターンを再現してしまいます。単純な鎮痛 + 声のケアが、はるかに少ない" +
                   "リスクで同じ仕事をします。" } }
    ]
  }
];

/* ===================== PRE / POST KNOWLEDGE TESTS ==========================
 * Each scenario can optionally define a `preTest` and a `postTest` — short
 * multiple-choice question banks rendered in-platform (preTest after Welcome
 * and before Module A; postTest during Wrap-up). Both are OPTIONAL: students
 * can skip them and the workshop flow is never blocked. Empty arrays mean
 * "no test for this scenario" — the UI hides the test panels entirely.
 *
 * Per-question shape:
 *   { id, q: {en,fr,ja}, options: [{text:{en,fr,ja}, correct:bool}, ...],
 *     explanation: {en,fr,ja} }
 *
 * The current example bank below targets the chronic-pain / opioid case
 * (HAS 2019 + NICE NG59 + CDC 2022 + JOA 2019 — same evidence base as the
 * scoring). Authoring more tests for the other scenarios = follow-up.
 * ========================================================================== */
var PRETEST_CHRONIC_PAIN = [
  { id: "q1",
    q: { en: "Which of these is a RED FLAG that warrants urgent imaging in chronic low-back pain?",
         fr: "Lequel de ces éléments est un DRAPEAU ROUGE qui justifie une imagerie urgente en lombalgie chronique ?",
         ja: "慢性腰痛で緊急画像検査が必要となるレッドフラッグはどれですか?" },
    options: [
      { text: { en: "Pain worse after sitting all day",
                fr: "Douleur aggravée après une journée assise",
                ja: "一日中座った後に悪化する痛み" }, correct: false },
      { text: { en: "Saddle anaesthesia + new urinary retention",
                fr: "Anesthésie en selle + rétention urinaire récente",
                ja: "鞍状部知覚異常+新規の尿閉" }, correct: true },
      { text: { en: "Diffuse paraspinal muscle tenderness",
                fr: "Sensibilité diffuse des muscles paravertébraux",
                ja: "傍脊柱筋のびまん性圧痛" }, correct: false },
      { text: { en: "Pain that eases when lying down",
                fr: "Douleur qui s'apaise en position allongée",
                ja: "横になると楽になる痛み" }, correct: false }
    ],
    explanation: { en: "Saddle anaesthesia with urinary retention suggests cauda equina syndrome — a surgical emergency. The other features are typical of mechanical low-back pain and do NOT warrant urgent imaging.",
                   fr: "L'anesthésie en selle avec rétention urinaire évoque un syndrome de la queue de cheval — urgence chirurgicale. Les autres éléments sont typiques d'une lombalgie mécanique et ne justifient PAS d'imagerie urgente.",
                   ja: "鞍状部知覚異常と尿閉の合併は馬尾症候群を示唆し、外科的緊急症です。他の所見は機械的腰痛に典型的で、緊急画像検査は不要です。" } },
  { id: "q2",
    q: { en: "A patient with 8 months of non-radicular low-back pain and a normal neurological exam asks for an MRI. What is the most appropriate response?",
         fr: "Un patient avec 8 mois de lombalgie non radiculaire et un examen neurologique normal demande une IRM. Quelle est la réponse la plus appropriée ?",
         ja: "8か月の非神経根性腰痛と正常な神経所見を持つ患者がMRIを希望しています。最も適切な対応はどれですか?" },
    options: [
      { text: { en: "Order the MRI to reassure the patient",
                fr: "Prescrire l'IRM pour rassurer le patient",
                ja: "患者を安心させるためにMRIを指示する" }, correct: false },
      { text: { en: "Explain that imaging is not indicated and often shows incidental age-related changes that do not explain pain",
                fr: "Expliquer que l'imagerie n'est pas indiquée et révèle souvent des modifications dégénératives liées à l'âge sans rapport avec la douleur",
                ja: "画像検査は適応がなく、しばしば疼痛とは無関係の加齢性変化を見つけてしまうと説明する" }, correct: true },
      { text: { en: "Order a CT scan instead — lower cost",
                fr: "Prescrire un scanner à la place — moins coûteux",
                ja: "代わりにCTを指示する — より安価である" }, correct: false },
      { text: { en: "Refuse to discuss imaging at all",
                fr: "Refuser de discuter de l'imagerie",
                ja: "画像検査について一切話し合うことを拒否する" }, correct: false }
    ],
    explanation: { en: "Both NICE NG59, HAS and the JOA guidelines agree: imaging is not indicated in non-specific low-back pain without red flags. Incidental findings are very common and drive worry, further tests and disability — explain this and offer active management instead.",
                   fr: "NICE NG59, la HAS et les recommandations JOA convergent : l'imagerie n'est pas indiquée dans la lombalgie non spécifique sans drapeau rouge. Les trouvailles fortuites sont très fréquentes et génèrent inquiétude, examens supplémentaires et incapacité — expliquez-le et proposez plutôt une prise en charge active.",
                   ja: "NICE NG59、HAS、JOAガイドラインはいずれも一致しています:レッドフラッグのない非特異的腰痛に画像検査の適応はありません。偶発所見は非常に多く、不安・追加検査・能力障害につながります — その点を説明し、能動的なマネジメントを提案します。" } },
  { id: "q3",
    q: { en: "Which is the FIRST-LINE pharmacological approach for chronic non-specific low-back pain (per NICE NG59)?",
         fr: "Quelle est l'approche pharmacologique de PREMIÈRE INTENTION dans la lombalgie chronique non spécifique (selon NICE NG59) ?",
         ja: "慢性非特異的腰痛における第一選択の薬物療法はどれですか(NICE NG59)?" },
    options: [
      { text: { en: "Oral strong opioids (e.g. oxycodone)",
                fr: "Opioïdes forts par voie orale (ex. oxycodone)",
                ja: "経口強オピオイド(例:オキシコドン)" }, correct: false },
      { text: { en: "Oral NSAIDs at the lowest effective dose, considering GI/CV risk",
                fr: "AINS oraux à la plus faible dose efficace, en tenant compte du risque digestif/cardio-vasculaire",
                ja: "消化器・心血管リスクを考慮した最低有効用量の経口NSAIDs" }, correct: true },
      { text: { en: "Routine paracetamol monotherapy",
                fr: "Monothérapie systématique par paracétamol",
                ja: "アセトアミノフェン単独療法の定型的処方" }, correct: false },
      { text: { en: "Long-term benzodiazepines",
                fr: "Benzodiazépines au long cours",
                ja: "長期間のベンゾジアゼピン" }, correct: false }
    ],
    explanation: { en: "NICE NG59 (2016, updated 2020) recommends NSAIDs at the lowest effective dose for the shortest time as first-line pharmacology, alongside exercise and self-management. Paracetamol alone is NOT recommended for low-back pain. Opioids are not first-line and are explicitly cautioned against for chronic use.",
                   fr: "NICE NG59 (2016, mis à jour 2020) recommande les AINS à la dose efficace la plus faible et pour la durée la plus courte en première intention, associés à l'exercice et à l'autogestion. Le paracétamol seul n'est PAS recommandé. Les opioïdes ne sont pas de première intention et sont explicitement déconseillés au long cours.",
                   ja: "NICE NG59(2016年、2020年更新)は、運動および自己管理と併せて、最低有効用量で最短期間のNSAIDsを第一選択薬として推奨しています。アセトアミノフェン単剤は推奨されません。オピオイドは第一選択ではなく、慢性使用は明確に推奨されません。" } },
  { id: "q4",
    q: { en: "Which factor is a YELLOW FLAG (psychosocial predictor of chronicity) in low-back pain?",
         fr: "Quel facteur constitue un DRAPEAU JAUNE (prédicteur psycho-social de chronicisation) en lombalgie ?",
         ja: "腰痛の慢性化を予測する心理社会的因子(イエローフラッグ)はどれですか?" },
    options: [
      { text: { en: "Positive straight-leg raise test",
                fr: "Test de Lasègue positif",
                ja: "下肢伸展挙上テスト陽性" }, correct: false },
      { text: { en: "Fear of movement and activity avoidance",
                fr: "Peur du mouvement et évitement de l'activité",
                ja: "運動への恐怖と活動回避" }, correct: true },
      { text: { en: "Elevated CRP",
                fr: "CRP élevée",
                ja: "CRP上昇" }, correct: false },
      { text: { en: "Lumbar disc herniation on MRI",
                fr: "Hernie discale lombaire à l'IRM",
                ja: "MRIでの腰椎椎間板ヘルニア" }, correct: false }
    ],
    explanation: { en: "Yellow flags are psychosocial factors that predict transition to chronic pain and disability: fear of movement (kinesiophobia), catastrophising, low mood, and beliefs that pain means damage. They are the targets of cognitive-behavioural and active-rehabilitation programmes. The other items are clinical or laboratory signs, not yellow flags.",
                   fr: "Les drapeaux jaunes sont des facteurs psychosociaux prédisant le passage à la douleur chronique et à l'incapacité : peur du mouvement (kinésiophobie), catastrophisation, humeur basse, croyance que la douleur signifie une lésion. Ce sont les cibles des approches cognitivo-comportementales et de rééducation active. Les autres items sont des signes cliniques ou biologiques.",
                   ja: "イエローフラッグは慢性化と能力障害への移行を予測する心理社会的因子です:運動恐怖(キネシオフォビア)、破局的思考、抑うつ気分、痛み=損傷という信念など。認知行動的・能動的リハビリプログラムの標的となります。他は臨床的または検査的所見であり、イエローフラッグではありません。" } },
  { id: "q5",
    q: { en: "A patient asks for oxycodone by name for chronic low-back pain. The most respectful AND clinically sound response is:",
         fr: "Un patient demande nommément de l'oxycodone pour une lombalgie chronique. La réponse la plus respectueuse ET cliniquement solide est :",
         ja: "慢性腰痛の患者がオキシコドンを名指しで希望しています。最も尊重的かつ臨床的に妥当な対応は:" },
    options: [
      { text: { en: "Prescribe the oxycodone since the patient has clearly thought about it",
                fr: "Prescrire l'oxycodone puisque le patient y a manifestement réfléchi",
                ja: "患者が明確に考えてきたためオキシコドンを処方する" }, correct: false },
      { text: { en: "Tell the patient that opioids are simply not allowed for back pain",
                fr: "Dire au patient que les opioïdes ne sont tout simplement pas autorisés pour les douleurs lombaires",
                ja: "腰痛にオピオイドは認められていないと伝える" }, correct: false },
      { text: { en: "Explore the request, explain the evidence about long-term opioid harms vs benefits, and agree a non-opioid, active plan together",
                fr: "Explorer la demande, expliquer les données sur les méfaits et bénéfices des opioïdes au long cours, et convenir ensemble d'un plan actif sans opioïde",
                ja: "要望を掘り下げ、長期オピオイドのリスクと利益のエビデンスを説明し、非オピオイドの能動的な計画を共に合意する" }, correct: true },
      { text: { en: "Suggest the pain is psychological and refer to a psychiatrist",
                fr: "Suggérer que la douleur est psychologique et adresser à un psychiatre",
                ja: "痛みは心理的であると示唆し、精神科に紹介する" }, correct: false }
    ],
    explanation: { en: "Both CDC 2022 and HAS guidance emphasise shared decision-making: explore the request (why this drug, what does the patient hope it will do), share the evidence on long-term opioid risks (dependence, hyperalgesia, overdose) and lack of benefit in chronic non-cancer pain, and offer a real alternative active plan. Flat refusal damages the therapeutic alliance; dismissing the pain as 'just psychological' is harmful and inaccurate.",
                   fr: "Le CDC 2022 et la HAS soulignent la décision médicale partagée : explorer la demande (pourquoi ce médicament, qu'en attend le patient), partager les données sur les risques au long cours des opioïdes (dépendance, hyperalgésie, surdose) et l'absence de bénéfice dans la douleur chronique non cancéreuse, puis proposer un vrai plan actif alternatif. Un refus sec rompt l'alliance thérapeutique ; banaliser la douleur comme « juste psychologique » est délétère et inexact.",
                   ja: "CDC 2022およびHASは共有意思決定を強調しています:要望を掘り下げ(なぜこの薬を、何を期待しているのか)、長期オピオイドのリスク(依存、痛覚過敏、過量服用)および慢性非がん性疼痛における有効性の欠如についてエビデンスを共有し、能動的な代替プランを提案します。一方的な拒否は治療同盟を損ない、「ただの心理的なもの」と片付けることは有害で不正確です。" } }
];

var POSTTEST_CHRONIC_PAIN = [
  { id: "q1",
    q: { en: "Which combination of management is BEST supported by current guidelines for chronic non-specific low-back pain?",
         fr: "Quelle combinaison de prise en charge est le mieux étayée par les recommandations actuelles dans la lombalgie chronique non spécifique ?",
         ja: "慢性非特異的腰痛に対し現行ガイドラインで最も支持される管理の組み合わせはどれですか?" },
    options: [
      { text: { en: "Bed rest + strong opioids",
                fr: "Repos au lit + opioïdes forts",
                ja: "安静臥床+強オピオイド" }, correct: false },
      { text: { en: "Exercise + education + short-course NSAIDs if needed + addressing yellow flags",
                fr: "Exercice + éducation + AINS de courte durée si besoin + prise en compte des drapeaux jaunes",
                ja: "運動+教育+必要時の短期間NSAIDs+イエローフラッグへの対応" }, correct: true },
      { text: { en: "Long-term opioids + repeat MRI",
                fr: "Opioïdes au long cours + IRM répétées",
                ja: "長期オピオイド+繰り返しのMRI" }, correct: false },
      { text: { en: "Routine spinal injections for everyone",
                fr: "Infiltrations rachidiennes systématiques pour tous",
                ja: "全例における定型的な脊椎注射" }, correct: false }
    ],
    explanation: { en: "Exercise (any form the patient will sustain), patient education about the favourable natural history, time-limited NSAIDs, and targeting yellow flags with CBT-informed care is the package supported by NICE NG59, HAS, JOA and the ACP. Bed rest, long-term opioids, repeated imaging and routine injections are NOT recommended.",
                   fr: "Exercice (toute forme que le patient maintiendra), éducation sur l'évolution naturelle favorable, AINS de courte durée et travail sur les drapeaux jaunes en s'appuyant sur les TCC : c'est le package recommandé par NICE NG59, HAS, JOA et l'ACP. Le repos au lit, les opioïdes au long cours, l'imagerie répétée et les infiltrations systématiques ne sont PAS recommandés.",
                   ja: "運動(患者が継続できる形式なら何でも)、自然経過が良好であるという患者教育、期間限定のNSAIDs、認知行動療法を基盤としたイエローフラッグへの介入 — これがNICE NG59、HAS、JOA、ACPが支持する包括的アプローチです。安静臥床、長期オピオイド、繰り返しの画像検査、定型的な注射は推奨されません。" } },
  { id: "q2",
    q: { en: "A patient is convinced their back pain means something is structurally damaged. Which response best addresses this belief?",
         fr: "Un patient est convaincu que sa lombalgie signifie qu'il y a un dommage structurel. Quelle réponse aborde le mieux cette croyance ?",
         ja: "腰痛は構造的損傷を意味すると確信している患者がいます。この信念に最も適切に対応する応答はどれですか?" },
    options: [
      { text: { en: "Confirm their fear and recommend reduced activity",
                fr: "Confirmer sa crainte et recommander de réduire l'activité",
                ja: "不安を肯定し活動量の低下を勧める" }, correct: false },
      { text: { en: "Reassure with the evidence that hurt ≠ harm, that movement is safe, and that imaging often finds incidental changes unrelated to pain",
                fr: "Rassurer avec les données : douleur ≠ lésion, le mouvement est sûr, et l'imagerie révèle souvent des modifications fortuites sans rapport avec la douleur",
                ja: "「痛み≠損傷」、運動は安全、画像は痛みと無関係の偶発所見を見つけることが多いというエビデンスで安心させる" }, correct: true },
      { text: { en: "Order multiple scans to prove there is no damage",
                fr: "Prescrire plusieurs examens d'imagerie pour prouver l'absence de lésion",
                ja: "損傷がないことを証明するため複数の画像検査を指示する" }, correct: false },
      { text: { en: "Tell the patient firmly the pain is in their head",
                fr: "Dire fermement au patient que la douleur est dans sa tête",
                ja: "痛みは気のせいだと毅然と伝える" }, correct: false }
    ],
    explanation: { en: "Pain neuroscience education + graded exposure to movement reduces fear-avoidance and disability. Confirming fear or ordering reassurance scans paradoxically worsens chronicity; dismissing the pain as imaginary ruptures the alliance and is clinically wrong.",
                   fr: "L'éducation à la neuroscience de la douleur + l'exposition graduée au mouvement réduisent l'évitement par peur et l'incapacité. Conforter la peur ou multiplier les examens « rassurants » aggrave paradoxalement la chronicité ; banaliser la douleur comme imaginaire rompt l'alliance et est cliniquement faux.",
                   ja: "疼痛神経科学教育と段階的な運動曝露は、恐怖回避と能力障害を減らします。恐怖を肯定したり「安心のための」画像検査を重ねたりすると、逆説的に慢性化を悪化させます。痛みを想像の産物と片付けることは治療同盟を破壊し、臨床的にも誤りです。" } },
  { id: "q3",
    q: { en: "Compared to France/HAS, current Japanese (JOA 2019) guidance on chronic low-back pain is best described as:",
         fr: "Par rapport à la France/HAS, les recommandations japonaises actuelles (JOA 2019) sur la lombalgie chronique sont mieux décrites comme :",
         ja: "フランス/HASと比較して、慢性腰痛に関する現行の日本のガイドライン(JOA 2019)は最もよく次のように特徴づけられます:" },
    options: [
      { text: { en: "Routinely promoting strong opioids first-line",
                fr: "Promouvant systématiquement les opioïdes forts en première intention",
                ja: "強オピオイドを第一選択として日常的に推奨" }, correct: false },
      { text: { en: "Broadly aligned with international guidance: education, exercise, NSAIDs/short-term symptomatic relief, and cautious, limited use of weak opioids in selected cases",
                fr: "Globalement alignées sur les recommandations internationales : éducation, exercice, AINS/soulagement symptomatique à court terme, usage prudent et limité des opioïdes faibles dans des cas sélectionnés",
                ja: "国際ガイドラインと概ね一致:教育、運動、NSAIDs/短期の対症療法、選択された症例における弱オピオイドの慎重かつ限定的な使用" }, correct: true },
      { text: { en: "Banning all imaging in low-back pain",
                fr: "Interdisant toute imagerie dans la lombalgie",
                ja: "腰痛におけるあらゆる画像検査を禁止" }, correct: false },
      { text: { en: "Mandating surgery for all chronic cases",
                fr: "Imposant la chirurgie pour tous les cas chroniques",
                ja: "全ての慢性例に手術を義務付け" }, correct: false }
    ],
    explanation: { en: "The JOA 2019 guideline broadly converges with NICE NG59 and HAS: education, active rehabilitation, limited symptomatic pharmacology, and judicious imaging only when red flags or radicular features warrant it. Japanese guidance is historically more cautious with opioids than US practice was in the 2000s — a contrast that is part of the cross-cultural discussion in Module A.",
                   fr: "Les recommandations JOA 2019 convergent largement avec NICE NG59 et la HAS : éducation, rééducation active, pharmacothérapie symptomatique limitée et imagerie judicieuse seulement en présence de drapeaux rouges ou de signes radiculaires. Le Japon est historiquement plus prudent avec les opioïdes que ne l'étaient les États-Unis dans les années 2000 — contraste qui nourrit la discussion interculturelle du module A.",
                   ja: "JOA 2019ガイドラインはNICE NG59やHASと大きく方向性が一致しています:教育、能動的リハビリ、限定的な対症薬物療法、レッドフラッグまたは神経根症状がある場合にのみ慎重に画像検査を行う方針です。日本のガイダンスは2000年代の米国実臨床と比較してオピオイドに歴史的に慎重であり — この対比はモジュールAにおける異文化議論の一部となります。" } },
  { id: "q4",
    q: { en: "After a 30-minute consultation, a patient with chronic low-back pain leaves with a clear active plan but no opioid prescription. The most important determinant of LONG-TERM outcome is:",
         fr: "Après une consultation de 30 minutes, un patient avec lombalgie chronique repart avec un plan actif clair mais sans prescription d'opioïde. Le déterminant le plus important du devenir à LONG TERME est :",
         ja: "30分の診察後、慢性腰痛の患者が明確な能動的プランを得て(オピオイド処方なしで)帰宅しました。長期予後における最も重要な決定因子は:" },
    options: [
      { text: { en: "Whether they sustain regular physical activity and graded return to function",
                fr: "Le maintien d'une activité physique régulière et du retour gradué à la fonction",
                ja: "規則的な身体活動と段階的な機能回復の維持" }, correct: true },
      { text: { en: "Whether they get a repeat MRI within 6 months",
                fr: "L'obtention d'une IRM de contrôle dans les 6 mois",
                ja: "6か月以内のMRI再検査の有無" }, correct: false },
      { text: { en: "Whether the doctor was personally sympathetic",
                fr: "Le caractère personnellement sympathique du médecin",
                ja: "医師が個人的に共感的であったか" }, correct: false },
      { text: { en: "Whether the patient takes paracetamol four times a day",
                fr: "La prise de paracétamol quatre fois par jour",
                ja: "1日4回のアセトアミノフェン服用" }, correct: false }
    ],
    explanation: { en: "Sustained activity and a graded return to normal function are the single biggest predictor of better long-term outcome in chronic low-back pain — bigger than any pharmacotherapy choice. The therapeutic alliance matters but feeds into adherence, not into a separate biological mechanism. Repeat imaging without indication and unhelpful drug regimens drive harm.",
                   fr: "L'activité maintenue et le retour gradué à la fonction normale sont le plus puissant prédicteur d'un meilleur devenir à long terme dans la lombalgie chronique — bien plus que n'importe quel choix médicamenteux. L'alliance thérapeutique compte mais via l'observance, pas comme un mécanisme biologique séparé. L'imagerie répétée sans indication et les schémas médicamenteux inutiles font du mal.",
                   ja: "活動の継続と通常機能への段階的復帰は、慢性腰痛における長期予後の最大の単独予測因子であり — どの薬物療法の選択よりも大きな影響を持ちます。治療同盟は重要ですがアドヒアランスを介して作用するもので、独立した生物学的機序ではありません。適応のない画像再検査や無益な薬物レジメンは害となります。" } },
  { id: "q5",
    q: { en: "Reflecting on the cross-cultural case discussion, which statement is most accurate?",
         fr: "En réfléchissant à la discussion interculturelle du cas, quelle affirmation est la plus exacte ?",
         ja: "異文化間の症例討論を振り返り、最も正確な記述はどれですか?" },
    options: [
      { text: { en: "France and Japan have nothing in common in how they handle opioid requests",
                fr: "La France et le Japon n'ont rien en commun dans la gestion des demandes d'opioïdes",
                ja: "フランスと日本のオピオイド要望への対応には共通点がない" }, correct: false },
      { text: { en: "Both health systems converge on cautious opioid use, but differ in the cultural framing of the doctor-patient negotiation and the use of shared decision-making language",
                fr: "Les deux systèmes de santé convergent vers une utilisation prudente des opioïdes, mais diffèrent dans le cadrage culturel de la négociation médecin-patient et l'usage du langage de la décision partagée",
                ja: "両国の医療制度はオピオイドの慎重な使用において一致するが、医師-患者交渉の文化的枠組みと共有意思決定の言語の用い方で異なる" }, correct: true },
      { text: { en: "Japanese practice mirrors US prescribing culture",
                fr: "La pratique japonaise reflète la culture de prescription américaine",
                ja: "日本の実臨床は米国の処方文化を反映している" }, correct: false },
      { text: { en: "Cultural differences mean evidence-based guidelines cannot be applied across borders",
                fr: "Les différences culturelles signifient que les recommandations fondées sur les preuves ne peuvent être appliquées au-delà des frontières",
                ja: "文化的差異により、エビデンスに基づくガイドラインは国境を越えて適用できない" }, correct: false }
    ],
    explanation: { en: "The shared learning of Module A: French and Japanese guidance converge on cautious, evidence-led opioid use and on active management, but the way the consultation is framed (paternalistic-vs-shared, family role, expectations about being prescribed something) differs and is worth comparing. Evidence-based guidelines CAN be applied across cultures — but how they are delivered must be culturally fluent.",
                   fr: "L'apprentissage partagé du module A : les recommandations françaises et japonaises convergent sur un usage prudent des opioïdes fondé sur les preuves et sur la prise en charge active, mais la manière dont la consultation est cadrée (paternalisme vs partage, rôle de la famille, attente d'une prescription) diffère et mérite la comparaison. Les recommandations fondées sur les preuves PEUVENT s'appliquer entre cultures — mais leur mise en œuvre doit être culturellement fluide.",
                   ja: "モジュールAの共通の学び:フランスと日本のガイダンスは、エビデンスに基づくオピオイドの慎重な使用と能動的管理において収束しますが、診察の枠組み(パターナリズム対共有、家族の役割、処方への期待)は異なり、比較する価値があります。エビデンスに基づくガイドラインは文化を越えて適用可能ですが、その伝え方は文化的に流暢でなければなりません。" } }
];

/* ----- Scenario 2 (Breaking Bad News / Mrs Tanaka) MCQ banks -----
 * Round-2 follow-up (sim-output/round2-clinical-ebm.md severity item #7):
 * scenarios 2 and 3 previously shipped without pre/post tests. Same shape as
 * PRETEST_CHRONIC_PAIN: { id, q:{en,fr,ja}, options:[{text:{en,fr,ja}, correct}],
 * explanation:{en,fr,ja} }. Topics: capacity, SPIKES, FR/JP disclosure law
 * (loi Kouchner / MHLW 人生会議), prognosis communication. */
var PRETEST_BREAKING_BAD_NEWS = [
  { id: "q1",
    q: { en: "A 75-year-old woman with newly diagnosed Stage IV pancreatic cancer is fully oriented, can explain her situation in her own words, and weighs her options. Who has the right to decide how much she is told?",
         fr: "Une femme de 75 ans avec un cancer du pancréas de Stade IV nouvellement diagnostiqué est parfaitement orientée, peut expliquer sa situation avec ses propres mots et pèse ses options. Qui a le droit de décider de ce qu'on lui dit ?",
         ja: "新たに Stage IV 膵がんと診断された75歳の女性が、見当識は完全で、自分の状況を自分の言葉で説明でき、選択肢を比較考量できます。どこまで伝えるかを決める権利は誰にありますか?" },
    options: [
      { text: { en: "The eldest son, as head of the family",
                fr: "Le fils aîné, en tant que chef de famille",
                ja: "家長としての長男" }, correct: false },
      { text: { en: "The patient herself — she has decision-making capacity",
                fr: "La patiente elle-même — elle a la capacité de décider",
                ja: "患者本人 — 意思決定能力があるため" }, correct: true },
      { text: { en: "The treating physician, in the patient's best interests",
                fr: "Le médecin traitant, dans l'intérêt de la patiente",
                ja: "患者の最善の利益のために主治医が" }, correct: false },
      { text: { en: "Whoever signed the consent form",
                fr: "Celui qui a signé le formulaire de consentement",
                ja: "同意書に署名した人" }, correct: false }
    ],
    explanation: { en: "A patient who can understand, retain, weigh and communicate has decision-making capacity, and the information is hers. Capacity — not age, family hierarchy or a 'best-interests' override — determines who controls disclosure. This is the default in France (Loi Kouchner 2002) and in current Japanese MHLW guidance.",
                   fr: "Une patiente capable de comprendre, retenir, pondérer et communiquer a la capacité de décider, et l'information lui appartient. C'est la capacité — non l'âge, la hiérarchie familiale ou un principe de « bien du patient » — qui détermine qui contrôle l'annonce. C'est la règle en France (Loi Kouchner 2002) et dans les recommandations actuelles du MHLW japonais.",
                   ja: "理解・保持・比較考量・伝達ができる患者には意思決定能力があり、情報は本人のものです。誰が告知をコントロールするかを決めるのは、年齢でも家族の序列でも「最善の利益」原則でもなく、能力です。これはフランス(Loi Kouchner 2002)でも現行の日本のMHLWガイダンスでも原則です。" } },
  { id: "q2",
    q: { en: "In the SPIKES protocol, what is the purpose of the 'I' (Invitation) step?",
         fr: "Dans le protocole SPIKES, quel est le but de l'étape « I » (Invitation) ?",
         ja: "SPIKES プロトコルにおいて、「I」(Invitation/招待) のステップの目的は何ですか?" },
    options: [
      { text: { en: "To invite the family to make the decision for the patient",
                fr: "Inviter la famille à décider à la place du patient",
                ja: "家族を患者に代わって決めるよう招くこと" }, correct: false },
      { text: { en: "To find out how much information the patient wants, and at what level of detail",
                fr: "Découvrir combien d'informations le patient souhaite, et à quel niveau de détail",
                ja: "患者がどれだけの情報を、どの程度の詳しさで望むかを確かめること" }, correct: true },
      { text: { en: "To invite the patient to a follow-up appointment",
                fr: "Inviter le patient à un rendez-vous de suivi",
                ja: "患者をフォローアップの予約に招くこと" }, correct: false },
      { text: { en: "To deliver the diagnosis in a single clear sentence",
                fr: "Délivrer le diagnostic en une seule phrase claire",
                ja: "診断を明確な一文で伝えること" }, correct: false }
    ],
    explanation: { en: "SPIKES = Setting, Perception, Invitation, Knowledge, Empathy, Strategy/Summary. The Invitation step checks what and how much the patient wants to know BEFORE giving information — some want every detail, some want the headline only. It is also the right tool for prognosis ('would you like a number, a range, or just the headline?').",
                   fr: "SPIKES = Setting (cadre), Perception, Invitation, Knowledge (savoir), Empathy (empathie), Strategy/Summary. L'étape Invitation vérifie ce que le patient veut savoir et jusqu'où AVANT de donner l'information — certains veulent tous les détails, d'autres juste l'essentiel. C'est aussi le bon outil pour le pronostic (« voulez-vous un chiffre, une fourchette, ou juste l'essentiel ? »).",
                   ja: "SPIKES = Setting(場の設定)、Perception(認識)、Invitation(招待)、Knowledge(情報)、Empathy(共感)、Strategy/Summary(方針・要約)。Invitation のステップは、情報を伝える前に、患者が何をどこまで知りたいかを確認します — すべての詳細を望む人もいれば、要点だけを望む人もいます。予後告知(「数字、範囲、要点のどれをお望みですか?」)にも適した手段です。" } },
  { id: "q3",
    q: { en: "Which French law established the patient's right to be directly informed of their diagnosis?",
         fr: "Quelle loi française a établi le droit du patient à être directement informé de son diagnostic ?",
         ja: "患者が自らの診断について直接知らされる権利を確立したフランスの法律はどれですか?" },
    options: [
      { text: { en: "Loi Kouchner (loi n°2002-303 du 4 mars 2002)",
                fr: "Loi Kouchner (loi n°2002-303 du 4 mars 2002)",
                ja: "Loi Kouchner(2002年3月4日 法律第2002-303号)" }, correct: true },
      { text: { en: "Loi Leonetti (2005) on end-of-life care only",
                fr: "Loi Leonetti (2005) sur la fin de vie uniquement",
                ja: "終末期医療のみを扱うLeonetti法(2005)" }, correct: false },
      { text: { en: "The Napoleonic Code",
                fr: "Le Code Napoléon",
                ja: "ナポレオン法典" }, correct: false },
      { text: { en: "There is no such law in France",
                fr: "Il n'existe pas de telle loi en France",
                ja: "フランスにはそのような法律はない" }, correct: false }
    ],
    explanation: { en: "The Loi Kouchner (2002) made direct disclosure to the competent patient the legal default in France and created the right to be informed (and the right NOT to know, if the patient expresses it). The Loi Leonetti (2005, revised 2016) deals with end-of-life decisions and advance directives — related but distinct.",
                   fr: "La Loi Kouchner (2002) a fait de l'information directe au patient apte la règle légale en France et a créé le droit d'être informé (et le droit de NE PAS savoir, si le patient l'exprime). La Loi Leonetti (2005, révisée 2016) traite des décisions de fin de vie et des directives anticipées — liée mais distincte.",
                   ja: "Loi Kouchner(2002)は、判断能力のある患者本人への直接告知をフランスの法的原則とし、知らされる権利(および患者が表明すれば知らない権利)を確立しました。Leonetti法(2005、2016改正)は終末期の意思決定と事前指示を扱うもので、関連はあるが別物です。" } },
  { id: "q4",
    q: { en: "How is Japanese practice on cancer disclosure (がん告知) best characterised today, compared with the 1990s?",
         fr: "Comment caractériser au mieux la pratique japonaise d'annonce du cancer (がん告知) aujourd'hui, par rapport aux années 1990 ?",
         ja: "1990年代と比べて、今日の日本のがん告知の実践は最もよくどのように特徴づけられますか?" },
    options: [
      { text: { en: "Unchanged — the diagnosis is still routinely withheld from the patient",
                fr: "Inchangée — le diagnostic est encore systématiquement caché au patient",
                ja: "変わっていない — 診断は今も日常的に患者に伏せられている" }, correct: false },
      { text: { en: "Converging toward patient-centred disclosure, supported by MHLW guidance and the 人生会議 (ACP) campaign",
                fr: "Convergeant vers une annonce centrée sur le patient, soutenue par les recommandations du MHLW et la campagne 人生会議 (ACP)",
                ja: "MHLWのガイダンスと人生会議(ACP)キャンペーンに支えられ、患者中心の告知へと収束しつつある" }, correct: true },
      { text: { en: "Now identical to US practice in every respect",
                fr: "Désormais identique à la pratique américaine en tous points",
                ja: "今やあらゆる点で米国の実践と同一" }, correct: false },
      { text: { en: "Legally banned from telling patients their diagnosis",
                fr: "Interdisant légalement d'annoncer leur diagnostic aux patients",
                ja: "患者に診断を伝えることが法的に禁止されている" }, correct: false }
    ],
    explanation: { en: "Japanese practice has moved from family-mediated non-disclosure (common into the 1990s) toward patient-centred decision-making, supported by MHLW end-of-life guidance (2007, revised 2018) and the 人生会議 (jinsei kaigi / advance care planning) campaign launched in 2018. The systems are converging with France, not diverging — but the family's role remains more prominent by default.",
                   fr: "La pratique japonaise est passée de l'annonce médiée par la famille (courante jusque dans les années 1990) à une décision centrée sur le patient, soutenue par les recommandations de fin de vie du MHLW (2007, révisées 2018) et la campagne 人生会議 (jinsei kaigi / planification anticipée) lancée en 2018. Les systèmes convergent avec la France — mais le rôle de la famille reste plus présent par défaut.",
                   ja: "日本の実践は、家族を介した非告知(1990年代まで一般的)から患者中心の意思決定へと移行し、MHLWの終末期ガイダンス(2007、2018改訂)と2018年開始の人生会議(アドバンス・ケア・プランニング)キャンペーンに支えられています。両国の制度は乖離ではなく収束しつつありますが、家族の役割は依然として既定でより大きいままです。" } },
  { id: "q5",
    q: { en: "A family member privately asks the team not to tell a competent patient her diagnosis. The best FIRST response is:",
         fr: "Un proche demande discrètement à l'équipe de ne pas annoncer le diagnostic à une patiente apte. La meilleure PREMIÈRE réponse est :",
         ja: "ある家族が、判断能力のある患者に診断を伝えないでほしいとチームにそっと頼みます。最初の対応として最善なのは:" },
    options: [
      { text: { en: "Promise to withhold it — the family knows the patient best",
                fr: "Promettre de ne rien dire — la famille connaît mieux la patiente",
                ja: "伏せると約束する — 家族が患者を最もよく知っているから" }, correct: false },
      { text: { en: "Acknowledge the family member's fear, then ask the patient herself how much she wants to know",
                fr: "Reconnaître la peur du proche, puis demander à la patiente elle-même ce qu'elle souhaite savoir",
                ja: "家族の恐れを受け止め、その上で患者本人にどこまで知りたいかを尋ねる" }, correct: true },
      { text: { en: "Refuse firmly and go straight in to tell the patient everything",
                fr: "Refuser fermement et entrer directement tout dire à la patiente",
                ja: "毅然と拒否し、直ちに患者にすべてを伝えに行く" }, correct: false },
      { text: { en: "Tell the family member it is none of their business",
                fr: "Dire au proche que cela ne le regarde pas",
                ja: "家族に、あなたには関係ないことだと伝える" }, correct: false }
    ],
    explanation: { en: "The skilled move refuses the false binary of 'tell vs withhold'. Acknowledge the family member's fear (often grounded in love or recent loss), then ask the patient herself what and how much she wants to know. This honours both the family's role and the patient's autonomy. Promising to withhold removes her right to information; rigidly overriding the family breaks the alliance — and neither has actually asked the patient.",
                   fr: "Le geste expert refuse le faux dilemme « dire ou cacher ». Reconnaître la peur du proche (souvent ancrée dans l'amour ou un deuil récent), puis demander à la patiente elle-même ce qu'elle souhaite savoir et jusqu'où. Cela honore à la fois le rôle de la famille et l'autonomie de la patiente. Promettre de cacher la prive de son droit à l'information ; contourner rigidement la famille rompt l'alliance — et aucun des deux n'a interrogé la patiente.",
                   ja: "熟練した対応は「伝える対伏せる」という誤った二者択一を退けます。家族の恐れ(しばしば愛情や最近の死別に根ざす)を受け止め、その上で患者本人に何をどこまで知りたいかを尋ねます。これは家族の役割と患者の自律の双方を尊重します。伏せると約束すれば情報の権利を奪い、家族を硬直的に押しのければ同盟を壊します — どちらも患者本人には尋ねていません。" } }
,
  { id: "q6",
    q: { en: "The consultation is run jointly by a French and a Japanese physician. What is the best way to handle the LANGUAGE of breaking the news?",
         fr: "La consultation est menée conjointement par un médecin français et un médecin japonais. Quelle est la meilleure façon de gérer la LANGUE de l'annonce ?",
         ja: "診察はフランス人医師と日本人医師が共同で担当します。告知に用いる言語を最もよく扱う方法は?" },
    options: [
      { text: { en: "Always use the doctor's strongest language, regardless of the patient",
                fr: "Toujours utiliser la langue la plus forte du médecin, sans tenir compte du patient",
                ja: "患者に関係なく、常に医師が最も得意な言語を使う" }, correct: false },
      { text: { en: "Break the news in the language the patient understands best, and be transparent if you are working in a non-native language",
                fr: "Annoncer dans la langue que la patiente comprend le mieux, et être transparent si vous travaillez dans une langue non maternelle",
                ja: "患者が最もよく理解する言語で告知し、母語でない言語で進めている場合はそれを正直に伝える" }, correct: true },
      { text: { en: "Use medical jargon so nothing is lost in translation",
                fr: "Utiliser le jargon médical pour que rien ne se perde à la traduction",
                ja: "翻訳で失われないよう医学専門用語を使う" }, correct: false },
      { text: { en: "Have the family translate everything informally",
                fr: "Faire traduire le tout de façon informelle par la famille",
                ja: "すべてを家族に非公式に通訳させる" }, correct: false }
    ],
    explanation: { en: "Breaking bad news must happen in the language the patient understands best, with a professional interpreter where needed — never via informal family translation, which burdens relatives and risks softening or distorting the message. If the clinician is working in a non-native language, being transparent about that ('I want to be sure I explain this clearly — please stop me if anything is unclear') protects the patient. Jargon obscures rather than clarifies.",
                   fr: "L'annonce d'une mauvaise nouvelle doit se faire dans la langue que la patiente comprend le mieux, avec un interprète professionnel si nécessaire — jamais via une traduction familiale informelle, qui pèse sur les proches et risque d'adoucir ou de déformer le message. Si le clinicien travaille dans une langue non maternelle, être transparent à ce sujet (« je veux être sûr de bien expliquer — arrêtez-moi si quelque chose n'est pas clair ») protège la patiente. Le jargon obscurcit au lieu de clarifier.",
                   ja: "悪い知らせの告知は、患者が最もよく理解する言語で、必要なら専門の通訳を介して行うべきであり — 家族による非公式の通訳は決して用いません。それは家族に負担をかけ、メッセージを和らげたり歪めたりする危険があります。臨床医が母語でない言語で進める場合、その旨を正直に伝えること(「きちんと説明したいので、分かりにくければ止めてください」)が患者を守ります。専門用語は明確化ではなく不明瞭化を招きます。" } }
];

var POSTTEST_BREAKING_BAD_NEWS = [
  { id: "q1",
    q: { en: "After exploring the son's fear and asking the patient, you learn she wants to know — gently, at her pace, with her son present. What does this tell you about the 'family vs patient' conflict?",
         fr: "Après avoir exploré la peur du fils et interrogé la patiente, vous apprenez qu'elle veut savoir — doucement, à son rythme, avec son fils présent. Que vous apprend cela sur le conflit « famille vs patiente » ?",
         ja: "息子の恐れを掘り下げ患者に尋ねた結果、彼女は「優しく、自分のペースで、息子に同席してもらって」知りたいと分かりました。これは「家族対患者」の対立について何を教えますか?" },
    options: [
      { text: { en: "The conflict was real and unresolvable",
                fr: "Le conflit était réel et insoluble",
                ja: "対立は本物で解決不能だった" }, correct: false },
      { text: { en: "Much of the apparent conflict dissolves once you ask the right person in the right order",
                fr: "Une grande partie du conflit apparent se dissout dès qu'on interroge la bonne personne dans le bon ordre",
                ja: "正しい順序で正しい人に尋ねれば、見かけの対立の多くは解消する" }, correct: true },
      { text: { en: "The son should have been overruled immediately",
                fr: "Le fils aurait dû être désavoué immédiatement",
                ja: "息子は即座に押し切られるべきだった" }, correct: false },
      { text: { en: "The patient should not have been asked at all",
                fr: "On n'aurait pas dû interroger la patiente du tout",
                ja: "患者には一切尋ねるべきではなかった" }, correct: false }
    ],
    explanation: { en: "The 'family vs patient' framing is often a false binary. The son's wish (protect his mother) and the mother's wish (to know, gently, with him present) are largely compatible — the apparent conflict was an artefact of not having asked her. Acknowledging the family's fear and then asking the patient resolves most of it.",
                   fr: "Le cadrage « famille vs patiente » est souvent un faux dilemme. Le souhait du fils (protéger sa mère) et celui de la mère (savoir, doucement, en sa présence) sont largement compatibles — le conflit apparent venait de ne pas l'avoir interrogée. Reconnaître la peur de la famille puis interroger la patiente en résout l'essentiel.",
                   ja: "「家族対患者」という枠組みはしばしば誤った二者択一です。息子の願い(母を守る)と母の願い(優しく、息子の同席のもとで知る)は大きく両立します — 見かけの対立は、彼女に尋ねていなかったことの産物でした。家族の恐れを受け止め、その上で患者に尋ねることで、その大半は解消します。" } },
  { id: "q2",
    q: { en: "Mrs Tanaka asks 'How long do I have?'. Which response best applies SPIKES to prognosis?",
         fr: "Mme Tanaka demande « Combien de temps me reste-t-il ? ». Quelle réponse applique le mieux SPIKES au pronostic ?",
         ja: "田中さんが「あとどれくらいですか?」と尋ねます。予後告知にSPIKESを最もよく適用する応答はどれですか?" },
    options: [
      { text: { en: "Immediately state '6-11 months with chemotherapy'",
                fr: "Annoncer immédiatement « 6 à 11 mois avec chimiothérapie »",
                ja: "ただちに「化学療法ありで6-11か月」と告げる" }, correct: false },
      { text: { en: "Ask what KIND of answer she wants (precise number, rough range, or just the headline) before answering",
                fr: "Demander quel TYPE de réponse elle souhaite (chiffre précis, fourchette, ou juste l'essentiel) avant de répondre",
                ja: "答える前に、どんな種類の答え(正確な数字、大まかな範囲、要点だけ)を望むかを尋ねる" }, correct: true },
      { text: { en: "Deflect with 'every patient is different' and change the subject",
                fr: "Esquiver avec « chaque patient est différent » et changer de sujet",
                ja: "「患者さんごとに違います」とはぐらかして話題を変える" }, correct: false },
      { text: { en: "Refer the question to the oncologist next week",
                fr: "Renvoyer la question à l'oncologue la semaine prochaine",
                ja: "その質問は来週腫瘍内科医に回す" }, correct: false }
    ],
    explanation: { en: "Applying SPIKES Invitation to prognosis means calibrating the resolution to what the patient actually wants. Volunteering a precise median unasked can land like a sentence; deflecting denies her the ability to plan. Naming the question as important and asking what kind of answer she wants respects her autonomy and improves both understanding and emotional integration.",
                   fr: "Appliquer l'Invitation de SPIKES au pronostic, c'est calibrer la résolution sur ce que la patiente souhaite réellement. Donner une médiane précise sans qu'elle l'ait demandée peut tomber comme une condamnation ; esquiver lui refuse la possibilité de planifier. Nommer l'importance de la question et demander quel type de réponse elle veut respecte son autonomie et améliore compréhension et intégration émotionnelle.",
                   ja: "SPIKESのInvitationを予後に応用するとは、患者が実際に望む粒度に合わせることです。求められてもいない正確な中央値を持ち出すと宣告のように響きかねず、はぐらかしは計画する力を奪います。質問の重要性を認め、どんな答えを望むかを尋ねることは、自律を尊重し、理解と感情的統合の双方を高めます。" } },
  { id: "q3",
    q: { en: "The patient has obstructive jaundice with severe itching but has not decided about chemotherapy. Regarding ERCP biliary stenting, the correct approach is:",
         fr: "La patiente présente un ictère obstructif avec un prurit sévère mais n'a pas décidé pour la chimiothérapie. Concernant le drainage biliaire par CPRE, la bonne approche est :",
         ja: "患者は閉塞性黄疸で強い掻痒がありますが、化学療法はまだ決めていません。ERCP胆道ステントについて正しいアプローチは:" },
    options: [
      { text: { en: "Withhold the stent until she decides about chemotherapy",
                fr: "Différer le stent jusqu'à sa décision sur la chimiothérapie",
                ja: "化学療法を決めるまでステントを保留する" }, correct: false },
      { text: { en: "Offer it now as symptom relief, independent of the chemotherapy decision",
                fr: "Le proposer maintenant pour soulager les symptômes, indépendamment de la chimiothérapie",
                ja: "化学療法の決定とは独立に、症状緩和として今提案する" }, correct: true },
      { text: { en: "Only stent if she agrees to chemotherapy",
                fr: "Ne poser le stent que si elle accepte la chimiothérapie",
                ja: "化学療法に同意した場合のみステントを留置する" }, correct: false },
      { text: { en: "Stenting is never indicated in metastatic disease",
                fr: "Le stent n'est jamais indiqué dans la maladie métastatique",
                ja: "転移性疾患ではステントは決して適応にならない" }, correct: false }
    ],
    explanation: { en: "Biliary stenting is a symptom-control intervention — it relieves jaundice and pruritus and reduces cholangitis risk regardless of the cancer-treatment decision. It should be offered promptly and framed as separate from the chemotherapy choice. Bundling a palliative comfort measure into a curative-intent decision needlessly prolongs suffering.",
                   fr: "Le drainage biliaire est un geste de contrôle des symptômes — il soulage l'ictère et le prurit et réduit le risque d'angiocholite quelle que soit la décision oncologique. Il doit être proposé rapidement et présenté comme distinct du choix de chimiothérapie. Confondre une mesure de confort palliatif avec une décision à visée curative prolonge inutilement la souffrance.",
                   ja: "胆道ステントは症状コントロールの手技であり、がん治療の決定とは無関係に黄疸・掻痒を軽減し胆管炎リスクを下げます。速やかに提案し、化学療法の選択とは別物として提示すべきです。緩和的安楽措置を根治目的の決定と束ねることは、苦痛を不必要に長引かせます。" } },
  { id: "q4",
    q: { en: "Which statement best captures the France/Japan comparison this case is built around?",
         fr: "Quelle affirmation résume le mieux la comparaison France/Japon autour de laquelle ce cas est construit ?",
         ja: "この症例が軸とするフランス/日本の比較を最もよく捉える記述はどれですか?" },
    options: [
      { text: { en: "France and Japan are fundamentally opposed on disclosure and cannot learn from each other",
                fr: "La France et le Japon sont fondamentalement opposés sur l'annonce et ne peuvent rien s'apprendre",
                ja: "フランスと日本は告知について根本的に対立し、互いに学べない" }, correct: false },
      { text: { en: "Both default to patient autonomy in law/guidance, but differ in the prominence of the family and in softening language — and Japan is converging toward direct disclosure",
                fr: "Les deux privilégient l'autonomie du patient en droit/recommandations, mais diffèrent par la place de la famille et l'adoucissement du langage — et le Japon converge vers l'annonce directe",
                ja: "両国とも法・ガイダンス上は患者の自律を原則とするが、家族の存在感と言葉の和らげ方で異なり、日本は直接告知へ収束しつつある" }, correct: true },
      { text: { en: "Japan never involves the family in any medical decision",
                fr: "Le Japon n'implique jamais la famille dans une décision médicale",
                ja: "日本は医療上の決定に家族を一切関与させない" }, correct: false },
      { text: { en: "France always tells the family first, before the patient",
                fr: "La France informe toujours la famille en premier, avant le patient",
                ja: "フランスは常に患者より先に家族に伝える" }, correct: false }
    ],
    explanation: { en: "Both systems default to the competent patient's autonomy (Loi Kouchner; MHLW guidance + 人生会議), but the cultural framing differs: the family is more routinely present by default in Japan, and softer Japanese clinical language (進行, 限られた時間) can do work that the word 'cancer' does in French. Japan is converging toward direct disclosure rather than diverging — the cases are more similar than the stereotype suggests.",
                   fr: "Les deux systèmes privilégient l'autonomie de la patiente apte (Loi Kouchner ; recommandations du MHLW + 人生会議), mais le cadrage culturel diffère : la famille est plus systématiquement présente par défaut au Japon, et un langage clinique japonais plus doux (進行, 限られた時間) peut faire le travail que le mot « cancer » fait en français. Le Japon converge vers l'annonce directe plutôt qu'il ne s'en éloigne — les pratiques sont plus proches que le stéréotype ne le suggère.",
                   ja: "両制度とも判断能力のある患者の自律を原則とします(Loi Kouchner;MHLWガイダンス+人生会議)が、文化的枠組みは異なります:日本では家族が既定でより日常的に同席し、より柔らかな日本語の臨床表現(進行、限られた時間)が、フランス語で「がん」が果たす役割を担うことがあります。日本は直接告知から遠ざかるのではなく収束しつつあり — 実践はステレオタイプが示すより似ています。" } },
  { id: "q5",
    q: { en: "What does confirming a patient's decision-making capacity (Understand / Retain / Weigh / Communicate) achieve in this case?",
         fr: "Que permet la confirmation de la capacité décisionnelle de la patiente (Comprendre / Retenir / Pondérer / Communiquer) dans ce cas ?",
         ja: "この症例で患者の意思決定能力(理解/保持/比較考量/伝達)を確認することは何を達成しますか?" },
    options: [
      { text: { en: "It allows the team to bypass her on best-interests grounds",
                fr: "Cela permet à l'équipe de la contourner au nom de son intérêt",
                ja: "最善の利益を理由に本人を素通りすることを可能にする" }, correct: false },
      { text: { en: "It establishes that disclosure decisions are hers, and removes any clinical basis for family-mediated non-disclosure",
                fr: "Cela établit que les décisions d'annonce lui appartiennent, et retire toute base clinique à une non-divulgation médiée par la famille",
                ja: "告知の決定が本人のものであることを確立し、家族介在型の非告知の臨床的根拠を取り除く" }, correct: true },
      { text: { en: "It is a formality with no bearing on disclosure",
                fr: "C'est une formalité sans incidence sur l'annonce",
                ja: "告知に影響しない形式的手続きにすぎない" }, correct: false },
      { text: { en: "It transfers the decision to the eldest son",
                fr: "Cela transfère la décision au fils aîné",
                ja: "決定を長男に移す" }, correct: false }
    ],
    explanation: { en: "Documenting capacity (the four-part test: understand, retain, weigh, communicate) establishes that the information and the disclosure decision belong to the patient. With full capacity there is no clinical or legal basis to bypass her under a 'best-interests' doctrine — that doctrine applies only when capacity is absent. This protects the patient against well-meant but autonomy-eroding family-mediated non-disclosure.",
                   fr: "Documenter la capacité (le test en quatre temps : comprendre, retenir, pondérer, communiquer) établit que l'information et la décision d'annonce appartiennent à la patiente. Avec une pleine capacité, il n'existe aucune base clinique ou légale pour la contourner au titre du « bien du patient » — ce principe ne s'applique qu'en l'absence de capacité. Cela protège la patiente d'une non-divulgation médiée par la famille, bien intentionnée mais érodant l'autonomie.",
                   ja: "能力の記録(4要素テスト:理解・保持・比較考量・伝達)は、情報と告知の決定が患者本人に属することを確立します。完全な能力がある場合、「最善の利益」原則で本人を素通りする臨床的・法的根拠はありません — その原則は能力を欠く場合にのみ適用されます。これは、善意ではあるが自律を損なう家族介在型の非告知から患者を守ります。" } }
,
  { id: "q6",
    q: { en: "Comparing France and Japan, which is the EXPECTED default for who is present at a serious-news consultation?",
         fr: "En comparant la France et le Japon, quelle est la règle ATTENDUE par défaut quant à qui est présent lors d'une annonce grave ?",
         ja: "フランスと日本を比較して、重大な告知の場に誰が同席するかについての標準的なデフォルトはどれですか?" },
    options: [
      { text: { en: "Japan: a family member present is the expected default; France: the patient is asked first whether they want anyone present",
                fr: "Japon : la présence d'un proche est la norme attendue ; France : on demande d'abord au patient s'il souhaite quelqu'un",
                ja: "日本:家族の同席が標準的な前提;フランス:まず患者に同席者を望むか尋ねる" }, correct: true },
      { text: { en: "Both countries forbid any family presence",
                fr: "Les deux pays interdisent toute présence familiale",
                ja: "両国とも家族の同席を一切禁じている" }, correct: false },
      { text: { en: "France always requires the whole family; Japan always excludes them",
                fr: "La France exige toujours toute la famille ; le Japon les exclut toujours",
                ja: "フランスは常に家族全員を求め、日本は常に家族を排除する" }, correct: false },
      { text: { en: "Neither country has any norm about who attends",
                fr: "Aucun des deux pays n'a de norme sur qui assiste",
                ja: "どちらの国にも同席者についての規範はない" }, correct: false }
    ],
    explanation: { en: "In Japan a family member present at a serious-news consultation is the expected default; in France the patient is asked first whether they want someone present. Neither is wrong — each protects the patient differently and each can fail differently (Japan risks the patient being talked around; France risks isolating a patient who wanted support). The skilled clinician asks the patient her preference rather than assuming the national default.",
                   fr: "Au Japon, la présence d'un proche lors d'une annonce grave est la norme attendue ; en France, on demande d'abord au patient s'il souhaite quelqu'un. Aucune n'est fausse — chacune protège le patient autrement et peut faillir autrement (le Japon risque que l'on parle autour du patient ; la France risque d'isoler un patient qui voulait du soutien). Le clinicien expert demande sa préférence à la patiente plutôt que de présumer la norme nationale.",
                   ja: "日本では重大な告知に家族が同席するのが標準的な前提であり、フランスではまず患者に同席者を望むか尋ねます。どちらも誤りではなく — それぞれ異なる形で患者を守り、異なる形で失敗しうます(日本は患者を素通りして話される危険、フランスは支えを望んだ患者を孤立させる危険)。熟練した臨床医は、国ごとのデフォルトを前提とせず、患者本人に希望を尋ねます。" } }
];

/* ----- Scenario 3 (Antibiotic Stewardship / Mme Moreau) MCQ banks -----
 * Topics: Centor/McIsaac scoring, NICE NG84 delayed prescribing, AMR
 * stewardship, and the EBV-mononucleosis + amoxicillin rash trap. */
var PRETEST_RESPIRATORY_STEWARDSHIP = [
  { id: "q1",
    q: { en: "Which of the following is a Centor/McIsaac criterion that INCREASES the likelihood of group A streptococcal pharyngitis?",
         fr: "Lequel des éléments suivants est un critère de Centor/McIsaac qui AUGMENTE la probabilité d'une pharyngite à streptocoque du groupe A ?",
         ja: "次のうち、A群溶連菌性咽頭炎の可能性を高めるCentor/McIsaacの項目はどれですか?" },
    options: [
      { text: { en: "Presence of a cough",
                fr: "Présence d'une toux",
                ja: "咳があること" }, correct: false },
      { text: { en: "Tender anterior cervical lymphadenopathy",
                fr: "Adénopathie cervicale antérieure douloureuse",
                ja: "圧痛を伴う前頸部リンパ節腫脹" }, correct: true },
      { text: { en: "A runny nose (coryza)",
                fr: "Un nez qui coule (rhinorrhée)",
                ja: "鼻水(鼻汁)" }, correct: false },
      { text: { en: "Hoarseness",
                fr: "Un enrouement",
                ja: "嗄声" }, correct: false }
    ],
    explanation: { en: "Centor/McIsaac points are: fever > 38°C, absence of cough, tender anterior cervical nodes, tonsillar swelling/exudate, plus an age adjustment (McIsaac). Cough, coryza and hoarseness all point toward a VIRAL cause and do not score. Tender anterior cervical adenopathy is one of the four classic positive criteria.",
                   fr: "Les points de Centor/McIsaac sont : fièvre > 38°C, absence de toux, adénopathie cervicale antérieure douloureuse, hypertrophie/exsudat amygdalien, plus un ajustement selon l'âge (McIsaac). La toux, la rhinorrhée et l'enrouement orientent vers une cause VIRALE et ne comptent pas. L'adénopathie cervicale antérieure douloureuse est l'un des quatre critères positifs classiques.",
                   ja: "Centor/McIsaacの項目は:38°C超の発熱、咳がない、圧痛を伴う前頸部リンパ節、扁桃腫脹/滲出液、加えて年齢補正(McIsaac)です。咳・鼻汁・嗄声はいずれもウイルス性を示唆し加点されません。圧痛を伴う前頸部リンパ節腫脹は古典的な4つの陽性項目の一つです。" } },
  { id: "q2",
    q: { en: "A 32-year-old with sore throat, cough, coryza, low-grade fever and Centor/McIsaac 0 asks for amoxicillin. What is the best management?",
         fr: "Une femme de 32 ans avec mal de gorge, toux, rhinorrhée, fébricule et Centor/McIsaac 0 demande de l'amoxicilline. Quelle est la meilleure prise en charge ?",
         ja: "のどの痛み、咳、鼻水、軽度の発熱があり Centor/McIsaac 0 の32歳がアモキシシリンを希望します。最善の対応は?" },
    options: [
      { text: { en: "Prescribe a 5-day amoxicillin course as requested",
                fr: "Prescrire une cure d'amoxicilline de 5 jours comme demandé",
                ja: "希望どおりアモキシシリン5日分を処方する" }, correct: false },
      { text: { en: "Decline antibiotics, explain why in plain language, give a symptomatic plan and a safety-net",
                fr: "Refuser les antibiotiques, expliquer pourquoi en mots simples, donner un plan symptomatique et un filet de sécurité",
                ja: "抗生物質を控え、平易な言葉で理由を説明し、対症療法プランとセーフティネットを示す" }, correct: true },
      { text: { en: "Send a throat culture and prescribe while waiting",
                fr: "Envoyer une culture de gorge et prescrire en attendant",
                ja: "咽頭培養を提出し、結果待ちの間に処方する" }, correct: false },
      { text: { en: "Prescribe a broad-spectrum antibiotic to be safe",
                fr: "Prescrire un antibiotique à large spectre par précaution",
                ja: "念のため広域抗生物質を処方する" }, correct: false }
    ],
    explanation: { en: "At Centor/McIsaac 0 the picture is viral pharyngitis; HAS 2021, NICE NG84 and the CDC all agree antibiotics are not indicated and do not even recommend a rapid antigen test at this score. The job is to decline, explain, provide a real symptomatic plan and safety-net — taking the patient seriously, not minimising her.",
                   fr: "À Centor/McIsaac 0, le tableau est une pharyngite virale ; HAS 2021, NICE NG84 et le CDC s'accordent : les antibiotiques ne sont pas indiqués et un test antigénique rapide n'est même pas recommandé à ce score. Le rôle est de refuser, d'expliquer, de fournir un vrai plan symptomatique et un filet de sécurité — en prenant la patiente au sérieux, sans la minimiser.",
                   ja: "Centor/McIsaac 0 では所見はウイルス性咽頭炎です;HAS 2021、NICE NG84、CDCはいずれも、抗生物質の適応はなく、このスコアでは迅速抗原検査すら推奨しないと一致しています。求められるのは、断り、説明し、実効性のある対症療法プランとセーフティネットを提供することです — 患者を軽視せず真剣に受け止めて。" } },
  { id: "q3",
    q: { en: "What is 'delayed (back-pocket) prescribing' as endorsed by NICE NG84?",
         fr: "Qu'est-ce que la « prescription différée (de réserve) » telle qu'avalisée par NICE NG84 ?",
         ja: "NICE NG84が支持する「遅延(とっておき)処方」とは何ですか?" },
    options: [
      { text: { en: "Refusing all prescriptions on principle",
                fr: "Refuser toute prescription par principe",
                ja: "原則としてすべての処方を拒否すること" }, correct: false },
      { text: { en: "Giving a prescription the patient is asked NOT to fill unless they get worse over 48-72 hours",
                fr: "Donner une ordonnance que le patient est prié de NE PAS utiliser sauf en cas d'aggravation à 48-72 heures",
                ja: "48-72時間で悪化しない限り使わないよう患者に求めたうえで処方箋を渡すこと" }, correct: true },
      { text: { en: "Posting the antibiotics to the patient a week later",
                fr: "Envoyer les antibiotiques au patient une semaine plus tard",
                ja: "1週間後に抗生物質を患者に郵送すること" }, correct: false },
      { text: { en: "Prescribing a lower dose than usual",
                fr: "Prescrire une dose plus faible que d'habitude",
                ja: "通常より低用量で処方すること" }, correct: false }
    ],
    explanation: { en: "Delayed prescribing is a recognised middle path (NICE NG84, supported by Cochrane reviews): the patient leaves with a prescription but is asked to fill it only if they fail to improve or worsen over 48-72 hours. Used selectively with clear rules, it reduces antibiotic use; used reflexively 'to keep everyone happy', it just outsources the decision and becomes a slower immediate prescription.",
                   fr: "La prescription différée est une voie intermédiaire reconnue (NICE NG84, soutenue par les revues Cochrane) : le patient repart avec une ordonnance mais on lui demande de ne l'utiliser qu'en cas de non-amélioration ou d'aggravation à 48-72 heures. Utilisée de façon sélective avec des règles claires, elle réduit l'usage d'antibiotiques ; utilisée par réflexe « pour contenter tout le monde », elle ne fait que sous-traiter la décision et devient une prescription immédiate plus lente.",
                   ja: "遅延処方は認められた中間的手段です(NICE NG84、Cochraneレビューも支持):患者は処方箋を持ち帰りますが、48-72時間で改善しないか悪化した場合にのみ使うよう求められます。明確なルールのもとで選択的に使えば抗生物質使用を減らしますが、「みんなを満足させるため」に反射的に使えば、判断を外注するだけで時間差のある即時処方になってしまいます。" } },
  { id: "q4",
    q: { en: "Why is prescribing amoxicillin to a young adult who actually has infectious mononucleosis (EBV) a particular hazard?",
         fr: "Pourquoi prescrire de l'amoxicilline à un jeune adulte qui a en réalité une mononucléose infectieuse (EBV) est-il un danger particulier ?",
         ja: "実際には伝染性単核球症(EBV)である若年成人にアモキシシリンを処方することが、なぜ特に危険なのですか?" },
    options: [
      { text: { en: "It cures the EBV infection too quickly",
                fr: "Elle guérit l'infection à EBV trop vite",
                ja: "EBV感染をあまりに速く治してしまうから" }, correct: false },
      { text: { en: "Most such patients develop a florid morbilliform rash, often mislabelled as a permanent penicillin allergy",
                fr: "La plupart de ces patients développent une éruption morbilliforme floride, souvent étiquetée à tort comme une allergie permanente à la pénicilline",
                ja: "そうした患者の多くが顕著な麻疹様皮疹を生じ、しばしば永続的なペニシリンアレルギーと誤標識される" }, correct: true },
      { text: { en: "Amoxicillin is contraindicated in everyone under 40",
                fr: "L'amoxicilline est contre-indiquée chez tous les moins de 40 ans",
                ja: "アモキシシリンは40歳未満の全員に禁忌である" }, correct: false },
      { text: { en: "It turns EBV into a bacterial infection",
                fr: "Elle transforme l'EBV en infection bactérienne",
                ja: "EBVを細菌感染に変えてしまうから" }, correct: false }
    ],
    explanation: { en: "EBV mononucleosis is a common mimic of strep in young adults (posterior cervical adenopathy is a hint). Roughly 80-100% of EBV patients given an aminopenicillin such as amoxicillin develop a maculopapular/morbilliform rash. This is frequently mislabelled as a true penicillin allergy — a durable, iatrogenic label that follows the patient for life and narrows their future antibiotic options. This is a safety reason to avoid empirical amoxicillin for sore throat, independent of the AMR argument.",
                   fr: "La mononucléose à EBV est un imitateur fréquent de l'angine streptococcique chez le jeune adulte (l'adénopathie cervicale postérieure est un indice). Environ 80-100% des patients EBV recevant une aminopénicilline comme l'amoxicilline développent une éruption maculopapuleuse/morbilliforme. Elle est souvent étiquetée à tort comme une vraie allergie à la pénicilline — un label iatrogène durable qui suit le patient à vie et restreint ses options antibiotiques futures. C'est une raison de sécurité d'éviter l'amoxicilline empirique pour un mal de gorge, indépendamment de l'argument RAM.",
                   ja: "EBV単核球症は若年成人で溶連菌の頻度の高い擬態です(後頸部リンパ節腫脹がヒント)。アモキシシリンなどのアミノペニシリンを投与されたEBV患者の約80-100%が斑状丘疹性/麻疹様皮疹を生じます。これはしばしば真のペニシリンアレルギーと誤標識され — 生涯患者につきまとい将来の抗生物質選択を狭める、医原性で永続的なラベルとなります。これはAMRの議論とは独立して、のどの痛みに経験的アモキシシリンを避けるべき安全上の理由です。" } },
  { id: "q5",
    q: { en: "Japan's MHLW AMR National Action Plan 2023-2027 includes which specific target?",
         fr: "Le Plan national antibiorésistance 2023-2027 du MHLW japonais comprend quel objectif spécifique ?",
         ja: "日本のMHLW AMR対策国家行動計画2023-2027には、どの具体的な目標が含まれますか?" },
    options: [
      { text: { en: "Banning all outpatient antibiotics",
                fr: "Interdire tous les antibiotiques en ambulatoire",
                ja: "外来抗生物質の全面禁止" }, correct: false },
      { text: { en: "Cutting prescriptions for respiratory tract infections by 50% by 2027",
                fr: "Réduire de 50% les prescriptions pour les infections respiratoires d'ici 2027",
                ja: "2027年までに呼吸器感染症への処方を50%削減すること" }, correct: true },
      { text: { en: "Doubling antibiotic use to prevent complications",
                fr: "Doubler l'usage d'antibiotiques pour prévenir les complications",
                ja: "合併症予防のため抗生物質使用を倍増させること" }, correct: false },
      { text: { en: "Removing the financial incentive for stewardship",
                fr: "Supprimer l'incitation financière au bon usage",
                ja: "適正使用への経済的インセンティブを廃止すること" }, correct: false }
    ],
    explanation: { en: "The MHLW AMR National Action Plan 2023-2027 sets an overall target of cutting outpatient oral antibiotics by about a third, with a SPECIFIC target of halving (50%) respiratory-tract-infection prescriptions by 2027. It builds on the 2018 抗微生物薬適正使用加算 (Antimicrobial Stewardship Premium) — a small reimbursement for clinicians who decide NOT to prescribe for a viral URI and document the counselling.",
                   fr: "Le Plan national AMR 2023-2027 du MHLW fixe un objectif global de réduction d'environ un tiers des antibiotiques oraux ambulatoires, avec un objectif SPÉCIFIQUE de réduction de moitié (50%) des prescriptions pour infections respiratoires d'ici 2027. Il s'appuie sur le 抗微生物薬適正使用加算 (forfait de bon usage des antimicrobiens) de 2018 — un remboursement modeste pour les cliniciens qui décident de NE PAS prescrire pour une infection virale et documentent le conseil donné.",
                   ja: "MHLW AMR対策国家行動計画2023-2027は、外来経口抗生物質を全体で約3分の1削減する目標を掲げ、具体的に2027年までに呼吸器感染症処方を半減(50%)させる目標を定めています。これは2018年の「抗微生物薬適正使用加算」 — ウイルス性上気道感染症に処方しないと決定し説明を記録した医師への小さな診療報酬 — を基盤としています。" } }
,
  { id: "q6",
    q: { en: "What does the FeverPAIN score measure, and what is it used for?",
         fr: "Que mesure le score FeverPAIN, et à quoi sert-il ?",
         ja: "FeverPAINスコアは何を測り、何に使われますか?" },
    options: [
      { text: { en: "It grades the severity of pneumonia",
                fr: "Il évalue la gravité d'une pneumonie",
                ja: "肺炎の重症度を評価する" }, correct: false },
      { text: { en: "A 5-item sore-throat score (Fever, Purulence, Attend rapidly ≤3 days, severely Inflamed tonsils, No cough/coryza) used to guide antibiotic decisions",
                fr: "Un score de mal de gorge à 5 items (Fièvre, Purulence, consultation rapide ≤3 jours, amygdales très Inflammées, absence de toux/coryza) pour guider la décision antibiotique",
                ja: "のどの痛みの5項目スコア(発熱、膿性、3日以内の早期受診、扁桃の高度炎症、咳・鼻汁がない)で、抗生物質の判断を導く" }, correct: true },
      { text: { en: "It predicts the risk of penicillin allergy",
                fr: "Il prédit le risque d'allergie à la pénicilline",
                ja: "ペニシリンアレルギーのリスクを予測する" }, correct: false },
      { text: { en: "It measures pain after surgery",
                fr: "Il mesure la douleur après une chirurgie",
                ja: "術後の痛みを測定する" }, correct: false }
    ],
    explanation: { en: "FeverPAIN (NICE NG84) is a 5-item sore-throat score: Fever in the past 24h, Purulence, Attend rapidly (within 3 days of onset), severely Inflamed tonsils, No cough or coryza. Like Centor/McIsaac it estimates the likelihood of a streptococcal cause and helps decide whether antibiotics or a rapid antigen test are warranted. A low score (as here) supports a no-antibiotic, symptomatic-care approach.",
                   fr: "FeverPAIN (NICE NG84) est un score de mal de gorge à 5 items : Fièvre dans les dernières 24 h, Purulence, consultation rapide (dans les 3 jours), amygdales très Inflammées, absence de toux ou de coryza. Comme Centor/McIsaac, il estime la probabilité d'une cause streptococcique et aide à décider si un antibiotique ou un test antigénique rapide est justifié. Un score bas (comme ici) appuie une approche sans antibiotique, en soins symptomatiques.",
                   ja: "FeverPAIN(NICE NG84)はのどの痛みの5項目スコアです:過去24時間の発熱、膿性、早期受診(発症3日以内)、扁桃の高度炎症、咳・鼻汁がない。Centor/McIsaacと同様に溶連菌が原因である可能性を推定し、抗生物質や迅速抗原検査が妥当かの判断を助けます。低スコア(本例のように)は、抗生物質なしの対症療法アプローチを支持します。" } }
];

var POSTTEST_RESPIRATORY_STEWARDSHIP = [
  { id: "q1",
    q: { en: "Mme Moreau says 'amoxicillin always works for me — last year I was better in two days.' What is the most accurate interpretation?",
         fr: "Mme Moreau dit « l'amoxicilline marche toujours pour moi — l'an dernier j'allais mieux en deux jours ». Quelle est l'interprétation la plus exacte ?",
         ja: "Mme Moreau は「アモキシシリンはいつも私に効く — 去年は2日で良くなった」と言います。最も正確な解釈はどれですか?" },
    options: [
      { text: { en: "The antibiotic clearly cured her viral illness both times",
                fr: "L'antibiotique a clairement guéri sa maladie virale les deux fois",
                ja: "抗生物質が両度ともウイルス性疾患を明らかに治した" }, correct: false },
      { text: { en: "The viral illness almost certainly resolved on its own in parallel with the antibiotic — 'it worked' is not 'it was needed'",
                fr: "La maladie virale a presque certainement guéri spontanément en parallèle de l'antibiotique — « ça a marché » n'est pas « c'était nécessaire »",
                ja: "ウイルス性疾患はほぼ確実に抗生物質と並行して自然軽快しただけ — 「効いた」は「必要だった」ではない" }, correct: true },
      { text: { en: "She must have a chronic bacterial infection",
                fr: "Elle doit avoir une infection bactérienne chronique",
                ja: "彼女は慢性細菌感染症に違いない" }, correct: false },
      { text: { en: "Amoxicillin shortens all sore throats by two days",
                fr: "L'amoxicilline raccourcit tous les maux de gorge de deux jours",
                ja: "アモキシシリンはすべてののどの痛みを2日短縮する" }, correct: false }
    ],
    explanation: { en: "Viral pharyngitis is self-limiting and typically improving by day 3-5 anyway. 'It worked last year' almost always means the illness ran its natural course alongside the antibiotic, which played no causal role. The post hoc belief is exactly what makes the next consultation harder — naming it gently is part of the stewardship conversation.",
                   fr: "La pharyngite virale est spontanément résolutive et s'améliore généralement dès le 3e-5e jour. « Ça a marché l'an dernier » signifie presque toujours que la maladie a suivi son cours naturel en parallèle de l'antibiotique, qui n'a joué aucun rôle causal. Cette croyance post hoc est précisément ce qui rend la consultation suivante plus difficile — la nommer avec tact fait partie de la conversation sur le bon usage.",
                   ja: "ウイルス性咽頭炎は自然軽快し、通常はいずれにせよ第3-5病日には改善します。「去年は効いた」はほぼ常に、抗生物質と並行して疾患が自然経過をたどっただけで、抗生物質に因果的役割はなかったことを意味します。この後付けの信念こそが次の診察を難しくします — それを穏やかに指摘することは適正使用の会話の一部です。" } },
  { id: "q2",
    q: { en: "Setting antibiotics aside, what is the single most useful thing to offer Mme Moreau for her Friday presentation?",
         fr: "Mise à part la question des antibiotiques, quelle est la chose la plus utile à offrir à Mme Moreau pour sa présentation de vendredi ?",
         ja: "抗生物質を脇に置いて、金曜のプレゼンのために Mme Moreau に提供できる最も役立つことは何ですか?" },
    options: [
      { text: { en: "A sick note telling her to cancel the trip",
                fr: "Un arrêt de travail lui demandant d'annuler le voyage",
                ja: "出張を中止するよう求める診断書" }, correct: false },
      { text: { en: "A symptomatic plan tuned to the flight and stage — scheduled paracetamol + NSAID, voice rest, in-flight hydration, lozenges, and a clear rule if she's worse Friday morning",
                fr: "Un plan symptomatique adapté au vol et à la scène — paracétamol + AINS systématiques, repos vocal, hydratation en vol, pastilles, et une règle claire si elle est pire vendredi matin",
                ja: "フライトと壇上に合わせた対症療法プラン — アセトアミノフェン+NSAIDの定時投与、声の休息、機内の水分摂取、のど飴、金曜朝に悪化した場合の明確なルール" }, correct: true },
      { text: { en: "A short course of oral corticosteroids",
                fr: "Une cure courte de corticoïdes oraux",
                ja: "経口ステロイドの短期コース" }, correct: false },
      { text: { en: "A delayed amoxicillin prescription handed over by reflex",
                fr: "Une prescription différée d'amoxicilline donnée par réflexe",
                ja: "反射的に渡される遅延アモキシシリン処方" }, correct: false }
    ],
    explanation: { en: "Scheduled (not as-needed) analgesia controls throat pain through the meeting; an NSAID before the stage manages inflammation and voice; in-flight hydration protects the mucosa; lozenges give sustained relief; and a clear Friday-morning safety-net rule lets her act. This addresses the trip far better than an antibiotic she'd only be on day 3 of by Friday. Steroids offer only a small effect with non-zero risk and mirror the very pattern the case teaches you to resist.",
                   fr: "Une antalgie systématique (et non à la demande) contrôle la douleur pendant la réunion ; un AINS avant la scène gère l'inflammation et la voix ; l'hydratation en vol protège la muqueuse ; les pastilles soulagent durablement ; et une règle de sécurité claire pour vendredi matin lui permet d'agir. Cela répond au voyage bien mieux qu'un antibiotique dont elle ne serait qu'au 3e jour vendredi. Les corticoïdes n'offrent qu'un effet modeste avec un risque non nul et reproduisent le schéma que le cas vous apprend à éviter.",
                   ja: "定時(頓用ではない)の鎮痛は会議中の咽頭痛をコントロールし、登壇前のNSAIDは炎症と声を管理し、機内の水分摂取は粘膜を守り、のど飴は持続的な緩和を与え、金曜朝の明確なセーフティネットのルールが彼女に行動を可能にします。金曜にやっと服用3日目になる抗生物質よりはるかに出張に応えます。ステロイドは小さな効果しかなくゼロでないリスクを伴い、この症例が抵抗を教えるまさにそのパターンを再現します。" } },
  { id: "q3",
    q: { en: "What is the key difference in the financial signal around antibiotic prescribing between France and Japan in 2026?",
         fr: "Quelle est la différence clé dans le signal financier autour de la prescription d'antibiotiques entre la France et le Japon en 2026 ?",
         ja: "2026年において、抗生物質処方をめぐる経済的シグナルのフランスと日本の主な違いは何ですか?" },
    options: [
      { text: { en: "France pays doctors more to prescribe antibiotics",
                fr: "La France paie davantage les médecins pour prescrire des antibiotiques",
                ja: "フランスは抗生物質を処方する医師により多く支払う" }, correct: false },
      { text: { en: "Japan offers a stewardship premium for NOT prescribing for a viral URI (with documented counselling); France's consultation fee is broadly the same either way",
                fr: "Le Japon offre un forfait de bon usage pour NE PAS prescrire en cas d'infection virale (avec conseil documenté) ; en France le tarif de consultation est globalement identique quoi qu'il arrive",
                ja: "日本はウイルス性上気道感染症に処方しないこと(説明の記録を条件)に適正使用加算を支払う;フランスの診察料はどちらでも概ね同じ" }, correct: true },
      { text: { en: "Neither country has any policy on antibiotic prescribing",
                fr: "Aucun des deux pays n'a de politique sur la prescription d'antibiotiques",
                ja: "どちらの国も抗生物質処方に関する政策を持たない" }, correct: false },
      { text: { en: "Both countries fine patients who request antibiotics",
                fr: "Les deux pays sanctionnent les patients qui demandent des antibiotiques",
                ja: "両国とも抗生物質を求める患者に罰金を科す" }, correct: false }
    ],
    explanation: { en: "Since 2018 a Japanese primary-care clinician who decides NOT to prescribe an antibiotic for an acute viral URI (patient ≥ 6 months) and documents the counselling can claim the 抗微生物薬適正使用加算 — a small but symbolic financial incentive to do the harder thing. In France the consultation fee is broadly the same whether you prescribe or not (though ROSP public-health bonuses add a modest, indirect prescribing-rate incentive — a useful nuance for the facilitator).",
                   fr: "Depuis 2018, un médecin de soins primaires japonais qui décide de NE PAS prescrire d'antibiotique pour une infection virale aiguë (patient ≥ 6 mois) et qui documente le conseil peut facturer le 抗微生物薬適正使用加算 — une incitation financière modeste mais symbolique à faire le choix difficile. En France, le tarif de consultation est globalement le même que l'on prescrive ou non (bien que les primes ROSP de santé publique ajoutent une incitation indirecte modeste sur les taux de prescription — nuance utile pour le facilitateur).",
                   ja: "2018年以降、急性ウイルス性上気道感染症(患者は生後6か月以上)に抗生物質を処方しないと決定し説明を記録した日本のプライマリ・ケア医は「抗微生物薬適正使用加算」を算定できます — より難しい選択をすることへの小さくも象徴的な経済的インセンティブです。フランスでは処方の有無にかかわらず診察料は概ね同じです(ただしROSPの公衆衛生ボーナスが処方率に対する控えめで間接的なインセンティブを加えており、これはファシリテーターにとって有用なニュアンスです)。" } },
  { id: "q4",
    q: { en: "Which statement about antimicrobial resistance (AMR) and the individual consultation is most accurate?",
         fr: "Quelle affirmation sur la résistance antimicrobienne (RAM) et la consultation individuelle est la plus exacte ?",
         ja: "薬剤耐性(AMR)と個々の診察に関する記述で最も正確なのはどれですか?" },
    options: [
      { text: { en: "One unnecessary course harms this patient severely, so AMR is mainly an individual risk",
                fr: "Une seule cure inutile nuit gravement à ce patient, donc la RAM est surtout un risque individuel",
                ja: "1コースの不要処方がこの患者に重大な害を与えるため、AMRは主に個人のリスクである" }, correct: false },
      { text: { en: "AMR is largely a population-level harm — each unnecessary course adds a small increment, but millions of them over time erode the antibiotics future patients will need",
                fr: "La RAM est largement un dommage de niveau populationnel — chaque cure inutile ajoute un petit incrément, mais des millions au fil du temps érodent les antibiotiques dont les futurs patients auront besoin",
                ja: "AMRは主に集団レベルの害である — 各不要処方は小さな増分を加えるが、時間とともに何百万件もが将来の患者に必要な抗生物質を蝕む" }, correct: true },
      { text: { en: "AMR is a slogan with no real clinical relevance",
                fr: "La RAM est un slogan sans réelle pertinence clinique",
                ja: "AMRは臨床的に意味のないスローガンにすぎない" }, correct: false },
      { text: { en: "Resistance only develops in hospitals, not in the community",
                fr: "La résistance ne se développe qu'à l'hôpital, pas en ville",
                ja: "耐性は病院でのみ生じ、地域では生じない" }, correct: false }
    ],
    explanation: { en: "AMR is a classic collective-action problem: the marginal harm of any single unnecessary course to the individual patient is small, but the aggregate over millions of consultations drives community resistance and threatens the antibiotics future patients will need. The lived clinical tension is precisely between 'this patient, this Friday' and 'the next generation's working antibiotics' — and stewardship is the discipline of holding both.",
                   fr: "La RAM est un problème classique d'action collective : le dommage marginal d'une seule cure inutile pour le patient est faible, mais l'agrégat sur des millions de consultations alimente la résistance communautaire et menace les antibiotiques dont les futurs patients auront besoin. La tension clinique vécue est précisément entre « ce patient, ce vendredi » et « les antibiotiques qui fonctionneront pour la génération suivante » — et le bon usage est la discipline de tenir les deux.",
                   ja: "AMRは典型的な集合行為問題です:一件の不要処方が個々の患者に与える限界的な害は小さいものの、何百万件もの診察にわたる総和が地域の耐性を生み、将来の患者に必要な抗生物質を脅かします。体感される臨床的葛藤はまさに「この患者、この金曜日」と「次世代に効く抗生物質」の間にあり — 適正使用とはその両方を保持する規律です。" } },
  { id: "q5",
    q: { en: "Reflecting on the cross-cultural discussion, which is the best summary of the France/Japan stewardship comparison?",
         fr: "En réfléchissant à la discussion interculturelle, quel est le meilleur résumé de la comparaison France/Japon sur le bon usage ?",
         ja: "異文化間の議論を振り返り、フランス/日本の適正使用比較の最良の要約はどれですか?" },
    options: [
      { text: { en: "France and Japan have nothing to learn from each other on antibiotics",
                fr: "La France et le Japon n'ont rien à apprendre l'un de l'autre sur les antibiotiques",
                ja: "フランスと日本は抗生物質について互いに学ぶことがない" }, correct: false },
      { text: { en: "Both pursue stewardship, but via different levers — France through education/ROSP, Japan through education plus a pay-for-not-prescribing fee — and patient expectations differ accordingly",
                fr: "Les deux poursuivent le bon usage, mais par des leviers différents — la France via l'éducation/ROSP, le Japon via l'éducation plus un forfait pour non-prescription — et les attentes des patients diffèrent en conséquence",
                ja: "両国とも適正使用を追求するが、手段が異なる — フランスは教育/ROSP、日本は教育に加え非処方への加算 — そして患者の期待もそれに応じて異なる" }, correct: true },
      { text: { en: "Japan simply copies French prescribing culture",
                fr: "Le Japon copie simplement la culture de prescription française",
                ja: "日本は単にフランスの処方文化を模倣している" }, correct: false },
      { text: { en: "Cultural differences make evidence-based stewardship impossible to apply across borders",
                fr: "Les différences culturelles rendent le bon usage fondé sur les preuves impossible à appliquer au-delà des frontières",
                ja: "文化的差異により、エビデンスに基づく適正使用は国境を越えて適用できない" }, correct: false }
    ],
    explanation: { en: "Both health systems converge on the same evidence (HAS 2021, NICE NG84, CDC, MHLW AMR plan) but reach it through different policy levers and against different baseline patient expectations — France with persistently high per-capita use and education/ROSP incentives, Japan with an explicit pay-for-not-prescribing premium. Evidence-based stewardship CAN cross borders; how it is delivered must be culturally fluent.",
                   fr: "Les deux systèmes convergent vers les mêmes données (HAS 2021, NICE NG84, CDC, plan AMR du MHLW) mais y parviennent par des leviers différents et face à des attentes initiales différentes — la France avec un usage par habitant durablement élevé et des incitations éducation/ROSP, le Japon avec un forfait explicite pour non-prescription. Le bon usage fondé sur les preuves PEUT franchir les frontières ; sa mise en œuvre doit être culturellement fluide.",
                   ja: "両医療制度は同じエビデンス(HAS 2021、NICE NG84、CDC、MHLW AMR計画)に収束しますが、異なる政策手段を通じ、異なる初期の患者期待のもとでそこに至ります — フランスは一人当たり使用が依然高く教育/ROSPのインセンティブ、日本は明示的な非処方への加算。エビデンスに基づく適正使用は国境を越えられますが、その伝え方は文化的に流暢でなければなりません。" } }
,
  { id: "q6",
    q: { en: "Mme Moreau is on the combined oral contraceptive pill and worries amoxicillin will reduce its efficacy. What does current guidance (FSRH/BNF/CDC) say?",
         fr: "Mme Moreau prend une pilule œstroprogestative et craint que l'amoxicilline ne réduise son efficacité. Que disent les recommandations actuelles (FSRH/BNF/CDC) ?",
         ja: "Mme Moreau は混合経口避妊薬を服用しており、アモキシシリンがその効果を下げると心配しています。現行のガイダンス(FSRH/BNF/CDC)は何と述べていますか?" },
    options: [
      { text: { en: "She must use additional contraception for a month",
                fr: "Elle doit utiliser une contraception supplémentaire pendant un mois",
                ja: "1か月間は追加の避妊が必要" }, correct: false },
      { text: { en: "Non-enzyme-inducing antibiotics including amoxicillin do NOT reduce combined-pill efficacy; no additional contraception is needed",
                fr: "Les antibiotiques non inducteurs enzymatiques, dont l'amoxicilline, ne réduisent PAS l'efficacité de la pilule combinée ; aucune contraception supplémentaire n'est nécessaire",
                ja: "アモキシシリンを含む酵素誘導性のない抗生物質は混合ピルの効果を下げない;追加の避妊は不要" }, correct: true },
      { text: { en: "She should stop the pill entirely while unwell",
                fr: "Elle devrait arrêter complètement la pilule pendant sa maladie",
                ja: "体調不良の間はピルを完全に中止すべき" }, correct: false },
      { text: { en: "Amoxicillin makes the pill dangerous and both must be stopped",
                fr: "L'amoxicilline rend la pilule dangereuse et les deux doivent être arrêtés",
                ja: "アモキシシリンはピルを危険にするため両方を中止すべき" }, correct: false }
    ],
    explanation: { en: "The advice to use extra contraception with broad-spectrum antibiotics has been formally withdrawn for years: non-enzyme-inducing antibiotics such as amoxicillin do NOT reduce the efficacy of the combined oral contraceptive pill (FSRH 2011 and current guidance; BNF; CDC). Only enzyme-inducing drugs (e.g. rifampicin, certain anticonvulsants) do. The myth persists in patient lore — a useful side-conversation that builds trust while you decline the antibiotic for the unrelated viral pharyngitis.",
                   fr: "Le conseil d'utiliser une contraception supplémentaire avec les antibiotiques à large spectre a été formellement retiré depuis des années : les antibiotiques non inducteurs enzymatiques comme l'amoxicilline ne réduisent PAS l'efficacité de la pilule combinée (FSRH 2011 et recommandations actuelles ; BNF ; CDC). Seuls les inducteurs enzymatiques (rifampicine, certains anticonvulsivants) le font. Le mythe persiste dans la croyance populaire — une conversation parallèle utile qui renforce la confiance pendant que vous refusez l'antibiotique pour la pharyngite virale sans rapport.",
                   ja: "広域抗生物質と併用する追加避妊の助言は何年も前に正式に撤回されています:アモキシシリンなど酵素誘導性のない抗生物質は混合経口避妊薬の効果を下げません(FSRH 2011および現行ガイダンス、BNF、CDC)。下げるのは酵素誘導薬(リファンピシン、一部の抗けいれん薬など)のみです。この俗説は患者の間に根強く残っています — 無関係なウイルス性咽頭炎に抗生物質を断りつつ信頼を築く、有用な脇道の会話です。" } }
];

window.CANAMED_SCENARIOS = {
  "chronic-pain-opioids": {
    id: "chronic-pain-opioids",
    name: { en: "Chronic Pain & the Opioid Request",
            fr: "Douleur chronique et demande d'opioïde",
            ja: "慢性疼痛とオピオイドの要望" },
    summary: { en: "A 45-year-old office worker presents with 8 months of low-back " +
                   "pain and asks for oxycodone by name. Module A is the clinical " +
                   "workup; Module B is the cross-cultural breaking-bad-news roleplay.",
               fr: "Un employé de bureau de 45 ans consulte pour 8 mois de lombalgie " +
                   "et demande nommément de l'oxycodone. Le module A est la démarche " +
                   "clinique ; le module B est un jeu de rôle interculturel sur l'annonce " +
                   "d'une mauvaise nouvelle.",
               ja: "45歳の事務職男性が8か月続く腰痛で受診し、オキシコドンを名指しで" +
                   "求めます。モジュールAは臨床的なワークアップ、モジュールBは異文化間の" +
                   "悪い知らせの伝達ロールプレイです。" },
    moduleAName: { en: "Module A — Chronic Pain & the clinical case",
                   fr: "Module A — Douleur chronique et cas clinique",
                   ja: "モジュールA — 慢性疼痛と臨床症例" },
    moduleBName: { en: "Module B — Breaking Bad News (cross-cultural roleplay)",
                   fr: "Module B — Annoncer une mauvaise nouvelle (jeu de rôle interculturel)",
                   ja: "モジュールB — 悪い知らせを伝える (異文化間ロールプレイ)" },
    synthId: "labs:0",
    synthPrereqs: ["history:1", "history:2", "exam:3"],
    case: CASE,
    scoring: SCORING,
    penalties: PENALTIES,
    decisions: DECISIONS,
    preTest: PRETEST_CHRONIC_PAIN,
    postTest: POSTTEST_CHRONIC_PAIN
  },
  "breaking-bad-news-disclosure": {
    id: "breaking-bad-news-disclosure",
    name: { en: "Breaking Bad News & Cross-Cultural Disclosure",
            fr: "Annoncer une mauvaise nouvelle et divulgation interculturelle",
            ja: "悪い知らせの告知と異文化間の情報開示" },
    summary: { en: "A 75-year-old Japanese woman, Mrs Tanaka, presents with painless " +
                   "obstructive jaundice and is found to have Stage IV pancreatic " +
                   "adenocarcinoma. Her adult son, recently bereaved by his father's " +
                   "death, asks the team in private not to tell his mother. Module A " +
                   "is the focused workup leading to the diagnosis; Module B is the " +
                   "cross-cultural disclosure conversation — France's Loi-Kouchner " +
                   "default of direct patient disclosure meeting Japan's evolving " +
                   "family-mediated tradition.",
               fr: "Madame Tanaka, 75 ans, japonaise, consulte pour un ictère obstructif " +
                   "indolore : le bilan révèle un adénocarcinome pancréatique de Stade IV. " +
                   "Son fils adulte, récemment endeuillé par le décès de son père, demande " +
                   "discrètement à l'équipe de ne pas annoncer le diagnostic à sa mère. Le " +
                   "module A est la démarche clinique ciblée menant au diagnostic ; le " +
                   "module B est la conversation interculturelle d'annonce — l'information " +
                   "directe par défaut de la Loi Kouchner rencontre la tradition japonaise " +
                   "d'annonce médiée par la famille, en pleine évolution.",
               ja: "75歳の日本人女性、田中さんが無痛性閉塞性黄疸で受診し、精査により " +
                   "Stage IV 膵腺がんが判明します。父親を最近亡くしたばかりの成人した息子" +
                   "が、母親には伝えないでほしいとチームにそっと頼んできます。モジュール" +
                   "Aは診断に至る焦点を絞った精査、モジュールBは異文化間の告知の会話 — " +
                   "フランスの Loi Kouchner による患者本人への直接告知の原則と、変化しつつ" +
                   "ある日本の家族介在型の伝統とが交差する場です。" },
    moduleAName: { en: "Module A — Painless jaundice workup",
                   fr: "Module A — Démarche clinique de l'ictère indolore",
                   ja: "モジュールA — 無痛性黄疸の臨床的精査" },
    moduleBName: { en: "Module B — Breaking Bad News across cultures",
                   fr: "Module B — Annoncer une mauvaise nouvelle entre cultures",
                   ja: "モジュールB — 文化を越えて悪い知らせを伝える" },
    synthId: "labs:0",
    synthPrereqs: ["history:1", "history:2", "exam:1"],
    case: CASE_B,
    scoring: SCORING_B,
    penalties: PENALTIES_B,
    decisions: DECISIONS_B,
    preTest: PRETEST_BREAKING_BAD_NEWS,
    postTest: POSTTEST_BREAKING_BAD_NEWS
  },
  "respiratory-stewardship": {
    id: "respiratory-stewardship",
    name: { en: "Antibiotic Stewardship & the Sore-Throat Request",
            fr: "Bon usage des antibiotiques et demande pour mal de gorge",
            ja: "抗菌薬適正使用とのどの痛みへの処方要望" },
    summary: { en: "A 32-year-old French primary-care patient, Mme Moreau, " +
                   "presents with 5 days of pharyngitis (cough, coryza, low fever, " +
                   "no exudate, Centor/McIsaac 0) and asks the doctor for amoxicillin " +
                   "so she can give a client presentation in Frankfurt on Friday. " +
                   "Module A is the focused clinical workup landing on \"no antibiotic, " +
                   "here is why, here is what to do instead\"; Module B is the " +
                   "patient-pressure conversation, set against France's persistently " +
                   "high outpatient antibiotic use and Japan's MHLW AMR National Action " +
                   "Plan 2023-2027 (50% cut in respiratory-infection prescriptions) " +
                   "plus the 2018 抗微生物薬適正使用加算 (Antimicrobial Stewardship " +
                   "Premium) for primary care.",
               fr: "Mme Moreau, 32 ans, suivie en soins primaires en France, consulte " +
                   "pour 5 jours de pharyngite (toux, rhinorrhée, fébricule, pas " +
                   "d'exsudat, Centor/McIsaac à 0) et demande au médecin de l'amoxicilline " +
                   "pour pouvoir donner une présentation client à Francfort vendredi. " +
                   "Le module A est la démarche clinique ciblée qui aboutit à « pas " +
                   "d'antibiotique, voici pourquoi, voici quoi faire à la place » ; " +
                   "le module B est la conversation sous pression du patient, sur fond " +
                   "de consommation française d'antibiotiques en ville restée parmi les " +
                   "plus élevées de l'OCDE, et du Plan national AMR 2023-2027 du MHLW " +
                   "japonais (réduction de 50% des prescriptions pour infections " +
                   "respiratoires) couplé au 抗微生物薬適正使用加算 (forfait de bon usage) " +
                   "créé en 2018 pour les soins primaires.",
               ja: "フランスのプライマリ・ケアの32歳の患者 Mme Moreau が、5日続く咽頭炎" +
                   "(咳、鼻水、軽度の発熱、滲出液なし、Centor/McIsaacスコア0)で受診し、" +
                   "金曜日にフランクフルトでクライアント向けプレゼンを行うためにアモキシ" +
                   "シリンを希望します。モジュールAは「抗生物質は出さない、その理由は" +
                   "こうである、代わりにこうする」に至る焦点を絞った臨床ワークアップ、" +
                   "モジュールBは患者からのプレッシャー下での対話 — フランスの外来抗生" +
                   "物質使用がOECDで依然最高水準であること、および日本のMHLW AMR国家行動" +
                   "計画2023-2027(呼吸器感染症処方の50%削減)とそれを支える2018年新設の" +
                   "プライマリ・ケア向け「抗微生物薬適正使用加算」を背景に行います。" },
    moduleAName: { en: "Module A — Sore-throat workup & the stewardship decision",
                   fr: "Module A — Démarche clinique du mal de gorge et décision de bon usage",
                   ja: "モジュールA — のどの痛みの臨床ワークアップと適正使用の判断" },
    moduleBName: { en: "Module B — The antibiotic-request conversation across cultures",
                   fr: "Module B — La conversation sur la demande d'antibiotique entre cultures",
                   ja: "モジュールB — 文化を越えた抗生物質処方要望への対話" },
    synthId: "labs:0",
    synthPrereqs: ["history:1", "history:6", "exam:4"],
    case: CASE_C,
    scoring: SCORING_C,
    penalties: PENALTIES_C,
    decisions: DECISIONS_C,
    preTest: PRETEST_RESPIRATORY_STEWARDSHIP,
    postTest: POSTTEST_RESPIRATORY_STEWARDSHIP
  }
};

/* ===================== FACILITATOR POCKET CARDS ============================
 * Round-2 clinical-educator follow-up (sim-output/round2-clinical-ebm.md,
 * severity item #6 — "no facilitator pocket cards"). One { en, fr, ja } card
 * per scenario id, so the Caen / Nagoya academic running the room has a
 * ~200-word teaching script without having to derive it from the inline JS
 * comments. Keyed by the SAME scenario ids used in CANAMED_SCENARIOS, so the
 * UI can look the card up by the active session's scenarioId.
 *
 * Each card covers: learning objectives, the deliberately-wrong traps, the key
 * teaching moments, and suggested timing. Exposed at the bottom of the file the
 * same way the other globals are (window.X = X). */
var FACILITATOR_NOTES = {
  "chronic-pain-opioids": {
    en: "FACILITATOR CARD — Chronic Pain & the Opioid Request (Mr Lefebvre, 45y, 8-month LBP).\n" +
        "LEARNING OBJECTIVES: (1) recognise chronic non-specific (mechanical) low-back pain and the absence of red flags; (2) explore — not simply grant or refuse — a named drug request (oxycodone); (3) build a guideline-concordant non-opioid active plan and address yellow flags (fear of movement, low mood, sleep); (4) compare France/Japan opioid-prescribing and imaging cultures.\n" +
        "DELIBERATE TRAPS (these LOSE points): promising oxycodone before assessment (history); 'is it just stress?' which destroys the alliance (history); a rectal exam with no cauda-equina indication; a scattergun cardio-resp exam; and ordering MRI / X-ray / CT / bloods with no red flag.\n" +
        "KEY TEACHING MOMENTS: 'hurt is not harm'; imaging without indication finds incidental age-related change and increases worry; the correct opioid stance is 'explore the request, assess first'; staying active is the single biggest determinant of long-term outcome.\n" +
        "TIMING (≈90 min): pre-test 5 · Module A workup + synthesis gate 30 · plan & opioid votes 15 · Module B roleplay 25 · debrief + post-test 15.",
    fr: "FICHE FACILITATEUR — Douleur chronique et demande d'opioïde (M. Lefebvre, 45 ans, lombalgie de 8 mois).\n" +
        "OBJECTIFS PÉDAGOGIQUES : (1) reconnaître une lombalgie chronique non spécifique (mécanique) et l'absence de drapeaux rouges ; (2) explorer — et non simplement accorder ou refuser — une demande nominative (oxycodone) ; (3) construire un plan actif sans opioïde conforme aux recommandations et traiter les drapeaux jaunes (peur du mouvement, humeur basse, sommeil) ; (4) comparer les cultures France/Japon de prescription d'opioïdes et d'imagerie.\n" +
        "PIÈGES DÉLIBÉRÉS (qui FONT PERDRE des points) : promettre l'oxycodone avant l'évaluation ; « ce n'est pas juste du stress ? » qui détruit l'alliance ; un toucher rectal sans indication de queue de cheval ; un examen cardio-respiratoire au hasard ; et prescrire IRM / radio / scanner / bilan sans drapeau rouge.\n" +
        "MOMENTS CLÉS : « avoir mal n'est pas être abîmé » ; l'imagerie sans indication révèle des modifications fortuites liées à l'âge et augmente l'inquiétude ; la bonne posture face aux opioïdes est « explorer la demande, évaluer d'abord » ; rester actif est le principal déterminant du devenir à long terme.\n" +
        "MINUTAGE (≈90 min) : pré-test 5 · démarche Module A + synthèse 30 · votes plan & opioïde 15 · jeu de rôle Module B 25 · débriefing + post-test 15.",
    ja: "ファシリテーターカード — 慢性疼痛とオピオイドの要望(M. Lefebvre、45歳、8か月の腰痛)。\n" +
        "学習目標:(1) 慢性非特異的(機械的)腰痛とレッドフラッグの不在を認識する;(2) 名指しの薬剤要望(オキシコドン)を、単に応じる/断るのではなく掘り下げる;(3) ガイドラインに沿った非オピオイドの能動的計画を立て、イエローフラッグ(運動恐怖、抑うつ、睡眠)に対応する;(4) フランス/日本のオピオイド処方と画像検査の文化を比較する。\n" +
        "意図的なトラップ(減点される):評価前にオキシコドンを約束する;治療同盟を壊す「ただのストレスでは?」;馬尾の適応がない直腸指診;焦点のない心血管・呼吸器の診察;レッドフラッグなしのMRI/X線/CT/血液検査の指示。\n" +
        "重要な教育ポイント:「痛み≠損傷」;適応のない画像検査は加齢性の偶発所見を見つけ不安を増す;正しいオピオイドの姿勢は「要望を掘り下げ、まず評価する」;活動性の維持が長期予後の最大の決定因子。\n" +
        "タイムライン(約90分):事前テスト5・モジュールA ワークアップ+総合判断ゲート30・計画&オピオイド投票15・モジュールB ロールプレイ25・デブリーフ+事後テスト15。"
  },
  "breaking-bad-news-disclosure": {
    en: "FACILITATOR CARD — Breaking Bad News & Cross-Cultural Disclosure (Mrs Tanaka, 75y, Stage IV pancreatic Ca).\n" +
        "LEARNING OBJECTIVES: (1) confirm decision-making capacity (Understand/Retain/Weigh/Communicate) and grasp why it makes disclosure HER decision; (2) refuse the false 'tell vs withhold' binary — acknowledge the family's fear, then ask the patient; (3) apply SPIKES, including to prognosis (Invitation); (4) compare the France/Japan legal-and-cultural defaults (Loi Kouchner vs MHLW 人生会議 / ACP).\n" +
        "DELIBERATE TRAPS (penalties): promising the son you will withhold (before asking the patient); answering the son with a rule and no empathy; ordering a PET-CT to delay the conversation; an unfocused neuro exam. The dec_first_words and dec_prognosis votes also have wrong options (too fast / paternalistic deflection).\n" +
        "KEY TEACHING MOMENTS: capacity removes any 'best-interests' bypass; the apparent family-vs-patient conflict largely dissolves once you ask the right person in the right order; prognosis is delivered at the resolution the patient asks for; ERCP biliary stenting is symptom relief, offered independent of the chemo decision.\n" +
        "TIMING (≈90 min): pre-test 5 · Module A jaundice workup 20 · disclosure planning + capacity 10 · Module B roleplay (family, first words, prognosis, stent) 35 · debrief + post-test 15.",
    fr: "FICHE FACILITATEUR — Annoncer une mauvaise nouvelle et divulgation interculturelle (Mme Tanaka, 75 ans, cancer du pancréas de Stade IV).\n" +
        "OBJECTIFS PÉDAGOGIQUES : (1) confirmer la capacité décisionnelle (Comprendre/Retenir/Pondérer/Communiquer) et saisir pourquoi l'annonce lui revient ; (2) refuser le faux dilemme « dire vs cacher » — reconnaître la peur de la famille, puis interroger la patiente ; (3) appliquer SPIKES, y compris au pronostic (Invitation) ; (4) comparer les règles légales et culturelles France/Japon (Loi Kouchner vs MHLW 人生会議 / ACP).\n" +
        "PIÈGES DÉLIBÉRÉS (pénalités) : promettre au fils de cacher (avant d'interroger la patiente) ; répondre au fils par une règle sans empathie ; prescrire une TEP-TDM pour différer ; un examen neuro non ciblé. Les votes dec_first_words et dec_prognosis ont aussi des options fausses (trop rapide / esquive paternaliste).\n" +
        "MOMENTS CLÉS : la capacité retire tout contournement au nom de l'« intérêt » ; le conflit apparent famille-vs-patiente se dissout largement dès qu'on interroge la bonne personne dans le bon ordre ; le pronostic se donne à la résolution demandée par la patiente ; le drainage biliaire par CPRE est un soulagement symptomatique, proposé indépendamment de la chimiothérapie.\n" +
        "MINUTAGE (≈90 min) : pré-test 5 · démarche de l'ictère Module A 20 · planification de l'annonce + capacité 10 · jeu de rôle Module B (famille, premiers mots, pronostic, stent) 35 · débriefing + post-test 15.",
    ja: "ファシリテーターカード — 悪い知らせの告知と異文化間の情報開示(田中さん、75歳、Stage IV 膵がん)。\n" +
        "学習目標:(1) 意思決定能力(理解/保持/比較考量/伝達)を確認し、それが告知を本人の決定とする理由を理解する;(2) 「伝える対伏せる」の誤った二者択一を退ける — 家族の恐れを受け止め、その上で患者に尋ねる;(3) SPIKESを、予後告知(Invitation)も含めて適用する;(4) フランス/日本の法的・文化的デフォルト(Loi Kouchner 対 MHLW 人生会議/ACP)を比較する。\n" +
        "意図的なトラップ(減点):患者に尋ねる前に息子へ伏せると約束する;息子に共感なく規則だけで答える;会話を遅らせるためのPET-CT;焦点のない神経診察。dec_first_words と dec_prognosis の投票にも誤答(急ぎすぎ/パターナリスティックなはぐらかし)がある。\n" +
        "重要な教育ポイント:能力があれば「最善の利益」による素通りは成立しない;見かけの家族対患者の対立は、正しい順序で正しい人に尋ねれば大半が解消する;予後は患者が求める粒度で伝える;ERCP胆道ステントは症状緩和であり、化学療法の決定とは独立に提案する。\n" +
        "タイムライン(約90分):事前テスト5・モジュールA 黄疸ワークアップ20・告知計画+能力10・モジュールB ロールプレイ(家族・最初の言葉・予後・ステント)35・デブリーフ+事後テスト15。"
  },
  "respiratory-stewardship": {
    en: "FACILITATOR CARD — Antibiotic Stewardship & the Sore-Throat Request (Mme Moreau, 32y, Centor/McIsaac 0).\n" +
        "LEARNING OBJECTIVES: (1) score Centor/McIsaac and recognise viral pharyngitis; (2) decline antibiotics WITHOUT minimising the patient — explain, plan, safety-net; (3) address her real Friday-deadline need without a drug she does not need; (4) use delayed prescribing as a shared decision, not a reflex; (5) compare France/Japan stewardship levers (ROSP vs the 抗微生物薬適正使用加算 pay-for-not-prescribing premium; MHLW AMR plan 2023-2027).\n" +
        "DELIBERATE TRAPS (penalties): promising amoxicillin before the workup; 'it's just a cold' with no exam/plan/safety-net; a scattergun neuro+abdo exam; unnecessary FBC/CRP/LFTs; and the empirical 5-day amoxicillin course.\n" +
        "KEY TEACHING MOMENTS: 'it worked' ≠ 'it was needed' (post hoc belief); the EBV-mononucleosis + amoxicillin maculopapular rash trap and the durable false 'penicillin allergy' label it creates; a real symptomatic plan (scheduled paracetamol + NSAID, voice rest, in-flight hydration) beats an antibiotic she'd only be on day 3 of by Friday; AMR is a population-level harm.\n" +
        "TIMING (≈90 min): pre-test 5 · Module A throat workup + Centor scoring 25 · prescribe / delayed / trip votes 20 · Module B patient-pressure roleplay 25 · debrief + post-test 15.",
    fr: "FICHE FACILITATEUR — Bon usage des antibiotiques et demande pour mal de gorge (Mme Moreau, 32 ans, Centor/McIsaac 0).\n" +
        "OBJECTIFS PÉDAGOGIQUES : (1) calculer le Centor/McIsaac et reconnaître une pharyngite virale ; (2) refuser les antibiotiques SANS minimiser la patiente — expliquer, planifier, sécuriser ; (3) répondre à son vrai besoin (échéance de vendredi) sans un médicament inutile ; (4) utiliser la prescription différée comme décision partagée, non comme réflexe ; (5) comparer les leviers France/Japon (ROSP vs le forfait 抗微生物薬適正使用加算 « payé pour ne pas prescrire » ; plan AMR du MHLW 2023-2027).\n" +
        "PIÈGES DÉLIBÉRÉS (pénalités) : promettre l'amoxicilline avant le bilan ; « ce n'est qu'un rhume » sans examen/plan/filet ; un examen neuro+abdo au hasard ; NFS/CRP/bilan hépatique inutiles ; et la cure empirique d'amoxicilline de 5 jours.\n" +
        "MOMENTS CLÉS : « ça a marché » ≠ « c'était nécessaire » (croyance post hoc) ; le piège mononucléose à EBV + éruption maculopapuleuse à l'amoxicilline et l'étiquette durable et fausse d'« allergie à la pénicilline » qu'il crée ; un vrai plan symptomatique (paracétamol + AINS systématiques, repos vocal, hydratation en vol) vaut mieux qu'un antibiotique dont elle ne serait qu'au 3e jour vendredi ; la RAM est un dommage populationnel.\n" +
        "MINUTAGE (≈90 min) : pré-test 5 · démarche pharyngée Module A + score Centor 25 · votes prescription / différée / voyage 20 · jeu de rôle Module B sous pression 25 · débriefing + post-test 15.",
    ja: "ファシリテーターカード — 抗菌薬適正使用とのどの痛みへの要望(Mme Moreau、32歳、Centor/McIsaac 0)。\n" +
        "学習目標:(1) Centor/McIsaacを算出しウイルス性咽頭炎を認識する;(2) 患者を軽視せずに抗生物質を断る — 説明し、計画し、セーフティネットを示す;(3) 不要な薬に頼らず、彼女の本当のニーズ(金曜の締切)に応える;(4) 遅延処方を反射ではなく共有意思決定として用いる;(5) フランス/日本の適正使用の手段(ROSP 対「抗微生物薬適正使用加算」の非処方への報酬;MHLW AMR計画2023-2027)を比較する。\n" +
        "意図的なトラップ(減点):ワークアップ前にアモキシシリンを約束する;診察/計画/セーフティネットなしの「ただの風邪」;焦点のない神経+腹部の診察;不要な全血球計算/CRP/肝機能;経験的アモキシシリン5日コース。\n" +
        "重要な教育ポイント:「効いた」≠「必要だった」(後付けの信念);EBV単核球症+アモキシシリンの斑状丘疹性皮疹のトラップと、それが生む永続的な偽の「ペニシリンアレルギー」ラベル;実効性のある対症療法プラン(アセトアミノフェン+NSAIDの定時投与、声の休息、機内の水分摂取)は、金曜にやっと3日目になる抗生物質に勝る;AMRは集団レベルの害である。\n" +
        "タイムライン(約90分):事前テスト5・モジュールA 咽頭ワークアップ+Centorスコア25・処方/遅延/出張の投票20・モジュールB 患者プレッシャーのロールプレイ25・デブリーフ+事後テスト15。"
  }
};

/* the default scenario is whichever sits first in the registry - this is what
   case-content.js leaves in the globals when script.js starts up. Once a
   session is unlocked, script.js calls applyScenario() with the session's
   chosen scenarioId (or its custom content) and swaps these globals out. */
window.FACILITATOR_NOTES = FACILITATOR_NOTES;
window.CANAMED_DEFAULT_SCENARIO_ID = "chronic-pain-opioids";
