// Procedural, tileable textures drawn at runtime. No image files needed.
import { RNG } from './rng.js';

export function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);

// Periodic value noise so textures tile seamlessly.
function periodicNoise(seed, period) {
  const r = new RNG(seed);
  const v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = r.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    const a = v[y0 * period + x0], b = v[y0 * period + x1], c = v[y1 * period + x0], d = v[y1 * period + x1];
    return mix(mix(a, b, u), mix(c, d, u), w);
  };
}
function tfbm(seed, size, baseCells, oct) {
  const layers = [];
  for (let o = 0; o < oct; o++) layers.push(periodicNoise(seed + o * 101, baseCells << o));
  return (px, py) => {
    let s = 0, amp = 0.5, n = 0;
    for (let o = 0; o < oct; o++) {
      const cells = baseCells << o;
      s += layers[o]((px / size) * cells, (py / size) * cells) * amp;
      n += amp; amp *= 0.5;
    }
    return s / n;
  };
}

function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' && !globalThis.__noOffscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Applies grime, grain and stains to a base drawing. kind tweaks how dirty.
function weather(ctx, S, seed, opts = {}) {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const big = tfbm(seed, S, 3, 5);
  const fine = tfbm(seed + 7, S, 32, 2);
  const r = new RNG(seed + 3);
  const grime = opts.grime ?? 0.35, grain = opts.grain ?? 14, streaks = opts.streaks ?? 0;
  // vertical water streaks (walls)
  const streakCols = new Float32Array(S);
  for (let i = 0; i < streaks; i++) {
    const x = r.int(0, S - 1), w = r.int(2, 10), len = r.range(0.2, 1), str = r.range(0.1, 0.35);
    for (let k = -w; k <= w; k++) streakCols[(x + k + S) % S] = Math.max(streakCols[(x + k + S) % S], str * (1 - Math.abs(k) / (w + 1)) * len);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const b = big(x, y), f = fine(x, y);
    let shade = 1 - grime * Math.max(0, b - 0.5) * 1.5 + (f - 0.5) * 0.14;
    if (streaks) shade -= streakCols[x] * (0.5 + 0.5 * Math.sin(y * 0.02 + x)) * (y / S);
    const g = (Math.random() - 0.5) * grain;
    d[i] = clamp(d[i] * shade + g);
    d[i + 1] = clamp(d[i + 1] * shade + g);
    d[i + 2] = clamp(d[i + 2] * shade * (opts.tint ?? 1) + g);
  }
  ctx.putImageData(img, 0, 0);
}

