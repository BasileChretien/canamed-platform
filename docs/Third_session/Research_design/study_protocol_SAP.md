# CaNaMED Session 3 — Study Protocol & Statistical Analysis Plan (SAP)

**Status:** pre-registration-ready draft. Lock this document (git tag + OSF
registration) **before Session 3 data collection opens**.
**Version:** SAP-v1 (drafted 2026-05-21), bound to questionnaire `form_version = S3-v1`.
**Companion documents:** `questionnaire_template.md` (locked 18 Likert + 6 open items),
`participation_equity_analysis.md` (offline equity measure), `case-content.js`
(the 3 scenarios + their `PRETEST_*` / `POSTTEST_*` MCQ banks).

---

## 1. Title & sites

**Title.** *Feasibility and within-person change after a problem-based,
cross-cultural clinical-reasoning workshop: a single-arm pre/post study with an
embedded two-site comparison (Caen, France × Nagoya, Japan).*

**Sites.** Two undergraduate medical programmes:
- **Caen** (Université de Caen Normandie, France)
- **Nagoya** (Japan)

Students from both sites participate in the **same** workshops, in mixed
Franco-Japanese small groups, on a shared online PBL platform.

---

## 2. Background & objectives

Session 2 ran as a single-arm pre/post pilot with small n (16 pre / 9 post),
single-coder qualitative analysis, and no pre-specified analysis plan. With n
this small, any apparent pre/post change is otherwise uninterpretable: it cannot
be separated from regression to the mean, ~44% attrition, demand
characteristics, and analytic flexibility. None of these threats require more
participants to address — they require this document, written and time-stamped
**before** the data exist.

**Objectives.**
1. Estimate within-person change in clinical-reasoning knowledge after the
   workshop (primary).
2. Estimate change in self-reported self-efficacy, and describe satisfaction,
   attitudes, participation equity, and qualitative experience (secondary).
3. Explore whether responses differ between the Caen and Nagoya sites
   (exploratory — the study's most novel asset, protected from p-hacking by
   pre-specification).
4. Demonstrate **feasibility** of the linked end-to-end measurement pipeline
   (registration → pre-test → post-test → questionnaire) at small n.

This is explicitly a **feasibility / precision** study. It is **not** powered for
confirmatory hypothesis testing; all inferential findings are
hypothesis-generating (see §11).

---

## 3. Design

**Design statement.** *Prospective, single-arm pre/post educational intervention
with an embedded two-site (France/Japan) cross-sectional comparison.*

There is **no control or comparison arm** and **no randomisation**. We make
**no causal claim** that the workshop *caused* any observed change; the within-
person pre/post contrast is descriptive of change over the session, confounded
with maturation, regression to the mean, and demand characteristics, all of which
are named as limitations. The two-site contrast is cross-sectional and
exploratory. The honest frame is *feasibility and precision at small n*, not
efficacy.

---

## 4. Participants & setting

- **Population.** Undergraduate medical students enrolled at the Caen and Nagoya
  programmes who attend the Session 3 workshop.
- **Eligibility.** Attendance at the session; provision of the two-checkbox
  consent (workshop participation + research use) recorded on the platform
  (§10).
- **Setting.** A single live, facilitated workshop run on the CaNaMED online PBL
  platform, in mixed Franco-Japanese small groups (typically 3–4 students per
  room).
- **Recruitment.** All attending, consenting students are eligible; this is a
  convenience sample, stated as such.

---

## 5. Intervention

A single facilitated PBL + roleplay session built on **three scenarios**
(`window.CANAMED_SCENARIOS` in `case-content.js`):

1. **`chronic-pain-opioids`** — *Chronic Pain & the Opioid Request* (45-y-o with
   8 months of low-back pain requesting oxycodone). Module A = clinical workup;
   Module B = cross-cultural breaking-bad-news roleplay.
2. **`breaking-bad-news-disclosure`** — *Breaking Bad News & Cross-Cultural
   Disclosure* (Mrs Tanaka, Stage IV pancreatic cancer; family-vs-patient
   disclosure conflict; Loi Kouchner × evolving Japanese がん告知 practice).
