/* section-picker.js — the create form's SECTION PICKER (lazy chunk)
 *
 * SPLIT OUT OF script.js 2026-07-31 to repay the reclaim debt the perf budget
 * header has been recording since 2026-06-28 ("RECLAIM NOW MANDATORY … no
 * further bump without it"). This is splash-only code sitting behind a click:
 * nothing here runs until the facilitator opens "Create a session", so none of
 * it belongs on the entry view's critical path.
 *
 * Loaded via CanamedLoader.ensureSectionPicker(), triggered from
 * splashShowView("create") — the single choke point every route into the create
 * form passes through. script.js keeps NO copies: it calls into these by name
 * once the chunk has landed, each call site guarded by typeof so a failed load
 * degrades to an unusable picker rather than a thrown splash.
 *
 * Deliberately a CLASSIC script, not an IIFE module: the block is moved
 * VERBATIM, so its top-level function/let declarations stay global exactly as
 * they were while inside script.js. That keeps every existing reference working
 * — script.js's own call sites, and the e2e specs that drive splashSectionPick /
 * renderSectionPick() / sectionPickCsv() as bare globals — with no rewrite to
 * window.* and therefore no new failure modes.
 */

/* ── S3b — the SECTION PICKER on the create form ──────────────────────────────
 * Replaces "Scenario (the clinical case for this workshop)" as the primary
 * control. A session is opening + N independently-picked sections + wrap-up:
 * sections may come from different clinical cases, the same TYPE may appear
 * twice, and PICK ORDER IS RUNNING ORDER.
 *
 * It also supersedes M2's "Modules to run" tick-row — a section pick IS the
 * module set, and expressed at the right granularity, so that row is gone.
 *
 * The library is a lazily-loaded chunk, so the add-list fills itself once the
 * chunk lands. */
let splashSectionPick = [];
let _sectionPickerTries = 0;       // ordered section ids the facilitator chose
let _sectionPickerSeeded = false;  // default seeded once, see populateSectionPicker
/* Type labels go through i18n like the rest of the create form — the picker was
   the only part of it shipping hardcoded English, so a French facilitator saw a
   mixed-language form. */
function sectionTypeLabel(type) {
  const key = "splash.create.sections-type-" + type;
  const v = (typeof window !== "undefined" && typeof window.t === "function")
    ? window.t(key) : "";
  if (v && v !== key) return v;
  return { pbl: "PBL", roleplay: "Roleplay", branched: "Branched" }[type] || type;
}

/* ── S7 — AUTHORED sections in the picker ─────────────────────────────────────
 * The built-in library is derived from a FIXED list of four cases
 * (section-registry.js SECTION_SOURCES), so it can never contain a scenario a
 * facilitator wrote. Until now the only route to those was the Scenario select,
 * which is why that select could not simply be deleted.
 *
 * Two ids are in play here and conflating them is the trap:
 *   - a SYNTHETIC id ("authored:<uid>:<scenarioId>:<type>") used only inside
 *     the create form, to identify a pick while the facilitator arranges it;
 *   - the DB token, which is "custom-<slot>" and is assigned at CREATE time,
 *     because the slot IS the position in the pick.
 * The synthetic id must never reach the database: the `sections` CSV validator
 * is /^[A-Za-z0-9_-]{1,48}(,...)*$/ — no colons — so writing one would be
 * rejected at write time, and LOCAL-mode e2e would never catch it.
 */
let splashAuthoredSections = {};      // synthetic id -> { section, bodyJson, ... }

function authoredSectionKey(ownerUid, scenarioId, type) {
  return "authored:" + ownerUid + ":" + scenarioId + ":" + type;
}
function isAuthoredSectionKey(id) {
  return typeof id === "string" && id.indexOf("authored:") === 0;
}
/* Resolve a picked id against BOTH libraries. Every reader must go through
   this — reading window.CANAMED_SECTIONS directly silently renders an authored
   pick as a bare id with no type, which is how the section-model initiative
   produced "Section k" with no title once already. */
function sectionLibEntry(id) {
  if (isAuthoredSectionKey(id)) {
    const a = splashAuthoredSections[id];
    return a ? a.section : null;
  }
  return (window.CANAMED_SECTIONS || {})[id] || null;
}

/* Derive the sections an authored scenario yields, via the SAME
   sectionsForScenario() the built-in library uses — so an authored section
   behaves identically to a built-in one. Defensive: one malformed body must
   not take the whole list down. */
