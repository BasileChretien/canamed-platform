"use strict";
/* tests/fixtures/rtdb-shape.js
 *
 * What a tree looks like once the Realtime Database hands it back. The
 * database has no arrays, but a READ does: `.val()` returns a node whose keys
 * are all small non-negative integers, more than half of them filled between
 * 0 and the largest, as a JavaScript ARRAY (missing indices are holes).
 * scripts/lib/session-trees.js notes the same thing for REST listings.
 *
 * That shape is not rare here. Section slots are integer-keyed by rule
 * (`$slot` matches /^[1-9]$/) and the client writes `rooms/<r>/sections/<slot>`
 * and `rooms/<r>/answers/sections/<slot>`; the legacy per-prompt reply lists
 * start at index 0; and anyone who writes keys `0`, `1`, … gets one on purpose.
 * A fixture written as plain objects tests a shape the export job never reads
 * for the product's main session layout.
 */

const INTEGER_KEY = /^(0|[1-9][0-9]*)$/;

/** A deep copy of `tree` with every node RTDB would return as an array turned
 *  into one. The input is not mutated. */
function asRtdbWould(tree) {
  if (Array.isArray(tree)) return tree.map(asRtdbWould);
  if (!tree || typeof tree !== "object") return tree;
  const out = {};
  for (const k of Object.keys(tree)) out[k] = asRtdbWould(tree[k]);
  const keys = Object.keys(out);
  if (!keys.length || !keys.every((k) => INTEGER_KEY.test(k))) return out;
  const max = Math.max(...keys.map(Number));
  if (keys.length * 2 <= max + 1) return out;
  const arr = [];
  arr.length = max + 1;
  for (const k of keys) arr[Number(k)] = out[k];
  return arr;
}

/** STRICTER than the database: every node whose keys are all integers becomes
 *  an array, however sparse (a lone slot 1 too). For coverage tests that must
 *  put an array on the path of every case; a filter that handles this handles
 *  whatever `.val()` returns. */
function asArraysEverywhere(tree) {
  if (Array.isArray(tree)) return tree.map(asArraysEverywhere);
  if (!tree || typeof tree !== "object") return tree;
  const out = {};
  for (const k of Object.keys(tree)) out[k] = asArraysEverywhere(tree[k]);
  const keys = Object.keys(out);
  if (!keys.length || !keys.every((k) => INTEGER_KEY.test(k))) return out;
  const arr = [];
  arr.length = Math.max(...keys.map(Number)) + 1;
  for (const k of keys) arr[Number(k)] = out[k];
  return arr;
}

/** Whether `tree` holds at least one array — a test of the shape that holds
 *  none would pass on the defect. */
function holdsArray(tree) {
  if (Array.isArray(tree)) return true;
  if (!tree || typeof tree !== "object") return false;
  return Object.keys(tree).some((k) => holdsArray(tree[k]));
}

module.exports = { asRtdbWould, asArraysEverywhere, holdsArray };
