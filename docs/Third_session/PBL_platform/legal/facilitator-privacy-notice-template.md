# Privacy notice — TEMPLATE for facilitators running a CaNaMED session

---

> # ⚠️ UNREVIEWED DRAFT — DO NOT PUBLISH AS-IS
>
> **This document was prepared with AI assistance. It has NOT been reviewed by a
> lawyer, by a Data Protection Officer, or by any institution.**
>
> It is a starting point, not legal advice. Before you give this notice to a
> single participant you **must** have it reviewed and approved by qualified
> counsel and/or your institution's DPO or research-ethics office. You are the
> data controller: the accuracy of this notice is your legal responsibility, not
> the platform's and not the AI's.
>
> Every `[BRACKETED SLOT]` is a fact only your institution can supply. Every
> `[TO VERIFY]` marks something that could not be confirmed from the platform
> source code and must be checked against the live system before you rely on it.
> **Delete this whole box before publishing.**

---

# ⛔ BLOCKING PRECONDITIONS — do not run a session until all of these are true

*(Facilitator section. Delete before publishing. These are not checklist
niceties; each one is a point at which publishing this notice would make a
false statement to a participant or process data without a lawful basis.)*

**B1 — The product must stop telling participants something different.**
At the moment of collection the participant reads the **join screen**, not this
notice. Today that screen (verified in `i18n.js`) says the controllers are
"the CaNaMED research team (Université de Caen Normandie × Nagoya University),
joint controllers under GDPR Art. 26 / joint users under APPI Art. 27(5)", that
"live session data is purged within **7 days**", and points at
`canamed-ethics@unicaen.fr`. `privacy.html` repeats both. The consent record
written to the database hard-codes a **different notice version**
(`CONSENT_NOTICE_VERSION = "PIS-v2-2026-05"` in `script.js`) — so the audit
trail evidences somebody else's notice, not yours.
**Do not run a session until** the join-screen text, `privacy.html`,
`compliance.html` and `CONSENT_NOTICE_VERSION` are per-controller configurable
and set to *your* entity, *your* contact, *your* retention figure and *your*
notice version. A precedence clause in a document read afterwards does not cure
information given wrongly at the point of collection (GDPR Art. 13(1) chapeau,
Art. 12(1); APPI Art. 21).

**B2 — The research export is not consent-gated in code.**
`scripts/pseudonymise-export.js` and `scripts/lib/pseudonymise.js` contain **no
reference to consent** (verified by search). The nightly export pseudonymises
and ships the whole `/sessions` tree — every participant's answers, hypotheses,
votes, poll free text and the five 2,000-character questionnaire boxes —
**whether or not the participant ticked the research box**. Only the email
roster branches on `consent.research`.
**Do not present research as a consented, refusable purpose until** either (a)
the export filters at source on `pool/$cid/consent.research`, or (b) you drop
the consent framing and rely on Art. 6(1)(e) + Art. 89(1) safeguards with a
**right to object**. Section 3 and section 10 below must be edited to match
whichever you choose. Publishing the consent framing over the current code is a
false statement to every participant who declines.

**B3 — Decide the Art. 9 / 要配慮個人情報 question before, not after.**
GDPR Art. 9(1) is a **prohibition** with exhaustive exceptions; it is not a
bracket to fill. Consent (Art. 9(2)(a)) is presumptively invalid where you also
assess these students (see B4). Art. 9(2)(j) requires a basis **in Union or
Member State law** plus Art. 89(1) safeguards that must exist *before*
processing. Under APPI, Art. 20(2) governs **acquisition** — consent must exist
*before* the free-text box is shown, not before the data is "handled".
**Either** name the national-law provision and the Art. 89(1) safeguards in
writing, **or** redesign the session so Art. 9 disclosure is not foreseeable
(no self-referential prompts; AI chat off for Art. 9-heavy scenarios).

**B4 — If you mark these students, you cannot rely on consent.**
Recital 43 and EDPB Guidelines 05/2020 treat consent under a clear imbalance of
power as invalid. A student asked by their own assessing teacher cannot freely
refuse. Art. 6(1)(b) is also wrong — there is no contract with the student for
the teaching activity. Use Art. 6(1)(e) (public university) or Art. 6(1)(f).
Note that the product **blocks joining** until the workshop consent box is
ticked, so that box cannot be a free choice: treat it as an acknowledgement of
reading, and say so (section 3 does).

**B5 — Resolve the Hugging Face transfer, or turn the AI chat off.**
The `hfPatient` function runs in **`us-central1`** (verified in
`functions/index.js`) and Hugging Face routes each request onward to an
inference provider **whose identity is only visible in the response header
after the fact** — it cannot be named in advance. You cannot make a GDPR
Art. 13(1)(f) disclosure, or conclude Art. 46 safeguards, with an importer whose
identity varies per request. Under APPI the entrustment (委託) carve-out in
Art. 27(5) **does not apply to Art. 28** foreign transfers.
**Unless** the operator confirms in writing that the Hugging Face account is
pinned to one named provider and region, with a data-processing agreement and
transfer safeguards in force, **the AI character must be disabled for your
session** (the operator sets `MODA_LLM_ENABLED=false`; participants fall back to
the legacy click-through workup — see the DPA's sub-processor section).

**B6 — Have these three documents in hand.**
- A **DPIA completed and signed off** (GDPR Art. 35(1) requires it *prior to*
  the processing). On WP248 criteria this processing hits at least four
  triggers: evaluation/scoring; vulnerable data subjects (students under an
  assessment relationship); innovative technology (an LLM processing
  unconstrained student free text); transfers outside the EEA — with
  special-category disclosure foreseeable (Art. 35(3)(b)). If the DPIA shows
  high residual risk, Art. 36 prior consultation follows.
- An **Art. 30 record of processing activities** updated for this session.
- A **signed Art. 28 processor agreement** with the platform operator. Section 1
  of the notice tells participants a written contract exists — do not publish
  that sentence before it is signed. Under APPI the parallel duty is
  **necessary and appropriate supervision of the entrustee (Art. 25)**, which is
  a different obligation from an Art. 28 contract and must be discharged too.

**B7 — Assign the manual deletions, with a trigger and one proven run.**
Three categories have **no automated deletion at all** (verified: the cleanup
job reads only `sessions/`): the participant email roster (which lives at
top-level `rosters/`), the certificate verification records, and the AI-chat
usage log under `metrics/hfPatient/*`. A published retention period that nobody
executes is an Art. 5(1)(e) breach the day it elapses. Before the first
session: name the person, put the trigger in a calendar, and **run it once
successfully**. Record the operator's manual-deletion turnaround (see the DPA's
deletion section) so you know how long you must wait.

**B8 — Correct the stale translated pages, or do not teach in that language.**
`privacy.html` **FR §18** and **JA §18** still describe certificate
verification as an optional third tick-box retained for **10 years**. Verified
reality: there is no tick-box (`resolveCertId()` writes a record on **every**
certificate generation), the English §18 says verifiable **by default**, and the
client writes a retention date of about **5 years** (`5×365 − 30` days). A
French or Japanese student reading their own language is told they opted in when
they did not, and given double the real retention. Ask the operator to correct
FR/JA §18, and never copy those figures into a translation.

