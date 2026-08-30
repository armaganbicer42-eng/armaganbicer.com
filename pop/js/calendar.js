/*
 * calendar.js — the profile panel + the reminders calendar.
 *
 * Opens on the `pop:profile` event (fired by the profile button in app.js).
 * Lets the user add single or recurring reminders; each occurrence that falls
 * on "today" is turned into a bubble by app.js (see syncEventBubbles there).
 *
 * Persistence is entirely through Store (getEvents / addEvent / updateEvent /
 * deleteEvent). This file owns no storage of its own.
 *
 * Design is deliberately plain for now — this is about the functionality.
 */
(function () {
  'use strict';

  // ---- language (same rule as app.js) --------------------------------------

  function detectLang() {
    try {
      var q = (location.search.match(/[?&]lang=(tr|en)\b/) || [])[1];
      if (q) return q;
    } catch (e) {}
    var l = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return String(l).toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  }
  var LANG = detectLang();
  var LOC = LANG === 'tr' ? 'tr-TR' : 'en-US';

  var S_ = {
    en: {
      name: 'patlat', close: 'Close',
      account: 'Account',
      accountSoon: 'Sign-in is coming later. For now your reminders live on this device.',
      calTitle: 'Reminders',
      calHint: 'The small things you keep forgetting. Each one pops up as a bubble on its day.',
      add: 'Add reminder', nothing: 'Nothing on this day',
      title: 'What', date: 'Date', allDay: 'All day', time: 'Time',
      repeat: 'Repeat', every: 'Every', ends: 'Ends', notes: 'Notes',
      save: 'Save', cancel: 'Cancel', del: 'Delete',
      needTitle: 'Type what it is first.',
      freq: { none: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' },
      unit: { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' },
      endsOpt: { never: 'Never', until: 'On date', count: 'After N times' },
      times: 'times'
    },
    tr: {
      name: 'patlat', close: 'Kapat',
      account: 'Hesap',
      accountSoon: 'Giriş sonra gelecek. Şimdilik hatırlatıcıların bu cihazda tutuluyor.',
      calTitle: 'Hatırlatıcılar',
      calHint: 'Sürekli unuttuğun küçük şeyler. Her biri o gün baloncuk olarak çıkar.',
      add: 'Hatırlatıcı ekle', nothing: 'Bu güne bir şey yok',
      title: 'Ne', date: 'Tarih', allDay: 'Tüm gün', time: 'Saat',
      repeat: 'Tekrar', every: 'Her', ends: 'Bitiş', notes: 'Notlar',
      save: 'Kaydet', cancel: 'İptal', del: 'Sil',
      needTitle: 'Önce ne olduğunu yaz.',
      freq: { none: 'Tekrar etmez', daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' },
      unit: { daily: 'gün', weekly: 'hafta', monthly: 'ay', yearly: 'yıl' },
      endsOpt: { never: 'Asla', until: 'Tarihte', count: 'N kez sonra' },
      times: 'kez'
    }
  };
  var T = S_[LANG];

  // ---- date helpers (local time, date-only strings) -----------------------

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) {
    var y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
    var res = new Date(y, m, day);
    // clamp Jan-31 + 1 month to Feb-28/29 rather than spilling into March
    if (res.getDate() !== day) res = new Date(y, m + 1, 0);
    return res;
  }
  function addYears(d, n) {
    var res = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
    if (res.getDate() !== d.getDate()) res = new Date(d.getFullYear() + n, d.getMonth() + 1, 0);
    return res;
  }

  /**
   * Every occurrence date of `ev` that lands in [rangeStart, rangeEnd],
   * inclusive, as 'YYYY-MM-DD' strings.
   */
  function expandOccurrences(ev, rangeStart, rangeEnd) {
    var out = [];
    var start = parseYmd(ev && ev.start);
    if (!start) return out;
    var rs = day0(rangeStart).getTime();
    var re = day0(rangeEnd).getTime();
    var recur = (ev && ev.recur) || { freq: 'none' };
    var freq = recur.freq || 'none';
    var interval = Math.max(1, recur.interval || 1);
    var until = recur.until ? parseYmd(recur.until) : null;
    var untilT = until ? day0(until).getTime() : null;
    var count = recur.count || null;
    var guard = 0;

    if (freq === 'none') {
      var t0 = day0(start).getTime();
      if (t0 >= rs && t0 <= re) out.push(ymd(start));
      return out;
    }

    if (freq === 'weekly') {
      var wds = (recur.weekdays && recur.weekdays.length) ? recur.weekdays : [start.getDay()];
      var week = addDays(start, -start.getDay());   // Sunday of the first week
      var made = 0;
      while (guard++ < 6000) {
        for (var i = 0; i < 7; i++) {
          var d = addDays(week, i);
          var dt = d.getTime();
          if (dt < day0(start).getTime()) continue;
          if (wds.indexOf(d.getDay()) === -1) continue;
          if (untilT !== null && dt > untilT) return out;
          if (count && made >= count) return out;
          made++;
          if (dt > re) return out;
          if (dt >= rs) out.push(ymd(d));
        }
        week = addDays(week, 7 * interval);
        if (week.getTime() > re) break;
        if (untilT !== null && week.getTime() > untilT) break;
      }
      return out;
    }

    // daily / monthly / yearly — step straight off the start date
    for (var n = 0; guard++ < 12000; n++) {
      var occ = freq === 'daily' ? addDays(start, n * interval)
        : freq === 'monthly' ? addMonths(start, n * interval)
        : addYears(start, n * interval);
      var ot = day0(occ).getTime();
      if (untilT !== null && ot > untilT) break;
      if (count && n >= count) break;
      if (ot > re) break;
      if (ot >= rs) out.push(ymd(occ));
    }
    return out;
  }

  // ---- panel DOM ---------------------------------------------------------

  var root = null, bodyEl = null, events = [];
  var view = { open: false, y: 0, m: 0, sel: null, editing: null }; // editing: null | 'new' | eventObj

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wdNames(fmt) {
    var a = [];
    for (var i = 0; i < 7; i++) {               // 2023-01-01 was a Sunday
      a.push(new Date(2023, 0, 1 + i).toLocaleDateString(LOC, { weekday: fmt }));
    }
    return a;
  }
  function monthLabel(y, m) {
    return new Date(y, m, 1).toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
  }
  function prettyDate(s) {
    var d = parseYmd(s);
    return d ? d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }) : s;
  }

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'profile-panel';
    root.id = 'profilePanel';
    root.innerHTML =
      '<div class="pp-bar">' +
        '<img class="pp-logo" src="/pop/assets/logo.svg?v=54" alt="' + esc(T.name) + '">' +
        '<button type="button" class="pp-close">' + esc(T.close) + '</button>' +
      '</div>' +
      '<div class="pp-scroll">' +
        '<section class="pp-sec pp-account">' +
          '<h3>' + esc(T.account) + '</h3>' +
          '<p class="pp-muted">' + esc(T.accountSoon) + '</p>' +
        '</section>' +
        '<section class="pp-sec pp-body"></section>' +
      '</div>';
    document.body.appendChild(root);
    bodyEl = root.querySelector('.pp-body');
    root.querySelector('.pp-close').addEventListener('click', close);

    // if logo.svg isn't there, fall back to the plain name
    var logo = root.querySelector('.pp-logo');
    logo.addEventListener('error', function () {
      var name = document.createElement('strong');
      name.className = 'pp-name';
      name.textContent = T.name;
      logo.replaceWith(name);
    });
  }

  function open() {
    ensureDom();
    var now = new Date();
    view.open = true;
    view.y = now.getFullYear();
    view.m = now.getMonth();
    view.sel = ymd(now);
    view.editing = null;
    root.classList.add('open');
    document.body.classList.add('pp-locked');
    refresh();
  }
  function close() {
    view.open = false;
    view.editing = null;
    if (root) root.classList.remove('open');
    document.body.classList.remove('pp-locked');
  }
  function refresh() {
    Store.getEvents().then(function (rows) {
      events = rows || [];
      render();
    });
  }

  function render() {
    if (!view.open || !bodyEl) return;
    bodyEl.innerHTML = view.editing ? formHtml(view.editing === 'new' ? null : view.editing) : calHtml();
    wire();
  }

  // ---- calendar view ---------------------------------------------------

  function monthCells(y, m) {
    var first = new Date(y, m, 1);
    var gridStart = addDays(first, -first.getDay());
    var cells = [];
    for (var i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
    return cells;
  }
  function occurrenceIndex(rangeStart, rangeEnd) {
    var idx = {};
    events.forEach(function (ev) {
      expandOccurrences(ev, rangeStart, rangeEnd).forEach(function (s) {
        (idx[s] || (idx[s] = [])).push(ev);
      });
    });
    return idx;
  }
  function recurTag(ev) {
    var f = ev.recur && ev.recur.freq;
    return (f && f !== 'none') ? ' <span class="ev-badge">' + esc(T.freq[f]) + '</span>' : '';
  }

  function calHtml() {
    var cells = monthCells(view.y, view.m);
    var idx = occurrenceIndex(cells[0], cells[41]);
    var todayS = ymd(new Date());
    var sel = view.sel || todayS;

    var h = '<h3>' + esc(T.calTitle) + '</h3><p class="pp-muted">' + esc(T.calHint) + '</p>';

    h += '<div class="cal-nav">' +
      '<button type="button" class="cal-arrow" data-nav="-1">&#8249;</button>' +
      '<strong>' + esc(monthLabel(view.y, view.m)) + '</strong>' +
      '<button type="button" class="cal-arrow" data-nav="1">&#8250;</button></div>';

    h += '<div class="cal-grid cal-grid--head">';
    wdNames('short').forEach(function (w) { h += '<div class="cal-hcell">' + esc(w) + '</div>'; });
    h += '</div><div class="cal-grid">';
    cells.forEach(function (d) {
      var key = ymd(d);
      var cls = 'cal-cell';
      if (d.getMonth() !== view.m) cls += ' is-other';
      if (key === todayS) cls += ' is-today';
      if (key === sel) cls += ' is-sel';
      h += '<button type="button" class="' + cls + '" data-day="' + key + '">' +
        '<span class="cal-n">' + d.getDate() + '</span>' +
        (idx[key] && idx[key].length ? '<span class="cal-dot"></span>' : '') +
        '</button>';
    });
    h += '</div>';

    var list = idx[sel] || [];
    h += '<div class="pp-dayhead">' + esc(prettyDate(sel)) + '</div>';
    if (!list.length) {
      h += '<p class="pp-muted">' + esc(T.nothing) + '</p>';
    } else {
      h += '<ul class="ev-list">';
      list.forEach(function (ev) {
        h += '<li data-ev="' + esc(ev.id) + '">' +
          (ev.time ? '<b>' + esc(ev.time) + '</b> ' : '') +
          esc(ev.title || '') + recurTag(ev) + '</li>';
      });
      h += '</ul>';
    }
    h += '<button type="button" class="btn pp-add" data-add>' + esc(T.add) + '</button>';
    return h;
  }

  // ---- add / edit form ----------------------------------------------------

  function formHtml(ev) {
    var r = (ev && ev.recur) || { freq: 'none', interval: 1, weekdays: [] };
    var ends = r.until ? 'until' : (r.count ? 'count' : 'never');
    var startVal = (ev && ev.start) || view.sel || ymd(new Date());
    var checked = (!ev || (ev.allDay !== false && !ev.time)) ? ' checked' : '';
    var wn = wdNames('narrow');
    var h = '<h3>' + esc(ev ? T.calTitle : T.add) + '</h3><form class="ev-form">';

    h += '<label>' + esc(T.title) +
      '<input name="title" value="' + esc(ev ? ev.title : '') + '" required></label>';
    h += '<label>' + esc(T.date) +
      '<input type="date" name="date" value="' + esc(startVal) + '"></label>';
    h += '<label class="ev-check"><input type="checkbox" name="allday"' + checked + '> ' +
      esc(T.allDay) + '</label>';
    h += '<label data-when="timed">' + esc(T.time) +
      '<input type="time" name="time" value="' + esc(ev && ev.time ? ev.time : '') + '"></label>';

    h += '<label>' + esc(T.repeat) + '<select name="freq">';
    ['none', 'daily', 'weekly', 'monthly', 'yearly'].forEach(function (f) {
      h += '<option value="' + f + '"' + (r.freq === f ? ' selected' : '') + '>' + esc(T.freq[f]) + '</option>';
    });
    h += '</select></label>';

    h += '<label data-when="repeat">' + esc(T.every) +
      ' <input type="number" name="interval" min="1" value="' + (r.interval || 1) + '"> ' +
      '<span data-unit></span></label>';

    h += '<div class="wd-toggle" data-when="weekly">';
    for (var i = 0; i < 7; i++) {
      var on = (r.weekdays || []).indexOf(i) >= 0 ? ' on' : '';
      h += '<button type="button" class="wd-btn' + on + '" data-wd="' + i + '">' + esc(wn[i]) + '</button>';
    }
    h += '</div>';

    h += '<label data-when="repeat">' + esc(T.ends) + '<select name="ends">';
    ['never', 'until', 'count'].forEach(function (e) {
      h += '<option value="' + e + '"' + (ends === e ? ' selected' : '') + '>' + esc(T.endsOpt[e]) + '</option>';
    });
    h += '</select></label>';
    h += '<label data-when="until"><input type="date" name="until" value="' + esc(r.until || '') + '"></label>';
    h += '<label data-when="count"><input type="number" name="count" min="1" value="' +
      (r.count || 10) + '"> ' + esc(T.times) + '</label>';

    h += '<div class="ev-actions">' +
      '<button type="submit" class="btn">' + esc(T.save) + '</button>' +
      '<button type="button" class="btn btn--ghost" data-act="cancel">' + esc(T.cancel) + '</button>' +
      (ev ? '<button type="button" class="btn btn--danger" data-act="delete">' + esc(T.del) + '</button>' : '') +
      '</div></form>';
    return h;
  }

  function applyFormVis(form) {
    var allday = form.elements.allday.checked;
    var freq = form.elements.freq.value;
    var ends = form.elements.ends ? form.elements.ends.value : 'never';
    [].forEach.call(form.querySelectorAll('[data-when]'), function (el) {
      var w = el.getAttribute('data-when');
      var show =
        w === 'timed' ? !allday :
        w === 'repeat' ? freq !== 'none' :
        w === 'weekly' ? freq === 'weekly' :
        w === 'until' ? (freq !== 'none' && ends === 'until') :
        w === 'count' ? (freq !== 'none' && ends === 'count') : true;
      el.hidden = !show;
    });
    var unit = form.querySelector('[data-unit]');
    if (unit) unit.textContent = T.unit[freq] || '';
  }

  function collect(form) {
    var val = function (n) { var el = form.elements[n]; return el ? el.value : ''; };
    var allday = form.elements.allday.checked;
    var freq = val('freq');
    var title = val('title').trim();
    if (!title) { form.elements.title.focus(); alert(T.needTitle); return null; }
    var ends = val('ends');
    var start = val('date') || ymd(new Date());
    var wd = [].map.call(form.querySelectorAll('.wd-btn.on'), function (b) {
      return +b.getAttribute('data-wd');
    });
    if (freq === 'weekly' && !wd.length) {
      var sd = parseYmd(start);
      wd = [sd ? sd.getDay() : 0];
    }
    return {
      title: title,
      start: start,
      time: allday ? null : (val('time') || null),
      allDay: allday,
      recur: {
        freq: freq,
        interval: parseInt(val('interval'), 10) || 1,
        weekdays: freq === 'weekly' ? wd : [],
        until: (freq !== 'none' && ends === 'until') ? (val('until') || null) : null,
        count: (freq !== 'none' && ends === 'count') ? (parseInt(val('count'), 10) || null) : null
      }
    };
  }

  function afterChange() {
    window.dispatchEvent(new CustomEvent('pop:events-changed'));
    view.editing = null;
    refresh();
  }

  function wire() {
    if (view.editing) {
      var form = bodyEl.querySelector('.ev-form');
      applyFormVis(form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var data = collect(form);
        if (!data) return;
        var p = (view.editing && view.editing !== 'new')
          ? Store.updateEvent(view.editing.id, data)
          : Store.addEvent(data);
        p.then(afterChange);
      });
      form.addEventListener('change', function (e) {
        if (['allday', 'freq', 'ends'].indexOf(e.target.name) >= 0) applyFormVis(form);
      });
      [].forEach.call(form.querySelectorAll('.wd-btn'), function (b) {
        b.addEventListener('click', function () { b.classList.toggle('on'); });
      });
      bodyEl.querySelector('[data-act="cancel"]').addEventListener('click', function () {
        view.editing = null; render();
      });
      var del = bodyEl.querySelector('[data-act="delete"]');
      if (del) del.addEventListener('click', function () {
        Store.deleteEvent(view.editing.id).then(afterChange);
      });
      return;
    }

    [].forEach.call(bodyEl.querySelectorAll('[data-nav]'), function (b) {
      b.addEventListener('click', function () {
        var d = new Date(view.y, view.m + (+b.getAttribute('data-nav')), 1);
        view.y = d.getFullYear(); view.m = d.getMonth();
        render();
      });
    });
    [].forEach.call(bodyEl.querySelectorAll('[data-day]'), function (b) {
      b.addEventListener('click', function () { view.sel = b.getAttribute('data-day'); render(); });
    });
    var add = bodyEl.querySelector('[data-add]');
    if (add) add.addEventListener('click', function () { view.editing = 'new'; render(); });
    [].forEach.call(bodyEl.querySelectorAll('[data-ev]'), function (li) {
      li.addEventListener('click', function () {
        var id = li.getAttribute('data-ev');
        var ev = events.filter(function (x) { return x.id === id; })[0];
        if (ev) { view.editing = ev; render(); }
      });
    });
  }

  // ---- boot ------------------------------------------------------------

  window.addEventListener('pop:profile', open);
  document.addEventListener('keydown', function (e) {
    if (!view.open || e.key !== 'Escape') return;
    if (view.editing) { view.editing = null; render(); } else { close(); }
  });

  // used by app.js to turn today's occurrences into bubbles
  window.PatlatCal = {
    open: open,
    close: close,
    expandOccurrences: expandOccurrences,
    ymd: ymd,
    parseYmd: parseYmd,
    addDays: addDays
  };
})();
