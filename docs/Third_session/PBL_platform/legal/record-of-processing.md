# Records of processing activities — GDPR Art. 30(2) **and Art. 30(1)**

**Two records in one file.** §2 is the **Art. 30(2)** record — processing
carried out **on behalf of** Controllers. §2A is the **Art. 30(1)** record —
processing where the platform operator determines the purposes itself and is
therefore a **controller in its own right**. Sharing a file is a convenience;
they are different instruments under different articles, and **the two lists
must never be merged**. §2A was created on 2026-09-02 when DPA clause 2.6
elected option 1 for the central research export.
Created 2026-09-02. This is the register that clause 11.5 of `dpa-draft.md`
commits the Processor to maintain, and whose absence Annex VI **L11** records as
a HIGH gap. It also discharges the parallel obligation in Scaleway's own DPA
**Art. 5.3.3** — the Client must *"keep a register of the Data Processing
activities identifying Scaleway as a Data Processor or Sub-processor"*.

> ⚠️ **What this document is and is not.** It is the Art. 30(2) register: a
> factual inventory. It is **not** a DPIA (still absent — L11), it is not a
> signed processor contract (still absent — L11 and Annex VI R9), and creating
> it resolves neither. A register that gets mistaken for compliance is worse
> than none, because it retires the question without answering it.
>
> ⚠️ **Detail lives in the DPA annexes, not here.** Where this register points at
> `dpa-draft.md`, follow the pointer rather than trusting a summary — duplicated
> facts drift, and this repository has a documented history of exactly that. The
> summaries below are deliberately short for that reason.

---

## 1. Identity of the parties — Art. 30(2)(a)

| Role | Entity |
| --- | --- |
| **Processor** (keeper of this record) | [PLATFORM OPERATOR LEGAL NAME AND ADDRESS] |
| Processor's representative / contact | [CONTACT] |
| Data protection officer | [DPO — the DPA carries the same placeholder; the published notice already names "the DPO" as the rights contact, so this must be filled before that notice is relied on] |
| **Controllers** on whose behalf processing is carried out | The facilitator's institution for each session. As at this date: Université de Caen Normandie (lead) and Nagoya University (joint), per `privacy.html` §1. Per-session controllers are recorded in the session's own facilitator agreement. |

⚠️ The placeholders above are the same ones the DPA leaves open. They are not
oversights in this register; they are the DPA's unresolved fill items
(`FILL-DECISIONS.md`), and the register cannot be more determinate than the
contract it records.

---

## 2. Categories of processing carried out on behalf of each Controller — Art. 30(2)(b)

| # | Processing activity | Personal data involved | Purpose |
| --- | --- | --- | --- |
| P1 | **Running a live PBL session** — join, room assignment, clinical reasoning, votes, tests, wrap-up questionnaire | Name, e-mail, university, free-text answers, test and questionnaire responses; special-category data where a participant volunteers health opinions (Annex I §6) | Deliver the teaching session on the Controller's instruction |
| P2 | **Simulated-patient chat (Module A)** | Participant free-text turns and the scenario system prompt | Provide the language-model character. Relayed via Scaleway, routed by Hugging Face, executed by OVHcloud — see §4 |
| P3 | **Retention purge** (nightly) | Session identifiers and two lifecycle timestamps per session; the deletion itself reaches the whole session subtree | Discharge storage limitation (Art. 5(1)(e)) |
| P4 | **Backup** (nightly) | The identified `/sessions` tree in full | Disaster recovery — an **Art. 32(1)(c)** availability measure. NOT research reuse, and deliberately not consent-gated for that reason. ✅ **Placement CONFIRMED 2026-09-02** (DPA clause 2.8): this is processing on the Controller's behalf, not the operator's own controllership — the opposite answer to the export, on the same test, because the purpose is unchanged. ⚠️ The allocation depends on an **express purpose restriction** (2.8(a)): the archive may be used only to restore the service, never as a data source. ⚠️ Its objects live **90 days**, so it outlives the live retention — see G12's second limb |
| ~~P5~~ | **MOVED TO §2A on 2026-09-02.** The central research export is the operator's **own** controllership (DPA clause 2.6, option 1 elected), so it is not processing on behalf of a Controller and does not belong in an Art. 30(2) record. The row is kept struck rather than deleted so P6–P8 do not silently renumber, and so the move is visible. | — | — |
| P6 | **Certificate issue and verification** | Name hash, session code, dates | Issue and verify completion certificates |
| P7 | **Credential-expiry purge** (daily) | `credentials` records | Retention of certificate records |
| P9 | **Erasure on request** (on demand, operator-run) | Identifiers only — the `erasures` node records clientId/uid/stableId and the session, never a name and never content | Discharge Art. 17 / Art. 7(3) and APPI Art. 35(5). `scripts/erase-participant.js` removes the participant from the live tree; the record is what stops a restore from the nightly archive bringing them back (`scripts/restore-sessions.js`). ⚠️ The record must OUTLIVE the snapshots it suppresses — deleting it early re-exposes the person it protects |
| P8 | **Storage/cost monitoring** (daily) | Session identifiers and lifecycle dates only | Keep the deployment inside free-tier limits |