const DRAW = {
  wallpaper(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    // the classic: faint vertical stripes and a chevron motif
    ctx.globalAlpha = 0.18; ctx.strokeStyle = b; ctx.lineWidth = 3;
    for (let x = 0; x < S; x += S / 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
    const step = S / 8;
    for (let y = -step; y < S + step; y += step) for (let x = 0; x < S; x += S / 16) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + S / 32, y + step / 3); ctx.lineTo(x + S / 16, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return { grime: 0.45, streaks: 14 };
  },
  damask(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = b; ctx.globalAlpha = 0.55;
    const n = 4, c = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const cx = x * c + c / 2 + (y % 2 ? c / 2 : 0), cy = y * c + c / 2;
      for (const ox of [-S, 0, S]) {
        ctx.beginPath(); ctx.ellipse(cx + ox, cy, c * 0.18, c * 0.36, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + ox, cy, c * 0.36, c * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // wainscoting rail at bottom third
    ctx.fillStyle = '#2a140c'; ctx.fillRect(0, S * 0.66, S, S * 0.34);
    ctx.fillStyle = '#3d1e12'; ctx.fillRect(0, S * 0.66, S, S * 0.03);
    for (let x = 0; x < S; x += S / 4) { ctx.strokeStyle = '#1c0d07'; ctx.lineWidth = 4; ctx.strokeRect(x + 10, S * 0.72, S / 4 - 20, S * 0.24); }
    return { grime: 0.35, streaks: 6 };
  },
  kids(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    const cols = [b, '#e05d5d', '#7ccf7a', '#f5f5f5'];
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.75;
      const x = r.range(0, S), y = r.range(0, S * 0.6), s = r.range(10, 26);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const ang = (k / 10) * Math.PI * 2, rr = k % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8e0c8'; ctx.fillRect(0, S * 0.7, S, S * 0.3);
    ctx.fillStyle = b; ctx.fillRect(0, S * 0.68, S, S * 0.04);
    return { grime: 0.4, streaks: 10 };
  },
  concrete(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = b; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
    for (let i = 0; i < 6; i++) { // form-tie holes
      ctx.fillStyle = b; ctx.beginPath(); ctx.arc(S * (0.25 + (i % 3) * 0.25), S * (i < 3 ? 0.3 : 0.7), 4, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) { // cracks
      let x = r.range(0, S), y = r.range(0, S);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += r.range(-14, 14); y += r.range(4, 18); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return { grime: 0.55, streaks: 10, grain: 22 };
  },
  asphalt(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2500; i++) { ctx.fillStyle = r.chance(0.5) ? b : '#555'; ctx.globalAlpha = 0.3; ctx.fillRect(r.range(0, S), r.range(0, S), 2, 2); }
    ctx.globalAlpha = 0.7; ctx.fillStyle = '#b8a25a';
    ctx.fillRect(S * 0.48, 0, S * 0.04, S * 0.4); // faded paint line
    ctx.globalAlpha = 1;
    return { grime: 0.6, grain: 26 };
  },
  brick(ctx, S, a, b, r) {
    ctx.fillStyle = b; ctx.fillRect(0, 0, S, S);
    const rows = 16, bh = S / rows, bw = S / 4;
    for (let y = 0; y < rows; y++) for (let x = -1; x < 5; x++) {
      const ox = (y % 2) * bw / 2;
      const c = hexToRgb(a), k = r.range(0.75, 1.15);
      ctx.fillStyle = `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;
      ctx.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4);
    }
    return { grime: 0.5, streaks: 8, grain: 20 };
  },
  tile(ctx, S, a, b, r) {
    ctx.fillStyle = b; ctx.fillRect(0, 0, S, S);
    const n = 8, t = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = hexToRgb(a), k = r.range(0.93, 1.05);
      ctx.fillStyle = `rgb(${clamp(c[0] * k) | 0},${clamp(c[1] * k) | 0},${clamp(c[2] * k) | 0})`;
      ctx.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
      if (r.chance(0.04)) { ctx.strokeStyle = b; ctx.beginPath(); ctx.moveTo(x * t + r.range(0, t), y * t); ctx.lineTo(x * t + r.range(0, t), y * t + t); ctx.stroke(); }
    }
    return { grime: 0.3, grain: 8 };
  },
  metal(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    // diamond plate
    ctx.fillStyle = b; ctx.globalAlpha = 0.6;
    for (let y = 0; y < S; y += S / 16) for (let x = 0; x < S; x += S / 16) {
      ctx.save(); ctx.translate(x + ((y / (S / 16)) % 2) * S / 32, y); ctx.rotate(((y / (S / 16)) % 2 ? 1 : -1) * 0.7);
      ctx.fillRect(-7, -2, 14, 4); ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = b; ctx.lineWidth = 3; ctx.strokeRect(1, 1, S - 2, S - 2);
    return { grime: 0.5, grain: 16, tint: 0.95 };
  },
  panel(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = b; ctx.lineWidth = 4;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) ctx.strokeRect(x * S / 2 + 6, y * S / 2 + 6, S / 2 - 12, S / 2 - 12);
    ctx.fillStyle = b; for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc((i % 4) * S / 4 + S / 8, ((i / 4) | 0) * S / 4 + 10, 3, 0, 7); ctx.fill(); }
    return { grime: 0.45, streaks: 6, grain: 14 };
  },
  plaster(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = b; ctx.fillRect(0, S * 0.92, S, S * 0.08); // baseboard
    ctx.globalAlpha = 0.3; ctx.fillRect(0, S * 0.5, S, 3);
    ctx.globalAlpha = 1;
    return { grime: 0.45, streaks: 8, grain: 12 };
  },
  siding(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += S / 16) { ctx.fillStyle = b; ctx.fillRect(0, y, S, 3); }
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(S * 0.3, S * 0.25, S * 0.4, S * 0.3); // dark window
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 4; ctx.strokeRect(S * 0.3, S * 0.25, S * 0.4, S * 0.3);
    ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.25); ctx.lineTo(S * 0.5, S * 0.55); ctx.stroke();
    return { grime: 0.5, streaks: 8 };
  },
  wood(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    const planks = 8;
    for (let i = 0; i < planks; i++) {
      const c = hexToRgb(a), k = r.range(0.8, 1.15);
      ctx.fillStyle = `rgb(${clamp(c[0] * k) | 0},${clamp(c[1] * k) | 0},${clamp(c[2] * k) | 0})`;
      ctx.fillRect(i * S / planks, 0, S / planks, S);
      ctx.strokeStyle = b; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) { const x = i * S / planks + r.range(3, S / planks - 3); ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 4, S / 3, x - 4, S * 2 / 3, x, S); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = b; ctx.fillRect(i * S / planks, 0, 3, S);
      ctx.fillRect(i * S / planks, r.range(0, S), S / planks, 3);
    }
    return { grime: 0.4, grain: 12 };
  },
  rock(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = r.chance(0.5) ? b : a; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(r.range(0, S), r.range(0, S), r.range(10, 60), r.range(8, 40), r.range(0, 3), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return { grime: 0.7, grain: 30 };
  },
  dirt(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = r.chance(0.6) ? b : '#6b5a3c'; ctx.globalAlpha = 0.5; ctx.fillRect(r.range(0, S), r.range(0, S), r.range(1, 4), r.range(1, 4)); }
    ctx.globalAlpha = 1;
    return { grime: 0.6, grain: 28 };
  },
  wheat(ctx, S, a, b, r) {
    ctx.fillStyle = b; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const x = r.range(0, S), top = r.range(0, S * 0.3);
      ctx.strokeStyle = r.chance(0.5) ? a : '#d6c070'; ctx.globalAlpha = r.range(0.4, 0.9); ctx.lineWidth = r.range(1, 3);
      ctx.beginPath(); ctx.moveTo(x, S); ctx.quadraticCurveTo(x + r.range(-10, 10), S / 2, x + r.range(-14, 14), top); ctx.stroke();
      ctx.fillStyle = '#e0c878'; ctx.fillRect(x + r.range(-14, 14) - 2, top - 8, 4, 12);
    }
    ctx.globalAlpha = 1;
    return { grime: 0.3, grain: 18 };
  },
  grid(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = b; ctx.globalAlpha = 0.65; ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(i * S / 8, 0); ctx.lineTo(i * S / 8, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * S / 8); ctx.lineTo(S, i * S / 8); ctx.stroke(); }
    ctx.globalAlpha = 1;
    return { grime: 0.15, grain: 6 };
  },
  carpet(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = r.chance(0.5) ? b : a; ctx.globalAlpha = 0.35; ctx.fillRect(r.range(0, S), r.range(0, S), 2, 2); }
    ctx.globalAlpha = 1;
    return { grime: 0.6, grain: 20 };
  },
  ceiltile(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = b; ctx.globalAlpha = 0.25; ctx.fillRect(r.range(0, S), r.range(0, S), 2, 1); }
    ctx.globalAlpha = 1; ctx.fillStyle = b;
    ctx.fillRect(0, 0, S, 5); ctx.fillRect(0, S / 2 - 2, S, 5); ctx.fillRect(0, 0, 5, S); ctx.fillRect(S / 2 - 2, 0, 5, S);
    // water damage blot
    if (r.chance(0.8)) { ctx.fillStyle = '#7a5a2a'; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(r.range(0, S), r.range(0, S), r.range(20, 60), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    return { grime: 0.4, grain: 10 };
  },
  pipes(ctx, S, a, b, r) {
    ctx.fillStyle = b; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 5; i++) {
      const y = i * S / 5 + 10, h = r.range(14, 36);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#111'); g.addColorStop(0.4, a); g.addColorStop(1, '#0a0a0a');
      ctx.fillStyle = g; ctx.fillRect(0, y, S, h);
      ctx.fillStyle = '#222'; for (let x = 0; x < S; x += S / 4) ctx.fillRect(x, y - 3, 10, h + 6);
    }
    return { grime: 0.6, grain: 18 };
  },
  void(ctx, S, a, b, r) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, S, S);
    return { grime: 0.0, grain: 4 };
  },
};

const cache = new Map();
export function makeTexture(type, c1, c2, seed, size = 256) {
  const key = `${type}|${c1}|${c2}|${seed}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = new RNG(seed);
  const fn = DRAW[type] || DRAW.concrete;
  const opts = fn(ctx, size, c1, c2, r) || {};
  weather(ctx, size, seed, opts);
  cache.set(key, c);
  return c;
}

// Door / exit textures (lit) and emissive textures (light panels, exit signs).
export function makeExitTexture(kind) {
  const W = 256, H = 512;
  const c = canvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
  if (kind === 'door') {
    ctx.fillStyle = '#4a3a2a'; ctx.fillRect(12, 12, W - 24, H - 12);
    ctx.strokeStyle = '#2a1f14'; ctx.lineWidth = 6;
    ctx.strokeRect(36, 40, W - 72, 170); ctx.strokeRect(36, 250, W - 72, 220);
    ctx.fillStyle = '#c9b071'; ctx.beginPath(); ctx.arc(W - 46, 280, 10, 0, 7); ctx.fill();
  } else if (kind === 'elevator') {
    ctx.fillStyle = '#7d8187'; ctx.fillRect(10, 10, W - 20, H - 10);
    ctx.fillStyle = '#5f6368'; ctx.fillRect(W / 2 - 2, 10, 4, H);
    for (let y = 30; y < H; y += 24) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(20, y, W - 40, 2); }
  } else if (kind === 'ladder') {
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(30, 0, W - 60, H);
    ctx.fillStyle = '#8a8a86'; ctx.fillRect(50, 0, 14, H); ctx.fillRect(W - 64, 0, 14, H);
    for (let y = 20; y < H; y += 50) ctx.fillRect(50, y, W - 100, 10);
  } else if (kind === 'hatch') {
    ctx.fillStyle = '#3d4246'; ctx.fillRect(18, 120, W - 36, 300);
    ctx.strokeStyle = '#1d2023'; ctx.lineWidth = 10; ctx.strokeRect(30, 135, W - 60, 270);
    ctx.fillStyle = '#9a8b2a'; ctx.beginPath(); ctx.arc(W / 2, 270, 34, 0, 7); ctx.fill();
    ctx.fillStyle = '#3d4246'; ctx.beginPath(); ctx.arc(W / 2, 270, 22, 0, 7); ctx.fill();
  } else { // hole / crawlspace
    const g = ctx.createRadialGradient(W / 2, H * 0.62, 10, W / 2, H * 0.62, W * 0.55);
    g.addColorStop(0, '#000'); g.addColorStop(0.8, '#050505'); g.addColorStop(1, '#2a241e');
    ctx.fillStyle = '#2a241e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(W / 2, H * 0.62, W * 0.42, H * 0.34, 0, 0, 7); ctx.fill();
  }
  weather(ctx, Math.min(W, H), 77, { grime: 0.4, grain: 12 });
  return c;
}

export function makeSignTexture(text, color) {
  const c = canvas(256, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#060606'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color; ctx.font = 'bold 44px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fillText(text || '???', 128, 34);
  return c;
}

export function makePanelTexture(kind) {
  const c = canvas(128, 128), ctx = c.getContext('2d');
  if (kind === 'fluor') {
    ctx.fillStyle = '#9a9a92'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 112, 112);
    ctx.strokeStyle = 'rgba(160,160,150,0.6)'; ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 14, 8); ctx.lineTo(8 + i * 14, 120); ctx.stroke(); ctx.beginPath(); ctx.moveTo(8, 8 + i * 14); ctx.lineTo(120, 8 + i * 14); ctx.stroke(); }
    // dead flies in the diffuser
    ctx.fillStyle = 'rgba(30,25,15,0.7)'; for (let i = 0; i < 6; i++) ctx.fillRect(10 + Math.random() * 100, 10 + Math.random() * 100, 3, 2);
  } else {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, '#fff'); g.addColorStop(0.35, '#fff'); g.addColorStop(0.5, '#888'); g.addColorStop(1, '#222');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  return c;
}

export function makeGlowTexture() {
  const c = canvas(128, 128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.2, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return c;
}
