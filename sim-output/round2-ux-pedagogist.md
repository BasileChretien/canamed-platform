# Round 2 — UX & PBL Pedagogist Critique of Module A

Reviewer hat: medical-education pedagogist (PBL/7-jump) + UX practitioner for non-English-native learners. Scope: `index.html` (#stage-1), `script.js` (`renderStage` / `updateModANextStep`), `case-content.js`, `tour.js`, and a layout skim of `style.css`. Verdict up front: the team has done the *hard* pedagogical work — the redesign from "menu of buttons" to a shared **consultation note** is the single best move in this codebase. The remaining issues are mostly **redundancy** (too many overlapping nudges) and **bilingual depth** (glossary is a token, not a system).

## 1. Information architecture & cognitive load

The current order — Phase-stepper → Bullet-progress → Coach card → Vignette → Consultation note (Impressions → History → Exam → Hypotheses → Investigations) — is **pedagogically correct** (the 2026-05-19 specialist verdict to move Hypotheses *below* Exam was right; anchoring bias is a real risk on the case stem alone). But the **vertical stack above the chart is too loud**: a student lands on stage 1 and meets the phase stepper, the 4-bullet progress checklist, the next-step coach, the vignette text, the "every voice in the room" banner, the consultation-note header, the "every click is a team decision" warning, *then* the optional First Impressions, *then* History. That is **seven framing elements before the first interactive control** (`index.html:1089-1255`). Each one is individually defensible. Together they bury the work. A learner with B1 English will close the tab.

Recommendation: keep the phase stepper as the *only* persistent top-of-page chrome; demote the bullet-progress checklist into the right-column "Decide together" tab where the bullets actually live; fold the next-step coach into a corner toast/FAB on desktop (keep it sticky-bottom on mobile — that bit is excellent, `style.css:1591`).

## 2. Walkthrough / onboarding

The 3-step `studentModA` tour (`tour.js:122-133`) scaffolds — it doesn't interrupt. Good: it fires *after* the main student tour, with its own version key, and `renderStage()` auto-dismisses it on stage change (`script.js:5301-5316`). However it anchors `tour.studentModA.3` to `rcol-p-decisions`, which on mobile (≤960px) is below the fold and the tour falls back to a centered bubble — meaning **the third step shows a description of an element the student cannot see**. Either reorder steps so the off-screen one comes first (with a `scrollIntoView` on the anchor), or hide step 3 on narrow viewports.

## 3. Notetaking + hypothesis-building affordances

**Hypotheses block (`index.html:1306-1331`) is the best-designed control on the page.** Cross-room sync + a real unlock gate (red-flag screen + ≥1 hypothesis, `script.js:7254-7260`) makes it impossible to game by typing "back pain" — that is exactly the right pedagogical pressure for PBL.

Weakness: **First Impressions is private-by-design (per-tab localStorage)** but sits inside the *shared* consultation note. A student reading the section header "Your consultation note … everything you ask … goes into your shared chart" will reasonably believe their impressions are shared too. The "no one else sees this" hint in the `<details>` body (`index.html:1247`) is below a collapsed summary and easy to miss. Move First Impressions out of `.consultation-note` into a separate "My scratchpad" card, or make the privacy signal visible in the summary line itself.

The 4-bullet group-answers form (`index.html:1539-1605`) is clean. Concern: there is no visible **per-author attribution** on submitted bullets, only a tally dot. A Caen student cannot tell whether a Nagoya teammate has spoken on the "differ" bullet specifically — undermining the "both voices" rule the platform spends three banners promoting.

## 4. Glossary + citations

Glossary (`glossary.js`) is **15 entries.** That is a token gesture for a bilingual chronic-pain case. Missing on a quick scan: *paraspinal, lasègue, SLR, NSAID contraindication, dependence vs tolerance, opioid stewardship, therapeutic alliance, biopsychosocial, yellow flag, catastrophising* — all of which appear in the case text or are pedagogically central. Match logic is substring-on-button-text, so terms inside `.a` answer paragraphs and in the discussion prompts get no tooltip at all. Citations (NICE NG59, RCSEng, HAS) live in the case-content per item — currently invisible to the student unless they reveal that exact button. Surface a small inline "📚 sources" chip on each revealed answer that lists the `cite` field.

## 5. Mobile / tablet

Breakpoint at 960px is fine. The sticky right-column at ≥961px (`style.css:262-277`) capped at `calc(100vh - 80px)` is sound. Concerns: (a) on iPad portrait (≥768px but ≤960px) the layout collapses to single-column and the right-column tabs vanish above the fold *without a jump-link* — the student must scroll past the entire chart to reach Decisions. Add a "Jump to ↓ Decide / Debate / Answers" anchor row below the phase stepper on stacked layouts. (b) Sticky-bottom coach has `padding-bottom: 100px` on `.stage` (`style.css:1603`) — verify this clears the iOS Safari bottom toolbar on iPhone SE (1334×750); 100px may be tight.

## 6. Bilingual / low-English considerations

The translations in `case-content.js` are high-quality (full FR + JA on every item I sampled). What is **missing**:

- **Inline reading aids inside answer text.** A Nagoya student reading the FR `.a` ("Le paracétamol ne fait rien…") has no per-sentence JA fallback — it is all-or-nothing per language. Consider a "show both languages" toggle on each revealed answer, not just a global lang switch.
- **Glossary doesn't scan answer prose**, only button labels — see §4.
- **The language hint on the answers form** ("Write in any language", `index.html:1543`) is welcoming, but the discussion prompts themselves do not encourage code-switching. Add an explicit "It's OK to reply in your strongest language" line on the progressive prompt UI (`#prompt-reply`).
- **No reading-pace signal.** Phase times ("22 min" for case-work, `index.html:1099`) are calibrated for native speakers. Add a "+ extra time for L2 readers" footnote.

## 7. Top 3 concrete improvements (prioritized)

1. **De-clutter the top of stage 1.** Move the 4-bullet progress checklist into the "Decide together" tab; demote the next-step coach to a dismissible corner widget on desktop; keep the phase stepper as the only persistent header. Files: `index.html:1119-1148` (remove from top), `script.js:5779-` (re-render target). High impact, ~½ day.
2. **Expand glossary to ~50 entries AND make it scan answer prose, not just buttons.** Add tooltips to revealed `.a` text and to prompt text. Files: `glossary.js` (add entries), `script.js` glossary-attach logic. Surface `cite` fields as inline chips. Medium impact, ~1 day.
3. **Fix the First-Impressions privacy ambiguity.** Either extract it from the `.consultation-note` container or move "🔒 just for you" into the `<summary>` line so it's visible while collapsed. File: `index.html:1240-1255`. Small effort, prevents a real trust-violation surprise.

Honourable mention: per-author attribution on the 4-bullet answers — without it the "both Caen and Nagoya voices" rule is unenforceable from the student's point of view.
