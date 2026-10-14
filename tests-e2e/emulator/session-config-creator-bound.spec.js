/* tests-e2e/emulator/session-config-creator-bound.spec.js
 *
 * A session's configuration — `controller`, `workshopLabel`, `scenarioId`,
 * `sections`, `sectionBodies/<slot>`, `modules`, `scenarioCustomJson`,
 * `scenarioRef` — is written once, when the session is created. Until
 * 2026-10-08 the rule on each of the eight was `auth != null && !data.exists()`:
 * written once, by ANYONE signed in, at any time. Signing in is automatic and
 * anonymous, so "anyone" was any visitor who knew or guessed a session code.
 *
 * The create form sets three of the eight (`controller`, `sections`, and
 * `workshopLabel` when the facilitator typed one). Whatever it left unset stayed
 * open to the first comer, and write-once then kept the creator from undoing
 * it. Measured on this emulator before the rules changed, with a second browser
 * context that knew only the code (the probes are not in the repository; the
 * numbers are in the pull request that added this file):
 *
 *   - `scenarioCustomJson` naming `format: "branched"`: every participant who
 *     loaded the page afterwards got the PBL stage with its left column, its
 *     vignette and its patient chat hidden;
 *   - `scenarioCustomJson` with a malformed `case`: the page threw, and the
 *     participant was shown the Welcome stage while the room was on stage 1;
 *   - `scenarioRef` pointing at a scenario the stranger had shared: the same,
 *     and the stranger could go on editing that scenario afterwards;
 *   - `controller`, on a session that had none (the current form always writes
 *     one; older shells did not): the join screen told participants a
 *     stranger's string was "the data controller for this session";
 *   - `sections` + `sectionBodies/1`, on a session with no pick (the
 *     scenario-based shape that preceded the section picker): the join screen
 *     announced the stranger's section as the session's content, and the stage
 *     flow became that one section.
 *
 * THE RULES NOW. All eight: once, and only while the session has no password.
 *   - `controller`, `workshopLabel`, `sections` — by the session's creator or,
 *     while it has NO creator yet, by whoever may create a session. These three
 *     ride the same parallel batch as `creatorUid` in createSession(), and the
 *     rule is deliberately indifferent to which of them the database applies
 *     first. It is the recovery record's rule, word for word.
 *   - `scenarioId`, `modules`, `scenarioCustomJson`, `scenarioRef`,
 *     `sectionBodies/<slot>` — by the session's creator and nobody else. Nothing
 *     the current client sends can reach these before the claim has landed (the
 *     form does not write the first four; the bodies are chained after the
 *     batch), and requiring the claim is what stops a stranger seeding content
 *     on a code nobody has drawn yet.
 *
 * ── A denial here is never left to stand alone ──────────────────────────
 * Every refused write has its ALLOW: the same payload, on the same node, from
 * an identity entitled to it — on the same session where there is one (a
 * session being created), and otherwise on a session where there is (nobody is
 * entitled to configure a session that already has a password, so there the
 * allow is the creator's write of the same payload on a session being created).
 * A rule that refused everybody would pass a denial-only test and stop every
 * session on the platform: these nodes are written by every creation.
 *
 * ── A second user is a second CONTEXT ───────────────────────────────────
 * A second page in the creator's context is the creator again (same anonymous
 * session). Every stranger below is a fresh browser context, and each test
 * asserts the two uids differ.
 *
 * ── And the product's own writes are run, not modelled ──────────────────
 * script.js is unchanged by this fix. The form and the real createSession()
 * are driven below, so that a rule that refused one of the client's own writes
 * would fail here rather than in front of a facilitator.
 */

// @ts-check
const { test, expect, useEmulator, dbReadAsOwner } = require("./fixtures.js");

const EMU_DB_REST = "http://127.0.0.1:9000";
const EMU_NS = "canamed-sim-default-rtdb";

/* Owner write, rules bypassed. Used ONLY to give a session a shape the current
   client no longer produces (no `controller`; no `sections`) and to switch the
   creation gate, which no client can write. Every write under test goes through
   the rules. */
