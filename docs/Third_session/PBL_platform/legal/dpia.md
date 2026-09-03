# Data Protection Impact Assessment — GDPR Art. 35

**CaNaMED PBL platform.** Created 2026-09-03. This is the DPIA whose absence
Annex VI **L11** of `dpa-draft.md` records as a HIGH gap.

---

> # ⚠️ DRAFT — NOT A COMPLETED DPIA, AND NOT LEGAL ADVICE
>
> A DPIA is the **controller's** document. This one was prepared with AI
> assistance from the verified facts in this repository, and two things Art. 35
> requires are structurally missing from it:
>
> - **Art. 35(2) — the DPO's advice has not been sought.** §6 sets out what to
>   ask; the answers are not here.
> - **Art. 35(9) — the views of data subjects have not been sought.** For a
>   platform whose subjects are students of the people running it, that is not a
>   formality: see risk **A1**.
>
> A DPIA is also not a document that is finished once. **The residual-risk
> determination in §8 and the Art. 36 decision in §9 are the controller's to
> make**, and until they are made this file assesses risk without accepting it.
>
> **What it IS good for:** every factual claim below is drawn from code, rules
> or workflows in this repository and cross-referenced, rather than from a
> template. Where a fact could not be established it says so.

---

## 1. Why a DPIA is required here

Not because of scale — the platform held four sessions at the date of writing.
Art. 35(1) turns on **high risk to the rights and freedoms of natural persons**,
and WP248 rev.01 treats **two or more** of its nine criteria as normally
requiring a DPIA. Four are met:

