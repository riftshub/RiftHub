// Procedurally drawn entity sprites (albedo + emissive atlases) and full-screen jumpscare faces.
import { RNG } from './rng.js';

export const CELL_W = 256, CELL_H = 512, ATLAS = 2048, COLS = 8;
export const SLOT = { almond: 28, note: 29, player: 30 };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const limb = (ctx, x1, y1, x2, y2, w, col) => {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
};
const jointed = (ctx, pts, w, col) => {
  ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = w * (1 - (i / pts.length) * 0.45);
    ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke();
  }
};
const ell = (ctx, x, y, rx, ry, col, rot = 0) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill(); };
const shade = (ctx, x, y, w, h, light, dark) => {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, dark); g.addColorStop(0.45, light); g.addColorStop(1, dark);
  return g;
};
function grit(ctx, amt = 0.25) {
  // per-pixel dirt on non-transparent pixels
  const img = ctx.getImageData(0, 0, CELL_W, CELL_H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const n = 1 + (Math.random() - 0.5) * amt;
    d[i] *= n; d[i + 1] *= n; d[i + 2] *= n;
  }
  ctx.putImageData(img, 0, 0);
}
function teeth(ctx, cx, cy, w, h, n, col = '#fff') {
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / n);
    const curve = Math.sin((i / (n - 1)) * Math.PI) * h * 0.35;
    ctx.beginPath(); ctx.moveTo(x - w / n / 2, cy + curve); ctx.lineTo(x, cy + curve + h * 0.6); ctx.lineTo(x + w / n / 2, cy + curve); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - w / n / 2, cy + curve + h); ctx.lineTo(x, cy + curve + h * 0.4); ctx.lineTo(x + w / n / 2, cy + curve + h); ctx.fill();
  }
}
function humanoid(ctx, o) {
  // o: cx, top, h(px), skin, cloth, pants, armLen, legLen, thin, headR, hunch, f(frame)
  const cx = o.cx ?? 128, base = 508, H = o.h ?? 440;
  const top = base - H;
  const headR = o.headR ?? H * 0.065;
  const shoulderY = top + headR * 2.2 + (o.hunch || 0);
  const hipY = top + H * 0.52;
  const sw = (o.shoulders ?? H * 0.14) * (o.thin ? 0.75 : 1);
  const swing = o.f ? 14 : -14;
  const legW = H * (o.thin ? 0.035 : 0.05), armW = H * (o.thin ? 0.026 : 0.04);
  // legs
  jointed(ctx, [[cx - sw * 0.45, hipY], [cx - sw * 0.5 - swing * 0.3, hipY + (base - hipY) * 0.5], [cx - sw * 0.5 + swing * 0.2, base - 6]], legW, o.pants);
  jointed(ctx, [[cx + sw * 0.45, hipY], [cx + sw * 0.5 + swing * 0.3, hipY + (base - hipY) * 0.5], [cx + sw * 0.5 - swing * 0.2, base - 6]], legW, o.pants);
  // torso
  ctx.fillStyle = shade(ctx, cx - sw, shoulderY, sw * 2, 1, o.clothLight || o.cloth, o.cloth);
  ctx.beginPath();
  ctx.moveTo(cx - sw, shoulderY); ctx.lineTo(cx + sw, shoulderY);
  ctx.lineTo(cx + sw * 0.7, hipY); ctx.lineTo(cx - sw * 0.7, hipY); ctx.closePath(); ctx.fill();
  // arms
  const al = o.armLen ?? H * 0.36;
  const handL = [cx - sw - 6 + swing * 0.4, shoulderY + al], handR = [cx + sw + 6 - swing * 0.4, shoulderY + al];
  jointed(ctx, [[cx - sw, shoulderY + 6], [cx - sw - 10, shoulderY + al * 0.5], handL], armW, o.sleeve || o.cloth);
  jointed(ctx, [[cx + sw, shoulderY + 6], [cx + sw + 10, shoulderY + al * 0.5], handR], armW, o.sleeve || o.cloth);
  ell(ctx, handL[0], handL[1], armW * 0.6, armW * 0.8, o.skin);
  ell(ctx, handR[0], handR[1], armW * 0.6, armW * 0.8, o.skin);
  // neck + head
  limb(ctx, cx, shoulderY, cx, shoulderY - headR * 0.6, headR * 0.6, o.skin);
  const hg = ctx.createRadialGradient(cx - headR * 0.3, shoulderY - headR * 1.4, 2, cx, shoulderY - headR * 1.2, headR * 1.3);
  hg.addColorStop(0, o.skinLight || o.skin); hg.addColorStop(1, o.skin);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(cx, shoulderY - headR * 1.2, headR * 0.85, headR, 0, 0, 7); ctx.fill();
  return { cx, headY: shoulderY - headR * 1.2, headR, shoulderY, hipY, sw, handL, handR };
}

