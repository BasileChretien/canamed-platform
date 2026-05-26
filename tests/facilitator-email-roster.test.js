/* tests/facilitator-email-roster.test.js
 *
 * #14 — facilitator-only participant email roster. Email is new PII: the
 * session read model is "any member can read the session tree", so email must
 * NOT live under /sessions. It is captured into a top-level /rosters subtree
 * whose read is locked to the session CREATOR (creatorUid), with each
 * participant able to write ONLY their own entry. Static structure + source
 * checks; the live allow/deny boundary is proven by the emulator spec
 * tests-e2e/emulator/roster-rules.spec.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const SCRIPT = fs.readFileSync(path.join(P, "script.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const INDEX = fs.readFileSync(path.join(P, "index.html"), "utf8");
const RULES = require(path.join(P, "database.rules.json")).rules;
const I18N = require("./_i18n_source.js").readI18nSource();

test("rosters is a top-level node, denied by default, with a creator-only read", () => {
  const r = RULES.rosters;
  assert.ok(r, "a top-level /rosters node must exist");
  assert.strictEqual(r[".read"], false, "/rosters defaults to read:false");
  assert.strictEqual(r[".write"], false, "/rosters defaults to write:false");
  const sess = r.sessions["$sessionId"];
  assert.ok(sess, "rosters/sessions/$sessionId must exist");
  // read locked to the session creator
  assert.match(sess[".read"], /creatorUid/,
    "roster read must be gated on the session creatorUid");
  assert.match(sess[".read"], /auth\.uid/, "roster read must compare to auth.uid");
});

test("a participant may write only their OWN roster entry; the creator may write any", () => {
  const uidRule = RULES.rosters.sessions["$sessionId"]["$uid"];
  assert.ok(uidRule && uidRule[".write"], "rosters/.../$uid must have a write rule");
  assert.match(uidRule[".write"], /auth\.uid === \$uid/,
    "a participant may write their own entry");
  assert.match(uidRule[".write"], /creatorUid/,
    "the creator may also write/clear entries");
  assert.match(uidRule[".write"], /closed/, "no roster writes after the session is closed");
  // only known fields allowed (email/name/university/at) + $other denied
  assert.ok(uidRule.email && uidRule.name && uidRule.university && uidRule.at,
    "email/name/university/at must be validated child fields");
  assert.strictEqual(uidRule["$other"][".validate"], false,
    "unknown roster fields must be rejected");
  assert.match(uidRule.email[".validate"], /254/, "email length is capped");
});

test("creatorUid is write-once, own-uid only, set before the password (both path trees)", () => {
  for (const node of [RULES.sessions["$sessionId"], RULES.orgs["$orgSlug"].sessions["$sessionId"]]) {
    const c = node.creatorUid;
    assert.ok(c, "creatorUid rule must exist");
    assert.match(c[".write"], /!data\.exists\(\)/, "creatorUid is write-once");
    assert.match(c[".write"], /newData\.val\(\) === auth\.uid/, "you can only claim your OWN uid");
    assert.match(c[".write"], /adminPasswordHash/, "creatorUid is bound to the pre-password create window");
  }
});

test("createSession records creatorUid in the create batch", () => {
  const i = SCRIPT.indexOf("function createSession");
  const fn = SCRIPT.slice(i, SCRIPT.indexOf("\nfunction ", i + 1));
  assert.match(fn, /creatorUid/, "createSession must write creatorUid");
  assert.match(fn, /oPath\(code, "creatorUid"\)/, "creatorUid is written at the session path");
});

test("writeRoster captures email only for signed-in, research-consenting participants", () => {
  const i = SCRIPT.indexOf("function writeRoster");
  assert.ok(i >= 0, "writeRoster() must exist");
  const fn = SCRIPT.slice(i, i + 1200);
  assert.match(fn, /isAnonymous/, "anonymous users write no email");
  assert.match(fn, /currentUser\.email/, "uses the Google email");
  assert.match(fn, /myConsent\.research !== true/, "gated on research consent");
  assert.match(fn, /"rosters\/" \+ sPath\(currentUser\.uid\)/, "writes to the facilitator-only roster path keyed by uid");
  // wired into the join chain
  assert.match(SCRIPT, /\.then\(\(\) => writeRoster\(\)\)/, "writeRoster must run during the participant join chain");
});

test("the facilitator can export the roster (creator-only read) as an identifiable CSV", () => {
  assert.match(ADMIN, /function generateEmailRoster/, "an email-roster export must exist");
  const i = ADMIN.indexOf("function generateEmailRoster");
  const fn = ADMIN.slice(i, i + 1600);
  assert.match(fn, /"rosters\/" \+ oPath\(code\)/, "reads the /rosters subtree for this session");
  assert.match(fn, /research_email_roster\.csv/, "downloads a clearly-named identifiable CSV");
  assert.match(ADMIN, /window\.generateEmailRoster = generateEmailRoster/, "exposed for runAdminTool");
});

test("an admin button is wired to the roster export and localised", () => {
  assert.match(INDEX, /id="admin-roster-btn"[^>]*data-i18n="impact\.roster"/s,
    "the admin dashboard must have a roster button bound to i18n");
  assert.match(SCRIPT, /admin-roster-btn[\s\S]{0,160}generateEmailRoster/,
    "the roster button must dispatch generateEmailRoster");
  const n = I18N.split('"impact.roster"').length - 1;
  assert.strictEqual(n, 3, "impact.roster must ship in en/fr/ja (got " + n + ")");
});
