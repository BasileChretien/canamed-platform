# Facilitator-authored scenarios with multiple LLM characters

Design record, 2026-07-10. Supersedes nothing; extends `data-model.md` and
`security-model.md`.

## Goal

Any facilitator can author a scenario — their own case data, their own
personas — keep it private, hand it to a colleague by link, or publish it.
Module A and Module B can each contain several LLM-voiced characters (the
patient, a relative, a nurse) that students interview separately.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Switchboard** topology: one chat thread per character | One persona per LLM call. The 8B models on the HF free tier hold a single character reliably and several unreliably. Keeps the 12,000-char payload budget comfortable. |
| 2 | **English-only** authored content | The platform is already English-canonical (`t()` returns English unconditionally); the offline Word-help reader supplies FR/JA glosses. Removes two thirds of the authoring burden and the FR/JA keyword-stem burden. |
| 3 | Characters **reply in English** | Same reason. The `_hfModel('ja')` → Qwen routing stays for the three legacy built-ins, whose personas keep their `{en,fr,ja}` trios. |
| 4 | **Keyword-stem** scoring (`moduleA_questions`), plus `askOf` | Deterministic, offline-testable, zero extra LLM cost. `askOf` is what makes collateral history worth points. |
| 5 | Sharing tiers: **private / unlisted / public** | See "Sharing tree". |
| 6 | Anyone authors; **`facilitator` custom claim** to publish publicly | Keeps the tool open to a curious student; keeps the public list from becoming a spam surface. |
| 7 | Prompt assembled **server-side** | A shared persona is a stored prompt executed under our HF token by every student who loads the scenario. The client must not be able to supply it. |
| 8 | **Fixed Module A + B skeleton**; characters in both | A free-form module list would touch stage indices, the tab bar, the take-home PDF, the archive schema and the wrap-up questionnaire. |
| 9 | Characters are `present: "start"` or `present: "onCue"` | Facilitator-triggered and student-requested entrances deferred. |
| 10 | Answer keys: accepted risk, with listing hygiene | Decision scoring is client-side, so `correct`/`why` must reach the client during a session anyway. The public list carries `meta` only. |
| 11 | Rate caps raised, with a visible counter | A switchboard multiplies turns. |

## Character schema (scenario `schemaVersion: 2`)

```jsonc
{
  "id": "patient",
  "role": "patient",              // exactly one per scenario
  "name": "Mr Lefebvre",          // string (English) or {en,fr,ja} for legacy built-ins
  "blurb": "45-year-old office worker",
  "module": ["A"],                // "A" | "B"
  "present": "start",             // "start" | "onCue"
  "cue": { "afterDecision": "dec_disclosure" },   // or afterTurns / afterPhase
  "persona": "WHO you are … WHY you're here … YOUR STANCE …",
  "factsFrom": "history",         // draw CASE.history[] items whose `who` matches
  "facts": ["Extra facts not in the click-mode history"],
  "secrets": [
    { "id": "sec_alcohol",
      "text": "You drink most of a bottle of whisky most nights.",
      "unlockWhen": { "scoringFamily": "qr_alcohol" } }
  ],
  "contradicts": { "patient": "He says 'a couple of beers'; you know better." },
  "example": "Doctor: …\nMr Lefebvre: …",   // optional few-shot anchor
  "hears": []                     // reserved; ignored by the switchboard
}
```

`persona` is one free-text block, not four fields. The authoring UI presents
four guided textareas (who / why / stance / pushback) and concatenates them;
the schema stays a single string so a facilitator can paste a persona wholesale.

### Facts routing

`CASE.history[]` items gain an optional `who`. An item with no `who` belongs to
the character whose `role` is `patient`. `narratorOnly` items stay excluded from
every character, as today. `exam[]` and `labs[]` are never fed to any character.

### Secrets get a hard gate