3. **`respiratory-stewardship`** — *Antibiotic Stewardship & the Sore-Throat
   Request* (Mme Moreau, Centor/McIsaac 0 pharyngitis requesting amoxicillin;
   France outpatient use × Japan MHLW AMR plan 2023–2027).

Each scenario delivers **Module A** (item-reveal clinical workup + `DECISIONS`
votes with correct/incorrect options and penalties) and **Module B**
(role-assigned cross-cultural roleplay). The cases are a **fixed item-reveal +
decision-vote** model; there is **no hard content branching**, so all students
take the **same** individually-administered pre/post test regardless of what
their team did. Process variation (which findings revealed, which decisions
committed, reveal order) is captured as data and may be used as a covariate.

---

## 6. Outcomes

### 6.1 Primary outcome (ONE, named now)

**Within-person change in knowledge: post-test minus pre-test percent-correct,
among linked completers.**

- **Estimand.** Mean within-person knowledge gain (post % correct − pre %
  correct) **among students who completed both the pre-test and the post-test
  and could be linked across the two** (the *linked-completer* population, §9).
- **Construction.** Percent-correct = (number of MCQ items answered correctly) ÷
  (number of items administered), recomputed in R from the raw per-question
  `answers/{qid}.choice` against the keyed `correct` option in `case-content.js`
  for the pinned `scenarioId` — **not** from the browser-stored `score` (client
  drift / version skew). Skipped items score as **incorrect for the
  percent-correct denominator** but skip rates are reported separately (high
  post-test skip is attrition in disguise).
- **Note on equating.** Pre and post are **different items** per scenario, so the
  raw difference blends learning with form difficulty. We mitigate this by
  **equating by competency** (§8) and reporting gain **per competency**, not only
  a single total.

### 6.2 Secondary outcomes (≤5, named)

1. **Self-efficacy change** on the **6 `eff_*` Likert items** (questionnaire
   Section A, items 11–16): `eff_history`, `eff_redflags`,
   `eff_shared_decision`, `eff_breaking_badnews`, `eff_resist_pressure`,
   `eff_cross_cultural`. (Confidence, *self-reported* — see §12.)
2. **Satisfaction**, the **10 satisfaction items 1–10**: `sat_pbl_format`,
   `sat_roleplay_value`, `sat_case_relevance`, `sat_difficulty_right`,
   `sat_time_adequate`, `sat_group_mixed`, `sat_everyone_spoke`,
   `sat_facilitator_support`, `sat_platform_usable`, `sat_language_ok`.
3. **Attitudes**, items **17–18**: `att_evidence` (EBM/guideline intention) and
   `att_recommend` (net-promoter). `att_recommend` is treated as **programmatic**,
   excluded from the confirmatory set.
4. **Participation equity** — computed **offline** from the per-room `events` /
   answers log (see `participation_equity_analysis.md`). Exploratory.
5. **Qualitative themes** from the **6 open items** (Section B): `open_pbl_format`,
   `open_roleplay`, `open_career`, `open_internship`, `open_improve`,
   `open_final`.

Anything not on this list — including the Section C recruitment item
`volunteer_curriculum_talk`, MCQ item-level psychometrics, and decision/path
covariates — is **exploratory** and labelled as such in any report.

---

## 7. Hypotheses (directional)

- **H1 (primary, knowledge).** Post-test % correct > pre-test % correct among
  linked completers.
- **H2 (self-efficacy).** Each `eff_*` item shifts upward post vs pre (where a
  pre measure exists) / is rated above the scale midpoint.
- **H3 (satisfaction).** Satisfaction items 1–10 are rated above the scale
  midpoint (median ≥ 4).
- **H4 (attitude).** `att_evidence` is rated above the scale midpoint.
- **H5 (cross-site, EXPLORATORY).** Caen and Nagoya differ on the
  cross-cultural self-efficacy item `eff_cross_cultural` and on the
  guideline-convergence MCQ items (chronic-pain post Q3/Q5, which probe FR/JP
  guideline alignment). Direction not pre-specified; hypothesis-generating only.

