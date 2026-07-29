# Proposed test items for the thin sections — FOR MEDICAL REVIEW

**Not merged.** Nothing in this file is loaded by the platform. It exists
because decision 3 of [section-model-design.md](section-model-design.md) gives
every section its own pre/post-test, and splitting the existing tests exposed
sections with almost no items of their own (decision 10).

Approve / correct / reject item by item. On approval I add them to
`case-content.js`, classify them in `TEST_SPLIT` (`section-registry.js`) and
translate them to FR + JA — the drafts below are **English only** on purpose, so
no unreviewed clinical wording enters three languages at once.

## Where the split actually lands

| Section | Pre-test | Post-test | Verdict |
|---|---|---|---|
| `chronic-pain-pbl` | 9 | 6 | fine |
| `chronic-pain-roleplay` | **1** | 4 | thin pre-test |
| `jaundice-pbl` | **0** | **1** | the real gap |
| `jaundice-roleplay` | 10 | 9 | fine |
| `sore-throat-pbl` | 5 | **1** | thin post-test |
| `sore-throat-roleplay` | **1** | 5 | thin pre-test |
| `ward-escalation-branched` | 0 | 0 | branched cases have never had tests — separate decision |

The pattern is systematic, not accidental: the tests were written per *case*
around whatever that case's teaching centre of gravity was (the jaundice case
is a disclosure case that happens to open with a workup), so they never had to
balance across modules. Once sections mix freely, a session of
`jaundice-pbl` + `sore-throat-roleplay` would currently show a pre-test drawn
entirely from the roleplay half.

Also missing, and cheaper to fix: **per-section summaries**. Each section
currently inherits its case's summary, which describes both halves ("Module A is
the workup; Module B is the roleplay"). Stage 0 will print one blurb per picked
section (decision 4), so each section needs a 1–2 sentence blurb of its own. Say
the word and I draft those too.

---

## `jaundice-pbl` — painless obstructive jaundice workup

### Proposed pre-test (6)

**J-pre-1.** A 75-year-old presents with painless jaundice and a palpable,
non-tender gallbladder. What does this combination suggest?
- A distal biliary obstruction that is more likely malignant than stone-related ✅
- Acute cholecystitis
- Gilbert syndrome
- Haemolysis

*Courvoisier's sign: in gallstone disease the gallbladder is usually fibrotic
and non-distensible, so a palpable painless gallbladder points away from stones.*

**J-pre-2.** Which is the appropriate FIRST imaging test in suspected
obstructive jaundice?
- Abdominal ultrasound ✅
- Immediate ERCP
- Plain abdominal radiograph
- PET-CT

*Ultrasound confirms duct dilatation and level of obstruction, is
non-invasive, and directs the choice of cross-sectional imaging.*

**J-pre-3.** Which liver-test pattern best indicates cholestasis?
- Raised ALP and GGT with conjugated hyperbilirubinaemia, transaminases
  proportionally lower ✅
- Transaminases in the thousands with normal ALP
- Isolated unconjugated hyperbilirubinaemia
- Isolated low albumin

**J-pre-4.** Which feature most raises concern for pancreatic head malignancy in
an older adult with jaundice?
- Weight loss with new-onset diabetes ✅
- Jaundice that fluctuates with meals
- A family history of Gilbert syndrome
- Pruritus alone

**J-pre-5.** What is the correct role of CA 19-9?
- Baseline and monitoring in known disease — not a diagnostic or screening test,
  and it rises in benign cholestasis ✅
- A screening test for pancreatic cancer in the general population
- Diagnostic when above the reference range
- Useful only after resection

**J-pre-6.** Which investigation best assesses resectability once malignancy is
suspected?
- Contrast-enhanced pancreatic-protocol CT ✅
- Repeat ultrasound
- ERCP with stenting
- Liver biopsy

### Proposed post-test (4)
*(the existing post-test q3 on ERCP biliary stenting already belongs here)*

**J-post-1.** Before starting palliative chemotherapy, what is required?
- A tissue diagnosis, usually by EUS-guided fine-needle biopsy ✅
- Imaging alone is sufficient
- A raised CA 19-9 is sufficient
- Nothing further

