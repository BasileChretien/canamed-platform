# CaNaMED Session 3 — Questionnaire template (LOCKED)

**Purpose.** Session 2's questionnaire shipped with corrupted Likert headers
(columns read "2".."18" instead of item labels), which made the satisfaction
analysis fall back to generic `Sat_Q1..Q18` labels. This document **locks** the
Session 3 instrument so the exported data is self-describing and the analysis
script is a near-mechanical adaptation of the prior pipeline.

**Do not renumber, reorder, or reword the 18 Likert items** between the form
and this document. If an item must change, change it in BOTH places in the same
commit and bump the `form_version` stamp below.

- `form_version`: **S3-v1** (2026-05-20)
- Scale: **5-point Likert** — `1 = Strongly disagree … 5 = Strongly agree`
  (render the verbal anchors on the form, not just numbers).
- Language: present each item in **English + French + Japanese** (the cohort is
  Franco-Japanese, mixed English confidence).
- Each Likert column header in the export MUST be the stable `id` below
  (e.g. `sat_pbl_format`), NOT a bare number.

---

## Section A — Satisfaction & self-efficacy (18 Likert items)

| # | id | Item (English) | Construct |
|---|----|----------------|-----------|
| 1 | `sat_pbl_format` | The problem-based learning format helped me learn. | PBL value |
| 2 | `sat_roleplay_value` | The roleplay made the clinical situation feel realistic. | Roleplay value |
| 3 | `sat_case_relevance` | The cases were relevant to my future practice. | Relevance |
| 4 | `sat_difficulty_right` | The level of difficulty was about right for me. | Calibration |
| 5 | `sat_time_adequate` | There was enough time to work through each module. | Pacing |
| 6 | `sat_group_mixed` | Working in a mixed Franco-Japanese group was valuable. | Cross-cultural |
| 7 | `sat_everyone_spoke` | Everyone in my group had a chance to contribute. | Equity |
| 8 | `sat_facilitator_support` | The facilitators supported the group without taking over. | Facilitation |
| 9 | `sat_platform_usable` | The online platform was easy to use. | Usability |
| 10 | `sat_language_ok` | I could take part fully despite the language mix. | Inclusion |
| 11 | `eff_history` | I feel more confident taking a focused history. | Self-efficacy: history |
| 12 | `eff_redflags` | I feel more confident screening for red flags. | Self-efficacy: safety |
| 13 | `eff_shared_decision` | I feel more confident making a shared decision with a patient. | Self-efficacy: SDM |
| 14 | `eff_breaking_badnews` | I feel more confident breaking bad news (SPIKES). | Self-efficacy: BBN |
| 15 | `eff_resist_pressure` | I feel more confident handling a patient request I should decline. | Self-efficacy: stewardship |
| 16 | `eff_cross_cultural` | I feel more confident discussing care across cultural differences. | Self-efficacy: culture |
| 17 | `att_evidence` | I will look for the evidence/guideline behind a decision more often. | Attitude: EBM |
| 18 | `att_recommend` | I would recommend this workshop to other students. | Net promoter |

**French / Japanese wording:** maintain a parallel `questionnaire_items_fr.md`
and `_ja.md`, or a single trilingual source, keyed by the same `id`. The `id`
is the contract; the displayed wording is localized.

---

## Section B — Open-ended questions (6, intact from Sessions 1–2)

Reuse the Session 1/2 text-analysis logic directly — keep these stable:

1. `open_pbl_format` — What did you think of the PBL format?
2. `open_roleplay` — What did you think of the roleplay?
3. `open_career` — How did this change your thinking about your career / practice?
4. `open_internship` — Would you consider an internship/exchange abroad? Why / why not?
5. `open_improve` — What would you improve about the workshop?
6. `open_final` — Any final thoughts?

---

## Section C — Volunteer recruitment item (Session 3 opener)

One additional free-text item recruits the student presenters for the Session 3
opening curriculum comparison (France vs Japan):

- `volunteer_curriculum_talk` — "Would you be willing to co-present a short
  comparison of the French vs Japanese medical curriculum at the next session?
  (leave your name/email if yes)"

---

## Data-collection checklist (so the analysis is mechanical)

- [ ] Export the questionnaire with **header = item `id`** (not a number).
- [ ] Include a `respondent_key` that matches the registration / pre-test /
      post-test name field (the "Rosetta Stone" join key), so satisfaction can
      be linked to knowledge gain per participant.
- [ ] Stamp every export with `form_version = S3-v1`.
- [ ] Likert values stored as integers `1–5`; blank = missing (do NOT code
      missing as `0`).
- [ ] Pre-test, post-test, questionnaire, and registration exported as separate
      files with the SAME respondent-key column name.
- [ ] Group-discussion docs named `Module_<A|B|C>_Group<n>.docx`.
- [ ] Transcripts exported in speaker + timestamp format (as Session 2), named
      `Room<n>_<slot>.docx`.
- [ ] Confirm the form template is **locked** (responses cannot edit the
      header row) before the session opens.
