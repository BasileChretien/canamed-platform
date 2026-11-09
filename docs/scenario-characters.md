# Scenario characters

> Moved verbatim from `CLAUDE.md` on 2026-11-04 (its lines 1291–1429), so that
> it is read when needed instead of loading into every session. Read it when authoring or editing facilitator scenarios.
> The **STATUS-CLAIM RULE** in `CLAUDE.md` applies to every status label here:
> verify against the code or live system before relaying one, and update the
> label in the same commit as the work that changes it. Where the text says
> "below" or "above", the section may now be in `docs/STATUS.md`,
> `docs/security-follow-ups.md` or `docs/scenario-characters.md`.

## Scenario characters (facilitator-authored scenarios)

Design record: [ARCHITECTURE/scenario-characters-design.md](docs/Third_session/PBL_platform/ARCHITECTURE/scenario-characters-design.md).

- **Personas live in the scenario, not in code.** Each scenario declares
  `characters: [{ id, role, name, persona, … }]` (case-content.js `CHARACTERS*`).
  `applyScenario()` publishes them at `window.CURRENT_SCENARIO_CHARACTERS`;
  `modA-llm-prompts.js` builds the system prompt from whichever character is
  being interviewed. Exactly one character per scenario carries `role:"patient"`.
  A scenario declaring none falls back to a generic patient — it must never
  inherit the previous scenario's cast.
- **Multi-character switchboard — SHIPPED 2026-09-04 (shell v165).** A
  section declaring several Module A characters gets one chip per character
  above the chat; each character is its own thread on screen AND at the model
  (one persona per call). Persisted turns carry an optional validated
  `character` field on the existing `roomChat/…/$turnId` node (both rule
  trees); **a turn with no field is the index patient's** — that is what keeps
  every pre-existing transcript readable, so never make the field required.
  Facts route by `who`, and an item with no `who` now belongs to the index
  patient ONLY (it used to reach every character). Scoring families may carry
  `askOf: "<characterId>"|[…]`. Single-character sections are unchanged.
  **Per-slot chat store — SHIPPED 2026-09-07 (shell v166):** every turn also
  carries `slot` (optional, 1..9; a turn with none is the session's FIRST PBL
  slot), the panel shows only the active slot's turns and rebuilds on
  `canamed:slotchange`, the once-only award map is
  `rooms/$room/sections/$slot/scoring/awarded` (the module-literal
  `moduleA/scoring/awarded` is no longer read), and chat score events are
  `chatA_s<slot>_<famId>` / `s<slot>_<famId>`. See "Per-slot chat store" in
  `ARCHITECTURE/section-model-design.md`.
- **"A Difficult Child (Mayumi)" — the Nagoya PBL No. 57 as SIX PBL-only
  sections (2026-09-07, shell v167).** Content lives in `mayumi-seed.js` (a
  lazy chunk merged into `CANAMED_SCENARIOS` after `branched-seed.js`, in the
  loader, `sw.js` and `revisit.html`), registered as `mayumi-1-pbl` …
  `mayumi-6-pbl` in `section-registry.js`. Facts are CUMULATIVE per reveal and
  routed by `who` (which may now be an ARRAY of ids); Mayumi is
  `present:"onCue"` in sections 1–2, so the chat opens on the first OFFERED
  character there; a slot change resets the addressee to the new section's
  default. The clinical content is **awaiting review by Dr Branko / the Nagoya
  tutors** — checklist in `ARCHITECTURE/mayumi-pbl-content.md`. The handout
  wins over his app where they differ (escitalopram, not fluoxetine).
- **THE ROOM DOM FOLLOWS THE SECTION (fixed 2026-09-07, shell v168).** Found live
  on the first six-section session: `applySectionContent()` re-pointed CASE /
  SCORING / characters but the ROOM kept the first section's DOM — the workup
  buttons (`buildButtons()` had only ever run at room entry and on a language
  change), the "patient in front of you" card (static Lefebvre markup), the
  `{patientName}` strings (interpolated once at load) and the PBL reference
  panels (static opioid prose). Every multi-section session had this; the
  mixed-session e2e asserted the GLOBALS, never the DOM. Now
  `applySectionContent()` rebuilds the board, renders `sec.vignette || summary`
  into `#modA-vignette-text`, re-applies i18n on `#stage-1`, and publishes
  `CURRENT_SECTION_REFERENCES` (a PBL section's optional
  `references.{history,guidelines,recap}`, rendered like the roleplay panels:
  absent = shipped markup, declared = only what is declared). **Assert the
  DOM, not the globals**, when testing per-section content
  (`tests-e2e/mixed-session-e2e.spec.js` "BOARD and vignette in the DOM").
- **Picker is CASE-FIRST (2026-09-07):** a Case select (sections grouped by
  `caseId`, which a scenario may declare; a built-in case's halves and the six
  Mayumi steps share theirs), a ticked checklist of its parts, "+ Add the
  ticked parts". The flat single-section add stays below for mixing, and
  prefixes a part with its case name when the title alone is ambiguous.
- **A NEW chat reply is typed out word by word** (`_typewrite` in
  modA-llm-init.js; ≤2.5 s, replays and reduced-motion render whole). It is a
  reveal after the reply ARRIVES — the proxy still returns whole replies; true
  token streaming would be a proxy change.
