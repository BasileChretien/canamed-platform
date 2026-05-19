#!/usr/bin/env node
/* scripts/sim/simulate-session.js
 *
 * Headless simulation of a full CaNaMED workshop:
 *   - 2 facilitators (lead creates the session, co joins the admin dashboard)
 *   - 8 students (4 per room, mix of Caen & Nagoya, varied English levels
 *     and personality traits)
 *   - 4 stages: Welcome → Module A → Module B → Wrap-up
 *
 * For each persona, the script captures detailed observations at every
 * stage: console errors, visible buttons, button-count overload, scroll
 * depth, time-on-stage, and persona-specific reactions (a quiet
 * observer reports different friction than an active leader). All
 * observations roll up into a markdown feedback report.
 *
 * Mode: LOCAL — CANAMED_FIREBASE pinned null so the platform uses
 * LocalDB (localStorage-backed pseudo-Firebase that syncs across tabs
 * in the same browser context). No real Firebase traffic.
 *
 * Usage:
 *   node scripts/serve-platform.js &           # in another shell
 *   node scripts/sim/simulate-session.js       # this script
 *
 * Output:
 *   sim-output/feedback-<timestamp>.md         # markdown report
 *   sim-output/screens-<timestamp>/*.png        # per-persona screenshots
 */

"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BASE_URL = process.env.SIM_BASE_URL || "http://127.0.0.1:8765";
const OUT_DIR = path.resolve(__dirname, "..", "..", "sim-output");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SCREEN_DIR = path.join(OUT_DIR, "screens-" + STAMP);
const REPORT_PATH = path.join(OUT_DIR, "feedback-" + STAMP + ".md");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SCREEN_DIR, { recursive: true });

/* ====================== personas ====================== */

/* Cohort knobs — bumped to a realistic full-classroom workshop in the
 * 2026-05-18 scaled run (24 students + 4 facilitators + 6 rooms).
 * Override via env vars when iterating:
 *   SIM_ROOM_COUNT=8 SIM_STUDENTS=32 node scripts/sim/simulate-session.js
 *
 * Caen × Nagoya pairing assumes an even split between universities;
 * the persona list below is hand-tuned to keep that 50/50 at 24
 * students. When SIM_STUDENTS overrides the count, the harness uses
 * the first N personas (so 12 = first 12, 16 = first 16, etc.). */
const SIM_ROOM_COUNT = parseInt(process.env.SIM_ROOM_COUNT || "6", 10);
const SIM_STUDENT_COUNT = parseInt(process.env.SIM_STUDENTS || "24", 10);

const FACILITATORS = [
  { id: "F1", role: "lead",
    name: "Dr Aleksic",   label: "E2E scaled sim — Franco-Japanese Workshop",
    pass: "sim-fac-pw-2026" },
  { id: "F2", role: "co", name: "Dr Chrétien", label: "" },
  { id: "F3", role: "co", name: "Dr Suzuki",   label: "" },
  { id: "F4", role: "co", name: "Dr Renaud",   label: "" }
];

const STUDENTS_FULL = [
  // ─── original 8 (covered the core trait surface in the 2-room sim) ───
  { id: "S1",  name: "Marie",     uni: "Caen",   year: 5, english: "C2",
    traits: ["enthusiastic", "fluent_french"] },
  { id: "S2",  name: "Yuki",      uni: "Nagoya", year: 5, english: "B2",
    traits: ["thoughtful", "second_language_caution"] },
  { id: "S3",  name: "Pierre",    uni: "Caen",   year: 4, english: "C1",
    traits: ["explorer", "technical"] },
  { id: "S4",  name: "Hana",      uni: "Nagoya", year: 4, english: "B1",
    traits: ["anxious", "needs_guidance"] },
  { id: "S5",  name: "Sara",      uni: "Caen",   year: 6, english: "C2",
    traits: ["time_pressed", "skim_reader"] },
  { id: "S6",  name: "Akari",     uni: "Nagoya", year: 6, english: "C1",
    traits: ["leader", "contributor"] },
  { id: "S7",  name: "Léo",       uni: "Caen",   year: 3, english: "B2",
    traits: ["distracted", "checks_phone"] },
  { id: "S8",  name: "Kenta",     uni: "Nagoya", year: 4, english: "A2",
    traits: ["struggling", "low_english"] },
  // ─── 16 new personas to scale the cohort to 12 Caen + 12 Nagoya ───
  { id: "S9",  name: "Juliette",  uni: "Caen",   year: 5, english: "C1",
    traits: ["engaged_but_quiet"] },
  { id: "S10", name: "Hiroshi",   uni: "Nagoya", year: 6, english: "B2",
    traits: ["methodical", "second_language_caution"] },
  { id: "S11", name: "Antoine",   uni: "Caen",   year: 4, english: "B2",
    traits: ["writes_lots", "contributor"] },
  { id: "S12", name: "Aiko",      uni: "Nagoya", year: 5, english: "B1",
    traits: ["uses_glossary", "needs_guidance"] },
  { id: "S13", name: "Camille",   uni: "Caen",   year: 3, english: "B2",
    traits: ["first_timer", "anxious"] },
  { id: "S14", name: "Takeshi",   uni: "Nagoya", year: 3, english: "A2",
    traits: ["struggling", "low_english"] },
  { id: "S15", name: "Hugo",      uni: "Caen",   year: 6, english: "C2",
    traits: ["challenger", "writes_lots"] },
  { id: "S16", name: "Sayaka",    uni: "Nagoya", year: 4, english: "C1",
    traits: ["fluent_japanese_writer", "thoughtful"] },
  { id: "S17", name: "Manon",     uni: "Caen",   year: 4, english: "C1",
    traits: ["joke_teller", "leader"] },
  { id: "S18", name: "Ren",       uni: "Nagoya", year: 5, english: "B2",
    traits: ["asks_many_questions", "explorer"] },
  { id: "S19", name: "Théo",      uni: "Caen",   year: 3, english: "B1",
    traits: ["lurker_until_engaged", "anxious"] },
  { id: "S20", name: "Mei",       uni: "Nagoya", year: 6, english: "C2",
    traits: ["translator_helper", "fluent_french"] },
  { id: "S21", name: "Sophie",    uni: "Caen",   year: 5, english: "C1",
    traits: ["challenger", "contributor"] },
  { id: "S22", name: "Daichi",    uni: "Nagoya", year: 4, english: "B2",
    traits: ["competitive", "leader"] },
  { id: "S23", name: "Lucas",     uni: "Caen",   year: 4, english: "B2",
    traits: ["checks_evidence", "methodical"] },
  { id: "S24", name: "Yui",       uni: "Nagoya", year: 5, english: "C1",
    traits: ["anti_overconfidence", "thoughtful"] }
];