async function seedAsOwner(pathNoJson, value) {
  const res = await fetch(`${EMU_DB_REST}/${pathNoJson}.json?ns=${EMU_NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`seedAsOwner(${pathNoJson}) -> HTTP ${res.status}`);
}

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

/* A denial must be a PERMISSION denial: tryWrite() reports any error, so a bare
   .not.toBe("ALLOWED") also passes on a transport or config failure. */
function expectDenied(result, why) {
  expect(result, why).not.toBe("ALLOWED");
  expect(String(result), why + " (and denied for PERMISSION, not by a transport error)")
    .toMatch(/PERMISSION_DENIED|permission_denied|denied/i);
}

/* A stranger: its own browser context, hence its own anonymous user. */
async function stranger(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await useEmulator(page);
  page.on("dialog", d => { try { d.accept(); } catch (_) {} });
  const uid = await signedInUid(page);
  return { ctx, page, uid };
}

const uniq = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const HEX = "c".repeat(64);          // a well-formed adminPasswordHash

/* One valid payload per node — valid, so that a denial can only be the write
   gate and never the validator. */
const BRANCHED = JSON.stringify({ id: "stranger", name: "Not this session's content", format: "branched" });
const BODY = JSON.stringify({ id: "authored-pbl", type: "pbl", name: "An authored section" });
const PICK = "custom-1,chronic-pain-pbl";
/* The three createSession() sends in its parallel batch… */
const IN_BATCH = [
  ["controller", "Stranger Institute (not this session's controller)"],
  ["workshopLabel", "a label its creator did not type"],
  ["sections", PICK]
];
/* …and the five it does not. `sectionBodies/1` LAST, and after `sections`: a
   body is only valid once the pick names its slot. */
function notInBatch(refOwnerUid) {
  return [
    ["scenarioId", "breaking-bad-news-disclosure"],
    ["modules", "B"],
    ["scenarioCustomJson", BRANCHED],
    ["scenarioRef", { ownerUid: refOwnerUid, scenarioId: "evil", source: "shared" }],
    ["sectionBodies/1", BODY]
  ];
}

const TREES = [
  ["sessions/", (id) => "sessions/" + id],
  ["orgs/<slug>/sessions/", (id) => "orgs/e2e-org/sessions/" + id]
];

for (const [tree, baseOf] of TREES) {
  test(`rules: ${tree} — a session that has a creator is configured by its creator only: once, and before it has a password`, async ({ page, browser }) => {
    const creatorUid = await signedInUid(page);
    const s = await stranger(browser);
    expect(s.uid, "the stranger must be a DISTINCT user, or every denial below is vacuous")
      .not.toBe(creatorUid);

    /* ── X: a session being created (a creator, no password yet) ─────────── */
    const x = baseOf(uniq("cfg-x-"));
    expect(await tryWrite(page, x + "/creatorUid", creatorUid),
      "the creator claims the session").toBe("ALLOWED");

    for (const [node, payload] of IN_BATCH.concat(notInBatch(s.uid))) {
      const path = x + "/" + node;
      expectDenied(await tryWrite(s.page, path, payload),
        `${node}: a stranger who knows the code writes it first`);
      expect(await dbReadAsOwner(path), `${node}: the refused write must not have landed`).toBeNull();

      /* THE ALLOW LEG — same path, same payload, the creator. */
      expect(await tryWrite(page, path, payload),
        `${node}: the creator must be able to write it`).toBe("ALLOWED");
      expect(await dbReadAsOwner(path), `${node}: and it is what the creator wrote`).toEqual(payload);

      /* Write-once still holds, for the creator too. */
      expectDenied(await tryWrite(page, path, payload), `${node}: written twice by its creator`);
      expectDenied(await tryWrite(page, path, null), `${node}: deleted by its creator, to write it again`);
      expectDenied(await tryWrite(s.page, path, null), `${node}: deleted by the stranger`);
      expect(await dbReadAsOwner(path), `${node}: the first value stands`).toEqual(payload);
    }

    /* ── Y: the same creator, once the session has a password ──────────────
       What a session runs is fixed when its creation completes; session X is
       the allow leg for every write here (same user, same payloads, no
       password yet). Seven of the eight are tried on a session with NO
       configuration at all… */
    const y = baseOf(uniq("cfg-y-"));
    expect(await tryWrite(page, y + "/creatorUid", creatorUid)).toBe("ALLOWED");
    expect(await tryWrite(page, y + "/adminPasswordHash", HEX),
      "the creator sets the password — creation is complete").toBe("ALLOWED");
    for (const [node, payload] of IN_BATCH.concat(notInBatch(s.uid))) {
      if (node === "sectionBodies/1") continue;   // refused by its validator too, with no pick: below
      expectDenied(await tryWrite(page, y + "/" + node, payload),
        `${node}: added by the creator AFTER the session has a password`);
      expectDenied(await tryWrite(s.page, y + "/" + node, payload),
        `${node}: added by a stranger after the session has a password`);
      expect(await dbReadAsOwner(y + "/" + node), `${node}: nothing was added`).toBeNull();
    }
    /* …and the eighth on one whose pick names the slot, so that the refusal can
       only be the password's. */
    const y2 = baseOf(uniq("cfg-y2-"));
    expect(await tryWrite(page, y2 + "/creatorUid", creatorUid)).toBe("ALLOWED");
    expect(await tryWrite(page, y2 + "/sections", PICK)).toBe("ALLOWED");
    expect(await tryWrite(page, y2 + "/adminPasswordHash", HEX)).toBe("ALLOWED");
    expectDenied(await tryWrite(page, y2 + "/sectionBodies/1", BODY),
      "sectionBodies/1: added by the creator after the session has a password");
    expect(await dbReadAsOwner(y2 + "/sectionBodies")).toBeNull();

    await s.ctx.close();
  });

  test(`rules: ${tree} — creation works whichever of its writes lands first, and a session with no creator is nobody's to seed with content`, async ({ page, browser }) => {
    const a = await signedInUid(page);
    const s = await stranger(browser);
    expect(s.uid).not.toBe(a);

    /* ── The batch, arriving claim-LAST ────────────────────────────────────
       createSession() issues `creatorUid` and the three in-batch fields
       together. If the database applied a configuration write before the
       claim, it must still be the creator's to make. */
    const late = baseOf(uniq("cfg-late-"));
    for (const [node, payload] of IN_BATCH) {
      expect(await tryWrite(page, late + "/" + node, payload),
        `${node}: written before the claim exists, by the user who is about to make it`).toBe("ALLOWED");
    }
    expect(await tryWrite(page, late + "/creatorUid", a), "…and then the claim").toBe("ALLOWED");
    expect(await dbReadAsOwner(late + "/sections")).toBe(PICK);

    /* ── …and claim-FIRST, which is the order it is issued in ─────────────── */
    const early = baseOf(uniq("cfg-early-"));
    expect(await tryWrite(page, early + "/creatorUid", a)).toBe("ALLOWED");
    for (const [node, payload] of IN_BATCH) {
      expect(await tryWrite(page, early + "/" + node, payload), `${node}: after the claim`).toBe("ALLOWED");
    }

    /* ── Once somebody holds the claim, "no creator yet" is over ──────────── */
    const claimed = baseOf(uniq("cfg-claimed-"));
    expect(await tryWrite(page, claimed + "/sections", PICK), "written before any claim").toBe("ALLOWED");
    expect(await tryWrite(page, claimed + "/creatorUid", a)).toBe("ALLOWED");
    expectDenied(await tryWrite(s.page, claimed + "/controller", IN_BATCH[0][1]),
      "a stranger writes a field the creator has not written yet");
    expect(await dbReadAsOwner(claimed + "/controller")).toBeNull();
    expect(await tryWrite(page, claimed + "/controller", IN_BATCH[0][1]),
      "the same payload from the creator").toBe("ALLOWED");

    /* ── NO creator, NO password: content cannot be seeded ─────────────────
       The five creator-only nodes need the claim to exist — for everybody. So
       a stranger cannot leave a scenario on a code nobody has drawn yet and
       have a facilitator's creation complete around it. (To write one they
       must take the claim, and then the facilitator's own claim is refused and
       the creation fails where it can be seen.) */
    const bare = baseOf(uniq("cfg-bare-"));
    for (const [node, payload] of notInBatch(s.uid)) {
      if (node === "sectionBodies/1") continue;       // needs a pick; covered in the first test
      expectDenied(await tryWrite(s.page, bare + "/" + node, payload),
        `${node}: seeded on a code that has no creator`);
    }
    expect(await dbReadAsOwner(bare), "nothing was left on the unclaimed code").toBeNull();
    /* THE ALLOW LEG: the same user, the same payloads, as the session's creator. */
    expect(await tryWrite(s.page, bare + "/creatorUid", s.uid)).toBe("ALLOWED");
    for (const [node, payload] of notInBatch(s.uid)) {
      if (node === "sectionBodies/1") continue;
      expect(await tryWrite(s.page, bare + "/" + node, payload),
        `${node}: the same user, now the creator`).toBe("ALLOWED");
    }
    expectDenied(await tryWrite(page, bare + "/controller", "x"),
      "and here the FIRST user is the stranger: the binding follows the claim, not the browser");

    /* ── NO creator, but a password: nobody ────────────────────────────────
       The shape of a session from before `creatorUid` was written (2026-05-27).
       It has no creator to bind to, and it is not being created: closed to
       everyone. The allow legs are `late` and `early` above — same user, same
       payloads, no password. */
    const keyed = baseOf(uniq("cfg-keyed-"));
    expect(await tryWrite(page, keyed + "/adminPasswordHash", HEX),
      "a password on a code with no creator").toBe("ALLOWED");
    for (const [node, payload] of IN_BATCH) {
      expectDenied(await tryWrite(page, keyed + "/" + node, payload),
        `${node}: on a session with a password and no creator, by whoever set the password`);
      expectDenied(await tryWrite(s.page, keyed + "/" + node, payload),
        `${node}: on a session with a password and no creator, by a stranger`);
    }
    expectDenied(await tryWrite(s.page, keyed + "/scenarioCustomJson", BRANCHED),
      "scenarioCustomJson: on a session with a password and no creator");
    expect(Object.keys(await dbReadAsOwner(keyed)), "only the password is there").toEqual(["adminPasswordHash"]);

    await s.ctx.close();
  });
}

