/* CaNaMED first-time facilitator onboarding tour.
 *
 * A vanilla-DOM, non-blocking overlay tour that walks a first-time
 * facilitator through:
 *
 *   - the "Create a session" splash view (set: "create") — workshop
 *     label, scenario picker, password, what happens next
 *   - the admin dashboard once they're inside (set: "admin") — rooms
 *     overview, advance-all, opening a room, ending the session
 *
 * The tour is VERY skippable: ESC dismisses, clicking outside the
 * bubble dismisses, every bubble has a Skip button. Each set is
 * versioned via its own localStorage key so we can bump the version
 * when the UI changes meaningfully without re-prompting users for
 * every minor tweak.
 *
 *   localStorage.canamed_tour_done       === "v1"  → create tour done
 *   localStorage.canamed_tour_admin_done === "v1"  → admin tour done
 *
 * CSP-friendly: no inline scripts, no inline styles, no external
 * dependencies. Bubble positioning uses getBoundingClientRect on the
 * anchor element (referenced by id via the tour-step's `anchor`
 * property) and CSS classes for placement.
 *
 * Exposes: window.CanamedTour.{ start, dismiss, isDone, addReopenLink }.
 */

(function (root, factory) {
  const exp = factory();
  if (typeof window !== "undefined") {
    window.CanamedTour = exp;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "v1";
  const STORAGE = {
    create: "canamed_tour_done",
    admin: "canamed_tour_admin_done"
  };

  /* ============================================================
   * Tour step definitions.
   *
   * Each step has:
   *   - anchor: DOM id of the element the bubble points at, or null
   *             for a centred "splash" bubble (used for intro/outro).
   *   - titleKey, bodyKey: i18n keys (resolved via window.t at render
   *             time so a mid-tour language switch is respected).
   *   - placement: "top" | "bottom" | "left" | "right" | "center"
   *             (a hint — the layout engine flips if it would clip
   *             off-screen).
   * ============================================================ */
  const STEPS = {
    create: [
      { anchor: "splash-create-label",
        titleKey: "tour.create.1.title", bodyKey: "tour.create.1.body",
        placement: "right" },
      { anchor: "splash-create-scenario",
        titleKey: "tour.create.2.title", bodyKey: "tour.create.2.body",
        placement: "right" },
      { anchor: "splash-create-pass",
        titleKey: "tour.create.3.title", bodyKey: "tour.create.3.body",
        placement: "right" },
      { anchor: "splash-create-submit",
        titleKey: "tour.create.4.title", bodyKey: "tour.create.4.body",
        placement: "top" }
    ],
    admin: [
      { anchor: "dashboard",
        titleKey: "tour.admin.1.title", bodyKey: "tour.admin.1.body",
        placement: "top" },
      { anchor: "advance-all-btn",
        titleKey: "tour.admin.2.title", bodyKey: "tour.admin.2.body",
        placement: "bottom" },
      { anchor: "dashboard",
        titleKey: "tour.admin.3.title", bodyKey: "tour.admin.3.body",
        placement: "top" },
      { anchor: "admin-close-btn",
        titleKey: "tour.admin.4.title", bodyKey: "tour.admin.4.body",
        placement: "top" }
    ]
  };

  // module-scope state — only one tour at a time. start() is idempotent
  // for the same set; calling it for a different set dismisses the prior
  // one first to avoid two overlays stacking.
  let active = null;  // { set, index, root, onKey, onResize, onScroll }

  function tr(key) {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      return window.t(key);
    }
    return key;
  }

  function isDone(set) {
    try {
      return localStorage.getItem(STORAGE[set]) === VERSION;
    } catch (e) {
      // localStorage unavailable — treat as not-done; the tour will
      // still run once per page load (no persistence), which is the
      // gentler degradation than running on every load.
      return false;
    }
  }

  function markDone(set) {
    try { localStorage.setItem(STORAGE[set], VERSION); } catch (e) {}
  }

  function clearDone(set) {
    try { localStorage.removeItem(STORAGE[set]); } catch (e) {}
  }

  /* ============================================================
   * Layout engine — positions the bubble next to its anchor without
   * clipping the viewport. Uses CSS classes for the visual placement
   * (arrow direction) and sets bubble + spotlight left/top via the
   * style property only for x/y coordinates (allowed under CSP since
   * we're not parsing user-controlled strings).
   * ============================================================ */
  function position(bubble, spotlight, anchorEl, placement) {
    const margin = 14;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // No anchor (or anchor not on screen): centre the bubble; hide spotlight.
    if (!anchorEl) {
      bubble.classList.add("canamed-tour-bubble--center");
      bubble.classList.remove(
        "canamed-tour-bubble--top",
        "canamed-tour-bubble--bottom",
        "canamed-tour-bubble--left",
        "canamed-tour-bubble--right"
      );
      const bw = bubble.offsetWidth || 320;
      const bh = bubble.offsetHeight || 200;
      bubble.style.left = Math.max(margin, (vw - bw) / 2) + "px";
      bubble.style.top = Math.max(margin, (vh - bh) / 2) + "px";
      spotlight.classList.add("canamed-tour-spotlight--hidden");
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    // anchor offscreen entirely → fall back to centre
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      position(bubble, spotlight, null, "center");
      return;
    }

    spotlight.classList.remove("canamed-tour-spotlight--hidden");
    const pad = 8;
    const spotL = Math.max(0, rect.left - pad);
    const spotT = Math.max(0, rect.top - pad);
    const spotW = Math.min(vw - spotL, rect.width + pad * 2);
    const spotH = Math.min(vh - spotT, rect.height + pad * 2);
    spotlight.style.left = spotL + "px";
    spotlight.style.top = spotT + "px";
    spotlight.style.width = spotW + "px";
    spotlight.style.height = spotH + "px";

    // measure bubble after content has been written
    const bw = bubble.offsetWidth || 320;
    const bh = bubble.offsetHeight || 200;

    let p = placement || "bottom";
    // flip if the requested placement would clip
    if (p === "top" && rect.top - bh - margin < 0) p = "bottom";
    if (p === "bottom" && rect.bottom + bh + margin > vh) p = "top";
    if (p === "left" && rect.left - bw - margin < 0) p = "right";
    if (p === "right" && rect.right + bw + margin > vw) p = "left";

    bubble.classList.remove(
      "canamed-tour-bubble--top",
      "canamed-tour-bubble--bottom",
      "canamed-tour-bubble--left",
      "canamed-tour-bubble--right",
      "canamed-tour-bubble--center"
    );
    bubble.classList.add("canamed-tour-bubble--" + p);

    let x, y;
    if (p === "top") {
      x = clamp(rect.left + rect.width / 2 - bw / 2, margin, vw - bw - margin);
      y = Math.max(margin, rect.top - bh - margin);
    } else if (p === "bottom") {
      x = clamp(rect.left + rect.width / 2 - bw / 2, margin, vw - bw - margin);
      y = Math.min(vh - bh - margin, rect.bottom + margin);
    } else if (p === "left") {
      x = Math.max(margin, rect.left - bw - margin);
      y = clamp(rect.top + rect.height / 2 - bh / 2, margin, vh - bh - margin);
    } else { // right
      x = Math.min(vw - bw - margin, rect.right + margin);
      y = clamp(rect.top + rect.height / 2 - bh / 2, margin, vh - bh - margin);
    }
    bubble.style.left = x + "px";
    bubble.style.top = y + "px";
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ============================================================
   * Render the active step. Pulls fresh i18n strings on every render
   * so a mid-tour language switch is reflected immediately if the
   * user changes it via the header switcher.
   * ============================================================ */
  function render() {
    if (!active) return;
    const step = STEPS[active.set][active.index];
    const total = STEPS[active.set].length;
    const isFirst = active.index === 0;
    const isLast = active.index === total - 1;
    const anchorEl = step.anchor ? document.getElementById(step.anchor) : null;

    const bubble = active.root.querySelector(".canamed-tour-bubble");
    const spotlight = active.root.querySelector(".canamed-tour-spotlight");

    bubble.innerHTML = "";

    const titleNode = document.createElement("h3");
    titleNode.className = "canamed-tour-title";
    titleNode.textContent = tr(step.titleKey);
    bubble.appendChild(titleNode);

    const bodyNode = document.createElement("p");
    bodyNode.className = "canamed-tour-body";
    bodyNode.textContent = tr(step.bodyKey);
    bubble.appendChild(bodyNode);

    const progress = document.createElement("p");
    progress.className = "canamed-tour-progress";
    progress.textContent = tr("tour.progress")
      .replace("{n}", String(active.index + 1))
      .replace("{total}", String(total));
    bubble.appendChild(progress);

    const row = document.createElement("div");
    row.className = "canamed-tour-row";

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "canamed-tour-btn canamed-tour-btn--skip";
    skipBtn.textContent = tr("tour.btn.skip");
    skipBtn.addEventListener("click", () => dismiss(true));
    row.appendChild(skipBtn);

    const spacer = document.createElement("span");
    spacer.className = "canamed-tour-spacer";
    row.appendChild(spacer);

    if (!isFirst) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "canamed-tour-btn canamed-tour-btn--back";
      backBtn.textContent = tr("tour.btn.back");
      backBtn.addEventListener("click", () => goTo(active.index - 1));
      row.appendChild(backBtn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "canamed-tour-btn canamed-tour-btn--next";
    nextBtn.textContent = isLast ? tr("tour.btn.done") : tr("tour.btn.next");
    nextBtn.addEventListener("click", () => {
      if (isLast) dismiss(true);
      else goTo(active.index + 1);
    });
    row.appendChild(nextBtn);

    bubble.appendChild(row);

    position(bubble, spotlight, anchorEl, step.placement);

    // Defer focus so it lands after layout — accessibility benefit
    // (the bubble is reachable by keyboard immediately) without
    // stealing focus from a currently-typing user mid-tour.
    setTimeout(() => {
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { nextBtn.focus(); }
    }, 20);
  }

  function goTo(i) {
    if (!active) return;
    const total = STEPS[active.set].length;
    active.index = Math.max(0, Math.min(total - 1, i));
    render();
  }

  /* ============================================================
   * Build the overlay + bubble DOM once. The overlay layers below
   * the bubble; clicking the overlay (outside the bubble) advances
   * (or dismisses on the last step) — same as Next. ESC dismisses
   * unconditionally.
   * ============================================================ */
  function buildRoot(set) {
    const root = document.createElement("div");
    root.className = "canamed-tour-root";
    root.setAttribute("data-tour-set", set);
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-label", "CaNaMED onboarding tour");

    const overlay = document.createElement("div");
    overlay.className = "canamed-tour-overlay";
    overlay.addEventListener("click", () => {
      if (!active) return;
      const total = STEPS[active.set].length;
      if (active.index >= total - 1) dismiss(true);
      else goTo(active.index + 1);
    });
    root.appendChild(overlay);

    const spotlight = document.createElement("div");
    spotlight.className = "canamed-tour-spotlight";
    root.appendChild(spotlight);

    const bubble = document.createElement("div");
    bubble.className = "canamed-tour-bubble";
    // stop clicks inside the bubble from bubbling to the overlay (which
    // would otherwise advance the tour every time the user clicks Skip,
    // Back, or any text inside)
    bubble.addEventListener("click", e => e.stopPropagation());
    root.appendChild(bubble);

    return root;
  }

  function start(set) {
    if (!STEPS[set]) return;
    if (typeof document === "undefined") return;
    // If a tour is already running, dismiss it (without marking done)
    // before starting a new one. Avoids two overlays stacking.
    if (active) dismiss(false);

    const root = buildRoot(set);
    document.body.appendChild(root);

    active = { set, index: 0, root, onKey: null, onResize: null, onScroll: null };

    active.onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(true);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        // Enter advances, but only if focus is NOT inside an input/textarea
        // (the create-form lives behind the tour and we don't want to
        // accidentally submit it)
        const a = document.activeElement;
        if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
        const total = STEPS[active.set].length;
        if (active.index >= total - 1) dismiss(true);
        else goTo(active.index + 1);
      } else if (e.key === "ArrowLeft") {
        if (active.index > 0) goTo(active.index - 1);
      }
    };
    active.onResize = () => render();
    active.onScroll = () => render();

    document.addEventListener("keydown", active.onKey, true);
    window.addEventListener("resize", active.onResize);
    window.addEventListener("scroll", active.onScroll, true);

    render();
  }

  function dismiss(persist) {
    if (!active) return;
    const set = active.set;
    document.removeEventListener("keydown", active.onKey, true);
    window.removeEventListener("resize", active.onResize);
    window.removeEventListener("scroll", active.onScroll, true);
    if (active.root && active.root.parentNode) {
      active.root.parentNode.removeChild(active.root);
    }
    active = null;
    if (persist) markDone(set);
  }

  /* ============================================================
   * Helper: turn an existing element into a "show tour again" link
   * for a given set. Idempotent (safe to call repeatedly — only the
   * first call wires up the click handler).
   * ============================================================ */
  function addReopenLink(elementId, set) {
    const node = document.getElementById(elementId);
    if (!node || node.dataset.canamedTourReopen) return;
    node.dataset.canamedTourReopen = "1";
    node.addEventListener("click", (e) => {
      e.preventDefault();
      clearDone(set);
      start(set);
    });
  }

  return {
    start: start,
    dismiss: () => dismiss(false),
    isDone: isDone,
    addReopenLink: addReopenLink,
    _STEPS: STEPS,   // exposed for unit-test inspection
    _VERSION: VERSION
  };
});