const STUDENTS = STUDENTS_FULL.slice(0, Math.max(1, SIM_STUDENT_COUNT));

/* ====================== observation store ======================
 *
 * One row per (persona, step). At report time we group by persona.
 * Reactions are seeded from traits + measured signals (button count,
 * scroll depth, console errors, presence-list visibility). */

const observations = [];
function obs(persona, step, data) {
  observations.push(Object.assign({ persona, step, ts: Date.now() }, data));
}

/* ====================== helpers ====================== */

/* Single shared BrowserContext so LocalDB syncs across tabs (the
 * platform's LocalDB rides storage events, which fire only within the
 * same browsing context). All facilitator + student "tabs" live here. */
let _ctx = null;
async function getCtx(browser) {
  if (_ctx) return _ctx;
  _ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  // Emulator-mode wiring: when sim-with-emulator.js launches us with
  // SIM_EMULATOR_MODE=1, pin a Firebase web config that targets the
  // local emulator + a CANAMED_EMULATOR descriptor that dbInit() reads
  // to call useEmulator on the database + auth SDKs. This switches the
  // sim off LocalDB and onto the real Firebase code path (reliable
  // cross-tab sync via WebSocket).
  const useEmulator = process.env.SIM_EMULATOR_MODE === "1";
  const emuHost = process.env.SIM_EMULATOR_HOST || "127.0.0.1";
  const emuDbPort = parseInt(process.env.SIM_DB_PORT   || "9000", 10);
  const emuAuthPort = parseInt(process.env.SIM_AUTH_PORT || "9099", 10);

  await _ctx.addInitScript((cfg) => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
    }
    if (cfg.useEmulator) {
      // Minimal config — apiKey + databaseURL are enough for the SDK to
      // initialise; useEmulator() reroutes traffic to localhost.
      pin("CANAMED_FIREBASE", {
        apiKey: "fake-emulator-key",
        authDomain: cfg.host + ":" + cfg.authPort,
        databaseURL: "http://" + cfg.host + ":" + cfg.dbPort + "?ns=canamed-sim",
        projectId: "canamed-sim",
        appId: "1:0:web:sim"
      });
      pin("CANAMED_EMULATOR", {
        host: cfg.host, dbPort: cfg.dbPort, authPort: cfg.authPort
      });
    } else {
      pin("CANAMED_FIREBASE", null);
    }
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    pin("CANAMED_PERF_MONITORING", false);
    window.CANAMED_SUPERADMIN_KEY = "sim-super-admin";
    try {
      // suppress tours — they cover the real UI we want to observe
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
    } catch (e) {}
  }, { useEmulator, host: emuHost, dbPort: emuDbPort, authPort: emuAuthPort });
  if (useEmulator) {
    console.log("Sim: emulator mode ON (db=" + emuHost + ":" + emuDbPort +
      ", auth=" + emuHost + ":" + emuAuthPort + ")");
  }
  return _ctx;
}

async function newTab(browser, persona) {
  const ctx = await getCtx(browser);
  const page = await ctx.newPage();
  // Each tab in a shared context inherits the context's localStorage.
  // Strip any per-session crumbs from previous tabs so this persona
  // sees the splash entry view (not auto-resumed into someone else's
  // session). canamed_session is set by the facilitator's create flow;
  // each NEW student tab needs a clean splash.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("canamed_session");
      localStorage.removeItem("canamed_resume");
      localStorage.removeItem("canamed_name");
    } catch (e) {}
  });
  // capture console errors per page
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push("[pageerror] " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") page.__errors.push("[console.error] " + m.text());
  });
  page.on("dialog", async (d) => { try { await d.accept(); } catch (_) {} });
  // auto-confirm the in-page modal (Start / Advance / End-session)
  await page.addInitScript(() => {
    const tryAccept = () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg) new MutationObserver(tryAccept).observe(dlg, { attributes: true, attributeFilter: ["open"] });
      setInterval(tryAccept, 200);
    });
  });
  return { ctx, page };
}

async function shot(page, persona, stepName) {
  const fname = persona.id + "-" + stepName.replace(/[^a-z0-9-]/gi, "_") + ".png";
  const full = path.join(SCREEN_DIR, fname);
  try { await page.screenshot({ path: full, fullPage: false }); }
  catch (e) { /* might be closed */ }
  return fname;
}

/* Snapshot what's visible + measurable on the page right now. */
async function snapshot(page) {
  return page.evaluate(() => {
    const visible = el => el && !el.hidden && el.offsetParent !== null;
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .filter(visible)
      .map(b => (b.textContent || "").trim().slice(0, 40))
      .filter(t => t.length > 0)
      .slice(0, 30);
    const heading = (function () {
      // Prefer ordered, semantically-meaningful sources. Skip elements
      // that aren't actually painted (hidden / display:none). We avoid
      // generic h2 because the page has a "Settings" h2 in the global
      // settings panel that would otherwise win when the room view
      // hasn't appeared yet.
      const candidates = [
        "#stage-now", "#stage-indicator", "#room-name",
        "#admin-app:not(.hidden) h2", "#admin-app:not(.hidden) h3",
        "#waiting:not(.hidden) h2", "#waiting:not(.hidden) h3",
        "#session-ended:not(.hidden) h1",
        "#lobby:not(.hidden) h2",
        "#splash:not(.hidden) h1, #splash:not(.hidden) .splash-title"
      ];
      for (const sel of candidates) {
        const h = document.querySelector(sel);
        if (h && !h.hidden && h.offsetParent !== null) {
          const t = (h.textContent || "").trim();
          if (t) return t.slice(0, 120);
        }
      }
      return "";
    })();
    // Which top-level view is currently painted?
    const activeView = (function () {
      for (const id of ["splash", "lobby", "waiting", "app", "admin-app", "session-ended"]) {
        const e = document.getElementById(id);
        if (e && !e.classList.contains("hidden") && e.offsetParent !== null) {
          return id;
        }
      }
      return "?";
    })();
    const scrollH = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight, 0
    );
    const view = window.innerHeight || 0;
    const hasError = !!document.querySelector(
      ".splash-hint.err, .lobby-hint.err, [class*='err'][class*='visible']"
    );
    const presence = (function () {
      const b = document.getElementById("presence-bar");
      return b ? b.children.length : 0;
    })();
    const roomName = (function () {
      const e = document.getElementById("room-name");
      return e ? (e.textContent || "").trim() : "";
    })();
    const stageNow = (function () {
      const e = document.getElementById("stage-now");
      return e ? (e.textContent || "").trim().slice(0, 120) : "";
    })();
    return {
      url: location.href,
      title: document.title,
      activeView, roomName,
      visibleButtons, heading, stageNow,
      scrollH, view, scrollRatio: view ? +(scrollH / view).toFixed(2) : 0,
      hasError, presence
    };
  }).catch(() => ({ visibleButtons: [], heading: "[snapshot-failed]" }));
}

