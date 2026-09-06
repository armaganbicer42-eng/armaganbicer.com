/*
 * app.js — UI glue. Talks to Store (persistence) and Physics (bubble motion).
 *
 * The backdrop is one SVG illustration. An invisible <path id="arenaBounds">
 * traces just inside the drawn frame; we sample it into a polygon and hand
 * that to the physics sim, so bubbles collide with the actual hand-drawn
 * line (hair dip and head bump included). The .bubbles layer is sized to
 * that path's on-screen box and every bubble coordinate lives in its pixels.
 */
(function () {
  var stage = document.getElementById('stage');
  var headHair = document.querySelector('.headandhair');
  var bubblesEl = document.getElementById('bubbles');
  var boardsEl = document.getElementById('boards');
  var photoInput = document.getElementById('photoInput');
  var hairHit = document.getElementById('hairHit');
  var profileBtn = document.getElementById('profileBtn');
  var undoBtn = document.getElementById('undoBtn');
  var helpBtn = document.getElementById('helpBtn');
  var appEl = document.querySelector('.pop-app');

  // how a bubble gets popped: 'hairswitch' | 'hold' | 'doubletap'
  // ('cactus' / 'bin' need the in-head gadget art — listed but not yet wired)
  var POP_MECH_KEY = 'patlat.popMechanic';
  function readMechanic() {
    var m;
    try { m = localStorage.getItem(POP_MECH_KEY); } catch (e) {}
    return ['hairswitch', 'hold', 'doubletap'].indexOf(m) >= 0 ? m : 'hairswitch';
  }
  var popMechanic = readMechanic();
  var HOLD_MS = 3000;

  var undoStack = [];          // snapshots of popped tasks, newest last
  var UNDO_MAX = 30;

  var bubbles = new Map();     // id -> { task, el, body, url }
  var draft = null;
  var pickingPhoto = false;   // true while the OS photo picker is open
  var mode = 'add';
  var addCount = 0;            // drives the 1-2-3 bubble illustration cycle

  var boards = [];             // [{ id, name, order, createdAt }]
  var activeBoardId = null;
  var renamingId = null;
  var confirmDelId = null;     // board pending inline delete-confirmation
  var BOARD_KEY = 'patlat.activeBoard';
  var poly = [];               // collision polygon in .bubbles pixel space
  var boxW = 1, boxH = 1;
  var savePositionsSoon = throttle(savePositions, 600);

  var sim = Physics.create(function () { return { poly: poly }; });
  sim.onSettle(function () { savePositions(); });

  // ---- collision boundary: the frame interior (a rectangle with a hair dip) --

  function layoutArena() {
    // squeeze head+hair on X only, so its columns line up with the stretched
    // frame while its line weight / vertical scale stay tied to the window height
    if (headHair) {
      var sRect = stage.getBoundingClientRect();
      var naturalW = sRect.height * 1080 / 1920;
      var sx = naturalW > 0 ? sRect.width / naturalW : 1;
      headHair.style.transform = 'translateX(-50%) scaleX(' + sx.toFixed(4) + ')';
    }

    var r = bubblesEl.getBoundingClientRect();
    var prevW = boxW, prevH = boxH;
    boxW = r.width; boxH = r.height;

    var dipW = Math.min(boxW * 0.26, 150);
    var dipD = Math.min(boxH * 0.045, 30);
    var cx = boxW / 2;
    poly = [
      [0, 0],
      [cx - dipW / 2, 0],
      [cx - dipW / 2 + 16, dipD], [cx + dipW / 2 - 16, dipD],
      [cx + dipW / 2, 0],
      [boxW, 0],
      [boxW, boxH],
      [0, boxH]
    ];

    if (prevW > 1 && (Math.abs(prevW - boxW) > 0.5 || Math.abs(prevH - boxH) > 0.5)) {
      var sx = boxW / prevW, sy = boxH / prevH;
      bubbles.forEach(function (b) {
        if (!b.body) return;
        b.body.x *= sx; b.body.y *= sy;
      });
      if (draft) { draft.cx *= sx; draft.cy *= sy; positionDraft(); }
    }
    sim.wake();
  }

  // ---- boot --------------------------------------------------------------------

  // first-ever visit: drop in a starter set of bubbles
  // the 3 how-it-works bubbles, per language, in slot order
  var HOWTO = {
    en: [
      'Flip the hair switch to move between Add and Pop',
      'In Add mode, tap the empty space to drop a task',
      'In Pop mode, tap a task you have done to pop it'
    ],
    tr: [
      'Saçtaki düğmeyle Ekle ve Patlat modu arasında geç',
      'Ekle modunda boş yere dokun, görev baloncuğu düşsün',
      'Patlat modunda bitirdiğin göreve dokun, patlasın'
    ]
  };

  function detectLang() {
    var forced = (location.search.match(/[?&]lang=(tr|en)\b/) || [])[1];
    if (forced) return forced;
    var list = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || 'en'];
    return (list[0] || 'en').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  }
  var uiLang = detectLang();

  function seedTasks() {
    var tr = uiLang === 'tr';
    var howto = HOWTO[uiLang];
    var pool = tr
      ? ['annemi ara', 'markete git', '10 dk yürü', 'e-postalara bak', 'randevu al']
      : ['call mom', 'buy groceries', '10 min walk', 'reply to emails', 'book a dentist'];
    var a = Math.floor(Math.random() * pool.length);
    var b = (a + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;

    var seeds = [
      { text: '💧 su iç', r: 46 },
      { text: '💧 su iç', r: 46 },
      { text: '💧 su iç', r: 46 },
      { text: pool[a], r: 50 },
      { text: pool[b], r: 50 },
      { text: howto[0], r: 70, kind: 'howto', slot: 0 },
      { text: howto[1], r: 70, kind: 'howto', slot: 1 },
      { text: howto[2], r: 70, kind: 'howto', slot: 2 }
    ];

    var chain = Promise.resolve();
    seeds.forEach(function (s, i) {
      chain = chain.then(function () {
        addCount += 1;
        return Store.addTask({
          text: s.text,
          boardId: activeBoardId,
          r: s.r,
          kind: s.kind,
          slot: s.slot,
          variant: ((addCount - 1) % 3) + 1,
          seq: addCount,
          x: s.r + Math.random() * Math.max(1, boxW - s.r * 2),
          y: 20 + i * 12
        });
      });
    });
    return chain.then(function () {
      try { localStorage.setItem('pop.seeded', '1'); } catch (e) {}
    });
  }

  function firstBoardName() { return uiLang === 'tr' ? 'kafam' : 'my head'; }
  function newBoardName() { return uiLang === 'tr' ? 'yeni kafa' : 'new head'; }

  function start() {
    applyLang(uiLang);
    layoutArena();
    requestAnimationFrame(renderLoop);      // one loop for the life of the page

    Store.init()
      .then(function () { return Store.getBoards(); })
      .then(function (bs) {
        boards = bs || [];
        if (boards.length) return;
        // first run on this version: make a board and adopt any board-less
        // tasks (from v1/v2) into it
        return Store.addBoard({ name: firstBoardName(), order: 0 }).then(function (b) {
          boards = [b];
          return Store.getTasks();          // ALL tasks
        }).then(function (all) {
          return Promise.all((all || [])
            .filter(function (t) { return !t.boardId; })
            .map(function (t) { return Store.updateTask(t.id, { boardId: boards[0].id }); }));
        });
      })
      .then(function () {
        var saved = null;
        try { saved = localStorage.getItem(BOARD_KEY); } catch (e) {}
        activeBoardId = boards.some(function (b) { return b.id === saved; })
          ? saved : boards[0].id;

        applyMechanic();

        var onboarded = false;
        try { onboarded = !!localStorage.getItem('patlat.onboarded'); } catch (e) {}
        if (onboarded) {
          return loadBoard(activeBoardId, { seedIfEmpty: true });
        }
        // first ever open: empty board + the guided intro; seed when it ends
        return loadBoard(activeBoardId, { seedIfEmpty: false }).then(function () {
          startTour('onboard');
        });
      })
      .catch(function (err) { console.error('patlat failed to start', err); });
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

  // ---- boards --------------------------------------------------------------

  // tear down the current board's bubbles and load another's
  function loadBoard(id, opts) {
    opts = opts || {};
    savePositions();
    if (draft) discardDraft();
    bubbles.forEach(function (b) {
      if (b.url) URL.revokeObjectURL(b.url);
      b.el.remove();
    });
    bubbles.clear();
    sim.clear();
    addCount = 0;

    activeBoardId = id;
    try { localStorage.setItem(BOARD_KEY, id); } catch (e) {}
    renderBoards();

    return Store.getTasks(id).then(function (tasks) {
      var seeded = false;
      try { seeded = !!localStorage.getItem('pop.seeded'); } catch (e) {}
      if (opts.seedIfEmpty && !tasks.length && !seeded) {
        return seedTasks().then(function () { return Store.getTasks(id); });
      }
      return tasks;
    }).then(function (tasks) {
      tasks.forEach(function (t) {
        if (typeof t.variant === 'number') addCount = Math.max(addCount, t.seq || 0);
        // keep the how-it-works bubbles in the current browser language
        if (t.kind === 'howto' && HOWTO[uiLang] && HOWTO[uiLang][t.slot] &&
            t.text !== HOWTO[uiLang][t.slot]) {
          t.text = HOWTO[uiLang][t.slot];
          Store.updateTask(t.id, { text: t.text });
        }
        spawnBubble(t, { drop: false });
      });
      sim.wake();
      syncEventBubbles();
    });
  }

  function boardsSorted() {
    return boards.slice().sort(function (a, b) {
      return (a.order - b.order) || (a.createdAt - b.createdAt);
    });
  }

  var SVGNS_ = 'http://www.w3.org/2000/svg';
  function useSvg(id, cls) {
    var svg = document.createElementNS(SVGNS_, 'svg');
    svg.setAttribute('class', cls || '');
    var u = document.createElementNS(SVGNS_, 'use');
    u.setAttribute('href', '#' + id);
    svg.appendChild(u);
    return svg;
  }

  function renderBoards() {
    if (!boardsEl) return;
    boardsEl.innerHTML = '';
    boardsSorted().forEach(function (b) {
      if (renamingId === b.id)   { boardsEl.appendChild(renameField(b)); return; }
      if (confirmDelId === b.id) { boardsEl.appendChild(deleteConfirm(b)); return; }
      var isActive = b.id === activeBoardId;
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'board-tab' + (isActive ? ' is-active' : '');
      tab.appendChild(useSvg('icon-tinyframe', 'board-tab__frame'));
      var label = document.createElement('span');
      label.className = 'board-tab__label';
      label.textContent = b.name;
      tab.appendChild(label);
      tab.addEventListener('click', function () {
        confirmDelId = null;
        if (isActive) startRename(b.id);
        else loadBoard(b.id);
      });
      boardsEl.appendChild(tab);

      if (isActive && boards.length > 1) {
        boardsEl.appendChild(makeDelX(b));
      }
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'board-add';
    add.setAttribute('aria-label', uiLang === 'tr' ? 'Yeni kafa' : 'New board');
    add.appendChild(useSvg('icon-tinyplus'));
    add.addEventListener('click', addBoard);
    boardsEl.appendChild(add);
  }

  function makeDelX(b) {
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'board-tab__x';
    x.setAttribute('aria-label', uiLang === 'tr' ? 'Kafayı sil' : 'Delete board');
    x.appendChild(useSvg('icon-tinycross'));
    x.addEventListener('click', function (e) {
      e.stopPropagation();
      renamingId = null;
      confirmDelId = b.id;
      renderBoards();
    });
    return x;
  }

  // inline confirm — window.confirm() is unreliable inside app webviews
  function deleteConfirm(b) {
    var wrap = document.createElement('span');
    wrap.className = 'board-confirm';
    wrap.appendChild(useSvg('icon-tinyframe', 'board-tab__frame'));

    var txt = document.createElement('span');
    txt.className = 'board-confirm__txt';
    txt.textContent = uiLang === 'tr' ? 'sil?' : 'delete?';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'board-confirm__yes';
    yes.setAttribute('aria-label', uiLang === 'tr' ? 'Sil' : 'Delete');
    yes.appendChild(useSvg('icon-tick'));
    yes.addEventListener('click', function (e) {
      e.stopPropagation();
      confirmDelId = null;
      if (boards.length <= 1) { renderBoards(); return; }
      var wasActive = b.id === activeBoardId;
      Store.deleteBoard(b.id).then(function () {
        boards = boards.filter(function (x) { return x.id !== b.id; });
        if (wasActive) loadBoard(boardsSorted()[0].id);
        else renderBoards();
      });
    });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'board-confirm__no';
    no.setAttribute('aria-label', uiLang === 'tr' ? 'Vazgeç' : 'Cancel');
    no.appendChild(useSvg('icon-tinycross'));
    no.addEventListener('click', function (e) {
      e.stopPropagation();
      confirmDelId = null;
      renderBoards();
    });

    wrap.appendChild(txt);
    wrap.appendChild(yes);
    wrap.appendChild(no);
    return wrap;
  }

  function startRename(id) { renamingId = id; confirmDelId = null; renderBoards(); }

  function renameField(b) {
    var wrap = document.createElement('span');
    wrap.className = 'board-rename';
    wrap.appendChild(useSvg('icon-tinyframe', 'board-tab__frame'));

    var input = document.createElement('input');
    input.className = 'board-rename__input';
    input.type = 'text';
    input.value = b.name;
    input.maxLength = 24;
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('autocomplete', 'off');

    var committed = false;
    function finish(name) {
      if (committed) return;
      committed = true;
      renamingId = null;
      name = (name || '').trim() || b.name;
      Store.updateBoard(b.id, { name: name }).then(function () {
        var rec = boards.filter(function (x) { return x.id === b.id; })[0];
        if (rec) rec.name = name;
        renderBoards();
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); committed = true; renamingId = null; renderBoards(); }
    });
    // mobile soft keyboards / IME often commit via 'change' rather than a clean keydown
    input.addEventListener('change', function () { finish(input.value); });
    input.addEventListener('blur', function () {
      setTimeout(function () { if (renamingId === b.id) finish(input.value); }, 120);
    });

    wrap.appendChild(input);
    if (boards.length > 1) wrap.appendChild(makeDelX(b));
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return wrap;
  }

  function addBoard() {
    var maxOrder = boards.reduce(function (m, b) { return Math.max(m, b.order || 0); }, -1);
    Store.addBoard({ name: newBoardName(), order: maxOrder + 1 }).then(function (b) {
      boards.push(b);
      loadBoard(b.id).then(function () { startRename(b.id); });
    });
  }

  // ---- render loop -----------------------------------------------------------

  function renderLoop() {
    bubbles.forEach(function (b) {
      if (!b.body) return;
      b.el.style.transform =
        'translate(' + (b.body.x - b.body.r) + 'px,' + (b.body.y - b.body.r) + 'px)';
      // the drawn ring rolls; the text stays upright (it isn't rotated)
      if (b.ill) b.ill.style.transform = 'rotate(' + b.body.angle + 'rad)';
    });
    requestAnimationFrame(renderLoop);
  }

  // ---- sizing --------------------------------------------------------------------

  function radiusFor(task) {
    var base = task.image ? 50 : 30;
    var grow = Math.min((task.text || '').length * 1.35, 54);
    return Math.round(base + grow);
  }
  var MIN_R = 40;
  var SVGNS = 'http://www.w3.org/2000/svg';

  // Build the ring as a bare <svg><path/> with a tight viewBox and
  // preserveAspectRatio="none", so the drawing fills the body box exactly —
  // no overflow, so two touching bubbles' rings touch and never interlace.
  function makeIll(variant) {
    var art = (window.BUBBLE_ART && window.BUBBLE_ART[variant]) || window.BUBBLE_ART['1'];
    var ill = document.createElementNS(SVGNS, 'svg');
    ill.setAttribute('class', 'bubble__ill');
    ill.setAttribute('viewBox', art.vb);
    ill.setAttribute('preserveAspectRatio', 'none');
    var p = document.createElementNS(SVGNS, 'path');
    // stroke the outline (non-scaling) so the line stays the same weight no
    // matter how big the bubble grows with its text
    p.setAttribute('d', art.ring || art.d);
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    ill.appendChild(p);
    return ill;
  }

  // size the bubble box; the text stays a fixed size (set in CSS)
  function sizeEl(el, r) {
    el.style.width = el.style.height = r * 2 + 'px';
  }

  // ---- committed bubbles ------------------------------------------------------

  function spawnBubble(task, opts) {
    opts = opts || {};
    var r = typeof task.r === 'number' ? task.r : radiusFor(task);
    var variant = task.variant || 1;

    var el = document.createElement('div');
    el.className = 'bubble bubble--v' + variant;
    el.style.animationDelay = (-(Math.random() * 0.5)).toFixed(2) + 's';  // desync the Pop-mode jitter
    sizeEl(el, r);

    var ill = makeIll(variant);
    el.appendChild(ill);

    var url = null;
    var entryIll = ill;
    if (task.image) {
      var img = document.createElement('img');
      img.className = 'bubble__img';
      // images are stored as data-URL strings (Blob-in-IndexedDB is broken on
      // iOS Safari); tolerate an old Blob record too
      if (typeof task.image === 'string') {
        img.src = task.image;
      } else {
        url = URL.createObjectURL(task.image);
        img.src = url;
      }
      img.alt = task.text || '';
      el.appendChild(img);
    }
    if (task.text) {
      var span = document.createElement('span');
      span.className = 'bubble__text';
      span.textContent = task.text;
      el.appendChild(span);
    }

    var body = {
      x: typeof task.x === 'number' ? task.x : boxW / 2,
      y: typeof task.y === 'number' ? task.y : (opts.drop ? 40 : r + 20),
      r: r,
      held: false
    };

    var entry = { task: task, el: el, body: body, url: url, ill: entryIll };
    bubbles.set(task.id, entry);
    bubblesEl.appendChild(el);
    sim.add(body);
    if (opts.drop) body.vy = 1;
    attachPointer(entry);
    return entry;
  }

  // ---- drag (Add) / pop (Pop) --------------------------------------------------

  function attachPointer(entry) {
    var el = entry.el, body = entry.body;
    var lastX = 0, lastY = 0, downX = 0, downY = 0;
    var holdTimer = 0, lastTap = 0, moved = false;

    function clearHold() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
      el.classList.remove('bubble--charging');
    }

    el.addEventListener('pointerdown', function (e) {
      // hair-switch mechanic: Pop mode taps pop straight away
      if (popMechanic === 'hairswitch' && mode === 'pop') { pop(entry); return; }

      // double-tap mechanic
      if (popMechanic === 'doubletap') {
        var now = e.timeStamp || Date.now();
        if (now - lastTap < 320) { lastTap = 0; pop(entry); return; }
        lastTap = now;
      }

      if (!body) return;
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('bubble--held');
      body.held = true;
      moved = false;
      lastX = downX = e.clientX; lastY = downY = e.clientY;
      sim.wake();

      // hold-to-pop mechanic: 3s still press -> pop
      if (popMechanic === 'hold') {
        el.classList.add('bubble--charging');
        holdTimer = setTimeout(function () {
          holdTimer = 0;
          body.held = false;
          el.classList.remove('bubble--held', 'bubble--charging');
          pop(entry);
        }, HOLD_MS);
      }
    });
    el.addEventListener('pointermove', function (e) {
      if (!body || !body.held) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 8) {
        moved = true;
        clearHold();                 // a drag cancels a pending hold-pop
      }
      var rect = bubblesEl.getBoundingClientRect();
      body.x = e.clientX - rect.left;
      body.y = e.clientY - rect.top;
      body.vx = (e.clientX - lastX) * 0.5;
      body.vy = (e.clientY - lastY) * 0.5;
      lastX = e.clientX; lastY = e.clientY;
    });
    function endPress(e) {
      clearHold();
      if (!body || !body.held) return;
      body.held = false;
      el.classList.remove('bubble--held');
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      sim.wake();
      savePositionsSoon();
    }
    el.addEventListener('pointerup', endPress);
    el.addEventListener('pointercancel', endPress);
  }

  var GROW_MS = 260;   // burst grows from a dot to the bubble's full diameter

  function pop(entry) {
    if (entry.el.classList.contains('bubble--popping')) return;
    entry.el.classList.add('bubble--popping');

    var body = entry.body;
    var r = body ? body.r : 46;
    var cx = body ? body.x : 0;
    var cy = body ? body.y : 0;
    if (body) { sim.remove(body); sim.wake(); }   // pile above drops into the gap

    // remember it so the Undo control can bring it back (not for tour practice)
    var t = entry.task;
    if (!t.practice) {
      undoStack.push({
        text: t.text, image: t.image, r: r, x: cx, y: cy,
        variant: t.variant, seq: t.seq, kind: t.kind, slot: t.slot, evKey: t.evKey
      });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      refreshUndo();
    }

    // a popped calendar reminder should stay gone for the rest of the day
    if (t.evKey) evDone.add(t.evKey);

    // the burst: starts as a dot at the bubble centre, grows to its rim
    var art = window.POP_BURST || { vb: '0 0 100 100', paths: '' };
    var burst = document.createElementNS(SVGNS, 'svg');
    burst.setAttribute('class', 'pop-burst');
    burst.setAttribute('viewBox', art.vb);
    burst.setAttribute('preserveAspectRatio', 'none');   /* fill the bubble box */
    burst.innerHTML = art.paths;
    burst.style.width = burst.style.height = (r * 2) + 'px';
    burst.style.left = (cx - r) + 'px';
    burst.style.top = (cy - r) + 'px';
    bubblesEl.appendChild(burst);
    requestAnimationFrame(function () { burst.classList.add('pop-burst--go'); });

    // when it reaches the rim, the bubble + its text just vanish
    setTimeout(function () {
      entry.el.remove();
      if (entry.url) URL.revokeObjectURL(entry.url);
      bubbles['delete'](entry.task.id);
      if (!t.practice) Store.deleteTask(entry.task.id);
      burst.classList.add('pop-burst--done');
    }, GROW_MS);

    setTimeout(function () { burst.remove(); }, GROW_MS + 240);
  }

  // ---- writing a new bubble -------------------------------------------------

  bubblesEl.addEventListener('pointerdown', function (e) {
    if (mode !== 'add') return;
    if (e.target.closest('.bubble')) return;
    // stop the browser's own focus/selection handling for this press, which
    // was yanking focus off the freshly-made editor (hence the double click)
    e.preventDefault();
    var rect = bubblesEl.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    if (draft) {
      // an empty draft just follows your click; a written one commits
      if (draft.editor.textContent.trim() || draft.image) commitDraft();
      else { draft.cx = cx; draft.cy = cy; positionDraft(); focusEditor(draft.editor); }
      return;
    }
    startDraft(cx, cy);
  });

  function focusEditor(ed) {
    ed.focus();
    // belt-and-braces: re-assert focus after the native pointer sequence
    requestAnimationFrame(function () {
      if (draft && draft.editor === ed && document.activeElement !== ed) ed.focus();
    });
  }

  function startDraft(cx, cy) {
    var r = 74;
    var v = ((addCount) % 3) + 1;
    var el = document.createElement('div');
    el.className = 'bubble bubble--editing bubble--v' + v;
    sizeEl(el, r);

    el.appendChild(makeIll(v));

    var editor = document.createElement('div');
    editor.className = 'bubble__editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'New task');

    var dots = document.createElement('span');
    dots.className = 'bubble__typing';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';

    var photo = document.createElement('button');
    photo.type = 'button';
    photo.className = 'bubble__photo';
    photo.setAttribute('aria-label', 'Add a photo');
    photo.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3.2 7.5h3.6L8.4 5h7.2l1.6 2.5h3.6v11H3.2z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
      '</svg>';

    // a visible confirm button — the reliable way to commit on mobile, where
    // there's no Enter key (and none appears after the photo picker)
    var done = document.createElement('button');
    done.type = 'button';
    done.className = 'bubble__done';
    done.setAttribute('aria-label', uiLang === 'tr' ? 'Ekle' : 'Add');
    done.hidden = true;
    done.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M5 13l4.5 4.5L20 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';

    el.appendChild(editor);
    el.appendChild(dots);
    el.appendChild(photo);
    el.appendChild(done);
    bubblesEl.appendChild(el);

    draft = { el: el, editor: editor, dots: dots, photo: photo, done: done, cx: cx, cy: cy, r: r, image: null };
    positionDraft();
    focusEditor(editor);

    editor.addEventListener('input', onDraftInput);
    // dismissing the keyboard (blur) commits the bubble if it has content;
    // an empty one is left where it is
    editor.addEventListener('blur', function () {
      setTimeout(function () {
        if (!draft || draft.editor !== editor) return;   // already committed / discarded
        if (document.activeElement === editor) return;     // refocused (tapped the bubble)
        if (pickingPhoto) return;                          // camera flow in progress
        if (draft.editor.textContent.trim() || draft.image) commitDraft();
      }, 150);
    });
    // clicking anywhere on the draft bubble (not a button) focuses the editor
    el.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.bubble__photo, .bubble__done')) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditor(editor);
    });
    // no blur handling: the draft bubble stays put until you confirm or Escape.
    photo.addEventListener('pointerdown', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    photo.addEventListener('click', function (ev) {
      ev.stopPropagation();
      pickingPhoto = true;   // suppress the blur-commit while the picker is open
      photoInput.click();
    });
    done.addEventListener('pointerdown', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    done.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (draft && (draft.editor.textContent.trim() || draft.image)) commitDraft();
    });
  }

  function positionDraft() {
    if (!draft) return;
    sizeEl(draft.el, draft.r);
    draft.el.style.left = (draft.cx - draft.r) + 'px';
    draft.el.style.top = (draft.cy - draft.r) + 'px';
  }

  function onDraftInput() {
    if (!draft) return;
    var text = draft.editor.textContent.trim();
    draft.dots.style.display = text ? 'none' : '';
    draft.done.hidden = !(text || draft.image);   // confirm button appears once there's content
    draft.r = Math.max(radiusFor({ text: text, image: draft.image }), MIN_R);
    positionDraft();
  }

  // Enter / Escape while a draft is open — listened on the document, so it
  // still works after the file picker steals focus from the editor
  function onDraftKey(e) {
    if (!draft) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.editor.textContent.trim() || draft.image) commitDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardDraft();
    }
  }
  document.addEventListener('keydown', onDraftKey);

  // Turn a picked file into a small JPEG data-URL string. Data URLs (strings)
  // round-trip through IndexedDB reliably; Blobs do NOT on iOS Safari, which is
  // why the photo vanished on mobile. Downscaling also handles HEIC and keeps
  // storage tiny.
  function fileToDataUrl(file, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null); };
    reader.onload = function () {
      var raw = reader.result;                 // data:...;base64,...
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1000;
          var s = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * s));
          var h = Math.max(1, Math.round(img.height * s));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { cb(raw); }               // canvas failed -> keep the original
      };
      img.onerror = function () { cb(raw); };  // browser can't decode it -> store raw
      img.src = raw;
    };
    reader.readAsDataURL(file);
  }

  photoInput.addEventListener('change', function () {
    pickingPhoto = false;
    var file = photoInput.files && photoInput.files[0];
    if (!file || !draft) { photoInput.value = ''; return; }
    var d = draft;

    fileToDataUrl(file, function (dataUrl) {
      photoInput.value = '';
      if (!draft || draft !== d || !dataUrl) return;
      d.image = dataUrl;                       // a string
      var bg = d.el.querySelector('.bubble__img');
      if (!bg) {
        bg = document.createElement('img');
        bg.className = 'bubble__img';
        d.el.appendChild(bg);
      }
      bg.src = dataUrl;
      d.dots.style.display = 'none';
      d.done.hidden = false;
      d.editor.focus();
      setTimeout(function () { if (draft) draft.editor.focus(); }, 120);
      onDraftInput();
    });
  });

  // returning from a cancelled photo picker: clear the guard
  window.addEventListener('focus', function () {
    setTimeout(function () { pickingPhoto = false; }, 350);
  });

  function commitDraft() {
    if (!draft) return;
    var d = draft;
    draft = null;
    var text = d.editor.textContent.trim();
    if (!text && !d.image) { d.el.remove(); return; }

    var cx = d.cx, cy = d.cy, r = Math.max(radiusFor({ text: text, image: d.image }), MIN_R);
    d.el.remove();

    addCount += 1;
    var variant = ((addCount - 1) % 3) + 1;

    Store.addTask({ text: text, image: d.image, boardId: activeBoardId, x: cx, y: cy, r: r, variant: variant, seq: addCount })
      .then(function (task) {
        var entry = spawnBubble(task, { drop: false });
        entry.body.vy = 1.5;
        sim.wake();
      });
  }

  function discardDraft() {
    if (!draft) return;
    draft.el.remove();
    draft = null;
  }

  // ---- the hair switch -------------------------------------------------------

  hairHit.addEventListener('click', function () {
    if (popMechanic !== 'hairswitch') return;   // no Add/Pop mode with other mechanics
    setMode(mode === 'add' ? 'pop' : 'add');
  });

  // settings button -> opens the profile / calendar panel
  if (profileBtn) {
    profileBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent('pop:profile'));
    });
  }

  // ---- undo the pops ------------------------------------------------------------

  function refreshUndo() {
    appEl.classList.toggle('has-undo', undoStack.length > 0);
  }

  if (undoBtn) {
    undoBtn.addEventListener('click', function () {
      var snap = undoStack.pop();
      refreshUndo();
      if (!snap) return;
      if (snap.evKey) evDone.remove(snap.evKey);
      Store.addTask({
        text: snap.text, image: snap.image, boardId: activeBoardId,
        x: snap.x, y: snap.y, r: snap.r,
        variant: snap.variant, seq: snap.seq, kind: snap.kind, slot: snap.slot,
        evKey: snap.evKey
      }).then(function (task) {
        var entry = spawnBubble(task, { drop: false });
        if (entry.body) entry.body.vy = 1;
        sim.wake();
      });
    });
  }

  function setMode(next) {
    if (draft) commitDraft();
    mode = next;
    var isPop = mode === 'pop';
    appEl.classList.toggle('mode-pop', isPop);
    appEl.classList.toggle('mode-add', !isPop);
    hairHit.setAttribute('aria-checked', String(isPop));
  }

  // ---- pop mechanic ---------------------------------------------------------

  function applyMechanic() {
    var hs = popMechanic === 'hairswitch';
    appEl.classList.toggle('mech-hairswitch', hs);
    appEl.classList.toggle('mech-gesture', !hs);
    if (!hs && mode === 'pop') setMode('add');   // no Pop mode without the switch
  }
  function setPopMechanic(m) {
    if (['hairswitch', 'hold', 'doubletap'].indexOf(m) < 0) return;
    popMechanic = m;
    try { localStorage.setItem(POP_MECH_KEY, m); } catch (e) {}
    applyMechanic();
  }
  window.addEventListener('patlat:set-mechanic', function (e) {
    if (e && e.detail) setPopMechanic(e.detail);
  });

  // ---- guided tour / first-run onboarding ---------------------------------

  var tourEl = document.getElementById('tour');
  var tourCard = document.getElementById('tourCard');
  var tourRing = document.getElementById('tourRing');

  var TXT = {
    en: {
      intro:  { h: 'this is patlat', p: 'A place to dump the small stuff you keep forgetting. Each task is a bubble that piles up. Pop the ones you’ve done.' },
      add:    { h: 'add a task', p: 'Tap the empty space and type something, then finish the bubble.', hint: 'Try it now — tap an empty spot.', target: '#bubbles', cardTop: true },
      popIntro: { h: 'popping', p: 'There are a few ways to pop a done task. Let’s try each one on a practice bubble.' },
      try_hairswitch: { h: 'way 1 · the hair switch', p: 'Flip the switch in the hair to enter Pop mode, then tap the bubble.', hint: 'Flip the switch, then tap the bubble.', target: '.hair-hit' },
      try_hold:      { h: 'way 2 · hold 3 seconds', p: 'Press and hold the bubble. After 3 seconds it pops.', hint: 'Press and hold the bubble.', bubbleTarget: true, cardTop: true },
      try_doubletap: { h: 'way 3 · double-tap', p: 'Tap the bubble twice, quickly.', hint: 'Double-tap the bubble.', bubbleTarget: true, cardTop: true },
      boards: { h: 'many heads', p: 'Open as many boards as you want and switch between them — each keeps its own pile. + adds one, tap a board to rename, × to delete.', target: '#boards' },
      settings: { h: 'reminders & calendar', p: 'The gear, top right, is where you add one-off or repeating reminders. They pop up as bubbles on their day.', target: '#profileBtn' },
      pick:   { h: 'which one do you want to keep?', p: 'Pick your popping style. You can change it any time in settings.' },
      nice: 'nice 🎉', next: 'Next', back: 'Back', done: 'Done', skip: 'Skip', practice: 'pop me'
    },
    tr: {
      intro:  { h: 'bu patlat', p: 'Sürekli unuttuğun küçük işleri atıp rahatladığın yer. Her görev bir baloncuk, yığılırlar. Bitirdiklerini patlat.' },
      add:    { h: 'görev ekle', p: 'Boş yere dokun, bir şeyler yaz ve baloncuğu tamamla.', hint: 'Şimdi dene — boş bir yere dokun.', target: '#bubbles', cardTop: true },
      popIntro: { h: 'patlatma', p: 'Biten bir görevi patlatmanın birkaç yolu var. Her birini bir deneme baloncuğunda yapalım.' },
      try_hairswitch: { h: '1. yol · saç düğmesi', p: 'Saçtaki düğmeyle Patlat moduna geç, sonra baloncuğa dokun.', hint: 'Düğmeyi çevir, sonra baloncuğa dokun.', target: '.hair-hit' },
      try_hold:      { h: '2. yol · 3 saniye tut', p: 'Baloncuğa basılı tut. 3 saniye sonra patlar.', hint: 'Baloncuğa basılı tut.', bubbleTarget: true, cardTop: true },
      try_doubletap: { h: '3. yol · çift dokun', p: 'Baloncuğa hızlıca iki kez dokun.', hint: 'Baloncuğa çift dokun.', bubbleTarget: true, cardTop: true },
      boards: { h: 'birden fazla kafa', p: 'İstediğin kadar kafa aç ve aralarında geç — her biri kendi yığınını tutar. + ekler, kafaya dokun→ad değiştir, × siler.', target: '#boards' },
      settings: { h: 'hatırlatıcı & takvim', p: 'Sağ üstteki dişli, tek seferlik veya tekrar eden hatırlatıcı eklediğin yer. O gün baloncuk olarak çıkarlar.', target: '#profileBtn' },
      pick:   { h: 'hangisini kullanmak istersin?', p: 'Patlatma şeklini seç. İstediğin zaman ayarlardan değiştirebilirsin.' },
      nice: 'harika 🎉', next: 'İleri', back: 'Geri', done: 'Bitti', skip: 'Geç', practice: 'beni patlat'
    }
  };
  var MECH_LABELS = {
    en: {
      hairswitch: ['Add / Pop switch', 'Flip the hair switch, then tap done tasks'],
      hold:       ['Hold 3 seconds', 'Press and hold a bubble to pop it'],
      doubletap:  ['Double-tap', 'Double-tap a bubble to pop it'],
      cactus:     ['Drag onto the cactus', 'coming soon'],
      bin:        ['Drag into the bin', 'coming soon']
    },
    tr: {
      hairswitch: ['Ekle / Patlat düğmesi', 'Saç düğmesini çevir, biten görevlere dokun'],
      hold:       ['3 saniye basılı tut', 'Baloncuğa basılı tut, patlasın'],
      doubletap:  ['Çift dokun', 'Baloncuğa çift dokun, patlasın'],
      cactus:     ['Kaktüse sürükle', 'yakında'],
      bin:        ['Çöp kovasına sürükle', 'yakında']
    }
  };

  var tour = null;              // { kind, keys, i, poll, addBaseline, practiceId }
  var practiceIds = [];
  var practiceN = 0;

  function TT() { return TXT[uiLang] || TXT.en; }

  function spawnPractice() {
    practiceN += 1;
    var id = 'pr-' + practiceN;
    var task = { id: id, practice: true, text: TT().practice,
      variant: ((practiceN - 1) % 3) + 1, r: 58, x: boxW / 2, y: 26 };
    var entry = spawnBubble(task, { drop: true });
    if (entry.body) entry.body.vy = 1.2;
    practiceIds.push(id);
    sim.wake();
    return id;
  }
  function clearPractice() {
    practiceIds.forEach(function (id) {
      var e = bubbles.get(id);
      if (!e) return;
      e.el.remove();
      if (e.body) sim.remove(e.body);
      bubbles['delete'](id);
    });
    practiceIds = [];
    sim.wake();
  }

  function stepKeys(kind) {
    return kind === 'onboard'
      ? ['intro', 'add', 'popIntro', 'try_hairswitch', 'try_hold', 'try_doubletap', 'pick']
      : ['intro', 'add', ('try_' + popMechanic), 'boards', 'settings'];
  }

  function startTour(kind) {
    if (!tourEl) return;
    stopPoll();
    clearPractice();
    tour = { kind: kind, keys: stepKeys(kind), i: 0 };
    tourEl.hidden = false;
    enterStep();
  }
  function endTour(finished) {
    stopPoll();
    clearPractice();
    var wasOnboard = tour && tour.kind === 'onboard';
    tour = null;
    if (tourEl) { tourEl.hidden = true; tourEl.classList.remove('is-interactive', 'has-ring'); }
    if (tourRing) tourRing.hidden = true;
    if (finished && wasOnboard) {
      try { localStorage.setItem('patlat.onboarded', '1'); } catch (e) {}
      var s = false;
      try { s = !!localStorage.getItem('pop.seeded'); } catch (e) {}
      if (!s && activeBoardId) {
        seedTasks().then(function () { return Store.getTasks(activeBoardId); })
          .then(function (tasks) { tasks.forEach(function (t) { spawnBubble(t, { drop: false }); }); sim.wake(); });
      }
    }
  }

  function stopPoll() { if (tour && tour.poll) { clearInterval(tour.poll); tour.poll = 0; } }

  function goStep(i) {
    if (!tour) return;
    stopPoll();
    clearPractice();
    tour.i = Math.max(0, Math.min(tour.keys.length - 1, i));
    enterStep();
  }

  function ringTo(elOrSel) {
    var el = typeof elOrSel === 'string' ? document.querySelector(elOrSel) : elOrSel;
    if (!el || !tourRing) { if (tourRing) tourRing.hidden = true; tourEl.classList.remove('has-ring'); return; }
    var r = el.getBoundingClientRect(), pad = 8;
    tourRing.style.left = (r.left - pad) + 'px';
    tourRing.style.top = (r.top - pad) + 'px';
    tourRing.style.width = (r.width + pad * 2) + 'px';
    tourRing.style.height = (r.height + pad * 2) + 'px';
    tourRing.hidden = false;
    tourEl.classList.add('has-ring');
  }

  function enterStep() {
    if (!tour) return;
    var T = TT();
    var key = tour.keys[tour.i];
    var d = T[key] || {};
    // interactive gated steps only during first-run onboarding
    var interactive = tour.kind === 'onboard' && (key === 'add' || key.indexOf('try_') === 0);

    tour.practiceId = null;
    tourEl.classList.toggle('is-interactive', interactive);

    if (interactive && key === 'add') {
      tour.addBaseline = bubbles.size;
      ringTo('#bubbles');
    } else if (interactive && key === 'try_hairswitch') {
      setPopMechanic('hairswitch');
      tour.practiceId = spawnPractice();
      ringTo('.hair-hit');
    } else if (interactive && key === 'try_hold') {
      setPopMechanic('hold');
      tour.practiceId = spawnPractice();
    } else if (interactive && key === 'try_doubletap') {
      setPopMechanic('doubletap');
      tour.practiceId = spawnPractice();
    } else {
      ringTo(d.target || null);
    }

    renderTourCard();

    if (interactive) {
      tour.poll = setInterval(function () {
        if (!tour) return;
        if (d.bubbleTarget && tour.practiceId) {
          var pe = bubbles.get(tour.practiceId);
          if (pe) ringTo(pe.el);
        }
        var done = key === 'add'
          ? bubbles.size > (tour.addBaseline || 0)
          : (tour.practiceId && !bubbles.has(tour.practiceId));
        if (done) { stopPoll(); flashDoneThenNext(); }
      }, 250);
    }
  }

  function flashDoneThenNext() {
    if (!tour) return;
    var last = tour.i >= tour.keys.length - 1;
    tourCard.innerHTML = '<h3>' + esc(TT().nice) + '</h3>';
    setTimeout(function () {
      if (!tour) return;
      if (last) endTour(true); else goStep(tour.i + 1);
    }, 700);
  }

  function renderTourCard() {
    if (!tour) return;
    var T = TT();
    var key = tour.keys[tour.i];
    var d = T[key] || {};
    var interactive = tour.kind === 'onboard' && (key === 'add' || key.indexOf('try_') === 0);
    var isLast = tour.i === tour.keys.length - 1;

    tourCard.classList.toggle('tour__card--top', !!d.cardTop);

    var dots = '';
    for (var k = 0; k < tour.keys.length; k++) dots += '<i class="' + (k === tour.i ? 'on' : '') + '"></i>';

    var body = '<h3>' + esc(d.h || '') + '</h3><p>' + esc(d.p || '') + '</p>';
    if (interactive && d.hint) body += '<p class="tour__hint">' + esc(d.hint) + '</p>';

    if (key === 'pick') {
      var ML = MECH_LABELS[uiLang] || MECH_LABELS.en;
      body += '<div class="tour__picks">';
      ['hairswitch', 'hold', 'doubletap', 'cactus', 'bin'].forEach(function (m) {
        var on = m === popMechanic ? ' on' : '';
        var dis = (m === 'cactus' || m === 'bin') ? ' disabled' : '';
        body += '<button type="button" class="tour__pick' + on + '" data-mech="' + m + '"' + dis + '>' +
          '<b>' + esc(ML[m][0]) + '</b><span>' + esc(ML[m][1]) + '</span></button>';
      });
      body += '</div>';
    }

    body += '<div class="tour__row"><span class="tour__dots">' + dots + '</span><span class="tour__btns">';
    if (tour.i > 0) body += '<button type="button" class="tour__btn tour__btn--ghost" data-tour="back">' + esc(T.back) + '</button>';
    if (interactive && !isLast) body += '<button type="button" class="tour__btn tour__btn--ghost" data-tour="skipstep">' + esc(T.skip) + '</button>';
    if (!interactive && tour.kind === 'help' && !isLast) body += '<button type="button" class="tour__btn tour__btn--ghost" data-tour="done">' + esc(T.skip) + '</button>';
    if (!interactive) {
      body += '<button type="button" class="tour__btn" data-tour="' + (isLast ? 'done' : 'next') + '">' +
        esc(isLast ? T.done : T.next) + '</button>';
    }
    body += '</span></div>';

    tourCard.innerHTML = body;

    tourCard.querySelectorAll('[data-mech]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        setPopMechanic(b.getAttribute('data-mech'));
        renderTourCard();
      });
    });
    tourCard.querySelectorAll('[data-tour]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-tour');
        if (a === 'back') goStep(tour.i - 1);
        else if (a === 'done') endTour(true);
        else goStep(tour.i + 1);   // next / skipstep
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.addEventListener('resize', function () {
    if (!tour) return;
    var d = TT()[tour.keys[tour.i]] || {};
    if (d.target) ringTo(d.target);
    renderTourCard();
  });
  if (helpBtn) helpBtn.addEventListener('click', function () { startTour('help'); });

  // ---- language: follows the browser, no UI ------------------------------------

  function applyLang(lang) {
    lang = lang === 'tr' ? 'tr' : 'en';
    appEl.classList.toggle('lang-en', lang === 'en');
    appEl.classList.toggle('lang-tr', lang === 'tr');
  }

  // ---- persistence & resize --------------------------------------------------

  function savePositions() {
    bubbles.forEach(function (b) {
      if (!b.body) return;
      Store.updateTask(b.task.id, {
        x: Math.round(b.body.x), y: Math.round(b.body.y), r: b.body.r
      });
    });
  }
  window.addEventListener('beforeunload', savePositions);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { sim.wake(); syncEventBubbles(); }
  });

  // ---- calendar reminders -> bubbles ----------------------------------------

  // keys of reminders popped today, so they don't respawn until tomorrow
  var evDone = (function () {
    var KEY = 'patlat.evdone';
    function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    var st;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || st.d !== today()) st = { d: today(), keys: [] };
    function roll() { if (st.d !== today()) st = { d: today(), keys: [] }; }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
    save();
    return {
      has: function (k) { roll(); return st.keys.indexOf(k) >= 0; },
      add: function (k) { roll(); if (st.keys.indexOf(k) < 0) { st.keys.push(k); save(); } },
      remove: function (k) { roll(); var i = st.keys.indexOf(k); if (i >= 0) { st.keys.splice(i, 1); save(); } }
    };
  })();

  function syncEventBubbles() {
    if (!window.Store || !Store.getEvents || !window.PatlatCal || !activeBoardId) return;
    Promise.all([Store.getEvents(), Store.getTasks()]).then(function (res) {
      var evs = res[0] || [], allTasks = res[1] || [];
      var now = new Date();
      var seen = {};   // evKeys already materialised on ANY board today
      allTasks.forEach(function (t) { if (t.evKey) seen[t.evKey] = true; });
      evs.forEach(function (ev) {
        window.PatlatCal.expandOccurrences(ev, now, now).forEach(function (dayStr) {
          var key = 'ev:' + ev.id + ':' + dayStr;
          if (seen[key] || evDone.has(key)) return;
          seen[key] = true;
          var label = (ev.time ? ev.time + '  ' : '') + (ev.title || 'reminder');
          addCount += 1;
          Store.addTask({
            text: label, kind: 'event', evKey: key, boardId: activeBoardId,
            x: boxW / 2, y: 44,
            r: Math.max(radiusFor({ text: label }), MIN_R),
            variant: ((addCount - 1) % 3) + 1, seq: addCount
          }).then(function (task) {
            var entry = spawnBubble(task, { drop: true });
            if (entry && entry.body) entry.body.vy = 1.4;
            sim.wake();
          });
        });
      });
    })['catch'](function () {});
  }
  window.addEventListener('pop:events-changed', syncEventBubbles);

  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(layoutArena, 80);
  });

  // ---- utils ------------------------------------------------------------------

  function throttle(fn, ms) {
    var t = 0, pending = false;
    return function () {
      var now = Date.now();
      if (now - t > ms) { t = now; fn(); }
      else if (!pending) {
        pending = true;
        setTimeout(function () { pending = false; t = Date.now(); fn(); }, ms);
      }
    };
  }

  window.__popDebug = {
    showHit: function () { hairHit.classList.toggle('debug'); },
    poly: function () { return poly; },
    drawPoly: function () {
      var c = document.getElementById('polyDbg') || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      c.id = 'polyDbg';
      c.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible');
      c.innerHTML = '<polyline points="' + poly.map(function (p) { return p.join(','); }).join(' ') +
        '" fill="rgba(0,150,255,.08)" stroke="rgba(0,120,255,.7)" stroke-width="2"/>';
      bubblesEl.appendChild(c);
    }
  };
})();