Retention: closed sessions purged 30 days after closure, never-closed sessions
90 days after creation; research dataset up to 5 years after publication;
certificate records per their own `retentionUntil`. Enforced by
`scripts/cleanup-stale-sessions.js` and pinned to the published notice by
`tests/retention-notice-consistency.test.js`.

---

## 2A. The operator's OWN controllership — Art. 30(1) record

⚠️ **Different article, different record.** Everything in §2 is done on a
Controller's instruction. Everything here is done because the **operator**
decided to do it. Do not answer an Art. 30(2) request with this section, or an
Art. 30(1) request with §2.

**A1 — Central pseudonymised research export.** Elected under DPA clause 2.6 on
2026-09-02 (option 1: the operator is an independent controller). Runs nightly
from `.github/workflows/pseudonymise-export.yml` over every **closed**,
**research-consented** session of every facilitator.

| Art. 30(1) item | Entry |
| --- | --- |
| (a) Controller and contact | [PLATFORM OPERATOR LEGAL NAME AND ADDRESS]; DPO [DPO]. The same placeholders as §1, and for the same reason — this record cannot be more determinate than the contract it sits beside. |
| (b) Purposes | Educational-research analysis and publication (the CaNaMED study). |
| (c) Categories of data subjects and of personal data | Participants in closed sessions **who gave research consent**. Pseudonymised session data; **free-text answers verbatim**; knowledge-test and wrap-up questionnaire responses; university (bucketed). Plus a real-name → pseudonym **linkage table**. |
| (d) Categories of recipients | The named CaNaMED research team at the controlling institutions. **Scaleway** (object storage, `fr-par`). **GitHub, Inc.** (executes the job — §4). |
| (e) Third-country transfers | **GitHub Actions runners, United States** — DPF adequacy (§4). No other transfer identified for this activity; the storage is `fr-par`. |
| (f) Retention | Research dataset **up to 5 years after publication**. Linkage table **14 days**, enforced by an object-storage lifecycle rule. |
| (g) Security measures | As §5. ⚠️ Note that **consent-gating is a lawfulness control, not a security measure** — do not offer it as one here. |

**Lawful basis.** GDPR **Art. 6(1)(a)** and **Art. 9(2)(a)** explicit consent,
with **Art. 9(2)(j)** also cited in the published notice. Consent is a
separately-refusable box: a participant may take part in a session and decline
research reuse.

⚠️ **Three things this record must state plainly, because the election moved them
onto the operator.**

1. **Withdrawal does not currently produce erasure** (Annex VI **G12**). Where
   the basis is consent and the operator is the controller, that is the
   operator's own Art. 7(3) / Art. 17 defect. The election did not create it; it
   identified who answers for it.
