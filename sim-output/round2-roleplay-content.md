# Round 2 — Module B (SPIKES / Breaking-Bad-News) roleplay critique

**Reviewer role:** roleplay / medical-communication trainer
**Files inspected:**
- `C:/cnm-pp/docs/Third_session/PBL_platform/case-content.js` (`CASE_B`, `SCORING_B`, `PENALTIES_B`, `DECISIONS_B`, prompts 848–874)
- `C:/cnm-pp/docs/Third_session/PBL_platform/script.js` (`renderPrompts` ~6006, `updateModBNextStep` ~7180, `initRolePicker` ~7365, `initObserver` ~7924)
- `C:/cnm-pp/docs/Third_session/PBL_platform/index.html` (#stage-2 markup, lines 1812–2238: phase stepper, vignette, safety note, role-picker, SPIKES strip, Pause/Explore/Explain/Realign, Phase-3 discussion list, recap tables, group-answers form)

Headline: the **content** (CASE_B + DECISIONS_B + SCORING_B + the SPIKES recap table) is genuinely strong — better than most medical-school SPIKES modules I have seen, with sources (Loi Kouchner, MHLW 2007/2018, SHARE, Baile 2000) and a real ethical dilemma (son's "don't tell"). The **roleplay UI**, however, does not deliver that content to the learner during the scene — it sits at a generic vignette one level of abstraction above the case, and the observer / debrief / pacing scaffolding is conspicuously thin.

---

## 1. Does the roleplay follow SPIKES?

**Partial — reference is present, execution is not scaffolded.**

- ✅ The six steps are listed in the `.spikes-strip` reference (index.html 1950–1958) and again in the `recap-card` table (2113–2130) with model phrases.
- ✅ `SCORING_B.structure` rewards SPIKES keywords ("warning shot", "perception", "invitation", "small piece", "pause", "ask permission", "empathy", "strategy and summary") in the post-hoc group answer text (case-content.js 916–924).
- ❌ During the scene itself there is **no per-step checklist or beat sheet** the physician/observer can tick off. SPIKES is presented as a horizontal strip of labels, not as a sequence to be lived through. A student who hasn't already internalised SPIKES will not be able to map their own utterances to S → P → I → K → E → S.
- ❌ "Setting" is invisible: no prompt about who is in the room, whether the physician sits, whether the door is closed, pager/phone disposition. Players will skip it.
- ❌ "Perception" is missing as an explicit instruction. The patient chip says "Decide privately: deep down, do you want to know everything or not?" but the physician chip never says "before you say anything, ask what they already understand."
- ❌ "Invitation" is conflated with Phase-3 prompt q1 (post-scene discussion), not built into the scene script.
- ❌ "Strategy" / next-step / non-abandonment is not in the chip brief at all — the physician chip stops at "deliver the news with empathy" and the patient is left with no on-stage signal that the conversation should end with a concrete next step.
- ❌ The PENALTIES_B / DECISIONS_B logic (which would actually teach SPIKES-typical errors — promising the son, blurting the diagnosis, deflecting) is wired into Module A's history-item scoring and the team-vote `decisions-B` panel, **not** into the roleplay observer flow. So an observer watching the scene has no in-tool way to flag "the physician promised the family secrecy at minute 2".

**Traceability of the 6 steps inside Phase 2 ("Play it out"): currently no.** Each step is mentioned somewhere in the UI, but a learner cannot point at a specific control or moment and say "this is where Invitation is happening".

---

## 2. Patient / family persona writing

**The case-content.js text is excellent. The on-stage chip briefs are too thin to play.**

What's good (case-content.js):
- Mrs Tanaka's first words (history:0, history:5) are written like real speech, with the right hesitations: "Doctor… I am not a child. If it is something serious, I would want to know — but please, gently, and at my pace." Translations into FR and JA preserve register (vous, です/ます, the small ellipsis).
- The son's monologue (history:6) gives a concrete biographical reason for the request to withhold ("When my father was told his stroke might recur, he stopped eating. He died two weeks later.") plus the cultural frame (eldest son carries the burden). That is exactly the kind of subtext an actor can play.
- The two deliberately-poor opening moves (history:7, history:8) are emotionally calibrated — "He looks relieved and thanks you" vs. "He stiffens, takes a step back and says coldly".

What's missing on stage (index.html role-chips, lines 1915–1944):
- The **case the students play is a different case** than CASE_B. Index.html says "Mr / Mrs Tanaka-Martin, 60 years old, came in for tiredness and weight loss… a serious, chronic, life-changing illness — your group chooses one (for example: a newly diagnosed cancer, advanced heart failure, early Parkinson's disease, or kidney failure needing dialysis)." This is a generic vignette decoupled from the painless-jaundice / pancreatic-Ca / Stage IV findings of CASE_B. **The two-hour Module A workup of Mrs Tanaka (75, pancreas, MDT, 6–11 month survival) is thrown away at the moment of the roleplay.** Students who just spent 40 minutes uncovering Courvoisier's sign now play "you pick the disease, you pick the age, you make it up". This is a structural error.
- Patient brief is *one sentence* ("You suspected something was wrong. Decide privately: deep down, do you want to know everything or not?"). Compare with the case-content version which gives biography, prior bereavement, presence preference for the son, and concrete questions ("Will I have time to put my affairs in order?"). The actor has nothing to play except a binary.
- Family brief is *one sentence* ("Partway through — not at the start — quietly take the physician aside and ask them not to tell your parent everything"). No grief context, no cultural framing, no script for the actual aside. A timid student will mumble "uhh, don't tell mum, please" and the scene collapses.

→ **The richest persona writing in the whole project is in CASE_B.history[5–8] and is invisible to the roleplayers.**

---

## 3. Observer / debrief

**Weak. The observer role is named but has almost no tool to do their job.**

- The observer chip says: "You time the scene and run Phase 3. Watch the SPIKES steps — note one thing the physician said that worked and one moment that was hard." (index.html 1939–1944)
- That is the entire instruction. There is **no observer-specific UI**: no SPIKES checklist with tick boxes, no time-stamped note field, no structured "What did the physician say at the Knowledge step? At the Emotion step?" form. The observer is asked to do facilitator-grade structured observation with nothing but their head.
- `initObserver()` (script.js ~7924) is a separate concept — it flips a participant into "I'm just observing" mode for the whole session. It is **not** the roleplay observer. The two "observer" concepts share a word but not a workflow, which is confusing — and means the per-room observer flag isn't used to surface a roleplay observation form when someone picks the observer chip.
- The group-answers card (index.html 2175–2238) has three bullets: family-sentence, differ-converge, practice-change. None of these are observer feedback about the scene itself. There is no "What I noticed the physician do well" / "Where the conversation broke" bullet.
- Phase 3 questions (1991–2026) are *thematic* (compare France/Japan, autonomy vs family, language across barriers). They are not feedback about the specific scene that was just played. So the debrief is about geopolitics of disclosure, not about *what just happened in this room with this physician*.
- No video / audio capture, no transcript, no replay. Once Phase 2 ends, the scene is lost.

---

## 4. Bilingual considerations

**Half-done. Anglophone scaffolding is privileged.**

- ✅ The SPIKES strip, the role chips, the safety note, the discussion questions, and the answer-bullet labels all have `data-i18n` keys (1949–2025), so a translator can supply FR/JA versions.
- ✅ CASE_B prompts and DECISIONS_B options are fully trilingual in case-content.js.
- ✅ The recap-card recap tables (2113–2168) have the right shape for translation.
- ❌ **The "Useful sentences" phrasebook (index.html 1961–1964) is English-only by default**: `"I'm afraid I have some serious news." · "Would you like me to explain everything…" · "I can see this is hard to hear." · "Take your time." · "What questions do you have for me?"`. It carries one `data-i18n` key (`stage.modB.spikes.useful.examples`) on a single `<span>` — translators must provide the *whole block* as one string, which is brittle and likely to be skipped. There is no parallel FR phrasebook ("Je suis désolé, j'ai des nouvelles sérieuses à vous annoncer.") or JA phrasebook (「残念ながら、お伝えしなければならないことがあります。」「ゆっくり、お時間を取ってください。」) **displayed side-by-side** during the scene, even though the case is explicitly Franco-Japanese.
- ❌ The patient/family chip briefs do not give the actor a phrase in the *patient's* language (Mrs Tanaka would be speaking Japanese; the roleplay is conducted in English per the safety note — so this is a deliberate pedagogical choice, but it's never explained that the *clinical* version of this conversation in real life would not be in English).
- ❌ The recap-table model phrases ("Is it alright if we talk now?", "What have you been told so far?", etc., index.html 2117–2128) are English-only with no FR/JA columns. Adding a French and Japanese column would turn that table into the genuine bilingual cue card the platform's whole premise needs.
- ❌ No phonetic guide for the Japanese phrases a French student might want to try (or vice versa). For SPIKES this matters: a French student attempting 「ゆっくりお話ししましょう」 needs to be able to pronounce it.

---

## 5. Time pacing

**Phases are labelled, but no in-app timer enforces or visualises them.**

- The phase stepper (index.html 1822–1844) declares: Setup 6 min · Play 12 + 3 min · Exchange 15 min · Bullets 5 min = **41 minutes**. Realistic for the content.
- The "12 + 3 min" for play presumably means 12 min scene + 3 min reset. This is not explained anywhere visible.
- `setPhaseStepperState` (called from `updateModBNextStep`, script.js ~7180–7216) visually highlights the current phase, **but there is no countdown timer**. The observer chip says "you time the scene" — meaning a phone-stopwatch on the table. In a 41-min module run in parallel across 4–6 rooms, this is unreliable: some rooms will overrun Phase 2 and skip Phase 3 entirely (which is where the actual learning is).
- No "**swap and replay**" mechanic. One student is physician for the whole 12 minutes; nobody else gets to try the same opening with a different approach. Best-practice SPIKES roleplay does 2–3 short replays with the same patient and different physicians, precisely because the first attempt always burns the warning-shot opportunity.
- No "**rewind and try again**" within a single scene either. If the physician promises the son secrecy at minute 2 (a textbook PENALTIES_B trigger), there is no facilitator-driven "Pause — try that exchange again" button.
- Role-pick is **localStorage-only** (`initRolePicker`, script.js 7370–7397). The comment explicitly says "Cross-room sync (everyone seeing each other's picks) is a future PR." Two students in the same room can both claim "physician" with no in-tool conflict resolution. For a roleplay this is a structural defect.

---

## 6. Pitfalls — common SPIKES failure modes NOT being scaffolded against

The case-content engine catches some failure modes via PENALTIES_B and DECISIONS_B, but the roleplay UI itself catches almost none in real time:

| Failure mode | Scaffolded? | Where |
|---|---|---|
| Diagnosis blurted in one breath, no warning shot | ⚠️ Post-hoc only | DECISIONS_B `dec_first_words` option A — only triggers if someone votes that option in the decision panel, not if a roleplaying physician actually does it |
| Promising the family to withhold | ⚠️ Post-hoc only | DECISIONS_B `dec_family` option A, history:7 penalty |
| "It's just X — don't worry" deflection | ⚠️ Post-hoc only | DECISIONS_B `dec_first_words` option B |
| Skipping Perception (not asking what they already know) | ❌ Not scaffolded | nowhere |
| Skipping Invitation (assuming they want everything) | ❌ Not scaffolded | nowhere |
| Talking too much / "data dump" / not pausing | ❌ Not scaffolded | the SPIKES strip says "small pieces" but nothing in the scene flow enforces silence |
| Empathy mismatch — moving to "Strategy" while the patient is still crying | ❌ Not scaffolded | the prompts mention silence but no observer-side flag |
| False reassurance ("we'll fix this") | ❌ Not scaffolded | nowhere |
| Forgetting the third party in the room — only addressing one of patient/family | ❌ Not scaffolded | nowhere |
| Asking the family-aside question in front of the patient | ❌ Not scaffolded | nowhere; the family chip just says "partway through, quietly take the physician aside" but there is no spatial/staging convention |
| Translating "cancer" into euphemism in a way the patient cannot decode | ⚠️ Discussed | prompt 6 (case-content.js 863–865) discusses 進行/限られた時間 — but as post-hoc reflection, not as a real-time observer flag |
| Ignoring patient's stated information preference (she said "gentle, at my pace") | ⚠️ Post-hoc only | scoring rewards `withhold` family-handling but not patient-preference adherence |
| Cultural projection ("Japanese patients want family-only disclosure" stereotype) | ✅ Genuinely scaffolded | `convergeB`, `family_role`, recap table 2146–2168 |
| Not closing — leaving the patient without a next step / contact / follow-up time | ❌ Not scaffolded | nowhere |
| Trainee distress / vicarious trauma during the scene | ⚠️ Partial | safety note (1894–1904) says "move into the observer role at any time" — but no in-scene "pause for breath" button, no post-scene re-grounding prompt |

The biggest missing scaffolding is **real-time observer prompts during the scene**. A facilitator-facing or observer-facing checklist with the 6 SPIKES steps as ticking-off rows, plus the most-common error types as click-to-flag rows, would convert this from "an honest scene" into "a teachable scene". It would also make the post-scene debrief concrete: "Observers, you flagged 'data dump' at 4:12 — Physician, what was going on for you then?"

---

## 7. Top 3 concrete improvements

### 7.1 Wire the roleplay UI to CASE_B — give the players the persona they earned

The platform spends 40 minutes building Mrs Tanaka (75, pancreatic Ca, son recently lost his father, full decision-making capacity, "doctor, I am not a child") and then in Phase 2 throws that away in favour of a generic "Mr/Mrs Tanaka-Martin, 60, pick a disease". This is the single biggest fix.

**Proposed:** the role-chip briefs in index.html 1909–1946 should be replaced (or augmented with a "Use the case Mrs Tanaka" toggle) with text drawn directly from CASE_B.history[0–8]. Concretely:

```html
<!-- Patient chip — Mrs Tanaka, drawn from CASE_B -->
<button class="role-chip" data-role="patient" role="radio">
  <span class="role-chip-name" data-i18n="modB.role.patient.name">
    Mrs Tanaka (75)
  </span>
  <span class="role-chip-brief" data-i18n="modB.role.patient.brief" data-i18n-html>
    Widowed last year. Came in with jaundice and weight loss. You don't yet
    know that the scan shows pancreatic cancer with liver spread. When the
    doctor sits down, you ask quietly: <em>"Doctor… is it bad?"</em>
    You are not a child — if it is serious you want to know, gently, at your
    pace, with your son in the room. You will probably ask:
    <em>"Will I have time to put my affairs in order?"</em>
  </span>
</button>

<!-- Family chip — son, with the real backstory -->
<button class="role-chip" data-role="family" role="radio">
  <span class="role-chip-name" data-i18n="modB.role.family.name">
    Hiroshi, eldest son (45)
  </span>
  <span class="role-chip-brief" data-i18n="modB.role.family.brief" data-i18n-html>
    Your father died of a stroke last year — two weeks after a doctor told him
    it might recur, he stopped eating. You cannot bear to watch that again.
    At some point — <strong>before</strong> the doctor sits down with your
    mother — you take them aside in the corridor and say quietly:
    <em>"Doctor, please — whatever you find, do not tell my mother. She has
    just lost my father; she could not bear to hear the word ‛cancer'.
    Tell me, and I will decide what she needs to know."</em>
  </span>
</button>
```

Provide the FR and JA translations in i18n (the strings already exist in `CASE_B.history[5]` and `CASE_B.history[6]` and can be reused verbatim). This single change converts the scene from "improv with vague disease" into "play the documented Tanaka case".

### 7.2 Give the observer a real tool

Replace the one-line observer brief with a structured **Observer pad** that appears only when `data-role="observer"` is the selected chip. Concrete UI (a new `<section class="card observer-pad hidden" id="modB-observer-pad">` in stage-2):

```html
<section class="card observer-pad hidden" id="modB-observer-pad"
         aria-label="Observer pad — Module B roleplay">
  <h3 data-i18n="modB.observer.title">Observer pad — what to watch for</h3>
  <p class="hint" data-i18n="modB.observer.intro">
    Tick a SPIKES step as you hear it, or click a pitfall flag when it
    happens. Both are shown to the group during Phase 3 debrief.
  </p>
  <ul class="observer-spikes-check">
    <li><label><input type="checkbox" data-spikes="S1"> <strong>S</strong>etting
      — did the physician set the scene (sit, close door, ask if now is OK)?</label></li>
    <li><label><input type="checkbox" data-spikes="P"> <strong>P</strong>erception
      — did they ask what Mrs Tanaka already understands?</label></li>
    <li><label><input type="checkbox" data-spikes="I"> <strong>I</strong>nvitation
      — did they ask how much she wants to know, and who she wants present?</label></li>
    <li><label><input type="checkbox" data-spikes="K"> <strong>K</strong>nowledge
      — warning shot first, news in small pieces, with pauses?</label></li>
    <li><label><input type="checkbox" data-spikes="E"> <strong>E</strong>motion
      — did they name and acknowledge feeling? Allow silence?</label></li>
    <li><label><input type="checkbox" data-spikes="S2"> <strong>S</strong>trategy
      — did the conversation end with a concrete next step and a "I won't
      leave you alone in this"?</label></li>
  </ul>
  <h4 data-i18n="modB.observer.pitfalls">Click a flag the moment you notice it</h4>
  <div class="observer-flag-row">
    <button class="observer-flag" data-flag="dump">Data dump</button>
    <button class="observer-flag" data-flag="promise">Promised the son secrecy</button>
    <button class="observer-flag" data-flag="blurt">Blurted diagnosis with no warning shot</button>
    <button class="observer-flag" data-flag="deflect">Deflected ("don't worry")</button>
    <button class="observer-flag" data-flag="reassure">False reassurance</button>
    <button class="observer-flag" data-flag="no-close">No next step / left them hanging</button>
    <button class="observer-flag" data-flag="ignored-pt">Spoke only to son, not patient</button>
  </div>
  <label class="observer-note">
    <span data-i18n="modB.observer.note">One sentence that worked, one moment that was hard:</span>
    <textarea id="modB-observer-text" rows="3" maxlength="500"></textarea>
  </label>
</section>
```

Flags are time-stamped client-side and pushed to `/sessions/{code}/rooms/{room}/observerFlags/{cid}`. In Phase 3, render them as a left-aligned timeline ("0:48 – warning shot ✓ · 2:14 – Perception missed · 4:32 – Promised the son · 6:01 – Knowledge ✓ · 7:55 – Emotion ✓ · 9:10 – Strategy ✓"). This produces a *specific, citable* debrief instead of "I felt it went well-ish."

### 7.3 Bilingual cue cards + countdown timer + swap-and-replay

Three smaller fixes bundled together because each is short:

**(a) Trilingual phrasebook card.** Replace the English-only "Useful sentences" span (index.html 1961–1964) with a three-column table:

```html
<table class="phrasebook" aria-label="SPIKES — useful sentences in English, French, Japanese">
  <thead>
    <tr><th>Step</th><th>English</th><th>Français</th><th>日本語</th></tr>
  </thead>
  <tbody>
    <tr><td>Warning shot</td>
        <td>"I'm afraid I have some serious news."</td>
        <td>« J'ai bien peur d'avoir des nouvelles sérieuses à vous annoncer. »</td>
        <td>「残念ながら、お伝えしなければならない深刻なお話があります。」</td></tr>
    <tr><td>Invitation</td>
        <td>"Would you like all the details, or the headlines?"</td>
        <td>« Préférez-vous tous les détails, ou seulement l'essentiel ? »</td>
        <td>「詳しくお話ししましょうか、それとも要点だけにしましょうか?」</td></tr>
    <tr><td>Empathy</td>
        <td>"I can see this is hard to hear. Take your time."</td>
        <td>« Je vois que c'est difficile à entendre. Prenez votre temps. »</td>
        <td>「お辛いお話だと思います。どうぞゆっくりお時間を取ってください。」</td></tr>
    <tr><td>Silence</td>
        <td>(pause — at least 5 seconds)</td>
        <td>(pause — au moins 5 secondes)</td>
        <td>(沈黙 — 5秒以上)</td></tr>
    <tr><td>Strategy</td>
        <td>"Here is what we do next. I will be with you."</td>
        <td>« Voici la suite — je serai à vos côtés. »</td>
        <td>「次に何をするかをお話しします。私たちは一緒に進みます。」</td></tr>
  </tbody>
</table>
```

**(b) In-app countdown timer.** Add `setInterval`-driven countdowns to the phase stepper (`.phase-step-time` spans, index.html 1827/1832/1837/1842): when phase activates, the time text becomes a live "5:42" countdown coloured green → amber → red. Synced via Firebase so all rooms see the same clock (anchor: timestamp of first `role-chip` click). When Phase 2's 12 minutes elapse the observer pad shows a single button: **"End scene and start Exchange"**.

**(c) Swap-and-replay button.** After the scene ends, before Phase 3 opens, surface a card: *"Want to replay the opening 60 seconds with a different physician? Pick again."* — clears the physician chip selection (keeps patient + family + observer), resets a 60-second timer, and asks the new physician to try the warning shot / Perception / Invitation again. Even one replay dramatically improves learning; the existing role-chip code already supports re-selection.

---

## Bonus — three small wins worth doing in the same PR

- **Sync role-pick across the room** (the `initRolePicker` TODO at script.js 7363). Right now two students in the same room can both be "physician".
- **Wire DECISIONS_B and PENALTIES_B into the scene clock**, not just the decision-vote panel. If the observer flags "promised secrecy", auto-trigger DECISIONS_B `dec_family` option A's `why` text into the debrief.
- **Add a "right not to know" beat** to the patient chip. Loi Kouchner protects it, MHLW guidance acknowledges it, and the case currently has Mrs Tanaka clearly wanting to know — so all groups practise disclosure to a patient who wants the information. Add an optional variant card where the patient quietly says "Doctor, please don't tell me yet — tell my son." This is the harder direction of the same skill and the current scene never lets students practise it.

---

## Summary judgment

Module B has the rarest asset in a SPIKES module — **case content of genuinely publishable quality**, written trilingually with the right ethical complexity and the right historical sources. But the roleplay UI that surrounds it is generic vignette-and-discussion, not a scene with persona, timer, observer rubric, or replay. Closing that gap — wiring the rich CASE_B persona into the role chips, giving the observer a structured pad with SPIKES ticks + pitfall flags, and adding a countdown + swap-and-replay loop — would convert this from "a thoughtful conversation about disclosure" into "a SPIKES skill drill students can actually fail and recover from", which is what breaking-bad-news training is for.