/* Persona reactions are derived from the snapshot + persona traits +
 * the current stage. Returns 1-3 short first-person quotes that this
 * kind of person would plausibly say in this moment. The catalogue
 * below is intentionally wide so the same heuristic seldom fires the
 * same line for two personas in a row — variation is the point. */
function reactionsFrom(persona, snap, durationMs, stepName) {
  const r = [];
  const tr = persona.traits || [];
  const has = t => tr.includes(t);
  const btnCount = (snap.visibleButtons || []).length;
  const stage = _stageOf(snap, stepName);

  // ── universal: visible errors / loading slowness ─────────────
  if (snap.hasError) {
    r.push("I see a red error message — am I supposed to do something?");
  }
  if (durationMs > 8000) {
    if (has("distracted"))   r.push("Took a while to load. I checked my phone.");
    if (has("anxious"))      r.push("Why is it so slow — did I break it?");
    if (has("time_pressed")) r.push("Come on, come on. This is dragging.");
  }
  if (durationMs < 1500 && has("thoughtful")) {
    r.push("Fast — but I want a moment to read before the screen changes.");
  }

  // ── button-count overload ────────────────────────────────────
  if (btnCount >= 18) {
    if (has("anxious"))    r.push("There are " + btnCount + " buttons on this page. I freeze a bit.");
    if (has("low_english")) r.push("Too many words. I want to click the wrong thing by mistake.");
    if (has("first_timer")) r.push("I've never used this kind of platform — where do I look first?");
    if (has("uses_glossary")) r.push("I keep my dictionary tab open — there's a lot of medical English here.");
  }
  if (btnCount <= 4 && has("explorer")) {
    r.push("Only " + btnCount + " visible buttons — am I missing a tab?");
  }

  // ── scroll depth ─────────────────────────────────────────────
  if (snap.scrollRatio >= 3) {
    if (has("time_pressed")) r.push("This page is " + snap.scrollRatio + "× tall. I'm scrolling, not reading.");
    if (has("anxious"))      r.push("Do I have to read all of this?");
    if (has("skim_reader"))  r.push("Scrolling. Reading bullet points only.");
  }

  // ── presence (sense of who's in the room) ────────────────────
  if (snap.presence === 1 && has("contributor")) {
    r.push("I see no one else in my room yet — is anyone here?");
  }
  if (snap.presence >= 2 && snap.presence <= 4) {
    if (has("leader"))      r.push("I can see " + snap.presence + " of us. Let me start the conversation.");
    if (has("competitive")) r.push(snap.presence + " in the room — we can move faster than the others.");
    if (has("joke_teller")) r.push("Small enough room. I'll loosen the mood with a quick joke.");
  }
  if (snap.presence > 4) {
    if (has("engaged_but_quiet")) r.push("Big group — I'd rather listen before speaking.");
    if (has("lurker_until_engaged")) r.push("I'll lurk. If someone asks me directly, I'll answer.");
  }

  // ── language / metacommentary ────────────────────────────────
  if (has("fluent_french") && /Module A|Module B|Wrap-up/.test(snap.heading)) {
    r.push("OK, on attaque " + (snap.heading.match(/(Module [AB]|Wrap-up)/) || ["la suite"])[0] + ".");
  }
  if (has("second_language_caution") && /Module|Wrap/.test(snap.heading)) {
    r.push("Let me re-read the heading to be sure I understand.");
  }
  if (has("translator_helper") && snap.presence >= 2) {
    r.push("I'll quietly translate the harder words for whoever needs it.");
  }
  if (has("fluent_japanese_writer") && stage === "moduleA") {
    r.push("I'll write the case notes in clear English — the others can build on what I type.");
  }

  // ── stage-specific commentary ────────────────────────────────
  if (stage === "welcome") {
    if (has("first_timer"))     r.push("Welcome screen is calm — good. I needed a moment.");
    if (has("technical"))       r.push("'Save name' makes sense — I assume our team name shows up everywhere.");
    if (has("methodical"))      r.push("Stage 1 of 4 — clear progress indicator. I like knowing where we are.");
    if (has("asks_many_questions")) r.push("Where do I see the pre-test? Is it the button or do I scroll?");
  }
  if (stage === "moduleA") {
    if (has("technical"))      r.push("History / Examination / Investigations — same shape as a real consultation chart.");
    if (has("methodical"))     r.push("I'll work through history first, then examination, then investigations. Top-down.");
    if (has("writes_lots"))    r.push("Lots of typing fields. I'll capture everything we say.");
    if (has("checks_evidence")) r.push("I want to cite NICE / HAS for at least one of our answers. Let me find a reference.");
    if (has("challenger"))     r.push("I'd push back on opioids first-line — is anyone else uncomfortable with that?");
    if (has("low_english"))    r.push("Some of the question wording is hard. I'd benefit from a glossary tooltip.");
    if (btnCount >= 25 && has("anxious")) {
      r.push("So many history buttons. Could we collapse the section once we've finished it?");
    }
  }
  if (stage === "moduleB") {
    if (has("anxious"))        r.push("Bad news roleplay. I really hope I'm not the physician.");
    if (has("leader"))         r.push("I'll volunteer as physician. Someone has to.");
    if (has("joke_teller"))    r.push("OK, no jokes during the diagnosis. Save them for after.");
    if (has("challenger"))     r.push("If the family asks me to withhold, I'll respectfully refuse — patient first.");
    if (has("anti_overconfidence")) r.push("I don't think SPIKES alone is enough. We should ask the patient what they want first.");
    if (has("translator_helper")) r.push("If anyone gets stuck on a phrase, I'll whisper a translation.");
    if (has("competitive"))    r.push("I want our roleplay to be the best of the day. Setting that bar.");
  }
  if (stage === "wrapup") {
    if (has("methodical"))     r.push("Wrap-up. I want to see what we got right — show me the scoreboard.");
    if (has("writes_lots"))    r.push("Can I export our group's notes? I want to keep them for revision.");
    if (has("anxious"))        r.push("Did I do enough? I'm not sure how the scoring works.");
    if (has("contributor"))    r.push("I want a chance to give feedback on the case — that was rich.");
    if (has("first_timer"))    r.push("That went faster than I expected. I'd do another one.");
  }

  return r.slice(0, 3);
}

/* Map a sim step name like "stage-1-moduleA" to a coarse stage key
 * the reaction templates can switch on. */
