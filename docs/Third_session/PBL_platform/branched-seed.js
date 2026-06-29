/* branched-seed.js
 *
 * First built-in scenario for the branched-scenarios format — "The breathless
 * patient on the ward". A branched scenario is NOT a new runtime: each node is
 * a decision (the existing engine), an option forks the case by UNLOCKING a
 * follow-up via unlockWhen.afterDecision, and the chosen option's branch.reveal
 * narrates the consequence. Scoring rides the existing engine too: the option
 * marked `correct` awards `points`; any other committed option costs `penalty`.
 *
 * The whole tree runs in ONE épuré stage (every node is module "A", so it
 * renders in stage-1's decision column): recognise the deterioration →
 * escalate → the frightened daughter at the bedside. Keeping it single-stage
 * sidesteps Module B's roleplay phase/role machinery, which a pure decision
 * flow has no use for. Branches CONVERGE (both early choices reach the next
 * node) to keep the tree bounded; only the consequence narrative differs, so a
 * poor early call colours what the team walks into next without exploding the
 * content.
 *
 * Content is ENGLISH-ONLY by design: the in-product hovering reader supplies
 * FR/JA at read-time (the platform's English-canonical strategy), so prompts/
 * options/reveals carry just `{ en }`. tc() falls back to en for any language.
 *
 * The module is dependency-free and dual-purpose: under Node it exports the
 * scenario object (so tests can run the graph validator on it); in the browser
 * it publishes window.CANAMED_BRANCHED_SEED, which case-content.js merges into
 * window.CANAMED_SCENARIOS after building its own registry.
 */
