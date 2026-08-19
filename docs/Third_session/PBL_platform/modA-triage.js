/* modA-triage.js — Module A appropriateness triage (slice 1), LAZY chunk.
 *
 * Split out of script.js because the whole feature is gated behind ?triage=1
 * and DEFAULT-OFF: shipping it in the splash bundle made ~100% of sessions
 * download code they never execute, and pushed first-party JS+CSS to 321.3 KB
 * against the 316 KB budget (tests-e2e/perf.spec.js). Loaded by
 * CanamedLoader.ensureModATriage() only when the flag is on.
 *
 * Deliberately a CLASSIC script, not an IIFE — the same reasoning takehome.js
 * and section-picker.js record. This block reads script.js top-level `let`
 * bindings that are NOT window properties (triage, refTriage, revealed,
 * TRIAGE_ON, PENALTY_ITEM_IDS, myName, clientId). Classic scripts share the
 * global script scope, so each stays reachable by its bare name exactly as it
 * was when this code lived in script.js — no context object, no window.*
 * rewrite, no rewiring of the unit tests that read these function bodies.
 * Its other outbound deps resolve the same way: el, tFallback, _curLang,
 * itemById, CASE / PENALTIES / REASON_VOCAB (case-content.js).
 *
 * The bindings sit in their TDZ until script.js evaluates; this chunk only
 * loads on room entry, long after that, so the ordering is safe.
 */

const DECLINE_INDICATED_PENALTY = 4;   // cost of ruling out a test that WAS needed
// Ruling out an inappropriate test is the right DECISION; the REASON is then
// graded and can WIN OR LOSE points — the sharpest reason wins most, an
// acceptable one wins a little, an off-target/wrong reason LOSES points.
const DECLINE_BEST_REWARD = 5;         // best reason      (reason-quality 2)
const DECLINE_OK_REWARD = 2;           // acceptable reason (reason-quality 1)
const DECLINE_WRONG_PENALTY = 3;       // off-target reason (reason-quality 0) → −3
const triageOpen = new Set();          // transient UI: which rows have the reason rail open
/* Which reasons are "best" / "acceptable" for ruling out this item. An author
   can set bestReasons/okReasons on the item's PENALTIES row; otherwise fall
   back to per-group defaults so any scenario works with zero authoring. */
function _bestReasonsFor(id) {
  const pens = (typeof window !== "undefined" && Array.isArray(window.PENALTIES))
    ? window.PENALTIES
    : (typeof PENALTIES !== "undefined" ? PENALTIES : []);
  const p = pens.find(x => x && x.item === id);
  if (p && Array.isArray(p.bestReasons)) {
    return { best: p.bestReasons, ok: Array.isArray(p.okReasons) ? p.okReasons : [] };
  }
  const g = String(id).split(":")[0];
  if (g === "labs") return { best: ["not_indicated", "harm"], ok: ["low_value"] };
  if (g === "exam") return { best: ["harm", "not_indicated"], ok: ["low_value"] };
  return { best: ["not_indicated", "premature"], ok: ["low_value"] };   // history
}
function _reasonQuality(id, reason) {
  if (!reason) return 0;
  const { best, ok } = _bestReasonsFor(id);
  if (best.indexOf(reason) !== -1) return 2;
  if (ok.indexOf(reason) !== -1) return 1;
  return 0;
}
/* Net points for correctly ruling out an INAPPROPRIATE item, by reason quality.
   Positive → reward (score/auto); negative → penalty (score/penalties). This is
   what makes the reason choice consequential: best wins, ok wins a little, an
   off-target reason loses. */
function _declinePoints(id, reason) {
  const q = _reasonQuality(id, reason);
  if (q === 2) return DECLINE_BEST_REWARD;
  if (q === 1) return DECLINE_OK_REWARD;
  return -DECLINE_WRONG_PENALTY;
}
/* An item that genuinely "had to be done" — ruling it out is a wrong decision
   and costs points regardless of the reason. Marked in content via
   `indicated: true` (or the legacy synthesis `key: true`). */