- **WebKit counts a `<select>`'s LONGEST OPTION TEXT toward the page's scroll
  width, whatever the box is sized to** (measured 2026-09-07, PR #396). A
  112-char option in the create form's flat section list pushed the splash to
  ~500 px at 320 — `splash-overflow.spec` red on webkit/iPhone/iPad, green on
  chromium/Android, and green locally because only chromium had run it.
  `min-width:0`, `width:100%` and `overflow:hidden` on the containers change
  nothing. Keep option text short and disambiguate with `<optgroup>`. Run
  that spec on webkit before pushing any splash markup change.
- **"It says thinking but no reply" = a CLOSED session (fixed 2026-09-09,
  shell v171).** Once `closed` exists the rules refuse every `roomChat` write,
  but the chat kept accepting questions: the proxy answered normally (200,
  3–4 s), both turn writes were denied, the DB-driven transcript rendered
  nothing, the status cleared, the input stayed open. Only trace: an SDK
  `permission_denied` warning in the console. Now the chat locks and says
  "This session has ended" (flag `CANAMED_SESSION_CLOSED` + event
  `canamed:sessionclosed` from `renderClosedState()`), and a refused save
  surfaces a status line. **Diagnosing a "no reply" report: check `closed`
  first**, then the console for `permission_denied`, then the proxy (a
  tokenless POST returns the handler's own 401 within ~10 s when it is up).
  Two related hazards seen in the same investigation, NOT fixed: a room
  entered directly at the Welcome/Wrap-up stage has no section applied, so
  the hidden chat initialises against the DEFAULT case (the model answered as
  Mr Lefebvre in a Mayumi session); and the transcript's `child_added`
  listener has no cancel handler, so if it attaches before the room claim
  lands (fresh identity re-entering) the transcript is dead for the tab.
- **The Android "lost Send tap" is NOT a product defect** (diagnosed
  2026-09-07 with every scroll API instrumented): in the failing runs no app
  code scrolled and no submit fired; a bare scroll EVENT moved the page ~400 px
  ~200 ms after the click began — the browser's own scroll-into-view, driven
  by Playwright over CDP, animating under the settling layout, so the pointer
  landed off the button. Specs send with Enter (#395); a real finger does not
  race a programmatic scroll. Do not re-open this from a CI Android failure
  on a Send tap alone.
- **⚠ `hfPatient` needs `firebase deploy --only functions` to pick this up.**
  `SERVER_GUARD` was generalised from "simulated patient" to "simulated
  character", and the reply-prefix stripper is now driven by the character's
  name. `PROMPT_VERSION` is `modA-llm@2.5` (bumped 2026-08-20 by the EU
  data-residency pin — see the `HF_PROVIDER` note in item 4 above).

- **✅ DEPLOYED 2026-08-21 — the queue behind this deploy is now empty.** Both the
  scenario-characters `SERVER_GUARD` change and the EU provider pin are live
  (`firebase deploy --only functions`, hfPatient + sendQueuedMail updated in
  `europe-west1`).
  **⚠️ THE TRAP THAT ALMOST MADE THIS A SILENT OUTAGE, for whoever deploys next:**
  `functions/.env` is git-ignored, so NO test and NO CI check can see it — and its
  values OVERRIDE the code defaults. It still named the OLD models
  (`meta-llama/Llama-3.1-8B-Instruct` / `Qwen/Qwen2.5-7B-Instruct`) and had no
  `HF_PROVIDER` at all. Deploying as-is would have combined the old models with
  the new default provider — `meta-llama/Llama-3.1-8B-Instruct:ovhcloud`, which
  OVHcloud does not serve — so every call would have 404d and the chat would have
  degraded **silently** to the stub patient. `tests/hf-model-doc-lockstep.test.js`
  cannot catch this: it reads `.env.example`, not `.env`. **Whenever HF_MODEL,
  HF_MODEL_JA or HF_PROVIDER changes in code, open the real `functions/.env` and
  reconcile it by hand before deploying.** Also: non-interactive deploy refuses to
  run without an explicit `HF_GLOBAL_DAILY_CAP`, now pinned in `.env` to the same
  4000 the code defaults to.
  **STILL OWED — the end-to-end check (needs a real room, cannot be done from the
  CLI).** The provider pin, the `Qwen/Qwen3.5-9B` switch and the `<think>`
  stripping are **deployed**; what is not yet evidenced is that they behave as
  intended against the live endpoint. Qwen3.5-9B replaced BOTH previous models
  and no automated check covers how it talks.
  `Verify:` send one EN and one JA turn from a real room and read
  `metrics/hfPatient/events` — `promptVersion` must be `modA-llm@2.5` and the
  recorded `provider` must be `ovhcloud`. The function stores the
  `x-inference-provider` response header, so that field is the only end-to-end
  proof that the pin took effect; a stub-patient reply instead means the model
  is not served by the pinned provider.
  `Verify:` `grep PROMPT_VERSION docs/.../functions/index.js` and compare with
  the `promptVersion` field on recent `metrics/hfPatient/events` entries.
- Six i18n strings interpolate `{patientName}` (`modA.chart.title`,
  `modA.chart.team-click-warning`, `modA.chat.disclosure`,
  `modA.chat.placeholder`, `modA.chat.thinking`, `modA.coach.read-case`).
  `modA.chat.disclosure` reaches an `innerHTML` sink, so it is DOMPurify-
  sanitised in `modA-llm-init.js` — the name is scenario-authored, i.e. untrusted.

