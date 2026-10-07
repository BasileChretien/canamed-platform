/* tests-e2e/emulator/session-date-bounds.spec.js
 *
 * `created/at` and `closed/at` are the two numbers the nightly purge decides
 * from: a closed session goes 30 days after `closed/at`, one never closed 90
 * days after `created/at`. The client writes both, and until 2026-10-07 the
 * rules asked of each only that it be a number.
 *
 * So a session could be created — or closed — with a date years ahead, and the
 * purge read it as "within retention" until that date. Whoever creates a
 * session writes `created`, so the limits the privacy notice publishes could be
 * set aside for a session by its own creator. (tests/session-retention.test.js
 * runs the purge and has the measurements.)
 *
 * The rules now hold both dates to the server clock: no more than five seconds
 * ahead of it — what every other timestamp in the file allows, and what joining
 * a session already requires of the same device — and no more than two hours
 * behind. This spec is the only place that bound is EVALUATED; the unit suite
 * can only read the rule's text.
 *
 * ── A denial here is never left to stand alone ──────────────────────────
 * Every refused date is followed by the same write — same path, same signed-in
 * user, same shape — with an honest date, and that one must be ALLOWED. A
 * session-creation rule that refused everything would pass a denial-only test
 * and stop every session on the platform.
 *
 * And the last test does not seed anything: it creates and closes a session
 * through the real client, because the rule is only right if the product's own
 * writes still pass it.
 */

// @ts-check
const { test, expect, dbReadAsOwner } = require("./fixtures.js");
const { sessionRetentionVerdict } = require("../../scripts/lib/session-retention.js");

const HOUR = 60 * 60 * 1000;
const YEAR = 365 * 24 * HOUR;

async function signedInUid(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    try {
      return !!(window.firebase && firebase.apps && firebase.apps.length &&
                firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }, { timeout: 20_000 });
  return page.evaluate(() => firebase.auth().currentUser.uid);
}

function tryWrite(page, path, value) {
  return page.evaluate(async ([p, v]) => {
    try {
      await firebase.database().ref(p).set(v);
      return "ALLOWED";
    } catch (e) {
      return (e && (e.code || e.message)) || "DENIED";
    }
  }, [path, value]);
}

/* A denial must be a PERMISSION denial. tryWrite() reports any error, so a bare
   .not.toBe("ALLOWED") also passes on a transport or config failure — green in
   an environment where no rule was evaluated at all. */
function expectDenied(result, why) {
  expect(result, why).not.toBe("ALLOWED");
  expect(String(result), why + " (and denied for PERMISSION, not by a transport error)")
    .toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
}

/* The dates the rule must refuse. Each is a function of the moment it is
   written, and each margin is wide enough that neither the trip to the emulator
   nor a slow CI runner can move it across the bound it is testing. */
const REFUSED = [
  ["ten years ahead — the defect: this session would never have been purged",
    (now) => now + 10 * YEAR],
  ["one minute ahead — past the five seconds any timestamp is allowed",
    (now) => now + 60_000],
  ["the epoch — a date that would have the session purged the next night",
    () => 0],
  ["three hours ago — past the two hours a slow clock or a queued write is allowed",
    (now) => now - 3 * HOUR]
];

const uniq = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

/* A session its creator can close: `closed` needs adminPasswordHash to exist and
   the writer to be the creator (or hold a password proof). Written through the
   rules, with honest dates — which is itself an allow leg for `created`. */
async function seedSession(page, base, uid) {
  const r = await page.evaluate(async ([b, u]) => {
    try {
      await firebase.database().ref(b + "/creatorUid").set(u);
      await firebase.database().ref(b + "/created").set({ by: "Facilitator", at: Date.now() });
      await firebase.database().ref(b + "/adminPasswordHash").set("c".repeat(64));
      return "OK";
    } catch (e) { return (e && (e.code || e.message)) || "DENIED"; }
  }, [base, uid]);
  if (r !== "OK") throw new Error("seedSession(" + base + ") failed: " + r);
}