**B9 — Give participants a contact who does not mark them.**
Art. 7(3) requires withdrawal to be as easy as giving consent, and consent here
is one tick. If the only address in your notice is read by the assessing
teacher, withdrawal is not equivalent and the reassurance "this will not affect
your marks" is issued by the person who sets them. Fill
`[INDEPENDENT CONTACT]` with someone who has no assessment role over this
cohort. Ask the operator for an in-product withdrawal control; until it exists,
say plainly that withdrawal is by email and to whom.

---

## How to use this template (facilitator instructions — delete before publishing)

1. **Work through the blocking preconditions above first.** If any is unmet,
   stop. Nothing below fixes them.
2. **You are the controller.** When you create a session on this platform, you
   (and/or your institution) decide why and how participants' data is processed.
   The platform operator acts as your **processor** for most of it — but see
   section 1 and the open question about the elements the operator decides
   deployment-wide (retention defaults, sub-processor set, hosting region, model
   choice, the certificate-registry design, and the `metrics/hfPatient/*` cost
   log). If your DPO concludes the operator is a **joint controller** for those,
   an Art. 26 arrangement is needed and section 1 must be rewritten.
3. **Read Appendix A (who processes data) and Appendix B (retention) before you
   fill anything in.** They describe what the software actually does today. If a
   statement there is unacceptable to your institution, change your session
   design — do not change the statement.
4. **Fill in every `[BRACKET]`.** Search the file for `[` until none remain.
5. **Resolve every `[TO VERIFY]`.** Check the live Firebase/GCP console or ask
   the platform operator **in writing**; then either state the confirmed fact or
   delete the claim.
6. **Publish it where participants can read it before they join** — the join
   screen shows a short summary and links out; give participants this full
   notice by the same link, an LMS page, or a handout.
7. **Translating is not sufficient for a Japanese cohort.** The workshop UI
   renders in **English for everyone** — the consent wording included (verified:
   `t()` in `i18n.js` always returns English). For a Japanese cohort you must
   supply Japanese consent wording alongside the join screen, or take consent in
   Japanese on paper or in the LMS before the session, and **record which
   language version the participant actually read**. Say which language version
   governs.
8. **Document an Art. 14(5)(b) assessment.** Participants will sometimes type
   third parties' details despite the warnings (section 5a). The "do not type
   it" warning is a mitigation, not a control.
9. **Facilitator-only material must not ship.** Everything above the second
   `---` rule, plus Appendix C and the "Open questions" section, is written to
   *you*. Delete all of it. Appendices A and B are participant-facing and stay,
   with your answers filled in.

---
---

# Privacy notice — [SESSION OR COURSE NAME]

**Who this is for:** everyone taking part in the [SESSION OR COURSE NAME]
problem-based learning session on [SESSION DATE(S)].

**Version [NOTICE VERSION] · [NOTICE DATE] · published at [NOTICE URL]**

**The short version below takes about a minute and covers the things most
likely to matter to you.** The rest is the full detail — about twenty minutes —
and you can come back to it. If you read only two full sections, read **5 (the
AI chat)** and **6 (your certificate)**.

---

## The short version

- **[CONTROLLER LEGAL NAME] is responsible for your data.** Not the software
  vendor — us. Questions and complaints come to us: **[CONTROLLER CONTACT
  EMAIL]**. If you would rather not write to someone who teaches or marks you,
  write to **[INDEPENDENT CONTACT]** instead.
- **We collect** your first name, your university, your year of study, your
  self-rated English level, and everything you write or choose during the
  session.
- **Nothing you write in the session is private from your classmates.** Everyone
  signed in to the session can read the **whole** session — including the other
  rooms' work and **the AI-chat transcripts**.
- **Your end-of-session feedback, your "what was hardest?" answer and your
  knowledge-check score are not private either.** They are stored next to your
  name and every other participant in the session can read them. If you want to
  say something only to the teaching team, say it to [CONTROLLER CONTACT EMAIL]
  or [INDEPENDENT CONTACT] instead of typing it into the boxes.
- **The session includes a chat with an AI character** (a simulated patient or
  relative). **What you type in that chat is sent to a company outside our
  institution — Hugging Face — and processed abroad, including in the United
  States.** Never type real names, real patient details, or anything personal
  about yourself or anyone else.
- **If you download a certificate**, a record is stored in a lookup that anyone
  holding the certificate code can read, without logging in. It contains a
  scrambled version of your name — but see section 6: the scrambling is weak,
  and a determined person could recover a common first name from it.
- **Three things are not deleted automatically:** your email address (only if
  you signed in and consented to research), your certificate record, and a
  technical usage log of the AI chat. We delete these by hand.
- **We keep session data for [RETENTION — SESSION DATA].** See section 8 and
  Appendix B for everything else.
- **You can ask us for a copy, a correction, or deletion at any time**, and it
  will not affect your grades or standing. Contact [CONTROLLER CONTACT EMAIL]
  or [INDEPENDENT CONTACT].

---

## 1. Who is responsible for your data

<sub>GDPR Art. 13(1)(a)–(b); APPI Arts. 25, 27(5), 32</sub>

**Data controller**

