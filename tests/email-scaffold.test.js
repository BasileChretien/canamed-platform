/* tests/email-scaffold.test.js
 *
 * Email infrastructure scaffold (2026-05-22): a consent-gated, secret-safe
 * transactional-mail Cloud Function + an admin-gated queue + an enqueue helper.
 * The function can't be executed without the Firebase runtime, so these are
 * structural + security checks (notably: NO hardcoded secret).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = path.join(__dirname, "..", "docs", "Third_session", "PBL_platform");
const FN = fs.readFileSync(path.join(P, "functions", "index.js"), "utf8");
const PKG = fs.readFileSync(path.join(P, "functions", "package.json"), "utf8");
const README = fs.readFileSync(path.join(P, "functions", "README.md"), "utf8");
const FB = fs.readFileSync(path.join(P, "firebase.json"), "utf8");
const RULES = fs.readFileSync(path.join(P, "database.rules.json"), "utf8");
const TOOLS = fs.readFileSync(path.join(P, "admin-tools.js"), "utf8");
const COMPLIANCE = fs.readFileSync(path.join(P, "compliance.html"), "utf8");

test("the Cloud Function parses, triggers on the mail queue, fails closed, is idempotent", () => {
  assert.doesNotThrow(() => new Function(FN), "functions/index.js must parse");
  // Gen 2 trigger: onValueCreated({ref: "/sessions/.../mail/{id}", ...})
  assert.match(FN, /onValueCreated[\s\S]*ref:\s*"\/sessions\/\{code\}\/mail\/\{id\}"/,
    "must trigger onValueCreated of the session mail queue");
  assert.match(FN, /if \(!job\.to \|\| !job\.subject \|\| job\.delivery\) return null/,
    "must be idempotent (skip already-delivered / malformed jobs)");
  assert.match(FN, /SMTP not configured/, "must fail closed when SMTP is unconfigured");
  assert.match(FN, /delivery/, "must record delivery state back on the node");
});

test("email is DISABLED by default — gated on explicit institutional approval", () => {
  assert.match(FN, /function emailEnabled\(\)/, "must have an approval gate");
  // Gen 2 param: defineBoolean("EMAIL_ENABLED", { default: false })
  assert.match(FN, /defineBoolean\("EMAIL_ENABLED"/, "gate reads the EMAIL_ENABLED param");
  assert.match(FN, /EMAIL_ENABLED\.value\(\)\s*===\s*true/,
    "gate requires the param to be strictly true");
  // The gate is checked BEFORE building the transport / sending.
  const onCreate = FN.slice(FN.indexOf("onValueCreated"));
  assert.match(onCreate, /if \(!emailEnabled\(\)\)[\s\S]{0,200}return null/,
    "must short-circuit (no send) when not enabled");
  assert.match(onCreate, /"disabled"/, "must record a 'disabled' state when gated");
  assert.match(README, /pending institutional approval|university president/i,
    "README must document the approval gate");
  // Operator step now: edit functions/.env with EMAIL_ENABLED=true (Gen 2 params API)
  assert.match(README, /EMAIL_ENABLED=true|email\.enabled="true"/,
    "README must document the enable step");
});

test("the compliance statement does NOT advertise email as active", () => {
  assert.match(COMPLIANCE, /not currently active|pending institutional approval|disabled by default/i,
    "compliance page must state email is not active yet");
});

test("SMTP credentials are read from config/env — never hardcoded", () => {
  // Gen 2: SMTP_HOST/USER/PORT/FROM via defineString, SMTP_PASS via
  // defineSecret (Google Secret Manager). NO hardcoded credentials.
  assert.match(FN, /defineString\("SMTP_HOST"\)|defineSecret\("SMTP_PASS"\)/,
    "must read SMTP from the params API");
  assert.match(FN, /defineSecret\("SMTP_PASS"\)/,
    "SMTP password must be a defineSecret (Google Secret Manager), not a defineString");
  // No obvious hardcoded secret: no inline password/api-key string assignments.
  assert.doesNotMatch(FN, /pass\s*[:=]\s*["'][A-Za-z0-9._\-]{12,}["']/, "must not hardcode a password");
  assert.doesNotMatch(FN, /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9._\-]{12,}["']/i, "must not hardcode an API key");
});

test("function deps + runtime are declared", () => {
  const pkg = JSON.parse(PKG);
  assert.ok(pkg.dependencies["firebase-functions"], "needs firebase-functions");
  assert.ok(pkg.dependencies["firebase-admin"], "needs firebase-admin");
  assert.ok(pkg.dependencies["nodemailer"], "needs an SMTP client (nodemailer)");
  assert.match(FB, /"functions":\s*\{[\s\S]*"source":\s*"functions"/, "firebase.json must wire the functions source");
});

test("the mail queue is admin-write-only + validated in both trees (not an open relay)", () => {
  const count = (RULES.match(/"mail":\s*\{/g) || []).length;
  assert.strictEqual(count, 2, "mail queue must be ruled in both trees (got " + count + ")");
  assert.match(RULES, /adminPasswordHash'\)\.exists\(\) && !data\.exists\(\)/, "mail write is admin-gated + write-once");
  assert.match(RULES, /matches\(\/\^\[\^@/, "recipient must be validated as an email address");
});

test("the enqueue helper is exposed and writes the admin-gated queue", () => {
  assert.match(TOOLS, /function enqueueMail\(to, subject, text\)/, "enqueueMail must exist");
  assert.match(TOOLS, /db\.ref\(sPath\("mail"\)\)\.push/, "must enqueue under the session mail path");
  assert.match(TOOLS, /window\.CanamedAdminTools\.enqueueMail = enqueueMail/, "must be exposed");
});

test("the operator setup (billing, secret, DNS) is documented", () => {
  assert.match(README, /Blaze/, "must document the billing step");
  // Gen 2 secrets flow: `firebase functions:secrets:set HF_TOKEN` (or SMTP_PASS).
  // The deprecated functions:config:set is no longer the recommended path.
  assert.match(README, /functions:secrets:set|\.env file/,
    "must document setting credentials via the params API (.env / Secret Manager)");
  assert.match(README, /SPF\/DKIM|DKIM/, "must document sender-domain verification");
  assert.match(README, /never commit|not.*in the repo|never.*hardcode/i, "must warn the secret stays out of the repo");
});
