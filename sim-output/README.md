# Simulation output

This folder collects the artefacts produced by `scripts/sim/simulate-session.js` —
a headless dry-run of a full CaNaMED workshop (2 facilitators + 8 students,
4 stages). The harness is checked in; each run's screenshots and markdown
report are local artefacts and **not** committed (see `.gitignore`).

## How to run

```sh
# in one shell, start the static server
node scripts/serve-platform.js

# in another shell, run the simulation
node scripts/sim/simulate-session.js
```

The simulation drives all 10 personas through a real workshop in a single
shared `BrowserContext` (so the platform's LocalDB syncs cross-tab the way
it does in production via Firebase). Mode: LOCAL — no real Firebase
traffic, no real student data.

## What you get back

- `feedback-<timestamp>.md` — one section per persona with per-step
  observations: active view (`#splash` / `#lobby` / `#waiting` / `#app` /
  `#admin-app` / `#session-ended`), stage indicator text, number of
  visible buttons, scroll depth (in viewport heights), presence count,
  any console errors, and persona-flavoured reactions derived from
  their traits (anxious / fluent / time-pressed / etc).
- `screens-<timestamp>/*.png` — a screenshot at each milestone for every
  persona (lobby, waiting, stage 0, stage 1, …, wrap-up, ended).
- Executive-summary block at the top of the markdown report listing
  pass/fail counts, personas with at least one failed step, and
  cross-cutting issues (red banners, JS errors, >18-button views,
  >4× viewport scroll).

## Personas

- **Lead facilitator (F1)** — Dr Aleksic. Creates the session, starts it,
  advances rooms, closes the session.
- **Co-facilitator (F2)** — Dr Chrétien. Joins via the lobby's
  `I am a facilitator` toggle + admin password.
- **Room 1 (S1–S4)** — Marie (Caen Y5 C2), Yuki (Nagoya Y5 B2),
  Pierre (Caen Y4 C1), Hana (Nagoya Y4 B1).
- **Room 2 (S5–S8)** — Sara (Caen Y6 C2), Akari (Nagoya Y6 C1),
  Léo (Caen Y3 B2), Kenta (Nagoya Y4 A2).

The eight students mix universities, years, English levels (A2 → C2), and
personality traits (enthusiastic, anxious, thoughtful, distracted,
explorer, leader, low-English) so the reactions vary across stages.

## Caveats

- LocalDB rides `storage` events, which only fire within a single browsing
  context. The harness uses one shared `chromium.newContext()` and opens
  10 pages inside it — different from production (per-user Firebase
  auth) but the cross-tab sync surface is the same code path.
- The harness doesn't actually drive each persona through their full
  per-stage interactions (writing answers, clicking decisions, voting).
  Personas categorised as `explorer` / `contributor` / `leader` click a
  visible tab to surface friction; the rest observe passively. The
  observations focus on whether the platform's state machine moved
  forward at every step, not on per-stage gameplay.
- Persona reactions are heuristic (derived from snapshot metrics +
  traits) — they're a structured proxy for what a real student would
  plausibly say, not a transcript.
