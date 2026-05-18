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

const FACILITATORS = [
  { id: "F1", role: "lead",
    name: "Dr Aleksic",         label: "E2E sim — Franco-Japanese Workshop",
    pass: "sim-fac-pw-2026" },
  { id: "F2", role: "co",
    name: "Dr Chrétien",        label: "" }
];

const STUDENTS = [
  // Room 1
  { id: "S1", name: "Marie",   uni: "Caen",   year: 5, english: "C2",
    traits: ["enthusiastic", "fluent_french"],
    expects: "to engage fully and read every prompt" },
  { id: "S2", name: "Yuki",    uni: "Nagoya", year: 5, english: "B2",
    traits: ["thoughtful", "second_language_caution"],
    expects: "to read carefully before clicking anything" },
  { id: "S3", name: "Pierre",  uni: "Caen",   year: 4, english: "C1",
    traits: ["explorer", "technical"],
    expects: "to try every button to understand the interface" },
  { id: "S4", name: "Hana",    uni: "Nagoya", year: 4, english: "B1",
    traits: ["anxious", "needs_guidance"],
    expects: "clear instructions and not too much text at once" },
  // Room 2
  { id: "S5", name: "Sara",    uni: "Caen",   year: 6, english: "C2",
    traits: ["time_pressed", "skim_reader"],
    expects: "to skim and act fast" },
  { id: "S6", name: "Akari",   uni: "Nagoya", year: 6, english: "C1",
    traits: ["leader", "contributor"],
    expects: "to share opinions in discussion" },
  { id: "S7", name: "Léo",     uni: "Caen",   year: 3, english: "B2",
    traits: ["distracted", "checks_phone"],
    expects: "to lurk, react when nudged" },
  { id: "S8", name: "Kenta",   uni: "Nagoya", year: 4, english: "A2",
    traits: ["struggling", "low_english"],
    expects: "to need translations and visual cues" }
];

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
  await _ctx.addInitScript(() => {
    function pin(name, value) {
      Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true, enumerable: true
      });
    }
    pin("CANAMED_FIREBASE", null);
    pin("CANAMED_RECAPTCHA_SITE_KEY", null);
    pin("CANAMED_PERF_MONITORING", false);
    window.CANAMED_SUPERADMIN_KEY = "sim-super-admin";
    try {
      // suppress tours — they cover the real UI we want to observe
      localStorage.setItem("canamed_tour_done", "v1");
      localStorage.setItem("canamed_tour_admin_done", "v1");
      localStorage.setItem("canamed_tour_student_done", "v1");
    } catch (e) {}
  });
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
    const stageNow = (function () {
      const e = document.getElementById("stage-now");
      return e ? (e.textContent || "").trim().slice(0, 120) : "";
    })();
    return {
      url: location.href,
      title: document.title,
      activeView,
      visibleButtons, heading, stageNow,
      scrollH, view, scrollRatio: view ? +(scrollH / view).toFixed(2) : 0,
      hasError, presence
    };
  }).catch(() => ({ visibleButtons: [], heading: "[snapshot-failed]" }));
}

/* Persona reactions are derived from the snapshot + the persona's
 * traits. Returns 1-3 short first-person quotes that this kind of
 * person would plausibly say. */