function _isIndicated(item) {
  return !!(item && (item.indicated === true || item.key === true));
}
function _reasonVocab() {
  return (typeof REASON_VOCAB !== "undefined" && Array.isArray(REASON_VOCAB)) ? REASON_VOCAB : [];
}
function _reasonLabel(key, lang) {
  const rv = _reasonVocab().find(r => r.key === key);
  if (rv) return (typeof tc === "function") ? tc(rv.label, lang) : (rv.label.en || key);
  return key;
}
/* Commit a rule-out decision for `id` with `reason`. REFINABLE: a second
   choice for the same item REPLACES the first. Refuses if the item was already
   ordered (revealed) — the order/rule-out split is the one-way part. */
function writeTriage(id, reason) {
  if (!refTriage || revealed[id]) return;
  triageOpen.delete(id);
  const entry = { disposition: "ruleout", reason: reason, by: myName, at: Date.now() };
  /* set(), not a first-write-wins transaction: a rule-out is REFINABLE by
     design — a team that talks it through and picks a sharper reason should be
     able to say so. The DB rule agrees (no !data.exists() on triage/$itemId),
     which is what the emulator test has always asserted. Scoring stays honest
     because the reward is suppressed once a penalty has been banked for the
     item; see _triageWants. */
  refTriage.child(id).set(entry)
    .catch(e => console.error("Triage write failed", e));
}
/* The (empty) managed sibling that renderTriage() fills for one item. */
function _makeTriageBox(id) {
  const box = document.createElement("div");
  box.className = "req-triage";
  box.dataset.id = id;
  box.hidden = true;
  return box;
}
function _makeBulkRuleOut() {
  const foot = document.createElement("div");
  foot.className = "req-triage-bulk";
  foot.hidden = true;
  return foot;
}
/* Wrap one exam/investigation button + its Rule-out box in a flex row so the
   control sits to the RIGHT of the item (CSS drops it to a full-width row below
   only when the reason rail opens or a decision is committed). */
function _makeReqItem(group, i) {
  const wrap = document.createElement("div");
  wrap.className = "req-item";
  wrap.appendChild(_makeReqBtn(group, i));
  wrap.appendChild(_makeTriageBox(group + ":" + i));
  return wrap;
}
/* Populate every .req-triage box + the bulk foot from live state. Idempotent:
   safe to call on every render (mirrors renderButtons). */
