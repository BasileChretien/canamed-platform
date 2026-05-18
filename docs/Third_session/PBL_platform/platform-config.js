/* ===========================================================================
 * CaNaMED platform configuration  -  the PER-DEPLOYMENT file.
 *
 * The platform engine (script.js) reads the partnership, branding and cohort
 * colours from here. Nothing about "France" or "Japan" is hard-coded in the
 * engine - to run CaNaMED for a different set of partner universities, edit
 * THIS file only:
 *
 *   - per-DEPLOYMENT identity (who is taking part, what it is called) -> here
 *   - per-SESSION clinical content (the case, the prompts)            -> case-content.js
 *   - the live Firebase credentials                                  -> firebase-config.js
 *
 * `cohorts` may hold TWO OR MORE partner universities. Each cohort's `id` is
 * the value stored against every student, every answer and every score check,
 * so it must stay stable once a session has started. `color` is that cohort's
 * identity colour in the UI (chips, the brand mark). Loaded before
 * case-content.js and script.js (see the <script> order in index.html).
 * =========================================================================== */
window.CANAMED_CONFIG = {
  /* Session codes are now CREATED BY FACILITATORS from the CANAMED splash
     ("Create a session"). Each code identifies one workshop session and is
     what students type on the splash to join. There is no platform-wide code
     to hard-code here - hand out the per-session code generated in the app. */

  /* what this workshop is called - shown in the header, the lobby hero and the
     browser title. Change freely for a new partnership / session. */
  workshopName: "CaNaMED Session 3",
  tagline: "Learning From Each Other",
  subtitle: "Franco-Japanese Medical Workshop",
  institutionsLine: "Université de Caen Normandie × Nagoya University",
  heroTagline: "Two traditions, one conversation",

  /* the partner universities. Two are shown here; add a third object to run a
     three-way partnership - the room-balancing, the cohort dropdown and the
     "every partner contributed" scoring all adapt automatically. */
  cohorts: [
    {
      id: "Caen",
      label: "Université de Caen Normandie (France)",
      short: "Caen",
      country: "France",
      color: "#b45309"
    },
    {
      id: "Nagoya",
      label: "Nagoya University (Japan)",
      short: "Nagoya",
      country: "Japan",
      color: "#1763a6"
    }
  ]
};