const SPR = {
  smiler(c, e, f) {
    const g = c.createRadialGradient(128, 260, 10, 128, 260, 130);
    g.addColorStop(0, 'rgba(3,3,4,0.98)'); g.addColorStop(0.6, 'rgba(5,5,6,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(128, 270, 120, 200, 0, 0, 7); c.fill();
    for (let i = 0; i < 9; i++) { c.strokeStyle = 'rgba(4,4,5,0.6)'; c.lineWidth = 6; c.beginPath(); c.moveTo(128, 300); c.quadraticCurveTo(128 + (i - 4) * 30, 420, 128 + (i - 4) * 26 + (f ? 8 : -8), 505); c.stroke(); }
    const sq = f ? 6 : 12;
    ell(e, 92, 200, 18, sq, '#fff', -0.25); ell(e, 164, 200, 18, sq, '#fff', 0.25);
    ell(e, 92, 200, 6, sq * 0.6, '#cfd8ff', -0.25); ell(e, 164, 200, 6, sq * 0.6, '#cfd8ff', 0.25);
    e.strokeStyle = '#fff'; e.lineWidth = 3;
    const w = f ? 170 : 150;
    e.beginPath(); e.moveTo(128 - w / 2, 248); e.quadraticCurveTo(128, f ? 330 : 312, 128 + w / 2, 248); e.stroke();
    teeth(e, 128, 252, w * 0.82, 30, 16);
  },
  hound(c, e, f) {
    const skin = '#b8ada0', dark = '#6f665c';
    // arched back behind head
    ell(c, 128, 330, 96, 70, dark);
    ell(c, 128, 320, 80, 58, skin);
    for (let i = 0; i < 6; i++) limb(c, 70 + i * 22, 300, 74 + i * 22, 352, 3, '#8a8073'); // ribs
    // front arms planted wide
    jointed(c, [[64, 340], [26 + (f ? 6 : 0), 420], [40, 506]], 20, skin);
    jointed(c, [[192, 340], [230 - (f ? 6 : 0), 420], [216, 506]], 20, skin);
    ell(c, 40, 504, 18, 7, dark); ell(c, 216, 504, 18, 7, dark);
    // low head with hanging black hair
    ell(c, 128, 392, 34, 38, skin);
    for (let i = 0; i < 26; i++) limb(c, 100 + i * 2.2, 362, 96 + i * 2.6 + (f ? 3 : -3), 450 + (i % 5) * 6, 2, '#0b0907');
    ell(e, 116, 400, 3, 2, '#e8d9a0'); ell(e, 140, 400, 3, 2, '#e8d9a0');
    c.fillStyle = '#1a0606'; c.fillRect(112, 418, 32, 8);
    teeth(c, 128, 418, 28, 8, 7, '#d8d0b8');
  },
  howler(c, e, f) {
    const o = humanoid(c, { h: 500, skin: '#cfc6b8', skinLight: '#e6ddcf', cloth: '#bdb3a4', clothLight: '#d6ccbd', pants: '#a99f90', thin: true, armLen: 300, headR: 22, f });
    for (let i = 0; i < 7; i++) limb(c, o.cx - 20, o.shoulderY + 20 + i * 14, o.cx + 20, o.shoulderY + 20 + i * 14, 2, '#958b7d');
    ell(c, o.cx, o.headY + 10, 10, f ? 34 : 26, '#090303');
    ell(c, o.cx - 8, o.headY - 6, 4, 6, '#000'); ell(c, o.cx + 8, o.headY - 6, 4, 6, '#000');
    // long fingers
    for (const h of [o.handL, o.handR]) for (let k = -2; k <= 2; k++) limb(c, h[0], h[1], h[0] + k * 5, h[1] + 34, 3, '#cfc6b8');
  },
  partygoer(c, e, f) {
    const o = humanoid(c, { h: 420, skin: '#e8c64a', skinLight: '#ffe27a', cloth: '#d9b53d', clothLight: '#f2cf55', pants: '#c49f30', headR: 46, f });
    // huge round yellow head
    const g = c.createRadialGradient(o.cx - 18, o.headY - 30, 6, o.cx, o.headY - 10, 70);
    g.addColorStop(0, '#fff3a6'); g.addColorStop(0.6, '#f0cc3e'); g.addColorStop(1, '#a8861c');
    c.fillStyle = g; c.beginPath(); c.arc(o.cx, o.headY - 14, 62, 0, 7); c.fill();
    c.strokeStyle = '#0a0a0a'; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(o.cx - 26, o.headY - 34); c.lineTo(o.cx - 26, o.headY - 18); c.stroke();
    c.beginPath(); c.moveTo(o.cx + 26, o.headY - 34); c.lineTo(o.cx + 26, o.headY - 18); c.stroke();
    c.beginPath(); c.arc(o.cx, o.headY - 6, f ? 40 : 34, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    c.lineWidth = 2; c.strokeStyle = '#444'; c.beginPath(); c.moveTo(o.cx + 40, o.headY - 70); c.quadraticCurveTo(o.cx + 70, o.headY - 120, o.cx + 60, o.headY - 160); c.stroke();
  },
  skinstealer(c, e, f) {
    if (!f) { // disguise: a slightly-wrong person
      const o = humanoid(c, { h: 400, skin: '#c69c80', skinLight: '#dbb397', cloth: '#45525e', clothLight: '#5c6b78', pants: '#2a2e33', f: 0 });
      c.fillStyle = '#2b1d14'; c.beginPath(); c.arc(o.cx, o.headY - 8, o.headR * 0.9, Math.PI, 0); c.fill();
      ell(c, o.cx - 9, o.headY, 3, 4, '#111'); ell(c, o.cx + 9, o.headY, 3, 4, '#111');
      c.fillStyle = '#5a2020'; c.fillRect(o.cx - 8, o.headY + 14, 16, 3);
      return;
    }
    const o = humanoid(c, { h: 470, skin: '#d3b2a0', skinLight: '#e9cbb9', cloth: '#b48f7c', clothLight: '#cfa892', pants: '#9c7765', thin: true, armLen: 260, headR: 30, f: 1 });
    // draped loose skin folds
    for (let i = 0; i < 8; i++) { c.strokeStyle = 'rgba(120,70,60,0.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(o.cx - 40 + i * 10, o.shoulderY); c.quadraticCurveTo(o.cx - 46 + i * 12, o.hipY, o.cx - 50 + i * 14, o.hipY + 30); c.stroke(); }
    ell(c, o.cx - 11, o.headY - 2, 9, 12, '#050202'); ell(c, o.cx + 11, o.headY - 2, 9, 12, '#050202');
    ell(c, o.cx, o.headY + 22, 16, 9, '#1a0505');
    for (const h of [o.handL, o.handR]) for (let k = -2; k <= 2; k++) jointed(c, [[h[0], h[1]], [h[0] + k * 7, h[1] + 30], [h[0] + k * 9, h[1] + 64]], 4, '#d3b2a0');
  },
  faceling(c, e, f) {
    const o = humanoid(c, { h: 420, skin: '#c2a58f', skinLight: '#d8bca6', cloth: '#5c5852', clothLight: '#75706a', pants: '#3a3835', f });
    c.fillStyle = '#3a2b20'; c.beginPath(); c.arc(o.cx, o.headY - 8, o.headR * 0.92, Math.PI * 1.05, -0.05); c.fill();
    // faint indent where a face should be
    ell(c, o.cx, o.headY + 4, 10, 14, 'rgba(120,95,80,0.35)');
  },
  clump(c, e, f) {
    const skin = '#b39a86', dark = '#6e5a4c';
    ell(c, 128, 400, 92, 86, dark); ell(c, 128, 396, 80, 72, skin);
    const r = new RNG(f ? 5 : 9);
    for (let i = 0; i < 16; i++) {
      const a = r.range(0, Math.PI * 2), l = r.range(80, 140);
      const x0 = 128 + Math.cos(a) * 50, y0 = 400 + Math.sin(a) * 40;
      const x1 = 128 + Math.cos(a) * l, y1 = Math.min(506, 400 + Math.sin(a) * l * 0.8);
      jointed(c, [[x0, y0], [(x0 + x1) / 2 + r.range(-20, 20), (y0 + y1) / 2 + r.range(-20, 20)], [x1, y1]], r.range(12, 20), r.chance(0.5) ? skin : '#a08672');
      ell(c, x1, y1, 8, 6, '#8a7262');
    }
    for (let i = 0; i < 3; i++) { ell(c, 100 + i * 28, 380 + (i % 2) * 20, 9, 7, '#0a0505'); }
  },
  deathmoth(c, e, f) {
    const span = f ? 120 : 100;
    for (const s of [-1, 1]) {
      const g = c.createRadialGradient(128 + s * 60, 200, 10, 128 + s * 60, 220, 130);
      g.addColorStop(0, '#8a7458'); g.addColorStop(0.6, '#4f3f2c'); g.addColorStop(1, '#2a2015');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(128, 180); c.bezierCurveTo(128 + s * span * 1.2, 60, 128 + s * 128, 220, 128 + s * 20, 300); c.fill();
      c.beginPath(); c.moveTo(128, 270); c.bezierCurveTo(128 + s * span, 300, 128 + s * 90, 400, 128 + s * 12, 360); c.fill();
      ell(c, 128 + s * 62, 190, 18, 18, '#1b140c'); ell(c, 128 + s * 62, 190, 9, 9, '#c9b48a');
    }
    ell(c, 128, 260, 18, 70, '#3a2e22');
    for (let i = 0; i < 6; i++) limb(c, 120, 250 + i * 8, 90 - i * 2, 300 + i * 12, 3, '#2a2015');
    for (let i = 0; i < 6; i++) limb(c, 136, 250 + i * 8, 166 + i * 2, 300 + i * 12, 3, '#2a2015');
    ell(e, 120, 196, 5, 5, '#ff4a2a'); ell(e, 136, 196, 5, 5, '#ff4a2a');
  },
  wretch(c, e, f) {
    const o = humanoid(c, { h: 360, skin: '#9c907a', skinLight: '#b3a68e', cloth: '#3a342b', clothLight: '#4d463b', pants: '#2b2620', thin: true, hunch: 30, armLen: 210, f });
    for (let i = 0; i < 22; i++) limb(c, o.cx - 20 + i * 2, o.headY - 20, o.cx - 24 + i * 2.4 + (f ? 4 : -4), o.headY + 70 + (i % 4) * 8, 2, '#141210');
    c.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 10; i++) c.fillRect(o.cx - 30 + Math.random() * 60, o.shoulderY + Math.random() * 120, 6, 14); // tears
    ell(e, o.cx - 6, o.headY + 6, 2, 2, '#e8e0b0');
  },
  pale(c, e, f) {
    const o = humanoid(c, { h: 490, skin: '#e4e0da', skinLight: '#f6f3ef', cloth: '#d8d3cc', clothLight: '#ece8e2', pants: '#c8c2ba', thin: true, armLen: 280, headR: 26, f });
    ell(c, o.cx - 10, o.headY - 4, 8, 11, '#000'); ell(c, o.cx + 10, o.headY - 4, 8, 11, '#000');
    c.strokeStyle = '#3a1010'; c.lineWidth = 3; c.beginPath(); c.arc(o.cx, o.headY + 6, 12, 0.2, Math.PI - 0.2); c.stroke();
  },
  crawler(c, e, f) {
    const skin = '#8f8a80';
    ell(c, 128, 250, 34, 90, skin);
    const legs = [[-1, 200], [1, 200], [-1, 290], [1, 290]];
    for (const [s, y] of legs) jointed(c, [[128 + s * 26, y], [128 + s * 110, y - 60 + (f ? 10 : -10)], [128 + s * 124, y + 160]], 14, skin);
    ell(c, 128, 150, 30, 34, '#7d786e');
    ell(e, 116, 150, 4, 3, '#ffffff'); ell(e, 140, 150, 4, 3, '#ffffff');
    ell(c, 128, 172, 14, f ? 10 : 6, '#0b0505');
  },
  shadow(c, e, f) {
    const o = humanoid(c, { h: 440, skin: '#020203', cloth: '#020203', pants: '#020203', f });
    for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(o.cx + (Math.random() - 0.5) * 120, 80 + Math.random() * 420, 6 + Math.random() * 14, 0, 7); c.fill(); }
    ell(e, o.cx - 8, o.headY, 2.5, 2, '#ff2020'); ell(e, o.cx + 8, o.headY, 2.5, 2, '#ff2020');
  },
  hollow(c, e, f) {
    const o = humanoid(c, { h: 430, skin: '#d9c3a3', skinLight: '#efdcbf', cloth: '#d9c3a3', clothLight: '#efdcbf', pants: '#ccb594', f: 0 });
    for (const [x, y] of [[o.cx - o.sw, o.shoulderY + 6], [o.cx + o.sw, o.shoulderY + 6], [o.cx, o.hipY], [o.cx - 30, 390], [o.cx + 30, 390]]) ell(c, x, y, 7, 7, '#a8916f');
    limb(c, o.cx - o.sw * 0.7, o.hipY, o.cx + o.sw * 0.7, o.hipY, 3, '#a8916f');
    if (f) { ell(c, o.cx, o.headY + 12, 10, 4, '#2a1a10'); }
  },
  screamer(c, e, f) {
    const g = c.createRadialGradient(128, 230, 10, 128, 240, 120);
    g.addColorStop(0, '#d6c8b4'); g.addColorStop(0.7, '#a39078'); g.addColorStop(1, 'rgba(60,40,30,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(128, 240, 100, 140, 0, 0, 7); c.fill();
    ell(c, 88, 190, 26, 30, '#000'); ell(c, 168, 190, 26, 30, '#000');
    ell(c, 128, 300, 40, f ? 80 : 60, '#0c0202');
    teeth(c, 128, 238, 70, 16, 8, '#d9cfae');
    ell(e, 88, 192, 6, 6, '#fff'); ell(e, 168, 192, 6, 6, '#fff');
    for (let i = 0; i < 30; i++) limb(c, 40 + i * 6, 120, 30 + i * 7, 80 + Math.random() * 30, 2, '#1a120c');
  },
};

export const ENTITY_SPRITES = Object.keys(SPR); // index * 2 = slot

function drawPlayer(c, f) {
  const o = humanoid(c, { h: 400, skin: '#d2a789', skinLight: '#e3bc9f', cloth: '#9a9a9a', clothLight: '#c4c4c4', pants: '#3a3d44', f });
  c.fillStyle = '#2a1e16'; c.beginPath(); c.arc(o.cx, o.headY - 8, o.headR * 0.95, Math.PI, 0); c.fill();
  ell(c, o.cx - 8, o.headY, 3, 3, '#141414'); ell(c, o.cx + 8, o.headY, 3, 3, '#141414');
  c.fillStyle = '#222'; c.fillRect(o.handR[0] - 6, o.handR[1] - 26, 12, 34); // flashlight
}
function drawAlmond(c) {
  const g = c.createLinearGradient(98, 0, 158, 0);
  g.addColorStop(0, 'rgba(190,210,220,0.75)'); g.addColorStop(0.4, 'rgba(240,250,255,0.9)'); g.addColorStop(1, 'rgba(160,180,190,0.75)');
  c.fillStyle = g; c.beginPath(); c.roundRect(98, 360, 60, 148, 14); c.fill();
  c.fillRect(116, 330, 24, 34); c.fillStyle = '#e8e2c8'; c.fillRect(110, 318, 36, 16);
  c.fillStyle = '#efe6c6'; c.fillRect(98, 410, 60, 50);
  c.fillStyle = '#6a4a20'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.fillText('ALMOND', 128, 432); c.fillText('WATER', 128, 448);
}
function drawNote(c) {
  c.save(); c.translate(128, 470); c.rotate(-0.15);
  c.fillStyle = '#ddd5bf'; c.fillRect(-56, -40, 112, 76);
  c.strokeStyle = 'rgba(40,40,60,0.6)'; c.lineWidth = 2;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-46, -28 + i * 11); c.lineTo(40 - (i * 7) % 30, -28 + i * 11); c.stroke(); }
  c.restore();
}

