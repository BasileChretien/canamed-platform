# Participant consent & notice screens — DRAFT

> # ⚠️ UNREVIEWED DRAFT — NOT FIT FOR USE
>
> **This document was prepared with AI assistance and has NOT been reviewed by a
> lawyer, a Data Protection Officer, or an ethics committee.**
>
> Do not put this text in front of a single student, do not ship it into the
> product, and do not treat it as legal advice, until it has been reviewed and
> signed off by qualified counsel and/or the data controller's DPO for **both**
> GDPR (EU/France) and APPI (Japan). Wording that looks harmless here can
> invalidate a consent, and an invalid consent means the processing had no
> lawful basis at all.
>
> **Read this next sentence before anything else.** This draft was written
> against the code as it stood on 2026-07-23. Some of the defects it describes
> have since been **fixed in the code and deployed**; others are still open.
> Status re-verified against the live system on **2026-07-24**:
>
> | # | Defect | Status |
> |---|---|---|
> | M11 | No consent filter on the research export | ✅ **FIXED** — PR #232, deployed. The export now includes only participants with `consent.research === true`, fail-closed. |
> | M12 | AI-patient transfer has no identified recipient and no documented transfer mechanism | ❌ **STILL OPEN.** A legal/documentation gap, not a code one — it needs the sub-processor and transfer mechanism named by counsel. |
> | M13 | Certificate verification IDs are computable by any classmate | ❌ **STILL OPEN — and confirmed correct.** `resolveCertId()` mints a *deterministic* non-cryptographic hash of `sessionCode\|clientId`, both readable by any session member. A crypto-random `randomCredentialId()` exists but is never called. The project's own CLAUDE.md claimed these IDs were crypto-random; **that claim was wrong and has been corrected.** |
>
> Two further code defects found in the same pass have also been fixed and
> deployed: org-scoped sessions now have retention coverage (#234), and the
> Module A chat is now genuinely room-private (#235). **Wording elsewhere in
> this draft may still reflect the pre-fix behaviour — anything describing M11
> or cross-room chat visibility as a current defect is now out of date and must
> be re-read against the table above before publication.**
>
> The open items are live-processing problems that exist whether or not this
> document is ever adopted. Fixing the words does not fix them.
>
> Every `[BRACKETED]` item is a fact only the controlling institution can
> supply. Every `[TO VERIFY]` marker is something that could not be confirmed
> from the code and that must be checked against the live system before
> publication.

---

## 0. Who is the controller (the model this text is built on)

This text is written for the **ratified model**:

- The **data controller** is the **facilitator and/or their institution** — the
  person who creates the session and decides why it is run and what happens to
  the answers.
- The **platform operator** is a **processor** acting on the facilitator's
  documented instructions.

Everything below therefore refers to `[CONTROLLER LEGAL NAME]` where the current
production text hard-codes "Université de Caen Normandie × Nagoya University".
The existing `privacy.html` still declares the two universities as **joint
controllers** (GDPR Art. 26 / APPI Art. 27(5) 共同利用) — see
`i18n.js :: "lobby.privacy.p1"` (≈376). That page must be rewritten in the same
change as this one, or the two will contradict each other.

**Three things must be true before the processor model can be asserted to
participants, and none is true today:**

1. **There is no Art. 28(3) GDPR processing agreement** between the operator and
   any facilitator institution. None exists in this repository. Screen C says
   "the platform runs the session on their instructions"; until a contract
   exists, that sentence describes an intention, not a fact.
2. **The facilitator cannot actually instruct the essential means.** Retention
   windows are environment variables on the operator's CI runner
   (`scripts/cleanup-stale-sessions.js` :: `CLEANUP_RETENTION_CLOSED_DAYS` /
   `CLEANUP_RETENTION_OPEN_DAYS`, ≈42-43); the LLM model and sub-processor are
   set in the operator's `functions/.env`; the Cloud Function region is fixed in
   code (`functions/index.js :: exports.hfPatient` `region: "us-central1"`,
   ≈319); and there is no facilitator switch for the AI patient at all — only a
   client-side `?llm=0` URL flag. Under **GDPR Art. 28(10)** a processor that
   determines essential means becomes a **controller** for that processing.
   For the AI-patient feature specifically, the honest characterisation may be
   **joint controllership (Art. 26)**, which would additionally require the
   Art. 26(2) "essence of the arrangement" to be made available to
   participants — a document this draft does not contain.
   **Decision required:** either give the facilitator real, documented control
   (region, retention, model, LLM on/off, per-session config), or say in
   Screen C that the operator is a joint controller for the AI patient and
   publish the Art. 26(2) essence. `[CONTROLLER + OPERATOR TO DECIDE]`
3. **Under APPI the processor characterisation buys less than it does under
   GDPR.** The closest analogue is 委託 (entrustment, Art. 27(5)(i)), which
   exempts the *provision* from third-party-provision consent — but it **does
   not** exempt it from **Art. 28** (provision to a third party in a foreign
   country). A foreign entrustee is still 「外国にある第三者」. So a Japanese
   facilitator still needs an Art. 28 route for every foreign leg. See §3b.

---

## 1. Design rules these screens follow

1. **Layered.** Screen A is short and is the only thing a student *must* read.
   Everything else is one tap away. A wall of text is not "informed".
2. **Separable and specific.** Running the teaching session, using the data for
   research, and issuing a verifiable certificate are **three different
   purposes** and get **three different decisions**. One "I agree to everything"
   box would not be valid consent.
3. **Every purpose names its legal basis.** GDPR Art. 13(1)(c) makes this
   mandatory *at collection*, per purpose — and where Art. 6(1)(f) is relied on,
   Art. 13(1)(d) requires the legitimate interest to be named. Silence is a
   breach on its face. The bases below are `[BRACKETED]` because the controller
   chooses them; a bracket is acceptable, an omission is not.
4. **Freely given, in a classroom.** See §9 — this is the hardest requirement to
   meet and it is mostly *not* a wording problem. Consent may be the **wrong
   basis** for most of what happens here.
5. **Just-in-time.** The AI-patient notice appears when the chat opens, not on
   the join form. The certificate notice appears when the download is clicked.
   Consent buried 20 minutes earlier is consent nobody read.
6. **True to the code.** Every factual claim below is traceable to a
   `file :: symbol` anchor (line numbers are hints only — they drift). Where the
   current code contradicts the current UI text, §11 lists the fix that must
   land *before* this wording can honestly be shown.

---

## 2. Screen A — Before you join *(required reading)*

> Shown collapsed-open on the join form, above the name field.
> Replaces `lobby.privacy.summary` + the first lines of `lobby.privacy.p1`.

---

### Before you join

This is a teaching session run by **[CONTROLLER LEGAL NAME]**. Your teacher —
not the platform — decides how your work here is used.

**What everyone in this session can see:** the name you type, your university,
your year, everything you write during the session, **and your answers to the
end-of-session questionnaire and the knowledge checks**. That includes people in
other rooms, not just yours. Use a first name or a nickname.

**Where it is kept:** on a server in Belgium — **except your messages to the AI
patient, which are processed in the United States**.

**How long:** session data is deleted **30 days** after your teacher closes the
session (90 days if it is never closed), and a **private backup copy — which
includes your AI-patient chat — is kept for up to 90 days**. A few records last
longer: your certificate entry, and your email address if you sign in.

**We also keep some things in this browser** (your name, university and the
choices you make below) so you can rejoin if the page reloads.

**What is optional:** using your work for research, and getting a certificate.
You can say no to both and still take part in exactly the same way.

**Never type** a real patient's details, your own health information, or
anyone's contact details.

→ **[Read the full privacy notice]** · **[Ask us to delete your data]**

---

*Approx. 190 words. Verification notes:*

- *The 30/90-day figures come from `scripts/cleanup-stale-sessions.js`
  (`CLOSED_DAYS` / `OPEN_DAYS`, ≈42-43). The live UI currently says "7 days"
  (`index.html` `lobby.privacy.p3` fallback ≈970-975; `i18n.js ::
  "lobby.privacy.p3"` ≈378) — that claim is false and must be corrected in the
  same change (§11, M1).*
- *The Belgium claim is **only true for the database**. `hfPatient` runs in
  `us-central1` (`functions/index.js`, ≈319). The earlier draft's flat
  "everything you type is stored on a server in Belgium" contradicted its own
  Screen D and has been corrected.*
- *The deletion promise is **not currently true for every store**. Verified:
  `cleanup-stale-sessions.js`, `backup-sessions.js` and `pseudonymise-export.js`
  all read `db.ref("sessions")` only — **nothing walks `orgs/**`**. And nothing
  anywhere deletes `rosters/`, `credentials/` or `metrics/hfPatient/`. Until
  §11 M6/M7/M8/M9 land, this paragraph is a promise the system does not keep.*
- *The link is now **"Ask us to delete your data"**, not "How to delete your
  data". The product has **no participant-facing erasure**: chat turns are
  write-once (`database.rules.json` `moduleA/chat/$turnId` `.write` requires
  `!data.exists()`, ≈311), and once the facilitator closes the session **every**
  participant-writable rule fails on `closed.exists()`. Art. 15 self-export does
  exist (`script.js :: downloadMyData`, ≈6402). Art. 17 self-erasure does not.
  Do not offer a control the product cannot honour. `[CONTROLLER TO SUPPLY:
  who executes an erasure request, by what mechanism, within what time]`*

---

## 3. Screen B — The join-form decisions

> Replaces the `.consent-block` in `index.html` (≈1047-1072). **Structurally
> changed** from the previous draft: box 1 is no longer framed as a consent.

**Why the change.** In the previous draft, box 1 was a *required tick that gated
the Join button*. If that is consent, it is not freely given by definition — no
tick, no participation in a timetabled teaching activity (**GDPR Art. 7(4)**).
Worse, where the controller is a **public university**, EDPB Guidelines 05/2020
and Recital 43 treat consent by a public authority as **presumptively invalid**
however carefully it is worded. That is a *basis* defect; no wording cures it.

The structure below therefore assumes teaching runs on a **non-consent basis**
(most likely GDPR Art. 6(1)(e), public-interest task) with box 1 demoted to an
**acknowledgement**. `[CONTROLLER TO CONFIRM THE BASIS]` — if the ethics
committee positively requires consent instead, this screen must be rebuilt and
§10's traceability table changes with it.

---

**☐ I have read the notice above.** *(required to join)*

My name, university, year and everything I write will be visible to my teacher
and to the other participants in this session — including participants in other
rooms.

*Why we are allowed to run this session:* `[LEGAL BASIS — e.g. GDPR Art. 6(1)(e)
public-interest task / other]`.

**☐ Some of what I write may be sensitive.** *(required to join — please read)*

Free-text answers in a clinical scenario can touch on health, beliefs or
opinions. Under GDPR these can be **special-category data (Art. 9)**; under
Japanese law some categories are **要配慮個人情報 (APPI Art. 2(3))**.

*Why we are allowed to collect it:* `[LEGAL BASIS — GDPR Art. 9(2)(...) — and,
for Japan, APPI Art. 20(2) prior consent OR the 学術研究機関等 exception]`.

**Please do not write anything sensitive about yourself or a real person.**

**☐ You may also use my work for research.** *(optional)*

My answers, hypotheses, votes, questionnaire responses and free text may be kept
and analysed for **[RESEARCH PROJECT NAME]**, linked to my name so the study
team can follow one participant across the session.

*Why we are allowed to do this:* `[LEGAL BASIS — e.g. Art. 6(1)(e) + Art. 89(1)
safeguards, or Art. 6(1)(a) consent if the ethics committee requires it]`.
`[FR CONTROLLERS: check conformity to CNIL reference methodology MR-004 before
inventing a bespoke consent.]`

**Not ticking this box changes nothing.** You take part in the same session, do
the same work, and it has **no effect on your marks, your assessment, or your
standing at your university.**

**Your choice here is visible to other participants** until §11 M15 is fixed.

You can change your mind at any time, **from inside the app**: *My data →
Withdraw research consent*. `[HOW TO WITHDRAW — link]`

**Important:** once the link between your name and the research file is
destroyed (after `[LINKAGE RETENTION — N days]`), we can no longer find your
rows in that file, so we can no longer remove them.

Notice version `[NOTICE VERSION]` · [Full privacy notice]

**[ Join the session ]**

---

*Approx. 300 words. Notes for the implementer:*

- *The required box currently gates the Join button
  (`script.js :: refreshJoinBtnState`, ≈1918-1941, plus the `if (!cWorkshop)`
  guard inside `joinParticipant`, ≈2121-2128) — keep the gate, change the
  label. Only `consent-workshop` gates it; `consent-research` does not. That is
  correct and must stay correct.*
- *`CONSENT_NOTICE_VERSION` is hard-coded to `"PIS-v2-2026-05"`
  (`script.js`, ≈2105) and written into `pool/$cid/consent.version`. Under the
  facilitator-as-controller model each controller needs its **own** version
  string, so this must become per-session configuration.
  `[FACILITATOR TO CONFIRM]` what their notice version is.*
- ***CORRECTED — this is the most important correction in this revision.**
  The previous draft said `consent.research` "filters the research export".
  **It does not. Nothing does.** Verified: `grep -rn consent scripts/` returns
  no hit outside the simulator; `scripts/pseudonymise-export.js` reads
  `db.ref("sessions")` and pseudonymises **every** closed session's every
  participant; `scripts/backup-sessions.js` snapshots the **whole identified**
  `/sessions` tree and strips only `adminPasswordHash`; and the facilitator's
  own identifiable CSV (`admin-tools.js :: researchCsvParticipantRows`, ≈415)
  has no consent check either — while its embedded note claims the data is
  linked "per the consent the participants gave".
  **`consent.research` has exactly one effect in the entire codebase:**
  `script.js :: writeRoster` (≈2328-2345). Until §11 M11 lands, Screen B may
  **not** describe research use as optional, because it is not.*
- *The sensitive-data box is **restored**, not new. `locales/ja.js ::
  "lobby.privacy.p2"` (≈267) currently tells Japanese participants that the
  **second, optional** box covers 要配慮個人情報 (「下の2つ目の任意の同意ボックス
  がこれに対応します」). That is a design error: a participant who declines
  research still writes the same free text in a **required** activity, so the
  acquisition has no basis for exactly the population that exercised the choice.
  APPI Art. 20(2) governs **acquisition** — it bites the moment the participant
  types, not when the export runs. Attaching it to the required decision is the
  correction. `[TO VERIFY]` Also scope the claim honestly: APPI's
  要配慮個人情報 list is **closed** (人種・信条・社会的身分・病歴・犯罪の経歴・
  犯罪被害の事実・障害・健康診断等の結果). "Views on opioid prescribing" is not
  in it; 信条 may catch religious or philosophical belief. `privacy.html`
  over-claims for APPI; the previous draft dropped the topic entirely. Both are
  defects.*
- *The in-app withdrawal control **does not exist yet** (§11 M14). GDPR Art.
  7(3) requires withdrawal to be **as easy as giving** consent — two taps in,
  and today an email out, to the institution that marks your work. Do not ship
  this screen with an email-only withdrawal route.*
- *The current shipped checkbox text (`index.html`, ≈1059-1068) covers only
  "(group answers, votes, scores)" and promises analysis "in pseudonymised
  form". Screen B is **broader** (adds free text; says linked to your name).
  Data already collected under `PIS-v2-2026-05` was consented under the
  narrower wording and **cannot be re-used** under Screen B without
  re-consent. `[CONTROLLER TO DECIDE]` what happens to the existing corpus.*

---

## 3b. Screen B-JP — Cross-border transfer consent *(Japan-facing deployments)*

> **New.** APPI Art. 28 is a **separate** consent from everything above, and the
> 委託 (entrustment) carve-out in Art. 27(5)(i) **does not reach it**. It must be
> obtained **before** the first transfer.

---

### 海外への提供について / Sending your data outside Japan

To run this session, some of your data is handled outside Japan:

| Where | What goes there | Who handles it |
|---|---|---|
| **Belgium (EU)** | everything you type in the session | Google (Firebase Realtime Database) |
| **United States** | your messages to the AI patient | the platform operator's Cloud Function, then Hugging Face, then **an AI company we cannot name in advance** |
| **United States** | your IP address and browser signals | Google (reCAPTCHA anti-abuse) |
| **United States** | the whole session record, once a night | GitHub (the servers that run our clean-up, backup and research-export jobs) |

`[TO VERIFY — one line per destination:]`
`[(i) country; (ii) information about that country's personal-information
protection system; (iii) the measures the recipient takes]` — or, alternatively,
`[the 基準適合体制 route per recipient, with the Art. 28(3) continued-
implementation measures and on-request disclosure]`.

**For the AI patient we cannot tell you which company processes your message,
or in which country.** Where the country cannot reasonably be identified, the
Enforcement Rules require us to say **that fact and why**, and to give
substitute information instead: `[SUBSTITUTE INFORMATION — required]`.

**☐ 同意します — I consent to my data being sent outside Japan as described.**

---

*Notes:*

- *SCCs are a **GDPR** mechanism and are **not** an APPI route. A single generic
  "SCCs / adequacy" bracket covering all legs is wrong for Japan; each leg needs
  its own APPI answer. Only the Belgium leg is covered by the PPC's
  equivalent-standard designation for the EEA.*
- *The "cannot be named in advance" problem is **real and verified**:
  `functions/index.js` sets `HF_URL` to Hugging Face's OpenAI-compat **router**
  (`HF_DEFAULT_URL = "https://router.huggingface.co/v1/chat/completions"`,
  ≈163), which dispatches to whichever downstream provider it picks (the code's
  own comment names Together, Fireworks, Cerebras as examples, ≈421-425), and
  the code only **learns which one after the response**, from the
  `x-inference-provider` header (≈447). This is not a disclosure difficulty; it
  is a lawfulness defect under both regimes — see §11 M12. **The fix is
  engineering, not wording: pin the provider.***
- *This consent must be recorded **server-side**, alongside
  `pool/$cid/consent.*` — not in `localStorage` (see §5 and §11 M17).*
- ***Sequencing problem, unfixable by wording:** reCAPTCHA / App Check
  initialises at page load, **before any screen is shown**. An Art. 28 consent
  taken on the join form cannot cover a transfer that already happened. See
  §11 M18.*

---

## 4. Screen C — Full notice *(one tap from Screen A)*

> Expandable panel. This is the in-product layer 2; `privacy.html` remains
> layer 3 (the long, binding version).

---

### How your data is used

**Who is responsible.** **[CONTROLLER LEGAL NAME]**, `[CONTROLLER ADDRESS]`,
represented by `[REPRESENTATIVE]`. Questions or requests:
**[DPO / PRIVACY CONTACT EMAIL]**. Complaints: `[COMPLAINTS CONTACT — 苦情の申出先]`.
The platform operator, `[OPERATOR LEGAL NAME]`, runs the session on their
instructions `[once an Art. 28 contract is in place — see §0]`.

**What we collect.** The name you type, your university, your year, your
self-rated English level; everything you write during the session (answers,
hypotheses, questions to the AI patient, votes); your **pre- and post-session
knowledge-check answers**; your **end-of-session questionnaire answers**,
including free text; a random code identifying your browser tab; and **a
longer-lived code stored in this browser that recognises you across page
reloads, new tabs and later sessions**. If you sign in with an account: your
email address and display name.

**Why we are allowed to.**

| Purpose | Legal basis |
|---|---|
| Running the teaching session | `[GDPR BASIS]` · `[APPI: 利用目的 — Art. 17/21]` |
| Sensitive free-text content | `[GDPR Art. 9(2)(...)]` · `[APPI Art. 20(2) consent or 学術研究 exception]` |
| Education research | `[GDPR BASIS + Art. 89(1) safeguards]` · `[APPI basis]` |
| Certificate verification | `[GDPR BASIS — if Art. 6(1)(f), name the interest]` · `[APPI: NOTE — APPI has no legitimate-interests basis; see §11 M5]` |
| Anti-abuse (reCAPTCHA), backups, security | `[GDPR BASIS — if Art. 6(1)(f), name the interest]` |

**Who can see it.** Everyone signed into the same session can read the whole
session, including other rooms' answers, **your questionnaire answers, your
knowledge-check answers and the choices you made on the join form** — this
breadth is deliberate for teachers and observers, but it is wider than most
students expect. The one exception is your room's chat with the AI patient,
which only your own room can read.

**Who else receives it.**

- Your **facilitator**, who can download an identifiable list of participants
  (name, email, university) if you signed in and agreed to research use.
- The **platform operator**, whose automated jobs read the entire session tree
  every night to make a backup and a research file.
- **GitHub**, whose servers those jobs run on.
- `[RESEARCH RECIPIENTS — who receives the research file, and where]`

**Where it goes.** The database is in Belgium (Google Firebase,
`europe-west1`). Your sign-in details are held by **Google Firebase
Authentication** `[REGION TO VERIFY]`, and the site itself is served by
**Firebase Hosting**, which keeps request logs `[REGION TO VERIFY]`. These
things leave the EU:

- Your **questions to the AI patient** are processed in the **United States**
  and then sent to **Hugging Face**, which forwards them to a third-party AI
  provider that **changes from message to message and cannot be named in
  advance**. This is why you must not type anything personal into that chat.
- Google's **anti-abuse check (reCAPTCHA)** receives your IP address and browser
  signals on every page load, **before this notice is shown**.
- The **automatic clean-up, backup and research-export jobs** run on GitHub's
  infrastructure in the United States.
- **Japan:** facilitators and observers in Japan read the whole session record
  remotely, and `[RESEARCH RECIPIENTS IN JAPAN]` receive the research file.

`[TO VERIFY — transfer mechanism, per destination: adequacy decision or specific
safeguards, plus "you can obtain a copy from [CONTACT]".]`
`[TO VERIFY — whether the 2019 EU→Japan adequacy decision reaches a National
University Corporation after the 2021 APPI amendment moved public-sector bodies
into a separate chapter. Do not assume it does; both this draft and
`privacy.html` previously asserted it flatly.]`

**What we keep in this browser.** Your name, university and the choices you made
on the join form, so you can rejoin after a reload; your session code; your
sound and language preferences; a note that you have seen the AI-patient notice;
and the long-lived code described above. `[TO VERIFY — which of these are
"strictly necessary" under ePrivacy Art. 5(3) / Art. 82 loi Informatique et
Libertés, and which need separate consent. This is a **separate consent regime**
from GDPR and the CNIL enforces it independently.]`

**How long it is kept.**

| | |
|---|---|
| Everything you type in the session | deleted **30 days** after the session is closed (90 days if never closed) |
| A private backup copy — **identified, and it includes your AI-patient chat** | **90 days** |
| Research dataset — **re-identifiable, not anonymous** (see below) | `[RETENTION PERIOD CHOSEN BY THE CONTROLLER]` |
| The table that links your name to the research dataset | `[LINKAGE RETENTION — N days]` |
| Certificate verification entry (only if you download a certificate) | up to **5 years** |
| Your name/email on the facilitator's participant list | `[RETENTION — currently indefinite; see §11 M6]` |
| Your account profile, if you created one | until you delete it |

**About the research dataset.** It is **pseudonymised, not anonymous**: names
are replaced by codes, but a separate linkage table can reverse that until it is
destroyed. Under Japanese law it is at best 仮名加工情報, never 匿名加工情報, and
under **Supplementary Rule 4** of the EU–Japan arrangement it cannot be treated
as anonymised while the linkage exists. That has consequences the controller
must plan for: 仮名加工情報 may **not** be handed to a third party except by
委託 / 事業承継 / 共同利用. `[TO VERIFY — who receives it and on what footing.]`

**Your rights (EU/GDPR).** You can ask to see your data, correct it, delete it,
get a copy, restrict or object to its use, and withdraw any consent — write to
**[DPO / PRIVACY CONTACT EMAIL]**. We reply within `[RESPONSE TIME]`. You can
also complain to `[SUPERVISORY AUTHORITY — e.g. CNIL (France)]`.

**Your rights (Japan/APPI).** *These are a different set, not a translation of
the list above.* You may request **disclosure (開示, Art. 33)** — and you may ask
to receive it in electronic form; **correction (訂正等, Art. 34)**; and **a stop
to use, erasure, or a stop to third-party provision (利用停止・消去・第三者提供の
停止, Art. 35)** on the grounds that Article allows. APPI has no general
"withdraw consent" right and no portability or objection right, so we have not
listed those here. Fee for a disclosure request: `[FEE — amount, or "no fee"]`.
Complaints: `[苦情の申出先]`. Accredited personal-information-protection
organisation: `[NAME, or "none"]`.
`[TO VERIFY with Japanese counsel — whether a session run by a 国立大学法人
(National University Corporation) is governed by the private-sector chapter used
above or by the **Art. 58 / 別表第二 special application rules**, which can change
the disclosure procedure, the complaint route and the fee treatment. Do not ship
this paragraph until this is settled — and re-check `privacy.html`'s article
citations, which inherit the same assumption.]`

**Security and the countries involved (APPI Art. 32 / 外的環境の把握).** Your data
is handled in **Belgium** and in the **United States**. Measures we take:
`[SAFETY-MANAGEMENT MEASURES SUMMARY — 安全管理措置]`. Information about those
countries' data-protection regimes: `[REQUIRED]`.

**Scores.** Points are for the game only. No automated decision is made about
you.

**Age.** This session is for adult students. If you are under `[AGE]`, speak to
your teacher before joining.

---

*Approx. 800 words — this layer grew because Art. 13 GDPR and Art. 32 APPI both
have mandatory content that cannot be moved to a deeper layer. If it is too long
for the panel, split it into "Layer 2a — the short version" and "Layer 2b — the
full legal detail", but do **not** drop the legal-basis table, the transfer
mechanisms or the Japanese rights block.*

---

## 5. Screen D — Talking to the AI patient *(shown in Module A, before the first message)*

> Replaces `i18n.js :: "modA.chat.disclosure"` (≈704). The existing one-time
> acknowledge button (`modA-llm-init.js`, ≈163-184) stays but must change from
> an acknowledgement to a recorded consent for Japan-facing deployments.

---

### You are about to talk to an AI, not a person

The "patient" is a **language model**. It invents its answers. It is a training
exercise, not a source of medical fact.

**Where your questions go.** Each question you type is sent to our server in the
**United States**, then to **Hugging Face**, which passes it to an AI company
that **varies from message to message — we cannot tell you in advance which one,
or in which country it is**.

**Your questions and the replies are saved.** They stay in this session's record
until it is deleted, **and in a private backup copy for up to 90 days**.

**Type only what you would say in a real consultation.** Do not type your own
name or anyone else's, contact details, a real patient's details, or anything
personal about yourself.

**☐ I consent to my messages being sent as described.**
*(Japan-facing deployments: this is an APPI Art. 28 consent, not an
acknowledgement — see Screen B-JP.)*

Prefer not to use it? Tell your facilitator — `[FACILITATOR TO CONFIRM: is a
non-LLM alternative offered? `?llm=0` restores the click-button version, but
that is a URL flag, not a student-facing choice.]`

---

*Approx. 180 words. Notes:*

- *The current banner says "sent to our server and to Hugging Face (US/EU)" but
  omits that the Cloud Function itself runs in `us-central1`
  (`functions/index.js`, ≈319) and that Hugging Face's router dispatches onward
  to a per-request provider (≈421-425, `x-inference-provider` at ≈447).*
- ***CORRECTED.** The previous draft said the chat is "deleted with the rest of
  the session". **False.** `scripts/backup-sessions.js` snapshots the full
  `/sessions` tree and strips **only** `adminPasswordHash` — it does **not**
  drop `chat`. Only the pseudonymiser drops it (`scripts/lib/pseudonymise.js ::
  DROP_KEYS` includes `"chat"`). Per `CLAUDE.md` the bucket lifecycle is 90
  days, so identified AI-chat transcripts persist in
  `gs://canamed-pii-archive/backups/` for up to 90 days after the last backup
  that captured them — which can outlast the session record itself.*
- *The acknowledgement persists in `localStorage.canamedModALLMConsent`
  (`modA-llm-init.js :: _hasConsent` / `_setConsent`, ≈164-170), so a returning
  student never sees the notice again — including in a **different** session run
  by a **different** controller. Under GDPR it is unevidenced; under APPI it
  makes an Art. 28 consent for an ongoing foreign provision unprovable. Record
  it server-side under the session and re-prompt when the notice version **or
  the provider/model set** changes (§11 M17).*

---

## 6. Screen E — End-of-session questionnaire *(wrap-up)*

> Replaces `i18n.js :: "survey.intro"` (≈782).

---

### A few questions about today

Optional. Takes about `[N]` minutes. **Skipping it changes nothing** — not your
marks, not your certificate.

Your answers are **linked to your name**. They are **not confidential to the
teaching team**: like the rest of the session record, **other participants in
this session can read them**. Some questions are free text — please don't name
other people, and don't write anything you would not say out loud in the room.

**[ Start ]**  **[ Skip ]**

---

*Approx. 90 words. Notes:*

- ***CORRECTED.** The previous draft said the answers go to "the teaching team",
  which a student writing candid feedback would reasonably read as
  staff-confidential. Verified: `survey` lives at
  `sessions/$code/rooms/$room/survey/$cid` (`database.rules.json`, ≈458-466) and
  carries **no `.read` rule of its own**, so it inherits the session-level
  `.read` — `auth != null && data.child('members').hasChild(auth.uid)`, i.e.
  **any session member, including students in other rooms**. Free text is
  allowed up to 2000 chars. The same is true of `poll/$cid` (≈192) and the
  pre/post knowledge checks at `rooms/$room/tests/$cid` (≈436). Either move
  these three out of the session read-cascade the way the chat now is, or keep
  this sentence (§11, M16).*
  *(Corrected 2026-07-24: this paragraph used to say "Only `moduleA/chat` is
  read-gated to the room (≈309)". That was **false** — RTDB `.read` cascades and
  cannot be revoked at a deeper path, so that rule restricted nothing. The chat
  has since been moved to a top-level `roomChat/` tree with its own per-room
  `.read` (PR #235, deployed), so it is now genuinely room-private — but note
  that a deeper `.read` was never what made it so, and the same trick will not
  work for the three nodes above.)*
- *`index.html` still ships **three** fallback strings claiming anonymity:
  `survey.intro` ("A short, **anonymous** questionnaire…", ≈2744),
  `test.pre.intro` ("It's **anonymous** within your university…", ≈1374) and
  `test.post.intro` (≈2727). All three are **false** — the questionnaire and the
  tests are keyed to your client ID with a stable ID attached
  (`script.js`, ≈2812-2830) — and they are exactly what a student sees if i18n
  fails to apply. The `i18n.js` versions (≈756, 759, 782) are already correct,
  which is what makes this a silent drift. Must be fixed (§11, M4).*
- *The demographics question offers only **Caen / Nagoya / Other**
  (`case-content.js`, ≈4221-4223). For any other facilitator this must become
  configurable, or the item dropped.*

---

## 7. Screen F — Certificate of attendance *(shown when the download is clicked)*

> New screen. The certificate registry entry is written **at this click**
> (`script.js :: resolveCertId`, ≈7287-7318) — which makes this the honest
> moment to ask, rather than a third tick-box on the join form.

---

### Before we make your certificate

Your certificate carries a code and a QR code so that someone you show it to —
an employer, a university — can check it is genuine on a public page.

To make that work we publish, in a list anyone can read if they have the code:
**a scrambled version of your name**, the session code, the session name, and
today's date.

**This is not anonymous.** We do not publish your name, and the page only
answers "valid" or "no match". But the scrambled value is derived from your
name, so **someone who already has a list of names can test them against it**,
and we can always link the entry back to you.

*Why we are allowed to do this:* `[LEGAL BASIS — if GDPR Art. 6(1)(f), name the
interest. NOTE: APPI has **no** legitimate-interests basis, so a Japanese
controller needs consent (Art. 27(1)) — which is what this screen is.]`
You can object at any time: `[CONTACT]`.

Kept for up to **5 years**. To have your entry removed, email
**[DPO / PRIVACY CONTACT EMAIL]** — this is a formal request we must act on, not
a favour.

**[ Make my certificate ]**  **[ No thanks ]**

---

*Approx. 190 words. Notes:*

- *Today, `cVerification` is **hard-coded `true`** (`script.js`, ≈2120) with no
  student-facing choice.*
- ***M5, restated with the polarity fixed.** The English `privacy.html` §18
  (≈223-227) says the basis is **GDPR Art. 6(1)(f) legitimate interests; APPI
  Art. 17/18**, retention **5 years**, verification **on by default**. The
  French (≈392-398) and Japanese (≈550-556) versions say **explicit consent
  (Art. 6(1)(a); APPI Art. 17/21 opt-in)**, retention **10 years**, via **a
  third checkbox that does not exist in the UI**. The earlier draft framed
  FR/JA as the deviation. That is only half right: **the FR/JA legal basis is
  the defensible one** (APPI has no legitimate-interests basis, and Art. 18 is
  a purpose-limitation *restriction*, not an authorisation), while **the EN
  retention and default-on description are the ones that match the code**. The
  fix therefore pulls from both: adopt **consent at download** (this screen),
  keep **5 years**, and **strike legitimate interests from the canonical EN**.*
- ***Escalated from a footnote to a must-fix (§11 M13).** The verification ID is
  **not** random. `script.js` (≈7283) computes it as
  `canamedCertId(sessionNum + "|" + clientId)` — `pure-utils.js ::
  canamedCertId` (≈95-101) is a **non-cryptographic** hash reduced to 50 bits.
  `clientId` is the key of `pool/$clientId`, **readable by every session
  member**. `credentials/$certId` is `".read": true` — **unauthenticated**
  (`database.rules.json`, ≈82-86). So any classmate can recompute a peer's
  certificate ID from data they can already read, fetch the record with no
  login, and brute-force the **unsalted** name hash (`pure-utils ::
  credentialNameHash`) against a class list. `pure-utils.js`'s own comment says
  so: if a public self-service lookup is ever added, switch to a random ID —
  **that lookup was added**, and `randomCredentialId()` exists, is exported, and
  is **never called anywhere in the platform**. This contradicts `privacy.html`
  §18 ("cannot be listed or browsed", offered as a balancing safeguard) and
  `CLAUDE.md` ("cert IDs are crypto-random high-entropy (no enumeration)") —
  both must be corrected in the same change, per `CLAUDE.md`'s own STATUS-CLAIM
  RULE.*
- *`[TO VERIFY]` The registry entry is currently **never deleted** — no job
  touches `credentials/*`. The "5 years" promise is not enforced by anything.
  Either build the deletion job or change the wording.*

---

## 8. Screen G — Signing in *(optional account panel)*

---

### You do not need an account

You can join with just a name. Signing in only saves your session history so you
can find your certificates later.

If you sign in, we store your **email address and display name** with
`[SIGN-IN PROVIDER — Google Firebase Authentication]`.

**If you also agreed to research use**, your **name, email address and
university** are added to a list your facilitator can download. Your facilitator
is a **different organisation** from the platform operator, so this is a
disclosure to a third party. `[FACILITATOR TO CONFIRM]`

You can delete your account and profile from this panel. **This does not remove
what you wrote during a session, your entry on a facilitator's list, or a
certificate entry** — for those, write to **[DPO / PRIVACY CONTACT EMAIL]**.

---

*Approx. 130 words. Notes:*

- ***CORRECTED — field list.** The previous draft said "email address and
  display name". The node `rosters/sessions/$sessionId/$uid` stores **`email`,
  `name`, `university` and `at`** (`database.rules.json`, ≈46-73), readable by
  the session `creatorUid`. Written client-side by `script.js :: writeRoster`
  (≈2328-2345), gated on `myConsent.research === true`; exported as an
  identifiable CSV by `admin-tools.js :: generateEmailRoster` (≈987). It is
  **not mentioned in `privacy.html` at all**.*
- ***APPI characterisation.** Under the ratified model the facilitator is a
  different legal entity from the operator, so the roster download is
  **第三者提供** requiring Art. 27(1) consent (or an academic-research limb —
  §9), and triggers the **Art. 29/30 record-creation and retention duties on
  both sides**. If the recipient is outside Japan, **Art. 28 stacks on top**.
  Add records-of-provision to the operational checklist. `[TO VERIFY]`*
- ***CORRECTED — what "delete" deletes.** `script.js :: accountDelete` (≈14350)
  removes `users/$uid` and the Firebase Auth user. It does **not** touch session
  contributions, roster entries or certificate entries. Its own confirm dialog
  says contributions "are no longer linked to your identity" — that is
  optimistic, since `pool/$cid/name` still holds the name typed at join. Do not
  repeat that claim on screen.*
- *`[TO VERIFY]` The roster sits **outside** `sessions/`, so **no clean-up job
  ever deletes it**. Retention is currently indefinite. Either extend the
  clean-up job or state the real (indefinite) retention here — the second option
  is not defensible under storage limitation.*

---

## 9. Why consent may be the wrong basis — and what wording cannot fix

A student asked by their own teacher, in class, to tick a research box is not in
a position to freely refuse. **GDPR Recital 43** and **EDPB Guidelines 05/2020**
treat consent in this setting as **presumptively invalid** — and where the
controller is a **public authority** (a public university is one), that
presumption applies **regardless of how carefully the box is worded**. Where the
tick is *required* to take part, **Art. 7(4)** independently defeats it.

**The Japanese position is different, and the previous draft got it wrong.**
That draft said "Japanese APPI practice under Art. 20(2) reaches the same place
for sensitive information". **That is not correct and has been removed.** APPI
Art. 20(2) is solely the prior-consent requirement for *acquiring*
要配慮個人情報; it contains no freely-given or power-imbalance doctrine, and APPI
has no Recital 43 analogue and no EDPB. On the Japanese side these protections
must come from the 「人を対象とする生命科学・医学系研究に関する倫理指針」 and the
university's IRB — **not from the statute**. `[TO VERIFY with the Nagoya
bioethics committee.]`

**There may also be an exception route in Japan that changes this whole screen.**
The 2021 amendment brought 学術研究機関等 within APPI but gave targeted academic-
research limbs to **Art. 18(3)** (use beyond the specified purpose), **Art.
27(1)** (third-party provision) and **Art. 20(2)** (acquisition of
要配慮個人情報). Nagoya University is a 学術研究機関等. If the controller relies on
an exception, **consent is not the operative basis** — and offering a "consent"
that is not operative is itself misleading. Relying on an exception does **not**
remove Art. 21 purpose notification (明示), Art. 23 安全管理措置, or the Art. 28
transfer analysis. `[FACILITATOR TO CONFIRM]` which route the IRB requires — the
answer changes Screen B's wording materially, and where the exception applies,
the ethics guidelines' own consent / オプトアウト machinery governs instead.

**Wording is the smallest part of the fix.** These are the structural
requirements:

1. **Teaching participation must never depend on research consent.** The code is
   correct today — only `consent-workshop` gates the Join button
   (`script.js :: refreshJoinBtnState`, ≈1918-1941). Keep it that way and never
   add a research gate to any feature.
2. **Re-plumb the basis rather than re-word the box.** Teaching on
   Art. 6(1)(e); research on Art. 6(1)(e) + Art. 89(1) with a real **Art. 21(6)
   objection right**, unless the ethics committee positively requires consent.
   For a French controller, test conformity to **CNIL MR-004** first. The
   knock-on: the optional box becomes an **opt-out**, and §10's table changes.
3. **The facilitator must not see who consented while the session is live**, and
   ideally not before marks are final. Today they can: the facilitator reads the
   whole session tree including `pool/$cid/consent`, and the roster export is
   explicitly limited to research-consenters — which reveals the list by
   construction.
4. ***Every other participant can see it too.*** `pool/$clientId/consent`
   (`database.rules.json`, ≈206-209) sits under the same any-member `.read`, so
   every student can read every other student's `consent.research`,
   `consent.workshop`, version and timestamp. That adds **lateral social
   pressure** on top of the teacher/student imbalance, and it is itself an
   undisclosed disclosure. No wording fixes it — move the node (§11 M15).
5. **Someone other than the assessing teacher should answer questions about it.**
   Put `[INDEPENDENT CONTACT — e.g. the DPO or the study's non-teaching
   co-investigator]` on the screen.
6. **Withdrawal must be as easy as consenting** (GDPR Art. 7(3)) and must not
   require emailing the person who marks your work. Today it is email-only. This
   is now a **must-fix**, not a discussion point (§11 M14).
7. **Say it out loud.** Written reassurance in a dialog is weaker than the
   teacher saying it in the room. Suggested script:

> "There is a second, optional box about research. It is genuinely optional. I
> will not look at who ticked it, it makes no difference to your marks or to
> anything you do today, and you can change your mind afterwards from inside the
> app, or by writing to [INDEPENDENT CONTACT]. If you would rather not, just
> leave it unticked and join."

`[FACILITATOR TO CONFIRM]` Whether the ethics committee requires an opt-out
window after the session (a common condition: "you may withdraw your data for N
days afterwards").

---

## 10. What each decision writes to the database

Traceability, for the ROPA, for an APPI Art. 33 disclosure response, and for
answering access requests. **Note:** if §9(2) is adopted and the basis changes
from consent, the first two rows stop being "consents" and become an
acknowledgement and an opt-out — update this table with the decision.

| Decision | Stored at | Effect in code |
|---|---|---|
| Take part (required) | `sessions/$code/pool/$cid/consent.workshop` (`database.rules.json`, ≈206) | gates the Join button (`script.js :: refreshJoinBtnState`, ≈1918) |
| Sensitive-content acknowledgement | **not stored — does not exist yet** | see §11 M19 |
| Research use (optional) | `…/consent.research` | gates the email roster write (`script.js :: writeRoster`, ≈2332) **and, since PR #232 (deployed), the research export**: `scripts/lib/pseudonymise.js` includes only participants whose `consent.research === true`, fail-closed (absent/false/malformed ⇒ excluded), and drops their clientId-, stableId- and uid-keyed data. Sessions where nobody consented are skipped entirely. **Still NOT filtered: the disaster-recovery backup** (`backup-sessions.js` — deliberately, it rests on a different legal basis and filtering it would break restore and erasure handling) **and the facilitator CSV**. See §11 M11 |
| Notice version | `…/consent.version` = `CONSENT_NOTICE_VERSION` (`script.js`, ≈2105) | audit trail — currently one global value for all controllers |
| Certificate verification | `…/consent.verification`, hard-coded `true` (`script.js`, ≈2120) | no user choice today; entry written at download to `credentials/$certId` |
| AI-patient notice acknowledged | `localStorage.canamedModALLMConsent` (`modA-llm-init.js`, ≈165) | browser-local only — not recorded server-side, so it cannot be evidenced, and it carries into a **different controller's** session |
| Cross-border transfer (APPI Art. 28) | **not stored — does not exist yet** | see §3b and §11 M17 |

**Two mechanical problems with the consent record itself:**

- **The evidence is destroyed while the data lives on.** The record sits at
  `sessions/$code/pool/$cid/consent` and is deleted with the session —
  `scripts/cleanup-stale-sessions.js` does `db.ref("sessions/" + code).remove()`
  (≈115) — while the research dataset persists for the controller's chosen
  period. The controller therefore destroys its **GDPR Art. 7(1)** evidence
  while continuing to rely on the consent. **Fix:** copy
  `{version, timestamp, decision}` into the export artefact and retain it for
  the life of the dataset (§11 M20).
- **Withdrawal becomes impossible, silently.** The linkage table is the only
  route from a person to their rows in the pseudonymised export. Once it
  expires, an erasure or withdrawal request is **unsatisfiable** — and its
  retention is itself contradictory: `CLAUDE.md` and
  `scripts/pseudonymise-export.js`'s own env documentation (≈39-41) say a
  **~14-day** GCS lifecycle for `linkage/`, while the same file's header (≈8-9)
  claims a **"6-month linkage-destruction commitment in the privacy policy"**.
  One of those is a broken promise somewhere. Resolve it (§11 M21).

---

## 11. Must fix in code before this text can be shown

This wording is only honest once these land. Each is a factual contradiction
between what the product says today and what it does, or a processing problem
that exists independently of this document.

**Blocking — the notice is untrue or the processing is unlawful without these:**

- **M11 — The research export has no consent filter. ✅ RESOLVED 2026-07-24
  (PR #232, deployed).** *Historical:* `pseudonymise-export.js` iterated the
  whole `/sessions` tree and pseudonymised **every** participant of every closed
  session, so non-consenting students' answers, hypotheses, votes and free text
  entered the research artefact nightly.
  *Correction to the original finding:* it stated "`grep -rn consent scripts/`
  has no hit outside the simulator" and inferred no consent flag existed. The
  **flag did exist** — `pool/$cid/consent.research`, collected by an optional
  lobby tick that never gated the Join button, and validated in the rules on
  **both** the sessions and orgs trees. Only the *consumer* was missing.
  *Fixed as recommended:* `pseudonymiseSession()` now filters at source,
  **fail-closed** (absent, `false` or malformed consent all exclude), removing
  the participant's clientId-, stableId- and uid-keyed data, giving them no
  linkage-table entry, and skipping sessions where nobody consented. The
  **backup** is deliberately left unfiltered and rests on its own
  continuity/security basis, exactly as this item recommended.
  ⚠️ **Still open:** `admin-tools.js :: researchCsvParticipantRows` (the
  facilitator CSV) has **no consent check**. Screen B may now describe the
  research *export* as optional, but not the facilitator CSV.
- **M12 — The AI-patient recipient is unknowable in advance.** `HF_URL` points
  at Hugging Face's router (`functions/index.js`, ≈163); the downstream provider
  is only learned **after** the response (`x-inference-provider`, ≈447). You
  cannot inform a data subject of a recipient you do not know (GDPR Art.
  13(1)(e)-(f)), the controller cannot give the Art. 28(2) prior authorisation
  the companion DPA promises, and APPI Art. 28 cannot be satisfied in its normal
  form. **Fix is engineering:** pin the inference provider (HF supports explicit
  provider selection / provider-specific endpoints) or route to one named
  EU-hosted endpoint; then name it, its country and its transfer mechanism in
  Screens C, D and B-JP.
- **M13 — Certificate IDs are computable by any classmate; the name hash is
  unsalted.** See §7. **Fix:** use `randomCredentialId()` persisted server-side,
  or a per-session secret salt on the name hash. Correct `privacy.html` §18 and
  the `CLAUDE.md` claim in the same change.
- **M14 — Withdrawal is email-only.** GDPR Art. 7(3) requires it to be as easy
  as giving. **Fix:** an in-product "Withdraw research consent" control on the
  same surface as the tick-box, writing `consent.research = false` and marking
  the participant for exclusion from the next export. The certificate opt-out
  and the roster removal are email-only too.
- **M1 — Retention.** UI says session data is purged in **7 days**
  (`index.html` ≈970-975, `i18n.js :: "lobby.privacy.p3"` ≈378,
  `privacy.html` ≈155/322/485). The job purges at **30 days after close / 90
  days if never closed** (`scripts/cleanup-stale-sessions.js`, ≈42-43). Pick one
  and make both match.
- **M9 — Org-scoped sessions have *no* retention at all.** Verified:
  `cleanup-stale-sessions.js`, `backup-sessions.js` and `pseudonymise-export.js`
  each read `db.ref("sessions")` only; **nothing touches `orgs/**`**. In an org
  session, Screen A's deletion promise and Screen C's whole retention table are
  simply untrue. **This is a hard gate, not a bullet:** block org go-live until
  the three jobs cover `orgs/**`, or make the notice refuse to render in org
  mode.

**High — false or missing statements in the binding notice:**

- **M2 — The AI patient is absent from the binding notice.** `privacy.html`
  contains **no** mention of a language model, of chat, of Hugging Face, or of
  reCAPTCHA (grep-confirmed). Disclosure exists only in the in-product banner.
- **M3 — Undisclosed US processing.** `hfPatient` runs in `us-central1`
  (`functions/index.js`, ≈319) while the notice tells participants the data is
  in Belgium. No transfer mechanism is described.
- **M4 — "Anonymous" is claimed three times and is false every time.**
  `index.html` fallback strings `survey.intro` (≈2744), `test.pre.intro`
  (≈1374) and `test.post.intro` (≈2727). Their `i18n.js` counterparts (≈782,
  756, 759) are already correct — which is what makes this silent drift. **Add a
  test** that diffs every `data-i18n` fallback against the EN table, so this
  class of bug is caught mechanically.
- **M5 — FR/JA §18 contradict EN, and the EN is the one with the wrong basis.**
  See §7. FR (≈392-398) and JA (≈550-556) state consent, **10 years**, and a
  third checkbox that does not exist; EN (≈223-227) states legitimate interests
  and 5 years. Adopt consent + 5 years; strike legitimate interests from EN.
- **M6 — Email roster has no deletion path and no mention** in any notice; it
  lives outside `sessions/` so no job reaches it.
- **M7 — Certificate retention is promised but not enforced** — nothing deletes
  `credentials/*`.
- **M8 — Per-turn AI usage logs.** `metrics/hfPatient/events`
  (`functions/index.js`, ≈482-497) record uid, session code, timestamps, message
  counts, reply length, latency, token counts and the provider name; they are
  never deleted, are invisible to clients — so an access request would miss them
  — and are disclosed nowhere.
- **M10 — Controller identity is hard-coded** to Caen × Nagoya across
  `privacy.html`, `i18n.js` (`lobby.privacy.p1` ≈376, `lobby.privacy.p6` ≈381),
  `compliance.html` and the survey's university options. All must become
  per-controller configuration.
- **M22 — "No third-party cookies, no tracking pixels" is false.**
  `privacy.html` §17 (≈214-219) says it, while reCAPTCHA loads on every page.
  This is a false statement in the **binding** notice, not an open question.

**Medium — structural changes this wording assumes:**

- **M15 — Consent choices are peer-readable.** Move `pool/$cid/consent` out of
  the any-member subtree (e.g. a sibling node keyed by uid with an owner-only
  `.read`), and disclose it in Screen A/B until then. See §9(4).
- **M16 — Questionnaire, poll and knowledge-check answers are peer-readable.**
  `survey` (≈458), `poll` (≈192) and `tests` (≈436) carry no `.read` of their
  own and inherit the any-member session read. Either read-gate them the way
  `moduleA/chat` is (≈309), or keep Screen E's disclosure sentence.
- **M17 — The AI-chat acknowledgement needs a server-side record**, scoped per
  session, re-prompted on notice-version **or provider/model** change.
- **M18 — ePrivacy / Art. 82 loi Informatique et Libertés.** Reading or writing
  terminal equipment is a **separate** consent regime the CNIL enforces
  independently of GDPR. Engaged by reCAPTCHA **and** by the platform's own
  storage: `localStorage.canamedModALLMConsent` and the resume blob, which
  persists name, university and consent state and **auto-rejoins the session
  with no screen shown** if the notice version still matches
  (`script.js`, ≈11961-11970). Strictly-necessary storage is exempt; a resume
  blob and an analytics-capable anti-fraud script are at best arguable.
  **Do a per-item strictly-necessary assessment**, and separately review whether
  a silent auto-rejoin that re-affirms an *optional* research consent with no
  interaction satisfies **Art. 4(11)**'s "clear affirmative action".
  Also: reCAPTCHA fires **before any notice is rendered**, so no consent taken
  on the join form can cover it — either gate it behind a pre-load interstitial
  for JP-facing deployments, or (noting `CLAUDE.md` records App Check as
  reverted to *Monitor* for both RTDB and `hfPatient`, i.e. currently providing
  no enforcement benefit) drop the provider for those deployments and remove the
  disclosure burden entirely. There is also an unaddressed **APPI Art. 31
  個人関連情報** question for IP and device signals provided to Google.
- **M19 — The sensitive-data decision does not exist in the UI.** `locales/ja.js
  :: "lobby.privacy.p2"` (≈267) attaches 要配慮個人情報 to the **optional**
  research box. It must attach to the **required** participation decision, or
  the product must be redesigned so such data is not acquired.
- **M20 — Consent evidence is destroyed with the session** while the research
  dataset lives on. Copy the decision into the export artefact. See §10.
- **M21 — Linkage retention contradiction: 14 days vs 6 months.** See §10.
- **M23 — `stableId` is an undisclosed persistent identifier.**
  `script.js :: STABLE_ID_KEY` (≈1306) stores an 80-bit value in
  `localStorage.canamed_stable_id` that survives tab close, refresh, new tabs
  and **separate sessions**, or is bound to `auth.uid` when signed in. It is
  written into `survey`, `tests` and `votes/ballots` precisely to link one
  person across sessions. Under the facilitator-as-controller model the same
  identifier links a participant across sessions run by **different
  controllers**. Disclose it (Screen C now does), state that signing out clears
  it, and reconcile the "no cookies / no tracking" wording (M22).
- **M24 — No participant-facing erasure exists.** Chat turns are write-once; all
  participant writes fail once the session is `closed`; no script deletes below
  session granularity. Build the operator tooling and name it in Screen A.

---

## 12. Translation note

The three language versions of the privacy notice have already drifted apart in
a way that changed the **legal basis** and **doubled a retention period** (M5).
Any change to these screens must be re-translated by a human, and the FR and JA
versions must be re-checked against the EN before release. A machine
back-translation check is not sufficient for consent text.

**The Japanese rights paragraph is not a translation problem.** Screen C's
Japanese block is a **different right set**, not a rendering of the European
one: "get a copy" (portability) and "object" have no APPI counterpart, and
"withdraw consent" is not a general APPI right — the operative vehicle is
**Art. 35 利用停止・消去・第三者提供の停止**, whose grounds are specific. A faithful
Japanese translation of the European list would be faithfully wrong. Draft the
Japanese block natively, in Art. 33/34/35 terms, with the fee stated.

---

## 13. Open items — everything the institution must supply

**`[BRACKETED]` slots used above**

| Slot | Where |
|---|---|
| `[CONTROLLER LEGAL NAME]` | Screens A, B, C |
| `[CONTROLLER ADDRESS]` / `[REPRESENTATIVE]` | Screen C |
| `[OPERATOR LEGAL NAME]` | Screen C |
| `[DPO / PRIVACY CONTACT EMAIL]` | Screens C, F, G |
| `[COMPLAINTS CONTACT — 苦情の申出先]` | Screen C |
| `[INDEPENDENT CONTACT — non-assessing]` | §9 |
| `[LEGAL BASIS]` — one per purpose, GDPR **and** APPI | Screens B, C, F |
| `[RESEARCH PROJECT NAME]` | Screen B |
| `[NOTICE VERSION]` | Screen B |
| `[RETENTION PERIOD CHOSEN BY THE CONTROLLER]` | Screen C |
| `[LINKAGE RETENTION — N days]` | Screens B, C |
| `[RESPONSE TIME]` | Screen C |
| `[SUPERVISORY AUTHORITY]` | Screen C |
| `[FEE — APPI disclosure request]` | Screen C |
| `[ACCREDITED PIP ORGANISATION — or "none"]` | Screen C |
| `[SAFETY-MANAGEMENT MEASURES SUMMARY — 安全管理措置]` | Screen C |
| `[SUBSTITUTE INFORMATION — unidentifiable transfer country]` | Screen B-JP |
| `[RESEARCH RECIPIENTS]` (EU and Japan) | Screen C |
| `[SIGN-IN PROVIDER]` | Screen G |
| `[SMTP PROVIDER]` | Screen C — see below |
| `[AGE]` | Screen C |
| `[N] minutes` | Screen E |
| `[HOW TO WITHDRAW — link]` | Screen B |

**`[FACILITATOR TO CONFIRM]`**

1. Their own notice version string (replacing the global `PIS-v2-2026-05`).
2. Whether a non-LLM alternative is offered to students who decline the AI chat.
3. Whether signing in + research consent putting the student's name, email and
   university on a facilitator-downloadable list is disclosed and acceptable —
   and, for Japan, under which APPI characterisation (第三者提供 vs an academic-
   research limb), with Art. 29/30 records of provision on both sides.
4. Whether the ethics committee requires a post-session withdrawal window.
5. Ethics approval reference(s), if any — the current text asserts Caen and
   Nagoya approvals that a third-party facilitator cannot inherit.
6. The SMTP provider, before the (currently disabled) email feature is turned
   on. Verified: `functions/index.js :: sendQueuedMail` runs in `europe-west1`
   and is gated by `emailEnabled()`; the exposure is the **SMTP hop**, not the
   function.
7. Which APPI route the Japanese IRB requires: consent, or the 学術研究機関等
   exception (§9). The answer changes Screen B materially.
8. Whether the facilitator's display name being visible to participants (in
   shared scenarios) is disclosed in their consent flow.

**`[TO VERIFY]`**

1. Transfer mechanism **per destination, per regime**: for GDPR, the adequacy
   decision or the specific safeguards **plus the means to obtain a copy**
   (Art. 13(1)(f)); for APPI, the Art. 28 information set or the 基準適合体制
   route. Legs: the US Cloud Function, Hugging Face **and its downstream
   providers**, reCAPTCHA, GitHub Actions, and **Japan** (remote facilitator/
   observer access and research recipients).
2. Whether the 2019 EU→Japan adequacy decision reaches a **国立大学法人** after
   the 2021 APPI amendment moved public-sector bodies into a separate chapter.
3. Whether a Nagoya-run session is governed by the private-sector chapter or by
   the **APPI Art. 58 / 別表第二** special application rules — this changes the
   disclosure procedure, complaint routing and fees, and `privacy.html`'s
   article citations inherit the same assumption. **Blocking** for the Japanese
   rights paragraph.
4. Firebase Authentication and Firebase Hosting data locations and log
   retention.
5. Whether the facilitator being able to see who consented, live, is acceptable
   to the ethics committee — and whether peer visibility (§9(4)) is.
6. Which browser-storage items are "strictly necessary" under ePrivacy /
   Art. 82 LIL, and whether silent auto-rejoin satisfies Art. 4(11).
7. Whether the research file may be shared with co-investigators at other
   institutions given the 仮名加工情報 provision restriction (APPI Art. 41).
8. What retention the controller sets for the research dataset, and whether it
   is compatible with the linkage-destruction date.

---

## 14. Open questions — where this draft does **not** follow a review comment

Recorded so the disagreement is visible to counsel rather than silently
resolved. Each was checked against the code.

1. **"`orgSlug` is never sent to `hfPatient`, so org rooms silently fall back to
   the stub patient."** — **Not adopted; the claim is incorrect.** Verified:
   `modA-llm-init.js` builds the callable payload with `roomCode` and `roomId`
   and then `if (orgSlug) payload.orgSlug = orgSlug;` (≈466-473), and
   `functions/index.js :: _verifyMembership` (≈255-275) reads `body.orgSlug`,
   validates it, and resolves
   `orgs/${orgSlug}/sessions/${code}/rooms/${roomId}/uidMembers/${uid}`. So the
   AI patient **does** work in org sessions and Screen D's US-transfer
   disclosure is **not** over-disclosure there. The *separate* org finding —
   that no retention/backup/export job walks `orgs/**` — **is** correct and is
   kept as the blocking item M9.
2. **"Add the certificate's Art. 21 objection right, which Screen F omits."** —
   **Adopted**, with a caveat kept in the text: an Art. 21 objection right only
   exists if the controller lands on Art. 6(1)(e)/(f). Since the basis is
   `[BRACKETED]`, Screen F offers the objection generically ("You can object at
   any time") rather than citing an Article the controller may not be using.
3. **"M5's polarity is backwards — the FR/JA texts are the compliant ones."** —
   **Partly adopted.** The APPI point is right (APPI has no legitimate-interests
   basis; Art. 18 is a restriction, not an authorisation), and EN is now
   flagged as the defective one on **basis**. But FR/JA remain defective on
   **retention** (10 years vs the code's 5, and vs the DB rule's ~5-year
   `retentionUntil` cap in `database.rules.json`) and on **describing a third
   checkbox that does not exist**. Neither version is simply "the good one".
4. **"Screen A should not state 30/90 days at all until M9 lands."** — **Not
   adopted as a deletion.** The figure is correct for the default `sessions/`
   tree, which is what almost every participant will be in, and removing it
   would leave layer 1 with no retention statement at all — itself an Art.
   13(2)(a) problem. Instead the promise is kept, the backup is surfaced in
   layer 1, and M9 is escalated to a **hard gate on org go-live**. If org mode
   ships first, this paragraph must change, not just the footnote.
5. **Exact word counts have been replaced by "approx."** — the earlier counts
   were asserted precisely and could not be reproduced; approximations avoid a
   trivially false claim in a document about not making false claims.

---

*End of draft. Nothing here is legal advice. Nothing here has been reviewed.*
