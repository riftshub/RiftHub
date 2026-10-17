// Procedural map generation. Twelve generator types; every level uses one, seeded so co-op clients match.
import { RNG, valueNoise2D, fbm } from './rng.js';

export const WALL = 1, FLOOR = 0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeGrid(W, H, fill) {
  const g = new Uint8Array(W * H);
  g.fill(fill);
  return g;
}
function rect(g, W, x0, y0, x1, y1, v) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * W + x] = v;
}
function carveLine(g, W, H, x0, y0, x1, y1, width = 1) {
  // L-shaped carve
  let x = x0, y = y0;
  const put = (cx, cy) => {
    for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px > 0 && py > 0 && px < W - 1 && py < H - 1) g[py * W + px] = FLOOR;
    }
  };
  while (x !== x1) { put(x, y); x += Math.sign(x1 - x); }
  while (y !== y1) { put(x, y); y += Math.sign(y1 - y); }
  put(x, y);
}

// ---------------- generators ----------------
const GEN = {
  backrooms(r, W, H) {
    const g = makeGrid(W, H, FLOOR);
    const segs = Math.floor((W * H) / 16);
    for (let i = 0; i < segs; i++) {
      const x = r.int(1, W - 2), y = r.int(1, H - 2);
      const len = r.int(2, 9);
      const horiz = r.chance(0.5);
      for (let k = 0; k < len; k++) {
        const px = horiz ? x + k : x, py = horiz ? y : y + k;
        if (px < W - 1 && py < H - 1) g[py * W + px] = WALL;
      }
    }
    // a few closed rooms with gaps, very Level-0
    const rooms = Math.floor((W * H) / 400);
    for (let i = 0; i < rooms; i++) {
      const w = r.int(4, 9), h = r.int(4, 9);
      const x0 = r.int(1, W - w - 2), y0 = r.int(1, H - h - 2);
      for (let x = x0; x <= x0 + w; x++) { g[y0 * W + x] = WALL; g[(y0 + h) * W + x] = WALL; }
      for (let y = y0; y <= y0 + h; y++) { g[y * W + x0] = WALL; g[y * W + x0 + w] = WALL; }
      rect(g, W, x0 + 1, y0 + 1, x0 + w - 1, y0 + h - 1, FLOOR);
      const gaps = r.int(1, 3);
      for (let k = 0; k < gaps; k++) {
        const side = r.int(0, 3);
        if (side === 0) g[y0 * W + r.int(x0 + 1, x0 + w - 1)] = FLOOR;
        if (side === 1) g[(y0 + h) * W + r.int(x0 + 1, x0 + w - 1)] = FLOOR;
        if (side === 2) g[r.int(y0 + 1, y0 + h - 1) * W + x0] = FLOOR;
        if (side === 3) g[r.int(y0 + 1, y0 + h - 1) * W + x0 + w] = FLOOR;
      }
    }
    for (let i = 0; i < segs / 3; i++) g[r.int(1, H - 2) * W + r.int(1, W - 2)] = WALL; // stray pillars
    return g;
  },

  pillars(r, W, H) {
    const g = makeGrid(W, H, FLOOR);
    const step = r.chance(0.5) ? 3 : 4;
    const ox = r.int(0, step - 1), oy = r.int(0, step - 1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if ((x - ox) % step === 0 && (y - oy) % step === 0) g[y * W + x] = WALL;
    }
    // long dividing walls with doorways
    const walls = r.int(6, 12);
    for (let i = 0; i < walls; i++) {
      const horiz = r.chance(0.5);
      const c = horiz ? r.int(2, H - 3) : r.int(2, W - 3);
      const start = r.int(1, (horiz ? W : H) / 2), len = r.int(8, (horiz ? W : H) - 4);
      for (let k = start; k < Math.min(start + len, (horiz ? W : H) - 1); k++) {
        if (r.chance(0.12)) { k += 2; continue; } // doorway
        if (horiz) g[c * W + k] = WALL; else g[k * W + c] = WALL;
      }
    }
    // open halls without pillars
    for (let i = 0; i < 4; i++) {
      const w = r.int(6, 14), h = r.int(6, 14);
      const x0 = r.int(1, W - w - 2), y0 = r.int(1, H - h - 2);
      rect(g, W, x0, y0, x0 + w, y0 + h, FLOOR);
    }
    return g;
  },

  maze(r, W, H, opts = {}) {
    const g = makeGrid(W, H, WALL);
    const straight = opts.straight || 0.0;
    const cw = Math.floor((W - 1) / 2), ch = Math.floor((H - 1) / 2);
    const seen = new Uint8Array(cw * ch);
    const stack = [[r.int(0, cw - 1), r.int(0, ch - 1), -1]];
    seen[stack[0][1] * cw + stack[0][0]] = 1;
    g[(stack[0][1] * 2 + 1) * W + stack[0][0] * 2 + 1] = FLOOR;
    while (stack.length) {
      const [cx, cy, lastDir] = stack[stack.length - 1];
      let opts4 = [0, 1, 2, 3].filter((d) => {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        return nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx];
      });
      if (!opts4.length) { stack.pop(); continue; }
      let d;
      if (lastDir >= 0 && opts4.includes(lastDir) && r.chance(straight)) d = lastDir;
      else d = r.pick(opts4);
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      seen[ny * cw + nx] = 1;
      g[(cy * 2 + 1 + DIRS[d][1]) * W + cx * 2 + 1 + DIRS[d][0]] = FLOOR;
      g[(ny * 2 + 1) * W + nx * 2 + 1] = FLOOR;
      stack.push([nx, ny, d]);
    }
    // braid: remove some dead ends to create loops (entities can circle around you)
    const braid = opts.braid ?? 0.55;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (g[y * W + x] !== FLOOR) continue;
      let walls = 0;
      for (const [dx, dy] of DIRS) if (g[(y + dy) * W + x + dx] === WALL) walls++;
      if (walls === 3 && r.chance(braid)) {
        const cand = DIRS.filter(([dx, dy]) => {
          const px = x + dx * 2, py = y + dy * 2;
          return px > 0 && py > 0 && px < W - 1 && py < H - 1 && g[(y + dy) * W + x + dx] === WALL;
        });
        if (cand.length) { const [dx, dy] = r.pick(cand); g[(y + dy) * W + x + dx] = FLOOR; }
      }
    }
    const rooms = opts.rooms ?? Math.floor((W * H) / 500);
    for (let i = 0; i < rooms; i++) {
      const w = r.int(2, 5), h = r.int(2, 5);
      const x0 = r.int(1, W - w - 2), y0 = r.int(1, H - h - 2);
      rect(g, W, x0, y0, x0 + w, y0 + h, FLOOR);
    }
    return g;
  },

  pipes(r, W, H) {
    const g = GEN.maze(r, W, H, { straight: 0.8, braid: 0.35, rooms: Math.floor((W * H) / 900) });
    // long service runs
    for (let i = 0; i < 4; i++) {
      if (r.chance(0.5)) { const y = r.int(1, (H - 2) / 2) * 2 - 1; carveLine(g, W, H, 1, y, W - 2, y); }
      else { const x = r.int(1, (W - 2) / 2) * 2 - 1; carveLine(g, W, H, x, 1, x, H - 2); }
    }
    return g;
  },

  rooms(r, W, H) {
    const g = makeGrid(W, H, WALL);
    const leaves = [];
    const split = (x, y, w, h, depth) => {
      const minS = 7;
      if (depth > 6 || (w < minS * 2 && h < minS * 2)) { leaves.push({ x, y, w, h }); return; }
      const horiz = w < minS * 2 ? true : h < minS * 2 ? false : r.chance(h / (w + h));
      if (horiz) {
        const s = r.int(minS, h - minS);
        split(x, y, w, s, depth + 1); split(x, y + s, w, h - s, depth + 1);
      } else {
        const s = r.int(minS, w - minS);
        split(x, y, s, h, depth + 1); split(x + s, y, w - s, h, depth + 1);
      }
    };
    split(1, 1, W - 2, H - 2, 0);
    const centers = [];
    for (const lf of leaves) {
      const rw = r.int(Math.max(3, lf.w - 4), lf.w - 2), rh = r.int(Math.max(3, lf.h - 4), lf.h - 2);
      const rx = lf.x + r.int(1, Math.max(1, lf.w - rw - 1)), ry = lf.y + r.int(1, Math.max(1, lf.h - rh - 1));
      rect(g, W, rx, ry, Math.min(W - 2, rx + rw - 1), Math.min(H - 2, ry + rh - 1), FLOOR);
      // office furniture blocks in big rooms (cubicles)
      if (rw >= 7 && rh >= 7 && r.chance(0.5)) {
        for (let yy = ry + 2; yy < ry + rh - 2; yy += 3) for (let xx = rx + 2; xx < rx + rw - 2; xx += 3) if (r.chance(0.7)) g[yy * W + xx] = WALL;
      }
      centers.push([Math.floor(rx + rw / 2), Math.floor(ry + rh / 2)]);
    }
    // connect rooms in order and with some extra loops
    r.shuffle(centers);
    centers.sort((a, b) => a[0] + a[1] * 0.3 - (b[0] + b[1] * 0.3));
    for (let i = 1; i < centers.length; i++) {
      const [ax, ay] = centers[i - 1], [bx, by] = centers[i];
      if (r.chance(0.5)) carveLine(g, W, H, ax, ay, bx, by); else carveLine(g, W, H, bx, by, ax, ay);
    }
    for (let i = 0; i < centers.length / 3; i++) {
      const a = r.pick(centers), b = r.pick(centers);
      carveLine(g, W, H, a[0], a[1], b[0], b[1]);
    }
    return g;
  },

  halls(r, W, H) {
    const g = makeGrid(W, H, WALL);
    const hs = [], vs = [];
    for (let y = 2 + r.int(0, 3); y < H - 2; y += r.int(6, 9)) hs.push(y);
    for (let x = 2 + r.int(0, 3); x < W - 2; x += r.int(7, 11)) vs.push(x);
    for (const y of hs) {
      let x = 1;
      while (x < W - 1) {
        const len = r.int(10, W);
        if (r.chance(0.85)) carveLine(g, W, H, x, y, Math.min(W - 2, x + len), y);
        x += len + r.int(0, 4);
      }
    }
    for (const x of vs) {
      let y = 1;
      while (y < H - 1) {
        const len = r.int(8, H);
        if (r.chance(0.8)) carveLine(g, W, H, x, y, x, Math.min(H - 2, y + len));
        y += len + r.int(0, 4);
      }
    }
    // rooms hanging off the halls with single doors
    for (let i = 0; i < (W * H) / 60; i++) {
      const hall = r.pick(hs);
      const above = r.chance(0.5);
      const w = r.int(2, 4), h = r.int(2, 3);
      const x0 = r.int(2, W - w - 3);
      const y0 = above ? hall - h - 1 : hall + 2;
      if (y0 < 1 || y0 + h >= H - 1) continue;
      let clear = true;
      for (let y = y0; y < y0 + h && clear; y++) for (let x = x0; x < x0 + w; x++) if (g[y * W + x] === FLOOR) { clear = false; break; }
      if (!clear || g[hall * W + x0] !== FLOOR) continue;
      rect(g, W, x0, y0, x0 + w - 1, y0 + h - 1, FLOOR);
      const doorX = x0 + r.int(0, w - 1);
      g[(above ? hall - 1 : hall + 1) * W + doorX] = FLOOR;
    }
    return g;
  },

  caves(r, W, H) {
    let g = makeGrid(W, H, WALL);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) g[y * W + x] = r.chance(0.44) ? WALL : FLOOR;
    for (let it = 0; it < 5; it++) {
      const n = new Uint8Array(g);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[(y + dy) * W + x + dx] === WALL) c++;
        n[y * W + x] = c >= 5 ? WALL : FLOOR;
      }
      g = n;
    }
    return g;
  },

  field(r, W, H) {
    const g = makeGrid(W, H, FLOOR);
    const n = valueNoise2D(r.int(0, 1e9));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (fbm(n, x / 5, y / 5, 3) > 0.5) g[y * W + x] = WALL;
    }
    // trampled paths through the wheat
    for (let i = 0; i < 10; i++) {
      let x = r.int(2, W - 3), y = r.int(2, H - 3), d = r.int(0, 3);
      for (let k = 0; k < 80; k++) {
        g[y * W + x] = FLOOR;
        if (r.chance(0.2)) d = r.int(0, 3);
        x = Math.max(1, Math.min(W - 2, x + DIRS[d][0]));
        y = Math.max(1, Math.min(H - 2, y + DIRS[d][1]));
      }
    }
    return g;
  },

  blocks(r, W, H) {
    const g = makeGrid(W, H, FLOOR);
    let y = 1;
    while (y < H - 4) {
      const bh = r.int(4, 9);
      let x = 1;
      while (x < W - 4) {
        const bw = r.int(4, 10);
        const x1 = Math.min(W - 2, x + bw), y1 = Math.min(H - 2, y + bh);
        if (r.chance(0.85)) {
          rect(g, W, x + 1, y + 1, x1 - 1, y1 - 1, WALL);
          if (r.chance(0.4)) carveLine(g, W, H, x + 1, r.int(y + 1, y1 - 1), x1 - 1, r.int(y + 1, y1 - 1)); // alley
        }
        x = x1 + r.int(1, 2);
      }
      y += bh + r.int(1, 2);
    }
    return g;
  },

  pool(r, W, H) {
    const g = GEN.rooms(r, W, H);
    // widen everything and add pillar rows inside large rooms
    const n = new Uint8Array(g);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      if (g[y * W + x] === FLOOR) for (const [dx, dy] of DIRS) if (r.chance(0.6)) n[(y + dy) * W + x + dx] = FLOOR;
    }
    for (let y = 3; y < H - 3; y += 4) for (let x = 3; x < W - 3; x += 4) {
      let open = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (n[(y + dy) * W + x + dx] !== FLOOR) open = false;
      if (open && r.chance(0.6)) n[y * W + x] = WALL;
    }
    return n;
  },

  aisles(r, W, H) {
    const g = makeGrid(W, H, FLOOR);
    for (let y = 3; y < H - 2; y += 3) {
      for (let x = 2; x < W - 2; x++) g[y * W + x] = WALL;
    }
    const cross = [];
    for (let x = 2 + r.int(0, 4); x < W - 2; x += r.int(10, 16)) cross.push(x);
    for (const x of cross) for (let y = 1; y < H - 1; y++) { g[y * W + x] = FLOOR; g[y * W + x + 1] = FLOOR; }
    for (let i = 0; i < W; i++) g[(r.int(1, (H - 3) / 3) * 3) * W + r.int(2, W - 3)] = FLOOR; // gaps in shelves
    return g;
  },

  runner(r, W, H) {
    const g = makeGrid(W, H, WALL);
    const rows = [];
    for (let y = 3; y < H - 3; y += r.int(7, 11)) rows.push(y);
    for (const y of rows) carveLine(g, W, H, 2, y, W - 4, y, 2);
    for (let i = 0; i < rows.length - 1; i++) {
      const links = r.int(2, 4);
      for (let k = 0; k < links; k++) {
        const x = r.int(3, W - 5);
        carveLine(g, W, H, x, rows[i], x, rows[i + 1], r.chance(0.5) ? 2 : 1);
      }
    }
    // side rooms to duck into
    for (let i = 0; i < 18; i++) {
      const y = r.pick(rows), x = r.int(4, W - 8);
      const up = r.chance(0.5);
      const y0 = up ? y - 4 : y + 3;
      if (y0 < 1 || y0 + 2 >= H - 1) continue;
      rect(g, W, x, y0, x + r.int(2, 4), y0 + 2, FLOOR);
      carveLine(g, W, H, x + 1, y, x + 1, up ? y0 + 2 : y0);
    }
    return g;
  },
};