export function buildAtlases() {
  const A = canvas(ATLAS, ATLAS), E = canvas(ATLAS, ATLAS);
  const actx = A.getContext('2d', { willReadFrequently: true }), ectx = E.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, ATLAS, ATLAS);
  const cell = canvas(CELL_W, CELL_H), cctx = cell.getContext('2d', { willReadFrequently: true });
  const ecell = canvas(CELL_W, CELL_H), ectx2 = ecell.getContext('2d');
  const put = (slot, fn) => {
    cctx.clearRect(0, 0, CELL_W, CELL_H);
    ectx2.fillStyle = '#000'; ectx2.fillRect(0, 0, CELL_W, CELL_H);
    fn(cctx, ectx2);
    grit(cctx, 0.22);
    const x = (slot % COLS) * CELL_W, y = Math.floor(slot / COLS) * CELL_H;
    actx.drawImage(cell, x, y); ectx.drawImage(ecell, x, y);
  };
  ENTITY_SPRITES.forEach((name, i) => {
    put(i * 2, (c, e) => SPR[name](c, e, 0));
    put(i * 2 + 1, (c, e) => SPR[name](c, e, 1));
  });
  put(SLOT.almond, (c) => drawAlmond(c));
  put(SLOT.note, (c) => drawNote(c));
  put(SLOT.player, (c) => drawPlayer(c, 0));
  put(SLOT.player + 1, (c) => drawPlayer(c, 1));
  return { albedo: A, emissive: E };
}