test("rules: while the creation gate is enforced, a visitor it does not admit cannot leave configuration on an unclaimed code", async ({ page, browser }) => {
  /* The nobody-yet branch must not be wider than the claim it stands in for.
     `facilitatorGate` is GLOBAL state in this database: cleared in `finally`. */
  const admitted = await signedInUid(page);
  const s = await stranger(browser);
  expect(s.uid).not.toBe(admitted);
  try {
    await seedAsOwner("facilitatorGate", { enforce: true, allow: { [admitted]: true } });
    for (const [, baseOf] of TREES) {
      const code = baseOf(uniq("cfg-gate-"));
      for (const [node, payload] of IN_BATCH) {
        expectDenied(await tryWrite(s.page, code + "/" + node, payload),
          `${node}: on an unclaimed code, by a visitor the gate does not admit`);
        /* THE ALLOW LEG: the same payload, the same node, a visitor it admits. */
        expect(await tryWrite(page, code + "/" + node, payload),
          `${node}: by a visitor the gate admits — a facilitator creating a session`).toBe("ALLOWED");
      }
    }
  } finally {
    await seedAsOwner("facilitatorGate", null);
    await s.ctx.close();
  }
});

/* What a participant is shown on the join screen, for the DOM half of each
   assertion below. */
function joinScreen(page) {
  return page.evaluate(() => {
    const txt = (n) => n ? (n.textContent || "").replace(/\s+/g, " ").trim() : "";
    return {
      notice: txt(document.querySelector("[data-i18n-html='lobby.privacy.p1']")),
      content: txt(document.getElementById("scenario-line-name")),
      format: document.body.dataset.format || null
    };
  });
}
async function enterCode(page, code) {
  await page.goto("/");
  await page.locator("#splash-code").fill(code);
  await page.locator("#splash-enter").click();
  await expect(page.locator("#name-input")).toBeVisible({ timeout: 15_000 });
  /* The content line is filled in by the same load that builds the lobby; wait
     for it, so that what joinScreen() reads is the settled screen. */
  await expect(page.locator("#scenario-line-name")).not.toHaveText("", { timeout: 15_000 });
}