// ---------------- post-processing ----------------
function regions(g, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const q = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (g[i] !== FLOOR || lab[i] >= 0) continue;
    const id = sizes.length;
    let h = 0, t = 0;
    q[t++] = i; lab[i] = id;
    while (h < t) {
      const c = q[h++];
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (g[ni] === FLOOR && lab[ni] < 0) { lab[ni] = id; q[t++] = ni; }
      }
    }
    sizes.push(t);
  }
  return { lab, sizes };
}

function connect(g, W, H, r) {
  for (let pass = 0; pass < 4; pass++) {
    const { lab, sizes } = regions(g, W, H);
    if (sizes.length <= 1) return;
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
    const mainCells = [];
    for (let i = 0; i < W * H; i++) if (lab[i] === main) mainCells.push(i);
    for (let id = 0; id < sizes.length; id++) {
      if (id === main) continue;
      const cells = [];
      for (let i = 0; i < W * H; i++) if (lab[i] === id) cells.push(i);
      if (sizes[id] < 5) { for (const c of cells) g[c] = WALL; continue; }
      const a = r.pick(cells);
      const ax = a % W, ay = (a / W) | 0;
      let best = mainCells[0], bd = 1e9;
      for (let k = 0; k < mainCells.length; k += 3) {
        const m = mainCells[k];
        const d = Math.abs((m % W) - ax) + Math.abs(((m / W) | 0) - ay);
        if (d < bd) { bd = d; best = m; }
      }
      carveLine(g, W, H, ax, ay, best % W, (best / W) | 0);
    }
  }
  const { lab, sizes } = regions(g, W, H);
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  for (let i = 0; i < W * H; i++) if (g[i] === FLOOR && lab[i] !== main) g[i] = WALL;
}

