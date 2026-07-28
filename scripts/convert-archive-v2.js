#!/usr/bin/env node
/* scripts/convert-archive-v2.js
 *
 * Convert a v1 session archive (moduleA / moduleB keyed) into the v2 shape
 * (per-slot, with a section manifest), so the research dataset is ONE shape
 * either side of the section model.
 *
 * Decision 6 of ARCHITECTURE/section-model-design.md chose a clean break plus
 * this converter, rather than a compatibility branch living in the export
 * forever.
 *
 * The mapping is the pre-section reality: a v1 session always ran at most one
 * Module A and one Module B, in that order, so
 *     answers.moduleA  → slot 1        (type "pbl")
 *     answers.moduleB  → slot 2        (type "roleplay")
 *     hypotheses       → slot 1        (only Module A ever had them)
 * A v1 file cannot tell us WHICH clinical case ran — `scenarioId` was not
 * recorded in the archive — so `sectionId` is emitted as null rather than
 * guessed. That null is meaningful: it says "pre-section session, case
 * unknown", which is exactly what a later analysis needs to know.
 *
 *   node scripts/convert-archive-v2.js in.json [out.json]
 *   node scripts/convert-archive-v2.js --check in.json      # report only
 */

"use strict";

const V1_SLOTS = [
  { key: "moduleA", slot: 1, type: "pbl" },
  { key: "moduleB", slot: 2, type: "roleplay" }
];

/* Pure — exported for the unit tests, which are the only thing that proves the
   mapping before it is pointed at real archived PII. */
function convertArchive(v1) {
  if (!v1 || typeof v1 !== "object") throw new TypeError("not an archive object");
  if (v1.exportVersion >= 2) return v1;            // already converted; idempotent

  const rooms = Array.isArray(v1.rooms) ? v1.rooms : [];
  /* A slot only enters the manifest if SOME room carried content for it. A v1
     single-module session must not gain a phantom empty second section. */
  const used = {};
  rooms.forEach(rm => {
    const ans = (rm && rm.answers) || {};
    V1_SLOTS.forEach(m => { if ((ans[m.key] || []).length) used[m.slot] = true; });
    if ((rm && rm.hypotheses || []).length) used[1] = true;
  });
  const manifest = V1_SLOTS.filter(m => used[m.slot]).map(m => ({
    slot: m.slot,
    sectionId: null,          // unknowable from a v1 file — see the header
    type: m.type,
    title: ""
  }));

  return {
    session: v1.session,
    exportVersion: 2,
    exportedAt: v1.exportedAt,
    pseudonymised: !!v1.pseudonymised,
    convertedFrom: 1,
    sections: manifest,
    rooms: rooms.map(rm => {
      const ans = (rm && rm.answers) || {};
      const perSlot = {};
      manifest.forEach(m => {
        const src = V1_SLOTS.find(v => v.slot === m.slot);
        perSlot[String(m.slot)] = {
          hypotheses: (m.slot === 1 && Array.isArray(rm.hypotheses)) ? rm.hypotheses : [],
          answers: (src && Array.isArray(ans[src.key])) ? ans[src.key] : []
        };
      });
      return {
        room: rm.room,
        stageReached: rm.stageReached,
        score: rm.score == null ? null : rm.score,
        sections: perSlot
      };
    })
  };
}

module.exports = { convertArchive, V1_SLOTS };

if (require.main === module) {
  const fs = require("fs");
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const inPath = check ? args[1] : args[0];
  const outPath = check ? null : (args[1] || null);
  if (!inPath) {
    console.error("usage: convert-archive-v2.js [--check] <in.json> [out.json]");
    process.exit(2);
  }
  const v1 = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const v2 = convertArchive(v1);
  const counts = (v2.rooms || []).reduce((n, rm) => {
    Object.keys(rm.sections || {}).forEach(k => {
      n.answers += (rm.sections[k].answers || []).length;
      n.hypotheses += (rm.sections[k].hypotheses || []).length;
    });
    return n;
  }, { answers: 0, hypotheses: 0 });
  console.error("session %s: %d rooms, %d sections, %d answers, %d hypotheses%s",
    v2.session, (v2.rooms || []).length, (v2.sections || []).length,
    counts.answers, counts.hypotheses,
    v1.exportVersion >= 2 ? " (already v2 — unchanged)" : "");
  if (check) process.exit(0);
  const json = JSON.stringify(v2, null, 2) + "\n";
  if (outPath) fs.writeFileSync(outPath, json);
  else process.stdout.write(json);
}
