import { LEVELS, LEVEL_COUNT } from './levels.js';
import { generateMap, lineOfSight, WALL } from './mapgen.js';
import { hash2, RNG } from './rng.js';
import { Renderer, forwardVec } from './renderer.js';
import { AudioEngine } from './audio.js';
import { EntityManager, TYPES, TYPE_LIST } from './entities.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { SLOT, drawJumpscare, ENTITY_SPRITES } from './sprites.js';
import { DEFAULT_SERVER } from './config.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PLAYER_R = 0.28;

const NOTES = [
  'Day 3. The hum never stops. I tried counting the lights to stay sane. I stopped at four thousand.',
  "If you see someone you know, don't wave. Check their hands first. Count the fingers.",
  'The grinning ones in the dark come TO the light. Turn your flashlight off. Turn it OFF.',
  "Almond water helps. Don't ask what's in it. Don't ask who leaves it here.",
  'Every exit leads deeper. I stopped looking for a way out and started looking for a way through.',
  "The tall one only moves when nobody is looking. So look. Walk backwards if you have to.",
  'Something laughed at me from behind a pillar. When I checked, there was a balloon string on the carpet.',
  "If you hear clicking above you, don't walk under it. Look up.",
  'The mannequins only move in the dark. Keep a light on them and back away.',
  "I found my own handwriting on these walls. I don't remember writing it.",
  'Running is loud. They hear it rooms away. Crouch when you can.',
  'If every light goes out at once, stop. Breathe. Listen.',
  "Some of them peek around corners. If it's peeking, it hasn't decided yet. Don't help it decide.",
  'The pale man gets closer every time you ignore him. Stare him down until he leaves.',
  'Level 37 felt safe. That is how I knew it was not.',
  'Whatever you do, do not run straight at the ones with no face. Just walk. Just walk.',
];

const COLORS = ['#e8c547', '#5fb3e8', '#e86a5f', '#7fd67a', '#c58be8', '#e8a35f', '#5fe8d0', '#e85fa8'];

class Game {
  constructor() {
    this.canvas = $('gl');
    this.settings = Object.assign({ sens: 1, vol: 0.85, scale: matchMedia('(pointer: coarse)').matches ? 0.6 : 0.85, fov: 78, server: '', name: '', fps: false, unlocked: 0 }, JSON.parse(localStorage.getItem('br_settings') || '{}'));
    try { this.renderer = new Renderer(this.canvas); } catch (e) { $('loading').textContent = 'Error: ' + e.message; throw e; }
    this.renderer.setScale(this.settings.scale);
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.vol;
    this.input = new Input(this.canvas, {
      stick: $('stick'), knob: $('knob'), touchZone: $('touchZone'),
      bFlash: $('bFlash'), bUse: $('bUse'), bDrink: $('bDrink'), bSprint: $('bSprint'), bCrouch: $('bCrouch'), bPause: $('bPause'),
    });
    this.input.sens = this.settings.sens;
    this.entities = new EntityManager(this);
    this.net = null;
    this.mode = 'menu'; // menu | play | dead | paused
    this.remotes = new Map();
    this.local = this.newPlayer('me', this.settings.name || 'Wanderer');
    this.levelIdx = 0;
    this.cycle = 0;
    this.attempt = 0;
    this.time = 0;
    this.power = 1; this.powerTarget = 1; this.blackoutTimer = 120;
    this.hallucinations = [];
    this.halluTimer = 20;
    this.fear = 0; this.damage = 0; this.glitch = 0; this.blink = 0;
    this.scare = null;
    this.flashDir = [0, 0, -1];
    this.netTimer = 0; this.entTimer = 0; this.itemSync = 0;
    this.diff = 1;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsShow = 0; this.slowFrames = 0;
    this.noclipPush = 0;
    this.bindUI();
    if (this.input.touch) document.body.classList.add('touch');
    $('loading').style.display = 'none';
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play' && !this.net) this.pause(); });
  }

  newPlayer(id, name) {
    return { id, name, x: 0, z: 0, y: 1.62, yaw: 0, pitch: 0, flashlight: true, crouch: false, noise: 0, alive: true, sanity: 100, stamina: 1, almond: 0, bob: 0, speed: 0, color: COLORS[0], rx: 0, rz: 0 };
  }

  save() { localStorage.setItem('br_settings', JSON.stringify(this.settings)); }

  serverUrl() {
    if (this.settings.server) return this.settings.server;
    const isApp = location.protocol === 'capacitor:' || !!window.Capacitor || location.protocol === 'file:';
    return isApp ? DEFAULT_SERVER : location.origin;
  }

