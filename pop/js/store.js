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
  var DB_VERSION = 2;
  var STORE = 'tasks';
  var EVENTS = 'events';        // calendar reminders (single or recurring)
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
        if (!db.objectStoreNames.contains(EVENTS)) {
          db.createObjectStore(EVENTS, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, name) {
    name = name || STORE;
    return open().then(function (db) {
      return db.transaction(name, mode).objectStore(name);
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

  /** Coerce whatever the UI passes into a well-formed recurrence rule. */
  function normalizeRecur(r) {
    r = r || {};
    var freq = ['none', 'daily', 'weekly', 'monthly', 'yearly'].indexOf(r.freq) >= 0
      ? r.freq : 'none';
    var count = parseInt(r.count, 10);
    return {
      freq: freq,
      interval: Math.max(1, parseInt(r.interval, 10) || 1),
      weekdays: Array.isArray(r.weekdays)
        ? r.weekdays.map(Number).filter(function (n) { return n >= 0 && n <= 6; })
        : [],
      until: r.until || null,                 // 'YYYY-MM-DD'
      count: count > 0 ? count : null
    };
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
        id: data.id || uid(),
        text: data.text || '',
        image: data.image || null,
        x: typeof data.x === 'number' ? data.x : null,
        y: typeof data.y === 'number' ? data.y : null,
        r: typeof data.r === 'number' ? data.r : 56,
        variant: typeof data.variant === 'number' ? data.variant : 1,
        seq: typeof data.seq === 'number' ? data.seq : 0,
        kind: data.kind || null,
        slot: typeof data.slot === 'number' ? data.slot : null,
        evKey: data.evKey || null,      // set when a bubble is a calendar occurrence
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

    /** Wipe everything — tasks and calendar events. */
    clear: function () {
      return Promise.all([
        tx('readwrite', STORE).then(function (os) { return reqToPromise(os.clear()); }),
        tx('readwrite', EVENTS).then(function (os) { return reqToPromise(os.clear()); })
      ]);
    },

    // ---- calendar events (single or recurring reminders) --------------------

    /** All events, earliest start first. */
    getEvents: function () {
      return tx('readonly', EVENTS).then(function (os) {
        return reqToPromise(os.getAll());
      }).then(function (rows) {
        return (rows || []).sort(function (a, b) {
          return String(a.start || '').localeCompare(String(b.start || ''));
        });
      });
    },

    /**
     * Add an event.
     * @param {{title?, notes?, start?, time?, allDay?, recur?}} data
     *        start/until are 'YYYY-MM-DD', time is 'HH:MM' or null.
     * @returns {Promise<object>} the stored event
     */
    addEvent: function (data) {
      data = data || {};
      var ev = {
        id: data.id || uid(),
        title: (data.title || '').trim(),
        notes: (data.notes || '').trim(),
        start: data.start || null,
        time: data.time || null,
        allDay: data.time ? false : data.allDay !== false,
        recur: normalizeRecur(data.recur),
        createdAt: Date.now()
      };
      return tx('readwrite', EVENTS).then(function (os) {
        return reqToPromise(os.put(ev));
      }).then(function () { return ev; });
    },

    /** Shallow-merge a patch into one event (recur is re-normalized). */
    updateEvent: function (id, patch) {
      return tx('readwrite', EVENTS).then(function (os) {
        return reqToPromise(os.get(id)).then(function (row) {
          if (!row) return null;
          Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
          if (patch.recur) row.recur = normalizeRecur(patch.recur);
          row.allDay = row.time ? false : row.allDay !== false;
          return reqToPromise(os.put(row)).then(function () { return row; });
        });
      });
    },

    /** Remove one event for good. */
    deleteEvent: function (id) {
      return tx('readwrite', EVENTS).then(function (os) {
        return reqToPromise(os['delete'](id));
      });
    }
  };
})();