A soft instruction ("reveal this only if asked sensitively") leaks on an 8B
model. Instead, `unlockWhen.scoringFamily` names a `moduleA_questions` family;
the server runs the same pure matcher the client scores with, and only injects
the secret into the facts block on the turn where that family matches. No model
trust, and the secret lands on the very turn that earns it.

## Sharing tree

Mirrors the accepted `credentials/$certId` pattern: know-the-id-to-read, no
enumeration.

| Path | Read | Write |
|---|---|---|
| `scenarios/$uid/$id` | owner | owner |
| `sharedScenarios/$shareId` | any signed-in user **by exact id** (collection `.read` removed → no listing) | owner |
| `scenarioIndex/$shareId` | any signed-in user, listable; **`meta` only, no `bodyJson`** | owner **and** `auth.token.facilitator == true` |

`ownerUid` is a 28-char random, so `__ref:shared:<ownerUid>:<id>` is an
unguessable link. Answer-key listing hygiene falls out for free: the browsable
index physically cannot contain a `correct` flag.

## Slices

| Slice | Content | Ships |
|---|---|---|
| **0** | Per-scenario personas. Fixes the production bug where every scenario voices Mr Lefebvre. Generalise `SERVER_GUARD` and the reply-prefix stripper. | client + functions |
| **1** | Server-side prompt assembly. Client sends `{roomCode, roomId, characterId, transcript, userText}`; `hfPatient` derives the scenario from `sessions/<code>/scenarioRef` and builds the prompt. One compat release still accepting `messages`, because `sw.js` serves old clients until the shell version propagates. | functions + client |
| **2** | Switchboard in Module A. `moduleA/chat/$characterId/$turnId`. Cues, `askOf`, raised rate caps, counter UI. | client + rules |
| **3** | Characters in Module B. | client + rules |
| **4** | Authoring UI: English-only form, `schemaVersion: 2` with a v1 migration, characters / `moduleA_questions` / penalties / pre+post-test sections. | client |
| **5** | Sharing tiers, `setFacilitator` callable, `getIdToken(true)` refresh. | rules + functions + client |

## The bug slice 0 fixes

`modALLMInit()` is called unconditionally from `startRoom()`
([script.js](../script.js)) and `_flagOn()` defaults to `true`, so the chat is
Module A's interface for every scenario. But `PATIENT_IDENTITY` in
[modA-llm-prompts.js](../modA-llm-prompts.js) is a hardcoded constant, while the
facts come from `CASE.history[]`, which `applyScenario()` swaps. The two
non-default built-ins therefore run a chat in which a 45-year-old office worker
demands oxycodone while quoting Mrs Tanaka's jaundice history. Five i18n strings
(`modA.chart.title`, `modA.chart.team-click-warning`, `modA.chat.disclosure`,
`modA.chat.placeholder`, `modA.chat.thinking`) and the `modA.coach.read-case`
coach line name him too.

## Known residuals

- A v1 scenario pasted as custom JSON has no `characters`, so it falls back to a
  generic patient identity built from the case facts. It no longer inherits
  Mr Lefebvre.
- Reply language is already pinned to English by `_patientLang()` in
  [modA-llm-init.js](../modA-llm-init.js), overridable per cohort with
  `window.CANAMED_MODA_LLM_LANG`. The `_hfModel('ja')` → Qwen route therefore
  only fires under that override, where the three built-ins' `{en,fr,ja}`
  persona trios still apply. Authored personas are English-only, so an override
  would give them an English persona answering in Japanese — acceptable, but
  slice 4 should refuse the pairing at save time.
- Slice 0 sends `characterName` to `hfPatient` so the server can strip a
  `"<Name>:"` prefix it cannot otherwise know. A client cached by `sw.js` from
  before the shell bump sends none; the generic role words ("Patient:") still
  apply, so the worst case is a cosmetic prefix. Slice 1 removes the parameter
  entirely by reading the scenario server-side.
- Merge order: `feat/modA-appropriateness-triage` (10 commits ahead of `main`)
  also restructures the scenario schema. Land it first; rebase schema v2 on top.