2. **Nothing here is anonymised.** The output is neither 匿名加工情報 nor
   仮名加工情報 and **remains 個人データ** under APPI (DPA Annex V.10), and it
   remains personal data under the GDPR. "Pseudonymised export" is the job's
   name, not a legal characterisation.
3. **The APPI Art. 27/28 analysis for this activity is not done.** It is owed by
   the operator as controller, and is not covered by anything in §2.

**A2 — [RESERVED].** DPA clause 2.4 lists further processing the operator carries
out as a controller (operational security logs, facilitator accounts, the
certificate registry, the language-model usage log, and visitors to the public
verification page). **None of those has been elected or worked through**, and several carry open classification questions in
clause 2.4 itself. They are named here so that this record's silence about them
reads as *unfinished*, not as *nothing to record*.

⚠️ **The nightly identified backup was on this list until 2026-09-02 and has been
removed** — not because it was worked through and dropped, but because clause 2.8
allocated it the **other** way: it is processing on the Controller's behalf and is
filed at **P4** in §2. It is recorded here so the removal does not read as an
omission.

---

## 3. Sub-processors

Full detail — including what each receives and its APPI characterisation — is
**Annex III** of `dpa-draft.md`. Reproduced here only to the extent Art. 30(2)
and Scaleway Art. 5.3.3 require.

| # | Sub-processor | Role | Location |
| --- | --- | --- | --- |
| 1 | Google (Firebase) | Hosting, Realtime Database, Authentication | Database `europe-west1` (Belgium); Hosting on Google's global edge |
| 2 | Google (reCAPTCHA / App Check) | Bot resistance | **INACTIVE** since 2026-08-21 — consent-gated and never loaded, receives nothing |
| 3 | Hugging Face | Inference router for the simulated patient | Outside the EEA `[TO VERIFY]` |
| 4 | OVHcloud AI Endpoints (OVH SAS) | Executes the language model | Gravelines, **France** |
| 5 | **GitHub, Inc.** | Runs the scheduled jobs P3, P5, P7, P8 on Actions runners | **United States** |
| 6 | [SMTP PROVIDER] | Transactional e-mail | Not active — the mail function cannot run on the current plan |
| 7 | **Scaleway S.A.S.** — 8 rue de la Ville l'Évêque, 75008 Paris; R.C.S. Paris 433 115 904 | **Two purposes:** (a) Serverless Functions hosting the simulated-patient relay (P2); (b) **Object Storage holding the P4 backup and the P5 export, including the linkage table** | **`fr-par` (Paris), France — inside the EEA** |

**Row 7 is the entry Scaleway's Art. 5.3.3 requires.** Its Art. 28 contract is
Scaleway's own DPA, version of 1 June 2024, which *"forms an integral part of the
contract"* and required no separate signature. Object Storage lifecycle rules
mirror the retention policy: `backups/` 90 d, `pseudonymised/` 90 d,
`linkage/` 14 d.

### ⚠️ Scaleway sub-processor-change notifications — the Art. 7.4 condition cannot be met

Scaleway's DPA Art. 7.4 promises 30 days' notice of a change to its own
sub-processor list *"providing that it has previously subscribed to updates
notifications using the feature available on the dedicated page."*

**No such feature could be located, 2026-09-02.** Three places were checked:

1. The dedicated page, `scaleway.com/en/subprocessorlist/` — offers a *change
   history* link and no subscription mechanism.
2. Console → Notification Manager — a history view only, with no categories.
3. Console → Settings → Personal notifications — two entries, both marketing
   newsletters (Scaleway and Dedibox).

⚠️ **A marketing newsletter is not a sub-processor-change notification, and
subscribing to one must not be recorded as satisfying Art. 7.4.** The honest
position is that Scaleway's notice obligation is expressly conditional on a
feature we cannot find, so **the 30-day advance notice should not be relied on**.
Changes are discoverable only by checking the history page.

