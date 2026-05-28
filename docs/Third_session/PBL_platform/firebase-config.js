/* CaNaMED platform - configuration.
 *
 * LOCAL TEST mode (default): leave CANAMED_FIREBASE as null. The platform runs on a
 * built-in backend that persists to localStorage and syncs across tabs of the same
 * browser - so you can fully test the session (rooms, presence, admin dashboard,
 * collaborative answers) by opening several tabs, with no account. In this mode the
 * super-admin key is "test".
 *
 * SHARED mode: paste your free Firebase project's web config into CANAMED_FIREBASE
 * (see README.md for the 5-minute, no-credit-card setup). Different groups then
 * join the same URL from any device, each picks a room, and a session admin runs it.
 *
 * Example:
 * window.CANAMED_FIREBASE = {
 *   apiKey: "AIza...",
 *   authDomain: "your-project.firebaseapp.com",
 *   databaseURL: "https://your-project-default-rtdb.firebaseio.com",
 *   projectId: "your-project",
 *   appId: "1:...:web:..."
 * };
 */
window.CANAMED_FIREBASE = {
  apiKey: "AIzaSyB_7d4rCWsVSUAaL17Jcjy3v2s_n5uJVUg",
  authDomain: "canamed-69785.web.app",
  databaseURL: "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "canamed-69785",
  storageBucket: "canamed-69785.firebasestorage.app",
  messagingSenderId: "293347663114",
  appId: "1:293347663114:web:091c5ba1b9add59f85eef3"
};

/* SUPER-ADMIN KEY.
 * Whoever holds this key can set / change the session admin password from the
 * lobby. Choose a long random string. Regular admins do NOT need this - they only
 * need the session password the super admin sets.
 *
 * Note: if you publish the platform with GitHub Pages, this file is readable in
 * page source. For a classroom tool that is usually acceptable; if you need it
 * private, set the password once via the Firebase console instead, or run
 * super-admin actions from a local (unpublished) copy of this file.
 */
window.CANAMED_SUPERADMIN_KEY = null;

/* APP CHECK with reCAPTCHA v3 (free; no Cloud billing required).
 *
 * Firebase App Check verifies every request to the Realtime Database comes
 * from a real browser load of THIS exact site — defeats automated abuse
 * even when the attacker has acquired an anonymous-auth token. Without it,
 * the database is protected by rules only; with it, the database also
 * refuses requests that aren't accompanied by a fresh reCAPTCHA attestation.
 *
 * We use the FREE reCAPTCHA Classic v3 (10k assessments/month at no cost,
 * no credit card required) rather than reCAPTCHA Enterprise, which would
 * need the project upgraded to the Blaze plan with a billing account.
 *
 * The value below is the SITE KEY (public — appears in served HTML for
 * every visitor anyway). The SECRET KEY is pasted directly into Firebase
 * Console → App Check → CANAMED APP → reCAPTCHA → "reCAPTCHA secret key"
 * and never committed to source.
 *
 * To re-key:
 *   1. https://www.google.com/recaptcha/admin → register or pick a site
 *   2. Paste the new SITE key below
 *   3. Paste the new SECRET key in Firebase Console → App Check
 *
 * Set to null to disable — the platform still works, just without this
 * layer. See README.md → "Enabling App Check" for the full step-by-step.
 */
window.CANAMED_RECAPTCHA_SITE_KEY = "6Lemg-wsAAAAAKIkv6KorbZu0iUz_q3e36wrlFiQ";

/* PERFORMANCE MONITORING (optional, recommended for research deployments).
 *
 * Firebase Performance Monitoring auto-collects real-user timings — page
 * load, first contentful paint, time-to-first-byte, and every network
 * request. Useful research-side: "did Nagoya students experience the
 * platform as laggier than Caen students?" answers are visible in the
 * Firebase Console → Performance dashboard within ~24 h of the next
 * session.
 *
 * Privacy note: Performance Monitoring collects timing data, not content.
 * No participant text / consent / IDs are sent. Aggregate data only.
 * Still — disclose this in privacy.html if you turn it on, alongside the
 * other Firebase services. The privacy doc references this already.
 *
 * Set to true to enable. Default false so the SDK script is loaded but
 * inert; you can flip this without redeploying the SDK script tag.
 */
window.CANAMED_PERF_MONITORING = true;