---

## 8. Analysis plan

All analyses are run in **R**, from the **raw exported JSON** (events, tests,
poll), with the `scenarioId` and `canamedSchemaVersion` / `form_version = S3-v1`
pinned so the answer key matches the items administered. **n is reported at every
step.**

### 8.1 Knowledge (primary)

- Paired analysis on linked completers: **Wilcoxon signed-rank test** on the
  per-person (post − pre) percent-correct difference (chosen over the paired
  t-test given small n and a bounded/ordinal score).
- Report the **median paired difference + a bias-corrected accelerated bootstrap
  95% CI** (e.g. 10 000 resamples), **not** a p-value alone.
- **Equating by competency.** Every MCQ item is tagged with an EDN competency
  code (§9 table). Each post item is paired to the pre item targeting the **same
  competency**, and **gain is analysed per competency**, so a hard post item
  paired with an easy pre item is visible rather than hidden. We do **not**
  headline a single 5-item "scale score" (a 5-item heterogeneous test is too
  short for a defensible reliability claim); per-competency change is the honest
  unit at this n.

### 8.2 Likert (self-efficacy, satisfaction, attitudes)

- Treat all 18 Likert items as **ordinal**. Report **item-level medians** and
  **diverging stacked bar charts** per item.
- Compute a **construct mean only after** demonstrating the items hang together
  (an internal-consistency / reliability check on the relevant item set, e.g. the
  6 `eff_*` items); if they do not cohere, report items individually.
- Use **non-parametric** tests throughout; blank = missing, **never coded 0**
  (the template already mandates this).

### 8.3 Cross-site (exploratory)

- **Mann–Whitney U** (continuous/ordinal outcomes) or **Fisher's exact** (sparse
  categorical) for Caen vs Nagoya, **flagged exploratory**, hypothesis-generating
  only; no multiplicity-correction claims we cannot honour at this n.

### 8.4 Multiplicity

Pre-committed: the **confirmatory set** is the **primary outcome + the 6 `eff_*`
items** only. Everything else (satisfaction items, attitudes, cross-site,
item-level psychometrics, equity) is **exploratory** and reported descriptively
with CIs, without confirmatory inference. If any inferential family is reported
across the `eff_*` set, control the **false discovery rate** (Benjamini–Hochberg)
within that family.

### 8.5 Missing data

- Primary: **complete-case** (linked completers) — defined a priori in §9.
- Likert: blank = missing, not 0; report per-item response n.
- Sensitivity: see §10 (ITT-style bounds).

---

## 9. Linkage & pseudonymisation

A within-person claim requires joining **three streams per person**: pre-test,
post-test, and questionnaire. The single join key is **`stableId`** — a durable
per-person identifier (bound to the Google `uid` when signed in, else an 80-bit
`localStorage` id that survives refresh / new tab / device-tab close), distinct
from the ephemeral per-tab `clientId`. The platform now stamps **`stableId` on
`pool`, `answers`, the per-person `tests` record, and the `poll`**, so all
research artefacts carry the same person key.

**Printed per-student join code.** At join time each student is shown a short,
human-typable code **derived from their `stableId`**. Students copy this code
into the questionnaire's `respondent_key` field. This replaces fragile typed-name
matching (transliteration, nicknames, Franco-Japanese name ordering) with a
deterministic join, and remains **pseudonymous** — the name → code linkage table
stays with the operator and is **never** included in the analysis dataset or the
on-demand archive (reusing the existing pseudonymised-export machinery).

**Validation.** Before the live session, the dry-run / sim must confirm
pre ↔ post ↔ questionnaire join succeeds for **≥ 95 %** of test personas. The
analysis dataset contains only `stableId` / join code, never names.

---

## 10. Attrition (CONSORT flow + ITT sensitivity)

Report a **CONSORT-style participant-flow** with n at every node:

```
registered → joined a room → completed pre-test → completed post-test → completed questionnaire
```

