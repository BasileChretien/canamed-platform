#!/usr/bin/env node
/* Erase one participant, on request (GDPR Art. 17 / Art. 7(3), APPI Art. 35(5)).
 *
 * Closes the live-database half of Annex VI G12. Before this, withdrawing
 * consent deleted nothing and there was no route to erase a participant at all
 * — clause 10.1 promised Art. 28(3)(g) deletion the system could not perform.
 *
 * DRY RUN BY DEFAULT. Set ERASE_CONFIRM=1 to write. The first live run on any
 * database is an irreversible deletion of a real person's work, so it is not
 * something a mistyped identifier should be able to do.
 *
 * WHAT IT REACHES
 *   sessions/<code>/...            both trees, via lib/session-trees
 *   orgs/<slug>/sessions/<code>/…
 *   rosters/...                    name, e-mail, university
 *   certIds/...                    and the credentials/<certId> records they name
 *   users/<uid>                    profile + history
 *   erasures/<id>                  the suppression record written for the archive
 *
 *   roomChat/…                     via the roomChatAuthors index (below)
 *
 * ROOMCHAT, WHICH THIS TOOL COULD NOT REACH UNTIL 2026-09-03. Turns carried
 * role/content/at and no author, so one participant's conversation with the
 * simulated patient could not be separated from their roommates'. The schema
 * fix was to record the author in a SEPARATE tree, `roomChatAuthors`, which has
 * no `.read` rule and is therefore readable only by the Admin SDK — putting a
 * `uid` on the turn itself would have told the whole room who said what, since
 * roomChat is room-readable and RTDB `.read` cascades.
 *
 * ⚠️ TURNS WRITTEN BEFORE THAT CHANGE HAVE NO AUTHOR ROW and remain
 * unerasable individually. They are counted and reported on every run: a
 * legacy turn is not a bug to be hidden, it is a fact the requester may need
 * to be told.
 *
 * A SESSION THAT HAS ALREADY BEEN PURGED (2026-10-07). Sessions go 30 days
 * after closing and 90 after creation, so a request that arrives later names a
 * session this tool cannot walk. It used to answer "Nothing to erase", exit 0
 * and write nothing — which left the request open for ever (the monitor closes
 * one only on an erasure record) and left up to 90 nightly snapshots with
 * nothing telling a restore to leave the participant out. Now, for a session
 * the purge left a MARKER for (`purgedSessions/<code>`), it writes the
 * suppression record — the uid alone is enough, the restore re-resolves the
 * rest against each snapshot — and removes that session's row from the
 * participant's history. It needs `--uid`, and it will not write without
 * `--research-copy-checked`: see WHAT IT STILL CANNOT REACH.
 *
 * It writes no record for a session that has NO marker. `erasures/` is never
 * deleted, so it must not fill with records for sessions nothing shows ever
 * existed. Such a request is reported, the run exits 3, and the operator
 * either rebuilds the markers (scripts/backfill-purged-markers.js) or removes
 * the request with `--dismiss`.
 *
 * WHAT IT STILL CANNOT REACH:
 *   the nightly archive — snapshots are not rewritten. A suppression record is
 *                written instead so a restore cannot bring the participant
 *                back, and the snapshots expire on their own cycle. This is the
 *                "put beyond use" position the notice describes at PIS v10.
 *                See scripts/lib/suppression.js for why not (a).
 *   the research copy — the pseudonymised exports already written and the
 *                research dataset built from them are separate copies, outside
 *                this database. For a live session the withdrawal record keeps
 *                the participant out of FUTURE exports; for a purged one there
 *                are none to come, so whether they are in the research copy is
 *                a fact only a person can establish. `--research-copy-checked`
 *                is the operator saying they have. The tool cannot verify it.
 *   a certificate, once the session is purged — `credentials/<certId>` is
 *                public for up to five years, and the only link from a uid to
 *                a certificate id (`certIds/<code>`, `clientMapping`) went with
 *                the session. If the participant supplies the id, delete that
 *                record by hand.
 *
 * USAGE
 *   node scripts/erase-participant.js --uid <uid>
 *   node scripts/erase-participant.js --client-id <cid> --session <locationKey>
 *   node scripts/erase-participant.js --stable-id <sid>
 *   ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid>
 *
 *   # a session that has been purged — always --uid; the dry run names the flag
 *   ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> \
 *       --session <locationKey> --research-copy-checked --reason art17
 *
 *   # --reason is one of: erasure-request (default), art17, art7-3, appi35,
 *   # controller. It is stored in a ledger that is never deleted, so it is
 *   # never free text. (For --dismiss it is free text: nothing is stored.)
 *
 *   # a request that names a session nothing shows existed
 *   ERASE_CONFIRM=1 node scripts/erase-participant.js --uid <uid> \
 *       --session <locationKey> --dismiss --reason "<why>"
 *
 * EXIT  0 done (or dry run) · 1 failed · 2 refused, nothing written ·
 *       3 a request was found that this tool could not act on
 */