function _stageOf(snap, stepName) {
  if (!snap) return "?";
  const txt = (snap.stageNow || snap.heading || "").toLowerCase();
  if (/wrap/.test(txt)) return "wrapup";
  if (/breaking|roleplay|spikes|bad news/.test(txt)) return "moduleB";
  if (/case up|chart|opioid|differential|chronic/.test(txt)) return "moduleA";
  if (/opening|welcome|presentation|team below/.test(txt)) return "welcome";
  if (typeof stepName === "string") {
    if (/wrapup|ended/.test(stepName))   return "wrapup";
    if (/moduleB/.test(stepName))         return "moduleB";
    if (/moduleA/.test(stepName))         return "moduleA";
    if (/stage-0|welcome|waiting/.test(stepName)) return "welcome";
  }
  return "?";
}

/* ─────────────────── post-session reflection ─────────────────────
 *
 * After the sim, summarise each persona's whole journey into a
 * short "what worked / what frustrated me / what I'd change" bundle.
 * The synthesizer reads the persona's observations + their traits and
 * produces 1-3 items per category. Where heuristics fire is what
 * surfaces — silence in a category means the persona didn't hit a
 * trigger threshold there. */
function reflectOnSession(persona, personaObs) {
  const tr = persona.traits || [];
  const has = t => tr.includes(t);

  // ── analyse the journey ─────────────────────────────────────
  const stagesSeen = new Set();
  let maxButtons = 0;
  let maxScroll = 0;
  let presenceSeenInRoom = 0;
  let everSawError = false;
  let everSawWrapup = false;
  let everJoined = false;
  let everReachedRoom = false;
  let stepsCount = 0;
  let slowSteps = 0;
  for (const o of personaObs) {
    stepsCount++;
    if (o.snapshot) {
      if (o.snapshot.heading) stagesSeen.add(_stageOf(o.snapshot, o.step));
      if (Array.isArray(o.snapshot.visibleButtons)) {
        maxButtons = Math.max(maxButtons, o.snapshot.visibleButtons.length);
      }
      if (typeof o.snapshot.scrollRatio === "number") {
        maxScroll = Math.max(maxScroll, o.snapshot.scrollRatio);
      }
      if (typeof o.snapshot.presence === "number" &&
          o.snapshot.activeView === "app") {
        presenceSeenInRoom = Math.max(presenceSeenInRoom, o.snapshot.presence);
      }
      if (o.snapshot.hasError) everSawError = true;
    }
    if (o.step === "join-lobby-to-waiting" && o.ok) everJoined = true;
    if (o.step === "stage-0-welcome-arrived" && o.ok) everReachedRoom = true;
    if (o.step === "session-ended-observed" && o.ok) everSawWrapup = true;
    if (o.durationMs && o.durationMs > 6000) slowSteps++;
  }

  const liked = [];
  const frustrated = [];
  const improvements = [];

  // ── liked / praised ─────────────────────────────────────────
  if (everJoined) {
    if (has("first_timer"))    liked.push("Joining was straightforward — code, name, consent, done.");
    if (has("anxious"))        liked.push("I didn't have to make an account. That lowered my barrier.");
  }
  if (everReachedRoom && presenceSeenInRoom >= 2) {
    if (has("contributor"))    liked.push("Once we were in the room I could see who I was with — that felt collaborative.");
    if (has("translator_helper")) liked.push("Small room (" + presenceSeenInRoom + " people) made it easy to help others quietly.");
  }
  if (stagesSeen.has("moduleA")) {
    if (has("methodical"))     liked.push("Module A's chart shape mirrored a real consultation note. Mental model travelled.");
    if (has("checks_evidence")) liked.push("Having reference cards inside the case (not in a separate tab) saved context-switching.");
    if (has("writes_lots"))    liked.push("The four-bullet group-answers form gave my notes a place to land.");
  }
  if (stagesSeen.has("moduleB")) {
    if (has("leader"))         liked.push("The role chips made volunteering low-friction — I clicked and we got going.");
    if (has("contributor"))    liked.push("SPIKES + the useful sentences strip was a quiet scaffold without holding our hands.");
    if (has("anti_overconfidence")) liked.push("The safety-note framing 'this is a simulation, feelings are real' is the right tone.");
  }
  if (everSawWrapup) {
    if (has("methodical"))     liked.push("Wrap-up landed cleanly — I knew when the session was done.");
  }

  // ── frustrated / criticised ──────────────────────────────────
  if (!everReachedRoom && everJoined) {
    frustrated.push("I joined the waiting room but never got moved to a room. I sat staring at 'You have joined'.");
  }
  if (maxButtons >= 25) {
    if (has("anxious") || has("low_english")) {
      frustrated.push("Module A pages had ~" + maxButtons + " visible buttons at peak. I couldn't tell what mattered.");
    }
    if (has("first_timer")) {
      frustrated.push("First-timer + " + maxButtons + " buttons = I clicked things at random for a while.");
    }
  }
  if (maxScroll >= 4) {
    if (has("anxious") || has("first_timer") || has("low_english")) {
      frustrated.push("Some pages were " + maxScroll + "× the screen height. Scrolling broke my focus.");
    }
    if (has("checks_phone") || has("distracted")) {
      frustrated.push("I lose attention on long pages — I scrolled past stuff I shouldn't have.");
    }
  }
  if (presenceSeenInRoom < 2 && everReachedRoom) {
    frustrated.push("Felt alone in my 'room' — wasn't sure if my partner was actually online.");
  }
  if (everSawError) {
    frustrated.push("There was a red message on screen at one point and I never figured out if I caused it.");
  }
  if (slowSteps >= 2 && has("time_pressed")) {
    frustrated.push("Several transitions took 6+ seconds. That cuts into the 22-minute Module A budget.");
  }

  // ── improvement recommendations ──────────────────────────────
  if (maxButtons >= 25) {
    improvements.push("Could Module A let me collapse a chart section the moment I've ticked a 'done' box? Less scroll, same info.");
  }
  if (maxScroll >= 4) {
    improvements.push("Sticky right-column (Findings + Decisions + Discussion) so the case panels can scroll without losing the working answers.");
  }
  if (has("low_english")) {
    improvements.push("Hover a medical phrase → see plain-English + Japanese gloss in a tooltip.");
  }
  if (has("uses_glossary")) {
    improvements.push("A '?' icon next to each clinical button that explains the term in one line, English + JP.");
  }
  if (has("first_timer")) {
    improvements.push("A 30-second guided walkthrough of Module A's chart on first entry. Skip-able.");
  }
  if (has("methodical")) {
    improvements.push("Show me my team's progress against the four bullets at the top of Module A — checkbox style.");
  }
  if (has("competitive")) {
    improvements.push("A small per-room progress bar against the other rooms (without exposing 'which room is winning').");
  }
  if (has("checks_evidence")) {
    improvements.push("Inline citation badges (NICE 2021, HAS 2023…) on each finding so we can argue from sources.");
  }
  if (has("writes_lots") || has("methodical")) {
    improvements.push("Let me export my team's group-answers + transcript as a markdown file at the end.");
  }
  if (has("challenger") || has("contributor")) {
    improvements.push("A 'disagree' button on a teammate's answer that opens a counter-bullet — keeps debate visible.");
  }
  if (has("anxious") || has("first_timer")) {
    improvements.push("A 'I'm not ready' panic button that just lets me move into an observer slot for the rest of this stage.");
  }
  if (has("translator_helper") || has("fluent_japanese_writer")) {
    improvements.push("A private side-chat with just my room (separate from group-answers) for clarifying questions.");
  }
  if (everSawWrapup && (has("contributor") || has("leader"))) {
    improvements.push("End-of-session quick poll: 'What was the hardest moment?' + 'One word that describes how you felt.'");
  }
  if (everSawWrapup && has("checks_evidence")) {
    improvements.push("Show me the full debate transcript — I'd re-read it for revision.");
  }

  // de-duplicate within each bucket while preserving order
  const uniq = arr => Array.from(new Set(arr));
  return {
    liked: uniq(liked).slice(0, 4),
    frustrated: uniq(frustrated).slice(0, 4),
    improvements: uniq(improvements).slice(0, 5),
    journey: {
      stagesSeen: Array.from(stagesSeen),
      maxButtons,
      maxScroll,
      presenceSeenInRoom,
      everReachedRoom,
      everSawWrapup,
      everSawError,
      stepsCount,
      slowSteps
    }
  };
}