async function createThroughTheForm(page, { label, controller }) {
  await page.goto("/");
  await page.locator("#splash-go-create").click();
  await page.locator("#splash-create-name").fill("Emu Config Fac");
  if (label) await page.locator("#splash-create-label").fill(label);
  if (controller) await page.locator("#splash-create-controller").fill(controller);
  await page.locator("#splash-create-pass").fill("emu-config-pw");
  await page.locator("#splash-create-submit").click();
  const codeNode = page.locator("#splash-shown-code");
  await expect(codeNode, "the session must be created — a refused configuration write stops here, " +
    "with \"Could not create the session\"").toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/i, { timeout: 20_000 });
  const code = (await codeNode.textContent()).trim();
  const base = await page.evaluate((c) => oPath(sanitizeCode(c)), code);
  return { code, base };
}

test("the REAL create form still creates a session, and what it left unset stays unset", async ({ page, browser }) => {
  /* No seeding. If the rules were wrong for the product's own batch, this is
     where it would show: no facilitator could open a session. */
  const CONTROLLER = "Emulator Teaching Hospital";
  const { code, base } = await createThroughTheForm(page, { label: "config-bound", controller: CONTROLLER });
  const creatorUid = await page.evaluate(() => firebase.auth().currentUser.uid);

  /* The DB value first (CLAUDE.md): every field the form writes has landed. */
  const node = await dbReadAsOwner(base);
  expect(node.creatorUid, "the creator claim").toBe(creatorUid);
  expect(node.controller, "the controller the facilitator named").toBe(CONTROLLER);
  expect(node.workshopLabel).toBe("config-bound");
  expect(typeof node.sections, "the section pick").toBe("string");
  expect(node.created && node.created.by).toBe("Emu Config Fac");
  expect(typeof node.adminPasswordHash, "creation ran to its last write").toBe("string");
  const unset = ["scenarioId", "modules", "scenarioCustomJson", "scenarioRef"];
  for (const k of unset) expect(node[k], `${k}: the form does not write it`).toBeUndefined();

  const s = await stranger(browser);
  expect(s.uid).not.toBe(creatorUid);
  const payloads = Object.fromEntries(notInBatch(s.uid));
  for (const k of unset) {
    expectDenied(await tryWrite(s.page, base + "/" + k, payloads[k]),
      `${k}: a stranger fills in what the creator left unset`);
    expect(await dbReadAsOwner(base + "/" + k), `${k}: still unset`).toBeNull();
  }

  /* A session created WITHOUT a label leaves `workshopLabel` unset too. */
  const bare = await createThroughTheForm(page, { label: "", controller: CONTROLLER });
  expect(await dbReadAsOwner(bare.base + "/workshopLabel"), "no label typed, none written").toBeNull();
  expectDenied(await tryWrite(s.page, bare.base + "/workshopLabel", "a label its creator did not type"),
    "a stranger labels somebody else's session");
  expect(await dbReadAsOwner(bare.base + "/workshopLabel")).toBeNull();

  /* Then the DOM. `format` is the assertion that discriminates: the stranger's
     scenarioCustomJson declared "branched", and before the fix that is what
     this screen's body was stamped with. The notice line only confirms that
     the page shows what the DB holds. */
  await enterCode(s.page, code);
  const seen = await joinScreen(s.page);
  expect(seen.format, "the room is not restyled by a scenario nobody attached").toBe("standard");
  expect(seen.notice, "the notice names the controller the creator gave").toContain(CONTROLLER);

  await s.ctx.close();
});