function reactionsFrom(persona, snap, durationMs) {
  const r = [];
  const tr = persona.traits || [];
  const btnCount = (snap.visibleButtons || []).length;

  if (snap.hasError) {
    r.push("I see a red error message — am I supposed to do something?");
  }
  if (btnCount >= 12 && tr.includes("anxious")) {
    r.push("There are so many buttons. I don't know where to start.");
  }
  if (btnCount >= 12 && tr.includes("low_english")) {
    r.push("Too many words. I want to click the wrong thing by mistake.");
  }
  if (btnCount <= 3 && tr.includes("explorer")) {
    r.push("Only " + btnCount + " buttons? Hope I'm not missing anything.");
  }
  if (snap.scrollRatio >= 3 && tr.includes("time_pressed")) {
    r.push("This page is long. I'm just going to scroll through.");
  }
  if (snap.scrollRatio >= 3 && tr.includes("anxious")) {
    r.push("Do I have to read all of this?");
  }
  if (durationMs > 8000 && tr.includes("distracted")) {
    r.push("Took a while to load. I checked my phone.");
  }
  if (durationMs < 1500 && tr.includes("thoughtful")) {
    r.push("Fast — but I want a moment to read before the screen changes.");
  }
  if (snap.presence === 0 && tr.includes("contributor")) {
    r.push("I don't see anyone else in my room — is anyone here yet?");
  }
  if (snap.presence > 0 && tr.includes("leader")) {
    r.push("I see " + snap.presence + " others. Let me start the conversation.");
  }
  if (tr.includes("fluent_french") && /Module A|Module B|Wrap-up/.test(snap.heading)) {
    r.push("OK, on est sur " + snap.heading + ". Allons-y.");
  }
  if (tr.includes("second_language_caution") && /Module|Wrap/.test(snap.heading)) {
    r.push("Let me re-read the title to be sure I understand.");
  }
  return r.slice(0, 3);
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
  // wait for the code to appear
  await pageF1.locator("#splash-shown-code").waitFor({ timeout: 10000 });
  await pageF1.waitForFunction(() =>
    /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(
      (document.getElementById("splash-shown-code").textContent || "").trim()
    ), { timeout: 10000 });
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

  // ---- Tab F2: co-facilitator joins via lobby + admin password
  const F2 = FACILITATORS[1];
  const { ctx: ctxF2, page: pageF2 } = await newTab(browser, F2);
  console.log("Sim: co-facilitator (" + F2.name + ") joining…");
  await pageF2.goto(BASE_URL + "/");
  await pageF2.locator("#splash-code").fill(CODE);
  await pageF2.locator("#splash-enter").click();
  await pageF2.locator("#name-input").waitFor({ state: "visible", timeout: 8000 });
  // The co-facilitator goes through the admin-login path that the
  // lobby exposes. The platform's lobby has an "I'm a facilitator"
  // toggle that asks for the admin password.
  const adminToggle = pageF2.locator("#admin-toggle");
  if (await adminToggle.isVisible().catch(() => false)) {
    await adminToggle.click();
    const passInput = pageF2.locator("#admin-pass-input");
    if (await passInput.isVisible().catch(() => false)) {
      await passInput.fill(F1.pass);
      await pageF2.locator("#join-admin-btn").click();
      await pageF2.locator("#admin-app").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    }
  }
  const f2Snap = await snapshot(pageF2);
  obs(F2.name + " (co-facilitator)", "co-admin-join", {
    ok: f2Snap.url.includes(BASE_URL),
    snapshot: f2Snap,
    reactions: f2Snap.heading
      ? ["Joined the dashboard. Stage indicator: " + f2Snap.heading]
      : ["Could not reach the admin dashboard cleanly — landed on " + (f2Snap.title || "?")],
    screenshot: await shot(pageF2, F2, "01-co-admin")
  });

  // ---- 8 students join
  console.log("Sim: 8 students joining the lobby…");
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
          reactions: reactionsFrom(s, snap, Date.now() - tJoin),
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

  // wait for the admin pool counter to catch up before starting
  await pageF1.waitForFunction(() => {
    const e = document.getElementById("prestart-count");
    return e && parseInt(e.textContent, 10) >= 8;
  }, { timeout: 15000 }).catch(() => {});
  const pre = await pageF1.locator("#prestart-count").textContent().catch(() => "?");
  obs(F1.name + " (lead facilitator)", "pre-start-count", {
    ok: pre === "8",
    snapshot: { presence: parseInt(pre, 10) },
    reactions: pre === "8"
      ? ["All 8 students in the pool. Starting now."]
      : ["Pool counter says " + pre + " — I expected 8. Waiting a few more seconds before starting."]
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
      await page.locator("#app").waitFor({ state: "visible", timeout: 20000 });
      tab.inRoom = true;
      const snap = await snapshot(page);
      obs(s.name + " (" + s.uni + " Y" + s.year + ", " + s.english + ")",
        "stage-0-welcome-arrived", {
          ok: true,
          durationMs: Date.now() - tEnter,
          snapshot: snap,
          reactions: reactionsFrom(s, snap, Date.now() - tEnter),
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
        reactions: reactionsFrom(s, snap, Date.now() - tAdv),
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

  // ===== per-persona feedback =====
  lines.push("## Per-persona feedback");
  lines.push("");
  Object.keys(byPersona).sort((a, b) => a.localeCompare(b)).forEach(persona => {
    lines.push("### " + persona);
    lines.push("");
    byPersona[persona].forEach(o => {
      const flag = o.ok === false ? " ❌" : (o.ok === true ? " ✓" : "");
      lines.push("**" + o.step + "**" + flag);
      if (o.error) lines.push("- error: `" + o.error + "`");
      if (o.durationMs != null) lines.push("- duration: " + o.durationMs + "ms");
      if (o.snapshot) {
        if (o.snapshot.activeView) lines.push("- active view: `#" + o.snapshot.activeView + "`");
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
    lines.push("---");
    lines.push("");
  });

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  console.log("Report written: " + REPORT_PATH);
}