**J-post-2.** In a patient who may still be resectable, why is a staging CT
preferred BEFORE ERCP and stenting?
- A stent introduces inflammatory change and artefact that degrade staging
  accuracy, and ERCP carries a pancreatitis risk ✅
- ERCP is contraindicated in malignancy
- CT cannot be performed after stenting
- It shortens the admission

**J-post-3.** A patient with pancreatic cancer reports greasy, floating stools
and continued weight loss despite eating. What should be offered?
- Pancreatic enzyme replacement therapy with dietetic input ✅
- A low-fat diet alone
- Loperamide
- No action; this is expected

**J-post-4.** What does the evidence show about introducing palliative care
early in advanced pancreatic cancer?
- It improves quality of life and symptom control and is compatible with
  ongoing oncological treatment ✅
- It should wait until chemotherapy is stopped
- It shortens survival
- It applies only in the last days of life

---

## `sore-throat-pbl` — proposed post-test (3)

**S-post-1.** When is a rapid antigen detection test for group A strep
appropriate?
- When the Centor/McIsaac score is intermediate-to-high, to avoid empirical
  treatment — not at a score of 0 ✅
- In every sore throat
- Only after antibiotics have failed
- Never; it has been superseded by culture

**S-post-2.** Which features should trigger urgent re-assessment (safety
netting) in a patient sent home without antibiotics?
- Trismus, drooling, unilateral swelling, stridor or inability to swallow
  fluids ✅
- Any persisting sore throat at 48 hours
- A temperature of 37.8 °C
- Hoarseness

**S-post-3.** What should the patient be told about the expected course?
- Most sore throats settle within about a week, and analgesia plus fluids is
  the mainstay — with clear return advice ✅
- Symptoms should resolve within 24 hours
- Antibiotics shorten it by several days
- Recovery takes about a month

---

## `chronic-pain-roleplay` — proposed pre-test (3)

**C-pre-1.** A patient says "you clearly don't believe my pain is real". What is
the best first response?
- Acknowledge the pain as real and name the frustration before explaining the
  plan ✅
- Explain the imaging is normal
- Repeat that opioids are not indicated
- Offer a second opinion straight away

**C-pre-2.** What best characterises shared decision-making when declining a
specifically requested drug?
- State the reasoning, offer the alternatives that are on the table, and keep
  the relationship open for review ✅
- Defer entirely to the patient's preference
- Decline and end the consultation
- Prescribe a smaller dose as a compromise

**C-pre-3.** Comparing typical French and Japanese consultation expectations
around refusing a request, which is most accurate?
- Both traditions can reach the same plan, but the expected directness of the
  refusal and the role of the family differ ✅
- Japanese practice never involves a direct refusal
- French practice never involves the family
- The two are indistinguishable in practice

---

## `sore-throat-roleplay` — proposed pre-test (3)

**R-pre-1.** The patient wants antibiotics because of a work deadline on Friday.
What is the most useful reframing?
- Address the underlying need — being functional on Friday — with symptom
  control and a clear plan ✅
- Explain that work is not a medical indication
- Prescribe to preserve the relationship
- Suggest sick leave instead

**R-pre-2.** What is the intended role of a delayed ("back-pocket")
prescription, and its risk?
- It reduces immediate antibiotic use while safety-netting, but can be read as
  "the doctor thinks I'll need it" if not explained ✅
- It is a placebo
- It is equivalent to immediate prescribing
- It is contraindicated in primary care

**R-pre-3.** How is teach-back best used at the end of this consultation?
- Ask the patient to say back the plan and when to return, to confirm shared
  understanding ✅
- Ask whether they have understood
- Provide a leaflet instead
- Repeat the explanation more slowly

---

# Proposed VOTE CARDS for the two sections that have none — FOR MEDICAL REVIEW

**Not merged.** Surfaced by the end-to-end integration test: vote cards are as
unevenly distributed as the test items, and a session mixing these two sections
would run with **no group decision at all**.