// --------- jumpscare faces (2D overlay) ---------
const SCARE = {
  smiler: { bg: '#000', skin: null, eye: '#fff', mouth: '#fff', grin: true },
  hound: { bg: '#050403', skin: '#b8ada0', eye: '#e8d9a0', hair: '#0b0907', mouth: '#1a0606' },
  howler: { bg: '#070505', skin: '#cfc6b8', eye: '#000', mouth: '#090303', long: true },
  partygoer: { bg: '#100c02', skin: '#f0cc3e', eye: '#0a0a0a', party: true },
  skinstealer: { bg: '#0a0504', skin: '#d3b2a0', eye: '#050202', mouth: '#1a0505' },
  faceling: { bg: '#060606', skin: '#c2a58f', blank: true },
  clump: { bg: '#060403', skin: '#b39a86', eye: '#0a0505', mouth: '#0a0505', many: true },
  deathmoth: { bg: '#050302', skin: '#4f3f2c', eye: '#ff4a2a', moth: true },
  wretch: { bg: '#040403', skin: '#9c907a', eye: '#e8e0b0', hair: '#141210', mouth: '#0a0303' },
  pale: { bg: '#000', skin: '#e4e0da', eye: '#000', mouth: '#3a1010' },
  crawler: { bg: '#050505', skin: '#8f8a80', eye: '#fff', mouth: '#0b0505' },
  shadow: { bg: '#000', skin: '#030304', eye: '#ff2020', mouth: '#000' },
  hollow: { bg: '#080604', skin: '#d9c3a3', blank: true, crack: true },
  screamer: { bg: '#000', skin: '#d6c8b4', eye: '#000', mouth: '#0c0202', long: true },
};