(function (root) {
  "use strict";

  const SEED = {
    id: "ward-escalation-branched",
    format: "branched",
    name: { en: "The Breathless Patient on the Ward" },
    summary: {
      en:
        "A branched, decision-by-decision case. Mr Okada, 68, is breathless on " +
        "day 2 after surgery. Your team makes one call at a time — and each " +
        "choice changes what happens next. Act I is recognising and escalating " +
        "the deterioration; Act II is the conversation with his frightened " +
        "daughter at the bedside.",
    },
    moduleAName: { en: "The breathless patient" },
    // No Module B: a branched scenario is a single-stage decision flow
    // (Welcome → the case → Wrap-up). There is no roleplay/reflection phase.
    // No clinical workup, pre/post-test or synthesis: a branched scenario is
    // pure decision flow. Empty stand-ins keep case-derived code from choking.
    case: { history: [], exam: [], labs: [] },
    scoring: {},
    penalties: [],
    synthPrereqs: [],
    decisions: [
      {
        id: "b_assess",
        module: "A",
        points: 20,
        penalty: 15,
        documents: [
          {
            title: { en: "Bedside observations" },
            text: {
              en:
                "RR 28 · SpO₂ 88% on air · BP 95/60 · HR 118 · T 37.4°C. Clammy and " +
                "anxious, speaking only in short phrases.",
            },
          },
        ],
        prompt: {
          en:
            "You are called to Mr Okada, 68, two days after bowel surgery. He is " +
            "suddenly breathless and clammy. Your team's FIRST move is…",
        },
        options: [
          {
            text: {
              en: "Sit him up, give high-flow oxygen, and reassess at the bedside",
            },
            correct: true,
            why: {
              en:
                "Treat the patient in front of you before the screen. Oxygen and " +
                "positioning buy minutes and information at no cost — the right " +
                "first move in any acute deterioration.",
            },
            branch: {
              reveal: {
                en:
                  "SpO₂ climbs to 94%. He can manage short sentences now. You have " +
                  "bought yourselves time to think clearly.",
              },
            },
          },
          {
            text: {
              en: "Order an urgent chest X-ray and wait for the film before acting",
            },
            correct: false,
            why: {
              en:
                "Investigation is not resuscitation. A breathless, hypoxic patient " +
                "needs oxygen and hands-on assessment now; the image can follow.",
            },
            branch: {
              reveal: {
                en:
                  "Twenty minutes pass waiting for the film. He tires visibly and his " +
                  "SpO₂ drifts down to 84% before anyone lays hands on him.",
              },
            },
          },
        ],
      },
      {
        id: "b_escalate",
        module: "A",
        points: 20,
        penalty: 15,
        // The GOOD path: only opens when the team treated FIRST (b_assess option 0).
        unlockWhen: { afterDecision: { id: "b_assess", option: 0 } },
        hideWhenLocked: true,
        documents: [
          {
            title: { en: "After oxygen — repeat observations" },
            text: { en: "SpO₂ 94% on 15 L · RR 24 · BP 100/64 · HR 110. Warmer peripherally." },
          },
          {
            title: { en: "Arterial blood gas (on O₂)" },
            text: { en: "pH 7.31 · PaCO₂ 4.0 kPa · PaO₂ 9.8 kPa · lactate 4.2 · HCO₃⁻ 17." },
          },
          {
            title: { en: "Chest X-ray (PA)" },
            image: "scenario-images/chest-xray-pa-normal.jpg",
            alt: {
              en:
                "Posteroanterior chest radiograph: clear lung fields, no focal " +
                "consolidation, effusion or pneumothorax; normal cardiac silhouette.",
            },
            text: {
              en:
                "The film is essentially clear — no consolidation, effusion or " +
                "pneumothorax to explain the hypoxia. With a rising lactate two days " +
                "after bowel surgery, let the X-ray steer you AWAY from anchoring on " +
                "the lungs: think extrapulmonary sepsis (an intra-abdominal source) " +
                "or pulmonary embolism. What is your team's reading?",
            },
            credit: { en: "Image: Mikael Häggström, CC0 1.0, via Wikimedia Commons." },
          },
        ],
        prompt: {
          en:
            "He is a little steadier but clearly unwell, and you are not sure why. " +
            "What does your team do now?",
        },
        options: [
          {
            text: {
              en: "Call for senior help early and start a sepsis screen — lactate, cultures, fluids",
            },
            correct: true,
            why: {
              en:
                "Early escalation and a structured sepsis screen are what change " +
                "outcomes. Asking for help promptly is a strength, not a failure.",
            },
            branch: {
              reveal: {
                en:
                  "Lactate is 4.2. Your senior arrives within minutes and antibiotics " +
                  "are running inside the hour. The team feels in control.",
              },
            },
          },
          {
            text: {
              en: "Manage it yourselves for now to avoid disturbing the on-call consultant",
            },
            correct: false,
            why: {
              en:
                "Reluctance to escalate is a classic, avoidable cause of harm. The " +
                "consultant would far rather be called early than late.",
            },
            branch: {
              reveal: {
                en:
                  "Forty minutes slip by. He becomes confused and his pressure sags. The " +
                  "senior, called late, arrives dismayed at how much ground was lost.",
              },
            },
          },
        ],
      },
      {
        id: "b_family",
        module: "A",
        points: 20,
        penalty: 15,
        unlockWhen: { afterDecision: "b_escalate" },
        hideWhenLocked: true,
        prompt: {
          en:
            "Mr Okada's adult daughter hurries in, frightened. She asks: \"Is my " +
            "father going to be alright? Please don't frighten him — he is a proud " +
            'man." Your team responds by…',
        },
        options: [
          {
            text: {
              en: "Reassuring her that everything is under control so she stops worrying",
            },
            correct: false,
            why: {
              en:
                "False reassurance feels kind for a moment but breaks trust the " +
                "instant things change — and they may. Comfort is not the same as honesty.",
            },
            branch: {
              reveal: {
                en:
                  "She is briefly comforted. But when he deteriorates that evening she " +
                  "feels misled, and the family's trust in the team never fully returns.",
              },
            },
          },
          {
            text: {
              en: "Acknowledging her fear, giving an honest, gentle picture, and asking how he likes to receive news",
            },
            correct: true,
            why: {
              en:
                "Naming the fear, telling the truth gently, and checking the patient's " +
                "own wishes honours both the family and his autonomy — the cross-cultural " +
                "skill at the heart of the case.",
            },
            branch: {
              reveal: {
                en:
                  'She exhales. "Thank you for being straight with me." She tells you he ' +
                  "would want to know himself — calmly, with her beside him.",
              },
            },
          },
          {
            text: {
              en: "Telling her you cannot discuss anything without the patient's consent, and moving on",
            },
            correct: false,
            why: {
              en:
                "The rule is right but the moment is wrong. Confidentiality can be " +
                "honoured warmly; delivered coldly, it abandons a frightened relative.",
            },
            branch: {
              reveal: {
                en:
                  "Technically correct, coldly delivered. She feels shut out at the worst " +
                  "possible moment and withdraws to the corridor in tears.",
              },
            },
          },
        ],
      },
      {
        id: "b_deteriorate",
        module: "A",
        points: 20,
        penalty: 15,
        // The BAD path: the team delayed treatment for the film (b_assess option 1).
        unlockWhen: { afterDecision: { id: "b_assess", option: 1 } },
        hideWhenLocked: true,
        documents: [
          {
            title: { en: "Twenty minutes later — observations" },
            text: {
              en:
                "SpO₂ 82% on air · RR 32 · BP 84/50 · HR 130 · now drowsy. The X-ray " +
                "has still not been taken.",
            },
          },
        ],
        prompt: {
          en: "Mr Okada is now peri-arrest and you still have no film. Your team…",
        },
        options: [
          {
            text: {
              en: "Put out a medical emergency call, give high-flow oxygen, and work through ABCDE",
            },
            correct: true,
            why: {
              en:
                "Recognise-and-rescue: escalate loudly and resuscitate. The film was " +
                "never worth waiting for while he decompensated.",
            },
            branch: {
              reveal: {
                en:
                  "The team arrives fast. He is stabilised and moved to HDU — shaken but " +
                  "alive. A hard lesson in treating before imaging.",
              },
            },
          },
          {
            text: {
              en: "Keep waiting for the X-ray so you can make the right diagnosis first",
            },
            correct: false,
            why: {
              en:
                "Diagnosis never precedes resuscitation in a crashing patient. Waiting " +
                "for certainty here costs him.",
            },
            branch: {
              reveal: {
                en:
                  "He arrests before the film is taken; the arrest call goes out late and " +
                  "the outcome is poor. The case ends here — debrief what went wrong.",
              },
            },
          },
        ],
      },
    ],
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SEED;
  if (typeof root !== "undefined") {
    root.CANAMED_BRANCHED_SEED = SEED;
    // Augment the scenario registry. This module is loaded by script-loader's
    // ensureCaseContent() AFTER case-content.js (which assigns
    // window.CANAMED_SCENARIOS = {…}), so merging here adds the branched
    // scenario without being clobbered by that assignment.
    root.CANAMED_SCENARIOS = root.CANAMED_SCENARIOS || {};
    root.CANAMED_SCENARIOS[SEED.id] = SEED;
  }
})(typeof window !== "undefined" ? window : this);