/* ─────────────────── cross-cutting recommendations ──────────────
 *
 * Aggregate every persona's improvement list into a few thematic
 * buckets the user can act on. Items mentioned by >= 3 personas float
 * to the top of the "Themes raised by multiple personas" section. */
function buildRecommendations(perPersonaReflections) {
  const counts = new Map();
  for (const [persona, refl] of perPersonaReflections) {
    for (const item of refl.improvements) {
      const cur = counts.get(item) || { count: 0, personas: [] };
      cur.count++;
      cur.personas.push(persona.split(" (")[0]);
      counts.set(item, cur);
    }
  }
  const byCount = Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count);

  // Heuristic bucketing: short ones with words like "collapse / sticky /
  // tooltip / glossary / checkbox" are "quick wins"; "side-chat / panic
  // button / poll" are "structural"; everything else "content / scaffolding".
  const isQuickWin = s => /collapse|sticky|tooltip|gloss|checkbox|badge|export|skip-able|skip-able/i.test(s);
  const isStructural = s => /side-chat|panic|poll|guided walkthrough|disagree|counter-bullet|export|transcript/i.test(s);

  const themes = [];
  const quickWins = [];
  const structural = [];
  const other = [];
  for (const [item, info] of byCount) {
    const row = { item, count: info.count,
      personas: Array.from(new Set(info.personas)).slice(0, 6) };
    if (info.count >= 3) themes.push(row);
    if (isQuickWin(item))         quickWins.push(row);
    else if (isStructural(item))  structural.push(row);
    else                          other.push(row);
  }
  return { themes, quickWins, structural, other };
}

/* ====================== flow ====================== */

