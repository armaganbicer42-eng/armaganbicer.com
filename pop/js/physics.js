/*
 * physics.js — tiny circle-gravity sim whose walls are a polygon.
 *
 * getBounds() returns { poly: [[x,y], ...] } — a closed polygon (in the
 * bubbles-layer's pixel space) traced just inside Armagan's drawn frame.
 * Bubbles fall under gravity, push each other apart, and are kept inside
 * that polygon so they pile against the actual hand-drawn line, the hair
 * dip and the head bump included.
 *
 * Bodies: { x, y, r, vx, vy, held }
 */
window.Physics = (function () {
  var GRAVITY = 0.45;
  var WALL_BOUNCE = 0;     // walls don't bounce — a settling pile shouldn't gain energy
  var FRICTION = 0.985;
  var REST_SPEED = 0.22;   // per-body: below this, snap to a stop
  var ROLL_MIN = 0.4;      // below this horizontal speed, don't accumulate spin
  var CALM_SPEED = 0.7;    // whole-pile "barely moving" threshold
  var CALM_FRAMES = 42;    // that many calm frames in a row -> force everything asleep
  var MAX_AWAKE_MS = 4000; // fuse: after this, damp hard; after +900ms, force-stop
  var VA_EASE = 0.11;      // how fast the roll speed eases toward its target (taper)
  var VA_REST = 0.004;     // angular speed below this counts as stopped

  function Sim(getBounds) {
    this.bodies = [];
    this.getBounds = getBounds;
    this._raf = null;
    this._onSettle = null;
    this._running = false;
    this._poly = null;
    this._normals = null;   // inward unit normal per edge
    this._calm = 0;
  }

  Sim.prototype.add = function (body) {
    body.vx = body.vx || 0;
    body.vy = body.vy || 0;
    body.angle = body.angle || 0;   // roll angle, radians
    body.va = body.va || 0;          // angular velocity
    this.bodies.push(body);
    this.wake();
    return body;
  };
  Sim.prototype.remove = function (body) {
    var i = this.bodies.indexOf(body);
    if (i !== -1) this.bodies.splice(i, 1);
  };
  Sim.prototype.onSettle = function (fn) { this._onSettle = fn; };

  Sim.prototype.wake = function () {
    this._wokeAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._calm = 0;   // any interaction gives the pile a fresh chance to move
    if (this._running) return;
    this._running = true;
    var self = this;
    var tick = function () {
      if (self.step()) self._raf = requestAnimationFrame(tick);
      else { self._running = false; if (self._onSettle) self._onSettle(); }
    };
    this._raf = requestAnimationFrame(tick);
  };
  Sim.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  // cache polygon + precompute inward normals (winding-aware) + bbox
  Sim.prototype._prep = function (poly) {
    if (poly === this._poly && this._normals) return;
    this._poly = poly;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var k = 0; k < poly.length; k++) {
      if (poly[k][0] < minx) minx = poly[k][0];
      if (poly[k][0] > maxx) maxx = poly[k][0];
      if (poly[k][1] < miny) miny = poly[k][1];
      if (poly[k][1] > maxy) maxy = poly[k][1];
    }
    this._bbox = { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
    var n = poly.length, area = 0, i, j;
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    var ccw = area > 0;
    var normals = [];
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var ex = poly[j][0] - poly[i][0];
      var ey = poly[j][1] - poly[i][1];
      var len = Math.hypot(ex, ey) || 1e-6;
      // left normal for CCW, right normal for CW -> points inward
      var nx = ccw ? -ey / len : ey / len;
      var ny = ccw ? ex / len : -ex / len;
      normals.push([nx, ny]);
    }
    this._normals = normals;
  };

  function pointInPoly(poly, x, y) {
    var inside = false, n = poly.length, i, j;
    for (i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-6) + xi)) inside = !inside;
    }
    return inside;
  }

  // nearest boundary point to (x,y); returns {px,py,dist,edge}
  function nearestOnPoly(poly, x, y) {
    var best = { dist: Infinity, px: x, py: y, edge: 0 };
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var t = ((x - a[0]) * dx + (y - a[1]) * dy) / ((dx * dx + dy * dy) || 1e-6);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var px = a[0] + t * dx, py = a[1] + t * dy;
      var d = Math.hypot(x - px, y - py);
      if (d < best.dist) { best.dist = d; best.px = px; best.py = py; best.edge = i; }
    }
    return best;
  }

  Sim.prototype._confine = function (a, posOnly) {
    var poly = this._poly, normals = this._normals;
    var inside = pointInPoly(poly, a.x, a.y);
    var np = nearestOnPoly(poly, a.x, a.y);
    var gap = inside ? np.dist : -np.dist;   // signed distance to boundary
    if (gap >= a.r) return;

    var n = normals[np.edge];
    // if we're outside, aim the push from the boundary toward the interior
    var nx = n[0], ny = n[1];
    if (!inside) {
      // make sure the normal points from the nearest point back inside
      var tx = a.x - np.px, ty = a.y - np.py;
      if (tx * nx + ty * ny > 0) { nx = -nx; ny = -ny; }
    }
    var push = a.r - gap;
    a.x += nx * push;
    a.y += ny * push;
    if (posOnly) return;
    // remove only the velocity heading into the wall (no bounce)
    var vn = a.vx * nx + a.vy * ny;
    if (vn < 0) { a.vx -= (1 + WALL_BOUNCE) * vn * nx; a.vy -= (1 + WALL_BOUNCE) * vn * ny; }
  };

  // hard backstop: never leave the polygon's bounding box
  Sim.prototype._clampBox = function (a) {
    var bb = this._bbox;
    if (a.x - a.r < bb.minx) { a.x = bb.minx + a.r; if (a.vx < 0) a.vx = -a.vx * WALL_BOUNCE; }
    if (a.x + a.r > bb.maxx) { a.x = bb.maxx - a.r; if (a.vx > 0) a.vx = -a.vx * WALL_BOUNCE; }
    if (a.y - a.r < bb.miny) { a.y = bb.miny + a.r; if (a.vy < 0) a.vy = -a.vy * WALL_BOUNCE; }
    if (a.y + a.r > bb.maxy) { a.y = bb.maxy - a.r; if (a.vy > 0) a.vy = -a.vy * WALL_BOUNCE; }
  };

  Sim.prototype.step = function () {
    var b = this.getBounds();
    if (!b || !b.poly || b.poly.length < 3) return false;
    this._prep(b.poly);

    var list = this.bodies, i, j, a, other, anyMoving = false;

    // while the user is dragging a bubble, keep the fuse from firing — the rest
    // of the pile must stay free to react (fall into the gap it left, etc.)
    var anyHeld = false;
    for (i = 0; i < list.length; i++) if (list[i].held) { anyHeld = true; break; }
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (anyHeld) this._wokeAt = now;

    // fuse: a jammed pile is eased to a stop a few seconds after the last
    // interaction — hard damping first, then a guaranteed halt. rolling only
    // resumes on the next wake().
    var fused = 0;
    if (!anyHeld && this._wokeAt && now - this._wokeAt > MAX_AWAKE_MS) {
      fused = now - this._wokeAt - MAX_AWAKE_MS;
      for (i = 0; i < list.length; i++) {
        if (fused > 900) { list[i].vx = 0; list[i].vy = 0; list[i].va = 0; }
        else { list[i].vx *= 0.80; list[i].vy *= 0.80; list[i].va *= 0.86; }
      }
      if (fused > 900) { this._calm = 0; return false; }
    }

    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.held) {
        // rolls while you drag it — eased so it doesn't snap
        var tgtH = a.vx / (a.r || 1);
        a.va += (tgtH - a.va) * 0.4;
        a.angle += a.va;
        continue;
      }
      a.vy += GRAVITY;
      a.vx *= FRICTION;
      a.vy *= FRICTION;
      // extra drag once a bubble is nearly stopped, so it actually halts
      if (Math.abs(a.vx) + Math.abs(a.vy) < 1.4) { a.vx *= 0.82; a.vy *= 0.82; }
      a.x += a.vx;
      a.y += a.vy;
      // roll: ease the spin toward its target so it winds down gradually
      var rollTarget = (Math.abs(a.vx) > ROLL_MIN) ? a.vx / (a.r || 1) : 0;
      a.va += (rollTarget - a.va) * VA_EASE;
      if (Math.abs(a.va) < VA_REST && rollTarget === 0) a.va = 0;
      a.angle += a.va;
      this._confine(a);
      this._clampBox(a);
    }

    for (i = 0; i < list.length; i++) {
      a = list[i];
      for (j = i + 1; j < list.length; j++) {
        other = list[j];
        var dx = other.x - a.x, dy = other.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        var overlap = a.r + other.r - dist;
        if (overlap > 0) {
          var ux = dx / dist, uy = dy / dist, pushv = overlap / 2;
          if (!a.held) { a.x -= ux * pushv; a.y -= uy * pushv; }
          if (!other.held) { other.x += ux * pushv; other.y += uy * pushv; }
          var rel = (other.vx - a.vx) * ux + (other.vy - a.vy) * uy;
          if (rel < 0) {
            var imp = rel * 0.5;
            if (!a.held) { a.vx += imp * ux; a.vy += imp * uy; }
            if (!other.held) { other.vx -= imp * ux; other.vy -= imp * uy; }
          }
        }
      }
    }

    // relaxation: push every overlapping pair fully apart (position only)
    // so the drawn rings touch instead of interlacing
    var SEP = 1;
    for (var pass = 0; pass < 7; pass++) {
      var moved = false;
      for (i = 0; i < list.length; i++) {
        a = list[i];
        for (j = i + 1; j < list.length; j++) {
          other = list[j];
          var ex = other.x - a.x, ey = other.y - a.y;
          var ed = Math.sqrt(ex * ex + ey * ey) || 0.0001;
          var ov = a.r + other.r + SEP - ed;
          if (ov > 0) {
            var nx = ex / ed, ny = ey / ed, p = ov * 0.5;
            if (!a.held) { a.x -= nx * p; a.y -= ny * p; }
            if (!other.held) { other.x += nx * p; other.y += ny * p; }
            moved = true;
          }
        }
      }
      for (i = 0; i < list.length; i++) if (!list[i].held) { this._confine(list[i], true); this._clampBox(list[i]); }
      if (!moved) break;
    }

    var maxSpeed = 0;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.held) { anyMoving = true; maxSpeed = 1e9; continue; }
      var sp = Math.abs(a.vx) + Math.abs(a.vy);
      if (sp > maxSpeed) maxSpeed = sp;
      if (Math.abs(a.vx) > REST_SPEED || Math.abs(a.vy) > REST_SPEED || Math.abs(a.va) > VA_REST) anyMoving = true;
      else { a.vx = 0; a.vy = 0; }   // motion stopped; the spin keeps easing out
    }

    // whole pile barely moving for a while -> hard stop (kills residual jitter/roll)
    if (maxSpeed < CALM_SPEED) {
      if (++this._calm >= CALM_FRAMES) {
        for (i = 0; i < list.length; i++) if (!list[i].held) {
          list[i].vx = 0; list[i].vy = 0; list[i].va = 0;
        }
        this._calm = 0;
        return false;
      }
    } else {
      this._calm = 0;
    }
    return anyMoving;
  };

  return { create: function (getBounds) { return new Sim(getBounds); } };
})();