  // ---------------- UI ----------------
  bindUI() {
    const s = this.settings;
    $('nameInput').value = s.name;
    $('nameInput').oninput = (e) => { s.name = e.target.value.slice(0, 16); this.local.name = s.name || 'Wanderer'; this.save(); };
    const go = (fn) => () => { this.audio.init(); fn(); };
    $('btnSolo').onclick = go(() => this.panel('pSolo'));
    $('btnHost').onclick = go(() => this.panel('pHost'));
    $('btnJoin').onclick = go(() => this.panel('pJoin'));
    $('btnSettings').onclick = go(() => this.panel('pSettings'));
    $('btnHelp').onclick = go(() => this.panel('pHelp'));
    document.querySelectorAll('.back').forEach((b) => (b.onclick = () => this.panel('pMain')));
    $('btnHostGo').onclick = go(() => this.hostCoop(+$('hostLevel').value || 0));
    $('btnJoinGo').onclick = go(() => this.joinCoop($('joinCode').value.trim().toUpperCase()));
    $('joinCode').oninput = (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5));
    // settings
    const bindRange = (id, key, fmt, apply) => {
      const el = $(id), lab = $(id + 'V');
      el.value = s[key]; lab.textContent = fmt(s[key]);
      el.oninput = () => { s[key] = +el.value; lab.textContent = fmt(s[key]); apply && apply(s[key]); this.save(); };
    };
    bindRange('sSens', 'sens', (v) => v.toFixed(2), (v) => (this.input.sens = v));
    bindRange('sVol', 'vol', (v) => Math.round(v * 100) + '%', (v) => this.audio.setVolume(v));
    bindRange('sScale', 'scale', (v) => Math.round(v * 100) + '%', (v) => this.renderer.setScale(v));
    bindRange('sFov', 'fov', (v) => v + '°');
    $('sServer').value = s.server;
    $('sServer').placeholder = this.serverUrl();
    $('sServer').oninput = (e) => { s.server = e.target.value.trim(); this.save(); };
    $('sFps').checked = s.fps;
    $('sFps').onchange = (e) => { s.fps = e.target.checked; this.save(); };
    // level select (unlocked levels)
    this.buildLevelSelect();
    // pause / death
    $('btnResume').onclick = () => this.resume();
    $('btnPauseSettings').onclick = () => { $('pause').classList.add('hidden'); this.showMenu(); this.panel('pSettings'); this.settingsFromPause = true; };
    $('btnQuit').onclick = () => this.quitToMenu();
    $('btnRetry').onclick = () => { $('death').classList.add('hidden'); this.attempt++; this.loadLevel(this.levelIdx, this.levelSeed(this.levelIdx)); this.mode = 'play'; this.input.lock(); };
    $('btnDeathMenu').onclick = () => this.quitToMenu();
    $('noteClose').onclick = () => { $('note').classList.add('hidden'); if (this.mode === 'play') this.input.lock(); };
    $('copyCode').onclick = () => { if (this.net && this.net.code) navigator.clipboard?.writeText(this.net.code); this.toast('Room code copied'); };
    addEventListener('resize', () => this.renderer.resize());
  }

  buildLevelSelect() {
    const grid = $('levelGrid'), sel = $('hostLevel');
    grid.innerHTML = ''; sel.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const unlocked = i <= this.settings.unlocked;
      const b = document.createElement('button');
      b.className = 'lvl' + (unlocked ? '' : ' locked');
      b.innerHTML = `<b>${i}</b><span>${unlocked ? lv.sub : '???'}</span>`;
      b.disabled = !unlocked;
      b.onclick = () => { this.audio.init(); this.startSolo(i); };
      grid.appendChild(b);
      if (unlocked) { const o = document.createElement('option'); o.value = i; o.textContent = `${lv.name} — ${lv.sub}`; sel.appendChild(o); }
    });
  }

  panel(id) {
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== id));
    if (id === 'pMain' && this.settingsFromPause) { this.settingsFromPause = false; this.hideMenu(); this.pause(); }
  }
  showMenu() { $('menu').classList.remove('hidden'); this.panel('pMain'); $('hud').classList.add('hidden'); document.body.classList.remove('playing'); }
  hideMenu() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); document.body.classList.add('playing'); }

  toast(text, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 600);
  }

  // ---------------- game flow ----------------
  levelSeed(idx) { return hash2(this.runSeed, idx * 7919 + this.attempt * 104729 + this.cycle * 31337); }

  keepAwake() { try { navigator.wakeLock?.request('screen').catch(() => {}); } catch (e) { /* unsupported */ } }

  startSolo(idx) {
    this.closeNet();
    this.keepAwake();
    this.runSeed = (Math.random() * 2 ** 32) >>> 0;
    this.cycle = 0; this.attempt = 0;
    this.local = this.newPlayer('me', this.settings.name || 'Wanderer');
    this.loadLevel(idx, this.levelSeed(idx));
    this.hideMenu();
    this.mode = 'play';
    this.input.lock();
  }

  get isHost() { return !this.net || this.net.isHost; }

  async connectNet(msg) {
    this.closeNet();
    const els = [$('netStatus'), $('netStatus2')];
    const status = { set textContent(v) { els.forEach((e) => (e.textContent = v)); } };
    status.textContent = 'Waking the co-op server… (free servers can take up to a minute)';
    const base = this.serverUrl();
    if (!base || base.includes('YOUR-APP-NAME')) { status.textContent = 'Set your Render server URL in Settings first.'; return false; }
    const ok = await Net.wake(base, (s) => (status.textContent = `Waking the co-op server… ${s}s`));
    if (!ok) { status.textContent = 'Server did not respond. Check the URL in Settings.'; return false; }
    this.net = new Net((m) => this.onNet(m), (st) => { if (st === 'closed' && this.mode !== 'menu') this.toast('Disconnected from server', 5000); });
    try { await this.net.connect(base); } catch (e) { status.textContent = e.message; this.net = null; return false; }
    status.textContent = 'Connected.';
    this.net.send(msg);
    return true;
  }

  async hostCoop(level) {
    this.pendingLevel = level;
    this.runSeed = (Math.random() * 2 ** 32) >>> 0;
    await this.connectNet({ t: 'create', name: this.local.name, seed: this.runSeed, level });
  }
  async joinCoop(code) {
    if (code.length < 4) { $('netStatus2').textContent = 'Enter the 5-character room code.'; return; }
    await this.connectNet({ t: 'join', code, name: this.local.name });
  }

  closeNet() { if (this.net) this.net.close(); this.net = null; this.remotes.clear(); $('room').classList.add('hidden'); }

  quitToMenu() {
    this.closeNet();
    this.mode = 'menu';
    this.audio.stopAmbience(); this.audio.setChase(0);
    ['pause', 'death', 'note'].forEach((id) => $(id).classList.add('hidden'));
    this.input.unlock(); this.input.enabled = false;
    this.buildLevelSelect();
    this.showMenu();
  }

  pause() {
    if (this.mode !== 'play') return;
    if (!this.net) this.mode = 'paused';
    this.pausedOverlay = true;
    $('pause').classList.remove('hidden');
    this.input.unlock();
    this.audio.setChase(0);
  }
  resume() {
    $('pause').classList.add('hidden');
    this.pausedOverlay = false;
    if (this.mode === 'paused') this.mode = 'play';
    this.input.state(); // drop inputs queued while paused
    this.input.lock();
  }

  loadLevel(idx, seed) {
    this.levelIdx = idx;
    this.seed = seed;
    const level = (this.level = LEVELS[idx]);
    const t0 = performance.now();
    this.map = generateMap(level, seed);
    this.renderer.buildLevel(this.map, level, seed);
    this.entities.reset();
    this.levelTime = 0;
    this.diff = 1 + this.cycle * 0.15 + level.danger * 0.03;
    const items = new RNG(seed ^ 0xabc);
    this.items = this.map.items.map((it) => ({ ...it, ox: items.range(-0.6, 0.6), oz: items.range(-0.6, 0.6) }));
    this.power = 1; this.powerTarget = 1; this.blackoutTimer = 80 + Math.random() * 100;
    this.hallucinations = [];
    this.respawnAt = 0;
    this.spawnLocal();
    if (this.isHost) this.entities.spawnInitial(level, 1 + this.remotes.size, this.cycle);
    this.audio.setLevel(level);
    this.titleCard(level);
    this.input.enabled = true;
    $('room').classList.toggle('hidden', !this.net);
    if (idx > this.settings.unlocked) { this.settings.unlocked = idx; this.save(); }
    console.log(`Level ${idx} built in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  spawnLocal() {
    const m = this.map, cs = m.cell, p = this.local;
    p.x = (m.spawn.x + 0.5) * cs + (Math.random() - 0.5) * 0.4;
    p.z = (m.spawn.y + 0.5) * cs + (Math.random() - 0.5) * 0.4;
    p.alive = true; p.sanity = Math.max(p.sanity, 70); p.stamina = 1;
    // face the most open direction
    let best = 0, bestLen = -1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      let len = 0;
      while (len < 20 && m.grid[Math.floor((p.z - Math.cos(a) * len) / cs) * m.W + Math.floor((p.x - Math.sin(a) * len) / cs)] !== WALL) len += 0.5;
      if (len > bestLen) { bestLen = len; best = a; }
    }
    p.yaw = best; p.pitch = 0;
    this.flashDir = forwardVec(p.yaw, p.pitch);
  }

  titleCard(level) {
    const el = $('title');
    $('titleA').textContent = level.name.toUpperCase();
    $('titleB').textContent = level.sub;
    $('titleC').textContent = level.desc;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    this.blink = 1;
  }

  nextLevel() {
    if (!this.isHost) { this.net.send({ t: 'ev', k: 'exitReq' }); return; }
    let idx = this.levelIdx + 1;
    if (idx >= LEVEL_COUNT) { idx = 0; this.cycle++; this.toast(`You found the way back to the start... it is not the way out. Cycle ${this.cycle + 1}.`, 6000); }
    this.attempt = 0;
    this.goLevel(idx, this.levelSeed(idx));
  }

  goLevel(idx, seed) {
    this.audio.transition();
    this.blink = 1;
    $('fade').classList.add('on');
    if (this.net && this.isHost) this.net.send({ t: 'ev', k: 'level', level: idx, lseed: seed, cycle: this.cycle });
    setTimeout(() => { this.loadLevel(idx, seed); $('fade').classList.remove('on'); }, 900);
  }

  // ---------------- network ----------------
  onNet(m) {
    switch (m.t) {
      case 'room': {
        this.remotes.clear();
        m.players.forEach((p, i) => { if (p.id !== m.you) this.addRemote(p.id, p.name, i); });
        this.local.id = m.you;
        this.local.color = COLORS[m.players.findIndex((p) => p.id === m.you) % COLORS.length];
        this.runSeed = m.seed; this.cycle = m.cycle || 0;
        $('roomCode').textContent = m.code;
        this.hideMenu();
        this.keepAwake();
        this.mode = 'play';
        this.local.alive = true;
        if (m.lseed) this.loadLevel(m.level, m.lseed);
        else { this.attempt = 0; const idx = m.level || 0; const s = this.levelSeed(idx); this.loadLevel(idx, s); this.net.send({ t: 'ev', k: 'level', level: idx, lseed: s, cycle: this.cycle }); }
        this.toast(this.net.isHost ? `Room ${m.code} created — share the code` : `Joined room ${m.code}`, 5000);
        this.input.lock();
        this.updateRoster();
        break;
      }
      case 'join': this.addRemote(m.id, m.name, this.remotes.size + 1); this.toast(`${m.name} joined`); this.updateRoster(); break;
      case 'leave': { const r = this.remotes.get(m.id); this.remotes.delete(m.id); if (r) this.toast(`${r.name} left`); this.updateRoster(); break; }
      case 'host':
        if (m.id === this.local.id) { this.toast('You are now the host'); this.entities.adoptAsHost && this.entities.adoptAsHost(); }
        this.updateRoster();
        break;
      case 'st': {
        const r = this.remotes.get(m.from);
        if (!r) break;
        Object.assign(r, { x: m.x, z: m.z, y: m.y, yaw: m.yaw, pitch: m.pitch, flashlight: !!m.fl, crouch: !!m.cr, noise: m.n, alive: !!m.a, sanity: m.s, moving: m.mv });
        if (!r.seen) { r.rx = r.x; r.rz = r.z; r.seen = true; }
        break;
      }
      case 'ent':
        if (!this.isHost) { this.entities.applySnapshot(m.s); this.powerTarget = m.pw; }
        break;
      case 'ev': this.onEvent(m); break;
      case 'err': $('netStatus').textContent = m.msg; $('netStatus2').textContent = m.msg; this.toast(m.msg, 5000); if (this.mode === 'menu') this.closeNet(); break;
      default: break;
    }
  }

  addRemote(id, name, i) {
    const p = this.newPlayer(id, name);
    p.color = COLORS[i % COLORS.length];
    p.seen = false;
    this.remotes.set(id, p);
  }

  updateRoster() {
    if (!this.net) return;
    const list = [`<li style="color:${this.local.color}">${esc(this.local.name)} (you)${this.net.isHost ? ' ★' : ''}</li>`];
    for (const r of this.remotes.values()) list.push(`<li style="color:${r.color}">${esc(r.name)}${r.alive ? '' : ' ✝'}</li>`);
    $('roster').innerHTML = list.join('');
  }

  onEvent(m) {
    switch (m.k) {
      case 'level':
        if (m.from === this.local.id) break;
        this.cycle = m.cycle || 0;
        this.goLevel(m.level, m.lseed);
        break;
      case 'kill':
        if (m.target === this.local.id && this.local.alive) this.die(m.et);
        else { const r = this.remotes.get(m.target); if (r) { r.alive = false; this.toast(`${r.name} was taken by the ${TYPES[m.et]?.name || 'dark'}`); this.updateRoster(); } }
        break;
      case 'take': { const it = this.items && this.items.find((i) => i.id === m.id); if (it) it.taken = true; break; }
      case 'items': if (this.items) for (const id of m.taken) { const it = this.items.find((i) => i.id === id); if (it) it.taken = true; } break;
      case 'exitReq': if (this.isHost) this.nextLevel(); break;
      default: break;
    }
  }

  alivePlayers() {
    const out = [];
    if (this.local.alive && this.mode !== 'menu') out.push(this.local);
    for (const r of this.remotes.values()) if (r.alive && r.seen) out.push(r);
    return out;
  }

  // ---------------- entity callbacks ----------------
  killPlayer(p, e) {
    // entity backs off after a kill
    e.state = e.T.beh === 'teleporter' || e.T.beh === 'screamer' ? 'hidden' : e.T.beh === 'ambusher' ? 'climb' : 'search';
    e.goal = null; e.timer = 0; e.cool = 15;
    if (p === this.local) this.die(e.type);
    else {
      p.alive = false;
      this.net && this.net.send({ t: 'ev', k: 'kill', target: p.id, et: e.type });
      this.toast(`${p.name} was taken by the ${e.T.name}`);
      this.updateRoster();
    }
  }

  entOccluded(e) { return !lineOfSight(this.map, this.local.x, this.local.z, e.x, e.z); }

  onEntityAlert(e) {
    const d = Math.hypot(e.x - this.local.x, e.z - this.local.z);
    if (d < 40) this.audio.voice(e.type, [e.x, 1.4, e.z], 'alert', this.entOccluded(e));
    if (d < 18 && !this.entOccluded(e)) { this.audio.stinger(); this.glitch = Math.max(this.glitch, 0.5); this.local.sanity -= 4; }
  }
  onEntityPeek(e) {
    const d = Math.hypot(e.x - this.local.x, e.z - this.local.z);
    if (d < 30 && Math.random() < 0.6) this.audio.voice(e.type, [e.x, 1.4, e.z], 'idle', true);
  }
  onEntityFreeze() { /* the stalker stopped because someone looked: silence is scarier */ }
  onEntityVanish(e) { this.audio.event('whisper', [e.x, 1.6, e.z]); this.glitch = 0.6; this.local.sanity -= 3; }
  onScreamer(e, p) { if (p === this.local) this.screamerHit(e); }
  onScreamerRemote(e) { if (e.focus === this.local.id) this.screamerHit(e); }
  screamerHit(e) {
    this.audio.voice('screamer', [e.x, 1.4, e.z], 'alert');
    this.glitch = 1; this.damage = 1;
    this.local.sanity -= 28;
    if (this.local.sanity <= 0) this.die('screamer');
  }

  // ---------------- death ----------------
  die(type) {
    if (!this.local.alive) return;
    this.local.alive = false;
    this.audio.jumpscare(type);
    this.scare = { type, t: 0 };
    $('scare').classList.remove('hidden');
    if (!this.net) this.input.unlock();
    this.sendState(true);
    setTimeout(() => {
      this.scare = null;
      $('scare').classList.add('hidden');
      const name = TYPES[type]?.name || 'the dark';
      if (!this.net) {
        this.mode = 'dead';
        $('deathText').textContent = type === 'screamer' && this.local.sanity <= 0 ? 'Your mind gave in.' : `You were taken by the ${name}.`;
        $('deathSub').textContent = `${this.level.name} — ${this.level.sub}`;
        $('btnRetry').classList.remove('hidden');
        $('death').classList.remove('hidden');
        this.audio.setChase(0);
      } else {
        this.respawnAt = this.time + 10;
        this.toast(`You were taken by the ${name}. Respawning...`, 4000);
      }
    }, 1500);
  }

  // ---------------- main loop ----------------
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const now = t / 1000;
    const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
    this.lastT = now;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fpsShow = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0;
      // automatic quality drop on slow phones
      if (this.mode === 'play' && this.fpsShow < 28 && this.settings.scale > 0.45) { this.slowFrames++; if (this.slowFrames > 6) { this.settings.scale = Math.max(0.45, this.settings.scale - 0.1); this.renderer.setScale(this.settings.scale); this.slowFrames = 0; this.save(); } } else this.slowFrames = 0;
    }
    if (this.mode === 'menu') { this.menuFrame(dt); return; }
    if (this.mode === 'play' || (this.mode === 'dead' && this.net)) this.update(dt);
    this.draw(dt);
  }

  menuFrame(dt) {
    // slowly drift through a lobby as the menu background
    this.time += dt;
    if (!this.map || this.menuLevel === undefined) {
      this.menuLevel = 0;
      this.runSeed = 12345; this.attempt = 0; this.cycle = 0;
      this.level = LEVELS[0];
      this.map = generateMap(this.level, 777);
      this.renderer.buildLevel(this.map, this.level, 777);
      this.spawnLocal();
    }
    const p = this.local;
    p.yaw += dt * 0.05;
    p.pitch = Math.sin(this.time * 0.3) * 0.05;
    this.draw(dt, true);
  }

  update(dt) {
    this.time += dt;
    this.levelTime += dt;
    const inp = this.input.state();
    const p = this.local;
    const noteOpen = !$('note').classList.contains('hidden');
    if (inp.pressed.has('pause')) { if (noteOpen) { $('note').classList.add('hidden'); this.input.lock(); } else this.pause(); }
    else if (inp.pressed.has('unlock') && !noteOpen && p.alive) this.pause();

    if (p.alive) this.updatePlayer(dt, inp);
    else if (this.net && this.respawnAt && this.time > this.respawnAt) {
      if (this.alivePlayers().length || !this.isHost) { this.spawnLocal(); this.toast('You wake up where you started.'); this.respawnAt = 0; this.input.lock(); }
    }
    // co-op: everyone dead -> host restarts the level with a fresh layout
    if (this.net && this.isHost && !this.alivePlayers().length && !this.restarting && this.levelTime > 3) {
      this.restarting = true;
      setTimeout(() => { this.restarting = false; this.attempt++; this.toast('Everyone was taken. The level shifts...', 4000); this.goLevel(this.levelIdx, this.levelSeed(this.levelIdx)); }, 3500);
    }

    // remote interpolation
    for (const r of this.remotes.values()) {
      const k = Math.min(1, dt * 10);
      if (Math.hypot(r.x - r.rx, r.z - r.rz) > 5) { r.rx = r.x; r.rz = r.z; }
      const px = r.rx, pz = r.rz;
      r.rx += (r.x - r.rx) * k; r.rz += (r.z - r.rz) * k;
      const moved = Math.hypot(r.rx - px, r.rz - pz);
      r.stepAcc = (r.stepAcc || 0) + moved;
      if (r.stepAcc > (r.noise > 10 ? 1.6 : 1.1)) { r.stepAcc = 0; if (!r.crouch) this.audio.footstep(this.level.surface, 0.8, [r.rx, 0.1, r.rz]); }
    }

    // entities: host simulates, everyone presents
    if (this.isHost) {
      this.entities.update(dt);
      this.blackouts(dt);
    } else this.entities.interpolate(dt);
    this.presentEntities(dt);
    this.updateHallucinations(dt);

    // power smoothing with flicker on transitions
    const pdiff = this.powerTarget - this.power;
    this.power += pdiff * Math.min(1, dt * (pdiff < 0 ? 6 : 1.2));
    if (Math.abs(pdiff) > 0.05 && Math.random() < 0.3) this.power *= Math.random();

    // fear / music / body
    const threat = this.entities.threatFor(p);
    this.threat = threat;
    this.fear += (clamp(threat.fear + (1 - p.sanity / 100) * 0.3, 0, 1) - this.fear) * Math.min(1, dt * 2);
    this.audio.setChase(p.alive ? threat.chase : 0);
    this.audio.update(dt, { alive: p.alive, fear: this.fear, exertion: 1 - p.stamina });
    this.damage = Math.max(0, this.damage - dt * 1.5);
    this.glitch = Math.max(0, this.glitch - dt * 1.2);
    this.blink = Math.max(0, this.blink - dt * 1.5);

    // network
    if (this.net) {
      this.netTimer -= dt;
      if (this.netTimer <= 0) { this.netTimer = 1 / 15; this.sendState(); }
      if (this.isHost) {
        this.entTimer -= dt;
        if (this.entTimer <= 0) { this.entTimer = 0.1; this.net.send({ t: 'ent', s: this.entities.snapshot(), pw: this.powerTarget }); }
        this.itemSync -= dt;
        if (this.itemSync <= 0) { this.itemSync = 3; this.net.send({ t: 'ev', k: 'items', taken: this.items.filter((i) => i.taken).map((i) => i.id) }); }
      }
    }
    this.updateHUD(dt);
  }

  sendState(force) {
    if (!this.net) return;
    const p = this.local;
    this.net.send({ t: 'st', x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), fl: p.flashlight ? 1 : 0, cr: p.crouch ? 1 : 0, n: Math.round(p.noise), a: p.alive ? 1 : 0, s: Math.round(p.sanity), mv: p.speed > 0.3 ? 1 : 0 });
    if (force) this.updateRoster();
  }

  blackouts(dt) {
    if (this.level.light.panel === 'none') { this.powerTarget = 1; return; }
    this.blackoutTimer -= dt;
    if (this.blackoutTimer <= 0) {
      if (this.powerTarget > 0.5) {
        this.powerTarget = 0;
        this.blackoutTimer = 6 + Math.random() * 8;
        this.audio.event('thud', [this.local.x, 3, this.local.z]);
        this.toast('The lights die.', 2500);
      } else {
        this.powerTarget = 1;
        this.blackoutTimer = (90 + Math.random() * 120) / this.diff;
      }
    }
  }

  // ---- player ----
  updatePlayer(dt, inp) {
    const p = this.local, m = this.map, lv = this.level;
    p.yaw -= inp.look[0];
    p.pitch = clamp(p.pitch - inp.look[1], -1.45, 1.45);
    if (inp.pressed.has('flash')) { p.flashlight = !p.flashlight; this.audio.click(); }
    if (inp.pressed.has('crouch')) this.input.crouchToggle = !this.input.crouchToggle;
    p.crouch = inp.crouch;
    if (inp.pressed.has('drink')) this.drink();

    // movement
    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const moving = ml > 0.1;
    const canSprint = p.stamina > 0.05 && !p.exhausted && my > 0.2 && !p.crouch;
    const sprint = inp.sprint && canSprint && moving;
    if (p.stamina <= 0.02) p.exhausted = true;
    if (p.exhausted && p.stamina > 0.35) p.exhausted = false;
    let speed = p.crouch ? 1.4 : sprint ? 5.2 : 2.7;
    if (lv.water > 0.3) speed *= 0.78;
    p.stamina = clamp(p.stamina + (sprint ? -0.2 : moving ? 0.07 : 0.14) * dt, 0, 1);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    const vx = (fx * my + rx * mx) * speed, vz = (fz * my + rz * mx) * speed;
    const ox = p.x, oz = p.z;
    const hitX = this.collide(p, p.x + vx * dt, p.z, 'x');
    const hitZ = this.collide(p, p.x, p.z + vz * dt, 'z');
    const moved = Math.hypot(p.x - ox, p.z - oz);
    p.speed = moved / dt;
    // noclip easter egg: sprint into a wall long enough in solo...
    if (!this.net && sprint && (hitX || hitZ) && moved < 0.01) {
      this.noclipPush += dt;
      if (this.noclipPush > 2.5) { this.noclipPush = 0; if (Math.random() < 0.35) { this.toast('You clip through the wall...', 3000); this.glitch = 1.5; this.attempt = 0; const idx = Math.floor(Math.random() * LEVEL_COUNT); this.goLevel(idx, this.levelSeed(idx)); } else this.audio.bump(); }
    } else this.noclipPush = Math.max(0, this.noclipPush - dt);

    // eye height, head bob and footsteps
    const targetH = p.crouch ? 1.0 : 1.62;
    p.y += (targetH - p.y) * Math.min(1, dt * 10);
    if (p.speed > 0.3) {
      const prev = p.bob;
      p.bob += dt * p.speed * 1.9;
      if (Math.floor(prev / Math.PI) !== Math.floor(p.bob / Math.PI)) this.audio.footstep(lv.surface, p.crouch ? 0.35 : sprint ? 1.3 : 0.9);
    }
    p.noise = !moving ? 0 : p.crouch ? 1.5 : sprint ? 18 : 7;

    // interaction
    const ex = this.renderer.exitPos;
    const nearExit = Math.hypot(ex[0] - p.x, ex[1] - p.z) < 2.0;
    let prompt = '';
    if (nearExit) prompt = `${this.input.touch ? 'Tap USE' : '[E]'} — ${lv.exit === 'hole' ? 'Crawl through' : lv.exit === 'ladder' ? 'Climb' : 'Go through'} (${(LEVELS[this.levelIdx + 1] || LEVELS[0]).name})`;
    const near = this.items.find((it) => !it.taken && Math.hypot((it.x + 0.5) * m.cell + it.ox - p.x, (it.y + 0.5) * m.cell + it.oz - p.z) < 1.4);
    if (near) prompt = `${this.input.touch ? 'Tap USE' : '[E]'} — ${near.type === 'almond' ? 'Take almond water' : 'Read note'}`;
    if (inp.pressed.has('use')) {
      if (near) this.takeItem(near);
      else if (nearExit) { this.nextLevel(); }
    }
    $('prompt').textContent = prompt;
    $('prompt').classList.toggle('show', !!prompt);

    // sanity
    const cellLit = this.renderer.lightAt(p.x, p.z);
    const lit = (cellLit[0] + cellLit[1] + cellLit[2]) * this.power > 0.15;
    let ds = 0;
    if (!lit && !p.flashlight) ds -= 0.45;
    if (this.threat && this.threat.fear > 0.2) ds -= this.threat.fear * 1.6;
    if (lit && (!this.threat || this.threat.fear < 0.1)) ds += 0.25;
    if (this.remotes.size && [...this.remotes.values()].some((r) => r.alive && Math.hypot(r.rx - p.x, r.rz - p.z) < 6)) ds += 0.2; // company helps
    p.sanity = clamp(p.sanity + ds * dt, 0, 100);
    if (p.sanity <= 0) this.die('screamer');

    // smooth flashlight sway
    const fwd = forwardVec(p.yaw, p.pitch);
    const k = Math.min(1, dt * 12);
    for (let i = 0; i < 3; i++) this.flashDir[i] += (fwd[i] - this.flashDir[i]) * k;
    this.audio.setListener([p.x, p.y, p.z], fwd);
    // fluorescent hum louder under lights
    this.audio.setHum(clamp((cellLit[0] + cellLit[1]) * 1.2, 0.15, 1.3) * this.power);
  }

  collide(p, nx, nz, axis) {
    const m = this.map, cs = m.cell, r = PLAYER_R;
    const wallAt = (x, z) => m.grid[Math.floor(z / cs) * m.W + Math.floor(x / cs)] === WALL;
    const blocked = wallAt(nx - r, nz - r) || wallAt(nx + r, nz - r) || wallAt(nx - r, nz + r) || wallAt(nx + r, nz + r);
    if (!blocked) { p.x = nx; p.z = nz; return false; }
    // slide flush against the wall
    if (axis === 'x') {
      const cx = Math.floor((nx + (nx > p.x ? r : -r)) / cs);
      p.x = nx > p.x ? cx * cs - r - 0.001 : (cx + 1) * cs + r + 0.001;
      if (wallAt(p.x - r, p.z - r) || wallAt(p.x + r, p.z - r) || wallAt(p.x - r, p.z + r) || wallAt(p.x + r, p.z + r)) p.x = p.x; // keep
    } else {
      const cz = Math.floor((nz + (nz > p.z ? r : -r)) / cs);
      p.z = nz > p.z ? cz * cs - r - 0.001 : (cz + 1) * cs + r + 0.001;
    }
    return true;
  }

  takeItem(it) {
    it.taken = true;
    this.net && this.net.send({ t: 'ev', k: 'take', id: it.id });
    if (it.type === 'almond') {
      this.local.almond = Math.min(5, this.local.almond + 1);
      this.audio.pickup();
      this.toast('Almond water +1  (Q / DRINK)');
    } else {
      this.audio.paper();
      $('noteText').textContent = NOTES[(this.seed + it.id * 7) % NOTES.length];
      $('note').classList.remove('hidden');
      this.input.unlock();
    }
  }

  drink() {
    const p = this.local;
    if (p.almond <= 0) { this.toast('No almond water.'); return; }
    p.almond--;
    p.sanity = Math.min(100, p.sanity + 38);
    p.stamina = 1;
    this.audio.drink();
  }

  // ---- entity presentation (sound for every client) ----
  presentEntities(dt) {
    const p = this.local;
    for (const e of this.entities.list) {
      if (e.px === undefined) { e.px = e.x; e.pz = e.z; e.voiceT = 4 + Math.random() * 10; e.stepAcc = 0; }
      const moved = Math.hypot(e.x - e.px, e.z - e.pz);
      e.px = e.x; e.pz = e.z;
      e.vmoving = moved / Math.max(dt, 1e-3);
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (e.visible < 0.3) continue;
      e.stepAcc += moved;
      const stride = e.type === 'hound' || e.type === 'crawler' ? 0.9 : 1.3;
      if (e.stepAcc > stride && d < 32) { e.stepAcc = 0; this.audio.entityStep(e.type, [e.x, 0.3, e.z], this.entOccluded(e)); }
      e.voiceT -= dt;
      if (e.voiceT <= 0) {
        e.voiceT = 7 + Math.random() * 14;
        if (d < 28) this.audio.voice(e.type, [e.x, 1.4, e.z], 'idle', this.entOccluded(e));
      }
      // lights stutter when something hostile is close
      if (d < 9 && ['hunt', 'charge', 'stalk', 'close'].includes(e.state)) this.nearHostile = true;
    }
  }

  updateHallucinations(dt) {
    const p = this.local;
    this.halluTimer -= dt;
    if (p.alive && p.sanity < 55 && this.halluTimer <= 0) {
      this.halluTimer = 6 + (p.sanity / 55) * 20 + Math.random() * 8;
      // a figure at the far end of what you can see
      const fwd = forwardVec(p.yaw, 0);
      for (let k = 0; k < 20; k++) {
        const a = p.yaw + (Math.random() - 0.5) * 1.2;
        const dist = 8 + Math.random() * 14;
        const x = p.x - Math.sin(a) * dist, z = p.z - Math.cos(a) * dist;
        const c = Math.floor(z / this.map.cell) * this.map.W + Math.floor(x / this.map.cell);
        if (c < 0 || c >= this.map.grid.length || this.map.grid[c] === WALL) continue;
        if (!lineOfSight(this.map, p.x, p.z, x, z)) continue;
        const type = TYPE_LIST[Math.floor(Math.random() * TYPE_LIST.length)];
        this.hallucinations.push({ type, x, z, ttl: 0.6 + Math.random() * 1.6, seen: 0 });
        if (Math.random() < 0.5) this.audio.event('whisper', [x, 1.5, z]);
        break;
      }
      void fwd;
    }
    for (const h of this.hallucinations) {
      h.ttl -= dt;
      // vanishes when your light finds it
      if (p.flashlight && this.entities.inFlashlight(p, h.x, 1.2, h.z)) { h.seen += dt; if (h.seen > 0.25) { h.ttl = 0; this.glitch = 0.4; } }
    }
    this.hallucinations = this.hallucinations.filter((h) => h.ttl > 0);
  }

  // ---------------- drawing ----------------
  draw(dt, menu = false) {
    const p = this.local;
    const sprites = [];
    if (!menu) {
      sprites.push(...this.entities.sprites(this.time, p));
      for (const r of this.remotes.values()) {
        if (!r.seen || !r.alive) continue;
        sprites.push({ x: r.rx, z: r.rz, y: 0, w: 0.9, h: r.crouch ? 1.35 : 1.8, slot: SLOT.player + (r.moving ? Math.floor(this.time * 4) % 2 : 0), emissive: 0, alpha: 1, tint: 1 });
      }
      for (const it of this.items) {
        if (it.taken) continue;
        const x = (it.x + 0.5) * this.map.cell + it.ox, z = (it.y + 0.5) * this.map.cell + it.oz;
        if (Math.hypot(x - p.x, z - p.z) > 30) continue;
        sprites.push({ x, z, y: it.type === 'almond' ? 0 : 0, w: 0.35, h: 0.7, slot: it.type === 'almond' ? SLOT.almond : SLOT.note, emissive: 0, alpha: 1, tint: 1.3 });
      }
      for (const h of this.hallucinations) {
        const T = TYPES[h.type];
        sprites.push({ x: h.x, z: h.z, y: 0, w: T.w, h: T.h, slot: ENTITY_SPRITES.indexOf(h.type) * 2, emissive: 1, alpha: 1, glitch: 1, tint: 0.8 });
      }
    }
    // camera
    const bobY = Math.sin(p.bob * 2) * 0.035 * Math.min(1, p.speed / 3);
    const bobX = Math.cos(p.bob) * 0.025 * Math.min(1, p.speed / 3);
    const eye = [p.x + Math.cos(p.yaw) * bobX, p.y + bobY, p.z - Math.sin(p.yaw) * bobX];
    const fear = this.fear || 0;
    const shake = fear > 0.6 ? (Math.random() - 0.5) * 0.004 * fear : 0;
    // flashlights
    const flash = [];
    let flick = 1;
    if (this.threat && this.threat.fear > 0.55 && Math.random() < 0.15 * this.threat.fear) flick = Math.random() * 0.6;
    if (p.flashlight && p.alive) {
      const rgt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
      flash.push({ pos: [eye[0] + rgt[0] * 0.18, eye[1] - 0.2, eye[2] + rgt[2] * 0.18], dir: this.flashDir.slice(), intensity: 1.35 * flick });
    }
    if (!menu) {
      const others = [...this.remotes.values()].filter((r) => r.seen && r.alive && r.flashlight)
        .sort((a, b) => Math.hypot(a.rx - p.x, a.rz - p.z) - Math.hypot(b.rx - p.x, b.rz - p.z)).slice(0, 3);
      for (const r of others) flash.push({ pos: [r.rx, (r.y || 1.62) - 0.2, r.rz], dir: forwardVec(r.yaw, r.pitch), intensity: 1.1 });
    }
    let power = this.power;
    if (this.nearHostile) { power *= Math.random() < 0.25 ? 0.15 : 1; this.nearHostile = false; }
    this.renderer.render({
      eye, yaw: p.yaw, pitch: p.pitch + shake, roll: shake * 2, fov: (this.settings.fov * Math.PI) / 180 * (1 + (this.local.speed > 4 ? 0.04 : 0)),
      time: this.time, power, flash, sprites,
      exposure: 1.35, ambientMul: menu ? 2.5 : 1,
      post: { fear, damage: this.damage, sanity: menu ? 1 : p.sanity / 100, blink: this.blink, glitch: this.glitch },
    });
    if (this.scare) {
      this.scare.t += dt;
      const sc = $('scare');
      if (sc.width !== innerWidth) { sc.width = innerWidth; sc.height = innerHeight; }
      drawJumpscare(sc.getContext('2d'), this.scare.type, sc.width, sc.height, this.scare.t);
    }
    if (!menu) this.drawTags(eye);
    $('fps').textContent = this.settings.fps ? `${this.fpsShow} fps · ${Math.round(this.settings.scale * 100)}%` + (this.net && this.net.ping ? ` · ${this.net.ping}ms` : '') : '';
  }

  drawTags(eye) {
    const tags = $('tags');
    if (!this.remotes.size) { tags.innerHTML = ''; return; }
    const p = this.local;
    const fwd = forwardVec(p.yaw, p.pitch);
    const html = [];
    const fov = (this.settings.fov * Math.PI) / 180, aspect = innerWidth / innerHeight;
    const f = 1 / Math.tan(fov / 2);
    const rgt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    const up = [rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0]];
    for (const r of this.remotes.values()) {
      if (!r.seen) continue;
      const v = [r.rx - eye[0], 2.05 - eye[1], r.rz - eye[2]];
      const z = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
      if (z < 0.3) continue;
      const d = Math.hypot(v[0], v[2]);
      if (d > 25 || !lineOfSight(this.map, p.x, p.z, r.rx, r.rz)) continue;
      const x = (v[0] * rgt[0] + v[2] * rgt[2]) / z * f / aspect;
      const y = -(v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / z * f;
      html.push(`<div class="tag" style="left:${(x * 0.5 + 0.5) * 100}%;top:${(y * -0.5 + 0.5) * 100}%;color:${r.color}">${esc(r.name)}${r.alive ? '' : ' ✝'}</div>`);
    }
    tags.innerHTML = html.join('');
  }

  updateHUD() {
    const p = this.local;
    $('stam').style.width = p.stamina * 100 + '%';
    $('stam').classList.toggle('ex', !!p.exhausted);
    $('san').style.width = p.sanity + '%';
    $('san').classList.toggle('low', p.sanity < 30);
    $('almond').textContent = p.almond;
    $('levelTag').textContent = `${this.level.name} · ${this.level.sub}${this.cycle ? ` · cycle ${this.cycle + 1}` : ''}`;
    $('flashIcon').classList.toggle('off', !p.flashlight);
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

window.addEventListener('load', () => {
  try { window.game = new Game(); } catch (e) { console.error(e); $('loading').textContent = 'Failed to start: ' + e.message; }
});
