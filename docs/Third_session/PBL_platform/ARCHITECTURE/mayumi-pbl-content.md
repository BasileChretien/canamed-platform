# "A Difficult Child (Mayumi)" — the Nagoya PBL No. 57 as six sections

**Status: BUILT 2026-09-07 (shell v167), content AWAITING CLINICAL REVIEW by
Dr Branko and the Nagoya tutors.** Source: `mayumi-seed.js`. Registered as six
PBL-only sections (`mayumi-1-pbl` … `mayumi-6-pbl`) in `section-registry.js`,
loaded by `script-loader.js` after the branched seed, precached by `sw.js`.

## Where it came from

| source | role |
| --- | --- |
| Nagoya tutor handout (EN) + the Nagoya CAP psychiatrists' comments | primary — facts, teaching text, the differential additions |
| Five student handouts (initial information, S1-1, S1-2, S2-1, S2-2) | primary — the reveals, the lab table, the MFQ (a filled form, as an image) |
| Dr Branko's standalone app, `electron/data/case.js` | secondary — the six-step encoding, personas, the MFQ item by item |

Where the two disagree the handout wins: the SSRI started was **escitalopram**
(the app said fluoxetine). The facilitator card notes both are defensible.

## The mapping, reveal by reveal

| section | handout reveal | who is in the room | exam / labs tab | vote(s) |
| --- | --- | --- | --- | --- |
| 1 Initial information | Initial information (pre-reading) | father, mother | — | meet Mayumi alone first |
| 2 Chief complaint and the interview plan | Chief complaint; "not much changes" | father, mother | — | the differential barely changes |
| 3 The home visit | Session 1 / Part 1 | Mayumi, father, mother | — | the alcohol-to-sleep response |
| 4 Examination and the MFQ | Session 1 / Part 2 | all three | 6 exam items; MFQ item by item, 33/66 | what the MFQ establishes; which tests |
| 5 Investigation results | Session 2 / Part 1 | all three | FBC, CRP, Monospot, glucose, TSH/FT4, ferritin/B12/folate/D, MRI, EEG | the leading diagnosis |
| 6 Management and outcome | Session 2 / Part 2 | all three (Mayumi recovered; the mother can disclose) | — | treatment plan; the mother |

Facts are **cumulative**: section n's history is section n-1's plus the new
reveal, so the LLM characters never leak a later reveal and never forget an
earlier one. Every fact is owned by a character (`who`); a fact both parents
share is `who: ["father", "mother"]`. Mayumi is declared in every section
(the platform needs one index patient) but `present: "onCue"` in 1 and 2, so
the switchboard does not offer her and the chat opens on the father.

## What was deliberately NOT ported

- **The 0–100 per-step LLM score.** The original tutorial grades the group
  qualitatively on the quality of its discussion; the score was the app's
  addition. Here each rubric line became a deterministic keyword family, some
  with `askOf` (a family history taken from the mother earns; the same words
  at Mayumi do not), and the transcript reaches the facilitator for debrief.
- **The narrator.** Exam findings, the MFQ and the results live in the
  Examination and Investigations tabs, where ordering them is itself scored.
- **The MFQ image.** The filled form is transcribed item by item from the
  app's encoding (which was made from the image); the PBL section type has
  no document slot today.
- **The CBT video** (a Nagoya NUSS link) is referenced in section 6's prompts
  for the tutor to show; it is not embedded.

## Review checklist for the clinical authors

Tick, correct in `mayumi-seed.js`, or annotate here.

- [ ] **Personas** (three, plus Mayumi-recovered and the mother-later
  variants): tone and the disclosure rules — the mother only volunteers her
  own history when asked kindly; Mayumi shuts down if lectured.
- [ ] **Facts**: every `a` line traces to a handout sentence or an MFQ item.
  Two are framing only: section 5's "how did the tests go for you" and
  section 6's "how is Mayumi now", both paraphrases of S2-2.
- [ ] **Synthesis texts** (the `labs[0]` item per section; these become the
  take-home write-up).
- [ ] **Chat scoring families**: stems, points, `askOf`. Three penalties:
  naming a diagnosis to the parents before meeting Mayumi (1), lecturing or
  blaming Mayumi (3), "there is nothing wrong with you" (5).
- [ ] **Votes**: the correct option and each `why`.
- [ ] **Knowledge checks** (4 pre + 4 post per section, 48 items): every one
  is answerable from the tutor handout's teaching text. Registry floor is 4.
- [ ] **Escitalopram vs fluoxetine** — keep the handout's drug, or change it.
- [ ] **Prompts** — the tutor questions, re-cut per section.

## Live feedback, 2026-09-07 (first session) — addressed

- The lobby agenda printed each step's long description: `summary` is now one
  line per step and the long text is the step's `vignette` (the "patient in
  front of you" card).
- The card, the shared-chart note, the workup buttons and the reference
  panels showed the DEFAULT case (Mr Lefebvre): an engine bug for every
  multi-section session, fixed in `applySectionContent()`. The six steps now
  carry `references` (history / guidelines / recap) drawn from the tutor
  handout's background reading.
- The picker: "select Mayumi's case, then the parts for today" — the six
  steps share `caseId: "mayumi"` and the create form is case-first.
- The reply is typed out word by word after it arrives.

## Engine changes made for this content

- `who` may be an **array** of character ids (prompt builder and stub).
- When the index patient is not offered in a step, the chat opens on the
  **first offered character** rather than a missing patient (init).
- Both landed with this content; see `tests/mayumi-content.test.js` and
  `tests-e2e/mayumi-session.spec.js`.

## Running it

Create a session, add the six sections in order (they are listed in reveal
order in the picker), start, and advance one section per reveal. Sections 1–3
are the tutorial's first core-time session, 4–6 the second.
