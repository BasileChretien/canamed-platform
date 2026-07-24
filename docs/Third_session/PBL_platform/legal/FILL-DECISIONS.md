# Bracketed-slot fill decisions — operator answers

> **What this file is.** The three legal drafts contain ~240 `[BRACKETED]` slots.
> These are the operator's answers, recorded so the fill is consistent across all
> three documents and reproducible by a later session. **This file records
> decisions; it is not legal advice and none of it has been lawyer-reviewed.**
>
> Decided 2026-07-24 by Basile Chrétien. Standing constraint: **no DPO and no
> counsel are available to this project**, so every slot must be either derivable
> from verified fact or an explicit operator decision recorded here. Nothing may
> be invented.

## 1. Controller — DECIDED

**Basile Chrétien, personally, as the researcher.**

- Chosen deliberately over Nagoya University, UNICAEN, and joint Caen × Nagoya.
- ⚠️ **Recorded caveat (operator was warned, decision stands):** controllership
  is determined *factually* by who decides purposes and means, not by
  declaration. If sessions are run as part of the Nagoya doctoral work and under
  that affiliation, **Nagoya University is likely a controller or joint
  controller regardless of what this document says.** Declaring a sole
  individual controller does not shield the university and does forfeit the
  institutional cover (insurance, DPO, ethics infrastructure) that would
  otherwise apply. This caveat must appear visibly in the DPA, not only here.
- Consequence: the live privacy notice's current claim of **joint Caen × Nagoya
  controllership contradicts this** and must be corrected (gap L1).

## 2. Data-protection contact — DECIDED (with a required correction)

**Basile Chrétien — `chretien.basile.jean.bernard.u4@s.mail.nagoya-u.ac.jp`**

Fill as **"data-protection contact"**, NOT as "DPO".

- The operator asked to be named DPO. That is **not available**: GDPR Art. 38(6)
  requires the controller to ensure the DPO has no conflict of interests, and the
  settled reading (EDPB guidance; enforced by the Belgian DPA) is that the person
  who determines purposes and means **cannot** be their own DPO — the role exists
  to independently advise and monitor the controller. With the operator as
  controller (§1), self-appointment as DPO is self-contradictory on the face of
  the document.
- **No DPO is required here.** Art. 37(1) mandates one only for public
  authorities, large-scale systematic monitoring, or large-scale special-category
  data. An individual controller running classroom sessions meets none. What the
  law requires is Art. 13(1)(a)–(b): the controller's identity and contact
  details — satisfied by a privacy contact.
- Use the **institutional** address above, not a personal one.
- ⚠️ Every occurrence of the word "DPO" in the three drafts must be re-read: where
  it means "our data-protection contact" it becomes the above; where it means
  "an independent DPO will review this", that claim must be **deleted**, because
  no such review will happen.

## 2b. Controller address — DECIDED

Use the **Nagoya University** institutional address, on the basis that this is
doctoral work carried out at Nagoya University:

> Department of International Medical Education
> Nagoya University Graduate School of Medicine
> [65 Tsurumai-cho, Showa-ku, Nagoya, Aichi 466-8550, Japan — **VERIFY the exact
> postal form with the department before publication**; it is printed in a legal
> notice and must be exact.]

⚠️ **This reinforces the §1 caveat rather than resolving it.** Publishing the
university's address while declaring a *sole individual* controller signals
institutional backing; a supervisory authority reading the notice would more
readily conclude that **Nagoya University is a controller or joint controller**
in fact. The combination (individual controller + institutional address +
institutional email + doctoral framing) is the strongest available evidence
*against* the sole-individual position recorded in §1.