| WP248 criterion | How it is met here |
| --- | --- |
| **Sensitive data or data of a highly personal nature** | Free-text clinical reasoning, and a simulated-patient chat participants type into unprompted. The published notice relies on **Art. 9(2)(a)** for research use, so the controller has already characterised some of this as special-category data. |
| **Data concerning vulnerable data subjects** | Students, processed by their own educators. EDPB Guidelines 05/2020 treat that imbalance as the paradigm case. |
| **Innovative use of a technological solution** | A large language model plays a patient in a teaching exercise, with participant free text sent to it. |
| **Data transferred outside the EU** | Scheduled maintenance jobs execute on GitHub Actions runners in the United States (Annex III row #5); the language-model request passes through the Hugging Face router, whose processing location is `[TO VERIFY]`. |

A fifth, **evaluation or scoring**, is arguable: the platform scores clinical
reasoning and issues certificates. It is not a legal or similarly significant
effect within Art. 22, so it is not counted above — but it is why risk **C2**
exists.

**CNIL's list** of processing requiring a DPIA is not obviously triggered on its
face; the controller's DPO should confirm, since one entry concerns processing
of health data and another profiling of vulnerable persons.

---

## 2. Systematic description of the processing — Art. 35(7)(a)

Deliberately short, because the detail is maintained elsewhere and duplicating it
is how documents drift apart:

- **What is processed, by whom, for what** — `record-of-processing.md` §2
  (Art. 30(2), on a controller's behalf) and §2A (Art. 30(1), the operator's own
  research export).
- **Recipients and sub-processors** — `dpa-draft.md` Annex III.
- **Transfers and their mechanisms** — Annex IV, and §4 of the register.
- **Security measures** — Annex II; measures deliberately NOT implemented are
  Annex II §9.
- **Retention** — 30 days after a session closes, 90 after creation if never
  closed; research dataset up to 5 years after publication; **and a copy in the
  nightly archive for up to 90 days beyond the purge**, so the last identified
  copy of a closed session goes at roughly closure + 120 days (clause 2.8(b)).

**The lifecycle in one line:** a participant joins with a name, university, year
and English level; works in a room with 2–6 others; types free text into a
simulated-patient chat and into answer fields; votes; may download a certificate;
the session closes; the data is purged on the schedule above; and if they
consented, a pseudonymised copy enters a research dataset retained for five
years.

**Two purposes with different controllers.** Teaching delivery is carried out on
the facilitator institution's instruction. The **central research export is the
operator's own controllership** (Art. 28(10), elected at clause 2.6). A
participant therefore faces two controllers, which matters for every right in
§7 and is not currently explained to them.

---

## 3. Necessity and proportionality — Art. 35(7)(b)

| Question | Assessment |
| --- | --- |
| Is each data item necessary? | Name and university are necessary to run a cohort exercise and to issue a certificate. Year and English level drive room composition. Free-text answers **are** the pedagogy. **E-mail is the weakest**: it is collected in the roster and the platform's own mail function cannot currently run at all. |
| Could the purpose be achieved with less? | Partly. The research purpose does not require identified storage for five years — the notice says the dataset is kept **linked to the participant**, and the justification for identified rather than pseudonymised retention is not recorded anywhere. **This is a live proportionality question, not a settled one.** |
| Is the retention proportionate? | 30/90 days for live data is short and tied to the debrief window. The five-year research retention follows publication practice. The **90-day archive tail** is disclosed since PIS v10 but has never been argued as proportionate — it is an artefact of the backup schedule. |
| Has minimisation actually been done? | Yes, and it is evidenced rather than asserted: the retention purge and the storage monitor were rewritten to enumerate sessions shallowly, so **no scheduled job reads session bodies** any more (PIS v7). Two jobs previously copied the whole identified tree to a US runner daily. |
| Is the processing effective for its purpose? | Not assessed here. Whether the platform teaches better than the alternative is a pedagogical question, and a DPIA that answers it without evidence is padding. |

---

## 4. Lawful basis — the unresolved question this DPIA cannot settle

The published notice relies on **Art. 6(1)(a)** consent and **Art. 9(2)(a)**
explicit consent, with Art. 9(2)(j) also cited.

⚠️ **The workshop consent checkbox is a hard gate on the Join button** —
verified in `script.js`, `joinParticipant()` returns early if it is unticked.
Consent that must be given to take part in a curricular activity run by one's own
teachers is the textbook case in which "freely given" is doubted (Art. 4(11),
Art. 7(4), Recital 43; EDPB Guidelines 05/2020).

**This DPIA does not assert that the basis is invalid**, for the same reason
`dpa-draft.md` clause 3.6(a) and Annex VI Q3 do not: it depends on facts outside
the code — whether attendance is curricular or elective, what alternative exists
for a student who refuses, and the national implementation of Art. 6(1)(e) for
public universities. **It is the single most consequential open question about
this platform**, it is recorded as risk **A1**, and it must be answered by the
controller's counsel and DPO before a real cohort runs.

The **research** consent is in a better position: it is separately refusable,
joining does not depend on it, the export honours a refusal, and since 2026-09-03
a participant can withdraw it in the product.

---

## 5. Risks to the rights and freedoms of data subjects — Art. 35(7)(c)

Scored for the **data subject**, not for the project. Severity is the harm to a
participant; likelihood is of the harm, not of the event.

### A — Autonomy and control

**A1. Consent may not be freely given.** Students consent to processing by the
people who teach and assess them, through a checkbox that gates participation.
*Severity: HIGH* — if the basis fails, every downstream purpose loses its
justification, and a student who felt unable to refuse has lost control of health-
adjacent free text about their own reasoning. *Likelihood: not an event; a
characterisation.* **Status: OPEN — §4, Q3.** *Measures:* research consent is
genuinely optional and now withdrawable; the workshop gate is not.

**A2. A participant cannot exercise rights after leaving.** Anonymous
participants — most of them — have no account, so once they leave the session the
in-product withdrawal control is out of reach. *Severity: MODERATE. Likelihood:
LIKELY.* *Measures:* the notice names a human contact; the operator tools work
regardless. **Residual: accepted, and it must stay disclosed.**

### B — Confidentiality

**B1. ⚠️ The room gate is self-assertable — a participant can read another
room's simulated-patient chat.** `rooms/$roomId/uidMembers/$uid` can be claimed
by any authenticated user who knows the session code, with nothing checking they
were assigned there. A fix was decided on 2026-08-03 — bind the claim to the
participant's own `pool` assignment — **and has not been implemented**; verified
against the current rules while writing this DPIA. *Severity: HIGH* — the chat is
the most personal free text the platform holds, and the notice describes it as
room-private. *Likelihood: LOW* (requires intent and developer tools in a
supervised classroom) *but entirely available to a motivated classmate.*
**Residual: HIGH until fixed. This is the most actionable finding in this
document.**

**B2. Whole-session visibility of structured work.** Any session member can read
every room's scores, hypotheses and votes. *Severity: LOW* — intentional
classroom transparency, disclosed. **Accepted by design (Annex VI R1).**

**B3. The certificate registry is world-readable by exact id**, and the record
carries the **session code** as well as a name hash. *Severity: LOW* — ids are
crypto-random and unguessable. **Accepted (R2), but the open question of whether
the code needs to be in the payload at all is still open.**

**B4. GitHub Actions runners hold a Firebase admin credential** that bypasses
every database rule. The jobs read little; the credential could read everything.
*Severity: HIGH if realised. Likelihood: LOW.* **Accepted as R9 — and note the
acceptance is the Processor's; it closes only on the Controller's signature.**

### C — Fairness and accuracy

**C1. Free text survives pseudonymisation verbatim**, so the research dataset is
re-identifiable by anyone who knows a cohort. *Severity: MODERATE. Likelihood:
MODERATE.* **Annex VI R7; the dataset is also retained identified, see §3.**

**C2. Scored reasoning could affect standing.** The platform scores clinical
reasoning and the facilitator is the participant's teacher. *Severity: MODERATE.*
*Measures:* Module A scoring is formative and the notice says results do not
affect grades. ⚠️ **That claim is a promise about human behaviour, not a
technical control** — nothing in the platform prevents a facilitator using what
they see. It should be verified against what institutions actually tell students.

**C3. Inaccurate data could not be corrected** after a session closed. **Closed
2026-09-03** — `scripts/rectify-participant.js`. Residual: corrections do not
reach the nightly archive.

### D — The language model

**D1. A participant types real personal or clinical information into the chat.**
The prompt asks them to interview a simulated patient; nothing stops them
pasting something real. *Severity: MODERATE-HIGH. Likelihood: MODERATE over a
cohort.* *Measures:* server-side prompt guard; per-turn length cap; the chat is
purged with the session. ⚠️ **No content filter, and no warning at the input.**

**D2. The model produces distressing or clinically wrong output** in a health-
education setting. *Severity: MODERATE. Likelihood: MODERATE.* *Measures:* the
in-product disclosure states the patient is simulated; a facilitator is present.
**Not otherwise mitigated, and not currently monitored.**

**D3. The onward recipient of the chat is not fully established.** The request is
pinned to OVHcloud (France), but it passes through the Hugging Face **router**,
whose processing location is `[TO VERIFY]` and whose contract for this account is
**evidenced only by acceptance that has not been recorded** (clause 6.3 note (a)).
*Severity: MODERATE. Status: BLOCKING in Annex IV.*

### E — Transparency

**E1. The notice reaches participants in English only.** `t()` has rendered the
UI in English for everyone since 2026-06-25; `privacy.html` exists in EN/FR/JA.
A participant reading none of those three is not informed within Art. 12(1).
*Severity: MODERATE. Likelihood: LIKELY in a Franco-Japanese cohort.* **Annex VI
L7 — BLOCKING.**

**E2. The notice names the wrong controller.** It declares Caen and Nagoya joint
controllers, which contradicts the allocation in the DPA. **L1 — BLOCKING;
clause 5.4(a) prevents any session running under the DPA until it is fixed.**

**E3. Participants are not told there are two controllers** — the facilitator's
institution for teaching, the operator for the research export (§2). *Severity:
MODERATE.* **New, arising from the clause 2.6 election; not yet in the notice.**

### F — Children

**F1. The age position is self-contradictory and unverified.** **Annex VI L10 —
BLOCKING.** Medical students are ordinarily adults, which lowers likelihood but
does not resolve the inconsistency.

---

## 6. Consultation — Art. 35(2) and 35(9)

**The DPO's advice (Art. 35(2)) has not been sought.** It must be, and these are
the questions that actually need it, in order:

1. Is consent a valid basis for the workshop processing given the gate and the
   power imbalance (§4, A1)? If not, what replaces it?
2. Is identified five-year retention of the research dataset proportionate, or
   should it be pseudonymised at rest (§3, C1)?
3. Does the residual risk in §8 require **Art. 36 prior consultation** (§9)?
4. Is the accepted absence of an Art. 28 contract with GitHub (R9) acceptable to
   the controller, and on what conditions?

**The views of data subjects (Art. 35(9)) have not been sought.** ⚠️ Doing this
badly would be worse than not doing it: asking students, in class, whether they
mind their teachers processing their data reproduces the exact imbalance in A1.
If it is done, it should be anonymous, run by someone outside the teaching
relationship, and it should ask specifically whether they felt able to decline.

---

## 7. Measures already in place — Art. 35(7)(d)

Summarised; the detail is Annex II and the code it cites.

| Risk area | Measure |
| --- | --- |
| Access | Authentication required for every path; session-membership and per-room scoping in the database rules; administrator actions bound to a password proof that cannot be read back |
| Language model | Server-authoritative prompt guard; provider pinned to an EEA region; per-participant rate limits; no service-account key on the third-party host |
| Minimisation | No scheduled job reads session bodies; the purge and the storage monitor enumerate shallowly |
| Retention | Nightly purge on 30/90-day windows, interlocked with the backup so deletion cannot outrun archiving; lifecycle rules on the archive; a credential-expiry purge |
| Subject rights | In-product withdrawal (Art. 7(3)); operator tools for erasure (Art. 17) and rectification (Art. 16); a suppression list so a restore cannot resurrect erased data; a daily monitor that fails when a request passes the **Art. 12(3)** one-month limit |
| Transparency | A layered notice in three languages, versioned, with a changelog; guards that fail the build when the published retention period stops matching the enforced one |
| Accountability | Records of processing under Art. 30(1) and 30(2); a sub-processor annex; an accepted-risk register with review triggers |

⚠️ **What is deliberately NOT mitigated** belongs here too, or the table is
marketing: App Check is in *Monitor* rather than *Enforce* (R5), so attestation
is observed and not required; Module A scoring is client-writable within bounds
(accepted for formative use); and the room gate in **B1** is not fixed.

---

## 8. Residual risk — for the controller to determine

**This section is deliberately unsigned.** The Processor's view, offered as
input:

| | |
| --- | --- |
| Risks reduced to low by the measures in §7 | B2, B3, C3, and the erasure/rectification limbs of A2 |
| Risks that remain **HIGH** | **A1** (basis), **B1** (room gate), **E1/E2** (transparency), **B4** (admin credential + no Art. 28 contract) |
| Risks that are **accepted and disclosed** | B2, B3, B4 (as R9), A2's anonymous-participant limb |

**The honest summary: residual risk is not low today.** Four BLOCKING Annex VI
items bear directly on the risks above, and clause 5.4(a) already prevents
processing under the DPA until every BLOCKING row is closed. A DPIA that
concluded "risk is acceptable" while that clause stands would be contradicting
the contract it sits beside.

---

## 9. Art. 36 prior consultation — a decision, not a formality

Art. 36(1) requires consultation with the supervisory authority (CNIL, and for
Japan the PPC's own route) where a DPIA indicates the processing **would result
in a high risk in the absence of measures taken to mitigate it**.

**The Processor's reading:** the measures in §7 are substantial and most risks
are mitigated, but **A1 is not a risk that measures address** — if consent is not
freely given, no security control repairs it — and **B1 is unmitigated today**.

⚠️ **Two of the accepted items make this a real question rather than a
rhetorical one.** An accepted absence of an Art. 28(3) contract (R9), combined
with a credential that grants total access to the identified database, is exactly
the shape of thing a supervisory authority expects to be consulted about — or, at
minimum, to find fully documented if it asks.

**Recommendation:** do not consult yet. Fix **B1**, close **L1/L2/L7/L10**, and
obtain the DPO's position on **A1**. Then re-run §8. If A1 is resolved by moving
to Art. 6(1)(e) and B1 is fixed, prior consultation is very unlikely to be
required. If consent is retained *and* the DPO cannot conclude it is freely
given, consultation becomes the conservative course.

**This is a recommendation from the Processor. The decision is the controller's,
and it must be recorded here with a date and a name.**

[CONTROLLER — ART. 36 DETERMINATION: ____ ] [DATE: ____ ] [BY: ____ ]

---

## 10. Sign-off and review

| Role | Name | Date | Signature |
| --- | --- | --- | --- |
| Controller | [ ____ ] | [ ____ ] | [ ____ ] |
| Data Protection Officer (Art. 35(2)) | [ ____ ] | [ ____ ] | [ ____ ] |
| Processor / platform operator | [ ____ ] | [ ____ ] | [ ____ ] |

**Review this DPIA when any of these happens** — Art. 35(11) requires review
where the risk changes:

1. **Before the first real-participant cohort.** Every acceptance in this
   document and in Annex VI is calibrated to a pre-pilot platform holding four
   sessions.
2. A change of lawful basis, or a DPO position on **A1**.
3. **B1 being fixed** — it is the largest single reduction available.
4. A new sub-processor, a new transfer, or the loss of a transfer mechanism
   (`tests/github-dpf-currency.test.js` flags the DPF renewal 90 days ahead).
5. A change to what the language model receives, or to the provider pin.
6. Any personal-data breach.

⚠️ **A DPIA that is never revisited is worse than none**: it converts a snapshot
into a permanent claim. Nothing in this repository will remind anyone to reread
it — unlike the retention, DPF and key-expiry guards, this document has no test
behind it, and it cannot have one, because the judgements in §8 and §9 are not
derivable from code.