test("createSession() with an authored section: every write of every session lands", async ({ page }) => {
  /* The authored body is the one write that is CHAINED after the batch (its
     validator needs the pick to exist), and its rule is creator-only — so it is
     the client write most exposed to a rule that closes too early. Four calls,
     because one is not a habit. This is not a reordering test: each call's
     batch is contiguous on the connection. Order is the second test's. */
  const uid = await signedInUid(page);
  const made = await page.evaluate(async ([body, pick]) => {
    const one = (i) => createSession("Emu Fac " + i, "authored " + i, "emu-pw-" + i,
      null, null, null, null, pick, { "1": body }, "Controller " + i)
      .then(r => ({ ok: true, base: oPath(r.code) }))
      .catch(e => ({ ok: false, error: String((e && (e.code || e.message)) || e) }));
    return Promise.all([0, 1, 2, 3].map(one));
  }, [BODY, PICK]);

  for (const [i, m] of made.entries()) {
    expect(m, `creation ${i} must succeed: ${JSON.stringify(m)}`).toMatchObject({ ok: true });
    const node = await dbReadAsOwner(m.base);
    expect(node.creatorUid, `creation ${i}`).toBe(uid);
    expect(node.controller, `creation ${i}`).toBe("Controller " + i);
    expect(node.workshopLabel, `creation ${i}`).toBe("authored " + i);
    expect(node.sections, `creation ${i}`).toBe(PICK);
    /* Read by its own path: a node whose only key is "1" may come back from
       REST as an array or as an object, and that is not what is under test. */
    expect(await dbReadAsOwner(m.base + "/sectionBodies/1"),
      `creation ${i}: the authored body, written after the pick`).toBe(BODY);
    expect(typeof node.adminPasswordHash, `creation ${i}: ran to its last write`).toBe("string");
  }
});