(async () => {
  console.log("Sim: launching chromium…");
  const browser = await chromium.launch({ headless: true });

  // ---- Tab F1: lead facilitator creates the session
  const F1 = FACILITATORS[0];
  const { ctx: ctxF1, page: pageF1 } = await newTab(browser, F1);
  console.log("Sim: lead facilitator (" + F1.name + ") creating session…");
  const tStart = Date.now();
  await pageF1.goto(BASE_URL + "/");
  await pageF1.locator("#splash-go-create").click();
  await pageF1.locator("#splash-create-name").fill(F1.name);
  await pageF1.locator("#splash-create-label").fill(F1.label);
  await pageF1.locator("#splash-create-pass").fill(F1.pass);
  await pageF1.locator("#splash-create-submit").click();
  // wait for the code to appear; on failure dump the page state + console
  // errors so the emulator wiring is debuggable.
  try {
    await pageF1.waitForFunction(() =>
      /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(
        (document.getElementById("splash-shown-code").textContent || "").trim()
      ), { timeout: 15000 });
  } catch (e) {
    const debug = await pageF1.evaluate(() => ({
      MODE: typeof MODE !== "undefined" ? MODE : "?",
      hasFb: typeof firebase !== "undefined",
      fbApps: typeof firebase !== "undefined" && firebase.apps ? firebase.apps.length : null,
      fbConfig: window.CANAMED_FIREBASE,
      emuConfig: window.CANAMED_EMULATOR,
      splashCode: document.getElementById("splash-shown-code")?.textContent,
      hint: document.getElementById("splash-create-hint")?.textContent,
      currentView: Array.from(document.querySelectorAll(".splash-view"))
        .find(v => !v.hidden)?.id
    }));
    console.error("Sim debug: createSession never produced a code. State:",
      JSON.stringify(debug, null, 2));
    console.error("Sim debug: F1 captured errors:");
    (pageF1.__errors || []).slice(0, 20).forEach(s => console.error("  " + s));
    throw e;
  }
  const CODE = (await pageF1.locator("#splash-shown-code").textContent()).trim();
  console.log("Sim: session code = " + CODE);
  obs(F1.name + " (lead facilitator)", "create-session",
    { ok: true, code: CODE, durationMs: Date.now() - tStart,
      reactions: ["Created session " + CODE + " — copying QR for the room screens."],
      screenshot: await shot(pageF1, F1, "01-created") });

  // Lead → admin dashboard
  await pageF1.locator("#splash-go-admin").click();
  await pageF1.locator("#admin-app").waitFor({ state: "visible", timeout: 8000 });
  obs(F1.name + " (lead facilitator)", "admin-dashboard-opened", {
    ok: true,
    snapshot: await snapshot(pageF1),
    reactions: ["Dashboard up. Now I need to wait for students to join."],
    screenshot: await shot(pageF1, F1, "02-dashboard")
  });

  // ---- Co-facilitators (F2..FN) join via lobby + admin password.
  // Each runs the same flow as a real co-fac: enter code, type name,
  // expand "I am a facilitator", type the admin password, click
  // "Open admin dashboard". The PR-#24 fixes (auto-fill name on empty,
  // scroll-into-view hint) mean an empty name is now tolerated — but
  // for the sim each co-fac types their own name so the audit trail
  // is clean.
  const coFacs = FACILITATORS.slice(1);
  const coFacTabs = [];
  for (const F of coFacs) {
    const { page } = await newTab(browser, F);
    coFacTabs.push({ F, page });
    console.log("Sim: co-facilitator (" + F.name + ") joining…");
    try {
      await page.goto(BASE_URL + "/");
      await page.locator("#splash-code").fill(CODE);
      await page.locator("#splash-enter").click();
      await page.locator("#name-input").waitFor({ state: "visible", timeout: 10000 });
      await page.locator("#name-input").fill(F.name);
      await page.locator("#admin-toggle").click();
      await page.locator("#admin-pass-input").waitFor({ state: "visible", timeout: 5000 });
      await page.locator("#admin-pass-input").fill(F1.pass);
      await page.locator("#join-admin-btn").click();
      await page.locator("#admin-app").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    } catch (e) {
      obs(F.name + " (co-facilitator)", "co-admin-join", {
        ok: false,
        error: String(e.message || e),
        reactions: ["Could not reach the admin dashboard — got an error on the lobby."],
        screenshot: await shot(page, F, "01-co-admin-failed")
      });
      continue;
    }
    const snap = await snapshot(page);
    obs(F.name + " (co-facilitator)", "co-admin-join", {
      ok: snap.activeView === "admin-app",
      snapshot: snap,
      reactions: snap.activeView === "admin-app"
        ? ["Joined the dashboard alongside the lead facilitator."]
        : ["Reached " + (snap.activeView || "an unknown view") +
            ", not the admin dashboard."],
      screenshot: await shot(page, F, "01-co-admin")
    });
  }

  // ---- N students join
  console.log("Sim: " + STUDENTS.length + " students joining the lobby…");
  const studentTabs = [];
  for (const s of STUDENTS) {
    const tJoin = Date.now();
    const { ctx, page } = await newTab(browser, s);
    const tab = { s, ctx, page, joined: false };
    studentTabs.push(tab);
    try {
      await page.goto(BASE_URL + "/");
      await page.locator("#splash-code").fill(CODE);
      await page.locator("#splash-enter").click();
      await page.locator("#name-input").waitFor({ state: "visible", timeout: 8000 });
      await page.locator("#name-input").fill(s.name);
      await page.locator("#uni-input").selectOption(s.uni);
      await page.locator("#year-input").selectOption(String(s.year));
      await page.locator("#english-input").selectOption(s.english);
      await page.locator("#consent-workshop").check();
      await page.locator("#join-btn").click({ timeout: 5000 });
      await page.locator("#waiting").waitFor({ state: "visible", timeout: 8000 });
      tab.joined = true;
      const snap = await snapshot(page);
      obs(s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")",
        "join-lobby-to-waiting", {
          ok: true,
          durationMs: Date.now() - tJoin,
          snapshot: snap,
          reactions: reactionsFrom(s, snap, Date.now() - tJoin, "join-lobby-to-waiting"),
          screenshot: await shot(page, s, "01-waiting"),
          errors: page.__errors.slice()
        });
    } catch (e) {
      obs(s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")",
        "join-lobby-to-waiting", {
          ok: false,
          error: String(e.message || e),
          durationMs: Date.now() - tJoin,
          reactions: ["Could not join — got an error before reaching the waiting room."],
          screenshot: await shot(page, s, "01-join-failed"),
          errors: page.__errors.slice()
        });
    }
  }

  // Set the room count BEFORE the pool fills — the admin dashboard
  // exposes a number-input / select that drives how many rooms get
  // created at Start time. For 24 students × 6 rooms we want 4/room.
  await pageF1.evaluate((rc) => {
    // The platform's dashboard uses different ids across versions for
    // this — try the most common ones and surface a no-op if none
    // matches (the default of 4 rooms is harmless even if we overshoot).
    const candidates = ["roomcount-input", "room-count-input",
      "prestart-room-count", "room-count-select", "admin-room-count"];
    for (const id of candidates) {
      const el = document.getElementById(id);
      if (el) {
        el.value = String(rc);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }, SIM_ROOM_COUNT);

  // wait for the admin pool counter to catch up before starting
  await pageF1.waitForFunction((expected) => {
    const e = document.getElementById("prestart-count");
    return e && parseInt(e.textContent, 10) >= expected;
  }, STUDENTS.length, { timeout: 30000 }).catch(() => {});
  const pre = await pageF1.locator("#prestart-count").textContent().catch(() => "?");
  const expected = String(STUDENTS.length);
  obs(F1.name + " (lead facilitator)", "pre-start-count", {
    ok: pre === expected,
    snapshot: { presence: parseInt(pre, 10) },
    reactions: pre === expected
      ? ["All " + expected + " students in the pool. Starting now with " +
          SIM_ROOM_COUNT + " rooms."]
      : ["Pool counter says " + pre + " — I expected " + expected +
          ". Starting anyway; some students may have joined slowly."]
  });

  // ---- Admin starts
  console.log("Sim: lead facilitator starts the session…");
  // Start-session also opens a canamedConfirm. Use the in-page wrapper
  // so the click + confirm don't race.
  await pageF1.evaluate(async () => {
    const btn = document.getElementById("start-session-btn");
    if (btn) btn.click();
    for (let i = 0; i < 50; i++) {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) { ok.click(); break; }
      }
      await new Promise(r => setTimeout(r, 100));
    }
  });
  // wait for each student to leave waiting and land in #app
  for (const tab of studentTabs) {
    const { s, page } = tab;
    if (!tab.joined) continue;   // skip students who never made the lobby
    const tEnter = Date.now();
    try {
      await page.locator("#app").waitFor({ state: "visible", timeout: 45000 });
      tab.inRoom = true;
      const snap = await snapshot(page);
      obs(s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")",
        "stage-0-welcome-arrived", {
          ok: true,
          durationMs: Date.now() - tEnter,
          snapshot: snap,
          reactions: reactionsFrom(s, snap, Date.now() - tEnter, "stage-0-welcome-arrived"),
          screenshot: await shot(page, s, "02-stage0")
        });
    } catch (e) {
      obs(s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")",
        "stage-0-welcome-arrived", {
          ok: false,
          error: String(e.message || e),
          reactions: ["I waited but my screen never changed. The other students seem to have moved on."],
          screenshot: await shot(page, s, "02-stage-stuck")
        });
    }
  }

  // ---- Advance through the 4 stages (admin clicks "Advance all")
  const STAGES = ["welcome", "moduleA", "moduleB", "wrapup"];
  for (let i = 1; i < STAGES.length; i++) {
    const stageName = STAGES[i];
    const tAdv = Date.now();
    console.log("Sim: advancing to " + stageName + " …");
    // dismiss any modal first
    await pageF1.evaluate(() => {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) ok.click();
      }
    });
    const advBtn = pageF1.locator("#advance-all-btn");
    if (await advBtn.isVisible().catch(() => false)) {
      // Wrap click + modal-confirm in a single in-page operation so we
      // don't race between Playwright's click resolution and the
      // page-level mutation observer.
      await pageF1.evaluate(async () => {
        document.getElementById("advance-all-btn").click();
        // Wait up to 5s for the confirm modal to appear; click OK.
        for (let i = 0; i < 50; i++) {
          const dlg = document.getElementById("canamed-modal");
          if (dlg && dlg.open) {
            const ok = document.getElementById("canamed-modal-confirm");
            if (ok) { ok.click(); break; }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        // Wait up to 2s for the modal to actually close.
        for (let i = 0; i < 20; i++) {
          const dlg = document.getElementById("canamed-modal");
          if (!dlg || !dlg.open) break;
          await new Promise(r => setTimeout(r, 100));
        }
      });
    }
    // give the cross-tab signal a moment to land on all 8 student tabs
    await new Promise(r => setTimeout(r, 4000));
    // capture an admin snapshot so we can see how the cohort progressed
    const adminSnap = await snapshot(pageF1);
    obs(F1.name + " (lead facilitator)",
      "admin-after-advance-" + stageName, {
        ok: true,
        snapshot: adminSnap,
        screenshot: await shot(pageF1, F1, "10-admin-after-" + stageName),
        reactions: ["I clicked Advance — let's see how the rooms move."]
      });
    for (const tab of studentTabs) {
      const { s, page } = tab;
      if (!tab.inRoom) continue;   // skip — they never reached the room
      const snap = await snapshot(page);
      const persona = s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")";
      // A "successful" stage observation = student is in #app + heading
      // changed to one of the stage labels (not stuck on a previous one).
      const inRoom = snap.activeView === "app";
      obs(persona, "stage-" + i + "-" + stageName, {
        ok: inRoom && !snap.hasError && !!snap.heading,
        snapshot: snap,
        reactions: reactionsFrom(s, snap, Date.now() - tAdv, "stage-" + i + "-" + stageName),
        screenshot: await shot(page, s, "03-stage" + i + "-" + stageName),
        errors: page.__errors.slice(-3)   // last 3 errors only
      });
      // Persona-specific micro-action: contributor / explorer / leader
      // try to actually interact with the stage to surface friction.
      if ((s.traits || []).includes("explorer") ||
          (s.traits || []).includes("contributor") ||
          (s.traits || []).includes("leader")) {
        try {
          // Click the first visible "Findings" / "Decisions" / module
          // tab if it exists. Best-effort; failures are observations.
          const tab = page.locator(".rcol-tab:visible, [data-tab]:visible").first();
          if (await tab.count() > 0) await tab.click({ timeout: 2000 }).catch(() => {});
        } catch (e) { /* observation only */ }
      }
    }
  }

  // ---- Close the session
  console.log("Sim: lead facilitator closing the session…");
  await pageF1.evaluate(async () => {
    const btn = document.getElementById("admin-close-btn");
    if (btn) btn.click();
    for (let i = 0; i < 60; i++) {
      const dlg = document.getElementById("canamed-modal");
      if (dlg && dlg.open) {
        const ok = document.getElementById("canamed-modal-confirm");
        if (ok) { ok.click(); break; }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    // Some flows trigger a download which itself opens a second confirm
    // about the archive. Click any second confirm too.
    await new Promise(r => setTimeout(r, 800));
    const dlg2 = document.getElementById("canamed-modal");
    if (dlg2 && dlg2.open) {
      const ok = document.getElementById("canamed-modal-confirm");
      if (ok) ok.click();
    }
  });
  // give close-session a moment to propagate
  await new Promise(r => setTimeout(r, 3000));
  obs(F1.name + " (lead facilitator)", "close-session", {
    ok: true,
    reactions: ["Closed the session. Archive download triggered. " +
      "Students should now see the wrap-up screen."],
    screenshot: await shot(pageF1, F1, "99-closed")
  });

  // each student observes the session-ended screen
  for (const { s, page } of studentTabs) {
    await new Promise(r => setTimeout(r, 600));
    const ended = await page.locator("#session-ended").isVisible().catch(() => false);
    const persona = s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")";
    obs(persona, "session-ended-observed", {
      ok: ended,
      reactions: ended
        ? ["The wrap-up screen showed up. Got it."]
        : ["The facilitator said it was over but my screen still shows the room."]
    });
  }

  console.log("Sim: writing report…");
  writeReport();
  console.log("Sim: done. Closing browser.");
  await browser.close();
})().catch(err => {
  console.error("Sim FAILED:", err);
  try { writeReport({ fatalError: String(err) }); } catch (_) {}
  process.exit(1);
});

/* ====================== report writer ====================== */

function writeReport(extra) {
  extra = extra || {};
  const lines = [];
  lines.push("# CaNaMED — full-session simulation feedback");
  lines.push("");
  lines.push("**Generated:** " + new Date().toISOString());
  lines.push("**Cohort:** 2 facilitators + 8 students (4 per room, Caen × Nagoya).");
  lines.push("**Mode:** LOCAL (LocalDB, no real Firebase).");
  lines.push("**Screenshots:** `" + path.relative(path.dirname(REPORT_PATH), SCREEN_DIR) + "/`");
  if (extra.fatalError) {
    lines.push("");
    lines.push("> **FATAL:** simulation aborted — `" + extra.fatalError + "`");
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // group by persona
  const byPersona = {};
  observations.forEach(o => {
    (byPersona[o.persona] = byPersona[o.persona] || []).push(o);
  });

  // ===== executive summary =====
  lines.push("## Executive summary");
  lines.push("");
  const totals = { ok: 0, fail: 0 };
  observations.forEach(o => { if (o.ok) totals.ok++; else totals.fail++; });
  lines.push("- " + totals.ok + " observations passed, " + totals.fail + " failed.");
  const failPersonas = new Set();
  observations.forEach(o => { if (!o.ok) failPersonas.add(o.persona); });
  if (failPersonas.size) {
    lines.push("- Personas with at least one failed step: " +
      Array.from(failPersonas).join(", ") + ".");
  } else {
    lines.push("- Every persona completed every step.");
  }
  // cross-cutting issues
  const issues = [];
  observations.forEach(o => {
    if (o.snapshot && o.snapshot.hasError) issues.push(o.persona + " @ " + o.step + ": red error banner visible");
    if (o.errors && o.errors.length) {
      o.errors.slice(0, 2).forEach(e => issues.push(o.persona + " @ " + o.step + ": " + e.slice(0, 120)));
    }
    if (o.snapshot && o.snapshot.scrollRatio > 4) {
      issues.push(o.persona + " @ " + o.step + ": page is " +
        o.snapshot.scrollRatio + "× viewport tall");
    }
    if (o.snapshot && Array.isArray(o.snapshot.visibleButtons) &&
        o.snapshot.visibleButtons.length > 18) {
      issues.push(o.persona + " @ " + o.step +
        ": " + o.snapshot.visibleButtons.length + " buttons visible at once");
    }
  });
  if (issues.length) {
    lines.push("");
    lines.push("**Cross-cutting issues observed:**");
    Array.from(new Set(issues)).slice(0, 25).forEach(i => lines.push("- " + i));
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ===== persona-name → persona-object lookup, so reflectOnSession
  // can read the traits when summarising a journey =====
  const _allActors = STUDENTS.concat(FACILITATORS);
  function _findPersona(personaName) {
    const justName = String(personaName || "").split(" (")[0];
    return _allActors.find(p => p.name === justName) || { traits: [] };
  }

  // Build reflections up front so the recommendations roll-up can
  // aggregate across personas.
  const perPersonaReflections = [];
  for (const persona of Object.keys(byPersona)) {
    const refl = reflectOnSession(_findPersona(persona), byPersona[persona]);
    perPersonaReflections.push([persona, refl]);
  }
  const recs = buildRecommendations(perPersonaReflections);

  // ===== cross-cutting recommendations (front-loaded so it's the
  //       first thing the user sees after the executive summary) =====
  lines.push("## Recommendations & criticism — rolled up");
  lines.push("");
  if (!recs.themes.length && !recs.quickWins.length && !recs.structural.length && !recs.other.length) {
    lines.push("_No personas hit a recommendation trigger this run._");
    lines.push("");
  } else {
    if (recs.themes.length) {
      lines.push("**Themes raised by multiple personas** _(count = personas who flagged it)_:");
      recs.themes.forEach(t => {
        lines.push("- **(" + t.count + ")** " + t.item +
          "  — _" + t.personas.join(", ") + "_");
      });
      lines.push("");
    }
    if (recs.quickWins.length) {
      lines.push("**Quick wins** _(small UX changes, narrow blast radius)_:");
      recs.quickWins.forEach(t => {
        lines.push("- " + t.item +
          " — flagged by " + t.count + ": _" + t.personas.join(", ") + "_");
      });
      lines.push("");
    }
    if (recs.structural.length) {
      lines.push("**Structural ideas** _(new affordances / new flows)_:");
      recs.structural.forEach(t => {
        lines.push("- " + t.item +
          " — flagged by " + t.count + ": _" + t.personas.join(", ") + "_");
      });
      lines.push("");
    }
    if (recs.other.length) {
      lines.push("**Other suggestions**:");
      recs.other.forEach(t => {
        lines.push("- " + t.item +
          " — flagged by " + t.count + ": _" + t.personas.join(", ") + "_");
      });
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ===== per-persona feedback =====
  lines.push("## Per-persona feedback");
  lines.push("");
  const reflMap = new Map(perPersonaReflections);
  Object.keys(byPersona).sort((a, b) => a.localeCompare(b)).forEach(persona => {
    lines.push("### " + persona);
    lines.push("");
    // Reflection-first so the per-step diary doesn't bury the human voice.
    const refl = reflMap.get(persona);
    if (refl) {
      if (refl.liked && refl.liked.length) {
        lines.push("**What worked for me:**");
        refl.liked.forEach(s => lines.push("- " + s));
        lines.push("");
      }
      if (refl.frustrated && refl.frustrated.length) {
        lines.push("**What frustrated me:**");
        refl.frustrated.forEach(s => lines.push("- " + s));
        lines.push("");
      }
      if (refl.improvements && refl.improvements.length) {
        lines.push("**What I'd change:**");
        refl.improvements.forEach(s => lines.push("- " + s));
        lines.push("");
      }
      if (refl.journey) {
        const j = refl.journey;
        lines.push("_Journey:_ stages seen: " + (j.stagesSeen.join(", ") || "—") +
          "; max buttons: " + j.maxButtons +
          "; max scroll: " + j.maxScroll + "×" +
          "; presence peak in room: " + j.presenceSeenInRoom +
          "; reached wrap-up: " + (j.everSawWrapup ? "yes" : "no") +
          (j.everSawError ? "; saw an error message: yes" : "") +
          (j.slowSteps ? "; slow steps: " + j.slowSteps : "") + ".");
        lines.push("");
      }
      lines.push("<details><summary>Per-step diary</summary>");
      lines.push("");
    }
    byPersona[persona].forEach(o => {
      const flag = o.ok === false ? " ❌" : (o.ok === true ? " ✓" : "");
      lines.push("**" + o.step + "**" + flag);
      if (o.error) lines.push("- error: `" + o.error + "`");
      if (o.durationMs != null) lines.push("- duration: " + o.durationMs + "ms");
      if (o.snapshot) {
        if (o.snapshot.activeView) lines.push("- active view: `#" + o.snapshot.activeView + "`");
        if (o.snapshot.roomName) lines.push("- room: " + o.snapshot.roomName);
        if (o.snapshot.heading) lines.push("- heading: \"" + o.snapshot.heading.replace(/"/g, "'") + "\"");
        if (o.snapshot.stageNow) lines.push("- stage text: \"" + o.snapshot.stageNow.replace(/"/g, "'") + "\"");
        if (o.snapshot.scrollRatio) lines.push("- scroll: " + o.snapshot.scrollRatio + "× viewport");
        if (Array.isArray(o.snapshot.visibleButtons) && o.snapshot.visibleButtons.length) {
          lines.push("- buttons visible (" + o.snapshot.visibleButtons.length + "): " +
            o.snapshot.visibleButtons.slice(0, 8).map(b => "`" + b + "`").join(", ") +
            (o.snapshot.visibleButtons.length > 8 ? " …" : ""));
        }
        if (o.snapshot.presence != null) lines.push("- presence count: " + o.snapshot.presence);
      }
      if (o.reactions && o.reactions.length) {
        lines.push("- *reactions:*");
        o.reactions.forEach(r => lines.push("  - " + r));
      }
      if (o.errors && o.errors.length) {
        lines.push("- console errors during this step:");
        o.errors.slice(0, 5).forEach(e => lines.push("  - `" + e.slice(0, 200) + "`"));
      }
      if (o.screenshot) {
        const rel = path.basename(SCREEN_DIR) + "/" + o.screenshot;
        lines.push("- screenshot: ![" + o.step + "](" + rel + ")");
      }
      lines.push("");
    });
    lines.push("</details>");
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  console.log("Report written: " + REPORT_PATH);
}