export function drawJumpscare(ctx, type, W, H, t) {
  const s = SCARE[type] || SCARE.pale;
  const shake = (1 - Math.min(1, t)) * 40 + 8;
  const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
  const zoom = 0.8 + Math.min(t * 3, 1) * 0.5 + Math.sin(t * 40) * 0.03;
  ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 + jx, H / 2 + jy); ctx.scale(zoom, zoom);
  const R = Math.min(W, H) * 0.42;
  if (s.skin) {
    const g = ctx.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R * 1.2);
    g.addColorStop(0, s.skin); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, R * (s.long ? 0.7 : 0.85), R * (s.long ? 1.25 : 1), 0, 0, 7); ctx.fill();
  }
  if (s.hair) for (let i = 0; i < 120; i++) { ctx.strokeStyle = s.hair; ctx.lineWidth = 3; ctx.beginPath(); const x = (Math.random() - 0.5) * R * 1.8; ctx.moveTo(x, -R); ctx.lineTo(x + (Math.random() - 0.5) * 40, -R * 0.1 + Math.random() * R * 0.6); ctx.stroke(); }
  if (s.party) {
    ctx.strokeStyle = s.eye; ctx.lineWidth = R * 0.08; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-R * 0.35, -R * 0.35); ctx.lineTo(-R * 0.35, -R * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * 0.35, -R * 0.35); ctx.lineTo(R * 0.35, -R * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, R * 0.05, R * 0.6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else if (s.grin) {
    ctx.fillStyle = s.eye;
    ctx.beginPath(); ctx.ellipse(-R * 0.4, -R * 0.35, R * 0.22, R * 0.09, -0.3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R * 0.4, -R * 0.35, R * 0.22, R * 0.09, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(-R * 0.9, R * 0.05); ctx.quadraticCurveTo(0, R * 1.0, R * 0.9, R * 0.05); ctx.quadraticCurveTo(0, R * 0.5, -R * 0.9, R * 0.05); ctx.fill();
    teeth(ctx, 0, R * 0.12, R * 1.6, R * 0.4, 18, '#fff');
  } else if (s.blank) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, R * 0.05, R * 0.3, R * 0.4, 0, 0, 7); ctx.fill();
    if (s.crack) { ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-R * 0.1, -R); for (let i = 0; i < 8; i++) ctx.lineTo((Math.random() - 0.5) * R * 0.5, -R + i * R * 0.25); ctx.stroke(); }
  } else if (s.moth) {
    for (const sd of [-1, 1]) { ctx.fillStyle = '#3a2e22'; ctx.beginPath(); ctx.ellipse(sd * R * 0.9, -R * 0.2, R * 0.9, R * 0.6, sd * 0.4, 0, 7); ctx.fill(); }
    ctx.fillStyle = s.eye; ctx.beginPath(); ctx.arc(-R * 0.15, -R * 0.2, R * 0.12, 0, 7); ctx.arc(R * 0.15, -R * 0.2, R * 0.12, 0, 7); ctx.fill();
  } else {
    const eyes = s.many ? [[-0.4, -0.3], [0.35, -0.4], [0, -0.1], [-0.2, 0.2], [0.45, 0.1]] : [[-0.32, -0.3], [0.32, -0.3]];
    for (const [ex, ey] of eyes) {
      ctx.fillStyle = s.eye; ctx.beginPath(); ctx.ellipse(ex * R, ey * R, R * 0.14, R * 0.17, 0, 0, 7); ctx.fill();
      if (s.eye !== '#000' && s.eye !== '#050202') { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex * R, ey * R, R * 0.04, 0, 7); ctx.fill(); }
    }
    const mh = (s.long ? 0.75 : 0.45) * (1 + Math.sin(t * 30) * 0.08);
    ctx.fillStyle = s.mouth; ctx.beginPath(); ctx.ellipse(0, R * 0.45, R * 0.32, R * mh, 0, 0, 7); ctx.fill();
    teeth(ctx, 0, R * 0.45 - R * mh * 0.9, R * 0.5, R * 0.2, 8, '#d9cfae');
  }
  ctx.restore();
  // scanline tear + noise
  for (let i = 0; i < 6; i++) {
    const y = Math.random() * H, h = Math.random() * 20 + 2;
    ctx.drawImage(ctx.canvas, 0, y, W, h, (Math.random() - 0.5) * 60, y, W, h);
  }
  ctx.fillStyle = `rgba(255,0,0,${0.08 + Math.random() * 0.08})`; ctx.fillRect(0, 0, W, H);
}
