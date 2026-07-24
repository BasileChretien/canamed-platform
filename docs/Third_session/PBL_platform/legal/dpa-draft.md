# Data Processing Agreement (DPA) — DRAFT

**CaNaMED PBL platform — facilitator (controller) × platform operator (processor)**

---

> # ⚠️ UNREVIEWED DRAFT — DO NOT SIGN, PUBLISH OR RELY ON THIS DOCUMENT
>
> **This document was prepared with AI assistance and has NOT been reviewed by a
> lawyer.** It is a working draft intended to give qualified counsel and the
> institution's Data Protection Officer a factual starting point. It is **not**
> legal advice and it is **not** an executable contract.
>
> **Before this document is used, signed, sent to a counterparty, or relied on in
> any way, it must be reviewed and approved by:**
>
> 1. qualified legal counsel competent in EU/French data protection law (GDPR);
> 2. qualified legal counsel competent in Japanese data protection law (APPI);
> 3. the Data Protection Officer of the controlling institution;
> 4. wherever the processing supports research, the responsible ethics committee.
>
> Every `[BRACKETED SLOT]` is a fact only the institutions can supply. Every
> `[TO VERIFY]` marks something that could **not** be confirmed from the platform
> source code and must be checked against the live system or a vendor contract
> before anyone asserts it. Do not delete these markers by guessing.
>
> **This draft is not in a signable state.** Annex VI lists **eighteen BLOCKING
> items**, at least one of which (G1) describes processing that appears to be
> happening today without the basis the platform's own notice promises. Clause 5.4
> makes every BLOCKING item a condition precedent: signature is legally
> ineffective until they are closed and countersigned.
>
> **Also note (technical):** this file lives inside the Firebase Hosting public
> directory (`firebase.json` sets `"public": "."` and its `ignore` list excludes
> only `README.md`, not `*.md`). If the site is deployed as-is, **this draft will
> be served publicly** at `/legal/dpa-draft.md`. Add an ignore entry, or move the
> file outside the hosting root, before the next deploy.

---

## Document control

| Field | Value |
|---|---|
| Status | **Unreviewed AI-assisted draft — NOT SIGNABLE** |
| Draft date | 2026-07-23 |
| Codebase this draft describes | worktree `canamed-platform-selfserve`, branch `main`, HEAD `4e32585` |
| Version | 0.2-draft |
| Owner | [CONTROLLER DPO NAME AND CONTACT] |
| Next step | Close the BLOCKING items in Annex VI, then legal + DPO review |

---

## Table of contents