function renderTriage() {
  if (!TRIAGE_ON) return;
  const lang = (typeof _curLang === "function") ? _curLang() : "en";
  document.querySelectorAll(".req-triage").forEach(box => {
    const id = box.dataset.id;
    const item = (typeof itemById === "function") ? itemById(id) : null;
    const t = (triage && triage[id]) || null;
    const ruledOut = !!(t && t.disposition === "ruleout");
    const ordered = !!revealed[id];
    const btn = document.querySelector('.req-btn[data-id="' + id + '"]');
    box.textContent = "";
    if (ordered) {                     // ordered wins; no rule-out offered
      box.hidden = true;
      if (btn) { btn.classList.remove("ruled-out"); btn.disabled = false; btn.removeAttribute("aria-disabled"); }
      return;
    }
    box.hidden = false;
    // Compact (just the "Rule out ▾" toggle) sits inline on the right; once the
    // reason rail is open or a decision is committed, drop to a full-width row.
    box.classList.toggle("expanded", ruledOut || triageOpen.has(id));
    if (ruledOut) {
      if (btn) { btn.classList.add("ruled-out"); btn.disabled = true; btn.setAttribute("aria-disabled", "true"); }
      _renderRuledOut(box, id, item, t, lang);
    } else {
      if (btn) { btn.classList.remove("ruled-out"); btn.disabled = false; btn.removeAttribute("aria-disabled"); }
      _renderRuleOutControl(box, id, item, lang);
    }
  });
  _renderBulkRuleOut(lang);
}
function _renderRuleOutControl(box, id, item, lang) {
  const open = triageOpen.has(id);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "triage-toggle";
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.textContent = tFallback("modA.triage.ruleout", "Rule out") + (open ? "  ▲" : "  ▾");
  toggle.addEventListener("click", () => {
    if (triageOpen.has(id)) triageOpen.delete(id); else triageOpen.add(id);
    renderTriage();
  });
  box.appendChild(toggle);
  if (!open) return;
  const group = document.createElement("div");
  group.className = "triage-reasons";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", tFallback("modA.triage.why", "Why would you not order this?"));
  const best = _bestReasonsFor(id).best;
  _reasonVocab().forEach(rv => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "triage-reason" + (best.indexOf(rv.key) !== -1 ? " suggested" : "");
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", "false");
    chip.dataset.reason = rv.key;
    chip.textContent = (rv.icon ? rv.icon + " " : "") + ((typeof tc === "function") ? tc(rv.label, lang) : rv.label.en);
    chip.addEventListener("click", () => writeTriage(id, rv.key));
    group.appendChild(chip);
  });
  box.appendChild(group);
}
function _renderRuledOut(box, id, item, t, lang) {
  const head = document.createElement("div");
  head.className = "triage-done";
  head.setAttribute("role", "status");
  head.setAttribute("aria-live", "polite");
  head.textContent = "✓ " + tFallback("modA.triage.ruledout", "Ruled out") + " · " + _reasonLabel(t.reason, lang);
  box.appendChild(head);
  const inappropriate = (typeof PENALTY_ITEM_IDS !== "undefined") && PENALTY_ITEM_IDS.has(id);
  const indicated = _isIndicated(item);
  const chip = document.createElement("span");
  if (inappropriate) {
    const pts = _declinePoints(id, t.reason);
    if (pts >= 0) {
      chip.className = "triage-award";
      chip.textContent = "+" + pts + "  " + tFallback("modA.triage.goodcall", "Good call — you held off");
    } else {
      chip.className = "triage-penalty";
      chip.textContent = "−" + (-pts) + "  " +
        tFallback("modA.triage.wrongreason", "Right to hold off — but the wrong reason");
    }
  } else if (indicated) {
    chip.className = "triage-penalty";
    chip.textContent = "−" + DECLINE_INDICATED_PENALTY + "  " +
                       tFallback("modA.triage.needed", "This one was needed");
  } else {
    chip.className = "triage-neutral";
    chip.textContent = tFallback("modA.triage.judgment", "Your judgment call — not scored");
  }
  box.appendChild(chip);
  // Teaching feedback: an inappropriate test → WHY it wasn't indicated
  // (PENALTIES.why); a needed test ruled out → what it would have shown (the
  // item's own finding), so the team learns what they skipped.
  let feedbackText = "";
  if (inappropriate) {
    const pens = (typeof window !== "undefined" && Array.isArray(window.PENALTIES))
      ? window.PENALTIES : (typeof PENALTIES !== "undefined" ? PENALTIES : []);
    const p = pens.find(x => x && x.item === id);
    if (p && p.why) feedbackText = (typeof tc === "function") ? tc(p.why, lang) : (p.why.en || "");
  } else if (indicated && item && item.a) {
    feedbackText = (typeof tc === "function") ? tc(item.a, lang) : (item.a.en || "");
  }
  if (feedbackText) {
    const why = document.createElement("div");
    why.className = "triage-why";
    why.textContent = feedbackText;
    box.appendChild(why);
  }
}
function _renderBulkRuleOut(lang) {
  const foot = document.querySelector(".req-triage-bulk");
  if (!foot) return;
  foot.textContent = "";
  const labsIds = [];
  if (typeof CASE !== "undefined" && CASE && CASE.labs) {
    CASE.labs.forEach((_, i) => { const id = "labs:" + i; if (id !== SYNTH_ID) labsIds.push(id); });
  }
  const pending = labsIds.filter(id =>
    (typeof PENALTY_ITEM_IDS !== "undefined") && PENALTY_ITEM_IDS.has(id) &&
    !revealed[id] && !(triage[id] && triage[id].disposition === "ruleout"));
  if (pending.length < 2) { foot.hidden = true; return; }   // only worth a bulk action for 2+
  foot.hidden = false;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "triage-bulk-btn";
  btn.textContent = tFallback("modA.triage.rest", "Rule out the rest — not indicated") + "  (" + pending.length + ")";
  btn.addEventListener("click", () => pending.forEach(id => writeTriage(id, "not_indicated")));
  foot.appendChild(btn);
}

/* swap the global content to a different scenario. `customContent` is an
   already-parsed object (from a session's scenarioCustomJson); `id` is one of
   the keys in window.CANAMED_SCENARIOS. customContent wins if both are given. */
/* Moved out of script.js's penaltyMeta — triage-only scoring, so it
   belongs with the feature rather than in the eager bundle. */
