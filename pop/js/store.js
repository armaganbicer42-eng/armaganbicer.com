/*
 * store.js — the ONLY file that touches persistence.
 *
 * Phase 1: IndexedDB, local to this browser.
 * Phase 2: rewrite these method bodies to call Supabase (auth + table + storage).
 *          Nothing else in the app should need to change.
 *
 * Every method is async on purpose, so swapping in a network backend later
 * does not ripple into the UI code.
 */
window.Store = (function () {
  var DB_NAME = 'pop';
  var DB_VERSION = 1;
  var STORE = 'tasks';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function reqToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    /** Resolve once the store is ready to use. */
    init: function () {
      return open().then(function () {});
    },

    /** All tasks, oldest first. */
    getTasks: function () {
      return tx('readonly').then(function (os) {
        return reqToPromise(os.getAll());
      }).then(function (rows) {
        return (rows || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
      });
    },

    /**
     * Add a task.
     * @param {{text?, image?, x?, y?, r?, variant?, seq?}} data
     * @returns {Promise<object>} the stored task
     */
    addTask: function (data) {
      data = data || {};
      var task = {
        id: uid(),
        text: data.text || '',
        image: data.image || null,
        x: typeof data.x === 'number' ? data.x : null,
        y: typeof data.y === 'number' ? data.y : null,
        r: typeof data.r === 'number' ? data.r : 56,
        variant: typeof data.variant === 'number' ? data.variant : 1,
        seq: typeof data.seq === 'number' ? data.seq : 0,
        done: false,
        createdAt: Date.now()
      };
      return tx('readwrite').then(function (os) {
        return reqToPromise(os.add(task));
      }).then(function () { return task; });
    },

    /** Shallow-merge a patch into one task. */
    updateTask: function (id, patch) {
      return tx('readwrite').then(function (os) {
        return reqToPromise(os.get(id)).then(function (row) {
          if (!row) return null;
          Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
          return reqToPromise(os.put(row)).then(function () { return row; });
        });
      });
    },

    /** Remove one task for good. */
    deleteTask: function (id) {
      return tx('readwrite').then(function (os) {
        return reqToPromise(os['delete'](id));
      });
    },

    /** Wipe everything (dev helper). */
    clear: function () {
      return tx('readwrite').then(function (os) {
        return reqToPromise(os.clear());
      });
    }
  };
})();
