/* mayumi-seed.js — "A Difficult Child (Mayumi)", six PBL sections.
 *
 * The Nagoya University child-psychiatry PBL No. 57 (Prof. Koie's tutorial,
 * "Online PBL: adolescent depression"), ported with Dr Branko's step
 * encoding: a 15-year-old girl brought by her parents for six months of
 * careless, defiant and negative behaviour, increasing absence and falling
 * school performance, who turns out to have adolescent-onset major depression.
 *
 * WHY SIX SECTIONS. The tutorial reveals the case piece by piece — the tutor
 * hands out the next sheet only after the group has worked the previous one.
 * The section model gives exactly that: one PBL section per reveal, advanced
 * by the facilitator, each with its OWN cast, facts, workup, prompts and vote.
 * Facts are CUMULATIVE: section n carries everything sections 0..n-1 revealed,
 * routed to whoever knows it (`who`), so the LLM characters never leak a later
 * reveal and never forget an earlier one.
 *
 *   1  Initial information       parents only            (pre-reading)
 *   2  Chief complaint & HEADSS  parents only            (the differential does
 *                                                          NOT narrow — the point)
 *   3  Home visit                Mayumi, father, mother
 *   4  Examination & MFQ         Mayumi, parents          exam + questionnaire
 *   5  Investigation results     Mayumi, parents          labs, MRI, EEG
 *   6  Management & outcome      Mayumi, parents          SSRI + CBT; the mother
 *
 * WHAT IS NOT PORTED, deliberately. Dr Branko's standalone app scored each
 * step 0–100 with a language model. The original tutorial grades the GROUP
 * qualitatively on the quality of its discussion, so that score is his
 * addition, not the source's; here the rubric lines became deterministic
 * keyword scoring families (some `askOf` a parent, so a family history taken
 * from the mother earns what the same words at Mayumi do not), and the
 * transcript reaches the facilitator for debrief. His "narrator" character is
 * the Examination and Investigations tabs. The MFQ is text (item by item,
 * from the filled form), not the scanned image.
 *
 * SOURCES. The tutor handout (EN, with the Nagoya CAP psychiatrists' comments)
 * and the five student handouts are the primary source; `electron/data/case.js`
 * from the standalone app is the secondary one. Where they differ the handout
 * wins: the SSRI started was escitalopram (the app said fluoxetine).
 *
 * Content is ENGLISH-ONLY by design (the in-product reader supplies FR/JA);
 * every string is `{ en }` so tc() resolves it. Dual-purpose module like
 * branched-seed.js: under Node it exports the six scenarios; in the browser
 * it merges them into window.CANAMED_SCENARIOS after case-content.js.
 *
 * ⚠ CLINICAL CONTENT FOR REVIEW by Dr Branko / the Nagoya tutors — see
 * ARCHITECTURE/mayumi-pbl-content.md for the reveal-by-reveal mapping and the
 * review checklist. Nothing here is graded assessment; scoring is formative.
 */