function _triagePenaltyMeta(ev, lang) {
  // a decline penalty: id is "declinepen_<itemId>" — the team ruled out a test
  // that WAS indicated. The feedback teaches why it was needed (the finding it
  // would have shown, i.e. the item's own result text).
  const dpm = /^declinepen_(.+)$/.exec(ev);
  if (dpm) {
    const item = (typeof itemById === "function") ? itemById(dpm[1]) : null;
    return {
      id: ev, points: DECLINE_INDICATED_PENALTY,
      title: "Ruled out a test that was needed",
      why: item ? tc(item.a, lang) : ""
    };
  }
  // a wrong-reason decline: id is "declinereason_<itemId>" — right to hold off,
  // but the reason chosen was clinically off-target, so it costs points.
  const drm = /^declinereason_(.+)$/.exec(ev);
  if (drm) {
    const p = (typeof PENALTIES !== "undefined") ? PENALTIES.find(x => x && x.item === drm[1]) : null;
    return {
      id: ev, points: DECLINE_WRONG_PENALTY,
      title: "Right to hold off — but the wrong reason",
      why: p ? tc(p.why, lang) : ""
    };
  }
  return null;
}

/* Moved out of script.js's scoreEventMeta — triage-only scoring, so it
   belongs with the feature rather than in the eager bundle. */
function _triageScoreMeta(ev, lang) {
  // a correct rule-out (Module A triage): id is "decline_<itemId>". Points =
  // base (3) + reason quality (0..2), read live from the triage state. The
  // feedback reuses the item's PENALTIES `why` — the very reason it was not
  // indicated, now surfaced as positive reinforcement for holding off.
  const decm = /^decline_(.+)$/.exec(ev);
  if (decm) {
    const id = decm[1];
    const t = (typeof triage !== "undefined" && triage[id]) || null;
    const q = _reasonQuality(id, t && t.reason);
    const pts = (typeof _declinePoints === "function" ? _declinePoints : function () { return 0; })(id, t && t.reason);   // reward path only: +5 (best) or +2 (ok)
    const pens = (typeof PENALTIES !== "undefined" ? PENALTIES : []);
    const p = pens.find(x => x && x.item === id);
    return {
      points: pts, tier: "milestone", module: "A",
      title: q === 2 ? "Sharp call — the right reason" : "Good call — an acceptable reason",
      why: p ? tc(p.why, lang) : "",
      did: "Your room correctly ruled out an investigation this case does not need."
    };
  }
  // ordering an INDICATED test: id is "order_<itemId>" — a small token that
  // "ordering the right thing is right", balancing the decline reward.
  const ordm = /^order_(.+)$/.exec(ev);
  if (ordm) {
    return {
      points: 2, tier: "micro", module: "A",
      title: "Ordered the right test",
      did: "Your room ordered an investigation this case genuinely needs."
    };
  }
  return null;
}

/* Moved out of script.js's checkScoreEvents:wants — triage-only scoring, so it
   belongs with the feature rather than in the eager bundle. */
function _triageWants(setWant) {
  // Module A appropriateness triage: reward correctly ruling out an
  // inappropriate investigation (graded by the reason via scoreEventMeta) and
  // ordering an INDICATED test. Penalties for wrong rule-outs are handled in
  // the penalties pass below. Points are written by the want-loop that follows.
  if (TRIAGE_ON && triage) {
    Object.keys(triage).forEach(id => {
      const t = triage[id];
      /* Reward a correct rule-out ONLY when the reason earns points AND no
         penalty has already been banked against this item. Both halves matter
         now that a rule-out is refinable: score/penalties is write-ONCE in the
         rules (!data.exists()), so a declinereason_ penalty can never be
         cleared — without this guard, refining an off-target reason into a best
         one would KEEP the penalty and collect the reward on top. Refining is
         still allowed and still improves the on-screen feedback; it just does
         not pay twice. (CodeRabbit, #331.) */
      if (t && t.disposition === "ruleout" && !revealed[id] && PENALTY_ITEM_IDS.has(id)
          && (typeof _declinePoints === "function" ? _declinePoints : function () { return 0; })(id, t.reason) >= 0) {
        if (!((roomScore && roomScore.penalties) || {})["declinereason_" + id]) {
          setWant("decline_" + id);
        }
      }
    });
    ITEM_IDS.forEach(id => {
      const it = itemById(id);
      /* _isIndicated, not it.key: this PR marks indicated items with
         `indicated: true`. The only items carrying `key: true` are each
         scenario's labs[0] — which IS SYNTH_ID and excluded on the next
         clause — so gating on it.key made this reward unreachable in every
         shipped scenario, and the "balances the decline reward" comment above
         was describing something that never fired. (CodeRabbit, #331.) */
      if (revealed[id] && _isIndicated(it) && id !== SYNTH_ID) setWant("order_" + id);
    });
  }

}