"use strict";

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const {
  readSessionLocations, withdrawalLocations, purgedMarkers, locationForKey,
  PURGED_MARKERS_BACKFILLED_PATH,
} = require("./lib/session-trees");
const { resolveIdentity, planSessionErasure } = require("./lib/erasure");
const { buildRecord, canonicalReason, describeReasons } = require("./lib/suppression");
const { answeredIndex, flattenErasures, requestKey } = require("./lib/data-rights");
const { isOpenRequest } = require("./lib/withdrawal-retention");

const DB_URL = process.env.FIREBASE_DATABASE_URL
  || "https://canamed-69785-default-rtdb.europe-west1.firebasedatabase.app";
const CONFIRM = process.env.ERASE_CONFIRM === "1";

const EXIT_OK = 0;
const EXIT_REFUSED = 2;
const EXIT_NOT_ACTED_ON = 3;
const DAY_MS = 86400000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const VALUE_FLAGS = {
  "--uid": "uid", "--client-id": "clientId", "--stable-id": "stableId",
  "--session": "session", "--reason": "reason",
};
const SWITCHES = { "--research-copy-checked": "researchCopyChecked", "--dismiss": "dismiss" };

/* An argument this does not recognise STOPS the run. It used to be skipped —
   so `--sesion <key>` ran as `--uid` alone, which means every session the
   person is in. A flag given without its value is refused for the same reason:
   `--session` at the end of the line is not "no session". */
function parseArgs(argv) {
  const out = {
    uid: null, clientId: null, stableId: null, session: null, reason: null,
    researchCopyChecked: false, dismiss: false, problems: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const value = argv[++i];
      if (value === undefined || Object.prototype.hasOwnProperty.call(VALUE_FLAGS, value) ||
          Object.prototype.hasOwnProperty.call(SWITCHES, value)) {
        out.problems.push(a + " needs a value");
        i--;
      } else {
        out[VALUE_FLAGS[a]] = value;
      }
    } else if (Object.prototype.hasOwnProperty.call(SWITCHES, a)) {
      out[SWITCHES[a]] = true;
    } else {
      out.problems.push("unknown argument: " + a);
    }
  }
  return out;
}

/* Every identifier here ends up as a segment of a database path. A "/" inside
   one would address a DIFFERENT, deeper node — `--uid abc/profile` deletes
   `users/abc/profile` — and the Admin SDK would do it without complaint. */
const isKey = (v) => typeof v === "string" && v !== "" && !/[/.#$\[\]]/.test(v);
function isSessionKey(v) {
  if (typeof v !== "string" || v === "orgs") return false;
  const parts = v.split("/");
  return (parts.length === 1 || (parts.length === 3 && parts[0] === "orgs")) && parts.every(isKey);
}

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) initializeApp({ credential: cert(JSON.parse(raw)), databaseURL: DB_URL });
  else initializeApp({ databaseURL: DB_URL });
}

/**
 * The sessions that are IN the database: what to delete from each, and from
 * the identity-keyed nodes beside them. Null when the participant is in none.
 */