| Section | Vote cards |
|---|---|
| chronic-pain-pbl | 2 |
| chronic-pain-roleplay | 1 |
| **jaundice-pbl** | **0** |
| jaundice-roleplay | 5 |
| sore-throat-pbl | 3 |
| **sore-throat-roleplay** | **0** |
| ward-escalation-branched | 4 |

Same rules as the test items above: English only, approve/correct/reject each,
and I add them to `case-content.js` (tagged with the right `module`) on approval.

## `jaundice-pbl` — proposed vote cards (2)

**J-vote-1 — "The scan is back. What do you order next?"**
*Ultrasound shows a dilated intra- and extra-hepatic biliary tree and a
suspicious mass in the pancreatic head. Bilirubin 210 µmol/L, ALP 640 U/L. She
is itching badly but is not septic.*

- **Pancreatic-protocol contrast CT for staging, BEFORE any biliary
  intervention** ✅
  *Reveal:* Staging first preserves the information you need. A stent
  introduces inflammatory change and artefact that degrade assessment of
  vascular involvement, and ERCP carries a pancreatitis risk — so a decision
  taken for comfort can cost you the resectability question.
- **ERCP with stenting now, to relieve the jaundice**
  *Reveal:* Tempting, because she is uncomfortable and the bilirubin is high.
  But she is not septic and not in renal failure, so this is not urgent
  drainage — and doing it first degrades the staging CT.
- **Refer straight to oncology without further imaging**
  *Reveal:* No tissue, no stage, no resectability assessment — oncology cannot
  plan from this, and it delays rather than shortens the pathway.

**J-vote-2 — "Who takes the decision about what she is told?"**
*Her son asks the team, privately, not to tell her.*

- **Establish what SHE wants to know first, then honour it** ✅
  *Reveal:* Capacity is intact, so the decision is hers — including the right
  not to know. Asking her what she wants is not the same as telling her
  everything, and it takes the family out of the position of gatekeeper without
  making them the adversary.
- **Agree with the son and defer the conversation**
  *Reveal:* It buys calm now at the cost of her autonomy, and it puts the team
  in an undertaking it cannot keep once she asks a direct question.
- **Tell her the full diagnosis immediately, as the law requires**
  *Reveal:* Direct information is the default, but "immediately and in full"
  ignores the Invitation step — the obligation is to offer the information, not
  to impose it.

> **NB for the author:** this second card deliberately overlaps
> `jaundice-roleplay`'s territory. If you would rather keep the disclosure
> decision entirely in the roleplay, drop J-vote-2 and the PBL section runs with
> one card — still better than none.

## `sore-throat-roleplay` — proposed vote cards (2)

**R-vote-1 — "She asks a second time, more firmly. What does your group commit
to?"**

- **No antibiotic, an explicit symptomatic plan, and clear return advice** ✅
  *Reveal:* Centor/McIsaac 0 with cough and coryza is viral. The defensible
  position is not "no" — it is "no, here is why, here is what will actually
  help, and here is when to come back".
- **Prescribe amoxicillin — she has a deadline and it keeps the relationship**
  *Reveal:* It ends the consultation faster and costs the patient the most:
  no benefit at this score, a rash if this turns out to be EBV, and the next
  sore throat starts from "last time I got antibiotics".
- **Give a delayed prescription without explaining it**
  *Reveal:* Delayed prescribing works when it is framed as a safety net. Handed
  over silently it reads as "the doctor thinks I'll need it", and it is filled
  the same day.

**R-vote-2 — "What do you do with the Friday presentation?"**

- **Treat it as the real problem and plan around it** ✅
  *Reveal:* Regular analgesia, fluids, voice care and realistic expectations
  for Friday address what she actually came for. Naming the deadline as
  legitimate is what makes the refusal land as care rather than obstruction.
- **Tell her work is not a medical indication**
  *Reveal:* True, and useless. It answers a question she did not ask and
  confirms that you were not listening.
- **Offer a sick note instead**
  *Reveal:* A reasonable option to have available, but offered *instead* of a
  plan it substitutes your priority for hers.
