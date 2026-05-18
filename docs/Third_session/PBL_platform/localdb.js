/* CaNaMED LOCAL TEST BACKEND.
 *
 * A localStorage-backed Firebase Realtime Database lookalike used when
 * window.CANAMED_FIREBASE is null (the "local test mode" documented in
 * firebase-config.js). Implements just enough of the Firebase compat
 * API surface that the rest of script.js doesn't have to know which
 * backend is wired:
 *
 *   ref(path).set(val) / .remove() / .push(val) / .once()
 *   ref(path).on(event, cb) / .off()
 *   ref(path).transaction(fn)
 *   ref(path).onDisconnect().remove() / .cancel()
 *   ref(path).child(sub)
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
      this._subs.slice().forEach((s) => {
        const tree = this._read();
        s.cb({ val: () => this._getAt(tree, s.path) });
      });
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
    remove() { return this.set(null); }
    push(val) {
      const key = "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      return this.child(key).set(val);
    }
    once() {
      const val = this._db._getAt(this._db._read(), this._path);
      return Promise.resolve({ val: () => val });
    }
    on(event, cb) {
      const sub = { path: this._path, cb: cb };
      this._db._subs.push(sub);
      this._mine.push(sub);
      cb({ val: () => this._db._getAt(this._db._read(), this._path) });
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
      return Promise.resolve({ committed: committed, snapshot: { val: () => finalVal } });
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