(The platform debrief funnel already computes the early nodes:
registered → assigned → answered → voted.) Drop-outs are described by **site,
year of study, and self-reported English level** (from `pool`) so attrition bias
can be judged. Session 2's **pre 16 → post 9 (~44 %)** drop is the single largest
validity threat and **must be characterised, not merely stated**.

- **Primary-analysis population:** linked completers of both tests (§6.1).
- **Sensitivity analysis (ITT-style):** re-estimate the primary contrast under a
  **worst-case / baseline-carried-forward bound** for non-completers, so the
  ~44 % attrition cannot silently drive the headline result. Report both the
  complete-case estimate and the sensitivity bound side by side.

---

## 11. Qualitative coding

- **Corpus:** the 6 open items per respondent (Section B) plus, where captured,
  speaker-and-timestamp room transcripts (`Room<n>_<slot>.docx`).
- **Reliability:** **≥ 2 independent coders.** At this n (~9–16 students × 6
  items) the corpus is small enough to **fully double-code**. Report
  **Krippendorff's α** (handles > 2 coders, missing data, any measurement level
  — the safest default; Cohen's κ acceptable for exactly two coders), **plus**
  percent agreement (percent agreement alone is not sufficient).
- **Codebook & audit trail:** pre-specify the codebook, or state it was developed
  inductively then frozen before reliability scoring; resolve disagreements by
  consensus or a third adjudicator; report the process. Stance: **positivist
  codebook + α**, to cohere with the quantitative framing of the rest of the
  study (a reflexive-thematic stance would be defensible but is not the stance
  chosen here — pick one and state it).
- Where possible, tag transcript speaker labels with the per-student join code so
  qualitative contribution can be triangulated against the §6.4 quantitative
  participation measure.

---

## 12. Sample-size / power statement (honest)

This study is **not powered for confirmatory hypothesis testing.** At n ≈ 9–16
linked completers, no realistic effect can be detected with adequate power, and
we do not pretend otherwise.

Instead this is pre-stated as a **feasibility / precision** study: we report
**effect sizes with 95 % CIs**; findings are **hypothesis-generating**. Optional
precision note (to be filled with the realised SD): *"n = X completers yields a
95 % CI half-width of ≈ H on the paired mean percent-correct difference, assuming
SD = S."* This sentence, written **before** data, is what makes small-n work
publishable.

**Self-report limitation.** The 6 `eff_*` items measure **confidence**, not
**competence**. A confidence-up / knowledge-flat pattern is itself an
interesting, publishable (and safety-relevant) finding; it is named here so it
cannot be spun as competence gain.

---

## 13. EDN-competency mapping

Every MCQ item is tagged with a French **EDN** (*Examen Dématérialisé National*)
competency, which doubles as the Japanese-side competency bridge (JOA / MHLW
guidance is already cited in the item explanations). This table is the basis for
the §8.1 competency equating.

| Scenario | Pre/Post item (topic) | EDN competency |
|---|---|---|
| chronic-pain-opioids | Q1 red flag / cauda equina | Diagnostic reasoning + emergency recognition |
| chronic-pain-opioids | Q2 non-indicated MRI | Pertinence des examens complémentaires |
| chronic-pain-opioids | Q3 first-line pharmacology (NICE NG59) | Thérapeutique + bon usage du médicament |
| chronic-pain-opioids | Q4 yellow flags | Diagnostic reasoning (psychosocial / chronicity) |
| chronic-pain-opioids | Q5 opioid request / SDM | Relation médecin-malade + bon usage |
| chronic-pain-opioids (post) | Q3/Q5 FR↔JP guideline convergence | Cross-cultural EBM (exploratory contrast) |
| breaking-bad-news | Q1 capacity / right to decide | Éthique, autonomie, capacité |
| breaking-bad-news | Q2 SPIKES Invitation step | Annonce / communication |
| breaking-bad-news | Q3 Loi Kouchner (direct disclosure) | Droit / relation médecin-malade |
| breaking-bad-news | Q4 Japanese がん告知 evolution | Cross-cultural disclosure (exploratory) |
| breaking-bad-news | Q5 family asks to withhold | Éthique + relation médecin-malade |
| breaking-bad-news | Q6 language of disclosure | Communication / cross-cultural |
| respiratory-stewardship | Q1 Centor/McIsaac criteria | Diagnostic reasoning |
| respiratory-stewardship | Q2 Centor 0 → no antibiotic | Antibiothérapie raisonnée |
| respiratory-stewardship | Q3 delayed (back-pocket) prescribing | Bon usage / shared decision |
| respiratory-stewardship | Q4 amoxicillin in EBV mononucleosis | Pharmacovigilance / safety |
| respiratory-stewardship | Q5 MHLW AMR national plan target | Santé publique / AMR (cross-cultural) |
| respiratory-stewardship | Q6 FeverPAIN score | Diagnostic reasoning |

