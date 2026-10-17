// Entities: a shared pool that can spawn on ANY level. The host simulates them; every client renders and voices them.
import { RNG } from './rng.js';
import { WALL, lineOfSight, bfs } from './mapgen.js';
import { ENTITY_SPRITES } from './sprites.js';

export const TYPES = {
  smiler:      { name: 'Smiler',       beh: 'darkLurker', h: 2.0, w: 1.7, speed: 1.6, chase: 6.2, sight: 16, weight: 10, emissive: 1.2, kill: 1.1 },
  hound:       { name: 'Hound',        beh: 'hunter',     h: 1.3, w: 1.35, speed: 2.0, chase: 6.6, sight: 20, hear: 1.4, weight: 10, peek: 0.35, kill: 1.0 },
  howler:      { name: 'Howler',       beh: 'stalker',    h: 2.9, w: 1.45, speed: 5.6, chase: 5.6, sight: 30, weight: 7, kill: 1.0 },
  partygoer:   { name: 'Partygoer',    beh: 'peeker',     h: 2.3, w: 1.15, speed: 2.4, chase: 6.2, sight: 22, weight: 9, peek: 1, charge: 0.7, kill: 1.0 },
  skinstealer: { name: 'Skin-Stealer', beh: 'mimic',      h: 2.0, w: 1.0, speed: 1.5, chase: 6.4, sight: 20, weight: 8, kill: 1.0 },
  faceling:    { name: 'Faceling',     beh: 'wanderer',   h: 1.9, w: 0.95, speed: 1.3, chase: 4.6, sight: 14, weight: 8, peek: 0.5, kill: 0.9 },
  clump:       { name: 'Clump',        beh: 'relentless', h: 1.6, w: 1.6, speed: 2.2, chase: 3.3, sight: 40, weight: 6, kill: 1.2 },
  deathmoth:   { name: 'Deathmoth',    beh: 'flyer',      h: 1.7, w: 2.2, speed: 2.0, chase: 5.4, sight: 22, weight: 6, kill: 1.3 },
  wretch:      { name: 'Wretch',       beh: 'hunter',     h: 1.75, w: 0.95, speed: 1.6, chase: 5.3, sight: 16, hear: 1.0, weight: 9, peek: 0.2, kill: 0.9 },
  pale:        { name: 'Pale Man',     beh: 'teleporter', h: 2.8, w: 1.4, speed: 0, chase: 0, sight: 30, weight: 5, kill: 1.0 },
  crawler:     { name: 'Crawler',      beh: 'ambusher',   h: 1.6, w: 1.4, speed: 3.0, chase: 6.8, sight: 12, weight: 6, kill: 1.0 },
  shadow:      { name: 'Shadow',       beh: 'peeker',     h: 2.0, w: 1.0, speed: 2.6, chase: 6.8, sight: 20, weight: 8, peek: 1, charge: 0.25, kill: 0.9 },
  hollow:      { name: 'Hollow',       beh: 'lightStalker', h: 2.0, w: 1.0, speed: 4.8, chase: 4.8, sight: 30, weight: 6, kill: 1.0 },
  screamer:    { name: 'Screamer',     beh: 'screamer',   h: 1.6, w: 1.6, speed: 0, chase: 0, sight: 30, weight: 4, kill: 0 },
};
export const TYPE_LIST = Object.keys(TYPES);
const SPRITE_INDEX = Object.fromEntries(ENTITY_SPRITES.map((n, i) => [n, i]));

// states that can kill on contact
const LETHAL = new Set(['hunt', 'charge', 'stalk', 'drop', 'close']);
const STATE_CODES = ['wander', 'hunt', 'search', 'peekMove', 'peek', 'retreat', 'idle', 'hidden', 'charge', 'stalk', 'frozen', 'ceiling', 'drop', 'watch', 'close', 'scare', 'disguise', 'reveal', 'flee', 'climb'];
const SC = Object.fromEntries(STATE_CODES.map((s, i) => [s, i]));
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let nextId = 1;