(function (root) {
  "use strict";

  const en = (s) => ({ en: s });

  /* ── Cast ─────────────────────────────────────────────────────────────── */

  const NEVER_AI =
    "You are a real person in this conversation — NOT an AI, NOT a chatbot, " +
    "NOT an assistant. Never break character.\n\n";

  const MAYUMI_PERSONA =
    "You are Mayumi, a 15-year-old girl, being interviewed by a doctor. " + NEVER_AI +
    "WHO YOU ARE: guarded, irritable and at first hostile or dismissive toward " +
    "adults, especially clinicians, because you feel nobody understands you and " +
    "you expect to be judged or lectured. Underneath the defiance you feel " +
    "hopeless, exhausted, and as though you can never live up to your parents' " +
    "expectations. You have trouble sleeping and sometimes drink alcohol at " +
    "night to fall asleep. You get frequent headaches.\n\n" +
    "HOW YOU BEHAVE: you don't want to talk about your friends or what you do at " +
    "night unless the doctor asks in a way that feels safe, non-judgmental and " +
    "genuinely curious rather than accusatory. You warm up slowly if the doctor " +
    "is patient, explains their role, and doesn't lecture you. Speak in short, " +
    "sometimes sullen or sarcastic teenage sentences. Don't volunteer everything " +
    "at once — make the doctor work for it, the way a real guarded adolescent " +
    "would — but don't stay obstructive forever if they ask a clear, kind, " +
    "direct question. If the doctor is rude or preachy, shut down.";

  const MAYUMI_PERSONA_RECOVERED =
    "You are Mayumi, now 15 going on 16, seeing the doctor who has been treating " +
    "you for some months. " + NEVER_AI +
    "WHO YOU ARE NOW: your depression has lifted with the medication and the " +
    "weekly sessions. You are lively and energetic again, back at schoolwork and " +
    "starting to do well, and you are making plans for what to study next. You " +
    "still argue with your parents, but it has turned into standing up for " +
    "yourself rather than blowing up at them. You can talk about how bad it was " +
    "before with some distance now — you remember the nights out, the drinking " +
    "to sleep, feeling that nothing was worth it — and you are a little proud of " +
    "how far you have come. Speak like a teenager who is doing better: shorter " +
    "sentences, some humour, honest about the past if asked kindly.";

  const FATHER_PERSONA =
    "You are Mayumi's father, speaking to the doctor about your 15-year-old " +
    "daughter. " + NEVER_AI +
    "WHO YOU ARE: worried and somewhat at a loss about what has happened to your " +
    "daughter. You believe your marriage and home life are basically good and " +
    "stable, and you may understate family stress — you do not spontaneously " +
    "mention your wife's low moods unless the doctor asks about her health " +
    "specifically and kindly. You are cooperative and want to help, but you can " +
    "come across as a bit rigid or frustrated with Mayumi's behaviour ('she used " +
    "to be such a good girl'). You are not hiding anything deliberately; you " +
    "simply see things from a parent's worried, slightly defensive point of view.\n\n" +
    "HOW YOU SPEAK: concerned, practical and matter-of-fact, a little defensive " +
    "about the family. You do not know things that happened when you were not " +
    "there, and you say so.";

  const MOTHER_PERSONA =
    "You are Mayumi's mother, speaking to the doctor about your 15-year-old " +
    "daughter. " + NEVER_AI +
    "WHO YOU ARE: like your husband you think the marriage and the home are " +
    "basically good. You love Mayumi and are frightened by how much she has " +
    "changed. If the doctor asks directly and sensitively about YOUR OWN health " +
    "and mood, you can say that from time to time — especially in spring and " +
    "autumn — you have felt tired and down, and that you have had abdominal pain " +
    "and an irritable bowel; you do not think of this as 'depression' unless the " +
    "doctor frames it that way. You know your own mother (Mayumi's grandmother) " +
    "was periodically depressed.\n\n" +
    "HOW YOU SPEAK: warm but anxious, a little guarded about your own health until " +
    "asked kindly and directly. You do not know things that happened when you " +
    "were not there, and you say so.";

  const MOTHER_PERSONA_LATER =
    MOTHER_PERSONA +
    "\n\nWHAT HAS CHANGED: the doctor has since diagnosed depression in you too, " +
    "and antidepressant treatment has helped you a great deal. Only if the " +
    "doctor asks about your own history, and gently, you can now admit that you " +
    "have suffered periodic depressions since you were young, and that you were " +
    "very depressed when Mayumi was a small child — something you have never " +
    "told anyone before. Say it with some shame and some relief.";

  const MAYUMI_EXAMPLE =
    "Example (do not repeat verbatim, just match the tone):\n" +
    "Doctor: I can see you're not feeling great. I'm not here to tell you off — I'd like to understand what's going on.\n" +
    "Mayumi: Whatever. They sent you, didn't they.\n" +
    "Doctor: They're worried. But I'd rather hear it from you. How's school?\n" +
    "Mayumi: It's pointless. I want to quit. It's no use anyway.";

  const FATHER_EXAMPLE =
    "Example (do not repeat verbatim, just match the tone):\n" +
    "Doctor: Thank you for coming. What made you decide to see me?\n" +
    "Father: The school called us. Her marks have collapsed and she's hardly there. And at home — she's a different girl. Careless, short-tempered. She used to be such a good student.";

  const MOTHER_EXAMPLE =
    "Example (do not repeat verbatim, just match the tone):\n" +
    "Doctor: How has this been for you?\n" +
    "Mother: Frightening, honestly. She disappears for two or three nights and we don't know where she is. She was such a quiet, careful girl. I don't recognise her.";

  /* present: "onCue" = declared but NOT offered in the chat (the switchboard
     skips it), so the index patient can be absent from a step while the
     scenario still declares exactly one `role:"patient"`. */
  function cast(opts) {
    const o = opts || {};
    return [
      { id: "patient", role: "patient", module: ["A"],
        present: o.mayumi ? "start" : "onCue",
        name: en("Mayumi"), blurb: en("15-year-old patient"),
        persona: o.mayumiPersona || MAYUMI_PERSONA, example: MAYUMI_EXAMPLE },
      { id: "father", role: "relative", module: ["A"], present: "start",
        name: en("Mayumi's father"), blurb: en("worried, practical, a little defensive"),
        persona: FATHER_PERSONA, example: FATHER_EXAMPLE },
      { id: "mother", role: "relative", module: ["A"], present: "start",
        name: en("Mayumi's mother"), blurb: en("warm but anxious; her own moods are a clue"),
        persona: o.motherPersona || MOTHER_PERSONA, example: MOTHER_EXAMPLE }
    ];
  }

  /* ── Facts, cumulative, routed by `who` ───────────────────────────────── */

  const G_PRES = en("Presenting problem");
  const G_HIST = en("History of the change");
  const G_RISK = en("Risk behaviours");
  const G_FAM  = en("Family");
  const G_MOOD = en("Mood and thoughts");
  const G_SOMA = en("Sleep, headaches, body");
  const G_TX   = en("Treatment and course");

  const BOTH = ["father", "mother"];

  const FACTS_1 = [
    { group: G_PRES, who: BOTH,
      q: en("What made you come to see me?"),
      a: en("The principal at Mayumi's school contacted us. Her behaviour has changed over the last six months — she is absent more and more, and her school performance has been going downhill.") },
    { group: G_PRES, who: BOTH,
      q: en("How is Mayumi at home these days?"),
      a: en("She's careless and hot-tempered. At home she has completely changed — she used to be such a good student.") },
    { group: G_HIST, who: BOTH,
      q: en("When did things start to change?"),
      a: en("She became more turbulent after her first period, when she was 13. But it's the last six months that have been really bad.") },
    { group: G_HIST, who: "mother",
      q: en("What was she like before all this?"),
      a: en("Quiet, unsure of herself, often a bit of a perfectionist. And trustworthy — you could rely on her word.") },
    { group: G_HIST, who: BOTH,
      q: en("Has her honesty changed?"),
      a: en("She used to be trustworthy. Now she lies whenever she likes — especially when we ask about her friends.") },
    { group: G_RISK, who: BOTH,
      q: en("Who does she spend her time with?"),
      a: en("She's part of a youth gang now. There's a lot of alcohol in that crowd — they drink freely.") },
    { group: G_RISK, who: BOTH,
      q: en("Has she ever stayed away from home?"),
      a: en("Several times. She leaves without a word and stays away two or three nights in a row. We don't know where she is.") },
    { group: G_PRES, who: BOTH,
      q: en("Why isn't Mayumi with you today?"),
      a: en("She refused to come with us. That's why we're late — we tried.") }
  ];

  const FACTS_3 = FACTS_1.concat([
    /* the home visit — Mayumi */
    { group: G_MOOD, who: "patient",
      q: en("How is school going?"),
      a: en("I don't enjoy it. I want to quit. It's no use anyway.") },
    { group: G_SOMA, who: "patient",
      q: en("Do you get headaches or other pains?"),
      a: en("Headaches. A lot.") },
    { group: G_SOMA, who: "patient",
      q: en("How are you sleeping?"),
      a: en("I can't sleep. At night I have to get out of the house. Drinking helps me get some sleep, at least.") },
    { group: G_RISK, who: "patient",
      q: en("Why do you go out at night?"),
      a: en("Because I can't sleep, and because it's nice to get away from all the reproaches at home for a while.") },
    { group: G_MOOD, who: "patient",
      q: en("How are things between you and your parents?"),
      a: en("I'll never be able to please them. Whatever I do, it's wrong.") },
    { group: G_MOOD, who: "patient",
      q: en("Is there anyone you can talk to?"),
      a: en("Nobody understands me. Not at home, not at school. I bet you aren't worth the trouble either.") },
    /* the home visit — parents */
    { group: G_FAM, who: BOTH,
      q: en("How are things between the two of you — at home, in the marriage?"),
      a: en("Good, really. The marriage is stable. Domestic life is fine.") },
    { group: G_FAM, who: BOTH,
      q: en("Does Mayumi have brothers or sisters?"),
      a: en("She's the younger of two. Her brother is 18 — he's healthy, no problems that we know of.") },
    { group: G_FAM, who: "mother",
      q: en("And how is your own health and mood?"),
      a: en("From time to time — especially in spring and autumn — I've been tired and down. I get abdominal pain too, and an irritable bowel.") },
    { group: G_FAM, who: "mother",
      q: en("Is there any history of depression or mental illness in the family?"),
      a: en("My own mother — Mayumi's grandmother — was periodically depressed, yes.") },
    { group: G_FAM, who: "father",
      q: en("Is there any history of depression or mental illness in the family?"),
      a: en("My wife's mother — Mayumi's grandmother — was periodically depressed, yes.") }
  ]);

  /* Section 4 adds what Mayumi told the questionnaire — item by item, so a
     direct follow-up question ("have you thought life isn't worth living?")
     is answered from the form she filled in, not invented. */
  const FACTS_4 = FACTS_3.concat([
    { group: G_MOOD, who: "patient",
      q: en("Have you been feeling miserable or unhappy?"),
      a: en("Yeah. Most of the time. I don't enjoy anything at all any more.") },
    { group: G_MOOD, who: "patient",
      q: en("How do you feel about yourself?"),
      a: en("I feel no good any more. I'm a bad person. I blame myself for things that aren't even my fault. Sometimes I hate myself.") },
    { group: G_MOOD, who: "patient",
      q: en("How do you see the future?"),
      a: en("There's nothing good for me in the future. I feel like nobody really loves me. I'll never be as good as the other kids.") },
    { group: G_MOOD, who: "patient",
      q: en("Have you had thoughts that life isn't worth living?"),
      a: en("Sometimes. Sometimes I think life isn't worth living.") },
    { group: G_MOOD, who: "patient",
      q: en("Have you thought about death, or about killing yourself?"),
      a: en("No. I haven't thought about dying, and I haven't thought about killing myself. I don't think my family would be better off without me either.") },
    { group: G_MOOD, who: "patient",
      q: en("Do you still see your friends?"),
      a: en("I don't want to see anyone. I feel lonely, but I don't want to see them.") },
    { group: G_SOMA, who: "patient",
      q: en("Can you concentrate? How is your appetite and energy?"),
      a: en("It's hard to think properly or concentrate. I'm not eating more or less than usual, I'm just tired sometimes and restless sometimes.") },
    { group: G_MOOD, who: "patient",
      q: en("How do you get on with your parents at the moment?"),
      a: en("I'm grumpy and cross with them. All the time.") }
  ]);

  const FACTS_5 = FACTS_4.concat([
    { group: G_SOMA, who: "patient",
      q: en("How did the examination and the tests go for you?"),
      a: en("The examination was fine, they said. Blood tests, a brain scan, the thing with the wires on my head. I just want to know if there's something wrong with me.") }
  ]);

  const FACTS_6 = FACTS_5.concat([
    { group: G_TX, who: BOTH,
      q: en("What treatment was started?"),
      a: en("After the doctor consulted the child and adolescent psychiatry outpatient unit, Mayumi started an antidepressant — an SSRI, escitalopram — and has had weekly sessions with the doctor using a cognitive behaviour therapy approach.") },
    { group: G_TX, who: BOTH,
      q: en("How is Mayumi now?"),
      a: en("Much better. After some time she was lively and energetic again. She gradually took up schoolwork, started to experience success, and is making plans for further education.") },
    { group: G_TX, who: BOTH,
      q: en("How are things at home now?"),
      a: en("She struggled with us for a long time, but little by little the aggression has turned into standing up for herself — constructive self-assertion, the doctor calls it.") },
    { group: G_TX, who: "patient",
      q: en("What has the treatment been like for you?"),
      a: en("The tablets — escitalopram — and the weekly sessions where we work on how I think about things. It took a while, but I feel like myself again.") },
    { group: G_TX, who: "patient",
      q: en("How are you doing now?"),
      a: en("Good, actually. I'm back at schoolwork and it's going well; I'm thinking about what to study next. I still argue with my parents, but now I'm standing up for myself instead of exploding.") },
    { group: G_TX, who: "mother",
      q: en("And how have you been yourself?"),
      a: en("The doctor diagnosed depression in me too. The antidepressant has worked well — I feel like myself again.") },
    { group: G_TX, who: "mother",
      q: en("Have you had periods like this before?"),
      a: en("I've had periodic depressions since I was young. I was very depressed when Mayumi was a small child. I never told anyone.") }
  ]);

  /* ── Examination (section 4) ──────────────────────────────────────────── */

  const EXAM_4 = [
    { group: en("General"), indicated: true,
      q: en("General appearance, growth and vital signs"),
      a: en("A thin but normally grown 15-year-old, guarded but cooperative. Height and weight on their previous centiles. Pulse, blood pressure and temperature normal.") },
    { group: en("Systems"), indicated: true,
      q: en("Cardiovascular and respiratory examination"),
      a: en("Normal heart sounds, no murmur. Chest clear.") },
    { group: en("Systems"), indicated: true,
      q: en("Abdominal examination"),
      a: en("Soft, non-tender, no organomegaly.") },
    { group: en("Systems"), indicated: true,
      q: en("Neurological examination"),
      a: en("Cranial nerves, tone, power, reflexes and coordination all normal. No focal signs.") },
    { group: en("Systems"), indicated: true,
      q: en("Skin — including a look for injuries"),
      a: en("No bruises, cuts or scars. No signs of self-harm or of physical injury.") },
    { group: en("Systems"), indicated: true,
      q: en("Thyroid and lymph nodes"),
      a: en("No goitre. No lymphadenopathy.") }
  ];

  /* Observation items for the steps with no physical examination. Assessment
     of an informant or of the patient at the door IS examination; each line is
     the handout's own description where one exists (sections 3 and 6) and
     neutral framing where it does not (1, 2, 5) — flagged as such in the
     review checklist. */
  const OBS_PARENTS = [
    { group: en("Observation"), indicated: true,
      q: en("Observe the parents in the consultation"),
      a: en("Two worried parents, late and apologetic — Mayumi refused to come. The father is matter-of-fact and a little defensive about the family; the mother is anxious and near tears.") }
  ];
  const OBS_HOME_VISIT = [
    { group: en("Observation"), indicated: true,
      q: en("Observe Mayumi at the home visit"),
      a: en("In her room with the stereo at maximum volume. When her father switches it off she becomes very aggressive and yells that they never leave her alone. Leather jacket, dirty jeans; she and her room are untidy. At first only an unfriendly look, turning away as you approach — then, once you have sat down and explained why you are there, willing to talk.") }
  ];
  const OBS_RESULTS = [
    { group: en("Observation"), indicated: true,
      q: en("Observe how Mayumi takes the results"),
      a: en("She listens without interrupting, then asks whether normal results mean there is nothing wrong with her.") }
  ];
  const OBS_OUTCOME = [
    { group: en("Observation"), indicated: true,
      q: en("Observe Mayumi on review"),
      a: en("A lively and energetic girl. She talks about schoolwork and her plans for further education, and argues her corner with her parents rather than exploding at them.") }
  ];

  /* One investigation TRAP per section (labs[1]), each the wrong move the
     tutor questions warn against, with its penalty. Traps are the porter's
     addition in the platform's idiom, not the handout's — reviewers may drop
     or reword them. */
  function trap(q, a) { return { q: en(q), a: en(a), indicated: false }; }
  function trapPenalty(id, title, why) {
    return { id: id, item: "labs:1", points: 8, bestReasons: ["premature", "not_indicated"], okReasons: ["low_value"],
             title: en(title), why: en(why) };
  }
  const TRAP_1 = trap("Blood tests on the parents' account, before seeing Mayumi",
    "Ordered. Mayumi is not here and has not been examined; the results, when they come, will describe a girl nobody has assessed.");
  const TRAP_2 = trap("A urine drug screen arranged through the parents, without Mayumi knowing",
    "Arranged. If she finds out — and she will — the first thing she learns about you is that you test people behind their backs.");
  const TRAP_3 = trap("A breathalyser test during the home visit",
    "She refuses, and the conversation you had just started is over.");
  const TRAP_4 = trap("Whole-body CT and a full autoimmune panel",
    "Ordered. Two incidental findings of no significance, three weeks' delay, and a frightened family.");
  const TRAP_5 = trap("Repeat the whole panel and the MRI",
    "Repeated. Every value is as before. Another month has passed without treatment.");
  const TRAP_6 = trap("Escitalopram plasma level at week one",
    "Sent. Not clinically useful at this stage; what matters in week one is contact, not a level.");

  /* ── The MFQ (section 4) — Mayumi's actual responses ──────────────────── */

  const MFQ_TEXT =
    "Mood and Feelings Questionnaire, long version (33 items; not true = 0, sometimes = 1, true = 2; maximum 66). " +
    "TRUE (2): 1 felt miserable or unhappy · 2 didn't enjoy anything at all · 8 felt no good any more · " +
    "9 blamed myself for things that weren't my fault · 11 felt grumpy and cross with my parents · " +
    "15 thought there was nothing good for me in the future · 20 didn't want to see my friends · " +
    "24 felt I was a bad person · 27 felt lonely · 28 thought nobody really loved me · 29 didn't feel good in school · " +
    "30 thought I could never be as good as other kids. " +
    "SOMETIMES (1): 5 so tired I just sat around · 7 very restless · 12 felt like talking less · " +
    "16 thought life wasn't worth living · 21 hard to think properly or concentrate · 23 hated myself · " +
    "25 thought I looked ugly · 32 didn't sleep as well as usual · 33 slept a lot more than usual. " +
    "NOT TRUE (0): 3 less hungry · 4 ate more · 6 moving more slowly · 10 hard to make up my mind · " +
    "13 talking more slowly · 14 cried a lot · 17 thought about death or dying · 18 family better off without me · " +
    "19 thought about killing myself · 22 bad things would happen to me · 26 worried about aches and pains · 31 did everything wrong. " +
    "TOTAL 33 / 66. The long-version cut-point commonly cited is 27 or more.";

  /* ── Investigation results (section 5) ────────────────────────────────── */

  const LABS_5_RESULTS = [
    { q: en("Full blood count"),
      a: en("Hb 13.5 g/dL (11.7–15.3). WBC 6 ×10⁹/L (4.1–9.8). MCV 90 fL (81–95). MCH 28 pg (25–35). Platelets 200 ×10⁹/L (164–370). All normal.") },
    { q: en("CRP"),
      a: en("CRP 5 mg/L (reference < 5). At the upper limit — no meaningful inflammation.") },
    { q: en("Monospot test"),
      a: en("Negative.") },
    { q: en("Glucose"),
      a: en("8.0 mmol/L (reference < 11.1, non-fasting). Normal.") },
    { q: en("Thyroid function (TSH, free T4)"),
      a: en("TSH 2.4 mIU/L (0.56–5.44 for age 11–15). Free T4 15.2 pmol/L (11.6–19.1). Normal.") },
    { q: en("Ferritin, vitamin B12, folate, vitamin D"),
      a: en("Ferritin 56 µg/L (10–167). Vitamin B12 360 pmol/L (150–600). Folate 22 nmol/L (9–36). Vitamin D 62 nmol/L (37–108). All normal.") },
    { q: en("Cerebral MRI"),
      a: en("Normal.") },
    { q: en("Standard EEG"),
      a: en("Normal for age.") }
  ];

  /* ── Synthesis items (labs[0], key) — the model write-up per section ──── */

  function synth(title, text) {
    return { q: en(title + "  (unlocks the discussion prompts)"), key: true, a: en(text) };
  }

  /* ── Decisions (one or two votes per section) ─────────────────────────── */

  function vote(id, prompt, options) {
    return {
      id: id, module: "A", points: 20, penalty: 10,
      prompt: en(prompt),
      options: options.map((o) => ({ text: en(o[0]), correct: !!o[1], why: en(o[2]) }))
    };
  }

  /* ── Scoring helpers ──────────────────────────────────────────────────── */

  function fam(id, points, label, stems, askOf) {
    const f = { id: id, points: points, label: en(label), any: stems };
    if (askOf) f.askOf = askOf;
    return f;
  }
  function concept(id, points, label, stems) {
    return { id: id, points: points, label: en(label), any: stems };
  }

  /* ── The six scenarios ────────────────────────────────────────────────── */

  const COMMON = {
    modules: ["A"],
    synthId: "labs:0",
    synthPrereqs: []
  };

  const S1 = Object.assign({}, COMMON, {
    id: "mayumi-1",
    name: en("A difficult child — 1. Initial information"),
    moduleAName: en("A difficult child — 1. Initial information"),
    summary: en(
      "Mayumi's parents have made an appointment for their 15-year-old daughter, who refused to come. " +
      "The school says six months of absence and falling grades; at home she is careless and hot-tempered. " +
      "Take the history from the parents, keep the differential wide, and plan how you will reach Mayumi herself."),
    characters: cast({ mayumi: false }),
    penalties: [trapPenalty("pen1_tests_unseen", "Tested a description, not a patient",
      "Mayumi has not been seen, examined or asked. Investigations ordered on the parents' account cannot be interpreted and delay the one step that matters — meeting her.")],
    case: {
      history: FACTS_1, exam: OBS_PARENTS, labs: [
        synth("Where are we after the parents' account?",
          "You have a six-month change in a 15-year-old: falling attendance and performance, carelessness and a hot temper at home, " +
          "a new peer group that drinks, nights away from home without notice, and lying about her friends — against a baseline of a " +
          "quiet, unsure, somewhat perfectionistic and trustworthy girl. The turbulence dates from menarche at 13. You have heard NONE " +
          "of this from Mayumi. The differential must stay wide: depression (irritable rather than sad, as adolescents often present), " +
          "a substance use problem, conduct or oppositional-defiant disorder, ordinary adolescent individuation, abuse or trauma, " +
          "and a medical cause. The risk markers — alcohol, nights away, the gang — are safety questions to ask without judgment, " +
          "not verdicts. The next step is to meet Mayumi, and to explain confidentiality before you ask her anything that matters."),
        TRAP_1
      ],
      prompts: [
        en("What are the most important points in this presentation? List them, and for each say whether it points toward depression, toward substance use, toward a conduct problem, toward 'normal' adolescence, or toward something else entirely."),
        en("What more do you want to know — from the parents, from the school, and from Mayumi herself? Sort your questions into the HEADSS domains (Home, Education, Activities, Drugs and alcohol, Sex, Suicidal thoughts). Which of them can ONLY be answered by Mayumi?"),
        en("The parents are informants, not the patient. What might they not know, or be minimising? How will you keep their trust while insisting on seeing Mayumi alone?")
      ]
    },
    scoring: {
      moduleA: [
        concept("s1_broad_ddx", 8, "Kept the differential broad (depression, substance use, conduct, adolescence, abuse, medical)",
          ["depress", "substance", "alcohol", "conduct", "oppositional", "adolescen", "abuse", "trauma", "medical", "organic", "differential"]),
        concept("s1_meet_alone", 8, "Plans to meet Mayumi herself, alone, with confidentiality explained",
          ["alone", "confidential", "meet her", "see her", "herself", "one-to-one", "one to one", "privately"]),
        concept("s1_headss", 6, "Names a structured adolescent interview (HEADSS)",
          ["headss", "heads", "home, education", "structured interview"]),
        concept("s1_safety_markers", 6, "Recognised the safety markers (alcohol, nights away, gang)",
          ["alcohol", "drink", "nights away", "stays away", "runs away", "gang", "safety", "risk"])
      ],
      moduleA_questions: [
        fam("q1_onset", 5, "Asked about onset, timing and what set it off", ["when did", "how long", "start", "began", "onset", "six months", "6 months", "trigger", "happen"]),
        fam("q1_school", 4, "Asked what the school actually reported", ["school", "principal", "teacher", "grades", "marks", "absen", "attend"]),
        fam("q1_baseline", 6, "Asked what Mayumi was like before the change", ["before", "used to", "previously", "what was she like", "personality", "as a child", "younger"]),
        fam("q1_alcohol", 6, "Asked about alcohol and the peer group without judgment", ["alcohol", "drink", "drug", "friends", "gang", "crowd", "peers", "who does she"]),
        fam("q1_absences", 5, "Asked about the nights away from home", ["stay away", "stayed away", "nights", "run away", "ran away", "leave home", "left home", "where she goes", "where does she go"]),
        fam("q1_parents_feelings", 5, "Asked the parents how THEY are coping", ["how are you", "how is this for you", "coping", "for you both", "your feelings", "worried", "frightened", "as parents"]),
        fam("q1_why_absent", 3, "Asked why Mayumi is not here today", ["why isn't mayumi", "where is mayumi", "not here", "come with you", "refused"])
      ],
      moduleA_question_penalties: [
        { id: "p1_diagnose_early", points: 4, label: en("Named a diagnosis to the parents before meeting Mayumi"),
          any: ["she has depression", "she is depressed", "it's depression", "conduct disorder", "she's an alcoholic", "it is depression", "diagnosis is"] }
      ]
    },
    decisions: [
      vote("dec_s1_next", "Before anything else, your team should…", [
        ["Insist on meeting Mayumi herself, alone, and explain confidentiality first", true,
          "Everything so far is second-hand. An adolescent is interviewed alone, with the limits of confidentiality explained, and the HEADSS domains — especially drugs, alcohol and suicidal thoughts — can only be covered with her."],
        ["Start an antidepressant on the parents' description", false,
          "No diagnosis has been made, no risk assessment done, and the patient has not been seen. Treating a description is not treating a person."],
        ["Reassure the parents that this is normal adolescent rebellion", false,
          "Nights away, a drinking peer group and a collapse in school performance over six months are not 'normal'. Reassurance now would close the case before it is opened."],
        ["Refer to the school and social services for a conduct problem", false,
          "Perhaps later, and safeguarding may become relevant — but referral before assessment labels her, and the differential is still wide open."]
      ])
    ]
  });

  const S2 = Object.assign({}, COMMON, {
    id: "mayumi-2",
    name: en("A difficult child — 2. Chief complaint and the interview plan"),
    moduleAName: en("A difficult child — 2. Chief complaint and the interview plan"),
    summary: en(
      "Mayumi, 15, presented to the child psychiatry department by her parents: careless, defiant and negative, " +
      "increasingly absent, school performance deteriorating. The formal chief complaint adds no new fact — " +
      "and that is the point: the differential does not narrow. Structure the history of the present illness and plan the adolescent interview."),
    characters: cast({ mayumi: false }),
    penalties: [trapPenalty("pen2_covert_screen", "Screened her for drugs behind her back",
      "A covert test through the parents breaks the confidentiality you are about to promise before you have promised it. Drugs and alcohol are asked about — with the reason explained — in the HEADSS interview.")],
    case: {
      history: FACTS_1, exam: OBS_PARENTS, labs: [
        synth("Does the chief complaint change your differential?",
          "Not much — and this is a major point of this case. 'Careless, defiant and negative, increasing absence and deteriorating " +
          "school performance' is a non-specific presentation shared by adolescent depression, substance use, conduct and " +
          "oppositional disorders, anxiety, a prodromal psychotic state, premenstrual dysphoric disorder, ADHD and autism spectrum " +
          "conditions (which are often comorbid with depression and raise the risk of suicide and substance dependence), abuse, " +
          "and ordinary adolescence. What the chief complaint DOES give you is a structure: history of the present illness — timing, " +
          "onset, precipitating factors; what relieves the agitation; specific psychotic features; potential for harm to self or " +
          "others. And a plan for Mayumi: confidentiality, then HEADSS — Home, Education, Activities, Drugs and alcohol (explain why " +
          "you are asking), Sex (ditto), Suicidal thoughts. Also ask about physical trauma or abuse, recent drug and alcohol use, " +
          "symptoms of infection, the family's own explanation of the illness, and any use of complementary medicine or traditional healers."),
        TRAP_2
      ],
      prompts: [
        en("Write the chief complaint in one sentence and the history of the present illness in four: timing and onset, precipitating factors, what relieves the agitation, and risk (psychotic features; harm to self or others). Where are the gaps you can only fill with Mayumi?"),
        en("Plan the interview with Mayumi. What will you say about confidentiality — and its limits — before you start? Draft one opening question for each HEADSS domain, in words a hostile 15-year-old would tolerate."),
        en("The Nagoya psychiatrists add ASD, ADHD, conduct and oppositional-defiant disorder, a prodromal psychotic state and premenstrual dysphoric disorder to the differential. For each: what single feature in the story so far, or in the interview to come, would raise or lower it?")
      ]
    },
    scoring: {
      moduleA: [
        concept("s2_not_much", 8, "Recognised that the chief complaint does NOT narrow the differential",
          ["not much", "does not narrow", "doesn't narrow", "non-specific", "nonspecific", "still broad", "still wide", "unchanged", "same differential"]),
        concept("s2_hpi", 6, "Structured the HPI (timing, onset, precipitants, relief, risk)",
          ["timing", "onset", "precipitat", "trigger", "relie", "psychotic", "harm to self", "harm to others", "suicid"]),
        concept("s2_confidentiality", 8, "Plans to explain confidentiality and its limits",
          ["confidential", "private", "won't tell", "will not tell", "limits", "unless", "safety"]),
        concept("s2_headss_domains", 6, "Covered the HEADSS domains",
          ["home", "education", "activities", "drugs", "alcohol", "sex", "suicid", "headss"]),
        concept("s2_comorbid_ddx", 6, "Considered ASD/ADHD/CD/ODD, prodromal psychosis, PMDD",
          ["autism", "asd", "adhd", "attention", "conduct disorder", "oppositional", "odd)", "odd,", "(odd", "prodrom", "psychosis", "schizophren", "pmdd", "premenstrual"])
      ],
      moduleA_questions: [
        fam("q2_precipitant", 5, "Asked about precipitating factors", ["anything happen", "what happened", "trigger", "set it off", "changed at home", "loss", "bereave", "moved", "event"]),
        fam("q2_psychotic", 6, "Screened for psychotic features", ["hear voices", "hearing voices", "seeing things", "hallucin", "paranoi", "strange beliefs", "believe things", "psychotic"]),
        fam("q2_harm", 8, "Screened for harm to self or others", ["hurt herself", "harm herself", "self-harm", "self harm", "suicid", "kill herself", "end her life", "hurt anyone", "violent", "harm to others"]),
        fam("q2_abuse", 6, "Asked about physical trauma or abuse", ["abuse", "hit her", "hits her", "hitting", "hit you", "hurt by", "violence", "assault", "trauma", "injur", "bruis"]),
        fam("q2_infection", 3, "Asked about symptoms of infection or physical illness", ["fever", "infection", "illness", "sick", "sore throat", "glandular", "unwell", "been well"]),
        fam("q2_explanatory", 5, "Asked what the family thinks is going on", ["what do you think", "your explanation", "what is causing", "why do you think", "make of it", "explain it"]),
        fam("q2_cam", 4, "Asked about complementary medicine or traditional healers", ["traditional", "healer", "herbal", "alternative", "complementary", "temple", "shrine", "prayer"]),
        fam("q2_others_view", 3, "Asked what other family members think", ["brother", "grandparents", "rest of the family", "others in the family", "relatives"])
      ],
      moduleA_question_penalties: []
    },
    decisions: [
      vote("dec_s2_ddx", "With the formal chief complaint in hand, your differential…", [
        ["…barely changes — it stays wide, and the interview with Mayumi is what will move it", true,
          "This is the teaching point of the step: 'careless, defiant, negative, absent, failing' is shared by depression, substance use, conduct disorders, anxiety, PMDD, a psychotic prodrome, ADHD and ASD. Only Mayumi's own account will separate them."],
        ["…narrows to a conduct disorder — defiance, lying, a gang and alcohol", false,
          "Those are the behaviours, not the diagnosis. Irritability and defiance are a common face of adolescent depression, and conduct disorder frequently co-exists with it."],
        ["…narrows to depression — a good student who fell apart", false,
          "Plausible, and it may well end there, but nothing yet distinguishes it from substance use, a conduct disorder or a prodrome. Committing now is premature closure."],
        ["…narrows to a substance use disorder — the drinking explains everything", false,
          "Alcohol may be self-medication for something else, as it turns out to be. It explains the nights, not the six months."]
      ])
    ]
  });

  const S3 = Object.assign({}, COMMON, {
    id: "mayumi-3",
    name: en("A difficult child — 3. The home visit"),
    moduleAName: en("A difficult child — 3. The home visit"),
    summary: en(
      "The parents ask you to meet Mayumi at home. Her stereo is at full volume; her father switches it off and she explodes. " +
      "After you sit down and explain why you are there, she is willing to talk. Interview Mayumi — and, separately, her parents — " +
      "and decide what the new information does to your differential."),
    characters: cast({ mayumi: true }),
    penalties: [trapPenalty("pen3_breathalyser", "Breathalysed her at the first meeting",
      "The home visit's whole value is that she starts to talk. A test she did not agree to, in her own room, ends that — and tells you nothing you could not ask.")],
    case: {
      history: FACTS_3, exam: OBS_HOME_VISIT, labs: [
        synth("What did the home visit add?",
          "From Mayumi: she does not enjoy school and wants to quit ('it's no use anyway'), frequent headaches, insomnia with alcohol " +
          "as self-medication for sleep, nights out to escape the reproaches at home, a conviction that she can never please her parents " +
          "and that nobody understands her, and a hostile-hopeless line aimed at you ('I bet you aren't worth the trouble either'). " +
          "Read as symptoms rather than as bad behaviour these are anhedonia, hopelessness, worthlessness, irritability, a somatic " +
          "complaint and a sleep disturbance — the shape of adolescent depression. From the parents: a stable marriage, a healthy " +
          "18-year-old brother, a mother with seasonal low mood and irritable bowel, and a maternal grandmother who was periodically " +
          "depressed — a family loading for mood disorder that becomes important later. The differential is still broad, but " +
          "depression has moved up. What is still missing: a direct, kind question about self-harm and suicidal thoughts; a physical " +
          "examination; and screening for organic mimics."),
        TRAP_3
      ],
      prompts: [
        en("Go through what Mayumi said and translate each statement into a clinical term where one fits: which are depressive symptoms, which are risk behaviours, and which are simply an adolescent being an adolescent? Does the differential change?"),
        en("Alcohol at night 'to get some sleep'. How would you explore that with her — non-judgmentally, in words she would accept — and what does self-medication for insomnia tell you?"),
        en("The mother's seasonal tiredness and low mood, her irritable bowel, and a periodically depressed grandmother: what is the family telling you, and what would you ask the mother next? Who in this family may also need help?"),
        en("Run the risk-factor lists (child, family, environment) against this family. Which factors are present, which are absent, and which is the single most modifiable?")
      ]
    },
    scoring: {
      moduleA: [
        concept("s3_symptoms_named", 8, "Named depressive symptoms in Mayumi's words (anhedonia, hopelessness, worthlessness, irritability)",
          ["anhedon", "hopeless", "worthless", "irritab", "low mood", "depress", "no pleasure", "no use"]),
        concept("s3_self_medication", 6, "Read the alcohol as self-medication for insomnia",
          ["self-medicat", "self medicat", "to sleep", "help her sleep", "insomnia", "sleep"]),
        concept("s3_family_history", 8, "Took the family psychiatric history (mother, grandmother)",
          ["mother", "grandmother", "family history", "hereditary", "genetic", "family loading", "runs in"]),
        concept("s3_still_broad", 4, "Kept substance use and psychosocial factors in view",
          ["substance", "alcohol", "abuse", "trauma", "still", "broad", "psychosocial", "environment"]),
        concept("s3_next_safety", 6, "Named the missing safety question (self-harm, suicidal thoughts)",
          ["suicid", "self-harm", "self harm", "hurt herself", "safety", "risk"])
      ],
      moduleA_questions: [
        fam("q3_school", 4, "Asked Mayumi how school is for her", ["school", "class", "lessons", "study", "teachers"], "patient"),
        fam("q3_somatic", 5, "Asked Mayumi about headaches, sleep and other somatic complaints", ["headache", "sleep", "tired", "pain", "eating", "appetite"], "patient"),
        fam("q3_alcohol_why", 8, "Asked Mayumi why she drinks — and did not lecture", ["why do you drink", "what does the drinking", "does drinking help", "drink to", "alcohol help", "when you drink", "how much do you drink"], "patient"),
        fam("q3_nights", 5, "Asked Mayumi about the nights out", ["night", "go out", "leave home", "where do you go", "get away"], "patient"),
        fam("q3_understood", 6, "Asked Mayumi whether anyone understands her / what she wants", ["understand", "talk to", "listen", "what do you want", "what would help", "on your side"], "patient"),
        fam("q3_suicide_direct", 10, "Asked Mayumi directly about self-harm or suicidal thoughts", ["hurt yourself", "hurting yourself", "harm yourself", "harming yourself", "self-harm", "self harm", "suicid", "kill yourself", "killing yourself", "end your life", "ending your life", "not worth living", "better off dead", "thoughts of death"], "patient"),
        fam("q3_marriage", 4, "Asked the parents about the marriage and home life", ["marriage", "between you", "relationship", "home life", "get on", "argue", "separat"], BOTH),
        fam("q3_siblings", 3, "Asked the parents about siblings", ["brother", "sister", "sibling", "other children"], BOTH),
        fam("q3_mother_mood", 8, "Asked the mother about HER OWN mood and health", ["your own", "yourself", "your health", "your mood", "how are you feeling", "have you been", "your energy", "tired", "feeling down", "been down"], "mother"),
        fam("q3_family_psych", 8, "Asked the parents about depression in the family", ["family history", "in the family", "grandmother", "grandparent", "relatives", "depression in", "mental illness in", "anyone else"], BOTH)
      ],
      moduleA_question_penalties: [
        { id: "p3_lecture", points: 4, label: en("Lectured Mayumi about alcohol or school"),
          any: ["you should stop", "you must stop", "you have to stop", "you shouldn't drink", "you should not drink", "you need to go to school", "you have to go to school", "it's illegal", "against the law"], askOf: "patient" },
        { id: "p3_blame", points: 4, label: en("Blamed Mayumi or took the parents' side to her face"),
          any: ["your fault", "your parents are right", "you are being", "you're being difficult", "grow up", "selfish"], askOf: "patient" }
      ]
    },
    decisions: [
      vote("dec_s3_alcohol", "Mayumi tells you she drinks at night because it helps her sleep. Your team's response is to…", [
        ["Explore it — when, how much, what it does for her — without judgment, and treat it as a symptom to understand", true,
          "This is the D of HEADSS done properly: explain why you are asking, stay curious, and hear the self-medication for what it is. It keeps her talking and it tells you about the insomnia underneath."],
        ["Tell her firmly that drinking at 15 is illegal and dangerous and must stop", false,
          "True, and useless. A guarded adolescent who has just started to talk will stop. The behaviour is the signpost, not the destination."],
        ["Tell the parents so they can lock the door at night", false,
          "You would have broken the confidentiality you promised, at the first test, and taught her that talking to you has consequences she did not agree to."],
        ["Move on — the drinking is a teenage phase and not the real issue", false,
          "It IS a route to the real issue: she cannot sleep, and she is medicating that. Ignoring it loses both the safety question and the clue."]
      ])
    ]
  });

  const S4 = Object.assign({}, COMMON, {
    id: "mayumi-4",
    name: en("A difficult child — 4. Examination and the MFQ"),
    moduleAName: en("A difficult child — 4. Examination and the MFQ"),
    summary: en(
      "Mayumi agrees to come to your office a week later. You examine her — normal findings — and she fills in the Mood and Feelings " +
      "Questionnaire. Interpret the MFQ item by item, decide what it does and does not establish, and choose the investigations that exclude organic mimics."),
    characters: cast({ mayumi: true }),
    penalties: [trapPenalty("pen4_untargeted", "Ordered untargeted imaging and panels",
      "A normal examination and a screen-positive MFQ call for a targeted screen of organic mimics. Whole-body imaging finds incidental results, delays care and tells you nothing the focused screen does not.")],
    case: {
      history: FACTS_4, exam: EXAM_4, labs: [
        synth("What do the examination and the MFQ establish?",
          "A normal physical examination helps exclude an organic cause; it does not rule out depression. The MFQ (long version) " +
          "totals 33 of 66 — well above the commonly cited cut-point of 27 — and the item pattern matters more than the number: " +
          "pervasive unhappiness and anhedonia (items 1, 2, 8 all TRUE), hopelessness (15), a negative self-schema (9, 24 TRUE; " +
          "23, 30 SOMETIMES), social withdrawal (20), prominent irritability with her parents (11), mild sleep disturbance (32, 33), " +
          "and — crucially — no active suicidal ideation (17, 18, 19 NOT TRUE) but 'life not worth living' SOMETIMES (16), which " +
          "demands a direct, compassionate follow-up in person. Appetite change and psychomotor slowing are absent: a " +
          "non-melancholic, irritable profile that is classic for adolescent-onset depression and often reads as 'behaviour " +
          "problems'. The MFQ is a screening instrument, not a diagnosis — a score of 33 means 'screen positive'; diagnosis still " +
          "needs the clinical interview. Depression now leads the differential; the investigations to exclude organic mimics are " +
          "a full blood count, CRP, Monospot, glucose, thyroid function, ferritin, B12, folate and vitamin D, with imaging or an EEG " +
          "only if the examination or history point to them.")
        ,
        TRAP_4,
        { q: en("Mood and Feelings Questionnaire (long version)"), a: en(MFQ_TEXT) }
      ],
      prompts: [
        en("Score the MFQ and then set the number aside: which items carry the clinical weight? Group them (core mood, negative cognition, withdrawal, irritability, neurovegetative, suicidality). What does the PATTERN say that the total does not?"),
        en("Item 16 — 'I thought that life wasn't worth living' — is SOMETIMES; items 17–19 are NOT TRUE. What exactly will you say to Mayumi, today, in your office, to follow that up? Write the words."),
        en("Does the MFQ alter your differential? What does 'screen positive' establish, and what would still be needed for a diagnosis of major depressive disorder? Which investigations do you order now, and what does each one exclude?"),
        en("How would you treat this patient if the investigations come back normal — and what would you need to have in place before starting anything?")
      ]
    },
    scoring: {
      moduleA: [
        concept("s4_screen_not_dx", 8, "MFQ = screen positive, not a diagnosis",
          ["screen", "not a diagnosis", "not diagnostic", "screening", "clinical interview", "still need"]),
        concept("s4_threshold", 4, "Placed 33/66 against the ≥27 cut-point",
          ["33", "27", "cut-off", "cut off", "cutpoint", "cut-point", "cut point", "threshold", "above"]),
        concept("s4_pattern", 8, "Read the item pattern (core mood, hopelessness, self-schema, withdrawal, irritability)",
          ["anhedon", "hopeless", "self", "withdraw", "irritab", "pattern", "cluster", "items"]),
        concept("s4_item16", 10, "Flagged item 16 for direct in-person follow-up",
          ["16", "not worth living", "follow up", "follow-up", "ask her directly", "ask directly", "in person"]),
        concept("s4_organic_screen", 8, "Chose investigations to exclude organic mimics (FBC, TSH, CRP, Monospot, glucose, ferritin, B12, folate, vitamin D)",
          ["thyroid", "tsh", "blood count", "fbc", "cbc", "anaemia", "anemia", "crp", "monospot", "glandular", "ebv", "glucose", "ferritin", "b12", "folate", "vitamin d"]),
        concept("s4_exam_meaning", 4, "Normal exam excludes gross organic disease, not depression",
          ["normal exam", "does not rule out", "doesn't rule out", "organic", "physical cause"])
      ],
      moduleA_questions: [
        fam("q4_life_worth", 10, "Followed up 'life not worth living' directly and kindly with Mayumi", ["not worth living", "worth living", "life worth", "better off dead", "wish you were dead", "thoughts of death", "thought about dying", "kill yourself", "killing yourself", "end your life", "ending your life", "suicid", "hurt yourself", "hurting yourself", "harm yourself", "harming yourself"], "patient"),
        fam("q4_selfworth", 5, "Explored how Mayumi sees herself and the future", ["yourself", "bad person", "your fault", "future", "ahead", "no good", "hate yourself"], "patient"),
        fam("q4_friends", 4, "Asked about friends and withdrawal", ["friends", "see people", "lonely", "alone", "withdraw"], "patient"),
        fam("q4_concentration", 4, "Asked about concentration, appetite and energy", ["concentrat", "think properly", "appetite", "eating", "energy", "tired", "restless"], "patient"),
        fam("q4_explain_tests", 4, "Explained to Mayumi what the tests are for", ["blood test", "why we test", "the tests", "rule out", "make sure nothing", "check your", "scan"], "patient")
      ],
      moduleA_question_penalties: []
    },
    decisions: [
      vote("dec_s4_mfq", "The MFQ comes back at 33 of 66. What does that establish?", [
        ["Screen positive for depression — which still needs a clinical interview to become a diagnosis, and item 16 needs following up today", true,
          "The MFQ is a self-report screening tool. 33 is well above the cited cut-point, and the item pattern (core mood, hopelessness, negative self-schema, irritability, no active suicidal ideation but 'sometimes' life not worth living) is the clinically useful part."],
        ["A confirmed diagnosis of major depressive disorder", false,
          "No questionnaire diagnoses depression. It screens; the interview, with duration, impairment and exclusion of other causes, diagnoses."],
        ["Not much — the score is below the threshold for the long version", false,
          "The long-version cut-point commonly cited is 27; 33 is above it. (12 is the SHORT version's cut-point.)"],
        ["That she is not suicidal, so the safety question can wait", false,
          "Items 17–19 are NOT TRUE, which is reassuring — but item 16 ('life wasn't worth living') is SOMETIMES, and that is a direct, in-person question for today, not a box already ticked."]
      ]),
      vote("dec_s4_tests", "Which investigations do you order now?", [
        ["A targeted screen for organic mimics: full blood count, CRP, Monospot, glucose, thyroid function, ferritin, B12, folate, vitamin D", true,
          "Each one excludes a treatable mimic of adolescent depression — anaemia, infection and mononucleosis, diabetes, thyroid disease, deficiencies. Imaging or an EEG only if the examination or history call for them."],
        ["None — the MFQ has answered the question", false,
          "A screen-positive questionnaire does not exclude hypothyroidism or anaemia, and starting treatment on top of an untreated medical cause is a classic error."],
        ["Whole-body imaging and a full autoimmune panel", false,
          "Untargeted. It finds incidental results, delays care and tells you nothing the focused screen does not."],
        ["A toxicology screen only", false,
          "Reasonable to consider given the alcohol, but on its own it ignores every organic mimic the case is teaching you to exclude."]
      ])
    ]
  });

  const S5 = Object.assign({}, COMMON, {
    id: "mayumi-5",
    name: en("A difficult child — 5. Investigation results"),
    moduleAName: en("A difficult child — 5. Investigation results"),
    summary: en(
      "The results are back: a full blood count, CRP, Monospot, glucose, thyroid function, ferritin, B12, folate and vitamin D, " +
      "a cerebral MRI and an EEG. Review each against its reference range, say what the work-up excludes, and rank your differential."),
    characters: cast({ mayumi: true }),
    penalties: [trapPenalty("pen5_repeat", "Extended a work-up that had already answered",
      "A targeted screen, an MRI and an EEG are all normal. Repeating them delays treatment of a diagnosis the evidence already supports.")],
    case: {
      history: FACTS_5, exam: OBS_RESULTS, labs: [
        synth("What does a fully normal work-up mean here?",
          "Every result is within its reference range (CRP sits exactly at the upper limit of normal — no meaningful inflammation), " +
          "the Monospot is negative, the MRI is normal and the EEG is normal for age. The work-up therefore excludes the organic " +
          "differentials you considered: anaemia, infection and mononucleosis, diabetes, thyroid disease, iron, B12, folate and " +
          "vitamin D deficiency, a structural brain lesion and epileptiform activity. Together with the clinical picture and the MFQ, " +
          "major depressive disorder — adolescent-onset, with irritability and behavioural disturbance as prominent features — now " +
          "ranks highest. Keep in view what the Nagoya psychiatrists add: ADHD, ASD, conduct and oppositional-defiant disorder are " +
          "frequently comorbid with depression and raise the risk of suicide and substance dependence; a prodromal psychotic state " +
          "and premenstrual dysphoric disorder also belong on the list. 'Results are normal' is not a plan: the next step is " +
          "management — consulting child and adolescent psychiatry, deciding on treatment, and setting up close follow-up."),
        TRAP_5
      ].concat(LABS_5_RESULTS),
      prompts: [
        en("Go down the list and say, for each result, what it was ordered to exclude and whether it does. Is there any value you would want to repeat or discuss?"),
        en("What diagnosis ranks highest now, and why? Then argue the other side: which alternative or comorbid diagnosis on the Nagoya psychiatrists' list would you still want to actively look for, and how?"),
        en("Do these results change your approach to Mayumi and her family? Draft the conversation in which you tell her the tests are normal — without her hearing 'so there's nothing wrong with you'.")
      ]
    },
    scoring: {
      moduleA: [
        concept("s5_all_normal", 6, "Characterised each result as normal, including the borderline CRP",
          ["normal", "within range", "reference", "crp", "borderline", "upper limit"]),
        concept("s5_excludes", 8, "Stated what the work-up excludes (anaemia, infection, thyroid, deficiencies, diabetes, structural, epileptiform)",
          ["exclude", "rule out", "ruled out", "anaemia", "anemia", "thyroid", "hypothyroid", "mononucleosis", "ebv", "diabetes", "deficien", "lesion", "epilep", "seizure"]),
        concept("s5_mdd_leads", 8, "Concluded that major depressive disorder now ranks highest",
          ["major depress", "mdd", "depression", "ranks highest", "most likely", "leading"]),
        concept("s5_comorbid", 6, "Kept comorbid/alternative diagnoses in view (ADHD, ASD, CD/ODD, prodrome, PMDD)",
          ["adhd", "autism", "asd", "conduct", "oppositional", "odd)", "odd,", "(odd", "prodrom", "psychosis", "pmdd", "premenstrual", "comorbid"]),
        concept("s5_next_step", 6, "Named a management next step rather than stopping at 'normal'",
          ["refer", "psychiatr", "cap unit", "cap outpatient", "child and adolescent", "treat", "ssri", "cbt", "therapy", "follow-up", "follow up", "plan"])
      ],
      moduleA_questions: [
        fam("q5_tell_results", 5, "Told Mayumi her results and what they mean, in her words", ["results", "tests are", "blood tests", "scan was", "normal", "nothing physical", "nothing wrong with your body"], "patient"),
        fam("q5_reaction", 5, "Asked Mayumi how she feels about the results", ["how do you feel about", "what do you make of", "relieved", "worried", "does that", "hearing that"], "patient"),
        fam("q5_mood_now", 4, "Re-checked Mayumi's mood and safety since the last visit", ["since last", "this week", "how have you been", "how are you now", "any thoughts of", "worth living", "hurt yourself"], "patient"),
        fam("q5_parents_results", 4, "Explained the results to the parents", ["results", "tests", "normal", "nothing physical", "medical cause"], BOTH)
      ],
      moduleA_question_penalties: [
        { id: "p5_nothing_wrong", points: 4, label: en("Told Mayumi 'there is nothing wrong with you'"),
          any: ["nothing wrong with you", "you're fine", "you are fine", "all in your head", "in your head", "nothing the matter"], askOf: "patient" }
      ]
    },
    decisions: [
      vote("dec_s5_dx", "With a fully normal work-up, the diagnosis that ranks highest is…", [
        ["Major depressive disorder, adolescent-onset, with irritability and behavioural disturbance as prominent features — comorbidity still to be actively considered", true,
          "Six months of impairing change, anhedonia, hopelessness, worthlessness, irritability, insomnia, a screen-positive MFQ and a family loading, with organic mimics excluded. The Nagoya psychiatrists' additions (ADHD, ASD, CD/ODD, prodrome, PMDD) stay on the list as comorbidity or alternatives to look for, not as the leading diagnosis."],
        ["Conduct disorder — the lying, the gang, the alcohol and the nights away", false,
          "Those behaviours are real, but they sit on top of a depressive syndrome and Mayumi's own account explains them as escape and self-medication. Conduct disorder may be comorbid; it does not rank first."],
        ["Alcohol use disorder — treat the drinking and the rest will settle", false,
          "The drinking is self-medication for insomnia in a depressed adolescent. Treating it alone leaves the depression, and the risk, untouched."],
        ["A physical illness not yet found — extend the work-up", false,
          "A targeted screen, MRI and EEG are all normal. Extending the search now delays treatment of a diagnosis the evidence already supports."]
      ])
    ]
  });

  const S6 = Object.assign({}, COMMON, {
    id: "mayumi-6",
    name: en("A difficult child — 6. Management and outcome"),
    moduleAName: en("A difficult child — 6. Management and outcome"),
    summary: en(
      "After consulting the child and adolescent psychiatry outpatient unit, an SSRI (escitalopram) is started and weekly consultations " +
      "using a cognitive behaviour therapy approach begin. Mayumi improves — and her mother is diagnosed with depression too. " +
      "Decide on treatment, monitoring and safeguarding, and on what relapse prevention looks like for this family."),
    characters: cast({ mayumi: true, mayumiPersona: MAYUMI_PERSONA_RECOVERED, motherPersona: MOTHER_PERSONA_LATER }),
    penalties: [trapPenalty("pen6_level", "Sent a drug level instead of seeing her",
      "Early SSRI treatment is monitored by contact — weekly calls and visits for suicidality and side effects — not by a plasma level, which has no role here.")],
    case: {
      history: FACTS_6, exam: OBS_OUTCOME, labs: [
        synth("Management, course and what it taught",
          "After consulting the child and adolescent psychiatric outpatient unit, an SSRI — escitalopram in this case — was started, " +
          "with weekly consultations using a cognitive behaviour therapy approach. First-line treatment of adolescent major depression " +
          "of moderate severity is an SSRI combined with psychotherapy; antidepressants carry a boxed warning of increased suicidality " +
          "in young people, so early treatment needs close monitoring — weekly contact, scheduled visits in the first month — for " +
          "suicidality and for side effects (gastrointestinal upset, nervousness, headache, restlessness). Mayumi improved: lively and " +
          "energetic again, back at schoolwork, experiencing success, planning further education; the aggression toward her parents " +
          "evolved into constructive self-assertion. The doctor also diagnosed depression in Mayumi's mother and treated it well; she " +
          "later disclosed periodic depressions since youth and a severe episode when Mayumi was small — the family loading the " +
          "grandmother's history had hinted at. Comprehensive care treats the family, discusses the responsibility of informing social " +
          "services and what supports the family's history warrants, plans relapse prevention and follow-up, and knows the " +
          "non-pharmacological options: CBT is short-term, goal-oriented and practical, changing the thoughts and behaviours behind " +
          "the feelings; group therapy connects adolescents with peers who understand."),
        TRAP_6
      ],
      prompts: [
        en("When, and why, do you refer an adolescent to child and adolescent psychiatry rather than treat in general practice? What did consulting the CAP unit add here?"),
        en("Escitalopram plus weekly CBT was the choice. What are the indications for starting an antidepressant in an adolescent, what does the boxed warning require of you in the first weeks, and what would you tell Mayumi and her parents to watch for?"),
        en("The mother's depression, diagnosed on the way: why does treating her matter for Mayumi? Discuss the responsibility of informing social services — and, given this family's history, what supports you would actually recommend."),
        en("Relapse prevention: what is the plan for the next two years? And in plain words — what is CBT, and why was it the right psychotherapy here? (The tutorial includes a demonstration video; discuss what the therapist is doing and how the patient reacts.)")
      ]
    },
    scoring: {
      moduleA: [
        concept("s6_ssri_cbt", 8, "SSRI plus CBT as first-line treatment",
          ["ssri", "escitalopram", "fluoxetine", "antidepress", "cbt", "cognitive behav", "psychotherapy", "combination"]),
        concept("s6_boxed_warning", 8, "Boxed warning: monitor closely for suicidality early in treatment",
          ["boxed", "black box", "suicid", "monitor", "weekly", "close follow", "first month", "first weeks"]),
        concept("s6_refer_cap", 6, "Consulted / referred to child and adolescent psychiatry",
          ["refer", "psychiatr", "cap unit", "cap outpatient", "child and adolescent", "specialist", "consult"]),
        concept("s6_mother", 8, "Recognised the mother's depression and the family loading as part of Mayumi's care",
          ["mother", "maternal", "family", "genetic", "loading", "hereditary", "treat her", "parent"]),
        concept("s6_safeguarding", 6, "Discussed social services / safeguarding and concrete supports",
          ["social services", "safeguard", "child protection", "support", "school", "welfare", "social worker"]),
        concept("s6_relapse", 6, "Planned relapse prevention and long-term follow-up",
          ["relapse", "recurren", "prevent", "long-term", "long term", "follow-up", "follow up", "continue", "maintenance"]),
        concept("s6_cbt_defined", 4, "Described what CBT is",
          ["goal", "short-term", "short term", "thoughts", "behaviour", "patterns", "practical", "hands-on"])
      ],
      moduleA_questions: [
        fam("q6_side_effects", 6, "Asked Mayumi about side effects and about suicidal thoughts on treatment", ["side effect", "nausea", "stomach", "headache", "restless", "nervous", "thoughts of", "worth living", "hurt yourself", "suicid"], "patient"),
        fam("q6_how_now", 4, "Asked Mayumi how she is now and what has changed", ["how are you now", "how do you feel now", "what's changed", "what has changed", "better", "school now", "plans"], "patient"),
        fam("q6_parents_now", 4, "Asked the parents how things are at home now", ["how are things now", "at home now", "with her now", "changed at home", "arguments", "get on now"], BOTH),
        fam("q6_mother_own", 10, "Asked the mother about her OWN treatment and history", ["your own", "yourself", "your treatment", "your depression", "your mood", "how are you", "before, when mayumi", "when she was small", "when she was young", "periods like this"], "mother"),
        fam("q6_supports", 5, "Asked the family what support they have and need", ["support", "help at home", "school support", "social", "who helps", "counsell", "services"], ["patient", "father", "mother"])
      ],
      moduleA_question_penalties: []
    },
    decisions: [
      vote("dec_s6_treat", "The work-up is normal and depression leads. Your treatment plan is…", [
        ["Consult child and adolescent psychiatry; start an SSRI together with CBT; see her weekly early on and monitor for suicidality and side effects", true,
          "This is what happened, and it is guideline-concordant: SSRI plus psychotherapy for moderate adolescent depression, with the boxed-warning monitoring built in from day one."],
        ["Start an SSRI and review in three months", false,
          "The boxed warning exists precisely because the first weeks on an antidepressant are when suicidality can rise. Three months without contact is the wrong interval in the wrong patient."],
        ["Watchful waiting — she is 15, it may pass", false,
          "Six months of impairing depression with alcohol self-medication, nights away and 'sometimes life isn't worth living' is not a picture to watch. Untreated adolescent depression recurs and carries risk."],
        ["A hypnotic for the insomnia so she stops drinking to sleep", false,
          "Treats one symptom, adds a sedative to a girl who already uses alcohol at night, and leaves the depression untouched."]
      ]),
      vote("dec_s6_mother", "Mayumi's mother describes seasonal tiredness and low mood, and her own mother was periodically depressed. You…", [
        ["Assess the mother for depression in her own right and offer her treatment — her recovery is part of Mayumi's care", true,
          "Maternal depression shapes a child's development and the family's functioning, and untreated it undermines Mayumi's recovery. In this case the mother was diagnosed, treated successfully, and only then disclosed a lifetime of periodic depression."],
        ["Note it as family history and focus on the identified patient", false,
          "The history is not just a risk factor to record — it is a treatable illness in the person Mayumi lives with."],
        ["Advise the father to keep an eye on his wife", false,
          "Delegates a clinical assessment to a spouse who has already told you the marriage is 'fine' and who understates the family's stress."],
        ["Suggest the mother sees her GP about the irritable bowel", false,
          "The abdominal symptoms may be part of the same picture; sending her away with the somatic half of it misses the point."]
      ])
    ]
  });

  const SEEDS = [S1, S2, S3, S4, S5, S6];

  /* ── Pre/post knowledge checks ────────────────────────────────────────── *
   * Four items before and four after each section (the registry's floor for a
   * section that can be picked alone). Every item is answerable from the tutor
   * handout's teaching text; nothing is graded. ⚠ DRAFTED FOR REVIEW by the
   * Nagoya tutors — see ARCHITECTURE/mayumi-pbl-content.md. */

  function mcq(id, q, options, explanation) {
    return {
      id: id, q: en(q),
      options: options.map((o) => ({ text: en(o[0]), correct: !!o[1] })),
      explanation: en(explanation)
    };
  }

  const TESTS = {
    "mayumi-1": {
      pre: [
        mcq("q1", "Roughly what proportion of adults have an episode of major depression in any given year?",
          [["About 5%", true], ["About 25%", false], ["About 0.5%", false], ["About 50%", false]],
          "Around 5% of the adult population has a major depressive episode in a given year; two thirds of people have depressive symptoms at some time in their lives."),
        mcq("q2", "In adolescents, the mood change that defines a major depressive episode may be…",
          [["Depressed OR irritable mood, persisting at least two weeks and impairing", true], ["Sadness only — irritability points away from depression", false], ["Any change lasting more than two days", false], ["Low mood without any change from the previous baseline", false]],
          "For children and adolescents the criteria are met by at least two weeks of a persistent change in mood, depressed OR irritable, that is impairing and a change from baseline."),
        mcq("q3", "A 15-year-old's parents describe six months of defiance, lying, absence from school and a drinking peer group. The FIRST clinical priority is…",
          [["To interview the adolescent alone, with confidentiality explained", true], ["To start an SSRI on the parents' account", false], ["To reassure the parents that this is normal adolescence", false], ["To refer to social services for a conduct problem", false]],
          "Everything so far is second-hand. Teenagers are interviewed alone with the limits of confidentiality explained; the HEADSS domains that matter most can only be covered with the adolescent."),
        mcq("q4", "HEADSS is a structured set of interview topics for adolescents. Its letters stand for…",
          [["Home, Education, Activities, Drugs/alcohol, Sex, Suicidal thoughts", true], ["History, Examination, Assessment, Diagnosis, Safety, Support", false], ["Hearing, Eyes, Airway, Digestion, Skin, Sleep", false], ["Habits, Emotions, Anxiety, Depression, Stress, Substances", false]],
          "HEADSS: Home (can you talk to your parents?), Education, Activities, Drugs and alcohol (explain why you are asking), Sex (ditto), Suicidal thoughts (if indicated).")
      ],
      post: [
        mcq("q1", "Why must the differential stay wide after the parents' account alone?",
          [["Defiance, decline at school, alcohol and nights away are shared by depression, substance use, conduct problems, abuse and ordinary adolescence", true], ["Because parents are unreliable historians and nothing they say counts", false], ["Because depression cannot be diagnosed before age 18", false], ["Because six months is too short for any psychiatric diagnosis", false]],
          "The presentation is non-specific. The parents' account is essential — but it cannot separate the possibilities; only the adolescent's own account can."),
        mcq("q2", "Which of these is a documented risk factor for child mental-health problems in the FAMILY domain?",
          [["Parental ill-health, especially mental illness", true], ["Female gender of the child", false], ["High intelligence", false], ["Living in a large city", false]],
          "Family-domain risk factors include traumatic stress, ineffective or punitive parenting, family disharmony, parental ill-health (especially mental health) and family isolation. In the child domain, more problems are seen in boys."),
        mcq("q3", "When asking a teenager about alcohol or sex in a HEADSS interview, you should…",
          [["Explain why you are asking", true], ["Ask only with a parent present", false], ["Leave those topics for a second visit", false], ["Ask indirectly so the adolescent does not notice", false]],
          "The framework says it twice: Drugs/alcohol (explain why you're asking!) and Sex (ditto). Explaining the purpose is what makes a guarded adolescent answer."),
        mcq("q4", "A 15-year-old refuses to attend the consultation her parents booked. The doctor should…",
          [["Find a way to meet her — at home if necessary — rather than proceed without her", true], ["Treat on the parents' description since she will not come", false], ["Close the case until she is willing", false], ["Ask the parents to bring her by force", false]],
          "In the case the doctor meets Mayumi at home. An adolescent who will not come to the office is still the patient, and the assessment cannot proceed without her.")
      ]
    },
    "mayumi-2": {
      pre: [
        mcq("q1", "The formal chief complaint ('careless, defiant, negative; absent; failing') is added to the parents' story. How much does the differential change?",
          [["Not much — the presentation is non-specific and that is the teaching point", true], ["It now points clearly to conduct disorder", false], ["It now confirms depression", false], ["It excludes a substance use disorder", false]],
          "'How does your differential diagnosis change with this additional information? Not much; and this is a major point of this case.'"),
        mcq("q2", "Which pair of questions belongs in the history of the present illness of a possibly depressed adolescent?",
          [["Specific psychotic features, and potential for harm to self or others", true], ["Blood group, and immunisation status", false], ["Handedness, and shoe size", false], ["Favourite subject, and best friend's name", false]],
          "HPI: timing, onset and precipitating factors; what relieves the agitation; specific psychotic features; potential for harm to self or others."),
        mcq("q3", "Which of these conditions do the Nagoya child and adolescent psychiatrists say should be added to the differential of this presentation?",
          [["ADHD, autism spectrum disorder, conduct disorder and oppositional-defiant disorder", true], ["Type 1 diabetes and coeliac disease", false], ["Epilepsy only", false], ["Migraine and tension headache", false]],
          "ASD, ADHD, CD and ODD are frequently comorbid with depression or anxiety, and ADHD, CD and ODD with MDD or anxiety carry a higher risk of suicide and substance dependence. A prodromal psychotic state and PMDD also belong on the list."),
        mcq("q4", "Beyond the standard history, the tutor guide asks students to enquire specifically about…",
          [["Physical trauma or abuse, recent drug and alcohol use, symptoms of infection, the family's explanatory model, and complementary medicine or traditional healers", true], ["Screen time and diet only", false], ["The parents' occupations and income", false], ["Whether the adolescent has a boyfriend", false]],
          "Students should rule out trauma/abuse, recent substance use and signs of infection, explore the family's perspective on the illness, and ask about complementary and alternative medicine and traditional healers.")
      ],
      post: [
        mcq("q1", "Confidentiality in an adolescent interview should be…",
          [["Explained before the interview, together with its limits (safety)", true], ["Promised absolutely, whatever is disclosed", false], ["Avoided — parents have a right to everything said", false], ["Mentioned only if the adolescent asks", false]],
          "Confidentiality is the first item for teenagers in the guide. It is explained up front, with its limits — a threat to safety cannot be kept secret."),
        mcq("q2", "Why does comorbid ADHD, conduct disorder or oppositional-defiant disorder matter in a depressed adolescent?",
          [["They raise the risk of suicide and of substance dependence", true], ["They make antidepressants ineffective", false], ["They exclude a diagnosis of depression", false], ["They are always outgrown by 18", false]],
          "The Nagoya comment: ADHD, CD and ODD with MDD or anxiety disorder have a higher risk of suicide and substance dependence."),
        mcq("q3", "Premenstrual dysphoric disorder is on the differential of this case because…",
          [["The turbulence dated from menarche and the mood change may be cyclical", true], ["All 15-year-old girls should be screened for it", false], ["It is the most common cause of school refusal", false], ["It explains the alcohol use", false]],
          "Mayumi became more turbulent after her first period at 13. A cyclical pattern would point toward PMDD; establishing timing is part of the HPI."),
        mcq("q4", "'Potential for harm to self or others' should be asked…",
          [["In every history of an adolescent with a marked change in mood or behaviour", true], ["Only once depression has been confirmed", false], ["Only if the parents raise it", false], ["Only after a questionnaire suggests it", false]],
          "Risk is part of the history of the present illness, not a later step. Suicidal thoughts are the final S of HEADSS, asked 'if indicated' — and a six-month impairing change indicates it.")
      ]
    },
    "mayumi-3": {
      pre: [
        mcq("q1", "A hostile 15-year-old says 'nobody understands me' and 'it's no use anyway'. Read clinically, these are…",
          [["Hopelessness and worthlessness — depressive symptoms, not just attitude", true], ["Evidence of a conduct disorder", false], ["Normal teenage talk with no diagnostic weight", false], ["Signs of a psychotic prodrome", false]],
          "Hopelessness, feelings of worthlessness and irritability are core emotional changes of adolescent depression, which often looks like 'bad behaviour'."),
        mcq("q2", "An adolescent drinks at night 'because it helps me sleep'. The best reading is…",
          [["Self-medication for insomnia — a symptom to explore, and a risk behaviour", true], ["Established alcohol dependence", false], ["A phase that needs no comment", false], ["Proof that the parents are lying about the home", false]],
          "Insomnia is a behavioural symptom of adolescent depression; using alcohol to sleep is self-medication and belongs to the D of HEADSS — explored without judgment."),
        mcq("q3", "A mother reports being tired and down every spring and autumn, with irritable bowel; her own mother was periodically depressed. This is…",
          [["A family history of mood disorder — a risk factor for the daughter and a possible illness in the mother", true], ["Irrelevant to the daughter's assessment", false], ["Evidence of Munchausen by proxy", false], ["A reason to treat the daughter with the mother's medication", false]],
          "Parental mental ill-health is a family-domain risk factor, and a periodically depressed grandmother adds a genetic loading. In the case the mother is later diagnosed and treated herself."),
        mcq("q4", "Frequent headaches in a depressed adolescent are best understood as…",
          [["A common somatic complaint of depression, after physical causes are considered", true], ["Proof of a brain tumour until an MRI is done", false], ["Malingering to avoid school", false], ["An alcohol withdrawal symptom only", false]],
          "'Frequent complaints of unexplained body aches and headaches' are listed among the behavioural changes of teen depression; a physical examination and a targeted screen still exclude organic causes.")
      ],
      post: [
        mcq("q1", "After the home visit, what is the single most important question NOT yet asked of Mayumi?",
          [["Whether she has thoughts of harming herself or of suicide", true], ["Her favourite music", false], ["Her brother's grades", false], ["Whether she wants to change school", false]],
          "Suicidal thoughts are the final HEADSS domain and part of the HPI's 'potential for harm to self'. Nothing so far has asked it directly."),
        mcq("q2", "Which of these belongs to the ENVIRONMENT domain of the risk-factor list?",
          [["Problems in relationships with peers", true], ["Difficult temperament", false], ["Parental separation", false], ["Low intelligence", false]],
          "Environment: social deprivation, peer-relationship problems, stresses such as racism or war, and television/screen exposure. Temperament and intelligence are child factors; separation is a family factor."),
        mcq("q3", "Mayumi tells you she drinks to sleep. Telling her parents so they can 'lock the door at night' would…",
          [["Break the confidentiality you explained, at its first test, unless safety required it", true], ["Be the correct safeguarding step", false], ["Improve her sleep", false], ["Be required by law", false]],
          "Confidentiality was explained with limits. Alcohol to sleep is a risk behaviour to explore with her, not a safety emergency that overrides the promise."),
        mcq("q4", "Does the home visit narrow the differential?",
          [["Depression moves up, but substance use and psychosocial factors stay in view", true], ["It confirms major depressive disorder", false], ["It rules out depression — she is too hostile", false], ["It proves conduct disorder", false]],
          "Anhedonia, hopelessness, insomnia, somatic complaints and family loading raise depression; the differential remains broad until she has been examined, screened and asked about risk.")
      ]
    },
    "mayumi-4": {
      pre: [
        mcq("q1", "The Mood and Feelings Questionnaire (MFQ) is…",
          [["A self-report screening tool for depression in 6- to 17-year-olds (Angold & Costello, 1987)", true], ["A structured diagnostic interview for adults", false], ["A parent-rated conduct scale", false], ["A cognitive test for ADHD", false]],
          "The MFQ, developed by Adrian Angold and Elizabeth J. Costello in 1987, is a screening instrument for depression in children and young people aged 6 to 17."),
        mcq("q2", "How is the MFQ scored?",
          [["Not true = 0, somewhat true = 1, true = 2, summed; long version 0–66, short version 0–26", true], ["Yes/no items, one point each", false], ["A 1–10 rating of the last week", false], ["Clinician-rated on a five-point scale", false]],
          "Each item scores 0, 1 or 2 and the points are summed. The long version ranges from 0 to 66 and the short version from 0 to 26."),
        mcq("q3", "Which long-version MFQ score is commonly cited as suggesting depression?",
          [["27 or higher", true], ["12 or higher", false], ["50 or higher", false], ["Any score above 0", false]],
          "27 or more on the long version (12 or more on the short version) may indicate depression — but there is no single cut-point that is best in all circumstances."),
        mcq("q4", "A normal physical examination in an adolescent with suspected depression…",
          [["Helps exclude organic causes but does not rule depression out", true], ["Rules depression out", false], ["Confirms depression", false], ["Makes further investigations unnecessary", false]],
          "'A complete physical to rule out other medical conditions is always a good first step'; it excludes other explanations, it does not decide the diagnosis.")
      ],
      post: [
        mcq("q1", "Mayumi's MFQ total is 33 of 66. What does that establish?",
          [["Screen positive — a diagnosis still needs the clinical interview", true], ["A confirmed diagnosis of major depressive disorder", false], ["A score below threshold", false], ["Severe depression with psychotic features", false]],
          "Higher scores suggest more severe symptoms and 33 is above the cited cut-point, but the MFQ is a screening tool; diagnosis requires the interview."),
        mcq("q2", "On the MFQ Mayumi marks 'I thought that life wasn't worth living' as SOMETIMES and the three suicidal-ideation items as NOT TRUE. The correct response is…",
          [["Ask her directly and kindly about it in person, today", true], ["Nothing — active suicidal ideation is not endorsed", false], ["Admit her immediately", false], ["Repeat the questionnaire next month", false]],
          "Absent active ideation is reassuring but does not close the question: an endorsed 'life not worth living' item demands a direct, compassionate follow-up in the consultation."),
        mcq("q3", "Which investigation set is appropriate to exclude organic mimics of adolescent depression?",
          [["Full blood count, CRP, Monospot, glucose, thyroid function, ferritin, B12, folate, vitamin D", true], ["Whole-body imaging and a full autoimmune panel", false], ["No tests — the questionnaire is enough", false], ["A toxicology screen only", false]],
          "Each test excludes a treatable mimic — anaemia, infection and mononucleosis, diabetes, thyroid disease and deficiencies. Imaging and EEG are added when the examination or history indicate them."),
        mcq("q4", "Mayumi's MFQ profile shows no appetite change and no psychomotor slowing but prominent irritability and negative self-schema. This pattern is…",
          [["Typical of adolescent-onset depression, which often reads as 'behaviour problems'", true], ["Incompatible with depression", false], ["Diagnostic of bipolar disorder", false], ["Evidence the questionnaire was filled in carelessly", false]],
          "MDD in adolescents can present without the melancholic neurovegetative features and with irritability to the fore — which is why it is so often mistaken for defiance.")
      ]
    },
    "mayumi-5": {
      pre: [
        mcq("q1", "Why is thyroid function checked in an adolescent with suspected depression?",
          [["Hypothyroidism can mimic depression and is treatable", true], ["Antidepressants cannot be given with a normal TSH", false], ["To screen for diabetes", false], ["Because depression damages the thyroid", false]],
          "Thyroid disease is one of the medical conditions a complete physical work-up rules out before treating depression."),
        mcq("q2", "A Monospot test in this case is ordered to…",
          [["Exclude infectious mononucleosis as a cause of fatigue and low mood", true], ["Measure blood alcohol", false], ["Confirm depression", false], ["Check for anaemia", false]],
          "The tutor guide asks students to look for symptoms and signs of infection; mononucleosis is a classic mimic of adolescent fatigue and low mood."),
        mcq("q3", "A CRP of 5 mg/L with a reference range of below 5 mg/L is best described as…",
          [["At the upper limit of normal — no meaningful inflammation", true], ["A strongly positive inflammatory marker", false], ["Diagnostic of infection", false], ["Impossible — a laboratory error", false]],
          "'Review the laboratory results reflecting on normal values': a value at the boundary is not a signal, and nothing else in the panel supports inflammation."),
        mcq("q4", "Which comorbidities do the Nagoya psychiatrists specifically say increase suicide and substance-dependence risk when they accompany major depression?",
          [["ADHD, conduct disorder and oppositional-defiant disorder", true], ["Asthma and eczema", false], ["Migraine and irritable bowel", false], ["Short sight and dyslexia", false]],
          "ADHD, CD and ODD with MDD (or anxiety disorder) carry a higher risk of suicide and substance dependence — a reason to look for them actively.")
      ],
      post: [
        mcq("q1", "All results — blood tests, MRI and EEG — are normal. The diagnosis that now ranks highest is…",
          [["Major depressive disorder, adolescent-onset, with irritability and behavioural disturbance prominent", true], ["Conduct disorder", false], ["Alcohol use disorder alone", false], ["An undiscovered physical illness — extend the work-up", false]],
          "With organic mimics excluded and a clinical picture plus screen-positive MFQ, MDD leads; comorbidity stays in view."),
        mcq("q2", "Telling a depressed adolescent 'the tests are all normal, so there's nothing wrong with you' risks…",
          [["Dismissing a real illness and losing the alliance you built", true], ["Nothing — it is accurate", false], ["Making her ask for more tests", false], ["Breaching confidentiality", false]],
          "Normal results exclude a medical cause; they do not mean nothing is wrong. The conversation should say what the results exclude and what comes next."),
        mcq("q3", "A normal EEG in this case…",
          [["Makes epileptiform activity an unlikely explanation for the behavioural change", true], ["Proves the MRI unnecessary", false], ["Rules out depression", false], ["Should be repeated with sleep deprivation before any diagnosis", false]],
          "The EEG was 'described as normal for age'. It answers one question — an epileptic cause of the change — and no other."),
        mcq("q4", "'Results are normal' should be followed by…",
          [["A management plan: consultation with child and adolescent psychiatry, treatment, follow-up", true], ["Discharge", false], ["A repeat MFQ in six months", false], ["Referral to the school counsellor only", false]],
          "The tutor question is 'how would you proceed with the management of this patient?' — normal results close the organic question and open the treatment one.")
      ]
    },
    "mayumi-6": {
      pre: [
        mcq("q1", "According to the tutor guide, antidepressants are first-line when…",
          [["Severity is moderate to severe, psychotic features exist, psychotherapy is unavailable, there was a previous positive response, or the patient prefers medication", true], ["Any sadness lasts more than a week", false], ["The patient is under 16", false], ["Psychotherapy has never been tried", false]],
          "Antidepressants are effective for major depressive episodes but not at the very mild end of the range — 'treat depression rather than unhappiness'."),
        mcq("q2", "All antidepressants carry a boxed warning in young people for…",
          [["An increased risk of suicidality, so close monitoring is recommended", true], ["Weight gain", false], ["Dependence", false], ["Liver failure", false]],
          "Because of the boxed warning, close monitoring — weekly telephone calls and scheduled visits in the first month — is recommended for suicidality and other adverse effects."),
        mcq("q3", "Cognitive behavioural therapy is…",
          [["A short-term, goal-oriented therapy that changes the thoughts and behaviours behind the difficulties", true], ["A long-term exploration of childhood conflicts", false], ["A medication-adjustment protocol", false], ["A form of family mediation", false]],
          "CBT is short-term, goal-oriented and practical; it changes patterns of thinking and behaviour, and so changes how people feel."),
        mcq("q4", "For mild to moderate adolescent depression, the guide describes psychotherapy (talk therapy and/or CBT) as…",
          [["Often a good initial treatment", true], ["Contraindicated", false], ["Useful only after medication has failed", false], ["Effective only in groups", false]],
          "Psychotherapy is often a good initial treatment for mild to moderate depression; treatment is matched to severity, preference, developmental level, risk factors and available services.")
      ],
      post: [
        mcq("q1", "The SSRI started for Mayumi in the tutorial was…",
          [["Escitalopram, after consulting the child and adolescent psychiatry unit", true], ["Amitriptyline", false], ["Diazepam", false], ["Methylphenidate", false]],
          "'You initiate antidepressant medication (SSRI: escitalopram), and you have weekly consultations with her using a CBT approach.'"),
        mcq("q2", "Which adverse effects should be monitored in an adolescent starting an SSRI?",
          [["Suicidality, gastrointestinal effects, nervousness, headache and restlessness", true], ["Hair loss and gum bleeding", false], ["Hypertension and gout", false], ["Deafness and tinnitus", false]],
          "Monitoring covers suicidality and other adverse effects such as gastrointestinal effects, nervousness, headache and restlessness."),
        mcq("q3", "Mayumi's mother is diagnosed with depression and treated. Why does this matter for Mayumi?",
          [["Maternal depression affects the child's development and the family's functioning; treating it is part of comprehensive care", true], ["It does not — the mother is not the patient", false], ["It means Mayumi's diagnosis was wrong", false], ["It removes the need for Mayumi's own treatment", false]],
          "The mother later disclosed periodic depressions since youth and a severe episode when Mayumi was small — parental mental ill-health is a family risk factor, and her recovery supports Mayumi's."),
        mcq("q4", "Beyond medication and CBT, which treatment option does the guide describe as effective for teenagers?",
          [["Group therapy, creating support networks beyond family and close friends", true], ["Bed rest", false], ["Removal from school", false], ["Hypnotics for sleep", false]],
          "Therapy groups connect adolescents with peers who understand their struggles and build support networks beyond the immediate family.")
      ]
    }
  };

  SEEDS.forEach((sc) => {
    sc.preTest = TESTS[sc.id].pre;
    sc.postTest = TESTS[sc.id].post;
  });

  /* Facilitator card, keyed like case-content.js's FACILITATOR_NOTES. */
  const NOTES = {
    en:
      "FACILITATOR CARD — A Difficult Child (Mayumi, 15, adolescent-onset major depression). Nagoya PBL No. 57, six sections, one per reveal.\n" +
      "OBJECTIVES: (1) how depression presents in a general-practice / outpatient setting — in an adolescent, as irritability and 'behaviour'; " +
      "(2) how and when to start an antidepressant, and the choices; (3) when to refer; (4) treating recurrence and preventing it; (5) the non-pharmacological options.\n" +
      "THE POINT OF SECTION 2: the formal chief complaint does not narrow the differential. Say so if the group tries to close early.\n" +
      "TRAPS (these lose points): naming a diagnosis to the parents before meeting Mayumi (1); lecturing or blaming her to her face (3); " +
      "telling her 'there is nothing wrong with you' when the tests are normal (5). Wrong vote options: treating a description, reassuring the parents, " +
      "reading the MFQ as a diagnosis or as 'below threshold', an SSRI with a three-month review, watchful waiting.\n" +
      "KEY MOMENTS: HEADSS with confidentiality first; alcohol as self-medication for insomnia; the mother's seasonal low mood and the grandmother's depression " +
      "as a family loading that pays off in section 6; MFQ item 16 ('sometimes' life not worth living) must be followed up in person the same day; " +
      "'results are normal' is not a plan; the boxed warning means weekly contact early; treating the mother is treating the family.\n" +
      "NAGOYA CAP ADDITIONS to the differential: ASD, ADHD, conduct and oppositional-defiant disorder (frequently comorbid; higher suicide and substance risk), " +
      "a prodromal psychotic state, premenstrual dysphoric disorder.\n" +
      "SOURCE: the SSRI started was escitalopram (tutor handout). Fluoxetine is the more widely licensed first choice in this age group; both are defensible — worth a sentence in debrief.\n" +
      "TIMING (two core-time sessions): sections 1–3 in session 1, 4–6 in session 2; self-study on the channel between them, as in the original."
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SEEDS;
  if (typeof root !== "undefined") {
    root.CANAMED_MAYUMI_SEED = SEEDS;
    root.CANAMED_SCENARIOS = root.CANAMED_SCENARIOS || {};
    SEEDS.forEach((sc) => { root.CANAMED_SCENARIOS[sc.id] = sc; });
    root.FACILITATOR_NOTES = root.FACILITATOR_NOTES || {};
    SEEDS.forEach((sc) => { root.FACILITATOR_NOTES[sc.id] = NOTES; });
  }
})(typeof window !== "undefined" ? window : this);