| | |
|---|---|
| [Defined terms](#defined-terms) | Plain-language glossary |
| [Reader's summary](#readers-summary-plain-language) | What this document does, and the three things to read first |
| [Before you sign](#before-you-sign--conditions-precedent-at-a-glance) | The BLOCKING items, listed up front |
| [1. Parties](#1-parties) | Who is who |
| [2. Roles of the Parties](#2-roles-of-the-parties) | Controller / processor allocation, and where it breaks |
| [3. The Controller's instructions](#3-the-controllers-instructions) | What the Controller can and cannot instruct |
| [4. Confidentiality](#4-confidentiality) | Who may touch the data |
| [5. Security of processing](#5-security-of-processing-gdpr-art-32) | Art. 32 measures; conditions precedent |
| [6. Sub-processors](#6-sub-processors-gdpr-art-282-and-284) | Google, Hugging Face, GitHub, SMTP |
| [7. Data subjects' rights](#7-assistance-with-data-subjects-rights-gdpr-art-283e) | What the platform can actually do |
| [8. Other assistance (DPIA)](#8-assistance-with-the-controllers-other-obligations-gdpr-art-283f) | DPIA, prior consultation |
| [9. Personal data breaches](#9-personal-data-breaches-gdpr-art-332-appi-art-26) | Notification, incl. the APPI Art. 26(1) proviso |
| [10. Deletion and retention](#10-deletion-or-return-of-data-at-the-end-of-processing-gdpr-art-283g) | Schedules, and what is never deleted |
| [11. Audit and information](#11-audit-and-information-rights-gdpr-art-283h) | What can be inspected |
| [12. International transfers](#12-international-transfers) | EU ↔ Japan ↔ US |
| [13. Liability, term, general](#13-liability-term-and-general-terms) | Boilerplate |
| [Annex I](#annex-i--description-of-the-processing) | What data, about whom |
| [Annex II](#annex-ii--technical-and-organisational-security-measures-gdpr-art-32) | Security measures as implemented |
| [Annex III](#annex-iii--authorised-sub-processors) | Sub-processor list |
| [Annex IV](#annex-iv--international-transfer-mechanisms) | Transfer routes and mechanisms |
| [Annex V](#annex-v--appi-specific-provisions-japan) | Japan-specific provisions |
| [**Annex VI**](#annex-vi--disclosed-limitations-and-known-gaps) | **Disclosed gaps — read before signing** |
| [Open questions](#open-questions-and-drafting-rationale) | Where reviewers disagreed, and why this text says what it says |

---

## Defined terms

Plain-language explanations of the jargon used below. These are reading aids, not
legal definitions.

| Term | What it means here |
|---|---|
| **Controller** | The organisation that decides *why* and *how* personal data is used. Under this DPA, the facilitator's institution. |
| **Processor** | The organisation that handles the data *for* the controller, following its instructions. Here, the platform operator. |
| **Sub-processor** | A company the processor uses to do part of the job (Google, Hugging Face, GitHub). |
| **Entrustment (委託)** | The Japanese-law equivalent of "processor": handling personal data on someone else's behalf under their supervision. |
| **Joint use (共同利用)** | A different Japanese-law arrangement where two organisations share data as equals. Not what this DPA describes. |
| **Adequacy decision** | An EU decision that another country protects data well enough that no extra paperwork is needed to send data there. Japan has one; the US does not. |
| **SCCs** (Standard Contractual Clauses) | A standard EU contract that legalises sending data to a country without an adequacy decision. Must be signed *before* the first transfer. |
| **DPIA** | Data Protection Impact Assessment — a written risk assessment required for higher-risk processing. |
| **ROPA** | Record of Processing Activities — the register every controller and processor must keep (GDPR Art. 30). |
| **Transfer impact assessment (TIA)** | The extra analysis you must do, on top of SCCs, of whether the destination country's laws (e.g. government access) undermine the protection. |
| **Flow-down** | Passing your own contractual obligations down to your sub-contractors. |
| **Proof-write** | The trick this platform uses to check a facilitator password without ever letting a browser read the stored hash: the browser writes its candidate, and the database rule accepts the write only if it matches. |
| **保有個人データ** | Under APPI, personal data the operator has authority to disclose, correct or stop using — the data individual rights attach to. |
| **仮名加工情報 / 匿名加工情報** | Two distinct APPI categories of processed information (pseudonymously processed / anonymously processed), each with its own rulebook. Neither is the same as GDPR "pseudonymisation". |
| **Condition precedent** | Something that must happen before the contract takes effect at all. |
| **The offer** *(clause 3.3)* | The fixed set of configuration choices the platform actually supports — what the Controller can pick from. |

---

## Reader's summary (plain language)

The CaNaMED platform lets a teacher (a "facilitator") run a problem-based
learning session for medical students. Students type their names, their
university, their clinical reasoning, their votes, their questionnaire answers,
and they hold a free-text conversation with a simulated patient powered by a
language model. All of that is personal data.

This agreement says who is responsible for what:

- The **facilitator and their institution decide** why and how that data is
  collected — they are the **controller**.
- The **platform operator runs the software** on the facilitator's instructions
  — it is the **processor**. It does not use participant data for advertising or
  product analytics. It *does* reserve controller status for a few narrow things
  of its own (security logs, staff/facilitator accounts, the public certificate
  registry, the language-model usage log) — see clause 2.4.
- Some parts of the processing use other companies (Google, Hugging Face,
  GitHub, and an email provider if enabled). They are **sub-processors**, and
  they are listed in Annex III.

> ### ⚠️ Before you sign — three things this summary must not hide
>
> 1. **What a student types to the AI patient leaves the EU.** It is processed
>    in the United States (Google `us-central1`), then passed to Hugging Face,
>    then to a third-party inference company **that changes from one message to
>    the next**. No transfer contract for that leg is evidenced anywhere
>    (Annex IV). The feature is currently **on by default** for every session.
> 2. **Several categories of student data are never deleted.** Participant
>    email rosters, certificate records, the AI usage log, account profiles,
>    authored scenarios, and everything under the `orgs/` tree have no automated
>    deletion at all (Annex VI, G5–G9). Deleting a session does not reach them.
> 3. **This platform is not ready to run with real students under this DPA
>    until the BLOCKING items in Annex VI are closed.** One of them (G1) is not
>    a paperwork gap: the nightly research export includes participants who
>    ticked the workshop box but *declined* research, contradicting what the
>    live notice promises them.

Annex VI is the most important part of this document: it lists the places where
the platform **does not yet do what this agreement promises**. Those gaps are
disclosed on purpose. Clause 5.4 turns the BLOCKING ones into conditions
precedent — the agreement does not take effect until they are closed.

---

## Before you sign — conditions precedent at a glance

These are the Annex VI items marked **BLOCKING**. Clause 5.4 makes signature
ineffective until each is closed and countersigned. Full text in Annex VI.

**Things participants are told that are not true (legal text)**

| # | In one line |
|---|---|
| L1 | The live notice names Caen + Nagoya as joint controllers, not the facilitator's institution. |
| L2 | `compliance.html` — the page a reviewing DPO reads first — carries several claims that the code contradicts. |
| L3 | The notice says session data is purged in **7 days**; the job purges at **30/90 days**. |
| L4 | The language model, Hugging Face and the US transfer appear **nowhere** in the notice. |
| L5 | The French and Japanese notices state a different legal basis, a different retention period, and a consent checkbox that does not exist. |
| L6 | Hard-coded fallback text in the page calls identified data "pseudonymised" and "anonymous". |
| L7 | The consent and join screens render **in English only**, whatever language the participant picks. |
| L8 | The data-use notice is **collapsed on every viewport**, yet the required checkbox says "I have read the data-use notice above". |
| L9 | The Japanese notice cites APPI articles that do not say what it claims (including one that does not exist). |
| L10 | The notice says "adults 18+" and simultaneously tells under-16s and under-20s to contact the facilitator. There is no age gate. |

**Things the code does or fails to do (functional)**

| # | In one line |
|---|---|
| G1 | The nightly research export ignores the research-consent flag entirely — it exports **every** participant of every closed session, and builds a real-name linkage table for all of them. |
| G2 | Knowledge-test scores and the 2,000-character wrap-up free text are readable by **every other participant** in the session. |
| G3 | Session metadata — including the facilitator's name and the **entire authored scenario** (up to 262,144 characters) — is readable by **any authenticated user of the platform**, not just session members. |
| G4 | For Japan-resident participants, the language-model leg has no identified APPI Art. 28 basis and the consent UI contains no foreign-transfer consent element. |
| G9 | The whole `orgs/` tree is outside retention, backup and pseudonymisation. |

Plus the international-transfer gap in Annex IV (EEA → Hugging Face: **no
mechanism identified**), which clause 12.6 turns into a default-off requirement.

---

## 1. Parties

**The Controller**

| | |
|---|---|
| Legal entity | [CONTROLLER LEGAL ENTITY — full registered name] |
| Registered address | [CONTROLLER REGISTERED ADDRESS] |
| Represented by | [CONTROLLER SIGNATORY NAME AND ROLE] |
| Data Protection Officer | [CONTROLLER DPO NAME, EMAIL, POSTAL ADDRESS] |
| Lead supervisory authority | [CONTROLLER LEAD SUPERVISORY AUTHORITY — e.g. CNIL (France), or the authority of the establishment's Member State] |
| APPI status | [SELECT: 個人情報取扱事業者 (ordinary personal-information handling business operator) / a public body brought under the private-sector chapter of APPI — e.g. a national university corporation — [TO VERIFY the governing article and its current numbering with Japanese counsel] / other: ____ ] |
| 学術研究機関等 status (APPI Art. 16(8)) | [YES / NO. This is an **institutional attribute, not an election** — the APPI research carve-outs in Arts. 18(3), 20(2) and 27(1) are available only to an academic research institution. A hospital, private training body or professional society does **not** qualify.] |
| If NO above | [CONFIRM that no reliance is placed on any APPI academic-research exemption, and state the basis relied on instead.] |

**The Processor**

| | |
|---|---|
| Legal entity | [PROCESSOR LEGAL ENTITY — full registered name of the body operating Firebase project `canamed-69785`] |
| Registered address | [PROCESSOR REGISTERED ADDRESS] |
| Represented by | [PROCESSOR SIGNATORY NAME AND ROLE] |
| Privacy contact | [PROCESSOR PRIVACY CONTACT MAILBOX] |
| Data Protection Officer | [PROCESSOR DPO — IF ONE IS APPOINTED; state "none appointed" if not] |
| Security contact | `canamed-security@unicaen.fr` (as published in the operator policy) — [CONFIRM this mailbox is monitored and correct for a third-party facilitator] |
| APPI status | [SELECT as for the Controller above] |

Together, the "**Parties**".

> **Draft note.** The platform is currently operated inside Firebase project
> `canamed-69785`, whose live public URL is `https://canamed-69785.web.app`
> (verified in `firebase-config.js`). If the intended processor is not the same
> legal entity that owns that Google Cloud project, that has to be resolved
> before signature — the processor must actually control the infrastructure it
> is contracting to secure.

---

## 2. Roles of the Parties

2.1 The Parties agree that, for the processing described in **Annex I**, the
Controller is the **controller** within the meaning of GDPR Art. 4(7), and the
Processor is the **processor** within the meaning of GDPR Art. 4(8).

2.2 The Controller determines the purposes and means of the processing. In
particular the Controller decides: whether to run a session at all; which
scenario is used and therefore what clinical subject matter students discuss;
which participants are invited; what the participants are told; whether a
research purpose is pursued and on what legal basis; and how long data is kept
within the ranges the platform supports.

2.3 **No secondary use — as a covenant, not a warranty of present fact.** The
Processor shall not use participant personal data for its own purposes, for
product analytics, for advertising, or for training or evaluating
machine-learning models, and shall not permit any sub-processor it engages to do
so. **Disclosed limitation:** for the language-model leg the Processor cannot
today *verify* that undertaking downstream, because Hugging Face's router selects
the inference company per request (clause 6.4). Until clause 6.4 is resolved, the
no-training commitment binds the Processor and (once contracted) Hugging Face,
but the Processor makes **no representation** about the downstream providers.
See Annex VI, item G4 and Annex IV.

2.4 **Where the Processor acts as a controller — expanded.** The following are
**not** processed on the Controller's behalf and are outside this DPA. Each needs
its own legal basis, its own participant-facing information, and its own
retention rule, which the Processor must supply:

| Dataset | Why it is not the Controller's | Status |
|---|---|---|
| Operational security and abuse-prevention logs | Processor's own security interest | Processor as independent controller |
| Facilitator / scenario-author accounts (`users/{uid}/profile`, authored scenarios) | Created by the individual for themselves | Processor as independent controller |
| **Certificate registry (`credentials/<certId>`)** | World-readable **without authentication**, outlives the session, served by the operator's own public verification page. It is not the facilitator's to control or delete. | **[FOR COUNSEL: this may be GDPR Art. 26 joint controllership. If so, an Art. 26 arrangement is needed and its essence must be made available to participants.]** |
| **Language-model usage log (`metrics/hfPatient/*`)** | Records auth UID + session code per turn, on a path with no database rule, for the operator's own cost/abuse monitoring. Not reachable by any in-product access flow. | **[TO CLASSIFY — processor-held or operator-controlled. Whichever is chosen, it must appear in the Art. 15 runbook (clause 7.6) and acquire a retention rule.]** |
| **Visitors to the public certificate-verification page (`verify.html`)** | Certificate verifiers (employers, registrars) are **not** participants and have no relationship with the facilitator. The page loads the Firebase SDK from `www.gstatic.com`, disclosing the visitor's IP address to Google, with no notice. | **[TO ALLOCATE — no role is assigned to this processing today.]** |
| **The nightly identified backup and the pseudonymised research export** | See clause 2.6. | **[TO RESOLVE — see 2.6]** |

2.5 **Conflict with the live privacy notice — must be resolved before
signature.** The privacy notice currently served by the platform
(`privacy.html` §1) states that the platform "is run jointly by" Université de
Caen Normandie and Nagoya University as **joint controllers** under GDPR Art. 26
and 共同利用 under APPI Art. 27(5), with Caen's DPO as the single rights contact.
The same framing appears in the join-screen string `lobby.privacy.p1`
(`i18n.js`). That statement contradicts the controller/processor allocation in
this DPA. Participants must not be shown a notice that names a different
controller from the one that is actually responsible. The notice, the join-screen
strings, and the consent-version string (`PIS v2 · 2026-05`, hard-coded in
`i18n.js` and `index.html`) must be updated to reflect this allocation, and the
Controller must be able to reference **its own** notice and version. See
Annex VI, item L1. (`compliance.html` carries no controller allocation at all,
but has its own defects — see Annex VI, item L2.)

2.6 **Art. 28(10) risk — the operator determines a purpose of its own.** GDPR
Art. 28(10) converts a "processor" that determines the purposes or the essential
means of processing into a **controller by operation of law**, whatever the
contract says. Two features of the platform put this DPA's allocation at risk:

- **(a) The central research export.** `scripts/pseudonymise-export.js` runs on
  the *operator's own* daily schedule (03:47 UTC), over **every closed session**
  of **every facilitator**, and produces both a research dataset and a real-name
  → pseudonym linkage table. That is the operator pursuing a research purpose, not
  executing one controller's instruction.
- **(b) Essential means the Controller cannot set.** Retention periods,
  the sub-processor set, the hosting region and the data model are properties of
  a single shared deployment (clause 3.3). Under EDPB Guidelines 07/2020 these
  are *essential means*, reserved to the controller.

**Required resolution before signature — the Parties must choose one:**

1. **Carve the export out.** Document the operator as an **independent
   controller** for the research export, with its own GDPR Art. 6 / Art. 9 basis,
   its own Arts. 13–14 notice, its own retention, and (for Japan) its own
   Art. 27/28 analysis under Annex V.10. This DPA then covers only session
   delivery; **or**
2. **Stop the central export** and run exports only on a specific written
   Controller instruction, scoped to that Controller's own sessions; **or**
3. **[ALTERNATIVE PROPOSED BY COUNSEL: ____ ]**

Independently of the choice, the essential-means problem in (b) is addressed by
making retention, language-model enablement and sub-processor scope
**per-session parameters** — see clause 3.3 and Annex VI, item G10.

---

## 3. The Controller's instructions

3.1 The Processor processes personal data only on the Controller's documented
instructions, including for transfers to a third country, unless required to do
otherwise by EU/Member State or Japanese law — in which case the Processor
informs the Controller of that legal requirement before processing, unless the
law prohibits it on important grounds of public interest (GDPR Art. 28(3)(a)).

3.2 **What counts as the instruction.** The Controller's initial documented
instruction is: *operate the CaNaMED platform in its standard configuration, as
described in Annex I and Annex II, so the Controller can run teaching sessions
and — where the Controller has established a valid basis — the associated
educational research.* Configuration choices the Controller makes in the product
(creating a session, choosing the scenario, opening or closing the session,
enabling or disabling the language-model character, exporting data) are
instructions.

3.3 **What the Controller can actually configure — "the offer".** The following
is the complete set of controller-configurable parameters at the draft date.
Anything not on this list is a property of the shared deployment and cannot be
instructed without a written change to this DPA.

| Parameter | Configurable today? | Where |
|---|---|---|
| Whether to run a session; when to open/close it | **Yes**, per session | Product |
| Which scenario (built-in, authored, or shared) | **Yes**, per session | Product |
| Session label, rooms, roles, observers | **Yes**, per session | Product |
| Whether a knowledge test / questionnaire runs | **Yes**, per session | Product |
| Export of that Controller's own session data | **Yes** | Admin dashboard |
| Whether the language-model character runs | **No — deployment-wide only** (`MODA_LLM_ENABLED`) | Cloud Functions env |
| Retention period for closed / abandoned sessions | **No — deployment-wide only** (`CLEANUP_RETENTION_*_DAYS`) | Workflow env |
| Hosting region, sub-processor set, data model | **No** | Fixed |
| Participant-facing notice text and version string | **No — hard-coded** (`PIS v2 · 2026-05`) | `i18n.js`, `index.html` |

**Stated plainly:** on the three parameters a DPO is most likely to want changed
— the language model, the retention period, and the notice — the Controller's
only real instruction today is **"run" or "stop"**. The Processor cannot honour
one Controller's instruction to disable the language model or shorten retention
without imposing it on **every other facilitator** on the same deployment, and a
processor that cannot execute one controller's documented instruction without
breaching another's is not in a position to give unqualified Art. 28(3)(a)
undertakings. Making these per-session is a condition precedent (Annex VI, G10):
`llmEnabled`, `retentionClosedDays` and `retentionOpenDays` become values in the
session record; `cleanup-stale-sessions.js` reads the per-session value with the
environment variable as a **ceiling**; `hfPatient` checks the session flag before
calling any provider.

3.4 Further instructions must be given in writing to [PROCESSOR PRIVACY CONTACT
MAILBOX]. The Processor may charge reasonable, pre-agreed costs for instructions
that require development work: [FEES — IF ANY; state "no fees" if none].

3.5 The Processor immediately informs the Controller if, in its opinion, an
instruction infringes GDPR, APPI, or other applicable data protection law
(GDPR Art. 28(3), final paragraph). The Processor may suspend the affected
processing until the instruction is withdrawn or amended.

3.6 **Controller warranties — lawful basis, information, age, sensitive data.**

(a) **Lawful basis.** The Controller warrants that it has identified and
documented a valid legal basis for each purpose, and has recorded it here:

| Purpose | GDPR basis | APPI basis |
|---|---|---|
| Teaching delivery | [Art. 6(1)(__) ] | [ ____ ] |
| Research use (if any) | [Art. 6(1)(__) + Art. 9(2)(__) ] | [ ____ ] |
| Certificate issue / verification | [Art. 6(1)(__) ] | [ ____ ] |

> **[FOR COUNSEL — the consent question, flagged not decided.]** The platform
> today obtains **consent** for both workshop and research use, and the live
> notice relies on GDPR Art. 6(1)(a) + Art. 9(2)(a). Verified in the code:
> the workshop checkbox (`consent-workshop`) is a **hard gate on the Join
> button** — `joinParticipant()` in `script.js` returns early and refuses to
> join if it is unticked. A reviewer of this draft argued that consent obtained
> this way, in a teacher-run curricular activity, cannot be "freely given"
> (GDPR Art. 4(11), Art. 7(4), Recital 43; EDPB Guidelines 05/2020 on the
> imbalance of power), and that the processing therefore has no valid basis
> today. **This draft does not assert that conclusion** — it is a legal
> judgement for the Controller's counsel and DPO, not something the source code
> can settle. But the Controller must reach a documented position on it before
> signature, and if consent is retained, must be able to show that refusing is
> genuinely possible and consequence-free. A commonly proposed alternative is:
> teaching delivery by a public university on **Art. 6(1)(e)** (public task);
> research on **Art. 6(1)(e) + Art. 9(2)(j)** with Art. 89 safeguards under the
> applicable national research framework; and the mandatory checkbox relabelled
> to what it actually attests ("I have read the data-use notice"), with genuine,
> refusable opt-in consent reserved for the optional research use.

(b) **Information duties.** The Controller warrants that it has given
participants the information required by GDPR Arts. 13–14 — including
**recipients** (Art. 13(1)(e)), **third-country transfers** (Art. 13(1)(f)) and
**retention** (Art. 13(2)(a)) — in a form intelligible to them (Art. 12(1)), and
the information required by APPI Arts. 21 and 32. **The Controller cannot
discharge this today using the platform's own notice**: see Annex VI, L1–L10.

(c) **APPI Art. 32(1) publication — a Controller duty the platform cannot
discharge.** Each Controller must itself make available its **own** Art. 32(1)
items for its 保有個人データ: entity name, address and representative; the
purposes of use; the procedure for disclosure / correction / cessation requests;
the complaint contact; and the security control measures taken (which PPC
practice treats as including the **foreign countries** where data is handled — see
Annex V.3-bis). A single platform-served `privacy.html` cannot do this for an
arbitrary self-serve facilitator. The Controller shall publish its own Art. 32(1)
statement at [CONTROLLER ART. 32(1) STATEMENT URL] and reference it on the join
screen. (This also supplies the controller-specific text that Annex VI, L1
requires.)

(d) **Sensitive personal information (APPI Art. 20(2)).** The Controller warrants
that, before any free-text field is opened to a Japan-resident participant, it has
either obtained prior consent satisfying Art. 20(2) to the **acquisition** of
要配慮個人情報, or is an 学術研究機関等 (clause 1) and the handling is necessary
for academic research purposes. Art. 20(2) is an **acquisition prohibition**, not
a balancing test — there is no legitimate-interest route. The consent UI provides
no Art. 20(2) element today (Annex VI, item L9 / G4).

(e) **Age.** The Controller warrants that no participant is below the applicable
national age threshold, or that verified parental authorisation has been obtained.
**The platform has no age gate.** The live notice says "adults 18+" and, in the
same section, tells anyone "under 16 (GDPR Art. 8) or under 20 (Japanese
university norms)" to contact their facilitator — the two statements do not sit
together, first-year French medical students are routinely 17, and the "under 20"
threshold predates Japan's 2022 change of the age of majority to 18.
**[TO VERIFY with counsel: the national age of digital consent applicable to the
Controller's cohort — France set the GDPR Art. 8 threshold at 15, not the Art. 8
default of 16, so "under 16" is likely the wrong figure for a French cohort.]**
Controller's confirmed threshold: [AGE THRESHOLD]. See Annex VI, item L10.

(f) **Power imbalance.** The teacher–student relationship is a power imbalance;
the Controller should satisfy itself (with its DPO and, for research, its ethics
committee) that participation and research consent are genuinely optional and
that refusing does not affect assessment.

3.7 **Operative bar — no first session on an unparameterised notice.** The
Processor shall **not provision a new Controller's first session** until (i) the
participant-facing notice and join-screen strings are parameterised per
controller, (ii) the notice-version string is generated rather than hard-coded,
and (iii) the Annex VI items L1–L10 are closed for that Controller. This is an
operative obligation on the Processor, not a recommendation.

3.8 **Operative prohibition — org-scoped sessions.** The Processor shall **not
enable, and the Controller shall not use, organisation-scoped sessions
(`orgs/<slug>/**`)** under this DPA. No retention, backup or pseudonymisation job
touches that tree — verified: no script under `scripts/` references `orgs` at all
— and several security rules present in the `sessions/` tree are absent there.
See Annex VI, item G9.

---

## 4. Confidentiality

4.1 **Covenant.** The Processor shall ensure that every person authorised to
process the personal data — employees, students, contractors, volunteers — has
committed to confidentiality **in writing**, or is under an appropriate statutory
obligation of confidentiality, **before** being granted access
(GDPR Art. 28(3)(b)). **Disclosed:** the Processor cannot warrant this as a
present fact at the draft date, because the list of such persons has not been
compiled (clause 4.3). Compiling the list and obtaining the undertakings is a
condition precedent (Annex VI, item L11).

4.2 **Instruction-bound processing (GDPR Arts. 29 and 32(4)).** The Processor
shall ensure that any natural person acting under its authority who has access to
personal data does **not process it except on instructions from the Controller**,
unless required to do so by EU/Member State or Japanese law. Confidentiality
alone does not discharge this obligation; it is stated separately for that
reason.

4.3 The Processor limits access to production data to the smallest number of
people needed to operate and support the platform, and maintains a list of those
people, available to the Controller on request.

4.4 **Disclosed reality.** Access to production data is currently held by
(i) whoever holds Firebase/Google Cloud console access to project
`canamed-69785`, and (ii) whoever can trigger or modify the GitHub Actions
workflows, because the repository secret `FIREBASE_SERVICE_ACCOUNT_CANAMED_69785`
grants full Realtime Database access. The repository is **public**, so workflow
definitions are visible to anyone, and anyone with write access to the
repository can in principle reach the data. The Processor must maintain and
disclose the current list of console administrators and repository maintainers:
[PROCESSOR TO SUPPLY — list of persons with console access and repository write
access, and the review cadence for that list].

---

## 5. Security of processing (GDPR Art. 32)

5.1 Taking into account the state of the art, costs, and the nature, scope,
context and purposes of processing as well as the risks to individuals, the
Processor implements the technical and organisational measures set out in
**Annex II**. Those measures describe what the code actually does at the draft
date; they are not aspirational.

5.2 **Warranty at the Effective Date.** The Processor warrants that, at the
Effective Date, **no item marked BLOCKING in Annex VI remains open**, and that
the level of security described in Annex II is not materially reduced during the
term. Improvements are permitted and expected.

5.3 **Acknowledgement — residual risks only.** The Controller acknowledges the
**residual** risks disclosed in Annex VI items R1–R8, which the Parties have
each considered and accepted for the operating context in clause 5.4. The
Controller does **not** thereby accept, waive or approve any item marked
BLOCKING, and nothing in this DPA is to be read as the Controller agreeing that
the measures described are appropriate notwithstanding an open BLOCKING item.
GDPR Art. 32(1) binds the Processor **directly**, independently of this contract;
Art. 82(2) makes the Processor liable for its own obligations; and a controller
that engages a processor in the face of known unremediated defects is itself in
breach of Art. 28(1). Acceptance language cannot cure any of that.

5.4 **Conditions precedent and remediation schedule.**

(a) *What is suspended.* **No personal data may be processed and no session may
be run** under this DPA until every item marked BLOCKING in Annex VI is closed
and the closure countersigned by both Parties in the table below. Non-blocking
items carry an owner and a target date but do not gate the start of processing.

(b) *What binds immediately on signature.* Clause 5.4(a) suspends the
**processing permission only**. The following bind both Parties from signature,
irrespective of whether any BLOCKING item is closed: this clause 5.4, the
remediation obligations and target dates in the table below and in Annex VI,
clause [CONFIDENTIALITY], clause [SECURITY MEASURES], clause [AUDIT AND
INSPECTION], clause [LIABILITY], clause [TERM AND TERMINATION], and clause
[GOVERNING LAW AND JURISDICTION].

> **Drafting note — do not delete without reading.** An earlier version of this
> clause suspended *the entire agreement* until the BLOCKING items closed. That
> was circular and unenforceable: if the whole DPA is ineffective, so are the
> very obligations requiring the items to be closed, so **no Party was bound to
> close them** and the conditions precedent could never be satisfied. The
> split above (suspend the processing permission; keep the remediation and
> governance clauses alive) is the standard fix, but **counsel must confirm it
> against the final clause numbering** — the bracketed cross-references are
> placeholders and must be replaced with the real clause numbers before signature.

(c) *Failure to remediate.* If any BLOCKING item remains open on [LONGSTOP
DATE], either Party may terminate this DPA on written notice with no liability
arising from the termination itself, without prejudice to accrued rights.

| Annex VI item | Severity | Owner | Target date | Closed (date + initials) |
|---|---|---|---|---|
| L1 notice names wrong controller | BLOCKING | [OWNER] | [DATE] | |
| L2 `compliance.html` misstatements | BLOCKING | [OWNER] | [DATE] | |
| L3 retention period published wrong | BLOCKING | [OWNER] | [DATE] | |
| L4 LLM / Hugging Face / US transfer absent from notice | BLOCKING | [OWNER] | [DATE] | |
| L5 FR/JA notices contradict EN | BLOCKING | [OWNER] | [DATE] | |
| L6 hard-coded fallbacks say "pseudonymised"/"anonymous" | BLOCKING | [OWNER] | [DATE] | |
| L7 consent UI English-only | BLOCKING | [OWNER] | [DATE] | |
| L8 consent architecture (collapsed notice) | BLOCKING | [OWNER] | [DATE] | |
| L9 APPI citations in the notice | BLOCKING | [OWNER] | [DATE] | |
| L10 age threshold contradiction | BLOCKING | [OWNER] | [DATE] | |
| L11 no DPIA / no ROPA / no confidentiality undertakings | HIGH | [OWNER] | [DATE] | |
| L12 "the CaNaMED study" hard-coded in runtime strings | HIGH | [OWNER] | [DATE] | |
| L13 published rights mailbox and SLAs are the Processor's | HIGH | [OWNER] | [DATE] | |
| G1 research export ignores research consent | BLOCKING | [OWNER] | [DATE] | |
| G2 tests + questionnaire readable by peers | BLOCKING | [OWNER] | [DATE] | |
| G3 cross-tenant readable session metadata | BLOCKING | [OWNER] | [DATE] | |
| G4 no APPI Art. 28 basis for the LLM leg | BLOCKING | [OWNER] | [DATE] | |
| G5 roster emails never deleted | HIGH | [OWNER] | [DATE] | |
| G6 certificate records never deleted | HIGH | [OWNER] | [DATE] | |
| G7 LLM usage log undisclosed / unbounded / unreachable | HIGH | [OWNER] | [DATE] | |
| G8 account profiles, scenarios, moderation records | MEDIUM | [OWNER] | [DATE] | |
| G9 `orgs/` tree outside every safeguard | BLOCKING | [OWNER] | [DATE] | |
| G10 no per-session configuration | BLOCKING | [OWNER] | [DATE] | |
| G11 retention jobs unmonitored | HIGH | [OWNER] | [DATE] | |
| G12 withdrawal does not produce erasure | BLOCKING | [OWNER] | [DATE] | |
| Annex IV — EEA → Hugging Face mechanism | BLOCKING | [OWNER] | [DATE] | |
| Annex IV — Google / GitHub DPA evidence | BLOCKING | [OWNER] | [DATE] | |

5.5 **Standing disclosure.** Annex VI is **not** deleted at signature. It remains
a standing disclosure for the term, updated by the Processor whenever an item is
closed or a new limitation is found, and re-issued to the Controller at least
[ANNEX VI REFRESH CADENCE — suggested every 6 months].

5.6 **Assumed operating context.** The security design assumes a **supervised
classroom**: a facilitator is physically or virtually present, participants are
identified students of a known cohort, and the disruption caused by a misbehaving
participant is recoverable. Several accepted risks in Annex VI depend on that
assumption. If the Controller intends unsupervised or self-service use, the
Parties must reassess before proceeding.

---

## 6. Sub-processors (GDPR Art. 28(2) and 28(4))

6.1 **General authorisation.** The Controller gives the Processor general written
authorisation to engage the sub-processors listed in **Annex III**. That list is
the authorised set at the date of signature. Authorisation extends only to
entities **named** in Annex III; a recipient that Annex III cannot name is not
authorised (clause 6.4).

6.2 **Changes.** The Processor informs the Controller in writing at least
[SUB-PROCESSOR CHANGE NOTICE PERIOD — suggested 30 days] before adding or
replacing a sub-processor. The Controller may object on reasonable data
protection grounds within [OBJECTION WINDOW — suggested 15 days]. If the
objection cannot be resolved, the Controller may terminate the affected
processing without penalty.

6.3 **Flow-down — covenant, not present-fact warranty.** The Processor shall
**not engage** a sub-processor until (i) a written contract imposing data
protection obligations in substance the same as those in this DPA is in force
(GDPR Art. 28(4)), **and** (ii) where the recipient is outside the EEA and not
covered by adequacy, a valid Chapter V transfer mechanism is executed. That
contract shall include an **express prohibition on using the data to train,
fine-tune or evaluate any model**, and shall flow that prohibition down to the
sub-processor's own sub-processors. The Processor remains fully liable to the
Controller for each sub-processor's performance.

> **Disclosed — as at the draft date this is not satisfied.** No sub-processor
> contract is evidenced anywhere in the repository (Annex III note; Annex IV).
> For Hugging Face, Annex IV records the transfer mechanism as **"None
> identified"**. The language-model feature must therefore remain **disabled**
> until clause 6.3 is satisfied for that leg — see clause 12.6.

6.4 **Onward sub-processing by Hugging Face — specifically disclosed.** The
Module A language-model character is served through Hugging Face Inference
Providers. Hugging Face's router (`https://router.huggingface.co/v1/chat/
completions`) forwards each request to a **third-party inference provider**, and
which provider handles a given request **varies per call**. The platform records
the provider returned in the `x-inference-provider` response header; providers
named in the code are Together, Fireworks and Cerebras.

**The consequence, stated plainly:** GDPR Art. 28(2) requires the controller to
authorise *identified* sub-processors and to be told of intended changes with a
right to object; Art. 28(4) requires equivalent obligations to be imposed **by
contract** on each. A controller cannot authorise recipients that cannot be
named, and cannot object to a change it is never told of. These are mandatory
contract terms, **not default rules the Controller can waive**. Accordingly:

- **The feature cannot lawfully run in its current configuration.** This DPA does
  not offer the Controller the option of accepting an unnameable recipient set.
- The tractable fix is to **pin the Hugging Face account to a single named
  provider and a single region**, name that entity and its location in Annex III,
  and obtain a written **zero-retention / no-training** commitment from it.
  [TO VERIFY with Hugging Face whether the account can be pinned.]
- Until that is done, the language-model character must be disabled by default
  (clause 12.6).

6.5 **Opt-out of the language-model feature — and its current limitation.** The
Controller may instruct the Processor in writing to disable the language-model
character. The server-side switch is `MODA_LLM_ENABLED=false` in the Cloud
Functions environment; the function then returns `{state:"disabled"}` and the
browser falls back to a local scripted patient with no external call and no chat
data leaving the EU database.

**Disclosed limitation, stated without euphemism:** that switch is **global to
the deployment**, not per-controller (verified: `functions/.env`). A Controller
whose DPO concludes there is no valid transfer basis therefore has exactly two
options today — **turn the AI patient off for every other facilitator on the
platform, or not use the platform**. There is no third option. A per-session
switch is a condition precedent (Annex VI, item G10).

*(The client-side `?llm=0` URL parameter, sticky via `localStorage`, exists for
facilitator demo and debugging. It is a per-device browser preference that any
participant can undo. It is **not** a controller control and must not be
presented or relied on as one.)*

---

## 7. Assistance with data subjects' rights (GDPR Art. 28(3)(e))

7.1 Taking into account the nature of the processing, the Processor assists the
Controller by appropriate technical and organisational measures, insofar as
possible, in fulfilling the Controller's obligation to respond to requests to
exercise rights under GDPR Chapter III (access, rectification, erasure,
restriction, portability, objection) and the corresponding APPI rights, namely:

- **disclosure** of 保有個人データ (Art. 33(1));
- **disclosure of third-party provision records** (Art. **33(5)** specifically —
  not Arts. 33–35 generally). Note that the record-keeping duties in Arts. 29–30
  do **not** apply to entrustment (委託) or joint use, so those records may
  legitimately be thin for this processing;
- **correction, addition or deletion** (Art. 34);
- **cessation of use or erasure** (Art. 35), including the 2022-amendment ground
  in **Art. 35(5)** — an individual may demand cessation of use or erasure where
  the operator no longer needs the data, where an Art. 26 leak has occurred, or
  where handling risks harming the individual's rights or legitimate interests.
  Art. 35(5) is the provision most likely to be invoked against the never-deleted
  categories in Annex VI, G5–G8.

7.2 **Where a request must go.** If a participant contacts the Processor
directly, the Processor does not respond substantively; it forwards the request
to the Controller within [FORWARDING WINDOW — suggested 3 working days] and tells
the participant who the controller is. Under APPI this is not merely a
contractual convenience: as an entrustee the Processor holds **no 保有個人データ
of its own** in respect of the entrusted data (Art. 16(4) turns on the authority
to disclose, correct or cease use, which the Processor does not have), so the
Controller is the only party able to answer.

7.3 The Processor responds to a Controller's assistance request within
[DSR ASSISTANCE SLA — suggested: acknowledge in 5 working days, substantive
assistance within 15 working days], which must leave the Controller enough time
to meet its own one-month deadline under GDPR Art. 12(3).

7.4 **What the platform can actually do today.**

| Right | Available mechanism | Limitation |
|---|---|---|
| Access | The facilitator's admin dashboard exports session data; participants can download their own take-home summary | The LLM usage log (`metrics/hfPatient/*`) is **invisible to clients** — it has no database rule — so it is not reachable through any in-product access flow. It must be extracted manually via the Admin SDK, and an access response that omits it is incomplete. The nightly GCS backup and the research export must also be searched (clause 7.6). |
| Rectification | Participants can edit their own free-text answers in-session | No edit path after a session closes; would require manual database intervention |
| Erasure | Deleting a session removes its whole subtree; the automated cleanup job does this on schedule | Does **not** reach roster emails, certificate records, account profiles, LLM usage logs, admin secrets, authored scenarios, or the `orgs/` tree — all manual (Annex VI, G5–G9) |
| Restriction | Closing the session stops further writes | No per-participant restriction flag exists |
| Portability | Research/participant exports produce structured JSON/CSV | — |
| Objection / withdrawal of consent | Consent flags are stored per participant (`pool/$cid/consent`) | **Withdrawal deletes nothing.** Where consent is the asserted basis, GDPR Art. 17(1)(b) makes erasure the automatic consequence of withdrawal and Art. 7(3) requires withdrawal to be as easy as giving it. There is no in-product withdrawal that removes the participant from `pool`, the room subtrees and `rosters`. See Annex VI, item G12 |
| **Cessation of use / erasure (APPI Art. 35(5))** | None automated | The categories most likely to attract an Art. 35(5) demand — roster emails, certificate records, the LLM usage log, account profiles — are exactly those with no deletion path (Annex VI, G5–G8) |

7.5 **Manual deletion SLA.** The Processor performs manual deletions that the
automation cannot reach, on the Controller's written instruction, within
[MANUAL DELETION SLA — suggested 15 days], and confirms completion in writing.
**For certificate-registry removals the SLA is [CERTIFICATE REMOVAL SLA — must be
≤ 5 working days]**, because the live notice already promises participants, in
all three languages, that a registry entry is removed "within 5 working days" —
and the record cannot be deleted by any client (the rule permits writes only when
`!data.exists()`). A longer contractual SLA would lock in a promise the Controller
is already publicly making and cannot keep.

7.6 **Art. 15 / Art. 33 fulfilment runbook.** A complete response must search
**both** the processor-held datasets and the operator-controlled datasets in
clause 2.4. The Processor shall maintain and supply a runbook covering, at
minimum: `sessions/**` (and `orgs/**` if ever enabled), `rosters/**`,
`credentials/**`, `users/**`, `metrics/hfPatient/**`, the private GCS backup
objects, and the pseudonymised export + linkage table.
[PROCESSOR TO SUPPLY — runbook reference.]

7.7 **Published response promises must match this clause.** The live notice
(`privacy.html` §9 and its FR/JA equivalents) directs participants to
`canamed-ethics@unicaen.fr` — the **Processor's** mailbox — and promises
acknowledgement within 5 working days and a response within 30 days. Under this
DPA the Processor does not respond substantively (clause 7.2). The mailbox and
every published response-time promise must be changed to the Controller's before
any session runs. See Annex VI, item L13.

---

## 8. Assistance with the Controller's other obligations (GDPR Art. 28(3)(f))

The Processor assists the Controller, taking into account the nature of
processing and the information available to it, in complying with GDPR
Arts. 32–36 — security, breach notification, data protection impact assessment
(DPIA), and prior consultation.

**The Parties record that no DPIA exists for this processing at the draft date.**
Given free-text processing of student contributions by a third-party language
model, systematic processing in an education context with a power imbalance, and
international transfers, the Controller should assume a DPIA is required and
complete one before go-live. The Processor will supply the technical description
needed for it. The DPIA should specifically address the residual re-identification
risk in Annex VI, item R7 (free-text answers survive pseudonymisation) and the
persistent research identifier in item R8.

---

## 9. Personal data breaches (GDPR Art. 33(2); APPI Art. 26)

9.1 The Processor notifies the Controller **without undue delay** and in any
event within [BREACH NOTIFICATION WINDOW — suggested 24 or 48 hours] of becoming
aware of a personal data breach affecting the Controller's data.

9.2 The notification includes, to the extent known: the nature of the breach,
the categories and approximate number of data subjects and records concerned, the
likely consequences, the measures taken or proposed, and a contact point.
Information the Processor does not yet have is supplied in phases without further
undue delay.

9.3 **GDPR.** The Processor does not notify a supervisory authority or data
subjects on the Controller's behalf unless the Controller instructs it to in
writing. The Controller makes the notification decisions.

9.4 **Japan (APPI Art. 26) — the mechanic, not just silence.** Japanese law
differs from GDPR here and the difference matters. Under APPI a 委託先
(entrustee) that suffers a leak has **its own** duty to report to the Personal
Information Protection Commission (PPC) and **its own** duty to notify affected
individuals. It is relieved of both **only** by invoking the **Art. 26(1)
proviso** — that is, by notifying the 委託元 (the entruster). Silence does not
discharge the Processor; the notification must be given in the form that
transfers the duty. Accordingly:

(a) The Processor's notice under clause 9.1 is given **expressly for the purpose
of the APPI Art. 26(1) proviso**, and states that it is so given.

(b) On receipt, the Controller assumes the PPC report — the **速報**
(preliminary report) and the **確報** (final report) — and the **Art. 26(2)**
notification to affected individuals.

(c) The Processor supplies, without charge and without delay, whatever the
Controller needs for both.

(d) **Deadlines.** The two-stage structure applies: a preliminary report
promptly after becoming aware, and a final report within the period set by the
PPC Enforcement Rules. The platform's own live notice already publishes
"**PPC preliminary 3–5 days, final 30 days**". [TO VERIFY with Japanese counsel:
that those figures are correct for this processing, and the **extended
final-report window** that applies where the leak was caused by an act done for
an improper purpose.] The reporting triggers are, broadly: leakage of 要配慮個人
情報; leakage likely to cause property damage; leakage caused by an improper
purpose or unauthorised access; or a leak affecting more than 1,000 individuals.

(e) [TO VERIFY with Japanese counsel: whether the Controller or a Japanese
partner institution is the reporting entity where both are involved.]

9.5 The Processor maintains an incident runbook; the current version is
`OPERATOR_INCIDENT_RUNBOOK.md` in the repository.

---

## 10. Deletion or return of data at the end of processing (GDPR Art. 28(3)(g))

10.1 On termination of this DPA, or earlier on the Controller's written
instruction, the Processor — at the Controller's choice — deletes or returns all
personal data processed on the Controller's behalf, and deletes existing copies,
unless EU/Member State or Japanese law requires storage. **Disclosed:** the
categories in clause 10.5 cannot be reached by the automation today, so this
obligation is currently performable only in part and only manually. Closing
Annex VI items G5–G9 is what makes clause 10.1 truthful.

10.2 The Controller states its choice here: [DELETE / RETURN THEN DELETE —
Controller to select].

10.3 **Ordinary-course retention.** Absent a specific instruction, the platform's
automated schedule applies. As implemented at the draft date:

| Data | Deleted when | Where implemented |
|---|---|---|
| Session data (`sessions/<code>/**`) | **30 days** after the session is closed | `scripts/cleanup-stale-sessions.js`, default `CLEANUP_RETENTION_CLOSED_DAYS=30` |
| Abandoned sessions (never closed) | **90 days** after creation | same script, `CLEANUP_RETENTION_OPEN_DAYS=90` |
| Sessions with no timestamps at all | immediately on the next run | same script |
| Backups in the private archive bucket | **90 days** (object lifecycle) | `scripts/ops/pii-bucket-lifecycle.json` |
| Pseudonymised research exports | **90 days** (object lifecycle) | same file |
| Re-identification linkage tables | **14 days** (object lifecycle) | same file |

The cleanup job runs daily at 03:17 UTC; the backup at 02:47 UTC; the
pseudonymised export at 03:47 UTC.

> **Deletion is not guaranteed — it is a scheduled job on a public GitHub
> repository.** Nothing deletes anything unless the workflow actually runs.
> There is **no alerting on a skipped or failed run**; a misconfigured run
> (`CLEANUP_CONFIRM=0`, dry-run mode) **exits successfully without deleting**,
> so a broken configuration shows green; and GitHub disables `schedule:`
> triggers on repositories that go inactive for 60 days. This exact failure has
> already occurred once on a related repository, where the jobs stopped for
> roughly eleven days before anyone noticed. Clause 10.3 is the Controller's
> storage-limitation evidence, so this is the single most likely place this DPA
> becomes untrue after signature. **Processor obligation:** the Processor shall
> verify that each scheduled job ran and deleted as expected, and report that
> verification to the Controller [MONTHLY / ON REQUEST — select], and shall
> implement failure alerting (Annex VI, item G11).

> **[TO VERIFY — an internal inconsistency to resolve before signature.]** The
> header of `scripts/pseudonymise-export.js` says the linkage table's retention
> matches "the **6-month** linkage-destruction commitment in the privacy
> policy". The implemented lifecycle is **14 days**, and no six-month linkage
> commitment could be found in `privacy.html`. Fourteen days is *stricter* than
> six months, so this is a documentation inconsistency rather than
> over-retention — but a signed document must not carry two different numbers.
> Confirm which commitment was actually published and align the comment, the
> lifecycle rule and this clause.

10.4 **The Controller may choose shorter periods** by written instruction; the
cleanup job accepts `CLEANUP_RETENTION_CLOSED_DAYS` and
`CLEANUP_RETENTION_OPEN_DAYS` as inputs. Controller's chosen values:
[CONTROLLER-CHOSEN RETENTION — CLOSED SESSIONS, days] and
[CONTROLLER-CHOSEN RETENTION — ABANDONED SESSIONS, days]. **Disclosed
limitation:** these are deployment-wide settings today, so honouring one
Controller's choice changes every Controller's. Once Annex VI item G10 is closed,
the per-session value governs and the environment variable acts as a **ceiling**.

10.5 **Data the automation does NOT delete.** The following persist indefinitely
today and require manual deletion: participant email rosters
(`rosters/sessions/<code>/<uid>`), certificate records (`credentials/<certId>`),
account profiles and history (`users/<uid>`), the LLM usage log
(`metrics/hfPatient/*`), admin secrets and recovery records, authored and shared
scenarios, abuse reports and moderation records, and **everything under the
`orgs/` tree**. See Annex VI, items G5–G9. The Controller must not assume
storage limitation is met for these categories without a manual process.

10.6 **Short retention does not reduce rights.** Under APPI, the pre-2020
exemption for data deleted within six months has been repealed: 30-day session
data — and even a 7-day purge — remains 保有個人データ carrying the full
Arts. 33–35 rights. Neither Party may rely on a short retention period to argue
that rights do not attach.

10.7 **The published retention statement is wrong and must be corrected.** The
live privacy notice and the join screen tell participants that "live session data
is purged within 7 days", in all three languages. The implemented periods are 30
and 90 days. This mismatch must be resolved — by changing the code, the notice,
or both — before any participant is onboarded under this DPA. See Annex VI,
item L3.

---

## 11. Audit and information rights (GDPR Art. 28(3)(h))

11.1 The Processor makes available to the Controller all information necessary to
demonstrate compliance with GDPR Art. 28, and allows for and contributes to
audits, including inspections, conducted by the Controller or an auditor it
mandates.

11.2 **What the Processor can provide directly:**

- the database security rules (`database.rules.json`), which define who can read
  and write every path;
- the Cloud Function source (`functions/`), including the LLM proxy and the mail
  queue;
- the retention, backup and pseudonymisation scripts and their scheduled workflow
  definitions, **and the run history showing whether they executed**;
- the pseudonymisation logic and its unit tests;
- the current list of persons with production console and repository access;
- the platform source in general — the repository is public.

11.3 **What the Processor cannot provide.** The Processor cannot audit Google's or
Hugging Face's own infrastructure. For those, the Processor relies on the
sub-processors' published certifications and audit reports and will pass through
whatever they make available. [TO VERIFY: which certifications (e.g. ISO/IEC
27001, SOC 2) currently apply to the specific Google Cloud and Hugging Face
services used, and whether Hugging Face publishes an audit report at all.]

11.4 Audits take place on [AUDIT NOTICE PERIOD — suggested 30 days] written
notice, at most [AUDIT FREQUENCY — suggested once per year] except after a
personal data breach, during normal business hours, and without unreasonably
disrupting the Processor's operations. The Controller bears its own audit costs
unless the audit finds material non-compliance.

11.5 **Record of processing — covenant.** The Processor shall create and maintain
a record of processing carried out on the Controller's behalf (GDPR Art. 30(2))
and make it available to the Controller on request. **Disclosed:** no such record
(ROPA) existed at the draft date — none was found in the repository — so this is
a forward obligation, not a description of the present. Creating it is a
remediation item (Annex VI, L11).

---

## 12. International transfers

### 12.1 Where the data actually is

| Component | Location | Verified in |
|---|---|---|
| Realtime Database (all session data) | **`europe-west1`** (Belgium, EU) | `firebase-config.js` — `canamed-69785-default-rtdb.europe-west1.firebasedatabase.app` |
| `sendQueuedMail` Cloud Function | **`europe-west1`** (EU) | `functions/index.js` — explicitly "co-located with the trigger (EU-resident data)" |
| **`hfPatient` Cloud Function (the LLM proxy)** | **`us-central1` — UNITED STATES** | `functions/index.js` |
| Hugging Face router and downstream inference provider | **Outside the EU; provider varies per request** | `functions/index.js`, `functions/lib/hf-helpers.js` |
| Private PII archive bucket (`gs://canamed-pii-archive`) | `europe-west1` (EU), per the provisioning script | `scripts/ops/setup-pii-bucket.sh` — [TO VERIFY the bucket exists with these settings] |
| **GitHub Actions runners (retention, backup and export jobs)** | GitHub-hosted infrastructure, **US** | `.github/workflows/*.yml` |
| reCAPTCHA v3 / App Check | Google; region not pinned | `firebase-config.js`, `firebase.json` CSP — [TO VERIFY processing location] |
| Google account avatars (signed-in users) | `lh3.googleusercontent.com` | `firebase.json` CSP |
| Certificate-verification page (`verify.html`) loads the Firebase SDK from `www.gstatic.com` | Google edge; visitor IP disclosed | `verify.html` |

**The GitHub Actions row is bigger than a credential.** It is not merely that a
service account key sits on a US runner. Verified in the code: both
`scripts/backup-sessions.js` and `scripts/pseudonymise-export.js` execute
`db.ref("sessions").once("value")` — pulling the **entire identified `/sessions`
tree, including every free-text chat turn** — onto a US-hosted GitHub runner,
writing it to that runner's local disk (`fs.writeFileSync`), and, in the export
job's case, **constructing the real-name → pseudonym linkage table there** before
uploading to the EU bucket. That is a **nightly bulk export of the whole personal
data set to a US processor**, and it must be assessed as such under GDPR
Chapter V and APPI Art. 28. Mitigation available: move both jobs to Cloud Run or
Cloud Scheduler in `europe-west1` (open item, Annex VI G11).

**Consequence to state plainly to participants:** the free-text conversation with
the simulated patient — including whatever a student types — leaves the EU. It is
processed in the United States by Google Cloud, then sent to Hugging Face, then
to a third-party inference provider that changes from request to request. The
current privacy notice does not say this. See Annex VI, item L4.

### 12.2 EU → Japan

Japan benefits from a European Commission **adequacy decision** (adopted
23 January 2019; the mutual arrangement was reviewed and maintained
[TO VERIFY the current status and any scope extension — an earlier draft asserted
a 2023 extension without a source]). Transfers of personal data from the EEA to a
recipient in Japan that is subject to APPI therefore do **not** require standard
contractual clauses or other Art. 46 safeguards.

The adequacy decision is accompanied by the PPC's **Supplementary Rules**, which
impose additional protections on EU-origin data held in Japan. Clause 12.2 does
not merely name them: the Japanese counterparty identified in Annex V.9 shall,
in respect of EU-origin participant data:

(a) treat data on **sex life, sexual orientation and trade-union membership** as
要配慮個人情報, even though APPI's own definition does not include them;

(b) where the data is received by way of entrustment or joint use, **confirm and
record the purpose** for which it was originally obtained, and use it only within
that scope;

(c) keep **third-party provision records** as required by the Rules;

(d) observe the **restricted onward-transfer rule** — which is directly engaged
here, because this platform creates an EU-origin → Japan → **US** path (see
Annex IV);

(e) honour the Rules' provisions on retention and on the treatment of anonymously
processed information.

[TO VERIFY with Japanese counsel that this list is complete and current.]

### 12.3 Japan → EU

Japan's PPC has designated the EEA (and the UK) as jurisdictions with a
protection standard equivalent to Japan's, so a transfer from Japan to the EEA is
not treated as a foreign transfer requiring separate consent under APPI Art. 28.
The EU-hosted database is therefore compatible with the Japanese side. (This PPC
designation is a distinct instrument from the European Commission's adequacy
decision in 12.2; the two are not interchangeable.)

### 12.4 EU/Japan → United States — **this is the gap**

Adequacy does **not** cover the US leg. For every transfer to the US the Parties
must identify, **and execute**, a valid mechanism:

**(a) Google (Cloud Functions in `us-central1`, Cloud Storage, reCAPTCHA).**
Google's Cloud Data Processing Addendum incorporates the EU Standard Contractual
Clauses and Google entities have historically self-certified under the EU–US Data
Privacy Framework. [TO VERIFY: that the Google Cloud DPA / Data Processing and
Security Terms have actually been accepted for project `canamed-69785`; which
SCC module applies; and the current DPF certification status of the relevant
Google entity. None of this is verifiable from the repository.]

**(b) Hugging Face.** [TO VERIFY: whether any DPA or SCCs have been concluded
with Hugging Face for this use. Nothing in the repository evidences a contract —
only an API token in Secret Manager. If no DPA exists, the chat feature has **no
Art. 28 contract and no Chapter V transfer mechanism** and must be disabled until
one is in place — see clause 12.6.]

**(c) Hugging Face's onward inference providers.** Because the handling provider
varies per request, neither a fixed transfer-impact assessment nor a fixed
sub-processor list is currently possible. The fix is to pin the account
(clause 6.4). [TO VERIFY with Hugging Face whether pinning to a single named
provider and region is available on this account.]

**(d) GitHub Actions.** As restated in 12.1, the retention jobs copy the entire
identified database onto US infrastructure nightly and build the linkage table
there. [TO VERIFY: GitHub's DPA/SCC position for this account, and whether the
jobs can be moved to EU-hosted runners or to Cloud Scheduler in `europe-west1`.]

**(e) APPI side.** For any US transfer originating from the Japanese participant
population, APPI Art. 28 requires one of: the individual's **prior consent** to
the foreign transfer, given after being told the **name of the destination
country**, information about **that country's protection regime**, and the
**measures the recipient takes** (Art. 28(2) with the PPC Enforcement Rules); the
recipient being in a designated-equivalent jurisdiction (**the US is not**); or
the recipient having established a system meeting Japanese standards (基準適合
体制), with the transferor taking the required follow-up measures.

> **None of the three routes is available for the language-model leg today.**
> The destination country cannot be named in advance (the provider varies per
> call), so the Art. 28(2) prescribed information cannot be given; a 基準適合体制
> arrangement cannot be concluded with an unidentifiable recipient; and the join
> flow has exactly **two** consent checkboxes (`consent-workshop`,
> `consent-research`) — neither is a foreign-transfer consent. Because the chat
> is on by default, this affects **every session with a Japan-resident
> participant**. See Annex VI, item G4.

12.5 **Transfer impact assessment.** The Controller, assisted by the Processor,
shall complete a transfer impact assessment **before the first transfer**, not
"before go-live" — the feature is already running, so the assessment is overdue,
not pending. Scope must include, at minimum:

- US government access risk to **free-text educational writing** by students;
- the fact that content is student-authored free text under an instruction not to
  include personal details (an instruction, not a control);
- the practical inability to enumerate the final recipient (clause 6.4);
- **the nightly bulk export of the entire identified `/sessions` tree, including
  chat, to a US GitHub runner, and the construction of the re-identification
  linkage table on that runner** (clause 12.1);
- the certificate-verification page's disclosure of third-party visitors' IP
  addresses to Google (clause 2.4).

12.6 **Default state, not an option.** Until (i) an Art. 28(4) contract with
Hugging Face and (ii) an executed Chapter V mechanism are in force, and (iii) the
APPI Art. 28 route in 12.4(e) is documented, the language-model character shall
be **disabled by default** — server flag `MODA_LLM_ENABLED=false` and the client
default flipped off — for all sessions run under this DPA. Disabling it removes
the US leg for chat content entirely: all remaining processing then sits in
`europe-west1` plus the GitHub Actions and reCAPTCHA legs. A one-line change of
`region:` on `hfPatient` from `us-central1` to `europe-west1` would additionally
remove the **Google** US leg for chat, independently of the Hugging Face
question; the Parties should treat that as a near-term mitigation.

12.7 **No reliance on derogations.** The Parties record that **GDPR Art. 49
derogations are not relied on** for any route in Annex IV. Systematic,
repeated classroom processing is not "occasional" within the meaning of Art. 49,
and Art. 49(1)(a) explicit consent would inherit whatever defects attach to the
consent mechanism (clause 3.6(a)). Transfers must rest on Art. 45 adequacy or an
executed Art. 46 instrument, and **no transfer is to occur before that instrument
is executed**.

---

## 13. Liability, term and general terms

13.1 **Term.** This DPA takes effect on [EFFECTIVE DATE] — subject to the
conditions precedent in clause 5.4 — and lasts as long as the Processor processes
personal data on the Controller's behalf, plus the retention tail in clause 10.3.

13.2 **Termination.** Either Party may terminate on [TERMINATION NOTICE PERIOD]
written notice. Clauses 4, 9, 10, 11 and 12 survive termination to the extent
needed.

13.3 **Liability and indemnities.** [LIABILITY AND INDEMNITY TERMS — to be drafted
by counsel. Consider: GDPR Art. 82 joint and several liability towards data
subjects; whether the Processor carries insurance; and whether any cap is
appropriate given the Processor may be a university department rather than a
commercial vendor.]

13.4 **Governing law.** [GOVERNING LAW].
**Jurisdiction.** [VENUE / COMPETENT COURTS].
The Parties note that the processing spans EU and Japanese law and that a single
choice of law does not displace either regime's mandatory rules. In particular,
a "the English version governs" clause is a contract device between the Parties
and does **not** cure a GDPR Art. 12(1) or APPI Art. 21 defect towards a French-
or Japanese-speaking participant.

13.5 **Order of precedence.** In case of conflict between this DPA and any other
agreement between the Parties, this DPA prevails on data protection matters.

13.6 **Annexes.** Annexes I–VI form an integral part of this DPA.

---

## Signatures

**Draft — not for signature. Signature is ineffective until every BLOCKING item
in Annex VI is closed and countersigned in the clause 5.4 table.**

| Controller | Processor |
|---|---|
| Name: [CONTROLLER SIGNATORY NAME] | Name: [PROCESSOR SIGNATORY NAME] |
| Role: [ROLE] | Role: [ROLE] |
| Date: [DATE] | Date: [DATE] |
| Signature: ______________________ | Signature: ______________________ |

---

# ANNEX I — Description of the processing

## 1. Subject matter

Operation of the CaNaMED problem-based-learning platform: a browser-based
application in which students join a facilitator-run session, work in small
rooms, record clinical reasoning, converse with a simulated patient character
generated by a language model, vote on decisions, complete a knowledge test and a
wrap-up questionnaire, and may receive a completion certificate.

## 2. Duration

For each session: from the moment a participant joins until the retention period
in clause 10.3 expires. Overall: the term of this DPA.

## 3. Nature and purpose

- **Nature:** collection, structured storage, display to other session members,
  transmission to a language-model provider, aggregation, backup, pseudonymisation,
  export and deletion.
- **Purpose (Controller's):** [CONTROLLER TO STATE — e.g. delivery of an
  accredited teaching activity; and, if applicable, educational research under
  ethics approval [ETHICS COMMITTEE APPROVAL REFERENCE]].

## 4. Categories of data subjects

- **Students / participants** — typically medical or health-professions students.
  The live notice states 18+ but simultaneously contemplates under-16 and under-20
  participants, and **the platform has no age gate**. [CONTROLLER TO CONFIRM the
  applicable threshold and that no participant is below it — clause 3.6(e),
  Annex VI L10.]
- **Facilitators / teaching staff** — the session creator and any co-facilitators.
- **Observers**, where the Controller enables observer roles.
- **Scenario authors**, where the Controller's staff author scenarios.
- **Certificate verifiers** — third parties (employers, registrars, or the
  participant themselves) who visit the public `verify.html` page. They are not
  participants, have no relationship with the Controller, receive no notice, and
  their IP address is disclosed to Google when the page loads the Firebase SDK
  from `www.gstatic.com`. Role allocation for this processing is open — see
  clause 2.4.

## 5. Categories of personal data (as implemented)

The **"Who can read it"** column matters: this is a classroom platform and much of
the data is deliberately visible to others. Two rows in bold are visible more
widely than participants are told.

| Category | Where stored | Who can read it | Notes |
|---|---|---|---|
| Display name, university/affiliation, study year, self-rated English | `sessions/<code>/pool/<clientId>` | Every session member | Free-text, each capped at 40 characters |
| Consent record | `.../pool/<clientId>/consent` | Every session member | Booleans for workshop and research consent, plus a notice-version string |
| Identity-to-account bindings | `clientMapping`, `stableIdMapping`, `members`, `rooms/*/uidMembers` | Every session member | Maps a browser identity to a Firebase auth UID |
| Free-text clinical answers and replies | `rooms/<room>/answers`, `answerReplies` | Every session member (not only the room) | Carries the author's display name and university |
| Diagnostic hypotheses, prompt replies, revealed items, scores | `rooms/<room>/moduleA/*`, `moduleB/*` | Every session member | Free text capped at 200 characters |
| **Free-text conversation with the simulated patient** | `rooms/<room>/moduleA/chat/<turnId>` | **Room members only** (the one read-gated node) | Up to 600 characters per turn; **the highest-risk field** because it is unconstrained student writing |
| Votes and committed decisions | `rooms/<room>/votes/*` | Every session member | |
| Presence, typing indicators, role choices, observer list | `rooms/<room>/*` | Every session member | |
| **Knowledge-test results** | `rooms/<room>/tests/<clientId>` | **Every session member** — the node has no read rule of its own and inherits the session-wide member grant | Per-item answers, score, timestamps, `stableId`. Participants are told the test is "anonymous within your university". It is not. See Annex VI, G2 and L6 |
| **Wrap-up questionnaire** | `rooms/<room>/survey/<clientId>` | **Every session member** — same inheritance | Demographic items, Likert learning and intercultural items, and **five free-text items allowing up to 2,000 characters each**, which may name and evaluate the facilitator. Participants are told it is "a short, anonymous questionnaire". It is not. See Annex VI, G2 and L6 |
| Qualitative poll | `sessions/<code>/poll/<clientId>` | Every session member | "What was hardest" free text up to 280 characters, plus a feeling rating |
| **Session metadata: creator UID, facilitator display name (`created.by`), workshop label, scenario id, `scenarioCustomJson` (up to 262,144 characters of authored scenario), scenario reference, closed marker, summary, admin-hash marker** | `sessions/<code>/*` | **Any authenticated user of the platform** (`".read": "auth != null"`, with **no membership test**) — including participants of a *different* facilitator's session | Session codes are 6 characters from a 31-character alphabet (~30 bits) and are explicitly not secret ("read aloud to a room"). See Annex VI, G3 |
| **Participant email addresses** | `rosters/sessions/<code>/<uid>` | Session creator only | Email, name, university. Written only for signed-in (non-anonymous) participants who gave research consent. Exportable by the facilitator as CSV |
| Outbound mail jobs | `sessions/<code>/mail/<mailId>` | Admin-gated | Recipient address, subject, body. **Feature currently disabled** (`EMAIL_ENABLED=false`) |
| **Certificate records** | `credentials/<certId>` | **Anyone, with no authentication**, by exact ID | A SHA-256 **hash of the name** (not the name), the session code, a session label, timestamps, `retentionUntil` |
| Account profile and session history | `users/<uid>/*` | Self only | Only for participants who create an optional account |
| Authored and shared scenarios | `scenarios/<ownerUid>`, `sharedScenarios/<shareId>` | Owner; shared ones readable by **any signed-in user** | Shared scenarios carry the author's display name (capped 80 chars) — confirm the facilitator consent flow discloses that |
| Abuse reports and moderation records | `reports/*`, `moderation/*` | Admin-gated | Retains the reporting user's UID |
| **LLM usage log** | `metrics/hfPatient/*` | **No one via the client** — the path has no rule, so it is unreadable from any browser and reachable only via the Admin SDK | Per turn: auth UID, timestamp, language, message count, reply length, latency, HTTP status, inference provider, token counts, session code. Not in the notice; no job deletes it |
| Org-scoped mirror of all of the above | `orgs/<slug>/sessions/<id>/**` | As above within the org | **No retention, backup or pseudonymisation job touches it.** Prohibited under clause 3.8 |

### Data stored in the participant's own browser

`localStorage`: session code, resume token, **display name**, sound preference,
theme, Module B role, programme sessions, LLM opt-out flag, LLM chat
acknowledgement, and — added here because it was missing from the previous draft
— **`canamed_stable_id`**.

**`canamed_stable_id` deserves separate mention.** It is an 80-bit random
identifier that **persists across tabs, refreshes and sessions** (cleared only on
full sign-out; for signed-in users it is set to the Firebase auth UID). It is
written into `pool`, into answer metadata, and into `tests/$cid/stableId` and
`survey/$cid/stableId` (rules cap it at 64 characters). Its stated purpose, in
the code comment, is so that **researchers can deduplicate participants across
sessionStorage resets** — that is, a *research* purpose, not service delivery.
That profile (a persistent, device-stored identifier serving a secondary purpose)
is the kind most likely to attract consent analysis under ePrivacy /
Art. 5(3)-type rules and under APPI, and it appears nowhere in the current
notice. **[CONTROLLER / DPO TO DECIDE: its lawful basis, and whether it must be
gated on the research-consent tick rather than set for everyone.]** See
Annex VI, item R8.

`sessionStorage`: a per-tab random client identifier (`canamed_client`, 80 bits),
a local error-telemetry buffer, and transient connection flags.

Error telemetry is **local only** — it is buffered in the browser (maximum 50
entries, including user agent, page path without query string, and stack traces)
and there is no remote endpoint. Nothing is transmitted.

## 6. Special categories of data (GDPR Art. 9) / sensitive personal information (APPI)

The platform is **not designed to collect** health data about participants, and
should not be used to do so.

However, the scenarios are clinical and emotionally loaded — historically opioid
prescribing, breaking bad news, end-of-life disclosure, and family-versus-patient
autonomy, and under the self-serve model any subject the Controller's authors
choose. Participants writing free text in the chat, the answers, the poll and the
five open questionnaire items may **volunteer** information about themselves,
including health experiences, beliefs, or details about identifiable third
parties (patients, relatives, colleagues).

**Two different legal problems follow, and they are not the same problem:**

- **GDPR.** The Controller must treat this as a foreseeable risk in its DPIA and
  identify an Art. 9(2) condition.
- **APPI Art. 20(2) is stricter and blunter.** *Acquiring* 要配慮個人情報 without
  the individual's prior consent is **prohibited**. There is no balancing or
  legitimate-interest route, and the research carve-out is **entity-based**:
  available only to an 学術研究機関等 under Art. 16(8). A facilitator at a
  hospital or a private training body has no exemption. See clause 3.6(d).

The in-product instruction "do not type names, contact details, or anything
personal" is a mitigation, not a control: everything typed is stored, is visible
to other session members, and is included in the identified nightly backup. Chat
content is excluded from the *pseudonymised* research export — but **the
2,000-character free-text questionnaire answers, the poll free text, the room
answers and the hypotheses are not** (Annex II §1, Annex VI R7).

## 7. Frequency

Continuous during a live session; nightly for the automated backup, cleanup and
export jobs.

---

# ANNEX II — Technical and organisational security measures (GDPR Art. 32)

*The measures below describe the code as it stands at the draft date. Anything
that could not be confirmed from the code is marked.*

## 1. Encryption in transit and pseudonymisation

- All traffic is HTTPS. `Strict-Transport-Security: max-age=31536000;
  includeSubDomains` is set, and the Content-Security-Policy includes
  `upgrade-insecure-requests`.
- Encryption at rest is provided by Google Cloud's default encryption for
  Realtime Database and Cloud Storage. [TO VERIFY: whether customer-managed
  encryption keys are wanted; none are configured.]
- **Pseudonymisation — what the transform actually does.** A tested,
  side-effect-free module (`scripts/lib/pseudonymise.js`):
  - rewrites keys literally named `name` and `by` to `Student-A`, `Student-B`…
    in join order, and redacts names it cannot map (for example facilitators) to
    `REDACTED-NAME`;
  - buckets the `university` field to `Univ-1`, `Univ-2`…;
  - drops the admin hash marker, `_adminPresence`, `_superadminReset`, and the
    **entire `chat` subtree**;
  - as a safety net, replaces any string that **exactly equals** a known
    participant name, including bare strings inside arrays;
  - uses null-prototype maps so a participant named `__proto__` cannot collide
    with a built-in property.
- **What it does NOT do — stated plainly.** Everything else passes through
  **verbatim**. That includes the wrap-up questionnaire's five free-text items
  (up to 2,000 characters each), the room `answers` and `answerReplies`, the
  Module A `hypotheses`, and the `poll.hardest` field (280 characters). The
  module's own comment explains that chat is dropped because "a name embedded in
  prose can't be exact-matched" — **that reasoning applies identically to the
  2,000-character survey items, which are not dropped**. In a small cohort,
  free-text writing is a re-identification vector on its own. See Annex VI,
  item R7. The output is therefore **de-identified only against exact-name
  matching**; it is not anonymous data, and under APPI it is neither
  仮名加工情報 nor 匿名加工情報 (Annex V.10).
- **Names on certificates** are stored only as a SHA-256 hash. The hash is
  **unsalted by design** and is stored beside the plaintext session code, so it
  is testable offline against a candidate list for a known cohort. See Annex VI,
  item R2.

## 2. Access control

- The database denies everything by default: the root has `.read: false` and
  `.write: false`, and access exists only on paths that explicitly grant it. A
  path with no rule — such as `metrics/hfPatient` — is therefore **already
  unreadable and unwritable from any client**; the absence of a rule is a denial,
  not an omission. (It is still a gap in a different sense: see Annex VI, G7.)
- **Session data: two different read scopes, not one.**
  - Most of a session (`sessions/$sessionId`) requires being an authenticated
    **member**: `auth != null && data.child('members').hasChild(auth.uid)`.
  - **But nine child paths override that with a bare `".read": "auth != null"` —
    no membership test at all.** Verified in `database.rules.json`:
    `adminPasswordHash`, `creatorUid`, `created` (whose `by` field is the
    **facilitator's display name**, ≤40 chars), `workshopLabel`, `scenarioId`,
    **`scenarioCustomJson` (up to 262,144 characters of authored scenario)**,
    `scenarioRef`, `closed`, and `summary`. Any authenticated user of the
    platform — including an anonymous participant in a *different* facilitator's
    session — can read these for any session code they know or guess. Session
    codes are 6 characters over a 31-character alphabet (~30 bits) and are
    explicitly not secret. Under the facilitator-as-controller model this is a
    **cross-tenant** disclosure. See Annex VI, item G3.
- **Within a session, the member grant covers the entire subtree.** Any member
  can read every room's answers, names and universities — deliberate classroom
  visibility. **The one read-gated exception is the language-model chat**, which
  is restricted to the members of its own room. Consequently `tests/$cid` and
  `survey/$cid`, which have no read rule of their own, are readable by **every
  other participant** — including the 2,000-character free-text reflections. See
  Annex VI, item G2.
- Writes are bound to ownership: a browser identity is bound write-once to a
  Firebase auth UID (`clientMapping`, `stableIdMapping`) and per-room writes are
  gated on the room's `uidMembers` list, so a member of one room cannot tamper
  with another room's data.
- Roster emails are readable **only** by the session creator, and writable only
  by the participant themselves or the creator, and only while the session is
  open.
- **Every writable node validates its own fields** — type, length ceilings,
  timestamp windows. This was checked programmatically: no writable node lacks
  validation on itself or its children.
- **Unknown-key sentinels are the exception, not the rule.** Exactly **five**
  nodes carry an `$other: {".validate": false}` sentinel (`rosters` ×2,
  `roleChoices` ×2, `reports/scenarios` ×1). The participant-writable free-text
  nodes — `moduleA/chat/$turnId`, `hypotheses/$entryId`, `promptReplies`,
  `exchangeReplies`, `scoring/awarded`, `score/auto` and `penalties`, `events`,
  `votes/$voteId/committed`, `uidMembers`, `members`, `callForHelp` — do **not**.
  Unknown-key and oversized-field injection there is an open hardening item,
  tracked in the repository's own security notes.

## 3. Administrator authentication

- The facilitator's session password is hashed client-side with **PBKDF2-SHA256,
  100,000 iterations**, salted with the session identifier.
- The real hash is stored in a tree (`adminSecrets/`) with **no read rule at
  all**, so no client can read it — closing an offline hash-cracking oracle.
  Verification works by a **proof-write**: the client writes its candidate hash
  and the database rule accepts the write only if the candidate equals the stored
  value, so the comparison happens server-side and the hash never travels to a
  client.
- The hash can only be overwritten by the user who initiated a recovery reset
  (their UID is recorded and checked), and can only be set initially by the
  session creator. This closes a race in which another user could seize an
  in-creation session.
- Account passwords (Google or email/password sign-in is optional) must be at
  least 8 characters and use at least 3 character classes.

## 4. Application-layer hardening

- Content-Security-Policy: `default-src 'self'`, `style-src 'self'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
  `frame-ancestors 'self'`, with a narrow allowlist for Google, Firebase and
  reCAPTCHA endpoints.
- `X-Content-Type-Options: nosniff`; `X-Frame-Options: SAMEORIGIN`;
  `Referrer-Policy: strict-origin-when-cross-origin`;
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`;
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
- No third-party analytics or advertising origins are permitted by the CSP.
  Fonts are self-hosted; the HTML sanitiser and PDF library are vendored locally.
- **Where Google script actually loads — corrected.** A live reCAPTCHA v3 key
  means Google origins load on the **application page** (`index.html`) and the
  Firebase SDK loads from `www.gstatic.com` on the **certificate-verification
  page** (`verify.html`). They do **not** load on `privacy.html` or
  `compliance.html`, which reference no Google origin at all. Any blanket claim
  of "no third-party requests" is inaccurate for the application; any claim that
  Google script loads on "every page" is also inaccurate. [TO VERIFY which
  cookies reCAPTCHA actually sets, before repeating the "no third-party cookies"
  claim in the notice.]
- HTML in queued emails is sanitised through a tight allowlist before sending.

## 5. Language-model proxy controls

- The API token for the language-model provider lives in Google Secret Manager
  and **never reaches the browser**.
- Every call is checked server-side for **room membership** before anything is
  sent to the provider.
- The provider URL is **allowlisted to `*.huggingface.co`**, so a misconfiguration
  cannot leak the token to an arbitrary host.
- A **server-authoritative system instruction** is prepended to every request and
  cannot be removed or overridden by the browser, which blocks persona
  replacement and prompt-extraction attempts.
- Request validation: at most 16 messages and 12,000 characters per call; replies
  truncated at 600 characters; the language parameter allowlisted to `en`, `fr`,
  `ja`.
- Rate limits: **40 turns per user per hour**, **200 per user per day**, **250 per
  session per hour**, and a **global cap of 4,000 turns per day**. Over the cap the
  system degrades gracefully to a local scripted patient rather than failing.
- Provider error bodies are **not** forwarded to the browser.
- **These are controls on the call, not on the recipient.** They do not identify
  who receives the content (clause 6.4), do not establish a transfer mechanism
  (Annex IV), and do not create an APPI Art. 28 basis (clause 12.4(e)).

## 6. Bot and abuse resistance

- Firebase App Check with reCAPTCHA v3 is wired client-side and a real site key
  is configured.
- **Disclosed:** enforcement is currently **OFF**. The Cloud Function is set to
  `APP_CHECK_ENFORCE=false` (verified in the environment file), and the database
  was deliberately reverted from *Enforce* to *Monitor* after enforcement caused
  total service outages — when reCAPTCHA intermittently failed to mint a token,
  every client lost all database access. Tokens are still sent and observed; they
  are not required. The database rules, not App Check, are the security boundary.
  [TO VERIFY the current Realtime Database App Check state in the Firebase
  Console — it cannot be checked from the code.]

## 7. Availability and resilience

- Daily automated backup of all session data to a private Cloud Storage bucket
  configured with uniform bucket-level access and public-access prevention, with
  the administrator password hash stripped from every record. The job fails loudly
  rather than silently writing PII into world-readable CI logs.
- Object lifecycle rules delete backups and pseudonymised exports after 90 days
  and re-identification linkage tables after 14 days.
- Retention jobs run in "quiet" mode because the repository is public, so session
  codes and error text never appear in world-readable logs.
- **Disclosed:** these jobs run as scheduled GitHub Actions workflows on a public
  repository, with **no alerting on a skipped or failed run**, and a dry-run
  configuration **exits successfully without deleting**. See clause 10.3 and
  Annex VI, item G11.
- [TO VERIFY: that the bucket exists with these settings and that the four
  scheduled workflows are currently running successfully.]

## 8. Testing and governance

- Unit tests cover the pseudonymiser, the language-model helper logic and the
  database rules; an emulator-backed suite functionally tests the rules
  (including cross-room denial and administrator-hash race conditions); a
  Playwright end-to-end suite covers desktop and mobile.
- Multiple documented security review rounds have been carried out, with findings
  and accepted risks recorded in the repository.
- Dependency updates are monitored automatically, including the Cloud Functions
  dependencies.

## 9. Measures the Processor does NOT currently have

Stated plainly so the Controller does not over-rely on this Annex:

- no formal ISO/IEC 27001 or SOC 2 certification of the Processor itself;
- no DPIA, no record of processing activities, and no formal sub-processor
  register other than Annex III;
- **no written confidentiality undertakings on file** for the persons with
  production access (clause 4.1);
- no penetration test by an independent third party [TO VERIFY — none found];
- no automated deletion for several data categories (Annex VI, G5–G9);
- **no monitoring or alerting on the retention, backup and export jobs**
  (Annex VI, G11);
- **no per-controller isolation and no per-session configuration**: all
  facilitators share one Firebase project, one deployment-wide language-model
  switch, and one deployment-wide retention setting (Annex VI, G10);
- no Japanese-language security policy (Annex V.3).

---

# ANNEX III — Authorised sub-processors

The **APPI characterisation** column matters because APPI and GDPR classify these
recipients differently. Under PPC guidance a foreign cloud provider that is
contractually barred from handling the personal data, and does not in fact handle
it, is **not a third party at all** — no Art. 28 foreign provision arises, and the
duty that applies instead is 外的環境の把握 (understanding the external
environment) under Art. 23. A provider that actually processes the content to
produce output — as Hugging Face and its downstream providers do — falls
**outside** that exception and needs an Art. 28 basis.

| # | Sub-processor | Service | Personal data it receives | Location | APPI characterisation |
|---|---|---|---|---|---|
| 1 | Google (Firebase / Google Cloud) — [EXACT CONTRACTING ENTITY TO CONFIRM] | Hosting, Realtime Database, Authentication, Cloud Functions, Cloud Storage | All data in Annex I §5 | Database and the mail function in `europe-west1` (Belgium); **the language-model proxy function in `us-central1` (USA)**; Hosting on Google's global edge | **Candidate cloud exception** (no Art. 28 provision; 外的環境の把握 applies) — [TO VERIFY against the actual Google contract terms with Japanese counsel] |
| 2 | Google (reCAPTCHA v3 / App Check) | Bot resistance | Participant IP address and browser signals, on the application page | Google; not region-pinned [TO VERIFY] | [TO VERIFY] |
| 3 | **Hugging Face** — [EXACT LEGAL ENTITY AND ADDRESS TO CONFIRM] | Inference Providers router for the simulated-patient character | The scenario system prompt plus **participant free-text chat turns** (up to 16 messages / 12,000 characters per call) | Outside the EU [TO VERIFY exact location] | **Art. 28 foreign provision** — it processes the content to generate output, so the cloud exception does not apply |
| 4 | **Hugging Face's downstream inference providers** — the code names Together, Fireworks and Cerebras, but the handling provider **varies per request** | Actual model execution | Same as #3 | **Varies per request; presumed US** [TO VERIFY] | **Art. 28 foreign provision, with an unidentifiable recipient** — the destination country cannot be named, so the Art. 28(2) prescribed information cannot be given. **Not authorised under clause 6.1 until pinned and named here.** |
| 5 | GitHub (GitHub Actions) — [EXACT CONTRACTING ENTITY TO CONFIRM] | Runs the scheduled retention, backup, export and cost-monitoring jobs | **Receives and processes on US infrastructure a nightly copy of the entire identified `/sessions` tree, including free-text chat, writes it to the runner's local disk, and generates the real-name → pseudonym linkage table there.** Job logs are configured to contain no PII | US | **Candidate cloud exception is doubtful** — the runner materially handles the data, not merely stores it [TO VERIFY with Japanese counsel] |
| 6 | [SMTP PROVIDER IDENTITY — Controller/Processor to confirm before enabling email] | Transactional email | Recipient email address, subject, message body | [TO VERIFY] | [TO VERIFY] |

**Notes.**

- Sub-processor #6 is **not active**: the mail feature is disabled in
  configuration (`EMAIL_ENABLED=false`, no SMTP host set) and the function records
  jobs as `disabled`. It must not be enabled until a provider is named here and a
  DPA with that provider is in place.
- The models used are `meta-llama/Llama-3.1-8B-Instruct` for English and French
  and `Qwen/Qwen2.5-7B-Instruct` for Japanese.
- The Firebase Cloud Storage bucket is configured in the client but **no
  client-side use of it was found in the code**; the archive bucket used by the
  retention jobs is a separate private Google Cloud Storage bucket.
- **[TO VERIFY for every row: that a written data processing agreement and, where
  the recipient is outside the EEA and not covered by adequacy, a valid Chapter V
  transfer mechanism, are actually in force. No such contracts are evidenced in
  the repository. Under clause 6.3 the Processor may not engage a sub-processor
  before both are in place.]**

---

# ANNEX IV — International transfer mechanisms

| Route | Mechanism relied on | Status |
|---|---|---|
| EEA → Japan (participants, partner institution) | **European Commission adequacy decision for Japan** (2019, maintained on review), plus the PPC **Supplementary Rules** for EU-origin data | Adequacy is a firm legal fact; **applying the Supplementary Rules on the Japanese side is [TO VERIFY]** — clause 12.2 now sets them out as obligations |
| Japan → EEA (data written into the EU-hosted database) | Japan's PPC has designated the EEA as offering an equivalent standard, so no separate foreign-transfer consent is required under APPI Art. 28 | [CONFIRM with Japanese counsel for this specific processing] |
| EEA → US (Google Cloud Functions `us-central1`, Cloud Storage, reCAPTCHA) | Google Cloud DPA incorporating the EU **Standard Contractual Clauses**, and/or EU–US Data Privacy Framework certification | **[TO VERIFY]** — acceptance for project `canamed-69785` and the current certification status cannot be checked from the repository. **Not executed as far as this draft can evidence** |
| EEA → US/elsewhere (**Hugging Face**) | **None identified** | **BLOCKING.** If no DPA/SCCs exist, the language-model character has no lawful transfer basis and must be disabled (clause 12.6) |
| EEA → onward inference providers via Hugging Face | Would require flow-down SCCs from Hugging Face to each provider | **BLOCKING** — the recipient varies per request, which makes a fixed assessment impossible until the account is pinned to one provider and region (clause 6.4) |
| EEA → US (**GitHub Actions — nightly full identified `/sessions` dump + linkage-table construction on a US runner**) | GitHub DPA/SCCs | **[TO VERIFY]** — and the scope is far larger than a credential at rest (clause 12.1) |
| Japan → US (any of the above, for Japanese participants) | APPI Art. 28: prior informed consent with the prescribed information, designated-equivalent country, or 基準適合体制 plus follow-up measures | **BLOCKING** — the US is not designated-equivalent; the destination cannot be named for the LLM leg; the join flow contains no foreign-transfer consent element (Annex VI, G4) |
| **EU-origin data → US, onward via the Japanese side** | Governed by the **restricted onward-transfer rule in the PPC Supplementary Rules**, in addition to GDPR Chapter V | **[TO VERIFY — not previously analysed.]** This route exists whenever EU-origin participant data reaches a Japanese counterparty and is then handled by a US recipient |

**Annex IV-A — executed transfer instruments.** *[TO BE ANNEXED BEFORE ANY
TRANSFER.]* The executed 2021 EU Standard Contractual Clauses are to be attached
here, with: the **module** identified for each route
[MODULE 2 (controller→processor) / MODULE 3 (processor→processor) — select per
route]; the exporter and importer **named** with addresses and signature blocks;
the docking clause elected or not; and Annexes I–III of the SCCs completed. No
route in the table above may operate before the corresponding instrument is
executed (clause 12.7).

**Transfer impact assessment: [NOT YET PERFORMED — overdue, since transfers are
already occurring. Controller to complete with Processor's technical input; scope
set out in clause 12.5.]**

**Art. 49 derogations: NOT RELIED ON** (clause 12.7).

---

# ANNEX V — APPI-specific provisions (Japan)

*To be reviewed by Japanese counsel. These provisions supplement, and do not
replace, the GDPR provisions above.*

**V.1 Status of the Parties.** APPI does not use the controller/processor
vocabulary. Where the Processor handles personal data solely on the Controller's
behalf and under its instructions, the Parties intend this to be **entrustment
(委託)** under APPI Art. 27(5)(i), so that the entrusted handling is not a
domestic third-party provision requiring the individual's consent.

> **Critical qualification — do not read V.1 as solving the transfer question.**
> The exemptions in **Art. 27(5) apply only to the domestic third-party-provision
> rule in Art. 27(1)**. They do **not** apply to **Art. 28**. Entrustment to a
> recipient **located outside Japan** remains a *foreign provision* and requires
> its own independent Art. 28 basis — consent with the prescribed information, a
> designated-equivalent jurisdiction, or 基準適合体制. Because this DPA's whole
> architecture is "Processor = 委託先" and the Processor's infrastructure sits in
> Belgium and Iowa, this distinction is load-bearing. See **V.4**.

[TO VERIFY with Japanese counsel that entrustment, rather than joint use
(共同利用), is the correct characterisation. The live privacy notice currently
asserts **joint use** between two universities — inconsistent with this DPA. See
Annex VI, item L1. Note also that the notice cites "Art. 27(5)" for joint use
without the item number; joint use is the **third** item, entrustment the
**first** — see Annex VI, item L9.]

**V.2 Supervision of the entrustee (APPI Art. 25).** The Controller must exercise
necessary and appropriate supervision over the Processor. The Processor supports
this by supplying the information in clause 11.2, by notifying sub-processor
changes under clause 6.2, and by supporting the audit rights in clause 11.

**V.3 Security control measures (APPI Art. 23).** The PPC's general guidelines
(通則編) appendix sets out **seven** items, not four:

1. 基本方針の策定 — formulation of a basic policy;
2. 個人データの取扱いに係る規律の整備 — establishment of handling rules;
3. 組織的安全管理措置 — organisational measures;
4. 人的安全管理措置 — human measures (including supervision of employees; see
   clause 4);
5. 物理的安全管理措置 — physical measures;
6. 技術的安全管理措置 — technical measures;
7. **外的環境の把握** — understanding the external environment (V.3-bis).

The measures in Annex II are intended to address items 3–6. **[TO VERIFY that
items 1, 2 and 7 are each evidenced; the Processor has no formal
Japanese-language security policy at the draft date.]**

**V.3-bis 外的環境の把握 (understanding the external environment).** Where
personal data is handled in a foreign country, the operator must understand that
country's personal-information protection regime and implement security measures
in light of it. Separately, **APPI Art. 32(1)** with the Enforcement Rules
requires the operator to **make publicly available** the security control measures
taken, and PPC practice treats that as including **naming the foreign countries**
where the data is handled. The countries engaged here are:

| Country | What is handled there | Basis for knowing |
|---|---|---|
| **Belgium** (`europe-west1`) | The Realtime Database (all session data), the mail function, the private archive bucket | Verified in config |
| **United States** (`us-central1`; GitHub Actions runners) | The language-model proxy; the nightly full identified `/sessions` dump and the linkage-table construction | Verified in code |
| **Unidentifiable** | Hugging Face's downstream inference provider, which varies per request | Verified in code — and this is the problem |

**The last row defeats both duties.** An operator cannot understand the regime of
a country it cannot name, and cannot publish the list Art. 32(1) requires. This
is recorded in Annex VI, item G4, and is a further reason the feature must be
pinned or disabled (clause 6.4).

**V.4 Foreign transfer (APPI Art. 28).** Where personal data of individuals in
Japan is transferred outside Japan — which happens for **every** language-model
chat turn, because the proxy function runs in the United States — the Controller
must have secured one of the permitted routes **before** the transfer, and must
provide individuals, **before consent**, with the Art. 28(2) prescribed
information: the **name of the destination country**, information about **that
country's protection regime**, and the **measures the recipient takes**. The
Processor supplies the destination and safeguard facts in Annex III and Annex IV.
See V.1's qualification: entrustment does not excuse this. As at the draft date
none of the three routes is available for the LLM leg (clause 12.4(e)).

**V.5 Retention of foreign-transfer information (APPI Art. 28(3)).** On request,
the Processor provides the information individuals are entitled to receive about
the recipient's protective measures, to the extent it possesses it.

**V.6 Personal-data breach reporting (APPI Art. 26).** See clause 9.4, including
the **Art. 26(1) proviso** mechanic by which the Processor's duty passes to the
Controller.

**V.7 Individual rights (APPI Arts. 33–35).** The Processor assists the
Controller with disclosure (Art. 33(1)), disclosure of third-party provision
records (Art. **33(5)**), correction/addition/deletion (Art. 34), and cessation of
use, erasure or cessation of third-party provision (Art. 35, **including
Art. 35(5)**), subject to the practical limits in clause 7.4.

Two structural points:

- **The Processor holds no 保有個人データ of its own** in respect of the entrusted
  data: Art. 16(4) turns on the authority to disclose, correct or cease use, which
  an entrustee does not have. Every request therefore routes to the Controller —
  which is the correct answer to clause 7.2 on Japanese grounds as well as GDPR
  grounds.
- **All session data is 保有個人データ regardless of how briefly it is held.** The
  pre-2020 six-month exemption is repealed (clause 10.6).

**V.8 Academic research.** If the Controller relies on an APPI academic-research
provision, it must document that reliance and the corresponding GDPR basis
separately — the two regimes' research carve-outs are not the same, and the APPI
carve-outs are **entity-based** (学術研究機関等 under Art. 16(8); see clause 1).
The current privacy notice cites GDPR Art. 9(2)(j) with Art. 89 and APPI
Art. 20(2) for a *specific* study that a third-party facilitator does not inherit.
[CONTROLLER TO STATE its own legal bases — see the table in clause 3.6(a).]

**V.9 Japanese counterparty.** [JAPANESE COUNTERPARTY ENTITY — if the Japanese
side is a separate institution, name it and state:
(i) **APPI status**: 個人情報取扱事業者 / a public body brought under the
private-sector chapter [TO VERIFY the governing article with Japanese counsel] /
other;
(ii) **学術研究機関等 under Art. 16(8)**: yes / no;
(iii) if no, confirm no reliance on any APPI academic-research exemption;
(iv) **role**: controller, joint controller, or entrustee;
(v) confirmation that it will apply the Supplementary Rules obligations in
clause 12.2 to EU-origin data.]

**V.10 Processed-information categories — 仮名加工情報 / 匿名加工情報.** The
research export produced by `scripts/pseudonymise-export.js` is **neither**:

- It is **not 匿名加工情報** (Art. 43): that category requires the linkage
  information to be **destroyed**, imposes a public-announcement duty about the
  categories of items contained, and bars re-identification attempts. This export
  **retains** a real-name → pseudonym linkage table for 14 days.
- It is **not asserted to meet the 仮名加工情報 standard** (Art. 41), nor the
  Art. 41(2) security duty over the 削除情報等.
- Free-text answers survive the transform verbatim (Annex II §1), so the output
  is not de-identified in substance either.

**It therefore remains 個人データ.** Consequences: (a) any provision of the export
to a research collaborator is an Art. 27 **third-party provision**, and an
Art. 28 **foreign provision** if the collaborator is outside Japan; (b) no such
provision may occur without the Controller's written instruction and its own
basis; (c) if the Parties later want 匿名加工情報 status, the linkage table must be
**destroyed**, not retained for 14 days, and the Art. 43 announcement duty
performed. See Annex VI, item R7.

**V.11 要配慮個人情報 — acquisition.** See clause 3.6(d). The Controller warrants
prior Art. 20(2) consent, or 学術研究機関等 status with academic-research
necessity, before any free-text field is opened to a Japan-resident participant.
The join flow provides **no Art. 20(2) consent element** today (Annex VI, L9/G4).

**V.12 Art. 32(1) public disclosure.** Each Controller publishes its own
Art. 32(1) statement (clause 3.6(c)). The Processor supplies the security-measure
and foreign-country facts needed for it (Annex II, V.3-bis).

---

# ANNEX VI — Disclosed limitations and known gaps

**This Annex exists because GDPR Art. 28(3), final paragraph, obliges the
Processor to tell the Controller when the arrangement does not work. It is
written against the code, not against intentions. It must be read before
signature.** Items marked **BLOCKING** are **conditions precedent** under
clause 5.4: they must be closed, or the corresponding feature disabled, before
the DPA takes effect and before any participant is onboarded. This Annex is a
standing disclosure and is **not** deleted at signature (clause 5.5).

> **Numbering note.** Version 0.1 of this draft used a non-contiguous G-series
> (G2–G5, G8) with no G1, G6 or G7, which reads as though findings were removed.
> The series is renumbered contiguously in this version. Mapping from 0.1:
> old G2 → **G5**; old G3 → **G6**; old G4 → **G7**; old G5 → **G8**;
> old G8 → **G9**. G1–G4 and G10–G12 are new. In the legal series, old L2 → **L3**,
> old L3 → **L4**, old L4 → **L5**, old L5 → **L6**, old L6 → **L11**;
> L2, L7–L10, L12 and L13 are new.

## Legal-text gaps

**L1 — BLOCKING. The live privacy notice names the wrong controller.**
`privacy.html` §1 declares Caen and Nagoya joint controllers under GDPR Art. 26
and 共同利用 under APPI Art. 27(5), with Caen's DPO as the sole rights contact.
The same framing appears in the join-screen string `lobby.privacy.p1` (`i18n.js`)
and in the hard-coded fallback in `index.html`. Under this DPA the facilitator's
institution is the controller. Participants would be told something false at the
moment of collection. The notice, the join screen, and the hard-coded
consent-version string (`PIS v2 · 2026-05`) must be made controller-specific and
the version string generated rather than literal.
*(Correction to v0.1: `compliance.html` carries **no** controller allocation —
verified, the only match for "controller" on that page is the phrase
"data-protection (DPO) review". The v0.1 citation of it here was wrong. Its
actual defects are L2.)*

**L2 — BLOCKING (new). `compliance.html` makes claims the code contradicts.**
This is the page that advertises itself as supporting "institutional governance,
data-protection (DPO) review and accreditation (HCERES / JACME)" — in practice
the first page a reviewing DPO reads. Verified defects:

| Claim on the page | Reality |
|---|---|
| "No third-party trackers" badge; "no third-party script origins" | A live reCAPTCHA v3 key loads Google script on the application page; `verify.html` loads the Firebase SDK from `www.gstatic.com` |
| "abuse protection via Firebase App Check (reCAPTCHA)" presented as a live control | App Check enforcement is **off** in both places (`APP_CHECK_ENFORCE=false`; RTDB reverted to Monitor) |
| "exports and all reporting are aggregate and pseudonymous by default — no individual is named" | False for the nightly **identified** backup and for the facilitator's identified roster CSV |
| "a fully trilingual interface" | The workshop UI renders **in English only** — see L7 |
| "Residency: data is stored on Google Firebase" | Omits `us-central1` and the US GitHub Actions leg |

**L3 — BLOCKING. The published retention period is wrong.** All three language
versions of the notice, and the join screen, say live session data is purged
"within 7 days". The implemented job purges 30 days after close and 90 days if
abandoned. Fix the code, the text, or both.

**L4 — BLOCKING. The language model and its providers are not in the notice.**
A search of `privacy.html` for "language model", "LLM", "chat" or "sub-processor"
returns nothing; the recipients section lists only Google. Hugging Face is
disclosed **only** in an in-product banner. The notice must disclose: that a
language model processes what students type; that Hugging Face and its downstream
providers receive it; and that this leaves the EU for the United States and
onward. Two whole data categories are also absent from the notice: **roster
emails** (`rosters/`) and the **LLM usage log** (`metrics/hfPatient`).
*(A related documentation defect: `CLAUDE.md` claims "privacy notice updated (HF
disclosed as sub-processor)". That claim is true of the banner only, not of the
notice, and should be corrected in the same change.)*

**L5 — BLOCKING. The French and Japanese notices state a different legal basis
and a different retention period from the English one.** For the certificate
registry, English states verification is on by default under legitimate
interests with up to 5 years' retention; French and Japanese describe a third
optional consent checkbox, explicit consent, and up to **10 years**. **The user
interface has only two checkboxes** (`consent-workshop`, `consent-research`) —
the control the French and Japanese texts describe does not exist — and the code
writes a retention date just under 5 years, capped by a database rule at about
5 years (`157680000000` ms). French- and Japanese-speaking participants are
therefore reading an inaccurate description of both the basis and the period.
"English governs if there is a conflict" does not cure a GDPR Art. 12(1) or APPI
Art. 21 defect (clause 13.4).

**L6 — BLOCKING (widened from v0.1). Hard-coded fallback text in the page
contradicts the runtime strings, on exactly the claims that matter.** The runtime
i18n values are correct in every case; the literal HTML that ships in
`index.html` — which is what a participant reads if the i18n layer fails to apply
— is not. Verified:

| Element | Hard-coded fallback says | Runtime string says |
|---|---|---|
| `lobby.privacy.p3` | contributions kept "**pseudonymised** for up to 5 years" | "kept **linked to you (identifiable)** for up to 5 years" |
| `test.pre.intro` | pre-test is "**anonymous within your university**" | "your answers are **linked to you** for the CaNaMED study" |
| `test.post.intro` | post-test is "**anonymous within your university**" | "your answers are **linked to you**…" |
| `survey.intro` | "a short, **anonymous** questionnaire" | "Your answers are **linked to you**…" |

The two test intros are pre-collection statements about a *different* dataset
than the questionnaire, and the tests are stored at `rooms/$roomId/tests/$cid`
keyed to a client id bound to `auth.uid` — not anonymous in any sense (and
peer-readable, G2). **Fix:** make every fallback identical in meaning to the
canonical string, and add a unit test asserting that no fallback makes a
data-protection claim the runtime string contradicts.

**L7 — BLOCKING (new). The consent and join UI renders in English only.**
`i18n.js`'s `t()` function begins `const useLang = "en";` with the comment that
"the ENTIRE workshop UI renders in English for everyone — consent included". The
FR/JA/ES/PT/DE/KO/ZH tables under `locales/` are dead for the application; only
the standalone `privacy.html` keeps reviewed FR/JA bodies, via its own separate
mechanism. So a Japanese student ticks an **English** consent box, then follows a
link to a Japanese notice that (per L5) states a different legal basis and a
different retention period, and describes a checkbox that does not exist. Under
GDPR Art. 12(1) and APPI Art. 21 the information must be intelligible **to the
person giving it**.

**L8 — BLOCKING (new). The consent architecture asks participants to attest to
reading something they were never shown.** Verified: `index.html` renders the
data-use notice as `<details class="privacy-note">` **with no `open`
attribute**, and `script.js` only ever *removes* `open` (on narrow viewports) —
it never adds it. The code comment claiming the notice "is marked `open` by
default" is stale. The notice is therefore **collapsed on every viewport,
desktop included**. The required checkbox reads "**I have read the data-use
notice above** and consent to taking part". **Fix:** either open the `<details>`
by default (solving the mobile scroll problem another way), or move the three
load-bearing sentences — who can read your text, that it goes to an AI provider
abroad, and how long it is kept — inline next to the checkbox, and reword the
label to what it actually attests.

**L9 — BLOCKING (new). APPI citations in the live notice are inaccurate.** The
Controller will be handed this notice, so the errors are listed here. Verified in
`privacy.html`:

1. §12 cites "**APPI 第26条の3**" for automated decision-making. **No such
   provision exists** in the amended Act, and APPI has no automated-decision rule
   at all. (Art. 26 is used correctly two sections later, for breach reporting.)
2. §1/§3 cite "Art. 27(5)" for joint use without the item number. Joint use is the
   **third** item; entrustment is the **first**. This DPA gets it right at V.1, so
   the notice and the DPA currently disagree.
3. §14 tells participants under **20** to contact the facilitator — a threshold
   left over from the pre-2022 age of majority, now **18**. See L10.
4. §9 lists **Art. 38** (which concerns fees for disclosure requests) among the
   *rights themselves*.
5. There is **no Art. 20(2) consent element** anywhere in the join flow, although
   §3 cites Art. 20(2) as a basis (clause 3.6(d), V.11).

Correct these in the same change as L1–L5, so a Japanese participant is not
reading a notice that cites a non-existent article.

**L10 — BLOCKING (new). The age position is self-contradictory and there is no
age gate.** `privacy.html` §14 says the platform is "intended for adult medical
students aged 18+" and, in the next sentence, tells anyone "under 16 (GDPR Art. 8)
or under 20 (Japanese university norms)" to contact their facilitator — i.e. it
actively contemplates minors joining. There is no age attestation in the join
flow. French first-year medical students are routinely 17, and the processing
involves explicit consent for special-category data. **[TO VERIFY with counsel:
France set the GDPR Art. 8 digital-consent age at 15, not the Art. 8 default of
16, so "under 16" is likely the wrong threshold for a French cohort.]** Reconcile
the statements, confirm the correct national threshold, and either add an age
attestation at join or rely on the clause 3.6(e) Controller warranty.

**L11 — HIGH. There is no DPIA, no record of processing activities, no signed
processor contract, and no confidentiality undertakings on file.** The operator
policy still carries `[to be added]` placeholders for the DPO and the responsible
investigators, while the live notice names "the DPO" as the single rights contact.

**L12 — HIGH (new). Runtime strings hard-code "the CaNaMED study".**
`i18n.js` `test.pre.intro`, `test.post.intro` and `survey.intro` (mirrored in
`locales/fr.js` and `locales/ja.js`, plus the `index.html` fallbacks) tell
students their answers "are linked to you **for the CaNaMED study**". Under this
DPA the controller is the facilitator's institution, which is not party to that
study. A facilitator who worked only through L1 would still ship a product telling
students their data goes to a research project that does not exist for them.
**Fix:** add these strings to the L1 change set and make the study/controller name
a configurable token rather than literal text.

**L13 — HIGH (new). The published rights mailbox and response promises are the
Processor's, not the Controller's — and one of them cannot be met.**
`privacy.html` §9 (and the FR/JA equivalents) direct participants to
`canamed-ethics@unicaen.fr` with "acknowledged within 5 working days; response
within 30 days", while clause 7.2 says the Processor does not respond
substantively. Separately, §18 promises certificate-registry removal "**within 5
working days**" in all three languages, but `credentials/$certId` permits writes
only when `!data.exists()` — **no client can delete it** — so removal is a manual
Admin-SDK operation. Clause 7.5 sets the certificate SLA at ≤ 5 working days for
that reason; the mailbox and every published response time must be changed to the
Controller's before any session runs.

## Functional gaps in deletion and rights

**G1 — BLOCKING (new). The research export ignores research consent entirely.**
Verified: `scripts/pseudonymise-export.js` selects sessions with
`codes.filter(c => sessions[c] && sessions[c].closed)` — **the only filter is
`closed`**. The per-participant research-consent flag (`pool/$cid/consent`) is
never read. Consequently **every participant of every closed session** is written
into the research export, and into the **real-name → pseudonym linkage table**,
including participants who ticked the workshop box and deliberately left the
research box unticked. That directly contradicts what `privacy.html` §2(3) and the
`lobby.consent-research` string promise them.

This is not a paperwork gap. It is live processing on the operator's own daily
schedule (03:47 UTC) without the basis the participant was told applied, and it
should be remediated on its own timetable, ahead of the DPA's.
**Fix:** filter **both** artefacts on the research-consent flag, dropping
non-consenting participants' rows entirely (not merely pseudonymising them); add
a unit test asserting a non-consenting participant appears in neither file; keep
this item open until that test is green.

**G2 — BLOCKING (new). Knowledge-test results and wrap-up questionnaire answers
are readable by every other participant.** Verified: `sessions/$sessionId` grants
`.read` on the **whole subtree** to any member; `rooms/$roomId/tests/$cid` and
`rooms/$roomId/survey/$cid` have **no read rule of their own**, so they inherit
it. Only `moduleA/chat` is narrowed to its own room. A classmate with developer
tools can therefore read another student's pre/post-test score and their
**2,000-character written reflection** on the session and the facilitator —
while the product tells them (L6) the test is "anonymous within your university"
and the questionnaire is "anonymous". **Fix:** narrow the read gate on `tests`
and `survey` to the writer plus the facilitator before any session runs under this
DPA. *(This is listed as a functional gap, not a residual risk: whole-session
visibility is a deliberate design choice for collaborative room work — see R1 —
but a false statement made at the moment of collection is not a risk to accept.)*

**G3 — BLOCKING (new). Session metadata is readable across tenants.** Nine child
paths of `sessions/$sessionId` carry a bare `".read": "auth != null"` with **no
membership test**: `adminPasswordHash`, `creatorUid`, `created` (containing the
facilitator's display name), `workshopLabel`, `scenarioId`, **`scenarioCustomJson`
(up to 262,144 characters of authored scenario)**, `scenarioRef`, `closed`,
`summary`. Session codes are ~30 bits and explicitly not secret. Under the
facilitator-as-controller model, any anonymous participant in Facilitator A's
session can read Facilitator B's name, workshop label and **entire authored
scenario** for any code they know or enumerate. v0.1 disclosed only the
`adminPasswordHash` marker. **Fix:** gate these on
`members.hasChild(auth.uid)`, with whatever narrow pre-join exception the join
chain actually requires (the admin-hash marker is separately justified — see R2
note in v0.1 and the repository's security notes).

**G4 — BLOCKING (new). Japan-resident participants are exposed to the
language-model character with no APPI Art. 28 basis.** Every Module A chat turn
from a Japan-resident participant is a provision of 個人データ to a third party in
a foreign country: `hfPatient` runs in `us-central1`, and the Hugging Face router
then forwards to a provider that changes per call. The US is not a
PPC-designated equivalent jurisdiction; 基準適合体制 cannot be concluded with an
unidentifiable recipient; and Art. 28(1) prior consent is impossible because
Art. 28(2) requires the **destination country to be named before consent** and the
join flow has no foreign-transfer consent element. The chat is **on by default**,
so this affects every session with a Japan-resident participant. It also defeats
外的環境の把握 and the Art. 32(1) publication duty (Annex V.3-bis).
**Fix — either:** (a) pin the Hugging Face account to a single named provider and
region and document an Art. 28 route; **or** (b) implement a separate,
pre-collection foreign-transfer consent carrying the Art. 28(2) prescribed
information in the join flow. Until one is done, Japan-resident participants must
not be exposed to the language-model character — which, given clause 6.5's
deployment-global switch, means the feature is off for everyone until G10 is also
closed.

**G5 — HIGH. Participant email addresses are never deleted.** The roster path sits
outside `sessions/`, so the cleanup job never sees it, the backup never captures
it, and the pseudonymiser never touches it. Retention is effectively indefinite.
The facilitator can export it as an identifiable CSV. The privacy notice does not
mention it. **Storage limitation is not met for this category** without a manual
process. [CONTROLLER-CHOSEN RETENTION — ROSTER EMAILS: ____ ]

**G6 — HIGH. Certificate records are never deleted.** Each record carries a
`retentionUntil` value and the notice promises up to 5 years, but **no job reads
or acts on that field**. The records are readable by anyone who knows the exact
certificate identifier, with no authentication, and no client can delete one (the
rule permits writes only when `!data.exists()`). **Fix:** ship a `retentionUntil`
sweeper. [CONTROLLER-CHOSEN RETENTION — CERTIFICATE RECORDS: ____ ]

**G7 — HIGH. The language-model usage log is undisclosed, unbounded and
unreachable.** `metrics/hfPatient/events` records the auth UID, timestamp,
language, message and reply sizes, latency, HTTP status, the inference provider
and the **session code** for every turn, plus per-user hourly and daily counters.
The path has **no database rule**, which means (a) it is already unreadable and
unwritable from any client — the absence of a rule is a denial, not a hole — but
also (b) it **cannot be surfaced through any in-product access request**, so an
Art. 15 response that omits it is incomplete. It is not mentioned in the notice
and no job deletes it. **Fix:** add a TTL; add it to the Art. 15 runbook
(clause 7.6); classify it under clause 2.4; and — as documentation, not as a
control change — consider adding an explicit `.read: false` so the invisibility
is deliberate rather than incidental.

**G8 — MEDIUM. Account profiles, admin secrets, recovery records, authored
scenarios, abuse reports and moderation records** have no automated deletion.

**G9 — BLOCKING. The entire `orgs/` tree is outside every safeguard.** It mirrors
the same participant, answer, chat and questionnaire model, but **no script
references `orgs` at all** — verified: the only database paths any retention
script touches are under `sessions`. If organisation-scoped sessions are used,
retention, backup and pseudonymisation silently do not happen. Some rules are also
absent in the org tree (the qualitative poll, answer replies, observers), so those
writes fail closed. Clause 3.8 makes the prohibition operative: **do not enable
org-scoped sessions under this DPA until this is fixed.**

**G10 — BLOCKING (new). There is no per-session configuration, so no Controller's
instruction can be executed in isolation.** `MODA_LLM_ENABLED`,
`CLEANUP_RETENTION_CLOSED_DAYS` and `CLEANUP_RETENTION_OPEN_DAYS` are
deployment-wide environment values. Honouring one Controller's instruction to
disable the language model or shorten retention imposes it on every other
facilitator — which means the Processor cannot give unqualified Art. 28(3)(a)
undertakings (clause 3.3). **Fix:** make `llmEnabled`, `retentionClosedDays` and
`retentionOpenDays` per-session values in the session record; have
`cleanup-stale-sessions.js` read the per-session value with the environment
variable as a **ceiling**; have `hfPatient` check the session flag before calling
any provider.

**G11 — HIGH (new). The retention, backup and export jobs have no monitoring.**
They are scheduled GitHub Actions workflows on a public repository. There is no
alerting on a skipped or failed run; a dry-run configuration (`CLEANUP_CONFIRM=0`)
**exits 0 without deleting**, so a misconfiguration shows green; and GitHub
disables `schedule:` triggers on repositories inactive for 60 days. This failure
has already occurred once on a related repository (~11 days undetected). Since
clause 10.3 is the Controller's storage-limitation evidence, this is where the DPA
is most likely to become untrue after signature. **Fix:** failure alerting plus
the periodic verification report in clause 10.3. Consider moving the jobs to
Cloud Run / Cloud Scheduler in `europe-west1`, which also removes the US GitHub
leg from Annex IV.

**G12 — BLOCKING (new). Withdrawal does not produce erasure.** Consent flags are
recorded per participant, but withdrawing research consent deletes nothing, there
is no per-participant restriction flag, and there is no post-session
rectification. Where consent is the asserted basis (as the live notice asserts),
GDPR **Art. 17(1)(b)** makes erasure the automatic consequence of withdrawal and
**Art. 7(3)** requires withdrawal to be as easy as giving it; APPI **Art. 35(5)**
provides a parallel route. Clause 10.1 promises Art. 28(3)(g) deletion that the
system cannot presently perform in full. **Fix:** an in-product withdrawal that
removes the participant across `pool`, the room subtrees and `rosters`, plus the
sweepers in G6 and G7.

## Residual risks accepted by design

*These are the items the Parties have considered and accepted for the supervised-
classroom context in clause 5.6. Clause 5.3's acknowledgement extends to these
only.*

**R1 — Whole-session visibility (within a session).** Any authenticated session
member can read the entire session subtree, including other rooms' structured
work and the full participant list. This is deliberate classroom transparency and
it is what makes cross-room observation and facilitator oversight work; it is
retained as designed. **But three consequences are not accepted:** the notice
currently suggests contributions are shown only "to others in that room"
(`privacy.html` §2) and must be corrected to say what actually happens; the test
and questionnaire nodes must be narrowed out of this grant (G2); and the
**free-text AI-patient chat has been removed from this grant entirely** —
✅ done 2026-07-24, PR #235, deployed.

> *Updated 2026-07-24.* The chat now lives in a top-level `roomChat/` tree with
> its own per-room read gate (room members + the facilitator). Note for anyone
> reasoning about the remaining nodes: the chat was **already** subject to a
> room-scoped `.read` rule before this change, and that rule restricted
> **nothing** — RTDB `.read` cascades from `sessions/$sessionId` and cannot be
> revoked at a deeper path. Narrowing G2's test/questionnaire nodes therefore
> **cannot** be done by adding a deeper rule either; those nodes must be moved
> out of the session subtree the same way, or the residual risk accepted and
> disclosed.

**R2 — Certificate identifiers and the name hash — corrected.** v0.1 stated that
"enumeration is impractical only because the client identifier carries about 80
bits of entropy". **That was wrong and is corrected here.** The 80 bits is the
`clientId` *input*; `canamedCertId()` feeds the seed through `hashStr` — a
cyrb53-style **non-cryptographic** hash yielding roughly 53 bits — and then emits
**10 Crockford base-32 characters, so the identifier keyspace is at most 2⁵⁰**,
enforced by the rule regex. The record is `".read": true` with **no
authentication**. So: certificate IDs are ≤50 bits, produced by a **public,
deterministic, non-cryptographic** function of the (non-secret) session code and
the participant's client id, and are world-readable by exact ID.
**Recommended fix:** adopt the cryptographically-random `randomCredentialId()`
that already exists in `pure-utils.js` and is never called. Separately, the stored
name hash is **unsalted by design** and sits beside the plaintext session code, so
it can be tested offline against a small candidate list for a known cohort. The
notice's statement that "only a one-way hash of your name is ever stored" is
literally true but incomplete.
*(Related documentation defect: `CLAUDE.md` described certificate IDs as
"crypto-random high-entropy" in two places — once as an accepted residual risk.
✅ **Corrected 2026-07-24**: both claims are now marked false, the acceptance is
**withdrawn** pending a decision, and the finding is recorded as the fifth
Phase-4e gap. This R2 analysis was independently re-verified against the code on
the same date and is accurate: `randomCredentialId()` is defined **and
unit-tested** in `pure-utils.js` but has no production caller; `resolveCertId()`
([script.js](../script.js) ≈7331) uses the deterministic `canamedCertId()`.)*

> **Why the recommended fix is not a one-liner.** The determinism is load-bearing:
> re-downloading a certificate must yield the **same** ID, or the write-once
> `credentials/` entry stops matching and each download mints a second credential.
> Adopting `randomCredentialId()` therefore requires persisting the minted ID per
> participant so a re-download reuses it. That is a small data-model change, not a
> swap of one function for another.

**R3 — Room assignment and first-write races.** A participant with developer
tools can reassign rooms, and there is a narrow window before identity bindings
commit in which a peer could write another participant's qualitative poll answer.
Both are accepted on the supervised-classroom assumption. **If poll data feeds
research analysis, poll integrity should be bound to identity ownership first.**

**R4 — Module A scoring is client-writable** within bounded limits and room
membership. Accepted because the activity is formative, not assessed. **If it
ever becomes graded, scoring must move server-side.**

**R5 — App Check is not enforced.** See Annex II §6. The database rules are the
real boundary.

**R6 — Third-party script claims — scope corrected.** The notice's "no
third-party cookies, no tracking pixels" claim sits alongside a live reCAPTCHA
integration. Corrected scope (v0.1 overstated this): Google script loads on the
**application page** and, via the Firebase SDK from `www.gstatic.com`, on the
**certificate-verification page**; `privacy.html` and `compliance.html` load no
Google origin at all. Reword the claim and verify which cookies reCAPTCHA sets.
The `verify.html` leg additionally discloses a **non-participant's** IP address to
Google with no notice — see clause 2.4.

**R7 — Free text survives pseudonymisation (re-identification vector).** The
research export drops chat but exports **verbatim** the five 2,000-character
questionnaire items, the room answers and replies, the Module A hypotheses and the
280-character poll free text. In a small cohort, a student's own writing can
identify them, and the questionnaire items may also identify the facilitator. The
Controller must weigh this in its DPIA. Under APPI the export is neither
仮名加工情報 nor 匿名加工情報 and remains 個人データ (Annex V.10).
**Recommended fix (not accepted as permanent):** apply the same drop-or-review
treatment to the long free-text items as to chat, or hold the export to a
reviewed-release process.

**R8 — Persistent research identifier in the browser (new).**
`canamed_stable_id` is an 80-bit identifier persisted in `localStorage` across
tabs, refreshes and sessions (cleared only on full sign-out), written into `pool`,
answer metadata and the test/questionnaire records, and existing — per its own
code comment — so researchers can **deduplicate participants across sessions**.
It serves a research purpose rather than service delivery, and appears nowhere in
the notice. **[CONTROLLER / DPO TO DECIDE its lawful basis, and whether it should
be set only for participants who ticked the research box.]**

---

## Open questions and drafting rationale

*This section records points where reviewers of the draft disagreed with the
text, or where the text deliberately stops short of a conclusion. It exists so
that a later reader does not "re-fix" something that was considered, and so that
no factual gap gets closed by guesswork.*

**Q1 — Is an explicit `.read: false` needed on `metrics/`?** A reviewer proposed
adding one "so the invisibility is deliberate, not accidental". The text keeps its
position that the path is **already unreadable**: Firebase Realtime Database rules
do not cascade permission downward from a denial, and the root is `.read: false`,
so a path with no rule grants nothing. Adding the explicit rule is **documentation
value, not a control change** — it is recorded that way in G7. The real defects at
that path are its invisibility to Art. 15 flows, its absence from the notice, and
the lack of a TTL.

**Q2 — The linkage-table retention inconsistency.** A reviewer read the script
header's reference to a "6-month linkage-destruction commitment" as contradicting
the 14-day lifecycle and asked which is "wrong in a signed document". Fourteen
days is **stricter** than six months, so the operational exposure is *lower*, not
higher; the defect is a documentation inconsistency. Additionally, **no six-month
linkage commitment could be found in `privacy.html`**, so what was published is
itself unverified. Clause 10.3 carries this as a `[TO VERIFY]` rather than
asserting either figure.

**Q3 — Whether the consent mechanism is legally invalid.** A reviewer concluded
that the mandatory workshop checkbox means "the workshop processing currently has
no lawful basis at all". The factual premise is verified and stated in
clause 3.6(a) (the checkbox is a hard gate on Join). The **legal conclusion is
not asserted** — it depends on facts outside the code (whether attendance is
curricular or elective, what alternatives exist, national implementations of
Art. 6(1)(e) for public universities) and is a judgement for the Controller's
counsel and DPO. The draft flags it, sets out the commonly proposed alternative
basis structure, and requires a documented position before signature. Asserting
unlawfulness in a draft neither Party's counsel has reviewed would be the same
error in the opposite direction.

**Q4 — Whole-session visibility: risk or defect?** A reviewer asked to reclassify
R1 wholesale from "accepted by design" to a blocking fix. The text **splits** it:
cross-room visibility of collaborative work is a genuine pedagogical design
choice and stays in R1; but the **test and questionnaire** nodes — which
participants are told are anonymous, and which contain 2,000-character personal
reflections including evaluations of the facilitator — are moved out into
**G2 (BLOCKING)**. The distinguishing principle: transparency about shared
classroom work is defensible; a false statement made at the moment of collection
is not.

**Q5 — APPI cloud exception for Google and GitHub.** A reviewer proposed
classifying Google's RTDB/Hosting/Storage as falling within the PPC "cloud
exception" (no Art. 28 provision; 外的環境の把握 instead). Annex III records this
as a **candidate** classification marked `[TO VERIFY]`, not as a conclusion,
because the exception turns on the **actual contract terms** (whether the provider
is contractually barred from handling the data) — which cannot be read out of this
repository. For GitHub the draft goes further and records that the exception is
**doubtful**, because the runner materially handles the data (clause 12.1).

**Q6 — "Google scripts load on every page".** v0.1's Annex II §4 and R6 said this.
Verified and **corrected**: `privacy.html` and `compliance.html` reference no
Google origin; the application page and `verify.html` do. Recorded here so the
broader claim is not reinstated.

**Q7 — The client-side `?llm=0` opt-out.** It exists and is sticky per browser,
but it is deliberately **not** presented anywhere in this DPA as a controller
control, because any participant can undo it and it does not bind the deployment.
Clause 6.5 says so explicitly.

**Q8 — Certificate registry: Art. 26 joint controllership?** Clause 2.4 raises
this as a question for counsel rather than deciding it. The registry is
operator-run, world-readable, outlives the session and is not the facilitator's to
delete — which points away from processor status — but whether the facilitator
co-determines the purpose (issuing verifiable attendance certificates for its own
students) is a legal judgement.

**Q9 — Executed SCCs.** A reviewer correctly noted that Chapter V is "drafted by
cross-reference, not by instrument". A draft cannot annex an executed instrument.
Annex IV-A is therefore a named, empty slot with the module, parties and
signature blocks to be completed, and clause 12.7 makes execution a precondition
to any transfer.

**Q10 — Items deliberately left as `[TO VERIFY]` rather than resolved.** The
current PPC report deadlines and the extended final-report window (clause 9.4);
the article numbering governing national university corporations under APPI
(clause 1); the 2023 scope claim about the EU–Japan arrangement (clause 12.2); the
French age of digital consent (clause 3.6(e)); the exact Hugging Face legal entity
and location (Annex III); whether the Hugging Face account can be pinned
(clause 6.4); and every sub-processor DPA/SCC status (Annex III note). None of
these can be settled from the source code, and none has been guessed.

---

## Change log

| Version | Date | Change |
|---|---|---|
| 0.1-draft | 2026-07-23 | Initial AI-assisted draft against codebase HEAD `4e32585`. Unreviewed. |
| 0.2-draft | 2026-07-23 | Revision after four independent critique passes (GDPR, APPI, technical, plain-language), each re-verified against the code. Added: table of contents, defined-terms box, "before you sign" summary, conditions-precedent + remediation schedule (5.4), Open-questions section. Rewrote present-tense warranties (2.3, 4.1, 6.3, 11.5) as covenants where the fact was not true. Replaced clause 5.3's deemed acceptance with residual-risk-only acknowledgement. Added Art. 28(10) analysis (2.6), the expanded controller carve-out (2.4), the configurable-parameter table (3.3), Controller warranties on APPI Art. 32(1)/Art. 20(2)/age (3.6), operative bars (3.7, 3.8), Art. 29/32(4) undertaking (4.2), the APPI Art. 26(1) proviso mechanic (9.4), retention-job execution disclosure (10.3), the corrected GitHub Actions transfer scope (12.1), Art. 49 non-reliance and Annex IV-A (12.7). Corrected Annex II §1 (pseudonymisation is exact-match only), §2 (nine `auth != null` paths; five `$other` sentinels; tests/survey peer-readable), §4 (which pages load Google script). Added APPI characterisation column (Annex III), Supplementary-Rules obligations and the EU→JP→US onward row (Annex IV), Annex V.3-bis (外的環境の把握), V.10 (仮名/匿名加工情報), V.11–V.12. Annex VI renumbered contiguously with the v0.1 mapping preserved; nine new items added (L2, L7–L10, L12, L13, G1–G4, G10–G12, R7, R8); R2's entropy claim corrected from ~80 to ≤50 bits. Still unreviewed. |

---

> **Reminder: this is an unreviewed AI-assisted draft. Do not sign it, send it to
> a counterparty, or publish it, until qualified counsel and the institution's
> DPO have reviewed it. Signature is in any case ineffective while any BLOCKING
> item in Annex VI remains open (clause 5.4).**
