/* CaNaMED LOCAL TEST BACKEND.
 *
 * A localStorage-backed Firebase Realtime Database lookalike used when
 * window.CANAMED_FIREBASE is null (the "local test mode" documented in
 * firebase-config.js). Implements just enough of the Firebase compat
 * API surface that the rest of script.js doesn't have to know which
 * backend is wired:
 *
 *   ref(path).set(val) / .remove() / .push(val) / .once()
 *   ref(path).on(event, cb) / .off()   — "value" and "child_added" events
 *   ref(path).transaction(fn)
 *   ref(path).onDisconnect().remove() / .cancel()
 *   ref(path).child(sub)
 *
 * Snapshots handed to once()/on()/transaction() are DataSnapshot
 * lookalikes: { key, val(), forEach(cb) }. forEach iterates children in
 * Firebase key order as nested snapshots and stops early when the
 * callback returns truthy — script.js's listMyScenarios /
 * listSharedScenarios (and scenario-author-cloud.js) rely on exactly
 * that compat contract.
 *
 * Sync model: the storage event fires on every OTHER tab when one tab
 * writes — so opening N tabs of the same browser gives you N pseudo-
 * clients seeing the same data. Each tab's own .write() also calls
 * _notifyAll() so its own listeners fire (Firebase semantics).
 *
 * The onDisconnect handlers fire on `beforeunload`, mirroring Firebase
 * onDisconnect for the duration of a single browser session. Reload
 * counts as a disconnect.
 *
 * Extracted from script.js into its own file in 2026-05 — it's self-
 * contained, ~150 lines, and didn't belong inline in a 4500-line file.
 *
 * No external deps. Exposes window.CanamedLocalDB { LocalDB, LocalRef }
 * for the loader in script.js; also exports for Node-side unit tests.
 */