async function planLive(db, locations, args) {
  const updates = {};
  const report = [];
  const allAmbiguous = [];
  let identityForRecord = null;
  const suppressed = [];

  for (const loc of locations) {
    if (args.session && loc.key !== args.session) continue;
    const identity = resolveIdentity(loc.data, args);
    if (!identity.uid && !identity.clientIds.length && !identity.stableIds.length) continue;

    const plan = planSessionErasure(loc.data, identity);
    if (!plan.deletes.length && !plan.ambiguous.length) continue;

    for (const rel of plan.deletes) updates[`${loc.path}/${rel}`] = null;
    allAmbiguous.push(...plan.ambiguous.map((a) => ({ ...a, session: loc.key })));
    report.push({ session: loc.key, identity, count: plan.deletes.length });
    if (!identityForRecord && identity.uid) identityForRecord = identity;
    suppressed.push({ locationKey: loc.key, identity });
  }
  if (!report.length) return null;

  /* Identity-keyed nodes outside the session subtrees. */
  const uid = (identityForRecord && identityForRecord.uid) || args.uid || null;
  const outside = [];
  if (uid) {
    for (const loc of locations) {
      if (args.session && loc.key !== args.session) continue;
      outside.push(`${loc.rosterPath}/${uid}`);
    }
    outside.push(`users/${uid}`);
  }
  /* certIds/<session>/<cid> holds the published certificate id, and
     credentials/<certId> is the world-readable record it names. Deleting the
     pointer without the record would leave the record standing and
     unreachable — still public to anyone holding the id, and now impossible to
     find again in order to delete. So read the value before deleting the key. */
  for (const entry of suppressed) {
    const loc = locations.find((l) => l.key === entry.locationKey);
    if (!loc || !loc.certIdsPath) continue;
    for (const cid of entry.identity.clientIds) {
      outside.push(`${loc.certIdsPath}/${cid}`);
      const snap = await db.ref(`${loc.certIdsPath}/${cid}`).get();
      const certId = snap.exists() ? snap.val() : null;
      if (typeof certId === "string" && certId) outside.push(`credentials/${certId}`);
    }
  }
  for (const p of outside) updates[p] = null;

  /* roomChat, via the author index. Both the turn and its author row go: a
     surviving author row would be a record of who said something that no
     longer exists. */
  let chatTurns = 0;
  let legacyTurns = 0;
  for (const entry of suppressed) {
    const loc = locations.find((l) => l.key === entry.locationKey);
    if (!loc || !loc.roomChatAuthorsPath) continue;
    const snap = await db.ref(loc.roomChatAuthorsPath).get();
    const rooms = snap.exists() ? (snap.val() || {}) : {};
    const chatSnap = await db.ref(loc.roomChatPath).get();
    const chatRooms = chatSnap.exists() ? (chatSnap.val() || {}) : {};
    for (const roomId of Object.keys(chatRooms)) {
      const authors = rooms[roomId] || {};
      for (const turnId of Object.keys(chatRooms[roomId] || {})) {
        const author = authors[turnId];
        if (author === undefined || author === null) { legacyTurns++; continue; }
        if (!uid || author !== uid) continue;
        updates[`${loc.roomChatPath}/${roomId}/${turnId}`] = null;
        updates[`${loc.roomChatAuthorsPath}/${roomId}/${turnId}`] = null;
        chatTurns++;
      }
    }
  }

  return { updates, report, allAmbiguous, suppressed, outside, chatTurns, legacyTurns };
}

/**
 * The sessions that are NOT in the database any more.
 *
 * Starts from the request queue (`withdrawals`), not from the sessions: that
 * is the only place a purged session is still named beside this uid. A session
 * given with --session is added even with no record in the queue — a request
 * can reach the operator by e-mail — but only if the purge left a marker for
 * it. Anything already answered is left out; so is a session that is in the
 * database, which planLive() owns.
 *
 * A failed read throws. "Could not read the queue" must never come out as
 * "no requests".
 *
 * @returns {Promise<{closable: object[], noMarker: object[], needsUid: boolean}>}
 */
