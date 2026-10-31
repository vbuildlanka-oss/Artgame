// Little bits of joy: synthesized sounds, haptics, heart confetti.

let muted = localStorage.getItem('dd_muted') === '1';
let ac = null;

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('dd_muted', m ? '1' : '0'); } catch {}
}

function tone(freq, start, dur, type = 'sine', vol = 0.15) {
  const t = ac.currentTime + start;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfx(name) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { return; }
  switch (name) {
    case 'pop': tone(660, 0, 0.08, 'triangle', 0.12); break;
    case 'open': tone(880, 0, 0.07, 'sine', 0.12); tone(1320, 0.07, 0.14, 'sine', 0.1); break;
    case 'close': tone(587, 0, 0.1, 'triangle', 0.12); tone(698, 0.09, 0.15, 'triangle', 0.12); break;
    case 'wrong': tone(220, 0, 0.16, 'square', 0.05); tone(165, 0.12, 0.25, 'square', 0.05); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.28, 'triangle', 0.14)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(f, i * 0.15, 0.32, 'triangle', 0.12)); break;
  }
}

export function buzz(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

function heart(ctx, s) {
  const h = s / 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.bezierCurveTo(-h * 1.3, -h * 0.2, -h * 0.55, -h * 1.25, 0, -h * 0.4);
  ctx.bezierCurveTo(h * 0.55, -h * 1.25, h * 1.3, -h * 0.2, 0, h * 0.7);
  ctx.fill();
}

export function confetti() {
  const c = document.getElementById('fx');
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = ['#ff5c95', '#ffd23f', '#7bdcb5', '#8ab4ff', '#ff9a76', '#8e5cf6'];
  const parts = Array.from({ length: reduce ? 30 : 150 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.4,
    y: H * 0.4,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 15 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    s: 8 + Math.random() * 9,
    c: colors[(Math.random() * colors.length) | 0],
    heart: Math.random() < 0.4,
  }));
  const t0 = performance.now();
  const frame = (now) => {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.heart) heart(ctx, p.s * 1.4); else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (now - t0 < 3200) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}