for (const [tree, baseOf] of [
  ["sessions/", (id) => "sessions/" + id],
  ["orgs/<slug>/sessions/", (id) => "orgs/e2e-org/sessions/" + id]
]) {
  test(`rules: ${tree} — a session cannot be CREATED with a date the server clock does not bear out`, async ({ page }) => {
    await signedInUid(page);
    const base = baseOf(uniq("dateb-c-"));

    for (const [label, at] of REFUSED) {
      expectDenied(await tryWrite(page, base + "/created", { by: "Facilitator", at: at(Date.now()) }),
        "created.at = " + label);
    }
    expect(await dbReadAsOwner(base + "/created"),
      "none of the refused writes may have landed").toBeNull();

    /* THE ALLOW LEG: the same node, the same user, the same shape — only the
       date differs. Without it the four denials above prove nothing. */
    const honest = Date.now();
    expect(await tryWrite(page, base + "/created", { by: "Facilitator", at: honest }),
      "an honest date must create the session — every session passes through this rule")
      .toBe("ALLOWED");
    expect(await dbReadAsOwner(base + "/created")).toEqual({ by: "Facilitator", at: honest });

    /* Write-once is what makes the bound mean anything: a date held within
       seconds of now is no retention clock if it can be written again. Neither
       the node nor the date under it may be replaced — not even honestly. */
    expectDenied(await tryWrite(page, base + "/created", { by: "Facilitator", at: Date.now() }),
      "re-dating an existing session with a fresh, honest date");
    expectDenied(await tryWrite(page, base + "/created/at", Date.now() + 10 * YEAR),
      "writing the date alone, underneath the node");
    expectDenied(await tryWrite(page, base + "/created", null), "deleting the node to write it again");
    expect((await dbReadAsOwner(base + "/created")).at, "the first date stands").toBe(honest);
  });

  test(`rules: ${tree} — a session cannot be CLOSED with a date the server clock does not bear out`, async ({ page }) => {
    const uid = await signedInUid(page);
    const base = baseOf(uniq("dateb-x-"));
    await seedSession(page, base, uid);

    for (const [label, at] of REFUSED) {
      expectDenied(await tryWrite(page, base + "/closed", { by: "Facilitator", at: at(Date.now()) }),
        "closed.at = " + label);
    }
    expect(await dbReadAsOwner(base + "/closed"),
      "the session must still be OPEN — a refused close must not have closed it").toBeNull();

    /* THE ALLOW LEG, and it matters twice here: the close is admin-gated, so
       without it a denial could be the gate refusing this user rather than the
       bound refusing the date. Same user, same node, honest date. */
    const honest = Date.now();
    expect(await tryWrite(page, base + "/closed", { by: "Facilitator", at: honest }),
      "the creator must still be able to close their session").toBe("ALLOWED");
    expect(await dbReadAsOwner(base + "/closed")).toEqual({ by: "Facilitator", at: honest });

    /* Closing restarts the retention clock at 30 days, so a second close would
       restart it again. */
    expectDenied(await tryWrite(page, base + "/closed", { by: "Facilitator", at: Date.now() }),
      "closing an already-closed session again, to move its date");
    expectDenied(await tryWrite(page, base + "/closed/at", Date.now() + 10 * YEAR),
      "writing the close date alone, underneath the node");
    expect((await dbReadAsOwner(base + "/closed")).at, "the first close date stands").toBe(honest);
  });
}

test("rules: a device clock that is a little slow, or a little fast, can still create and close", async ({ page }) => {
  /* The dates are Date.now() on the facilitator's device. The bound must sit
     outside what an honest device produces, on both sides — otherwise this
     change is an outage for whoever's laptop has drifted. One hour behind also
     covers a write queued through a dropped connection and sent on reconnect. */
  const uid = await signedInUid(page);

  for (const [what, offset] of [["an hour slow", -HOUR], ["two seconds fast", 2000]]) {
    for (const baseOf of [(id) => "sessions/" + id, (id) => "orgs/e2e-org/sessions/" + id]) {
      const created = baseOf(uniq("dateb-skew-c-"));
      expect(await tryWrite(page, created + "/created", { by: "Facilitator", at: Date.now() + offset }),
        `creating from a clock ${what} (${created})`).toBe("ALLOWED");

      const closed = baseOf(uniq("dateb-skew-x-"));
      await seedSession(page, closed, uid);
      expect(await tryWrite(page, closed + "/closed", { by: "Facilitator", at: Date.now() + offset }),
        `closing from a clock ${what} (${closed})`).toBe("ALLOWED");
    }
  }
});

test("the REAL client still creates and closes a session, and the purge keeps what it wrote", async ({ page }) => {
  /* No seeding. The create form writes `created`, and "Sessions you created →
     Close session" writes `closed`, both with the device clock. If the bound
     were wrong for the product's own payload, this is where it would show —
     as every facilitator being unable to open a session. */
  const before = Date.now();

  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Date Fac");
  await page.locator("#splash-create-label").fill("date-bounds");
  await page.locator("#splash-create-pass").fill("emu-date-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode, "the session must be created — a refused `created` write stops here")
    .toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);

  /* The DB value first, then the DOM (CLAUDE.md): what did the client write? */
  const created = await dbReadAsOwner(base + "/created");
  expect(created, "the client's `created` write must have landed").not.toBeNull();
  expect(created.at).toBeGreaterThanOrEqual(before);
  expect(created.at).toBeLessThanOrEqual(Date.now());
  expect(await dbReadAsOwner(base + "/closed")).toBeNull();

  /* Back to the front page (the fixture clears the stored session on every
     navigation), then close it from the list of sessions this browser created. */
  await page.reload();
  await expect(page.locator("#splash-my-sessions-row")).toBeVisible({ timeout: 15_000 });
  await page.locator("#splash-go-my-sessions").click();
  const row = page.locator(`.my-session-row[data-code='${code}']`);
  await expect(row).toBeVisible();
  const beforeClose = Date.now();
  await row.locator(".my-session-close").dispatchEvent("click");
  const modal = page.locator("#canamed-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await modal.locator("#canamed-modal-confirm").dispatchEvent("click");

  await expect.poll(() => dbReadAsOwner(base + "/closed"),
    { message: "the client's `closed` write must land", timeout: 15_000 }).not.toBeNull();
  const closed = await dbReadAsOwner(base + "/closed");
  expect(closed.at).toBeGreaterThanOrEqual(beforeClose);
  expect(closed.at).toBeLessThanOrEqual(Date.now());
  await expect(row, "and the page must show it: the row leaves the list").toHaveCount(0, { timeout: 10_000 });

  /* The other half of the same contract: the dates the real client wrote under
     the real rules are ones the purge takes at face value. */
  const now = Date.now();
  for (const [createdAt, closedAt] of [[created.at, null], [created.at, closed.at]]) {
    const v = sessionRetentionVerdict({ createdAt, closedAt, now, closedDays: 30, openDays: 90 });
    expect([v.purge, v.futureDated], v.reason).toEqual([false, false]);
  }
});