function authoredSectionsFrom(bodyJson, ownerUid, scenarioId, source, ownerName) {
  if (!bodyJson || typeof window.sectionsForScenario !== "function") return [];
  let body;
  try { body = JSON.parse(bodyJson); }
  catch (e) { console.warn("authored scenario body is not JSON:", scenarioId); return []; }
  if (!body || typeof body !== "object") return [];
  /* The slug only shapes the DISPLAY id; the DB token is assigned at create.
     Kept readable so the picker row is legible while arranging a pick. */
  const slug = String(scenarioId || "scenario").slice(0, 40);
  let secs = [];
  try { secs = window.sectionsForScenario(body, slug) || []; }
  catch (e) { console.warn("sectionsForScenario failed for", scenarioId, e); return []; }
  return secs.map(sec => ({
    key: authoredSectionKey(ownerUid, scenarioId, sec.type),
    section: sec,
    bodyJson: bodyJson,
    source: source,
    ownerUid: ownerUid,
    scenarioId: scenarioId,
    ownerName: ownerName || ""
  }));
}

/* Fill splashAuthoredSections from the facilitator's own scenarios and the
   shared ones, then re-render the picker. Fire-and-forget: a failure leaves the
   built-in library intact rather than breaking session creation.

   COST ASYMMETRY, and why the two halves differ. listMyScenarios() already
   reads the whole scenarios/<uid> subtree INCLUDING bodyJson, so your own
   scenarios cost nothing extra. sharedScenarios/<id> carries only metadata, and
   `meta` has no `modules`/`format`, so each shared scenario needs its own body
   read to know what sections it yields. Those are fetched, but CAPPED — and the
   cap logs what it dropped, because a silently truncated list reads exactly
   like "you have no shared scenarios". */
const AUTHORED_SHARED_BODY_CAP = 20;

/* Two call sites race — wireSplash on load, and the auth-state handler after
   sign-in — and each does up to CAP independent async reads, so they overlap
   and finish in an unspecified order. Only the NEWEST call may commit: a
   pre-sign-in pass landing late would otherwise overwrite the map with the
   shared-only set, so the facilitator's own scenarios vanish from the picker,
   AND take with them any authored pick they had already arranged (the filter
   below drops what sectionLibEntry can no longer resolve). */
let _authoredSectionsGen = 0;
let _authoredSectionsTries = 0;

function loadAuthoredSectionsIntoPicker() {
  if (typeof window.sectionsForScenario !== "function") {
    /* NOT loaded yet — and this used to give up for good. wireSplash calls this
       during splash wiring, before the lazy section-registry.js has landed, so
       the bail fired every time and nothing ever retried: on a cold load NO
       authored or shared section appeared in the picker at all. That was
       survivable while the Scenario select existed (it listed shared scenarios
       itself); with the select deleted the picker is the ONLY route to them, so
       the S7 cutover turned a slow path into an invisible one — including the
       moderation filter, which can only hide a shared scenario that lists.

       Same bounded retry populateSectionPicker() already uses for the built-ins:
       chain onto the fetch and come back, giving up after a few tries so an
       optional chunk that never loads cannot recurse for ever (its load failure
       is swallowed, so the promise settles with the library still absent). */
    _authoredSectionsTries += 1;
    if (_authoredSectionsTries > 3) return Promise.resolve();
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      return window.CanamedLoader.ensureCaseContent()
        .then(loadAuthoredSectionsIntoPicker);
    }
    return Promise.resolve();
  }
  _authoredSectionsTries = 0;
  const gen = ++_authoredSectionsGen;
  const signedIn = !!(auth && auth.currentUser && !auth.currentUser.isAnonymous);
  const mineP = signedIn ? listMyScenarios() : Promise.resolve([]);
  const sharedP = listSharedScenarios();
  const myUid = (auth && auth.currentUser && auth.currentUser.uid) || null;

  return Promise.all([mineP, sharedP]).then(res => {
    const mine = res[0] || [];
    const shared = (res[1] || []).filter(x => !myUid || x.ownerUid !== myUid);
    const next = {};

    mine.forEach(sc => {
      authoredSectionsFrom(sc.bodyJson, myUid, sc.id, "private", "")
        .forEach(a => { next[a.key] = a; });
    });

    const take = shared.slice(0, AUTHORED_SHARED_BODY_CAP);
    if (shared.length > take.length) {
      console.warn("section picker: listing only " + take.length + " of " +
        shared.length + " shared scenarios (body-fetch cap)");
    }
    return Promise.all(take.map(sh =>
      loadScenarioByRef({ source: "shared", ownerUid: sh.ownerUid, scenarioId: sh.scenarioId })
        .then(body => {
          if (!body) return;
          authoredSectionsFrom(JSON.stringify(body), sh.ownerUid, sh.scenarioId,
                               "shared", sh.ownerName)
            .forEach(a => { next[a.key] = a; });
        })
        .catch(() => {})
    )).then(() => {
      if (gen !== _authoredSectionsGen) return;   // a newer load superseded us
      splashAuthoredSections = next;
      /* Drop any pick whose section vanished (signed out, or a shared scenario
         taken down between renders) — leaving it would write a token at create
         that nothing can resolve. */
      splashSectionPick = splashSectionPick.filter(id => !!sectionLibEntry(id));
      populateSectionPicker();
    });
  }).catch(e => { console.warn("loadAuthoredSectionsIntoPicker failed", e); });
}