(function (root, factory) {
  const exp = factory();
  if (typeof window !== "undefined") {
    window.CanamedLocalDB = exp;
    // legacy: expose the constructors directly too, so script.js's
    // `new LocalDB()` keeps working without changes.
    window.LocalDB = exp.LocalDB;
    window.LocalRef = exp.LocalRef;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = exp;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOCALDB_KEY = "canamed_localdb_v1";

  /* Last path segment = the snapshot's key (null at the root), mirroring
     Firebase DataSnapshot.key. */
  function keyOf(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  /* Firebase child ordering for default (orderByKey) queries: keys that
     parse as non-negative integers sort first, numerically; all other
     keys follow, lexicographically. */
  function compareKeys(a, b) {
    const ai = /^(0|[1-9]\d*)$/.test(a) ? parseInt(a, 10) : null;
    const bi = /^(0|[1-9]\d*)$/.test(b) ? parseInt(b, 10) : null;
    if (ai !== null && bi !== null) return ai - bi;
    if (ai !== null) return -1;
    if (bi !== null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* Minimal Firebase DataSnapshot lookalike. forEach(cb) visits each
     child as a nested snapshot in Firebase key order; a truthy return
     from cb stops the iteration and makes forEach return true (compat
     semantics). Leaves (scalars / null) have no children, so forEach is
     a no-op returning false. */
  function makeSnap(key, val) {
    return {
      key: key,
      val: () => val,
      forEach: (cb) => {
        if (val === null || typeof val !== "object") return false;
        const keys = Object.keys(val).sort(compareKeys);
        for (const k of keys) {
          if (cb(makeSnap(k, val[k]))) return true;
        }
        return false;
      }
    };
  }

  class LocalDB {
    constructor() {
      this._subs = [];
      this._disconnects = [];
      if (typeof window !== "undefined") {
        window.addEventListener("storage", (e) => {
          if (e.key === LOCALDB_KEY) this._notifyAll();
        });
        window.addEventListener("beforeunload", () => {
          if (!this._disconnects.length) return;
          const tree = this._read();
          this._disconnects.forEach((p) => this._setAt(tree, p, null));
          try { localStorage.setItem(LOCALDB_KEY, JSON.stringify(tree)); } catch (e) {}
        });
      }
    }
    _read() {
      try { return JSON.parse(localStorage.getItem(LOCALDB_KEY)) || {}; }
      catch (e) { return {}; }
    }
    _write(tree) {
      try { localStorage.setItem(LOCALDB_KEY, JSON.stringify(tree)); } catch (e) {}
      this._notifyAll();
    }
    _getAt(tree, path) {
      const parts = path.split("/").filter(Boolean);
      let node = tree;
      for (const p of parts) {
        if (node == null || typeof node !== "object") return null;
        node = node[p];
      }
      return node === undefined ? null : node;
    }
    _setAt(tree, path, val) {
      const parts = path.split("/").filter(Boolean);
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (val === null || val === undefined) delete node[last];
      else node[last] = val;
    }
    _notifyAll() {
      // Read the tree FRESH for each subscriber: a subscriber's callback may
      // write (re-entrantly), and later subscribers must see that write rather
      // than a stale snapshot taken at the start of the notification.
      this._subs.slice().forEach((s) => this._deliver(s));
    }
    // Event-aware delivery for one subscription. "value" keeps the historic
    // whole-path snapshot. "child_added" mirrors the Firebase compat API the
    // Module A chat depends on (modA-llm-init.js _onChatChild): fire ONCE per
    // child key, each with a snapshot of that single child — including a
    // replay of the children that already exist at subscribe time. Without
    // this, chat turn bubbles never rendered in LOCAL mode (the callback got
    // the whole turn map, which has no .role, and bailed). Keys are visited
    // in Firebase key order — push() keys embed a base36 timestamp, so key
    // order is chronological across different milliseconds (same-ms pushes
    // tie-break on the random suffix; the chat's two turns per submit are
    // separated by an async boundary, so this never bites there). NB `seen`
    // only ever GROWS: a child removed and later re-added under the same key
    // will NOT re-fire (this shim has no child_removed) — fine for append-only
    // lists like the chat, a trap for mutable ones.
    _deliver(sub) {
      if (sub.event === "child_added") {
        const node = this._getAt(this._read(), sub.path);
        if (node === null || typeof node !== "object") return;
        Object.keys(node).sort(compareKeys).forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(sub.seen, k)) return;
          sub.seen[k] = true;   // mark BEFORE cb: a re-entrant write must not re-fire it
          sub.cb(makeSnap(k, node[k]));
        });
        return;
      }
      const tree = this._read();
      sub.cb(makeSnap(keyOf(sub.path), this._getAt(tree, sub.path)));
    }
    ref(path) {
      return new LocalRef(this, String(path).replace(/^\/+|\/+$/g, ""));
    }
  }

  class LocalRef {
    constructor(dbi, path) { this._db = dbi; this._path = path; this._mine = []; }
    child(sub) { return new LocalRef(this._db, this._path + "/" + sub); }
    set(val) {
      const tree = this._db._read();
      this._db._setAt(tree, this._path, val);
      this._db._write(tree);
      return Promise.resolve();
    }
    // Firebase-style multi-path update: each key is a (possibly slash-
    // separated) path relative to this ref; siblings not named are left
    // intact. Single read-modify-write so subscribers fire once.
    update(obj) {
      if (!obj || typeof obj !== "object") return Promise.resolve();
      const tree = this._db._read();
      Object.keys(obj).forEach((k) => {
        this._db._setAt(tree, this._path + "/" + k, obj[k]);
      });
      this._db._write(tree);
      return Promise.resolve();
    }
    remove() { return this.set(null); }
    push(val) {
      const key = "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      return this.child(key).set(val);
    }
    once() {
      const val = this._db._getAt(this._db._read(), this._path);
      return Promise.resolve(makeSnap(keyOf(this._path), val));
    }
    on(event, cb) {
      const sub = { path: this._path, cb: cb, event: event };
      // Null-prototype so a child literally keyed "toString"/"__proto__"
      // can't collide with Object.prototype (same hardening rule as the
      // pseudonymiser's name maps).
      if (event === "child_added") sub.seen = Object.create(null);
      this._db._subs.push(sub);
      this._mine.push(sub);
      // Initial delivery: "value" fires with the current whole-path value;
      // "child_added" replays each existing child (Firebase semantics).
      this._db._deliver(sub);
      return cb;
    }
    off() {
      this._db._subs = this._db._subs.filter((s) => this._mine.indexOf(s) === -1);
      this._mine = [];
    }
    transaction(fn) {
      const tree = this._db._read();
      const res = fn(this._db._getAt(tree, this._path));
      let committed = false, finalVal = this._db._getAt(tree, this._path);
      if (res !== undefined) {              // undefined = abort, mirrors Firebase
        this._db._setAt(tree, this._path, res);
        this._db._write(tree);
        committed = true; finalVal = res;
      }
      // resolve with a Firebase-shaped result so callers can read .committed
      return Promise.resolve({ committed: committed, snapshot: makeSnap(keyOf(this._path), finalVal) });
    }
    onDisconnect() {
      const self = this;
      return {
        remove: function () { self._db._disconnects.push(self._path); },
        // mirrors Firebase's onDisconnect().cancel() so reconnect code is portable
        cancel: function () {
          self._db._disconnects = self._db._disconnects.filter((p) => p !== self._path);
        }
      };
    }
  }

  return { LocalDB, LocalRef, LOCALDB_KEY };
});
