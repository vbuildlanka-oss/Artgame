// Drawing surface + rendering. All strokes live in a 1000x1000 grid so they
// look identical on any screen size, and pack small into links.

export const GRID = 1000;
export const PAPER = '#fffdf6';
export const COLORS = ['#26221f', '#e63946', '#ff8c42', '#ffcf3f', '#2a9d8f', '#3a86ff', '#8e5cf6', '#ff70a6', '#8d5b3b', PAPER];
export const ERASER = COLORS.length - 1;
// Brush widths in grid units. Sized for fingertips: the thinnest line is ~2.5px
// on a phone, the thickest ~13px.
export const SIZES = [7, 16, 36];
const ERASER_MULT = 2.2;
const MAX_POINTS = 14000;

// Finger tuning: fingertips jitter by 1–2px while "still", so we ignore moves
// below MIN_DIST and run a light moving average. Pens/mice get a tighter feel.
const FEEL = {
  touch: { minDist: 2.2, smooth: 0.5 },
  pen: { minDist: 1, smooth: 0.75 },
  mouse: { minDist: 1, smooth: 0.8 },
};

export function prepCtx(canvas, cssSize) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.max(1, Math.round(cssSize * dpr));
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  canvas.style.width = canvas.style.height = cssSize + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(px / GRID, 0, 0, px / GRID, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

export function clearPaper(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function drawStroke(ctx, s, n = s.p.length / 2) {
  const p = s.p;
  if (n <= 0) return;
  const w = SIZES[s.s] * (s.c === ERASER ? ERASER_MULT : 1);
  ctx.strokeStyle = ctx.fillStyle = COLORS[s.c];
  ctx.lineWidth = w;
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 2) {
    ctx.lineTo(p[2], p[3]);
  } else {
    // Curve through midpoints: smooths out the polyline corners.
    for (let i = 1; i < n - 1; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      ctx.quadraticCurveTo(x, y, (x + p[i * 2 + 2]) / 2, (y + p[i * 2 + 3]) / 2);
    }
    ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  }
  ctx.stroke();
}

export function renderAll(ctx, strokes) {
  clearPaper(ctx);
  for (const s of strokes) drawStroke(ctx, s);
}

const sizeOf = (canvas) => canvas.parentElement.clientWidth || 280;

export function paintStatic(canvas, strokes) {
  renderAll(prepCtx(canvas, sizeOf(canvas)), strokes);
}

// Re-draws the doodle stroke by stroke, with a pencil riding the tip.
export function replay(canvas, strokes, { onDone } = {}) {
  const PAUSE = 6; // virtual points of "pen lift" between strokes
  const units = strokes.map((s) => s.p.length / 2 + PAUSE);
  const total = units.reduce((a, b) => a + b, 0) || 1;
  const ms = Math.min(8000, Math.max(2500, total * 7));
  const t0 = performance.now();
  let raf = 0;
  let running = true;
  const step = (now) => {
    const ctx = prepCtx(canvas, sizeOf(canvas));
    const t = Math.min(1, (now - t0) / ms);
    let budget = t * total;
    let tip = null;
    clearPaper(ctx);
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      if (budget >= units[i]) { drawStroke(ctx, s); budget -= units[i]; continue; }
      const k = Math.min(s.p.length / 2, Math.floor(budget));
      if (k > 0) {
        drawStroke(ctx, s, k);
        tip = [s.p[(k - 1) * 2], s.p[(k - 1) * 2 + 1]];
      }
      break;
    }
    if (tip && t < 1) {
      ctx.save();
      ctx.font = '64px serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText('✏️', tip[0] - 4, tip[1] + 8);
      ctx.restore();
    }
    if (t < 1) raf = requestAnimationFrame(step);
    else { running = false; onDone && onDone(); }
  };
  raf = requestAnimationFrame(step);
  return {
    cancel() { cancelAnimationFrame(raf); running = false; },
    get running() { return running; },
  };
}

export class DrawingPad {
  constructor({ area, pad, base, live, onChange, onLimit }) {
    Object.assign(this, { area, pad, base, live, onChange, onLimit });
    this.strokes = [];
    this.cleared = null;
    this.color = 0;
    this.size = 1;
    this.eraser = false;
    this.active = null;
    this.pointers = new Map();
    this.gesture = null;
    this.points = 0;
    this.raf = 0;

    const nonPassive = { passive: false };
    live.addEventListener('pointerdown', (e) => this.down(e), nonPassive);
    live.addEventListener('pointermove', (e) => this.move(e), nonPassive);
    live.addEventListener('pointerup', (e) => this.up(e), nonPassive);
    live.addEventListener('pointercancel', (e) => this.up(e), nonPassive);
    live.addEventListener('contextmenu', (e) => e.preventDefault());
    // Stop iOS from scrolling / rubber-banding / magnifying while drawing.
    pad.addEventListener('touchstart', (e) => e.preventDefault(), nonPassive);
    pad.addEventListener('touchmove', (e) => e.preventDefault(), nonPassive);
    new ResizeObserver(() => this.layout()).observe(area);
  }

  layout() {
    const side = Math.floor(Math.min(this.area.clientWidth, this.area.clientHeight));
    if (side < 60) return;
    this.pad.style.width = this.pad.style.height = side + 'px';
    const inner = this.pad.clientWidth;
    this.bctx = prepCtx(this.base, inner);
    this.lctx = prepCtx(this.live, inner);
    renderAll(this.bctx, this.strokes);
    this.drawLive();
  }