function sectionLibraryList() {
  const lib = (typeof window !== "undefined" && window.CANAMED_SECTIONS) || null;
  if (!lib) return null;
  const builtIn = Object.keys(lib).map(id => lib[id]).filter(Boolean);
  /* Authored sections list AFTER the built-ins, each tagged with its own id so
     the add-list option can carry the synthetic key as its value. */
  const authored = Object.keys(splashAuthoredSections)
    .map(k => splashAuthoredSections[k])
    .filter(Boolean)
    .map(a => Object.assign({}, a.section, { id: a.key, _authored: a }));
  return builtIn.concat(authored);
}
function populateSectionPicker() {
  const add = el("splash-section-add");
  if (!add) return;
  const list = sectionLibraryList();
  if (!list) {
    /* Not loaded yet — chain onto the same fetch the scenario picker uses and
       come back. Without this the picker is permanently empty on a cold load.

       BOUNDED: section-registry.js is optional and its load failure is
       swallowed, so ensureCaseContent() can resolve for ever with the library
       still absent. An unbounded retry would then recurse without end (the
       promise is already settled, so each attempt re-fires immediately). Give
       up after a few tries and leave the picker empty — the session simply
       falls back to the scenario shape, which is the designed degradation. */
    _sectionPickerTries += 1;
    if (_sectionPickerTries > 3) {
      const add = el("splash-section-add");
      if (add && !add.options.length) add.disabled = true;
      return;
    }
    if (window.CanamedLoader && window.CanamedLoader.ensureCaseContent) {
      window.CanamedLoader.ensureCaseContent().then(populateSectionPicker);
    }
    return;
  }
  _sectionPickerTries = 0;
  const lang = _curLang();
  /* SEED A DEFAULT once the library first lands. The Scenario select this
     replaced was never empty — it defaulted to the first built-in — so shipping
     an empty picker would have been an accidental behaviour change, not a
     faithful swap: every facilitator (and every existing test) that just fills
     in a name and a password would hit a blocking error where the old form
     simply worked.
     Seeded ONCE, tracked by a flag rather than by "is the pick empty", so
     removing the last section is respected instead of being instantly undone. */
  if (!_sectionPickerSeeded && !splashSectionPick.length && list.length) {
    _sectionPickerSeeded = true;
    splashSectionPick.push(list[0].id);
  }
  add.textContent = "";
  list.forEach(sec => {
    const o = document.createElement("option");
    o.value = sec.id;
    const title = (sec.name && (typeof tc === "function" ? tc(sec.name, lang) : sec.name.en))
      || sec.id;
    o.textContent = sectionTypeLabel(sec.type) + " — " + title;
    add.appendChild(o);
  });
  renderSectionPick();
}
function renderSectionPick() {
  const ol = el("splash-section-list");
  const empty = el("splash-section-empty");
  if (!ol) return;
  ol.textContent = "";
  if (empty) empty.classList.toggle("hidden", splashSectionPick.length > 0);

  splashSectionPick.forEach((id, i) => {
    const sec = sectionLibEntry(id) || { id: id, type: "", name: null };
    const li = document.createElement("li");
    li.className = "splash-section-row";
    li.setAttribute("data-section-id", id);

    const title = (sec.name && (typeof tc === "function" ? tc(sec.name, _curLang()) : sec.name.en))
      || id;
    /* Reuse the stage label pattern the STUDENT sees, so the facilitator's row
       and the student's stage read identically in every language. */
    const pat = (typeof window !== "undefined" && typeof window.t === "function")
      ? window.t("stage.label.section") : "";
    const tpl = (pat && pat !== "stage.label.section") ? pat : "Section {n} — {title}";

    /* THE SECTION IS A SELECT, so a slot can be changed IN PLACE. It used to be
       a static span, which meant the seeded default could only be replaced by
       noticing the small ×, removing it, and then adding — the facilitator's
       reasonable reading was that section 1 simply could not be changed.

       The label is SPLIT around {title} rather than interpolated, so the select
       sits exactly where the title sits in the pattern. Interpolating would have
       forced the position prefix to lead in every language, which the i18n
       pattern exists precisely to avoid. */
    const parts = tpl.split("{title}");
    const pre = document.createElement("span");
    pre.className = "splash-section-name";
    /* textContent, never innerHTML — a section title can be facilitator-authored. */
    pre.textContent = (parts[0] || "").replace("{n}", String(i + 1));
    li.appendChild(pre);

    const pick = document.createElement("select");
    pick.className = "splash-section-pick";
    pick.setAttribute("aria-label",
      (window.t ? window.t("splash.create.sections-change") : "Change this section"));
    const lib = sectionLibraryList() || [];
    /* If the current id is not in the library (an authored section whose owner
       signed out, or a taken-down shared one), keep it as its own option rather
       than letting the select silently snap to the first entry — that would
       change the facilitator's pick behind their back. */
    if (!lib.some(s => s && s.id === id)) {
      const keep = document.createElement("option");
      keep.value = id;
      keep.textContent = title;
      pick.appendChild(keep);
    }
    lib.forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      const t2 = (s.name && (typeof tc === "function" ? tc(s.name, _curLang()) : s.name.en)) || s.id;
      o.textContent = sectionTypeLabel(s.type) + " — " + t2;
      pick.appendChild(o);
    });
    pick.value = id;
    pick.addEventListener("change", () => {
      splashSectionPick[i] = pick.value;
      renderSectionPick();   // re-render: the type chip and Report button follow the new section
    });
    li.appendChild(pick);

    if (parts[1]) {
      const post = document.createElement("span");
      post.className = "splash-section-name";
      post.textContent = parts[1].replace("{n}", String(i + 1));
      li.appendChild(post);
    }

    const type = document.createElement("span");
    type.className = "splash-section-type";
    type.textContent = sectionTypeLabel(sec.type);
    li.appendChild(type);

    const mk = (cls, label, disabled, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "splash-link " + cls;
      b.textContent = label;
      b.setAttribute("aria-label", label + " " + title);
      if (disabled) b.disabled = true;
      else b.addEventListener("click", fn);
      li.appendChild(b);
      return b;
    };
    mk("splash-section-up", "↑", i === 0, () => moveSectionPick(i, -1));
    mk("splash-section-down", "↓", i === splashSectionPick.length - 1,
       () => moveSectionPick(i, 1));
    mk("splash-section-remove", "×", false, () => {
      splashSectionPick.splice(i, 1);
      renderSectionPick();
    });
    /* Moderation: only a section from SOMEONE ELSE's shared scenario is
       reportable. This replaces the button that hung off the deleted Scenario
       select — the capability moved with the content, it did not go away. */
    const authored = isAuthoredSectionKey(id) ? splashAuthoredSections[id] : null;
    if (authored && authored.source === "shared") {
      const rb = mk("splash-section-report",
        (window.t ? window.t("splash.create.report") : "Report"), false, () => {});
      rb.addEventListener("click", () => reportAuthoredSection(authored, rb));
    }
    ol.appendChild(li);
  });
}
function moveSectionPick(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= splashSectionPick.length) return;
  const t = splashSectionPick[i];
  splashSectionPick[i] = splashSectionPick[j];
  splashSectionPick[j] = t;
  renderSectionPick();
}
function addSectionPick(id) {
  if (!id) return;
  /* Duplicates are ALLOWED — running the same section twice is legitimate (a
     replay), and the slot model keys state by position, not by section id. The
     only bound is the physical slot cap the DB rules enforce. */
  if (splashSectionPick.length >= MAX_SECTION_SLOTS) return;
  splashSectionPick.push(id);
  renderSectionPick();
}
function wireSectionPicker() {
  const btn = el("splash-section-add-btn");
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", () => {
    const sel = el("splash-section-add");
    addSectionPick(sel && sel.value);
  });
}
/* The CSV written at create, or null when nothing was picked (in which case the
   session falls back to the scenario's own shape, exactly as before S3). */