export function bfs(g, W, H, sx, sy) {
  const dist = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  const s = sy * W + sx;
  dist[s] = 0; q[t++] = s;
  while (h < t) {
    const c = q[h++];
    const x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const ni = (y + dy) * W + x + dx;
      if (g[ni] === FLOOR && dist[ni] < 0) { dist[ni] = dist[c] + 1; q[t++] = ni; }
    }
  }
  return dist;
}

export function generateMap(level, seed) {
  const r = new RNG(seed);
  const W = level.size, H = level.size;
  const g = GEN[level.gen](r, W, H);
  for (let x = 0; x < W; x++) { g[x] = WALL; g[(H - 1) * W + x] = WALL; }
  for (let y = 0; y < H; y++) { g[y * W] = WALL; g[y * W + W - 1] = WALL; }
  connect(g, W, H, r);

  const floors = [];
  for (let i = 0; i < W * H; i++) if (g[i] === FLOOR) floors.push(i);

  // spawn somewhere with breathing room
  let spawnI = r.pick(floors);
  for (let tries = 0; tries < 200; tries++) {
    const c = r.pick(floors), x = c % W, y = (c / W) | 0;
    let open = 0;
    for (const [dx, dy] of DIRS) if (g[(y + dy) * W + x + dx] === FLOOR) open++;
    if (open >= 2) { spawnI = c; break; }
  }
  const sx = spawnI % W, sy = (spawnI / W) | 0;
  const dist = bfs(g, W, H, sx, sy);

  // exit: far away, on a wall face
  let maxD = 0;
  for (const c of floors) if (dist[c] > maxD) maxD = dist[c];
  const far = floors.filter((c) => dist[c] >= maxD * 0.78);
  r.shuffle(far);
  let exit = null;
  for (const c of far) {
    const x = c % W, y = (c / W) | 0;
    const dirs = [];
    for (let d = 0; d < 4; d++) if (g[(y + DIRS[d][1]) * W + x + DIRS[d][0]] === WALL) dirs.push(d);
    if (dirs.length && dirs.length < 4) { exit = { x, y, dir: r.pick(dirs) }; break; }
  }
  if (!exit) {
    const c = far[0], x = c % W, y = (c / W) | 0;
    exit = { x, y, dir: 0 };
  }

  // lights
  const lights = [];
  const lt = level.light;
  if (lt.panel !== 'none') {
    const sp = lt.spacing, ox = r.int(0, sp - 1), oy = r.int(0, sp - 1);
    for (const c of floors) {
      const x = c % W, y = (c / W) | 0;
      const wx = g[y * W + x - 1] === WALL && g[y * W + x + 1] === WALL;
      const wy = g[(y - 1) * W + x] === WALL && g[(y + 1) * W + x] === WALL;
      const corridor = wx !== wy;
      const onGrid = (x - ox) % sp === 0 && (y - oy) % sp === 0;
      const onCorr = corridor && (x + y) % sp === 0;
      if (!onGrid && !onCorr) continue;
      let state = 0; // 0 dead, 1 on, 2 flickering
      if (r.chance(lt.chanceOn)) state = r.chance(lt.flicker) ? 2 : 1;
      lights.push({ x, y, state, seed: r.next() * 100 });
    }
  }

  // almond water and other pickups
  const items = [];
  const nItems = r.int(4, 8);
  for (let i = 0; i < nItems * 5 && items.length < nItems; i++) {
    const c = r.pick(floors);
    if (dist[c] < 6) continue;
    if (items.some((it) => it.cell === c)) continue;
    items.push({ id: items.length, cell: c, x: c % W, y: (c / W) | 0, type: r.chance(0.8) ? 'almond' : 'note', taken: false });
  }

  return { W, H, grid: g, cell: level.cell, wallH: level.wallH, spawn: { x: sx, y: sy }, exit, lights, items, dist, floors, maxD };
}

