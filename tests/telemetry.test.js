/* tests/telemetry.test.js
 *
 * In-browser error/CSP capture lives in telemetry.js. Most of the
 * surface is event-listener wiring that can only be exercised in a
 * real browser (covered by the Playwright suite). The Node-side
 * surface is the public API + storage interactions; those are what
 * we test here.
 *
 * We simulate window + sessionStorage with minimal mocks so the
 * module's UMD wrapper picks them up the same way as the browser.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");

function freshTelemetry() {
  // Drop any cached module
  delete require.cache[require.resolve("../docs/Third_session/PBL_platform/telemetry.js")];
  // Mock the browser globals telemetry.js looks for. Reset listeners
  // each load.
  const listeners = [];
  const storage = {};
  global.sessionStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  global.window = {
    addEventListener: (name, fn) => listeners.push({ name, fn })
  };
  global.document = {
    readyState: "complete",
    addEventListener: (name, fn) => listeners.push({ name, fn })
  };
  // Node 21+ exposes a read-only `navigator` global. Use defineProperty
  // to override it (configurable so subsequent test reloads work too).
  Object.defineProperty(global, "navigator", {
    value: { language: "en-US", userAgent: "node-test" },
    writable: true, configurable: true
  });
  global.location = { href: "http://test.local/" };
  // Also set `self` so the UMD detection finds something
  global.self = global.window;
  const mod = require("../docs/Third_session/PBL_platform/telemetry.js");
  return { mod, listeners, storage };
}

test("telemetry: public API surface", () => {
  const { mod } = freshTelemetry();
  assert.equal(typeof mod.init, "function");
  assert.equal(typeof mod.record, "function");
  assert.equal(typeof mod.getErrors, "function");
  assert.equal(typeof mod.clear, "function");
  assert.equal(typeof mod.download, "function");
  assert.equal(typeof mod.MAX_ENTRIES, "number");
  assert.ok(mod.MAX_ENTRIES >= 10);
});

test("telemetry: record appends entries with required envelope fields", () => {
  const { mod } = freshTelemetry();
  mod.clear();
  mod.record("test-kind", { foo: 1 });
  const errors = mod.getErrors();
  assert.equal(errors.length, 1);
  const e = errors[0];
  assert.equal(e.kind, "test-kind");
  assert.deepStrictEqual(e.payload, { foo: 1 });
  assert.ok(typeof e.at === "string" && e.at.length > 0);
  // ISO timestamp roughly looks right
  assert.match(e.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("telemetry: clear empties the buffer + storage", () => {
  const { mod, storage } = freshTelemetry();
  mod.record("x", null);
  mod.record("y", null);
  assert.equal(mod.getErrors().length, 2);
  mod.clear();
  assert.equal(mod.getErrors().length, 0);
  // Storage should reflect the empty buffer
  const stored = JSON.parse(storage["canamed_telemetry_buf_v1"] || "[]");
  assert.deepStrictEqual(stored, []);
});

test("telemetry: buffer respects MAX_ENTRIES cap (oldest evicted)", () => {
  const { mod } = freshTelemetry();
  mod.clear();
  for (let i = 0; i < mod.MAX_ENTRIES + 10; i++) {
    mod.record("seq", { i: i });
  }
  const errors = mod.getErrors();
  assert.equal(errors.length, mod.MAX_ENTRIES);
  // First retained entry should be the (MAX+10 - MAX)th = 10
  assert.equal(errors[0].payload.i, 10);
  assert.equal(errors[errors.length - 1].payload.i, mod.MAX_ENTRIES + 9);
});

test("telemetry: init wires window + document listeners", () => {
  const { mod, listeners } = freshTelemetry();
  mod.init();
  const names = listeners.map(l => l.name).sort();
  // Should include the three sources we care about
  assert.ok(names.includes("error"), "no 'error' listener");
  assert.ok(names.includes("unhandledrejection"), "no 'unhandledrejection' listener");
  assert.ok(names.includes("securitypolicyviolation"), "no 'securitypolicyviolation' listener");
});