function sectionPickCsv() {
  if (!splashSectionPick.length) return null;
  /* An AUTHORED pick becomes "custom-<slot>": the slot IS the position, and its
     body is snapshotted to sessions/<code>/sectionBodies/<slot> at create. The
     synthetic "authored:<uid>:<id>:<type>" key must never appear here — the CSV
     validator forbids colons, so it would be refused at write time. */
  return splashSectionPick
    .map((id, i) => (isAuthoredSectionKey(id) ? ("custom-" + (i + 1)) : id))
    .join(",");
}

/* Mirrors the `sectionBodies/$slot` .validate cap in database.rules.json. The
   rule compares `newData.val().length`, which counts UTF-16 code units exactly
   as JS `String.length` does — so this check is the same measurement, not an
   approximation of it. Keep the two in lockstep (a unit test parses the rule
   and asserts this constant equals it). */
const SECTION_BODY_MAX_LEN = 131072;

/* The authored bodies to snapshot, matching the custom-<slot> tokens
   sectionPickCsv() emits, as { bodies: { slot -> json }, oversized: [ … ] }.

   WHY THIS REPORTS oversized INSTEAD OF JUST SKIPPING. The bodies are written
   AFTER `created` and `recovery` (the rule requires the CSV to already name
   custom-<slot>, so they cannot ride the same batch). A body over the rule's
   cap therefore rejects a write that happens once the session half-exists, and
   tryCreate reports it as a generic "check your connection" — the true cause
   invisible. Dropping the body instead would be worse still: the CSV would
   keep claiming custom-<slot> with nothing to resolve it, which is exactly the
   unresolvable-slot class of bug the clone-last-workshop fix closed. So the
   caller is told, and refuses to create at all. */
