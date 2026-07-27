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
