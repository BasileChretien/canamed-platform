/* tests/no-platform-email.test.js
 *
 * The platform does not send email (decided 2026-09-24). Facilitators share
 * the retention (revisit.html) link with students themselves, so the dormant
 * transactional-mail scaffold of 2026-05-22 was removed: the sendQueuedMail
 * Cloud Function, the sessions/<code>/mail queue, the enqueueMail() admin
 * helper and the nodemailer / sanitize-html dependencies.
 *
 * These checks stop it creeping back piecemeal. The queue matters most: it
 * lived INSIDE the member-readable session tree, so any recipient address
 * written there was visible to every participant of the session — exactly
 * what the facilitator-only /rosters subtree exists to prevent. The emulator
 * suite (rules-smoke.spec.js, "the retired mail queue is denied") proves the
 * path is now closed to every writer, the session's creator included.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const read = (...p) => fs.readFileSync(path.join(P, ...p), "utf8");

const FN = read("functions", "index.js");
const PKG = JSON.parse(read("functions", "package.json"));
const RULES = JSON.parse(read("database.rules.json"));
const TOOLS = read("admin-tools.js");
const COMPLIANCE = read("compliance.html");

test("functions/index.js still parses and exports only hfPatient", () => {
  assert.doesNotThrow(() => new Function(FN), "functions/index.js must parse");
  assert.match(FN, /exports\.hfPatient\s*=\s*onCall\(/, "hfPatient must remain");
  const exported = (FN.match(/^exports\.(\w+)\s*=/gm) || []).map(s => s.replace(/^exports\.|\s*=$/g, ""));
  assert.deepStrictEqual(exported, ["hfPatient"], "no other function may be exported");
});

test("no mail sender, mail params or SMTP client in the functions codebase", () => {
  assert.doesNotMatch(FN, /sendQueuedMail\s*=|onValueCreated|require\("nodemailer"\)|require\("sanitize-html"\)/,
    "the transactional-mail function must not come back");
  assert.doesNotMatch(FN, /define\w+\("(EMAIL_ENABLED|SMTP_\w+)"/,
    "no EMAIL_ENABLED / SMTP_* params");
  const deps = Object.assign({}, PKG.dependencies, PKG.devDependencies);
  assert.ok(!deps.nodemailer, "functions must not depend on nodemailer");
  assert.ok(!deps["sanitize-html"], "functions must not depend on sanitize-html");
});

test("there is no mail queue in either session tree of the database rules", () => {
  const r = RULES.rules;
  const session = r.sessions.$sessionId;
  const orgSession = r.orgs.$orgSlug.sessions.$sessionId;
  assert.ok(!("mail" in session), "sessions/$sessionId/mail must not be ruled open");
  assert.ok(!("mail" in orgSession), "orgs/$orgSlug/sessions/$sessionId/mail must not be ruled open");
});

test("nothing above either old mail path grants a write that would re-open it", () => {
  /* Deleting the child rule only closes sessions/<code>/mail because no
     ANCESTOR grants a write — RTDB rules cascade, so a .write anywhere on the
     path would re-open it, and a $wildcard sibling in the session node would
     match "mail" itself. Check every level of both trees, not just the parent. */
  const r = RULES.rules;
  const grants = (node) => (".write" in node) && node[".write"] !== false && node[".write"] !== "false";
  const ancestors = [
    ["rules", r],
    ["sessions", r.sessions],
    ["sessions/$sessionId", r.sessions.$sessionId],
    ["orgs", r.orgs],
    ["orgs/$orgSlug", r.orgs.$orgSlug],
    ["orgs/$orgSlug/sessions", r.orgs.$orgSlug.sessions],
    ["orgs/$orgSlug/sessions/$sessionId", r.orgs.$orgSlug.sessions.$sessionId]
  ];
  for (const [where, node] of ancestors) {
    assert.ok(node && typeof node === "object", where + " must exist in the rules");
    assert.ok(!grants(node), where + " must not carry a .write grant — it would cascade to .../mail");
  }
  for (const [where, node] of [ancestors[2], ancestors[6]]) {
    assert.ok(!Object.keys(node).some(k => k.startsWith("$")),
      where + " must not have a $wildcard child — it would match \"mail\"");
  }
});

test("the admin tools no longer expose an enqueue helper", () => {
  assert.doesNotMatch(TOOLS, /enqueueMail|sPath\("mail"\)/, "enqueueMail must not come back");
});

test("the compliance statement says the platform sends no email", () => {
  assert.match(COMPLIANCE, /platform itself sends no email/i,
    "compliance.html must state plainly that the platform sends no email");
  assert.doesNotMatch(COMPLIANCE, /pending institutional approval|disabled by default/i,
    "the old 'built but disabled' email statement must be gone");
});
