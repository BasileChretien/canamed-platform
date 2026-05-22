/* revisit.js — spaced-reinforcement retention self-check.
 *
 * Standalone page (revisit.html), OFF the splash critical path. Re-presents the
 * session's post-test a few days later as a self-check: spacing is what makes
 * learning stick, and re-testing both reinforces and measures retention. Reads
 * the scenario's postTest from window.CANAMED_SCENARIOS (case-content.js), runs
 * the quiz, and scores LOCALLY (no data leaves the device).
 *
 * CSP: external script (script-src 'self' forbids inline) — no inline handlers. */
(function () {
  "use strict";

  function qs(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }
  function tc(obj, lang) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    return obj[lang] || obj.en || obj[Object.keys(obj)[0]] || "";
  }
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var app = document.getElementById("revisit-app");
    if (!app) return;
    var lang = qs("lang") || "en";
    if (["en", "fr", "ja"].indexOf(lang) < 0) lang = "en";
    var sid = qs("s") || "";
    var scenarios = window.CANAMED_SCENARIOS || {};
    var sc = scenarios[sid] || scenarios[Object.keys(scenarios)[0]];

    if (!sc || !Array.isArray(sc.postTest) || !sc.postTest.length) {
      var p = document.createElement("p");
      p.className = "note";
      p.textContent = "This retention-check link is missing its scenario. " +
        "Ask your facilitator for the correct link.";
      app.appendChild(p);
      return;
    }

    var bank = sc.postTest;
    var state = { i: 0, score: 0, answered: false };
    var title = document.getElementById("revisit-scenario");
    if (title) title.textContent = tc(sc.name, lang);

    function render() {
      app.innerHTML = "";
      if (state.i >= bank.length) {
        var pct = Math.round((state.score / bank.length) * 100);
        var s = document.createElement("div");
        s.className = "q-score";
        s.textContent = "Your retention: " + state.score + " / " + bank.length + " (" + pct + "%)";
        app.appendChild(s);
        var msg = document.createElement("p");
        msg.textContent = pct >= 80
          ? "Excellent — this has stuck. Well done."
          : pct >= 50
            ? "Solid — a quick review of the ones you missed will lock it in."
            : "Worth a review — revisit the case notes and try again in a few days.";
        app.appendChild(msg);
        var again = document.createElement("button");
        again.className = "pbtn"; again.type = "button"; again.textContent = "Try again";
        again.addEventListener("click", function () { state = { i: 0, score: 0, answered: false }; render(); });
        app.appendChild(again);
        return;
      }

      var q = bank[state.i];
      var card = document.createElement("div");
      card.className = "q-card";
      var prog = document.createElement("div");
      prog.className = "sub";
      prog.textContent = "Question " + (state.i + 1) + " of " + bank.length;
      var qt = document.createElement("p");
      qt.className = "q-text";
      qt.textContent = tc(q.q, lang);
      card.appendChild(prog); card.appendChild(qt);

      var correctIdx = -1;
      (q.options || []).forEach(function (o, j) { if (o.correct) correctIdx = j; });

      (q.options || []).forEach(function (opt, idx) {
        var b = document.createElement("button");
        b.className = "q-opt"; b.type = "button";
        b.textContent = tc(opt.text, lang);
        b.addEventListener("click", function () {
          if (state.answered) return;
          state.answered = true;
          if (opt.correct) state.score++;
          Array.prototype.forEach.call(card.querySelectorAll(".q-opt"), function (bb, j) {
            bb.disabled = true;
            if (j === correctIdx) bb.classList.add("correct");
            if (j === idx && !opt.correct) bb.classList.add("wrong");
          });
          var exp = document.createElement("p");
          exp.className = "q-exp";
          exp.textContent = tc(q.explanation, lang);
          card.appendChild(exp);
          var next = document.createElement("button");
          next.className = "pbtn"; next.type = "button";
          next.textContent = state.i < bank.length - 1 ? "Next question" : "See my retention score";
          next.addEventListener("click", function () { state.i++; state.answered = false; render(); });
          card.appendChild(next);
        });
        card.appendChild(b);
      });
      app.appendChild(card);
    }

    render();
  });
})();