/* Moved out of script.js's checkScoreEvents:penalties — triage-only scoring, so it
   belongs with the feature rather than in the eager bundle. */
function _triagePenaltyPass() {
  // --- DECLINE PENALTIES: ruling out an INDICATED test costs the team a small
  //     amount (the mirror of the decline reward). Idempotent, like the rest. ---
  if (TRIAGE_ON && triage && typeof itemById === "function") {
    const dpen = roomScore.penalties || {};
    Object.keys(triage).forEach(id => {
      const t = triage[id];
      if (!t || t.disposition !== "ruleout" || revealed[id]) return;
      // Inappropriate test ruled out with an OFF-TARGET reason → lose points
      // (the decision was right; the clinical reasoning was wrong).
      if (PENALTY_ITEM_IDS.has(id)) {
        const pts = (typeof _declinePoints === "function" ? _declinePoints : function () { return 0; })(id, t.reason);
        if (pts >= 0) return;                                // rewarded in the want-loop
        const rpid = "declinereason_" + id;
        if (dpen[rpid]) return;
        refScore.child("penalties").child(rpid).transaction(cur =>
          (cur == null ? { points: -pts, at: Date.now() } : undefined)
        ).then(res => {
          if (res && res.committed) logEvent(myRoom, "score.penalty", { penaltyId: rpid, points: -pts });
        }).catch(e => console.error("Decline-reason penalty write failed", e));
        return;
      }
      // Indicated item ruled out → wrong decision (reason moot).
      const item = itemById(id);
      if (!item || !_isIndicated(item) || id === SYNTH_ID) return;
      const pid = "declinepen_" + id;
      if (dpen[pid]) return;
      refScore.child("penalties").child(pid).transaction(cur =>
        (cur == null ? { points: DECLINE_INDICATED_PENALTY, at: Date.now() } : undefined)
      ).then(res => {
        if (res && res.committed) logEvent(myRoom, "score.penalty", { penaltyId: pid, points: DECLINE_INDICATED_PENALTY });
      }).catch(e => console.error("Decline-penalty write failed", e));
    });
  }

}

/* ===================== MODULE A — APPROPRIATENESS TRIAGE ==================
 * Slice 1 (Investigations block, flag-gated ?triage=1). Adds a symmetric
 * "Order vs Rule out (+ graded reason)" decision to each investigation:
 *   - Ordering stays the existing single tap (reveal); an un-indicated order
 *     still costs points via PENALTIES.
 *   - Ruling out an INAPPROPRIATE test EARNS points (mirror of the penalty),
 *     graded by the reason chosen (best +2 / ok +1 / off-target +0, on a base
 *     of +3 => 3..5).
 *   - Ruling out an INDICATED test costs a small penalty (-4).
 * Shared per-room state (mirrors `revealed`): one teammate's disposition is
 * seen by the whole room. Persisted per SLOT at sections/<slot>/triage/<itemId>, mirroring
 * `revealed`. REFINABLE — unlike reveal(), a rule-out can be REVISED: a team
 * that talks it through and picks a sharper reason may say so, and the DB rule
 * agrees (no !data.exists() on triage/$itemId), which is what the emulator test
 * has always asserted. What stays one-way is the ORDER / RULE-OUT split: a
 * ruled-out item can't then be ordered, and vice-versa.
 * Refinement does NOT pay twice. score/penalties is write-ONCE in the rules, so
 * a declinereason_ penalty can never be cleared; the reward is therefore
 * withheld once one has been banked for that item (see _triageWants).
 * See database.rules.json (sessions + orgs) and the scoring hooks in
 * checkScoreEvents / scoreEventMeta / penaltyMeta.
 * ========================================================================== */