async function planPurged(db, locations, args) {
  const live = new Set(locations.map((l) => l.key));
  if (!args.uid) {
    return {
      closable: [], noMarker: [], liveRequests: [],
      needsUid: !!args.session && !live.has(args.session),
    };
  }

  const [wSnap, mSnap, eSnap] = await Promise.all([
    db.ref("withdrawals").get(), db.ref("purgedSessions").get(), db.ref("erasures").get(),
  ]);
  const byLocation = withdrawalLocations(wSnap.exists() ? wSnap.val() : {});
  const markers = purgedMarkers(mSnap.exists() ? mSnap.val() : {});
  const answered = answeredIndex(flattenErasures(eSnap.exists() ? eSnap.val() : {}));
  const marked = (key) => Object.prototype.hasOwnProperty.call(markers, key);

  const keys = new Set();
  for (const key of Object.keys(byLocation)) {
    if (isOpenRequest(byLocation[key][args.uid], key, args.uid, answered)) keys.add(key);
  }
  if (args.session && marked(args.session) && !answered.has(requestKey(args.session, args.uid))) {
    keys.add(args.session);
  }

  /* THE MARKER DECIDES, not whether something is in the database. A marker
     means a session with this code was purged and the snapshots still hold
     it; a node under `sessions/<code>` now does not undo that, and anyone can
     put one there — their own membership row is writable under any code, and
     a session can be created under a code that is free. This used to skip every
     key that is in the database, which turned "answer this request" into
     "nothing to erase, dismiss it" for a purged session the moment a stranger
     wrote one row under its code.
       marker                 -> answered here, whatever is in the database now
       no marker, in database -> a live session's request (planLive owns the
                                 erasing; reported if there is nothing to erase)
       no marker, not there   -> nothing shows it existed */
  const closable = [];
  const noMarker = [];
  const liveRequests = [];
  for (const key of [...keys].sort()) {
    if (args.session && key !== args.session) continue;
    const record = byLocation[key] ? byLocation[key][args.uid] : null;
    const requestAt = isObj(record) && typeof record.at === "number" ? record.at : null;
    if (marked(key)) {
      closable.push({
        locationKey: key, purgedAt: markers[key], requestAt,
        inQueue: isObj(record), inDatabaseAgain: live.has(key),
      });
    } else if (live.has(key)) {
      liveRequests.push(key);
    } else {
      noMarker.push({ locationKey: key, requestAt });
    }
  }
  return { closable, noMarker, needsUid: false, liveRequests };
}

/** The `at` of the erasure request this person has open under a session, or 0.
 *  It is what a record is stamped with, so that "answered" is a match on the
 *  request's own date and never a comparison between two clocks. */