export class EntityManager {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.fields = new Map(); // player id -> {cell, dist}
    this.respawnTimer = 90;
    this.rng = new RNG(Date.now() & 0xffffffff);
  }

  get map() { return this.g.map; }

  reset() { this.list = []; this.fields.clear(); this.respawnTimer = 70 + Math.random() * 40; }

  // ------------- spawning (host) -------------
  spawnInitial(level, playerCount, cycle) {
    const r = this.rng;
    const n = r.int(level.ents[0], level.ents[1]) + Math.max(0, playerCount - 1) + Math.min(3, cycle);
    // guarantee variety: no more than 2 of one type
    const counts = {};
    for (let i = 0; i < n; i++) {
      let type;
      for (let k = 0; k < 10; k++) {
        type = r.weighted(TYPE_LIST.map((t) => [t, TYPES[t].weight]));
        if ((counts[type] || 0) < 2) break;
      }
      counts[type] = (counts[type] || 0) + 1;
      this.spawn(type);
    }
    if (level.danger >= 5) for (const e of this.list) if (TYPES[e.type].beh === 'hunter' || TYPES[e.type].beh === 'relentless') e.state = 'search';
  }

  spawnCell(minDist = 16) {
    const m = this.map, r = this.rng;
    const players = this.g.alivePlayers();
    for (let tries = 0; tries < 300; tries++) {
      const c = r.pick(m.floors);
      const x = c % m.W, y = (c / m.W) | 0;
      if (m.dist[c] >= 0 && m.dist[c] < 14 && this.g.levelTime < 5) continue;
      let ok = true;
      for (const p of players) {
        const px = Math.floor(p.x / m.cell), py = Math.floor(p.z / m.cell);
        if (Math.abs(px - x) + Math.abs(py - y) < minDist) { ok = false; break; }
        if (lineOfSight(m, p.x, p.z, (x + 0.5) * m.cell, (y + 0.5) * m.cell) && Math.hypot(p.x - (x + 0.5) * m.cell, p.z - (y + 0.5) * m.cell) < 30) { ok = false; break; }
      }
      if (ok) return c;
    }
    return r.pick(m.floors);
  }

  spawn(type, cell) {
    const m = this.map;
    const c = cell ?? this.spawnCell();
    const T = TYPES[type];
    const e = {
      id: nextId++, type, T,
      x: ((c % m.W) + 0.5) * m.cell, z: (((c / m.W) | 0) + 0.5) * m.cell, y: 0,
      state: 'wander', timer: 0, target: null, path: null, pathGoal: -1,
      lastSeen: null, lost: 0, peeks: 0, lean: 0, reveal: 0, visible: 1,
      cool: this.rng.range(5, 20), watched: 0, focus: null, moving: 0,
    };
    if (T.beh === 'mimic') e.state = 'disguise';
    if (T.beh === 'ambusher') { e.state = 'ceiling'; e.y = m.wallH; }
    if (T.beh === 'teleporter' || T.beh === 'screamer') { e.state = 'hidden'; e.visible = 0; }
    if (T.beh === 'flyer') e.y = Math.max(0.6, m.wallH - 2.0);
    if (T.beh === 'darkLurker' || T.beh === 'stalker' || T.beh === 'lightStalker') e.state = 'idle';
    this.list.push(e);
    return e;
  }

  // ------------- helpers -------------
  cellOf(x, z) { const m = this.map; return Math.floor(z / m.cell) * m.W + Math.floor(x / m.cell); }
  center(c) { const m = this.map; return [((c % m.W) + 0.5) * m.cell, (((c / m.W) | 0) + 0.5) * m.cell]; }
  isFloor(c) { return this.map.grid[c] !== WALL; }

  fieldFor(p) {
    const c = this.cellOf(p.x, p.z);
    let f = this.fields.get(p.id);
    if (!f || f.cell !== c) {
      if (!this.isFloor(c)) return f; // player inside wall edge; keep old
      f = { cell: c, dist: bfs(this.map.grid, this.map.W, this.map.H, c % this.map.W, (c / this.map.W) | 0) };
      this.fields.set(p.id, f);
    }
    return f;
  }

  stepDown(e, dist) {
    // move toward the neighbouring cell with the smallest distance
    const m = this.map, c = this.cellOf(e.x, e.z);
    let best = c, bd = dist[c] >= 0 ? dist[c] : 1e9;
    const cx = c % m.W, cy = (c / m.W) | 0;
    for (const [dx, dy] of DIRS) {
      const n = (cy + dy) * m.W + cx + dx;
      if (dist[n] >= 0 && dist[n] < bd) { bd = dist[n]; best = n; }
    }
    return best;
  }

  moveToward(e, tx, tz, speed, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const s = Math.min(d, speed * dt);
    const nx = e.x + (dx / d) * s, nz = e.z + (dz / d) * s;
    // keep off walls
    const m = this.map;
    if (m.grid[this.cellOf(nx, e.z)] !== WALL) e.x = nx;
    if (m.grid[this.cellOf(e.x, nz)] !== WALL) e.z = nz;
    e.moving = speed;
    e.dirX = dx / d;
    return d < 0.15;
  }

  // follow a distance field (to a player or a wander goal)
  follow(e, dist, speed, dt, finalX, finalZ) {
    const c = this.cellOf(e.x, e.z);
    if (dist[c] <= 0 && finalX !== undefined) return this.moveToward(e, finalX, finalZ, speed, dt);
    const n = this.stepDown(e, dist);
    const [tx, tz] = this.center(n);
    this.moveToward(e, tx, tz, speed, dt);
    return dist[c] <= 0;
  }

  setWanderGoal(e, radius = 14) {
    const m = this.map, r = this.rng;
    const c0 = this.cellOf(e.x, e.z), x0 = c0 % m.W, y0 = (c0 / m.W) | 0;
    for (let i = 0; i < 40; i++) {
      const x = x0 + r.int(-radius, radius), y = y0 + r.int(-radius, radius);
      if (x < 1 || y < 1 || x >= m.W - 1 || y >= m.H - 1) continue;
      const c = y * m.W + x;
      if (m.grid[c] === WALL) continue;
      if (e.T.beh === 'darkLurker' && this.lightLevel(c) > 0.12) continue;
      e.goal = c;
      e.goalDist = bfs(m.grid, m.W, m.H, x, y);
      return;
    }
    e.goal = null;
  }

  lightLevel(c) {
    const L = this.g.renderer ? this.g.renderer.cellLight : null;
    if (!L) return 0;
    return (L[c * 3] + L[c * 3 + 1] + L[c * 3 + 2]) * this.g.power;
  }

  inFlashlight(p, x, y, z) {
    if (!p.flashlight) return false;
    const dx = x - p.x, dy = y - (p.y ?? 1.6), dz = z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 20) return false;
    const fx = -Math.sin(p.yaw) * Math.cos(p.pitch), fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    if ((dx * fx + dy * fy + dz * fz) / d < 0.86) return false;
    return lineOfSight(this.map, p.x, p.z, x, z);
  }

  // is entity in this player's field of view with line of sight?
  seenBy(p, e, maxD = 40) {
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
    if (d > maxD) return false;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    if (d > 1.0 && (dx * fx + dz * fz) / d < 0.6) return false;
    if (!lineOfSight(this.map, p.x, p.z, e.x, e.z)) return false;
    // too dark to see? only matters far away
    const lit = this.lightLevel(this.cellOf(e.x, e.z)) > 0.05 || this.inFlashlight(p, e.x, 1.2, e.z) || e.T.emissive;
    return lit || d < 5;
  }

  canSeePlayer(e, p) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    let range = e.T.sight;
    const pc = this.cellOf(p.x, p.z);
    const lit = this.lightLevel(pc) > 0.08;
    if (!p.flashlight && !lit) range *= 0.4; // darkness hides you
    if (p.crouch) range *= 0.75;
    if (d > range) return false;
    return lineOfSight(this.map, e.x, e.z, p.x, p.z);
  }

  canHearPlayer(e, p) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    return d < (p.noise || 0) * (e.T.hear || 0.8);
  }

  nearestPlayer(e, filter) {
    let best = null, bd = 1e9;
    for (const p of this.g.alivePlayers()) {
      if (filter && !filter(p)) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) { bd = d; best = p; }
    }
    return [best, bd];
  }

  findPeekSpot(e, p) {
    // a hidden cell adjacent to a cell the player can see: standing on the border = half visible around a corner
    const m = this.map, cs = m.cell;
    const pcx = Math.floor(p.x / cs), pcy = Math.floor(p.z / cs);
    let best = null, bd = 1e9;
    const ec = this.cellOf(e.x, e.z);
    for (let tries = 0; tries < 80; tries++) {
      const x = pcx + this.rng.int(-7, 7), y = pcy + this.rng.int(-7, 7);
      if (x < 1 || y < 1 || x >= m.W - 1 || y >= m.H - 1) continue;
      const c = y * m.W + x;
      if (m.grid[c] === WALL) continue;
      const [cx, cz] = this.center(c);
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d < 7 || d > 20) continue;
      if (lineOfSight(m, p.x, p.z, cx, cz)) continue;
      for (const [dx, dy] of DIRS) {
        const n = (y + dy) * m.W + x + dx;
        if (m.grid[n] === WALL) continue;
        const [nx, nz] = this.center(n);
        if (!lineOfSight(m, p.x, p.z, nx, nz)) continue;
        const ex = cx + dx * cs * 0.42, ez = cz + dy * cs * 0.42;
        if (!lineOfSight(m, p.x, p.z, ex, ez)) continue;
        const pd = Math.abs((ec % m.W) - x) + Math.abs(((ec / m.W) | 0) - y);
        if (pd < bd) { bd = pd; best = { cell: c, ex, ez, dx, dy, hx: cx, hz: cz }; }
      }
    }
    return best;
  }

  goHunt(e, p, alert = true) {
    if (e.state !== 'hunt' && e.state !== 'charge' && alert) this.g.onEntityAlert(e);
    e.state = 'hunt'; e.focus = p.id; e.lost = 0; e.lastSeen = [p.x, p.z];
  }

  // ------------- simulation (host only) -------------
  update(dt) {
    const players = this.g.alivePlayers();
    if (!players.length) return;
    for (const e of this.list) {
      e.moving = 0;
      e.timer -= dt;
      e.cool -= dt;
      const fn = this['b_' + e.T.beh];
      if (fn) fn.call(this, e, dt, players);
      // contact kills
      if (LETHAL.has(e.state) && e.visible) {
        for (const p of players) {
          const d = Math.hypot(p.x - e.x, p.z - e.z);
          if (d < e.T.kill && Math.abs((p.y ?? 1.6) - 1.0 - e.y) < 2.5) { this.g.killPlayer(p, e); break; }
        }
      }
    }
    // rotate the roster now and then so new things show up
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      this.respawnTimer = 80 + this.rng.range(0, 60);
      const far = this.list.filter((e) => {
        const [, d] = this.nearestPlayer(e);
        return d > 30 && !players.some((p) => this.seenBy(p, e));
      });
      if (far.length) {
        const old = this.rng.pick(far);
        this.list.splice(this.list.indexOf(old), 1);
        this.spawn(this.rng.weighted(TYPE_LIST.map((t) => [t, TYPES[t].weight])));
      }
    }
  }

  wander(e, dt, speed) {
    if (!e.goal || e.timer <= 0) { this.setWanderGoal(e); e.timer = this.rng.range(6, 16); }
    if (!e.goal) return;
    if (this.follow(e, e.goalDist, speed, dt)) { e.goal = null; e.timer = this.rng.range(1, 4); e.state = e.state === 'search' ? 'wander' : e.state; }
  }

  chase(e, dt, players) {
    let p = players.find((q) => q.id === e.focus);
    if (!p) { [p] = this.nearestPlayer(e); e.focus = p && p.id; }
    if (!p) return;
    const sees = this.canSeePlayer(e, p);
    if (sees) { e.lastSeen = [p.x, p.z]; e.lost = 0; } else e.lost += dt;
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    const sp = e.T.chase * this.g.diff;
    if (sees && d < 10) this.moveToward(e, p.x, p.z, sp, dt);
    else { const f = this.fieldFor(p); if (f) this.follow(e, f.dist, sp, dt, p.x, p.z); }
    if (e.lost > (e.T.beh === 'relentless' ? 30 : 7)) { e.state = 'search'; e.goal = null; e.timer = 0; }
  }

  senseAny(e, players) {
    for (const p of players) if (this.canSeePlayer(e, p) || this.canHearPlayer(e, p)) return p;
    return null;
  }

  // --- behaviours ---
  b_hunter(e, dt, players) {
    if (e.state === 'hunt') return this.chase(e, dt, players);
    if (e.state === 'peekMove' || e.state === 'peek' || e.state === 'retreat') return this.peekLogic(e, dt, players, () => { this.goHunt(e, this.nearestPlayer(e)[0]); });
    const p = this.senseAny(e, players);
    if (p) {
      if (e.T.peek && this.rng.chance(e.T.peek * dt * 2) && e.peeks < 1 && Math.hypot(p.x - e.x, p.z - e.z) > 9) { e.state = 'peekMove'; e.focus = p.id; e.spot = null; return; }
      if (this.canSeePlayer(e, p) || this.rng.chance(dt * 1.5)) return this.goHunt(e, p);
    }
    this.wander(e, dt, e.T.speed * (e.state === 'search' ? 1.4 : 1));
  }

  b_relentless(e, dt, players) {
    const [p, d] = this.nearestPlayer(e);
    if (!p) return;
    if (e.state !== 'hunt' && (d < 45 || this.canHearPlayer(e, p))) this.goHunt(e, p);
    if (e.state === 'hunt') return this.chase(e, dt, players);
    this.wander(e, dt, e.T.speed);
  }

  b_wanderer(e, dt, players) {
    if (e.state === 'hunt') return this.chase(e, dt, players);
    if (e.state === 'peekMove' || e.state === 'peek' || e.state === 'retreat') return this.peekLogic(e, dt, players, () => { e.state = 'wander'; });
    // stare at it too long and it follows you
    for (const p of players) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < 8 && this.seenBy(p, e)) { e.watched += dt; if (e.watched > 3.5) return this.goHunt(e, p); }
    }
    e.watched = Math.max(0, e.watched - dt * 0.3);
    if (e.T.peek && e.cool <= 0 && this.rng.chance(dt * 0.1)) {
      const [p] = this.nearestPlayer(e);
      if (p) { e.state = 'peekMove'; e.focus = p.id; e.spot = null; e.cool = 25; return; }
    }
    this.wander(e, dt, e.T.speed);
  }

  b_peeker(e, dt, players) {
    if (e.state === 'hunt' || e.state === 'charge') return this.chase(e, dt, players);
    if (e.state === 'flee') {
      e.visible = Math.max(0, e.visible - dt * 2);
      if (e.visible <= 0) { const c = this.spawnCell(14); [e.x, e.z] = this.center(c); e.state = 'wander'; e.visible = 1; e.peeks = 0; e.cool = this.rng.range(10, 25); }
      return;
    }
    if (e.state === 'peekMove' || e.state === 'peek' || e.state === 'retreat') {
      return this.peekLogic(e, dt, players, () => {
        if (this.rng.chance(e.T.charge)) { const [p] = this.nearestPlayer(e); this.goHunt(e, p); e.state = 'charge'; }
        else e.state = 'flee';
      });
    }
    if (e.cool <= 0) {
      const [p, d] = this.nearestPlayer(e);
      if (p && d < 40) { e.state = 'peekMove'; e.focus = p.id; e.spot = null; return; }
    }
    this.wander(e, dt, e.T.speed);
  }

  peekLogic(e, dt, players, done) {
    const p = players.find((q) => q.id === e.focus) || this.nearestPlayer(e)[0];
    if (!p) return;
    const sp = e.T.speed * 2.2;
    if (e.state === 'peekMove') {
      if (!e.spot || e.timer <= 0) {
        e.spot = this.findPeekSpot(e, p); e.timer = 12;
        if (!e.spot) { e.state = 'wander'; e.cool = 8; return; }
        e.spotDist = bfs(this.map.grid, this.map.W, this.map.H, e.spot.cell % this.map.W, (e.spot.cell / this.map.W) | 0);
      }
      // abort if spotted on the way
      const at = this.follow(e, e.spotDist, sp, dt, e.spot.hx, e.spot.hz);
      if (at) { e.state = 'peek'; e.timer = this.rng.range(2.5, 5); e.watched = 0; this.g.onEntityPeek(e); }
      return;
    }
    if (e.state === 'peek') {
      // lean out to the edge of the corner
      this.moveToward(e, e.spot.ex, e.spot.ez, 1.2, dt);
      e.moving = 0;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (players.some((q) => this.seenBy(q, e))) e.watched += dt;
      if (e.watched > 0.9 || d < 5 || e.timer <= 0) { e.state = 'retreat'; e.timer = 1.5; e.peeks++; }
      return;
    }
    if (e.state === 'retreat') {
      this.moveToward(e, e.spot.hx - e.spot.dx * this.map.cell * 0.3, e.spot.hz - e.spot.dy * this.map.cell * 0.3, sp, dt);
      if (e.timer <= 0) {
        if (e.peeks >= this.rng.int(2, 4)) { e.peeks = 0; done(); }
        else { e.state = 'peekMove'; e.spot = null; }
      }
    }
  }

  b_stalker(e, dt, players) {
    // only moves when NO player is looking at it
    const watched = players.some((p) => this.seenBy(p, e, 45));
    const [p, d] = this.nearestPlayer(e);
    if (!p) return;
    if (watched) { if (e.state === 'stalk') this.g.onEntityFreeze(e); e.state = 'frozen'; return; }
    if (d < 40 || e.state === 'frozen') {
      e.state = 'stalk';
      const f = this.fieldFor(p);
      if (f) this.follow(e, f.dist, e.T.speed * this.g.diff, dt, p.x, p.z);
    } else this.wander(e, dt, 1.2);
  }

  b_lightStalker(e, dt, players) {
    // moves only while it is in darkness
    const c = this.cellOf(e.x, e.z);
    const lit = this.lightLevel(c) > 0.1 || players.some((p) => this.inFlashlight(p, e.x, 1.2, e.z));
    const [p, d] = this.nearestPlayer(e);
    if (!p) return;
    if (lit) { e.state = 'frozen'; return; }
    if (d < 35) {
      e.state = 'stalk';
      const f = this.fieldFor(p);
      if (f) this.follow(e, f.dist, e.T.speed * this.g.diff, dt, p.x, p.z);
    } else { e.state = 'idle'; this.wander(e, dt, 1.0); }
  }

  b_darkLurker(e, dt, players) {
    // attracted to flashlights; flees light; charges if you keep shining at it
    let attract = null;
    for (const p of players) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (p.flashlight && d < e.T.sight && lineOfSight(this.map, e.x, e.z, p.x, p.z)) attract = p;
      if (this.inFlashlight(p, e.x, 1.2, e.z)) { e.watched += dt; if (e.watched > 1.4) { this.goHunt(e, p); e.state = 'charge'; } }
    }
    if (e.state === 'charge' || e.state === 'hunt') {
      e.state = 'charge';
      const p = players.find((q) => q.id === e.focus);
      if (!p || (!p.flashlight && e.timer <= 0 && Math.hypot(p.x - e.x, p.z - e.z) > 5)) { e.state = 'wander'; e.watched = 0; return; }
      if (p.flashlight) e.timer = 3;
      return this.chase(e, dt, players);
    }
    e.watched = Math.max(0, e.watched - dt * 0.5);
    if (attract) {
      e.state = 'idle';
      const d = Math.hypot(attract.x - e.x, attract.z - e.z);
      if (d > 3) { const f = this.fieldFor(attract); if (f) this.follow(e, f.dist, e.T.speed, dt, attract.x, attract.z); }
      if (d < 4.5) { this.goHunt(e, attract); e.state = 'charge'; }
      return;
    }
    e.state = 'idle';
    this.wander(e, dt, e.T.speed * 0.6);
  }

  b_mimic(e, dt, players) {
    if (e.state === 'hunt') return this.chase(e, dt, players);
    if (e.state === 'reveal') { e.reveal = 1; if (e.timer <= 0) this.goHunt(e, this.nearestPlayer(e)[0], false); return; }
    // disguised: shuffle toward players like a lost wanderer
    const [p, d] = this.nearestPlayer(e);
    if (p && d < 7 && lineOfSight(this.map, e.x, e.z, p.x, p.z)) { e.state = 'reveal'; e.timer = 0.8; e.reveal = 1; this.g.onEntityAlert(e); return; }
    if (p && d < 30) { const f = this.fieldFor(p); if (f) this.follow(e, f.dist, e.T.speed, dt, p.x, p.z); }
    else this.wander(e, dt, e.T.speed);
  }

  b_flyer(e, dt, players) {
    const wy = Math.max(0.6, this.map.wallH - 2.0);
    if (e.state === 'hunt') {
      const p = players.find((q) => q.id === e.focus);
      e.y = Math.max(0, e.y - dt * 1.5);
      if (p && !p.flashlight && e.lost > 2) { e.state = 'wander'; }
      return this.chase(e, dt, players);
    }
    e.y += (wy - e.y) * Math.min(1, dt * 2);
    for (const p of players) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if ((p.flashlight && d < e.T.sight && lineOfSight(this.map, e.x, e.z, p.x, p.z)) || this.canHearPlayer(e, p)) return this.goHunt(e, p);
    }
    this.wander(e, dt, e.T.speed);
  }

  b_ambusher(e, dt, players) {
    const m = this.map;
    if (e.state === 'ceiling') {
      e.y = m.wallH;
      for (const p of players) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < 2.4) { e.state = 'drop'; e.timer = 0.45; this.g.onEntityAlert(e); return; }
      }
      // relocate unseen
      if (e.cool <= 0 && !players.some((p) => this.seenBy(p, e))) {
        e.cool = this.rng.range(20, 40);
        const [p] = this.nearestPlayer(e);
        if (p) {
          const f = this.fieldFor(p);
          // pick a corridor cell ~6-10 steps from player along their likely path
          const cands = this.map.floors.filter((c) => f.dist[c] >= 6 && f.dist[c] <= 12);
          if (cands.length) { const c = this.rng.pick(cands); const [x, z] = this.center(c); if (!players.some((q) => lineOfSight(m, q.x, q.z, x, z) && Math.hypot(q.x - x, q.z - z) < 14)) { e.x = x; e.z = z; } }
        }
      }
      return;
    }
    if (e.state === 'drop') { e.y = Math.max(0, e.y - dt * 9); if (e.timer <= 0) this.goHunt(e, this.nearestPlayer(e)[0], false); return; }
    if (e.state === 'hunt') {
      this.chase(e, dt, players);
      if (e.lost > 4) { e.state = 'climb'; e.timer = 1; }
      return;
    }
    if (e.state === 'climb' || e.state === 'wander') { e.y = Math.min(m.wallH, e.y + dt * 4); if (e.y >= m.wallH - 0.01) { e.state = 'ceiling'; e.cool = 3; } }
  }

  b_teleporter(e, dt, players) {
    const [p, d] = this.nearestPlayer(e);
    if (!p) return;
    if (e.state === 'hidden') {
      e.visible = 0;
      if (e.cool <= 0) {
        // appear somewhere behind or at the edge of view
        const spot = this.teleportSpot(p, e.closeness || 16);
        if (spot) { e.x = spot[0]; e.z = spot[1]; e.state = 'watch'; e.visible = 1; e.watched = 0; e.timer = this.rng.range(6, 12); }
        else e.cool = 3;
      }
      return;
    }
    if (e.state === 'watch') {
      e.visible = 1;
      const seen = players.some((q) => this.seenBy(q, e, 50));
      if (seen) { e.watched += dt; if (e.watched > 2.2) { e.state = 'hidden'; e.cool = this.rng.range(12, 25); e.closeness = Math.min(18, (e.closeness || 16) + 3); this.g.onEntityVanish(e); } }
      if (e.timer <= 0) {
        // you ignored it — next time it comes closer
        e.closeness = Math.max(2, (e.closeness || 16) - 6);
        e.state = 'hidden'; e.cool = this.rng.range(4, 9);
        if (e.closeness <= 2) { const s = this.teleportSpot(p, 1.6, true); if (s) { e.x = s[0]; e.z = s[1]; e.visible = 1; e.state = 'close'; e.timer = 1; } }
      }
      return;
    }
    if (e.state === 'close') { this.moveToward(e, p.x, p.z, 3, dt); if (e.timer <= -2) { e.state = 'hidden'; e.closeness = 16; e.cool = 20; } }
  }

  teleportSpot(p, dist, behind = false) {
    const m = this.map;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (let i = 0; i < 40; i++) {
      const a = behind ? Math.atan2(-fz, -fx) + this.rng.range(-0.6, 0.6) : this.rng.range(0, Math.PI * 2);
      const r = dist * this.rng.range(0.85, 1.2);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const c = this.cellOf(x, z);
      if (c < 0 || c >= m.W * m.H || m.grid[c] === WALL) continue;
      if (!lineOfSight(m, p.x, p.z, x, z)) continue;
      if (!behind) { const dot = ((x - p.x) * fx + (z - p.z) * fz) / r; if (dot > 0.5) continue; } // not directly in view: appear at the edge
      return [x, z];
    }
    return null;
  }

  b_screamer(e, dt, players) {
    if (e.state === 'scare') {
      if (e.timer <= 0) { e.state = 'hidden'; e.visible = 0; e.cool = this.rng.range(45, 90) / this.g.diff; }
      return;
    }
    e.visible = 0;
    if (e.cool > 0) return;
    const p = this.rng.pick(players);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (let k = 4.5; k >= 2.5; k -= 0.5) {
      const x = p.x + fx * k, z = p.z + fz * k;
      if (lineOfSight(this.map, p.x, p.z, x, z) && this.map.grid[this.cellOf(x, z)] !== WALL) {
        e.x = x; e.z = z; e.y = 0.4; e.state = 'scare'; e.timer = 1.1; e.visible = 1; e.focus = p.id;
        this.g.onScreamer(e, p);
        return;
      }
    }
    e.cool = 5;
  }

  // ------------- network -------------
  snapshot() {
    return this.list.map((e) => [e.id, TYPE_LIST.indexOf(e.type), Math.round(e.x * 100), Math.round(e.z * 100), Math.round(e.y * 100), SC[e.state] ?? 0, e.reveal ? 1 : 0, Math.round(e.visible * 100), e.focus || 0, e.moving ? 1 : 0, e.spot && e.state === 'peek' ? Math.round(Math.atan2(e.spot.dy, e.spot.dx) * 100) : -999]);
  }

  applySnapshot(arr) {
    const seen = new Set();
    for (const a of arr) {
      const [id, ti, x, z, y, sc, reveal, vis, focus, moving, peekDir] = a;
      seen.add(id);
      let e = this.list.find((q) => q.id === id);
      const type = TYPE_LIST[ti];
      if (!e) { e = { id, type, T: TYPES[type], x: x / 100, z: z / 100, y: y / 100, rx: x / 100, rz: z / 100, ry: y / 100 }; this.list.push(e); }
      e.tx = x / 100; e.tz = z / 100; e.ty = y / 100;
      const ns = STATE_CODES[sc];
      if (e.state !== ns) this.onRemoteState(e, e.state, ns);
      e.state = ns; e.reveal = reveal; e.visible = vis / 100; e.focus = focus; e.moving = moving;
      e.peekAng = peekDir === -999 ? null : peekDir / 100;
    }
    this.list = this.list.filter((e) => seen.has(e.id));
  }

  onRemoteState(e, from, to) {
    if (to === 'hunt' && from !== 'charge' && from !== 'reveal' && from !== 'drop') this.g.onEntityAlert(e, true);
    if (to === 'charge' || to === 'reveal' || to === 'drop') this.g.onEntityAlert(e, true);
    if (to === 'peek') this.g.onEntityPeek(e, true);
    if (to === 'scare') this.g.onScreamerRemote(e);
  }

  // host migration: turn mirrored entities into simulated ones
  adoptAsHost() {
    for (const e of this.list) {
      Object.assign(e, { timer: 0, cool: 5, goal: null, spot: null, lost: 0, peeks: 0, watched: 0, lastSeen: null });
      if (e.tx !== undefined) { e.x = e.tx; e.z = e.tz; e.y = e.ty; }
      if (e.state === 'peek' || e.state === 'peekMove' || e.state === 'retreat') e.state = 'wander';
      e.tx = undefined;
    }
    let max = 0; for (const e of this.list) max = Math.max(max, e.id);
    nextId = max + 1;
  }

  // smooth remote positions
  interpolate(dt) {
    const k = Math.min(1, dt * 12);
    for (const e of this.list) {
      if (e.tx === undefined) continue;
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 6) { e.x = e.tx; e.z = e.tz; }
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.y += (e.ty - e.y) * k;
    }
  }

  // ------------- presentation -------------
  sprites(time, cam) {
    const out = [];
    for (const e of this.list) {
      if (e.visible <= 0.02) continue;
      const T = e.T;
      const idx = SPRITE_INDEX[e.type];
      const walking = e.moving || ['hunt', 'charge', 'stalk'].includes(e.state);
      let frame = walking ? Math.floor(time * (e.state === 'hunt' || e.state === 'charge' ? 7 : 3.5)) % 2 : 0;
      if (e.type === 'skinstealer') frame = e.reveal ? 1 : 0;
      if (e.type === 'smiler') frame = e.state === 'charge' ? 1 : 0;
      if (e.type === 'hollow') frame = e.state === 'stalk' ? 1 : 0;
      let lean = 0;
      if (e.state === 'peek') {
        // lean toward the open side as seen by the camera
        const ang = e.peekAng ?? (e.spot ? Math.atan2(e.spot.dy, e.spot.dx) : null);
        if (ang !== null && ang !== undefined) {
          const ox = Math.cos(ang), oz = Math.sin(ang);
          const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
          lean = -(ox * rx + oz * rz) * 0.32;
        }
      }
      const h = e.type === 'skinstealer' && e.reveal ? 2.3 : T.h;
      const w = e.type === 'skinstealer' && e.reveal ? 1.15 : T.w;
      const ceiling = e.type === 'crawler' && e.y > 0.3;
      const bob = e.type === 'deathmoth' ? Math.sin(time * 9 + e.id) * 0.08 : 0;
      const glitch = e.type === 'shadow' || e.type === 'screamer' || e.type === 'pale' ? 0.6 + Math.sin(time * 3 + e.id) * 0.4 : 0;
      out.push({
        x: e.x, z: e.z, y: ceiling ? e.y : e.y + bob, w, h, slot: idx * 2 + frame, emissive: T.emissive ?? 1, alpha: e.visible, glitch, lean, ceiling, ent: e,
        tint: e.type === 'skinstealer' && !e.reveal ? 0.85 : 1,
      });
    }
    return out;
  }

  // the most threatening thing near a position (for fear/music)
  threatFor(p) {
    let fear = 0, chase = 0, nearest = 1e9;
    for (const e of this.list) {
      if (e.visible < 0.3 && e.state === 'hidden') continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      nearest = Math.min(nearest, d);
      const los = d < 30 && lineOfSight(this.map, p.x, p.z, e.x, e.z);
      const hostile = LETHAL.has(e.state) || e.state === 'reveal';
      let f = Math.max(0, 1 - d / (los ? 22 : 12)) * (hostile ? 1 : 0.45);
      if (hostile && e.focus === p.id) chase = Math.max(chase, Math.max(0.35, 1 - d / 30));
      fear = Math.max(fear, f);
    }
    return { fear, chase, nearest };
  }
}