  reset() {
    this.strokes = [];
    this.cleared = null;
    this.active = null;
    this.points = 0;
    this.pointers.clear();
    this.gesture = null;
    if (this.bctx) renderAll(this.bctx, this.strokes);
    this.clearLive();
    this.onChange && this.onChange();
  }

  // ----- pointer handling -----
  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { this.live.setPointerCapture(e.pointerId); } catch {}
    this.pointers.set(e.pointerId, { x0: e.clientX, y0: e.clientY });

    if (this.pointers.size === 1 && !this.gesture) {
      this.beginStroke(e);
    } else if (this.pointers.size === 2) {
      // A second finger: either a two-finger-tap undo, or a resting palm.
      const a = this.active;
      const young = a && (performance.now() - a.t0 < 250 || a.travel < 14);
      if (a && young) this.cancelStroke();
      else if (a) this.endStroke();
      this.gesture = { t0: performance.now(), moved: 0, undo: !a || young };
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (this.gesture) {
      this.gesture.moved = Math.max(this.gesture.moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
      return;
    }
    if (this.active && this.active.id === e.pointerId) {
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ce of list.length ? list : [e]) this.addPoint(ce.clientX, ce.clientY, false);
      this.scheduleLive();
    }
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.gesture) {
      if (this.pointers.size === 0) {
        const g = this.gesture;
        this.gesture = null;
        if (g.undo && e.type === 'pointerup' && performance.now() - g.t0 < 450 && g.moved < 24) this.undo();
      }
      return;
    }
    if (this.active && this.active.id === e.pointerId) {
      if (e.type === 'pointercancel' && this.active.travel < 6) this.cancelStroke();
      else { this.addPoint(e.clientX, e.clientY, true); this.endStroke(); }
    }
  }

  // ----- stroke building -----
  beginStroke(e) {
    if (this.points >= MAX_POINTS) { this.onLimit && this.onLimit(); return; }
    const feel = FEEL[e.pointerType] || FEEL.touch;
    this.rect = this.live.getBoundingClientRect();
    this.active = {
      id: e.pointerId,
      stroke: { c: this.eraser ? ERASER : this.color, s: this.size, p: [] },
      t0: performance.now(),
      travel: 0,
      rx: e.clientX, ry: e.clientY, // last raw accepted position
      sx: e.clientX, sy: e.clientY, // smoothed position
      ...feel,
    };
    this.pushPoint(e.clientX, e.clientY);
    this.scheduleLive();
  }

  pushPoint(cx, cy) {
    const r = this.rect;
    const p = this.active.stroke.p;
    const x = Math.max(0, Math.min(GRID, Math.round(((cx - r.left) / r.width) * GRID)));
    const y = Math.max(0, Math.min(GRID, Math.round(((cy - r.top) / r.height) * GRID)));
    const n = p.length;
    if (n && p[n - 2] === x && p[n - 1] === y) return;
    p.push(x, y);
    this.points++;
  }

  addPoint(cx, cy, final) {
    const a = this.active;
    if (!a) return;
    const d = Math.hypot(cx - a.rx, cy - a.ry);
    if (!final && d < a.minDist) return;
    a.travel += d;
    a.rx = cx; a.ry = cy;
    if (final) { a.sx = cx; a.sy = cy; } else {
      a.sx += (cx - a.sx) * a.smooth;
      a.sy += (cy - a.sy) * a.smooth;
    }
    this.pushPoint(a.sx, a.sy);
    if (this.points >= MAX_POINTS) { this.endStroke(); this.onLimit && this.onLimit(); }
  }

  endStroke() {
    const a = this.active;
    this.active = null;
    if (!a || !a.stroke.p.length) { this.clearLive(); return; }
    this.strokes.push(a.stroke);
    this.cleared = null;
    drawStroke(this.bctx, a.stroke);
    this.clearLive();
    this.onChange && this.onChange();
  }

  cancelStroke() {
    if (this.active) this.points -= this.active.stroke.p.length / 2;
    this.active = null;
    this.clearLive();
  }

  // ----- live layer -----
  scheduleLive() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.drawLive(); });
  }
  clearLive() {
    if (!this.lctx) return;
    this.lctx.save();
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
    this.lctx.restore();
  }
  drawLive() {
    this.clearLive();
    if (this.active && this.lctx) drawStroke(this.lctx, this.active.stroke);
  }

  // ----- actions -----
  undo() {
    this.cancelStroke();
    if (this.strokes.length) {
      const s = this.strokes.pop();
      this.points -= s.p.length / 2;
    } else if (this.cleared) {
      this.strokes = this.cleared;
      this.cleared = null;
      this.points = this.strokes.reduce((a, s) => a + s.p.length / 2, 0);
    } else return;
    renderAll(this.bctx, this.strokes);
    this.onChange && this.onChange();
  }

  clear() {
    if (!this.strokes.length) return;
    this.cleared = this.strokes;
    this.strokes = [];
    this.points = 0;
    renderAll(this.bctx, this.strokes);
    this.onChange && this.onChange();
  }

  get canUndo() { return this.strokes.length > 0 || !!this.cleared; }
}