async function requestStamp(db, loc, uid) {
  if (!uid) return 0;
  const snap = await db.ref(`${loc.withdrawalsPath}/${uid}`).get();
  const record = snap.exists() ? snap.val() : null;
  return isObj(record) && record.erasure === true && typeof record.at === "number" ? record.at : 0;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const age = (ms) => (ms === null ? "undated" : `${Math.floor((Date.now() - ms) / DAY_MS)}d ago`);

function printLivePlan(live) {
  console.log("PLAN");
  for (const r of live.report) {
    console.log(`  ${r.session}: ${r.count} path(s) — uid=${r.identity.uid || "-"} ` +
                `cids=[${r.identity.clientIds.join(",")}] sids=[${r.identity.stableIds.join(",")}]`);
  }
  console.log(`  outside sessions: ${live.outside.length} path(s) (rosters, certIds, users)`);
  console.log(`  roomChat: ${live.chatTurns} turn(s) (+ their author rows)`);
  console.log(`  TOTAL: ${Object.keys(live.updates).length} path(s)`);
  console.log("");

  if (live.allAmbiguous.length) {
    console.log(`AMBIGUOUS — ${live.allAmbiguous.length} entry(ies) NOT deleted:`);
    for (const a of live.allAmbiguous) console.log(`  ${a.session}/${a.path}  (${a.reason})`);
    console.log("  These are attributed by display name with no id beside them. " +
                "Deleting them could destroy a namesake's work, so they are left " +
                "for a human to decide.");
    console.log("");
  }

  if (live.legacyTurns) {
    console.log(`UNERASABLE — ${live.legacyTurns} chat turn(s) predate the author index:`);
    console.log("  Written before 2026-09-03, when roomChat turns carried no author " +
                "at all. They cannot be attributed to anyone, so they cannot be " +
                "erased individually — deleting them would delete other people's " +
                "messages. They disappear with the session on the ordinary " +
                "retention clock. Tell the requester this rather than implying " +
                "their chat is fully gone.");
    console.log("");
  }
}

function printPurgedPlan(closable) {
  console.log(`PURGED SESSIONS — ${closable.length} request(s) for a session that has ` +
              "been purged:");
  for (const g of closable) {
    console.log(`  ${g.locationKey}: purged ${day(g.purgedAt)}; ` +
      (g.inQueue ? `requested ${age(g.requestAt)}` : "no request in the queue — recorded on your word") +
      (g.inDatabaseAgain ? "; something is in the database under this code again, " +
        "which does not change what was purged" : ""));
  }
  console.log("  For each: one suppression record (identifiers only), so that a " +
              "restore from the nightly snapshots leaves this participant out, " +
              "and that session's row is removed from their history. Nothing is " +
              "deleted from the session itself — the purge already removed it, " +
              "for everyone.");
  console.log("");
  console.log("NOT REACHED BY THIS TOOL — yours to do, and to tell the requester:");
  console.log("  - the research dataset, and the pseudonymised exports already " +
              "written. The nightly export reads only sessions that are in the " +
              "database, so nothing will ever take this participant out of a " +
              "copy made before the purge. --research-copy-checked is you " +
              "stating that you have removed them from it, or established that " +
              "they were never in it. This tool cannot check.");
  console.log("  - their certificate, if one was published. The record is public " +
              "for up to five years and cannot be found from a uid once the " +
              "session is gone. If they give you the certificate id, delete " +
              "credentials/<that id> by hand.");
  console.log("  - the nightly snapshots are not rewritten. They expire within 90 " +
              "days; until then the suppression record is what keeps a restore " +
              "from bringing the participant back. Never delete it.");
  console.log("");
}

function printNotActedOn(gone, liveNothing, backfilled) {
  /* While the marker backfill has not run, --dismiss refuses (see dismiss()).
     Say so here, or this sends the operator to a command that will not run. */
  const notYet = "  --dismiss is refused until the purge markers have been " +
                 "backfilled: run scripts/backfill-purged-markers.js once (dry " +
                 "run first, then BACKFILL_CONFIRM=1), then this again. Until then " +
                 "\"no purge marker\" does not mean the session was never purged.";
  if (gone.needsUid) {
    console.log("NOT ACTED ON — that session is not in the database. A session that " +
                "has been purged can only be addressed with --uid: clientIds and " +
                "stableIds are resolved inside a session, and it is gone.");
    console.log("");
  }
  if (liveNothing.length) {
    console.log(`NOT ACTED ON — ${liveNothing.length} open request(s) name a session that IS ` +
                "in the database, in which this person has nothing to erase:");
    for (const key of liveNothing) console.log(`  ${key}`);
    if (backfilled) {
      console.log("  Already erased and asked again, or never took part. The request " +
                  "stays open, and the monitor keeps counting it, until it is closed " +
                  "with --uid … --session … --dismiss --reason \"…\" (which checks " +
                  "again that nothing of theirs is there).");
    } else {
      console.log("  Already erased and asked again, never took part — or the session " +
                  "they took part in was purged and something else is under its " +
                  "code now. The request stays open, and the monitor keeps counting it.");
      console.log(notYet);
    }
    console.log("");
  }
  if (!gone.noMarker.length) return;
  console.log(`NOT ACTED ON — ${gone.noMarker.length} open request(s) name a session that ` +
              "is not in the database and has no purge marker:");
  for (const g of gone.noMarker) console.log(`  ${g.locationKey}: requested ${age(g.requestAt)}`);
  console.log("  Nothing shows that session ever existed, so no suppression record " +
              "is written for it: `erasures/` is never deleted and must not fill " +
              "with records for sessions that never were. Two ways out —");
  console.log("  - it WAS a session, purged before the purge wrote markers " +
              "(2026-10-07): rebuild the markers from the nightly snapshots with " +
              "scripts/backfill-purged-markers.js, then run this again;");
  if (backfilled) {
    console.log("  - nothing in the snapshots or your own records shows it: remove " +
                "the request with --uid … --session … --dismiss --reason \"…\".");
  } else {
    console.log("  - nothing shows it: it can be removed once the backfill has run.");
    console.log(notYet);
  }
  console.log("");
}

/** Remove ONE request that nothing ties to a real session. Not an erasure. */
async function dismiss(db, locations, args, backfilled) {
  const refuse = (why) => {
    console.error("REFUSED: " + why);
    console.error("Nothing was written.");
    return EXIT_REFUSED;
  };
  if (!args.uid || !args.session) {
    return refuse("--dismiss needs --uid and --session: it removes one request, named exactly.");
  }
  if (!args.reason) {
    return refuse("--dismiss needs --reason. You are setting aside something recorded " +
                  "as a person's request; say why.");
  }
  /* THE MARKER FIRST, whatever is in the database. A session that was purged
     is still in the snapshots, so a request about it is answered with a
     suppression record — never dismissed. This used to be checked only when
     the session was absent; one row written under the code by anyone made it
     "a live session the person has nothing in", and the request was deleted
     with nothing telling a restore to leave the person out. */
  if ((await db.ref(locationForKey(args.session).purgedMarkerPath).get()).exists()) {
    return refuse("the purge left a marker for that session: it existed, and the " +
                  "snapshots may still hold it. Answer the request " +
                  "(--research-copy-checked) rather than dismissing it — whatever " +
                  "is in the database under that code now.");
  }
  /* NOT BEFORE THE BACKFILL. Everything below reads "no purge marker" as "no
     session was purged under this code" — true only once the markers of
     sessions purged before the purge wrote them have been rebuilt. Until
     then a dismissal here can be the deletion of a real, unanswered request
     for a session the snapshots still hold. This was a sentence in the
     operator procedure; it is a check because the mistake is silent. */
  if (!backfilled) {
    return refuse("the purge markers have not been backfilled yet, so --dismiss is " +
                  "refused. Until scripts/backfill-purged-markers.js has been run " +
                  "once with BACKFILL_CONFIRM=1, a session purged before the purge " +
                  "wrote markers has none, and this tool cannot tell it from a code " +
                  "that never was a session — whatever is in the database under " +
                  "that code today. Run the backfill, then this again: a request " +
                  "for a session the snapshots hold will then be answered, not " +
                  "dismissed.");
  }
  const liveLoc = locations.find((l) => l.key === args.session);
  let why;
  if (liveLoc) {
    /* In the database: dismissable only if the person left NOTHING in it —
       then there is nothing to erase, the erasure path writes nothing, and
       until the session is purged (up to 60 days on) nothing else could close
       the request. Any trace at all makes it a real request. */
    if (await hasTraceIn(db, liveLoc, args.uid)) {
      return refuse("that session is in the database and this person has data in it, " +
                    "so the request is real. Run the erasure (without --dismiss).");
    }
    /* "No purge marker", not "never purged": a session purged before the
       purge wrote markers has none until the backfill has run, and what is
       under its code today may be something else. Only the marker is known. */
    why = "The session is in the database, its code carries no purge marker, and " +
          "this person has nothing in it: no entry, no roster row, no chat " +
          "turn. There is nothing to erase.";
  } else {
    why = "The session is not in the database and has no purge marker.";
  }
  const loc = liveLoc || locationForKey(args.session);
  const path = `${loc.withdrawalsPath}/${args.uid}`;
  if (!(await db.ref(path).get()).exists()) {
    return refuse("there is no withdrawal record for that uid under that session.");
  }

  console.log(`DISMISS  the request recorded under ${args.session} — reason: ${args.reason}`);
  console.log("  " + why + " The record is deleted, with the matching row of the " +
              "person's session history; NO suppression record is written, because " +
              "nothing is being erased. This leaves no trace in the database: " +
              "note the decision, and the reason, in your own register.");
  console.log("");
  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with ERASE_CONFIRM=1 to apply.");
    return EXIT_OK;
  }
  /* The history row offered the button that made this request. Left behind it
     invites the same request again — which, for a session with no marker, the
     rules now refuse. One update, so the two cannot come apart. */
  await db.ref().update({
    [path]: null,
    [`users/${args.uid}/history/${loc.code}`]: null,
  });
  console.log("DISMISSED. The request and its history row are deleted.");
  return EXIT_OK;
}