**Action for the operator:** tell the supervisor / department that this platform
and this notice exist and use the department's address. This is not a formality
— if Nagoya is a controller in fact, it carries obligations the university
cannot discharge without knowing. It also unlocks the two items still blocked
below (an ethics reference, and the university's real privacy contact).

## 3. Independent contact — DECIDED

**Branko (Aleksic) — `branko@med.nagoya-u.ac.jp`** (11 slots)

- This is the contact a participant uses **instead of** the person teaching and
  grading them. With the operator as controller, teacher *and* privacy contact,
  this is **the only independent safeguard in the entire pack** — its importance
  goes up, not down.
- ⚠️ **BLOCKING until confirmed — operator agreed 2026-07-24 that this must be
  obtained first.** Branko must **agree** to be published as a student-complaints
  contact before this notice reaches any participant. Publishing a colleague's
  address in a participant-facing document commits them to a role. Do not ship
  without his yes.
- Until he confirms, leave the slot as `[INDEPENDENT CONTACT — PENDING B.
  ALEKSIC'S CONFIRMATION]` rather than filling it. A notice that ships with an
  unconfirmed complaints address is worse than one that visibly lacks it.

## 4. Third-country transfer (Hugging Face) — DECIDED

**Rely on Hugging Face's own DPA + EU SCCs. Keep the LLM enabled.**

Verified against the primary documents on 2026-07-24 (not a secondary source):

- HF's DPA is **incorporated into the HF Agreement by reference** and effective on
  the Agreement's effective date — it is **not** enterprise-only and needs no
  separate signature. (A widely-cited vendor tracker claims "enterprise and
  pro-tier only"; the primary document contradicts it.)
- "Customer" is whoever accepted the HF ToS, and the ToS admits a **natural
  person** (13+) as a party — so an individual controller can be the data
  exporter. This is what makes the operator's first preference viable.
- Mechanism: **EU SCCs, Commission Implementing Decision 2021/914,
  controller-to-processor module.** SCCs prevail over the DPA on conflict.
- ⇒ `[TRANSFER MECHANISM]` = *SCCs (2021/914, controller-to-processor) via the
  Hugging Face DPA, incorporated by reference into the HF Agreement.*

**Two open sub-points — do not overstate the closure:**

1. **Routing / M12 is not fully closed.** The platform calls HF **Inference
   Providers** (the router at `HF_URL`), which forwards to third-party model
   providers. HF's DPA defines "Subprocessor" broadly enough to plausibly cover
   them, but this must be **confirmed against HF's published sub-processor list**.
   If it does not cover them, fall back for this sub-point only to *documenting
   the real position* (recipient not identifiable in advance) rather than
   claiming a mechanism that does not reach the actual recipient.
2. **The clean alternative costs money.** HF Inference *Endpoints* can be pinned
   to EU regions (`eu-west-1`, `westeurope`), removing the third-country transfer
   entirely. Dedicated endpoints are not free-tier, so this is out under the
   current $1 budget alert — but it is the correct answer if the project is ever
   funded.

## 5. Derivable slots — fill from verified fact (no decision needed)

All verified against the code/live system on 2026-07-24:

| Slot | Value | Source |
|---|---|---|
| Retention (closed sessions) | **30 days** | `cleanup-stale-sessions.js` `CLEANUP_RETENTION_CLOSED_DAYS` |
| Retention (abandoned/open) | **90 days** | same, `CLEANUP_RETENTION_OPEN_DAYS` |
| Linkage-table retention | **14 days** | GCS lifecycle, `linkage/` prefix |
| Pseudonymised export retention | **90 days** | GCS lifecycle, `pseudonymised/` prefix |
| Database region | **europe-west1** | RTDB URL |
| Live platform URL | **https://canamed-69785.web.app** | verified live (NOT `canamed.web.app`) |
| Sign-in providers | **Google; email + password** | `script.js` |
| Notice version | **PIS-v2-2026-05** | `CONSENT_NOTICE_VERSION` |
| Certificate retention cap | **~5 years** | `credentials/$certId.retentionUntil` rule |
| Sub-processors | **Google Firebase** (hosting, RTDB, auth, functions); **Hugging Face, Inc.** (AI patient); **[SMTP PROVIDER — confirm from `functions/`]** | code |

⚠️ The **`[RETENTION PERIOD CHOSEN BY THE CONTROLLER]`** slots must use 30/90 days.
The **live notice currently publishes 7 days**, which the code contradicts — that
is gap L3 and must be corrected in the same pass.

## 6. Remaining `[OWNER]` / `[DATE]` — 58 slots, STILL OPEN

The Annex VI remediation table. With a single-person project the honest fill is
`OWNER = Basile Chrétien` throughout, but the **dates are real commitments** and
must be chosen by the operator, not invented. Ask before filling.

## 7. Still unresolved after these decisions

- **Ethics committee / research-project name.** The research export needs an
  ethics approval reference. None is recorded. Until one exists, either obtain it
  or **disable the research export** — do not describe research use as approved.
- **DPIA.** Not done. Arguably not mandatory for an individual controller at this
  scale, but the processing involves students (a recognised power imbalance) and
  an AI component. Record the reasoning either way.
- **Cert-ID fix** (fifth Phase-4e gap) — approved, not yet built. See CLAUDE.md.