**Scaleway's sub-processors as at 2026-09-02**, recorded so a future reader can
diff the list by eye rather than depend on a notification that may never arrive:
*Data centres* — Atnorth, 3S Data Center S.A, Atman sp. z.o.o, Equinix EMEA,
Iron Mountain, Digital Realty, Op Core. *Others* — Atempo, BrainStorm Network
Inc., Clever Cloud, Confia.

---

## 4. Transfers to third countries — Art. 30(2)(c)

| Leg | Destination | Mechanism |
| --- | --- | --- |
| Scheduled jobs on GitHub Actions (P3, P5, P7, P8) | GitHub, Inc., **United States** | **Art. 45 adequacy** — GitHub is an active EU–U.S. Data Privacy Framework participant (Non-HR Data), certification due for renewal **2027-08-03**, scope expressly covering *"GitHub Free and Subscription Users Data"*. ⚠️ **The Art. 28 processor contract is separately ABSENT and accepted as a disclosed non-compliance — Annex VI R9.** Adequacy does not supply it. |
| Simulated-patient chat routing (P2) | Hugging Face, **outside the EEA** | `[TO VERIFY]` — Annex IV records no identified mechanism for this leg |
| Model execution (P2) | OVHcloud, France | No transfer — within the EEA |
| Relay and archive (P2, P4, P5) | Scaleway, France | No transfer — within the EEA |
| Japanese participants | All of the above | APPI Art. 28 cross-border transfer. The EU–Japan mutual adequacy arrangement covers the EU leg; **it does not cover the United States**, and Japan's PPC has not designated the US. That leg needs its own basis. |

---

## 5. Security measures — Art. 30(2)(d)

General description only; the measures themselves are **Annex II** of
`dpa-draft.md`, and the measures deliberately *not* implemented are **Annex II
§9**.

Encryption in transit throughout; database access governed by rules enforcing
authentication, session membership and per-room scoping; administrator actions
bound to a password-proof identity that cannot be read back; the language-model
relay carries a server-side prompt guard, room-membership verification and
per-participant rate limits; retention enforced by scheduled jobs with a
backup interlock; job logs configured to carry no personal data
(`CLEANUP_QUIET=1`), which matters because this repository is public.

⚠️ **Two limitations belong in any honest reading of this section.** App Check is
in *Monitor*, not *Enforce* (Annex VI R5), so attestation is observed and not
required. And the runners executing P3–P8 receive a Firebase **admin**
credential that bypasses the database rules entirely — so the data those jobs
*read* is small while the access they *hold* is total (Annex III row #5,
Annex VI R9).

---

## 6. Maintenance of this record

Update it in the **same change** as the thing it describes — a register that
lags is the failure mode this repository keeps re-finding. In particular:

- adding, removing or repurposing a sub-processor → §3, and Annex III;
- **an Art. 28(10) election, or a change to one** → move the activity between
  §2 and §2A **and say so in both**, as the export's move on 2026-09-02 does.
  An activity silently present in both records, or in neither, is the failure
  this file exists to prevent;
- **working through any A2 item** → give it its own §2A entry rather than
  extending A1;
- changing what a scheduled job processes → §2, and the Art. 13 notice;
- a change in a transfer mechanism, or a lapse of one → §4;
- **the DPF certification renewal on 2027-08-03** → §4;
  `tests/github-dpf-currency.test.js` fails 90 days ahead;
- **the Scaleway API key expiry on 2027-09-02** → the archive stops;
  `tests/scaleway-key-currency.test.js` fails 45 days ahead.

Still outstanding for L11: the **DPIA** and the **signed processor contract**.
Creating this register does not close either — and note that the 2026-09-02
election makes the **DPIA** more clearly owed, not less: a research activity
processing Art. 9 data, on consent, over a cohort of students, now sits
squarely with the operator as its controller.
