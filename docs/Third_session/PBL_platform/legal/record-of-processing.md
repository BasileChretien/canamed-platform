# Record of processing activities — GDPR Art. 30(2)

**Kept by the Processor, for processing carried out on behalf of Controllers.**
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
| P4 | **Backup** (nightly) | The identified `/sessions` tree in full | Disaster recovery. NOT research reuse, and deliberately not consent-gated for that reason |
| P5 | **Pseudonymised research export** (nightly) | Pseudonymised session data plus a real-name → pseudonym linkage table | Research reuse. **Consent-gated** — only sessions with participant research consent are exported |
| P6 | **Certificate issue and verification** | Name hash, session code, dates | Issue and verify completion certificates |
| P7 | **Credential-expiry purge** (daily) | `credentials` records | Retention of certificate records |
| P8 | **Storage/cost monitoring** (daily) | Session identifiers and lifecycle dates only | Keep the deployment inside free-tier limits |

Retention: closed sessions purged 30 days after closure, never-closed sessions
90 days after creation; research dataset up to 5 years after publication;
certificate records per their own `retentionUntil`. Enforced by
`scripts/cleanup-stale-sessions.js` and pinned to the published notice by
`tests/retention-notice-consistency.test.js`.

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
- changing what a scheduled job processes → §2, and the Art. 13 notice;
- a change in a transfer mechanism, or a lapse of one → §4;
- **the DPF certification renewal on 2027-08-03** → §4;
  `tests/github-dpf-currency.test.js` fails 90 days ahead;
- **the Scaleway API key expiry on 2027-09-02** → the archive stops;
  `tests/scaleway-key-currency.test.js` fails 45 days ahead.

Still outstanding for L11: the **DPIA** and the **signed processor contract**.
Creating this register does not close either.