/** Has this person left anything in a session that is in the database? */
async function hasTraceIn(db, loc, uid) {
  const plan = planSessionErasure(loc.data, resolveIdentity(loc.data, { uid }));
  if (plan.deletes.length || plan.ambiguous.length) return true;
  if ((await db.ref(`${loc.rosterPath}/${uid}`).get()).exists()) return true;
  const authorsSnap = await db.ref(loc.roomChatAuthorsPath).get();
  const rooms = authorsSnap.exists() ? (authorsSnap.val() || {}) : {};
  return Object.values(rooms).some(
    (room) => isObj(room) && Object.values(room).some((author) => author === uid));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.problems.length) {
    console.error("FATAL: " + args.problems.join("; ") + ".");
    console.error("Nothing was read or written. A mistyped --session would otherwise " +
                  "run as --uid alone, which means every session the person is in.");
    return EXIT_REFUSED;
  }
  if (!args.uid && !args.clientId && !args.stableId) {
    console.error(
      "FATAL: give at least one of --uid / --client-id / --stable-id.\n" +
      "Refusing to run without an identifier: a run that matches nobody would " +
      "report a clean erasure and do nothing, which is the worst possible " +
      "outcome for a request someone is relying on.");
    return EXIT_REFUSED;
  }
  for (const [flag, value] of [["--uid", args.uid], ["--client-id", args.clientId], ["--stable-id", args.stableId]]) {
    if (value !== null && !isKey(value)) {
      console.error(`FATAL: ${flag} is not a database key (it contains one of / . # $ [ ]). ` +
                    "It would address a different node from the one you mean.");
      return EXIT_REFUSED;
    }
  }
  if (args.session !== null && !isSessionKey(args.session)) {
    console.error("FATAL: --session takes a location key: <code>, or orgs/<slug>/<code>.");
    return EXIT_REFUSED;
  }
  /* The reason is WRITTEN INTO THE LEDGER, which is never deleted and which
     scheduled jobs read on a hosted runner. So it is one of a fixed list, never
     what the operator happens to type — which could be a name. Refused before
     anything is read, in a dry run too, and without echoing the text back.
     (--dismiss stores nothing: its reason is printed and stays free text.) */
  if (!args.dismiss && canonicalReason(args.reason) === null) {
    console.error("FATAL: --reason takes one of a fixed list: " + describeReasons() + ".");
    console.error("It goes into a record that is kept for ever, so it cannot be free " +
                  "text. Keep any note about the request in your own register. " +
                  "Nothing was read or written.");
    return EXIT_REFUSED;
  }

  initAdmin();
  const db = getDatabase();

  console.log(`Database: ${DB_URL}`);
  console.log(`Mode:     ${CONFIRM ? "LIVE — will delete" : "DRY RUN (set ERASE_CONFIRM=1 to write)"}`);
  console.log("");

  const locations = await readSessionLocations(db);
  /* HAS THE MARKER BACKFILL RUN? Until it has, a session purged before the
     purge wrote markers has none, and "no purge marker" says nothing about
     whether a code was ever a session. That decides whether a request may be
     DISMISSED, and what this run tells the operator to do next. A failed read
     throws: nothing is assumed either way. */
  const backfilled = (await db.ref(PURGED_MARKERS_BACKFILLED_PATH).get()).exists();
  if (args.dismiss) return dismiss(db, locations, args, backfilled);

  const live = await planLive(db, locations, args);
  const gone = await planPurged(db, locations, args);
  /* Requests under a session that is in the database, where the erasure path
     found nothing of this person's to delete. */
  const erasedFrom = new Set(live ? live.report.map((r) => r.session) : []);
  const liveNothing = gone.liveRequests.filter((key) => !erasedFrom.has(key));
  const leftOpen = (gone.noMarker.length || gone.needsUid || liveNothing.length)
    ? EXIT_NOT_ACTED_ON : EXIT_OK;

  if (!live && !gone.closable.length) {
    console.log("No matching participant found in any session. Nothing to erase.");
    console.log("If that is unexpected, check the identifier — this tool never " +
                "matches on a display name.");
    console.log("");
    printNotActedOn(gone, liveNothing, backfilled);
    return leftOpen;
  }

  if (live && !args.session) {
    /* `--uid` alone has always meant "this person, everywhere". Said out loud,
       because the request being answered is usually about ONE session, and
       this also deletes their account record. */
    console.log(`SCOPE — no --session was given, so this run covers EVERY session ` +
                `this person is in: ${live.report.length} in the database` +
                (gone.closable.length ? `, ${gone.closable.length} already purged` : "") +
                ", and it deletes their whole account record (users/<uid>: profile " +
                "and session history). To answer one request only, add " +
                "--session <key>.");
    console.log("");
  }
  if (live) printLivePlan(live);
  if (gone.closable.length) printPurgedPlan(gone.closable);
  printNotActedOn(gone, liveNothing, backfilled);

  if (!CONFIRM) {
    console.log("DRY RUN — nothing was written. Re-run with ERASE_CONFIRM=1" +
                (gone.closable.length ? " and --research-copy-checked" : "") + " to apply.");
    return leftOpen;
  }
  if (gone.closable.length && !args.researchCopyChecked) {
    /* Before ANY write, the live half included: one run is one answer, and a
       refused run that had already deleted from a live session would be an
       erasure nobody confirmed. */
    console.error("REFUSED: this run would answer a request for a session that has " +
                  "been purged, and --research-copy-checked was not given. The " +
                  "participant was told they are excluded from the research " +
                  "dataset; for a purged session only you can make that true. " +
                  "See NOT REACHED above.");
    console.error("Nothing was written.");
    return EXIT_REFUSED;
  }

  const at = new Date(Date.now()).toISOString();
  const reason = canonicalReason(args.reason);
  const updates = Object.assign({}, live ? live.updates : {});
  /* Each record is stamped with the request it answers (requestStamp above). */
  const records = [];
  for (const s of (live ? live.suppressed : [])) {
    const loc = locations.find((l) => l.key === s.locationKey);
    records.push(buildRecord({
      locationKey: s.locationKey, identity: s.identity, at, reason,
      requestAt: await requestStamp(db, loc, s.identity.uid),
    }));
  }
  const erasedLive = new Set(records.map((r) => r.locationKey));
  /* The uid reaches everything the session's mapping tables join to it. A
     browser that dropped out mid-join left a pool row and no mapping row, and
     nothing here can find that once the session is gone — so an identifier the
     operator supplies alongside --uid is carried into the record, and the
     restore will strip that row too. */
  const purgedIdentity = {
    uid: args.uid,
    clientIds: args.clientId ? [args.clientId] : [],
    stableIds: args.stableId ? [args.stableId] : [],
  };
  for (const g of gone.closable) {
    /* A purged code that is a real session again, with this person in it: the
       live half has just written the record for this person and this key, and
       it is re-resolved against every snapshot, old and new. One request, one
       record. */
    if (erasedLive.has(g.locationKey)) continue;
    records.push(buildRecord({
      locationKey: g.locationKey, identity: purgedIdentity, at, reason,
      requestAt: g.requestAt === null ? 0 : g.requestAt,
      sessionPurged: true, researchCopyChecked: true,
    }));
    /* The history is keyed by the bare code in both trees. Skipped when the
       live half is already deleting users/<uid> whole: a multi-path update may
       not name a node and one of its descendants. */
    if (!Object.prototype.hasOwnProperty.call(updates, `users/${args.uid}`)) {
      updates[`users/${args.uid}/history/${locationForKey(g.locationKey).code}`] = null;
    }
  }

  /* The suppression record is written FIRST and in the same multi-path update
     as the deletions. If it were written afterwards and the process died in
     between, the participant would be gone from the live tree and still
     restorable from 90 nights of archive with nothing recording that they
     should not be — the one ordering that turns a partial failure into a
     silent breach. */
  const recRef = db.ref("erasures").push();
  updates[`erasures/${recRef.key}`] = { at, records };

  await db.ref().update(updates);
  console.log(`ERASED. ${Object.keys(updates).length - 1} path(s) deleted.`);
  console.log(`Suppression record: erasures/${recRef.key} (${records.length} session(s)).`);
  console.log("The nightly snapshots are NOT rewritten; scripts/restore-sessions.js " +
              "applies this record so a restore cannot bring the participant back.");
  if (gone.closable.length) {
    /* The sweep skips a code that is in the database again (a record there may
       be what keeps someone out of the export), so the answered request stays
       until whatever is under the code has gone. Said, because "on its next
       run" was printed for those too and was not true. */
    const held = gone.closable.filter((g) => g.inDatabaseAgain).length;
    console.log("The request(s) for purged sessions now count as done in the " +
                "data-rights monitor; the nightly job removes the withdrawal " +
                "record(s) on its next run" +
                (held ? `, except ${held} whose code is in the database again: ` +
                  "that record stays, answered, until what is under the code is gone." : "."));
  }
  return leftOpen;
}

/* Explicit exit on every path: firebase-admin keeps the event loop alive, so
   a main() that only returned would leave the process hanging after a
   successful erasure — which it did, until 2026-10-07. */
main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error("FATAL: " + (e && e.message)); process.exit(1); });