export function isWall(map, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= map.W || cy >= map.H) return true;
  return map.grid[cy * map.W + cx] === WALL;
}

// Grid line-of-sight in world units (x,z), using DDA.
export function lineOfSight(map, x0, z0, x1, z1) {
  const cs = map.cell;
  let cx = Math.floor(x0 / cs), cy = Math.floor(z0 / cs);
  const tx = Math.floor(x1 / cs), ty = Math.floor(z1 / cs);
  const dx = x1 - x0, dz = z1 - z0;
  const stepX = Math.sign(dx), stepY = Math.sign(dz);
  const tDX = stepX !== 0 ? Math.abs(cs / dx) : Infinity;
  const tDY = stepY !== 0 ? Math.abs(cs / dz) : Infinity;
  let tMaxX = stepX > 0 ? ((cx + 1) * cs - x0) / dx : stepX < 0 ? (cx * cs - x0) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((cy + 1) * cs - z0) / dz : stepY < 0 ? (cy * cs - z0) / dz : Infinity;
  for (let i = 0; i < 256; i++) {
    if (cx === tx && cy === ty) return true;
    if (tMaxX < tMaxY) { tMaxX += tDX; cx += stepX; } else { tMaxY += tDY; cy += stepY; }
    if (isWall(map, cx, cy)) return false;
  }
  return true;
}