function sectionPickBodies() {
  const out = {};
  const oversized = [];
  splashSectionPick.forEach((id, i) => {
    if (!isAuthoredSectionKey(id)) return;
    const a = splashAuthoredSections[id];
    if (!a || !a.section) return;
    /* Snapshot the DERIVED SECTION, not the whole authored scenario. The token
       "custom-<slot>" says the slot is authored but NOT which half of a
       two-module scenario it runs — storing the scenario would leave that
       ambiguous at join. A derived section is already exactly one half, so the
       runtime can register it as a library entry verbatim with no
       re-derivation, and it is about half the bytes (which is what the rules'
       131072 cap was sized for). */
    try {
      const json = JSON.stringify(
        Object.assign({}, a.section, { id: "custom-" + (i + 1) }));
      if (json.length > SECTION_BODY_MAX_LEN) {
        oversized.push({ slot: i + 1, title: authoredSectionTitle(a), len: json.length });
        return;
      }
      out[String(i + 1)] = json;
    } catch (e) { console.warn("could not snapshot authored section", id, e); }
  });
  return { bodies: out, oversized: oversized };
}

/* The human-readable name of an authored section, for an error a facilitator
   can act on ("which one do I shorten?"). Never reaches innerHTML — the title
   is facilitator-authored, so every caller uses textContent. */
function authoredSectionTitle(a) {
  const sec = (a && a.section) || null;
  const nm = sec && sec.name;
  const title = nm && (typeof tc === "function" ? tc(nm, _curLang()) : nm.en);
  return title || (sec && sec.id) || "";
}

/* fill the scenario dropdown from the SCENARIOS registry + one trailing
   "Create new content (advanced)" option that reveals the JSON textarea */
function reportAuthoredSection(entry, btn) {
  const T = (k, f) => (window.t ? window.t(k) : f);
  if (!entry || entry.source !== "shared") return;
  const shareId = entry.ownerUid + "_" + entry.scenarioId;
  // Needs auth (anonymous suffices). With none — LOCAL mode, or sign-in still
  // pending — say so rather than faking a "Reported" that wrote nothing.
  if (!auth || !auth.currentUser) {
    toast(T("splash.create.report-signin", "Sign in to report"));
    return;
  }
  const done = () => {
    btn.disabled = true;
    btn.textContent = T("splash.create.reported", "Reported");
  };
  const label = (entry.section && entry.section.name &&
                 (typeof tc === "function" ? tc(entry.section.name, _curLang())
                                           : entry.section.name.en)) || shareId;
  canamedConfirm({
    title: T("splash.create.report-title", "Report this scenario?"),
    message: T("splash.create.report-confirm", "Moderators will review it. You can report once."),
    detail: label,
    okLabel: T("splash.create.report", "Report"),
    danger: true
  }).then(ok => {
    if (!ok) return;
    btn.disabled = true;
    return reportSharedScenario(shareId).then(() => {
      done();
      toast(T("splash.create.report-sent", "Report sent to the moderators"));
    }).catch(e => {
      // Denied = already reported (write-once): terminal, retrying can't help.
      // Anything else (offline/backend) wrote NOTHING — re-enable, don't lie.
      if (String((e && (e.code || e.message)) || "").toLowerCase().indexOf("permission") >= 0) return done();
      btn.disabled = false;
      toast(T("splash.create.report-failed", "Report failed. Try again."));
    });
  }).catch(() => {});
}
