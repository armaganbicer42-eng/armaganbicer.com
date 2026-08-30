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
  var photoInput = document.getElementById('photoInput');
  var hairHit = document.getElementById('hairHit');
  var profileBtn = document.getElementById('profileBtn');
  var appEl = document.querySelector('.pop-app');

  var bubbles = new Map();     // id -> { task, el, body, url }
  var draft = null;
  var mode = 'add';
  var addCount = 0;            // drives the 1-2-3 bubble illustration cycle
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

  function start() {
    applyLang((navigator.language || 'en').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en');
    layoutArena();
    Store.init()
      .then(Store.getTasks)
      .then(function (tasks) {
        tasks.forEach(function (t) {
          if (typeof t.variant === 'number') addCount = Math.max(addCount, t.seq || 0);
          spawnBubble(t, { drop: false });
        });
        requestAnimationFrame(renderLoop);
      })
      .catch(function (err) { console.error('POP failed to start', err); });
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

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
    var base = task.image ? 56 : 34;
    var grow = Math.min((task.text || '').length * 1.5, 66);
    return Math.round(base + grow);
  }
  var MIN_R = 46;
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
    p.setAttribute('d', art.d);
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
      url = URL.createObjectURL(task.image);
      var img = document.createElement('img');
      img.className = 'bubble__img';
      img.src = url;
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
    var lastX = 0, lastY = 0;

    el.addEventListener('pointerdown', function (e) {
      if (mode === 'pop') { pop(entry); return; }
      if (!body) return;
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('bubble--held');
      body.held = true;
      lastX = e.clientX; lastY = e.clientY;
      sim.wake();
    });
    el.addEventListener('pointermove', function (e) {
      if (!body || !body.held) return;
      var rect = bubblesEl.getBoundingClientRect();
      body.x = e.clientX - rect.left;
      body.y = e.clientY - rect.top;
      body.vx = (e.clientX - lastX) * 0.5;
      body.vy = (e.clientY - lastY) * 0.5;
      lastX = e.clientX; lastY = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (!body || !body.held) return;
      body.held = false;
      el.classList.remove('bubble--held');
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      sim.wake();
      savePositionsSoon();
    });
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
      Store.deleteTask(entry.task.id);
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
    photo.textContent = '+';

    el.appendChild(editor);
    el.appendChild(dots);
    el.appendChild(photo);
    bubblesEl.appendChild(el);

    draft = { el: el, editor: editor, dots: dots, photo: photo, cx: cx, cy: cy, r: r, image: null };
    positionDraft();
    focusEditor(editor);

    editor.addEventListener('input', onDraftInput);
    editor.addEventListener('keydown', onDraftKey);
    // clicking anywhere on the draft bubble (not just the tiny editor box)
    // focuses the editor
    el.addEventListener('pointerdown', function (ev) {
      if (ev.target === photo) return;
      ev.preventDefault();
      ev.stopPropagation();
      focusEditor(editor);
    });
    // no blur handling: the draft bubble stays put until you press Enter
    // (with text) or Escape. losing focus never discards it.
    photo.addEventListener('pointerdown', function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    photo.addEventListener('click', function (ev) { ev.stopPropagation(); photoInput.click(); });
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
    draft.r = Math.max(radiusFor({ text: text, image: draft.image }), MIN_R);
    positionDraft();
  }

  function onDraftKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // only commits once there's something written
      if (draft && (draft.editor.textContent.trim() || draft.image)) commitDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardDraft();
    }
  }

  photoInput.addEventListener('change', function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file || !draft) return;
    draft.image = file;
    var url = URL.createObjectURL(file);
    var bg = draft.el.querySelector('.bubble__img');
    if (!bg) {
      bg = document.createElement('img');
      bg.className = 'bubble__img';
      draft.el.appendChild(bg);
    }
    bg.src = url;
    draft.dots.style.display = 'none';
    draft.editor.focus();
    onDraftInput();
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

    Store.addTask({ text: text, image: d.image, x: cx, y: cy, r: r, variant: variant, seq: addCount })
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
    setMode(mode === 'add' ? 'pop' : 'add');
  });

  // profile / login — placeholder until the login page exists
  if (profileBtn) {
    profileBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent('pop:profile'));
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
    if (!document.hidden) sim.wake();
  });

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