test("a session with no controller cannot be given one by a stranger", async ({ page, browser }) => {
  /* Measured before the fix: the stranger's string appeared on the join screen
     as "…, the data controller for this session, collects your first name…",
     and the creator could neither change nor remove it. */
  const { code, base } = await createThroughTheForm(page, { label: "no controller" });
  await seedAsOwner(base + "/controller", null);            // the older shape
  const creatorUid = await page.evaluate(() => firebase.auth().currentUser.uid);
  const s = await stranger(browser);
  expect(s.uid).not.toBe(creatorUid);

  const FALSE_CONTROLLER = "Stranger Institute of Nowhere";
  expectDenied(await tryWrite(s.page, base + "/controller", FALSE_CONTROLLER),
    "a stranger names the controller of somebody else's session");
  expect(await dbReadAsOwner(base + "/controller"), "the DB first: nothing landed").toBeNull();

  /* THE ALLOW LEG: the same payload on the same node, by a session's creator
     while the session is being created. (On THIS session nobody is entitled:
     it has a password.) */
  const fresh = "sessions/" + uniq("cfg-ctrl-");
  expect(await tryWrite(page, fresh + "/creatorUid", creatorUid)).toBe("ALLOWED");
  expect(await tryWrite(page, fresh + "/controller", FALSE_CONTROLLER),
    "the same string is a legitimate write for a creator").toBe("ALLOWED");

  /* Then the DOM: the join screen keeps the notice it has always had for a
     session that names nobody. */
  await enterCode(s.page, code);
  const seen = await joinScreen(s.page);
  expect(seen.notice).not.toContain(FALSE_CONTROLLER);
  expect(seen.notice, "the default clause, as for every session with no controller")
    .toContain("joint controllers");

  await s.ctx.close();
});

test("a session with no section pick (the scenario-based shape) cannot be given one by a stranger", async ({ page, browser }) => {
  /* Measured before the fix: a stranger wrote the pick AND the body it names,
     and the join screen announced the stranger's section as today's content. */
  const { code, base } = await createThroughTheForm(page, { label: "no pick" });
  await seedAsOwner(base + "/sections", null);              // the pre-picker shape…
  /* …a scenario id instead — and NOT the platform default, so that the content
     line below can only be this session's own. */
  await seedAsOwner(base + "/scenarioId", "respiratory-stewardship");
  const creatorUid = await page.evaluate(() => firebase.auth().currentUser.uid);
  const s = await stranger(browser);
  expect(s.uid).not.toBe(creatorUid);

  const TAKEOVER = JSON.stringify({ id: "stranger-pbl", type: "pbl", name: "STRANGER SECTION" });
  expectDenied(await tryWrite(s.page, base + "/sections", "custom-1"),
    "a stranger writes the pick of somebody else's session");
  expect(await dbReadAsOwner(base + "/sections"), "the DB first: no pick").toBeNull();
  /* The body is refused twice over — by the rule, and by its validator, which
     wants a pick naming the slot. It is tried because it is the second half of
     what was done; the first refusal above is the one that matters. */
  expectDenied(await tryWrite(s.page, base + "/sectionBodies/1", TAKEOVER),
    "…and the section it would have named");
  expect(await dbReadAsOwner(base + "/sectionBodies")).toBeNull();

  /* THE ALLOW LEG: the same two writes, in the same order, by a creator. */
  const fresh = "sessions/" + uniq("cfg-pick-");
  expect(await tryWrite(page, fresh + "/creatorUid", creatorUid)).toBe("ALLOWED");
  expect(await tryWrite(page, fresh + "/sections", "custom-1")).toBe("ALLOWED");
  expect(await tryWrite(page, fresh + "/sectionBodies/1", TAKEOVER)).toBe("ALLOWED");

  await enterCode(s.page, code);
  const seen = await joinScreen(s.page);
  expect(seen.content, "today's content is still the scenario the session was created with")
    .toContain("Antibiotic Stewardship");
  expect(seen.content).not.toContain("STRANGER SECTION");

  await s.ctx.close();
});