- **[CONTROLLER LEGAL NAME]**
- [CONTROLLER POSTAL ADDRESS], [CONTROLLER COUNTRY]
- [CONTROLLER REPRESENTATIVE'S NAME — required for the APPI Art. 32 disclosure]
- Contact for anything in this notice: **[CONTROLLER CONTACT EMAIL]**

**An independent contact.** If you would prefer not to raise something with
someone who teaches or assesses you, write to **[INDEPENDENT CONTACT — a named
person with no assessment role over this cohort]**. Any right in section 9 can
be exercised through either address.

**The facilitator running this session:** [FACILITATOR NAME AND ROLE],
[FACILITATOR CONTACT EMAIL].

**Data Protection Officer (DPO):** [DPO NAME AND CONTACT — or state "We are not
required to appoint a DPO. Contact [CONTROLLER CONTACT EMAIL] instead."]

**If you are outside our country:** [EU / UK REPRESENTATIVE — if the controller
is established outside the EU/UK and Art. 27 applies] · [JAPAN CONTACT — if
participants are in Japan and APPI applies].

**The platform itself** is operated for us by **[PLATFORM OPERATOR LEGAL NAME]**
as our *processor* — they run the software and the database on our
instructions; they do not decide what your data is used for.
[CONFIRM BEFORE PUBLISHING: a written processor agreement (GDPR Art. 28) is
signed. Do not publish the words "under a written contract" until it is.]

Some technical settings are decided by the operator for the whole platform
rather than by us for this session — the hosting region, the default retention
of the automated jobs, which companies in Appendix A are used, which AI model is
configured, and a cost-and-abuse log about the AI chat (see section 5). [STATE
WHO IS RESPONSIBLE FOR THOSE — if your DPO concludes the operator decides them,
say that the operator is a controller or joint controller for them, give the
operator's own contact, and summarise the arrangement here (GDPR Art. 26(2)).]

**If you are in Japan** (or your institution processes your data in Japan): the
Japanese-law description of the same relationship is that
**[CONTROLLER LEGAL NAME]** is the personal-information handling business
operator (個人情報取扱事業者) and the platform operator is an **entrustee
(委託先)** under APPI Arts. 25 and 27(5)(i); we owe a duty of necessary and
appropriate supervision over them. **Neither entrustment (委託) nor joint use
(共同利用) removes the separate rules on transfers to a foreign country** —
see section 7.
[IF YOU SHARE DATA WITH A PARTNER UNIVERSITY AS JOINT USE under APPI
Art. 27(5)(iii), complete **Appendix D**; if you do not, delete Appendix D and
say so here.]

---

## 2. What we collect

**You give us, on the join form**

- First name (or the name you choose to display)
- University or affiliation
- Year of study
- Self-rated English level
- Your consent choices, and which version of this notice you agreed to

**We record as you take part**

- Your free-text answers, hypotheses, clinical reasoning notes and replies
- Your votes and decisions
- Your role choice, presence ("online now"), typing indicator, points scored
- **Your answers to the in-session knowledge check, including your score.**
  *Other participants in your session can read this.*
- **Your answers to the qualitative poll**, including the free-text "what was
  hardest?" box, which is stored next to your display name.
  *Other participants in your session can read this.*
- **Your answers to the wrap-up questionnaire** — rating scales **plus five
  free-text boxes** ("what did you think of the platform", "what did you
  learn", "what should be improved", and so on), each up to 2,000 characters.
  *Other participants in your session can read this.* It is not private feedback
  to the teaching team.
- **Everything you type in the AI-character chat** (see section 5).
  *Other participants in your session can read this.*

**From your device / browser**

- A random identifier for your browser tab, created fresh each time.
- **A longer-lived identifier for your browser**, stored on your device. It
  survives closing the tab, refreshing, and opening a new tab, and it is written
  next to your poll, knowledge-check and wrap-up answers. **Its purpose is to
  let researchers link those answers together as belonging to one person, across
  tabs and across sessions.** If you sign in, it is tied to your account, so it
  is the same value on every device and browser you use. It is removed when you
  sign out; otherwise it stays until you clear your browser storage.
- Small settings stored on your own device (language, sound, theme, the session
  code so you can rejoin). No advertising cookies, no analytics trackers.
- **Scripts loaded from Google on every page.** The platform's core software
  libraries are served by Google (`gstatic.com`), a security check (Google
  reCAPTCHA) runs on page load, and Google's sign-in service is contacted if you
  sign in with Google. Each of these means your IP address and browser details
  reach Google **before you have read this notice or made any choice**.
  [TO VERIFY before publishing — whether reCAPTCHA stores anything on your
  device in our configuration, and whether it is treated as strictly necessary
  under the ePrivacy rules (French Art. 82 LIL / your national equivalent). This
  must be resolved before publication, not afterwards.]

**If you sign in with a Google account or create an account**

- Your email address, display name, and (Google only) your profile picture
- **If you sign in *and* you consent to research use**, your **email address,
  name and university are additionally written to a participant roster** that
  only the facilitator who created the session can read and export. Anonymous
  participants have no email and nothing is written.

**If you download a certificate of attendance**

- A verification record (see section 6)

**Are you obliged to provide this?** No — participation is [STATE: voluntary /
part of the assessed curriculum]. If you prefer not to give a name or an
affiliation, [STATE WHAT YOU OFFER — e.g. "use a pseudonym agreed with the
facilitator", or "tell the facilitator and we will arrange an offline
alternative"]. If you do not provide [MINIMUM FIELDS], the consequence is
[CONSEQUENCE].

---

## 3. Why we use it, and on what legal basis

<sub>GDPR Art. 13(1)(c)–(d); APPI Arts. 17, 18, 19, 21</sub>

Under GDPR we need a **legal basis** for each purpose. Under Japan's APPI the
equivalent obligation is different: we must **specify the purpose of use as
concretely as possible** (Art. 17) and make it known to you at or before
collection (Art. 21). Both are set out below.

| Purpose | What it means | GDPR legal basis | APPI purpose of use (利用目的) |
|---|---|---|---|
| **Running the session** | Putting you in a room, showing your name and contributions to your group, scoring the team exercise | [Art. 6(1)(e) public task (university teaching) **or** Art. 6(1)(f) legitimate interests. **Consent (Art. 6(1)(a)) is not available** where participation is timetabled or where the facilitator assesses you — see the note below. Art. 6(1)(b) does not apply: there is no contract with you for the teaching activity.] | To deliver the problem-based learning session named above and give you and your group feedback during it |
| **Facilitator debrief** | At the end, the facilitator downloads a copy of every group's work for the debrief and for teaching feedback | [Usually the same as above] | To debrief the session and improve teaching |
| **[Assessment — DELETE IF NOT APPLICABLE]** | [Whether any of this counts towards a grade] | [LEGAL BASIS] | [To assess your performance on [COURSE]] |
| **[Education research — DELETE IF NOT APPLICABLE]** | Analysing the session for the study "[STUDY NAME]" and publishing aggregated findings | [See the important note below before choosing] | To conduct and publish the education-research study named above |
| **Certificate verification** | Letting someone you show a certificate to confirm it is genuine (section 6) | [Art. 6(1)(f) legitimate interests. **The interest is:** so that a certificate you show to an employer or another university can be trusted. Confirm your institution accepts this after a balancing test, and record it — the record is readable by anyone holding the code (section 6). **For participants in Japan, legitimate interests do not exist as a basis**: see the note below.] | [To allow a third party to confirm a certificate is genuine] |
| **Security and abuse prevention** | reCAPTCHA, access rules, technical logs | [Art. 6(1)(f) legitimate interests. **The interest is:** to stop automated abuse of a free-tier service and keep the session available to the class.] | To protect the service against unauthorised or abusive access |

**We will not use your data for any purpose beyond those listed without asking
you first** (APPI Art. 18), and we will not use it in a way that could encourage
or induce unlawful or unjust acts (APPI Art. 19).

> **Ticking the box on the join form.** The software will not let you into the
> session unless you tick it. That means it cannot be a free choice, and it is
> **not** how we justify running the session — see the basis in the table.
> Ticking records that you have been shown this information. The **research**
> box, where offered, is a genuine choice: see the note below and section 10.

**[Research — read before you choose a basis.]** [STATE WHICH APPLIES:
(a) research use is genuinely optional and consent-based — **only tick this if
your institution has confirmed the research export actually excludes
non-consenting participants** (see blocking precondition B2); or (b) research
runs on Art. 6(1)(e) with Art. 89(1) safeguards, in which case you have a
**right to object** rather than a consent to withhold — see the box in section
9a.]

**Sensitive ("special category") information.** The scenario for this session
covers **[SCENARIO TOPIC(S) — e.g. opioid prescribing; breaking bad news;
end-of-life disclosure]**. Discussing it, you may write things that reveal
health information, or your religious, philosophical or political views — about
a fictional patient, but sometimes about yourself. **Anything you write of that
kind is visible to every other participant in the session** (section 4), is sent
abroad if you write it in the AI chat (section 5), and is held in an identified
backup. Where such data is processed we rely on **[SPECIAL-CATEGORY BASIS —
name the exception and, for Art. 9(2)(j), the specific Union or Member State
law and the Art. 89(1) safeguards. **Art. 9(2)(a) explicit consent is not
available** where the facilitator assesses you.]** **You are never required to
share anything personal about yourself.**

**In Japan**, the equivalent category is 要配慮個人情報 (APPI Art. 2(3)) — race,
creed (religious *and* political belief), social status, medical history,
criminal record, the fact of having been harmed by a crime, and physical or
mental disability. It is **narrower than GDPR Art. 9 in some respects** (it does
not cover sexual orientation, sex life, or trade-union membership) and broader
in others. The rule is about **acquisition**: your prior consent must be
obtained **before** you are asked to type into a box where such information is
foreseeable (Art. 20(2)) — not afterwards. Such data must never be routed into
the certificate registry or the AI chat.

**[Ethics approval — DELETE IF NO RESEARCH]** This study was reviewed and
approved by **[ETHICS COMMITTEE NAME]**, approval number **[NUMBER]**, dated
**[DATE]**.

---

## 4. Who can see your data

<sub>GDPR Art. 13(1)(e)</sub>

**Other participants.** Everyone who is signed in to your session can read the
**whole session**, not just your own room: names, universities, free-text
answers, votes, the poll, the knowledge-check scores and the wrap-up
questionnaire answers. The platform's database grants read access at the level
of the whole session, and that access cannot be taken away again for a part of
it. This is deliberate for facilitators and observers — but **it means nothing
you write in the shared session record is private from your classmates.**

**Your conversation with the AI patient is the exception.** Since 2026-07-24 the
AI-chat transcript is stored outside the session record, and only the members of
**your own room** — plus the facilitator, who needs it for the debrief — can read
it. Students in other rooms cannot.
*(Updated 2026-07-24, PR #235. Before that date the chat sat inside the session
record and **every** session member could read every room's transcript, despite a
rule that appeared to restrict it to the room. If you ran sessions before that
date, tell those participants the truth about them: their AI-chat transcripts
were readable by every member of their session.)*

**Your facilitator and our staff.** [WHO INSIDE YOUR INSTITUTION CAN SEE THE
DATA — e.g. "the facilitator, the course director, and the named research team
listed at [URL]"]. The facilitator can download an archive of the session, and —
if you signed in and consented to research — export a list of participant names,
universities and **email addresses**.

**Companies that process data for us.** Some of the companies we use themselves
rely on further companies; those are listed too. Everything is in **Appendix A**.
In summary: Google (hosting, database, sign-in, serverless functions, backups,
the reCAPTCHA security check, and the software libraries loaded by your
browser), **Hugging Face and the inference providers it routes to** (the AI
character chat), GitHub (runs our automated deletion, backup and export jobs),
and [SMTP PROVIDER — only if you enable session emails; the email feature is
switched **off** by default].

**Anyone who is given your certificate**, to the limited extent described in
section 6.

**Records of sharing.** Where we give your data to someone who is not simply
processing it on our behalf — publishing a certificate record, exporting a
roster outside our institution, or sharing the research file with a partner
university — we keep a record of that transfer, and you can ask to see it (APPI
Arts. 29, 30 and 33(5)). Those records are held by [WHO HOLDS THEM] at
[WHERE].

We do **not** sell your data, and there is no advertising or third-party
analytics on the platform.

---

## 5. The AI character chat — read this before you type

Part of the session is a free-text conversation with a **simulated character**
(for example a patient or a relative) played by a **large language model**. It
is not a real person, and it is not a doctor. Its answers can be wrong; treat
them as a teaching prop, never as clinical information.

**Where your words go, exactly:**

1. You type a message (up to **500 characters**). It is saved in the session
   database. **Every signed-in member of the session can read the transcript** —
   not only your own room.
2. Your message — together with the hidden scenario instructions and **at most
   15 recent turns of the conversation, capped at about 12,000 characters
   in total** — is sent to a server function operated for us by Google. **That
   particular function runs in the United States**, so your text leaves Europe
   at this point.
3. From there it is sent to **Hugging Face**, which routes it onward to a
   third-party inference provider. **Which provider handles any given message
   varies from request to request, and we are not told in advance** — the
   platform only learns which one answered *after* the reply comes back.
   [TO VERIFY before publishing — the set of providers Hugging Face may route
   to, the countries in which they process data, how long they keep what you
   typed, whether they use it for training, and the transfer safeguard relied
   on. Get this in writing from the platform operator and from Hugging Face. If
   it cannot be obtained, the AI chat must be switched off for this session
   (blocking precondition B5). **Until it is answered we do not know how long
   the AI provider keeps your text.**]
4. The reply comes back and is saved next to your message.

**The model.** An open-weights language model run by a third party. The specific
model in use on the date of your session is named in Appendix A — it is set by
configuration and can be changed by the operator without any change to this
notice, so it must be confirmed with the operator each time.

**What we ask of you:**

> **Do not type real names, contact details, real patient information, or
> anything personal about yourself or another person into the chat.** Write only
> what you would say in a real consultation with the fictional character. The
> same applies to every other free-text box in the session (section 5a).

**If you slip.** Tell your facilitator, or write to [CONTROLLER CONTACT EMAIL]
or [INDEPENDENT CONTACT]. **We can delete that turn from the session record. We
cannot recall it from the AI provider.** Your facilitator will say this out loud
before the chat starts.

**Be aware:** the transcript is stored like the rest of the session, is readable
by the whole session, and is included in the identified backup. It is removed
from the pseudonymised research dataset — but that is *after the fact*, and the
other free-text boxes are **not** removed (section 5a). The safest control is
not typing personal information in the first place.

**A technical log we also keep about the chat** (not the content of your
messages): your account identifier, the time, the language, the number of
messages sent, the length of the reply, how long the reply took, the technical
status of the request, which provider answered, token counts, how many attempts
were made, the prompt version, and the session code. Alongside it the platform
keeps counters of how much you and your session have used the chat, also keyed
to your account. All of it is used to monitor cost and abuse.
[TO VERIFY — none of this currently has automated deletion; agree a retention
period with the platform operator and state it in Appendix B.]

**If you would rather not use the AI chat at all**, tell your facilitator:
[STATE YOUR ALTERNATIVE — e.g. "we will run the legacy click-through version of
the history-taking exercise for the whole room".]

---

## 5a. The other free-text boxes, and other people's information

**Every free-text box in the session carries the same risk as the chat**, and
some carry it for longer. Your answers, hypotheses, prompt replies, the poll's
"what was hardest?" box and the five wrap-up questionnaire boxes are all read by
the whole session **and** are carried into the research dataset. The
de-identification applied to that dataset replaces a name only where it is the
*entire* content of a name field — so **a classmate's name written in the middle
of a sentence survives**. Please do not write names, contact details, or real
clinical details in any of them.

**If you write about someone else.** If information about a real third person —
a patient, a relative, a colleague — ends up in the session, that person has
rights too, even though we never collected anything from them directly (GDPR
Art. 14). What we do: [STATE YOUR PROCESS — e.g. "we remove it from the session
record on request from you or from them; we exclude it from the research
dataset; the reporting route is [CONTACT]"]. We publish this notice so that the
information required by Art. 14 is available to them, because contacting each
such person individually would involve disproportionate effort
(Art. 14(5)(b)) — [CONFIRM YOUR DPO HAS DOCUMENTED THAT ASSESSMENT].

---

## 6. Your certificate and the name "hash"

If you download a certificate of attendance, a record is created so that someone
you show it to (an employer, a university, or you) can check it is real.
**A record is created every time a certificate is generated — there is no
tick-box for this.** If you do not want a record created, **do not download a
certificate**, or ask us to remove it (below).

**What is stored:** a verification code, a **one-way scrambled version (a
"hash") of your name combined with the session code**, the session label in
readable form, the date, and a retention date about **five years** out. Your
name is not stored in readable form, and neither are your answers, your email,
or anything else.

**How checking works:** the person holding your certificate goes to a public
verification page and types in **both** the code printed on the certificate
**and** the name printed on it. The page answers "valid" or "no match". It never
displays your name, and the registry cannot be listed or browsed — you have to
already know a specific code to look anything up.

**Two honest caveats.**

1. **Anyone in the world who has your certificate code can read that record
   without logging in.** No account is needed.
2. **The scrambling is weak.** It is a single fast hash with no secret
   ingredient added ("unsalted"), applied to a **first name** plus the session
   code — and the session code is stored **in readable form in the same
   record**. So someone who has your certificate code could recover a common
   first name from it within seconds by trying candidate names. This is a check
   for authenticity, not a privacy protection, and you should not treat it as
   one.

**Removal:** email [CONTROLLER CONTACT EMAIL] or [INDEPENDENT CONTACT] with your
verification code. We will ask the platform operator to remove the entry and
confirm to you within [RESPONSE TIME — e.g. 5 working days]. Your printed
certificate still exists; the public page simply stops confirming it.
[TO VERIFY — deletion of a certificate record **cannot be done by us or by any
user of the app**: the database refuses it, and the in-app control merely opens
the platform operator's cloud console for a human there to delete the node.
There is also **no automated job** that clears records when their retention date
passes. Agree with the operator who performs both, and how quickly.]

**In Japan**, publishing a per-person record to a page that anyone with the code
can read is a provision of personal data to a third party, for which APPI
requires your **consent** (Art. 27(1)) — there is no "legitimate interests"
route under Japanese law, and the opt-out route in Art. 27(2) is not available
for sensitive information. [FOR JAPANESE PARTICIPANTS: obtain a separate opt-in
before a certificate is downloaded, or instruct participants not to download
one.]

---

## 7. Where your data goes

<sub>GDPR Art. 13(1)(f), Arts. 44–46; APPI Art. 28 and the PPC Enforcement
Rules</sub>

| What | Where it goes | Why it leaves | Safeguard we rely on |
|---|---|---|---|
| The main database, the email function, and the private archive bucket | **Belgium** (Google, `europe-west1`) | Hosting | Stays in the EEA |
| **The AI-character chat function** | **United States** (Google, `us-central1`) | That function is only deployed there | [TRANSFER MECHANISM — see the note below] |
| **The AI chat text, onward from Hugging Face** | **Not identifiable in advance** — Hugging Face routes each request to one of several inference providers, and the platform only learns which one after the reply | The AI character | [TRANSFER MECHANISM — **and see blocking precondition B5: if this cannot be pinned to a named provider and country with an agreement in force, the AI chat must be switched off**] |
| The automated deletion, backup and research-export jobs — **including the full identified copy of the session and the file linking pseudonyms back to real names**, which are written to the machine running the job before being stored in Belgium | **GitHub-hosted runners** (United States infrastructure) [TO VERIFY the runner region with the operator] | Automation | [TRANSFER MECHANISM] |
| Your IP address and browser details, on every page load | Google (`gstatic.com` software libraries, reCAPTCHA security check, and `apis.google.com` if you sign in with Google) | The platform's own software and its bot protection | [TRANSFER MECHANISM] |
| Your Google account processing, if you sign in with Google | Google | Sign-in | Google's own terms |

**Transfer safeguards — fill one line per row above, do not use one mechanism
for all of them.** For each transfer outside the EEA we rely on
**[TRANSFER MECHANISM — for each row: the EU–US Data Privacy Framework adequacy
decision **only if** that specific importer is certified under it for this
category of data; otherwise the European Commission's Standard Contractual
Clauses plus a transfer impact assessment]**. A copy can be requested from
[CONTROLLER CONTACT EMAIL].
[TO VERIFY before the session — (a) which of the importers above are DPF-listed;
(b) that the Google/Firebase data-processing terms and SCCs are accepted for the
Firebase project used for your session; (c) that a processing agreement covering
Hugging Face is in place. Note that the adequacy of any US transfer route is
contested and may change — check its current status on the date you publish.]

**For participants in Japan.** Japanese law treats this separately and more
strictly than you may expect:

- Sending data **from Japan to the EEA** is permitted because the Personal
  Information Protection Commission has **designated the EEA and the UK** as
  countries with an equivalent standard (APPI Art. 28(1)). (The EU's own
  adequacy decision for Japan runs the other way and does not provide this.)
- Sending data **from Japan to the United States** needs one of only three
  routes: your **prior consent to a foreign provision**, a PPC-designated
  country (the US is not one), or a recipient with an equivalent system plus our
  own continuing duties to check on them. **There is no "legitimate interests"
  route and no self-service equivalent of the SCCs.**
- **Entrusting the work to a processor does not exempt this.** A processor
  located abroad is still a third party in a foreign country for these purposes.
- If we rely on **consent**, we must tell you *before* you consent: the country,
  information about that country's data-protection system, and the recipient's
  protective measures. **Where the country genuinely cannot be identified** —
  which is the case for the AI chat — the rules instead require us to tell you
  that fact, the reason for it, and whatever information about protective
  measures is available. That consent must be a **separate** choice from
  agreeing to take part in the workshop.
  [JAPAN TRANSFER BASIS — state which route you use, and confirm the article
  and rule numbering with Japanese counsel.]
- **If a Japanese partner institution handles data about participants based in
  the EU**, the PPC's Supplementary Rules for EU-origin personal data apply.
  Among other things they treat data on sex life, sexual orientation and
  trade-union membership as sensitive even though APPI does not, require the
  source to be recorded, and **restrict onward transfer out of Japan more
  tightly** than the general rules above. [TO VERIFY — that the Japanese partner
  has acknowledged these in writing.]

---

## 8. How long we keep it

<sub>GDPR Art. 13(2)(a); APPI Art. 22</sub>

**Live session data is automatically deleted [RETENTION — SESSION DATA].** The
platform's built-in job deletes a session 30 days after it is closed, or 90 days
after creation if it is never closed.

**Three things are not deleted automatically at all:**

- **your email address in the participant roster** — only written if you signed
  in *and* consented to research;
- **your certificate verification record**;
- **the technical usage log and counters for the AI chat**.

We delete these by hand: **[WHO]** does it, on **[WHAT TRIGGER]**, and the
periods we have set are in Appendix B. If you want any of them removed sooner,
email [CONTROLLER CONTACT EMAIL] or [INDEPENDENT CONTACT].

Everything else is in **Appendix B**, item by item.

---

## 9. Your rights

<sub>GDPR Art. 13(2)(b), Arts. 15–22; APPI Arts. 32–35, 38</sub>

**If GDPR applies to you** (you are in the EU/EEA, or [CONTROLLER LEGAL NAME] is
established there), you can ask us to:

- **give you a copy** of your data (access);
- **correct** anything wrong (rectification);
- **delete** your data (erasure);
- **restrict** how we use it;
- **object** to how we use it (see the box below);
- **give you a portable copy** (portability), where that applies;
- **withdraw a consent** you gave, at any time — this does not undo processing
  we already did lawfully before you withdrew.

We will acknowledge within [ACKNOWLEDGEMENT TIME] and answer within **one
month** (Art. 12(3)).

**If APPI applies to you** (you are in Japan, or your data is handled by a
Japanese institution), your rights are different in both directions. You can ask
us to:

- **disclose** the data we hold about you (Art. 33) — and you may ask to receive
  it **in electronic form**;
- **disclose the records we keep of any sharing of your data** with a third
  party (Art. 33(5) with Arts. 29–30);
- **correct, add to, or delete** data that is factually wrong (Art. 34);
- **stop using it, erase it, or stop providing it to third parties** (Art. 35) —
  including where it is no longer needed, where a breach has occurred, or where
  there is a risk to your rights or legitimate interests. **This is the right to
  use if you want us to stop publishing your certificate record or stop sending
  your text to the AI provider.**

APPI has **no data-portability right and no general right to object**, and there
is no one-month deadline — we must answer **without delay (遅滞なく)**. There is
also no exemption for short-lived data: everything we hold is covered, including
data that will be deleted in 30 days.
[DISCLOSURE FEE — state the amount charged for a disclosure or purpose-
notification request under APPI Art. 38, or state "no fee".]

**How:** email **[CONTROLLER CONTACT EMAIL]** or **[INDEPENDENT CONTACT]**.

**Exercising a right will never affect your marks, your standing, or your place
in the workshop.**

Three practical points, stated plainly:

- Some of what you write becomes part of a **group** record (a shared answer, a
  team decision). Removing your contribution may not be possible without
  destroying another student's work; where that happens we will tell you what we
  can and cannot do.
- Some technical logs are not visible through the platform's own screens, and
  **some deletions can only be carried out by the platform operator, not by us**
  — the app does not allow us to delete a closed session's contents or a
  certificate record. A request to [CONTROLLER CONTACT EMAIL] is the reliable
  route, and we will pass it to the operator and confirm back to you.
- **There is a deadline after which we can no longer find your rows in the
  research dataset** — see section 10.

### 9a. Your right to object

> **You have the right to object at any time to our use of your data where we
> rely on public task or legitimate interests — including the education-research
> analysis, if that is the basis we have chosen in section 3, and the
> certificate verification registry.** Objecting to the registry means the entry
> is removed. To object, email **[CONTROLLER CONTACT EMAIL]** or **[INDEPENDENT
> CONTACT]**; you do not have to give a reason for research. We will stop unless
> we can show compelling legitimate grounds that override your interests.
> *(GDPR Art. 21; Art. 21(6) for research. This right does not exist in the same
> form under APPI — see the Art. 35 right above instead.)*

---

## 10. Withdrawing your consent to research use, and its limits

If you ticked the research box on the join form and change your mind, email
[CONTROLLER CONTACT EMAIL] or [INDEPENDENT CONTACT]. Here is exactly what we can
and cannot do:

- **If you tell us within [N] days** of the session, we can locate your
  contributions in the research dataset and remove them. The file that links
  research pseudonyms back to real names is deleted after a short period
  [TO VERIFY the exact lifetime with the platform operator — **it is what sets
  the deadline you publish here**], and once it is gone **the dataset no longer
  contains anything that links your rows to you, so we can no longer find
  them.** We will confirm that position to you in writing, but we cannot remove
  them.
- **The identified backup** that contains your session expires
  [RETENTION — BACKUP] after it is written; we cannot selectively edit it, but
  it is deleted on that schedule.
- **Contributions already shown to your group** during the live session cannot
  be un-seen.
- **Pressing "Leave" exits the workshop but does not by itself delete
  anything** — ask us if you want deletion too.

[IF YOUR INSTITUTION HAS CONFIRMED THE RESEARCH EXPORT EXCLUDES NON-CONSENTING
PARTICIPANTS, KEEP THIS SECTION AS A CONSENT-WITHDRAWAL SECTION. IF NOT — see
blocking precondition B2 — REPLACE IT WITH THE RIGHT TO OBJECT IN SECTION 9a AND
DO NOT DESCRIBE RESEARCH AS CONSENT-BASED ANYWHERE.]

---

## 11. Complaints

<sub>GDPR Art. 13(2)(d)</sub>

Please come to us first — [CONTROLLER CONTACT EMAIL] or [INDEPENDENT CONTACT] —
but you always have the right to complain to a supervisory authority:

- **[SUPERVISORY AUTHORITY NAME]**, [ADDRESS / URL] — the authority for
  [COUNTRY].
- You may also complain to the authority where you live or work.
- **In Japan:** the Personal Information Protection Commission (個人情報保護
  委員会), www.ppc.go.jp. [ALSO NAME ANY 認定個人情報保護団体 your institution
  belongs to, or state that it belongs to none.]

---

## 12. Automated decisions and profiling

<sub>GDPR Arts. 13(2)(f), 22</sub>

The platform awards points automatically for team answers and clinical choices.
This is **teaching feedback inside the session only**. It does not profile you,
does not feed any grade unless we say otherwise in section 3, and produces no
legal or similarly significant effect. [IF ANY SCORE COUNTS TOWARDS A GRADE, SAY
SO EXPLICITLY HERE — and describe how a human reviews it.]

The AI character generates its replies automatically; it does not make any
decision about you.

---

## 13. How we protect it, and what happens if something goes wrong

**Security measures**

- Encrypted connections (HTTPS).
- Database access rules that limit reading to members of your session. **They do
  not separate one room from another** — see section 4.
- Facilitator passwords are stored using a slow, iterated hashing function
  (PBKDF2, 100,000 iterations). [TO VERIFY / DISCLOSE HONESTLY — the value mixed
  into the hash is the session code, which is not secret, rather than a random
  per-password value; and an older, weaker hash format is still accepted by the
  database rules. Ask the operator whether this has been changed before
  repeating any stronger claim.]
- Automated deletion jobs; identified backups written to a **private** cloud
  bucket with automatic expiry [TO VERIFY that the bucket and its expiry rules
  are actually provisioned for your project — ask the operator for evidence].
- A bot-protection signal (Google reCAPTCHA / Firebase App Check) is collected
  on each page load. [TO VERIFY — at the time of writing the platform's
  documentation records this as being in **monitoring** mode on both the
  database and the AI-chat function, meaning it observes but does not block.
  Confirm the live setting with the operator before describing it as a control.]
- The automation account used by the deletion, backup and export jobs can read
  and delete the entire database.

**Where your data is handled, for the APPI Art. 32 disclosure.** Your data is
handled in **Belgium** (the database, the email function and the archive
bucket), in the **United States** (the AI-chat function; the automation runners;
Google's reCAPTCHA and software-library servers), and — for the AI chat only —
in **a country we cannot identify in advance** (see section 7). [ADD A ONE-LINE
OUTLINE OF EACH COUNTRY'S DATA-PROTECTION REGIME — required by the PPC's
guidance on 外的環境の把握. See Appendix E.]

**If a personal-data breach occurs**

- **Under GDPR:** we will notify [SUPERVISORY AUTHORITY] within 72 hours where
  required (Art. 33) and tell you directly where the risk to you is high
  (Art. 34).
- **Under APPI (Art. 26):** reporting to the PPC is required for leaks involving
  sensitive information (要配慮個人情報), data whose leak risks financial damage,
  leaks caused by a wrongful purpose or unauthorised access, or leaks affecting
  1,000 or more people. A **preliminary report (速報)** is due promptly and a
  **final report (確報)** within **30 days** — extended to **60 days** for the
  wrongful-purpose category. We must also **notify you directly (本人通知)**.
  Because the platform operator runs the system, our processor agreement
  requires them to tell us without delay so that these deadlines can be met.
  [TO VERIFY that clause is in your signed agreement.]

---

## 14. What is stored on your own device, and what your browser contacts

**Stored on your device**

- **Kept until you close the tab:** a random per-tab identifier, and a local
  error-log buffer that never leaves your device.
- **Kept until you sign out or clear your browser storage:** the longer-lived
  browser identifier described in section 2, which links your poll,
  knowledge-check and wrap-up answers together across tabs and across sessions.
- **Kept until you clear your browser storage:** the session code, resume
  details, your display name, sound / theme / language preferences, and a flag
  recording that you acknowledged the AI-chat notice.

**Contacted by your browser**

- **No advertising cookies and no analytics trackers.** But the platform's core
  software libraries are downloaded from **Google (`gstatic.com`)** on every
  page load, **Google reCAPTCHA** runs as a security check on every page load
  and receives your IP address and browser signals, and **`apis.google.com`** is
  contacted if you sign in with Google. All three happen before you interact
  with anything.
  [TO VERIFY — whether reCAPTCHA stores anything on your device in our
  configuration, and the consent position for it under the ePrivacy rules. See
  section 2.]

You can clear the stored items from your browser settings at any time.

---

## 15. Age

This session is intended for participants aged **[MINIMUM AGE]** and over. If
you are younger, speak to the facilitator before joining so we can handle
consent correctly (GDPR Art. 8 and [NATIONAL AGE RULE — note that Japan sets no
statutory consent age; PPC guidance generally expects a guardian's involvement
for roughly under-15s, and the age of majority in Japan has been **18** since
April 2022]).

---

## 16. Changes to this notice

This is version **[NOTICE VERSION]**, dated **[NOTICE DATE]**. **This is the
version referred to by the tick-box you were shown on the join screen.** If we
make a material change we will issue a new version and ask you to read it again
before your next session. Previous versions are available from [CONTROLLER
CONTACT EMAIL].

**Language:** this notice is published in [LANGUAGES PUBLISHED]. If the versions
differ, the **[GOVERNING LANGUAGE]** version governs. [GOVERNING LAW / VENUE —
add only if your institution requires it.]

---
---

# Appendix A — Who processes data for us

| Who | What they receive | Where | Role |
|---|---|---|---|
| **Google (Firebase)** — Hosting, Realtime Database, Authentication, Cloud Functions, Cloud Storage | Everything in section 2 | Database, email function and storage in **Belgium**; **the AI-chat function in the United States** | Our processor (via [PLATFORM OPERATOR LEGAL NAME]) |
| **Google (software libraries)** — the platform's core JavaScript is downloaded from `gstatic.com` on every page load | Your IP address and browser details | [TO VERIFY — served from a global network, not region-pinned] | Content delivery |
| **Google reCAPTCHA / App Check** | Your IP address and browser signals, on every page load | [TO VERIFY — not region-pinned] | Anti-abuse |
| **Google Sign-In (`apis.google.com`)** | Contacted only if you sign in with a Google account | [TO VERIFY] | Authentication |
| **Hugging Face — Inference Providers** | Only the AI-character chat: the hidden scenario instructions plus at most 15 recent turns / about 12,000 characters of what participants typed | **Routes onward to a third-party provider that varies per request and is not known in advance** — [TO VERIFY which providers may be used, and in which countries. The platform's source code mentions some provider names only in a passing comment that ends "etc."; that is not a definitive or exhaustive list and must not be published as one.] | Sub-processor for the AI character |
| **GitHub / GitHub Actions** | Runs the automated deletion, backup, export and cost-monitor jobs with an account that can read and delete the whole database. **The full identified copy of the session and the pseudonym-to-name linkage file are written on the job machine** before being stored in Belgium | United States infrastructure [TO VERIFY the runner region] | Automation |
| **Google Cloud Storage (private archive bucket)** | Nightly identified backup of session data; pseudonymised research export; a short-lived re-identification key file | Belgium, private bucket, public access blocked. [TO VERIFY that the bucket and its expiry rules are actually provisioned for your project — the expiry rules are applied by hand and nothing in the software proves they are live] | Backup / research pipeline |
| **[SMTP PROVIDER]** | Recipient address, subject and body of any session email | [LOCATION] | **Disabled by default.** Only applies if you switch session email on — name the provider before you do |

**The AI model in use on the date of your session:**
[MODEL NAME(S) — TO VERIFY with the operator on the day. The model is set by
configuration, not by the software itself, and can be changed without any
change to this notice or to the platform's code.]

No advertising networks, no third-party analytics. Fonts and PDF libraries are
served from the platform itself, not from an outside network.

*(Where this table names a technical region — Belgium, the United States — the
underlying platform identifiers are `europe-west1` and `us-central1`.)*

---

# Appendix B — Retention, item by item

| Data | What the platform does today | Our retention period |
|---|---|---|
| Live session data — names, answers, hypotheses, votes, poll, knowledge check, wrap-up questionnaire, **AI chat transcripts**, presence | Automatically deleted **30 days after the session is closed**, or **90 days after creation** if never closed | [RETENTION — SESSION DATA] |
| Facilitator's downloaded archive (on the facilitator's own computer) | Not controlled by the platform | [RETENTION — ARCHIVE] · stored at [ARCHIVE STORAGE LOCATION] |
| Identified nightly backup | Private cloud bucket, expires after **90 days** [TO VERIFY the expiry rule is live on the bucket] | [RETENTION — BACKUP] |
| Pseudonymised research dataset | Display names replaced with "Student-A/B/…", universities grouped, **AI-chat transcripts dropped entirely**. **Other free text is kept as written** and a name is only replaced where it is the whole content of a name field — so a name written mid-sentence survives. **Account and device identifiers are kept**, so the file can be linked back to a person by anyone who also holds the roster or the identified backup, without the linkage file. File expires after **90 days** [TO VERIFY] | [RETENTION — RESEARCH DATASET] |
| Re-identification key linking pseudonyms to names | Expires after **14 days** [TO VERIFY — this figure sets the withdrawal deadline in section 10] | [RETENTION — LINKAGE FILE] |
| **Participant email roster** (only for signed-in participants who consented to research) | ⚠️ **No automated deletion — kept indefinitely** unless someone removes it by hand | [RETENTION — EMAIL ROSTER] · deleted by [WHO], on [WHAT TRIGGER] |
| **Certificate verification records** | Each carries a retention date about **5 years** out, but ⚠️ **no job deletes them**, and no user of the app can delete one — only the platform operator can | [CERTIFICATE RETENTION] · cleared by [WHO], on [WHAT TRIGGER] |
| **AI-chat usage log and usage counters** (account id, time, language, message counts, reply length, response time, technical status, provider, token counts, attempts, prompt version, session code) | ⚠️ **No automated deletion; not visible in the app** | [RETENTION — USAGE LOG] · agreed with the platform operator as [PERIOD] |
| Account profile and session history (only if you create an account) | Kept until you delete it | Until you ask us to delete it |
| Facilitator-authored scenarios and any shared scenario | Kept until the author deletes them; shared scenarios are readable by any signed-in user of the platform, including the author's display name | [RETENTION — SCENARIOS] |

**[APPI CATEGORY OF THE RESEARCH EXPORT — state which one you claim.]** It is
**not** anonymously processed information (匿名加工情報): free text survives and a
linkage file exists. If your institution claims it is **pseudonymously processed
information (仮名加工情報)**, note the consequences: it must meet the statutory
processing standards, the deletion information must be kept under safe-management
measures, it **may not be provided to a third party at all** except through
entrustment, joint use or business succession — so sharing it with a partner
university needs the structure in Appendix D — and the disclosure, correction and
cessation rights in section 9 **cease to apply to it**, which contradicts what
section 10 promises. Resolve this with counsel before publishing.

---
---

# Appendix C — Fill-in checklist (facilitator only — DELETE before publishing)

Do not publish until every line is done.

**Before the first session — these are preconditions, not paperwork**

- [ ] **DPIA completed and signed off** (GDPR Art. 35(1) — required *before* the
      processing begins), and Art. 36 prior consultation considered if residual
      risk is high
- [ ] **Record of processing activities (Art. 30)** updated for this session
- [ ] **Written processor agreement (GDPR Art. 28) signed** with the platform
      operator — including a duty to notify us of a breach without delay so the
      APPI Art. 26 preliminary-report clock can be met
- [ ] **APPI Art. 25 supervision of the entrustee** arranged and documented
- [ ] All nine **blocking preconditions (B1–B9)** at the top of this file
      resolved, in writing where they involve the operator
- [ ] Manual retention tasks assigned to a **named person**, with a **calendar
      trigger**, and **one successful run evidenced**: email roster, certificate
      records, AI-chat usage log and counters
- [ ] Operator's manual-deletion turnaround recorded, so the response times
      promised in sections 6 and 9 are achievable
- [ ] Art. 14(5)(b) assessment documented for third-party data in free text
- [ ] Decision recorded on whether the operator is a joint controller for the
      elements it determines deployment-wide (section 1)
- [ ] APPI category of the research export decided (Appendix B)

**Document hygiene**

- [ ] Removed the "UNREVIEWED DRAFT" box, the blocking-preconditions block, the
      facilitator-instructions section, this Appendix C, and the "Open
      questions" section
- [ ] Every `[BRACKET]` replaced
- [ ] Every `[TO VERIFY]` checked against the live system, then resolved or the
      claim deleted
- [ ] Appendix D completed or deleted; Appendix E completed
- [ ] Reviewed by [COUNSEL / DPO NAME] on [DATE]
- [ ] Ethics approval obtained, if any research purpose is claimed
- [ ] Published in every language you teach in, with the governing language
      stated; Japanese consent wording supplied separately (instruction 7)
- [ ] Participants can read it **before** they tick the consent box, and the
      join screen names *this* notice and *this* version

---

# Appendix D — Joint use with a partner institution (APPI Art. 27(5)(iii))

*Complete this only if your institution shares participants' data with a partner
university as **joint users** rather than as processor/entrustee. If it does not
apply, delete this appendix and say so in section 1. If it does apply, all five
items below must be published or made readily accessible **before** the joint
use begins.*

1. **The fact of joint use:** [STATE IT].
2. **The items of personal data jointly used:** [LIST — e.g. display name,
   university, year of study, session contributions].
3. **The scope of joint users:** [NAME EACH INSTITUTION].
4. **The purpose of use by each user:** [STATE PER INSTITUTION].
5. **The party responsible for management, with its name, address and
   representative's name:** [NAME, ADDRESS, REPRESENTATIVE].

Joint use does **not** exempt a transfer to a foreign country — see section 7.

---

# Appendix E — Public disclosure required by APPI Art. 32

*Complete this if APPI applies. These items must be in a state where the
individual can readily know them.*

- **Name, address and representative's name of the business operator:**
  [see section 1].
- **All purposes of use of retained personal data:** [see section 3].
- **How to make a request** for notification of purpose, disclosure,
  correction or cessation of use, **and any fee:** [see section 9].
- **Complaints contact:** [see sections 1 and 11].
- **Any certified personal-information protection organisation
  (認定個人情報保護団体) we belong to:** [NAME, or "none"].
- **Security control measures taken**, including the **names of the foreign
  countries in which the data is handled** and an outline of each country's
  data-protection regime: [see section 13 — Belgium; the United States; and, for
  the AI chat only, a country that cannot be identified in advance, for the
  reason given in section 7].

---
---

# Open questions and drafting notes (facilitator/reviewer only — DELETE before publishing)

These record where this draft **departs from, or does not fully adopt, a
reviewer's criticism**, so that counsel can re-open the point rather than assume
it was overlooked.

1. **"There is no adequacy decision for the United States" — not adopted as a
   flat statement.** One reviewer asked for that sentence in section 7. It is
   too absolute: an EU–US adequacy decision exists for organisations certified
   under the **Data Privacy Framework**, so the correct question is whether each
   named importer (Google, Hugging Face, the routed provider, GitHub) is
   DPF-certified *for this category of data*. Section 7 therefore asks that
   question per row instead of asserting the negative, and flags that the route
   is contested and may change. **Counsel should decide, on the publication
   date, which importers can rely on it.**

2. **The certificate hash.** The plain-language reviewer is right that the old
   wording read as reassurance, and section 6 has been rewritten to say the
   scrambling is weak and a common first name is recoverable in seconds. One
   qualification kept: the attacker must already hold a specific certificate
   code, and the registry cannot be listed or browsed, so this is not a
   mass-deanonymisation route. That is a mitigation of scale, not of principle,
   and it is not offered to the participant as reassurance. **Recommend to the
   operator: salt the hash, or move verification behind a server-side check.**

3. **"Move the article citations out of the headings" — partly adopted.** The
   citations now sit in a small line under each heading rather than in it, so
   the participant reads a plain heading and the DPO can still audit coverage.
   Deleting them entirely would make the notice unauditable.

4. **APPI article and rule numbering.** The Japanese-law statements in sections
   1, 3, 6, 7, 9 and 13 follow the APPI as amended in 2020/2021 and the PPC
   Enforcement Rules. Numbering has changed across amendments and this draft was
   not checked against the current official text by a qualified Japanese
   practitioner. **Every Japanese article and rule number must be confirmed by
   Japanese counsel before publication.** In particular the rule permitting
   consent where the destination country cannot be identified (section 7) is
   stated by its effect, not by its number, for that reason.

5. **The pseudonymised export.** The reviewers disagreed about how much survives
   it. The verified position, stated in Appendix B, is: AI-chat transcripts are
   dropped; display names in name fields are replaced; universities are grouped;
   **all other free text survives verbatim**; and **account and device
   identifiers survive**, so the file is linkable without the linkage key. No
   claim is made here about whether that meets GDPR Art. 4(5) — that is a
   question for the DPO, and it bears directly on whether "pseudonymised" can be
   used as a safeguard in the DPIA at all.

6. **"Ask the operator to filter the export on consent" is a product change, not
   a drafting fix.** Blocking precondition B2 exists because no wording in this
   notice can make the current export consent-aware. If the institution cannot
   obtain that change, it must switch section 3 and section 10 to the
   public-task-plus-objection model. Do not publish the consent model over
   unchanged code.

7. **Room-level confidentiality of the AI chat has been removed as a claim.**
   The earlier draft said only your own room could read the chat. That is wrong:
   the database grants read access at the level of the whole session, and access
   granted at that level cannot be withdrawn for a part of it — the narrower
   rule on the chat restricts *writing*, not reading. **Recommend to the
   operator:** if per-room confidentiality is genuinely wanted, the chat must be
   moved out of the session subtree, as the admin secrets and the roster already
   were.

8. **Numbers corrected against the code, for the record:** the chat input cap is
   **500** characters (600 is the cap on the AI's reply and the database's
   ceiling); the payload is the scenario prompt plus **at most 15** conversation
   turns within **12,000** characters; the certificate retention written by the
   client is about **5 years**, not 10; the AI usage log records a **message
   count**, not message lengths, and there are additional per-user and
   per-session counters. Model names are **not** asserted, because they are set
   by configuration outside the source code.

9. **Reading time.** The old "about four minutes" was wrong by roughly
   four-fold for a document of this length, and an understated reading time is
   itself a dark pattern. It has been replaced by an honest structure statement.
   If your reviewed version is materially shorter, update the estimate rather
   than deleting it.
