# Simulation output

This folder collects the artefacts produced by `scripts/sim/simulate-session.js` —
a headless dry-run of a full CaNaMED workshop. The harness is checked in; each
run's screenshots and markdown report are local artefacts and **not** committed
(see `.gitignore`).

Two run modes are supported:

| Mode | Backend | When to use |
|------|---------|-------------|
| **LocalDB** (default) | localStorage-backed pseudo-Firebase | Quick smoke runs, no external deps. Cross-tab sync is dodgy at 24-tab scale (storage-event drops). |
| **Emulator** | Real Firebase RTDB + Auth emulators (`firebase-tools`) | Reliable cross-tab propagation at any scale. Required for stage-advance / presence assertions. Needs JDK 11+. |

## How to run — LocalDB mode

```sh
# in one shell, start the static server
node scripts/serve-platform.js

# in another shell, run the simulation
node scripts/sim/simulate-session.js
```

## How to run — Emulator mode (recommended)

```sh
# single command — boots the Firebase emulator + static server +
# runs the sim, then tears everything down on exit.
npm run sim:emulator

# bigger cohort:
SIM_STUDENTS=24 SIM_ROOM_COUNT=6 npm run sim:emulator
```

Knobs (env vars, override per run):

```
SIM_STUDENTS=N        # number of student personas drawn from STUDENTS_FULL (1..24)
SIM_ROOM_COUNT=N      # rooms to set on the admin prestart panel (1..8)
SIM_DB_PORT=9000      # Firebase RTDB emulator port (default 9000)
SIM_AUTH_PORT=9099    # Firebase Auth emulator port (default 9099)
```

`npm run emulator` starts just the Firebase emulator suite (no sim) so you can
poke around in a browser yourself. Hit `http://localhost:8765` after running
`SIM_EMULATOR_MODE=1 node scripts/serve-platform.js` in another shell.

### Why the emulator path matters

The original LocalDB sim hit two reliability ceilings around 24 tabs:

1. **Cross-tab storage events are not delivered reliably under heavy load.**
   With 24 student tabs all writing presence + room-stage simultaneously,
   Chromium occasionally drops the `storage` event to one of the listening
   tabs. Real Firebase rides WebSockets and does not have this failure mode.
2. **Stage-advance signals never landed on most tabs.** Same root cause —
   the admin's `setRoomStage` write produced a storage event most tabs missed.

With the emulator backend:

- **24 students × 6 rooms × 4 stages — 154/154 observations pass** (vs the
  LocalDB run where 1 student dropped out and no stage advanced at all).
- **Presence syncs across all tabs:** every student sees the 3 roommates
  (`presence: 4` in the report).
- **All 4 stages reached** (Welcome → Module A → Module B → Wrap-up).

### Wiring details

- `scripts/sim/sim-with-emulator.js` is the orchestrator. It boots
  the platform static server with `SIM_EMULATOR_MODE=1` (which relaxes
  the dev-only CSP to allow `http/ws://127.0.0.1:*`), starts the
  Firebase emulator suite via `npx firebase emulators:start
  --only=database,auth`, then runs `simulate-session.js`.
- `simulate-session.js` pins `window.CANAMED_EMULATOR =
  {host, dbPort, authPort}` on every tab's `addInitScript`. The
  platform's `dbInit()` reads that descriptor and calls
  `database.useEmulator(host, port)` + `auth.useEmulator(url)` so all
  Firebase traffic re-routes to localhost.
- `docs/Third_session/PBL_platform/database.rules.json` uses `\s` in
  one regex which the emulator's stricter parser rejects. The wrapper
  generates `database.rules.emulator.json` with `\t\n\r ` instead —
  production rules are unmodified.

## What you get back

- `feedback-<timestamp>.md` — one section per persona with per-step
  observations: active view (`#splash` / `#lobby` / `#waiting` / `#app` /
  `#admin-app` / `#session-ended`), stage indicator text, number of
  visible buttons, scroll depth (in viewport heights), presence count,
  room name, any console errors, and persona-flavoured reactions
  derived from their traits (anxious / fluent / time-pressed / etc).
- `screens-<timestamp>/*.png` — a screenshot at each milestone for every
  persona (lobby, waiting, stage 0, stage 1, …, wrap-up, ended).
- Executive-summary block at the top of the report listing pass/fail
  counts, personas with at least one failed step, and cross-cutting
  issues (red banners, JS errors, >18-button views, >4× viewport
  scroll).

## Personas

The harness ships 24 personas split 12 Caen / 12 Nagoya across years 3-6 and
English levels A2-C2. The default cohort is 8 (the first 8 in the list); bump
to 16 or 24 via `SIM_STUDENTS=N`.

- **Lead facilitator (F1)** — Dr Aleksic.
- **Co-facilitators (F2-F4)** — Dr Chrétien, Dr Suzuki, Dr Renaud.
- **Room 1 baseline (S1–S4)** — Marie / Yuki / Pierre / Hana.
- **Room 2 baseline (S5–S8)** — Sara / Akari / Léo / Kenta.
- **Scaling (S9–S24)** — Juliette · Hiroshi · Antoine · Aiko · Camille ·
  Takeshi · Hugo · Sayaka · Manon · Ren · Théo · Mei · Sophie · Daichi ·
  Lucas · Yui.

Traits cover: enthusiastic, fluent_french, thoughtful,
second_language_caution, explorer, technical, anxious, needs_guidance,
time_pressed, skim_reader, leader, contributor, distracted, checks_phone,
struggling, low_english, engaged_but_quiet, methodical, writes_lots,
uses_glossary, first_timer, challenger, fluent_japanese_writer,
joke_teller, asks_many_questions, lurker_until_engaged,
translator_helper, competitive, checks_evidence, anti_overconfidence.

## Caveats

- The harness does NOT drive each persona through their full per-stage
  interactions (writing answers, clicking decisions, voting). Personas
  categorised as `explorer` / `contributor` / `leader` click a visible
  tab to surface friction; the rest observe passively.
- Persona reactions are heuristic-derived (from snapshot metrics + traits) —
  a structured proxy for what a real student would plausibly say, not a
  transcript.
- LocalDB mode is faster but unreliable for stage-advance + presence
  assertions at >8 tabs. Use emulator mode for anything load-related.
- Each emulator run wipes the in-memory RTDB at process exit; the sim
  reports are the only persistent record.