(Item ids `q1`–`q6` per scenario's `PRETEST_*` / `POSTTEST_*` arrays. Where a
post item has no pre counterpart on the same competency it is analysed as a
post-only descriptive item, not as gain.)

---

## 14. Ethics & consent

- **Consent.** The platform records two-checkbox consent
  (`pool/{cid}/consent.workshop` + `consent.research`) with the consent **version
  and timestamp**. Only research-consenting participants enter the research
  dataset. Cite this provenance in the ethics section.
- **Privacy.** See `privacy.html`; consent is **versioned** so a participant's
  agreement is tied to a specific policy text. The platform's per-participant
  JSON self-export and pseudonymised on-demand archive are genuine GDPR / APPI
  strengths and are cited as such.
- **Approvals.** Record the IRB / ethics-committee approval numbers for **both**
  Caen and Nagoya before the session opens.

---

## 15. Pre-registration checklist (OSF)

Register on OSF (free, timestamped, embargoable) **before** Session 3 data
collection. Even a registration after Session 2 (labelled pilot) but before
Session 3 is a large credibility gain.

- [ ] Design statement (single-arm pre/post + embedded two-site, §3) — no causal
      over-claim.
- [ ] ONE named primary outcome + estimand (§6.1).
- [ ] ≤ 5 named secondary outcomes (§6.2); everything else flagged exploratory.
- [ ] Directional hypotheses, incl. the exploratory Caen × Nagoya contrast (§7).
- [ ] Full analysis plan: paired Wilcoxon + bootstrap CI; Likert as ordinal;
      non-parametric cross-site; competency equating (§8).
- [ ] Multiplicity stance: confirmatory set = primary + 6 `eff_*`; FDR within
      family; rest exploratory (§8.4).
- [ ] Missing-data rule + ITT-style sensitivity bound (§8.5, §10).
- [ ] Linkage key = `stableId` + printed code → `respondent_key` (§9).
- [ ] CONSORT flow nodes defined; linked-completer population defined (§10).
- [ ] Qualitative: ≥ 2 coders + Krippendorff's α + frozen codebook (§11).
- [ ] Feasibility / precision framing; not powered for confirmation (§12).
- [ ] EDN-competency map (§13).
- [ ] Ethics: versioned consent + both IRB numbers (§14).
- [ ] `form_version = S3-v1` + `scenarioId` + schema version pinned on every
      export stream.

---

## 16. What to lock before Session 3 opens

1. **This SAP** — git-tag it and OSF-register it **before** data collection.
2. **Questionnaire** — `form_version = S3-v1`, header = item `id` (not a number),
   Likert stored as integers 1–5, blank = missing, header row non-editable.
3. **Join key** — confirm `stableId` is stamped on tests / poll / answers / pool;
   confirm the printed per-student code → `respondent_key` flow; **validate the
   dry-run join at ≥ 95 %**.
4. **MCQ answer key** — freeze `case-content.js` (`scenarioId` + schema version);
   confirm every Likert and MCQ `id` exists in en/fr/ja with no missing
   translation.
5. **EDN competency tags** — finalise the per-item mapping (§13) so equating is
   deterministic.
6. **Codebook + second coder** — name the second coder and freeze the codebook
   before any open-item is read.
7. **Ethics** — both IRB approval numbers on file.
8. **Export stamps** — `form_version`, `scenarioId`, schema version on the
   questionnaire, per-test, and events exports.
